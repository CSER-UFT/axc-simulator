# Buscas das redes: cifar

Gerado por `node scripts/nnbench.mjs --workers 1 --id cifar --models lenet5-cifar10 --objectives area --samples 0,250 --heuristics sensitivity,h:local,h:sequential`. Quedas em pontos percentuais; a do limite é a da validação inteira.

| modelo | objetivo | amostra | heurística | limite | economia % | queda amostra | queda validação | queda teste | exata amostra % | exata validação % | pontos | verificados | rodadas | reparos | coberto | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lenet5-cifar10 | area | 1000 | sensitivity | 1 | 9.6 | 0.80 | 0.80 | 2.10 | 69.0 | 69.0 | 143 |  |  | 0 |  | 135 |
| lenet5-cifar10 | area | 1000 | h:local | 1 | 9.1 | 0.70 | 0.70 | 3.00 | 69.0 | 69.0 | 4005 | 10 | 2 | 0 |  | 141 |
| lenet5-cifar10 | area | 1000 | h:sequential | 1 | 9.2 | 0.90 | 0.90 | 2.10 | 69.0 | 69.0 | 115 | 1 | 1 | 0 |  | 100 |
| lenet5-cifar10 | area | 250 | sensitivity | 1 | 9.1 | 0.00 | 0.40 | 2.10 | 71.6 | 69.0 | 146 |  |  | 4 |  | 74 |
| lenet5-cifar10 | area | 250 | h:local | 1 | 9.5 | -0.80 | 0.00 | 0.90 | 71.6 | 69.0 | 3490 | 4 | 1 | 0 |  | 56 |
| lenet5-cifar10 | area | 250 | h:sequential | 1 | 3.3 | 0.80 | 0.40 | 0.30 | 71.6 | 69.0 | 252 | 18 | 3 | 0 |  | 60 |
