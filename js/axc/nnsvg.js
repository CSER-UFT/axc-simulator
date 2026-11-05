/**
 * Diagrama da arquitetura de uma rede (js/axc/nn.js) em SVG, no estilo LeNet do NN SVG (A. LeNail, 2019): cada tensor
 * de três dimensões é uma pilha de planos em perspectiva, com o núcleo da convolução (ou a janela do pooling) ligado
 * ao ponto que ele produz na camada seguinte; os vetores (flatten e camadas densas) são barras, ligadas por faixas.
 * Acima de cada tensor, o nome da camada; abaixo, a forma; na linha de baixo, a operação entre dois tensores.
 * As cores vêm das classes do CSS (css/axc.css), então seguem o tema; a exportação leva os estilos calculados.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f1 = (v) => Math.round(v * 10) / 10;

/** Rótulo da operação de uma camada (a borda em lista só quando os lados diferem). */
function opLabel(l, lb) {
    if (l.type === 'conv') {
        const p = l.pads ?? [l.pad ?? 0, l.pad ?? 0, l.pad ?? 0, l.pad ?? 0];
        const pad = p.every((v) => v === p[0]) ? (p[0] ? `, p${p[0]}` : '') : `, p${p.join(',')}`;
        return `${lb.conv} ${l.k}×${l.k}${pad}${(l.stride ?? 1) > 1 ? `, s${l.stride}` : ''}`;
    }
    if (l.type === 'maxpool') return `${lb.pool} ${l.size}×${l.size}`;
    if (l.type === 'avgpool') return `${lb.avgpool} ${l.size}×${l.size}`;
    if (l.type === 'flatten') return lb.flatten;
    if (l.type === 'add') return lb.add;
    return lb.dense;
}

/**
 * @param {object} net rede decodificada (decodeNet)
 * @param {object} o labels: {input, conv, pool, avgpool, flatten, dense, add, output}; maxPlanes (padrão 16)
 * @returns {string} SVG
 *
 * Redes com ramos (a ResNet 8): o caminho principal fica na linha, e cada soma residual é um círculo ⊕ entre o tensor
 * do ramo principal e a camada seguinte; o atalho é um arco por cima, da origem até o ⊕, com uma caixa com o nome e a
 * operação quando o atalho tem uma convolução (1 × 1 de passo 2); sem caixa, é a identidade.
 */
export function archSvg(net, o = {}) {
    const lb = { input: 'input', conv: 'conv', pool: 'max pool', avgpool: 'avg pool', flatten: 'flatten', dense: 'dense', add: 'soma', ...(o.labels ?? {}) };
    const maxPlanes = o.maxPlanes ?? 16;
    const L = net.layers;
    // Camadas de atalho: as que não leem a anterior e só alimentam uma soma (os 1 × 1); ficam fora da linha.
    const used = new Map();
    L.forEach((l) => l.src.forEach((j) => used.set(j, [...(used.get(j) ?? []), l])));
    const isBranch = (l, li) => l.w && l.src[0] !== li - 1 && (used.get(li) ?? []).every((u) => u.type === 'add');
    // Itens da linha: a entrada e a saída de cada camada do caminho principal (a soma é um círculo).
    const items = [{ shape: net.dataset.shape, name: lb.input, op: null, li: -1 }];
    const itemOf = new Map([[-1, 0]]);
    let pools = 0;
    L.forEach((l, li) => {
        if (isBranch(l, li)) return;
        const name = l.type === 'maxpool' ? `pool${++pools}` : l.type === 'flatten' ? lb.flatten : l.name;
        items.push({ shape: l.outShape, name, op: opLabel(l, lb), layer: l, li, add: l.type === 'add' });
        itemOf.set(li, items.length - 1);
    });
    // Tensores de 1 x 1 (a saída da média) são vetores: barras, como o flatten.
    const is3d = (it) => it.shape.length === 3 && !it.add && (it.shape[1] > 1 || it.shape[2] > 1);
    const maxHW = Math.max(...items.filter(is3d).map((it) => Math.max(it.shape[1], it.shape[2])));
    const sc = Math.min(4, Math.max(1.4, 112 / maxHW));
    const geo = items.map((it) => {
        if (it.add) return { n: 1, d: 0, w: 20, h: 20, W: 20, H: 20, add: true };
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
    // Atalhos: de onde saem (o item da origem) até a soma, com a camada do atalho (ou null, a identidade).
    const arcs = [];
    L.forEach((l, li) => {
        if (l.type !== 'add') return;
        const prev = items[itemOf.get(li) - 1].li;
        for (const j of l.src) {
            if (j === prev) continue;
            const via = j >= 0 && isBranch(L[j], j) ? L[j] : null;
            arcs.push({ from: itemOf.get(via ? via.src[0] : j), to: itemOf.get(li), via });
        }
    });
    const arcH = arcs.length ? 80 : 0;
    const top = 26 + arcH, bodyH = Math.max(...geo.map((g) => g.H)), cy = top + bodyH / 2;
    const gap = net.graph ? 48 : 64;
    let x = 14;
    for (const g of geo) { g.x = x; g.y = cy - g.H / 2; x += g.W + gap; }
    const width = x - gap + 14, height = top + bodyH + 60;
    const out = [];
    const front = (g) => ({ x: g.x + (g.n - 1) * g.d, y: g.y + (g.n - 1) * g.d, w: g.w, h: g.h });
    // Faixas e ligações primeiro (ficam atrás dos tensores).
    for (let i = 1; i < items.length; i++) {
        const a = geo[i - 1], b = geo[i], A = front(a), B = front(b);
        if (items[i].add || items[i - 1].add) {
            out.push(`<line class="nn-link" x1="${f1(A.x + A.w)}" y1="${f1(cy)}" x2="${f1(B.x)}" y2="${f1(cy)}"/>`);
            continue;
        }
        if (is3d(items[i - 1]) && is3d(items[i])) continue;              // ligações do núcleo vêm depois dos planos
        // Para um vetor: faixa do lado direito do tensor anterior até a barra.
        out.push(`<polygon class="nn-band" points="${f1(A.x + A.w)},${f1(A.y)} ${f1(B.x)},${f1(B.y)} ${f1(B.x)},${f1(B.y + B.h)} ${f1(A.x + A.w)},${f1(A.y + A.h)}"/>`);
    }
    // Atalhos: arco por cima dos nomes, da origem até o ⊕, com a caixa da convolução do atalho.
    // Arcos seguidos em duas alturas; o que sai de uma soma parte da linha à direita do círculo (e não de cima dele,
    // onde chega o arco anterior).
    arcs.forEach((a, k) => {
        const A = geo[a.from], B = geo[a.to];
        const fromAdd = items[a.from].add;
        const x1 = fromAdd ? A.x + A.w + 14 : A.x + A.W / 2, y1 = fromAdd ? cy : top - 22;
        const x2 = B.x + B.W / 2, yTop = 18 + (k % 2) * 28, y2 = B.y;
        if (fromAdd) out.push(`<circle class="nn-skip-head" cx="${f1(x1)}" cy="${f1(y1)}" r="2.5"/>`);
        out.push(`<path class="nn-skip" d="M${f1(x1)},${f1(y1)} L${f1(x1)},${f1(yTop)} L${f1(x2)},${f1(yTop)} L${f1(x2)},${f1(y2)}"/>`);
        out.push(`<polygon class="nn-skip-head" points="${f1(x2 - 4)},${f1(y2 - 7)} ${f1(x2 + 4)},${f1(y2 - 7)} ${f1(x2)},${f1(y2)}"/>`);
        if (a.via) {
            const label = `${a.via.name}: ${opLabel(a.via, lb)}`, mx = (x1 + x2) / 2, bw = 7 + label.length * 5.6;
            out.push(`<rect class="nn-skip-box" x="${f1(mx - bw / 2)}" y="${f1(yTop - 10)}" width="${f1(bw)}" height="20" rx="3"/>`);
            out.push(`<text class="nn-op" x="${f1(mx)}" y="${f1(yTop + 4)}" text-anchor="middle">${esc(label)}</text>`);
        }
    });
    // Tensores.
    items.forEach((it, i) => {
        const g = geo[i];
        if (it.add) {
            const cx = g.x + g.w / 2;
            out.push(`<circle class="nn-add" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(g.w / 2)}"/>`);
            out.push(`<line class="nn-add-mark" x1="${f1(cx - 5)}" y1="${f1(cy)}" x2="${f1(cx + 5)}" y2="${f1(cy)}"/><line class="nn-add-mark" x1="${f1(cx)}" y1="${f1(cy - 5)}" x2="${f1(cx)}" y2="${f1(cy + 5)}"/>`);
            out.push(`<text class="nn-dims" x="${f1(cx)}" y="${f1(cy + 24)}" text-anchor="middle">${esc(it.name)}</text>`);
            return;
        }
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
    // Núcleo (ou janela) no plano da frente do tensor anterior (pulando a soma), ligado ao ponto que ele produz.
    for (let i = 1; i < items.length; i++) {
        if (!is3d(items[i])) continue;
        let p = i - 1;
        while (p > 0 && items[p].add) p--;
        if (!is3d(items[p])) continue;
        const l = items[i].layer, A = front(geo[p]), B = front(geo[i]);
        const k = l.type === 'conv' ? l.k : l.size;
        const kw = Math.max(4, k * sc * (A.w / Math.max(8, items[p].shape[2] * sc)));
        const kx = A.x + A.w * 0.62 - kw / 2, ky = A.y + A.h * 0.3 - kw / 2;
        const pw = Math.max(2.5, sc * (B.w / Math.max(8, items[i].shape[2] * sc)));
        const px = B.x + B.w * 0.62 - pw / 2, py = B.y + B.h * 0.3 - pw / 2;
        out.push(`<rect class="nn-kernel" x="${f1(kx)}" y="${f1(ky)}" width="${f1(kw)}" height="${f1(kw)}"/>`);
        out.push(`<rect class="nn-kernel" x="${f1(px)}" y="${f1(py)}" width="${f1(pw)}" height="${f1(pw)}"/>`);
        out.push(`<line class="nn-link" x1="${f1(kx + kw)}" y1="${f1(ky)}" x2="${f1(px)}" y2="${f1(py)}"/>`);
        out.push(`<line class="nn-link" x1="${f1(kx + kw)}" y1="${f1(ky + kw)}" x2="${f1(px)}" y2="${f1(py + pw)}"/>`);
    }
    // Operações, nas linhas de baixo, entre os tensores (alternando duas linhas para os nomes não se encostarem); a
    // soma já tem o nome embaixo do círculo.
    for (let i = 1; i < items.length; i++) {
        if (items[i].add) continue;
        const a = geo[i - 1], b = geo[i];
        const mx = (a.x + a.W + b.x) / 2;
        out.push(`<line class="nn-tick" x1="${f1(mx)}" y1="${f1(top + bodyH + 22)}" x2="${f1(mx)}" y2="${f1(top + bodyH + (i % 2 ? 28 : 42))}"/>`);
        out.push(`<text class="nn-op" x="${f1(mx)}" y="${f1(top + bodyH + (i % 2 ? 38 : 52))}" text-anchor="middle">${esc(items[i].op)}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" class="nn-arch${net.graph ? ' nn-wide' : ''}" viewBox="0 0 ${f1(width)} ${f1(height)}" width="${f1(width)}" height="${f1(height)}" role="img" aria-label="${esc(net.name)}">${out.join('')}</svg>`;
}
