/**
 * Figuras: diagrama de pontos dos produtos parciais, diagrama de bits do somador, histograma do erro,
 * mapa de calor do erro (canvas) e gráfico de Pareto. As cores das figuras SVG vêm de classes do CSS, para
 * acompanharem o tema claro ou escuro.
 */

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3));

/** Diagrama de pontos do multiplicador: um ponto por produto parcial a_i b_j, na coluna i + j. */
export function dotDiagram(unit) {
    const N = unit.cfg.width, C = 2 * N;
    const rows = unit.rows ?? Array.from({ length: N }, (_, j) => `b${j}`);
    const NR = rows.length;
    const D = N <= 8 ? 22 : 13, R = N <= 8 ? 7 : 4.2;
    const left = 52, top = 34;
    const width = Math.max(left + C * D + 20, 580), height = top + NR * D + 40;
    const x = (c) => left + (C - 1 - c) * D + D / 2;
    let s = `<svg class="fig-svg dots" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    // Faixas das zonas.
    (unit.zones ?? []).forEach((z, c) => {
        if (z !== 'exact') s += `<rect class="band z-${z}" x="${x(c) - D / 2}" y="${top - 6}" width="${D}" height="${NR * D + 8}"/>`;
    });
    for (let c = 0; c < C; c++) {
        if (N <= 8 || c % 2 === 0) s += `<text class="small muted mono" x="${x(c)}" y="${top - 12}" text-anchor="middle">${c}</text>`;
    }
    s += `<text class="small muted" x="4" y="${top - 12}">coluna</text>`;
    rows.forEach((label, j) => {
        s += `<text class="small muted mono" x="${left - 8}" y="${top + j * D + D / 2 + 4}" text-anchor="end">${esc(label)}</text>`;
    });
    for (const d of unit.dots) {
        const cx = x(d.c), cy = top + d.row * D + D / 2;
        s += `<circle class="dot z-${d.zone}${d.cls ? ` ${d.cls}` : ''}" cx="${cx}" cy="${cy}" r="${R}"><title>coluna ${d.c}</title></circle>`;
    }
    const ly = top + NR * D + 22;
    const lg = unit.method === 'kulkarni' ? [['exact', 'bloco exato'], ['approx', 'bloco aproximado']]
        : unit.method === 'booth' ? [['exact', 'produto parcial'], ['exact ext', 'extensão de sinal'], ['trunc', 'truncada (sem porta)']]
            : [['exact', 'exata'], ['approx', 'compressor aproximado e OR'], ['trunc', 'truncada (sem porta)']];
    let lx = left;
    for (const [z, t] of lg) {
        s += `<circle class="dot z-${z}" cx="${lx + 6}" cy="${ly - 4}" r="6"/><text class="small" x="${lx + 16}" y="${ly}">${t}</text>`;
        lx += 30 + t.length * 6.4;
    }
    return `${s}</svg>`;
}

/** Custo de cada etapa do circuito, em portas, como uma cadeia de caixas. */
export function stagesSvg(unit) {
    const st = unit.stages ?? [];
    if (!st.length) return '';
    const total = st.reduce((s2, x) => s2 + x.gates, 0) || 1;
    const W = 150, H = 70, gap = 26, top = 30;
    const width = Math.max(580, 20 + st.length * (W + gap)), height = top + H + 24;
    let s = `<svg class="fig-svg stages" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    s += `<text class="small muted" x="10" y="18">custo de cada etapa (portas)</text>`;
    st.forEach((x, k) => {
        const x0 = 10 + k * (W + gap);
        const frac = x.gates / total;
        s += `<rect class="stage" x="${x0}" y="${top}" width="${W}" height="${H}" rx="6"/>`;
        s += `<rect class="stage-bar" x="${x0}" y="${top + H - 8}" width="${Math.max(2, W * frac)}" height="8" rx="2"/>`;
        const words = x.label.split(' ');
        const lines = [];
        let cur = '';
        for (const w of words) { if ((cur + ' ' + w).trim().length > 22) { lines.push(cur.trim()); cur = w; } else cur += ` ${w}`; }
        if (cur.trim()) lines.push(cur.trim());
        lines.slice(0, 3).forEach((l, i) => { s += `<text class="small" x="${x0 + 8}" y="${top + 16 + i * 13}">${esc(l)}</text>`; });
        s += `<text class="small mono bold" x="${x0 + W - 8}" y="${top + H - 14}" text-anchor="end">${x.gates}</text>`;
        if (k < st.length - 1) s += `<path class="arrow" d="M${x0 + W + 4},${top + H / 2} h${gap - 10}"/><polygon class="arrowhead" points="${x0 + W + gap - 6},${top + H / 2 - 4} ${x0 + W + gap - 1},${top + H / 2} ${x0 + W + gap - 6},${top + H / 2 + 4}"/>`;
    });
    return `${s}</svg>`;
}

/** Diagrama do somador: os bits de a e b em colunas, a zona de cada coluna e os blocos do segmentado. */
export function adderDiagram(unit) {
    const N = unit.cfg.width, D = N <= 8 ? 34 : 24;
    const left = 46, top = 30;
    const width = Math.max(left + (N + 1) * D + 20, 620), height = top + 4 * D + 34;
    const x = (c) => left + (N - c) * D + D / 2;
    let s = `<svg class="fig-svg dots" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    unit.zones.forEach((z, c) => {
        if (z !== 'exact') s += `<rect class="band z-${z}" x="${x(c) - D / 2}" y="${top - 6}" width="${D}" height="${3 * D + 8}"/>`;
    });
    const cfg = unit.cfg;
    if (cfg.adder === 'seg') {
        // Blocos e janela de previsão do vem um de cada bloco.
        const L = cfg.L, P = cfg.P;
        for (let lo = 0; lo < N; lo += L) {
            const hi = Math.min(N, lo + L) - 1;
            s += `<rect class="block" x="${x(hi) - D / 2 + 2}" y="${top - 4}" width="${(hi - lo + 1) * D - 4}" height="${3 * D + 4}" rx="6"/>`;
            if (lo > 0 && P > 0) {
                const p0 = Math.max(0, lo - P);
                const y = top + 3 * D + 14;
                s += `<path class="pred" d="M${x(lo - 1) + D / 2 - 3},${y} L${x(p0) - D / 2 + 3},${y}"/>`;
                s += `<path class="pred" d="M${x(lo) },${top + 3 * D} L${x(lo)},${y} L${x(lo - 1) + D / 2 - 3},${y}"/>`;
            }
        }
    }
    for (let c = 0; c <= N; c++) s += `<text class="small muted mono" x="${x(c)}" y="${top - 12}" text-anchor="middle">${c}</text>`;
    const rows = [['a', N], ['b', N], ['s', N + 1]];
    rows.forEach(([name, n], r) => {
        s += `<text class="small muted mono" x="${left - 10}" y="${top + r * D + D / 2 + 4}" text-anchor="end">${name}</text>`;
        for (let c = 0; c < n; c++) {
            const z = c < N ? unit.zones[c] : 'exact';
            s += `<circle class="dot z-${r === 2 ? z : 'exact'}" cx="${x(c)}" cy="${top + r * D + D / 2}" r="${N <= 8 ? 8 : 6}"/>`;
        }
    });
    const ly = top + 4 * D + 22;
    const note = cfg.adder === 'seg' ? 'blocos com vem um previsto pelos P bits anteriores (setas)'
        : cfg.adder === 'loa' ? 'bits baixos: OR (sem vai um); vem um da parte exata: AND do bit k − 1'
            : cfg.adder === 'trunc' ? 'bits baixos da soma em 0, sem vem um para a parte exata' : 'propagação de vai um em todas as colunas';
    s += `<text class="small" x="${left}" y="${ly}">${esc(note)}</text>`;
    return `${s}</svg>`;
}

/** Histograma do erro com sinal. */
export function histogramSvg(h, { log = true, width = 560, height = 220 } = {}) {
    const L = 54, B = 34, T = 12, Rm = 12;
    const W = width - L - Rm, H = height - T - B;
    const max = Math.max(...h.counts);
    const y = (c) => {
        if (c <= 0) return T + H;
        const t = log ? Math.log10(c + 1) / Math.log10(max + 1) : c / max;
        return T + H - t * H;
    };
    const bw = W / h.counts.length;
    let s = `<svg class="fig-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    s += `<line class="axis" x1="${L}" y1="${T + H}" x2="${L + W}" y2="${T + H}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + H}"/>`;
    h.counts.forEach((c, k) => {
        const lo = h.lo + k * h.width, hi = lo + h.width;
        const zero = lo <= 0 && hi > 0;
        s += `<rect class="bar${zero ? ' zero' : ''}" x="${L + k * bw + 0.5}" y="${y(c)}" width="${Math.max(1, bw - 1)}" height="${T + H - y(c)}"><title>[${fmt(lo)}, ${fmt(hi)}): ${c}</title></rect>`;
    });
    [[h.lo, 'start'], [0, 'middle'], [h.hi, 'end']].forEach(([v, anchor]) => {
        const px = L + ((v - h.lo) / (h.hi - h.lo || 1)) * W;
        s += `<text class="small muted mono" x="${px}" y="${T + H + 16}" text-anchor="${anchor}">${fmt(v)}</text>`;
    });
    s += `<text class="small muted" x="${L + W / 2}" y="${height - 4}" text-anchor="middle">erro (aproximado − exato)</text>`;
    s += `<text class="small muted mono" x="${L - 6}" y="${T + 8}" text-anchor="end">${max}</text>`;
    s += `<text class="small muted" x="${12}" y="${T + H / 2}" text-anchor="middle" transform="rotate(-90 12 ${T + H / 2})">pares${log ? ' (log)' : ''}</text>`;
    return `${s}</svg>`;
}

/** Cor de uma rampa sequencial (claro para escuro, passando por amarelo, laranja e roxo). */
const RAMP = [[252, 253, 191], [254, 176, 120], [241, 96, 93], [183, 55, 121], [114, 31, 129], [44, 17, 95]];
export function rampColor(t) {
    const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
    return RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
}

/** Mapa de calor do erro numa tela (canvas): linhas = a, colunas = b. */
export function drawHeatmap(canvas, g, { zeroColor = [255, 255, 255] } = {}) {
    const { G, grid } = g;
    canvas.width = G;
    canvas.height = G;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(G, G);
    let max = 0;
    for (const v of grid) if (v > max) max = v;
    const lmax = Math.log1p(max);
    for (let p = 0; p < G * G; p++) {
        const c = grid[p] === 0 ? zeroColor : rampColor(Math.log1p(grid[p]) / (lmax || 1));
        img.data.set([c[0], c[1], c[2], 255], 4 * p);
    }
    ctx.putImageData(img, 0, 0);
    return max;
}

/** Legenda da rampa do mapa de calor. */
export function rampLegend(max) {
    const stops = RAMP.map((c, k) => `<stop offset="${(100 * k) / (RAMP.length - 1)}%" stop-color="rgb(${c.join(',')})"/>`).join('');
    const mid = Math.round(Math.expm1(Math.log1p(max) / 2));
    return `<svg class="fig-svg" xmlns="http://www.w3.org/2000/svg" width="260" height="34" viewBox="0 0 260 34"><defs><linearGradient id="rampg">${stops}</linearGradient></defs>`
        + `<rect x="10" y="4" width="240" height="10" fill="url(#rampg)" stroke="currentColor" stroke-opacity=".3"/>`
        + `<text class="small muted mono" x="10" y="28">1</text><text class="small muted mono" x="130" y="28" text-anchor="middle">${fmt(mid)}</text>`
        + `<text class="small muted mono" x="250" y="28" text-anchor="end">${fmt(max)}</text></svg>`;
}

/**
 * Gráfico de Pareto: custo no eixo x, erro no eixo y.
 * @param {Array<{x: number, y: number, label: string, current?: boolean}>} pts
 * @param {number[]} front índices dos pontos não dominados
 */
export function paretoSvg(pts, front, { xLabel, yLabel, logY = false, knee = null, width = 620, height = 360 } = {}) {
    const L = 84, B = 44, T = 14, R = 90;
    const W = width - L - R, H = height - T - B;
    let s = `<svg class="fig-svg pareto" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    if (!pts.length) return `${s}<text class="small muted" x="${width / 2}" y="${height / 2}" text-anchor="middle">Adicione configurações à comparação.</text></svg>`;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const ty = (v) => (logY ? Math.log10(v + 1e-9) : v);
    const posY = ys.filter((v) => !logY || v > 0);
    const y0 = logY ? ty(Math.min(...posY.length ? posY : [1e-6])) : 0, y1 = ty(Math.max(...ys, 1e-9));
    const X = (v) => L + (x1 === x0 ? W / 2 : ((v - x0) / (x1 - x0)) * W * 0.92 + W * 0.04);
    const Y = (v) => {
        if (logY && v <= 0) return T + H;
        return T + H - (y1 === y0 ? H / 2 : ((ty(v) - y0) / (y1 - y0)) * H * 0.9 + H * 0.05);
    };
    s += `<line class="axis" x1="${L}" y1="${T + H}" x2="${L + W}" y2="${T + H}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + H}"/>`;
    for (const v of [x0, (x0 + x1) / 2, x1]) s += `<text class="small muted mono" x="${X(v)}" y="${T + H + 16}" text-anchor="middle">${fmt(v)}</text>`;
    const yTicks = logY ? [10 ** y0, 10 ** ((y0 + y1) / 2), 10 ** y1] : [0, Math.max(...ys) / 2, Math.max(...ys)];
    for (const v of yTicks) s += `<text class="small muted mono" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    s += `<text class="small muted" x="${L + W / 2}" y="${height - 6}" text-anchor="middle">${esc(xLabel)}</text>`;
    s += `<text class="small muted" x="14" y="${T + H / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + H / 2})">${esc(yLabel)}${logY ? ' (log)' : ''}</text>`;
    // Fronteira em degraus.
    const f = [...front].sort((i, j) => pts[i].x - pts[j].x);
    if (f.length > 1) {
        let d = `M${X(pts[f[0]].x)},${Y(pts[f[0]].y)}`;
        for (let k = 1; k < f.length; k++) d += ` H${X(pts[f[k]].x)} V${Y(pts[f[k]].y)}`;
        s += `<path class="front" d="${d}"/>`;
    }
    const onFront = new Set(front);
    const placed = [];
    // Rótulos dos pontos da fronteira e do atual, sem sobrepor (o atual tem prioridade).
    const order = pts.map((p, i) => i).sort((i, j) => (pts[j].current ? 1 : 0) - (pts[i].current ? 1 : 0));
    const labelled = new Set();
    for (const i of order) {
        if (!onFront.has(i) && !pts[i].current) continue;
        const lx = X(pts[i].x) + 8, ly = Y(pts[i].y) - 6, lw = pts[i].label.length * 6.6;
        if (placed.some((r) => lx < r.x + r.w && r.x < lx + lw && Math.abs(ly - r.y) < 13)) continue;
        placed.push({ x: lx, y: ly, w: lw });
        labelled.add(i);
    }
    if (knee !== null) s += `<circle class="knee" cx="${X(pts[knee].x)}" cy="${Y(pts[knee].y)}" r="11"/><text class="small bold" x="${X(pts[knee].x) - 12}" y="${Y(pts[knee].y) + 22}" text-anchor="end">joelho</text>`;
    pts.forEach((p, i) => {
        s += `<g><circle class="pt${onFront.has(i) ? ' front' : ''}${p.current ? ' cur' : ''}" cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.current ? 7 : 5}"><title>${esc(p.label)}: ${fmt(p.x)}, ${fmt(p.y)}</title></circle>`;
        if (labelled.has(i)) s += `<text class="small mono" x="${X(p.x) + 8}" y="${Y(p.y) - 6}">${esc(p.label)}</text>`;
        s += '</g>';
    });
    return `${s}</svg>`;
}

/** Diferença entre duas imagens, colorida com a rampa do mapa de erro (escala log; preto é zero). */
export function drawDiff(canvas, x, y) {
    canvas.width = x.w;
    canvas.height = x.h;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(x.w, x.h);
    let max = 0;
    for (let k = 0; k < x.data.length; k++) max = Math.max(max, Math.abs(x.data[k] - y.data[k]));
    for (let k = 0; k < x.data.length; k++) {
        const d = Math.abs(x.data[k] - y.data[k]);
        const c = d === 0 ? [0, 0, 0] : rampColor(Math.log1p(d) / Math.log1p(max || 1));
        out.data.set([c[0], c[1], c[2], 255], 4 * k);
    }
    ctx.putImageData(out, 0, 0);
    return max;
}

/** Desenha uma imagem em tons de cinza numa tela. */
export function drawGray(canvas, img) {
    canvas.width = img.w;
    canvas.height = img.h;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(img.w, img.h);
    for (let k = 0; k < img.data.length; k++) out.data.set([img.data[k], img.data[k], img.data[k], 255], 4 * k);
    ctx.putImageData(out, 0, 0);
}

/**
 * Dispersão simples com grupos (cada grupo com a sua classe de cor) e o ponto atual em destaque.
 * @param {Array<{x: number, y: number, label: string, group: string, current?: boolean}>} pts
 */
export function scatterSvg(pts, { xLabel, yLabel, width = 520, height = 340, logX = true, logY = true } = {}) {
    const L = 64, B = 44, T = 14, R = 24;
    const W = width - L - R, H = height - T - B;
    let s = `<svg class="fig-svg scatter" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    if (!pts.length) return `${s}<text class="small muted" x="${width / 2}" y="${height / 2}" text-anchor="middle">Sem dados de síntese.</text></svg>`;
    const tx = (v) => (logX ? Math.log10(Math.max(v, 1)) : v), ty = (v) => (logY ? Math.log10(Math.max(v, 1)) : v);
    const xs = pts.map((p) => tx(p.x)), ys = pts.map((p) => ty(p.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = (v) => L + (x1 === x0 ? W / 2 : ((tx(v) - x0) / (x1 - x0)) * W * 0.92 + W * 0.04);
    const Y = (v) => T + H - (y1 === y0 ? H / 2 : ((ty(v) - y0) / (y1 - y0)) * H * 0.9 + H * 0.05);
    s += `<line class="axis" x1="${L}" y1="${T + H}" x2="${L + W}" y2="${T + H}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + H}"/>`;
    const ticks = (a, b, lg) => (lg ? [10 ** a, 10 ** ((a + b) / 2), 10 ** b] : [a, (a + b) / 2, b]);
    for (const v of ticks(x0, x1, logX)) s += `<text class="small muted mono" x="${X(v)}" y="${T + H + 16}" text-anchor="middle">${fmt(Math.round(v))}</text>`;
    for (const v of ticks(y0, y1, logY)) s += `<text class="small muted mono" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(Math.round(v))}</text>`;
    s += `<text class="small muted" x="${L + W / 2}" y="${height - 6}" text-anchor="middle">${esc(xLabel)}${logX ? ' (log)' : ''}</text>`;
    s += `<text class="small muted" x="14" y="${T + H / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + H / 2})">${esc(yLabel)}${logY ? ' (log)' : ''}</text>`;
    for (const p of pts) {
        s += `<circle class="pt g-${p.group}${p.current ? ' cur' : ''}" cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.current ? 7 : 5}"><title>${esc(p.label)}: ${fmt(p.x)}, ${fmt(p.y)}</title></circle>`;
    }
    const groups = [...new Set(pts.map((p) => p.group))];
    groups.forEach((g, k) => {
        const lx = L + 12 + (k % 2) * 190, ly = T + 6 + Math.floor(k / 2) * 15;
        s += `<circle class="pt g-${g}" cx="${lx}" cy="${ly}" r="5"/><text class="small" x="${lx + 10}" y="${ly + 4}">${esc(g.replace(/(\d+)/, ' $1 bits').replace('mul', 'multiplicador').replace('add', 'somador'))}</text>`;
    });
    return `${s}</svg>`;
}

/**
 * Gráfico de linhas: x contínuo, várias séries (cada uma com a sua classe de cor), uma linha vertical opcional.
 * @param {Array<{name: string, cls: string, pts: Array<{x: number, y: number}>}>} series
 */
export function lineChartSvg(series, { xLabel, yLabel, marker = null, logY = false, logX = false, width = 560, height = 300, xReverse = false, xTicks = null } = {}) {
    // Legenda em linhas, quebrando quando não cabe na largura.
    const items = [];
    let lx = 0, row = 0;
    for (const sr of series) {
        const wItem = 40 + sr.name.length * 6.6;
        if (lx && lx + wItem > width - 80) { lx = 0; row++; }
        items.push({ x: lx, row });
        lx += wItem + 14;
    }
    const L = 64, B = 44, T = 26 + 16 * row, R = 20;
    const W = width - L - R, H = height - T - B;
    const all = series.flatMap((s2) => s2.pts);
    let s = `<svg class="fig-svg line" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    if (!all.length) return `${s}</svg>`;
    const ty = (v) => (logY ? Math.log10(Math.max(v, 1e-6)) : v);
    const tx = (v) => (logX ? Math.log10(v) : v);
    const xs = all.map((p) => tx(p.x)), ys = all.map((p) => ty(p.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = logY ? Math.floor(Math.min(...ys)) : 0, y1 = logY ? Math.ceil(Math.max(...ys)) : Math.max(...ys, 1e-9);
    const X = (v) => L + ((xReverse ? x1 - tx(v) : tx(v) - x0) / ((x1 - x0) || 1)) * W;
    const Y = (v) => T + H - ((ty(v) - y0) / ((y1 - y0) || 1)) * H;
    s += `<line class="axis" x1="${L}" y1="${T + H}" x2="${L + W}" y2="${T + H}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + H}"/>`;
    const xt = xTicks ?? (logX ? [10 ** x0, 10 ** ((x0 + x1) / 2), 10 ** x1] : [x0, (x0 + x1) / 2, x1]);
    for (const v of xt) s += `<text class="small muted mono" x="${X(v)}" y="${T + H + 16}" text-anchor="middle">${fmt(+v.toFixed(2))}</text>`;
    const yt = logY ? Array.from({ length: y1 - y0 + 1 }, (_, k) => 10 ** (y0 + k)) : [0, y1 / 2, y1];
    for (const v of yt) {
        s += `<text class="small muted mono" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${logY ? `1e${Math.round(Math.log10(v))}` : fmt(v)}</text>`;
        if (logY) s += `<line class="grid" x1="${L}" y1="${Y(v)}" x2="${L + W}" y2="${Y(v)}"/>`;
    }
    s += `<text class="small muted" x="${L + W / 2}" y="${height - 6}" text-anchor="middle">${esc(xLabel)}</text>`;
    s += `<text class="small muted" x="14" y="${T + H / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + H / 2})">${esc(yLabel)}${logY ? ' (log)' : ''}</text>`;
    if (marker !== null) s += `<line class="marker" x1="${X(marker)}" y1="${T}" x2="${X(marker)}" y2="${T + H}"/>`;
    series.forEach((sr, k) => {
        const d = sr.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
        s += `<path class="series ${sr.cls}" d="${d}"/>`;
        if (sr.dots) for (const p of sr.pts) s += `<circle class="series-dot ${sr.cls}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.5"/>`;
        const it = items[k], ly = 14 + 16 * it.row;
        s += `<line class="series ${sr.cls}" x1="${L + 8 + it.x}" y1="${ly}" x2="${L + 30 + it.x}" y2="${ly}"/><text class="small" x="${L + 36 + it.x}" y="${ly + 4}">${esc(sr.name)}</text>`;
    });
    return `${s}</svg>`;
}
