# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta build/r6/minilenet-mnist_aprox; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-25.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 125002 | 125185 | -0% |
| LUT (Vivado) | 5272 | 4603 | 15% |
| FF (Vivado) | 4375 | 3635 | 20% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 9.77 | |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | 976 | 976 | 1 | 1 | 1 | 136 | 136 | 140 | 151 | 120 | 0 | 0 | 0/1024 |
| conv1 | 30579 | - | 30603 | 13 | - | 13 | 1022 | - | 673 | 959 | - | 2 | - | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 150 | 150 | 117 | 103 | 124 | 0 | 0 | 0/588 |
| pad2 | 906 | 916 | 916 | 1 | 1 | 1 | 231 | 168 | 187 | 146 | 148 | 0 | 0 | 0/972 |
| conv2 | 44692 | - | 44733 | 38 | - | 38 | 3259 | - | 2172 | 2589 | - | 2 | - | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 143 | 147 | 114 | 100 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 37 | 52 | 54 | 48 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | - | 45130 | 1 | - | 1 | 219 | - | 453 | 141 | - | 2 | - | 0/147 |
| fc2 | 1540 | - | 1621 | 1 | - | 1 | 210 | - | 604 | 138 | - | 2 | - | 0/10 |
