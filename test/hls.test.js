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
    // Latência do laço com pipeline: profundidade + (N - 1) II + entrada.
    const L = loop(b, 'cols');
    assert.equal(L.latency, L.iterLatency + (L.tripHw - 1) * L.IIachieved + MODEL.pipelineOverhead);
    // Unidades: o mínimo para o II (5 multiplicações e 8 somas em 2 ciclos).
    const units = Object.fromEntries(b.cost.units.map((u) => [u.unit.name, u.count]));
    assert.equal(units['MUL8 exato'], 3);
    assert.equal(units['ADD16 exato'], 4);
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
