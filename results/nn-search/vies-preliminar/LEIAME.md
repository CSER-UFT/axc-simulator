# Correção do viés: medições preliminares (MiniLenet MNIST)

Medições da etapa 6, antes da comparação completa da etapa 7. Validação inteira, limite de 1 ponto, objetivo área,
1 worker.

## Busca

| correção | híbrida local: economia | queda validação | queda teste | verificados | sensibilidade: economia | queda validação | queda teste |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| nenhuma | 12,4% | 0,80 | 1,30 | 2 | 12,9% | 1,00 | 1,00 |
| média | 11,7% | 0,70 | 0,70 | 14 | 10,9% | 0,90 | 0,60 |
| mediana | 12,8% | 0,90 | 0,90 | 7 | 12,9% | 1,00 | 1,50 |
| média geométrica | 10,7% | 0,70 | 0,80 | 18 | 12,8% | 1,00 | 1,40 |
| média aparada | 12,0% | 0,40 | 0,50 | 4 | 12,9% | 1,00 | 1,50 |

## A mesma unidade em todas as camadas

Erro RMS da pré-ativação da conv2 sem e com a correção pela média, e acurácia na validação inteira (exata: 99,3%).

| unidade | erro sem | erro com | acurácia sem | média | mediana | média geométrica | média aparada |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MUL8 T4 | 86 | 70 | 99,5 | 99,4 | 99,5 | 99,4 | 99,4 |
| MUL8 T6 | 439 | 372 | 99,0 | 99,0 | 99,1 | 99,1 | 99,0 |
| MUL8 T8 | 1635 | 1418 | 96,8 | 97,4 | 97,1 | 97,2 | 97,7 |
| MUL8 T10 | 4571 | 4083 | 39,5 | 18,3 | 19,4 | 10,4 | 17,7 |
| MUL8 DRUM4 | 867 | 825 | 99,1 | 99,0 | 98,9 | 98,9 | 99,0 |
| MUL8 MITCHELL | 594 | 554 | 99,4 | 99,2 | 99,5 | 99,2 | 99,3 |
| MUL8 T6 A4c | 1699 | 1539 | 98,0 | 98,7 | 98,9 | 99,0 | 98,9 |
| ADD32 LOA10 | 1343 | 1296 | 98,4 | 98,2 | 97,9 | 97,6 | 98,0 |
| ADD32 TRUNC6 | 916 | 534 | 98,9 | 98,4 | 98,5 | 98,8 | 98,4 |
| ADD32 TRUNC8 | 3846 | 2220 | 82,0 | 81,1 | 83,4 | 89,5 | 81,4 |
| ADD32 TRUNC10 | 15678 | 9061 | 13,5 | 19,0 | 18,9 | 16,9 | 18,7 |

Leitura: a correção tira a parte constante do erro (de 5% a 42% do RMS; quase metade nos somadores truncados), mas
a acurácia quase não muda, e com o MUL8 T10 piora. O erro destas unidades é em boa parte proporcional ao sinal
(um multiplicador truncado perde uma fração do produto), e descontar um valor fixo do viés desloca também as saídas
pequenas, que a ReLU zeraria. Uma correção de ganho (multiplicar a reescala de cada canal, m em Q32, pela razão entre
a pré-ativação exata e a aproximada) trataria esse tipo de erro, também sem custo de hardware.
