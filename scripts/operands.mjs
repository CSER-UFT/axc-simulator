#!/usr/bin/env node
/**
 * Operandos reais das aplicações, para medir o erro (e a energia) das unidades sob a distribuição que elas veem de
 * fato, e não só com entradas uniformes. Grava data/operands.bin (pares em Int32, a e b intercalados) e o índice em
 * data/operands.json.
 *
 *   lenet  LeNet-5 int8 (data/lenet5.json) nas 1000 imagens de teste, com a conta exata:
 *            mul  pares (ativação de 0 a 255, |peso| de 0 a 127) de todas as multiplicações, sorteados com a
 *                 frequência de cada par (histograma exato das cerca de 416 mil multiplicações por imagem);
 *            add  pares (acumulador, produto) de todas as somas da acumulação, com o acumulador começando no
 *                 viés, sorteados uniformemente (amostragem de reservatório). Os valores têm sinal; a unidade de
 *                 N bits recebe os N bits baixos de cada um, como na acumulação aproximada da aba Rede neural.
 *   image  filtro gaussiano 3 x 3 na imagem de teste da página (192 x 192):
 *            mul  pares (pixel, peso) de todos os produtos;
 *            add  pares (acumulador, produto) das oito somas de cada pixel.
 *
 * Uso: node scripts/operands.mjs [--n 32768]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { testImage, KERNELS } from '../js/axc/image.js';
import { rng } from '../js/axc/metrics.js';

const args = process.argv.slice(2);
const n = +(args.includes('--n') ? args[args.indexOf('--n') + 1] : 32768);
const rand = rng(4242);

/** Amostragem de reservatório de pares (a, b). */
function reservoir(size) {
    const a = new Int32Array(size), b = new Int32Array(size);
    let seen = 0;
    return {
        push(x, y) {
            if (seen < size) { a[seen] = x; b[seen] = y; } else {
                const j = Math.floor(rand() * (seen + 1));
                if (j < size) { a[j] = x; b[j] = y; }
            }
            seen++;
        },
        get: () => ({ a, b, total: seen }),
    };
}

/** Sorteio de n pares de um histograma conjunto (a de 0 a A-1, b de 0 a B-1). */
function fromHistogram(H, A, n) {
    const cdf = new Float64Array(H.length);
    let s = 0;
    for (let k = 0; k < H.length; k++) { s += H[k]; cdf[k] = s; }
    const a = new Int32Array(n), b = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        const u = rand() * s;
        let lo = 0, hi = H.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] > u) hi = m; else lo = m + 1; }
        a[i] = lo % A; b[i] = Math.floor(lo / A);
    }
    return { a, b, total: s };
}

// LeNet-5 -------------------------------------------------------------------------------------------------------
// O formato de scripts/lenet5/train.py (pesos e viéses em base64, M em ponto flutuante por camada).
const fromB64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
function decodeModel(json) {
    return { layers: json.layers.map((L) => ({ name: L.name, shape: L.shape, w: new Int8Array(fromB64(L.w).buffer), b: new Int32Array(fromB64(L.b).buffer), M: L.M })) };
}
function decodeTestSet(buf, n = 1000) {
    const u = new Uint8Array(buf);
    return { n, labels: u.subarray(0, n), images: u.subarray(n, n + n * 784) };
}
const model = decodeModel(JSON.parse(readFileSync('data/lenet5.json', 'utf8')));
const test = decodeTestSet(readFileSync('data/mnist1000.bin'));
const H = new Float64Array(128 * 256);          // H[|w| * 256 + a]
const accs = reservoir(n);
const requant = (acc, M) => { const v = Math.floor(acc * M + 0.5); return v < 0 ? 0 : v > 255 ? 255 : v; };
function mac(acc, w, a) {
    const p = a * w;
    H[Math.abs(w) * 256 + a]++;
    accs.push(acc, p);
    return acc + p;
}
function convPool(inp, C, Hh, L) {
    const F = L.shape[0], O = Hh - 4, P = O / 2;
    const out = new Uint8Array(F * P * P), conv = new Uint8Array(O * O);
    for (let f = 0; f < F; f++) {
        for (let y = 0; y < O; y++) for (let x = 0; x < O; x++) {
            let acc = L.b[f];
            for (let c = 0; c < C; c++) for (let ky = 0; ky < 5; ky++) for (let kx = 0; kx < 5; kx++)
                acc = mac(acc, L.w[((f * C + c) * 25) + ky * 5 + kx], inp[c * Hh * Hh + (y + ky) * Hh + x + kx]);
            conv[y * O + x] = requant(acc, L.M);
        }
        for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
            const i = 2 * y * O + 2 * x;
            out[f * P * P + y * P + x] = Math.max(conv[i], conv[i + 1], conv[i + O], conv[i + O + 1]);
        }
    }
    return out;
}
function dense(inp, L, last) {
    const [O, I] = L.shape;
    const out = last ? new Int32Array(O) : new Uint8Array(O);
    for (let o = 0; o < O; o++) {
        let acc = L.b[o];
        for (let i = 0; i < I; i++) acc = mac(acc, L.w[o * I + i], inp[i]);
        out[o] = last ? acc : requant(acc, L.M);
    }
    return out;
}
let correct = 0;
for (let k = 0; k < test.n; k++) {
    const img = test.images.subarray(k * 784, (k + 1) * 784);
    const x = new Uint8Array(32 * 32);
    for (let y = 0; y < 28; y++) for (let j = 0; j < 28; j++) x[(y + 2) * 32 + j + 2] = img[y * 28 + j];
    const [c1, c2, f1, f2, f3] = model.layers;
    const logits = dense(dense(dense(convPool(convPool(x, 1, 32, c1), c1.shape[0], 14, c2), f1, false), f2, false), f3, true);
    let pred = 0;
    for (let j = 1; j < 10; j++) if (logits[j] > logits[pred]) pred = j;
    if (pred === test.labels[k]) correct++;
}
console.log(`LeNet-5: ${correct} de ${test.n} certas (conta exata, para conferir)`);
const lenetMul = fromHistogram(H, 256, n);
const lenetAdd = accs.get();
let zeroA = 0;
for (let k = 0; k < 128; k++) zeroA += H[k * 256];
console.log(`LeNet-5: ${lenetMul.total} multiplicações (${(100 * zeroA / lenetMul.total).toFixed(1)}% com ativação zero), ${lenetAdd.total} somas`);

// Filtro gaussiano -----------------------------------------------------------------------------------------------
const img = testImage();
const K = KERNELS.gauss;
const imgMulA = [], imgMulB = [];
const imgAdd = reservoir(n);
const at = (x, y) => img.data[Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))];
for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    let acc = 0;
    for (let t = 0; t < 9; t++) {
        const p = at(x + (t % 3) - 1, y + Math.floor(t / 3) - 1);
        imgMulA.push(p); imgMulB.push(K[t]);
        const prod = p * K[t];
        if (t) imgAdd.push(acc, prod);
        acc += prod;
    }
}
const pick = (A, B) => {
    const a = new Int32Array(n), b = new Int32Array(n);
    for (let i = 0; i < n; i++) { const j = Math.floor(rand() * A.length); a[i] = A[j]; b[i] = B[j]; }
    return { a, b, total: A.length };
};
const imageMul = pick(imgMulA, imgMulB);
const imageAdd = imgAdd.get();

// Arquivo --------------------------------------------------------------------------------------------------------
const sets = { lenet: { mul: lenetMul, add: lenetAdd }, image: { mul: imageMul, add: imageAdd } };
const index = { n, sets: {} };
const parts = [];
let offset = 0;
for (const [app, kinds] of Object.entries(sets)) {
    index.sets[app] = {};
    for (const [kind, s] of Object.entries(kinds)) {
        const buf = new Int32Array(2 * n);
        for (let i = 0; i < n; i++) { buf[2 * i] = s.a[i]; buf[2 * i + 1] = s.b[i]; }
        parts.push(Buffer.from(buf.buffer));
        index.sets[app][kind] = { offset, count: n, population: s.total };
        offset += buf.byteLength;
    }
}
writeFileSync('data/operands.bin', Buffer.concat(parts));
writeFileSync('data/operands.json', `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    format: 'Int32 little endian, pares (a, b) intercalados; offset em bytes',
    description: {
        lenet: 'LeNet-5 int8, 1000 imagens de teste do MNIST: mul = (ativação, |peso|) sorteados pelo histograma exato; add = (acumulador, produto) por amostragem de reservatório',
        image: 'filtro gaussiano 3 x 3 na imagem de teste 192 x 192: mul = (pixel, peso); add = (acumulador, produto)',
    },
    ...index,
}, null, 1)}\n`);
console.log(`data/operands.bin: ${offset} bytes`);
