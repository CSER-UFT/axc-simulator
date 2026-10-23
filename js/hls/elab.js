/**
 * Elaboração do kernel: execução simbólica da AST, que produz a hierarquia de laços mantidos em hardware e, em cada
 * trecho reto de código, o grafo de fluxo de dados (DFG).
 *
 *   laços      com pipeline: todos os laços internos são desenrolados por completo (como no Vitis); com unroll sem
 *              fator: desenrolado por completo; com unroll factor=U: o corpo é replicado U vezes e o laço roda
 *              trip/U iterações; sem diretiva: mantido, uma iteração depois da outra;
 *   valores    constantes são dobradas (inclusive as tabelas const indexadas por constantes); as variáveis dos laços
 *              mantidos são simbólicas, e os índices dos vetores são expressões afins delas;
 *   faixas     cada valor tem a faixa [mín, máx] (análise de intervalos), que dá a largura de cada operação: é ela que
 *              escolhe a unidade de 8, 16 ou 32 bits. Ao ser guardado numa variável, o valor é limitado pelo tipo
 *              declarado (com aviso se a faixa não couber: haveria estouro);
 *   memórias   os vetores dos parâmetros, os locais e as tabelas const lidas com índice variável são memórias; cada
 *              acesso sabe o seu banco (array_partition cyclic, block ou complete);
 *   recorrência variável escalar declarada fora de um laço mantido e alterada dentro dele: o valor da iteração
 *              anterior entra no DFG como 'carry' e o novo sai como 'carryout', com a aresta de distância 1.
 */
import { HlsError, parsePragma, typeOf } from './lang.js';
import { mulQ32 } from '../axc/nn.js';

/** Reescala das redes (a função requantize do C): (acc × m + 2^31) >> 32, mais z, saturada entre 0 e 255. */
export const requantValue = (acc, m, z) => Math.min(255, Math.max(0, mulQ32(acc, m) + z));

const MAX_UNROLL = 4096;

// Faixas ----------------------------------------------------------------------------------------------------
export const typeRange = (ty) => (ty.signed ? [-(2 ** (ty.bits - 1)), 2 ** (ty.bits - 1) - 1] : [0, 2 ** ty.bits - 1]);
/** Bits para representar a faixa (com sinal, se houver negativos). */
export function bitsFor([lo, hi]) {
    if (lo >= 0) return Math.max(1, Math.ceil(Math.log2(hi + 1)));
    const m = Math.max(-lo, hi + 1);
    return Math.ceil(Math.log2(m)) + 1;
}
/** Bits do módulo (para os multiplicadores sem sinal, com o sinal tratado à parte). */
export const magBits = ([lo, hi]) => Math.max(1, Math.ceil(Math.log2(Math.max(Math.abs(lo), Math.abs(hi)) + 1)));

const R = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1]],
    sub: (a, b) => [a[0] - b[1], a[1] - b[0]],
    mul: (a, b) => { const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; return [Math.min(...p), Math.max(...p)]; },
    neg: (a) => [-a[1], -a[0]],
    union: (a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
};

// Afins: { c: número, t: { simbolo: coeficiente } } ------------------------------------------------------------
const affConst = (c) => ({ c, t: {} });
const affIsConst = (a) => Object.keys(a.t).length === 0;
function affAdd(a, b, s = 1) {
    const t = { ...a.t };
    for (const [k, v] of Object.entries(b.t)) { t[k] = (t[k] ?? 0) + s * v; if (!t[k]) delete t[k]; }
    return { c: a.c + s * b.c, t };
}
const affScale = (a, k) => ({ c: a.c * k, t: Object.fromEntries(Object.entries(a.t).map(([s, v]) => [s, v * k]).filter(([, v]) => v)) });
/** Texto de uma expressão afim nas variáveis do código (i, x, ...) em vez das iterações dos laços (L1, L2). */
export function affSource(a, loops) {
    const byId = new Map(loops.map((l) => [l.id, l]));
    let c = a.c;
    const parts = [];
    for (const [s, k] of Object.entries(a.t)) {
        const l = byId.get(s);
        const su = l?.step !== undefined ? l.step * (l.factor ?? 1) : null;
        if (!l || !su || k % su) { parts.push(k === 1 ? s : `${k}*${s}`); continue; }
        const m = k / su;
        c -= m * l.start;
        parts.push(m === 1 ? l.v : m === -1 ? `-${l.v}` : `${m}*${l.v}`);
    }
    if (c || !parts.length) parts.push(String(c));
    return parts.join(' + ').replace(/\+ -/g, '- ');
}
export const affText = (a) => {
    const parts = Object.entries(a.t).map(([s, v]) => (v === 1 ? s : v === -1 ? `-${s}` : `${v}*${s}`));
    if (a.c || !parts.length) parts.push(String(a.c));
    return parts.join(' + ').replace(/\+ -/g, '- ');
};

/**
 * Valores da execução simbólica:
 *   { k: 'const', v }                    constante
 *   { k: 'aff', a, range }               expressão afim das variáveis de laços mantidos (só índices e contadores)
 *   { k: 'node', id, seg, range }         saída de um nó do DFG de um trecho
 */
const cval = (v) => ({ k: 'const', v, range: [v, v] });

export function elaborate(ast, { ports = 2 } = {}) {
    const fn = ast.funcs[ast.funcs.length - 1];
    const warnings = [];
    const warn = (msg, line) => { if (!warnings.some((w) => w.msg === msg && w.line === line)) warnings.push({ msg, line }); };
    const arrays = new Map();
    const loops = [];
    const loopOf = new Map();
    const allocation = {};
    const evalConst = (e, env) => {
        const v = constValue(e, env);
        if (v === null) throw new HlsError('esperada uma expressão constante', e.line);
        return v;
    };

    // Vetores: parâmetros, tabelas const globais e locais.
    function addArray(name, type, dimsAst, kind, init, line, env) {
        const dims = dimsAst.map((d) => evalConst(d, env));
        if (!dims.length) return null;
        if (dims.length > 2) throw new HlsError('vetores de no máximo 2 dimensões', line);
        const size = dims.reduce((s, d) => s * d, 1);
        let flat = null;
        if (init) {
            flat = [];
            const walk = (x) => (x.k === 'list' ? x.items.forEach(walk) : flat.push(evalConst(x, env)));
            walk(init);
            if (flat.length !== size) {
                if (flat.length > size) throw new HlsError(`inicialização de ${name} com ${flat.length} valores para ${size} posições`, line);
                while (flat.length < size) flat.push(0);
            }
        }
        const arr = { name, type, dims, size, kind, init: flat, line, partition: null, ports, accesses: 0 };
        arrays.set(name, arr);
        return arr;
    }
    for (const p of fn.params) {
        if (!p.dims.length) throw new HlsError(`parâmetro escalar ${p.name}: use vetores para as entradas e saídas do kernel`, p.line);
        addArray(p.name, p.type, p.dims, 'param', null, p.line, new Map());
    }
    for (const d of ast.top) {
        if (d.k === 'decl' && d.dims.length && d.isConst) addArray(d.name, d.type, d.dims, 'rom', d.init, d.line, new Map());
    }
    const applyFunctionPragma = (p) => {
        if (p.name === 'array_partition') {
            const arr = arrays.get(p.opts.variable);
            if (!arr) throw new HlsError(`array_partition: vetor ${p.opts.variable} desconhecido`, p.line);
            const type = p.opts.type ?? (p.opts.complete ? 'complete' : p.opts.block ? 'block' : 'cyclic');
            const dim = p.opts.dim ?? 1;
            if (dim < 0 || dim > arr.dims.length) throw new HlsError(`array_partition: dim=${dim} inválida para ${arr.name}`, p.line);
            arr.partition = { type, factor: type === 'complete' ? (dim === 0 ? arr.size : arr.dims[dim - 1]) : p.opts.factor ?? 2, dim };
        } else if (p.name === 'allocation') {
            const op = String(p.opts.instances ?? '').toLowerCase();
            if (!['add', 'mul', 'sub'].includes(op)) throw new HlsError('allocation: instances=add ou instances=mul', p.line);
            allocation[op === 'sub' ? 'add' : op] = p.opts.limit;
        } else if (p.name === 'interface' || p.name === 'inline') {
            // aceitas e ignoradas
        } else return false;
        return true;
    };

    // Construção dos trechos (segmentos) e regiões ----------------------------------------------------------
    let segCount = 0;
    let dryDepth = 0;
    let dryBudget = 0; // iterações que o passo seco ainda pode executar com valores concretos
    const newSeg = (region) => ({ id: `S${++segCount}`, region, nodes: [], liveIn: new Map(), cse: new Map() });
    const top = { id: 'top', loop: null, items: [], parent: null };
    let region = top;
    let seg = null;
    const curSeg = () => {
        if (!seg) { seg = newSeg(region); region.items.push({ k: 'seg', seg }); }
        return seg;
    };
    const closeSeg = () => { seg = null; };
    const PURE = new Set(['add', 'sub', 'mul', 'shl', 'shr', 'and', 'or', 'xor', 'not', 'cmp', 'sel', 'trunc', 'rq']);
    const COMM = new Set(['add', 'mul', 'and', 'or', 'xor']);
    // Origem de cada operação: a expressão do código e as iterações dos laços desenrolados por estarem dentro de um
    // pipeline (cópias diferentes, como os pesos de uma janela). As cópias pedidas com a diretiva unroll (com ou sem
    // fator) têm a mesma origem: fazem o mesmo trabalho sobre dados diferentes.
    const astIds = new WeakMap();
    let astCount = 0, exprNow = null;
    const copyStack = [];
    const originOf = () => {
        if (!exprNow) return null;
        if (!astIds.has(exprNow)) astIds.set(exprNow, ++astCount);
        return `e${astIds.get(exprNow)}${copyStack.length ? `@${copyStack.join(',')}` : ''}`;
    };
    const emit = (op, args, range, line, extra = {}) => {
        const s = curSeg();
        // Subexpressões comuns: a mesma operação sobre os mesmos operandos, no mesmo trecho, é reaproveitada; e a
        // mesma leitura de memória também, enquanto não houver escrita no mesmo vetor.
        let key = null;
        if (dryDepth) { /* no passo seco só as faixas interessam */ } else if (PURE.has(op)) {
            const a = args.map((x) => (x.n !== undefined ? `n${x.n}` : `c${x.c}`));
            if (COMM.has(op)) a.sort();
            key = `${op}:${extra.cond ?? ''}:${extra.bits ?? ''}:${a.join(',')}`;
        } else if (op === 'load') key = `load:${extra.text}`;
        if (key && s.cse.has(key)) return s.cse.get(key);
        if (op === 'store' && !dryDepth) for (const k of [...s.cse.keys()]) if (k.startsWith(`load:${extra.array}[`)) s.cse.delete(k);
        const node = { id: `${s.id}.${s.nodes.length}`, op, args, range, line, origin: originOf(), ...extra };
        if (dryDepth) { s.dryCount = (s.dryCount ?? 0) + 1; node.id = `${s.id}.d${s.dryCount}`; } else s.nodes.push(node);
        const v = { k: 'node', id: node.id, seg: s, range, node };
        if (key) s.cse.set(key, v);
        return v;
    };
    /** Valor utilizável no trecho atual: um nó de outro trecho vira entrada (registrador). */
    function use(v, line) {
        if (v.k === 'const') return v;
        if (v.k === 'aff') {
            if (affIsConst(v.a)) return cval(v.a.c);
            const key = `iv:${affText(v.a)}`;
            const s = curSeg();
            if (!s.liveIn.has(key)) s.liveIn.set(key, emit('iv', [], v.range, line, { text: affText(v.a), aff: v.a }));
            return s.liveIn.get(key);
        }
        if (v.seg === curSeg()) return v;
        const s = curSeg();
        const key = v.id;
        if (!s.liveIn.has(key)) {
            if (!dryDepth) v.node.liveOut = true;
            s.liveIn.set(key, emit('in', [], v.range, line, { from: v.id, name: v.node.name ?? v.id }));
        }
        return s.liveIn.get(key);
    }

    // Operações, com dobra de constantes e simplificações.
    const asArg = (v) => (v.k === 'const' ? { c: v.v } : { n: v.id });
    function op2(kind, a, b, line) {
        if (a.k === 'const' && b.k === 'const') return cval(foldBin(kind, a.v, b.v, line));
        if (a.k === 'aff' && b.k === 'aff' && (kind === '+' || kind === '-')) return { k: 'aff', a: affAdd(a.a, b.a, kind === '-' ? -1 : 1), range: R[kind === '+' ? 'add' : 'sub'](a.range, b.range) };
        if (a.k === 'aff' && b.k === 'const' && (kind === '+' || kind === '-')) return { k: 'aff', a: affAdd(a.a, affConst(b.v), kind === '-' ? -1 : 1), range: R[kind === '+' ? 'add' : 'sub'](a.range, b.range) };
        if (a.k === 'const' && b.k === 'aff' && kind === '+') return op2('+', b, a, line);
        if (a.k === 'aff' && b.k === 'const' && kind === '*') return { k: 'aff', a: affScale(a.a, b.v), range: R.mul(a.range, b.range) };
        if (a.k === 'const' && b.k === 'aff' && kind === '*') return op2('*', b, a, line);
        // Identidades.
        if (kind === '+' && b.k === 'const' && b.v === 0) return a;
        if (kind === '+' && a.k === 'const' && a.v === 0) return b;
        if (kind === '-' && b.k === 'const' && b.v === 0) return a;
        if (kind === '*' && ((b.k === 'const' && b.v === 0) || (a.k === 'const' && a.v === 0))) return cval(0);
        if (kind === '*' && b.k === 'const' && b.v === 1) return a;
        if (kind === '*' && a.k === 'const' && a.v === 1) return b;
        const A = use(a, line), B = use(b, line);
        switch (kind) {
            case '+': return emit('add', [asArg(A), asArg(B)], R.add(A.range, B.range), line);
            case '-': return emit('sub', [asArg(A), asArg(B)], R.sub(A.range, B.range), line);
            case '*': {
                // Multiplicação por potência de 2 (constante): deslocamento, só fios.
                const c = A.k === 'const' ? A : B.k === 'const' ? B : null;
                const x = c === A ? B : A;
                if (c && c.v > 0 && (c.v & (c.v - 1)) === 0) return emit('shl', [asArg(x), { c: Math.log2(c.v) }], R.mul(x.range, c.range), line);
                return emit('mul', [asArg(A), asArg(B)], R.mul(A.range, B.range), line);
            }
            case '/': case '%': {
                if (B.k !== 'const' || B.v <= 0 || (B.v & (B.v - 1))) throw new HlsError(`divisão e resto só por constante potência de 2 (o kernel não tem divisor)`, line);
                if (A.range[0] < 0) throw new HlsError('divisão de valor com sinal por potência de 2 não suportada (use >>)', line);
                const k = Math.log2(B.v);
                if (kind === '/') return emit('shr', [asArg(A), { c: k }], [Math.floor(A.range[0] / B.v), Math.floor(A.range[1] / B.v)], line);
                return emit('and', [asArg(A), { c: B.v - 1 }], [0, Math.min(B.v - 1, A.range[1])], line);
            }
            case '<<': {
                if (B.k !== 'const') throw new HlsError('deslocamento só por constante (sem deslocador variável)', line);
                return emit('shl', [asArg(A), { c: B.v }], [A.range[0] * 2 ** B.v, A.range[1] * 2 ** B.v], line);
            }
            case '>>': {
                if (B.k !== 'const') throw new HlsError('deslocamento só por constante (sem deslocador variável)', line);
                return emit('shr', [asArg(A), { c: B.v }], [Math.floor(A.range[0] / 2 ** B.v), Math.floor(A.range[1] / 2 ** B.v)], line);
            }
            case '&': case '|': case '^': {
                const bits = Math.max(bitsFor(A.range), bitsFor(B.range));
                const neg = A.range[0] < 0 || B.range[0] < 0;
                let range = neg ? [-(2 ** (bits - 1)), 2 ** (bits - 1) - 1] : [0, 2 ** bits - 1];
                if (kind === '&' && !neg) range = [0, Math.min(A.range[1], B.range[1])];
                return emit({ '&': 'and', '|': 'or', '^': 'xor' }[kind], [asArg(A), asArg(B)], range, line);
            }
            case '<': case '<=': case '>': case '>=': case '==': case '!=':
                return emit('cmp', [asArg(A), asArg(B)], [0, 1], line, { cond: kind });
            case '&&': case '||':
                return emit(kind === '&&' ? 'and' : 'or', [asArg(A), asArg(B)], [0, 1], line);
            default: throw new HlsError(`operador ${kind} não suportado`, line);
        }
    }
    function select(c, a, b, line) {
        if (c.k === 'const') return c.v ? a : b;
        if (a.k === 'const' && b.k === 'const' && a.v === b.v) return a;
        const C = use(c, line), A = use(a, line), B = use(b, line);
        return emit('sel', [asArg(C), asArg(A), asArg(B)], R.union(A.range, B.range), line);
    }

    /** Expressão: valor simbólico. */
    function evalExpr(e, env) {
        const prev = exprNow;
        exprNow = e;
        try { return evalExpr0(e, env); } finally { exprNow = prev; }
    }
    function evalExpr0(e, env) {
        switch (e.k) {
            case 'num': return cval(e.v);
            case 'var': {
                if (!env.has(e.name)) {
                    if (arrays.has(e.name)) throw new HlsError(`${e.name} é um vetor: use um índice`, e.line);
                    throw new HlsError(`variável ${e.name} não declarada`, e.line);
                }
                const s = env.get(e.name);
                if (s.value === undefined) throw new HlsError(`variável ${e.name} lida antes de receber valor`, e.line);
                return s.value;
            }
            case 'index': return load(e, env);
            case 'cast': {
                const v = evalExpr(e.e, env);
                return clampType(v, e.type, e.line, true);
            }
            case 'un': {
                const v = evalExpr(e.e, env);
                if (e.op === '-') {
                    if (v.k === 'const') return cval(-v.v);
                    if (v.k === 'aff') return { k: 'aff', a: affScale(v.a, -1), range: R.neg(v.range) };
                    return op2('-', cval(0), v, e.line);
                }
                if (e.op === '!') return v.k === 'const' ? cval(v.v ? 0 : 1) : op2('==', v, cval(0), e.line);
                if (v.k === 'const') return cval(~v.v);
                const A = use(v, e.line);
                return emit('not', [asArg(A)], [-(A.range[1]) - 1, -(A.range[0]) - 1], e.line);
            }
            case 'bin': return op2(e.op, evalExpr(e.a, env), evalExpr(e.b, env), e.line);
            case 'sel': return select(evalExpr(e.c, env), evalExpr(e.a, env), evalExpr(e.b, env), e.line);
            case 'call': {
                const args = e.args.map((x) => evalExpr(x, env));
                if (e.name === 'min' || e.name === 'max') {
                    if (args.length !== 2) throw new HlsError(`${e.name} recebe 2 argumentos`, e.line);
                    const [a, b] = args;
                    if (a.k === 'const' && b.k === 'const') return cval(Math[e.name](a.v, b.v));
                    const c = op2(e.name === 'min' ? '<' : '>', a, b, e.line);
                    const r = select(c, a, b, e.line);
                    if (r.k === 'node') r.node.range = r.range = e.name === 'min' ? [Math.min(a.range[0], b.range[0]), Math.min(a.range[1], b.range[1])] : [Math.max(a.range[0], b.range[0]), Math.max(a.range[1], b.range[1])];
                    return r;
                }
                if (e.name === 'abs') {
                    if (args.length !== 1) throw new HlsError('abs recebe 1 argumento', e.line);
                    const [a] = args;
                    if (a.k === 'const') return cval(Math.abs(a.v));
                    if (a.range[0] >= 0) return a;
                    const c = op2('<', a, cval(0), e.line);
                    const n = op2('-', cval(0), a, e.line);
                    const r = select(c, n, a, e.line);
                    const m = Math.max(Math.abs(a.range[0]), Math.abs(a.range[1]));
                    r.node.range = r.range = [a.range[1] < 0 ? -a.range[1] : 0, m];
                    return r;
                }
                if (e.name === 'requant') {
                    // Reescala das redes quantizadas: min(255, max(0, ((acc × m + 2^31) >> 32) + z)), uma peça exata.
                    if (args.length !== 3) throw new HlsError('requant recebe 3 argumentos (acc, m, z)', e.line);
                    if (args.every((a) => a.k === 'const')) return cval(requantValue(args[0].v, args[1].v, args[2].v));
                    const [A, M, Z] = args.map((a) => use(a, e.line));
                    return emit('rq', [asArg(A), asArg(M), asArg(Z)], [0, 255], e.line);
                }
                throw new HlsError(`função ${e.name} não suportada (só min, max, abs e requant)`, e.line);
            }
            default: throw new HlsError('expressão não suportada', e.line);
        }
    }

    /** Limita um valor à faixa do tipo (atribuição ou conversão). */
    function clampType(v, type, line, isCast = false) {
        const tr = typeRange(type);
        if (v.range[0] >= tr[0] && v.range[1] <= tr[1]) return v;
        if (v.k === 'const') return cval(wrap(v.v, type));
        if (!isCast) warn(`a faixa [${v.range[0]}, ${v.range[1]}] não cabe em ${type.name}: haverá estouro`, line);
        const A = use(v, line);
        return emit('trunc', [asArg(A)], tr, line, { bits: type.bits, signed: type.signed });
    }

    // Memórias ------------------------------------------------------------------------------------------------
    function indexValues(e, arr, env) {
        if (e.idx.length !== arr.dims.length) throw new HlsError(`${arr.name} tem ${arr.dims.length} dimensões`, e.line);
        return e.idx.map((x, d) => {
            const v = evalExpr(x, env);
            if (v.k === 'const') {
                if (v.v < 0 || v.v >= arr.dims[d]) throw new HlsError(`índice ${v.v} fora de ${arr.name} (dimensão ${d + 1} tem ${arr.dims[d]})`, e.line);
                return affConst(v.v);
            }
            if (v.k === 'aff') {
                if (v.range[0] < 0 || v.range[1] >= arr.dims[d]) throw new HlsError(`índice de ${arr.name} pode sair da dimensão ${d + 1} (faixa [${v.range[0]}, ${v.range[1]}])`, e.line);
                return v.a;
            }
            throw new HlsError(`índice de ${arr.name} não é afim nas variáveis dos laços (calculado a partir de dados)`, e.line);
        });
    }
    /** Banco de um acesso: chave (acessos com a mesma chave caem sempre no mesmo banco) e se é exata. */
    function bankOf(arr, idx) {
        const p = arr.partition;
        if (!p) return { key: `${arr.name}`, banks: 1, label: arr.name };
        if (p.type === 'complete') return null;
        const d = p.dim === 0 ? 0 : p.dim - 1;
        const a = p.dim === 0 ? affAdd(affScale(idx[0], arr.dims[1] ?? 1), idx[1] ?? affConst(0)) : idx[d];
        const F = p.factor;
        if (p.type === 'cyclic') {
            const free = Object.entries(a.t).filter(([, v]) => v % F !== 0);
            const resid = ((a.c % F) + F) % F;
            if (!free.length) return { key: `${arr.name}#${resid}`, banks: F, exact: true, label: `${arr.name} b${resid}` };
            const expr = affText({ c: resid, t: Object.fromEntries(free.map(([k, v]) => [k, v % F])) });
            return { key: `${arr.name}#${free.map(([k, v]) => `${v % F}${k}`).join('')}+${resid}`, banks: F, label: `${arr.name} (${expr}) mod ${F}` };
        }
        const B = Math.ceil((p.dim === 0 ? arr.size : arr.dims[d]) / F);
        if (affIsConst(a)) return { key: `${arr.name}#${Math.floor(a.c / B)}`, banks: F, exact: true, label: `${arr.name} b${Math.floor(a.c / B)}` };
        return { key: `${arr.name}#?`, banks: F, label: `${arr.name} (bloco?)` };
    }
    const elemName = (arr, idx) => `${arr.name}[${idx.map((a) => a.c).join('][')}]`;
    function load(e, env) {
        const arr = arrays.get(e.name);
        if (!arr) {
            if (env.has(e.name)) throw new HlsError(`${e.name} é escalar`, e.line);
            throw new HlsError(`vetor ${e.name} não declarado`, e.line);
        }
        const idx = indexValues(e, arr, env);
        const constIdx = idx.every(affIsConst);
        const flatOf = (ix) => (ix.length === 2 ? ix[0].c * arr.dims[1] + ix[1].c : ix[0].c);
        if (arr.kind === 'rom' && constIdx) return cval(arr.init[flatOf(idx)]);
        if (arr.partition?.type === 'complete') {
            if (!constIdx) throw new HlsError(`${arr.name} está particionado por completo: o índice precisa ser constante depois do desenrolamento`, e.line);
            const name = elemName(arr, idx);
            const s = env.get(name);
            if (s?.value) return s.value;
            if (arr.kind === 'param') {
                // Registrador de entrada (porta do kernel com partição completa).
                const v = emit('in', [], typeRange(arr.type), e.line, { name, port: true });
                env.set(name, { type: arr.type, value: v });
                return v;
            }
            throw new HlsError(`${name} lido antes de receber valor`, e.line);
        }
        arr.accesses++;
        // Tabela constante: a faixa é a dos valores guardados, não a do tipo.
        const lr = arr.kind === 'rom' ? [Math.min(...arr.init), Math.max(...arr.init)] : typeRange(arr.type);
        return emit('load', [], lr, e.line, { array: arr.name, idx, bank: bankOf(arr, idx), text: `${arr.name}[${idx.map(affText).join('][')}]` });
    }
    function store(target, value, env, line) {
        const arr = arrays.get(target.name);
        if (arr.kind === 'rom') throw new HlsError(`${arr.name} é constante`, line);
        const idx = indexValues(target, arr, env);
        const v = clampType(value, arr.type, line);
        if (arr.partition?.type === 'complete') {
            if (!idx.every(affIsConst)) throw new HlsError(`${arr.name} está particionado por completo: o índice precisa ser constante`, line);
            const name = elemName(arr, idx);
            env.set(name, { type: arr.type, value: v });
            if (arr.kind === 'param') {
                const V = use(v, line);
                emit('out', [asArg(V)], V.range, line, { name, port: true });
            }
            return;
        }
        arr.accesses++;
        const V = use(v, line);
        emit('store', [asArg(V)], V.range, line, { array: arr.name, idx, bank: bankOf(arr, idx), text: `${arr.name}[${idx.map(affText).join('][')}]` });
    }

    // Comandos ------------------------------------------------------------------------------------------------
    function assign(s, env) {
        const t = s.target;
        const cur = () => evalExpr(t, env);
        let v = evalExpr(s.e, env);
        if (s.op !== '=') { const prev = exprNow; exprNow = s; try { v = op2(s.op.slice(0, -1), cur(), v, s.line); } finally { exprNow = prev; } }
        if (t.k === 'var') {
            const sym = env.get(t.name);
            if (!sym) throw new HlsError(`variável ${t.name} não declarada`, s.line);
            if (sym.loopVar) throw new HlsError(`a variável do laço ${t.name} não pode ser alterada no corpo`, s.line);
            const val = clampType(v, sym.type, s.line);
            if (val.k === 'node' && !val.node.name) val.node.name = t.name;
            sym.value = val;
            if (sym.dryOuter) env.markWritten(sym.dryOuter);
        } else if (t.k === 'index') store(t, v, env, s.line);
        else throw new HlsError('destino de atribuição inválido', s.line);
    }

    function exec(stmts, env, ctx) {
        for (const s of stmts) {
            switch (s.k) {
                case 'block': exec(s.body, new Scope(env), ctx); break;
                case 'pragma': {
                    const p = parsePragma(s.text, s.line);
                    if (!applyFunctionPragma(p) && !['pipeline', 'unroll', 'loop_tripcount', 'loop_flatten', 'dependence'].includes(p.name)) warn(`diretiva ${p.name} ignorada`, s.line);
                    break;
                }
                case 'decl': {
                    if (s.dims.length) {
                        const arr = addArray(s.name, s.type, s.dims, s.isConst ? 'rom' : 'ram', s.init, s.line, env);
                        if (s.init && !s.isConst) throw new HlsError('vetor local com inicialização deve ser const', s.line);
                        if (arr.kind === 'rom') break;
                        break;
                    }
                    const sym = { type: s.type, value: undefined };
                    env.declare(s.name, sym);
                    if (s.init) sym.value = clampType(evalExpr(s.init, env), s.type, s.line);
                    break;
                }
                case 'assign': assign(s, env); break;
                case 'for': forLoop(s, env, ctx); break;
                default: throw new HlsError('comando não suportado', s.line);
            }
        }
    }

    function loopPragmas(s) {
        const body = s.body.k === 'block' ? s.body.body : [s.body];
        const out = { pipeline: null, unroll: null, pragmas: [] };
        for (const b of body) {
            if (b.k !== 'pragma') continue;
            const p = parsePragma(b.text, b.line);
            if (p.name === 'pipeline') out.pipeline = { II: p.opts.ii ?? 1, line: p.line, off: !!p.opts.off };
            if (p.name === 'unroll') out.unroll = { factor: p.opts.factor ?? null, line: p.line, off: !!p.opts.off };
        }
        if (out.pipeline?.off) out.pipeline = null;
        if (out.unroll?.off) out.unroll = null;
        return out;
    }

    function tripOf(s, env) {
        const start = evalConst(s.start, env), bound = evalConst(s.bound, env), step = evalConst(s.step, env);
        if (!step) throw new HlsError('passo do for igual a zero', s.line);
        const values = [];
        for (let v = start; values.length <= 1e7; v += step) {
            const ok = s.cmp === '<' ? v < bound : s.cmp === '<=' ? v <= bound : s.cmp === '>' ? v > bound : s.cmp === '>=' ? v >= bound : v !== bound;
            if (!ok) break;
            values.push(v);
            if (values.length > 1e6) throw new HlsError('laço com mais de um milhão de iterações', s.line);
        }
        return { start, step, values };
    }

    function forLoop(s, env, ctx) {
        const dir = loopPragmas(s);
        const { start, step, values } = tripOf(s, env);
        const trip = values.length;
        // Um laço desenrolado dentro de outro é executado várias vezes: a entrada na lista é uma só.
        let info = dryDepth ? null : loopOf.get(s);
        if (!info) {
            info = { id: `L${loops.length + 1}`, label: s.label ?? null, line: s.line, v: s.v, trip, parent: ctx.loop?.id ?? null, pipeline: dir.pipeline, unroll: dir.unroll, mode: null, factor: 1 };
            loops.push(info);
            if (!dryDepth) loopOf.set(s, info);
        }
        const name = info.label ?? info.id;
        // No passo seco, os laços internos rodam com valores concretos enquanto houver orçamento (faixas exatas).
        const dryConcrete = dryDepth > 0 && dryBudget >= trip;
        if (dryConcrete) dryBudget -= trip;
        const full = ctx.inPipeline || dryConcrete || (dir.unroll && (dir.unroll.factor === null || dir.unroll.factor >= trip));
        if (dir.pipeline && ctx.inPipeline) warn(`pipeline de ${name} ignorado: o laço externo já tem pipeline e o desenrola`, dir.pipeline.line);
        if (full) {
            info.mode = 'unrolled'; // no passo seco a entrada é descartada depois
            if (trip > MAX_UNROLL) throw new HlsError(`desenrolar ${name} geraria ${trip} cópias do corpo`, s.line);
            // Desenrolado por estar dentro de um pipeline: cada iteração é uma origem diferente; pela diretiva unroll,
            // as iterações são cópias da mesma origem.
            const implicit = !(dir.unroll && (dir.unroll.factor === null || dir.unroll.factor >= trip));
            for (const v of values) {
                const sc = new Scope(env);
                sc.declare(s.v, { type: typeOf('int'), value: cval(v), loopVar: true });
                if (implicit) copyStack.push(`${info.id}=${v}`);
                try { exec(s.body.k === 'block' ? s.body.body : [s.body], sc, ctx); } finally { if (implicit) copyStack.pop(); }
            }
            return;
        }
        // Laço mantido em hardware (com unroll parcial, o corpo é replicado U vezes).
        const U = dir.unroll?.factor ?? 1;
        if (U > 1 && trip % U) throw new HlsError(`unroll factor=${U} não divide as ${trip} iterações de ${name}`, dir.unroll.line);
        info.mode = dir.pipeline ? 'pipelined' : 'sequential';
        info.factor = U;
        info.tripHw = trip / U;
        info.II = dir.pipeline?.II ?? null;
        info.start = start;
        info.step = step;
        const sym = info.id;
        const ivRange = [Math.min(start, values[trip - 1]), Math.max(start, values[trip - 1])];
        // Passo seco: quais variáveis de fora o corpo altera (recorrências).
        const { written, finals, exact } = dryRun(s, env, sym, U, start, step, ivRange, dir, values);
        closeSeg();
        const parentRegion = region;
        const child = { id: sym, loop: info, items: [], parent: parentRegion };
        parentRegion.items.push({ k: 'loop', region: child });
        region = child;
        const sc = new Scope(env);
        const carries = new Map();
        for (const name2 of written) {
            const outerSym = env.lookup(name2);
            if (!outerSym || outerSym.value === undefined) continue;
            const prev = outerSym.value;
            // Faixa da recorrência: o crescimento de uma iteração (passo seco) vezes o número de iterações.
            const tr = typeRange(outerSym.type);
            const fin = finals.get(name2);
            let range = tr;
            const bound = prev.k === 'node' ? prev.node.bound : null;
            const monotone = fin && fin[0] >= prev.range[0] && fin[1] >= prev.range[1];
            if (fin && exact) range = [Math.max(tr[0], Math.min(prev.range[0], fin[0])), Math.min(tr[1], Math.max(prev.range[1], fin[1]))];
            else if (fin) {
                const T = trip / U;
                const lo = prev.range[0] + T * Math.min(0, fin[0] - prev.range[0]);
                const hi = prev.range[1] + T * Math.max(0, fin[1] - prev.range[1]);
                range = [Math.max(tr[0], Math.min(lo, prev.range[0])), Math.min(tr[1], Math.max(hi, prev.range[1]))];
            }
            // Acumulação que só cresce: os valores ficam dentro da faixa exata que o laço de fora já calculou.
            if (bound && monotone) range = [Math.max(range[0], bound[0]), Math.min(range[1], bound[1])];
            const c = emit('carry', [], range, s.line, { name: name2, init: prev.k === 'const' ? prev.v : null, initFrom: prev.k === 'node' ? prev.id : null, initAff: prev.k === 'aff' ? prev.a : null });
            // Faixa que vale para todos os valores da variável durante o laço (passo seco exato, acumulação monótona).
            if ((fin && exact) || (bound && monotone)) c.node.bound = range;
            carries.set(name2, { node: c.node, outerSym, prev });
            sc.declare(name2, { type: outerSym.type, value: c, carried: true });
        }
        for (let u = 0; u < U; u++) {
            const it = new Scope(sc);
            it.declare(s.v, { type: typeOf('int'), value: { k: 'aff', a: { c: start + step * u, t: { [sym]: step * U } }, range: ivRange }, loopVar: true });
            exec(s.body.k === 'block' ? s.body.body : [s.body], it, { loop: info, inPipeline: !!dir.pipeline });
        }
        // Fecha as recorrências: o valor final volta para a próxima iteração.
        for (const [name2, c] of carries) {
            const fin = sc.get(name2).value;
            const F = use(fin, s.line);
            emit('carryout', [asArg(F)], F.range, s.line, { name: name2, to: c.node.id });
            c.node.carryFrom = F.k === 'const' ? null : F.id;
        }
        closeSeg();
        region = parentRegion;
        // Depois do laço, o valor final fica num registrador.
        for (const [name2, c] of carries) {
            const fin = sc.get(name2).value;
            const tr = typeRange(c.outerSym.type);
            let rng = [Math.max(tr[0], Math.min(fin.range[0], c.node.range[0])), Math.min(tr[1], Math.max(fin.range[1], c.node.range[1]))];
            if (c.node.bound) rng = c.node.bound;
            c.outerSym.value = fin.k === 'const' ? fin : { ...fin, range: rng };
        }
        info.region = child;
    }

    function dryRun(s, env, sym, U, start, step, ivRange, dir, values) {
        // Executa o corpo numa cópia (sem emitir nada no projeto real) para saber o que ele escreve.
        const saved = { seg, region, segCount, accesses: [...arrays.values()].map((a) => a.accesses), nloops: loops.length, nwarn: warnings.length };
        if (dryDepth === 0) dryBudget = 20000;
        dryDepth++;
        let exact = false;
        const fake = { id: 'dry', loop: null, items: [], parent: null };
        region = fake;
        seg = null;
        const sc = new Scope(env, true);
        try {
            if (values.length <= dryBudget) {
                // Todas as iterações com o valor concreto da variável: as faixas acumulam exatamente.
                dryBudget -= values.length;
                exact = true;
                for (const v of values) {
                    const itc = new Scope(sc);
                    itc.declare(s.v, { type: typeOf('int'), value: cval(v), loopVar: true });
                    exec(s.body.k === 'block' ? s.body.body : [s.body], itc, { loop: { id: sym }, inPipeline: !!dir.pipeline });
                }
                U = 0; // nada mais a executar abaixo
            }
            const it = new Scope(sc);
            it.declare(s.v, { type: typeOf('int'), value: { k: 'aff', a: { c: start, t: { [sym]: step * U } }, range: ivRange }, loopVar: true });
            if (U > 0) exec(s.body.k === 'block' ? s.body.body : [s.body], it, { loop: { id: sym }, inPipeline: !!dir.pipeline });
            for (let u = 1; u < U; u++) {
                const it2 = new Scope(sc);
                it2.declare(s.v, { type: typeOf('int'), value: { k: 'aff', a: { c: start + step * u, t: { [sym]: step * U } }, range: ivRange }, loopVar: true });
                exec(s.body.k === 'block' ? s.body.body : [s.body], it2, { loop: { id: sym }, inPipeline: !!dir.pipeline });
            }
        } finally {
            dryDepth--;
            seg = saved.seg; region = saved.region; segCount = saved.segCount;
            [...arrays.values()].forEach((a, k) => { a.accesses = saved.accesses[k] ?? 0; });
            loops.length = saved.nloops;
            warnings.length = saved.nwarn;
        }
        const finals = new Map([...sc.writtenOuter].map((n) => [n, sc.vars.get(n)?.value?.range]).filter(([, v]) => v));
        return { written: sc.writtenOuter, finals, exact };
    }

    // Execução da função.
    const env = new Scope(null);
    for (const d of ast.top) if (d.k === 'decl' && !d.dims.length) {
        const sym = { type: d.type, value: d.init ? evalExpr(d.init, env) : undefined };
        env.declare(d.name, sym);
    }
    for (const d of ast.top) if (d.k === 'pragma') applyFunctionPragma(parsePragma(d.text, d.line));
    // Diretivas no início do corpo da função (array_partition, allocation) valem antes de tudo.
    const body = fn.body.k === 'block' ? fn.body.body : [fn.body];
    for (const b of body) {
        if (b.k !== 'pragma') continue;
        const p = parsePragma(b.text, b.line);
        if (p.name === 'allocation' || (p.name === 'array_partition' && arrays.has(p.opts.variable))) applyFunctionPragma(p);
    }
    exec(body, env, { loop: null, inPipeline: false });
    closeSeg();

    const segments = [];
    const walk = (r) => r.items.forEach((it) => (it.k === 'seg' ? segments.push(it.seg) : walk(it.region)));
    walk(top);
    // Valores iniciais de recorrências (um laço interno que continua o acumulador do externo) não são arestas do
    // DFG, mas precisam ficar.
    const initRefs = new Set();
    for (const sg of segments) for (const n of sg.nodes) if (n.initFrom) initRefs.add(n.initFrom);
    for (const sg of segments) finishSegment(sg, initRefs);
    return { name: fn.name, arrays: [...arrays.values()], loops, top, segments, warnings, allocation, ports };
}

/** Arestas do DFG de um trecho, a partir dos argumentos dos nós. */
function finishSegment(seg, initRefs) {
    const byId = new Map(seg.nodes.map((n) => [n.id, n]));
    for (const n of seg.nodes) {
        n.preds = n.args.filter((a) => a.n !== undefined && byId.has(a.n)).map((a) => a.n);
        n.succs = [];
    }
    for (const n of seg.nodes) for (const p of n.preds) byId.get(p).succs.push(n.id);
    // Remove nós sem uso (sem efeito e sem sucessores), de trás para frente.
    const live = new Set();
    const keep = (n) => ['store', 'out', 'carryout'].includes(n.op) || n.liveOut || initRefs.has(n.id);
    for (let k = seg.nodes.length - 1; k >= 0; k--) {
        const n = seg.nodes[k];
        if (keep(n) || n.succs.some((s) => live.has(s))) live.add(n.id);
    }
    seg.nodes = seg.nodes.filter((n) => live.has(n.id));
    for (const n of seg.nodes) n.succs = n.succs.filter((s) => live.has(s));
    seg.byId = new Map(seg.nodes.map((n) => [n.id, n]));
}

function wrap(v, type) {
    const m = 2 ** type.bits;
    let r = ((v % m) + m) % m;
    if (type.signed && r >= m / 2) r -= m;
    return r;
}
function foldBin(op, a, b, line) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (!b) throw new HlsError('divisão por zero', line); return Math.trunc(a / b);
        case '%': if (!b) throw new HlsError('divisão por zero', line); return a % b;
        case '<<': return a * 2 ** b;
        case '>>': return Math.floor(a / 2 ** b);
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
        case '<': return +(a < b);
        case '<=': return +(a <= b);
        case '>': return +(a > b);
        case '>=': return +(a >= b);
        case '==': return +(a === b);
        case '!=': return +(a !== b);
        case '&&': return +(a && b);
        case '||': return +(a || b);
        default: throw new HlsError(`operador ${op}`, line);
    }
}
function constValue(e, env) {
    switch (e.k) {
        case 'num': return e.v;
        case 'var': { const s = env.get?.(e.name); return s?.value?.k === 'const' ? s.value.v : null; }
        case 'un': { const v = constValue(e.e, env); if (v === null) return null; return e.op === '-' ? -v : e.op === '~' ? ~v : +!v; }
        case 'bin': { const a = constValue(e.a, env), b = constValue(e.b, env); return a === null || b === null ? null : foldBin(e.op, a, b, e.line); }
        case 'sel': { const c = constValue(e.c, env); return c === null ? null : constValue(c ? e.a : e.b, env); }
        case 'cast': return constValue(e.e, env);
        default: return null;
    }
}

/** Escopo de variáveis; no passo seco, registra as variáveis de fora que o corpo altera. */
class Scope {
    constructor(parent, dry = false) {
        this.parent = parent;
        this.vars = new Map();
        this.dry = dry || parent?.dry || false;
        this.dryRoot = dry ? this : parent?.dryRoot ?? null;
        if (dry) this.writtenOuter = new Set();
    }
    declare(name, sym) { if (this.vars.has(name) && !sym.loopVar) throw new HlsError(`variável ${name} declarada duas vezes`); this.vars.set(name, sym); }
    has(name) { return this.lookup(name) !== null; }
    lookup(name) { for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name); return null; }
    get(name) {
        // No passo seco, as variáveis de fora são copiadas para dentro na primeira leitura (sem alterar as originais).
        if (this.dryRoot) {
            for (let s = this; s; s = s.parent) {
                if (s.vars.has(name)) return s.vars.get(name);
                if (s === this.dryRoot) break;
            }
            const outer = this.dryRoot.parent?.lookup(name);
            if (!outer) return null;
            const copy = { ...outer, dryOuter: name };
            this.dryRoot.vars.set(name, copy);
            return copy;
        }
        return this.lookup(name);
    }
    set(name, sym) {
        for (let s = this; s; s = s.parent) {
            if (s.vars.has(name)) { s.vars.set(name, sym); return; }
            // No passo seco, nada de fora do corpo é alterado: a escrita fica numa cópia e é registrada.
            if (s === this.dryRoot) {
                if (s.parent?.lookup(name)) { s.vars.set(name, sym); this.markWritten(name); return; }
                break;
            }
        }
        this.vars.set(name, sym);
    }
    markWritten(name) { if (this.dryRoot) this.dryRoot.writtenOuter.add(name); }
}
