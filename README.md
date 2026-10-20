# Simulador de Computação Aproximada

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23427697.svg)](https://doi.org/10.5281/zenodo.23427697)

Simulador didático de **computação aproximada** (AxC), desenvolvido para o curso de **Ciência da Computação** da **Universidade Federal do Tocantins**, e usado também como ferramenta de pesquisa (grupo CSER).

Somadores e multiplicadores aproximados são construídos porta a porta, avaliados contra a versão exata com as métricas de erro da literatura, comparados pelo custo na fronteira de Pareto e levados, numa segunda página, para kernels inteiros por síntese de alto nível, com estimativa do erro e exploração do espaço de projeto. Roda inteiramente no navegador (HTML e JavaScript, sem dependências) e é publicado no GitHub Pages (em Settings > Pages, fonte "GitHub Actions").

Interface e ajuda em **português e inglês** (seletor no cabeçalho). O botão **Copiar link** gera um endereço com a configuração da unidade, a aba e os controles das abas, para compartilhar uma tela pronta (por exemplo, numa aula ou numa lista de exercícios). Cada uma das três páginas (unidades, rede neural e síntese de alto nível) tem a sua ajuda, no botão **Ajuda**. Qualquer gráfico, diagrama ou imagem pode ser baixado em **SVG** ou **PNG** pelos botões que aparecem ao passar o mouse sobre ele: o SVG leva os estilos escritos em cada elemento, no tema claro e com fundo branco.

*English: a simulator of approximate arithmetic circuits (gate level adders and multipliers, error metrics, Pareto front, voltage overscaling, approximate memory, stochastic computing, FPGA and ASIC synthesis) and of approximate high level synthesis (kernels with HLS directives, static error model, bit accurate verification and design space exploration). The interface and the help are available in English through the language selector in the header.*

## O que faz

* **Multiplicador** N × N (8 ou 16 bits): por colunas, com redução de Dadda e três zonas (truncadas, como em Schulte e Swartzlander, 1993; aproximadas com compressor 4:2 aproximado, uma simplificação do de Venkatachalam e Ko, 2017, e OR como no LOA; e exatas); Booth radix 4 com sinal, truncado (Booth, 1951; MacSorley, 1961); blocos 2 × 2 de Kulkarni (Kulkarni, Gupta e Ercegovac, 2011); DRUM (Hashemi, Bahar e Reda, 2015); logarítmico de Mitchell (1962); e compensação do viés por uma constante, para qualquer técnica.
* **Somador** exato (ripple carry), truncado, LOA (Mahdiani e colegas, 2010) e segmentado com previsão de vem um (no estilo do ACA, Kahng e Kang, 2012, e do GeAr, Shafique e colegas, 2015).
* **Estrutura**: diagrama de pontos dos produtos parciais com as zonas, altura das colunas a cada estágio de redução e tabela verdade do compressor aproximado.
* **Erro**: ME, MED, WCE (com o par que o produz), MSE, NMED, MRED e EP; avaliação exaustiva para 8 bits com entradas uniformes e por amostragem nos outros casos (entradas uniformes, normais, exponenciais ou **operandos reais das aplicações**: os pares da LeNet-5 nas 1000 imagens de teste e os do filtro gaussiano, gerados por `scripts/operands.mjs` em `data/operands.bin`), com o intervalo de confiança de 95% das médias quando há amostragem; mapa do erro sobre o plano (a, b) e histograma do erro com sinal.
* **Custo**: área em portas de duas entradas, atraso em níveis de porta e atividade de chaveamento (indicador de energia dinâmica), todos do modelo didático, e, para as configurações do espaço de projeto, LUTs, CARRY4 e profundidade de uma síntese real com o Yosys para FPGA Xilinx 7 series, e área (µm²), atraso (ps) e energia por operação (fJ) de uma síntese para ASIC com a biblioteca de células do PDK aberto SkyWater 130 nm.
* **Tensão e memória**: escalonamento de tensão além da margem, com atraso pela lei de potência alfa, tempo de chegada de cada bit dependente dos dados e captura do valor antigo quando o bit atrasa; curva de erro contra tensão da unidade e da exata, energia relativa e a imagem degradando; memória aproximada com inversão de bits e proteção dos bits mais significativos, com o MSE medido e o esperado. O modelo de atraso pode ser o genérico ou o ajustado às células do sky130 no canto lento a −40 °C (de 1,28 a 1,76 V), lido das tabelas da biblioteca pelo script `scripts/sky130/voltage.py` (resultado em `data/sky130-voltage.json`).
* **Estocástica**: valores como fluxos de bits, multiplicação por AND ou XNOR e soma escalada por MUX; quatro geradores (aleatório ideal, LFSRs diferentes, um LFSR só, sequência de Sobol) com o erro contra o comprimento do fluxo, o efeito da correlação, o custo dos geradores e do contador contra o binário, a tolerância a bits errados e um filtro gaussiano feito só com um MUX.
* **Síntese** (aba Biblioteca da página de síntese de alto nível): exportação em Verilog com testbench autoverificável e síntese de um **espaço de projeto** de cerca de 560 configurações (`js/axc/designspace.js`: Booth, Kulkarni, DRUM e Mitchell completos, com e sem compensação; multiplicador por colunas e somador segmentado numa grade regular de passo 2, cerca de 25% de cada; truncado e LOA completos) com o script `scripts/synth.mjs`, rodado localmente (horas de CPU) e com o resultado em `data/synth.json`:
  * o Verilog de cada configuração é conferido no Icarus Verilog contra o simulador;
  * FPGA Xilinx 7 series com o Yosys (`synth_xilinx -abc9`, sem DSP);
  * ASIC com a biblioteca sky130_fd_sc_hd (canto típico, 25 °C, 1,8 V; baixada de uma versão fixa do OpenROAD-flow-scripts e conferida pelo SHA-256) em três fluxos do ABC: **atraso mínimo**, **área mínima** e **iso atraso** (área mínima sob o atraso da unidade exata de mesma largura);
  * cada netlist mapeada é conferida de novo no Icarus Verilog (com os modelos funcionais das células lidos da biblioteca) e medida com o **OpenSTA**: atraso do caminho crítico (modelo de fio da biblioteca, buf_2 nas entradas, 5 fF nas saídas) e energia por operação a partir da atividade de uma simulação da própria netlist, com entradas uniformes e com os operandos reais da LeNet-5 e do filtro. A simulação é de atraso zero, então os glitches ficam de fora e a energia é um limite inferior;
  * cache por etapa em `build/synth-cache`: rodar de novo só sintetiza o que mudou;
  * as netlists (o Verilog do simulador e as três mapeadas de cada configuração) vão para `build/axc-netlists.tar.gz`, para anexar a uma release; o `data/synth.json` guarda o SHA-256 de cada uma.
* **Espaço de projeto e referência externa**: na aba Biblioteca, todas as configurações de um grupo com o custo (área, atraso, energia com entradas uniformes ou com os operandos reais, fuga, LUTs) e o erro (inclusive sob os operandos reais) à escolha, a fronteira de Pareto com o intervalo de confiança e a exportação em CSV, JSON e SVG. Como referência, os multiplicadores e somadores sem sinal de 8 e 16 bits da **EvoApproxLib** (licença MIT; Mrázek e colegas, DATE 2017), sintetizados com exatamente o mesmo fluxo e com o erro calculado sobre os mesmos pares (`scripts/evoapprox.mjs`, resultado em `data/evoapprox.json`). As métricas calculadas aqui conferem com as publicadas pela biblioteca.
* **Comparação**: configurações guardadas, varredura do parâmetro principal, fronteira de Pareto com custo e métrica de erro à escolha, contagem de dominância, ponto de joelho, exportação em CSV e SVG.
* **Rede neural** (página `lenet.html`): LeNet-5 treinada no MNIST e quantizada em 8 bits, com os produtos das camadas escolhidas feitos pelo multiplicador escolhido (o da página de unidades, pelo botão Usar na LeNet-5, ou qualquer um da biblioteca) e as somas pelo somador escolhido; acurácia contra a rede exata, sensibilidade por camada, matriz de confusão e os dígitos que passaram a errar. A rede é treinada uma vez com `scripts/lenet5/train.py` (só NumPy): `python3 scripts/lenet5/train.py <pasta com os 4 .gz do MNIST> --epochs 8`. O subconjunto de teste incluído (1000 imagens, `data/mnist1000.bin`) é do MNIST, sob a licença CC BY-SA 3.0.
* **Aplicação**: kernels inteiros (filtros de imagem, FIR, produto escalar) com as unidades aproximadas, inclusive sobre uma imagem sua, ficam na página de síntese de alto nível (abaixo); a comparação mantém o MSE do filtro gaussiano 3 × 3 sobre a imagem de teste como métrica de aplicação.

## Síntese de alto nível (página hls.html)

Uma segunda página leva as unidades caracterizadas para o nível do algoritmo: um kernel num subconjunto de C (tipos de largura explícita, vetores, `for` com limites constantes) com as diretivas do Vitis HLS (`pipeline II=n`, `unroll factor=n`, `array_partition`, `allocation`) passa por:

* análise e elaboração: desenrolamento dos laços pedidos (e de todos os internos a um laço com pipeline), dobra de constantes, índices dos vetores como expressões afins (o que dá o banco de memória de cada acesso), eliminação de subexpressões comuns e análise de faixas de valores, que escolhe a unidade de 8, 16 ou 32 bits de cada operação;
* escalonamento com encadeamento: as operações cabem num ciclo enquanto os atrasos da síntese sky130 somados não passam do período menos o tempo do registrador; sem pipeline, por lista; com pipeline, modular, com o II e o motivo (portas dos bancos de memória, limite de unidades ou recorrência);
* ligação e custo: compartilhamento das unidades aproximadas (somadores exatos e multiplicações por constante, que viram somas de deslocamentos, ficam uma por operação, como no Vitis), propagação de constantes na netlist de cada instância, multiplexadores de entrada, registradores pela vida de cada valor, contadores dos laços, endereços e seleção de banco; área ASIC (µm²) e FPGA (LUTs, CARRY4, FF), energia por execução e latência. Um laço sem pipeline que só contém outro com pipeline é achatado, como no Vitis.

O relatório segue o do Vitis (latência, II por laço, recursos), com o diagrama de Gantt (as operações encadeadas aparecem dentro do ciclo), o DFG e a IR. A linha de comando roda o mesmo motor: `node bin/axc.mjs hls kernel.c --clock 5` (ou `--example gauss`). As peças além das unidades (multiplexador, lógica, comparador e o registrador dfxtp_1) foram medidas com o mesmo fluxo por `scripts/hls-cells.mjs` (`data/hls-cells.json`). As constantes do modelo (latência da memória, ciclos de controle, achatamento, resto da divisão) estão em `js/hls/sched.js` e foram calibradas contra o Vitis HLS e o Vivado (abaixo). Na aba Biblioteca ficam as unidades sintetizadas, o espaço de projeto e a exportação em Verilog; o editor e a IR têm destaque de sintaxe.

### Aproximação no kernel e erro

Na aba Aproximação, cada soma e multiplicação do DFG (depois do desenrolamento) pode usar qualquer unidade da biblioteca com a largura dela; a área, a energia e o atraso do relatório passam a usar as unidades escolhidas (exatas e aproximadas da mesma largura são recursos diferentes no escalonamento e na ligação). Subtrações e somas com sinal usam as mesmas unidades em complemento de 2 (a subtração como ~(~a + b), sem vem um), quando o resultado cabe na largura da unidade; os multiplicadores sem sinal recebem os módulos dos operandos.

* Perfil: uma execução exata do projeto elaborado com os dados de entrada (a imagem de teste ou valores uniformes na faixa do tipo) dá a média e o segundo momento de cada valor, amostras dos operandos de cada operação e execuções amostradas de cada trecho.
* Estimativa estática: o viés (média) e o segundo momento do erro de cada nó, propagados das unidades até as saídas. O erro próprio de cada operação é o da unidade sobre os operandos reais dela. Há dois modelos: o analítico (fórmulas por operação, com o arredondamento dos deslocamentos e a troca de decisão das comparações) e o por amostras (cada trecho refeito nas execuções amostradas, com o erro que chega de fora como ruído normal), que mantém as correlações dentro do trecho. Recorrências seguem e(t + 1) = g·e(t) + d; memórias guardam a média dos erros escritos. O orçamento mostra o erro que cada operação causaria sozinha na saída.
* Verificação bit a bit: o projeto elaborado (os mesmos laços, truncamentos e larguras de memória do hardware) executado com os modelos funcionais das unidades, comparado com o exato nas posições escritas: ME, MSE, PSNR, SSIM (o padrão, com janela gaussiana 11 × 11), MED, WCE, EP e MRED, com as imagens exata, aproximada e a diferença. O SSIM também é estimado pelo modelo estático, com o erro de cada faixa de valor da saída sobre as estatísticas locais da imagem exata.

Nos exemplos, o modelo por amostras fica a menos de 10% do MSE medido nos kernels com pipeline (gaussiano, Sobel, realce, FIR), com unidades de todas as técnicas. A limitação conhecida é o somador truncado ou segmentado dentro de um acumulador (o produto escalar, o gaussiano sem diretivas): o modelo supõe bits baixos quaisquer no acumulador e superestima o erro do truncado (até 13 vezes no produto escalar). A execução bit a bit é a referência para decidir.

```
node bin/axc.mjs hls --example gauss --ops                                          # operações aproximáveis
node bin/axc.mjs hls --example gauss --approx "mul8=MUL8 DRUM6;add16=ADD16 LOA4" --error
node bin/axc.mjs hls kernel.c --approx "16:mul8=MUL8 T4" --error --input uniform --model analytic --json
```

O alvo de `--approx` é um nó (`S1.3`), um grupo linha:operação (`16:mul8`), uma classe (`mul8`, `add16`, `add32`) ou `*`.

### Validação com o Vitis HLS e o Vivado

O modelo de custo é conferido contra o Vitis HLS e o Vivado 2022.2. Para cada caso, `scripts/vitis.mjs` gera o C++ (com `ap_int`; no projeto elaborado, cada valor com a largura da nossa análise de faixas e cada operação aproximada chamando a função C++ da sua unidade, escrita a partir da mesma netlist do Verilog exportado), um testbench que compara a saída com a execução bit a bit do simulador, o Tcl do Vitis (parte `xc7a100tcsg324-1`, multiplicadores em LUT, sem pipeline automático de laços) e as previsões do modelo. Tudo roda da pasta do repositório:

```
npm run vitis:export                    # gera build/vitis/<caso>/ (cerca de 2 min)
npm run vitis:check                     # opcional: compila e roda cada caso com g++ e o ap_int do Vitis
bash build/vitis/run_all.sh -j 4        # Vitis HLS: csim e csynth de todos os casos
bash build/vitis/run_all.sh -j 2 --impl # também o Vivado (export_design -flow impl), bem mais demorado
npm run vitis:collect                   # lê os relatórios e grava results/vitis/
npm run vitis:compare                   # refaz a comparação com o modelo atual (sem o Vitis)
```

Na primeira rodada (23 casos: os exemplos exatos, as variantes de diretivas e de período do gaussiano e oito projetos aproximados), a comparação levou a seis correções no modelo (achatamento de laços, multiplicação por constante como somas de deslocamentos, custo da partição com fator 3, endereços e contadores no pipeline, sem compartilhamento de somadores exatos, propagação de constantes nas unidades). A segunda rodada (mais 22 casos: os projetos aproximados com as unidades combinacionais e em linha, e dois pontos da exploração) veio com a caracterização de cada unidade no próprio Vivado:

```
npm run vivado:units                         # build/vivado-units/: cada unidade entre registradores
bash build/vivado-units/run_units.sh -j 4    # Vivado fora de contexto (--route para posicionar e rotear)
npm run vivado:units:collect                 # data/vivado-units.json: LUT, CARRY4 e atraso no alvo FPGA
```

A terceira rodada exporta as unidades como caixa preta de RTL do Vitis (`_rtl_ir`: o Verilog da netlist, em vez da netlist em C++): com ela, sete dos dez projetos aproximados ficam menores que o exato (até 29% no FIR), e a economia prevista erra em média 11,7 pontos percentuais, a menor entre as formas de exportação; é a forma de referência daqui em diante. Com esses dados (a página tem a escolha dos atrasos, sky130 ou Vivado), o erro médio do modelo nos 59 casos das quatro rodadas é de 0,3% na latência com pipeline, 8% sem pipeline, 15% nas LUTs, 21% nos FFs e 18% no período; a csim deu a mesma saída que o simulador em todos. O resultado principal é sobre o FPGA: o somador nativo usa a cadeia de carry e só 16 dos 95 somadores aproximados de 16 bits são menores que ele, e as multiplicações por constante já são baratas; por isso, a economia vem dos multiplicadores, e os maiores ganhos medidos são os do FIR (até 29% com a caixa preta) e os dos pontos da exploração do gaussiano (11% a 13%). Na quarta rodada, quatro pontos escolhidos pela exploração com o modelo atual (objetivo em LUTs, caixa preta de RTL) tiveram a economia prevista com erro médio de 3,6 pontos percentuais e o sentido certo nos quatro (de 9% a 69% de LUTs a menos que o exato), mas dois deles mediram um pouco mais que pontos escolhidos antes: o modelo acha a região certa da fronteira, não o melhor ponto dentro dela. No FPGA, o modelo serve para descartar aproximações que não economizam, e o ponto escolhido deve ser medido no Vivado.

Os detalhes, as tabelas e as causas de cada diferença estão em [`results/vitis/RESULTADOS.md`](results/vitis/RESULTADOS.md) e na seção 6 de [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md).

### Metodologia e estudos de caso

As hipóteses dos modelos de custo e de erro, as ameaças à validade e o passo a passo de reprodução estão em [`docs/METODOLOGIA.md`](docs/METODOLOGIA.md). Os estudos de caso (precisão do modelo de erro, comparação das heurísticas, fronteiras verificadas bit a bit, diretivas e período, sensibilidade aos dados, unroll e grupos, SSIM) rodam com `npm run experiments` e ficam em [`results/`](results/RESULTADOS.md), em CSV, Markdown e LaTeX.

### Exploração do espaço de projeto

A aba Exploração (e o comando `dse`) procura as unidades, e opcionalmente as diretivas e o período, que minimizam o objetivo com o erro dentro de um limite:

* **avaliação**: cada ponto é sintetizado de novo (o compartilhamento das unidades, os multiplexadores e o II entram no custo, por isso o custo de uma troca não é a soma dos custos das unidades) e o erro das saídas vem do modelo estático; a elaboração e o perfil exato são feitos uma vez por variante de diretivas;
* **objetivo**: área ASIC, LUT + CARRY4, energia por execução, latência, intervalo entre resultados, ou a soma ponderada de área, energia e latência divididas pelas do projeto exato; **restrição**: PSNR mínimo ou MSE máximo em todas as saídas, ou SSIM mínimo nas saídas de imagem (estimado na busca, medido na verificação);
* **grupos**: a unidade é escolhida por classe (todas as multiplicações de 8 bits juntas), por linha do código, por operação do código (as cópias criadas pela diretiva `unroll` recebem a mesma unidade) ou por operação; **candidatas**: em cada grupo, as unidades da fronteira de Pareto entre o custo da unidade e o erro próprio sobre os operandos reais do grupo;
* **heurísticas**: sequencial (os grupos na ordem do código, multiplicações antes das somas, em cada um a candidata de menor custo que mantém a restrição), eficiência (a partir do exato, a troca com a maior economia por aumento de erro, até nenhuma economizar; com grupos menores que a classe, também a troca da classe inteira), exaustiva com poda (em ordem de custo: o primeiro viável é o ótimo do modelo) e aleatória;
* **verificação**: o ponto viável mais barato de cada heurística é executado bit a bit; se o erro medido passar do limite, o próximo viável em ordem de custo é verificado.
* **passo a passo**: cada heurística registra as suas iterações (o que avaliou, o que escolheu e por quê, a poda, a ordem de custo da exaustiva, as verificações), e a página as anima sobre o gráfico de custo contra PSNR, com a explicação e a tabela do que foi avaliado em cada iteração.

No gaussiano com PSNR de pelo menos 40 dB e área como objetivo, por classe as quatro heurísticas chegam ao mesmo ponto (8 × ADD16 TRUNC7 e 5 × MUL8 T8 +C, 44,4% menos área, 41,0 dB medidos), e a exaustiva, que cabe sem poda, é o ótimo do modelo entre as candidatas. Por operação, a eficiência chega a 42,8%: menos que o ótimo por classe, que está contido no espaço por operação, porque a gulosa para em ótimos locais. A busca local, que parte da eficiência e do ótimo por classe e aceita trocas em pares (uma que viola compensada por outra que devolve erro), chega a 45,2%; a tabu, o GRASP e o genético (`--heuristic local|tabu|grasp|ga`) ficam no mesmo ponto ou perto dele. Esses são números de área ASIC; no FPGA, a validação com o Vivado mostra economias bem menores (seção 6 da metodologia).

```
node bin/axc.mjs dse --example gauss --psnr 40 --heuristic all --granularity op
node bin/axc.mjs dse kernel.c --objective weighted --weights 1,1,1 --directives --clocks 5,2.5 --json
node bin/axc.mjs dse --example fir --mse 100 --objective energy --csv > fronteira.csv
```

## Executar

```
npm start          # servidor local sem cache em http://localhost:8005
npm test           # testes (Node 20 ou mais novo; o teste do Verilog roda se houver iverilog)
npm run operands   # operandos reais da LeNet-5 e do filtro (data/operands.*)
npm run synth      # espaço de projeto: confere e sintetiza (iverilog, yosys e sta do OpenSTA); --jobs N
npm run evoapprox  # referência EvoApproxLib com o mesmo fluxo (depois do synth)
npm run experiments # estudos de caso da síntese de alto nível (results/)
```

O OpenSTA não tem pacote no Ubuntu; compila do código, com o CUDD (o `Dockerfile.ubuntu24.04` do repositório do OpenSTA mostra os passos), e o executável `sta` precisa estar no PATH.

### Linha de comando

Os mesmos modelos da página rodam sem o navegador, para experimentos em script (`node bin/axc.mjs`, ou `npm run axc -- <comando>`):

```
node bin/axc.mjs list --group mul8                        # configurações do espaço de projeto
node bin/axc.mjs metrics "MUL8 DRUM4" --dist lenet        # métricas de erro, com o intervalo de confiança
node bin/axc.mjs sweep --group add16 --dist image > a.csv # todas as configurações de um grupo, em CSV
node bin/axc.mjs synth "ADD16 LOA8"                       # números da síntese (três fluxos, energia)
node bin/axc.mjs verilog "MUL16 T8" --tb --out m.v        # Verilog e testbench
node bin/axc.mjs lenet "MUL8 MITCHELL" --add "ADD16 LOA8" # acurácia da LeNet-5 com as unidades
```

A unidade é o nome mostrado na página ou uma configuração em JSON (`{"kind":"mul","width":8,"method":"drum","k":4}`); todos os comandos aceitam `--json`.

### Como citar

O simulador está arquivado no Zenodo com o DOI [10.5281/zenodo.23427697](https://doi.org/10.5281/zenodo.23427697):

> T. Almeida. *axc-simulator: Simulador de Computação Aproximada*. Zenodo, 2026. DOI: [10.5281/zenodo.23427697](https://doi.org/10.5281/zenodo.23427697).

```bibtex
@software{almeida_axc_simulator,
  author    = {Almeida, Tiago},
  title     = {axc-simulator: Simulador de Computação Aproximada},
  publisher = {Zenodo},
  year      = {2026},
  doi       = {10.5281/zenodo.23427697},
  url       = {https://doi.org/10.5281/zenodo.23427697}
}
```

O arquivo `CITATION.cff` traz os mesmos metadados (o GitHub mostra "Cite this repository"). Cada release nova do repositório gera no Zenodo uma versão nova, com DOI próprio; anexe a ela o `build/axc-netlists.tar.gz` gerado pelo `npm run synth`.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `js/axc/netlist.js` | circuito no nível de portas, avaliação de 32 pares por vez (bit slicing), área e atraso |
| `js/axc/units.js` | geradores de multiplicadores e somadores exatos e aproximados |
| `js/axc/metrics.js` | entradas de teste, métricas de erro, histograma, mapa de erro, fronteira de Pareto |
| `js/axc/image.js`, `js/axc/ssim.js` | imagem de teste, leitura de PPM, PGM e PBM, filtros, PSNR; SSIM padrão e a sua estimativa a partir dos momentos do erro |
| `js/axc/vos.js` | escalonamento de tensão (atraso, tempo de chegada, captura) e memória aproximada |
| `js/axc/lenet.js`, `js/lenet-app.js` | inferência inteira da LeNet-5 com a tabela de produtos da unidade; a página `lenet.html` |
| `scripts/lenet5/train.py` | treino da LeNet-5 com NumPy e quantização em 8 bits (gera `data/lenet5.json` e `data/mnist1000.bin`) |
| `scripts/sky130/voltage.py` | atraso e energia das células sky130 por canto de tensão e ajuste da lei de potência alfa |
| `js/axc/stochastic.js` | computação estocástica: geradores (LFSR, Sobol), fluxos, operações, erro, custo, falhas e o filtro com MUX |
| `js/axc/verilog.js` | exportação em Verilog, testbench e vetores de teste |
| `js/axc/presets.js` | configurações pré-definidas (as de sempre, todas dentro do espaço de projeto) |
| `js/axc/designspace.js` | espaço de projeto sintetizado, estratificado por técnica |
| `scripts/synth.mjs` e `scripts/lib/asic.mjs` | verificação (Icarus Verilog), síntese para FPGA e ASIC sky130 (Yosys e ABC), atraso e energia (OpenSTA), cache |
| `scripts/evoapprox.mjs` | referência EvoApproxLib com o mesmo fluxo (`data/evoapprox.json`) |
| `scripts/operands.mjs` | operandos reais da LeNet-5 e do filtro gaussiano (`data/operands.json` e `data/operands.bin`) |
| `js/hls/lang.js`, `elab.js` | linguagem do kernel (análise) e elaboração: laços, diretivas, DFG por trecho, faixas, bancos de memória |
| `js/hls/lib.js`, `sched.js`, `cost.js`, `constprop.js` | biblioteca de custos (com a multiplicação por constante e os números do Vivado, quando houver), escalonamento com encadeamento e pipeline, ligação, propagação de constantes nas netlists, área, energia |
| `js/hls/approx.js` | operações aproximáveis, unidades candidatas e modelos funcionais das unidades |
| `js/hls/exec.js` | execução bit a bit do projeto elaborado, perfil dos sinais, comparação das saídas (PSNR, SSIM) |
| `js/hls/error.js` | modelo estático de erro (analítico e por amostras), recorrências, orçamento por operação |
| `js/hls/dse.js`, `dse-worker.js` | exploração: avaliação, candidatas, heurísticas, fronteira, verificação (o worker roda na página sem travar) |
| `js/hls/vitis.js`, `scripts/vitis.mjs` | exportação para o Vitis HLS (C++, testbench, Tcl), execução em lote, coleta dos relatórios e comparação com o modelo |
| `scripts/vivado-units.mjs`, `results/vitis/` | caracterização das unidades no Vivado; relatórios e comparação da validação |
| `scripts/experiments.mjs`, `docs/METODOLOGIA.md`, `results/` | estudos de caso reprodutíveis, metodologia e limitações, resultados (CSV, Markdown, LaTeX) |
| `js/hls/highlight.js`, `js/ui/library.js` | destaque de sintaxe do kernel e da IR; aba Biblioteca (unidades sintetizadas, espaço de projeto, Verilog) |
| `js/hls/index.js`, `kernels.js`, `ui.js`, `js/hls-app.js` | fluxo de síntese, exemplos, figuras (Gantt e DFG) e a página `hls.html` |
| `scripts/hls-cells.mjs` | multiplexador, lógica, comparador e registrador medidos no fluxo sky130 (`data/hls-cells.json`) |
| `bin/axc.mjs` | interface de linha de comando |
| `js/ui/plots.js` | figuras (diagramas, histograma, mapa de calor, Pareto) |
| `js/refs.js` | referências com DOI, usadas na ajuda, no Resumo e nesta lista |
| `js/i18n/` e `js/help/` | textos da interface e ajuda em português e inglês |

Os testes conferem as unidades exatas contra a aritmética (8 bits exaustivo), os aproximados contra a sua definição aritmética, a redução de Dadda (35 FA e 7 HA para 8 bits), a avaliação em paralelo contra a avaliação porta a porta, as métricas e os filtros.

## Próximas etapas possíveis

* Exploração: busca local depois da gulosa (trocas de duas unidades), diretivas com valores numéricos (II, fatores de unroll e de partição) e exploração em lote de vários kernels.
* Recorrências com somadores aproximados no modelo de erro (execuções consecutivas no perfil).
* Mais técnicas (codificador de Booth aproximado, outros somadores) e somas com sinal aproximadas.

## Referências

As técnicas e os modelos do simulador vêm destes trabalhos (a mesma lista está na ajuda, com as citações no texto). Os DOIs foram conferidos no Crossref ou no OpenAlex; o artigo de Dadda (1965), publicado na Alta Frequenza, não tem DOI. Os títulos estão como publicados.

### Circuitos aritméticos aproximados

* A. D. Booth. "A signed binary multiplication technique". *The Quarterly Journal of Mechanics and Applied Mathematics, vol. 4, n. 2*, 1951. DOI: [10.1093/qjmam/4.2.236](https://doi.org/10.1093/qjmam/4.2.236).
* O. L. MacSorley. "High-speed arithmetic in binary computers". *Proceedings of the IRE, vol. 49, n. 1*, 1961. DOI: [10.1109/JRPROC.1961.287779](https://doi.org/10.1109/JRPROC.1961.287779).
* J. N. Mitchell. "Computer multiplication and division using binary logarithms". *IRE Transactions on Electronic Computers, vol. EC-11, n. 4*, 1962. DOI: [10.1109/TEC.1962.5219391](https://doi.org/10.1109/TEC.1962.5219391).
* C. S. Wallace. "A suggestion for a fast multiplier". *IEEE Transactions on Electronic Computers, vol. EC-13, n. 1*, 1964. DOI: [10.1109/PGEC.1964.263830](https://doi.org/10.1109/PGEC.1964.263830).
* L. Dadda. "Some schemes for parallel multipliers". *Alta Frequenza, vol. 34*, 1965.
* M. J. Schulte e E. E. Swartzlander. "Truncated multiplication with correction constant". *Proceedings of the IEEE Workshop on VLSI Signal Processing VI*, 1993. DOI: [10.1109/VLSISP.1993.404467](https://doi.org/10.1109/VLSISP.1993.404467).
* H. R. Mahdiani, A. Ahmadi, S. M. Fakhraie e C. Lucas. "Bio-inspired imprecise computational blocks for efficient VLSI implementation of soft-computing applications". *IEEE Transactions on Circuits and Systems I: Regular Papers, vol. 57, n. 4*, 2010. DOI: [10.1109/TCSI.2009.2027626](https://doi.org/10.1109/TCSI.2009.2027626).
* P. Kulkarni, P. Gupta e M. Ercegovac. "Trading accuracy for power with an underdesigned multiplier architecture". *24th International Conference on VLSI Design*, 2011. DOI: [10.1109/VLSID.2011.51](https://doi.org/10.1109/VLSID.2011.51).
* A. B. Kahng e S. Kang. "Accuracy-configurable adder for approximate arithmetic designs". *Design Automation Conference (DAC)*, 2012. DOI: [10.1145/2228360.2228509](https://doi.org/10.1145/2228360.2228509).
* A. Momeni, J. Han, P. Montuschi e F. Lombardi. "Design and analysis of approximate compressors for multiplication". *IEEE Transactions on Computers, vol. 64, n. 4*, 2015. DOI: [10.1109/TC.2014.2308214](https://doi.org/10.1109/TC.2014.2308214).
* S. Hashemi, R. I. Bahar e S. Reda. "DRUM: a dynamic range unbiased multiplier for approximate applications". *IEEE/ACM International Conference on Computer-Aided Design (ICCAD)*, 2015. DOI: [10.1109/ICCAD.2015.7372600](https://doi.org/10.1109/ICCAD.2015.7372600).
* M. Shafique, W. Ahmad, R. Hafiz e J. Henkel. "A low latency generic accuracy configurable adder". *Design Automation Conference (DAC)*, 2015. DOI: [10.1145/2744769.2744778](https://doi.org/10.1145/2744769.2744778).
* S. Venkatachalam e S.-B. Ko. "Design of power and area efficient approximate multipliers". *IEEE Transactions on Very Large Scale Integration (VLSI) Systems, vol. 25, n. 5*, 2017. DOI: [10.1109/TVLSI.2016.2643639](https://doi.org/10.1109/TVLSI.2016.2643639).
* H. Jiang, F. J. H. Santiago, H. Mo, L. Liu e J. Han. "Approximate arithmetic circuits: a survey, characterization, and recent applications". *Proceedings of the IEEE, vol. 108, n. 12*, 2020. DOI: [10.1109/JPROC.2020.3006451](https://doi.org/10.1109/JPROC.2020.3006451).

### Avaliação: métricas, qualidade de imagem, escolha e energia

* J. Liang, J. Han e F. Lombardi. "New metrics for the reliability of approximate and probabilistic adders". *IEEE Transactions on Computers, vol. 62, n. 9*, 2013. DOI: [10.1109/TC.2012.146](https://doi.org/10.1109/TC.2012.146).
* Z. Wang, A. C. Bovik, H. R. Sheikh e E. P. Simoncelli. "Image quality assessment: from error visibility to structural similarity". *IEEE Transactions on Image Processing, vol. 13, n. 4*, 2004. DOI: [10.1109/TIP.2003.819861](https://doi.org/10.1109/TIP.2003.819861).
* V. Satopää, J. Albrecht, D. Irwin e B. Raghavan. "Finding a "Kneedle" in a haystack: detecting knee points in system behavior". *ICDCS Workshops*, 2011. DOI: [10.1109/ICDCSW.2011.20](https://doi.org/10.1109/ICDCSW.2011.20).
* A. P. Chandrakasan, S. Sheng e R. W. Brodersen. "Low-power CMOS digital design". *IEEE Journal of Solid-State Circuits, vol. 27, n. 4*, 1992. DOI: [10.1109/4.126534](https://doi.org/10.1109/4.126534).
* V. Mrázek, R. Hrbáček, Z. Vašíček e L. Sekanina. "EvoApprox8b: library of approximate adders and multipliers for circuit design and benchmarking of approximation methods". *Design, Automation and Test in Europe (DATE)*, 2017. DOI: [10.23919/DATE.2017.7926993](https://doi.org/10.23919/DATE.2017.7926993).

### Tensão e memória

* T. Sakurai e A. R. Newton. "Alpha-power law MOSFET model and its applications to CMOS inverter delay and other formulas". *IEEE Journal of Solid-State Circuits, vol. 25, n. 2*, 1990. DOI: [10.1109/4.52187](https://doi.org/10.1109/4.52187).
* S. Liu, K. Pattabiraman, T. Moscibroda e B. G. Zorn. "Flikker: saving DRAM refresh-power through critical data partitioning". *ASPLOS*, 2011. DOI: [10.1145/1950365.1950391](https://doi.org/10.1145/1950365.1950391).

### Rede neural

* Y. LeCun, L. Bottou, Y. Bengio e P. Haffner. "Gradient-based learning applied to document recognition". *Proceedings of the IEEE, vol. 86, n. 11*, 1998. DOI: [10.1109/5.726791](https://doi.org/10.1109/5.726791).
* Y. LeCun, C. Cortes e C. J. C. Burges. "The MNIST database of handwritten digits (licença CC BY-SA 3.0)". <http://yann.lecun.com/exdb/mnist/>.
* B. Jacob, S. Kligys, B. Chen, M. Zhu, M. Tang, A. Howard, H. Adam e D. Kalenichenko. "Quantization and training of neural networks for efficient integer-arithmetic-only inference". *IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)*, 2018. DOI: [10.1109/CVPR.2018.00286](https://doi.org/10.1109/CVPR.2018.00286).
* S. Venkataramani, A. Ranjan, K. Roy e A. Raghunathan. "AxNN: energy-efficient neuromorphic systems using approximate computing". *International Symposium on Low Power Electronics and Design (ISLPED)*, 2014. DOI: [10.1145/2627369.2627613](https://doi.org/10.1145/2627369.2627613).
* V. Mrázek, S. S. Sarwar, L. Sekanina, Z. Vašíček e K. Roy. "Design of power-efficient approximate multipliers for approximate artificial neural networks". *IEEE/ACM International Conference on Computer-Aided Design (ICCAD)*, 2016. DOI: [10.1145/2966986.2967021](https://doi.org/10.1145/2966986.2967021).

### Computação estocástica

* B. R. Gaines. "Stochastic computing systems". *Advances in Information Systems Science, vol. 2, Springer*, 1969. DOI: [10.1007/978-1-4899-5841-9_2](https://doi.org/10.1007/978-1-4899-5841-9_2).
* A. Alaghi e J. P. Hayes. "Survey of stochastic computing". *ACM Transactions on Embedded Computing Systems, vol. 12, n. 2s*, 2013. DOI: [10.1145/2465787.2465794](https://doi.org/10.1145/2465787.2465794).
* A. Alaghi e J. P. Hayes. "Exploiting correlation in stochastic circuit design". *IEEE International Conference on Computer Design (ICCD)*, 2013. DOI: [10.1109/ICCD.2013.6657023](https://doi.org/10.1109/ICCD.2013.6657023).
* A. Alaghi e J. P. Hayes. "Fast and accurate computation using stochastic circuits". *Design, Automation and Test in Europe (DATE)*, 2014. DOI: [10.7873/DATE.2014.089](https://doi.org/10.7873/DATE.2014.089).
* I. M. Sobol'. "On the distribution of points in a cube and the approximate evaluation of integrals". *USSR Computational Mathematics and Mathematical Physics, vol. 7, n. 4*, 1967. DOI: [10.1016/0041-5553(67)90144-9](https://doi.org/10.1016/0041-5553(67)90144-9).
* S. Joe e F. Y. Kuo. "Constructing Sobol sequences with better two-dimensional projections". *SIAM Journal on Scientific Computing, vol. 30, n. 5*, 2008. DOI: [10.1137/070709359](https://doi.org/10.1137/070709359).

### Ferramentas e PDK

* S. Williams. "Icarus Verilog". <https://steveicarus.github.io/iverilog/>.
* C. Wolf. "Yosys Open SYnthesis Suite". <https://yosyshq.net/yosys/>.
* R. Brayton e A. Mishchenko. "ABC: an academic industrial-strength verification tool". *Computer Aided Verification (CAV), Springer*, 2010. DOI: [10.1007/978-3-642-14295-6_5](https://doi.org/10.1007/978-3-642-14295-6_5).
* SkyWater Technology e Google. "SkyWater SKY130 open source PDK". <https://github.com/google/skywater-pdk>.
* Parallax Software e The OpenROAD Project. "OpenSTA: static timing analyzer". <https://github.com/The-OpenROAD-Project/OpenSTA>.

## Licença

GPL 3.0 (veja o arquivo LICENSE).
