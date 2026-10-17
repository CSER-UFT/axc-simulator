/**
 * Página de síntese de alto nível: o kernel, as opções, e o relatório, o escalonamento, o DFG e a IR do resultado.
 */
import { synthesize, MODEL } from './hls/index.js';
import { KERNELS } from './hls/kernels.js';
import { ganttSvg, dfgSvg } from './hls/ui.js';
import { esc } from './ui/plots.js';
import { LANGUAGES, getLanguage, setLanguage, t, locale } from './i18n/index.js';

const $ = (id) => document.getElementById(id);
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};
const nf = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '-' : v.toLocaleString(locale(), { maximumFractionDigits: d, minimumFractionDigits: 0 }));

let synthData = null, cellsData = null, result = null, tab = store.get('hls.tab') ?? 'report';

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
    if (k) { $('code').value = k.code; store.set('hls.code', ''); run(); }
});
$('code').addEventListener('input', () => { $('example').value = 'custom'; store.set('hls.example', 'custom'); store.set('hls.code', $('code').value); });
$('code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target, s = ta.selectionStart;
        ta.value = `${ta.value.slice(0, s)}    ${ta.value.slice(ta.selectionEnd)}`;
        ta.selectionStart = ta.selectionEnd = s + 4;
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
        result = synthesize($('code').value, { synth: synthData, cells: cellsData, clockNs: +$('clock').value, flow: $('flow').value, ports: +$('ports').value });
    } catch (e) {
        result = null;
        $('error').textContent = e.message;
        return;
    }
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
    for (const b of $('tabs').querySelectorAll('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('hidden', p.id !== `pane-${tab}`);
    if (!result) return;
    const sg = result.segs[+$('segSel').value] ?? result.segs[0];
    if (tab === 'sched' && sg) {
        $('gantt').innerHTML = ganttSvg(sg.sch, { clockPs: result.totals.clockPs, pipelined: sg.pipelined });
        $('segInfo').textContent = t('hls.segInfo', { depth: sg.sch.depth, execs: nf(sg.execs), tc: nf(sg.sch.Tc), ov: sg.sch.overhead });
    }
    if (tab === 'dfg' && sg) $('dfg').innerHTML = dfgSvg(sg.seg, sg.sch);
    if (tab === 'ir') $('ir').textContent = irText(result);
}
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
                    const what = n.op === 'load' ? `load ${n.text}` : n.op === 'store' ? `store ${n.text} ← ${n.args.map(arg).join(', ')}` : n.op === 'carry' ? `φ ${n.name} ← %${n.carryFrom ?? '?'} (${t('hls.ir.prev')})` : n.op === 'iv' ? `iv ${n.text}` : n.op === 'in' ? `in ${n.name ?? n.from}` : `${n.op}${n.cond ? ` ${n.cond}` : ''} ${n.args.map(arg).join(', ')}`;
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
    if (result) { fillSegments(); render(); }
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
$('code').value = $('example').value === 'custom' && savedCode ? savedCode : (KERNELS.find((k) => k.id === $('example').value) ?? KERNELS[0]).code;
Promise.all([fetch('data/synth.json').then((r) => r.json()), fetch('data/hls-cells.json').then((r) => r.json())])
    .then(([s, c]) => { synthData = s; cellsData = c; run(); })
    .catch(() => { $('error').textContent = t('hls.noData'); });
