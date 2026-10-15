/**
 * Entradas de teste e métricas de erro.
 *
 * Com operandos de 8 bits e distribuição uniforme, a avaliação é exaustiva (todos os 65536 pares). Nos outros
 * casos, a avaliação é por amostragem, com um gerador pseudoaleatório de semente fixa: a mesma configuração dá
 * sempre os mesmos números.
 *
 * Para cada par: ED = |aproximado - exato| (distância de erro). As métricas são as de sempre na literatura:
 *   ME    erro médio, com sinal (viés)          MED   média de ED
 *   WCE   maior ED (pior caso)                  MSE   média de ED^2
 *   NMED  MED / maior saída exata possível      MRED  média de ED / exato (pares com exato 0 ficam de fora)
 *   EP    fração dos pares com erro (taxa de erro)
 */

/** Gerador pseudoaleatório (mulberry32) com semente fixa. */
export function rng(seed = 12345) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const DISTRIBUTIONS = ['uniform', 'normal', 'exp'];
/** Distribuições tiradas das aplicações (data/operands.json e data/operands.bin, gerados por scripts/operands.mjs). */
export const APP_DISTRIBUTIONS = ['lenet', 'image'];
const OPERANDS = new Map();

/**
 * Registra os pares reais das aplicações.
 * @param {object} index conteúdo de data/operands.json
 * @param {ArrayBuffer} buffer conteúdo de data/operands.bin
 */
export function loadOperands(index, buffer) {
    for (const [app, kinds] of Object.entries(index.sets)) {
        for (const [kind, s] of Object.entries(kinds)) {
            const v = new Int32Array(buffer, s.offset, 2 * s.count);
            const a = new Int32Array(s.count), b = new Int32Array(s.count);
            for (let i = 0; i < s.count; i++) { a[i] = v[2 * i]; b[i] = v[2 * i + 1]; }
            OPERANDS.set(`${app}.${kind}`, { a, b, population: s.population });
        }
    }
}
export const operandsLoaded = () => OPERANDS.size > 0;

/** Um operando de N bits na distribuição escolhida. */
function draw(rand, N, dist) {
    const max = 2 ** N - 1;
    if (dist === 'uniform') return Math.floor(rand() * (max + 1));
    if (dist === 'normal') {
        // Centrada no meio da faixa, com desvio de 1/6 da faixa (Box Muller), cortada nas bordas.
        const u = Math.max(rand(), 1e-12), v = rand();
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        return Math.min(max, Math.max(0, Math.round(max / 2 + z * max / 6)));
    }
    // Exponencial: valores pequenos são mais comuns, como em muitos dados reais (média em 1/8 da faixa).
    const x = -Math.log(Math.max(rand(), 1e-12)) * max / 8;
    return Math.min(max, Math.round(x));
}

/**
 * Pares de operandos para a avaliação.
 * @returns {{a: Uint32Array, b: Uint32Array, exhaustive: boolean}}
 */
export function testInputs(N, dist = 'uniform', samples = 200000, seed = 12345, kind = 'mul') {
    if (APP_DISTRIBUTIONS.includes(dist)) {
        // Pares reais da aplicação: a unidade de N bits recebe os N bits baixos de cada operando.
        const s = OPERANDS.get(`${dist}.${kind}`);
        if (!s) throw new Error(`operandos de ${dist} não carregados`);
        const mask = 2 ** N - 1;
        return { a: Uint32Array.from(s.a, (x) => x & mask), b: Uint32Array.from(s.b, (x) => x & mask), exhaustive: false, app: dist, population: s.population };
    }
    if (N <= 8 && dist === 'uniform') {
        const n = 2 ** (2 * N);
        const a = new Uint32Array(n), b = new Uint32Array(n);
        for (let k = 0; k < n; k++) { a[k] = k >>> N; b[k] = k & (2 ** N - 1); }
        return { a, b, exhaustive: true };
    }
    const rand = rng(seed);
    const a = new Uint32Array(samples), b = new Uint32Array(samples);
    for (let k = 0; k < samples; k++) { a[k] = draw(rand, N, dist); b[k] = draw(rand, N, dist); }
    return { a, b, exhaustive: false };
}

/**
 * Métricas de erro de uma unidade sobre os pares dados.
 * @param {object} unit saída de buildUnit
 * @param {{a: Uint32Array, b: Uint32Array}} inp
 */
export function errorMetrics(unit, inp) {
    const approx = unit.net.evaluate(inp.a, inp.b);
    const value = unit.decode ? Float64Array.from(approx, unit.decode) : approx;
    const n = inp.a.length;
    let sum = 0, sumAbs = 0, sumSq = 0, sumQ = 0, wce = 0, wcA = 0, wcB = 0, errs = 0, red = 0, red2 = 0, redN = 0;
    const signed = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        const e = unit.exact(inp.a[k], inp.b[k]);
        const d = value[k] - e;
        signed[k] = d;
        const ad = Math.abs(d);
        sum += d;
        sumAbs += ad;
        sumSq += ad * ad;
        sumQ += ad * ad * ad * ad;
        if (ad > wce) { wce = ad; wcA = inp.a[k]; wcB = inp.b[k]; }
        if (ad > 0) errs++;
        if (e !== 0) { const re = ad / Math.abs(e); red += re; red2 += re * re; redN++; }
    }
    const MED = sumAbs / n, MSE = sumSq / n, MRED = redN ? red / redN : 0, EP = errs / n;
    // Intervalo de confiança de 95% (aproximação normal) das médias, quando os pares são uma amostra. O WCE de uma
    // amostra é só um limite inferior do pior caso.
    const half = (variance, m) => (m > 1 ? 1.96 * Math.sqrt(Math.max(0, variance) / m) : 0);
    const ci = inp.exhaustive ? null : {
        MED: half(MSE - MED * MED, n), MSE: half(sumQ / n - MSE * MSE, n), NMED: half(MSE - MED * MED, n) / unit.maxOut,
        MRED: redN ? half(red2 / redN - MRED * MRED, redN) : 0, EP: half(EP * (1 - EP), n),
    };
    return {
        n, ME: sum / n, MED, WCE: wce, worst: { a: wcA, b: wcB }, MSE,
        NMED: MED / unit.maxOut, MRED, EP, ci, signed, approx, value,
    };
}

/** Histograma do erro com sinal, em faixas de largura igual. */
export function histogram(values, bins = 41) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === hi) return { lo, hi, width: 1, counts: [values.length], zero: values.length };
    // Faixas simétricas em torno do zero, para o zero cair sempre no meio de uma faixa.
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    const width = (2 * m) / bins;
    const counts = new Array(bins).fill(0);
    let zero = 0;
    for (const v of values) {
        if (v === 0) zero++;
        counts[Math.min(bins - 1, Math.floor((v + m) / width))]++;
    }
    return { lo: -m, hi: m, width, counts, zero };
}

/**
 * Mapa do erro sobre o plano dos operandos: uma grade de G x G pontos. Com 8 bits e G = 256, é exato (cada
 * ponto é um par); com 16 bits, cada ponto é a média de ED numa célula da grade, por amostragem.
 */
export function errorGrid(unit, G = 256, perCell = 1, seed = 7) {
    const N = unit.cfg.width;
    const span = 2 ** N / G;
    const rand = rng(seed);
    const total = G * G * perCell;
    const a = new Uint32Array(total), b = new Uint32Array(total);
    let k = 0;
    for (let i = 0; i < G; i++) {
        for (let j = 0; j < G; j++) {
            for (let r = 0; r < perCell; r++, k++) {
                a[k] = span === 1 ? i : Math.floor(i * span + rand() * span);
                b[k] = span === 1 ? j : Math.floor(j * span + rand() * span);
            }
        }
    }
    // Com sinal, os eixos vão de -2^(N-1) a 2^(N-1) - 1: o índice vira o valor e o valor, a codificação.
    if (unit.signed) {
        const half = 2 ** (N - 1), M = 2 ** N;
        for (let q = 0; q < total; q++) { a[q] = (a[q] + half) % M; b[q] = (b[q] + half) % M; }
    }
    const y = unit.net.evaluate(a, b);
    const grid = new Float64Array(G * G);
    for (let p = 0; p < G * G; p++) {
        let s = 0;
        for (let r = 0; r < perCell; r++) {
            const q = p * perCell + r;
            s += Math.abs((unit.decode ? unit.decode(y[q]) : y[q]) - unit.exact(a[q], b[q]));
        }
        grid[p] = s / perCell;
    }
    return { G, grid };
}

/** Pontos da fronteira de Pareto (menor custo e menor erro), pelos índices. */
export function paretoFront(points) {
    return points.map((p, i) => i).filter((i) => !points.some((q, j) => j !== i
        && q.x <= points[i].x && q.y <= points[i].y && (q.x < points[i].x || q.y < points[i].y)));
}
