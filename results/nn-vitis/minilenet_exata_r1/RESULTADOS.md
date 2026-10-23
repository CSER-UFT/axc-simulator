# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta results/nn-vitis/minilenet_exata_r1; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-23.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 124849 | 53025 | 135% |
| LUT (Vivado) | 7441 | 23606 | -68% |
| FF (Vivado) | 3897 | 6351 | -39% |
| DSP | 16 | 4 | 300% |
| Período (ns) | 10.0 | 10.09 | |
| Soma das camadas sozinhas: latência | 124849 | 125617 | -1% |
| Soma das camadas sozinhas: LUT | 7441 | 6604 | 13% |
| Soma das camadas sozinhas: FF | 3897 | 4264 | -9% |
| Soma das camadas sozinhas: DSP | 16 | 4 | 300% |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 915 | 916 | 937 | 1 | 1 | 1 | 262 | 116 | 388 | 45 | 102 | 0 | 0 | 0/1024 |
| conv1 | 30579 | 30595 | 2372 | 13 | 13 | 1 | 1555 | 1905 | 3214 | 888 | 819 | 4 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 242 | 150 | 111 | 70 | 124 | 0 | 0 | 0/588 |
| pad2 | 813 | 904 | 898 | 1 | 2 | 1 | 352 | 157 | 1038 | 41 | 140 | 0 | 0 | 0/972 |
| conv2 | 44691 | 44714 | 1195 | 38 | 38 | 1 | 4107 | 2436 | 14658 | 2525 | 2350 | 4 | 2 | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 229 | 147 | 105 | 67 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 68 | 52 | 53 | 26 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 44836 | 44836 | 1 | 1 | 1 | 339 | 864 | 888 | 119 | 285 | 4 | 0 | 0/147 |
| fc2 | 1540 | 1581 | 1581 | 1 | 1 | 1 | 287 | 777 | 794 | 116 | 279 | 4 | 0 | 0/10 |
