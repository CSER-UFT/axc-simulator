import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnit } from '../js/axc/units.js';
import { toVerilog, testbench, vectors, moduleName } from '../js/axc/verilog.js';
import { testInputs } from '../js/axc/metrics.js';

const has = (cmd) => { try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; } };

test('o Verilog exportado tem uma atribuição por porta e um + por cadeia de vai um', () => {
    const u = buildUnit({ kind: 'add', width: 8, adder: 'seg', L: 4, P: 2 });
    const v = toVerilog(u);
    assert.match(v, /^module add8_seg_l4_p2 \(/m);
    assert.equal((v.match(/ \+ /g) ?? []).length / 2, u.net.chains.length);
    assert.match(v, /assign y\[8\] = /);
});

test('o Verilog exportado confere com o simulador no Icarus Verilog', { skip: !has('iverilog') && 'iverilog não instalado' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-'));
    for (const cfg of [{ kind: 'mul', width: 8, kTrunc: 2, kApprox: 7 }, { kind: 'mul', width: 16, kApprox: 12 }, { kind: 'add', width: 16, adder: 'loa', k: 5 }, { kind: 'add', width: 8, adder: 'seg', L: 3, P: 2 }]) {
        const u = buildUnit(cfg), name = moduleName(cfg);
        const inp = testInputs(cfg.width, 'uniform', 3000, 4);
        const f = (x) => join(dir, x);
        writeFileSync(f(`${name}.v`), toVerilog(u));
        writeFileSync(f(`${name}.hex`), vectors(u, inp));
        writeFileSync(f(`tb_${name}.v`), testbench(u, inp.a.length, f(`${name}.hex`)));
        const out = execSync(`iverilog -g2005 -o ${f('sim')} ${f(`${name}.v`)} ${f(`tb_${name}.v`)} && vvp -n ${f('sim')}`).toString();
        assert.match(out, new RegExp(`MISMATCHES 0 OF ${inp.a.length}`), name);
    }
});
