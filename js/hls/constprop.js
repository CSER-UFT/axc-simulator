/**
 * Propagação de constantes na netlist de uma unidade: quanto da unidade sobra quando parte dos bits de entrada é
 * conhecida (um operando constante, como os coeficientes de um filtro, ou os bits altos que a análise de faixas sabe
 * que são zero). A síntese (Vivado, Yosys) faz o mesmo; no Vivado, um MUL8 T8 +C com um coeficiente constante ficou
 * com 9 a 14 LUTs, contra 49 da unidade inteira.
 *
 *   portas      E, OU e OU exclusivo com uma entrada constante viram fio ou constante; com as duas entradas no mesmo
 *               fio, também; inversores não contam (ficam dentro das LUTs);
 *   vivas       só as portas que chegam a alguma saída, depois da propagação;
 *   custo       a fração de portas vivas escala as LUTs, a área, a energia e a fuga da unidade; a fração das portas
 *               das cadeias de vai um escala os CARRY4. O atraso fica o da unidade inteira (conservador).
 */
import { OP } from '../axc/netlist.js';

/** Portas que contam (de duas entradas, vivas) e as das cadeias, com os bits de entrada conhecidos. */
function liveGates(net, known) {
    const n = net.n;
    const val = new Int8Array(n).fill(-1); // -1 desconhecido, 0 ou 1 constante
    const rep = new Int32Array(n);         // fio que representa este (depois de virar fio)
    for (let i = 0; i < n; i++) rep[i] = i;
    val[0] = 0; val[1] = 1;
    for (const [side, bits] of [['a', known.a], ['b', known.b]]) {
        const ws = net.inputs[side];
        for (let i = 0; i < ws.length; i++) if ((bits.mask >> i) & 1) val[ws[i]] = (bits.value >> i) & 1;
    }
    const ops = net.ops, m = ops.length / 4;
    const cost = new Uint8Array(m), inA = new Int32Array(m).fill(-1), inB = new Int32Array(m).fill(-1);
    const inChain = new Uint8Array(m);
    for (const ch of net.chains ?? []) for (let p = ch.op0; p < ch.op1; p += 4) inChain[p / 4] = 1;
    const R = (w) => rep[w];
    for (let k = 0; k < m; k++) {
        const op = ops[4 * k], out = ops[4 * k + 1];
        const x = R(ops[4 * k + 2]), y = op === OP.NOT ? x : R(ops[4 * k + 3]);
        const vx = val[x], vy = val[y];
        const alias = (w) => { rep[out] = w; val[out] = val[w]; };
        const constant = (c) => { val[out] = c; };
        const gate = (c) => { cost[k] = c; inA[k] = x; inB[k] = y; };
        if (op === OP.NOT) { if (vx >= 0) constant(1 - vx); else gate(0); continue; }
        if (op === OP.AND) {
            if (vx === 0 || vy === 0) constant(0); else if (vx === 1) alias(y); else if (vy === 1) alias(x); else if (x === y) alias(x); else gate(1);
        } else if (op === OP.OR) {
            if (vx === 1 || vy === 1) constant(1); else if (vx === 0) alias(y); else if (vy === 0) alias(x); else if (x === y) alias(x); else gate(1);
        } else if (op === OP.XOR) {
            if (vx >= 0 && vy >= 0) constant(vx ^ vy); else if (vx === 0) alias(y); else if (vy === 0) alias(x); else if (x === y) constant(0);
            else if (vx === 1 || vy === 1) { cost[k] = 0; inA[k] = vx === 1 ? y : x; inB[k] = inA[k]; } // inversor
            else gate(1);
        }
    }
    // Vivas: as que chegam às saídas.
    const driver = new Int32Array(n).fill(-1);
    for (let k = 0; k < m; k++) if (inA[k] >= 0) driver[ops[4 * k + 1]] = k;
    const seen = new Uint8Array(m);
    const stack = net.outputs.map(R);
    let live = 0, chain = 0;
    while (stack.length) {
        const w = stack.pop();
        const k = driver[w];
        if (k < 0 || seen[k]) continue;
        seen[k] = 1;
        live += cost[k];
        if (inChain[k]) chain += cost[k];
        stack.push(inA[k], inB[k]);
    }
    return { live, chain };
}

const memo = new Map();
/**
 * Fração da unidade que sobra com os bits conhecidos ({mask, value} por entrada, bit 0 o menos significativo).
 * @returns {{gates: number, chain: number}} frações (1 = a unidade inteira)
 */
export function liveFraction(name, net, known) {
    const key = `${name}|${known.a.mask},${known.a.value}|${known.b.mask},${known.b.value}`;
    if (memo.has(key)) return memo.get(key);
    if (!memo.has(`${name}|base`)) memo.set(`${name}|base`, liveGates(net, { a: { mask: 0, value: 0 }, b: { mask: 0, value: 0 } }));
    const base = memo.get(`${name}|base`);
    const cur = liveGates(net, known);
    const r = { gates: base.live ? cur.live / base.live : 1, chain: base.chain ? cur.chain / base.chain : 1 };
    if (memo.size > 50000) memo.clear();
    memo.set(key, r);
    return r;
}
