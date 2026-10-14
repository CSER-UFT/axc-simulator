/**
 * Interface do simulador de computação aproximada: configuração da unidade, estrutura, erro, comparação
 * (fronteira de Pareto) e aplicação em imagem.
 */
import { buildUnit, unitName, compressorTable } from './axc/units.js';
import { testInputs, errorMetrics, histogram, errorGrid, paretoFront } from './axc/metrics.js';
import { testImage, fromRgba, applyFilter, psnr, ssim } from './axc/image.js';
import { dotDiagram, adderDiagram, histogramSvg, drawHeatmap, rampLegend, paretoSvg, scatterSvg, drawGray, drawDiff, esc } from './ui/plots.js';
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
        return { kind: 'mul', width, kTrunc: +$('kTrunc').value, kApprox: +$('kApprox').value, approxCarry: $('approxCarry').checked };
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
    $('kTrunc').max = 2 * N;
    $('kApprox').max = 2 * N;
    if (+$('kTrunc').value + +$('kApprox').value > 2 * N) $('kApprox').value = 2 * N - +$('kTrunc').value;
    $('kAdd').max = N;
    $('segL').max = N;
    $('segP').max = N;
    const adder = $('adder').value;
    $('kRow').classList.toggle('hidden', !(adder === 'trunc' || adder === 'loa'));
    $('segRow').classList.toggle('hidden', adder !== 'seg');
    for (const id of ['kTrunc', 'kApprox', 'kAdd', 'segL', 'segP']) $(`${id}V`).textContent = $(id).value;
}

const distName = { uniform: 'uniformes', normal: 'normais', exp: 'exponenciais' };

function evaluateCurrent() {
    syncControls();
    const cfg = readCfg();
    const unit = buildUnit(cfg);
    const dist = $('dist').value;
    const inp = testInputs(cfg.width, dist);
    const m = errorMetrics(unit, inp);
    const exact = buildUnit(cfg.kind === 'mul' ? { kind: 'mul', width: cfg.width } : { kind: 'add', width: cfg.width, adder: 'exact' });
    cur = { cfg, unit, m, inp, exact, dist, appCache: null };
    $('evalNote').textContent = inp.exhaustive
        ? `Avaliação exaustiva: todos os ${nf(inp.a.length)} pares de operandos.`
        : `Avaliação por amostragem: ${nf(inp.a.length)} pares com entradas ${distName[dist]} (semente fixa).`;
    renderSummary();
    renderStruct();
    renderError();
    renderCmp();
    if (tab === 'app') renderApp();
    if (tab === 'synth') renderSynth();
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
    h += '<p class="note">Área e atraso vêm de um modelo didático (portas de duas entradas e profundidade lógica), não de uma síntese. Entre parênteses, a diferença para a unidade exata de mesma largura.</p>';
    $('summary').innerHTML = h;
}

// Estrutura -------------------------------------------------------------------------------------------------

function renderStruct() {
    const { unit, cfg } = cur;
    const mul = cfg.kind === 'mul';
    $('structFig').innerHTML = mul ? dotDiagram(unit) : adderDiagram(unit);
    $('structNote').textContent = mul
        ? `Cada ponto é um produto parcial aᵢ·bⱼ, na coluna i + j (a coluna 0 é a menos significativa, à direita). As colunas são reduzidas por estágios de somadores completos e meios somadores, no estilo de Dadda, até sobrarem dois bits; uma soma com propagação de vai um dá o produto de ${2 * cfg.width} bits.`
        : 'Cada coluna soma um bit de a e um de b. A zona colorida mostra onde a soma é aproximada.';
    $('stagesBox').classList.toggle('hidden', !mul);
    $('compBox').classList.toggle('hidden', !mul || !cfg.kApprox);
    if (mul) {
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
    $('histFig').innerHTML = histogramSvg(h, { log: $('histLog').checked });
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
    if (span === 1) {
        const y = cur.unit.net.evaluateOne(i, j), ex = cur.unit.exact(i, j);
        $('heatHover').textContent = `a = ${i}, b = ${j}: exato ${ex}, aproximado ${y}, erro ${y - ex}`;
    } else {
        $('heatHover').textContent = `a em [${i * span}, ${(i + 1) * span}), b em [${j * span}, ${(j + 1) * span}): |erro| médio ${nf(heatGrid.grid[i * G + j])}`;
    }
});

// Comparação ------------------------------------------------------------------------------------------------

const Y_NAMES = { NMED: 'NMED', MRED: 'MRED', MED: 'MED', WCE: 'WCE', MSE: 'MSE', EP: 'EP', imgMSE: 'MSE da imagem filtrada' };
const X_NAMES = { gates: 'área (portas)', delay: 'atraso (níveis de porta)', adp: 'área × atraso' };

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
    return { name: unitName(cfg), cfg, dist, gates, delay, adp: gates * delay, NMED: m.NMED, MRED: m.MRED, MED: m.MED, WCE: m.WCE, MSE: m.MSE, EP: m.EP, imgMSE, filter };
}
function saveCmp() { store.set('axc.cmp', JSON.stringify(cmp)); }

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
    $('paretoFig').innerHTML = paretoSvg(pts, front, { xLabel: X_NAMES[xk], yLabel: Y_NAMES[yk], logY: $('cmpLog').checked });
    const frontNames = new Set(front.map((i) => pts[i].label));
    $('cmpTable').innerHTML = '<tr><th>configuração</th><th>entradas</th><th>portas</th><th>atraso</th><th>LUTs</th><th>MED</th><th>WCE</th><th>NMED</th><th>MRED</th><th>EP</th><th>MSE imagem</th><th></th></tr>'
        + cmp.map((e, k) => `<tr class="${frontNames.has(e.name) ? 'front' : ''}${e.name === curName ? ' cur' : ''}"><td class="mono left">${esc(e.name)}</td><td>${distName[e.dist]}</td><td>${e.gates}</td><td>${e.delay}</td><td>${synthOf(e.name)?.luts ?? '-'}</td>`
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
    if (base.kind === 'mul') {
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
    for (const d of synth.designs) if (!synthErr.has(d.name)) synthErr.set(d.name, null);
    $('synthTable').innerHTML = '<tr><th>configuração</th><th>portas</th><th>LUTs</th><th>CARRY4</th><th>prof.</th><th>MRED</th></tr>'
        + synth.designs.map((d, k) => {
            const e = synthErr.get(d.name);
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
    const pending = ds.find((d) => synthErr.get(d.name) === null);
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
        $('kTrunc').value = cfg.kTrunc ?? 0;
        $('kApprox').value = cfg.kApprox ?? 0;
        $('approxCarry').checked = cfg.approxCarry !== false;
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
    if (cfg.kind === 'mul') return f === 'pairs' ? 'gauss' : f;
    if (cfg.width === 8) return 'pairs';
    return f === 'pairs' || f === 'gain' ? 'gauss' : f;
}

function renderApp() {
    if (!cur) return;
    const filter = filterFor(cur.cfg);
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
    if (name === 'app') renderApp();
    if (name === 'synth') renderSynth();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

let timer = null;
const schedule = () => { clearTimeout(timer); timer = setTimeout(evaluateCurrent, 120); };
for (const id of ['kTrunc', 'kApprox', 'kAdd', 'segL', 'segP']) {
    $(id).addEventListener('input', () => { if (id === 'kTrunc' || id === 'kApprox') lastParam = id; syncControls(); schedule(); });
}
for (const id of ['kind', 'width', 'adder', 'dist', 'approxCarry']) $(id).addEventListener('change', () => { syncControls(); evaluateCurrent(); });

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
    if (cur) renderError();
});
updateThemeIcon();
const help = new Help($('readme'));
$('open-ajuda').addEventListener('click', () => (help.isOverlay() ? help.close() : help.open()));

syncControls();
evaluateCurrent();
showTab(tab);
fetch('data/synth.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    synth = d;
    if (cur) { renderSummary(); renderCmp(); }
    if (tab === 'synth') renderSynth();
});
