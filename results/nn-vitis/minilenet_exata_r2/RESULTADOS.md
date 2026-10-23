# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta results/nn-vitis/minilenet_exata_r2; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-23.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 124849 | 124671 | 0% |
| LUT (Vivado) | 7441 | 5397 | 38% |
| FF (Vivado) | 3897 | 4121 | -5% |
| DSP | 8 | 2 | 300% |
| Período (ns) | 10.0 | 9.78 | |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 915 | 916 | 916 | 1 | 1 | 1 | 262 | 116 | 120 | 45 | 102 | 0 | 0 | 0/1024 |
| conv1 | 30579 | 30595 | 30595 | 13 | 13 | 13 | 1555 | 1906 | 1864 | 888 | 819 | 2 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 242 | 150 | 122 | 70 | 124 | 0 | 0 | 0/588 |
| pad2 | 813 | - | 823 | 1 | - | 1 | 352 | - | 162 | 41 | - | 0 | - | 0/972 |
| conv2 | 44691 | 44714 | 44714 | 38 | 38 | 38 | 4107 | 2517 | 2471 | 2525 | 2352 | 2 | 2 | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 229 | 147 | 121 | 67 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 68 | 52 | 54 | 26 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 44836 | 44836 | 1 | 1 | 1 | 339 | 178 | 208 | 119 | 144 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1581 | 1581 | 1 | 1 | 1 | 287 | 197 | 205 | 116 | 135 | 2 | 2 | 0/10 |
