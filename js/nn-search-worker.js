/**
 * Busca das unidades por camada em segundo plano (página de redes): carrega os dados, prepara a busca
 * (js/axc/nnsearch.js), distribui as avaliações entre workers de avaliação (quando o navegador permite workers dentro
 * de workers) e devolve o progresso e o resultado. Com o.hybrid, a busca híbrida (curvas calibradas, heurística no
 * modelo estático e verificação dos melhores pontos); sem ele, a busca medida.
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
        const P = prepareSearch(net, { val, test, synth, cells, fpga, objective: o.objective, dirs: o.dirs, trees: o.trees, clockNs: o.clockNs, maxCands: o.maxCands, sample: o.sample });
        let engine;
        const n = Math.max(1, o.workers ?? 1);
        if (n > 1 && typeof Worker !== 'undefined') {
            try {
                const init = initMessage(netJson, valBuf, synth, P.trees, o.sample);
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
        let last = 0;
        const progress = (p) => { const now = Date.now(); if (now - last > 200) { last = now; self.postMessage({ type: 'progress', ...p }); } };
        const r = o.hybrid
            ? await hybridSearch(P, { heuristic: o.heuristic, maxDrop: o.maxDrop, progress }, engine)
            : await searchNetwork(P, { heuristic: o.heuristic, maxDrop: o.maxDrop, progress }, engine);
        // Custo de cada camada do ponto escolhido e da exata (para a tabela).
        const layers = (assign) => P.cm.network(assign).layers.map((l) => ({ name: l.name, site: l.site, area: l.area, luts: l.luts, energy: l.energy, cycles: l.cycles }));
        // Na híbrida, os pontos do modelo estático são milhares: só os perto do limite vão para o gráfico, e os passos
        // (o passo a passo das heurísticas) ficam para a animação.
        const points = o.hybrid
            ? r.points.filter((p) => p.drop <= Math.max(5, 4 * r.maxDrop) || p.measured).map((p) => ({ cost: p.cost, drop: p.drop, feasible: p.feasible, measured: p.measured, assign: p.assign }))
            : r.points.map((p) => ({ cost: p.cost, wrong: p.wrong, feasible: p.feasible, full: p.full, assign: p.assign }));
        self.postMessage({
            type: 'done',
            result: {
                ...r, points, steps: undefined,
                cands: P.cands.map((c) => ({ mul: c.mul.map((x) => x.name), add: c.add.map((x) => x.name) })),
                layersBest: layers(r.best.assign), layersExact: layers(P.exact), n: P.n, testN: test.n,
            },
        });
    } catch (e) {
        self.postMessage({ type: 'error', message: e.message });
    } finally {
        for (const w of subs) w.terminate();
    }
};
