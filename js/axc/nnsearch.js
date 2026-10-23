/**
 * Busca das unidades aproximadas de cada camada de uma rede: o multiplicador e o somador de cada camada com pesos que
 * gastam menos (área, LUTs ou energia) com a queda de acurácia no conjunto de validação dentro de um limite.
 *
 *   arquitetura  as diretivas das camadas ficam fixas (as da página); o custo é o do modelo de síntese de alto nível
 *                sobre o código gerado (js/axc/nngen.js, costModel), por camada, e o da rede é a soma;
 *   acurácia     a do conjunto de validação (1000 imagens separadas das de teste), com a ordem das somas das
 *                diretivas; a de teste só é medida no fim, para o ponto escolhido (a escolha não vê o teste);
 *   candidatas   para cada camada, as unidades da fronteira de Pareto entre o custo da unidade (no objetivo) e o erro
 *                da soma de uma saída, medido com os operandos reais da camada: K produtos sorteados das distribuições
 *                das ativações (da rede exata, na validação) e dos pesos, somados com a estrutura das diretivas;
 *   heurísticas  sensibilidade (eficiência): cada candidata sozinha, a partir da rede exata; depois, as trocas em
 *                ordem de economia por imagem errada a mais, cada uma conferida em conjunto com as já aceitas;
 *                sequencial: camada por camada, na ordem da rede, o multiplicador e depois o somador, da candidata
 *                mais barata para a mais cara, fica a primeira que mantém o limite;
 *   avaliação    as ativações da entrada de cada camada da configuração atual ficam guardadas: trocar a unidade da
 *                camada i refaz só as camadas de i em diante. A avaliação para assim que as imagens erradas passam do
 *                limite (o ponto já é inviável).
 */
import { productTable, adderAccumulate, inferFrom, inputActivations, sumTerms, decodeNet, decodeTestSet } from './nn.js';
import { buildUnit } from './units.js';
import { costModel, directiveTrees } from './nngen.js';
import { makeLibrary } from '../hls/lib.js';
import { rng } from './metrics.js';

export const SEARCH_OBJECTIVES = ['area', 'luts', 'energy'];
export const SEARCH_HEURISTICS = ['sensitivity', 'sequential'];

const isWeighted = (l) => l.type === 'conv' || l.type === 'dense';

/** Avaliador da acurácia com as ativações da configuração base guardadas na entrada de cada camada com pesos. */
class Evaluator {
    constructor(net, set, trees, unitOf) {
        this.net = net;
        this.set = set;
        this.trees = trees;
        this.unitOf = unitOf;
        this.siteLayer = [];
        net.layers.forEach((l, li) => { if (isWeighted(l)) this.siteLayer.push(li); });
        this.sizes = net.sites.map((l) => l.inShape.reduce((a, b) => a * b, 1));
        this.buf = this.sizes.map((n) => new Uint8Array(n * set.n));
        this.tables = new Map();
        this.adds = new Map();
        this.base = null;
        this.basePreds = new Uint8Array(set.n);
        this.baseWrong = 0;
        this.evals = 0;
        this.images = 0;
        this.input = new Uint8Array(set.size);
    }
    table(name) {
        if (!this.tables.has(name)) this.tables.set(name, productTable(name ? this.unitOf(name) : null));
        return this.tables.get(name);
    }
    adder(name) {
        if (!name) return null;
        if (!this.adds.has(name)) this.adds.set(name, adderAccumulate(this.unitOf(name)));
        return this.adds.get(name);
    }
    /** Primeira camada em que a configuração difere da base (null: igual). */
    firstDiff(assign) {
        if (!this.base) return 0;
        for (let si = 0; si < this.net.sites.length; si++) {
            const a = assign[si] ?? {}, b = this.base[si] ?? {};
            if ((a.mul ?? null) !== (b.mul ?? null) || (a.add ?? null) !== (b.add ?? null)) return si;
        }
        return null;
    }
    /**
     * Classifica o conjunto com a configuração. maxWrong: para quando as erradas passam disso. record: guarda as
     * ativações das camadas (a configuração vira a base).
     */
    run(assign, { maxWrong = Infinity, record = false } = {}) {
        const from = this.firstDiff(assign);
        if (from === null) return { feasible: this.baseWrong <= maxWrong, wrong: this.baseWrong, seen: this.set.n, preds: this.basePreds };
        const { net, set } = this;
        const tables = net.sites.map((_, si) => this.table(assign[si]?.mul ?? null));
        const adds = net.sites.map((_, si) => this.adder(assign[si]?.add ?? null));
        const preds = record ? this.basePreds : new Uint8Array(set.n);
        const li0 = this.siteLayer[from];
        const slot = new Map(this.siteLayer.map((li, si) => [li, si]));
        let wrong = 0, k = 0;
        this.evals++;
        for (; k < set.n; k++) {
            let x, li = li0;
            if (from === 0 && !this.base) { x = inputActivations(net, set.images.subarray(k * set.size, (k + 1) * set.size), this.input); li = 0; }
            else x = this.buf[from].subarray(k * this.sizes[from], (k + 1) * this.sizes[from]);
            const rec = record ? (l, v) => { const si = slot.get(l); if (si !== undefined && si >= from) this.buf[si].set(v, k * this.sizes[si]); } : null;
            const { pred } = inferFrom(net, x, li, tables, adds, undefined, this.trees, rec);
            preds[k] = pred;
            if (pred !== set.labels[k] && ++wrong > maxWrong) { k++; break; }
        }
        this.images += k;
        if (record) { this.base = assign.map((a) => ({ mul: a?.mul ?? null, add: a?.add ?? null })); this.baseWrong = wrong; }
        return { feasible: wrong <= maxWrong, wrong, seen: k, preds };
    }
}

/** Põe a configuração como base do avaliador (as ativações guardadas), se ainda não for. */
function ensureBase(ev, base) {
    if (ev.firstDiff(base) !== null) ev.run(base, { record: true });
}

/**
 * Motores de avaliação: run(assign, {maxWrong, base}) devolve {feasible, wrong, seen} (base: a configuração cujas
 * ativações são reaproveitadas). O local usa o avaliador da preparação; o de workers distribui as avaliações.
 */
export function localEngine(P) {
    return {
        size: 1,
        run: async (assign, { maxWrong = Infinity, base = assign } = {}) => {
            ensureBase(P.val, base);
            const r = P.val.run(assign, { maxWrong });
            return { feasible: r.feasible, wrong: r.wrong, seen: r.seen };
        },
        close: () => {},
    };
}
/**
 * Motor com vários workers: send[i](mensagem) devolve a resposta do worker i (uma Promise). Cada worker tem o seu
 * avaliador (initMessage) e a sua base; as avaliações vão para o primeiro worker livre.
 */
export function poolEngine(send) {
    const free = send.map((_, i) => i), waiting = [];
    const take = () => (free.length ? Promise.resolve(free.shift()) : new Promise((r) => waiting.push(r)));
    const give = (i) => (waiting.length ? waiting.shift()(i) : free.push(i));
    return {
        size: send.length,
        run: async (assign, { maxWrong = Infinity, base = assign } = {}) => {
            const i = await take();
            try {
                const r = await send[i]({ type: 'run', assign, base, maxWrong: Number.isFinite(maxWrong) ? maxWrong : -1 });
                return { feasible: r.feasible, wrong: r.wrong, seen: r.seen };
            } finally { give(i); }
        },
        close: () => {},
    };
}
/** Mensagem de início de um worker de avaliação: a rede (JSON), o conjunto de validação e as unidades. */
export function initMessage(netJson, valBuf, synth, trees) {
    const used = synth.designs.filter((d) => (d.cfg.kind === 'mul' && d.cfg.width === 8) || (d.cfg.kind === 'add' && d.cfg.width === 32));
    return { type: 'init', net: netJson, buf: valBuf, designs: used.map((d) => ({ name: d.name, cfg: d.cfg })), trees };
}
/** Tratador das mensagens de um worker de avaliação (o mesmo no navegador e no Node). */
export function evalHandler() {
    let ev = null;
    return (m) => {
        if (m.type === 'init') {
            const net = decodeNet(m.net), ds = net.dataset;
            const set = decodeTestSet(m.buf, { ...ds, n: ds.val.n });
            const cfgs = new Map(m.designs.map((d) => [d.name, d.cfg])), units = new Map();
            const unitOf = (name) => { if (!units.has(name)) units.set(name, buildUnit(cfgs.get(name))); return units.get(name); };
            ev = new Evaluator(net, set, m.trees, unitOf);
            return { type: 'ready' };
        }
        if (m.type === 'run') {
            ensureBase(ev, m.base);
            const r = ev.run(m.assign, { maxWrong: m.maxWrong < 0 ? Infinity : m.maxWrong });
            return { type: 'result', feasible: r.feasible, wrong: r.wrong, seen: r.seen };
        }
        return { type: 'error', message: `mensagem desconhecida: ${m.type}` };
    };
}

/** f sobre os itens, com no máximo limit chamadas em andamento (e uma pausa entre elas, para o progresso sair). */
async function mapLimit(items, limit, f) {
    const out = new Array(items.length);
    let next = 0;
    const lane = async () => {
        while (next < items.length) {
            const k = next++;
            await new Promise((r) => setTimeout(r, 0));
            out[k] = await f(items[k]);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, limit) }, lane));
    return out;
}

/** Fronteira de Pareto (menor custo, menor erro), em ordem de custo. */
function pareto(items) {
    const s = [...items].sort((a, b) => a.cost - b.cost || a.err - b.err);
    const out = [];
    let best = Infinity;
    // Do mais barato para o mais caro: fica quem tem erro menor que todos os mais baratos (não é dominado).
    for (const x of s) if (x.err < best) { out.push(x); best = x.err; }
    return out;
}
/** No máximo m itens, espalhados pela lista (sempre o primeiro e o último). */
function spread(list, m) {
    if (list.length <= m) return list;
    return Array.from({ length: m }, (_, i) => list[Math.round((i * (list.length - 1)) / (m - 1))]);
}

/**
 * Preparação: modelo de custo, avaliadores (validação e teste), estatísticas dos operandos e candidatas por camada.
 * @param {object} net rede decodificada
 * @param {{val: object, test: object, synth, cells, fpga?, dirs?, trees?: number[], objective?: string, clockNs?: number,
 *          flow?: string, maxCands?: number, samples?: number}} o val e test: conjuntos (decodeTestSet)
 */
export function prepareSearch(net, o) {
    const objective = o.objective ?? 'area';
    if (!SEARCH_OBJECTIVES.includes(objective)) throw new Error(`objetivo desconhecido: ${objective}`);
    const target = objective === 'luts' ? 'fpga' : 'asic';
    if (target === 'fpga' && !o.fpga) throw new Error('o objetivo LUT precisa de data/vivado-units.json');
    const trees = o.trees ?? directiveTrees(net, o.dirs);
    const cm = costModel(net, { synth: o.synth, cells: o.cells, fpga: o.fpga, target, flow: o.flow ?? 'delay', clockNs: o.clockNs ?? 10, dirs: o.dirs });
    const lib = makeLibrary(o.synth, o.cells, { flow: o.flow ?? 'delay', target, fpga: o.fpga ?? null, wide: true });
    const designs = new Map(o.synth.designs.map((d) => [d.name, d]));
    const units = new Map();
    const unitOf = (name) => {
        if (!units.has(name)) units.set(name, buildUnit(designs.get(name).cfg));
        return units.get(name);
    };
    const metric = (x) => x[objective];
    const val = new Evaluator(net, o.val, trees, unitOf);
    const test = o.test ? new Evaluator(net, o.test, trees, unitOf) : null;
    const exact = net.sites.map(() => ({ mul: null, add: null }));
    // Rede exata na validação, com as ativações guardadas (são também as dos operandos).
    val.run(exact, { record: true });
    const exactWrong = val.baseWrong;

    // Operandos de cada camada: histogramas das ativações (validação, rede exata) e dos pesos.
    const R = rng(2026);
    const samples = o.samples ?? 512;
    const stats = net.sites.map((l, si) => {
        const ha = new Float64Array(256), hw = new Float64Array(256);
        const b = val.buf[si];
        for (let i = 0; i < b.length; i++) ha[b[i]]++;
        for (const w of l.w) hw[w + 128]++;
        const cdf = (h) => { const c = new Float64Array(256); let s = 0; for (let i = 0; i < 256; i++) { s += h[i]; c[i] = s; } for (let i = 0; i < 256; i++) c[i] /= s; return c; };
        const ca = cdf(ha), cw = cdf(hw);
        const draw = (c) => { const r = R(); let lo = 0, hi = 255; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < r) lo = m + 1; else hi = m; } return lo; };
        const K = l.type === 'conv' ? l.inShape[0] * l.k * l.k : l.w.length / l.out;
        // K pares (peso, ativação) para cada uma das saídas sorteadas.
        const W = new Int16Array(K * samples), A = new Uint8Array(K * samples);
        for (let i = 0; i < W.length; i++) { W[i] = draw(cw) - 128; A[i] = draw(ca); }
        return { K, W, A };
    });
    /** Erro da soma de uma saída (raiz do erro quadrático médio) com o multiplicador e o somador da camada. */
    const sumError = (si, mul, add) => {
        const { K, W, A } = stats[si];
        const T = val.table(mul), addf = val.adder(add);
        const fillX = (t, out) => { for (let j = 0; j < samples; j++) { const i = j * K + t; out[j] = W[i] * A[i]; } };
        const fillU = (t, out) => { for (let j = 0; j < samples; j++) { const i = j * K + t; out[j] = T[(W[i] + 128) * 256 + A[i]]; } };
        const exactAdd = (acc, p, n) => { for (let i = 0; i < n; i++) acc[i] += p[i]; return acc; };
        const ex = Int32Array.from(sumTerms(K, fillX, samples, exactAdd, 1).subarray(0, samples));
        const ap = sumTerms(K, fillU, samples, addf ?? exactAdd, trees[si] ?? 1);
        let s2 = 0;
        for (let j = 0; j < samples; j++) { const e = ap[j] - ex[j]; s2 += e * e; }
        return Math.sqrt(s2 / samples);
    };
    // Candidatas: fronteira de Pareto (custo da unidade no objetivo, erro da soma) por camada, sem as que custam
    // tanto quanto a exata.
    const maxCands = o.maxCands ?? 12;
    const pool = (kind) => o.synth.designs.filter((d) => d.cfg.kind === kind && d.cfg.width === (kind === 'mul' ? 8 : 32) && !/ exato$/.test(d.name)).map((d) => d.name);
    const exactCost = { mul: metric(lib.unit('MUL8 exato')), add: metric(lib.unit('ADD32 exato')) };
    const cands = net.sites.map((l, si) => {
        const of = (kind) => spread(pareto(pool(kind)
            .map((name) => ({ name, cost: metric(lib.unit(name)), err: kind === 'mul' ? sumError(si, name, null) : sumError(si, null, name) }))
            .filter((x) => x.cost < exactCost[kind])), maxCands);
        return { mul: of('mul'), add: of('add') };
    });
    return { net, objective, target, trees, cm, lib, val, test, exact, exactWrong, cands, metric, sumError, n: o.val.n };
}

/**
 * Busca.
 * @param {object} P preparação (prepareSearch)
 * @param {{heuristic?: string, maxDrop?: number, progress?: function}} o maxDrop: queda máxima de acurácia na validação
 *   (pontos percentuais)
 * @param {object} engine motor de avaliação (localEngine, o padrão, ou poolEngine)
 */
export async function searchNetwork(P, o = {}, engine = localEngine(P)) {
    const t0 = Date.now();
    const heuristic = o.heuristic ?? 'sensitivity';
    if (!SEARCH_HEURISTICS.includes(heuristic)) throw new Error(`heurística desconhecida: ${heuristic}`);
    const { net, cm, metric } = P;
    const maxDrop = o.maxDrop ?? 1;
    const maxWrong = P.exactWrong + Math.floor((maxDrop * P.n) / 100 + 1e-9);
    const progress = o.progress ?? (() => {});
    const siteCost = (si, a) => metric(cm.site(si, a?.mul ?? null, a?.add ?? null));
    const total = (assign) => metric(cm.network(assign).totals);
    const exactCost = total(P.exact);
    const points = [], trace = [];
    let evals = 0, images = 0, phase = '', bestCost = exactCost;
    const phaseMs = {};
    const copy = (a) => a.map((x) => ({ mul: x?.mul ?? null, add: x?.add ?? null }));
    const withSlot = (assign, si, kind, name) => assign.map((a, j) => (j === si ? { ...a, [kind]: name } : { ...a }));
    let cur = copy(P.exact);
    const tryAssign = async (next, base) => {
        const r = await engine.run(next, { maxWrong, base });
        evals++;
        images += r.seen;
        const p = { assign: copy(next), cost: total(next), wrong: r.wrong, feasible: r.feasible, full: r.feasible || r.seen === P.n };
        points.push(p);
        progress({ evals, images, phase, cost: bestCost / exactCost, ms: Date.now() - t0 });
        return r;
    };
    const accept = (next, why) => {
        cur = copy(next);
        bestCost = total(cur);
        trace.push({ ...why, cost: bestCost });
    };

    if (heuristic === 'sequential') {
        // Camada por camada; as candidatas de um grupo são avaliadas em lotes do tamanho do motor (em paralelo), da
        // mais barata para a mais cara, e fica a primeira viável na ordem.
        for (let si = 0; si < net.sites.length; si++) {
            for (const kind of ['mul', 'add']) {
                phase = `${net.sites[si].name} ${kind === 'mul' ? '×' : '+'}`;
                const now = siteCost(si, cur[si]);
                const order = P.cands[si][kind].map((c) => ({ c, cost: siteCost(si, { ...cur[si], [kind]: c.name }) }))
                    .filter((x) => x.cost < now).sort((a, b) => a.cost - b.cost);
                for (let b = 0; b < order.length; b += engine.size) {
                    const batch = order.slice(b, b + engine.size).map(({ c }) => withSlot(cur, si, kind, c.name));
                    const base = copy(cur);
                    const rs = await mapLimit(batch, engine.size, (next) => tryAssign(next, base));
                    const k = rs.findIndex((r) => r.feasible);
                    if (k >= 0) { accept(batch[k], { site: si, kind, unit: batch[k][si][kind] }); break; }
                }
            }
        }
    } else {
        // Sensibilidade: cada candidata sozinha, a partir da exata (em paralelo).
        phase = 'sens';
        const jobs = [];
        for (let si = 0; si < net.sites.length; si++) {
            for (const kind of ['mul', 'add']) {
                for (const c of P.cands[si][kind]) {
                    const next = withSlot(P.exact, si, kind, c.name);
                    const saving = siteCost(si, null) - siteCost(si, next[si]);
                    if (saving > 0) jobs.push({ site: si, kind, unit: c.name, saving, next });
                }
            }
        }
        const exactBase = copy(P.exact);
        const rs = await mapLimit(jobs, engine.size, (j) => tryAssign(j.next, exactBase));
        phaseMs.sens = Date.now() - t0;
        const singles = jobs.map((j, k) => ({ ...j, r: rs[k] })).filter((j) => j.r.feasible)
            .map(({ next, r, ...j }) => ({ ...j, extra: Math.max(0, r.wrong - P.exactWrong) }));
        // Trocas em ordem de economia por imagem errada a mais; cada uma conferida com as já aceitas.
        singles.sort((a, b) => b.saving / (b.extra + 1) - a.saving / (a.extra + 1) || b.saving - a.saving);
        phase = 'comb';
        for (const m of singles) {
            const next = withSlot(cur, m.site, m.kind, m.unit);
            if (siteCost(m.site, next[m.site]) >= siteCost(m.site, cur[m.site])) continue;
            await new Promise((r) => setTimeout(r, 0));
            if ((await tryAssign(next, copy(cur))).feasible) accept(next, m);
        }
    }

    const best = cur;
    const fin = await engine.run(best, { base: best });
    const res = {
        heuristic, objective: P.objective, maxDrop, maxWrong, workers: engine.size,
        exact: { cost: exactCost, wrongVal: P.exactWrong, accVal: 1 - P.exactWrong / P.n },
        best: { assign: best, cost: total(best), wrongVal: fin.wrong, accVal: 1 - fin.wrong / P.n, saving: 1 - total(best) / exactCost },
        evals, images, points, trace, ms: Date.now() - t0, phaseMs,
    };
    // Teste: só no fim, para a exata e o ponto escolhido.
    if (P.test) {
        const ex = P.test.run(P.exact, { record: true }), b = P.test.run(best);
        res.exact.accTest = 1 - ex.wrong / P.test.set.n;
        res.best.accTest = 1 - b.wrong / P.test.set.n;
    }
    res.front = pareto(points.filter((p) => p.feasible).map((p) => ({ ...p, err: p.wrong }))).map((p) => ({ ...p, accVal: 1 - p.wrong / P.n }));
    return res;
}
