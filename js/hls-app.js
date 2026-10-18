/**
 * Página de síntese de alto nível: o kernel, as opções, e o relatório, o escalonamento, o DFG e a IR do resultado.
 */
import { synthesize, MODEL } from './hls/index.js';
import { KERNELS } from './hls/kernels.js';
import { ganttSvg, dfgSvg, dseSvg, dseStepSvg } from './hls/ui.js';
import { technique } from './hls/approx.js';
import { analyzeError } from './hls/error.js';
import { makeInputs, crop, inputArrays } from './hls/exec.js';
import { fromRgba, parseNetpbm, fitImage } from './axc/image.js';
import { initLibrary, renderLibrary } from './ui/library.js';
import { highlightC, highlightIR } from './hls/highlight.js';
import { affSource } from './hls/elab.js';
import { esc } from './ui/plots.js';
import { LANGUAGES, getLanguage, setLanguage, t, locale } from './i18n/index.js';

const $ = (id) => document.getElementById(id);
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};
const nf = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '-' : v.toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: 0 }));

let synthData = null, cellsData = null, result = null, tab = store.get('hls.tab') ?? 'report';
// Unidade aproximada de cada operação (id do nó -> nome), guardada por exemplo.
const assignKey = () => `hls.assign.${$('example').value || 'custom'}`;
let assign = new Map();
const loadAssign = () => { try { assign = new Map(Object.entries(JSON.parse(store.get(assignKey()) ?? '{}'))); } catch { assign = new Map(); } };
const saveAssign = () => store.set(assignKey(), JSON.stringify(Object.fromEntries(assign)));
let profCache = null, apCache = null;

// Exemplos e editor ----------------------------------------------------------------------------------------
function fillExamples() {
    const sel = $('example');
    const cur = sel.value || store.get('hls.example') || 'gauss';
    sel.innerHTML = KERNELS.map((k) => `<option value="${k.id}">${esc(getLanguage() === 'en' ? k.nameEn : k.name)}</option>`).join('') + `<option value="custom">${esc(t('hls.custom'))}</option>`;
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'gauss';
}
$('example').addEventListener('change', () => {
    const k = KERNELS.find((x) => x.id === $('example').value);
    store.set('hls.example', $('example').value);
    loadAssign();
    if (k) { $('code').value = k.code; store.set('hls.code', ''); errLine = null; paintCode(); run(); }
});
// Editor com destaque: a camada colorida fica atrás do textarea (texto transparente) e acompanha a rolagem.
let errLine = null;
function paintCode() {
    $('codeHl').innerHTML = highlightC($('code').value, errLine);
    $('codeHl').scrollTop = $('code').scrollTop;
    $('codeHl').scrollLeft = $('code').scrollLeft;
}
$('code').addEventListener('scroll', () => { $('codeHl').scrollTop = $('code').scrollTop; $('codeHl').scrollLeft = $('code').scrollLeft; });
$('code').addEventListener('input', () => { errLine = null; paintCode(); });
$('code').addEventListener('input', () => { $('example').value = 'custom'; store.set('hls.example', 'custom'); store.set('hls.code', $('code').value); });
$('code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target, s = ta.selectionStart;
        ta.value = `${ta.value.slice(0, s)}    ${ta.value.slice(ta.selectionEnd)}`;
        ta.selectionStart = ta.selectionEnd = s + 4;
        paintCode();
    }
});
for (const id of ['clock', 'flow', 'ports']) {
    const v = store.get(`hls.${id}`);
    if (v) $(id).value = v;
    $(id).addEventListener('change', () => { store.set(`hls.${id}`, $(id).value); run(); });
}
$('run').addEventListener('click', () => run());

// Síntese ------------------------------------------------------------------------------------------------------
function run() {
    if (!synthData || !cellsData) return;
    $('error').textContent = '';
    try {
        result = synthesize($('code').value, { synth: synthData, cells: cellsData, clockNs: +$('clock').value, flow: $('flow').value, ports: +$('ports').value, assign });
    } catch (e) {
        result = null;
        $('error').textContent = e.message;
        errLine = e.line ?? null;
        paintCode();
        return;
    }
    if (errLine !== null) { errLine = null; paintCode(); }
    fillSegments();
    render();
}

const loopName = (l) => l.label ?? l.id;
const modeName = (m) => t(`hls.mode.${m}`);
const whyText = (w) => {
    if (!w) return '';
    if (w.kind === 'target') return t('hls.why.target');
    if (w.kind === 'mem') return t('hls.why.mem', { arr: w.label ?? w.key, uses: w.uses, cap: w.cap });
    if (w.kind === 'unit') return t('hls.why.unit', { key: w.key, uses: w.uses, cap: w.cap });
    if (w.kind === 'rec') return t('hls.why.rec', { v: w.key, c: w.cycles });
    return t('hls.why.schedule');
};

function segLabel(sg) {
    const L = sg.seg.region.loop;
    return `${sg.seg.id}: ${L ? `${t('hls.inLoop')} ${loopName(L)}${L.mode === 'pipelined' ? ` (pipeline, II ${L.IIachieved})` : ''}` : t('hls.topLevel')} · ${sg.seg.nodes.length} ${t('hls.nodes')}`;
}
function fillSegments() {
    const interesting = result.segs.filter((s) => s.seg.nodes.some((n) => !['in', 'carryout', 'iv'].includes(n.op)));
    const def = interesting.find((s) => s.pipelined) ?? interesting[0] ?? result.segs[0];
    for (const id of ['segSel', 'segSel2']) {
        const sel = $(id), prev = sel.value;
        sel.innerHTML = result.segs.map((s, k) => `<option value="${k}">${esc(segLabel(s))}</option>`).join('');
        sel.value = [...sel.options].some((o) => o.value === prev) && result.segs[+prev]?.seg.id === prev ? prev : String(result.segs.indexOf(def));
    }
}
$('segSel').addEventListener('change', () => { $('segSel2').value = $('segSel').value; render(); });
$('segSel2').addEventListener('change', () => { $('segSel').value = $('segSel2').value; render(); });

// Relatório ----------------------------------------------------------------------------------------------------
function render() {
    if (!result) return;
    const r = result, T = r.totals;
    const metric = (k, v, u = '') => `<div class="metric"><div class="k">${esc(t(k))}</div><div class="v">${v}</div><div class="u">${esc(u)}</div></div>`;
    $('summary').innerHTML = [
        metric('hls.m.cycles', nf(T.cycles), t('hls.u.cycles', { ns: nf(T.clockPs / 1000, 2) })),
        metric('hls.m.time', nf(T.timeNs / 1000, 2), 'µs'),
        metric('hls.m.interval', T.intervalNs ? nf(T.intervalNs, 2) : '-', T.intervalNs ? t('hls.u.interval') : ''),
        metric('hls.m.crit', nf(T.critPs), t('hls.u.crit')),
        metric('hls.m.area', nf(T.area), 'µm² (sky130)'),
        metric('hls.m.fpga', `${nf(T.luts)} / ${nf(T.carry4)}`, t('hls.u.fpga', { ff: nf(T.ff) })),
        metric('hls.m.energy', nf(T.energy / 1e6, 2), t('hls.u.energy')),
        metric('hls.m.approx', `${r.assign.size} / ${r.ops.list.length}`, t('hls.u.approx')),
    ].join('');
    $('loops').innerHTML = `<tr><th>${t('hls.th.loop')}</th><th>${t('hls.th.line')}</th><th>${t('hls.th.trip')}</th><th>${t('hls.th.mode')}</th><th>unroll</th><th>II</th><th>${t('hls.th.limit')}</th><th>${t('hls.th.iter')}</th><th>${t('hls.th.latency')}</th></tr>`
        + r.design.loops.map((l) => `<tr><td class="mono">${esc(loopName(l))}</td><td>${l.line}</td><td>${nf(l.trip)}</td><td class="left">${esc(modeName(l.mode))}</td><td>${l.mode === 'unrolled' ? t('hls.full') : l.factor > 1 ? l.factor : '-'}</td>`
            + `<td>${l.mode === 'pipelined' ? `${l.IIachieved}${l.II && l.II !== l.IIachieved ? ` (${t('hls.target')} ${l.II})` : ''}` : '-'}</td><td class="left">${esc(l.mode === 'pipelined' ? whyText(l.why) : '')}</td>`
            + `<td>${l.mode === 'unrolled' ? '-' : nf(l.iterLatency)}</td><td>${l.mode === 'unrolled' ? '-' : nf(l.latency)}</td></tr>`).join('');
    const c = r.cost;
    const rowsRes = [
        ...c.units.map((u) => [u.unit.name, u.count, u.area, `${u.luts} / ${u.carry4}`, t('hls.res.unit', { d: nf(u.unit.delay), e: nf(u.unit.energy) })]),
        ...c.cells.map((x) => [`${t(`hls.cell.${x.cls}`)} ${x.W} bits`, x.count, x.area, `${x.luts} / ${x.carry4}`, t('hls.res.cell')]),
        ...c.muxes.length ? [[t('hls.res.mux'), c.muxes.length, c.area.mux, `${c.muxes.reduce((s, m) => s + m.luts, 0)} / 0`, t('hls.res.muxNote', { list: c.muxes.map((m) => `${m.key}#${m.inst + 1}:${m.side ? 'b' : 'a'} ${m.inputs}`).slice(0, 6).join(', ') })]] : [],
        [t('hls.res.regs'), `${nf(c.regBits)} bits`, c.area.registers, `${nf(c.fpga.ff)} FF`, t('hls.res.regsNote')],
        ...c.control.map((x) => [t('hls.res.control', { l: x.loop }), `${x.bits} bits`, x.area, `${x.luts} / ${x.carry4}`, '']),
    ];
    $('resources').innerHTML = `<tr><th>${t('hls.th.resource')}</th><th>${t('hls.th.count')}</th><th>µm²</th><th>LUT / CARRY4</th><th class="left">${t('hls.th.note')}</th></tr>`
        + rowsRes.map(([a, b, ar, l, n]) => `<tr><td class="mono">${esc(a)}</td><td>${typeof b === 'number' ? nf(b) : esc(b)}</td><td>${nf(ar)}</td><td>${esc(l)}</td><td class="left note">${esc(n)}</td></tr>`).join('');
    const A = c.area, E = c.energy;
    const pct = (x, tot) => (tot ? `${((100 * x) / tot).toFixed(1)}%` : '-');
    $('breakdown').innerHTML = `<tr><th>${t('hls.th.part')}</th><th>µm²</th><th>%</th><th>${t('hls.th.energy')}</th><th>%</th></tr>`
        + [['hls.part.units', A.units, E.ops], ['hls.part.cells', A.cells, null], ['hls.part.mux', A.mux, null], ['hls.part.regs', A.registers, E.registers], ['hls.part.control', A.control, E.control], ['hls.part.leak', null, E.leakage]]
            .map(([k, a, e]) => `<tr><td>${t(k)}</td><td>${a === null ? '-' : nf(a)}</td><td>${a === null ? '' : pct(a, A.total)}</td><td>${e === null ? (k === 'hls.part.cells' ? t('hls.inOps') : '-') : nf(e / 1000, 1)}</td><td>${e === null ? '' : pct(e, E.total)}</td></tr>`).join('')
        + `<tr><th>${t('hls.total')}</th><th>${nf(A.total)}</th><th></th><th>${nf(E.total / 1000, 1)}</th><th></th></tr>`;
    $('warnings').innerHTML = r.warnings.map((w) => `<li>${t('hls.lineN', { n: w.line })}: ${esc(w.msg)}</li>`).join('');
    $('modelNotes').innerHTML = t('hls.modelNotes', { mem: MODEL.memLatency, loop: MODEL.loopOverhead, pipe: MODEL.pipelineOverhead, cq: r.lib.reg.clkToQ, su: r.lib.reg.setup, reg: nf(r.lib.reg.area, 1), ereg: nf(r.lib.reg.energy, 1) });
    renderTab();
}

function renderTab() {
    if (!$(`pane-${tab}`)) tab = 'report';
    for (const b of $('tabs').querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('hidden', p.id !== `pane-${tab}`);
    // A biblioteca não depende do kernel e a exploração precisa de espaço: as duas ocupam a página toda.
    document.querySelector('.hls-main').classList.toggle('wide', tab === 'lib' || tab === 'dse');
    if (tab === 'lib' && synthData) renderLibrary();
    if (!result) return;
    const sg = result.segs[+$('segSel').value] ?? result.segs[0];
    if (tab === 'sched' && sg) {
        $('gantt').innerHTML = ganttSvg(sg.sch, { clockPs: result.totals.clockPs, pipelined: sg.pipelined });
        $('segInfo').textContent = t('hls.segInfo', { depth: sg.sch.depth, execs: nf(sg.execs), tc: nf(sg.sch.Tc), ov: sg.sch.overhead });
    }
    if (tab === 'dfg' && sg) $('dfg').innerHTML = dfgSvg(sg.seg, sg.sch);
    if (tab === 'ir') $('ir').innerHTML = highlightIR(irText(result));
    if (tab === 'approx') renderApprox();
    if (tab === 'dse') renderDse();
}

// Exploração ------------------------------------------------------------------------------------------------------
let dseWorker = null, dseResult = null;
for (const id of ['dseObj', 'dseMetric', 'dseValue', 'dseGran', 'dseHeur', 'dseClocks', 'dseDir', 'dseAll', 'dseWa', 'dseWe', 'dseWl']) {
    const el = $(id), v = store.get(`hls.${id}`);
    if (v !== null) { if (el.type === 'checkbox') el.checked = v === '1'; else el.value = v; }
    el.addEventListener('change', () => { store.set(`hls.${id}`, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value); syncDse(); });
}
function syncDse() { $('dseWeights').style.display = $('dseObj').value === 'weighted' ? '' : 'none'; }
syncDse();
const dseOptions = () => ({
    flow: $('flow').value, ports: +$('ports').value, input: $('apInput').value, image: $('apInput').value === 'own' ? ownImage : null, method: $('apModel').value,
    objective: $('dseObj').value, weights: { area: +$('dseWa').value, energy: +$('dseWe').value, latency: +$('dseWl').value },
    constraint: { metric: $('dseMetric').value, value: +$('dseValue').value }, granularity: $('dseGran').value, heuristic: $('dseHeur').value,
    clocks: $('dseClocks').value.split(/[,; ]+/).map(Number).filter((x) => x > 0), directives: $('dseDir').checked, allUnits: $('dseAll').checked,
    verifyFront: 6,
});
$('dseRun').addEventListener('click', () => {
    if (!synthData) return;
    dseWorker?.terminate();
    const opts = dseOptions();
    const t0 = performance.now();
    dseWorker = new Worker(new URL('./hls/dse-worker.js', import.meta.url), { type: 'module' });
    $('dseRun').disabled = true; $('dseStop').disabled = false;
    $('dseStatus').textContent = t('dse.preparing');
    dseWorker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') $('dseStatus').textContent = t('dse.progress', { n: nf(m.n), s: nf((performance.now() - t0) / 1000, 1) });
        else {
            $('dseRun').disabled = false; $('dseStop').disabled = true;
            dseWorker.terminate(); dseWorker = null;
            if (m.type === 'error') { $('dseStatus').textContent = m.message; return; }
            dseResult = { ...m.result, opts };
            stopPlay();
            fillStepSel();
            $('dseStatus').textContent = t('dse.done', { s: nf(m.result.ms / 1000, 1), prep: nf(m.result.prepMs / 1000, 1), cand: nf(m.result.candMs / 1000, 1), v: m.result.variants.length });
            renderDse();
        }
    };
    dseWorker.onerror = (e) => { $('dseStatus').textContent = e.message; $('dseRun').disabled = false; $('dseStop').disabled = true; };
    dseWorker.postMessage({ src: $('code').value, options: opts, synth: synthData, cells: cellsData });
});
$('dseStop').addEventListener('click', () => { dseWorker?.terminate(); dseWorker = null; $('dseRun').disabled = false; $('dseStop').disabled = true; $('dseStatus').textContent = t('dse.stopped'); });

function fmtScore(v, obj) {
    if (v === null || v === undefined) return '-';
    switch (obj) {
        case 'area': return `${nf(v)} µm²`;
        case 'luts': return nf(v);
        case 'energy': return `${nf(v / 1e6, 1)} nJ`;
        case 'latency': case 'interval': return `${nf(v, 1)} ns`;
        default: return nf(v, 3);
    }
}
const hName = (h) => t(`dse.h.${h}`);
function renderDse() {
    if (dseResult && !$('dseStepSel').options.length) fillStepSel();
    if (dseResult) renderStep();
    $('dseKernel').textContent = result ? t('dse.kernel', { k: result.design.name, n: result.ops.list.length }) : '';
    const R = dseResult;
    if (!R) { $('dseRuns').innerHTML = ''; $('dseFig').innerHTML = ''; $('dseFront').innerHTML = ''; return; }
    const obj = R.opts.objective, ps = (x) => (x === null || x === undefined ? '-' : x === Infinity ? '∞' : nf(x, 2));
    const minP = (arr) => (arr ? Math.min(...arr.map((o) => o.PSNR)) : null);
    const pctS = (x) => `${nf(100 * x, 1)}%`;
    $('dseRuns').innerHTML = `<tr><th class="left">${t('dse.th.heuristic')}</th><th>${t('dse.th.evals')}</th><th>${t('dse.th.time')}</th><th>${t('dse.th.cost')}</th><th>${t('dse.th.savings')}</th><th>PSNR (${t('dse.estMeas')})</th><th class="left">${t('dse.th.units')}</th><th></th></tr>`
        + R.runs.map((r, k) => {
            const p = r.chosen ?? r.best;
            if (!p || r.error) return `<tr><td class="left">${esc(hName(r.heuristic))}</td><td>${nf(r.evals)}</td><td>${nf(r.ms / 1000, 1)} s</td><td colspan="5" class="left note">${esc(r.error ?? '-')}</td></tr>`;
            return `<tr><td class="left">${esc(hName(r.heuristic))}</td><td>${nf(r.evals)}</td><td>${nf(r.ms / 1000, 1)} s</td><td>${fmtScore(p.score, obj)}</td>`
                + `<td>${t('dse.sav', { a: pctS(p.savings.area), e: pctS(p.savings.energy), l: pctS(p.savings.latency) })}</td><td>${ps(minP(p.estimated))} / ${ps(minP(p.measured))}${r.chosen ? '' : ` <span class="note">${t('dse.notVerified')}</span>`}</td>`
                + `<td class="units">${esc(p.variant)}<br>${esc(p.units.join(', '))}</td><td><button type="button" class="btn outline" data-apply="${k}:best">${t('dse.apply')}</button></td></tr>`;
        }).join('');
    const names = { exact: t('dse.exact'), y: t('dse.yLabel'), ...Object.fromEntries(['efficiency', 'sequential', 'exhaustive', 'random'].map((h) => [h, hName(h)])) };
    const xLabel = `${t(`dse.obj.${obj}`)}${obj === 'weighted' ? ` (${t('dse.exactIs', { v: nf(R.refScore, 2) })})` : ''}`;
    $('dseFig').innerHTML = dseSvg(R.runs.filter((r) => !r.error), { xLabel, psnrMin: R.opts.constraint.metric === 'psnr' ? R.opts.constraint.value : null, refScore: R.refScore, names, chosenLabel: t('dse.chosen') });
    $('dseFigNote').textContent = t('dse.figNote', { v: R.variants.map((v) => v.label + (v.error ? ` (${v.error})` : '')).join('; ') });
    const sel = $('dseFrontSel'), prev = sel.value;
    sel.innerHTML = R.runs.map((r, k) => `<option value="${k}">${esc(hName(r.heuristic))}</option>`).join('');
    if (prev && +prev < R.runs.length) sel.value = prev;
    const r = R.runs[+sel.value || 0];
    const bestKey = (r.chosen ?? r.best);
    $('dseFront').innerHTML = `<tr><th>${t('dse.th.cost')}</th><th>µm²</th><th>LUT</th><th>nJ</th><th>${t('dse.th.latency')}</th><th>PSNR (${t('dse.estMeas')})</th><th></th><th class="left">${t('dse.th.units')}</th><th></th></tr>`
        + r.front.map((p, i) => `<tr class="${bestKey && p.score === bestKey.score && p.variant === bestKey.variant ? 'best' : ''}"><td>${fmtScore(p.score, obj)}</td><td>${nf(p.cost.area)}</td><td>${nf(p.cost.luts)}</td><td>${nf(p.cost.energy / 1e6, 1)}</td><td>${nf(p.cost.latency, 0)} ns</td>`
            + `<td>${ps(minP(p.estimated))} / ${ps(minP(p.measured))}</td><td>${p.feasible ? '✓' : ''}</td><td class="units">${esc(p.variant)}<br>${esc(p.units.join(', '))}</td><td><button type="button" class="btn outline" data-apply="${+sel.value || 0}:${i}">${t('dse.apply')}</button></td></tr>`).join('');
}
$('dseFrontSel').addEventListener('change', () => renderDse());

// Passo a passo da busca: cada iteração registrada pela heurística, com o gráfico, a explicação e o que foi avaliado.
let stTimer = null;
const stRun = () => dseResult?.runs[+$('dseStepSel').value || 0];
function stopPlay() { if (stTimer) { clearInterval(stTimer); stTimer = null; } $('stPlay').textContent = '▶'; }
function fillStepSel() {
    const sel = $('dseStepSel'), prev = sel.value;
    sel.innerHTML = dseResult.runs.map((r, k) => `<option value="${k}">${esc(hName(r.heuristic))}</option>`).join('');
    if (prev && +prev < dseResult.runs.length) sel.value = prev;
    const r = stRun();
    $('stSlider').max = String(Math.max(0, (r?.steps?.length ?? 1) - 1));
    $('stSlider').value = '0';
}
function stepText(st, obj) {
    const sc = (v) => fmtScore(v, obj), ps = (v) => (v === Infinity ? '∞' : nf(v, 2));
    const feas = (st.tries ?? []).filter((x) => x.feasible).length;
    switch (st.kind) {
        case 'start': return st.order ? t('dse.st.startSeq', { order: st.order.join(', ') }) : st.moves ? t(st.lazy ? 'dse.st.startEffLazy' : 'dse.st.startEff', { moves: st.moves, refresh: st.refresh }) : t('dse.st.start');
        case 'variant': return t('dse.st.variant', { v: st.label, g: st.groups });
        case 'seq': return t(st.chosen ? 'dse.st.seq' : 'dse.st.seqKeep', { g: st.group, ops: t(st.ops === 1 ? 'dse.st.op1' : 'dse.st.opsN', { n: st.ops }), n: st.tries.length, f: feas, u: st.chosen, c: sc(st.state.score), p: ps(st.state.psnr) });
        case 'eff': return t(st.zeroErr ? 'dse.st.effZero' : 'dse.st.eff', { k: st.n, n: st.tries.length, sk: st.skipped, f: feas, m: st.chosen, ds: sc(st.ds), de: st.de.toExponential(2), e: st.eff.toExponential(2), c: sc(st.state.score), p: ps(st.state.psnr) });
        case 'effEnd': return t('dse.st.effEnd', { n: st.tries.length, sk: st.skipped });
        case 'prune': return t(st.cut ? 'dse.st.pruneCut' : 'dse.st.prune', { g: st.group, k: st.kept - 1, of: st.of - 1, cut: st.cut });
        case 'exhStop': return t('dse.st.exhStop', { n: nf(st.total), max: nf(st.max) });
        case 'order': return t('dse.st.order', { n: nf(st.total) });
        case 'exh': return t(st.found ? 'dse.st.exhFound' : 'dse.st.exh', { a: st.from, b: st.to, n: nf(st.total), f: feas, found: st.found });
        case 'rnd': return t('dse.st.rnd', { a: st.from, b: st.to, n: st.total, f: feas, c: sc(st.state.score), p: ps(st.state.psnr) });
        case 'verify': return t(st.ok ? 'dse.st.verifyOk' : 'dse.st.verifyBad', { k: st.n, l: st.label, e: ps(st.psnr), m: ps(st.measured) });
        default: return '';
    }
}
function renderStep() {
    const r = stRun();
    if (!r?.steps?.length) { $('stFig').innerHTML = ''; $('stText').innerHTML = ''; $('stTries').innerHTML = ''; return; }
    const k = Math.min(+$('stSlider').value, r.steps.length - 1), st = r.steps[k], obj = dseResult.opts.objective;
    const chosenLabel = st.kind === 'seq' ? st.chosen : st.kind === 'eff' ? st.chosen : st.kind === 'exh' ? st.found : null;
    $('stFig').innerHTML = dseStepSvg(r.steps, k, { xLabel: t(`dse.obj.${obj}`), yLabel: t('dse.yLabel'), psnrMin: dseResult.opts.constraint.metric === 'psnr' ? dseResult.opts.constraint.value : null, refScore: dseResult.refScore, chosenLabel });
    const state = st.state ? `${t('dse.st.state')}: ${fmtScore(st.state.score, obj)} · PSNR ${st.state.psnr === Infinity ? '∞' : nf(st.state.psnr, 2)} dB${st.state.units ? ` · ${st.state.units.join(', ')}` : ''}` : '';
    $('stText').innerHTML = `<div class="k">${esc(t('dse.st.iter', { k: k + 1, n: r.steps.length }))}</div><div>${esc(stepText(st, obj))}</div><div class="state">${esc(state)}</div>`;
    // O escolhido primeiro; depois, pela eficiência (quando há) ou pelo custo.
    const tries = [...(st.tries ?? [])].sort((a, b) => (b.label === chosenLabel) - (a.label === chosenLabel) || (b.eff ?? -1) - (a.eff ?? -1) || a.score - b.score).slice(0, 300);
    $('stTries').innerHTML = tries.length ? `<tr><th class="left">${t('dse.st.th.try')}</th><th>${t('dse.th.cost')}</th><th>PSNR</th><th>${t('dse.st.th.ok')}</th>${tries.some((x) => x.eff !== undefined) ? `<th>${t('dse.st.th.eff')}</th>` : ''}</tr>`
        + tries.map((x) => `<tr class="${x.label === chosenLabel ? 'pick' : ''}"><td class="units">${esc(x.label)}</td><td>${fmtScore(x.score, obj)}</td><td>${x.psnr === Infinity ? '∞' : nf(x.psnr, 2)}</td><td>${x.feasible ? '✓' : '✗'}</td>${x.eff !== undefined ? `<td>${x.eff === null ? '-' : x.eff > 1e14 ? t('dse.st.free') : x.eff.toExponential(2)}</td>` : ''}</tr>`).join('') : '';
}
$('dseStepSel').addEventListener('change', () => { stopPlay(); fillStepSel(); renderStep(); });
$('stSlider').addEventListener('input', () => { stopPlay(); renderStep(); });
const stGo = (d) => { const r = stRun(); if (!r?.steps) return; $('stSlider').value = String(Math.max(0, Math.min(r.steps.length - 1, d(+$('stSlider').value, r.steps.length)))); renderStep(); };
$('stFirst').addEventListener('click', () => { stopPlay(); stGo(() => 0); });
$('stPrev').addEventListener('click', () => { stopPlay(); stGo((v) => v - 1); });
$('stNext').addEventListener('click', () => { stopPlay(); stGo((v) => v + 1); });
$('stLast').addEventListener('click', () => { stopPlay(); stGo((v, n) => n - 1); });
$('stPlay').addEventListener('click', () => {
    if (stTimer) { stopPlay(); return; }
    const r = stRun();
    if (!r?.steps?.length) return;
    if (+$('stSlider').value >= r.steps.length - 1) $('stSlider').value = '0';
    $('stPlay').textContent = '⏸';
    renderStep();
    stTimer = setInterval(() => {
        const v = +$('stSlider').value;
        if (v >= r.steps.length - 1) { stopPlay(); return; }
        $('stSlider').value = String(v + 1);
        renderStep();
    }, +$('stSpeed').value);
});
$('stSpeed').addEventListener('change', () => { if (stTimer) { stopPlay(); $('stPlay').click(); } });
function applyPoint(p) {
    if (p.code !== $('code').value) { $('code').value = p.code; $('example').value = 'custom'; store.set('hls.example', 'custom'); store.set('hls.code', p.code); }
    $('clock').value = String(p.clockNs);
    store.set('hls.clock', $('clock').value);
    assign = new Map(Object.entries(p.assign));
    saveAssign();
    paintCode();
    tab = 'approx';
    store.set('hls.tab', tab);
    run();
    renderTab();
}
for (const id of ['dseRuns', 'dseFront']) $(id).addEventListener('click', (e) => {
    const b = e.target.closest('[data-apply]');
    if (!b || !dseResult) return;
    const [k, w] = b.dataset.apply.split(':');
    const r = dseResult.runs[+k];
    applyPoint(w === 'best' ? r.chosen ?? r.best : r.front[+w]);
});
function dlFile(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('dseCsv').addEventListener('click', () => {
    if (!dseResult) return;
    const rows = [['heuristic', 'variant', 'clock_ns', 'score', 'area_um2', 'luts_carry4', 'energy_fJ', 'latency_ns', 'interval_ns', 'psnr_est', 'mse_est', 'psnr_measured', 'feasible', 'units']];
    for (const r of dseResult.runs) for (const p of r.front) rows.push([r.heuristic, p.variant, p.clockNs, p.score, p.cost.area, p.cost.luts, p.cost.energy, p.cost.latency, p.cost.interval, p.estimated[0]?.PSNR, p.estimated[0]?.MSE, p.measured?.[0]?.PSNR ?? '', p.feasible, p.units.join(' + ')]);
    dlFile('axc-dse-front.csv', `${rows.map((x) => x.map((c) => (typeof c === 'string' && /[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')}\n`, 'text/csv');
});
$('dseJson').addEventListener('click', () => {
    if (!dseResult) return;
    const { runs, ...rest } = dseResult;
    dlFile('axc-dse.json', `${JSON.stringify({ ...rest, runs: runs.map((r) => ({ ...r, front: r.front.map(({ code, ...p }) => p), best: r.best && (({ code, ...p }) => p)(r.best), chosen: r.chosen && (({ code, ...p }) => p)(r.chosen) })) }, null, 1)}\n`, 'application/json');
});

// Aproximação ---------------------------------------------------------------------------------------------------
for (const id of ['apInput', 'apModel']) {
    const v = store.get(`hls.${id}`);
    if (v && v !== 'own') $(id).value = v;
    $(id).addEventListener('change', () => { store.set(`hls.${id}`, $(id).value); renderApprox(); });
}
$('apReset').addEventListener('click', () => { assign.clear(); saveAssign(); run(); });
// Imagem do usuário (formatos do navegador e PPM, PGM, PBM), reduzida para no máximo 256 pixels de lado.
let ownImage = null;
$('apImgFile').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const use = (im) => {
        ownImage = fitImage(im, 256);
        $('apOwnOpt').disabled = false;
        $('apOwnOpt').textContent = t('hls.ap.input.ownName', { name: f.name, w: ownImage.w, h: ownImage.h });
        $('apInput').value = 'own';
        profCache = null; apCache = null;
        renderApprox();
    };
    const fail = (msg) => { $('apStatus').textContent = msg; };
    if (/\.(ppm|pgm|pbm|pnm)$/i.test(f.name)) {
        f.arrayBuffer().then((buf) => { try { use(parseNetpbm(new Uint8Array(buf))); } catch (err) { fail(t('app.readError', { name: f.name, msg: t(err.message) })); } });
    } else {
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, 256 / Math.max(img.width, img.height));
            const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k));
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(img.src);
            use(fromRgba(ctx.getImageData(0, 0, w, h).data, w, h));
        };
        img.onerror = () => { URL.revokeObjectURL(img.src); fail(t('app.notImage', { name: f.name })); };
        img.src = URL.createObjectURL(f);
    }
    e.target.value = '';
});
const TECH = ['exact', 'array', 'booth', 'kulkarni', 'drum', 'mitchell', 'trunc', 'loa', 'seg'];
function unitOptions(op, sel) {
    const by = new Map();
    for (const name of op.candidates) {
        const k = technique(result.lib, name);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(name);
    }
    return [...by.entries()].sort((a, b) => TECH.indexOf(a[0]) - TECH.indexOf(b[0]))
        .map(([k, names]) => `<optgroup label="${esc(t(`hls.tech.${k}`))}">${names.map((n) => `<option${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('');
}
const fx = (v, d = 3) => (v === Infinity ? '∞' : v === null || v === undefined || Number.isNaN(v) ? '-' : nf(v, d));

function analysis() {
    const input = $('apInput').value, model = $('apModel').value;
    const key = `${$('code').value}|${$('ports').value}|${input}`;
    if (apCache && apCache.result === result && apCache.input === input && apCache.model === model) return apCache.a;
    const t0 = performance.now();
    const inputs = profCache?.key === key ? profCache.inputs : makeInputs(result.design, input, 2027, ownImage);
    const prof = profCache?.key === key ? profCache.prof : null;
    const a = analyzeError(result, { inputs, prof, method: model });
    profCache = { key, inputs, prof: a.prof };
    a.ms = performance.now() - t0;
    a.inputs = inputs;
    apCache = { result, input, model, a };
    return a;
}

function renderApprox() {
    if (!result) return;
    let a;
    try { a = analysis(); } catch (e) { $('apStatus').textContent = e.message; return; }
    const r = result;
    $('apStatus').textContent = t('hls.ap.status', { n: r.assign.size, total: r.ops.list.length, ms: nf(a.ms) });
    // Saídas.
    const pair = (e, m, d) => `${fx(e, d)} / ${fx(m, d)}`;
    $('apOutputs').innerHTML = `<tr><th>${t('hls.ap.th.out')}</th><th>${t('hls.ap.th.n')}</th><th>ME</th><th>MSE</th><th>PSNR (dB)</th><th>SSIM</th><th>MED</th><th>WCE</th><th>EP</th><th>MRED</th></tr>`
        + a.measured.map((m) => {
            const e = a.est.outputs.get(m.array);
            return `<tr><td class="mono">${esc(m.array)} (${esc(m.type)})</td><td>${nf(m.n)}</td><td>${pair(e.ME, m.ME, 3)}</td><td>${pair(e.MSE, m.MSE, 4)}</td><td>${pair(e.PSNR, m.PSNR, 2)}</td><td>${m.SSIM === null ? '-' : fx(m.SSIM, 4)}</td><td>${fx(m.MED, 3)}</td><td>${fx(m.WCE, 0)}</td><td>${fx(100 * m.EP, 1)}%</td><td>${fx(100 * m.MRED, 3)}%</td></tr>`;
        }).join('');
    $('apOutNote').textContent = t('hls.ap.outNote') + (a.measured.some((m) => m.n === 1) ? ` ${t('hls.ap.single')}` : '');
    // Imagens: entrada, exata, aproximada e diferença (saídas de 2 dimensões e 8 bits).
    const imgs = [];
    for (const m of a.measured) {
        if (!m.box) continue;
        const arr = r.design.arrays.find((x) => x.name === m.array);
        const X = crop(a.prof.mem.get(m.array), arr, m.box), Y = crop(a.approx.mem.get(m.array), arr, m.box);
        const inp = inputArrays(r.design).find((x) => x.dims.length === 2 && x.dims[0] === arr.dims[0] && x.dims[1] === arr.dims[1]);
        if (inp) imgs.push([`${inp.name}`, crop(a.inputs.get(inp.name), inp, m.box)]);
        imgs.push([t('hls.ap.img.exact', { a: m.array }), X], [t('hls.ap.img.approx', { a: m.array }), Y], [t('hls.ap.img.diff'), X.map((v, k) => Math.abs(Y[k] - v) * 8)]);
        $('apImages').innerHTML = imgs.map(([cap], k) => `<figure><canvas id="apc${k}" width="${m.box.w}" height="${m.box.h}"></canvas><figcaption>${esc(cap)}</figcaption></figure>`).join('');
        imgs.forEach(([, data], k) => {
            const cv = $(`apc${k}`), ctx = cv.getContext('2d'), im = ctx.createImageData(m.box.w, m.box.h);
            for (let q = 0; q < data.length; q++) { const v = Math.max(0, Math.min(255, data[q])); im.data.set([v, v, v, 255], 4 * q); }
            ctx.putImageData(im, 0, 0);
        });
        break;
    }
    if (!imgs.length) $('apImages').innerHTML = '';
    // Operações, por grupo (linha do código, operação e largura).
    const bud = new Map(a.est.budget.map((b) => [b.id, b]));
    const out0 = a.measured[0]?.array;
    const totalAlone = [...bud.values()].reduce((s, b) => s + (b.outputs.get(out0)?.MSE ?? 0), 0);
    let html = `<tr><th>${t('hls.ap.th.op')}</th><th class="left">${t('hls.ap.th.expr')}</th><th class="left">${t('hls.ap.th.unit')}</th><th>${t('hls.ap.th.own')}</th><th>${t('hls.ap.th.alone', { a: out0 ?? '' })}</th><th>${t('hls.ap.th.share')}</th></tr>`;
    for (const [g, list] of r.ops.groups) {
        const names = new Set(list.map((o) => r.assign.get(o.id) ?? o.candidates[0]));
        const [line, what] = g.split(':');
        const op0 = list[0];
        const restricted = op0.reason ? ` · ${t(`hls.ap.reason.${op0.reason}`)}` : '';
        html += `<tr class="grp"><td colspan="2" class="left">${esc(t('hls.ap.group', { line, op: what, n: list.length }))}${esc(restricted)}</td><td class="left">${op0.candidates.length > 1 ? `<select data-group="${esc(g)}">${names.size > 1 ? `<option value="" selected>${esc(t('hls.ap.mixed'))}</option>` : ''}${unitOptions(op0, names.size === 1 ? [...names][0] : null)}</select>` : esc(op0.candidates[0])}</td><td colspan="3"></td></tr>`;
        for (const o of list) {
            const cur = r.assign.get(o.id) ?? o.candidates[0];
            const b = bud.get(o.id);
            const alone = b?.outputs.get(out0)?.MSE;
            html += `<tr><td class="mono">${esc(o.id)}</td><td class="expr">${esc(o.text)}</td><td class="left">${o.candidates.length > 1 ? `<select data-op="${esc(o.id)}">${unitOptions(o, cur)}</select>` : `<span class="dim">${esc(cur)}</span>`}</td>`
                + `<td>${b ? `${fx(b.own.mu, 2)} / ${fx(Math.sqrt(b.own.m2), 2)}` : ''}</td><td>${b ? fx(alone, 4) : ''}</td><td>${b && totalAlone ? `${fx((100 * alone) / totalAlone, 1)}%` : ''}</td></tr>`;
        }
    }
    $('apOps').innerHTML = html;
    $('apFlags').innerHTML = a.est.flags.map((f) => `<li>${esc(f)}</li>`).join('');
}
$('apOps').addEventListener('change', (e) => {
    const sel = e.target.closest('select');
    if (!sel || !result) return;
    const set = (o, name) => { if (name === o.candidates[0]) assign.delete(o.id); else assign.set(o.id, name); };
    if (sel.dataset.op) set(result.ops.byId.get(sel.dataset.op), sel.value);
    else if (sel.dataset.group && sel.value) for (const o of result.ops.groups.get(sel.dataset.group)) if (o.candidates.includes(sel.value)) set(o, sel.value);
    saveAssign();
    run();
});
$('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    store.set('hls.tab', tab);
    renderTab();
});

/** Texto da IR: a hierarquia de laços e, em cada trecho, as operações com faixa, unidade e ciclo. */
function irText(r) {
    const lines = [];
    const schedOf = new Map(r.segs.map((s) => [s.seg, s]));
    const arg = (a) => (a.n !== undefined ? `%${a.n}` : String(a.c));
    const walk = (region, ind) => {
        for (const it of region.items) {
            if (it.k === 'loop') {
                const L = it.region.loop;
                lines.push(`${ind}${t('hls.ir.loop', { name: loopName(L), v: L.v, trip: L.trip, mode: modeName(L.mode) })}${L.factor > 1 ? `, unroll ${L.factor}` : ''}${L.mode === 'pipelined' ? `, II ${L.IIachieved}` : ''}) {`);
                walk(it.region, `${ind}    `);
                lines.push(`${ind}}`);
            } else {
                const sg = schedOf.get(it.seg);
                lines.push(`${ind}${t('hls.ir.seg', { id: it.seg.id, d: sg.sch.depth })}`);
                for (const n of it.seg.nodes) {
                    const s = sg.sch.sched.get(n.id), me = sg.sch.info.get(n.id);
                    const ref = n.idx ? `${n.array}[${n.idx.map((x) => affSource(x, r.design.loops)).join('][')}]` : n.text;
                    const what = n.op === 'load' ? `load ${ref}` : n.op === 'store' ? `store ${ref} ← ${n.args.map(arg).join(', ')}` : n.op === 'carry' ? `φ ${n.name} ← %${n.carryFrom ?? '?'} (${t('hls.ir.prev')})` : n.op === 'iv' ? `iv ${affSource(n.aff, r.design.loops)}` : n.op === 'in' ? `in ${n.name ?? n.from}` : `${n.op}${n.cond ? ` ${n.cond}` : ''} ${n.args.map(arg).join(', ')}`;
                    const unit = me.unit ? me.unit.name : '';
                    const when = s ? `c${s.cycle}${me.multi ? `..${s.cycle + me.k - 1}` : me.cls === 'free' ? '' : ` +${(s.start / 1000).toFixed(2)}ns`}` : '';
                    lines.push(`${ind}  %${n.id.padEnd(8)} = ${what.padEnd(34)} [${n.range[0]}, ${n.range[1]}]`.padEnd(ind.length + 72) + ` ${unit.padEnd(14)} ${when}`);
                }
            }
        }
    };
    lines.push(`${r.design.name}: ${r.design.arrays.map((a) => `${a.name}[${a.dims.join('][')}] ${a.type.name}${a.kind === 'rom' ? ' const' : ''}${a.partition ? ` (${a.partition.type}${a.partition.type !== 'complete' ? ` ${a.partition.factor}` : ''}, dim ${a.partition.dim})` : ''}`).join(', ')}`);
    walk(r.design.top, '');
    return lines.join('\n');
}

// Idioma e tema ------------------------------------------------------------------------------------------------
const langSelect = $('lang-select');
langSelect.innerHTML = Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
function applyDomTranslations() {
    langSelect.value = getLanguage();
    document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'pt-BR';
    document.title = t('hls.docTitle');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    fillExamples();
    if (result) { fillSegments(); render(); } else renderTab();
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

// Início: código guardado ou o exemplo escolhido; os dados da biblioteca vêm de data/.
const savedCode = store.get('hls.code');
loadAssign();
$('code').value = $('example').value === 'custom' && savedCode ? savedCode : (KERNELS.find((k) => k.id === $('example').value) ?? KERNELS[0]).code;
paintCode();
Promise.all([fetch('data/synth.json').then((r) => r.json()), fetch('data/hls-cells.json').then((r) => r.json())])
    .then(([s, c]) => { synthData = s; cellsData = c; initLibrary(s, () => tab === 'lib'); run(); })
    .catch(() => { $('error').textContent = t('hls.noData'); });
