# Resultados dos estudos de caso

Gerado por `scripts/experiments.mjs` em 2026-10-17 (commit 956c4f2, Node v22.22.0); biblioteca sintetizada de 2026-10-16 (sky130_fd_sc_hd, tt_025C_1v80). Período de 5 ns, fluxo de atraso mínimo, 2 portas por banco, salvo indicação. A metodologia e as limitações estão em `docs/METODOLOGIA.md`.

### E1. Precisão do modelo estático de erro

72 casos (kernel, entrada e família de unidades) com saída de várias posições; razão entre o MSE estimado e o medido na execução bit a bit.

#### E1: razão entre o MSE estimado e o medido

| Modelo | Erro mediano (fator) | Dentro de 10% | Dentro de 25% | Dentro de 2 vezes | Pior caso (fator) | Com pipeline, dentro de 10% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| analítico | 1,22× | 33% | 57% | 88% | 5,9× | 35% |
| por amostras | 1,03× | 79% | 90% | 99% | 3,8× | 98% |

#### E1: os cinco casos de maior desvio do modelo por amostras

| Kernel | Entrada | Unidades | MSE medido | Analítico | Por amostras |
| --- | --- | --- | ---: | ---: | ---: |
| gauss-seq | uniformes | ADD TRUNC3 | 0,0487 | 3,48× | 3,85× |
| gauss-seq | imagem | MUL DRUM6 + ADD LOA6 | 1,1271 | 0,68× | 0,54× |
| gauss-seq | imagem | ADD SEG L4 P2 | 457,6409 | 1,02× | 1,73× |
| gauss-seq | imagem | ADD TRUNC3 | 0,1943 | 0,89× | 1,65× |
| gauss-seq | uniformes | MUL KUL | 24,3406 | 1,42× | 1,52× |

#### E1: produto escalar (uma saída): erro medido e viés estimado

| Entrada | Unidades | Erro medido | Viés analítico | Viés por amostras |
| --- | --- | ---: | ---: | ---: |
| imagem | MUL DRUM4 | 34806 | 34806 | 34732 |
| imagem | MUL T4 | -3670 | -3670 | -3671 |
| imagem | MUL T6 +C | -4438 | -4438 | -4446 |
| imagem | MUL MITCHELL | -74326 | -74326 | -74354 |
| imagem | MUL KUL | -54930 | -54930 | -54960 |
| imagem | ADD LOA4 | 183 | 93 | 93 |
| imagem | ADD TRUNC3 | -366 | -1323 | -1323 |
| imagem | ADD SEG L4 P2 | -178272 | -157536 | -157678 |
| imagem | MUL DRUM6 + ADD LOA6 | 25767 | 23445 | 24341 |
| uniformes | MUL DRUM4 | 16743 | 16743 | 16618 |
| uniformes | MUL T4 | -3126 | -3126 | -3127 |
| uniformes | MUL T6 +C | -214 | -214 | -219 |
| uniformes | MUL MITCHELL | -152508 | -152508 | -152586 |
| uniformes | MUL KUL | -182646 | -182646 | -182861 |
| uniformes | ADD LOA4 | 297 | 177 | 177 |
| uniformes | ADD TRUNC3 | -662 | -1468 | -1468 |
| uniformes | ADD SEG L4 P2 | -119248 | -134096 | -134227 |
| uniformes | MUL DRUM6 + ADD LOA6 | 25961 | 25385 | 25601 |

### E2. Heurísticas de exploração

Objetivo: área ASIC; restrição: PSNR mínimo (estimado na busca, conferido bit a bit no ponto escolhido). Economia em relação ao projeto exato; "-" quando a heurística não roda (exaustiva por operação) ou nenhum ponto passa na verificação.

#### E2: economia de área do ponto escolhido (PSNR medido)

| Kernel | Grupos | PSNR mín. | Sequencial | Eficiência | Exaustiva | Aleatória |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| gauss | classe | 30 | 36,4% (33,4) | 37,3% (32,0) | 36,4% (33,4) | 32,2% (38,1) |
| gauss | classe | 40 | 31,4% (40,2) | 31,4% (40,2) | 31,4% (40,2) | 31,4% (40,2) |
| gauss | classe | 50 | 21,0% (51,2) | 21,0% (51,2) | 21,0% (51,2) | 20,0% (52,1) |
| gauss | operação | 30 | 38,9% (30,9) | 49,4% (32,2) | - | 22,2% (37,1) |
| gauss | operação | 40 | 28,1% (40,7) | 39,3% (40,6) | - | 9,2% (41,8) |
| gauss | operação | 50 | 13,4% (50,0) | 25,4% (50,6) | - | 8,2% (51,3) |
| sobel | classe | 30 | 2,9% (38,9) | 2,9% (38,9) | 2,9% (38,9) | 2,9% (38,9) |
| sobel | classe | 40 | 2,2% (44,7) | 2,2% (44,7) | 2,2% (44,7) | 2,2% (44,7) |
| sobel | classe | 50 | 1,8% (50,9) | 1,8% (50,9) | 1,8% (50,9) | 1,8% (50,9) |
| sobel | operação | 30 | 5,5% (30,2) | 5,5% (31,0) | 5,5% (30,9) | 3,9% (30,8) |
| sobel | operação | 40 | 4,4% (41,6) | 4,4% (42,2) | 4,4% (42,1) | 3,2% (41,6) |
| sobel | operação | 50 | 2,0% (50,2) | 2,5% (51,2) | 2,5% (51,8) | 1,9% (51,7) |
| sharpen | classe | 30 | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) |
| sharpen | classe | 40 | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) |
| sharpen | classe | 50 | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) |
| sharpen | operação | 30 | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) |
| sharpen | operação | 40 | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) |
| sharpen | operação | 50 | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) | 7,2% (∞) |
| fir | classe | 50 | 46,7% (54,0) | 46,7% (54,0) | 46,7% (54,0) | 36,2% (54,3) |
| fir | classe | 60 | 36,3% (60,1) | 36,0% (60,9) | 36,3% (60,1) | 32,3% (60,7) |
| fir | classe | 70 | 24,4% (72,4) | 24,4% (72,4) | 24,8% (70,5) | 24,8% (70,5) |
| fir | operação | 50 | 64,7% (50,1) | 68,5% (50,1) | - | 32,1% (50,1) |
| fir | operação | 60 | 49,3% (60,0) | 52,9% (60,0) | - | 0,0% (∞) |
| fir | operação | 70 | 36,2% (70,1) | 38,4% (70,0) | - | 0,0% (∞) |

#### E2: avaliações e tempo (média por configuração)

| Heurística | Grupos | Avaliações | Tempo (s) |
| --- | --- | ---: | ---: |
| Sequencial | classe | 31 | 0,2 |
| Sequencial | operação | 189 | 1,0 |
| Eficiência | classe | 182 | 1,1 |
| Eficiência | operação | 2735 | 16,5 |
| Exaustiva | classe | 378 | 2,4 |
| Exaustiva | operação | 1184 | 6,3 |
| Aleatória | classe | 74 | 0,4 |
| Aleatória | operação | 153 | 0,8 |

Verificação: o primeiro ponto (o mais barato estimado como viável) passou na execução bit a bit em 89 de 90 casos; nos outros, a busca verificou em média 20,0 pontos até achar um que passa (no máximo 20).

Eficiência contra sequencial: melhor em 9 de 24 configurações, igual em 14, pior em 1; maior ganho 17,3% de área a menos que a sequencial.

### E3. Fronteiras de Pareto verificadas

Área contra PSNR, com restrição frouxa (20 dB) para a fronteira cobrir a faixa toda; todos os pontos verificados bit a bit. A última coluna conta, no limite de 40 dB, os pontos que o modelo aceita e a medida rejeita, e o contrário.

#### E3: PSNR estimado contra medido ao longo da fronteira

| Kernel | Grupos | Heurística | Pontos | Verificados | Diferença média (dB) | Maior diferença (dB) | Erros de decisão a 40 dB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| gauss | classe | exaustiva | 26 | 25 | 0,22 | 1,64 | 0 / 0 |
| gauss | operação | eficiência | 78 | 70 | 0,22 | 4,61 | 0 / 1 |
| fir | classe | exaustiva | 37 | 36 | 0,00 | 0,00 | 0 / 0 |
| sobel | operação | eficiência | 30 | 27 | 0,20 | 0,76 | 0 / 0 |

### E4. Diretivas e período junto com as unidades

Gaussiano, PSNR de pelo menos 40 dB, grupos por classe, heurística de eficiência; variantes: cada diretiva ligada ou desligada e os períodos de 2,5, 5 e 10 ns.

#### E4: melhor ponto verificado por objetivo

| Objetivo | Variante | Área (µm²) | Energia (nJ) | Latência (µs) | PSNR medido | Unidades |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ponderado | diretivas do código, 2.5 ns | 18191 | 2064 | 183,8 | 40,2 | 3 × MUL8 T8 +C + 4 × ADD16 LOA6 |
| latência | diretivas do código, 2.5 ns | 23012 | 2373 | 183,8 | 52,9 | 3 × MUL8 KUL6 + 4 × ADD16 TRUNC2 |
| área | sem pipeline (linha 12), 2.5 ns | 5731 | 9709 | 3700,7 | 43,8 | 1 × MUL8 T6 + 1 × ADD16 LOA8 |

### E5. Sensibilidade aos dados de entrada

O projeto escolhido (exaustiva por classe, área, PSNR de pelo menos 40 dB) com um conjunto de dados, verificado no outro.

#### E5: o projeto otimizado com um conjunto de dados, medido no outro

| Kernel | Otimizado com | Economia de área | PSNR nos mesmos dados | PSNR nos outros dados | Mantém 40 dB |
| --- | --- | ---: | ---: | ---: | --- |
| gauss | uniformes | 34,2% | 41,6 | 39,7 | não |
| gauss | imagem | 31,4% | 40,2 | 41,5 | sim |
| sobel | uniformes | 2,9% | 40,1 | 38,9 | não |
| sobel | imagem | 2,2% | 44,7 | 45,5 | sim |
| sharpen | uniformes | 7,2% | ∞ | ∞ | sim |
| sharpen | imagem | 7,2% | ∞ | ∞ | sim |

Tempo total: 499 s.

