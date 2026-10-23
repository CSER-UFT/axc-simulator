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
let registry = null;        // data/nn/models.json
let nnData = null, nnRun = 0;
let nnDirs = null;           // diretivas de cada camada com pesos (js/axc/nngen.js), guardadas por modelo
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
function nnSetup(mask) {
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
    if (changed) { fillLayers(); renderArch(); nnDirs = loadDirs(net); fillDirs(); }
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
    const approxMacs = macs.reduce((a, m, i) => a + (mask[i] ? m : 0), 0);
    const label = `${setup.mul ? dn(unitName(setup.mul.cfg)) : t('nn.mulExact')} + ${setup.add ? dn(unitName(setup.add.cfg)) : t('nn.addExact')}`;
    let h = '<table class="kv">';
    h += `<tr><th>${t('nn.accExact')}</th><td class="mono">${pct(sx.accuracy)}</td></tr>`;
    if (refUnitPreds) h += `<tr><th>${t('nn.accRefUnit', { name: dn(unitName(refUnit.cfg)) })}</th><td class="mono">${pct(summarize(test, refUnitPreds, null, classes).accuracy)}</td></tr>`;
    h += `<tr><th><b>${esc(t('nn.accUnit', { name: label }))}</b></th><td class="mono"><b>${pct(su.accuracy)}</b> (${su.accuracy >= sx.accuracy ? '+' : '−'}${nf(Math.abs(su.accuracy - sx.accuracy) * 100, 1)} ${t('nn.pp')})</td></tr>`;
    h += `<tr><th>${t('nn.changed')}</th><td class="mono">${t('nn.changedV', { broke: su.broke.length, fixed: su.fixed })}</td></tr>`;
    h += `<tr><th>${t('nn.approxMacs')}</th><td class="mono">${nf(approxMacs)} ${t('nn.of')} ${nf(total)} (${pct(approxMacs / total)})</td></tr>`;
    h += '</table>';
    $('nnTable').innerHTML = h;
    $('nnNote').innerHTML = modelNote(net) + (refUnitPreds ? ` ${t('nn.booth8')}` : '') + (setup.add ? ` ${t(setup.add.cfg.width >= 32 ? 'nn.adderNote32' : 'nn.adderNote', { n: setup.add.cfg.width })} ${t({ tree: 'nn.accumTreeNote', chain: 'nn.accumChainNote', arch: 'nn.accumArchNote' }[accumMode()])}` : '');
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
    $('nnCode').textContent = k ? k.src : '';
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
    const cost = (m, a, k) => {
        const key = `${net.id}|${o.target}|${o.clockNs}|${m ?? '-'}|${a ?? '-'}|${k.join('')}|${JSON.stringify(nnDirs)}`;
        if (!costCache.has(key)) {
            if (costCache.size > 200) costCache.delete(costCache.keys().next().value);
            costCache.set(key, networkCost(net, { ...o, mul: m, add: a, mask: k, dirs: nnDirs }));
        }
        return costCache.get(key);
    };
    let ex, c;
    try {
        ex = cost(null, null, mask);
        c = cost(mul ? unitName(mul.cfg) : null, add ? unitName(add.cfg) : null, mask);
    } catch (e) { $('nnCost').innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    if (run !== costRun) return;
    const d = (a, b) => (b ? `${a <= b ? '−' : '+'}${nf(Math.abs(100 * (1 - a / b)), 1)}%` : '');
    const asic = o.target === 'asic';
    let h = `<table class="kv"><tr><th></th><td class="note">${t('nn.costCycles')}</td><td class="note">II</td><td class="note">${asic ? 'µm²' : 'LUT'}</td><td class="note">${asic ? 'FF' : 'FF'}</td><td class="note">DSP</td><td class="note">nJ</td></tr>`;
    for (const l of c.layers) {
        const e = ex.layers.find((x) => x.name === l.name);
        const main = asic ? l.area : l.luts, mainEx = asic ? e.area : e.luts;
        h += `<tr><th class="mono">${esc(l.name)}${l.approx ? ' *' : ''}</th><td class="mono">${nf(l.cycles)}</td><td class="mono"${whyText(l.IIwhy) ? ` title="${esc(whyText(l.IIwhy))}"` : ''}>${l.II ?? '-'}${whyText(l.IIwhy) ? '<sup>†</sup>' : ''}</td><td class="mono">${nf(main, 0)}${main !== mainEx ? ` <span class="note">(${d(main, mainEx)})</span>` : ''}</td><td class="mono">${nf(l.ff)}</td><td class="mono">${l.dsp}</td><td class="mono">${nf(l.energy / 1e6, 2)}</td></tr>`;
    }
    const T = c.totals, X = ex.totals, main = asic ? T.area : T.luts, mainEx = asic ? X.area : X.luts;
    h += `<tr><th><b>${t('nn.costTotal')}</b></th><td class="mono"><b>${nf(T.cycles)}</b></td><td></td><td class="mono"><b>${nf(main, 0)}</b> (${d(main, mainEx)})</td><td class="mono">${nf(T.ff)}</td><td class="mono">${T.dsp}</td><td class="mono"><b>${nf(T.energy / 1e6, 1)}</b> (${d(T.energy, X.energy)})</td></tr></table>`;
    $('nnCost').innerHTML = h;
    lastKernels = c.layers.map((l) => ({ name: l.name, site: l.site, src: l.src }));
    renderCode();
    const limited = c.layers.filter((l) => whyText(l.IIwhy)).map((l) => `${esc(l.name)} (${esc(whyText(l.IIwhy))})`);
    $('nnCostNote').innerHTML = (limited.length ? `${t('nn.whyNote', { list: limited.join('; ') })} ` : '') + t('nn.costNote', { us: nf(T.timeUs, 1), clock: nf(o.clockNs, 1) }) + (c.warnings.length ? ` ${esc(c.warnings.join('; '))}` : '');
}
for (const id of ['nnClock', 'nnTarget']) $(id).addEventListener('change', () => renderCost());

for (const id of ['nnMul', 'nnAdder', 'nnModel', 'nnAccum']) $(id).addEventListener('change', () => { store.set(`nn.${id}`, $(id).value); render(); });
$('nnLayers').addEventListener('change', () => render());
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
