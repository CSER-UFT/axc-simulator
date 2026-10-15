import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { designSpace } from '../js/axc/designspace.js';
import { PRESETS } from '../js/axc/presets.js';
import { buildUnit, unitName } from '../js/axc/units.js';
import { testInputs, errorMetrics, loadOperands } from '../js/axc/metrics.js';

test('espaço de projeto: sem repetição, com as pré-definidas e estratificado por técnica', () => {
    const ds = designSpace();
    const names = ds.map(unitName);
    assert.equal(new Set(names).size, names.length);
    for (const p of PRESETS) assert.ok(names.includes(unitName(p)), unitName(p));
    const count = (f) => ds.filter(f).length;
    // Booth, Kulkarni, DRUM e Mitchell completos, com e sem compensação.
    assert.equal(count((c) => c.width === 8 && c.method === 'booth'), 33);
    assert.equal(count((c) => c.width === 16 && c.method === 'drum'), 28);
    assert.equal(count((c) => c.method === 'mitchell'), 4);
    // Somadores truncado e LOA completos.
    assert.equal(count((c) => c.width === 16 && c.adder === 'loa'), 16);
    assert.ok(ds.length > 500);
});

test('intervalo de confiança: nulo na avaliação exaustiva, cobre a média exata na amostragem', () => {
    const u8 = buildUnit({ kind: 'mul', width: 8, method: 'drum', k: 4 });
    const ex = errorMetrics(u8, testInputs(8, 'uniform'));
    assert.equal(ex.ci, null);
    // Uma amostra pequena de 16 bits comparada com uma 25 vezes maior: a diferença fica dentro do intervalo.
    const u16 = buildUnit({ kind: 'mul', width: 16, kTrunc: 12, kApprox: 0, approxCarry: true });
    const small = errorMetrics(u16, testInputs(16, 'uniform', 8000, 1));
    const big = errorMetrics(u16, testInputs(16, 'uniform', 200000, 2));
    for (const k of ['MED', 'MRED', 'EP']) {
        assert.ok(small.ci[k] > 0, k);
        assert.ok(Math.abs(small[k] - big[k]) < 2.5 * small.ci[k], `${k}: ${small[k]} ${big[k]} ± ${small.ci[k]}`);
    }
});

test('operandos reais das aplicações: N bits baixos e pares conhecidos', () => {
    const buf = readFileSync('data/operands.bin');
    const index = JSON.parse(readFileSync('data/operands.json', 'utf8'));
    loadOperands(index, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const m = testInputs(8, 'lenet', 0, 0, 'mul');
    assert.equal(m.a.length, index.n);
    assert.ok(Math.max(...m.b) <= 127, 'pesos em módulo até 127');
    assert.ok(m.a.filter((x) => x === 0).length > 0.4 * m.a.length, 'boa parte das ativações é zero');
    const g = testInputs(8, 'image', 0, 0, 'mul');
    assert.deepEqual([...new Set(g.b)].sort((x, y) => x - y), [19, 32, 52]);
    const a16 = testInputs(16, 'lenet', 0, 0, 'add');
    assert.ok(Math.max(...a16.a) < 2 ** 16 && Math.max(...a16.b) < 2 ** 16);
    // O somador exato não erra em nenhum par; o LOA erra em alguns.
    assert.equal(errorMetrics(buildUnit({ kind: 'add', width: 16, adder: 'exact' }), a16).MED, 0);
    assert.ok(errorMetrics(buildUnit({ kind: 'add', width: 16, adder: 'loa', k: 8 }), a16).MED > 0);
});

test('interface de linha de comando', () => {
    const run = (...a) => execFileSync('node', ['bin/axc.mjs', ...a]).toString();
    const m = JSON.parse(run('metrics', 'MUL8 DRUM4', '--json'));
    assert.equal(m.name, 'MUL8 DRUM4');
    assert.ok(m.MRED > 0.05 && m.MRED < 0.07);
    assert.match(run('verilog', 'ADD8 LOA4'), /module add8_loa4/);
    assert.ok(run('list', '--group', 'add8').split('\n').length > 30);
});
