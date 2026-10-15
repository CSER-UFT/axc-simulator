/**
 * Interface do simulador de computação aproximada: configuração da unidade, estrutura, erro, comparação
 * (fronteira de Pareto), aplicação em imagem, tensão e memória, computação estocástica e síntese.
 * Os textos vêm de js/i18n (português e inglês).
 */
import { buildUnit, unitName, compressorTable } from './axc/units.js';
import { testInputs, errorMetrics, histogram, errorGrid, paretoFront, rng, loadOperands, operandsLoaded, APP_DISTRIBUTIONS } from './axc/metrics.js';
import { testImage, fromRgba, parseNetpbm, fitImage, applyFilter, psnr, ssim } from './axc/image.js';
import { lineChartSvg, stagesSvg, dotDiagram, adderDiagram, histogramSvg, drawHeatmap, rampLegend, paretoSvg, scatterSvg, drawGray, drawDiff, esc, designSpaceSvg } from './ui/plots.js';
import { toVerilog, testbench, vectors, moduleName } from './axc/verilog.js';
import { Help } from './ui/help.js';
import { SC_GENERATORS, scCurve, binaryError, streamDemo, scCost, faultError, scFilter, flipPixelBits } from './axc/stochastic.js';
import { timingTrace, capturedOutputs, vosCurve, randomSequence, outputDepths, delayFactor, corruptImage, expectedMemoryMSE, DELAY_MODELS } from './axc/vos.js';
import { LANGUAGES, getLanguage, setLanguage, t, locale, dec } from './i18n/index.js';
import { REFS, TECH_REFS, cite } from './refs.js';
import { LAYERS, decodeModel, decodeTestSet, productTable, classifyRange, classifyBatch, adderAccumulate, summarize, macsPerLayer } from './axc/lenet.js';
import { PRESETS } from './axc/presets.js';

const $ = (id) => document.getElementById(id);
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* só nesta visita */ } },
};
const nf = (v, d = 2) => (Number.isInteger(v) ? v.toLocaleString(locale()) : v.toLocaleString(locale(), { maximumFractionDigits: d }));
const sci = (v) => (v === 0 ? '0' : v >= 0.01 && v < 1e5 ? nf(v, 4) : dec(v.toExponential(2)));
const pct = (v) => (v > 0 && v < 1e-4 ? `${dec((100 * v).toExponential(1))}%` : `${(100 * v).toLocaleString(locale(), { maximumFractionDigits: 2 })}%`);
const fx = (v, d) => dec(v.toFixed(d));
/** Nome da configuração para mostrar: o nome interno (chave da síntese) é em português. */
const dn = (name) => (getLanguage() === 'en' ? name.replace(/ exato$/, ' exact') : name);

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
    $('kBlockV').textContent = +$('kBlock').value >= 2 * N ? t('unit.all') : $('kBlock').value;
}

const distName = (d) => t(`dist.${d}`);

/** Pares reais das aplicações (data/operands.*), baixados só quando uma dessas distribuições é escolhida. */
let operandsPromise = null;
function ensureOperands() {
    operandsPromise ??= Promise.all([fetch('data/operands.json').then((r) => r.json()), fetch('data/operands.bin').then((r) => r.arrayBuffer())])
        .then(([index, buf]) => { loadOperands(index, buf); return true; })
        .catch(() => { operandsPromise = null; return false; });
    return operandsPromise;
}

function evaluateCurrent() {
    syncControls();
    const cfg = readCfg();
    const unit = buildUnit(cfg);
    let dist = $('dist').value;
    if (APP_DISTRIBUTIONS.includes(dist) && !operandsLoaded()) {
        // Enquanto os pares reais chegam, mostra o resultado com entradas uniformes e recalcula depois.
        ensureOperands().then((ok) => { if (ok) evaluateCurrent(); else $('evalNote').textContent = t('eval.opsMissing'); });
        dist = 'uniform';
    }
    const inp = testInputs(cfg.width, dist, undefined, undefined, cfg.kind);
    const m = errorMetrics(unit, inp);
    const exact = exactUnit(cfg);
    cur = { cfg, unit, m, inp, exact, dist, appCache: null, activity: activityOf(unit), exactActivity: activityOf(exact) };
    renderEvalNote();
    renderSummary();
    // Só a aba visível é desenhada agora; as outras, quando forem abertas.
    for (const k of Object.keys(dirty)) dirty[k] = true;
    renderTab(tab);
}
function renderEvalNote() {
    if (cur.inp.app) { $('evalNote').textContent = t(`eval.app.${cur.inp.app}.${cur.cfg.kind}`, { n: nf(cur.inp.a.length), N: cur.cfg.width }); return; }
    $('evalNote').textContent = cur.inp.exhaustive
        ? t('eval.exhaustive', { n: nf(cur.inp.a.length) })
        : t('eval.sampled', { n: nf(cur.inp.a.length), dist: distName(cur.dist) });
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

/** Abas que precisam ser redesenhadas depois de uma mudança na unidade (ou no idioma). */
const dirty = { struct: true, error: true, cmp: true, app: true, synth: true, vos: true, sc: true, nn: true };
const RENDER = { struct: () => renderStruct(), error: () => renderError(), cmp: () => renderCmp(), app: () => renderApp(), synth: () => renderSynth(), vos: () => renderVos(), nn: () => renderNN() };
function renderTab(name) {
    if (name === 'vos') { renderMem(); renderCal(); }
    if (name === 'sc') { if (dirty.sc) { dirty.sc = false; renderSc(); } return; }
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

/** Referências da técnica atual (chaves de js/refs.js). */
function techRefs(cfg) {
    const keys = [];
    const add = (k) => { for (const r of TECH_REFS[k] ?? []) if (!keys.includes(r)) keys.push(r); };
    if (cfg.kind === 'mul') {
        const method = cfg.method ?? 'array';
        add(`mul.${method}`);
        if ((method === 'array' || method === 'booth') && cfg.kTrunc) add('mul.trunc');
        if (method === 'array' && cfg.kApprox) add('mul.approx');
        if (cfg.comp) add('mul.comp');
    } else add(`add.${cfg.adder}`);
    return keys;
}
const refLink = (k) => {
    const r = REFS[k];
    const c = esc(cite(k, getLanguage()));
    return r.doi ? `<a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener" title="${esc(r.title)}">${c}</a>` : `<span title="${esc(r.title)}">${c}</span>`;
};

function renderSummary() {
    const { unit, m, exact, cfg } = cur;
    const g = unit.net.gates, d = unit.net.delay(), g0 = exact.net.gates, d0 = exact.net.delay();
    const rel = (v, v0) => (v0 ? ` <span class="note">(${v <= v0 ? '−' : '+'}${pct(Math.abs(v - v0) / v0)})</span>` : '');
    const cells = Object.entries(unit.net.cells).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
    $('sumTitle').textContent = t('sum.title', { name: dn(unitName(cfg)) });
    let h = '<table class="kv">';
    h += `<tr><th>${t('sum.area')}</th><td class="mono">${t('sum.gates', { n: nf(g) })}${rel(g, g0)}</td></tr>`;
    h += `<tr><th>${t('sum.delay')}</th><td class="mono">${t('sum.levels', { n: d })}${rel(d, d0)}</td></tr>`;
    h += `<tr><th>${t('sum.cells')}</th><td class="mono">${esc(cells)}</td></tr>`;
    h += `<tr><th title="${esc(t('sum.activityHelp'))}">${t('sum.activity')}</th><td class="mono">${t('sum.toggles', { n: nf(cur.activity, 1) })}${rel(cur.activity, cur.exactActivity)}</td></tr>`;
    const sy = synthOf(unitName(cfg));
    if (sy) {
        const sx = synthOf(unitName(exact.cfg));
        h += `<tr><th>FPGA (Yosys)</th><td class="mono">${sy.luts} LUTs${sx ? rel(sy.luts, sx.luts) : ''}, ${sy.carry4} CARRY4, ${t('sum.depth', { n: sy.depth })}</td></tr>`;
        if (sy.asic) h += `<tr><th>ASIC (sky130)</th><td class="mono">${nf(sy.asic.area, 0)} µm²${sx?.asic ? rel(sy.asic.area, sx.asic.area) : ''}, ${nf(sy.asic.delay, 0)} ps${sx?.asic ? rel(sy.asic.delay, sx.asic.delay) : ''}`
            + `${sy.asic.energy ? `, ${nf(sy.asic.energy, 0)} fJ${sx?.asic?.energy ? rel(sy.asic.energy, sx.asic.energy) : ''}` : ''}</td></tr>`;
    } else if (synth) h += `<tr><th>${t('sum.synth')}</th><td class="note">${t('sum.notSynth')}</td></tr>`;
    const refs = techRefs(cfg);
    if (refs.length) h += `<tr><th>${t('sum.refs')}</th><td>${refs.map(refLink).join('; ')} <a href="#" data-help="refs" class="note">(${t('sum.allRefs')})</a></td></tr>`;
    h += '</table>';
    h += '<table class="kv metrics" style="margin-top:10px">';
    // Com amostragem, o intervalo de confiança de 95% de cada média.
    const ci = (k, f) => (m.ci && m.ci[k] > 0 ? ` <span class="note">± ${f(m.ci[k])}</span>` : '');
    const rows = [
        ['ME', t('met.ME'), nf(m.ME)],
        ['MED', t('met.MED'), nf(m.MED) + ci('MED', nf)],
        ['WCE', t('met.WCE'), `${nf(m.WCE)} <span class="note">(a = ${m.worst.a}, b = ${m.worst.b})${m.ci ? ` ${t('sum.wceSampled')}` : ''}</span>`],
        ['MSE', t('met.MSE'), sci(m.MSE) + ci('MSE', sci)],
        ['NMED', t('met.NMED'), sci(m.NMED) + ci('NMED', sci)],
        ['MRED', t('met.MRED'), pct(m.MRED) + ci('MRED', pct)],
        ['EP', t('met.EP'), pct(m.EP) + ci('EP', pct)],
    ];
    for (const [k, tt, v] of rows) h += `<tr><th title="${esc(tt)}">${k}</th><td class="mono">${v}</td><td class="note">${tt}</td></tr>`;
    h += '</table>';
    h += `<p class="note">${t('sum.note')}</p>`;
    $('summary').innerHTML = h;
}

// Estrutura -------------------------------------------------------------------------------------------------

function renderStruct() {
    const { unit, cfg } = cur;
    const mul = cfg.kind === 'mul';
    $('structFig').innerHTML = (mul ? (unit.dots ? dotDiagram(unit) : '') : adderDiagram(unit)) + (mul ? stagesSvg(unit) : '');
    const N = cfg.width;
    const notes = {
        array: () => t('struct.array', { bits: 2 * N }),
        booth: () => t('struct.booth', { half: N / 2, n: N, top: 2 * N - 1 }),
        kulkarni: () => t('struct.kulkarni'),
        drum: () => t('struct.drum', { k: cfg.k }),
        mitchell: () => t('struct.mitchell'),
    };
    $('structNote').textContent = mul ? notes[unit.method]() + (unit.compConst !== undefined ? t('struct.comp', { c: unit.compConst }) : '')
        : t('struct.adder');
    $('stagesBox').classList.toggle('hidden', !mul || !unit.heights);
    $('compBox').classList.toggle('hidden', !mul || unit.method !== 'array' || !cfg.kApprox);
    if (mul && unit.heights) {
        const C = 2 * N;
        const head = `<tr><th>${t('struct.stage')}</th>${Array.from({ length: C }, (_, k) => `<th class="z-${unit.zones[C - 1 - k]}">${C - 1 - k}</th>`).join('')}</tr>`;
        $('stagesTable').innerHTML = head + unit.heights.map((hs, s) => `<tr><th>${s === 0 ? t('struct.products') : s}</th>${Array.from({ length: C }, (_, k) => `<td>${hs[C - 1 - k] || ''}</td>`).join('')}</tr>`).join('');
        $('compTable').innerHTML = `<tr><th>x1 x2 x3 x4</th><th>${t('struct.exact')}</th><th>${t('struct.carrySum')}</th><th>${t('struct.approx')}</th><th>${t('struct.err')}</th></tr>`
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
    $('heatLegend').innerHTML = max ? rampLegend(max) : `<p class="note">${t('err.none')}</p>`;
    $('heatNote').textContent = N <= 8 ? t('err.heat8') : t('err.heat16', { s: 2 ** N / G });
    const h = histogram(m.signed);
    $('histFig').innerHTML = histogramSvg(h, { log: $('histLog').checked, width: 520 });
    $('histNote').textContent = t('err.hist1', { p: pct(1 - m.EP), me: nf(m.ME) })
        + (Math.abs(m.ME) > 0.5 * m.MED && m.MED > 0 ? t('err.oneSided') : t('err.twoSided'));
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
        $('heatHover').textContent = t('err.hover1', { a: i - off, b: j - off, ex, y, e: y - ex });
    } else {
        $('heatHover').textContent = t('err.hoverN', { a0: i * span - off, a1: (i + 1) * span - off, b0: j * span - off, b1: (j + 1) * span - off, e: nf(heatGrid.grid[i * G + j]) });
    }
});

// Comparação ------------------------------------------------------------------------------------------------

const yName = (k) => (k === 'imgMSE' ? t('y.imgMSE') : k);
const xName = (k) => t(`x.${k}`);

/** Entrada da comparação para uma configuração (com o MSE da imagem no filtro escolhido). */
function cmpEntry(cfg, dist) {
    const unit = buildUnit(cfg);
    const m = errorMetrics(unit, testInputs(cfg.width, APP_DISTRIBUTIONS.includes(dist) && !operandsLoaded() ? 'uniform' : dist, undefined, undefined, cfg.kind));
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

const SYNTH_COSTS = ['luts', 'lutsCarry', 'depth', 'asicArea', 'asicDelay', 'asicAdp', 'asicEnergy'];
function renderCmp() {
    const xk = $('cmpX').value, yk = $('cmpY').value;
    const curName = cur ? unitName(cur.cfg) : null;
    const cost = (e) => {
        const sy = synthOf(e.name);
        if (xk === 'luts') return sy?.luts;
        if (xk === 'lutsCarry') return sy ? sy.luts + sy.carry4 : undefined;
        if (xk === 'depth') return sy?.depth;
        if (xk === 'asicArea') return sy?.asic?.area;
        if (xk === 'asicDelay') return sy?.asic?.delay ?? undefined;
        if (xk === 'asicAdp') return sy?.asic ? (sy.asic.area * sy.asic.delay) / 1000 : undefined;
        if (xk === 'asicEnergy') return sy?.asic?.energy ?? undefined;
        return e[xk];
    };
    const usable = cmp.filter((e) => e[yk] !== null && e[yk] !== undefined && cost(e) !== undefined);
    const pts = usable.map((e) => ({ x: cost(e), y: e[yk], label: dn(e.name), current: e.name === curName }));
    const missing = cmp.length - usable.length;
    if (missing && SYNTH_COSTS.includes(xk)) $('sweepNote').textContent = t('cmp.missing', { n: missing });
    const front = paretoFront(pts);
    const logY = $('cmpLog').checked;
    const knee = kneePoint(pts, front, logY);
    $('paretoFig').innerHTML = paretoSvg(pts, front, { xLabel: xName(xk), yLabel: yName(yk), logY, knee });
    const frontNames = new Set(front.map((i) => pts[i].label));
    // Quantas configurações dominam cada uma (0 na fronteira).
    const domBy = new Map(pts.map((p) => [p.label, pts.filter((q) => q !== p && q.x <= p.x && q.y <= p.y && (q.x < p.x || q.y < p.y)).length]));
    $('kneeNote').textContent = knee !== null ? t('cmp.knee', { name: pts[knee].label, log: logY ? t('cmp.kneeLog') : '' }) : t('cmp.noKnee');
    $('cmpTable').innerHTML = `<tr><th>${t('th.config')}</th><th>${t('th.inputs')}</th><th>${t('th.gates')}</th><th>${t('th.delay')}</th><th>LUTs</th><th>${t('th.activity')}</th><th title="${esc(t('th.domByHelp'))}">${t('th.domBy')}</th><th>MED</th><th>WCE</th><th>NMED</th><th>MRED</th><th>EP</th><th>${t('th.imgMSE')}</th><th></th></tr>`
        + cmp.map((e, k) => `<tr class="${frontNames.has(dn(e.name)) ? 'front' : ''}${e.name === curName ? ' cur' : ''}"><td class="mono left">${esc(dn(e.name))}</td><td>${distName(e.dist)}</td><td>${e.gates}</td><td>${e.delay}</td><td>${synthOf(e.name)?.luts ?? '-'}</td><td>${e.activity === undefined ? '-' : nf(e.activity, 1)}</td><td>${domBy.has(dn(e.name)) ? domBy.get(dn(e.name)) : '-'}</td>`
            + `<td>${nf(e.MED)}</td><td>${nf(e.WCE)}</td><td>${sci(e.NMED)}</td><td>${pct(e.MRED)}</td><td>${pct(e.EP)}</td><td>${e.imgMSE === null ? '-' : nf(e.imgMSE, 3)}</td>`
            + `<td><button type="button" class="btn small-btn" data-del="${k}" title="${esc(t('cmp.remove'))}">×</button></td></tr>`).join('');
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
// Ligação com o Simulador de Compilador: abre o fluxo de dados de lá com este multiplicador (#axc=perfil).
const CC_URL = 'https://cser-uft.github.io/riscv-cc-simulator/';
function encodeProfile(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Perfil da unidade atual (multiplicador ou somador) para o simulador de compilador: custo dela e da exata de mesma largura, e o erro. */
function ccProfile() {
    const { unit, exact, cfg, m } = cur;
    const sy = synthOf(unitName(cfg)), sx = synthOf(unitName(exact.cfg));
    const p = { kind: cfg.kind, name: unitName(cfg), cfg, width: cfg.width, gates: unit.net.gates, gatesExact: exact.net.gates, depth: unit.net.delay(), depthExact: exact.net.delay(), MRED: m.MRED, NMED: m.NMED, EP: m.EP };
    if (sy?.asic && sx?.asic) p.asic = { area: sy.asic.area, areaExact: sx.asic.area, delay: sy.asic.delay, delayExact: sx.asic.delay };
    return p;
}
$('toCC').onclick = () => {
    if (!cur) return;
    window.open(`${CC_URL}#axc=${encodeProfile(ccProfile())}`, '_blank', 'noopener');
};

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
    let note;
    if (base.kind === 'mul' && method === 'booth') {
        for (let v = 0; v <= 2 * N - 2; v += N <= 8 ? 1 : 2) list.push({ ...base, kTrunc: v });
        note = 'cmp.sweepTrunc';
    } else if (base.kind === 'mul' && method === 'kulkarni') {
        for (let v = 0; v <= 2 * N; v += 2) list.push({ ...base, kBlock: v });
        note = 'cmp.sweepKul';
    } else if (base.kind === 'mul' && method === 'drum') {
        for (let v = 2; v < N; v++) list.push({ ...base, k: v });
        note = 'cmp.sweepK';
    } else if (base.kind === 'mul' && method === 'mitchell') {
        list.push({ ...base, comp: false }, { ...base, comp: true });
        note = 'cmp.sweepMitchell';
    } else if (base.kind === 'mul') {
        const p = lastParam === 'kTrunc' ? 'kTrunc' : 'kApprox';
        const other = p === 'kTrunc' ? base.kApprox : base.kTrunc;
        const step = N <= 8 ? 1 : 2;
        for (let v = 0; v + other <= 2 * N - 2; v += step) list.push({ ...base, [p]: v });
        note = p === 'kTrunc' ? 'cmp.sweepTrunc' : 'cmp.sweepApprox';
    } else if (base.adder === 'seg') {
        for (let P = 0; P <= N; P++) list.push({ ...base, P });
        note = 'cmp.sweepP';
    } else {
        const adder = base.adder === 'exact' ? 'loa' : base.adder;
        for (let k = 0; k <= N; k++) list.push({ ...base, adder, k });
        note = 'cmp.sweepK';
    }
    $('sweepNote').textContent = t(note, { n: list.length });
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
    const rows = [['config', 'inputs', 'gates', 'delay', 'MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP', 'filter', 'image_MSE']];
    for (const e of cmp) rows.push([e.name, e.dist, e.gates, e.delay, e.MED, e.WCE, e.MSE, e.NMED, e.MRED, e.EP, e.filter ?? '', e.imgMSE ?? '']);
    download(t('cmp.csvName'), rows.map((r) => r.join(',')).join('\n') + '\n', 'text/csv');
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
    const modelKey = $('vosModel').value, model = DELAY_MODELS[modelKey];
    $('vosVV').textContent = fx(V, 2);
    const dU = maxDepth(unit), dE = maxDepth(exact);
    const exactClock = $('vosClock').value === 'exact';
    const period = exactClock ? dE : dU;
    const tu = traceOf(unit), te = traceOf(exact);
    const curveOf = (tr, u, per) => {
        const key = `${per}|${modelKey}`;
        if (!tr.curves.has(key)) tr.curves.set(key, vosCurve(u, tr.trace, tr.seq, per, { model }));
        return tr.curves.get(key);
    };
    const cu = curveOf(tu, unit, period), ce = curveOf(te, exact, dE);
    $('vosFig').innerHTML = lineChartSvg([
        { name: dn(unitName(cur.cfg)), cls: 's-unit', pts: cu.map((p) => ({ x: p.V, y: 100 * p.MRED })) },
        { name: t('vos.exactSeries', { name: dn(unitName(exact.cfg)) }), cls: 's-exact', pts: ce.map((p) => ({ x: p.V, y: 100 * p.MRED })) },
    ], { xLabel: t('vos.xLabel'), yLabel: 'MRED (%)', marker: V, xReverse: true });
    const at = (c) => c.find((p) => Math.abs(p.V - V) < 1e-6) ?? c[c.length - 1];
    const pu = at(cu), pe = at(ce);
    const s = delayFactor(V, model.vt, model.alpha);
    let note = t('vos.note', { period, which: t(exactClock ? 'vos.ofExact' : 'vos.ofOwn'), V: fx(V, 2), s: nf(s, 2), fit: nf(period / s, 1) });
    if (s === Infinity) note = t('vos.belowVt', { vt: fx(model.vt, 2) }).trim();
    if (exactClock && dU > dE) note += t('vos.deeper', { dU, dE });
    else if (exactClock && dU < dE) note += t('vos.shallower', { dU, dE });
    $('vosNote').textContent = note;
    const row = (label, a, b) => `<tr><th>${label}</th><td class="mono">${a}</td><td class="mono">${b}</td></tr>`;
    $('vosTable').innerHTML = `<table class="kv"><tr><th></th><td class="note">${t('vos.thisUnit')}</td><td class="note">${t('vos.exact')}</td></tr>`
        + row(t('vos.energy'), pct(pu.energy), pct(pe.energy))
        + row(t('vos.late'), pct(pu.lateBits), pct(pe.lateBits))
        + row('MRED', pct(pu.MRED), pct(pe.MRED))
        + row('EP', pct(pu.EP), pct(pe.EP))
        + row('MED', nf(pu.MED), nf(pe.MED)) + '</table>'
        + `<p class="note">${t('vos.tableNote')}</p>`;
    // Imagem: ganho de brilho (multiplicador) ou média com o vizinho (somador), em sequência, pixel a pixel.
    const signed8 = unit.signed && unit.cfg.width === 8;
    if (signed8) {
        $('vosExactCap').textContent = '';
        $('vosImgCap').textContent = t('vos.booth8');
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
    const { cap } = capturedOutputs(vosImgCache.trace, period, V, model);
    const exImg = { w: img.w, h: img.h, data: Uint8ClampedArray.from(vosImgCache.trace.out, (v) => fin(unit.decode ? unit.decode(v) : v)) };
    const ref = { w: img.w, h: img.h, data: Uint8ClampedArray.from(img.data, (p, k) => fin(cur.cfg.kind === 'mul' ? p * 180 : p + img.data[k % img.w === img.w - 1 ? k : k + 1])) };
    const vi = { w: img.w, h: img.h, data: Uint8ClampedArray.from(cap, (v) => fin(unit.decode ? unit.decode(v) : v)) };
    drawGray($('vosExact'), ref);
    drawGray($('vosImg'), vi);
    const pAp = psnr(ref, exImg), pV = psnr(ref, vi);
    const f = (x) => (x === Infinity ? '∞' : `${nf(x, 1)} dB`);
    $('vosExactCap').textContent = t('vos.capExact', { f: cur.cfg.kind === 'mul' ? 'pixel × 180 / 128' : t('vos.pairs') });
    $('vosImgCap').textContent = t('vos.capV', { V: fx(V, 2), p: f(pV), pa: f(pAp) });
}

/** Calibração: atraso e energia medidos nas células do sky130 contra os dois modelos (data/sky130-voltage.json). */
let calData = null, calLoading = null;
function renderCal() {
    if (!calData) {
        calLoading ??= fetch('data/sky130-voltage.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => { calData = d; if (d && tab === 'vos') renderCal(); });
        return;
    }
    const fit = calData.fit, vnom = calData.vnom;
    const rel = (v, vt, a) => (v / (v - vt) ** a) / (1 / (1 - vt) ** a);   // atraso relativo à nominal, v normalizado
    const ss = calData.corners.filter((c) => c.process === 'ss' && c.temp === -40);
    const k176 = rel(Math.max(...ss.map((c) => c.V)) / vnom, fit.VtNorm, fit.alpha);   // os medidos são relativos a 1,76 V
    const xs = Array.from({ length: 41 }, (_, i) => 0.6 + i * 0.01);
    const g = DELAY_MODELS.generic, k = DELAY_MODELS.sky130;
    $('vosCal').innerHTML = lineChartSvg([
        { name: t('vos.cal.generic'), cls: 's-exact', pts: xs.map((x) => ({ x, y: rel(x, g.vt, g.alpha) })) },
        { name: t('vos.cal.fit'), cls: 's-unit', pts: xs.filter((x) => x > k.vt + 0.02).map((x) => ({ x, y: rel(x, k.vt, k.alpha) })) },
        { name: t('vos.cal.measured'), cls: 's-sobol', dots: true, pts: ss.map((c) => ({ x: c.V / vnom, y: c.delayRel * k176 })) },
    ], { xLabel: t('vos.cal.x'), yLabel: t('vos.cal.y'), logY: true, xReverse: true, width: 520, height: 300 });
    const row = (c) => `<tr><th>${c.process} ${String(c.temp).replace("-", "−")} °C</th><td class="mono">${fx(c.V, 2)} V</td><td class="mono">${nf(c.delayRel, 2)}</td><td class="mono">${pct(c.energyRel)}</td><td class="mono">${pct((c.V / 1.76) ** 2)}</td></tr>`;
    $('vosCalTable').innerHTML = `<table class="kv"><tr><th>${t('vos.cal.corner')}</th><td class="note">${t('vos.cal.V')}</td><td class="note">${t('vos.cal.delay')}</td><td class="note">${t('vos.cal.energy')}</td><td class="note">(V / 1,76)²</td></tr>`
        + calData.corners.filter((c) => c.process === 'ss' && c.temp === -40).slice().reverse().map(row).join('')
        + calData.corners.filter((c) => c.process !== 'ss').map(row).join('') + '</table>';
    const tt = calData.corners.find((c) => c.name === 'tt_025C_1v80');
    $('vosCalNote').innerHTML = t('vos.cal.note', { load: nf(calData.load_pF * 1000, 1), vt: fx(fit.Vt, 2), vtn: fx(fit.VtNorm, 3), a: fx(fit.alpha, 2), err: pct(fit.rmsLogError), tt: tt ? nf(1 / tt.delayRel, 2) : '' });
}

function renderMem() {
    const ber = 10 ** +$('memBer').value, prot = +$('memProt').value;
    $('memBerV').textContent = dec(ber.toExponential(1));
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
        + `<tr><th>${t('mem.flipped')}</th><td class="mono">${t('mem.flippedV', { n: nf(flips), of: nf(img.data.length * (8 - prot)) })}</td></tr>`
        + `<tr><th>MSE</th><td class="mono">${t('mem.mseV', { mse: nf(mse, 2), exp: nf(exp, 2) })}</td></tr>`
        + `<tr><th>PSNR</th><td class="mono">${p === Infinity ? '∞' : `${nf(p, 1)} dB`}</td></tr>`
        + `<tr><th>${t('mem.reliable')}</th><td class="mono">${t('mem.reliableV', { n: prot, p: pct(prot / 8) })}</td></tr></table>`
        + `<p class="note">${t('mem.note')}</p>`;
}

// Síntese ---------------------------------------------------------------------------------------------------

/** Métricas de erro das configurações sintetizadas (calculadas uma vez, com entradas uniformes). */
const synthErr = new Map();
function renderSynth() {
    if (!synth) {
        $('synthNote').textContent = t('synth.missing');
        $('synthTable').innerHTML = '';
        $('synthFig').innerHTML = '';
        return;
    }
    const asicInfo = synth.asic ? t('synth.asicInfo', { lib: esc(synth.asic.library), cells: synth.asic.cells }) : '';
    $('synthNote').innerHTML = t('synth.note', { date: esc(synth.generated), yosys: esc(synth.tools.yosys.replace(/ \(.*/, '')), flow: esc(synth.flow.replace('read_verilog; ', '')) }) + asicInfo;
    const curName = cur ? unitName(cur.cfg) : null;
    for (const d of synth.designs) if (!d.err && !synthErr.has(d.name)) synthErr.set(d.name, null);
    $('synthTable').innerHTML = `<tr><th>${t('th.config')}</th><th>${t('th.gates')}</th><th>LUTs</th><th>CARRY4</th><th>${t('th.depthShort')}</th><th title="${esc(t('x.asicArea'))}">µm²</th><th title="${esc(t('x.asicDelay'))}">ps</th><th title="${esc(t('x.asicEnergy'))}">fJ</th><th>MRED</th></tr>`
        + synth.designs.map((d, k) => {
            const e = d.err ? d.err.MRED : synthErr.get(d.name);
            return `<tr data-k="${k}" class="${d.name === curName ? 'cur' : ''}"><td class="mono left">${esc(dn(d.name))}</td><td>${d.gates}</td><td>${d.luts}</td><td>${d.carry4}</td><td>${d.depth}</td><td>${d.asic ? nf(d.asic.area, 0) : '-'}</td><td>${d.asic?.delay ? nf(d.asic.delay, 0) : '-'}</td><td>${d.asic?.energy ? nf(d.asic.energy, 0) : '-'}</td><td>${e === null ? '…' : pct(e)}</td></tr>`;
        }).join('');
    const group = (d) => `${d.cfg.kind}${d.cfg.width}`;
    const target = synth.designs.some((d) => d.asic) ? $('synthTarget').value : 'fpga';
    const T = {
        fpga: { x: (d) => d.gates, y: (d) => d.luts + d.carry4, xl: t('synth.xGates'), yl: 'LUTs + CARRY4 (Yosys)' },
        asic: { x: (d) => d.gates, y: (d) => d.asic?.area, xl: t('synth.xGates'), yl: t('x.asicArea') },
        asicDelay: { x: (d) => d.gateDepth, y: (d) => d.asic?.delay, xl: t('synth.xDepth'), yl: t('x.asicDelay') },
    }[target];
    const ds = synth.designs.filter((d) => T.y(d) !== undefined && T.y(d) !== null);
    $('synthFig').innerHTML = scatterSvg(ds.map((d) => ({ x: T.x(d), y: T.y(d), label: dn(d.name), group: group(d), current: d.name === curName })),
        { xLabel: T.xl, yLabel: T.yl });
    // Concordância de ordem entre modelo e síntese, dentro de cada grupo (pares de configurações).
    let agree = 0, total = 0;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
        if (group(ds[i]) !== group(ds[j]) || T.x(ds[i]) === T.x(ds[j])) continue;
        total++;
        if (Math.sign(T.x(ds[i]) - T.x(ds[j])) === Math.sign(T.y(ds[i]) - T.y(ds[j]))) agree++;
    }
    $('synthCorr').textContent = total ? t('synth.agree', { p: pct(agree / total), which: t(target === 'asicDelay' ? 'synth.faster' : 'synth.smaller') }) + t(`synth.why.${target}`) : '';
    renderDesignSpace();
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

// Espaço de projeto (pesquisa): todas as configurações sintetizadas de um grupo, com custo e erro à escolha, a
// fronteira de Pareto e, como referência, a EvoApprox8b sintetizada com o mesmo fluxo (data/evoapprox.json).
let evo = null, evoState = 'idle';
const isExactCfg = (c) => (c.kind === 'add' ? c.adder === 'exact' : (c.method ?? 'array') === 'array' && !c.kTrunc && !c.kApprox && !c.comp);
const techOf = (d) => (d.cfg.kind === 'add' ? d.cfg.adder : isExactCfg(d.cfg) ? 'exact' : d.cfg.method ?? 'array');
function dsCost(d, key, flow) {
    const f = d.asic?.flows?.[flow];
    if (!f) return undefined;
    switch (key) {
        case 'area': return f.area;
        case 'delay': return f.delay;
        case 'energy': return f.energy;
        case 'leakage': return f.leakage;
        case 'adp': return (f.area * f.delay) / 1000;
        case 'edp': return (f.energy * f.delay) / 1000;
        case 'energy.lenet': case 'energy.image': return flow === 'delay' ? d.asic.energyApp?.[key.slice(7)] : undefined;
        case 'luts': return d.luts === undefined ? undefined : d.luts + d.carry4;
        default: return undefined;
    }
}
const dsErrOf = (d, key) => (key.includes('.') ? d.errApp?.[key.split('.')[0]]?.[key.split('.')[1]] : d.err?.[key]);
const dsCiOf = (d, key) => (key.includes('.') ? d.errApp?.[key.split('.')[0]]?.ci?.[key.split('.')[1]] : d.err?.ci?.[key]);
function dsData() {
    const g = $('dsGroup').value, flow = $('dsFlow').value, ck = $('dsCost').value, ek = $('dsErr').value;
    const own = synth.designs.filter((d) => `${d.cfg.kind}${d.cfg.width}` === g).map((d) => ({ d, name: d.name, tech: techOf(d), cfg: d.cfg }));
    const ext = $('dsEvo').checked && evo ? evo.designs.filter((d) => `${d.kind}${d.width}` === g).map((d) => ({ d, name: `EvoApprox ${d.name}`, tech: 'evo' })) : [];
    // A EvoApprox não tem a LUT (só ASIC): fica de fora quando o custo é de FPGA.
    const rows = [...own, ...ext].map((r) => ({ ...r, x: r.tech === 'evo' && ck === 'luts' ? undefined : dsCost(r.d, ck, flow), y: dsErrOf(r.d, ek), ci: dsCiOf(r.d, ek) }));
    // Limite de erro (nas métricas relativas): tira do gráfico as configurações degeneradas, como as que truncam tudo.
    const max = $('dsMax').value === '' || ek.endsWith('WCE') ? Infinity : +$('dsMax').value;
    return { g, flow, ck, ek, max, rows, ok: rows.filter((r) => r.x !== undefined && r.x !== null && r.y !== undefined && r.y !== null && r.y <= max) };
}
const fmtErr = (key, v) => (v === undefined || v === null ? '-' : key.endsWith('WCE') ? nf(v, 0) : key.endsWith('NMED') ? sci(v) : pct(v));
function renderDesignSpace() {
    if (!synth?.asic?.flows) { $('dsNote').textContent = t('ds.old'); $('dsFig').innerHTML = ''; $('dsTable').innerHTML = ''; return; }
    if ($('dsEvo').checked && evoState === 'idle') {
        evoState = 'loading';
        fetch('data/evoapprox.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
            evo = j;
            evoState = j ? 'ok' : 'missing';
            if (tab === 'synth') renderDesignSpace();
        });
    }
    const D = dsData();
    const curName = cur ? unitName(cur.cfg) : null;
    const pts = D.ok.map((r) => ({ x: r.x, y: r.y, label: dn(r.name), tech: r.tech, current: r.name === curName }));
    const front = paretoFront(pts);
    const costName = t(`ds.c.${D.ck.replace('.l', 'L').replace('.i', 'I')}`), errName = $('dsErr').selectedOptions[0].textContent;
    $('dsFig').innerHTML = designSpaceSvg(pts, front, { xLabel: costName, yLabel: errName, logX: $('dsLogX').checked });
    const nOwn = D.ok.filter((r) => r.tech !== 'evo').length, nEvo = D.ok.length - nOwn;
    const missing = D.rows.length - D.ok.length;
    $('dsNote').innerHTML = t('ds.note', { n: nOwn, flow: t(`ds.flow.${D.flow}`), target: synth.asic.targets?.[D.g] ?? '-' })
        + (nEvo ? t('ds.evoNote', { n: nEvo }) : $('dsEvo').checked && evoState === 'missing' ? t('ds.evoMissing') : '')
        + (missing ? t('ds.missing', { n: missing }) : '')
        + (D.max < Infinity ? t('ds.maxNote', { p: pct(D.max) }) : '')
        + (D.ck.startsWith('energy.') ? t('ds.energyAppNote') : '');
    const fr = [...front].sort((i, j) => pts[i].x - pts[j].x).map((i) => D.ok[i]);
    $('dsFrontTitle').textContent = t('ds.frontTitle', { n: fr.length, of: D.ok.length });
    $('dsTable').innerHTML = `<tr><th>${t('th.config')}</th><th>${esc(costName)}</th><th>${esc(errName)}</th><th title="${esc(t('ds.ciHelp'))}">± IC 95%</th><th>µm²</th><th>ps</th><th>fJ</th></tr>`
        + fr.map((r) => {
            const f = r.d.asic.flows[D.flow];
            return `<tr ${r.cfg ? `data-name="${esc(r.name)}"` : ''} class="${r.name === curName ? 'cur' : ''}"><td class="mono left">${esc(dn(r.name))}</td><td>${nf(r.x, 1)}</td><td>${fmtErr(D.ek, r.y)}</td><td>${r.ci === undefined || r.ci === null ? '-' : fmtErr(D.ek, r.ci)}</td><td>${nf(f.area, 0)}</td><td>${nf(f.delay, 0)}</td><td>${nf(f.energy, 0)}</td></tr>`;
        }).join('');
}
for (const id of ['dsGroup', 'dsFlow', 'dsCost', 'dsErr', 'dsMax', 'dsEvo', 'dsLogX']) $(id).addEventListener('change', () => renderDesignSpace());
$('dsTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-name]');
    const d = tr && synth.designs.find((x) => x.name === tr.dataset.name);
    if (d) loadCfg(d.cfg);
});
/** Todas as configurações do grupo (e a referência, se marcada), com todos os custos e erros, e se estão na fronteira. */
function dsExport() {
    const D = dsData();
    const pts = D.ok.map((r) => ({ x: r.x, y: r.y }));
    const onFront = new Set(paretoFront(pts).map((i) => D.ok[i]));
    const flows = ['delay', 'area', 'iso'];
    return D.rows.map((r) => {
        const o = { source: r.tech === 'evo' ? 'EvoApprox8b' : 'axc-simulator', name: r.name, group: D.g, technique: r.tech, cfg: r.cfg ?? null };
        for (const fl of flows) { const f = r.d.asic?.flows?.[fl]; if (f) Object.assign(o, { [`${fl}_area_um2`]: f.area, [`${fl}_delay_ps`]: f.delay, [`${fl}_energy_fJ`]: f.energy, [`${fl}_leakage_nW`]: f.leakage }); }
        o.energy_lenet_fJ = r.d.asic?.energyApp?.lenet ?? null;
        o.energy_image_fJ = r.d.asic?.energyApp?.image ?? null;
        o.luts_carry4 = r.tech === 'evo' ? null : r.d.luts + r.d.carry4;
        for (const k of ['MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP']) { o[k] = r.d.err?.[k] ?? null; o[`${k}_ci95`] = r.d.err?.ci?.[k] ?? null; }
        for (const app of ['lenet', 'image']) for (const k of ['NMED', 'MRED', 'EP']) { o[`${app}_${k}`] = r.d.errApp?.[app]?.[k] ?? null; o[`${app}_${k}_ci95`] = r.d.errApp?.[app]?.ci?.[k] ?? null; }
        o.pareto = onFront.has(r);
        o.pareto_axes = `${D.ck} x ${D.ek} (${D.flow}${D.max < Infinity ? `, ${D.ek} <= ${D.max}` : ''})`;
        return o;
    });
}
$('dsCsv').onclick = () => {
    if (!synth?.asic?.flows) return;
    const rows = dsExport();
    const cols = Object.keys(rows[0] ?? {}).filter((k) => k !== 'cfg');
    const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'string' && /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
    download(`axc-${$('dsGroup').value}.csv`, `${cols.join(',')}\n${rows.map((r) => cols.map((k) => cell(r[k])).join(',')).join('\n')}\n`, 'text/csv');
};
$('dsJson').onclick = () => {
    if (!synth?.asic?.flows) return;
    const meta = { generated: synth.generated, tools: synth.tools, asic: synth.asic, evoapprox: evo ? evo.source : null };
    download(`axc-${$('dsGroup').value}.json`, `${JSON.stringify({ meta, designs: dsExport() }, null, 1)}\n`, 'application/json');
};
$('dsSvg').onclick = () => {
    const svg = $('dsFig').querySelector('svg');
    if (!svg) return;
    const clone = svg.cloneNode(true);
    const colors = { exact: '#222', array: '#2f6fdf', booth: '#7a3fb8', kulkarni: '#c2410c', drum: '#0f8b8d', mitchell: '#b8860b', trunc: '#c03060', loa: '#2b9a66', seg: '#8a6d3b' };
    const css = '.axis{stroke:#555}.grid{stroke:#ddd}.small{font:11px sans-serif}.mono{font-family:monospace}.muted{fill:#555}.front{fill:none;stroke:#111;stroke-width:1.2;stroke-dasharray:4 3}.pt{stroke:#fff;stroke-width:1;fill-opacity:.55}.pt.on{fill-opacity:1;stroke:#111}'
        + Object.entries(colors).map(([k, c]) => `.t-${k}{fill:${c}}`).join('') + '.pt.t-evo{fill:none;fill-opacity:1;stroke:#e0457b;stroke-width:1.6}';
    clone.insertAdjacentHTML('afterbegin', `<style>${css}</style>`);
    download(`axc-${$('dsGroup').value}.svg`, clone.outerHTML, 'image/svg+xml');
};
$('synthTarget').addEventListener('change', () => renderSynth());
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

let imgMessage = null;   // aviso sobre o último arquivo de imagem (erro de leitura)
function renderApp() {
    if (!cur) return;
    const filter = filterFor(cur.cfg);
    if (!filter) {
        $('appNote').textContent = t('app.booth8');
        for (const id of ['imgExact', 'imgApprox', 'imgDiff']) { const c = $(id); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
        $('appMetrics').innerHTML = '';
        $('diffCap').textContent = '';
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
    $('diffCap').textContent = dmax ? t('app.diff', { n: dmax }) : t('app.noDiff');
    const chosen = $('filter').value;
    $('appNote').textContent = (imgMessage ? `${imgMessage} ` : '') + (filter !== chosen ? t('app.otherFilter') : '') + t(`app.note.${filter}`);
    const p = cur.appCache.psnr;
    $('appMetrics').innerHTML = `<table class="kv"><tr><th>PSNR</th><td class="mono">${p === Infinity ? t('app.same') : `${nf(p)} dB`}</td><td class="note">${t('app.psnrNote')}</td></tr>`
        + `<tr><th>SSIM</th><td class="mono">${nf(cur.appCache.ssim, 4)}</td><td class="note">${t('app.ssimNote')}</td></tr>`
        + `<tr><th>${t('app.mredUnit')}</th><td class="mono">${pct(cur.m.MRED)}</td><td class="note">${t('app.mredNote')}</td></tr></table>`;
}

// Rede neural (LeNet-5 no MNIST) -----------------------------------------------------------------------------

let nnData = null;          // {model, test} depois de carregar
let nnLoading = null;
let nnRun = 0;              // muda a cada nova execução: as antigas param
const nnCache = new Map();  // unidades e camadas -> classes previstas
const nnMask = () => LAYERS.map((l) => $(`nnL-${l}`).checked);
$('nnLayers').insertAdjacentHTML('beforeend', LAYERS.map((l) => `<label class="check"><input type="checkbox" id="nnL-${l}" checked /> ${l}</label>`).join(''));
// Somadores para as acumulações: os pré-definidos (8 e 16 bits); a unidade fica nos bits baixos do acumulador.
const NN_ADDERS = PRESETS.filter((c) => c.kind === 'add' && c.adder !== 'exact');
function fillNNAdders() {
    const v = $('nnAdder').value;
    $('nnAdder').innerHTML = `<option value="exact">${t('nn.adderExact')}</option><option value="left">${t('nn.adderLeft')}</option>`
        + NN_ADDERS.map((c, i) => `<option value="${i}">${esc(dn(unitName(c)))}</option>`).join('');
    $('nnAdder').value = [...$('nnAdder').options].some((o) => o.value === v) ? v : 'exact';
}
fillNNAdders();

function loadNN() {
    if (!nnLoading) {
        nnLoading = Promise.all([
            fetch('data/lenet5.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
            fetch('data/mnist1000.bin').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))),
        ]).then(([json, bin]) => {
            const model = decodeModel(json);
            nnData = { model, test: decodeTestSet(bin, model.subset.n) };
            return nnData;
        });
    }
    return nnLoading;
}

/**
 * Classifica o conjunto de teste em lotes, sem travar a página. Com o somador exato, imagem a imagem (mais
 * rápido); com um somador aproximado, em lotes de 25 imagens, camada a camada.
 */
function classifyAsync(tables, adds, key, onProgress) {
    if (nnCache.has(key)) return Promise.resolve(nnCache.get(key));
    const { model, test } = nnData;
    const run = nnRun;
    const preds = new Uint8Array(test.n);
    const approxAdd = adds.some((f) => f);
    const chunk = approxAdd ? 25 : 50;
    return new Promise((resolve, reject) => {
        let k = 0;
        const step = () => {
            if (run !== nnRun) { reject(new Error('cancelada')); return; }
            const end = Math.min(test.n, k + chunk);
            if (approxAdd) classifyBatch(model, test, tables, adds, k, end, preds);
            else classifyRange(model, test, tables, k, end, preds);
            k = end;
            onProgress?.(k, test.n);
            if (k < test.n) setTimeout(step, 0);
            else { nnCache.set(key, preds); resolve(preds); }
        };
        setTimeout(step, 0);
    });
}

const tableCache = new Map();
function tableOf(unit) {
    const key = unit ? unitName(unit.cfg) : 'exata';
    if (!tableCache.has(key)) tableCache.set(key, productTable(unit));
    return tableCache.get(key);
}

/** Multiplicador e somador usados nas camadas aproximadas. */
function nnUnits() {
    const mul = cur.cfg.kind === 'mul' ? cur.unit : null;
    let add = null;
    const sel = $('nnAdder').value;
    $('nnAdder').querySelector('option[value="left"]').disabled = cur.cfg.kind !== 'add';
    if (cur.cfg.kind === 'add') { add = cur.unit; $('nnAdder').value = 'left'; }
    else if (sel === 'left') $('nnAdder').value = 'exact';
    else if (sel !== 'exact') add = buildUnit(NN_ADDERS[+sel]);
    if (add && add.cfg.adder === 'exact') add = null;
    return { mul, add };
}
const nnKey = (mul, add, mask) => `${mul ? unitName(mul.cfg) : 'exata'}|${add ? unitName(add.cfg) : 'exato'}|${mask.join('')}`;
function nnSetup(mask) {
    const { mul, add } = nnUnits();
    const Tu = tableOf(mul), Tx = tableOf(null);
    const accum = add ? adderAccumulate(add) : null;
    return { mul, add, tables: mask.map((m) => (m ? Tu : Tx)), adds: mask.map((m) => (m ? accum : null)), key: nnKey(mul, add, mask) };
}

function drawDigit(canvas, img) {
    canvas.width = 28; canvas.height = 28;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(28, 28);
    for (let k = 0; k < 784; k++) { const v = 255 - img[k]; id.data.set([v, v, v, 255], 4 * k); }
    ctx.putImageData(id, 0, 0);
}

async function renderNN() {
    if (!cur) return;
    nnRun++;
    $('nnSens').innerHTML = '';
    try {
        if (!nnData) { $('nnStatus').textContent = t('nn.loading'); await loadNN(); }
    } catch {
        $('nnStatus').textContent = t('nn.loadError');
        return;
    }
    const { model, test } = nnData;
    const mask = nnMask();
    const setup = nnSetup(mask);
    const progress = (k, n) => { $('nnStatus').textContent = t('nn.progress', { k, n }); };
    let preds, refUnitPreds = null;
    try {
        preds = await classifyAsync(setup.tables, setup.adds, setup.key, progress);
        // Booth de 8 bits: a unidade recebe a >> 1; a referência da técnica (Booth exato) também perde o bit baixo.
        if (setup.mul?.signed && cur.cfg.width === 8) {
            const T = tableOf(cur.exact);
            refUnitPreds = await classifyAsync(mask.map((m) => (m ? T : tableOf(null))), Array(5).fill(null), nnKey(cur.exact, null, mask), progress);
        }
    } catch { return; }   // outra execução começou
    $('nnStatus').textContent = '';
    const ref = model.expected;   // a rede exata (as mesmas classes do script em Python)
    const sx = summarize(test, ref), su = summarize(test, preds, ref);
    const macs = macsPerLayer(model), total = macs.reduce((a, b) => a + b, 0);
    const approxMacs = macs.reduce((a, m, i) => a + (mask[i] ? m : 0), 0);
    const label = `${setup.mul ? dn(unitName(setup.mul.cfg)) : t('nn.mulExact')} + ${setup.add ? dn(unitName(setup.add.cfg)) : t('nn.addExact')}`;
    let h = '<table class="kv">';
    h += `<tr><th>${t('nn.accExact')}</th><td class="mono">${pct(sx.accuracy)}</td></tr>`;
    if (refUnitPreds) h += `<tr><th>${t('nn.accRefUnit', { name: dn(unitName(cur.exact.cfg)) })}</th><td class="mono">${pct(summarize(test, refUnitPreds).accuracy)}</td></tr>`;
    h += `<tr><th><b>${t('nn.accUnit', { name: label })}</b></th><td class="mono"><b>${pct(su.accuracy)}</b> (${su.accuracy >= sx.accuracy ? '+' : '−'}${nf(Math.abs(su.accuracy - sx.accuracy) * 100, 1)} ${t('nn.pp')})</td></tr>`;
    h += `<tr><th>${t('nn.changed')}</th><td class="mono">${t('nn.changedV', { broke: su.broke.length, fixed: su.fixed })}</td></tr>`;
    h += `<tr><th>${t('nn.approxMacs')}</th><td class="mono">${nf(approxMacs)} ${t('nn.of')} ${nf(total)} (${pct(approxMacs / total)})</td></tr>`;
    if (setup.mul) h += `<tr><th>${t('nn.unitMred')}</th><td class="mono">${pct(cur.m.MRED)}</td></tr>`;
    h += '</table>';
    $('nnTable').innerHTML = h;
    $('nnNote').innerHTML = t('nn.note', { float: pct(model.accuracy.float), int8: pct(model.accuracy.int8) }) + (refUnitPreds ? ` ${t('nn.booth8')}` : '') + (setup.add ? ` ${t('nn.adderNote', { n: setup.add.cfg.width })}` : '');
    // Matriz de confusão da rede com a unidade.
    let c = `<table class="conf"><tr><th></th>${Array.from({ length: 10 }, (_, k) => `<th>${k}</th>`).join('')}</tr>`;
    su.conf.forEach((row, y) => {
        const n = row.reduce((a, b) => a + b, 0) || 1;
        c += `<tr><th>${y}</th>${row.map((v, p) => `<td class="${p === y ? 'diag' : v ? 'off' : ''}" style="--v:${p === y ? (0.15 + 0.6 * v / n).toFixed(2) : Math.min(1, 0.25 + v / 20).toFixed(2)}">${v || ''}</td>`).join('')}</tr>`;
    });
    $('nnConf').innerHTML = `${c}</table>`;
    // Dígitos que passaram a errar.
    const shown = su.broke.slice(0, 40);
    $('nnBroke').innerHTML = shown.length ? shown.map((k) => `<figure><canvas data-k="${k}"></canvas><figcaption>${test.labels[k]} → ${preds[k]}</figcaption></figure>`).join('')
        + (su.broke.length > shown.length ? `<p class="note">${t('nn.more', { n: su.broke.length - shown.length })}</p>` : '')
        : `<p class="note">${t('nn.noneBroke')}</p>`;
    for (const cv of $('nnBroke').querySelectorAll('canvas')) drawDigit(cv, test.images.subarray(+cv.dataset.k * 784, (+cv.dataset.k + 1) * 784));
}

$('nnLayers').addEventListener('change', () => { if (tab === 'nn') renderNN(); else dirty.nn = true; });
$('nnAdder').addEventListener('change', () => { if (tab === 'nn') renderNN(); else dirty.nn = true; });
$('nnSensBtn').onclick = async () => {
    if (!cur || !nnData) return;
    const run = ++nnRun;
    const macs = macsPerLayer(nnData.model), total = macs.reduce((a, b) => a + b, 0);
    const rows = [];
    for (let i = 0; i < LAYERS.length; i++) {
        const setup = nnSetup(LAYERS.map((_, j) => j === i));
        let preds;
        try {
            preds = await classifyAsync(setup.tables, setup.adds, setup.key, (k, n) => { $('nnStatus').textContent = t('nn.sensProgress', { layer: LAYERS[i], k, n }); });
        } catch { return; }
        if (run !== nnRun) return;
        rows.push(`<tr><th>${LAYERS[i]}</th><td class="mono">${pct(macs[i] / total)}</td><td class="mono">${pct(summarize(nnData.test, preds).accuracy)}</td></tr>`);
    }
    $('nnStatus').textContent = '';
    $('nnSens').innerHTML = `<h3>${t('nn.sensTitle')}</h3><table class="kv"><tr><th></th><td class="note">${t('nn.sensMacs')}</td><td class="note">${t('nn.sensAcc')}</td></tr>${rows.join('')}</table><p class="note">${t('nn.sensNote')}</p>`;
};

// Computação estocástica -------------------------------------------------------------------------------------

const scCurves = new Map();          // operação -> {gerador: curva}
const SC_NS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
const scSel = () => ({ op: $('scOp').value, gen: $('scGen').value, N: 2 ** +$('scN').value, x: +$('scX').value, y: +$('scY').value, ber: 10 ** +$('scBer').value });
const scVal = (op, v) => (op === 'bmul' ? nf(v, 3) : nf(v, 4));
const genName = (g) => t(`sc.gen.${g}`);
function scCurvesOf(op) {
    if (!scCurves.has(op)) scCurves.set(op, Object.fromEntries(Object.keys(SC_GENERATORS).map((g) => [g, scCurve(op, g, SC_NS)])));
    return scCurves.get(op);
}

/** Os primeiros bits dos fluxos, como quadradinhos. */
function streamsSvg(demo, op, N) {
    const n = Math.min(N, 64), cell = 10, L = 150, rowH = 18;
    const rows = [['a', demo.a, ''], ['b', demo.b, '']];
    if (op === 'add') rows.push([t('sc.select'), demo.s, 'sel']);
    rows.push([t('sc.output'), demo.out, 'out']);
    const w = L + n * cell + 10, h = rows.length * rowH + 20;
    let s = `<svg class="fig-svg" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`;
    rows.forEach(([name, bits, cls], r) => {
        const ones = bits.reduce((c, v) => c + v, 0);
        const y = 6 + r * rowH;
        s += `<text class="small mono" x="0" y="${y + 10}">${esc(name)}</text><text class="small muted mono" x="${L - 8}" y="${y + 10}" text-anchor="end">${ones}/${N}</text>`;
        for (let k = 0; k < n; k++) s += `<rect class="bit${bits[k] ? ` one ${cls}` : ''}" x="${L + k * cell}" y="${y}" width="${cell - 2}" height="${cell + 2}" rx="1"/>`;
    });
    s += `<text class="small muted" x="${L}" y="${h - 2}">${n < N ? t('sc.firstBits', { n, N }) : t('sc.allBits', { N })}</text>`;
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
    const vin = op === 'bmul' ? t('sc.vinBip', { a: nf(2 * pa - 1, 3), b: nf(2 * pb - 1, 3) }) : t('sc.vinUni', { a: nf(pa, 4), b: nf(pb, 4) });
    let extra = '';
    if (gen === 'lfsrSame') extra = t(`sc.corr.${op}`, { min: nf(Math.min(pa, pb), 4) });
    $('scDemoNote').innerHTML = t('sc.demo', { vin, rule: t(`sc.rule.${op}`), v: scVal(op, d.value), ex: scVal(op, d.exact), e: scVal(op, d.value - d.exact) }) + extra;
}

function renderScCurve() {
    const { op, gen, N } = scSel();
    const curves = scCurvesOf(op);
    const bin = binaryError(op);
    const series = Object.keys(SC_GENERATORS).map((g) => ({ name: genName(g), cls: `s-${g}`, dots: true, pts: curves[g].filter((p) => p.nrmse > 0).map((p) => ({ x: p.N, y: p.nrmse })) }));
    series.push({ name: t('sc.bin8'), cls: 's-bin', pts: [{ x: SC_NS[0], y: bin.nrmse }, { x: SC_NS.at(-1), y: bin.nrmse }] });
    $('scFig').innerHTML = lineChartSvg(series, { xLabel: t('sc.xLabel'), yLabel: 'NRMSE', logX: true, logY: true, marker: N, xTicks: [16, 64, 256, 1024, 4096], height: 330 });
    const at = (g) => curves[g].find((p) => p.N === N);
    let h = `<table class="kv"><tr><th></th><td class="note">NRMSE</td><td class="note">${t('sc.effBits')}</td><td class="note">${t('sc.bias')}</td></tr>`;
    for (const g of Object.keys(SC_GENERATORS)) {
        const p = at(g);
        h += `<tr><th>${g === gen ? `<b>${esc(genName(g))}</b>` : esc(genName(g))}</th><td class="mono">${pct(p.nrmse)}</td><td class="mono">${p.bits === Infinity ? '∞' : nf(p.bits, 1)}</td><td class="mono">${scVal(op, p.bias)}</td></tr>`;
    }
    h += `<tr><th>${t('sc.bin8cycle')}</th><td class="mono">${pct(bin.nrmse)}</td><td class="mono">${bin.bits === Infinity ? '∞' : nf(bin.bits, 1)}</td><td class="mono">0</td></tr></table>`;
    $('scTable').innerHTML = h;
    // Quantos bits o aleatório ideal precisaria para igualar o binário: o erro cai com 1 / raiz(N).
    const r = curves.random.at(-1);
    const nEq = (r.nrmse * Math.sqrt(r.N) / bin.nrmse) ** 2;
    const sob = curves.sobol.find((p) => p.nrmse <= bin.nrmse);
    $('scNote').innerHTML = t('sc.curveNote', { neq: nf(Math.round(nEq / 1000) * 1000), sob: sob ? t('sc.sobReach', { N: nf(sob.N) }) : '' });
}

function renderScCost() {
    const { op, N } = scSel();
    const c = scCost(op, N);
    let h = `<table class="kv"><tr><th></th><td class="note">${t('th.gates')}</td><td class="note">flip-flops</td></tr>`;
    for (const p of c.parts) h += `<tr><th>${esc(t(p.key, p.params))}</th><td class="mono">${nf(p.gates)}</td><td class="mono">${nf(p.ff)}</td></tr>`;
    h += `<tr><th><b>${t('sc.costTotal')}</b></th><td class="mono"><b>${nf(c.gates)}</b></td><td class="mono"><b>${nf(c.ff)}</b></td></tr>`;
    h += `<tr><th><b>${esc(t(c.bin.key))}</b></th><td class="mono"><b>${nf(c.bin.gates)}</b></td><td class="mono">0</td></tr></table>`;
    h += `<table class="kv" style="margin-top:10px"><tr><th></th><td class="note">${t('sc.cycles')}</td><td class="note">${t('sc.period')}</td><td class="note">${t('sc.latency')}</td><td class="note">${t('sc.energy')}</td></tr>`;
    const eSc = c.gateCycles, eBin = c.bin.gates;
    h += `<tr><th>${t('sc.costSc', { N })}</th><td class="mono">${nf(N)}</td><td class="mono">${c.depth}</td><td class="mono">${nf(N * c.depth)}</td><td class="mono">${nf(eSc)}</td></tr>`;
    h += `<tr><th>${t('sc.costBin')}</th><td class="mono">1</td><td class="mono">${c.bin.depth}</td><td class="mono">${c.bin.depth}</td><td class="mono">${nf(eBin)}</td></tr></table>`;
    $('scCost').innerHTML = h;
    $('scCostNote').innerHTML = t('sc.costNote', { op: c.parts[0].gates === 1 ? t('sc.oneGate') : t('sc.nGates', { n: c.parts[0].gates }), el: nf(c.gates + c.ff), bin: nf(c.bin.gates), N: nf(N), r: nf(eSc / eBin, 0) });
}

let scImgTimer = null;
function renderScFault() {
    const { op, gen, N, ber } = scSel();
    $('scBerV').textContent = dec(ber.toExponential(1));
    const bers = [...new Set([1e-4, 1e-3, 1e-2, 0.05, 0.1, ber])].sort((a, b) => a - b);
    let h = `<table class="kv"><tr><th>${t('mem.ber')}</th><td class="note">${t('sc.faultSc', { gen: esc(genName(gen)), N })}</td><td class="note">${t('sc.faultBin')}</td></tr>`;
    for (const b of bers) {
        const f = faultError(op, gen, N, b);
        const tag = b === ber ? '<b>' : '';
        h += `<tr><th>${tag}${dec(b.toExponential(0))}${tag ? '</b>' : ''}</th><td class="mono">${pct(f.sc)}</td><td class="mono">${pct(f.bin)}</td></tr>`;
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
    $('scImgCap').textContent = t('sc.imgCap', { N });
    $('scImgNote').innerHTML = t('sc.imgNote');
    const row = (name, x) => { const p = psnr(exact, x); return `<tr><th>${name}</th><td class="mono">${p === Infinity ? '∞' : `${nf(p, 1)} dB`}</td><td class="mono">${nf(ssim(exact, x), 4)}</td></tr>`; };
    $('scImgTable').innerHTML = '<table class="kv"><tr><th></th><td class="note">PSNR</td><td class="note">SSIM</td></tr>'
        + row(t('sc.rowSc0', { N }), sc0) + row(t('sc.rowSc'), sc) + row(t('sc.rowBin'), bin) + '</table>';
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
$('vosModel').addEventListener('change', () => renderVos());
for (const id of ['memBer', 'memProt']) $(id).addEventListener('input', () => renderMem());
$('imgSynth').onclick = () => { image = testImage(); imgMessage = null; dirty.vos = true; dirty.sc = true; if (cur) cur.appCache = null; renderApp(); };
$('imgFile').onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const useImage = (im) => {
        image = fitImage(im, 256);
        imgMessage = null;
        dirty.vos = true;
        dirty.sc = true;
        renderApp();
    };
    const fail = (msg) => { imgMessage = msg; renderApp(); };
    if (/\.(ppm|pgm|pbm|pnm)$/i.test(f.name)) {
        // Netpbm: os navegadores não abrem, então o arquivo é lido aqui.
        f.arrayBuffer().then((buf) => {
            try { useImage(parseNetpbm(new Uint8Array(buf))); } catch (err) { fail(t('app.readError', { name: f.name, msg: t(err.message) })); }
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
    img.onerror = () => { URL.revokeObjectURL(img.src); fail(t('app.notImage', { name: f.name })); };
    img.src = URL.createObjectURL(f);
    e.target.value = '';
};

// Abas e controles ------------------------------------------------------------------------------------------

function showTab(name) {
    if (!$(`pane-${name}`)) name = 'struct';
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

// Link para compartilhar ------------------------------------------------------------------------------------

/**
 * Controles guardados no link, na ordem em que são restaurados (a largura e o tipo antes dos que dependem
 * deles). O estado vai no fragmento do endereço (#kind=mul&width=8&...), legível e sem ir ao servidor.
 */
const SHARE_IDS = [...LAYERS.map((l) => `nnL-${l}`), 'kind', 'width', 'mulMethod', 'kTrunc', 'kApprox', 'approxCarry', 'kBlock', 'drumK', 'comp', 'adder', 'kAdd', 'segL', 'segP', 'dist',
    'histLog', 'cmpX', 'cmpY', 'cmpLog', 'filter', 'vosV', 'vosClock', 'vosModel', 'memBer', 'memProt', 'scOp', 'scGen', 'scN', 'scX', 'scY', 'scBer', 'synthTarget', 'nnAdder'];
const DEFAULTS = new Map(SHARE_IDS.map((id) => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value]));
const ctrlValue = (id) => ($(id).type === 'checkbox' ? $(id).checked : $(id).value);

function shareUrl() {
    const p = new URLSearchParams();
    const mul = $('kind').value === 'mul';
    for (const id of SHARE_IDS) {
        // Só o que difere do padrão, e só os controles do tipo de unidade escolhido.
        if (mul && ['adder', 'kAdd', 'segL', 'segP'].includes(id)) continue;
        if (!mul && ['mulMethod', 'kTrunc', 'kApprox', 'approxCarry', 'kBlock', 'drumK', 'comp'].includes(id)) continue;
        const v = ctrlValue(id);
        if (id === 'kind' || id === 'width' || v !== DEFAULTS.get(id)) p.set(id, typeof v === 'boolean' ? (v ? '1' : '0') : v);
    }
    p.set('tab', tab);
    p.set('lang', getLanguage());
    return `${location.origin}${location.pathname}#${p.toString()}`;
}

/** Aplica o estado de um link. Valores fora das opções ou dos limites são ignorados. */
function applyShared(hash) {
    const p = new URLSearchParams(hash);
    if (!p.has('kind') && !p.has('tab')) return false;
    for (const id of SHARE_IDS) {
        if (!p.has(id)) continue;
        const el = $(id), v = p.get(id);
        if (el.type === 'checkbox') el.checked = v === '1';
        else if (el.tagName === 'SELECT') { if ([...el.options].some((o) => o.value === v)) el.value = v; }
        else if (Number.isFinite(+v)) el.value = v;   // o range limita sozinho ao min e max
        if (id === 'width' || id === 'mulMethod' || id === 'kind') syncControls();
    }
    if (p.has('tab')) tab = p.get('tab');
    return true;
}

function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1600);
}
$('shareLink').onclick = async () => {
    const url = shareUrl();
    history.replaceState(null, '', url);
    try {
        await navigator.clipboard.writeText(url);
        flash($('shareLink'), t('ui.linkCopied'));
    } catch {
        // Sem acesso à área de transferência (página fora de https, por exemplo): o link fica na barra de endereço.
        flash($('shareLink'), t('ui.linkInBar'));
    }
};

// Tema, ajuda e idioma --------------------------------------------------------------------------------------

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
document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-help]');
    if (a) { e.preventDefault(); help.open(a.dataset.help); }
});

const langSelect = $('lang-select');
langSelect.innerHTML = Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
function applyDomTranslations() {
    langSelect.value = getLanguage();
    document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'pt-BR';
    document.title = t('ui.docTitle');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('ui.description'));
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    fillNNAdders();
    help.render();
}
langSelect.addEventListener('change', () => {
    setLanguage(langSelect.value);
    applyDomTranslations();
    syncControls();
    if (cur) {
        renderEvalNote();
        renderSummary();
        for (const k of Object.keys(dirty)) dirty[k] = true;
        renderTab(tab);
    }
});

// Início -----------------------------------------------------------------------------------------------------

/** Estado vindo do endereço: na abertura e quando um link é colado na mesma aba (só o fragmento muda). */
function fromHash() {
    if (location.hash.length <= 1) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.has('lang')) setLanguage(p.get('lang'), { persist: false });
    return applyShared(location.hash.slice(1));
}
window.addEventListener('hashchange', () => {
    if (!fromHash()) return;
    applyDomTranslations();
    evaluateCurrent();
    showTab(tab);
});
fromHash();
applyDomTranslations();
syncControls();
evaluateCurrent();
showTab(tab);
fetch('data/synth.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    synth = d;
    if (cur) { renderSummary(); dirty.cmp = true; dirty.synth = true; renderTab(tab); }
});
