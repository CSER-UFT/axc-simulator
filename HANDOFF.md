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
4. Gráfico com as duas fronteiras.
5. Diagnóstico do teto de economia (unidade mais barata em tudo; fração do custo na aritmética), no nnbench.
6. Correção do viés com a medida escolhível, no modelo estático, no avaliador bit exato e na exportação.
7. Comparar as medidas da correção no nnbench.
8. Exportar as 5000 imagens de validação do train.py (script; Tiago roda, precisa das bases).
9. Rodar a matriz de novo com as 5000 imagens (Tiago, 7 workers).

Parte B, aba de exploração igual à da HLS:
10. Várias heurísticas por execução ("comparar todas" = as seis híbridas) e a tabela das execuções.
11. Seletor "Fronteira de", tabela da fronteira por heurística com todos os custos, CSV e JSON, Baixar projeto.
12. Passo a passo com seletor de heurística, blocos na ordem da HLS, bloco recolhível de explicação, controles
    guardados entre visitas, nomes Exploração e Explorar.
13. Conferir lado a lado com a HLS e atualizar a ajuda.

Parte C, ResNet 8 (MLPerf Tiny, CIFAR 10):
14. Fixar a arquitetura pela referência oficial.
15. Formato axc-nn/1 como grafo: convolução com passo e borda gerais, soma residual com reescala, média global.
16. Avaliador bit exato em JavaScript com ramos (e as ativações guardadas da busca).
17. Treino no train.py (normalização em lote incorporada, aumento de dados, quantização da soma residual, 5000
    imagens de validação); Tiago treina na GPU.
18. Conferência bit a bit Python e JavaScript.
19. Diagrama da arquitetura com ramos.
20. Gerador de código HLS para os tipos novos.
21. Modelo de custo dos kernels novos.
22. Busca na ResNet 8 (11 camadas com pesos, cerca de 22 grupos); ajustar tempos e padrões.
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
