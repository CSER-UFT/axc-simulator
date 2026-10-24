#!/usr/bin/env bash
# Lote de calibração (Vitis HLS e Vivado 2022.2), para rodar sem acompanhar: as redes (busca, exportação, Vitis,
# Vivado e a comparação com o modelo) e a quinta rodada dos kernels de imagem. No fim, um pacote só com os relatórios
# em ~/Downloads/fds_resultados.tar.gz.
#
# Uso, da pasta do repositório (com o Vitis no PATH: source /tools/Xilinx/Vitis_HLS/2022.2/settings64.sh):
#   nohup bash scripts/fim-de-semana.sh > build/fds.log 2>&1 &
# Variáveis: J (projetos em paralelo, padrão 3; com 16 GB de memória, 3 é o máximo seguro). Rodar de novo continua
# de onde parou: cada etapa terminada deixa uma marca em build/fds/.
set -u
cd "$(dirname "$0")/.."
J=${J:-3}
OUT=build/fds
mkdir -p "$OUT"
log() { echo "[$(date '+%d/%m %H:%M')] $*"; }
feito() { [ -f "$OUT/.$1" ]; }
marca() { touch "$OUT/.$1"; }
command -v vitis_hls >/dev/null || { echo "vitis_hls não está no PATH (source /tools/Xilinx/Vitis_HLS/2022.2/settings64.sh)"; exit 1; }
log "início (J=$J)"

# 1. Redes: a busca de cada modelo (unidades por camada, queda de 1 ponto, todas as imagens da validação) e os
#    projetos exato e aproximado; a MiniLenet também com partição nas duas convoluções.
for m in minilenet-mnist lenet5-cifar10; do
  if ! feito "busca_$m"; then
    log "busca: $m"
    node bin/axc.mjs nnsearch --model "$m" --json > "$OUT/busca_$m.json" && marca "busca_$m"
  fi
  if ! feito "exp_$m"; then
    log "exportação: $m"
    node bin/axc.mjs nnexport --model "$m" --out "$OUT/${m}_exata" --images 100 \
      && node bin/axc.mjs nnexport --search "$OUT/busca_$m.json" --out "$OUT/${m}_aprox" --images 100 \
      && marca "exp_$m"
  fi
done
if ! feito "exp_part"; then
  node bin/axc.mjs nnexport --model minilenet-mnist --dirs "conv1:part;conv2:part" --out "$OUT/minilenet-mnist_part" --images 100 && marca "exp_part"
fi
# A partição por último: a conv2 leva cerca de 1 h só no escalonamento do Vitis.
for d in minilenet-mnist_exata minilenet-mnist_aprox lenet5-cifar10_exata lenet5-cifar10_aprox minilenet-mnist_part; do
  feito "vitis_$d" && continue
  log "Vitis e Vivado: $d"
  bash "$OUT/$d/run_all.sh" -j "$J" --impl --timeout 4h
  node bin/axc.mjs nnvitis "$OUT/$d" > /dev/null && marca "vitis_$d"
done

# 2. Kernels de imagem: a quinta rodada (todos os casos de scripts/vitis.mjs, inclusive as subtrações aproximadas).
if ! feito kernels_export; then log "kernels: exportação"; node scripts/vitis.mjs export && marca kernels_export; fi
if ! feito kernels_run; then log "kernels: Vitis e Vivado"; bash build/vitis/run_all.sh -j "$J" --impl && marca kernels_run; fi
if ! feito kernels_collect; then log "kernels: coleta"; node scripts/vitis.mjs collect > /dev/null && marca kernels_collect; fi

# 3. Pacote: só os relatórios (sem as pastas proj do Vitis).
log "pacote"
find "$OUT" results/vitis \( -name RESULTADOS.md -o -name resultados.json -o -name model.json -o -name summary.json \
  -o -name 'busca_*.json' -o -name vitis_hls.log -o -name '*_csynth.xml' -o -name csynth.xml -o -name '*_csim.log' \
  -o -name '*utilization_hierarchical_routed.rpt' -o -name export_impl.xml -o -name impl.xml -o -name utilization.rpt \) \
  -print | tar czf ~/Downloads/fds_resultados.tar.gz -T -
log "fim: ~/Downloads/fds_resultados.tar.gz ($(du -h ~/Downloads/fds_resultados.tar.gz | cut -f1))"
