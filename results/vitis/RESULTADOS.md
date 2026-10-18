# Validação contra o Vitis HLS e o Vivado

Gerado por `node scripts/vitis.mjs compare` em 2026-10-18; parte xc7a100tcsg324-1. Cada caso é o mesmo projeto no simulador e no Vitis HLS 2022.2 (o C++ exportado do projeto elaborado, `_ir`, ou o código original, `_src`), com multiplicadores na lógica (sem DSP). LUT e FF do modelo vêm da síntese das unidades com o Yosys (`synth_xilinx`), mais as peças do modelo (multiplexadores, comparadores, registradores, contadores e a seleção de banco). A referência de recursos e de período é o Vivado depois do roteamento; a estimativa do csynth fica na tabela só para comparação. "Modelo 1" é o modelo antes desta validação (o que gerou os casos); "modelo" é o atual, calibrado com estes relatórios, para as mesmas atribuições de unidades.

23 de 45 casos com relatório do csynth; 23 com o Vivado (impl); 23 com csim.

#### Erro médio do modelo (desvio relativo médio entre o modelo e a medida)

| Grandeza | Casos | Modelo 1 | Modelo |
| --- | ---: | ---: | ---: |
| Latência (ciclos), com pipeline | 21 | 1,4% | 0,5% |
| Latência (ciclos), sem pipeline | 2 | 60,9% | 30,3% |
| Latência (ciclos), todos | 23 | 6,6% | 3,1% |
| LUT (Vivado) | 23 | 38,1% | 16,0% |
| FF (Vivado) | 23 | 53,9% | 25,1% |
| Período (Vivado) | 23 | - | 19,9% |

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
| gauss_dse2_lut40_ir | - | - |
| fir_dse2_lut60_ir | - | - |
| gauss_drum6_lat0_ir | - | - |
| gauss_t8c_loa6_lat0_ir | - | - |
| sobel_loa4_lat0_ir | - | - |
| sharpen_kul_lat0_ir | - | - |
| fir_t8c_loa11_lat0_ir | - | - |
| dot_t4_lat0_ir | - | - |
| gauss_dse_op40_lat0_ir | - | - |
| fir_dse_op60_lat0_ir | - | - |
| gauss_dse2_lut40_lat0_ir | - | - |
| fir_dse2_lut60_lat0_ir | - | - |
| gauss_drum6_inl_ir | - | - |
| gauss_t8c_loa6_inl_ir | - | - |
| sobel_loa4_inl_ir | - | - |
| sharpen_kul_inl_ir | - | - |
| fir_t8c_loa11_inl_ir | - | - |
| dot_t4_inl_ir | - | - |
| gauss_dse_op40_inl_ir | - | - |
| fir_dse_op60_inl_ir | - | - |
| gauss_dse2_lut40_inl_ir | - | - |
| fir_dse2_lut60_inl_ir | - | - |

#### Latência (ciclos) e período

| Caso | Modelo 1 | Modelo | Vitis | Razão | Período modelo (ns) | csynth (ns) | Vivado (ns) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | 73340 | 72217 | 72218 | 1,000 | 4,05 | 7,05 | 5,35 |
| gauss_ir | 73340 | 72217 | 72218 | 1,000 | 4,05 | 7,05 | 5,38 |
| sobel_src | 73150 | 72217 | 72219 | 1,000 | 4,62 | 7,05 | 5,79 |
| sobel_ir | 73150 | 72217 | 72219 | 1,000 | 4,62 | 7,05 | 5,89 |
| sharpen_src | 72960 | 72216 | 72218 | 1,000 | 4,87 | 7,05 | 5,79 |
| sharpen_ir | 72960 | 72216 | 72218 | 1,000 | 4,87 | 7,05 | 5,31 |
| fir_src | 1018 | 1018 | 1019 | 0,999 | 4,05 | 6,36 | 4,49 |
| fir_ir | 1018 | 1018 | 1024 | 0,994 | 4,05 | 6,36 | 4,61 |
| dot_src | 259 | 259 | 260 | 0,996 | 4,95 | 6,36 | 5,76 |
| dot_ir | 259 | 259 | 260 | 0,996 | 4,95 | 6,36 | 5,72 |
| gauss_var1_ir | 181070 | 180502 | 180506 | 1,000 | 3,81 | 6,36 | 4,54 |
| gauss_var2_ir | 1155390 | 3069070 | 3899371 | 0,787 | 3,74 | 7,05 | 5,39 |
| gauss_var3_ir | 1155390 | 1444570 | 2383171 | 0,606 | 3,74 | 6,36 | 4,54 |
| gauss_2p5ns_ir | 74480 | 72224 | 72222 | 1,000 | 2,23 | 7,05 | 5,58 |
| gauss_10ns_ir | 72960 | 72216 | 72217 | 1,000 | 8,89 | 7,29 | 7,47 |
| gauss_drum6_ir | 73340 | 72217 | 72222 | 1,000 | 4,05 | 7,05 | 5,67 |
| gauss_t8c_loa6_ir | 73150 | 72217 | 72237 | 1,000 | 4,97 | 7,05 | 5,52 |
| sobel_loa4_ir | 73150 | 72217 | 72224 | 1,000 | 4,54 | 7,05 | 5,74 |
| sharpen_kul_ir | 72960 | 72216 | 72219 | 1,000 | 4,87 | 7,05 | 5,38 |
| fir_t8c_loa11_ir | 1015 | 1015 | 1058 | 0,959 | 4,53 | 3,73 | 4,45 |
| dot_t4_ir | 259 | 259 | 264 | 0,981 | 4,95 | 4,03 | 3,34 |
| gauss_dse_op40_ir | 72960 | 72216 | 72233 | 1,000 | 4,98 | 7,05 | 5,73 |
| fir_dse_op60_ir | 1015 | 1015 | 1052 | 0,965 | 4,98 | 3,73 | 4,26 |
| gauss_dse2_lut40_ir | 72217 | 72217 | - | - | 4,67 | - | - |
| fir_dse2_lut60_ir | 1016 | 1016 | - | - | 4,66 | - | - |
| gauss_drum6_lat0_ir | 72217 | 72217 | - | - | 4,05 | - | - |
| gauss_t8c_loa6_lat0_ir | 72217 | 72217 | - | - | 4,97 | - | - |
| sobel_loa4_lat0_ir | 72217 | 72217 | - | - | 4,54 | - | - |
| sharpen_kul_lat0_ir | 72216 | 72216 | - | - | 4,87 | - | - |
| fir_t8c_loa11_lat0_ir | 1015 | 1015 | - | - | 4,53 | - | - |
| dot_t4_lat0_ir | 259 | 259 | - | - | 4,95 | - | - |
| gauss_dse_op40_lat0_ir | 72216 | 72216 | - | - | 4,98 | - | - |
| fir_dse_op60_lat0_ir | 1015 | 1015 | - | - | 4,98 | - | - |
| gauss_dse2_lut40_lat0_ir | 72217 | 72217 | - | - | 4,67 | - | - |
| fir_dse2_lut60_lat0_ir | 1016 | 1016 | - | - | 4,66 | - | - |
| gauss_drum6_inl_ir | 72217 | 72217 | - | - | 4,05 | - | - |
| gauss_t8c_loa6_inl_ir | 72217 | 72217 | - | - | 4,97 | - | - |
| sobel_loa4_inl_ir | 72217 | 72217 | - | - | 4,54 | - | - |
| sharpen_kul_inl_ir | 72216 | 72216 | - | - | 4,87 | - | - |
| fir_t8c_loa11_inl_ir | 1015 | 1015 | - | - | 4,53 | - | - |
| dot_t4_inl_ir | 259 | 259 | - | - | 4,95 | - | - |
| gauss_dse_op40_inl_ir | 72216 | 72216 | - | - | 4,98 | - | - |
| fir_dse_op60_inl_ir | 1015 | 1015 | - | - | 4,98 | - | - |
| gauss_dse2_lut40_inl_ir | 72217 | 72217 | - | - | 4,67 | - | - |
| fir_dse2_lut60_inl_ir | 1016 | 1016 | - | - | 4,66 | - | - |

#### Recursos de FPGA

| Caso | LUT modelo 1 | LUT modelo | LUT csynth | LUT Vivado | CARRY4 modelo | CARRY4 Vivado | FF modelo 1 | FF modelo | FF csynth | FF Vivado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | 549 | 703 | 2240 | 731 | 70 | 138 | 309 | 602 | 1321 | 618 |
| gauss_ir | 549 | 703 | 2192 | 729 | 70 | 141 | 309 | 602 | 1137 | 590 |
| sobel_src | 401 | 644 | 1892 | 655 | 43 | 118 | 180 | 492 | 1206 | 565 |
| sobel_ir | 401 | 644 | 1913 | 674 | 43 | 118 | 180 | 492 | 1288 | 567 |
| sharpen_src | 267 | 525 | 1655 | 493 | 24 | 94 | 88 | 384 | 979 | 431 |
| sharpen_ir | 267 | 525 | 1658 | 496 | 24 | 94 | 88 | 384 | 1015 | 468 |
| fir_src | 1740 | 888 | 3454 | 1108 | 114 | 125 | 736 | 816 | 1079 | 946 |
| fir_ir | 1740 | 888 | 3635 | 940 | 114 | 107 | 736 | 816 | 1392 | 857 |
| dot_src | 155 | 139 | 180 | 111 | 13 | 18 | 73 | 73 | 74 | 76 |
| dot_ir | 155 | 139 | 180 | 111 | 13 | 18 | 73 | 73 | 74 | 74 |
| gauss_var1_ir | 259 | 447 | 1096 | 398 | 70 | 93 | 180 | 281 | 450 | 424 |
| gauss_var2_ir | 179 | 241 | 670 | 177 | 18 | 35 | 59 | 101 | 356 | 281 |
| gauss_var3_ir | 179 | 153 | 433 | 117 | 18 | 24 | 59 | 59 | 203 | 196 |
| gauss_2p5ns_ir | 735 | 703 | 2285 | 903 | 70 | 123 | 703 | 1127 | 3217 | 926 |
| gauss_10ns_ir | 549 | 703 | 2160 | 700 | 70 | 135 | 225 | 492 | 1159 | 480 |
| gauss_drum6_ir | 555 | 749 | 4422 | 886 | 46 | 147 | 309 | 592 | 2651 | 845 |
| gauss_t8c_loa6_ir | 397 | 730 | 3879 | 917 | 21 | 141 | 234 | 546 | 2666 | 901 |
| sobel_loa4_ir | 404 | 691 | 2400 | 758 | 35 | 117 | 180 | 492 | 1807 | 776 |
| sharpen_kul_ir | 245 | 530 | 1773 | 590 | 23 | 101 | 88 | 384 | 1128 | 487 |
| fir_t8c_loa11_ir | 1027 | 782 | 10117 | 1255 | 33 | - | 469 | 519 | 4784 | 806 |
| dot_t4_ir | 140 | 124 | 917 | 167 | 12 | 28 | 73 | 73 | 501 | 169 |
| gauss_dse_op40_ir | 355 | 669 | 3564 | 774 | 23 | 123 | 211 | 507 | 2329 | 788 |
| fir_dse_op60_ir | 1161 | 938 | 8715 | 1399 | 38 | 53 | 506 | 556 | 4777 | 1026 |
| gauss_dse2_lut40_ir | 618 | 618 | - | - | 32 | - | 546 | 546 | - | - |
| fir_dse2_lut60_ir | 709 | 709 | - | - | 44 | - | 656 | 656 | - | - |
| gauss_drum6_lat0_ir | 749 | 749 | - | - | 46 | - | 592 | 592 | - | - |
| gauss_t8c_loa6_lat0_ir | 730 | 730 | - | - | 21 | - | 546 | 546 | - | - |
| sobel_loa4_lat0_ir | 691 | 691 | - | - | 35 | - | 492 | 492 | - | - |
| sharpen_kul_lat0_ir | 530 | 530 | - | - | 23 | - | 384 | 384 | - | - |
| fir_t8c_loa11_lat0_ir | 782 | 782 | - | - | 33 | - | 519 | 519 | - | - |
| dot_t4_lat0_ir | 124 | 124 | - | - | 12 | - | 73 | 73 | - | - |
| gauss_dse_op40_lat0_ir | 669 | 669 | - | - | 23 | - | 507 | 507 | - | - |
| fir_dse_op60_lat0_ir | 938 | 938 | - | - | 38 | - | 556 | 556 | - | - |
| gauss_dse2_lut40_lat0_ir | 618 | 618 | - | - | 32 | - | 546 | 546 | - | - |
| fir_dse2_lut60_lat0_ir | 709 | 709 | - | - | 44 | - | 656 | 656 | - | - |
| gauss_drum6_inl_ir | 749 | 749 | - | - | 46 | - | 592 | 592 | - | - |
| gauss_t8c_loa6_inl_ir | 730 | 730 | - | - | 21 | - | 546 | 546 | - | - |
| sobel_loa4_inl_ir | 691 | 691 | - | - | 35 | - | 492 | 492 | - | - |
| sharpen_kul_inl_ir | 530 | 530 | - | - | 23 | - | 384 | 384 | - | - |
| fir_t8c_loa11_inl_ir | 782 | 782 | - | - | 33 | - | 519 | 519 | - | - |
| dot_t4_inl_ir | 124 | 124 | - | - | 12 | - | 73 | 73 | - | - |
| gauss_dse_op40_inl_ir | 669 | 669 | - | - | 23 | - | 507 | 507 | - | - |
| fir_dse_op60_inl_ir | 938 | 938 | - | - | 38 | - | 556 | 556 | - | - |
| gauss_dse2_lut40_inl_ir | 618 | 618 | - | - | 32 | - | 546 | 546 | - | - |
| fir_dse2_lut60_inl_ir | 709 | 709 | - | - | 44 | - | 656 | 656 | - | - |

#### Efeito da aproximação: LUTs contra o projeto exato do mesmo kernel

| Caso | Economia modelo 1 | Economia modelo | Economia Vivado | LUT Vivado exato | LUT Vivado aprox. |
| --- | ---: | ---: | ---: | ---: | ---: |
| gauss_drum6_ir | -1,1% | -6,5% | -21,5% | 729 | 886 |
| gauss_t8c_loa6_ir | 27,7% | -3,8% | -25,8% | 729 | 917 |
| sobel_loa4_ir | -0,7% | -7,3% | -12,5% | 674 | 758 |
| sharpen_kul_ir | 8,2% | -1,0% | -19,0% | 496 | 590 |
| fir_t8c_loa11_ir | 41,0% | 11,9% | -33,5% | 940 | 1255 |
| dot_t4_ir | 9,7% | 10,8% | -50,5% | 111 | 167 |
| gauss_dse_op40_ir | 35,3% | 4,8% | -6,2% | 729 | 774 |
| fir_dse_op60_ir | 33,3% | -5,6% | -48,8% | 940 | 1399 |

#### Unidades aproximadas no Vivado (funções com INLINE off): instâncias, LUT e FF por instância

| Caso | Unidade | Inst. Vivado | Inst. modelo | LUT Vivado | LUT modelo | FF Vivado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_drum6_ir | MUL8_DRUM6 | 3 | 3 | 87 | 40 | 53 |
| gauss_t8c_loa6_ir | ADD16_LOA6 | 4 | 4 | 65 | 15 | 43 |
| gauss_t8c_loa6_ir | MUL8_T8_C | 3 | 3 | 26 | 9 | 33 |
| sobel_loa4_ir | ADD16_LOA4 | 3 | 3 | 40 | 9 | 30 |
| sharpen_kul_ir | MUL8_KUL | 1 | 1 | 46 | 14 | 20 |
| fir_t8c_loa11_ir | ADD16_LOA11 | 14 | 11 | 6 | 11 | 9 |
| fir_t8c_loa11_ir | ADD32_ADD16_LOA11_ADD16_exato | 4 | 4 | 12 | 10 | 15 |
| fir_t8c_loa11_ir | MUL8_T8_C | 14 | 14 | 14 | 5 | 15 |
| dot_t4_ir | MUL8_T4 | 1 | 1 | 120 | 86 | 102 |
| gauss_dse_op40_ir | ADD16_LOA10 | 1 | 1 | 32 | 13 | 16 |
| gauss_dse_op40_ir | ADD16_LOA7 | 1 | 1 | 15 | 12 | 15 |
| gauss_dse_op40_ir | ADD16_LOA8 | 2 | 2 | 38 | 14 | 34 |
| gauss_dse_op40_ir | ADD16_LOA9 | 1 | 1 | 27 | 14 | 16 |
| gauss_dse_op40_ir | MUL8_T6_A4c | 1 | 1 | 4 | 6 | 6 |
| gauss_dse_op40_ir | MUL8_T8_C | 2 | 2 | 26 | 13 | 38 |
| fir_dse_op60_ir | ADD16_LOA10 | 2 | 1 | 5 | 9 | 7 |
| fir_dse_op60_ir | ADD16_LOA8 | 6 | 4 | 22 | 13 | 24 |
| fir_dse_op60_ir | ADD16_LOA9 | 5 | 5 | 13 | 13 | 15 |
| fir_dse_op60_ir | ADD32_ADD16_LOA10_ADD16_exato | 1 | 1 | 21 | 11 | 25 |
| fir_dse_op60_ir | ADD32_ADD16_LOA8_ADD16_exato | 2 | 2 | 30 | 14 | 48 |
| fir_dse_op60_ir | MUL8_DRUM2 | 1 | 1 | 17 | 29 | 27 |
| fir_dse_op60_ir | MUL8_DRUM3_C | 1 | 1 | 27 | 38 | 40 |
| fir_dse_op60_ir | MUL8_DRUM3 | 1 | 1 | 22 | 38 | 40 |
| fir_dse_op60_ir | MUL8_DRUM4 | 2 | 2 | 47 | 35 | 51 |
| fir_dse_op60_ir | MUL8_T6_A10c | 4 | 4 | 13 | 1 | 2 |
| fir_dse_op60_ir | MUL8_T8_C | 3 | 3 | 9 | 11 | 21 |

#### Laços: II, iteração (profundidade com pipeline) e latência, em ciclos

| Caso | Laço | Modo | Iterações | II modelo | II Vitis | Iteração modelo | Iteração Vitis | Latência modelo | Latência Vitis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | rows_cols | achatado | 36100 | 2 | 2 | 18 | 19 | 72217 | 72216 |
| gauss_ir | rows_cols | achatado | 36100 | 2 | 2 | 18 | 19 | 72217 | 72216 |
| sobel_src | rows_cols | achatado | 36100 | 2 | 2 | 18 | 20 | 72217 | 72217 |
| sobel_ir | rows_cols | achatado | 36100 | 2 | 2 | 18 | 20 | 72217 | 72217 |
| sharpen_src | rows_cols | achatado | 36100 | 2 | 2 | 17 | 19 | 72216 | 72216 |
| sharpen_ir | rows_cols | achatado | 36100 | 2 | 2 | 17 | 19 | 72216 | 72216 |
| fir_src | samples | pipeline | 1009 | 1 | 1 | 9 | 10 | 1018 | 1017 |
| fir_ir | samples | pipeline | 1009 | 1 | 1 | 9 | 15 | 1018 | 1022 |
| dot_src | acc | pipeline | 256 | 1 | 1 | 2 | 4 | 258 | 258 |
| dot_ir | acc | pipeline | 256 | 1 | 1 | 2 | 4 | 258 | 258 |
| gauss_var1_ir | rows_cols | achatado | 36100 | 5 | 5 | 6 | 10 | 180502 | 180504 |
| gauss_var2_ir | rows | sequencial | 190 | - | - | 16153 | 20523 | 3069070 | 3899370 |
| gauss_var2_ir | cols | sequencial | 190 | - | - | 85 | 108 | 16150 | 20520 |
| gauss_var2_ir | L3 | sequencial | 3 | - | - | 27 | 35 | 81 | 105 |
| gauss_var2_ir | L4 | sequencial | 3 | - | - | 4 | 7 | 12 | 21 |
| gauss_var3_ir | rows | sequencial | 190 | - | - | 7603 | 12543 | 1444570 | 2383170 |
| gauss_var3_ir | cols | sequencial | 190 | - | - | 40 | 66 | 7600 | 12540 |
| gauss_var3_ir | L3 | sequencial | 3 | - | - | 12 | 21 | 36 | 63 |
| gauss_var3_ir | L4 | sequencial | 3 | - | - | 3 | 6 | 9 | 18 |
| gauss_2p5ns_ir | rows_cols | achatado | 36100 | 2 | 2 | 25 | 23 | 72224 | 72220 |
| gauss_10ns_ir | rows_cols | achatado | 36100 | 2 | 2 | 17 | 18 | 72216 | 72215 |
| gauss_drum6_ir | rows_cols | achatado | 36100 | 2 | 2 | 18 | 23 | 72217 | 72220 |
| gauss_t8c_loa6_ir | rows_cols | achatado | 36100 | 2 | 2 | 18 | 38 | 72217 | 72235 |
| sobel_loa4_ir | rows_cols | achatado | 36100 | 2 | 2 | 18 | 25 | 72217 | 72222 |
| sharpen_kul_ir | rows_cols | achatado | 36100 | 2 | 2 | 17 | 20 | 72216 | 72217 |
| fir_t8c_loa11_ir | samples | pipeline | 1009 | 1 | 1 | 6 | 49 | 1015 | 1056 |
| dot_t4_ir | acc | pipeline | 256 | 1 | 1 | 2 | 8 | 258 | 262 |
| gauss_dse_op40_ir | rows_cols | achatado | 36100 | 2 | 2 | 17 | 34 | 72216 | 72231 |
| fir_dse_op60_ir | samples | pipeline | 1009 | 1 | 1 | 6 | 43 | 1015 | 1050 |

### Resíduos depois da calibração

Medianas: iteração de laço sequencial, Vitis menos modelo, 23 ciclos; entrada e saída do pipeline no Vitis (latência menos profundidade menos N menos 1 vezes o II) -1 ciclos; LUT Vivado / modelo 1,05; FF 1,22; latência Vitis / modelo 1,000; período Vivado / modelo 1,16. Valores em `results/vitis/calibracao.json`, com as constantes do modelo (`MODEL` em `js/hls/sched.js`).

