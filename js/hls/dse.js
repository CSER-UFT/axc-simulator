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
import { rng } from '../axc/metrics.js';
import { outputSsimStats } from './exec.js';

export const OBJECTIVES = ['area', 'luts', 'energy', 'latency', 'interval', 'weighted'];
export const HEURISTICS = ['sequential', 'efficiency', 'exhaustive', 'random', 'local', 'tabu', 'grasp', 'ga'];
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
    const p = { variant: v.label, clockNs: v.clockNs, key, assign: new Map(r.assign), units: r.cost.units.map((u) => `${u.count} × ${u.unit.name}`), cost, score: ctx.score(cost), outs, err: (ctx.errOf ?? errScalar)(outs), feasible: ctx.ok(outs), v };
    v.cache.set(key, p);
    v.evals++;
    ctx.points.push(p);
    ctx.progress?.(ctx.points.length);
    return p;
}

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

// Heurísticas de melhoria -----------------------------------------------------------------------------------------
// A busca local, a tabu, o GRASP e o genético trabalham com uma escolha por grupo (choice[i] = unidade). O ponto de
// partida, com grupos menores que a classe, é o ótimo por classe (a exaustiva nos grupos de classe, que cabe sem
// poda nos kernels de exemplo) levado para os grupos: a busca nunca termina pior que ele.

/** Avalia uma escolha por grupo, guardando a escolha no ponto. */
function evalChoice(v, groups, c, ctx) {
    const p = evaluate(v, expand(groups, c), ctx);
    p.choice ??= [...c];
    return p;
}
const costChoice = (v, groups, c, ctx) => costOnly(v, expand(groups, c), ctx);
const labelOf = (groups, i, u) => `${groups[i].label} → ${u}`;

/** Escolha por grupo de um ponto avaliado (a unidade da primeira operação de cada grupo). */
const choiceOf = (groups, p) => groups.map((g) => p.assign.get(g.ops[0].id) ?? g.exact);

/**
 * Ponto de partida: o melhor viável entre o ótimo por classe levado para os grupos (com grupos menores que a classe)
 * e o resultado da eficiência. Assim as heurísticas de melhoria nunca terminam pior que nenhum dos dois.
 */
function seedOf(v, groups, ctx, o) {
    const exact = evalChoice(v, groups, groups.map((g) => g.exact), ctx);
    const seeds = [exact];
    const quiet = { ...ctx, steps: null };
    if ((o.granularity ?? 'class') !== 'class') {
        v.classGroups ??= groupsOf(v, { ...o, granularity: 'class' });
        const cg = v.classGroups;
        if (cg.reduce((s, g) => s * g.cands.length, 1) <= 20000) {
            const r = exhaustive(v, cg, quiet, { maxCombos: 20000, frontEvals: 1 });
            const unitOf = new Map();
            cg.forEach((g) => { for (const op of g.ops) unitOf.set(op.id, r.best.assign.get(op.id) ?? g.exact); });
            const c = groups.map((g) => {
                const u = unitOf.get(g.ops[0].id) ?? g.exact;
                return g.ops.every((op) => (unitOf.get(op.id) ?? g.exact) === u) ? u : g.exact;
            });
            seeds.push(evalChoice(v, groups, c, ctx));
        }
    }
    const e = efficiency(v, groups, quiet, { granularity: o.granularity ?? 'class' }).best;
    seeds.push(evalChoice(v, groups, choiceOf(groups, e), ctx));
    // Os pontos de partida viáveis e distintos: partir de cada um alcança ótimos locais diferentes (no FIR por
    // operação, a busca local a partir do ótimo por classe chega a 48% de economia, e a partir da eficiência, a 45%).
    const list = [...new Map(seeds.filter((p) => p.feasible).map((p) => [p.key, p])).values()].sort((a, b) => a.score - b.score);
    if (!list.length) list.push(exact);
    step(ctx, { kind: 'seed', state: stateOf(list[0]), units: list[0].units, n: list.length, feasible: true });
    return list;
}

/** Trocas de um grupo: todas as candidatas e a exata (nas duas direções de custo). */
const optionsOf = (g, cur) => [...new Set([g.exact, ...g.cands, cur])];

/**
 * Busca local a partir de um ponto: (1) as trocas de um grupo que reduzem o custo, em ordem de custo, até a primeira
 * viável; (2) sem nenhuma, os pares: uma troca que economiza mas viola, com outra, noutro grupo, que reduz o erro
 * (unidade de erro próprio menor, inclusive a exata) e mantém o custo total abaixo do atual.
 */
function improve(v, groups, ctx, start, { maxEvals = 1500, top = 12, h = 'local' } = {}) {
    let cur = start;
    const e0 = v.evals;
    for (let it = 1; v.evals - e0 < maxEvals; it++) {
        const tries = [];
        const down = [];
        groups.forEach((g, i) => {
            for (const u of optionsOf(g, cur.choice[i])) {
                if (u === cur.choice[i]) continue;
                const c = [...cur.choice]; c[i] = u;
                const k = costChoice(v, groups, c, ctx);
                if (k < cur.score - 1e-9) down.push({ c, k, i, u });
            }
        });
        down.sort((a, b) => a.k - b.k);
        let next = null, how = null;
        const tried = [];
        for (const m of down) {
            if (v.evals - e0 >= maxEvals) break;
            const p = evalChoice(v, groups, m.c, ctx);
            tries.push(tryOf(p, labelOf(groups, m.i, m.u)));
            tried.push({ ...m, p });
            if (p.feasible) { next = p; how = labelOf(groups, m.i, m.u); break; }
        }
        if (!next) {
            // Pares: as trocas que economizam mais (e violam) com uma troca que devolve erro noutro grupo.
            const pairs = [];
            for (const m of tried.slice(0, top)) {
                groups.forEach((g, j) => {
                    if (j === m.i) return;
                    const own = g.ownOf.get(m.c[j]) ?? (m.c[j] === g.exact ? 0 : Infinity);
                    for (const w of optionsOf(g, m.c[j])) {
                        if (w === m.c[j]) continue;
                        if ((g.ownOf.get(w) ?? (w === g.exact ? 0 : Infinity)) >= own) continue;
                        const c = [...m.c]; c[j] = w;
                        const k = costChoice(v, groups, c, ctx);
                        if (k < cur.score - 1e-9) pairs.push({ c, k, lbl: `${labelOf(groups, m.i, m.u)} + ${labelOf(groups, j, w)}` });
                    }
                });
            }
            pairs.sort((a, b) => a.k - b.k);
            for (const m of pairs) {
                if (v.evals - e0 >= maxEvals) break;
                const p = evalChoice(v, groups, m.c, ctx);
                tries.push(tryOf(p, m.lbl));
                if (p.feasible) { next = p; how = m.lbl; break; }
            }
        }
        step(ctx, { kind: 'imp', h, n: it, tries, chosen: how, state: stateOf(next ?? cur) });
        if (!next) break;
        cur = next;
    }
    return cur;
}

/** Busca local a partir do ótimo por classe. */
function local(v, groups, ctx, o) {
    let best = null;
    for (const s0 of seedOf(v, groups, ctx, o)) {
        const p = improve(v, groups, ctx, s0, { maxEvals: o.maxEvals ?? 2000 });
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
function tabu(v, groups, ctx, o) {
    const iters = o.tabuIters ?? 40, width = o.tabuWidth ?? 16, tenure = o.tenure ?? Math.max(3, Math.min(7, Math.ceil(groups.length / 3)));
    let best = null;
    for (const s0 of seedOf(v, groups, ctx, o)) {
    let cur = s0, runBest = s0;
    const tabuUntil = new Map();
    for (let it = 1; it <= iters; it++) {
        const moves = [];
        groups.forEach((g, i) => {
            for (const u of optionsOf(g, cur.choice[i])) {
                if (u === cur.choice[i]) continue;
                const c = [...cur.choice]; c[i] = u;
                moves.push({ c, i, u, k: costChoice(v, groups, c, ctx) });
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
            const p = evalChoice(v, groups, m.c, ctx);
            tries.push(tryOf(p, labelOf(groups, m.i, m.u)));
            if (p.feasible && (!pick || p.score < pick.p.score)) pick = { p, m };
            if (!fallback || p.err < fallback.p.err) fallback = { p, m };
        }
        const go = pick ?? fallback;
        if (!go) break;
        cur = go.p;
        tabuUntil.set(go.m.i, it + tenure);
        if (cur.feasible && cur.score < runBest.score) runBest = cur;
        step(ctx, { kind: 'imp', h: 'tabu', n: it, tries, chosen: labelOf(groups, go.m.i, go.m.u), state: stateOf(runBest) });
    }
    runBest = improve(v, groups, ctx, runBest, { maxEvals: 400 });
    if (!best || runBest.score < best.score) best = runBest;
    }
    return { best, trace: [] };
}

/**
 * GRASP: construções gulosas aleatorizadas, cada uma seguida de busca local. Na construção, os grupos em ordem
 * sorteada; em cada um, as trocas que economizam mais (lista restrita de candidatas, as alpha mais baratas que
 * mantêm a restrição), e uma delas sorteada.
 */
function grasp(v, groups, ctx, o) {
    const rand = rng(o.seed ?? 11), iters = o.graspIters ?? 6, alpha = o.alpha ?? 3;
    let best = null;
    for (const s0 of seedOf(v, groups, ctx, o)) {
        const p = improve(v, groups, ctx, s0, { maxEvals: 300, h: 'grasp' });
        if (!best || p.score < best.score) best = p;
    }
    for (let it = 1; it <= iters; it++) {
        let cur = evalChoice(v, groups, groups.map((g) => g.exact), ctx);
        const order = groups.map((g, i) => i).sort(() => rand() - 0.5);
        const tries = [];
        for (const i of order) {
            const opts = groups[i].cands.filter((u) => u !== cur.choice[i]).map((u) => { const c = [...cur.choice]; c[i] = u; return { c, u, k: costChoice(v, groups, c, ctx) }; }).filter((m) => m.k < cur.score).sort((a, b) => a.k - b.k);
            const rcl = [];
            for (const m of opts) {
                if (rcl.length >= alpha) break;
                const p = evalChoice(v, groups, m.c, ctx);
                tries.push(tryOf(p, labelOf(groups, i, m.u)));
                if (p.feasible) rcl.push(p);
            }
            if (rcl.length) cur = rcl[Math.floor(rand() * rcl.length)];
        }
        step(ctx, { kind: 'imp', h: 'graspBuild', n: it, tries, chosen: null, state: stateOf(cur) });
        cur = improve(v, groups, ctx, cur, { maxEvals: 300, h: 'grasp' });
        if (cur.feasible && cur.score < best.score) best = cur;
    }
    return { best, trace: [] };
}

/**
 * Algoritmo genético: um gene por grupo (a unidade). População inicial com o ótimo por classe, o exato e escolhas
 * sorteadas; seleção por torneio com as regras de viabilidade (viável ganha de inviável; entre viáveis, o mais barato;
 * entre inviáveis, o de menor erro), cruzamento uniforme, mutação de um gene com probabilidade 1/n e elitismo.
 * Termina com uma busca local no melhor viável.
 */
function ga(v, groups, ctx, o) {
    const rand = rng(o.seed ?? 11), size = o.popSize ?? 24, gens = o.generations ?? 30, n = groups.length;
    const better = (a, b) => (a.feasible !== b.feasible ? a.feasible : a.feasible ? a.score < b.score : a.err < b.err);
    const randomGene = (i) => (rand() < 0.3 ? groups[i].exact : groups[i].cands[Math.floor(rand() * groups[i].cands.length)]);
    const seeds = seedOf(v, groups, ctx, o), seed = seeds[0];
    let pop = [...seeds, evalChoice(v, groups, groups.map((g) => g.exact), ctx)];
    while (pop.length < size) {
        const base = seeds[pop.length % seeds.length];
        const c = base.choice.map((u, i) => (rand() < 0.5 ? u : randomGene(i)));
        pop.push(evalChoice(v, groups, c, ctx));
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
            const p = evalChoice(v, groups, c, ctx);
            tries.push(tryOf(p, p.units.join(', ')));
            next.push(p);
        }
        pop = next;
        for (const p of pop) if (p.feasible && p.score < best.score) best = p;
        step(ctx, { kind: 'imp', h: 'ga', n: g, tries, chosen: null, state: stateOf(best) });
    }
    best = improve(v, groups, ctx, best, { maxEvals: 400 });
    return { best, trace: [] };
}

const RUN = { sequential, efficiency, exhaustive, random, local, tabu, grasp, ga };

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
        const ctx = { score, ok, errOf: errScalarOf(o.constraint?.metric), points: [], progress: o.progress, maxRows: o.maxRows, steps: [] };
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
        estimated: p.outs.map((x) => ({ array: x.array, ME: x.ME, MSE: x.MSE, PSNR: x.PSNR, SSIM: x.SSIM ?? null })), feasible: p.feasible,
        measured: p.measured ?? null, measuredOk: p.measuredOk ?? null,
        savings: ref ? { area: 1 - p.cost.area / ref.area, energy: 1 - p.cost.energy / ref.energy, latency: 1 - p.cost.latency / ref.latency } : null,
    };
}
