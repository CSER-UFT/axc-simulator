/**
 * Ajuda do simulador, em português. O texto evita hífens e travessões por padrão de estilo do projeto.
 */
export default {
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
    <li><strong>Estrutura</strong> mostra onde a aproximação acontece; <strong>Erro</strong> mostra para quais operandos ela erra e quanto; <strong>Comparação</strong> junta várias configurações num gráfico de custo contra erro; <strong>Aplicação</strong> mostra o efeito numa imagem.</li>
</ol>
<p class="tip">Para começar: multiplicador de 8 bits, 4 colunas truncadas e nenhuma aproximada. O MED dá 12,25 e o WCE dá 49. Depois troque por 6 colunas aproximadas e compare os dois mapas de erro.</p>`,
        },
        {
            id: 'mul',
            title: 'Multiplicador por colunas',
            html: `
<p>A técnica <strong>por colunas</strong> é o ponto de partida: o multiplicador N × N sem sinal gera os produtos parciais a<sub>i</sub>·b<sub>j</sub> (uma porta AND cada), que caem na coluna i + j. As colunas são reduzidas por estágios no estilo de Dadda: as alturas alvo são 2, 3, 4, 6, 9, 13..., e a cada estágio cada coluna recebe só os somadores completos e meios somadores necessários para não passar do alvo. Sobram no máximo dois bits por coluna, e uma soma com propagação de vai um dá o produto. Para 8 bits, a redução usa 35 somadores completos e 7 meios somadores, como no livro. As colunas menos significativas podem ficar em três zonas:</p>
<dl>
    <dt>truncadas</dt><dd>os produtos parciais nem são gerados: economiza as portas AND e os somadores daquelas colunas. O erro é sempre para baixo (o resultado nunca passa do exato).</dd>
    <dt>aproximadas</dt><dd>a redução usa o compressor 4:2 aproximado (quatro bits viram soma e vai um, sem a ligação de vai um entre compressores vizinhos) e a soma final é um OR, sem vai um, como no LOA. Opcionalmente, o vem um da primeira coluna exata é o AND dos dois bits da última coluna aproximada.</dd>
    <dt>exatas</dt><dd>somadores completos e propagação de vai um.</dd>
</dl>
<p>O compressor aproximado calcula soma = (x1 ⊕ x2) + (x3 ⊕ x4) e vai um = x1·x2 + x3·x4. A aba Estrutura mostra a sua tabela verdade: ele erra em 5 das 16 combinações, por exemplo quando os quatro bits são 1 (dá 2 em vez de 4). É uma estrutura didática, do mesmo tipo dos compressores aproximados da literatura, mas não reproduz um artigo específico.</p>
<p>A tabela de alturas mostra quantos bits cada coluna tem a cada estágio (8, 6, 4, 3, 2 para 8 bits): a redução termina quando nenhuma coluna passa de dois. Nas colunas aproximadas, o compressor 4:2 aproximado substitui os somadores completos sempre que dá para tirar três bits de uma vez.</p>`,
        },
        {
            id: 'mul2',
            title: 'Outras técnicas de multiplicação',
            html: `
<dl>
    <dt>Booth radix 4 (com sinal)</dt><dd>Cada par de bits de b, com o bit anterior, escolhe 0, ±a ou ±2a: são N/2 produtos parciais em vez de N. Os operandos e o produto são em complemento de 2, e o mapa de erro vai de −2<sup>N−1</sup> a 2<sup>N−1</sup> − 1 nos dois eixos. Os produtos negativos são o complemento de cada bit mais 1 na coluna mais baixa da linha (a linha "neg" do diagrama), e o sinal de cada linha é estendido até a coluna 2N − 1 (os pontos claros). A aproximação é truncar as colunas baixas, como no multiplicador por colunas. O custo do Resumo é comparado com o Booth exato.</dd>
    <dt>Blocos 2 × 2 de Kulkarni</dt><dd>O multiplicador é montado com blocos que multiplicam 2 bits por 2 bits (Kulkarni, Gupta e Ercegovac, 2011). O bloco aproximado tem três saídas em vez de quatro e só erra em 3 × 3, que dá 7 em vez de 9. Os blocos de peso menor que o escolhido são aproximados, e os produtos dos blocos são somados de forma exata. Com todos os blocos aproximados, o MRED fica perto de 3,3% e o erro é sempre para baixo.</dd>
    <dt>DRUM</dt><dd>Dynamic Range Unbiased Multiplier (Hashemi, Bahar e Reda, 2015): de cada operando, só os k bits a partir do 1 mais significativo entram num multiplicador exato k × k, e o produto é deslocado de volta. O bit mais baixo do trecho vira 1, o que centra o erro do truncamento: o viés fica perto de zero e o erro relativo quase não depende da magnitude dos operandos. O custo extra é o detector do 1 mais alto e os deslocadores.</dd>
    <dt>Mitchell</dt><dd>Multiplicador logarítmico (Mitchell, 1962): log₂(x) ≈ p + f, com p a posição do 1 mais alto e f os bits abaixo dele lidos como fração. O produto vira a soma dos logaritmos, e o antilogaritmo é aproximado do mesmo jeito, com um deslocamento. Não há multiplicação no circuito. O erro é sempre para baixo, com MRED perto de 3,8% e no máximo 11,1%.</dd>
</dl>
<p>A Estrutura mostra o diagrama de pontos das técnicas baseadas em produtos parciais (colunas, Booth e Kulkarni) e, para todas, o custo de cada etapa do circuito em portas.</p>
<h3>Compensação do viés</h3>
<p>Quando o erro é quase todo de um lado só, somar uma constante ao resultado tira o viés e reduz o MED. A constante é o erro médio medido com entradas uniformes no circuito sem compensação, e fica fixa no projeto. Nos multiplicadores truncados ela cai nas colunas truncadas, que valem 0: a compensação sai de graça, sem nenhuma porta. Sem sinal, a soma satura no maior valor em vez de dar a volta.</p>
<p>A compensação não melhora tudo. No Mitchell, somar a constante (606 em 8 bits) melhora o MED, mas os produtos pequenos passam a ter erro relativo enorme (1 × 1 vira 607): o MRED vai de 3,8% para mais de 30%. A métrica que importa depende da aplicação.</p>`,
        },
        {
            id: 'add',
            title: 'Somador',
            html: `
<dl>
    <dt>exato</dt><dd>propagação de vai um (ripple carry): o atraso cresce com a largura.</dd>
    <dt>truncado</dt><dd>os k bits baixos da soma ficam em 0 e não mandam vai um.</dd>
    <dt>LOA</dt><dd>lower part OR adder: os k bits baixos são a OR e b (erra quando os dois bits são 1), e o vem um da parte exata é o AND do bit k − 1.</dd>
    <dt>segmentado</dt><dd>a soma é dividida em blocos de L bits que somam em paralelo; o vem um de cada bloco é previsto olhando só os P bits anteriores, como nos somadores GeAr e ACA. Com P = 0 os blocos são independentes; com P grande, a previsão quase nunca erra, mas o atraso volta a crescer. Quando erra, o erro é de uma potência de 2 inteira: o WCE é alto e o EP é baixo.</dd>
</dl>`,
        },
        {
            id: 'metrics',
            title: 'Métricas de erro',
            html: `
<p>Para cada par de operandos, a distância de erro é ED = |aproximado − exato|.</p>
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
<p>Com 8 bits e entradas uniformes, a avaliação é exaustiva (65536 pares). Nos outros casos, 200 mil pares sorteados com semente fixa. As entradas normais e exponenciais mostram que as mesmas métricas mudam com os dados: um multiplicador que erra nos operandos grandes parece ótimo se os dados são quase sempre pequenos.</p>
<p>O mapa de erro mostra |erro| para cada par (a, b): padrões em faixas, cantos ou diagonais revelam onde a técnica falha. O histograma mostra se o erro é simétrico ou de um lado só.</p>`,
        },
        {
            id: 'cost',
            title: 'Área e atraso',
            html: `
<p>O custo vem de um <strong>modelo didático</strong>: a área é o número de portas de duas entradas (AND, OR, XOR) do circuito gerado, e o atraso é a profundidade lógica, uma unidade por porta. Um somador completo conta 5 portas e um meio somador, 2.</p>
<p>A <strong>atividade</strong> é a média, por operação, do número de saídas de porta que mudam de valor entre um par de entradas e o seguinte, numa sequência de 4096 pares aleatórios. A energia dinâmica é proporcional a ela (vezes a capacitância e o quadrado da tensão), então serve como indicador relativo de energia entre as técnicas. Não é potência medida: o modelo não tem capacitâncias nem atrasos reais, e por isso ignora os pulsos espúrios (glitches) que encarecem os somadores em cascata.</p>
<p>Esse modelo serve para comparar as técnicas entre si e entender de onde vem a economia, mas não substitui uma síntese. Em FPGA, o custo real depende de como a ferramenta empacota a lógica em LUTs de 6 entradas e usa a cadeia de carry dedicada; em ASIC, das células da biblioteca. As configurações pré-definidas têm também os números de uma síntese real para FPGA (veja <a href="#h-synth">Síntese em FPGA</a>).</p>`,
        },
        {
            id: 'vos',
            title: 'Tensão e memória',
            html: `
<h3>Escalonamento de tensão além da margem</h3>
<p>Abaixar a tensão reduz a energia dinâmica com V², mas deixa as portas mais lentas. O atraso de cada porta segue a lei de potência alfa, d ~ V / (V − V<sub>t</sub>)<sup>α</sup>, com V<sub>t</sub> = 0,3 e α = 1,3 em tensões normalizadas pela nominal: em 0,8 a porta fica 1,24 vez mais lenta; em 0,6, 1,81 vez. O relógio fica fixo. Um bit de saída que chega depois da borda é capturado com o valor da operação anterior.</p>
<p>O instante em que cada bit chega depende dos dados: numa sequência de 4096 operações, um fio que não muda de valor está pronto no instante 0, e um fio que muda fica pronto uma porta depois da última entrada que mudou. Só os caminhos que os dados de fato sensibilizam contam, e por isso o somador exato de 16 bits, com caminho estático de 31 portas, não passou de 17 na sequência de teste. O modelo ignora os pulsos espúrios (glitches) e o valor controlador das portas.</p>
<p>O relógio pode ser o da unidade exata (o mesmo sistema, trocando só a unidade) ou o da própria unidade. Com o relógio da exata aparece a sinergia entre as duas técnicas: o multiplicador com 8 colunas truncadas tem caminhos mais curtos e só começa a errar por tempo perto de 0,64, contra 0,78 do exato. O Mitchell e o DRUM, com caminhos mais longos que o exato, erram por tempo já perto de 0,9. A imagem usa o ganho de brilho (multiplicador) ou a média com o vizinho (somador), pixel a pixel, na mesma sequência.</p>
<h3>Memória aproximada</h3>
<p>A imagem é guardada numa memória que inverte cada bit com a probabilidade escolhida, como uma DRAM com refresh mais espaçado que o seguro (Flikker, Liu e colegas, 2011), uma SRAM com tensão baixa ou uma memória não volátil com escrita mais fraca. Inverter o bit b muda o pixel em 2<sup>b</sup>, e o MSE esperado é a taxa de erro vezes a soma de 4<sup>b</sup> nos bits não protegidos. Os bits altos dominam a soma: guardar os 2 ou 3 bits mais significativos numa parte confiável da memória resolve quase todo o erro, e o resto pode ficar na parte barata. A economia de energia depende da tecnologia e não é estimada aqui.</p>`,
        },
        {
            id: 'synth',
            title: 'Síntese em FPGA',
            html: `
<p>A cada publicação do site, uma action do GitHub roda <code>scripts/synth.mjs</code> sobre as configurações pré-definidas:</p>
<ol>
    <li>exporta cada unidade em Verilog: o mesmo circuito que o simulador avalia, uma atribuição por porta, com as somas de propagação de vai um escritas como <code>+</code> para a síntese usar a cadeia de carry (CARRY4), como num somador escrito à mão;</li>
    <li>simula o Verilog no Icarus Verilog com vetores calculados pelo simulador (todos os pares em 8 bits, 20 mil em 16 bits); se houver qualquer diferença, a publicação para;</li>
    <li>sintetiza com o Yosys para FPGA Xilinx 7 series (<code>synth_xilinx -abc9</code>, sem DSP) e guarda as LUTs, as CARRY4 e o caminho mais longo, em células.</li>
</ol>
<p>A aba <strong>Síntese</strong> mostra a tabela, a comparação entre o modelo de portas e a síntese, e os botões para baixar o Verilog e o testbench da unidade atual (qualquer configuração), para levar ao Vivado ou ao Quartus. Na Comparação, o custo pode ser as LUTs da síntese; as configurações que não estão entre as sintetizadas ficam fora do gráfico.</p>
<p>As técnicas novas mostram a mesma lição de outro jeito: o DRUM de 8 bits gasta no FPGA as mesmas LUTs do multiplicador exato (o detector do 1 e os deslocadores comem a economia do multiplicador menor), e só compensa em 16 bits; o Mitchell, sem multiplicação nenhuma, sai bem menor que o exato sem truncar nada (nesta síntese, 70 contra 101 LUTs em 8 bits e 280 contra 470 em 16), ao preço de um MRED de 3,8%. E o próprio Booth exato já é menor que o multiplicador por colunas, por somar metade dos produtos parciais.</p>
<p>O exemplo mais instrutivo é o LOA: no modelo de portas, o LOA de 8 bits com k = 4 gasta 25 portas contra 37 do exato; no FPGA, gasta 9 LUTs contra 8. A parte baixa com OR troca a cadeia de carry, que soma quase de graça, por LUTs comuns. Muitas técnicas pensadas para ASIC não economizam nada em FPGA, e é por isso que existem multiplicadores aproximados projetados para LUTs e CARRY4.</p>
<p>O Yosys é uma ferramenta livre e roda na action sem licença; o Vivado costuma dar menos LUTs para o mesmo circuito. Os números servem para comparar as configurações entre si, não para comparar com tabelas de artigos sintetizados em outra ferramenta.</p>`,
        },
        {
            id: 'cmp',
            title: 'Comparação e fronteira de Pareto',
            html: `
<p><strong>Adicionar à comparação</strong> guarda a configuração atual; <strong>Varrer</strong> adiciona de uma vez a série do último parâmetro mexido (colunas truncadas ou aproximadas no multiplicador; k ou P no somador). O gráfico põe o custo escolhido no eixo x e o erro escolhido no eixo y.</p>
<p>Uma configuração <strong>domina</strong> outra quando não é pior em nenhum dos dois eixos e é melhor em pelo menos um. As não dominadas formam a <strong>fronteira de Pareto</strong>, ligada em degraus: são as únicas escolhas razoáveis, e a decisão entre elas depende de quanto erro a aplicação tolera. Troque a métrica de erro e veja a fronteira mudar: WCE e MRED podem escolher configurações diferentes.</p>
<p>A coluna <strong>dominada por</strong> conta quantas configurações da comparação dominam cada uma, com o custo e o erro escolhidos: zero é a fronteira. O <strong>ponto de joelho</strong>, marcado no gráfico, é o ponto da fronteira mais distante da reta que liga os seus extremos, com os dois eixos normalizados entre 0 e 1 (o erro em log, quando o gráfico está em log, e então sem os pontos de erro zero). Até ele, reduzir o custo sai barato em erro; depois dele, cada redução custa bem mais erro. É uma escolha razoável quando não há uma restrição de erro definida.</p>
<p>Como custo, além da área e do atraso, dá para usar a atividade e o produto da área pela atividade, um análogo do produto de potência e área.</p>
<p>A métrica "MSE da imagem filtrada" mede o erro na aplicação, com o filtro escolhido na aba Aplicação. A comparação fica guardada no navegador; o botão CSV exporta a tabela.</p>`,
        },
        {
            id: 'app',
            title: 'Aplicação em imagem',
            html: `
<p>O filtro é calculado duas vezes, com a unidade exata e com a aproximada, sobre uma imagem de teste sintética (ou uma imagem sua, reduzida para no máximo 256 pixels de lado e convertida para tons de cinza).</p>
<ul>
    <li><strong>gaussiano σ = 1</strong>: nove produtos pixel × peso por pixel (pesos 19, 32, 52), divididos por 256. Com um multiplicador, só os produtos são aproximados; com um somador de 16 bits, só a acumulação.</li>
    <li><strong>gaussiano 1 2 1</strong>: pesos que são potências de 2. Cada produto tem um único produto parcial por linha, e truncar colunas baixas pode não errar nada: o erro depende dos dados que a unidade recebe.</li>
    <li><strong>ganho de brilho</strong>: um produto por pixel.</li>
    <li><strong>média com o vizinho</strong>: uma soma de 8 bits por pixel.</li>
</ul>
<p><strong>PSNR</strong> = 10 log<sub>10</sub>(255² / MSE), em dB. <strong>SSIM</strong> (Wang e colegas, 2004) compara brilho, contraste e estrutura em janelas 8 × 8; 1 é igual. A diferença, colorida com a mesma rampa do mapa de erro (preto é zero), mostra em que regiões da imagem a aproximação aparece.</p>`,
        },
        {
            id: 'next',
            title: 'Protótipo e próximas etapas',
            html: `
<p>Esta é a primeira etapa, para avaliar a ideia. Etapas possíveis:</p>
<ul>
    <li>mais técnicas: codificador de Booth aproximado, somadores com outras previsões de vai um;</li>
    <li>computação estocástica (LFSR, multiplicação por AND, correlação entre fluxos);</li>
    <li>exportar a unidade para o simulador de compilador, como operação aproximada no DFG e no escalonamento.</li>
</ul>`,
        },
    ],
};
