import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeNet, decodeTestSet, productTable, infer, mulQ32 } from '../js/axc/nn.js';
import { networkKernels, networkCost } from '../js/axc/nngen.js';
import { parse } from '../js/hls/lang.js';
import { elaborate, requantValue } from '../js/hls/elab.js';
import { execute, inputArrays, outputArrays } from '../js/hls/exec.js';
import { makeLibrary } from '../js/hls/lib.js';
import { synthesize } from '../js/hls/index.js';

const D = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const synth = D('synth.json'), cells = D('hls-cells.json'), fpga = D('vivado-units.json');
const registry = D('nn/models.json');
const load = (id) => {
    const json = D(`nn/${id}.json`);
    return { net: decodeNet(json), test: decodeTestSet(readFileSync(new URL(`../${json.dataset.file}`, import.meta.url)), json.dataset) };
};

test('reescala (requant): a função do C, a peça medida e a constante dobrada na elaboração', () => {
    for (const [acc, m, z] of [[0, 5718256, 0], [123456, 17194236, 64], [-98765, 4461137, 69], [2 ** 30, 4000000000, 0], [-(2 ** 31), 1, 127]]) {
        assert.equal(requantValue(acc, m, z), Math.min(255, Math.max(0, mulQ32(acc, m) + z)));
    }
    const r = cells.cells.requant[32];
    assert.ok(r.delay.area > 30000 && r.delay.dsp === 4 && r.delay.energy < 100000, JSON.stringify(r.delay));
    const d = elaborate(parse('void k(u8 y[1]) { y[0] = requant(123456, 17194236, 64); }'), { ports: 2 });
    const st = d.segments.flatMap((s) => s.nodes).find((n) => n.op === 'store');
    assert.deepEqual(st.args[0], { c: requantValue(123456, 17194236, 64) });
});

test('somadores das redes na biblioteca (opção wide): largura da soma, técnica e cascatas', () => {
    const lib = makeLibrary(synth, cells, { wide: true });
    const old = makeLibrary(synth, cells, {});
    assert.equal(lib.exactUnit('add', 32).name, 'ADD32 exato');
    assert.equal(old.exactUnit('add', 32).name, 'ADD32 (2 × ADD16 exato)');
    assert.equal(lib.adderFor('ADD32 LOA10', 24), 'ADD24 LOA10');
    assert.equal(lib.adderFor('ADD32 SEG L8 P4', 16), 'ADD16 SEG L8 P4');
    assert.equal(lib.adderFor('ADD32 TRUNC20', 16), 'ADD16 TRUNC16');
    assert.equal(lib.adderFor('ADD16 LOA8', 24), 'ADD24 (ADD16 LOA8 + ADD8 exato)');
    assert.equal(lib.adderFor('ADD16 LOA8', 32), 'ADD32 (ADD16 LOA8 + ADD16 exato)');
    const c = lib.unitByName('ADD24 (ADD16 LOA8 + ADD8 exato)');
    assert.equal(c.cfg.width, 24);
    assert.ok(Math.abs(c.area - lib.unit('ADD16 LOA8').area - lib.unit('ADD8 exato').area) < 1e-9);
});

test('código gerado: os kernels, executados em sequência, dão as mesmas saídas do avaliador das redes', () => {
    for (const m of registry.models) {
        const { net, test: ts } = load(m.id);
        const ks = networkKernels(net).map((k) => ({ ...k, design: elaborate(parse(k.src), { ports: 2 }) }));
        assert.deepEqual(ks.map((k) => k.type).filter((t) => t === 'conv' || t === 'dense').length, net.sites.length);
        const T = productTable(null), tabs = net.sites.map(() => T);
        const img = ts.images.subarray(0, ts.size);
        let x = Array.from(img, (p, i) => net.inputLuts[Math.floor(i / (img.length / net.inputLuts.length))][p]);
        for (const k of ks) {
            const [inA] = inputArrays(k.design), [outA] = outputArrays(k.design);
            const res = execute(k.design, new Map([[inA.name ?? inA, Float64Array.from(x)]]));
            x = [...res.mem.get(outA.name ?? outA)];
        }
        assert.deepEqual(x, [...infer(net, img, tabs).out], m.id);
    }
});

test('custo da rede: memória limita o II das convoluções, a reescala usa DSP, as unidades aproximadas economizam', () => {
    const { net } = load('minilenet-mnist');
    const o = { synth, cells, fpga, clockNs: 10 };
    const ex = networkCost(net, o);
    const conv = (c, name) => c.layers.find((l) => l.name === name);
    // 25 leituras de x por iteração com 2 portas: II 13; na conv2, 75 leituras: II 38.
    assert.equal(conv(ex, 'conv1').II, 13);
    assert.equal(conv(ex, 'conv2').II, 38);
    assert.equal(ex.totals.dsp, 4 * net.sites.length);
    assert.equal(ex.totals.cycles, ex.layers.reduce((s, l) => s + l.cycles, 0));
    const mul = networkCost(net, { ...o, mul: 'MUL8 T4' });
    const add = networkCost(net, { ...o, add: 'ADD32 LOA10' });
    const cas = networkCost(net, { ...o, add: 'ADD16 LOA8' });
    for (const c of [mul, add, cas]) assert.ok(c.totals.area < ex.totals.area);
    // Só as camadas marcadas mudam.
    const only1 = networkCost(net, { ...o, add: 'ADD32 LOA10', mask: [true, false, false, false] });
    assert.ok(only1.totals.area < ex.totals.area && only1.totals.area > add.totals.area);
    for (const l of only1.layers.filter((x) => x.name !== 'conv1')) assert.equal(l.area, ex.layers.find((y) => y.name === l.name).area, l.name);
    // Os kernels das páginas de síntese de alto nível continuam sem a opção wide.
    const names = synthesize('void k(u16 a[4], u16 b[4], u32 r[4]) { for (int i = 0; i < 4; i++) r[i] = a[i] + b[i] + 70000; }', { synth, cells }).cost.units.map((u) => u.unit.name);
    assert.ok(names.includes('ADD32 (2 × ADD16 exato)') && !names.includes('ADD32 exato'), names.join(', '));
});
