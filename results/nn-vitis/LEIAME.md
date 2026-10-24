# Validação das redes contra o Vitis HLS e o Vivado

Projetos gerados por `node bin/axc.mjs nnexport` e rodados no Vitis HLS 2022.2 e no Vivado 2022.2 (xc7a100tcsg324-1,
10 ns); comparação por `node bin/axc.mjs nnvitis <pasta>` (RESULTADOS.md e resultados.json de cada pasta). Só os
relatórios ficam guardados (csynth.xml, export_impl.xml, utilização hierárquica, log da csim e model.json).

## Rodada 1: MiniLenet exata, diretivas padrão (minilenet_exata_r1)

* Execução: as 10 csims sem nenhuma diferença (a rede: 1000 saídas de 100 imagens, 99 acertos; cada camada sozinha).
* Camadas sozinhas (o que o modelo supõe): latência 124849 ciclos no modelo e 125617 no Vitis (0,6%); II 13 e 38 nas
  convoluções, como previsto (memória); LUT 7441 e 6604 (13%), FF 3897 e 4264 (9%).
* Rede inteira: o Vitis 2022.2 particionou sozinho os vetores locais entre as camadas (HLS 214-270, "Inferring pragma
  array_partition ... due to pipeline pragma"; cyclic 5 nas duas dimensões da entrada da conv1, cyclic 23 e 5 na da
  conv2), e as convoluções chegaram a II 1: 53025 ciclos, contra 53114 do modelo com a diretiva de partição nas duas
  convoluções. A partir da rodada 2, os projetos exportados desligam essa partição automática
  (config_array_partition -throughput_driven off; AXC_AUTOPART=1 a mantém), para a rede ser a soma das camadas.
* Reescala: o Vitis estreita os operandos pela faixa (25 × 24 bits) e usa 2 DSP48, não 4; o modelo passou a contar os
  DSP pela largura dos operandos. Nas densas, o BIND_OP se perdeu quando o Vitis levou a multiplicação para a função
  do laço com pipeline (SYN 201-303) e a multiplicação foi para LUTs (664 LUTs na fc1); a reescala passou a ser um
  módulo próprio (INLINE off).
* pad2: o Vitis viu uma dependência falsa entre as duas escritas do laço das colunas da borda (II 2); os laços da
  borda passaram a ter `dependence variable=y type=inter false` (na rodada 2, trocada por laços separados).
* A diferença de 4 ciclos por saída nas densas (305 contra 301 por iteração do laço de fora) vem da chamada da função
  em que o Vitis põe o laço com pipeline que não é achatado; fica para calibrar com mais casos.

## Rodada 2: MiniLenet exata, com partição e aproximada (minilenet_*_r2)

* Execução: as 30 csims sem nenhuma diferença (a rede: 99 acertos em 100 imagens nas três).
* Exata (tudo sintetizado, menos a pad2 sozinha): a rede, agora sem a partição automática do Vitis, leva 124671
  ciclos, contra 124849 do modelo (0,1%); LUT 5397 contra 7441 (o modelo superestima, principalmente a lógica de
  endereço da conv2), FF 4121 contra 3897. As densas usam 2 DSP48 cada sozinhas, e a rede inteira 2: o Vitis
  instancia um módulo de reescala só, no topo, compartilhado pelas camadas (o modelo da rede passou a contar assim).
* Falhas, todas da exportação, corrigidas e com teste:
  * pad2 sozinha: a diretiva dependence numa porta do kernel não passa na verificação de síntese (SYNCHK 200-43); as
    colunas da esquerda e da direita da borda passaram a ser laços separados, sem a diretiva;
  * partição (conv1, conv2 e a rede): a diretiva de partição dos pesos saía antes da declaração da tabela (HLS
    207-3776); as tabelas passaram a ser declaradas antes, e uma tabela que some (pesos constantes) não recebe
    diretiva;
  * aproximada (fc1, fc2 e a rede): a caixa preta de RTL (ap_ctrl_none) não pode ficar fora de um laço com pipeline
    (HLS 200-1918), e a soma do viés das densas fica; fora dos laços com pipeline, a unidade vai como a netlist em C++
    (uc_*).

## Rodada 3: MiniLenet com partição nas duas convoluções (minilenet_part_r3)

* Tudo sintetizado; a conv2 sozinha não chegou ao Vivado (interrompida). As csims sem nenhuma diferença.
* A rede: 53008 ciclos, contra 53267 do modelo (0,5%); LUT 31911, contra 35483 (11%); 2 DSP48; período de 8,47 ns.
  O custo dos multiplexadores dos bancos que mudam a cada pixel ficou certo; os FF, abaixo (2800 contra 5434).
* Tempo da ferramenta: o escalonamento da conv2 levou 16734 s (4,6 h) e o da conv1, 496 s, com os fatores potência de
  2 que o gerador escolhia (16 x 8 e 8 x 8 bancos). Na rodada 1, com os fatores que o Vitis escolheu sozinho (23 x 5 e
  5 x 5), 3706 s e 27 s. O gerador passou a usar os fatores mínimos (um banco por posição da janela: 15 x 5 e 5 x 5),
  o run_all.sh ganhou um limite de tempo por projeto (--timeout, 3 h por padrão) e a página avisa quando a partição
  tende a ser pesada para o Vitis. A saída de verdade para as convoluções grandes é a janela deslizante com buffer de
  linhas (sem bancos que mudam a cada pixel).
