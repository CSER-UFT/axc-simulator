/**
 * Aplicação: um filtro de imagem calculado com a unidade aproximada, comparado com o mesmo filtro exato.
 *
 * As imagens são em tons de cinza, 8 bits por pixel ({w, h, data: Uint8ClampedArray}). Todos os produtos ou
 * todas as somas de uma etapa do filtro são avaliados de uma vez pelo circuito (avaliação em paralelo).
 */
import { rng } from './metrics.js';

/** Imagem de teste sintética: gradiente, círculos, listras de frequência crescente, xadrez e textura. */
export function testImage(w = 192, h = 192) {
    const data = new Uint8ClampedArray(w * h);
    const rand = rng(99);
    // Textura suave: ruído de valor interpolado numa grade 12 x 12.
    const G = 12, grid = Array.from({ length: (G + 1) * (G + 1) }, () => rand());
    const noise = (x, y) => {
        const gx = (x / w) * G, gy = (y / h) * G;
        const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
        const at = (p, q) => grid[Math.min(G, q) * (G + 1) + Math.min(G, p)];
        const s = (t) => t * t * (3 - 2 * t);
        const top = at(i, j) + (at(i + 1, j) - at(i, j)) * s(fx);
        const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * s(fx);
        return top + (bot - top) * s(fy);
    };
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const u = x / w, v = y / h;
            let p = 40 + 150 * (0.6 * u + 0.4 * v) + 50 * (noise(x, y) - 0.5);
            // Círculos com tons diferentes.
            for (const [cx, cy, r, tone] of [[0.25, 0.28, 0.14, 235], [0.7, 0.3, 0.1, 25], [0.42, 0.62, 0.08, 200]])
                if ((u - cx) ** 2 + (v - cy) ** 2 < r * r) p = tone + 15 * (noise(x * 3, y * 3) - 0.5);
            // Listras de frequência crescente (canto inferior esquerdo).
            if (u < 0.5 && v > 0.78) p = 128 + 110 * Math.sin(2 * Math.PI * (2 + 30 * u * u) * u * 4);
            // Xadrez (canto inferior direito).
            if (u > 0.62 && v > 0.62 && v < 0.92 && u < 0.92) p = ((Math.floor(x / 6) + Math.floor(y / 6)) & 1) ? 220 : 30;
            data[y * w + x] = p;
        }
    }
    return { w, h, data };
}

/** Imagem de um ImageData (cores) para tons de cinza, reduzida para caber em max x max. */
export function fromRgba(rgba, w, h) {
    const data = new Uint8ClampedArray(w * h);
    for (let k = 0; k < w * h; k++) data[k] = 0.299 * rgba[4 * k] + 0.587 * rgba[4 * k + 1] + 0.114 * rgba[4 * k + 2];
    return { w, h, data };
}

/**
 * Lê uma imagem Netpbm (PBM, PGM ou PPM; texto P1, P2, P3 ou binário P4, P5, P6), com comentários e até 16 bits
 * por canal. Os navegadores não abrem esses formatos, então a leitura é feita aqui.
 * @param {Uint8Array} bytes conteúdo do arquivo
 * @returns {{w: number, h: number, data: Uint8ClampedArray}} em tons de cinza, 8 bits
 */
export function parseNetpbm(bytes) {
    let pos = 0;
    const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;
    const token = () => {
        for (;;) {
            while (pos < bytes.length && isSpace(bytes[pos])) pos++;
            if (bytes[pos] !== 35) break;                                   // # comentário até o fim da linha
            while (pos < bytes.length && bytes[pos] !== 10 && bytes[pos] !== 13) pos++;
        }
        const start = pos;
        while (pos < bytes.length && !isSpace(bytes[pos]) && bytes[pos] !== 35) pos++;
        if (start === pos) throw new Error('arquivo Netpbm incompleto');
        return String.fromCharCode(...bytes.subarray(start, pos));
    };
    const magic = token();
    const kind = /^P([1-6])$/.exec(magic)?.[1];
    if (!kind) throw new Error('não é um arquivo PBM, PGM ou PPM (cabeçalho P1 a P6)');
    const t = +kind;
    const w = +token(), h = +token();
    const bitmap = t === 1 || t === 4;
    const maxval = bitmap ? 1 : +token();
    if (!(w > 0 && h > 0 && maxval > 0 && maxval < 65536)) throw new Error('cabeçalho Netpbm inválido');
    const ch = t === 3 || t === 6 ? 3 : 1;
    const n = w * h;
    const raw = new Float64Array(n * ch);
    if (t <= 3) {
        if (t === 1) {
            // P1: dígitos 0 e 1, que podem vir colados.
            for (let k = 0; k < n; k++) {
                while (pos < bytes.length && bytes[pos] !== 48 && bytes[pos] !== 49) {
                    if (bytes[pos] === 35) while (pos < bytes.length && bytes[pos] !== 10) pos++;
                    else pos++;
                }
                if (pos >= bytes.length) throw new Error('arquivo Netpbm incompleto');
                raw[k] = bytes[pos++] - 48;
            }
        } else {
            for (let k = 0; k < n * ch; k++) raw[k] = +token();
        }
    } else {
        pos++;                                                              // um espaço depois do cabeçalho
        if (t === 4) {
            const rowBytes = Math.ceil(w / 8);
            if (pos + rowBytes * h > bytes.length) throw new Error('arquivo Netpbm incompleto');
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * w + x] = (bytes[pos + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        } else {
            const two = maxval > 255;
            if (pos + n * ch * (two ? 2 : 1) > bytes.length) throw new Error('arquivo Netpbm incompleto');
            for (let k = 0; k < n * ch; k++) raw[k] = two ? (bytes[pos + 2 * k] << 8) | bytes[pos + 2 * k + 1] : bytes[pos + k];
        }
    }
    // No PBM, 1 é preto.
    const level = (v) => (bitmap ? (1 - v) * 255 : (Math.min(v, maxval) / maxval) * 255);
    const data = new Uint8ClampedArray(n);
    for (let k = 0; k < n; k++) {
        data[k] = ch === 1 ? Math.round(level(raw[k]))
            : Math.round(0.299 * level(raw[3 * k]) + 0.587 * level(raw[3 * k + 1]) + 0.114 * level(raw[3 * k + 2]));
    }
    return { w, h, data };
}

/** Reduz uma imagem em tons de cinza para caber em max x max, pela média de área (sem mudar se já couber). */
export function fitImage(img, max = 256) {
    const s = Math.min(1, max / Math.max(img.w, img.h));
    if (s === 1) return img;
    const w = Math.max(8, Math.round(img.w * s)), h = Math.max(8, Math.round(img.h * s));
    const data = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
        const y0 = Math.floor((y * img.h) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.h) / h));
        for (let x = 0; x < w; x++) {
            const x0 = Math.floor((x * img.w) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.w) / w));
            let sum = 0;
            for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) sum += img.data[j * img.w + i];
            data[y * w + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
        }
    }
    return { w, h, data };
}

/** Pesos do filtro gaussiano 3 x 3 em 8 bits, somando 256 (o resultado é dividido por 256). */
export const KERNELS = {
    gauss: [19, 32, 19, 32, 52, 32, 19, 32, 19],     // gaussiana com sigma 1
    gauss2: [16, 32, 16, 32, 64, 32, 16, 32, 16],    // 1 2 1, potências de 2: cada produto tem um só termo
};

const clampAt = (img, x, y) => img.data[Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))];

/**
 * Aplica o filtro com a unidade dada. Com um multiplicador, os produtos pixel x peso são aproximados e as
 * somas exatas; com um somador, os produtos são exatos e a acumulação usa o somador.
 * @param {'gauss'|'gauss2'|'gain'|'pairs'} filter
 * @param {object|null} unit saída de buildUnit (null: tudo exato)
 */
export function applyFilter(img, filter, unit, { gain = 180 } = {}) {
    const { w, h } = img;
    const n = w * h;
    // Com um multiplicador, os produtos são sempre pixel (0 a 255) vezes um dos poucos pesos do filtro: o circuito
    // é avaliado uma vez para cada combinação, e o filtro consulta essa tabela.
    let table = null;
    const product = (x, w) => {
        if (!table) {
            const ws = [...new Set(filter === 'gain' ? [gain] : (KERNELS[filter] ?? []))];
            const as = new Uint32Array(256 * ws.length), bs = new Uint32Array(256 * ws.length);
            ws.forEach((wt, i) => { for (let p = 0; p < 256; p++) { as[i * 256 + p] = p; bs[i * 256 + p] = wt; } });
            const y = unit.net.evaluate(as, bs);
            table = new Map(ws.map((wt, i) => [wt, y.subarray(i * 256, (i + 1) * 256)]));
        }
        return table.get(w)[x];
    };
    const mul = (as, bs) => (unit?.kind === 'mul' ? Float64Array.from(as, (x, k) => product(x, bs[k])) : Float64Array.from(as, (x, k) => x * bs[k]));
    const add = (as, bs) => (unit?.kind === 'add' ? unit.net.evaluate(as, bs) : Float64Array.from(as, (x, k) => x + bs[k]));
    const out = new Uint8ClampedArray(n);
    if (filter === 'gain') {
        // Ganho de brilho: pixel x g / 128 (g em 8 bits).
        const p = Uint32Array.from(img.data), g = new Uint32Array(n).fill(gain);
        const y = mul(p, g);
        for (let k = 0; k < n; k++) out[k] = Math.min(255, Math.floor(y[k] / 128));
        return { w, h, data: out };
    }
    if (filter === 'pairs') {
        // Média de cada pixel com o vizinho da direita: (p + q) / 2, com um somador de 8 bits.
        const p = new Uint32Array(n), q = new Uint32Array(n);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { p[y * w + x] = img.data[y * w + x]; q[y * w + x] = clampAt(img, x + 1, y); }
        const s = add(p, q);
        for (let k = 0; k < n; k++) out[k] = Math.floor(s[k] / 2);
        return { w, h, data: out };
    }
    // Gaussiano 3 x 3: nove produtos por pixel e oito somas.
    if (unit?.kind !== 'add') {
        // Somas exatas: um laço direto, com os produtos da tabela (ou exatos).
        const K = KERNELS[filter];
        const tab = K.map((wt) => (unit ? (product(0, wt), table.get(wt)) : Float64Array.from({ length: 256 }, (_, p) => p * wt)));
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let acc = 0;
                for (let t = 0; t < 9; t++) acc += tab[t][clampAt(img, x + (t % 3) - 1, y + Math.floor(t / 3) - 1)];
                out[y * w + x] = Math.min(255, Math.floor(acc / 256));
            }
        }
        return { w, h, data: out };
    }
    const prods = [];
    KERNELS[filter].forEach((wt, t) => {
        const dx = (t % 3) - 1, dy = Math.floor(t / 3) - 1;
        const p = new Uint32Array(n);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y * w + x] = clampAt(img, x + dx, y + dy);
        prods.push(mul(p, new Uint32Array(n).fill(wt)));
    });
    const mask = unit?.kind === 'add' ? 2 ** unit.outBits - 1 : Infinity;
    let acc = prods[0];
    for (let t = 1; t < 9; t++) acc = add(Uint32Array.from(acc, (v) => Math.min(v, mask)), Uint32Array.from(prods[t]));
    for (let k = 0; k < n; k++) out[k] = Math.min(255, Math.floor(acc[k] / 256));
    return { w, h, data: out };
}

/** Relação sinal ruído de pico, em dB (Infinity quando as imagens são iguais). */
export function psnr(x, y) {
    let s = 0;
    for (let k = 0; k < x.data.length; k++) s += (x.data[k] - y.data[k]) ** 2;
    const mse = s / x.data.length;
    return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** SSIM médio em janelas 8 x 8 com passo 4 (constantes de Wang e colegas, 2004). */
export function ssim(x, y) {
    const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
    const { w, h } = x;
    let total = 0, count = 0;
    for (let y0 = 0; y0 + 8 <= h; y0 += 4) {
        for (let x0 = 0; x0 + 8 <= w; x0 += 4) {
            let mx = 0, my = 0;
            for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y0 + j) * w + x0 + i; mx += x.data[k]; my += y.data[k]; }
            mx /= 64; my /= 64;
            let vx = 0, vy = 0, cxy = 0;
            for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
                const k = (y0 + j) * w + x0 + i;
                const dx = x.data[k] - mx, dy = y.data[k] - my;
                vx += dx * dx; vy += dy * dy; cxy += dx * dy;
            }
            vx /= 63; vy /= 63; cxy /= 63;
            total += ((2 * mx * my + C1) * (2 * cxy + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
            count++;
        }
    }
    return count ? total / count : 1;
}

/** Diferença absoluta ampliada (para ver onde a aproximação erra). */
export function diffImage(x, y, scale = 8) {
    const data = new Uint8ClampedArray(x.data.length);
    for (let k = 0; k < data.length; k++) data[k] = Math.abs(x.data[k] - y.data[k]) * scale;
    return { w: x.w, h: x.h, data };
}
