/**
 * Escalonamento de tensão além da margem (voltage overscaling) e memória aproximada.
 *
 * Tensão e atraso: o atraso de uma porta segue a lei de potência alfa (Sakurai e Newton, 1990),
 *   d(V) ~ V / (V - Vt)^alfa,
 * normalizado para 1 na tensão nominal. O relógio fica fixo; abaixando a tensão, as portas ficam mais lentas e
 * os bits de saída que chegam depois da borda do relógio são capturados com o valor antigo.
 *
 * Tempo de chegada (modelo de transições): numa sequência de operações, um fio que não muda de valor está pronto
 * no instante 0; um fio que muda fica pronto uma porta depois da última entrada que mudou. Esse modelo depende
 * dos dados (só os caminhos sensibilizados contam) e ignora os pulsos espúrios (glitches) e o valor controlador
 * das portas, que em circuitos reais podem adiantar ou atrasar a saída.
 *
 * Energia: a energia dinâmica por operação cai com V^2 (mesma atividade e mesma capacitância).
 */
import { OP } from './netlist.js';
import { rng } from './metrics.js';

export const VT = 0.3, ALPHA = 1.3, VNOM = 1.0;

/** Atraso relativo de uma porta na tensão V (1 na nominal). */
export function delayFactor(V, vt = VT, alpha = ALPHA) {
    const d = (v) => v / (v - vt) ** alpha;
    return V <= vt ? Infinity : d(V) / d(VNOM);
}

/** Profundidade lógica (pior caso estático) de cada bit de saída. */
export function outputDepths(unit) {
    return unit.net.outputs.map((w) => unit.net.depth[w]);
}

/**
 * Valores corretos e tempos de chegada de cada bit de saída numa sequência de operações.
 * @returns {{n: number, W: number, out: Float64Array, arr: Int16Array}}
 */
export function timingTrace(unit, as, bs) {
    const net = unit.net;
    const ops = net.ops;
    const n = as.length, W = net.outputs.length;
    const val = new Uint8Array(net.n), t = new Int16Array(net.n), prev = new Uint8Array(net.n);
    const A = net.inputs.a, B = net.inputs.b;
    const out = new Float64Array(n), arr = new Int16Array(n * W);
    val[1] = 1;
    prev[1] = 1;
    for (let k = 0; k < n; k++) {
        prev.set(val);
        for (let i = 0; i < A.length; i++) val[A[i]] = (as[k] >>> i) & 1;
        for (let i = 0; i < B.length; i++) val[B[i]] = (bs[k] >>> i) & 1;
        for (const w of A) t[w] = 0;
        for (const w of B) t[w] = 0;
        for (let p = 0; p < ops.length; p += 4) {
            const op = ops[p], o = ops[p + 1], x = ops[p + 2], y = ops[p + 3];
            const v = op === OP.AND ? val[x] & val[y] : op === OP.OR ? val[x] | val[y] : op === OP.XOR ? val[x] ^ val[y] : 1 - val[x];
            val[o] = v;
            if (k === 0 || v === prev[o]) { t[o] = 0; continue; }
            const tx = val[x] !== prev[x] ? t[x] : 0, ty = op !== OP.NOT && val[y] !== prev[y] ? t[y] : 0;
            t[o] = 1 + (tx > ty ? tx : ty);
        }
        let v = 0;
        net.outputs.forEach((w, j) => { v += val[w] * 2 ** j; arr[k * W + j] = w > 1 ? t[w] : 0; });
        out[k] = v;
    }
    return { n, W, out, arr };
}

/**
 * Saídas capturadas com o relógio em `period` atrasos de porta nominais, na tensão V: um bit que chega depois da
 * borda fica com o valor da operação anterior.
 */
export function capturedOutputs(trace, period, V) {
    const limit = period / delayFactor(V);
    const { n, W, out, arr } = trace;
    const cap = new Float64Array(n);
    let late = 0;
    for (let k = 0; k < n; k++) {
        const prev = k ? out[k - 1] : 0;
        let v = 0;
        for (let j = 0; j < W; j++) {
            const lateBit = arr[k * W + j] > limit;
            if (lateBit) late++;
            const src = lateBit ? prev : out[k];
            if (Math.floor(src / 2 ** j) % 2) v += 2 ** j;
        }
        cap[k] = v;
    }
    return { cap, lateBits: late / (n * W) };
}

/** Métricas de erro das saídas capturadas contra o produto (ou soma) exato. */
export function vosMetrics(unit, as, bs, cap) {
    let me = 0, med = 0, red = 0, redN = 0, errs = 0, wce = 0;
    const n = cap.length;
    for (let k = 0; k < n; k++) {
        const y = unit.decode ? unit.decode(cap[k]) : cap[k];
        const e = unit.exact(as[k], bs[k]);
        const d = y - e, ad = Math.abs(d);
        me += d; med += ad;
        if (ad > wce) wce = ad;
        if (ad) errs++;
        if (e !== 0) { red += ad / Math.abs(e); redN++; }
    }
    return { ME: me / n, MED: med / n, WCE: wce, MRED: redN ? red / redN : 0, EP: errs / n };
}

/** Sequência de pares aleatórios uniformes (semente fixa). */
export function randomSequence(N, n = 4096, seed = 2024) {
    const r = rng(seed);
    const a = new Uint32Array(n), b = new Uint32Array(n);
    for (let k = 0; k < n; k++) { a[k] = Math.floor(r() * 2 ** N); b[k] = Math.floor(r() * 2 ** N); }
    return { a, b };
}

/**
 * Curva de erro contra tensão.
 * @returns {Array<{V: number, MRED: number, EP: number, MED: number, lateBits: number, energy: number}>}
 */
export function vosCurve(unit, trace, seq, period, { from = 1.0, to = 0.5, step = 0.01 } = {}) {
    const pts = [];
    for (let V = from; V >= to - 1e-9; V -= step) {
        const v = Math.round(V * 100) / 100;
        const { cap, lateBits } = capturedOutputs(trace, period, v);
        const m = vosMetrics(unit, seq.a, seq.b, cap);
        pts.push({ V: v, ...m, lateBits, energy: (v / VNOM) ** 2 });
    }
    return pts;
}

// Memória aproximada ----------------------------------------------------------------------------------------

/**
 * Imagem guardada numa memória que inverte cada bit não protegido com probabilidade `ber`; os `protectedBits`
 * bits mais significativos de cada pixel ficam numa parte confiável da memória.
 */
export function corruptImage(img, ber, protectedBits = 0, seed = 5) {
    const r = rng(seed);
    const data = new Uint8ClampedArray(img.data.length);
    let flips = 0;
    for (let k = 0; k < data.length; k++) {
        let v = img.data[k];
        for (let bit = 0; bit < 8 - protectedBits; bit++) {
            if (r() < ber) { v ^= 1 << bit; flips++; }
        }
        data[k] = v;
    }
    return { img: { w: img.w, h: img.h, data }, flips };
}

/** MSE esperado da memória aproximada: cada inversão do bit b muda o pixel em 2^b. */
export function expectedMemoryMSE(ber, protectedBits = 0) {
    let s = 0;
    for (let bit = 0; bit < 8 - protectedBits; bit++) s += ber * 4 ** bit;
    return s;
}
