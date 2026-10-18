/**
 * SSIM como em Wang, Bovik, Sheikh e Simoncelli (2004): janela gaussiana 11 × 11 com σ = 1,5, normalizada, só nas
 * posições em que a janela cabe inteira na imagem, K1 = 0,01, K2 = 0,03 e a faixa dinâmica L (255 para 8 bits). As
 * médias, variâncias e a covariância locais são as ponderadas pela janela (filtro separável).
 *
 * Estimativa a partir dos momentos do erro: com y = x + e, e o erro independente do sinal, de média μe e variância
 * σe² iguais em toda a imagem, cada janela tem μy = μx + μe, σy² = σx² + σe² e σxy = σx², e o SSIM local é
 *     (2μx(μx + μe) + C1)(2σx² + C2) / ((μx² + (μx + μe)² + C1)(2σx² + σe² + C2)).
 * Com uma parte do erro proporcional ao valor (ganho b, medido no modelo por amostras), veja ssimEstimate.
 * Só as estatísticas da imagem exata (μx, σx² de cada janela) são necessárias, calculadas uma vez.
 */
const SIZE = 11, SIGMA = 1.5;
/** Faixas de valor da saída para o erro condicionado ao valor (8 bits: faixas de 8). */
export const SSIM_BINS = 32;
const KERNEL = (() => {
    const r = (SIZE - 1) / 2, k = new Float64Array(SIZE);
    let s = 0;
    for (let i = 0; i < SIZE; i++) { k[i] = Math.exp(-((i - r) ** 2) / (2 * SIGMA * SIGMA)); s += k[i]; }
    for (let i = 0; i < SIZE; i++) k[i] /= s;
    return k;
})();

/** Filtro gaussiano separável, só a parte válida: saída (w - 10) × (h - 10). */
function blur(A, w, h) {
    const ow = w - SIZE + 1, oh = h - SIZE + 1;
    if (ow <= 0 || oh <= 0) return null;
    const tmp = new Float64Array(ow * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < ow; x++) {
        let s = 0;
        for (let i = 0; i < SIZE; i++) s += KERNEL[i] * A[y * w + x + i];
        tmp[y * ow + x] = s;
    }
    const out = new Float64Array(ow * oh);
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        let s = 0;
        for (let i = 0; i < SIZE; i++) s += KERNEL[i] * tmp[(y + i) * ow + x];
        out[y * ow + x] = s;
    }
    return out;
}
const constants = (L) => [(0.01 * L) ** 2, (0.03 * L) ** 2];

/** SSIM médio entre X (referência) e Y, imagens w × h em vetores (linha a linha). */
export function ssim(X, Y, w, h, L = 255) {
    const n = w * h;
    const XX = new Float64Array(n), YY = new Float64Array(n), XY = new Float64Array(n);
    for (let k = 0; k < n; k++) { XX[k] = X[k] * X[k]; YY[k] = Y[k] * Y[k]; XY[k] = X[k] * Y[k]; }
    const mx = blur(X, w, h);
    if (!mx) return null;
    const my = blur(Y, w, h), sxx = blur(XX, w, h), syy = blur(YY, w, h), sxy = blur(XY, w, h);
    const [C1, C2] = constants(L);
    let total = 0;
    for (let k = 0; k < mx.length; k++) {
        const vx = sxx[k] - mx[k] * mx[k], vy = syy[k] - my[k] * my[k], cxy = sxy[k] - mx[k] * my[k];
        total += ((2 * mx[k] * my[k] + C1) * (2 * cxy + C2)) / ((mx[k] * mx[k] + my[k] * my[k] + C1) * (vx + vy + C2));
    }
    return total / mx.length;
}

/** Estatísticas locais da imagem exata (média e variância de cada janela), para a estimativa. */
export function ssimStats(X, w, h, L = 255) {
    const mx = blur(X, w, h);
    if (!mx) return null;
    const XX = new Float64Array(w * h);
    for (let k = 0; k < XX.length; k++) XX[k] = X[k] * X[k];
    const sxx = blur(XX, w, h);
    const vx = new Float64Array(mx.length);
    for (let k = 0; k < mx.length; k++) vx[k] = Math.max(0, sxx[k] - mx[k] * mx[k]);
    let mean = 0, sq = 0;
    for (let k = 0; k < X.length; k++) { mean += X[k]; sq += X[k] * X[k]; }
    mean /= X.length;
    // Por faixa de valor b: P_b = filtro de 1[x na faixa] e Q_b = filtro de x·1[x na faixa], para a estimativa com o
    // erro que depende do valor (só nas imagens de 8 bits).
    let P = null, Q = null;
    if (L === 255) {
        P = []; Q = [];
        const I = new Float64Array(w * h), J = new Float64Array(w * h);
        for (let b = 0; b < SSIM_BINS; b++) {
            for (let k = 0; k < X.length; k++) { const inb = Math.min(SSIM_BINS - 1, Math.floor((X[k] * SSIM_BINS) / 256)) === b; I[k] = inb ? 1 : 0; J[k] = inb ? X[k] : 0; }
            P.push(blur(I, w, h)); Q.push(blur(J, w, h));
        }
    }
    return { mx, vx, sxx, L, mean, variance: Math.max(0, sq / X.length - mean * mean), P, Q };
}

/**
 * SSIM estimado para um erro de média mu e variância v na imagem. Com gain = b, o erro é e = a + b·x + n: a parte
 * b·x acompanha o valor exato (um erro relativo, como o de um multiplicador logarítmico), n é independente, e a = mu -
 * b·E[x] (meanX). Em cada janela: μy = (1 + b)μx + a, σy² = (1 + b)²σx² + σn², σxy = (1 + b)σx², com
 * σn² = v - b²·var(x) (não negativo). Com b = 0 é a fórmula do erro independente.
 */
export function ssimEstimate(stats, mu, v, gain = 0, meanX = null) {
    if (!stats) return null;
    const [C1, C2] = constants(stats.L);
    const { mx, vx, mean, variance } = stats;
    const b = gain, a = mu - b * (meanX ?? mean);
    const vn = Math.max(0, v - b * b * variance);
    let total = 0;
    for (let k = 0; k < mx.length; k++) {
        const m = mx[k], my = (1 + b) * m + a, sx = vx[k];
        total += ((2 * m * my + C1) * (2 * (1 + b) * sx + C2)) / ((m * m + my * my + C1) * (sx + (1 + b) * (1 + b) * sx + vn + C2));
    }
    return total / mx.length;
}

/**
 * SSIM estimado com o erro condicionado ao valor exato: em cada faixa b de valores, média m_b e variância v_b, com o
 * ruído independente entre pixels. Por janela: μy = μx + Σ m_b P_b, E[y²] = E[x²] + 2 Σ m_b Q_b + Σ (m_b² + v_b) P_b,
 * E[xy] = E[x²] + Σ m_b Q_b. Erros que se concentram nos valores altos ou baixos (bordas, saturação) entram onde
 * acontecem, em vez de espalhados por igual pela imagem.
 */
export function ssimEstimateBins(stats, byValue) {
    if (!stats?.P) return null;
    const [C1, C2] = constants(stats.L);
    const { mx, sxx, P, Q } = stats;
    const used = byValue.map((x, b) => (x.mu || x.v ? b : -1)).filter((b) => b >= 0);
    let total = 0;
    for (let k = 0; k < mx.length; k++) {
        let dm = 0, dy2 = 0, dxy = 0;
        for (const b of used) {
            const { mu, v } = byValue[b];
            dm += mu * P[b][k]; dxy += mu * Q[b][k]; dy2 += (mu * mu + v) * P[b][k];
        }
        const m = mx[k], my = m + dm;
        const ex2 = sxx[k];
        const vxk = Math.max(0, ex2 - m * m), vy = Math.max(0, ex2 + 2 * dxy + dy2 - my * my), cxy = ex2 + dxy - m * my;
        total += ((2 * m * my + C1) * (2 * cxy + C2)) / ((m * m + my * my + C1) * (vxk + vy + C2));
    }
    return total / mx.length;
}
