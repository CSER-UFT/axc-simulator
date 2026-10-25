# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta build/fds/minilenet-mnist_part; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 53288 | 53213 | 0% |
| LUT (Vivado) | 27575 | 19993 | 38% |
| FF (Vivado) | 4523 | 6072 | -26% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 9.72 | |
| Soma das camadas sozinhas: latência | 53288 | 53946 | -1% |
| Soma das camadas sozinhas: LUT | 27797 | 18481 | 50% |
| Soma das camadas sozinhas: FF | 4523 | 4945 | -9% |
| Soma das camadas sozinhas: DSP | 8 | 8 | 0% |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | 976 | 1004 | 1 | 1 | 1 | 314 | 136 | 431 | 151 | 120 | 0 | 0 | 0/1024 |
| conv1 | 2366 | 2372 | 2373 | 1 | 1 | 1 | 4989 | 3447 | 4345 | 1142 | 1194 | 2 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 242 | 150 | 119 | 103 | 124 | 0 | 0 | 0/588 |
| pad2 | 906 | 916 | 1018 | 1 | 1 | 1 | 502 | 162 | 832 | 146 | 141 | 0 | 0 | 0/972 |
| conv2 | 1191 | 1194 | 1195 | 1 | 1 | 1 | 20827 | 14011 | 11812 | 2554 | 2923 | 2 | 2 | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 229 | 147 | 115 | 100 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 68 | 52 | 53 | 48 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 44836 | 44836 | 1 | 1 | 1 | 339 | 179 | 208 | 141 | 143 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1581 | 1581 | 1 | 1 | 1 | 287 | 197 | 207 | 138 | 135 | 2 | 2 | 0/10 |
