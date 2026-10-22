#!/usr/bin/env python3
"""
Treino em PyTorch e quantização em 8 bits das redes da página Rede neural, no formato axc-nn/1 (js/axc/nn.js).

    python3 scripts/nn/train.py <arquitetura> <base> <pasta da base> [--epochs N] [--seed 1] [--out data/nn]

    arquitetura: minilenet | lenet5
    base:        mnist | fashion   (os 4 arquivos .gz no formato idx, como no site do MNIST e no repositório do
                                   Fashion MNIST)
                 cifar10           (a versão Python oficial, cifar-10-batches-py com data_batch_1..5 e test_batch,
                                   ou a do pacote npm tfjs-cifar10, com data_batch_*.png e *_lables.json)

Arquiteturas (ReLU e max pooling 2 x 2 depois de cada convolução):
    minilenet  conv 3 filtros 5 x 5 borda 2, conv 6 filtros 5 x 5 borda 2, densa com metade das entradas (sem ReLU),
               densa de 10; a mesma do código C da MiniLenet para o Vitis
    lenet5     conv 6 filtros 5 x 5 (borda 2 nas imagens de 28 x 28), conv 16 filtros 5 x 5, densas de 120 e 84 com
               ReLU, densa de 10

Separação dos dados: 5000 imagens de treino (500 de cada classe, sorteadas com a semente) ficam de fora do treino e
servem de validação (escolha da melhor época e, na página, da busca); o teste é o conjunto de teste oficial. Os
subconjuntos gravados para a página são as 100 primeiras imagens de cada classe, na ordem original, do teste e da
validação.

Quantização depois do treino, na convenção do código C da MiniLenet (a do PyTorch com o observador de mínimo e
máximo e faixa reduzida):
    entrada: (pixel / 255 - média) / desvio, por canal; uint8 com uma escala e um ponto zero, faixa de 0 a 127;
    pesos: int8 simétricos por canal de saída (escala = máximo de |w| / 127,5, de -128 a 127);
    ativações: uint8 com escala e ponto zero por camada, faixa de 0 a 127, calibrados em imagens de treino;
    viés: int32 na escala da entrada vezes a do peso;
    reescala: M = s_entrada s_peso / s_saída em Q32, saída = min(255, max(0, ((acc M + 2^31) >> 32) + z_saída)).
O ponto zero da entrada de cada camada vai para o viés (b - z soma dos pesos), e a borda é preenchida com ele. A
inferência inteira daqui é a mesma conta de js/axc/nn.js; as classes do subconjunto de teste vão no JSON, e um teste
em JavaScript confere que o navegador dá as mesmas.
"""
import argparse
import base64
import gzip
import json
import os
import pickle
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

FORMAT = 'axc-nn/1'

DATASETS = {
    'mnist': {
        'name': 'MNIST', 'classes': [str(d) for d in range(10)],
        'note': 'MNIST (LeCun, Cortes e Burges), licença CC BY-SA 3.0',
    },
    'fashion': {
        'name': 'Fashion MNIST',
        'classes': ['T-shirt/top', 'Trouser', 'Pullover', 'Dress', 'Coat', 'Sandal', 'Shirt', 'Sneaker', 'Bag', 'Ankle boot'],
        'note': 'Fashion MNIST (Xiao, Rasul e Vollgraf, 2017), licença MIT',
    },
    'cifar10': {
        'name': 'CIFAR 10',
        'classes': ['airplane', 'automobile', 'bird', 'cat', 'deer', 'dog', 'frog', 'horse', 'ship', 'truck'],
        'note': 'CIFAR 10 (Krizhevsky, 2009)',
    },
}
DEFAULT_EPOCHS = {'mnist': 10, 'fashion': 15, 'cifar10': 30}


# Dados ----------------------------------------------------------------------------------------------------------
def load_idx(path):
    with gzip.open(path, 'rb') as f:
        data = f.read()
    n = data[3]
    dims = [int.from_bytes(data[4 + 4 * i:8 + 4 * i], 'big') for i in range(n)]
    return np.frombuffer(data, dtype=np.uint8, offset=4 + 4 * n).reshape(dims)


def load_cifar10(folder):
    """Imagens (N, 3, 32, 32) uint8 e rótulos, da versão Python oficial ou da do pacote tfjs-cifar10."""
    py = folder if os.path.exists(os.path.join(folder, 'test_batch')) else os.path.join(folder, 'cifar-10-batches-py')
    if os.path.exists(os.path.join(py, 'test_batch')):
        def batch(name):
            with open(os.path.join(py, name), 'rb') as f:
                d = pickle.load(f, encoding='bytes')
            return np.asarray(d[b'data'], dtype=np.uint8).reshape(-1, 3, 32, 32), np.asarray(d[b'labels'], dtype=np.int64)
        tr = [batch(f'data_batch_{i}') for i in range(1, 6)]
        te = batch('test_batch')
        return np.concatenate([b[0] for b in tr]), np.concatenate([b[1] for b in tr]), te[0], te[1]
    # Pacote npm tfjs-cifar10: cada linha do PNG é uma imagem (1024 pixels RGB, 32 x 32 por linhas).
    from PIL import Image
    pkg = os.path.join(folder, 'package') if os.path.exists(os.path.join(folder, 'package')) else folder

    def png(name):
        a = np.asarray(Image.open(os.path.join(pkg, name)).convert('RGB'), dtype=np.uint8)
        return a.reshape(-1, 32, 32, 3).transpose(0, 3, 1, 2).copy()
    tr_x = np.concatenate([png(f'data_batch_{i}.png') for i in range(1, 6)])
    te_x = png('test_batch.png')
    with open(os.path.join(pkg, 'train_lables.json')) as f:
        tr_y = np.asarray(json.load(f), dtype=np.int64)
    with open(os.path.join(pkg, 'test_lables.json')) as f:
        te_y = np.asarray(json.load(f), dtype=np.int64)
    return tr_x, tr_y, te_x, te_y


def load_dataset(name, folder):
    if name == 'cifar10':
        return load_cifar10(folder)
    tr_x = load_idx(os.path.join(folder, 'train-images-idx3-ubyte.gz'))[:, None]
    tr_y = load_idx(os.path.join(folder, 'train-labels-idx1-ubyte.gz')).astype(np.int64)
    te_x = load_idx(os.path.join(folder, 't10k-images-idx3-ubyte.gz'))[:, None]
    te_y = load_idx(os.path.join(folder, 't10k-labels-idx1-ubyte.gz')).astype(np.int64)
    return tr_x, tr_y, te_x, te_y


def first_per_class(y, k=100):
    return np.sort(np.concatenate([np.flatnonzero(y == c)[:k] for c in range(int(y.max()) + 1)]))


# Arquiteturas ---------------------------------------------------------------------------------------------------
def arch_spec(arch, shape):
    """Camadas no formato axc-nn/1 (sem os pesos), com relu nas que têm ReLU."""
    C, H, W = shape
    if arch == 'minilenet':
        h = H // 2 // 2
        flat = 6 * h * (W // 2 // 2)
        return [
            {'type': 'conv', 'name': 'conv1', 'out': 3, 'k': 5, 'pad': 2, 'stride': 1, 'relu': True},
            {'type': 'maxpool', 'size': 2},
            {'type': 'conv', 'name': 'conv2', 'out': 6, 'k': 5, 'pad': 2, 'stride': 1, 'relu': True},
            {'type': 'maxpool', 'size': 2},
            {'type': 'flatten'},
            {'type': 'dense', 'name': 'fc1', 'out': flat // 2, 'relu': False},
            {'type': 'dense', 'name': 'fc2', 'out': 10, 'relu': False},
        ]
    if arch == 'lenet5':
        return [
            {'type': 'conv', 'name': 'conv1', 'out': 6, 'k': 5, 'pad': 2 if H == 28 else 0, 'stride': 1, 'relu': True},
            {'type': 'maxpool', 'size': 2},
            {'type': 'conv', 'name': 'conv2', 'out': 16, 'k': 5, 'pad': 0, 'stride': 1, 'relu': True},
            {'type': 'maxpool', 'size': 2},
            {'type': 'flatten'},
            {'type': 'dense', 'name': 'fc1', 'out': 120, 'relu': True},
            {'type': 'dense', 'name': 'fc2', 'out': 84, 'relu': True},
            {'type': 'dense', 'name': 'fc3', 'out': 10, 'relu': False},
        ]
    raise SystemExit(f'arquitetura desconhecida: {arch}')


class Net(nn.Module):
    def __init__(self, spec, shape):
        super().__init__()
        self.spec = spec
        mods = []
        C, H, W = shape
        n = C * H * W
        for L in spec:
            if L['type'] == 'conv':
                mods.append(nn.Conv2d(C, L['out'], L['k'], stride=L['stride'], padding=L['pad']))
                H = (H + 2 * L['pad'] - L['k']) // L['stride'] + 1
                W = (W + 2 * L['pad'] - L['k']) // L['stride'] + 1
                C = L['out']
            elif L['type'] == 'maxpool':
                mods.append(None)
                H, W = H // L['size'], W // L['size']
            elif L['type'] == 'flatten':
                mods.append(None)
                n = C * H * W
            elif L['type'] == 'dense':
                mods.append(nn.Linear(n, L['out']))
                n = L['out']
        self.layers = nn.ModuleList([m for m in mods if m is not None])
        self.index = []
        k = 0
        for m in mods:
            self.index.append(k if m is not None else None)
            k += m is not None

    def forward(self, x, record=None):
        for L, i in zip(self.spec, self.index):
            if L['type'] in ('conv', 'dense'):
                x = self.layers[i](x)
                if L['relu']:
                    x = F.relu(x)
                if record is not None:
                    record.append(x.detach())
            elif L['type'] == 'maxpool':
                x = F.max_pool2d(x, L['size'])
            elif L['type'] == 'flatten':
                x = x.flatten(1)
        return x


# Treino ---------------------------------------------------------------------------------------------------------
def normalize(x_u8, mean, std):
    x = torch.from_numpy(np.array(x_u8, dtype=np.float32)) / 255.0
    return (x - torch.tensor(mean).view(1, -1, 1, 1)) / torch.tensor(std).view(1, -1, 1, 1)


def augment(x, gen):
    """Recorte aleatório com borda de 2 e espelho horizontal (só na CIFAR 10)."""
    n = x.shape[0]
    xp = F.pad(x, (2, 2, 2, 2), mode='reflect')
    C, H, W = x.shape[1], x.shape[2], x.shape[3]
    dy = torch.randint(0, 5, (n,), generator=gen)
    dx = torch.randint(0, 5, (n,), generator=gen)
    rows = (dy[:, None] + torch.arange(H))[:, None, :, None]
    cols = (dx[:, None] + torch.arange(W))[:, None, None, :]
    out = xp[torch.arange(n)[:, None, None, None], torch.arange(C)[None, :, None, None], rows, cols]
    flip = torch.rand(n, generator=gen) < 0.5
    out[flip] = out[flip].flip(3)
    return out


def accuracy(model, x, y, batch=1000):
    model.eval()
    ok = 0
    with torch.no_grad():
        for i in range(0, len(x), batch):
            ok += int((model(x[i:i + batch]).argmax(1) == y[i:i + batch]).sum())
    return ok / len(x)


def train(model, x, y, vx, vy, epochs, seed, aug, lr=1e-3, batch=64):
    gen = torch.Generator().manual_seed(seed)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    best, best_state = -1.0, None
    for ep in range(epochs):
        model.train()
        t0 = time.time()
        perm = torch.randperm(len(x), generator=gen)
        tot = 0.0
        for i in range(0, len(x), batch):
            idx = perm[i:i + batch]
            xb = x[idx]
            if aug:
                xb = augment(xb, gen)
            loss = F.cross_entropy(model(xb), y[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss.detach()) * len(idx)
        sched.step()
        va = accuracy(model, vx, vy)
        if va > best:
            best, best_state = va, {k: v.clone() for k, v in model.state_dict().items()}
        print(f'  época {ep + 1}/{epochs}: perda {tot / len(x):.4f}, validação {va:.4f} ({time.time() - t0:.0f} s)', flush=True)
    model.load_state_dict(best_state)
    return best


# Quantização e inferência inteira (espelho de js/axc/nn.js) ---------------------------------------------------
QMAX = 127


def act_qparams(lo, hi):
    """Escala e ponto zero de um tensor uint8 com faixa reduzida (0 a 127), como o observador do PyTorch."""
    lo, hi = min(0.0, lo), max(0.0, hi)
    scale = (hi - lo) / QMAX if hi > lo else 1.0
    zero = int(np.clip(0 - np.rint(lo / scale), 0, QMAX))
    return scale, zero


def input_table(q, channel):
    p = np.arange(256, dtype=np.float64)
    v = np.rint((p / 255 - q['mean'][channel]) / q['std'][channel] / q['scale']) + q['zero']
    return np.clip(v, q['qmin'], q['qmax']).astype(np.int64)


def quantize(model, spec, shape, mean, std, calib):
    """Pesos, viéses (com o ponto zero absorvido), M em Q32 e pontos zero de cada camada."""
    C = shape[0]
    lo = min((0 - mean[c]) / std[c] for c in range(C))
    hi = max((1 - mean[c]) / std[c] for c in range(C))
    s_in, z_in = act_qparams(lo, hi)
    inp = {'mean': [float(m) for m in mean], 'std': [float(s) for s in std], 'scale': s_in, 'zero': z_in, 'qmin': 0, 'qmax': QMAX}
    model.eval()
    rec = []
    with torch.no_grad():
        model(calib, record=rec)
    s, z = s_in, z_in
    layers, k = [], 0
    for L, i in zip(spec, model.index):
        if L['type'] not in ('conv', 'dense'):
            layers.append({key: v for key, v in L.items() if key != 'relu'})
            continue
        mod = model.layers[i]
        w = mod.weight.detach().double().numpy()
        b = mod.bias.detach().double().numpy()
        O = w.shape[0]
        amax = np.abs(w.reshape(O, -1)).max(1)
        s_w = np.where(amax > 0, amax / 127.5, 1e-8)
        wq = np.clip(np.rint(w / s_w.reshape((O,) + (1,) * (w.ndim - 1))), -128, 127).astype(np.int64)
        bq = np.rint(b / (s * s_w)).astype(np.int64)
        a = rec[k].double().numpy()
        k += 1
        s_out, z_out = act_qparams(float(a.min()), float(a.max()))
        M = s * s_w / s_out
        m = np.rint(M * 2.0 ** 32).astype(np.int64)
        if (m >= 2 ** 32).any() or (m <= 0).any():
            raise SystemExit(f'{L["name"]}: M fora de (0, 1): {M.min()} a {M.max()}')
        bf = bq - z * wq.reshape(O, -1).sum(1)              # ponto zero da entrada absorvido no viés
        if np.abs(bf).max() >= 2 ** 31:
            raise SystemExit(f'{L["name"]}: viés fora de int32')
        layers.append({**{key: v for key, v in L.items() if key != 'relu'}, 'wq': wq, 'bq': bf, 'm': m, 'zero': z_out, 'zIn': z})
        s, z = s_out, z_out
    return inp, layers


def int_forward(inp, layers, images, batch=500):
    """Classes e saídas da rede inteira para imagens uint8 (N, C, H, W): a mesma conta de js/axc/nn.js."""
    C = images.shape[1]
    luts = [input_table(inp, c) for c in range(C)]
    preds, outs = [], []
    for i0 in range(0, len(images), batch):
        img = images[i0:i0 + batch]
        x = np.stack([luts[c][img[:, c]] for c in range(C)], axis=1)        # int64 (N, C, H, W)
        for L in layers:
            t = L['type']
            if t == 'conv':
                k, p, st = L['k'], L['pad'], L['stride']
                N, Ci, H, W = x.shape
                xp = np.full((N, Ci, H + 2 * p, W + 2 * p), L['zIn'], dtype=np.int64)
                xp[:, :, p:p + H, p:p + W] = x
                OH, OW = (H + 2 * p - k) // st + 1, (W + 2 * p - k) // st + 1
                cols = np.lib.stride_tricks.sliding_window_view(xp, (k, k), axis=(2, 3))[:, :, ::st, ::st]
                cols = cols.transpose(0, 2, 3, 1, 4, 5).reshape(N, OH * OW, Ci * k * k)
                acc = cols @ L['wq'].reshape(L['out'], -1).T + L['bq']           # (N, OH*OW, O)
                y = requant(acc, L['m'], L['zero'])
                x = y.reshape(N, OH, OW, -1).transpose(0, 3, 1, 2)
            elif t == 'maxpool':
                s = L['size']
                N, Ci, H, W = x.shape
                x = x[:, :, :H // s * s, :W // s * s].reshape(N, Ci, H // s, s, W // s, s).max(axis=(3, 5))
            elif t == 'flatten':
                x = x.reshape(x.shape[0], -1)
            elif t == 'dense':
                acc = x @ L['wq'].T + L['bq']
                x = requant(acc, L['m'], L['zero'])
        outs.append(x)
        preds.append(x.argmax(1))
    return np.concatenate(preds), np.concatenate(outs)


def requant(acc, m, zero):
    r = (acc * m + (1 << 31)) >> 32
    return np.clip(r + zero, 0, 255)


def b64(a, dtype):
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode()


def write_subset(path, x, y):
    with open(path, 'wb') as f:
        f.write(y.astype(np.uint8).tobytes())
        f.write(np.ascontiguousarray(x, dtype=np.uint8).tobytes())


# --------------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('arch', choices=['minilenet', 'lenet5'])
    ap.add_argument('dataset', choices=list(DATASETS))
    ap.add_argument('folder')
    ap.add_argument('--epochs', type=int)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', default='data/nn')
    ap.add_argument('--threads', type=int, default=0)
    args = ap.parse_args()
    if args.threads:
        torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    ds = DATASETS[args.dataset]
    epochs = args.epochs or DEFAULT_EPOCHS[args.dataset]
    tr_x, tr_y, te_x, te_y = load_dataset(args.dataset, args.folder)
    shape = tuple(int(v) for v in tr_x.shape[1:])
    print(f'{ds["name"]}: {len(tr_x)} de treino, {len(te_x)} de teste, forma {shape}')

    # Validação separada do treino: 500 de cada classe, sorteadas com a semente.
    rng = np.random.default_rng(args.seed)
    val_idx = np.sort(np.concatenate([rng.choice(np.flatnonzero(tr_y == c), 500, replace=False) for c in range(10)]))
    mask = np.ones(len(tr_x), bool)
    mask[val_idx] = False
    fit_x, fit_y, va_x, va_y = tr_x[mask], tr_y[mask], tr_x[val_idx], tr_y[val_idx]

    # Normalização por canal, com a média e o desvio das imagens de treino.
    f = fit_x.astype(np.float64) / 255
    mean = [round(float(f[:, c].mean()), 4) for c in range(shape[0])]
    std = [round(float(f[:, c].std()), 4) for c in range(shape[0])]
    del f
    print(f'média {mean}, desvio {std}')
    X, Y = normalize(fit_x, mean, std), torch.from_numpy(fit_y)
    VX, VY = normalize(va_x, mean, std), torch.from_numpy(va_y)
    TX, TY = normalize(te_x, mean, std), torch.from_numpy(te_y)

    spec = arch_spec(args.arch, shape)
    model = Net(spec, shape)
    t0 = time.time()
    best_val = train(model, X, Y, VX, VY, epochs, args.seed, aug=args.dataset == 'cifar10')
    acc_float = accuracy(model, TX, TY)
    print(f'ponto flutuante: validação {best_val:.4f}, teste {acc_float:.4f} ({time.time() - t0:.0f} s de treino)')

    calib = X[torch.randperm(len(X), generator=torch.Generator().manual_seed(args.seed))[:3000]]
    inp, qlayers = quantize(model, spec, shape, mean, std, calib)
    pred, _ = int_forward(inp, qlayers, te_x)
    acc_int = float((pred == te_y).mean())
    vpred, _ = int_forward(inp, qlayers, va_x)
    acc_val = float((vpred == va_y).mean())
    sel = first_per_class(te_y)
    sub_pred, _ = int_forward(inp, qlayers, te_x[sel])
    acc_sub = float((sub_pred == te_y[sel]).mean())
    vsel = first_per_class(va_y)
    print(f'8 bits: teste {acc_int:.4f}, validação {acc_val:.4f}, subconjunto de teste {acc_sub:.4f}')

    os.makedirs(args.out, exist_ok=True)
    # Subconjuntos da base (o de teste do MNIST continua em data/mnist1000.bin, o mesmo de antes).
    test_file = 'data/mnist1000.bin' if args.dataset == 'mnist' else f'data/nn/{args.dataset}-test1000.bin'
    val_file = f'data/nn/{args.dataset}-val1000.bin'
    write_subset(test_file, te_x[sel], te_y[sel])
    write_subset(val_file, va_x[vsel], va_y[vsel])

    names = {'minilenet': 'MiniLenet', 'lenet5': 'LeNet 5'}
    out_layers = []
    for L in qlayers:
        if 'wq' not in L:
            out_layers.append(L)
            continue
        e = {key: v for key, v in L.items() if key not in ('wq', 'bq', 'm', 'zero', 'zIn')}
        e.update({'w': b64(L['wq'], np.int8), 'b': b64(L['bq'], np.int32), 'requant': {'mode': 'q32', 'm': b64(L['m'], np.uint32), 'zero': int(L['zero'])}})
        out_layers.append(e)
    model_json = {
        'format': FORMAT, 'id': f'{args.arch}-{args.dataset}', 'name': names[args.arch],
        'description': f'{names[args.arch]} treinada com scripts/nn/train.py (PyTorch) em {ds["name"]} e quantizada depois do treino: pesos int8 por canal, ativações uint8 com ponto zero, reescala em Q32',
        'source': {'script': 'scripts/nn/train.py', 'epochs': epochs, 'seed': args.seed, 'torch': torch.__version__},
        'dataset': {
            'id': args.dataset, 'name': ds['name'], 'file': test_file, 'n': int(len(sel)), 'shape': list(shape), 'classes': ds['classes'],
            'val': {'file': val_file, 'n': int(len(vsel))}, 'note': f'1000 imagens do teste e 1000 da validação (100 de cada classe); {ds["note"]}',
        },
        'input': inp,
        'layers': out_layers,
        'accuracy': {'float': acc_float, 'int8Full': acc_int, 'int8Val': acc_val, 'int8Subset': acc_sub},
        'expected': b64(sub_pred, np.uint8),
    }
    path = os.path.join(args.out, f'{args.arch}-{args.dataset}.json')
    with open(path, 'w') as fo:
        json.dump(model_json, fo, indent=1)
        fo.write('\n')
    print(f'gravado em {path}, {test_file} e {val_file}')


if __name__ == '__main__':
    main()
