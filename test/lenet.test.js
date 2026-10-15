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
