// pad2 (projeto elaborado): gerado pelo axc-simulator (scripts/vitis.mjs). Não editar: o export gera de novo.
#include <ap_int.h>

#include "kernel.h"





void pad2(ap_uint<8> x[42][14], ap_uint<8> y[54][18]) {
#pragma HLS INTERFACE mode=ap_memory port=x storage_type=ram_t2p
#pragma HLS INTERFACE mode=ap_memory port=y storage_type=ram_t2p
    pad2_c: for (int t1 = 0; t1 < 3; t1++) {
#pragma HLS PIPELINE off
        pad2_top: for (int t2 = 0; t2 < 2; t2++) {
#pragma HLS PIPELINE off
            L3: for (int t3 = 0; t3 < 18; t3++) {
#pragma HLS PIPELINE II=1
                y[18 * t1 + t2][t3] = ap_uint<1>(0ULL);
                y[18 * t1 + t2 + 16][t3] = ap_uint<1>(0ULL);
            }
        }
        pad2_left: for (int t4 = 0; t4 < 14; t4++) {
#pragma HLS PIPELINE off
            L5: for (int t5 = 0; t5 < 2; t5++) {
#pragma HLS PIPELINE II=1
                y[18 * t1 + t4 + 2][t5] = ap_uint<1>(0ULL);
            }
        }
        pad2_right: for (int t6 = 0; t6 < 14; t6++) {
#pragma HLS PIPELINE off
            L7: for (int t7 = 0; t7 < 2; t7++) {
#pragma HLS PIPELINE II=1
                y[18 * t1 + t6 + 2][t7 + 16] = ap_uint<1>(0ULL);
            }
        }
        pad2_in: for (int t8 = 0; t8 < 14; t8++) {
#pragma HLS PIPELINE off
            L9: for (int t9 = 0; t9 < 14; t9++) {
#pragma HLS PIPELINE II=1
                ap_uint<8> v4_0 = x[14 * t1 + t8][t9];
                y[18 * t1 + t8 + 2][t9 + 2] = v4_0;
            }
        }
    }
}
