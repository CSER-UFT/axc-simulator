/**
 * Modelo estático de erro: viés (média) e variância do erro de cada valor do DFG, propagados das unidades
 * aproximadas até as saídas, sem executar o kernel aproximado.
 *
 * O erro de um valor é e = aproximado - exato. Cada nó guarda E[e] e E[e^2]. As estatísticas dos sinais (média e
 * segundo momento de cada valor exato, amostras dos operandos) vêm de uma execução exata (o perfil, exec.js); a
 * propagação supõe os erros independentes entre si e dos sinais, a não ser onde o mesmo valor entra duas vezes.
 *
 *   unidade      erro próprio de cada operação aproximada: média e segundo momento de f(x, y) - (x op y) sobre as
 *                amostras dos operandos daquela operação (não sobre operandos uniformes: o mesmo multiplicador erra
 *                diferente com coeficiente 19 e com 52);
 *   soma         e = ea +- eb + eu;
 *   produto      e = a eb + b ea + ea eb + eu, com os momentos de a e b do perfil (com constante: e = c ea + eu);
 *   x >> k       com S = 2^k e o resto de x por S uniforme: E[saída] = E[e] / S, e a variância ganha E[p (1 - p)],
 *                p = (e mod S) / S (o arredondamento para baixo), calculado sobre a distribuição normal de e;
 *   x % 2^k      E[saída] = 0 e E[saída^2] = E[q (S - q)], q = e mod S;
 *   comparação   a probabilidade de o resultado trocar, para cada amostra, com a diferença dos operandos e o erro da
 *                diferença (normal); a seleção (min, max, abs, ?:) mistura o erro do lado escolhido e, quando a
 *                decisão troca, a distância até o outro lado;
 *   recorrência  o erro do acumulador evolui como e(t+1) = g e(t) + d, com o ganho g e o incremento d medidos no
 *                corpo do laço; os usos dentro do laço veem a média sobre as iterações e os de depois, o valor final;
 *   memória      cada vetor guarda a média dos erros escritos nele (pesada pelas execuções), que as leituras veem.
 * Lógica bit a bit fora as máscaras passa o erro adiante sem modelo (marcado), e truncamentos de tipo são tratados
 * como sem estouro.
 */
import { ssimEstimate, ssimEstimateBins, SSIM_BINS } from '../axc/ssim.js';
import { outputArrays, compile, wrapTo, bit, CMP, execute, compareOutputs, outputSsimStats } from './exec.js';
import { rng } from '../axc/metrics.js';
import { opFunction } from './approx.js';
import { typeRange, requantValue } from './elab.js';

const ZERO = { mu: 0, m2: 0 };
const varOf = (s) => Math.max(0, s.m2 - s.mu * s.mu);

/** Função de distribuição da normal padrão (Abramowitz e Stegun 7.1.26, erro menor que 1,5e-7). */
export function Phi(z) {
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** E[f(e mod S)] para e inteiro, com média mu e variância v (normal discretizada). */
function expectMod(mu, v, S, f) {
    const mod = (e) => ((e % S) + S) % S;
    const sd = Math.sqrt(v);
    if (sd < 1e-9) {
        // Sem dispersão: e é o inteiro mais próximo da média, ou uma mistura dos dois vizinhos.
        const lo = Math.floor(mu), fr = mu - lo;
        return (1 - fr) * f(mod(lo)) + fr * f(mod(lo + 1));
    }
    if (sd > 4 * S) {
        let s = 0;
        for (let q = 0; q < S; q++) s += f(q);
        return s / S;
    }
    const a = Math.floor(mu - 7 * sd), b = Math.ceil(mu + 7 * sd);
    const step = Math.max(1, Math.ceil((b - a + 1) / 20000));
    let s = 0, w = 0;
    for (let e = a; e <= b; e += step) {
        const p = Phi((e + step - 0.5 - mu) / sd) - Phi((e - 0.5 - mu) / sd);
        s += p * f(mod(e + Math.floor(step / 2)));
        w += p;
    }
    return w ? s / w : 0;
}

/** Probabilidade de (diff + d) op 0 ser verdadeira, com d inteiro normal (média mu, variância v). */
function probTrue(cond, diff, mu, v) {
    const sd = Math.sqrt(v);
    const le = (k) => (sd < 1e-9 ? +(diff + mu <= k + 1e-9) : Phi((k + 0.5 - diff - mu) / sd)); // P(diff + d <= k)
    switch (cond) {
        case '<': return le(-1);
        case '<=': return le(0);
        case '>': return 1 - le(0);
        case '>=': return 1 - le(-1);
        case '==': return le(0) - le(-1);
        case '!=': return 1 - (le(0) - le(-1));
        default: return 0;
    }
}

/**
 * Erro próprio de cada operação aproximada, sobre as amostras do perfil.
 * @param {Map<string, string>} assign nó -> unidade
 * @param {Map} cache (opcional) guarda os resultados por nó e unidade, para a exploração reaproveitar
 */
export function unitErrors(result, stats, assign, cache = new Map()) {
    const out = new Map();
    for (const [id, name] of assign) {
        const op = result.ops.byId.get(id);
        if (!op || name === op.candidates[0]) continue;
        const key = `${id}|${name}`;
        if (!cache.has(key)) {
            const rows = stats.get(id)?.samples ?? [];
            const f = opFunction(result.lib, op, name);
            let s1 = 0, s2 = 0, nz = 0;
            for (const [x, y, v] of rows) { const e = f(x, y) - v; s1 += e; s2 += e * e; if (e) nz++; }
            const n = rows.length || 1;
            cache.set(key, { mu: s1 / n, m2: s2 / n, ep: nz / n, n: rows.length });
        }
        out.set(id, cache.get(key));
    }
    return out;
}

/**
 * Propagação: E[e] e E[e^2] de cada nó e das saídas.
 *
 * method 'analytic': cada nó pelas fórmulas acima. method 'sampled': dentro de cada trecho, as instâncias amostradas
 * no perfil são refeitas com as unidades aproximadas (o erro que chega de outros trechos, das recorrências e da
 * memória entra como ruído normal com a média e a variância propagadas); entre trechos, laços e memórias, a
 * propagação é a mesma, por média e variância. Assim as correlações dentro do trecho (a mesma soma aproximada que
 * zera os bits baixos de várias parcelas, o erro que depende dos bits baixos dos operandos) ficam no modelo.
 * @param {object} result síntese (design, segs, ops, lib)
 * @param {{stats: Map, segRows?: Map}} prof perfil da execução exata
 * @param {{intrinsic?: Map, fns?: Map, method?: 'analytic'|'sampled', seed?: number}} o
 */
export function propagate(result, prof, { intrinsic = new Map(), fns = new Map(), method = 'analytic', seed = 99, maxRows = Infinity } = {}) {
    const stats = prof.stats;
    const design = result.design;
    const P = method === 'sampled' ? compile(design) : null;
    const rand = rng(seed);
    const gauss = () => { const u = Math.max(rand(), 1e-12), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const noise = (st) => {
        if (!st || !st.m2) return 0;
        const x = st.mu + Math.sqrt(varOf(st)) * gauss();
        return Math.floor(x + rand());
    };
    const execs = new Map(result.segs.map((s) => [s.seg, s.execs]));
    const err = new Map(), final = new Map(), carryIn = new Map();
    const arrErr = new Map();
    const flags = new Set();
    const byId = new Map();
    for (const seg of design.segments) for (const n of seg.nodes) byId.set(n.id, n);
    const sig = (a) => (a.c !== undefined ? { mean: a.c, m2: a.c * a.c } : stats.get(a.n) ?? { mean: 0, m2: 0 });
    const E = (a) => (a.c !== undefined ? ZERO : err.get(a.n) ?? ZERO);
    const origin = (id) => { let n = byId.get(id); while (n?.op === 'in' && n.from) n = byId.get(n.from); return n?.id ?? id; };

    function node(n, seg, record) {
        const a = n.args;
        const own = intrinsic.get(n.id);
        let r = ZERO;
        switch (n.op) {
            case 'in': r = n.port ? ZERO : final.get(n.from) ?? err.get(n.from) ?? ZERO; break;
            case 'iv': r = ZERO; break;
            case 'carry': r = carryIn.get(n.id) ?? ZERO; break;
            case 'load': {
                const s = arrErr.get(n.array);
                r = s && s.w ? { mu: s.mu / s.w, m2: s.m2 / s.w } : ZERO;
                break;
            }
            case 'store': case 'out': {
                if (!record) return;
                const name = n.op === 'store' ? n.array : n.name.split('[')[0];
                const e = E(a[0]), w = execs.get(seg) ?? 1;
                if (!arrErr.has(name)) arrErr.set(name, { w: 0, mu: 0, m2: 0 });
                const s = arrErr.get(name);
                s.w += w; s.mu += w * e.mu; s.m2 += w * e.m2;
                return;
            }
            case 'carryout': return;
            case 'add': case 'sub': {
                const x = E(a[0]), y = E(a[1]), sg = n.op === 'sub' ? -1 : 1;
                const same = a[0].n !== undefined && a[0].n === a[1].n;
                const mu = x.mu + sg * y.mu;
                const v = same ? (sg > 0 ? 4 * varOf(x) : 0) : varOf(x) + varOf(y);
                r = { mu, m2: v + mu * mu };
                break;
            }
            case 'mul': {
                const x = E(a[0]), y = E(a[1]), A = sig(a[0]), B = sig(a[1]);
                // e = a eb + b ea + ea eb (operandos e erros independentes).
                const mu = A.mean * y.mu + B.mean * x.mu + x.mu * y.mu;
                const m2 = A.m2 * y.m2 + B.m2 * x.m2 + x.m2 * y.m2
                    + 2 * A.mean * B.mean * x.mu * y.mu + 2 * A.mean * x.mu * y.m2 + 2 * B.mean * y.mu * x.m2;
                r = { mu, m2: Math.max(m2, mu * mu) };
                break;
            }
            case 'shl': { const x = E(a[0]), k = 2 ** a[1].c; r = { mu: x.mu * k, m2: x.m2 * k * k }; break; }
            case 'shr': {
                const x = E(a[0]), S = 2 ** a[1].c;
                if (!x.m2) { r = ZERO; break; }
                const v = varOf(x) / (S * S) + expectMod(x.mu, varOf(x), S, (q) => (q / S) * (1 - q / S));
                r = { mu: x.mu / S, m2: v + (x.mu / S) ** 2 };
                break;
            }
            case 'and': case 'or': case 'xor': {
                const c = a.find((z) => z.c !== undefined)?.c;
                const x = a[0].c === undefined ? E(a[0]) : E(a[1]);
                if (n.op === 'and' && c !== undefined && c > 0 && ((c + 1) & c) === 0) {
                    const S = c + 1;
                    r = x.m2 ? { mu: 0, m2: expectMod(x.mu, varOf(x), S, (q) => q * (S - q)) } : ZERO;
                } else {
                    const ys = a.map(E);
                    r = ys.reduce((m, z) => (z.m2 > m.m2 ? z : m), ZERO);
                    if (r.m2) flags.add(`${n.id}: ${n.op} sem modelo de erro (o erro passa adiante)`);
                }
                break;
            }
            case 'not': { const x = E(a[0]); r = { mu: -x.mu, m2: x.m2 }; break; }
            case 'trunc': r = E(a[0]); break;
            case 'cmp': {
                const x = E(a[0]), y = E(a[1]);
                const dmu = x.mu - y.mu, dv = varOf(x) + varOf(y);
                if (!dmu && !dv) { r = ZERO; break; }
                const rows = stats.get(n.id)?.samples ?? [];
                let s1 = 0, s2 = 0;
                for (const [p, q, v] of rows) {
                    const pt = probTrue(n.cond, p - q, dmu, dv);
                    s1 += pt - v;
                    s2 += v ? 1 - pt : pt;
                }
                const k = rows.length || 1;
                r = { mu: s1 / k, m2: s2 / k };
                break;
            }
            case 'sel': {
                const eA = E(a[1]), eB = E(a[2]);
                const cn = a[0].n !== undefined ? byId.get(a[0].n) : null;
                let dmu = 0, dv = 0, cond = null;
                if (cn?.op === 'cmp') {
                    const x = E(cn.args[0]), y = E(cn.args[1]);
                    dmu = x.mu - y.mu; dv = varOf(x) + varOf(y); cond = cn.cond;
                } else if (cn && E(a[0]).m2) flags.add(`${n.id}: condição sem modelo de troca`);
                const rows = stats.get(n.id)?.samples ?? [];
                let mu = 0, m2 = 0;
                for (const row of rows) {
                    const [c, A, B] = row;
                    const pf = cond && (dmu || dv) ? (c ? 1 - probTrue(cond, row[4] - row[5], dmu, dv) : probTrue(cond, row[4] - row[5], dmu, dv)) : 0;
                    const ch = c ? eA : eB, ot = c ? eB : eA, D = c ? B - A : A - B;
                    mu += (1 - pf) * ch.mu + pf * (D + ot.mu);
                    m2 += (1 - pf) * ch.m2 + pf * (D * D + 2 * D * ot.mu + ot.m2);
                }
                const k = rows.length || 1;
                r = rows.length ? { mu: mu / k, m2: m2 / k } : eA;
                break;
            }
            default: r = ZERO;
        }
        if (own) {
            // Erro próprio da unidade somado ao propagado (independentes).
            const mu = r.mu + own.mu;
            r = { mu, m2: varOf(r) + varOf(own) + mu * mu };
        }
        err.set(n.id, r);
    }
    /** Trecho refeito nas instâncias amostradas, com as unidades aproximadas e o erro de entrada como ruído. */
    function replaySeg(seg, record) {
        const rows = prof.segRows?.get(seg.id)?.slice(0, maxRows);
        const prog = P.progs.get(seg);
        if (!rows?.length) { for (const n of seg.nodes) node(n, seg, record); return; }
        const loc = new Map(prog.map((ins, k) => [ins.ix, k]));
        // Trechos com poucas instâncias (fora dos laços) são refeitos várias vezes, para o ruído de entrada ter amostras.
        const reps = Math.max(1, Math.ceil(512 / rows.length));
        const L = prog.length, R = rows.length * reps;
        const s1 = new Float64Array(L), s2 = new Float64Array(L);
        // Nas escritas, também a relação entre o erro e o valor exato (para o SSIM: um erro proporcional ao valor
        // preserva a estrutura da imagem).
        const sx = new Float64Array(L), sxx = new Float64Array(L), sxe = new Float64Array(L);
        // e o erro condicionado ao valor exato da saída, em SSIM_BINS faixas (contagem, soma e soma dos quadrados).
        const binsOf = new Map();
        const ap = new Float64Array(L);
        const argIdx = prog.map((ins) => ins.a.map((x) => (x.ix !== undefined ? loc.get(x.ix) : -1)));
        const consts = prog.map((ins) => ins.a.map((x) => x.c));
        const inErr = prog.map((ins) => {
            const n = ins.n;
            if (n.op === 'in') return n.port ? null : final.get(n.from) ?? err.get(n.from) ?? null;
            if (n.op === 'carry') return carryIn.get(n.id) ?? null;
            if (n.op === 'load') { const st = arrErr.get(n.array); return st && st.w ? { mu: st.mu / st.w, m2: st.m2 / st.w } : null; }
            return null;
        });
        const f = prog.map((ins) => fns.get(ins.n.id) ?? null);
        for (let q = 0; q < R; q++) {
            const row = rows[q % rows.length];
            const X = (k, j) => (argIdx[k][j] >= 0 ? ap[argIdx[k][j]] : consts[k][j]);
            const Xe = (k, j) => (argIdx[k][j] >= 0 ? row[argIdx[k][j]] : consts[k][j]);
            for (let k = 0; k < L; k++) {
                const ins = prog[k], n = ins.n;
                let v;
                switch (ins.op) {
                    case 'in': case 'carry': case 'load': v = row[k] + noise(inErr[k]); break;
                    case 'iv': v = row[k]; break;
                    case 'store': case 'out': {
                        const t = ins.arr.type;
                        const xe = wrapTo(Xe(k, 0), t.bits, t.signed);
                        const e = wrapTo(X(k, 0), t.bits, t.signed) - xe;
                        s1[k] += e; s2[k] += e * e;
                        sx[k] += xe; sxx[k] += xe * xe; sxe[k] += xe * e;
                        if (t.bits === 8 && !t.signed) {
                            if (!binsOf.has(k)) binsOf.set(k, new Float64Array(3 * SSIM_BINS));
                            const B = binsOf.get(k), j = 3 * Math.min(SSIM_BINS - 1, Math.floor((xe * SSIM_BINS) / 256));
                            B[j]++; B[j + 1] += e; B[j + 2] += e * e;
                        }
                        continue;
                    }
                    case 'carryout': continue;
                    case 'add': v = f[k] ? f[k](X(k, 0), X(k, 1)) : X(k, 0) + X(k, 1); break;
                    case 'sub': v = f[k] ? f[k](X(k, 0), X(k, 1)) : X(k, 0) - X(k, 1); break;
                    case 'mul': v = f[k] ? f[k](X(k, 0), X(k, 1)) : X(k, 0) * X(k, 1); break;
                    case 'shl': v = X(k, 0) * 2 ** consts[k][1]; break;
                    case 'shr': v = Math.floor(X(k, 0) / 2 ** consts[k][1]); break;
                    case 'and': case 'or': case 'xor': v = bit(ins.op, X(k, 0), X(k, 1)); break;
                    case 'not': v = -X(k, 0) - 1; break;
                    case 'cmp': v = CMP[n.cond](X(k, 0), X(k, 1)); break;
                    case 'sel': v = X(k, 0) ? X(k, 1) : X(k, 2); break;
                    case 'trunc': v = wrapTo(X(k, 0), ins.bits, ins.signed); break;
                    case 'rq': v = requantValue(X(k, 0), X(k, 1), X(k, 2)); break;
                    default: v = row[k];
                }
                ap[k] = v;
                const e = v - row[k];
                s1[k] += e; s2[k] += e * e;
            }
        }
        for (let k = 0; k < L; k++) {
            const n = prog[k].n;
            const st = { mu: s1[k] / R, m2: s2[k] / R };
            if (n.op === 'store' || n.op === 'out') {
                if (!record) continue;
                const name = n.op === 'store' ? n.array : n.name.split('[')[0];
                const w = execs.get(seg) ?? 1;
                if (!arrErr.has(name)) arrErr.set(name, { w: 0, mu: 0, m2: 0 });
                const a = arrErr.get(name);
                a.w += w; a.mu += w * st.mu; a.m2 += w * st.m2;
                a.wx = (a.wx ?? 0) + w; a.sx = (a.sx ?? 0) + (w * sx[k]) / R; a.sxx = (a.sxx ?? 0) + (w * sxx[k]) / R; a.sxe = (a.sxe ?? 0) + (w * sxe[k]) / R;
                if (binsOf.has(k)) {
                    a.bins ??= new Float64Array(3 * SSIM_BINS);
                    const B = binsOf.get(k);
                    for (let j = 0; j < B.length; j++) a.bins[j] += (w * B[j]) / R;
                }
            } else if (n.op !== 'carryout') err.set(n.id, st);
        }
    }
    let mode = method;
    const runSeg = (seg, record) => {
        if (mode === 'sampled') replaySeg(seg, record);
        else for (const n of seg.nodes) node(n, seg, record);
    };
    function region(r, record) {
        for (const it of r.items) {
            if (it.k === 'seg') runSeg(it.seg, record);
            else loop(it.region, record);
        }
    }
    function loop(r, record) {
        const carries = [];
        for (const it of r.items) if (it.k === 'seg') for (const n of it.seg.nodes) if (n.op === 'carry') carries.push(n);
        const outOf = new Map();
        for (const it of r.items) if (it.k === 'seg') for (const n of it.seg.nodes) if (n.op === 'carryout') outOf.set(n.to, n.args[0]);
        if (!carries.length) { region(r, record); return; }
        const T = r.loop.tripHw;
        const init = new Map(carries.map((c) => [c.id, c.initFrom ? final.get(c.initFrom) ?? err.get(c.initFrom) ?? ZERO : ZERO]));
        const fin = (c) => { const x = outOf.get(c.id); return x ? E(x) : ZERO; };
        // Incremento por iteração (recorrência sem erro na entrada) e ganho (entrada com erro 1).
        for (const c of carries) carryIn.set(c.id, ZERO);
        region(r, false);
        const delta = new Map(carries.map((c) => [c.id, fin(c)]));
        // Ganho pelo modelo analítico (linear): um desvio constante na entrada, comparado com a entrada sem erro. No
        // modelo por amostras, a sonda passaria por unidades não lineares (truncamento, segmentos) e o ganho sairia
        // distorcido, então o ganho é sempre o analítico.
        const gain = new Map();
        const saved = mode;
        mode = 'analytic';
        for (const c of carries) {
            const p = Math.max(1, Math.round(4 * Math.sqrt(delta.get(c.id).m2)));
            for (const d of carries) carryIn.set(d.id, ZERO);
            region(r, false);
            const base = fin(c).mu;
            for (const d of carries) carryIn.set(d.id, d === c ? { mu: p, m2: p * p } : ZERO);
            region(r, false);
            gain.set(c.id, (fin(c).mu - base) / p);
        }
        mode = saved;
        const avg = new Map(), last = new Map();
        for (const c of carries) {
            const g = gain.get(c.id), d = delta.get(c.id), dv = varOf(d);
            let mu = init.get(c.id).mu, v = varOf(init.get(c.id)), smu = 0, sm2 = 0;
            for (let t = 0; t < T; t++) {
                smu += mu; sm2 += v + mu * mu;
                mu = g * mu + d.mu;
                v = g * g * v + dv;
            }
            avg.set(c.id, { mu: smu / T, m2: sm2 / T });
            last.set(c.id, { mu, m2: v + mu * mu });
        }
        for (const c of carries) carryIn.set(c.id, avg.get(c.id));
        region(r, record);
        // Depois do laço, o valor final de cada recorrência (e o nó de onde ele veio).
        for (const c of carries) {
            const x = outOf.get(c.id);
            if (!x || x.n === undefined) continue;
            final.set(x.n, last.get(c.id));
            final.set(origin(x.n), last.get(c.id));
        }
    }
    region(design.top, true);
    const outputs = new Map();
    // SSIM estimado nas saídas de imagem: as estatísticas locais da imagem exata e o erro como ruído independente.
    const ssimOf = outputSsimStats(design, prof);
    for (const arr of outputArrays(design)) {
        const s = arrErr.get(arr.name);
        const mu = s?.w ? s.mu / s.w : 0, m2 = s?.w ? s.m2 / s.w : 0;
        const peak = typeRange(arr.type)[1];
        const st = ssimOf.get(arr.name);
        // Erro decomposto em uma parte proporcional ao valor exato e um ruído independente: e = a + b·x + n.
        let gain = 0;
        if (s?.wx) {
            const ex = s.sx / s.wx, vx = s.sxx / s.wx - ex * ex, cxe = s.sxe / s.wx - ex * (s.mu / s.w);
            if (vx > 1e-9) gain = cxe / vx;
        }
        // Com o erro por faixa de valor (modelo por amostras), a estimativa usa a média e a variância do erro de cada
        // faixa, pixel a pixel; sem ele, o ganho e o ruído independente.
        let byValue = null;
        if (s?.bins) {
            byValue = [];
            for (let j = 0; j < SSIM_BINS; j++) {
                const c = s.bins[3 * j];
                byValue.push(c > 1e-9 ? { mu: s.bins[3 * j + 1] / c, v: Math.max(0, s.bins[3 * j + 2] / c - (s.bins[3 * j + 1] / c) ** 2) } : { mu, v: Math.max(0, m2 - mu * mu) });
            }
        }
        const SSIM = !st ? null : byValue ? ssimEstimateBins(st.stats, byValue) : ssimEstimate(st.stats, mu, m2 - mu * mu, gain);
        // A fórmula do erro independente do sinal, para comparação (estudo E7).
        const SSIMindep = st ? ssimEstimate(st.stats, mu, m2 - mu * mu) : null;
        outputs.set(arr.name, { ME: mu, MSE: m2, PSNR: m2 ? 10 * Math.log10((peak * peak) / m2) : Infinity, SSIM, SSIMindep, peak });
    }
    return { err, outputs, flags: [...flags] };
}

/**
 * Estimativa completa: erro próprio de cada operação, propagação até as saídas e o orçamento (a parcela do erro de
 * cada saída que vem de cada operação, propagando só o erro dela).
 */
export function estimateError(result, prof, { cache, method = 'analytic', budget: wantBudget = true, maxRows = Infinity } = {}) {
    const own = unitErrors(result, prof.stats, result.assign, cache);
    const fns = new Map([...result.assign].map(([id, name]) => [id, opFunction(result.lib, result.ops.byId.get(id), name)]));
    const total = propagate(result, prof, { intrinsic: own, fns, method, maxRows });
    const budget = [];
    if (wantBudget) {
        for (const [id, e] of own) {
            const alone = own.size > 1 ? propagate(result, prof, { intrinsic: new Map([[id, e]]), fns: new Map([[id, fns.get(id)]]), method, maxRows }).outputs : total.outputs;
            budget.push({ id, unit: result.assign.get(id), own: e, outputs: alone });
        }
    }
    return { method, own, ...total, budget };
}

/**
 * Estimativa e verificação: o perfil exato (reaproveitado se for dado), a estimativa estática e a execução bit a bit
 * com as unidades aproximadas, comparada com a exata nas saídas.
 * @param {object} result síntese com a atribuição (result.assign)
 * @param {{inputs: Map, prof?: object, method?: string, budget?: boolean, cache?: Map}} o
 */
export function analyzeError(result, { inputs, prof = null, method = 'sampled', budget = true, cache } = {}) {
    const profile = prof ?? execute(result.design, inputs, { profile: true });
    const est = estimateError(result, profile, { method, budget, cache });
    const fns = new Map([...result.assign].map(([id, name]) => [id, opFunction(result.lib, result.ops.byId.get(id), name)]));
    const approx = fns.size ? execute(result.design, inputs, { ops: fns }) : profile;
    const measured = compareOutputs(result.design, profile, approx);
    return { prof: profile, est, measured, approx };
}
