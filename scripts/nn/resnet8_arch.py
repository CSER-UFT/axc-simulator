#!/usr/bin/env python3
"""
Arquitetura da ResNet 8 do MLPerf Tiny (classificação de imagens, CIFAR 10), fixada pela referência oficial
(github.com/mlcommons/tiny, benchmark/training/image_classification: keras_model.resnet_v1_eembc e o modelo
trained_models/pretrainedResnet.h5, com 16, 32 e 64 filtros). Documentação em docs/RESNET8.md.

Sem dependências: monta a tabela das camadas com as formas, a borda de cada convolução (a do Keras com
padding='same', que no passo 2 sobre entrada par põe a linha e a coluna a mais embaixo e à direita), os parâmetros e
as multiplicações por imagem, e confere os totais (78 666 valores no .h5, contando os quatro de cada canal do BN;
77 706 pesos e vieses depois de dobrar o BN; 12 501 632 multiplicações).

    python3 scripts/nn/resnet8_arch.py                 # tabela e totais
    python3 scripts/nn/resnet8_arch.py --json          # a tabela em JSON
    python3 scripts/nn/resnet8_arch.py --h5 caminho/pretrainedResnet.h5   # confere com o modelo oficial (h5py)
"""
import argparse
import json
import sys

FILTERS = 16  # pretrainedResnet.h5; o train.py atual da referência usa 26 por padrão, e o modelo "large", 40


def same_pad(n, k, s):
    """Borda do padding='same' do Keras (TensorFlow): o total que falta, com a metade menor no início."""
    out = -(-n // s)
    total = max((out - 1) * s + k - n, 0)
    return out, total // 2, total - total // 2


def layers(f=FILTERS):
    """
    Camadas na ordem de execução. Cada uma: nome, tipo, entradas (nomes), forma de saída (canais, altura, largura) e,
    nas com pesos, k, passo, borda (cima, baixo, esquerda, direita), BN depois e se é sítio da busca.
    """
    L, shape = [], {'input': (3, 32, 32)}

    def conv(name, src, cout, k, s, bn, relu):
        cin, h, w = shape[src]
        oh, pt, pb = same_pad(h, k, s)
        ow, pl, pr = same_pad(w, k, s)
        shape[name] = (cout, oh, ow)
        L.append({'name': name, 'type': 'conv', 'in': [src], 'cin': cin, 'out': [cout, oh, ow], 'k': k, 'stride': s,
                  'pad': [pt, pb, pl, pr], 'bn': bn, 'relu': relu, 'weights': cout * cin * k * k, 'bias': cout,
                  'bnParams': 4 * cout if bn else 0, 'macs': cout * oh * ow * cin * k * k, 'site': True})

    def add(name, a, b):
        assert shape[a] == shape[b], (a, b)
        shape[name] = shape[a]
        L.append({'name': name, 'type': 'add', 'in': [a, b], 'out': list(shape[a]), 'relu': True, 'site': False})

    conv('conv1', 'input', f, 3, 1, True, True)
    # Pilha 1: atalho identidade.
    conv('s1a', 'conv1', f, 3, 1, True, True)
    conv('s1b', 's1a', f, 3, 1, True, False)
    add('s1add', 'conv1', 's1b')
    # Pilhas 2 e 3: o caminho principal reduz pela metade (passo 2) e o atalho é uma convolução 1 x 1 de passo 2, sem BN.
    prev = 's1add'
    for i, c in ((2, 2 * f), (3, 4 * f)):
        conv(f's{i}a', prev, c, 3, 2, True, True)
        conv(f's{i}b', f's{i}a', c, 3, 1, True, False)
        conv(f's{i}sc', prev, c, 1, 2, False, False)
        add(f's{i}add', f's{i}sc', f's{i}b')
        prev = f's{i}add'
    c, h, w = shape[prev]
    shape['pool'] = (c, 1, 1)
    L.append({'name': 'pool', 'type': 'avgpool', 'in': [prev], 'out': [c, 1, 1], 'size': h, 'site': False})
    L.append({'name': 'fc', 'type': 'dense', 'in': ['pool'], 'cin': c, 'out': [10], 'relu': False, 'bn': False,
              'weights': 10 * c, 'bias': 10, 'bnParams': 0, 'macs': 10 * c, 'site': True})
    return L


def totals(L):
    w = [l for l in L if 'weights' in l]
    return {
        'sites': sum(1 for l in L if l['site']),
        'weights': sum(l['weights'] for l in w),
        'biases': sum(l['bias'] for l in w),
        'bnParams': sum(l['bnParams'] for l in w),
        'macs': sum(l['macs'] for l in w),
    }


def check_h5(path, L):
    """Confere filtros, núcleos, passos e o total de valores com o .h5 oficial."""
    import h5py
    h = h5py.File(path, 'r')
    cfg = json.loads(h.attrs['model_config'])
    convs = [l['config'] for l in cfg['config']['layers'] if l['class_name'] == 'Conv2D']
    dense = [l['config'] for l in cfg['config']['layers'] if l['class_name'] == 'Dense']
    # Ordem do Keras: conv1, s1a, s1b, s2a, s2b, s2sc, s3a, s3b, s3sc (a mesma desta tabela).
    mine = [l for l in L if l['type'] == 'conv']
    assert len(convs) == len(mine), (len(convs), len(mine))
    for c, l in zip(convs, mine):
        got = (c['filters'], tuple(c['kernel_size']), tuple(c['strides']), c['padding'])
        want = (l['out'][0], (l['k'], l['k']), (l['stride'], l['stride']), 'same')
        assert got == want, (l['name'], got, want)
    assert len(dense) == 1 and dense[0]['units'] == 10

    def count(g):
        return sum(v.size if isinstance(v, h5py.Dataset) else count(v) for v in g.values())
    T = totals(L)
    n = count(h['model_weights'])
    assert n == T['weights'] + T['biases'] + T['bnParams'], (n, T)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--h5')
    a = ap.parse_args()
    L = layers()
    T = totals(L)
    assert T['weights'] + T['biases'] + T['bnParams'] == 78666, T
    assert T['weights'] + T['biases'] == 77706 and T['macs'] == 12501632 and T['sites'] == 10, T
    if a.json:
        json.dump({'layers': L, 'totals': T}, sys.stdout, indent=1)
        print()
        return
    g = lambda n: f'{n:,}'.replace(',', ' ')  # noqa: E731
    print('| camada | tipo | entrada | saída | k / passo | borda (c, b, e, d) | pesos + vieses | multiplicações |')
    print('|---|---|---|---|---|---|---|---|')
    for l in L:
        out = '×'.join(map(str, l['out']))
        if l['type'] in ('conv', 'dense'):
            ks = f"{l.get('k', 1)} / {l.get('stride', 1)}"
            pad = ', '.join(map(str, l['pad'])) if 'pad' in l else ''
            print(f"| {l['name']} | {l['type']}{' + BN' if l['bn'] else ''}{' + ReLU' if l['relu'] else ''} | {' + '.join(l['in'])} | {out} | {ks} | {pad} | {g(l['weights'])} + {l['bias']} | {g(l['macs'])} |")
        else:
            extra = f"{l['size']} × {l['size']}" if l['type'] == 'avgpool' else 'ReLU depois'
            print(f"| {l['name']} | {l['type']} | {' + '.join(l['in'])} | {out} | {extra} | | | |")
    print()
    print(f"camadas com pesos (sítios da busca): {T['sites']}; pesos {g(T['weights'])}, vieses {T['biases']}, "
          f"valores do BN no .h5 {T['bnParams']}, total do .h5 {g(T['weights'] + T['biases'] + T['bnParams'])}; "
          f"multiplicações por imagem {g(T['macs'])}")
    if a.h5:
        print(f'confere com {a.h5}: {check_h5(a.h5, L)} valores, filtros, núcleos e passos iguais')


if __name__ == '__main__':
    main()
