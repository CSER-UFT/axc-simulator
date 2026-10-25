#!/usr/bin/env node
/**
 * Calibração do custo FPGA (LUT e FF) contra o Vivado: junta a base dos kernels (node scripts/vitis.mjs calibdata,
 * build/calib/kernels.json) e as camadas das redes medidas (results/nn-vitis: cada camada sozinha, com o código que o
 * gerador atual produz), e ajusta um fator por parcela do modelo (mínimos quadrados do erro relativo, fatores não
 * negativos):
 *
 *   LUT = a1 unidades + a2 peças + a3 multiplexadores + a4 controle + a5 endereço + a6 SRL
 *   FF  = b1 bits de registrador + b2 FF do endereço + b3 por laço ou função
 *
 * Uso: node scripts/calibrate.mjs [--loo]   (--loo: erro em validação cruzada, deixando um caso de fora)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeNet } from '../js/axc/nn.js';
import { costModel } from '../js/axc/nngen.js';
import { implSummary } from '../js/hls/reports.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const synth = D('synth.json'), cells = D('hls-cells.json'), fpga = D('vivado-units.json');
const reg = D('nn/models.json');
const argv = process.argv.slice(2);

const partsOf = (r) => {
    const c = r.cost, s = (xs, f) => (xs ?? []).reduce((a, x) => a + (f(x) ?? 0), 0);
    return {
        units: s(c.units, (u) => u.luts), cells: s(c.cells, (x) => x.luts), mux: s(c.muxes, (m) => m.luts), control: s(c.control, (x) => x.luts),
        addr: c.addr?.luts ?? 0, srl: c.fpga.srlLuts ?? 0, regBits: c.regBits, addrFf: c.addr?.ff ?? 0, srlFf: c.regBits + (c.addr?.ff ?? 0) - c.fpga.ff,
        loops: r.design.loops.filter((l) => l.mode !== 'unrolled').length,
    };
};

// Camadas das redes: rodadas com o código igual ao do gerador atual.
function nnRows() {
    const rows = [];
    const dir = join(ROOT, 'results/nn-vitis');
    // --rounds <regex>: as rodadas usadas (padrão: as do fim de semana, com os pesos em BRAM, sem as aproximadas, que
    // tinham a leitura repetida dos pesos corrigida depois).
    const ri = argv.indexOf('--rounds');
    const want = new RegExp(ri >= 0 ? argv[ri + 1] : '^(?!.*aprox).*_fds$');
    for (const round of readdirSync(dir).filter((d) => want.test(d) && existsSync(join(dir, d, 'network/model.json')))) {
        const m = JSON.parse(readFileSync(join(dir, round, 'network/model.json'), 'utf8'));
        const entry = reg.models.find((x) => x.id === m.model);
        const net = decodeNet(JSON.parse(readFileSync(join(ROOT, entry.file), 'utf8')));
        const cm = costModel(net, { synth, cells, fpga, target: 'fpga', clockNs: m.clockNs, dirs: m.dirs });
        const cost = cm.network(m.units);
        const r3 = /_r3$/.test(round);
        for (const l of cost.layers) {
            if (!r3 && !/_fds$/.test(round) && l.type === 'pad') continue; // bordas: o gerador mudou na rodada 3
            if (round === 'minilenet_part_r3' && l.type === 'conv') continue; // fatores de partição mudaram depois
            const x = join(dir, round, 'layers', l.name, 'proj/solution1/impl/report/verilog/export_impl.xml');
            if (!existsSync(x)) continue;
            const meas = implSummary(readFileSync(x, 'utf8'));
            if (!meas.lut) continue;
            rows.push({ id: `${round}/${l.name}`, kind: 'nn', parts: partsOf(l.result), measured: { lut: meas.lut, ff: meas.ff }, model: { lut: l.luts, ff: l.ff } });
        }
    }
    return rows;
}

/** Mínimos quadrados não negativos do erro relativo (descida por coordenadas). */
function fit(rows, keys, target, extra = []) {
    const X = rows.map((r) => [...keys.map((k) => r.parts[k]), ...extra.map((f) => f(r))]);
    const y = rows.map((r) => r.measured[target]);
    const w = y.map((v) => 1 / Math.max(1, v));
    const n = X[0].length;
    const c = new Array(n).fill(1);
    for (let it = 0; it < 4000; it++) {
        for (let j = 0; j < n; j++) {
            let num = 0, den = 0;
            for (let i = 0; i < X.length; i++) {
                const pred = X[i].reduce((a, x, k) => a + x * c[k], 0) - X[i][j] * c[j];
                num += w[i] ** 2 * X[i][j] * (y[i] - pred);
                den += w[i] ** 2 * X[i][j] ** 2;
            }
            c[j] = den > 0 ? Math.max(0, num / den) : 0;
        }
    }
    return c;
}
const predict = (r, keys, extra, c) => [...keys.map((k) => r.parts[k]), ...extra.map((f) => f(r))].reduce((a, x, k) => a + x * c[k], 0);
const mre = (rows, f, t) => rows.reduce((a, r) => a + Math.abs(f(r) - r.measured[t]) / r.measured[t], 0) / rows.length;

const kernels = existsSync(join(ROOT, 'build/calib/kernels.json')) ? JSON.parse(readFileSync(join(ROOT, 'build/calib/kernels.json'), 'utf8')) : [];
const nn = nnRows();
const all = [...kernels, ...nn];
const LK = ['units', 'cells', 'mux', 'control', 'addr', 'srl'];
const FK = ['regBits', 'addrFf'];
const FX = [(r) => r.parts.loops];
console.log(`casos: ${kernels.length} kernels, ${nn.length} camadas de redes`);
const cl = fit(all, LK, 'lut'), cf = fit(all, FK, 'ff', FX);
console.log('LUT =', LK.map((k, i) => `${cl[i].toFixed(3)} ${k}`).join(' + '));
console.log('FF  =', [...FK, 'laços'].map((k, i) => `${cf[i].toFixed(3)} ${k}`).join(' + '));
for (const [name, rows] of [['kernels', kernels], ['redes', nn], ['todos', all]]) {
    if (!rows.length) continue;
    const before = (t) => (r) => r.model[t];
    console.log(`${name.padEnd(8)} LUT ${(100 * mre(rows, before('lut'), 'lut')).toFixed(1)}% -> ${(100 * mre(rows, (r) => predict(r, LK, [], cl), 'lut')).toFixed(1)}%   FF ${(100 * mre(rows, before('ff'), 'ff')).toFixed(1)}% -> ${(100 * mre(rows, (r) => predict(r, FK, FX, cf), 'ff')).toFixed(1)}%`);
}
if (argv.includes('--nn')) {
    // Só as camadas das redes: um fator por parcela, com validação cruzada.
    const K2 = ['units', 'cells', 'mux', 'control', 'addr', 'srl'];
    const a = fit(nn, K2, 'lut'), b = fit(nn, FK, 'ff', FX);
    console.log('redes: LUT =', K2.map((k, i) => `${a[i].toFixed(3)} ${k}`).join(' + '), ' FF =', [...FK, 'laços'].map((k, i) => `${b[i].toFixed(3)} ${k}`).join(' + '));
    let el = 0, ef = 0;
    nn.forEach((r, i) => { const rest = nn.filter((_, j) => j !== i); el += Math.abs(predict(r, K2, [], fit(rest, K2, 'lut')) - r.measured.lut) / r.measured.lut; ef += Math.abs(predict(r, FK, FX, fit(rest, FK, 'ff', FX)) - r.measured.ff) / r.measured.ff; });
    console.log(`redes: LUT ${(100 * mre(nn, (r) => r.model.lut, 'lut')).toFixed(1)}% -> ${(100 * mre(nn, (r) => predict(r, K2, [], a), 'lut')).toFixed(1)}% (um de fora ${(100 * el / nn.length).toFixed(1)}%), FF ${(100 * mre(nn, (r) => r.model.ff, 'ff')).toFixed(1)}% -> ${(100 * mre(nn, (r) => predict(r, FK, FX, b), 'ff')).toFixed(1)}% (um de fora ${(100 * ef / nn.length).toFixed(1)}%)`);
}
if (argv.includes('--nnaddr')) {
    // Redes: fatores só no endereço e no controle (o resto do modelo fica), grade com validação cruzada.
    const f = (a, k) => (r) => r.model.lut - (1 - a) * r.parts.addr - (1 - k) * r.parts.control;
    const best = (rows) => { let b = null; for (let a = 0; a <= 1.5; a += 0.05) for (let k = 0; k <= 1.5; k += 0.05) { const e = mre(rows, f(a, k), 'lut'); if (!b || e < b.e) b = { a, k, e }; } return b; };
    const b = best(nn);
    let el = 0;
    nn.forEach((r, i) => { const x = best(nn.filter((_, j) => j !== i)); el += Math.abs(f(x.a, x.k)(r) - r.measured.lut) / r.measured.lut; });
    console.log(`redes: endereço x${b.a.toFixed(2)}, controle x${b.k.toFixed(2)}: LUT ${(100 * mre(nn, (r) => r.model.lut, 'lut')).toFixed(1)}% -> ${(100 * b.e).toFixed(1)}% (um de fora ${(100 * el / nn.length).toFixed(1)}%)`);
    if (argv.includes('--rows')) for (const r of nn) console.log(r.id.padEnd(34), r.measured.lut, r.model.lut, Math.round(f(b.a, b.k)(r)));
}
if (argv.includes('--loo')) {
    let el = 0, ef = 0;
    all.forEach((r, i) => {
        const rest = all.filter((_, j) => j !== i);
        const a = fit(rest, LK, 'lut'), b = fit(rest, FK, 'ff', FX);
        el += Math.abs(predict(r, LK, [], a) - r.measured.lut) / r.measured.lut;
        ef += Math.abs(predict(r, FK, FX, b) - r.measured.ff) / r.measured.ff;
    });
    console.log(`validação cruzada (um de fora): LUT ${(100 * el / all.length).toFixed(1)}%, FF ${(100 * ef / all.length).toFixed(1)}%`);
}
if (argv.includes('--rows')) for (const r of all) console.log(r.id.padEnd(40), 'LUT', r.measured.lut, r.model.lut, Math.round(predict(r, LK, [], cl)), '| FF', r.measured.ff, r.model.ff, Math.round(predict(r, FK, FX, cf)));
if (argv.includes('--parts')) for (const r of all.filter((x) => new RegExp(argv[argv.indexOf('--parts') + 1] ?? '.').test(x.id))) console.log(r.id.padEnd(34), JSON.stringify(r.parts), 'medido', r.measured.lut, r.measured.ff);
if (argv.includes('--ffbase')) {
    // FF = modelo atual + base por função + c por laço mantido (mínimos quadrados do erro relativo, sobre uma grade).
    const uniq = new Map();
    for (const r of all) { const k = `${r.parts.regBits}|${r.parts.loops}|${r.measured.ff}`; if (!uniq.has(k)) uniq.set(k, r); }
    const rows = [...uniq.values()];
    let best = null;
    for (let b = 0; b <= 120; b += 2) for (let c = 0; c <= 40; c += 1) {
        const e = mre(rows, (r) => r.model.ff + b + c * r.parts.loops, 'ff');
        if (!best || e < best.e) best = { b, c, e };
    }
    console.log(`FF: base ${best.b} por função + ${best.c} por laço`);
    for (const [name, rs] of [['kernels', kernels], ['redes', nn]]) console.log(`${name.padEnd(8)} FF ${(100 * mre(rs, (r) => r.model.ff, 'ff')).toFixed(1)}% -> ${(100 * mre(rs, (r) => r.model.ff + best.b + best.c * r.parts.loops, 'ff')).toFixed(1)}%`);
}
if (argv.includes('--lutaddr')) {
    const uniq = new Map();
    for (const r of all) { if (/exata_r1\/fc/.test(r.id)) continue; const k = `${JSON.stringify(r.parts)}|${r.measured.lut}`; if (!uniq.has(k)) uniq.set(k, r); }
    const rows = [...uniq.values()];
    const f = (a, k) => (r) => r.model.lut - (1 - a) * r.parts.addr - (1 - k) * r.parts.control;
    let best = null;
    for (let a = 0.1; a <= 1.5; a += 0.05) for (let k = 0.1; k <= 1.5; k += 0.05) { const e = mre(rows, f(a, k), 'lut'); if (!best || e < best.e) best = { a, k, e }; }
    console.log(`LUT: endereço x${best.a.toFixed(2)}, controle x${best.k.toFixed(2)}`);
    for (const [name, rs] of [['kernels', kernels], ['redes', nn.filter((r) => !/exata_r1\/fc/.test(r.id))]]) console.log(`${name.padEnd(8)} LUT ${(100 * mre(rs, (r) => r.model.lut, 'lut')).toFixed(1)}% -> ${(100 * mre(rs, f(best.a, best.k), 'lut')).toFixed(1)}%`);
}
