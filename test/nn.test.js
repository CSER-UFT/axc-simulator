import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeNet, decodeTestSet, productTable, classifyRange, infer, summarize, adderAccumulate, mulQ32, inputTable, macsPerSite, sumTerms } from '../js/axc/nn.js';
import { buildUnit, adderFunction } from '../js/axc/units.js';
import { archSvg } from '../js/axc/nnsvg.js';

const load = (id) => {
    const json = JSON.parse(readFileSync(new URL(`../data/nn/${id}.json`, import.meta.url), 'utf8'));
    const net = decodeNet(json);
    return { json, net, test: decodeTestSet(readFileSync(new URL(`../${json.dataset.file}`, import.meta.url)), json.dataset) };
};
const lenet = load('lenet5-mnist'), mini = load('minilenet-mnist');
const run = ({ net, test }, T, adds = [], n = test.n, trees = []) => classifyRange(net, test, net.sites.map(() => T), adds, 0, n, new Uint8Array(n), trees);

const registry = JSON.parse(readFileSync(new URL('../data/nn/models.json', import.meta.url), 'utf8'));

test('registro de modelos: cada arquivo existe, tem o mesmo id e a base tem teste e validação', () => {
    for (const m of registry.models) {
        const j = JSON.parse(readFileSync(new URL(`../${m.file}`, import.meta.url), 'utf8'));
        assert.equal(j.id, m.id);
        const size = j.dataset.shape.reduce((a, b) => a * b, 1);
        assert.equal(readFileSync(new URL(`../${j.dataset.file}`, import.meta.url)).length, j.dataset.n * (1 + size), m.id);
        if (j.dataset.val) assert.equal(readFileSync(new URL(`../${j.dataset.val.file}`, import.meta.url)).length, j.dataset.val.n * (1 + size), m.id);
    }
});

test('todas as redes: a inferência no navegador dá as mesmas classes da inferência inteira do script que as gerou', () => {
    for (const m of registry.models) {
        const r = load(m.id);
        const p = run(r, productTable(null));
        assert.deepEqual([...p], [...r.net.expected], m.id);
        assert.ok(Math.abs(summarize(r.test, p, null, r.net.classes).accuracy - r.json.accuracy.int8Subset) < 1e-9, m.id);
    }
    assert.deepEqual(macsPerSite(lenet.net), [117600, 240000, 48000, 10080, 840]);
});

test('MiniLenet: saídas da fc2 iguais às do código C (unidades exatas, max pooling em uint8), imagem a imagem', () => {
    const ref = readFileSync(new URL('./fixtures/minilenet-c-fc2.bin', import.meta.url));
    const T = productTable(null), tabs = mini.net.sites.map(() => T);
    for (let k = 0; k < mini.test.n; k++) {
        const { out } = infer(mini.net, mini.test.images.subarray(k * 784, (k + 1) * 784), tabs);
        assert.deepEqual([...out], [...ref.subarray(k * 10, k * 10 + 10)], `imagem ${k}`);
    }
    assert.deepEqual(macsPerSite(mini.net), [58800, 88200, 43218, 1470]);
    assert.deepEqual(mini.net.sites.map((l) => l.outShape.join('x')), ['3x28x28', '6x14x14', '147', '10']);
});

test('MiniLenet: quantização da entrada e reescala em Q32', () => {
    // Faixa reduzida de 0 a 127: o pixel 0 (o mínimo do MNIST normalizado) vai para 0 e o 255 para 127; o valor real
    // 0 (pixel 0,1307 x 255, perto de 33) vai para o ponto zero 17 (ZERO_IMAGE), que é o valor da borda no C.
    const T = inputTable(mini.json.input);
    assert.equal(T[0], 0);
    assert.equal(T[255], 127);
    assert.equal(T[33], 17);
    assert.equal(mini.net.layers[0].zIn, 17);
    for (let p = 1; p < 256; p++) assert.ok(T[p] >= T[p - 1]);
    // (acc * m + 2^31) >> 32 exato, com acumuladores negativos e m grande, contra BigInt.
    for (const [acc, m] of [[0, 5718256], [123456, 4294967295], [-123456, 4294967295], [-1, 1], [2 ** 30, 3000000000], [-(2 ** 31), 17194236], [77, 2147483648]]) {
        const ref = Number((BigInt(acc) * BigInt(m) + (1n << 31n)) >> 32n);
        assert.equal(mulQ32(acc, m), ref, `${acc} ${m}`);
    }
});

test('tabela de produtos: unidades exatas iguais à exata (w de -128 a 127), e o viés acumulado derruba a rede', () => {
    const ex = productTable(null);
    assert.equal(ex[(-128 + 128) * 256 + 255], -128 * 255);
    for (const cfg of [{ kind: 'mul', width: 8 }, { kind: 'mul', width: 16 }, { kind: 'mul', width: 16, method: 'booth' }]) {
        assert.deepEqual(productTable(buildUnit(cfg)), ex, JSON.stringify(cfg));
    }
    assert.equal(productTable(buildUnit({ kind: 'add', width: 8, adder: 'exact' })), null);
    // Booth de 8 bits: a ativação perde o bit baixo e o produto é dobrado.
    const b8 = productTable(buildUnit({ kind: 'mul', width: 8, method: 'booth' }));
    assert.equal(b8[(-5 + 128) * 256 + 201], 2 * (201 >> 1) * -5);
    const n = 200;
    for (const m of [lenet, mini]) {
        const ref = m.net.expected.subarray(0, n);
        const acc = (cfg) => summarize({ ...m.test, n }, run(m, productTable(buildUnit(cfg)), [], n), ref).accuracy;
        assert.ok(acc({ kind: 'mul', width: 8, kTrunc: 4 }) >= 0.95, m.net.name);
        assert.ok(acc({ kind: 'mul', width: 16, method: 'booth', kTrunc: 6 }) < 0.5, m.net.name);
    }
});

test('somador: o modelo funcional confere com o circuito, e a acumulação aproximada fica nos bits baixos', () => {
    const cfgs = [];
    for (const N of [8, 16]) {
        cfgs.push({ kind: 'add', width: N, adder: 'exact' });
        for (const k of [0, 1, 4, N]) cfgs.push({ kind: 'add', width: N, adder: 'trunc', k }, { kind: 'add', width: N, adder: 'loa', k });
        for (const [L, P] of [[1, 0], [3, 2], [4, 4], [8, 4], [4, N]]) cfgs.push({ kind: 'add', width: N, adder: 'seg', L, P });
    }
    for (const cfg of cfgs) {
        const u = buildUnit(cfg), f = adderFunction(cfg);
        const n = cfg.width === 8 ? 65536 : 5000;
        const as = new Uint32Array(n), bs = new Uint32Array(n);
        for (let i = 0; i < n; i++) { as[i] = cfg.width === 8 ? i >> 8 : (i * 40503) & 0xFFFF; bs[i] = cfg.width === 8 ? i & 255 : (i * 9973 + 17) & 0xFFFF; }
        const y = u.net.evaluate(as, bs);
        for (let i = 0; i < n; i++) assert.equal(f(as[i], bs[i]), y[i], `${JSON.stringify(cfg)} ${as[i]} ${bs[i]}`);
        const acc = Int32Array.from([5, -3, 70000, -70000, 255, -1]), prod = Int32Array.from([7, 9, -12345, 3, -256, -1]);
        const got = adderAccumulate(u)(Int32Array.from(acc), prod);
        if (cfg.adder === 'exact') assert.deepEqual([...got], [...acc].map((v, i) => v + prod[i]));
        const M = 2 ** cfg.width - 1;
        for (let i = 0; i < acc.length; i++) {
            const r = f(acc[i] & M, prod[i] & M);
            assert.equal(got[i], ((acc[i] >> cfg.width) + (prod[i] >> cfg.width)) * 2 ** cfg.width + r);
        }
    }
    // Redes: com o somador exato, as mesmas classes; o segmentado L = 4, P = 4 erra muito com acumuladores negativos.
    const n = 120, T = productTable(null);
    for (const m of [lenet, mini]) {
        const exact = adderAccumulate(buildUnit({ kind: 'add', width: 16, adder: 'exact' }));
        assert.deepEqual([...run(m, T, m.net.sites.map(() => exact), n)], [...m.net.expected.subarray(0, n)], m.net.name);
        const seg = adderAccumulate(buildUnit({ kind: 'add', width: 16, adder: 'seg', L: 4, P: 4 }));
        assert.ok(summarize({ ...m.test, n }, run(m, T, m.net.sites.map(() => seg), n)).accuracy < 0.9, m.net.name);
    }
});

test('diagrama da arquitetura: um SVG com as formas de cada tensor', () => {
    for (const m of [lenet, mini]) {
        const svg = archSvg(m.net, { labels: { conv: 'conv', pool: 'pool', dense: 'dense', flatten: 'flatten', input: 'input', output: 'output' } });
        assert.match(svg, /^<svg[^>]*viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/);
        assert.ok(svg.endsWith('</svg>'));
        for (const l of m.net.layers.filter((x) => x.type !== 'flatten')) assert.ok(svg.includes(l.outShape.join('×')) || svg.includes(l.outShape.slice(1).join('×')), `${m.net.name} ${l.outShape}`);
    }
});

test('somadores de 24 e 32 bits na acumulação: os bits baixos pela unidade, e o int32 dá a volta como no C', () => {
    const rnd = (() => { let x = 99; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x; }; })();
    const acc0 = Int32Array.from({ length: 400 }, () => (rnd() - 2 ** 30) * 2 - (rnd() % 3) * 2 ** 29);
    const prod = Int32Array.from({ length: 400 }, (_, i) => (i % 4 === 0 ? -(rnd() % 40000) : (rnd() % 70000) - 30000));
    for (const N of [24, 32]) {
        const cfgs = [{ kind: 'add', width: N, adder: 'exact' }];
        for (const k of [1, 6, 12, N]) cfgs.push({ kind: 'add', width: N, adder: 'trunc', k }, { kind: 'add', width: N, adder: 'loa', k });
        for (const [L, P] of [[4, 0], [8, 4], [12, 8], [4, N]]) cfgs.push({ kind: 'add', width: N, adder: 'seg', L, P });
        for (const cfg of cfgs) {
            const f = adderFunction(cfg), got = adderAccumulate(buildUnit(cfg))(Int32Array.from(acc0), prod);
            for (let i = 0; i < acc0.length; i++) {
                const a = acc0[i], b = prod[i];
                const want = N === 32 ? (f(a >>> 0, b >>> 0) % 2 ** 32) | 0
                    : ((Math.floor(a / 2 ** N) + Math.floor(b / 2 ** N)) * 2 ** N + f(((a % 2 ** N) + 2 ** N) % 2 ** N, ((b % 2 ** N) + 2 ** N) % 2 ** N)) | 0;
                assert.equal(got[i], want, `${JSON.stringify(cfg)} ${a} ${b}`);
                if (cfg.adder === 'exact') assert.equal(got[i], (a + b) | 0);
            }
        }
    }
});

test('estrutura da soma: em cadeia e em árvore conferem com a definição, e só mudam o resultado com a unidade aproximada', () => {
    // O segmentado depende da estrutura; o truncado não (as somas parciais já são múltiplas de 2^k, e cada termo
    // perde os bits baixos uma vez só, em qualquer ordem).
    const add = adderAccumulate(buildUnit({ kind: 'add', width: 16, adder: 'seg', L: 4, P: 4 }));
    const f1 = (a, b) => { const x = Int32Array.of(a); add(x, Int32Array.of(b), 1); return x[0]; };
    const K = 25, n = 7;
    const terms = Array.from({ length: K }, (_, t) => Int32Array.from({ length: n }, (_, j) => ((t * 7919 + j * 104729) % 65536) - 32768));
    const fill = (t, out) => out.set(terms[t]);
    const tree = (xs) => (xs.length === 1 ? xs[0] : tree(Array.from({ length: Math.ceil(xs.length / 2) }, (_, i) => (2 * i + 1 < xs.length ? f1(xs[2 * i], xs[2 * i + 1]) : xs[2 * i]))));
    for (const [U, label] of [[1, 'cadeia'], [0, 'árvore'], [5, 'árvores de 5']]) {
        const got = sumTerms(K, fill, n, add, U);
        for (let j = 0; j < n; j++) {
            const col = terms.map((t) => t[j]);
            let want;
            if (U === 1) want = col.reduce((a, b) => f1(a, b), 0);
            else {
                const G = U === 0 ? K : U;
                want = null;
                for (let g = 0; g < K; g += G) { const r = tree(col.slice(g, g + G)); want = want === null ? r : f1(want, r); }
            }
            assert.equal(got[j], want, `${label}, saída ${j}`);
        }
    }
    // Com o somador exato, a estrutura não muda as classes; com o segmentado, muda a soma; com o truncado, não.
    const ex = adderAccumulate(buildUnit({ kind: 'add', width: 16, adder: 'exact' }));
    assert.deepEqual([...run(mini, productTable(null), mini.net.sites.map(() => ex), 100, mini.net.sites.map(() => 0))], [...mini.net.expected.subarray(0, 100)]);
    const c = sumTerms(K, fill, n, add, 1), t = sumTerms(K, fill, n, add, 0);
    assert.notDeepEqual([...c.subarray(0, n)], [...t.subarray(0, n)]);
    const tr = adderAccumulate(buildUnit({ kind: 'add', width: 16, adder: 'trunc', k: 5 }));
    assert.deepEqual([...sumTerms(K, fill, n, tr, 1).subarray(0, n)], [...sumTerms(K, fill, n, tr, 0).subarray(0, n)]);
});
