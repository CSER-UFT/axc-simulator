import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synthesize } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';
import { parseAssign, opFunction } from '../js/hls/approx.js';
import { execute, makeInputs } from '../js/hls/exec.js';
import { exportIR, exportSource, kernelHeader, testbench, cName } from '../js/hls/vitis.js';

const synth = JSON.parse(readFileSync('data/synth.json', 'utf8'));
const cells = JSON.parse(readFileSync('data/hls-cells.json', 'utf8'));
const kernel = (id) => KERNELS.find((k) => k.id === id).code;

function files(id, spec = '') {
    const b = synthesize(kernel(id), { synth, cells });
    const r = synthesize(kernel(id), { synth, cells, assign: spec ? parseAssign(b.ops, spec) : null, design: b.design });
    const inputs = makeInputs(r.design, 'image');
    const ops = new Map([...r.assign].map(([k, n]) => [k, opFunction(r.lib, r.ops.byId.get(k), n)]));
    const f = testbench(r.design, inputs, execute(r.design, inputs, { ops: ops.size ? ops : null }));
    f['kernel.h'] = kernelHeader(r.design);
    f['kernel.cpp'] = exportIR(r);
    return { r, f };
}

test('vitis: C++ do projeto elaborado com as diretivas e as unidades', () => {
    const { r, f } = files('gauss', 'mul8=MUL8 DRUM6');
    const k = f['kernel.cpp'];
    assert.match(k, /#pragma HLS PIPELINE II=1/);
    assert.match(k, /#pragma HLS PIPELINE off/);
    assert.match(k, /#pragma HLS ARRAY_PARTITION variable=in type=cyclic factor=3 dim=1/);
    assert.match(k, new RegExp(`static ap_uint<16> ${cName('MUL8 DRUM6')}\\(`));
    assert.equal((k.match(new RegExp(`${cName('MUL8 DRUM6')}\\(ap_uint<8>\\(`, 'g')) ?? []).length, 5); // as 5 chamadas
    assert.ok(f['exp_out.dat'].split('\n').filter(Boolean).length === 190 * 190);
    assert.match(exportSource(kernel('sobel'), synthesize(kernel('sobel'), { synth, cells }).design), /#define abs\(a\)/);
    assert.equal(r.assign.size, 5);
});

// Com os cabeçalhos ap_int disponíveis (AXC_APINT=pasta), compila e roda com g++: o C++ calcula o mesmo que o simulador.
const inc = process.env.AXC_APINT ?? '/tools/Xilinx/Vitis_HLS/2022.2/include';
test('vitis: g++ com ap_int confere bit a bit (se houver os cabeçalhos)', { skip: !existsSync(join(inc, 'ap_int.h')) }, () => {
    for (const [id, spec] of [['dot', 'mul8=MUL8 T4'], ['fir', 'mul8=MUL8 DRUM4;add16=ADD16 LOA4;add32=ADD32 (ADD16 LOA4 + ADD16 exato)']]) {
        const { f } = files(id, spec);
        const dir = mkdtempSync(join(tmpdir(), 'axc-vitis-'));
        for (const [n, t] of Object.entries(f)) writeFileSync(join(dir, n), t);
        execSync(`g++ -std=c++14 -O1 -w -I"${inc}" -I. kernel.cpp tb.cpp -o tb`, { cwd: dir });
        assert.match(execSync('./tb', { cwd: dir }).toString(), /AXC_MISMATCHES 0 OF/);
    }
});

test('caixa preta de RTL: JSON, Verilog com as portas do Vitis e modelo C para cada unidade', async () => {
    const { blackboxFiles } = await import('../js/hls/vitis.js');
    const { makeLibrary } = await import('../js/hls/lib.js');
    const lib = makeLibrary(synth, cells);
    const bb = blackboxFiles(lib, ['MUL8 T4', 'ADD32 (ADD16 LOA8 + ADD16 exato)']);
    assert.deepEqual(bb.jsons.sort(), ['u_ADD16_LOA8_bb.json', 'u_MUL8_T4_bb.json']); // o de 32 bits entra pelo de baixo
    const j = JSON.parse(bb.files['u_MUL8_T4_bb.json']);
    assert.equal(j.rtl_top_module_name, 'u_MUL8_T4_bb');
    assert.equal(j.rtl_performance.latency, '0');
    const v = bb.files['u_MUL8_T4_bb.v'];
    for (const p of ['ap_clk', 'ap_rst', 'ap_ce', 'ap_return']) assert.ok(v.includes(p));
    assert.equal(j.c_return.rtl_ports.data_write_out, 'ap_return');
    assert.match(bb.files['u_MUL8_T4_bb.cpp'], /ap_uint<16> u_MUL8_T4_bb\(ap_uint<8> a, ap_uint<8> b\)/);
});

test('projeto para baixar: kernel, caixas pretas com invólucro, testbench, Tcl e LEIAME num .zip', async () => {
    const { projectFiles } = await import('../js/hls/vitis.js');
    const { makeZip } = await import('../js/ui/zip.js');
    const { parseAssign } = await import('../js/hls/approx.js');
    const { analyzeError } = await import('../js/hls/error.js');
    const { makeInputs } = await import('../js/hls/exec.js');
    const { synthesize } = await import('../js/hls/index.js');
    const { KERNELS } = await import('../js/hls/kernels.js');
    const { readFileSync } = await import('node:fs');
    const synth = JSON.parse(readFileSync(new URL('../data/synth.json', import.meta.url)));
    const cells = JSON.parse(readFileSync(new URL('../data/hls-cells.json', import.meta.url)));
    const src = KERNELS.find((k) => k.id === 'sharpen').code;
    const b = synthesize(src, { synth, cells });
    const r = synthesize(src, { synth, cells, design: b.design, assign: parseAssign(b.ops, '*=ADD16 TRUNC2') });
    const inputs = makeInputs(r.design, 'image');
    const a = analyzeError(r, { inputs, budget: false });
    const files = projectFiles(r, { inputs, expected: a.approx, clockNs: 5, id: 'teste' });
    for (const f of ['kernel.cpp', 'kernel.h', 'tb.cpp', 'run.tcl', 'model.json', 'LEIAME.txt', 'u_ADD16_TRUNC2_bb.v', 'u_ADD16_TRUNC2_bb.json', 'u_ADD16_TRUNC2_bb.cpp']) assert.ok(files[f], f);
    // O invólucro: o módulo com o nome da função C e as portas que o Vitis exige.
    assert.match(files['u_ADD16_TRUNC2_bb.v'], /module u_ADD16_TRUNC2_bb\s*\(/);
    assert.match(files['u_ADD16_TRUNC2_bb.v'], /ap_return/);
    assert.match(files['run.tcl'], /add_files -blackbox u_ADD16_TRUNC2_bb\.json/);
    const zip = makeZip(files);
    const dv = new DataView(zip.buffer);
    assert.equal(dv.getUint32(0, true), 0x04034b50);
    assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50);
    assert.equal(dv.getUint16(zip.length - 12, true), Object.keys(files).length);
});
