/**
 * Peças FPGA da página de redes e a ocupação prevista de cada uma. As duas são da família Artix 7: o modelo de custo
 * (LUT, CARRY4, FF, DSP e os atrasos de data/vivado-units.json, medidos na xc7a100t) vale para as duas; a peça muda
 * só o projeto exportado (set_part) e a capacidade contra a qual a ocupação é conferida.
 */
export const PARTS = {
    'xc7a100tcsg324-1': { name: 'Artix 7 100T', luts: 63400, ff: 126800, dsp: 240, bram18: 270 },
    'xc7a200tsbg484-1': { name: 'Artix 7 200T', luts: 134600, ff: 269200, dsp: 740, bram18: 730 },
};

export const DEFAULT_PART = 'xc7a100tcsg324-1';

/** Recursos conferidos, na ordem em que aparecem. */
export const RESOURCES = [['luts', 'LUT'], ['ff', 'FF'], ['dsp', 'DSP'], ['bram18', 'BRAM18']];

/**
 * Ocupação prevista da peça: para cada recurso, o usado, a capacidade e a fração; over lista os que passam de 100%.
 * @param {{luts: number, ff: number, dsp: number, bram18: number}} totals
 * @param {string} part
 */
export function occupancy(totals, part) {
    const P = PARTS[part] ?? PARTS[DEFAULT_PART];
    const rows = RESOURCES.map(([k, label]) => ({ k, label, used: totals[k] ?? 0, cap: P[k], frac: (totals[k] ?? 0) / P[k] }));
    return { part, name: P.name, rows, over: rows.filter((r) => r.frac > 1) };
}

/** Texto da ocupação para o LEIAME e a linha de comando. */
export function occupancyText(o) {
    return `${o.rows.map((r) => `${r.label} ${r.used} de ${r.cap} (${Math.round(100 * r.frac)}%)`).join(', ')}${o.over.length ? `; NÃO CABE: ${o.over.map((r) => r.label).join(', ')} acima da capacidade` : ''}`;
}
