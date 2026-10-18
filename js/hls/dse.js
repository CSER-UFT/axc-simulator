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
 *   restrição    PSNR mínimo ou MSE máximo em todas as saídas;
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
import { rng } from '../axc/metrics.js';

export const OBJECTIVES = ['area', 'luts', 'energy', 'latency', 'interval', 'weighted'];
export const HEURISTICS = ['sequential', 'efficiency', 'exhaustive', 'random'];
export const GRANULARITIES = ['class', 'line', 'op'];

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
export function constraintFn({ metric = 'psnr', value = 30 } = {}) {
    return (outs) => outs.every((o) => (metric === 'psnr' ? o.PSNR >= value : o.MSE <= value));
}
/** Erro escalar para a eficiência: soma de MSE / pico² das saídas (coerente com o PSNR). */
const errScalar = (outs) => outs.reduce((s, o) => s + o.MSE / (o.peak * o.peak), 0);

const keyOf = (assign) => [...assign].filter(([, u]) => !/ exato$|2 × ADD16 exato/.test(u)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, u]) => `${k}=${u}`).join(';');

/** Só o custo de uma atribuição (a síntese leva cerca de 1 ms; o erro, bem mais), com cache. */
function costOnly(v, assign, ctx) {
    const key = keyOf(assign);
    if (v.cache.has(key)) return v.cache.get(key).score;
    // Só o número fica guardado: o resultado da síntese inteiro, para milhares de trocas, esgota a memória.
    if (!v.costCache.has(key)) v.costCache.set(key, ctx.score(costOf(synthesize(v.src, { ...v.syn, design: v.design, assign }))));
    return v.costCache.get(key);
}

/** Avalia uma atribuição (nó -> unidade): síntese e erro estimado, com cache. */
function evaluate(v, assign, ctx) {
    const key = keyOf(assign);
    if (v.cache.has(key)) return v.cache.get(key);
    const r = synthesize(v.src, { ...v.syn, design: v.design, assign });
    // O modelo por amostras usa todas as instâncias guardadas no perfil (até 2048 por trecho). Com menos (maxRows), a
    // busca fica mais rápida, mas o ruído da estimativa favorece os pontos estimados com folga a mais (os escolhidos
    // perto do limite tendem a não passar na verificação).
    const est = estimateError(r, v.prof, { method: v.method, budget: false, cache: v.ownCache, maxRows: ctx.maxRows ?? Infinity });
    const outs = [...est.outputs].map(([array, o]) => ({ array, ...o }));
    const cost = costOf(r);
    const p = { variant: v.label, clockNs: v.clockNs, key, assign: new Map(r.assign), units: r.cost.units.map((u) => `${u.count} × ${u.unit.name}`), cost, score: ctx.score(cost), outs, err: errScalar(outs), feasible: ctx.ok(outs), v };
    v.cache.set(key, p);
    v.evals++;
    ctx.points.push(p);
    ctx.progress?.(ctx.points.length);
    return p;
}

/** Grupos de operações e as unidades candidatas de cada um. */
export function groupsOf(v, { granularity = 'class', objective = 'area', weights, allUnits = false } = {}) {
    const ops = v.base.ops.list.filter((o) => o.candidates.length > 1);
    const by = new Map();
    for (const o of ops) {
        const k = granularity === 'op' ? o.id : granularity === 'line' ? o.group : `${o.cls}${o.W}`;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(o);
    }
    const lib = v.base.lib;
    const w = { area: 1, energy: 1, latency: 1, ...weights };
    const unitCost = (name, ex) => {
        const u = lib.unitByName(name);
        switch (objective) {
            case 'luts': return u.luts + u.carry4;
            case 'energy': return u.energy;
            case 'latency': case 'interval': return u.delay;
            case 'weighted': return w.area * (u.area / ex.area) + w.energy * (u.energy / ex.energy) + w.latency * (u.delay / ex.delay);
            default: return u.area;
        }
    };
    const groups = [];
    for (const [key, list] of by) {
        const names = list[0].candidates.filter((n) => list.every((o) => o.candidates.includes(n)));
        const ex = lib.unitByName(names[0]);
        const rows = names.map((name) => {
            const own = name === names[0] ? 0 : list.reduce((s, o) => s + unitErrors(v.base, v.prof.stats, new Map([[o.id, name]]), v.ownCache).get(o.id).m2, 0);
            return { name, cost: unitCost(name, ex), own };
        });
        // Fronteira de Pareto (custo da unidade, erro próprio no grupo); a exata fica sempre.
        const front = allUnits ? rows : rows.filter((a, i) => i === 0 || !rows.some((b) => b !== a && b.cost <= a.cost && b.own <= a.own && (b.cost < a.cost || b.own < a.own)));
        // A exata primeiro (ela fica mesmo dominada, como referência); as outras em ordem de erro próprio.
        front.sort((a, b) => (b.name === names[0]) - (a.name === names[0]) || a.own - b.own || a.cost - b.cost);
        const label = granularity === 'op' ? `${list[0].id} (${list[0].text})` : granularity === 'line' ? `linha ${list[0].node.line}, ${list[0].cls}${list[0].W}` : key;
        groups.push({ key, label, cls: list[0].cls, W: list[0].W, line: list[0].node.line, ops: list, exact: names[0], cands: front.map((x) => x.name), all: names.length, ownOf: new Map(front.map((x) => [x.name, x.own])) });
    }
    return groups;
}

/** Atribuição de nós a partir da escolha de cada grupo. */
const expand = (groups, choice) => {
    const m = new Map();
    groups.forEach((g, i) => { if (choice[i] && choice[i] !== g.exact) for (const o of g.ops) m.set(o.id, choice[i]); });
    return m;
};

// Heurísticas ---------------------------------------------------------------------------------------------------
// Cada heurística registra as suas iterações em ctx.steps (o passo a passo que a página anima): o que foi avaliado,
// o que foi escolhido e por quê, e o estado da busca depois da iteração.

const psnrOf = (p) => Math.min(...p.outs.map((o) => o.PSNR));
const stateOf = (p) => ({ score: p.score, psnr: psnrOf(p), units: p.units });
const tryOf = (p, label, extra = {}) => ({ label, score: p.score, psnr: psnrOf(p), feasible: p.feasible, ...extra });
const step = (ctx, s) => ctx.steps?.push(s);

/** Sequencial: grupos na ordem do código, multiplicações primeiro; em cada um, a candidata de menor custo viável. */
function sequential(v, groups, ctx) {
    const order = groups.map((g, i) => i).sort((a, b) => (groups[a].cls === groups[b].cls ? 0 : groups[a].cls === 'mul' ? -1 : 1) || groups[a].line - groups[b].line);
    const choice = groups.map((g) => g.exact);
    let cur = evaluate(v, expand(groups, choice), ctx);
    const trace = [cur];
    step(ctx, { kind: 'start', state: stateOf(cur), order: order.map((i) => groups[i].label) });
    for (const i of order) {
        let best = cur, bestU = choice[i];
        const tries = [];
        for (const u of groups[i].cands) {
            if (u === choice[i]) continue;
            const c = [...choice];
            c[i] = u;
            const p = evaluate(v, expand(groups, c), ctx);
            tries.push(tryOf(p, u));
            if (p.feasible && p.score < best.score) { best = p; bestU = u; }
        }
        const changed = bestU !== choice[i];
        if (changed) { choice[i] = bestU; cur = best; trace.push(cur); }
        step(ctx, { kind: 'seq', group: groups[i].label, ops: groups[i].ops.length, tries, chosen: changed ? bestU : null, keep: groups[i].exact, state: stateOf(cur) });
    }
    return { best: cur, trace };
}

/**
 * Eficiência: a troca com a maior economia por aumento de erro, até não haver troca que economize.
 *
 * Avaliação preguiçosa (lazy greedy): cada troca guarda a eficiência da última vez em que foi avaliada; a cada passo,
 * as refresh trocas de maior valor guardado (no mínimo) são reavaliadas no estado atual, e a melhor delas é aplicada
 * quando nenhuma guardada passa dela. As trocas do grupo que mudou voltam a ser avaliadas com certeza. Supõe que a
 * eficiência de uma troca não cresce quando outras são aplicadas (retorno decrescente), o que vale aproximadamente;
 * com poucas trocas por passo (até fullBelow), a busca reavalia todas a cada passo, sem essa hipótese.
 */
function efficiency(v, groups, ctx, { granularity, fullBelow = 400, refresh = 40 }) {
    let choice = groups.map((g) => g.exact);
    let cur = evaluate(v, expand(groups, choice), ctx);
    const trace = [cur];
    // Trocas de classe inteira (com grupos menores que a classe).
    const classes = granularity === 'class' ? [] : [...new Set(groups.map((g) => `${g.cls}${g.W}`))].map((k) => {
        const idx = groups.map((g, i) => i).filter((i) => `${groups[i].cls}${groups[i].W}` === k);
        const cands = groups[idx[0]].cands.filter((u) => idx.every((i) => groups[i].cands.includes(u)));
        return { idx, cands, label: k };
    });
    const moves = [];
    groups.forEach((g, i) => { for (const u of g.cands) moves.push({ idx: [i], u, label: `${g.label} → ${u}` }); });
    for (const cl of classes) for (const u of cl.cands) moves.push({ idx: cl.idx, u, label: `${cl.label} (classe inteira) → ${u}` });
    const target = (m) => { const c = [...choice]; for (const i of m.idx) c[i] = m.u; return c; };
    const noop = (m) => m.idx.every((i) => choice[i] === m.u);
    let tries = [], skipped = 0;
    /** Eficiência da troca no estado atual (null se não economiza ou viola a restrição). */
    const rate = (m) => {
        const c = target(m), a = expand(groups, c);
        if (cur.score - costOnly(v, a, ctx) <= 1e-12) { skipped++; return null; }
        const p = evaluate(v, a, ctx);
        const ds = cur.score - p.score;
        const de = p.err - cur.err;
        const eff = de <= 1e-15 ? 1e15 + ds : ds / de;
        tries.push(tryOf(p, m.label, { eff: p.feasible && ds > 1e-12 ? eff : null }));
        if (!p.feasible || ds <= 1e-12) return null;
        return { eff, p, c, ds, de };
    };
    const lazy = moves.length > fullBelow;
    step(ctx, { kind: 'start', state: stateOf(cur), moves: moves.length, lazy, refresh });
    let entries = moves.map((m) => ({ m, eff: Infinity }));
    for (let it = 0; it < 2000; it++) {
        let taken = null;
        tries = []; skipped = 0;
        if (!lazy) {
            for (const e of entries) {
                if (noop(e.m)) continue;
                const r = rate(e.m);
                if (r && (!taken || r.eff > taken.eff)) taken = { ...r, m: e.m };
            }
        } else {
            entries = entries.filter((e) => !noop(e.m));
            entries.sort((x, y) => y.eff - x.eff);
            // Reavalia as trocas do topo (pelo menos refresh delas) até a melhor reavaliada passar a maior guardada.
            const fresh = [];
            let k = 0;
            while (k < entries.length) {
                const e = entries[k];
                const best = fresh.reduce((mx, x) => (x.eff > mx ? x.eff : mx), -Infinity);
                if (fresh.length >= refresh && best >= e.eff) break;
                const r = rate(e.m);
                if (!r) { entries.splice(k, 1); continue; }
                e.eff = r.eff;
                fresh.push({ ...r, m: e.m });
                k++;
            }
            for (const f of fresh) if (!taken || f.eff > taken.eff) taken = f;
        }
        if (!taken) { step(ctx, { kind: 'effEnd', tries, skipped, state: stateOf(cur) }); break; }
        choice = taken.c;
        cur = taken.p;
        trace.push(cur);
        step(ctx, { kind: 'eff', n: it + 1, tries, skipped, chosen: taken.m.label, ds: taken.ds, de: taken.de, eff: taken.eff, zeroErr: taken.de <= 1e-15, state: stateOf(cur) });
        if (lazy) {
            // As trocas dos grupos que mudaram (inclusive as descartadas) são reavaliadas no próximo passo.
            const changed = new Set(taken.m.idx);
            const live = new Set(entries.map((e) => e.m));
            for (const m of moves) {
                if (!m.idx.some((i) => changed.has(i))) continue;
                if (live.has(m)) entries.find((e) => e.m === m).eff = Infinity;
                else entries.push({ m, eff: Infinity });
            }
        }
    }
    return { best: cur, trace };
}

/** Exaustiva com poda, em ordem de custo. */
function exhaustive(v, groups, ctx, { maxCombos = 20000, frontEvals = 3000 }) {
    const exact = evaluate(v, expand(groups, groups.map((g) => g.exact)), ctx);
    step(ctx, { kind: 'start', state: stateOf(exact) });
    // Poda: em cada grupo, as unidades (em ordem de erro próprio) até a primeira que sozinha já viola a restrição.
    const lists = groups.map((g, i) => {
        const keep = [g.exact];
        const tries = [];
        let cut = null;
        for (const u of g.cands) {
            if (u === g.exact) continue;
            const c = groups.map((h) => h.exact);
            c[i] = u;
            const p = evaluate(v, expand(groups, c), ctx);
            tries.push(tryOf(p, u));
            if (!p.feasible) { cut = u; break; }
            keep.push(u);
        }
        step(ctx, { kind: 'prune', group: g.label, tries, kept: keep.length, of: g.cands.length, cut, state: stateOf(exact) });
        return keep;
    });
    const total = lists.reduce((s, l) => s * l.length, 1);
    if (total > maxCombos) {
        step(ctx, { kind: 'exhStop', total, max: maxCombos, state: stateOf(exact) });
        throw new Error(`exaustiva: ${total} combinações depois da poda (limite ${maxCombos}); use outra heurística ou grupos por classe`);
    }
    // Custo de todas (síntese, rápida); erro em ordem de custo.
    const combos = [];
    const rec = (i, c) => {
        if (i === lists.length) { combos.push([...c]); return; }
        for (const u of lists[i]) { c.push(u); rec(i + 1, c); c.pop(); }
    };
    rec(0, []);
    const costed = combos.map((c) => {
        const a = expand(groups, c);
        const r = synthesize(v.src, { ...v.syn, design: v.design, assign: a });
        return { c, score: ctx.score(costOf(r)) };
    }).sort((a, b) => a.score - b.score);
    step(ctx, { kind: 'order', total, state: stateOf(exact) });
    let best = null;
    const limit = Math.min(costed.length, frontEvals);
    const label = (c) => c.map((u, i) => (u === groups[i].exact ? null : `${groups[i].label}: ${u}`)).filter(Boolean).join(', ') || 'exato';
    let batch = [];
    for (let k = 0; k < costed.length; k++) {
        if (best && k >= limit) break;
        const p = evaluate(v, expand(groups, costed[k].c), ctx);
        batch.push(tryOf(p, label(costed[k].c)));
        const first = !best && p.feasible;
        if (first) best = p;
        if (first || batch.length === 10 || k === costed.length - 1) {
            step(ctx, { kind: 'exh', from: k + 2 - batch.length, to: k + 1, total, tries: batch, found: first ? label(costed[k].c) : null, state: stateOf(best ?? exact) });
            batch = [];
        }
    }
    return { best: best ?? exact, trace: [], combos: total };
}

/** Aleatória: amostras com semente fixa (cada grupo exato com probabilidade 1/3, senão uma candidata qualquer). */
function random(v, groups, ctx, { samples = 200, seed = 11 }) {
    const rand = rng(seed);
    let best = evaluate(v, expand(groups, groups.map((g) => g.exact)), ctx);
    step(ctx, { kind: 'start', state: stateOf(best) });
    let batch = [];
    for (let s = 0; s < samples; s++) {
        const c = groups.map((g) => (rand() < 1 / 3 ? g.exact : g.cands[Math.floor(rand() * g.cands.length)]));
        const p = evaluate(v, expand(groups, c), ctx);
        batch.push(tryOf(p, p.units.join(', ')));
        if (p.feasible && p.score < best.score) best = p;
        if (batch.length === 20 || s === samples - 1) { step(ctx, { kind: 'rnd', from: s + 2 - batch.length, to: s + 1, total: samples, tries: batch, state: stateOf(best) }); batch = []; }
    }
    return { best, trace: [] };
}

const RUN = { sequential, efficiency, exhaustive, random };

/** Fronteira de Pareto (custo do objetivo contra erro) entre os pontos avaliados. */
export function paretoPoints(points) {
    const sorted = [...points].sort((a, b) => a.score - b.score || a.err - b.err);
    const front = [];
    let minErr = Infinity;
    for (const p of sorted) if (p.err < minErr - 1e-18) { front.push(p); minErr = p.err; }
    return front;
}

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
 * @param {object} o synth, cells, flow, ports, input, method; clocks (lista de períodos em ns); directives (variar as
 *   diretivas); objective, weights, constraint {metric, value}; granularity; heuristic (ou 'all' para comparar);
 *   allUnits; samples, seed (aleatória); maxVerify; verifyFront (quantos pontos da fronteira verificar); progress(n)
 */
export function explore(src, o = {}) {
    const t0 = Date.now();
    const clocks = o.clocks?.length ? o.clocks : [5];
    const variants = o.directives ? pragmaVariants(src) : [{ code: src, label: 'diretivas do código', off: [] }];
    const heuristics = o.heuristic === 'all' ? HEURISTICS : [o.heuristic ?? 'efficiency'];
    const ok = constraintFn(o.constraint);
    const prepared = [];
    for (const vv of variants) for (const clk of clocks) {
        try {
            prepared.push(prepare(vv.code, { ...o, clockNs: clk, label: `${vv.label}, ${clk} ns` }));
        } catch (e) {
            prepared.push({ label: `${vv.label}, ${clk} ns`, error: e.message });
        }
    }
    const good = prepared.filter((v) => !v.error);
    const prepMs = Date.now() - t0;
    if (!good.length) throw new Error(prepared[0]?.error ?? 'nenhuma variante');
    const ref = costOf(good[0].base);
    const score = scoreFn(o.objective ?? 'area', o.weights, ref);
    const runs = [];
    // Candidatas de cada variante (o erro próprio das unidades sobre os operandos), antes das heurísticas.
    const t2 = Date.now();
    for (const v of good) v.groups = groupsOf(v, o);
    const candMs = Date.now() - t2;
    for (const h of heuristics) {
        const t1 = Date.now();
        const ctx = { score, ok, points: [], progress: o.progress, maxRows: o.maxRows, steps: [] };
        let best = null;
        const traces = [], last = [];
        for (const v of good) {
            v.cache = new Map(); // cada heurística conta as suas avaliações
            v.costCache ??= new Map();
            const groups = v.groups;
            if (good.length > 1) step(ctx, { kind: 'variant', label: v.label, groups: groups.length });
            if (!groups.length) { evaluate(v, new Map(), ctx); continue; }
            let res;
            try { res = RUN[h](v, groups, ctx, { granularity: o.granularity ?? 'class', ...o }); } catch (e) { traces.push({ variant: v.label, error: e.message }); continue; }
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
            step(ctx, { kind: 'verify', n: tries, label: p.units.join(', '), variant: p.variant, score: p.score, psnr: psnrOf(p), measured: Math.min(...p.measured.map((m) => m.PSNR)), ok: p.measuredOk, state: stateOf(p) });
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
        estimated: p.outs.map((x) => ({ array: x.array, ME: x.ME, MSE: x.MSE, PSNR: x.PSNR })), feasible: p.feasible,
        measured: p.measured ?? null, measuredOk: p.measuredOk ?? null,
        savings: ref ? { area: 1 - p.cost.area / ref.area, energy: 1 - p.cost.energy / ref.energy, latency: 1 - p.cost.latency / ref.latency } : null,
    };
}
