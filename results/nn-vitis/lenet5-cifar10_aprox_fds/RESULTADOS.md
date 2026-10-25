# LeNet 5: modelo contra Vitis HLS e Vivado

Pasta build/fds/lenet5-cifar10_aprox; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 362736 | 955684 | -62% |
| LUT (Vivado) | 13421 | 19333 | -31% |
| FF (Vivado) | 9802 | 14919 | -34% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 11.07 | |
| Soma das camadas sozinhas: latência | 362736 | 957235 | -62% |
| Soma das camadas sozinhas: LUT | 13717 | 18513 | -26% |
| Soma das camadas sozinhas: FF | 9802 | 13862 | -29% |
| Soma das camadas sozinhas: DSP | 10 | 10 | 0% |
| csim | | 0 diferenças em 1000 saídas; 72 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| conv1 | 178756 | 531665 | 531665 | 38 | 113 | 113 | 4243 | 5230 | 5316 | 2672 | 4008 | 2 | 2 | 0/4704 |
| pool1 | 2354 | 2357 | 1181 | 2 | 2 | 1 | 255 | 190 | 150 | 106 | 149 | 0 | 0 | 0/1176 |
| conv2 | 120004 | 360226 | 360226 | 75 | 225 | 225 | 8140 | 11920 | 12387 | 6459 | 8973 | 2 | 2 | 0/1600 |
| pool2 | 802 | 805 | 405 | 2 | 2 | 1 | 229 | 144 | 138 | 106 | 141 | 0 | 0 | 0/400 |
| flatten | 402 | 403 | 403 | 1 | 1 | 1 | 68 | 45 | 44 | 50 | 42 | 0 | 0 | 0/400 |
| fc1 | 48840 | 49561 | 49561 | 1 | 1 | 1 | 283 | 313 | 424 | 143 | 204 | 2 | 2 | 0/120 |
| fc2 | 10668 | 11257 | 11257 | 1 | 1 | 1 | 231 | 298 | 419 | 136 | 182 | 2 | 2 | 0/84 |
| fc3 | 910 | 961 | 971 | 1 | 1 | 1 | 268 | 373 | 485 | 130 | 163 | 2 | 2 | 0/10 |
