/**
 * Ajuda das páginas de síntese de alto nível e da rede neural, e as seções comuns às três páginas, em português.
 * Sem hífens nem travessões no texto, por padrão de estilo do projeto.
 */
import { cite } from '../refs.js';

const c = (...keys) => keys.map((k) => `<a class="cite" href="#h-refs">${cite(k, 'pt')}</a>`).join('; ');

export const heads = {
    hls: {
        title: 'Síntese de alto nível aproximada',
        lead: 'Um kernel em C com as diretivas do Vitis HLS é elaborado, escalonado e ligado às unidades da biblioteca sintetizada. A página estima latência, área, LUTs e energia, propaga o erro das unidades aproximadas até as saídas e procura a atribuição de unidades mais barata para um limite de erro. O modelo foi calibrado contra o Vitis HLS e o Vivado 2022.2.',
    },
    lenet: {
        title: 'Rede neural aproximada',
        lead: 'Redes convolucionais quantizadas em 8 bits (LeNet 5 e MiniLenet) classificam 1000 imagens do MNIST, do Fashion MNIST ou da CIFAR 10 com os multiplicadores e somadores da biblioteca, camada por camada, e mostram o efeito na acurácia.',
    },
};

export const sections = [
    {
        id: 'hls-start',
        title: 'Primeiros passos',
        html: `
<ol>
    <li>Escolha um <strong>exemplo</strong> (gaussiano, Sobel, realce, FIR, produto escalar) ou escreva o seu kernel no editor, e clique em <strong>Sintetizar</strong> (ou Ctrl+Enter).</li>
    <li>O <strong>Relatório</strong> mostra a latência, o período alcançável, os recursos e a área e a energia por parte. <strong>Escalonamento</strong> e <strong>DFG</strong> mostram em que ciclo cada operação acontece.</li>
    <li>Na aba <strong>Aproximação</strong>, troque as somas e multiplicações por unidades aproximadas da biblioteca e veja o erro estimado e o medido nas saídas, com as imagens.</li>
    <li>Na aba <strong>Exploração</strong>, defina um objetivo (área, LUTs, energia, latência) e uma restrição de erro (PSNR, MSE ou SSIM), e deixe a busca escolher as unidades.</li>
    <li><strong>IR</strong> mostra o projeto elaborado (laços, trechos, larguras); <strong>Biblioteca</strong> mostra as unidades sintetizadas e permite baixar o Verilog de cada uma.</li>
</ol>
<p class="tip">Para começar: o gaussiano com o período de 5 ns. Na Aproximação, ponha o MUL8 DRUM6 em todas as multiplicações e compare o PSNR estimado com o medido; depois rode a Exploração com PSNR de 40 dB e objetivo em LUTs, com os atrasos do Vivado.</p>
<p>O código, os controles e a aba ficam guardados no navegador. A página de unidades abre uma unidade da biblioteca pelo botão <strong>Abrir na página de unidades</strong>.</p>`,
    },
    {
        id: 'hls-lang',
        title: 'Kernel e diretivas',
        html: `
<p>O kernel é uma função em um subconjunto de C. Os parâmetros vetoriais são as memórias (entrada, saída ou as duas); os escalares não existem, os tamanhos vêm de <code>#define</code>.</p>
<dl>
    <dt>Tipos</dt><dd><code>u8 u16 u32 i8 i16 i32</code>, e os nomes equivalentes (<code>int</code>, <code>unsigned</code>, <code>uint8_t</code>, <code>int16_t</code> ...). Vetores de 1 ou 2 dimensões; tabelas <code>const</code> com valores iniciais viram ROM ou constantes.</dd>
    <dt>Comandos</dt><dd><code>for</code> com limites constantes e rótulo opcional (<code>cols:</code>), atribuições, <code>+=</code> e semelhantes, o operador <code>?:</code>, <code>min</code>, <code>max</code> e <code>abs</code>. Não há <code>if</code> nem <code>while</code>: uma condição vira uma seleção com <code>?:</code>.</dd>
    <dt>Operações</dt><dd>soma, subtração, multiplicação, deslocamento por constante, divisão e resto por potência de 2, operações lógicas e comparações. A largura de cada operação vem da análise de faixas, não só do tipo: um produto de dois valores de 8 bits sem sinal usa o multiplicador de 8 bits mesmo que o acumulador seja <code>u32</code>.</dd>
</dl>
<p>As diretivas são as do Vitis HLS, escritas da mesma forma:</p>
<table>
    <tr><th>Diretiva</th><th>Efeito no modelo</th></tr>
    <tr><td><code>#pragma HLS pipeline II=n</code></td><td>pipeline modular do laço; os laços internos são desenrolados por inteiro. O II final é o maior entre o pedido, o mínimo pelos recursos (portas de memória, unidades limitadas) e o mínimo pela recorrência.</td></tr>
    <tr><td><code>#pragma HLS unroll</code> ou <code>unroll factor=n</code></td><td>replica o corpo do laço (todo ou n vezes). Cada cópia é uma operação nova na aba Aproximação; a Exploração pode tratar as cópias juntas.</td></tr>
    <tr><td><code>#pragma HLS array_partition variable=v type=cyclic|block|complete factor=n dim=d</code></td><td>divide a memória em bancos, cada um com as portas escolhidas em <strong>Portas por banco</strong>. Um fator que não é potência de 2 custa uma divisão por constante no endereço e um resto na escolha do banco.</td></tr>
    <tr><td><code>#pragma HLS allocation operation instances=mul|add limit=n</code></td><td>limita o número de unidades daquela classe; as operações passam a ser compartilhadas, com multiplexadores na entrada.</td></tr>
</table>
<p>A elaboração é uma execução simbólica: desenrola os laços pedidos, dobra as constantes (um produto por uma constante do vetor <code>K</code> vira uma multiplicação por constante), reconhece os índices afins (o que diz o banco de cada acesso), elimina subexpressões comuns e calcula a faixa de cada valor. O resultado aparece na aba IR.</p>`,
    },
    {
        id: 'hls-cost',
        title: 'Relatório: latência, recursos e custo',
        html: `
<p>Os controles abaixo do editor mudam a síntese:</p>
<dl>
    <dt>Período</dt><dd>o relógio alvo. As operações encadeadas num ciclo têm de caber no período menos o tempo do registrador; a operação mais lenta que o período vira uma operação de vários ciclos.</dd>
    <dt>Síntese das unidades</dt><dd>qual dos três fluxos ASIC da biblioteca dá a área, o atraso e a energia de cada unidade (atraso mínimo, área mínima ou iso atraso).</dd>
    <dt>Atrasos</dt><dd><strong>sky130 (ASIC)</strong> usa os atrasos da síntese ASIC para escalonar; <strong>Vivado (FPGA)</strong> usa os atrasos medidos no Vivado com cada unidade entre registradores (<code>data/vivado-units.json</code>). Com os atrasos do Vivado, a multiplicação de 8 bits ocupa um ciclo inteiro a 5 ns, como no Vitis, e o escalonamento fica mais próximo do que o Vitis faz. As LUTs e os CARRY4 vêm do Vivado nos dois casos, quando a caracterização existe.</dd>
    <dt>Portas por banco</dt><dd>1 ou 2 portas em cada banco de memória (no Vitis, <code>ram_1p</code> ou <code>ram_t2p</code>).</dd>
</dl>
<p>O relatório traz o resumo (latência em ciclos e em tempo, intervalo entre resultados, período mínimo, área, LUTs, energia por execução), os <strong>laços</strong> (iterações, II pedido e alcançado, profundidade, latência; um laço achatado aparece como <code>rows_cols</code>, como no Vitis), os <strong>recursos</strong> (unidades por tipo e por instância, multiplexadores, registradores, lógica de memória e de controle) e a <strong>área e energia por parte</strong>.</p>
<p>O custo é uma estimativa antes da síntese, montada a partir de peças medidas:</p>
<ul>
    <li>cada unidade da biblioteca com o custo da sua netlist depois da propagação de constantes: um multiplicador com um operando constante, ou com bits altos que a análise de faixas sabe que são zero, fica menor;</li>
    <li>multiplicação exata por constante como soma de deslocamentos (dígitos em representação com sinal), sem compartilhamento, como o Vitis faz; a mesma regra vale para unidades exatas e aproximadas: somadores não são compartilhados, e as multiplicações entre variáveis só são quando as instâncias compartilhadas com os multiplexadores custam menos;</li>
    <li>multiplexadores na entrada das unidades compartilhadas, registradores pela vida de cada valor (com as cadeias de 3 ou mais estágios em SRL no FPGA), contadores dos laços, endereços e escolha de banco.</li>
</ul>
<p>O quadro <strong>Modelo e limitações</strong>, no fim da aba, lista as hipóteses com os números das células usadas. Nos 59 casos da validação, o erro médio do modelo contra o Vivado é de 0,3% na latência com pipeline, 8% sem pipeline, 15% nas LUTs, 21% nos FFs e cerca de 18% no período (detalhes na seção de validação). Os números servem para comparar projetos entre si; a decisão final pede a síntese completa.</p>`,
    },
    {
        id: 'hls-sched',
        title: 'Escalonamento e DFG',
        html: `
<p>O <strong>Escalonamento</strong> é um diagrama de Gantt de cada trecho (o corpo de um laço depois do desenrolamento): cada coluna é um ciclo, e as operações encadeadas no mesmo ciclo aparecem uma depois da outra na escala do tempo. A faixa clara no fim do ciclo é o tempo do registrador (relógio para a saída e setup). Com pipeline, as linhas verticais marcam o II: as operações de iterações seguintes começam ali.</p>
<p>O <strong>DFG</strong> é o grafo de fluxo de dados do mesmo trecho, em camadas pelo ciclo de início. As caixas mostram a operação e a largura escolhida; a cor indica o tipo (memória, multiplicação, soma, lógica). A aresta tracejada é uma recorrência: o valor que passa de uma iteração para a seguinte, como o acumulador de um FIR, e que limita o II.</p>
<p>Os dois mudam com o período, com os atrasos (ASIC ou FPGA) e com as unidades escolhidas na Aproximação: uma unidade aproximada mais rápida pode caber no mesmo ciclo de outra operação e reduzir a profundidade; uma mais lenta, como o DRUM com o detector do 1 mais alto no caminho, pode pedir um ciclo a mais.</p>`,
    },
    {
        id: 'hls-err',
        title: 'Aproximação e modelo de erro',
        html: `
<p>A tabela de <strong>operações</strong> lista cada soma e multiplicação do DFG depois do desenrolamento. Cada uma pode usar qualquer unidade da biblioteca da sua largura; a linha do grupo troca todas as operações da mesma linha do código, e <strong>Todas exatas</strong> desfaz tudo. As subtrações e as somas com sinal também entram: em complemento de 2, a mesma unidade faz a soma com sinal, e a subtração é calculada como ~(~a + b), sem vem um; só ficam exatas quando o resultado não cabe na largura da unidade. Para cada operação aparecem o erro próprio (o da unidade sobre os operandos reais daquela operação: um multiplicador erra diferente com o coeficiente 19 e com o 52) e o erro que ela sozinha causaria na saída.</p>
<p>Os <strong>dados de entrada</strong> são a imagem de teste, valores uniformes na faixa de cada tipo ou uma imagem sua (PNG, JPEG, PGM ou PPM, convertida para cinza e ajustada ao tamanho do kernel). O <strong>modelo de erro</strong> pode ser:</p>
<ul>
    <li><strong>analítico</strong>: a média e o segundo momento do erro de cada nó são propagados pelas regras de cada operação, com os erros supostos independentes entre si e dos sinais;</li>
    <li><strong>por amostras</strong>: em cada trecho, até 2048 execuções guardadas no perfil exato são refeitas com as unidades aproximadas. As correlações dentro do trecho (o erro que depende dos bits baixos dos operandos, um somador que já zerou os bits baixos) ficam no modelo; o erro que chega de outros trechos entra como ruído com a média e a variância propagadas.</li>
</ul>
<p>Os dois são estáticos: não executam o kernel aproximado inteiro, por isso servem para a busca. Em <strong>Saídas</strong>, cada saída mostra o estimado e o <strong>medido</strong>, este pela execução bit a bit do projeto elaborado com os modelos funcionais das unidades: ME (erro médio), MSE, PSNR e, nas saídas de imagem, o SSIM. As imagens mostram a saída exata, a aproximada e o mapa da diferença.</p>
<h3>SSIM</h3>
<p>O SSIM (${c('wang2004')}) compara brilho, contraste e estrutura em janelas locais e acompanha melhor a percepção que o PSNR: um erro constante pequeno baixa muito o PSNR e quase não muda o SSIM, e um ruído nas bordas faz o contrário. A implementação é a padrão: janela gaussiana 11 × 11 com σ = 1,5, só nas posições em que a janela cabe inteira, K1 = 0,01 e K2 = 0,03.</p>
<p>O SSIM estimado não precisa da imagem aproximada. O modelo por amostras mede a média e a variância do erro em 32 faixas do valor exato da saída; com as médias e variâncias locais da imagem exata, calculadas uma vez, cada janela recebe o erro das faixas dos seus pixels. Assim um erro que se concentra nos valores altos (saturação) ou nas bordas entra onde acontece. A aba mostra o par estimado e medido; a diferença típica nos exemplos é de algumas milésimas (experimento E7 em <code>docs/METODOLOGIA.md</code>).</p>
<p>O quadro <strong>Modelo de erro e verificação</strong>, no fim da aba, descreve as regras de cada operação, as recorrências e a memória.</p>`,
    },
    {
        id: 'hls-dse',
        title: 'Exploração do espaço de projeto',
        html: `
<p>Cada ponto da exploração é uma atribuição de unidades às somas, subtrações e multiplicações, com as diretivas do código e o período do editor. O ponto é sintetizado de novo (compartilhamento, multiplexadores, registradores e II entram no custo), e o erro vem do modelo estático da aba Aproximação, com os mesmos dados de entrada.</p>
<dl>
    <dt>Objetivo</dt><dd>área ASIC, LUT + CARRY4, energia por execução, latência, intervalo entre resultados, ou uma soma ponderada de área, energia e latência, cada uma dividida pela do projeto exato. Para FPGA, use LUTs com os atrasos do Vivado: no FPGA, aproximar somas quase nunca economiza, porque o somador nativo usa a cadeia de carry.</dd>
    <dt>Restrição</dt><dd>PSNR mínimo, MSE máximo ou SSIM mínimo, em todas as saídas. O SSIM só vale quando há uma saída de imagem de 8 bits.</dd>
    <dt>Grupos</dt><dd><em>por operação</em> (padrão): cada operação do DFG, depois do desenrolamento, escolhe a sua unidade; no gaussiano, as 9 multiplicações da linha do acumulador podem ter unidades diferentes, e o coeficiente 52 tolera menos erro que o 19. <em>Por linha do código</em>: todas as operações da mesma linha, da mesma classe e largura, recebem a mesma unidade, como um projetista anotaria à mão. Por operação economiza mais; por linha, o espaço é menor e o resultado mais fácil de ler.</dd>
    <dt>Heurística</dt><dd><em>busca local</em> (padrão), que parte do resultado da eficiência e do ótimo com uma unidade por classe de operação e nunca termina pior que nenhum dos dois; <em>eficiência</em> (a cada passo, a troca com a maior economia por aumento de erro; rápida, mas para em ótimos locais); <em>sequencial</em> (grupo a grupo, na ordem do código); <em>busca tabu</em>, <em>GRASP</em> e <em>algoritmo genético</em>, que partem dos mesmos pontos e terminam com a busca local; ou <em>comparar todas</em>. Nos estudos, a busca local acha o melhor ponto conhecido em 11 de 12 configurações; as outras três ficam perto dela.</dd>
    <dt>Comparação</dt><dd><strong>Adicionar à comparação</strong> guarda a heurística escolhida na fronteira de Pareto; com execuções guardadas, o gráfico mostra só elas e a escolhida da execução atual, para comparar pares (duas heurísticas, ou a mesma com grupos ou restrições diferentes) sem poluir. A segunda execução de uma mesma heurística aparece em outra cor, com a fronteira tracejada. As execuções com outro kernel, objetivo ou alvo ficam fora do gráfico.</dd>
    <dt>Baixar</dt><dd>em cada ponto do resultado e da fronteira, leva o ponto para a aba Aproximação e baixa o projeto para o Vitis HLS e o Vivado (veja a seção de validação).</dd>
</dl>
<p>O melhor ponto de cada heurística é verificado bit a bit; se o erro medido passar do limite, o próximo viável em ordem de custo é verificado. O <strong>passo a passo</strong> reproduz a busca iteração por iteração, com a explicação de cada escolha, e a <strong>fronteira de Pareto</strong> lista os pontos não dominados, com exportação em CSV e JSON. O quadro <strong>Como a exploração funciona</strong> detalha cada heurística. A exaustiva, a aleatória, os grupos por classe e uma lista de períodos continuam na linha de comando, para os estudos.</p>`,
    },
    {
        id: 'hls-vitis',
        title: 'Validação com o Vitis HLS e o Vivado',
        html: `
<p>O script <code>scripts/vitis.mjs</code> escreve cada projeto em C++ para o Vitis HLS 2022.2, com testbench, Tcl e as previsões do modelo. No caso <code>_ir</code>, o C++ é o projeto elaborado pelo simulador (os mesmos laços, diretivas e larguras), então a comparação mede o modelo de custo; no caso <code>_src</code>, vai o código original. A referência de recursos e de período é o Vivado depois do posicionamento e do roteamento (<code>export_design -flow impl</code>), na parte <code>xc7a100tcsg324-1</code>, com multiplicações em LUT.</p>
<p>As unidades aproximadas podem ir ao Vitis de quatro formas:</p>
<table>
    <tr><th>Forma</th><th>Como</th><th>Resultado</th></tr>
    <tr><td><code>_ir</code></td><td>netlist reescrita em C++, função com <code>INLINE off</code></td><td>o Vitis divide a unidade em estágios: mais ciclos e mais FFs</td></tr>
    <tr><td><code>_lat0</code></td><td>a mesma função com <code>LATENCY max=0</code></td><td>unidade combinacional, latência do exato</td></tr>
    <tr><td><code>_inl</code></td><td>a função em linha (<code>INLINE</code>)</td><td>o Vitis otimiza a netlist junto com o resto</td></tr>
    <tr><td><code>_rtl</code></td><td>caixa preta de RTL (<code>add_files -blackbox</code>) com o Verilog da biblioteca</td><td>o Vivado sintetiza exatamente a unidade caracterizada</td></tr>
</table>
<p>A caixa preta de RTL é a forma de referência: é a que reproduz a unidade caracterizada e a que o modelo descreve melhor (a economia prevista erra em média 8,0 pontos percentuais nos 14 projetos medidos assim, contra 16,5 da melhor forma em C++). Na quarta rodada, quatro pontos escolhidos pela exploração com o modelo atual ficaram de 9% a 69% menores que o exato, com a economia prevista a 3,6 pontos da medida, em média; mas o modelo não ordena com segurança pontos vizinhos da fronteira, então vale medir os dois ou três mais baratos. Uma limitação: o Vitis não conhece o atraso da caixa preta e encadeia como se ela fosse instantânea, então o período do Vivado pode piorar (7,0 ns no gaussiano com DRUM6).</p>
<p>Na página, <strong>Baixar projeto (Vitis HLS)</strong>, na aba Aproximação, e <strong>Baixar</strong>, em cada ponto da exploração, geram um .zip com o projeto da atribuição: o kernel elaborado (<code>kernel.cpp</code>, <code>kernel.h</code>), cada unidade como caixa preta de RTL com o seu invólucro (<code>u_*_bb.v</code>, com a netlist e o módulo com as portas que o Vitis exige, o JSON e o modelo C para a csim), o testbench com as entradas e a saída esperada da execução bit a bit, o <code>run.tcl</code> (csim e csynth; com <code>AXC_IMPL=1</code>, também o Vivado), as previsões do modelo (<code>model.json</code>) e um <code>LEIAME.txt</code> com os comandos.</p>
<p>Nos 59 casos das quatro rodadas, a csim do Vitis dá a mesma saída que a execução bit a bit do simulador em todas as posições. Os relatórios ficam em <code>results/vitis/</code>, e <code>node scripts/vitis.mjs compare</code> refaz a comparação com o modelo atual sem precisar do Vitis. A análise completa, rodada a rodada, está em <code>docs/METODOLOGIA.md</code>, seção 6.</p>`,
    },
    {
        id: 'hls-cli',
        title: 'Linha de comando e reprodução',
        html: `
<p>Tudo o que a página faz existe na linha de comando, com o Node, para estudos maiores e reprodutíveis:</p>
<pre>node bin/axc.mjs hls --example gauss --approx "mul8=MUL8 DRUM6" --error --json
node bin/axc.mjs dse kernel.c --psnr 40 --heuristic all --granularity source --csv
npm run experiments          # estudos de caso E1 a E7, saída em results/
npm run vitis:export         # projetos para o Vitis HLS, em build/vitis/
npm run vivado:units         # caracterização das unidades no Vivado</pre>
<p>Os experimentos escrevem um CSV por estudo, as tabelas em Markdown e em LaTeX e os metadados (data, commit, versões). As sementes, os dados e a biblioteca estão no repositório: o mesmo commit dá os mesmos números. As hipóteses, as ameaças à validade e o passo a passo da validação estão em <code>docs/METODOLOGIA.md</code>.</p>`,
    },
    {
        id: 'nn-start',
        title: 'Primeiros passos',
        html: `
<ol>
    <li>Escolha o <strong>modelo</strong>: a MiniLenet ou a LeNet 5, no MNIST, no Fashion MNIST ou na CIFAR 10 (a MiniLenet do MNIST vem do código C para o Vitis). O diagrama da arquitetura, embaixo da matriz de confusão, mostra as camadas e as formas dos tensores.</li>
    <li>Escolha o <strong>multiplicador</strong> e, se quiser, o <strong>somador das acumulações</strong> entre as unidades da biblioteca. Da página de unidades, o botão <strong>Usar na LeNet-5</strong> abre esta página com a unidade de lá.</li>
    <li>Marque as <strong>camadas</strong> que usam as unidades aproximadas; as outras ficam exatas.</li>
    <li>A cada mudança, a página classifica as imagens de novo e mostra a acurácia nas 1000 imagens, contra a da rede exata, a matriz de confusão e as imagens que passaram a errar.</li>
    <li>O botão de <strong>sensibilidade</strong> aproxima uma camada por vez e mostra quanto cada uma custa em acurácia e quantas multiplicações ela faz.</li>
</ol>
<p class="tip">Para começar: o MUL8 Mitchell em todas as camadas quase não muda a acurácia das duas redes; com a compensação do viés, embora o erro médio da unidade seja menor, a LeNet 5 cai para 82% e a MiniLenet, menor, para 49%.</p>`,
    },
];

/** Seções comuns às três páginas. */
export const common = [
    {
        id: 'figs',
        title: 'Exportar figuras',
        html: `
<p>Passe o mouse sobre qualquer gráfico, diagrama ou imagem: aparecem os botões <strong>SVG</strong> e <strong>PNG</strong> no canto da figura. O SVG sai com as cores e as fontes escritas em cada elemento, sempre no tema claro e com fundo branco, pronto para um editor de vetores ou para o LaTeX (pelo Inkscape ou pelo pacote <code>svg</code>). O PNG sai no dobro da resolução da tela.</p>
<p>Os mapas de calor e as imagens são desenhados pixel a pixel (canvas): o SVG deles leva a imagem embutida, sem suavização, e o PNG tem o tamanho original. O nome do arquivo vem do título ou da legenda mais próxima da figura.</p>`,
    },
    {
        id: 'pages',
        title: 'As três páginas',
        html: `
<dl>
    <dt><a href="./index.html">Unidades</a></dt><dd>um somador ou multiplicador aproximado porta a porta: estrutura, mapa de erro, métricas, custo, Pareto, tensão e memória, computação estocástica.</dd>
    <dt><a href="./lenet.html">Rede neural</a></dt><dd>a LeNet 5 e a MiniLenet no MNIST com as unidades da biblioteca, camada por camada, e o diagrama da arquitetura.</dd>
    <dt><a href="./hls.html">Síntese de alto nível</a></dt><dd>kernels inteiros em C com diretivas: escalonamento, custo, erro nas saídas, exploração e a biblioteca sintetizada.</dd>
</dl>
<p>Cada página tem a sua ajuda, no botão <strong>Ajuda</strong> do cabeçalho; as referências são as mesmas.</p>`,
    },
];
