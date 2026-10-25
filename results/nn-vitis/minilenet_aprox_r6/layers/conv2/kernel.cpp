// conv2 (projeto elaborado, 113 operações aproximadas): gerado pelo axc-simulator (scripts/vitis.mjs). Não editar: o export gera de novo.
#include <ap_int.h>

#include "kernel.h"

// MUL8 T6 A4c: RTL do Verilog exportado (caixa preta do Vitis, u_MUL8_T6_A4c_bb.json); na csim, o modelo C da mesma netlist.
ap_uint<16> u_MUL8_T6_A4c_bb(ap_uint<8> a, ap_uint<8> b);
static ap_uint<16> u_MUL8_T6_A4c(ap_uint<8> a, ap_uint<8> b) {
#pragma HLS INLINE
    return u_MUL8_T6_A4c_bb(a, b);
}

// ADD24 LOA10: RTL do Verilog exportado (caixa preta do Vitis, u_ADD24_LOA10_bb.json); na csim, o modelo C da mesma netlist.
ap_uint<25> u_ADD24_LOA10_bb(ap_uint<24> a, ap_uint<24> b);
static ap_uint<25> u_ADD24_LOA10(ap_uint<24> a, ap_uint<24> b) {
#pragma HLS INLINE
    return u_ADD24_LOA10_bb(a, b);
}



// Produto com sinal de MUL8 T6 A4c: os módulos na unidade, o sinal no resultado.
static ap_int<17> su_MUL8_T6_A4c_us(ap_uint<8> x, ap_int<9> y) {
#pragma HLS INLINE off
    ap_uint<16> p = u_MUL8_T6_A4c(ap_uint<8>(x), ap_uint<8>(y < 0 ? ap_int<9>(-y) : y));
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

void conv2(ap_uint<8> x[54][18], ap_uint<8> y[84][14]) {
#pragma HLS INTERFACE mode=ap_memory port=x storage_type=ram_t2p
#pragma HLS INTERFACE mode=ap_memory port=y storage_type=ram_t2p
    static const ap_int<8> w[6][75] = {-19, -11, -5, 0, 1, -42, 17, 5, -17, 25, -13, -40, 20, -17, 10, 3, 39, -8, 30, 20, -2, 52, 23, -17, 68, -31, -31, 38, -82, -95, 12, -7, 29, 24, 6, -22, -29, -37, -113, 12, -1, -44, -128, 20, -76, 0, 34, -32, -43, 20, -54, -87, 38, -16, -85, 39, 3, -29, 38, 40, -12, 45, 4, -46, 33, 18, 8, -13, 5, -32, 16, 31, -11, -15, 20, -28, 44, 18, 16, 8, 35, -5, 5, 1, -15, -29, 21, -57, 10, -28, -29, 23, -73, -45, -46, -7, -55, -23, 53, -30, 6, -92, -6, 64, -15, -55, 50, 9, -44, 8, -7, -52, 31, -15, 7, 37, 21, 56, 28, 26, -27, -127, 45, -68, -19, 7, 26, 45, 8, 17, -10, 24, 26, 43, -35, -24, -25, 25, -9, -23, 16, 0, -25, -5, -15, -42, 6, -20, -2, 13, -15, -67, -105, 12, -33, 5, 28, -4, -5, -19, 12, -16, 18, 13, 6, -51, -1, 58, -53, 8, 57, 42, -7, 9, 19, -57, 26, -3, -18, -17, -60, -16, 21, 3, 26, -37, 57, 18, -8, 56, -95, -23, -51, -14, -53, -8, 119, -13, 10, 56, 21, 44, 14, -31, 8, -82, -87, -75, -39, -128, -35, 25, -50, 69, 41, -4, 64, -54, -28, 27, -86, -8, 35, -2, -52, -46, 34, 21, -83, -19, 1, -16, 18, 12, -18, 2, -32, -2, 29, -57, 85, -3, -23, 15, -41, 31, 41, -14, -31, -20, 15, -41, 16, 24, 44, 82, -27, -21, 6, 1, -5, -48, 27, -11, -17, -128, -86, 99, -54, 18, -28, 27, 52, -60, -6, 58, -121, -36, 22, 2, 15, 70, -38, 109, -61, -106, 46, 10, -39, 51, 58, -45, 39, 44, -78, 74, 56, -102, 31, 41, -13, -1, 75, -7, -16, 70, -1, -75, -12, 20, -68, 8, -24, 1, 35, 0, 12, -10, -3, -39, 24, 9, -88, -8, -2, -46, 14, 3, -2, 29, 15, 54, -68, 14, -4, -32, -19, -29, -8, -11, -13, 40, -1, 28, -3, -13, -43, -71, 32, 34, -128, 25, 36, -34, -41, 43, -43, -56, 66, -11, -23, -31, 85, -29, -1, -42, -42, -3, -32, -34, -41, -14, 10, -63, 49, 2, -30, -15, -52, 32, -106, 48, 42, -128, 39, -20, -59, 3, -33, 18, -20, -11, -83, 26, -6, -49, 36, -24, -11, 48, -36, -10, -32, -53, 41, -75, 0, -83, -27, 2, -8, 14, 2, 15, 20, -54, -27, -23, 4, 1, 6, 44, -19, 43, -3, -26, 26, -89, -18, -20, -37, 13, 34, 26, -12, 38, 38, 13, 37, -17, -22, 25, -87, -3, 13, -8, 22, 6, 40, -46};
    static const ap_int<32> b[6] = {-10, -770, -85, -1917, -140, -53};
    static const ap_uint<32> m[6] = {17194236, 17821162, 12464896, 12799807, 15687617, 17479202};
#pragma HLS BIND_STORAGE variable=w type=rom_2p impl=bram
    conv2_f: for (int t1 = 0; t1 < 6; t1++) {
#pragma HLS PIPELINE off
        conv2_h: for (int t2 = 0; t2 < 14; t2++) {
#pragma HLS PIPELINE off
            conv2_w: for (int t3 = 0; t3 < 14; t3++) {
#pragma HLS PIPELINE II=1
                ap_uint<8> v1_0 = x[t2][t3];
                ap_int<8> v1_1 = w[t1][0];
                ap_int<16> v1_2 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_0), ap_int<9>(v1_1)));
                ap_uint<8> v1_3 = x[t2 + 18][t3];
                ap_int<8> v1_4 = w[t1][1];
                ap_int<16> v1_5 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_3), ap_int<9>(v1_4)));
                ap_int<17> v1_6 = ap_int<17>(v1_2 + v1_5);
                ap_uint<8> v1_7 = x[t2 + 36][t3];
                ap_int<8> v1_8 = w[t1][2];
                ap_int<16> v1_9 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_7), ap_int<9>(v1_8)));
                ap_uint<8> v1_10 = x[t2][t3 + 1];
                ap_int<8> v1_11 = w[t1][3];
                ap_int<16> v1_12 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_10), ap_int<9>(v1_11)));
                ap_int<17> v1_13 = ap_int<17>(v1_9 + v1_12);
                ap_int<18> v1_14 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_6), ap_uint<24>(v1_13))));
                ap_uint<8> v1_15 = x[t2 + 18][t3 + 1];
                ap_int<8> v1_16 = w[t1][4];
                ap_int<16> v1_17 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_15), ap_int<9>(v1_16)));
                ap_uint<8> v1_18 = x[t2 + 36][t3 + 1];
                ap_int<8> v1_19 = w[t1][5];
                ap_int<16> v1_20 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_18), ap_int<9>(v1_19)));
                ap_int<17> v1_21 = ap_int<17>(v1_17 + v1_20);
                ap_uint<8> v1_22 = x[t2][t3 + 2];
                ap_int<8> v1_23 = w[t1][6];
                ap_int<16> v1_24 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_22), ap_int<9>(v1_23)));
                ap_uint<8> v1_25 = x[t2 + 18][t3 + 2];
                ap_int<8> v1_26 = w[t1][7];
                ap_int<16> v1_27 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_25), ap_int<9>(v1_26)));
                ap_int<17> v1_28 = ap_int<17>(v1_24 + v1_27);
                ap_int<18> v1_29 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_21), ap_uint<24>(v1_28))));
                ap_int<19> v1_30 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_14), ap_uint<24>(v1_29))));
                ap_uint<8> v1_31 = x[t2 + 36][t3 + 2];
                ap_int<8> v1_32 = w[t1][8];
                ap_int<16> v1_33 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_31), ap_int<9>(v1_32)));
                ap_uint<8> v1_34 = x[t2][t3 + 3];
                ap_int<8> v1_35 = w[t1][9];
                ap_int<16> v1_36 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_34), ap_int<9>(v1_35)));
                ap_int<17> v1_37 = ap_int<17>(v1_33 + v1_36);
                ap_uint<8> v1_38 = x[t2 + 18][t3 + 3];
                ap_int<8> v1_39 = w[t1][10];
                ap_int<16> v1_40 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_38), ap_int<9>(v1_39)));
                ap_uint<8> v1_41 = x[t2 + 36][t3 + 3];
                ap_int<8> v1_42 = w[t1][11];
                ap_int<16> v1_43 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_41), ap_int<9>(v1_42)));
                ap_int<17> v1_44 = ap_int<17>(v1_40 + v1_43);
                ap_int<18> v1_45 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_37), ap_uint<24>(v1_44))));
                ap_uint<8> v1_46 = x[t2][t3 + 4];
                ap_int<8> v1_47 = w[t1][12];
                ap_int<16> v1_48 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_46), ap_int<9>(v1_47)));
                ap_uint<8> v1_49 = x[t2 + 18][t3 + 4];
                ap_int<8> v1_50 = w[t1][13];
                ap_int<16> v1_51 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_49), ap_int<9>(v1_50)));
                ap_int<17> v1_52 = ap_int<17>(v1_48 + v1_51);
                ap_uint<8> v1_53 = x[t2 + 36][t3 + 4];
                ap_int<8> v1_54 = w[t1][14];
                ap_int<16> v1_55 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_53), ap_int<9>(v1_54)));
                ap_uint<8> v1_56 = x[t2 + 1][t3];
                ap_int<8> v1_57 = w[t1][15];
                ap_int<16> v1_58 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_56), ap_int<9>(v1_57)));
                ap_int<17> v1_59 = ap_int<17>(v1_55 + v1_58);
                ap_int<18> v1_60 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_52), ap_uint<24>(v1_59))));
                ap_int<19> v1_61 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_45), ap_uint<24>(v1_60))));
                ap_int<20> v1_62 = ap_int<20>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_30), ap_uint<24>(v1_61))));
                ap_uint<8> v1_63 = x[t2 + 19][t3];
                ap_int<8> v1_64 = w[t1][16];
                ap_int<16> v1_65 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_63), ap_int<9>(v1_64)));
                ap_uint<8> v1_66 = x[t2 + 37][t3];
                ap_int<8> v1_67 = w[t1][17];
                ap_int<16> v1_68 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_66), ap_int<9>(v1_67)));
                ap_int<17> v1_69 = ap_int<17>(v1_65 + v1_68);
                ap_uint<8> v1_70 = x[t2 + 1][t3 + 1];
                ap_int<8> v1_71 = w[t1][18];
                ap_int<16> v1_72 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_70), ap_int<9>(v1_71)));
                ap_uint<8> v1_73 = x[t2 + 19][t3 + 1];
                ap_int<8> v1_74 = w[t1][19];
                ap_int<16> v1_75 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_73), ap_int<9>(v1_74)));
                ap_int<17> v1_76 = ap_int<17>(v1_72 + v1_75);
                ap_int<18> v1_77 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_69), ap_uint<24>(v1_76))));
                ap_uint<8> v1_78 = x[t2 + 37][t3 + 1];
                ap_int<8> v1_79 = w[t1][20];
                ap_int<16> v1_80 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_78), ap_int<9>(v1_79)));
                ap_uint<8> v1_81 = x[t2 + 1][t3 + 2];
                ap_int<8> v1_82 = w[t1][21];
                ap_int<16> v1_83 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_81), ap_int<9>(v1_82)));
                ap_int<17> v1_84 = ap_int<17>(v1_80 + v1_83);
                ap_uint<8> v1_85 = x[t2 + 19][t3 + 2];
                ap_int<8> v1_86 = w[t1][22];
                ap_int<16> v1_87 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_85), ap_int<9>(v1_86)));
                ap_uint<8> v1_88 = x[t2 + 37][t3 + 2];
                ap_int<8> v1_89 = w[t1][23];
                ap_int<16> v1_90 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_88), ap_int<9>(v1_89)));
                ap_int<17> v1_91 = ap_int<17>(v1_87 + v1_90);
                ap_int<18> v1_92 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_84), ap_uint<24>(v1_91))));
                ap_int<19> v1_93 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_77), ap_uint<24>(v1_92))));
                ap_uint<8> v1_94 = x[t2 + 1][t3 + 3];
                ap_int<8> v1_95 = w[t1][24];
                ap_int<16> v1_96 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_94), ap_int<9>(v1_95)));
                ap_uint<8> v1_97 = x[t2 + 19][t3 + 3];
                ap_int<8> v1_98 = w[t1][25];
                ap_int<16> v1_99 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_97), ap_int<9>(v1_98)));
                ap_int<17> v1_100 = ap_int<17>(v1_96 + v1_99);
                ap_uint<8> v1_101 = x[t2 + 37][t3 + 3];
                ap_int<8> v1_102 = w[t1][26];
                ap_int<16> v1_103 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_101), ap_int<9>(v1_102)));
                ap_uint<8> v1_104 = x[t2 + 1][t3 + 4];
                ap_int<8> v1_105 = w[t1][27];
                ap_int<16> v1_106 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_104), ap_int<9>(v1_105)));
                ap_int<17> v1_107 = ap_int<17>(v1_103 + v1_106);
                ap_int<18> v1_108 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_100), ap_uint<24>(v1_107))));
                ap_uint<8> v1_109 = x[t2 + 19][t3 + 4];
                ap_int<8> v1_110 = w[t1][28];
                ap_int<16> v1_111 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_109), ap_int<9>(v1_110)));
                ap_uint<8> v1_112 = x[t2 + 37][t3 + 4];
                ap_int<8> v1_113 = w[t1][29];
                ap_int<16> v1_114 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_112), ap_int<9>(v1_113)));
                ap_int<17> v1_115 = ap_int<17>(v1_111 + v1_114);
                ap_uint<8> v1_116 = x[t2 + 2][t3];
                ap_int<8> v1_117 = w[t1][30];
                ap_int<16> v1_118 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_116), ap_int<9>(v1_117)));
                ap_uint<8> v1_119 = x[t2 + 20][t3];
                ap_int<8> v1_120 = w[t1][31];
                ap_int<16> v1_121 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_119), ap_int<9>(v1_120)));
                ap_int<17> v1_122 = ap_int<17>(v1_118 + v1_121);
                ap_int<18> v1_123 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_115), ap_uint<24>(v1_122))));
                ap_int<19> v1_124 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_108), ap_uint<24>(v1_123))));
                ap_int<20> v1_125 = ap_int<20>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_93), ap_uint<24>(v1_124))));
                ap_int<21> v1_126 = ap_int<21>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_62), ap_uint<24>(v1_125))));
                ap_uint<8> v1_127 = x[t2 + 38][t3];
                ap_int<8> v1_128 = w[t1][32];
                ap_int<16> v1_129 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_127), ap_int<9>(v1_128)));
                ap_uint<8> v1_130 = x[t2 + 2][t3 + 1];
                ap_int<8> v1_131 = w[t1][33];
                ap_int<16> v1_132 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_130), ap_int<9>(v1_131)));
                ap_int<17> v1_133 = ap_int<17>(v1_129 + v1_132);
                ap_uint<8> v1_134 = x[t2 + 20][t3 + 1];
                ap_int<8> v1_135 = w[t1][34];
                ap_int<16> v1_136 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_134), ap_int<9>(v1_135)));
                ap_uint<8> v1_137 = x[t2 + 38][t3 + 1];
                ap_int<8> v1_138 = w[t1][35];
                ap_int<16> v1_139 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_137), ap_int<9>(v1_138)));
                ap_int<17> v1_140 = ap_int<17>(v1_136 + v1_139);
                ap_int<18> v1_141 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_133), ap_uint<24>(v1_140))));
                ap_uint<8> v1_142 = x[t2 + 2][t3 + 2];
                ap_int<8> v1_143 = w[t1][36];
                ap_int<16> v1_144 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_142), ap_int<9>(v1_143)));
                ap_uint<8> v1_145 = x[t2 + 20][t3 + 2];
                ap_int<8> v1_146 = w[t1][37];
                ap_int<16> v1_147 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_145), ap_int<9>(v1_146)));
                ap_int<17> v1_148 = ap_int<17>(v1_144 + v1_147);
                ap_uint<8> v1_149 = x[t2 + 38][t3 + 2];
                ap_int<8> v1_150 = w[t1][38];
                ap_int<16> v1_151 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_149), ap_int<9>(v1_150)));
                ap_uint<8> v1_152 = x[t2 + 2][t3 + 3];
                ap_int<8> v1_153 = w[t1][39];
                ap_int<16> v1_154 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_152), ap_int<9>(v1_153)));
                ap_int<17> v1_155 = ap_int<17>(v1_151 + v1_154);
                ap_int<18> v1_156 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_148), ap_uint<24>(v1_155))));
                ap_int<19> v1_157 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_141), ap_uint<24>(v1_156))));
                ap_uint<8> v1_158 = x[t2 + 20][t3 + 3];
                ap_int<8> v1_159 = w[t1][40];
                ap_int<16> v1_160 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_158), ap_int<9>(v1_159)));
                ap_uint<8> v1_161 = x[t2 + 38][t3 + 3];
                ap_int<8> v1_162 = w[t1][41];
                ap_int<16> v1_163 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_161), ap_int<9>(v1_162)));
                ap_int<17> v1_164 = ap_int<17>(v1_160 + v1_163);
                ap_uint<8> v1_165 = x[t2 + 2][t3 + 4];
                ap_int<8> v1_166 = w[t1][42];
                ap_int<16> v1_167 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_165), ap_int<9>(v1_166)));
                ap_uint<8> v1_168 = x[t2 + 20][t3 + 4];
                ap_int<8> v1_169 = w[t1][43];
                ap_int<16> v1_170 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_168), ap_int<9>(v1_169)));
                ap_int<17> v1_171 = ap_int<17>(v1_167 + v1_170);
                ap_int<18> v1_172 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_164), ap_uint<24>(v1_171))));
                ap_uint<8> v1_173 = x[t2 + 38][t3 + 4];
                ap_int<8> v1_174 = w[t1][44];
                ap_int<16> v1_175 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_173), ap_int<9>(v1_174)));
                ap_uint<8> v1_176 = x[t2 + 3][t3];
                ap_int<8> v1_177 = w[t1][45];
                ap_int<16> v1_178 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_176), ap_int<9>(v1_177)));
                ap_int<17> v1_179 = ap_int<17>(v1_175 + v1_178);
                ap_uint<8> v1_180 = x[t2 + 21][t3];
                ap_int<8> v1_181 = w[t1][46];
                ap_int<16> v1_182 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_180), ap_int<9>(v1_181)));
                ap_uint<8> v1_183 = x[t2 + 39][t3];
                ap_int<8> v1_184 = w[t1][47];
                ap_int<16> v1_185 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_183), ap_int<9>(v1_184)));
                ap_int<17> v1_186 = ap_int<17>(v1_182 + v1_185);
                ap_int<18> v1_187 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_179), ap_uint<24>(v1_186))));
                ap_int<19> v1_188 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_172), ap_uint<24>(v1_187))));
                ap_int<20> v1_189 = ap_int<20>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_157), ap_uint<24>(v1_188))));
                ap_uint<8> v1_190 = x[t2 + 3][t3 + 1];
                ap_int<8> v1_191 = w[t1][48];
                ap_int<16> v1_192 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_190), ap_int<9>(v1_191)));
                ap_uint<8> v1_193 = x[t2 + 21][t3 + 1];
                ap_int<8> v1_194 = w[t1][49];
                ap_int<16> v1_195 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_193), ap_int<9>(v1_194)));
                ap_int<17> v1_196 = ap_int<17>(v1_192 + v1_195);
                ap_uint<8> v1_197 = x[t2 + 39][t3 + 1];
                ap_int<8> v1_198 = w[t1][50];
                ap_int<16> v1_199 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_197), ap_int<9>(v1_198)));
                ap_uint<8> v1_200 = x[t2 + 3][t3 + 2];
                ap_int<8> v1_201 = w[t1][51];
                ap_int<16> v1_202 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_200), ap_int<9>(v1_201)));
                ap_int<17> v1_203 = ap_int<17>(v1_199 + v1_202);
                ap_int<18> v1_204 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_196), ap_uint<24>(v1_203))));
                ap_uint<8> v1_205 = x[t2 + 21][t3 + 2];
                ap_int<8> v1_206 = w[t1][52];
                ap_int<16> v1_207 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_205), ap_int<9>(v1_206)));
                ap_uint<8> v1_208 = x[t2 + 39][t3 + 2];
                ap_int<8> v1_209 = w[t1][53];
                ap_int<16> v1_210 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_208), ap_int<9>(v1_209)));
                ap_int<17> v1_211 = ap_int<17>(v1_207 + v1_210);
                ap_uint<8> v1_212 = x[t2 + 3][t3 + 3];
                ap_int<8> v1_213 = w[t1][54];
                ap_int<16> v1_214 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_212), ap_int<9>(v1_213)));
                ap_uint<8> v1_215 = x[t2 + 21][t3 + 3];
                ap_int<8> v1_216 = w[t1][55];
                ap_int<16> v1_217 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_215), ap_int<9>(v1_216)));
                ap_int<17> v1_218 = ap_int<17>(v1_214 + v1_217);
                ap_int<18> v1_219 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_211), ap_uint<24>(v1_218))));
                ap_int<19> v1_220 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_204), ap_uint<24>(v1_219))));
                ap_uint<8> v1_221 = x[t2 + 39][t3 + 3];
                ap_int<8> v1_222 = w[t1][56];
                ap_int<16> v1_223 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_221), ap_int<9>(v1_222)));
                ap_uint<8> v1_224 = x[t2 + 3][t3 + 4];
                ap_int<8> v1_225 = w[t1][57];
                ap_int<16> v1_226 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_224), ap_int<9>(v1_225)));
                ap_int<17> v1_227 = ap_int<17>(v1_223 + v1_226);
                ap_uint<8> v1_228 = x[t2 + 21][t3 + 4];
                ap_int<8> v1_229 = w[t1][58];
                ap_int<16> v1_230 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_228), ap_int<9>(v1_229)));
                ap_uint<8> v1_231 = x[t2 + 39][t3 + 4];
                ap_int<8> v1_232 = w[t1][59];
                ap_int<16> v1_233 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_231), ap_int<9>(v1_232)));
                ap_int<17> v1_234 = ap_int<17>(v1_230 + v1_233);
                ap_int<18> v1_235 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_227), ap_uint<24>(v1_234))));
                ap_uint<8> v1_236 = x[t2 + 4][t3];
                ap_int<8> v1_237 = w[t1][60];
                ap_int<16> v1_238 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_236), ap_int<9>(v1_237)));
                ap_uint<8> v1_239 = x[t2 + 22][t3];
                ap_int<8> v1_240 = w[t1][61];
                ap_int<16> v1_241 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_239), ap_int<9>(v1_240)));
                ap_int<17> v1_242 = ap_int<17>(v1_238 + v1_241);
                ap_uint<8> v1_243 = x[t2 + 40][t3];
                ap_int<8> v1_244 = w[t1][62];
                ap_int<16> v1_245 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_243), ap_int<9>(v1_244)));
                ap_uint<8> v1_246 = x[t2 + 4][t3 + 1];
                ap_int<8> v1_247 = w[t1][63];
                ap_int<16> v1_248 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_246), ap_int<9>(v1_247)));
                ap_int<17> v1_249 = ap_int<17>(v1_245 + v1_248);
                ap_int<18> v1_250 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_242), ap_uint<24>(v1_249))));
                ap_int<19> v1_251 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_235), ap_uint<24>(v1_250))));
                ap_int<20> v1_252 = ap_int<20>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_220), ap_uint<24>(v1_251))));
                ap_int<21> v1_253 = ap_int<21>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_189), ap_uint<24>(v1_252))));
                ap_int<22> v1_254 = ap_int<22>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_126), ap_uint<24>(v1_253))));
                ap_uint<8> v1_255 = x[t2 + 22][t3 + 1];
                ap_int<8> v1_256 = w[t1][64];
                ap_int<16> v1_257 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_255), ap_int<9>(v1_256)));
                ap_uint<8> v1_258 = x[t2 + 40][t3 + 1];
                ap_int<8> v1_259 = w[t1][65];
                ap_int<16> v1_260 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_258), ap_int<9>(v1_259)));
                ap_int<17> v1_261 = ap_int<17>(v1_257 + v1_260);
                ap_uint<8> v1_262 = x[t2 + 4][t3 + 2];
                ap_int<8> v1_263 = w[t1][66];
                ap_int<16> v1_264 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_262), ap_int<9>(v1_263)));
                ap_uint<8> v1_265 = x[t2 + 22][t3 + 2];
                ap_int<8> v1_266 = w[t1][67];
                ap_int<16> v1_267 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_265), ap_int<9>(v1_266)));
                ap_int<17> v1_268 = ap_int<17>(v1_264 + v1_267);
                ap_int<18> v1_269 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_261), ap_uint<24>(v1_268))));
                ap_uint<8> v1_270 = x[t2 + 40][t3 + 2];
                ap_int<8> v1_271 = w[t1][68];
                ap_int<16> v1_272 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_270), ap_int<9>(v1_271)));
                ap_uint<8> v1_273 = x[t2 + 4][t3 + 3];
                ap_int<8> v1_274 = w[t1][69];
                ap_int<16> v1_275 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_273), ap_int<9>(v1_274)));
                ap_int<17> v1_276 = ap_int<17>(v1_272 + v1_275);
                ap_uint<8> v1_277 = x[t2 + 22][t3 + 3];
                ap_int<8> v1_278 = w[t1][70];
                ap_int<16> v1_279 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_277), ap_int<9>(v1_278)));
                ap_uint<8> v1_280 = x[t2 + 40][t3 + 3];
                ap_int<8> v1_281 = w[t1][71];
                ap_int<16> v1_282 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_280), ap_int<9>(v1_281)));
                ap_int<17> v1_283 = ap_int<17>(v1_279 + v1_282);
                ap_int<18> v1_284 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_276), ap_uint<24>(v1_283))));
                ap_int<19> v1_285 = ap_int<19>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_269), ap_uint<24>(v1_284))));
                ap_uint<8> v1_286 = x[t2 + 4][t3 + 4];
                ap_int<8> v1_287 = w[t1][72];
                ap_int<16> v1_288 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_286), ap_int<9>(v1_287)));
                ap_uint<8> v1_289 = x[t2 + 22][t3 + 4];
                ap_int<8> v1_290 = w[t1][73];
                ap_int<16> v1_291 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_289), ap_int<9>(v1_290)));
                ap_int<17> v1_292 = ap_int<17>(v1_288 + v1_291);
                ap_uint<8> v1_293 = x[t2 + 40][t3 + 4];
                ap_int<8> v1_294 = w[t1][74];
                ap_int<16> v1_295 = ap_int<16>(su_MUL8_T6_A4c_us(ap_uint<8>(v1_293), ap_int<9>(v1_294)));
                ap_int<18> v1_296 = ap_int<18>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_292), ap_uint<24>(v1_295))));
                ap_int<20> v1_297 = ap_int<20>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_285), ap_uint<24>(v1_296))));
                ap_int<23> v1_298 = ap_int<23>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_254), ap_uint<24>(v1_297))));
                ap_int<12> v1_299 = b[t1];
                ap_int<23> v1_300 = ap_int<23>(ap_uint<24>(u_ADD24_LOA10(ap_uint<24>(v1_298), ap_uint<24>(v1_299))));
                ap_uint<25> v1_301 = m[t1];
                ap_uint<8> v1_302 = ap_uint<8>(axc_requant(v1_300, v1_301, ap_uint<1>(0ULL)));
                y[14 * t1 + t2][t3] = v1_302;
            }
        }
    }
}
