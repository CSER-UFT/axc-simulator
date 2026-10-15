/**
 * Fluxo ASIC comum (scripts/synth.mjs e scripts/evoapprox.mjs): biblioteca sky130 filtrada, síntese com o Yosys e o
 * ABC num alvo de atraso, conferência da netlist mapeada no Icarus Verilog, atraso e potência com o OpenSTA, e cache
 * por etapa. Os detalhes de cada passo estão no cabeçalho de scripts/synth.mjs.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exec as execCb, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { vectors } from '../../js/axc/verilog.js';
import { rng } from '../../js/axc/metrics.js';

const exec = promisify(execCb);

/**
 * @param {{liberty?: string, work: string, cacheDir: string, noCache?: boolean}} o
 */
export async function createFlow(o) {
    const work = o.work, cacheDir = o.cacheDir;
    mkdirSync(work, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    const flag = (n) => (n === '--no-cache' ? !!o.noCache : false);
    const opt = (n, d) => (n === '--liberty' ? o.liberty ?? d : d);
    const tool = (cmd) => execSync(cmd).toString().trim().split('\n')[0];
    const tools = { yosys: tool('yosys -V'), iverilog: tool('iverilog -V 2>&1'), opensta: `OpenSTA ${tool('sta -version')}` };
    const SYNTH = 'synth_xilinx -family xc7 -flatten -nodsp -abc9 -noiopad';

    // ASIC: biblioteca sky130_fd_sc_hd, sem as células que não servem para lógica comum (relógio, atraso, baixo
    // consumo, sondas, tristate, preenchimento, sequenciais), como os fluxos abertos fazem com a lista DONT_USE.
    const LIB_COMMIT = '08ddc64f89c66b7e8398587d25bbaf55858d1fe5';
    const LIB_URL = `https://raw.githubusercontent.com/The-OpenROAD-Project/OpenROAD-flow-scripts/${LIB_COMMIT}/flow/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib`;
    const LIB_SHA256 = 'ec0e1067a35c8bf20b11e58d1e8ac53326067e4dac84a125cc1b917a3518d0d9';
    const DONT_USE = /^sky130_fd_sc_hd__(lpflow_|probe|clk|dly|decap|diode|fill|tap|macro_|einv|ebuf|conb_|df|sdf|edf|sedf|dl|sdl)/;
    const abcScript = (D) => `+strash;dch;map,-D,${D};topo;buffer,-p;upsize,-D,${D};dnsize,-D,${D};stime,-p`;
    const FLOWS = { delay: 1, area: 100000 };
    const STA = { driver: 'sky130_fd_sc_hd__buf_2', load: 0.005, wireLoad: 'Small', period: 10, powerVectors: 2048, seed: 2027 };
    // Versão do fluxo: muda quando o script muda o que mede (invalida o cache).
    const FLOW_VERSION = `axc-synth-3 ${SYNTH} | ${abcScript('D')} | ${JSON.stringify(FLOWS)} | ${JSON.stringify(STA)}`;

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
        // Modelos funcionais das células (do atributo function da biblioteca), para simular as netlists mapeadas.
        const cells = 'build/pdk/sky130_hd_cells.v';
        execSync(`yosys -q -p "read_liberty ${file}; write_verilog -noattr ${cells}"`);
        return { file, cells, kept, dropped, sha };
    }
    const lib = await prepareLiberty();
    const KEY_BASE = [lib.sha, tools.yosys, tools.iverilog, tools.opensta, FLOW_VERSION].join('\n');

    const sh = (cmd) => exec(cmd, { maxBuffer: 1 << 28 });
    const read = (f) => readFileSync(f, 'utf8');

    /** Pares para a potência: sequência uniforme com semente fixa (independente da conferência). */
    function powerInputs(N) {
        const rand = rng(STA.seed + N);
        const a = new Uint32Array(STA.powerVectors), b = new Uint32Array(STA.powerVectors);
        for (let k = 0; k < a.length; k++) { a[k] = Math.floor(rand() * 2 ** N); b[k] = Math.floor(rand() * 2 ** N); }
        return { a, b };
    }

    /** Testbench que só aplica os pares, um a cada período, e grava a atividade de todos os pinos das células. */
    function powerTestbench(unit, n, hex, name, vcd) {
        const N = unit.cfg.width, W = unit.net.outputs.length;
        return `\`timescale 1ns/1ps
    module tb_${name};
        reg  [${N - 1}:0] a, b;
        wire [${W - 1}:0] y;
        reg  [${2 * N + W - 1}:0] vec [0:${n - 1}];
        integer k, bad;
        ${name} dut (.a(a), .b(b), .y(y));
        initial begin
            $readmemh("${hex}", vec);
            $dumpfile("${vcd}");
            $dumpvars(2, dut);
            bad = 0;
            for (k = 0; k < ${n}; k = k + 1) begin
                {a, b} = vec[k][${2 * N + W - 1}:${W}];
                #${STA.period};
                if (y !== vec[k][${W - 1}:0]) bad = bad + 1;
            end
            $display("MISMATCHES %0d OF %0d", bad, ${n});
            $finish;
        end
    endmodule
    `;
    }

    /** Atraso (ps) e potência (W) de uma netlist mapeada, com o OpenSTA. */
    async function measure(net, name, unit, base, inputs = null) {
        const hex = `${base}.pwr.hex`, vcd = `${base}.vcd`, tb = `${base}.pwr_tb.v`, vvp = `${base}.pwr.vvp`, tcl = `${base}.sta.tcl`;
        const inp = inputs ?? powerInputs(unit.cfg.width);
        writeFileSync(hex, vectors(unit, inp));
        writeFileSync(tb, powerTestbench(unit, inp.a.length, hex, name, vcd));
        const sim = await sh(`iverilog -g2005 -o ${vvp} ${net} ${lib.cells} ${tb} && vvp -n ${vvp}`);
        const mm = /MISMATCHES (\d+) OF (\d+)/.exec(sim.stdout);
        if (!mm || +mm[1] !== 0) throw new Error(`${name}: a netlist mapeada não confere com o simulador\n${sim.stdout}`);
        writeFileSync(tcl, `read_liberty ${lib.file}
    read_verilog ${net}
    link_design ${name}
    set_wire_load_model -name ${STA.wireLoad}
    create_clock -name vclk -period ${STA.period}
    set_input_delay 0 -clock vclk [all_inputs]
    set_output_delay 0 -clock vclk [all_outputs]
    set_driving_cell -lib_cell ${STA.driver} -pin X [all_inputs]
    set_load ${STA.load} [all_outputs]
    report_checks -path_delay max -digits 4
    read_vcd -scope tb_${name}/dut ${vcd}
    report_power -digits 8
    `);
        // O OpenSTA às vezes falha sem motivo aparente (o mesmo arquivo passa na segunda vez): até três tentativas.
        let stdout = '';
        for (let tries = 1; ; tries++) {
            try { ({ stdout } = await sh(`sta -no_splash -exit ${tcl}`)); break; } catch (e) {
                if (tries >= 3) throw new Error(`${name}: OpenSTA falhou ${tries} vezes\n${String(e.stderr ?? '').slice(-1500)}\n${String(e.stdout ?? '').slice(-1500)}`);
                console.error(`${name}: OpenSTA falhou (tentativa ${tries}): ${String(e.stderr ?? e.message).trim().slice(-300)}`);
            }
        }
        rmSync(vcd, { force: true });
        // Saída constante (por exemplo, todas as colunas truncadas): não há caminho, o atraso é zero.
        const arrival = /No paths found/.test(stdout) ? [null, '0'] : /([\d.]+)\s+data arrival time/.exec(stdout);
        const ann = /Annotated (\d+) pin activities/.exec(stdout);
        const tot = /\nTotal\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/.exec(stdout);
        if (!arrival || !tot || !ann) throw new Error(`${name}: saída do OpenSTA inesperada\n${stdout.slice(-2000)}`);
        const [internal, switching, leakage] = [+tot[1], +tot[2], +tot[3]];
        return {
            delay: Math.round(+arrival[1] * 1000 * 10) / 10,                                   // ps
            energy: Math.round((internal + switching) * STA.period * 1e-9 * 1e15 * 100) / 100, // fJ por operação
            leakage: Math.round(leakage * 1e9 * 1000) / 1000,                                  // nW
            pins: +ann[1],
        };
    }

    /** Uma síntese ASIC (alvo de atraso D, em ps), conferida e medida. */
    async function asicFlow(v, name, unit, check, D, tag) {
        const base = join(work, `${name}.${tag}`);
        const net = `${base}.v`, log = `${base}.log`, stat = `${base}.stat`;
        await sh(`yosys -q -l ${log} -p "read_verilog ${v}; synth -flatten -top ${name}; abc -liberty ${lib.file} -script ${abcScript(D)}; opt_clean; write_verilog -noattr ${net}; tee -q -o ${stat} stat -liberty ${lib.file}"`);
        const st = read(stat);
        const cells = +(/Number of cells:\s*(\d+)/.exec(st)?.[1] ?? 0);
        // Sem células (saída constante), o stat não escreve a área.
        const area = cells === 0 ? 0 : +(/Chip area for module .*: ([\d.]+)/.exec(st)?.[1] ?? NaN);
        const abc = [...read(log).matchAll(/Delay =\s*([\d.]+) ps/g)].at(-1)?.[1];
        // A netlist mapeada tem de calcular o mesmo que o simulador: em 8 bits, todos os pares (em 16, os da potência).
        if (check.exhaustive) {
            const sim = await sh(`iverilog -g2005 -o ${base}.vvp ${net} ${lib.cells} ${check.tb} && vvp -n ${base}.vvp`);
            const m = /MISMATCHES (\d+) OF (\d+)/.exec(sim.stdout);
            if (!m || +m[1] !== 0) throw new Error(`${name} (${tag}): a netlist mapeada não confere com o simulador\n${sim.stdout}`);
        }
        const sta = await measure(net, name, unit, base);
        const sha256 = createHash('sha256').update(readFileSync(net)).digest('hex');
        return { r: { area: Math.round(area * 100) / 100, cells, delayAbc: abc ? +abc : null, ...sta, sha256 }, net };
    }

    /** Cache por etapa: devolve o resultado guardado ou calcula, guarda e devolve. */
    async function cached(name, parts, fn) {
        const key = createHash('sha256').update([KEY_BASE, ...parts].join('\n')).digest('hex').slice(0, 24);
        const file = join(cacheDir, `${name}.${key}.json`);
        if (!flag('--no-cache') && existsSync(file)) return { ...JSON.parse(read(file)), hit: true };
        // Só o que já está no cache (para publicar um resultado parcial enquanto o lote roda).
        if (o.cachedOnly) throw Object.assign(new Error(`${name}: fora do cache`), { notCached: true });
        const r = await fn();
        writeFileSync(file, JSON.stringify(r));
        return r;
    }


    return { lib, tools, KEY_BASE, SYNTH, LIB_URL, FLOWS, STA, abcScript, sh, read, measure, asicFlow, cached, powerInputs };
}
