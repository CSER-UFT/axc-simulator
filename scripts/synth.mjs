#!/usr/bin/env node
/**
 * Síntese das configurações pré-definidas, rodada na publicação do site (GitHub Actions) ou localmente:
 *
 *   1. exporta cada unidade em Verilog (o mesmo circuito que o simulador avalia);
 *   2. confere o Verilog no Icarus Verilog com vetores calculados pelo simulador (todos os pares em 8 bits,
 *      20 mil pares sorteados em 16 bits); qualquer diferença interrompe a publicação;
 *   3. sintetiza com o Yosys para FPGA Xilinx 7 series (synth_xilinx -abc9, sem DSP) e lê a contagem de LUTs e
 *      CARRY4 e o caminho mais longo em células;
 *   4. sintetiza de novo para ASIC, com a biblioteca de células padrão SkyWater 130 nm (sky130_fd_sc_hd, canto típico,
 *      25 °C, 1,8 V): o Yosys mapeia o circuito nas células com o ABC, que também estima o atraso do caminho
 *      crítico; a área sai do stat com a biblioteca;
 *   5. calcula as métricas de erro (entradas uniformes, como a página) e grava tudo em data/synth.json.
 *
 * Uso: node scripts/synth.mjs [--jobs N] [--out data/synth.json] [--liberty arquivo.lib]
 * Precisa de iverilog, vvp e yosys no PATH (no Ubuntu: apt install iverilog yosys). A biblioteca do sky130 é baixada
 * na primeira vez (12 MB, de uma versão fixa do OpenROAD-flow-scripts, conferida pelo SHA-256) para build/pdk.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exec as execCb, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { buildUnit, unitName } from '../js/axc/units.js';
import { toVerilog, testbench, vectors, moduleName } from '../js/axc/verilog.js';
import { testInputs, errorMetrics } from '../js/axc/metrics.js';
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

// ASIC: biblioteca sky130_fd_sc_hd, sem as células que não servem para lógica comum (relógio, atraso, baixo
// consumo, sondas, tristate, preenchimento), como os fluxos abertos fazem com a lista DONT_USE.
const LIB_COMMIT = '08ddc64f89c66b7e8398587d25bbaf55858d1fe5';
const LIB_URL = `https://raw.githubusercontent.com/The-OpenROAD-Project/OpenROAD-flow-scripts/${LIB_COMMIT}/flow/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib`;
const LIB_SHA256 = 'ec0e1067a35c8bf20b11e58d1e8ac53326067e4dac84a125cc1b917a3518d0d9';
const DONT_USE = /^sky130_fd_sc_hd__(lpflow_|probe|clk|dly|decap|diode|fill|tap|macro_|einv|ebuf|conb_|df|sdf|edf|sedf|dl|sdl)/;
const ABC_SCRIPT = '+strash;dch;map;topo;stime,-p';

async function prepareLiberty() {
    const raw = opt('--liberty', 'build/pdk/sky130_fd_sc_hd__tt_025C_1v80.lib');
    if (!existsSync(raw)) {
        console.log(`baixando a biblioteca sky130_fd_sc_hd (${LIB_URL})`);
        const r = await fetch(LIB_URL);
        if (!r.ok) throw new Error(`não foi possível baixar a biblioteca: HTTP ${r.status}`);
        mkdirSync('build/pdk', { recursive: true });
        writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
    }
    const text = readFileSync(raw);
    const sha = createHash('sha256').update(text).digest('hex');
    if (!opt('--liberty') && sha !== LIB_SHA256) throw new Error(`SHA-256 da biblioteca não confere: ${sha}`);
    // Tira as células proibidas: cada célula é um bloco cell ("nome") { ... } com chaves balanceadas.
    const src = text.toString('latin1');
    let out = '', pos = 0, kept = 0, dropped = 0;
    const re = /\n\s*cell\s*\(\s*"?([A-Za-z0-9_]+)"?\s*\)\s*\{/g;
    for (let m; (m = re.exec(src));) {
        let depth = 1, k = re.lastIndex;
        while (depth && k < src.length) { const c = src[k++]; if (c === '{') depth++; else if (c === '}') depth--; }
        if (DONT_USE.test(m[1])) { out += src.slice(pos, m.index); pos = k; dropped++; } else kept++;
        re.lastIndex = k;
    }
    out += src.slice(pos);
    const file = 'build/pdk/sky130_hd_logic.lib';
    writeFileSync(file, out, 'latin1');
    return { file, kept, dropped, sha };
}
const lib = await prepareLiberty();
console.log(`sky130_fd_sc_hd: ${lib.kept} células combinacionais usadas, ${lib.dropped} fora (sequenciais, relógio, atraso, baixo consumo)`);

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
    // ASIC: mapeamento nas células do sky130 e atraso estimado pelo ABC (sem fios nem carga externa).
    const asicLog = join(work, `${name}.asic.log`), asicStat = join(work, `${name}.asic.stat`);
    await exec(`yosys -q -l ${asicLog} -p "read_verilog ${v}; synth -flatten -top ${name}; abc -liberty ${lib.file} -script ${ABC_SCRIPT}; opt_clean; tee -q -o ${asicStat} stat -liberty ${lib.file}"`, { maxBuffer: 1 << 26 });
    const area = +(/Chip area for module .*: ([\d.]+)/.exec(readFileSync(asicStat, 'utf8'))?.[1] ?? NaN);
    const delays = [...readFileSync(asicLog, 'utf8').matchAll(/Delay =\s*([\d.]+) ps/g)];
    const asicCells = +(/Number of cells:\s*(\d+)/.exec(readFileSync(asicStat, 'utf8'))?.[1] ?? 0);
    const r = {
        name: unitName(cfg), module: name, cfg, vectors: +m[2],
        luts, carry4: cells.CARRY4 ?? 0, depth, cells,
        asic: { area: Math.round(area * 100) / 100, delay: delays.length ? +delays.at(-1)[1] : null, cells: asicCells },
        gates: unit.net.gates, gateDepth: unit.net.delay(),
    };
    const em = errorMetrics(unit, testInputs(cfg.width, 'uniform'));
    r.err = Object.fromEntries(['MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP'].map((k) => [k, em[k]]));
    console.log(`${name.padEnd(20)} ${String(luts).padStart(4)} LUTs ${String(r.carry4).padStart(2)} CARRY4  profundidade ${depth}  ${r.asic.area.toFixed(1).padStart(8)} µm² ${String(r.asic.delay).padStart(8)} ps  (${r.vectors} vetores conferidos)`);
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
    asic: {
        library: 'sky130_fd_sc_hd, tt_025C_1v80',
        source: LIB_URL,
        sha256: lib.sha,
        flow: `read_verilog; synth -flatten; abc -liberty <sky130_fd_sc_hd> -script ${ABC_SCRIPT}; stat -liberty`,
        cells: lib.kept,
    },
    designs: results,
}, null, 1)}\n`);
console.log(`${results.length} configurações em ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outFile}`);
