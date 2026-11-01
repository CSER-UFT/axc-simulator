# Buscas das redes: etapa7-b

Gerado por `node scripts/nnbench.mjs --report etapa7-b`. Quedas em pontos percentuais; a do limite é a da validação inteira.

## Resumo

28 casos; acima do limite na validação inteira: 0; ponto escolhido coberto: 0; fora da fronteira: 0; erros: 0.

| heurística | amostra | viés | casos | economia média % | economia mínima % | da melhor % | do teto % | abaixo de 2/3 da melhor | queda validação | queda teste | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h:local | 1000 | affine | 2 | 10.9 | 10.3 | 88 | 26 | 0 | 0.30 | 0.95 | 167 |
| h:local | 1000 | gain | 2 | 10.4 | 10.0 | 84 | 25 | 0 | 0.95 | 2.45 | 139 |
| h:local | 1000 | gmean | 2 | 9.0 | 8.0 | 75 | 22 | 1 | -0.10 | 2.10 | 175 |
| h:local | 1000 | mean | 2 | 12.2 | 10.4 | 97 | 28 | 0 | 0.75 | 2.95 | 147 |
| h:local | 1000 | median | 2 | 11.0 | 10.1 | 89 | 26 | 0 | 0.10 | 2.00 | 173 |
| h:local | 1000 | none | 2 | 9.1 | 9.1 | 74 | 22 | 1 | 0.55 | 2.40 | 129 |
| h:local | 1000 | trim | 2 | 11.3 | 10.1 | 91 | 26 | 0 | 0.10 | 1.85 | 156 |
| sensitivity | 1000 | affine | 2 | 12.5 | 10.8 | 100 | 29 | 0 | 1.00 | 2.25 | 148 |
| sensitivity | 1000 | gain | 2 | 10.0 | 10.0 | 81 | 24 | 0 | 0.60 | 2.05 | 129 |
| sensitivity | 1000 | gmean | 2 | 11.6 | 10.1 | 92 | 27 | 0 | 0.75 | 2.90 | 161 |
| sensitivity | 1000 | mean | 2 | 12.5 | 10.7 | 100 | 29 | 0 | 0.70 | 2.85 | 151 |
| sensitivity | 1000 | median | 2 | 12.1 | 10.4 | 96 | 28 | 0 | 0.65 | 3.80 | 148 |
| sensitivity | 1000 | none | 2 | 8.8 | 8.1 | 73 | 21 | 1 | 0.65 | 1.80 | 148 |
| sensitivity | 1000 | trim | 2 | 12.2 | 10.7 | 98 | 28 | 0 | 1.00 | 4.20 | 141 |

## Casos

| modelo | objetivo | amostra | heurística | viés | limite | economia % | teto % | do teto % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | fora da fronteira | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
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
