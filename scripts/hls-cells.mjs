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
 * A reescala das redes neurais (requant): min(255, max(0, ((acc × m + 2^31) >> 32) + z)), com acc int32, m uint32 e
 * z de 8 bits, a função requantize do código C da MiniLenet. É exata e não muda com as unidades aproximadas; no FPGA,
 * a multiplicação de 32 × 32 bits vai para DSP48 (como no Vitis), e a peça guarda as LUTs, os CARRY4 e os DSPs dessa
 * síntese. A energia dela vem de uma simulação da netlist (como a das unidades), com 2048 vetores em sequência numa
 * faixa típica das redes: acumulador uniforme em ±2^17, m entre 2^20 e 2^25 (M entre 2^-12 e 2^-7) e z de 0 a 127; a
 * atividade 0,5 propagada pelo OpenSTA superestima muito a energia de um multiplicador.
 *
 * Uso: node scripts/hls-cells.mjs [--out data/hls-cells.json] [--only requant]
 *   --only requant  mede só a reescala e a acrescenta ao arquivo, sem medir de novo as outras peças
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

/** Reescala: (acc × m + 2^31) >> 32 com sinal, mais o ponto zero, saturada entre 0 e 255. */
const REQUANT = `module m(input signed [31:0] acc, input [31:0] mq, input [7:0] z, output [7:0] y);
    wire signed [64:0] p = acc * $signed({1'b0, mq});
    wire signed [64:0] r = (p + 65'sd2147483648) >>> 32;
    wire signed [33:0] v = r[33:0] + $signed({26'd0, z});
    assign y = v < 0 ? 8'd0 : v > 255 ? 8'd255 : v[7:0];
endmodule`;

/** Energia da reescala por simulação da netlist mapeada (2048 vetores em sequência, um por período). */
async function requantEnergy(base) {
    let x = 2027;
    const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const hex = [];
    for (let k = 0; k < 2048; k++) {
        const acc = Math.floor((rnd() * 2 - 1) * 2 ** 17), m = Math.floor(2 ** 20 + rnd() * (2 ** 25 - 2 ** 20)), z = Math.floor(rnd() * 128);
        hex.push(`${((acc >>> 0).toString(16)).padStart(8, '0')}${m.toString(16).padStart(8, '0')}${z.toString(16).padStart(2, '0')}`);
    }
    writeFileSync(`${base}.pwr.hex`, `${hex.join('\n')}\n`);
    writeFileSync(`${base}.pwr_tb.v`, `\`timescale 1ns/1ps
module tb;
    reg [31:0] acc, mq; reg [7:0] z; wire [7:0] y;
    reg [71:0] vec [0:2047];
    integer k;
    m dut (.acc(acc), .mq(mq), .z(z), .y(y));
    initial begin
        $readmemh("${base}.pwr.hex", vec);
        $dumpfile("${base}.vcd");
        $dumpvars(2, dut);
        for (k = 0; k < 2048; k = k + 1) begin {acc, mq, z} = vec[k]; #${PERIOD}; end
        $finish;
    end
endmodule
`);
    await sh(`iverilog -g2005 -o ${base}.pwr.vvp ${base}.net.v ${F.lib.cells} ${base}.pwr_tb.v && vvp -n ${base}.pwr.vvp`);
    writeFileSync(`${base}.pwr.tcl`, `read_liberty ${lib.file}
read_verilog ${base}.net.v
link_design m
set_wire_load_model -name ${STA.wireLoad}
create_clock -name vclk -period ${PERIOD}
set_input_delay 0 -clock vclk [all_inputs]
set_output_delay 0 -clock vclk [all_outputs]
set_driving_cell -lib_cell ${STA.driver} -pin X [all_inputs]
set_load ${STA.load} [all_outputs]
read_vcd -scope tb/dut ${base}.vcd
report_power -digits 8
`);
    const { stdout } = await sh(`sta -no_splash -exit ${base}.pwr.tcl`);
    const tot = /\nTotal\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/.exec(stdout);
    return (+tot[1] + +tot[2]) * PERIOD * 1e-9 * 1e15;
}

/** Atraso, energia por operação (atividade 0,5 nas entradas, uma operação por período) e área de um módulo. */
async function measure(kind, N, flow) {
    const base = join(work, `${kind}${N}.${flow}`);
    writeFileSync(`${base}.v`, kind === 'requant' ? REQUANT : MODULES[kind](N));
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
    let energy = (+tot[1] + +tot[2]) * PERIOD * 1e-9 * 1e15;
    if (kind === 'requant') energy = await requantEnergy(base);
    // Na reescala, a multiplicação vai para DSP48, como no Vitis (as outras peças, sem DSP).
    const synthF = kind === 'requant' ? SYNTH.replace(' -nodsp', '') : SYNTH;
    await sh(`yosys -q -p "read_verilog ${base}.v; ${synthF} -top m; tee -q -o ${base}.fpga.json stat -json"`);
    const cells = JSON.parse(read(`${base}.fpga.json`)).design.num_cells_by_type;
    const luts = Object.entries(cells).filter(([k]) => /^LUT\d$/.test(k)).reduce((s, [, n]) => s + n, 0);
    const dsp = Object.entries(cells).filter(([k]) => /^DSP48/.test(k)).reduce((s, [, n]) => s + n, 0);
    return { area: +area.toFixed(2), delay: Math.round(delay * 1000), energy: +energy.toFixed(2), luts, carry4: cells.CARRY4 ?? 0, ...(kind === 'requant' ? { dsp } : {}) };
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

if (args.includes('--only') && args[args.indexOf('--only') + 1] === 'requant') {
    const cur = JSON.parse(readFileSync(outFile, 'utf8'));
    cur.cells.requant = { 32: { delay: await measure('requant', 32, 'delay'), area: await measure('requant', 32, 'area') } };
    cur.requantGenerated = new Date().toISOString().slice(0, 10);
    writeFileSync(outFile, `${JSON.stringify(cur, null, 1)}\n`);
    console.log(JSON.stringify(cur.cells.requant, null, 1));
    process.exit(0);
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
out.cells.requant = { 32: { delay: await measure('requant', 32, 'delay'), area: await measure('requant', 32, 'area') } };
writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ register: out.register, mux16: out.cells.mux[16], xor16: out.cells.xor[16], cmp16: out.cells.cmp[16] }, null, 1));
