/**
 * Diagrama da arquitetura de uma rede (js/axc/nn.js) em SVG, no estilo LeNet do NN SVG (A. LeNail, 2019): cada tensor
 * de três dimensões é uma pilha de planos em perspectiva, com o núcleo da convolução (ou a janela do pooling) ligado
 * ao ponto que ele produz na camada seguinte; os vetores (flatten e camadas densas) são barras, ligadas por faixas.
 * Acima de cada tensor, o nome da camada; abaixo, a forma; na linha de baixo, a operação entre dois tensores.
 * As cores vêm das classes do CSS (css/axc.css), então seguem o tema; a exportação leva os estilos calculados.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f1 = (v) => Math.round(v * 10) / 10;

/**
 * @param {object} net rede decodificada (decodeNet)
 * @param {object} o labels: {input, conv, pool, flatten, dense, output}; maxPlanes (padrão 16)
 * @returns {string} SVG
 */
export function archSvg(net, o = {}) {
    const lb = { input: 'input', conv: 'conv', pool: 'max pool', flatten: 'flatten', dense: 'dense', ...(o.labels ?? {}) };
    const maxPlanes = o.maxPlanes ?? 16;
    // Tensores: a entrada e a saída de cada camada.
    const items = [{ shape: net.dataset.shape, name: lb.input, op: null }];
    let pools = 0;
    for (const l of net.layers) {
        const name = l.type === 'maxpool' ? `pool${++pools}` : l.type === 'flatten' ? lb.flatten : l.name;
        const op = l.type === 'conv' ? `${lb.conv} ${l.k}×${l.k}${l.pad ? `, p${l.pad}` : ''}${(l.stride ?? 1) > 1 ? `, s${l.stride}` : ''}`
            : l.type === 'maxpool' ? `${lb.pool} ${l.size}×${l.size}` : l.type === 'flatten' ? lb.flatten : lb.dense;
        items.push({ shape: l.outShape, name, op, layer: l });
    }
    const is3d = (it) => it.shape.length === 3;
    const maxHW = Math.max(...items.filter(is3d).map((it) => Math.max(it.shape[1], it.shape[2])));
    const sc = Math.min(4, Math.max(1.4, 112 / maxHW));
    const geo = items.map((it) => {
        if (is3d(it)) {
            const [C, H, W] = it.shape, n = Math.min(C, maxPlanes);
            const d = n > 1 ? Math.min(7, 64 / (n - 1)) : 0;
            const w = Math.max(8, W * sc), h = Math.max(8, H * sc);
            return { n, d, w, h, W: w + (n - 1) * d, H: h + (n - 1) * d };
        }
        const N = it.shape[0];
        const h = Math.min(150, Math.max(18, Math.sqrt(N) * 6));
        return { n: 1, d: 0, w: 12, h, W: 12, H: h };
    });
    const top = 26, bodyH = Math.max(...geo.map((g) => g.H)), cy = top + bodyH / 2;
    const gap = 64;
    let x = 14;
    for (const g of geo) { g.x = x; g.y = cy - g.H / 2; x += g.W + gap; }
    const width = x - gap + 14, height = top + bodyH + 60;
    const out = [];
    const front = (g) => ({ x: g.x + (g.n - 1) * g.d, y: g.y + (g.n - 1) * g.d, w: g.w, h: g.h });
    // Faixas e ligações primeiro (ficam atrás dos tensores).
    for (let i = 1; i < items.length; i++) {
        const a = geo[i - 1], b = geo[i], A = front(a), B = front(b);
        if (is3d(items[i - 1]) && is3d(items[i])) continue;              // ligações do núcleo vêm depois dos planos
        // Para um vetor: faixa do lado direito do tensor anterior até a barra.
        out.push(`<polygon class="nn-band" points="${f1(A.x + A.w)},${f1(A.y)} ${f1(B.x)},${f1(B.y)} ${f1(B.x)},${f1(B.y + B.h)} ${f1(A.x + A.w)},${f1(A.y + A.h)}"/>`);
    }
    // Tensores.
    items.forEach((it, i) => {
        const g = geo[i];
        if (is3d(it)) {
            for (let p = 0; p < g.n; p++) {
                const cls = p === g.n - 1 ? 'nn-plane nn-front' : 'nn-plane';
                out.push(`<rect class="${cls}" x="${f1(g.x + p * g.d)}" y="${f1(g.y + p * g.d)}" width="${f1(g.w)}" height="${f1(g.h)}"/>`);
            }
            if (it.shape[0] > g.n) {
                const F = front(g);
                out.push(`<text class="nn-note" x="${f1(F.x + F.w)}" y="${f1(g.y - 2)}" text-anchor="end">${g.n}/${it.shape[0]}</text>`);
            }
        } else {
            out.push(`<rect class="nn-vec" x="${f1(g.x)}" y="${f1(g.y)}" width="${f1(g.w)}" height="${f1(g.h)}"/>`);
        }
        const cx = g.x + g.W / 2;
        const dims = is3d(it) ? `${it.shape[0]}@${it.shape[1]}×${it.shape[2]}` : `${it.shape[0]}`;
        out.push(`<text class="nn-name" x="${f1(cx)}" y="${top - 10}" text-anchor="middle">${esc(it.name)}</text>`);
        out.push(`<text class="nn-dims" x="${f1(cx)}" y="${f1(top + bodyH + 16)}" text-anchor="middle">${esc(dims)}</text>`);
    });
    // Núcleo (ou janela) no plano da frente do tensor anterior, ligado ao ponto que ele produz no seguinte.
    for (let i = 1; i < items.length; i++) {
        if (!(is3d(items[i - 1]) && is3d(items[i]))) continue;
        const l = items[i].layer, A = front(geo[i - 1]), B = front(geo[i]);
        const k = l.type === 'conv' ? l.k : l.size;
        const kw = Math.max(4, k * sc * (A.w / Math.max(8, items[i - 1].shape[2] * sc)));
        const kx = A.x + A.w * 0.62 - kw / 2, ky = A.y + A.h * 0.3 - kw / 2;
        const pw = Math.max(2.5, sc * (B.w / Math.max(8, items[i].shape[2] * sc)));
        const px = B.x + B.w * 0.62 - pw / 2, py = B.y + B.h * 0.3 - pw / 2;
        out.push(`<rect class="nn-kernel" x="${f1(kx)}" y="${f1(ky)}" width="${f1(kw)}" height="${f1(kw)}"/>`);
        out.push(`<rect class="nn-kernel" x="${f1(px)}" y="${f1(py)}" width="${f1(pw)}" height="${f1(pw)}"/>`);
        out.push(`<line class="nn-link" x1="${f1(kx + kw)}" y1="${f1(ky)}" x2="${f1(px)}" y2="${f1(py)}"/>`);
        out.push(`<line class="nn-link" x1="${f1(kx + kw)}" y1="${f1(ky + kw)}" x2="${f1(px)}" y2="${f1(py + pw)}"/>`);
    }
    // Operações, nas linhas de baixo, entre os tensores (alternando duas linhas para os nomes não se encostarem).
    for (let i = 1; i < items.length; i++) {
        const a = geo[i - 1], b = geo[i];
        const mx = (a.x + a.W + b.x) / 2;
        out.push(`<line class="nn-tick" x1="${f1(mx)}" y1="${f1(top + bodyH + 22)}" x2="${f1(mx)}" y2="${f1(top + bodyH + (i % 2 ? 28 : 42))}"/>`);
        out.push(`<text class="nn-op" x="${f1(mx)}" y="${f1(top + bodyH + (i % 2 ? 38 : 52))}" text-anchor="middle">${esc(items[i].op)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" class="nn-arch" viewBox="0 0 ${f1(width)} ${f1(height)}" width="${f1(width)}" height="${f1(height)}" role="img" aria-label="${esc(net.name)}">${out.join('')}</svg>`;
}
