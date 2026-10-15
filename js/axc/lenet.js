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

// Somador aproximado nas acumulações -------------------------------------------------------------------------

/**
 * Soma de acumuladores (inteiros de 32 bits com sinal) com um somador de N bits: a unidade soma os N bits baixos,
 * e a parte alta é somada de forma exata com o vai um que sai dela. Com o somador exato, é a soma exata; com o
 * truncado, o LOA ou o segmentado, o erro fica nos bits baixos, como no circuito.
 * A soma dos bits baixos usa o modelo funcional do somador (o mesmo de adderFunction), conferido contra o circuito nos testes.
 */
export function adderAccumulate(unit) {
    const cfg = unit.cfg, N = cfg.width, M = (1 << N) - 1;
    // Mesma conta de adderFunction (units.js), escrita dentro do laço para ficar rápida: são centenas de milhões
    // de somas para classificar o conjunto de teste.
    const type = cfg.adder === 'trunc' || cfg.adder === 'loa' || cfg.adder === 'seg' ? cfg.adder : 'exact';
    const k = Math.min(cfg.k ?? 0, N), km = (1 << k) - 1;
    const L = Math.max(1, cfg.L ?? 4), P = Math.max(0, cfg.P ?? 0);
    return (acc, prod) => {
        const n = acc.length;
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

const exactAccumulate = (acc, prod) => { for (let i = 0; i < acc.length; i++) acc[i] += prod[i]; return acc; };

/** Camada convolucional para um lote de imagens, termo a termo (viés primeiro, depois cada produto). */
function convPoolBatch(inp, B, C, H, L, T, add) {
    const F = L.shape[0], O = H - 4, P2 = O / 2, n = B * F * O * O;
    const acc = new Int32Array(n), prod = new Int32Array(n);
    for (let i = 0; i < n; i++) acc[i] = L.b[Math.floor(i / (O * O)) % F];
    for (let c = 0; c < C; c++) {
        for (let ky = 0; ky < 5; ky++) {
            for (let kx = 0; kx < 5; kx++) {
                let i = 0;
                for (let b = 0; b < B; b++) {
                    const base = (b * C + c) * H * H;
                    for (let f = 0; f < F; f++) {
                        const wo = (L.w[((f * C + c) * 5 + ky) * 5 + kx] + 127) * 256;
                        for (let y = 0; y < O; y++) {
                            const row = base + (y + ky) * H + kx;
                            for (let x = 0; x < O; x++) prod[i++] = T[wo + inp[row + x]];
                        }
                    }
                }
                add(acc, prod);
            }
        }
    }
    const out = new Uint8Array(B * F * P2 * P2);
    for (let bf = 0; bf < B * F; bf++) {
        for (let y = 0; y < P2; y++) {
            for (let x = 0; x < P2; x++) {
                const i = bf * O * O + 2 * y * O + 2 * x;
                out[bf * P2 * P2 + y * P2 + x] = Math.max(requant(acc[i], L.M), requant(acc[i + 1], L.M), requant(acc[i + O], L.M), requant(acc[i + O + 1], L.M));
            }
        }
    }
    return out;
}

function denseBatch(inp, B, L, T, add, last) {
    const [O, I] = L.shape, n = B * O;
    const acc = new Int32Array(n), prod = new Int32Array(n);
    for (let i = 0; i < n; i++) acc[i] = L.b[i % O];
    for (let k = 0; k < I; k++) {
        for (let b = 0; b < B; b++) for (let o = 0; o < O; o++) prod[b * O + o] = T[(L.w[o * I + k] + 127) * 256 + inp[b * I + k]];
        add(acc, prod);
    }
    if (last) return acc;
    return Uint8Array.from(acc, (v) => requant(v, L.M));
}

/**
 * Classifica as imagens [from, to) em lote, com tabelas de produtos e somas (exatas ou com o somador) por camada.
 * O max pooling depois da nova escala dá o mesmo que antes dela (a nova escala é monótona).
 * @param {Array<Int32Array>} tables tabela de produtos de cada camada
 * @param {Array<Function|null>} adds soma de acumuladores de cada camada (null: exata)
 */
export function classifyBatch(model, test, tables, adds, from, to, preds) {
    const B = to - from;
    const x = new Uint8Array(B * 32 * 32);
    for (let b = 0; b < B; b++) {
        const img = test.images.subarray((from + b) * 784, (from + b + 1) * 784);
        for (let y = 0; y < 28; y++) for (let k = 0; k < 28; k++) x[b * 1024 + (y + 2) * 32 + k + 2] = img[y * 28 + k];
    }
    const [c1, c2, f1, f2, f3] = model.layers;
    const a = (i) => adds[i] ?? exactAccumulate;
    const a1 = convPoolBatch(x, B, 1, 32, c1, tables[0], a(0));
    const a2 = convPoolBatch(a1, B, c1.shape[0], 14, c2, tables[1], a(1));
    const a3 = denseBatch(a2, B, f1, tables[2], a(2), false);
    const a4 = denseBatch(a3, B, f2, tables[3], a(3), false);
    const logits = denseBatch(a4, B, f3, tables[4], a(4), true);
    for (let b = 0; b < B; b++) {
        let p = 0;
        for (let k = 1; k < 10; k++) if (logits[b * 10 + k] > logits[b * 10 + p]) p = k;
        preds[from + b] = p;
    }
    return preds;
}
