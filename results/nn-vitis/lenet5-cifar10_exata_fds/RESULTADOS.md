# LeNet 5: modelo contra Vitis HLS e Vivado

Pasta build/fds/lenet5-cifar10_exata; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 362735 | 362187 | 0% |
| LUT (Vivado) | 13818 | 9581 | 44% |
| FF (Vivado) | 8491 | 7842 | 8% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 11.06 | |
| Soma das camadas sozinhas: latência | 362735 | 363748 | -0% |
| Soma das camadas sozinhas: LUT | 14114 | 9483 | 49% |
| Soma das camadas sozinhas: FF | 8491 | 7622 | 11% |
| Soma das camadas sozinhas: DSP | 10 | 10 | 0% |
| csim | | 0 diferenças em 1000 saídas; 73 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| conv1 | 178755 | 178771 | 178771 | 38 | 38 | 38 | 4259 | 2349 | 2373 | 2639 | 2272 | 2 | 2 | 0/4704 |
| pool1 | 2354 | 2357 | 1181 | 2 | 2 | 1 | 255 | 190 | 155 | 106 | 149 | 0 | 0 | 0/1176 |
| conv2 | 120004 | 120051 | 120051 | 75 | 75 | 75 | 8436 | 6232 | 6298 | 5181 | 4644 | 2 | 2 | 0/1600 |
| pool2 | 802 | 805 | 405 | 2 | 2 | 1 | 229 | 144 | 138 | 106 | 141 | 0 | 0 | 0/400 |
| flatten | 402 | 403 | 403 | 1 | 1 | 1 | 68 | 45 | 50 | 50 | 42 | 0 | 0 | 0/400 |
| fc1 | 48840 | 49321 | 49321 | 1 | 1 | 1 | 323 | 176 | 164 | 143 | 132 | 2 | 2 | 0/120 |
| fc2 | 10668 | 11089 | 11089 | 1 | 1 | 1 | 271 | 168 | 162 | 136 | 115 | 2 | 2 | 0/84 |
| fc3 | 910 | 951 | 951 | 1 | 1 | 1 | 273 | 179 | 167 | 130 | 127 | 2 | 2 | 0/10 |
