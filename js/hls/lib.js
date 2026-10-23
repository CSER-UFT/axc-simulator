/**
 * Biblioteca de custos do modelo de HLS: as unidades aritméticas sintetizadas (data/synth.json) e as peças medidas
 * com o mesmo fluxo (data/hls-cells.json: multiplexador, lógica, comparador, registrador).
 *
 *   classes    add (soma, subtração e negação), mul, cmp, mux (seleção), logic (and, or, xor, not); deslocamentos por
 *              constante, truncamentos e a variável do laço são só fios (custo zero);
 *   larguras   8, 16 ou 32 bits, a menor que cabe nos operandos (a faixa de valores de cada operação). O somador de
 *              32 bits é feito com dois de 16 em cascata (o vai um passa de um para o outro); multiplicação acima de
 *              16 bits não tem unidade na biblioteca;
 *   redes      com a opção wide (só no fluxo das redes neurais, js/axc/nngen.js): somas de 8, 16, 24 ou 32 bits com os
 *              somadores reais da biblioteca, inclusive os de 24 e 32 bits, e somadores em cascata de qualquer largura
 *              (a parte de baixo aproximada, a de cima exata); a reescala (requant) é uma peça exata medida à parte;
 *   alvos      ASIC sky130 (área em µm², atraso em ps, energia em fJ por operação), no fluxo de síntese escolhido
 *              (atraso mínimo, área mínima ou iso atraso), ou FPGA (LUTs e CARRY4; o atraso continua o do sky130,
 *              porque a biblioteca não tem atraso de FPGA).
 */
import { HlsError } from './lang.js';
import { bitsFor, magBits } from './elab.js';
import { buildUnit } from '../axc/units.js';
import { liveFraction } from './constprop.js';

export const WIDTHS = [8, 16, 32];
/** Netlists das unidades, construídas uma vez (a propagação de constantes as usa a cada síntese). */
const NETS = new Map();
const FREE = new Set(['shl', 'shr', 'trunc', 'iv', 'in', 'carry', 'carryout', 'out', 'const']);
export const MEM = new Set(['load', 'store']);
const CLASS = { add: 'add', sub: 'add', mul: 'mul', cmp: 'cmp', sel: 'mux', and: 'logic', or: 'logic', xor: 'logic', not: 'logic', rq: 'requant' };
/** Larguras das somas com a opção wide (redes neurais). */
export const WIDE_ADD = [8, 16, 24, 32];
export const SHARED = new Set(['add', 'mul']);

/** Dígitos não nulos da constante: o menor entre a forma binária e a CSD (dígitos -1, 0, 1 sem dois vizinhos). */
export function digits(c) {
    let bin = 0, csd = 0;
    for (let x = c; x > 0; x = Math.floor(x / 2)) bin += x % 2;
    for (let x = c; x !== 0;) {
        if (x % 2 !== 0) { const r = 2 - (((x % 4) + 4) % 4); x -= r; csd++; }
        x /= 2;
    }
    return Math.min(bin, csd);
}

export const opClass = (n) => (FREE.has(n.op) ? 'free' : MEM.has(n.op) ? 'mem' : CLASS[n.op]);

/** Largura (8, 16 ou 32) da operação, a partir das faixas dos operandos e do resultado (addWidths: as das somas). */
export function opWidth(n, rangeOf, addWidths = WIDTHS) {
    if (opClass(n) === 'requant') return 32;
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
    const W = (opClass(n) === 'add' ? addWidths : WIDTHS).find((x) => x >= w);
    if (!W) throw new HlsError(`operação de ${w} bits: a biblioteca vai até 32 bits`, n.line);
    if (opClass(n) === 'mul' && W > 16) throw new HlsError(`multiplicação de ${w} bits: a biblioteca só tem multiplicadores de 8 e 16 bits (reduza o tipo dos operandos)`, n.line);
    return W;
}

/**
 * @param {object} synth data/synth.json
 * @param {object} cells data/hls-cells.json
 * @param {{flow?: 'delay'|'area'|'iso', target?: 'asic'|'fpga'}} o
 */
export function makeLibrary(synth, cells, { flow = 'delay', target = 'asic', fpga = null, wide = false } = {}) {
    const addWidths = wide ? WIDE_ADD : WIDTHS;
    const byName = new Map(synth.designs.map((d) => [d.name, d]));
    const cellFlow = flow === 'delay' ? 'delay' : 'area';
    // Alvo FPGA com a caracterização do Vivado (data/vivado-units.json): LUT, CARRY4 e atraso do Vivado. As unidades
    // exatas usam a operação nativa (a + b, a * b), como o Vitis escreve; o resto continua do Yosys e do sky130.
    // LUT e CARRY4 do Vivado em qualquer alvo (são números de FPGA); o atraso do Vivado só no alvo FPGA.
    const viv = fpga ? fpga.units : null;
    const fpgaDelay = target === 'fpga' && !!viv;
    // O atraso medido é de registrador a registrador (inclui o relógio para a saída e o fio do registrador de
    // entrada); o da unidade é esse menos o do caminho direto entre dois registradores (peça "reg").
    const regPs = viv?.reg?.delayPs ?? 0;
    const vDelay = (v) => (fpgaDelay && v?.delayPs ? Math.max(0, v.delayPs - regPs) : null);
    const vivOf = (name) => {
        if (!viv) return null;
        const m = /^(ADD|MUL)(\d+) exato$/.exec(name);
        return viv[m ? `${m[1]}${m[2]} nativo` : name] ?? null;
    };
    /** Custo de uma unidade sintetizada pelo nome (MUL8 exato, ADD16 LOA8, ...). */
    function unit(name) {
        const d = byName.get(name);
        if (!d) throw new HlsError(`unidade ${name} não está na biblioteca sintetizada`);
        let f = d.asic.flows[flow] ?? d.asic.flows.delay;
        const v = vivOf(name);
        let luts = v?.luts ?? d.luts, carry4 = v?.carry4 ?? d.carry4;
        // Somador truncado em k bits: os k bits baixos são fios (zero), o resto é um somador exato de W - k bits. O
        // custo é o do exato da mesma largura e fluxo na proporção (W - k) / W, e nunca mais que o sintetizado: no
        // fluxo de atraso mínimo, o ABC dimensiona as células pelo atraso e o truncado em 1 a 3 bits saía com mais
        // área que o exato (880 contra 731 µm² no ADD16 TRUNC1), o que não tem sentido estrutural.
        if (d.cfg.kind === 'add' && d.cfg.adder === 'trunc' && d.cfg.k > 0) {
            const W = d.cfg.width, k = Math.min(d.cfg.k, W), r = (W - k) / W;
            const ex = byName.get(exactName('add', W));
            const fe = ex.asic.flows[flow] ?? ex.asic.flows.delay;
            f = { ...f, area: Math.min(f.area, fe.area * r), energy: Math.min(f.energy, fe.energy * r), leakage: Math.min(f.leakage ?? Infinity, (fe.leakage ?? 0) * r), delay: Math.min(f.delay, fe.delay) };
            const ve = vivOf(exactName('add', W));
            luts = Math.min(luts, Math.ceil((ve?.luts ?? ex.luts) * r));
            carry4 = Math.min(carry4, Math.ceil((W - k) / 4));
        }
        return { name, short: name.replace(/ \(.*\)/, ''), cfg: d.cfg, area: f.area, delay: vDelay(v) ?? f.delay, energy: f.energy, leakage: f.leakage, luts, carry4, err: d.err, vivado: !!v };
    }
    const exactName = (cls, W) => `${cls === 'mul' ? 'MUL' : 'ADD'}${W} exato`;
    /**
     * Somador em cascata: a parte de baixo (pode ser aproximada) e a de cima exata, com o vai um passando de uma para a
     * outra. Sem a opção wide, o de 32 bits é sempre a cascata de dois de 16.
     */
    function composite(lowName, hiW = 16) {
        const lo = unit(lowName), hiName = exactName('add', hiW), hi = unit(hiName);
        const W = lo.cfg.width + hiW;
        const exact = lowName === 'ADD16 exato' && hiW === 16;
        return {
            name: exact ? 'ADD32 (2 × ADD16 exato)' : `ADD${W} (${lowName} + ${hiName})`, short: exact ? 'ADD32' : `ADD${W} (${lowName.replace(/^ADD\d+ /, '')})`,
            cfg: { kind: 'add', width: W, low: lo.cfg }, low: lowName, high: hiName,
            area: lo.area + hi.area, delay: lo.delay + hi.delay, energy: lo.energy + hi.energy, leakage: (lo.leakage ?? 0) + (hi.leakage ?? 0),
            luts: lo.luts + hi.luts, carry4: lo.carry4 + hi.carry4, err: lo.err, composite: 2,
        };
    }
    /** Unidade de uma classe e largura; sem a opção wide, o somador de 32 bits é a cascata de dois de 16. */
    function exactUnit(cls, W) {
        if (cls === 'add' && W === 32 && !wide) return composite('ADD16 exato');
        return unit(exactName(cls, W));
    }
    /** Unidade pelo nome, inclusive os somadores em cascata (ADD32 (ADD16 LOA8 + ADD16 exato), ADD24 (ADD16 LOA8 + ADD8 exato)). */
    function unitByName(name) {
        if (name === 'ADD32 (2 × ADD16 exato)') return composite('ADD16 exato');
        const m = /^ADD(\d+) \((ADD\d+ .+) \+ ADD(\d+) exato\)$/.exec(name);
        return m ? composite(m[2], +m[3]) : unit(name);
    }
    /**
     * Somador para uma soma de W bits a partir de um somador das redes (ADDN técnica): com N >= W, a mesma técnica na
     * largura W (o k e a previsão limitados a W; com blocos de W bits ou mais, o exato); com N < W, a cascata dele com
     * um exato de W - N bits. É a mesma conta do avaliador das redes (a unidade nos N bits de baixo, a parte de cima
     * exata) nas somas que cabem em N bits; nas mais estreitas, a técnica fica com a largura da soma.
     */
    function adderFor(name, W) {
        const d = byName.get(name);
        if (!d || d.cfg.kind !== 'add') throw new HlsError(`${name} não é um somador da biblioteca`);
        const N = d.cfg.width;
        if (N === W) return name;
        if (N < W) return composite(name, W - N).name;
        const c = { ...d.cfg, width: W };
        if (c.k !== undefined) c.k = Math.min(c.k, W);
        if (c.P !== undefined) c.P = Math.min(c.P, W);
        if (c.adder === 'seg' && c.L >= W) return exactName('add', W);
        const hit = synth.designs.find((x) => x.cfg.kind === 'add' && x.cfg.width === W && JSON.stringify({ ...x.cfg }) === JSON.stringify(c));
        return hit ? hit.name : exactName('add', W);
    }
    /** Unidades da biblioteca para uma classe e largura (a exata primeiro). */
    function candidates(cls, W) {
        if (cls === 'add' && W === 32 && !wide) return [exactUnit('add', 32).name, ...candidates('add', 16).slice(1).map((n) => `ADD32 (${n} + ADD16 exato)`)];
        const kind = cls === 'mul' ? 'mul' : 'add';
        const names = synth.designs.filter((d) => d.cfg.kind === kind && d.cfg.width === W).map((d) => d.name);
        const ex = exactName(cls, W);
        return [ex, ...names.filter((n) => n !== ex)];
    }
    function cell(cls, W) {
        const key = { cmp: 'cmp', mux: 'mux', logic: 'xor', requant: 'requant' }[cls];
        if (cls === 'requant' && !cells.cells.requant) throw new HlsError('requant: a peça não está em data/hls-cells.json (node scripts/hls-cells.mjs --only requant)');
        const c = cells.cells[key][cls === 'requant' ? 32 : W][cellFlow];
        const v = viv?.[`${cls}${W}`];
        return { name: `${cls}${W}`, area: c.area, delay: vDelay(v) ?? c.delay, energy: c.energy, luts: v?.luts ?? c.luts, carry4: v?.carry4 ?? c.carry4, dsp: c.dsp ?? 0 };
    }
    /**
     * Multiplicação exata por constante: somas de deslocamentos, com a representação de menos dígitos (binária ou
     * CSD). Cada dígito além do primeiro é um somador da largura do operando mais um bit; no FPGA isso dá
     * (d − 1)(w + 1) LUTs (o Vivado faz x·19 e x·52, w = 8, com 18 e 19 LUTs). Atraso: ceil(log2 d) somadores.
     */
    function constMul(c, w) {
        const d = digits(Math.abs(c));
        const adders = Math.max(0, d - 1);
        const add = unit(`ADD${w + 1 <= 8 ? 8 : 16} exato`);
        const scale = (w + 1) / (w + 1 <= 8 ? 8 : 16);
        return {
            name: `×${c} (${adders} soma${adders === 1 ? '' : 's'})`, short: `×${c}`, constMul: c, adders,
            area: adders * add.area * scale, delay: Math.ceil(Math.log2(Math.max(1, d))) * add.delay, energy: adders * add.energy * scale,
            leakage: adders * (add.leakage ?? 0) * scale, luts: adders * (w + 1), carry4: adders * Math.ceil((w + 1) / 4),
        };
    }
    const netOf = (name) => { if (!NETS.has(name)) NETS.set(name, buildUnit(byName.get(name).cfg).net); return NETS.get(name); };
    const NONE = { mask: 0, value: 0 };
    const scaled = (u, f) => ({ luts: u.luts * f.gates, carry4: u.carry4 * f.chain, area: u.area * f.gates, energy: u.energy * f.gates, leakage: (u.leakage ?? 0) * f.gates });
    /**
     * Custo de uma instância com bits de entrada conhecidos (constantes, bits altos zero): a parte da netlist que
     * sobra depois da propagação de constantes. known = {a, b}, cada um {mask, value} na largura da unidade.
     */
    function effective(u, known = { a: NONE, b: NONE }) {
        if (u.constMul) return u;
        if (u.composite) {
            const hiName = u.high ?? 'ADD16 exato';
            const lo = unit(u.low), hi = unit(hiName), lw = lo.cfg.width, hw = hi.cfg.width;
            const bits = (w) => (w >= 32 ? 0xFFFFFFFF : 2 ** w - 1);
            const part = (k, sh, w) => ({ mask: Math.floor((k.mask >>> 0) / 2 ** sh) & bits(w), value: Math.floor((k.value >>> 0) / 2 ** sh) & bits(w) });
            const a = scaled(lo, liveFraction(u.low, netOf(u.low), { a: part(known.a, 0, lw), b: part(known.b, 0, lw) }));
            const b = scaled(hi, liveFraction(hiName, netOf(hiName), { a: part(known.a, lw, hw), b: part(known.b, lw, hw) }));
            return { ...u, luts: a.luts + b.luts, carry4: a.carry4 + b.carry4, area: a.area + b.area, energy: a.energy + b.energy, leakage: a.leakage + b.leakage };
        }
        if (!byName.has(u.name) || (!known.a.mask && !known.b.mask)) return u;
        return { ...u, ...scaled(u, liveFraction(u.name, netOf(u.name), known)) };
    }
    // Registrador: no Vivado, o caminho direto entre dois registradores (relógio para a saída e fio; o setup fica de fora).
    const reg = fpgaDelay && viv.reg?.delayPs ? { ...cells.register, clkToQ: viv.reg.delayPs, setup: 0 } : cells.register;
    return {
        flow, target, unit, exactUnit, unitByName, candidates, cell, constMul, effective, adderFor, wide, vivado: !!viv,
        /** Largura de uma operação nesta biblioteca (com a opção wide, as somas de 24 bits têm unidade própria). */
        opWidth: (n, rangeOf) => opWidth(n, rangeOf, addWidths),
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
