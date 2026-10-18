import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explore, pragmaVariants, prepare, groupsOf, scoreFn, paretoPoints } from '../js/hls/dse.js';
import { KERNELS } from '../js/hls/kernels.js';

const synth = JSON.parse(readFileSync('data/synth.json', 'utf8'));
const cells = JSON.parse(readFileSync('data/hls-cells.json', 'utf8'));
const kernel = (id) => KERNELS.find((k) => k.id === id).code;

test('dse: variantes de diretivas e candidatas na fronteira de Pareto', () => {
    const v = pragmaVariants(kernel('gauss'));
    assert.equal(v.length, 4);
    assert.ok(v.some((x) => /sem pipeline/.test(x.label)) && v[0].off.length === 0);
    const p = prepare(kernel('gauss'), { synth, cells });
    const groups = groupsOf(p, { granularity: 'class', objective: 'area' });
    assert.deepEqual(groups.map((g) => g.key).sort(), ['add16', 'mul8']);
    for (const g of groups) {
        assert.equal(g.cands[0], g.exact);
        assert.ok(g.cands.length < g.all);
        // Nenhuma candidata é dominada por outra (área da unidade e erro próprio).
        const area = (n) => p.base.lib.unitByName(n).area;
        for (const a of g.cands.slice(1)) for (const b of g.cands) {
            if (a === b) continue;
            assert.ok(!(area(b) <= area(a) && g.ownOf.get(b) <= g.ownOf.get(a) && (area(b) < area(a) || g.ownOf.get(b) < g.ownOf.get(a))), `${b} domina ${a}`);
        }
    }
    assert.equal(scoreFn('weighted', {}, p.base.totals && { area: 2, energy: 3, latency: 4 })({ area: 2, energy: 3, latency: 4 }), 3);
});

test('dse: as quatro heurísticas no gaussiano, com verificação bit a bit', () => {
    const res = explore(kernel('gauss'), { synth, cells, objective: 'area', constraint: { metric: 'psnr', value: 40 }, granularity: 'class', heuristic: 'all', samples: 60 });
    const by = Object.fromEntries(res.runs.map((r) => [r.heuristic, r]));
    for (const r of res.runs) {
        assert.ok(r.chosen, r.heuristic);
        assert.ok(r.chosen.measured[0].PSNR >= 40 && r.chosen.outs[0].PSNR >= 40);
        assert.ok(r.chosen.score < res.refScore);
    }
    // Por classe, a exaustiva é o ótimo do modelo: nenhuma outra acha ponto viável mais barato.
    for (const h of ['sequential', 'efficiency', 'random']) assert.ok(by.exhaustive.best.score <= by[h].best.score + 1e-9, h);
    // Fronteira: custo crescente, erro decrescente.
    const f = paretoPoints(by.efficiency.points);
    for (let k = 1; k < f.length; k++) assert.ok(f[k].score >= f[k - 1].score && f[k].err < f[k - 1].err);
});

test('dse: grupos por operação, restrição em MSE e caminho da eficiência', () => {
    const res = explore(kernel('sharpen'), { synth, cells, objective: 'energy', constraint: { metric: 'mse', value: 30 }, granularity: 'op', heuristic: 'efficiency' });
    const r = res.runs[0];
    assert.ok(r.best.feasible && r.best.outs[0].MSE <= 30);
    assert.ok(r.best.score <= res.refScore);
    if (r.chosen) assert.ok(r.chosen.measured[0].MSE <= 30);
});

test('grupos por operação do código: as cópias do unroll juntas, os pesos da janela separados', () => {
    const sob = KERNELS.find((k) => k.id === 'sobel').code.replace('#pragma HLS pipeline II=1', '#pragma HLS pipeline II=1\n#pragma HLS unroll factor=2');
    const v = prepare(sob, { synth, cells });
    const ops = groupsOf(v, { granularity: 'op' }), src = groupsOf(v, { granularity: 'source' });
    assert.equal(src.length * 2, ops.length);
    assert.ok(src.every((g) => g.ops.length === 2));
    // No gaussiano, os laços da janela são desenrolados por estarem no pipeline: cada peso é uma origem.
    const g = prepare(KERNELS.find((k) => k.id === 'gauss').code, { synth, cells });
    assert.equal(groupsOf(g, { granularity: 'source' }).length, groupsOf(g, { granularity: 'op' }).length);
    // Com unroll nos laços da janela, as nove multiplicações viram uma origem.
    const dot4 = 'void f(u8 a[64], u8 b[64], u32 r[1]) {\n    u32 acc = 0;\n    for (int i = 0; i < 64; i++) {\n#pragma HLS unroll factor=4\n        acc += a[i] * b[i];\n    }\n    r[0] = acc;\n}';
    const d = prepare(dot4, { synth, cells });
    const dm = groupsOf(d, { granularity: 'source' }).filter((x) => x.cls === 'mul');
    assert.equal(dm.length, 1);
    assert.equal(dm[0].ops.length, 4);
});
