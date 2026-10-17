/**
 * Operações que aceitam unidade aproximada e os modelos funcionais (bit a bit) das unidades da biblioteca.
 *
 *   multiplicação  qualquer multiplicador da largura da operação. Os sem sinal recebem os módulos dos operandos e o
 *                  sinal é aplicado depois (sinal e módulo, como a largura da operação já supõe); o de Booth (com
 *                  sinal, complemento de 2) só quando os dois operandos cabem na faixa com sinal da largura;
 *   soma           qualquer somador da largura, se os operandos e o resultado não são negativos (as unidades são sem
 *                  sinal e não têm vem um, então subtrações e somas com sinal ficam exatas). No somador de 32 bits
 *                  (dois de 16 em cascata), o de baixo pode ser qualquer somador de 16 bits e o de cima é exato;
 *   modelo         o mesmo circuito da página de unidades: tabela exaustiva para 8 bits, avaliação da netlist com
 *                  memória para os multiplicadores de 16 bits, e o modelo aritmético conferido nos testes para os
 *                  somadores.
 */
import { buildUnit, adderFunction } from '../axc/units.js';
import { opClass, opWidth } from './lib.js';
import { affSource } from './elab.js';

const SYM = { add: '+', sub: '−', mul: '×' };

const OPTXT = { add: '+', sub: '−', mul: '×', and: '&', or: '|', xor: '^' };
/** Texto de um operando, para a tabela de operações: variáveis pelo nome, leituras e subexpressões curtas. */
function argText(seg, a, loops, depth = 0) {
    if (a.c !== undefined) return String(a.c);
    const n = seg.byId.get(a.n);
    if (!n) return a.n;
    if (n.op === 'load') return `${n.array}[${n.idx.map((x) => affSource(x, loops)).join('][')}]`;
    if (n.op === 'iv') return affSource(n.aff, loops);
    if (n.op === 'in' || n.op === 'carry') return n.name;
    if (n.name && depth > 0) return n.name;
    if (depth > 1) return '…';
    const A = (k) => argText(seg, n.args[k], loops, depth + 1);
    const wrap = (t) => (depth > 0 ? `(${t})` : t);
    switch (n.op) {
        case 'shl': return wrap(`${A(0)} × ${2 ** n.args[1].c}`);
        case 'shr': return wrap(`${A(0)} >> ${n.args[1].c}`);
        case 'trunc': return A(0);
        case 'not': return `~${A(0)}`;
        case 'cmp': return wrap(`${A(0)} ${n.cond} ${A(1)}`);
        case 'sel': return wrap(`${A(0)} ? ${A(1)} : ${A(2)}`);
        default: return OPTXT[n.op] ? wrap(`${A(0)} ${OPTXT[n.op]} ${A(1)}`) : n.name ?? n.id;
    }
}

/**
 * Operações de soma e multiplicação do projeto, com as unidades que cada uma aceita (a primeira é a exata).
 * @returns {{list: object[], byId: Map<string, object>, groups: Map<string, object[]>}}
 */
export function approxOps(design, lib) {
    const list = [];
    for (const seg of design.segments) {
        const rangeOf = (id) => seg.byId.get(id).range;
        for (const n of seg.nodes) {
            const cls = opClass(n);
            if (cls !== 'mul' && cls !== 'add') continue;
            const W = opWidth(n, rangeOf);
            const ranges = n.args.map((a) => (a.c !== undefined ? [a.c, a.c] : rangeOf(a.n)));
            let candidates = lib.candidates(cls, W);
            let reason = null;
            if (cls === 'add') {
                if (n.op !== 'add') reason = 'sub';
                else if (ranges.some((r) => r[0] < 0) || n.range[0] < 0) reason = 'signed';
                if (reason) candidates = candidates.slice(0, 1);
            } else {
                const lo = -(2 ** (W - 1)), hi = 2 ** (W - 1) - 1;
                const fitsSigned = ranges.every((r) => r[0] >= lo && r[1] <= hi);
                candidates = candidates.filter((name) => lib.unit(name).cfg.method !== 'booth' || fitsSigned);
            }
            const text = `${argText(seg, n.args[0], design.loops, 1)} ${SYM[n.op]} ${argText(seg, n.args[1], design.loops, 1)}`;
            list.push({ id: n.id, node: n, seg, cls, W, candidates, reason, text, label: `${n.op} de ${W} bits`, group: `${n.line}:${n.op}${W}` });
        }
    }
    const groups = new Map();
    for (const op of list) {
        if (!groups.has(op.group)) groups.set(op.group, []);
        groups.get(op.group).push(op);
    }
    return { list, byId: new Map(list.map((o) => [o.id, o])), groups };
}

// Modelos funcionais -------------------------------------------------------------------------------------------
const FN = new Map();

/** Modelo funcional de uma unidade pelo nome: f(a, b) com os operandos já codificados na largura da unidade. */
export function unitFunction(lib, name) {
    if (FN.has(name)) return FN.get(name);
    const u = lib.unitByName(name);
    const cfg = u.cfg;
    let f, signed = false;
    if (cfg.kind === 'add') {
        if (cfg.width === 32) {
            const lo = adderFunction(cfg.low);
            const M = 65536;
            f = (a, b) => {
                const l = lo(a % M, b % M);
                return (Math.floor(a / M) + Math.floor(b / M) + Math.floor(l / M)) * M + (l % M);
            };
        } else f = adderFunction(cfg);
    } else {
        const unit = buildUnit(cfg);
        signed = !!unit.signed;
        const N = cfg.width;
        const dec = unit.decode ?? ((y) => y);
        if (N <= 8) {
            const n = 2 ** (2 * N);
            const as = new Uint32Array(n), bs = new Uint32Array(n);
            for (let k = 0; k < n; k++) { as[k] = k >>> N; bs[k] = k & (2 ** N - 1); }
            const y = unit.net.evaluate(as, bs);
            const lut = Float64Array.from(y, dec);
            f = (a, b) => lut[(a << N) | b];
        } else {
            const memo = new Map();
            const one = [new Uint32Array(1), new Uint32Array(1)];
            f = (a, b) => {
                const key = a * 65536 + b;
                let v = memo.get(key);
                if (v === undefined) {
                    one[0][0] = a; one[1][0] = b;
                    v = dec(unit.net.evaluate(one[0], one[1])[0]);
                    memo.set(key, v);
                }
                return v;
            };
        }
    }
    const entry = { name, cfg, signed, f };
    FN.set(name, entry);
    return entry;
}

/** Função (x, y) -> valor da operação do nó feita pela unidade (valores inteiros com sinal, como no kernel). */
export function opFunction(lib, op, name) {
    const { f, signed, cfg } = unitFunction(lib, name);
    if (op.cls === 'add') return f;
    if (signed) {
        const M = 2 ** cfg.width;
        const code = (v) => ((v % M) + M) % M;
        return (x, y) => f(code(x), code(y));
    }
    return (x, y) => {
        const r = f(Math.abs(x), Math.abs(y));
        return (x < 0) !== (y < 0) && r !== 0 ? -r : r;
    };
}

/** Técnica de uma unidade, para agrupar as opções (array, booth, kulkarni, drum, mitchell; trunc, loa, seg). */
export function technique(lib, name) {
    const cfg = lib.unitByName(name).cfg;
    if (cfg.kind === 'add') return cfg.width === 32 ? `${technique(lib, `ADD16 ${name.match(/\(ADD16 (.+?) \+/)?.[1] ?? 'exato'}`)}` : cfg.adder ?? 'exact';
    const m = cfg.method ?? 'array';
    if (m === 'array' && !cfg.kTrunc && !cfg.kApprox) return cfg.comp ? 'array' : 'exact';
    return m;
}

/**
 * Atribuição a partir de um texto: entradas separadas por ';', cada uma "alvo=unidade", com o alvo um nó (S2.5), um
 * grupo (linha:operação e largura, como 23:mul8), uma classe e largura (mul8, add16, add32) ou '*' (todas as
 * operações em que a unidade serve).
 * @returns {Map<string, string>}
 */
export function parseAssign(ops, spec) {
    const out = new Map();
    for (const part of String(spec ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
        const k = part.indexOf('=');
        if (k < 0) throw new Error(`atribuição sem '=': ${part}`);
        const target = part.slice(0, k).trim(), name = part.slice(k + 1).trim();
        let list;
        if (ops.byId.has(target)) list = [ops.byId.get(target)];
        else if (ops.groups.has(target)) list = ops.groups.get(target);
        else if (/^(mul|add)\d+$/.test(target)) list = ops.list.filter((o) => `${o.cls}${o.W}` === target);
        else if (target === '*') list = ops.list.filter((o) => o.candidates.includes(name));
        else throw new Error(`alvo desconhecido: ${target} (use o id do nó, linha:op, como 23:mul8, a classe, como mul8, ou *)`);
        if (!list.length) throw new Error(`nenhuma operação em ${target}`);
        for (const o of list) {
            if (!o.candidates.includes(name)) throw new Error(`${name} não serve para ${o.id} (${o.label}${o.reason ? `, ${o.reason === 'sub' ? 'subtração' : 'com sinal'}` : ''})`);
            out.set(o.id, name);
        }
    }
    return out;
}
