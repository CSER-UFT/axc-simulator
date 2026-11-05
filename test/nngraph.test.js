// Redes com ramos no formato axc-nn/1 (etapas 15 e 16 do plano; docs/RESNET8.md): borda assimétrica, soma residual
// com reescala, média e o avaliador da busca nos cortes. As contas são conferidas contra uma referência escrita aqui,
// com laços diretos e BigInt na reescala, numa ResNet pequena com pesos sorteados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeNet, decodeTestSet, productTable, classifyRange, adderAccumulate, inferFrom, inputActivations, mulQ32Sum, withBiases, infer } from '../js/axc/nn.js';
import { buildUnit } from '../js/axc/units.js';
import { Evaluator, makeBiasFix } from '../js/axc/nnsearch.js';
import { rng } from '../js/axc/metrics.js';

const R = new URL('../', import.meta.url);
const synth = JSON.parse(readFileSync(new URL('data/synth.json', R), 'utf8'));
const unitOf = (name) => buildUnit(synth.designs.find((d) => d.name === name).cfg);
const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');

/**
 * ResNet pequena com a forma da ResNet 8 (docs/RESNET8.md): conv1, pilha 1 com atalho identidade, pilha 2 com passo 2
 * (borda 0, 1, 0, 1) e atalho 1 x 1, média de 4 x 4 e densa. Pesos, vieses, reescalas e pontos zero sorteados.
 */
function tinyResnet(seed = 7, { mScale = 1, exp = 0 } = {}) {
    const r = rng(seed), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const C0 = 3, H = 8, F1 = 4, F2 = 6;
    const W = (n) => b64(Int8Array.from({ length: n }, () => ri(-40, 40)));
    const B = (n) => b64(Int32Array.from({ length: n }, () => ri(-3000, 3000)));
    const M = (n) => b64(Uint32Array.from({ length: n }, () => Math.round(ri(2 ** 22, 2 ** 24) * mScale)));
    const conv = (name, cin, out, k, stride, pad, extra = {}) => ({ type: 'conv', name, out, k, stride, pad, w: W(out * cin * k * k), b: B(out), ...extra });
    const rq = (out) => ({ mode: 'q32', m: M(out), zero: ri(0, 6) });
    const layers = [
        conv('conv1', C0, F1, 3, 1, 1, { requant: rq(F1) }),
        conv('s1a', F1, F1, 3, 1, 1, { requant: rq(F1) }),
        conv('s1b', F1, F1, 3, 1, [1, 1, 1, 1], { output: 'acc' }),
        { type: 'add', name: 's1add', inputs: ['conv1', 's1b'], requant: { mode: 'q32', m: [M(F1), M(F1)], zero: ri(0, 6), exp } },
        conv('s2a', F1, F2, 3, 2, [0, 1, 0, 1], { requant: rq(F2) }),
        conv('s2b', F2, F2, 3, 1, 1, { output: 'acc' }),
        conv('s2sc', F1, F2, 1, 2, 0, { input: 's1add', output: 'acc' }),
        { type: 'add', name: 's2add', inputs: ['s2sc', 's2b'], requant: { mode: 'q32', m: [M(F2), M(F2)], zero: ri(0, 6), exp } },
        { type: 'avgpool', name: 'pool', size: 4 },
        { type: 'flatten', name: 'flat' },
        { type: 'dense', name: 'fc', out: 5, w: W(5 * F2), b: B(5) },
    ];
    return { format: 'axc-nn/1', id: 'tiny', name: 'tiny', dataset: { shape: [C0, H, H], n: 0 }, layers };
}

function randomSet(n, shape, classes, seed = 3) {
    const r = rng(seed), size = shape.reduce((a, b) => a * b, 1);
    return { n, size, shape, labels: Uint8Array.from({ length: n }, () => Math.floor(r() * classes)), images: Uint8Array.from({ length: n * size }, () => Math.floor(r() * 256)) };
}

// Referência ------------------------------------------------------------------------------------------------------
const req = (acc, m, z) => { const v = Number((BigInt(acc) * BigInt(m) + 2n ** 31n) >> 32n) + z; return Math.min(255, Math.max(0, v)); };
/** Inferência de referência: cada camada lida pelo nome, laços na ordem do C (ky, kx, canal), BigInt na reescala. */
function reference(json, net, img, T = null, add = null) {
    const t = (w, a) => (T ? T[(w + 128) * 256 + a] : w * a);
    const plus = (x, y) => (add ? add(Int32Array.of(x), Int32Array.of(y), 1)[0] : x + y);
    const vals = new Map([['input', { data: Array.from(img), shape: json.dataset.shape, z: 0 }]]);
    let prev = 'input', out = null;
    for (const L of json.layers) {
        const l = net.layers.find((q) => q.name === L.name);
        const srcName = L.type === 'add' ? null : (L.input ?? prev);
        const X = srcName ? vals.get(srcName) : null;
        let res;
        if (L.type === 'conv') {
            const [C, H, Wd] = X.shape, k = L.k, s = L.stride, [pt, pb, pl, pr] = Array.isArray(L.pad) ? L.pad : [L.pad, L.pad, L.pad, L.pad];
            const OH = Math.floor((H + pt + pb - k) / s) + 1, OW = Math.floor((Wd + pl + pr - k) / s) + 1;
            const data = [];
            for (let f = 0; f < L.out; f++) for (let oy = 0; oy < OH; oy++) for (let ox = 0; ox < OW; ox++) {
                let acc = 0;
                for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) for (let c = 0; c < C; c++) {
                    const iy = oy * s + ky - pt, ix = ox * s + kx - pl;
                    const a = iy < 0 || iy >= H || ix < 0 || ix >= Wd ? X.z : X.data[(c * H + iy) * Wd + ix];
                    acc = plus(acc, t(l.w[((f * C + c) * k + ky) * k + kx], a));
                }
                acc = plus(acc, l.b[f]);
                data.push(L.output === 'acc' ? acc : req(acc, l.rq.m[f], l.zOut));
            }
            res = { data, shape: [L.out, OH, OW], z: L.output === 'acc' ? null : l.zOut, acc: L.output === 'acc' };
        } else if (L.type === 'add') {
            const ins = L.inputs.map((n) => vals.get(n)), [C, H, Wd] = ins[0].shape, per = H * Wd;
            const data = ins[0].data.map((_, i) => {
                const ch = Math.floor(i / per);
                let sum = 0n;
                ins.forEach((v, j) => { sum += BigInt(v.acc ? v.data[i] : v.data[i] - v.z) * BigInt(l.mIn[j][ch]); });
                const e = BigInt(l.exp);
                const q = (sum + 2n ** (31n + e)) / 2n ** (32n + e) - ((sum + 2n ** (31n + e)) % 2n ** (32n + e) < 0n ? 1n : 0n);
                return Math.min(255, Math.max(0, Number(q) + l.zOut));
            });
            res = { data, shape: ins[0].shape, z: l.zOut };
        } else if (L.type === 'avgpool') {
            const [C, H, Wd] = X.shape, s = L.size, data = [];
            for (let c = 0; c < C; c++) for (let py = 0; py < H / s; py++) for (let px = 0; px < Wd / s; px++) {
                let sum = 0;
                for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) sum += X.data[(c * H + py * s + dy) * Wd + px * s + dx];
                data.push(Math.floor((sum + Math.floor((s * s) / 2)) / (s * s)));
            }
            res = { data, shape: [C, H / s, Wd / s], z: X.z };
        } else if (L.type === 'flatten') res = { data: X.data, shape: [X.data.length], z: X.z };
        else if (L.type === 'dense') {
            const I = X.data.length, data = [];
            for (let o = 0; o < L.out; o++) { let acc = 0; for (let i = 0; i < I; i++) acc = plus(acc, t(l.w[o * I + i], X.data[i])); data.push(plus(acc, l.b[o])); }
            res = { data, shape: [L.out], z: null };
            out = data;
        }
        vals.set(L.name, res);
        prev = L.name;
    }
    let pred = 0;
    for (let k = 1; k < out.length; k++) if (out[k] > out[pred]) pred = k;
    return { pred, out };
}

// Testes ----------------------------------------------------------------------------------------------------------
test('mulQ32Sum: igual à conta em BigInt, com e sem expoente', () => {
    const r = rng(11);
    for (let t = 0; t < 4000; t++) {
        const J = 1 + Math.floor(r() * 3), e = [0, 0, -4, 3, -16, 20][t % 6];
        const v = Array.from({ length: J }, () => Math.floor((r() * 2 - 1) * 2 ** 31));
        const m = Array.from({ length: J }, () => Math.floor(r() * 2 ** 32));
        let s = 2n ** BigInt(31 + e);
        v.forEach((x, j) => { s += BigInt(x) * BigInt(m[j]); });
        const d = 2n ** BigInt(32 + e), want = s >= 0n ? s / d : -((-s + d - 1n) / d);
        assert.equal(mulQ32Sum(v, m, e), Number(want), `${v} ${m} ${e}`);
    }
});

test('rede com ramos: decodificação, formas, borda assimétrica e cortes', () => {
    const json = tinyResnet(), net = decodeNet(json);
    const by = (n) => net.layers.find((l) => l.name === n);
    assert.deepEqual(by('s2a').pads, [0, 1, 0, 1]);
    assert.deepEqual(by('s2a').outShape, [6, 4, 4]);
    assert.deepEqual(by('s2sc').outShape, [6, 4, 4]);
    assert.deepEqual(by('s2sc').src, [3]);
    assert.ok(by('s1b').accOut && by('s1b').addLayer === 3 && by('s1b').addInput === 1);
    assert.equal(net.sites.length, 7);
    assert.ok(net.graph);
    // Cortes: antes da conv1 (a entrada), da s1a (saída da conv1), da s2a (saída da s1add) e depois da s2add.
    const cutNames = net.layers.map((l, li) => (net.cuts[li] === undefined ? null : l.name)).filter(Boolean);
    assert.deepEqual(cutNames, ['conv1', 's1a', 's2a', 'pool', 'flat', 'fc']);
    assert.throws(() => decodeNet({ ...json, layers: json.layers.map((L) => (L.name === 's2sc' ? { ...L, input: 'nada' } : L)) }), /entrada desconhecida/);
    assert.throws(() => decodeNet({ ...json, layers: json.layers.filter((L) => L.name !== 's1add') }), /acc|acumulador|add/);
});

test('rede com ramos: inferência igual à referência, exata e com unidades aproximadas', () => {
    for (const seed of [7, 8]) {
        for (const opt of [{}, { mScale: 40, exp: -6 }]) {
            const json = tinyResnet(seed, opt), net = decodeNet(json), set = randomSet(24, json.dataset.shape, 5, seed);
            for (const [mul, add] of [[null, null], ['MUL8 DRUM4', 'ADD32 LOA10']]) {
                const T = productTable(mul ? unitOf(mul) : null), A = add ? adderAccumulate(unitOf(add)) : null;
                const preds = classifyRange(net, set, net.sites.map(() => T), net.sites.map(() => A), 0, set.n, new Uint8Array(set.n));
                for (let k = 0; k < set.n; k++) {
                    const img = set.images.subarray(k * set.size, (k + 1) * set.size);
                    const want = reference(json, net, img, mul ? T : null, A);
                    const got = infer(net, img, net.sites.map(() => T), net.sites.map(() => A));
                    assert.deepEqual(Array.from(got.out), want.out, `semente ${seed} ${mul} imagem ${k}`);
                    assert.equal(preds[k], want.pred);
                }
            }
        }
    }
});

test('rede com ramos: começar de um corte dá o mesmo; fora dos cortes, erro', () => {
    const json = tinyResnet(), net = decodeNet(json), set = randomSet(6, json.dataset.shape, 5);
    const T = productTable(null), tabs = net.sites.map(() => T);
    for (let k = 0; k < set.n; k++) {
        const x0 = inputActivations(net, set.images.subarray(k * set.size, (k + 1) * set.size));
        const rec = new Map();
        const full = inferFrom(net, x0, 0, tabs, [], undefined, [], (li, x) => rec.set(li, Uint8Array.from(x)));
        net.cuts.forEach((c, li) => {
            if (c === undefined || li === 0) return;
            const r = inferFrom(net, rec.get(li), li, tabs.slice(), []);
            assert.deepEqual(Array.from(r.out), Array.from(full.out), net.layers[li].name);
        });
    }
    const s1b = net.layers.findIndex((l) => l.name === 's1b');
    assert.throws(() => inferFrom(net, new Uint8Array(256), s1b, tabs, []), /mais de um tensor vivo/);
});

test('rede em sequência escrita como grafo (nomes, input explícito, borda em lista) dá as mesmas classes', () => {
    const json = JSON.parse(readFileSync(new URL('data/nn/minilenet-mnist.json', R), 'utf8'));
    const net = decodeNet(json), ds = json.dataset, set = decodeTestSet(readFileSync(new URL(ds.file, R)), ds);
    const named = { ...json, layers: json.layers.map((L, i) => ({ ...L, name: L.name ?? `l${i}`, ...(i ? { input: json.layers[i - 1].name ?? `l${i - 1}` } : {}), ...(L.type === 'conv' ? { pad: [L.pad ?? 0, L.pad ?? 0, L.pad ?? 0, L.pad ?? 0] } : {}) })) };
    const g = decodeNet(named);
    assert.ok(!net.graph && !g.graph);
    assert.ok(g.cuts.every((c, li) => c === li - 1));
    const T = productTable(unitOf('MUL8 DRUM4')), A = adderAccumulate(unitOf('ADD32 LOA10'));
    const n = 300;
    const p1 = classifyRange(net, set, net.sites.map(() => T), net.sites.map(() => A), 0, n, new Uint8Array(n));
    const p2 = classifyRange(g, set, g.sites.map(() => T), g.sites.map(() => A), 0, n, new Uint8Array(n));
    assert.deepEqual([...p2], [...p1]);
    assert.deepEqual([...classifyRange(g, set, g.sites.map(() => productTable(null)), [], 0, set.n, new Uint8Array(set.n))], [...net.expected]);
});

test('avaliador da busca na rede com ramos: recomeçar dos cortes dá o mesmo que classificar do zero', () => {
    const json = tinyResnet(9), net = decodeNet(json), set = randomSet(40, json.dataset.shape, 5, 9);
    const fresh = (assign) => classifyRange(net, set, assign.map((a) => productTable(a.mul ? unitOf(a.mul) : null)), assign.map((a) => (a.add ? adderAccumulate(unitOf(a.add)) : null)), 0, set.n, new Uint8Array(set.n));
    const ev = new Evaluator(net, set, [], unitOf);
    // Os cortes de cada camada com pesos: conv1 da entrada, s1a e s1b da saída da conv1, s2a, s2b e s2sc da s1add, fc da média.
    assert.deepEqual(ev.cutOf.map((li) => net.layers[li].name), ['conv1', 's1a', 's1a', 's2a', 's2a', 's2a', 'fc']);
    const exact = net.sites.map(() => ({ mul: null, add: null }));
    ev.run(exact, { record: true });
    assert.deepEqual([...ev.basePreds], [...fresh(exact)]);
    assert.ok(ev.inputHist.every((h) => h.reduce((a, b) => a + b, 0) > 0));
    const U = { mul: 'MUL8 DRUM4', add: 'ADD32 LOA10' };
    for (let si = 0; si < net.sites.length; si++) {
        const assign = exact.map((a, j) => (j === si ? U : a));
        assert.deepEqual([...ev.run(assign).preds], [...fresh(assign)], net.sites[si].name);
    }
    // Nova base no meio da rede e trocas depois dela.
    const base = exact.map((a, j) => (j === 2 ? U : a));
    ev.run(base, { record: true });
    for (const si of [3, 4, 5, 6]) {
        const assign = base.map((a, j) => (j === si ? { mul: 'MUL8 DRUM4', add: null } : a));
        assert.deepEqual([...ev.run(assign).preds], [...fresh(assign)], `base s1b, troca ${net.sites[si].name}`);
    }
});

test('correção de ganho numa convolução "acc": muda o m do ramo na add, como withBiases', () => {
    const json = tinyResnet(5), net = decodeNet(json), set = randomSet(64, json.dataset.shape, 5, 5);
    const U = { table: (n) => productTable(n ? unitOf(n) : null), adder: (n) => (n ? adderAccumulate(unitOf(n)) : null) };
    const fix = makeBiasFix(net, set, [], U, 'affine', { pool: 32 });
    const si = net.sites.findIndex((l) => l.name === 's2b');
    const st = fix.stats(si, 'MUL8 DRUM4', null);
    assert.equal(st.m?.length, 6);
    const assign = net.sites.map((_, j) => (j === si ? { mul: 'MUL8 DRUM4', add: null } : { mul: null, add: null }));
    const tables = assign.map((a) => U.table(a.mul)), biases = assign.map((a, j) => fix.biasOf(j, a.mul, a.add)), scales = assign.map((a, j) => fix.scaleOf(j, a.mul, a.add));
    const viaParams = classifyRange(net, set, tables, [], 0, set.n, new Uint8Array(set.n), [], biases, scales);
    const fixed = withBiases(net, fix.deltas(assign), fix.scales(assign));
    const viaNet = classifyRange(fixed, set, tables, [], 0, set.n, new Uint8Array(set.n));
    assert.deepEqual([...viaNet], [...viaParams]);
    // O m do ramo mudou mesmo: sem a reescala corrigida, as saídas são outras em alguma imagem.
    const outs = (nt, sc) => Array.from({ length: set.n }, (_, k) => Array.from(infer(nt, set.images.subarray(k * set.size, (k + 1) * set.size), tables, [], undefined, [], biases, sc).out).join());
    assert.notDeepEqual(outs(net, scales), outs(net, null));
});

test('código gerado da rede com ramos: os kernels, executados pelos tensores, dão as saídas do avaliador', async () => {
    const { networkKernels, directiveTrees } = await import('../js/axc/nngen.js');
    const { parse } = await import('../js/hls/lang.js');
    const { elaborate } = await import('../js/hls/elab.js');
    const { execute, inputArrays, outputArrays } = await import('../js/hls/exec.js');
    const { resnet8Json } = await import('./fixtures/resnet8.js');
    const acc = adderAccumulate(unitOf('ADD32 LOA10'));
    const a1 = new Int32Array(1), b1 = new Int32Array(1);
    const fadd = (x, y) => { a1[0] = x; b1[0] = y; acc(a1, b1, 1); return a1[0]; };
    const cases = [[tinyResnet(7), null, false], [tinyResnet(8, { mScale: 40, exp: -6 }), null, true], [resnet8Json(2, 4), null, true]];
    for (const [json, dirs, approx] of cases) {
        const net = decodeNet(json), set = randomSet(2, json.dataset.shape, 5, 4);
        const ks = networkKernels(net, dirs);
        const kinds = ks.map((k) => k.type);
        assert.ok(kinds.includes('add') && kinds.includes('pad'), kinds.join());
        const trees = directiveTrees(net, dirs);
        for (let i = 0; i < set.n; i++) {
            const img = set.images.subarray(i * set.size, (i + 1) * set.size);
            const want = [...infer(net, img, net.sites.map(() => productTable(null)), approx ? net.sites.map(() => acc) : [], undefined, trees).out];
            const mem = new Map([[0, Float64Array.from(inputActivations(net, img))]]);
            for (const k of ks) {
                const d = elaborate(parse(k.src), { ports: 2 });
                const ops = new Map();
                if (approx && k.site !== null) for (const sg of d.segments) for (const n of sg.nodes) if (n.op === 'add') ops.set(n.id, fadd);
                const ins = inputArrays(d), [outA] = outputArrays(d);
                assert.equal(ins.length, k.ins.length, k.name);
                const res = execute(d, new Map(ins.map((A, j) => [A.name ?? A, mem.get(k.ins[j])])), { ops });
                mem.set(k.out, Float64Array.from(res.mem.get(outA.name ?? outA)));
            }
            assert.deepEqual([...mem.get(ks.at(-1).out)], want, `${json.id} imagem ${i}`);
        }
    }
});

test('diagrama da ResNet 8: caminho principal, três somas, dois atalhos 1 x 1 com caixa e a identidade sem caixa', async () => {
    const { archSvg } = await import('../js/axc/nnsvg.js');
    const { resnet8Json } = await import('./fixtures/resnet8.js');
    const svg = archSvg(decodeNet(resnet8Json()), { labels: { add: 'soma' } });
    const count = (re) => (svg.match(re) ?? []).length;
    assert.equal(count(/class="nn-add"/g), 3);
    assert.equal(count(/class="nn-skip"/g), 3);
    assert.equal(count(/class="nn-skip-box"/g), 2);
    assert.ok(svg.includes('s2sc: conv 1×1, s2') && svg.includes('s3sc: conv 1×1, s2'));
    assert.ok(svg.includes('p0,1,0,1, s2') && svg.includes('avg pool 8×8'));
    assert.ok(svg.includes('nn-wide'));
    // Os atalhos não aparecem na linha principal; a s2a sim.
    assert.ok(!svg.includes('>s2sc<') && svg.includes('>s2a<'));
});

test('custo da rede com ramos: kernels da borda, da soma e da média; reescalas compartilhadas; unidades aproximadas economizam área', async () => {
    const { costModel } = await import('../js/axc/nngen.js');
    const D = (f) => JSON.parse(readFileSync(new URL(`data/${f}`, R), 'utf8'));
    const net = decodeNet(tinyResnet(7));
    const cm = costModel(net, { synth, cells: D('hls-cells.json'), fpga: D('vivado-units.json'), target: 'asic', clockNs: 10 });
    const ex = cm.network();
    const by = (n) => ex.layers.find((l) => l.name === n);
    assert.deepEqual(ex.layers.map((l) => l.type), ['pad', 'conv', 'pad', 'conv', 'pad', 'conv', 'add', 'pad', 'conv', 'pad', 'conv', 'conv', 'add', 'avgpool', 'flatten', 'dense']);
    // Dois produtos por soma (requant2); a convolução "acc" não tem reescala. Na pilha 1, o atalho é uma ativação de 8
    // bits (o produto estreita e usa menos DSP); na 2, os dois ramos são acumuladores de 32 bits.
    assert.ok(by('s1add').rq2.dsp >= 2 && by('s2add').rq2.dsp >= by('s1add').rq2.dsp);
    assert.ok(by('s1b').rq.dsp === 0 && by('s1b').rq2.dsp === 0 && by('conv1').rq.dsp > 0);
    // A rede compartilha uma reescala de cada tipo: DSP = o da maior de cada.
    assert.equal(ex.totals.dsp, Math.max(...ex.layers.map((l) => l.rq.dsp)) + Math.max(...ex.layers.map((l) => l.rq2.dsp)));
    const ap = cm.network(net.sites.map(() => ({ mul: 'MUL8 DRUM4', add: 'ADD32 LOA10' })));
    assert.ok(ap.totals.area < ex.totals.area, `${ap.totals.area} ${ex.totals.area}`);
    assert.equal(ap.totals.cycles > 0, true);
});

test('exportação para o Vitis: erro claro nas redes com ramos (etapa 23)', async () => {
    const { networkProject } = await import('../js/axc/nnexport.js');
    assert.throws(() => networkProject(decodeNet(tinyResnet()), {}), /ainda não aceita redes com ramos/);
});

// Etapa 18: a inferência inteira do Python (scripts/nn/train.py, int_forward_graph) e a do avaliador dão as mesmas
// saídas, bit a bit. Com a ResNet 8 de pesos sorteados (sempre) e com a treinada, quando data/nn/resnet8-cifar10.json
// existir (as 1000 imagens do subconjunto de teste, contra expected e expectedOut gravados pelo treino).
test('ResNet 8: inferência inteira do Python igual à do avaliador (pesos sorteados)', async (t) => {
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { resnet8Json } = await import('./fixtures/resnet8.js');
    const probe = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' });
    if (probe.status !== 0) { t.skip('sem python3 com numpy'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'axc-r8-'));
    try {
        for (const [seed, f] of [[1, 16], [4, 8]]) {
            const json = resnet8Json(seed, f), net = decodeNet(json), n = 12;
            const set = randomSet(n, json.dataset.shape, 10, seed);
            writeFileSync(join(dir, 'net.json'), JSON.stringify(json));
            writeFileSync(join(dir, 'set.bin'), Buffer.concat([Buffer.from(set.labels), Buffer.from(set.images)]));
            const p = spawnSync('python3', [fileURLToPath(new URL('scripts/nn/intcheck.py', R)), join(dir, 'net.json'), join(dir, 'set.bin'), '--n', String(n)], { encoding: 'utf8', maxBuffer: 1 << 26 });
            assert.equal(p.status, 0, p.stderr);
            const py = JSON.parse(p.stdout);
            const T = net.sites.map(() => productTable(null));
            for (let k = 0; k < n; k++) {
                const r = infer(net, set.images.subarray(k * set.size, (k + 1) * set.size), T, []);
                assert.deepEqual(Array.from(r.out), py.outs[k], `semente ${seed}, ${f} filtros, imagem ${k}`);
                assert.equal(r.pred, py.preds[k]);
            }
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ResNet 8 treinada: classes e saídas do avaliador iguais às do treino (se data/nn/resnet8-cifar10.json existir)', (t) => {
    const url = new URL('data/nn/resnet8-cifar10.json', R);
    if (!existsSync(url)) { t.skip('ResNet 8 ainda não treinada (etapa 17)'); return; }
    const json = JSON.parse(readFileSync(url, 'utf8')), net = decodeNet(json), ds = json.dataset;
    const set = decodeTestSet(readFileSync(new URL(ds.file, R)), ds);
    const T = net.sites.map(() => productTable(null));
    const outs = Buffer.from(json.expectedOut, 'base64');
    assert.equal(outs.length, set.n * net.classes);
    for (let k = 0; k < set.n; k++) {
        const r = infer(net, set.images.subarray(k * set.size, (k + 1) * set.size), T, []);
        assert.deepEqual(Array.from(r.out), Array.from(outs.subarray(k * net.classes, (k + 1) * net.classes)), `imagem ${k}`);
        assert.equal(r.pred, net.expected[k], `imagem ${k}`);
    }
});
