# LeNet 5: modelo contra Vitis HLS e Vivado

Pasta build/r5/lenet5-cifar10_aprox; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-25.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 362736 | 656816 | -45% |
| LUT (Vivado) | 10050 | 17010 | -41% |
| FF (Vivado) | 9802 | 13341 | -27% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 11.02 | |
| Soma das camadas sozinhas: latência | 362736 | 658367 | -45% |
| Soma das camadas sozinhas: LUT | 10230 | 17230 | -41% |
| Soma das camadas sozinhas: FF | 9802 | 13177 | -26% |
| Soma das camadas sozinhas: DSP | 10 | 10 | 0% |
| csim | | 0 diferenças em 1000 saídas; 72 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| conv1 | 178756 | 352873 | 352873 | 38 | 75 | 75 | 2975 | 4594 | 4531 | 2672 | 3922 | 2 | 2 | 0/4704 |
| pool1 | 2354 | 2357 | 1181 | 2 | 2 | 1 | 156 | 190 | 150 | 106 | 149 | 0 | 0 | 0/1176 |
| conv2 | 120004 | 240150 | 240150 | 75 | 150 | 150 | 6322 | 11345 | 10904 | 6459 | 8404 | 2 | 2 | 0/1600 |
| pool2 | 802 | 805 | 405 | 2 | 2 | 1 | 143 | 144 | 138 | 106 | 141 | 0 | 0 | 0/400 |
| flatten | 402 | 403 | 403 | 1 | 1 | 1 | 37 | 45 | 44 | 50 | 42 | 0 | 0 | 0/400 |
| fc1 | 48840 | 49561 | 49561 | 1 | 1 | 1 | 211 | 288 | 421 | 143 | 194 | 2 | 2 | 0/120 |
| fc2 | 10668 | 11257 | 11257 | 1 | 1 | 1 | 175 | 273 | 390 | 136 | 172 | 2 | 2 | 0/84 |
| fc3 | 910 | 961 | 971 | 1 | 1 | 1 | 211 | 351 | 463 | 130 | 153 | 2 | 2 | 0/10 |
