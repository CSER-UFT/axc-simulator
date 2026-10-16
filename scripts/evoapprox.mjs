#!/usr/bin/env node
/**
 * Referência externa: os multiplicadores e somadores sem sinal de 8 e 16 bits da EvoApproxLib LITE (licença MIT;
 * Mrazek et al., "EvoApprox8b", DATE 2017, doi:10.23919/DATE.2017.7926993), sintetizados com exatamente o mesmo fluxo
 * das unidades do simulador (scripts/lib/asic.mjs: três fluxos ABC na sky130_fd_sc_hd, conferência da netlist mapeada,
 * atraso e potência com o OpenSTA) e com as métricas de erro calculadas com as mesmas definições e os mesmos pares de
 * entrada (todos os pares em 8 bits; os mesmos 200 mil pares sorteados em 16 bits). O resultado vai para
 * data/evoapprox.json; os números de 45 nm publicados pela biblioteca também vão junto, para comparação. Também o erro
 * e a energia com os operandos reais das aplicações (data/operands.bin), como nas unidades do simulador.
 *
 * A saída de cada circuito vem da simulação do próprio Verilog da biblioteca no Icarus Verilog (o Verilog é a
 * referência). Em 16 bits, para não simular centenas de milhares de pares, usa o modelo em C da biblioteca, depois de
 * conferir que ele dá as mesmas saídas que o Verilog em 4096 pares (nos que não conferem, simula o Verilog).
 *
 * Uso: node scripts/evoapprox.mjs [--jobs N] [--src build/evoapproxlib] [--only regex] [--out data/evoapprox.json]
 *                                 [--synth data/synth.json]
 * Na primeira vez a biblioteca é clonada do GitHub, numa versão fixa.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { join, basename } from 'node:path';
import { testInputs, errorMetrics, loadOperands, APP_DISTRIBUTIONS } from '../js/axc/metrics.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { testbench, vectors } from '../js/axc/verilog.js';
import { createFlow } from './lib/asic.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : def; };
const jobs = +opt('--jobs', Math.max(1, cpus().length));
const src = opt('--src', 'build/evoapproxlib');
const outFile = opt('--out', 'data/evoapprox.json');
const work = opt('--work', 'build/evoapprox');
const REPO = 'https://github.com/ehw-fit/evoapproxlib.git';
const COMMIT = 'ec28be83bfce1b8e8b92bd456be520d323a568b5';
const GROUPS = [
    { dir: 'multiplers/8x8_unsigned', kind: 'mul', width: 8 },
    { dir: 'multiplers/16x16_unsigned', kind: 'mul', width: 16 },
    { dir: 'adders/8_unsigned', kind: 'add', width: 8 },
    { dir: 'adders/16_unsigned', kind: 'add', width: 16 },
];

if (!existsSync(src)) {
    execSync(`git clone -q ${REPO} ${src}`, { stdio: 'inherit' });
}
execSync(`git -C ${src} checkout -q ${COMMIT}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const opsBuf = readFileSync('data/operands.bin');
loadOperands(JSON.parse(readFileSync('data/operands.json', 'utf8')), opsBuf.buffer.slice(opsBuf.byteOffset, opsBuf.byteOffset + opsBuf.byteLength));
const OPS_SHA = createHash('sha256').update(opsBuf).digest('hex');
const cacheDir = 'build/synth-cache';
const F = await createFlow({ work, cacheDir });
const { sh, read, asicFlow, cached, FLOWS } = F;
// Alvos do iso atraso: os mesmos das unidades do simulador (data/synth.json, gerado antes por scripts/synth.mjs).
const targets = JSON.parse(readFileSync(opt('--synth', 'data/synth.json'), 'utf8')).asic.targets;
if (!targets) throw new Error('data/synth.json sem os alvos de atraso: rode antes scripts/synth.mjs');

/** Circuitos de um grupo, sem repetição (o mesmo circuito aparece em vários subconjuntos de Pareto). */
function circuits(g) {
    const seen = new Map();
    for (const sub of readdirSync(join(src, g.dir), { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        for (const f of readdirSync(join(src, g.dir, sub.name))) {
            if (!f.endsWith('.v') || f.endsWith('_pdk45.v')) continue;
            const name = basename(f, '.v');
            if (!seen.has(name)) seen.set(name, { ...g, name, file: join(src, g.dir, sub.name, f), sets: [] });
            seen.get(name).sets.push(sub.name);
        }
    }
    return [...seen.values()];
}

/** Valores publicados no cabeçalho do Verilog (biblioteca de 45 nm, MAE% etc.). */
function published(text) {
    const get = (k) => { const m = new RegExp(`//\\s*${k}\\s*=\\s*([\\d.e+-]+)`).exec(text); return m ? +m[1] : null; };
    return { MAEpct: get('MAE%'), WCEpct: get('WCE%'), EPpct: get('EP%'), MREpct: get('MRE%'), pdk45: { power_mW: get('PDK45_PWR'), area_um2: get('PDK45_AREA'), delay_ns: get('PDK45_DELAY') } };
}

/**
 * Unidade "de fora": a saída vem da simulação do Verilog da biblioteca. Avalia em lotes, com um testbench que lê os
 * pares de um arquivo e escreve as saídas.
 */
function oracle(c, wrapper, W) {
    const N = c.width;
    const tb = join(work, `${c.name}.oracle.v`), vvp = join(work, `${c.name}.oracle.vvp`);
    writeFileSync(tb, `module tbo; reg [${N - 1}:0] a, b; wire [${W - 1}:0] y; integer fi, fo, r, n, k;
    eal_${c.name} dut (.a(a), .b(b), .y(y));
    initial begin fi = $fopen("${join(work, `${c.name}.in`)}", "r"); fo = $fopen("${join(work, `${c.name}.out`)}", "w");
        r = $fscanf(fi, "%d\\n", n);
        for (k = 0; k < n; k = k + 1) begin r = $fscanf(fi, "%h %h\\n", a, b); #1; $fdisplay(fo, "%h", y); end
        $fclose(fo); $finish; end
endmodule
`);
    execSync(`iverilog -g2005 -o ${vvp} ${wrapper} ${c.file} ${tb}`);
    const sim = (a, b) => {
        const lines = [String(a.length)];
        for (let k = 0; k < a.length; k++) lines.push(`${a[k].toString(16)} ${b[k].toString(16)}`);
        writeFileSync(join(work, `${c.name}.in`), `${lines.join('\n')}\n`);
        execSync(`vvp -n ${vvp}`, { maxBuffer: 1 << 26 });
        const out = read(join(work, `${c.name}.out`)).trim().split('\n');
        if (out.length !== a.length || out.some((x) => /[xz]/i.test(x))) throw new Error(`${c.name}: saída inválida na simulação`);
        return Float64Array.from(out, (x) => parseInt(x, 16));
    };
    if (N > 8) return cModel(c, sim) ?? sim;
    // Em 8 bits, uma simulação só com todos os pares e depois consulta à tabela.
    const all = testInputs(N, 'uniform');
    const table = sim(all.a, all.b);
    return (a, b) => Float64Array.from(a, (x, k) => table[(x << N) | b[k]]);
}

/**
 * Modelo em C da biblioteca (bem mais rápido que simular o Verilog em 16 bits), usado só depois de conferido contra o
 * Verilog em 4096 pares. A ordem dos parâmetros varia entre os arquivos (A, B ou B, A): vem dos nomes na assinatura.
 * Devolve null se não houver modelo, se ele não compilar ou se discordar do Verilog.
 */
function cModel(c, sim) {
    const cfile = c.file.replace(/\.v$/, '.c');
    if (!existsSync(cfile)) return null;
    const src = read(cfile);
    const sig = new RegExp(`\\b${c.name}\\s*\\(\\s*(?:const\\s+)?\\w+\\s+(\\w+)\\s*,\\s*(?:const\\s+)?\\w+\\s+(\\w+)\\s*\\)`).exec(src);
    if (!sig) return null;
    // A ordem pela assinatura primeiro; nos compostos de quatro multiplicadores de 8 bits, o C às vezes troca a ordem
    // dos operandos do submódulo em relação ao Verilog, e então a ordem invertida é que confere.
    const first = sig[1].toLowerCase() === 'b' ? 'p[1], p[0]' : 'p[0], p[1]';
    const second = first === 'p[0], p[1]' ? 'p[1], p[0]' : 'p[0], p[1]';
    const t = testInputs(c.width, 'uniform', 4096, 99);
    const y = sim(t.a, t.b);
    for (const [i, args] of [first, second].entries()) {
        const run = build(c, cfile, args, i);
        if (!run) return null;
        const x = run(t.a, t.b);
        if (x.every((v, k) => v === y[k])) return run;
    }
    console.error(`${c.name}: o modelo em C discorda do Verilog nas duas ordens; usando a simulação`);
    return null;
}

/** Compila o modelo em C com um programa que lê pares (binário) e escreve as saídas. */
function build(c, cfile, args, i) {
    const harness = join(work, `${c.name}.harness${i}.c`), bin = join(work, `${c.name}.${i}.bin`);
    writeFileSync(harness, `#include <stdint.h>\n#include <stdio.h>\n#include "${cfile.startsWith('/') ? cfile : join(process.cwd(), cfile)}"\nint main(void) { uint32_t p[2]; while (fread(p, 4, 2, stdin) == 2) { uint32_t o = (uint32_t)${c.name}(${args}); fwrite(&o, 4, 1, stdout); } return 0; }\n`);
    try { execSync(`gcc -O2 -w -o ${bin} ${harness}`, { stdio: 'ignore' }); } catch { return null; }
    return (a, b) => {
        const inp = new Uint32Array(2 * a.length);
        for (let k = 0; k < a.length; k++) { inp[2 * k] = a[k]; inp[2 * k + 1] = b[k]; }
        const out = execSync(bin, { input: Buffer.from(inp.buffer), maxBuffer: 1 << 28 });
        return Float64Array.from(new Uint32Array(out.buffer, out.byteOffset, out.byteLength / 4));
    };
}

async function one(c) {
    const text = read(c.file);
    // Largura da saída: 2N no multiplicador, N + 1 no somador (alguns arquivos têm submódulos com outras larguras
    // antes do módulo principal). Confere com a declaração dentro do próprio módulo.
    const W = c.kind === 'mul' ? 2 * c.width : c.width + 1;
    const body = text.slice(text.search(new RegExp(`module\\s+${c.name}\\b`)));
    const decl = /output\s*\[(\d+):0\]\s*O\b/.exec(body.slice(0, body.indexOf('endmodule')));
    if (!decl || +decl[1] + 1 !== W) throw new Error(`${c.name}: saída de ${decl ? +decl[1] + 1 : '?'} bits, esperado ${W}`);
    const top = `eal_${c.name}`;
    const wrapper = join(work, `${top}.v`);
    writeFileSync(wrapper, `module ${top}(input [${c.width - 1}:0] a, input [${c.width - 1}:0] b, output [${W - 1}:0] y);\n    ${c.name} u (.A(a), .B(b), .O(y));\nendmodule\n`);
    const both = join(work, `${top}.all.v`);
    writeFileSync(both, `${text}\n${read(wrapper)}`);
    const evaluate = oracle(c, wrapper, W);
    const N = c.width;
    const unit = {
        cfg: { width: N }, net: { outputs: { length: W }, evaluate },
        exact: c.kind === 'mul' ? (x, y) => x * y : (x, y) => x + y,
        maxOut: c.kind === 'mul' ? (2 ** N - 1) ** 2 : 2 * (2 ** N - 1),
    };
    const inp = testInputs(N, 'uniform', 20000, 2026);
    const tb = join(work, `tb_${top}.v`), hex = join(work, `${top}.hex`);
    writeFileSync(hex, vectors(unit, inp));
    writeFileSync(tb, testbench(unit, inp.a.length, hex, top));
    const check = { tb, exhaustive: !!inp.exhaustive };
    const asic = {};
    const flows = [...Object.entries(FLOWS), ['iso', targets[`${c.kind}${N}`]]];
    for (const [tag, D] of flows) {
        const f = await cached(top, ['evoapprox-2', COMMIT, D, text], async () => {
            const x = await asicFlow(both, top, unit, check, D, tag);
            writeFileSync(join(cacheDir, `${top}.${D}.v.gz`), gzipSync(readFileSync(x.net), { level: 9 }));
            return x.r;
        });
        delete f.hit;
        asic[tag] = f;
    }
    asic.iso.target = targets[`${c.kind}${N}`];
    // Energia com os pares reais das aplicações, na netlist de atraso mínimo, como nas unidades do simulador.
    const energyApp = {};
    for (const app of APP_DISTRIBUTIONS) {
        const all = testInputs(N, app, 0, 0, c.kind);
        const inpP = { a: all.a.subarray(0, F.STA.powerVectors), b: all.b.subarray(0, F.STA.powerVectors) };
        const f = await cached(top, ['evoapprox-app', COMMIT, app, FLOWS.delay, text, OPS_SHA], async () => {
            const net = join(work, `${top}.${app}.net.v`);
            writeFileSync(net, gunzipSync(readFileSync(join(cacheDir, `${top}.${FLOWS.delay}.v.gz`))));
            return { energy: (await F.measure(net, top, unit, join(work, `${top}.${app}`), inpP)).energy };
        });
        energyApp[app] = f.energy;
    }
    const pick = (em) => ({ ...Object.fromEntries(['MED', 'WCE', 'MSE', 'NMED', 'MRED', 'EP'].map((k) => [k, em[k]])), ...(em.ci ? { ci: em.ci } : {}) });
    const em = errorMetrics(unit, testInputs(N, 'uniform'));
    const r = {
        name: c.name, kind: c.kind, width: N, sets: c.sets.sort(),
        asic: { area: asic.delay.area, delay: asic.delay.delay, energy: asic.delay.energy, leakage: asic.delay.leakage, cells: asic.delay.cells, energyApp, flows: asic },
        err: pick(em),
        errApp: Object.fromEntries(APP_DISTRIBUTIONS.map((app) => [app, pick(errorMetrics(unit, testInputs(N, app, 0, 0, c.kind)))])),
        published: published(text),
        sha256: createHash('sha256').update(text).digest('hex'),
    };
    console.log(`${c.name.padEnd(12)} ${String(r.asic.area.toFixed(0)).padStart(6)} µm² ${String(r.asic.delay).padStart(7)} ps ${String(r.asic.energy).padStart(8)} fJ  MRED ${(100 * r.err.MRED).toFixed(3)}%  (publicado ${r.published.MREpct}%)`);
    return r;
}

let list = GROUPS.flatMap(circuits);
const only = opt('--only');
if (only) list = list.filter((c) => new RegExp(only, 'i').test(c.name));
const out = new Array(list.length);
let next = 0, failed = 0;
await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, async () => {
    while (next < list.length) {
        const k = next++;
        try { out[k] = await one(list[k]); } catch (e) { failed++; console.error(String(e.message ?? e).slice(0, 2000)); }
    }
}));
if (failed) throw new Error(`${failed} circuitos falharam`);
writeFileSync(outFile, `${JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    source: { repo: REPO, commit: COMMIT, license: 'MIT', cite: 'V. Mrazek, R. Hrbacek, Z. Vasicek and L. Sekanina, "EvoApprox8b: Library of approximate adders and multipliers for circuit design and benchmarking of approximation methods", DATE 2017, pp. 258-261, doi:10.23919/DATE.2017.7926993' },
    flow: 'o mesmo de data/synth.json (scripts/lib/asic.mjs)',
    targets,
    designs: out,
}, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(6) : v), 1)}\n`);
console.log(`${out.length} circuitos -> ${outFile}`);
