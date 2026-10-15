import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeModel, decodeTestSet, productTable, classifyRange, summarize } from '../js/axc/lenet.js';
import { buildUnit } from '../js/axc/units.js';

const model = decodeModel(JSON.parse(readFileSync(new URL('../data/lenet5.json', import.meta.url), 'utf8')));
const testSet = decodeTestSet(readFileSync(new URL('../data/mnist1000.bin', import.meta.url)), model.subset.n);
const run = (T, n = testSet.n) => classifyRange(model, testSet, Array(5).fill(T), 0, n, new Uint8Array(n));

test('LeNet-5: a inferência inteira em JS dá as mesmas classes do script em Python', () => {
    const p = run(productTable(null));
    assert.deepEqual([...p], [...model.expected]);
    assert.ok(Math.abs(summarize(testSet, p).accuracy - model.accuracy.int8Subset) < 1e-9);
    assert.ok(model.accuracy.int8 > 0.98);
});

test('LeNet-5: tabela de produtos das unidades exatas igual à exata, e o viés acumulado derruba a rede', () => {
    const ex = productTable(null);
    for (const cfg of [{ kind: 'mul', width: 8 }, { kind: 'mul', width: 16 }, { kind: 'mul', width: 16, method: 'booth' }]) {
        assert.deepEqual(productTable(buildUnit(cfg)), ex, JSON.stringify(cfg));
    }
    assert.equal(productTable(buildUnit({ kind: 'add', width: 8, adder: 'exact' })), null);
    // Booth de 8 bits: a ativação perde o bit baixo e o produto é dobrado.
    const b8 = productTable(buildUnit({ kind: 'mul', width: 8, method: 'booth' }));
    assert.equal(b8[(-5 + 127) * 256 + 201], 2 * (201 >> 1) * -5);
    const n = 200;
    const ref = model.expected.subarray(0, n);
    const acc = (cfg) => summarize({ ...testSet, n }, run(productTable(buildUnit(cfg)), n), ref).accuracy;
    assert.ok(acc({ kind: 'mul', width: 8, kTrunc: 4 }) >= 0.97);
    assert.ok(acc({ kind: 'mul', width: 16, method: 'booth', kTrunc: 6 }) < 0.5);
});

test('somador: o modelo funcional confere com o circuito, e a acumulação aproximada fica nos bits baixos', async () => {
    const { adderFunction } = await import('../js/axc/units.js');
    const { classifyBatch, adderAccumulate } = await import('../js/axc/lenet.js');
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
        // A acumulação com 32 bits usa a mesma conta nos bits baixos.
        const acc = Int32Array.from([5, -3, 70000, -70000, 255, -1]), prod = Int32Array.from([7, 9, -12345, 3, -256, -1]);
        const got = adderAccumulate(u)(Int32Array.from(acc), prod);
        if (cfg.adder === 'exact') assert.deepEqual([...got], [...acc].map((v, i) => v + prod[i]));
        const M = 2 ** cfg.width - 1;
        for (let i = 0; i < acc.length; i++) {
            const r = f(acc[i] & M, prod[i] & M);
            assert.equal(got[i], ((acc[i] >> cfg.width) + (prod[i] >> cfg.width)) * 2 ** cfg.width + r);
        }
    }
    // Rede: com o somador exato, as mesmas classes; o segmentado L = 4, P = 4 erra muito com acumuladores negativos.
    const n = 150, preds = new Uint8Array(n), T = productTable(null);
    classifyBatch(model, testSet, Array(5).fill(T), Array(5).fill(adderAccumulate(buildUnit({ kind: 'add', width: 16, adder: 'exact' }))), 0, n, preds);
    assert.deepEqual([...preds], [...model.expected.subarray(0, n)]);
    classifyBatch(model, testSet, Array(5).fill(T), Array(5).fill(adderAccumulate(buildUnit({ kind: 'add', width: 16, adder: 'seg', L: 4, P: 4 }))), 0, n, preds);
    assert.ok(summarize({ ...testSet, n }, preds).accuracy < 0.9);
});
