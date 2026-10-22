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

/** Técnicas de multiplicação. */
export const MUL_METHODS = ['array', 'booth', 'kulkarni', 'drum', 'mitchell'];

/** Descrição curta de uma configuração (usada na comparação). */
export function unitName(cfg) {
    const N = cfg.width;
    if (cfg.kind === 'mul') {
        const method = cfg.method ?? 'array';
        const comp = cfg.comp ? ' +C' : '';
        if (method === 'booth') return `MUL${N} BOOTH${cfg.kTrunc ? ` T${cfg.kTrunc}` : ''}${comp}`;
        if (method === 'kulkarni') return `MUL${N} KUL${(cfg.kBlock ?? 2 * N) >= 2 * N ? '' : cfg.kBlock}${comp}`;
        if (method === 'drum') return `MUL${N} DRUM${cfg.k}${comp}`;
        if (method === 'mitchell') return `MUL${N} MITCHELL${comp}`;
        const parts = [];
        if (cfg.kTrunc) parts.push(`T${cfg.kTrunc}`);
        if (cfg.kApprox) parts.push(`A${cfg.kApprox}${cfg.approxCarry === false ? '' : 'c'}`);
        return `MUL${N}${parts.length ? ` ${parts.join(' ')}` : ' exato'}${comp}`;
    }
    switch (cfg.adder) {
        case 'trunc': return `ADD${N} TRUNC${cfg.k}`;
        case 'loa': return `ADD${N} LOA${cfg.k}`;
        case 'seg': return `ADD${N} SEG L${cfg.L} P${cfg.P}`;
        default: return `ADD${N} exato`;
    }
}

/** Zona de cada coluna do multiplicador por colunas. */
export function mulZones(cfg) {
    const N = cfg.width, kT = cfg.kTrunc ?? 0, kA = cfg.kApprox ?? 0;
    return Array.from({ length: 2 * N }, (_, c) => (c < kT ? 'trunc' : c < kT + kA ? 'approx' : 'exact'));
}

/** Registra o custo (portas) de cada etapa do circuito. */
function stager(net) {
    const stages = [];
    return {
        stages,
        run(label, fn) {
            const g0 = net.gates;
            const r = fn();
            stages.push({ label, gates: net.gates - g0 });
            return r;
        },
    };
}

/**
 * Redução de colunas (Dadda) e soma final. Nas colunas 'approx', compressores 4:2 aproximados e OR na soma
 * final; nas 'trunc', saída 0; nas 'exact', somadores completos e propagação de vai um.
 * @returns {{out: number[], heights: number[][]}}
 */
function reduceColumns(net, cols, zones, approxCarry = true) {
    const C = cols.length;
    const byDepth = (x, y) => net.depth[x] - net.depth[y];
    const heights = [cols.map((x) => x.length)];
    // Redução de Dadda: alturas alvo 2, 3, 4, 6, 9, 13, ... A cada estágio, cada coluna é reduzida só o
    // necessário para não passar do alvo, contando os vai um que chegam da coluna anterior no mesmo estágio.
    const targets = [2];
    while (targets[targets.length - 1] < C) targets.push(Math.floor(targets[targets.length - 1] * 1.5));
    let ti = targets.findIndex((d) => d >= Math.max(...heights[0])) - 1;
    for (; ti >= 0; ti--) {
        const d = targets[ti];
        if (cols.every((x) => x.length <= d)) continue;
        const next = Array.from({ length: C + 1 }, () => []);
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
        cols = next.slice(0, C);
        heights.push(cols.map((x) => x.length));
    }
    // Soma final: OR nas colunas aproximadas, propagação de vai um nas exatas.
    const out = [];
    let carry = 0;
    let lastApprox = null;
    let c0 = C;
    cols.forEach((bits, c) => {
        if (c >= c0) return;
        if (zones[c] === 'trunc') { out.push(0); return; }
        if (zones[c] === 'approx') {
            out.push(bits.length === 2 ? net.or(bits[0], bits[1]) : bits[0] ?? 0);
            lastApprox = bits;
            return;
        }
        // Primeira coluna exata: daqui até o fim, uma soma de duas linhas com propagação de vai um.
        if (lastApprox && approxCarry) {
            // Como no LOA: o vem um da primeira coluna exata é o AND dos dois bits da última coluna aproximada.
            carry = lastApprox.length === 2 ? net.and(lastApprox[0], lastApprox[1]) : 0;
        }
        c0 = c;
        const rest = cols.slice(c);
        const { sums } = net.rippleAdd(rest.map((x) => x[0] ?? 0), rest.map((x) => x[1] ?? 0), carry);
        out.push(...sums);
    });
    return { out: out.slice(0, C), heights };
}

/** Detector do 1 mais significativo: um fio por posição, em 1 só na posição do bit mais alto em 1. */
function leadingOne(net, x) {
    const N = x.length;
    const h = new Array(N);
    let above = 0;   // OU dos bits acima da posição atual
    for (let p = N - 1; p >= 0; p--) {
        h[p] = above === 0 ? x[p] : net.and(x[p], net.not(above));
        above = above === 0 ? x[p] : net.or(above, x[p]);
    }
    return { h, any: above };
}

/** Deslocamento para a esquerda por um valor binário (barrel shifter em estágios de multiplexadores). */
function shiftLeft(net, x, amount, width) {
    let v = Array.from({ length: width }, (_, i) => x[i] ?? 0);
    amount.forEach((s, k) => {
        const d = 2 ** k;
        v = v.map((w, i) => net.mux(s, i >= d ? v[i - d] : 0, w));
    });
    return v;
}

/** Multiplicador por colunas (truncamento e compressores aproximados). */
function arrayMultiplier(cfg, net, a, b, st) {
    const N = cfg.width;
    const zones = mulZones(cfg);
    const cols = Array.from({ length: 2 * N }, () => []);
    const dots = [];
    st.run('produtos parciais (AND)', () => {
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                const c = i + j;
                dots.push({ row: j, c, zone: zones[c] });
                if (zones[c] !== 'trunc') cols[c].push(net.and(a[i], b[j]));
            }
        }
    });
    const r = st.run('redução e soma final', () => reduceColumns(net, cols, zones, cfg.approxCarry !== false));
    return { out: r.out, heights: r.heights, zones, dots, rows: Array.from({ length: N }, (_, j) => `b${j}`) };
}

/**
 * Booth radix 4, com sinal (complemento de 2): cada par de bits de b, com o bit anterior, escolhe 0, ±a ou ±2a,
 * e o multiplicador soma N/2 produtos parciais em vez de N. Os produtos parciais negativos são o complemento de
 * cada bit mais 1 na coluna mais baixa da linha; o sinal é estendido até a coluna 2N - 1. As colunas abaixo de
 * kTrunc são truncadas.
 */
function boothMultiplier(cfg, net, a, b, st) {
    const N = cfg.width, kT = cfg.kTrunc ?? 0;
    const zones = Array.from({ length: 2 * N }, (_, c) => (c < kT ? 'trunc' : 'exact'));
    const cols = Array.from({ length: 2 * N }, () => []);
    const dots = [];
    const put = (c, w, row, cls) => {
        if (c >= 2 * N) return;
        dots.push({ row, c, zone: zones[c], cls });
        if (zones[c] !== 'trunc') cols[c].push(w);
    };
    const R = N / 2;
    st.run('codificação de Booth e produtos parciais', () => {
        for (let j = 0; j < R; j++) {
            const b0 = 2 * j - 1 >= 0 ? b[2 * j - 1] : 0, b1 = b[2 * j], b2 = b[2 * j + 1];
            const one = net.xor(b1, b0);
            const two = net.or(net.and(b2, net.and(net.not(b1), net.not(b0))), net.and(net.not(b2), net.and(b1, b0)));
            const neg = b2;
            const ai = (i) => (i < 0 ? 0 : i >= N ? a[N - 1] : a[i]);
            const pp = [];
            for (let i = 0; i <= N; i++) pp.push(net.xor(net.or(net.and(one, ai(i)), net.and(two, ai(i - 1))), neg));
            for (let i = 0; i <= N; i++) put(2 * j + i, pp[i], j, i === N ? 'sign' : undefined);
            for (let c = 2 * j + N + 1; c < 2 * N; c++) put(c, pp[N], j, 'ext');
            put(2 * j, neg, R, 'neg');
        }
    });
    const r = st.run('redução e soma final', () => reduceColumns(net, cols, zones));
    return { out: r.out, heights: r.heights, zones, dots, rows: [...Array.from({ length: R }, (_, j) => `pp${j}`), 'neg'] };
}

/**
 * Multiplicador hierárquico com blocos 2 x 2 (Kulkarni, Gupta e Ercegovac, 2011): o bloco aproximado dá 7 em vez
 * de 9 para 3 x 3, com três bits de saída em vez de quatro. Os blocos de peso (coluna) abaixo de kBlock são
 * aproximados; os produtos dos blocos são somados de forma exata.
 */
function kulkarniMultiplier(cfg, net, a, b, st) {
    const N = cfg.width, M = N / 2, kB = cfg.kBlock ?? 2 * N;
    const zones = Array.from({ length: 2 * N }, () => 'exact');
    const cols = Array.from({ length: 2 * N }, () => []);
    const dots = [];
    st.run('blocos 2 x 2', () => {
        for (let j = 0; j < M; j++) {
            for (let i = 0; i < M; i++) {
                const w = 2 * (i + j);
                const approx = w < kB;
                const [a0, a1, b0, b1] = [a[2 * i], a[2 * i + 1], b[2 * j], b[2 * j + 1]];
                const p00 = net.and(a0, b0), p10 = net.and(a1, b0), p01 = net.and(a0, b1), p11 = net.and(a1, b1);
                const bits = approx ? [p00, net.or(p10, p01), p11]
                    : [p00, net.xor(p10, p01), net.xor(p11, net.and(p10, p01)), net.and(p11, net.and(p10, p01))];
                bits.forEach((x, t) => {
                    cols[w + t].push(x);
                    dots.push({ row: 2 * j + (i % 2), c: w + t, zone: approx ? 'approx' : 'exact' });
                });
            }
        }
    });
    const r = st.run('soma dos blocos (redução e soma final)', () => reduceColumns(net, cols, zones));
    return { out: r.out, heights: r.heights, zones: Array.from({ length: 2 * N }, (_, c) => (c < kB ? 'approx' : 'exact')), dots, rows: Array.from({ length: N }, (_, r2) => (r2 % 2 ? '' : `b${r2 + 1}b${r2}`)) };
}

/**
 * DRUM (Hashemi, Bahar e Reda, 2015): de cada operando, só os k bits a partir do 1 mais significativo entram num
 * multiplicador exato k x k; o bit mais baixo do trecho vira 1 (para tirar o viés do truncamento) e o produto é
 * deslocado de volta. Operandos menores que 2^k passam inteiros.
 */
function drumMultiplier(cfg, net, a, b, st) {
    const N = cfg.width, k = Math.max(2, Math.min(N - 1, cfg.k ?? 4));
    const S = N - k;   // deslocamento máximo
    const slice = (x) => {
        const { h } = leadingOne(net, x);
        // Posição p >= k: o trecho é x[p .. p-k+1] e o deslocamento é p - k + 1 (codificado em one-hot).
        const sel = Array.from({ length: S + 1 }, (_, s) => (s === 0 ? null : h[s + k - 1]));
        const big = net.orAll(sel.slice(1));
        sel[0] = net.not(big);
        const bits = [];
        for (let t = 0; t < k; t++) bits.push(net.orAll(sel.map((sw, s) => net.and(sw, x[s + t]))));
        bits[0] = net.or(bits[0], big);   // bit mais baixo em 1 quando houve truncamento
        return { bits, sel };
    };
    const A = st.run('detector do 1 mais alto e seleção dos k bits', () => slice(a));
    const B = st.run('detector do 1 mais alto e seleção dos k bits', () => slice(b));
    const prod = st.run(`multiplicador exato ${k} x ${k}`, () => {
        const cols = Array.from({ length: 2 * k }, () => []);
        for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) cols[i + j].push(net.and(A.bits[i], B.bits[j]));
        return reduceColumns(net, cols, Array(2 * k).fill('exact')).out;
    });
    const out = st.run('deslocamento de volta', () => {
        // Deslocamento total sa + sb: primeiro por sa, depois por sb (seleção one-hot em cada etapa).
        const shiftBy = (v, sel) => Array.from({ length: 2 * N }, (_, i) => net.orAll(sel.map((sw, s) => (i - s >= 0 && i - s < v.length ? net.and(sw, v[i - s]) : 0))));
        return shiftBy(shiftBy(prod, A.sel), B.sel);
    });
    return { out, k };
}

/**
 * Multiplicador logarítmico de Mitchell (1962): log2(x) é aproximado por p + f, com p a posição do 1 mais alto e
 * f os bits abaixo dele como fração. Somam-se os logaritmos e o antilogaritmo é aproximado do mesmo jeito:
 * P = 2^(pa + pb + c) (1 + (fa + fb mod 1)), onde c é o vai um da soma das frações. Erra sempre para baixo,
 * no máximo 11,1%.
 */
function mitchellMultiplier(cfg, net, a, b, st) {
    const N = cfg.width, F = N - 1, E = Math.ceil(Math.log2(N));
    const logOf = (x) => {
        const { h, any } = leadingOne(net, x);
        // Característica (posição do 1) em binário e fração alinhada: x << (N - 1 - p), sem o 1.
        const pos = Array.from({ length: E }, (_, bit) => net.orAll(h.map((hw, p) => ((p >> bit) & 1 ? hw : 0))));
        const frac = Array.from({ length: F }, (_, t) => net.orAll(h.map((hw, p) => (t - (F - p) >= 0 && t - (F - p) < p ? net.and(hw, x[t - (F - p)]) : 0))));
        return { pos, frac, any };
    };
    const A = st.run('logaritmo de a (detector do 1 e normalização)', () => logOf(a));
    const B = st.run('logaritmo de b (detector do 1 e normalização)', () => logOf(b));
    const { K, M } = st.run('soma dos logaritmos', () => {
        const s = net.rippleAdd(A.frac, B.frac, 0);
        const k = net.rippleAdd([...A.pos, 0], [...B.pos, 0], s.cout);
        return { K: k.sums, M: [...s.sums, 1] };   // mantissa 1.fração, F + 1 bits
    });
    const out = st.run('antilogaritmo (deslocamento)', () => {
        const wide = shiftLeft(net, M, K, 2 * N + F);
        const nz = net.and(A.any, B.any);
        return wide.slice(F, F + 2 * N).map((w) => net.and(w, nz));
    });
    return { out };
}

/**
 * @param {{width: number, method?: string, kTrunc?: number, kApprox?: number, approxCarry?: boolean,
 *          kBlock?: number, k?: number, comp?: boolean}} cfg
 */
export function buildMultiplier(cfg) {
    const N = cfg.width;
    const method = cfg.method ?? 'array';
    const net = new Netlist();
    const a = net.input('a', N), b = net.input('b', N);
    const st = stager(net);
    const build = { array: arrayMultiplier, booth: boothMultiplier, kulkarni: kulkarniMultiplier, drum: drumMultiplier, mitchell: mitchellMultiplier }[method];
    const r = build(cfg, net, a, b, st);
    const signed = method === 'booth';
    const sx = (v, w) => (v >= 2 ** (w - 1) ? v - 2 ** w : v);
    const unit = {
        kind: 'mul', cfg, net, method, signed,
        zones: r.zones ?? null, dots: r.dots ?? null, rows: r.rows ?? null, heights: r.heights ?? null, stages: st.stages,
        exact: signed ? (x, y) => sx(x, N) * sx(y, N) + 0 : (x, y) => x * y,
        decode: signed ? (y) => sx(y, 2 * N) : null,
        outBits: 2 * N, maxOut: signed ? 2 ** (2 * N - 2) : (2 ** N - 1) ** 2,
    };
    let out = r.out;
    if (cfg.comp) {
        // Compensação do viés: soma uma constante igual ao erro médio, medido com entradas uniformes no circuito
        // sem compensação (é fixada no projeto, não depende dos dados de cada aplicação).
        net.outputs = out;
        const C = Math.round(-meanError(unit));
        unit.compConst = C;
        if (C !== 0 && (signed || C > 0)) {
            out = st.run(`compensação (${C > 0 ? '+' : ''}${C})`, () => {
                const r2 = net.rippleAdd(out, net.constant(((C % 2 ** (2 * N)) + 2 ** (2 * N)) % 2 ** (2 * N), 2 * N), 0);
                // Sem sinal, a soma satura no maior valor em vez de dar a volta.
                return signed ? r2.sums : r2.sums.map((w) => net.or(w, r2.cout));
            });
        }
    }
    net.outputs = out;
    return unit;
}

/** Erro médio com sinal da unidade com entradas uniformes (exaustivo até 8 bits). */
function meanError(unit) {
    const N = unit.cfg.width;
    let n, as, bs;
    if (N <= 8) {
        n = 2 ** (2 * N);
        as = new Uint32Array(n); bs = new Uint32Array(n);
        for (let k = 0; k < n; k++) { as[k] = k >>> N; bs[k] = k & (2 ** N - 1); }
    } else {
        n = 20000;
        as = new Uint32Array(n); bs = new Uint32Array(n);
        let s = 777;
        const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s >>> 8; };
        for (let k = 0; k < n; k++) { as[k] = r() % 2 ** N; bs[k] = r() % 2 ** N; }
    }
    const y = unit.net.evaluate(as, bs);
    let sum = 0;
    for (let k = 0; k < n; k++) sum += (unit.decode ? unit.decode(y[k]) : y[k]) - unit.exact(as[k], bs[k]);
    return sum / n;
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

/**
 * Modelo funcional do somador: a mesma soma que o circuito de buildAdder dá, calculada com aritmética (os testes
 * conferem os dois em todos os pares de 8 bits e em pares sorteados de 16). Serve para aplicações com muitas somas
 * em sequência, como a acumulação da rede neural, em que avaliar o circuito porta a porta seria lento.
 */
export function adderFunction(cfg) {
    const N = cfg.width;
    // Aritmética em vez de operações bit a bit (as do JavaScript são de 32 bits com sinal): vale até N = 32.
    const P = (n) => 2 ** n;
    const field = (x, lo, hi) => Math.floor(x / P(lo)) % P(hi - lo);
    const bit = (x, i) => Math.floor(x / P(i)) % 2;
    if (cfg.adder === 'trunc' || cfg.adder === 'loa') {
        const k = Math.min(cfg.k ?? 0, N);
        if (cfg.adder === 'trunc') return (a, b) => (Math.floor(a / P(k)) + Math.floor(b / P(k))) * P(k);
        return (a, b) => {
            const cin = k > 0 ? bit(a, k - 1) & bit(b, k - 1) : 0;
            // Bits baixos: a OU b, bit a bit (a | b sem sinal, nos k bits de baixo).
            const low = k > 0 ? ((field(a, 0, k) | field(b, 0, k)) >>> 0) % P(k) : 0;
            return (Math.floor(a / P(k)) + Math.floor(b / P(k)) + cin) * P(k) + low;
        };
    }
    if (cfg.adder === 'seg') {
        const L = Math.max(1, cfg.L ?? 4), Pp = Math.max(0, cfg.P ?? 0);
        return (a, b) => {
            let res = 0, cout = 0;
            for (let s = 0; s < N; s += L) {
                const hi = Math.min(N, s + L), lo = Math.max(0, s - Pp);
                const cin = s === 0 || Pp === 0 ? 0 : Math.floor((field(a, lo, s) + field(b, lo, s)) / P(s - lo));
                const sum = field(a, s, hi) + field(b, s, hi) + cin;
                res += (sum % P(hi - s)) * P(s);
                cout = Math.floor(sum / P(hi - s));
            }
            return res + cout * P(N);
        };
    }
    return (a, b) => a + b;
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
