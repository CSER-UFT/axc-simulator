# Buscas das redes: 2026-10-26-01-00

Gerado por `node scripts/nnbench.mjs --models minilenet-fashion,lenet5-mnist,lenet5-fashion,lenet5-cifar10 --workers 7`. Quedas em pontos percentuais; a do limite é a da validação inteira.

## Resumo

64 casos; acima do limite na validação inteira: 0; ponto escolhido coberto: 0; fora da fronteira: não conferido nesta rodada; erros: 0.

| heurística | amostra | casos | economia média % | economia mínima % | da melhor % | abaixo de 2/3 da melhor | queda validação | queda teste | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h:local | 1000 | 8 | 11.2 | 9.1 | 97 | 0 | 0.66 | 1.38 | 45 |
| h:local | 250 | 8 | 9.4 | 0.0 | 83 | 1 | 0.30 | 0.85 | 31 |
| h:sequential | 1000 | 8 | 9.8 | 7.9 | 88 | 1 | 0.64 | 1.35 | 39 |
| h:sequential | 250 | 8 | 8.7 | 0.0 | 76 | 2 | 0.47 | 0.78 | 28 |
| sensitivity | 1000 | 8 | 10.8 | 8.1 | 94 | 0 | 0.89 | 1.46 | 82 |
| sensitivity | 250 | 8 | 9.3 | 4.1 | 87 | 1 | 0.53 | 1.13 | 44 |
| sequential | 1000 | 8 | 10.2 | 5.5 | 88 | 1 | 0.90 | 1.61 | 38 |
| sequential | 250 | 8 | 8.4 | 0.0 | 74 | 2 | 0.57 | 1.10 | 34 |

## Casos

| modelo | objetivo | amostra | heurística | limite | economia % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | fora da fronteira | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| minilenet-fashion | area | 250 | sensitivity | 1 | 9.4 | -0.80 | 0.90 | 1.60 | 87.6 | 89.5 | 116 |  |  | 3 |  | ? | 26 |
| minilenet-fashion | area | 250 | sequential | 1 | 9.6 | -1.20 | 0.60 | 1.60 | 87.6 | 89.5 | 70 |  |  | 2 |  | ? | 18 |
| minilenet-fashion | area | 250 | h:local | 1 | 9.3 | 0.40 | 0.50 | 1.80 | 87.6 | 89.5 | 4465 | 21 | 3 | 1 |  | ? | 21 |
| minilenet-fashion | area | 250 | h:sequential | 1 | 9.6 | 0.00 | 0.20 | 1.60 | 87.6 | 89.5 | 264 | 25 | 4 | 2 |  | ? | 23 |
| minilenet-fashion | area | 1000 | sensitivity | 1 | 9.4 | 1.00 | 1.00 | 1.10 | 89.5 | 89.5 | 117 |  |  | 0 |  | ? | 49 |
| minilenet-fashion | area | 1000 | sequential | 1 | 8.0 | 0.90 | 0.90 | 1.50 | 89.5 | 89.5 | 79 |  |  | 0 |  | ? | 22 |
| minilenet-fashion | area | 1000 | h:local | 1 | 9.9 | 0.70 | 0.70 | 2.10 | 89.5 | 89.5 | 3584 | 14 | 2 | 0 |  | ? | 27 |
| minilenet-fashion | area | 1000 | h:sequential | 1 | 9.7 | 0.20 | 0.20 | 1.60 | 89.5 | 89.5 | 184 | 21 | 3 | 0 |  | ? | 28 |
| minilenet-fashion | luts | 250 | sensitivity | 1 | 11.1 | 0.00 | 1.00 | 1.60 | 87.6 | 89.5 | 94 |  |  | 0 |  | ? | 19 |
| minilenet-fashion | luts | 250 | sequential | 1 | 9.7 | 0.80 | 0.70 | 1.90 | 87.6 | 89.5 | 60 |  |  | 5 |  | ? | 19 |
| minilenet-fashion | luts | 250 | h:local | 1 | 8.8 | -0.80 | 0.00 | 1.00 | 87.6 | 89.5 | 3010 | 14 | 2 | 2 |  | ? | 20 |
| minilenet-fashion | luts | 250 | h:sequential | 1 | 10.3 | 0.40 | 0.90 | 1.50 | 87.6 | 89.5 | 126 | 14 | 2 | 0 |  | ? | 14 |
| minilenet-fashion | luts | 1000 | sensitivity | 1 | 10.5 | 0.80 | 0.80 | 1.10 | 89.5 | 89.5 | 89 |  |  | 0 |  | ? | 37 |
| minilenet-fashion | luts | 1000 | sequential | 1 | 9.9 | 0.90 | 0.90 | 2.00 | 89.5 | 89.5 | 61 |  |  | 0 |  | ? | 20 |
| minilenet-fashion | luts | 1000 | h:local | 1 | 10.0 | 0.60 | 0.60 | 0.80 | 89.5 | 89.5 | 1612 | 7 | 1 | 0 |  | ? | 22 |
| minilenet-fashion | luts | 1000 | h:sequential | 1 | 10.9 | 0.50 | 0.50 | 2.40 | 89.5 | 89.5 | 86 | 7 | 1 | 0 |  | ? | 18 |
| lenet5-mnist | area | 250 | sensitivity | 1 | 13.6 | 0.80 | 0.40 | 0.40 | 99.2 | 99.4 | 145 |  |  | 0 |  | ? | 40 |
| lenet5-mnist | area | 250 | sequential | 1 | 13.6 | 0.80 | 1.00 | 0.70 | 99.2 | 99.4 | 79 |  |  | 0 |  | ? | 26 |
| lenet5-mnist | area | 250 | h:local | 1 | 13.1 | 0.00 | 0.30 | 0.20 | 99.2 | 99.4 | 5537 | 7 | 1 | 0 |  | ? | 34 |
| lenet5-mnist | area | 250 | h:sequential | 1 | 12.1 | 0.80 | 0.70 | 0.30 | 99.2 | 99.4 | 116 | 7 | 1 | 0 |  | ? | 30 |
| lenet5-mnist | area | 1000 | sensitivity | 1 | 13.2 | 1.00 | 1.00 | 1.50 | 99.4 | 99.4 | 161 |  |  | 0 |  | ? | 118 |
| lenet5-mnist | area | 1000 | sequential | 1 | 13.7 | 1.00 | 1.00 | 1.90 | 99.4 | 99.4 | 83 |  |  | 0 |  | ? | 39 |
| lenet5-mnist | area | 1000 | h:local | 1 | 15.5 | 0.30 | 0.30 | 0.50 | 99.4 | 99.4 | 7839 | 21 | 3 | 0 |  | ? | 50 |
| lenet5-mnist | area | 1000 | h:sequential | 1 | 10.9 | 0.60 | 0.60 | -0.10 | 99.4 | 99.4 | 195 | 14 | 2 | 0 |  | ? | 43 |
| lenet5-mnist | luts | 250 | sensitivity | 1 | 13.6 | 0.80 | 0.30 | 1.00 | 99.2 | 99.4 | 130 |  |  | 0 |  | ? | 44 |
| lenet5-mnist | luts | 250 | sequential | 1 | 15.4 | 0.80 | 0.90 | 0.70 | 99.2 | 99.4 | 70 |  |  | 1 |  | ? | 26 |
| lenet5-mnist | luts | 250 | h:local | 1 | 15.4 | 0.80 | 0.90 | 0.70 | 99.2 | 99.4 | 3841 | 7 | 1 | 0 |  | ? | 31 |
| lenet5-mnist | luts | 250 | h:sequential | 1 | 15.4 | 0.80 | 0.90 | 0.70 | 99.2 | 99.4 | 110 | 7 | 1 | 0 |  | ? | 23 |
| lenet5-mnist | luts | 1000 | sensitivity | 1 | 15.6 | 1.00 | 1.00 | 1.80 | 99.4 | 99.4 | 131 |  |  | 0 |  | ? | 86 |
| lenet5-mnist | luts | 1000 | sequential | 1 | 15.4 | 0.90 | 0.90 | 0.70 | 99.4 | 99.4 | 70 |  |  | 0 |  | ? | 37 |
| lenet5-mnist | luts | 1000 | h:local | 1 | 15.5 | 0.70 | 0.70 | 1.00 | 99.4 | 99.4 | 6057 | 21 | 3 | 0 |  | ? | 41 |
| lenet5-mnist | luts | 1000 | h:sequential | 1 | 7.9 | 0.60 | 0.60 | 0.50 | 99.4 | 99.4 | 214 | 21 | 3 | 0 |  | ? | 31 |
| lenet5-fashion | area | 250 | sensitivity | 1 | 7.5 | 0.00 | -0.40 | 0.40 | 90.0 | 91.6 | 132 |  |  | 10 |  | ? | 56 |
| lenet5-fashion | area | 250 | sequential | 1 | 0.0 | 0.00 | 0.00 | 0.00 | 90.0 | 91.6 | 79 |  |  | 25 |  | ? | 60 |
| lenet5-fashion | area | 250 | h:local | 1 | 0.0 | 0.00 | 0.00 | 0.00 | 90.0 | 91.6 | 8593 | 25 | 4 | 0 |  | ? | 28 |
| lenet5-fashion | area | 250 | h:sequential | 1 | 0.0 | 0.00 | 0.00 | 0.00 | 90.0 | 91.6 | 284 | 25 | 4 | 0 |  | ? | 22 |
| lenet5-fashion | area | 1000 | sensitivity | 1 | 9.9 | 1.00 | 1.00 | 0.60 | 91.6 | 91.6 | 138 |  |  | 0 |  | ? | 93 |
| lenet5-fashion | area | 1000 | sequential | 1 | 9.8 | 0.80 | 0.80 | 0.50 | 91.6 | 91.6 | 99 |  |  | 0 |  | ? | 45 |
| lenet5-fashion | area | 1000 | h:local | 1 | 9.9 | 1.00 | 1.00 | 1.20 | 91.6 | 91.6 | 3324 | 7 | 1 | 0 |  | ? | 47 |
| lenet5-fashion | area | 1000 | h:sequential | 1 | 9.5 | 0.90 | 0.90 | 1.50 | 91.6 | 91.6 | 116 | 7 | 1 | 0 |  | ? | 41 |
| lenet5-fashion | luts | 250 | sensitivity | 1 | 4.1 | 0.00 | 0.60 | 0.40 | 90.0 | 91.6 | 104 |  |  | 9 |  | ? | 41 |
| lenet5-fashion | luts | 250 | sequential | 1 | 0.7 | 0.00 | -0.10 | 0.30 | 90.0 | 91.6 | 76 |  |  | 12 |  | ? | 35 |
| lenet5-fashion | luts | 250 | h:local | 1 | 10.8 | 0.80 | 0.90 | 0.60 | 90.0 | 91.6 | 2641 | 7 | 1 | 0 |  | ? | 28 |
| lenet5-fashion | luts | 250 | h:sequential | 1 | 11.1 | 0.40 | 0.60 | 0.70 | 90.0 | 91.6 | 157 | 14 | 2 | 0 |  | ? | 28 |
| lenet5-fashion | luts | 1000 | sensitivity | 1 | 10.4 | 1.00 | 1.00 | 2.00 | 91.6 | 91.6 | 109 |  |  | 0 |  | ? | 73 |
| lenet5-fashion | luts | 1000 | sequential | 1 | 5.5 | 1.00 | 1.00 | 0.90 | 91.6 | 91.6 | 76 |  |  | 0 |  | ? | 33 |
| lenet5-fashion | luts | 1000 | h:local | 1 | 10.8 | 0.90 | 0.90 | 0.60 | 91.6 | 91.6 | 2349 | 7 | 1 | 0 |  | ? | 42 |
| lenet5-fashion | luts | 1000 | h:sequential | 1 | 11.1 | 1.00 | 1.00 | 1.00 | 91.6 | 91.6 | 107 | 7 | 1 | 0 |  | ? | 39 |
| lenet5-cifar10 | area | 250 | sensitivity | 1 | 9.1 | 0.00 | 0.40 | 2.10 | 71.6 | 69.0 | 146 |  |  | 4 |  | ? | 69 |
| lenet5-cifar10 | area | 250 | sequential | 1 | 9.8 | 0.80 | 0.70 | 2.70 | 71.6 | 69.0 | 92 |  |  | 0 |  | ? | 37 |
| lenet5-cifar10 | area | 250 | h:local | 1 | 9.5 | -0.80 | 0.00 | 0.90 | 71.6 | 69.0 | 3490 | 7 | 1 | 0 |  | ? | 47 |
| lenet5-cifar10 | area | 250 | h:sequential | 1 | 3.3 | 0.80 | 0.40 | 0.30 | 71.6 | 69.0 | 252 | 21 | 3 | 0 |  | ? | 43 |
| lenet5-cifar10 | area | 1000 | sensitivity | 1 | 9.6 | 0.80 | 0.80 | 2.10 | 69.0 | 69.0 | 143 |  |  | 0 |  | ? | 126 |
| lenet5-cifar10 | area | 1000 | sequential | 1 | 9.8 | 0.80 | 0.80 | 4.00 | 69.0 | 69.0 | 92 |  |  | 0 |  | ? | 56 |
| lenet5-cifar10 | area | 1000 | h:local | 1 | 9.1 | 0.70 | 0.70 | 3.00 | 69.0 | 69.0 | 4005 | 14 | 2 | 0 |  | ? | 72 |
| lenet5-cifar10 | area | 1000 | h:sequential | 1 | 9.2 | 0.90 | 0.90 | 2.10 | 69.0 | 69.0 | 115 | 7 | 1 | 0 |  | ? | 55 |
| lenet5-cifar10 | luts | 250 | sensitivity | 1 | 6.2 | -0.80 | 1.00 | 1.50 | 71.6 | 69.0 | 102 |  |  | 4 |  | ? | 52 |
| lenet5-cifar10 | luts | 250 | sequential | 1 | 8.0 | -0.40 | 0.80 | 0.90 | 71.6 | 69.0 | 73 |  |  | 5 |  | ? | 49 |
| lenet5-cifar10 | luts | 250 | h:local | 1 | 7.9 | 0.00 | -0.20 | 1.60 | 71.6 | 69.0 | 3558 | 14 | 2 | 0 |  | ? | 42 |
| lenet5-cifar10 | luts | 250 | h:sequential | 1 | 7.8 | 0.00 | 0.10 | 1.10 | 71.6 | 69.0 | 135 | 21 | 3 | 0 |  | ? | 37 |
| lenet5-cifar10 | luts | 1000 | sensitivity | 1 | 8.1 | 0.50 | 0.50 | 1.50 | 69.0 | 69.0 | 102 |  |  | 0 |  | ? | 77 |
| lenet5-cifar10 | luts | 1000 | sequential | 1 | 9.4 | 0.90 | 0.90 | 1.40 | 69.0 | 69.0 | 75 |  |  | 0 |  | ? | 48 |
| lenet5-cifar10 | luts | 1000 | h:local | 1 | 9.2 | 0.40 | 0.40 | 1.80 | 69.0 | 69.0 | 1079 | 7 | 1 | 0 |  | ? | 59 |
| lenet5-cifar10 | luts | 1000 | h:sequential | 1 | 9.2 | 0.40 | 0.40 | 1.80 | 69.0 | 69.0 | 105 | 7 | 1 | 0 |  | ? | 55 |
