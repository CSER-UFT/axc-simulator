/**
 * Interface do simulador de computação aproximada: configuração da unidade, estrutura, erro, comparação
 * (fronteira de Pareto) e aplicação em imagem.
 */
import { buildUnit, unitName, compressorTable } from './axc/units.js';
import { testInputs, errorMetrics, histogram, errorGrid, paretoFront, rng } from './axc/metrics.js';
import { testImage, fromRgba, parseNetpbm, fitImage, applyFilter, psnr, ssim } from './axc/image.js';
import { lineChartSvg, stagesSvg, dotDiagram, adderDiagram, histogramSvg, drawHeatmap, rampLegend, paretoSvg, scatterSvg, drawGray, drawDiff, esc } from './ui/plots.js';
import { toVerilog, testbench, vectors, moduleName } from './axc/verilog.js';
import { Help } from './ui/help.js';
import { SC_OPS, SC_GENERATORS, scCurve, binaryError, streamDemo, scCost, faultError, scFilter, flipPixelBits } from './axc/stochastic.js';
import { timingTrace, capturedOutputs, vosCurve, randomSequence, outputDepths, delayFactor, corruptImage, expectedMemoryMSE } from './axc/vos.js';

const $ = (id) => document.getElementById(id);
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* só nesta visita */ } },
};
const nf = (v, d = 2) => (Number.isInteger(v) ? v.toLocaleString('pt-BR') : v.toLocaleString('pt-BR', { maximumFractionDigits: d }));
const sci = (v) => (v === 0 ? '0' : v >= 0.01 && v < 1e5 ? nf(v, 4) : v.toExponential(2).replace('.', ','));
const pct = (v) => (v > 0 && v < 1e-4 ? `${(100 * v).toExponential(1).replace('.', ',')}%` : `${(100 * v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

let tab = store.get('axc.tab') || 'struct';
let cur = null;            // {cfg, unit, m, inp}
let lastParam = 'kApprox'; // parâmetro varrido pelo botão Varrer
let image = testImage();
// Resultados da síntese das configurações pré-definidas (data/synth.json, gerado na publicação do site).
let synth = null;
const synthOf = (name) => synth?.designs.find((d) => d.name === name) ?? null;
let cmp = [];
try { cmp = JSON.parse(store.get('axc.cmp') ?? '[]'); } catch { cmp = []; }

// Configuração ----------------------------------------------------------------------------------------------

function readCfg() {
    const width = +$('width').value;
    if ($('kind').value === 'mul') {
        const method = $('mulMethod').value;
        const cfg = { kind: 'mul', width, method };
        if (method === 'array') Object.assign(cfg, { kTrunc: +$('kTrunc').value, kApprox: +$('kApprox').value, approxCarry: $('approxCarry').checked });
        if (method === 'booth') cfg.kTrunc = +$('kTrunc').value;
        if (method === 'kulkarni') cfg.kBlock = +$('kBlock').value;
        if (method === 'drum') cfg.k = +$('drumK').value;
        if ($('comp').checked) cfg.comp = true;
        return cfg;
    }
    const adder = $('adder').value;
    const cfg = { kind: 'add', width, adder };
    if (adder === 'trunc' || adder === 'loa') cfg.k = +$('kAdd').value;
    if (adder === 'seg') { cfg.L = +$('segL').value; cfg.P = +$('segP').value; }
    return cfg;
}

/** Limites dos controles conforme o tipo e a largura. */
function syncControls() {
    const N = +$('width').value, mul = $('kind').value === 'mul';
    $('mulCfg').classList.toggle('hidden', !mul);
    $('addCfg').classList.toggle('hidden', mul);
    const method = $('mulMethod').value;
    $('rowTrunc').classList.toggle('hidden', !['array', 'booth'].includes(method));
    $('rowApprox').classList.toggle('hidden', method !== 'array');
    $('rowKul').classList.toggle('hidden', method !== 'kulkarni');
    $('rowDrum').classList.toggle('hidden', method !== 'drum');
    $('kTrunc').max = 2 * N;
    $('kApprox').max = 2 * N;
    $('kBlock').max = 2 * N;
    $('drumK').max = N - 1;
    if (+$('kTrunc').value + +$('kApprox').value > 2 * N) $('kApprox').value = 2 * N - +$('kTrunc').value;
    $('kAdd').max = N;
    $('segL').max = N;
    $('segP').max = N;
    const adder = $('adder').value;
    $('kRow').classList.toggle('hidden', !(adder === 'trunc' || adder === 'loa'));
    $('segRow').classList.toggle('hidden', adder !== 'seg');
    for (const id of ['kTrunc', 'kApprox', 'kAdd', 'segL', 'segP', 'kBlock', 'drumK']) $(`${id}V`).textContent = $(id).value;
    $('kBlockV').textContent = +$('kBlock').value >= 2 * N ? 'todos' : $('kBlock').value;
}

const distName = { uniform: 'uniformes', normal: 'normais', exp: 'exponenciais' };

function evaluateCurrent() {
    syncControls();
    const cfg = readCfg();
    const unit = buildUnit(cfg);
    const dist = $('dist').value;
    const inp = testInputs(cfg.width, dist);
    const m = errorMetrics(unit, inp);
    const exact = exactUnit(cfg);
    cur = { cfg, unit, m, inp, exact, dist, appCache: null, activity: activityOf(unit), exactActivity: activityOf(exact) };
    $('evalNote').textContent = inp.exhaustive
        ? `Avaliação exaustiva: todos os ${nf(inp.a.length)} pares de operandos.`
        : `Avaliação por amostragem: ${nf(inp.a.length)} pares com entradas ${distName[dist]} (semente fixa).`;
    renderSummary();
    // Só a aba visível é desenhada agora; as outras, quando forem abertas.
    for (const k of Object.keys(dirty)) dirty[k] = true;
    renderTab(tab);
}

/** Atividade de chaveamento com 4096 pares uniformes em sequência aleatória (semente fixa), guardada na unidade. */
function activityOf(unit) {
    if (unit.activity === undefined) unit.activity = unit.net.activity(...randomPairs(unit.cfg.width, 4096, 31));
    return unit.activity;
}
function randomPairs(N, n, seed) {
    const r = rng(seed);
    const a = new Uint32Array(n), b = new Uint32Array(n);
    for (let k = 0; k < n; k++) { a[k] = Math.floor(r() * 2 ** N); b[k] = Math.floor(r() * 2 ** N); }
    return [a, b];
}

/** Abas que precisam ser redesenhadas depois de uma mudança na unidade. */
const dirty = { struct: true, error: true, cmp: true, app: true, synth: true, vos: true };
const RENDER = { struct: () => renderStruct(), error: () => renderError(), cmp: () => renderCmp(), app: () => renderApp(), synth: () => renderSynth(), vos: () => renderVos() };
function renderTab(name) {
    if (name === 'vos') renderMem();
    if (name === 'sc') { if (dirty.sc !== false) { dirty.sc = false; renderSc(); } return; }
    if (!cur || !dirty[name]) return;
    dirty[name] = false;
    RENDER[name]();
}

/** Unidade exata de referência, guardada por tipo e largura (a de 16 bits demora a montar). */
const exactCache = new Map();
function exactUnit(cfg) {
    // A referência do Booth é o Booth exato (com sinal); a das outras técnicas, o multiplicador exato por colunas.
    const booth = cfg.kind === 'mul' && cfg.method === 'booth';
    const key = `${cfg.kind}${cfg.width}${booth ? 'b' : ''}`;
    if (!exactCache.has(key)) exactCache.set(key, buildUnit(cfg.kind === 'mul' ? (booth ? { kind: 'mul', width: cfg.width, method: 'booth' } : { kind: 'mul', width: cfg.width }) : { kind: 'add', width: cfg.width, adder: 'exact' }));
    return exactCache.get(key);
}

// Resumo ----------------------------------------------------------------------------------------------------

function renderSummary() {
    const { unit, m, exact, cfg } = cur;
    const g = unit.net.gates, d = unit.net.delay(), g0 = exact.net.gates, d0 = exact.net.delay();
    const rel = (v, v0) => (v0 ? ` <span class="note">(${v <= v0 ? '−' : '+'}${pct(Math.abs(v - v0) / v0)})</span>` : '');
    const cells = Object.entries(unit.net.cells).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
    $('sumTitle').textContent = `Resumo: ${unitName(cfg)}`;
    let h = '<table class="kv">';
    h += `<tr><th>Área</th><td class="mono">${nf(g)} portas${rel(g, g0)}</td></tr>`;
    h += `<tr><th>Atraso</th><td class="mono">${d} níveis${rel(d, d0)}</td></tr>`;
    h += `<tr><th>Células</th><td class="mono">${esc(cells)}</td></tr>`;
    h += `<tr><th title="média de saídas de porta que mudam de valor entre uma operação e a seguinte">Atividade</th><td class="mono">${nf(cur.activity, 1)} transições/op.${rel(cur.activity, cur.exactActivity)}</td></tr>`;
    const sy = synthOf(unitName(cfg));
    if (sy) {
        const sx = synthOf(unitName(exact.cfg));
        h += `<tr><th>FPGA (Yosys)</th><td class="mono">${sy.luts} LUTs${sx ? rel(sy.luts, sx.luts) : ''}, ${sy.carry4} CARRY4, profundidade ${sy.depth}</td></tr>`;
    } else if (synth) h += '<tr><th>FPGA (Yosys)</th><td class="note">não sintetizada: só as configurações pré-definidas (aba Síntese)</td></tr>';
    h += '</table>';
    h += '<table class="kv metrics" style="margin-top:10px">';
    const rows = [
        ['ME', 'erro médio, com sinal (viés)', nf(m.ME)],
        ['MED', 'média de |erro|', nf(m.MED)],
        ['WCE', 'pior caso', `${nf(m.WCE)} <span class="note">(a = ${m.worst.a}, b = ${m.worst.b})</span>`],
        ['MSE', 'média de erro²', sci(m.MSE)],
        ['NMED', 'MED / maior saída', sci(m.NMED)],
        ['MRED', 'média de |erro| / exato', pct(m.MRED)],
        ['EP', 'fração com erro', pct(m.EP)],
    ];
    for (const [k, t, v] of rows) h += `<tr><th title="${t}">${k}</th><td class="mono">${v}</td><td class="note">${t}</td></tr>`;
    h += '</table>';
    h += '<p class="note">Área e atraso vêm de um modelo didático (portas de duas entradas e profundidade lógica), não de uma síntese. Entre parênteses, a diferença para a unidade exata de mesma largura (para o Booth, o Booth exato).</p>';
    $('summary').innerHTML = h;
}

// Estrutura -------------------------------------------------------------------------------------------------

function renderStruct() {
    const { unit, cfg } = cur;
    const mul = cfg.kind === 'mul';
    $('structFig').innerHTML = (mul ? (unit.dots ? dotDiagram(unit) : '') : adderDiagram(unit)) + (mul ? stagesSvg(unit) : '');
    const notes = {
        array: `Cada ponto é um produto parcial aᵢ·bⱼ, na coluna i + j (a coluna 0 é a menos significativa, à direita). As colunas são reduzidas por estágios de somadores completos e meios somadores, no estilo de Dadda, até sobrarem dois bits; uma soma com propagação de vai um dá o produto de ${2 * cfg.width} bits.`,
        booth: `Booth radix 4: cada par de bits de b (com o bit anterior) escolhe 0, ±a ou ±2a, e são ${cfg.width / 2} produtos parciais em vez de ${cfg.width}. Os operandos e o produto são com sinal (complemento de 2). Os pontos claros estendem o sinal até a coluna ${2 * cfg.width - 1}; a última linha é o +1 dos produtos negativos.`,
        kulkarni: 'Cada bloco multiplica 2 bits de a por 2 bits de b. O bloco aproximado (laranja) tem só três saídas e dá 7 em vez de 9 para 3 × 3; os produtos dos blocos são somados de forma exata. As linhas alternam para os blocos vizinhos não se sobreporem.',
        drum: `DRUM: de cada operando, só ${cfg.k} bits a partir do 1 mais significativo entram num multiplicador exato ${cfg.k} × ${cfg.k}; o bit mais baixo do trecho vira 1, o que tira o viés do truncamento, e o produto é deslocado de volta.`,
        mitchell: 'Mitchell: log₂(x) ≈ p + f, com p a posição do 1 mais alto e f os bits abaixo dele como fração. O produto vira uma soma de logaritmos, e o antilogaritmo é um deslocamento. Não há multiplicação nenhuma no circuito.',
    };
    $('structNote').textContent = mul ? notes[unit.method] + (unit.compConst !== undefined ? ` Compensação: constante ${unit.compConst} somada ao resultado.` : '')
        : 'Cada coluna soma um bit de a e um de b. A zona colorida mostra onde a soma é aproximada.';
    $('stagesBox').classList.toggle('hidden', !mul || !unit.heights);
    $('compBox').classList.toggle('hidden', !mul || unit.method !== 'array' || !cfg.kApprox);
    if (mul && unit.heights) {
        const C = 2 * cfg.width;
        const head = `<tr><th>estágio</th>${Array.from({ length: C }, (_, k) => `<th class="z-${unit.zones[C - 1 - k]}">${C - 1 - k}</th>`).join('')}</tr>`;
        $('stagesTable').innerHTML = head + unit.heights.map((hs, s) => `<tr><th>${s === 0 ? 'produtos' : s}</th>${Array.from({ length: C }, (_, k) => `<td>${hs[C - 1 - k] || ''}</td>`).join('')}</tr>`).join('');
        $('compTable').innerHTML = '<tr><th>x1 x2 x3 x4</th><th>exato</th><th>vai um, soma</th><th>aprox.</th><th>erro</th></tr>'
            + compressorTable().map((r) => `<tr class="${r.err ? 'bad' : ''}"><td>${r.x.join(' ')}</td><td>${r.exact}</td><td>${r.carry}, ${r.sum}</td><td>${r.approx}</td><td>${r.err > 0 ? '+' : ''}${r.err}</td></tr>`).join('');
    }
}

// Erro ------------------------------------------------------------------------------------------------------

let heatGrid = null;
function renderError() {
    const { unit, m, cfg } = cur;
    const N = cfg.width;
    const G = N <= 8 ? 256 : 128;
    heatGrid = errorGrid(unit, G, N <= 8 ? 1 : 2);
    const dark = document.documentElement.dataset.theme === 'dark';
    const max = drawHeatmap($('heat'), heatGrid, { zeroColor: dark ? [26, 30, 39] : [242, 244, 248] });
    $('heatLegend').innerHTML = max ? rampLegend(max) : '<p class="note">Nenhum erro: a unidade é exata.</p>';
    $('heatNote').textContent = N <= 8
        ? 'Cada pixel é um par (a, b): 256 × 256, todos os pares. Cinza é erro zero; a cor segue |erro| em escala logarítmica.'
        : `Cada pixel é uma faixa de ${2 ** N / G} × ${2 ** N / G} valores de (a, b), com a média de |erro| em pares sorteados.`;
    const h = histogram(m.signed);
    $('histFig').innerHTML = histogramSvg(h, { log: $('histLog').checked, width: 520 });
    $('histNote').textContent = `${pct(1 - m.EP)} dos pares sem erro. Erro médio com sinal (viés): ${nf(m.ME)}. `
        + (Math.abs(m.ME) > 0.5 * m.MED && m.MED > 0 ? 'O erro é quase todo de um lado só: uma constante de compensação somada ao resultado reduziria o MED.' : 'O erro se distribui dos dois lados do zero.');
}
$('histLog').onchange = () => cur && renderError();
$('heat').addEventListener('mousemove', (e) => {
    if (!heatGrid || !cur) return;
    const r = $('heat').getBoundingClientRect();
    const G = heatGrid.G;
    const i = Math.min(G - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * G)));
    const j = Math.min(G - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * G)));
    const N = cur.cfg.width, span = 2 ** N / G;
    const off = cur.unit.signed ? 2 ** (N - 1) : 0;   // com sinal, o eixo começa em -2^(N-1)
    if (span === 1) {
        const ra = (i - off + 2 ** N) % 2 ** N, rb = (j - off + 2 ** N) % 2 ** N;
        const raw = cur.unit.net.evaluateOne(ra, rb), y = cur.unit.decode ? cur.unit.decode(raw) : raw, ex = cur.unit.exact(ra, rb);
        $('heatHover').textContent = `a = ${i - off}, b = ${j - off}: exato ${ex}, aproximado ${y}, erro ${y - ex}`;
    } else {
        $('heatHover').textContent = `a em [${i * span - off}, ${(i + 1) * span - off}), b em [${j * span - off}, ${(j + 1) * span - off}): |erro| médio ${nf(heatGrid.grid[i * G + j])}`;
    }
});

// Comparação ------------------------------------------------------------------------------------------------

const Y_NAMES = { NMED: 'NMED', MRED: 'MRED', MED: 'MED', WCE: 'WCE', MSE: 'MSE', EP: 'EP', imgMSE: 'MSE da imagem filtrada' };
const X_NAMES = { gates: 'área (portas)', delay: 'atraso (níveis de porta)', adp: 'área × atraso', luts: 'LUTs (Yosys)', lutsCarry: 'LUTs + CARRY4 (Yosys)', depth: 'profundidade em células (Yosys)', activity: 'atividade (transições por operação)', aap: 'área × atividade' };

/** Entrada da comparação para uma configuração (com o MSE da imagem no filtro escolhido). */
function cmpEntry(cfg, dist) {
    const unit = buildUnit(cfg);
    const m = errorMetrics(unit, testInputs(cfg.width, dist));
    const filter = filterFor(cfg);
    let imgMSE = null;
    if (filter) {
        const ex = applyFilter(image, filter, null), ap = applyFilter(image, filter, unit);
        let s = 0;
        for (let k = 0; k < ex.data.length; k++) s += (ex.data[k] - ap.data[k]) ** 2;
        imgMSE = s / ex.data.length;
    }
    const gates = unit.net.gates, delay = unit.net.delay();
    const activity = activityOf(unit);
    return { name: unitName(cfg), cfg, dist, gates, delay, adp: gates * delay, activity, aap: gates * activity, NMED: m.NMED, MRED: m.MRED, MED: m.MED, WCE: m.WCE, MSE: m.MSE, EP: m.EP, imgMSE, filter };
}
function saveCmp() { store.set('axc.cmp', JSON.stringify(cmp)); }

/**
 * Ponto de joelho da fronteira: o mais distante da reta entre os seus extremos, com custo e erro normalizados
 * entre 0 e 1 (o erro em log quando o gráfico está em log).
 */
function kneePoint(pts, front, logY) {
    // Em log, pontos sem erro (exatos) ficariam infinitamente abaixo: ficam fora da conta.
    const f = front.filter((i) => !logY || pts[i].y > 0).sort((i, j) => pts[i].x - pts[j].x);
    if (f.length < 3) return null;
    const ty = (v) => (logY ? Math.log10(Math.max(v, 1e-12)) : v);
    const xs = f.map((i) => pts[i].x), ys = f.map((i) => ty(pts[i].y));
    const nx = (v) => (v - Math.min(...xs)) / ((Math.max(...xs) - Math.min(...xs)) || 1);
    const ny = (v) => (v - Math.min(...ys)) / ((Math.max(...ys) - Math.min(...ys)) || 1);
    const P = f.map((i, k) => [nx(xs[k]), ny(ys[k])]);
    const [x0, y0] = P[0], [x1, y1] = P[P.length - 1];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    let best = null, bd = -1;
    P.forEach(([x, y], k) => {
        if (k === 0 || k === P.length - 1) return;
        const d = Math.abs((y1 - y0) * x - (x1 - x0) * y + x1 * y0 - y1 * x0) / L;
        if (d > bd) { bd = d; best = f[k]; }
    });
    return best;
}

function renderCmp() {
    const xk = $('cmpX').value, yk = $('cmpY').value;
    const curName = cur ? unitName(cur.cfg) : null;
    const cost = (e) => {
        const sy = synthOf(e.name);
        if (xk === 'luts') return sy?.luts;
        if (xk === 'lutsCarry') return sy ? sy.luts + sy.carry4 : undefined;
        if (xk === 'depth') return sy?.depth;
        return e[xk];
    };
    const usable = cmp.filter((e) => e[yk] !== null && e[yk] !== undefined && cost(e) !== undefined);
    const pts = usable.map((e) => ({ x: cost(e), y: e[yk], label: e.name, current: e.name === curName }));
    const missing = cmp.length - usable.length;
    $('sweepNote').textContent = missing && ['luts', 'lutsCarry', 'depth'].includes(xk) ? `${missing} configuração(ões) fora do gráfico: não fazem parte das sintetizadas.` : $('sweepNote').textContent;
    const front = paretoFront(pts);
    const logY = $('cmpLog').checked;
    const knee = kneePoint(pts, front, logY);
    $('paretoFig').innerHTML = paretoSvg(pts, front, { xLabel: X_NAMES[xk], yLabel: Y_NAMES[yk], logY, knee });
    const frontNames = new Set(front.map((i) => pts[i].label));
    // Quantas configurações dominam cada uma (0 na fronteira).
    const domBy = new Map(pts.map((p) => [p.label, pts.filter((q) => q !== p && q.x <= p.x && q.y <= p.y && (q.x < p.x || q.y < p.y)).length]));
    $('kneeNote').textContent = knee !== null ? `Ponto de joelho: ${pts[knee].label}. É o ponto da fronteira mais distante da reta entre os extremos dela, com os dois eixos normalizados${logY ? ' (o erro em escala log, sem os pontos de erro zero)' : ''}: a partir dele, cada redução de custo passa a custar bem mais erro.` : 'O ponto de joelho aparece quando a fronteira tem pelo menos três pontos.';
    $('cmpTable').innerHTML = '<tr><th>configuração</th><th>entradas</th><th>portas</th><th>atraso</th><th>LUTs</th><th>atividade</th><th title="quantas configurações da comparação dominam esta (com o custo e o erro escolhidos)">dominada por</th><th>MED</th><th>WCE</th><th>NMED</th><th>MRED</th><th>EP</th><th>MSE imagem</th><th></th></tr>'
        + cmp.map((e, k) => `<tr class="${frontNames.has(e.name) ? 'front' : ''}${e.name === curName ? ' cur' : ''}"><td class="mono left">${esc(e.name)}</td><td>${distName[e.dist]}</td><td>${e.gates}</td><td>${e.delay}</td><td>${synthOf(e.name)?.luts ?? '-'}</td><td>${e.activity === undefined ? '-' : nf(e.activity, 1)}</td><td>${domBy.has(e.name) ? domBy.get(e.name) : '-'}</td>`
            + `<td>${nf(e.MED)}</td><td>${nf(e.WCE)}</td><td>${sci(e.NMED)}</td><td>${pct(e.MRED)}</td><td>${pct(e.EP)}</td><td>${e.imgMSE === null ? '-' : nf(e.imgMSE, 3)}</td>`
            + `<td><button type="button" class="btn small-btn" data-del="${k}" title="Remover">×</button></td></tr>`).join('');
}
$('cmpTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    cmp.splice(+b.dataset.del, 1);
    saveCmp();
    renderCmp();
});
function addToCmp(cfg, dist) {
    const name = unitName(cfg);
    const k = cmp.findIndex((e) => e.name === name && e.dist === dist);
    const entry = cmpEntry(cfg, dist);
    if (k >= 0) cmp[k] = entry; else cmp.push(entry);
}
$('addCmp').onclick = () => {
    if (!cur) return;
    addToCmp(cur.cfg, cur.dist);
    saveCmp();
    renderCmp();
    showTab('cmp');
};
$('sweepBtn').onclick = () => {
    if (!cur) return;
    const base = cur.cfg, N = base.width;
    const list = [];
    const method = base.method ?? 'array';
    if (base.kind === 'mul' && method === 'booth') {
        for (let v = 0; v <= 2 * N - 2; v += N <= 8 ? 1 : 2) list.push({ ...base, kTrunc: v });
        $('sweepNote').textContent = `Varrendo as colunas truncadas (${list.length} pontos).`;
    } else if (base.kind === 'mul' && method === 'kulkarni') {
        for (let v = 0; v <= 2 * N; v += 2) list.push({ ...base, kBlock: v });
        $('sweepNote').textContent = `Varrendo a coluna até onde os blocos são aproximados (${list.length} pontos).`;
    } else if (base.kind === 'mul' && method === 'drum') {
        for (let v = 2; v < N; v++) list.push({ ...base, k: v });
        $('sweepNote').textContent = `Varrendo k (${list.length} pontos).`;
    } else if (base.kind === 'mul' && method === 'mitchell') {
        list.push({ ...base, comp: false }, { ...base, comp: true });
        $('sweepNote').textContent = 'O Mitchell não tem parâmetro: entram as versões sem e com compensação.';
    } else if (base.kind === 'mul') {
        const p = lastParam === 'kTrunc' ? 'kTrunc' : 'kApprox';
        const other = p === 'kTrunc' ? base.kApprox : base.kTrunc;
        const step = N <= 8 ? 1 : 2;
        for (let v = 0; v + other <= 2 * N - 2; v += step) list.push({ ...base, [p]: v });
        $('sweepNote').textContent = `Varrendo ${p === 'kTrunc' ? 'as colunas truncadas' : 'as colunas aproximadas'} (${list.length} pontos).`;
    } else if (base.adder === 'seg') {
        for (let P = 0; P <= N; P++) list.push({ ...base, P });
        $('sweepNote').textContent = `Varrendo os bits de previsão P (${list.length} pontos).`;
    } else {
        const adder = base.adder === 'exact' ? 'loa' : base.adder;
        for (let k = 0; k <= N; k++) list.push({ ...base, adder, k });
        $('sweepNote').textContent = `Varrendo k (${list.length} pontos).`;
    }
    setTimeout(() => {
        for (const c of list) addToCmp(c, cur.dist);
        saveCmp();
        renderCmp();
    }, 10);
};
$('cmpClear').onclick = () => { cmp = []; saveCmp(); renderCmp(); $('sweepNote').textContent = ''; };
for (const id of ['cmpX', 'cmpY', 'cmpLog']) $(id).onchange = renderCmp;

function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('cmpCsv').onclick = () => {
    const rows = [['config', 'inputs', 'gates', 'delay', 'ME_abs_MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP', 'filter', 'image_MSE']];
    for (const e of cmp) rows.push([e.name, e.dist, e.gates, e.delay, e.MED, e.WCE, e.MSE, e.NMED, e.MRED, e.EP, e.filter ?? '', e.imgMSE ?? '']);
    download('comparacao.csv', rows.map((r) => r.join(',')).join('\n') + '\n', 'text/csv');
};
$('cmpSvg').onclick = () => {
    const svg = $('paretoFig').querySelector('svg');
    if (!svg) return;
    const clone = svg.cloneNode(true);
    const css = '.axis{stroke:#555}.small{font:11px sans-serif}.mono{font-family:monospace}.muted{fill:#555}.front{fill:none;stroke:#1650ff;stroke-width:1.5}.pt{fill:#999}.pt.front{fill:#1650ff;stroke:none}.pt.cur{stroke:#d99700;stroke-width:3}';
    clone.insertAdjacentHTML('afterbegin', `<style>${css}</style>`);
    download('pareto.svg', clone.outerHTML, 'image/svg+xml');
};

// Tensão e memória ------------------------------------------------------------------------------------------

/** Rastros de tempo (independentes da tensão), guardados por unidade. */
const traceCache = new Map();
function traceOf(unit) {
    const key = unitName(unit.cfg);
    if (!traceCache.has(key)) {
        const seq = randomSequence(unit.cfg.width, 4096);
        traceCache.set(key, { seq, trace: timingTrace(unit, seq.a, seq.b), curves: new Map() });
    }
    return traceCache.get(key);
}
const maxDepth = (unit) => Math.max(...outputDepths(unit));

/** Imagem menor (no máximo 128 de lado) para a simulação de tempo, que avalia porta a porta. */
function smallImage() {
    if (image.w <= 128 && image.h <= 128) return image;
    const f = Math.ceil(Math.max(image.w, image.h) / 128);
    const w = Math.floor(image.w / f), h = Math.floor(image.h / f);
    const data = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = image.data[y * f * image.w + x * f];
    return { w, h, data };
}
let vosImgCache = null;

function renderVos() {
    if (!cur) return;
    const unit = cur.unit, exact = cur.exact;
    const V = +$('vosV').value;
    $('vosVV').textContent = V.toFixed(2).replace('.', ',');
    const dU = maxDepth(unit), dE = maxDepth(exact);
    const period = $('vosClock').value === 'exact' ? dE : dU;
    const tu = traceOf(unit), te = traceOf(exact);
    const curveOf = (t, u, per) => {
        if (!t.curves.has(per)) t.curves.set(per, vosCurve(u, t.trace, t.seq, per));
        return t.curves.get(per);
    };
    const cu = curveOf(tu, unit, period), ce = curveOf(te, exact, dE);
    $('vosFig').innerHTML = lineChartSvg([
        { name: unitName(cur.cfg), cls: 's-unit', pts: cu.map((p) => ({ x: p.V, y: 100 * p.MRED })) },
        { name: `exata (${unitName(exact.cfg)})`, cls: 's-exact', pts: ce.map((p) => ({ x: p.V, y: 100 * p.MRED })) },
    ], { xLabel: 'tensão (V / Vnom), diminuindo para a direita', yLabel: 'MRED (%)', marker: V, xReverse: true });
    const at = (c) => c.find((p) => Math.abs(p.V - V) < 1e-6) ?? c[c.length - 1];
    const pu = at(cu), pe = at(ce);
    const s = delayFactor(V);
    let note = `Relógio de ${period} níveis de porta (o caminho mais longo ${$('vosClock').value === 'exact' ? 'da unidade exata' : 'da própria unidade'}). Em V = ${V.toFixed(2).replace('.', ',')}, cada porta fica ${nf(s, 2)} vezes mais lenta: só cabem ${nf(period / s, 1)} níveis no período.`;
    if ($('vosClock').value === 'exact' && dU > dE) note += ` Esta unidade é mais profunda que a exata (${dU} contra ${dE} níveis): com o relógio da exata, ela pode errar já na tensão nominal.`;
    else if ($('vosClock').value === 'exact' && dU < dE) note += ` Pela profundidade estática, esta unidade é mais rasa que a exata (${dU} contra ${dE} níveis) e teria folga no relógio. Mas o erro de tempo depende dos caminhos que os dados de fato sensibilizam: compare onde as duas curvas começam a subir.`;
    $('vosNote').textContent = note;
    const row = (label, a, b) => `<tr><th>${label}</th><td class="mono">${a}</td><td class="mono">${b}</td></tr>`;
    $('vosTable').innerHTML = `<table class="kv"><tr><th></th><td class="note">esta unidade</td><td class="note">exata</td></tr>`
        + row('energia dinâmica', pct(pu.energy), pct(pe.energy))
        + row('bits atrasados', pct(pu.lateBits), pct(pe.lateBits))
        + row('MRED', pct(pu.MRED), pct(pe.MRED))
        + row('EP', pct(pu.EP), pct(pe.EP))
        + row('MED', nf(pu.MED), nf(pe.MED)) + '</table>'
        + `<p class="note">Sequência de 4096 operações com entradas uniformes. A energia é relativa à nominal (V²); o erro inclui a aproximação da unidade e os erros de tempo.</p>`;
    // Imagem: ganho de brilho (multiplicador) ou média com o vizinho (somador), em sequência, pixel a pixel.
    const signed8 = unit.signed && unit.cfg.width === 8;
    if (signed8) {
        $('vosImgCap').textContent = 'o Booth de 8 bits é com sinal: os pixels não cabem';
        return;
    }
    const img = smallImage();
    const key = `${unitName(cur.cfg)}|${img.w}x${img.h}|${img.data[0]}|${img.data[img.data.length - 1]}`;
    if (vosImgCache?.key !== key) {
        const n = img.w * img.h;
        const as = new Uint32Array(n), bs = new Uint32Array(n);
        for (let k = 0; k < n; k++) {
            as[k] = img.data[k];
            bs[k] = cur.cfg.kind === 'mul' ? 180 : img.data[k % img.w === img.w - 1 ? k : k + 1];
        }
        vosImgCache = { key, img, trace: timingTrace(unit, as, bs) };
    }
    const fin = (v) => (cur.cfg.kind === 'mul' ? Math.min(255, Math.floor(v / 128)) : Math.floor(v / 2));
    const { cap } = capturedOutputs(vosImgCache.trace, period, V);
    const exImg = { w: img.w, h: img.h, data: Uint8ClampedArray.from(vosImgCache.trace.out, (v) => fin(unit.decode ? unit.decode(v) : v)) };
    const ref = { w: img.w, h: img.h, data: Uint8ClampedArray.from(img.data, (p, k) => fin(cur.cfg.kind === 'mul' ? p * 180 : p + img.data[k % img.w === img.w - 1 ? k : k + 1])) };
    const vi = { w: img.w, h: img.h, data: Uint8ClampedArray.from(cap, (v) => fin(unit.decode ? unit.decode(v) : v)) };
    drawGray($('vosExact'), ref);
    drawGray($('vosImg'), vi);
    const pAp = psnr(ref, exImg), pV = psnr(ref, vi);
    const f = (x) => (x === Infinity ? '∞' : `${nf(x, 1)} dB`);
    $('vosExactCap').textContent = `exata, nominal (${cur.cfg.kind === 'mul' ? 'pixel × 180 / 128' : 'média com o vizinho'})`;
    $('vosImgCap').textContent = `esta unidade em ${V.toFixed(2).replace('.', ',')}: PSNR ${f(pV)} (só a aproximação: ${f(pAp)})`;
}

function renderMem() {
    const ber = 10 ** +$('memBer').value, prot = +$('memProt').value;
    $('memBerV').textContent = ber.toExponential(1).replace('.', ',');
    $('memProtV').textContent = String(prot);
    const { img, flips } = corruptImage(image, ber, prot);
    drawGray($('memOrig'), image);
    drawGray($('memImg'), img);
    drawDiff($('memDiff'), image, img);
    let mse = 0;
    for (let k = 0; k < img.data.length; k++) mse += (img.data[k] - image.data[k]) ** 2;
    mse /= img.data.length;
    const exp = expectedMemoryMSE(ber, prot);
    const p = psnr(image, img);
    $('memTable').innerHTML = `<table class="kv">`
        + `<tr><th>bits invertidos</th><td class="mono">${nf(flips)} de ${nf(img.data.length * (8 - prot))} não protegidos</td></tr>`
        + `<tr><th>MSE</th><td class="mono">${nf(mse, 2)} (esperado ${nf(exp, 2)})</td></tr>`
        + `<tr><th>PSNR</th><td class="mono">${p === Infinity ? '∞' : `${nf(p, 1)} dB`}</td></tr>`
        + `<tr><th>memória confiável</th><td class="mono">${prot} de 8 bits por pixel (${pct(prot / 8)})</td></tr></table>`
        + `<p class="note">O MSE esperado é a taxa de erro vezes a soma de 4<sup>b</sup> nos bits b não protegidos: inverter o bit b muda o pixel em 2<sup>b</sup>. Por isso proteger só os 2 ou 3 bits mais altos já resolve quase tudo.</p>`;
}

// Síntese ---------------------------------------------------------------------------------------------------

/** Métricas de erro das configurações sintetizadas (calculadas uma vez, com entradas uniformes). */
const synthErr = new Map();
function renderSynth() {
    if (!synth) {
        $('synthNote').textContent = 'Os resultados da síntese (data/synth.json) não foram encontrados. Eles são gerados na publicação do site, ou localmente com npm run synth (precisa de iverilog e yosys).';
        $('synthTable').innerHTML = '';
        $('synthFig').innerHTML = '';
        return;
    }
    $('synthNote').innerHTML = `Cada configuração pré-definida é exportada em Verilog, conferida no Icarus Verilog com vetores do simulador e sintetizada com o Yosys para FPGA Xilinx 7 series, a cada publicação do site (${esc(synth.generated)}, ${esc(synth.tools.yosys.replace(/ \(.*/, ''))}, <code>${esc(synth.flow.replace('read_verilog; ', ''))}</code>). O Vivado costuma dar menos LUTs: compare as configurações entre si, não com números de outra ferramenta.`;
    const curName = cur ? unitName(cur.cfg) : null;
    for (const d of synth.designs) if (!d.err && !synthErr.has(d.name)) synthErr.set(d.name, null);
    $('synthTable').innerHTML = '<tr><th>configuração</th><th>portas</th><th>LUTs</th><th>CARRY4</th><th>prof.</th><th>MRED</th></tr>'
        + synth.designs.map((d, k) => {
            const e = d.err ? d.err.MRED : synthErr.get(d.name);
            return `<tr data-k="${k}" class="${d.name === curName ? 'cur' : ''}"><td class="mono left">${esc(d.name)}</td><td>${d.gates}</td><td>${d.luts}</td><td>${d.carry4}</td><td>${d.depth}</td><td>${e === null ? '…' : pct(e)}</td></tr>`;
        }).join('');
    const group = (d) => `${d.cfg.kind}${d.cfg.width}`;
    $('synthFig').innerHTML = scatterSvg(synth.designs.map((d) => ({ x: d.gates, y: d.luts + d.carry4, label: d.name, group: group(d), current: d.name === curName })),
        { xLabel: 'portas de duas entradas (modelo)', yLabel: 'LUTs + CARRY4 (Yosys)' });
    // Concordância de ordem entre modelo e síntese, dentro de cada grupo (pares de configurações).
    let agree = 0, total = 0;
    const ds = synth.designs;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
        if (group(ds[i]) !== group(ds[j]) || ds[i].gates === ds[j].gates) continue;
        total++;
        if (Math.sign(ds[i].gates - ds[j].gates) === Math.sign(ds[i].luts + ds[i].carry4 - ds[j].luts - ds[j].carry4)) agree++;
    }
    $('synthCorr').textContent = total ? `Em ${pct(agree / total)} dos pares de configurações do mesmo grupo, o modelo de portas e a síntese concordam sobre qual é a menor. Onde discordam, o modelo erra: no FPGA, uma LUT de 6 entradas absorve várias portas, e a cadeia de carry faz a soma quase de graça.` : '';
    // Métricas de erro, aos poucos, para não travar a página.
    const pending = ds.find((d) => !d.err && synthErr.get(d.name) === null);
    if (pending) {
        setTimeout(() => {
            const u = buildUnit(pending.cfg);
            synthErr.set(pending.name, errorMetrics(u, testInputs(pending.cfg.width, 'uniform', 50000)).MRED);
            if (tab === 'synth') renderSynth();
        }, 0);
    }
}
$('synthTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-k]');
    if (!tr) return;
    loadCfg(synth.designs[+tr.dataset.k].cfg);
});

/** Põe uma configuração nos controles e recalcula. */
function loadCfg(cfg) {
    $('kind').value = cfg.kind;
    $('width').value = String(cfg.width);
    syncControls();
    if (cfg.kind === 'mul') {
        $('mulMethod').value = cfg.method ?? 'array';
        syncControls();
        $('kTrunc').value = cfg.kTrunc ?? 0;
        $('kApprox').value = cfg.kApprox ?? 0;
        $('approxCarry').checked = cfg.approxCarry !== false;
        if (cfg.kBlock !== undefined) $('kBlock').value = cfg.kBlock;
        if (cfg.k !== undefined) $('drumK').value = cfg.k;
        $('comp').checked = !!cfg.comp;
    } else {
        $('adder').value = cfg.adder;
        if (cfg.k !== undefined) $('kAdd').value = cfg.k;
        if (cfg.L !== undefined) $('segL').value = cfg.L;
        if (cfg.P !== undefined) $('segP').value = cfg.P;
    }
    evaluateCurrent();
}

$('dlVerilog').onclick = () => {
    if (!cur) return;
    const name = moduleName(cur.cfg);
    const inp = testInputs(cur.cfg.width, 'uniform', 20000, 2026);
    download(`${name}.v`, `${toVerilog(cur.unit, name)}\n${testbench(cur.unit, inp.a.length, `${name}.hex`, name)}`, 'text/plain');
};
$('dlHex').onclick = () => {
    if (!cur) return;
    const name = moduleName(cur.cfg);
    download(`${name}.hex`, vectors(cur.unit, testInputs(cur.cfg.width, 'uniform', 20000, 2026)), 'text/plain');
};

// Aplicação -------------------------------------------------------------------------------------------------

/** Filtro escolhido, se fizer sentido para a unidade (null quando não faz). */
function filterFor(cfg) {
    const f = $('filter').value;
    // Com sinal e 8 bits, os pixels (até 255) não cabem no operando.
    if (cfg.kind === 'mul' && cfg.method === 'booth' && cfg.width === 8) return null;
    if (cfg.kind === 'mul') return f === 'pairs' ? 'gauss' : f;
    if (cfg.width === 8) return 'pairs';
    return f === 'pairs' || f === 'gain' ? 'gauss' : f;
}

function renderApp() {
    if (!cur) return;
    const filter = filterFor(cur.cfg);
    if (!filter) {
        $('appNote').textContent = 'O Booth de 8 bits é com sinal: os operandos vão de -128 a 127, e os pixels (0 a 255) não cabem. Use o Booth de 16 bits.';
        for (const id of ['imgExact', 'imgApprox', 'imgDiff']) { const c = $(id); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
        $('appMetrics').innerHTML = '';
        return;
    }
    const key = `${unitName(cur.cfg)}|${filter}|${image.w}x${image.h}|${image.data[0]}`;
    if (cur.appCache?.key !== key) {
        const ex = applyFilter(image, filter, null);
        const ap = applyFilter(image, filter, cur.unit);
        cur.appCache = { key, ex, ap, psnr: psnr(ex, ap), ssim: ssim(ex, ap) };
    }
    const { ex, ap } = cur.appCache;
    drawGray($('imgExact'), ex);
    drawGray($('imgApprox'), ap);
    const dmax = drawDiff($('imgDiff'), ex, ap);
    $('diffCap').textContent = dmax ? `|diferença| em cor (log), até ${dmax} níveis de cinza` : 'nenhuma diferença';
    const chosen = $('filter').value;
    const notes = {
        gauss: 'Nove produtos pixel × peso por pixel; as somas são exatas com um multiplicador, e aproximadas com um somador.',
        gauss2: 'Com pesos potências de 2, cada produto tem um só produto parcial em 1 por linha: truncar colunas baixas pode não errar nada. O erro depende dos dados, não só da unidade.',
        gain: 'Um produto por pixel: pixel × 180, dividido por 128.',
        pairs: 'Uma soma de 8 bits por pixel: (pixel + vizinho) / 2.',
    };
    $('appNote').textContent = (filter !== chosen ? `Para este tipo de unidade o filtro usado é outro. ` : '') + notes[filter];
    const p = cur.appCache.psnr;
    $('appMetrics').innerHTML = `<table class="kv"><tr><th>PSNR</th><td class="mono">${p === Infinity ? '∞ (imagens iguais)' : `${nf(p)} dB`}</td><td class="note">acima de uns 40 dB a diferença costuma ser invisível</td></tr>`
        + `<tr><th>SSIM</th><td class="mono">${nf(cur.appCache.ssim, 4)}</td><td class="note">1 é igual; mede estrutura, contraste e brilho em janelas 8 × 8</td></tr>`
        + `<tr><th>MRED da unidade</th><td class="mono">${pct(cur.m.MRED)}</td><td class="note">a mesma unidade, avaliada isolada</td></tr></table>`;
}
// Computação estocástica -------------------------------------------------------------------------------------

const scCurves = new Map();          // operação -> {gerador: curva}
const SC_NS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
const scSel = () => ({ op: $('scOp').value, gen: $('scGen').value, N: 2 ** +$('scN').value, x: +$('scX').value, y: +$('scY').value, ber: 10 ** +$('scBer').value });
const scVal = (op, v) => (op === 'bmul' ? nf(v, 3) : nf(v, 4));
function scCurvesOf(op) {
    if (!scCurves.has(op)) scCurves.set(op, Object.fromEntries(Object.keys(SC_GENERATORS).map((g) => [g, scCurve(op, g, SC_NS)])));
    return scCurves.get(op);
}

/** Os primeiros bits dos fluxos, como quadradinhos. */
function streamsSvg(demo, op, N) {
    const n = Math.min(N, 64), cell = 10, L = 150, rowH = 18;
    const rows = [['a', demo.a, ''], ['b', demo.b, '']];
    if (op === 'add') rows.push(['seleção', demo.s, 'sel']);
    rows.push(['saída', demo.out, 'out']);
    const w = L + n * cell + 10, h = rows.length * rowH + 20;
    let s = `<svg class="fig-svg" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`;
    rows.forEach(([name, bits, cls], r) => {
        const ones = bits.reduce((c, v) => c + v, 0);
        const y = 6 + r * rowH;
        s += `<text class="small mono" x="0" y="${y + 10}">${esc(name)}</text><text class="small muted mono" x="${L - 8}" y="${y + 10}" text-anchor="end">${ones}/${N}</text>`;
        for (let t = 0; t < n; t++) s += `<rect class="bit${bits[t] ? ` one ${cls}` : ''}" x="${L + t * cell}" y="${y}" width="${cell - 2}" height="${cell + 2}" rx="1"/>`;
    });
    s += `<text class="small muted" x="${L}" y="${h - 2}">${n < N ? `primeiros ${n} de ${N} bits` : `${N} bits`}</text>`;
    return `${s}</svg>`;
}

function renderScDemo() {
    const { op, gen, N, x, y } = scSel();
    $('scNV').textContent = String(N);
    $('scXV').textContent = String(x);
    $('scYV').textContent = String(y);
    const d = streamDemo(op, gen, N, x, y);
    $('scStreams').innerHTML = streamsSvg(d, op, N);
    const pa = x / 256, pb = y / 256;
    const vin = op === 'bmul' ? `a = 2p − 1 = ${nf(2 * pa - 1, 3)} e b = ${nf(2 * pb - 1, 3)}` : `a = ${nf(pa, 4)} e b = ${nf(pb, 4)}`;
    const rule = op === 'mul' ? 'a saída é a AND bit a bit, e a fração de uns estima a × b'
        : op === 'bmul' ? 'a saída é a XNOR bit a bit; no formato bipolar (v = 2p − 1) isso estima a × b'
            : 'o MUX copia o bit de a quando a seleção vale 1 e o de b quando vale 0; com seleção p = 1/2, a saída estima (a + b) / 2';
    let extra = '';
    if (gen === 'lfsrSame' && op === 'mul') extra = ` Com o mesmo LFSR nos dois fluxos, os uns de b ficam dentro dos uns de a (ou o contrário): a AND dá min(a, b) = ${nf(Math.min(pa, pb), 4)}, não o produto. É o erro de correlação.`;
    if (gen === 'lfsrSame' && op === 'bmul') extra = ' Com o mesmo LFSR nos dois fluxos, a XNOR mede o quanto os fluxos coincidem, 1 − |pa − pb|, não o produto. É o erro de correlação.';
    if (gen === 'lfsrSame' && op === 'add') extra = ' Com a seleção vinda do mesmo LFSR dos dados, ela também fica correlacionada com eles e a soma sai enviesada.';
    $('scDemoNote').innerHTML = `Entradas ${vin}; ${rule}. Estimativa ${scVal(op, d.value)}, exato ${scVal(op, d.exact)}, erro ${scVal(op, d.value - d.exact)}.${extra}`;
}

function renderScCurve() {
    const { op, gen, N } = scSel();
    const curves = scCurvesOf(op);
    const bin = binaryError(op);
    const series = Object.entries(SC_GENERATORS).map(([g, name]) => ({ name, cls: `s-${g}`, dots: true, pts: curves[g].filter((p) => p.nrmse > 0).map((p) => ({ x: p.N, y: p.nrmse })) }));
    series.push({ name: 'binário de 8 bits', cls: 's-bin', pts: [{ x: SC_NS[0], y: bin.nrmse }, { x: SC_NS.at(-1), y: bin.nrmse }] });
    $('scFig').innerHTML = lineChartSvg(series, { xLabel: 'comprimento do fluxo N (bits, ciclos)', yLabel: 'NRMSE', logX: true, logY: true, marker: N, xTicks: [16, 64, 256, 1024, 4096], height: 330 });
    const at = (g) => curves[g].find((p) => p.N === N);
    let h = '<table class="kv"><tr><th></th><td class="note">NRMSE</td><td class="note">bits efetivos</td><td class="note">viés</td></tr>';
    for (const [g, name] of Object.entries(SC_GENERATORS)) {
        const p = at(g);
        h += `<tr><th>${g === gen ? `<b>${esc(name)}</b>` : esc(name)}</th><td class="mono">${pct(p.nrmse)}</td><td class="mono">${p.bits === Infinity ? '∞' : nf(p.bits, 1)}</td><td class="mono">${scVal(op, p.bias)}</td></tr>`;
    }
    h += `<tr><th>binário de 8 bits, 1 ciclo</th><td class="mono">${pct(bin.nrmse)}</td><td class="mono">${bin.bits === Infinity ? '∞' : nf(bin.bits, 1)}</td><td class="mono">0</td></tr></table>`;
    $('scTable').innerHTML = h;
    // Quantos bits o aleatório ideal precisaria para igualar o binário: o erro cai com 1 / raiz(N).
    const r = curves.random.at(-1);
    const nEq = (r.nrmse * Math.sqrt(r.N) / bin.nrmse) ** 2;
    const sob = curves.sobol.find((p) => p.nrmse <= bin.nrmse);
    $('scNote').innerHTML = `NRMSE é a raiz do erro quadrático médio dividida pela faixa da saída, em 512 pares de entradas uniformes. Bits efetivos: os de um conversor ideal com o mesmo erro. Com bits aleatórios o erro cai com 1/√N: dobrar a precisão custa 4 vezes mais ciclos, e igualar o binário de 8 bits pediria uns ${nf(Math.round(nEq / 1000) * 1000)} bits. A sequência de Sobol espalha os uns por igual e o erro cai com 1/N${sob ? `: chega ao binário em N = ${nf(sob.N)}` : ''}. Os LFSRs têm período 255 e param de melhorar em N = 256; um LFSR só para todos os fluxos erra muito em qualquer N, porque os fluxos ficam correlacionados.`;
}

function renderScCost() {
    const { op, N } = scSel();
    const c = scCost(op, N);
    let h = '<table class="kv"><tr><th></th><td class="note">portas</td><td class="note">flip-flops</td></tr>';
    for (const p of c.parts) h += `<tr><th>${esc(p.name)}</th><td class="mono">${nf(p.gates)}</td><td class="mono">${nf(p.ff)}</td></tr>`;
    h += `<tr><th><b>estocástico, total</b></th><td class="mono"><b>${nf(c.gates)}</b></td><td class="mono"><b>${nf(c.ff)}</b></td></tr>`;
    h += `<tr><th><b>${esc(c.bin.name)}</b></th><td class="mono"><b>${nf(c.bin.gates)}</b></td><td class="mono">0</td></tr></table>`;
    h += '<table class="kv" style="margin-top:10px"><tr><th></th><td class="note">ciclos</td><td class="note">período (níveis de porta)</td><td class="note">latência (níveis)</td><td class="note">energia (elementos × ciclos)</td></tr>';
    const eSc = c.gateCycles, eBin = c.bin.gates;
    h += `<tr><th>estocástico, N = ${N}</th><td class="mono">${nf(N)}</td><td class="mono">${c.depth}</td><td class="mono">${nf(N * c.depth)}</td><td class="mono">${nf(eSc)}</td></tr>`;
    h += `<tr><th>binário</th><td class="mono">1</td><td class="mono">${c.bin.depth}</td><td class="mono">${c.bin.depth}</td><td class="mono">${nf(eBin)}</td></tr></table>`;
    $('scCost').innerHTML = h;
    const ratio = eSc / eBin;
    $('scCostNote').innerHTML = `A operação em si é minúscula (${c.parts[0].gates === 1 ? 'uma porta' : `${c.parts[0].gates} portas`}), mas cada fluxo precisa de um gerador (LFSR mais comparador) e a saída de um contador: são eles que dominam a área. O circuito estocástico tem ${nf(c.gates + c.ff)} elementos (portas e flip-flops) contra ${nf(c.bin.gates)} portas do binário, mas trabalha ${nf(N)} ciclos: a energia estimada (cada elemento ativo em todo ciclo) fica ${nf(ratio, 0)} vezes a do binário. A computação estocástica compensa quando os geradores são compartilhados, os valores já chegam como fluxos (de sensores, por exemplo) ou a tolerância a falhas importa mais que a energia.`;
}

let scImgTimer = null;
function renderScFault() {
    const { op, gen, N, ber } = scSel();
    $('scBerV').textContent = ber.toExponential(1).replace('.', ',');
    const bers = [...new Set([1e-4, 1e-3, 1e-2, 0.05, 0.1, ber])].sort((a, b) => a - b);
    let h = `<table class="kv"><tr><th>taxa de erro por bit</th><td class="note">NRMSE estocástico (${esc(SC_GENERATORS[gen])}, N = ${N})</td><td class="note">NRMSE binário de 8 bits</td></tr>`;
    for (const b of bers) {
        const f = faultError(op, gen, N, b);
        const tag = b === ber ? '<b>' : '';
        h += `<tr><th>${tag}${b.toExponential(0).replace('.', ',')}${tag ? '</b>' : ''}</th><td class="mono">${pct(f.sc)}</td><td class="mono">${pct(f.bin)}</td></tr>`;
    }
    $('scFault').innerHTML = `${h}</table>`;
    clearTimeout(scImgTimer);
    scImgTimer = setTimeout(renderScImage, 60);
}

function renderScImage() {
    const { gen, N, ber } = scSel();
    const img = smallImage();
    const exact = applyFilter(img, 'gauss2', null);
    const sc0 = scFilter(img, gen, N, 0);
    const sc = ber > 0 ? scFilter(img, gen, N, ber) : sc0;
    const bin = flipPixelBits(exact, ber);
    drawGray($('scExact'), exact);
    drawGray($('scImg'), sc);
    drawGray($('scBin'), bin);
    $('scImgCap').textContent = `estocástica, N = ${N}, com bits errados`;
    $('scImgNote').innerHTML = 'Aplicação: o gaussiano 3 × 3 com pesos 1 2 1 sem nenhuma multiplicação. Um MUX de 9 entradas sorteia, a cada ciclo, um vizinho com probabilidade igual ao seu peso (soma 16); a fração de uns da saída é a média ponderada. Os pixels compartilham o gerador dos dados, e a seleção vem de outro gerador (ou do mesmo, com um LFSR só). No binário, os bits errados caem nos 8 bits de cada pixel do resultado.';
    const row = (name, x) => { const p = psnr(exact, x); return `<tr><th>${name}</th><td class="mono">${p === Infinity ? '∞' : `${nf(p, 1)} dB`}</td><td class="mono">${nf(ssim(exact, x), 4)}</td></tr>`; };
    $('scImgTable').innerHTML = '<table class="kv"><tr><th></th><td class="note">PSNR</td><td class="note">SSIM</td></tr>'
        + row(`estocástica sem bits errados (N = ${N})`, sc0) + row('estocástica com bits errados', sc) + row('binária com bits errados', bin) + '</table>';
}

function renderSc() {
    renderScDemo();
    renderScCurve();
    renderScCost();
    renderScFault();
}
$('scOp').addEventListener('change', () => renderSc());
$('scGen').addEventListener('change', () => { renderScDemo(); renderScCurve(); renderScFault(); });
$('scN').addEventListener('input', () => renderSc());
for (const id of ['scX', 'scY']) $(id).addEventListener('input', () => renderScDemo());
$('scBer').addEventListener('input', () => renderScFault());
$('filter').onchange = () => { renderApp(); };
$('vosV').addEventListener('input', () => renderVos());
$('vosClock').addEventListener('change', () => renderVos());
for (const id of ['memBer', 'memProt']) $(id).addEventListener('input', () => renderMem());
$('imgSynth').onclick = () => { image = testImage(); renderApp(); dirty.vos = true; dirty.sc = true; };
$('imgFile').onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const useImage = (im) => {
        image = fitImage(im, 256);
        dirty.vos = true;
        dirty.sc = true;
        renderApp();
    };
    if (/\.(ppm|pgm|pbm|pnm)$/i.test(f.name)) {
        // Netpbm: os navegadores não abrem, então o arquivo é lido aqui.
        f.arrayBuffer().then((buf) => {
            try { useImage(parseNetpbm(new Uint8Array(buf))); } catch (err) { $('appNote').textContent = `Não foi possível ler ${f.name}: ${err.message}.`; }
        });
        e.target.value = '';
        return;
    }
    const img = new Image();
    img.onload = () => {
        const s = Math.min(1, 256 / Math.max(img.width, img.height));
        const w = Math.max(8, Math.round(img.width * s)), h = Math.max(8, Math.round(img.height * s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(img.src);
        useImage(fromRgba(ctx.getImageData(0, 0, w, h).data, w, h));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); $('appNote').textContent = `O navegador não abriu ${f.name} como imagem.`; };
    img.src = URL.createObjectURL(f);
    e.target.value = '';
};

// Abas e controles ------------------------------------------------------------------------------------------

function showTab(name) {
    tab = name;
    store.set('axc.tab', name);
    for (const b of $('tabs').querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === name);
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('hidden', p.id !== `pane-${name}`);
    renderTab(name);
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

let timer = null;
const schedule = () => { clearTimeout(timer); timer = setTimeout(evaluateCurrent, 120); };
for (const id of ['kTrunc', 'kApprox', 'kAdd', 'segL', 'segP', 'kBlock', 'drumK']) {
    $(id).addEventListener('input', () => { if (id === 'kTrunc' || id === 'kApprox') lastParam = id; syncControls(); schedule(); });
}
for (const id of ['kind', 'width', 'adder', 'dist', 'approxCarry', 'mulMethod', 'comp']) $(id).addEventListener('change', () => { syncControls(); evaluateCurrent(); });

// Tema e ajuda ----------------------------------------------------------------------------------------------

const themeButton = $('theme-toggle');
function updateThemeIcon() {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeButton.querySelector('.icon').className = `icon ${dark ? 'i-sun' : 'i-moon'}`;
}
themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('axc.theme', next);
    updateThemeIcon();
    if (cur) { dirty.error = true; renderTab(tab); }
});
updateThemeIcon();
const help = new Help($('readme'));
$('open-ajuda').addEventListener('click', () => (help.isOverlay() ? help.close() : help.open()));

syncControls();
evaluateCurrent();
showTab(tab);
fetch('data/synth.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    synth = d;
    if (cur) { renderSummary(); dirty.cmp = true; dirty.synth = true; renderTab(tab); }
});
