/**
 * Ajuda do simulador, em português. O texto evita hífens e travessões por padrão de estilo do projeto.
 * As citações apontam para a seção Referências, montada a partir de js/refs.js (com os DOIs).
 */
import { cite, refHtml, REF_GROUPS } from '../refs.js';
import { heads, sections as pageSections, common } from './pages-pt.js';

const c = (...keys) => keys.map((k) => `<a class="cite" href="#h-refs">${cite(k, 'pt')}</a>`).join('; ');
const GROUP_TITLES = { nn: 'Rede neural', arith: 'Circuitos aritméticos aproximados', eval: 'Avaliação: métricas, qualidade de imagem, escolha e energia', vos: 'Tensão e memória', sc: 'Computação estocástica', tools: 'Ferramentas e PDK' };

const base = {
    title: 'Simulador de Computação Aproximada',
    lead: 'Simulador didático de computação aproximada: somadores e multiplicadores aproximados construídos porta a porta, avaliados contra a versão exata com as métricas de erro da literatura, comparados pelo custo na fronteira de Pareto e aplicados a um filtro de imagem. Tudo roda no navegador.',
    searchPlaceholder: 'Buscar na ajuda',
    noResults: 'Nenhuma seção contém esse termo.',
    tocTitle: 'Conteúdo',
    close: 'Fechar ajuda',
    sections: [
        {
            id: 'start',
            title: 'Primeiros passos',
            html: `
<ol>
    <li>Escolha o tipo de unidade (multiplicador ou somador), a largura e a técnica de aproximação no painel da esquerda. Tudo é recalculado a cada mudança.</li>
    <li>O <strong>Resumo</strong> traz a área e o atraso estimados, comparados com a unidade exata, e as métricas de erro.</li>
    <li><strong>Estrutura</strong> mostra onde a aproximação acontece; <strong>Erro</strong> mostra para quais operandos ela erra e quanto; <strong>Comparação</strong> junta várias configurações num gráfico de custo contra erro; <strong>Tensão e memória</strong> e <strong>Estocástica</strong> tratam de outras fontes de aproximação. O botão <strong>Usar na LeNet-5</strong> leva a unidade para a página da rede neural. Os números de FPGA e de ASIC das unidades sintetizadas ficam na aba <strong>Biblioteca</strong> da página de síntese de alto nível.</li>
    <li><strong>Copiar link</strong> guarda a configuração da unidade, a aba e os controles das abas no endereço da página: quem abrir o link vê a mesma tela. O idioma fica no seletor do cabeçalho.</li>
</ol>
<p class="tip">Para começar: multiplicador de 8 bits, 4 colunas truncadas e nenhuma aproximada. O MED dá 12,25 e o WCE dá 49. Depois troque por 6 colunas aproximadas e compare os dois mapas de erro.</p>`,
        },
        {
            id: 'mul',
            title: 'Multiplicador por colunas',
            html: `
<p>A técnica <strong>por colunas</strong> é o ponto de partida: o multiplicador N × N sem sinal gera os produtos parciais a<sub>i</sub>·b<sub>j</sub> (uma porta AND cada), que caem na coluna i + j. As colunas são reduzidas por estágios no estilo de Dadda (${c('dadda1965')}), um refinamento do esquema de Wallace (${c('wallace1964')}): as alturas alvo são 2, 3, 4, 6, 9, 13..., e a cada estágio cada coluna recebe só os somadores completos e meios somadores necessários para não passar do alvo. Sobram no máximo dois bits por coluna, e uma soma com propagação de vai um dá o produto. Para 8 bits, a redução usa 35 somadores completos e 7 meios somadores, como no livro. As colunas menos significativas podem ficar em três zonas:</p>
<dl>
    <dt>truncadas</dt><dd>os produtos parciais nem são gerados: economiza as portas AND e os somadores daquelas colunas. O erro é sempre para baixo (o resultado nunca passa do exato). É o multiplicador truncado clássico (${c('schulte1993')}).</dd>
    <dt>aproximadas</dt><dd>a redução usa o compressor 4:2 aproximado (quatro bits viram soma e vai um, sem a ligação de vai um entre compressores vizinhos) e a soma final é um OR, sem vai um, como no LOA (${c('mahdiani2010')}). Opcionalmente, o vem um da primeira coluna exata é o AND dos dois bits da última coluna aproximada.</dd>
    <dt>exatas</dt><dd>somadores completos e propagação de vai um.</dd>
</dl>
<p>O compressor aproximado calcula soma = (x1 ⊕ x2) + (x3 ⊕ x4) e vai um = x1·x2 + x3·x4. A aba Estrutura mostra a sua tabela verdade: ele erra em 5 das 16 combinações, por exemplo quando os quatro bits são 1 (dá 2 em vez de 4). O vai um é o mesmo do compressor de Venkatachalam e Ko (${c('venkatachalam2017')}), e a soma é a deles sem o termo x1·x2·x3·x4, que acerta parcialmente o caso dos quatro bits em 1 (dá 3): é uma versão simplificada, com um erro a mais. A família de compressores aproximados é analisada por Momeni e colegas (${c('momeni2015')}).</p>
<p>A tabela de alturas mostra quantos bits cada coluna tem a cada estágio (8, 6, 4, 3, 2 para 8 bits): a redução termina quando nenhuma coluna passa de dois. Nas colunas aproximadas, o compressor 4:2 aproximado substitui os somadores completos sempre que dá para tirar três bits de uma vez.</p>`,
        },
        {
            id: 'mul2',
            title: 'Outras técnicas de multiplicação',
            html: `
<dl>
    <dt>Booth radix 4 (com sinal)</dt><dd>A codificação de Booth (${c('booth1951')}) na versão radix 4 (${c('macsorley1961')}). Cada par de bits de b, com o bit anterior, escolhe 0, ±a ou ±2a: são N/2 produtos parciais em vez de N. Os operandos e o produto são em complemento de 2, e o mapa de erro vai de −2<sup>N−1</sup> a 2<sup>N−1</sup> − 1 nos dois eixos. Os produtos negativos são o complemento de cada bit mais 1 na coluna mais baixa da linha (a linha "neg" do diagrama), e o sinal de cada linha é estendido até a coluna 2N − 1 (os pontos claros). A aproximação é truncar as colunas baixas, como no multiplicador por colunas. O custo do Resumo é comparado com o Booth exato.</dd>
    <dt>Blocos 2 × 2 de Kulkarni</dt><dd>O multiplicador é montado com blocos que multiplicam 2 bits por 2 bits (${c('kulkarni2011')}). O bloco aproximado tem três saídas em vez de quatro e só erra em 3 × 3, que dá 7 em vez de 9. Os blocos de peso menor que o escolhido são aproximados, e os produtos dos blocos são somados de forma exata. Com todos os blocos aproximados, o MRED fica perto de 3,3% e o erro é sempre para baixo.</dd>
    <dt>DRUM</dt><dd>Dynamic Range Unbiased Multiplier (${c('hashemi2015')}): de cada operando, só os k bits a partir do 1 mais significativo entram num multiplicador exato k × k, e o produto é deslocado de volta. O bit mais baixo do trecho vira 1, o que centra o erro do truncamento: o viés fica perto de zero e o erro relativo quase não depende da magnitude dos operandos. O custo extra é o detector do 1 mais alto e os deslocadores.</dd>
    <dt>Mitchell</dt><dd>Multiplicador logarítmico (${c('mitchell1962')}): log₂(x) ≈ p + f, com p a posição do 1 mais alto e f os bits abaixo dele lidos como fração. O produto vira a soma dos logaritmos, e o antilogaritmo é aproximado do mesmo jeito, com um deslocamento. Não há multiplicação no circuito. O erro é sempre para baixo, com MRED perto de 3,8% e no máximo 11,1%.</dd>
</dl>
<p>A Estrutura mostra o diagrama de pontos das técnicas baseadas em produtos parciais (colunas, Booth e Kulkarni) e, para todas, o custo de cada etapa do circuito em portas.</p>
<h3>Compensação do viés</h3>
<p>Quando o erro é quase todo de um lado só, somar uma constante ao resultado tira o viés e reduz o MED. A constante é o erro médio medido com entradas uniformes no circuito sem compensação, e fica fixa no projeto, como a constante de correção dos multiplicadores truncados (${c('schulte1993')}). Nos multiplicadores truncados ela cai nas colunas truncadas, que valem 0: a compensação sai de graça, sem nenhuma porta. Sem sinal, a soma satura no maior valor em vez de dar a volta.</p>
<p>A compensação não melhora tudo. No Mitchell, somar a constante (606 em 8 bits) melhora o MED, mas os produtos pequenos passam a ter erro relativo enorme (1 × 1 vira 607): o MRED vai de 3,8% para mais de 30%. A métrica que importa depende da aplicação.</p>`,
        },
        {
            id: 'add',
            title: 'Somador',
            html: `
<dl>
    <dt>exato</dt><dd>propagação de vai um (ripple carry): o atraso cresce com a largura.</dd>
    <dt>truncado</dt><dd>os k bits baixos da soma ficam em 0 e não mandam vai um.</dd>
    <dt>LOA</dt><dd>lower part OR adder (${c('mahdiani2010')}): os k bits baixos são a OR e b (erra quando os dois bits são 1), e o vem um da parte exata é o AND do bit k − 1.</dd>
    <dt>segmentado</dt><dd>a soma é dividida em blocos de L bits que somam em paralelo; o vem um de cada bloco é previsto olhando só os P bits anteriores, como nos somadores ACA (${c('kahng2012')}) e GeAr (${c('shafique2015')}), em que L e P correspondem aos parâmetros R e P do GeAr. Com P = 0 os blocos são independentes; com P grande, a previsão quase nunca erra, mas o atraso volta a crescer. Quando erra, o erro é de uma potência de 2 inteira: o WCE é alto e o EP é baixo.</dd>
</dl>`,
        },
        {
            id: 'metrics',
            title: 'Métricas de erro',
            html: `
<p>As métricas seguem a literatura de circuitos aproximados (${c('liang2013', 'jiang2020')}). Para cada par de operandos, a distância de erro é ED = |aproximado − exato|.</p>
<table>
    <tr><th>Métrica</th><th>Definição</th></tr>
    <tr><td>ME</td><td>média do erro com sinal: o viés. Um viés grande pode ser compensado somando uma constante.</td></tr>
    <tr><td>MED</td><td>média de ED</td></tr>
    <tr><td>WCE</td><td>maior ED (o par que o produz aparece no Resumo)</td></tr>
    <tr><td>MSE</td><td>média de ED²</td></tr>
    <tr><td>NMED</td><td>MED dividido pela maior saída exata possível</td></tr>
    <tr><td>MRED</td><td>média de ED / exato, nos pares com exato diferente de 0</td></tr>
    <tr><td>EP</td><td>fração dos pares com erro</td></tr>
</table>
<p>No Booth, que é com sinal, o MRED divide pelo valor absoluto do produto exato, e o NMED divide por 2<sup>2N−2</sup>, o maior produto em módulo.</p>
<p>Com 8 bits e entradas uniformes, a avaliação é exaustiva (65536 pares). Nos outros casos, 200 mil pares sorteados com semente fixa, e o Resumo mostra, ao lado de cada média, a meia largura do <strong>intervalo de confiança de 95%</strong> (aproximação normal: 1,96 vezes o desvio padrão da amostra dividido pela raiz do número de pares). O WCE de uma amostra é só um limite inferior do pior caso. As entradas normais e exponenciais mostram que as mesmas métricas mudam com os dados: um multiplicador que erra nos operandos grandes parece ótimo se os dados são quase sempre pequenos.</p>
<h3>Operandos reais das aplicações</h3>
<p>As entradas <strong>reais da LeNet-5</strong> e <strong>reais do filtro gaussiano</strong> trocam a distribuição inventada pela que a unidade vê de fato numa aplicação. Os pares saem de <code>data/operands.bin</code>, gerado por <code>scripts/operands.mjs</code>: na LeNet-5, os pares (ativação, |peso|) de todas as 416 milhões de multiplicações das 1000 imagens de teste, sorteados com a frequência de cada par, e os pares (acumulador, produto) das somas das acumulações; no filtro, os pares (pixel, peso) e (acumulador, produto) na imagem de teste. Um somador de N bits recebe os N bits baixos de cada operando, como na acumulação aproximada da aba Rede neural.</p>
<p>A diferença é grande. Na LeNet-5, mais da metade das multiplicações tem ativação zero (o ReLU e a borda), e só 9% dos pesos passam de 64 em módulo: uma técnica que erra pouco nos operandos pequenos fica melhor do que as métricas uniformes dizem, e uma que erra muito neles, pior. Na aba Síntese, o espaço de projeto mostra o erro e a energia com esses pares, e a fronteira de Pareto muda.</p>
<p>O mapa de erro mostra |erro| para cada par (a, b): padrões em faixas, cantos ou diagonais revelam onde a técnica falha. O histograma mostra se o erro é simétrico ou de um lado só.</p>`,
        },
        {
            id: 'cost',
            title: 'Área e atraso',
            html: `
<p>O custo vem de um <strong>modelo didático</strong>: a área é o número de portas de duas entradas (AND, OR, XOR) do circuito gerado, e o atraso é a profundidade lógica, uma unidade por porta. Um somador completo conta 5 portas e um meio somador, 2.</p>
<p>A <strong>atividade</strong> é a média, por operação, do número de saídas de porta que mudam de valor entre um par de entradas e o seguinte, numa sequência de 4096 pares aleatórios. A energia dinâmica é proporcional a ela (vezes a capacitância e o quadrado da tensão; ${c('chandrakasan1992')}), então serve como indicador relativo de energia entre as técnicas. Não é potência medida: o modelo não tem capacitâncias nem atrasos reais, e por isso ignora os pulsos espúrios (glitches) que encarecem os somadores em cascata.</p>
<p>Esse modelo serve para comparar as técnicas entre si e entender de onde vem a economia, mas não substitui uma síntese. Em FPGA, o custo real depende de como a ferramenta empacota a lógica em LUTs de 6 entradas e usa a cadeia de carry dedicada; em ASIC, das células da biblioteca. As configurações do espaço de projeto (cerca de 560) têm também os números de uma síntese real para FPGA e para ASIC com o PDK aberto SkyWater 130 nm, inclusive a energia por operação medida com o OpenSTA (veja <a href="#h-synth">Síntese em FPGA e ASIC</a>).</p>`,
        },
        {
            id: 'vos',
            title: 'Tensão e memória',
            html: `
<h3>Escalonamento de tensão além da margem</h3>
<p>Abaixar a tensão reduz a energia dinâmica com V², mas deixa as portas mais lentas. O atraso de cada porta segue a lei de potência alfa (${c('sakurai1990')}), d ~ V / (V − V<sub>t</sub>)<sup>α</sup>, com V<sub>t</sub> = 0,3 e α = 1,3 em tensões normalizadas pela nominal: em 0,8 a porta fica 1,24 vez mais lenta; em 0,6, 1,81 vez. O relógio fica fixo. Um bit de saída que chega depois da borda é capturado com o valor da operação anterior.</p>
<p>O instante em que cada bit chega depende dos dados: numa sequência de 4096 operações, um fio que não muda de valor está pronto no instante 0, e um fio que muda fica pronto uma porta depois da última entrada que mudou. Só os caminhos que os dados de fato sensibilizam contam, e por isso o somador exato de 16 bits, com caminho estático de 31 portas, não passou de 17 na sequência de teste. O modelo ignora os pulsos espúrios (glitches) e o valor controlador das portas.</p>
<p>O relógio pode ser o da unidade exata (o mesmo sistema, trocando só a unidade) ou o da própria unidade. Com o relógio da exata aparece a sinergia entre as duas técnicas: o multiplicador com 8 colunas truncadas tem caminhos mais curtos e só começa a errar por tempo perto de 0,64, contra 0,78 do exato. O Mitchell e o DRUM, com caminhos mais longos que o exato, erram por tempo já perto de 0,9. A imagem usa o ganho de brilho (multiplicador) ou a média com o vizinho (somador), pixel a pixel, na mesma sequência.</p>
<h3>Calibração com as células do sky130</h3>
<p>O modelo genérico (V<sub>t</sub> = 0,3 e α = 1,3) é só um ponto de partida. A biblioteca sky130_fd_sc_hd do PDK aberto da SkyWater (${c('sky130')}) traz as tabelas de atraso e de energia de cada célula em vários cantos de processo, temperatura e tensão. O script <code>scripts/sky130/voltage.py</code> lê as tabelas de oito células comuns (inversor, NAND2, NOR2, XOR2, AOI21, OAI21, somador completo e MUX2) num ponto fixo de transição e carga e ajusta a lei de potência alfa à série do canto lento a −40 °C, de 1,28 a 1,76 V. O ajuste dá V<sub>t</sub> = 1,03 V (0,572 da nominal de 1,8 V) e α = 1,44, com erro de 0,2%.</p>
<p>O atraso real cresce bem mais rápido que no modelo genérico: em 1,28 V ele é 3,4 vezes o de 1,76 V, contra 1,4 vez do genérico. Com o modelo ajustado, o multiplicador exato de 8 bits começa a errar por tempo já perto de 0,91 da nominal (0,78 no genérico), e o somador exato de 16 bits perto de 0,81 (0,59). A energia, por outro lado, confirma o V²: em 1,28 V ela é 52% da de 1,76 V, contra 53% previstos. E o canto típico (25 °C, 1,8 V) é 1,5 vez mais rápido que o lento: essa é a margem que o projeto reserva para o pior caso, e que o escalonamento além da margem aproveita num chip típico.</p>
<h3>Memória aproximada</h3>
<p>A imagem é guardada numa memória que inverte cada bit com a probabilidade escolhida, como uma DRAM com refresh mais espaçado que o seguro (Flikker, ${c('liu2011')}), uma SRAM com tensão baixa ou uma memória não volátil com escrita mais fraca. Inverter o bit b muda o pixel em 2<sup>b</sup>, e o MSE esperado é a taxa de erro vezes a soma de 4<sup>b</sup> nos bits não protegidos. Os bits altos dominam a soma: guardar os 2 ou 3 bits mais significativos numa parte confiável da memória resolve quase todo o erro, e o resto pode ficar na parte barata. A economia de energia depende da tecnologia e não é estimada aqui.</p>`,
        },
        {
            id: 'sc',
            title: 'Computação estocástica',
            html: `
<p>Na computação estocástica (${c('gaines1969', 'alaghi2013')}), um valor p entre 0 e 1 é representado por um fluxo de N bits em que uma fração p dos bits vale 1. Todos os bits pesam o mesmo, 1/N. A aritmética fica trivial:</p>
<ul>
    <li><strong>multiplicação unipolar</strong>: uma porta AND. Se os fluxos forem independentes, P(a e b) = p<sub>a</sub> p<sub>b</sub>;</li>
    <li><strong>multiplicação bipolar</strong>: o valor é v = 2p − 1, entre −1 e 1, e uma porta XNOR multiplica;</li>
    <li><strong>soma escalada</strong>: um MUX cuja seleção tem p = 1/2 dá (a + b) / 2. A soma sai dividida por 2 para caber entre 0 e 1.</li>
</ul>
<p>Cada fluxo sai de um <strong>gerador</strong> (SNG): a cada ciclo, um número pseudoaleatório r<sub>t</sub> de 8 bits é comparado com o valor binário x, e o bit é 1 quando x &gt; r<sub>t</sub>. Na volta, um contador conta os uns. A aba compara quatro fontes para r<sub>t</sub>:</p>
<ul>
    <li><strong>aleatório ideal</strong>: bits independentes, novos a cada operação. O erro cai com 1/√N: dobrar a precisão custa quatro vezes mais ciclos, e para igualar um binário de 8 bits seriam precisos mais de cem mil bits;</li>
    <li><strong>LFSRs diferentes</strong>: o que se faz no hardware. Com 8 bits o período é 255, e passar de N = 256 não melhora nada (o erro fica perto de 1% na multiplicação);</li>
    <li><strong>um LFSR para todos os fluxos</strong>: os fluxos ficam correlacionados. Os uns de um caem nas mesmas posições dos uns do outro, e a AND dá min(a, b) em vez de a × b. É o erro mais típico da área (${c('alaghi2013corr')}), e a razão de os circuitos estocásticos gastarem tanto com geradores independentes;</li>
    <li><strong>baixa discrepância</strong> (sequência de Sobol, ${c('sobol1967')}, com os números de direção de ${c('joe2008')}; o uso em computação estocástica é de ${c('alaghi2014')}): os uns ficam espalhados por igual, e as duas primeiras dimensões cobrem o quadrado de forma uniforme. O erro cai com 1/N, e a multiplicação chega à precisão do binário de 8 bits com cerca de mil bits.</li>
</ul>
<p>O <strong>custo</strong> mostra a outra face: a operação é uma porta, mas cada fluxo precisa de um LFSR e de um comparador, e a saída de um contador. Mesmo assim o circuito estocástico ocupa menos que o multiplicador binário exato (no modelo de portas, 105 portas e 25 flip-flops contra 320 portas), só que trabalha N ciclos: com N = 256, a energia estimada fica cerca de 100 vezes a do binário. A computação estocástica faz sentido quando os geradores são compartilhados entre muitas operações, quando os dados já chegam como fluxos (sensores, redes neurais em hardware) ou quando a tolerância a falhas importa mais que a energia.</p>
<p>A <strong>tolerância a bits errados</strong> é a grande vantagem: um bit errado no fluxo muda o valor em 1/N, enquanto no binário o bit mais significativo muda metade da faixa. Com uma taxa de erro de 1% por bit, o erro do fluxo quase não muda, e o do binário cresce várias vezes. Na imagem, o gaussiano 1 2 1 é feito sem nenhuma multiplicação: um MUX de 9 entradas sorteia a cada ciclo um vizinho com probabilidade igual ao seu peso, e a fração de uns da saída é a média ponderada. Com bits errados, a imagem estocástica fica um pouco mais ruidosa por igual; a binária ganha pixels brancos e pretos espalhados.</p>
<p>O modelo de custo usa as mesmas portas de duas entradas das outras abas, com o comparador do SNG construído como uma cadeia de vai um. A energia considera todos os elementos ativos em todo ciclo, o que é pessimista para o estocástico (a atividade de um LFSR é alta, mas a da porta AND não) e otimista para o binário (que tem pulsos espúrios). A ordem de grandeza da diferença, porém, é a mesma relatada na literatura.</p>`,
        },
        {
            id: 'synth',
            title: 'Síntese em FPGA e ASIC',
            html: `
<p>O script <code>scripts/synth.mjs</code>, rodado localmente (são horas de CPU), sintetiza o <strong>espaço de projeto</strong> de <code>js/axc/designspace.js</code>, cerca de 540 configurações estratificadas por técnica: Booth, Kulkarni, DRUM e Mitchell completos, com e sem compensação; o multiplicador por colunas e o somador segmentado numa grade regular de passo 2 (cerca de 25% de cada); o truncado e o LOA completos. Para cada uma:</p>
<ol>
    <li>exporta a unidade em Verilog: o mesmo circuito que o simulador avalia, uma atribuição por porta, com as somas de propagação de vai um escritas como <code>+</code> para a síntese usar a cadeia de carry (CARRY4), como num somador escrito à mão;</li>
    <li>simula o Verilog no Icarus Verilog (${c('iverilog')}) com vetores calculados pelo simulador (todos os pares em 8 bits, 20 mil em 16 bits); qualquer diferença interrompe o script;</li>
    <li>sintetiza com o Yosys (${c('yosys')}) e o ABC (${c('brayton2010')}) para FPGA Xilinx 7 series (<code>synth_xilinx -abc9</code>, sem DSP) e guarda as LUTs, as CARRY4 e o caminho mais longo, em células;</li>
    <li>sintetiza para ASIC em três fluxos, mede cada netlist com o OpenSTA (${c('opensta')}) e calcula as métricas de erro com entradas uniformes e com os operandos reais das aplicações (abaixo).</li>
</ol>
<p>A aba <strong>Biblioteca</strong> da página de síntese de alto nível (<code>hls.html</code>) mostra a tabela, a comparação entre o modelo de portas e a síntese, o espaço de projeto e os botões para baixar o Verilog e o testbench da unidade escolhida na tabela, para levar ao Vivado ou ao Quartus (qualquer outra configuração sai pela linha de comando: <code>node bin/axc.mjs verilog</code>). Na Comparação, o custo pode ser as LUTs, a área, o atraso ou a energia ASIC; as configurações que não estão entre as sintetizadas ficam fora do gráfico.</p>
<p>No FPGA, o DRUM de 8 bits gasta quase as mesmas LUTs do multiplicador exato (90 contra 101: o detector do 1 e os deslocadores comem a economia do multiplicador menor), e o Mitchell, sem multiplicação nenhuma, sai bem menor sem truncar nada (70 contra 101 LUTs em 8 bits e 280 contra 470 em 16), ao preço de um MRED de 3,8%. O exemplo mais instrutivo é o LOA: no modelo de portas, o LOA de 8 bits com k = 4 gasta 25 portas contra 37 do exato; no FPGA, 9 LUTs contra 8. A parte baixa com OR troca a cadeia de carry, que soma quase de graça, por LUTs comuns. Muitas técnicas pensadas para ASIC não economizam nada em FPGA, e é por isso que existem multiplicadores aproximados projetados para LUTs e CARRY4.</p>
<h3>ASIC com o PDK aberto SkyWater 130 nm</h3>
<p>O Yosys mapeia o circuito nas células padrão da biblioteca <code>sky130_fd_sc_hd</code> do PDK aberto da SkyWater (${c('sky130')}) (canto típico, 25 °C, 1,8 V) com o ABC, sem as células que não servem para lógica combinacional comum (sequenciais, de relógio, de atraso, de baixo consumo e de preenchimento), como os fluxos abertos fazem com a lista DONT_USE. São três fluxos, todos com mapeamento por atraso, buffers e dimensionamento de células:</p>
<ul>
    <li><strong>atraso mínimo</strong>: o ABC busca o menor atraso possível (é o fluxo dos números do Resumo e da tabela);</li>
    <li><strong>área mínima</strong>: com um alvo de atraso folgado, o ABC só economiza área;</li>
    <li><strong>iso atraso</strong>: área mínima sob o atraso da unidade exata de mesma largura no fluxo de atraso mínimo. É a comparação justa dos artigos: quanto a aproximação economiza na mesma velocidade. Uma técnica mais lenta que a exata (como o Booth, e o DRUM com k de 4 para cima, que tem o detector e os deslocadores no caminho crítico) não alcança o alvo e fica com o próprio atraso mínimo.</li>
</ul>
<p>Cada netlist mapeada é conferida de novo no Icarus Verilog, com modelos funcionais das células lidos da própria biblioteca, e medida com o OpenSTA: o atraso do caminho crítico com o modelo de fio da biblioteca, buf_2 nas entradas e 5 fF em cada saída, e a energia por operação a partir da atividade de uma simulação da netlist com 2048 pares em sequência. A simulação é de atraso zero: os pulsos espúrios (glitches) ficam de fora, então a energia é um limite inferior, e os somadores em cascata e os multiplicadores são os mais subestimados. São números para comparar as configurações entre si, não o resultado depois do posicionamento e do roteamento.</p>
<p>A escolha do fluxo muda muito os números: o MUL8 exato ocupa 2973 µm² com 2115 ps no fluxo de atraso mínimo, 2800 µm² no iso atraso e 1906 µm² com 3463 ps no de área mínima. Por isso cada comparação tem de dizer em qual fluxo foi feita. No fluxo de atraso mínimo, o LOA de 16 bits com 8 bits baixos aproximados ocupa 455 µm² contra 731 do exato e é mais rápido (949 contra 1212 ps), quando no FPGA gastava 17 LUTs contra 16; o DRUM com k = 3 em 8 bits ocupa 1245 µm² contra 2973 e gasta 1062 fJ por operação contra 2852.</p>
<h3>Energia com os operandos reais</h3>
<p>A energia depende dos dados tanto quanto o erro. Com os pares reais da LeNet-5 (mais da metade com ativação zero), o MUL8 exato gasta 1068 fJ por operação, e não 2852: e o DRUM3, que economizava 63% com entradas uniformes, economiza só 7% (993 fJ), porque o detector do 1 mais alto e os deslocadores continuam chaveando com os operandos pequenos, enquanto o multiplicador exato quase para. Em 16 bits a inversão é completa: com os mesmos pares, o Mitchell gasta 2562 fJ contra 1096 do exato, embora com entradas uniformes gaste bem menos. O espaço de projeto mostra a energia com esses pares (medida na netlist de atraso mínimo) e a fronteira de Pareto que resulta dela.</p>
<h3>Espaço de projeto e a EvoApprox8b</h3>
<p>Abaixo da tabela, o <strong>espaço de projeto</strong> põe todas as configurações de um grupo (MUL8, MUL16, ADD8 ou ADD16) no gráfico, com o fluxo ASIC, o custo e o erro à escolha, as cores por técnica e a fronteira de Pareto. O limite de erro tira do gráfico as configurações degeneradas (as que truncam tudo têm custo quase zero e erro de 100%). A tabela da fronteira mostra o intervalo de confiança de 95% quando o erro vem de amostragem, e os botões exportam o grupo inteiro em CSV, JSON e SVG, com todos os custos, todos os erros e a marcação da fronteira.</p>
<p>Como referência, os losangos são os circuitos sem sinal de 8 e 16 bits da EvoApproxLib (${c('mrazek2017')}), uma biblioteca de multiplicadores e somadores obtidos por programação genética cartesiana, sintetizados aqui com exatamente o mesmo fluxo (<code>scripts/evoapprox.mjs</code>) e com o erro calculado sobre os mesmos pares; as métricas conferem com as publicadas pela biblioteca. Com entradas uniformes, os circuitos evoluídos dominam quase toda a fronteira de área contra MRED dos multiplicadores de 8 bits, o que é esperado: foram otimizados exatamente para isso. Com os operandos da LeNet-5, as técnicas clássicas (Kulkarni e as colunas aproximadas) ficam com a ponta de baixo erro. Em 16 bits a diferença é ainda maior: com entradas uniformes, a EvoApprox tem 15 dos 41 pontos da fronteira de área contra MRED (o resto são colunas truncadas e aproximadas); com energia e erro medidos nos operandos da LeNet-5, nenhum circuito dela fica na fronteira. Um circuito otimizado para uma distribuição de entradas não é necessariamente bom para outra. Os circuitos da EvoApprox chegam como netlists de portas, e a síntese parte dessa estrutura: o exato deles sai mais lento que o daqui (2928 contra 2115 ps em 8 bits).</p>
<p>O Yosys é uma ferramenta livre; o Vivado costuma dar menos LUTs para o mesmo circuito. Os números servem para comparar as configurações entre si, não para comparar com tabelas de artigos sintetizados em outra ferramenta e outra tecnologia.</p>`,
        },
        {
            id: 'cmp',
            title: 'Comparação e fronteira de Pareto',
            html: `
<p><strong>Adicionar à comparação</strong> guarda a configuração atual; <strong>Varrer</strong> adiciona de uma vez a série do último parâmetro mexido (colunas truncadas ou aproximadas no multiplicador; k ou P no somador). O gráfico põe o custo escolhido no eixo x e o erro escolhido no eixo y.</p>
<p>Uma configuração <strong>domina</strong> outra quando não é pior em nenhum dos dois eixos e é melhor em pelo menos um. As não dominadas formam a <strong>fronteira de Pareto</strong>, ligada em degraus: são as únicas escolhas razoáveis, e a decisão entre elas depende de quanto erro a aplicação tolera. Troque a métrica de erro e veja a fronteira mudar: WCE e MRED podem escolher configurações diferentes.</p>
<p>A coluna <strong>dominada por</strong> conta quantas configurações da comparação dominam cada uma, com o custo e o erro escolhidos: zero é a fronteira. O <strong>ponto de joelho</strong>, marcado no gráfico, é o ponto da fronteira mais distante da reta que liga os seus extremos, com os dois eixos normalizados entre 0 e 1 (o erro em log, quando o gráfico está em log, e então sem os pontos de erro zero). Até ele, reduzir o custo sai barato em erro; depois dele, cada redução custa bem mais erro. É uma escolha razoável quando não há uma restrição de erro definida. O critério é semelhante ao do algoritmo Kneedle (${c('satopaa2011')}).</p>
<p>Como custo, além da área e do atraso, dá para usar a atividade e o produto da área pela atividade, um análogo do produto de potência e área.</p>
<p>A métrica "MSE da imagem filtrada" mede o erro na aplicação: o filtro gaussiano 3 × 3 sobre a imagem de teste (para os somadores de 8 bits, a média com o vizinho). Kernels inteiros, com imagens suas, ficam na página de síntese de alto nível. A comparação fica guardada no navegador; o botão CSV exporta a tabela.</p>`,
        },
        {
            id: 'nn',
            title: 'Rede neural (LeNet 5 e MiniLenet no MNIST)',
            html: `
<p>A página <strong>Rede neural</strong> (na barra do topo, ou pelo botão <strong>Usar na LeNet-5</strong>, que a abre com o multiplicador atual) classifica 1000 imagens de teste, 100 de cada classe, com uma de seis redes: a <strong>LeNet 5</strong> (${c('lecun1998')}) nas versões modernas, com ReLU e max pooling (duas convoluções 5 × 5 com 6 e 16 filtros e três camadas densas de 120, 84 e 10 saídas; 61 mil pesos e 416 mil multiplicações por imagem no MNIST), ou a <strong>MiniLenet</strong> (abaixo), cada uma em três bases: o <strong>MNIST</strong>, dígitos manuscritos em tons de cinza 28 × 28 (${c('mnist')}); o <strong>Fashion MNIST</strong>, roupas e calçados no mesmo formato (${c('xiao2017')}); e a <strong>CIFAR 10</strong>, fotos coloridas 32 × 32 de aviões, carros, pássaros, gatos e outras seis classes (${c('krizhevsky2009')}).</p>
<p>Com exceção da MiniLenet no MNIST, as redes foram treinadas com <code>scripts/nn/train.py</code> (PyTorch): 5000 imagens de treino, 500 de cada classe, ficam de fora e servem de validação (a escolha da melhor época e, depois, a busca), e o teste é o conjunto oficial. A quantização é feita depois do treino, como nas redes inteiras (${c('jacob2018')}) e na convenção da MiniLenet: pesos int8 por canal de saída, ativações uint8 com ponto zero e faixa de 0 a 127, reescala em Q32. No teste completo de 10 mil imagens, em ponto flutuante e em 8 bits: LeNet 5 99,2% e 99,2% no MNIST, 90,7% e 90,7% no Fashion MNIST, 70,5% e 70,6% na CIFAR 10; MiniLenet 89,0% e 88,8% no Fashion MNIST, 60,2% e 60,1% na CIFAR 10. O navegador faz exatamente a mesma conta inteira do script, e um teste confere as 1000 classes de cada rede. Redes deste tamanho vão bem nas bases em tons de cinza, mas erram 30 a 40% na CIFAR 10: com 3 ou 6 filtros, as fotos coloridas pedem mais do que a rede tem. A LeNet 5 original da página, treinada só com NumPy (<code>scripts/lenet5/train.py</code>), continua como a fonte dos operandos reais da página de unidades (<code>data/operands.bin</code>).</p>
<h3>MiniLenet e o formato das redes</h3>
<p>O seletor <strong>Modelo</strong> troca a rede. A <strong>MiniLenet</strong> vem de um código C para o Vitis HLS (pesos e escalas do grupo DEFADAS/ITACA da Universitat Politècnica de València, licença MIT): duas convoluções 5 × 5 com borda 2 (3 e 6 filtros), dois max pooling, uma camada densa de 147 saídas e a de 10, com 45 mil pesos e 192 mil multiplicações por imagem. A quantização é a do PyTorch: pesos int8 simétricos, ativações uint8 com ponto zero e reescala em Q32, <code>(acc × M + 2<sup>31</sup>) &gt;&gt; 32</code> mais o ponto zero da saída, saturada entre 0 e 255. O ponto zero da entrada de cada camada fica absorvido no viés (Σ w (a − z) + b = Σ w a + (b − z Σ w)), e a borda das convoluções é preenchida com z; assim todo produto é uint8 × int8, como na LeNet 5. Com as unidades exatas, as 10 saídas da última camada são iguais às do código C, bit a bit, nas 1000 imagens (um teste confere), com o max pooling em uint8.</p>
<p>As redes ficam em <code>data/nn/</code>, num formato JSON comum (camadas conv, maxpool, flatten e densa, pesos em base64, reescala em Q32 ou em ponto flutuante), listadas em <code>data/nn/models.json</code>. O script <code>scripts/nn/import.mjs</code> gera esse formato a partir da saída de <code>scripts/lenet5/train.py</code> ou dos cabeçalhos C da MiniLenet. O <strong>diagrama da arquitetura</strong>, embaixo da matriz de confusão, sai da mesma descrição: os mapas de atributos como pilhas de planos, o núcleo de cada convolução (ou a janela do pooling) ligado ao ponto que ele produz e as camadas densas como barras, no estilo do NN SVG (${c('lenail2019')}). Ele exporta em SVG e PNG como os outros gráficos.</p>
<p>Os produtos das camadas marcadas vêm do multiplicador escolhido: o da página de unidades ou qualquer multiplicador da biblioteca sintetizada. Como em todas as aplicações, o circuito é avaliado uma vez para todos os pares (ativação, peso), e a inferência consulta essa tabela. Nas unidades sem sinal, a unidade calcula |peso| × ativação e o sinal é aplicado de forma exata; no Booth de 8 bits a ativação perde o bit mais baixo para caber no operando com sinal; nas unidades de 16 bits, os operandos ocupam os bits baixos.</p>
<p>O que a aba mostra, e que a literatura de redes aproximadas explora (${c('venkataramani2014', 'mrazek2016')}):</p>
<ul>
    <li><strong>a rede tolera muito erro</strong>: truncar 4 colunas não faz nenhuma imagem passar a errar, e o Mitchell (MRED de 3,8%) dá praticamente a mesma acurácia da rede exata;</li>
    <li><strong>o viés importa mais que o erro médio</strong>: cada saída soma até 400 produtos, e um erro sempre do mesmo lado se acumula. O Mitchell com compensação tem MED menor que sem, mas erro relativo enorme nos produtos pequenos, que são a maioria numa rede, e a acurácia da LeNet 5 no MNIST cai para 82% (a da MiniLenet, para 49%). O Booth de 16 bits com 6 colunas truncadas, sem compensação, erra em média −88 por produto e a rede quase para de funcionar;</li>
    <li><strong>a base muda a tolerância</strong>: a mesma unidade custa mais acurácia numa tarefa difícil. O MUL8 DRUM3 em todas as camadas da LeNet 5 tira 0,5 ponto no MNIST, 3,4 no Fashion MNIST e 20,4 na CIFAR 10 (de 69,3% para 48,9% nas 1000 imagens);</li>
    <li><strong>as camadas não são iguais</strong>: o botão de sensibilidade aproxima uma camada por vez. A conv2 faz mais da metade dos produtos; aproximar só as camadas tolerantes é a estratégia dos projetos reais.</li>
</ul>
<h3>Somador aproximado nas acumulações</h3>
<p>O seletor <strong>Somador das acumulações</strong> põe um somador aproximado nas somas das camadas marcadas, junto com o multiplicador (ou sozinho, com o multiplicador exato); dá para escolher qualquer somador da biblioteca. As somas acumuladas passam de 24 bits e têm sinal, e os somadores do simulador têm 8 ou 16 bits: o somador faz os bits baixos de cada soma, na ordem dos laços do código C (cada produto e, por fim, o viés), e a parte alta é somada de forma exata com o vai um que sai dele. É onde o truncado, o LOA e o segmentado erram de qualquer forma. São cerca de 416 mil somas por imagem, então a acumulação usa o modelo funcional de cada somador (a mesma conta do circuito, conferida em todos os pares de 8 bits e em pares sorteados de 16) e leva de 1,5 a 7 segundos para as 1000 imagens.</p>
<p>O truncado e o LOA nos 4 ou 8 bits baixos quase não mudam a acurácia. O segmentado de 16 bits com blocos de 4 e previsão de 4 bits derruba a LeNet 5 e a MiniLenet no MNIST para uns 66%: os acumuladores ficam negativos com frequência, e somar um valor negativo pequeno em complemento de 2 propaga o vai um por todos os bits, justamente o caso em que a previsão do vai um falha. Com blocos de 8 bits, as cadeias longas são menos frequentes e a acurácia volta a 98%. A mesma unidade que vai bem com entradas uniformes pode falhar com os dados reais.</p>
<p>A matriz de confusão mostra para onde vão os erros, e a grade mostra as imagens que a rede exata acerta e a aproximada erra. As imagens do MNIST são distribuídas sob a licença CC BY-SA 3.0.</p>`,
        },
        {
            id: 'next',
            title: 'Próximas etapas',
            html: `
<ul>
    <li>mais técnicas: codificador de Booth aproximado, somadores com outras previsões de vai um;</li>
    <li>mais kernels e aplicações na página de síntese de alto nível.</li>
</ul>`,
        },
        {
            id: 'refs',
            title: 'Referências',
            html: `
<p>Para citar o próprio simulador: T. Almeida, <em>axc-simulator: Simulador de Computação Aproximada</em>, Zenodo, 2026, DOI <a href="https://doi.org/10.5281/zenodo.23427697" target="_blank" rel="noopener">10.5281/zenodo.23427697</a>.</p>
<p>As técnicas e os modelos do simulador vêm destes trabalhos. Os DOIs foram conferidos no Crossref ou no OpenAlex; o artigo de Dadda (1965), publicado na Alta Frequenza, não tem DOI.</p>
${REF_GROUPS.map((g) => `<h3>${GROUP_TITLES[g.key]}</h3>\n<ol class="refs">${g.keys.map((k) => `<li>${refHtml(k, 'pt')}</li>`).join('\n')}</ol>`).join('\n')}`,
        },
    ],
};

/** Seções de cada página, na ordem do índice. */
const PAGES = {
    units: ['start', 'mul', 'mul2', 'add', 'metrics', 'cost', 'vos', 'sc', 'cmp', 'synth', 'figs', 'pages', 'next', 'refs'],
    hls: ['hls-start', 'hls-lang', 'hls-cost', 'hls-sched', 'hls-err', 'hls-dse', 'hls-vitis', 'hls-cli', 'synth', 'figs', 'pages', 'refs'],
    lenet: ['nn-start', 'nn', 'figs', 'pages', 'refs'],
};

export default { ...base, heads: { units: { title: base.title, lead: base.lead }, ...heads }, sections: [...base.sections, ...pageSections, ...common], pages: PAGES };
