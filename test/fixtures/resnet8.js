/**
 * ResNet 8 do MLPerf Tiny (docs/RESNET8.md) no formato axc-nn/1 com pesos, vieses e reescalas sorteados: a forma da
 * rede para os testes do diagrama, do gerador de código e do custo enquanto os pesos treinados não existem (etapa 17).
 * Os pesos não classificam nada; as reescalas mantêm as ativações dentro da faixa de 8 bits.
 */
import { rng } from '../../js/axc/metrics.js';

const b64 = (a) => {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(u).toString('base64');
};

export function resnet8Json(seed = 1, filters = 16) {
    const r = rng(seed);
    const W = (n) => b64(Int8Array.from({ length: n }, () => Math.round((r() * 2 - 1) * 60)));
    const B = (n) => b64(Int32Array.from({ length: n }, () => Math.round((r() * 2 - 1) * 2000)));
    const M = (n, s = 2 ** 23) => b64(Uint32Array.from({ length: n }, () => Math.round(s * (0.5 + r()))));
    const conv = (name, cin, out, k, stride, pad, extra) => ({ type: 'conv', name, out, k, stride, pad, w: W(out * cin * k * k), b: B(out), ...extra });
    const rq = (n) => ({ mode: 'q32', m: M(n), zero: 0 });
    const f = filters;
    const layers = [
        conv('conv1', 3, f, 3, 1, 1, { requant: rq(f) }),
        conv('s1a', f, f, 3, 1, 1, { requant: rq(f) }),
        conv('s1b', f, f, 3, 1, 1, { output: 'acc' }),
        { type: 'add', name: 's1add', inputs: ['conv1', 's1b'], requant: { mode: 'q32', m: [M(f, 2 ** 31), M(f)], zero: 0 } },
    ];
    let prev = 's1add', cin = f;
    for (const [i, c] of [[2, 2 * f], [3, 4 * f]]) {
        layers.push(
            conv(`s${i}a`, cin, c, 3, 2, [0, 1, 0, 1], { input: prev, requant: rq(c) }),
            conv(`s${i}b`, c, c, 3, 1, 1, { output: 'acc' }),
            conv(`s${i}sc`, cin, c, 1, 2, 0, { input: prev, output: 'acc' }),
            { type: 'add', name: `s${i}add`, inputs: [`s${i}sc`, `s${i}b`], requant: { mode: 'q32', m: [M(c), M(c)], zero: 0 } },
        );
        prev = `s${i}add`;
        cin = c;
    }
    layers.push({ type: 'avgpool', name: 'pool', size: 8 }, { type: 'flatten', name: 'flatten' }, { type: 'dense', name: 'fc', out: 10, w: W(10 * 4 * f), b: B(10) });
    return {
        format: 'axc-nn/1', id: 'resnet8-random', name: 'ResNet 8 (pesos sorteados)',
        dataset: { name: 'CIFAR 10', shape: [3, 32, 32], n: 0, classes: ['airplane', 'automobile', 'bird', 'cat', 'deer', 'dog', 'frog', 'horse', 'ship', 'truck'] },
        layers,
    };
}
