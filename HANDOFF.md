# Handoff: busca híbrida nas redes neurais

Resumo para continuar o trabalho numa conversa nova. Estado do repositório no commit deste arquivo.

## O que já existe

* Rede: `js/axc/nn.js` (formato axc-nn/1, avaliador bit exato, `inferFrom`, `sumTerms` com U = 0, 1 ou grupos).
* Gerador e custo: `js/axc/nngen.js` (diretivas por camada, `directiveTrees`, `costModel`, requant compartilhado).
* Busca medida: `js/axc/nnsearch.js` (`prepareSearch`, `searchNetwork`, heurísticas sensitivity e sequential,
  `localEngine`/`poolEngine`, amostra estratificada e reparo no conjunto de validação inteiro).
* Exportação: `js/axc/nnexport.js`; validação: `node bin/axc.mjs nnvitis`; rodadas em `results/nn-vitis/`.
* Documentos (fora do repositório): `modelos_e_heuristicas.tex` e `redes_neurais.tex`.

## Busca híbrida (itens 1 a 5 implementados; interface pendente)

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

Pendências da busca: a sequencial fica presa em escolhas otimistas (na MiniLenet); no CIFAR 10 o modelo é otimista
perto do limite e a verificação reprova muitos pontos (ideias: margem aprendida com as reprovações, base de ativações
mais próxima do ponto verificado).

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

## Próxima conversa: busca híbrida e interface da página das redes (lenet.html)

1. A busca híbrida descrita acima, com as heurísticas da página HLS.
2. Lista dos pontos da fronteira de Pareto, como na página HLS (tabela com custo, queda de acurácia e unidades por
   camada; clicar aplica o ponto).
3. Animação da busca, como na página HLS (pontos avaliados aparecendo no gráfico custo x erro durante a busca).
Os itens 2 e 3 dependem de a busca expor o progresso por ponto avaliado; vale desenhar a API junto com o item 1.

## Regras do projeto

Commits como "Tiago Almeida" <tiagoalmeida@mail.uft.edu.br>, sem Co-Authored-By. Sem hífens/travessões em prosa
gerada. Tabelas LaTeX com `\rowcolor{tabAzul}\color{white}` e `\hline`. Entrega por bundle
(`git bundle create ../X.bundle HEAD main`).
