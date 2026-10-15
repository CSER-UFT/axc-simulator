#!/usr/bin/env node
/**
 * Síntese do espaço de projeto (js/axc/designspace.js), rodada localmente; o resultado vai para data/synth.json, que
 * o site lê, e as netlists para netlists/. Para cada configuração:
 *
 *   1. exporta a unidade em Verilog (o mesmo circuito que o simulador avalia) e confere no Icarus Verilog com vetores
 *      calculados pelo simulador (todos os pares em 8 bits, 20 mil pares sorteados em 16 bits);
 *   2. sintetiza com o Yosys para FPGA Xilinx 7 series (synth_xilinx -abc9, sem DSP): LUTs, CARRY4 e o caminho mais
 *      longo em células;
 *   3. sintetiza para ASIC com a biblioteca sky130_fd_sc_hd (canto típico, 25 °C, 1,8 V) em três fluxos do ABC, todos
 *      com mapeamento por atraso, buffers e dimensionamento de células (map -D; buffer; upsize; dnsize):
 *        delay  atraso mínimo (alvo de 1 ps, inatingível);
 *        area   área mínima (alvo folgado de 100 ns);
 *        iso    iso atraso: área mínima sob o atraso da unidade exata de mesma largura no fluxo delay;
 *   4. confere cada netlist mapeada no Icarus Verilog (modelos funcionais das células, lidos da própria biblioteca):
 *      todos os pares em 8 bits; em 16 bits, os 2048 pares da simulação de potência;
 *   5. mede cada netlist com o OpenSTA: atraso do caminho crítico (entradas acionadas por buf_2, 5 fF em cada saída,
 *      modelo de fio "Small" da biblioteca) e potência a partir da atividade de uma simulação da netlist com 2048 pares
 *      uniformes em sequência (um par a cada 10 ns, VCD de todos os pinos das células). A simulação é de atraso
 *      zero, então os glitches ficam de fora: a energia é um limite inferior;
 *   6. calcula as métricas de erro com entradas uniformes (como a página; em 16 bits, 200 mil pares sorteados, com o
 *      intervalo de confiança de 95%) e com os pares reais das aplicações (data/operands.bin: LeNet-5 e filtro
 *      gaussiano), e a energia da netlist de atraso mínimo com 2048 desses pares reais em sequência.
 *
 * Cada etapa (FPGA e cada fluxo ASIC) fica em cache (build/synth-cache), pela chave SHA-256 do Verilog, da biblioteca,
 * das versões das ferramentas, do fluxo e do alvo de atraso: rodar de novo só sintetiza o que mudou.
 *
 * As netlists (o Verilog do simulador e as três mapeadas de cada configuração) vão para build/netlists e, juntas, para
 * build/axc-netlists.tar.gz, para anexar a uma release: ficam fora do repositório, que guarda só o SHA-256 de cada uma
 * em data/synth.json.
 *
 * Uso: node scripts/synth.mjs [--jobs N] [--set all|presets] [--only regex] [--out data/synth.json]
 *                             [--netlists build/netlists] [--no-cache] [--liberty arquivo.lib]
 * Precisa de iverilog, vvp, yosys e sta (OpenSTA) no PATH. No Ubuntu: apt install iverilog yosys; o OpenSTA se compila
 * do código (github.com/The-OpenROAD-Project/OpenSTA, com CUDD). A biblioteca do sky130 é baixada na primeira vez
 * (12 MB, de uma versão fixa do OpenROAD-flow-scripts, conferida pelo SHA-256) para build/pdk.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { buildUnit, unitName } from '../js/axc/units.js';
import { toVerilog, testbench, vectors, moduleName } from '../js/axc/verilog.js';
import { testInputs, errorMetrics, loadOperands, APP_DISTRIBUTIONS } from '../js/axc/metrics.js';
import { createFlow } from './lib/asic.mjs';
import { PRESETS } from '../js/axc/presets.js';
import { designSpace } from '../js/axc/designspace.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : def; };
const flag = (name) => args.includes(name);
const jobs = +opt('--jobs', Math.max(1, cpus().length));
const outFile = opt('--out', 'data/synth.json');
const netDir = opt('--netlists', 'build/netlists');
const cacheDir = 'build/synth-cache';
const work = opt('--work', 'build/synth');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// Pares reais das aplicações (scripts/operands.mjs).
const opsBuf = readFileSync('data/operands.bin');
loadOperands(JSON.parse(readFileSync('data/operands.json', 'utf8')), opsBuf.buffer.slice(opsBuf.byteOffset, opsBuf.byteOffset + opsBuf.byteLength));
const OPS_SHA = createHash('sha256').update(opsBuf).digest('hex');

const F = await createFlow({ liberty: opt('--liberty'), work, cacheDir, noCache: flag('--no-cache'), cachedOnly: flag('--cached-only') });
const { lib, tools, SYNTH, LIB_URL, FLOWS, STA, abcScript, sh, read, asicFlow, cached } = F;
console.log(`sky130_fd_sc_hd: ${lib.kept} células combinacionais usadas, ${lib.dropped} fora (sequenciais, relógio, atraso, baixo consumo)`);

async function one(cfg, isoTarget) {
    const unit = buildUnit(cfg);
    const name = moduleName(cfg);
    const rtl = toVerilog(unit, name);
    let hits = 0;

    const inp = testInputs(cfg.width, 'uniform', 20000, 2026);
    const v = join(work, `${name}.v`), tb = join(work, `tb_${name}.v`), hex = join(work, `${name}.hex`);
    writeFileSync(v, rtl);
    writeFileSync(hex, vectors(unit, inp));
    writeFileSync(tb, testbench(unit, inp.a.length, hex, name));
    const fpga = await cached(name, ['fpga', rtl], async () => {
        const sim = await sh(`iverilog -g2005 -o ${join(work, `${name}.vvp`)} ${v} ${tb} && vvp -n ${join(work, `${name}.vvp`)}`);
        const m = /MISMATCHES (\d+) OF (\d+)/.exec(sim.stdout);
        if (!m || +m[1] !== 0) throw new Error(`${name}: o Verilog não confere com o simulador\n${sim.stdout}`);
        const stat = join(work, `${name}.stat.json`), ltp = join(work, `${name}.ltp`);
        await sh(`yosys -q -p "read_verilog ${v}; ${SYNTH} -top ${name}; tee -q -o ${stat} stat -json; tee -q -o ${ltp} ltp -noff"`);
        const fcells = JSON.parse(read(stat)).design.num_cells_by_type;
        return {
            vectors: +m[2], luts: Object.entries(fcells).filter(([k]) => /^LUT\d$/.test(k)).reduce((s, [, n]) => s + n, 0),
            carry4: fcells.CARRY4 ?? 0, depth: +(/length=(\d+)/.exec(read(ltp))?.[1] ?? 0),
        };
    });
    if (fpga.hit) hits++;

    const check = { tb, exhaustive: !!inp.exhaustive };
    const asic = {};
    const dir = join(netDir, name);
    mkdirSync(dir, { recursive: true });
    for (const [tag, D] of [...Object.entries(FLOWS), ...(isoTarget ? [['iso', isoTarget]] : [])]) {
        const f = await cached(name, ['asic', D, rtl], async () => {
            const x = await asicFlow(v, name, unit, check, D, tag);
            writeFileSync(join(cacheDir, `${name}.${D}.v.gz`), gzipSync(readFileSync(x.net), { level: 9 }));
            return x.r;
        });
        if (f.hit) hits++;
        delete f.hit;
        asic[tag] = f;
        writeFileSync(join(dir, `sky130_${tag}.v.gz`), readFileSync(join(cacheDir, `${name}.${D}.v.gz`)));
    }
    if (isoTarget) asic.iso.target = isoTarget;
    // Energia com os pares reais das aplicações, na netlist de atraso mínimo (guardada no cache).
    const energyApp = {};
    for (const app of APP_DISTRIBUTIONS) {
        const all = testInputs(cfg.width, app, 0, 0, cfg.kind);
        const inpP = { a: all.a.subarray(0, STA.powerVectors), b: all.b.subarray(0, STA.powerVectors) };
        const f = await cached(name, ['appenergy', app, FLOWS.delay, rtl, OPS_SHA], async () => {
            const net = join(work, `${name}.${app}.v`);
            writeFileSync(net, gunzipSync(readFileSync(join(cacheDir, `${name}.${FLOWS.delay}.v.gz`))));
            return { energy: (await F.measure(net, name, unit, join(work, `${name}.${app}`), inpP)).energy };
        }).catch((e) => { if (e.notCached) return { energy: null }; throw e; });
        if (f.hit) hits++;
        energyApp[app] = f.energy;
    }
    const pick = (em) => ({ ...Object.fromEntries(['MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP'].map((k) => [k, em[k]])), ...(em.ci ? { ci: em.ci } : {}) });
    const em = errorMetrics(unit, testInputs(cfg.width, 'uniform'));
    const r = {
        name: unitName(cfg), module: name, vectors: fpga.vectors,
        luts: fpga.luts, carry4: fpga.carry4, depth: fpga.depth,
        // Campos de sempre (o site e o simulador de compilador leem estes): o fluxo de atraso mínimo.
        asic: { area: asic.delay.area, delay: asic.delay.delay, energy: asic.delay.energy, leakage: asic.delay.leakage, cells: asic.delay.cells, energyApp, flows: asic },
        gates: unit.net.gates, gateDepth: unit.net.delay(),
        err: pick(em),
        errApp: Object.fromEntries(APP_DISTRIBUTIONS.map((app) => [app, pick(errorMetrics(unit, testInputs(cfg.width, app, 0, 0, cfg.kind)))])),
        rtlSha256: createHash('sha256').update(rtl).digest('hex'),
    };
    // Netlists guardadas (comprimidas): o Verilog do simulador e as mapeadas (copiadas do cache acima).
    writeFileSync(join(dir, 'rtl.v.gz'), gzipSync(rtl, { level: 9 }));
    for (const f of [v, tb, hex]) rmSync(f, { force: true });
    rmSync(join(work, name), { force: true, recursive: true });
    return { ...r, cfg, cached: hits === 3 + (isoTarget ? 1 : 0) + APP_DISTRIBUTIONS.length };
}

// Lista: o espaço de projeto inteiro ou só as pré-definidas; as exatas primeiro (dão o alvo do iso atraso).
let list = opt('--set', 'all') === 'presets' ? PRESETS : designSpace();
const only = opt('--only');
const isExact = (c) => (c.kind === 'add' ? c.adder === 'exact' : (c.method ?? 'array') === 'array' && !c.kTrunc && !c.kApprox && !c.comp);
const exactOf = (c) => (c.kind === 'add' ? { kind: 'add', width: c.width, adder: 'exact' } : { kind: 'mul', width: c.width, kTrunc: 0, kApprox: 0, approxCarry: true });
if (only) list = list.filter((c) => new RegExp(only, 'i').test(unitName(c)) || isExact(c));
const exacts = list.filter(isExact);
for (const c of list) if (!exacts.some((e) => unitName(e) === unitName(exactOf(c)))) { exacts.push(exactOf(c)); list.unshift(exactOf(c)); }
const rest = list.filter((c) => !isExact(c));

const t0 = Date.now();
let done = 0, fromCache = 0;
const log = (r, total) => {
    done++;
    if (r.cached) { fromCache++; return; }
    const a = r.asic;
    console.log(`[${String(done).padStart(3)}/${total}] ${r.module.padEnd(22)} ${String(r.luts).padStart(4)} LUTs  ${a.area.toFixed(0).padStart(6)} µm² ${String(a.delay).padStart(7)} ps ${String(a.energy).padStart(8)} fJ  iso ${a.flows.iso ? `${a.flows.iso.area.toFixed(0)} µm² ${a.flows.iso.delay} ps` : '-'}`);
};
async function pool(items, fn) {
    const out = new Array(items.length);
    let next = 0;
    const errors = [];
    await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
        while (next < items.length) {
            const k = next++;
            try { out[k] = await fn(items[k]); } catch (e) {
                if (e.notCached) { out[k] = null; continue; }
                errors.push(e); console.error(String(e.message ?? e).slice(0, 2000));
            }
        }
    }));
    if (errors.length) throw new Error(`${errors.length} configurações falharam`);
    return out;
}
const total = exacts.length + rest.length;
// Exatas: primeiro sem iso, para achar o alvo; depois o iso delas mesmas (alvo = o próprio atraso).
const target = new Map();
const exactRes = await pool(exacts, async (c) => {
    const pre = await one(c, null);
    const D = Math.ceil(pre.asic.flows.delay.delayAbc);
    target.set(`${c.kind}${c.width}`, D);
    const r = await one(c, D);
    log({ ...r, cached: false }, total);
    return r;
});
const restRes = await pool(rest, async (c) => { const r = await one(c, target.get(`${c.kind}${c.width}`)); log(r, total); return r; });
const byName = new Map([...exactRes, ...restRes].filter(Boolean).map((r) => [r.name, r]));
const results = list.map((c) => byName.get(unitName(c))).filter(Boolean);
for (const r of results) { delete r.cached; }

// Números com 6 algarismos significativos (o arquivo vai para o site).
const round6 = (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(6) : v);
mkdirSync('data', { recursive: true });
const head = {
    generated: new Date().toISOString().slice(0, 10),
    tools,
    flow: `read_verilog; ${SYNTH}`,
    asic: {
        library: 'sky130_fd_sc_hd, tt_025C_1v80',
        source: LIB_URL,
        sha256: lib.sha,
        cells: lib.kept,
        flow: `read_verilog; synth -flatten; abc -liberty <sky130_fd_sc_hd> -script ${abcScript('D')}; stat -liberty`,
        flows: {
            delay: 'atraso mínimo (D = 1 ps)', area: 'área mínima (D = 100 ns)',
            iso: 'iso atraso: D = atraso estimado pelo ABC da unidade exata de mesma largura no fluxo delay',
        },
        operands: { file: 'data/operands.bin', sha256: OPS_SHA, energy: 'energyApp: netlist de atraso mínimo com os 2048 primeiros pares de cada aplicação' },
        sta: { ...STA, units: { delay: 'ps', energy: 'fJ por operação (potência interna + chaveamento × período)', leakage: 'nW' },
            note: 'OpenSTA; atividade de uma simulação de atraso zero da netlist (sem glitches)' },
        targets: Object.fromEntries(target),
    },
};
// Uma configuração por linha: menor que com indentação e com diffs legíveis no git.
writeFileSync(outFile, `${JSON.stringify(head, round6, 1).slice(0, -2)},\n "designs": [\n${results.map((r) => JSON.stringify(r, round6)).join(',\n')}\n ]\n}\n`);
execSync(`tar -czf build/axc-netlists.tar.gz -C ${netDir} .`);
console.log(`${results.length} configurações (${fromCache} do cache) em ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${outFile}`);
