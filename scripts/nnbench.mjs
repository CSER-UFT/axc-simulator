#!/usr/bin/env node
/**
 * Avaliação das buscas de unidades por camada das redes: roda uma matriz de casos pela linha de comando
 * (node bin/axc.mjs nnsearch --json) e grava o relatório em results/nn-search/<id>/ (LEIAME.md, casos.csv, casos.json).
 *
 *   node scripts/nnbench.mjs [--models minilenet-mnist,lenet5-cifar10] [--objectives area,luts] [--samples 250,0]
 *        [--heuristics sensitivity,sequential,h:local,h:sequential,h:efficiency,h:ga] [--drops 1] [--workers N]
 *        [--id nome] [--note "texto"] [--quick]
 *   node scripts/nnbench.mjs --report <id>   (refaz o LEIAME.md de results/nn-search/<id> a partir do casos.json,
 *                                             mantendo a linha de comando e a nota do relatório anterior)
 *
 * Heurísticas com h: são da busca híbrida (--hybrid --heuristic ...); as outras, da busca medida. --quick: só a
 * MiniLenet, objetivo área, amostra de 250, sensibilidade e busca local híbrida.
 *
 * Para cada caso: a economia do ponto escolhido, a queda de acurácia na amostra (a que a busca vê), na validação
 * inteira (a do limite) e no teste (que a busca não vê), o tempo, as classificações e, na híbrida, quantos pontos
 * foram verificados. A coluna "coberto" diz se algum ponto visitado, viável na amostra e aprovado na validação
 * inteira, custa menos que o escolhido (não deveria acontecer). O resumo, no início do LEIAME.md, agrupa os casos por
 * heurística e amostra: economia média e mínima, a economia em relação à melhor do mesmo caso (modelo, objetivo e
 * amostra), quantos casos ficaram abaixo de 2/3 da melhor, as quedas médias e o tempo médio.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const list = (k, d) => opt(k, d).split(',').map((x) => x.trim()).filter(Boolean);
const quick = args.includes('--quick');
const models = list('--models', 'minilenet-mnist');
const objectives = quick ? ['area'] : list('--objectives', 'area,luts');
const samples = (quick ? ['250'] : list('--samples', '250,0')).map(Number);
const heuristics = quick ? ['sensitivity', 'h:local'] : list('--heuristics', 'sensitivity,sequential,h:local,h:sequential');
const drops = list('--drops', '1').map(Number);
const workers = opt('--workers', null);
const report = opt('--report', null);
const id = report ?? opt('--id', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
const outDir = join(ROOT, 'results/nn-search', id);
mkdirSync(outDir, { recursive: true });

let rows = [];
// Linha de comando registrada no LEIAME.md (mantida quando o relatório é refeito com --report).
let cmd = `node scripts/nnbench.mjs ${args.join(' ')}`;
// Nota livre (--note), entre o título e a linha de comando.
let note = opt('--note', '');
if (report) {
    const f = join(outDir, 'casos.json');
    if (!existsSync(f)) { process.stderr.write(`não existe ${f}\n`); process.exit(1); }
    rows = JSON.parse(readFileSync(f, 'utf8'));
    const text = existsSync(join(outDir, 'LEIAME.md')) ? readFileSync(join(outDir, 'LEIAME.md'), 'utf8') : '';
    const old = text.match(/Gerado por `([^`]+)`/);
    if (old) cmd = old[1];
    const between = text.match(/^# [^\n]*\n\n([\s\S]*?)\n*Gerado por `/);
    if (!note && between) note = between[1].trim();
}
const total = models.length * objectives.length * samples.length * heuristics.length * drops.length;
let k = 0;
if (!report) for (const model of models) for (const objective of objectives) for (const sample of samples) for (const maxDrop of drops) for (const h of heuristics) {
    k++;
    const hybrid = h.startsWith('h:');
    const a = ['bin/axc.mjs', 'nnsearch', '--json', '--points', '--model', model, '--objective', objective, '--sample', String(sample), '--max-drop', String(maxDrop), '--heuristic', hybrid ? h.slice(2) : h];
    if (hybrid) a.push('--hybrid');
    if (workers) a.push('--workers', workers);
    process.stderr.write(`[${k}/${total}] ${model} ${objective} amostra ${sample || 'todas'} ${h} ${maxDrop} p.p.\n`);
    const t0 = Date.now();
    const p = spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
    if (p.status !== 0) { rows.push({ model, objective, sample, heuristic: h, maxDrop, error: (p.stderr || p.stdout).trim().split('\n').at(-1) }); continue; }
    const r = JSON.parse(p.stdout);
    const full = r.exact.accValFull !== undefined;
    const pts = Array.isArray(r.points) ? r.points : [];
    // Pontos visitados viáveis (na híbrida, os classificados) e aprovados na validação inteira, quando há amostra.
    const okPts = hybrid
        ? pts.filter((q) => q.measured?.ok && (q.measured.fullOk ?? !full))
        : pts.filter((q) => q.feasible && (q.fullOk ?? !full));
    const cheapest = okPts.reduce((m, q) => Math.min(m, q.cost), Infinity);
    rows.push({
        model, objective, sample: r.sample, heuristic: h, maxDrop,
        saving: r.best.saving,
        dropSample: r.exact.accVal - r.best.accVal,
        dropVal: full ? r.exact.accValFull - r.best.accValFull : r.exact.accVal - r.best.accVal,
        dropTest: r.exact.accTest - r.best.accTest,
        accExactSample: r.exact.accVal, accExactVal: full ? r.exact.accValFull : r.exact.accVal,
        evals: r.evals, verified: r.verified ?? null, rounds: r.rounds ?? null, repaired: r.repaired ?? 0,
        covered: Number.isFinite(cheapest) && cheapest < r.best.cost - 1e-6,
        ms: Date.now() - t0, units: r.best.assign.map((u, i) => `${i}:${u.mul ?? '-'}/${u.add ?? '-'}`).join(' '),
    });
}

const pct = (v, d = 1) => (v === undefined || v === null ? '' : (100 * v).toFixed(d));
const head = ['modelo', 'objetivo', 'amostra', 'heurística', 'limite', 'economia %', 'queda amostra', 'queda validação', 'queda teste', 'exata amostra %', 'exata validação %', 'pontos', 'verificados', 'rodadas', 'reparos', 'coberto', 's'];
const line = (r) => (r.error ? [r.model, r.objective, r.sample, r.heuristic, r.maxDrop, `erro: ${r.error}`] : [r.model, r.objective, r.sample, r.heuristic, r.maxDrop, pct(r.saving), pct(r.dropSample, 2), pct(r.dropVal, 2), pct(r.dropTest, 2), pct(r.accExactSample), pct(r.accExactVal), r.evals, r.verified ?? '', r.rounds ?? '', r.repaired, r.covered ? 'sim' : '', (r.ms / 1000).toFixed(0)]);
if (!report) writeFileSync(join(outDir, 'casos.json'), `${JSON.stringify(rows, null, 1)}\n`);
writeFileSync(join(outDir, 'casos.csv'), `${[head, ...rows.map(line)].map((x) => x.join(',')).join('\n')}\n`);
// Resumo por heurística e amostra.
const ok = rows.filter((r) => !r.error);
const caseKey = (r) => [r.model, r.objective, r.sample, r.maxDrop].join('|');
const bestOf = new Map();
for (const r of ok) bestOf.set(caseKey(r), Math.max(bestOf.get(caseKey(r)) ?? 0, r.saving));
const groups = new Map();
for (const r of ok) { const g = `${r.heuristic}|${r.sample}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sumHead = ['heurística', 'amostra', 'casos', 'economia média %', 'economia mínima %', 'da melhor %', 'abaixo de 2/3 da melhor', 'queda validação', 'queda teste', 's'];
const sumRows = [...groups].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, a]) => [
    a[0].heuristic, a[0].sample, a.length, pct(mean(a.map((r) => r.saving))), pct(Math.min(...a.map((r) => r.saving))),
    pct(mean(a.map((r) => (bestOf.get(caseKey(r)) > 0 ? r.saving / bestOf.get(caseKey(r)) : 1))), 0),
    a.filter((r) => r.saving < (2 / 3) * bestOf.get(caseKey(r))).length,
    pct(mean(a.map((r) => r.dropVal)), 2), pct(mean(a.map((r) => r.dropTest)), 2), (mean(a.map((r) => r.ms)) / 1000).toFixed(0),
]);
const over = ok.filter((r) => r.dropVal > r.maxDrop / 100 + 1e-9).length, covered = ok.filter((r) => r.covered).length, errors = rows.length - ok.length;
const md = [
    `# Buscas das redes: ${id}`,
    '',
    ...(note ? [note, ''] : []),
    `Gerado por \`${cmd}\`. Quedas em pontos percentuais; a do limite é a da validação inteira.`,
    '',
    `## Resumo`,
    '',
    `${ok.length} casos; acima do limite na validação inteira: ${over}; ponto escolhido coberto: ${covered}; erros: ${errors}.`,
    '',
    `| ${sumHead.join(' | ')} |`,
    `| ${sumHead.map(() => '---').join(' | ')} |`,
    ...sumRows.map((x) => `| ${x.join(' | ')} |`),
    '',
    `## Casos`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${line(r).join(' | ')} |`),
    '',
];
writeFileSync(join(outDir, 'LEIAME.md'), md.join('\n'));
process.stdout.write(md.join('\n'));
