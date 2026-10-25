// pool1 (projeto elaborado): gerado pelo axc-simulator (scripts/vitis.mjs). Não editar: o export gera de novo.
#include <ap_int.h>

#include "kernel.h"





void pool1(ap_uint<8> x[168][28], ap_uint<8> y[84][14]) {
#pragma HLS INTERFACE mode=ap_memory port=x storage_type=ram_t2p
#pragma HLS INTERFACE mode=ap_memory port=y storage_type=ram_t2p
    pool1_c: for (int t1 = 0; t1 < 6; t1++) {
#pragma HLS PIPELINE off
        pool1_h: for (int t2 = 0; t2 < 14; t2++) {
#pragma HLS PIPELINE off
            pool1_w: for (int t3 = 0; t3 < 14; t3++) {
#pragma HLS PIPELINE II=1
                ap_uint<8> v1_0 = x[28 * t1 + 2 * t2][2 * t3];
                ap_uint<8> v1_1 = x[28 * t1 + 2 * t2][2 * t3 + 1];
                bool v1_2 = v1_0 > v1_1;
                ap_uint<8> v1_3 = v1_2 ? ap_uint<8>(v1_0) : ap_uint<8>(v1_1);
                ap_uint<8> v1_4 = x[28 * t1 + 2 * t2 + 1][2 * t3];
                bool v1_5 = v1_3 > v1_4;
                ap_uint<8> v1_6 = v1_5 ? ap_uint<8>(v1_3) : ap_uint<8>(v1_4);
                ap_uint<8> v1_7 = x[28 * t1 + 2 * t2 + 1][2 * t3 + 1];
                bool v1_8 = v1_6 > v1_7;
                ap_uint<8> v1_9 = v1_8 ? ap_uint<8>(v1_6) : ap_uint<8>(v1_7);
                y[14 * t1 + t2][t3] = v1_9;
            }
        }
    }
}
