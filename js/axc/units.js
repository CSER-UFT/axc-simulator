/**
 * Geradores de unidades aritméticas exatas e aproximadas, no nível de portas.
 *
 * Multiplicador N x N sem sinal: os produtos parciais a_i and b_j caem na coluna i + j e são reduzidos por
 * estágios no estilo de Dadda (só o necessário para cada coluna não passar da altura alvo do estágio) até sobrarem
 * no máximo dois bits por coluna; uma soma com propagação de vai um (ripple carry) dá o produto. As colunas menos significativas podem ser
 * divididas em três zonas, como em muitos multiplicadores da literatura:
 *
 *   truncada    os produtos parciais nem são gerados (não há porta AND); a saída da coluna é 0;
 *   aproximada  a redução usa compressores 4:2 aproximados, e a soma final é um OR, sem vai um;
 *   exata       somadores completos e soma final com propagação de vai um.
 *
 * Somador de N bits: exato (ripple carry), truncado, LOA (lower part OR adder) e segmentado, em que cada bloco
 * calcula o seu vem um olhando só alguns bits antes dele (como os somadores GeAr e ACA).
 */
import { Netlist } from './netlist.js';

/** Descrição curta de uma configuração (usada na comparação). */
export function unitName(cfg) {
    const N = cfg.width;
    if (cfg.kind === 'mul') {
        const parts = [];
        if (cfg.kTrunc) parts.push(`T${cfg.kTrunc}`);
        if (cfg.kApprox) parts.push(`A${cfg.kApprox}${cfg.approxCarry === false ? '' : 'c'}`);
        return `MUL${N}${parts.length ? ` ${parts.join(' ')}` : ' exato'}`;
    }
    switch (cfg.adder) {
        case 'trunc': return `ADD${N} TRUNC${cfg.k}`;
        case 'loa': return `ADD${N} LOA${cfg.k}`;
        case 'seg': return `ADD${N} SEG L${cfg.L} P${cfg.P}`;
        default: return `ADD${N} exato`;
    }
}

/** Zona de cada coluna do multiplicador. */
export function mulZones(cfg) {
    const N = cfg.width, kT = cfg.kTrunc ?? 0, kA = cfg.kApprox ?? 0;
    return Array.from({ length: 2 * N }, (_, c) => (c < kT ? 'trunc' : c < kT + kA ? 'approx' : 'exact'));
}

/**
 * @param {{width: number, kTrunc?: number, kApprox?: number, approxCarry?: boolean}} cfg
 */
export function buildMultiplier(cfg) {
    const N = cfg.width;
    const zones = mulZones(cfg);
    const net = new Netlist();
    const a = net.input('a', N), b = net.input('b', N);
    let cols = Array.from({ length: 2 * N }, () => []);
    const dots = [];
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const c = i + j;
            dots.push({ i, j, c, zone: zones[c] });
            if (zones[c] === 'trunc') continue;
            cols[c].push(net.and(a[i], b[j]));
        }
    }
    const byDepth = (x, y) => net.depth[x] - net.depth[y];
    const heights = [cols.map((x) => x.length)];
    // Redução de Dadda: alturas alvo 2, 3, 4, 6, 9, 13, ... A cada estágio, cada coluna é reduzida só o
    // necessário para não passar do alvo, contando os vai um que chegam da coluna anterior no mesmo estágio.
    const targets = [2];
    while (targets[targets.length - 1] < 2 * N) targets.push(Math.floor(targets[targets.length - 1] * 1.5));
    let ti = targets.findIndex((d) => d >= Math.max(...heights[0])) - 1;
    for (; ti >= 0; ti--) {
        const d = targets[ti];
        if (cols.every((x) => x.length <= d)) continue;
        const next = Array.from({ length: 2 * N + 1 }, () => []);
        cols.forEach((bits, c) => {
            const pool = [...bits].sort(byDepth);
            while (pool.length + next[c].length > d && pool.length >= 2) {
                const excess = pool.length + next[c].length - d;
                let s, cy;
                if (zones[c] === 'approx' && excess >= 3 && pool.length >= 4) [s, cy] = net.ac(pool.shift(), pool.shift(), pool.shift(), pool.shift());
                else if (excess >= 2 && pool.length >= 3) {
                    [s, cy] = zones[c] === 'approx' ? net.ac(pool.shift(), pool.shift(), pool.shift(), 0) : net.fa(pool.shift(), pool.shift(), pool.shift());
                } else [s, cy] = net.ha(pool.shift(), pool.shift());
                next[c].push(s);
                next[c + 1].push(cy);
            }
            next[c].push(...pool);
        });
        cols = next.slice(0, 2 * N);
        heights.push(cols.map((x) => x.length));
    }
    // Soma final: OR nas colunas aproximadas, propagação de vai um nas exatas.
    const out = [];
    let carry = 0;
    let lastApprox = null;
    let c0 = 2 * N;
    cols.forEach((bits, c) => {
        if (c >= c0) return;
        if (zones[c] === 'trunc') { out.push(0); return; }
        if (zones[c] === 'approx') {
            out.push(bits.length === 2 ? net.or(bits[0], bits[1]) : bits[0] ?? 0);
            lastApprox = bits;
            return;
        }
        // Primeira coluna exata: daqui até o fim, uma soma de duas linhas com propagação de vai um.
        if (lastApprox && cfg.approxCarry !== false) {
            // Como no LOA: o vem um da primeira coluna exata é o AND dos dois bits da última coluna aproximada.
            carry = lastApprox.length === 2 ? net.and(lastApprox[0], lastApprox[1]) : 0;
        }
        c0 = c;
        const rest = cols.slice(c);
        const { sums } = net.rippleAdd(rest.map((x) => x[0] ?? 0), rest.map((x) => x[1] ?? 0), carry);
        out.push(...sums);
    });
    net.outputs = out;
    return { kind: 'mul', cfg, net, zones, dots, heights, exact: (x, y) => x * y, outBits: 2 * N, maxOut: (2 ** N - 1) ** 2 };
}

/** Cadeia só de vai um sobre os bits [lo, hi), com vem um 0 (previsão dos somadores segmentados). */
function carryChain(net, a, b, lo, hi) {
    return net.rippleAdd(a.slice(lo, hi), b.slice(lo, hi), 0, { carryOnly: true }).cout;
}

/**
 * @param {{width: number, adder: 'exact'|'trunc'|'loa'|'seg', k?: number, L?: number, P?: number}} cfg
 */
export function buildAdder(cfg) {
    const N = cfg.width;
    const net = new Netlist();
    const a = net.input('a', N), b = net.input('b', N);
    const out = [];
    const zones = Array.from({ length: N }, () => 'exact');
    const blocks = Array.from({ length: N }, () => 0);
    const ripple = (lo, hi, cin) => {
        if (lo >= hi) return cin;
        const { sums, cout } = net.rippleAdd(a.slice(lo, hi), b.slice(lo, hi), cin);
        sums.forEach((w, k) => { out[lo + k] = w; });
        return cout;
    };
    let cout;
    if (cfg.adder === 'trunc' || cfg.adder === 'loa') {
        const k = Math.min(cfg.k ?? 0, N);
        for (let i = 0; i < k; i++) {
            zones[i] = cfg.adder === 'trunc' ? 'trunc' : 'approx';
            out[i] = cfg.adder === 'trunc' ? 0 : net.or(a[i], b[i]);
        }
        const cin = cfg.adder === 'loa' && k > 0 ? net.and(a[k - 1], b[k - 1]) : 0;
        cout = ripple(k, N, cin);
    } else if (cfg.adder === 'seg') {
        const L = Math.max(1, cfg.L ?? 4), P = Math.max(0, cfg.P ?? 0);
        for (let s = 0, j = 0; s < N; s += L, j++) {
            const hi = Math.min(N, s + L);
            for (let i = s; i < hi; i++) blocks[i] = j;
            if (s > 0) for (let i = s; i < hi; i++) zones[i] = 'approx';
            const cin = s === 0 || P === 0 ? 0 : carryChain(net, a, b, Math.max(0, s - P), s);
            cout = ripple(s, hi, cin);
        }
    } else cout = ripple(0, N, 0);
    out.push(cout);
    net.outputs = out;
    return { kind: 'add', cfg, net, zones, blocks, exact: (x, y) => x + y, outBits: N + 1, maxOut: 2 * (2 ** N - 1) };
}

export function buildUnit(cfg) {
    return cfg.kind === 'mul' ? buildMultiplier(cfg) : buildAdder(cfg);
}

/** Tabela verdade do compressor 4:2 aproximado, comparada com a soma exata dos quatro bits. */
export function compressorTable() {
    const rows = [];
    for (let v = 0; v < 16; v++) {
        const x = [0, 1, 2, 3].map((k) => (v >> (3 - k)) & 1);
        const sum = (x[0] ^ x[1]) | (x[2] ^ x[3]);
        const carry = (x[0] & x[1]) | (x[2] & x[3]);
        const exact = x[0] + x[1] + x[2] + x[3];
        rows.push({ x, sum, carry, approx: 2 * carry + sum, exact, err: 2 * carry + sum - exact });
    }
    return rows;
}
