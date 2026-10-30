# Buscas das redes: antes

Rodado no commit baebedf, antes das correções da amostra (primeiras imagens de cada classe) e do reparo (desfazer as
últimas trocas). Nesta versão do relatório, a coluna "coberto" da busca híbrida contava também pontos só estimados
(não é confiável nessas linhas), e "classificações" é o número de pontos avaliados.

Gerado por `node scripts/nnbench.mjs --workers 1 --id antes`. Quedas em pontos percentuais; a do limite é a da validação inteira.

## Resumo

16 casos; acima do limite na validação inteira: 0; ponto escolhido coberto: 3; fora da fronteira: não conferido nesta rodada; erros: 0.

| heurística | amostra | casos | economia média % | economia mínima % | da melhor % | do teto % | abaixo de 2/3 da melhor | queda validação | queda teste | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h:local | 1000 | 2 | 10.7 | 8.9 | 83 |  | 0 | 0.90 | 1.30 | 42 |
| h:local | 250 | 2 | 10.9 | 10.8 | 89 |  | 0 | 0.50 | 0.85 | 26 |
| h:sequential | 1000 | 2 | 7.6 | 4.2 | 59 |  | 1 | 0.70 | 0.45 | 38 |
| h:sequential | 250 | 2 | 7.0 | 1.2 | 55 |  | 1 | 0.40 | 0.50 | 28 |
| sensitivity | 1000 | 2 | 12.9 | 12.9 | 100 |  | 0 | 0.85 | 0.75 | 55 |
| sensitivity | 250 | 2 | 11.3 | 10.7 | 92 |  | 0 | 0.95 | 1.10 | 33 |
| sequential | 1000 | 2 | 11.5 | 10.3 | 89 |  | 0 | 1.00 | 1.25 | 22 |
| sequential | 250 | 2 | 0.0 | 0.0 | 0 |  | 2 | 0.00 | 0.00 | 19 |

## Casos

| modelo | objetivo | amostra | heurística | limite | economia % | teto % | do teto % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | fora da fronteira | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| minilenet-mnist | area | 250 | sensitivity | 1 | 11.9 |  |  | 0.40 | 0.90 | 1.60 | 100.0 | 99.3 | 116 |  |  | 4 |  | ? | 31 |
| minilenet-mnist | area | 250 | sequential | 1 | 0.0 |  |  | 0.00 | 0.00 | 0.00 | 100.0 | 99.3 | 51 |  |  | 8 |  | ? | 20 |
| minilenet-mnist | area | 250 | h:local | 1 | 10.8 |  |  | 0.40 | 0.30 | 0.50 | 100.0 | 99.3 | 2824 | 10 |  | 1 |  | ? | 24 |
| minilenet-mnist | area | 250 | h:sequential | 1 | 1.2 |  |  | 0.80 | -0.20 | 0.10 | 100.0 | 99.3 | 95 | 20 |  | 13 |  | ? | 36 |
| minilenet-mnist | area | 1000 | sensitivity | 1 | 12.9 |  |  | 1.00 | 1.00 | 1.00 | 99.3 | 99.3 | 114 |  |  | 0 |  | ? | 58 |
| minilenet-mnist | area | 1000 | sequential | 1 | 10.3 |  |  | 1.00 | 1.00 | 0.90 | 99.3 | 99.3 | 60 |  |  | 0 |  | ? | 23 |
| minilenet-mnist | area | 1000 | h:local | 1 | 12.4 |  |  | 0.80 | 0.80 | 1.30 | 99.3 | 99.3 | 3022 | 2 |  | 0 |  | ? | 41 |
| minilenet-mnist | area | 1000 | h:sequential | 1 | 11.0 |  |  | 0.50 | 0.50 | 0.50 | 99.3 | 99.3 | 95 | 1 |  | 0 | sim | ? | 37 |
| minilenet-mnist | luts | 250 | sensitivity | 1 | 10.7 |  |  | 0.80 | 1.00 | 0.60 | 100.0 | 99.3 | 100 |  |  | 6 |  | ? | 35 |
| minilenet-mnist | luts | 250 | sequential | 1 | 0.0 |  |  | 0.00 | 0.00 | 0.00 | 100.0 | 99.3 | 47 |  |  | 6 |  | ? | 19 |
| minilenet-mnist | luts | 250 | h:local | 1 | 11.0 |  |  | 0.80 | 0.70 | 1.20 | 100.0 | 99.3 | 2219 | 10 |  | 3 |  | ? | 28 |
| minilenet-mnist | luts | 250 | h:sequential | 1 | 12.7 |  |  | 0.80 | 1.00 | 0.90 | 100.0 | 99.3 | 88 | 4 |  | 1 |  | ? | 20 |
| minilenet-mnist | luts | 1000 | sensitivity | 1 | 12.9 |  |  | 0.70 | 0.70 | 0.50 | 99.3 | 99.3 | 97 |  |  | 0 |  | ? | 53 |
| minilenet-mnist | luts | 1000 | sequential | 1 | 12.6 |  |  | 1.00 | 1.00 | 1.60 | 99.3 | 99.3 | 43 |  |  | 0 |  | ? | 22 |
| minilenet-mnist | luts | 1000 | h:local | 1 | 8.9 |  |  | 1.00 | 1.00 | 1.30 | 99.3 | 99.3 | 2748 | 18 |  | 0 | sim | ? | 44 |
| minilenet-mnist | luts | 1000 | h:sequential | 1 | 4.2 |  |  | 0.90 | 0.90 | 0.40 | 99.3 | 99.3 | 88 | 11 |  | 0 | sim | ? | 38 |
