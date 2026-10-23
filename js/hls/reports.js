/**
 * Leitura dos relatórios do Vitis HLS (csynth.xml) e do Vivado (export_impl.xml, utilization.rpt), sem acesso a
 * arquivos: recebem o texto. Usadas por scripts/vitis.mjs (validação dos kernels) e por node bin/axc.mjs nnvitis
 * (projetos das redes).
 */
export const tag = (xml, name) => { const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml); return m ? m[1].trim() : null; };
export const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : +v);

/** Laços do csynth.xml: todos os elementos com PipelineII ou TripCount dentro de SummaryOfLoopLatency. */
export function loopsOf(xml) {
    const sec = /<SummaryOfLoopLatency>([\s\S]*?)<\/SummaryOfLoopLatency>/.exec(xml)?.[1] ?? '';
    const out = [];
    const re = /<([A-Za-z_][\w.]*)>\s*<(?:Name|Slack|TripCount|Latency|IterationLatency|PipelineII|PipelineDepth)/g;
    let m;
    while ((m = re.exec(sec))) {
        const name = m[1];
        const start = m.index;
        const end = sec.indexOf(`</${name}>`, start);
        const body = sec.slice(start, end);
        // Só os campos deste laço (antes do primeiro laço aninhado).
        const own = body.replace(/<([A-Za-z_][\w.]*)>\s*<(?:Name|Slack|TripCount|Latency)[\s\S]*$/, (x, n2) => (n2 === name ? x : ''));
        out.push({ name, trip: num(tag(own, 'TripCount')), latency: num(tag(own, 'Latency')), iterLatency: num(tag(own, 'IterationLatency')), II: num(tag(own, 'PipelineII')), depth: num(tag(own, 'PipelineDepth')) });
    }
    return out;
}

/** Módulos do relatório do Vivado (as unidades aproximadas são os u_*): LUT e FF de cada instância. */
export function modulesOf(xml) {
    const out = new Map();
    const re = /<RtlModule CELL="([^"]+)"[^>]*DEPTH="(\d+)"[^>]*MODULENAME="([^"]+)"[^>]*>\s*(?:<SubModules[^<]*<\/SubModules>\s*)?<Resources([^/]*)\/>/g;
    let m;
    while ((m = re.exec(xml))) {
        if (m[2] === '0') continue;
        const lut = +(/LUT="(\d+)"/.exec(m[4])?.[1] ?? 0), ff = +(/FF="(\d+)"/.exec(m[4])?.[1] ?? 0);
        const dsp = +(/DSP="(\d+)"/.exec(m[4])?.[1] ?? 0);
        const k = m[3];
        if (!out.has(k)) out.set(k, { module: k, count: 0, lut: 0, ff: 0, dsp: 0, depth: +m[2] });
        const o = out.get(k);
        o.count++; o.lut += lut; o.ff += ff; o.dsp += dsp;
    }
    return [...out.values()];
}

/** Resumo de um csynth.xml: latência, intervalo, período estimado, recursos e laços. */
export function csynthSummary(x) {
    const res = /<AreaEstimates>[\s\S]*?<Resources>([\s\S]*?)<\/Resources>/.exec(x)?.[1] ?? '';
    return {
        estClockNs: num(tag(x, 'EstimatedClockPeriod')), latencyBest: num(tag(x, 'Best-caseLatency')), latencyWorst: num(tag(x, 'Worst-caseLatency')),
        intervalMin: num(tag(x, 'Interval-min')), lut: num(tag(res, 'LUT')), ff: num(tag(res, 'FF')), dsp: num(tag(res, 'DSP')) ?? num(tag(res, 'DSP48E')), bram: num(tag(res, 'BRAM_18K')),
        loops: loopsOf(x),
    };
}

/** Resumo do XML do Vivado depois do roteamento (export_design -flow impl). */
export function implSummary(x) {
    const area = /<AreaReport>([\s\S]*?)<\/AreaReport>/.exec(x)?.[1] ?? x;
    return {
        modules: modulesOf(x), lut: num(tag(area, 'LUT')), ff: num(tag(area, 'FF')), dsp: num(tag(area, 'DSP')), slice: num(tag(area, 'SLICE')), bram: num(tag(area, 'BRAM')),
        achievedNs: num(tag(x, 'AchievedClockPeriod')) ?? num(tag(x, 'CP_FINAL')), timingMet: tag(x, 'TIMING_MET'),
    };
}

/** CARRY4 do relatório de utilização do Vivado. */
export const carry4Of = (rpt) => { const m = /\|\s*CARRY4\s*\|\s*(\d+)/.exec(rpt); return m ? +m[1] : null; };
