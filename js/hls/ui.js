/**
 * Figuras da página de HLS: diagrama de Gantt do escalonamento (com as operações encadeadas dentro do ciclo) e o DFG
 * em camadas por ciclo. SVG puro, com as cores pelas variáveis do tema.
 */
import { esc } from '../ui/plots.js';
import { opClass } from './lib.js';

const OPSYM = { add: '+', sub: '−', mul: '×', shl: '<<', shr: '>>', and: '&', or: '|', xor: '^', not: '~', cmp: 'cmp', sel: '?:', load: 'ld', store: 'st', trunc: 'tr', carry: 'φ', carryout: '→φ', in: 'in', iv: 'i', out: 'out' };
export const opLabel = (n) => (n.op === 'cmp' ? n.cond : OPSYM[n.op] ?? n.op);

/** Linhas do Gantt: instâncias das unidades compartilhadas, bancos de memória e as células. */
function rowsOf(sch) {
    const rows = new Map();
    const add = (key, label, order) => { if (!rows.has(key)) rows.set(key, { key, label, order, ops: [] }); return rows.get(key); };
    for (const [id, s] of sch.sched) {
        const me = sch.info.get(id);
        if (me.cls === 'free') continue;
        let row;
        if (me.binding) row = add(me.binding, `${me.unit.short ?? me.unit.name} #${+me.binding.split('#').pop() + 1}`, me.cls === 'mul' ? 0 : 1);
        else if (me.cls === 'mem') {
            // Uma linha por porta do banco: a primeira porta livre naquele ciclo.
            let p = 0;
            while ((rows.get(`mem:${me.key}:${p}`)?.ops ?? []).some((o) => o.s.cycle === s.cycle)) p++;
            row = add(`mem:${me.key}:${p}`, `${me.n.bank?.label ?? me.n.array} p${p + 1}`, 2);
        }
        else row = add(`${me.cls}:${id}`, `${me.cls}${me.W}`, 3);
        row.ops.push({ id, s, me });
    }
    return [...rows.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/**
 * Diagrama de Gantt de um trecho.
 * @param {object} sch resultado do escalonamento
 * @param {{clockPs: number, pipelined: boolean, title?: string}} o
 */
export function ganttSvg(sch, { clockPs, pipelined }) {
    const rows = rowsOf(sch);
    const cycles = Math.max(1, sch.depth);
    const CW = Math.max(46, Math.min(110, 900 / cycles)), RH = 22, L = 120, T = 26, B = 30;
    const W = L + cycles * CW + 20, H = T + rows.length * RH + B;
    const X = (c, ps) => L + c * CW + (ps / clockPs) * CW;
    let s = `<svg class="fig-svg hls-gantt" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    for (let c = 0; c <= cycles; c++) {
        s += `<line class="grid" x1="${L + c * CW}" y1="${T - 6}" x2="${L + c * CW}" y2="${T + rows.length * RH}"/>`;
        if (c < cycles) s += `<text class="small muted mono" x="${L + c * CW + CW / 2}" y="${T - 10}" text-anchor="middle">${c}</text>`;
    }
    // Tempo útil do ciclo (período menos o registrador) e as fronteiras do II.
    for (let c = 0; c < cycles; c++) s += `<rect class="slack" x="${X(c, sch.Tc)}" y="${T - 4}" width="${(sch.overhead / clockPs) * CW}" height="${rows.length * RH + 4}"/>`;
    if (pipelined && sch.II) for (let c = sch.II; c < cycles; c += sch.II) s += `<line class="ii" x1="${L + c * CW}" y1="${T - 6}" x2="${L + c * CW}" y2="${T + rows.length * RH}"/>`;
    rows.forEach((r, k) => {
        const y = T + k * RH;
        s += `<text class="small mono" x="${L - 6}" y="${y + 15}" text-anchor="end">${esc(r.label)}</text>`;
        for (const { id, s: sc, me } of r.ops) {
            const n = me.n;
            let x0, x1;
            if (me.multi) { x0 = X(sc.cycle, 0); x1 = X(sc.cycle + me.k - 1, sch.Tc); } else if (me.cls === 'mem') { x0 = X(sc.cycle, sc.start); x1 = x0 + Math.max(10, CW * 0.35); } else { x0 = X(sc.cycle, sc.start); x1 = X(sc.cycle, sc.end); }
            const w = Math.max(6, x1 - x0);
            s += `<g><rect class="op h-${opClass(n)}" x="${x0}" y="${y + 3}" width="${w}" height="${RH - 6}" rx="3"><title>${esc(`${id}: ${n.op}${n.text ? ` ${n.text}` : ''} [${n.range.join(', ')}]  ciclo ${sc.cycle}${me.multi ? `..${sc.cycle + me.k - 1}` : `, ${(sc.start / 1000).toFixed(2)} a ${(sc.end / 1000).toFixed(2)} ns`}${me.delay ? `, ${me.delay} ps` : ''}`)}</title></rect>`;
            if (w > 16) s += `<text class="small mono op-t" x="${x0 + w / 2}" y="${y + 15}" text-anchor="middle">${esc(opLabel(n))}</text>`;
            s += '</g>';
        }
    });
    s += `<text class="small muted" x="${L}" y="${H - 8}">${pipelined && sch.II ? `II = ${sch.II}` : ''}</text>`;
    return `${s}</svg>`;
}

/** DFG em camadas: linha = ciclo de início, coluna = ordem; arestas de dados e a de recorrência (tracejada). */
export function dfgSvg(seg, sch) {
    const nodes = seg.nodes.filter((n) => !['carryout'].includes(n.op));
    const byCycle = new Map();
    for (const n of nodes) {
        const c = sch.sched.get(n.id)?.cycle ?? 0;
        if (!byCycle.has(c)) byCycle.set(c, []);
        byCycle.get(c).push(n);
    }
    const levels = [...byCycle.keys()].sort((a, b) => a - b);
    // Dentro do ciclo, ordem pelo tempo de início (encadeamento) e depois pela posição no trecho.
    const NW = 64, NH = 26, GX = 14, GY = 46, L = 50, T = 20;
    const pos = new Map();
    let maxCols = 1;
    const sub = new Map();
    for (const c of levels) {
        const list = byCycle.get(c).sort((a, b) => (sch.sched.get(a.id).start - sch.sched.get(b.id).start) || 0);
        // Sub-linhas para as operações encadeadas: a profundidade dentro do ciclo.
        const depthIn = new Map();
        for (const n of list) {
            const d = Math.max(0, ...n.preds.filter((p) => depthIn.has(p)).map((p) => depthIn.get(p) + 1));
            depthIn.set(n.id, d);
        }
        const rowsIn = Math.max(...depthIn.values()) + 1;
        sub.set(c, rowsIn);
        const perRow = new Map();
        for (const n of list) {
            const d = depthIn.get(n.id);
            const k = perRow.get(d) ?? 0;
            perRow.set(d, k + 1);
            pos.set(n.id, { c, d, k });
            maxCols = Math.max(maxCols, k + 1);
        }
    }
    let y = T;
    const yOf = new Map();
    for (const c of levels) { yOf.set(c, y); y += sub.get(c) * (NH + 12) + GY - 12; }
    const W = L + maxCols * (NW + GX) + 20, H = y + 10;
    const P = (id) => { const p = pos.get(id); return { x: L + p.k * (NW + GX), y: yOf.get(p.c) + p.d * (NH + 12) }; };
    let s = `<svg class="fig-svg hls-dfg" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><marker id="dfgA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker></defs>`;
    for (const c of levels) s += `<text class="small muted mono" x="6" y="${yOf.get(c) + 17}">c${c}</text>`;
    for (const n of nodes) {
        for (const p of n.preds) {
            if (!pos.has(p)) continue;
            const a = P(p), b = P(n.id);
            s += `<line class="edge" x1="${a.x + NW / 2}" y1="${a.y + NH}" x2="${b.x + NW / 2}" y2="${b.y}" marker-end="url(#dfgA)"/>`;
        }
        if (n.op === 'carry' && n.carryFrom && pos.has(n.carryFrom)) {
            const a = P(n.carryFrom), b = P(n.id);
            s += `<path class="edge rec" d="M${a.x + NW},${a.y + NH / 2} C${W - 10},${a.y} ${W - 10},${b.y} ${b.x + NW},${b.y + NH / 2}" marker-end="url(#dfgA)"/>`;
        }
    }
    for (const n of nodes) {
        const p = P(n.id);
        const me = sch.info.get(n.id);
        const label = n.op === 'load' || n.op === 'store' ? `${opLabel(n)} ${n.array}` : n.op === 'carry' ? `φ ${n.name}` : opLabel(n);
        s += `<g><rect class="node h-${opClass(n)}" x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="4"><title>${esc(`${n.id}: ${n.op}${n.text ? ` ${n.text}` : ''} [${n.range.join(', ')}]${me?.unit ? ` · ${me.unit.name}` : ''}`)}</title></rect>`
            + `<text class="small mono" x="${p.x + NW / 2}" y="${p.y + 12}" text-anchor="middle">${esc(label.slice(0, 10))}</text>`
            + `<text class="tiny mono muted" x="${p.x + NW / 2}" y="${p.y + 22}" text-anchor="middle">${me?.W ? `${me.W}b` : ''}</text></g>`;
    }
    return `${s}</svg>`;
}
