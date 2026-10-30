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
import { runHeuristic, newContext, paretoPoints } from './heuristics.js';

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

/**
 * Amostra estratificada de um conjunto (decodeTestSet): o mesmo número de imagens de cada classe (n / classes),
 * sorteadas com semente fixa dentro de cada classe e na ordem do arquivo. Com n >= set.n, o próprio conjunto.
 *
 * As primeiras imagens de cada classe (a versão anterior) são as mais fáceis nos arquivos de validação: a rede exata
 * acertava 100% das 250 primeiras da MiniLenet no MNIST, contra 99,3% na validação inteira, e a busca não via os
 * erros que as unidades aproximadas causam nas imagens difíceis (a validação inteira reprovava o ponto escolhido).
 */
export function stratified(set, n, classes, seed = 2026) {
    if (!n || n >= set.n) return set;
    const per = Math.max(1, Math.floor(n / classes));
    const by = Array.from({ length: classes }, () => []);
    for (let k = 0; k < set.n; k++) by[set.labels[k]]?.push(k);
    const R = rng(seed), keep = [];
    for (const list of by) {
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        keep.push(...list.slice(0, per));
    }
    keep.sort((x, y) => x - y);
    const labels = new Uint8Array(keep.length), images = new Uint8Array(keep.length * set.size);
    keep.forEach((k, i) => { labels[i] = set.labels[k]; images.set(set.images.subarray(k * set.size, (k + 1) * set.size), i * set.size); });
    return { ...set, n: keep.length, labels, images };
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
export function initMessage(netJson, valBuf, synth, trees, sample = 0) {
    const used = synth.designs.filter((d) => (d.cfg.kind === 'mul' && d.cfg.width === 8) || (d.cfg.kind === 'add' && d.cfg.width === 32));
    return { type: 'init', net: netJson, buf: valBuf, designs: used.map((d) => ({ name: d.name, cfg: d.cfg })), trees, sample };
}
/** Tratador das mensagens de um worker de avaliação (o mesmo no navegador e no Node). */
export function evalHandler() {
    let ev = null;
    return (m) => {
        if (m.type === 'init') {
            const net = decodeNet(m.net), ds = net.dataset;
            const set = stratified(decodeTestSet(m.buf, { ...ds, n: ds.val.n }), m.sample, net.classes);
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
    // A busca usa uma amostra estratificada da validação (o.sample imagens; todas, sem o.sample); o ponto escolhido é
    // conferido no fim na validação inteira e no teste.
    const valSet = stratified(o.val, o.sample, net.classes);
    const val = new Evaluator(net, valSet, trees, unitOf);
    const fullVal = valSet !== o.val ? new Evaluator(net, o.val, trees, unitOf) : null;
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
    return { net, objective, target, trees, cm, lib, val, fullVal, test, exact, exactWrong, cands, metric, sumError, n: valSet.n, sample: valSet.n, valN: o.val.n };
}

// Teto de economia -------------------------------------------------------------------------------------------------
// Quanto a aproximação das unidades pode economizar, no máximo, sem olhar a acurácia: a fração do custo da rede exata
// que está nos multiplicadores e somadores das camadas com pesos, e o custo da rede com a unidade mais barata em cada
// uma delas. Se o teto é baixo, a economia da busca fica perto dele por causa da arquitetura (registradores,
// endereçamento, multiplexadores e reescala dominam o custo), e não por falta de agressividade da busca.

/**
 * Fração aritmética do custo de uma rede (cm.network(assign)): a soma do custo das unidades de multiplicação e soma
 * das camadas com pesos dividida pelo custo total da rede, no objetivo. Área e LUT pelas unidades instanciadas
 * (contagem vezes o custo da unidade); energia pela energia das operações.
 */
export function arithmeticShare(cm, assign, objective) {
    const R = cm.network(assign);
    let arith = 0;
    for (const l of R.layers) {
        if (l.site === null) continue;
        const c = l.result.cost;
        if (objective === 'energy') { arith += c.energy.ops; continue; }
        for (const u of c.units) if (u.cls === 'mul' || u.cls === 'add') arith += objective === 'luts' ? u.luts : u.area;
    }
    const total = R.totals[objective];
    return { arith, total, share: total > 0 ? arith / total : 0 };
}

/**
 * Teto de economia: para cada camada com pesos, o multiplicador (com o somador exato) e o somador (com o
 * multiplicador exato) de menor custo da camada entre as unidades dadas, e a rede com os dois juntos. A combinação dos
 * dois melhores é uma aproximação do melhor par (o custo de um par não é a soma exata das duas trocas).
 * @param {object} cm modelo de custo (costModel)
 * @param {number} nSites número de camadas com pesos
 * @param {(si: number, kind: 'mul'|'add') => string[]} unitsOf unidades candidatas de cada camada
 * @param {string} objective 'area' | 'luts' | 'energy'
 * @returns {{exact: number, ceiling: number, mulOnly: number, addOnly: number, saving: number, savingMul: number,
 *            savingAdd: number, assign: object[], share: number, layers: object[]}}
 */
export function savingCeiling(cm, nSites, unitsOf, objective) {
    const metric = (x) => x[objective];
    const exactAssign = Array.from({ length: nSites }, () => ({ mul: null, add: null }));
    const total = (a) => metric(cm.network(a).totals);
    const exact = total(exactAssign);
    const best = [], layers = [];
    for (let si = 0; si < nSites; si++) {
        const base = metric(cm.site(si, null, null));
        const pick = (kind) => {
            let b = { name: null, cost: base };
            for (const name of unitsOf(si, kind)) {
                const c = metric(cm.site(si, kind === 'mul' ? name : null, kind === 'add' ? name : null));
                if (c < b.cost - 1e-9) b = { name, cost: c };
            }
            return b;
        };
        const m = pick('mul'), a = pick('add');
        const both = metric(cm.site(si, m.name, a.name));
        best.push({ mul: m.name, add: a.name });
        layers.push({ site: si, exact: base, mul: m.name, mulCost: m.cost, add: a.name, addCost: a.cost, both, saving: base > 0 ? 1 - both / base : 0 });
    }
    const ceiling = total(best);
    const mulOnly = total(best.map((b) => ({ mul: b.mul, add: null })));
    const addOnly = total(best.map((b) => ({ mul: null, add: b.add })));
    const sh = arithmeticShare(cm, exactAssign, objective);
    return { exact, ceiling, mulOnly, addOnly, saving: 1 - ceiling / exact, savingMul: 1 - mulOnly / exact, savingAdd: 1 - addOnly / exact, assign: best, share: sh.share, layers };
}

/** Teto de economia entre as candidatas da busca (P.cands, da preparação). */
export function searchCeiling(P) {
    return savingCeiling(P.cm, P.net.sites.length, (si, kind) => P.cands[si][kind].map((c) => c.name), P.objective);
}

// Modelo estático ---------------------------------------------------------------------------------------------------
// A busca híbrida estima a queda de acurácia sem classificar: o erro de cada camada (o erro RMS da soma de uma saída,
// sumError, com os operandos reais e a estrutura das diretivas) convertido em LSB da saída pela escala do requant da
// camada, e uma curva erro → queda de acurácia por camada, calibrada com trocas isoladas classificadas. A queda de uma
// combinação é a soma das curvas das camadas.

const MUL_EXACT = 'MUL8 exato', ADD_EXACT = 'ADD32 exato';
const unitName = (kind, name) => name ?? (kind === 'mul' ? MUL_EXACT : ADD_EXACT);
const slotName = (name) => (name === MUL_EXACT || name === ADD_EXACT ? null : name);

/**
 * Erro estático por camada: errLsb(si, mul, add) é o erro RMS da soma de uma saída da camada si com o multiplicador e
 * o somador (null: exato), vezes a escala do requant (com escala por canal, a média quadrática das escalas), com cache.
 */
export function staticModel(P) {
    if (P.static) return P.static;
    const scale = P.net.sites.map((l) => {
        if (!l.rq.q32) return Math.abs(l.rq.M);
        const m = l.rq.m;
        let s = 0;
        for (let i = 0; i < m.length; i++) s += (m[i] / 4294967296) ** 2;
        return Math.sqrt(s / m.length);
    });
    const cache = new Map();
    const errLsb = (si, mul, add) => {
        if (!mul && !add) return 0;
        const k = `${si}|${mul ?? ''}|${add ?? ''}`;
        if (!cache.has(k)) cache.set(k, P.sumError(si, mul ?? null, add ?? null) * scale[si]);
        return cache.get(k);
    };
    /** Erro de cada camada de uma configuração (assign: [{mul, add}]). */
    const errors = (assign) => assign.map((a, si) => errLsb(si, a?.mul ?? null, a?.add ?? null));
    P.static = { scale, errLsb, errors };
    return P.static;
}

/**
 * Curva monótona erro → queda: regressão isotônica (pool adjacent violators) dos pontos medidos, com a origem fixa e
 * quedas negativas (ruído: uma unidade não melhora a rede de propósito) levadas a zero, e interpolação linear entre os
 * pontos. Depois do último ponto, a reta da origem ao último ponto, ou a do último trecho, a mais inclinada (estimar
 * a mais é o lado seguro).
 */
export function monotoneCurve(pts) {
    const s = [...pts].filter((p) => Number.isFinite(p.err)).sort((a, b) => a.err - b.err);
    // Blocos de PAV: cada um com a soma das quedas e o número de pontos.
    const blocks = [];
    for (const p of s) {
        blocks.push({ sum: Math.max(0, p.drop), n: 1, err: [p.err] });
        while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).n > blocks.at(-1).sum / blocks.at(-1).n) {
            const b = blocks.pop(), a = blocks.at(-1);
            a.sum += b.sum; a.n += b.n; a.err.push(...b.err);
        }
    }
    const xs = [0], ys = [0];
    for (const b of blocks) for (const e of b.err) {
        const y = b.sum / b.n;
        if (e === xs.at(-1)) ys[ys.length - 1] = Math.max(ys.at(-1), y);
        else { xs.push(e); ys.push(y); }
    }
    const n = xs.length;
    const tail = n < 2 ? 0 : Math.max(ys[n - 1] / xs[n - 1], (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]));
    const f = (e) => {
        if (e <= 0 || n < 2) return 0;
        if (e >= xs[n - 1]) return ys[n - 1] + tail * (e - xs[n - 1]);
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= e) lo = m; else hi = m; }
        return ys[lo] + ((ys[hi] - ys[lo]) * (e - xs[lo])) / (xs[hi] - xs[lo]);
    };
    f.xs = xs; f.ys = ys; f.tail = tail;
    return f;
}

/**
 * Calibração: em cada camada, as trocas isoladas (o multiplicador ou o somador da camada, o resto exato) espalhadas
 * pelo erro estático, perSite por camada (sempre a de maior erro, para a curva não depender de extrapolação nas
 * unidades sozinhas), classificadas na amostra de validação. Depois, o refinamento: entre dois pontos vizinhos da
 * mesma camada cuja queda salta mais que refineDrop pontos percentuais, com o de baixo abaixo de nearDrop (a faixa que
 * decide a viabilidade), a troca isolada ainda não medida de erro mais perto da média geométrica dos dois; até refine
 * pontos a mais por camada. Cada medida para quando a queda passa de capDrop (a queda fica então em capDrop, um limite
 * inferior).
 * @returns {{curves: function[], points: object[], ms: number}}
 */
export async function calibrateCurves(P, engine = localEngine(P), { perSite = 8, refine = 4, refineDrop = 1, nearDrop = 3, capDrop = 20, onPoint = null } = {}) {
    const t0 = Date.now();
    const S = staticModel(P);
    const maxWrong = P.exactWrong + Math.ceil((capDrop * P.n) / 100);
    const base = P.exact.map((x) => ({ ...x }));
    const singles = P.net.sites.map((l, si) => {
        const list = [];
        for (const kind of ['mul', 'add']) for (const c of P.cands[si][kind]) {
            const a = { mul: kind === 'mul' ? c.name : null, add: kind === 'add' ? c.name : null };
            list.push({ si, kind, unit: c.name, a, err: S.errLsb(si, a.mul, a.add) });
        }
        return list.filter((x) => x.err > 0).sort((x, y) => x.err - y.err);
    });
    const points = [];
    const measure = (jobs) => mapLimit(jobs, engine.size, async (j) => {
        const assign = P.exact.map((x, i) => (i === j.si ? { ...j.a } : { ...x }));
        const r = await engine.run(assign, { maxWrong, base });
        const drop = r.feasible ? ((r.wrong - P.exactWrong) * 100) / P.n : capDrop;
        const p = { site: j.si, kind: j.kind, unit: j.unit, err: j.err, drop, capped: !r.feasible, seen: r.seen };
        j.done = true;
        points.push(p);
        onPoint?.({ phase: 'calib', ...p });
        return p;
    });
    await measure(singles.flatMap((list) => spread(list, perSite)));
    const extra = singles.map(() => 0);
    for (;;) {
        const jobs = [];
        singles.forEach((list, si) => {
            if (extra[si] >= refine) return;
            const pts = points.filter((p) => p.site === si).sort((x, y) => x.err - y.err);
            const chain = [{ err: 0, drop: 0 }, ...pts];
            for (let k = 1; k < chain.length; k++) {
                const lo = chain[k - 1], hi = chain[k];
                if (hi.drop - lo.drop <= refineDrop || lo.drop >= nearDrop) continue;
                const mid = lo.err > 0 ? Math.sqrt(lo.err * hi.err) : hi.err / 2;
                const c = list.filter((x) => !x.done && x.err > lo.err && x.err < hi.err).sort((x, y) => Math.abs(Math.log(x.err / mid)) - Math.abs(Math.log(y.err / mid)))[0];
                if (c) { jobs.push(c); c.done = true; extra[si]++; break; }
            }
        });
        if (!jobs.length) break;
        jobs.forEach((j) => { j.done = false; });
        await measure(jobs);
    }
    const curves = P.net.sites.map((_, si) => monotoneCurve(points.filter((p) => p.site === si)));
    return { curves, points, ms: Date.now() - t0 };
}

/** Queda estimada (pontos percentuais) de uma configuração: a soma das curvas das camadas. */
export function estimateDrop(P, curves, assign) {
    const e = staticModel(P).errors(assign);
    let d = 0;
    for (let si = 0; si < e.length; si++) d += curves[si](e[si]);
    return d;
}

/**
 * Fronteira de Pareto em custo contra a queda medida (pontos com p.measured), em ordem de custo.
 */
function paretoMeasured(points) {
    const s = [...points].sort((a, b) => a.score - b.score || a.measured.drop - b.measured.drop);
    const out = [];
    let best = Infinity;
    for (const p of s) if (p.measured.drop < best - 1e-12) { out.push(p); best = p.measured.drop; }
    return out;
}

/**
 * O problema da busca estática para js/axc/heuristics.js: dois grupos por camada com pesos (o multiplicador e o
 * somador), na ordem da rede; o custo é o do modelo de síntese (por camada, com cache) e a queda, a estimada pelas
 * curvas. O erro escalar (para a eficiência e a fronteira) é a queda estimada mais um desempate pequeno pela soma
 * dos erros em LSB (trocas que as curvas dão como de queda zero ainda ficam ordenadas pelo erro).
 */
export function nnProblem(P, curves, { maxDrop = 1 } = {}) {
    const S = staticModel(P);
    const sites = P.net.sites;
    const groups = [];
    sites.forEach((l, si) => {
        for (const kind of ['mul', 'add']) {
            const exact = unitName(kind, null);
            const own = (name) => S.errLsb(si, kind === 'mul' ? name : null, kind === 'add' ? name : null);
            const list = P.cands[si][kind].map((c) => ({ name: c.name, own: own(c.name) })).sort((a, b) => a.own - b.own);
            groups.push({ key: `${l.name}.${kind}`, label: `${l.name} ${kind === 'mul' ? '×' : '+'}`, cls: kind, W: kind === 'mul' ? 8 : 32, line: si, site: si, kind, exact, cands: [exact, ...list.map((x) => x.name)], ownOf: new Map([[exact, 0], ...list.map((x) => [x.name, x.own])]) });
        }
    });
    const assignOf = (c) => sites.map((_, si) => ({ mul: slotName(c[2 * si]), add: slotName(c[2 * si + 1]) }));
    const total = (assign) => P.metric(P.cm.network(assign).totals);
    return {
        groups,
        assignOf,
        seqOrder: groups.map((_, i) => i),
        key: (c) => c.join('|'),
        cost: (c) => total(assignOf(c)),
        evaluate: (c, key) => {
            const assign = assignOf(c);
            const errs = S.errors(assign);
            let drop = 0, tie = 0;
            errs.forEach((e, si) => { drop += curves[si](e); tie += e; });
            const units = [];
            assign.forEach((a, si) => { if (a.mul) units.push(`${sites[si].name} ×: ${a.mul}`); if (a.add) units.push(`${sites[si].name} +: ${a.add}`); });
            return { key, assign, cost: total(assign), score: total(assign), drop, errs, err: drop + 1e-6 * tie, feasible: drop <= maxDrop + 1e-9, units };
        },
        mark: (p) => ({ drop: p.drop }),
    };
}

/** Heurísticas da busca híbrida, na ordem da página HLS (a exaustiva e a aleatória não fazem parte da busca das redes). */
export const HYBRID_HEURISTICS = ['local', 'efficiency', 'sequential', 'tabu', 'grasp', 'ga'];

/**
 * Busca híbrida: calibração das curvas (trocas isoladas classificadas), busca com uma heurística no modelo estático
 * (milissegundos por ponto) e verificação por classificação dos melhores pontos.
 *
 *   verificação  só os pontos da fronteira estimada (de tudo o que foi visitado) dentro do limite, do mais barato
 *                para o mais caro, classificados na amostra (em lotes do tamanho do motor); o primeiro que passa no
 *                limite é conferido na validação inteira (com amostra) e, se não passar, segue o próximo (o reparo).
 *                Nenhum ponto dominado no modelo estático é verificado; o resultado traz também a fronteira medida
 *                (measuredFront), onde o escolhido está. Até maxVerify pontos (25 por padrão). Os verifyFront pontos mais
 *                baratos da fronteira estimada (custo × queda) também são classificados, para a tabela da página.
 *   rodadas      se os verificados de uma rodada passam do limite, a heurística roda de novo com o limite estimado
 *                apertado (rounds, frações do limite real: 1, 0,75, 0,5 e 0,25 por padrão) e verifica até
 *                verifyPerRound pontos novos (a última rodada, o que sobra de maxVerify).
 *
 * onPoint(ev) recebe cada ponto: { phase: 'calib' | 'search' | 'verify', cost, drop, units, feasible, ... }; na
 * busca, drop é a queda estimada; na calibração e na verificação, a medida (com est, a estimada, na verificação).
 *
 * @param {object} P preparação (prepareSearch)
 * @param {{heuristic?: string, maxDrop?: number, curves?: object, perSite?: number, maxVerify?: number,
 *          verifyFront?: number, onPoint?: function, progress?: function}} o curves: calibração já feita (reaproveitada
 *          entre buscas com a mesma preparação; sem ela, calibrateCurves); o resto vai para a heurística
 * @param {object} engine motor de avaliação
 */
export async function hybridSearch(P, o = {}, engine = localEngine(P)) {
    const t0 = Date.now();
    const heuristic = o.heuristic ?? 'local';
    if (!HYBRID_HEURISTICS.includes(heuristic)) throw new Error(`heurística desconhecida: ${heuristic} (${HYBRID_HEURISTICS.join(', ')})`);
    const maxDrop = o.maxDrop ?? 1;
    const onPoint = o.onPoint ?? (() => {});
    const progress = o.progress ?? (() => {});
    const phaseMs = {};
    // 1. Calibração (uma vez por preparação).
    let calib = o.curves ?? P.calib ?? null;
    if (!calib) {
        let n = 0;
        calib = await calibrateCurves(P, engine, { perSite: o.perSite ?? 8, refine: o.refine ?? 4, onPoint: (ev) => { n++; onPoint(ev); progress({ phase: 'calib', evals: n, ms: Date.now() - t0 }); } });
        P.calib = calib;
    }
    phaseMs.calib = Date.now() - t0;
    // 2 e 3. Busca no modelo estático e verificação por classificação, em rodadas: se os pontos verificados de uma
    // rodada passam do limite na classificação (o modelo é otimista perto do limite), a heurística roda de novo com
    // um limite estimado mais apertado (rounds: frações do limite real) e os novos pontos são verificados. A busca
    // estática leva segundos; a classificação é a parte cara, por isso cada rodada verifica poucos pontos
    // (verifyPerRound) e o total fica em maxVerify.
    const exactCost = P.metric(P.cm.network(P.exact).totals);
    const exactState = { score: exactCost, drop: 0, units: [] };
    const steps = [];
    // Primeiro passo do passo a passo: a calibração (as trocas isoladas medidas e as curvas por camada).
    steps.push({ kind: 'calib', n: calib.points.length, sites: P.net.sites.map((l, si) => ({ name: l.name, n: calib.points.filter((q) => q.site === si).length, max: Math.max(0, ...calib.points.filter((q) => q.site === si).map((q) => q.drop)) })), state: exactState });
    const maxWrong = P.exactWrong + Math.floor((maxDrop * P.n) / 100 + 1e-9);
    let fullLimit = null;
    if (P.fullVal) {
        const exW = P.fullVal.run(P.exact, { record: true }).wrong;
        fullLimit = exW + Math.floor((maxDrop * P.fullVal.set.n) / 100 + 1e-9);
    }
    const exactBase = P.exact.map((x) => ({ ...x }));
    const all = new Map(); // chave → ponto (o primeiro objeto avaliado com a chave guarda a medida)
    const measure = async (p) => {
        if (p.measured) return p;
        const r = await engine.run(p.assign, { maxWrong, base: exactBase });
        p.measured = { wrong: r.wrong, seen: r.seen, drop: ((r.wrong - P.exactWrong) * 100) / P.n, ok: r.feasible };
        onPoint({ phase: 'verify', cost: p.score, drop: p.measured.drop, est: p.drop, feasible: r.feasible, full: r.feasible || r.seen === P.n, units: p.units });
        progress({ phase: 'verify', evals: all.size, ms: Date.now() - t0 });
        return p;
    };
    const rounds = o.rounds ?? [1, 0.75, 0.5, 0.25];
    const maxVerify = o.maxVerify ?? 25, perRound = o.verifyPerRound ?? Math.max(engine.size, 6);
    let chosen = null, verified = 0, repaired = 0, nv = 0, error = null, last = 0;
    phaseMs.search = 0; phaseMs.verify = 0;
    /** Passo de verificação (na ordem em que a decisão é tomada). */
    const vstep = (p, extra = {}) => steps.push({ kind: 'verify', n: ++nv, label: p.units.join(', ') || 'exato', score: p.score, drop: p.drop, measured: p.measured.drop, ok: p.measured.ok, capped: !p.measured.ok, state: { score: p.score, drop: p.drop, units: p.units }, ...extra });
    let round = 0;
    for (; round < rounds.length && !chosen && verified < maxVerify; round++) {
        const lim = maxDrop * rounds[round];
        const t1 = Date.now();
        const Pn = nnProblem(P, calib.curves, { maxDrop: lim });
        const ctx = newContext({
            progress: (n, p) => {
                if (all.has(p.key)) return;
                all.set(p.key, p);
                onPoint({ phase: 'search', n: all.size, cost: p.score, drop: p.drop, feasible: p.drop <= maxDrop + 1e-9, units: p.units });
                const now = Date.now();
                if (now - last > 100) { last = now; progress({ phase: 'search', evals: all.size, ms: now - t0 }); }
            },
        });
        ctx.steps = steps;
        if (round > 0) steps.push({ kind: 'round', n: round + 1, limit: lim, frac: rounds[round], state: exactState });
        try { runHeuristic(heuristic, Pn, ctx, { granularity: 'class', ...o }); } catch (e) { error = e.message; }
        phaseMs.search += Date.now() - t1;
        // Ordem da verificação: só os pontos da fronteira estimada de tudo o que foi visitado até aqui (nesta rodada e
        // nas anteriores) com a queda estimada dentro do limite da rodada, do mais barato para o mais caro; cada falha
        // leva a um ponto de queda estimada estritamente menor. Um ponto dominado no modelo estático nunca é
        // verificado: se a fronteira se esgota sem um ponto que passe, a rodada seguinte aperta o limite estimado.
        const t2 = Date.now();
        const front = paretoPoints([...all.values()]);
        const lastRound = round === rounds.length - 1;
        const cands = front.filter((p) => p.drop <= lim + 1e-9 && !p.measured).slice(0, Math.min(maxVerify - verified, lastRound ? Infinity : perRound));
        for (let b = 0; b < cands.length && !chosen; b += engine.size) {
            const batch = cands.slice(b, b + engine.size);
            await mapLimit(batch, engine.size, measure);
            verified += batch.length;
            for (const p of batch) {
                if (!p.measured.ok) { vstep(p); continue; }
                if (P.fullVal) {
                    const w = P.fullVal.run(p.assign).wrong;
                    p.measured.wrongFull = w;
                    p.measured.fullOk = w <= fullLimit;
                    if (w > fullLimit) { repaired++; vstep(p, { ok: false, fullRejected: true, wrongFull: w, fullLimit }); continue; }
                }
                vstep(p);
                chosen = p;
                break;
            }
        }
        phaseMs.verify += Date.now() - t2;
    }
    // Todos os pontos visitados nas rodadas, com a viabilidade estimada no limite real.
    const allPts = [...all.values()];
    for (const p of allPts) p.feasible = p.drop <= maxDrop + 1e-9;
    const front = paretoPoints(allPts);
    const t3 = Date.now();
    // Para a tabela: os pontos da fronteira estimada perto do limite (até o dobro dele), os mais baratos.
    await mapLimit(front.filter((p) => p.score < exactCost && !p.measured && p.drop <= 2 * maxDrop).slice(0, o.verifyFront ?? 8), engine.size, measure);
    // Um ponto medido para a tabela pode passar e custar menos que o escolhido: ele passa a ser o escolhido (com
    // amostra, depois de conferido na validação inteira).
    for (const p of allPts.filter((q) => q.measured?.ok && q.measured.fullOk === undefined && (!chosen || q.score < chosen.score)).sort((x, y) => x.score - y.score)) {
        if (P.fullVal) {
            const w = P.fullVal.run(p.assign).wrong;
            p.measured.wrongFull = w;
            p.measured.fullOk = w <= fullLimit;
            if (!p.measured.fullOk) continue;
        }
        chosen = p;
        vstep(p, { late: true });
        break;
    }
    phaseMs.verify += Date.now() - t3;
    // Fronteira medida: os pontos classificados que passam no limite (na amostra e, quando conferidos, na validação
    // inteira) e a rede exata, em custo contra a queda medida. Os que não passam ficam de fora (a queda deles é só um
    // limite inferior, porque a classificação para ao passar do limite). O escolhido é o ponto mais barato dela.
    const measuredFront = paretoMeasured([
        { score: exactCost, assign: P.exact.map((x) => ({ ...x })), units: [], drop: 0, measured: { drop: 0, ok: true, exact: true } },
        ...allPts.filter((p) => p.measured?.ok && p.measured.fullOk !== false),
    ]);
    // O exato, se nada passou.
    const bestAssign = chosen ? chosen.assign : P.exact.map((x) => ({ ...x }));
    const fin = await engine.run(bestAssign, { base: bestAssign });
    const total = (a) => P.metric(P.cm.network(a).totals);
    const res = {
        heuristic, hybrid: true, objective: P.objective, maxDrop, maxWrong, workers: engine.size, sample: P.sample, repaired, error, rounds: round,
        exact: { cost: exactCost, wrongVal: P.exactWrong, accVal: 1 - P.exactWrong / P.n },
        best: { assign: bestAssign, cost: total(bestAssign), wrongVal: fin.wrong, accVal: 1 - fin.wrong / P.n, saving: 1 - total(bestAssign) / exactCost, estDrop: chosen?.drop ?? 0 },
        calib: calib.points, evals: allPts.length, verified, steps,
        points: allPts.map((p) => ({ assign: p.assign, cost: p.score, drop: p.drop, feasible: p.feasible, measured: p.measured ?? null })),
        front: front.map((p) => ({ assign: p.assign, cost: p.score, drop: p.drop, feasible: p.feasible, units: p.units, measured: p.measured ?? null, saving: 1 - p.score / exactCost })),
        measuredFront: measuredFront.map((p) => ({ assign: p.assign, cost: p.score, drop: p.drop, units: p.units, measured: p.measured, saving: 1 - p.score / exactCost })),
        ms: Date.now() - t0, phaseMs,
    };
    if (P.fullVal) {
        const ex = P.fullVal.run(P.exact, { record: true }), b = P.fullVal.run(bestAssign);
        res.exact.accValFull = 1 - ex.wrong / P.fullVal.set.n;
        res.best.accValFull = 1 - b.wrong / P.fullVal.set.n;
        res.valN = P.fullVal.set.n;
    }
    if (P.test) {
        const ex = P.test.run(P.exact, { record: true }), b = P.test.run(bestAssign);
        res.exact.accTest = 1 - ex.wrong / P.test.set.n;
        res.best.accTest = 1 - b.wrong / P.test.set.n;
    }
    return res;
}

/**
 * Busca.
 * @param {object} P preparação (prepareSearch)
 * @param {{heuristic?: string, maxDrop?: number, progress?: function, onPoint?: function}} o maxDrop: queda máxima de
 *   acurácia na validação (pontos percentuais); onPoint({phase, cost, wrong, feasible, full}) a cada configuração
 *   classificada
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
        o.onPoint?.({ phase, cost: p.cost, wrong: p.wrong, feasible: p.feasible, full: p.full });
        progress({ evals, images, phase, cost: bestCost / exactCost, ms: Date.now() - t0 });
        return r;
    };
    const accepted = [];
    const accept = (next, why) => {
        accepted.push({ site: why.site, kind: why.kind, prev: cur[why.site][why.kind] });
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

    // Escolha: o ponto viável mais barato entre os avaliados (qualquer ponto avaliado é uma rede válida; o fim do
    // caminho da heurística fica em last). Com amostra, os viáveis na amostra são conferidos na validação inteira, do
    // mais barato para o mais caro, até maxVerify deles, e fica o primeiro que cabe no limite (o reparo). A versão
    // anterior desfazia as últimas trocas aceitas até caber, e o ponto resultante podia nem ter sido avaliado: no
    // gráfico, ficava coberto por pontos viáveis mais baratos.
    const last = cur;
    const byCost = points.filter((p) => p.feasible).sort((a, b) => a.cost - b.cost);
    let repaired = 0, chosen = null;
    if (P.fullVal) {
        phase = 'repair';
        const fv = P.fullVal, N = fv.set.n;
        const exW = fv.run(P.exact, { record: true }).wrong;
        const limit = exW + Math.floor((maxDrop * N) / 100 + 1e-9);
        for (const p of byCost.slice(0, o.maxVerify ?? 25)) {
            const r = fv.run(p.assign, { maxWrong: limit });
            p.fullWrong = r.feasible ? r.wrong : null;
            p.fullOk = r.feasible;
            progress({ evals, images, phase, cost: p.cost / exactCost, ms: Date.now() - t0 });
            await new Promise((res) => setTimeout(res, 0));
            if (r.feasible) { chosen = p; break; }
            repaired++;
        }
        // Nenhum ponto visitado passou (a sequencial aceita cada troca no limite da amostra, então todos os seus
        // viáveis ficam no limite): a partir do mais barato reprovado, a cada passo, volta para a exata o
        // multiplicador ou o somador de uma camada; se alguma volta cabe na validação inteira, fica a mais barata
        // delas; senão, segue com a volta que dá menos imagens erradas. Cada configuração testada entra nos pontos.
        let budget = Math.max(0, (o.maxVerify ?? 25) - repaired - (chosen ? 1 : 0));
        let from = chosen ? null : byCost[0] ?? null;
        while (!chosen && from && budget > 0) {
            const opts = [];
            from.assign.forEach((a, si) => { for (const kind of ['mul', 'add']) if (a[kind]) opts.push(from.assign.map((x, j) => (j === si ? { ...x, [kind]: null } : { ...x }))); });
            if (!opts.length) break;
            const tried = [];
            for (const assign of opts.map((a) => ({ a, c: total(a) })).sort((x, y) => x.c - y.c)) {
                if (budget-- <= 0) break;
                const r = fv.run(assign.a, { maxWrong: limit });
                const q = { assign: copy(assign.a), cost: assign.c, wrong: null, feasible: true, full: false, repair: true, fullWrong: r.feasible ? r.wrong : null, fullOk: r.feasible, fullSeen: r.seen, fullWrongSeen: r.wrong };
                points.push(q);
                tried.push(q);
                progress({ evals, images, phase, cost: q.cost / exactCost, ms: Date.now() - t0 });
                await new Promise((res) => setTimeout(res, 0));
                if (r.feasible) { chosen = q; break; }
                repaired++;
            }
            // A volta mais perto de passar: menos erradas por imagem vista (a classificação para no limite).
            from = chosen ? null : tried.sort((x, y) => x.fullWrongSeen / x.fullSeen - y.fullWrongSeen / y.fullSeen)[0] ?? null;
        }
        // Os viáveis mais baratos que o escolhido que ficaram sem conferir (além de maxVerify) são conferidos agora:
        // o escolhido não pode ficar coberto por um ponto viável que passaria.
        if (chosen) {
            for (const p of byCost.filter((x) => x.fullOk === undefined && x.cost < chosen.cost - 1e-9)) {
                const r = fv.run(p.assign, { maxWrong: limit });
                p.fullWrong = r.feasible ? r.wrong : null;
                p.fullOk = r.feasible;
                if (r.feasible) { chosen = p; break; }
                repaired++;
            }
        }
        // A acurácia na amostra dos pontos do reparo (para o gráfico, no mesmo eixo dos outros).
        for (const q of points.filter((x) => x.repair && x.wrong === null)) {
            const r = await engine.run(q.assign, { base: q.assign });
            q.wrong = r.wrong; q.full = true; q.feasible = r.wrong <= maxWrong;
        }
    } else chosen = byCost[0] ?? null;
    cur = chosen ? copy(chosen.assign) : copy(P.exact);
    const best = cur;
    const fin = await engine.run(best, { base: best });
    const res = {
        heuristic, objective: P.objective, maxDrop, maxWrong, workers: engine.size, sample: P.sample, repaired,
        exact: { cost: exactCost, wrongVal: P.exactWrong, accVal: 1 - P.exactWrong / P.n },
        best: { assign: best, cost: total(best), wrongVal: fin.wrong, accVal: 1 - fin.wrong / P.n, saving: 1 - total(best) / exactCost },
        evals, images, points, trace, last, ms: Date.now() - t0, phaseMs,
    };
    // Com a amostra: a validação inteira, para a exata e o ponto escolhido.
    if (P.fullVal) {
        const ex = P.fullVal.run(P.exact, { record: true }), b = P.fullVal.run(best);
        res.exact.accValFull = 1 - ex.wrong / P.fullVal.set.n;
        res.best.accValFull = 1 - b.wrong / P.fullVal.set.n;
        res.valN = P.fullVal.set.n;
    }
    // Teste: só no fim, para a exata e o ponto escolhido.
    if (P.test) {
        const ex = P.test.run(P.exact, { record: true }), b = P.test.run(best);
        res.exact.accTest = 1 - ex.wrong / P.test.set.n;
        res.best.accTest = 1 - b.wrong / P.test.set.n;
    }
    // Fronteira medida: os viáveis na amostra que não foram reprovados na validação inteira, e os aprovados nela
    // (a validação inteira, quando conferida, vale sobre a amostra: um ponto do reparo pode passar do limite na
    // amostra e caber na validação inteira). O escolhido está nela.
    res.front = pareto(points.filter((p) => p.fullOk === true || (p.feasible && p.fullOk !== false)).map((p) => ({ ...p, err: p.wrong }))).map((p) => ({ ...p, accVal: 1 - p.wrong / P.n }));
    return res;
}
