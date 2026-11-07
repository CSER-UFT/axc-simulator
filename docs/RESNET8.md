# ResNet 8 do MLPerf Tiny (CIFAR 10)

Arquitetura fixada na etapa 14 do plano (HANDOFF.md) pela referência oficial, para as etapas seguintes (formato,
avaliador, treino, gerador de código, custo e busca). O script `scripts/nn/resnet8_arch.py` monta a tabela abaixo e
confere as contagens; com `--h5`, confere também filtros, núcleos, passos e o total de valores com o modelo oficial.

## Fonte

Repositório github.com/mlcommons/tiny, pasta `benchmark/training/image_classification` (conferido no commit
4addd0f, de 13/jul/2026): `keras_model.py` (função `resnet_v1_eembc`), `train.py` e o modelo
`trained_models/pretrainedResnet.h5` (Keras 2.4). O alvo de qualidade do benchmark é 85% de acurácia top 1 no
CIFAR 10 (`benchmark/README.md`).

Há três tamanhos no repositório. Fica o de 16, 32 e 64 filtros, que é o do `pretrainedResnet.h5` e o da versão 1.0
do benchmark (78 666 valores). O `train.py` atual chama `resnet_v1_eembc(conv_filters=26)`, cerca de 200 mil
parâmetros, e o `pretrainedResnet_large.h5` tem 40, 80 e 160 filtros (482 730 valores); nenhum dos dois é o modelo
de referência que os resultados publicados usam.

## Acurácia da referência

Medida aqui com o interpretador do TensorFlow Lite (ai-edge-litert) nas 10 000 imagens de teste do CIFAR 10, a partir
dos arquivos `.tflite` do repositório:

| modelo | acurácia no teste |
|---|---|
| `pretrainedResnet.tflite` (ponto flutuante) | 87,19% |
| `pretrainedResnet_quant.tflite` (int8, entrada int8 = pixel menos 128) | 86,97% |

O modelo int8 tem 9 CONV_2D (o BN dobrado nos pesos), 3 ADD, 1 AVERAGE_POOL_2D, 1 FULLY_CONNECTED e o SOFTMAX. A
referência foi treinada com as 50 000 imagens de treino; o nosso treino deixa 5000 de fora para a validação, então é
de esperar um pouco menos (algo entre 86% e 87% em ponto flutuante).

## Camadas

| camada | tipo | entrada | saída | k / passo | borda (c, b, e, d) | pesos + vieses | multiplicações |
|---|---|---|---|---|---|---|---|
| conv1 | conv + BN + ReLU | input | 16×32×32 | 3 / 1 | 1, 1, 1, 1 | 432 + 16 | 442 368 |
| s1a | conv + BN + ReLU | conv1 | 16×32×32 | 3 / 1 | 1, 1, 1, 1 | 2 304 + 16 | 2 359 296 |
| s1b | conv + BN | s1a | 16×32×32 | 3 / 1 | 1, 1, 1, 1 | 2 304 + 16 | 2 359 296 |
| s1add | add | conv1 + s1b | 16×32×32 | ReLU depois | | | |
| s2a | conv + BN + ReLU | s1add | 32×16×16 | 3 / 2 | 0, 1, 0, 1 | 4 608 + 32 | 1 179 648 |
| s2b | conv + BN | s2a | 32×16×16 | 3 / 1 | 1, 1, 1, 1 | 9 216 + 32 | 2 359 296 |
| s2sc | conv | s1add | 32×16×16 | 1 / 2 | 0, 0, 0, 0 | 512 + 32 | 131 072 |
| s2add | add | s2sc + s2b | 32×16×16 | ReLU depois | | | |
| s3a | conv + BN + ReLU | s2add | 64×8×8 | 3 / 2 | 0, 1, 0, 1 | 18 432 + 64 | 1 179 648 |
| s3b | conv + BN | s3a | 64×8×8 | 3 / 1 | 1, 1, 1, 1 | 36 864 + 64 | 2 359 296 |
| s3sc | conv | s2add | 64×8×8 | 1 / 2 | 0, 0, 0, 0 | 2 048 + 64 | 131 072 |
| s3add | add | s3sc + s3b | 64×8×8 | ReLU depois | | | |
| pool | avgpool | s3add | 64×1×1 | 8 × 8 | | | |
| fc | dense | pool | 10 | 1 / 1 |  | 640 + 10 | 640 |

Entrada de 3 × 32 × 32. Todas as convoluções têm viés. O BN vem depois de cada convolução 3 × 3 e é dobrado nos pesos
e no viés na exportação; os atalhos 1 × 1 não têm BN. A ReLU das pilhas vem depois da soma. Na saída, a média de
8 × 8 posições e a densa de 64 para 10, sem softmax (a classe é o índice do maior valor).

Totais: 10 camadas com pesos, 77 360 pesos e 346 vieses (77 706 depois de dobrar o BN; o `.h5` tem 78 666 valores,
com os quatro de cada canal dos 7 BN), 12 501 632 multiplicações por imagem, cerca de 19 vezes as da LeNet 5 no
CIFAR 10 (651 720).

## Decisões para as próximas etapas

1. **Borda do padding='same'** (etapas 15, 16, 17 e 20). Nas convoluções 3 × 3 de passo 2 sobre entrada par, o
   Keras não põe borda em cima e à esquerda e põe uma linha e uma coluna embaixo e à direita (borda 0, 1, 0, 1 na
   tabela); no passo 1, uma de cada lado; nos atalhos 1 × 1 de passo 2, nenhuma. O PyTorch com `padding=1` põe a
   borda dos dois lados e pega outras posições da entrada. Para ficar igual à referência, o formato guarda a borda
   de cada lado, e o treino em PyTorch faz `F.pad(x, (0, 1, 0, 1))` antes da convolução de passo 2 com `padding=0`.
   A borda é preenchida com o ponto zero da entrada, como nas redes de hoje.
2. **Atalhos 1 × 1 como camadas da busca**, como combinado: a busca tem 10 camadas e 20 grupos (o multiplicador e o
   somador de cada camada). O plano dizia 11 camadas e cerca de 22 grupos; a contagem certa é 10 e 20. As três
   somas residuais e a média ficam exatas (cerca de 29 mil somas por imagem, contra 12,5 milhões de produtos).
3. **Soma residual com reescala** (feita na etapa 15). A segunda convolução de cada pilha e os atalhos 1 × 1 têm
   `output: "acc"`: entregam o acumulador com o viés (int32), sem reescala. A camada `add` faz uma reescala só:
   v_j é o acumulador (convolução "acc") ou a − z_a (a ativação do atalho identidade, na pilha 1), e
   saída = min(255, max(0, floor((soma de v_j m_j + 2^(31+e)) / 2^(32+e)) + z_saída)), com m_j em Q32 por canal e
   e = `requant.exp` (0 por padrão; negativo quando algum m_j / 2^32 passaria de 1). A ReLU é o limite em 0, como
   nas convoluções. Não há quantização intermediária do ramo sem ReLU, e a conta é inteira e bit exata (`mulQ32Sum`,
   conferida contra BigInt). A alternativa do TFLite, quantizar cada ramo em 8 bits e somar com duas reescalas, perde
   precisão no ramo com sinal e não traz vantagem para o hardware.
4. **Média** (feita na etapa 15): `avgpool` com `size` 8, soma das 64 ativações (até 16 320) e
   floor((soma + 32) / 64), na mesma escala e ponto zero da entrada; a densa recebe ativações de 8 bits, como as
   tabelas de produtos pedem.
5. **Quantização** igual à das redes de hoje (`scripts/nn/train.py`): pesos int8 simétricos por canal, ativações de
   0 a 127 com escala e ponto zero por camada, viés int32, reescala em Q32. A entrada segue a nossa normalização por
   canal (a referência usa o pixel cru, de 0 a 255; com o BN depois da primeira convolução, isso não muda a rede).
6. **Treino** (etapa 17): a receita da referência, com Adam, taxa 0,001 × 0,99 por época, 500 épocas, lotes de 32,
   regularização L2 de 1e-4 nos núcleos das convoluções, inicialização He normal e aumento de dados (rotação até 15
   graus, deslocamento até 10% na horizontal e na vertical, espelhamento horizontal); 45 000 imagens de treino e as
   5000 de validação de `split_validation`, com a escolha da melhor época na validação. Alvo: pelo menos 85% no teste
   depois da quantização, perto dos 86,97% do int8 da referência.

## Formato (etapa 15)

O formato continua `axc-nn/1` (`js/axc/nn.js`), e as redes de hoje decodificam e classificam igual. O que entrou:

* `name` em cada camada e `input` (o nome da camada lida; `"input"` é a entrada da rede); sem `input`, a camada lê a
  anterior. A ordem das camadas é a de execução;
* `pad` da convolução como número ou como `[cima, baixo, esquerda, direita]`;
* `output: "acc"` na convolução, `add` com `inputs` e `requant: {mode: "q32", m: [um por entrada], exp, zero}`, e
  `avgpool` com `size`;
* no decodificador, `l.src` (os índices lidos), `net.cuts` (o tensor vivo antes de cada camada, quando é um só e de
  8 bits), `net.lastUse` e `net.graph`. O m de cada ramo "acc" fica também em `l.rq.m` da convolução, e a correção de
  ganho da busca muda esse m (o `scales` de `inferFrom` e de `withBiases`).

Exemplo da pilha 2 (pesos e reescalas em base64, como nas outras camadas):

```json
{"type": "conv", "name": "s2a", "input": "s1add", "out": 32, "k": 3, "stride": 2, "pad": [0, 1, 0, 1], "w": "...", "b": "...", "requant": {"mode": "q32", "m": "...", "zero": 0}},
{"type": "conv", "name": "s2b", "out": 32, "k": 3, "stride": 1, "pad": 1, "output": "acc", "w": "...", "b": "..."},
{"type": "conv", "name": "s2sc", "input": "s1add", "out": 32, "k": 1, "stride": 2, "pad": 0, "output": "acc", "w": "...", "b": "..."},
{"type": "add", "name": "s2add", "inputs": ["s2sc", "s2b"], "requant": {"mode": "q32", "m": ["...", "..."], "exp": 0, "zero": 0}}
```

## Diagrama, código gerado e custo (etapas 19 a 21)

O diagrama (`js/axc/nnsvg.js`) põe o caminho principal na linha, cada soma residual num círculo ⊕ e os atalhos em
arcos por cima, com uma caixa com o nome e a operação quando o atalho é uma convolução 1 × 1.

O gerador (`js/axc/nngen.js`) escreve, além dos kernels de sempre: a borda com lados diferentes (`padKernel4`), a
convolução que entrega o acumulador com o viés (`i32 y`, sem reescala), a soma residual (`addKernel`, com a função
nova `requant2(a, ma, b, mb, z[, e])` da linguagem da página de síntese) e a média (`avgPoolKernel`, com n potência de
2). Cada kernel diz os tensores que lê e o que escreve; executados por esses tensores, dão exatamente as saídas do
avaliador, com unidades exatas e com o somador aproximado (test/nngraph.test.js). Nas redes de hoje, o código gerado
continua igual, byte a byte.

`requant2` entrou em toda a cadeia da página de síntese: elaboração (`requant2Value`, com os dois produtos em DSP pela
faixa dos operandos), execução, modelo de erro, custo (classe `requant2`) e C++ do Vitis (`axc_requant2`, num módulo
próprio como a reescala). A peça ainda não foi caracterizada à parte: o custo é o de duas reescalas (área, LUT,
energia e DSP) com o atraso de uma. Como o Vitis instancia cada módulo de reescala uma vez só, a rede conta uma
reescala e uma `requant2`.

Custo da ResNet 8 com pesos sorteados, diretivas padrão (sem partição), 10 ns, ASIC: 6,38 milhões de ciclos (64 ms
por imagem), 4,28 mm², 69 594 LUTs e 6 DSP48; com o MUL8 DRUM4 e o ADD32 LOA10 em todas as camadas, 14,5% menos área e
0,9% menos energia (os registradores e as memórias dominam a energia, como nas LeNets). O II das convoluções fica
limitado pela memória (72 a 288 sem partição), como nas outras redes. Montar o modelo de custo leva cerca de 70 s,
quase tudo na elaboração das convoluções (6 a 10 s cada); trocar as unidades depois leva menos de 1 s. Na página, esse
cálculo precisa ir para um worker (etapa 22 ou 25).

## Exportação para o Vitis (etapa 23)

`networkProject` (`js/axc/nnexport.js`) liga cada kernel aos vetores dos tensores que ele lê e escreve: no topo
`network()`, os atalhos leem vetores escritos antes da camada anterior (`s2sc(t7, t12)`, `s2add(t12, t11, t13)`). A
partição de cada vetor junta a da camada que escreve e as das que leem (vale a da última que lê). A execução bit a
bit que dá as saídas esperadas do testbench e a entrada de cada projeto por camada segue os mesmos tensores. A
ResNet 8 treinada, com as unidades da busca e a correção de ganho e viés, sai com 228 arquivos (a rede e as 22
camadas); compilada com g++ e os cabeçalhos ap_int abertos da Xilinx, dá 0 diferenças contra os kernels.

## Treino e conferência bit a bit (etapas 17 e 18)

`scripts/nn/train.py resnet8 cifar10 <pasta>` treina a rede (classe `ResNet8`, com a borda do Keras e o BN de
momento 0,99 e epsilon 1e-3, como no Keras) com a receita da referência, na GPU se houver, e grava um ponto de
retomada a cada época (`data/nn/resnet8-cifar10.ckpt`; `--resume` continua dali). O aumento de dados (rotação,
deslocamento e espelho) é feito na GPU com `affine_grid` e `grid_sample`, com a borda repetida, como o `fill_mode`
padrão do Keras. A melhor época na validação é a que fica.

A quantização (`quantize_resnet`) dobra o BN nos pesos, calibra a escala de cada tensor de 8 bits em 3000 imagens de
treino e monta a soma residual: o m de cada ramo é a escala do acumulador (ou a da ativação, no atalho identidade)
sobre a da saída, e o expoente e fica em 0, a não ser que algum M passe de 1. A inferência inteira em Python
(`int_forward_graph`) é a mesma conta de `js/axc/nn.js`; o JSON leva as classes (`expected`) e as saídas inteiras
(`expectedOut`) das 1000 imagens do subconjunto de teste.

A conferência (test/nngraph.test.js) tem duas partes: a ResNet 8 de pesos sorteados passa pela inferência do Python
(`scripts/nn/intcheck.py`, que lê qualquer rede do formato e não precisa do PyTorch) e pela do avaliador, saída a
saída; e, quando `data/nn/resnet8-cifar10.json` existir, as 1000 classes e as 10 000 saídas do avaliador são
comparadas com as do treino.

## Custo da avaliação bit exata

Medido na etapa 16 com a ResNet 8 inteira e pesos sorteados (`js/axc/nn.js`, uma thread): 39 ms por imagem com as
unidades exatas e 45 ms com o MUL8 DRUM4 e o ADD32 LOA10 em todas as camadas. Isso dá cerca de 200 s para as 5000
imagens de validação numa thread, uns 28 s com 7 workers; uma calibração de 40 trocas isoladas sobre as 5000 imagens
levaria uns 15 minutos com 7 workers.

O avaliador da busca (`Evaluator` em `js/axc/nnsearch.js`) guarda as ativações da configuração base nos cortes: os
pontos com um tensor vivo só. Na ResNet 8 são 7 (antes da conv1, da s1a, da s2a, da s3a, da média, do flatten e da
densa), 44 kB por imagem; guardar todos os tensores vivos antes de cada camada com pesos levaria uns 180 kB. Uma troca
isolada recomeça do último corte antes da camada: 39 ms por imagem na conv1, 38 ms na s1b (recomeça da saída da
conv1), 23 ms no atalho da pilha 2, 12 ms no da pilha 3 e quase nada na densa.

Memória e tempo da busca (etapa 22): guardar os cortes das 5000 imagens daria 220 MB por avaliador. A validação
inteira agora fica dividida entre os workers de avaliação (cada um guarda os cortes da sua fatia: com 7 workers,
cerca de 31 MB cada), e a conferência de um ponto roda nas fatias em paralelo (`engine.runFull`); a thread que
coordena não guarda nada da validação inteira, e o teste é classificado sem guardar cortes (os buffers dos cortes
só são criados na primeira passada que grava). A amostra de 1000 imagens fica em cada worker (44 MB). O modelo de
custo da busca guarda só o resumo de cada combinação de camada, multiplicador e somador (`keepResults: false`; a
síntese inteira, cerca de 1,5 MB por kernel da ResNet 8, só é necessária para gerar o C++), e a síntese exata de cada
kernel é feita uma vez só: 53 ms e quase nenhuma memória por combinação nova, contra 117 ms e 1,5 MB antes. Na
página, o custo roda num worker (`js/nn-cost-worker.js`), porque montar o modelo leva cerca de dois minutos.
