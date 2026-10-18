/**
 * Execução bit a bit do projeto elaborado: os laços mantidos, os trechos e os seus DFGs, exatamente como o hardware
 * gerado os calcularia (mesmos truncamentos, mesmas larguras de memória). Cada operação pode ser trocada pelo modelo
 * funcional de uma unidade aproximada. A execução exata também faz o perfil dos sinais: média e segundo momento de
 * cada nó e uma amostra dos operandos de cada soma, multiplicação, comparação e seleção, que o modelo estático de
 * erro (error.js) usa.
 */
import { ssim, ssimStats } from '../axc/ssim.js';
import { rng } from '../axc/metrics.js';
import { testImage } from '../axc/image.js';
import { typeRange } from './elab.js';

const SAMPLES = 4096;     // amostras dos operandos de cada operação
const SEG_SAMPLES = 2048; // instâncias amostradas de cada trecho (todos os valores de uma execução do trecho)
const SAMPLED = new Set(['add', 'sub', 'mul', 'cmp', 'sel']);

export const wrapTo = (v, bits, signed) => {
    const m = 2 ** bits;
    let r = ((v % m) + m) % m;
    if (signed && r >= m / 2) r -= m;
    return r;
};
const big = (v) => v > 2147483647 || v < -2147483648;
export const bit = (op, a, b) => {
    if (big(a) || big(b)) {
        const A = BigInt(a), B = BigInt(b);
        return Number(op === 'and' ? A & B : op === 'or' ? A | B : A ^ B);
    }
    return op === 'and' ? a & b : op === 'or' ? a | b : a ^ b;
};
export const CMP = { '<': (a, b) => +(a < b), '<=': (a, b) => +(a <= b), '>': (a, b) => +(a > b), '>=': (a, b) => +(a >= b), '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b) };

/** Vetores do kernel que são lidos (entradas): os parâmetros com leitura. */
export function inputArrays(design) {
    const read = new Set();
    for (const seg of design.segments) for (const n of seg.nodes) {
        if (n.op === 'load') read.add(n.array);
        if (n.op === 'in' && n.port) read.add(n.name.split('[')[0]);
    }
    return design.arrays.filter((a) => a.kind === 'param' && read.has(a.name));
}
/** Vetores escritos pelo kernel que são parâmetros (saídas). */
export function outputArrays(design) {
    const wr = new Set();
    for (const seg of design.segments) for (const n of seg.nodes) {
        if (n.op === 'store') wr.add(n.array);
        if (n.op === 'out' && n.port) wr.add(n.name.split('[')[0]);
    }
    return design.arrays.filter((a) => a.kind === 'param' && wr.has(a.name));
}

export const INPUT_SOURCES = ['image', 'uniform', 'own'];

/**
 * Dados de entrada: a imagem de teste da página de unidades, ou uma imagem do usuário (own: {w, h, data}, levada ao
 * tamanho do vetor pelo vizinho mais próximo); vetores de 2 dimensões têm a imagem no tamanho deles e os de 1 dimensão,
 * as linhas da imagem em sequência, na faixa do tipo; ou valores uniformes na faixa do tipo.
 * @returns {Map<string, Float64Array>}
 */
export function makeInputs(design, source = 'image', seed = 2027, own = null) {
    const out = new Map();
    const rand = rng(seed);
    for (const arr of inputArrays(design)) {
        const [lo, hi] = typeRange(arr.type);
        const v = new Float64Array(arr.size);
        if (source === 'image' || (source === 'own' && own)) {
            const w = arr.dims.length === 2 ? arr.dims[1] : Math.min(arr.size, 192);
            const h = arr.dims.length === 2 ? arr.dims[0] : Math.ceil(arr.size / w);
            const img = source === 'own' ? resample(own, w, h) : testImage(w, h);
            // 0..255 vai para a faixa do tipo: com sinal, centrado no zero; mais largo que 8 bits, sem escala.
            for (let k = 0; k < arr.size; k++) {
                const p = img.data[k];
                v[k] = Math.min(hi, Math.max(lo, lo < 0 ? p - 128 : p));
            }
        } else for (let k = 0; k < arr.size; k++) v[k] = lo + Math.floor(rand() * (hi - lo + 1));
        out.set(arr.name, v);
    }
    return out;
}

/** Imagem em tons de cinza levada a w x h pelo vizinho mais próximo. */
function resample(img, w, h) {
    const data = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = img.data[Math.min(img.h - 1, Math.floor((y * img.h) / h)) * img.w + Math.min(img.w - 1, Math.floor((x * img.w) / w))];
    return { w, h, data };
}

/** Programa da execução: índice global de cada nó e as instruções de cada trecho. */
export function compile(design) {
    if (design._prog) return design._prog;
    const index = new Map();
    for (const seg of design.segments) for (const n of seg.nodes) index.set(n.id, index.size);
    const syms = new Map(design.loops.map((l, k) => [l.id, k]));
    const arr = new Map(design.arrays.map((a) => [a.name, a]));
    const aff = (a) => ({ c: a.c, t: Object.entries(a.t).map(([s, v]) => [syms.get(s), v]) });
    const flatOf = (a, idx) => idx.map(aff);
    const progs = new Map();
    for (const seg of design.segments) {
        progs.set(seg, seg.nodes.map((n) => {
            const ins = { n, ix: index.get(n.id), op: n.op, a: n.args.map((x) => (x.n !== undefined ? { ix: index.get(x.n) } : { c: x.c })) };
            if (n.op === 'iv') ins.aff = aff(n.aff);
            if (n.op === 'load' || n.op === 'store') { ins.arr = arr.get(n.array); ins.idx = flatOf(ins.arr, n.idx); }
            if ((n.op === 'in' || n.op === 'out') && n.port) {
                const m = /^(\w+)\[(\d+)\](?:\[(\d+)\])?$/.exec(n.name);
                ins.arr = arr.get(m[1]);
                ins.flat = m[3] !== undefined ? +m[2] * ins.arr.dims[1] + +m[3] : +m[2];
            }
            if (n.op === 'in' && !n.port) ins.from = index.get(n.from);
            if (n.op === 'carryout') ins.to = index.get(n.to);
            if (n.op === 'carry') { ins.initFrom = n.initFrom ? index.get(n.initFrom) : null; ins.initAff = n.initAff ? aff(n.initAff) : null; }
            if (n.op === 'trunc') { ins.bits = n.bits; ins.signed = n.signed; }
            if (n.op === 'sel') {
                const c = n.args[0].n !== undefined ? seg.byId.get(n.args[0].n) : null;
                if (c?.op === 'cmp') ins.cond = { a: c.args.map((x) => (x.n !== undefined ? { ix: index.get(x.n) } : { c: x.c })) };
            }
            return ins;
        }));
    }
    design._prog = { index, syms, progs, size: index.size };
    return design._prog;
}

/**
 * Executa o kernel.
 * @param {object} design elaboração
 * @param {Map<string, Float64Array>} inputs dados das entradas
 * @param {{ops?: Map<string, function>, profile?: boolean, seed?: number}} o ops: função aproximada de cada nó
 * @returns {{mem: Map<string, Float64Array>, written: Map<string, Uint8Array>, stats?: object}}
 */
export function execute(design, inputs, { ops = null, profile = false, seed = 7 } = {}) {
    const P = compile(design);
    const vals = new Float64Array(P.size);
    const carry = new Float64Array(P.size);
    const iter = new Float64Array(design.loops.length);
    const mem = new Map(), written = new Map();
    for (const a of design.arrays) {
        const m = new Float64Array(a.size);
        if (a.kind === 'rom') m.set(a.init);
        else if (inputs?.has(a.name)) m.set(inputs.get(a.name));
        mem.set(a.name, m);
        written.set(a.name, new Uint8Array(a.size));
    }
    const fn = new Array(P.size).fill(null);
    if (ops) for (const [id, f] of ops) if (P.index.has(id)) fn[P.index.get(id)] = f;
    // Perfil: soma e soma dos quadrados de cada nó e amostras (reservatório) dos operandos.
    const cnt = profile ? new Float64Array(P.size) : null;
    const s1 = profile ? new Float64Array(P.size) : null;
    const s2 = profile ? new Float64Array(P.size) : null;
    const samples = profile ? new Map() : null;
    const rand = rng(seed);
    const affv = (a) => { let v = a.c; for (const [s, k] of a.t) v += k * iter[s]; return v; };
    const arg = (x) => (x.ix !== undefined ? vals[x.ix] : x.c);
    const flat = (ins) => (ins.idx.length === 2 ? affv(ins.idx[0]) * ins.arr.dims[1] + affv(ins.idx[1]) : affv(ins.idx[0]));
    const sample = (ins, rec) => {
        let s = samples.get(ins.ix);
        if (!s) { s = { seen: 0, rows: [] }; samples.set(ins.ix, s); }
        s.seen++;
        if (s.rows.length < SAMPLES) s.rows.push(rec);
        else { const j = Math.floor(rand() * s.seen); if (j < SAMPLES) s.rows[j] = rec; }
    };

    const segRows = profile ? new Map() : null;
    function runSeg(seg) {
        const prog = P.progs.get(seg);
        for (const ins of prog) {
            const a = ins.a;
            let v;
            switch (ins.op) {
                case 'in': v = ins.from !== undefined ? vals[ins.from] : mem.get(ins.arr.name)[ins.flat]; break;
                case 'iv': v = affv(ins.aff); break;
                case 'carry': v = carry[ins.ix]; break;
                case 'carryout': carry[ins.to] = arg(a[0]); continue;
                case 'load': v = mem.get(ins.arr.name)[flat(ins)]; break;
                case 'store': case 'out': {
                    const k = ins.op === 'store' ? flat(ins) : ins.flat;
                    const t = ins.arr.type;
                    mem.get(ins.arr.name)[k] = wrapTo(arg(a[0]), t.bits, t.signed);
                    written.get(ins.arr.name)[k] = 1;
                    continue;
                }
                case 'add': v = fn[ins.ix] ? fn[ins.ix](arg(a[0]), arg(a[1])) : arg(a[0]) + arg(a[1]); break;
                case 'sub': v = fn[ins.ix] ? fn[ins.ix](arg(a[0]), arg(a[1])) : arg(a[0]) - arg(a[1]); break;
                case 'mul': v = fn[ins.ix] ? fn[ins.ix](arg(a[0]), arg(a[1])) : arg(a[0]) * arg(a[1]); break;
                case 'shl': v = arg(a[0]) * 2 ** a[1].c; break;
                case 'shr': v = Math.floor(arg(a[0]) / 2 ** a[1].c); break;
                case 'and': case 'or': case 'xor': v = bit(ins.op, arg(a[0]), arg(a[1])); break;
                case 'not': v = -arg(a[0]) - 1; break;
                case 'cmp': v = CMP[ins.n.cond](arg(a[0]), arg(a[1])); break;
                case 'sel': v = arg(a[0]) ? arg(a[1]) : arg(a[2]); break;
                case 'trunc': v = wrapTo(arg(a[0]), ins.bits, ins.signed); break;
                default: throw new Error(`operação ${ins.op} sem execução`);
            }
            vals[ins.ix] = v;
            if (profile) {
                cnt[ins.ix]++; s1[ins.ix] += v; s2[ins.ix] += v * v;
                if (SAMPLED.has(ins.op)) {
                    const rec = a.map(arg);
                    rec.push(v);
                    if (ins.cond) rec.push(...ins.cond.a.map(arg));
                    sample(ins, rec);
                }
            }
        }
        if (profile && prog.length) {
            // Instância do trecho (reservatório): os valores exatos de todos os nós numa mesma execução.
            let s = segRows.get(seg);
            if (!s) { s = { seen: 0, rows: [] }; segRows.set(seg, s); }
            s.seen++;
            let j = s.rows.length < SEG_SAMPLES ? s.rows.length : Math.floor(rand() * s.seen);
            if (j < SEG_SAMPLES) {
                const row = new Float64Array(prog.length);
                for (let k = 0; k < prog.length; k++) row[k] = vals[prog[k].ix];
                s.rows[j] = row;
            }
        }
    }
    function runRegion(r) {
        for (const it of r.items) {
            if (it.k === 'seg') runSeg(it.seg);
            else runLoop(it.region);
        }
    }
    function runLoop(r) {
        const L = r.loop, s = P.syms.get(L.id);
        // Valor inicial das recorrências do laço (os nós carry ficam nos trechos do próprio laço).
        for (const it of r.items) {
            if (it.k !== 'seg') continue;
            for (const ins of P.progs.get(it.seg)) {
                if (ins.op !== 'carry') continue;
                carry[ins.ix] = ins.initFrom !== null ? vals[ins.initFrom] : ins.initAff ? affv(ins.initAff) : ins.n.init ?? 0;
            }
        }
        for (let t = 0; t < L.tripHw; t++) { iter[s] = t; runRegion(r); }
    }
    runRegion(design.top);
    const out = { mem, written };
    if (profile) {
        const nodes = new Map();
        for (const [id, ix] of P.index) {
            const n = cnt[ix];
            nodes.set(id, { count: n, mean: n ? s1[ix] / n : 0, m2: n ? s2[ix] / n : 0, samples: samples.get(ix)?.rows ?? null });
        }
        out.stats = nodes;
        out.segRows = new Map([...segRows].map(([sg, x]) => [sg.id, x.rows]));
    }
    return out;
}

/**
 * Compara as saídas aproximadas com as exatas, só nas posições escritas pelo kernel.
 * Para vetores de 2 dimensões com tipo de 8 bits sem sinal, também o SSIM (janela gaussiana 11 × 11, como em Wang
 * e colegas, 2004; js/axc/ssim.js), no retângulo das posições escritas.
 */
export function compareOutputs(design, exact, approx) {
    const res = [];
    for (const arr of outputArrays(design)) {
        const X = exact.mem.get(arr.name), Y = approx.mem.get(arr.name), w = exact.written.get(arr.name);
        const peak = typeRange(arr.type)[1];
        let n = 0, sum = 0, sumAbs = 0, sumSq = 0, wce = 0, errs = 0, red = 0, redN = 0;
        for (let k = 0; k < arr.size; k++) {
            if (!w[k]) continue;
            const d = Y[k] - X[k];
            n++; sum += d; sumAbs += Math.abs(d); sumSq += d * d;
            if (Math.abs(d) > wce) wce = Math.abs(d);
            if (d) errs++;
            if (X[k]) { red += Math.abs(d) / Math.abs(X[k]); redN++; }
        }
        const MSE = n ? sumSq / n : 0;
        const r = { array: arr.name, type: arr.type.name, n, peak, ME: n ? sum / n : 0, MED: n ? sumAbs / n : 0, MSE, WCE: wce, EP: n ? errs / n : 0, MRED: redN ? red / redN : 0, PSNR: MSE ? 10 * Math.log10((peak * peak) / MSE) : Infinity, SSIM: null };
        if (arr.dims.length === 2 && arr.type.bits === 8 && !arr.type.signed) {
            const box = bbox(arr, w);
            if (box && box.w >= 11 && box.h >= 11) {
                r.SSIM = ssim(crop(X, arr, box), crop(Y, arr, box), box.w, box.h, peak);
                r.box = box;
            }
        }
        res.push(r);
    }
    return res;
}

/**
 * Estatísticas locais (para a estimativa do SSIM) das saídas de imagem da execução exata, guardadas na própria
 * execução: vetor -> {stats, box}.
 */
export function outputSsimStats(design, exact) {
    if (exact.ssimStats) return exact.ssimStats;
    const out = new Map();
    for (const arr of outputArrays(design)) {
        if (arr.dims.length !== 2 || arr.type.bits !== 8 || arr.type.signed) continue;
        const box = bbox(arr, exact.written.get(arr.name));
        if (!box || box.w < 11 || box.h < 11) continue;
        out.set(arr.name, { box, stats: ssimStats(crop(exact.mem.get(arr.name), arr, box), box.w, box.h, typeRange(arr.type)[1]) });
    }
    exact.ssimStats = out;
    return out;
}

export function bbox(arr, w) {
    const [H, W] = arr.dims;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (w[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export function crop(M, arr, box) {
    const out = new Float64Array(box.w * box.h), W = arr.dims[1];
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) out[y * box.w + x] = M[(box.y + y) * W + box.x + x];
    return out;
}

