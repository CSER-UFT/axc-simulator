# LeNet 5: modelo contra Vitis HLS e Vivado

Pasta build/r6/lenet5-cifar10_aprox; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-25.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 362736 | 362689 | 0% |
| LUT (Vivado) | 10050 | 9820 | 2% |
| FF (Vivado) | 9802 | 7170 | 37% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 11.12 | |
| csim | | 0 diferenças em 1000 saídas; 72 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| conv1 | 178756 | - | 178797 | 38 | - | 38 | 2975 | - | 2198 | 2672 | - | 2 | - | 0/4704 |
| pool1 | 2354 | 2357 | 1181 | 2 | 2 | 1 | 156 | 190 | 150 | 106 | 149 | 0 | 0 | 0/1176 |
| conv2 | 120004 | - | 120079 | 75 | - | 75 | 6322 | - | 5962 | 6459 | - | 2 | - | 0/1600 |
| pool2 | 802 | 805 | 405 | 2 | 2 | 1 | 143 | 144 | 138 | 106 | 141 | 0 | 0 | 0/400 |
| flatten | 402 | 403 | 403 | 1 | 1 | 1 | 37 | 45 | 44 | 50 | 42 | 0 | 0 | 0/400 |
| fc1 | 48840 | - | 49561 | 1 | - | 1 | 211 | - | 315 | 143 | - | 2 | - | 0/120 |
| fc2 | 10668 | - | 11257 | 1 | - | 1 | 175 | - | 462 | 136 | - | 2 | - | 0/84 |
| fc3 | 910 | - | 991 | 1 | - | 1 | 211 | - | 538 | 130 | - | 2 | - | 0/10 |
