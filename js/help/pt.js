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
            title: 'Multiplicador',
            html: `
<p>O multiplicador N × N sem sinal gera os produtos parciais a<sub>i</sub>·b<sub>j</sub> (uma porta AND cada), que caem na coluna i + j. As colunas são reduzidas por estágios no estilo de Dadda: as alturas alvo são 2, 3, 4, 6, 9, 13..., e a cada estágio cada coluna recebe só os somadores completos e meios somadores necessários para não passar do alvo. Sobram no máximo dois bits por coluna, e uma soma com propagação de vai um dá o produto. Para 8 bits, a redução usa 35 somadores completos e 7 meios somadores, como no livro. As colunas menos significativas podem ficar em três zonas:</p>
<dl>
    <dt>truncadas</dt><dd>os produtos parciais nem são gerados: economiza as portas AND e os somadores daquelas colunas. O erro é sempre para baixo (o resultado nunca passa do exato).</dd>
    <dt>aproximadas</dt><dd>a redução usa o compressor 4:2 aproximado (quatro bits viram soma e vai um, sem a ligação de vai um entre compressores vizinhos) e a soma final é um OR, sem vai um, como no LOA. Opcionalmente, o vem um da primeira coluna exata é o AND dos dois bits da última coluna aproximada.</dd>
    <dt>exatas</dt><dd>somadores completos e propagação de vai um.</dd>
</dl>
<p>O compressor aproximado calcula soma = (x1 ⊕ x2) + (x3 ⊕ x4) e vai um = x1·x2 + x3·x4. A aba Estrutura mostra a sua tabela verdade: ele erra em 5 das 16 combinações, por exemplo quando os quatro bits são 1 (dá 2 em vez de 4). É uma estrutura didática, do mesmo tipo dos compressores aproximados da literatura, mas não reproduz um artigo específico.</p>
<p>A tabela de alturas mostra quantos bits cada coluna tem a cada estágio (8, 6, 4, 3, 2 para 8 bits): a redução termina quando nenhuma coluna passa de dois. Nas colunas aproximadas, o compressor 4:2 aproximado substitui os somadores completos sempre que dá para tirar três bits de uma vez.</p>`,
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
<p>Com 8 bits e entradas uniformes, a avaliação é exaustiva (65536 pares). Nos outros casos, 200 mil pares sorteados com semente fixa. As entradas normais e exponenciais mostram que as mesmas métricas mudam com os dados: um multiplicador que erra nos operandos grandes parece ótimo se os dados são quase sempre pequenos.</p>
<p>O mapa de erro mostra |erro| para cada par (a, b): padrões em faixas, cantos ou diagonais revelam onde a técnica falha. O histograma mostra se o erro é simétrico ou de um lado só.</p>`,
        },
        {
            id: 'cost',
            title: 'Área e atraso',
            html: `
<p>O custo vem de um <strong>modelo didático</strong>: a área é o número de portas de duas entradas (AND, OR, XOR) do circuito gerado, e o atraso é a profundidade lógica, uma unidade por porta. Um somador completo conta 5 portas e um meio somador, 2.</p>
<p>Esse modelo serve para comparar as técnicas entre si e entender de onde vem a economia, mas não substitui uma síntese. Em FPGA, por exemplo, o custo real depende de como a ferramenta empacota a lógica em LUTs de 6 entradas e usa a cadeia de carry dedicada; em ASIC, das células da biblioteca. Uma etapa futura pode trazer uma estimativa em LUTs e uma tabela com resultados reais de síntese.</p>`,
        },
        {
            id: 'cmp',
            title: 'Comparação e fronteira de Pareto',
            html: `
<p><strong>Adicionar à comparação</strong> guarda a configuração atual; <strong>Varrer</strong> adiciona de uma vez a série do último parâmetro mexido (colunas truncadas ou aproximadas no multiplicador; k ou P no somador). O gráfico põe o custo escolhido no eixo x e o erro escolhido no eixo y.</p>
<p>Uma configuração <strong>domina</strong> outra quando não é pior em nenhum dos dois eixos e é melhor em pelo menos um. As não dominadas formam a <strong>fronteira de Pareto</strong>, ligada em degraus: são as únicas escolhas razoáveis, e a decisão entre elas depende de quanto erro a aplicação tolera. Troque a métrica de erro e veja a fronteira mudar: WCE e MRED podem escolher configurações diferentes.</p>
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
    <li>mais técnicas: Booth radix 4 aproximado, DRUM, multiplicador logarítmico de Mitchell, somadores com outras previsões de vai um;</li>
    <li>estimativa em LUTs e cadeias de carry de FPGA e uma tabela de referência com resultados reais de síntese;</li>
    <li>ponto de joelho e produto de área e potência na fronteira;</li>
    <li>computação estocástica (LFSR, multiplicação por AND, correlação entre fluxos);</li>
    <li>memória aproximada e escalonamento de tensão, com inversões de bit aplicadas à mesma imagem;</li>
    <li>exportar a unidade para o simulador de compilador, como operação aproximada no DFG e no escalonamento.</li>
</ul>`,
        },
    ],
};
