# Handoff: busca híbrida nas redes neurais

Resumo para continuar o trabalho numa conversa nova. Estado do repositório no commit deste arquivo.

## Plano em andamento (29/out)

Decisões: exaustiva e aleatória fora da busca das redes por completo (página, linha de comando, nnbench; o módulo
genérico continua porque a linha de comando da HLS ainda usa as duas); busca medida (sensibilidade e sequencial
medida) selecionável na página, mas fora de "comparar todas"; o resumo exata contra escolhida vai para colunas da
tabela das execuções, com o detalhe por camada ao clicar na linha; Baixar projeto por linha, como na HLS; a aba e o
botão passam a se chamar Exploração e Explorar; o gráfico mostra a fronteira estimada (tracejada) e a medida (cheia),
com o escolhido na medida; correção do viés aprovada, comparando média, mediana, média geométrica (do módulo, com o
sinal predominante) e média aparada; na ResNet 8, os atalhos 1 × 1 entram como camadas próprias na busca; só domínio
de imagens (ResNet 8 do MLPerf Tiny no CIFAR 10).

Parte A, correções da busca:
1. Ler a aba de exploração da HLS e listar as diferenças (feito).
2. Tirar a exaustiva e a aleatória das redes (feito).
3. Verificação só pela fronteira estimada, sem ponto dominado; escolhido sempre na fronteira medida (feito: a
   verificação anda só pela fronteira estimada de tudo o que foi visitado; o resultado traz measuredFront; na busca
   medida, a fronteira exclui os reprovados na validação inteira e os viáveis mais baratos que o escolhido são todos
   conferidos; o nnbench marca "fora da fronteira"; rodada results/nn-search/etapa3).
4. Gráfico com as duas fronteiras (feito: estimada tracejada, medida cheia com só os pontos que passam no limite e a
   exata; o escolhido, na acurácia medida, é o ponto mais barato da fronteira medida; legenda dos traços no gráfico).
5. Diagnóstico do teto de economia (feito: savingCeiling, searchCeiling e arithmeticShare em nnsearch.js; comando
   nnceiling; o nnsearch mostra o teto das candidatas e o nnbench as colunas teto e do teto; results/nn-search/teto:
   área 35% a 37%, LUT 46% a 49%, energia 3% a 7%, porque os registradores dominam a energia; as buscas chegam a
   um terço do teto em área).
6. Correção do viés com a medida escolhível, no modelo estático, no avaliador bit exato e na exportação (feito:
   makeBiasFix e errorStat em nnsearch.js, medida por canal com as ativações reais da rede exata em imagens
   espalhadas pelo conjunto da busca, metade para medir e metade para avaliar; candidatas pelo desvio (o erro sem a
   média); preActivation, withBiases e o parâmetro biases de inferFrom em nn.js; biasDelta no resultado; --bias-fix,
   --biasfix no nnbench, seletor na página, Aplicar e Exportar com o viés corrigido; results/nn-search/vies-preliminar:
   a correção reduz o erro que sobra em 5% a 42%, mas quase não muda a acurácia nem a economia na MiniLenet; o erro
   destas unidades é mais proporcional ao sinal do que um deslocamento constante).
7. Comparar as medidas da correção no nnbench (feito, com a correção de ganho acrescentada: gain e affine na reescala
   Q32 de cada canal; results/nn-search/etapa7 e ANALISE.md: affine, ganho e viés por mínimos quadrados, é a melhor,
   12,5% contra 10,3% sem correção, melhor em 10 de 12 casos e com a menor queda no teste; as correções só de viés
   ganham 1,6 a 1,8 ponto mas aumentam a queda no teste; padrão da página, do nnsearch e do nnbench: affine, decidido em 2/nov).
8. Exportar as 5000 imagens de validação do train.py (feito: split_validation no train.py, scripts/nn/export_val.py
   grava data/nn/<base>-val5000.bin conferindo que as 100 primeiras de cada classe são as do arquivo de 1000;
   --val 5000 no nnsearch e no nnbench; os workers recebem o tamanho da validação; testado aqui na CIFAR 10 com o
   pacote npm tfjs-cifar10: LeNet 5, área, local com ganho e viés, 1000 imagens 10,3% e queda no teste 1,9 ponto,
   5000 imagens 9,4% e teste 0,2 ponto acima da exata, cerca de 9 min com 2 workers. Os três arquivos foram gerados
   na sessão e estão no repositório, porque as bases completas não ficaram em nenhuma máquina: MNIST do espelho
   github.com/fgnt/mnist (SHA256 dos originais, imagens de treino 440fcabf...), Fashion MNIST do repositório
   oficial github.com/zalandoresearch/fashion-mnist (data/fashion), CIFAR 10 do pacote npm tfjs-cifar10 1.1.1; os
   três passaram na conferência com os arquivos de 1000. SHA256: mnist-val5000 9bb467e1..., fashion-val5000
   322f9ac2..., cifar10-val5000 1f0315e1...)
9. Rodar a matriz de novo com as 5000 imagens (feito por Tiago, 7 workers; results/nn-search/etapa9, 48 casos: a
   diferença entre a queda no teste e a na validação caiu para cerca de 0,1 ponto; com affine, local híbrida 10,9%
   contra 9,8% sem correção e sensibilidade 12,0% contra 10,7%; a local híbrida terminou na exata em 2 de 24 casos,
   MNIST com LUT. Ideia pendente: recalibrar as curvas com os pontos reprovados na verificação antes de cada rodada
   nova, para que a rodada seguinte não volte a propor pontos do mesmo tipo).

Parte B, aba de exploração igual à da HLS:
10. Várias heurísticas por execução e a tabela das execuções (feito: o worker da busca recebe o.runs, uma lista de
    {heuristic, hybrid}, prepara a busca e calibra as curvas uma vez só para todas, e manda meta, run-start,
    points e progress com o índice k, run-done e done; "comparar todas" no seletor roda as seis híbridas; a tabela
    #nnRuns tem uma linha por busca com pontos, classificados, tempo, custo, economia, queda estimada, na validação
    e no teste, as unidades de cada camada e Aplicar; clicar na linha seleciona a busca, e o detalhe, a fronteira e
    o passo a passo passam a ser dela; ao terminar fica selecionada a de maior economia; o gráfico mostra todas as
    buscas da execução e a que está rodando).
11. Seletor "Fronteira de", tabela da fronteira por heurística com todos os custos, CSV e JSON, Baixar projeto
    (feito: o worker manda os custos de área, LUT, energia e ciclos de cada ponto da fronteira e do escolhido;
    a tabela da fronteira tem a economia no objetivo, µm², LUT, nJ, as quedas, as unidades, Aplicar e Baixar; o
    CSV e o JSON levam as fronteiras de todas as buscas da execução, com a heurística em cada linha; Baixar, na
    tabela das execuções e na da fronteira, aplica o ponto, vai para a aba Custo e gera o projeto; Adicionar à
    comparação guarda a busca do seletor "Fronteira de").
12. Passo a passo com seletor de heurística, blocos na ordem da HLS, bloco recolhível de explicação, controles
    guardados entre visitas, nomes Exploração e Explorar (feito: ordem controles, execuções, gráfico, passo a passo,
    fronteira, detalhe da busca selecionada e "Como a exploração funciona" (nn.help); o seletor do passo a passo
    lista só as híbridas; clicar numa linha das execuções põe a busca nos dois seletores e no detalhe; objetivo,
    queda, amostra, correção, heurística e velocidade ficam no localStorage).
13. Conferir lado a lado com a HLS e atualizar a ajuda (feito: as duas abas na mesma ordem; a tabela das execuções
    passou a mostrar a economia em área, LUT e energia, como a da HLS mostra área, energia e latência; ajuda das redes
    reescrita em torno da aba Exploração, em português e inglês, com os resultados das etapas 7 e 9 e o teto. Ficam
    diferentes de propósito: as unidades por camada em colunas, as quedas estimada, na validação e no teste, e o
    detalhe da busca selecionada).

Parte C, ResNet 8 (MLPerf Tiny, CIFAR 10):
14. Fixar a arquitetura pela referência oficial (feito: docs/RESNET8.md e scripts/nn/resnet8_arch.py, que confere
    com o pretrainedResnet.h5 do mlcommons/tiny; 16, 32 e 64 filtros, 78 666 valores no .h5, 77 706 pesos e vieses
    com o BN dobrado, 12 501 632 multiplicações por imagem, 10 camadas com pesos; a referência dá 87,19% em ponto
    flutuante e 86,97% em int8 no teste, medido aqui; borda do padding='same' assimétrica no passo 2; proposta da
    soma residual dentro da reescala da segunda convolução de cada pilha; avaliação estimada em 30 ms por imagem
    numa thread).
15. Formato axc-nn/1 como grafo: convolução com passo e borda gerais, soma residual com reescala, média global
    (feito, com as três decisões da etapa 14: borda do Keras, soma residual dentro de uma reescala só e somas
    residuais e média exatas; name e input em cada camada, pad em lista, conv com output "acc", add com um m em Q32
    por entrada e exp, avgpool; decodeNet dá l.src, net.cuts, net.lastUse e net.graph; mulQ32Sum exata; as redes de
    hoje decodificam e classificam igual; o gerador de código, o custo e o diagrama recusam as redes com ramos com
    erro claro até as etapas 19 a 21; docs/RESNET8.md, seção Formato).
16. Avaliador bit exato em JavaScript com ramos (e as ativações guardadas da busca) (feito: inferFrom executa o
    grafo e libera os tensores que ninguém mais lê; o Evaluator guarda as ativações nos cortes, 44 kB por imagem
    na ResNet 8, e recomeça do último corte antes da camada trocada; o histograma das entradas das camadas, que a
    preparação usava dos buffers, vem da passada gravada; a correção de ganho de uma convolução "acc" muda o m do
    ramo dela na add; test/nngraph.test.js confere tudo contra uma referência com BigInt numa ResNet pequena;
    ResNet 8 com pesos sorteados: 39 ms por imagem exata e 45 ms com unidades aproximadas numa thread. Pendente
    para a etapa 22: memória dos avaliadores com 5000 imagens, 220 MB cada).
17. Treino no train.py (normalização em lote incorporada, aumento de dados, quantização da soma residual, 5000
    imagens de validação); Tiago treina na GPU (código feito: train.py resnet8 cifar10 com a receita da referência,
    aumento de dados na GPU, ponto de retomada por época e --resume, BN dobrado, quantize_resnet e
    int_forward_graph; testado aqui na CPU com 3000 imagens e 2 épocas, 5 s por época, int8 a 0,5 ponto do float;
    compatível com o Python 3.8 do Tiago. Falta o treino de verdade: GTX 1650, 500 épocas).
18. Conferência bit a bit Python e JavaScript (feito: scripts/nn/intcheck.py roda a inferência inteira do Python em
    qualquer rede do formato, sem PyTorch; test/nngraph.test.js compara com o avaliador a ResNet 8 de pesos
    sorteados, saída a saída, e, quando data/nn/resnet8-cifar10.json existir, as 1000 classes e as 10 000 saídas
    gravadas pelo treino em expected e expectedOut; conferido com a rede de 2 épocas).
19. Diagrama da arquitetura com ramos (feito: caminho principal na linha, soma residual num círculo ⊕, atalhos em
    arcos com a caixa da convolução 1 × 1; o das redes de hoje continua igual, byte a byte; ResNet 8 com pesos
    sorteados em test/fixtures/resnet8.js).
20. Gerador de código HLS para os tipos novos (feito: borda com lados diferentes, convolução que entrega o
    acumulador, soma residual com a função nova requant2 da linguagem da página de síntese, média; requant2 em toda a
    cadeia da HLS, inclusive o C++ do Vitis; os kernels, executados pelos tensores, dão as saídas do avaliador; o
    código das redes de hoje continua igual, byte a byte).
21. Modelo de custo dos kernels novos (feito: o modelo de custo roda na ResNet 8; requant2 estimada como duas
    reescalas, ainda sem caracterização própria; a rede compartilha uma requant2 como já fazia com a reescala;
    ResNet 8 com pesos sorteados: 64 ms por imagem a 10 ns, 4,28 mm², 69,6 mil LUTs, 6 DSP; montar o modelo leva
    cerca de 70 s, quase tudo na elaboração das convoluções, então na página isso vai para um worker).
22. Busca na ResNet 8 (10 camadas com pesos, 20 grupos); ajustar tempos e padrões (feito na linha de comando:
    validação inteira dividida entre os workers, com a conferência em paralelo e nada dela na thread que coordena;
    modelo de custo da busca só com o resumo de cada combinação, 53 ms por combinação nova; custo da página num
    worker; ResNet 8 no registro com page: false). Treino (etapa 17, por Tiago, 500 épocas): ponto flutuante
    86,23% no teste e 88,14% na validação; 8 bits 85,19% no teste, 87,24% na validação de 5000, 84,5% no
    subconjunto de 1000 da página. Buscas aqui (2 núcleos, local híbrida, área, limite de 1 ponto): com amostra
    de 250 da validação de 1000, a margem do limite é de 2 imagens e a busca terminou na exata (0%); com amostra de
    1000 da validação de 5000 (--val 5000 --sample 1000), 8,4% de área, queda de 0,7 ponto na validação inteira e
    1,1 no teste de 1000, 22% do teto de 37,8%, em 81 minutos (calibração 25, modelo estático 5, verificação 46)
    e 1,1 GB. Padrão recomendado para a ResNet 8: --val 5000 --sample 1000. Na página (etapa 25), a validação de
    1000 dá só uma margem pequena, então ela precisa da de 5000.
23. Exportação para o Vitis e o Vivado dos tipos novos, com a correção do viés.
24. Rodada no Vitis e no Vivado (Tiago).
25. ResNet 8 no seletor, no nnbench e na ajuda; rodada da matriz.

## O que já existe

* Rede: `js/axc/nn.js` (formato axc-nn/1, avaliador bit exato, `inferFrom`, `sumTerms` com U = 0, 1 ou grupos).
* Gerador e custo: `js/axc/nngen.js` (diretivas por camada, `directiveTrees`, `costModel`, requant compartilhado).
* Busca medida: `js/axc/nnsearch.js` (`prepareSearch`, `searchNetwork`, heurísticas sensitivity e sequential,
  `localEngine`/`poolEngine`, amostra estratificada e reparo no conjunto de validação inteiro).
* Exportação: `js/axc/nnexport.js`; validação: `node bin/axc.mjs nnvitis`; rodadas em `results/nn-vitis/`.
* Documentos (fora do repositório): `modelos_e_heuristicas.tex` e `redes_neurais.tex`.

## Busca híbrida (itens 1 a 5 implementados)

1. Modelo estático de erro por camada: o erro RMS da soma (já calculado em `pareto`, com os histogramas reais de
   operandos e a estrutura das diretivas), convertido em LSB da saída pela escala do requant da camada.
2. Calibração de uma curva erro → queda de acurácia por camada (trocas isoladas medidas por classificação,
   poucas dezenas de pontos); a queda de uma combinação é a soma das curvas.
3. Busca no modelo estático com todas as heurísticas da página HLS (sequencial, eficiência, local, tabu, GRASP,
   genético, aleatória; exaustiva viável na MiniLenet). Custo por ponto em milissegundos.
4. Verificação dos melhores pontos por classificação real (amostra + reparo, como hoje).
5. A busca medida atual continua como opção.

Implementação (out/2026): heurísticas num módulo genérico `js/axc/heuristics.js` (a HLS usa `hlsProblem`, resultado
idêntico ao anterior em 32 execuções de referência); nas redes, `staticModel`, `monotoneCurve` (isotônica com origem
fixa, cauda pela reta mais inclinada), `calibrateCurves` (8 trocas isoladas por camada espalhadas pelo erro, mais até
4 de refinamento onde a queda salta mais de 1 p.p. abaixo de 3 p.p.), `nnProblem` e `hybridSearch` em
`js/axc/nnsearch.js`; linha de comando `node bin/axc.mjs nnsearch --hybrid --heuristic local`. Verificação: os
viáveis da fronteira estimada do mais barato para o mais caro, depois os outros viáveis; com amostra, o primeiro que
passa é conferido na validação inteira. `onPoint({phase: calib|search|verify, cost, drop, ...})` e `steps` (o passo a
passo das heurísticas, com `drop` no lugar de `psnr`) servem à animação e à tabela.

| Área, limite 1 p.p. | MiniLenet MNIST | LeNet 5 CIFAR 10 |
| --- | ---: | ---: |
| Busca medida (sensibilidade) | 12,9%, 114 classificações | 9,6%, 143 |
| Híbrida (local, tabu, GRASP, genético, eficiência) | 12,3%, 32 + 1 a 2 | 9,1%, 49 + 14 a 16 |
| Híbrida sequencial | 1,0% | 9,0% |

Pendências da busca: tratadas em 25/out (ver a seção seguinte); a base de ativações mais próxima do ponto verificado
(para verificar mais rápido) continua como ideia.

## Correções de 25/out (busca com amostra) e pipeline de avaliação

Sintoma (página, MiniLenet MNIST, 250 imagens): o ponto escolhido ficava coberto por pontos viáveis visitados, e a
sequencial medida voltava para a exata. Causas e correções:

1. Amostra enviesada: `stratified` pegava as primeiras imagens de cada classe, as mais fáceis (a exata acertava 100%
   das 250 primeiras, contra 99,3% da validação inteira). Agora sorteia com semente fixa dentro de cada classe.
2. Reparo cego: desfazia as últimas trocas aceitas até caber, e o ponto resultante nem tinha sido avaliado. Agora a
   escolha é o mais barato entre os viáveis visitados que passa na validação inteira (conferidos em ordem de custo,
   até maxVerify); se nenhum passa (a sequencial aceita cada troca no limite da amostra), volta para a exata, uma por
   vez, a unidade cuja volta dá o ponto mais barato que passa. No gráfico, × marca os reprovados na validação inteira.
3. Híbrida: verificação em rodadas com o limite estimado apertado (1; 0,75; 0,5; 0,25 do limite) quando os
   verificados não passam; um ponto medido para a tabela que passa e custa menos vira o escolhido.
4. Página: cores próprias para as buscas medidas na comparação; exportação da fronteira em CSV e JSON; ajuda atualizada.

Com a validação inteira, a calibração do custo das redes (b5179a3) não piorou a busca: sensibilidade, MiniLenet
MNIST, área 12,9% antes (3d72c68) e agora, LUT 11,4% antes e 12,9% agora. A piora vista na página vinha da amostra.

Pipeline: `node scripts/nnbench.mjs` roda a matriz de casos (padrão: MiniLenet MNIST, área e LUT, amostra de 250 e
validação inteira, sensibilidade, sequencial, híbrida local e híbrida sequencial) e grava results/nn-search/<id>/
(LEIAME.md, casos.csv, casos.json). Rodadas guardadas: `antes` (baebedf), `depois` (estas correções), `cifar`
(LeNet 5 CIFAR 10, área). Opções: --models, --objectives, --samples, --heuristics (h:<heurística> para a híbrida),
--drops, --workers, --id, --quick.

Economia de área (limite 1 p.p.; entre parênteses, a queda na validação inteira em p.p.):

| | MiniLenet 250, antes | MiniLenet 250, depois | MiniLenet 1000 | LeNet 5 CIFAR 10, 1000 | CIFAR 10, 250 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sensibilidade | 11,9% (0,9) | 12,5% (0,5) | 12,9% (1,0) | 9,6% (0,8) | 9,1% (0,4) |
| Sequencial medida | 0,0% | 10,7% (1,0) | 10,3% (1,0) | | |
| Híbrida local | 10,8% (0,3) | 12,1% (0,5) | 12,4% (0,8) | 9,1% (0,7), 10 verificados | 9,5% (0,0) |
| Híbrida sequencial | 1,2% | 10,4% (0,5) | 11,4% (0,3) | 9,2% (0,9), 1 verificado | 3,3% (0,4), 18 verificados |

Pendências: a híbrida local no objetivo LUT com a validação inteira (MiniLenet: 8,9%, contra 12,9% da
sensibilidade, 20 verificados em 4 rodadas); a híbrida sequencial no CIFAR 10 com amostra; a queda no teste do
CIFAR 10 (2 a 3 p.p. com 1 p.p. na validação, pelo ruído de 1,4 p.p. da validação de 1000 imagens).

Próximos passos sugeridos: rodar a matriz com vários workers e nas outras redes (--models
minilenet-fashion,lenet5-mnist,lenet5-fashion,lenet5-cifar10); conferir no CIFAR 10 se as rodadas reduzem as
verificações; decidir o padrão de amostra da página (feito em 26/out: a validação inteira).

## Matriz nas outras redes (26/out, results/nn-search/2026-10-26-01-00)

MiniLenet Fashion, LeNet 5 MNIST, LeNet 5 Fashion e LeNet 5 CIFAR 10; área e LUT; amostra de 250 e validação inteira;
4 heurísticas; 7 workers. 64 casos: nenhum acima do limite na validação inteira, nenhum ponto coberto, nenhum erro.

1. Com a validação inteira, a busca híbrida local é a melhor: 97% da melhor economia de cada caso em média, nunca
   abaixo de 9,1%, e cerca de metade do tempo da sensibilidade (45 s contra 82 s). A sequencial híbrida oscila
   (LeNet 5 MNIST, LUT: 7,9% contra 15,5% da local).
2. A amostra de 250 imagens não serve com limite de 1 p.p.: o limite são 2 imagens, e a busca fica dominada pelo
   acaso da amostra (quedas negativas na amostra; na LeNet 5 Fashion, área, três heurísticas terminam na exata). A
   página passou a usar a validação inteira por padrão e avisa quando o limite cabe em menos de 5 imagens.
3. A queda no teste é cerca do dobro da queda na validação (1,4 contra 0,7 p.p. em média, com a validação inteira; 2
   a 4 p.p. no CIFAR 10): a busca escolhe o ponto mais barato que passa na validação de 1000 imagens, e os que passam
   por sorte são favorecidos.

Próximo passo sugerido para o item 3: usar mais imagens de validação. O scripts/nn/train.py já separa 5000 imagens
de validação (500 por classe, sorteadas com a semente), mas grava só 1000 (as 100 primeiras de cada classe). As 5000
podem ser exportadas sem treinar de novo (o sorteio depende só da semente e dos rótulos de treino), num arquivo
separado para a linha de comando e o nnbench, deixando o de 1000 na página. A MiniLenet do MNIST veio do C
(scripts/nn/import.mjs) e precisa de outro caminho.

## Números do teste do proxy (scratch proxy.mjs / proxy2.mjs, refazer se preciso)

| | MiniLenet MNIST | LeNet 5 CIFAR 10 |
| --- | ---: | ---: |
| Spearman, trocas isoladas | 0,80 | 0,78 |
| Spearman, 60 combinações (soma das curvas) | 0,94 | 0,92 |
| Viabilidade com limite 1 p.p. acertada | 53/60 | 53/60 (conservador) |

Ruído da validação: desvio padrão de sqrt(p(1-p)/n), 0,3 p.p. no MNIST e 1,4 p.p. no CIFAR 10 com 1000 imagens.

## Calibração (estado depois do lote do fim de semana)

* Feito: `MODEL.ffPerLoop = 11`; no fluxo das redes, `VITIS_NN` em `js/axc/nngen.js` (produto exato uint8 x int8 com
  64 LUTs, requant 45 LUTs, endereço x0,5, controle x0,6) e endereço por dimensão com dimensões internas potência de 2
  (`partitionLogic`). Camadas exatas: LUT de 55% para 15% (validação cruzada 15%). Redes exatas: MiniLenet +15%,
  LeNet 5 +7%, MiniLenet com partição -15%. Kernels de imagem sem mudança (LUT 14,6%, FF 21,1%).
* Ferramentas: `node scripts/vitis.mjs calibdata`, `node scripts/calibrate.mjs [--nn] [--nnaddr] [--loo] [--rows]
  [--rounds regex]`.
* Calibração encerrada na rodada 6 (ver results/nn-vitis/LEIAME.md). Redes aproximadas no Vivado: MiniLenet
  4603 LUT (modelo 5272), LeNet 5 9820 (10050), latência dentro de 0,2%. Limitações registradas: custo das unidades
  aproximadas por camada no Vitis, FF das aproximadas e da partição (20% a 37%), II 1 das maxpool na rede.
* No FPGA, a economia de LUT das unidades aproximadas é pequena (o produto exato do Vitis tem 64 LUTs); o objetivo
  LUT tende a escolher unidades exatas. Área e energia (sky130) continuam com economia.

## Interface da página das redes (lenet.html): feita

Os três itens abaixo estão implementados (out/2026), com os ajustes de 25/out (aba Custo com ASIC e FPGA juntos,
comparação de buscas no gráfico, pontos aparecendo durante a busca): a aba Busca tem as oito heurísticas híbridas (e
a busca medida), a tabela da fronteira (custo, economia, queda estimada e medida, unidades por camada, Aplicar) e o passo a passo
(calibração, iterações da heurística, verificações), com `dseStepSvg` de `js/hls/ui.js` num eixo y de acurácia
estimada (opção `yAxis`; o SVG da HLS ficou idêntico em 86 passos conferidos).

## Plano original da interface

1. A busca híbrida descrita acima, com as heurísticas da página HLS.
2. Lista dos pontos da fronteira de Pareto, como na página HLS (tabela com custo, queda de acurácia e unidades por
   camada; clicar aplica o ponto).
3. Animação da busca, como na página HLS (pontos avaliados aparecendo no gráfico custo x erro durante a busca).
Os itens 2 e 3 dependem de a busca expor o progresso por ponto avaliado; vale desenhar a API junto com o item 1.

## Regras do projeto

Commits como "Tiago Almeida" <tiagoalmeida@mail.uft.edu.br>, sem Co-Authored-By. Sem hífens/travessões em prosa
gerada. Tabelas LaTeX com `\rowcolor{tabAzul}\color{white}` e `\hline`. Entrega por bundle
(`git bundle create ../X.bundle HEAD main`).
