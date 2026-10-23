# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta results/nn-vitis/minilenet_part_r2; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-23.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 53115 | - | - |
| LUT (Vivado) | 35555 | - | - |
| FF (Vivado) | 2787 | - | - |
| DSP | 8 | - | - |
| Período (ns) | 10.0 | - | |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 915 | 916 | - | 1 | 1 | - | 262 | 116 | - | 45 | 102 | 0 | 0 | 0/1024 |
| conv1 | 2356 | - | - | 1 | - | - | 6135 | - | - | 645 | - | 2 | - | 0/2352 |
| pool1 | 1178 | 1181 | - | 2 | 2 | - | 242 | 150 | - | 70 | 124 | 0 | 0 | 0/588 |
| pad2 | 813 | - | - | 1 | - | - | 404 | - | - | 41 | - | 0 | - | 0/972 |
| conv2 | 1180 | - | - | 1 | - | - | 27589 | - | - | 1658 | - | 2 | - | 0/1176 |
| pool2 | 590 | 593 | - | 2 | 2 | - | 229 | 147 | - | 67 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | - | 1 | 1 | - | 68 | 52 | - | 26 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 44836 | - | 1 | 1 | - | 339 | 178 | - | 119 | 144 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1581 | - | 1 | 1 | - | 287 | 197 | - | 116 | 135 | 2 | 2 | 0/10 |
