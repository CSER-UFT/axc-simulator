/**
 * Kernels de exemplo, com as diretivas no estilo do Vitis HLS. Os de imagem usam o tamanho da imagem de teste da
 * página de unidades (192 x 192), para a verificação bit a bit com a imagem.
 */
export const KERNELS = [
    {
        id: 'gauss', name: 'Filtro gaussiano 3 × 3', nameEn: '3 × 3 Gaussian filter',
        code: `// Filtro gaussiano 3 x 3: pesos em 8 bits que somam 256.
#define W 192
#define H 192

void gauss(u8 in[H][W], u8 out[H][W]) {
#pragma HLS array_partition variable=in type=cyclic factor=3 dim=1
    const u8 K[3][3] = {{19, 32, 19}, {32, 52, 32}, {19, 32, 19}};
rows:
    for (int y = 1; y < H - 1; y++) {
cols:
        for (int x = 1; x < W - 1; x++) {
#pragma HLS pipeline II=1
            u32 acc = 0;
            for (int i = 0; i < 3; i++)
                for (int j = 0; j < 3; j++)
                    acc += in[y + i - 1][x + j - 1] * K[i][j];
            out[y][x] = min(255, acc >> 8);
        }
    }
}
`,
    },
    {
        id: 'sobel', name: 'Bordas de Sobel', nameEn: 'Sobel edges',
        code: `// Bordas de Sobel: |Gx| + |Gy| (norma L1), dividido por 4 e saturado em 255.
#define W 192
#define H 192

void sobel(u8 in[H][W], u8 out[H][W]) {
#pragma HLS array_partition variable=in type=cyclic factor=3 dim=1
rows:
    for (int y = 1; y < H - 1; y++) {
cols:
        for (int x = 1; x < W - 1; x++) {
#pragma HLS pipeline II=1
            i16 gx = in[y - 1][x + 1] + 2 * in[y][x + 1] + in[y + 1][x + 1]
                   - in[y - 1][x - 1] - 2 * in[y][x - 1] - in[y + 1][x - 1];
            i16 gy = in[y + 1][x - 1] + 2 * in[y + 1][x] + in[y + 1][x + 1]
                   - in[y - 1][x - 1] - 2 * in[y - 1][x] - in[y - 1][x + 1];
            out[y][x] = min(255, (abs(gx) + abs(gy)) >> 2);
        }
    }
}
`,
    },
    {
        id: 'sharpen', name: 'Realce de bordas', nameEn: 'Edge sharpening',
        code: `// Realce: 5 vezes o centro menos os 4 vizinhos, saturado entre 0 e 255.
#define W 192
#define H 192

void sharpen(u8 in[H][W], u8 out[H][W]) {
#pragma HLS array_partition variable=in type=cyclic factor=3 dim=1
rows:
    for (int y = 1; y < H - 1; y++) {
cols:
        for (int x = 1; x < W - 1; x++) {
#pragma HLS pipeline II=1
            i16 v = 5 * in[y][x] - in[y - 1][x] - in[y + 1][x] - in[y][x - 1] - in[y][x + 1];
            out[y][x] = max(0, min(255, v));
        }
    }
}
`,
    },
    {
        id: 'fir', name: 'FIR de 16 coeficientes', nameEn: '16 tap FIR',
        code: `// FIR de 16 coeficientes sobre um sinal de 8 bits.
#define N 1024
#define T 16

void fir(u8 x[N], u16 y[N]) {
#pragma HLS array_partition variable=x type=cyclic factor=16 dim=1
    const u8 h[T] = {3, 7, 12, 18, 24, 29, 32, 33, 33, 32, 29, 24, 18, 12, 7, 3};
samples:
    for (int n = T - 1; n < N; n++) {
#pragma HLS pipeline II=1
        u32 acc = 0;
        for (int k = 0; k < T; k++)
            acc += x[n - k] * h[k];
        y[n] = acc >> 4;
    }
}
`,
    },
    {
        id: 'dot', name: 'Produto escalar', nameEn: 'Dot product',
        code: `// Produto escalar com acumulador: a recorrência limita o II.
#define N 256

void dot(u8 a[N], u8 b[N], u32 r[1]) {
    u32 s = 0;
acc:
    for (int i = 0; i < N; i++) {
#pragma HLS pipeline II=1
        s += a[i] * b[i];
    }
    r[0] = s;
}
`,
    },
];
