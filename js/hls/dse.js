/**
 * Exploração do espaço de projeto do kernel: quais unidades (e, opcionalmente, quais diretivas e períodos) usar para
 * gastar menos área, energia ou tempo com o erro da saída dentro de um limite.
 *
 *   avaliação    cada ponto é sintetizado de novo (escalonamento, ligação, custo: o compartilhamento, os
 *                multiplexadores e o II entram no custo) e o erro das saídas vem do modelo estático (entrega 2). A
 *                elaboração e o perfil exato são feitos uma vez por variante de diretivas;
 *   objetivo     área ASIC (µm²), LUT + CARRY4, energia por execução (sky130), latência (ns) ou intervalo entre
 *                resultados (II × período), ou a soma ponderada de área, energia e latência, cada uma dividida pela
 *                do projeto exato;
 *   restrição    PSNR mínimo, MSE máximo ou SSIM mínimo (saídas de imagem) em todas as saídas;
 *   grupos       a unidade é escolhida por operação, por linha do código (operação e largura) ou por classe (todas
 *                as multiplicações de 8 bits juntas, por exemplo);
 *   candidatas   para cada grupo, só as unidades da fronteira de Pareto entre o custo da unidade (no objetivo) e o erro
 *                próprio nas operações do grupo (sobre os operandos reais); a opção allUnits usa todas;
 *   heurísticas  sequencial: os grupos na ordem do código, multiplicações antes das somas; em cada grupo, testa as
 *                candidatas e fica com a de menor custo que mantém a restrição (a busca da pesquisa anterior);
 *                eficiência: a partir do exato, a cada passo aplica a troca de unidade com a maior economia de custo
 *                por aumento de erro que mantém a restrição, até não haver troca que economize; com grupos por
 *                operação ou por linha, também testa a troca da classe inteira (o compartilhamento pode fazer uma
 *                troca isolada custar mais e a de várias, menos);
 *                exaustiva: todas as combinações das candidatas, em ordem de custo (o primeiro ponto viável é o
 *                ótimo do modelo); a poda descarta, em cada grupo, as unidades de erro próprio maior que a primeira
 *                que sozinha já viola a restrição (poda heurística: o erro não é monótono em geral);
 *                aleatória: amostras com sementes fixas, como referência;
 *   verificação  o melhor ponto é executado bit a bit; se o erro medido passar do limite, o próximo viável (em ordem
 *                de custo) é verificado, até maxVerify pontos (25 por padrão). Os pontos da fronteira também podem ser verificados.
 */
import { synthesize } from './index.js';
import { estimateError, unitErrors, analyzeError } from './error.js';
import { execute, makeInputs } from './exec.js';
import { HEURISTICS, runHeuristic, newContext, evalChoice, paretoPoints } from '../axc/heuristics.js';
import { outputSsimStats } from './exec.js';

export const OBJECTIVES = ['area', 'luts', 'energy', 'latency', 'interval', 'weighted'];
export { HEURISTICS };
export const GRANULARITIES = ['class', 'line', 'source', 'op'];

/** Variantes de diretivas: cada linha #pragma HLS de pipeline, unroll ou array_partition ligada ou desligada. */
export function pragmaVariants(src, maxPragmas = 4) {
    const lines = src.split('\n');
    const idx = lines.map((l, k) => (/^\s*#pragma\s+HLS\s+(pipeline|unroll|array_partition)\b/i.test(l) ? k : -1)).filter((k) => k >= 0).slice(0, maxPragmas);
    const out = [];
    for (let m = 0; m < 2 ** idx.length; m++) {
        const off = idx.filter((_, b) => (m >> b) & 1);
        const code = lines.map((l, k) => (off.includes(k) ? `// (desligada) ${l.trim()}` : l)).join('\n');
        out.push({ code, label: off.length ? `sem ${off.map((k) => `${lines[k].trim().replace(/^#pragma\s+HLS\s+/i, '').split(/\s+/)[0]} (linha ${k + 1})`).join(', ')}` : 'diretivas do código', off: off.map((k) => k + 1) });
    }
    return out;
}

/**
 * Prepara uma variante: elaboração, projeto exato, dados de entrada e perfil exato.
 * @param {string} src código
 * @param {object} o synth, cells, clockNs, flow, ports, input ('image'|'uniform'), method ('sampled'|'analytic'), label
 */
export function prepare(src, { synth, cells, clockNs = 5, flow = 'delay', ports = 2, target = 'asic', fpga = null, input = 'image', image = null, method = 'sampled', label = '' } = {}) {
    const syn = { synth, cells, clockNs, flow, ports, target, fpga };
    const base = synthesize(src, syn);
    const inputs = makeInputs(base.design, input, 2027, image);
    const prof = execute(base.design, inputs, { profile: true });
    return { src, syn, label, clockNs, design: base.design, base, inputs, prof, method, ownCache: new Map(), cache: new Map(), costCache: new Map(), evals: 0 };
}

const costOf = (r) => ({
    area: r.totals.area, luts: r.totals.luts + r.totals.carry4, energy: r.totals.energy,
    latency: r.totals.timeNs, interval: r.totals.intervalNs ?? r.totals.timeNs, cycles: r.totals.cycles, critPs: r.totals.critPs,
});

/** Função de custo do objetivo; ref é o custo do projeto exato de referência (para o ponderado). */
export function scoreFn(objective, weights = { area: 1, energy: 1, latency: 1 }, ref = null) {
    if (objective !== 'weighted') return (c) => c[objective];
    const w = { area: 1, energy: 1, latency: 1, ...weights };
    return (c) => w.area * (c.area / ref.area) + w.energy * (c.energy / ref.energy) + w.latency * (c.latency / ref.latency);
}

/** Restrição de erro em todas as saídas. */
export const METRICS = ['psnr', 'mse', 'ssim'];
/**
 * Restrição em todas as saídas: PSNR mínimo, MSE máximo ou SSIM mínimo. O SSIM só existe nas saídas de imagem (8 bits
 * sem sinal, 2 dimensões): com a restrição em SSIM, ela vale nessas saídas (a exploração recusa um kernel sem nenhuma).
 */
export function constraintFn({ metric = 'psnr', value = 30 } = {}) {
    if (metric === 'ssim') return (outs) => outs.every((o) => o.SSIM === null || o.SSIM === undefined || o.SSIM >= value);
    return (outs) => outs.every((o) => (metric === 'psnr' ? o.PSNR >= value : o.MSE <= value));
}
/**
 * Erro escalar para a eficiência e a fronteira: soma de MSE / pico² das saídas (coerente com o PSNR e o MSE), ou
 * soma de 1 - SSIM com a restrição em SSIM.
 */
const errScalarOf = (metric) => (metric === 'ssim'
    ? (outs) => outs.reduce((s, o) => s + (o.SSIM === null || o.SSIM === undefined ? o.MSE / (o.peak * o.peak) : 1 - o.SSIM), 0)
    : (outs) => outs.reduce((s, o) => s + o.MSE / (o.peak * o.peak), 0));
const errScalar = errScalarOf('psnr');

const keyOf = (assign) => [...assign].filter(([, u]) => !/ exato$|2 × ADD16 exato/.test(u)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, u]) => `${k}=${u}`).join(';');

/**
 * Grupos de operações e as unidades candidatas de cada um.
 *
 * Candidatas: em cada grupo, as unidades da fronteira de Pareto entre a economia no contexto e o erro próprio nas
 * operações do grupo. A economia no contexto é a do projeto inteiro com só aquele grupo trocado (síntese: a unidade
 * com os bits conhecidos de cada operação, o compartilhamento e os multiplexadores), não a da unidade isolada na
 * biblioteca, que pode ordenar as unidades de outro jeito (um truncado fica mais barato que um LOA no contexto e não
 * na tabela). Saem também as unidades que não erram em nenhuma amostra das operações do grupo: com os mesmos
 * resultados nos operandos reais (por exemplo, um segmentado com a divisão nos bits altos que são sempre zero), a
 * síntese faz delas o mesmo circuito do exato, e qualquer diferença de custo seria ruído do modelo. Com allUnits,
 * ficam todas as que economizam sozinhas.
 */
export function groupsOf(v, { granularity = 'class', objective = 'area', weights, allUnits = false } = {}) {
    const ops = v.base.ops.list.filter((o) => o.candidates.length > 1);
    const by = new Map();
    for (const o of ops) {
        const k = granularity === 'op' ? o.id : granularity === 'source' ? o.origin : granularity === 'line' ? o.group : `${o.cls}${o.W}`;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(o);
    }
    const score = scoreFn(objective, weights, costOf(v.base));
    const base = score(costOf(v.base));
    const groups = [];
    for (const [key, list] of by) {
        const names = list[0].candidates.filter((n) => list.every((o) => o.candidates.includes(n)));
        const rows = [{ name: names[0], cost: 0, own: 0 }];
        for (const name of names.slice(1)) {
            const errs = unitErrors(v.base, v.prof.stats, new Map(list.map((o) => [o.id, name])), v.ownCache);
            const own = list.reduce((s, o) => s + errs.get(o.id).m2, 0);
            if (own === 0) continue; // equivalente ao exato nos operandos reais
            const a = new Map(list.map((o) => [o.id, name]));
            const cost = score(costOf(synthesize(v.src, { ...v.syn, design: v.design, assign: a }))) - base;
            if (cost >= 0) continue; // não economiza nem sozinha
            rows.push({ name, cost, own });
        }
        // Fronteira de Pareto (custo no contexto, erro próprio); a exata fica sempre.
        const front = allUnits ? rows : rows.filter((a, i) => i === 0 || !rows.some((b) => b !== a && b.cost <= a.cost && b.own <= a.own && (b.cost < a.cost || b.own < a.own)));
        // A exata primeiro (referência); as outras em ordem de erro próprio.
        front.sort((a, b) => (b.name === names[0]) - (a.name === names[0]) || a.own - b.own || a.cost - b.cost);
        const label = granularity === 'op' ? `${list[0].id} (${list[0].text})` : granularity === 'source' ? `${list[0].id} (${list[0].text})${list.length > 1 ? ` e ${list.length - 1} cópia${list.length > 2 ? 's' : ''}` : ''}` : granularity === 'line' ? `linha ${list[0].node.line}, ${list[0].cls}${list[0].W}` : key;
        groups.push({ key, label, cls: list[0].cls, W: list[0].W, line: list[0].node.line, ops: list, exact: names[0], cands: front.map((x) => x.name), all: names.length, ownOf: new Map(front.map((x) => [x.name, x.own])), costOf: new Map(front.map((x) => [x.name, x.cost])) });
    }
    return groups;
}

/** Atribuição de nós a partir da escolha de cada grupo. */
const expand = (groups, choice) => {
    const m = new Map();
    groups.forEach((g, i) => { if (choice[i] && choice[i] !== g.exact) for (const o of g.ops) m.set(o.id, choice[i]); });
    return m;
};

const psnrOf = (p) => Math.min(...p.outs.map((o) => o.PSNR));

/**
 * O problema de busca de uma variante (para js/axc/heuristics.js): a escolha por grupo vira a atribuição de nós; o
 * ponto é sintetizado de novo e o erro vem do modelo estático. O cache de custos (só os números) fica na variante.
 */
export function hlsProblem(v, groups, { score, ok, errOf = errScalar, maxRows } = {}) {
    const P = {
        groups,
        key: (c) => keyOf(expand(groups, c)),
        cost: (c, key) => {
            // Só o número fica guardado: o resultado da síntese inteiro, para milhares de trocas, esgota a memória.
            if (!v.costCache.has(key)) v.costCache.set(key, score(costOf(synthesize(v.src, { ...v.syn, design: v.design, assign: expand(groups, c) }))));
            return v.costCache.get(key);
        },
        evaluate: (c, key) => {
            const r = synthesize(v.src, { ...v.syn, design: v.design, assign: expand(groups, c) });
            // O modelo por amostras usa todas as instâncias guardadas no perfil (até 2048 por trecho). Com menos
            // (maxRows), a busca fica mais rápida, mas o ruído da estimativa favorece os pontos estimados com folga a
            // mais (os escolhidos perto do limite tendem a não passar na verificação).
            const est = estimateError(r, v.prof, { method: v.method, budget: false, cache: v.ownCache, maxRows: maxRows ?? Infinity });
            const outs = [...est.outputs].map(([array, o]) => ({ array, ...o }));
            const cost = costOf(r);
            v.evals++;
            return { variant: v.label, clockNs: v.clockNs, key, assign: new Map(r.assign), units: r.cost.units.map((u) => `${u.count} × ${u.unit.name}`), cost, score: score(cost), outs, err: errOf(outs), feasible: ok(outs), v };
        },
        mark: (p) => ({ psnr: psnrOf(p) }),
        // Ponto de partida das heurísticas de melhoria com grupos menores que a classe: o ótimo por classe (a
        // exaustiva nos grupos de classe, que cabe sem poda nos kernels de exemplo) levado para os grupos.
        classSeed: (ctx, o) => {
            if ((o.granularity ?? 'class') === 'class') return null;
            v.classGroups ??= groupsOf(v, { ...o, granularity: 'class' });
            const cg = v.classGroups;
            if (cg.reduce((s, g) => s * g.cands.length, 1) > 20000) return null;
            const r = runHeuristic('exhaustive', hlsProblem(v, cg, { score, ok, errOf, maxRows }), ctx, { maxCombos: 20000, frontEvals: 1 });
            const unitOf = new Map();
            cg.forEach((g) => { for (const op of g.ops) unitOf.set(op.id, r.best.assign.get(op.id) ?? g.exact); });
            return groups.map((g) => {
                const u = unitOf.get(g.ops[0].id) ?? g.exact;
                return g.ops.every((op) => (unitOf.get(op.id) ?? g.exact) === u) ? u : g.exact;
            });
        },
    };
    return P;
}

export { paretoPoints };

/** Verificação bit a bit de um ponto (com cache). */
export function verifyPoint(p, ok) {
    if (p.measured) return p;
    const v = p.v;
    const r = synthesize(v.src, { ...v.syn, design: v.design, assign: p.assign });
    const a = analyzeError(r, { inputs: v.inputs, prof: v.prof, method: v.method, budget: false });
    p.measured = a.measured.map((m) => ({ array: m.array, ME: m.ME, MSE: m.MSE, PSNR: m.PSNR, SSIM: m.SSIM, peak: m.peak, WCE: m.WCE, EP: m.EP, MRED: m.MRED }));
    p.measuredOk = ok(p.measured);
    return p;
}

/**
 * Exploração completa.
 * @param {string} src código do kernel
 * @param {object} o synth, cells, flow, ports, input, method; clocks (lista de períodos em ns; as diretivas são as do
 *   código); heuristicList (as heurísticas de 'all'); objective, weights, constraint {metric, value}; granularity; heuristic (ou 'all' para comparar);
 *   allUnits; samples, seed (aleatória); maxVerify; verifyFront (quantos pontos da fronteira verificar); progress(n)
 */
export function explore(src, o = {}) {
    const t0 = Date.now();
    const clocks = o.clocks?.length ? o.clocks : [5];
    // As diretivas são as do código; os períodos, os pedidos (o da página, ou uma lista na linha de comando).
    const variants = [{ code: src, label: '', off: [] }];
    const heuristics = o.heuristic === 'all' ? o.heuristicList ?? HEURISTICS : [o.heuristic ?? 'local'];
    const ok = constraintFn(o.constraint);
    const prepared = [];
    for (const vv of variants) for (const clk of clocks) {
        try {
            prepared.push(prepare(vv.code, { ...o, clockNs: clk, label: `${clk} ns` }));
        } catch (e) {
            prepared.push({ label: `${clk} ns`, error: e.message });
        }
    }
    const good = prepared.filter((v) => !v.error);
    const prepMs = Date.now() - t0;
    if (!good.length) throw new Error(prepared[0]?.error ?? 'nenhuma variante');
    if (o.constraint?.metric === 'ssim' && !outputSsimStats(good[0].design, good[0].prof).size) throw new Error('restrição em SSIM: o kernel não tem saída de imagem (vetor de 2 dimensões com 8 bits sem sinal, pelo menos 11 × 11 escritos)');
    const ref = costOf(good[0].base);
    const score = scoreFn(o.objective ?? 'area', o.weights, ref);
    const runs = [];
    // Candidatas de cada variante (o erro próprio das unidades sobre os operandos), antes das heurísticas.
    const t2 = Date.now();
    for (const v of good) v.groups = groupsOf(v, o);
    const candMs = Date.now() - t2;
    for (const h of heuristics) {
        const t1 = Date.now();
        const ctx = { ...newContext({ progress: o.progress }), points: [] };
        const pOpts = { score, ok, errOf: errScalarOf(o.constraint?.metric), maxRows: o.maxRows };
        let best = null;
        const traces = [], last = [];
        for (const v of good) {
            ctx.cache = new Map(); // cada heurística conta as suas avaliações (e as chaves são por variante)
            v.costCache ??= new Map();
            const groups = v.groups;
            if (good.length > 1) ctx.steps.push({ kind: 'variant', label: v.label, groups: groups.length });
            const P = hlsProblem(v, groups, pOpts);
            if (!groups.length) { evalChoice(P, [], ctx); continue; }
            let res;
            try { res = runHeuristic(h, P, ctx, { granularity: o.granularity ?? 'class', ...o }); } catch (e) { traces.push({ variant: v.label, error: e.message }); continue; }
            traces.push({ variant: v.label, trace: res.trace.map((p) => p.key), groups: groups.map((g) => ({ key: g.key, ops: g.ops.length, candidates: g.cands.length, of: g.all })) });
            last.push(res.best);
        }
        // O resultado da heurística é o ponto viável mais barato entre os que ela avaliou (qualquer ponto avaliado é um
        // projeto válido); o fim do caminho da busca fica em last.
        best = ctx.points.filter((p) => p.feasible).sort((a, b) => a.score - b.score)[0] ?? ctx.points[0] ?? null;
        // Verificação bit a bit: o melhor; se não passar, o próximo viável em ordem de custo.
        const feasible = ctx.points.filter((p) => p.feasible).sort((a, b) => a.score - b.score);
        let chosen = null, tries = 0;
        for (const p of feasible.slice(0, o.maxVerify ?? 25)) {
            tries++;
            verifyPoint(p, ok);
            ctx.steps.push({ kind: 'verify', n: tries, label: p.units.join(', '), variant: p.variant, score: p.score, psnr: psnrOf(p), measured: Math.min(...p.measured.map((m) => m.PSNR)), ok: p.measuredOk, state: { score: p.score, psnr: psnrOf(p), units: p.units } });
            if (p.measuredOk) { chosen = p; break; }
        }
        const front = paretoPoints(ctx.points);
        // Os pontos viáveis da fronteira mais baratos (os que interessam para a decisão).
        for (const p of front.filter((x) => x.feasible).slice(0, o.verifyFront ?? 0)) verifyPoint(p, ok);
        runs.push({ heuristic: h, best, last, chosen, steps: ctx.steps, verifyTries: tries, evals: ctx.points.length, ms: Date.now() - t1, points: ctx.points, front, traces, error: traces.find((x) => x.error)?.error ?? null });
    }
    return { variants: prepared.map((v) => ({ label: v.label, error: v.error ?? null, ops: v.base?.ops.list.length ?? 0 })), ref, refScore: score(ref), runs, ms: Date.now() - t0, prepMs, candMs, options: { ...o, synth: undefined, cells: undefined, progress: undefined } };
}

/** Resumo serializável de um ponto (para JSON e para a página). */
export function pointSummary(p, ref = null) {
    if (!p) return null;
    return {
        variant: p.variant, clockNs: p.clockNs, score: p.score, cost: p.cost, units: p.units, assign: Object.fromEntries(p.assign),
        estimated: p.outs.map((x) => ({ array: x.array, ME: x.ME, MSE: x.MSE, PSNR: x.PSNR, SSIM: x.SSIM ?? null })), feasible: p.feasible,
        measured: p.measured ?? null, measuredOk: p.measuredOk ?? null,
        savings: ref ? { area: 1 - p.cost.area / ref.area, energy: 1 - p.cost.energy / ref.energy, latency: 1 - p.cost.latency / ref.latency } : null,
    };
}
