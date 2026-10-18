#!/usr/bin/env node
/**
 * Caracterização das unidades da biblioteca no Vivado (2022.2), na mesma parte da validação: LUTs, CARRY4 e atraso
 * de registrador a registrador de cada unidade, das operações nativas do Vivado (a + b, a * b sem DSP) e das peças do
 * modelo (comparador, seleção, xor, registrador). Tudo roda a partir da pasta do repositório.
 *
 *   node scripts/vivado-units.mjs export [--part xc7a100tcsg324-1] [--only "MUL8 DRUM6,ADD16 LOA6"] [--chunks 4]
 *       gera build/vivado-units/: um Verilog por unidade com um invólucro de registradores na entrada e na saída,
 *       os scripts Tcl (um por parte da lista) e run_units.sh;
 *   bash build/vivado-units/run_units.sh [-j 4] [--route]
 *       roda o Vivado em lote (síntese fora de contexto; com --route, também posicionamento e roteamento);
 *   node scripts/vivado-units.mjs collect
 *       lê os resultados e grava data/vivado-units.json, que a biblioteca usa no alvo FPGA (LUT, CARRY4 e atraso
 *       do Vivado no lugar dos do Yosys e do sky130).
 *
 * O atraso é o do caminho de dados mais longo entre os registradores do invólucro (o que inclui o relógio para a
 * saída e o setup), com o relógio apertado (1 ns) para o Vivado otimizar para atraso.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toVerilog } from '../js/axc/verilog.js';
import { buildUnit } from '../js/axc/units.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build/vivado-units');
const DATA = join(ROOT, 'data/vivado-units.json');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const log = (...a) => console.error(...a);

/** Invólucro: registradores nas entradas e na saída, para medir o caminho da unidade. */
function wrapper(mod, ins, outBits) {
    const decl = ins.map(([n, w]) => `    input  wire [${w - 1}:0] ${n},`).join('\n');
    const regs = ins.map(([n, w]) => `    reg [${w - 1}:0] r_${n};`).join('\n');
    const load = ins.map(([n]) => `r_${n} <= ${n};`).join(' ');
    return `module w_${mod} (
    input  wire clk,
${decl}
    output reg  [${outBits - 1}:0] q
);
${regs}
    wire [${outBits - 1}:0] y;
    ${mod} u (${ins.map(([n]) => `.${n}(r_${n})`).join(', ')}, .y(y));
    always @(posedge clk) begin ${load} q <= y; end
endmodule
`;
}

/** Peças nativas: as operações exatas como o Vitis as escreve, e as células do modelo. */
function natives() {
    const list = [];
    for (const W of [8, 16]) {
        list.push({ name: `ADD${W} nativo`, mod: `nat_add${W}`, ins: [['a', W], ['b', W]], out: W + 1, body: 'assign y = a + b;' });
        list.push({ name: `MUL${W} nativo`, mod: `nat_mul${W}`, ins: [['a', W], ['b', W]], out: 2 * W, body: 'assign y = a * b;', attr: '(* use_dsp = "no" *) ' });
    }
    list.push({ name: 'ADD32 nativo', mod: 'nat_add32', ins: [['a', 32], ['b', 32]], out: 33, body: 'assign y = a + b;' });
    for (const W of [8, 16, 32]) {
        list.push({ name: `cmp${W}`, mod: `nat_cmp${W}`, ins: [['a', W], ['b', W]], out: 1, body: 'assign y = a < b;' });
        list.push({ name: `mux${W}`, mod: `nat_mux${W}`, ins: [['s', 1], ['a', W], ['b', W]], out: W, body: 'assign y = s[0] ? a : b;' });
        list.push({ name: `logic${W}`, mod: `nat_xor${W}`, ins: [['a', W], ['b', W]], out: W, body: 'assign y = a ^ b;' });
    }
    list.push({ name: 'reg', mod: 'nat_reg', ins: [['a', 1]], out: 1, body: 'assign y = a;' });
    return list.map((n) => ({
        ...n,
        verilog: `${n.attr ?? ''}module ${n.mod} (\n${n.ins.map(([x, w]) => `    input  wire [${w - 1}:0] ${x},`).join('\n')}\n    output wire [${n.out - 1}:0] y\n);\n    ${n.body}\nendmodule\n`,
    }));
}

function doExport() {
    const part = opt('--part', 'xc7a100tcsg324-1');
    const chunks = +opt('--chunks', 4);
    const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
    const synth = JSON.parse(readFileSync(join(ROOT, 'data/synth.json'), 'utf8'));
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(join(OUT, 'rtl'), { recursive: true });
    mkdirSync(join(OUT, 'out'), { recursive: true });
    const items = [];
    for (const d of synth.designs) {
        if (only && !only.has(d.name)) continue;
        const unit = buildUnit(d.cfg);
        const N = d.cfg.width, W = unit.net.outputs.length;
        items.push({ name: d.name, mod: d.module, ins: [['a', N], ['b', N]], out: W, verilog: toVerilog(unit, d.module) });
    }
    for (const n of natives()) if (!only || only.has(n.name)) items.push(n);
    for (const it of items) writeFileSync(join(OUT, 'rtl', `${it.mod}.v`), `${it.verilog}\n${wrapper(it.mod, it.ins, it.out)}`);
    const per = Math.ceil(items.length / chunks);
    const parts = [];
    for (let k = 0; k < chunks; k++) {
        const list = items.slice(k * per, (k + 1) * per);
        if (!list.length) continue;
        const file = `units_${k}.tcl`;
        parts.push(file);
        writeFileSync(join(OUT, file), `# Caracterização das unidades no Vivado, parte ${k + 1} de ${chunks}. Gerado por scripts/vivado-units.mjs.
# Uso, da pasta do repositório: vivado -mode batch -source build/vivado-units/${file} [-tclargs route]
set here [file dirname [file normalize [info script]]]
set route [expr {[llength $argv] > 0 && [lindex $argv 0] eq "route"}]
set out [open "$here/out/units_${k}.csv" w]
puts $out "name;module;lut;carry4;ff;delay_ns;route"
proc measure {here out route name mod} {
    if {[catch {
        read_verilog "$here/rtl/$mod.v"
        synth_design -top w_$mod -part ${part} -mode out_of_context -flatten_hierarchy rebuilt
        create_clock -period 1.000 -name clk [get_ports clk]
        if {$route} { opt_design; place_design; route_design }
        set lut [llength [get_cells -hier -filter {REF_NAME =~ LUT*}]]
        set c4 [llength [get_cells -hier -filter {REF_NAME == CARRY4}]]
        set ff [llength [get_cells -hier -filter {REF_NAME =~ FD*}]]
        set p [lindex [get_timing_paths -max_paths 1 -nworst 1 -setup] 0]
        set d [expr {$p eq "" ? "" : [get_property DATAPATH_DELAY $p]}]
        puts $out "$name;$mod;$lut;$c4;$ff;$d;$route"
    } err]} { puts $out "$name;$mod;;;;;erro: [string map {"\\n" " " ";" ","} $err]" }
    flush $out
    close_design -quiet
    remove_files -quiet [get_files -quiet]
}
${list.map((it) => `measure $here $out $route {${it.name}} ${it.mod}`).join('\n')}
close $out
exit
`);
    }
    writeFileSync(join(OUT, 'run_units.sh'), `#!/usr/bin/env bash
# Roda a caracterização (gerada por: node scripts/vivado-units.mjs export). Uso: bash build/vivado-units/run_units.sh [-j N] [--route]
set -u
cd "$(dirname "$0")/../.."
J=${chunks}; ROUTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    -j) J="$2"; shift 2 ;;
    --route) ROUTE="-tclargs route"; shift ;;
    *) echo "opção desconhecida: $1"; exit 1 ;;
  esac
done
command -v vivado >/dev/null || { echo "vivado não está no PATH (source /tools/Xilinx/Vivado/2022.2/settings64.sh)"; exit 1; }
run_one() {
  f="$1"
  echo "[$(date +%H:%M:%S)] $f"
  ( cd build/vivado-units && vivado -mode batch -nojournal -log "out/\${f%.tcl}.log" -source "$f" $ROUTE > /dev/null 2>&1 ) \\
    && echo "[$(date +%H:%M:%S)] $f pronto" || echo "[$(date +%H:%M:%S)] $f FALHOU (veja build/vivado-units/out/\${f%.tcl}.log)"
}
export -f run_one; export ROUTE
echo "${parts.join(' ')}" | tr ' ' '\\n' | xargs -P "$J" -I{} bash -c 'run_one {}'
echo "Depois: node scripts/vivado-units.mjs collect"
`, { mode: 0o755 });
    writeFileSync(join(OUT, 'units.json'), `${JSON.stringify({ part, generated: new Date().toISOString(), items: items.map((i) => ({ name: i.name, module: i.mod })) }, null, 1)}\n`);
    log(`${items.length} unidades e peças em ${parts.length} scripts (build/vivado-units). Para rodar: bash build/vivado-units/run_units.sh -j ${chunks}`);
}

function doCollect() {
    const meta = JSON.parse(readFileSync(join(OUT, 'units.json'), 'utf8'));
    const units = {};
    const errors = [];
    let route = false;
    for (const f of readdirSync(join(OUT, 'out')).filter((x) => x.endsWith('.csv'))) {
        for (const line of readFileSync(join(OUT, 'out', f), 'utf8').trim().split('\n').slice(1)) {
            const [name, mod, lut, c4, ff, d, r] = line.split(';');
            if (r?.startsWith('erro')) { errors.push(`${name}: ${r}`); continue; }
            if (r === '1') route = true;
            units[name] = { module: mod, luts: +lut, carry4: +c4, ff: +ff, delayPs: d === '' ? null : Math.round(+d * 1000) };
        }
    }
    const missing = meta.items.filter((i) => !units[i.name]).map((i) => i.name);
    writeFileSync(DATA, `${JSON.stringify({ part: meta.part, generated: new Date().toISOString(), tool: 'Vivado 2022.2', flow: route ? 'síntese fora de contexto, posicionamento e roteamento' : 'síntese fora de contexto', units }, null, 1)}\n`);
    log(`data/vivado-units.json: ${Object.keys(units).length} de ${meta.items.length}${missing.length ? `; faltam ${missing.length} (${missing.slice(0, 5).join(', ')}...)` : ''}${errors.length ? `; ${errors.length} com erro (${errors[0]})` : ''}`);
}

switch (argv[0]) {
    case 'export': doExport(); break;
    case 'collect': doCollect(); break;
    default:
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 18).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}
