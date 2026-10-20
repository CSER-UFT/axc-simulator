# Resultados dos estudos de caso

Gerado por `scripts/experiments.mjs` em 2026-10-20 (commit ba43b7d, Node v22.22.0); biblioteca sintetizada de 2026-10-16 (sky130_fd_sc_hd, tt_025C_1v80). Período de 5 ns, fluxo de atraso mínimo, 2 portas por banco, salvo indicação. A metodologia e as limitações estão em `docs/METODOLOGIA.md`.

### E1. Precisão do modelo estático de erro

78 casos (kernel, entrada e família de unidades) com saída de várias posições; razão entre o MSE estimado e o medido na execução bit a bit.

#### E1: razão entre o MSE estimado e o medido

| Modelo | Erro mediano (fator) | Dentro de 10% | Dentro de 25% | Dentro de 2 vezes | Pior caso (fator) | Com pipeline, dentro de 10% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| analítico | 1,25× | 31% | 51% | 79% | 5,9× | 32% |
| por amostras | 1,02× | 79% | 91% | 99% | 3,8× | 97% |

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

| Kernel | Grupos | PSNR mín. | Sequencial | Eficiência | Exaustiva | Aleatória | Local | Tabu | GRASP | Genético |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss | classe | 30 | 46,5% (33,4) | 47,4% (34,7) | 49,0% (32,0) | 47,4% (34,7) | 49,0% (32,0) | 49,0% (32,0) | 49,0% (32,0) | 49,0% (32,0) |
| gauss | classe | 40 | 44,4% (41,0) | 44,4% (41,0) | 44,4% (41,0) | 39,5% (40,7) | 44,4% (41,0) | 44,4% (41,0) | 44,4% (41,0) | 44,4% (41,0) |
| gauss | classe | 50 | 31,5% (50,8) | 31,5% (50,8) | 31,5% (50,8) | 31,5% (50,8) | 31,5% (50,8) | 31,5% (50,8) | 31,5% (50,8) | 31,5% (50,8) |
| gauss | operação | 30 | 48,3% (30,1) | 54,7% (30,5) | - | 33,3% (30,7) | 54,7% (30,5) | 54,7% (30,5) | 54,7% (30,5) | 54,7% (30,5) |
| gauss | operação | 40 | 40,2% (40,6) | 42,8% (40,3) | - | 23,9% (42,1) | 45,2% (40,4) | 45,2% (40,4) | 45,2% (40,2) | 45,2% (40,5) |
| gauss | operação | 50 | 27,8% (50,1) | 30,4% (50,2) | - | 0,0% (∞) | 32,7% (50,3) | 32,6% (50,3) | 32,1% (50,3) | 32,6% (50,6) |
| sobel | classe | 30 | 17,6% (37,9) | 17,6% (37,9) | 17,6% (37,9) | 17,6% (37,9) | 17,6% (37,9) | 17,6% (37,9) | 17,6% (37,9) | 17,6% (37,9) |
| sobel | classe | 40 | 14,1% (43,0) | 14,1% (43,0) | 14,1% (43,0) | 14,1% (43,0) | 14,1% (43,0) | 14,1% (43,0) | 14,1% (43,0) | 14,1% (43,0) |
| sobel | classe | 50 | 3,9% (55,2) | 3,9% (55,2) | 3,9% (55,2) | 3,9% (55,2) | 3,9% (55,2) | 3,9% (55,2) | 3,9% (55,2) | 3,9% (55,2) |
| sobel | operação | 30 | 11,8% (30,0) | 26,7% (30,5) | - | 4,4% (41,6) | 26,7% (30,5) | 26,7% (30,5) | 26,7% (30,5) | 26,7% (30,5) |
| sobel | operação | 40 | 12,8% (40,1) | 18,9% (40,1) | - | 4,4% (41,6) | 18,9% (40,1) | 18,9% (40,1) | 18,9% (40,1) | 18,9% (40,1) |
| sobel | operação | 50 | 4,1% (50,3) | 10,5% (50,3) | - | 0,0% (∞) | 10,5% (50,3) | 10,5% (50,3) | 10,5% (50,3) | 10,5% (50,3) |
| sharpen | classe | 30 | 7,9% (34,8) | 12,5% (32,6) | 12,5% (32,6) | 12,5% (32,6) | 12,5% (32,6) | 12,5% (32,6) | 12,5% (32,6) | 12,5% (32,6) |
| sharpen | classe | 40 | 9,0% (40,2) | 9,0% (40,2) | 9,0% (40,2) | 9,0% (40,2) | 9,0% (40,2) | 9,0% (40,2) | 9,0% (40,2) | 9,0% (40,2) |
| sharpen | classe | 50 | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) |
| sharpen | operação | 30 | 8,5% (30,6) | 14,2% (30,1) | 14,2% (30,1) | 5,5% (31,8) | 14,2% (30,1) | 14,2% (30,1) | 14,2% (30,1) | 14,2% (30,1) |
| sharpen | operação | 40 | 2,7% (41,1) | 4,7% (40,0) | 4,7% (40,0) | 2,8% (40,4) | 10,9% (40,2) | 10,9% (40,2) | 10,9% (40,2) | 10,9% (40,0) |
| sharpen | operação | 50 | 1,1% (50,5) | 1,1% (50,5) | 1,1% (50,5) | 0,0% (∞) | 1,1% (50,5) | 1,1% (50,5) | 1,1% (50,5) | 1,1% (50,5) |
| fir | classe | 50 | 40,3% (50,1) | 51,0% (50,1) | 51,0% (50,1) | 37,3% (50,3) | 51,0% (50,1) | 51,0% (50,1) | 51,0% (50,1) | 51,0% (50,1) |
| fir | classe | 60 | 37,0% (61,0) | 37,0% (61,0) | 44,0% (60,7) | 31,9% (60,2) | 37,0% (61,0) | 37,0% (61,0) | 37,0% (61,0) | 37,0% (61,0) |
| fir | classe | 70 | 22,7% (70,5) | 26,7% (70,4) | 26,7% (70,4) | 25,9% (76,1) | 26,7% (70,4) | 26,7% (70,4) | 26,7% (70,4) | 26,7% (70,4) |
| fir | operação | 50 | 50,1% (50,0) | 63,5% (50,1) | - | 35,9% (55,0) | 63,9% (50,1) | 63,9% (50,1) | 63,9% (50,1) | 63,9% (50,1) |
| fir | operação | 60 | 38,9% (60,2) | 45,1% (60,1) | - | 0,0% (∞) | 48,1% (60,0) | 46,3% (60,3) | 46,3% (60,3) | 45,2% (60,1) |
| fir | operação | 70 | 27,3% (70,2) | 35,0% (70,0) | - | 0,0% (∞) | 35,0% (70,0) | 35,0% (70,0) | 35,0% (70,0) | 35,0% (70,0) |

#### E2: distância ao melhor conhecido (área a mais, em média e no pior caso, e em quantas configurações a heurística acha o melhor)

| Heurística | Grupos | Média | Pior | Acha o melhor |
| --- | --- | ---: | ---: | ---: |
| Sequencial | classe | 4,2% | 21,9% | 7 de 12 |
| Sequencial | operação | 12,5% | 38,4% | 1 de 12 |
| Eficiência | classe | 1,3% | 12,6% | 10 de 12 |
| Eficiência | operação | 1,8% | 7,0% | 7 de 12 |
| Exaustiva | classe | 0,0% | 0,0% | 12 de 12 |
| Exaustiva | operação | 2,3% | 7,0% | 2 de 3 |
| Aleatória | classe | 5,2% | 28,0% | 7 de 12 |
| Aleatória | operação | 36,6% | 92,8% | 0 de 12 |
| Local | classe | 1,1% | 12,6% | 11 de 12 |
| Local | operação | 0,0% | 0,0% | 11 de 12 |
| Tabu | classe | 1,1% | 12,6% | 11 de 12 |
| Tabu | operação | 0,3% | 3,6% | 9 de 12 |
| GRASP | classe | 1,1% | 12,6% | 11 de 12 |
| GRASP | operação | 0,4% | 3,6% | 9 de 12 |
| Genético | classe | 1,1% | 12,6% | 11 de 12 |
| Genético | operação | 0,5% | 5,7% | 10 de 12 |

#### E2: avaliações e tempo (média por configuração)

| Heurística | Grupos | Avaliações | Tempo (s) |
| --- | --- | ---: | ---: |
| Sequencial | classe | 37 | 1,3 |
| Sequencial | operação | 227 | 6,3 |
| Eficiência | classe | 218 | 4,5 |
| Eficiência | operação | 4452 | 139,2 |
| Exaustiva | classe | 1743 | 24,1 |
| Exaustiva | operação | 353 | 13,5 |
| Aleatória | classe | 92 | 2,3 |
| Aleatória | operação | 201 | 6,7 |
| Local | classe | 302 | 5,2 |
| Local | operação | 9531 | 261,7 |
| Tabu | classe | 356 | 6,0 |
| Tabu | operação | 8112 | 238,6 |
| GRASP | classe | 433 | 6,5 |
| GRASP | operação | 9183 | 263,6 |
| Genético | classe | 365 | 6,3 |
| Genético | operação | 6902 | 177,2 |

Verificação: o primeiro ponto (o mais barato estimado como viável) passou na execução bit a bit em 162 de 183 casos; nos outros, a busca verificou em média 4,1 pontos até achar um que passa (no máximo 20).

Eficiência contra sequencial: melhor em 15 de 24 configurações, igual em 9, pior em 0; maior ganho 26,8% de área a menos que a sequencial.

### E3. Fronteiras de Pareto verificadas

Área contra PSNR, com restrição frouxa (20 dB) para a fronteira cobrir a faixa toda; todos os pontos verificados bit a bit. A última coluna conta, no limite de 40 dB, os pontos que o modelo aceita e a medida rejeita, e o contrário.

#### E3: PSNR estimado contra medido ao longo da fronteira

| Kernel | Grupos | Heurística | Pontos | Verificados | Diferença média (dB) | Maior diferença (dB) | Erros de decisão a 40 dB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| gauss | classe | exaustiva | 49 | 36 | 0,42 | 7,69 | 0 / 0 |
| gauss | operação | eficiência | 177 | 167 | 0,23 | 4,70 | 0 / 0 |
| fir | classe | exaustiva | 39 | 38 | 0,00 | 0,00 | 0 / 0 |
| sobel | operação | eficiência | 130 | 123 | 0,18 | 0,68 | 0 / 0 |

### E4. Período junto com as unidades

Gaussiano com as diretivas do código, PSNR de pelo menos 40 dB, grupos por classe, heurística de eficiência; períodos de 2,5, 5 e 10 ns.

#### E4: melhor ponto verificado por objetivo

| Objetivo | Variante | Área (µm²) | Energia (nJ) | Latência (µs) | PSNR medido | Unidades |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ponderado | 2.5 ns | 12187 | 1751 | 180,5 | 41,0 | 8 × ADD16 TRUNC7 + 5 × MUL8 T8 +C |
| latência | 2.5 ns | 15408 | 1912 | 180,5 | 52,9 | 8 × ADD16 TRUNC2 + 3 × MUL8 KUL6 |
| área | 10 ns | 7943 | 897 | 722,1 | 41,0 | 8 × ADD16 TRUNC7 + 5 × MUL8 T8 +C |

### E5. Sensibilidade aos dados de entrada

O projeto escolhido (exaustiva por classe, área, PSNR de pelo menos 40 dB) com um conjunto de dados, verificado no outro.

#### E5: o projeto otimizado com um conjunto de dados, medido no outro

| Kernel | Otimizado com | Economia de área | PSNR nos mesmos dados | PSNR nos outros dados | Mantém 40 dB |
| --- | --- | ---: | ---: | ---: | --- |
| gauss | uniformes | 44,4% | 44,8 | 41,0 | sim |
| gauss | imagem | 44,4% | 41,0 | 44,8 | sim |
| sobel | uniformes | 14,1% | 42,5 | 43,0 | sim |
| sobel | imagem | 14,1% | 43,0 | 42,5 | sim |
| sharpen | uniformes | 12,5% | 41,0 | 32,6 | não |
| sharpen | imagem | 9,0% | 40,2 | 46,4 | sim |

### E6. Unroll: cópias com a mesma unidade

Kernels com `unroll factor=2` no laço com pipeline; objetivo área, PSNR de pelo menos 40 dB, heurística de eficiência. Por operação, cada cópia é um grupo; por operação do código, as cópias de uma operação recebem a mesma unidade. A última coluna conta as operações do código cujas cópias ficaram com unidades diferentes.

#### E6: grupos por operação contra por operação do código, com unroll de 2

| Kernel | Grupos | Avaliações | Economia de área | PSNR medido | Operações aproximadas | Cópias diferentes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| gauss | operação | 4422 | 45,1% | 40,1 | 26 | 11 de 13 |
| gauss | operação do código | 9591 | 47,6% | 40,2 | 26 | 0 de 13 |
| sobel | operação | 18144 | 21,2% | 40,1 | 26 | 2 de 13 |
| sobel | operação do código | 2458 | 18,2% | 40,5 | 24 | 0 de 13 |
| sharpen | operação | 1047 | 5,1% | 40,1 | 7 | 3 de 5 |
| sharpen | operação do código | 201 | 4,4% | 40,9 | 6 | 0 de 5 |

### E7. SSIM: estimativa e exploração

SSIM padrão (janela gaussiana 11 × 11, σ = 1,5) na saída de imagem, com a imagem de teste; 30 casos (kernel e família de unidades, como no E1). A estimativa usa as estatísticas locais da imagem exata e o erro do modelo estático: pela faixa de valor da saída (média e variância do erro em 32 faixas, do modelo por amostras), como ruído independente do sinal, ou pelo modelo analítico (sem as faixas, o ganho é zero e cai na fórmula do ruído independente). "Abaixo do medido" é a fração dos casos em que a estimativa é conservadora.

#### E7: SSIM estimado contra o medido

| Estimativa | Diferença mediana | Até 0,01 | Até 0,05 | Pior diferença | Abaixo do medido | Mediana com SSIM ≥ 0,95 (15 casos) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| por faixa de valor (amostras) | 0,0275 | 40% | 60% | 0,224 | 83% | 0,0008 |
| ruído independente (amostras) | 0,0701 | 37% | 50% | 0,503 | 90% | 0,0016 |
| analítico | 0,0660 | 37% | 50% | 0,524 | 80% | 0,0006 |

#### E7: exploração por operação com restrição em SSIM (heurística de eficiência, área)

| Kernel | SSIM mín. | Avaliações | Economia de área | SSIM estimado | SSIM medido | PSNR medido | Verificações |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss | 0,95 | 7603 | 52,3% | 0,9529 | 0,9705 | 26,2 | 1 |
| gauss | 0,98 | 6944 | 48,5% | 0,9817 | 0,9891 | 33,4 | 1 |
| gauss | 0,99 | 6227 | 41,9% | 0,9900 | 0,9926 | 36,9 | 1 |
| sobel | 0,95 | 2312 | 16,1% | 0,9619 | 0,9546 | 40,7 | 20 |
| sobel | 0,98 | 1363 | - | - | - | - | 25 |
| sobel | 0,99 | 848 | - | - | - | - | 25 |
| sharpen | 0,95 | 236 | 4,7% | 0,9634 | 0,9693 | 40,0 | 1 |
| sharpen | 0,98 | 149 | 2,3% | 0,9831 | 0,9846 | 45,1 | 1 |
| sharpen | 0,99 | 109 | 1,2% | 0,9915 | 0,9929 | 47,9 | 1 |

Tempo total: 18428 s (E2 e os outros em paralelo).

