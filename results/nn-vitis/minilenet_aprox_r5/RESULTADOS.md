# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta build/r5/minilenet-mnist_aprox; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-25.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 125002 | 196951 | -37% |
| LUT (Vivado) | 5272 | 7855 | -33% |
| FF (Vivado) | 4375 | 5485 | -20% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 9.76 | |
| Soma das camadas sozinhas: latência | 125002 | 197803 | -37% |
| Soma das camadas sozinhas: LUT | 5407 | 7377 | -27% |
| Soma das camadas sozinhas: FF | 4375 | 6103 | -28% |
| Soma das camadas sozinhas: DSP | 8 | 8 | 0% |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | 976 | 976 | 1 | 1 | 1 | 136 | 136 | 140 | 151 | 120 | 0 | 0 | 0/1024 |
| conv1 | 30579 | 58846 | 58845 | 13 | 25 | 25 | 1022 | 1405 | 1415 | 959 | 1322 | 2 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 150 | 150 | 121 | 103 | 124 | 0 | 0 | 0/588 |
| pad2 | 906 | 916 | 916 | 1 | 1 | 1 | 231 | 168 | 185 | 146 | 148 | 0 | 0 | 0/972 |
| conv2 | 44692 | 88273 | 88277 | 38 | 75 | 75 | 3259 | 4686 | 4779 | 2589 | 3860 | 2 | 2 | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 143 | 147 | 118 | 100 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 37 | 52 | 54 | 48 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 45130 | 45130 | 1 | 1 | 1 | 219 | 295 | 452 | 141 | 203 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1591 | 1601 | 1 | 1 | 1 | 210 | 338 | 482 | 138 | 161 | 2 | 2 | 0/10 |
