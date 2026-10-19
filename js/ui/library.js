/**
 * Aba Biblioteca da página de síntese: as unidades sintetizadas (data/synth.json), o modelo de portas contra a síntese,
 * o espaço de projeto com a fronteira de Pareto e a EvoApprox8b como referência, e a exportação em Verilog. Veio da
 * página de unidades; lá, a unidade atual é a dos controles, aqui é a linha escolhida na tabela.
 */
import { buildUnit } from '../axc/units.js';
import { testInputs, errorMetrics, paretoFront } from '../axc/metrics.js';
import { scatterSvg, designSpaceSvg, esc } from './plots.js';
import { toVerilog, testbench, vectors, moduleName } from '../axc/verilog.js';
import { t, locale, getLanguage, dec } from '../i18n/index.js';
import { exportFigure } from './figexport.js';

const $ = (id) => document.getElementById(id);
const nf = (v, d = 2) => (Number.isInteger(v) ? v.toLocaleString(locale()) : v.toLocaleString(locale(), { maximumFractionDigits: d }));
const sci = (v) => (v === 0 ? '0' : v >= 0.01 && v < 1e5 ? nf(v, 4) : dec(v.toExponential(2)));
const pct = (v) => (v > 0 && v < 1e-4 ? `${dec((100 * v).toExponential(1))}%` : `${(100 * v).toLocaleString(locale(), { maximumFractionDigits: 2 })}%`);
const dn = (name) => (getLanguage() === 'en' ? name.replace(/ exato$/, ' exact') : name);
function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let synth = null, selected = null, active = () => false;

/** Endereço da página de unidades com a configuração nos controles. */
export function unitPageUrl(cfg) {
    const p = new URLSearchParams({ kind: cfg.kind, width: String(cfg.width) });
    if (cfg.kind === 'mul') {
        p.set('mulMethod', cfg.method ?? 'array');
        if (cfg.kTrunc) p.set('kTrunc', cfg.kTrunc);
        if (cfg.kApprox) p.set('kApprox', cfg.kApprox);
        if (cfg.approxCarry === false) p.set('approxCarry', '0');
        if (cfg.kBlock !== undefined) p.set('kBlock', cfg.kBlock);
        if (cfg.k !== undefined) p.set('drumK', cfg.k);
        if (cfg.comp) p.set('comp', '1');
    } else {
        p.set('adder', cfg.adder);
        if (cfg.k !== undefined) p.set('kAdd', cfg.k);
        if (cfg.L !== undefined) p.set('segL', cfg.L);
        if (cfg.P !== undefined) p.set('segP', cfg.P);
    }
    p.set('tab', 'struct');
    return `./index.html#${p.toString()}`;
}

function select(name) {
    selected = name;
    renderSelected();
    renderSynth();
}
function renderSelected() {
    const d = synth?.designs.find((x) => x.name === selected);
    $('libSel').textContent = d ? t('lib.selected', { name: dn(d.name) }) : '';
    $('libOpen').href = d ? unitPageUrl(d.cfg) : './index.html';
}


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
    const curName = selected;
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
            if (active()) renderSynth();
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
            if (active()) renderDesignSpace();
        });
    }
    const D = dsData();
    const curName = selected;
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
    if (d) select(d.name);
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
    if (svg) exportFigure(svg, 'svg', `axc-${$('dsGroup').value}`);
};
$('synthTarget').addEventListener('change', () => renderSynth());
$('synthTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-k]');
    if (!tr) return;
    select(synth.designs[+tr.dataset.k].name);
});

const selectedUnit = () => { const d = synth?.designs.find((x) => x.name === selected); return d ? { cfg: d.cfg, unit: buildUnit(d.cfg) } : null; };
$('dlVerilog').onclick = () => {
    const cur = selectedUnit();
    if (!cur) return;
    const name = moduleName(cur.cfg);
    const inp = testInputs(cur.cfg.width, 'uniform', 20000, 2026);
    download(`${name}.v`, `${toVerilog(cur.unit, name)}\n${testbench(cur.unit, inp.a.length, `${name}.hex`, name)}`, 'text/plain');
};
$('dlHex').onclick = () => {
    const cur = selectedUnit();
    if (!cur) return;
    const name = moduleName(cur.cfg);
    download(`${name}.hex`, vectors(cur.unit, testInputs(cur.cfg.width, 'uniform', 20000, 2026)), 'text/plain');
};

/**
 * Liga a aba aos dados da biblioteca.
 * @param {object} data data/synth.json
 * @param {() => boolean} isActive se a aba está visível (as métricas de erro são calculadas aos poucos só nela)
 */
export function initLibrary(data, isActive) {
    synth = data;
    active = isActive;
    if (!selected && synth?.designs.length) selected = synth.designs[0].name;
}
export function renderLibrary() {
    renderSelected();
    renderSynth();
}
