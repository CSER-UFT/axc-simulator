#!/usr/bin/env python3
"""
Treino em PyTorch e quantização em 8 bits das redes da página Rede neural, no formato axc-nn/1 (js/axc/nn.js).

    python3 scripts/nn/train.py <arquitetura> <base> <pasta da base> [--epochs N] [--seed 1] [--out data/nn]
    python3 scripts/nn/train.py resnet8 cifar10 ~/cifar-10-batches-py [--device cuda] [--batch 32] [--resume]

    arquitetura: minilenet | lenet5 | resnet8 (só com cifar10)
    base:        mnist | fashion   (os 4 arquivos .gz no formato idx, como no site do MNIST e no repositório do
                                   Fashion MNIST)
                 cifar10           (a versão Python oficial, cifar-10-batches-py com data_batch_1..5 e test_batch,
                                   ou a do pacote npm tfjs-cifar10, com data_batch_*.png e *_lables.json)

Arquiteturas (ReLU e max pooling 2 x 2 depois de cada convolução):
    minilenet  conv 3 filtros 5 x 5 borda 2, conv 6 filtros 5 x 5 borda 2, densa com metade das entradas (sem ReLU),
               densa de 10; a mesma do código C da MiniLenet para o Vitis
    lenet5     conv 6 filtros 5 x 5 (borda 2 nas imagens de 28 x 28), conv 16 filtros 5 x 5, densas de 120 e 84 com
               ReLU, densa de 10
    resnet8    a ResNet 8 do MLPerf Tiny (docs/RESNET8.md): 16, 32 e 64 filtros, BN depois de cada convolução 3 x 3
               (dobrado nos pesos na quantização), atalhos 1 x 1 de passo 2 sem BN, soma residual e ReLU, média de
               8 x 8 e densa de 10; a borda do padding='same' do Keras (0, 1, 0, 1 no passo 2). Treino com a receita
               da referência: Adam, taxa 0,001 x 0,99 por época, 500 épocas, lotes de 32, L2 de 1e-4 nos núcleos
               das convoluções, inicialização He normal, aumento de dados com rotação de até 15 graus, deslocamento
               de até 10% e espelho horizontal (feito na GPU); grava um ponto de retomada a cada época
               (<out>/resnet8-cifar10.ckpt; --resume continua dali).

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
RESNET8_EPOCHS = 500


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


# ResNet 8 ---------------------------------------------------------------------------------------------------------
def resnet8_spec(f=16):
    """Camadas da ResNet 8 no formato axc-nn/1 (sem os pesos): a mesma de docs/RESNET8.md e de scripts/nn/resnet8_arch.py.
    bn: a convolução tem BN (dobrado na quantização); relu: ReLU na saída; acc: sai o acumulador (a reescala fica na
    soma residual)."""
    L = [
        {'type': 'conv', 'name': 'conv1', 'out': f, 'k': 3, 'stride': 1, 'pad': 1, 'bn': True, 'relu': True},
        {'type': 'conv', 'name': 's1a', 'out': f, 'k': 3, 'stride': 1, 'pad': 1, 'bn': True, 'relu': True},
        {'type': 'conv', 'name': 's1b', 'out': f, 'k': 3, 'stride': 1, 'pad': 1, 'bn': True, 'acc': True},
        {'type': 'add', 'name': 's1add', 'inputs': ['conv1', 's1b']},
    ]
    prev = 's1add'
    for i, c in ((2, 2 * f), (3, 4 * f)):
        L += [
            {'type': 'conv', 'name': f's{i}a', 'input': prev, 'out': c, 'k': 3, 'stride': 2, 'pad': [0, 1, 0, 1], 'bn': True, 'relu': True},
            {'type': 'conv', 'name': f's{i}b', 'out': c, 'k': 3, 'stride': 1, 'pad': 1, 'bn': True, 'acc': True},
            {'type': 'conv', 'name': f's{i}sc', 'input': prev, 'out': c, 'k': 1, 'stride': 2, 'pad': 0, 'bn': False, 'acc': True},
            {'type': 'add', 'name': f's{i}add', 'inputs': [f's{i}sc', f's{i}b']},
        ]
        prev = f's{i}add'
    L += [{'type': 'avgpool', 'name': 'pool', 'size': 8}, {'type': 'flatten', 'name': 'flatten'},
          {'type': 'dense', 'name': 'fc', 'out': 10, 'relu': False}]
    return L


def pads4(p):
    return list(p) if isinstance(p, (list, tuple)) else [p, p, p, p]


class ResNet8(nn.Module):
    """A ResNet 8 em ponto flutuante, camada a camada como em resnet8_spec (a borda de cada lado como no Keras)."""
    def __init__(self, spec, shape):
        super().__init__()
        self.spec = spec
        chans = {'input': shape[0]}
        self.convs, self.bns = nn.ModuleDict(), nn.ModuleDict()
        prev = 'input'
        for L in spec:
            src = L.get('input', prev)
            if L['type'] == 'conv':
                conv = nn.Conv2d(chans[src], L['out'], L['k'], stride=L['stride'], padding=0, bias=True)
                nn.init.kaiming_normal_(conv.weight, nonlinearity='relu')
                nn.init.zeros_(conv.bias)
                self.convs[L['name']] = conv
                if L['bn']:
                    self.bns[L['name']] = nn.BatchNorm2d(L['out'], eps=1e-3, momentum=0.01)
                chans[L['name']] = L['out']
            elif L['type'] == 'add':
                chans[L['name']] = chans[L['inputs'][1]]
            elif L['type'] == 'dense':
                self.fc = nn.Linear(chans[src], L['out'])
                nn.init.kaiming_normal_(self.fc.weight, nonlinearity='relu')
                nn.init.zeros_(self.fc.bias)
            else:
                chans[L['name']] = chans[src]
            prev = L['name']

    def forward(self, x, record=None):
        """record, se dado (um dicionário), recebe a saída float de cada camada, pelo nome (a da quantização)."""
        vals = {'input': x}
        prev = 'input'
        for L in self.spec:
            t, name = L['type'], L['name']
            src = vals[L.get('input', prev)]
            if t == 'conv':
                pt, pb, pl, pr = pads4(L['pad'])
                y = self.convs[name](F.pad(src, (pl, pr, pt, pb)) if pt or pb or pl or pr else src)
                if L['bn']:
                    y = self.bns[name](y)
                if L.get('relu'):
                    y = F.relu(y)
            elif t == 'add':
                y = F.relu(vals[L['inputs'][0]] + vals[L['inputs'][1]])
            elif t == 'avgpool':
                y = F.avg_pool2d(src, L['size'])
            elif t == 'flatten':
                y = src.flatten(1)
            else:
                y = self.fc(src)
            vals[name] = y
            if record is not None:
                record[name] = y.detach()
            prev = name
        return vals[prev]

    def conv_kernels(self):
        return [m.weight for m in self.convs.values()]


def augment_resnet(x, gen):
    """Aumento de dados da referência (ImageDataGenerator do Keras): rotação de até 15 graus, deslocamento de até 10%
    na horizontal e na vertical e espelho horizontal, com a borda repetida (fill_mode='nearest'); na GPU, se x estiver
    nela."""
    n, dev = x.shape[0], x.device
    ang = (torch.rand(n, generator=gen, device=dev) * 2 - 1) * (15 * np.pi / 180)
    tx = (torch.rand(n, generator=gen, device=dev) * 2 - 1) * 0.2          # 10% da largura (a grade vai de -1 a 1)
    ty = (torch.rand(n, generator=gen, device=dev) * 2 - 1) * 0.2
    flip = torch.where(torch.rand(n, generator=gen, device=dev) < 0.5, -1.0, 1.0)
    cos, sin = torch.cos(ang), torch.sin(ang)
    theta = torch.stack([torch.stack([cos * flip, -sin, tx], 1), torch.stack([sin * flip, cos, ty], 1)], 1)
    grid = F.affine_grid(theta, list(x.shape), align_corners=False)
    return F.grid_sample(x, grid, mode='bilinear', padding_mode='border', align_corners=False)


def train_resnet(model, x_u8, y, vx, vy, mean, std, epochs, seed, batch, device, ckpt, resume):
    """Treino da ResNet 8 com a receita da referência (docs/RESNET8.md). As imagens ficam na GPU em uint8 e são
    normalizadas a cada lote; a cada época grava o ponto de retomada (ckpt) e guarda o melhor estado na validação."""
    dev = torch.device(device)
    model.to(dev)
    X = torch.from_numpy(np.ascontiguousarray(x_u8)).to(dev)
    Y = torch.from_numpy(y).to(dev)
    m = torch.tensor(mean, device=dev).view(1, -1, 1, 1)
    sd = torch.tensor(std, device=dev).view(1, -1, 1, 1)
    norm = lambda u: (u.float() / 255.0 - m) / sd  # noqa: E731
    VX, VY = norm(torch.from_numpy(vx).to(dev)), torch.from_numpy(vy).to(dev)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda ep: 0.99 ** ep)
    gen = torch.Generator(device=dev).manual_seed(seed)
    start, best, best_state = 0, -1.0, None
    if resume and os.path.exists(ckpt):
        c = torch.load(ckpt, map_location=dev)
        model.load_state_dict(c['model'])
        opt.load_state_dict(c['opt'])
        sched.load_state_dict(c['sched'])
        start, best, best_state = c['epoch'], c['best'], c['best_state']
        gen.manual_seed(seed + start)
        print(f'retomando da época {start} (melhor validação até aqui {best:.4f})', flush=True)
    kernels = model.conv_kernels()
    for ep in range(start, epochs):
        model.train()
        t0 = time.time()
        perm = torch.randperm(len(X), generator=gen, device=dev)
        tot = torch.zeros((), device=dev)
        for i in range(0, len(X), batch):
            idx = perm[i:i + batch]
            xb = augment_resnet(norm(X[idx]), gen)
            # L2 de 1e-4 nos núcleos das convoluções (kernel_regularizer do Keras: soma dos quadrados).
            loss = F.cross_entropy(model(xb), Y[idx]) + 1e-4 * sum((w * w).sum() for w in kernels)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            tot += loss.detach() * len(idx)
        sched.step()
        model.eval()
        with torch.no_grad():
            va = float(sum(int((model(VX[j:j + 1000]).argmax(1) == VY[j:j + 1000]).sum()) for j in range(0, len(VX), 1000)) / len(VX))
        if va > best:
            best, best_state = va, {k: v.detach().clone() for k, v in model.state_dict().items()}
        torch.save({'model': model.state_dict(), 'opt': opt.state_dict(), 'sched': sched.state_dict(), 'epoch': ep + 1, 'best': best, 'best_state': best_state}, ckpt)
        print(f'  época {ep + 1}/{epochs}: perda {float(tot) / len(X):.4f}, validação {va:.4f}, melhor {best:.4f}, taxa {sched.get_last_lr()[0]:.2e} ({time.time() - t0:.0f} s)', flush=True)
    model.load_state_dict(best_state)
    model.to('cpu')
    return best


def fold_bn(conv, bn):
    """Pesos e viés da convolução com o BN (no modo de avaliação) dobrado."""
    w = conv.weight.detach().double().numpy()
    b = conv.bias.detach().double().numpy()
    if bn is None:
        return w, b
    g = (bn.weight.detach().double() / torch.sqrt(bn.running_var.detach().double() + bn.eps)).numpy()
    return w * g.reshape(-1, 1, 1, 1), (b - bn.running_mean.detach().double().numpy()) * g + bn.bias.detach().double().numpy()


def quantize_resnet(model, mean, std, calib):
    """Quantização da ResNet 8 no formato axc-nn/1 com ramos (docs/RESNET8.md): as convoluções com ReLU reescalam para
    uint8; as "acc" (a segunda de cada pilha e os atalhos) entregam o acumulador, e a soma residual reescala os dois
    ramos de uma vez, com m em Q32 por canal e o expoente e quando algum M passa de 1."""
    C = len(mean)
    lo = min((0 - mean[c]) / std[c] for c in range(C))
    hi = max((1 - mean[c]) / std[c] for c in range(C))
    s_in, z_in = act_qparams(lo, hi)
    inp = {'mean': [float(v) for v in mean], 'std': [float(v) for v in std], 'scale': s_in, 'zero': z_in, 'qmin': 0, 'qmax': QMAX}
    model.eval()
    rec = {}
    with torch.no_grad():
        model(calib, record=rec)
    act = {'input': (s_in, z_in)}           # escala e ponto zero de cada tensor uint8
    accs = {}                               # escala por canal do acumulador de cada convolução "acc"
    layers, prev = [], 'input'

    def weights(w, s_x, z_x):
        O = w.shape[0]
        amax = np.abs(w.reshape(O, -1)).max(1)
        s_w = np.where(amax > 0, amax / 127.5, 1e-8)
        wq = np.clip(np.rint(w / s_w.reshape((O,) + (1,) * (w.ndim - 1))), -128, 127).astype(np.int64)
        return wq, s_w

    for L in model.spec:
        t, name = L['type'], L['name']
        src = L.get('input', prev)
        base = {k: v for k, v in L.items() if k not in ('bn', 'relu', 'acc')}
        if t in ('conv', 'dense'):
            if t == 'conv':
                w, b = fold_bn(model.convs[name], model.bns[name] if L['bn'] else None)
            else:
                w, b = model.fc.weight.detach().double().numpy(), model.fc.bias.detach().double().numpy()
            s_x, z_x = act[src]
            wq, s_w = weights(w, s_x, z_x)
            O = wq.shape[0]
            bq = np.rint(b / (s_x * s_w)).astype(np.int64) - z_x * wq.reshape(O, -1).sum(1)
            if np.abs(bq).max() >= 2 ** 31:
                raise SystemExit(f'{name}: viés fora de int32')
            e = {**base, 'wq': wq, 'bq': bq, 'zIn': z_x}
            if L.get('acc'):
                accs[name] = s_x * s_w
                e['acc'] = True
            else:
                a = rec[name].double().numpy()
                s_o, z_o = act_qparams(float(a.min()), float(a.max()))
                M = s_x * s_w / s_o
                m = np.rint(M * 2.0 ** 32).astype(np.int64)
                if (m >= 2 ** 32).any() or (m <= 0).any():
                    raise SystemExit(f'{name}: M fora de (0, 1): {M.min()} a {M.max()}')
                e.update({'m': m, 'zero': z_o})
                act[name] = (s_o, z_o)
            layers.append(e)
        elif t == 'add':
            a = rec[name].double().numpy()
            s_o, z_o = act_qparams(float(a.min()), float(a.max()))
            Ms, zins, isacc = [], [], []
            for j in L['inputs']:
                if j in accs:
                    Ms.append(accs[j] / s_o)
                    zins.append(0)
                    isacc.append(True)
                else:
                    s_j, z_j = act[j]
                    Ms.append(np.full(a.shape[1], s_j / s_o))
                    zins.append(z_j)
                    isacc.append(False)
            # Expoente: o maior que mantém todos os m abaixo de 2^32 (e <= 0; negativo quando algum M passa de 1).
            mx, ex = max(float(M.max()) for M in Ms), 0
            while mx * 2.0 ** (32 + ex) >= 2 ** 32 - 0.5:
                ex -= 1
            if ex < -16:
                raise SystemExit(f'{name}: M grande demais ({mx})')
            ms = [np.rint(M * 2.0 ** (32 + ex)).astype(np.int64) for M in Ms]
            if any((m <= 0).any() for m in ms):
                raise SystemExit(f'{name}: m nulo')
            layers.append({**base, 'm': ms, 'exp': ex, 'zero': z_o, 'zIns': zins, 'accIn': isacc})
            act[name] = (s_o, z_o)
        else:
            layers.append(base)
            act[name] = act[src]
        prev = name
    return inp, layers


def int_forward_graph(inp, layers, images, batch=250):
    """Classes e saídas inteiras da rede com ramos (a mesma conta de js/axc/nn.js): borda de cada lado, acumulador
    das convoluções "acc", soma residual com uma reescala só, média arredondada."""
    C = images.shape[1]
    luts = [input_table(inp, c) for c in range(C)]
    preds, outs = [], []
    for i0 in range(0, len(images), batch):
        img = images[i0:i0 + batch]
        vals = {'input': np.stack([luts[c][img[:, c]] for c in range(C)], axis=1)}
        prev = 'input'
        for L in layers:
            t, name = L['type'], L['name']
            x = vals[L.get('input', prev)]
            if t == 'conv':
                k, st = L['k'], L['stride']
                pt, pb, pl, pr = pads4(L['pad'])
                N, Ci, H, W = x.shape
                xp = np.full((N, Ci, H + pt + pb, W + pl + pr), L['zIn'], dtype=np.int64)
                xp[:, :, pt:pt + H, pl:pl + W] = x
                OH, OW = (H + pt + pb - k) // st + 1, (W + pl + pr - k) // st + 1
                cols = np.lib.stride_tricks.sliding_window_view(xp, (k, k), axis=(2, 3))[:, :, ::st, ::st][:, :, :OH, :OW]
                cols = cols.transpose(0, 2, 3, 1, 4, 5).reshape(N, OH * OW, Ci * k * k)
                acc = cols @ L['wq'].reshape(L['out'], -1).T + L['bq']
                y = acc if L.get('acc') else requant(acc, L['m'], L['zero'])
                y = y.reshape(N, OH, OW, -1).transpose(0, 3, 1, 2)
            elif t == 'add':
                ex = L['exp']
                tot = np.full(vals[L['inputs'][0]].shape, 1 << (31 + ex), dtype=np.int64) if ex > -31 else 0
                for j, m, z, isacc in zip(L['inputs'], L['m'], L['zIns'], L['accIn']):
                    v = vals[j] if isacc else vals[j] - z
                    if int(np.abs(v).max()) * int(m.max()) >= 2 ** 61:
                        raise SystemExit(f'{name}: produto passa de 62 bits')
                    tot = tot + v * m.reshape(1, -1, 1, 1)
                y = np.clip((tot >> (32 + ex)) + L['zero'], 0, 255)
            elif t == 'avgpool':
                s = L['size']
                N, Ci, H, W = x.shape
                y = (x[:, :, :H // s * s, :W // s * s].reshape(N, Ci, H // s, s, W // s, s).sum(axis=(3, 5)) + (s * s) // 2) // (s * s)
            elif t == 'flatten':
                y = x.reshape(x.shape[0], -1)
            else:
                acc = x @ L['wq'].reshape(L['out'], -1).T + L['bq']
                y = requant(acc, L['m'], L['zero']) if 'm' in L else acc     # sem reescala: as saídas são o acumulador
            vals[name] = y
            prev = name
        out = vals[prev]
        outs.append(out)
        preds.append(out.argmax(1))
    return np.concatenate(preds), np.concatenate(outs)


def resnet8_json_layers(qlayers):
    """Camadas quantizadas da ResNet 8 no JSON do formato axc-nn/1."""
    out = []
    for L in qlayers:
        e = {k: v for k, v in L.items() if k not in ('wq', 'bq', 'm', 'zero', 'zIn', 'acc', 'exp', 'zIns', 'accIn')}
        if 'pad' in e and isinstance(e['pad'], list):
            e['pad'] = [int(v) for v in e['pad']]
        if L['type'] in ('conv', 'dense'):
            e.update({'w': b64(L['wq'], np.int8), 'b': b64(L['bq'], np.int32)})
            if L.get('acc'):
                e['output'] = 'acc'
            else:
                e['requant'] = {'mode': 'q32', 'm': b64(L['m'], np.uint32), 'zero': int(L['zero'])}
        elif L['type'] == 'add':
            e['requant'] = {'mode': 'q32', 'm': [b64(m, np.uint32) for m in L['m']], 'exp': int(L['exp']), 'zero': int(L['zero'])}
        out.append(e)
    return out


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


def split_validation(tr_y, seed, per_class=500):
    """Índices (em ordem) das imagens de treino que ficam de fora do treino e servem de validação: per_class de cada
    classe, sorteadas com a semente. Depende só da semente e dos rótulos de treino (scripts/nn/export_val.py refaz a
    mesma separação sem treinar)."""
    rng = np.random.default_rng(seed)
    return np.sort(np.concatenate([rng.choice(np.flatnonzero(tr_y == c), per_class, replace=False) for c in range(int(tr_y.max()) + 1)]))


def write_subset(path, x, y):
    with open(path, 'wb') as f:
        f.write(y.astype(np.uint8).tobytes())
        f.write(np.ascontiguousarray(x, dtype=np.uint8).tobytes())


# --------------------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('arch', choices=['minilenet', 'lenet5', 'resnet8'])
    ap.add_argument('dataset', choices=list(DATASETS))
    ap.add_argument('folder')
    ap.add_argument('--epochs', type=int)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', default='data/nn')
    ap.add_argument('--threads', type=int, default=0)
    ap.add_argument('--device', default=None, help='resnet8: cuda ou cpu (padrão: cuda se houver)')
    ap.add_argument('--batch', type=int, default=32, help='resnet8: tamanho do lote (32 na referência)')
    ap.add_argument('--resume', action='store_true', help='resnet8: continua do ponto de retomada')
    ap.add_argument('--limit', type=int, default=0, help='resnet8: só as N primeiras imagens de treino (para testar o script)')
    args = ap.parse_args()
    if args.arch == 'resnet8' and args.dataset != 'cifar10':
        raise SystemExit('a resnet8 é só para a cifar10')
    if args.threads:
        torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    ds = DATASETS[args.dataset]
    epochs = args.epochs or DEFAULT_EPOCHS[args.dataset]
    tr_x, tr_y, te_x, te_y = load_dataset(args.dataset, args.folder)
    shape = tuple(int(v) for v in tr_x.shape[1:])
    print(f'{ds["name"]}: {len(tr_x)} de treino, {len(te_x)} de teste, forma {shape}')

    # Validação separada do treino: 500 de cada classe, sorteadas com a semente.
    val_idx = split_validation(tr_y, args.seed)
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

    if args.arch == 'resnet8':
        return main_resnet8(args, ds, shape, fit_x, fit_y, va_x, va_y, te_x, te_y, mean, std, X, TX, TY)
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


def write_subset_once(path, x, y):
    """Grava o subconjunto, ou confere que o que já está gravado é igual (as LeNets da CIFAR 10 usam os mesmos)."""
    if os.path.exists(path):
        with open(path, 'rb') as f:
            old = f.read()
        new = y.astype(np.uint8).tobytes() + np.ascontiguousarray(x, dtype=np.uint8).tobytes()
        if old != new:
            raise SystemExit(f'{path} já existe e é outro (outra semente?); apague-o ou use a mesma semente das outras redes')
        return
    write_subset(path, x, y)


def main_resnet8(args, ds, shape, fit_x, fit_y, va_x, va_y, te_x, te_y, mean, std, X, TX, TY):
    device = args.device or ('cuda' if torch.cuda.is_available() else 'cpu')
    epochs = args.epochs or RESNET8_EPOCHS
    if args.limit:
        fit_x, fit_y = fit_x[:args.limit], fit_y[:args.limit]
    os.makedirs(args.out, exist_ok=True)
    ckpt = os.path.join(args.out, 'resnet8-cifar10.ckpt')
    print(f'ResNet 8: {len(fit_x)} imagens de treino, {epochs} épocas, lotes de {args.batch}, em {device}', flush=True)
    spec = resnet8_spec()
    model = ResNet8(spec, shape)
    t0 = time.time()
    best_val = train_resnet(model, fit_x, fit_y, va_x, va_y, mean, std, epochs, args.seed, args.batch, device, ckpt, args.resume)
    acc_float = accuracy(model, TX, TY)
    print(f'ponto flutuante: validação {best_val:.4f}, teste {acc_float:.4f} ({time.time() - t0:.0f} s)', flush=True)

    calib = X[torch.randperm(len(X), generator=torch.Generator().manual_seed(args.seed))[:3000]]
    inp, qlayers = quantize_resnet(model, mean, std, calib)
    pred, _ = int_forward_graph(inp, qlayers, te_x)
    acc_int = float((pred == te_y).mean())
    vpred, _ = int_forward_graph(inp, qlayers, va_x)
    acc_val = float((vpred == va_y).mean())
    sel, vsel = first_per_class(te_y), first_per_class(va_y)
    sub_pred, sub_out = int_forward_graph(inp, qlayers, te_x[sel])
    acc_sub = float((sub_pred == te_y[sel]).mean())
    print(f'8 bits: teste {acc_int:.4f}, validação {acc_val:.4f}, subconjunto de teste {acc_sub:.4f}', flush=True)

    test_file, val_file = 'data/nn/cifar10-test1000.bin', 'data/nn/cifar10-val1000.bin'
    write_subset_once(test_file, te_x[sel], te_y[sel])
    write_subset_once(val_file, va_x[vsel], va_y[vsel])
    model_json = {
        'format': FORMAT, 'id': 'resnet8-cifar10', 'name': 'ResNet 8',
        'description': 'ResNet 8 do MLPerf Tiny (docs/RESNET8.md) treinada com scripts/nn/train.py (PyTorch) na CIFAR 10 e quantizada depois do treino: BN dobrado nos pesos, pesos int8 por canal, ativações uint8 com ponto zero, reescala em Q32 e soma residual com uma reescala só',
        'source': {'script': 'scripts/nn/train.py', 'epochs': epochs, 'seed': args.seed, 'batch': args.batch, 'torch': torch.__version__, 'reference': 'github.com/mlcommons/tiny, benchmark/training/image_classification'},
        'dataset': {
            'id': 'cifar10', 'name': ds['name'], 'file': test_file, 'n': int(len(sel)), 'shape': list(shape), 'classes': ds['classes'],
            'val': {'file': val_file, 'n': int(len(vsel))}, 'note': f'1000 imagens do teste e 1000 da validação (100 de cada classe); {ds["note"]}',
        },
        'input': inp,
        'layers': resnet8_json_layers(qlayers),
        'accuracy': {'float': acc_float, 'int8Full': acc_int, 'int8Val': acc_val, 'int8Subset': acc_sub, 'floatVal': best_val},
        'expected': b64(sub_pred, np.uint8),
        # Saídas inteiras das 1000 imagens (10 por imagem): a conferência bit a bit com js/axc/nn.js (etapa 18).
        'expectedOut': b64(sub_out, np.uint8),
    }
    path = os.path.join(args.out, 'resnet8-cifar10.json')
    with open(path, 'w') as fo:
        json.dump(model_json, fo, indent=1)
        fo.write('\n')
    print(f'gravado em {path}', flush=True)


if __name__ == '__main__':
    main()
