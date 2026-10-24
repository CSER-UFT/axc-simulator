/**
 * Exportação de uma rede (formato axc-nn/1) para o Vitis HLS 2022.2 e o Vivado, com as diretivas e as unidades de
 * cada camada:
 *
 *   network/        a rede inteira: uma função por camada (o projeto elaborado de cada kernel, js/hls/vitis.js,
 *                   exportFunction, com INLINE off para cada uma ter o seu relatório) e o topo network(), que chama as
 *                   camadas em sequência com vetores locais entre elas, como o código C da MiniLenet. A partição de
 *                   cada vetor entre duas camadas é uma só: por dimensão, vale a da camada que lê (a escrita fica com
 *                   ela também), e o LEIAME lista o que a camada que escreve pedia diferente. O testbench passa N
 *                   imagens de teste e confere todas as saídas com a execução bit a bit do simulador, e a acurácia;
 *   layers/<nome>/  cada camada sozinha, com as suas partições (o que o modelo de custo supõe): o projeto de um
 *                   kernel da página de síntese (projectFiles), com a imagem 0 como entrada;
 *   run_all.sh      roda o Vitis em todos (com -j, --impl e --cosim), e LEIAME.txt.
 *
 * As unidades aproximadas entram como caixa preta de RTL (o Verilog da netlist com o invólucro que o Vitis pede), ou
 * como C++ da netlist (inline: false), e a reescala (requant) como uma função com a multiplicação em DSP.
 */
import { costModel, normalizeDirectives } from './nngen.js';
import { inputActivations } from './nn.js';
import { exportFunction, unitsCode, seqUnitsCode, REQUANT_CPP, projectFiles, blackboxFiles, tclScript, prediction } from '../hls/vitis.js';
import { execute, inputArrays, outputArrays } from '../hls/exec.js';
import { opFunction } from '../hls/approx.js';

const arrType = (t) => (t.signed ? `ap_int<${t.bits}>` : `ap_uint<${t.bits}>`);
const HEADER = (what) => `// ${what}: gerado pelo axc-simulator (js/axc/nnexport.js). Não editar: a exportação gera de novo.
#include <ap_int.h>
`;

/** Funções aproximadas de cada operação atribuída (para a execução bit a bit). */
function opsOf(r) {
    return new Map([...r.assign].map(([id, name]) => [id, opFunction(r.lib, r.ops.byId.get(id), name)]));
}

/** Executa os kernels em sequência (a entrada do primeiro: x). Devolve a saída de cada um. */
function runKernels(ks, x) {
    const outs = [];
    let cur = x;
    for (const k of ks) {
        const d = k.result.design;
        const [inA] = inputArrays(d), [outA] = outputArrays(d);
        const res = execute(d, new Map([[inA.name, Float64Array.from(cur)]]), { ops: k.ops });
        outs.push({ inName: inA.name, input: Float64Array.from(cur), res });
        cur = res.mem.get(outA.name);
    }
    return outs;
}

/**
 * Arquivos do projeto da rede.
 * @param {object} net rede decodificada
 * @param {{synth, cells, fpga?, target?: string, flow?: string, clockNs?: number, dirs?: object[], units?: object[],
 *          test: object, images?: number, part?: string, id?: string, layers?: boolean, progress?: function}} o
 *   units: {mul, add} de cada camada com pesos (nomes da biblioteca; null: exata); test: conjunto de teste
 *   (decodeTestSet); images: quantas imagens o testbench da rede confere; layers: também os projetos por camada
 * @returns {{files: Record<string, string>, summary: object}}
 */
export function networkProject(net, o) {
    const clockNs = o.clockNs ?? 10, part = o.part ?? 'xc7a100tcsg324-1', target = o.target ?? 'fpga';
    const dirs = normalizeDirectives(net, o.dirs);
    const units = net.sites.map((_, si) => ({ mul: o.units?.[si]?.mul ?? null, add: o.units?.[si]?.add ?? null }));
    const id = o.id ?? `${net.id}_${String(clockNs).replace('.', 'p')}ns`;
    const progress = o.progress ?? (() => {});
    const cm = costModel(net, { synth: o.synth, cells: o.cells, fpga: o.fpga, target, flow: o.flow ?? 'delay', clockNs, dirs });
    const cost = cm.network(units);
    const ks = cm.kernels.map((k, i) => {
        const row = cost.layers[i];
        return { ...k, row, result: row.result, ops: opsOf(row.result) };
    });
    const files = {};
    const warnings = [...cost.warnings], partitionNotes = [];

    // Vetores entre as camadas: a saída de uma é a entrada da seguinte (mesmas dimensões e tipo).
    const params = ks.map((k) => {
        const d = k.result.design;
        return { x: d.arrays.find((a) => a.name === inputArrays(d)[0].name), y: d.arrays.find((a) => a.name === outputArrays(d)[0].name) };
    });
    for (let i = 1; i < ks.length; i++) {
        const a = params[i - 1].y, b = params[i].x;
        if (a.dims.join('x') !== b.dims.join('x')) throw new Error(`${ks[i - 1].name} -> ${ks[i].name}: ${a.dims.join('x')} e ${b.dims.join('x')}`);
    }
    // Partição de cada vetor: por dimensão, a da camada que lê; a da que escreve só onde a que lê não pede nada.
    const partitions = [];
    const merge = (writer, reader, label) => {
        const byDim = new Map();
        for (const p of writer?.partitions ?? []) byDim.set(p.dim, { ...p, from: 'w' });
        for (const p of reader?.partitions ?? []) {
            const w = byDim.get(p.dim);
            if (w && (w.type !== p.type || w.factor !== p.factor)) partitionNotes.push(`${label}: dim=${p.dim} ${p.type} ${p.factor} (leitura) no lugar de ${w.type} ${w.factor} (escrita)`);
            byDim.set(p.dim, { ...p, from: 'r' });
        }
        if (byDim.has(0) && byDim.size > 1) { const z = byDim.get(0); byDim.clear(); byDim.set(0, z); }
        return [...byDim.values()].sort((a, b) => a.dim - b.dim);
    };
    const tensors = ks.map((k, i) => ({
        name: i === ks.length - 1 ? 'out' : `t${i + 1}`,
        arr: params[i].y,
        parts: merge(params[i].y, i + 1 < ks.length ? params[i + 1].x : null, `${k.name} -> ${ks[i + 1]?.name ?? 'saída'}`),
    }));
    const input = { name: 'in', arr: params[0].x, parts: merge(null, params[0].x, `entrada -> ${ks[0].name}`) };
    const decl = (t) => `${arrType(t.arr.type)} ${t.name}[${t.arr.dims.join('][')}]`;
    const partLines = (t) => t.parts.map((p) => `#pragma HLS ARRAY_PARTITION variable=${t.name} type=${p.type}${p.type !== 'complete' ? ` factor=${p.factor}` : ''} dim=${p.dim}`);

    // C++ das camadas e do topo.
    const fns = ks.map((k) => exportFunction(k.result, { interfaces: false, paramPartitions: false, romStorage: 'bram' }));
    const usedUnits = [...new Set(fns.flatMap((f) => f.units))];
    // Na rede, as unidades vão como a netlist em C++ (INLINE off): com a mesma caixa preta de RTL chamada de duas
    // funções (o MUL8 T6 A10c na conv1 e na fc1), o Vitis 2022.2 gerou uma instância com a porta ap_ready, que o
    // invólucro não tem, e a síntese do Vivado falhou (Synth 8-448). Nos projetos por camada ficam as caixas pretas.
    const inline = o.inline ?? false;
    const layerCode = fns.map((f) => f.code.replace(/^(void [^\n]*\{)\n/, '$1\n#pragma HLS INLINE off\n'));
    const top = `void network(${decl(input)}, ${decl(tensors.at(-1))})`;
    const kernelCpp = [
        HEADER(`${net.name}: a rede inteira (${ks.length} funções)`),
        '#include "kernel.h"',
        '',
        unitsCode(ks[0].result.lib, usedUnits, inline),
        '',
        seqUnitsCode(ks[0].result.lib, [...new Set(fns.flatMap((f) => f.seqUnits))]),
        '',
        fns.some((f) => f.requant) ? REQUANT_CPP : '',
        '',
        ...layerCode,
        `// Topo: as camadas em sequência, com os vetores entre elas (sem dataflow, como no código C da MiniLenet).`,
        `${top} {`,
        '#pragma HLS INTERFACE mode=ap_memory port=in storage_type=ram_t2p',
        '#pragma HLS INTERFACE mode=ap_memory port=out storage_type=ram_t2p',
        ...partLines(input),
        ...partLines(tensors.at(-1)),
        ...tensors.slice(0, -1).flatMap((t) => [`    ${decl(t)};`, ...partLines(t)]),
        ...ks.map((k, i) => `    ${k.name}(${i === 0 ? 'in' : tensors[i - 1].name}, ${tensors[i].name});`),
        '}',
        '',
    ].join('\n');

    // Testbench: N imagens, a saída esperada pela execução bit a bit dos mesmos kernels.
    const N = Math.min(o.images ?? 100, o.test.n);
    const outA = tensors.at(-1).arr, inA = input.arr;
    const imgs = [], exps = [], labels = [];
    let right = 0;
    for (let k = 0; k < N; k++) {
        const x = inputActivations(net, o.test.images.subarray(k * o.test.size, (k + 1) * o.test.size));
        const runs = runKernels(ks, x);
        const y = runs.at(-1).res.mem.get(outputArrays(ks.at(-1).result.design)[0].name);
        imgs.push(Array.from(x).join(' '));
        exps.push(Array.from(y).join(' '));
        labels.push(o.test.labels[k]);
        let p = 0;
        for (let j = 1; j < y.length; j++) if (y[j] > y[p]) p = j;
        if (p === o.test.labels[k]) right++;
        if (k === 0) ks.forEach((kk, i) => { kk.first = runs[i]; });
        progress(k + 1, N);
    }
    if (inA.size !== o.test.size && inA.size !== ks[0].first.input.length) throw new Error('entrada da rede com tamanho inesperado');
    const flat = (name, a) => `(&${name}${a.dims.map(() => '[0]').join('')})`;
    const tb = `// Testbench da rede ${net.name}: ${N} imagens de teste; confere cada saída com a execução bit a bit do
// axc-simulator (os mesmos kernels e unidades) e conta os acertos.
#include <cstdio>
#include "kernel.h"

static ${decl(input)};
static ${decl(tensors.at(-1))};

int main() {
    FILE *fi = fopen("images.dat", "r"), *fe = fopen("expected.dat", "r"), *fl = fopen("labels.dat", "r");
    if (!fi || !fe || !fl) { printf("AXC_ERROR sem images.dat, expected.dat ou labels.dat\\n"); return 2; }
    int bad = 0, total = 0, right = 0;
    for (int k = 0; k < ${N}; k++) {
        for (int i = 0; i < ${inA.size}; i++) { long long v; if (fscanf(fi, "%lld", &v) != 1) { printf("AXC_ERROR images.dat\\n"); return 2; } ${flat('in', inA)}[i] = v; }
        network(in, out);
        long long best = 0;
        int pred = 0;
        for (int j = 0; j < ${outA.size}; j++) {
            long long v; if (fscanf(fe, "%lld", &v) != 1) { printf("AXC_ERROR expected.dat\\n"); return 2; }
            long long got = ${flat('out', outA)}[j];
            total++;
            if (got != v) { if (bad < 5) printf("diferente: imagem %d, saída %d = %lld, esperado %lld\\n", k, j, got, v); bad++; }
            if (j == 0 || got > best) { best = got; pred = j; }
        }
        int label; if (fscanf(fl, "%d", &label) != 1) { printf("AXC_ERROR labels.dat\\n"); return 2; }
        if (pred == label) right++;
    }
    fclose(fi); fclose(fe); fclose(fl);
    printf("AXC_MISMATCHES %d OF %d\\n", bad, total);
    printf("AXC_ACCURACY %d OF %d\\n", right, ${N});
    return bad ? 1 : 0;
}
`;
    const net_ = {};
    net_['kernel.h'] = `${HEADER(`${net.name}: tipos e o topo`)}#ifndef AXC_KERNEL_H
#define AXC_KERNEL_H
typedef ap_uint<8> u8;
typedef ap_uint<16> u16;
typedef ap_uint<32> u32;
typedef ap_int<8> i8;
typedef ap_int<16> i16;
typedef ap_int<32> i32;
${top};
#endif
`;
    net_['kernel.cpp'] = kernelCpp;
    net_['tb.cpp'] = tb;
    net_['images.dat'] = `${imgs.join('\n')}\n`;
    net_['expected.dat'] = `${exps.join('\n')}\n`;
    net_['labels.dat'] = `${labels.join('\n')}\n`;
    let bbs = [];
    if (usedUnits.length && inline === 'rtl') { const bb = blackboxFiles(ks[0].result.lib, usedUnits); Object.assign(net_, bb.files); bbs = bb.jsons; }
    const note = `${net.name}, ${unitsText(net, units)}`;
    net_['run.tcl'] = tclScript({ id: `${id}_network`, note, clockNs }, 'network', part, ['images.dat', 'expected.dat', 'labels.dat'], bbs, { autoPartition: false });
    const layerPred = ks.map((k) => ({ name: k.name, type: k.type, site: k.site, mul: k.row.mul, add: k.row.add, cycles: k.row.cycles, II: k.row.II, luts: k.row.luts, carry4: k.row.carry4, ff: k.row.ff, dsp: k.row.dsp, area: k.row.area, energy: k.row.energy, prediction: prediction(k.result) }));
    const summary = {
        id, model: net.id, name: net.name, clockNs, part, target, dirs, units, images: N, accuracySim: right / N,
        totals: cost.totals, layers: layerPred, warnings: [...new Set(warnings)], partitionNotes,
    };
    net_['model.json'] = `${JSON.stringify(summary, null, 1)}\n`;
    for (const [f, c] of Object.entries(net_)) files[`network/${f}`] = c;

    // Projetos por camada: cada kernel sozinho, com as suas partições, a entrada da imagem 0.
    const names = ['network'];
    if (o.layers !== false) {
        for (const k of ks) {
            const exp = k.first.res;
            const lf = projectFiles(k.result, { inputs: new Map([[k.first.inName, k.first.input]]), expected: exp, part, clockNs, id: `${id}_${k.name}`, note: `${net.name}, camada ${k.name}${k.site !== null ? `, ${unitsText(net, [units[k.site]], [k.name])}` : ''}`, target, tcl: { autoPartition: false }, romStorage: 'bram' });
            for (const [f, c] of Object.entries(lf)) files[`layers/${k.name}/${f}`] = c;
            names.push(`layers/${k.name}`);
        }
    }
    files['run_all.sh'] = runAll(names);
    files['LEIAME.txt'] = readme(summary, names, inline);
    return { files, summary };
}

const unitsText = (net, units, names = net.sites.map((l) => l.name)) => {
    const parts = units.map((u, i) => (u && (u.mul || u.add) ? `${names[i]}: ${[u.mul, u.add].filter(Boolean).join(' + ')}` : null)).filter(Boolean);
    return parts.length ? parts.join('; ') : 'unidades exatas';
};

function runAll(names) {
    return `#!/usr/bin/env bash
# Roda o Vitis HLS em cada projeto desta pasta (gerados pelo axc-simulator).
# Uso: bash run_all.sh [-j N] [--impl] [--cosim] [--autopart] [--timeout 3h] [--only network,layers/conv1]
# --timeout: limite de cada projeto (padrão 3h; o formato do comando timeout: 90m, 2h ...). Com -j, cada projeto
#   grande usa de 3 a 4 GB de memória no Vivado: com 16 GB, -j 3 é o máximo seguro.
# --autopart: deixa o Vitis particionar sozinho os vetores (o padrão é só com as partições das diretivas).
# Depois, para comparar com o modelo: node bin/axc.mjs nnvitis <esta pasta> (na pasta do axc-simulator).
set -u
cd "$(dirname "$0")"
J=1; IMPL=0; COSIM=0; AUTOPART=0; ONLY=""; TMAX=3h
while [ $# -gt 0 ]; do
  case "$1" in
    -j) J="$2"; shift 2 ;;
    --impl) IMPL=1; shift ;;
    --cosim) COSIM=1; shift ;;
    --autopart) AUTOPART=1; shift ;;
    --timeout) TMAX="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "opção desconhecida: $1"; exit 1 ;;
  esac
done
command -v vitis_hls >/dev/null || { echo "vitis_hls não está no PATH (source /tools/Xilinx/Vitis_HLS/2022.2/settings64.sh)"; exit 1; }
CASES="${names.join(' ')}"
if [ -n "$ONLY" ]; then CASES="$(echo "$ONLY" | tr ',' ' ')"; fi
run_one() {
  c="$1"
  echo "[$(date +%H:%M:%S)] $c"
  ( cd "$c" && AXC_IMPL=$IMPL AXC_COSIM=$COSIM AXC_AUTOPART=$AUTOPART timeout -k 60 "$TMAX" vitis_hls -f run.tcl > vitis_hls.log 2>&1 )
  st=$?
  if [ $st -eq 0 ]; then echo "[$(date +%H:%M:%S)] $c pronto"
  elif [ $st -eq 124 ] || [ $st -eq 137 ]; then
    # Passou do limite: encerra também o Vivado que o Vitis abriu para este projeto.
    pkill -f "$(pwd)/$c/proj" 2>/dev/null
    echo "[$(date +%H:%M:%S)] $c PASSOU DO LIMITE de $TMAX (veja $c/vitis_hls.log; --timeout muda o limite)"
  else echo "[$(date +%H:%M:%S)] $c FALHOU (veja $c/vitis_hls.log)"; fi
}
export -f run_one; export IMPL COSIM AUTOPART TMAX
echo "$CASES" | tr ' ' '\\n' | xargs -P "$J" -I{} bash -c 'run_one {}'
`;
}

function readme(s, names, inline) {
    const L = s.layers;
    const row = (l) => `  ${l.name.padEnd(9)} ${String(l.cycles).padStart(9)} ${String(l.II ?? '-').padStart(4)} ${String(l.luts).padStart(7)} ${String(l.ff).padStart(7)} ${String(l.dsp).padStart(4)}  ${l.site !== null ? [l.mul ?? 'MUL8 exato', l.add ?? 'ADD32 exato'].join(' + ') : ''}`;
    return `Rede ${s.name} (${s.model}) para o Vitis HLS 2022.2 e o Vivado: gerado pelo axc-simulator
(https://github.com/CSER-UFT/axc-simulator), período de ${s.clockNs} ns, parte ${s.part}.

Pastas
  network/          a rede inteira: kernel.cpp tem uma função por camada (INLINE off, cada uma com o seu relatório)
                    e o topo network(), que as chama em sequência; o testbench passa ${s.images} imagens de teste e
                    confere todas as saídas com a execução bit a bit do simulador (AXC_MISMATCHES) e conta os acertos
                    (AXC_ACCURACY; no simulador, ${(100 * s.accuracySim).toFixed(1).replace(".", ",")}%).
${names.length > 1 ? `  layers/<camada>/  cada camada sozinha, com as suas partições (o que o modelo de custo supõe), e a imagem 0
                    como entrada.
` : ''}  run_all.sh        roda todos: bash run_all.sh -j 4 --impl (com o Vivado: posicionamento e roteamento).

Depois de rodar, na pasta do axc-simulator: node bin/axc.mjs nnvitis <esta pasta>
(compara os relatórios com as previsões de model.json e grava RESULTADOS.md aqui).

Diretivas: ${s.dirs.map((d, i) => `${s.layers.filter((l) => l.site !== null)[i].name} ${d.pipe} II ${d.ii}${d.par > 1 ? ` par ${d.par}` : ''}${d.part ? ' part' : ''}`).join('; ')}
Unidades: ${s.units.some((u) => u.mul || u.add) ? `${inline === 'rtl' ? 'caixa preta de RTL em todos os projetos' : 'na rede, a netlist de cada unidade em C++ (INLINE off; a mesma caixa preta em duas funções falha no Vivado); nos projetos por camada, caixa preta de RTL (u_*_bb.v, .json e o modelo C para a csim)'}` : 'todas exatas'}; a reescala, (acc × m + 2^31) >> 32, em DSP.
Configuração (run.tcl): multiplicações de 8 bits em LUT (config_op mul -impl fabric), sem pipeline automático de laços
e sem a partição automática do Vitis (config_array_partition -throughput_driven off): os vetores ficam só com as
partições das diretivas, como no modelo. Com AXC_AUTOPART=1 (bash run_all.sh também repassa), o Vitis particiona
sozinho os vetores locais lidos nos laços com pipeline; na MiniLenet, isso leva as convoluções a II 1, como a
diretiva de partição do simulador.

Previsões do modelo (atrasos ${s.target === 'fpga' ? 'do Vivado' : 'do sky130'}; a soma das camadas, cada uma com as suas partições)
  camada       ciclos   II     LUT      FF  DSP  unidades
${L.map(row).join('\n')}
  total     ${String(s.totals.cycles).padStart(9)}      ${String(s.totals.luts).padStart(7)} ${String(s.totals.ff).padStart(7)} ${String(s.totals.dsp).padStart(4)}  (${s.totals.timeUs.toFixed(1)} µs por imagem)
${s.partitionNotes.length ? `\nPartições dos vetores entre camadas que a camada que escreve pedia diferente (na rede, ficou a da camada que lê;\nnos projetos por camada, cada uma tem a sua)\n${s.partitionNotes.map((w) => `  ${w}`).join('\n')}\n` : ''}${s.warnings.length ? `\nAvisos\n${s.warnings.map((w) => `  ${w}`).join('\n')}\n` : ''}`;
}
