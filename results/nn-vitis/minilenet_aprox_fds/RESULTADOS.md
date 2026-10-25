# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta build/fds/minilenet-mnist_aprox; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 125002 | 272254 | -54% |
| LUT (Vivado) | 7120 | 9119 | -22% |
| FF (Vivado) | 4375 | 6272 | -30% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 9.95 | |
| Soma das camadas sozinhas: latência | 125002 | 273107 | -54% |
| Soma das camadas sozinhas: LUT | 7342 | 8005 | -8% |
| Soma das camadas sozinhas: FF | 4375 | 6038 | -28% |
| Soma das camadas sozinhas: DSP | 8 | 8 | 0% |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | 976 | 976 | 1 | 1 | 1 | 314 | 136 | 138 | 151 | 120 | 0 | 0 | 0/1024 |
| conv1 | 30579 | 89422 | 89422 | 13 | 38 | 38 | 1421 | 1353 | 1551 | 959 | 1226 | 2 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 242 | 150 | 118 | 103 | 124 | 0 | 0 | 0/588 |
| pad2 | 906 | 916 | 916 | 1 | 1 | 1 | 434 | 168 | 187 | 146 | 148 | 0 | 0 | 0/972 |
| conv2 | 44692 | 133001 | 133003 | 38 | 113 | 113 | 4061 | 5310 | 5913 | 2589 | 3871 | 2 | 2 | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 229 | 147 | 114 | 100 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 68 | 52 | 54 | 48 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 45130 | 45130 | 1 | 1 | 1 | 299 | 321 | 460 | 141 | 213 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1591 | 1601 | 1 | 1 | 1 | 274 | 368 | 507 | 138 | 171 | 2 | 2 | 0/10 |
