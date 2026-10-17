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
        return { name, short: name.replace(/ \(.*\)/, ''), cfg: d.cfg, area: f.area, delay: f.delay, energy: f.energy, leakage: f.leakage, luts: d.luts, carry4: d.carry4, err: d.err };
    }
    const exactName = (cls, W) => `${cls === 'mul' ? 'MUL' : 'ADD'}${W} exato`;
    /** Somador de 32 bits: a cascata de dois de 16 (o de baixo pode ser aproximado; o vai um passa para o de cima). */
    function composite(lowName) {
        const lo = unit(lowName), hi = unit('ADD16 exato');
        const exact = lowName === 'ADD16 exato';
        return {
            name: exact ? 'ADD32 (2 × ADD16 exato)' : `ADD32 (${lowName} + ADD16 exato)`, short: exact ? 'ADD32' : `ADD32 (${lowName.slice(6)})`,
            cfg: { kind: 'add', width: 32, low: lo.cfg }, low: lowName,
            area: lo.area + hi.area, delay: lo.delay + hi.delay, energy: lo.energy + hi.energy, leakage: (lo.leakage ?? 0) + (hi.leakage ?? 0),
            luts: lo.luts + hi.luts, carry4: lo.carry4 + hi.carry4, err: lo.err, composite: 2,
        };
    }
    /** Unidade de uma classe e largura; o somador de 32 bits é a cascata de dois de 16. */
    function exactUnit(cls, W) {
        if (cls === 'add' && W === 32) return composite('ADD16 exato');
        return unit(exactName(cls, W));
    }
    /** Unidade pelo nome, inclusive os somadores de 32 bits compostos (ADD32 (ADD16 LOA8 + ADD16 exato)). */
    function unitByName(name) {
        if (name === 'ADD32 (2 × ADD16 exato)') return composite('ADD16 exato');
        const m = /^ADD32 \((ADD16 .+) \+ ADD16 exato\)$/.exec(name);
        return m ? composite(m[1]) : unit(name);
    }
    /** Unidades da biblioteca para uma classe e largura (a exata primeiro). */
    function candidates(cls, W) {
        if (cls === 'add' && W === 32) return [exactUnit('add', 32).name, ...candidates('add', 16).slice(1).map((n) => `ADD32 (${n} + ADD16 exato)`)];
        const kind = cls === 'mul' ? 'mul' : 'add';
        const names = synth.designs.filter((d) => d.cfg.kind === kind && d.cfg.width === W).map((d) => d.name);
        const ex = exactName(cls, W);
        return [ex, ...names.filter((n) => n !== ex)];
    }
    function cell(cls, W) {
        const key = { cmp: 'cmp', mux: 'mux', logic: 'xor' }[cls];
        const c = cells.cells[key][W][cellFlow];
        return { name: `${cls}${W}`, area: c.area, delay: c.delay, energy: c.energy, luts: c.luts, carry4: c.carry4 };
    }
    const reg = cells.register;
    return {
        flow, target, unit, exactUnit, unitByName, candidates, cell,
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
