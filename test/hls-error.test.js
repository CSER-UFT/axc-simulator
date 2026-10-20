import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { synthesize } from '../js/hls/index.js';
import { KERNELS } from '../js/hls/kernels.js';
import { execute, makeInputs, compareOutputs } from '../js/hls/exec.js';
import { opFunction, parseAssign } from '../js/hls/approx.js';
import { analyzeError, Phi } from '../js/hls/error.js';
import { buildUnit } from '../js/axc/units.js';

const synth = JSON.parse(readFileSync('data/synth.json', 'utf8'));
const cells = JSON.parse(readFileSync('data/hls-cells.json', 'utf8'));
const run = (src, o = {}) => synthesize(src, { synth, cells, clockNs: 5, ...o });
const kernel = (id) => KERNELS.find((k) => k.id === id).code;
const K = [19, 32, 19, 32, 52, 32, 19, 32, 19];
const gaussRef = (I, y, x) => {
    let a = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a += I[(y + i - 1) * 192 + x + j - 1] * K[i * 3 + j];
    return Math.min(255, a >> 8);
};

test('execução exata: o projeto elaborado calcula o mesmo que o C (com pipeline e sem diretivas)', () => {
    for (const src of [kernel('gauss'), kernel('gauss').replace(/#pragma HLS .*\n/g, '')]) {
        const r = run(src);
        const inp = makeInputs(r.design, 'image');
        const ex = execute(r.design, inp);
        const I = inp.get('in'), O = ex.mem.get('out');
        let bad = 0;
        for (let y = 1; y < 191; y++) for (let x = 1; x < 191; x++) if (O[y * 192 + x] !== gaussRef(I, y, x)) bad++;
        assert.equal(bad, 0);
    }
    const d = run(kernel('dot'));
    const inp = makeInputs(d.design, 'uniform');
    const a = inp.get('a'), b = inp.get('b');
    let s = 0;
    for (let i = 0; i < 256; i++) s += a[i] * b[i];
    assert.equal(execute(d.design, inp).mem.get('r')[0], s);
});

test('modelos funcionais: iguais às netlists das unidades', () => {
    const r = run(kernel('fir'));
    const mul = r.ops.list.find((o) => o.cls === 'mul');
    for (const name of ['MUL8 DRUM4', 'MUL8 T4 A4c', 'MUL8 MITCHELL', 'MUL8 BOOTH T4 +C']) {
        if (!mul.candidates.includes(name)) continue;
        const f = opFunction(r.lib, mul, name);
        const u = buildUnit(r.lib.unit(name).cfg);
        const as = Uint32Array.from({ length: 500 }, (_, k) => (k * 37) % 128), bs = Uint32Array.from({ length: 500 }, (_, k) => (k * 91 + 5) % 128);
        const y = u.net.evaluate(as, bs);
        for (let k = 0; k < 500; k++) assert.equal(f(as[k], bs[k]), u.decode ? u.decode(y[k]) : y[k], `${name} ${as[k]} ${bs[k]}`);
    }
    // Somador de 32 bits: LOA4 no de baixo, exato no de cima, com o vai um passando.
    const add32 = r.ops.list.find((o) => o.cls === 'add' && o.W === 32);
    if (add32) {
        const f = opFunction(r.lib, add32, 'ADD32 (ADD16 LOA4 + ADD16 exato)');
        assert.equal(f(0x1FFFF, 1), 0x1FFFF | 1); // bits baixos com OU: sem vai um dentro dos 4 bits
        assert.equal(f(65535 + 16, 16), 65535 + 32);
    }
});

test('atribuição: unidades por tipo, restrições e custo', () => {
    const base = run(kernel('gauss'));
    const asg = parseAssign(base.ops, '16:mul8=MUL8 DRUM6');
    assert.equal(asg.size, 5);
    const r = run(kernel('gauss'), { assign: asg });
    const units = Object.fromEntries(r.cost.units.map((u) => [u.unit.name, u.count]));
    assert.equal(units['MUL8 DRUM6'], 3);
    assert.equal(units['MUL8 exato'], undefined);
    // As multiplicações do gaussiano são por constante (somas de deslocamentos): o DRUM6 custa mais que elas,
    // como no Vivado. Num produto de duas variáveis (dot), o truncado economiza.
    assert.ok(r.totals.luts > base.totals.luts);
    const dot = run(kernel('dot'));
    const dt = run(kernel('dot'), { assign: parseAssign(dot.ops, 'mul8=MUL8 T4') });
    assert.ok(dt.totals.area < dot.totals.area);
    const sob = run(kernel('sobel'));
    // Subtração em complemento de 2: a - b = ~(~a + b) com a mesma unidade, sem vem um. Exata com a unidade exata; com
    // um truncado em k bits (os k bits baixos dos dois operandos descartados), o erro da soma invertida fica entre
    // 0 e 2(2^k - 1), e o da subtração, com o sinal trocado pela inversão, também é positivo.
    assert.equal(parseAssign(sob.ops, 'S1.7=ADD16 TRUNC4').get('S1.7'), 'ADD16 TRUNC4');
    const sub = sob.ops.byId.get('S1.7');
    const fx = opFunction(sob.lib, sub, 'ADD16 exato'), ft = opFunction(sob.lib, sub, 'ADD16 TRUNC4');
    for (const [x, y] of [[0, 0], [1020, 255], [3, 200], [700, 699], [0, 255]]) {
        assert.equal(fx(x, y), x - y);
        const e = ft(x, y) - (x - y);
        assert.ok(e >= 0 && e <= 30, `${x} - ${y}: erro ${e}`);
    }
    // Atribuição inválida na síntese vira aviso, não erro.
    const w = run(kernel('gauss'), { assign: { 'S1.1': 'ADD16 LOA4' } });
    assert.equal(w.assign.size, 0);
    assert.ok(w.warnings.some((x) => /ignorada/.test(x.msg)));
});

test('erro: estimativa estática perto do medido no gaussiano e no FIR', () => {
    assert.ok(Math.abs(Phi(1.96) - 0.975) < 1e-4 && Math.abs(Phi(0)) - 0.5 < 1e-9);
    for (const [id, spec] of [['gauss', 'mul8=MUL8 DRUM6;add16=ADD16 LOA4'], ['fir', 'mul8=MUL8 T4'], ['sobel', '*=ADD16 LOA4']]) {
        const b = run(kernel(id));
        const r = run(kernel(id), { assign: parseAssign(b.ops, spec) });
        const a = analyzeError(r, { inputs: makeInputs(r.design, 'image'), method: 'sampled', budget: false });
        const m = a.measured[0], e = a.est.outputs.get(m.array);
        assert.ok(m.MSE > 0);
        const ratio = e.MSE / m.MSE;
        assert.ok(ratio > 0.75 && ratio < 1.33, `${id}: estimado ${e.MSE}, medido ${m.MSE}`);
    }
    // Sem aproximação: erro zero nos dois.
    const z = analyzeError(run(kernel('sharpen')), { inputs: makeInputs(run(kernel('sharpen')).design, 'uniform') });
    assert.equal(z.measured[0].MSE, 0);
    assert.equal(z.est.outputs.get('out').MSE, 0);
});

test('erro: recorrência do produto escalar acumula o viés das multiplicações', () => {
    const b = run(kernel('dot'));
    const r = run(kernel('dot'), { assign: parseAssign(b.ops, 'mul8=MUL8 T4') });
    for (const method of ['analytic', 'sampled']) {
        const a = analyzeError(r, { inputs: makeInputs(r.design, 'uniform'), method, budget: false });
        const m = a.measured[0], e = a.est.outputs.get('r');
        // Todas as 256 multiplicações estão no perfil: o viés estimado é o erro medido.
        assert.ok(Math.abs(e.ME - m.ME) <= Math.abs(m.ME) * 0.01 + 1, `${method}: ${e.ME} ${m.ME}`);
    }
    const ex = execute(r.design, makeInputs(r.design, 'uniform'), { profile: true });
    assert.equal(compareOutputs(r.design, ex, ex)[0].MSE, 0);
});

test('SSIM: definição padrão, estimativa pelo modelo e restrição na exploração', async () => {
    const { ssim, ssimStats, ssimEstimate } = await import('../js/axc/ssim.js');
    const { explore } = await import('../js/hls/dse.js');
    const { analyzeError } = await import('../js/hls/error.js');
    const { makeInputs } = await import('../js/hls/exec.js');
    const w = 40, h = 30, X = new Float64Array(w * h).map((_, k) => (k * 37) % 256);
    assert.equal(ssim(X, X, w, h), 1);
    assert.ok(Math.abs(ssimEstimate(ssimStats(X, w, h), 0, 0) - 1) < 1e-12);
    // Gaussiano com DRUM6: a estimativa por faixa de valor fica a menos de 0,005 do medido.
    const b = run(kernel('gauss'));
    const r = run(kernel('gauss'), { assign: parseAssign(b.ops, 'mul8=MUL8 DRUM6'), design: b.design });
    const a = analyzeError(r, { inputs: makeInputs(r.design, 'image'), budget: false });
    const est = [...a.est.outputs.values()][0].SSIM, meas = a.measured[0].SSIM;
    assert.ok(Math.abs(est - meas) < 0.005, `${est} contra ${meas}`);
    // O produto escalar não tem saída de imagem.
    assert.throws(() => explore(kernel('dot'), { synth, cells, constraint: { metric: 'ssim', value: 0.98 } }), /saída de imagem/);
});
