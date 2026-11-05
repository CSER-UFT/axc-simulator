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
3. **Soma residual com reescala** (etapa 15). Proposta: a soma entra na reescala da segunda convolução da pilha. Na
   pilha 1, saída = min(127, max(0, ((acc M + (x − z_x) M_x + 2^31) >> 32) + z_saída)), com x a ativação do atalho
   identidade; nas pilhas 2 e 3, os dois acumuladores int32 (o da convolução 3 × 3 e o do atalho 1 × 1), cada um
   com o seu M em Q32, somados antes do arredondamento. Assim não há uma quantização intermediária do ramo sem ReLU,
   e a conta continua inteira e bit exata. A alternativa (como o TFLite) é quantizar cada ramo em 8 bits e somar
   com duas reescalas; ela perde precisão no ramo com sinal e não traz vantagem para o hardware.
4. **Média de 8 × 8**: soma das 64 ativações (até 8128) e (soma + 32) >> 6, na mesma escala e ponto zero da
   entrada; a densa recebe ativações de 8 bits, como as tabelas de produtos pedem.
5. **Quantização** igual à das redes de hoje (`scripts/nn/train.py`): pesos int8 simétricos por canal, ativações de
   0 a 127 com escala e ponto zero por camada, viés int32, reescala em Q32. A entrada segue a nossa normalização por
   canal (a referência usa o pixel cru, de 0 a 255; com o BN depois da primeira convolução, isso não muda a rede).
6. **Treino** (etapa 17): a receita da referência, com Adam, taxa 0,001 × 0,99 por época, 500 épocas, lotes de 32,
   regularização L2 de 1e-4 nos núcleos das convoluções, inicialização He normal e aumento de dados (rotação até 15
   graus, deslocamento até 10% na horizontal e na vertical, espelhamento horizontal); 45 000 imagens de treino e as
   5000 de validação de `split_validation`, com a escolha da melhor época na validação. Alvo: pelo menos 85% no teste
   depois da quantização, perto dos 86,97% do int8 da referência.

## Custo da avaliação bit exata

O avaliador de hoje (`js/axc/nn.js`) faz cerca de 410 milhões de multiplicações por segundo numa thread (medido com a
LeNet 5: 1,6 ms por imagem no CIFAR 10). Na ResNet 8, isso dá cerca de 30 ms por imagem: 150 s para as 5000 imagens
de validação numa thread, uns 22 s com 7 workers. Uma calibração de 40 trocas isoladas sobre as 5000 imagens levaria
uns 15 minutos com 7 workers. Por isso a etapa 16 guarda as ativações da rede exata na entrada de cada camada: uma
troca isolada numa camada só recalcula dali para a frente (em média, 46% das multiplicações, de 100% na
primeira camada a quase nada na densa), e a amostra de 1000 imagens fica para as rodadas rápidas.
