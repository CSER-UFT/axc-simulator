# Buscas das redes: etapa9

Etapa 9: validação de 5000 imagens, sem correção e com ganho e viés, 7 workers.

Gerado por `node scripts/nnbench.mjs --models minilenet-mnist,lenet5-mnist,minilenet-fashion,lenet5-fashion,minilenet-cifar10,lenet5-cifar10 --objectives area,luts --samples 0 --val 5000 --heuristics h:local,sensitivity --biasfix none,affine --workers 7 --id etapa9 --note Etapa 9: validação de 5000 imagens, sem correção e com ganho e viés, 7 workers.`. Quedas em pontos percentuais; a do limite é a da validação inteira.

## Resumo

48 casos; acima do limite na validação inteira: 0; ponto escolhido coberto: 0; fora da fronteira: 0; erros: 0.

| heurística | amostra | viés | casos | economia média % | economia mínima % | da melhor % | do teto % | abaixo de 2/3 da melhor | queda validação | queda teste | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h:local | 5000 | affine | 12 | 10.9 | 0.0 | 90 | 27 | 1 | 0.68 | 0.76 | 150 |
| h:local | 5000 | none | 12 | 9.8 | 0.0 | 80 | 24 | 2 | 0.69 | 0.76 | 134 |
| sensitivity | 5000 | affine | 12 | 12.0 | 9.5 | 97 | 29 | 0 | 0.89 | 1.09 | 377 |
| sensitivity | 5000 | none | 12 | 10.7 | 5.5 | 86 | 26 | 2 | 0.86 | 1.02 | 382 |

## Casos

| modelo | objetivo | amostra | heurística | viés | limite | economia % | teto % | do teto % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | fora da fronteira | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| minilenet-mnist | area | 5000 | h:local | none | 1 | 12.0 | 35.2 | 34 | 1.00 | 1.00 | 0.80 | 99.3 | 99.3 | 2943 | 7 | 1 | 0 |  |  | 74 |
| minilenet-mnist | area | 5000 | sensitivity | none | 1 | 12.5 | 35.2 | 35 | 0.94 | 0.94 | 0.70 | 99.3 | 99.3 | 125 |  |  | 0 |  |  | 255 |
| minilenet-mnist | area | 5000 | h:local | affine | 1 | 12.7 | 35.2 | 36 | 0.88 | 0.88 | 0.80 | 99.3 | 99.3 | 2927 | 7 | 1 | 0 |  |  | 78 |
| minilenet-mnist | area | 5000 | sensitivity | affine | 1 | 12.6 | 35.2 | 36 | 1.00 | 1.00 | 1.30 | 99.3 | 99.3 | 128 |  |  | 0 |  |  | 232 |
| minilenet-mnist | luts | 5000 | h:local | none | 1 | 0.0 | 46.0 | 0 | 0.00 | 0.00 | 0.00 | 99.3 | 99.3 | 4499 | 25 | 4 | 0 |  |  | 63 |
| minilenet-mnist | luts | 5000 | sensitivity | none | 1 | 13.7 | 46.0 | 30 | 0.92 | 0.92 | 0.40 | 99.3 | 99.3 | 105 |  |  | 0 |  |  | 192 |
| minilenet-mnist | luts | 5000 | h:local | affine | 1 | 14.7 | 46.0 | 32 | 0.92 | 0.92 | 0.40 | 99.3 | 99.3 | 2323 | 7 | 1 | 0 |  |  | 73 |
| minilenet-mnist | luts | 5000 | sensitivity | affine | 1 | 13.5 | 46.0 | 29 | 0.86 | 0.86 | 1.80 | 99.3 | 99.3 | 105 |  |  | 0 |  |  | 210 |
| lenet5-mnist | area | 5000 | h:local | none | 1 | 14.0 | 36.9 | 38 | 0.94 | 0.94 | 0.50 | 99.2 | 99.2 | 6334 | 14 | 2 | 0 |  |  | 161 |
| lenet5-mnist | area | 5000 | sensitivity | none | 1 | 14.1 | 36.9 | 38 | 0.96 | 0.96 | 1.20 | 99.2 | 99.2 | 141 |  |  | 0 |  |  | 481 |
| lenet5-mnist | area | 5000 | h:local | affine | 1 | 13.4 | 36.9 | 36 | 0.24 | 0.24 | 0.00 | 99.2 | 99.2 | 4110 | 7 | 1 | 0 |  |  | 168 |
| lenet5-mnist | area | 5000 | sensitivity | affine | 1 | 13.9 | 36.9 | 38 | 1.00 | 1.00 | 0.50 | 99.2 | 99.2 | 139 |  |  | 0 |  |  | 427 |
| lenet5-mnist | luts | 5000 | h:local | none | 1 | 15.3 | 46.9 | 33 | 0.62 | 0.62 | 0.40 | 99.2 | 99.2 | 4812 | 25 | 4 | 0 |  |  | 114 |
| lenet5-mnist | luts | 5000 | sensitivity | none | 1 | 15.5 | 46.9 | 33 | 0.90 | 0.90 | 1.20 | 99.2 | 99.2 | 127 |  |  | 0 |  |  | 365 |
| lenet5-mnist | luts | 5000 | h:local | affine | 1 | 0.0 | 46.9 | 0 | 0.00 | 0.00 | 0.00 | 99.2 | 99.2 | 9191 | 25 | 4 | 0 |  |  | 136 |
| lenet5-mnist | luts | 5000 | sensitivity | affine | 1 | 16.5 | 46.9 | 35 | 0.76 | 0.76 | 0.80 | 99.2 | 99.2 | 128 |  |  | 0 |  |  | 394 |
| minilenet-fashion | area | 5000 | h:local | none | 1 | 9.8 | 35.1 | 28 | 0.74 | 0.74 | 1.30 | 89.1 | 89.1 | 2696 | 7 | 1 | 0 |  |  | 80 |
| minilenet-fashion | area | 5000 | sensitivity | none | 1 | 9.9 | 35.1 | 28 | 0.92 | 0.92 | 1.50 | 89.1 | 89.1 | 112 |  |  | 0 |  |  | 186 |
| minilenet-fashion | area | 5000 | h:local | affine | 1 | 9.6 | 35.1 | 27 | 0.80 | 0.80 | 1.60 | 89.1 | 89.1 | 2833 | 7 | 1 | 0 |  |  | 86 |
| minilenet-fashion | area | 5000 | sensitivity | affine | 1 | 9.5 | 35.1 | 27 | 0.94 | 0.94 | 1.10 | 89.1 | 89.1 | 120 |  |  | 0 |  |  | 194 |
| minilenet-fashion | luts | 5000 | h:local | none | 1 | 10.0 | 45.9 | 22 | 0.58 | 0.58 | 0.80 | 89.1 | 89.1 | 1891 | 7 | 1 | 0 |  |  | 67 |
| minilenet-fashion | luts | 5000 | sensitivity | none | 1 | 9.8 | 45.9 | 21 | 0.86 | 0.86 | 1.20 | 89.1 | 89.1 | 89 |  |  | 0 |  |  | 146 |
| minilenet-fashion | luts | 5000 | h:local | affine | 1 | 12.0 | 45.9 | 26 | 1.00 | 1.00 | 1.20 | 89.1 | 89.1 | 2455 | 7 | 1 | 0 |  |  | 79 |
| minilenet-fashion | luts | 5000 | sensitivity | affine | 1 | 10.4 | 45.9 | 23 | 0.94 | 0.94 | 2.20 | 89.1 | 89.1 | 93 |  |  | 0 |  |  | 153 |
| lenet5-fashion | area | 5000 | h:local | none | 1 | 9.8 | 36.7 | 27 | 0.96 | 0.96 | 0.70 | 91.3 | 91.3 | 4876 | 14 | 2 | 0 |  |  | 201 |
| lenet5-fashion | area | 5000 | sensitivity | none | 1 | 10.1 | 36.7 | 28 | 0.80 | 0.80 | 1.10 | 91.3 | 91.3 | 156 |  |  | 0 |  |  | 674 |
| lenet5-fashion | area | 5000 | h:local | affine | 1 | 11.0 | 36.7 | 30 | 0.94 | 0.94 | 2.00 | 91.3 | 91.3 | 3618 | 7 | 1 | 0 |  |  | 182 |
| lenet5-fashion | area | 5000 | sensitivity | affine | 1 | 10.7 | 36.7 | 29 | 0.94 | 0.94 | 1.20 | 91.3 | 91.3 | 156 |  |  | 0 |  |  | 605 |
| lenet5-fashion | luts | 5000 | h:local | none | 1 | 11.5 | 46.9 | 24 | 0.98 | 0.98 | 1.60 | 91.3 | 91.3 | 1536 | 7 | 1 | 0 |  |  | 145 |
| lenet5-fashion | luts | 5000 | sensitivity | none | 1 | 10.6 | 46.9 | 23 | 0.96 | 0.96 | 1.70 | 91.3 | 91.3 | 120 |  |  | 0 |  |  | 339 |
| lenet5-fashion | luts | 5000 | h:local | affine | 1 | 13.7 | 46.9 | 29 | 0.72 | 0.72 | 1.80 | 91.3 | 91.3 | 2159 | 7 | 1 | 0 |  |  | 157 |
| lenet5-fashion | luts | 5000 | sensitivity | affine | 1 | 12.5 | 46.9 | 27 | 0.88 | 0.88 | 0.90 | 91.3 | 91.3 | 126 |  |  | 0 |  |  | 365 |
| minilenet-cifar10 | area | 5000 | h:local | none | 1 | 9.2 | 36.2 | 25 | 0.90 | 0.90 | 1.40 | 60.1 | 60.1 | 2172 | 7 | 1 | 0 |  |  | 150 |
| minilenet-cifar10 | area | 5000 | sensitivity | none | 1 | 9.2 | 36.2 | 25 | 0.60 | 0.60 | 0.30 | 60.1 | 60.1 | 114 |  |  | 0 |  |  | 495 |
| minilenet-cifar10 | area | 5000 | h:local | affine | 1 | 10.0 | 36.2 | 28 | 0.52 | 0.52 | 1.10 | 60.1 | 60.1 | 2482 | 7 | 1 | 0 |  |  | 160 |
| minilenet-cifar10 | area | 5000 | sensitivity | affine | 1 | 10.2 | 36.2 | 28 | 0.58 | 0.58 | 0.80 | 60.1 | 60.1 | 119 |  |  | 0 |  |  | 434 |
| minilenet-cifar10 | luts | 5000 | h:local | none | 1 | 8.7 | 46.1 | 19 | 0.56 | 0.56 | 0.20 | 60.1 | 60.1 | 862 | 7 | 1 | 0 |  |  | 126 |
| minilenet-cifar10 | luts | 5000 | sensitivity | none | 1 | 5.5 | 46.1 | 12 | 0.82 | 0.82 | 0.00 | 60.1 | 60.1 | 88 |  |  | 0 |  |  | 242 |
| minilenet-cifar10 | luts | 5000 | h:local | affine | 1 | 12.2 | 46.1 | 26 | 0.86 | 0.86 | 0.60 | 60.1 | 60.1 | 1604 | 7 | 1 | 0 |  |  | 140 |
| minilenet-cifar10 | luts | 5000 | sensitivity | affine | 1 | 12.3 | 46.1 | 27 | 1.00 | 1.00 | 1.70 | 60.1 | 60.1 | 95 |  |  | 0 |  |  | 325 |
| lenet5-cifar10 | area | 5000 | h:local | none | 1 | 9.2 | 37.3 | 25 | 0.58 | 0.58 | -0.30 | 70.1 | 70.1 | 3152 | 7 | 1 | 0 |  |  | 220 |
| lenet5-cifar10 | area | 5000 | sensitivity | none | 1 | 9.7 | 37.3 | 26 | 0.88 | 0.88 | 1.90 | 70.1 | 70.1 | 144 |  |  | 0 |  |  | 830 |
| lenet5-cifar10 | area | 5000 | h:local | affine | 1 | 9.4 | 37.3 | 25 | 0.74 | 0.74 | -0.20 | 70.1 | 70.1 | 3416 | 7 | 1 | 0 |  |  | 279 |
| lenet5-cifar10 | area | 5000 | sensitivity | affine | 1 | 9.7 | 37.3 | 26 | 1.00 | 1.00 | 0.60 | 70.1 | 70.1 | 161 |  |  | 0 |  |  | 793 |
| lenet5-cifar10 | luts | 5000 | h:local | none | 1 | 8.0 | 48.7 | 16 | 0.48 | 0.48 | 1.70 | 70.1 | 70.1 | 1645 | 7 | 1 | 0 |  |  | 205 |
| lenet5-cifar10 | luts | 5000 | sensitivity | none | 1 | 7.7 | 48.7 | 16 | 0.76 | 0.76 | 1.00 | 70.1 | 70.1 | 105 |  |  | 0 |  |  | 383 |
| lenet5-cifar10 | luts | 5000 | h:local | affine | 1 | 12.7 | 48.7 | 26 | 0.52 | 0.52 | -0.20 | 70.1 | 70.1 | 3099 | 14 | 2 | 0 |  |  | 256 |
| lenet5-cifar10 | luts | 5000 | sensitivity | affine | 1 | 12.8 | 48.7 | 26 | 0.78 | 0.78 | 0.20 | 70.1 | 70.1 | 123 |  |  | 0 |  |  | 398 |
