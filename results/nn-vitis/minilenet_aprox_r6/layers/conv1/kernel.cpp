// conv1 (projeto elaborado, 38 operações aproximadas): gerado pelo axc-simulator (scripts/vitis.mjs). Não editar: o export gera de novo.
#include <ap_int.h>

#include "kernel.h"

// MUL8 T6 A10c: RTL do Verilog exportado (caixa preta do Vitis, u_MUL8_T6_A10c_bb.json); na csim, o modelo C da mesma netlist.
ap_uint<16> u_MUL8_T6_A10c_bb(ap_uint<8> a, ap_uint<8> b);
static ap_uint<16> u_MUL8_T6_A10c(ap_uint<8> a, ap_uint<8> b) {
#pragma HLS INLINE
    return u_MUL8_T6_A10c_bb(a, b);
}

// ADD24 LOA11: RTL do Verilog exportado (caixa preta do Vitis, u_ADD24_LOA11_bb.json); na csim, o modelo C da mesma netlist.
ap_uint<25> u_ADD24_LOA11_bb(ap_uint<24> a, ap_uint<24> b);
static ap_uint<25> u_ADD24_LOA11(ap_uint<24> a, ap_uint<24> b) {
#pragma HLS INLINE
    return u_ADD24_LOA11_bb(a, b);
}



// Produto com sinal de MUL8 T6 A10c: os módulos na unidade, o sinal no resultado.
static ap_int<17> su_MUL8_T6_A10c_us(ap_uint<8> x, ap_int<9> y) {
#pragma HLS INLINE off
    ap_uint<16> p = u_MUL8_T6_A10c(ap_uint<8>(x), ap_uint<8>(y < 0 ? ap_int<9>(-y) : y));
    return (y < 0) ? ap_int<17>(-ap_int<17>(p)) : ap_int<17>(p);
}

// Reescala das redes quantizadas: (acc x m + 2^31) >> 32, mais z, saturada entre 0 e 255 (multiplicação em DSP).
static ap_uint<8> axc_requant(ap_int<32> acc, ap_uint<32> m, ap_int<32> z) {
#pragma HLS INLINE off
    ap_int<64> p = ap_int<64>(acc) * ap_int<64>(m);
#pragma HLS BIND_OP variable=p op=mul impl=dsp
    ap_int<64> q = (p + (ap_int<64>(1) << 31)) >> 32;
    ap_int<35> v = ap_int<35>(q) + ap_int<35>(z);
    return v < 0 ? ap_uint<8>(0) : v > 255 ? ap_uint<8>(255) : ap_uint<8>(v);
}

void conv1(ap_uint<8> x[32][32], ap_uint<8> y[84][28]) {
#pragma HLS INTERFACE mode=ap_memory port=x storage_type=ram_t2p
#pragma HLS INTERFACE mode=ap_memory port=y storage_type=ram_t2p
    static const ap_int<8> w[3][25] = {-43, 20, 45, 54, 42, -102, -67, -6, 112, 47, -127, 68, 79, 96, 83, -83, 37, 81, 51, -100, 26, 93, 44, -13, -33, 69, 84, 82, 31, 44, -26, 6, 1, -41, -44, -99, -128, -90, -22, 21, -45, -11, -26, 20, 12, 19, 34, 42, 50, -26, -1, 26, -19, -66, -117, 19, -71, -128, -25, 62, 40, -23, 50, 3, 28, -14, 62, 87, 29, 4, 76, 77, 23, 13, 77};
    static const ap_int<32> b[3] = {-6298, -2577, -4619};
    static const ap_uint<32> m[3] = {5718256, 10721891, 7403962};
#pragma HLS BIND_STORAGE variable=w type=rom_2p impl=bram
    conv1_f: for (int t1 = 0; t1 < 3; t1++) {
#pragma HLS PIPELINE off
        conv1_h: for (int t2 = 0; t2 < 28; t2++) {
#pragma HLS PIPELINE off
            conv1_w: for (int t3 = 0; t3 < 28; t3++) {
#pragma HLS PIPELINE II=1
                ap_uint<8> v1_0 = x[t2][t3];
                ap_int<8> v1_1 = w[t1][0];
                ap_int<16> v1_2 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_0), ap_int<9>(v1_1)));
                ap_uint<8> v1_3 = x[t2][t3 + 1];
                ap_int<8> v1_4 = w[t1][1];
                ap_int<16> v1_5 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_3), ap_int<9>(v1_4)));
                ap_int<17> v1_6 = ap_int<17>(v1_2 + v1_5);
                ap_uint<8> v1_7 = x[t2][t3 + 2];
                ap_int<8> v1_8 = w[t1][2];
                ap_int<16> v1_9 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_7), ap_int<9>(v1_8)));
                ap_uint<8> v1_10 = x[t2][t3 + 3];
                ap_int<8> v1_11 = w[t1][3];
                ap_int<16> v1_12 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_10), ap_int<9>(v1_11)));
                ap_int<17> v1_13 = ap_int<17>(v1_9 + v1_12);
                ap_int<18> v1_14 = ap_int<18>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_6), ap_uint<24>(v1_13))));
                ap_uint<8> v1_15 = x[t2][t3 + 4];
                ap_int<8> v1_16 = w[t1][4];
                ap_int<16> v1_17 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_15), ap_int<9>(v1_16)));
                ap_uint<8> v1_18 = x[t2 + 1][t3];
                ap_int<8> v1_19 = w[t1][5];
                ap_int<16> v1_20 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_18), ap_int<9>(v1_19)));
                ap_int<17> v1_21 = ap_int<17>(v1_17 + v1_20);
                ap_uint<8> v1_22 = x[t2 + 1][t3 + 1];
                ap_int<8> v1_23 = w[t1][6];
                ap_int<16> v1_24 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_22), ap_int<9>(v1_23)));
                ap_uint<8> v1_25 = x[t2 + 1][t3 + 2];
                ap_int<8> v1_26 = w[t1][7];
                ap_int<16> v1_27 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_25), ap_int<9>(v1_26)));
                ap_int<17> v1_28 = ap_int<17>(v1_24 + v1_27);
                ap_int<18> v1_29 = ap_int<18>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_21), ap_uint<24>(v1_28))));
                ap_int<19> v1_30 = ap_int<19>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_14), ap_uint<24>(v1_29))));
                ap_uint<8> v1_31 = x[t2 + 1][t3 + 3];
                ap_int<8> v1_32 = w[t1][8];
                ap_int<16> v1_33 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_31), ap_int<9>(v1_32)));
                ap_uint<8> v1_34 = x[t2 + 1][t3 + 4];
                ap_int<8> v1_35 = w[t1][9];
                ap_int<16> v1_36 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_34), ap_int<9>(v1_35)));
                ap_int<17> v1_37 = ap_int<17>(v1_33 + v1_36);
                ap_uint<8> v1_38 = x[t2 + 2][t3];
                ap_int<8> v1_39 = w[t1][10];
                ap_int<16> v1_40 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_38), ap_int<9>(v1_39)));
                ap_uint<8> v1_41 = x[t2 + 2][t3 + 1];
                ap_int<8> v1_42 = w[t1][11];
                ap_int<16> v1_43 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_41), ap_int<9>(v1_42)));
                ap_int<17> v1_44 = ap_int<17>(v1_40 + v1_43);
                ap_int<18> v1_45 = ap_int<18>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_37), ap_uint<24>(v1_44))));
                ap_uint<8> v1_46 = x[t2 + 2][t3 + 2];
                ap_int<8> v1_47 = w[t1][12];
                ap_int<16> v1_48 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_46), ap_int<9>(v1_47)));
                ap_uint<8> v1_49 = x[t2 + 2][t3 + 3];
                ap_int<8> v1_50 = w[t1][13];
                ap_int<16> v1_51 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_49), ap_int<9>(v1_50)));
                ap_int<17> v1_52 = ap_int<17>(v1_48 + v1_51);
                ap_uint<8> v1_53 = x[t2 + 2][t3 + 4];
                ap_int<8> v1_54 = w[t1][14];
                ap_int<16> v1_55 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_53), ap_int<9>(v1_54)));
                ap_uint<8> v1_56 = x[t2 + 3][t3];
                ap_int<8> v1_57 = w[t1][15];
                ap_int<16> v1_58 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_56), ap_int<9>(v1_57)));
                ap_int<17> v1_59 = ap_int<17>(v1_55 + v1_58);
                ap_int<18> v1_60 = ap_int<18>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_52), ap_uint<24>(v1_59))));
                ap_int<19> v1_61 = ap_int<19>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_45), ap_uint<24>(v1_60))));
                ap_int<20> v1_62 = ap_int<20>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_30), ap_uint<24>(v1_61))));
                ap_uint<8> v1_63 = x[t2 + 3][t3 + 1];
                ap_int<8> v1_64 = w[t1][16];
                ap_int<16> v1_65 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_63), ap_int<9>(v1_64)));
                ap_uint<8> v1_66 = x[t2 + 3][t3 + 2];
                ap_int<8> v1_67 = w[t1][17];
                ap_int<16> v1_68 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_66), ap_int<9>(v1_67)));
                ap_int<17> v1_69 = ap_int<17>(v1_65 + v1_68);
                ap_uint<8> v1_70 = x[t2 + 3][t3 + 3];
                ap_int<8> v1_71 = w[t1][18];
                ap_int<16> v1_72 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_70), ap_int<9>(v1_71)));
                ap_uint<8> v1_73 = x[t2 + 3][t3 + 4];
                ap_int<8> v1_74 = w[t1][19];
                ap_int<16> v1_75 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_73), ap_int<9>(v1_74)));
                ap_int<17> v1_76 = ap_int<17>(v1_72 + v1_75);
                ap_int<18> v1_77 = ap_int<18>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_69), ap_uint<24>(v1_76))));
                ap_uint<8> v1_78 = x[t2 + 4][t3];
                ap_int<8> v1_79 = w[t1][20];
                ap_int<16> v1_80 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_78), ap_int<9>(v1_79)));
                ap_uint<8> v1_81 = x[t2 + 4][t3 + 1];
                ap_int<8> v1_82 = w[t1][21];
                ap_int<16> v1_83 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_81), ap_int<9>(v1_82)));
                ap_int<17> v1_84 = ap_int<17>(v1_80 + v1_83);
                ap_uint<8> v1_85 = x[t2 + 4][t3 + 2];
                ap_int<8> v1_86 = w[t1][22];
                ap_int<16> v1_87 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_85), ap_int<9>(v1_86)));
                ap_uint<8> v1_88 = x[t2 + 4][t3 + 3];
                ap_int<8> v1_89 = w[t1][23];
                ap_int<16> v1_90 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_88), ap_int<9>(v1_89)));
                ap_int<17> v1_91 = ap_int<17>(v1_87 + v1_90);
                ap_int<18> v1_92 = ap_int<18>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_84), ap_uint<24>(v1_91))));
                ap_int<19> v1_93 = ap_int<19>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_77), ap_uint<24>(v1_92))));
                ap_uint<8> v1_94 = x[t2 + 4][t3 + 4];
                ap_int<8> v1_95 = w[t1][24];
                ap_int<16> v1_96 = ap_int<16>(su_MUL8_T6_A10c_us(ap_uint<8>(v1_94), ap_int<9>(v1_95)));
                ap_int<20> v1_97 = ap_int<20>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_93), ap_uint<24>(v1_96))));
                ap_int<21> v1_98 = ap_int<21>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_62), ap_uint<24>(v1_97))));
                ap_int<14> v1_99 = b[t1];
                ap_int<21> v1_100 = ap_int<21>(ap_uint<24>(u_ADD24_LOA11(ap_uint<24>(v1_98), ap_uint<24>(v1_99))));
                ap_uint<24> v1_101 = m[t1];
                ap_uint<8> v1_102 = ap_uint<8>(axc_requant(v1_100, v1_101, ap_uint<1>(0ULL)));
                y[28 * t1 + t2][t3] = v1_102;
            }
        }
    }
}
