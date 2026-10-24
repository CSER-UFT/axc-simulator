# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta build/nn/r4_aprox; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 125002 | 125160 | -0% |
| LUT (Vivado) | 7120 | 8758 | -19% |
| FF (Vivado) | 3979 | 5309 | -25% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 9.89 | |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | - | 976 | 1 | - | 1 | 314 | - | 142 | 52 | - | 0 | - | - |
| conv1 | 30579 | - | 30602 | 13 | - | 13 | 1421 | - | 1287 | 926 | - | 2 | - | - |
| pool1 | 1178 | - | 593 | 2 | - | 1 | 242 | - | 117 | 70 | - | 0 | - | - |
| pad2 | 906 | - | 916 | 1 | - | 1 | 434 | - | 187 | 47 | - | 0 | - | - |
| conv2 | 44692 | - | 44729 | 38 | - | 38 | 4061 | - | 5761 | 2556 | - | 2 | - | - |
| pool2 | 590 | - | 299 | 2 | - | 1 | 229 | - | 114 | 67 | - | 0 | - | - |
| flatten | 296 | - | 297 | 1 | - | 1 | 68 | - | 54 | 26 | - | 0 | - | - |
| fc1 | 44247 | - | 45130 | 1 | - | 1 | 299 | - | 460 | 119 | - | 2 | - | - |
| fc2 | 1540 | - | 1601 | 1 | - | 1 | 274 | - | 508 | 116 | - | 2 | - | - |
