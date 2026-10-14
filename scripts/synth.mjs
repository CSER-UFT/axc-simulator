#!/usr/bin/env node
/**
 * Síntese das configurações pré-definidas, rodada na publicação do site (GitHub Actions) ou localmente:
 *
 *   1. exporta cada unidade em Verilog (o mesmo circuito que o simulador avalia);
 *   2. confere o Verilog no Icarus Verilog com vetores calculados pelo simulador (todos os pares em 8 bits,
 *      20 mil pares sorteados em 16 bits); qualquer diferença interrompe a publicação;
 *   3. sintetiza com o Yosys para FPGA Xilinx 7 series (synth_xilinx -abc9, sem DSP) e lê a contagem de LUTs e
 *      CARRY4 e o caminho mais longo em células;
 *   4. grava data/synth.json, que a página lê.
 *
 * Uso: node scripts/synth.mjs [--jobs N] [--out data/synth.json]
 * Precisa de iverilog, vvp e yosys no PATH (no Ubuntu: apt install iverilog yosys).
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { exec as execCb, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { buildUnit, unitName } from '../js/axc/units.js';
import { toVerilog, testbench, vectors, moduleName } from '../js/axc/verilog.js';
import { testInputs } from '../js/axc/metrics.js';
import { PRESETS } from '../js/axc/presets.js';

const exec = promisify(execCb);
const args = process.argv.slice(2);
const opt = (name, def) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : def; };
const jobs = +opt('--jobs', Math.max(1, cpus().length));
const outFile = opt('--out', 'data/synth.json');
const work = 'build/synth';
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const yosysVersion = execSync('yosys -V').toString().trim();
const iverilogVersion = execSync('iverilog -V 2>&1 | head -1').toString().trim();
const SYNTH = 'synth_xilinx -family xc7 -flatten -nodsp -abc9 -noiopad';

async function one(cfg) {
    const unit = buildUnit(cfg);
    const name = moduleName(cfg);
    const inp = testInputs(cfg.width, 'uniform', 20000, 2026);
    const v = join(work, `${name}.v`), tb = join(work, `tb_${name}.v`), hex = join(work, `${name}.hex`);
    writeFileSync(v, toVerilog(unit, name));
    writeFileSync(hex, vectors(unit, inp));
    writeFileSync(tb, testbench(unit, inp.a.length, hex, name));
    const sim = await exec(`iverilog -g2005 -o ${join(work, `${name}.vvp`)} ${v} ${tb} && vvp -n ${join(work, `${name}.vvp`)}`);
    const m = /MISMATCHES (\d+) OF (\d+)/.exec(sim.stdout);
    if (!m || +m[1] !== 0) throw new Error(`${name}: o Verilog não confere com o simulador\n${sim.stdout}`);
    const stat = join(work, `${name}.stat.json`), ltp = join(work, `${name}.ltp`);
    await exec(`yosys -q -p "read_verilog ${v}; ${SYNTH} -top ${name}; tee -q -o ${stat} stat -json; tee -q -o ${ltp} ltp -noff"`, { maxBuffer: 1 << 26 });
    const cells = JSON.parse(readFileSync(stat, 'utf8')).design.num_cells_by_type;
    const luts = Object.entries(cells).filter(([k]) => /^LUT\d$/.test(k)).reduce((s, [, n]) => s + n, 0);
    const depth = +(/length=(\d+)/.exec(readFileSync(ltp, 'utf8'))?.[1] ?? 0);
    const r = {
        name: unitName(cfg), module: name, cfg, vectors: +m[2],
        luts, carry4: cells.CARRY4 ?? 0, depth, cells,
        gates: unit.net.gates, gateDepth: unit.net.delay(),
    };
    console.log(`${name.padEnd(20)} ${String(luts).padStart(4)} LUTs ${String(r.carry4).padStart(2)} CARRY4  profundidade ${depth}  (${r.vectors} vetores conferidos)`);
    return r;
}

const results = new Array(PRESETS.length);
let next = 0;
async function worker() {
    while (next < PRESETS.length) {
        const k = next++;
        results[k] = await one(PRESETS[k]);
    }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(jobs, PRESETS.length) }, worker));
mkdirSync('data', { recursive: true });
writeFileSync(outFile, `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    tools: { yosys: yosysVersion, iverilog: iverilogVersion },
    flow: `read_verilog; ${SYNTH}`,
    designs: results,
}, null, 1)}\n`);
console.log(`${results.length} configurações em ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outFile}`);
