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

// Referências aritméticas das técnicas novas ----------------------------------------------------------------

const log2i = (x) => 31 - Math.clz32(x);
function mitchellRef(a, b, N) {
    if (!a || !b) return 0;
    const F = N - 1, pa = log2i(a), pb = log2i(b);
    const fa = (a - 2 ** pa) * 2 ** (F - pa), fb = (b - 2 ** pb) * 2 ** (F - pb);
    const s = fa + fb, c = s >= 2 ** F ? 1 : 0;
    return Math.floor(((2 ** F + (s % 2 ** F)) * 2 ** (pa + pb + c)) / 2 ** F);
}
function drumRef(a, b, k) {
    const t = (x) => {
        if (x < 2 ** k) return [x, 0];
        const s = log2i(x) - k + 1;
        return [(Math.floor(x / 2 ** s) % 2 ** k) | 1, s];
    };
    const [ta, sa] = t(a), [tb, sb] = t(b);
    return ta * tb * 2 ** (sa + sb);
}
function kulkarniRef(a, b, N, kBlock) {
    let r = 0;
    for (let j = 0; j < N / 2; j++) for (let i = 0; i < N / 2; i++) {
        const x = (a >> (2 * i)) & 3, y = (b >> (2 * j)) & 3, w = 2 * (i + j);
        r += (w < kBlock && x === 3 && y === 3 ? 7 : x * y) * 2 ** w;
    }
    return r;
}

test('Mitchell, DRUM e Kulkarni conferem com a definição aritmética (8 bits, todos os pares)', () => {
    const inp = testInputs(8);
    const cases = [
        [{ kind: 'mul', width: 8, method: 'mitchell' }, (a, b) => mitchellRef(a, b, 8)],
        [{ kind: 'mul', width: 8, method: 'drum', k: 4 }, (a, b) => drumRef(a, b, 4)],
        [{ kind: 'mul', width: 8, method: 'drum', k: 6 }, (a, b) => drumRef(a, b, 6)],
        [{ kind: 'mul', width: 8, method: 'kulkarni' }, (a, b) => kulkarniRef(a, b, 8, 16)],
        [{ kind: 'mul', width: 8, method: 'kulkarni', kBlock: 6 }, (a, b) => kulkarniRef(a, b, 8, 6)],
    ];
    for (const [cfg, ref] of cases) {
        const y = buildUnit(cfg).net.evaluate(inp.a, inp.b);
        for (let p = 0; p < y.length; p++) assert.equal(y[p], ref(inp.a[p], inp.b[p]), `${JSON.stringify(cfg)} ${inp.a[p]} ${inp.b[p]}`);
    }
    // Valores conhecidos: Mitchell erra sempre para baixo, com MRED perto de 3,8% e no máximo 11,1%.
    const m = errorMetrics(buildUnit({ kind: 'mul', width: 8, method: 'mitchell' }), inp);
    assert.ok(m.ME < 0 && Math.abs(m.MRED - 0.038) < 0.002);
    const k = errorMetrics(buildUnit({ kind: 'mul', width: 8, method: 'kulkarni' }), inp);
    assert.ok(Math.abs(k.MRED - 0.033) < 0.002);
});

test('Mitchell e DRUM de 16 bits conferem por amostragem', () => {
    const inp = pairs(16, 3000, 9);
    for (const [cfg, ref] of [[{ kind: 'mul', width: 16, method: 'mitchell' }, (a, b) => mitchellRef(a, b, 16)], [{ kind: 'mul', width: 16, method: 'drum', k: 8 }, (a, b) => drumRef(a, b, 8)]]) {
        const y = buildUnit(cfg).net.evaluate(inp.a, inp.b);
        for (let p = 0; p < y.length; p++) assert.equal(y[p], ref(inp.a[p], inp.b[p]));
    }
});

test('Booth radix 4 com sinal: exato em todos os pares; truncado erra para baixo; compensação tira o viés', () => {
    const inp = testInputs(8);
    const u = buildUnit({ kind: 'mul', width: 8, method: 'booth' });
    const y = u.net.evaluate(inp.a, inp.b);
    const s8 = (v) => (v >= 128 ? v - 256 : v);
    for (let p = 0; p < y.length; p++) assert.equal(u.decode(y[p]), s8(inp.a[p]) * s8(inp.b[p]) + 0);
    const t = errorMetrics(buildUnit({ kind: 'mul', width: 8, method: 'booth', kTrunc: 4 }), inp);
    const c = errorMetrics(buildUnit({ kind: 'mul', width: 8, method: 'booth', kTrunc: 4, comp: true }), inp);
    assert.ok(t.ME < -10 && Math.abs(c.ME) < 1 && c.MED < t.MED);
    const s16 = errorMetrics(buildUnit({ kind: 'mul', width: 16, method: 'booth' }), pairs(16, 5000, 3));
    assert.equal(s16.WCE, 0);
});

test('compensação do truncamento: a constante cai nas colunas truncadas e não custa portas', () => {
    const inp = testInputs(8);
    const t = buildUnit({ kind: 'mul', width: 8, kTrunc: 4 }), c = buildUnit({ kind: 'mul', width: 8, kTrunc: 4, comp: true });
    assert.equal(c.compConst, 12);
    assert.equal(c.net.gates, t.net.gates);
    const mt = errorMetrics(t, inp), mc = errorMetrics(c, inp);
    assert.ok(Math.abs(mc.ME) < 0.5 && mc.MED < mt.MED);
    // Sem sinal, a soma da constante satura em vez de dar a volta.
    const mi = errorMetrics(buildUnit({ kind: 'mul', width: 8, method: 'mitchell', comp: true }), inp);
    assert.ok(mi.WCE < 2 ** 15);
});

test('atividade de chaveamento: zero sem mudança de entrada, menor quando o circuito encolhe', () => {
    const e = buildUnit({ kind: 'mul', width: 8 }), t = buildUnit({ kind: 'mul', width: 8, kTrunc: 8 });
    const same = new Uint32Array(100).fill(77);
    assert.equal(e.net.activity(same, same), 0);
    const inp = pairs(8, 4096, 11);
    const ae = e.net.activity(inp.a, inp.b), at = t.net.activity(inp.a, inp.b);
    assert.ok(ae > 50 && at < ae);
});
