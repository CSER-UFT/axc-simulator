#!/usr/bin/env node
/**
 * Validação do modelo de HLS contra o Vitis HLS e o Vivado (2022.2). Tudo roda a partir da pasta do repositório.
 *
 *   node scripts/vitis.mjs export [--only gauss,fir] [--part xc7a100tcsg324-1]
 *       gera build/vitis/<caso>/ com kernel.cpp, kernel.h, tb.cpp, os dados, run.tcl e model.json (as previsões do
 *       simulador), e build/vitis/run_all.sh;
 *   node scripts/vitis.mjs check [--include /tools/Xilinx/Vitis_HLS/2022.2/include]
 *       compila kernel e testbench de cada caso com g++ e roda (a mesma conferência da csim, sem o Vitis);
 *   bash build/vitis/run_all.sh [-j N] [--impl] [--cosim] [--only caso1,caso2]
 *       roda o Vitis HLS em cada caso: csim, csynth e, com --impl, export_design -flow impl (Vivado);
 *   node scripts/vitis.mjs collect
 *       lê os relatórios, compara com as previsões e grava results/vitis/ (RESULTADOS.md, CSV, LaTeX, JSON e as
 *       sugestões de calibração).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize, MODEL } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';
import { parseAssign, opFunction } from '../js/hls/approx.js';
import { execute, makeInputs } from '../js/hls/exec.js';
import { exportIR, exportSource, kernelHeader, testbench } from '../js/hls/vitis.js';
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
        loops: r.design.loops.filter((l) => l.mode !== 'unrolled').map((l) => ({ label: l.label ?? l.id, mode: l.mode, trip: l.tripHw, II: l.IIachieved ?? null, iterLatency: l.iterLatency, latency: l.latency })),
        units: r.cost.units.map((u) => ({ unit: u.unit.name, count: u.count, luts: u.luts, carry4: u.carry4 })),
        model: MODEL,
    };
}

function doExport() {
    const part = opt('--part', 'xc7a100tcsg324-1');
    mkdirSync(OUT, { recursive: true });
    const list = cases();
    const index = [];
    for (const c of list) {
        const dir = join(OUT, c.id);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        const syn = { synth, cells, clockNs: c.clockNs, flow: 'delay', ports: 2 };
        const base = synthesize(c.src, syn);
        let assign = new Map();
        if (c.spec) assign = parseAssign(base.ops, c.spec);
        if (c.dse) {
            const res = explore(c.src, { ...syn, objective: 'area', constraint: { metric: 'psnr', value: c.dse.psnr }, granularity: c.dse.granularity, heuristic: 'efficiency' });
            const p = res.runs[0].chosen ?? res.runs[0].best;
            assign = new Map(p.assign);
            c.note += ` (${p.units.join(', ')})`;
        }
        const r = synthesize(c.src, { ...syn, assign, design: base.design });
        const inputs = makeInputs(r.design, 'image');
        const ops = new Map([...r.assign].map(([id, n]) => [id, opFunction(r.lib, r.ops.byId.get(id), n)]));
        const expected = execute(r.design, inputs, { ops: ops.size ? ops : null });
        const files = testbench(r.design, inputs, expected);
        files['kernel.h'] = kernelHeader(r.design);
        files['kernel.cpp'] = c.kind === 'src' ? exportSource(c.src, r.design) : exportIR(r);
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
function doCollect() {
    const meta = JSON.parse(readFileSync(join(OUT, 'cases.json'), 'utf8'));
    mkdirSync(RES, { recursive: true });
    const rows = [];
    for (const c of meta.cases) {
        const dir = join(OUT, c.id);
        const model = JSON.parse(readFileSync(join(dir, 'model.json'), 'utf8'));
        const row = { case: c.id, kernel: c.kernel, kind: c.kind, note: c.note, clockNs: c.clockNs, model: model.prediction, csim: null, hls: null, impl: null };
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
        rows.push(row);
    }
    writeFileSync(join(RES, 'summary.json'), `${JSON.stringify({ part: meta.part, collected: new Date().toISOString(), rows }, null, 1)}\n`);
    report(rows, meta);
}

/** Comparação e calibração. */
function report(rows, meta) {
    const br = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '-' : (+v).toFixed(d).replace('.', ','));
    const ratio = (a, b) => (a && b ? a / b : null);
    const med = (xs) => { const s = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const md = ['# Validação contra o Vitis HLS e o Vivado', '', `Gerado por \`node scripts/vitis.mjs collect\` em ${new Date().toISOString().slice(0, 10)}; parte ${meta.part}. Cada caso é o mesmo projeto no simulador e no Vitis (o C++ exportado do projeto elaborado, \`_ir\`, ou o código original, \`_src\`). LUT e FF do modelo vêm da síntese das unidades com o Yosys (\`synth_xilinx\`), mais os multiplexadores, comparadores, registradores e contadores do modelo.`, ''];
    const tex = ['% Tabelas da validação (scripts/vitis.mjs collect). Requer \\usepackage[table]{xcolor} e a cor tabAzul definida.', ''];
    const table = (title, head, body) => {
        md.push(`#### ${title}`, '', `| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i ? '---:' : '---')).join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`), '');
        const te = (s) => String(s).replace(/([%&#_$])/g, '\\$1').replace(/×/g, '$\\times$').replace(/≥/g, '$\\geq$');
        tex.push('\\begin{table}[htbp]', '\\centering', `\\caption{${te(title)}}`, `\\begin{tabular}{|l|${head.slice(1).map(() => 'r').join('|')}|}`, '\\hline',
            `\\rowcolor{tabAzul}${head.map((h) => `\\color{white}${te(h)}`).join(' & ')} \\\\`, '\\hline', ...body.map((r) => `${r.map(te).join(' & ')} \\\\ \\hline`), '\\end{tabular}', '\\end{table}', '');
    };
    const csv = [['case', 'kernel', 'kind', 'clock_ns', 'csim_mismatches', 'model_cycles', 'hls_latency', 'model_crit_ps', 'hls_est_clock_ns', 'model_luts', 'hls_lut', 'impl_lut', 'model_carry4', 'impl_carry4', 'model_ff', 'hls_ff', 'impl_ff', 'impl_achieved_ns', 'hls_dsp']];
    for (const r of rows) csv.push([r.case, r.kernel, r.kind, r.clockNs, r.csim?.mismatches ?? '', r.model.cycles, r.hls?.latencyWorst ?? '', r.model.critPs, r.hls?.estClockNs ?? '', r.model.luts, r.hls?.lut ?? '', r.impl?.lut ?? '', r.model.carry4, r.impl?.carry4 ?? '', r.model.ff, r.hls?.ff ?? '', r.impl?.ff ?? '', r.impl?.achievedNs ?? '', r.hls?.dsp ?? '']);
    writeFileSync(join(RES, 'comparacao.csv'), `${csv.map((r) => r.join(',')).join('\n')}\n`);
    const done = rows.filter((r) => r.hls);
    md.push(`${done.length} de ${rows.length} casos com relatório do csynth; ${rows.filter((r) => r.impl).length} com o Vivado (impl).`, '');
    table('Execução: csim do Vitis contra a execução bit a bit do simulador', ['Caso', 'Diferenças', 'Posições'], rows.map((r) => [r.case, r.csim ? String(r.csim.mismatches) : '-', r.csim ? String(r.csim.total) : '-']));
    table('Latência (ciclos) e período', ['Caso', 'Modelo', 'Vitis', 'Razão', 'Período mín. modelo (ns)', 'Estimado Vitis (ns)', 'Vivado (ns)'],
        rows.map((r) => [r.case, String(r.model.cycles), r.hls ? String(r.hls.latencyWorst) : '-', br(ratio(r.hls?.latencyWorst, r.model.cycles), 3), br(r.model.critPs / 1000, 2), br(r.hls?.estClockNs, 2), br(r.impl?.achievedNs, 2)]));
    table('Recursos de FPGA', ['Caso', 'LUT modelo', 'LUT Vitis', 'LUT Vivado', 'CARRY4 modelo', 'CARRY4 Vivado', 'FF modelo', 'FF Vitis', 'FF Vivado', 'DSP'],
        rows.map((r) => [r.case, String(r.model.luts), r.hls ? String(r.hls.lut) : '-', r.impl?.lut !== undefined ? String(r.impl.lut) : '-', String(r.model.carry4), r.impl?.carry4 !== undefined ? String(r.impl.carry4) : '-', String(r.model.ff), r.hls ? String(r.hls.ff) : '-', r.impl?.ff !== undefined ? String(r.impl.ff) : '-', r.hls ? String(r.hls.dsp ?? 0) : '-']));
    // Laços: II e latência por laço, casados pelo rótulo.
    const loopRows = [];
    const over = { seq: [], pipe: [] };
    for (const r of done) for (const l of r.model.loops) {
        const v = r.hls.loops.find((x) => x.name === l.label || x.name.startsWith(`${l.label}`) || x.name.endsWith(`_${l.label}`));
        loopRows.push([r.case, l.label, l.mode === 'pipelined' ? 'pipeline' : 'sequencial', String(l.trip), l.II ? String(l.II) : '-', v?.II ? String(v.II) : '-', String(l.latency), v?.latency !== null && v?.latency !== undefined ? String(v.latency) : '-']);
        if (!v || v.latency === null) continue;
        // Sobrecarga por laço: o que sobra da latência do Vitis depois do corpo e do II.
        if (l.mode === 'pipelined' && v.II) over.pipe.push(v.latency - ((v.depth ?? l.iterLatency) + (l.trip - 1) * v.II));
        if (l.mode === 'sequential' && v.iterLatency) over.seq.push(v.iterLatency - (l.iterLatency - MODEL.loopOverhead));
    }
    table('Laços: II e latência (ciclos)', ['Caso', 'Laço', 'Modo', 'Iterações', 'II modelo', 'II Vitis', 'Latência modelo', 'Latência Vitis'], loopRows);
    // Calibração sugerida.
    const lutR = med(done.map((r) => ratio(r.impl?.lut ?? r.hls.lut, r.model.luts)));
    const ffR = med(done.map((r) => ratio(r.impl?.ff ?? r.hls.ff, r.model.ff)));
    const cycR = med(done.map((r) => ratio(r.hls.latencyWorst, r.model.cycles)));
    const cal = {
        loopOverhead: med(over.seq), pipelineOverhead: med(over.pipe), lutScale: lutR, ffScale: ffR, cycleRatio: cycR,
        samples: { sequentialLoops: over.seq.length, pipelinedLoops: over.pipe.length, cases: done.length },
    };
    writeFileSync(join(RES, 'calibracao.json'), `${JSON.stringify(cal, null, 1)}\n`);
    md.push('### Calibração sugerida', '', `Medianas sobre ${done.length} casos: sobrecarga por iteração de laço sequencial ${br(cal.loopOverhead, 0)} ciclos (o modelo usa ${MODEL.loopOverhead}), entrada e saída do pipeline ${br(cal.pipelineOverhead, 0)} ciclos (o modelo usa ${MODEL.pipelineOverhead}); LUT Vitis ou Vivado / modelo ${br(cal.lutScale, 2)}; FF ${br(cal.ffScale, 2)}; latência Vitis / modelo ${br(cal.cycleRatio, 3)}. Os valores ficam em \`results/vitis/calibracao.json\`; a decisão de aplicar ao modelo (\`MODEL\` em \`js/hls/sched.js\`) é feita depois de olhar os casos que divergem.`, '');
    writeFileSync(join(RES, 'RESULTADOS.md'), `${md.join('\n')}\n`);
    writeFileSync(join(RES, 'tabelas.tex'), `${tex.join('\n')}\n`);
    log(`results/vitis: ${done.length} casos com csynth, ${rows.filter((r) => r.impl).length} com impl, ${rows.filter((r) => r.csim).length} com csim`);
}

switch (cmd) {
    case 'export': doExport(); break;
    case 'check': doCheck(); break;
    case 'collect': doCollect(); break;
    default:
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 17).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}
