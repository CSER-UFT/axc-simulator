#!/usr/bin/env node
/**
 * Custos das peças do caminho de dados que não são unidades aritméticas, para o modelo de HLS (js/hls): multiplexador
 * de 2 entradas, lógica bit a bit (XOR como representante), comparador e registrador, em 8, 16 e 32 bits. Mesmo
 * fluxo das unidades (scripts/lib/asic.mjs): Yosys e ABC na sky130_fd_sc_hd (nos dois fluxos, como as unidades), OpenSTA para o
 * atraso (buf_2 nas entradas, 5 fF nas saídas, modelo de fio Small) e para a energia, aqui com atividade de 0,5 nas
 * entradas propagada pelo OpenSTA, nos fluxos de atraso mínimo e de área mínima (sem simulação: são circuitos rasos, sem pulsos espúrios relevantes). O registrador
 * é a célula sky130_fd_sc_hd__dfxtp_1, lida da biblioteca completa: área, atraso do relógio à saída, tempo de setup e
 * energia por ciclo com o dado mudando em metade dos ciclos. Para FPGA, as LUTs de cada peça com o synth_xilinx.
 *
 * Uso: node scripts/hls-cells.mjs [--out data/hls-cells.json]
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createFlow } from './lib/asic.mjs';

const args = process.argv.slice(2);
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'data/hls-cells.json';
const work = 'build/hls-cells';
mkdirSync(work, { recursive: true });
const F = await createFlow({ work, cacheDir: 'build/synth-cache' });
const { sh, read, lib, STA, abcScript, FLOWS, SYNTH } = F;
const RAW = 'build/pdk/sky130_fd_sc_hd__tt_025C_1v80.lib';
const PERIOD = 10;

const MODULES = {
    mux: (N) => `module m(input [${N - 1}:0] a, input [${N - 1}:0] b, input s, output [${N - 1}:0] y); assign y = s ? a : b; endmodule`,
    xor: (N) => `module m(input [${N - 1}:0] a, input [${N - 1}:0] b, output [${N - 1}:0] y); assign y = a ^ b; endmodule`,
    cmp: (N) => `module m(input [${N - 1}:0] a, input [${N - 1}:0] b, output y); assign y = a < b; endmodule`,
};

/** Atraso, energia por operação (atividade 0,5 nas entradas, uma operação por período) e área de um módulo. */
async function measure(kind, N, flow) {
    const base = join(work, `${kind}${N}.${flow}`);
    writeFileSync(`${base}.v`, MODULES[kind](N));
    await sh(`yosys -q -p "read_verilog ${base}.v; synth -flatten -top m; abc -liberty ${lib.file} -script ${abcScript(FLOWS[flow])}; opt_clean; write_verilog -noattr ${base}.net.v; tee -q -o ${base}.stat stat -liberty ${lib.file}"`);
    const area = +/Chip area for module .*: ([\d.]+)/.exec(read(`${base}.stat`))[1];
    writeFileSync(`${base}.tcl`, `read_liberty ${lib.file}
read_verilog ${base}.net.v
link_design m
set_wire_load_model -name ${STA.wireLoad}
create_clock -name vclk -period ${PERIOD}
set_input_delay 0 -clock vclk [all_inputs]
set_output_delay 0 -clock vclk [all_outputs]
set_driving_cell -lib_cell ${STA.driver} -pin X [all_inputs]
set_load ${STA.load} [all_outputs]
set_power_activity -input -activity 0.5
report_checks -path_delay max -digits 4
report_power -digits 8
`);
    const { stdout } = await sh(`sta -no_splash -exit ${base}.tcl`);
    const delay = +/([\d.]+)\s+data arrival time/.exec(stdout)[1];
    const tot = /\nTotal\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/.exec(stdout);
    const energy = (+tot[1] + +tot[2]) * PERIOD * 1e-9 * 1e15;
    await sh(`yosys -q -p "read_verilog ${base}.v; ${SYNTH} -top m; tee -q -o ${base}.fpga.json stat -json"`);
    const cells = JSON.parse(read(`${base}.fpga.json`)).design.num_cells_by_type;
    const luts = Object.entries(cells).filter(([k]) => /^LUT\d$/.test(k)).reduce((s, [, n]) => s + n, 0);
    return { area: +area.toFixed(2), delay: Math.round(delay * 1000), energy: +energy.toFixed(2), luts, carry4: cells.CARRY4 ?? 0 };
}

/** Registrador de 1 bit (dfxtp_1): área da biblioteca, relógio para a saída, setup e energia por ciclo. */
async function register() {
    const base = join(work, 'dff');
    writeFileSync(`${base}.net.v`, 'module r(input clk, input d, output q); sky130_fd_sc_hd__dfxtp_1 f (.CLK(clk), .D(d), .Q(q)); endmodule\n');
    writeFileSync(`${base}.tcl`, `read_liberty ${RAW}
read_verilog ${base}.net.v
link_design r
create_clock -name clk -period ${PERIOD} [get_ports clk]
set_input_delay 0 -clock clk [get_ports d]
set_output_delay 0 -clock clk [get_ports q]
set_load ${STA.load} [get_ports q]
set_driving_cell -lib_cell ${STA.driver} -pin X [get_ports d]
set_power_activity -input_port d -activity 0.5
report_checks -from [get_ports d] -digits 4
report_checks -to [get_ports q] -digits 4
report_power -digits 8
`);
    const { stdout } = await sh(`sta -no_splash -exit ${base}.tcl`);
    const setup = Math.abs(+/(-?[\d.]+)\s+[\d.]+\s+library setup time/.exec(stdout)[1]);
    const clkToQ = +/([\d.]+)\s+[\d.]+\s+[\^v]\s+f\/Q/.exec(stdout)[1];
    const tot = /\nTotal\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/.exec(stdout);
    const area = +new RegExp('cell \\("sky130_fd_sc_hd__dfxtp_1"\\) \\{[\\s\\S]*?\\n\\s*area : ([\\d.]+)').exec(read(RAW))[1];
    return {
        cell: 'sky130_fd_sc_hd__dfxtp_1', area, clkToQ: Math.round(clkToQ * 1000), setup: Math.round(setup * 1000),
        energy: +((+tot[1] + +tot[2]) * PERIOD * 1e-9 * 1e15).toFixed(3), leakage: +(+tot[3] * 1e9).toFixed(4),
    };
}

const out = { generated: new Date().toISOString().slice(0, 10), library: 'sky130_fd_sc_hd, tt_025C_1v80', tools: F.tools, flows: { delay: abcScript(FLOWS.delay), area: abcScript(FLOWS.area) },
    units: { area: 'µm²', delay: 'ps', energy: 'fJ por operação (registrador: por ciclo de relógio)', fpga: 'LUTs e CARRY4 do synth_xilinx' },
    note: 'energia das peças combinacionais com atividade 0,5 nas entradas propagada pelo OpenSTA; registrador com o dado mudando em metade dos ciclos',
    cells: {}, register: await register() };
for (const kind of Object.keys(MODULES)) {
    out.cells[kind] = {};
    for (const N of [8, 16, 32]) {
        out.cells[kind][N] = {};
        for (const flow of ['delay', 'area']) out.cells[kind][N][flow] = await measure(kind, N, flow);
    }
}
writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ register: out.register, mux16: out.cells.mux[16], xor16: out.cells.xor[16], cmp16: out.cells.cmp[16] }, null, 1));
