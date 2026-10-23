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
  borda passaram a ter `dependence variable=y type=inter false`.
* A diferença de 4 ciclos por saída nas densas (305 contra 301 por iteração do laço de fora) vem da chamada da função
  em que o Vitis põe o laço com pipeline que não é achatado; fica para calibrar com mais casos.
