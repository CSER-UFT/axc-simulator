# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta results/nn-vitis/minilenet_aprox_r3; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 125002 | 125149 | -0% |
| LUT (Vivado) | 7120 | - | - |
| FF (Vivado) | 3979 | - | - |
| DSP | 2 | 1 | 100% |
| Período (ns) | 10.0 | - | |
| Soma das camadas sozinhas: latência | 125002 | 126014 | -1% |
| Soma das camadas sozinhas: LUT | 7342 | 7737 | -5% |
| Soma das camadas sozinhas: FF | 3979 | 4938 | -19% |
| Soma das camadas sozinhas: DSP | 8 | 8 | 0% |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | 976 | 976 | 1 | 1 | 1 | 314 | 136 | - | 52 | 120 | 0 | 0 | 0/1024 |
| conv1 | 30579 | 30602 | 30602 | 13 | 13 | 13 | 1421 | 1095 | - | 926 | 871 | 2 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 242 | 150 | - | 70 | 124 | 0 | 0 | 0/588 |
| pad2 | 906 | 916 | 916 | 1 | 1 | 1 | 434 | 168 | - | 47 | 148 | 0 | 0 | 0/972 |
| conv2 | 44692 | 44728 | 44728 | 38 | 38 | 38 | 4061 | 5303 | - | 2556 | 3125 | 2 | 2 | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 229 | 147 | - | 67 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 68 | 52 | - | 26 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 45130 | 45130 | 1 | 1 | 1 | 299 | 319 | - | 119 | 214 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1591 | 1591 | 1 | 1 | 1 | 274 | 367 | - | 116 | 171 | 2 | 2 | 0/10 |
