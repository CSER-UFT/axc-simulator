/**
 * Página da rede neural: a LeNet-5 quantizada em 8 bits (MNIST, 1000 imagens de teste) com um multiplicador e um
 * somador da biblioteca nas camadas escolhidas. A unidade da página de unidades chega pelo endereço
 * (lenet.html#cfg=...), e aparece como a primeira opção.
 */
import { buildUnit, unitName } from './axc/units.js';
import { testInputs, errorMetrics } from './axc/metrics.js';
import { LAYERS, decodeModel, decodeTestSet, productTable, classifyRange, classifyBatch, adderAccumulate, summarize, macsPerLayer } from './axc/lenet.js';
import { esc } from './ui/plots.js';
import { Help } from './ui/help.js';
import { initFigureExport } from './ui/figexport.js';
import { LANGUAGES, getLanguage, setLanguage, t, locale, dec } from './i18n/index.js';

const $ = (id) => document.getElementById(id);
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* só nesta visita */ } },
};
const nf = (v, d = 2) => (Number.isInteger(v) ? v.toLocaleString(locale()) : v.toLocaleString(locale(), { maximumFractionDigits: d }));
const pct = (v) => (v > 0 && v < 1e-4 ? `${dec((100 * v).toExponential(1))}%` : `${(100 * v).toLocaleString(locale(), { maximumFractionDigits: 2 })}%`);
const dn = (name) => (getLanguage() === 'en' ? name.replace(/ exato$/, ' exact') : name);

let synth = null;           // data/synth.json: as unidades da biblioteca
let fromUnits = null;       // configuração vinda da página de unidades
let nnData = null, nnLoading = null, nnRun = 0;
const nnCache = new Map(), tableCache = new Map(), unitCache = new Map();

// Unidade vinda da página de unidades (#cfg=...) e somador (#add=nome).
const hash = new URLSearchParams(location.hash.slice(1));
try { if (hash.get('cfg')) { const c = JSON.parse(hash.get('cfg')); if (c.kind === 'mul') fromUnits = c; } } catch { fromUnits = null; }

$('nnLayers').innerHTML = LAYERS.map((l) => `<label class="check"><input type="checkbox" id="nnL-${l}" checked /> ${l}</label>`).join('');
const nnMask = () => LAYERS.map((l) => $(`nnL-${l}`).checked);

const designsOf = (kind) => (synth?.designs ?? []).filter((d) => d.cfg.kind === kind && !/ exato$/.test(d.name));
/** Opções dos dois seletores: exato, a unidade da página de unidades e as da biblioteca, por largura. */
function fillSelects() {
    const keep = (id, def) => { const v = $(id).value || store.get(`nn.${id}`) || def; return v; };
    const mulV = keep('nnMul', fromUnits ? 'units' : 'exact'), addV = hash.get('add') ?? keep('nnAdder', 'exact');
    const group = (kind, W) => {
        const ds = designsOf(kind).filter((d) => d.cfg.width === W);
        return ds.length ? `<optgroup label="${kind === 'mul' ? 'MUL' : 'ADD'}${W}">${ds.map((d) => `<option value="${esc(d.name)}">${esc(dn(d.name))}</option>`).join('')}</optgroup>` : '';
    };
    $('nnMul').innerHTML = (fromUnits ? `<option value="units">${esc(t('nn.fromUnits', { name: dn(unitName(fromUnits)) }))}</option>` : '')
        + `<option value="exact">${t('nn.mulExact')}</option>${group('mul', 8)}${group('mul', 16)}`;
    $('nnAdder').innerHTML = `<option value="exact">${t('nn.adderExact')}</option>${group('add', 8)}${group('add', 16)}`;
    const set = (id, v) => { $(id).value = [...$(id).options].some((o) => o.value === v) ? v : 'exact'; };
    set('nnMul', mulV);
    set('nnAdder', addV);
}

function unitOf(cfg) {
    const key = JSON.stringify(cfg);
    if (!unitCache.has(key)) unitCache.set(key, buildUnit(cfg));
    return unitCache.get(key);
}
/** Multiplicador e somador escolhidos (null = exato). */
function nnUnits() {
    const mv = $('nnMul').value, av = $('nnAdder').value;
    const cfgOf = (v) => (v === 'units' ? fromUnits : v === 'exact' ? null : synth.designs.find((d) => d.name === v)?.cfg ?? null);
    const mc = cfgOf(mv), ac = cfgOf(av);
    let add = ac ? unitOf(ac) : null;
    if (add && add.cfg.adder === 'exact') add = null;
    return { mul: mc ? unitOf(mc) : null, add, mulName: mv, addName: av };
}

function tableOf(unit) {
    const key = unit ? unitName(unit.cfg) : 'exata';
    if (!tableCache.has(key)) tableCache.set(key, productTable(unit));
    return tableCache.get(key);
}
const nnKey = (mul, add, mask) => `${mul ? unitName(mul.cfg) : 'exata'}|${add ? unitName(add.cfg) : 'exato'}|${mask.join('')}`;
function nnSetup(mask) {
    const { mul, add } = nnUnits();
    const Tu = tableOf(mul), Tx = tableOf(null);
    const accum = add ? adderAccumulate(add) : null;
    return { mul, add, tables: mask.map((m) => (m ? Tu : Tx)), adds: mask.map((m) => (m ? accum : null)), key: nnKey(mul, add, mask) };
}

function loadNN() {
    nnLoading ??= Promise.all([
        fetch('data/lenet5.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
        fetch('data/mnist1000.bin').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))),
    ]).then(([json, bin]) => {
        const model = decodeModel(json);
        nnData = { model, test: decodeTestSet(bin, model.subset.n) };
        return nnData;
    });
    return nnLoading;
}

/** Classifica em lotes, sem travar a página; uma execução nova cancela as antigas. */
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

/** Erro e custo das unidades escolhidas: da biblioteca sintetizada, ou medidos aqui (unidade da página de unidades). */
function unitInfo(unit, name) {
    if (!unit) return null;
    const d = synth.designs.find((x) => x.name === name || x.name === unitName(unit.cfg));
    const err = d?.err ?? errorMetrics(unit, testInputs(unit.cfg.width, 'uniform', undefined, undefined, unit.cfg.kind));
    return { name: dn(unitName(unit.cfg)), MRED: err.MRED, NMED: err.NMED, luts: d?.luts ?? null, area: d?.asic?.flows?.delay?.area ?? null };
}
function renderUnitInfo() {
    const { mul, add, mulName, addName } = nnUnits();
    const rows = [unitInfo(mul, mulName), unitInfo(add, addName)].filter(Boolean);
    $('nnUnitInfo').innerHTML = rows.length ? `<table class="kv" style="margin-top:6px"><tr><th></th><td class="note">MRED</td><td class="note">NMED</td><td class="note">LUT</td><td class="note">µm²</td></tr>`
        + rows.map((r) => `<tr><th class="mono">${esc(r.name)}</th><td class="mono">${pct(r.MRED)}</td><td class="mono">${pct(r.NMED)}</td><td class="mono">${r.luts ?? '-'}</td><td class="mono">${r.area === null ? '-' : nf(r.area, 0)}</td></tr>`).join('')
        + `</table><p class="note">${t('nn.unitInfoNote')}</p>` : '';
}

function drawDigit(canvas, img) {
    canvas.width = 28; canvas.height = 28;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(28, 28);
    for (let k = 0; k < 784; k++) { const v = 255 - img[k]; id.data.set([v, v, v, 255], 4 * k); }
    ctx.putImageData(id, 0, 0);
}

async function render() {
    if (!synth) return;
    renderUnitInfo();
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
    let preds, refUnitPreds = null, refUnit = null;
    try {
        preds = await classifyAsync(setup.tables, setup.adds, setup.key, progress);
        // Booth de 8 bits: a unidade recebe a >> 1; a referência da técnica (Booth exato) também perde o bit baixo.
        if (setup.mul?.signed && setup.mul.cfg.width === 8) {
            refUnit = unitOf({ kind: 'mul', width: 8, method: 'booth' });
            const T = tableOf(refUnit);
            refUnitPreds = await classifyAsync(mask.map((m) => (m ? T : tableOf(null))), Array(LAYERS.length).fill(null), nnKey(refUnit, null, mask), progress);
        }
    } catch { return; }
    $('nnStatus').textContent = '';
    const ref = model.expected;
    const sx = summarize(test, ref), su = summarize(test, preds, ref);
    const macs = macsPerLayer(model), total = macs.reduce((a, b) => a + b, 0);
    const approxMacs = macs.reduce((a, m, i) => a + (mask[i] ? m : 0), 0);
    const label = `${setup.mul ? dn(unitName(setup.mul.cfg)) : t('nn.mulExact')} + ${setup.add ? dn(unitName(setup.add.cfg)) : t('nn.addExact')}`;
    let h = '<table class="kv">';
    h += `<tr><th>${t('nn.accExact')}</th><td class="mono">${pct(sx.accuracy)}</td></tr>`;
    if (refUnitPreds) h += `<tr><th>${t('nn.accRefUnit', { name: dn(unitName(refUnit.cfg)) })}</th><td class="mono">${pct(summarize(test, refUnitPreds).accuracy)}</td></tr>`;
    h += `<tr><th><b>${esc(t('nn.accUnit', { name: label }))}</b></th><td class="mono"><b>${pct(su.accuracy)}</b> (${su.accuracy >= sx.accuracy ? '+' : '−'}${nf(Math.abs(su.accuracy - sx.accuracy) * 100, 1)} ${t('nn.pp')})</td></tr>`;
    h += `<tr><th>${t('nn.changed')}</th><td class="mono">${t('nn.changedV', { broke: su.broke.length, fixed: su.fixed })}</td></tr>`;
    h += `<tr><th>${t('nn.approxMacs')}</th><td class="mono">${nf(approxMacs)} ${t('nn.of')} ${nf(total)} (${pct(approxMacs / total)})</td></tr>`;
    h += '</table>';
    $('nnTable').innerHTML = h;
    $('nnNote').innerHTML = t('nn.note', { float: pct(model.accuracy.float), int8: pct(model.accuracy.int8) }) + (refUnitPreds ? ` ${t('nn.booth8')}` : '') + (setup.add ? ` ${t('nn.adderNote', { n: setup.add.cfg.width })}` : '');
    let c = `<table class="conf"><tr><th></th>${Array.from({ length: 10 }, (_, k) => `<th>${k}</th>`).join('')}</tr>`;
    su.conf.forEach((row, y) => {
        const n = row.reduce((a, b) => a + b, 0) || 1;
        c += `<tr><th>${y}</th>${row.map((v, p) => `<td class="${p === y ? 'diag' : v ? 'off' : ''}" style="--v:${p === y ? (0.15 + 0.6 * v / n).toFixed(2) : Math.min(1, 0.25 + v / 20).toFixed(2)}">${v || ''}</td>`).join('')}</tr>`;
    });
    $('nnConf').innerHTML = `${c}</table>`;
    const shown = su.broke.slice(0, 60);
    $('nnBroke').innerHTML = shown.length ? shown.map((k) => `<figure><canvas data-k="${k}"></canvas><figcaption>${test.labels[k]} → ${preds[k]}</figcaption></figure>`).join('')
        + (su.broke.length > shown.length ? `<p class="note">${t('nn.more', { n: su.broke.length - shown.length })}</p>` : '')
        : `<p class="note">${t('nn.noneBroke')}</p>`;
    for (const cv of $('nnBroke').querySelectorAll('canvas')) drawDigit(cv, test.images.subarray(+cv.dataset.k * 784, (+cv.dataset.k + 1) * 784));
}

for (const id of ['nnMul', 'nnAdder']) $(id).addEventListener('change', () => { store.set(`nn.${id}`, $(id).value); render(); });
$('nnLayers').addEventListener('change', () => render());
$('nnSensBtn').onclick = async () => {
    if (!nnData) return;
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
    $('nnSens').innerHTML = `<h3 style="margin-top:10px">${t('nn.sensTitle')}</h3><table class="kv"><tr><th></th><td class="note">${t('nn.sensMacs')}</td><td class="note">${t('nn.sensAcc')}</td></tr>${rows.join('')}</table><p class="note">${t('nn.sensNote')}</p>`;
};

// Idioma e tema ------------------------------------------------------------------------------------------------
const help = new Help($('readme'), null, { page: 'lenet' });
$('open-ajuda').addEventListener('click', () => (help.isOverlay() ? help.close() : help.open()));
document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-help]');
    if (a) { e.preventDefault(); help.open(a.dataset.help); }
});
initFigureExport(() => ({ title: t('fig.export'), svg: t('fig.svg'), png: t('fig.png') }));

const langSelect = $('lang-select');
langSelect.innerHTML = Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
function applyDomTranslations() {
    langSelect.value = getLanguage();
    document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'pt-BR';
    document.title = t('nn.docTitle');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    help.render();
    if (synth) { fillSelects(); render(); }
}
langSelect.addEventListener('change', () => { setLanguage(langSelect.value); applyDomTranslations(); });
const themeButton = $('theme-toggle');
const updateThemeIcon = () => { themeButton.querySelector('.icon').className = `icon ${document.documentElement.dataset.theme === 'dark' ? 'i-sun' : 'i-moon'}`; };
themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('axc.theme', next);
    updateThemeIcon();
});
updateThemeIcon();
applyDomTranslations();

fetch('data/synth.json').then((r) => r.json()).then((s) => { synth = s; fillSelects(); render(); })
    .catch(() => { $('nnStatus').textContent = t('nn.loadError'); });
