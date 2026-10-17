/**
 * Fluxo de síntese de alto nível do kernel: análise (lang.js), elaboração com as diretivas (elab.js), escalonamento
 * com encadeamento, com ou sem pipeline (sched.js), ligação e custo (cost.js), com as unidades e células da
 * biblioteca sintetizada (lib.js). Roda igual no navegador e no Node (bin/axc.mjs hls).
 */
import { parse } from './lang.js';
import { elaborate } from './elab.js';
import { makeLibrary } from './lib.js';
import { scheduleSegment, MODEL } from './sched.js';
import { bindAndCost } from './cost.js';
import { approxOps } from './approx.js';

export { MODEL };

/**
 * @param {string} src código do kernel
 * @param {{synth: object, cells: object, flow?: string, target?: string, clockNs?: number, ports?: number, model?: object,
 *          assign?: Map<string, string>|object, design?: object}} o assign: unidade aproximada de cada operação (id do
 *          nó -> nome); design: projeto já elaborado do mesmo código, reaproveitado
 */
export function synthesize(src, { synth, cells, flow = 'delay', target = 'asic', clockNs = 5, ports = 2, model = MODEL, assign = null, design: given = null } = {}) {
    const clockPs = Math.round(clockNs * 1000);
    // A elaboração é a parte cara; a exploração passa o projeto já elaborado (o mesmo código e as mesmas portas).
    const design = given ?? elaborate(parse(src), { ports });
    const warnings = [...design.warnings];
    const lib = makeLibrary(synth, cells, { flow, target });
    const arrays = new Map(design.arrays.map((a) => [a.name, a]));
    // Operações que aceitam unidade aproximada e a atribuição pedida (os ids que não existem mais são ignorados).
    const ops = approxOps(design, lib);
    const asg = new Map();
    for (const [id, name] of assign instanceof Map ? assign : Object.entries(assign ?? {})) {
        const op = ops.byId.get(id);
        if (!op) continue;
        if (!op.candidates.includes(name)) { warnings.push({ msg: `${id}: ${name} não serve para ${op.label} (ignorada)`, line: op.node.line }); continue; }
        if (name !== op.candidates[0]) asg.set(id, name);
    }
    const schedOf = new Map();
    for (const seg of design.segments) {
        const L = seg.region.loop;
        const pipelined = L?.mode === 'pipelined';
        schedOf.set(seg, scheduleSegment(seg, { lib, clockPs, arrays, allocation: design.allocation, pipelined, II: L?.II ?? 1, model, assign: asg }));
    }
    // Latência: trechos em sequência; laço sem pipeline repete o corpo; com pipeline, profundidade + (N - 1) II.
    const latency = (region) => region.items.reduce((s, it) => s + (it.k === 'seg' ? schedOf.get(it.seg).depth : loopLatency(it.region)), 0);
    function loopLatency(r) {
        const L = r.loop;
        if (L.mode === 'pipelined') {
            const segs = r.items.filter((it) => it.k === 'seg');
            const sch = schedOf.get(segs[0].seg);
            L.iterLatency = sch.depth;
            L.IIachieved = sch.II;
            L.why = sch.why;
            L.latency = sch.depth + (L.tripHw - 1) * sch.II + model.pipelineOverhead;
        } else {
            L.iterLatency = latency(r) + model.loopOverhead;
            L.latency = L.tripHw * L.iterLatency;
        }
        return L.latency;
    }
    const totalCycles = latency(design.top);
    // Execuções de cada trecho por chamada do kernel.
    const segs = [];
    const walk = (r, mult) => {
        for (const it of r.items) {
            if (it.k === 'seg') segs.push({ seg: it.seg, sch: schedOf.get(it.seg), execs: mult, pipelined: r.loop?.mode === 'pipelined' });
            else walk(it.region, mult * it.region.loop.tripHw);
        }
    };
    walk(design.top, 1);
    const cost = bindAndCost(design, segs, lib, { totalCycles, clockPs, model });
    const critPs = Math.max(0, ...segs.map((s) => s.sch.critPs));
    const inner = design.loops.filter((l) => l.mode === 'pipelined');
    return {
        design, lib, segs, cost, warnings, model, ops, assign: asg,
        totals: {
            cycles: totalCycles, clockPs, timeNs: (totalCycles * clockPs) / 1000, critPs,
            area: cost.area.total, luts: cost.fpga.luts, carry4: cost.fpga.carry4, ff: cost.fpga.ff, energy: cost.energy.total,
            intervalNs: inner.length === 1 ? (inner[0].IIachieved * clockPs) / 1000 : null,
        },
    };
}
