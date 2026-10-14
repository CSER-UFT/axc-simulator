/**
 * Exportação em Verilog: o mesmo circuito porta a porta que o simulador avalia, como um módulo estrutural
 * (uma atribuição por porta), e um testbench que confere a saída com vetores calculados pelo simulador.
 *
 * O módulo usa as portas a, b e y. Na síntese, a ferramenta otimiza a lógica de novo (no FPGA, agrupa as portas em
 * LUTs), então a área sintetizada mede a função da unidade, não a contagem de portas do modelo didático.
 */
import { OP } from './netlist.js';
import { unitName } from './units.js';

/** Nome de módulo válido em Verilog a partir da configuração (ex.: mul8_t4_a6c). */
export function moduleName(cfg) {
    return unitName(cfg).toLowerCase().replace(/exato/, 'exact').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * @param {object} unit saída de buildUnit
 * @returns {string} módulo Verilog
 */
export function toVerilog(unit, name = moduleName(unit.cfg)) {
    const net = unit.net;
    const N = unit.cfg.width, W = net.outputs.length;
    const A = net.inputs.a, B = net.inputs.b;
    const wire = (w) => {
        if (w === 0) return "1'b0";
        if (w === 1) return "1'b1";
        const ia = A.indexOf(w);
        if (ia >= 0) return `a[${ia}]`;
        const ib = B.indexOf(w);
        if (ib >= 0) return `b[${ib}]`;
        return `n${w}`;
    };
    const sym = { [OP.AND]: '&', [OP.OR]: '|', [OP.XOR]: '^' };
    const expr = (p) => (ops[p] === OP.NOT ? `~${wire(ops[p + 2])}` : `${wire(ops[p + 2])} ${sym[ops[p]]} ${wire(ops[p + 3])}`);
    const lines = [];
    lines.push(`// ${unitName(unit.cfg)}: gerado pelo Simulador de Computação Aproximada (axc-simulator).`);
    lines.push(`// ${net.gates} portas de duas entradas, profundidade lógica ${net.delay()}.`);
    lines.push(`module ${name} (`);
    lines.push(`    input  wire [${N - 1}:0] a,`);
    lines.push(`    input  wire [${N - 1}:0] b,`);
    lines.push(`    output wire [${W - 1}:0] y`);
    lines.push(');');
    const ops = net.ops;
    const internal = [];
    for (let p = 0; p < ops.length; p += 4) internal.push(`n${ops[p + 1]}`);
    for (let k = 0; k < internal.length; k += 12) lines.push(`    wire ${internal.slice(k, k + 12).join(', ')};`);
    // As somas com propagação de vai um viram um + de vetores: a síntese usa a cadeia de carry do FPGA
    // (CARRY4), como faria com um somador escrito à mão. As outras portas ficam como estão.
    const inChain = new Uint8Array(ops.length / 4);
    net.chains.forEach((ch, i) => {
        if (ch.op1 <= ch.op0) return;
        for (let p = ch.op0; p < ch.op1; p += 4) inChain[p / 4] = 1;
        const L = ch.xs.length;
        const vec = (ws) => `{1'b0, ${[...ws].reverse().map(wire).join(', ')}}`;
        lines.push(`    wire [${L}:0] chain${i} = ${vec(ch.xs)} + ${vec(ch.ys)} + ${wire(ch.cin)};`);
        const created = new Set();
        for (let p = ch.op0; p < ch.op1; p += 4) created.add(ops[p + 1]);
        ch.sums.forEach((w, k) => { if (created.has(w)) lines.push(`    assign n${w} = chain${i}[${k}];`); });
        if (created.has(ch.cout)) lines.push(`    assign n${ch.cout} = chain${i}[${L}];`);
    });
    for (let p = 0; p < ops.length; p += 4) {
        if (inChain[p / 4]) continue;
        lines.push(`    assign n${ops[p + 1]} = ${expr(p)};`);
    }
    net.outputs.forEach((w, j) => lines.push(`    assign y[${j}] = ${wire(w)};`));
    lines.push('endmodule');
    return `${lines.join('\n')}\n`;
}

/**
 * Testbench autoverificável: lê os vetores (a, b, y esperado, em hexadecimal) e conta as diferenças.
 * Imprime "MISMATCHES <n> OF <total>" no fim.
 */
export function testbench(unit, nVectors, vecFile, name = moduleName(unit.cfg)) {
    const N = unit.cfg.width, W = unit.net.outputs.length;
    return `\`timescale 1ns/1ps
// Testbench de ${unitName(unit.cfg)}: confere o Verilog gerado com as saídas calculadas pelo simulador.
module tb_${name};
    reg  [${N - 1}:0] a, b;
    wire [${W - 1}:0] y;
    reg  [${2 * N + W - 1}:0] vec [0:${nVectors - 1}];
    integer k, bad;
    ${name} dut (.a(a), .b(b), .y(y));
    initial begin
        $readmemh("${vecFile}", vec);
        bad = 0;
        for (k = 0; k < ${nVectors}; k = k + 1) begin
            {a, b} = vec[k][${2 * N + W - 1}:${W}];
            #1;
            if (y !== vec[k][${W - 1}:0]) begin
                if (bad < 5) $display("diferente: a=%h b=%h y=%h esperado=%h", a, b, y, vec[k][${W - 1}:0]);
                bad = bad + 1;
            end
        end
        $display("MISMATCHES %0d OF %0d", bad, ${nVectors});
        $finish;
    end
endmodule
`;
}

/**
 * Vetores de teste no formato do $readmemh: {a, b, y} em hexadecimal, uma linha por par.
 * @param {object} unit
 * @param {{a: Uint32Array, b: Uint32Array}} inp
 */
export function vectors(unit, inp) {
    const N = unit.cfg.width, W = unit.net.outputs.length;
    const y = unit.net.evaluate(inp.a, inp.b);
    const hex = (v, bits) => BigInt(v).toString(16).padStart(Math.ceil(bits / 4), '0');
    const total = 2 * N + W;
    const out = [];
    for (let k = 0; k < y.length; k++) {
        const v = (BigInt(inp.a[k]) << BigInt(N + W)) | (BigInt(inp.b[k]) << BigInt(W)) | BigInt(y[k]);
        out.push(hex(v, total));
    }
    return `${out.join('\n')}\n`;
}
