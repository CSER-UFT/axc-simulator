import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUnit, compressorTable } from '../js/axc/units.js';
import { testInputs, errorMetrics, rng, paretoFront, histogram } from '../js/axc/metrics.js';
import { testImage, applyFilter, psnr, ssim, KERNELS } from '../js/axc/image.js';

const pairs = (N, n, seed = 1) => {
    const r = rng(seed);
    const a = new Uint32Array(n), b = new Uint32Array(n);
    for (let k = 0; k < n; k++) { a[k] = Math.floor(r() * 2 ** N); b[k] = Math.floor(r() * 2 ** N); }
    return { a, b };
};

test('multiplicadores e somadores exatos: 8 bits exaustivo, 16 bits por amostragem', () => {
    for (const cfg of [{ kind: 'mul', width: 8 }, { kind: 'add', width: 8, adder: 'exact' }, { kind: 'mul', width: 16 }, { kind: 'add', width: 16, adder: 'exact' }]) {
        const u = buildUnit(cfg);
        const inp = cfg.width === 8 ? testInputs(8) : pairs(16, 20000);
        const y = u.net.evaluate(inp.a, inp.b);
        for (let k = 0; k < y.length; k++) assert.equal(y[k], u.exact(inp.a[k], inp.b[k]), JSON.stringify(cfg));
    }
});

test('a avaliação em paralelo (32 pares por palavra) bate com a avaliação porta a porta', () => {
    for (const cfg of [{ kind: 'mul', width: 8, kTrunc: 2, kApprox: 7 }, { kind: 'mul', width: 16, kApprox: 12, approxCarry: false }, { kind: 'add', width: 16, adder: 'seg', L: 5, P: 3 }]) {
        const u = buildUnit(cfg);
        const inp = pairs(cfg.width, 333, 5);
        const y = u.net.evaluate(inp.a, inp.b);
        for (let k = 0; k < 333; k++) assert.equal(y[k], u.net.evaluateOne(inp.a[k], inp.b[k]));
    }
});

test('redução de Dadda de 8 bits: alturas 8, 6, 4, 3, 2 e 35 FA e 7 HA antes da soma final', () => {
    const u = buildUnit({ kind: 'mul', width: 8 });
    assert.deepEqual(u.heights.map((h) => Math.max(...h)), [8, 6, 4, 3, 2]);
    // A soma final de 14 bits usa 1 HA e 13 FA.
    assert.equal(u.net.cells.FA - 13, 35);
    assert.equal(u.net.cells.HA - 1, 7);
    assert.equal(u.net.cells.AND, 64);
});

test('multiplicador truncado: igual à soma dos produtos parciais das colunas mantidas', () => {
    for (const k of [1, 4, 7]) {
        const u = buildUnit({ kind: 'mul', width: 8, kTrunc: k });
        const inp = testInputs(8);
        const y = u.net.evaluate(inp.a, inp.b);
        for (let p = 0; p < y.length; p += 97) {
            const a = inp.a[p], b = inp.b[p];
            let ref = 0;
            for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (i + j >= k) ref += ((a >> i) & 1) * ((b >> j) & 1) * 2 ** (i + j);
            assert.equal(y[p], ref);
        }
    }
    // Quatro colunas truncadas: MED 12,25 e WCE 49 (todos os pares).
    const m = errorMetrics(buildUnit({ kind: 'mul', width: 8, kTrunc: 4 }), testInputs(8));
    assert.equal(m.MED, 12.25);
    assert.equal(m.WCE, 49);
    assert.ok(m.ME < 0);
});

test('somadores aproximados conferem com a definição aritmética', () => {
    const inp = testInputs(8);
    const check = (cfg, ref) => {
        const y = buildUnit(cfg).net.evaluate(inp.a, inp.b);
        for (let p = 0; p < y.length; p++) assert.equal(y[p], ref(inp.a[p], inp.b[p]), `${JSON.stringify(cfg)} ${inp.a[p]} ${inp.b[p]}`);
    };
    for (const k of [1, 3, 5]) {
        const lo = 2 ** k - 1;
        check({ kind: 'add', width: 8, adder: 'loa', k }, (a, b) => ((a | b) & lo) + (((a >> k) + (b >> k) + ((a >> (k - 1)) & (b >> (k - 1)) & 1)) << k));
        check({ kind: 'add', width: 8, adder: 'trunc', k }, (a, b) => ((a >> k) + (b >> k)) << k);
    }
    // Segmentado: cada bloco soma com o vem um calculado só pelos P bits anteriores.
    for (const [L, P] of [[4, 0], [4, 2], [3, 3], [2, 1]]) {
        check({ kind: 'add', width: 8, adder: 'seg', L, P }, (a, b) => {
            let out = 0;
            for (let s = 0; s < 8; s += L) {
                const hi = Math.min(8, s + L), m = 2 ** (hi - s) - 1;
                let cin = 0;
                if (s > 0 && P > 0) {
                    const p0 = Math.max(0, s - P), mm = 2 ** (s - p0) - 1;
                    cin = ((((a >> p0) & mm) + ((b >> p0) & mm)) >> (s - p0)) & 1;
                }
                const sum = ((a >> s) & m) + ((b >> s) & m) + cin;
                out += (hi === 8 ? sum : sum & m) * 2 ** s;
            }
            return out;
        });
    }
});

test('compressor 4:2 aproximado: erra em 5 das 16 combinações', () => {
    const t = compressorTable();
    assert.equal(t.filter((r) => r.err).length, 5);
    assert.deepEqual(t.find((r) => r.x.join('') === '1111'), { x: [1, 1, 1, 1], sum: 0, carry: 1, approx: 2, exact: 4, err: -2 });
});

test('métricas: zero na unidade exata, erro cresce com as colunas aproximadas', () => {
    const inp = testInputs(8);
    const e = errorMetrics(buildUnit({ kind: 'mul', width: 8 }), inp);
    assert.equal(e.MED + e.WCE + e.EP + e.MRED, 0);
    let prev = -1;
    for (const k of [4, 7, 10, 13]) {
        const m = errorMetrics(buildUnit({ kind: 'mul', width: 8, kApprox: k }), inp);
        assert.ok(m.MED > prev, `${k}`);
        prev = m.MED;
    }
    const s = testInputs(16, 'normal', 1000);
    assert.equal(s.exhaustive, false);
    assert.ok([...s.a].every((v) => v < 65536));
    const h = histogram([0, 0, 1, -3, 5]);
    assert.equal(h.counts.reduce((x, y) => x + y, 0), 5);
    assert.equal(h.zero, 2);
});

test('fronteira de Pareto', () => {
    const pts = [{ x: 1, y: 5 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 1 }, { x: 2, y: 4 }];
    assert.deepEqual(paretoFront(pts), [0, 1, 3]);
});

test('aplicação: filtro exato confere; pesos potência de 2 não sentem o truncamento das 4 colunas baixas', () => {
    const img = testImage(48, 40);
    const ex = applyFilter(img, 'gauss', null);
    const at = (x, y) => img.data[Math.min(39, Math.max(0, y)) * 48 + Math.min(47, Math.max(0, x))];
    for (const [x, y] of [[0, 0], [10, 20], [47, 39]]) {
        let s = 0;
        KERNELS.gauss.forEach((w, t) => { s += w * at(x + (t % 3) - 1, y + Math.floor(t / 3) - 1); });
        assert.equal(ex.data[y * 48 + x], Math.floor(s / 256));
    }
    const t4 = buildUnit({ kind: 'mul', width: 8, kTrunc: 4 });
    assert.equal(psnr(applyFilter(img, 'gauss2', null), applyFilter(img, 'gauss2', t4)), Infinity);
    const ap = applyFilter(img, 'gauss', buildUnit({ kind: 'mul', width: 8, kTrunc: 6, kApprox: 4 }));
    assert.ok(psnr(ex, ap) < 60 && ssim(ex, ap) < 1);
    // Somador de 16 bits na acumulação e de 8 bits na média de pares.
    assert.ok(psnr(ex, applyFilter(img, 'gauss', buildUnit({ kind: 'add', width: 16, adder: 'loa', k: 8 }))) < Infinity);
    assert.equal(psnr(applyFilter(img, 'pairs', null), applyFilter(img, 'pairs', buildUnit({ kind: 'add', width: 8, adder: 'exact' }))), Infinity);
});
