# Buscas das redes: etapa22

Gerado por `node scripts/nnbench.mjs --models resnet8-cifar10 --objectives area,luts --samples 1000 --heuristics h:local,h:efficiency --val 5000 --workers 14 --id etapa22`. Quedas em pontos percentuais; a do limite é a da validação inteira.

## Resumo

4 casos; acima do limite na validação inteira: 0; ponto escolhido coberto: 0; fora da fronteira: 0; erros: 0.

| heurística | amostra | viés | casos | economia média % | economia mínima % | da melhor % | do teto % | abaixo de 2/3 da melhor | queda validação | queda teste | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h:efficiency | 1000 | affine | 2 | 8.7 | 8.4 | 100 | 21 | 0 | 0.67 | 0.90 | 2941 |
| h:local | 1000 | affine | 2 | 8.4 | 7.8 | 96 | 21 | 0 | 0.84 | 0.95 | 3069 |

## Casos

| modelo | objetivo | amostra | heurística | viés | limite | economia % | teto % | do teto % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | fora da fronteira | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| resnet8-cifar10 | area | 1000 | h:local | affine | 1 | 9.0 | 37.8 | 24 | 0.10 | 0.88 | 0.70 | 88.0 | 87.2 | 13619 | 14 | 1 | 3 |  |  | 3375 |
| resnet8-cifar10 | area | 1000 | h:efficiency | affine | 1 | 9.0 | 37.8 | 24 | 0.10 | 0.88 | 0.70 | 88.0 | 87.2 | 10787 | 14 | 1 | 3 |  |  | 3369 |
| resnet8-cifar10 | luts | 1000 | h:local | affine | 1 | 7.8 | 43.6 | 18 | 0.50 | 0.80 | 1.20 | 88.0 | 87.2 | 7235 | 14 | 1 | 4 |  |  | 2763 |
| resnet8-cifar10 | luts | 1000 | h:efficiency | affine | 1 | 8.4 | 43.6 | 19 | 0.60 | 0.46 | 1.10 | 88.0 | 87.2 | 5073 | 14 | 1 | 1 |  |  | 2513 |
