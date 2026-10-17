/**
 * Destaque de sintaxe do kernel (o subconjunto de C com as diretivas) e da IR. Devolve HTML com spans de classes
 * tk-*; o editor desenha esse HTML atrás de um textarea de texto transparente, com a mesma fonte e o mesmo
 * espaçamento.
 */
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls, s) => `<span class="tk-${cls}">${escHtml(s)}</span>`;

const KEYWORDS = new Set(['for', 'const', 'void', 'return', 'if', 'else', 'while', 'static', 'unsigned', 'signed']);
const TYPES = /^(u8|u16|u32|i8|i16|i32|int|char|short|long|bool|u?int(8|16|32)_t)$/;
const FUNCS = new Set(['min', 'max', 'abs']);
const PRAGMA_WORDS = /\b(pipeline|unroll|array_partition|allocation|interface|inline|loop_tripcount|loop_flatten|dependence)\b/;

/** Uma linha de diretiva (#pragma, #define): a palavra da diretiva, as opções e os valores. */
function preproc(line) {
    const m = /^(\s*)(#\s*\w+)(.*)$/.exec(line);
    if (!m) return escHtml(line);
    let rest = escHtml(m[3]);
    if (/pragma/.test(m[2])) {
        rest = rest.replace(/\bHLS\b/, '<span class="tk-pp">HLS</span>')
            .replace(PRAGMA_WORDS, '<span class="tk-prag">$1</span>')
            .replace(/(\w+)=([\w]+)/g, '<span class="tk-opt">$1</span>=<span class="tk-val">$2</span>');
    } else rest = rest.replace(/\b(\d+)\b/g, '<span class="tk-num">$1</span>');
    return `${m[1]}${span('pp', m[2])}${rest}`;
}

/**
 * HTML do código do kernel.
 * @param {string} src
 * @param {number|null} errLine linha com erro (marcada)
 */
export function highlightC(src, errLine = null) {
    const lines = src.split('\n');
    let inComment = false;
    const out = lines.map((line, k) => {
        let html = '';
        let i = 0;
        if (!inComment && /^\s*#/.test(line)) html = preproc(line);
        else {
            while (i < line.length) {
                if (inComment) {
                    const e = line.indexOf('*/', i);
                    const end = e < 0 ? line.length : e + 2;
                    html += span('com', line.slice(i, end));
                    i = end;
                    if (e >= 0) inComment = false;
                    continue;
                }
                const rest = line.slice(i);
                let m;
                if (rest.startsWith('//')) { html += span('com', rest); break; }
                if (rest.startsWith('/*')) { inComment = true; continue; }
                if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
                    const w = m[0];
                    const after = rest.slice(w.length);
                    if (KEYWORDS.has(w)) html += span('kw', w);
                    else if (TYPES.test(w)) html += span('ty', w);
                    else if (FUNCS.has(w) && /^\s*\(/.test(after)) html += span('fn', w);
                    else if (/^\s*:\s*$/.test(after) && /^\s*$/.test(line.slice(0, i))) html += span('lbl', w);
                    else if (/^[A-Z][A-Z0-9_]*$/.test(w)) html += span('mac', w);
                    else html += escHtml(w);
                    i += w.length;
                    continue;
                }
                if ((m = /^(0x[0-9a-fA-F]+|\d+)/.exec(rest))) { html += span('num', m[0]); i += m[0].length; continue; }
                html += escHtml(line[i]);
                i++;
            }
        }
        return k + 1 === errLine ? `<span class="tk-errline">${html || ' '}</span>` : html;
    });
    // O último \n precisa de um caractere depois para a camada ter a mesma altura do textarea.
    return `${out.join('\n')}\n `;
}

/** HTML da IR (o texto de irText): cabeçalhos, nós, operações, faixas, unidades e ciclos. */
export function highlightIR(text) {
    const ids = (h) => h.replace(/%[\w.?]+/g, (m) => `<span class="tk-id">${m}</span>`);
    return text.split('\n').map((line, k) => {
        if (k === 0) return span('fn', line);
        const head = /^(\s*)(laço|loop|trecho|segment)(\s+)(\S+)(.*)$/.exec(line);
        if (head) return `${head[1]}${span('kw', head[2])}${head[3]}${span('lbl', head[4])}${escHtml(head[5]).replace(/\b(pipeline|II \d+|unroll \d+)/g, '<span class="tk-prag">$1</span>')}`;
        const m = /^(\s*)(%[\w.]+)(\s*=\s)(\S+)(.*?)(\[-?\d+, -?\d+\])(\s+)(.*?)(\s*)(c\d+(?:\.\.\d+)?(?: \+[\d.]+ns)?)?\s*$/.exec(line);
        if (!m) return escHtml(line);
        return `${m[1]}${span('id', m[2])}${m[3]}${span('kw', m[4])}${ids(escHtml(m[5]))}${span('rng', m[6])}${m[7]}${m[8] ? span('ty', m[8]) : ''}${m[9]}${m[10] ? span('num', m[10]) : ''}`;
    }).join('\n');
}
