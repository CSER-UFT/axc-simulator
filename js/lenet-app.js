/**
 * Página da rede neural: redes quantizadas em 8 bits (formato axc-nn/1, data/nn/models.json) classificam o
 * subconjunto de teste da sua base com um multiplicador e um somador da biblioteca nas camadas escolhidas. A unidade
 * da página de unidades chega pelo endereço (lenet.html#cfg=...), e aparece como a primeira opção. O diagrama da
 * arquitetura sai da mesma descrição da rede.
 */
import { buildUnit, unitName } from './axc/units.js';
import { testInputs, errorMetrics } from './axc/metrics.js';
import { decodeNet, decodeTestSet, productTable, classifyRange, adderAccumulate, summarize, macsPerSite } from './axc/nn.js';
import { archSvg } from './axc/nnsvg.js';
import { networkCost, normalizeDirectives, directiveTrees, parOptions, CONV_PIPES, DENSE_PIPES } from './axc/nngen.js';
import { esc, accuracyCostSvg } from './ui/plots.js';
import { highlightC } from './hls/highlight.js';
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
let registry = null;        // data/nn/models.json
let nnData = null, nnRun = 0;
let nnDirs = null;
let nnOverride = null;        // unidades de cada camada aplicadas da busca ([{mul, add}] com os nomes da biblioteca)           // diretivas de cada camada com pesos (js/axc/nngen.js), guardadas por modelo
const modelCache = new Map(), testCache = new Map(), predCache = new Map(), tableCache = new Map(), unitCache = new Map();

// Unidade vinda da página de unidades (#cfg=...), somador (#add=nome) e modelo (#model=id).
const hash = new URLSearchParams(location.hash.slice(1));
try { if (hash.get('cfg')) { const c = JSON.parse(hash.get('cfg')); if (c.kind === 'mul') fromUnits = c; } } catch { fromUnits = null; }

const sites = () => nnData?.net.sites ?? [];
const nnMask = () => sites().map((l) => $(`nnL-${l.name}`)?.checked ?? true);
function fillLayers() {
    const prev = new Map(sites().map((l) => [l.name, $(`nnL-${l.name}`)?.checked ?? true]));
    $('nnLayers').innerHTML = sites().map((l) => `<label class="check"><input type="checkbox" id="nnL-${esc(l.name)}" ${prev.get(l.name) === false ? '' : 'checked'} /> ${esc(l.name)}</label>`).join('');
}

const designsOf = (kind) => (synth?.designs ?? []).filter((d) => d.cfg.kind === kind && !/ exato$/.test(d.name));
/** Opções dos seletores: exato, a unidade da página de unidades e as da biblioteca, por largura; e os modelos. */
function fillSelects() {
    const keep = (id, def) => { const v = $(id).value || store.get(`nn.${id}`) || def; return v; };
    const mulV = keep('nnMul', fromUnits ? 'units' : 'exact'), addV = hash.get('add') ?? keep('nnAdder', 'exact');
    const group = (kind, W) => {
        const ds = designsOf(kind).filter((d) => d.cfg.width === W);
        return ds.length ? `<optgroup label="${kind === 'mul' ? 'MUL' : 'ADD'}${W}">${ds.map((d) => `<option value="${esc(d.name)}">${esc(dn(d.name))}</option>`).join('')}</optgroup>` : '';
    };
    $('nnMul').innerHTML = (fromUnits ? `<option value="units">${esc(t('nn.fromUnits', { name: dn(unitName(fromUnits)) }))}</option>` : '')
        + `<option value="exact">${t('nn.mulExact')}</option>${group('mul', 8)}${group('mul', 16)}`;
    $('nnAdder').innerHTML = `<option value="exact">${t('nn.adderExact')}</option>${group('add', 8)}${group('add', 16)}${group('add', 24)}${group('add', 32)}`;
    $('nnAccum').value = ['chain', 'tree', 'arch'].includes(store.get('nn.nnAccum')) ? store.get('nn.nnAccum') : 'arch';
    const set = (id, v) => { $(id).value = [...$(id).options].some((o) => o.value === v) ? v : 'exact'; };
    set('nnMul', mulV);
    set('nnAdder', addV);
    if (registry) {
        const mv = $('nnModel').value || hash.get('model') || store.get('nn.nnModel') || registry.models[0].id;
        $('nnModel').innerHTML = registry.models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.dataset)})</option>`).join('');
        $('nnModel').value = registry.models.some((m) => m.id === mv) ? mv : registry.models[0].id;
    }
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
// Estrutura da soma nas camadas com o somador aproximado: em cadeia (1), numa árvore com todos os termos (0) ou a
// das diretivas de cada camada (js/axc/nngen.js, directiveTrees), a mesma do código gerado e do custo do hardware.
const accumMode = () => $('nnAccum').value;
const nnTrees = () => {
    const net = nnData.net;
    if (accumMode() === 'tree') return net.sites.map(() => 0);
    if (accumMode() === 'chain') return net.sites.map(() => 1);
    return directiveTrees(net, nnDirs);
};
const nnKey = (mul, add, mask) => `${nnData.net.id}|${mul ? unitName(mul.cfg) : 'exata'}|${add ? `${unitName(add.cfg)}|${nnTrees().join(',')}` : 'exato'}|${mask.join('')}`;
const unitByName = (name) => (name ? unitOf(synth.designs.find((d) => d.name === name).cfg) : null);
const accumCache = new Map();
const accumOf = (name) => { if (!accumCache.has(name)) accumCache.set(name, adderAccumulate(unitByName(name))); return accumCache.get(name); };
function nnSetup(mask) {
    if (nnOverride) {
        // Unidades por camada (da busca): a máscara e os seletores não valem.
        const tables = nnOverride.map((a) => tableOf(unitByName(a.mul)));
        const adds = nnOverride.map((a) => (a.add ? accumOf(a.add) : null));
        return { mul: null, add: null, override: true, tables, adds, trees: nnTrees(), key: `${nnData.net.id}|busca|${JSON.stringify(nnOverride)}|${nnTrees().join(',')}` };
    }
    const { mul, add } = nnUnits();
    const Tu = tableOf(mul), Tx = tableOf(null);
    const accum = add ? adderAccumulate(add) : null;
    return { mul, add, tables: mask.map((m) => (m ? Tu : Tx)), adds: mask.map((m) => (m ? accum : null)), trees: nnTrees(), key: nnKey(mul, add, mask) };
}

const getJson = (f) => fetch(f).then((r) => (r.ok ? r.json() : Promise.reject(new Error(f))));
const getBin = (f) => fetch(f).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(f))));
/** Rede escolhida e o conjunto de teste da sua base (os dois guardados). */
async function loadNN(id) {
    registry ??= await getJson('data/nn/models.json');
    const entry = registry.models.find((m) => m.id === id) ?? registry.models[0];
    if (!modelCache.has(entry.id)) modelCache.set(entry.id, getJson(entry.file).then(decodeNet));
    const net = await modelCache.get(entry.id);
    const ds = net.dataset;
    if (!testCache.has(ds.file)) testCache.set(ds.file, getBin(ds.file).then((b) => decodeTestSet(b, ds)));
    const changed = nnData?.net.id !== net.id;
    nnData = { net, test: await testCache.get(ds.file) };
    if (changed) { fillLayers(); renderArch(); nnDirs = loadDirs(net); fillDirs(); setOverride(null); $('nnSearchResult').innerHTML = ''; $('nnSearchStatus').textContent = ''; }
    return nnData;
}

/** Classifica em lotes, sem travar a página; uma execução nova cancela as antigas. */
function classifyAsync(tables, adds, key, onProgress, trees = []) {
    if (predCache.has(key)) return Promise.resolve(predCache.get(key));
    const { net, test } = nnData;
    const run = nnRun;
    const preds = new Uint8Array(test.n);
    const macs = macsPerSite(net).reduce((a, b) => a + b, 0);
    const approxAdd = adds.some((f) => f);
    // Lotes de uns 100 ms: o custo cresce com as multiplicações por imagem, e o somador aproximado custa mais.
    const chunk = Math.max(5, Math.round((approxAdd ? 2e7 : 6e7) / macs));
    return new Promise((resolve, reject) => {
        let k = 0;
        const step = () => {
            if (run !== nnRun) { reject(new Error('cancelada')); return; }
            const end = Math.min(test.n, k + chunk);
            classifyRange(net, test, tables, adds, k, end, preds, trees);
            k = end;
            onProgress?.(k, test.n);
            if (k < test.n) setTimeout(step, 0);
            else { predCache.set(key, preds); resolve(preds); }
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

/** Imagem de teste num canvas: tons de cinza (1 canal, tinta escura no fundo claro) ou cores (3 canais). */
function drawImage(canvas, img, shape) {
    const [C, H, W] = shape;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(W, H);
    for (let k = 0; k < H * W; k++) {
        const rgb = C === 3 ? [img[k], img[H * W + k], img[2 * H * W + k]] : [255 - img[k], 255 - img[k], 255 - img[k]];
        id.data.set([...rgb, 255], 4 * k);
    }
    ctx.putImageData(id, 0, 0);
}

/** Diagrama da arquitetura (SVG) e a descrição da rede. */
function renderArch() {
    if (!nnData) return;
    const { net } = nnData;
    $('nnArch').innerHTML = archSvg(net, { labels: { input: t('nn.archInput'), conv: t('nn.archConv'), pool: t('nn.archPool'), flatten: t('nn.archFlatten'), dense: t('nn.archDense') } });
}

function modelNote(net) {
    const macs = macsPerSite(net).reduce((a, b) => a + b, 0);
    const weights = net.sites.reduce((a, l) => a + l.w.length, 0);
    let h = t('nn.modelInfo', { name: net.name, dataset: net.dataset.name, n: net.dataset.n, weights: nf(weights), macs: nf(macs) });
    if (net.source?.script === 'scripts/nn/train.py') h += ` ${t('nn.noteTrained', { epochs: net.source.epochs, float: pct(net.accuracy.float), int8: pct(net.accuracy.int8Full) })}`;
    else if (net.id === 'minilenet-mnist') h += ` ${t('nn.noteMini')}`;
    return `${h} ${t('nn.noteUnits')}`;
}

async function render() {
    if (!synth) return;
    renderUnitInfo();
    const run = ++nnRun;
    $('nnSens').innerHTML = '';
    try {
        if (nnData?.net.id !== $('nnModel').value) { $('nnStatus').textContent = t('nn.loading'); await loadNN($('nnModel').value); }
    } catch (e) {
        $('nnStatus').textContent = t('nn.loadError', { file: e.message });
        return;
    }
    if (run !== nnRun) return;
    const { net, test } = nnData;
    const mask = nnMask();
    const setup = nnSetup(mask);
    const progress = (k, n) => { $('nnStatus').textContent = t('nn.progress', { k, n }); };
    let preds, refUnitPreds = null, refUnit = null;
    try {
        preds = await classifyAsync(setup.tables, setup.adds, setup.key, progress, setup.trees);
        // Booth de 8 bits: a unidade recebe a >> 1; a referência da técnica (Booth exato) também perde o bit baixo.
        if (setup.mul?.signed && setup.mul.cfg.width === 8) {
            refUnit = unitOf({ kind: 'mul', width: 8, method: 'booth' });
            const T = tableOf(refUnit);
            refUnitPreds = await classifyAsync(mask.map((m) => (m ? T : tableOf(null))), mask.map(() => null), nnKey(refUnit, null, mask), progress);
        }
    } catch { return; }
    $('nnStatus').textContent = '';
    const classes = net.classes;
    const ref = net.expected;
    const sx = summarize(test, ref, null, classes), su = summarize(test, preds, ref, classes);
    const macs = macsPerSite(net), total = macs.reduce((a, b) => a + b, 0);
    const approxOn = setup.override ? nnOverride.map((a) => !!(a.mul || a.add)) : mask;
    const approxMacs = macs.reduce((a, m, i) => a + (approxOn[i] ? m : 0), 0);
    const label = setup.override ? t('nn.searchLabel') : `${setup.mul ? dn(unitName(setup.mul.cfg)) : t('nn.mulExact')} + ${setup.add ? dn(unitName(setup.add.cfg)) : t('nn.addExact')}`;
    // Cartões, como o resumo da página de síntese de alto nível.
    const card = (k, v, u = '') => `<div class="metric"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="u">${esc(u)}</div></div>`;
    const diff = `${su.accuracy >= sx.accuracy ? '+' : '−'}${nf(Math.abs(su.accuracy - sx.accuracy) * 100, 1)} ${t('nn.pp')}`;
    $('nnTable').innerHTML = `<div class="metrics-grid">${[
        card(t('nn.accExact'), pct(sx.accuracy), `${nf(test.n)} ${t('nn.images')}`),
        refUnitPreds ? card(t('nn.accRefUnit', { name: dn(unitName(refUnit.cfg)) }), pct(summarize(test, refUnitPreds, null, classes).accuracy)) : '',
        card(t('nn.accUnit', { name: label }), pct(su.accuracy), diff),
        card(t('nn.changed'), `${su.broke.length} / ${su.fixed}`, t('nn.changedU')),
        card(t('nn.approxMacsShort'), pct(approxMacs / total), `${nf(approxMacs)} ${t('nn.of')} ${nf(total)}`),
    ].join('')}</div>`;
    $('nnNote').innerHTML = modelNote(net) + (refUnitPreds ? ` ${t('nn.booth8')}` : '') + (setup.override ? ` ${t('nn.accumArchNote')}` : '') + (setup.add ? ` ${t(setup.add.cfg.width >= 32 ? 'nn.adderNote32' : 'nn.adderNote', { n: setup.add.cfg.width })} ${t({ tree: 'nn.accumTreeNote', chain: 'nn.accumChainNote', arch: 'nn.accumArchNote' }[accumMode()])}` : '');
    // Nomes curtos (dígitos) vão direto na matriz; nomes longos viram índices, com a legenda embaixo.
    const names = net.dataset.classes ?? Array.from({ length: classes }, (_, k) => String(k));
    const short = names.every((n) => n.length <= 2) ? names : names.map((_, k) => String(k));
    let c = `<table class="conf"><tr><th></th>${short.map((k, i) => `<th title="${esc(names[i])}">${esc(k)}</th>`).join('')}</tr>`;
    su.conf.forEach((row, y) => {
        const n = row.reduce((a, b) => a + b, 0) || 1;
        c += `<tr><th title="${esc(names[y])}">${esc(short[y])}</th>${row.map((v, p) => `<td class="${p === y ? 'diag' : v ? 'off' : ''}" style="--v:${p === y ? (0.15 + 0.6 * v / n).toFixed(2) : Math.min(1, 0.25 + v / 20).toFixed(2)}">${v || ''}</td>`).join('')}</tr>`;
    });
    const legend = short === names ? '' : `<p class="note">${names.map((n, k) => `${k} ${esc(n)}`).join(', ')}</p>`;
    $('nnConf').innerHTML = `${c}</table>${legend}`;
    const shown = su.broke.slice(0, 60);
    $('nnBroke').innerHTML = shown.length ? shown.map((k) => `<figure title="${esc(names[test.labels[k]])} → ${esc(names[preds[k]])}"><canvas data-k="${k}"></canvas><figcaption>${esc(short[test.labels[k]])} → ${esc(short[preds[k]])}</figcaption></figure>`).join('')
        + (su.broke.length > shown.length ? `<p class="note">${t('nn.more', { n: su.broke.length - shown.length })}</p>` : '')
        : `<p class="note">${t('nn.noneBroke')}</p>`;
    for (const cv of $('nnBroke').querySelectorAll('canvas')) drawImage(cv, test.images.subarray(+cv.dataset.k * test.size, (+cv.dataset.k + 1) * test.size), test.shape);
    renderCost();
}

// Abas (como na página de síntese de alto nível) ------------------------------------------------------------------
let tab = ['result', 'cost', 'code', 'search', 'arch'].includes(store.get('nn.tab')) ? store.get('nn.tab') : 'result';
function setTab(t2) {
    tab = t2;
    store.set('nn.tab', tab);
    for (const b of $('nnTabs').querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
    for (const p of document.querySelectorAll('.nn-main .pane')) p.classList.toggle('hidden', p.id !== `pane-${tab}`);
}
$('nnTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
setTab(tab);

// Diretivas por camada -------------------------------------------------------------------------------------------
function loadDirs(net) {
    try { return normalizeDirectives(net, JSON.parse(store.get(`nn.dirs.${net.id}`) ?? 'null')); } catch { return normalizeDirectives(net, null); }
}
/** Tabela das diretivas: pipeline, II pedido, paralelismo e partição de cada camada com pesos. */
let fillingDirs = false;
function fillDirs() {
    const net = nnData.net;
    fillingDirs = true;
    const opt = (v, label, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    let h = `<table class="kv"><tr><th></th><td class="note">${t('nn.dirPipe')}</td><td class="note">II</td><td class="note">${t('nn.dirPar')}</td><td class="note">${t('nn.dirPart')}</td></tr>`;
    net.sites.forEach((l, i) => {
        const d = nnDirs[i], conv = l.type === 'conv';
        const pipes = conv ? CONV_PIPES : DENSE_PIPES;
        const pars = conv && d.pipe !== 'pixel' ? [1] : parOptions(l);
        h += `<tr data-i="${i}"><th class="mono">${esc(l.name)}</th>`
            + `<td><select data-k="pipe">${pipes.map((p) => opt(p, t(`nn.pipe.${p}`), d.pipe)).join('')}</select></td>`
            + `<td><input type="number" data-k="ii" min="1" max="256" step="1" value="${d.ii}" style="width:4em"${d.pipe === 'off' ? ' disabled' : ''} /></td>`
            + `<td><select data-k="par" title="${esc(t(conv ? 'nn.dirParConv' : 'nn.dirParDense'))}"${pars.length < 2 ? ' disabled' : ''}>${pars.map((p) => opt(p, String(p), d.par)).join('')}</select></td>`
            + `<td><input type="checkbox" data-k="part"${d.part ? ' checked' : ''}${d.pipe === 'off' ? ' disabled' : ''} /></td></tr>`;
    });
    $('nnDirs').innerHTML = `${h}</table>`;
    fillingDirs = false;
}
function readDirs() {
    return [...$('nnDirs').querySelectorAll('tr[data-i]')].map((tr) => {
        const v = (k) => tr.querySelector(`[data-k="${k}"]`);
        return { pipe: v('pipe').value, ii: +v('ii').value, par: +v('par').value, part: v('part').checked };
    });
}
function dirsChanged(dirs) {
    nnDirs = normalizeDirectives(nnData.net, dirs);
    store.set(`nn.dirs.${nnData.net.id}`, JSON.stringify(nnDirs));
    fillDirs();
    // Com o somador aproximado, a estrutura da soma das diretivas muda a acurácia.
    render();
}
// O campo do II dispara change ao perder o foco, inclusive quando a tabela é refeita: esse é ignorado.
$('nnDirs').addEventListener('change', () => { if (!fillingDirs) setTimeout(() => dirsChanged(readDirs()), 0); });
$('nnDirReset').onclick = () => { if (nnData) dirsChanged(null); };

/** Código gerado de uma camada (o mesmo que o custo avalia; pode ser colado na página de síntese de alto nível). */
let lastKernels = [];
function renderCode() {
    const sel = $('nnCodeLayer'), cur = sel.value;
    sel.innerHTML = lastKernels.map((k) => `<option value="${esc(k.name)}">${esc(k.name)}</option>`).join('');
    sel.value = lastKernels.some((k) => k.name === cur) ? cur : (lastKernels.find((k) => k.site !== null)?.name ?? '');
    const k = lastKernels.find((x) => x.name === sel.value);
    // Os pesos ficam numa linha só, que pode ser longa: o código vai como está.
    $('nnCode').innerHTML = k ? highlightC(k.src) : '';
}
$('nnCodeLayer').addEventListener('change', renderCode);

const whyText = (w) => {
    if (!w || w.kind === 'target') return '';
    if (w.kind === 'mem') return t('hls.why.mem', { arr: w.label ?? w.key, uses: w.uses, cap: w.cap });
    if (w.kind === 'unit') return t('hls.why.unit', { key: w.key, uses: w.uses, cap: w.cap });
    if (w.kind === 'rec') return t('hls.why.rec', { v: w.key, c: w.cycles });
    return t('hls.why.schedule');
};

// Custo do hardware ---------------------------------------------------------------------------------------------
let hlsData = null, costRun = 0;
const costCache = new Map();
const loadHls = () => (hlsData ??= Promise.all([getJson('data/hls-cells.json'), getJson('data/vivado-units.json').catch(() => null)]).then(([cells, fpga]) => ({ cells, fpga })));
/** Custo da configuração e o da rede exata, por camada, pelo modelo de síntese de alto nível (depois da acurácia). */
async function renderCost() {
    if (!nnData || !synth) return;
    const run = ++costRun;
    const { net } = nnData;
    const { mul, add, mulName } = nnUnits();
    const inLib = (u, v) => !u || v !== 'units' || synth.designs.some((d) => d.name === unitName(u.cfg));
    $('nnCostNote').innerHTML = '';
    if (!inLib(mul, mulName)) { $('nnCost').innerHTML = `<p class="note">${t('nn.costNoUnit')}</p>`; return; }
    $('nnCost').innerHTML = `<p class="note">${t('nn.costRunning')}</p>`;
    let hd;
    try { hd = await loadHls(); } catch (e) { $('nnCost').innerHTML = `<p class="note">${t('nn.loadError', { file: 'data/hls-cells.json' })}</p>`; return; }
    await new Promise((r) => setTimeout(r, 0));
    if (run !== costRun) return;
    const o = { synth, cells: hd.cells, fpga: hd.fpga, target: $('nnTarget').value, clockNs: +$('nnClock').value || 10 };
    const mask = nnMask();
    const cost = (m, a, k, units = null) => {
        const key = `${net.id}|${o.target}|${o.clockNs}|${m ?? '-'}|${a ?? '-'}|${k.join('')}|${JSON.stringify(nnDirs)}|${JSON.stringify(units)}`;
        if (!costCache.has(key)) {
            if (costCache.size > 200) costCache.delete(costCache.keys().next().value);
            costCache.set(key, networkCost(net, { ...o, mul: m, add: a, mask: k, dirs: nnDirs, ...(units ? { units } : {}) }));
        }
        return costCache.get(key);
    };
    let ex, c;
    try {
        ex = cost(null, null, mask);
        c = nnOverride ? cost(null, null, mask, nnOverride) : cost(mul ? unitName(mul.cfg) : null, add ? unitName(add.cfg) : null, mask);
    } catch (e) { $('nnCost').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    if (run !== costRun) return;
    const d = (a, b) => (b ? `${a <= b ? '−' : '+'}${nf(Math.abs(100 * (1 - a / b)), 1)}%` : '');
    const asic = o.target === 'asic';
    let h = `<table class="hls-table"><tr><th></th><th>${t('nn.costCycles')}</th><th>II</th><th>${asic ? 'µm²' : 'LUT'}</th><th>FF</th><th>DSP</th><th>nJ</th><th class="left">${t('nn.costUnits')}</th></tr>`;
    for (const l of c.layers) {
        const e = ex.layers.find((x) => x.name === l.name);
        const main = asic ? l.area : l.luts, mainEx = asic ? e.area : e.luts;
        const us = l.units.filter((u) => !/ exato$/.test(u.name) || l.site !== null).map((u) => `${u.count} × ${esc(dn(u.name))}`).join(', ');
        h += `<tr><td class="mono">${esc(l.name)}${l.approx ? ' *' : ''}</td><td class="mono">${nf(l.cycles)}</td><td class="mono"${whyText(l.IIwhy) ? ` title="${esc(whyText(l.IIwhy))}"` : ''}>${l.II ?? '-'}${whyText(l.IIwhy) ? '<sup>†</sup>' : ''}</td><td class="mono">${nf(main, 0)}${main !== mainEx ? ` <span class="note">(${d(main, mainEx)})</span>` : ''}</td><td class="mono">${nf(l.ff)}</td><td class="mono">${l.dsp}</td><td class="mono">${nf(l.energy / 1e6, 2)}</td><td class="units">${us}</td></tr>`;
    }
    const T = c.totals, X = ex.totals, main = asic ? T.area : T.luts, mainEx = asic ? X.area : X.luts;
    h += `<tr class="best"><td>${t('nn.costTotal')}</td><td class="mono">${nf(T.cycles)}</td><td></td><td class="mono">${nf(main, 0)} (${d(main, mainEx)})</td><td class="mono">${nf(T.ff)}</td><td class="mono">${T.dsp}</td><td class="mono">${nf(T.energy / 1e6, 1)} (${d(T.energy, X.energy)})</td><td class="units">${T.requantShared ? esc(t('nn.costShared')) : ''}</td></tr></table>`;
    $('nnCost').innerHTML = h;
    const card = (k, v, u = '') => `<div class="metric"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="u">${esc(u)}</div></div>`;
    $('nnCostSummary').innerHTML = `<div class="metrics-grid">${[
        card(t('nn.m.cycles'), nf(T.cycles), t('nn.m.cyclesU', { ns: nf(o.clockNs, 1) })),
        card(t('nn.m.time'), nf(T.timeUs, 1), 'µs'),
        asic ? card(t('nn.m.area'), nf(T.area, 0), `µm² (sky130) ${mainEx !== main ? d(main, mainEx) : ''}`) : card(t('nn.m.luts'), nf(T.luts), `LUT, ${nf(T.carry4)} CARRY4 ${mainEx !== main ? d(main, mainEx) : ''}`),
        card('FF', nf(T.ff), t('nn.m.ffU')),
        card('DSP48', nf(T.dsp), t('nn.m.dspU')),
        card(t('nn.m.energy'), nf(T.energy / 1e6, 1), `nJ ${T.energy !== X.energy ? d(T.energy, X.energy) : ''}`),
    ].join('')}</div>`;
    lastKernels = c.layers.map((l) => ({ name: l.name, site: l.site, src: l.src }));
    renderCode();
    const limited = c.layers.filter((l) => whyText(l.IIwhy)).map((l) => `${esc(l.name)} (${esc(whyText(l.IIwhy))})`);
    $('nnCostNote').innerHTML = (limited.length ? `${t('nn.whyNote', { list: limited.join('; ') })} ` : '') + t('nn.costNote', { us: nf(T.timeUs, 1), clock: nf(o.clockNs, 1) }) + (c.warnings.length ? ` ${esc(c.warnings.join('; '))}` : '');
}
for (const id of ['nnClock', 'nnTarget']) $(id).addEventListener('change', () => renderCost());

for (const id of ['nnMul', 'nnAdder', 'nnModel', 'nnAccum']) $(id).addEventListener('change', () => { store.set(`nn.${id}`, $(id).value); if (id !== 'nnAccum') setOverride(null); render(); });
$('nnLayers').addEventListener('change', () => { setOverride(null); render(); });

// Exportação para o Vitis HLS e o Vivado ---------------------------------------------------------------------------
/** Unidades de cada camada com pesos na configuração da página (as da busca aplicada, ou os seletores e a máscara). */
function pageUnits() {
    if (nnOverride) return nnOverride.map((a) => ({ ...a }));
    const { mul, add } = nnUnits(), mask = nnMask();
    const m = mul ? unitName(mul.cfg) : null, a = add ? unitName(add.cfg) : null;
    return sites().map((_, i) => (mask[i] ? { mul: m, add: a } : { mul: null, add: null }));
}
let exportWorker = null;
$('nnExportBtn').onclick = () => {
    if (!nnData || !registry || exportWorker) return;
    const net = nnData.net, entry = registry.models.find((m) => m.id === net.id);
    const units = pageUnits();
    const inLib = (n) => !n || synth.designs.some((d) => d.name === n);
    if (!units.every((u) => inLib(u.mul) && inLib(u.add))) { $('nnExportStatus').textContent = t('nn.costNoUnit'); return; }
    const clockNs = +$('nnClock').value || 10;
    const id = `${net.id}_${units.some((u) => u.mul || u.add) ? 'aprox' : 'exata'}_${String(clockNs).replace('.', 'p')}ns`;
    $('nnExportBtn').disabled = true;
    $('nnExportStatus').textContent = t('nn.searchLoading');
    exportWorker = new Worker(new URL('./nn-export-worker.js', import.meta.url), { type: 'module' });
    const done = (msg) => { exportWorker?.terminate(); exportWorker = null; $('nnExportBtn').disabled = false; $('nnExportStatus').textContent = msg; };
    exportWorker.onmessage = ({ data: m }) => {
        if (m.type === 'status') $('nnExportStatus').textContent = t(m.key);
        else if (m.type === 'progress') $('nnExportStatus').textContent = t('nn.exportProgress', { k: m.k, n: m.n });
        else if (m.type === 'error') done(m.message);
        else if (m.type === 'done') {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob([m.zip], { type: 'application/zip' }));
            link.download = `${id}.zip`;
            document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(link.href), 2000);
            done(t('nn.exportDone', { files: m.files, id, acc: pct(m.summary.accuracySim), n: m.summary.images }) + (m.summary.partitionNotes.length ? ` ${t('nn.exportWarn', { list: m.summary.partitionNotes.join('; ') })}` : '') + (m.summary.warnings.length ? ` ${m.summary.warnings.join('; ')}` : ''));
        }
    };
    exportWorker.onerror = (e) => done(e.message || t('nn.searchError'));
    exportWorker.postMessage({ file: entry.file, clockNs, dirs: nnDirs, units, images: Math.max(1, Math.min(1000, +$('nnExportImages').value || 50)), id, layers: $('nnExportLayers').checked });
};

// Busca das unidades por camada ------------------------------------------------------------------------------------
/** Unidades por camada aplicadas da busca (null: as dos seletores). */
function setOverride(assign) {
    nnOverride = assign ? assign.map((a) => ({ mul: a.mul ?? null, add: a.add ?? null })) : null;
    if (!nnOverride) { $('nnOverride').innerHTML = ''; return; }
    const rows = nnData.net.sites.map((l, i) => `<tr><th class="mono">${esc(l.name)}</th><td class="mono">${esc(dn(nnOverride[i].mul ?? 'MUL8 exato'))}</td><td class="mono">${esc(dn(nnOverride[i].add ?? 'ADD32 exato'))}</td></tr>`).join('');
    $('nnOverride').innerHTML = `<div class="scroll-box" style="padding:8px;margin:8px 0"><p class="note"><b>${t('nn.searchApplied')}</b></p><table class="kv">${rows}</table>`
        + `<button type="button" class="btn outline" id="nnOverrideOff">${t('nn.searchUnapply')}</button></div>`;
    $('nnOverrideOff').onclick = () => { setOverride(null); render(); };
}

let searchWorker = null, lastSearch = null;
const searchWorkers = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
function stopSearch(msg = '') {
    if (searchWorker) { searchWorker.terminate(); searchWorker = null; }
    $('nnSearchBtn').disabled = false;
    $('nnSearchStop').disabled = true;
    if (msg) $('nnSearchStatus').textContent = msg;
}
$('nnSearchStop').onclick = () => stopSearch(t('nn.searchStopped'));
$('nnSearchBtn').onclick = () => {
    if (!nnData || !registry) return;
    stopSearch();
    const net = nnData.net, entry = registry.models.find((m) => m.id === net.id);
    if (!net.dataset.val) { $('nnSearchStatus').textContent = t('nn.searchNoVal'); return; }
    const o = {
        file: entry.file, objective: $('nnSearchObj').value, maxDrop: Math.max(0, +$('nnSearchDrop').value || 0), heuristic: $('nnSearchHeur').value,
        dirs: nnDirs, trees: directiveTrees(net, nnDirs), clockNs: +$('nnClock').value || 10, workers: searchWorkers(),
    };
    $('nnSearchBtn').disabled = true;
    $('nnSearchStop').disabled = false;
    $('nnSearchResult').innerHTML = '';
    const t0 = Date.now();
    searchWorker = new Worker(new URL('./nn-search-worker.js', import.meta.url), { type: 'module' });
    searchWorker.onmessage = ({ data: m }) => {
        if (m.type === 'status') $('nnSearchStatus').textContent = t(m.key);
        else if (m.type === 'progress') {
            $('nnSearchStatus').textContent = t('nn.searchProgress', { phase: m.phase === 'sens' ? t('nn.searchPhaseSens') : m.phase === 'comb' ? t('nn.searchPhaseComb') : m.phase, evals: m.evals, s: nf((Date.now() - t0) / 1000, 0), cost: nf(100 * m.cost, 1) });
        } else if (m.type === 'error') stopSearch(m.message);
        else if (m.type === 'done') {
            stopSearch(t('nn.searchDone', { evals: m.result.evals, images: nf(m.result.images), s: nf(m.result.ms / 1000, 1), workers: m.result.workers }));
            lastSearch = { ...m.result, net: net.id, o };
            renderSearch();
        }
    };
    searchWorker.onerror = (e) => stopSearch(e.message || t('nn.searchError'));
    searchWorker.postMessage(o);
};

function renderSearch() {
    const r = lastSearch;
    if (!r || !nnData || r.net !== nnData.net.id) return;
    const net = nnData.net, obj = r.o.objective;
    const unit = { area: 'µm²', luts: 'LUT', energy: 'nJ' }[obj];
    const val = (x) => (obj === 'energy' ? x / 1e6 : x);
    const pp = (a, b) => `${a >= b ? '+' : '−'}${nf(Math.abs(a - b) * 100, 1)} ${t('nn.pp')}`;
    let h = `<table class="hls-table"><tr><th></th><td class="note">${t('nn.searchExact')}</td><td class="note">${t('nn.searchBest')}</td></tr>`;
    h += `<tr><th>${t(`nn.searchObj_${obj}`)}</th><td class="mono">${nf(val(r.exact.cost), 0)} ${unit}</td><td class="mono"><b>${nf(val(r.best.cost), 0)} ${unit}</b> (−${nf(100 * r.best.saving, 1)}%)</td></tr>`;
    h += `<tr><th>${t('nn.searchAccVal', { n: r.n })}</th><td class="mono">${pct(r.exact.accVal)}</td><td class="mono">${pct(r.best.accVal)} (${pp(r.best.accVal, r.exact.accVal)})</td></tr>`;
    h += `<tr><th>${t('nn.searchAccTest', { n: r.testN })}</th><td class="mono">${pct(r.exact.accTest)}</td><td class="mono"><b>${pct(r.best.accTest)}</b> (${pp(r.best.accTest, r.exact.accTest)})</td></tr></table>`;
    h += `<table class="hls-table" style="margin-top:8px"><tr><th></th><td class="note">${t('nn.mul')}</td><td class="note">${t('nn.adder')}</td><td class="note">${unit}</td></tr>`;
    net.sites.forEach((l, i) => {
        const a = r.best.assign[i], lb = r.layersBest.find((x) => x.site === i), le = r.layersExact.find((x) => x.site === i);
        const v = val(lb[obj]), ve = val(le[obj]);
        h += `<tr><th class="mono">${esc(l.name)}</th><td class="mono">${esc(dn(a.mul ?? 'MUL8 exato'))}</td><td class="mono">${esc(dn(a.add ?? 'ADD32 exato'))}</td><td class="mono">${nf(v, 0)}${v !== ve ? ` <span class="note">(−${nf(100 * (1 - v / ve), 1)}%)</span>` : ''}</td></tr>`;
    });
    h += '</table>';
    h += `<div class="row" style="margin-top:6px"><button type="button" class="btn primary" id="nnSearchApply">${t('nn.searchApply')}</button></div>`;
    const left = h;
    h = '';
    // Pontos avaliados por inteiro (os inviáveis abandonados no meio não têm acurácia).
    const pts = r.points.filter((p) => p.full).map((p) => ({ x: (100 * p.cost) / r.exact.cost, y: 100 * (1 - p.wrong / r.n), infeasible: !p.feasible, label: p.assign.map((a, i) => (a.mul || a.add ? `${net.sites[i].name}: ${[a.mul, a.add].filter(Boolean).join(' + ')}` : '')).filter(Boolean).join('; ') || t('nn.searchExact') }));
    const front = new Set(r.front.map((f) => JSON.stringify(f.assign)));
    for (const [k, p] of r.points.filter((q) => q.full).entries()) { if (front.has(JSON.stringify(p.assign))) pts[k].front = true; }
    pts.push({ x: 100, y: 100 * r.exact.accVal, label: t('nn.searchExact') });
    pts.push({ x: (100 * r.best.cost) / r.exact.cost, y: 100 * r.best.accVal, label: t('nn.searchBest'), current: true, front: true });
    h += `<figure style="margin:0">${accuracyCostSvg(pts, { xLabel: t('nn.searchPlotX', { obj: t(`nn.searchObj_${obj}`) }), yLabel: t('nn.searchPlotY'), limit: 100 * (r.exact.accVal - r.maxDrop / 100), width: 520, height: 300 })}</figure>`;
    const se = (a, n) => 100 * Math.sqrt((a * (1 - a)) / n);
    const plot = h;
    h = '';
    h += `<p class="note">${t('nn.searchNoise', { n: r.n, se: nf(se(r.exact.accVal, r.n), 1), seT: nf(se(r.exact.accTest, r.testN), 1), dv: nf(100 * (r.exact.accVal - r.best.accVal), 1), dt: nf(100 * (r.exact.accTest - r.best.accTest), 1) })}</p>`;
    h += `<p class="note">${t('nn.searchNote', { cands: r.cands.map((c, i) => `${net.sites[i].name} ${c.mul.length} × ${c.add.length}`).join(', '), maxWrong: r.maxWrong, n: r.n })}</p>`;
    $('nnSearchResult').innerHTML = `<div class="nn-search-out"><div>${left}</div><div>${plot}</div></div>${h}`;
    $('nnSearchApply').onclick = () => { setOverride(r.best.assign); setTab('result'); render(); };
}
$('nnSensBtn').onclick = async () => {
    if (!nnData) return;
    const run = ++nnRun;
    const { net, test } = nnData;
    const macs = macsPerSite(net), total = macs.reduce((a, b) => a + b, 0);
    const rows = [];
    for (let i = 0; i < net.sites.length; i++) {
        const setup = nnSetup(net.sites.map((_, j) => j === i));
        let preds;
        try {
            preds = await classifyAsync(setup.tables, setup.adds, setup.key, (k, n) => { $('nnStatus').textContent = t('nn.sensProgress', { layer: net.sites[i].name, k, n }); }, setup.trees);
        } catch { return; }
        if (run !== nnRun) return;
        rows.push(`<tr><th>${esc(net.sites[i].name)}</th><td class="mono">${pct(macs[i] / total)}</td><td class="mono">${pct(summarize(test, preds, null, net.classes).accuracy)}</td></tr>`);
    }
    $('nnStatus').textContent = '';
    $('nnSens').innerHTML = `<h3 style="margin-top:10px">${t('nn.sensTitle')}</h3><table class="hls-table"><tr><th></th><td class="note">${t('nn.sensMacs')}</td><td class="note">${t('nn.sensAcc')}</td></tr>${rows.join('')}</table><p class="note">${t('nn.sensNote')}</p>`;
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
    if (synth) { fillSelects(); renderArch(); render(); }
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

Promise.all([getJson('data/synth.json'), getJson('data/nn/models.json')]).then(([s, reg]) => { synth = s; registry = reg; fillSelects(); render(); })
    .catch((e) => { $('nnStatus').textContent = t('nn.loadError', { file: e.message }); });
