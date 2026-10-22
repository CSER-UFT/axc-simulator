import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeNet, decodeTestSet, productTable, classifyRange, infer, summarize, adderAccumulate, mulQ32, inputTable, macsPerSite } from '../js/axc/nn.js';
import { buildUnit, adderFunction } from '../js/axc/units.js';
import { archSvg } from '../js/axc/nnsvg.js';

const load = (id) => {
    const json = JSON.parse(readFileSync(new URL(`../data/nn/${id}.json`, import.meta.url), 'utf8'));
    const net = decodeNet(json);
    return { json, net, test: decodeTestSet(readFileSync(new URL(`../${json.dataset.file}`, import.meta.url)), json.dataset) };
};
const lenet = load('lenet5-mnist'), mini = load('minilenet-mnist');
const run = ({ net, test }, T, adds = [], n = test.n) => classifyRange(net, test, net.sites.map(() => T), adds, 0, n, new Uint8Array(n));

test('registro de modelos: cada arquivo existe e tem o mesmo id', () => {
    const reg = JSON.parse(readFileSync(new URL('../data/nn/models.json', import.meta.url), 'utf8'));
    for (const m of reg.models) assert.equal(JSON.parse(readFileSync(new URL(`../${m.file}`, import.meta.url), 'utf8')).id, m.id);
});

test('LeNet 5: a inferência genérica dá as mesmas classes do script em Python', () => {
    const p = run(lenet, productTable(null));
    assert.deepEqual([...p], [...lenet.net.expected]);
    // As classes do script de treino (formato antigo) são as mesmas.
    const old = JSON.parse(readFileSync(new URL('../data/lenet5.json', import.meta.url), 'utf8'));
    assert.equal(lenet.json.expected, old.expected);
    assert.ok(Math.abs(summarize(lenet.test, p).accuracy - 0.984) < 1e-9);
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
