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
    // A reescala com os operandos da MiniLenet (acc de até 25 bits, m de 24): 2 DSP48 por camada, como no Vivado; na
    // rede, um módulo só, compartilhado entre as camadas (como o Vitis faz).
    for (const l of ex.layers.filter((x) => x.site !== null)) assert.equal(l.dsp, 2, l.name);
    assert.equal(ex.totals.dsp, 2);
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

test('partição em duas dimensões: uma diretiva por dimensão, os bancos se combinam', () => {
    const src = (pr) => `void k(u8 x[34][34], u16 y[32][32]) {
${pr}
    for (int i = 0; i < 32; i++)
        for (int j = 0; j < 32; j++) {
#pragma HLS pipeline II=1
            u16 s = 0;
            for (int a = 0; a < 3; a++) for (int b = 0; b < 3; b++) s += x[i + a][j + b];
            y[i][j] = s;
        }
}`;
    const II = (pr) => synthesize(src(pr), { synth, cells, clockNs: 10 }).design.loops.find((l) => l.mode === 'pipelined').IIachieved;
    assert.equal(II(''), 5);
    assert.equal(II('#pragma HLS array_partition variable=x cyclic factor=4 dim=1'), 2);
    assert.equal(II('#pragma HLS array_partition variable=x cyclic factor=4 dim=1\n#pragma HLS array_partition variable=x cyclic factor=4 dim=2'), 1);
    // Partição completa de uma dimensão de um vetor de duas: um banco por linha (não registradores).
    const d = elaborate(parse(src('#pragma HLS array_partition variable=x complete dim=1')), { ports: 2 });
    const x = d.arrays.find((a) => a.name === 'x');
    assert.ok(!x.regs && x.banked[0].factor === 34);
});

test('diretivas: o código gerado, executado com o somador aproximado, dá a soma da estrutura das diretivas', async () => {
    const { adderAccumulate } = await import('../js/axc/nn.js');
    const { buildUnit } = await import('../js/axc/units.js');
    const { directiveTrees, parOptions } = await import('../js/axc/nngen.js');
    const { net, test: ts } = load('minilenet-mnist');
    const acc = adderAccumulate(buildUnit({ kind: 'add', width: 32, adder: 'seg', L: 8, P: 4 }));
    const a1 = new Int32Array(1), b1 = new Int32Array(1);
    const fadd = (x, y) => { a1[0] = x; b1[0] = y; acc(a1, b1, 1); return a1[0]; };
    const img = ts.images.subarray(0, ts.size);
    const sets = [
        null,
        net.sites.map((l) => ({ pipe: l.type === 'conv' ? 'tap' : 'input', part: true, par: l.type === 'dense' ? parOptions(l)[1] : 1 })),
        net.sites.map((l) => ({ pipe: 'off' })),
        net.sites.map((l) => ({ part: true, par: parOptions(l).at(-1) })),
    ];
    for (const dirs of sets) {
        const trees = directiveTrees(net, dirs);
        const want = [...infer(net, img, net.sites.map(() => productTable(null)), net.sites.map(() => acc), undefined, trees).out];
        let x = Array.from(img, (p) => net.inputLuts[0][p]);
        for (const k of networkKernels(net, dirs)) {
            const d = elaborate(parse(k.src), { ports: 2 });
            const ops = new Map();
            if (k.site !== null) for (const s of d.segments) for (const n of s.nodes) if (n.op === 'add') ops.set(n.id, fadd);
            const [inA] = inputArrays(d), [outA] = outputArrays(d);
            x = [...execute(d, new Map([[inA.name ?? inA, Float64Array.from(x)]]), { ops }).mem.get(outA.name ?? outA)];
        }
        assert.deepEqual(x, want, `estrutura ${trees.join(',')}`);
    }
});

test('diretivas: II, paralelismo e partição mudam o custo como esperado', async () => {
    const { normalizeDirectives, directiveTrees } = await import('../js/axc/nngen.js');
    const { net } = load('minilenet-mnist');
    const o = { synth, cells, fpga, clockNs: 10 };
    const L = (c, n) => c.layers.find((l) => l.name === n);
    const base = networkCost(net, o);
    // Padrão: a janela inteira em árvore nas conv, cadeia nas densas.
    assert.deepEqual(directiveTrees(net, null), [0, 0, 1, 1]);
    // Partição: a entrada e os pesos em bancos; o II cai para 1 nas duas conv.
    const part = networkCost(net, { ...o, dirs: [{ part: true }, { part: true }, {}, {}] });
    assert.equal(L(part, 'conv1').II, 1);
    assert.equal(L(part, 'conv2').II, 1);
    assert.ok(L(part, 'conv2').cycles * 20 < L(base, 'conv2').cycles);
    // Com 3 filtros por iteração (todos), a conv1 leva um terço dos ciclos e usa 3 reescalas (DSP).
    const pf = networkCost(net, { ...o, dirs: [{ part: true, par: 3 }, {}, {}, {}] });
    assert.ok(Math.abs(L(pf, 'conv1').cycles * 3 - L(part, 'conv1').cycles) < 50);
    assert.equal(L(pf, 'conv1').dsp, 6);
    // II pedido maior que o da memória.
    const ii = networkCost(net, { ...o, dirs: [{}, { ii: 50 }, {}, {}] });
    assert.equal(L(ii, 'conv2').II, 50);
    // Densa com 7 produtos por iteração, com e sem partição.
    const u7 = networkCost(net, { ...o, dirs: [{}, {}, { par: 7, part: true }, {}] });
    const u7n = networkCost(net, { ...o, dirs: [{}, {}, { par: 7 }, {}] });
    assert.equal(L(u7, 'fc1').II, 1);
    assert.equal(L(u7n, 'fc1').II, 4);
    assert.equal(L(u7n, 'fc1').IIwhy.kind, 'mem');
    // Laço kx: um produto por ciclo; sem pipeline: área menor, muito mais ciclos.
    const tap = networkCost(net, { ...o, dirs: [{ pipe: 'tap' }, {}, {}, {}] });
    assert.ok(L(tap, 'conv1').area < L(base, 'conv1').area && L(tap, 'conv1').cycles > 3 * 28 * 28 * 25);
    // Valores inválidos voltam ao padrão.
    assert.deepEqual(normalizeDirectives(net, [{ par: 2 }, { pipe: 'tap', par: 3 }, { pipe: 'x', ii: 0 }, {}]).map((d) => [d.pipe, d.ii, d.par]),
        [['pixel', 1, 1], ['tap', 1, 1], ['input', 1, 1], ['input', 1, 1]]);
});
