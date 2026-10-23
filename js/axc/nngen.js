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

/** Os kernels de uma rede decodificada (decodeNet): [{name, type, site, src}]. */
export function networkKernels(net) {
    const out = [];
    let pools = 0, pads = 0, si = -1;
    for (const l of net.layers) {
        if (l.type === 'conv') {
            si++;
            const [C, H, W] = l.inShape, p = l.pad ?? 0;
            let HP = H, WP = W;
            if (p > 0) {
                pads++;
                HP = H + 2 * p; WP = W + 2 * p;
                out.push({ name: `pad${pads}`, type: 'pad', site: null, src: padKernel(`pad${pads}`, C, H, W, p, l.zIn) });
            }
            out.push({ name: l.name, type: 'conv', site: si, src: convKernel(l, HP, WP) });
        } else if (l.type === 'maxpool') {
            pools++;
            out.push({ name: `pool${pools}`, type: 'maxpool', site: null, src: poolKernel(`pool${pools}`, l) });
        } else if (l.type === 'flatten') {
            out.push({ name: 'flatten', type: 'flatten', site: null, src: flattenKernel(l) });
        } else if (l.type === 'dense') {
            si++;
            out.push({ name: l.name, type: 'dense', site: si, src: denseKernel(l) });
        }
    }
    return out;
}

function padKernel(name, C, H, W, p, z) {
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

void ${name}(u8 x[C * H][W], u8 y[C * HP][WP]) {
${name}_c:
    for (int c = 0; c < C; c++) {
${name}_top:
        for (int h = 0; h < P; h++)
            for (int w = 0; w < WP; w++) {
#pragma HLS pipeline II=1
                y[c * HP + h][w] = Z;
                y[c * HP + H + P + h][w] = Z;
            }
${name}_side:
        for (int h = 0; h < H; h++)
            for (int w = 0; w < P; w++) {
#pragma HLS pipeline II=1
                y[c * HP + P + h][w] = Z;
                y[c * HP + P + h][W + P + w] = Z;
            }
${name}_in:
        for (int h = 0; h < H; h++)
            for (int w = 0; w < W; w++) {
#pragma HLS pipeline II=1
                y[c * HP + P + h][P + w] = x[c * H + h][w];
            }
    }
}
`;
}

function convKernel(l, HP, WP) {
    const [C] = l.inShape, [F, OH, OW] = l.outShape, k = l.k, s = l.stride ?? 1;
    // Pesos na ordem dos laços: (ky, kx, canal) para cada filtro.
    const rows = [];
    for (let f = 0; f < F; f++) {
        const r = [];
        for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) for (let c = 0; c < C; c++) r.push(l.w[((f * C + c) * k + ky) * k + kx]);
        rows.push(`{${r.join(', ')}}`);
    }
    const out = l.logits ? `y[f * OH + oh][ow] = acc + b[f];` : `y[f * OH + oh][ow] = requant(acc + b[f], m[f], Z);`;
    return `// ${l.name}: ${F} filtros ${k} x ${k} sobre ${C} canais; pipeline na coluna de saída, janela desenrolada.
#define C ${C}
#define HP ${HP}
#define WP ${WP}
#define F ${F}
#define K ${k}
#define S ${s}
#define OH ${OH}
#define OW ${OW}
#define Z ${l.zOut ?? 0}

void ${l.name}(u8 x[C * HP][WP], ${l.logits ? 'i32' : 'u8'} y[F * OH][OW]) {
    const i8 w[F][K * K * C] = {${rows.join(', ')}};
    const i32 b[F] = {${list(l.b)}};
${l.logits ? '' : `    const u32 m[F] = {${list(l.rq.m.length === 1 ? Array(F).fill(l.rq.m[0]) : l.rq.m)}};\n`}${l.name}_f:
    for (int f = 0; f < F; f++) {
${l.name}_h:
        for (int oh = 0; oh < OH; oh++) {
${l.name}_w:
            for (int ow = 0; ow < OW; ow++) {
#pragma HLS pipeline II=1
                i32 acc = 0;
                for (int kh = 0; kh < K; kh++)
                    for (int kw = 0; kw < K; kw++)
                        for (int c = 0; c < C; c++)
                            acc += x[c * HP + oh * S + kh][ow * S + kw] * w[f][(kh * K + kw) * C + c];
                ${out}
            }
        }
    }
}
`;
}

function poolKernel(name, l) {
    const [C, H, W] = l.inShape, [, PH, PW] = l.outShape, s = l.size;
    const terms = [];
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) terms.push(`x[c * H + ph * S + ${dy}][pw * S + ${dx}]`);
    const expr = terms.reduce((a, t) => (a ? `max(${a}, ${t})` : t), '');
    return `// ${name}: max pooling ${s} x ${s}.
#define C ${C}
#define H ${H}
#define W ${W}
#define S ${s}
#define PH ${PH}
#define PW ${PW}

void ${name}(u8 x[C * H][W], u8 y[C * PH][PW]) {
${name}_c:
    for (int c = 0; c < C; c++) {
${name}_h:
        for (int ph = 0; ph < PH; ph++) {
${name}_w:
            for (int pw = 0; pw < PW; pw++) {
#pragma HLS pipeline II=1
                y[c * PH + ph][pw] = ${expr};
            }
        }
    }
}
`;
}

function flattenKernel(l) {
    const [C, H, W] = l.inShape;
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

function denseKernel(l) {
    const I = l.w.length / l.out, O = l.out;
    const rows = [];
    for (let o = 0; o < O; o++) rows.push(`{${list(l.w.subarray(o * I, (o + 1) * I))}}`);
    const out = l.logits ? 'y[o] = acc + b[o];' : 'y[o] = requant(acc + b[o], m[o], Z);';
    return `// ${l.name}: ${I} entradas, ${O} saídas; pipeline no laço das entradas (acumulação em cadeia).
#define I ${I}
#define O ${O}
#define Z ${l.zOut ?? 0}

void ${l.name}(u8 x[I], ${l.logits ? 'i32' : 'u8'} y[O]) {
    const i8 w[O][I] = {${rows.join(', ')}};
    const i32 b[O] = {${list(l.b)}};
${l.logits ? '' : `    const u32 m[O] = {${list(l.rq.m.length === 1 ? Array(O).fill(l.rq.m[0]) : l.rq.m)}};\n`}${l.name}_o:
    for (int o = 0; o < O; o++) {
        i32 acc = 0;
${l.name}_i:
        for (int i = 0; i < I; i++) {
#pragma HLS pipeline II=1
            acc += x[i] * w[o][i];
        }
        ${out}
    }
}
`;
}

// Custo ---------------------------------------------------------------------------------------------------------

const DESIGNS = new Map();
/** Elaboração de um kernel, guardada pelo código (é a parte cara). */
function designOf(src, ports) {
    const key = `${ports}|${src}`;
    if (!DESIGNS.has(key)) DESIGNS.set(key, elaborate(parse(src), { ports }));
    return DESIGNS.get(key);
}

/**
 * Custo da rede com as unidades escolhidas.
 * @param {object} net rede decodificada
 * @param {{synth, cells, fpga?, target?: 'asic'|'fpga', flow?: string, clockNs?: number, ports?: number,
 *          mul?: string|null, add?: string|null, mask?: boolean[]}} o mul e add: nomes das unidades da biblioteca nas
 *          camadas com mask[site] (null: exatas)
 * @returns {{layers: object[], totals: object, warnings: string[]}}
 */
export function networkCost(net, o) {
    const kernels = networkKernels(net);
    const ports = o.ports ?? 2, clockNs = o.clockNs ?? 10;
    const base = { synth: o.synth, cells: o.cells, fpga: o.fpga ?? null, target: o.target ?? 'asic', flow: o.flow ?? 'delay', clockNs, ports, wide: true };
    const layers = [], warnings = [];
    for (const k of kernels) {
        const design = designOf(k.src, ports);
        const r0 = synthesize(k.src, { ...base, design });
        let r = r0;
        const approx = k.site !== null && (o.mask?.[k.site] ?? true) && (o.mul || o.add);
        if (approx) {
            const assign = new Map();
            for (const op of r0.ops.list) {
                let name = null;
                if (op.cls === 'mul' && o.mul) name = op.candidates.includes(o.mul) ? o.mul : null;
                if (op.cls === 'add' && o.add) name = r0.lib.adderFor(o.add, op.W);
                if (op.cls === 'mul' && o.mul && !name) warnings.push(`${k.name}: ${o.mul} não serve para ${op.label} (fica o exato)`);
                if (name && name !== op.candidates[0]) assign.set(op.id, name);
            }
            r = synthesize(k.src, { ...base, design, assign });
        }
        const t = r.totals;
        layers.push({
            name: k.name, type: k.type, site: k.site, approx: !!approx, cycles: t.cycles, area: t.area, luts: t.luts, carry4: t.carry4,
            ff: t.ff, dsp: t.dsp ?? 0, energy: t.energy, critPs: t.critPs,
            II: r.design.loops.find((x) => x.mode === 'pipelined')?.IIachieved ?? null,
            units: r.cost.units.map((u) => ({ name: u.unit.name, count: u.count })),
        });
    }
    const sum = (f) => layers.reduce((s, x) => s + x[f], 0);
    const cycles = sum('cycles');
    return {
        layers, warnings: [...new Set(warnings)],
        totals: { cycles, timeUs: (cycles * clockNs) / 1000, area: sum('area'), luts: sum('luts'), carry4: sum('carry4'), ff: sum('ff'), dsp: sum('dsp'), energy: sum('energy'), clockNs },
    };
}
