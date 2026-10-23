#!/usr/bin/env node
/**
 * Interface de linha de comando do simulador: os mesmos modelos da página (js/axc), sem o navegador, para
 * experimentos em script. Saída em texto, CSV ou JSON.
 *
 *   node bin/axc.mjs list [--group mul8|mul16|add8|add16]
 *   node bin/axc.mjs metrics <unidade> [--dist uniform|normal|exp|lenet|image] [--samples N] [--seed S]
 *   node bin/axc.mjs sweep --group mul8 [--dist ...] [--format csv|json]
 *   node bin/axc.mjs synth <unidade>
 *   node bin/axc.mjs verilog <unidade> [--tb] [--out arquivo.v]
 *   node bin/axc.mjs lenet <multiplicador> [--add <somador>] [--tree | --dirs "..."] [--model lenet5-mnist|minilenet-mnist|...]
 *                          [--layers conv1,conv2,...]
 *   node bin/axc.mjs nncost [--model minilenet-mnist|...] [--mul <multiplicador>] [--add <somador>] [--layers conv1,...]
 *                           [--dirs "..."] [--clock 10] [--target asic|fpga] [--flow delay|area|iso] [--kernels pasta]
 *       custo da rede pelo modelo de síntese de alto nível (código gerado por js/axc/nngen.js), por camada e no total;
 *       --kernels grava o código de cada camada (na linguagem da página de síntese de alto nível)
 *       --dirs: diretivas das camadas com pesos, "camada:item,item;camada:..." com os itens pixel|tap|off (conv),
 *       input|off (densa), ii=N, par=N e part (por exemplo "conv1:pixel,part;conv2:tap;fc1:par=7,part"); as camadas
 *       omitidas ficam com o padrão. No lenet, a estrutura da soma das camadas aproximadas passa a ser a das diretivas.
 *   node bin/axc.mjs nnsearch [--model minilenet-mnist|...] [--objective area|luts|energy] [--max-drop 1]
 *                             [--heuristic sensitivity|sequential] [--dirs "..."] [--clock 10] [--workers N] [--cands 12]
 *       busca do multiplicador e do somador de cada camada (js/axc/nnsearch.js): o menor custo com a queda de
 *       acurácia na validação até --max-drop pontos; a acurácia de teste do ponto escolhido no fim. --workers: threads
 *       de avaliação (padrão: os núcleos menos 1; 1 avalia na própria thread)
 *   node bin/axc.mjs hls <kernel.c | --example gauss|sobel|sharpen|fir|dot> [--clock ns] [--flow delay|area|iso] [--ports n]
 *        [--ops] [--approx "alvo=unidade;..."] [--error] [--input image|uniform] [--model sampled|analytic]
 *   node bin/axc.mjs dse <kernel.c | --example id> [--objective area|luts|energy|latency|interval|weighted]
 *        [--weights 1,1,1] [--psnr dB | --mse v | --ssim s] [--granularity class|line|source|op] [--heuristic sequential|efficiency|
 *        exhaustive|random|local|tabu|grasp|ga|all] [--clocks 5,2.5] [--input image|uniform] [--model sampled|analytic]
 *        [--all-units] [--samples n] [--verify-front n] [--csv]
 *
 * A <unidade> é o nome mostrado na página (por exemplo "MUL8 DRUM4", "MUL16 T8 A8c", "ADD16 LOA8"), procurado no
 * espaço de projeto e nas pré-definidas, ou uma configuração em JSON ({"kind":"mul","width":8,"method":"drum","k":4}).
 * No hls, --ops lista as somas e multiplicações que aceitam unidade aproximada; --approx atribui unidades (o alvo é
 * o nó, como S1.3, o grupo linha:operação, como 16:mul8, a classe, como mul8, ou *); --error estima o erro nas saídas
 * (modelo estático) e o mede na execução bit a bit. O dse explora as unidades (e, com --clocks, o período), com as
 * diretivas do código, a restrição de erro e o objetivo dados; --heuristic all compara as heurísticas.
 * Todos os comandos aceitam --json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUnit, unitName } from '../js/axc/units.js';
import { testInputs, errorMetrics, loadOperands, APP_DISTRIBUTIONS, DISTRIBUTIONS } from '../js/axc/metrics.js';
import { toVerilog, testbench, moduleName } from '../js/axc/verilog.js';
import { designSpace } from '../js/axc/designspace.js';
import { PRESETS } from '../js/axc/presets.js';
import { decodeNet, decodeTestSet, productTable, classifyRange, adderAccumulate, summarize } from '../js/axc/nn.js';
import { networkCost, networkKernels, normalizeDirectives, directiveTrees, CONV_PIPES, DENSE_PIPES } from '../js/axc/nngen.js';
import { prepareSearch, searchNetwork, poolEngine, initMessage, SEARCH_OBJECTIVES, SEARCH_HEURISTICS } from '../js/axc/nnsearch.js';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

import { synthesize } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';
import { parseAssign } from '../js/hls/approx.js';
import { analyzeError } from '../js/hls/error.js';
import { makeInputs } from '../js/hls/exec.js';
import { explore, pointSummary } from '../js/hls/dse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--') && !['--json', '--tb'].includes(all[i - 1])));
const opt = (name, def) => { const k = argv.indexOf(name); return k >= 0 ? argv[k + 1] : def; };
const flag = (name) => argv.includes(name);
const out = (obj, text) => console.log(flag('--json') ? JSON.stringify(obj, null, 1) : text());
const die = (msg) => { console.error(msg); process.exit(1); };

const ALL = (() => {
    const m = new Map();
    for (const c of [...PRESETS, ...designSpace()]) m.set(unitName(c).toUpperCase(), c);
    return m;
})();
function cfgOf(spec) {
    if (!spec) die('falta a unidade (nome, como "MUL8 DRUM4", ou configuração em JSON)');
    if (spec.trim().startsWith('{')) return JSON.parse(spec);
    const c = ALL.get(spec.trim().toUpperCase().replace(/ EXACT$/, ' EXATO'));
    if (!c) die(`unidade desconhecida: ${spec} (veja node bin/axc.mjs list)`);
    return c;
}
let opsLoaded = false;
function inputs(cfg, dist) {
    if (APP_DISTRIBUTIONS.includes(dist) && !opsLoaded) {
        const buf = readFileSync(join(ROOT, 'data/operands.bin'));
        loadOperands(JSON.parse(readFileSync(join(ROOT, 'data/operands.json'), 'utf8')), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        opsLoaded = true;
    }
    if (![...DISTRIBUTIONS, ...APP_DISTRIBUTIONS].includes(dist)) die(`distribuição desconhecida: ${dist}`);
    return testInputs(cfg.width, dist, +opt('--samples', 200000), +opt('--seed', 12345), cfg.kind);
}
const METRICS = ['MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP'];
function metrics(cfg, dist) {
    const unit = buildUnit(cfg);
    const m = errorMetrics(unit, inputs(cfg, dist));
    return { name: unitName(cfg), cfg, dist, n: m.n, gates: unit.net.gates, depth: unit.net.delay(), ...Object.fromEntries(METRICS.map((k) => [k, m[k]])), ci: m.ci };
}
const synthData = () => {
    const f = join(ROOT, 'data/synth.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : die('data/synth.json não encontrado');
};
const groupOf = (c) => `${c.kind}${c.width}`;

/** Diretivas das camadas com pesos: "conv1:pixel,par=3,part;fc1:par=7" ou JSON (lista na ordem das camadas). */
function parseDirs(net, text) {
    if (!text) return normalizeDirectives(net, null);
    if (text.trim().startsWith('[')) return normalizeDirectives(net, JSON.parse(text));
    const names = net.sites.map((l) => l.name);
    const dirs = net.sites.map(() => ({}));
    for (const part of text.split(';').map((x) => x.trim()).filter(Boolean)) {
        const [name, items = ''] = part.split(':');
        const i = names.indexOf(name.trim());
        if (i < 0) die(`--dirs: camada desconhecida ${name} (${names.join(', ')})`);
        const pipes = net.sites[i].type === 'conv' ? CONV_PIPES : DENSE_PIPES;
        for (const it of items.split(',').map((x) => x.trim()).filter(Boolean)) {
            const [k, v] = it.split('=');
            if (pipes.includes(k)) dirs[i].pipe = k;
            else if (k === 'part') dirs[i].part = true;
            else if (k === 'ii' || k === 'par') dirs[i][k] = +v;
            else die(`--dirs: item desconhecido ${it} em ${name} (${pipes.join(', ')}, ii=N, par=N, part)`);
        }
    }
    const norm = normalizeDirectives(net, dirs);
    norm.forEach((d, i) => { if (dirs[i].par && d.par !== dirs[i].par) die(`--dirs: par=${dirs[i].par} inválido em ${names[i]} (divisores de ${net.sites[i].type === 'conv' ? 'filtros, só com pixel' : 'entradas'})`); });
    return norm;
}

switch (cmd) {
    case 'list': {
        const g = opt('--group');
        const list = designSpace().filter((c) => !g || groupOf(c) === g);
        out(list.map((c) => ({ name: unitName(c), cfg: c })), () => list.map((c) => `${unitName(c).padEnd(22)} ${JSON.stringify(c)}`).join('\n'));
        break;
    }
    case 'metrics': {
        const r = metrics(cfgOf(pos[0]), opt('--dist', 'uniform'));
        out(r, () => [`${r.name} (${r.dist}, ${r.n} pares)`, ...METRICS.map((k) => `${k.padEnd(5)} ${r[k]}${r.ci?.[k] ? `  ± ${r.ci[k]}` : ''}`), `portas ${r.gates}, profundidade ${r.depth}`].join('\n'));
        break;
    }
    case 'sweep': {
        const g = opt('--group') ?? die('falta --group');
        const dist = opt('--dist', 'uniform');
        const rows = designSpace().filter((c) => groupOf(c) === g).map((c) => metrics(c, dist));
        if (opt('--format') === 'json' || flag('--json')) { console.log(JSON.stringify(rows, null, 1)); break; }
        const cols = ['name', 'gates', 'depth', ...METRICS, ...METRICS.filter((k) => k !== 'WCE').map((k) => `${k}_ci95`)];
        console.log(cols.join(','));
        for (const r of rows) console.log(cols.map((k) => (k.endsWith('_ci95') ? r.ci?.[k.slice(0, -5)] ?? '' : k === 'name' ? `"${r.name}"` : r[k])).join(','));
        break;
    }
    case 'synth': {
        const cfg = cfgOf(pos[0]);
        const d = synthData().designs.find((x) => x.name === unitName(cfg)) ?? die(`${unitName(cfg)} não está entre as configurações sintetizadas`);
        out(d, () => [`${d.name}: ${d.luts} LUTs, ${d.carry4} CARRY4 (FPGA)`, ...Object.entries(d.asic.flows).map(([k, f]) => `${k.padEnd(5)} ${f.area} µm², ${f.delay} ps, ${f.energy} fJ, ${f.leakage} nW`),
            `energia com operandos reais (atraso mínimo): ${Object.entries(d.asic.energyApp ?? {}).map(([k, v]) => `${k} ${v} fJ`).join(', ')}`].join('\n'));
        break;
    }
    case 'verilog': {
        const cfg = cfgOf(pos[0]);
        const unit = buildUnit(cfg);
        const name = moduleName(cfg);
        let text = toVerilog(unit, name);
        if (flag('--tb')) {
            const inp = testInputs(cfg.width, 'uniform', 20000, 2026);
            text += `\n${testbench(unit, inp.a.length, `${name}.hex`, name)}`;
        }
        if (opt('--out')) writeFileSync(opt('--out'), text); else process.stdout.write(text);
        break;
    }
    case 'lenet': {
        const dirsOf = (net) => parseDirs(net, opt('--dirs'));
        const mul = cfgOf(pos[0]);
        if (mul.kind !== 'mul') die('o primeiro argumento do lenet é um multiplicador');
        const add = opt('--add') ? cfgOf(opt('--add')) : null;
        if (add && add.kind !== 'add') die('--add espera um somador');
        const reg = JSON.parse(readFileSync(join(ROOT, 'data/nn/models.json'), 'utf8'));
        const entry = reg.models.find((m) => m.id === opt('--model', 'lenet5-mnist')) ?? die(`modelo desconhecido: ${opt('--model')} (${reg.models.map((m) => m.id).join(', ')})`);
        const net = decodeNet(JSON.parse(readFileSync(join(ROOT, entry.file), 'utf8')));
        const test = decodeTestSet(readFileSync(join(ROOT, net.dataset.file)), net.dataset);
        const names = net.sites.map((l) => l.name);
        const layers = (opt('--layers') ?? names.join(',')).split(',');
        for (const l of layers) if (!names.includes(l)) die(`camada desconhecida: ${l} (${names.join(', ')})`);
        const T = productTable(buildUnit(mul)), Tx = productTable(null);
        const acc = add ? adderAccumulate(buildUnit(add)) : null;
        const mask = names.map((l) => layers.includes(l));
        // --tree: a soma das camadas aproximadas em árvore (o laço desenrolado), em vez de em cadeia; --dirs: a das
        // diretivas (a mesma do código gerado e do custo).
        const trees = opt('--dirs') ? directiveTrees(net, dirsOf(net)) : names.map(() => (flag('--tree') ? 0 : 1));
        const run = (tables, adds) => classifyRange(net, test, tables, adds, 0, test.n, new Uint8Array(test.n), trees);
        const ref = run(names.map(() => Tx), []);
        const preds = run(mask.map((m) => (m ? T : Tx)), mask.map((m) => (m ? acc : null)));
        const s = summarize(test, preds, ref, net.classes), s0 = summarize(test, ref, null, net.classes);
        const r = { model: net.id, mul: unitName(mul), add: add ? unitName(add) : null, sum: add ? (opt('--dirs') ? `dirs ${trees.join(',')}` : flag('--tree') ? 'tree' : 'chain') : null, layers, accuracy: s.accuracy, exactAccuracy: s0.accuracy, broke: s.broke.length, fixed: s.fixed };
        out(r, () => `${net.name}, ${r.mul}${r.add ? ` + ${r.add} (${r.sum === 'tree' ? 'árvore' : r.sum === 'chain' ? 'cadeia' : `estrutura das diretivas: ${trees.join(', ')}`})` : ''} em ${layers.join(', ')}: acurácia ${(100 * r.accuracy).toFixed(1)}% (exata ${(100 * r.exactAccuracy).toFixed(1)}%), ${r.broke} erradas a mais, ${r.fixed} corrigidas`);
        break;
    }
    case 'nncost': {
        const reg = JSON.parse(readFileSync(join(ROOT, 'data/nn/models.json'), 'utf8'));
        const entry = reg.models.find((m) => m.id === opt('--model', 'minilenet-mnist')) ?? die(`modelo desconhecido: ${opt('--model')} (${reg.models.map((m) => m.id).join(', ')})`);
        const net = decodeNet(JSON.parse(readFileSync(join(ROOT, entry.file), 'utf8')));
        const names = net.sites.map((l) => l.name);
        const layers = (opt('--layers') ?? names.join(',')).split(',');
        for (const l of layers) if (!names.includes(l)) die(`camada desconhecida: ${l} (${names.join(', ')})`);
        const unitArg = (k, kind) => { const v = opt(k); if (!v) return null; const c = cfgOf(v); if (c.kind !== kind) die(`${k} espera um ${kind === 'mul' ? 'multiplicador' : 'somador'}`); return unitName(c); };
        const dirs = parseDirs(net, opt('--dirs'));
        if (opt('--kernels')) {
            const dir = opt('--kernels');
            for (const k of networkKernels(net, dirs)) writeFileSync(join(dir, `${k.name}.c`), k.src);
        }
        let c;
        try {
            c = networkCost(net, {
                synth: synthData(), cells: JSON.parse(readFileSync(join(ROOT, 'data/hls-cells.json'), 'utf8')),
                fpga: existsSync(join(ROOT, 'data/vivado-units.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/vivado-units.json'), 'utf8')) : null,
                target: opt('--target', 'asic'), flow: opt('--flow', 'delay'), clockNs: +opt('--clock', 10),
                mul: unitArg('--mul', 'mul'), add: unitArg('--add', 'add'), mask: names.map((l) => layers.includes(l)), dirs,
            });
        } catch (e) { die(e.message); }
        const r = { model: net.id, dirs, ...c };
        for (const l of r.layers) delete l.src;
        const dirText = (d, l) => (l.type === 'conv' ? [d.pipe] : d.pipe === 'off' ? ['off'] : []).concat(d.pipe !== 'off' ? [`II ${d.ii}`] : [], d.par > 1 ? [`par ${d.par}`] : [], d.part ? ['part'] : []).join(' ');
        out(r, () => [
            `${net.name} (${net.dataset.name}), ${c.totals.clockNs} ns${opt('--mul') || opt('--add') ? `, ${[opt('--mul'), opt('--add')].filter(Boolean).join(' + ')} em ${layers.join(', ')}` : ', unidades exatas'}`,
            'camada       ciclos    II   área (µm²)    LUT     FF  DSP  energia (nJ)  unidades',
            ...c.layers.map((l) => `${l.name.padEnd(9)} ${String(l.cycles).padStart(9)} ${String(l.II ?? '-').padStart(5)} ${l.area.toFixed(0).padStart(12)} ${String(l.luts).padStart(6)} ${String(l.ff).padStart(6)} ${String(l.dsp).padStart(4)} ${(l.energy / 1e6).toFixed(2).padStart(13)}  ${l.units.map((u) => `${u.count} × ${u.name}`).join(', ')}`),
            `total     ${String(c.totals.cycles).padStart(9)} ${''.padStart(5)} ${c.totals.area.toFixed(0).padStart(12)} ${String(c.totals.luts).padStart(6)} ${String(c.totals.ff).padStart(6)} ${String(c.totals.dsp).padStart(4)} ${(c.totals.energy / 1e6).toFixed(2).padStart(13)}  (${c.totals.timeUs.toFixed(1)} µs por imagem)`,
            `diretivas: ${net.sites.map((l, i) => `${l.name} ${dirText(dirs[i], l)}`).join('; ')}`,
            ...c.layers.filter((l) => l.IIwhy && l.IIwhy.kind !== 'target').map((l) => `II de ${l.name} limitado por ${l.IIwhy.kind === 'mem' ? `memória (${l.IIwhy.label}: ${l.IIwhy.uses} acessos, ${l.IIwhy.cap} portas)` : l.IIwhy.kind === 'rec' ? `recorrência (${l.IIwhy.key})` : l.IIwhy.kind}`),
            ...c.warnings.map((w) => `aviso: ${w}`),
        ].join('\n'));
        break;
    }
    case 'nnsearch': {
        const reg = JSON.parse(readFileSync(join(ROOT, 'data/nn/models.json'), 'utf8'));
        const entry = reg.models.find((m) => m.id === opt('--model', 'minilenet-mnist')) ?? die(`modelo desconhecido: ${opt('--model')} (${reg.models.map((m) => m.id).join(', ')})`);
        const netJson = JSON.parse(readFileSync(join(ROOT, entry.file), 'utf8'));
        const net = decodeNet(netJson), ds = net.dataset;
        if (!ds.val) die(`${net.id} não tem conjunto de validação`);
        const valBuf = readFileSync(join(ROOT, ds.val.file));
        const val = decodeTestSet(valBuf, { ...ds, n: ds.val.n }), test = decodeTestSet(readFileSync(join(ROOT, ds.file)), ds);
        const objective = opt('--objective', 'area'), heuristic = opt('--heuristic', 'sensitivity');
        if (!SEARCH_OBJECTIVES.includes(objective)) die(`objetivo: ${SEARCH_OBJECTIVES.join(', ')}`);
        if (!SEARCH_HEURISTICS.includes(heuristic)) die(`heurística: ${SEARCH_HEURISTICS.join(', ')}`);
        const dirs = parseDirs(net, opt('--dirs'));
        const synthJ = synthData();
        const fpgaJ = existsSync(join(ROOT, 'data/vivado-units.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/vivado-units.json'), 'utf8')) : null;
        const t0 = Date.now();
        let P;
        try {
            P = prepareSearch(net, { val, test, synth: synthJ, cells: JSON.parse(readFileSync(join(ROOT, 'data/hls-cells.json'), 'utf8')), fpga: fpgaJ, objective, dirs, clockNs: +opt('--clock', 10), maxCands: +opt('--cands', 12) });
        } catch (e) { die(e.message); }
        const prepMs = Date.now() - t0;
        const nw = Math.max(1, +opt('--workers', Math.max(1, availableParallelism() - 1)));
        let engine, workers = [];
        if (nw > 1) {
            const init = initMessage(netJson, valBuf, synthJ, P.trees);
            workers = Array.from({ length: nw }, () => new Worker(new URL('./nn-eval-worker.mjs', import.meta.url)));
            const send = workers.map((w) => {
                let next = 0;
                const wait = new Map();
                w.on('message', ({ id, reply }) => { const f = wait.get(id); wait.delete(id); f(reply); });
                return (msg) => new Promise((res, rej) => { const id = next++; wait.set(id, (r) => (r.type === 'error' ? rej(new Error(r.message)) : res(r))); w.postMessage({ id, msg }); });
            });
            await Promise.all(send.map((f) => f(init)));
            engine = poolEngine(send);
        }
        let last = 0;
        const progress = (p) => { if (!flag('--json') && Date.now() - last > 2000) { last = Date.now(); process.stderr.write(`  ${p.phase}: ${p.evals} avaliações, ${(p.ms / 1000).toFixed(0)} s, custo ${(100 * p.cost).toFixed(1)}% da exata\n`); } };
        let r;
        try { r = await searchNetwork(P, { heuristic, maxDrop: +opt('--max-drop', 1), progress }, engine); } catch (e) { die(e.message); } finally { for (const w of workers) w.terminate(); }
        const unit = { area: 'µm²', luts: 'LUT', energy: 'nJ' }[objective];
        const cv = (x) => (objective === 'energy' ? (x / 1e6).toFixed(1) : x.toFixed(0));
        const pct = (v) => `${(100 * v).toFixed(1)}%`;
        const res = { model: net.id, objective, heuristic, maxDrop: r.maxDrop, dirs, prepMs, ...r, points: flag('--points') ? r.points : r.points.length };
        out(res, () => [
            `${net.name} (${ds.name}), ${heuristic}, objetivo ${objective}, queda máxima ${r.maxDrop} ponto(s) na validação (até ${r.maxWrong} erradas em ${P.n})`,
            `candidatas por camada: ${P.cands.map((c, i) => `${net.sites[i].name} ${c.mul.length} ×, ${c.add.length} +`).join('; ')}`,
            `${r.evals} avaliações (${r.images} imagens), ${(r.ms / 1000).toFixed(1)} s com ${r.workers} worker(s); preparação ${(prepMs / 1000).toFixed(1)} s`,
            `exata:   ${cv(r.exact.cost)} ${unit}, validação ${pct(r.exact.accVal)}, teste ${pct(r.exact.accTest)}`,
            `melhor:  ${cv(r.best.cost)} ${unit} (${pct(-r.best.saving)}), validação ${pct(r.best.accVal)}, teste ${pct(r.best.accTest)}`,
            ...r.best.assign.map((a, i) => `  ${net.sites[i].name.padEnd(6)} ${(a.mul ?? 'MUL8 exato').padEnd(18)} ${a.add ?? 'ADD32 exato'}`),
            `fronteira (custo, validação): ${r.front.map((p) => `${pct(p.cost / r.exact.cost)} ${pct(p.accVal)}`).join('; ')}`,
        ].join('\n'));
        break;
    }
    case 'hls': {
        const ex = opt('--example');
        const src = ex ? (KERNELS.find((k) => k.id === ex) ?? die(`exemplo desconhecido: ${ex} (${KERNELS.map((k) => k.id).join(', ')})`)).code
            : pos[0] ? readFileSync(pos[0], 'utf8') : die('falta o arquivo do kernel ou --example');
        const synthJ = synthData();
        const cellsJ = JSON.parse(readFileSync(join(ROOT, 'data/hls-cells.json'), 'utf8'));
        let r;
        const synOpt = { synth: synthJ, cells: cellsJ, clockNs: +opt('--clock', 5), flow: opt('--flow', 'delay'), ports: +opt('--ports', 2) };
        try {
            r = synthesize(src, synOpt);
            if (opt('--approx')) r = synthesize(src, { ...synOpt, assign: parseAssign(r.ops, opt('--approx')) });
        } catch (e) { die(e.message); }
        if (flag('--ops')) {
            const list = r.ops.list.map((o) => ({ id: o.id, group: o.group, line: o.node.line, op: o.node.op, width: o.W, expression: o.text, units: o.candidates.length, restriction: o.reason, assigned: r.assign.get(o.id) ?? o.candidates[0] }));
            out(list, () => list.map((o) => `${o.id.padEnd(7)} ${o.group.padEnd(9)} ${o.expression.padEnd(42)} ${String(o.units).padStart(4)} unidades${o.restriction ? ` (só a exata: ${o.restriction === 'sub' ? 'subtração' : 'com sinal'})` : ''}  ${o.assigned}`).join('\n'));
            break;
        }
        const loopsOut = r.design.loops.filter((l) => l.mode !== 'unrolled').map((l) => ({
            loop: l.label ?? l.id, line: l.line, trip: l.trip, mode: l.mode, unroll: l.factor, II: l.IIachieved ?? null, IItarget: l.II ?? null,
            limitedBy: l.why ? `${l.why.kind}${l.why.label ?? l.why.key ? `: ${l.why.label ?? l.why.key}` : ''}` : null, iterationLatency: l.iterLatency, latency: l.latency,
            flattened: l.flatLabel ?? null, flattenedInto: l.flatInto ? (r.design.loops.find((x) => x.id === l.flatInto).label ?? l.flatInto) : null,
        }));
        const res = {
            kernel: r.design.name, clockNs: r.totals.clockPs / 1000, flow: opt('--flow', 'delay'), totals: r.totals, loops: loopsOut,
            units: r.cost.units.map((u) => ({ unit: u.unit.name, count: u.count, area: u.area, luts: u.luts })),
            cells: r.cost.cells.map((c) => ({ cell: c.key, count: c.count, area: c.area })),
            area: r.cost.area, energy: r.cost.energy, fpga: r.cost.fpga, warnings: r.warnings,
            approx: Object.fromEntries(r.assign),
        };
        let errText = [];
        if (flag('--error')) {
            const input = opt('--input', 'image'), model = opt('--model', 'sampled');
            const a = analyzeError(r, { inputs: makeInputs(r.design, input), method: model });
            const fmt = (v, d = 3) => (v === Infinity ? 'inf' : Number.isFinite(v) ? v.toFixed(d) : '-');
            res.error = {
                input, model,
                outputs: a.measured.map((m) => ({ array: m.array, estimated: a.est.outputs.get(m.array), measured: { ...m, box: undefined } })),
                budget: a.est.budget.map((b) => ({ id: b.id, unit: b.unit, ownMean: b.own.mu, ownMSE: b.own.m2, outputs: Object.fromEntries(b.outputs) })),
                flags: a.est.flags,
            };
            errText = [
                `  erro (entrada ${input}, modelo ${model}):`,
                ...res.error.outputs.map(({ array, estimated: e, measured: m }) => `    ${array}: ME ${fmt(e.ME)} estimado, ${fmt(m.ME)} medido; MSE ${fmt(e.MSE, 4)} / ${fmt(m.MSE, 4)}; PSNR ${fmt(e.PSNR, 2)} / ${fmt(m.PSNR, 2)} dB${m.SSIM !== null ? `; SSIM ${fmt(e.SSIM, 4)} / ${fmt(m.SSIM, 4)}` : ''}; WCE ${m.WCE}, EP ${fmt(m.EP)}`),
                ...res.error.budget.map((b) => `    ${b.id.padEnd(7)} ${b.unit.padEnd(32)} erro próprio ${fmt(b.ownMean)} (MSE ${fmt(b.ownMSE, 2)}), sozinho na saída: MSE ${Object.entries(b.outputs).map(([k, v]) => `${k} ${fmt(v.MSE, 4)}`).join(', ')}`),
                ...a.est.flags.map((f) => `    nota: ${f}`),
            ];
        }
        out(res, () => [
            `${res.kernel}: ${r.totals.cycles} ciclos de ${res.clockNs} ns = ${r.totals.timeNs.toFixed(1)} ns${r.totals.intervalNs ? `, um resultado a cada ${r.totals.intervalNs} ns` : ''} (período mínimo ${r.totals.critPs} ps)`,
            ...loopsOut.map((l) => `  ${l.loop.padEnd(10)} ${l.mode.padEnd(10)} ${String(l.trip).padStart(5)} iterações${l.unroll > 1 ? ` (unroll ${l.unroll})` : ''}${l.II ? `  II ${l.II}${l.limitedBy ? ` (${l.limitedBy})` : ''}` : ''}  ${l.flattenedInto ? `achatado em ${l.flattenedInto}` : `latência ${l.latency}${l.flattened ? ` (${l.flattened})` : ''}`}`),
            `  unidades: ${res.units.map((u) => `${u.count} × ${u.unit}`).join(', ') || 'nenhuma'}`,
            `  área ${r.cost.area.total.toFixed(0)} µm² (unidades ${r.cost.area.units.toFixed(0)}, células ${r.cost.area.cells.toFixed(0)}, mux ${r.cost.area.mux.toFixed(0)}, registradores ${r.cost.area.registers.toFixed(0)}, controle ${r.cost.area.control.toFixed(0)})`,
            `  FPGA ${r.cost.fpga.luts} LUTs, ${r.cost.fpga.carry4} CARRY4, ${r.cost.fpga.ff} FF`,
            `  energia ${(r.cost.energy.total / 1000).toFixed(1)} pJ por execução (operações ${(r.cost.energy.ops / 1000).toFixed(1)}, registradores ${(r.cost.energy.registers / 1000).toFixed(1)})`,
            ...r.warnings.map((w) => `  aviso, linha ${w.line}: ${w.msg}`),
            ...errText,
        ].join('\n'));
        break;
    }
    case 'dse': {
        const ex = opt('--example');
        const src = ex ? (KERNELS.find((k) => k.id === ex) ?? die(`exemplo desconhecido: ${ex}`)).code
            : pos[0] ? readFileSync(pos[0], 'utf8') : die('falta o arquivo do kernel ou --example');
        const constraint = opt('--ssim') !== undefined ? { metric: 'ssim', value: +opt('--ssim') } : opt('--mse') !== undefined ? { metric: 'mse', value: +opt('--mse') } : { metric: 'psnr', value: +opt('--psnr', 40) };
        const w = (opt('--weights', '1,1,1')).split(',').map(Number);
        let res;
        try {
            res = explore(src, {
                synth: synthData(), cells: JSON.parse(readFileSync(join(ROOT, 'data/hls-cells.json'), 'utf8')),
                flow: opt('--flow', 'delay'), ports: +opt('--ports', 2), input: opt('--input', 'image'), method: opt('--model', 'sampled'),
                objective: opt('--objective', 'area'), weights: { area: w[0] ?? 1, energy: w[1] ?? 1, latency: w[2] ?? 1 }, constraint,
                granularity: opt('--granularity', 'op'), heuristic: opt('--heuristic', 'local'),
                clocks: opt('--clocks', opt('--clock', '5')).split(',').map(Number), allUnits: flag('--all-units'),
                samples: +opt('--samples', 200), verifyFront: +opt('--verify-front', 0),
            });
        } catch (e) { die(e.message); }
        const runs = res.runs.map((r) => ({
            heuristic: r.heuristic, evaluations: r.evals, ms: r.ms, error: r.error, best: pointSummary(r.best, res.ref), verified: pointSummary(r.chosen, res.ref),
            front: r.front.map((p) => pointSummary(p, res.ref)),
        }));
        if (flag('--csv')) {
            const rows = [['heuristic', 'variant', 'clock_ns', 'score', 'area_um2', 'luts_carry4', 'energy_fJ', 'latency_ns', 'interval_ns', 'psnr_est', 'mse_est', 'ssim_est', 'psnr_measured', 'ssim_measured', 'feasible', 'units']];
            for (const r of runs) for (const p of r.front) rows.push([r.heuristic, p.variant, p.clockNs, p.score, p.cost.area, p.cost.luts, p.cost.energy, p.cost.latency, p.cost.interval, p.estimated[0]?.PSNR, p.estimated[0]?.MSE, p.estimated[0]?.SSIM ?? '', p.measured?.[0]?.PSNR ?? '', p.measured?.[0]?.SSIM ?? '', p.feasible, p.units.join(' + ')]);
            console.log(rows.map((r) => r.map((x) => (typeof x === 'string' && /[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\n'));
            break;
        }
        const f = (v, d = 2) => (v === Infinity ? 'inf' : Number.isFinite(v) ? v.toFixed(d) : '-');
        const pctS = (v) => `${(100 * v).toFixed(1)}%`;
        out({ variants: res.variants, reference: res.ref, referenceScore: res.refScore, ms: res.ms, runs }, () => [
            `${res.variants.length} variante(s); referência exata: área ${f(res.ref.area, 0)} µm², energia ${f(res.ref.energy / 1e6, 2)} nJ, latência ${f(res.ref.latency, 0)} ns; preparo ${res.prepMs} ms, candidatas ${res.candMs} ms`,
            `restrição: ${constraint.metric === 'psnr' ? `PSNR >= ${constraint.value} dB` : constraint.metric === 'ssim' ? `SSIM >= ${constraint.value}` : `MSE <= ${constraint.value}`}; objetivo ${opt('--objective', 'area')}; grupos por ${opt('--granularity', 'class')}`,
            ...runs.flatMap((r) => {
                const b = r.verified ?? r.best;
                if (!b) return [`  ${r.heuristic}: ${r.error ?? 'nada'}`];
                return [
                    `  ${r.heuristic.padEnd(11)} ${String(r.evaluations).padStart(5)} avaliações, ${r.ms} ms${r.error ? ` (${r.error})` : ''}`,
                    `    custo ${f(b.score, 3)} (área ${pctS(b.savings.area)} menor, energia ${pctS(b.savings.energy)}, latência ${pctS(b.savings.latency)}); ${b.variant}`,
                    `    PSNR estimado ${f(b.estimated[0]?.PSNR)} dB, medido ${b.measured ? f(b.measured[0].PSNR) : '-'} dB${b.estimated[0]?.SSIM != null ? `; SSIM estimado ${f(b.estimated[0].SSIM, 4)}, medido ${b.measured ? f(b.measured[0].SSIM, 4) : '-'}` : ''}${r.verified ? '' : ' (nenhum ponto passou na verificação)'}`,
                    `    ${b.units.join(', ')}`,
                ];
            }),
        ].join('\n'));
        break;
    }
    default:
        { const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n'); console.log(lines.slice(2, lines.indexOf(' */')).map((l) => l.replace(/^ \*\s?/, '')).join('\n')); }
        if (cmd && cmd !== 'help') process.exit(1);
}
