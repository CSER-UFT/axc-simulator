/**
 * Redes convolucionais quantizadas em 8 bits, descritas em JSON (formato axc-nn/1), com os produtos e as somas das
 * acumulações feitos pelas unidades da biblioteca.
 *
 * Convenção (a mesma do código C para o Vitis):
 *   ativações uint8 com ponto zero z; pesos int8 simétricos; viés int32;
 *   acc = soma de w * a, na ordem dos laços do C (ky, kx, canal; ou entrada), e depois + viés;
 *   saída = min(255, max(0, reescala(acc) + z_saída)).
 * O ponto zero da entrada de cada camada fica absorvido no viés: soma de w * (a - z) + b = soma de w * a + (b - z soma w).
 * Por isso os produtos são sempre uint8 x int8 e a borda das convoluções é preenchida com z (a - z = 0).
 * A reescala é em Q32, como no C (M inteiro sem sinal: (acc * M + 2^31) >> 32), ou com M em ponto flutuante,
 * floor(acc * M + 0.5) (a LeNet 5 de scripts/lenet5/train.py).
 *
 * Camadas: conv {out, k, pad, stride}, maxpool {size}, flatten, dense {out}. As camadas com pesos são os pontos de
 * aproximação (os "sites"): cada uma tem a sua tabela de produtos e a sua soma.
 */

import { adderFunction } from './units.js';

export const FORMAT = 'axc-nn/1';

const fromB64 = (s) => {
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
};
const i8 = (s) => new Int8Array(fromB64(s).buffer);
const i32 = (s) => new Int32Array(fromB64(s).buffer);
const u32 = (s) => new Uint32Array(fromB64(s).buffer);

/** Arredondamento para o par mais próximo (o de torch.round e de nearbyint). */
export const roundEven = (x) => {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/**
 * Tabela pixel (0 a 255) -> entrada quantizada. Sem quantização, o próprio pixel.
 * Com {mean, std, scale, zero, qmin, qmax}: q = clamp(round(((p / 255) - mean) / std / scale) + zero).
 */
export function inputTable(q, channel = 0) {
    const T = new Uint8Array(256);
    for (let p = 0; p < 256; p++) {
        if (!q) { T[p] = p; continue; }
        const mean = Array.isArray(q.mean) ? q.mean[channel] : q.mean, std = Array.isArray(q.std) ? q.std[channel] : q.std;
        const v = roundEven((p / 255 - mean) / std / q.scale) + q.zero;
        T[p] = Math.min(q.qmax ?? 255, Math.max(q.qmin ?? 0, v));
    }
    return T;
}

/** (acc * m + 2^31) >> 32 com m inteiro de 32 bits sem sinal, exato (sem passar de 2^53). */
export function mulQ32(acc, m) {
    const mh = Math.floor(m / 65536), ml = m % 65536;
    const q0 = Math.floor((acc * ml + 2147483648) / 65536);
    return Math.floor((acc * mh + q0) / 65536);
}

/** Rede a partir do JSON: camadas com os pesos decodificados e as formas de cada tensor. */
export function decodeNet(json) {
    if (json.format !== FORMAT) throw new Error(`formato desconhecido: ${json.format}`);
    const ds = json.dataset;
    let shape = [...ds.shape];                     // [C, H, W] ou [N]
    let z = json.input?.zero ?? 0;                 // ponto zero do tensor atual
    const layers = [];
    for (const L of json.layers) {
        const l = { ...L, inShape: shape, zIn: z };
        if (L.type === 'conv') {
            const [C, H, W] = shape, k = L.k, pad = L.pad ?? 0, s = L.stride ?? 1;
            l.w = i8(L.w); l.b = i32(L.b);
            if (l.w.length !== L.out * C * k * k) throw new Error(`${L.name}: ${l.w.length} pesos, esperados ${L.out * C * k * k}`);
            l.outShape = [L.out, Math.floor((H + 2 * pad - k) / s) + 1, Math.floor((W + 2 * pad - k) / s) + 1];
            l.macs = l.outShape[0] * l.outShape[1] * l.outShape[2] * C * k * k;
        } else if (L.type === 'dense') {
            const I = shape.length === 1 ? shape[0] : shape.reduce((a, b) => a * b, 1);
            l.w = i8(L.w); l.b = i32(L.b);
            if (l.w.length !== L.out * I) throw new Error(`${L.name}: ${l.w.length} pesos, esperados ${L.out * I}`);
            l.outShape = [L.out];
            l.macs = L.out * I;
        } else if (L.type === 'maxpool') {
            const [C, H, W] = shape, s = L.size;
            l.outShape = [C, Math.floor(H / s), Math.floor(W / s)];
        } else if (L.type === 'flatten') {
            l.outShape = [shape.reduce((a, b) => a * b, 1)];
        } else throw new Error(`camada desconhecida: ${L.type}`);
        if (l.w) {
            const rq = L.requant;
            if (rq) {
                l.rq = rq.mode === 'q32' ? { q32: true, m: u32(rq.m) } : { q32: false, M: rq.M };
                l.zOut = rq.zero ?? 0;
                z = l.zOut;
            } else l.logits = true;
        }
        shape = l.outShape;
        layers.push(l);
    }
    const sites = layers.filter((l) => l.w);
    if (!sites.length || !sites[sites.length - 1]) throw new Error('rede sem camadas com pesos');
    return {
        id: json.id, name: json.name, description: json.description ?? '', source: json.source ?? null,
        dataset: ds, input: json.input ?? null,
        // Uma tabela por canal de entrada (a normalização pode ser por canal, como na CIFAR 10).
        inputLuts: Array.from({ length: ds.shape.length === 3 ? ds.shape[0] : 1 }, (_, c) => inputTable(json.input, c)),
        layers, sites, classes: shape[0],
        accuracy: json.accuracy ?? {}, expected: json.expected ? fromB64(json.expected) : null,
    };
}

/** Conjunto de teste: n rótulos e depois n imagens (C x H x W, uint8). */
export function decodeTestSet(buf, ds) {
    const u = new Uint8Array(buf), n = ds.n, size = ds.shape.reduce((a, b) => a * b, 1);
    return { n, size, shape: ds.shape, labels: u.subarray(0, n), images: u.subarray(n, n + n * size) };
}

/** Multiplicações por imagem de cada camada com pesos. */
export const macsPerSite = (net) => net.sites.map((l) => l.macs);

/**
 * Tabela de produtos: T[(w + 128) * 256 + a], w de -128 a 127, a de 0 a 255. Sem unidade (null), os produtos exatos.
 * Nas unidades sem sinal, o produto é sinal(w) x unidade(a, |w|), com o sinal aplicado de forma exata. No Booth de
 * 8 bits, com sinal, a ativação não cabe (vai até 255): a unidade recebe a >> 1 e o produto é dobrado. Nas unidades
 * de 16 bits, os operandos ocupam os bits baixos.
 * @returns {Int32Array|null} null quando a unidade não é um multiplicador
 */
export function productTable(unit) {
    const T = new Int32Array(256 * 256);
    if (!unit) {
        for (let w = -128; w < 128; w++) for (let a = 0; a < 256; a++) T[(w + 128) * 256 + a] = a * w;
        return T;
    }
    if (unit.kind !== 'mul') return null;
    const N = unit.cfg.width, signed = !!unit.signed, halve = signed && N === 8;
    const ws = signed ? 256 : 129;                   // com sinal, todos os w; sem sinal, só |w| (até 128)
    const as = new Uint32Array(ws * 256), bs = new Uint32Array(ws * 256);
    const mask = 2 ** N - 1;
    for (let i = 0; i < ws; i++) {
        const w = signed ? i - 128 : i;
        for (let a = 0; a < 256; a++) { as[i * 256 + a] = halve ? a >> 1 : a; bs[i * 256 + a] = w & mask; }
    }
    const raw = unit.net.evaluate(as, bs);
    const val = (k) => (unit.decode ? unit.decode(raw[k]) : raw[k]);
    for (let w = -128; w < 128; w++) {
        for (let a = 0; a < 256; a++) {
            T[(w + 128) * 256 + a] = signed ? val((w + 128) * 256 + a) * (halve ? 2 : 1) : Math.sign(w) * val(Math.abs(w) * 256 + a);
        }
    }
    return T;
}

// Somador aproximado nas acumulações -------------------------------------------------------------------------

/**
 * Soma de acumuladores (inteiros de 32 bits com sinal) com um somador de N bits: a unidade soma os N bits baixos,
 * e a parte alta é somada de forma exata com o vai um que sai dela. Com o somador exato, é a soma exata; com o
 * truncado, o LOA ou o segmentado, o erro fica nos bits baixos, como no circuito.
 * A soma dos bits baixos usa o modelo funcional do somador (o mesmo de adderFunction), conferido contra o circuito
 * nos testes. Devolve add(acc, prod, n): acc[i] = acc[i] (+) prod[i] para i < n.
 */
export function adderAccumulate(unit) {
    const cfg = unit.cfg, N = cfg.width;
    if (N >= 32) {
        // A unidade faz o acumulador inteiro: soma de 32 bits, e o resultado fica no int32 (o vai um que sai do bit 31
        // se perde, como no int32 do C). Operações bit a bit do JavaScript (32 bits); os deslocamentos de 32, que o
        // JavaScript faz como de 0, ficam de fora.
        const type = cfg.adder === 'trunc' || cfg.adder === 'loa' || cfg.adder === 'seg' ? cfg.adder : 'exact';
        const k = Math.min(cfg.k ?? 0, 32), km = k >= 31 ? (k === 31 ? 0x7fffffff : -1) : (1 << k) - 1;
        const L = Math.max(1, cfg.L ?? 4), P = Math.max(0, cfg.P ?? 0);
        // Um laço por tipo (a escolha fora do laço: a busca da página de redes chama isto milhões de vezes).
        if (type === 'exact' || (k === 0 && type !== 'seg')) {
            return (acc, prod, n = acc.length) => { for (let i = 0; i < n; i++) acc[i] = (acc[i] + prod[i]) | 0; return acc; };
        }
        if (type === 'trunc') {
            if (k >= 32) return (acc, prod, n = acc.length) => { acc.fill(0, 0, n); return acc; };
            return (acc, prod, n = acc.length) => { for (let i = 0; i < n; i++) acc[i] = (((acc[i] >>> k) + (prod[i] >>> k)) << k) | 0; return acc; };
        }
        if (type === 'loa') {
            if (k >= 32) return (acc, prod, n = acc.length) => { for (let i = 0; i < n; i++) acc[i] = acc[i] | prod[i]; return acc; };
            const k1 = k - 1;
            return (acc, prod, n = acc.length) => {
                for (let i = 0; i < n; i++) {
                    const x = acc[i], y = prod[i];
                    acc[i] = ((((x >>> k) + (y >>> k) + ((x >>> k1) & (y >>> k1) & 1)) << k) | ((x | y) & km)) | 0;
                }
                return acc;
            };
        }
        return (acc, prod, n = acc.length) => {
            for (let i = 0; i < n; i++) {
                const x = acc[i], y = prod[i];
                let r;
                {
                    r = 0;
                    for (let s = 0; s < 32; s += L) {
                        const hi = s + L < 32 ? s + L : 32, w = hi - s, lo = s - P > 0 ? s - P : 0;
                        const cin = s === 0 || P === 0 ? 0 : ((((x >>> lo) & ((1 << (s - lo)) - 1)) + ((y >>> lo) & ((1 << (s - lo)) - 1))) >>> (s - lo));
                        const wm = w >= 32 ? -1 : (1 << w) - 1;
                        r |= ((((x >>> s) & wm) + ((y >>> s) & wm) + cin) & wm) << s;
                    }
                }
                acc[i] = r | 0;
            }
            return acc;
        };
    }
    const M = (1 << N) - 1;
    // Mesma conta de adderFunction (units.js), escrita dentro do laço para ficar rápida.
    const type = cfg.adder === 'trunc' || cfg.adder === 'loa' || cfg.adder === 'seg' ? cfg.adder : 'exact';
    const k = Math.min(cfg.k ?? 0, N), km = (1 << k) - 1;
    const L = Math.max(1, cfg.L ?? 4), P = Math.max(0, cfg.P ?? 0);
    return (acc, prod, n = acc.length) => {
        for (let i = 0; i < n; i++) {
            const x = acc[i], y = prod[i], a = x & M, b = y & M;
            let r;
            if (type === 'exact') r = a + b;
            else if (type === 'trunc') r = ((a >>> k) + (b >>> k)) << k;
            else if (type === 'loa') r = (((a >>> k) + (b >>> k) + (k > 0 ? (a >>> (k - 1)) & (b >>> (k - 1)) & 1 : 0)) << k) | ((a | b) & km);
            else {
                r = 0;
                let cout = 0;
                for (let s = 0; s < N; s += L) {
                    const hi = s + L < N ? s + L : N, w = hi - s, lo = s - P > 0 ? s - P : 0;
                    const cin = s === 0 || P === 0 ? 0 : ((((a >>> lo) & ((1 << (s - lo)) - 1)) + ((b >>> lo) & ((1 << (s - lo)) - 1))) >>> (s - lo));
                    const sum = ((a >>> s) & ((1 << w) - 1)) + ((b >>> s) & ((1 << w) - 1)) + cin;
                    r |= (sum & ((1 << w) - 1)) << s;
                    cout = sum >>> w;
                }
                r += cout << N;
            }
            const carry = r >>> N;
            acc[i] = (((x >> N) + (y >> N) + carry) << N) + (r & M);
        }
        return acc;
    };
}

// Inferência ---------------------------------------------------------------------------------------------------

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
function requantize(l, acc, ch) {
    const v = l.rq.q32 ? mulQ32(acc, l.rq.m[l.rq.m.length === 1 ? 0 : ch]) : Math.floor(acc * l.rq.M + 0.5);
    return clamp8(v + l.zOut);
}

/**
 * Soma dos termos de todas as saídas com a unidade (fill(t, out) põe o termo t de cada saída em out):
 *   tree = 1: em cadeia, como o laço do C (acc = 0; acc += termo, um por vez);
 *   tree = U > 1: em árvores de U termos (os termos de cada grupo somados dois a dois, nível por nível, como a
 *     expressão de um laço desenrolado com EXPRESSION_BALANCE), e cada árvore somada ao acumulador, que começa em 0
 *     (acc = 0; acc += árvore, como o laço com o fator de desenrolamento U);
 *   tree = 0: todos os termos numa árvore só (o laço inteiro desenrolado).
 */
export function sumTerms(nTerms, fill, n, add, tree, scratch = makeScratch()) {
    const acc = scratch.acc(n);
    acc.fill(0, 0, n);
    const U = tree === 0 ? nTerms : Math.max(1, Math.min(tree ?? 1, nTerms));
    if (U === 1) {
        const p = scratch.prod(n);
        for (let t = 0; t < nTerms; t++) { fill(t, p); add(acc, p, n); }
        return acc;
    }
    const pool = scratch.terms(U, n);
    for (let g = 0; g < nTerms; g += U) {
        const m = Math.min(U, nTerms - g);
        const level = pool.slice(0, m);
        for (let j = 0; j < m; j++) fill(g + j, level[j]);
        for (let len = m; len > 1;) {
            let w = 0;
            for (let i = 0; i < len; i += 2) {
                if (i + 1 < len) add(level[i], level[i + 1], n);
                level[w++] = level[i];
            }
            len = w;
        }
        if (U >= nTerms) acc.set(level[0].subarray(0, n)); else add(acc, level[0], n);
    }
    return acc;
}

/** Convolução: acumuladores (sem o viés ainda) de todas as saídas, termo a termo na ordem ky, kx, canal. */
function convAcc(l, x, T, add, tree, scratch) {
    const [C, H, W] = l.inShape, [F, OH, OW] = l.outShape, k = l.k, pad = l.pad ?? 0, s = l.stride ?? 1, z = l.zIn;
    const n = F * OH * OW;
    const acc = scratch.acc(n);
    acc.fill(0, 0, n);
    const w = l.w;
    if (!add) {
        // Soma exata: a ordem não muda o resultado. A entrada vai para um buffer com a borda (preenchida com o
        // ponto zero) e os pesos viram deslocamentos na tabela.
        const PH = H + 2 * pad, PW = W + 2 * pad;
        const xp = scratch.padded(C * PH * PW);
        if (pad) xp.fill(z, 0, C * PH * PW);
        for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) xp.set(x.subarray((c * H + y) * W, (c * H + y + 1) * W), (c * PH + y + pad) * PW + pad);
        const wo = l.wOff ??= Int32Array.from(w, (v) => (v + 128) * 256);
        for (let f = 0; f < F; f++) {
            for (let oy = 0; oy < OH; oy++) {
                for (let ox = 0; ox < OW; ox++) {
                    let a = 0;
                    for (let c = 0; c < C; c++) {
                        const wb = (f * C + c) * k * k, base = c * PH * PW + oy * s * PW + ox * s;
                        for (let ky = 0; ky < k; ky++) {
                            const row = base + ky * PW, wr = wb + ky * k;
                            for (let kx = 0; kx < k; kx++) a += T[wo[wr + kx] + xp[row + kx]];
                        }
                    }
                    acc[(f * OH + oy) * OW + ox] = a;
                }
            }
        }
        return acc;
    }
    // Com a unidade, a ordem conta: termo t = (ky, kx, canal), a ordem dos laços do C. A entrada vai para o buffer
    // com a borda (o ponto zero), como no caminho exato.
    const PH = H + 2 * pad, PW = W + 2 * pad;
    const xp = scratch.padded(C * PH * PW);
    if (pad) xp.fill(z, 0, C * PH * PW);
    for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) xp.set(x.subarray((c * H + y) * W, (c * H + y + 1) * W), (c * PH + y + pad) * PW + pad);
    const fill = (t, out) => {
        const ky = Math.floor(t / (k * C)), kx = Math.floor(t / C) % k, c = t % C;
        let i = 0;
        for (let f = 0; f < F; f++) {
            const wo = (w[((f * C + c) * k + ky) * k + kx] + 128) * 256;
            for (let oy = 0; oy < OH; oy++) {
                let p = (c * PH + oy * s + ky) * PW + kx;
                for (let ox = 0; ox < OW; ox++, p += s) out[i++] = T[wo + xp[p]];
            }
        }
    };
    return sumTerms(C * k * k, fill, n, add, tree, scratch);
}

function denseAcc(l, x, T, add, tree, scratch) {
    const O = l.out, I = x.length, w = l.w;
    const acc = scratch.acc(O);
    acc.fill(0, 0, O);
    if (!add) {
        const wo = l.wOff ??= Int32Array.from(w, (v) => (v + 128) * 256);
        for (let o = 0; o < O; o++) {
            let a = 0;
            const wb = o * I;
            for (let i = 0; i < I; i++) a += T[wo[wb + i] + x[i]];
            acc[o] = a;
        }
        return acc;
    }
    const fill = (i, out) => { for (let o = 0; o < O; o++) out[o] = T[(w[o * I + i] + 128) * 256 + x[i]]; };
    return sumTerms(I, fill, O, add, tree, scratch);
}

function makeScratch() {
    let A = new Int32Array(4096), P = new Int32Array(4096), B = new Int32Array(1), X = new Uint8Array(4096);
    const pool = [];
    return {
        terms: (U, n) => {
            for (let j = 0; j < U; j++) if (!pool[j] || pool[j].length < n) pool[j] = new Int32Array(n);
            return pool;
        },
        acc: (n) => (A.length >= n ? A : (A = new Int32Array(n))),
        prod: (n) => (P.length >= n ? P : (P = new Int32Array(n))),
        padded: (n) => (X.length >= n ? X : (X = new Uint8Array(n))),
        one: () => B,
    };
}

/**
 * Inferência de uma imagem (pixels uint8). Devolve a classe prevista e as saídas da última camada.
 * @param {Array<Int32Array>} tables tabela de produtos de cada camada com pesos
 * @param {Array<Function|null>} adds soma de cada camada com pesos (null: exata)
 * @param {Array<number>} trees estrutura da soma de cada camada com pesos (1: em cadeia, o padrão; 0: árvore com todos
 *   os termos; U: árvores de U termos). Com a soma exata, não muda nada.
 */
export function infer(net, img, tables, adds = [], scratch = makeScratch(), trees = []) {
    return inferFrom(net, inputActivations(net, img), 0, tables, adds, scratch, trees);
}

/** Ativações da entrada da rede (os pixels pela tabela de quantização de cada canal). */
export function inputActivations(net, img, x = new Uint8Array(img.length)) {
    const luts = net.inputLuts, plane = img.length / luts.length;
    for (let c = 0, i = 0; c < luts.length; c++) { const T = luts[c]; for (let e = i + plane; i < e; i++) x[i] = T[img[i]]; }
    return x;
}

/**
 * Inferência a partir da camada net.layers[from], com x as ativações da entrada dela (não é alterado). record(li, x),
 * se dado, recebe as ativações da entrada de cada camada li (a busca guarda as das camadas que não mudam).
 */
export function inferFrom(net, x, from, tables, adds = [], scratch = makeScratch(), trees = [], record = null) {
    let si = 0, out = null;
    for (let li = 0; li < from; li++) if (net.layers[li].type === 'conv' || net.layers[li].type === 'dense') si++;
    for (let li = from; li < net.layers.length; li++) {
        const l = net.layers[li];
        if (record) record(li, x);
        if (l.type === 'conv' || l.type === 'dense') {
            const T = tables[si], add = adds[si] ?? null, tree = trees[si] ?? 1;
            si++;
            const acc = l.type === 'conv' ? convAcc(l, x, T, add, tree, scratch) : denseAcc(l, x, T, add, tree, scratch);
            const n = l.outShape.reduce((a, b) => a * b, 1), per = n / l.outShape[0];
            // O viés entra no fim, como no C: (soma dos produtos) + viés.
            const bias = scratch.one();
            if (l.logits) {
                out = new Int32Array(n);
                for (let i = 0; i < n; i++) {
                    const ch = Math.floor(i / per);
                    if (add) { bias[0] = l.b[ch]; const a1 = Int32Array.of(acc[i]); add(a1, bias, 1); out[i] = a1[0]; } else out[i] = acc[i] + l.b[ch];
                }
                x = out;
            } else {
                const y = new Uint8Array(n);
                if (add) {
                    // Viés pela unidade também (é mais uma soma do acumulador).
                    for (let ch = 0; ch < l.outShape[0]; ch++) {
                        const tmp = scratch.prod(per);
                        tmp.fill(l.b[ch], 0, per);
                        const seg = acc.subarray(ch * per, (ch + 1) * per);
                        add(seg, tmp, per);
                    }
                    for (let i = 0; i < n; i++) y[i] = requantize(l, acc[i], Math.floor(i / per));
                } else {
                    for (let i = 0; i < n; i++) { const ch = Math.floor(i / per); y[i] = requantize(l, acc[i] + l.b[ch], ch); }
                }
                x = y;
                out = y;
            }
        } else if (l.type === 'maxpool') {
            const [C, H, W] = l.inShape, [, PH, PW] = l.outShape, s = l.size;
            const y = new Uint8Array(C * PH * PW);
            for (let c = 0; c < C; c++) {
                for (let py = 0; py < PH; py++) {
                    for (let px = 0; px < PW; px++) {
                        let m = 0;
                        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
                            const v = x[(c * H + py * s + dy) * W + px * s + dx];
                            if (v > m) m = v;
                        }
                        y[(c * PH + py) * PW + px] = m;
                    }
                }
            }
            x = y;
        }
        // flatten: o vetor já está em C x H x W, a mesma ordem do C (f, h, w).
    }
    let pred = 0;
    for (let k = 1; k < out.length; k++) if (out[k] > out[pred]) pred = k;
    return { pred, out };
}

/** Classifica as imagens [from, to) do conjunto de teste (trees: a estrutura da soma de cada camada, veja infer). */
export function classifyRange(net, test, tables, adds, from, to, preds, trees = []) {
    const scratch = makeScratch();
    for (let k = from; k < to; k++) preds[k] = infer(net, test.images.subarray(k * test.size, (k + 1) * test.size), tables, adds, scratch, trees).pred;
    return preds;
}

/** Acurácia, matriz de confusão (real x previsto) e imagens que mudaram em relação à referência. */
export function summarize(test, preds, ref, classes = 10) {
    const conf = Array.from({ length: classes }, () => new Array(classes).fill(0));
    let ok = 0, fixed = 0;
    const broke = [];
    for (let k = 0; k < test.n; k++) {
        const y = test.labels[k];
        conf[y][preds[k]]++;
        if (preds[k] === y) ok++;
        if (ref) {
            if (ref[k] === y && preds[k] !== y) broke.push(k);
            if (ref[k] !== y && preds[k] === y) fixed++;
        }
    }
    return { accuracy: ok / test.n, conf, broke, fixed };
}
