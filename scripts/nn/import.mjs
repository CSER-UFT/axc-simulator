#!/usr/bin/env node
/**
 * Gera uma rede no formato axc-nn/1 (js/axc/nn.js) a partir dos cabeçalhos C de um projeto para o Vitis:
 *
 *   upv <cnn_defines.h> <pesos.h> [--mean 0.1307] [--std 0.3081] [--qmax 127]
 *       a MiniLenet do código C para o Vitis (cabeçalhos no formato do grupo DEFADAS/ITACA da Universitat
 *       Politècnica de València, licença MIT): conv1, maxpool, conv2, maxpool, flatten, fc1, fc2, com M em Q32 e
 *       pontos zero. O ponto zero da entrada de cada camada é absorvido no viés (b - z * soma dos pesos).
 *       A quantização da entrada não está nos cabeçalhos: é a de PyTorch com observador de mínimo e máximo e
 *       faixa reduzida (0 a 127) sobre o MNIST normalizado por (mean, std); o ponto zero calculado tem de bater com
 *       ZERO_IMAGE.
 *
 * Opções comuns: --out <arquivo.json> (padrão: data/nn/<id>.json), --id, --name.
 * A rede é avaliada (exata) no subconjunto de teste data/mnist1000.bin: acurácia e classes previstas no JSON.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FORMAT, decodeNet, decodeTestSet, productTable, classifyRange, summarize, roundEven } from '../../js/axc/nn.js';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const die = (m) => { console.error(m); process.exit(1); };

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');

const MNIST = {
    id: 'mnist', name: 'MNIST', file: 'data/mnist1000.bin', n: 1000, shape: [1, 28, 28],
    classes: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    note: '1000 imagens do conjunto de teste do MNIST (100 de cada dígito), licença CC BY-SA 3.0',
};
// Validação: 100 imagens de cada dígito das 5000 de treino que scripts/nn/train.py deixa de fora (semente 1). A
// MiniLenet da UPV foi treinada em outro lugar e pode ter visto essas imagens; para ela, a validação não é separada.
const MNIST_VAL = { file: 'data/nn/mnist-val1000.bin', n: 1000 };

// Cabeçalhos C da MiniLenet -------------------------------------------------------------------------------------
function parseDefines(text) {
    const raw = new Map();
    for (const m of text.matchAll(/^\s*#define\s+(\w+)\s+(.+?)\s*(\/\/.*)?$/gm)) raw.set(m[1], m[2]);
    const val = new Map();
    // Substituição textual, como o pré-processador do C (as macros sem parênteses mudam a precedência).
    const expand = (name, depth = 0) => {
        if (!raw.has(name) || depth > 50) throw new Error(`${name} desconhecido`);
        return raw.get(name).replace(/[A-Za-z_]\w*/g, (id) => expand(id, depth + 1));
    };
    const evalName = (name) => {
        if (val.has(name)) return val.get(name);
        const expr = expand(name);
        if (!/^[\d\s()+\-*/]+$/.test(expr)) throw new Error(`#define ${name}: expressão não numérica: ${expr}`);
        // Aritmética inteira do C: BigInt divide truncando.
        const v = Function(`"use strict"; return (${expr.replace(/\d+/g, '$&n')});`)();
        val.set(name, Number(v));
        return val.get(name);
    };
    for (const name of raw.keys()) { try { evalName(name); } catch { /* macros que não são números */ } }
    return val;
}

function parseArrays(text) {
    const arrs = new Map();
    for (const m of text.matchAll(/static\s+const\s+(\w+)\s+(\w+)\s*((?:\[[^\]]*\])*)\s*=\s*([^;]*);/g)) {
        const [, type, name, , body] = m;
        const nums = [...body.matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)].map((x) => +x[0]);
        arrs.set(name, { type, values: nums });
    }
    return arrs;
}

function fromUpv(definesPath, weightsPath) {
    const D = parseDefines(readFileSync(definesPath, 'utf8'));
    const A = parseArrays(readFileSync(weightsPath, 'utf8'));
    const get = (n) => A.get(n)?.values ?? die(`falta ${n} em ${weightsPath}`);
    const d = (n) => D.get(n) ?? die(`falta #define ${n} em ${definesPath}`);
    const one = (n) => get(n)[0];
    // Pontos zero dos pesos: a convenção é simétrica (todos 0).
    for (const n of ['KERNELQ_ZERO_CONV_1', 'KERNELQ_ZERO_CONV_2', 'WEIGHTSQ_ZERO_FC1', 'WEIGHTSQ_ZERO_FC2']) {
        if (A.has(n) && get(n).some((v) => v !== 0)) die(`${n} diferente de 0: pesos assimétricos não são suportados`);
    }
    const zImg = one('ZERO_IMAGE'), z1 = one('ZERO_CONV_1'), z2 = one('ZERO_CONV_2'), zf1 = one('ZERO_FC1'), zf2 = one('ZERO_FC2');
    const C = d('IMAGE_FEATURES'), K1 = d('CONV1_KERNELS'), K2 = d('CONV2_KERNELS'), k1 = d('CONV1_KERNEL_WIDTH'), k2 = d('CONV2_KERNEL_WIDTH');
    const pad = d('PADDING'), F1 = d('FC1_FEATURES'), F2 = d('FC2_FEATURES'), I1 = d('FC1_INPUT_FEATURES');
    if (d('CONV1_MAXPOOL_STEP') !== 2 || d('CONV2_MAXPOOL_STEP') !== 2) die('pooling diferente de 2 x 2');
    // Viés com o ponto zero da entrada absorvido: b - z * soma dos pesos de cada saída.
    const fold = (w, b, per, z) => Int32Array.from(b, (bv, o) => { let s = 0; for (let i = 0; i < per; i++) s += w[o * per + i]; return bv - z * s; });
    const layer = (type, name, out, wName, bName, mName, zIn, zOut, extra) => {
        const w = Int8Array.from(get(wName)), b = get(bName), m = Uint32Array.from(get(mName));
        if (b.length !== out || m.length !== out) die(`${name}: ${b.length} viéses e ${m.length} M para ${out} saídas`);
        const per = w.length / out;
        return { type, name, out, ...extra, w: b64(w), b: b64(fold(w, b, per, zIn)), requant: { mode: 'q32', m: b64(m), zero: zOut } };
    };
    // Quantização da entrada (PyTorch, observador de mínimo e máximo, faixa reduzida a 0..qmax).
    const mean = +opt('--mean', 0.1307), std = +opt('--std', 0.3081), qmax = +opt('--qmax', 127);
    const lo = Math.min(0, (0 - mean) / std), hi = Math.max(0, (1 - mean) / std);
    const scale = (hi - lo) / qmax, zero = 0 - roundEven(lo / scale);
    if (zero !== zImg) die(`ponto zero da entrada calculado (${zero}) diferente de ZERO_IMAGE (${zImg}): ajuste --mean, --std ou --qmax`);
    return {
        format: FORMAT, id: 'minilenet-mnist', name: 'MiniLenet',
        description: 'MiniLenet quantizada (conv 3@5x5, conv 6@5x5, fc 147, fc 10), pesos do código C para o Vitis; reescala em Q32 com pontos zero',
        source: {
            weights: 'MiniLenetq_weights_and_bias_all_layers.h, cnn_defines.h',
            copyright: 'Copyright (c) 2021-2023 Universitat Politècnica de València, David de Andrés and Juan Carlos Ruiz (Fault-Tolerant Systems, Instituto ITACA)',
            license: 'MIT',
            training: 'https://git.upv.es/defadas/MiniLenetPython',
        },
        dataset: { ...MNIST, shape: [C, d('IMAGE_HEIGHT'), d('IMAGE_WIDTH')], val: { ...MNIST_VAL, note: 'imagens de treino do MNIST que a MiniLenet da UPV pode ter usado no treino' } },
        input: { mean, std, scale, zero, qmin: 0, qmax, note: 'escala deduzida (mínimo e máximo do MNIST normalizado, faixa 0 a qmax); o ponto zero confere com ZERO_IMAGE' },
        layers: [
            layer('conv', 'conv1', K1, 'KERNELQ_CONV_1', 'BIAS_CONV1', 'M_CONV1', zImg, z1, { k: k1, pad, stride: 1 }),
            { type: 'maxpool', size: 2 },
            layer('conv', 'conv2', K2, 'KERNELQ_CONV_2', 'BIAS_CONV2', 'M_CONV2', z1, z2, { k: k2, pad, stride: 1 }),
            { type: 'maxpool', size: 2 },
            { type: 'flatten' },
            layer('dense', 'fc1', F1, 'WEIGHTSQ_FC1', 'BIAS_FC1', 'M_FC1', z2, zf1),
            layer('dense', 'fc2', F2, 'WEIGHTSQ_FC2', 'BIAS_FC2', 'M_FC2', zf1, zf2),
        ],
        accuracy: {},
        expectedInputs: I1,
    };
}

// --------------------------------------------------------------------------------------------------------------
const kind = pos[0];
let json;
if (kind === 'upv') json = fromUpv(pos[1] ?? die('falta cnn_defines.h'), pos[2] ?? die('falta o .h dos pesos'));
else die('uso: import.mjs upv <cnn_defines.h> <pesos.h> [--out arquivo]  (as redes treinadas aqui saem de scripts/nn/train.py)');
if (opt('--id')) json.id = opt('--id');
if (opt('--name')) json.name = opt('--name');
const inputs = json.expectedInputs;
delete json.expectedInputs;

const net = decodeNet(json);
if (inputs && net.sites.find((l) => l.name === 'fc1').inShape[0] !== inputs) die(`fc1 recebe ${net.sites[2].inShape[0]} entradas, FC1_INPUT_FEATURES = ${inputs}`);
const test = decodeTestSet(readFileSync(json.dataset.file), json.dataset);
const T = productTable(null);
const preds = classifyRange(net, test, net.sites.map(() => T), [], 0, test.n, new Uint8Array(test.n));
json.accuracy.int8Subset = summarize(test, preds, null, net.classes).accuracy;
json.expected = b64(preds);
const out = opt('--out', `data/nn/${json.id}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(json, null, 1)}\n`);
console.log(`${json.name}: ${net.sites.map((l) => `${l.name} ${l.outShape.join('x')}`).join(', ')}; acurácia no subconjunto ${(100 * json.accuracy.int8Subset).toFixed(1)}%; gravado em ${out}`);
