/**
 * Computação estocástica: um valor p em [0, 1] vira um fluxo de N bits em que cada bit vale 1 com probabilidade p
 * (Gaines, 1969; Alaghi e Hayes, 2013). A aritmética fica trivial no circuito:
 *
 *   multiplicação unipolar   AND           P(a e b) = pa pb, se os fluxos forem independentes
 *   multiplicação bipolar    XNOR          valor v = 2p - 1; a XNOR b dá va vb
 *   soma escalada            MUX           seleção com p = 1/2: (pa + pb) / 2
 *
 * O preço está em outro lugar: o gerador de cada fluxo (um número pseudoaleatório comparado com o valor binário,
 * o SNG), o contador que converte de volta e os N ciclos por operação. A precisão cresce devagar com N quando os
 * bits são aleatórios (erro ~ 1/raiz(N)) e depende de os fluxos não serem correlacionados.
 *
 * Valores de entrada em 8 bits: x em 0..255 representa p = x / 256. O gerador produz limiares r_t em 0..255 e o
 * bit t do fluxo é (x > r_t).
 */
import { rng } from './metrics.js';
import { Netlist, ONE } from './netlist.js';
import { buildUnit } from './units.js';

export const SC_OPS = {
    mul: { name: 'multiplicação unipolar (AND)', streams: 2 },
    bmul: { name: 'multiplicação bipolar (XNOR)', streams: 2 },
    add: { name: 'soma escalada (MUX)', streams: 3 },
};

export const SC_GENERATORS = {
    random: 'aleatório ideal (independente)',
    lfsrSame: 'um LFSR para todos os fluxos',
    lfsr: 'LFSRs diferentes',
    sobol: 'baixa discrepância (Sobol)',
};

// Geradores ------------------------------------------------------------------------------------------------

/** Máscaras de LFSR de Galois de 8 bits com período máximo (255). */
export const LFSR_MASKS = [0xB8, 0x8E];

/** Sequência de um LFSR de Galois de 8 bits: estados 1..255, limiar r = estado - 1 (0..254). */
export function lfsrSequence(mask, seed, N) {
    const r = new Uint8Array(N);
    let s = seed & 0xFF || 1;
    for (let t = 0; t < N; t++) {
        r[t] = s - 1;
        s = (s >>> 1) ^ (-(s & 1) & mask);
    }
    return r;
}

/**
 * Sequência de Sobol de 12 bits (dimensões 1 a 3, números de direção de Joe e Kuo), reduzida a limiares de 8 bits.
 * Nas duas primeiras dimensões, cada bloco de 2^k pontos cai uma vez em cada intervalo diádico.
 */
export function sobolSequence(dim, N, bits = 12) {
    const m = [];
    if (dim === 1) for (let k = 1; k <= bits; k++) m.push(1);
    else {
        // Polinômios primitivos: x + 1 (s = 1) e x^2 + x + 1 (s = 2, a = 1).
        const { s, a, m0 } = dim === 2 ? { s: 1, a: 0, m0: [1] } : { s: 2, a: 1, m0: [1, 3] };
        m.push(...m0);
        for (let k = s; k < bits; k++) {
            let v = m[k - s] ^ (m[k - s] << s);
            for (let i = 1; i < s; i++) if ((a >> (s - 1 - i)) & 1) v ^= m[k - i] << i;
            m.push(v);
        }
    }
    const V = m.map((mk, k) => mk << (bits - 1 - k));                       // v_k = m_k / 2^k, em inteiros de 12 bits
    const r = new Uint8Array(N);
    for (let t = 0; t < N; t++) {
        let x = 0;
        for (let k = 0, i = t; i; k++, i >>>= 1) if (i & 1) x ^= V[k % bits];
        r[t] = x >>> (bits - 8);
    }
    return r;
}

/** Limiares dos três fluxos (a, b e seleção) de um gerador. */
export function generatorSequences(gen, N, seed = 1) {
    if (gen === 'random') {
        const rand = rng(seed * 7919 + 13);
        const mk = () => Uint8Array.from({ length: N }, () => Math.floor(rand() * 256));
        return { a: mk(), b: mk(), s: mk() };
    }
    if (gen === 'lfsrSame') { const r = lfsrSequence(LFSR_MASKS[0], 1, N); return { a: r, b: r, s: r }; }
    if (gen === 'lfsr') return { a: lfsrSequence(LFSR_MASKS[0], 1, N), b: lfsrSequence(LFSR_MASKS[1], 1, N), s: lfsrSequence(LFSR_MASKS[0], 0x5A, N) };
    if (gen === 'sobol') return { a: sobolSequence(1, N), b: sobolSequence(2, N), s: sobolSequence(3, N) };
    throw new Error(`gerador desconhecido: ${gen}`);
}

// Fluxos e operações ---------------------------------------------------------------------------------------

/** Os 256 fluxos possíveis (um por valor de 8 bits) para uma sequência de limiares, em palavras de 32 bits. */
export function allStreams(r) {
    const N = r.length, words = Math.ceil(N / 32);
    const out = new Array(256);
    for (let x = 0; x < 256; x++) {
        const s = new Uint32Array(words);
        for (let t = 0; t < N; t++) if (x > r[t]) s[t >>> 5] |= 1 << (t & 31);
        out[x] = s;
    }
    return out;
}

/** Fluxo da seleção do MUX: p = 1/2 (limiar comparado com 128). */
function selectStream(r) {
    const s = new Uint32Array(Math.ceil(r.length / 32));
    for (let t = 0; t < r.length; t++) if (r[t] < 128) s[t >>> 5] |= 1 << (t & 31);
    return s;
}

export function popcount(v) {
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24);
}

/** Máscara da última palavra (N pode não ser múltiplo de 32). */
const lastMask = (N) => (N % 32 ? (2 ** (N % 32) - 1) | 0 : -1);

/** Fluxo de saída da operação (palavras de 32 bits). */
export function opStream(op, sa, sb, ss, N) {
    const words = sa.length, out = new Uint32Array(words);
    for (let w = 0; w < words; w++) {
        out[w] = op === 'mul' ? sa[w] & sb[w] : op === 'bmul' ? ~(sa[w] ^ sb[w]) : (ss[w] & sa[w]) | (~ss[w] & sb[w]);
    }
    out[words - 1] &= lastMask(N);
    return out;
}

export const countOnes = (s) => s.reduce((c, w) => c + popcount(w), 0);

/** Valor representado: fração de uns (unipolar) ou 2p - 1 (bipolar). */
export const decode = (op, ones, N) => (op === 'bmul' ? (2 * ones) / N - 1 : ones / N);

/** Valor exato da operação para as entradas de 8 bits x e y. */
export function exactValue(op, x, y) {
    const pa = x / 256, pb = y / 256;
    return op === 'mul' ? pa * pb : op === 'bmul' ? (2 * pa - 1) * (2 * pb - 1) : (pa + pb) / 2;
}

/** Faixa de valores da saída (para normalizar o erro): 1 nas unipolares, 2 na bipolar. */
export const outRange = (op) => (op === 'bmul' ? 2 : 1);

/**
 * Pares de entrada da avaliação: sorteados uniformes em 0..255 (semente fixa). Uma grade regular favoreceria a
 * sequência de Sobol, que é exata quando os dois valores são múltiplos de 256 / raiz(N).
 */
export function scPairs(n = 4096, seed = 2027) {
    const rand = rng(seed);
    const x = [], y = [];
    for (let k = 0; k < n; k++) { x.push(Math.floor(rand() * 256)); y.push(Math.floor(rand() * 256)); }
    return { x, y };
}

/**
 * Erro da operação estocástica num comprimento N, sobre todos os pares da grade.
 * @returns {{N: number, rmse: number, nrmse: number, mae: number, bias: number, bits: number}}
 */
export function scError(op, gen, N, pairs = scPairs(), seed = 1) {
    let se = 0, ae = 0, me = 0;
    const n = pairs.x.length;
    const add = (v, k) => {
        const e = v - exactValue(op, pairs.x[k], pairs.y[k]);
        se += e * e; ae += Math.abs(e); me += e;
    };
    if (gen === 'random') {
        // Aleatório ideal: fluxos novos e independentes em cada operação.
        const rand = rng(seed * 7919 + 13);
        for (let k = 0; k < n; k++) {
            const x = pairs.x[k], y = pairs.y[k];
            let ones = 0;
            for (let t = 0; t < N; t++) {
                const a = x > Math.floor(rand() * 256), b = y > Math.floor(rand() * 256);
                ones += op === 'mul' ? a && b : op === 'bmul' ? a === b : (rand() < 0.5 ? a : b);
            }
            add(decode(op, ones, N), k);
        }
    } else {
        const seq = generatorSequences(gen, N, seed);
        const A = allStreams(seq.a), B = seq.b === seq.a ? A : allStreams(seq.b), S = selectStream(seq.s);
        for (let k = 0; k < n; k++) add(decode(op, countOnes(opStream(op, A[pairs.x[k]], B[pairs.y[k]], S, N)), N), k);
    }
    const rmse = Math.sqrt(se / n), nrmse = rmse / outRange(op);
    return { N, rmse, nrmse, mae: ae / n, bias: me / n, bits: effectiveBits(nrmse) };
}

/** Bits efetivos: os de um conversor ideal cujo erro de quantização (LSB / raiz(12)) daria o mesmo NRMSE. */
export const effectiveBits = (nrmse) => (nrmse > 0 ? Math.log2(1 / (nrmse * Math.sqrt(12))) : Infinity);

/** Erro do circuito binário de referência com resultado em 8 bits (arredondado), nos mesmos pares. */
export function binaryError(op, pairs = scPairs()) {
    let se = 0;
    const n = pairs.x.length;
    for (let k = 0; k < n; k++) {
        const e = exactValue(op, pairs.x[k], pairs.y[k]);
        const q = op === 'bmul' ? Math.round(e * 128) / 128 : Math.round(e * 256) / 256;
        se += (q - e) ** 2;
    }
    const nrmse = Math.sqrt(se / n) / outRange(op);
    return { nrmse, bits: effectiveBits(nrmse) };
}

/** Curva de erro contra o comprimento do fluxo. */
export function scCurve(op, gen, Ns = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096], pairs = scPairs(512)) {
    return Ns.map((N) => scError(op, gen, N, pairs));
}

/** Os primeiros bits dos fluxos de um exemplo (para desenhar). */
export function streamDemo(op, gen, N, x, y) {
    const seq = generatorSequences(gen, N);
    const bitsOf = (r, v) => Uint8Array.from(r, (rt) => (v > rt ? 1 : 0));
    const a = bitsOf(seq.a, x), b = bitsOf(seq.b, y), s = Uint8Array.from(seq.s, (rt) => (rt < 128 ? 1 : 0));
    const out = Uint8Array.from(a, (bit, t) => (op === 'mul' ? bit & b[t] : op === 'bmul' ? 1 - (bit ^ b[t]) : s[t] ? bit : b[t]));
    const sum = (u) => u.reduce((c, v) => c + v, 0);
    return { a, b, s, out, ones: { a: sum(a), b: sum(b), s: sum(s), out: sum(out) }, value: decode(op, sum(out), N), exact: exactValue(op, x, y) };
}

// Tolerância a falhas ------------------------------------------------------------------------------------------

/**
 * Erro com bits invertidos na saída: cada bit do fluxo estocástico (ou do resultado binário de 8 bits) é invertido
 * com probabilidade ber. No fluxo, um bit errado muda o valor em 1/N; no binário, o bit b muda em 2^b.
 */
export function faultError(op, gen, N, ber, pairs = scPairs(512), seed = 3) {
    const rand = rng(seed);
    const seq = generatorSequences(gen, N);
    const A = allStreams(seq.a), B = seq.b === seq.a ? A : allStreams(seq.b), S = selectStream(seq.s);
    let seSc = 0, seBin = 0;
    const n = pairs.x.length;
    for (let k = 0; k < n; k++) {
        const ex = exactValue(op, pairs.x[k], pairs.y[k]);
        const ones0 = countOnes(opStream(op, A[pairs.x[k]], B[pairs.y[k]], S, N));
        // A posição dos uns não importa para a contagem: os primeiros ones0 bits são os uns.
        let ones = ones0;
        for (let t = 0; t < N; t++) if (rand() < ber) ones += t < ones0 ? -1 : 1;
        seSc += (decode(op, ones, N) - ex) ** 2;
        // Binário de 8 bits: unipolar em 0..255 (p = q / 256), bipolar em complemento de 2 (v = q / 128).
        let q = op === 'bmul' ? Math.max(-128, Math.min(127, Math.round(ex * 128))) & 0xFF : Math.min(255, Math.round(ex * 256));
        for (let bit = 0; bit < 8; bit++) if (rand() < ber) q ^= 1 << bit;
        const v = op === 'bmul' ? (q >= 128 ? q - 256 : q) / 128 : q / 256;
        seBin += (v - ex) ** 2;
    }
    return { ber, sc: Math.sqrt(seSc / n) / outRange(op), bin: Math.sqrt(seBin / n) / outRange(op) };
}

// Custo ------------------------------------------------------------------------------------------------------

/** Portas do comparador x > r de 8 bits (o SNG), contadas no mesmo modelo de portas dos outros circuitos. */
function comparatorGates(bits = 8) {
    const net = new Netlist();
    const x = net.input('a', bits), r = net.input('b', bits);
    // x > r  <=>  r - x < 0  <=>  sem vai um em r + ~x + 1.
    const { cout } = net.rippleAdd(r, x.map((w) => net.not(w)), ONE, { carryOnly: true });
    net.outputs = [net.not(cout)];
    return { gates: net.gates, depth: net.delay() };
}

/**
 * Custo de uma operação estocástica com fluxos de N bits contra o circuito binário exato de 8 bits.
 * Portas de duas entradas (NOT conta como porta) e flip-flops; a energia é aproximada por portas x ciclos.
 */
export function scCost(op, N, { sharedRng = false } = {}) {
    const cmp = comparatorGates(8);
    const nIn = SC_OPS[op].streams;
    const core = op === 'mul' ? 1 : op === 'bmul' ? 2 : 4;                  // AND; XOR e NOT; MUX com NOT
    const lfsrs = sharedRng ? 1 : nIn;
    const cbits = Math.ceil(Math.log2(N + 1));
    const parts = [
        { name: 'operação', gates: core, ff: 0 },
        { name: `${nIn} SNG (comparadores de 8 bits)`, gates: nIn * cmp.gates, ff: 0 },
        { name: `${lfsrs} LFSR de 8 bits`, gates: lfsrs * 3, ff: lfsrs * 8 },
        { name: `contador de ${cbits} bits`, gates: 2 * cbits, ff: cbits },
    ];
    const gates = parts.reduce((s, p) => s + p.gates, 0), ff = parts.reduce((s, p) => s + p.ff, 0);
    const bin = buildUnit(op === 'mul' ? { kind: 'mul', width: 8 } : op === 'bmul' ? { kind: 'mul', width: 8, method: 'booth' } : { kind: 'add', width: 8, adder: 'exact' });
    return {
        parts, gates, ff, cycles: N, gateCycles: (gates + ff) * N,
        // Período do relógio: comparador e operação (o contador corre em paralelo).
        depth: cmp.depth + (op === 'add' ? 2 : 1),
        bin: { name: bin.kind === 'mul' ? (op === 'bmul' ? 'Booth exato de 8 bits' : 'multiplicador exato de 8 bits') : 'somador exato de 8 bits', gates: bin.net.gates, depth: bin.net.delay() },
    };
}

// Aplicação: filtro gaussiano com MUX ----------------------------------------------------------------------

/** Pesos do gaussiano 1 2 1 (soma 16): a seleção escolhe o vizinho t com probabilidade w_t / 16. */
const W121 = [1, 2, 1, 2, 4, 2, 1, 2, 1];
const SEL = W121.flatMap((w, t) => Array(w).fill(t));                    // 16 entradas: valor de 4 bits -> vizinho

/**
 * Filtro gaussiano 3 x 3 (1 2 1) estocástico: um MUX de 9 entradas cuja seleção sorteia o vizinho com o peso do
 * filtro, então a saída é a média ponderada sem nenhuma multiplicação. Os SNGs dos pixels compartilham um gerador
 * (exceto no aleatório ideal, independente por pixel); a seleção vem de outro (ou do mesmo, no caso de um LFSR).
 * Cada bit do fluxo de saída é invertido com probabilidade ber.
 *
 * Só a contagem de uns importa, então a simulação não percorre os N bits de cada pixel:
 *  - com geradores compartilhados, cnt[j][v] = quantos ciclos selecionam o vizinho j com limiar abaixo de v; a
 *    contagem do pixel é a soma de cnt[j][vizinho j], o mesmo que o circuito daria bit a bit;
 *  - no aleatório ideal, cada bit é 1 com probabilidade q = soma(w_j v_j) / (16 x 256), independente: a contagem
 *    é binomial (sorteada bit a bit até N = 256, pela aproximação normal acima disso).
 */
export function scFilter(img, gen, N, ber = 0, seed = 11) {
    const { w, h } = img;
    const rand = rng(seed);
    const out = new Uint8ClampedArray(w * h);
    const nb = new Uint8Array(9);
    const indep = gen === 'random';
    let cnt = null;
    if (!indep) {
        const seq = generatorSequences(gen, N, seed);
        const sel = gen === 'sobol' ? seq.b : seq.s;
        cnt = Array.from({ length: 9 }, () => new Uint32Array(257));
        for (let t = 0; t < N; t++) cnt[SEL[sel[t] >>> 4]][seq.a[t] + 1]++;
        for (const c of cnt) for (let v = 1; v <= 256; v++) c[v] += c[v - 1];   // c[v] = ciclos com limiar < v
    }
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    // Bits invertidos: as posições seguem saltos geométricos (em média N x ber sorteios por pixel).
    const lq = ber > 0 && ber < 1 ? Math.log(1 - ber) : 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            for (let t = 0; t < 9; t++) {
                const xx = Math.min(w - 1, Math.max(0, x + (t % 3) - 1)), yy = Math.min(h - 1, Math.max(0, y + Math.floor(t / 3) - 1));
                nb[t] = img.data[yy * w + xx];
            }
            let ones = 0;
            if (indep) {
                let q = 0;
                for (let t = 0; t < 9; t++) q += W121[t] * nb[t];
                q /= 16 * 256;
                if (N <= 256) { for (let t = 0; t < N; t++) if (rand() < q) ones++; }
                else ones = Math.max(0, Math.min(N, Math.round(N * q + Math.sqrt(N * q * (1 - q)) * gauss())));
            } else {
                for (let t = 0; t < 9; t++) ones += cnt[t][nb[t]];
            }
            if (lq) {
                const ones0 = ones;
                for (let t = Math.floor(Math.log(1 - rand()) / lq); t < N; t += 1 + Math.floor(Math.log(1 - rand()) / lq)) ones += t < ones0 ? -1 : 1;
            }
            out[y * w + x] = Math.min(255, Math.round((ones / N) * 256));
        }
    }
    return { w, h, data: out };
}

/** A mesma imagem com cada bit de cada pixel (8 bits) invertido com probabilidade ber: o binário com falhas. */
export function flipPixelBits(img, ber, seed = 17) {
    const rand = rng(seed);
    const data = Uint8ClampedArray.from(img.data, (v) => {
        for (let b = 0; b < 8; b++) if (rand() < ber) v ^= 1 << b;
        return v;
    });
    return { w: img.w, h: img.h, data };
}
