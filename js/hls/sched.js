/**
 * Escalonamento de um trecho (DFG) com encadeamento de operações num ciclo de relógio.
 *
 *   tempo útil  em cada ciclo cabem operações encadeadas enquanto a soma dos atrasos (da síntese sky130) não passa do
 *               período menos o tempo do registrador (relógio para a saída mais setup, da célula dfxtp_1); uma
 *               operação mais longa que isso é multiciclo: começa no início de um ciclo e ocupa a unidade por
 *               ceil((atraso + tempo do registrador) / período) ciclos;
 *   memória     leitura síncrona: ocupa uma porta do banco no ciclo em que é feita e o dado chega MODEL.memLatency
 *               ciclos depois; escrita ocupa uma porta no ciclo; cada banco tem as portas da memória (2 por padrão);
 *   unidades    sem allocation, cada operação pode ter a sua unidade (a ligação depois compartilha as que não se
 *               sobrepõem); com allocation instances=add|mul limit=n, no máximo n por tipo de unidade (largura e
 *               técnica: uma operação aproximada não usa a unidade exata, nem o contrário);
 *   sem pipeline escalonamento por lista: a operação pronta de maior prioridade (o caminho mais longo até o fim, em
 *               ps) vai para o primeiro ciclo em que as dependências e os recursos permitem;
 *   com pipeline escalonamento modular: os recursos são contados módulo II (tabela de reservas). O II começa no
 *               maior entre o pedido e o mínimo por recursos (acessos por banco / portas, usos / limite); depois do
 *               escalonamento, a recorrência (o valor da iteração anterior, como um acumulador) exige
 *               II >= ciclo em que o novo valor fica pronto - ciclo em que o antigo é lido; se não couber, II sobe.
 */
import { opClass, opWidth, SHARED } from './lib.js';

/** Constantes do modelo, a calibrar contra uma ferramenta de HLS (entrega de validação). */
export const MODEL = {
    memLatency: 1,      // ciclos da leitura da memória até o dado
    loopOverhead: 1,    // ciclos por iteração de um laço sem pipeline (teste e incremento)
    pipelineOverhead: 1, // ciclos de entrada e saída de um laço com pipeline
};

/**
 * @param {object} seg trecho da elaboração (nodes, byId)
 * @param {{lib, clockPs: number, arrays: Map, allocation: object, pipelined: boolean, II: number, model: object}} ctx
 */
export function scheduleSegment(seg, ctx) {
    const { lib, clockPs, model = MODEL } = ctx;
    const overhead = lib.reg.clkToQ + lib.reg.setup;
    const Tc = clockPs - overhead;
    if (Tc <= 0) throw new Error(`período de ${clockPs} ps menor que o tempo do registrador (${overhead} ps)`);
    const rangeOf = (id) => seg.byId.get(id).range;
    const info = new Map();
    for (const n of seg.nodes) {
        const cls = opClass(n);
        const W = opWidth(n, rangeOf);
        let delay = 0, unit = null;
        if (SHARED.has(cls)) {
            const name = ctx.assign?.get(n.id);
            unit = name ? lib.unitByName(name) : lib.exactUnit(cls, W);
            if (name && (unit.cfg.kind !== (cls === 'mul' ? 'mul' : 'add') || unit.cfg.width !== W)) throw new Error(`${n.id}: ${name} não serve para uma operação ${cls} de ${W} bits`);
            delay = unit.delay;
        } else if (['cmp', 'mux', 'logic'].includes(cls)) { unit = lib.cell(cls, W); delay = unit.delay; }
        const k = delay > Tc ? Math.ceil((delay + overhead) / clockPs) : 1;
        // Recurso: o banco de memória, ou o tipo de unidade (exatas e aproximadas da mesma largura não se misturam).
        const key = cls === 'mem' ? n.bank?.key ?? n.array : SHARED.has(cls) ? unit.name : null;
        info.set(n.id, { n, cls, W, delay, k, unit, key, multi: delay > Tc });
    }
    // Prioridade: caminho mais longo (ps) do nó até o fim do trecho.
    const prio = new Map();
    for (let i = seg.nodes.length - 1; i >= 0; i--) {
        const n = seg.nodes[i];
        const me = info.get(n.id);
        const own = me.cls === 'mem' && n.op === 'load' ? model.memLatency * clockPs : me.delay;
        prio.set(n.id, own + Math.max(0, ...n.succs.map((s) => prio.get(s) ?? 0)));
    }
    // Capacidade de cada recurso.
    // Com pipeline e sem allocation, o limite de unidades é o mínimo para o II: ceil(usos / II), como as
    // ferramentas fazem (compartilham o que o II permite).
    let implicitII = null;
    const boost = new Map(); // unidades a mais quando a tabela de reservas fragmenta
    const usesOf = new Map();
    for (const me of info.values()) if (SHARED.has(me.cls)) usesOf.set(me.key, (usesOf.get(me.key) ?? 0) + me.k);
    const capOf = (key, me) => {
        if (me.cls === 'mem') {
            const arr = ctx.arrays.get(me.n.array);
            return arr.ports;
        }
        if (SHARED.has(me.cls)) {
            if (ctx.allocation?.[me.cls]) return ctx.allocation[me.cls];
            if (implicitII) return Math.ceil(usesOf.get(key) / implicitII) + (boost.get(key) ?? 0);
        }
        return Infinity;
    };
    // Mínimo II por recursos.
    const uses = new Map();
    for (const me of info.values()) if (me.key && Number.isFinite(capOf(me.key, me))) uses.set(me.key, (uses.get(me.key) ?? 0) + me.k);
    let resMII = 1, resWhy = null;
    for (const [key, u] of uses) {
        const me = [...info.values()].find((x) => x.key === key);
        const m = Math.ceil(u / capOf(key, me));
        if (m > resMII) { resMII = m; resWhy = { kind: me.cls === 'mem' ? 'mem' : 'unit', key, label: me.n.bank?.label ?? key, uses: u, cap: capOf(key, me) }; }
    }

    const run = (II) => {
        implicitII = ctx.pipelined ? II : null;
        const table = new Map(); // recurso -> Map(ciclo ou ciclo mod II -> usos)
        const slot = (c) => (ctx.pipelined ? c % II : c);
        const free = (key, cap, c, k) => {
            if (!key || !Number.isFinite(cap)) return true;
            const t = table.get(key);
            for (let j = 0; j < k; j++) if ((t?.get(slot(c + j)) ?? 0) >= cap) return false;
            return true;
        };
        const take = (key, cap, c, k) => {
            if (!key || !Number.isFinite(cap)) return;
            if (!table.has(key)) table.set(key, new Map());
            const t = table.get(key);
            for (let j = 0; j < k; j++) t.set(slot(c + j), (t.get(slot(c + j)) ?? 0) + 1);
        };
        const sched = new Map();
        const avail = (id) => {
            const s = sched.get(id), me = info.get(id);
            if (me.n.op === 'load') return [s.cycle + model.memLatency, 0];
            if (me.multi) return [s.cycle + me.k, 0];
            return [s.cycle, s.end];
        };
        const pending = new Set(seg.nodes.map((n) => n.id));
        while (pending.size) {
            let best = null;
            for (const id of pending) {
                const n = info.get(id).n;
                if (n.preds.every((p) => sched.has(p)) && (!best || prio.get(id) > prio.get(best))) best = id;
            }
            const me = info.get(best);
            const n = me.n;
            let c = 0, o = 0;
            for (const p of n.preds) {
                const [pc, po] = avail(p);
                if (pc > c) { c = pc; o = po; } else if (pc === c) o = Math.max(o, po);
            }
            const cap = me.key ? capOf(me.key, me) : Infinity;
            const c0 = c;
            for (let tries = 0; ; tries++) {
                // Com pipeline, testados todos os ciclos do II sem encaixe: falta recurso.
                if (ctx.pipelined && c - c0 > II + me.k) throw Object.assign(new Error('sem encaixe'), { noFit: me.key, cls: me.cls });
                if (tries > 100000) throw new Error('escalonamento não converge');
                let start = o;
                if (me.multi && o > 0) { c++; o = 0; continue; }
                if (!me.multi && me.cls !== 'mem' && o + me.delay > Tc) { c++; o = 0; continue; }
                if (me.cls === 'mem') start = n.op === 'load' ? 0 : o;
                if (!free(me.key, cap, c, me.k)) { c++; o = 0; continue; }
                take(me.key, cap, c, me.k);
                sched.set(best, { cycle: c, start, end: me.multi ? Tc : start + (me.cls === 'mem' ? 0 : me.delay), k: me.k });
                break;
            }
            pending.delete(best);
        }
        return { sched, table };
    };

    let II = ctx.pipelined ? Math.max(ctx.II ?? 1, resMII) : null;
    let why = ctx.pipelined ? (resMII > (ctx.II ?? 1) ? resWhy : { kind: 'target' }) : null;
    // Sem encaixe: uma unidade a mais (sem allocation) ou II maior (com allocation ou memória).
    const runFit = () => {
        for (let guard = 0; guard < 256; guard++) {
            try { return run(II ?? 1); } catch (e) {
                if (!e.noFit) throw e;
                if (e.cls !== 'mem' && !ctx.allocation?.[e.cls]) boost.set(e.noFit, (boost.get(e.noFit) ?? 0) + 1);
                else { II++; why = { kind: 'schedule', key: e.noFit }; }
            }
        }
        throw new Error('escalonamento não converge');
    };
    let out = runFit();
    let recMII = 0, recWhy = null;
    if (ctx.pipelined) {
        for (let guard = 0; guard < 64; guard++) {
            recMII = 0;
            recWhy = null;
            for (const n of seg.nodes) {
                if (n.op !== 'carry' || !n.carryFrom) continue;
                const u = out.sched.get(n.carryFrom), mu = info.get(n.carryFrom);
                const ready = mu.n.op === 'load' ? u.cycle + model.memLatency : mu.multi ? u.cycle + mu.k : u.cycle + 1;
                for (const w of n.succs) {
                    const need = ready - out.sched.get(w).cycle;
                    if (need > recMII) { recMII = need; recWhy = { kind: 'rec', key: n.name, cycles: need }; }
                }
            }
            if (recMII <= II) break;
            II = recMII;
            why = recWhy;
            out = runFit();
        }
    }
    let depth = 0, crit = 0;
    for (const [id, s] of out.sched) {
        const me = info.get(id);
        const last = me.n.op === 'load' ? s.cycle + model.memLatency - 1 : s.cycle + s.k - 1;
        if (me.cls !== 'free') depth = Math.max(depth, last + 1);
        // Período mínimo: o encadeamento mais longo num ciclo mais o registrador; multiciclo, o atraso dividido pelos ciclos.
        if (!me.multi) crit = Math.max(crit, s.end + overhead);
        else crit = Math.max(crit, (me.delay + overhead) / me.k);
    }
    return { info, sched: out.sched, table: out.table, II, why, resMII: ctx.pipelined ? resMII : null, recMII: ctx.pipelined ? recMII : null, depth, Tc, overhead, critPs: Math.round(crit) };
}
