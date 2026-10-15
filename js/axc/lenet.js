/**
 * LeNet-5 quantizada em 8 bits (pesos com sinal, ativações sem sinal) com os produtos feitos pela unidade
 * aproximada. É a mesma conta inteira de scripts/lenet5/train.py:
 *
 *   acc = b + soma de produto(a, w)          acumulação inteira exata
 *   a'  = min(255, max(0, floor(acc * M + 0.5)))   ReLU e nova escala
 *   max pooling 2 x 2 sobre os inteiros; a última camada devolve os acumuladores.
 *
 * Os produtos vêm de uma tabela com todos os pares (a de 0 a 255, w de -127 a 127), calculada uma vez com a
 * unidade (avaliação em paralelo). Nas unidades sem sinal, o produto é sinal(w) x unidade(a, |w|), com o sinal
 * aplicado de forma exata. No Booth de 8 bits, com sinal, a ativação não cabe (vai até 255): a unidade recebe
 * a >> 1 e o produto é dobrado. Nas unidades de 16 bits, os operandos de 8 bits ocupam os bits baixos.
 */

export const LAYERS = ['conv1', 'conv2', 'fc1', 'fc2', 'fc3'];

const fromB64 = (s) => {
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
};

/** Modelo a partir de data/lenet5.json. */
export function decodeModel(json) {
    const layers = json.layers.map((L) => {
        const wb = fromB64(L.w), bb = fromB64(L.b);
        return { name: L.name, shape: L.shape, w: new Int8Array(wb.buffer), b: new Int32Array(bb.buffer.slice(0)), M: L.M };
    });
    return { layers, accuracy: json.accuracy, expected: fromB64(json.expected), subset: json.subset };
}

/** Conjunto de teste de data/mnist1000.bin: n rótulos e depois n imagens 28 x 28. */
export function decodeTestSet(buf, n = 1000) {
    const u = new Uint8Array(buf);
    return { n, labels: u.subarray(0, n), images: u.subarray(n, n + n * 784) };
}

/** Número de multiplicações por imagem em cada camada. */
export function macsPerLayer(model) {
    const [c1, c2, f1, f2, f3] = model.layers;
    return [28 * 28 * c1.shape[0] * 25, 10 * 10 * c2.shape[0] * c2.shape[1] * 25, f1.shape[0] * f1.shape[1], f2.shape[0] * f2.shape[1], f3.shape[0] * f3.shape[1]];
}

/**
 * Tabela de produtos: T[(w + 127) * 256 + a]. Sem unidade (null), os produtos exatos.
 * @returns {Int32Array|null} null quando a unidade não serve (somador)
 */
export function productTable(unit) {
    const T = new Int32Array(255 * 256);
    if (!unit) {
        for (let w = -127; w <= 127; w++) for (let a = 0; a < 256; a++) T[(w + 127) * 256 + a] = a * w;
        return T;
    }
    if (unit.kind !== 'mul') return null;
    const N = unit.cfg.width;
    const signed = !!unit.signed;
    const halve = signed && N === 8;                 // Booth de 8 bits: a >> 1, produto dobrado
    const ws = signed ? 255 : 128;                   // com sinal, todos os w; sem sinal, só |w|
    const as = new Uint32Array(ws * 256), bs = new Uint32Array(ws * 256);
    const mask = 2 ** N - 1;
    for (let i = 0; i < ws; i++) {
        const w = signed ? i - 127 : i;
        for (let a = 0; a < 256; a++) { as[i * 256 + a] = halve ? a >> 1 : a; bs[i * 256 + a] = w & mask; }
    }
    const raw = unit.net.evaluate(as, bs);
    const val = (k) => (unit.decode ? unit.decode(raw[k]) : raw[k]);
    for (let w = -127; w <= 127; w++) {
        for (let a = 0; a < 256; a++) {
            const p = signed ? val((w + 127) * 256 + a) * (halve ? 2 : 1) : Math.sign(w) * val(Math.abs(w) * 256 + a);
            T[(w + 127) * 256 + a] = p;
        }
    }
    return T;
}

const requant = (acc, M) => { const v = Math.floor(acc * M + 0.5); return v < 0 ? 0 : v > 255 ? 255 : v; };

/** Convolução 5 x 5 sem borda, ReLU com nova escala e max pooling 2 x 2. */
function convPool(inp, C, H, L, T) {
    const F = L.shape[0], K = 5, O = H - K + 1, P = O / 2;
    const out = new Uint8Array(F * P * P);
    const conv = new Uint8Array(O * O);
    const wOff = new Int32Array(L.w.length);
    for (let i = 0; i < L.w.length; i++) wOff[i] = (L.w[i] + 127) * 256;
    for (let f = 0; f < F; f++) {
        for (let y = 0; y < O; y++) {
            for (let x = 0; x < O; x++) {
                let acc = L.b[f];
                for (let c = 0; c < C; c++) {
                    const base = c * H * H, wb = ((f * C) + c) * 25;
                    for (let ky = 0; ky < K; ky++) {
                        const row = base + (y + ky) * H + x, wr = wb + ky * 5;
                        for (let kx = 0; kx < K; kx++) acc += T[wOff[wr + kx] + inp[row + kx]];
                    }
                }
                conv[y * O + x] = requant(acc, L.M);
            }
        }
        for (let y = 0; y < P; y++) {
            for (let x = 0; x < P; x++) {
                const i = 2 * y * O + 2 * x;
                out[f * P * P + y * P + x] = Math.max(conv[i], conv[i + 1], conv[i + O], conv[i + O + 1]);
            }
        }
    }
    return out;
}

function dense(inp, L, T, last) {
    const [O, I] = L.shape;
    const out = last ? new Int32Array(O) : new Uint8Array(O);
    for (let o = 0; o < O; o++) {
        let acc = L.b[o];
        const wb = o * I;
        for (let i = 0; i < I; i++) acc += T[(L.w[wb + i] + 127) * 256 + inp[i]];
        out[o] = last ? acc : requant(acc, L.M);
    }
    return out;
}

/**
 * Classifica uma imagem 28 x 28.
 * @param {Array<Int32Array>} tables tabela de produtos de cada camada (aproximada ou exata)
 * @returns {{pred: number, logits: Int32Array}}
 */
export function classify(model, img, tables) {
    const x = new Uint8Array(32 * 32);
    for (let y = 0; y < 28; y++) for (let k = 0; k < 28; k++) x[(y + 2) * 32 + k + 2] = img[y * 28 + k];
    const [c1, c2, f1, f2, f3] = model.layers;
    const a1 = convPool(x, 1, 32, c1, tables[0]);
    const a2 = convPool(a1, c1.shape[0], 14, c2, tables[1]);
    const a3 = dense(a2, f1, tables[2], false);
    const a4 = dense(a3, f2, tables[3], false);
    const logits = dense(a4, f3, tables[4], true);
    let pred = 0;
    for (let k = 1; k < logits.length; k++) if (logits[k] > logits[pred]) pred = k;
    return { pred, logits };
}

/** Classifica as imagens [from, to) do conjunto de teste. */
export function classifyRange(model, test, tables, from, to, preds) {
    for (let k = from; k < to; k++) preds[k] = classify(model, test.images.subarray(k * 784, (k + 1) * 784), tables).pred;
    return preds;
}

/** Acurácia, matriz de confusão (real x previsto) e imagens que mudaram em relação à referência. */
export function summarize(test, preds, ref) {
    const conf = Array.from({ length: 10 }, () => new Array(10).fill(0));
    let ok = 0, broke = [], fixed = 0;
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
