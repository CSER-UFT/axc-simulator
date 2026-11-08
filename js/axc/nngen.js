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
 *            reescala no fim de cada saída;
 *   add      soma residual das redes com ramos (ResNet 8, docs/RESNET8.md): os dois ramos (o acumulador int32 de uma
 *            convolução "acc", que sai sem reescala, ou uma ativação menos o ponto zero) numa reescala só, requant2;
 *   avgpool  média da janela, (soma + n / 2) >> log2 n, com pipeline no laço da janela.
 * A borda pode ter lados diferentes (a do padding='same' do Keras no passo 2: 0, 1, 0, 1). Nas redes com ramos, cada
 * kernel lê os tensores das camadas de l.src (ins) e escreve o seu (out).
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
import { rangeOf } from '../hls/elab.js';

// Memória em bloco -------------------------------------------------------------------------------------------------

/**
 * BRAM18 de um banco de memória com words palavras de bits bits, como o Vitis HLS 2022.2 os aloca (conferido nos
 * relatórios da ResNet 8): com menos de 64 palavras ou até 512 bits, fica em LUT ou registradores; a profundidade sobe para a potência de 2; até
 * 512 palavras, um BRAM18 por 36 bits de largura; acima disso, colunas de 18 bits com 1024 palavras por BRAM e o resto
 * da largura na configuração mais estreita que cabe (1, 2, 4 ou 9 bits com 16384, 8192, 4096 ou 2048 palavras).
 * Na ResNet 8, a soma dá 236 BRAM18, contra 239 na síntese da rede (o Vivado chegou a 305, veja docs/RESNET8.md).
 */
export function bram18Of(words, bits) {
    if (words < 64 || words * bits <= 512) return 0;
    const D = 2 ** Math.ceil(Math.log2(words));
    if (D <= 512) return Math.ceil(bits / 36);
    const n18 = Math.floor(bits / 18), rem = bits - 18 * n18;
    const cap = rem <= 1 ? 16384 : rem <= 2 ? 8192 : rem <= 4 ? 4096 : rem <= 9 ? 2048 : 1024;
    return n18 * Math.ceil(D / 1024) + (rem > 0 ? Math.ceil(D / cap) : 0);
}

/** Bancos de um vetor pelas partições (complete: um banco por elemento da dimensão). */
const banksOf = (a) => (a.partitions ?? []).reduce((b, p) => b * (p.factor ?? 1), 1);

/** BRAM18 de um vetor com a largura de bits (a declarada, quando não é dada) e as partições dele. */
export function arrayBram18(a, bits = a.type.bits) {
    const B = banksOf(a);
    return B * bram18Of(Math.ceil(a.size / B), bits);
}

/** Largura das palavras de uma ROM pelos valores dela (o Vitis guarda só os bits que os valores usam). */
function romBits(a) {
    if (!a.init?.length) return a.type.bits;
    const [lo, hi] = (a.initRange ??= rangeOf(a.init));
    const ub = (v) => (v > 0 ? Math.floor(Math.log2(v)) + 1 : 0);
    return lo < 0 ? Math.max(ub(hi), ub(-lo - 1)) + 1 : Math.max(1, ub(hi));
}
import { MODEL } from '../hls/sched.js';
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
 *                (cyclic, um banco por posição da janela), os pesos por coluna e, com par > 1, a saída, os viéses e os M;
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
 * tensor é escolhido para que as linhas lidas numa iteração caiam em bancos diferentes com o menor fator, F = g x C
 * (Hs mod F = g, com g = K na janela inteira e 1 no laço kx); a entrada da rede tem o passo fixo (H), e então o
 * fator é o menor que separa as linhas.
 */
/**
 * Plano da rede: os kernels em sequência e os tensores entre eles (C x H x W guardados em [C * Hs][W]: Hs >= H é o
 * passo das linhas entre canais). Com a partição das linhas da entrada de uma conv de vários canais, o passo do
 * tensor é escolhido para que as linhas lidas numa iteração caiam em bancos diferentes com o menor fator, F = g x C
 * (Hs mod F = g, com g = K na janela inteira e 1 no laço kx); a entrada da rede tem o passo fixo (H), e então o
 * fator é o menor que separa as linhas.
 *
 * Redes com ramos (ResNet 8): cada camada lê o tensor das camadas de l.src; as convoluções "acc" escrevem um tensor
 * int32 (o acumulador com o viés), e a soma residual (add) lê os dois e escreve o de 8 bits. Cada passo tem ins (os
 * tensores lidos) e out.
 */
function plan(net, dirs) {
    const D = normalizeDirectives(net, dirs);
    const first = net.layers[0].inShape;
    const tensors = [{ shape: first, stride: first[1], fixed: true, type: 'u8' }];
    const steps = [];
    const outT = new Map([[-1, 0]]);
    let pools = 0, pads = 0, si = -1;
    const newT = (shape, type = 'u8') => { tensors.push({ shape, stride: shape[1], fixed: false, type }); return tensors.length - 1; };
    net.layers.forEach((l, li) => {
        const src = l.src ?? [li - 1];
        let cur = outT.get(src[0]);
        if (l.type === 'conv') {
            si++;
            const [C, H, W] = l.inShape, [pt, pb, pl, pr] = l.pads ?? [l.pad ?? 0, l.pad ?? 0, l.pad ?? 0, l.pad ?? 0];
            if (pt || pb || pl || pr) {
                pads++;
                const t = newT([C, H + pt + pb, W + pl + pr]);
                steps.push({ name: `pad${pads}`, type: 'pad', site: null, l, in: cur, out: t, p: pt, pads: [pt, pb, pl, pr] });
                cur = t;
            }
            const t = newT(l.outShape, l.logits || l.accOut ? 'i32' : 'u8');
            steps.push({ name: l.name, type: 'conv', site: si, l, in: cur, out: t, d: D[si] });
            outT.set(li, t);
        } else if (l.type === 'maxpool' || l.type === 'avgpool') {
            pools++;
            const t = newT(l.outShape);
            steps.push({ name: l.type === 'avgpool' ? (l.name ?? `avgpool${pools}`) : `pool${pools}`, type: l.type, site: null, l, in: cur, out: t });
            outT.set(li, t);
        } else if (l.type === 'flatten') {
            const t = newT([l.outShape[0], 1, 1]);
            steps.push({ name: 'flatten', type: 'flatten', site: null, l, in: cur, out: t });
            outT.set(li, t);
        } else if (l.type === 'dense') {
            si++;
            const t = newT([l.out, 1, 1], l.logits ? 'i32' : 'u8');
            steps.push({ name: l.name, type: 'dense', site: si, l, in: cur, out: t, d: D[si] });
            outT.set(li, t);
        } else if (l.type === 'add') {
            const ins = src.map((j) => outT.get(j));
            const t = newT(l.outShape);
            steps.push({ name: l.name, type: 'add', site: null, l, in: ins[0], ins, out: t, layers: net.layers });
            outT.set(li, t);
        }
    });
    for (const st of steps) st.ins ??= [st.in];
    // Passos das linhas e fatores da partição da entrada das conv.
    for (const s of steps) {
        if (s.type !== 'conv' || !s.d.part || s.d.pipe === 'off') continue;
        const t = tensors[s.in], [C, H] = t.shape, K = s.l.k;
        // Fatores mínimos: um banco por posição da janela (K colunas; K linhas por canal, C canais). Com fatores
        // potência de 2 (8 x 8 na conv1, 16 x 8 na conv2 da MiniLenet), o escalonamento do Vitis 2022.2 levou 496 s e
        // 4,6 h, contra 27 s e 1 h com os fatores que ele mesmo escolhe (5 x 5, 23 x 5): o tempo cresce com os bancos,
        // que mudam a cada pixel.
        const g = s.d.pipe === 'pixel' ? K : 1;
        s.colF = s.d.pipe === 'pixel' ? K : null;
        if (C === 1) { s.rowF = g > 1 ? g : null; continue; }
        if (!t.fixed) {
            const F = g * C;
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

/**
 * As redes com ramos ainda não têm o projeto para o Vitis (etapa 23 do plano): erro claro em vez de um topo que chame
 * as camadas em sequência.
 */
export function assertSequential(net, what = 'a exportação para o Vitis') {
    const bad = net.layers.find((l) => l.type === 'add' || l.type === 'avgpool' || l.accOut || (l.pads && new Set(l.pads).size > 1));
    if (net.graph || bad) throw new Error(`${what} ainda não aceita redes com ramos, soma residual, média ou borda assimétrica (${bad?.name ?? net.id})`);
}

/**
 * Os kernels de uma rede decodificada (decodeNet) com as diretivas: [{name, type, site, src, ins, out}], com ins e out
 * os índices dos tensores lidos e escrito (tensors: as formas, os passos das linhas e o tipo de cada um).
 */
export function networkKernels(net, dirs = null) {
    const { steps, tensors } = plan(net, dirs);
    const kernels = steps.map((s) => {
        const xi = tensors[s.in], yo = tensors[s.out];
        let src;
        if (s.type === 'pad') {
            const [pt, pb, pl, pr] = s.pads;
            src = pt === pb && pl === pr && pt === pl ? padKernel(s.name, ...xi.shape, s.p, s.l.zIn, xi.stride, yo.stride) : padKernel4(s.name, ...xi.shape, s.pads, s.l.zIn, xi.stride, yo.stride);
        } else if (s.type === 'conv') src = convKernel(s, xi, yo);
        else if (s.type === 'maxpool') src = poolKernel(s.name, s.l, xi.stride, yo.stride);
        else if (s.type === 'avgpool') src = avgPoolKernel(s.name, s.l, xi.stride, yo.stride);
        else if (s.type === 'flatten') src = flattenKernel(xi.shape, xi.stride);
        else if (s.type === 'add') src = addKernel(s, s.ins.map((t) => tensors[t]), yo);
        else src = denseKernel(s);
        return { name: s.name, type: s.type, site: s.site, src, ins: s.ins, out: s.out };
    });
    Object.defineProperty(kernels, 'tensors', { value: tensors, enumerable: false });
    return kernels;
}

/** Borda com lados diferentes (a do padding='same' do Keras no passo 2: 0, 1, 0, 1), com o ponto zero da entrada. */
function padKernel4(name, C, H, W, [pt, pb, pl, pr], z, Hs = H, HPs = H + pt + pb) {
    const HP = H + pt + pb, WP = W + pl + pr, Y = HPs !== HP ? 'HPS' : 'HP', X = Hs !== H ? 'HS' : 'H';
    const loop = (label, rows, cols, body) => `${name}_${label}:
        for (int h = 0; h < ${rows}; h++)
            for (int w = 0; w < ${cols}; w++) {
#pragma HLS pipeline II=1
                ${body}
            }
`;
    return `// ${name}: borda de ${pt}, ${pb}, ${pl} e ${pr} pixels (cima, baixo, esquerda, direita) com o ponto zero da entrada (${z}).
#define C ${C}
#define H ${H}
#define W ${W}
#define Z ${z}
#define HP ${HP}
#define WP ${WP}
${Hs !== H ? `#define HS ${Hs}\n` : ''}${HPs !== HP ? `#define HPS ${HPs}\n` : ''}
void ${name}(u8 x[C * ${X}][W], u8 y[C * ${Y}][WP]) {
${name}_c:
    for (int c = 0; c < C; c++) {
${pt ? loop('top', pt, 'WP', `y[c * ${Y} + h][w] = Z;`) : ''}${pb ? loop('bottom', pb, 'WP', `y[c * ${Y} + ${pt + H} + h][w] = Z;`) : ''}${pl ? loop('left', 'H', pl, `y[c * ${Y} + ${pt} + h][w] = Z;`) : ''}${pr ? loop('right', 'H', pr, `y[c * ${Y} + ${pt} + h][${pl} + W + w] = Z;`) : ''}${loop('in', 'H', 'W', `y[c * ${Y} + ${pt} + h][${pl} + w] = x[c * ${X} + h][w];`)}    }
}
`;
}

/** Média de size x size (a de nn.js): soma da janela e (soma + n / 2) / n, com n potência de 2 (um deslocamento). */
function avgPoolKernel(name, l, Hs, PHs) {
    const [C, H, W] = l.inShape, [, PH, PW] = l.outShape, s = l.size, n = s * s, sh = Math.log2(n);
    if (!Number.isInteger(sh)) throw new Error(`${name}: a média de ${s} x ${s} precisa de n potência de 2 no código gerado`);
    return `// ${name}: média de ${s} x ${s}, (soma + ${n / 2}) >> ${sh}, na escala e no ponto zero da entrada.
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
                i32 acc = 0;
${name}_y:
                for (int dy = 0; dy < S; dy++)
${name}_x:
                    for (int dx = 0; dx < S; dx++) {
#pragma HLS pipeline II=1
                        acc += x[c * HS + ph * S + dy][pw * S + dx];
                    }
                y[c * PHS + ph][pw] = (acc + ${n / 2}) >> ${sh};
            }
        }
    }
}
`;
}

/**
 * Soma residual (camada add de nn.js): cada entrada é o acumulador de uma convolução "acc" (int32) ou uma ativação
 * menos o ponto zero dela; as duas vão para a reescala de dois produtos (requant2), com o m de cada ramo por canal.
 */
function addKernel(s, ins, yo) {
    const l = s.l, [C, H, W] = l.outShape;
    if (ins.length !== 2) throw new Error(`${l.name}: o código gerado só soma duas entradas`);
    const srcL = l.src.map((j) => (j >= 0 ? s.layers[j] : null));
    const isAcc = srcL.map((P) => !!P?.accOut);
    const mOf = (k) => { const m = isAcc[k] ? srcL[k].rq.m : l.mIn[k]; return m.length === 1 ? Array(C).fill(m[0]) : Array.from(m); };
    const Hs = ins.map((t) => t.stride), OHs = yo.stride;
    const v = (k) => {
        const idx = `${'ab'[k]}[c * ${Hs[k]} + h][w]`;
        return isAcc[k] ? idx : l.zInOf[k] ? `(${idx} - ${l.zInOf[k]})` : idx;
    };
    return `// ${l.name}: soma residual de ${srcL.map((P, k) => `${P?.name ?? 'entrada'}${isAcc[k] ? ' (acumulador)' : ' (ativação)'}`).join(' e ')}, uma reescala só (requant2).
#define C ${C}
#define H ${H}
#define W ${W}
#define Z ${l.zOut}

void ${l.name}(${isAcc[0] ? 'i32' : 'u8'} a[C * ${Hs[0]}][W], ${isAcc[1] ? 'i32' : 'u8'} b[C * ${Hs[1]}][W], u8 y[C * ${OHs}][W]) {
    const u32 ma[C] = {${list(mOf(0))}};
    const u32 mb[C] = {${list(mOf(1))}};
${l.name}_c:
    for (int c = 0; c < C; c++) {
${l.name}_h:
        for (int h = 0; h < H; h++) {
${l.name}_w:
            for (int w = 0; w < W; w++) {
#pragma HLS pipeline II=1
                y[c * ${OHs} + h][w] = requant2(${v(0)}, ma[c], ${v(1)}, mb[c], Z${l.exp ? `, ${l.exp}` : ''});
            }
        }
    }
}
`;
}

function padKernel(name, C, H, W, p, z, Hs = H, HPs = H + 2 * p) {
    // Laços retangulares (linhas de cima e de baixo, colunas da esquerda, colunas da direita, miolo): os índices
    // ficam afins, e o total de escritas é o mesmo da função do C, (H + 2P) x (W + 2P). As colunas da esquerda e as
    // da direita ficam em laços separados: com as duas escritas na mesma linha, o Vitis 2022.2 via uma dependência
    // entre iterações e punha II 2 (relatório da MiniLenet, pad2), e a diretiva dependence na porta do kernel não
    // passa na verificação de síntese (SYNCHK 200-43).
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
${name}_left:
        for (int h = 0; h < H; h++)
            for (int w = 0; w < P; w++) {
#pragma HLS pipeline II=1
                y[c * ${HPs !== H + 2 * p ? 'HPS' : 'HP'} + P + h][w] = Z;
            }
${name}_right:
        for (int h = 0; h < H; h++)
            for (int w = 0; w < P; w++) {
#pragma HLS pipeline II=1
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
    const noRq = l.logits || l.accOut;
    const out = noRq ? `y[${yRow}][ow] = acc + b[${fx}];` : `y[${yRow}][ow] = requant(acc + b[${fx}], m[${fx}], Z);`;
    const prod = (c, kh, kw, f) => `x[${c ? `${c} * HP + ` : ''}oh * S${kh ? ` + ${kh}` : ''}][ow * S${kw ? ` + ${kw}` : ''}] * w[${f}][${(kh * k + kw) * C + c}]`;
    const parts = [];
    if (d.part && d.pipe !== 'off') {
        if (s.rowF) parts.push(`#pragma HLS array_partition variable=x cyclic factor=${s.rowF} dim=1`);
        if (s.colF) parts.push(`#pragma HLS array_partition variable=x cyclic factor=${s.colF} dim=2`);
        if (d.pipe === 'pixel') parts.push('#pragma HLS array_partition variable=w complete dim=2');
        else if (C > 1) parts.push(`#pragma HLS array_partition variable=w cyclic factor=${C} dim=2`);
        if (d.pipe === 'pixel' && P > 1 && P < F) {
            parts.push(`#pragma HLS array_partition variable=w cyclic factor=${P} dim=1`, `#pragma HLS array_partition variable=b cyclic factor=${P} dim=1`);
            if (!noRq) parts.push(`#pragma HLS array_partition variable=m cyclic factor=${P} dim=1`);
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
    return `// ${l.name}: ${F} filtros ${k} x ${k} sobre ${C} canais; ${what}${parts.length ? '; vetores particionados' : ''}${l.accOut ? '; sai o acumulador com o viés (a reescala fica na soma residual)' : ''}.
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
void ${l.name}(u8 x[C * HP][WP], ${noRq ? 'i32' : 'u8'} y[F * OHS][OW]) {
    const i8 w[F][K * K * C] = {${rows.join(', ')}};
    const i32 b[F] = {${list(l.b)}};
${noRq ? '' : `    const u32 m[F] = {${list(l.rq.m.length === 1 ? Array(F).fill(l.rq.m[0]) : l.rq.m)}};\n`}${parts.join('\n')}${parts.length ? '\n' : ''}${body}
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
/** Peças de reescala de uma classe (requant ou requant2) num kernel sintetizado. */
function rqParts(r, cls) {
    const c = r.cost.cells.filter((x) => x.cls === cls);
    const t = (f) => c.reduce((a, x) => a + (x[f] ?? 0), 0);
    return { count: t('count'), dsp: t('dsp'), luts: t('luts'), carry4: t('carry4'), area: t('area') };
}
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
/**
 * LUTs que o Vitis 2022.2 gasta nas operações exatas das redes, medidas no Vivado (rodada do fim de semana,
 * relatório hierárquico das camadas): o multiplicador uint8 por int8 é o núcleo do próprio Vitis (64 LUTs,
 * mul_8ns_8s_16), não a netlist exata da biblioteca (89), e o requant fica entre 12 e 56 LUTs além dos DSP48 (a
 * célula caracterizada sozinha tem 74). Só os LUTs mudam; área e energia ASIC continuam as do sky130.
 */
export const VITIS_NN = { mul8Luts: 64, requantLuts: 45, addrScale: 0.5, controlScale: 0.6 };
// addrScale e controlScale: ajuste de dois fatores nas 26 camadas medidas (node scripts/calibrate.mjs --nnaddr),
// erro médio de LUT de 55% para 15%, também em validação cruzada; o Vitis reduz os endereços afins destes laços a
// contadores e compartilha os contadores dos laços achatados.
const nnFpga = (fpga) => {
    const k = 'MUL8 nativo'; // o produto exato da biblioteca no FPGA: a * b sintetizado pelo Vivado (lib.js)
    if (!fpga?.units?.[k]) return fpga ?? null;
    return { ...fpga, units: { ...fpga.units, [k]: { ...fpga.units[k], luts: VITIS_NN.mul8Luts } } };
};
const nnCells = (cells) => {
    const rq = cells?.cells?.requant;
    if (!rq) return cells;
    const fix = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { ...x, luts: VITIS_NN.requantLuts }]));
    return { ...cells, cells: { ...cells.cells, requant: Object.fromEntries(Object.entries(rq).map(([w, v]) => [w, fix(v)])) } };
};

export function costModel(net, o) {
    const kernels = networkKernels(net, o.dirs);
    const ports = o.ports ?? 2, clockNs = o.clockNs ?? 10;
    const base = { synth: o.synth, cells: nnCells(o.cells), fpga: nnFpga(o.fpga), model: { ...MODEL, addrScale: VITIS_NN.addrScale, controlScale: VITIS_NN.controlScale }, target: o.target ?? 'asic', flow: o.flow ?? 'delay', clockNs, ports, wide: true };
    const cache = new Map();
    // A síntese exata de cada kernel (as operações e as unidades candidatas de cada uma), feita uma vez só.
    const exactOf = new Map();
    // keepResults: false (a busca) guarda só o resumo de cada combinação; a síntese inteira (cerca de 1,5 MB por
    // kernel da ResNet 8) só é necessária para gerar o C++ (nnexport.js).
    const keep = o.keepResults !== false;
    /** Custo de um kernel com as unidades (null: exata). */
    const kernel = (k, mul = null, add = null) => {
        const key = `${k.name}|${mul ?? '-'}|${add ?? '-'}`;
        if (cache.has(key)) return cache.get(key);
        const design = designOf(k.src, ports);
        if (!exactOf.has(k.name)) exactOf.set(k.name, synthesize(k.src, { ...base, design }));
        const r0 = exactOf.get(k.name);
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
            // Peças de reescala da camada (a rede compartilha uma só entre as camadas, veja network).
            rq: rqParts(r, 'requant'),
            rq2: rqParts(r, 'requant2'),
            // Custo das unidades de multiplicação e soma (área e LUT pelas instâncias; energia pelas operações), para a
            // fração aritmética da busca (nnsearch.js, arithmeticShare).
            // ROMs da camada (pesos, vieses e reescalas) em BRAM18; os vetores entre as camadas entram na rede.
            bram18: r.design.arrays.filter((a) => a.kind === 'rom').reduce((n, a) => n + arrayBram18(a, romBits(a)), 0),
            // Saída da camada (o tensor que ela escreve), para a memória entre as camadas (network).
            out: (() => {
                const y = r.design.arrays.filter((a) => a.kind === 'param').at(-1);
                // Acumulador de 32 bits (a saída 'acc' das convoluções da soma residual): o Vitis guarda só a largura
                // da soma, 16 bits do produto de 8 por 8 e mais log2 das parcelas (na ResNet 8, de 20 a 26 bits).
                const w = r.design.arrays.find((a) => a.kind === 'rom' && a.name === 'w');
                const bits = y.type.bits === 32 && w ? 16 + Math.ceil(Math.log2(w.dims.at(-1))) : y.type.bits;
                return { size: y.size, bits, partitions: y.partitions };
            })(),
            arith: (() => {
                const us = r.cost.units.filter((u) => u.cls === 'mul' || u.cls === 'add');
                return { area: us.reduce((a, u) => a + u.area, 0), luts: us.reduce((a, u) => a + u.luts, 0), energy: r.cost.energy.ops };
            })(),
        };
        // A síntese (projeto, atribuição, biblioteca) fica junto, fora do JSON: é dela que sai o C++ (nnexport.js).
        if (keep) Object.defineProperty(row, 'result', { value: r, enumerable: false });
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
        // Latência: cada camada começa quando as entradas ficam prontas. Nas redes em sequência, é a soma; na ResNet 8,
        // a convolução do atalho roda junto com o ramo principal, como o Vitis 2022.2 faz com chamadas independentes
        // (medido: a rede levou s2sc + s3sc ciclos a menos que a soma das camadas).
        const ready = new Map([[0, 0]]);
        let cycles = 0;
        kernels.forEach((k, i) => {
            const end = Math.max(0, ...(k.ins ?? [i]).map((t) => ready.get(t) ?? 0)) + layers[i].cycles;
            ready.set(k.out ?? i + 1, end);
            cycles = Math.max(cycles, end);
        });
        const cyclesSeq = sum('cycles');
        // Memória entre as camadas: um vetor por tensor, com a partição de quem escreve e de quem lê (a maior); a saída
        // da última camada é a porta da rede, fora da conta. As partições de leitura vêm das entradas dos kernels.
        const outIdx = kernels.length - 1;
        const tensorBram = layers.reduce((n, l, i) => (i === outIdx ? n : n + arrayBram18({ size: l.out.size, partitions: l.out.partitions, type: { bits: l.out.bits } }, l.out.bits)), 0);
        const bram18 = sum('bram18') + tensorBram;
        // Reescala compartilhada: as camadas rodam uma depois da outra, e o Vitis 2022.2 instancia o módulo da reescala
        // uma vez só no topo da rede (MiniLenet: 2 DSP48 na rede, 2 em cada camada sozinha). Na soma, ficam as peças
        // da camada que mais usa, no lugar das de todas.
        // O mesmo vale para a reescala da soma residual (axc_requant2, também num módulo próprio): fica a de uma soma.
        const sharedOf = (key) => {
            const all = (f) => layers.reduce((a, x) => a + (x[key]?.[f] ?? 0), 0);
            const big = layers.reduce((b, x) => ((x[key]?.dsp ?? 0) > (b?.[key]?.dsp ?? -1) ? x : b), null)?.[key] ?? {};
            return (f) => all(f) - (big[f] ?? 0);
        };
        const s1 = sharedOf('rq'), s2 = sharedOf('rq2');
        const shared = (f) => s1(f) + s2(f);
        return {
            layers, warnings: [...new Set(layers.flatMap((l) => l.warnings))],
            totals: { cycles, timeUs: (cycles * clockNs) / 1000, area: sum('area') - shared('area'), luts: sum('luts') - shared('luts'), carry4: sum('carry4') - shared('carry4'), ff: sum('ff'), dsp: sum('dsp') - shared('dsp'), energy: sum('energy'), clockNs, requantShared: shared('dsp') > 0 || shared('luts') > 0, cyclesSeq, bram18, tensorBram18: tensorBram },
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
