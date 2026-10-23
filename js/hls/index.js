/**
 * Fluxo de síntese de alto nível do kernel: análise (lang.js), elaboração com as diretivas (elab.js), escalonamento
 * com encadeamento, com ou sem pipeline (sched.js), ligação e custo (cost.js), com as unidades e células da
 * biblioteca sintetizada (lib.js). Roda igual no navegador e no Node (bin/axc.mjs hls).
 */
import { parse } from './lang.js';
import { elaborate, bitsFor, affText } from './elab.js';
import { makeLibrary, digits } from './lib.js';
import { scheduleSegment, MODEL } from './sched.js';
import { bindAndCost } from './cost.js';
import { approxOps } from './approx.js';

export { MODEL };

/**
 * Lógica de memória além das portas: endereços e seleção de banco.
 *
 *   endereço   cada acesso com índice variável calcula o endereço no banco (linha × largura + coluna): somas de
 *              deslocamentos dos termos das variáveis, uma vez por parte variável (o Vitis reaproveita a base), e uma
 *              soma a mais por deslocamento constante diferente; cada soma tem a largura do endereço (1 LUT por bit);
 *   banco      com partição cyclic ou block e índice variável, a leitura escolhe entre os F bancos (multiplexador de F
 *              entradas). Com F potência de 2, banco e endereço são bits do índice; com outro F, o Vitis calcula o
 *              endereço com uma divisão por constante para cada expressão de índice diferente (multiplicação pelo
 *              inverso, 6w LUTs no xc7a100t para w = 8, que atrasa o acesso em MODEL.divAddrCycles ciclo) e o banco com
 *              um resto (urem sequencial, w + 4 ciclos, 4w LUTs e 5w FFs) para cada conjunto de variáveis, calculado
 *              na iteração do laço mais interno delas.
 */
export function partitionLogic(design, model = MODEL) {
    const arrays = new Map(design.arrays.map((a) => [a.name, a]));
    const depthOf = new Map();
    for (const l of design.loops) { let d = 0; for (let p = l.parent; p; p = design.loops.find((x) => x.id === p)?.parent) d++; depthOf.set(l.id, d); }
    const divs = new Map(), urems = new Map(), muxes = [], bases = new Map(), offsets = new Set();
    for (const seg of design.segments) for (const n of seg.nodes) {
        if (n.op !== 'load' && n.op !== 'store') continue;
        const piped = seg.region.loop?.mode === 'pipelined';
        const arr = arrays.get(n.array), p = arr.partition;
        if (p?.type === 'complete' || !n.idx) continue;
        const pd = p ? (p.dim === 0 ? -1 : p.dim - 1) : null;
        const F = p?.factor ?? 1;
        const pow2 = (F & (F - 1)) === 0;
        // Endereço no banco: dimensões com o tamanho dividido por F na dimensão particionada.
        const dims = arr.dims.map((x, k) => (k === pd ? Math.ceil(x / F) : x));
        const stride = dims.map((_, k) => dims.slice(k + 1).reduce((a, b) => a * b, 1));
        const size = dims.reduce((a, b) => a * b, 1) / (pd === -1 ? F : 1);
        const aw = bitsFor([0, Math.max(1, size - 1)]);
        let terms = 0, off = 0;
        const key = [];
        n.idx.forEach((a, k) => {
            const vars = Object.keys(a.t).filter((v) => a.t[v] !== 0);
            if (k === pd && !pow2 && vars.length) { terms += digits(stride[k]); key.push(`d(${affText(a)})`); return; }
            const sc = k === pd ? F : 1;
            for (const v of vars) { terms += digits(Math.abs(Math.floor(a.t[v] / sc) * stride[k])) || 0; key.push(`${v}*${Math.floor(a.t[v] / sc) * stride[k]}`); }
            off += Math.floor(a.c / sc) * stride[k];
        });
        // Sem pipeline, o Vitis reaproveita o endereço entre os estados (nos relatórios do Vivado, as variantes
        // sequenciais do gaussiano não têm a lógica de endereço das com pipeline): só entra com pipeline.
        if (!key.length || !piped) { if (!key.length) continue; } else {
        const bk = `${arr.name}:${key.join('+')}`;
        bases.set(bk, { array: arr.name, w: aw, adders: Math.max(0, terms - 1) });
        if (off) offsets.add(`${bk}+${off}#${aw}`);
        }
        if (!n.bank || n.bank.exact || n.bank.banks <= 1) continue;
        const d = p.dim === 0 ? 0 : p.dim - 1;
        const w = bitsFor([0, (p.dim === 0 ? arr.size : arr.dims[d]) - 1]);
        if (n.op === 'load') muxes.push({ array: arr.name, inputs: F, W: bitsFor(n.range) });
        if (pow2) continue;
        const a = p.dim === 0 ? null : n.idx[d];
        const free = (k) => (p.type === 'cyclic' ? a.t[k] % F !== 0 : a.t[k] !== 0);
        const vars = a ? Object.keys(a.t).filter(free).sort() : ['?'];
        divs.set(`${arr.name}:${a ? affText(a) : n.text}`, { array: arr.name, w });
        const ukey = `${arr.name}:${vars.join(',')}`;
        if (!urems.has(ukey)) {
            const loop = vars.filter((v) => depthOf.has(v)).sort((x, y) => depthOf.get(y) - depthOf.get(x))[0] ?? null;
            urems.set(ukey, { array: arr.name, w, loop, latency: w + model.uremLatency });
        }
    }
    const latency = new Map();
    for (const u of urems.values()) if (u.loop) latency.set(u.loop, Math.max(latency.get(u.loop) ?? 0, u.latency));
    const addrLuts = [...bases.values()].reduce((s, b) => s + b.adders * b.w, 0) + [...offsets].reduce((s, o) => s + +o.split('#')[1], 0);
    const bankLuts = [...divs.values()].reduce((s, x) => s + 6 * x.w, 0) + [...urems.values()].reduce((s, x) => s + 4 * x.w, 0) + muxes.reduce((s, m) => s + m.W * Math.ceil(m.inputs / 4), 0);
    const ff = [...urems.values()].reduce((s, x) => s + 5 * x.w, 0);
    return { divs: [...divs.values()], urems: [...urems.values()], muxes, bases: [...bases.values()], offsets: offsets.size, latency, addrLuts, bankLuts, luts: addrLuts + bankLuts, ff, pipeFf: 0 };
}

/**
 * @param {string} src código do kernel
 * @param {{synth: object, cells: object, flow?: string, target?: string, clockNs?: number, ports?: number, model?: object,
 *          assign?: Map<string, string>|object, design?: object, fpga?: object, wide?: boolean}} o fpga: data/vivado-units.json (alvo FPGA); assign: unidade aproximada de cada operação (id do
 *          nó -> nome); design: projeto já elaborado do mesmo código, reaproveitado; wide: somadores de 24 e 32 bits
 *          da biblioteca (o fluxo das redes neurais)
 */
export function synthesize(src, { synth, cells, flow = 'delay', target = 'asic', clockNs = 5, ports = 2, model = MODEL, assign = null, design: given = null, fpga = null, wide = false } = {}) {
    const clockPs = Math.round(clockNs * 1000);
    // A elaboração é a parte cara; a exploração passa o projeto já elaborado (o mesmo código e as mesmas portas).
    const design = given ?? elaborate(parse(src), { ports });
    const warnings = [...design.warnings];
    const lib = makeLibrary(synth, cells, { flow, target, fpga, wide });
    const arrays = new Map(design.arrays.map((a) => [a.name, a]));
    // Operações que aceitam unidade aproximada e a atribuição pedida (os ids que não existem mais são ignorados).
    const ops = approxOps(design, lib);
    const asg = new Map();
    for (const [id, name] of assign instanceof Map ? assign : Object.entries(assign ?? {})) {
        const op = ops.byId.get(id);
        if (!op) continue;
        // Com a opção wide (redes), também as cascatas da largura da soma (ADD24 (ADD16 LOA8 + ADD8 exato)).
        const wideOk = () => { try { const u = lib.unitByName(name); return u.cfg.kind === 'add' && u.cfg.width === op.W; } catch { return false; } };
        if (!op.candidates.includes(name) && !(lib.wide && op.cls === 'add' && op.candidates.length > 1 && wideOk())) { warnings.push({ msg: `${id}: ${name} não serve para ${op.label} (ignorada)`, line: op.node.line }); continue; }
        if (name !== op.candidates[0]) asg.set(id, name);
    }
    const schedOf = new Map();
    for (const seg of design.segments) {
        const L = seg.region.loop;
        const pipelined = L?.mode === 'pipelined';
        schedOf.set(seg, scheduleSegment(seg, { lib, clockPs, arrays, allocation: design.allocation, pipelined, II: L?.II ?? 1, model, assign: asg }));
    }
    const addr = partitionLogic(design);
    // Latência: trechos em sequência; laço sem pipeline repete o corpo; com pipeline, profundidade + (N - 1) II.
    const latency = (region) => region.items.reduce((s, it) => s + (it.k === 'seg' ? schedOf.get(it.seg).depth : loopLatency(it.region)), 0);
    // Achatamento (como o Vitis faz por padrão): um laço sem pipeline cujo corpo é só outro laço (sem operações fora
    // dele) que tem pipeline, ou que também se achata, vira um laço só, com pipeline, de N·M iterações.
    const onlyLoop = (r) => {
        const loops = r.items.filter((it) => it.k === 'loop');
        const busy = r.items.some((it) => it.k === 'seg' && schedOf.get(it.seg).depth > 0);
        return loops.length === 1 && !busy ? loops[0].region : null;
    };
    const flatInner = (r) => {
        const L = r.loop;
        if (L.mode === 'pipelined') return r;
        if (L.mode !== 'sequential' || !model.flatten) return null;
        const c = onlyLoop(r);
        return c ? flatInner(c) : null;
    };
    function loopLatency(r) {
        const L = r.loop;
        L.flatInto = null;
        if (L.mode === 'pipelined' || (L.mode === 'sequential' && flatInner(r))) {
            const inner = flatInner(r);
            const segs = inner.items.filter((it) => it.k === 'seg');
            const sch = schedOf.get(segs[0].seg);
            // Iterações do laço achatado e laços que ele junta (de fora para dentro).
            const chain = [];
            for (let x = r; x; x = x === inner ? null : onlyLoop(x)) chain.push(x.loop);
            const trip = chain.reduce((p, l) => p * l.tripHw, 1);
            // Seleção de banco com fator que não é potência de 2: o resto da divisão (urem) entra na profundidade.
            const extra = Math.max(0, ...chain.map((l) => addr.latency.get(l.id) ?? 0));
            for (const l of chain) {
                l.iterLatency = sch.depth + extra;
                l.IIachieved = sch.II;
                l.why = sch.why;
                if (l !== chain[0]) l.flatInto = chain[0].id;
            }
            chain[0].flatLabel = chain.length > 1 ? chain.map((l) => l.label ?? l.id).join('_') : null;
            chain[0].flatTrip = trip;
            L.latency = sch.depth + extra + (trip - 1) * sch.II + model.pipelineOverhead;
            for (const l of chain.slice(1)) l.latency = null;
        } else {
            // Teste e incremento, mais a entrada e a saída de cada laço interno, mais o urem calculado nesta iteração.
            const subs = r.items.filter((it) => it.k === 'loop').length;
            L.iterLatency = latency(r) + model.loopOverhead + subs * model.subloopOverhead + (addr.latency.get(L.id) ?? 0);
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
    // Com pipeline, os contadores dos laços usados nos índices acompanham a iteração até o último acesso à memória
    // (um registrador por estágio, como o Vitis faz; no gaussiano, 16 bits por 17 estágios, a diferença de FF que o
    // Vivado mostrava).
    const loopById = new Map(design.loops.map((l) => [l.id, l]));
    addr.pipeFf = 0;
    for (const { seg, sch, pipelined } of segs) {
        if (!pipelined) continue;
        const vars = new Set();
        let last = 0;
        for (const n of seg.nodes) {
            if ((n.op !== 'load' && n.op !== 'store') || !n.idx) continue;
            const vs = n.idx.flatMap((a) => Object.keys(a.t).filter((v) => a.t[v] !== 0));
            if (!vs.length) continue;
            vs.forEach((v) => vars.add(v));
            last = Math.max(last, sch.sched.get(n.id).cycle + (addr.latency.get(seg.region.loop.id) ?? 0) + Math.max(0, ...[...addr.latency.entries()].filter(([id]) => vs.includes(id)).map(([, x]) => x)));
        }
        const bits = [...vars].reduce((s, v) => s + (loopById.has(v) ? bitsFor([0, loopById.get(v).tripHw]) : 0), 0);
        addr.pipeFf += bits * last;
    }
    addr.ff += addr.pipeFf;
    const cost = bindAndCost(design, segs, lib, { totalCycles, clockPs, model, addr });
    const critPs = Math.max(0, ...segs.map((s) => s.sch.critPs));
    const inner = design.loops.filter((l) => l.mode === 'pipelined');
    return {
        design, lib, segs, cost, warnings, model, ops, assign: asg,
        totals: {
            cycles: totalCycles, clockPs, timeNs: (totalCycles * clockPs) / 1000, critPs,
            area: cost.area.total, luts: cost.fpga.luts, carry4: cost.fpga.carry4, ff: cost.fpga.ff, dsp: cost.fpga.dsp, energy: cost.energy.total,
            intervalNs: inner.length === 1 ? (inner[0].IIachieved * clockPs) / 1000 : null,
        },
    };
}
