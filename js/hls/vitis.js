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
 *                    propagação de vai um escritas como + (o Vitis usa a cadeia de carry, como o Yosys). Por padrão
 *                    com INLINE off (cada unidade é um módulo, compartilhável, como no modelo; o Vitis pode dividir a
 *                    netlist em estágios, com registradores dentro do módulo); com 'lat0', também LATENCY max=0 (o
 *                    módulo fica combinacional, como o modelo supõe); com inline, a lógica entra no caminho de dados;
 *   testbench        lê as entradas (a imagem de teste ou valores uniformes) e as saídas esperadas, calculadas pela
 *                    execução bit a bit do simulador, e conta as diferenças nas posições escritas pelo kernel.
 */
import { OP } from '../axc/netlist.js';
import { buildUnit } from '../axc/units.js';
import { toVerilog, moduleName } from '../axc/verilog.js';
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
export function unitFunction(cfg, name, { inline = false } = {}) {
    // inline: true (INLINE), false (INLINE off) ou 'lat0' (INLINE off com LATENCY max=0: módulo combinacional).
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
    const out = [`// ${name}: ${net.gates} portas de duas entradas (netlist do axc-simulator).`, `static ap_uint<${W}> ${cName(name)}(ap_uint<${N}> a, ap_uint<${N}> b) {`, ...pragmasOf(inline)];
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

const pragmasOf = (inline) => (inline === true || inline === 'rtl' ? ['#pragma HLS INLINE'] : inline === 'lat0' ? ['#pragma HLS INLINE off', '#pragma HLS LATENCY min=0 max=0'] : ['#pragma HLS INLINE off']);

/** Funções das unidades usadas (inclusive o somador de 32 bits composto). */
function unitFunctions(lib, names, inline = false) {
    const done = new Set(), out = [];
    const add = (name) => {
        if (done.has(name)) return;
        done.add(name);
        const u = lib.unitByName(name);
        if (u.composite) {
            // Cascata: o somador de baixo (L bits, aproximado ou exato), um exato em cima, o vai um passando de um
            // para o outro (o ADD32 de dois ADD16 exatos e as cascatas ADDW (ADDn X + ADDm exato) das redes).
            add(u.low);
            const W = u.cfg.width, L = lib.unitByName(u.low).cfg.width, H = W - L;
            out.push([
                `// ${name}: o somador de ${L} bits de baixo, um exato de ${H} bits em cima, o vai um passando de um para o outro.`,
                `static ap_uint<${W + 1}> ${cName(name)}(ap_uint<${W}> a, ap_uint<${W}> b) {`,
                ...pragmasOf(inline),
                `    ap_uint<${L + 1}> lo = ${cName(u.low)}(a.range(${L - 1}, 0), b.range(${L - 1}, 0));`,
                `    ap_uint<${H + 1}> hi = ap_uint<${H + 1}>(a.range(${W - 1}, ${L})) + ap_uint<${H + 1}>(b.range(${W - 1}, ${L})) + ap_uint<${H + 1}>(lo[${L}]);`,
                `    ap_uint<${W + 1}> y = 0;`,
                `    y.range(${L - 1}, 0) = lo.range(${L - 1}, 0);`,
                `    y.range(${W}, ${L}) = hi;`,
                '    return y;',
                '}',
            ].join('\n'));
            return;
        }
        if (inline === 'rtl') {
            // RTL como caixa preta: a função do Vitis é a do JSON (blackboxFiles); aqui só a declaração e uma função em
            // linha que devolve o valor, para o kernel chamar como nas outras formas.
            const N = u.cfg.width, W = buildUnit(u.cfg).net.outputs.length, f = cName(name);
            out.push([
                `// ${name}: RTL do Verilog exportado (caixa preta do Vitis, ${f}_bb.json); na csim, o modelo C da mesma netlist.`,
                `ap_uint<${W}> ${f}_bb(ap_uint<${N}> a, ap_uint<${N}> b);`,
                `static ap_uint<${W}> ${f}(ap_uint<${N}> a, ap_uint<${N}> b) {`,
                '#pragma HLS INLINE',
                `    return ${f}_bb(a, b);`,
                '}',
            ].join('\n'));
            return;
        }
        out.push(unitFunction(u.cfg, name, { inline }));
    };
    for (const n of names) add(n);
    return out.join('\n\n');
}

/** Unidades com netlist usadas (os somadores de 32 bits compostos entram pelo de baixo). */
function netUnits(lib, names) {
    const out = new Set();
    for (const n of names) { const u = lib.unitByName(n); out.add(u.composite ? u.low : n); }
    return [...out];
}

/**
 * Arquivos da caixa preta de RTL de cada unidade usada (Vitis 2022.2, add_files -blackbox): o Verilog da netlist com
 * um invólucro que tem as portas que o Vitis exige (ap_clk, ap_rst, ap_ce, sem uso), as entradas e o valor devolvido
 * como fio (ap_return; uma saída por referência seria ap_vld, que o Vitis recusa dentro de um pipeline);
 * o modelo C (a mesma netlist em C++, para a csim) e o JSON que liga os dois, combinacional (latência 0, II 1).
 * @returns {{files: Object<string, string>, jsons: string[]}}
 */
export function blackboxFiles(lib, names) {
    const files = {}, jsons = [];
    for (const name of netUnits(lib, names)) {
        const u = lib.unitByName(name), unit = buildUnit(u.cfg);
        const N = u.cfg.width, W = unit.net.outputs.length, f = cName(name), mod = moduleName(u.cfg), top = `${f}_bb`; // o módulo de RTL com o mesmo nome da função: o Vitis o instancia pelo nome da função
        files[`${f}_bb.cpp`] = `${HEADER(`${name}, modelo C da caixa preta`)}
${unitFunction(u.cfg, name, { inline: true })}

ap_uint<${W}> ${f}_bb(ap_uint<${N}> a, ap_uint<${N}> b) {
    return ${f}(a, b);
}
`;
        files[`${top}.v`] = `${toVerilog(unit, mod)}
// Invólucro para a caixa preta do Vitis: relógio, reset e habilitação exigidos pela ferramenta, sem uso (a unidade é
// combinacional). Entradas e saída como fio (o Vitis 2022.2 só aceita caixa preta de fio dentro de um pipeline).
module ${top} (
    input  wire ap_clk,
    input  wire ap_rst,
    input  wire ap_ce,
    input  wire [${N - 1}:0] a,
    input  wire [${N - 1}:0] b,
    output wire [${W - 1}:0] ap_return
);
    ${mod} u (.a(a), .b(b), .y(ap_return));
endmodule
`;
        files[`${f}_bb.json`] = `${JSON.stringify({
            c_function_name: `${f}_bb`,
            rtl_top_module_name: top,
            c_files: [{ c_file: `${f}_bb.cpp`, cflag: '' }],
            rtl_files: [`${top}.v`],
            c_parameters: [
                { c_name: 'a', c_port_direction: 'in', rtl_ports: { data_read_in: 'a' } },
                { c_name: 'b', c_port_direction: 'in', rtl_ports: { data_read_in: 'b' } },
            ],
            c_return: { c_port_direction: 'out', rtl_ports: { data_write_out: 'ap_return' } },
            rtl_common_signal: {
                module_clock: 'ap_clk', module_reset: 'ap_rst', module_clock_enable: 'ap_ce',
                ap_ctrl_chain_protocol_idle: '', ap_ctrl_chain_protocol_start: '', ap_ctrl_chain_protocol_ready: '', ap_ctrl_chain_protocol_done: '', ap_ctrl_chain_protocol_continue: '',
            },
            rtl_performance: { latency: '0', II: '1' },
            rtl_resource_usage: { FF: '0', LUT: '0', BRAM: '0', URAM: '0', DSP: '0' },
        }, null, 4)}\n`;
        jsons.push(`${f}_bb.json`);
    }
    return { files, jsons };
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
    return design.arrays.flatMap((a) => (a.partitions ?? []).map((p) => `#pragma HLS ARRAY_PARTITION variable=${a.name} type=${p.type}${p.type !== 'complete' ? ` factor=${p.factor}` : ''} dim=${p.dim}`));
}

/**
 * Kernel do código original: os tipos do simulador viram ap_int, min/max/abs viram funções; as diretivas ficam como
 * estão. Só exato.
 */
export function exportSource(src, design) {
    const params = design.arrays.filter((a) => a.kind === 'param');
    const body = src.replace(new RegExp(`(void\\s+${design.name}\\s*\\([^)]*\\)\\s*\\{)`), (m) => `${m}\n${interfacePragmas(design).join('\n')}\n`);
    return `${HEADER(`${design.name} (código original)`)}#include "kernel.h"

// min, max e abs da linguagem do simulador (como macros, para não colidir com as da biblioteca padrão).
static inline long long axc_min(long long a, long long b) { return a < b ? a : b; }
static inline long long axc_max(long long a, long long b) { return a > b ? a : b; }
static inline long long axc_abs(long long a) { return a < 0 ? -a : a; }
#define min(a, b) axc_min((long long)(a), (long long)(b))
#define max(a, b) axc_max((long long)(a), (long long)(b))
#define abs(a) axc_abs((long long)(a))
${/\brequant\s*\(/.test(src) ? `\n${REQUANT_CPP}\n#define requant(acc, m, z) axc_requant(acc, m, z)\n` : ''}
${body.replace(/^\s*\/\/.*\n/, '')}`.replace(/\n{3,}/g, '\n\n') + (params.length ? '' : '');
}

/**
 * Reescala das redes (requant da linguagem do simulador, js/hls/elab.js): (acc × m + 2^31) >> 32, mais z, saturada
 * entre 0 e 255. A multiplicação vai para DSP (como no modelo), mesmo com config_op mul -impl fabric. Fica num módulo
 * próprio (INLINE off): em linha, o Vitis 2022.2 levou a multiplicação das camadas densas para a função do laço com
 * pipeline e perdeu o BIND_OP (aviso SYN 201-303; a multiplicação foi para LUTs).
 */
export const REQUANT_CPP = `// Reescala das redes quantizadas: (acc x m + 2^31) >> 32, mais z, saturada entre 0 e 255 (multiplicação em DSP).
static ap_uint<8> axc_requant(ap_int<32> acc, ap_uint<32> m, ap_int<32> z) {
#pragma HLS INLINE off
    ap_int<64> p = ap_int<64>(acc) * ap_int<64>(m);
#pragma HLS BIND_OP variable=p op=mul impl=dsp
    ap_int<64> q = (p + (ap_int<64>(1) << 31)) >> 32;
    ap_int<35> v = ap_int<35>(q) + ap_int<35>(z);
    return v < 0 ? ap_uint<8>(0) : v > 255 ? ap_uint<8>(255) : ap_uint<8>(v);
}`;
const usesRequant = (design) => design.segments.some((s) => s.nodes.some((n) => n.op === 'rq'));

/**
 * Kernel do projeto elaborado (IR), com as unidades atribuídas.
 * @param {object} result síntese (design, ops, assign, lib)
 */
export function exportIR(result, { inline = false } = {}) {
    const f = exportFunction(result);
    const code = [
        HEADER(`${result.design.name} (projeto elaborado${result.assign.size ? `, ${result.assign.size} operações aproximadas` : ''})`),
        '#include "kernel.h"',
        '',
        unitFunctions(result.lib, f.units, inline),
        '',
        ...(f.requant ? [REQUANT_CPP, ''] : []),
        f.code,
    ];
    return code.join('\n');
}

/** Unidades usadas por um conjunto de funções exportadas, como código C++ (cada unidade uma vez). */
export function unitsCode(lib, names, inline = false) { return unitFunctions(lib, names, inline); }

/**
 * Só a função do kernel elaborado (sem cabeçalho e sem as unidades), para juntar várias num projeto (a rede).
 * @param {{interfaces?: boolean, paramPartitions?: boolean}} o interfaces: as diretivas de interface (só no topo);
 *   paramPartitions: as partições dos vetores dos parâmetros (na rede, ficam nos vetores do topo)
 * @returns {{code: string, units: string[], requant: boolean}}
 */
export function exportFunction(result, { interfaces = true, paramPartitions = true } = {}) {
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
                if (u.cfg.kind === 'add' && n.op === 'sub') { set(`${T}(ap_uint<${N}>(~ap_uint<${N}>(${f}(ap_uint<${N}>(~ap_uint<${N}>(${val(a[0])})), ap_uint<${N}>(${val(a[1])})))))`); return; }
                if (u.cfg.kind === 'add') {
                    // Soma com sinal: módulo 2^N (sem o vai um); sem sinal, o vai um faz parte do resultado.
                    const sgn = n.range[0] < 0 || a.some((z) => (z.c !== undefined ? z.c < 0 : byId.get(z.n).range[0] < 0));
                    set(sgn ? `${T}(ap_uint<${N}>(${f}(ap_uint<${N}>(${val(a[0])}), ap_uint<${N}>(${val(a[1])}))))` : `${T}(${f}(ap_uint<${N}>(${val(a[0])}), ap_uint<${N}>(${val(a[1])})))`);
                    return;
                }
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
            case 'rq': set(`${T}(axc_requant(${val(a[0])}, ${val(a[1])}, ${val(a[2])}))`); return;
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
            for (const t of L.pragmas ?? []) lines.push(`#pragma HLS ${t}`);
            emitRegion(it.region, d + 1);
            lines.push(`${ind(d)}}`);
        }
    }
    emitRegion(design.top, 1);
    const roms = design.arrays.filter((a) => a.kind === 'rom' && a.accesses > 0);
    const rams = design.arrays.filter((a) => a.kind === 'ram');
    const keep = (a) => paramPartitions || a.kind !== 'param';
    const code = [
        `${prototype(design)} {`,
        ...(interfaces ? interfacePragmas(design) : []),
        ...partitionPragmas({ arrays: design.arrays.filter(keep) }),
        ...roms.map((a) => `    static const ${arrType(a.type)} ${a.name}[${a.dims.join('][')}] = {${a.init.join(', ')}};`),
        ...rams.map((a) => `    ${arrType(a.type)} ${a.name}[${a.dims.join('][')}];`),
        ...[...hoist].filter((id) => byId.has(id)).map((id) => `    ${byId.get(id).op === 'cmp' ? 'bool' : cType(byId.get(id).range)} ${vName(id)} = 0;`),
        ...carries.map((n) => `    ${cType(n.range)} c${vName(n.id)} = 0;`),
        ...lines,
        '}',
        '',
    ];
    return { code: code.join('\n'), units: [...unitsUsed], requant: usesRequant(design) };
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

/**
 * Tcl do Vitis HLS 2022.2 para um projeto (caminhos relativos à pasta do projeto): csim, csynth e, com as variáveis
 * de ambiente, a cosimulação (AXC_COSIM=1) e o Vivado com posicionamento e roteamento (AXC_IMPL=1).
 * @param {{id: string, note?: string, clockNs: number}} c
 */
export function tclScript(c, top, part, dataFiles, blackboxes = [], { usage = 'vitis_hls -f run.tcl', by = 'axc-simulator', autoPartition = true } = {}) {
    return `# ${c.id}: ${c.note ?? ''}. Gerado por ${by} (Vitis HLS 2022.2).
# Uso: ${usage}
# Variáveis de ambiente: AXC_IMPL=1 roda também o Vivado (export_design -flow impl); AXC_COSIM=1 roda a cosimulação.
set here [file dirname [file normalize [info script]]]
cd $here
open_project -reset proj
set_top ${top}
${blackboxes.map((j) => `add_files -blackbox ${j}`).join('\n')}
add_files kernel.cpp -cflags "-I$here"
add_files -tb tb.cpp -cflags "-I$here"
${dataFiles.map((f) => `add_files -tb ${f}`).join('\n')}
open_solution -reset solution1 -flow_target vivado
set_part {${part}}
create_clock -period ${c.clockNs} -name default
# Como no modelo: sem DSP (multiplicadores em LUT), sem pipeline automático de laços, memórias de 1 ciclo.
config_op mul -impl fabric
config_compile -pipeline_loops 0
${autoPartition ? '' : `# Sem a partição automática do Vitis (os vetores ficam só com as partições das diretivas, como no modelo); com
# AXC_AUTOPART=1, o Vitis particiona sozinho os vetores lidos nos laços com pipeline.
if {!([info exists ::env(AXC_AUTOPART)] && $::env(AXC_AUTOPART) == 1)} {
    if {[catch {config_array_partition -throughput_driven off} err]} { puts "AXC_AVISO config_array_partition: $err" }
}
`}# Uma diferença na csim (testbench devolve 1) não impede a síntese; o resultado fica no log.
if {[catch {csim_design} err]} { puts "AXC_CSIM_FALHOU $err" }
csynth_design
if {[info exists ::env(AXC_COSIM)] && $::env(AXC_COSIM) == 1} { cosim_design }
if {[info exists ::env(AXC_IMPL)] && $::env(AXC_IMPL) == 1} { export_design -flow impl -rtl verilog -format ip_catalog }
exit
`;
}

/** Previsões do modelo para um projeto (para comparar com o relatório do Vitis e do Vivado). */
export function prediction(r) {
    return {
        cycles: r.totals.cycles, timeNs: r.totals.timeNs, intervalNs: r.totals.intervalNs, critPs: r.totals.critPs,
        luts: r.totals.luts, carry4: r.totals.carry4, ff: r.totals.ff, areaUm2: r.totals.area, energyFj: r.totals.energy,
        // Laços achatados aparecem como um só (rows_cols), como no relatório do Vitis.
        loops: r.design.loops.filter((l) => l.mode !== 'unrolled' && !l.flatInto).map((l) => (l.flatLabel
            ? { label: l.flatLabel, mode: 'pipelined', flattened: true, trip: l.flatTrip, II: l.IIachieved ?? null, iterLatency: l.iterLatency, latency: l.latency }
            : { label: l.label ?? l.id, mode: l.mode, trip: l.tripHw, II: l.IIachieved ?? null, iterLatency: l.iterLatency, latency: l.latency })),
        addrLuts: r.cost.addr?.luts ?? 0,
        units: r.cost.units.map((u) => ({ unit: u.unit.name, count: u.count, luts: u.luts, carry4: u.carry4 })),
        model: r.model,
    };
}

/**
 * Projeto completo para síntese e implementação locais (Vitis HLS e Vivado): o kernel elaborado com as unidades
 * atribuídas como caixa preta de RTL (o Verilog da netlist com o invólucro de portas que o Vitis exige, o JSON e o
 * modelo C para a csim), o testbench com as entradas e a saída esperada (a execução bit a bit do simulador), o Tcl,
 * as previsões do modelo e um LEIAME.
 * @param {object} result síntese com a atribuição
 * @param {{inputs: Map, expected: object, part?: string, clockNs: number, id?: string, note?: string, target?: string}} o
 * @returns {Record<string, string>} nome do arquivo -> conteúdo
 */
export function projectFiles(result, { inputs, expected, part = 'xc7a100tcsg324-1', clockNs, id = result.design.name, note = '', target = 'asic', tcl = {} }) {
    const files = testbench(result.design, inputs, expected);
    files['kernel.h'] = kernelHeader(result.design);
    files['kernel.cpp'] = exportIR(result, { inline: 'rtl' });
    const data = Object.keys(files).filter((f) => f.endsWith('.dat'));
    const names = [...new Set(result.assign.values())];
    let bbs = [];
    if (names.length) { const bb = blackboxFiles(result.lib, names); Object.assign(files, bb.files); bbs = bb.jsons; }
    files['run.tcl'] = tclScript({ id, note, clockNs }, result.design.name, part, data, bbs, tcl);
    files['model.json'] = `${JSON.stringify({ id, note, clockNs, part, top: result.design.name, delays: target, assign: Object.fromEntries(result.assign), prediction: prediction(result) }, null, 1)}\n`;
    const p = prediction(result);
    files['LEIAME.txt'] = `Projeto ${id}: ${result.design.name}${note ? ` (${note})` : ''}
Gerado pelo axc-simulator (https://github.com/CSER-UFT/axc-simulator) para o Vitis HLS 2022.2 e o Vivado.

Conteúdo
  kernel.cpp, kernel.h   o projeto elaborado pelo simulador: os mesmos laços, diretivas e larguras; cada operação
                         aproximada chama a sua unidade.
${names.length ? `  u_*_bb.v               cada unidade em Verilog: a netlist e o invólucro (módulo com o nome da função C e as
                         portas ap_clk, ap_rst, ap_ce, a, b e ap_return que o Vitis exige numa caixa preta).
  u_*_bb.json            a descrição da caixa preta para o Vitis (add_files -blackbox): latência 0, II 1.
  u_*_bb.cpp             o modelo C da mesma netlist, usado na csim.
` : ''}  tb.cpp, *.dat          o testbench: as entradas e a saída esperada, da execução bit a bit do simulador; a csim
                         confere todas as posições e imprime AXC_MISMATCHES n OF total.
  run.tcl                o script do Vitis HLS.
  model.json             a atribuição das unidades e as previsões do modelo.

Uso (com o Vitis HLS no PATH: source /tools/Xilinx/Vitis_HLS/2022.2/settings64.sh)
  vitis_hls -f run.tcl                  csim e csynth (relatório em proj/solution1/syn/report)
  AXC_IMPL=1 vitis_hls -f run.tcl       também o Vivado: síntese, posicionamento e roteamento
                                        (relatório em proj/solution1/impl/report/verilog)
  AXC_COSIM=1 vitis_hls -f run.tcl      também a cosimulação

Configuração: parte ${part} (troque em set_part no run.tcl), período de ${clockNs} ns, multiplicadores em LUT (sem
DSP), sem pipeline automático de laços. Com a caixa preta, o Vitis não conhece o atraso da unidade e a encadeia como
se fosse instantânea: o período do Vivado é o que vale.

Previsões do modelo (atrasos ${target === 'fpga' ? 'do Vivado' : 'do sky130'})
  latência ${p.cycles} ciclos (${p.timeNs.toFixed(0)} ns), LUT ${p.luts} + CARRY4 ${p.carry4}, FF ${p.ff}, área sky130 ${p.areaUm2.toFixed(0)} µm²
`;
    return files;
}
