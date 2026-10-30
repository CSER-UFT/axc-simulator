# Buscas das redes: depois

Gerado por `node scripts/nnbench.mjs --workers 1 --id depois`. Quedas em pontos percentuais; a do limite é a da validação inteira.

## Resumo

16 casos; acima do limite na validação inteira: 0; ponto escolhido coberto: 0; fora da fronteira: não conferido nesta rodada; erros: 0.

| heurística | amostra | casos | economia média % | economia mínima % | da melhor % | do teto % | abaixo de 2/3 da melhor | queda validação | queda teste | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h:local | 1000 | 2 | 10.7 | 8.9 | 83 |  | 0 | 0.90 | 1.30 | 42 |
| h:local | 250 | 2 | 11.3 | 10.5 | 89 |  | 0 | 0.45 | 0.95 | 22 |
| h:sequential | 1000 | 2 | 11.5 | 11.4 | 89 |  | 0 | 0.60 | 0.55 | 42 |
| h:sequential | 250 | 2 | 11.7 | 10.4 | 92 |  | 0 | 0.75 | 1.00 | 25 |
| sensitivity | 1000 | 2 | 12.9 | 12.9 | 100 |  | 0 | 0.85 | 0.75 | 53 |
| sensitivity | 250 | 2 | 11.6 | 10.8 | 92 |  | 0 | 0.70 | 0.50 | 24 |
| sequential | 1000 | 2 | 11.5 | 10.3 | 89 |  | 0 | 1.00 | 1.25 | 22 |
| sequential | 250 | 2 | 11.1 | 10.7 | 88 |  | 0 | 0.90 | 1.25 | 20 |

## Casos

| modelo | objetivo | amostra | heurística | limite | economia % | teto % | do teto % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | fora da fronteira | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| minilenet-mnist | area | 250 | sensitivity | 1 | 12.5 |  |  | 0.80 | 0.50 | 0.70 | 99.2 | 99.3 | 120 |  |  | 0 |  | ? | 24 |
| minilenet-mnist | area | 250 | sequential | 1 | 10.7 |  |  | 1.20 | 1.00 | 1.30 | 99.2 | 99.3 | 59 |  |  | 9 |  | ? | 26 |
| minilenet-mnist | area | 250 | h:local | 1 | 12.1 |  |  | 0.80 | 0.50 | 0.90 | 99.2 | 99.3 | 2856 | 1 | 1 | 0 |  | ? | 23 |
| minilenet-mnist | area | 250 | h:sequential | 1 | 10.4 |  |  | 0.40 | 0.50 | 0.10 | 99.2 | 99.3 | 177 | 7 | 2 | 0 |  | ? | 27 |
| minilenet-mnist | area | 1000 | sensitivity | 1 | 12.9 |  |  | 1.00 | 1.00 | 1.00 | 99.3 | 99.3 | 114 |  |  | 0 |  | ? | 56 |
| minilenet-mnist | area | 1000 | sequential | 1 | 10.3 |  |  | 1.00 | 1.00 | 0.90 | 99.3 | 99.3 | 60 |  |  | 0 |  | ? | 23 |
| minilenet-mnist | area | 1000 | h:local | 1 | 12.4 |  |  | 0.80 | 0.80 | 1.30 | 99.3 | 99.3 | 3022 | 2 | 1 | 0 |  | ? | 44 |
| minilenet-mnist | area | 1000 | h:sequential | 1 | 11.4 |  |  | 0.30 | 0.30 | 0.60 | 99.3 | 99.3 | 95 | 1 | 1 | 0 |  | ? | 38 |
| minilenet-mnist | luts | 250 | sensitivity | 1 | 10.8 |  |  | 0.80 | 0.90 | 0.30 | 99.2 | 99.3 | 101 |  |  | 2 |  | ? | 23 |
| minilenet-mnist | luts | 250 | sequential | 1 | 11.5 |  |  | 0.80 | 0.80 | 1.20 | 99.2 | 99.3 | 46 |  |  | 0 |  | ? | 14 |
| minilenet-mnist | luts | 250 | h:local | 1 | 10.5 |  |  | 0.80 | 0.40 | 1.00 | 99.2 | 99.3 | 3373 | 16 | 3 | 0 |  | ? | 20 |
| minilenet-mnist | luts | 250 | h:sequential | 1 | 12.9 |  |  | 0.80 | 1.00 | 1.90 | 99.2 | 99.3 | 163 | 15 | 3 | 1 |  | ? | 22 |
| minilenet-mnist | luts | 1000 | sensitivity | 1 | 12.9 |  |  | 0.70 | 0.70 | 0.50 | 99.3 | 99.3 | 97 |  |  | 0 |  | ? | 50 |
| minilenet-mnist | luts | 1000 | sequential | 1 | 12.6 |  |  | 1.00 | 1.00 | 1.60 | 99.3 | 99.3 | 43 |  |  | 0 |  | ? | 21 |
| minilenet-mnist | luts | 1000 | h:local | 1 | 8.9 |  |  | 1.00 | 1.00 | 1.30 | 99.3 | 99.3 | 5669 | 20 | 4 | 0 |  | ? | 41 |
| minilenet-mnist | luts | 1000 | h:sequential | 1 | 11.6 |  |  | 0.90 | 0.90 | 0.50 | 99.3 | 99.3 | 202 | 18 | 3 | 0 |  | ? | 46 |
