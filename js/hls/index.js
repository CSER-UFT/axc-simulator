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

export { MODEL };

/**
 * @param {string} src código do kernel
 * @param {{synth: object, cells: object, flow?: string, target?: string, clockNs?: number, ports?: number, model?: object}} o
 */
export function synthesize(src, { synth, cells, flow = 'delay', target = 'asic', clockNs = 5, ports = 2, model = MODEL } = {}) {
    const clockPs = Math.round(clockNs * 1000);
    const ast = parse(src);
    const design = elaborate(ast, { ports });
    const lib = makeLibrary(synth, cells, { flow, target });
    const arrays = new Map(design.arrays.map((a) => [a.name, a]));
    const schedOf = new Map();
    for (const seg of design.segments) {
        const L = seg.region.loop;
        const pipelined = L?.mode === 'pipelined';
        schedOf.set(seg, scheduleSegment(seg, { lib, clockPs, arrays, allocation: design.allocation, pipelined, II: L?.II ?? 1, model }));
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
        design, lib, segs, cost, warnings: design.warnings, model,
        totals: {
            cycles: totalCycles, clockPs, timeNs: (totalCycles * clockPs) / 1000, critPs,
            area: cost.area.total, luts: cost.fpga.luts, carry4: cost.fpga.carry4, ff: cost.fpga.ff, energy: cost.energy.total,
            intervalNs: inner.length === 1 ? (inner[0].IIachieved * clockPs) / 1000 : null,
        },
    };
}
