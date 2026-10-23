/**
 * Linguagem dos kernels: um subconjunto de C para síntese de alto nível, no estilo do Vitis HLS.
 *
 *   tipos      u8 u16 u32 i8 i16 i32 (também uint8_t ... int32_t, int, unsigned, char) e vetores de 1 ou 2 dimensões;
 *   constantes #define NOME valor, e vetores const com inicialização (tabelas de pesos);
 *   comandos   declarações, atribuições (= += -= *= <<= >>= &= |= ^=, ++ e --), for com limites constantes e
 *              rótulo opcional (rotulo: for ...), blocos;
 *   expressões + - * / % << >> & | ^ ~ comparações, ?: e as funções min, max e abs; / e % só por potência de 2;
 *              requant(acc, m, z), a reescala das redes quantizadas (uma peça exata, js/axc/nngen.js);
 *   diretivas  #pragma HLS pipeline [II=n], unroll [factor=n], array_partition variable=v [type=]cyclic|block|complete
 *              [factor=n] [dim=d], allocation operation instances=add|mul limit=n; array_partition vale por dimensão (uma
 *              diretiva por dimensão, os bancos das duas se combinam).
 *
 * O analisador produz uma árvore (AST) com a linha de cada nó; as diretivas viram comandos 'pragma' no lugar em que
 * aparecem, e a elaboração (elab.js) as associa ao laço que as contém ou à função.
 */

export class HlsError extends Error {
    constructor(msg, line) {
        super(line ? `linha ${line}: ${msg}` : msg);
        this.line = line;
    }
}

const TYPES = {
    u8: [8, false], u16: [16, false], u32: [32, false], i8: [8, true], i16: [16, true], i32: [32, true],
    uint8_t: [8, false], uint16_t: [16, false], uint32_t: [32, false], int8_t: [8, true], int16_t: [16, true], int32_t: [32, true],
    int: [32, true], unsigned: [32, false], char: [8, true], short: [16, true],
};
export const typeOf = (name) => (TYPES[name] ? { name, bits: TYPES[name][0], signed: TYPES[name][1] } : null);

const PUNCT = ['<<=', '>>=', '+=', '-=', '*=', '&=', '|=', '^=', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
    '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':', ';', ',', '(', ')', '[', ']', '{', '}'];

/** Pré-processamento: #define (constantes inteiras) e #pragma HLS (viram tokens). */
function tokenize(src) {
    const defines = new Map();
    const toks = [];
    const lines = src.split('\n');
    lines.forEach((raw, i) => {
        const line = i + 1;
        let text = raw.replace(/\/\/.*$/, '');
        const pp = /^\s*#\s*(\w+)\s*(.*)$/.exec(text);
        if (pp) {
            if (pp[1] === 'define') {
                const m = /^(\w+)\s+(.+)$/.exec(pp[2].trim());
                if (!m) throw new HlsError('#define inválido', line);
                defines.set(m[1], { text: m[2].trim(), line });
            } else if (pp[1] === 'pragma') {
                const m = /^HLS\s+(.*)$/i.exec(pp[2].trim());
                if (m) toks.push({ t: 'pragma', v: m[1].trim(), line });
            } else if (pp[1] !== 'include') throw new HlsError(`diretiva #${pp[1]} não suportada`, line);
            return;
        }
        let k = 0;
        while (k < text.length) {
            const c = text[k];
            if (/\s/.test(c)) { k++; continue; }
            if (text.startsWith('/*', k)) {
                const end = text.indexOf('*/', k + 2);
                if (end < 0) throw new HlsError('comentário /* sem fim na mesma linha', line);
                k = end + 2;
                continue;
            }
            const num = /^(0x[0-9a-fA-F]+|\d+)[uUlL]*/.exec(text.slice(k));
            if (num) { toks.push({ t: 'num', v: Number(num[1]), line }); k += num[0].length; continue; }
            const id = /^[A-Za-z_]\w*/.exec(text.slice(k));
            if (id) { toks.push({ t: 'id', v: id[0], line }); k += id[0].length; continue; }
            const p = PUNCT.find((q) => text.startsWith(q, k));
            if (!p) throw new HlsError(`caractere inesperado '${c}'`, line);
            toks.push({ t: 'p', v: p, line });
            k += p.length;
        }
    });
    toks.push({ t: 'eof', v: '', line: lines.length });
    return { toks, defines };
}

export function parse(src) {
    const { toks, defines } = tokenize(src);
    let pos = 0;
    const peek = (o = 0) => toks[pos + o];
    const next = () => toks[pos++];
    const is = (v, o = 0) => (peek(o).t === 'p' || peek(o).t === 'id') && peek(o).v === v;
    const expect = (v) => {
        if (!is(v)) throw new HlsError(`esperado '${v}', encontrado '${peek().v || peek().t}'`, peek().line);
        return next();
    };
    const ident = () => {
        if (peek().t !== 'id') throw new HlsError(`esperado um nome, encontrado '${peek().v}'`, peek().line);
        return next().v;
    };
    // #define: cada nome é uma expressão, analisada na hora do uso.
    const defineExprs = new Map();
    const defineExpr = (name, line) => {
        if (defineExprs.has(name)) return defineExprs.get(name);
        const d = defines.get(name);
        const sub = parse.__expr(d.text, d.line, defines);
        defineExprs.set(name, sub);
        return sub;
    };

    function primary() {
        const tk = peek();
        if (tk.t === 'num') { next(); return { k: 'num', v: tk.v, line: tk.line }; }
        if (is('(')) {
            next();
            // Conversão de tipo: (u8)(expr)
            if (peek().t === 'id' && typeOf(peek().v) && is(')', 1)) {
                const ty = typeOf(next().v);
                next();
                return { k: 'cast', type: ty, e: unary(), line: tk.line };
            }
            const e = expr();
            expect(')');
            return e;
        }
        if (tk.t === 'id') {
            next();
            if (defines.has(tk.v)) return defineExpr(tk.v, tk.line);
            if (is('(')) {
                next();
                const args = [];
                if (!is(')')) do args.push(expr()); while (is(',') && next());
                expect(')');
                return { k: 'call', name: tk.v, args, line: tk.line };
            }
            let node = { k: 'var', name: tk.v, line: tk.line };
            while (is('[')) {
                next();
                const idx = expr();
                expect(']');
                node = node.k === 'var' ? { k: 'index', name: tk.v, idx: [idx], line: tk.line } : { ...node, idx: [...node.idx, idx] };
            }
            return node;
        }
        throw new HlsError(`expressão inesperada em '${tk.v || tk.t}'`, tk.line);
    }
    function unary() {
        if (is('-') || is('~') || is('!') || is('+')) {
            const op = next();
            const e = unary();
            return op.v === '+' ? e : { k: 'un', op: op.v, e, line: op.line };
        }
        return primary();
    }
    const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    function binary(level) {
        if (level === BIN.length) return unary();
        let left = binary(level + 1);
        while (peek().t === 'p' && BIN[level].includes(peek().v)) {
            const op = next();
            const right = binary(level + 1);
            left = { k: 'bin', op: op.v, a: left, b: right, line: op.line };
        }
        return left;
    }
    function expr() {
        const c = binary(0);
        if (is('?')) {
            const q = next();
            const a = expr();
            expect(':');
            const b = expr();
            return { k: 'sel', c, a, b, line: q.line };
        }
        return c;
    }
    function initList() {
        if (!is('{')) return expr();
        next();
        const items = [];
        if (!is('}')) do items.push(initList()); while (is(',') && next() && !is('}'));
        expect('}');
        return { k: 'list', items };
    }
    function dims() {
        const d = [];
        while (is('[')) { next(); d.push(expr()); expect(']'); }
        return d;
    }
    function declaration(isConst) {
        const line = peek().line;
        const type = typeOf(ident());
        const decls = [];
        do {
            const name = ident();
            const dd = dims();
            let init = null;
            if (is('=')) { next(); init = initList(); }
            decls.push({ k: 'decl', type, name, dims: dd, init, isConst, line });
        } while (is(',') && next());
        expect(';');
        return decls.length === 1 ? decls[0] : { k: 'block', body: decls, line };
    }
    function simple() {
        // atribuição, ++/-- ou chamada
        const line = peek().line;
        const target = primary();
        if (is('++') || is('--')) {
            const op = next().v;
            return { k: 'assign', target, op: op === '++' ? '+=' : '-=', e: { k: 'num', v: 1, line }, line };
        }
        const ops = ['=', '+=', '-=', '*=', '<<=', '>>=', '&=', '|=', '^='];
        if (peek().t === 'p' && ops.includes(peek().v)) {
            const op = next().v;
            return { k: 'assign', target, op, e: expr(), line };
        }
        throw new HlsError('comando inválido (esperada uma atribuição)', line);
    }
    function forStmt(label) {
        const line = expect('for').line;
        expect('(');
        if (peek().t === 'id' && typeOf(peek().v)) next();
        const v = ident();
        expect('=');
        const start = expr();
        expect(';');
        const cv = ident();
        if (cv !== v) throw new HlsError('a condição do for deve usar a variável do laço', line);
        const cmp = next().v;
        if (!['<', '<=', '>', '>=', '!='].includes(cmp)) throw new HlsError('condição do for não suportada', line);
        const bound = expr();
        expect(';');
        const iv = ident();
        if (iv !== v) throw new HlsError('o incremento do for deve usar a variável do laço', line);
        let step;
        if (is('++')) { next(); step = { k: 'num', v: 1 }; } else if (is('--')) { next(); step = { k: 'num', v: -1 }; } else if (is('+=')) { next(); step = expr(); } else if (is('-=')) { next(); step = { k: 'un', op: '-', e: expr() }; } else throw new HlsError('incremento do for não suportado', line);
        expect(')');
        const body = statement();
        return { k: 'for', label, v, start, cmp, bound, step, body, line };
    }
    function statement() {
        const tk = peek();
        if (tk.t === 'pragma') { next(); return { k: 'pragma', text: tk.v, line: tk.line }; }
        if (is('{')) {
            next();
            const body = [];
            while (!is('}')) body.push(statement());
            next();
            return { k: 'block', body, line: tk.line };
        }
        if (is(';')) { next(); return { k: 'block', body: [], line: tk.line }; }
        if (is('for')) return forStmt(null);
        if (tk.t === 'id' && is(':', 1) && is('for', 2)) { next(); next(); return forStmt(tk.v); }
        if (is('return')) { next(); expect(';'); return { k: 'block', body: [], line: tk.line }; }
        if (is('if') || is('while') || is('do')) throw new HlsError(`'${tk.v}' não é suportado no kernel: use o operador ?: ou um for com limite constante`, tk.line);
        if (is('const')) { next(); return declaration(true); }
        if (tk.t === 'id' && typeOf(tk.v)) return declaration(false);
        const s = simple();
        expect(';');
        return s;
    }

    const funcs = [];
    const top = [];
    while (peek().t !== 'eof') {
        if (peek().t === 'pragma') { const p = next(); top.push({ k: 'pragma', text: p.v, line: p.line }); continue; }
        if (is('const')) { next(); top.push(declaration(true)); continue; }
        if (!is('void')) {
            if (peek().t === 'id' && typeOf(peek().v) && peek(2).t === 'p' && is('(', 2)) throw new HlsError('a função do kernel deve ser void (as saídas são vetores)', peek().line);
            if (peek().t === 'id' && typeOf(peek().v)) { top.push(declaration(false)); continue; }
            throw new HlsError(`esperado 'void' (a função do kernel), encontrado '${peek().v}'`, peek().line);
        }
        const line = next().line;
        const name = ident();
        expect('(');
        const params = [];
        if (!is(')')) {
            do {
                if (is('const')) next();
                const pl = peek().line;
                const ty = typeOf(ident());
                if (!ty) throw new HlsError('tipo de parâmetro desconhecido', pl);
                const pname = ident();
                params.push({ type: ty, name: pname, dims: dims(), line: pl });
            } while (is(',') && next());
        }
        expect(')');
        funcs.push({ k: 'func', name, params, body: statement(), line });
    }
    if (!funcs.length) throw new HlsError('nenhuma função void (o kernel) encontrada');
    return { funcs, top, defines: [...defines.keys()] };
}

/** Analisa uma expressão isolada (texto de um #define). */
parse.__expr = (text, line, defines) => {
    const src = `void __d() { __x = ${text}; }`;
    const lines = [...defines].map(([n, d]) => `#define ${n} ${d.text}`).join('\n');
    const ast = parse(`${lines}\n${src}`);
    const e = ast.funcs[0].body.body[0].e;
    const fix = (n) => { if (n && typeof n === 'object') { if ('line' in n) n.line = line; for (const v of Object.values(n)) if (v && typeof v === 'object') fix(v); } };
    fix(e);
    return e;
};

/** Diretiva: nome e parâmetros (chave=valor ou palavras soltas). */
export function parsePragma(text, line) {
    const words = text.trim().split(/\s+/);
    const name = words.shift().toLowerCase();
    const opts = {};
    for (const w of words) {
        const m = /^(\w+)\s*=\s*(\S+)$/.exec(w);
        if (m) opts[m[1].toLowerCase()] = /^\d+$/.test(m[2]) ? +m[2] : m[2];
        else opts[w.toLowerCase()] = true;
    }
    return { name, opts, line };
}
