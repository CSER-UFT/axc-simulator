# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta build/nn/r3_part (na máquina da rodada); período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 53267 | 53008 | 0% |
| LUT (Vivado) | 35483 | 31911 | 11% |
| FF (Vivado) | 2800 | 5434 | -48% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 8.47 | |
| Soma das camadas sozinhas: latência | 53267 | 53931 | -1% |
| Soma das camadas sozinhas: LUT | 35483 | - | - |
| Soma das camadas sozinhas: FF | 2800 | - | - |
| Soma das camadas sozinhas: DSP | 2 | - | - |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | 976 | 916 | 1 | 1 | 1 | 314 | 136 | - | 52 | 120 | 0 | 0 | 0/1024 |
| conv1 | 2356 | 2364 | 2365 | 1 | 1 | 1 | 6135 | 2974 | - | 645 | 995 | 2 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 242 | 150 | - | 70 | 124 | 0 | 0 | 0/588 |
| pad2 | 906 | 916 | 916 | 1 | 1 | 1 | 502 | 184 | - | 47 | 160 | 0 | 0 | 0/972 |
| conv2 | 1180 | 1187 | 1188 | 1 | 1 | 1 | 27589 | - | - | 1658 | - | 2 | - | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 229 | 147 | - | 67 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 68 | 52 | - | 26 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 44836 | 44836 | 1 | 1 | 1 | 339 | 178 | - | 119 | 144 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1581 | 1581 | 1 | 1 | 1 | 287 | 197 | - | 116 | 135 | 2 | 2 | 0/10 |
