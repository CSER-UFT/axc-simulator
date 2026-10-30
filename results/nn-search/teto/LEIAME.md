# Teto de economia das unidades aproximadas

Gerado por `node bin/axc.mjs nnceiling --models all --md` (diretivas padrão, 10 ns). Sem olhar a acurácia: a fração
do custo da rede exata que está nos multiplicadores e somadores das camadas com pesos, e a economia com a unidade mais
barata da biblioteca em cada camada (117 multiplicadores de 8 bits e 127 somadores de 32 bits), também só com os
multiplicadores e só com os somadores. As candidatas da busca sempre incluem a unidade mais barata de cada camada,
então o teto das candidatas (o que o nnsearch e o nnbench mostram) é o mesmo.

| modelo | objetivo | fração aritmética % | teto % | só multiplicadores % | só somadores % | teto por camada % |
| --- | --- | --- | --- | --- | --- | --- |
| minilenet-mnist | area | 34.9 | 35.2 | 14.6 | 20.8 | conv1 25.7, conv2 32.6, fc1 9.0, fc2 8.5 |
| minilenet-mnist | luts | 46.8 | 46.0 | 21.1 | 29.0 | conv1 56.2, conv2 49.2, fc1 54.7, fc2 56.6 |
| minilenet-mnist | energy | 6.8 | 6.7 | 4.0 | 3.0 | conv1 10.8, conv2 4.3, fc1 33.9, fc2 34.7 |
| lenet5-mnist | area | 36.7 | 36.9 | 14.7 | 22.4 | conv1 25.6, conv2 34.8, fc1 9.1, fc2 8.5, fc3 8.5 |
| lenet5-mnist | luts | 47.9 | 46.9 | 20.4 | 30.9 | conv1 55.5, conv2 46.5, fc1 56.6, fc2 58.9, fc3 58.6 |
| lenet5-mnist | energy | 3.0 | 3.5 | 2.3 | 1.8 | conv1 10.7, conv2 2.5, fc1 34.5, fc2 35.2, fc3 35.0 |
| minilenet-fashion | area | 34.8 | 35.1 | 14.6 | 20.7 | conv1 25.5, conv2 32.5, fc1 9.0, fc2 8.5 |
| minilenet-fashion | luts | 46.7 | 45.9 | 21.1 | 28.9 | conv1 56.1, conv2 49.2, fc1 54.7, fc2 56.6 |
| minilenet-fashion | energy | 6.7 | 6.6 | 4.0 | 3.0 | conv1 10.9, conv2 4.2, fc1 33.9, fc2 34.8 |
| lenet5-fashion | area | 36.6 | 36.7 | 14.6 | 22.3 | conv1 25.6, conv2 34.7, fc1 9.0, fc2 8.5, fc3 8.5 |
| lenet5-fashion | luts | 47.9 | 46.9 | 20.4 | 30.9 | conv1 55.4, conv2 46.5, fc1 56.6, fc2 58.9, fc3 58.6 |
| lenet5-fashion | energy | 2.9 | 3.5 | 2.2 | 1.8 | conv1 10.7, conv2 2.5, fc1 34.4, fc2 35.0, fc3 35.0 |
| minilenet-cifar10 | area | 36.0 | 36.2 | 14.4 | 22.0 | conv1 32.6, conv2 32.5, fc1 9.0, fc2 8.5 |
| minilenet-cifar10 | luts | 46.9 | 46.1 | 20.2 | 30.3 | conv1 49.1, conv2 49.0, fc1 58.4, fc2 59.9 |
| minilenet-cifar10 | energy | 4.4 | 4.9 | 3.0 | 2.3 | conv1 4.3, conv2 4.2, fc1 33.8, fc2 35.3 |
| lenet5-cifar10 | area | 37.1 | 37.3 | 14.5 | 23.0 | conv1 32.5, conv2 34.5, fc1 9.0, fc2 8.5, fc3 8.5 |
| lenet5-cifar10 | luts | 49.8 | 48.7 | 20.8 | 32.7 | conv1 54.5, conv2 46.5, fc1 56.6, fc2 58.9, fc3 58.6 |
| lenet5-cifar10 | energy | 2.7 | 3.4 | 2.2 | 1.8 | conv1 4.2, conv2 2.4, fc1 33.8, fc2 34.6, fc3 34.6 |

Leitura:

1. Energia: o teto é de 3% a 7% em todas as redes. Com as diretivas padrão, a energia por imagem é quase toda dos
   registradores de pipeline (na conv2 da MiniLenet, as operações são 0,43 de 11,6 nJ); aproximar a aritmética quase
   não muda a energia nesta arquitetura. As camadas densas têm teto próprio maior (cerca de 34%), mas pesam pouco no
   total.
2. Área e LUT: o teto é de 35% a 37% em área e de 46% a 49% em LUT. As buscas chegam a cerca de 9% a 15% (um terço
   do teto em área, um quarto a um terço em LUT; results/nn-search/etapa3 e 2026-10-26-01-00). O teto só é atingido
   com unidades degeneradas (as mais baratas zeram a saída), então a distância até ele não é toda alcançável, mas há
   espaço que a acurácia, e não a arquitetura, está limitando. É onde a correção do viés (etapa 6) pode ajudar.
3. Os somadores pesam mais que os multiplicadores no teto (20% a 33% contra 14% a 21%): com o pipeline da janela, a
   soma em árvore tem muitos somadores de 16 e 24 bits por camada, e um ou dois multiplicadores.
