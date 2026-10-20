/**
 * Exploração em segundo plano (Web Worker), para a página não travar: recebe o código, as opções e os dados da
 * biblioteca; devolve o progresso e o resultado resumido (pontos avaliados, fronteiras, melhores pontos).
 */
import { explore, pointSummary } from './dse.js';

self.onmessage = (e) => {
    const { src, options, synth, cells } = e.data;
    let last = 0;
    try {
        const res = explore(src, {
            ...options, synth, cells,
            progress: (n) => { const now = Date.now(); if (now - last > 150) { last = now; self.postMessage({ type: 'progress', n }); } },
        });
        // As diretivas são as do código: aplicar um ponto não muda o editor.
        const sum = (p) => (p ? { ...pointSummary(p, res.ref), err: p.err, code: src } : null);
        self.postMessage({
            type: 'done',
            result: {
                variants: res.variants, ref: res.ref, refScore: res.refScore, ms: res.ms, prepMs: res.prepMs, candMs: res.candMs,
                runs: res.runs.map((r) => ({
                    heuristic: r.heuristic, evals: r.evals, ms: r.ms, error: r.error,
                    best: sum(r.best), chosen: sum(r.chosen), front: r.front.map(sum),
                    points: r.points.map((p) => ({ score: p.score, psnr: Math.min(...p.outs.map((o) => o.PSNR)), err: p.err, feasible: p.feasible, variant: p.variant })),
                    groups: r.traces[0]?.groups ?? [],
                    // Passo a passo, para a animação (os estados sem a lista de unidades, menos o último de cada passo).
                    steps: r.steps,
                })),
            },
        });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
