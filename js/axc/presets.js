/**
 * Configurações pré-definidas: as que a publicação do site sintetiza com o Yosys (scripts/synth.mjs) e que a
 * aba Síntese mostra com os números reais de LUTs e CARRY4.
 */
const mul = (width, kTrunc = 0, kApprox = 0) => ({ kind: 'mul', width, kTrunc, kApprox, approxCarry: true });
const add = (width, adder, extra = {}) => ({ kind: 'add', width, adder, ...extra });
const m = (width, method, extra = {}) => ({ kind: 'mul', width, method, ...extra });

export const PRESETS = [
    mul(8), mul(8, 2), mul(8, 4), mul(8, 6), mul(8, 8),
    mul(8, 0, 4), mul(8, 0, 6), mul(8, 0, 8), mul(8, 0, 10), mul(8, 0, 12),
    mul(8, 2, 6), mul(8, 4, 4),
    { ...mul(8, 4), comp: true }, { ...mul(8, 6), comp: true },
    m(8, 'booth'), m(8, 'booth', { kTrunc: 4 }), m(8, 'booth', { kTrunc: 4, comp: true }),
    m(8, 'kulkarni'), m(8, 'kulkarni', { kBlock: 8 }),
    m(8, 'drum', { k: 3 }), m(8, 'drum', { k: 4 }), m(8, 'drum', { k: 6 }),
    m(8, 'mitchell'),
    mul(16), mul(16, 8), mul(16, 12), mul(16, 0, 12), mul(16, 0, 16), mul(16, 8, 8),
    m(16, 'booth'), m(16, 'booth', { kTrunc: 12, comp: true }), m(16, 'kulkarni'), m(16, 'drum', { k: 6 }), m(16, 'drum', { k: 8 }), m(16, 'mitchell'),
    add(8, 'exact'), add(8, 'trunc', { k: 2 }), add(8, 'trunc', { k: 4 }),
    add(8, 'loa', { k: 2 }), add(8, 'loa', { k: 4 }), add(8, 'loa', { k: 6 }),
    add(8, 'seg', { L: 4, P: 0 }), add(8, 'seg', { L: 4, P: 2 }), add(8, 'seg', { L: 2, P: 2 }),
    add(16, 'exact'), add(16, 'loa', { k: 4 }), add(16, 'loa', { k: 8 }),
    add(16, 'seg', { L: 4, P: 4 }), add(16, 'seg', { L: 8, P: 4 }),
];
