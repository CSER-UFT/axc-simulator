#!/usr/bin/env python3
"""
LeNet-5 para o MNIST, treinada só com NumPy e quantizada em 8 bits para a aba Rede neural do simulador.

    python3 scripts/lenet5/train.py <pasta com os 4 arquivos .gz do MNIST> [--epochs 4] [--seed 1]

Arquitetura (LeCun e colegas, 1998, com ReLU e max pooling, como nas versões modernas):
    entrada 28 x 28 com borda de 2 pixels (32 x 32)
    conv1 6 filtros 5 x 5  -> ReLU -> max pool 2 x 2   (6 x 14 x 14)
    conv2 16 filtros 5 x 5 -> ReLU -> max pool 2 x 2   (16 x 5 x 5)
    fc1 400 -> 120 -> ReLU
    fc2 120 -> 84  -> ReLU
    fc3 84  -> 10

Quantização depois do treino (a mesma conta que js/axc/lenet.js faz no navegador):
    pesos inteiros com sinal em 8 bits (-127 a 127), uma escala por camada;
    ativações inteiras sem sinal em 8 bits (0 a 255), uma escala por camada, calibrada em imagens de treino;
    acumulação inteira exata; saída de cada camada = min(255, max(0, floor(acc * M + 0.5))), com M em float64.
O max pooling é feito sobre os inteiros (não tem conta). A última camada devolve os acumuladores, e a classe é o
maior (o primeiro, em caso de empate).

Gera:
    data/lenet5.json   pesos e escalas (base64), acurácias e as classes previstas pela rede quantizada exata
    data/mnist1000.bin  1000 imagens de teste (100 de cada dígito): 1000 rótulos e depois 1000 x 784 pixels
"""
import argparse
import base64
import gzip
import json
import os
import time

import numpy as np


def load_idx(path):
    with gzip.open(path, 'rb') as f:
        data = f.read()
    magic = int.from_bytes(data[0:4], 'big')
    ndim = magic & 0xFF
    dims = [int.from_bytes(data[4 + 4 * i:8 + 4 * i], 'big') for i in range(ndim)]
    return np.frombuffer(data, dtype=np.uint8, offset=4 + 4 * ndim).reshape(dims)


# Camadas (float, para o treino) -------------------------------------------------------------------------------

def im2col(x, k):
    """(B, C, H, W) -> (B, OH, OW, C*k*k)."""
    win = np.lib.stride_tricks.sliding_window_view(x, (k, k), axis=(2, 3))   # B, C, OH, OW, k, k
    B, C, OH, OW = win.shape[:4]
    return win.transpose(0, 2, 3, 1, 4, 5).reshape(B, OH, OW, C * k * k)


def conv_forward(x, W, b):
    k = W.shape[2]
    cols = im2col(x, k)
    out = cols @ W.reshape(W.shape[0], -1).T + b                              # B, OH, OW, F
    return out.transpose(0, 3, 1, 2), cols


def conv_backward(dout, x, cols, W):
    F, C, k, _ = W.shape
    d = dout.transpose(0, 2, 3, 1)                                             # B, OH, OW, F
    dW = (d.reshape(-1, F).T @ cols.reshape(-1, C * k * k)).reshape(W.shape)
    db = d.sum(axis=(0, 1, 2))
    dcols = (d @ W.reshape(F, -1)).reshape(d.shape[0], d.shape[1], d.shape[2], C, k, k)
    dx = np.zeros_like(x)
    OH, OW = d.shape[1], d.shape[2]
    for i in range(k):
        for j in range(k):
            dx[:, :, i:i + OH, j:j + OW] += dcols[:, :, :, :, i, j].transpose(0, 3, 1, 2)
    return dx, dW, db


def pool_forward(x):
    B, C, H, W = x.shape
    r = x.reshape(B, C, H // 2, 2, W // 2, 2)
    out = r.max(axis=(3, 5))
    mask = r == out[:, :, :, None, :, None]
    return out, mask


def pool_backward(dout, mask):
    d = mask * dout[:, :, :, None, :, None]
    # Empates: o gradiente vai para todos os máximos (raro com valores contínuos).
    B, C, h, _, w, _ = d.shape
    return d.reshape(B, C, h * 2, w * 2)


class LeNet5:
    def __init__(self, rng):
        he = lambda shape, fan_in: (rng.standard_normal(shape) * np.sqrt(2.0 / fan_in)).astype(np.float64)
        self.p = {
            'c1w': he((6, 1, 5, 5), 25), 'c1b': np.zeros(6),
            'c2w': he((16, 6, 5, 5), 150), 'c2b': np.zeros(16),
            'f1w': he((120, 400), 400), 'f1b': np.zeros(120),
            'f2w': he((84, 120), 120), 'f2b': np.zeros(84),
            'f3w': he((10, 84), 84), 'f3b': np.zeros(10),
        }

    def forward(self, x):
        p, c = self.p, {}
        c['x0'] = x
        z1, c['cols1'] = conv_forward(x, p['c1w'], p['c1b'])
        a1 = np.maximum(z1, 0); c['m1'] = z1 > 0
        p1, c['pm1'] = pool_forward(a1)
        c['x1'] = p1
        z2, c['cols2'] = conv_forward(p1, p['c2w'], p['c2b'])
        a2 = np.maximum(z2, 0); c['m2'] = z2 > 0
        p2, c['pm2'] = pool_forward(a2)
        f0 = p2.reshape(p2.shape[0], -1); c['f0'] = f0
        z3 = f0 @ p['f1w'].T + p['f1b']; a3 = np.maximum(z3, 0); c['m3'] = z3 > 0; c['a3'] = a3
        z4 = a3 @ p['f2w'].T + p['f2b']; a4 = np.maximum(z4, 0); c['m4'] = z4 > 0; c['a4'] = a4
        z5 = a4 @ p['f3w'].T + p['f3b']
        return z5, c

    def backward(self, dz5, c):
        p, g = self.p, {}
        g['f3w'] = dz5.T @ c['a4']; g['f3b'] = dz5.sum(0)
        dz4 = (dz5 @ p['f3w']) * c['m4']
        g['f2w'] = dz4.T @ c['a3']; g['f2b'] = dz4.sum(0)
        dz3 = (dz4 @ p['f2w']) * c['m3']
        g['f1w'] = dz3.T @ c['f0']; g['f1b'] = dz3.sum(0)
        df0 = dz3 @ p['f1w']
        dp2 = df0.reshape(-1, 16, 5, 5)
        dz2 = pool_backward(dp2, c['pm2']) * c['m2']
        dx1, g['c2w'], g['c2b'] = conv_backward(dz2, c['x1'], c['cols2'], p['c2w'])
        dz1 = pool_backward(dx1, c['pm1']) * c['m1']
        _, g['c1w'], g['c1b'] = conv_backward(dz1, c['x0'], c['cols1'], p['c1w'])
        return g


def prepare(images):
    """uint8 (N, 28, 28) -> float (N, 1, 32, 32) em [0, 1], com borda de 2 pixels."""
    x = np.zeros((images.shape[0], 1, 32, 32))
    x[:, 0, 2:30, 2:30] = images / 255.0
    return x


def train(net, xs, ys, epochs, rng, batch=64, lr=1e-3):
    m = {k: np.zeros_like(v) for k, v in net.p.items()}
    v = {k: np.zeros_like(v) for k, v in net.p.items()}
    b1, b2, eps, step = 0.9, 0.999, 1e-8, 0
    n = xs.shape[0]
    for ep in range(epochs):
        order = rng.permutation(n)
        t0, loss_sum = time.time(), 0.0
        rate = lr * (0.5 ** ep)
        for s in range(0, n, batch):
            idx = order[s:s + batch]
            x, y = prepare(xs[idx]), ys[idx]
            z, cache = net.forward(x)
            z = z - z.max(1, keepdims=True)
            pr = np.exp(z); pr /= pr.sum(1, keepdims=True)
            loss_sum += -np.log(pr[np.arange(len(y)), y] + 1e-12).sum()
            pr[np.arange(len(y)), y] -= 1
            g = net.backward(pr / len(y), cache)
            step += 1
            for k in net.p:
                m[k] = b1 * m[k] + (1 - b1) * g[k]
                v[k] = b2 * v[k] + (1 - b2) * g[k] ** 2
                mh, vh = m[k] / (1 - b1 ** step), v[k] / (1 - b2 ** step)
                net.p[k] -= rate * mh / (np.sqrt(vh) + eps)
        print(f'época {ep + 1}: perda média {loss_sum / n:.4f} ({time.time() - t0:.0f} s)', flush=True)


def float_accuracy(net, xs, ys):
    ok = 0
    for s in range(0, xs.shape[0], 500):
        z, _ = net.forward(prepare(xs[s:s + 500]))
        ok += int((z.argmax(1) == ys[s:s + 500]).sum())
    return ok / xs.shape[0]


# Quantização e inferência inteira (espelho de js/axc/lenet.js) ------------------------------------------------

def requant(acc, M):
    return np.clip(np.floor(acc * M + 0.5), 0, 255).astype(np.int64)


def int_conv(a, Wq, bq):
    k = Wq.shape[2]
    cols = im2col(a.astype(np.int64), k)
    out = cols @ Wq.reshape(Wq.shape[0], -1).T.astype(np.int64) + bq
    return out.transpose(0, 3, 1, 2)


def int_pool(a):
    B, C, H, W = a.shape
    return a.reshape(B, C, H // 2, 2, W // 2, 2).max(axis=(3, 5))


def int_forward(q, images, stop=None):
    """Inferência inteira exata. Devolve os acumuladores da última camada (ou as ativações de 'stop')."""
    a = np.zeros((images.shape[0], 1, 32, 32), dtype=np.int64)
    a[:, 0, 2:30, 2:30] = images
    L = q['layers']
    a = int_pool(requant(int_conv(a, L[0]['w'], L[0]['b']), L[0]['M']))
    if stop == 0: return a
    a = int_pool(requant(int_conv(a, L[1]['w'], L[1]['b']), L[1]['M']))
    if stop == 1: return a
    a = a.reshape(a.shape[0], -1)
    a = requant(a @ L[2]['w'].T.astype(np.int64) + L[2]['b'], L[2]['M'])
    if stop == 2: return a
    a = requant(a @ L[3]['w'].T.astype(np.int64) + L[3]['b'], L[3]['M'])
    if stop == 3: return a
    return a @ L[4]['w'].T.astype(np.int64) + L[4]['b']


def quantize(net, calib_images):
    """Escala dos pesos por camada (máximo |w| vira 127) e das ativações (percentil 99,99 vira 255)."""
    p = net.p
    names = [('c1w', 'c1b'), ('c2w', 'c2b'), ('f1w', 'f1b'), ('f2w', 'f2b'), ('f3w', 'f3b')]
    q = {'layers': []}
    s_in = 1.0 / 255.0
    # Ativações em float da rede (na escala real), para calibrar cada camada.
    _, c = net.forward(prepare(calib_images))
    z1, _ = conv_forward(c['x0'], p['c1w'], p['c1b'])
    z2, _ = conv_forward(c['x1'], p['c2w'], p['c2b'])
    reals = [np.maximum(z1, 0), np.maximum(z2, 0), c['a3'], c['a4'], None]
    for i, (wn, bn) in enumerate(names):
        W, b = p[wn], p[bn]
        s_w = np.abs(W).max() / 127.0
        Wq = np.clip(np.round(W / s_w), -127, 127).astype(np.int8)
        bq = np.round(b / (s_in * s_w)).astype(np.int64)
        layer = {'w': Wq, 'b': bq, 's_w': s_w, 's_in': s_in}
        if reals[i] is not None:
            s_out = float(np.percentile(reals[i], 99.99)) / 255.0
            layer['M'] = s_in * s_w / s_out
            layer['s_out'] = s_out
            s_in = s_out
        q['layers'].append(layer)
    return q


def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode('ascii')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mnist')
    ap.add_argument('--epochs', type=int, default=4)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', default='data')
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    tr_x = load_idx(os.path.join(args.mnist, 'train-images-idx3-ubyte.gz'))
    tr_y = load_idx(os.path.join(args.mnist, 'train-labels-idx1-ubyte.gz')).astype(np.int64)
    te_x = load_idx(os.path.join(args.mnist, 't10k-images-idx3-ubyte.gz'))
    te_y = load_idx(os.path.join(args.mnist, 't10k-labels-idx1-ubyte.gz')).astype(np.int64)
    print(f'MNIST: {tr_x.shape[0]} de treino, {te_x.shape[0]} de teste')

    net = LeNet5(rng)
    train(net, tr_x, tr_y, args.epochs, rng)
    acc_float = float_accuracy(net, te_x, te_y)
    q = quantize(net, tr_x[:3000])
    pred_all = int_forward(q, te_x).argmax(1)
    acc_int = float((pred_all == te_y).mean())
    print(f'acurácia no teste completo: float {acc_float:.4f}, inteira 8 bits {acc_int:.4f}')

    # Subconjunto: as 100 primeiras imagens de teste de cada dígito, na ordem original.
    sel = np.sort(np.concatenate([np.flatnonzero(te_y == d)[:100] for d in range(10)]))
    sub_x, sub_y = te_x[sel], te_y[sel]
    sub_pred = int_forward(q, sub_x).argmax(1)
    acc_sub = float((sub_pred == sub_y).mean())
    print(f'acurácia no subconjunto de 1000: inteira 8 bits {acc_sub:.4f}')

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, 'mnist1000.bin'), 'wb') as f:
        f.write(sub_y.astype(np.uint8).tobytes())
        f.write(sub_x.astype(np.uint8).tobytes())
    layers = []
    for name, L in zip(['conv1', 'conv2', 'fc1', 'fc2', 'fc3'], q['layers']):
        layers.append({
            'name': name, 'shape': list(L['w'].shape),
            'w': b64(L['w'].astype(np.int8)), 'b': b64(L['b'].astype(np.int32)),
            'M': L.get('M'), 'sIn': L['s_in'], 'sW': L['s_w'], 'sOut': L.get('s_out'),
        })
    model = {
        'description': 'LeNet-5 (ReLU, max pooling) treinada com scripts/lenet5/train.py, pesos em 8 bits com sinal e ativações em 8 bits sem sinal',
        'epochs': args.epochs, 'seed': args.seed,
        'accuracy': {'float': acc_float, 'int8': acc_int, 'int8Subset': acc_sub},
        'subset': {'file': 'mnist1000.bin', 'n': int(len(sel)), 'indices': sel.tolist()},
        'layers': layers,
        'expected': b64(sub_pred.astype(np.uint8)),
    }
    with open(os.path.join(args.out, 'lenet5.json'), 'w') as f:
        json.dump(model, f)
    print(f'gravado em {args.out}/lenet5.json e {args.out}/mnist1000.bin')


if __name__ == '__main__':
    main()
