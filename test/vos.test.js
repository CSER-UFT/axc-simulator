import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUnit } from '../js/axc/units.js';
import { timingTrace, capturedOutputs, vosMetrics, vosCurve, randomSequence, outputDepths, delayFactor, corruptImage, expectedMemoryMSE } from '../js/axc/vos.js';
import { testImage } from '../js/axc/image.js';

test('atraso pela lei de potência alfa: 1 na tensão nominal e crescente quando a tensão cai', () => {
    assert.equal(delayFactor(1), 1);
    let prev = 1;
    for (const V of [0.9, 0.8, 0.7, 0.6, 0.5]) { const d = delayFactor(V); assert.ok(d > prev); prev = d; }
    assert.equal(delayFactor(0.3), Infinity);
});

test('tempo de chegada: nunca passa da profundidade estática; sem erro de tempo com o relógio do próprio circuito', () => {
    for (const cfg of [{ kind: 'mul', width: 8 }, { kind: 'mul', width: 8, method: 'mitchell' }, { kind: 'add', width: 16, adder: 'exact' }]) {
        const u = buildUnit(cfg);
        const seq = randomSequence(cfg.width, 2000, 3);
        const tr = timingTrace(u, seq.a, seq.b);
        const depth = outputDepths(u);
        for (let k = 0; k < tr.n; k++) for (let j = 0; j < tr.W; j++) assert.ok(tr.arr[k * tr.W + j] <= depth[j]);
        // Os valores do rastro são os mesmos da avaliação normal.
        const y = u.net.evaluate(seq.a, seq.b);
        assert.deepEqual([...tr.out], [...y]);
        const { cap, lateBits } = capturedOutputs(tr, Math.max(...depth), 1);
        assert.equal(lateBits, 0);
        assert.deepEqual([...cap], [...y]);
    }
});

test('o erro cresce quando a tensão cai, e o bit atrasado fica com o valor anterior', () => {
    const u = buildUnit({ kind: 'mul', width: 8 });
    const seq = randomSequence(8, 3000, 4);
    const tr = timingTrace(u, seq.a, seq.b);
    const P = Math.max(...outputDepths(u));
    const curve = vosCurve(u, tr, seq, P, { from: 1, to: 0.55, step: 0.05 });
    assert.equal(curve[0].MRED, 0);
    assert.ok(curve[curve.length - 1].MRED > 0.1);
    for (let k = 1; k < curve.length; k++) assert.ok(curve[k].lateBits >= curve[k - 1].lateBits);
    // Com todos os bits atrasados, cada saída é a da operação anterior.
    const { cap } = capturedOutputs(tr, 0, 1);
    for (let k = 1; k < 50; k++) assert.equal(cap[k], tr.out[k - 1]);
    const m = vosMetrics(u, seq.a, seq.b, cap);
    assert.ok(m.EP > 0.9);
});

test('memória aproximada: MSE medido perto do esperado e proteção dos bits altos', () => {
    const img = testImage(128, 128);
    for (const [ber, prot] of [[0.01, 0], [0.05, 2], [0.1, 5]]) {
        const { img: c } = corruptImage(img, ber, prot, 9);
        let mse = 0;
        for (let k = 0; k < c.data.length; k++) mse += (c.data[k] - img.data[k]) ** 2;
        mse /= c.data.length;
        const e = expectedMemoryMSE(ber, prot);
        assert.ok(Math.abs(mse - e) / e < 0.15, `${ber} ${prot}: ${mse} contra ${e}`);
    }
    const { img: same } = corruptImage(img, 0.5, 8);
    assert.deepEqual([...same.data], [...img.data]);
});
