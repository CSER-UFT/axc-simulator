# Validação contra o Vitis HLS e o Vivado

Gerado por `node scripts/vitis.mjs compare` em 2026-10-25; parte xc7a100tcsg324-1. Cada caso é o mesmo projeto no simulador e no Vitis HLS 2022.2 (o C++ exportado do projeto elaborado, `_ir`, ou o código original, `_src`), com multiplicadores na lógica (sem DSP). LUT e FF do modelo vêm da síntese das unidades (Yosys `synth_xilinx`, ou o Vivado quando há data/vivado-units.json), mais as peças do modelo (multiplexadores, comparadores, registradores, contadores e a seleção de banco). A referência de recursos e de período é o Vivado depois do roteamento; a estimativa do csynth fica na tabela só para comparação. "Exportação" é a previsão feita quando o caso foi gerado (o modelo antes da primeira rodada, nos 23 primeiros casos; o calibrado com a primeira rodada, nos da segunda); "modelo" é o atual, para as mesmas atribuições de unidades, com LUT, CARRY4 e atrasos das unidades caracterizadas no Vivado (data/vivado-units.json).

61 de 61 casos com relatório do csynth; 61 com o Vivado (impl); 61 com csim.

#### Erro médio do modelo (desvio relativo médio entre o modelo e a medida)

| Grandeza | Casos | Exportação | Modelo |
| --- | ---: | ---: | ---: |
| Latência (ciclos), com pipeline | 59 | 0,8% | 0,3% |
| Latência (ciclos), sem pipeline | 2 | 60,9% | 8,4% |
| Latência (ciclos), todos | 61 | 2,7% | 0,6% |
| LUT (Vivado) | 61 | 24,1% | 14,6% |
| FF (Vivado) | 61 | 33,2% | 21,1% |
| Período (Vivado) | 61 | - | 17,8% |

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
| gauss_dse2_lut40_ir | 0 | 36100 |
| fir_dse2_lut60_ir | 0 | 1009 |
| gauss_drum6_lat0_ir | 0 | 36100 |
| gauss_t8c_loa6_lat0_ir | 0 | 36100 |
| sobel_loa4_lat0_ir | 0 | 36100 |
| sharpen_kul_lat0_ir | 0 | 36100 |
| fir_t8c_loa11_lat0_ir | 0 | 1009 |
| dot_t4_lat0_ir | 0 | 1 |
| gauss_dse_op40_lat0_ir | 0 | 36100 |
| fir_dse_op60_lat0_ir | 0 | 1009 |
| gauss_dse2_lut40_lat0_ir | 0 | 36100 |
| fir_dse2_lut60_lat0_ir | 0 | 1009 |
| gauss_drum6_inl_ir | 0 | 36100 |
| gauss_t8c_loa6_inl_ir | 0 | 36100 |
| sobel_loa4_inl_ir | 0 | 36100 |
| sharpen_kul_inl_ir | 0 | 36100 |
| fir_t8c_loa11_inl_ir | 0 | 1009 |
| dot_t4_inl_ir | 0 | 1 |
| gauss_dse_op40_inl_ir | 0 | 36100 |
| fir_dse_op60_inl_ir | 0 | 1009 |
| gauss_dse2_lut40_inl_ir | 0 | 36100 |
| fir_dse2_lut60_inl_ir | 0 | 1009 |
| gauss_drum6_rtl_ir | 0 | 36100 |
| gauss_t8c_loa6_rtl_ir | 0 | 36100 |
| sobel_loa4_rtl_ir | 0 | 36100 |
| sharpen_kul_rtl_ir | 0 | 36100 |
| fir_t8c_loa11_rtl_ir | 0 | 1009 |
| dot_t4_rtl_ir | 0 | 1 |
| gauss_dse_op40_rtl_ir | 0 | 36100 |
| fir_dse_op60_rtl_ir | 0 | 1009 |
| gauss_dse2_lut40_rtl_ir | 0 | 36100 |
| fir_dse2_lut60_rtl_ir | 0 | 1009 |
| sobel_sub_trunc3_rtl_ir | 0 | 36100 |
| sharpen_sub_trunc2_rtl_ir | 0 | 36100 |
| gauss_dse3_lut40_rtl_ir | 0 | 36100 |
| gauss_dse3_ssim98_rtl_ir | 0 | 36100 |
| fir_dse3_lut60_rtl_ir | 0 | 1009 |
| dot_dse3_lut40_rtl_ir | 0 | 1 |

#### Latência (ciclos) e período

| Caso | Exportação | Modelo | Vitis | Razão | Período modelo (ns) | csynth (ns) | Vivado (ns) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | 73340 | 72219 | 72218 | 1,000 | 4,03 | 7,05 | 5,35 |
| gauss_ir | 73340 | 72219 | 72218 | 1,000 | 4,03 | 7,05 | 5,38 |
| sobel_src | 73150 | 72218 | 72219 | 1,000 | 4,77 | 7,05 | 5,79 |
| sobel_ir | 73150 | 72218 | 72219 | 1,000 | 4,77 | 7,05 | 5,53 |
| sharpen_src | 72960 | 72217 | 72218 | 1,000 | 4,62 | 7,05 | 5,79 |
| sharpen_ir | 72960 | 72217 | 72218 | 1,000 | 4,62 | 7,05 | 5,31 |
| fir_src | 1018 | 1020 | 1019 | 1,001 | 4,03 | 6,36 | 4,49 |
| fir_ir | 1018 | 1020 | 1024 | 0,996 | 4,03 | 6,36 | 4,61 |
| dot_src | 259 | 261 | 260 | 1,004 | 4,03 | 6,36 | 5,76 |
| dot_ir | 259 | 261 | 260 | 1,004 | 4,03 | 6,36 | 5,72 |
| gauss_var1_ir | 181070 | 180503 | 180506 | 1,000 | 4,03 | 6,36 | 4,50 |
| gauss_var2_ir | 1155390 | 3718870 | 3899371 | 0,954 | 2,94 | 7,05 | 5,39 |
| gauss_var3_ir | 1155390 | 2094370 | 2383171 | 0,879 | 2,94 | 6,36 | 4,54 |
| gauss_2p5ns_ir | 74480 | 72225 | 72222 | 1,000 | 2,42 | 7,05 | 5,58 |
| gauss_10ns_ir | 72960 | 72216 | 72217 | 1,000 | 8,85 | 7,29 | 7,47 |
| gauss_drum6_ir | 73340 | 72220 | 72222 | 1,000 | 4,03 | 7,05 | 5,67 |
| gauss_t8c_loa6_ir | 73150 | 72220 | 72237 | 1,000 | 4,22 | 7,05 | 5,52 |
| sobel_loa4_ir | 73150 | 72218 | 72230 | 1,000 | 4,78 | 7,05 | 5,55 |
| sharpen_kul_ir | 72960 | 72218 | 72219 | 1,000 | 4,77 | 7,05 | 5,38 |
| fir_t8c_loa11_ir | 1015 | 1027 | 1058 | 0,971 | 4,52 | 3,73 | 4,45 |
| dot_t4_ir | 259 | 260 | 264 | 0,985 | 4,98 | 4,03 | 3,34 |
| gauss_dse_op40_ir | 72960 | 72219 | 72233 | 1,000 | 4,87 | 7,05 | 5,73 |
| fir_dse_op60_ir | 1015 | 1021 | 1052 | 0,971 | 4,98 | 3,73 | 4,26 |
| gauss_dse2_lut40_ir | 72217 | 72219 | 72224 | 1,000 | 4,95 | 7,05 | 5,64 |
| fir_dse2_lut60_ir | 1016 | 1020 | 1034 | 0,986 | 5,00 | 3,73 | 4,29 |
| gauss_drum6_lat0_ir | 72217 | 72220 | 72218 | 1,000 | 4,03 | 12,41 | 6,10 |
| gauss_t8c_loa6_lat0_ir | 72217 | 72220 | 72224 | 1,000 | 4,22 | 11,49 | 5,50 |
| sobel_loa4_lat0_ir | 72217 | 72218 | 72222 | 1,000 | 4,78 | 7,05 | 5,75 |
| sharpen_kul_lat0_ir | 72216 | 72218 | 72218 | 1,000 | 4,77 | 7,05 | 5,33 |
| fir_t8c_loa11_lat0_ir | 1015 | 1027 | 1030 | 0,997 | 4,52 | 11,49 | 4,14 |
| dot_t4_lat0_ir | 259 | 260 | 260 | 1,000 | 4,98 | 9,95 | 4,86 |
| gauss_dse_op40_lat0_ir | 72216 | 72219 | 72224 | 1,000 | 4,87 | 11,49 | 5,21 |
| fir_dse_op60_lat0_ir | 1015 | 1021 | 1030 | 0,991 | 4,98 | 12,39 | 4,57 |
| gauss_dse2_lut40_lat0_ir | 72217 | 72219 | 72220 | 1,000 | 4,95 | 11,49 | 5,47 |
| fir_dse2_lut60_lat0_ir | 1016 | 1020 | 1030 | 0,990 | 5,00 | 10,42 | 4,54 |
| gauss_drum6_inl_ir | 72217 | 72220 | 72218 | 1,000 | 4,03 | 7,05 | 5,53 |
| gauss_t8c_loa6_inl_ir | 72217 | 72220 | 72222 | 1,000 | 4,22 | 7,05 | 5,82 |
| sobel_loa4_inl_ir | 72217 | 72218 | 72222 | 1,000 | 4,78 | 7,05 | 5,61 |
| sharpen_kul_inl_ir | 72216 | 72218 | 72218 | 1,000 | 4,77 | 7,05 | 5,37 |
| fir_t8c_loa11_inl_ir | 1015 | 1027 | 1030 | 0,997 | 4,52 | 3,73 | 4,40 |
| dot_t4_inl_ir | 259 | 260 | 262 | 0,992 | 4,98 | 4,03 | 3,66 |
| gauss_dse_op40_inl_ir | 72216 | 72219 | 72222 | 1,000 | 4,87 | 7,05 | 5,74 |
| fir_dse_op60_inl_ir | 1015 | 1021 | 1036 | 0,986 | 4,98 | 3,73 | 4,42 |
| gauss_dse2_lut40_inl_ir | 72217 | 72219 | 72220 | 1,000 | 4,95 | 7,05 | 5,71 |
| fir_dse2_lut60_inl_ir | 1016 | 1020 | 1030 | 0,990 | 5,00 | 3,73 | 4,51 |
| gauss_drum6_rtl_ir | 72220 | 72220 | 72218 | 1,000 | 4,03 | 7,05 | 7,23 |
| gauss_t8c_loa6_rtl_ir | 72220 | 72220 | 72224 | 1,000 | 4,22 | 7,05 | 5,60 |
| sobel_loa4_rtl_ir | 72218 | 72218 | 72222 | 1,000 | 4,78 | 7,05 | 5,53 |
| sharpen_kul_rtl_ir | 72218 | 72218 | 72218 | 1,000 | 4,77 | 7,05 | 5,33 |
| fir_t8c_loa11_rtl_ir | 1027 | 1027 | 1031 | 0,996 | 4,52 | 3,73 | 4,03 |
| dot_t4_rtl_ir | 260 | 260 | 260 | 1,000 | 4,98 | 4,03 | 5,22 |
| gauss_dse_op40_rtl_ir | 72219 | 72219 | 72224 | 1,000 | 4,87 | 7,05 | 5,97 |
| fir_dse_op60_rtl_ir | 1021 | 1021 | 1031 | 0,990 | 4,98 | 3,73 | 4,75 |
| gauss_dse2_lut40_rtl_ir | 72219 | 72219 | 72224 | 1,000 | 4,95 | 7,05 | 5,37 |
| fir_dse2_lut60_rtl_ir | 1020 | 1020 | 1031 | 0,989 | 5,00 | 3,73 | 4,60 |
| sobel_sub_trunc3_rtl_ir | 72218 | 72218 | 72222 | 1,000 | 4,45 | 7,05 | 5,55 |
| sharpen_sub_trunc2_rtl_ir | 72217 | 72217 | 72220 | 1,000 | 4,56 | 7,05 | 5,35 |
| gauss_dse3_lut40_rtl_ir | 72218 | 72218 | 72224 | 1,000 | 4,99 | 7,05 | 5,76 |
| gauss_dse3_ssim98_rtl_ir | 72218 | 72218 | 72224 | 1,000 | 5,00 | 7,05 | 5,51 |
| fir_dse3_lut60_rtl_ir | 1018 | 1018 | 1031 | 0,987 | 4,95 | 6,36 | 4,20 |
| dot_dse3_lut40_rtl_ir | 259 | 259 | 259 | 1,000 | 3,80 | 7,38 | 3,59 |

#### Recursos de FPGA

| Caso | LUT exportação | LUT modelo | LUT csynth | LUT Vivado | CARRY4 modelo | CARRY4 Vivado | FF exportação | FF modelo | FF csynth | FF Vivado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | 549 | 752 | 2240 | 731 | 70 | 138 | 309 | 654 | 1321 | 618 |
| gauss_ir | 549 | 752 | 2192 | 729 | 70 | 141 | 309 | 654 | 1137 | 590 |
| sobel_src | 401 | 683 | 1892 | 655 | 43 | 118 | 180 | 538 | 1206 | 565 |
| sobel_ir | 401 | 683 | 1913 | 675 | 43 | 118 | 180 | 538 | 1288 | 568 |
| sharpen_src | 267 | 543 | 1655 | 493 | 24 | 94 | 88 | 449 | 979 | 431 |
| sharpen_ir | 267 | 543 | 1658 | 496 | 24 | 94 | 88 | 449 | 1015 | 468 |
| fir_src | 1740 | 1024 | 3454 | 1108 | 114 | 125 | 736 | 593 | 1079 | 946 |
| fir_ir | 1740 | 1024 | 3635 | 940 | 114 | 107 | 736 | 593 | 1392 | 857 |
| dot_src | 155 | 137 | 180 | 111 | 19 | 18 | 73 | 100 | 74 | 76 |
| dot_ir | 155 | 137 | 180 | 111 | 19 | 18 | 73 | 100 | 74 | 74 |
| gauss_var1_ir | 259 | 457 | 1096 | 397 | 70 | 93 | 180 | 327 | 450 | 424 |
| gauss_var2_ir | 179 | 250 | 670 | 177 | 23 | 35 | 59 | 145 | 356 | 281 |
| gauss_var3_ir | 179 | 162 | 433 | 117 | 23 | 24 | 59 | 103 | 203 | 196 |
| gauss_2p5ns_ir | 735 | 792 | 2285 | 903 | 70 | 123 | 703 | 806 | 3217 | 926 |
| gauss_10ns_ir | 549 | 713 | 2160 | 700 | 70 | 135 | 225 | 540 | 1159 | 480 |
| gauss_drum6_ir | 555 | 877 | 4422 | 886 | 51 | 147 | 309 | 657 | 2651 | 845 |
| gauss_t8c_loa6_ir | 397 | 718 | 3879 | 917 | 28 | 141 | 234 | 657 | 2666 | 901 |
| sobel_loa4_ir | 404 | 688 | 2887 | 810 | 36 | 117 | 180 | 549 | 2138 | 826 |
| sharpen_kul_ir | 245 | 556 | 1773 | 590 | 23 | 101 | 88 | 477 | 1128 | 487 |
| fir_t8c_loa11_ir | 1027 | 978 | 10117 | 1255 | 12 | - | 469 | 744 | 4784 | 806 |
| dot_t4_ir | 140 | 124 | 917 | 167 | 12 | 28 | 73 | 100 | 501 | 169 |
| gauss_dse_op40_ir | 355 | 689 | 3564 | 774 | 24 | 123 | 211 | 646 | 2329 | 788 |
| fir_dse_op60_ir | 1161 | 1046 | 8715 | 1399 | 30 | 53 | 506 | 637 | 4777 | 1026 |
| gauss_dse2_lut40_ir | 618 | 674 | 4143 | 861 | 29 | 173 | 546 | 638 | 2084 | 687 |
| fir_dse2_lut60_ir | 709 | 845 | 7919 | 987 | 39 | 128 | 656 | 621 | 2444 | 648 |
| gauss_drum6_lat0_ir | 749 | 877 | 3834 | 856 | 51 | 150 | 592 | 657 | 1181 | 621 |
| gauss_t8c_loa6_lat0_ir | 730 | 718 | 3775 | 789 | 28 | 137 | 546 | 657 | 1682 | 616 |
| sobel_loa4_lat0_ir | 691 | 688 | 2632 | 759 | 36 | 115 | 492 | 549 | 1401 | 588 |
| sharpen_kul_lat0_ir | 530 | 556 | 1840 | 526 | 23 | 101 | 384 | 477 | 1015 | 458 |
| fir_t8c_loa11_lat0_ir | 782 | 978 | 9442 | 632 | 12 | - | 519 | 744 | 1785 | 489 |
| dot_t4_lat0_ir | 124 | 124 | 757 | 174 | 12 | 28 | 73 | 100 | 74 | 65 |
| gauss_dse_op40_lat0_ir | 669 | 689 | 3550 | 727 | 24 | 123 | 507 | 646 | 1722 | 610 |
| fir_dse_op60_lat0_ir | 938 | 1046 | 7811 | 806 | 30 | 50 | 556 | 637 | 1683 | 552 |
| gauss_dse2_lut40_lat0_ir | 618 | 674 | 3933 | 826 | 29 | 173 | 546 | 638 | 1465 | 574 |
| fir_dse2_lut60_lat0_ir | 709 | 845 | 7855 | 934 | 39 | 129 | 656 | 621 | 1785 | 531 |
| gauss_drum6_inl_ir | 749 | 877 | 4044 | 1000 | 51 | 169 | 592 | 657 | 1275 | 645 |
| gauss_t8c_loa6_inl_ir | 730 | 718 | 4133 | 867 | 28 | 162 | 546 | 657 | 2259 | 753 |
| sobel_loa4_inl_ir | 691 | 688 | 3219 | 739 | 36 | 115 | 492 | 549 | 2210 | 688 |
| sharpen_kul_inl_ir | 530 | 556 | 1847 | 531 | 23 | 101 | 384 | 477 | 1025 | 464 |
| fir_t8c_loa11_inl_ir | 782 | 978 | 8789 | 686 | 12 | - | 519 | 744 | 6899 | 770 |
| dot_t4_inl_ir | 124 | 124 | 821 | 166 | 12 | 30 | 73 | 100 | 409 | 143 |
| gauss_dse_op40_inl_ir | 669 | 689 | 3519 | 727 | 24 | 125 | 507 | 646 | 1880 | 712 |
| fir_dse_op60_inl_ir | 938 | 1046 | 10762 | 1063 | 30 | 35 | 556 | 637 | 10844 | 1062 |
| gauss_dse2_lut40_inl_ir | 618 | 674 | 3772 | 815 | 29 | 160 | 546 | 638 | 1670 | 646 |
| fir_dse2_lut60_inl_ir | 709 | 845 | 8958 | 1025 | 39 | 85 | 656 | 621 | 7508 | 935 |
| gauss_drum6_rtl_ir | 877 | 877 | 1921 | 807 | 51 | 120 | 635 | 657 | 1152 | 585 |
| gauss_t8c_loa6_rtl_ir | 795 | 718 | 2043 | 638 | 28 | 111 | 635 | 657 | 1682 | 630 |
| sobel_loa4_rtl_ir | 728 | 688 | 2023 | 702 | 36 | 105 | 516 | 549 | 1469 | 627 |
| sharpen_kul_rtl_ir | 556 | 556 | 1640 | 497 | 23 | 94 | 455 | 477 | 1015 | 459 |
| fir_t8c_loa11_rtl_ir | 978 | 978 | 3256 | 665 | 12 | 12 | 733 | 744 | 2089 | 487 |
| dot_t4_rtl_ir | 124 | 124 | 118 | 116 | 12 | 13 | 89 | 100 | 74 | 64 |
| gauss_dse_op40_rtl_ir | 709 | 689 | 1965 | 631 | 24 | 109 | 624 | 646 | 1690 | 607 |
| fir_dse_op60_rtl_ir | 1046 | 1046 | 3256 | 729 | 30 | 28 | 626 | 637 | 2089 | 560 |
| gauss_dse2_lut40_rtl_ir | 674 | 674 | 1939 | 650 | 29 | 118 | 616 | 638 | 1682 | 620 |
| fir_dse2_lut60_rtl_ir | 845 | 845 | 3256 | 666 | 39 | 42 | 610 | 621 | 2089 | 547 |
| sobel_sub_trunc3_rtl_ir | 665 | 665 | 2023 | 674 | 37 | 105 | 538 | 538 | 1469 | 592 |
| sharpen_sub_trunc2_rtl_ir | 535 | 535 | 1716 | 551 | 21 | 94 | 449 | 449 | 1134 | 486 |
| gauss_dse3_lut40_rtl_ir | 632 | 632 | 1939 | 658 | 29 | 121 | 586 | 608 | 1682 | 620 |
| gauss_dse3_ssim98_rtl_ir | 620 | 620 | 1913 | 621 | 27 | 117 | 599 | 621 | 1700 | 646 |
| fir_dse3_lut60_rtl_ir | 795 | 795 | 3355 | 716 | 50 | 59 | 562 | 573 | 2087 | 569 |
| dot_dse3_lut40_rtl_ir | 37 | 36 | 102 | 34 | 4 | - | 73 | 84 | 55 | 25 |

#### Efeito da aproximação: LUTs contra o projeto exato do mesmo kernel

| Caso | Economia na exportação | Economia modelo | Economia Vivado | LUT Vivado exato | LUT Vivado aprox. |
| --- | ---: | ---: | ---: | ---: | ---: |
| gauss_drum6_ir | -1,1% | -16,6% | -21,5% | 729 | 886 |
| gauss_t8c_loa6_ir | 27,7% | 4,5% | -25,8% | 729 | 917 |
| sobel_loa4_ir | -0,7% | -0,7% | -20,0% | 675 | 810 |
| sharpen_kul_ir | 8,2% | -2,4% | -19,0% | 496 | 590 |
| fir_t8c_loa11_ir | 41,0% | 4,5% | -33,5% | 940 | 1255 |
| dot_t4_ir | 9,7% | 9,5% | -50,5% | 111 | 167 |
| gauss_dse_op40_ir | 35,3% | 8,4% | -6,2% | 729 | 774 |
| fir_dse_op60_ir | 33,3% | -2,1% | -48,8% | 940 | 1399 |
| gauss_dse2_lut40_ir | - | 10,4% | -18,1% | 729 | 861 |
| fir_dse2_lut60_ir | - | 17,5% | -5,0% | 940 | 987 |
| gauss_drum6_lat0_ir | - | -16,6% | -17,4% | 729 | 856 |
| gauss_t8c_loa6_lat0_ir | - | 4,5% | -8,2% | 729 | 789 |
| sobel_loa4_lat0_ir | - | -0,7% | -12,4% | 675 | 759 |
| sharpen_kul_lat0_ir | - | -2,4% | -6,0% | 496 | 526 |
| fir_t8c_loa11_lat0_ir | - | 4,5% | 32,8% | 940 | 632 |
| dot_t4_lat0_ir | - | 9,5% | -56,8% | 111 | 174 |
| gauss_dse_op40_lat0_ir | - | 8,4% | 0,3% | 729 | 727 |
| fir_dse_op60_lat0_ir | - | -2,1% | 14,3% | 940 | 806 |
| gauss_dse2_lut40_lat0_ir | - | 10,4% | -13,3% | 729 | 826 |
| fir_dse2_lut60_lat0_ir | - | 17,5% | 0,6% | 940 | 934 |
| gauss_drum6_inl_ir | - | -16,6% | -37,2% | 729 | 1000 |
| gauss_t8c_loa6_inl_ir | - | 4,5% | -18,9% | 729 | 867 |
| sobel_loa4_inl_ir | - | -0,7% | -9,5% | 675 | 739 |
| sharpen_kul_inl_ir | - | -2,4% | -7,1% | 496 | 531 |
| fir_t8c_loa11_inl_ir | - | 4,5% | 27,0% | 940 | 686 |
| dot_t4_inl_ir | - | 9,5% | -49,5% | 111 | 166 |
| gauss_dse_op40_inl_ir | - | 8,4% | 0,3% | 729 | 727 |
| fir_dse_op60_inl_ir | - | -2,1% | -13,1% | 940 | 1063 |
| gauss_dse2_lut40_inl_ir | - | 10,4% | -11,8% | 729 | 815 |
| fir_dse2_lut60_inl_ir | - | 17,5% | -9,0% | 940 | 1025 |
| gauss_drum6_rtl_ir | - | -16,6% | -10,7% | 729 | 807 |
| gauss_t8c_loa6_rtl_ir | - | 4,5% | 12,5% | 729 | 638 |
| sobel_loa4_rtl_ir | - | -0,7% | -4,0% | 675 | 702 |
| sharpen_kul_rtl_ir | - | -2,4% | -0,2% | 496 | 497 |
| fir_t8c_loa11_rtl_ir | - | 4,5% | 29,3% | 940 | 665 |
| dot_t4_rtl_ir | - | 9,5% | -4,5% | 111 | 116 |
| gauss_dse_op40_rtl_ir | - | 8,4% | 13,4% | 729 | 631 |
| fir_dse_op60_rtl_ir | - | -2,1% | 22,4% | 940 | 729 |
| gauss_dse2_lut40_rtl_ir | - | 10,4% | 10,8% | 729 | 650 |
| fir_dse2_lut60_rtl_ir | - | 17,5% | 29,1% | 940 | 666 |
| gauss_dse3_lut40_rtl_ir | - | 16,0% | 9,7% | 729 | 658 |
| gauss_dse3_ssim98_rtl_ir | - | 17,6% | 14,8% | 729 | 621 |
| fir_dse3_lut60_rtl_ir | - | 22,4% | 23,8% | 940 | 716 |
| dot_dse3_lut40_rtl_ir | - | 73,7% | 69,4% | 111 | 34 |

#### Economia de LUTs prevista contra a medida, por forma de exportação das unidades

| Exportação | Casos | Erro médio | Mesmo sentido | Maior economia medida |
| --- | ---: | ---: | ---: | ---: |
| INLINE off (o Vitis divide a netlist em estágios) | 10 | 28,1 p.p. | 4 de 10 | -5,0% |
| combinacional (INLINE off, LATENCY 0) | 10 | 18,8 p.p. | 5 de 10 | 32,8% |
| em linha (INLINE) | 10 | 20,7 p.p. | 5 de 10 | 27,0% |
| RTL (caixa preta) | 14 | 8,2 p.p. | 12 de 14 | 69,4% |

#### Unidades aproximadas no Vivado (funções com INLINE off): instâncias, LUT e FF por instância

| Caso | Unidade | Inst. Vivado | Inst. modelo | LUT Vivado | LUT modelo | FF Vivado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_drum6_ir | MUL8_DRUM6 | 3 | 5 | 87 | 38 | 53 |
| gauss_t8c_loa6_ir | ADD16_LOA6 | 4 | 8 | 65 | 13 | 43 |
| gauss_t8c_loa6_ir | MUL8_T8_C | 3 | 5 | 26 | 7 | 33 |
| sobel_loa4_ir | ADD16_LOA4 | 7 | 13 | 35 | 8 | 27 |
| sharpen_kul_ir | MUL8_KUL | 1 | 1 | 46 | 14 | 20 |
| fir_t8c_loa11_ir | ADD16_LOA11 | 14 | 11 | 6 | 12 | 9 |
| fir_t8c_loa11_ir | ADD32_ADD16_LOA11_ADD16_exato | 4 | 4 | 12 | 11 | 15 |
| fir_t8c_loa11_ir | MUL8_T8_C | 14 | 14 | 14 | 6 | 15 |
| dot_t4_ir | MUL8_T4 | 1 | 1 | 120 | 76 | 102 |
| gauss_dse_op40_ir | ADD16_LOA10 | 1 | 1 | 32 | 12 | 16 |
| gauss_dse_op40_ir | ADD16_LOA7 | 1 | 1 | 15 | 11 | 15 |
| gauss_dse_op40_ir | ADD16_LOA8 | 2 | 3 | 38 | 13 | 34 |
| gauss_dse_op40_ir | ADD16_LOA9 | 1 | 1 | 27 | 13 | 16 |
| gauss_dse_op40_ir | MUL8_T6_A4c | 1 | 1 | 4 | 7 | 6 |
| gauss_dse_op40_ir | MUL8_T8_C | 2 | 4 | 26 | 8 | 38 |
| fir_dse_op60_ir | ADD16_LOA10 | 2 | 1 | 5 | 8 | 7 |
| fir_dse_op60_ir | ADD16_LOA8 | 6 | 4 | 22 | 13 | 24 |
| fir_dse_op60_ir | ADD16_LOA9 | 5 | 5 | 13 | 13 | 15 |
| fir_dse_op60_ir | ADD32_ADD16_LOA10_ADD16_exato | 1 | 1 | 21 | 10 | 25 |
| fir_dse_op60_ir | ADD32_ADD16_LOA8_ADD16_exato | 2 | 2 | 30 | 13 | 48 |
| fir_dse_op60_ir | MUL8_DRUM2 | 1 | 1 | 17 | 23 | 27 |
| fir_dse_op60_ir | MUL8_DRUM3_C | 1 | 1 | 27 | 36 | 40 |
| fir_dse_op60_ir | MUL8_DRUM3 | 1 | 1 | 22 | 36 | 40 |
| fir_dse_op60_ir | MUL8_DRUM4 | 2 | 2 | 47 | 31 | 51 |
| fir_dse_op60_ir | MUL8_T6_A10c | 4 | 4 | 13 | 1 | 2 |
| fir_dse_op60_ir | MUL8_T8_C | 3 | 3 | 9 | 11 | 21 |
| gauss_dse2_lut40_ir | MUL8_T8_C | 3 | 5 | 26 | 7 | 34 |
| fir_dse2_lut60_ir | MUL8_T6_A10c | 6 | 6 | 9 | 2 | 3 |
| fir_dse2_lut60_ir | MUL8_T6_A2c | 1 | 1 | 6 | 6 | 8 |
| fir_dse2_lut60_ir | MUL8_T8_C | 6 | 6 | 9 | 9 | 19 |
| fir_dse2_lut60_ir | ADD32_ADD16_TRUNC7_ADD16_exato | 2 | 4 | 4 | 6 | 0 |
| fir_dse2_lut60_ir | ADD16_TRUNC7 | 2 | 5 | 4 | 5 | 0 |
| sobel_loa4_lat0_ir | ADD16_LOA4 | 2 | 13 | 10 | 8 | 0 |
| gauss_dse_op40_lat0_ir | MUL8_T6_A4c | 1 | 1 | 2 | 7 | 0 |
| fir_dse2_lut60_lat0_ir | ADD32_ADD16_TRUNC7_ADD16_exato | 2 | 4 | 4 | 6 | 0 |
| fir_dse2_lut60_lat0_ir | ADD16_TRUNC7 | 2 | 5 | 4 | 5 | 0 |
| gauss_t8c_loa6_rtl_ir | ADD16_LOA6_bb | 4 | - | 7 | - | 0 |
| gauss_t8c_loa6_rtl_ir | MUL8_T8_C_bb | 1 | - | 23 | - | 0 |
| sobel_loa4_rtl_ir | ADD16_LOA4_bb | 6 | - | 13 | - | 0 |
| sharpen_kul_rtl_ir | MUL8_KUL_bb | 1 | - | 13 | - | 0 |
| dot_t4_rtl_ir | MUL8_T4_bb | 1 | - | 70 | - | 0 |
| gauss_dse_op40_rtl_ir | ADD16_LOA8_bb | 2 | - | 6 | - | 0 |
| gauss_dse_op40_rtl_ir | MUL8_T8_C_bb | 1 | - | 22 | - | 0 |
| gauss_dse_op40_rtl_ir | MUL8_T6_A4c_bb | 1 | - | 2 | - | 0 |
| gauss_dse_op40_rtl_ir | ADD16_LOA9_bb | 1 | - | 5 | - | 0 |
| gauss_dse_op40_rtl_ir | ADD16_LOA7_bb | 1 | - | 5 | - | 0 |
| gauss_dse_op40_rtl_ir | ADD16_TRUNC7_bb | 1 | - | 6 | - | 0 |
| gauss_dse_op40_rtl_ir | ADD16_TRUNC8_bb | 1 | - | 5 | - | 0 |
| fir_dse_op60_rtl_ir | ADD16_LOA8_bb | 6 | - | 5 | - | 0 |
| fir_dse_op60_rtl_ir | ADD16_LOA9_bb | 3 | - | 5 | - | 0 |
| fir_dse_op60_rtl_ir | ADD16_LOA10_bb | 1 | - | 6 | - | 0 |
| gauss_dse2_lut40_rtl_ir | MUL8_T8_C_bb | 1 | - | 23 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC7_bb | 1 | - | 5 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC5_bb | 1 | - | 6 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC6_bb | 1 | - | 6 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC1_bb | 1 | - | 7 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC2_bb | 1 | - | 6 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC4_bb | 1 | - | 7 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC8_bb | 1 | - | 5 | - | 0 |
| gauss_dse2_lut40_rtl_ir | ADD16_TRUNC3_bb | 1 | - | 8 | - | 0 |
| fir_dse2_lut60_rtl_ir | ADD16_TRUNC7_bb | 9 | - | 5 | - | 0 |
| fir_dse2_lut60_rtl_ir | ADD16_TRUNC6_bb | 6 | - | 6 | - | 0 |
| gauss_dse3_lut40_rtl_ir | MUL8_T8_C_bb | 1 | - | 23 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_TRUNC4_bb | 1 | - | 7 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_TRUNC2_bb | 1 | - | 8 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_TRUNC6_bb | 1 | - | 6 | - | 0 |
| gauss_dse3_lut40_rtl_ir | MUL8_T4_C_bb | 1 | - | 19 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_TRUNC3_bb | 1 | - | 8 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_TRUNC7_bb | 1 | - | 6 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_TRUNC8_bb | 1 | - | 6 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_TRUNC5_bb | 1 | - | 8 | - | 0 |
| gauss_dse3_lut40_rtl_ir | ADD16_LOA5_bb | 1 | - | 5 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | MUL8_T4_C_bb | 1 | - | 8 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC9_bb | 1 | - | 6 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC2_bb | 1 | - | 4 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | MUL8_T8_C_bb | 1 | - | 4 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC6_bb | 1 | - | 6 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC3_bb | 1 | - | 8 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC7_bb | 1 | - | 5 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC8_bb | 1 | - | 5 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC5_bb | 1 | - | 8 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | ADD16_TRUNC4_bb | 1 | - | 5 | - | 0 |
| gauss_dse3_ssim98_rtl_ir | MUL8_T6_bb | 1 | - | 8 | - | 0 |
| fir_dse3_lut60_rtl_ir | ADD16_TRUNC6_bb | 3 | - | 5 | - | 0 |
| fir_dse3_lut60_rtl_ir | ADD16_TRUNC7_bb | 7 | - | 5 | - | 0 |
| fir_dse3_lut60_rtl_ir | ADD16_TRUNC5_bb | 4 | - | 6 | - | 0 |

#### Laços: II, iteração (profundidade com pipeline) e latência, em ciclos

| Caso | Laço | Modo | Iterações | II modelo | II Vitis | Iteração modelo | Iteração Vitis | Latência modelo | Latência Vitis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| gauss_src | rows_cols | achatado | 36100 | 2 | 2 | 20 | 19 | 72219 | 72216 |
| gauss_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 19 | 72219 | 72216 |
| sobel_src | rows_cols | achatado | 36100 | 2 | 2 | 19 | 20 | 72218 | 72217 |
| sobel_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 20 | 72218 | 72217 |
| sharpen_src | rows_cols | achatado | 36100 | 2 | 2 | 18 | 19 | 72217 | 72216 |
| sharpen_ir | rows_cols | achatado | 36100 | 2 | 2 | 18 | 19 | 72217 | 72216 |
| fir_src | samples | pipeline | 1009 | 1 | 1 | 11 | 10 | 1020 | 1017 |
| fir_ir | samples | pipeline | 1009 | 1 | 1 | 11 | 15 | 1020 | 1022 |
| dot_src | acc | pipeline | 256 | 1 | 1 | 4 | 4 | 260 | 258 |
| dot_ir | acc | pipeline | 256 | 1 | 1 | 4 | 4 | 260 | 258 |
| gauss_var1_ir | rows_cols | achatado | 36100 | 5 | 5 | 7 | 10 | 180503 | 180504 |
| gauss_var2_ir | rows | sequencial | 190 | - | - | 19573 | 20523 | 3718870 | 3899370 |
| gauss_var2_ir | cols | sequencial | 190 | - | - | 103 | 108 | 19570 | 20520 |
| gauss_var2_ir | L3 | sequencial | 3 | - | - | 33 | 35 | 99 | 105 |
| gauss_var2_ir | L4 | sequencial | 3 | - | - | 6 | 7 | 18 | 21 |
| gauss_var3_ir | rows | sequencial | 190 | - | - | 11023 | 12543 | 2094370 | 2383170 |
| gauss_var3_ir | cols | sequencial | 190 | - | - | 58 | 66 | 11020 | 12540 |
| gauss_var3_ir | L3 | sequencial | 3 | - | - | 18 | 21 | 54 | 63 |
| gauss_var3_ir | L4 | sequencial | 3 | - | - | 5 | 6 | 15 | 18 |
| gauss_2p5ns_ir | rows_cols | achatado | 36100 | 2 | 2 | 26 | 23 | 72225 | 72220 |
| gauss_10ns_ir | rows_cols | achatado | 36100 | 2 | 2 | 17 | 18 | 72216 | 72215 |
| gauss_drum6_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 23 | 72220 | 72220 |
| gauss_t8c_loa6_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 38 | 72220 | 72235 |
| sobel_loa4_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 31 | 72218 | 72228 |
| sharpen_kul_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 20 | 72218 | 72217 |
| fir_t8c_loa11_ir | samples | pipeline | 1009 | 1 | 1 | 18 | 49 | 1027 | 1056 |
| dot_t4_ir | acc | pipeline | 256 | 1 | 1 | 3 | 8 | 259 | 262 |
| gauss_dse_op40_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 34 | 72219 | 72231 |
| fir_dse_op60_ir | samples | pipeline | 1009 | 1 | 1 | 12 | 43 | 1021 | 1050 |
| gauss_dse2_lut40_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 25 | 72219 | 72222 |
| fir_dse2_lut60_ir | samples | pipeline | 1009 | 1 | 1 | 11 | 25 | 1020 | 1032 |
| gauss_drum6_lat0_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 19 | 72220 | 72216 |
| gauss_t8c_loa6_lat0_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 25 | 72220 | 72222 |
| sobel_loa4_lat0_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 23 | 72218 | 72220 |
| sharpen_kul_lat0_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 19 | 72218 | 72216 |
| fir_t8c_loa11_lat0_ir | samples | pipeline | 1009 | 1 | 1 | 18 | 21 | 1027 | 1028 |
| dot_t4_lat0_ir | acc | pipeline | 256 | 1 | 1 | 3 | 4 | 259 | 258 |
| gauss_dse_op40_lat0_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 25 | 72219 | 72222 |
| fir_dse_op60_lat0_ir | samples | pipeline | 1009 | 1 | 1 | 12 | 21 | 1021 | 1028 |
| gauss_dse2_lut40_lat0_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 21 | 72219 | 72218 |
| fir_dse2_lut60_lat0_ir | samples | pipeline | 1009 | 1 | 1 | 11 | 21 | 1020 | 1028 |
| gauss_drum6_inl_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 19 | 72220 | 72216 |
| gauss_t8c_loa6_inl_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 23 | 72220 | 72220 |
| sobel_loa4_inl_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 23 | 72218 | 72220 |
| sharpen_kul_inl_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 19 | 72218 | 72216 |
| fir_t8c_loa11_inl_ir | samples | pipeline | 1009 | 1 | 1 | 18 | 21 | 1027 | 1028 |
| dot_t4_inl_ir | acc | pipeline | 256 | 1 | 1 | 3 | 6 | 259 | 260 |
| gauss_dse_op40_inl_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 23 | 72219 | 72220 |
| fir_dse_op60_inl_ir | samples | pipeline | 1009 | 1 | 1 | 12 | 27 | 1021 | 1034 |
| gauss_dse2_lut40_inl_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 21 | 72219 | 72218 |
| fir_dse2_lut60_inl_ir | samples | pipeline | 1009 | 1 | 1 | 11 | 21 | 1020 | 1028 |
| gauss_drum6_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 19 | 72220 | 72216 |
| gauss_t8c_loa6_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 21 | 25 | 72220 | 72222 |
| sobel_loa4_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 23 | 72218 | 72220 |
| sharpen_kul_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 19 | 72218 | 72216 |
| fir_t8c_loa11_rtl_ir | samples | pipeline | 1009 | 1 | 1 | 18 | 22 | 1027 | 1029 |
| dot_t4_rtl_ir | acc | pipeline | 256 | 1 | 1 | 3 | 4 | 259 | 258 |
| gauss_dse_op40_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 25 | 72219 | 72222 |
| fir_dse_op60_rtl_ir | samples | pipeline | 1009 | 1 | 1 | 12 | 22 | 1021 | 1029 |
| gauss_dse2_lut40_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 20 | 25 | 72219 | 72222 |
| fir_dse2_lut60_rtl_ir | samples | pipeline | 1009 | 1 | 1 | 11 | 22 | 1020 | 1029 |
| sobel_sub_trunc3_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 23 | 72218 | 72220 |
| sharpen_sub_trunc2_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 18 | 21 | 72217 | 72218 |
| gauss_dse3_lut40_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 25 | 72218 | 72222 |
| gauss_dse3_ssim98_rtl_ir | rows_cols | achatado | 36100 | 2 | 2 | 19 | 25 | 72218 | 72222 |
| fir_dse3_lut60_rtl_ir | samples | pipeline | 1009 | 1 | 1 | 9 | 22 | 1018 | 1029 |
| dot_dse3_lut40_rtl_ir | acc | pipeline | 256 | 1 | 1 | 2 | 3 | 258 | 257 |

### Resíduos depois da calibração

Medianas: iteração de laço sequencial, Vitis menos modelo, 5 ciclos; entrada e saída do pipeline no Vitis (latência menos profundidade menos N menos 1 vezes o II) -1 ciclos; LUT Vivado / modelo 1,00; FF 1,02; latência Vitis / modelo 1,000; período Vivado / modelo 1,15. Valores em `results/vitis/calibracao.json`, com as constantes do modelo (`MODEL` em `js/hls/sched.js`).

