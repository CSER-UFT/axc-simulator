// Peças FPGA da página de redes, estimativa de BRAM18 e latência com os ramos em paralelo (etapa 24: os relatórios do
// Vitis HLS 2022.2 e do Vivado da ResNet 8 na xc7a100t).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeNet } from '../js/axc/nn.js';
import { bram18Of, costModel } from '../js/axc/nngen.js';
import { PARTS, DEFAULT_PART, occupancy } from '../js/axc/parts.js';
import { resnet8Json } from './fixtures/resnet8.js';

const R = new URL('../', import.meta.url);
const D = (f) => JSON.parse(readFileSync(new URL(`data/${f}`, R), 'utf8'));

test('BRAM18 por vetor como na síntese da ResNet 8', () => {
    // [palavras, bits, BRAM18 no relatório do Vitis]
    const cases = [
        [16384, 8, 8], [18496, 8, 16], [10368, 8, 8], [9248, 8, 8], [6400, 8, 4], [4096, 8, 2], [3468, 8, 2],
        [16384, 24, 24], [4096, 26, 6], [18432, 8, 16], [36864, 8, 32], [2304, 8, 2], [432, 8, 1], [640, 8, 1],
        [64, 16, 1], [64, 24, 1], [64, 8, 0], [32, 24, 0], [16, 15, 0],
    ];
    for (const [w, b, n] of cases) assert.equal(bram18Of(w, b), n, `${w} x ${b}`);
});

test('ocupação da peça e aviso quando não cabe', () => {
    const t = { luts: 77281, ff: 60844, dsp: 8, bram18: 236 };
    const a = occupancy(t, 'xc7a100tcsg324-1'), b = occupancy(t, 'xc7a200tsbg484-1');
    assert.deepEqual(a.over.map((r) => r.k), ['luts']);
    assert.equal(b.over.length, 0);
    assert.equal(PARTS[DEFAULT_PART].luts, 63400);
    const models = D('nn/models.json').models;
    assert.equal(models.find((m) => m.id === 'resnet8-cifar10').part, 'xc7a200tsbg484-1');
    assert.ok(models.filter((m) => m.id !== 'resnet8-cifar10').every((m) => !m.part));
});

test('latência da rede: o atalho roda junto com o ramo principal', () => {
    const synth = D('synth.json'), cells = D('hls-cells.json'), fpga = D('vivado-units.json');
    const net = decodeNet(resnet8Json(3, 4));
    const r = costModel(net, { synth, cells, fpga, target: 'fpga', clockNs: 10 }).network();
    const cyc = (n) => r.layers.find((l) => l.name === n).cycles;
    // Os dois atalhos com convolução (s2sc, s3sc) são mais curtos que o ramo principal de cada bloco.
    assert.equal(r.totals.cyclesSeq, r.layers.reduce((a, l) => a + l.cycles, 0));
    assert.equal(r.totals.cycles, r.totals.cyclesSeq - cyc('s2sc') - cyc('s3sc'));
    assert.ok(r.totals.bram18 >= r.totals.tensorBram18 && r.totals.tensorBram18 > 0);
    // Rede em sequência: a latência é a soma.
    const mini = decodeNet(D('nn/minilenet-mnist.json'));
    const m = costModel(mini, { synth, cells, fpga, target: 'fpga', clockNs: 10 }).network();
    assert.equal(m.totals.cycles, m.totals.cyclesSeq);
});
