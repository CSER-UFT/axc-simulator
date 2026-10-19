/**
 * Exportação das figuras: ao passar o mouse sobre um gráfico SVG ou uma imagem em canvas, aparecem os botões SVG e
 * PNG no canto da figura. O SVG exportado leva os estilos calculados de cada elemento (as cores das classes do CSS e
 * das variáveis do tema), sempre no tema claro, com fundo branco, para abrir em qualquer editor ou entrar num texto.
 * Um canvas vira um SVG com a imagem embutida (os pixels não viram vetores) ou um PNG no tamanho original.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'paint-order', 'visibility'];
const MIN = 40;
const GRAPHIC = new Set(['g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'image', 'use', 'foreignObject']);

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'figura';

/** Nome do arquivo: a legenda, o título visível mais próximo antes da figura no mesmo painel, ou a aba ativa. */
function nameOf(el) {
    const cap = el.closest('figure')?.querySelector('figcaption')?.textContent;
    if (cap?.trim()) return slug(cap);
    const visible = (h) => h && h.offsetParent !== null && h.textContent.trim();
    const parts = [];
    outer: for (let n = el; n && n !== document.body; n = n.parentElement) {
        for (let p = n.previousElementSibling; p; p = p.previousElementSibling) {
            if (p.offsetParent === null) continue;
            const h = p.matches('h2, h3, h4') ? p : [...p.querySelectorAll('h2, h3, h4')].reverse().find(visible);
            if (visible(h)) { parts.push(h.textContent); break outer; }
        }
        if (n.matches('.pane, section, details')) break;
    }
    if (!parts.length) {
        const tab = document.querySelector('.tabs .sel');
        if (tab) parts.push(tab.textContent);
    }
    const box = el.closest('[id]');
    if (box && box !== el) parts.push(box.id.replace(/Fig$/, ''));
    const words = slug(parts.join(' ') || el.id || 'figura').split('_');
    return words.filter((w, k) => words.indexOf(w) === k).join('_');
}

function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Executa f com o tema claro aplicado, sem pintar a troca (tudo no mesmo passo do laço de eventos). */
function withLightTheme(f) {
    const root = document.documentElement, old = root.dataset.theme;
    root.dataset.theme = 'light';
    try { return f(); } finally { root.dataset.theme = old; }
}

/** Cópia do SVG com os estilos calculados escritos em cada elemento. */
export function standaloneSvg(svg) {
    return withLightTheme(() => {
        const clone = svg.cloneNode(true);
        const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
        const drop = [];
        src.forEach((el, k) => {
            const cs = getComputedStyle(el), out = dst[k];
            if (cs.display === 'none' && GRAPHIC.has(el.localName) && !el.closest('defs, marker, clipPath, mask, pattern, symbol')) { drop.push(out); return; }
            if (k === 0) return;
            const style = PROPS.map((p) => [p, cs.getPropertyValue(p)]).filter(([, v]) => v && v !== 'normal' && v !== 'auto').map(([p, v]) => `${p}:${v}`).join(';');
            out.setAttribute('style', style);
            out.removeAttribute('class');
        });
        for (const el of drop) el.remove();
        const r = svg.getBoundingClientRect();
        const w = svg.getAttribute('width') && !/%/.test(svg.getAttribute('width')) ? svg.getAttribute('width') : Math.round(r.width);
        const h = svg.getAttribute('height') && !/%/.test(svg.getAttribute('height')) ? svg.getAttribute('height') : Math.round(r.height);
        clone.setAttribute('xmlns', SVG_NS);
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);
        if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        const vb = clone.getAttribute('viewBox').split(/[\s,]+/).map(Number);
        const bg = document.createElementNS(SVG_NS, 'rect');
        bg.setAttribute('x', vb[0]); bg.setAttribute('y', vb[1]); bg.setAttribute('width', vb[2]); bg.setAttribute('height', vb[3]);
        bg.setAttribute('fill', '#ffffff');
        clone.insertBefore(bg, clone.firstChild);
        const font = getComputedStyle(svg).fontFamily;
        if (font) clone.setAttribute('font-family', font);
        return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone), w: +w, h: +h };
    });
}

/** SVG de um canvas: a imagem embutida em PNG, no tamanho em que aparece na página, sem suavização. */
export function canvasSvg(canvas) {
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width) || canvas.width, h = Math.round(r.height) || canvas.height;
    const data = canvas.toDataURL('image/png');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
        + `<image width="${w}" height="${h}" preserveAspectRatio="none" style="image-rendering:pixelated" href="${data}" xlink:href="${data}"/></svg>`;
}

async function svgToPng(svg, scale = 2) {
    const { text, w, h } = standaloneSvg(svg);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    return new Promise((res) => c.toBlob(res, 'image/png'));
}

export async function exportFigure(el, kind, name = nameOf(el)) {
    if (el instanceof HTMLCanvasElement) {
        if (kind === 'svg') download(`${name}.svg`, new Blob([canvasSvg(el)], { type: 'image/svg+xml' }));
        else el.toBlob((b) => download(`${name}.png`, b), 'image/png');
    } else if (kind === 'svg') download(`${name}.svg`, new Blob([standaloneSvg(el).text], { type: 'image/svg+xml' }));
    else download(`${name}.png`, await svgToPng(el));
}

/** Figura sob o ponteiro: o SVG mais externo ou o canvas, com tamanho de gráfico. */
function figureAt(target, scope) {
    if (!(target instanceof Element) || !scope.contains(target)) return null;
    let el = target.closest('canvas') ?? target.closest('svg');
    if (!el) return null;
    while (el.parentElement?.closest('svg')) el = el.parentElement.closest('svg');
    if (el.closest('button, .btn, [data-no-export]')) return null;
    const r = el.getBoundingClientRect();
    return r.width >= MIN && r.height >= MIN ? el : null;
}

/**
 * Liga a exportação a todas as figuras dentro de scope (por padrão, o main da página), inclusive as que forem
 * desenhadas depois. labels: { svg, png, title } nos textos do idioma atual (função, para trocar com o idioma).
 */
export function initFigureExport(labels, scope = document.querySelector('main') ?? document.body) {
    const bar = document.createElement('div');
    bar.className = 'fig-export';
    bar.hidden = true;
    bar.innerHTML = '<button type="button" data-kind="svg">SVG</button><button type="button" data-kind="png">PNG</button>';
    document.body.append(bar);
    let current = null, hideTimer = 0;

    const place = () => {
        if (!current?.isConnected) { bar.hidden = true; current = null; return; }
        const r = current.getBoundingClientRect();
        let right = Math.min(r.right, document.documentElement.clientWidth), top = Math.max(r.top, 0);
        // Dentro de uma caixa com rolagem, o canto visível da caixa.
        for (let n = current.parentElement; n && n !== document.body; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) {
                const b = n.getBoundingClientRect();
                right = Math.min(right, b.right); top = Math.max(top, b.top);
            }
        }
        bar.style.top = `${window.scrollY + top + 4}px`;
        bar.style.left = `${window.scrollX + right - bar.offsetWidth - 4}px`;
    };
    const show = (el) => {
        clearTimeout(hideTimer);
        if (el !== current) {
            current = el;
            const l = labels();
            bar.title = l.title;
            bar.querySelector('[data-kind="svg"]').title = l.svg;
            bar.querySelector('[data-kind="png"]').title = l.png;
        }
        bar.hidden = false;
        place();
    };
    const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { bar.hidden = true; current = null; }, 400); };

    scope.addEventListener('mouseover', (e) => {
        const el = figureAt(e.target, scope);
        if (el) show(el);
    });
    scope.addEventListener('mouseout', (e) => {
        if (!current) return;
        const to = e.relatedTarget;
        if (to && (bar.contains(to) || current.contains(to) || to === current)) return;
        hideSoon();
    });
    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    bar.addEventListener('mouseleave', hideSoon);
    bar.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-kind]');
        if (b && current) exportFigure(current, b.dataset.kind);
    });
    window.addEventListener('scroll', () => current && place(), { passive: true, capture: true });
    window.addEventListener('resize', () => current && place());
    return { exportFigure };
}
