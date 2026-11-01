# Etapa 7: análise das correções do viés e do ganho

Fonte: results/nn-search/etapa7 (84 casos, validação inteira, limite de 1 ponto). "Ganho sobre nenhuma" é a economia menos a da busca sem correção no mesmo caso (modelo, objetivo e heurística); "melhor" e "pior" contam diferenças acima de 0,2 ponto.

## Por correção

| correção | casos | economia média % | ganho sobre nenhuma (p.p.) | melhor que nenhuma | pior que nenhuma | queda validação | queda teste | do teto % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| none | 12 | 10.3 | 0.00 | 0 | 0 | 0.82 | 1.41 | 25 |
| mean | 12 | 12.1 | 1.71 | 8 | 2 | 0.78 | 1.83 | 29 |
| median | 12 | 11.9 | 1.56 | 9 | 0 | 0.73 | 1.87 | 29 |
| gmean | 12 | 11.5 | 1.15 | 9 | 2 | 0.72 | 2.03 | 28 |
| trim | 12 | 12.1 | 1.76 | 9 | 2 | 0.74 | 1.97 | 29 |
| gain | 12 | 11.3 | 0.99 | 9 | 3 | 0.82 | 1.59 | 27 |
| affine | 12 | 12.5 | 2.13 | 10 | 1 | 0.77 | 1.30 | 30 |

## Economia por caso (%)

| modelo | objetivo | heurística | none | mean | median | gmean | trim | gain | affine |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| minilenet-mnist | area | h:local | 12.4 | 11.7 | 12.8 | 10.7 | 12.0 | 11.1 | 11.5 |
| minilenet-mnist | area | sensitivity | 12.9 | 10.9 | 12.9 | 12.8 | 12.9 | 12.5 | 12.9 |
| minilenet-mnist | luts | h:local | 8.9 | 13.7 | 13.7 | 12.6 | 14.0 | 14.9 | 14.6 |
| minilenet-mnist | luts | sensitivity | 12.9 | 13.0 | 14.0 | 13.5 | 14.0 | 13.8 | 14.2 |
| lenet5-fashion | area | h:local | 9.9 | 11.5 | 9.7 | 11.3 | 9.4 | 11.6 | 11.6 |
| lenet5-fashion | area | sensitivity | 9.9 | 11.2 | 10.2 | 10.5 | 10.2 | 10.2 | 11.3 |
| lenet5-fashion | luts | h:local | 10.8 | 12.8 | 12.7 | 12.7 | 12.7 | 10.2 | 13.3 |
| lenet5-fashion | luts | sensitivity | 10.4 | 10.4 | 10.4 | 12.6 | 12.9 | 10.9 | 13.4 |
| lenet5-cifar10 | area | h:local | 9.1 | 10.4 | 10.1 | 10.1 | 10.1 | 10.0 | 10.3 |
| lenet5-cifar10 | area | sensitivity | 9.6 | 10.7 | 10.4 | 10.1 | 10.7 | 10.0 | 10.8 |
| lenet5-cifar10 | luts | h:local | 9.2 | 14.0 | 12.0 | 8.0 | 12.6 | 10.8 | 11.5 |
| lenet5-cifar10 | luts | sensitivity | 8.1 | 14.3 | 13.8 | 13.0 | 13.7 | 10.0 | 14.2 |

## Leitura

1. Todas as correções aumentam a economia em média. A melhor é ganho e viés (affine): 12,5% contra 10,3% sem
   correção (+2,1 pontos), melhor em 10 dos 12 casos e pior em 1, com 30% do teto contra 25%.
2. As correções só de viés (média, mediana, média aparada) ganham de 1,6 a 1,8 ponto, mas a queda no teste sobe de
   1,4 para 1,8 a 2,0 pontos: parte do ganho é ajuste à validação. Ganho e viés tem a menor queda no teste (1,3).
3. O ganho sozinho (gain) fica atrás (+1,0 ponto) e às vezes piora (3 casos): sem o termo constante, o ajuste pela
   origem erra nos canais com deslocamento.
4. Os maiores ganhos aparecem no objetivo LUT, onde a busca sem correção ficava mais longe do teto: MiniLenet,
   busca local, de 8,9% para 14,6%; LeNet 5 CIFAR 10, sensibilidade, de 8,1% para 14,2%.
5. A média geométrica é a mais instável (de 8,0% a 13,5%) e a de maior queda no teste: não compensa.

Sugestão: ganho e viés como padrão da página e do nnbench; as outras ficam disponíveis para estudo.
