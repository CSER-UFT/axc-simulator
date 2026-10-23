/**
 * Gerador de código para as redes (formato axc-nn/1) e custo pelo modelo de síntese de alto nível (js/hls).
 *
 * Cada camada vira um kernel na linguagem da página de síntese de alto nível, na mesma organização do código C da
 * MiniLenet para o Vitis (uma função por camada, chamadas em sequência, sem dataflow):
 *
 *   pad      borda com o ponto zero da entrada (laços com pipeline, II = 1: as linhas de cima e de baixo, as colunas dos
 *            lados e o miolo);
 *   conv     pipeline no laço da coluna de saída, com os laços da janela (ky, kx, canal) desenrolados; a soma dos
 *            produtos e o viés, e a reescala em Q32 (requant);
 *   maxpool  pipeline no laço da saída, máximo da janela;
 *   flatten  cópia para um vetor (como a função flattenLayer do C);
 *   dense    pipeline no laço das entradas (o laço interno, como o Vitis faz sozinho), acumulação em cadeia, e a
 *            reescala no fim de cada saída.
 *
 * Os vetores de mais de duas dimensões ficam em duas (canal × linha, coluna); os pesos, os viéses e os M da reescala
 * são tabelas const, com os pesos na ordem dos laços (ky, kx, canal), a mesma ordem dos termos do avaliador (nn.js).
 * O viés é o do JSON, com o ponto zero da entrada já absorvido; a borda é preenchida com esse ponto zero.
 *
 * O custo de uma configuração (multiplicador e somador das camadas aproximadas) é a soma dos kernels: latência
 * (as funções rodam uma depois da outra), área, LUT, FF, DSP e energia por imagem. As multiplicações das camadas
 * aproximadas usam o multiplicador; as somas (a acumulação e o viés), o somador, ajustado à largura de cada soma
 * (lib.adderFor). A reescala é uma peça exata (data/hls-cells.json).
 */
import { synthesize } from '../hls/index.js';
import { parse } from '../hls/lang.js';
import { elaborate } from '../hls/elab.js';

const list = (a) => [...a].join(', ');
const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
const divisors = (n) => Array.from({ length: n }, (_, i) => i + 1).filter((d) => n % d === 0);

/**
 * Diretivas de cada camada com pesos (índice: a ordem das camadas conv e dense, net.sites):
 *
 *   conv   pipe  'pixel': pipeline no laço da coluna de saída, janela desenrolada (todos os K x K x C produtos de uma
 *                saída por iteração, somados numa árvore); 'tap': pipeline no laço kx, com os C canais desenrolados
 *                (C produtos por iteração, somados numa árvore e acumulados); 'off': sem pipeline, um produto por vez;
 *          ii    II pedido ao pipeline (o alcançado pode ser maior: memória, recorrência);
 *          par   filtros calculados por iteração (só com 'pixel'; divide o número de filtros); com todos, os pesos
 *                viram constantes;
 *          part  partição dos vetores para alimentar os produtos de uma iteração: a entrada em linhas e colunas
 *                (cyclic, fator potência de 2), os pesos por coluna e, com par > 1, a saída, os viéses e os M;
 *   dense  pipe  'input': pipeline no laço das entradas (com par = I, no laço das saídas); 'off': sem pipeline;
 *          ii, part como na conv;
 *          par   produtos por iteração (fator de desenrolamento do laço das entradas; divide o número de entradas),
 *                somados numa árvore e acumulados.
 *
 * A estrutura da soma que as diretivas dão (directiveTrees) é a que a avaliação da acurácia usa (nn.js, sumTerms).
 */
export const CONV_PIPES = ['pixel', 'tap', 'off'];
export const DENSE_PIPES = ['input', 'off'];

/** Termos da soma de cada saída e o limite do paralelismo de uma camada com pesos. */
export function siteShape(l) {
    if (l.type === 'conv') return { terms: l.inShape[0] * l.k * l.k, parMax: l.outShape[0], C: l.inShape[0] };
    return { terms: l.w.length / l.out, parMax: l.w.length / l.out, C: 1 };
}
/** Valores válidos do paralelismo (divisores). */
export const parOptions = (l) => divisors(siteShape(l).parMax);

export function defaultDirectives(net) {
    return net.sites.map((l) => ({ pipe: l.type === 'conv' ? 'pixel' : 'input', ii: 1, par: 1, part: false }));
}
/** Diretivas completas e válidas (os campos que faltam ficam com o padrão; o paralelismo inválido vira 1). */
export function normalizeDirectives(net, dirs) {
    return net.sites.map((l, i) => {
        const d = { ...defaultDirectives(net)[i], ...(dirs?.[i] ?? {}) };
        const pipes = l.type === 'conv' ? CONV_PIPES : DENSE_PIPES;
        if (!pipes.includes(d.pipe)) d.pipe = pipes[0];
        d.ii = Math.max(1, Math.round(+d.ii || 1));
        d.par = Math.round(+d.par || 1);
        if (siteShape(l).parMax % d.par || d.par < 1 || (l.type === 'conv' && d.pipe !== 'pixel')) d.par = 1;
        d.part = !!d.part;
        return d;
    });
}
/** Estrutura da soma de cada camada com pesos (veja sumTerms): 0 árvore só, 1 cadeia, U árvores de U termos. */
export function directiveTrees(net, dirs) {
    return normalizeDirectives(net, dirs).map((d, i) => {
        const l = net.sites[i], { terms, C } = siteShape(l);
        let U;
        if (l.type === 'conv') U = d.pipe === 'pixel' ? terms : d.pipe === 'tap' ? C : 1;
        else U = d.par;
        return U >= terms ? 0 : U;
    });
}

/** Soma em árvore, dois a dois, nível por nível (a mesma ordem de sumTerms). */
function treeExpr(terms) {
    let level = terms;
    while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? `(${level[i]} + ${level[i + 1]})` : level[i]);
        level = next;
    }
    return level[0];
}

/**
 * Plano da rede: os kernels em sequência e os tensores entre eles (C x H x W guardados em [C * Hs][W]: Hs >= H é o
 * passo das linhas entre canais). Com a partição das linhas da entrada de uma conv de vários canais, o passo do
 * tensor é escolhido para que as linhas lidas numa iteração caiam em bancos diferentes com fator potência de 2
 * (Hs mod F = g, com g = K na janela inteira e 1 no laço kx); a entrada da rede tem o passo fixo (H), e então o
 * fator é o menor que separa as linhas.
 */
function plan(net, dirs) {
    const D = normalizeDirectives(net, dirs);
    const first = net.layers[0].inShape;
    const tensors = [{ shape: first, stride: first[1], fixed: true }];
    const steps = [];
    let cur = 0, pools = 0, pads = 0, si = -1;
    const newT = (shape) => { tensors.push({ shape, stride: shape[1], fixed: false }); return tensors.length - 1; };
    for (const l of net.layers) {
        if (l.type === 'conv') {
            si++;
            const [C, H, W] = l.inShape, p = l.pad ?? 0;
            if (p > 0) {
                pads++;
                const t = newT([C, H + 2 * p, W + 2 * p]);
                steps.push({ name: `pad${pads}`, type: 'pad', site: null, l, in: cur, out: t, p });
                cur = t;
            }
            const t = newT(l.outShape);
            steps.push({ name: l.name, type: 'conv', site: si, l, in: cur, out: t, d: D[si] });
            cur = t;
        } else if (l.type === 'maxpool') {
            pools++;
            const t = newT(l.outShape);
            steps.push({ name: `pool${pools}`, type: 'maxpool', site: null, l, in: cur, out: t });
            cur = t;
        } else if (l.type === 'flatten') {
            const t = newT([l.outShape[0], 1, 1]);
            steps.push({ name: 'flatten', type: 'flatten', site: null, l, in: cur, out: t });
            cur = t;
        } else if (l.type === 'dense') {
            si++;
            const t = newT([l.out, 1, 1]);
            steps.push({ name: l.name, type: 'dense', site: si, l, in: cur, out: t, d: D[si] });
            cur = t;
        }
    }
    // Passos das linhas e fatores da partição da entrada das conv.
    for (const s of steps) {
        if (s.type !== 'conv' || !s.d.part || s.d.pipe === 'off') continue;
        const t = tensors[s.in], [C, H] = t.shape, K = s.l.k;
        const g = s.d.pipe === 'pixel' ? K : 1;
        s.colF = s.d.pipe === 'pixel' ? nextPow2(K) : null;
        if (C === 1) { s.rowF = g > 1 ? nextPow2(g) : null; continue; }
        if (!t.fixed) {
            const F = nextPow2(g * C);
            let Hs = H;
            while (Hs % F !== g % F) Hs++;
            t.stride = Hs;
            t.fixed = true;
            s.rowF = F;
        } else {
            const ok = (F) => new Set(Array.from({ length: C * g }, (_, j) => (Math.floor(j / g) * H + (j % g)) % F)).size === C * g;
            let F = g * C;
            while (!ok(F)) F++;
            s.rowF = F;
        }
    }
    // Partição da saída das conv com vários filtros por iteração: bancos diferentes para as linhas (f, oh) da iteração.
    for (const s of steps) {
        if (s.type !== 'conv' || !s.d.part || s.d.par === 1) continue;
        const t = tensors[s.out], P = s.d.par;
        // Passo livre (nenhuma conv seguinte pediu outro): ímpar, e o fator potência de 2 já separa as linhas.
        if (!t.fixed && t.stride === t.shape[1] && t.stride % 2 === 0) t.stride++;
        const OHs = t.stride;
        const ok = (F) => new Set(Array.from({ length: P }, (_, f) => (f * OHs) % F)).size === P;
        let F = nextPow2(P);
        while (F <= 4096 && !ok(F)) F *= 2;
        if (F > 4096) { F = P; while (!ok(F)) F++; }
        s.outF = F;
    }
    return { steps, tensors, dirs: D };
}

/** Os kernels de uma rede decodificada (decodeNet) com as diretivas: [{name, type, site, src}]. */
export function networkKernels(net, dirs = null) {
    const { steps, tensors } = plan(net, dirs);
    return steps.map((s) => {
        const xi = tensors[s.in], yo = tensors[s.out];
        let src;
        if (s.type === 'pad') src = padKernel(s.name, ...xi.shape, s.p, s.l.zIn, xi.stride, yo.stride);
        else if (s.type === 'conv') src = convKernel(s, xi, yo);
        else if (s.type === 'maxpool') src = poolKernel(s.name, s.l, xi.stride, yo.stride);
        else if (s.type === 'flatten') src = flattenKernel(xi.shape, xi.stride);
        else src = denseKernel(s);
        return { name: s.name, type: s.type, site: s.site, src };
    });
}

function padKernel(name, C, H, W, p, z, Hs = H, HPs = H + 2 * p) {
    // Cinco laços retangulares (linhas de cima e de baixo, colunas da esquerda e da direita, miolo): os índices
    // ficam afins, e o total de escritas é o mesmo da função do C, (H + 2P) x (W + 2P).
    return `// ${name}: borda de ${p} pixels com o ponto zero da entrada (${z}), como a função de padding do C.
#define C ${C}
#define H ${H}
#define W ${W}
#define P ${p}
#define Z ${z}
#define HP (H + 2 * P)
#define WP (W + 2 * P)
${Hs !== H ? `#define HS ${Hs}\n` : ''}${HPs !== H + 2 * p ? `#define HPS ${HPs}\n` : ''}
void ${name}(u8 x[C * ${Hs !== H ? 'HS' : 'H'}][W], u8 y[C * ${HPs !== H + 2 * p ? 'HPS' : 'HP'}][WP]) {
${name}_c:
    for (int c = 0; c < C; c++) {
${name}_top:
        for (int h = 0; h < P; h++)
            for (int w = 0; w < WP; w++) {
#pragma HLS pipeline II=1
                y[c * ${HPs !== H + 2 * p ? 'HPS' : 'HP'} + h][w] = Z;
                y[c * ${HPs !== H + 2 * p ? 'HPS' : 'HP'} + H + P + h][w] = Z;
            }
${name}_side:
        for (int h = 0; h < H; h++)
            for (int w = 0; w < P; w++) {
#pragma HLS pipeline II=1
                y[c * ${HPs !== H + 2 * p ? 'HPS' : 'HP'} + P + h][w] = Z;
                y[c * ${HPs !== H + 2 * p ? 'HPS' : 'HP'} + P + h][W + P + w] = Z;
            }
${name}_in:
        for (int h = 0; h < H; h++)
            for (int w = 0; w < W; w++) {
#pragma HLS pipeline II=1
                y[c * ${HPs !== H + 2 * p ? 'HPS' : 'HP'} + P + h][P + w] = x[c * ${Hs !== H ? 'HS' : 'H'} + h][w];
            }
    }
}
`;
}

function convKernel(s, xi, yo) {
    const l = s.l, d = s.d;
    const [C] = l.inShape, [F, OH, OW] = l.outShape, k = l.k, st = l.stride ?? 1;
    const HP = xi.stride, WP = xi.shape[2], OHs = yo.stride;
    // Pesos na ordem dos laços: (ky, kx, canal) para cada filtro.
    const rows = [];
    for (let f = 0; f < F; f++) {
        const r = [];
        for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) for (let c = 0; c < C; c++) r.push(l.w[((f * C + c) * k + ky) * k + kx]);
        rows.push(`{${r.join(', ')}}`);
    }
    const P = d.par;
    const fx = d.pipe !== 'pixel' || P === 1 ? 'f' : P === F ? 'f' : '(fo * PF + fi)';
    const yRow = `${fx === 'f' ? 'f' : fx} * OHS + oh`;
    const out = l.logits ? `y[${yRow}][ow] = acc + b[${fx}];` : `y[${yRow}][ow] = requant(acc + b[${fx}], m[${fx}], Z);`;
    const prod = (c, kh, kw, f) => `x[${c ? `${c} * HP + ` : ''}oh * S${kh ? ` + ${kh}` : ''}][ow * S${kw ? ` + ${kw}` : ''}] * w[${f}][${(kh * k + kw) * C + c}]`;
    const parts = [];
    if (d.part && d.pipe !== 'off') {
        if (s.rowF) parts.push(`#pragma HLS array_partition variable=x cyclic factor=${s.rowF} dim=1`);
        if (s.colF) parts.push(`#pragma HLS array_partition variable=x cyclic factor=${s.colF} dim=2`);
        if (d.pipe === 'pixel') parts.push('#pragma HLS array_partition variable=w complete dim=2');
        else if (C > 1) parts.push(`#pragma HLS array_partition variable=w cyclic factor=${C} dim=2`);
        if (d.pipe === 'pixel' && P > 1 && P < F) {
            parts.push(`#pragma HLS array_partition variable=w cyclic factor=${P} dim=1`, `#pragma HLS array_partition variable=b cyclic factor=${P} dim=1`);
            if (!l.logits) parts.push(`#pragma HLS array_partition variable=m cyclic factor=${P} dim=1`);
        }
        if (s.outF) parts.push(`#pragma HLS array_partition variable=y cyclic factor=${s.outF} dim=1`);
    }
    const ii = `#pragma HLS pipeline II=${d.ii}`;
    let body;
    if (d.pipe === 'pixel') {
        const terms = [];
        for (let kh = 0; kh < k; kh++) for (let kw = 0; kw < k; kw++) for (let c = 0; c < C; c++) terms.push(prod(c, kh, kw, fx));
        const inner = `i32 acc = ${treeExpr(terms)};\n${out}`;
        const ind = (t, n) => t.split('\n').map((x) => ' '.repeat(n) + x).join('\n');
        const loopsIn = (txt) => `${s.name}_h:
        for (int oh = 0; oh < OH; oh++) {
${s.name}_w:
            for (int ow = 0; ow < OW; ow++) {
${ii}
${txt}
            }
        }`;
        if (P === 1) body = `${s.name}_f:\n    for (int f = 0; f < F; f++) {\n${loopsIn(ind(inner, 16))}\n    }`;
        else if (P === F) body = loopsIn(ind(`for (int f = 0; f < F; f++) {\n${ind(inner, 4)}\n}`, 16)).replace(/^ {4}/gm, '');
        else body = `${s.name}_f:\n    for (int fo = 0; fo < F / PF; fo++) {\n${loopsIn(ind(`for (int fi = 0; fi < PF; fi++) {\n${ind(inner, 4)}\n}`, 16))}\n    }`;
    } else {
        const C1 = d.pipe === 'tap';
        const terms = Array.from({ length: C }, (_, c) => `x[${c ? `${c} * HP + ` : ''}oh * S + kh][ow * S + kw] * w[f][(kh * K + kw) * C${c ? ` + ${c}` : ''}]`);
        const mac = C1
            ? `${s.name}_kx:\n                    for (int kw = 0; kw < K; kw++) {\n${ii}\n                        acc += ${treeExpr(terms)};\n                    }`
            : `${s.name}_kx:\n                    for (int kw = 0; kw < K; kw++)\n                        for (int c = 0; c < C; c++)\n                            acc += x[c * HP + oh * S + kh][ow * S + kw] * w[f][(kh * K + kw) * C + c];`;
        body = `${s.name}_f:
    for (int f = 0; f < F; f++) {
${s.name}_h:
        for (int oh = 0; oh < OH; oh++) {
${s.name}_w:
            for (int ow = 0; ow < OW; ow++) {
                i32 acc = 0;
${s.name}_ky:
                for (int kh = 0; kh < K; kh++)
${mac}
                ${out}
            }
        }
    }`;
    }
    const what = { pixel: `pipeline na coluna de saída (II ${d.ii}), janela desenrolada e somada em árvore${P > 1 ? `, ${P} filtros por iteração` : ''}`, tap: `pipeline no laço kx (II ${d.ii}), ${C > 1 ? `${C} canais por iteração, somados em árvore` : 'um produto por iteração'}`, off: 'sem pipeline, um produto por vez' }[d.pipe];
    return `// ${l.name}: ${F} filtros ${k} x ${k} sobre ${C} canais; ${what}${parts.length ? '; vetores particionados' : ''}.
#define C ${C}
#define HP ${HP}
#define WP ${WP}
#define F ${F}
#define K ${k}
#define S ${st}
#define OH ${OH}
#define OHS ${OHs}
#define OW ${OW}
#define Z ${l.zOut ?? 0}
${P > 1 && P < F ? `#define PF ${P}\n` : ''}
void ${l.name}(u8 x[C * HP][WP], ${l.logits ? 'i32' : 'u8'} y[F * OHS][OW]) {
    const i8 w[F][K * K * C] = {${rows.join(', ')}};
    const i32 b[F] = {${list(l.b)}};
${l.logits ? '' : `    const u32 m[F] = {${list(l.rq.m.length === 1 ? Array(F).fill(l.rq.m[0]) : l.rq.m)}};\n`}${parts.join('\n')}${parts.length ? '\n' : ''}${body}
}
`;
}

function poolKernel(name, l, Hs, PHs) {
    const [C, H, W] = l.inShape, [, PH, PW] = l.outShape, s = l.size;
    const terms = [];
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) terms.push(`x[c * HS + ph * S + ${dy}][pw * S + ${dx}]`);
    const expr = terms.reduce((a, t) => (a ? `max(${a}, ${t})` : t), '');
    return `// ${name}: max pooling ${s} x ${s}.
#define C ${C}
#define H ${H}
#define W ${W}
#define S ${s}
#define PH ${PH}
#define PW ${PW}
#define HS ${Hs ?? H}
#define PHS ${PHs ?? PH}

void ${name}(u8 x[C * HS][W], u8 y[C * PHS][PW]) {
${name}_c:
    for (int c = 0; c < C; c++) {
${name}_h:
        for (int ph = 0; ph < PH; ph++) {
${name}_w:
            for (int pw = 0; pw < PW; pw++) {
#pragma HLS pipeline II=1
                y[c * PHS + ph][pw] = ${expr};
            }
        }
    }
}
`;
}

function flattenKernel([C, H, W], Hs = H) {
    if (Hs === H) {
        return `// flatten: cópia para um vetor, na ordem canal, linha, coluna (como a função flattenLayer do C).
#define C ${C}
#define H ${H}
#define W ${W}

void flatten(u8 x[C * H][W], u8 y[C * H * W]) {
flatten_r:
    for (int r = 0; r < C * H; r++) {
flatten_w:
        for (int w = 0; w < W; w++) {
#pragma HLS pipeline II=1
            y[r * W + w] = x[r][w];
        }
    }
}
`;
    }
    return `// flatten: cópia para um vetor, na ordem canal, linha, coluna; a entrada tem ${Hs} linhas por canal (${H} usadas).
#define C ${C}
#define H ${H}
#define W ${W}
#define HS ${Hs}

void flatten(u8 x[C * HS][W], u8 y[C * H * W]) {
flatten_c:
    for (int c = 0; c < C; c++)
flatten_r:
        for (int h = 0; h < H; h++) {
flatten_w:
            for (int w = 0; w < W; w++) {
#pragma HLS pipeline II=1
                y[(c * H + h) * W + w] = x[c * HS + h][w];
            }
        }
}
`;
}

function denseKernel(s) {
    const l = s.l, d = s.d;
    const I = l.w.length / l.out, O = l.out, U = d.par;
    const rows = [];
    for (let o = 0; o < O; o++) rows.push(`{${list(l.w.subarray(o * I, (o + 1) * I))}}`);
    const out = l.logits ? 'y[o] = acc + b[o];' : 'y[o] = requant(acc + b[o], m[o], Z);';
    const ii = d.pipe === 'off' ? '' : `#pragma HLS pipeline II=${d.ii}\n`;
    const parts = [];
    if (d.part && U > 1) {
        parts.push(U === I ? '#pragma HLS array_partition variable=x complete dim=1' : `#pragma HLS array_partition variable=x cyclic factor=${U} dim=1`);
        parts.push(U === I ? '#pragma HLS array_partition variable=w complete dim=2' : `#pragma HLS array_partition variable=w cyclic factor=${U} dim=2`);
    }
    let body;
    if (U === 1) {
        body = `${l.name}_o:
    for (int o = 0; o < O; o++) {
        i32 acc = 0;
${l.name}_i:
        for (int i = 0; i < I; i++) {
${ii}            acc += x[i] * w[o][i];
        }
        ${out}
    }`;
    } else if (U === I) {
        const terms = Array.from({ length: I }, (_, u) => `x[${u}] * w[o][${u}]`);
        body = `${l.name}_o:
    for (int o = 0; o < O; o++) {
${ii}        i32 acc = ${treeExpr(terms)};
        ${out}
    }`;
    } else {
        const terms = Array.from({ length: U }, (_, u) => `x[i * U${u ? ` + ${u}` : ''}] * w[o][i * U${u ? ` + ${u}` : ''}]`);
        body = `${l.name}_o:
    for (int o = 0; o < O; o++) {
        i32 acc = 0;
${l.name}_i:
        for (int i = 0; i < I / U; i++) {
${ii}            acc += ${treeExpr(terms)};
        }
        ${out}
    }`;
    }
    const what = d.pipe === 'off' ? 'sem pipeline' : U === I ? `pipeline no laço das saídas (II ${d.ii}), todas as entradas por iteração` : `pipeline no laço das entradas (II ${d.ii})`;
    return `// ${l.name}: ${I} entradas, ${O} saídas; ${what}${U > 1 && U < I ? `, ${U} produtos por iteração somados em árvore` : U === 1 ? ' (acumulação em cadeia)' : ''}${parts.length ? '; vetores particionados' : ''}.
#define I ${I}
#define O ${O}
#define Z ${l.zOut ?? 0}
${U > 1 && U < I ? `#define U ${U}\n` : ''}
void ${l.name}(u8 x[I], ${l.logits ? 'i32' : 'u8'} y[O]) {
    const i8 w[O][I] = {${rows.join(', ')}};
    const i32 b[O] = {${list(l.b)}};
${l.logits ? '' : `    const u32 m[O] = {${list(l.rq.m.length === 1 ? Array(O).fill(l.rq.m[0]) : l.rq.m)}};\n`}${parts.join('\n')}${parts.length ? '\n' : ''}${body}
}
`;
}

// Custo ---------------------------------------------------------------------------------------------------------

const DESIGNS = new Map();
/** Elaboração de um kernel, guardada pelo código (é a parte cara). */
function designOf(src, ports) {
    const key = `${ports}|${src}`;
    if (!DESIGNS.has(key)) {
        if (DESIGNS.size > 300) DESIGNS.delete(DESIGNS.keys().next().value);
        DESIGNS.set(key, elaborate(parse(src), { ports }));
    }
    return DESIGNS.get(key);
}

/**
 * Modelo de custo de uma rede com diretivas fixas: o custo de cada kernel, guardado por (kernel, multiplicador,
 * somador). O da rede é a soma (as funções rodam uma depois da outra), então a busca troca a unidade de uma camada e
 * recalcula só ela.
 * @param {object} net rede decodificada
 * @param {{synth, cells, fpga?, target?, flow?, clockNs?, ports?, dirs?}} o
 */
export function costModel(net, o) {
    const kernels = networkKernels(net, o.dirs);
    const ports = o.ports ?? 2, clockNs = o.clockNs ?? 10;
    const base = { synth: o.synth, cells: o.cells, fpga: o.fpga ?? null, target: o.target ?? 'asic', flow: o.flow ?? 'delay', clockNs, ports, wide: true };
    const cache = new Map();
    /** Custo de um kernel com as unidades (null: exata). */
    const kernel = (k, mul = null, add = null) => {
        const key = `${k.name}|${mul ?? '-'}|${add ?? '-'}`;
        if (cache.has(key)) return cache.get(key);
        const design = designOf(k.src, ports);
        const r0 = synthesize(k.src, { ...base, design });
        let r = r0;
        const warnings = [];
        const approx = k.site !== null && !!(mul || add);
        if (approx) {
            const assign = new Map();
            for (const op of r0.ops.list) {
                let name = null;
                if (op.cls === 'mul' && mul) name = op.candidates.includes(mul) ? mul : null;
                if (op.cls === 'add' && add) name = r0.lib.adderFor(add, op.W);
                if (op.cls === 'mul' && mul && !name) warnings.push(`${k.name}: ${mul} não serve para ${op.label} (fica o exato)`);
                if (name && name !== op.candidates[0]) assign.set(op.id, name);
            }
            r = synthesize(k.src, { ...base, design, assign });
        }
        const t = r.totals;
        const row = {
            name: k.name, type: k.type, site: k.site, approx, mul: k.site !== null ? mul : null, add: k.site !== null ? add : null,
            cycles: t.cycles, area: t.area, luts: t.luts, carry4: t.carry4, ff: t.ff, dsp: t.dsp ?? 0, energy: t.energy, critPs: t.critPs,
            II: r.design.loops.filter((x) => x.mode === 'pipelined').reduce((m, x) => Math.max(m ?? 0, x.IIachieved ?? 0), null),
            IIwhy: r.design.loops.find((x) => x.mode === 'pipelined')?.why ?? null,
            src: k.src,
            units: r.cost.units.map((u) => ({ name: u.unit.name, count: u.count })),
            warnings,
        };
        // A síntese (projeto, atribuição, biblioteca) fica junto, fora do JSON: é dela que sai o C++ (nnexport.js).
        Object.defineProperty(row, 'result', { value: r, enumerable: false });
        cache.set(key, row);
        return row;
    };
    const siteKernel = new Map(kernels.filter((k) => k.site !== null).map((k) => [k.site, k]));
    /** Custo de uma camada com pesos com as unidades. */
    const site = (si, mul = null, add = null) => kernel(siteKernel.get(si), mul, add);
    /** Custo da rede: units[si] = {mul, add} (nomes da biblioteca; ausente ou null: exata). */
    const network = (units = []) => {
        const layers = kernels.map((k) => (k.site === null ? kernel(k) : kernel(k, units[k.site]?.mul ?? null, units[k.site]?.add ?? null)));
        const sum = (f) => layers.reduce((a, x) => a + x[f], 0);
        const cycles = sum('cycles');
        return {
            layers, warnings: [...new Set(layers.flatMap((l) => l.warnings))],
            totals: { cycles, timeUs: (cycles * clockNs) / 1000, area: sum('area'), luts: sum('luts'), carry4: sum('carry4'), ff: sum('ff'), dsp: sum('dsp'), energy: sum('energy'), clockNs },
        };
    };
    return { kernels, kernel, site, network, clockNs };
}

/**
 * Custo da rede com as unidades escolhidas.
 * @param {object} net rede decodificada
 * @param {{synth, cells, fpga?, target?: 'asic'|'fpga', flow?: string, clockNs?: number, ports?: number,
 *          mul?: string|null, add?: string|null, mask?: boolean[], units?: object[], dirs?: object[]}} o mul e add:
 *          nomes das unidades da biblioteca nas camadas com mask[site] (null: exatas); units: {mul, add} de cada camada
 *          com pesos (no lugar de mul, add e mask); dirs: diretivas de cada camada com pesos (defaultDirectives)
 * @returns {{layers: object[], totals: object, warnings: string[]}}
 */
export function networkCost(net, o) {
    const units = o.units ?? net.sites.map((_, si) => ((o.mask?.[si] ?? true) ? { mul: o.mul ?? null, add: o.add ?? null } : null));
    return costModel(net, o).network(units);
}
