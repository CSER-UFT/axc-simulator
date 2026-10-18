import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { synthesize, MODEL } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';
import { parse, HlsError } from '../js/hls/lang.js';

const synth = JSON.parse(readFileSync('data/synth.json', 'utf8'));
const cells = JSON.parse(readFileSync('data/hls-cells.json', 'utf8'));
const run = (src, o = {}) => synthesize(src, { synth, cells, clockNs: 5, ...o });
const kernel = (id) => KERNELS.find((k) => k.id === id).code;
const loop = (r, label) => r.design.loops.find((l) => l.label === label);

test('linguagem: erros com a linha', () => {
    assert.throws(() => parse('void f(u8 a[4]) {\n  if (a[0]) a[1] = 1;\n}'), (e) => e instanceof HlsError && e.line === 2);
    assert.throws(() => run('void f(u8 a[4], u8 b[4]) {\n for (int i = 0; i < 4; i++) b[i] = a[i] / 3;\n}'), /potência de 2/);
    assert.throws(() => run('void f(u32 a[4], u32 b[4]) {\n for (int i = 0; i < 4; i++) b[i] = a[i] * a[i];\n}'), /8 e 16 bits/);
});

test('gaussiano: o II vem das portas da memória e cai com a partição', () => {
    const noPart = kernel('gauss').replace(/#pragma HLS array_partition.*\n/, '');
    const a = run(noPart);
    assert.equal(loop(a, 'cols').IIachieved, 5); // 9 leituras, 2 portas
    assert.equal(loop(a, 'cols').why.kind, 'mem');
    const b = run(kernel('gauss'));
    assert.equal(loop(b, 'cols').IIachieved, 2); // 3 bancos de linhas, 3 leituras em cada
    // Achatamento, como no Vitis: rows (sem pipeline, só com o laço cols dentro) e cols viram rows_cols, 36100
    // iterações; latência: profundidade + (N - 1) II + entrada.
    const R = loop(b, 'rows'), C = loop(b, 'cols');
    assert.equal(R.flatLabel, 'rows_cols');
    assert.equal(C.flatInto, R.id);
    assert.equal(R.flatTrip, 190 * 190);
    assert.equal(R.latency, R.iterLatency + (190 * 190 - 1) * C.IIachieved + MODEL.pipelineOverhead);
    assert.equal(b.totals.cycles, R.latency);
    // Partição cíclica de fator 3: o resto da divisão (8 bits, 12 ciclos) entra na profundidade do pipeline.
    assert.equal(b.cost.addr.urems.length, 1);
    assert.equal(b.cost.addr.urems[0].latency, 12);
    assert.equal(b.cost.addr.divs.length, 3); // linhas t1, t1 + 1 e t1 + 2
    // Sem achatamento, cols tem a sua latência e rows repete cols mais a sobrecarga.
    const nf = run(kernel('gauss'), { model: { ...MODEL, flatten: false } });
    const L = loop(nf, 'cols');
    assert.equal(L.latency, L.iterLatency + (L.tripHw - 1) * L.IIachieved + MODEL.pipelineOverhead);
    assert.equal(loop(nf, 'rows').iterLatency, L.latency + MODEL.loopOverhead + MODEL.subloopOverhead + 12);
    // Unidades: multiplicações por constante (x·19 e x·52) e somadores exatos, uma por operação, como no Vitis.
    const units = Object.fromEntries(b.cost.units.map((u) => [u.unit.name, u.count]));
    assert.equal(units['×19 (2 somas)'], 4);
    assert.equal(units['×52 (2 somas)'], 1);
    assert.equal(units['ADD16 exato'], 8);
    assert.equal(units['MUL8 exato'], undefined);
    assert.equal(units['×19 (2 somas)'] && b.cost.units.find((u) => u.unit.name === '×19 (2 somas)').unit.luts, 18); // Vivado: 18
    // Com allocation, o limite de unidades vira o limite do II.
    const c = run(noPart.replace('#pragma HLS pipeline II=1', '#pragma HLS pipeline II=1\n#pragma HLS allocation operation instances=mul limit=1'));
    assert.equal(loop(c, 'cols').IIachieved, 5);
});

test('recorrência: o acumulador de 32 bits não cabe num ciclo de 2,5 ns', () => {
    assert.equal(loop(run(kernel('dot')), 'acc').IIachieved, 1);
    const r = run(kernel('dot'), { clockNs: 2.5 });
    assert.equal(loop(r, 'acc').IIachieved, 2);
    assert.equal(loop(r, 'acc').why.kind, 'rec');
});

test('faixas: acumulador do gaussiano sem diretivas em 16 bits; leituras repetidas reaproveitadas', () => {
    const plain = kernel('gauss').replace(/#pragma HLS .*\n/g, '');
    const r = run(plain);
    assert.deepEqual(r.cost.units.map((u) => u.unit.name).sort(), ['ADD16 exato', 'MUL8 exato']);
    const s = run(kernel('sobel'));
    const loads = s.design.segments[0].nodes.filter((n) => n.op === 'load').length;
    assert.equal(loads, 8);
});

test('unroll parcial e período: menos iterações, mais unidades', () => {
    const src = kernel('dot').replace('#pragma HLS pipeline II=1', '#pragma HLS unroll factor=4');
    const r = run(src);
    const L = loop(r, 'acc');
    assert.equal(L.mode, 'sequential');
    assert.equal(L.tripHw, 64);
    // Relógio mais curto: a multiplicação de 8 bits vira multiciclo.
    const g = run(kernel('gauss'), { clockNs: 2 });
    assert.ok(g.totals.cycles > run(kernel('gauss')).totals.cycles);
    for (const k of KERNELS) {
        const x = run(k.code);
        assert.ok(x.totals.area > 0 && x.totals.energy > 0 && x.totals.cycles > 0, k.id);
    }
});

test('multiplicação por constante: dígitos (binário ou CSD) e custo', async () => {
    const { digits, makeLibrary } = await import('../js/hls/lib.js');
    assert.deepEqual([1, 3, 7, 19, 52, 255, 33].map(digits), [1, 2, 2, 3, 3, 2, 2]);
    const lib = makeLibrary(synth, cells);
    assert.equal(lib.constMul(19, 8).luts, 18);
    assert.equal(lib.constMul(-7, 8).adders, 1);
});

test('propagação de constantes: unidade com operando constante ou bits altos zero custa menos', async () => {
    const { makeLibrary } = await import('../js/hls/lib.js');
    const lib = makeLibrary(synth, cells);
    const u = lib.unit('MUL8 T8 +C');
    const none = { mask: 0, value: 0 };
    assert.equal(lib.effective(u, { a: none, b: none }).luts, u.luts);
    const k19 = lib.effective(u, { a: none, b: { mask: 0xFF, value: 19 } });
    assert.ok(k19.luts < 0.6 * u.luts); // Vivado: 9 a 14 LUTs, contra 49
    const add = lib.unit('ADD16 exato');
    const narrow = lib.effective(add, { a: { mask: 0xE000, value: 0 }, b: { mask: 0xE000, value: 0 } }); // 13 bits
    assert.ok(narrow.luts < add.luts && narrow.luts > 0.6 * add.luts);
    // Os dois operandos constantes: não sobra nada.
    assert.equal(lib.effective(u, { a: { mask: 0xFF, value: 7 }, b: { mask: 0xFF, value: 19 } }).luts, 0);
});

test('lógica de memória e registradores do pipeline: o gaussiano perto do Vivado', () => {
    const r = run(kernel('gauss'));
    // Vivado (xc7a100t, 5 ns): 729 LUTs e 590 FFs no projeto elaborado exato.
    assert.ok(Math.abs(r.totals.luts / 729 - 1) < 0.15, `LUT ${r.totals.luts}`);
    assert.ok(Math.abs(r.totals.ff / 590 - 1) < 0.15, `FF ${r.totals.ff}`);
    assert.ok(r.cost.addr.addrLuts > 0 && r.cost.addr.bankLuts > 0 && r.cost.addr.pipeFf > 0);
});
