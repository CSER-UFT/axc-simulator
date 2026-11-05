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

O gerador de código, o modelo de custo e o diagrama ainda recusam essas redes com um erro claro (etapas 19 a 21).

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

Memória: com as 5000 imagens, 220 MB por avaliador; a preparação da busca tem o da amostra, o da validação inteira e o
do teste, e cada worker de avaliação tem o seu da amostra. Na etapa 22, a validação inteira deve ficar só para a
conferência no fim (sem guardar os cortes) e a amostra de 1000 imagens para a busca (44 MB por worker).
