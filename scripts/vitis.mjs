#!/usr/bin/env node
/**
 * Validação do modelo de HLS contra o Vitis HLS e o Vivado (2022.2). Tudo roda a partir da pasta do repositório.
 *
 *   node scripts/vitis.mjs export [--only gauss,fir] [--part xc7a100tcsg324-1] [--fresh]
 *       gera build/vitis/<caso>/ com kernel.cpp, kernel.h, tb.cpp, os dados, run.tcl e model.json (as previsões do
 *       simulador), e build/vitis/run_all.sh. Os pontos da exploração já medidos reaproveitam a atribuição guardada
 *       em results/vitis (--fresh refaz a exploração);
 *   node scripts/vitis.mjs check [--include /tools/Xilinx/Vitis_HLS/2022.2/include]
 *       compila kernel e testbench de cada caso com g++ e roda (a mesma conferência da csim, sem o Vitis);
 *   bash build/vitis/run_all.sh [-j N] [--impl] [--cosim] [--only caso1,caso2]
 *       roda o Vitis HLS em cada caso: csim, csynth e, com --impl, export_design -flow impl (Vivado);
 *   node scripts/vitis.mjs collect
 *       lê os relatórios, compara com as previsões e grava results/vitis/ (RESULTADOS.md, CSV, LaTeX, JSON e as
 *       sugestões de calibração);
 *   node scripts/vitis.mjs compare
 *       refaz a comparação a partir de results/vitis (os relatórios já coletados), com as previsões do modelo atual
 *       para as mesmas atribuições de unidades; não precisa do Vitis nem de build/vitis.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize, MODEL } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';
import { parseAssign, opFunction } from '../js/hls/approx.js';
import { execute, makeInputs } from '../js/hls/exec.js';
import { exportIR, exportSource, kernelHeader, testbench, cName } from '../js/hls/vitis.js';
import { explore, pragmaVariants } from '../js/hls/dse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build/vitis');
const RES = join(ROOT, 'results/vitis');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
const log = (...a) => console.error(...a);
const synth = JSON.parse(readFileSync(join(ROOT, 'data/synth.json'), 'utf8'));
const cells = JSON.parse(readFileSync(join(ROOT, 'data/hls-cells.json'), 'utf8'));
const code = (id) => KERNELS.find((k) => k.id === id).code;
// Com a caracterização das unidades no Vivado (scripts/vivado-units.mjs), as previsões usam o alvo FPGA com esses dados.
const FPGA = existsSync(join(ROOT, 'data/vivado-units.json')) && !argv.includes('--yosys') ? JSON.parse(readFileSync(join(ROOT, 'data/vivado-units.json'), 'utf8')) : null;
const libOpts = FPGA ? { target: 'fpga', fpga: FPGA } : {};

/**
 * Casos: os exemplos exatos (do código original e do projeto elaborado), as variantes de diretivas e os períodos do
 * gaussiano, e projetos aproximados (atribuições fixas e os pontos escolhidos pela exploração).
 */
function cases() {
    const list = [];
    for (const k of KERNELS) {
        list.push({ id: `${k.id}_src`, kernel: k.id, src: k.code, kind: 'src', clockNs: 5, note: 'código original, exato' });
        list.push({ id: `${k.id}_ir`, kernel: k.id, src: k.code, kind: 'ir', clockNs: 5, note: 'projeto elaborado, exato' });
    }
    pragmaVariants(code('gauss')).slice(1).forEach((v, i) => list.push({ id: `gauss_var${i + 1}_ir`, kernel: 'gauss', src: v.code, kind: 'ir', clockNs: 5, note: v.label }));
    for (const c of [2.5, 10]) list.push({ id: `gauss_${String(c).replace('.', 'p')}ns_ir`, kernel: 'gauss', src: code('gauss'), kind: 'ir', clockNs: c, note: `período de ${c} ns` });
    const fixed = [
        ['gauss', 'gauss_drum6_ir', 'mul8=MUL8 DRUM6'],
        ['gauss', 'gauss_t8c_loa6_ir', 'mul8=MUL8 T8 +C;add16=ADD16 LOA6'],
        ['sobel', 'sobel_loa4_ir', '*=ADD16 LOA4'],
        ['sharpen', 'sharpen_kul_ir', 'mul8=MUL8 KUL'],
        ['fir', 'fir_t8c_loa11_ir', 'mul8=MUL8 T8 +C;add16=ADD16 LOA11;add32=ADD32 (ADD16 LOA11 + ADD16 exato)'],
        ['dot', 'dot_t4_ir', 'mul8=MUL8 T4'],
    ];
    for (const [k, id, spec] of fixed) list.push({ id, kernel: k, src: code(k), kind: 'ir', clockNs: 5, spec, note: spec });
    // Pontos da exploração: gaussiano por operação (40 dB) e FIR por operação (60 dB), heurística de eficiência.
    list.push({ id: 'gauss_dse_op40_ir', kernel: 'gauss', src: code('gauss'), kind: 'ir', clockNs: 5, dse: { granularity: 'op', psnr: 40 }, note: 'exploração: eficiência por operação, PSNR >= 40 dB' });
    list.push({ id: 'fir_dse_op60_ir', kernel: 'fir', src: code('fir'), kind: 'ir', clockNs: 5, dse: { granularity: 'op', psnr: 60 }, note: 'exploração: eficiência por operação, PSNR >= 60 dB' });
    // Pontos da exploração com o modelo calibrado por esta validação (multiplicação por constante, somadores sem
    // compartilhamento, seleção de banco), com o objetivo em LUTs: a economia prevista a conferir no Vivado.
    list.push({ id: 'gauss_dse2_lut40_ir', kernel: 'gauss', src: code('gauss'), kind: 'ir', clockNs: 5, dse: { granularity: 'op', psnr: 40, objective: 'luts' }, note: 'exploração (modelo calibrado): LUTs, por operação, PSNR >= 40 dB' });
    list.push({ id: 'fir_dse2_lut60_ir', kernel: 'fir', src: code('fir'), kind: 'ir', clockNs: 5, dse: { granularity: 'op', psnr: 60, objective: 'luts' }, note: 'exploração (modelo calibrado): LUTs, por operação, PSNR >= 60 dB' });
    // Os mesmos projetos aproximados com as unidades em linha (INLINE): sem o módulo de cada unidade, com as constantes
    // dos operandos propagadas pelo Vitis e pelo Vivado.
    // E com as unidades como módulos combinacionais (INLINE off com LATENCY max=0), como o modelo supõe: na primeira
    // rodada o Vitis dividiu as netlists em estágios, com registradores dentro de cada unidade.
    const approx = list.filter((x) => x.spec || x.dse);
    for (const c of approx) list.push({ ...c, id: c.id.replace(/_ir$/, '_lat0_ir'), inline: 'lat0', base: c.id, note: `${c.note}, unidades combinacionais` });
    for (const c of approx) list.push({ ...c, id: c.id.replace(/_ir$/, '_inl_ir'), inline: true, base: c.id, note: `${c.note}, unidades em linha` });
    return list.filter((c) => !only || only.has(c.id) || only.has(c.kernel));
}

/** Tcl do Vitis HLS para um caso (caminhos relativos à pasta do caso). */
function tcl(c, top, part, dataFiles) {
    return `# ${c.id}: ${c.note}. Gerado por scripts/vitis.mjs (Vitis HLS 2022.2).
# Uso, da pasta do repositório: vitis_hls -f build/vitis/${c.id}/run.tcl
# Variáveis de ambiente: AXC_IMPL=1 roda também o Vivado (export_design -flow impl); AXC_COSIM=1 roda a cosimulação.
set here [file dirname [file normalize [info script]]]
cd $here
open_project -reset proj
set_top ${top}
add_files kernel.cpp -cflags "-I$here"
add_files -tb tb.cpp -cflags "-I$here"
${dataFiles.map((f) => `add_files -tb ${f}`).join('\n')}
open_solution -reset solution1 -flow_target vivado
set_part {${part}}
create_clock -period ${c.clockNs} -name default
# Como no modelo: sem DSP (multiplicadores em LUT), sem pipeline automático de laços, memórias de 1 ciclo.
config_op mul -impl fabric
config_compile -pipeline_loops 0
# Uma diferença na csim (testbench devolve 1) não impede a síntese; o coletor lê o resultado no log.
if {[catch {csim_design} err]} { puts "AXC_CSIM_FALHOU $err" }
csynth_design
if {[info exists ::env(AXC_COSIM)] && $::env(AXC_COSIM) == 1} { cosim_design }
if {[info exists ::env(AXC_IMPL)] && $::env(AXC_IMPL) == 1} { export_design -flow impl -rtl verilog -format ip_catalog }
exit
`;
}

function runAll(list) {
    return `#!/usr/bin/env bash
# Roda o Vitis HLS em todos os casos de build/vitis (gerados por: node scripts/vitis.mjs export).
# Uso, da pasta do repositório: bash build/vitis/run_all.sh [-j N] [--impl] [--cosim] [--only caso1,caso2]
set -u
cd "$(dirname "$0")/../.."
J=1; IMPL=0; COSIM=0; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    -j) J="$2"; shift 2 ;;
    --impl) IMPL=1; shift ;;
    --cosim) COSIM=1; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "opção desconhecida: $1"; exit 1 ;;
  esac
done
command -v vitis_hls >/dev/null || { echo "vitis_hls não está no PATH (source /tools/Xilinx/Vitis_HLS/2022.2/settings64.sh)"; exit 1; }
CASES="${list.map((c) => c.id).join(' ')}"
if [ -n "$ONLY" ]; then CASES="$(echo "$ONLY" | tr ',' ' ')"; fi
run_one() {
  c="$1"
  echo "[$(date +%H:%M:%S)] $c"
  ( AXC_IMPL=$IMPL AXC_COSIM=$COSIM vitis_hls -f "build/vitis/$c/run.tcl" > "build/vitis/$c/vitis_hls.log" 2>&1 ) \\
    && echo "[$(date +%H:%M:%S)] $c pronto" || echo "[$(date +%H:%M:%S)] $c FALHOU (veja build/vitis/$c/vitis_hls.log)"
}
export -f run_one; export IMPL COSIM
echo "$CASES" | tr ' ' '\\n' | xargs -P "$J" -I{} bash -c 'run_one {}'
echo "Depois: node scripts/vitis.mjs collect"
`;
}

/** Previsões do simulador para o caso (o mesmo projeto que o C++ descreve). */
function prediction(r) {
    return {
        cycles: r.totals.cycles, timeNs: r.totals.timeNs, intervalNs: r.totals.intervalNs, critPs: r.totals.critPs,
        luts: r.totals.luts, carry4: r.totals.carry4, ff: r.totals.ff, areaUm2: r.totals.area, energyFj: r.totals.energy,
        // Laços achatados aparecem como um só (rows_cols), como no relatório do Vitis.
        loops: r.design.loops.filter((l) => l.mode !== 'unrolled' && !l.flatInto).map((l) => (l.flatLabel
            ? { label: l.flatLabel, mode: 'pipelined', flattened: true, trip: l.flatTrip, II: l.IIachieved ?? null, iterLatency: l.iterLatency, latency: l.latency }
            : { label: l.label ?? l.id, mode: l.mode, trip: l.tripHw, II: l.IIachieved ?? null, iterLatency: l.iterLatency, latency: l.latency })),
        addrLuts: r.cost.addr?.luts ?? 0,
        units: r.cost.units.map((u) => ({ unit: u.unit.name, count: u.count, luts: u.luts, carry4: u.carry4 })),
        model: MODEL,
    };
}

function doExport() {
    const part = opt('--part', 'xc7a100tcsg324-1');
    mkdirSync(OUT, { recursive: true });
    const list = cases();
    const index = [];
    const chosen = new Map();
    for (const c of list) {
        const dir = join(OUT, c.id);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        const syn = { synth, cells, clockNs: c.clockNs, flow: 'delay', ports: 2, ...libOpts };
        const base = synthesize(c.src, syn);
        let assign = new Map();
        // Projetos já medidos guardam a atribuição em results/vitis (a mesma entre rodadas; --fresh refaz a exploração).
        const savedFile = join(RES, c.base ?? c.id, 'model.json');
        const saved = !argv.includes('--fresh') && existsSync(savedFile) ? JSON.parse(readFileSync(savedFile, 'utf8')) : null;
        if (c.base && chosen.has(c.base)) assign = new Map(chosen.get(c.base));
        else if (c.spec) assign = parseAssign(base.ops, c.spec);
        else if (c.dse && saved) { assign = new Map(Object.entries(saved.assign ?? {})); c.note = saved.note; }
        else if (c.dse) {
            const res = explore(c.src, { ...syn, objective: c.dse.objective ?? 'area', constraint: { metric: 'psnr', value: c.dse.psnr }, granularity: c.dse.granularity, heuristic: 'efficiency' });
            const p = res.runs[0].chosen ?? res.runs[0].best;
            assign = new Map(p.assign);
            c.note += ` (${p.units.join(', ')})`;
        }
        chosen.set(c.id, assign);
        const r = synthesize(c.src, { ...syn, assign, design: base.design });
        const inputs = makeInputs(r.design, 'image');
        const ops = new Map([...r.assign].map(([id, n]) => [id, opFunction(r.lib, r.ops.byId.get(id), n)]));
        const expected = execute(r.design, inputs, { ops: ops.size ? ops : null });
        const files = testbench(r.design, inputs, expected);
        files['kernel.h'] = kernelHeader(r.design);
        files['kernel.cpp'] = c.kind === 'src' ? exportSource(c.src, r.design) : exportIR(r, { inline: c.inline ?? false });
        const data = Object.keys(files).filter((f) => f.endsWith('.dat'));
        files['run.tcl'] = tcl(c, r.design.name, part, data);
        files['model.json'] = `${JSON.stringify({ case: c.id, kernel: c.kernel, kind: c.kind, note: c.note, clockNs: c.clockNs, part, top: r.design.name, assign: Object.fromEntries(r.assign), prediction: prediction(r) }, null, 1)}\n`;
        for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
        index.push({ id: c.id, kernel: c.kernel, kind: c.kind, note: c.note, clockNs: c.clockNs, top: r.design.name });
        log(`${c.id}: ${r.assign.size} operações aproximadas; ${c.note}`);
    }
    writeFileSync(join(OUT, 'cases.json'), `${JSON.stringify({ part, generated: new Date().toISOString(), cases: index }, null, 1)}\n`);
    writeFileSync(join(OUT, 'run_all.sh'), runAll(index), { mode: 0o755 });
    log(`\n${index.length} casos em build/vitis. Para rodar: bash build/vitis/run_all.sh -j 4`);
}

/** Compila e roda cada caso com g++ (a conferência da csim sem o Vitis). */
function doCheck() {
    const inc = opt('--include', existsSync('/tools/Xilinx/Vitis_HLS/2022.2/include') ? '/tools/Xilinx/Vitis_HLS/2022.2/include' : null);
    if (!inc) { log('falta --include com a pasta do ap_int.h (por exemplo /tools/Xilinx/Vitis_HLS/2022.2/include)'); process.exit(1); }
    const index = JSON.parse(readFileSync(join(OUT, 'cases.json'), 'utf8')).cases.filter((c) => !only || only.has(c.id) || only.has(c.kernel));
    let fails = 0;
    for (const c of index) {
        const dir = join(OUT, c.id);
        try {
            execSync(`g++ -std=c++14 -O2 -w -I"${resolve(inc)}" -I. kernel.cpp tb.cpp -o tb_gxx`, { cwd: dir, stdio: 'pipe' });
            const out = execSync('./tb_gxx', { cwd: dir, stdio: 'pipe' }).toString().trim().split('\n').pop();
            console.log(`${c.id.padEnd(24)} ${out}`);
        } catch (e) {
            fails++;
            console.log(`${c.id.padEnd(24)} FALHOU: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '').split('\n').slice(0, 8).join('\n')}`);
        }
    }
    if (fails) process.exit(1);
}

// Coleta ----------------------------------------------------------------------------------------------------------
const tag = (xml, name) => { const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml); return m ? m[1].trim() : null; };
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : +v);
function walk(dir, re, out = []) {
    if (!existsSync(dir)) return out;
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p, re, out);
        else if (re.test(f)) out.push(p);
    }
    return out;
}
/** Laços do csynth.xml: todos os elementos com PipelineII ou TripCount dentro de SummaryOfLoopLatency. */
function loopsOf(xml) {
    const sec = /<SummaryOfLoopLatency>([\s\S]*?)<\/SummaryOfLoopLatency>/.exec(xml)?.[1] ?? '';
    const out = [];
    const re = /<([A-Za-z_][\w.]*)>\s*<(?:Name|Slack|TripCount|Latency|IterationLatency|PipelineII|PipelineDepth)/g;
    let m;
    while ((m = re.exec(sec))) {
        const name = m[1];
        const start = m.index;
        const end = sec.indexOf(`</${name}>`, start);
        const body = sec.slice(start, end);
        // Só os campos deste laço (antes do primeiro laço aninhado).
        const own = body.replace(/<([A-Za-z_][\w.]*)>\s*<(?:Name|Slack|TripCount|Latency)[\s\S]*$/, (x, n2) => (n2 === name ? x : ''));
        out.push({ name, trip: num(tag(own, 'TripCount')), latency: num(tag(own, 'Latency')), iterLatency: num(tag(own, 'IterationLatency')), II: num(tag(own, 'PipelineII')), depth: num(tag(own, 'PipelineDepth')) });
    }
    return out;
}
/** Módulos do relatório do Vivado (as unidades aproximadas são os u_*): LUT e FF de cada instância. */
function modulesOf(xml) {
    const out = new Map();
    const re = /<RtlModule CELL="([^"]+)"[^>]*DEPTH="(\d+)"[^>]*MODULENAME="([^"]+)"[^>]*>\s*(?:<SubModules[^<]*<\/SubModules>\s*)?<Resources([^/]*)\/>/g;
    let m;
    while ((m = re.exec(xml))) {
        if (m[2] === '0') continue;
        const lut = +(/LUT="(\d+)"/.exec(m[4])?.[1] ?? 0), ff = +(/FF="(\d+)"/.exec(m[4])?.[1] ?? 0);
        const k = m[3];
        if (!out.has(k)) out.set(k, { module: k, count: 0, lut: 0, ff: 0 });
        const o = out.get(k);
        o.count++; o.lut += lut; o.ff += ff;
    }
    return [...out.values()];
}

/** Refaz a comparação com o modelo atual, a partir dos relatórios guardados em results/vitis. */
function doCompare() {
    const sum = JSON.parse(readFileSync(join(RES, 'summary.json'), 'utf8'));
    const byId = new Map(cases().map((c) => [c.id, c]));
    for (const row of sum.rows) {
        const c = byId.get(row.case);
        const saved = JSON.parse(readFileSync(join(RES, row.case, 'model.json'), 'utf8'));
        const syn = { synth, cells, clockNs: c.clockNs, flow: 'delay', ports: 2, ...libOpts };
        const base = synthesize(c.src, syn);
        const r = synthesize(c.src, { ...syn, assign: new Map(Object.entries(saved.assign ?? {})), design: base.design });
        if (r.assign.size !== Object.keys(saved.assign ?? {}).length) log(`${row.case}: atribuição diferente da medida (${r.assign.size} de ${Object.keys(saved.assign).length})`);
        if (row.hls) row.modelFirst = row.modelFirst ?? saved.prediction; else delete row.modelFirst;
        row.model = prediction(r);
        const ix = join(RES, row.case, 'impl.xml');
        if (row.impl && existsSync(ix)) row.impl.modules = modulesOf(readFileSync(ix, 'utf8'));
    }
    writeFileSync(join(RES, 'summary.json'), `${JSON.stringify({ ...sum, compared: new Date().toISOString() }, null, 1)}\n`);
    report(sum.rows, sum);
}

function doCollect() {
    const meta = JSON.parse(readFileSync(join(OUT, 'cases.json'), 'utf8'));
    mkdirSync(RES, { recursive: true });
    // A primeira previsão de cada caso (o modelo antes da calibração) fica guardada entre as coletas.
    const prevFile = join(RES, 'summary.json');
    const prev = new Map(existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')).rows.map((r) => [r.case, r]) : []);
    const rows = [];
    for (const c of meta.cases) {
        const dir = join(OUT, c.id);
        const model = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'));
        const row = { case: c.id, kernel: c.kernel, kind: c.kind, note: c.note, clockNs: c.clockNs, model: model.prediction, csim: null, hls: null, impl: null };
        const old = prev.get(c.id);
        if (old?.hls) row.modelFirst = old.modelFirst ?? old.model;
        const keep = join(RES, c.id);
        mkdirSync(keep, { recursive: true });
        copyFileSync(join(dir, 'model.json'), join(keep, 'model.json'));
        // csim
        const csimLog = walk(join(dir, 'proj'), /_csim\.log$/)[0] ?? join(dir, 'vitis_hls.log');
        if (existsSync(csimLog)) { const m = /AXC_MISMATCHES (\d+) OF (\d+)/.exec(readFileSync(csimLog, 'utf8')); if (m) row.csim = { mismatches: +m[1], total: +m[2] }; }
        // csynth
        const syn = walk(join(dir, 'proj'), /_csynth\.xml$/).find((f) => f.includes(`${c.top}_csynth.xml`)) ?? walk(join(dir, 'proj'), /csynth\.xml$/)[0];
        if (syn) {
            const x = readFileSync(syn, 'utf8');
            copyFileSync(syn, join(keep, 'csynth.xml'));
            const res = /<AreaEstimates>[\s\S]*?<Resources>([\s\S]*?)<\/Resources>/.exec(x)?.[1] ?? '';
            row.hls = {
                estClockNs: num(tag(x, 'EstimatedClockPeriod')), latencyBest: num(tag(x, 'Best-caseLatency')), latencyWorst: num(tag(x, 'Worst-caseLatency')),
                intervalMin: num(tag(x, 'Interval-min')), lut: num(tag(res, 'LUT')), ff: num(tag(res, 'FF')), dsp: num(tag(res, 'DSP')) ?? num(tag(res, 'DSP48E')), bram: num(tag(res, 'BRAM_18K')),
                loops: loopsOf(x),
            };
        }
        // impl (Vivado)
        const implXml = walk(join(dir, 'proj'), /\.xml$/).filter((f) => f.includes(`${'/'}impl${'/'}`) && /export|impl/.test(f)).find((f) => /<AreaReport>|<TimingReport>/.test(readFileSync(f, 'utf8')));
        const util = walk(join(dir, 'proj'), /utilization.*\.rpt$/).find((f) => /routed|place|impl/.test(f));
        if (implXml || util) {
            row.impl = {};
            if (implXml) {
                const x = readFileSync(implXml, 'utf8');
                copyFileSync(implXml, join(keep, 'impl.xml'));
                const area = /<AreaReport>([\s\S]*?)<\/AreaReport>/.exec(x)?.[1] ?? x;
                row.impl.modules = modulesOf(x);
                Object.assign(row.impl, { lut: num(tag(area, 'LUT')), ff: num(tag(area, 'FF')), dsp: num(tag(area, 'DSP')), slice: num(tag(area, 'SLICE')), bram: num(tag(area, 'BRAM')),
                    achievedNs: num(tag(x, 'AchievedClockPeriod')) ?? num(tag(x, 'CP_FINAL')), timingMet: tag(x, 'TIMING_MET') });
            }
            if (util) {
                const u = readFileSync(util, 'utf8');
                copyFileSync(util, join(keep, 'utilization.rpt'));
                const m = /\|\s*CARRY4\s*\|\s*(\d+)/.exec(u);
                if (m) row.impl.carry4 = +m[1];
            }
        }
        // Sem o projeto do Vitis nesta máquina: ficam as medidas da coleta anterior.
        if (old && !row.hls) Object.assign(row, { csim: old.csim, hls: old.hls, impl: old.impl });
        rows.push(row);
    }
    writeFileSync(join(RES, 'summary.json'), `${JSON.stringify({ part: meta.part, collected: new Date().toISOString(), rows }, null, 1)}\n`);
    report(rows, meta);
}

/** Comparação e calibração. */
function report(rows, meta) {
    const br = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '-' : (+v).toFixed(d).replace('.', ','));
    const s = (v) => (v === null || v === undefined ? '-' : String(v));
    const ratio = (a, b) => (a && b ? a / b : null);
    const med = (xs) => { const v = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    const mape = (xs) => { const v = xs.filter((x) => x !== null && Number.isFinite(x)); return v.length ? (100 * v.reduce((a, x) => a + Math.abs(x - 1), 0)) / v.length : null; };
    const pct = (v) => (v === null ? '-' : `${br(v, 1)}%`);
    const first = (r) => r.modelFirst ?? r.model;
    const two = rows.some((r) => r.modelFirst);
    const exportNote = ` "Exportação" é a previsão feita quando o caso foi gerado (o modelo antes da primeira rodada, nos 23 primeiros casos; o calibrado com a primeira rodada, nos da segunda); "modelo" é o atual, para as mesmas atribuições de unidades${FPGA ? ', com LUT, CARRY4 e atrasos das unidades caracterizadas no Vivado (data/vivado-units.json)' : ''}.`;
    const md = ['# Validação contra o Vitis HLS e o Vivado', '', `Gerado por \`node scripts/vitis.mjs ${two ? 'compare' : 'collect'}\` em ${new Date().toISOString().slice(0, 10)}; parte ${meta.part}. Cada caso é o mesmo projeto no simulador e no Vitis HLS 2022.2 (o C++ exportado do projeto elaborado, \`_ir\`, ou o código original, \`_src\`), com multiplicadores na lógica (sem DSP). LUT e FF do modelo vêm da síntese das unidades (Yosys \`synth_xilinx\`, ou o Vivado quando há data/vivado-units.json), mais as peças do modelo (multiplexadores, comparadores, registradores, contadores e a seleção de banco). A referência de recursos e de período é o Vivado depois do roteamento; a estimativa do csynth fica na tabela só para comparação.${two ? exportNote : ''}`, ''];
    const tex = ['% Tabelas da validação (scripts/vitis.mjs). Requer \\usepackage[table]{xcolor} e a cor tabAzul definida.', ''];
    const table = (title, head, body) => {
        md.push(`#### ${title}`, '', `| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i ? '---:' : '---')).join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`), '');
        const te = (x) => String(x).replace(/([%&#_$])/g, '\\$1').replace(/×/g, '$\\times$').replace(/≥/g, '$\\geq$');
        tex.push('\\begin{table}[htbp]', '\\centering', `\\caption{${te(title)}}`, `\\begin{tabular}{|l|${head.slice(1).map(() => 'r').join('|')}|}`, '\\hline',
            `\\rowcolor{tabAzul}${head.map((h) => `\\color{white}${te(h)}`).join(' & ')} \\\\`, '\\hline', ...body.map((r) => `${r.map(te).join(' & ')} \\\\ \\hline`), '\\end{tabular}', '\\end{table}', '');
    };
    const csv = [['case', 'kernel', 'kind', 'clock_ns', 'csim_mismatches', 'model1_cycles', 'model_cycles', 'hls_latency', 'model_crit_ps', 'hls_est_clock_ns', 'impl_achieved_ns', 'model1_luts', 'model_luts', 'hls_lut', 'impl_lut', 'model_carry4', 'impl_carry4', 'model1_ff', 'model_ff', 'hls_ff', 'impl_ff', 'hls_dsp']];
    for (const r of rows) csv.push([r.case, r.kernel, r.kind, r.clockNs, r.csim?.mismatches ?? '', first(r).cycles, r.model.cycles, r.hls?.latencyWorst ?? '', r.model.critPs, r.hls?.estClockNs ?? '', r.impl?.achievedNs ?? '', first(r).luts, r.model.luts, r.hls?.lut ?? '', r.impl?.lut ?? '', r.model.carry4, r.impl?.carry4 ?? '', first(r).ff, r.model.ff, r.hls?.ff ?? '', r.impl?.ff ?? '', r.hls?.dsp ?? '']);
    writeFileSync(join(RES, 'comparacao.csv'), `${csv.map((r) => r.join(',')).join('\n')}\n`);
    const done = rows.filter((r) => r.hls);
    const impl = rows.filter((r) => r.impl?.lut);
    md.push(`${done.length} de ${rows.length} casos com relatório do csynth; ${impl.length} com o Vivado (impl); ${rows.filter((r) => r.csim).length} com csim.`, '');

    // Resumo dos erros.
    const errCyc = (f) => mape(done.map((r) => ratio(f(r).cycles, r.hls.latencyWorst)));
    const errLut = (f) => mape(impl.map((r) => ratio(f(r).luts, r.impl.lut)));
    const errFf = (f) => mape(impl.map((r) => ratio(f(r).ff, r.impl.ff)));
    const pipeCases = done.filter((r) => r.model.loops.some((l) => l.mode === 'pipelined'));
    const seqCases = done.filter((r) => !r.model.loops.some((l) => l.mode === 'pipelined'));
    table('Erro médio do modelo (desvio relativo médio entre o modelo e a medida)', ['Grandeza', 'Casos', ...(two ? ['Exportação'] : []), 'Modelo'], [
        ['Latência (ciclos), com pipeline', String(pipeCases.length), ...(two ? [pct(mape(pipeCases.map((r) => ratio(first(r).cycles, r.hls.latencyWorst))))] : []), pct(mape(pipeCases.map((r) => ratio(r.model.cycles, r.hls.latencyWorst))))],
        ['Latência (ciclos), sem pipeline', String(seqCases.length), ...(two ? [pct(mape(seqCases.map((r) => ratio(first(r).cycles, r.hls.latencyWorst))))] : []), pct(mape(seqCases.map((r) => ratio(r.model.cycles, r.hls.latencyWorst))))],
        ['Latência (ciclos), todos', String(done.length), ...(two ? [pct(errCyc(first))] : []), pct(errCyc((r) => r.model))],
        ['LUT (Vivado)', String(impl.length), ...(two ? [pct(errLut(first))] : []), pct(errLut((r) => r.model))],
        ['FF (Vivado)', String(impl.length), ...(two ? [pct(errFf(first))] : []), pct(errFf((r) => r.model))],
        ['Período (Vivado)', String(impl.length), ...(two ? ['-'] : []), pct(mape(impl.map((r) => ratio(r.model.critPs / 1000, r.impl.achievedNs))))],
    ]);

    table('Execução: csim do Vitis contra a execução bit a bit do simulador', ['Caso', 'Diferenças', 'Posições'], rows.map((r) => [r.case, r.csim ? String(r.csim.mismatches) : '-', r.csim ? String(r.csim.total) : '-']));
    table('Latência (ciclos) e período', ['Caso', ...(two ? ['Exportação'] : []), 'Modelo', 'Vitis', 'Razão', 'Período modelo (ns)', 'csynth (ns)', 'Vivado (ns)'],
        rows.map((r) => [r.case, ...(two ? [String(first(r).cycles)] : []), String(r.model.cycles), r.hls ? String(r.hls.latencyWorst) : '-', br(ratio(r.model.cycles, r.hls?.latencyWorst), 3), br(r.model.critPs / 1000, 2), br(r.hls?.estClockNs, 2), br(r.impl?.achievedNs, 2)]));
    table('Recursos de FPGA', ['Caso', ...(two ? ['LUT exportação'] : []), 'LUT modelo', 'LUT csynth', 'LUT Vivado', 'CARRY4 modelo', 'CARRY4 Vivado', ...(two ? ['FF exportação'] : []), 'FF modelo', 'FF csynth', 'FF Vivado'],
        rows.map((r) => [r.case, ...(two ? [String(first(r).luts)] : []), String(r.model.luts), s(r.hls?.lut), s(r.impl?.lut), String(r.model.carry4), s(r.impl?.carry4), ...(two ? [String(first(r).ff)] : []), String(r.model.ff), s(r.hls?.ff), s(r.impl?.ff)]));

    // Efeito da aproximação: economia prevista e medida contra o projeto exato do mesmo kernel.
    const exactOf = new Map(rows.filter((r) => r.kind === 'ir' && r.case === `${r.kernel}_ir`).map((r) => [r.kernel, r]));
    const ax = rows.filter((r) => /_(drum|t8c|loa|kul|t4|dse)/.test(r.case) && r.impl);
    table('Efeito da aproximação: LUTs contra o projeto exato do mesmo kernel', ['Caso', ...(two ? ['Economia na exportação'] : []), 'Economia modelo', 'Economia Vivado', 'LUT Vivado exato', 'LUT Vivado aprox.'],
        ax.map((r) => {
            const e = exactOf.get(r.kernel);
            const sv = (a, b) => (a && b ? 100 * (1 - a / b) : null);
            const round2 = /_lat0|_inl|dse2/.test(r.case);
            return [r.case, ...(two ? [round2 ? '-' : pct(sv(first(r).luts, first(e).luts))] : []), pct(sv(r.model.luts, e.model.luts)), pct(sv(r.impl?.lut, e.impl?.lut)), s(e.impl?.lut), s(r.impl?.lut)];
        }));
    // Economia prevista contra medida, por forma de exportação das unidades.
    const styles = [['INLINE off (o Vitis divide a netlist em estágios)', (c) => !/_lat0|_inl/.test(c)], ['combinacional (INLINE off, LATENCY 0)', (c) => /_lat0/.test(c)], ['em linha (INLINE)', (c) => /_inl/.test(c)]];
    const savRows = styles.map(([label, f]) => {
        const rs = ax.filter((r) => f(r.case) && exactOf.get(r.kernel)?.impl);
        const pairs = rs.map((r) => { const e = exactOf.get(r.kernel); return [100 * (1 - r.model.luts / e.model.luts), 100 * (1 - r.impl.lut / e.impl.lut)]; });
        const mae = pairs.length ? pairs.reduce((a, [m, v]) => a + Math.abs(m - v), 0) / pairs.length : null;
        const sign = pairs.filter(([m, v]) => Math.sign(Math.round(m)) === Math.sign(Math.round(v)) || Math.abs(m - v) < 3).length;
        const best = pairs.length ? Math.max(...pairs.map(([, v]) => v)) : null;
        return [label, String(pairs.length), mae === null ? '-' : `${br(mae, 1)} p.p.`, `${sign} de ${pairs.length}`, best === null ? '-' : pct(best)];
    });
    table('Economia de LUTs prevista contra a medida, por forma de exportação das unidades', ['Exportação', 'Casos', 'Erro médio', 'Mesmo sentido', 'Maior economia medida'], savRows);
    // Unidades aproximadas como módulos no Vivado.
    const unitRows = [];
    for (const r of ax) for (const m of r.impl?.modules ?? []) if (/^u_/.test(m.module)) {
        const name = m.module.slice(2);
        const mu = r.model.units.find((u) => cName(u.unit) === m.module);
        unitRows.push([r.case, name, String(m.count), mu ? String(mu.count) : '-', br(m.lut / m.count, 0), mu ? br(mu.luts / mu.count, 0) : '-', br(m.ff / m.count, 0)]);
    }
    if (unitRows.length) table('Unidades aproximadas no Vivado (funções com INLINE off): instâncias, LUT e FF por instância', ['Caso', 'Unidade', 'Inst. Vivado', 'Inst. modelo', 'LUT Vivado', 'LUT modelo', 'FF Vivado'], unitRows);

    // Laços, casados pelo nome (o achatado é rows_cols nos dois).
    const loopRows = [];
    const over = { seq: [], pipe: [] };
    for (const r of done) for (const l of r.model.loops) {
        const v = r.hls.loops.find((x) => x.name === l.label);
        loopRows.push([r.case, l.label, l.flattened ? 'achatado' : l.mode === 'pipelined' ? 'pipeline' : 'sequencial', String(l.trip), s(l.II), s(v?.II), String(l.iterLatency), s(v?.depth ?? v?.iterLatency), String(l.latency), s(v?.latency)]);
        if (!v || v.latency === null) continue;
        if (l.mode === 'pipelined' && v.II && v.depth) over.pipe.push(v.latency - (v.depth + (l.trip - 1) * v.II));
        if (l.mode === 'sequential' && v.iterLatency) over.seq.push(v.iterLatency - l.iterLatency);
    }
    table('Laços: II, iteração (profundidade com pipeline) e latência, em ciclos', ['Caso', 'Laço', 'Modo', 'Iterações', 'II modelo', 'II Vitis', 'Iteração modelo', 'Iteração Vitis', 'Latência modelo', 'Latência Vitis'], loopRows);

    const cal = {
        sequentialIterResidual: med(over.seq), pipelineOverheadVitis: med(over.pipe),
        lutScale: med(impl.map((r) => ratio(r.impl.lut, r.model.luts))), ffScale: med(impl.map((r) => ratio(r.impl.ff, r.model.ff))),
        cycleRatio: med(done.map((r) => ratio(r.hls.latencyWorst, r.model.cycles))), periodScale: med(impl.map((r) => ratio(r.impl.achievedNs, r.model.critPs / 1000))),
        model: MODEL, samples: { sequentialLoops: over.seq.length, pipelinedLoops: over.pipe.length, cases: done.length, impl: impl.length },
    };
    writeFileSync(join(RES, 'calibracao.json'), `${JSON.stringify(cal, null, 1)}\n`);
    md.push('### Resíduos depois da calibração', '', `Medianas: iteração de laço sequencial, Vitis menos modelo, ${br(cal.sequentialIterResidual, 0)} ciclos; entrada e saída do pipeline no Vitis (latência menos profundidade menos N menos 1 vezes o II) ${br(cal.pipelineOverheadVitis, 0)} ciclos; LUT Vivado / modelo ${br(cal.lutScale, 2)}; FF ${br(cal.ffScale, 2)}; latência Vitis / modelo ${br(cal.cycleRatio, 3)}; período Vivado / modelo ${br(cal.periodScale, 2)}. Valores em \`results/vitis/calibracao.json\`, com as constantes do modelo (\`MODEL\` em \`js/hls/sched.js\`).`, '');
    writeFileSync(join(RES, 'RESULTADOS.md'), `${md.join('\n')}\n`);
    writeFileSync(join(RES, 'tabelas.tex'), `${tex.join('\n')}\n`);
    log(`results/vitis: ${done.length} casos com csynth, ${impl.length} com impl, ${rows.filter((r) => r.csim).length} com csim`);
}

switch (cmd) {
    case 'export': doExport(); break;
    case 'check': doCheck(); break;
    case 'collect': doCollect(); break;
    case 'compare': doCompare(); break;
    default:
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 20).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}
