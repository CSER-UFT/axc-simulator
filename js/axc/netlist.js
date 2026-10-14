/**
 * Circuito combinacional no nível de portas, com avaliação "bit a bit em paralelo" (bit slicing): cada fio guarda
 * uma palavra de 32 bits, e cada bit da palavra é um vetor de teste diferente. Assim uma passagem pelo circuito
 * avalia 32 pares de entradas de uma vez, e a avaliação exaustiva de um multiplicador de 8 bits (65536 pares)
 * custa só 2048 passagens.
 *
 * Modelo de custo didático: a área é o número de portas de duas entradas (AND, OR, XOR) e o atraso é a
 * profundidade lógica, contando uma unidade por porta. Não é o resultado de uma síntese: serve para comparar
 * as técnicas entre si. As células (FA, HA, compressor) são contadas à parte para mostrar a estrutura.
 */

export const OP = { AND: 0, OR: 1, XOR: 2 };

export class Netlist {
    constructor() {
        this.n = 1;              // fio 0 é a constante 0
        this.ops = [];           // [op, out, x, y]
        this.depth = [0];
        this.inputs = {};        // nome -> lista de fios (bit 0 primeiro)
        this.outputs = [];       // fios da saída (bit 0 primeiro)
        this.cells = { AND: 0, OR: 0, XOR: 0, FA: 0, HA: 0, AC: 0 };
        this.gates = 0;
    }

    input(name, width) {
        const ws = [];
        for (let i = 0; i < width; i++) { ws.push(this.n); this.depth.push(0); this.n++; }
        this.inputs[name] = ws;
        return ws;
    }

    gate(op, x, y) {
        // Simplificações com a constante 0: não geram porta.
        if (op === OP.AND && (x === 0 || y === 0)) return 0;
        if ((op === OP.OR || op === OP.XOR) && x === 0) return y;
        if ((op === OP.OR || op === OP.XOR) && y === 0) return x;
        const out = this.n++;
        this.ops.push(op, out, x, y);
        this.depth.push(Math.max(this.depth[x], this.depth[y]) + 1);
        this.gates++;
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
                W[prog[p + 1]] = op === 0 ? x & y : op === 1 ? x | y : x ^ y;
            }
            for (let k = 0; k < m; k++) {
                let v = 0;
                for (let j = 0; j < nOut; j++) if ((W[this.outputs[j]] >>> k) & 1) v += 2 ** j;
                out[base + k] = v;
            }
        }
        return out;
    }

    /** Avaliação de um único par, porta a porta (referência para os testes). */
    evaluateOne(a, b) {
        const v = new Uint8Array(this.n);
        this.inputs.a.forEach((w, i) => { v[w] = (a >>> i) & 1; });
        this.inputs.b.forEach((w, i) => { v[w] = (b >>> i) & 1; });
        for (let p = 0; p < this.ops.length; p += 4) {
            const [op, o, x, y] = this.ops.slice(p, p + 4);
            v[o] = op === 0 ? v[x] & v[y] : op === 1 ? v[x] | v[y] : v[x] ^ v[y];
        }
        return this.outputs.reduce((s, w, j) => s + v[w] * 2 ** j, 0);
    }
}
