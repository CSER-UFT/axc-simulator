# Handoff: busca híbrida nas redes neurais

Resumo para continuar o trabalho numa conversa nova. Estado do repositório no commit deste arquivo.

## O que já existe

* Rede: `js/axc/nn.js` (formato axc-nn/1, avaliador bit exato, `inferFrom`, `sumTerms` com U = 0, 1 ou grupos).
* Gerador e custo: `js/axc/nngen.js` (diretivas por camada, `directiveTrees`, `costModel`, requant compartilhado).
* Busca medida: `js/axc/nnsearch.js` (`prepareSearch`, `searchNetwork`, heurísticas sensitivity e sequential,
  `localEngine`/`poolEngine`, amostra estratificada e reparo no conjunto de validação inteiro).
* Exportação: `js/axc/nnexport.js`; validação: `node bin/axc.mjs nnvitis`; rodadas em `results/nn-vitis/`.
* Documentos (fora do repositório): `modelos_e_heuristicas.tex` e `redes_neurais.tex`.

## O que foi decidido para a busca (aprovado, ainda não implementado)

1. Modelo estático de erro por camada: o erro RMS da soma (já calculado em `pareto`, com os histogramas reais de
   operandos e a estrutura das diretivas), convertido em LSB da saída pela escala do requant da camada.
2. Calibração de uma curva erro → queda de acurácia por camada (trocas isoladas medidas por classificação,
   poucas dezenas de pontos); a queda de uma combinação é a soma das curvas.
3. Busca no modelo estático com todas as heurísticas da página HLS (sequencial, eficiência, local, tabu, GRASP,
   genético, aleatória; exaustiva viável na MiniLenet). Custo por ponto em milissegundos.
4. Verificação dos melhores pontos por classificação real (amostra + reparo, como hoje).
5. A busca medida atual continua como opção.

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
* Pendente: rodada 5 (`scripts/rodada-aprox.sh`), as redes aproximadas com a chamada única da unidade (a chamada nos
  dois ramos do sinal triplicava o II e duplicava as unidades). Com ela, calibrar o custo das unidades aproximadas
  em Vitis. Atenção para a busca: com o produto exato a 64 LUTs, MUL8 T4 com ADD32 LOA10 já dá mais LUTs que a rede
  exata no modelo (5427 contra 5355); no FPGA, o objetivo LUT tende a escolher as unidades exatas. Área e energia
  (sky130) continuam com economia.
* Também pendente: II 1 das maxpool dentro da rede (2 sozinhas); chamada outlined das densas (cerca de 4 ciclos).

## Regras do projeto

Commits como "Tiago Almeida" <tiagoalmeida@mail.uft.edu.br>, sem Co-Authored-By. Sem hífens/travessões em prosa
gerada. Tabelas LaTeX com `\rowcolor{tabAzul}\color{white}` e `\hline`. Entrega por bundle
(`git bundle create ../X.bundle HEAD main`).
