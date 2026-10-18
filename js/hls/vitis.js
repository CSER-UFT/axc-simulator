/**
 * Exportação para o Vitis HLS: o kernel em C++ (com ap_int), as unidades aproximadas como funções C++ e um testbench
 * que confere a saída com a execução bit a bit do simulador.
 *
 *   código original  o kernel como foi escrito (os tipos u8, i16 ... viram ap_uint e ap_int), só exato: compara a
 *                    nossa elaboração e as nossas larguras com as que o Vitis infere do código;
 *   projeto (IR)     o projeto elaborado pelo simulador: os laços mantidos, o corpo de cada trecho em linha reta (os
 *                    laços desenrolados já desenrolados), cada valor com a largura da nossa análise de faixas e cada
 *                    operação aproximada chamando a função da sua unidade. É o mesmo caminho de dados que o modelo de
 *                    custo avalia; a diferença entre os números é a do modelo, não a da entrada;
 *   unidades         a mesma netlist do simulador (e do Verilog exportado), uma atribuição por porta, com as somas com
 *                    propagação de vai um escritas como + (o Vitis usa a cadeia de carry, como o Yosys);
 *   testbench        lê as entradas (a imagem de teste ou valores uniformes) e as saídas esperadas, calculadas pela
 *                    execução bit a bit do simulador, e conta as diferenças nas posições escritas pelo kernel.
 */
import { OP } from '../axc/netlist.js';
import { buildUnit } from '../axc/units.js';
import { bitsFor, typeRange } from './elab.js';
import { outputArrays, inputArrays } from './exec.js';

export const cName = (unitName) => `u_${unitName.replace(/[^A-Za-z0-9]+/g, '_').replace(/_$/, '')}`;
const vName = (id) => `v${id.slice(1).replace('.', '_')}`;
const cType = (range) => (range[0] < 0 ? `ap_int<${bitsFor(range)}>` : `ap_uint<${bitsFor(range)}>`);
const arrType = (t) => (t.signed ? `ap_int<${t.bits}>` : `ap_uint<${t.bits}>`);
const cConst = (c) => (Number.isInteger(c) ? `${cType([c, c])}(${c < 0 ? `(long long)${c}` : `${c}ULL`})` : String(c));

/**
 * Função C++ de uma unidade da biblioteca, a partir da netlist.
 * @returns {string} código; a função recebe a e b sem sinal (N bits) e devolve os bits da saída
 */
export function unitFunction(cfg, name) {
    const unit = buildUnit(cfg);
    const net = unit.net, N = cfg.width, W = net.outputs.length;
    const A = net.inputs.a, B = net.inputs.b;
    const wire = (w) => {
        if (w === 0) return 'false';
        if (w === 1) return 'true';
        const ia = A.indexOf(w);
        if (ia >= 0) return `a[${ia}]`;
        const ib = B.indexOf(w);
        if (ib >= 0) return `b[${ib}]`;
        return `n${w}`;
    };
    const ops = net.ops;
    const sym = { [OP.AND]: '&', [OP.OR]: '|', [OP.XOR]: '^' };
    const out = [`// ${name}: ${net.gates} portas de duas entradas (netlist do axc-simulator).`, `static ap_uint<${W}> ${cName(name)}(ap_uint<${N}> a, ap_uint<${N}> b) {`, '#pragma HLS INLINE off'];
    // As somas com propagação de vai um viram um + de vetores (como no Verilog exportado), escrito no ponto da netlist
    // em que a cadeia começa; as portas de dentro da cadeia não são escritas.
    const inChain = new Uint8Array(ops.length / 4);
    const chainAt = new Map();
    net.chains.forEach((ch, i) => {
        if (ch.op1 <= ch.op0) return;
        for (let p = ch.op0; p < ch.op1; p += 4) inChain[p / 4] = 1;
        const L = ch.xs.length, ls = [];
        const vec = (ws, nm) => {
            ls.push(`    ap_uint<${L + 1}> ${nm} = 0;`);
            ws.forEach((w, k) => { if (w !== 0) ls.push(`    ${nm}[${k}] = ${wire(w)};`); });
        };
        vec(ch.xs, `cx${i}`);
        vec(ch.ys, `cy${i}`);
        ls.push(`    ap_uint<${L + 1}> chain${i} = cx${i} + cy${i} + ap_uint<1>(${wire(ch.cin)});`);
        const created = new Set();
        for (let p = ch.op0; p < ch.op1; p += 4) created.add(ops[p + 1]);
        ch.sums.forEach((w, k) => { if (created.has(w)) ls.push(`    bool n${w} = chain${i}[${k}];`); });
        if (created.has(ch.cout)) ls.push(`    bool n${ch.cout} = chain${i}[${L}];`);
        chainAt.set(ch.op0, ls);
    });
    for (let p = 0; p < ops.length; p += 4) {
        if (chainAt.has(p)) out.push(...chainAt.get(p));
        if (inChain[p / 4]) continue;
        const e = ops[p] === OP.NOT ? `!${wire(ops[p + 2])}` : `${wire(ops[p + 2])} ${sym[ops[p]]} ${wire(ops[p + 3])}`;
        out.push(`    bool n${ops[p + 1]} = ${e};`);
    }
    out.push(`    ap_uint<${W}> y = 0;`);
    net.outputs.forEach((w, j) => { if (w !== 0) out.push(`    y[${j}] = ${wire(w)};`); });
    out.push('    return y;', '}');
    return out.join('\n');
}

/** Funções das unidades usadas (inclusive o somador de 32 bits composto). */
function unitFunctions(lib, names) {
    const done = new Set(), out = [];
    const add = (name) => {
        if (done.has(name)) return;
        done.add(name);
        const u = lib.unitByName(name);
        if (u.cfg.kind === 'add' && u.cfg.width === 32) {
            add(u.low);
            out.push([
                `// ${name}: o somador de 16 bits de baixo aproximado, o de cima exato, o vai um passando de um para o outro.`,
                `static ap_uint<33> ${cName(name)}(ap_uint<32> a, ap_uint<32> b) {`,
                '#pragma HLS INLINE off',
                `    ap_uint<17> lo = ${cName(u.low)}(a.range(15, 0), b.range(15, 0));`,
                '    ap_uint<17> hi = ap_uint<17>(a.range(31, 16)) + ap_uint<17>(b.range(31, 16)) + ap_uint<17>(lo[16]);',
                '    ap_uint<33> y = 0;',
                '    y.range(15, 0) = lo.range(15, 0);',
                '    y.range(32, 16) = hi;',
                '    return y;',
                '}',
            ].join('\n'));
            return;
        }
        out.push(unitFunction(u.cfg, name));
    };
    for (const n of names) add(n);
    return out.join('\n\n');
}

const HEADER = (name) => `// ${name}: gerado pelo axc-simulator (scripts/vitis.mjs). Não editar: o export gera de novo.
#include <ap_int.h>
`;

/** Declaração da função do kernel (os vetores com os tipos de ap_int). */
function prototype(design) {
    const params = design.arrays.filter((a) => a.kind === 'param');
    return `void ${design.name}(${params.map((a) => `${arrType(a.type)} ${a.name}[${a.dims.join('][')}]`).join(', ')})`;
}

/** Diretivas de interface: memória (ap_memory) com 1 ou 2 portas, como no modelo. */
function interfacePragmas(design) {
    const storage = design.ports >= 2 ? 'ram_t2p' : 'ram_1p';
    return design.arrays.filter((a) => a.kind === 'param').map((a) => `#pragma HLS INTERFACE mode=ap_memory port=${a.name} storage_type=${storage}`);
}
function partitionPragmas(design) {
    return design.arrays.filter((a) => a.partition).map((a) => `#pragma HLS ARRAY_PARTITION variable=${a.name} type=${a.partition.type}${a.partition.type !== 'complete' ? ` factor=${a.partition.factor}` : ''} dim=${a.partition.dim}`);
}

/**
 * Kernel do código original: os tipos do simulador viram ap_int, min/max/abs viram funções; as diretivas ficam como
 * estão. Só exato.
 */
export function exportSource(src, design) {
    const params = design.arrays.filter((a) => a.kind === 'param');
    const body = src.replace(new RegExp(`(void\\s+${design.name}\\s*\\([^)]*\\)\\s*\\{)`), (m) => `${m}\n${interfacePragmas(design).join('\n')}`);
    return `${HEADER(`${design.name} (código original)`)}#include "kernel.h"

// min, max e abs da linguagem do simulador (como macros, para não colidir com as da biblioteca padrão).
static inline long long axc_min(long long a, long long b) { return a < b ? a : b; }
static inline long long axc_max(long long a, long long b) { return a > b ? a : b; }
static inline long long axc_abs(long long a) { return a < 0 ? -a : a; }
#define min(a, b) axc_min((long long)(a), (long long)(b))
#define max(a, b) axc_max((long long)(a), (long long)(b))
#define abs(a) axc_abs((long long)(a))

${body.replace(/^\s*\/\/.*\n/, '')}`.replace(/\n{3,}/g, '\n\n') + (params.length ? '' : '');
}

/**
 * Kernel do projeto elaborado (IR), com as unidades atribuídas.
 * @param {object} result síntese (design, ops, assign, lib)
 */
export function exportIR(result) {
    const design = result.design;
    const asg = result.assign;
    const byId = new Map();
    for (const seg of design.segments) for (const n of seg.nodes) byId.set(n.id, n);
    // Valores usados fora do trecho (ou como valor inicial de recorrência) e recorrências: declarados no início.
    const hoist = new Set();
    for (const seg of design.segments) for (const n of seg.nodes) {
        if (n.op === 'in' && n.from) hoist.add(n.from);
        if (n.initFrom) hoist.add(n.initFrom);
    }
    const carries = [];
    for (const seg of design.segments) for (const n of seg.nodes) if (n.op === 'carry') carries.push(n);
    const counters = new Map(design.loops.filter((l) => l.mode === 'sequential' || l.mode === 'pipelined').map((l, k) => [l.id, `t${k + 1}`]));
    const aff = (a) => {
        const parts = Object.entries(a.t).map(([s, k]) => (k === 1 ? counters.get(s) : `${k} * ${counters.get(s)}`));
        if (a.c || !parts.length) parts.push(String(a.c));
        return parts.join(' + ').replace(/\+ -/g, '- ');
    };
    const val = (x) => (x.c !== undefined ? cConst(x.c) : vName(x.n));
    const lines = [];
    const ind = (d) => '    '.repeat(d);
    const decl = (n) => (hoist.has(n.id) ? '' : `${n.op === 'cmp' ? 'bool' : cType(n.range)} `);
    const unitsUsed = new Set(asg.values());
    function emitNode(n, d) {
        const a = n.args;
        const T = n.op === 'cmp' ? 'bool' : cType(n.range);
        const set = (e) => lines.push(`${ind(d)}${decl(n)}${vName(n.id)} = ${e};`);
        switch (n.op) {
            case 'in':
                if (n.port) { const m = /^(\w+)\[(\d+)\](?:\[(\d+)\])?$/.exec(n.name); set(`${m[1]}[${m[2]}]${m[3] !== undefined ? `[${m[3]}]` : ''}`); } else set(`${T}(${vName(n.from)})`);
                return;
            case 'iv': set(`${T}(${aff(n.aff)})`); return;
            case 'carry': set(`c${vName(n.id)}`); return;
            case 'carryout': lines.push(`${ind(d)}c${vName(n.to)} = ${val(a[0])};`); return;
            case 'load': set(`${n.array}[${n.idx.map(aff).join('][')}]`); return;
            case 'store': lines.push(`${ind(d)}${n.array}[${n.idx.map(aff).join('][')}] = ${val(a[0])};`); return;
            case 'out': { const m = /^(\w+)\[(\d+)\](?:\[(\d+)\])?$/.exec(n.name); lines.push(`${ind(d)}${m[1]}[${m[2]}]${m[3] !== undefined ? `[${m[3]}]` : ''} = ${val(a[0])};`); return; }
            case 'add': case 'sub': case 'mul': {
                const name = asg.get(n.id);
                if (!name) { set(`${T}(${val(a[0])} ${n.op === 'add' ? '+' : n.op === 'sub' ? '-' : '*'} ${val(a[1])})`); return; }
                const u = result.lib.unitByName(name), N = u.cfg.width, W = u.cfg.kind === 'mul' ? 2 * N : N + 1;
                const f = cName(name);
                if (u.cfg.kind === 'add') { set(`${T}(${f}(ap_uint<${N}>(${val(a[0])}), ap_uint<${N}>(${val(a[1])})))`); return; }
                if (u.cfg.method === 'booth') { set(`${T}(ap_int<${W}>(${f}(ap_uint<${N}>(${val(a[0])}), ap_uint<${N}>(${val(a[1])}))))`); return; }
                // Sem sinal: os módulos na unidade e o sinal depois.
                const x = val(a[0]), y = val(a[1]);
                const signedArgs = a.some((z) => (z.c !== undefined ? z.c < 0 : byId.get(z.n).range[0] < 0));
                if (!signedArgs) { set(`${T}(${f}(ap_uint<${N}>(${x}), ap_uint<${N}>(${y})))`); return; }
                const ab = (z) => `ap_uint<${N}>(${z} < 0 ? ap_int<${N + 1}>(-${z}) : ap_int<${N + 1}>(${z}))`;
                set(`((${x} < 0) != (${y} < 0)) ? ${T}(-ap_int<${W + 1}>(${f}(${ab(x)}, ${ab(y)}))) : ${T}(${f}(${ab(x)}, ${ab(y)}))`);
                return;
            }
            case 'shl': set(`${T}(${T}(${val(a[0])}) << ${a[1].c})`); return;
            case 'shr': set(`${T}(${val(a[0])} >> ${a[1].c})`); return;
            case 'and': set(`${T}(${val(a[0])} & ${val(a[1])})`); return;
            case 'or': set(`${T}(${val(a[0])} | ${val(a[1])})`); return;
            case 'xor': set(`${T}(${val(a[0])} ^ ${val(a[1])})`); return;
            case 'not': set(`${T}(${T}(-1) - ${val(a[0])})`); return;
            case 'cmp': set(`${val(a[0])} ${n.cond} ${val(a[1])}`); return;
            case 'sel': set(`${val(a[0])} ? ${T}(${val(a[1])}) : ${T}(${val(a[2])})`); return;
            case 'trunc': set(`${T}(${val(a[0])})`); return;
            default: throw new Error(`exportação: operação ${n.op}`);
        }
    }
    function emitRegion(r, d) {
        for (const it of r.items) {
            if (it.k === 'seg') { for (const n of it.seg.nodes) emitNode(n, d); continue; }
            const L = it.region.loop, t = counters.get(L.id);
            // Valor inicial das recorrências deste laço.
            for (const sub of it.region.items) if (sub.k === 'seg') for (const n of sub.seg.nodes) {
                if (n.op !== 'carry') continue;
                const init = n.initFrom ? vName(n.initFrom) : n.initAff ? aff(n.initAff) : cConst(n.init ?? 0);
                lines.push(`${ind(d)}c${vName(n.id)} = ${init};`);
            }
            lines.push(`${ind(d)}${L.label ?? L.id}: for (int ${t} = 0; ${t} < ${L.tripHw}; ${t}++) {`);
            lines.push(L.mode === 'pipelined' ? `#pragma HLS PIPELINE II=${L.II ?? 1}` : '#pragma HLS PIPELINE off');
            emitRegion(it.region, d + 1);
            lines.push(`${ind(d)}}`);
        }
    }
    emitRegion(design.top, 1);
    const roms = design.arrays.filter((a) => a.kind === 'rom' && a.accesses > 0);
    const rams = design.arrays.filter((a) => a.kind === 'ram');
    const code = [
        HEADER(`${design.name} (projeto elaborado${asg.size ? `, ${asg.size} operações aproximadas` : ''})`),
        '#include "kernel.h"',
        '',
        unitFunctions(result.lib, [...unitsUsed]),
        '',
        `${prototype(design)} {`,
        ...interfacePragmas(design),
        ...partitionPragmas(design),
        ...roms.map((a) => `    static const ${arrType(a.type)} ${a.name}[${a.dims.join('][')}] = {${a.init.join(', ')}};`),
        ...rams.map((a) => `    ${arrType(a.type)} ${a.name}[${a.dims.join('][')}];`),
        ...[...hoist].filter((id) => byId.has(id)).map((id) => `    ${byId.get(id).op === 'cmp' ? 'bool' : cType(byId.get(id).range)} ${vName(id)} = 0;`),
        ...carries.map((n) => `    ${cType(n.range)} c${vName(n.id)} = 0;`),
        ...lines,
        '}',
        '',
    ];
    return code.join('\n');
}

/** Cabeçalho comum: tipos e a declaração do kernel. */
export function kernelHeader(design) {
    return `${HEADER(design.name)}#ifndef AXC_KERNEL_H
#define AXC_KERNEL_H
typedef ap_uint<8> u8;
typedef ap_uint<16> u16;
typedef ap_uint<32> u32;
typedef ap_int<8> i8;
typedef ap_int<16> i16;
typedef ap_int<32> i32;
${prototype(design)};
#endif
`;
}

/**
 * Testbench e dados: entradas (um valor por linha) e saídas esperadas ("índice valor", só as posições escritas).
 * @param {object} design
 * @param {Map<string, Float64Array>} inputs
 * @param {{mem: Map, written: Map}} expected execução do simulador com as mesmas unidades
 */
export function testbench(design, inputs, expected) {
    const files = {};
    const params = design.arrays.filter((a) => a.kind === 'param');
    const ins = new Set(inputArrays(design).map((a) => a.name));
    const outs = outputArrays(design);
    for (const a of params) if (ins.has(a.name)) files[`in_${a.name}.dat`] = `${Array.from(inputs.get(a.name), (v) => String(v)).join('\n')}\n`;
    for (const a of outs) {
        const m = expected.mem.get(a.name), w = expected.written.get(a.name);
        const rows = [];
        for (let k = 0; k < a.size; k++) if (w[k]) rows.push(`${k} ${m[k]}`);
        files[`exp_${a.name}.dat`] = `${rows.join('\n')}\n`;
    }
    const flat = (a) => `(&${a.name}${a.dims.map(() => '[0]').join('')})`;
    const tb = `// Testbench do ${design.name}: confere a saída do kernel com a execução bit a bit do axc-simulator.
#include <cstdio>
#include "kernel.h"

${params.map((a) => `static ${arrType(a.type)} ${a.name}[${a.dims.join('][')}];`).join('\n')}

static int load(const char *file, ${'ap_int<64>'} *dst, int n) {
    FILE *f = fopen(file, "r");
    if (!f) { printf("AXC_ERROR sem o arquivo %s\\n", file); return -1; }
    long long v;
    int k = 0;
    while (k < n && fscanf(f, "%lld", &v) == 1) dst[k++] = v;
    fclose(f);
    return k;
}

int main() {
    static ap_int<64> buf[${Math.max(...params.map((a) => a.size))}];
${params.filter((a) => ins.has(a.name)).map((a) => `    if (load("in_${a.name}.dat", buf, ${a.size}) != ${a.size}) return 2;
    for (int k = 0; k < ${a.size}; k++) ${flat(a)}[k] = buf[k];`).join('\n')}
    ${design.name}(${params.map((a) => a.name).join(', ')});
    int bad = 0, total = 0;
${outs.map((a) => `    {
        FILE *f = fopen("exp_${a.name}.dat", "r");
        if (!f) { printf("AXC_ERROR sem exp_${a.name}.dat\\n"); return 2; }
        long long k, v;
        while (fscanf(f, "%lld %lld", &k, &v) == 2) {
            total++;
            long long got = ${flat(a)}[k];
            if (got != v) { if (bad < 5) printf("diferente: ${a.name}[%lld] = %lld, esperado %lld\\n", k, got, v); bad++; }
        }
        fclose(f);
    }`).join('\n')}
    printf("AXC_MISMATCHES %d OF %d\\n", bad, total);
    return bad ? 1 : 0;
}
`;
    files['tb.cpp'] = tb;
    return files;
}

/** Faixa do tipo de um vetor (para conferir os dados). */
export const arrRange = (a) => typeRange(a.type);
