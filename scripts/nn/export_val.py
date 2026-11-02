#!/usr/bin/env python3
"""
Exporta a validação inteira (as 5000 imagens que scripts/nn/train.py separa do treino, 500 de cada classe) sem treinar
de novo, para a linha de comando e o nnbench (node bin/axc.mjs nnsearch --val 5000). A página continua com o
subconjunto de 1000 (100 de cada classe).

    python3 scripts/nn/export_val.py <base> <pasta da base> [--seed 1] [--out data/nn]

    base: mnist | fashion | cifar10 (a mesma pasta e o mesmo formato do train.py)

A separação depende só da semente e dos rótulos de treino (split_validation do train.py), então é a mesma do treino.
Antes de gravar, o script confere que as 100 primeiras imagens de cada classe são exatamente as do arquivo de 1000 já
gravado (data/nn/<base>-val1000.bin); se não forem (outra semente, outra versão da base), para sem gravar.

Grava data/nn/<base>-val5000.bin no mesmo formato do de 1000 (os rótulos e depois as imagens C x H x W em uint8), na
ordem original das imagens de treino. As duas redes de cada base (MiniLenet e LeNet 5) usam o mesmo arquivo; no MNIST,
a MiniLenet veio do código C da UPV, treinada em outro lugar, e pode ter visto essas imagens no treino (a mesma
ressalva da validação de 1000).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import DATASETS, first_per_class, load_dataset, split_validation, write_subset  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dataset', choices=list(DATASETS))
    ap.add_argument('folder')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', default='data/nn')
    args = ap.parse_args()
    tr_x, tr_y, _, _ = load_dataset(args.dataset, args.folder)
    idx = split_validation(tr_y, args.seed)
    va_x, va_y = tr_x[idx], tr_y[idx]
    print(f'{DATASETS[args.dataset]["name"]}: {len(va_y)} imagens de validação ({np.bincount(va_y).tolist()} por classe)')

    # Conferência com o arquivo de 1000 já gravado pelo train.py.
    small = os.path.join(args.out, f'{args.dataset}-val1000.bin')
    if not os.path.exists(small):
        sys.exit(f'não achei {small}: rode o train.py antes, ou confira --out')
    sel = first_per_class(va_y)
    want = va_y[sel].astype(np.uint8).tobytes() + np.ascontiguousarray(va_x[sel], dtype=np.uint8).tobytes()
    with open(small, 'rb') as f:
        have = f.read()
    if have != want:
        sys.exit(f'as 1000 imagens de {small} não são as desta separação (semente {args.seed}?): nada foi gravado')
    print(f'conferido: as 100 primeiras de cada classe são as de {small}')

    path = os.path.join(args.out, f'{args.dataset}-val{len(va_y)}.bin')
    write_subset(path, va_x, va_y)
    print(f'gravado em {path} ({os.path.getsize(path)} bytes)')


if __name__ == '__main__':
    main()
