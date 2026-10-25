/**
 * Heurísticas de busca de unidades aproximadas, independentes do que é avaliado (um kernel de HLS, uma rede neural).
 *
 * O problema P descreve o espaço: uma escolha é uma unidade por grupo (choice[i] é o nome da unidade do grupo i).
 *
 *   P.groups      [{ label, exact, cands, ownOf: Map(unidade → erro próprio), cls?, W?, line? }]; cands começa
 *                 pela exata e segue em ordem de erro próprio;
 *   P.key(c)      chave da escolha (escolhas com a mesma chave são o mesmo projeto);
 *   P.evaluate(c, key)  ponto avaliado: { score, err, feasible, units, ... } (custo do objetivo, erro escalar para
 *                 a eficiência e a fronteira, viabilidade na restrição);
 *   P.cost(c, key)      só o custo do objetivo (barato);
 *   P.mark(p)     campos do ponto que vão para o passo a passo (por exemplo { psnr } ou { drop });
 *   P.classSeed?(ctx, o)  uma escolha de partida a mais para as heurísticas de melhoria (ou null);
 *   P.seqOrder?   ordem dos grupos na sequencial (índices); sem ela, multiplicações antes das somas e, em cada
 *                 classe, a ordem das linhas.
 *
 * O contexto (newContext) guarda o cache de pontos por chave, a lista dos pontos avaliados (na ordem da avaliação),
 * o contador de avaliações e o passo a passo (steps) que as páginas animam. progress(n, p) é chamado a cada ponto
 * novo avaliado.
 */
import { rng } from './metrics.js';

export const HEURISTICS = ['sequential', 'efficiency', 'exhaustive', 'random', 'local', 'tabu', 'grasp', 'ga'];

/** Contexto de uma execução de heurística. */
export function newContext({ progress = null, steps = true } = {}) {
    return { points: [], steps: steps ? [] : null, cache: new Map(), counter: { n: 0 }, progress };
}

/** Avalia uma escolha (com cache), guardando a escolha no ponto. */
export function evalChoice(P, c, ctx) {
    const key = P.key(c);
    let p = ctx.cache.get(key);
    if (!p) {
        p = P.evaluate(c, key);
        p.key ??= key;
        ctx.cache.set(key, p);
        ctx.counter.n++;
        ctx.points.push(p);
        ctx.progress?.(ctx.points.length, p);
    }
    // A escolha é a do problema que avaliou por último (problemas com grupos diferentes podem dividir o cache).
    if (p.choiceP !== P) { p.choice = [...c]; p.choiceP = P; }
    return p;
}

/** Só o custo de uma escolha (o do ponto, se já avaliado). */
export function costChoice(P, c, ctx) {
    const key = P.key(c);
    const p = ctx.cache.get(key);
    return p ? p.score : P.cost(c, key);
}

const stateOf = (P, p) => ({ score: p.score, ...P.mark(p), units: p.units });
const tryOf = (P, p, label, extra = {}) => ({ label, score: p.score, ...P.mark(p), feasible: p.feasible, ...extra });
const step = (ctx, s) => ctx.steps?.push(s);
const exactChoice = (P) => P.groups.map((g) => g.exact);
const labelOf = (P, i, u) => `${P.groups[i].label} → ${u}`;

/** Sequencial: grupos na ordem do código, multiplicações primeiro; em cada um, a candidata de menor custo viável. */
function sequential(P, ctx) {
    const groups = P.groups;
    const order = P.seqOrder ?? groups.map((g, i) => i).sort((a, b) => (groups[a].cls === groups[b].cls ? 0 : groups[a].cls === 'mul' ? -1 : 1) || groups[a].line - groups[b].line);
    const choice = exactChoice(P);
    let cur = evalChoice(P, choice, ctx);
    const trace = [cur];
    step(ctx, { kind: 'start', state: stateOf(P, cur), order: order.map((i) => groups[i].label) });
    for (const i of order) {
        let best = cur, bestU = choice[i];
        const tries = [];
        for (const u of groups[i].cands) {
            if (u === choice[i]) continue;
            const c = [...choice];
            c[i] = u;
            const p = evalChoice(P, c, ctx);
            tries.push(tryOf(P, p, u));
            if (p.feasible && p.score < best.score) { best = p; bestU = u; }
        }
        const changed = bestU !== choice[i];
        if (changed) { choice[i] = bestU; cur = best; trace.push(cur); }
        step(ctx, { kind: 'seq', group: groups[i].label, ops: groups[i].ops?.length ?? 1, tries, chosen: changed ? bestU : null, keep: groups[i].exact, state: stateOf(P, cur) });
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
function efficiency(P, ctx, { granularity = 'class', fullBelow = 400, refresh = 40 } = {}) {
    const groups = P.groups;
    let choice = exactChoice(P);
    let cur = evalChoice(P, choice, ctx);
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
        const c = target(m);
        if (cur.score - costChoice(P, c, ctx) <= 1e-12) { skipped++; return null; }
        const p = evalChoice(P, c, ctx);
        const ds = cur.score - p.score;
        const de = p.err - cur.err;
        const eff = de <= 1e-15 ? 1e15 + ds : ds / de;
        tries.push(tryOf(P, p, m.label, { eff: p.feasible && ds > 1e-12 ? eff : null }));
        if (!p.feasible || ds <= 1e-12) return null;
        return { eff, p, c, ds, de };
    };
    const lazy = moves.length > fullBelow;
    step(ctx, { kind: 'start', state: stateOf(P, cur), moves: moves.length, lazy, refresh });
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
        if (!taken) { step(ctx, { kind: 'effEnd', tries, skipped, state: stateOf(P, cur) }); break; }
        choice = taken.c;
        cur = taken.p;
        trace.push(cur);
        step(ctx, { kind: 'eff', n: it + 1, tries, skipped, chosen: taken.m.label, ds: taken.ds, de: taken.de, eff: taken.eff, zeroErr: taken.de <= 1e-15, state: stateOf(P, cur) });
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
function exhaustive(P, ctx, { maxCombos = 20000, frontEvals = 3000 } = {}) {
    const groups = P.groups;
    const exact = evalChoice(P, exactChoice(P), ctx);
    step(ctx, { kind: 'start', state: stateOf(P, exact) });
    // Sem poda quando todas as combinações cabem no limite: a exaustiva é então o ótimo do modelo entre as candidatas.
    // Com mais, a poda: em cada grupo, as unidades (em ordem de erro próprio) até a primeira que sozinha já viola a
    // restrição. A poda é heurística, porque erros de sinais opostos se compensam (um somador truncado, que erra para
    // baixo, com um multiplicador com compensação, que erra para cima).
    const full = groups.reduce((s, g) => s * g.cands.length, 1);
    const lists = full <= maxCombos ? groups.map((g) => g.cands) : groups.map((g, i) => {
        const keep = [g.exact];
        const tries = [];
        let cut = null;
        for (const u of g.cands) {
            if (u === g.exact) continue;
            const c = exactChoice(P);
            c[i] = u;
            const p = evalChoice(P, c, ctx);
            tries.push(tryOf(P, p, u));
            if (!p.feasible) { cut = u; break; }
            keep.push(u);
        }
        step(ctx, { kind: 'prune', group: g.label, tries, kept: keep.length, of: g.cands.length, cut, state: stateOf(P, exact) });
        return keep;
    });
    const total = lists.reduce((s, l) => s * l.length, 1);
    if (total > maxCombos) {
        step(ctx, { kind: 'exhStop', total, max: maxCombos, state: stateOf(P, exact) });
        throw new Error(`exaustiva: ${total} combinações depois da poda (limite ${maxCombos}); use outra heurística ou grupos por classe`);
    }
    // Custo de todas (rápido); erro em ordem de custo.
    const combos = [];
    const rec = (i, c) => {
        if (i === lists.length) { combos.push([...c]); return; }
        for (const u of lists[i]) { c.push(u); rec(i + 1, c); c.pop(); }
    };
    rec(0, []);
    const costed = combos.map((c) => ({ c, score: costChoice(P, c, ctx) })).sort((a, b) => a.score - b.score);
    step(ctx, { kind: 'order', total, state: stateOf(P, exact) });
    let best = null;
    const limit = Math.min(costed.length, frontEvals);
    const label = (c) => c.map((u, i) => (u === groups[i].exact ? null : `${groups[i].label}: ${u}`)).filter(Boolean).join(', ') || 'exato';
    let batch = [];
    for (let k = 0; k < costed.length; k++) {
        if (best && k >= limit) break;
        const p = evalChoice(P, costed[k].c, ctx);
        batch.push(tryOf(P, p, label(costed[k].c)));
        const first = !best && p.feasible;
        if (first) best = p;
        if (first || batch.length === 10 || k === costed.length - 1) {
            step(ctx, { kind: 'exh', from: k + 2 - batch.length, to: k + 1, total, tries: batch, found: first ? label(costed[k].c) : null, state: stateOf(P, best ?? exact) });
            batch = [];
        }
    }
    return { best: best ?? exact, trace: [], combos: total };
}

/** Aleatória: amostras com semente fixa (cada grupo exato com probabilidade 1/3, senão uma candidata qualquer). */
function random(P, ctx, { samples = 200, seed = 11 } = {}) {
    const groups = P.groups;
    const rand = rng(seed);
    let best = evalChoice(P, exactChoice(P), ctx);
    step(ctx, { kind: 'start', state: stateOf(P, best) });
    let batch = [];
    for (let s = 0; s < samples; s++) {
        const c = groups.map((g) => (rand() < 1 / 3 ? g.exact : g.cands[Math.floor(rand() * g.cands.length)]));
        const p = evalChoice(P, c, ctx);
        batch.push(tryOf(P, p, p.units.join(', ')));
        if (p.feasible && p.score < best.score) best = p;
        if (batch.length === 20 || s === samples - 1) { step(ctx, { kind: 'rnd', from: s + 2 - batch.length, to: s + 1, total: samples, tries: batch, state: stateOf(P, best) }); batch = []; }
    }
    return { best, trace: [] };
}

// Heurísticas de melhoria -----------------------------------------------------------------------------------------
// A busca local, a tabu, o GRASP e o genético trabalham com uma escolha por grupo. Os pontos de partida são o exato,
// a escolha do problema (classSeed: na HLS, o ótimo por classe levado para os grupos) e o resultado da eficiência.

/**
 * Pontos de partida: os viáveis e distintos entre o exato, a escolha do problema e o resultado da eficiência. Partir
 * de cada um alcança ótimos locais diferentes (no FIR por operação, a busca local a partir do ótimo por classe chega a
 * 48% de economia, e a partir da eficiência, a 45%).
 */
function seedOf(P, ctx, o) {
    const exact = evalChoice(P, exactChoice(P), ctx);
    const seeds = [exact];
    const quiet = { ...ctx, steps: null };
    const cs = P.classSeed?.(quiet, o);
    if (cs) seeds.push(evalChoice(P, cs, ctx));
    const e = efficiency(P, quiet, { granularity: o.granularity ?? 'class' }).best;
    seeds.push(evalChoice(P, e.choice, ctx));
    const list = [...new Map(seeds.filter((p) => p.feasible).map((p) => [p.key, p])).values()].sort((a, b) => a.score - b.score);
    if (!list.length) list.push(exact);
    step(ctx, { kind: 'seed', state: stateOf(P, list[0]), units: list[0].units, n: list.length, feasible: true });
    return list;
}

/** Trocas de um grupo: todas as candidatas e a exata (nas duas direções de custo). */
const optionsOf = (g, cur) => [...new Set([g.exact, ...g.cands, cur])];
const ownOf = (g, u) => g.ownOf.get(u) ?? (u === g.exact ? 0 : Infinity);

/**
 * Busca local a partir de um ponto: (1) as trocas de um grupo que reduzem o custo, em ordem de custo, até a primeira
 * viável; (2) sem nenhuma, os pares: uma troca que economiza mas viola, com outra, noutro grupo, que reduz o erro
 * (unidade de erro próprio menor, inclusive a exata) e mantém o custo total abaixo do atual.
 */
function improve(P, ctx, start, { maxEvals = 1500, top = 12, h = 'local' } = {}) {
    const groups = P.groups;
    let cur = start;
    const e0 = ctx.counter.n;
    for (let it = 1; ctx.counter.n - e0 < maxEvals; it++) {
        const tries = [];
        const down = [];
        groups.forEach((g, i) => {
            for (const u of optionsOf(g, cur.choice[i])) {
                if (u === cur.choice[i]) continue;
                const c = [...cur.choice]; c[i] = u;
                const k = costChoice(P, c, ctx);
                if (k < cur.score - 1e-9) down.push({ c, k, i, u });
            }
        });
        down.sort((a, b) => a.k - b.k);
        let next = null, how = null;
        const tried = [];
        for (const m of down) {
            if (ctx.counter.n - e0 >= maxEvals) break;
            const p = evalChoice(P, m.c, ctx);
            tries.push(tryOf(P, p, labelOf(P, m.i, m.u)));
            tried.push({ ...m, p });
            if (p.feasible) { next = p; how = labelOf(P, m.i, m.u); break; }
        }
        if (!next) {
            // Pares: as trocas que economizam mais (e violam) com uma troca que devolve erro noutro grupo.
            const pairs = [];
            for (const m of tried.slice(0, top)) {
                groups.forEach((g, j) => {
                    if (j === m.i) return;
                    const own = ownOf(g, m.c[j]);
                    for (const w of optionsOf(g, m.c[j])) {
                        if (w === m.c[j]) continue;
                        if (ownOf(g, w) >= own) continue;
                        const c = [...m.c]; c[j] = w;
                        const k = costChoice(P, c, ctx);
                        if (k < cur.score - 1e-9) pairs.push({ c, k, lbl: `${labelOf(P, m.i, m.u)} + ${labelOf(P, j, w)}` });
                    }
                });
            }
            pairs.sort((a, b) => a.k - b.k);
            for (const m of pairs) {
                if (ctx.counter.n - e0 >= maxEvals) break;
                const p = evalChoice(P, m.c, ctx);
                tries.push(tryOf(P, p, m.lbl));
                if (p.feasible) { next = p; how = m.lbl; break; }
            }
        }
        step(ctx, { kind: 'imp', h, n: it, tries, chosen: how, state: stateOf(P, next ?? cur) });
        if (!next) break;
        cur = next;
    }
    return cur;
}

/** Busca local a partir de cada ponto de partida. */
function local(P, ctx, o) {
    let best = null;
    for (const s0 of seedOf(P, ctx, o)) {
        const p = improve(P, ctx, s0, { maxEvals: o.maxEvals ?? 2000 });
        if (!best || p.score < best.score) best = p;
    }
    return { best, trace: [] };
}

/**
 * Busca tabu: a cada iteração, entre as trocas de um grupo (as que economizam e as que encarecem), avalia as mais
 * baratas que não estão na lista tabu e vai para a melhor viável, mesmo que mais cara que a atual; sem nenhuma viável,
 * para a de menor erro. O grupo trocado fica tabu por algumas iterações (a não ser que a troca dê o melhor ponto até
 * ali). Termina com uma busca local no melhor ponto.
 */
function tabu(P, ctx, o) {
    const groups = P.groups;
    const iters = o.tabuIters ?? 40, width = o.tabuWidth ?? 16, tenure = o.tenure ?? Math.max(3, Math.min(7, Math.ceil(groups.length / 3)));
    let best = null;
    for (const s0 of seedOf(P, ctx, o)) {
        let cur = s0, runBest = s0;
        const tabuUntil = new Map();
        for (let it = 1; it <= iters; it++) {
            const moves = [];
            groups.forEach((g, i) => {
                for (const u of optionsOf(g, cur.choice[i])) {
                    if (u === cur.choice[i]) continue;
                    const c = [...cur.choice]; c[i] = u;
                    moves.push({ c, i, u, k: costChoice(P, c, ctx) });
                }
            });
            moves.sort((a, b) => a.k - b.k);
            const tries = [];
            let pick = null, fallback = null, n = 0;
            for (const m of moves) {
                if (n >= width) break;
                const isTabu = (tabuUntil.get(m.i) ?? 0) >= it;
                if (isTabu && m.k >= Math.min(runBest.score, best?.score ?? Infinity) - 1e-9) continue;
                n++;
                const p = evalChoice(P, m.c, ctx);
                tries.push(tryOf(P, p, labelOf(P, m.i, m.u)));
                if (p.feasible && (!pick || p.score < pick.p.score)) pick = { p, m };
                if (!fallback || p.err < fallback.p.err) fallback = { p, m };
            }
            const go = pick ?? fallback;
            if (!go) break;
            cur = go.p;
            tabuUntil.set(go.m.i, it + tenure);
            if (cur.feasible && cur.score < runBest.score) runBest = cur;
            step(ctx, { kind: 'imp', h: 'tabu', n: it, tries, chosen: labelOf(P, go.m.i, go.m.u), state: stateOf(P, runBest) });
        }
        runBest = improve(P, ctx, runBest, { maxEvals: 400 });
        if (!best || runBest.score < best.score) best = runBest;
    }
    return { best, trace: [] };
}

/**
 * GRASP: construções gulosas aleatorizadas, cada uma seguida de busca local. Na construção, os grupos em ordem
 * sorteada; em cada um, as trocas que economizam mais (lista restrita de candidatas, as alpha mais baratas que
 * mantêm a restrição), e uma delas sorteada.
 */
function grasp(P, ctx, o) {
    const groups = P.groups;
    const rand = rng(o.seed ?? 11), iters = o.graspIters ?? 6, alpha = o.alpha ?? 3;
    let best = null;
    for (const s0 of seedOf(P, ctx, o)) {
        const p = improve(P, ctx, s0, { maxEvals: 300, h: 'grasp' });
        if (!best || p.score < best.score) best = p;
    }
    for (let it = 1; it <= iters; it++) {
        let cur = evalChoice(P, exactChoice(P), ctx);
        const order = groups.map((g, i) => i).sort(() => rand() - 0.5);
        const tries = [];
        for (const i of order) {
            const opts = groups[i].cands.filter((u) => u !== cur.choice[i]).map((u) => { const c = [...cur.choice]; c[i] = u; return { c, u, k: costChoice(P, c, ctx) }; }).filter((m) => m.k < cur.score).sort((a, b) => a.k - b.k);
            const rcl = [];
            for (const m of opts) {
                if (rcl.length >= alpha) break;
                const p = evalChoice(P, m.c, ctx);
                tries.push(tryOf(P, p, labelOf(P, i, m.u)));
                if (p.feasible) rcl.push(p);
            }
            if (rcl.length) cur = rcl[Math.floor(rand() * rcl.length)];
        }
        step(ctx, { kind: 'imp', h: 'graspBuild', n: it, tries, chosen: null, state: stateOf(P, cur) });
        cur = improve(P, ctx, cur, { maxEvals: 300, h: 'grasp' });
        if (cur.feasible && cur.score < best.score) best = cur;
    }
    return { best, trace: [] };
}

/**
 * Algoritmo genético: um gene por grupo (a unidade). População inicial com os pontos de partida, o exato e escolhas
 * sorteadas; seleção por torneio com as regras de viabilidade (viável ganha de inviável; entre viáveis, o mais barato;
 * entre inviáveis, o de menor erro), cruzamento uniforme, mutação de um gene com probabilidade 1/n e elitismo.
 * Termina com uma busca local no melhor viável.
 */
function ga(P, ctx, o) {
    const groups = P.groups;
    const rand = rng(o.seed ?? 11), size = o.popSize ?? 24, gens = o.generations ?? 30, n = groups.length;
    const better = (a, b) => (a.feasible !== b.feasible ? a.feasible : a.feasible ? a.score < b.score : a.err < b.err);
    const randomGene = (i) => (rand() < 0.3 ? groups[i].exact : groups[i].cands[Math.floor(rand() * groups[i].cands.length)]);
    const seeds = seedOf(P, ctx, o), seed = seeds[0];
    let pop = [...seeds, evalChoice(P, exactChoice(P), ctx)];
    while (pop.length < size) {
        const base = seeds[pop.length % seeds.length];
        const c = base.choice.map((u, i) => (rand() < 0.5 ? u : randomGene(i)));
        pop.push(evalChoice(P, c, ctx));
    }
    const pickOne = () => { const a = pop[Math.floor(rand() * pop.length)], b = pop[Math.floor(rand() * pop.length)]; return better(a, b) ? a : b; };
    let best = pop.filter((p) => p.feasible).sort((a, b) => a.score - b.score)[0] ?? seed;
    for (let g = 1; g <= gens; g++) {
        const sorted = [...pop].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
        const next = sorted.slice(0, 2);
        const tries = [];
        while (next.length < size) {
            const a = pickOne(), b = pickOne();
            const c = a.choice.map((u, i) => (rand() < 0.5 ? u : b.choice[i]));
            for (let i = 0; i < n; i++) if (rand() < 1 / n) c[i] = randomGene(i);
            const p = evalChoice(P, c, ctx);
            tries.push(tryOf(P, p, p.units.join(', ')));
            next.push(p);
        }
        pop = next;
        for (const p of pop) if (p.feasible && p.score < best.score) best = p;
        step(ctx, { kind: 'imp', h: 'ga', n: g, tries, chosen: null, state: stateOf(P, best) });
    }
    best = improve(P, ctx, best, { maxEvals: 400 });
    return { best, trace: [] };
}

const RUN = { sequential, efficiency, exhaustive, random, local, tabu, grasp, ga };

/** Executa uma heurística no problema P com o contexto ctx; devolve { best, trace }. */
export function runHeuristic(h, P, ctx, o = {}) {
    if (!RUN[h]) throw new Error(`heurística desconhecida: ${h}`);
    return RUN[h](P, ctx, o);
}

/** Fronteira de Pareto (custo do objetivo contra erro) entre pontos avaliados. */
export function paretoPoints(points) {
    const sorted = [...points].sort((a, b) => a.score - b.score || a.err - b.err);
    const front = [];
    let minErr = Infinity;
    for (const p of sorted) if (p.err < minErr - 1e-18) { front.push(p); minErr = p.err; }
    return front;
}
