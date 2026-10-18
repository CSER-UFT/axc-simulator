# Validação contra o Vitis HLS e o Vivado

Gerado por `node scripts/vitis.mjs collect` em 2026-10-18; parte xc7a100tcsg324-1. Cada caso é o mesmo projeto no simulador e no Vitis (o C++ exportado do projeto elaborado, `_ir`, ou o código original, `_src`). LUT e FF do modelo vêm da síntese das unidades com o Yosys (`synth_xilinx`), mais os multiplexadores, comparadores, registradores e contadores do modelo.

23 de 23 casos com relatório do csynth; 23 com o Vivado (impl).

#### Execução: csim do Vitis contra a execução bit a bit do simulador

| Caso | Diferenças | Posições |
| --- | ---: | ---: |
| gauss_src | 0 | 36100 |
| gauss_ir | 0 | 36100 |
| sobel_src | 0 | 36100 |
| sobel_ir | 0 | 36100 |
| sharpen_src | 0 | 36100 |
| sharpen_ir | 0 | 36100 |
| fir_src | 0 | 1009 |
| fir_ir | 0 | 1009 |
| dot_src | 0 | 1 |
| dot_ir | 0 | 1 |
| gauss_var1_ir | 0 | 36100 |
| gauss_var2_ir | 0 | 36100 |
| gauss_var3_ir | 0 | 36100 |
| gauss_2p5ns_ir | 0 | 36100 |
| gauss_10ns_ir | 0 | 36100 |
| gauss_drum6_ir | 0 | 36100 |
| gauss_t8c_loa6_ir | 0 | 36100 |
| sobel_loa4_ir | 0 | 36100 |
| sharpen_kul_ir | 0 | 36100 |
| fir_t8c_loa11_ir | 0 | 1009 |
| dot_t4_ir | 0 | 1 |
| gauss_dse_op40_ir | 0 | 36100 |
| fir_dse_op60_ir | 0 | 1009 |

#### Latência (ciclos) e período

| Caso | Modelo | Vitis | Razão | Período mín. modelo (ns) | Estimado Vitis (ns) | Vivado (ns) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | 73340 | 72218 | 0,985 | 4,05 | 7,05 | 5,35 |
| gauss_ir | 73340 | 72218 | 0,985 | 4,05 | 7,05 | 5,38 |
| sobel_src | 73150 | 72219 | 0,987 | 4,62 | 7,05 | 5,79 |
| sobel_ir | 73150 | 72219 | 0,987 | 4,62 | 7,05 | 5,89 |
| sharpen_src | 72960 | 72218 | 0,990 | 4,95 | 7,05 | 5,79 |
| sharpen_ir | 72960 | 72218 | 0,990 | 4,95 | 7,05 | 5,31 |
| fir_src | 1018 | 1019 | 1,001 | 4,95 | 6,36 | 4,49 |
| fir_ir | 1018 | 1024 | 1,006 | 4,95 | 6,36 | 4,61 |
| dot_src | 259 | 260 | 1,004 | 4,95 | 6,36 | 5,76 |
| dot_ir | 259 | 260 | 1,004 | 4,95 | 6,36 | 5,72 |
| gauss_var1_ir | 181070 | 180506 | 0,997 | 4,72 | 6,36 | 4,54 |
| gauss_var2_ir | 1155390 | 3899371 | 3,375 | 3,74 | 7,05 | 5,39 |
| gauss_var3_ir | 1155390 | 2383171 | 2,063 | 3,74 | 6,36 | 4,54 |
| gauss_2p5ns_ir | 74480 | 72222 | 0,970 | 2,23 | 7,05 | 5,58 |
| gauss_10ns_ir | 72960 | 72217 | 0,990 | 6,24 | 7,29 | 7,47 |
| gauss_drum6_ir | 73340 | 72222 | 0,985 | 4,05 | 7,05 | 5,67 |
| gauss_t8c_loa6_ir | 73150 | 72237 | 0,988 | 4,97 | 7,05 | 5,52 |
| sobel_loa4_ir | 73150 | 72224 | 0,987 | 4,54 | 7,05 | 5,74 |
| sharpen_kul_ir | 72960 | 72219 | 0,990 | 4,87 | 7,05 | 5,38 |
| fir_t8c_loa11_ir | 1015 | 1058 | 1,042 | 4,53 | 3,73 | 4,45 |
| dot_t4_ir | 259 | 264 | 1,019 | 4,95 | 4,03 | 3,34 |
| gauss_dse_op40_ir | 72960 | 72233 | 0,990 | 4,98 | 7,05 | 5,73 |
| fir_dse_op60_ir | 1015 | 1052 | 1,036 | 4,98 | 3,73 | 4,26 |

#### Recursos de FPGA

| Caso | LUT modelo | LUT Vitis | LUT Vivado | CARRY4 modelo | CARRY4 Vivado | FF modelo | FF Vitis | FF Vivado | DSP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | 549 | 2240 | 731 | 37 | 138 | 309 | 1321 | 618 | 0 |
| gauss_ir | 549 | 2192 | 729 | 37 | 141 | 309 | 1137 | 590 | 0 |
| sobel_src | 401 | 1892 | 655 | 45 | 118 | 180 | 1206 | 565 | 0 |
| sobel_ir | 401 | 1913 | 674 | 45 | 118 | 180 | 1288 | 567 | 0 |
| sharpen_src | 267 | 1655 | 493 | 22 | 94 | 88 | 979 | 431 | 0 |
| sharpen_ir | 267 | 1658 | 496 | 22 | 94 | 88 | 1015 | 468 | 0 |
| fir_src | 1740 | 3454 | 1108 | 155 | 125 | 736 | 1079 | 946 | 0 |
| fir_ir | 1740 | 3635 | 940 | 155 | 107 | 736 | 1392 | 857 | 0 |
| dot_src | 155 | 180 | 111 | 18 | 18 | 73 | 74 | 76 | 0 |
| dot_ir | 155 | 180 | 111 | 18 | 18 | 73 | 74 | 74 | 0 |
| gauss_var1_ir | 259 | 1096 | 398 | 19 | 93 | 180 | 450 | 424 | 0 |
| gauss_var2_ir | 179 | 670 | 177 | 18 | 35 | 59 | 356 | 281 | 0 |
| gauss_var3_ir | 179 | 433 | 117 | 18 | 24 | 59 | 203 | 196 | 0 |
| gauss_2p5ns_ir | 735 | 2285 | 903 | 45 | 123 | 703 | 3217 | 926 | 0 |
| gauss_10ns_ir | 549 | 2160 | 700 | 37 | 135 | 225 | 1159 | 480 | 0 |
| gauss_drum6_ir | 555 | 4422 | 886 | 34 | 147 | 309 | 2651 | 845 | 0 |
| gauss_t8c_loa6_ir | 397 | 3879 | 917 | 29 | 141 | 234 | 2666 | 901 | 0 |
| sobel_loa4_ir | 404 | 2400 | 758 | 42 | 117 | 180 | 1807 | 776 | 0 |
| sharpen_kul_ir | 245 | 1773 | 590 | 22 | 101 | 88 | 1128 | 487 | 0 |
| fir_t8c_loa11_ir | 1027 | 10117 | 1255 | 110 | - | 469 | 4784 | 806 | 0 |
| dot_t4_ir | 140 | 917 | 167 | 17 | 28 | 73 | 501 | 169 | 0 |
| gauss_dse_op40_ir | 355 | 3564 | 774 | 34 | 123 | 211 | 2329 | 788 | 0 |
| fir_dse_op60_ir | 1161 | 8715 | 1399 | 77 | 53 | 506 | 4777 | 1026 | 0 |

#### Laços: II e latência (ciclos)

| Caso | Laço | Modo | Iterações | II modelo | II Vitis | Latência modelo | Latência Vitis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | rows | sequencial | 190 | - | 2 | 73340 | 72216 |
| gauss_src | cols | pipeline | 190 | 2 | 2 | 385 | 72216 |
| gauss_ir | rows | sequencial | 190 | - | 2 | 73340 | 72216 |
| gauss_ir | cols | pipeline | 190 | 2 | 2 | 385 | 72216 |
| sobel_src | rows | sequencial | 190 | - | 2 | 73150 | 72217 |
| sobel_src | cols | pipeline | 190 | 2 | 2 | 384 | 72217 |
| sobel_ir | rows | sequencial | 190 | - | 2 | 73150 | 72217 |
| sobel_ir | cols | pipeline | 190 | 2 | 2 | 384 | 72217 |
| sharpen_src | rows | sequencial | 190 | - | 2 | 72960 | 72216 |
| sharpen_src | cols | pipeline | 190 | 2 | 2 | 383 | 72216 |
| sharpen_ir | rows | sequencial | 190 | - | 2 | 72960 | 72216 |
| sharpen_ir | cols | pipeline | 190 | 2 | 2 | 383 | 72216 |
| fir_src | samples | pipeline | 1009 | 1 | 1 | 1018 | 1017 |
| fir_ir | samples | pipeline | 1009 | 1 | 1 | 1018 | 1022 |
| dot_src | acc | pipeline | 256 | 1 | 1 | 258 | 258 |
| dot_ir | acc | pipeline | 256 | 1 | 1 | 258 | 258 |
| gauss_var1_ir | rows | sequencial | 190 | - | 5 | 181070 | 180504 |
| gauss_var1_ir | cols | pipeline | 190 | 5 | 5 | 952 | 180504 |
| gauss_var2_ir | rows | sequencial | 190 | - | - | 1155390 | 3899370 |
| gauss_var2_ir | cols | sequencial | 190 | - | - | 6080 | 20520 |
| gauss_var2_ir | L3 | sequencial | 3 | - | - | 30 | 105 |
| gauss_var2_ir | L4 | sequencial | 3 | - | - | 9 | 21 |
| gauss_var3_ir | rows | sequencial | 190 | - | - | 1155390 | 2383170 |
| gauss_var3_ir | cols | sequencial | 190 | - | - | 6080 | 12540 |
| gauss_var3_ir | L3 | sequencial | 3 | - | - | 30 | 63 |
| gauss_var3_ir | L4 | sequencial | 3 | - | - | 9 | 18 |
| gauss_2p5ns_ir | rows | sequencial | 190 | - | 2 | 74480 | 72220 |
| gauss_2p5ns_ir | cols | pipeline | 190 | 2 | 2 | 391 | 72220 |
| gauss_10ns_ir | rows | sequencial | 190 | - | 2 | 72960 | 72215 |
| gauss_10ns_ir | cols | pipeline | 190 | 2 | 2 | 383 | 72215 |
| gauss_drum6_ir | rows | sequencial | 190 | - | 2 | 73340 | 72220 |
| gauss_drum6_ir | cols | pipeline | 190 | 2 | 2 | 385 | 72220 |
| gauss_t8c_loa6_ir | rows | sequencial | 190 | - | 2 | 73150 | 72235 |
| gauss_t8c_loa6_ir | cols | pipeline | 190 | 2 | 2 | 384 | 72235 |
| sobel_loa4_ir | rows | sequencial | 190 | - | 2 | 73150 | 72222 |
| sobel_loa4_ir | cols | pipeline | 190 | 2 | 2 | 384 | 72222 |
| sharpen_kul_ir | rows | sequencial | 190 | - | 2 | 72960 | 72217 |
| sharpen_kul_ir | cols | pipeline | 190 | 2 | 2 | 383 | 72217 |
| fir_t8c_loa11_ir | samples | pipeline | 1009 | 1 | 1 | 1015 | 1056 |
| dot_t4_ir | acc | pipeline | 256 | 1 | 1 | 258 | 262 |
| gauss_dse_op40_ir | rows | sequencial | 190 | - | 2 | 72960 | 72231 |
| gauss_dse_op40_ir | cols | pipeline | 190 | 2 | 2 | 383 | 72231 |
| fir_dse_op60_ir | samples | pipeline | 1009 | 1 | 1 | 1015 | 1050 |

### Calibração sugerida

Medianas sobre 23 casos: sobrecarga por iteração de laço sequencial 35 ciclos (o modelo usa 1), entrada e saída do pipeline 71819 ciclos (o modelo usa 1); LUT Vitis ou Vivado / modelo 1,33; FF 2,36; latência Vitis / modelo 0,990. Os valores ficam em `results/vitis/calibracao.json`; a decisão de aplicar ao modelo (`MODEL` em `js/hls/sched.js`) é feita depois de olhar os casos que divergem.

