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

## Calibração pendente (dados do lote do fim de semana, `scripts/fim-de-semana.sh`)

* Resultado do usuário: `~/Downloads/fds_resultados.tar.gz` (redes exata/aprox/part e os 59 kernels de imagem).
* `node scripts/vitis.mjs calibdata` gera `build/calib/kernels.json`; `node scripts/calibrate.mjs` ajusta (NNLS,
  `--loo`). Aplicado até agora só `MODEL.ffPerLoop = 11`. O ajuste linear global de LUT piorou os kernels
  (14,8% → 18,9%) por causa da variância de ROM e requant; refazer com os pesos em BRAM.
* Termos a ajustar: LUT de endereço/controle, chamada de laço outlined (cerca de 4 ciclos por chamada nas densas),
  LUT de cola do requant (cerca de 300), custo das unidades aproximadas como caixa preta; II 1 das maxpool.

## Regras do projeto

Commits como "Tiago Almeida" <tiagoalmeida@mail.uft.edu.br>, sem Co-Authored-By. Sem hífens/travessões em prosa
gerada. Tabelas LaTeX com `\rowcolor{tabAzul}\color{white}` e `\hline`. Entrega por bundle
(`git bundle create ../X.bundle HEAD main`).
