// flatten (projeto elaborado): gerado pelo axc-simulator (scripts/vitis.mjs). Não editar: o export gera de novo.
#include <ap_int.h>

#include "kernel.h"







void flatten(ap_uint<8> x[42][7], ap_uint<8> y[294]) {
#pragma HLS INTERFACE mode=ap_memory port=x storage_type=ram_t2p
#pragma HLS INTERFACE mode=ap_memory port=y storage_type=ram_t2p
    flatten_r: for (int t1 = 0; t1 < 42; t1++) {
#pragma HLS PIPELINE off
        flatten_w: for (int t2 = 0; t2 < 7; t2++) {
#pragma HLS PIPELINE II=1
            ap_uint<8> v1_0 = x[t1][t2];
            y[7 * t1 + t2] = v1_0;
        }
    }
}
