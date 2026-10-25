# MiniLenet: modelo contra Vitis HLS e Vivado

Pasta build/fds/minilenet-mnist_exata; período de 10 ns, parte xc7a100tcsg324-1. Gerado por `node bin/axc.mjs nnvitis` em 2026-10-24.

## Rede inteira (network/)

| | Modelo | Vitis / Vivado | Desvio |
| --- | ---: | ---: | ---: |
| Latência (ciclos) | 125001 | 124825 | 0% |
| LUT (Vivado) | 7353 | 4659 | 58% |
| FF (Vivado) | 4306 | 4167 | 3% |
| DSP | 2 | 2 | 0% |
| Período (ns) | 10.0 | 9.89 | |
| Soma das camadas sozinhas: latência | 125001 | 125690 | -1% |
| Soma das camadas sozinhas: LUT | 7575 | 4636 | 63% |
| Soma das camadas sozinhas: FF | 4306 | 4028 | 7% |
| Soma das camadas sozinhas: DSP | 8 | 8 | 0% |
| csim | | 0 diferenças em 1000 saídas; 99 acertos em 100 imagens | |

## Camadas

Modelo: cada camada com as suas partições. Sozinha: o projeto layers/<camada>. Na rede: a função dentro de network/ (csynth e o módulo no Vivado).

| Camada | Ciclos modelo | sozinha | na rede | II modelo | sozinha | na rede | LUT modelo | sozinha | na rede | FF modelo | sozinha | DSP modelo | sozinha | csim |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| pad1 | 974 | 976 | 976 | 1 | 1 | 1 | 314 | 136 | 140 | 151 | 120 | 0 | 0 | 0/1024 |
| conv1 | 30579 | 30596 | 30596 | 13 | 13 | 13 | 1555 | 1088 | 1090 | 921 | 841 | 2 | 2 | 0/2352 |
| pool1 | 1178 | 1181 | 593 | 2 | 2 | 1 | 242 | 150 | 117 | 103 | 124 | 0 | 0 | 0/588 |
| pad2 | 906 | 916 | 916 | 1 | 1 | 1 | 434 | 168 | 188 | 146 | 148 | 0 | 0 | 0/972 |
| conv2 | 44691 | 44714 | 44714 | 38 | 38 | 38 | 4107 | 2519 | 2460 | 2558 | 2352 | 2 | 2 | 0/1176 |
| pool2 | 590 | 593 | 299 | 2 | 2 | 1 | 229 | 147 | 116 | 100 | 116 | 0 | 0 | 0/294 |
| flatten | 296 | 297 | 297 | 1 | 1 | 1 | 68 | 52 | 54 | 48 | 49 | 0 | 0 | 0/294 |
| fc1 | 44247 | 44836 | 44836 | 1 | 1 | 1 | 339 | 179 | 210 | 141 | 143 | 2 | 2 | 0/147 |
| fc2 | 1540 | 1581 | 1581 | 1 | 1 | 1 | 287 | 197 | 208 | 138 | 135 | 2 | 2 | 0/10 |
