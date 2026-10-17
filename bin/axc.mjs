#!/usr/bin/env node
/**
 * Interface de linha de comando do simulador: os mesmos modelos da página (js/axc), sem o navegador, para
 * experimentos em script. Saída em texto, CSV ou JSON.
 *
 *   node bin/axc.mjs list [--group mul8|mul16|add8|add16]
 *   node bin/axc.mjs metrics <unidade> [--dist uniform|normal|exp|lenet|image] [--samples N] [--seed S]
 *   node bin/axc.mjs sweep --group mul8 [--dist ...] [--format csv|json]
 *   node bin/axc.mjs synth <unidade>
 *   node bin/axc.mjs verilog <unidade> [--tb] [--out arquivo.v]
 *   node bin/axc.mjs lenet <multiplicador> [--add <somador>] [--layers conv1,conv2,fc1,fc2,fc3]
 *   node bin/axc.mjs hls <kernel.c | --example gauss|sobel|sharpen|fir|dot> [--clock ns] [--flow delay|area|iso] [--ports n]
 *
 * A <unidade> é o nome mostrado na página (por exemplo "MUL8 DRUM4", "MUL16 T8 A8c", "ADD16 LOA8"), procurado no
 * espaço de projeto e nas pré-definidas, ou uma configuração em JSON ({"kind":"mul","width":8,"method":"drum","k":4}).
 * Todos os comandos aceitam --json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUnit, unitName } from '../js/axc/units.js';
import { testInputs, errorMetrics, loadOperands, APP_DISTRIBUTIONS, DISTRIBUTIONS } from '../js/axc/metrics.js';
import { toVerilog, testbench, moduleName } from '../js/axc/verilog.js';
import { designSpace } from '../js/axc/designspace.js';
import { PRESETS } from '../js/axc/presets.js';
import { LAYERS, decodeModel, decodeTestSet, productTable, classifyBatch, adderAccumulate, summarize } from '../js/axc/lenet.js';

import { synthesize } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--') && !['--json', '--tb'].includes(all[i - 1])));
const opt = (name, def) => { const k = argv.indexOf(name); return k >= 0 ? argv[k + 1] : def; };
const flag = (name) => argv.includes(name);
const out = (obj, text) => console.log(flag('--json') ? JSON.stringify(obj, null, 1) : text());
const die = (msg) => { console.error(msg); process.exit(1); };

const ALL = (() => {
    const m = new Map();
    for (const c of [...PRESETS, ...designSpace()]) m.set(unitName(c).toUpperCase(), c);
    return m;
})();
function cfgOf(spec) {
    if (!spec) die('falta a unidade (nome, como "MUL8 DRUM4", ou configuração em JSON)');
    if (spec.trim().startsWith('{')) return JSON.parse(spec);
    const c = ALL.get(spec.trim().toUpperCase().replace(/ EXACT$/, ' EXATO'));
    if (!c) die(`unidade desconhecida: ${spec} (veja node bin/axc.mjs list)`);
    return c;
}
let opsLoaded = false;
function inputs(cfg, dist) {
    if (APP_DISTRIBUTIONS.includes(dist) && !opsLoaded) {
        const buf = readFileSync(join(ROOT, 'data/operands.bin'));
        loadOperands(JSON.parse(readFileSync(join(ROOT, 'data/operands.json'), 'utf8')), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        opsLoaded = true;
    }
    if (![...DISTRIBUTIONS, ...APP_DISTRIBUTIONS].includes(dist)) die(`distribuição desconhecida: ${dist}`);
    return testInputs(cfg.width, dist, +opt('--samples', 200000), +opt('--seed', 12345), cfg.kind);
}
const METRICS = ['MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP'];
function metrics(cfg, dist) {
    const unit = buildUnit(cfg);
    const m = errorMetrics(unit, inputs(cfg, dist));
    return { name: unitName(cfg), cfg, dist, n: m.n, gates: unit.net.gates, depth: unit.net.delay(), ...Object.fromEntries(METRICS.map((k) => [k, m[k]])), ci: m.ci };
}
const synthData = () => {
    const f = join(ROOT, 'data/synth.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : die('data/synth.json não encontrado');
};
const groupOf = (c) => `${c.kind}${c.width}`;

switch (cmd) {
    case 'list': {
        const g = opt('--group');
        const list = designSpace().filter((c) => !g || groupOf(c) === g);
        out(list.map((c) => ({ name: unitName(c), cfg: c })), () => list.map((c) => `${unitName(c).padEnd(22)} ${JSON.stringify(c)}`).join('\n'));
        break;
    }
    case 'metrics': {
        const r = metrics(cfgOf(pos[0]), opt('--dist', 'uniform'));
        out(r, () => [`${r.name} (${r.dist}, ${r.n} pares)`, ...METRICS.map((k) => `${k.padEnd(5)} ${r[k]}${r.ci?.[k] ? `  ± ${r.ci[k]}` : ''}`), `portas ${r.gates}, profundidade ${r.depth}`].join('\n'));
        break;
    }
    case 'sweep': {
        const g = opt('--group') ?? die('falta --group');
        const dist = opt('--dist', 'uniform');
        const rows = designSpace().filter((c) => groupOf(c) === g).map((c) => metrics(c, dist));
        if (opt('--format') === 'json' || flag('--json')) { console.log(JSON.stringify(rows, null, 1)); break; }
        const cols = ['name', 'gates', 'depth', ...METRICS, ...METRICS.filter((k) => k !== 'WCE').map((k) => `${k}_ci95`)];
        console.log(cols.join(','));
        for (const r of rows) console.log(cols.map((k) => (k.endsWith('_ci95') ? r.ci?.[k.slice(0, -5)] ?? '' : k === 'name' ? `"${r.name}"` : r[k])).join(','));
        break;
    }
    case 'synth': {
        const cfg = cfgOf(pos[0]);
        const d = synthData().designs.find((x) => x.name === unitName(cfg)) ?? die(`${unitName(cfg)} não está entre as configurações sintetizadas`);
        out(d, () => [`${d.name}: ${d.luts} LUTs, ${d.carry4} CARRY4 (FPGA)`, ...Object.entries(d.asic.flows).map(([k, f]) => `${k.padEnd(5)} ${f.area} µm², ${f.delay} ps, ${f.energy} fJ, ${f.leakage} nW`),
            `energia com operandos reais (atraso mínimo): ${Object.entries(d.asic.energyApp ?? {}).map(([k, v]) => `${k} ${v} fJ`).join(', ')}`].join('\n'));
        break;
    }
    case 'verilog': {
        const cfg = cfgOf(pos[0]);
        const unit = buildUnit(cfg);
        const name = moduleName(cfg);
        let text = toVerilog(unit, name);
        if (flag('--tb')) {
            const inp = testInputs(cfg.width, 'uniform', 20000, 2026);
            text += `\n${testbench(unit, inp.a.length, `${name}.hex`, name)}`;
        }
        if (opt('--out')) writeFileSync(opt('--out'), text); else process.stdout.write(text);
        break;
    }
    case 'lenet': {
        const mul = cfgOf(pos[0]);
        if (mul.kind !== 'mul') die('o primeiro argumento do lenet é um multiplicador');
        const add = opt('--add') ? cfgOf(opt('--add')) : null;
        if (add && add.kind !== 'add') die('--add espera um somador');
        const layers = (opt('--layers') ?? LAYERS.join(',')).split(',');
        const model = decodeModel(JSON.parse(readFileSync(join(ROOT, 'data/lenet5.json'), 'utf8')));
        const test = decodeTestSet(readFileSync(join(ROOT, 'data/mnist1000.bin')));
        const T = productTable(buildUnit(mul)), Tx = productTable(null);
        const acc = add ? adderAccumulate(buildUnit(add)) : null;
        const mask = LAYERS.map((l) => layers.includes(l));
        const run = (tables, adds) => { const p = new Uint8Array(test.n); classifyBatch(model, test, tables, adds, 0, test.n, p); return p; };
        const ref = run(LAYERS.map(() => Tx), LAYERS.map(() => null));
        const preds = run(mask.map((m) => (m ? T : Tx)), mask.map((m) => (m ? acc : null)));
        const s = summarize(test, preds, ref), s0 = summarize(test, ref, null);
        const r = { mul: unitName(mul), add: add ? unitName(add) : null, layers, accuracy: s.accuracy, exactAccuracy: s0.accuracy, broke: s.broke.length, fixed: s.fixed };
        out(r, () => `${r.mul}${r.add ? ` + ${r.add}` : ''} em ${layers.join(', ')}: acurácia ${(100 * r.accuracy).toFixed(1)}% (exata ${(100 * r.exactAccuracy).toFixed(1)}%), ${r.broke} erradas a mais, ${r.fixed} corrigidas`);
        break;
    }
    case 'hls': {
        const ex = opt('--example');
        const src = ex ? (KERNELS.find((k) => k.id === ex) ?? die(`exemplo desconhecido: ${ex} (${KERNELS.map((k) => k.id).join(', ')})`)).code
            : pos[0] ? readFileSync(pos[0], 'utf8') : die('falta o arquivo do kernel ou --example');
        const synthJ = synthData();
        const cellsJ = JSON.parse(readFileSync(join(ROOT, 'data/hls-cells.json'), 'utf8'));
        let r;
        try {
            r = synthesize(src, { synth: synthJ, cells: cellsJ, clockNs: +opt('--clock', 5), flow: opt('--flow', 'delay'), ports: +opt('--ports', 2) });
        } catch (e) { die(e.message); }
        const loopsOut = r.design.loops.filter((l) => l.mode !== 'unrolled').map((l) => ({
            loop: l.label ?? l.id, line: l.line, trip: l.trip, mode: l.mode, unroll: l.factor, II: l.IIachieved ?? null, IItarget: l.II ?? null,
            limitedBy: l.why ? `${l.why.kind}${l.why.label ?? l.why.key ? `: ${l.why.label ?? l.why.key}` : ''}` : null, iterationLatency: l.iterLatency, latency: l.latency,
        }));
        const res = {
            kernel: r.design.name, clockNs: r.totals.clockPs / 1000, flow: opt('--flow', 'delay'), totals: r.totals, loops: loopsOut,
            units: r.cost.units.map((u) => ({ unit: u.unit.name, count: u.count, area: u.area, luts: u.luts })),
            cells: r.cost.cells.map((c) => ({ cell: c.key, count: c.count, area: c.area })),
            area: r.cost.area, energy: r.cost.energy, fpga: r.cost.fpga, warnings: r.warnings,
        };
        out(res, () => [
            `${res.kernel}: ${r.totals.cycles} ciclos de ${res.clockNs} ns = ${r.totals.timeNs.toFixed(1)} ns${r.totals.intervalNs ? `, um resultado a cada ${r.totals.intervalNs} ns` : ''} (período mínimo ${r.totals.critPs} ps)`,
            ...loopsOut.map((l) => `  ${l.loop.padEnd(10)} ${l.mode.padEnd(10)} ${String(l.trip).padStart(5)} iterações${l.unroll > 1 ? ` (unroll ${l.unroll})` : ''}${l.II ? `  II ${l.II}${l.limitedBy ? ` (${l.limitedBy})` : ''}` : ''}  latência ${l.latency}`),
            `  unidades: ${res.units.map((u) => `${u.count} × ${u.unit}`).join(', ') || 'nenhuma'}`,
            `  área ${r.cost.area.total.toFixed(0)} µm² (unidades ${r.cost.area.units.toFixed(0)}, células ${r.cost.area.cells.toFixed(0)}, mux ${r.cost.area.mux.toFixed(0)}, registradores ${r.cost.area.registers.toFixed(0)}, controle ${r.cost.area.control.toFixed(0)})`,
            `  FPGA ${r.cost.fpga.luts} LUTs, ${r.cost.fpga.carry4} CARRY4, ${r.cost.fpga.ff} FF`,
            `  energia ${(r.cost.energy.total / 1000).toFixed(1)} pJ por execução (operações ${(r.cost.energy.ops / 1000).toFixed(1)}, registradores ${(r.cost.energy.registers / 1000).toFixed(1)})`,
            ...r.warnings.map((w) => `  aviso, linha ${w.line}: ${w.msg}`),
        ].join('\n'));
        break;
    }
    default:
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 17).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
        if (cmd && cmd !== 'help') process.exit(1);
}
