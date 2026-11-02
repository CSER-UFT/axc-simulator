/**
 * Busca das unidades por camada em segundo plano (página de redes): carrega os dados, prepara a busca
 * (js/axc/nnsearch.js), distribui as avaliações entre workers de avaliação (quando o navegador permite workers dentro
 * de workers) e devolve o progresso e o resultado. Com o.hybrid, a busca híbrida (curvas calibradas, heurística no
 * modelo estático e verificação dos melhores pontos); sem ele, a busca medida.
 *
 * o.runs: a lista de buscas da execução ({heuristic, hybrid}; sem ela, a de o.heuristic e o.hybrid). Todas usam a
 * mesma preparação (e, na híbrida, a mesma calibração); cada uma manda run-start, os pontos ao vivo (points, com o
 * índice k) e run-done com o resultado, e no fim vem done.
 */
import { decodeNet, decodeTestSet } from './axc/nn.js';
import { prepareSearch, searchNetwork, hybridSearch, poolEngine, initMessage } from './axc/nnsearch.js';

const getJson = (f) => fetch(f).then((r) => (r.ok ? r.json() : Promise.reject(new Error(f))));
const getBin = (f) => fetch(f).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(f))));
const base = new URL('../', import.meta.url);
const url = (f) => new URL(f, base).href;

self.onmessage = async ({ data: o }) => {
    const subs = [];
    try {
        self.postMessage({ type: 'status', key: 'nn.searchLoading' });
        const [synth, cells, fpga, netJson] = await Promise.all([getJson(url('data/synth.json')), getJson(url('data/hls-cells.json')), getJson(url('data/vivado-units.json')).catch(() => null), getJson(url(o.file))]);
        const net = decodeNet(netJson), ds = net.dataset;
        const [valBuf, testBuf] = await Promise.all([getBin(url(ds.val.file)), getBin(url(ds.file))]);
        const val = decodeTestSet(valBuf, { ...ds, n: ds.val.n }), test = decodeTestSet(testBuf, ds);
        self.postMessage({ type: 'status', key: 'nn.searchPreparing' });
        const P = prepareSearch(net, { val, test, synth, cells, fpga, objective: o.objective, dirs: o.dirs, trees: o.trees, clockNs: o.clockNs, maxCands: o.maxCands, sample: o.sample, biasFix: o.biasFix ?? 'none' });
        let engine;
        const n = Math.max(1, o.workers ?? 1);
        if (n > 1 && typeof Worker !== 'undefined') {
            try {
                const init = initMessage(netJson, valBuf, synth, P.trees, o.sample, o.biasFix ?? 'none');
                const send = [];
                for (let i = 0; i < n; i++) {
                    const w = new Worker(new URL('./nn-eval-worker.js', import.meta.url), { type: 'module' });
                    subs.push(w);
                    let next = 0;
                    const wait = new Map();
                    w.onmessage = ({ data: { id, reply } }) => { const f = wait.get(id); wait.delete(id); f(reply); };
                    send.push((msg) => new Promise((res, rej) => { const id = next++; wait.set(id, (r) => (r.type === 'error' ? rej(new Error(r.message)) : res(r))); w.postMessage({ id, msg }); }));
                }
                await Promise.all(send.map((f) => f(init)));
                engine = poolEngine(send);
            } catch { for (const w of subs.splice(0)) w.terminate(); engine = undefined; }
        }
        const runs = o.runs?.length ? o.runs : [{ heuristic: o.heuristic, hybrid: o.hybrid }];
        // Animação ao vivo: o custo e a acurácia da exata, e depois os pontos avaliados, em lotes (a cada 150 ms).
        const exactCost = P.metric(P.cm.network(P.exact).totals);
        self.postMessage({ type: 'meta', exactCost, accVal: 1 - P.exactWrong / P.n, n: P.n, maxDrop: o.maxDrop });
        // Custo de cada camada (para a tabela do detalhe).
        const layers = (assign) => P.cm.network(assign).layers.map((l) => ({ name: l.name, site: l.site, area: l.area, luts: l.luts, energy: l.energy, cycles: l.cycles }));
        const layersExact = layers(P.exact);
        const cands = P.cands.map((c) => ({ mul: c.mul.map((x) => x.name), add: c.add.map((x) => x.name) }));
        for (let k = 0; k < runs.length; k++) {
            const { heuristic, hybrid } = runs[k];
            self.postMessage({ type: 'run-start', k, n: runs.length, heuristic, hybrid });
            let last = 0;
            const progress = (p) => { const now = Date.now(); if (now - last > 200) { last = now; self.postMessage({ type: 'progress', k, ...p }); } };
            let batch = [], lastB = 0;
            const flush = () => { if (batch.length) { self.postMessage({ type: 'points', k, pts: batch }); batch = []; } lastB = Date.now(); };
            const onPoint = (e) => {
                if (e.phase === 'calib') return;
                batch.push(hybrid
                    ? { v: e.phase === 'verify', c: e.cost, d: e.phase === 'verify' ? e.est : e.drop, m: e.phase === 'verify' ? e.drop : undefined, f: e.feasible }
                    : { c: e.cost, w: e.wrong, f: e.feasible, full: e.full });
                if (Date.now() - lastB > 150) flush();
            };
            const r = hybrid
                ? await hybridSearch(P, { heuristic, maxDrop: o.maxDrop, progress, onPoint }, engine)
                : await searchNetwork(P, { heuristic, maxDrop: o.maxDrop, progress, onPoint }, engine);
            flush();
            // Na híbrida, os pontos do modelo estático são milhares: só os perto do limite vão para o gráfico; o passo
            // a passo (calibração, iterações da heurística e verificações) vai para a animação.
            const points = hybrid
                ? r.points.filter((p) => p.drop <= Math.max(5, 4 * r.maxDrop) || p.measured).map((p) => ({ cost: p.cost, drop: p.drop, feasible: p.feasible, measured: p.measured, assign: p.assign }))
                : r.points.map((p) => ({ cost: p.cost, wrong: p.wrong, feasible: p.feasible, full: p.full, assign: p.assign, fullOk: p.fullOk }));
            self.postMessage({
                type: 'run-done', k,
                result: { ...r, hybrid: !!hybrid, points, steps: hybrid ? r.steps : undefined, cands, layersBest: layers(r.best.assign), layersExact, n: P.n, testN: test.n },
            });
        }
        self.postMessage({ type: 'done', n: runs.length });
    } catch (e) {
        self.postMessage({ type: 'error', message: e.message });
    } finally {
        for (const w of subs) w.terminate();
    }
};
