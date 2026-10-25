#!/usr/bin/env bash
# Rodada 5 das redes: só as aproximadas (as unidades da busca do fim de semana, results/nn-vitis/busca_*.json), com
# o produto aproximado chamado uma vez só (antes, a chamada nos dois ramos do sinal fazia o Vitis ler a tabela de
# pesos três vezes por produto e triplicava o II das convoluções). Pacote em ~/Downloads/r5_resultados.tar.gz.
#
# Uso, da pasta do repositório (com o Vitis no PATH: source /tools/Xilinx/Vitis_HLS/2022.2/settings64.sh):
#   nohup bash scripts/rodada-aprox.sh > build/r5.log 2>&1 &
# J: projetos em paralelo (padrão 3). Rodar de novo continua de onde parou.
set -u
cd "$(dirname "$0")/.."
J=${J:-3}
OUT=build/r5
mkdir -p "$OUT"
log() { echo "[$(date '+%d/%m %H:%M')] $*"; }
feito() { [ -f "$OUT/.$1" ]; }
marca() { touch "$OUT/.$1"; }
command -v vitis_hls >/dev/null || { echo "vitis_hls não está no PATH (source /tools/Xilinx/Vitis_HLS/2022.2/settings64.sh)"; exit 1; }
log "início (J=$J)"
for m in minilenet-mnist lenet5-cifar10; do
  d="${m}_aprox"
  if ! feito "exp_$d"; then
    log "exportação: $d"
    node bin/axc.mjs nnexport --search "results/nn-vitis/busca_$m.json" --out "$OUT/$d" --images 100 && marca "exp_$d"
  fi
  if ! feito "vitis_$d"; then
    log "Vitis e Vivado: $d"
    bash "$OUT/$d/run_all.sh" -j "$J" --impl --timeout 4h
    node bin/axc.mjs nnvitis "$OUT/$d" > /dev/null && marca "vitis_$d"
  fi
done
log "pacote"
find "$OUT" \( -name RESULTADOS.md -o -name resultados.json -o -name model.json -o -name kernel.cpp -o -name vitis_hls.log \
  -o -name '*_csynth.xml' -o -name csynth.xml -o -name '*_csim.log' -o -name '*utilization_hierarchical_routed.rpt' \
  -o -name export_impl.xml \) -print | tar czf ~/Downloads/r5_resultados.tar.gz -T -
log "fim: ~/Downloads/r5_resultados.tar.gz ($(du -h ~/Downloads/r5_resultados.tar.gz | cut -f1))"
