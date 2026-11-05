#!/usr/bin/env python3
"""
Inferência inteira em Python (int_forward_graph de scripts/nn/train.py) de uma rede já gravada no formato axc-nn/1,
para a conferência bit a bit com o avaliador da página (js/axc/nn.js; etapa 18 do plano, docs/RESNET8.md).

    python3 scripts/nn/intcheck.py <rede.json> <conjunto.bin> [--n 100]

Lê a rede do JSON (pesos, vieses, reescalas, pontos zero, soma residual) e o conjunto no formato dos subconjuntos
(n rótulos e depois as imagens C x H x W em uint8), e escreve em JSON as classes e as saídas inteiras das n primeiras
imagens. Não precisa do PyTorch: se ele não estiver instalado, o train.py é importado com um substituto vazio.
"""
import argparse
import base64
import json
import os
import sys
import types

import numpy as np

try:
    import torch  # noqa: F401
except Exception:  # sem PyTorch (ou com um quebrado): só as funções inteiras do train.py são usadas
    torch = types.ModuleType('torch')
    nn = types.ModuleType('torch.nn')
    nn.Module = object
    torch.nn = nn
    sys.modules.update({'torch': torch, 'torch.nn': nn, 'torch.nn.functional': types.ModuleType('torch.nn.functional')})

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import int_forward_graph  # noqa: E402


def arr(b, dtype):
    return np.frombuffer(base64.b64decode(b), dtype=dtype).astype(np.int64)


def layers_from_json(js):
    """Camadas do JSON no formato de quantize_resnet (o que int_forward_graph lê)."""
    zero = {'input': (js.get('input') or {}).get('zero', 0)}
    acc = set()
    out, prev = [], 'input'
    for i, L in enumerate(js['layers']):
        name = L.get('name', f'l{i}')
        src = L.get('input', prev)
        e = {k: v for k, v in L.items() if k not in ('w', 'b', 'requant', 'output')}
        e['name'] = name
        if L['type'] in ('conv', 'dense'):
            e['wq'] = arr(L['w'], np.int8).reshape(L['out'], -1)
            e['bq'] = arr(L['b'], np.int32)
            e['zIn'] = zero[src]
            if L.get('output') == 'acc':
                e['acc'] = True
                acc.add(name)
            elif 'requant' in L:
                e['m'] = arr(L['requant']['m'], np.uint32)
                e['zero'] = L['requant'].get('zero', 0)
                zero[name] = e['zero']
            e.setdefault('pad', 0)
            e.setdefault('stride', 1)
        elif L['type'] == 'add':
            rq = L['requant']
            e['m'] = [arr(m, np.uint32) for m in rq['m']]
            e['exp'] = rq.get('exp', 0)
            e['zero'] = rq.get('zero', 0)
            e['accIn'] = [j in acc for j in L['inputs']]
            e['zIns'] = [0 if j in acc else zero[j] for j in L['inputs']]
            zero[name] = e['zero']
        else:
            zero[name] = zero[src]
        out.append(e)
        prev = name
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('net')
    ap.add_argument('data')
    ap.add_argument('--n', type=int, default=100)
    a = ap.parse_args()
    with open(a.net) as f:
        js = json.load(f)
    shape = js['dataset']['shape']
    raw = np.fromfile(a.data, dtype=np.uint8)
    size = int(np.prod(shape))
    n_all = len(raw) // (size + 1)
    n = min(a.n, n_all)
    images = raw[n_all:].reshape(n_all, *shape)[:n]
    inp = js.get('input') or {'mean': [0.0] * shape[0], 'std': [1 / 255] * shape[0], 'scale': 1.0, 'zero': 0, 'qmin': 0, 'qmax': 255}
    preds, outs = int_forward_graph(inp, layers_from_json(js), images)
    json.dump({'preds': preds.tolist(), 'outs': outs.tolist()}, sys.stdout)


if __name__ == '__main__':
    main()
