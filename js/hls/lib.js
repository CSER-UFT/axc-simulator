/**
 * Biblioteca de custos do modelo de HLS: as unidades aritméticas sintetizadas (data/synth.json) e as peças medidas
 * com o mesmo fluxo (data/hls-cells.json: multiplexador, lógica, comparador, registrador).
 *
 *   classes    add (soma, subtração e negação), mul, cmp, mux (seleção), logic (and, or, xor, not); deslocamentos por
 *              constante, truncamentos e a variável do laço são só fios (custo zero);
 *   larguras   8, 16 ou 32 bits, a menor que cabe nos operandos (a faixa de valores de cada operação). O somador de
 *              32 bits é feito com dois de 16 em cascata (o vai um passa de um para o outro); multiplicação acima de
 *              16 bits não tem unidade na biblioteca;
 *   alvos      ASIC sky130 (área em µm², atraso em ps, energia em fJ por operação), no fluxo de síntese escolhido
 *              (atraso mínimo, área mínima ou iso atraso), ou FPGA (LUTs e CARRY4; o atraso continua o do sky130,
 *              porque a biblioteca não tem atraso de FPGA).
 */
import { HlsError } from './lang.js';
import { bitsFor, magBits } from './elab.js';

export const WIDTHS = [8, 16, 32];
const FREE = new Set(['shl', 'shr', 'trunc', 'iv', 'in', 'carry', 'carryout', 'out', 'const']);
export const MEM = new Set(['load', 'store']);
const CLASS = { add: 'add', sub: 'add', mul: 'mul', cmp: 'cmp', sel: 'mux', and: 'logic', or: 'logic', xor: 'logic', not: 'logic' };
export const SHARED = new Set(['add', 'mul']);

export const opClass = (n) => (FREE.has(n.op) ? 'free' : MEM.has(n.op) ? 'mem' : CLASS[n.op]);

/** Largura (8, 16 ou 32) da operação, a partir das faixas dos operandos e do resultado. */
export function opWidth(n, rangeOf) {
    const ranges = n.args.map((a) => (a.c !== undefined ? [a.c, a.c] : rangeOf(a.n)));
    let w;
    switch (opClass(n)) {
        case 'mul': w = Math.max(...ranges.map(magBits)); break;
        case 'add': w = Math.max(...ranges.map(bitsFor), bitsFor(n.range) - 1); break;
        case 'cmp': w = Math.max(...ranges.map(bitsFor)); break;
        case 'mux': w = bitsFor(n.range); break;
        case 'logic': w = bitsFor(n.range); break;
        default: return null;
    }
    const W = WIDTHS.find((x) => x >= w);
    if (!W) throw new HlsError(`operação de ${w} bits: a biblioteca vai até 32 bits`, n.line);
    if (opClass(n) === 'mul' && W > 16) throw new HlsError(`multiplicação de ${w} bits: a biblioteca só tem multiplicadores de 8 e 16 bits (reduza o tipo dos operandos)`, n.line);
    return W;
}

/**
 * @param {object} synth data/synth.json
 * @param {object} cells data/hls-cells.json
 * @param {{flow?: 'delay'|'area'|'iso', target?: 'asic'|'fpga'}} o
 */
export function makeLibrary(synth, cells, { flow = 'delay', target = 'asic' } = {}) {
    const byName = new Map(synth.designs.map((d) => [d.name, d]));
    const cellFlow = flow === 'delay' ? 'delay' : 'area';
    /** Custo de uma unidade sintetizada pelo nome (MUL8 exato, ADD16 LOA8, ...). */
    function unit(name) {
        const d = byName.get(name);
        if (!d) throw new HlsError(`unidade ${name} não está na biblioteca sintetizada`);
        const f = d.asic.flows[flow] ?? d.asic.flows.delay;
        return { name, cfg: d.cfg, area: f.area, delay: f.delay, energy: f.energy, leakage: f.leakage, luts: d.luts, carry4: d.carry4, err: d.err };
    }
    const exactName = (cls, W) => `${cls === 'mul' ? 'MUL' : 'ADD'}${W} exato`;
    /** Unidade de uma classe e largura; o somador de 32 bits é a cascata de dois de 16. */
    function exactUnit(cls, W) {
        if (cls === 'add' && W === 32) {
            const u = unit('ADD16 exato');
            return { ...u, name: 'ADD32 (2 × ADD16 exato)', area: 2 * u.area, delay: 2 * u.delay, energy: 2 * u.energy, leakage: 2 * u.leakage, luts: 2 * u.luts, carry4: 2 * u.carry4, composite: 2 };
        }
        return unit(exactName(cls, W));
    }
    function cell(cls, W) {
        const key = { cmp: 'cmp', mux: 'mux', logic: 'xor' }[cls];
        const c = cells.cells[key][W][cellFlow];
        return { name: `${cls}${W}`, area: c.area, delay: c.delay, energy: c.energy, luts: c.luts, carry4: c.carry4 };
    }
    const reg = cells.register;
    return {
        flow, target, unit, exactUnit, cell,
        reg: { area: reg.area, energy: reg.energy, clkToQ: reg.clkToQ, setup: reg.setup, leakage: reg.leakage },
        /** Custo do multiplexador de n entradas por bit: (n - 1) multiplexadores de 2 entradas. */
        mux(n, W) {
            if (n <= 1) return { area: 0, delay: 0, energy: 0, luts: 0 };
            const c = cell('mux', WIDTHS.find((x) => x >= W) ?? 32);
            const k = n - 1;
            const levels = Math.ceil(Math.log2(n));
            // No FPGA, uma LUT6 faz um multiplexador de 4 entradas por bit.
            return { area: k * c.area * (W / (WIDTHS.find((x) => x >= W) ?? 32)), delay: levels * c.delay, energy: c.energy, luts: Math.ceil(W * Math.ceil((n - 1) / 3)) };
        },
    };
}
