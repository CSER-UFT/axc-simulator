# Simulador de Computação Aproximada

Simulador didático de **computação aproximada** (AxC), desenvolvido para o curso de **Ciência da Computação** da **Universidade Federal do Tocantins**, na família de simuladores do grupo CSER ([riscv-cpu-simulator](https://github.com/CSER-UFT/riscv-cpu-simulator), [riscv-dlp-simulator](https://github.com/CSER-UFT/riscv-dlp-simulator), [riscv-mp-simulator](https://github.com/CSER-UFT/riscv-mp-simulator), [riscv-fp-simulator](https://github.com/CSER-UFT/riscv-fp-simulator) e [riscv-cc-simulator](https://github.com/CSER-UFT/riscv-cc-simulator)).

Somadores e multiplicadores aproximados são construídos porta a porta, avaliados contra a versão exata com as métricas de erro da literatura, comparados pelo custo na fronteira de Pareto e aplicados a um filtro de imagem. Roda inteiramente no navegador (HTML e JavaScript, sem dependências) e é publicado no GitHub Pages (em Settings > Pages, fonte "GitHub Actions").

**Estado: protótipo (etapa 1)**, só em português.

## O que faz

* **Multiplicador** N × N (8 ou 16 bits): por colunas, com redução de Dadda e três zonas (truncadas, aproximadas com compressor 4:2 aproximado e OR, e exatas); Booth radix 4 com sinal, truncado; blocos 2 × 2 de Kulkarni; DRUM; logarítmico de Mitchell; e compensação do viés por uma constante, para qualquer técnica.
* **Somador** exato (ripple carry), truncado, LOA e segmentado com previsão de vem um (no estilo GeAr e ACA).
* **Estrutura**: diagrama de pontos dos produtos parciais com as zonas, altura das colunas a cada estágio de redução e tabela verdade do compressor aproximado.
* **Erro**: ME, MED, WCE (com o par que o produz), MSE, NMED, MRED e EP; avaliação exaustiva para 8 bits com entradas uniformes e por amostragem nos outros casos (entradas uniformes, normais ou exponenciais); mapa do erro sobre o plano (a, b) e histograma do erro com sinal.
* **Custo**: área em portas de duas entradas, atraso em níveis de porta e atividade de chaveamento (indicador de energia dinâmica), todos do modelo didático, e, para as configurações pré-definidas, LUTs, CARRY4 e profundidade de uma síntese real com o Yosys para FPGA Xilinx 7 series.
* **Tensão e memória**: escalonamento de tensão além da margem, com atraso pela lei de potência alfa, tempo de chegada de cada bit dependente dos dados e captura do valor antigo quando o bit atrasa; curva de erro contra tensão da unidade e da exata, energia relativa e a imagem degradando; memória aproximada com inversão de bits e proteção dos bits mais significativos, com o MSE medido e o esperado.
* **Estocástica**: valores como fluxos de bits, multiplicação por AND ou XNOR e soma escalada por MUX; quatro geradores (aleatório ideal, LFSRs diferentes, um LFSR só, sequência de Sobol) com o erro contra o comprimento do fluxo, o efeito da correlação, o custo dos geradores e do contador contra o binário, a tolerância a bits errados e um filtro gaussiano feito só com um MUX.
* **Síntese**: exportação de qualquer configuração em Verilog com testbench autoverificável; a cada publicação, uma action exporta as configurações pré-definidas, confere o Verilog no Icarus Verilog contra o simulador e sintetiza com o Yosys (`scripts/synth.mjs`, resultado em `data/synth.json`).
* **Comparação**: configurações guardadas, varredura do parâmetro principal, fronteira de Pareto com custo e métrica de erro à escolha, contagem de dominância, ponto de joelho, exportação em CSV e SVG.
* **Aplicação**: filtro gaussiano 3 × 3, ganho de brilho ou média de pares sobre uma imagem de teste sintética ou do usuário (formatos do navegador e também PPM, PGM e PBM), com a imagem exata, a aproximada, a diferença, PSNR e SSIM.

## Executar

```
npm start      # servidor local sem cache em http://localhost:8005
npm test       # testes (Node 20 ou mais novo; o teste do Verilog roda se houver iverilog)
npm run synth  # exporta, confere e sintetiza as configurações pré-definidas (precisa de iverilog e yosys)
```

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `js/axc/netlist.js` | circuito no nível de portas, avaliação de 32 pares por vez (bit slicing), área e atraso |
| `js/axc/units.js` | geradores de multiplicadores e somadores exatos e aproximados |
| `js/axc/metrics.js` | entradas de teste, métricas de erro, histograma, mapa de erro, fronteira de Pareto |
| `js/axc/image.js` | imagem de teste, leitura de PPM, PGM e PBM, filtros, PSNR e SSIM |
| `js/axc/vos.js` | escalonamento de tensão (atraso, tempo de chegada, captura) e memória aproximada |
| `js/axc/stochastic.js` | computação estocástica: geradores (LFSR, Sobol), fluxos, operações, erro, custo, falhas e o filtro com MUX |
| `js/axc/verilog.js` | exportação em Verilog, testbench e vetores de teste |
| `js/axc/presets.js` | configurações pré-definidas, sintetizadas na publicação |
| `scripts/synth.mjs` | fluxo de verificação (Icarus Verilog) e síntese (Yosys) |
| `js/ui/plots.js` | figuras (diagramas, histograma, mapa de calor, Pareto) |

Os testes conferem as unidades exatas contra a aritmética (8 bits exaustivo), os aproximados contra a sua definição aritmética, a redução de Dadda (35 FA e 7 HA para 8 bits), a avaliação em paralelo contra a avaliação porta a porta, as métricas e os filtros.

## Próximas etapas possíveis

* Mais técnicas (codificador de Booth aproximado, outros somadores).
* Inglês e ajuda completa; integração com o riscv-cc-simulator.

## Licença

GPL 3.0 (veja o arquivo LICENSE).
