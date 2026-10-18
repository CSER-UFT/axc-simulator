# Metodologia e limitações da síntese de alto nível aproximada

Este documento descreve o que a página `hls.html` e os comandos `hls` e `dse` calculam, as hipóteses de cada modelo, o que foi validado e o que não foi, e como reproduzir os estudos de caso. O objetivo da ferramenta é apoiar decisões de pesquisa: comparar, antes de uma síntese completa, onde e com quais unidades aproximadas um kernel ganha mais em área, energia ou tempo para um limite de erro na saída. Os números absolutos são estimativas de pré síntese; as comparações relativas entre projetos são o uso pretendido.

## 1. Fluxo

1. **Biblioteca de unidades** (`data/synth.json`, gerado por `scripts/synth.mjs`). Cerca de 540 multiplicadores e somadores exatos e aproximados de 8 e 16 bits, cada um exportado em Verilog, conferido no Icarus Verilog contra o modelo do simulador e sintetizado:
   * ASIC SkyWater 130 nm (`sky130_fd_sc_hd`, canto tt, 1,8 V) com Yosys e ABC em três fluxos (atraso mínimo, área mínima e iso atraso, com o atraso da unidade exata), atraso e energia medidos no OpenSTA (driver `buf_2`, carga de 5 fF, wire load "Small", potência a partir de uma simulação em nível de portas com 2048 pares);
   * FPGA Xilinx série 7 com `synth_xilinx` (LUTs e CARRY4, sem DSP).
   Multiplexador, comparador, lógica e o registrador `dfxtp_1` foram medidos no mesmo fluxo (`scripts/hls-cells.mjs`, `data/hls-cells.json`).
2. **Kernel**: um subconjunto de C com tipos de largura explícita, vetores, `for` de limites constantes e as diretivas do Vitis HLS (`pipeline II`, `unroll factor`, `array_partition`, `allocation`).
3. **Elaboração** (`js/hls/elab.js`): execução simbólica que desenrola os laços pedidos (e todos os internos a um laço com pipeline), dobra constantes, representa os índices como expressões afins (o que dá o banco de memória de cada acesso), elimina subexpressões comuns e calcula a faixa de cada valor por análise de intervalos. A faixa escolhe a largura de cada operação (8, 16 ou 32 bits).
4. **Escalonamento** (`js/hls/sched.js`) com encadeamento no ciclo, operações de vários ciclos e pipeline modular (II pelo maior entre o pedido, o mínimo por recursos e o mínimo pela recorrência).
5. **Ligação e custo** (`js/hls/cost.js`): compartilhamento das unidades (left edge sem pipeline, tabela de reservas com pipeline), multiplexadores de entrada, registradores pela vida de cada valor, contadores dos laços.
6. **Erro** (`js/hls/exec.js`, `js/hls/error.js`): perfil exato, modelo estático e verificação bit a bit.
7. **Exploração** (`js/hls/dse.js`): busca das unidades, e opcionalmente das diretivas e do período, com restrição de erro.

## 2. Modelo de custo

| Item | Como entra | Hipótese |
| --- | --- | --- |
| Unidades aritméticas | área, atraso, energia por operação e fuga da síntese sky130; LUT e CARRY4 da síntese FPGA | energia por operação com entradas uniformes (não a dos dados do kernel); somador de 32 bits é a cascata de dois de 16 |
| Encadeamento | operações cabem num ciclo enquanto a soma dos atrasos não passa do período menos o tempo do registrador (relógio para a saída 298 ps, setup 111 ps) | o atraso dos multiplexadores de entrada não entra no escalonamento |
| Memória | leitura síncrona com 1 ciclo de latência, portas por banco escolhidas | área e energia das memórias não entram |
| Laços | 1 ciclo de controle por iteração sem pipeline; 1 ciclo de entrada e saída com pipeline | constantes em `MODEL` (`js/hls/sched.js`), a calibrar contra o Vitis HLS |
| Registradores | `dfxtp_1` por bit; com pipeline, um por estágio atravessado | sem desligamento do relógio: cada bit gasta a energia de um ciclo em todos os ciclos |
| Energia por execução | operações executadas, registradores, controle e fuga | sem a árvore de relógio e sem fios (números de pré layout) |

Aproximar uma operação muda o custo de três formas, e todas estão no modelo: a unidade é mais barata, o atraso menor pode permitir mais encadeamento ou um II menor, e unidades exatas e aproximadas da mesma largura são recursos diferentes. Por esse último motivo, aproximar uma única operação de um grupo que compartilha unidades pode aumentar a área.

## 3. Modelo de erro

O erro de um valor é o aproximado menos o exato. Para cada nó do DFG, o modelo guarda a média (viés) e o segundo momento do erro e os propaga das unidades aproximadas até as saídas, sem executar o kernel aproximado.

**Perfil.** Uma execução exata do projeto elaborado com os dados de entrada (a imagem de teste de 192 × 192 ou valores uniformes na faixa do tipo, semente fixa) dá a média e o segundo momento de cada valor, 4096 amostras dos operandos de cada operação (reservatório) e 2048 execuções amostradas de cada trecho com todos os valores daquela execução.

**Erro próprio.** O erro de cada unidade é medido sobre as amostras dos operandos daquela operação, não sobre operandos uniformes. O mesmo multiplicador erra diferente com o coeficiente 19 e com o 52.

**Modelo analítico.** Soma: e = ea ± eb + eu. Produto: e = a·eb + b·ea + ea·eb + eu, com os momentos de a e b do perfil. Deslocamento para a direita por k bits: a média se divide por 2^k e a variância ganha E[p(1 − p)], com p = (e mod 2^k) / 2^k sobre a distribuição normal do erro (o arredondamento para baixo). Resto por potência de 2: média zero e segundo momento E[q(2^k − q)]. Comparação e seleção (min, max, abs, ?:): a probabilidade de a decisão trocar, amostra a amostra, e a distância até o outro lado quando ela troca. Hipótese central: erros independentes entre si e dos sinais.

**Modelo por amostras.** Dentro de cada trecho, as execuções amostradas são refeitas com as unidades aproximadas; o erro que chega de outros trechos, das recorrências e da memória entra como ruído normal com a média e a variância propagadas. As correlações dentro do trecho ficam no modelo: um somador que já zerou os bits baixos de uma parcela, um erro que depende dos bits baixos dos operandos, a troca de decisão de uma saturação.

**Recorrências.** O erro do acumulador evolui como e(t + 1) = g·e(t) + d, com o incremento d medido no corpo do laço e o ganho g pelo modelo analítico (linear). Dentro do laço vale a média sobre as iterações; depois dele, o valor final.

**Memória.** Cada vetor guarda a média dos erros escritos nele, pesada pelas execuções; as leituras veem essa média.

**Verificação bit a bit.** O projeto elaborado (os mesmos laços, trechos, truncamentos e larguras de memória do hardware) é executado com os modelos funcionais das unidades (tabela exaustiva nos multiplicadores de 8 bits, netlist com memória nos de 16 bits, modelo aritmético conferido nos testes nos somadores) e comparado com o exato nas posições escritas: ME, MSE, PSNR, SSIM (janelas 8 × 8), MED, WCE, EP e MRED. A execução exata é conferida nos testes contra implementações de referência em JavaScript.

## 4. Exploração

* **Avaliação**: cada ponto é sintetizado de novo (cerca de 1 ms, porque a elaboração é feita uma vez por variante) e o erro vem do modelo estático (por amostras com todas as execuções guardadas no perfil, até 2048 por trecho, ou analítico). Com menos amostras a busca fica mais rápida, mas o ruído da estimativa favorece, entre milhares de pontos, os estimados com folga a mais: no FIR com grupos por operação e 512 amostras, os pontos escolhidos perto de 60 dB mediram cerca de 0,6 dB a menos.
* **Objetivo**: área ASIC, LUT + CARRY4, energia por execução, latência, intervalo entre resultados, ou a soma ponderada de área, energia e latência, cada uma dividida pela do projeto exato. **Restrição**: PSNR mínimo ou MSE máximo, em todas as saídas.
* **Grupos**: a unidade é escolhida por classe (todas as operações da mesma classe e largura), por linha do código ou por operação.
* **Candidatas**: em cada grupo, as unidades da fronteira de Pareto entre o custo da unidade no objetivo e o erro próprio nas operações do grupo.
* **Heurísticas**:
  * sequencial: os grupos na ordem do código, multiplicações antes das somas; em cada grupo, a candidata de menor custo que mantém a restrição (a busca usada na pesquisa anterior do autor);
  * eficiência: a partir do exato, a cada passo a troca com a maior economia de custo por aumento de erro que mantém a restrição, até nenhuma economizar; com grupos menores que a classe, também a troca da classe inteira. Com mais de 400 trocas possíveis por passo (o FIR por operação), a avaliação é preguiçosa: só as 40 trocas de maior eficiência guardada (e as do grupo que mudou) são reavaliadas a cada passo, o que supõe retorno decrescente e reduz o tempo do FIR de cerca de 250 s para 30 s;
  * exaustiva com poda: todas as combinações em ordem de custo (o primeiro ponto viável é o ótimo do modelo); a poda descarta, em cada grupo, as unidades de erro próprio maior que a primeira que sozinha já viola a restrição (poda heurística);
  * aleatória: amostras com semente fixa, como referência.
* **Resultado**: o ponto viável mais barato entre os avaliados pela heurística, executado bit a bit; se o erro medido passar do limite, o próximo viável em ordem de custo é verificado.
* **Variantes**: cada diretiva `pipeline`, `unroll` e `array_partition` ligada ou desligada, e os períodos pedidos.

## 5. Ameaças à validade

**Interna (os modelos).**
* O custo é de pré síntese: sem posicionamento, roteamento, fios e árvore de relógio; as constantes de latência da memória e de controle ainda não foram calibradas. A comparação com o Vitis HLS e o Vivado está preparada (seção 6) e a calibração depende dos relatórios dessa execução.
* A energia das unidades é a de entradas uniformes; com os dados de uma aplicação ela pode mudar bastante (na biblioteca, a vantagem de energia do MUL8 DRUM3 cai de 63% para 7% com os operandos da LeNet-5). A biblioteca já tem a energia com os operandos da LeNet-5 e do filtro, mas o modelo de HLS ainda não a usa.
* O modelo de erro supõe, entre trechos, erros independentes e normais. Somadores truncados ou segmentados dentro de um acumulador são estimados como se o acumulador tivesse bits baixos quaisquer, o que superestima o erro do truncado (até cerca de 13 vezes no produto escalar). A verificação bit a bit corrige a decisão final, mas a busca pode descartar pontos bons nesses casos.
* A poda da exaustiva é heurística; a gulosa de eficiência pode parar num mínimo local.

**De construto (o que se mede).**
* A qualidade é medida por PSNR e MSE na saída do kernel, não por uma métrica da aplicação inteira (classificação, detecção). O SSIM é só medido.
* A imagem de teste é sintética (gradientes, círculos, listras, xadrez e textura); o experimento E5 mostra que o projeto escolhido com um conjunto de dados pode não manter o limite em outro.

**Externa (generalização).**
* Cinco kernels pequenos (filtros 3 × 3, FIR de 16 coeficientes, produto escalar); laços de limites constantes, sem `if` nem `while`, sem ponto flutuante.
* A biblioteca tem unidades de 8 e 16 bits (32 bits só como cascata de somadores); as unidades da EvoApproxLib estão na biblioteca de referência, mas não no HLS.
* Subtrações e somas com sinal ficam exatas (as unidades são sem sinal e sem vem um).

**De conclusão (estatística).**
* O perfil e o modelo por amostras usam amostras com semente fixa: os números são reprodutíveis, mas são estimativas; a verificação bit a bit usa todas as posições da saída.
* Os estudos usam uma imagem e um período por padrão; diferenças pequenas entre heurísticas (menos de 1% de área) não devem ser tomadas como significativas.

## 6. Validação com o Vitis HLS e o Vivado

O mesmo projeto é descrito em C++ para o Vitis HLS 2022.2 (`scripts/vitis.mjs`). No caso `_ir`, o C++ é o projeto elaborado pelo simulador: os laços mantidos com as mesmas diretivas, o corpo de cada trecho em linha reta, cada valor com a largura da análise de faixas e cada operação aproximada chamando a função C++ da sua unidade (a netlist, com as cadeias de vai um escritas como `+`, como no Verilog). Assim a comparação mede o modelo de custo, não diferenças de entrada. No caso `_src`, o código original vai para o Vitis como está: a diferença entre `_src` e `_ir` mostra o efeito da nossa elaboração e da análise de faixas.

Configuração: parte `xc7a100tcsg324-1`; multiplicadores em LUT (`config_op mul -impl fabric`, como a biblioteca, sintetizada sem DSP); sem pipeline automático de laços (`config_compile -pipeline_loops 0`), já que o modelo só faz pipeline onde a diretiva pede; memórias `ap_memory` com 2 portas (`ram_t2p`), latência de 1 ciclo; incerteza de relógio padrão do Vitis.

O que se compara: a latência total e por laço, o II, o período (o mínimo do modelo, o estimado pelo Vitis e o obtido no Vivado), LUT, CARRY4 e FF, e a saída da csim contra a execução bit a bit. Diferenças esperadas: o encadeamento do modelo usa os atrasos da sky130 e o do Vitis, os do Artix 7, então em períodos apertados o escalonamento pode divergir; as LUTs do modelo vêm do Yosys, e as do Vitis e do Vivado, das ferramentas da Xilinx.

O C++ dos 23 casos foi compilado com g++ e os cabeçalhos abertos do `ap_int`, e a saída é idêntica à execução bit a bit do simulador em todas as posições (o mesmo teste está em `test/hls-vitis.test.js` quando os cabeçalhos estão disponíveis).

## 7. Como reproduzir

```
npm test                               # 54 testes, inclusive execução exata contra referência e precisão do modelo
npm run experiments                    # estudos de caso E1 a E5, saída em results/ (cerca de 15 a 30 min)
node scripts/experiments.mjs --only E2 # só um experimento
node scripts/experiments.mjs --quick   # versão reduzida, para conferir o ambiente (menos de 1 min)
```

A saída tem um CSV por experimento, `results/RESULTADOS.md` com as tabelas, `results/tabelas.tex` com as mesmas tabelas em LaTeX (cabeçalho `tabAzul`) e `results/meta.json` com a data, o commit, a versão do Node e a da biblioteca sintetizada. Os dados de entrada, as sementes e a biblioteca estão no repositório; os mesmos commit e Node dão os mesmos números. Para refazer a biblioteca (horas de CPU, com Yosys, Icarus Verilog e OpenSTA): `npm run synth`.

Os comandos da linha de comando usados nos estudos também servem para experimentos próprios:

```
node bin/axc.mjs hls --example gauss --approx "mul8=MUL8 DRUM6" --error --json
node bin/axc.mjs dse kernel.c --psnr 40 --heuristic all --granularity op --csv
```

## 8. Resultados

Os números dos estudos de caso estão em [`results/RESULTADOS.md`](../results/RESULTADOS.md). Resumo:

* **Modelo de erro (E1)**: em 72 casos (cinco kernels, nove famílias de unidades, dois conjuntos de entrada), o modelo por amostras fica a menos de 10% do MSE medido em 79% dos casos e em 98% dos kernels com pipeline; o analítico, em 33%. Os desvios maiores (até 3,8 vezes) são todos do gaussiano sem diretivas, em que o acumulador é uma recorrência entre iterações. No produto escalar, o viés estimado das multiplicações coincide com o erro medido; o dos somadores no acumulador, não (o truncado é superestimado em 2 a 4 vezes).
* **Heurísticas (E2)**: com grupos por classe, as quatro chegam ao mesmo ponto ou muito perto dele (a exaustiva dá o ótimo do modelo). Com grupos por operação, a eficiência é melhor que a sequencial em 9 de 24 configurações e pior em 1, com até 17% menos área (gauss a 40 dB: 39,3% de economia contra 28,1%; FIR a 60 dB: 52,9% contra 49,3%). Escolher por operação economiza mais que por classe (FIR a 60 dB: 52,9% contra 36,3%), ao preço de cerca de 2700 avaliações e 16 s por busca. A exaustiva por operação é inviável (mais de 10^12 combinações depois da poda). O ponto mais barato estimado como viável passou na verificação bit a bit em 89 de 90 buscas.
* **Kernels com subtrações (Sobel e realce)**: economia pequena (2% a 7%), porque subtrações e somas com sinal ficam exatas. No realce, o MUL8 KUL multiplica por 5 sem erro (o bloco 2 × 2 de Kulkarni só erra em 3 × 3, e 5 = 101 em binário não tem dois uns vizinhos): 7,2% de área sem perda nenhuma, em qualquer limite.
* **Fronteiras verificadas (E3)**: ao longo das fronteiras, a diferença média entre o PSNR estimado e o medido é de 0,2 dB (no máximo 4,6 dB); no limite de 40 dB, nenhum ponto aceito pelo modelo foi rejeitado pela medida, e um ponto viável foi rejeitado pelo modelo.
* **Diretivas e período (E4)**: no gaussiano, o objetivo ponderado e o de latência escolhem o período de 2,5 ns com pipeline; o de área escolhe tirar o pipeline (5731 µm², mas 20 vezes a latência).
* **Dados (E5)**: o projeto escolhido com entradas uniformes não mantém os 40 dB na imagem (39,7 dB no gaussiano, 38,9 dB no Sobel); o escolhido com a imagem mantém nas uniformes. O perfil deve vir de dados representativos da aplicação.
