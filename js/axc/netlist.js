/**
 * Circuito combinacional no nível de portas, com avaliação "bit a bit em paralelo" (bit slicing): cada fio guarda
 * uma palavra de 32 bits, e cada bit da palavra é um vetor de teste diferente. Assim uma passagem pelo circuito
 * avalia 32 pares de entradas de uma vez, e a avaliação exaustiva de um multiplicador de 8 bits (65536 pares)
 * custa só 2048 passagens.
 *
 * Modelo de custo didático: a área é o número de portas de duas entradas (AND, OR, XOR; o inversor NOT também
 * conta uma) e o atraso é a profundidade lógica, contando uma unidade por porta. Não é o resultado de uma síntese: serve para comparar
 * as técnicas entre si. As células (FA, HA, compressor) são contadas à parte para mostrar a estrutura.
 */

export const OP = { AND: 0, OR: 1, XOR: 2, NOT: 3 };
/** Fios fixos: 0 é a constante 0 e 1 é a constante 1. */
export const ZERO = 0, ONE = 1;

export class Netlist {
    constructor() {
        this.n = 2;              // fio 0 é a constante 0; fio 1, a constante 1
        this.ops = [];           // [op, out, x, y]
        this.depth = [0, 0];
        this.notOf = new Map();  // inversores já criados (um por fio)
        this.inputs = {};        // nome -> lista de fios (bit 0 primeiro)
        this.outputs = [];       // fios da saída (bit 0 primeiro)
        this.cells = { AND: 0, OR: 0, XOR: 0, NOT: 0, FA: 0, HA: 0, AC: 0 };
        this.chains = [];        // somas com propagação de vai um (viram + no Verilog, para a síntese usar CARRY4)
        this.gates = 0;
    }

    input(name, width) {
        const ws = [];
        for (let i = 0; i < width; i++) { ws.push(this.n); this.depth.push(0); this.n++; }
        this.inputs[name] = ws;
        return ws;
    }

    gate(op, x, y) {
        // Simplificações com as constantes: não geram porta.
        if (op === OP.NOT) {
            if (x === ZERO) return ONE;
            if (x === ONE) return ZERO;
            if (this.notOf.has(x)) return this.notOf.get(x);
        } else {
            if (op === OP.AND && (x === ZERO || y === ZERO)) return ZERO;
            if (op === OP.AND && x === ONE) return y;
            if (op === OP.AND && y === ONE) return x;
            if (op === OP.OR && (x === ONE || y === ONE)) return ONE;
            if ((op === OP.OR || op === OP.XOR) && x === ZERO) return y;
            if ((op === OP.OR || op === OP.XOR) && y === ZERO) return x;
            if (op === OP.XOR && x === ONE) return this.single(OP.NOT, 'NOT', y);
            if (op === OP.XOR && y === ONE) return this.single(OP.NOT, 'NOT', x);
            if ((op === OP.AND || op === OP.OR) && x === y) return x;
            if (op === OP.XOR && x === y) return ZERO;
        }
        if (op === OP.NOT) y = x;
        const out = this.n++;
        this.ops.push(op, out, x, y);
        this.depth.push(Math.max(this.depth[x], this.depth[y]) + 1);
        this.gates++;
        if (op === OP.NOT) this.notOf.set(x, out);
        return out;
    }
    /** Porta avulsa (fora das células), contada pelo seu tipo. */
    single(op, name, x, y) {
        const g = this.gates;
        const w = this.gate(op, x, y);
        if (this.gates > g) this.cells[name]++;
        return w;
    }
    and(x, y) { return this.single(OP.AND, 'AND', x, y); }
    or(x, y) { return this.single(OP.OR, 'OR', x, y); }
    xor(x, y) { return this.single(OP.XOR, 'XOR', x, y); }
    not(x) { return this.single(OP.NOT, 'NOT', x); }
    /** Multiplexador 2:1: s ? x1 : x0. */
    mux(s, x1, x0) {
        if (s === ONE) return x1;
        if (s === ZERO) return x0;
        if (x1 === x0) return x1;
        return this.or(this.and(s, x1), this.and(this.not(s), x0));
    }
    /** OU de vários fios (árvore balanceada). */
    orAll(ws) {
        let q = ws.filter((w) => w !== ZERO);
        if (!q.length) return ZERO;
        while (q.length > 1) {
            const next = [];
            for (let k = 0; k + 1 < q.length; k += 2) next.push(this.or(q[k], q[k + 1]));
            if (q.length % 2) next.push(q[q.length - 1]);
            q = next;
        }
        return q[0];
    }
    /** Constante de w bits como fios (bit 0 primeiro). */
    constant(v, w) {
        return Array.from({ length: w }, (_, i) => (Math.floor(v / 2 ** i) % 2 ? ONE : ZERO));
    }

    /** Meio somador: [soma, vai um]. */
    ha(x, y) {
        this.cells.HA++;
        return [this.gate(OP.XOR, x, y), this.gate(OP.AND, x, y)];
    }

    /** Somador completo: [soma, vai um]. */
    fa(x, y, z) {
        this.cells.FA++;
        const p = this.gate(OP.XOR, x, y);
        const s = this.gate(OP.XOR, p, z);
        const c = this.gate(OP.OR, this.gate(OP.AND, x, y), this.gate(OP.AND, p, z));
        return [s, c];
    }

    /**
     * Compressor 4:2 aproximado, sem vem um e sem vai um entre colunas:
     *   soma = (x1 xor x2) or (x3 xor x4)      vai um = (x1 and x2) or (x3 and x4)
     * Representa x1 + x2 + x3 + x4 por 2 * vai um + soma; erra quando a soma real é 4 (dá 2) e quando os dois
     * pares têm exatamente um bit em 1 cada (dá 1 em vez de 2).
     */
    ac(x1, x2, x3, x4) {
        this.cells.AC++;
        const s = this.gate(OP.OR, this.gate(OP.XOR, x1, x2), this.gate(OP.XOR, x3, x4));
        const c = this.gate(OP.OR, this.gate(OP.AND, x1, x2), this.gate(OP.AND, x3, x4));
        return [s, c];
    }

    /**
     * Soma com propagação de vai um de dois vetores de fios (bit 0 primeiro) e um vem um.
     * Com carryOnly, só a cadeia de vai um (para prever o vem um de um bloco).
     * @returns {{sums: number[], cout: number}}
     */
    rippleAdd(xs, ys, cin = 0, { carryOnly = false } = {}) {
        const op0 = this.ops.length;
        const sums = [];
        let c = cin;
        for (let i = 0; i < xs.length; i++) {
            if (carryOnly) {
                c = this.or(this.and(xs[i], ys[i]), this.and(this.xor(xs[i], ys[i]), c));
                continue;
            }
            const bits = [xs[i], ys[i], c].filter((w) => w !== 0);
            if (bits.length === 3) { const [s, cy] = this.fa(...bits); sums.push(s); c = cy; }
            else if (bits.length === 2) { const [s, cy] = this.ha(...bits); sums.push(s); c = cy; }
            else { sums.push(bits[0] ?? 0); c = 0; }
        }
        this.chains.push({ xs: [...xs], ys: [...ys], cin, sums, cout: c, op0, op1: this.ops.length, carryOnly });
        return { sums, cout: c };
    }

    /** Atraso do circuito: maior profundidade entre as saídas. */
    delay() {
        return Math.max(0, ...this.outputs.map((w) => this.depth[w]));
    }

    /** Programa compacto para a avaliação. */
    compile() {
        if (!this.prog || this.prog.length !== this.ops.length) this.prog = Int32Array.from(this.ops);
        return this.prog;
    }

    /**
     * Avalia o circuito para uma lista de pares de entradas.
     * @param {Uint32Array|number[]} as
     * @param {Uint32Array|number[]} bs
     * @returns {Float64Array} saída de cada par (sem sinal)
     */
    evaluate(as, bs) {
        const prog = this.compile();
        const W = new Int32Array(this.n);
        const A = this.inputs.a, B = this.inputs.b;
        const out = new Float64Array(as.length);
        const nOut = this.outputs.length;
        W[ONE] = -1;
        for (let base = 0; base < as.length; base += 32) {
            const m = Math.min(32, as.length - base);
            for (let i = 0; i < A.length; i++) {
                let w = 0;
                for (let k = 0; k < m; k++) w |= ((as[base + k] >>> i) & 1) << k;
                W[A[i]] = w;
            }
            for (let i = 0; i < B.length; i++) {
                let w = 0;
                for (let k = 0; k < m; k++) w |= ((bs[base + k] >>> i) & 1) << k;
                W[B[i]] = w;
            }
            for (let p = 0; p < prog.length; p += 4) {
                const x = W[prog[p + 2]], y = W[prog[p + 3]];
                const op = prog[p];
                W[prog[p + 1]] = op === 0 ? x & y : op === 1 ? x | y : op === 2 ? x ^ y : ~x;
            }
            for (let k = 0; k < m; k++) {
                let v = 0;
                for (let j = 0; j < nOut; j++) if ((W[this.outputs[j]] >>> k) & 1) v += 2 ** j;
                out[base + k] = v;
            }
        }
        return out;
    }

    /**
     * Atividade de chaveamento: média, por operação, do número de saídas de porta que mudam de valor entre um
     * par de entradas e o seguinte. Multiplicada pela capacitância e por V², daria a energia dinâmica; aqui
     * serve como indicador relativo de energia entre as técnicas.
     */
    activity(as, bs) {
        const prog = this.compile();
        const W = new Int32Array(this.n);
        W[ONE] = -1;
        const A = this.inputs.a, B = this.inputs.b;
        const last = new Int8Array(this.n).fill(-1);
        const pop = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
        let toggles = 0;
        for (let base = 0; base < as.length; base += 32) {
            const m = Math.min(32, as.length - base);
            for (let i = 0; i < A.length; i++) { let w = 0; for (let k = 0; k < m; k++) w |= ((as[base + k] >>> i) & 1) << k; W[A[i]] = w; }
            for (let i = 0; i < B.length; i++) { let w = 0; for (let k = 0; k < m; k++) w |= ((bs[base + k] >>> i) & 1) << k; W[B[i]] = w; }
            const mask = m === 32 ? 0x7FFFFFFF : (2 ** (m - 1)) - 1;
            for (let p = 0; p < prog.length; p += 4) {
                const x = W[prog[p + 2]], y = W[prog[p + 3]], op = prog[p], o = prog[p + 1];
                const v = op === 0 ? x & y : op === 1 ? x | y : op === 2 ? x ^ y : ~x;
                W[o] = v;
                toggles += pop((v ^ (v >>> 1)) & mask);
                if (last[o] >= 0 && last[o] !== (v & 1)) toggles++;
                last[o] = (v >>> (m - 1)) & 1;
            }
        }
        return toggles / Math.max(1, as.length - 1);
    }

    /** Avaliação de um único par, porta a porta (referência para os testes). */
    evaluateOne(a, b) {
        const v = new Uint8Array(this.n);
        v[ONE] = 1;
        this.inputs.a.forEach((w, i) => { v[w] = (a >>> i) & 1; });
        this.inputs.b.forEach((w, i) => { v[w] = (b >>> i) & 1; });
        for (let p = 0; p < this.ops.length; p += 4) {
            const [op, o, x, y] = this.ops.slice(p, p + 4);
            v[o] = op === 0 ? v[x] & v[y] : op === 1 ? v[x] | v[y] : op === 2 ? v[x] ^ v[y] : 1 - v[x];
        }
        return this.outputs.reduce((s, w, j) => s + v[w] * 2 ** j, 0);
    }
}
