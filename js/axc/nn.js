/**
 * Redes convolucionais quantizadas em 8 bits, descritas em JSON (formato axc-nn/1), com os produtos e as somas das
 * acumulações feitos pelas unidades da biblioteca.
 *
 * Convenção (a mesma do código C para o Vitis):
 *   ativações uint8 com ponto zero z; pesos int8 simétricos; viés int32;
 *   acc = soma de w * a, na ordem dos laços do C (ky, kx, canal; ou entrada), e depois + viés;
 *   saída = min(255, max(0, reescala(acc) + z_saída)).
 * O ponto zero da entrada de cada camada fica absorvido no viés: soma de w * (a - z) + b = soma de w * a + (b - z soma w).
 * Por isso os produtos são sempre uint8 x int8 e a borda das convoluções é preenchida com z (a - z = 0).
 * A reescala é em Q32, como no C (M inteiro sem sinal: (acc * M + 2^31) >> 32), ou com M em ponto flutuante,
 * floor(acc * M + 0.5) (a LeNet 5 de scripts/lenet5/train.py).
 *
 * Camadas: conv {out, k, pad, stride}, maxpool {size}, avgpool {size}, flatten, dense {out} e add {inputs}. As
 * camadas com pesos são os pontos de aproximação (os "sites"): cada uma tem a sua tabela de produtos e a sua soma.
 *
 * Grafo (redes com ramos, como a ResNet 8; docs/RESNET8.md): cada camada lê a anterior, a não ser que diga outra em
 * input (o nome dela, ou "input" para a entrada da rede); add lê as duas de inputs. A ordem das camadas é a de
 * execução. Nas convoluções, pad pode ser um número (a mesma borda dos quatro lados) ou [cima, baixo, esquerda,
 * direita], como o padding='same' do Keras no passo 2 (0, 1, 0, 1).
 *
 * Soma residual: a convolução com output "acc" não tem reescala e entrega o acumulador com o viés (int32); a camada
 * add soma as entradas já na escala da saída e faz uma reescala só, sem quantizar os ramos no meio:
 *   v_j = acumulador (convolução "acc") ou a - z_a (ativação uint8);
 *   saída = min(255, max(0, floor((soma de v_j m_j + 2^(31+e)) / 2^(32+e)) + z_saída)),
 * com m_j em Q32 por canal (requant.m, uma lista com um por entrada) e e = requant.exp (0 por padrão; negativo
 * deixa m_j / 2^(32+e) passar de 1). O m da entrada que vem de uma convolução "acc" fica também em l.rq.m dela: é a
 * reescala daquele ramo, e a correção de ganho da busca muda esse m.
 * avgpool soma as size x size ativações de cada janela e divide arredondando para cima no meio:
 *   floor((soma + floor(n / 2)) / n), n = size², na mesma escala e ponto zero da entrada.
 */

import { adderFunction } from './units.js';

export const FORMAT = 'axc-nn/1';

const fromB64 = (s) => {
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
};
const i8 = (s) => new Int8Array(fromB64(s).buffer);
const i32 = (s) => new Int32Array(fromB64(s).buffer);
const u32 = (s) => new Uint32Array(fromB64(s).buffer);

/** Arredondamento para o par mais próximo (o de torch.round e de nearbyint). */
export const roundEven = (x) => {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/**
 * Tabela pixel (0 a 255) -> entrada quantizada. Sem quantização, o próprio pixel.
 * Com {mean, std, scale, zero, qmin, qmax}: q = clamp(round(((p / 255) - mean) / std / scale) + zero).
 */
export function inputTable(q, channel = 0) {
    const T = new Uint8Array(256);
    for (let p = 0; p < 256; p++) {
        if (!q) { T[p] = p; continue; }
        const mean = Array.isArray(q.mean) ? q.mean[channel] : q.mean, std = Array.isArray(q.std) ? q.std[channel] : q.std;
        const v = roundEven((p / 255 - mean) / std / q.scale) + q.zero;
        T[p] = Math.min(q.qmax ?? 255, Math.max(q.qmin ?? 0, v));
    }
    return T;
}

/** (acc * m + 2^31) >> 32 com m inteiro de 32 bits sem sinal, exato (sem passar de 2^53). */
export function mulQ32(acc, m) {
    const mh = Math.floor(m / 65536), ml = m % 65536;
    const q0 = Math.floor((acc * ml + 2147483648) / 65536);
    return Math.floor((acc * mh + q0) / 65536);
}

/**
 * floor((soma de v[j] m[j] + 2^(31+e)) / 2^(32+e)), exato, com v inteiros de até 32 bits com sinal e m de 32 bits sem
 * sinal (os produtos passam de 2^53: m é separado em duas metades de 16 bits). e de -16 a 20.
 */
export function mulQ32Sum(v, m, e = 0) {
    let hi = 0, lo = 2 ** (31 + e);
    for (let j = 0; j < v.length; j++) {
        const mh = Math.floor(m[j] / 65536), ml = m[j] % 65536;
        hi += v[j] * mh;
        lo += v[j] * ml;
    }
    return Math.floor((hi + Math.floor(lo / 65536)) / 2 ** (16 + e));
}

/** Borda [cima, baixo, esquerda, direita] de uma convolução (pad: número ou lista de quatro). */
const padsOf = (pad) => (Array.isArray(pad) ? pad.map((v) => v | 0) : [pad | 0, pad | 0, pad | 0, pad | 0]);

/**
 * Rede a partir do JSON: camadas com os pesos decodificados, as formas de cada tensor e as ligações do grafo
 * (l.src: os índices das camadas que ela lê, -1 para a entrada da rede). net.cuts[li]: o índice do único tensor vivo
 * antes da camada li (o que a inferência precisa para começar dali), quando é um só e de 8 bits; senão, undefined.
 * Nas redes em sequência, todas as camadas são cortes (cuts[li] = li - 1).
 */
export function decodeNet(json) {
    if (json.format !== FORMAT) throw new Error(`formato desconhecido: ${json.format}`);
    const ds = json.dataset;
    const byName = new Map([['input', -1]]);
    const shapeOf = [], zOf = [], accOf = [];          // por índice; a entrada da rede é -1
    const inShape0 = [...ds.shape], z0 = json.input?.zero ?? 0;
    const sh = (j) => (j === -1 ? inShape0 : shapeOf[j]), zz = (j) => (j === -1 ? z0 : zOf[j]);
    const layers = [];
    json.layers.forEach((L, li) => {
        const ref = (name) => {
            if (!byName.has(name)) throw new Error(`${L.name ?? L.type}: entrada desconhecida ${name}`);
            return byName.get(name);
        };
        const src = L.type === 'add' ? (L.inputs ?? []).map(ref) : [L.input !== undefined ? ref(L.input) : li - 1];
        if (L.type === 'add' && src.length < 2) throw new Error(`${L.name}: add precisa de duas entradas`);
        for (const j of src) {
            if (accOf[j] && L.type !== 'add') throw new Error(`${L.name ?? L.type}: só add lê o acumulador de ${json.layers[j].name}`);
        }
        const shape = sh(src[0]);
        const l = { ...L, src, inShape: shape, zIn: zz(src[0]) };
        if (L.type === 'conv') {
            const [C, H, W] = shape, k = L.k, s = L.stride ?? 1, [pt, pb, pl, pr] = padsOf(L.pad ?? 0);
            l.pads = [pt, pb, pl, pr];
            l.w = i8(L.w); l.b = i32(L.b);
            if (l.w.length !== L.out * C * k * k) throw new Error(`${L.name}: ${l.w.length} pesos, esperados ${L.out * C * k * k}`);
            l.outShape = [L.out, Math.floor((H + pt + pb - k) / s) + 1, Math.floor((W + pl + pr - k) / s) + 1];
            l.macs = l.outShape[0] * l.outShape[1] * l.outShape[2] * C * k * k;
        } else if (L.type === 'dense') {
            const I = shape.length === 1 ? shape[0] : shape.reduce((a, b) => a * b, 1);
            l.w = i8(L.w); l.b = i32(L.b);
            if (l.w.length !== L.out * I) throw new Error(`${L.name}: ${l.w.length} pesos, esperados ${L.out * I}`);
            l.outShape = [L.out];
            l.macs = L.out * I;
        } else if (L.type === 'maxpool' || L.type === 'avgpool') {
            const [C, H, W] = shape, s = L.size;
            l.outShape = [C, Math.floor(H / s), Math.floor(W / s)];
        } else if (L.type === 'flatten') {
            l.outShape = [shape.reduce((a, b) => a * b, 1)];
        } else if (L.type === 'add') {
            const shapes = src.map(sh);
            if (shapes.some((x) => x.join() !== shape.join())) throw new Error(`${L.name}: entradas de formas diferentes (${shapes.map((x) => x.join('x')).join(', ')})`);
            const rq = L.requant;
            if (!rq || rq.mode !== 'q32' || !Array.isArray(rq.m) || rq.m.length !== src.length) throw new Error(`${L.name}: add precisa de requant q32 com um m por entrada`);
            l.outShape = shape;
            l.exp = rq.exp ?? 0;
            if (l.exp < -16 || l.exp > 20) throw new Error(`${L.name}: requant.exp fora de -16 a 20`);
            l.mIn = rq.m.map(u32);
            l.zInOf = src.map(zz);
            l.zOut = rq.zero ?? 0;
        } else throw new Error(`camada desconhecida: ${L.type}`);
        let zOut = l.type === 'add' ? l.zOut : l.zIn;
        if (l.w) {
            const rq = L.requant;
            if (L.output === 'acc') {
                l.accOut = true;
                zOut = undefined;
            } else if (rq) {
                l.rq = rq.mode === 'q32' ? { q32: true, m: u32(rq.m) } : { q32: false, M: rq.M };
                l.zOut = rq.zero ?? 0;
                zOut = l.zOut;
            } else l.logits = true;
        }
        if (L.name !== undefined) {
            if (byName.has(L.name)) throw new Error(`nome repetido: ${L.name}`);
            byName.set(L.name, li);
        }
        shapeOf[li] = l.outShape; zOf[li] = zOut; accOf[li] = !!l.accOut;
        layers.push(l);
    });
    // As convoluções "acc" alimentam uma add: a reescala do ramo (o m da entrada) e o ponto zero da saída da add.
    layers.forEach((l, li) => {
        if (l.type !== 'add') return;
        l.src.forEach((j, k) => {
            if (j >= 0 && layers[j].accOut) {
                if (layers[j].addLayer !== undefined) throw new Error(`${layers[j].name}: o acumulador vai para mais de uma add`);
                Object.assign(layers[j], { addLayer: li, addInput: k, rq: { q32: true, m: l.mIn[k] }, zOut: l.zOut });
            } else if (j >= 0 && layers[j].logits) throw new Error(`${l.name}: entrada sem reescala (${layers[j].name})`);
        });
    });
    layers.forEach((l) => { if (l.accOut && l.addLayer === undefined) throw new Error(`${l.name}: output "acc" sem add que o leia`); });
    const last = layers.length - 1;
    // Tensores vivos antes de cada camada: os produzidos antes dela e lidos por ela ou por uma depois.
    const lastUse = new Map();
    layers.forEach((l, li) => { for (const j of l.src) lastUse.set(j, li); });
    const cuts = layers.map((_, li) => {
        const live = [];
        for (let j = -1; j < li; j++) if ((lastUse.get(j) ?? -2) >= li) live.push(j);
        return live.length === 1 && !accOf[live[0]] ? live[0] : undefined;
    });
    const sites = layers.filter((l) => l.w);
    if (!sites.length || !sites[sites.length - 1]) throw new Error('rede sem camadas com pesos');
    if (layers[last].accOut || layers[last].type === 'add') throw new Error('a última camada tem de dar as saídas (uma camada com pesos)');
    const shape = layers[last].outShape;
    return {
        id: json.id, name: json.name, description: json.description ?? '', source: json.source ?? null,
        dataset: ds, input: json.input ?? null,
        // Uma tabela por canal de entrada (a normalização pode ser por canal, como na CIFAR 10).
        inputLuts: Array.from({ length: ds.shape.length === 3 ? ds.shape[0] : 1 }, (_, c) => inputTable(json.input, c)),
        layers, sites, cuts, classes: shape[0], lastUse: layers.map((_, j) => lastUse.get(j) ?? j),
        graph: layers.some((l, li) => l.src.length > 1 || l.src[0] !== li - 1),
        accuracy: json.accuracy ?? {}, expected: json.expected ? fromB64(json.expected) : null,
    };
}

/** Conjunto de teste: n rótulos e depois n imagens (C x H x W, uint8). */
export function decodeTestSet(buf, ds) {
    const u = new Uint8Array(buf), n = ds.n, size = ds.shape.reduce((a, b) => a * b, 1);
    return { n, size, shape: ds.shape, labels: u.subarray(0, n), images: u.subarray(n, n + n * size) };
}

/** Multiplicações por imagem de cada camada com pesos. */
export const macsPerSite = (net) => net.sites.map((l) => l.macs);

/**
 * Tabela de produtos: T[(w + 128) * 256 + a], w de -128 a 127, a de 0 a 255. Sem unidade (null), os produtos exatos.
 * Nas unidades sem sinal, o produto é sinal(w) x unidade(a, |w|), com o sinal aplicado de forma exata. No Booth de
 * 8 bits, com sinal, a ativação não cabe (vai até 255): a unidade recebe a >> 1 e o produto é dobrado. Nas unidades
 * de 16 bits, os operandos ocupam os bits baixos.
 * @returns {Int32Array|null} null quando a unidade não é um multiplicador
 */
export function productTable(unit) {
    const T = new Int32Array(256 * 256);
    if (!unit) {
        for (let w = -128; w < 128; w++) for (let a = 0; a < 256; a++) T[(w + 128) * 256 + a] = a * w;
        return T;
    }
    if (unit.kind !== 'mul') return null;
    const N = unit.cfg.width, signed = !!unit.signed, halve = signed && N === 8;
    const ws = signed ? 256 : 129;                   // com sinal, todos os w; sem sinal, só |w| (até 128)
    const as = new Uint32Array(ws * 256), bs = new Uint32Array(ws * 256);
    const mask = 2 ** N - 1;
    for (let i = 0; i < ws; i++) {
        const w = signed ? i - 128 : i;
        for (let a = 0; a < 256; a++) { as[i * 256 + a] = halve ? a >> 1 : a; bs[i * 256 + a] = w & mask; }
    }
    const raw = unit.net.evaluate(as, bs);
    const val = (k) => (unit.decode ? unit.decode(raw[k]) : raw[k]);
    for (let w = -128; w < 128; w++) {
        for (let a = 0; a < 256; a++) {
            T[(w + 128) * 256 + a] = signed ? val((w + 128) * 256 + a) * (halve ? 2 : 1) : Math.sign(w) * val(Math.abs(w) * 256 + a);
        }
    }
    return T;
}

// Somador aproximado nas acumulações -------------------------------------------------------------------------

/**
 * Soma de acumuladores (inteiros de 32 bits com sinal) com um somador de N bits: a unidade soma os N bits baixos,
 * e a parte alta é somada de forma exata com o vai um que sai dela. Com o somador exato, é a soma exata; com o
 * truncado, o LOA ou o segmentado, o erro fica nos bits baixos, como no circuito.
 * A soma dos bits baixos usa o modelo funcional do somador (o mesmo de adderFunction), conferido contra o circuito
 * nos testes. Devolve add(acc, prod, n): acc[i] = acc[i] (+) prod[i] para i < n.
 */
export function adderAccumulate(unit) {
    const cfg = unit.cfg, N = cfg.width;
    if (N >= 32) {
        // A unidade faz o acumulador inteiro: soma de 32 bits, e o resultado fica no int32 (o vai um que sai do bit 31
        // se perde, como no int32 do C). Operações bit a bit do JavaScript (32 bits); os deslocamentos de 32, que o
        // JavaScript faz como de 0, ficam de fora.
        const type = cfg.adder === 'trunc' || cfg.adder === 'loa' || cfg.adder === 'seg' ? cfg.adder : 'exact';
        const k = Math.min(cfg.k ?? 0, 32), km = k >= 31 ? (k === 31 ? 0x7fffffff : -1) : (1 << k) - 1;
        const L = Math.max(1, cfg.L ?? 4), P = Math.max(0, cfg.P ?? 0);
        // Um laço por tipo (a escolha fora do laço: a busca da página de redes chama isto milhões de vezes).
        if (type === 'exact' || (k === 0 && type !== 'seg')) {
            return (acc, prod, n = acc.length) => { for (let i = 0; i < n; i++) acc[i] = (acc[i] + prod[i]) | 0; return acc; };
        }
        if (type === 'trunc') {
            if (k >= 32) return (acc, prod, n = acc.length) => { acc.fill(0, 0, n); return acc; };
            return (acc, prod, n = acc.length) => { for (let i = 0; i < n; i++) acc[i] = (((acc[i] >>> k) + (prod[i] >>> k)) << k) | 0; return acc; };
        }
        if (type === 'loa') {
            if (k >= 32) return (acc, prod, n = acc.length) => { for (let i = 0; i < n; i++) acc[i] = acc[i] | prod[i]; return acc; };
            const k1 = k - 1;
            return (acc, prod, n = acc.length) => {
                for (let i = 0; i < n; i++) {
                    const x = acc[i], y = prod[i];
                    acc[i] = ((((x >>> k) + (y >>> k) + ((x >>> k1) & (y >>> k1) & 1)) << k) | ((x | y) & km)) | 0;
                }
                return acc;
            };
        }
        return (acc, prod, n = acc.length) => {
            for (let i = 0; i < n; i++) {
                const x = acc[i], y = prod[i];
                let r;
                {
                    r = 0;
                    for (let s = 0; s < 32; s += L) {
                        const hi = s + L < 32 ? s + L : 32, w = hi - s, lo = s - P > 0 ? s - P : 0;
                        const cin = s === 0 || P === 0 ? 0 : ((((x >>> lo) & ((1 << (s - lo)) - 1)) + ((y >>> lo) & ((1 << (s - lo)) - 1))) >>> (s - lo));
                        const wm = w >= 32 ? -1 : (1 << w) - 1;
                        r |= ((((x >>> s) & wm) + ((y >>> s) & wm) + cin) & wm) << s;
                    }
                }
                acc[i] = r | 0;
            }
            return acc;
        };
    }
    const M = (1 << N) - 1;
    // Mesma conta de adderFunction (units.js), escrita dentro do laço para ficar rápida.
    const type = cfg.adder === 'trunc' || cfg.adder === 'loa' || cfg.adder === 'seg' ? cfg.adder : 'exact';
    const k = Math.min(cfg.k ?? 0, N), km = (1 << k) - 1;
    const L = Math.max(1, cfg.L ?? 4), P = Math.max(0, cfg.P ?? 0);
    return (acc, prod, n = acc.length) => {
        for (let i = 0; i < n; i++) {
            const x = acc[i], y = prod[i], a = x & M, b = y & M;
            let r;
            if (type === 'exact') r = a + b;
            else if (type === 'trunc') r = ((a >>> k) + (b >>> k)) << k;
            else if (type === 'loa') r = (((a >>> k) + (b >>> k) + (k > 0 ? (a >>> (k - 1)) & (b >>> (k - 1)) & 1 : 0)) << k) | ((a | b) & km);
            else {
                r = 0;
                let cout = 0;
                for (let s = 0; s < N; s += L) {
                    const hi = s + L < N ? s + L : N, w = hi - s, lo = s - P > 0 ? s - P : 0;
                    const cin = s === 0 || P === 0 ? 0 : ((((a >>> lo) & ((1 << (s - lo)) - 1)) + ((b >>> lo) & ((1 << (s - lo)) - 1))) >>> (s - lo));
                    const sum = ((a >>> s) & ((1 << w) - 1)) + ((b >>> s) & ((1 << w) - 1)) + cin;
                    r |= (sum & ((1 << w) - 1)) << s;
                    cout = sum >>> w;
                }
                r += cout << N;
            }
            const carry = r >>> N;
            acc[i] = (((x >> N) + (y >> N) + carry) << N) + (r & M);
        }
        return acc;
    };
}

// Inferência ---------------------------------------------------------------------------------------------------

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
function requantize(l, acc, ch, M = l.rq.m) {
    const v = l.rq.q32 ? mulQ32(acc, M[M.length === 1 ? 0 : ch]) : Math.floor(acc * l.rq.M + 0.5);
    return clamp8(v + l.zOut);
}

/**
 * Soma dos termos de todas as saídas com a unidade (fill(t, out) põe o termo t de cada saída em out):
 *   tree = 1: em cadeia, como o laço do C (acc = 0; acc += termo, um por vez);
 *   tree = U > 1: em árvores de U termos (os termos de cada grupo somados dois a dois, nível por nível, como a
 *     expressão de um laço desenrolado com EXPRESSION_BALANCE), e cada árvore somada ao acumulador, que começa em 0
 *     (acc = 0; acc += árvore, como o laço com o fator de desenrolamento U);
 *   tree = 0: todos os termos numa árvore só (o laço inteiro desenrolado).
 */
export function sumTerms(nTerms, fill, n, add, tree, scratch = makeScratch()) {
    const acc = scratch.acc(n);
    acc.fill(0, 0, n);
    const U = tree === 0 ? nTerms : Math.max(1, Math.min(tree ?? 1, nTerms));
    if (U === 1) {
        const p = scratch.prod(n);
        for (let t = 0; t < nTerms; t++) { fill(t, p); add(acc, p, n); }
        return acc;
    }
    const pool = scratch.terms(U, n);
    for (let g = 0; g < nTerms; g += U) {
        const m = Math.min(U, nTerms - g);
        const level = pool.slice(0, m);
        for (let j = 0; j < m; j++) fill(g + j, level[j]);
        for (let len = m; len > 1;) {
            let w = 0;
            for (let i = 0; i < len; i += 2) {
                if (i + 1 < len) add(level[i], level[i + 1], n);
                level[w++] = level[i];
            }
            len = w;
        }
        if (U >= nTerms) acc.set(level[0].subarray(0, n)); else add(acc, level[0], n);
    }
    return acc;
}

/** Convolução: acumuladores (sem o viés ainda) de todas as saídas, termo a termo na ordem ky, kx, canal. */
function convAcc(l, x, T, add, tree, scratch) {
    const [C, H, W] = l.inShape, [F, OH, OW] = l.outShape, k = l.k, s = l.stride ?? 1, z = l.zIn;
    const [pt, pb, pl, pr] = l.pads ?? padsOf(l.pad ?? 0), pad = pt + pb + pl + pr;
    const n = F * OH * OW;
    const acc = scratch.acc(n);
    acc.fill(0, 0, n);
    const w = l.w;
    if (!add) {
        // Soma exata: a ordem não muda o resultado. A entrada vai para um buffer com a borda (preenchida com o
        // ponto zero) e os pesos viram deslocamentos na tabela.
        const PH = H + pt + pb, PW = W + pl + pr;
        const xp = scratch.padded(C * PH * PW);
        if (pad) xp.fill(z, 0, C * PH * PW);
        for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) xp.set(x.subarray((c * H + y) * W, (c * H + y + 1) * W), (c * PH + y + pt) * PW + pl);
        const wo = l.wOff ??= Int32Array.from(w, (v) => (v + 128) * 256);
        for (let f = 0; f < F; f++) {
            for (let oy = 0; oy < OH; oy++) {
                for (let ox = 0; ox < OW; ox++) {
                    let a = 0;
                    for (let c = 0; c < C; c++) {
                        const wb = (f * C + c) * k * k, base = c * PH * PW + oy * s * PW + ox * s;
                        for (let ky = 0; ky < k; ky++) {
                            const row = base + ky * PW, wr = wb + ky * k;
                            for (let kx = 0; kx < k; kx++) a += T[wo[wr + kx] + xp[row + kx]];
                        }
                    }
                    acc[(f * OH + oy) * OW + ox] = a;
                }
            }
        }
        return acc;
    }
    // Com a unidade, a ordem conta: termo t = (ky, kx, canal), a ordem dos laços do C. A entrada vai para o buffer
    // com a borda (o ponto zero), como no caminho exato.
    const PH = H + pt + pb, PW = W + pl + pr;
    const xp = scratch.padded(C * PH * PW);
    if (pad) xp.fill(z, 0, C * PH * PW);
    for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) xp.set(x.subarray((c * H + y) * W, (c * H + y + 1) * W), (c * PH + y + pt) * PW + pl);
    const fill = (t, out) => {
        const ky = Math.floor(t / (k * C)), kx = Math.floor(t / C) % k, c = t % C;
        let i = 0;
        for (let f = 0; f < F; f++) {
            const wo = (w[((f * C + c) * k + ky) * k + kx] + 128) * 256;
            for (let oy = 0; oy < OH; oy++) {
                let p = (c * PH + oy * s + ky) * PW + kx;
                for (let ox = 0; ox < OW; ox++, p += s) out[i++] = T[wo + xp[p]];
            }
        }
    };
    return sumTerms(C * k * k, fill, n, add, tree, scratch);
}

function denseAcc(l, x, T, add, tree, scratch) {
    const O = l.out, I = x.length, w = l.w;
    const acc = scratch.acc(O);
    acc.fill(0, 0, O);
    if (!add) {
        const wo = l.wOff ??= Int32Array.from(w, (v) => (v + 128) * 256);
        for (let o = 0; o < O; o++) {
            let a = 0;
            const wb = o * I;
            for (let i = 0; i < I; i++) a += T[wo[wb + i] + x[i]];
            acc[o] = a;
        }
        return acc;
    }
    const fill = (i, out) => { for (let o = 0; o < O; o++) out[o] = T[(w[o * I + i] + 128) * 256 + x[i]]; };
    return sumTerms(I, fill, O, add, tree, scratch);
}

function makeScratch() {
    let A = new Int32Array(4096), P = new Int32Array(4096), B = new Int32Array(1), X = new Uint8Array(4096);
    const pool = [];
    return {
        terms: (U, n) => {
            for (let j = 0; j < U; j++) if (!pool[j] || pool[j].length < n) pool[j] = new Int32Array(n);
            return pool;
        },
        acc: (n) => (A.length >= n ? A : (A = new Int32Array(n))),
        prod: (n) => (P.length >= n ? P : (P = new Int32Array(n))),
        padded: (n) => (X.length >= n ? X : (X = new Uint8Array(n))),
        one: () => B,
    };
}

/**
 * Inferência de uma imagem (pixels uint8). Devolve a classe prevista e as saídas da última camada.
 * @param {Array<Int32Array>} tables tabela de produtos de cada camada com pesos
 * @param {Array<Function|null>} adds soma de cada camada com pesos (null: exata)
 * @param {Array<number>} trees estrutura da soma de cada camada com pesos (1: em cadeia, o padrão; 0: árvore com todos
 *   os termos; U: árvores de U termos). Com a soma exata, não muda nada.
 */
export function infer(net, img, tables, adds = [], scratch = makeScratch(), trees = [], biases = null, scales = null) {
    return inferFrom(net, inputActivations(net, img), 0, tables, adds, scratch, trees, null, biases, scales);
}

/** Ativações da entrada da rede (os pixels pela tabela de quantização de cada canal). */
export function inputActivations(net, img, x = new Uint8Array(img.length)) {
    const luts = net.inputLuts, plane = img.length / luts.length;
    for (let c = 0, i = 0; c < luts.length; c++) { const T = luts[c]; for (let e = i + plane; i < e; i++) x[i] = T[img[i]]; }
    return x;
}

/**
 * Pré-ativação de uma camada com pesos (antes da reescala): a soma dos produtos mais o viés, pela unidade (como em
 * inferFrom) ou exata. b: o viés de cada canal de saída (o da camada, sem outro). Devolve um Int32Array novo.
 */
export function preActivation(l, x, T, add = null, tree = 1, b = l.b, scratch = makeScratch()) {
    const acc = l.type === 'conv' ? convAcc(l, x, T, add, tree, scratch) : denseAcc(l, x, T, add, tree, scratch);
    const n = l.outShape.reduce((a, c) => a * c, 1), per = n / l.outShape[0];
    const out = Int32Array.from(acc.subarray(0, n));
    if (add) {
        for (let ch = 0; ch < l.outShape[0]; ch++) {
            const tmp = scratch.prod(per);
            tmp.fill(b[ch], 0, per);
            add(out.subarray(ch * per, (ch + 1) * per), tmp, per);
        }
    } else for (let i = 0; i < n; i++) out[i] += b[Math.floor(i / per)];
    return out;
}

/**
 * Rede com o viés das camadas com pesos trocado (b - delta[si] em cada canal) e, opcionalmente, a reescala (m[si], o
 * multiplicador Q32 de cada canal, na correção de ganho); null: o da rede. Os pesos e as formas são os mesmos objetos
 * da rede original; é a rede que a página classifica e exporta com a correção da busca.
 */
export function withBiases(net, delta, scales = null) {
    if ((!delta || delta.every((d) => !d)) && (!scales || scales.every((m) => !m))) return net;
    const map = new Map();
    net.sites.forEach((l, si) => {
        const d = delta?.[si], m = scales?.[si];
        if (!d && !m) return;
        const b = d ? Int32Array.from(l.b, (v, ch) => v - (d[ch] ?? 0)) : l.b;
        const rq = m && l.rq ? { ...l.rq, m: Uint32Array.from(m) } : l.rq;
        map.set(l, { ...l, b, rq });
    });
    const layers = net.layers.map((l) => map.get(l) ?? l);
    return { ...net, layers, sites: layers.filter((l) => l.w) };
}

/** Viés pela unidade (mais uma soma do acumulador) ou exato, canal a canal, em acc (n = canais x per). */
function addBias(acc, B, C, per, add, scratch) {
    if (add) {
        for (let ch = 0; ch < C; ch++) {
            const tmp = scratch.prod(per);
            tmp.fill(B[ch], 0, per);
            add(acc.subarray(ch * per, (ch + 1) * per), tmp, per);
        }
    } else for (let ch = 0, i = 0; ch < C; ch++) { const b = B[ch]; for (let e = i + per; i < e; i++) acc[i] += b; }
}

/**
 * Inferência a partir da camada net.layers[from], com x o tensor vivo antes dela (não é alterado): a entrada dela nas
 * redes em sequência; nas redes com ramos, from tem de ser um corte (net.cuts[from] definido), e x é o único tensor
 * vivo ali. record(li, x), se dado, recebe a primeira entrada de cada camada li (a busca guarda as dos cortes e mede
 * os operandos das camadas com pesos). biases[si], se dado, é o viés da camada com pesos si no lugar do dela (a
 * correção do viés da busca); scales[si], a reescala (m de cada canal, a correção de ganho; numa convolução "acc", o m
 * do ramo dela na add).
 */
export function inferFrom(net, x, from, tables, adds = [], scratch = makeScratch(), trees = [], record = null, biases = null, scales = null) {
    const L = net.layers;
    const p0 = net.cuts ? net.cuts[from] : from - 1;
    if (p0 === undefined) throw new Error(`a inferência não pode começar na camada ${L[from].name ?? from}: há mais de um tensor vivo ali`);
    const vals = new Array(L.length);
    let input = null;
    if (p0 === -1) input = x; else vals[p0] = x;
    const get = (j) => (j === -1 ? input : vals[j]);
    let si = 0;
    for (let li = 0; li < from; li++) if (L[li].w) si++;
    const siteOfLayer = new Map();
    for (let li = 0, k = 0; li < L.length; li++) if (L[li].w) siteOfLayer.set(li, k++);
    for (let li = from; li < L.length; li++) {
        const l = L[li];
        x = get(l.src[0]);
        if (record) record(li, x);
        if (l.w) {
            const T = tables[si], add = adds[si] ?? null, tree = trees[si] ?? 1, B = biases?.[si] ?? l.b, MS = scales?.[si] ?? l.rq?.m;
            si++;
            const acc = l.type === 'conv' ? convAcc(l, x, T, add, tree, scratch) : denseAcc(l, x, T, add, tree, scratch);
            const C = l.outShape[0], n = l.outShape.reduce((a, b) => a * b, 1), per = n / C;
            // O viés entra no fim, como no C: (soma dos produtos) + viés.
            if (l.logits || l.accOut) {
                const o = Int32Array.from(acc.subarray(0, n));
                addBias(o, B, C, per, add, scratch);
                vals[li] = o;
            } else {
                addBias(acc, B, C, per, add, scratch);
                const y = new Uint8Array(n);
                for (let i = 0; i < n; i++) y[i] = requantize(l, acc[i], Math.floor(i / per), MS);
                vals[li] = y;
            }
        } else if (l.type === 'maxpool' || l.type === 'avgpool') {
            const [C, H, W] = l.inShape, [, PH, PW] = l.outShape, s = l.size, avg = l.type === 'avgpool', nn = s * s, half = Math.floor(nn / 2);
            const y = new Uint8Array(C * PH * PW);
            for (let c = 0; c < C; c++) {
                for (let py = 0; py < PH; py++) {
                    for (let px = 0; px < PW; px++) {
                        let m = 0;
                        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
                            const v = x[(c * H + py * s + dy) * W + px * s + dx];
                            if (avg) m += v; else if (v > m) m = v;
                        }
                        y[(c * PH + py) * PW + px] = avg ? Math.floor((m + half) / nn) : m;
                    }
                }
            }
            vals[li] = y;
        } else if (l.type === 'add') {
            // Cada entrada já na escala da saída (m em Q32 por canal) e uma reescala só.
            const C = l.outShape[0], n = l.outShape.reduce((a, b) => a * b, 1), per = n / C, J = l.src.length;
            const ins = l.src.map(get), ms = l.src.map((j, k) => {
                const P = j >= 0 ? L[j] : null;
                return P?.accOut ? (scales?.[siteOfLayer.get(j)] ?? P.rq.m) : l.mIn[k];
            });
            const isAcc = l.src.map((j) => j >= 0 && !!L[j].accOut);
            const v = new Array(J), m = new Array(J), y = new Uint8Array(n);
            for (let i = 0; i < n; i++) {
                const ch = Math.floor(i / per);
                for (let k = 0; k < J; k++) {
                    v[k] = isAcc[k] ? ins[k][i] : ins[k][i] - l.zInOf[k];
                    m[k] = ms[k][ms[k].length === 1 ? 0 : ch];
                }
                y[i] = clamp8(mulQ32Sum(v, m, l.exp) + l.zOut);
            }
            vals[li] = y;
        } else vals[li] = x; // flatten: o vetor já está em C x H x W, a mesma ordem do C (f, h, w).
        // Libera o que ninguém mais lê (os ramos das redes grandes ocupam memória).
        for (const j of l.src) if (j >= 0 && (net.lastUse?.[j] ?? Infinity) <= li) vals[j] = undefined;
    }
    // As saídas são as da última camada (o maior valor dá a classe).
    const out = vals[L.length - 1];
    let pred = 0;
    for (let k = 1; k < out.length; k++) if (out[k] > out[pred]) pred = k;
    return { pred, out };
}

/** Classifica as imagens [from, to) do conjunto de teste (trees: a estrutura da soma de cada camada, veja infer). */
export function classifyRange(net, test, tables, adds, from, to, preds, trees = [], biases = null, scales = null) {
    const scratch = makeScratch();
    for (let k = from; k < to; k++) preds[k] = infer(net, test.images.subarray(k * test.size, (k + 1) * test.size), tables, adds, scratch, trees, biases, scales).pred;
    return preds;
}

/** Acurácia, matriz de confusão (real x previsto) e imagens que mudaram em relação à referência. */
export function summarize(test, preds, ref, classes = 10) {
    const conf = Array.from({ length: classes }, () => new Array(classes).fill(0));
    let ok = 0, fixed = 0;
    const broke = [];
    for (let k = 0; k < test.n; k++) {
        const y = test.labels[k];
        conf[y][preds[k]]++;
        if (preds[k] === y) ok++;
        if (ref) {
            if (ref[k] === y && preds[k] !== y) broke.push(k);
            if (ref[k] !== y && preds[k] === y) fixed++;
        }
    }
    return { accuracy: ok / test.n, conf, broke, fixed };
}
