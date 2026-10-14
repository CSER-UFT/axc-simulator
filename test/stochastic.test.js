import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    lfsrSequence, sobolSequence, LFSR_MASKS, generatorSequences, scError, streamDemo, allStreams, opStream, countOnes,
    decode, scFilter, faultError, binaryError, scCost, scPairs,
} from '../js/axc/stochastic.js';
import { testImage, parseNetpbm, fitImage } from '../js/axc/image.js';

test('LFSRs de 8 bits com período máximo (255 estados diferentes)', () => {
    for (const m of LFSR_MASKS) {
        const r = lfsrSequence(m, 1, 510);
        assert.equal(new Set(r.subarray(0, 255)).size, 255);
        assert.deepEqual([...r.subarray(255)], [...r.subarray(0, 255)]);
    }
});

test('Sobol: cada dimensão passa por todos os limiares, e as dimensões 1 e 2 estratificam o quadrado', () => {
    for (const d of [1, 2, 3]) assert.equal(new Set(sobolSequence(d, 256)).size, 256, `dimensão ${d}`);
    const a = sobolSequence(1, 256), b = sobolSequence(2, 256);
    const cells = new Set();
    for (let t = 0; t < 256; t++) cells.add((a[t] >> 4) * 16 + (b[t] >> 4));
    assert.equal(cells.size, 256);
});

test('multiplicação com Sobol: exata quando os valores caem na grade de 16 níveis (N = 256)', () => {
    const seq = generatorSequences('sobol', 256);
    const A = allStreams(seq.a), B = allStreams(seq.b);
    for (const x of [0, 16, 48, 128, 240]) {
        for (const y of [16, 96, 208]) assert.equal(countOnes(opStream('mul', A[x], B[y], null, 256)), (x * y) / 256);
    }
});

test('bits aleatórios: o erro cai com 1 / raiz(N)', () => {
    const pairs = scPairs(512);
    const e256 = scError('mul', 'random', 256, pairs).nrmse, e4096 = scError('mul', 'random', 4096, pairs).nrmse;
    const ratio = e4096 / e256;
    assert.ok(ratio > 0.2 && ratio < 0.3, `razão ${ratio}`);
    // E a baixa discrepância cai bem mais rápido.
    assert.ok(scError('mul', 'sobol', 4096, pairs).nrmse < e4096 / 4);
});

test('correlação: com o mesmo LFSR, a AND dá o mínimo e a XNOR dá 1 - |pa - pb|', () => {
    for (const [x, y] of [[192, 96], [40, 200], [128, 128]]) {
        const m = streamDemo('mul', 'lfsrSame', 255, x, y);
        assert.equal(m.ones.out, Math.min(m.ones.a, m.ones.b));
        const b = streamDemo('bmul', 'lfsrSame', 255, x, y);
        assert.equal(b.ones.out, 255 - Math.abs(b.ones.a - b.ones.b));
    }
    assert.ok(scError('mul', 'lfsrSame', 256).nrmse > 5 * scError('mul', 'lfsr', 256).nrmse);
});

test('o exemplo bit a bit confere com a avaliação por palavras', () => {
    for (const op of ['mul', 'bmul', 'add']) {
        for (const gen of ['lfsr', 'sobol', 'random']) {
            const N = 200, x = 150, y = 77;
            const d = streamDemo(op, gen, N, x, y);
            const seq = generatorSequences(gen, N);
            const A = allStreams(seq.a), B = allStreams(seq.b);
            const S = new Uint32Array(Math.ceil(N / 32));
            for (let t = 0; t < N; t++) if (seq.s[t] < 128) S[t >>> 5] |= 1 << (t & 31);
            const ones = countOnes(opStream(op, A[x], B[y], S, N));
            assert.equal(ones, d.ones.out, `${op} ${gen}`);
            assert.equal(decode(op, ones, N), d.value);
        }
    }
});

test('filtro estocástico: a contagem por tabela é igual à simulação bit a bit', () => {
    const img = testImage(24, 20);
    for (const gen of ['lfsr', 'sobol', 'lfsrSame']) {
        const N = 300;
        const fast = scFilter(img, gen, N);
        const seq = generatorSequences(gen, N, 11);
        const sel = gen === 'sobol' ? seq.b : seq.s;
        const W = [1, 2, 1, 2, 4, 2, 1, 2, 1], SEL = W.flatMap((w, t) => Array(w).fill(t));
        for (let y = 0; y < img.h; y++) {
            for (let x = 0; x < img.w; x++) {
                let ones = 0;
                for (let t = 0; t < N; t++) {
                    const j = SEL[sel[t] >>> 4];
                    const xx = Math.min(img.w - 1, Math.max(0, x + (j % 3) - 1)), yy = Math.min(img.h - 1, Math.max(0, y + Math.floor(j / 3) - 1));
                    if (img.data[yy * img.w + xx] > seq.a[t]) ones++;
                }
                assert.equal(fast.data[y * img.w + x], Math.min(255, Math.round((ones / N) * 256)));
            }
        }
    }
});

test('bits errados: o fluxo estocástico degrada pouco, o binário degrada muito', () => {
    const f = faultError('mul', 'sobol', 256, 0.01);
    assert.ok(f.sc < f.bin / 3, `${f.sc} ${f.bin}`);
    assert.ok(Math.abs(binaryError('mul').nrmse - 1 / 256 / Math.sqrt(12)) < 1e-4);
    const c = scCost('mul', 256);
    assert.ok(c.gates + c.ff < c.bin.gates);
    assert.ok(c.gateCycles > 50 * c.bin.gates);
});

test('Netpbm: P1 a P6, com comentários e 16 bits por canal', () => {
    const enc = (s) => new TextEncoder().encode(s);
    const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; } return out; };
    // PGM texto: 3 x 2, maxval 15.
    let im = parseNetpbm(enc('P2\n# comentário\n3 2\n15\n0 15 5\n10 # no meio\n 15 0\n'));
    assert.deepEqual([im.w, im.h, ...im.data], [3, 2, 0, 255, 85, 170, 255, 0]);
    // PPM texto: cinza puro e vermelho puro.
    im = parseNetpbm(enc('P3 2 1 255 100 100 100 255 0 0'));
    assert.deepEqual([...im.data], [100, Math.round(0.299 * 255)]);
    // PBM texto (1 é preto), dígitos colados.
    im = parseNetpbm(enc('P1\n4 1\n0110'));
    assert.deepEqual([...im.data], [255, 0, 0, 255]);
    // PGM binário.
    im = parseNetpbm(cat(enc('P5\n2 2\n255\n'), Uint8Array.of(0, 64, 128, 255)));
    assert.deepEqual([...im.data], [0, 64, 128, 255]);
    // PPM binário de 16 bits (big endian).
    im = parseNetpbm(cat(enc('P6 1 1 65535\n'), Uint8Array.of(0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)));
    assert.deepEqual([...im.data], [255]);
    // PBM binário: 10 pixels por linha ocupam 2 bytes.
    im = parseNetpbm(cat(enc('P4\n10 1\n'), Uint8Array.of(0b10000000, 0b01000000)));
    assert.deepEqual([...im.data], [0, 255, 255, 255, 255, 255, 255, 255, 255, 0]);
    assert.throws(() => parseNetpbm(enc('GIF89a')), /P1 a P6/);
    assert.throws(() => parseNetpbm(cat(enc('P5 4 4 255\n'), Uint8Array.of(1, 2))), /incompleto/);
});

test('imagem grande é reduzida pela média de área', () => {
    const data = new Uint8ClampedArray(512 * 300);
    for (let k = 0; k < data.length; k++) data[k] = (k % 512) < 256 ? 0 : 200;
    const im = fitImage({ w: 512, h: 300, data }, 256);
    assert.equal(im.w, 256);
    assert.equal(im.h, 150);
    assert.equal(im.data[0], 0);
    assert.equal(im.data[255], 200);
    assert.equal(fitImage(testImage(100, 80), 256).w, 100);
});
