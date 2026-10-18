/**
 * Ligação e custo de um projeto escalonado.
 *
 *   unidades     somadores e multiplicadores são compartilhados: sem pipeline, operações cujos ciclos não se
 *                sobrepõem usam a mesma unidade (algoritmo de left edge); com pipeline, a quantidade é o maior número
 *                de usos num mesmo ciclo da tabela de reservas. Trechos diferentes rodam em momentos diferentes e
 *                reaproveitam as mesmas unidades. Comparadores, seleções e lógica não são compartilhados (são baratos
 *                e o multiplexador custaria mais que eles);
 *   multiplexador cada entrada de uma unidade compartilhada recebe tantas fontes quantos operandos diferentes as
 *                operações ligadas a ela têm: n fontes custam n - 1 multiplexadores de 2 entradas por bit;
 *   registradores um valor usado num ciclo depois daquele em que é produzido precisa de registrador. Sem pipeline,
 *                os registradores são compartilhados por valores de vidas disjuntas (left edge); com pipeline, cada
 *                fronteira de estágio que o valor atravessa é um registrador (não há compartilhamento). A recorrência
 *                (acumulador) e os valores que passam de um trecho para outro também ocupam registradores. A largura é
 *                a da faixa do valor;
 *   controle     cada laço mantido tem um contador (registrador, incremento e comparação, contados como dois
 *                comparadores da largura do contador);
 *   energia      por execução do kernel: cada operação executada gasta a energia por operação da sua unidade ou
 *                célula (entradas uniformes); cada bit de registrador gasta a energia de um ciclo do dfxtp_1 em todos os
 *                ciclos do kernel (sem desligamento do relógio); mais a fuga das unidades durante o tempo do kernel.
 *                Memórias, a árvore de relógio e os multiplexadores de entrada não entram na energia.
 */
import { bitsFor, magBits } from './elab.js';
import { SHARED, WIDTHS } from './lib.js';

const leftEdge = (intervals) => {
    // intervals: [{s, e, ...}] -> atribui .slot (menor número de recursos para intervalos fechados disjuntos).
    const ends = [];
    for (const iv of [...intervals].sort((a, b) => a.s - b.s)) {
        let k = ends.findIndex((e) => e < iv.s);
        if (k < 0) { k = ends.length; ends.push(iv.e); } else ends[k] = iv.e;
        iv.slot = k;
    }
    return ends.length;
};

/**
 * @param {object} design elaboração
 * @param {Array<{seg, sch, execs: number, pipelined: boolean}>} segs trechos escalonados
 */
/** Bits conhecidos de um operando na entrada da unidade: a constante inteira, ou os bits altos que a faixa diz zero. */
function knownBits(a, seg, n, unit) {
    const W = unit.cfg?.width ?? unit.W ?? 16;
    const full = W >= 32 ? 0xFFFFFFFF : (1 << W) - 1;
    const isMul = n.op === 'mul';
    if (a.c !== undefined) {
        const v = isMul ? Math.abs(a.c) : a.c;
        return v >= 0 && v <= full ? { mask: full, value: v } : { mask: 0, value: 0 };
    }
    const r = seg.byId.get(a.n).range;
    if (!isMul && r[0] < 0) return { mask: 0, value: 0 };
    const b = isMul ? magBits(r) : bitsFor(r);
    if (b >= W) return { mask: 0, value: 0 };
    return { mask: (full & ~((1 << b) - 1)) >>> 0, value: 0 };
}
/** Bits conhecidos comuns a todas as operações ligadas a uma instância (mesmo valor em todas). */
function meet(x, y) {
    if (!x) return y;
    const mask = (x.mask & y.mask & ~(x.value ^ y.value)) >>> 0;
    return { mask, value: (x.value & mask) >>> 0 };
}

export function bindAndCost(design, segs, lib, { totalCycles, clockPs, model, addr = null }) {
    // Unidades compartilhadas: instâncias por chave (classe e largura) em cada trecho.
    const units = new Map(); // chave -> { unit, count, sources: Array<[Set, Set]> }
    const opsCells = []; // operações com célula própria
    let regBits = 0, srlFf = 0, srlLuts = 0;
    const regs = [];
    let energyOps = 0;
    for (const { seg, sch, execs, pipelined } of segs) {
        const byKey = new Map();
        for (const [id, s] of sch.sched) {
            const me = sch.info.get(id);
            const opKnown = SHARED.has(me.cls) ? me.n.args.map((a) => knownBits(a, seg, me.n, me.unit)) : null;
            if (me.noShare) {
                // Uma unidade por operação (somador exato, multiplicação por constante), com os bits conhecidos dela.
                const k = `${me.unit.name}·op`;
                if (!units.has(k)) units.set(k, { key: k, cls: me.cls, W: me.W, unit: me.unit, count: 0, sources: [], perOp: true, known: [] });
                const u = units.get(k);
                u.count++;
                u.known.push(opKnown);
                me.binding = `${k}#${u.count - 1}`;
            } else if (SHARED.has(me.cls)) {
                if (!byKey.has(me.key)) byKey.set(me.key, []);
                byKey.get(me.key).push({ id, s: s.cycle, e: s.cycle + me.k - 1, me, slots: Array.from({ length: me.k }, (_, j) => (pipelined ? (s.cycle + j) % sch.II : s.cycle + j)) });
            } else if (['cmp', 'mux', 'logic'].includes(me.cls)) opsCells.push({ me, execs });
            if (me.unit) energyOps += (opKnown ? lib.effective(me.unit, { a: opKnown[0], b: opKnown[1] }) : me.unit).energy * execs;
        }
        for (const [key, list] of byKey) {
            let count;
            if (pipelined) {
                // Atribuição por ciclo da tabela de reservas.
                const used = new Map();
                for (const op of list) {
                    let k = 0;
                    while (op.slots.some((sl) => used.get(sl)?.has(k))) k++;
                    for (const sl of op.slots) { if (!used.has(sl)) used.set(sl, new Set()); used.get(sl).add(k); }
                    op.slot = k;
                }
                count = 1 + Math.max(...list.map((o) => o.slot));
            } else count = leftEdge(list);
            const me0 = list[0].me;
            if (!units.has(key)) units.set(key, { key, cls: me0.cls, W: me0.W, unit: me0.unit, count: 0, sources: [], known: [] });
            const u = units.get(key);
            u.count = Math.max(u.count, count);
            for (const op of list) {
                while (u.sources.length <= op.slot) u.sources.push([new Set(), new Set()]);
                const n = op.me.n;
                const src = n.args.map((a) => (a.n !== undefined ? `${seg.id}:${a.n}` : `c${a.c}`));
                // Operação comutativa: o operando vai para a entrada que já tem essa fonte, se houver.
                const [A, B] = u.sources[op.slot];
                let kn = n.args.map((a) => knownBits(a, seg, n, u.unit));
                if (['add', 'mul'].includes(n.op) && (A.has(src[1]) || B.has(src[0]))) { src.reverse(); kn = kn.reverse(); }
                A.add(src[0]);
                B.add(src[1]);
                while (u.known.length <= op.slot) u.known.push(null);
                u.known[op.slot] = u.known[op.slot] ? [meet(u.known[op.slot][0], kn[0]), meet(u.known[op.slot][1], kn[1])] : kn;
            }
            for (const op of list) op.me.binding = `${key}#${op.slot}`;
        }
        // Registradores do trecho.
        const vals = [];
        for (const n of seg.nodes) {
            const s = sch.sched.get(n.id), me = sch.info.get(n.id);
            if (n.op === 'store' || n.op === 'carryout' || n.op === 'out') continue;
            const ready = n.op === 'load' ? s.cycle + model.memLatency : me.multi ? s.cycle + me.k : s.cycle;
            let last = -1;
            for (const w of n.succs) last = Math.max(last, sch.sched.get(w).cycle);
            if (n.liveOut) last = Math.max(last, sch.depth);
            const bits = bitsFor(n.range);
            // Recorrência só repassada a um laço interno (o acumulador continua no registrador do interno).
            if (n.op === 'carry' && !n.succs.length) continue;
            if (n.op === 'carry') { regs.push({ seg: seg.id, name: n.name, bits, kind: 'recorrência' }); regBits += bits; continue; }
            if (n.op === 'iv' || n.op === 'in') continue;
            const regStart = n.op === 'load' ? ready : me.multi ? ready : s.cycle + 1;
            if (last < regStart) continue;
            if (pipelined) {
                const stages = last - regStart + 1;
                regBits += stages * bits;
                // No FPGA, uma cadeia de 3 ou mais estágios vira SRL (uma LUT por bit a cada 32 estágios e o
                // registrador de saída), como o Vivado faz com os atrasos sem reset.
                if (stages >= 3) { srlFf += bits * (stages - 1); srlLuts += bits * Math.ceil((stages - 1) / 32); }
                regs.push({ seg: seg.id, name: n.name ?? n.id, bits, stages, kind: 'pipeline' });
            } else vals.push({ s: regStart, e: last, bits, id: n.id });
        }
        if (!pipelined && vals.length) {
            leftEdge(vals);
            const slots = new Map();
            for (const v of vals) slots.set(v.slot, Math.max(slots.get(v.slot) ?? 0, v.bits));
            for (const b of slots.values()) { regBits += b; regs.push({ seg: seg.id, bits: b, kind: 'compartilhado' }); }
        }
    }
    // Multiplexadores de entrada das unidades compartilhadas.
    const muxes = [];
    for (const u of units.values()) {
        for (let k = 0; k < u.count; k++) {
            const srcs = u.sources[k] ?? [new Set(), new Set()];
            for (const side of [0, 1]) {
                const n = srcs[side].size;
                if (n > 1) muxes.push({ key: u.key, inst: k, side, inputs: n, W: u.W, ...lib.mux(n, u.W) });
            }
        }
    }
    // Controle dos laços mantidos.
    const control = [];
    for (const l of design.loops) {
        if (l.mode !== 'sequential' && l.mode !== 'pipelined') continue;
        const bits = bitsFor([0, l.tripHw]);
        const W = WIDTHS.find((x) => x >= bits) ?? 32;
        const c = lib.cell('cmp', W);
        control.push({ loop: l.label ?? l.id, bits, area: 2 * c.area, luts: 2 * c.luts, carry4: 2 * c.carry4, energy: 2 * c.energy });
        regBits += bits;
        regs.push({ name: `contador de ${l.label ?? l.id}`, bits, kind: 'controle' });
    }
    // Totais.
    const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
    // Custo de cada instância com os bits conhecidos das operações ligadas a ela (propagação de constantes).
    const unitList = [...units.values()].map((u) => {
        const insts = Array.from({ length: u.count }, (_, k) => {
            const kn = u.known?.[k];
            return kn ? lib.effective(u.unit, { a: kn[0], b: kn[1] }) : u.unit;
        });
        const tot = (f) => insts.reduce((x, i) => x + (i[f] ?? 0), 0);
        return { ...u, sources: undefined, known: undefined, area: tot('area'), luts: Math.round(tot('luts')), carry4: Math.round(tot('carry4')), leakage: tot('leakage'), fullLuts: u.count * u.unit.luts };
    });
    const cellGroups = new Map();
    for (const { me } of opsCells) {
        const k = `${me.cls}${me.W}`;
        if (!cellGroups.has(k)) cellGroups.set(k, { key: k, cls: me.cls, W: me.W, count: 0, cell: me.unit });
        cellGroups.get(k).count++;
    }
    const cellList = [...cellGroups.values()].map((g) => ({ ...g, area: g.count * g.cell.area, luts: g.count * g.cell.luts, carry4: g.count * g.cell.carry4 }));
    const timeNs = (totalCycles * clockPs) / 1000;
    const energy = {
        ops: energyOps,
        registers: regBits * lib.reg.energy * totalCycles,
        control: sum(control, (c) => c.energy) * totalCycles,
        // nW × ns = 1e-18 J = 1e-3 fJ
        leakage: (sum(unitList, (u) => u.leakage) + regBits * lib.reg.leakage) * timeNs * 1e-3,
    };
    energy.total = energy.ops + energy.registers + energy.control + energy.leakage;
    const area = {
        units: sum(unitList, (u) => u.area), cells: sum(cellList, (c) => c.area), mux: sum(muxes, (m) => m.area),
        registers: regBits * lib.reg.area, control: sum(control, (c) => c.area),
    };
    area.total = area.units + area.cells + area.mux + area.registers + area.control;
    const fpga = {
        luts: sum(unitList, (u) => u.luts) + sum(cellList, (c) => c.luts) + sum(muxes, (m) => m.luts) + sum(control, (c) => c.luts) + (addr?.luts ?? 0) + srlLuts,
        carry4: sum(unitList, (u) => u.carry4) + sum(cellList, (c) => c.carry4) + sum(control, (c) => c.carry4),
        ff: regBits - srlFf + (addr?.ff ?? 0),
        srlLuts,
        addrLuts: addr?.luts ?? 0,
    };
    return { units: unitList, cells: cellList, muxes, regs, regBits, control, area, fpga, energy, addr };
}
