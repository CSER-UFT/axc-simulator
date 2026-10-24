import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeNet, decodeTestSet, productTable, classifyRange, adderAccumulate } from '../js/axc/nn.js';
import { buildUnit } from '../js/axc/units.js';
import { networkCost, directiveTrees } from '../js/axc/nngen.js';
import { prepareSearch, searchNetwork, poolEngine, evalHandler, initMessage } from '../js/axc/nnsearch.js';

const R = new URL('../', import.meta.url);
const D = (f) => JSON.parse(readFileSync(new URL(`data/${f}`, R), 'utf8'));
const synth = D('synth.json'), cells = D('hls-cells.json'), fpga = D('vivado-units.json');
const netJson = D('nn/minilenet-mnist.json');
const net = decodeNet(netJson), ds = net.dataset;
const valBuf = readFileSync(new URL(ds.val.file, R));
const val = decodeTestSet(valBuf, { ...ds, n: ds.val.n }), testSet = decodeTestSet(readFileSync(new URL(ds.file, R)), ds);
const P = prepareSearch(net, { val, test: testSet, synth, cells, fpga, objective: 'area', maxCands: 4 });
const cfgOf = (name) => synth.designs.find((d) => d.name === name).cfg;
/** Classificação independente (sem o reaproveitamento das ativações) com as unidades de cada camada. */
const wrongOf = (assign, set = val) => {
    const tables = assign.map((a) => productTable(a.mul ? buildUnit(cfgOf(a.mul)) : null));
    const adds = assign.map((a) => (a.add ? adderAccumulate(buildUnit(cfgOf(a.add))) : null));
    const preds = classifyRange(net, set, tables, adds, 0, set.n, new Uint8Array(set.n), directiveTrees(net, null));
    let w = 0;
    for (let k = 0; k < set.n; k++) if (preds[k] !== set.labels[k]) w++;
    return w;
};

test('busca: candidatas na fronteira de custo e erro, mais baratas que a exata', () => {
    for (const c of P.cands) {
        for (const kind of ['mul', 'add']) {
            const xs = c[kind];
            assert.ok(xs.length >= 2 && xs.length <= 4, `${kind}: ${xs.length}`);
            for (let i = 1; i < xs.length; i++) assert.ok(xs[i].cost >= xs[i - 1].cost && xs[i].err < xs[i - 1].err, xs.map((x) => x.name).join(', '));
        }
    }
});

test('busca: as ativações guardadas dão a mesma classificação, e a avaliação para no limite', () => {
    assert.equal(P.exactWrong, wrongOf(P.exact));
    const c = P.cands;
    const a = P.exact.map((x, i) => (i === 1 ? { mul: c[1].mul[2].name, add: c[1].add[2].name } : i === 3 ? { mul: c[3].mul[1].name, add: null } : { ...x }));
    const r = P.val.run(a);
    assert.equal(r.wrong, wrongOf(a));
    assert.equal(r.seen, val.n);
    // Uma unidade ruim: para cedo.
    const bad = P.exact.map((x, i) => (i === 0 ? { mul: c[0].mul[0].name, add: null } : { ...x }));
    const rb = P.val.run(bad, { maxWrong: P.exactWrong + 5 });
    if (!rb.feasible) assert.ok(rb.seen < val.n && rb.wrong === P.exactWrong + 6);
});

test('busca: o ponto escolhido respeita o limite (conferido de forma independente), e workers dão o mesmo resultado', async () => {
    const r = await searchNetwork(P, { heuristic: 'sequential', maxDrop: 1 });
    assert.ok(r.best.cost < r.exact.cost);
    assert.ok(r.best.wrongVal <= r.maxWrong && r.maxWrong === P.exactWrong + 10);
    assert.equal(r.best.wrongVal, wrongOf(r.best.assign));
    assert.ok(Math.abs(1 - r.best.accTest - wrongOf(r.best.assign, testSet) / testSet.n) < 1e-12);
    assert.ok(Math.abs(r.best.cost - networkCost(net, { synth, cells, fpga, units: r.best.assign }).totals.area) < 1e-6);
    // Dois "workers" na mesma thread, pelo mesmo protocolo de mensagens.
    const init = initMessage(netJson, valBuf, synth, P.trees);
    const send = [evalHandler(), evalHandler()].map((h) => { h(init); return (msg) => Promise.resolve(h(msg)); });
    const r2 = await searchNetwork(P, { heuristic: 'sequential', maxDrop: 1 }, poolEngine(send));
    assert.deepEqual(r2.best.assign, r.best.assign);
    assert.equal(r2.best.wrongVal, r.best.wrongVal);
    // Sensibilidade: também dentro do limite.
    const s = await searchNetwork(P, { heuristic: 'sensitivity', maxDrop: 1 }, poolEngine(send));
    assert.ok(s.best.wrongVal <= s.maxWrong && s.best.cost < s.exact.cost);
    assert.equal(s.best.wrongVal, wrongOf(s.best.assign));
});

test('busca com amostra: estratificada, e o reparo põe o ponto dentro do limite na validação inteira', async () => {
    const { stratified } = await import('../js/axc/nnsearch.js');
    const sub = stratified(val, 250, 10);
    const per = new Array(10).fill(0);
    for (const y of sub.labels) per[y]++;
    assert.deepEqual(per, new Array(10).fill(25));
    const Ps = prepareSearch(net, { val, test: testSet, synth, cells, fpga, objective: 'area', maxCands: 4, sample: 250 });
    assert.equal(Ps.n, 250);
    const r = await searchNetwork(Ps, { heuristic: 'sequential', maxDrop: 1 });
    assert.ok(r.best.cost < r.exact.cost);
    // Na validação inteira (conferido de forma independente), a queda fica dentro do limite.
    const wFull = wrongOf(r.best.assign), wEx = wrongOf(P.exact);
    assert.equal(1 - wFull / val.n, r.best.accValFull);
    assert.ok(wFull <= wEx + 10, `${wFull} erradas contra ${wEx} da exata`);
});
