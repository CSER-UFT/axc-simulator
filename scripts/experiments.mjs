#!/usr/bin/env node
/**
 * Estudos de caso da síntese de alto nível aproximada, reprodutíveis: o mesmo código, as mesmas sementes e os mesmos
 * dados dão os mesmos números. Saída em results/: CSV e JSON de cada experimento, RESULTADOS.md com as tabelas e
 * tabelas.tex com as mesmas tabelas em LaTeX.
 *
 *   E1  precisão do modelo estático de erro: MSE estimado (analítico e por amostras) contra o medido na execução bit
 *       a bit, nos cinco kernels, com unidades de cada técnica e com os dois conjuntos de entrada;
 *   E2  heurísticas de exploração: custo do melhor ponto verificado, avaliações e tempo, por kernel, grupos (classe e
 *       operação) e limite de PSNR;
 *   E3  fronteiras de Pareto (área contra PSNR) com todos os pontos verificados bit a bit: o estimado ao longo da
 *       fronteira contra o medido;
 *   E4  período junto com as unidades (objetivo ponderado, latência e área);
 *   E5  sensibilidade aos dados: o projeto escolhido com entradas uniformes, verificado na imagem, e o contrário;
 *   E6  unroll: grupos por operação contra por operação do código (as cópias do unroll com a mesma unidade);
 *   E7  SSIM: a estimativa (erro por faixa de valor, ruído independente, analítico) contra o medido, e a exploração
 *       com restrição em SSIM, verificada bit a bit.
 *
 *   node scripts/experiments.mjs [--only E1,E3] [--quick] [--out results]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';
import { execute, makeInputs, compareOutputs } from '../js/hls/exec.js';
import { opFunction } from '../js/hls/approx.js';
import { estimateError, analyzeError } from '../js/hls/error.js';
import { explore, pointSummary } from '../js/hls/dse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const QUICK = argv.includes('--quick');
const ONLY = new Set((opt('--only', 'E1,E2,E3,E4,E5,E6,E7')).split(','));
const OUT = resolve(ROOT, opt('--out', 'results'));
mkdirSync(OUT, { recursive: true });

const synth = JSON.parse(readFileSync(join(ROOT, 'data/synth.json'), 'utf8'));
const cells = JSON.parse(readFileSync(join(ROOT, 'data/hls-cells.json'), 'utf8'));
const code = (id) => KERNELS.find((k) => k.id === id).code;
const KCODE = {
    gauss: code('gauss'), 'gauss-seq': code('gauss').replace(/#pragma HLS .*\n/g, ''), sobel: code('sobel'), sharpen: code('sharpen'), fir: code('fir'), dot: code('dot'),
};
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const csv = (rows) => `${rows.map((r) => r.map((x) => (x === null || x === undefined ? '' : typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : typeof x === 'number' && !Number.isInteger(x) ? +x.toPrecision(6) : x)).join(',')).join('\n')}\n`;
const save = (name, text) => { writeFileSync(join(OUT, name), text); log('gravado', name); };
const br = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '-' : v === Infinity ? '∞' : v.toFixed(d).replace('.', ','));
const pctBr = (v, d = 1) => `${br(100 * v, d)}%`;
const IN = { image: 'imagem', uniform: 'uniformes' };
const md = [];
const tex = [];
/** Tabela em Markdown e em LaTeX (cabeçalho tabAzul com texto branco, \hline, sem booktabs). */
function table(title, head, rows, align = null) {
    md.push(`#### ${title}\n`, `| ${head.join(' | ')} |`, `| ${head.map((_, i) => ((align?.[i] ?? (i ? 'r' : 'l')) === 'r' ? '---:' : '---')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`), '');
    const texEsc = (s) => String(s).replace(/\\/g, '\\textbackslash{}').replace(/([%&#_$])/g, '\\$1').replace(/×/g, '$\\times$').replace(/≥/g, '$\\geq$').replace(/≤/g, '$\\leq$').replace(/∞/g, '$\\infty$').replace(/µ/g, '$\\mu$').replace(/²/g, '$^2$');
    tex.push(
        '\\begin{table}[htbp]', '\\centering', `\\caption{${texEsc(title)}}`, `\\begin{tabular}{|${head.map((_, i) => align?.[i] ?? (i ? 'r' : 'l')).join('|')}|}`, '\\hline',
        `\\rowcolor{tabAzul}${head.map((h) => `\\color{white}${texEsc(h)}`).join(' & ')} \\\\`, '\\hline',
        ...rows.map((r) => `${r.map(texEsc).join(' & ')} \\\\ \\hline`), '\\end{tabular}', '\\end{table}', '',
    );
}

const meta = {
    date: new Date().toISOString(), node: process.version, quick: QUICK,
    commit: (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return null; } })(),
    synth: { generated: synth.generated, tools: synth.tools, library: synth.asic?.library }, clockNs: 5, flow: 'delay', ports: 2,
};

// E1: precisão do modelo de erro ----------------------------------------------------------------------------------
const FAMILIES = [
    ['MUL DRUM4', /^MUL\d+ DRUM4$/, null], ['MUL T4', /^MUL\d+ T4$/, null], ['MUL T6 +C', /^MUL\d+ T6 \+C$/, null], ['MUL MITCHELL', /MITCHELL$/, null], ['MUL KUL', /KUL$/, null],
    ['ADD LOA4', null, /^ADD(8|16) LOA4$|ADD16 LOA4 \+/], ['ADD TRUNC3', null, /^ADD(8|16) TRUNC3$|ADD16 TRUNC3 \+/], ['ADD SEG L4 P2', null, /SEG L4 P2/], ['MUL DRUM6 + ADD LOA6', /DRUM6$/, /LOA6/],
];
function e1() {
    const rows = [['kernel', 'input', 'family', 'ops', 'mse_measured', 'mse_analytic', 'mse_sampled', 'me_measured', 'me_analytic', 'me_sampled', 'ratio_analytic', 'ratio_sampled']];
    const kernels = QUICK ? ['gauss', 'fir'] : ['gauss', 'gauss-seq', 'sobel', 'sharpen', 'fir', 'dot'];
    for (const k of kernels) for (const input of QUICK ? ['image'] : ['image', 'uniform']) {
        const base = synthesize(KCODE[k], { synth, cells });
        const inputs = makeInputs(base.design, input);
        const prof = execute(base.design, inputs, { profile: true });
        for (const [fam, mre, are] of FAMILIES) {
            const asg = new Map();
            for (const op of base.ops.list) {
                const re = op.cls === 'mul' ? mre : are;
                const n = re && op.candidates.find((c) => re.test(c));
                if (n) asg.set(op.id, n);
            }
            if (!asg.size) continue;
            const r = synthesize(KCODE[k], { synth, cells, assign: asg, design: base.design });
            const ops = new Map([...asg].map(([id, n]) => [id, opFunction(r.lib, r.ops.byId.get(id), n)]));
            const ap = execute(r.design, inputs, { ops });
            const ea = estimateError(r, prof, { method: 'analytic', budget: false }).outputs;
            const es = estimateError(r, prof, { method: 'sampled', budget: false }).outputs;
            const out = [...ea.keys()][0];
            // Medido nas posições escritas.
            const X = prof.mem.get(out), Y = ap.mem.get(out), w = prof.written.get(out);
            let n = 0, s1 = 0, s2 = 0;
            for (let q = 0; q < X.length; q++) if (w[q]) { const d = Y[q] - X[q]; n++; s1 += d; s2 += d * d; }
            const mm = s2 / n, me = s1 / n;
            rows.push([k, input, fam, asg.size, mm, ea.get(out).MSE, es.get(out).MSE, me, ea.get(out).ME, es.get(out).ME, mm ? ea.get(out).MSE / mm : null, mm ? es.get(out).MSE / mm : null]);
        }
        log('E1', k, input);
    }
    save('e1_modelo_de_erro.csv', csv(rows));
    // Resumo: kernels com saída de várias posições (no produto escalar, o MSE medido é o quadrado de um único erro).
    const data = rows.slice(1).filter((r) => r[0] !== 'dot' && r[4] > 0);
    const stat = (col) => {
        const lr = data.map((r) => Math.abs(Math.log10(r[col]))).sort((a, b) => a - b);
        const within = (f) => data.filter((r) => r[col] >= 1 / f && r[col] <= f).length / data.length;
        return { median: 10 ** lr[Math.floor(lr.length / 2)], w10: within(1.1), w25: within(1.25), w2: within(2), worst: 10 ** lr[lr.length - 1] };
    };
    const A = stat(10), S = stat(11);
    const piped = (col) => { const d = data.filter((r) => !['gauss-seq', 'dot'].includes(r[0])); return d.filter((r) => r[col] >= 1 / 1.1 && r[col] <= 1.1).length / d.length; };
    md.push('### E1. Precisão do modelo estático de erro\n', `${data.length} casos (kernel, entrada e família de unidades) com saída de várias posições; razão entre o MSE estimado e o medido na execução bit a bit.\n`);
    table('E1: razão entre o MSE estimado e o medido', ['Modelo', 'Erro mediano (fator)', 'Dentro de 10%', 'Dentro de 25%', 'Dentro de 2 vezes', 'Pior caso (fator)', 'Com pipeline, dentro de 10%'], [
        ['analítico', `${br(A.median)}×`, pctBr(A.w10, 0), pctBr(A.w25, 0), pctBr(A.w2, 0), `${br(A.worst, 1)}×`, pctBr(piped(10), 0)],
        ['por amostras', `${br(S.median)}×`, pctBr(S.w10, 0), pctBr(S.w25, 0), pctBr(S.w2, 0), `${br(S.worst, 1)}×`, pctBr(piped(11), 0)],
    ]);
    const worst = [...data].sort((a, b) => Math.abs(Math.log10(b[11])) - Math.abs(Math.log10(a[11]))).slice(0, 5);
    table('E1: os cinco casos de maior desvio do modelo por amostras', ['Kernel', 'Entrada', 'Unidades', 'MSE medido', 'Analítico', 'Por amostras'],
        worst.map((r) => [r[0], IN[r[1]], r[2], br(r[4], 4), `${br(r[10])}×`, `${br(r[11])}×`]), ['l', 'l', 'l', 'r', 'r', 'r']);
    const dots = rows.slice(1).filter((r) => r[0] === 'dot');
    if (dots.length) table('E1: produto escalar (uma saída): erro medido e viés estimado', ['Entrada', 'Unidades', 'Erro medido', 'Viés analítico', 'Viés por amostras'], dots.map((r) => [IN[r[1]], r[2], br(r[7], 0), br(r[8], 0), br(r[9], 0)]), ['l', 'l', 'r', 'r', 'r']);
    return { A, S };
}

// E2: heurísticas ------------------------------------------------------------------------------------------------
function e2() {
    const LIMITS = { gauss: [30, 40, 50], sobel: [30, 40, 50], sharpen: [30, 40, 50], fir: [50, 60, 70] };
    const kernels = QUICK ? ['gauss'] : ['gauss', 'sobel', 'sharpen', 'fir'];
    const grans = QUICK ? ['class'] : ['class', 'op'];
    const rows = [['kernel', 'granularity', 'psnr_min', 'heuristic', 'evaluations', 'verify_tries', 'ms', 'area_um2', 'area_saving', 'energy_saving', 'psnr_est', 'psnr_measured', 'verified', 'error', 'units']];
    const res = [];
    for (const k of kernels) for (const g of grans) for (const lim of QUICK ? [40] : LIMITS[k]) {
        const r = explore(KCODE[k], { synth, cells, objective: 'area', constraint: { metric: 'psnr', value: lim }, granularity: g, heuristic: 'all', samples: 200 });
        for (const run of r.runs) {
            const p = run.error ? null : pointSummary(run.chosen ?? run.best, r.ref);
            const minP = (a) => (a ? Math.min(...a.map((o) => o.PSNR)) : null);
            rows.push([k, g, lim, run.heuristic, run.evals, run.verifyTries, run.ms, p?.cost.area, p?.savings.area, p?.savings.energy, minP(p?.estimated), minP(p?.measured), !!run.chosen, run.error, p?.units.join(' + ')]);
            res.push({ k, g, lim, h: run.heuristic, p, evals: run.evals, ms: run.ms, error: run.error, verified: !!run.chosen, tries: run.verifyTries });
        }
        log('E2', k, g, lim);
    }
    save('e2_heuristicas.csv', csv(rows));
    md.push('### E2. Heurísticas de exploração\n', 'Objetivo: área ASIC; restrição: PSNR mínimo (estimado na busca, conferido bit a bit no ponto escolhido). Economia em relação ao projeto exato; "-" quando a heurística não roda (exaustiva por operação) ou nenhum ponto passa na verificação.\n');
    const H = ['sequential', 'efficiency', 'exhaustive', 'random', 'local', 'tabu', 'grasp', 'ga'];
    const HN = { sequential: 'Sequencial', efficiency: 'Eficiência', exhaustive: 'Exaustiva', random: 'Aleatória', local: 'Local', tabu: 'Tabu', grasp: 'GRASP', ga: 'Genético' };
    const keys = [...new Set(res.map((x) => `${x.k}|${x.g}|${x.lim}`))];
    table('E2: economia de área do ponto escolhido (PSNR medido)', ['Kernel', 'Grupos', 'PSNR mín.', ...H.map((h) => HN[h])],
        keys.map((key) => {
            const [k, g, lim] = key.split('|');
            return [k, g === 'op' ? 'operação' : 'classe', lim, ...H.map((h) => {
                const x = res.find((y) => `${y.k}|${y.g}|${y.lim}` === key && y.h === h);
                return x?.p && x.verified ? `${pctBr(x.p.savings.area)} (${br(Math.min(...x.p.measured.map((o) => o.PSNR)), 1)})` : '-';
            })];
        }), ['l', 'l', 'r', ...H.map(() => 'r')]);
    // Distância ao melhor conhecido: em cada configuração, a menor área verificada entre todas as heurísticas.
    const bestOf = new Map(keys.map((key) => [key, Math.min(...res.filter((y) => `${y.k}|${y.g}|${y.lim}` === key && y.p && y.verified).map((y) => y.p.cost.area))]));
    table('E2: distância ao melhor conhecido (área a mais, em média e no pior caso, e em quantas configurações a heurística acha o melhor)', ['Heurística', 'Grupos', 'Média', 'Pior', 'Acha o melhor'],
        H.flatMap((h) => grans.map((g) => {
            const xs = res.filter((x) => x.h === h && x.g === g && x.p && x.verified && Number.isFinite(bestOf.get(`${x.k}|${x.g}|${x.lim}`)));
            if (!xs.length) return [HN[h], g === 'op' ? 'operação' : 'classe', '-', '-', '-'];
            const gaps = xs.map((x) => x.p.cost.area / bestOf.get(`${x.k}|${x.g}|${x.lim}`) - 1);
            return [HN[h], g === 'op' ? 'operação' : 'classe', pctBr(gaps.reduce((a, b) => a + b, 0) / gaps.length), pctBr(Math.max(...gaps)), `${gaps.filter((d) => d < 1e-9).length} de ${gaps.length}`];
        })), ['l', 'l', 'r', 'r', 'r']);
    table('E2: avaliações e tempo (média por configuração)', ['Heurística', 'Grupos', 'Avaliações', 'Tempo (s)'],
        H.flatMap((h) => grans.map((g) => {
            const xs = res.filter((x) => x.h === h && x.g === g && !x.error);
            return xs.length ? [HN[h], g === 'op' ? 'operação' : 'classe', br(xs.reduce((s, x) => s + x.evals, 0) / xs.length, 0), br(xs.reduce((s, x) => s + x.ms, 0) / xs.length / 1000, 1)] : [HN[h], g === 'op' ? 'operação' : 'classe', '-', '-'];
        })), ['l', 'l', 'r', 'r']);
    const tr = res.filter((x) => !x.error && x.tries);
    md.push(`Verificação: o primeiro ponto (o mais barato estimado como viável) passou na execução bit a bit em ${tr.filter((x) => x.tries === 1 && x.verified).length} de ${tr.length} casos; nos outros, a busca verificou em média ${br(tr.filter((x) => x.tries > 1).reduce((s2, x) => s2 + x.tries, 0) / (tr.filter((x) => x.tries > 1).length || 1), 1)} pontos até achar um que passa (no máximo ${Math.max(0, ...tr.map((x) => x.tries))}).\n`);
    // Comparação direta entre a sequencial e a eficiência.
    const pairs = keys.map((key) => {
        const s = res.find((y) => `${y.k}|${y.g}|${y.lim}` === key && y.h === 'sequential'), e = res.find((y) => `${y.k}|${y.g}|${y.lim}` === key && y.h === 'efficiency');
        return s?.p && e?.p && s.verified && e.verified ? { key, d: s.p.cost.area - e.p.cost.area, rel: (s.p.cost.area - e.p.cost.area) / s.p.cost.area } : null;
    }).filter(Boolean);
    const better = pairs.filter((x) => x.d > 1e-6).length, worse = pairs.filter((x) => x.d < -1e-6).length;
    md.push(`Eficiência contra sequencial: melhor em ${better} de ${pairs.length} configurações, igual em ${pairs.length - better - worse}, pior em ${worse}; maior ganho ${pctBr(Math.max(0, ...pairs.map((x) => x.rel)))} de área a menos que a sequencial.\n`);
    return res;
}

// E3: fronteiras verificadas ----------------------------------------------------------------------------------------
function e3() {
    const cases = QUICK ? [['gauss', 'class', 'exhaustive']] : [['gauss', 'class', 'exhaustive'], ['gauss', 'op', 'efficiency'], ['fir', 'class', 'exhaustive'], ['sobel', 'op', 'efficiency']];
    const out = [];
    for (const [k, g, h] of cases) {
        const r = explore(KCODE[k], { synth, cells, objective: 'area', constraint: { metric: 'psnr', value: 20 }, granularity: g, heuristic: h, verifyFront: 400, maxVerify: 1 });
        const front = r.runs[0].front.map((p) => pointSummary(p, r.ref));
        const rows = [['area_um2', 'area_saving', 'psnr_est', 'psnr_measured', 'units']];
        for (const p of front) rows.push([p.cost.area, p.savings.area, Math.min(...p.estimated.map((o) => o.PSNR)), p.measured ? Math.min(...p.measured.map((o) => o.PSNR)) : null, p.units.join(' + ')]);
        save(`e3_fronteira_${k}_${g}.csv`, csv(rows));
        const ver = front.filter((p) => p.measured && Number.isFinite(p.measured[0].PSNR) && Number.isFinite(p.estimated[0].PSNR));
        const dif = ver.map((p) => Math.abs(Math.min(...p.estimated.map((o) => o.PSNR)) - Math.min(...p.measured.map((o) => o.PSNR))));
        // Pontos que o modelo diz viáveis a 40 dB e a medida não (e o contrário).
        const at = 40;
        const fp = ver.filter((p) => Math.min(...p.estimated.map((o) => o.PSNR)) >= at && Math.min(...p.measured.map((o) => o.PSNR)) < at).length;
        const fn = ver.filter((p) => Math.min(...p.estimated.map((o) => o.PSNR)) < at && Math.min(...p.measured.map((o) => o.PSNR)) >= at).length;
        out.push([k, g === 'op' ? 'operação' : 'classe', h === 'exhaustive' ? 'exaustiva' : 'eficiência', String(front.length), String(ver.length), br(dif.reduce((s, x) => s + x, 0) / (dif.length || 1)), br(Math.max(0, ...dif)), `${fp} / ${fn}`]);
        log('E3', k, g, h);
    }
    md.push('### E3. Fronteiras de Pareto verificadas\n', 'Área contra PSNR, com restrição frouxa (20 dB) para a fronteira cobrir a faixa toda; todos os pontos verificados bit a bit. A última coluna conta, no limite de 40 dB, os pontos que o modelo aceita e a medida rejeita, e o contrário.\n');
    table('E3: PSNR estimado contra medido ao longo da fronteira', ['Kernel', 'Grupos', 'Heurística', 'Pontos', 'Verificados', 'Diferença média (dB)', 'Maior diferença (dB)', 'Erros de decisão a 40 dB'], out, ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r']);
}

// E4: período ----------------------------------------------------------------------------------------
function e4() {
    const rows = [['objective', 'variant', 'score', 'area_um2', 'energy_nJ', 'latency_ns', 'interval_ns', 'psnr_est', 'psnr_measured', 'units']];
    const tab = [];
    for (const objective of QUICK ? ['weighted'] : ['weighted', 'latency', 'area']) {
        const r = explore(KCODE.gauss, { synth, cells, objective, constraint: { metric: 'psnr', value: 40 }, granularity: 'class', heuristic: 'efficiency', clocks: QUICK ? [5] : [2.5, 5, 10] });
        const run = r.runs[0];
        const best = pointSummary(run.chosen, r.ref);
        if (!best) { tab.push([{ weighted: 'ponderado', latency: 'latência', area: 'área' }[objective], 'nenhum ponto passou na verificação', '-', '-', '-', '-', '-']); continue; }
        // O melhor viável de cada variante.
        const byVar = new Map();
        for (const p of run.points) if (p.feasible && (!byVar.has(p.variant) || p.score < byVar.get(p.variant).score)) byVar.set(p.variant, p);
        for (const [vname, p] of byVar) {
            const s = pointSummary(p, r.ref);
            rows.push([objective, vname, s.score, s.cost.area, s.cost.energy / 1e6, s.cost.latency, s.cost.interval, Math.min(...s.estimated.map((o) => o.PSNR)), null, s.units.join(' + ')]);
        }
        tab.push([{ weighted: 'ponderado', latency: 'latência', area: 'área' }[objective], best.variant, br(best.cost.area, 0), br(best.cost.energy / 1e6, 0), br(best.cost.latency / 1000, 1), br(Math.min(...best.measured.map((o) => o.PSNR)), 1), best.units.join(' + ')]);
        log('E4', objective);
    }
    save('e4_diretivas.csv', csv(rows));
    md.push('### E4. Período junto com as unidades\n', 'Gaussiano com as diretivas do código, PSNR de pelo menos 40 dB, grupos por classe, heurística de eficiência; períodos de 2,5, 5 e 10 ns.\n');
    table('E4: melhor ponto verificado por objetivo', ['Objetivo', 'Variante', 'Área (µm²)', 'Energia (nJ)', 'Latência (µs)', 'PSNR medido', 'Unidades'], tab, ['l', 'l', 'r', 'r', 'r', 'r', 'l']);
}

// E6: unroll e grupos -----------------------------------------------------------------------------------------------
function e6() {
    const rows = [['kernel', 'granularity', 'psnr_min', 'groups', 'evaluations', 'ms', 'area_saving', 'psnr_measured', 'approx_ops', 'copy_groups', 'asymmetric_groups', 'units']];
    const tab = [];
    for (const k of ['gauss', 'sobel', 'sharpen']) {
        const src = KCODE[k].replace('#pragma HLS pipeline II=1', '#pragma HLS pipeline II=1\n#pragma HLS unroll factor=2');
        const base = synthesize(src, { synth, cells });
        const originOf = (id) => base.ops.byId.get(id).origin;
        const copies = new Map();
        for (const o of base.ops.list) { if (!copies.has(o.origin)) copies.set(o.origin, []); copies.get(o.origin).push(o.id); }
        const multi = [...copies.values()].filter((l) => l.length > 1);
        for (const g of ['op', 'source']) {
            const t = Date.now();
            const r = explore(src, { synth, cells, objective: 'area', constraint: { metric: 'psnr', value: 40 }, granularity: g, heuristic: 'efficiency' });
            const run = r.runs[0], p = run.chosen;
            const unitOf = (id) => p?.assign.get(id) ?? 'exato';
            const asym = multi.filter((l) => new Set(l.map(unitOf)).size > 1).length;
            const psnr = p ? Math.min(...p.outs.map((o) => o.PSNR)) : null;
            const saving = p ? 1 - p.score / r.refScore : null;
            log('E6', k, g);
            rows.push([k, g, 40, g === 'op' ? base.ops.list.length : copies.size, run.evals, Date.now() - t, saving, psnr, p ? p.assign.size : 0, multi.length, asym, p?.units.join(' + ') ?? '']);
            tab.push([k, g === 'op' ? 'operação' : 'operação do código', String(run.evals), saving === null ? '-' : pctBr(saving), br(psnr, 1), String(p ? p.assign.size : 0), `${asym} de ${multi.length}`]);
            void originOf;
        }
    }
    save('e6_unroll_grupos.csv', csv(rows));
    md.push('### E6. Unroll: cópias com a mesma unidade\n', 'Kernels com `unroll factor=2` no laço com pipeline; objetivo área, PSNR de pelo menos 40 dB, heurística de eficiência. Por operação, cada cópia é um grupo; por operação do código, as cópias de uma operação recebem a mesma unidade. A última coluna conta as operações do código cujas cópias ficaram com unidades diferentes.\n');
    table('E6: grupos por operação contra por operação do código, com unroll de 2', ['Kernel', 'Grupos', 'Avaliações', 'Economia de área', 'PSNR medido', 'Operações aproximadas', 'Cópias diferentes'], tab, ['l', 'l', 'r', 'r', 'r', 'r', 'r']);
}

// E7: SSIM ---------------------------------------------------------------------------------------------------------
function e7() {
    const rows = [['kernel', 'family', 'ops', 'ssim_measured', 'ssim_bins', 'ssim_indep', 'ssim_analytic', 'psnr_measured']];
    const kernels = QUICK ? ['gauss'] : ['gauss', 'gauss-seq', 'sobel', 'sharpen'];
    for (const k of kernels) {
        const base = synthesize(KCODE[k], { synth, cells });
        const inputs = makeInputs(base.design, 'image');
        const prof = execute(base.design, inputs, { profile: true });
        for (const [fam, mre, are] of FAMILIES) {
            const asg = new Map();
            for (const op of base.ops.list) {
                const re = op.cls === 'mul' ? mre : are;
                const n = re && op.candidates.find((c) => re.test(c));
                if (n) asg.set(op.id, n);
            }
            if (!asg.size) continue;
            const r = synthesize(KCODE[k], { synth, cells, assign: asg, design: base.design });
            const ops = new Map([...asg].map(([id, n]) => [id, opFunction(r.lib, r.ops.byId.get(id), n)]));
            const m = compareOutputs(r.design, prof, execute(r.design, inputs, { ops }))[0];
            if (m.SSIM === null) continue;
            const es = [...estimateError(r, prof, { method: 'sampled', budget: false }).outputs.values()][0];
            const ea = [...estimateError(r, prof, { method: 'analytic', budget: false }).outputs.values()][0];
            rows.push([k, fam, asg.size, m.SSIM, es.SSIM, es.SSIMindep, ea.SSIM, m.PSNR]);
        }
        log('E7', k);
    }
    save('e7_ssim_estimativa.csv', csv(rows));
    const data = rows.slice(1).filter((r) => r[3] < 1);
    const stat = (col) => {
        const d = data.map((r) => r[col] - r[3]);
        const a = d.map(Math.abs).sort((x, y) => x - y);
        const within = (t) => d.filter((x) => Math.abs(x) <= t).length / d.length;
        const hi = data.filter((r) => r[3] >= 0.95);
        const dh = hi.map((r) => Math.abs(r[col] - r[3])).sort((x, y) => x - y);
        return { med: a[Math.floor(a.length / 2)], w1: within(0.01), w5: within(0.05), worst: a[a.length - 1], below: d.filter((x) => x <= 1e-9).length / d.length, hiMed: dh.length ? dh[Math.floor(dh.length / 2)] : null, hiN: hi.length };
    };
    const B = stat(4), I = stat(5), A = stat(6);
    md.push('### E7. SSIM: estimativa e exploração\n', `SSIM padrão (janela gaussiana 11 × 11, σ = 1,5) na saída de imagem, com a imagem de teste; ${data.length} casos (kernel e família de unidades, como no E1). A estimativa usa as estatísticas locais da imagem exata e o erro do modelo estático: pela faixa de valor da saída (média e variância do erro em 32 faixas, do modelo por amostras), como ruído independente do sinal, ou pelo modelo analítico (sem as faixas, o ganho é zero e cai na fórmula do ruído independente). "Abaixo do medido" é a fração dos casos em que a estimativa é conservadora.\n`);
    table('E7: SSIM estimado contra o medido', ['Estimativa', 'Diferença mediana', 'Até 0,01', 'Até 0,05', 'Pior diferença', 'Abaixo do medido', `Mediana com SSIM ≥ 0,95 (${B.hiN} casos)`], [
        ['por faixa de valor (amostras)', br(B.med, 4), pctBr(B.w1, 0), pctBr(B.w5, 0), br(B.worst, 3), pctBr(B.below, 0), br(B.hiMed, 4)],
        ['ruído independente (amostras)', br(I.med, 4), pctBr(I.w1, 0), pctBr(I.w5, 0), br(I.worst, 3), pctBr(I.below, 0), br(I.hiMed, 4)],
        ['analítico', br(A.med, 4), pctBr(A.w1, 0), pctBr(A.w5, 0), br(A.worst, 3), pctBr(A.below, 0), br(A.hiMed, 4)],
    ], ['l', 'r', 'r', 'r', 'r', 'r', 'r']);
    // Exploração com a restrição em SSIM.
    const drows = [['kernel', 'ssim_min', 'evaluations', 'area_saving', 'ssim_est', 'ssim_measured', 'psnr_measured', 'verify_tries', 'verified', 'units']];
    const tab = [];
    for (const k of QUICK ? ['gauss'] : ['gauss', 'sobel', 'sharpen']) for (const lim of QUICK ? [0.98] : [0.95, 0.98, 0.99]) {
        const r = explore(KCODE[k], { synth, cells, objective: 'area', constraint: { metric: 'ssim', value: lim }, granularity: 'op', heuristic: 'efficiency' });
        const run = r.runs[0], p = run.chosen;
        log('E7', k, lim);
        const est = p?.outs[0].SSIM ?? null, meas = p?.measured?.[0].SSIM ?? null;
        drows.push([k, lim, run.evals, p ? 1 - p.score / r.refScore : null, est, meas, p?.measured?.[0].PSNR ?? null, run.verifyTries, !!p, p?.units.join(' + ') ?? '']);
        tab.push([k, br(lim, 2), String(run.evals), p ? pctBr(1 - p.score / r.refScore) : '-', br(est, 4), br(meas, 4), br(p?.measured?.[0].PSNR ?? null, 1), String(run.verifyTries)]);
    }
    save('e7_ssim_exploracao.csv', csv(drows));
    table('E7: exploração por operação com restrição em SSIM (heurística de eficiência, área)', ['Kernel', 'SSIM mín.', 'Avaliações', 'Economia de área', 'SSIM estimado', 'SSIM medido', 'PSNR medido', 'Verificações'], tab, ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r']);
}

// E5: sensibilidade aos dados ------------------------------------------------------------------------------------------
function e5() {
    const tab = [];
    const rows = [['kernel', 'optimized_on', 'verified_on', 'psnr_min', 'area_saving', 'psnr_on_opt_data', 'psnr_on_other_data', 'units']];
    for (const k of QUICK ? ['gauss'] : ['gauss', 'sobel', 'sharpen']) for (const [a, b] of [['uniform', 'image'], ['image', 'uniform']]) {
        const r = explore(KCODE[k], { synth, cells, objective: 'area', constraint: { metric: 'psnr', value: 40 }, granularity: 'class', heuristic: 'exhaustive', input: a });
        const p = r.runs[0].chosen ?? r.runs[0].best;
        // O mesmo projeto com os outros dados.
        const base = synthesize(KCODE[k], { synth, cells });
        const rr = synthesize(KCODE[k], { synth, cells, assign: p.assign, design: base.design });
        const other = analyzeError(rr, { inputs: makeInputs(rr.design, b), budget: false }).measured;
        const own = Math.min(...p.measured.map((o) => o.PSNR)), oth = Math.min(...other.map((o) => o.PSNR));
        rows.push([k, a, b, 40, 1 - p.cost.area / r.ref.area, own, oth, p.units.join(' + ')]);
        tab.push([k, a === 'image' ? 'imagem' : 'uniformes', pctBr(1 - p.cost.area / r.ref.area), br(own, 1), br(oth, 1), oth >= 40 ? 'sim' : 'não']);
        log('E5', k, a);
    }
    save('e5_sensibilidade_dados.csv', csv(rows));
    md.push('### E5. Sensibilidade aos dados de entrada\n', 'O projeto escolhido (exaustiva por classe, área, PSNR de pelo menos 40 dB) com um conjunto de dados, verificado no outro.\n');
    table('E5: o projeto otimizado com um conjunto de dados, medido no outro', ['Kernel', 'Otimizado com', 'Economia de área', 'PSNR nos mesmos dados', 'PSNR nos outros dados', 'Mantém 40 dB'], tab, ['l', 'l', 'r', 'r', 'r', 'l']);
}

const t0 = Date.now();
const summary = { meta };
md.push('# Resultados dos estudos de caso', '', `Gerado por \`scripts/experiments.mjs\` em ${meta.date.slice(0, 10)} (commit ${meta.commit ?? '-'}, Node ${meta.node}${QUICK ? ', modo rápido' : ''}); biblioteca sintetizada de ${meta.synth.generated} (${meta.synth.library}). Período de 5 ns, fluxo de atraso mínimo, 2 portas por banco, salvo indicação. A metodologia e as limitações estão em \`docs/METODOLOGIA.md\`.`, '');
if (ONLY.has('E1')) summary.e1 = e1();
if (ONLY.has('E2')) e2();
if (ONLY.has('E3')) e3();
if (ONLY.has('E4')) e4();
if (ONLY.has('E5')) e5();
if (ONLY.has('E6')) e6();
if (ONLY.has('E7')) e7();
meta.seconds = Math.round((Date.now() - t0) / 1000);
md.push(`Tempo total: ${meta.seconds} s.`, '');
save('RESULTADOS.md', `${md.join('\n')}\n`);
save('tabelas.tex', `% Tabelas dos estudos de caso (scripts/experiments.mjs). Requer \\usepackage[table]{xcolor} e a cor tabAzul definida.\n\n${tex.join('\n')}`);
save('meta.json', `${JSON.stringify(meta, null, 1)}\n`);
