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
    // O escolhido é um ponto avaliado, e todo ponto viável na amostra mais barato que ele foi reprovado na validação
    // inteira (o reparo não inventa pontos, e nenhum ponto melhor fica de fora).
    const key = (a) => JSON.stringify(a);
    const chosen = r.points.find((p) => key(p.assign) === key(r.best.assign));
    assert.ok(chosen && (chosen.feasible || chosen.repair) && chosen.fullOk === true);
    for (const p of r.points) if (p.feasible && p.cost < chosen.cost - 1e-9) assert.equal(p.fullOk, false, `${p.cost} < ${chosen.cost}`);
});

test('curva monótona: origem, regressão isotônica, quedas negativas em zero e cauda inclinada', async () => {
    const { monotoneCurve } = await import('../js/axc/nnsearch.js');
    const f = monotoneCurve([{ err: 1, drop: -0.2 }, { err: 2, drop: 1 }, { err: 3, drop: 0.6 }, { err: 4, drop: 3 }]);
    assert.equal(f(0), 0);
    assert.equal(f(1), 0);
    // 1 e 0,6 violam a ordem: viram a média, 0,8, nos dois.
    assert.ok(Math.abs(f(2) - 0.8) < 1e-12 && Math.abs(f(3) - 0.8) < 1e-12);
    assert.ok(Math.abs(f(3.5) - 1.9) < 1e-12);
    for (let e = 0; e < 6; e += 0.25) assert.ok(f(e + 0.25) >= f(e));
    // Depois do último ponto: a reta mais inclinada (último trecho, 2,2 por LSB).
    assert.ok(Math.abs(f(5) - 5.2) < 1e-12);
});

test('busca híbrida: calibração, busca no modelo estático e ponto verificado dentro do limite', async () => {
    const { hybridSearch, estimateDrop, staticModel } = await import('../js/axc/nnsearch.js');
    const ev = { calib: 0, search: 0, verify: 0 };
    const r = await hybridSearch(P, { heuristic: 'local', maxDrop: 1, onPoint: (e) => ev[e.phase]++ });
    assert.ok(!r.error, r.error);
    assert.ok(r.best.cost < r.exact.cost && r.best.saving > 0);
    // O ponto escolhido foi conferido por classificação (de forma independente) e cabe no limite.
    assert.equal(r.best.wrongVal, wrongOf(r.best.assign));
    assert.ok(r.best.wrongVal <= r.maxWrong);
    // A estimada pode passar do limite (até o dobro, nos pontos medidos para a tabela): quem decide é a medida.
    assert.ok(r.best.estDrop <= 2 + 1e-9);
    assert.ok(Math.abs(estimateDrop(P, P.calib.curves, r.best.assign) - r.best.estDrop) < 1e-12);
    // Eventos por ponto: um por calibração, um por ponto da busca, um por verificação.
    assert.equal(ev.calib, r.calib.length);
    assert.equal(ev.search, r.evals);
    assert.ok(ev.verify >= 1 && ev.verify === r.points.filter((p) => p.measured).length);
    // Passo a passo: começa pela calibração, tem as iterações da heurística e termina na verificação que passou.
    assert.equal(r.steps[0].kind, 'calib');
    assert.equal(r.steps[0].n, r.calib.length);
    assert.ok(r.steps.some((s) => s.kind === 'imp'));
    const vs = r.steps.filter((s) => s.kind === 'verify');
    assert.ok(vs.at(-1).ok && Math.abs(vs.at(-1).score - r.best.cost) < 1e-6);
    // Nenhum ponto classificado que passou custa menos que o escolhido.
    for (const p of r.points) if (p.measured?.ok) assert.ok(p.cost >= r.best.cost - 1e-6, `${p.cost} < ${r.best.cost}`);
    // A fronteira estimada: custo crescente, queda decrescente.
    for (let k = 1; k < r.front.length; k++) assert.ok(r.front[k].cost >= r.front[k - 1].cost && r.front[k].drop <= r.front[k - 1].drop + 1e-6);
    // O erro estático da exata é zero, e o de uma troca, positivo.
    assert.equal(staticModel(P).errors(P.exact).reduce((a, b) => a + b, 0), 0);
    // A calibração fica na preparação: a segunda busca não classifica de novo as trocas isoladas.
    const ev2 = { calib: 0, search: 0, verify: 0 };
    const r2 = await hybridSearch(P, { heuristic: 'efficiency', maxDrop: 1, onPoint: (e) => ev2[e.phase]++ });
    assert.equal(ev2.calib, 0);
    assert.ok(r2.best.wrongVal <= r2.maxWrong);
});

test('busca híbrida: só as seis heurísticas da página HLS (sem a exaustiva e a aleatória)', async () => {
    const { hybridSearch, HYBRID_HEURISTICS } = await import('../js/axc/nnsearch.js');
    assert.deepEqual(HYBRID_HEURISTICS, ['local', 'efficiency', 'sequential', 'tabu', 'grasp', 'ga']);
    for (const h of ['exhaustive', 'random']) await assert.rejects(hybridSearch(P, { heuristic: h }), /heurística desconhecida/);
});
