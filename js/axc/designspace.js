/**
 * Espaço de projeto sintetizado (scripts/synth.mjs), estratificado por técnica:
 *
 *   Booth, Kulkarni, DRUM e Mitchell: todas as configurações, com e sem compensação do viés;
 *   multiplicador por colunas: grade regular de passo 2 em colunas truncadas e aproximadas (vem um previsto
 *     ligado), cerca de 25% dos pares, mais a compensação nos que só truncam;
 *   somadores truncado e LOA: todos os k; segmentado: grade regular de passo 2 em L (menor que N) e P (cerca de 25%);
 *   as unidades exatas de cada largura (referência de área, atraso e energia).
 *
 * As configurações pré-definidas (presets.js) estão todas aqui dentro, para a aba Síntese continuar com elas.
 */
import { PRESETS } from './presets.js';
import { unitName } from './units.js';

const WIDTHS = [8, 16];

function* multipliers(N) {
    yield { kind: 'mul', width: N, kTrunc: 0, kApprox: 0, approxCarry: true };
    // Por colunas: passo 2, kTrunc + kApprox <= 2N.
    for (let t = 0; t <= 2 * N; t += 2) {
        for (let a = 0; t + a <= 2 * N; a += 2) {
            if (t === 0 && a === 0) continue;
            yield { kind: 'mul', width: N, kTrunc: t, kApprox: a, approxCarry: true };
        }
        if (t > 0) yield { kind: 'mul', width: N, kTrunc: t, kApprox: 0, approxCarry: true, comp: true };
    }
    for (const comp of [false, true]) {
        const c = comp ? { comp: true } : {};
        // Sem truncamento o Booth é exato, e a compensação seria zero: fica só a versão sem ela.
        for (let t = comp ? 1 : 0; t <= 2 * N; t++) yield { kind: 'mul', width: N, method: 'booth', ...(t ? { kTrunc: t } : {}), ...c };
        for (let b = 0; b <= 2 * N; b += 2) yield { kind: 'mul', width: N, method: 'kulkarni', ...(b < 2 * N ? { kBlock: b } : {}), ...c };
        for (let k = 2; k <= N - 1; k++) yield { kind: 'mul', width: N, method: 'drum', k, ...c };
        yield { kind: 'mul', width: N, method: 'mitchell', ...c };
    }
}

function* adders(N) {
    yield { kind: 'add', width: N, adder: 'exact' };
    for (const adder of ['trunc', 'loa']) for (let k = 1; k <= N; k++) yield { kind: 'add', width: N, adder, k };
    // Com L = N há um bloco só: é o somador exato.
    for (let L = 2; L < N; L += 2) for (let P = 0; P <= N; P += 2) yield { kind: 'add', width: N, adder: 'seg', L, P };
}

/** Lista sem repetição (pelo nome da unidade), com as pré-definidas primeiro. */
export function designSpace() {
    const seen = new Set();
    const out = [];
    const push = (cfg) => {
        const n = unitName(cfg);
        if (seen.has(n)) return;
        seen.add(n);
        out.push(cfg);
    };
    PRESETS.forEach(push);
    for (const N of WIDTHS) { for (const c of multipliers(N)) push(c); for (const c of adders(N)) push(c); }
    return out;
}
