# Buscas das redes: etapa7

Comparação das correções do viés e do ganho (etapa 7): MiniLenet MNIST, LeNet 5 Fashion MNIST e LeNet 5 CIFAR 10; área e LUT; validação inteira; busca híbrida local e sensibilidade; 1 worker, em duas partes (etapa7-a e etapa7-b).

Gerado por `node scripts/nnbench.mjs --workers 1 --models minilenet-mnist,lenet5-fashion,lenet5-cifar10 --objectives area,luts --samples 0 --heuristics h:local,sensitivity --biasfix none,mean,median,gmean,trim,gain,affine`. Quedas em pontos percentuais; a do limite é a da validação inteira.

## Resumo

84 casos; acima do limite na validação inteira: 0; ponto escolhido coberto: 0; fora da fronteira: 0; erros: 0.

| heurística | amostra | viés | casos | economia média % | economia mínima % | da melhor % | do teto % | abaixo de 2/3 da melhor | queda validação | queda teste | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h:local | 1000 | affine | 6 | 12.1 | 10.3 | 94 | 29 | 0 | 0.60 | 0.98 | 104 |
| h:local | 1000 | gain | 6 | 11.4 | 10.0 | 88 | 28 | 0 | 0.90 | 1.60 | 101 |
| h:local | 1000 | gmean | 6 | 10.9 | 8.0 | 85 | 26 | 1 | 0.57 | 1.83 | 111 |
| h:local | 1000 | mean | 6 | 12.3 | 10.4 | 95 | 30 | 0 | 0.75 | 1.85 | 100 |
| h:local | 1000 | median | 6 | 11.8 | 9.7 | 91 | 29 | 0 | 0.67 | 1.45 | 107 |
| h:local | 1000 | none | 6 | 10.1 | 8.9 | 78 | 25 | 2 | 0.80 | 1.53 | 86 |
| h:local | 1000 | trim | 6 | 11.8 | 9.4 | 91 | 28 | 0 | 0.48 | 1.20 | 102 |
| sensitivity | 1000 | affine | 6 | 12.8 | 10.8 | 99 | 31 | 0 | 0.93 | 1.62 | 108 |
| sensitivity | 1000 | gain | 6 | 11.2 | 10.0 | 87 | 27 | 0 | 0.75 | 1.58 | 101 |
| sensitivity | 1000 | gmean | 6 | 12.1 | 10.1 | 93 | 29 | 0 | 0.88 | 2.23 | 119 |
| sensitivity | 1000 | mean | 6 | 11.8 | 10.4 | 91 | 28 | 0 | 0.82 | 1.80 | 114 |
| sensitivity | 1000 | median | 6 | 12.0 | 10.2 | 92 | 29 | 0 | 0.80 | 2.28 | 112 |
| sensitivity | 1000 | none | 6 | 10.6 | 8.1 | 82 | 26 | 1 | 0.83 | 1.28 | 103 |
| sensitivity | 1000 | trim | 6 | 12.4 | 10.2 | 95 | 30 | 0 | 1.00 | 2.73 | 115 |

## Casos

| modelo | objetivo | amostra | heurística | viés | limite | economia % | teto % | do teto % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | fora da fronteira | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| minilenet-mnist | area | 1000 | h:local | none | 1 | 12.4 | 35.2 | 35 | 0.80 | 0.80 | 1.30 | 99.3 | 99.3 | 3022 | 2 | 1 | 0 |  |  | 43 |
| minilenet-mnist | area | 1000 | sensitivity | none | 1 | 12.9 | 35.2 | 37 | 1.00 | 1.00 | 1.00 | 99.3 | 99.3 | 114 |  |  | 0 |  |  | 55 |
| minilenet-mnist | area | 1000 | h:local | mean | 1 | 11.7 | 35.2 | 33 | 0.70 | 0.70 | 0.70 | 99.3 | 99.3 | 3487 | 14 | 3 | 0 |  |  | 63 |
| minilenet-mnist | area | 1000 | sensitivity | mean | 1 | 10.9 | 35.2 | 31 | 0.90 | 0.90 | 0.60 | 99.3 | 99.3 | 121 |  |  | 0 |  |  | 66 |
| minilenet-mnist | area | 1000 | h:local | median | 1 | 12.8 | 35.2 | 36 | 0.90 | 0.90 | 0.90 | 99.3 | 99.3 | 3211 | 7 | 2 | 0 |  |  | 52 |
| minilenet-mnist | area | 1000 | sensitivity | median | 1 | 12.9 | 35.2 | 37 | 1.00 | 1.00 | 1.50 | 99.3 | 99.3 | 118 |  |  | 0 |  |  | 60 |
| minilenet-mnist | area | 1000 | h:local | gmean | 1 | 10.7 | 35.2 | 30 | 0.70 | 0.70 | 0.80 | 99.3 | 99.3 | 5186 | 18 | 3 | 0 |  |  | 63 |
| minilenet-mnist | area | 1000 | sensitivity | gmean | 1 | 12.8 | 35.2 | 36 | 1.00 | 1.00 | 1.40 | 99.3 | 99.3 | 126 |  |  | 0 |  |  | 77 |
| minilenet-mnist | area | 1000 | h:local | trim | 1 | 12.0 | 35.2 | 34 | 0.40 | 0.40 | 0.50 | 99.3 | 99.3 | 2602 | 4 | 1 | 0 |  |  | 56 |
| minilenet-mnist | area | 1000 | sensitivity | trim | 1 | 12.9 | 35.2 | 37 | 1.00 | 1.00 | 1.50 | 99.3 | 99.3 | 120 |  |  | 0 |  |  | 65 |
| minilenet-mnist | area | 1000 | h:local | gain | 1 | 11.1 | 35.2 | 31 | 0.60 | 0.60 | 0.70 | 99.3 | 99.3 | 3966 | 9 | 2 | 0 |  |  | 59 |
| minilenet-mnist | area | 1000 | sensitivity | gain | 1 | 12.5 | 35.2 | 35 | 0.90 | 0.90 | 1.20 | 99.3 | 99.3 | 121 |  |  | 0 |  |  | 69 |
| minilenet-mnist | area | 1000 | h:local | affine | 1 | 11.5 | 35.2 | 33 | 0.10 | 0.10 | 0.20 | 99.3 | 99.3 | 2955 | 4 | 1 | 0 |  |  | 53 |
| minilenet-mnist | area | 1000 | sensitivity | affine | 1 | 12.9 | 35.2 | 37 | 0.80 | 0.80 | 1.70 | 99.3 | 99.3 | 121 |  |  | 0 |  |  | 63 |
| minilenet-mnist | luts | 1000 | h:local | none | 1 | 8.9 | 46.0 | 19 | 1.00 | 1.00 | 1.30 | 99.3 | 99.3 | 5669 | 20 | 4 | 0 |  |  | 44 |
| minilenet-mnist | luts | 1000 | sensitivity | none | 1 | 12.9 | 46.0 | 28 | 0.70 | 0.70 | 0.50 | 99.3 | 99.3 | 97 |  |  | 0 |  |  | 58 |
| minilenet-mnist | luts | 1000 | h:local | mean | 1 | 13.7 | 46.0 | 30 | 0.90 | 0.90 | 1.20 | 99.3 | 99.3 | 2747 | 3 | 1 | 0 |  |  | 48 |
| minilenet-mnist | luts | 1000 | sensitivity | mean | 1 | 13.0 | 46.0 | 28 | 0.70 | 0.70 | 1.10 | 99.3 | 99.3 | 101 |  |  | 0 |  |  | 54 |
| minilenet-mnist | luts | 1000 | h:local | median | 1 | 13.7 | 46.0 | 30 | 1.00 | 1.00 | 1.00 | 99.3 | 99.3 | 2733 | 1 | 1 | 0 |  |  | 49 |
| minilenet-mnist | luts | 1000 | sensitivity | median | 1 | 14.0 | 46.0 | 31 | 0.80 | 0.80 | 0.80 | 99.3 | 99.3 | 105 |  |  | 0 |  |  | 61 |
| minilenet-mnist | luts | 1000 | h:local | gmean | 1 | 12.6 | 46.0 | 27 | 0.90 | 0.90 | 1.10 | 99.3 | 99.3 | 4047 | 9 | 2 | 0 |  |  | 51 |
| minilenet-mnist | luts | 1000 | sensitivity | gmean | 1 | 13.5 | 46.0 | 29 | 0.90 | 0.90 | 1.50 | 99.3 | 99.3 | 101 |  |  | 0 |  |  | 58 |
| minilenet-mnist | luts | 1000 | h:local | trim | 1 | 14.0 | 46.0 | 30 | 1.00 | 1.00 | 2.00 | 99.3 | 99.3 | 2212 | 2 | 1 | 0 |  |  | 46 |
| minilenet-mnist | luts | 1000 | sensitivity | trim | 1 | 14.0 | 46.0 | 30 | 1.00 | 1.00 | 1.80 | 99.3 | 99.3 | 104 |  |  | 0 |  |  | 58 |
| minilenet-mnist | luts | 1000 | h:local | gain | 1 | 14.9 | 46.0 | 32 | 0.90 | 0.90 | 0.70 | 99.3 | 99.3 | 3472 | 11 | 2 | 0 |  |  | 56 |
| minilenet-mnist | luts | 1000 | sensitivity | gain | 1 | 13.8 | 46.0 | 30 | 1.00 | 1.00 | 1.50 | 99.3 | 99.3 | 100 |  |  | 0 |  |  | 57 |
| minilenet-mnist | luts | 1000 | h:local | affine | 1 | 14.6 | 46.0 | 32 | 0.90 | 0.90 | 0.30 | 99.3 | 99.3 | 2804 | 3 | 1 | 0 |  |  | 46 |
| minilenet-mnist | luts | 1000 | sensitivity | affine | 1 | 14.2 | 46.0 | 31 | 1.00 | 1.00 | 0.60 | 99.3 | 99.3 | 102 |  |  | 0 |  |  | 56 |
| lenet5-fashion | area | 1000 | h:local | none | 1 | 9.9 | 36.7 | 27 | 1.00 | 1.00 | 1.20 | 91.6 | 91.6 | 3324 | 4 | 1 | 0 |  |  | 86 |
| lenet5-fashion | area | 1000 | sensitivity | none | 1 | 9.9 | 36.7 | 27 | 1.00 | 1.00 | 0.60 | 91.6 | 91.6 | 138 |  |  | 0 |  |  | 113 |
| lenet5-fashion | area | 1000 | h:local | mean | 1 | 11.5 | 36.7 | 31 | 0.70 | 0.70 | 1.80 | 91.6 | 91.6 | 3689 | 1 | 1 | 0 |  |  | 100 |
| lenet5-fashion | area | 1000 | sensitivity | mean | 1 | 11.2 | 36.7 | 31 | 0.90 | 0.90 | 2.50 | 91.6 | 91.6 | 165 |  |  | 0 |  |  | 161 |
| lenet5-fashion | area | 1000 | h:local | median | 1 | 9.7 | 36.7 | 26 | 0.90 | 0.90 | 1.00 | 91.6 | 91.6 | 3833 | 1 | 1 | 0 |  |  | 103 |
| lenet5-fashion | area | 1000 | sensitivity | median | 1 | 10.2 | 36.7 | 28 | 0.90 | 0.90 | 3.10 | 91.6 | 91.6 | 173 |  |  | 0 |  |  | 158 |
| lenet5-fashion | area | 1000 | h:local | gmean | 1 | 11.3 | 36.7 | 31 | 1.00 | 1.00 | 3.70 | 91.6 | 91.6 | 3573 | 4 | 1 | 0 |  |  | 116 |
| lenet5-fashion | area | 1000 | sensitivity | gmean | 1 | 10.5 | 36.7 | 29 | 1.00 | 1.00 | 2.50 | 91.6 | 91.6 | 166 |  |  | 0 |  |  | 146 |
| lenet5-fashion | area | 1000 | h:local | trim | 1 | 9.4 | 36.7 | 26 | 0.30 | 0.30 | 0.20 | 91.6 | 91.6 | 3661 | 1 | 1 | 0 |  |  | 100 |
| lenet5-fashion | area | 1000 | sensitivity | trim | 1 | 10.2 | 36.7 | 28 | 1.00 | 1.00 | 2.60 | 91.6 | 91.6 | 176 |  |  | 0 |  |  | 175 |
| lenet5-fashion | area | 1000 | h:local | gain | 1 | 11.6 | 36.7 | 31 | 1.00 | 1.00 | 2.20 | 91.6 | 91.6 | 3444 | 2 | 1 | 0 |  |  | 106 |
| lenet5-fashion | area | 1000 | sensitivity | gain | 1 | 10.2 | 36.7 | 28 | 0.40 | 0.40 | 1.80 | 91.6 | 91.6 | 145 |  |  | 0 |  |  | 127 |
| lenet5-fashion | area | 1000 | h:local | affine | 1 | 11.6 | 36.7 | 32 | 1.00 | 1.00 | 2.10 | 91.6 | 91.6 | 3839 | 2 | 1 | 0 |  |  | 109 |
| lenet5-fashion | area | 1000 | sensitivity | affine | 1 | 11.3 | 36.7 | 31 | 0.90 | 0.90 | 0.90 | 91.6 | 91.6 | 155 |  |  | 0 |  |  | 134 |
| lenet5-fashion | luts | 1000 | h:local | none | 1 | 10.8 | 46.9 | 23 | 0.90 | 0.90 | 0.60 | 91.6 | 91.6 | 2349 | 6 | 1 | 0 |  |  | 87 |
| lenet5-fashion | luts | 1000 | sensitivity | none | 1 | 10.4 | 46.9 | 22 | 1.00 | 1.00 | 2.00 | 91.6 | 91.6 | 109 |  |  | 0 |  |  | 96 |
| lenet5-fashion | luts | 1000 | h:local | mean | 1 | 12.8 | 46.9 | 27 | 0.70 | 0.70 | 1.50 | 91.6 | 91.6 | 3566 | 7 | 2 | 0 |  |  | 97 |
| lenet5-fashion | luts | 1000 | sensitivity | mean | 1 | 10.4 | 46.9 | 22 | 1.00 | 1.00 | 0.90 | 91.6 | 91.6 | 125 |  |  | 0 |  |  | 102 |
| lenet5-fashion | luts | 1000 | h:local | median | 1 | 12.7 | 46.9 | 27 | 1.00 | 1.00 | 1.80 | 91.6 | 91.6 | 2748 | 7 | 2 | 0 |  |  | 94 |
| lenet5-fashion | luts | 1000 | sensitivity | median | 1 | 10.4 | 46.9 | 22 | 0.80 | 0.80 | 0.70 | 91.6 | 91.6 | 122 |  |  | 0 |  |  | 100 |
| lenet5-fashion | luts | 1000 | h:local | gmean | 1 | 12.7 | 46.9 | 27 | 1.00 | 1.00 | 1.20 | 91.6 | 91.6 | 2328 | 2 | 1 | 0 |  |  | 89 |
| lenet5-fashion | luts | 1000 | sensitivity | gmean | 1 | 12.6 | 46.9 | 27 | 0.90 | 0.90 | 2.20 | 91.6 | 91.6 | 124 |  |  | 0 |  |  | 110 |
| lenet5-fashion | luts | 1000 | h:local | trim | 1 | 12.7 | 46.9 | 27 | 1.00 | 1.00 | 0.80 | 91.6 | 91.6 | 2695 | 5 | 1 | 0 |  |  | 95 |
| lenet5-fashion | luts | 1000 | sensitivity | trim | 1 | 12.9 | 46.9 | 27 | 1.00 | 1.00 | 2.10 | 91.6 | 91.6 | 128 |  |  | 0 |  |  | 107 |
| lenet5-fashion | luts | 1000 | h:local | gain | 1 | 10.2 | 46.9 | 22 | 1.00 | 1.00 | 1.10 | 91.6 | 91.6 | 4026 | 12 | 2 | 0 |  |  | 107 |
| lenet5-fashion | luts | 1000 | sensitivity | gain | 1 | 10.9 | 46.9 | 23 | 1.00 | 1.00 | 0.90 | 91.6 | 91.6 | 121 |  |  | 0 |  |  | 96 |
| lenet5-fashion | luts | 1000 | h:local | affine | 1 | 13.3 | 46.9 | 28 | 1.00 | 1.00 | 1.40 | 91.6 | 91.6 | 2746 | 3 | 1 | 0 |  |  | 82 |
| lenet5-fashion | luts | 1000 | sensitivity | affine | 1 | 13.4 | 46.9 | 29 | 0.90 | 0.90 | 2.00 | 91.6 | 91.6 | 126 |  |  | 0 |  |  | 101 |
| lenet5-cifar10 | area | 1000 | h:local | none | 1 | 9.1 | 37.3 | 24 | 0.70 | 0.70 | 3.00 | 69.0 | 69.0 | 4005 | 10 | 2 | 0 |  |  | 147 |
| lenet5-cifar10 | area | 1000 | sensitivity | none | 1 | 9.6 | 37.3 | 26 | 0.80 | 0.80 | 2.10 | 69.0 | 69.0 | 143 |  |  | 0 |  |  | 190 |
| lenet5-cifar10 | area | 1000 | h:local | mean | 1 | 10.4 | 37.3 | 28 | 0.90 | 0.90 | 4.00 | 69.0 | 69.0 | 2196 | 5 | 1 | 0 |  |  | 157 |
| lenet5-cifar10 | area | 1000 | sensitivity | mean | 1 | 10.7 | 37.3 | 29 | 0.60 | 0.60 | 4.30 | 69.0 | 69.0 | 147 |  |  | 0 |  |  | 166 |
| lenet5-cifar10 | area | 1000 | h:local | median | 1 | 10.1 | 37.3 | 27 | 0.40 | 0.40 | 2.30 | 69.0 | 69.0 | 4514 | 9 | 2 | 0 |  |  | 162 |
| lenet5-cifar10 | area | 1000 | sensitivity | median | 1 | 10.4 | 37.3 | 28 | 0.70 | 0.70 | 2.50 | 69.0 | 69.0 | 151 |  |  | 0 |  |  | 161 |
| lenet5-cifar10 | area | 1000 | h:local | gmean | 1 | 10.1 | 37.3 | 27 | 0.20 | 0.20 | 3.70 | 69.0 | 69.0 | 3092 | 4 | 1 | 0 |  |  | 161 |
| lenet5-cifar10 | area | 1000 | sensitivity | gmean | 1 | 10.1 | 37.3 | 27 | 0.80 | 0.80 | 2.50 | 69.0 | 69.0 | 157 |  |  | 0 |  |  | 183 |
| lenet5-cifar10 | area | 1000 | h:local | trim | 1 | 10.1 | 37.3 | 27 | 0.30 | 0.30 | 2.20 | 69.0 | 69.0 | 4230 | 8 | 2 | 0 |  |  | 167 |
| lenet5-cifar10 | area | 1000 | sensitivity | trim | 1 | 10.7 | 37.3 | 29 | 1.00 | 1.00 | 5.00 | 69.0 | 69.0 | 149 |  |  | 0 |  |  | 151 |
| lenet5-cifar10 | area | 1000 | h:local | gain | 1 | 10.0 | 37.3 | 27 | 1.00 | 1.00 | 2.10 | 69.0 | 69.0 | 3270 | 2 | 1 | 0 |  |  | 135 |
| lenet5-cifar10 | area | 1000 | sensitivity | gain | 1 | 10.0 | 37.3 | 27 | 0.70 | 0.70 | 1.60 | 69.0 | 69.0 | 145 |  |  | 0 |  |  | 148 |
| lenet5-cifar10 | area | 1000 | h:local | affine | 1 | 10.3 | 37.3 | 28 | 0.90 | 0.90 | 1.90 | 69.0 | 69.0 | 3174 | 5 | 1 | 0 |  |  | 148 |
| lenet5-cifar10 | area | 1000 | sensitivity | affine | 1 | 10.8 | 37.3 | 29 | 1.00 | 1.00 | 2.20 | 69.0 | 69.0 | 148 |  |  | 0 |  |  | 155 |
| lenet5-cifar10 | luts | 1000 | h:local | none | 1 | 9.2 | 48.7 | 19 | 0.40 | 0.40 | 1.80 | 69.0 | 69.0 | 1079 | 2 | 1 | 0 |  |  | 110 |
| lenet5-cifar10 | luts | 1000 | sensitivity | none | 1 | 8.1 | 48.7 | 17 | 0.50 | 0.50 | 1.50 | 69.0 | 69.0 | 102 |  |  | 0 |  |  | 106 |
| lenet5-cifar10 | luts | 1000 | h:local | mean | 1 | 14.0 | 48.7 | 29 | 0.60 | 0.60 | 1.90 | 69.0 | 69.0 | 2294 | 7 | 2 | 0 |  |  | 138 |
| lenet5-cifar10 | luts | 1000 | sensitivity | mean | 1 | 14.3 | 48.7 | 29 | 0.80 | 0.80 | 1.40 | 69.0 | 69.0 | 124 |  |  | 0 |  |  | 136 |
| lenet5-cifar10 | luts | 1000 | h:local | median | 1 | 12.0 | 48.7 | 25 | -0.20 | -0.20 | 1.70 | 69.0 | 69.0 | 4222 | 18 | 3 | 0 |  |  | 183 |
| lenet5-cifar10 | luts | 1000 | sensitivity | median | 1 | 13.8 | 48.7 | 28 | 0.60 | 0.60 | 5.10 | 69.0 | 69.0 | 120 |  |  | 0 |  |  | 135 |
| lenet5-cifar10 | luts | 1000 | h:local | gmean | 1 | 8.0 | 48.7 | 16 | -0.40 | -0.40 | 0.50 | 69.0 | 69.0 | 4923 | 19 | 4 | 0 |  |  | 188 |
| lenet5-cifar10 | luts | 1000 | sensitivity | gmean | 1 | 13.0 | 48.7 | 27 | 0.70 | 0.70 | 3.30 | 69.0 | 69.0 | 121 |  |  | 0 |  |  | 140 |
| lenet5-cifar10 | luts | 1000 | h:local | trim | 1 | 12.6 | 48.7 | 26 | -0.10 | -0.10 | 1.50 | 69.0 | 69.0 | 2309 | 7 | 2 | 0 |  |  | 145 |
| lenet5-cifar10 | luts | 1000 | sensitivity | trim | 1 | 13.7 | 48.7 | 28 | 1.00 | 1.00 | 3.40 | 69.0 | 69.0 | 120 |  |  | 0 |  |  | 131 |
| lenet5-cifar10 | luts | 1000 | h:local | gain | 1 | 10.8 | 48.7 | 22 | 0.90 | 0.90 | 2.80 | 69.0 | 69.0 | 2818 | 8 | 2 | 0 |  |  | 142 |
| lenet5-cifar10 | luts | 1000 | sensitivity | gain | 1 | 10.0 | 48.7 | 21 | 0.50 | 0.50 | 2.50 | 69.0 | 69.0 | 119 |  |  | 0 |  |  | 110 |
| lenet5-cifar10 | luts | 1000 | h:local | affine | 1 | 11.5 | 48.7 | 24 | -0.30 | -0.30 | 0.00 | 69.0 | 69.0 | 3679 | 19 | 4 | 0 |  |  | 186 |
| lenet5-cifar10 | luts | 1000 | sensitivity | affine | 1 | 14.2 | 48.7 | 29 | 1.00 | 1.00 | 2.30 | 69.0 | 69.0 | 124 |  |  | 0 |  |  | 142 |
