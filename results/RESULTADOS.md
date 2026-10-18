# Resultados dos estudos de caso

Gerado por `scripts/experiments.mjs` em 2026-10-18 (commit daecf30, Node v22.22.0); biblioteca sintetizada de 2026-10-16 (sky130_fd_sc_hd, tt_025C_1v80). Período de 5 ns, fluxo de atraso mínimo, 2 portas por banco, salvo indicação. A metodologia e as limitações estão em `docs/METODOLOGIA.md`.

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
| gauss | classe | 30 | 33,5% (33,4) | 34,7% (32,0) | 33,5% (33,4) | 29,0% (38,1) |
| gauss | classe | 40 | 27,9% (40,2) | 27,9% (40,2) | 27,9% (40,2) | 27,9% (40,2) |
| gauss | classe | 50 | 22,7% (51,2) | 22,7% (51,2) | 22,7% (51,2) | 21,9% (53,2) |
| gauss | operação | 30 | 48,4% (30,0) | 49,4% (30,2) | - | 29,8% (32,0) |
| gauss | operação | 40 | 38,5% (40,3) | 42,1% (40,4) | - | 19,1% (41,8) |
| gauss | operação | 50 | 25,8% (50,2) | 27,4% (50,2) | - | 12,2% (51,3) |
| sobel | classe | 30 | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) |
| sobel | classe | 40 | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) |
| sobel | classe | 50 | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) | 0,0% (∞) |
| sobel | operação | 30 | 7,3% (30,2) | 7,3% (30,9) | 7,3% (31,1) | 5,0% (30,8) |
| sobel | operação | 40 | 5,6% (42,0) | 5,6% (41,8) | 5,6% (42,1) | 4,0% (41,6) |
| sobel | operação | 50 | 2,3% (51,6) | 2,5% (51,6) | 2,5% (51,6) | 2,4% (51,7) |
| sharpen | classe | 30 | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) |
| sharpen | classe | 40 | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) |
| sharpen | classe | 50 | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) |
| sharpen | operação | 30 | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) |
| sharpen | operação | 40 | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) |
| sharpen | operação | 50 | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) | 0,4% (∞) |
| fir | classe | 50 | 49,8% (54,0) | 49,8% (54,0) | 49,8% (54,0) | 35,7% (51,3) |
| fir | classe | 60 | 32,1% (60,1) | 32,6% (63,3) | 32,6% (63,3) | 25,9% (64,8) |
| fir | classe | 70 | 22,2% (70,9) | 26,8% (71,1) | 26,8% (71,1) | 24,1% (70,5) |
| fir | operação | 50 | 56,4% (50,1) | 64,1% (50,0) | - | 30,9% (50,1) |
| fir | operação | 60 | 44,3% (60,0) | 47,6% (60,1) | - | 0,0% (∞) |
| fir | operação | 70 | 32,3% (70,0) | 33,6% (70,1) | - | 0,0% (∞) |

#### E2: avaliações e tempo (média por configuração)

| Heurística | Grupos | Avaliações | Tempo (s) |
| --- | --- | ---: | ---: |
| Sequencial | classe | 31 | 0,5 |
| Sequencial | operação | 189 | 1,5 |
| Eficiência | classe | 145 | 1,4 |
| Eficiência | operação | 2062 | 19,8 |
| Exaustiva | classe | 378 | 2,8 |
| Exaustiva | operação | 1180 | 14,7 |
| Aleatória | classe | 74 | 0,7 |
| Aleatória | operação | 153 | 1,6 |

Verificação: o primeiro ponto (o mais barato estimado como viável) passou na execução bit a bit em 90 de 90 casos; nos outros, a busca verificou em média 0,0 pontos até achar um que passa (no máximo 1).

Eficiência contra sequencial: melhor em 11 de 24 configurações, igual em 12, pior em 1; maior ganho 17,7% de área a menos que a sequencial.

### E3. Fronteiras de Pareto verificadas

Área contra PSNR, com restrição frouxa (20 dB) para a fronteira cobrir a faixa toda; todos os pontos verificados bit a bit. A última coluna conta, no limite de 40 dB, os pontos que o modelo aceita e a medida rejeita, e o contrário.

#### E3: PSNR estimado contra medido ao longo da fronteira

| Kernel | Grupos | Heurística | Pontos | Verificados | Diferença média (dB) | Maior diferença (dB) | Erros de decisão a 40 dB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| gauss | classe | exaustiva | 25 | 24 | 0,22 | 1,64 | 0 / 0 |
| gauss | operação | eficiência | 81 | 74 | 0,23 | 4,70 | 0 / 0 |
| fir | classe | exaustiva | 49 | 48 | 0,00 | 0,00 | 0 / 0 |
| sobel | operação | eficiência | 29 | 26 | 0,23 | 0,72 | 0 / 0 |

### E4. Diretivas e período junto com as unidades

Gaussiano, PSNR de pelo menos 40 dB, grupos por classe, heurística de eficiência; variantes: cada diretiva ligada ou desligada e os períodos de 2,5, 5 e 10 ns.

#### E4: melhor ponto verificado por objetivo

| Objetivo | Variante | Área (µm²) | Energia (nJ) | Latência (µs) | PSNR medido | Unidades |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ponderado | diretivas do código, 2.5 ns | 14406 | 1797 | 180,5 | 40,2 | 3 × MUL8 T8 +C + 4 × ADD16 LOA6 |
| latência | diretivas do código, 2.5 ns | 16565 | 1955 | 180,5 | 52,9 | 3 × MUL8 KUL6 + 4 × ADD16 TRUNC2 |
| área | sem array_partition (linha 6), pipeline (linha 12), 2.5 ns | 4986 | 11199 | 4423,7 | 43,8 | 1 × MUL8 T6 + 1 × ADD16 LOA8 |

### E5. Sensibilidade aos dados de entrada

O projeto escolhido (exaustiva por classe, área, PSNR de pelo menos 40 dB) com um conjunto de dados, verificado no outro.

#### E5: o projeto otimizado com um conjunto de dados, medido no outro

| Kernel | Otimizado com | Economia de área | PSNR nos mesmos dados | PSNR nos outros dados | Mantém 40 dB |
| --- | --- | ---: | ---: | ---: | --- |
| gauss | uniformes | 31,7% | 41,6 | 39,7 | não |
| gauss | imagem | 27,9% | 40,2 | 41,5 | sim |
| sobel | uniformes | 0,0% | ∞ | ∞ | sim |
| sobel | imagem | 0,0% | ∞ | ∞ | sim |
| sharpen | uniformes | 0,4% | ∞ | ∞ | sim |
| sharpen | imagem | 0,4% | ∞ | ∞ | sim |

### E6. Unroll: cópias com a mesma unidade

Kernels com `unroll factor=2` no laço com pipeline; objetivo área, PSNR de pelo menos 40 dB, heurística de eficiência. Por operação, cada cópia é um grupo; por operação do código, as cópias de uma operação recebem a mesma unidade. A última coluna conta as operações do código cujas cópias ficaram com unidades diferentes.

#### E6: grupos por operação contra por operação do código, com unroll de 2

| Kernel | Grupos | Avaliações | Economia de área | PSNR medido | Operações aproximadas | Cópias diferentes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| gauss | operação | 1506 | 34,4% | 41,1 | 22 | 10 de 13 |
| gauss | operação do código | 1925 | 34,9% | 40,2 | 24 | 0 de 13 |
| sobel | operação | 603 | 6,8% | 41,0 | 6 | 5 de 13 |
| sobel | operação do código | 14 | 0,0% | ∞ | 0 | 0 de 13 |
| sharpen | operação | 36 | 0,4% | ∞ | 2 | 1 de 5 |
| sharpen | operação do código | 7 | 0,0% | ∞ | 0 | 0 de 5 |

### E7. SSIM: estimativa e exploração

SSIM padrão (janela gaussiana 11 × 11, σ = 1,5) na saída de imagem, com a imagem de teste; 27 casos (kernel e família de unidades, como no E1). A estimativa usa as estatísticas locais da imagem exata e o erro do modelo estático: pela faixa de valor da saída (média e variância do erro em 32 faixas, do modelo por amostras), como ruído independente do sinal, ou pelo modelo analítico (sem as faixas, o ganho é zero e cai na fórmula do ruído independente). "Abaixo do medido" é a fração dos casos em que a estimativa é conservadora.

#### E7: SSIM estimado contra o medido

| Estimativa | Diferença mediana | Até 0,01 | Até 0,05 | Pior diferença | Abaixo do medido | Mediana com SSIM ≥ 0,95 (15 casos) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| por faixa de valor (amostras) | 0,0174 | 44% | 67% | 0,463 | 85% | 0,0008 |
| ruído independente (amostras) | 0,0379 | 41% | 59% | 0,503 | 93% | 0,0016 |
| analítico | 0,0316 | 41% | 59% | 0,524 | 78% | 0,0006 |

#### E7: exploração por operação com restrição em SSIM (heurística de eficiência, área)

| Kernel | SSIM mín. | Avaliações | Economia de área | SSIM estimado | SSIM medido | PSNR medido | Verificações |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss | 0,95 | 3236 | 45,1% | 0,9518 | 0,9680 | 29,3 | 1 |
| gauss | 0,98 | 2979 | 41,7% | 0,9815 | 0,9867 | 38,0 | 1 |
| gauss | 0,99 | 2665 | 38,2% | 0,9910 | 0,9934 | 38,1 | 1 |
| sobel | 0,95 | 205 | 8,2% | 0,9593 | 0,9507 | 28,3 | 1 |
| sobel | 0,98 | 160 | 2,8% | 0,9882 | 0,9839 | 47,4 | 3 |
| sobel | 0,99 | 138 | 2,5% | 0,9959 | 0,9938 | 51,9 | 1 |
| sharpen | 0,95 | 9 | 0,4% | 1,0000 | 1,0000 | ∞ | 1 |
| sharpen | 0,98 | 9 | 0,4% | 1,0000 | 1,0000 | ∞ | 1 |
| sharpen | 0,99 | 9 | 0,4% | 1,0000 | 1,0000 | ∞ | 1 |

Tempo total: 991 s.

