import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { decodeNet, decodeTestSet } from '../js/axc/nn.js';
import { networkCost } from '../js/axc/nngen.js';
import { networkProject } from '../js/axc/nnexport.js';

const R = new URL('../', import.meta.url);
const D = (f) => JSON.parse(readFileSync(new URL(`data/${f}`, R), 'utf8'));
const synth = D('synth.json'), cells = D('hls-cells.json'), fpga = D('vivado-units.json');
const net = decodeNet(D('nn/minilenet-mnist.json'));
const testSet = decodeTestSet(readFileSync(new URL(net.dataset.file, R)), net.dataset);
const dirs = [{}, { part: true }, { part: true, par: 7 }, {}];
// Uma cascata (ADD16 LOA8 nas somas de 24 e 32 bits), unidades de 32 bits e um multiplicador por camada.
const units = [{ mul: 'MUL8 T4', add: 'ADD16 LOA8' }, { mul: 'MUL8 T6 A4c', add: 'ADD32 LOA10' }, { mul: null, add: 'ADD32 TRUNC4' }, { mul: 'MUL8 MITCHELL', add: null }];

test('exportação da rede: topo com as camadas em sequência, caixas pretas, testbench, Tcl e previsões', () => {
    const { files, summary } = networkProject(net, { synth, cells, fpga, dirs, units, test: testSet, images: 3, id: 'teste' });
    const k = files['network/kernel.cpp'];
    const names = summary.layers.map((l) => l.name);
    assert.deepEqual(names, ['pad1', 'conv1', 'pool1', 'pad2', 'conv2', 'pool2', 'flatten', 'fc1', 'fc2']);
    // Uma função por camada, com INLINE off, e o topo chamando na ordem.
    assert.equal((k.match(/#pragma HLS INLINE off\n/g) ?? []).length >= names.length, true);
    let at = k.indexOf('void network(');
    assert.ok(at > 0);
    for (const n of names) { const p = k.indexOf(`    ${n}(`, at); assert.ok(p > at, n); at = p; }
    assert.ok(k.includes('axc_requant(') && k.includes('BIND_OP variable=p op=mul impl=dsp'));
    // A cascata vira uma função com o somador de baixo de 16 bits.
    assert.ok(/u_ADD\d+_ADD16_LOA8_ADD\d+_exato/.test(k), 'cascata');
    assert.ok(files['network/run.tcl'].includes('set_top network') && files['network/run.tcl'].includes('add_files -blackbox u_ADD16_LOA8_bb.json'));
    // Os somadores entram na largura de cada soma (ADD32 LOA10 vira ADD24 LOA10 nas somas de 24 bits).
    const bbs = Object.keys(files).filter((f) => /^network\/u_.*_bb\.v$/.test(f)).join(' ');
    for (const u of ['MUL8_T4', 'MUL8_T6_A4c', 'ADD\\d+_LOA10', 'ADD\\d+_TRUNC4', 'MUL8_MITCHELL', 'ADD16_LOA8']) assert.match(bbs, new RegExp(`u_${u}_bb\\.v`), u);
    assert.equal(files['network/expected.dat'].trim().split('\n').length, 3);
    assert.equal(files['network/images.dat'].trim().split('\n')[0].split(' ').length, testSet.size);
    // As previsões são as do modelo de custo com as mesmas diretivas e unidades.
    const c = networkCost(net, { synth, cells, fpga, target: 'fpga', clockNs: 10, dirs, units });
    assert.equal(summary.totals.cycles, c.totals.cycles);
    assert.equal(summary.totals.luts, c.totals.luts);
    // Projetos por camada e o script.
    for (const n of names) assert.ok(files[`layers/${n}/kernel.cpp`] && files[`layers/${n}/run.tcl`], n);
    assert.ok(files['run_all.sh'].includes('layers/conv2') && files['LEIAME.txt'].includes('nnvitis'));
});

// Com os cabeçalhos ap_int (AXC_APINT=pasta, ou o Vitis instalado), compila a rede com g++ e roda o testbench.
const inc = process.env.AXC_APINT ?? '/tools/Xilinx/Vitis_HLS/2022.2/include';
test('exportação da rede: g++ com ap_int dá as mesmas saídas do simulador (se houver os cabeçalhos)', { skip: !existsSync(join(inc, 'ap_int.h')) }, () => {
    const { files } = networkProject(net, { synth, cells, fpga, dirs, units, test: testSet, images: 3, layers: false });
    const dir = mkdtempSync(join(tmpdir(), 'axc-nn-'));
    try {
        for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), c); }
        const nd = join(dir, 'network');
        execSync(`g++ -O0 -std=c++14 -w -I${inc} -I. kernel.cpp tb.cpp u_*_bb.cpp -o tb`, { cwd: nd, stdio: 'pipe' });
        const outp = execSync('./tb', { cwd: nd }).toString();
        assert.match(outp, /AXC_MISMATCHES 0 OF 30/);
        assert.match(outp, /AXC_ACCURACY \d+ OF 3/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
