# Simulador de Computação Aproximada

Simulador didático de **computação aproximada** (AxC), desenvolvido para o curso de **Ciência da Computação** da **Universidade Federal do Tocantins**, na família de simuladores do grupo CSER ([riscv-cpu-simulator](https://github.com/CSER-UFT/riscv-cpu-simulator), [riscv-dlp-simulator](https://github.com/CSER-UFT/riscv-dlp-simulator), [riscv-mp-simulator](https://github.com/CSER-UFT/riscv-mp-simulator), [riscv-fp-simulator](https://github.com/CSER-UFT/riscv-fp-simulator) e [riscv-cc-simulator](https://github.com/CSER-UFT/riscv-cc-simulator)).

Somadores e multiplicadores aproximados são construídos porta a porta, avaliados contra a versão exata com as métricas de erro da literatura, comparados pelo custo na fronteira de Pareto e aplicados a um filtro de imagem. Roda inteiramente no navegador (HTML e JavaScript, sem dependências) e é publicado no GitHub Pages (em Settings > Pages, fonte "GitHub Actions").

Interface e ajuda em **português e inglês** (seletor no cabeçalho). O botão **Copiar link** gera um endereço com a configuração da unidade, a aba e os controles das abas, para compartilhar uma tela pronta (por exemplo, numa aula ou numa lista de exercícios).

*English: an educational simulator of approximate arithmetic circuits (gate level adders and multipliers, error metrics, Pareto front, voltage overscaling, approximate memory, stochastic computing, FPGA and ASIC synthesis). The interface and the help are available in English through the language selector in the header.*

## O que faz

* **Multiplicador** N × N (8 ou 16 bits): por colunas, com redução de Dadda e três zonas (truncadas, como em Schulte e Swartzlander, 1993; aproximadas com compressor 4:2 aproximado, uma simplificação do de Venkatachalam e Ko, 2017, e OR como no LOA; e exatas); Booth radix 4 com sinal, truncado (Booth, 1951; MacSorley, 1961); blocos 2 × 2 de Kulkarni (Kulkarni, Gupta e Ercegovac, 2011); DRUM (Hashemi, Bahar e Reda, 2015); logarítmico de Mitchell (1962); e compensação do viés por uma constante, para qualquer técnica.
* **Somador** exato (ripple carry), truncado, LOA (Mahdiani e colegas, 2010) e segmentado com previsão de vem um (no estilo do ACA, Kahng e Kang, 2012, e do GeAr, Shafique e colegas, 2015).
* **Estrutura**: diagrama de pontos dos produtos parciais com as zonas, altura das colunas a cada estágio de redução e tabela verdade do compressor aproximado.
* **Erro**: ME, MED, WCE (com o par que o produz), MSE, NMED, MRED e EP; avaliação exaustiva para 8 bits com entradas uniformes e por amostragem nos outros casos (entradas uniformes, normais ou exponenciais); mapa do erro sobre o plano (a, b) e histograma do erro com sinal.
* **Custo**: área em portas de duas entradas, atraso em níveis de porta e atividade de chaveamento (indicador de energia dinâmica), todos do modelo didático, e, para as configurações pré-definidas, LUTs, CARRY4 e profundidade de uma síntese real com o Yosys para FPGA Xilinx 7 series, e área (µm²) e atraso (ps) de uma síntese para ASIC com a biblioteca de células do PDK aberto SkyWater 130 nm.
* **Tensão e memória**: escalonamento de tensão além da margem, com atraso pela lei de potência alfa, tempo de chegada de cada bit dependente dos dados e captura do valor antigo quando o bit atrasa; curva de erro contra tensão da unidade e da exata, energia relativa e a imagem degradando; memória aproximada com inversão de bits e proteção dos bits mais significativos, com o MSE medido e o esperado.
* **Estocástica**: valores como fluxos de bits, multiplicação por AND ou XNOR e soma escalada por MUX; quatro geradores (aleatório ideal, LFSRs diferentes, um LFSR só, sequência de Sobol) com o erro contra o comprimento do fluxo, o efeito da correlação, o custo dos geradores e do contador contra o binário, a tolerância a bits errados e um filtro gaussiano feito só com um MUX.
* **Síntese**: exportação de qualquer configuração em Verilog com testbench autoverificável; a cada publicação, uma action exporta as configurações pré-definidas, confere o Verilog no Icarus Verilog contra o simulador e sintetiza com o Yosys para FPGA (Xilinx 7 series) e para ASIC (sky130_fd_sc_hd, canto típico; a biblioteca é baixada de uma versão fixa do OpenROAD-flow-scripts e conferida pelo SHA-256), com o script `scripts/synth.mjs` e o resultado em `data/synth.json`.
* **Comparação**: configurações guardadas, varredura do parâmetro principal, fronteira de Pareto com custo e métrica de erro à escolha, contagem de dominância, ponto de joelho, exportação em CSV e SVG.
* **Rede neural**: LeNet-5 treinada no MNIST e quantizada em 8 bits, com os produtos das camadas escolhidas feitos pela unidade aproximada; acurácia contra a rede exata, sensibilidade por camada, matriz de confusão e os dígitos que passaram a errar. A rede é treinada uma vez com `scripts/lenet5/train.py` (só NumPy): `python3 scripts/lenet5/train.py <pasta com os 4 .gz do MNIST> --epochs 8`. O subconjunto de teste incluído (1000 imagens, `data/mnist1000.bin`) é do MNIST, sob a licença CC BY-SA 3.0.
* **Aplicação**: filtro gaussiano 3 × 3, bordas de Sobel, realce de bordas, ganho de brilho ou média de pares sobre uma imagem de teste sintética ou do usuário (formatos do navegador e também PPM, PGM e PBM), com a imagem exata, a aproximada, a diferença, PSNR e SSIM.

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
| `js/axc/lenet.js` | inferência inteira da LeNet-5 com a tabela de produtos da unidade |
| `scripts/lenet5/train.py` | treino da LeNet-5 com NumPy e quantização em 8 bits (gera `data/lenet5.json` e `data/mnist1000.bin`) |
| `js/axc/stochastic.js` | computação estocástica: geradores (LFSR, Sobol), fluxos, operações, erro, custo, falhas e o filtro com MUX |
| `js/axc/verilog.js` | exportação em Verilog, testbench e vetores de teste |
| `js/axc/presets.js` | configurações pré-definidas, sintetizadas na publicação |
| `scripts/synth.mjs` | fluxo de verificação (Icarus Verilog) e síntese para FPGA e ASIC sky130 (Yosys e ABC) |
| `js/ui/plots.js` | figuras (diagramas, histograma, mapa de calor, Pareto) |
| `js/refs.js` | referências com DOI, usadas na ajuda, no Resumo e nesta lista |
| `js/i18n/` e `js/help/` | textos da interface e ajuda em português e inglês |

Os testes conferem as unidades exatas contra a aritmética (8 bits exaustivo), os aproximados contra a sua definição aritmética, a redução de Dadda (35 FA e 7 HA para 8 bits), a avaliação em paralelo contra a avaliação porta a porta, as métricas e os filtros.

## Próximas etapas possíveis

* Calibrar o modelo de tensão com os cantos de tensão da biblioteca sky130.
* Mais técnicas (codificador de Booth aproximado, outros somadores).
* Integração com o riscv-cc-simulator (a unidade aproximada como operação no DFG e no escalonamento).

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

## Licença

GPL 3.0 (veja o arquivo LICENSE).
