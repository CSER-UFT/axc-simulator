/**
 * Interface do simulador de computação aproximada: configuração da unidade, estrutura, erro, comparação
 * (fronteira de Pareto) e aplicação em imagem.
 */
import { buildUnit, unitName, compressorTable } from './axc/units.js';
import { testInputs, errorMetrics, histogram, errorGrid, paretoFront, rng } from './axc/metrics.js';
import { testImage, fromRgba, applyFilter, psnr, ssim } from './axc/image.js';
import { stagesSvg, dotDiagram, adderDiagram, histogramSvg, drawHeatmap, rampLegend, paretoSvg, scatterSvg, drawGray, drawDiff, esc } from './ui/plots.js';
import { toVerilog, testbench, vectors, moduleName } from './axc/verilog.js';
import { Help } from './ui/help.js';

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
const dirty = { struct: true, error: true, cmp: true, app: true, synth: true };
const RENDER = { struct: () => renderStruct(), error: () => renderError(), cmp: () => renderCmp(), app: () => renderApp(), synth: () => renderSynth() };
function renderTab(name) {
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
$('filter').onchange = () => { renderApp(); };
$('imgSynth').onclick = () => { image = testImage(); renderApp(); };
$('imgFile').onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
        const s = Math.min(1, 256 / Math.max(img.width, img.height));
        const w = Math.max(8, Math.round(img.width * s)), h = Math.max(8, Math.round(img.height * s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        image = fromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
        URL.revokeObjectURL(img.src);
        renderApp();
    };
    img.src = URL.createObjectURL(f);
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
