// O custo das redes roda num worker na página (js/nn-cost-worker.js), e a pilha de um worker é menor que a da linha
// de comando. Math.min(...tabela) com os 56 mil pesos da densa da MiniLenet na CIFAR 10 estourava a pilha lá
// ("Maximum call stack size exceeded") e passava aqui. Este teste roda o custo num worker com pilha pequena.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

const code = `
import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
const R = ${JSON.stringify(new URL('../', import.meta.url).href)};
const { decodeNet } = await import(R + 'js/axc/nn.js');
const { networkCost } = await import(R + 'js/axc/nngen.js');
const j = (f) => JSON.parse(readFileSync(new URL(f, R), 'utf8'));
const net = decodeNet(j('data/nn/minilenet-cifar10.json'));
const r = networkCost(net, { synth: j('data/synth.json'), cells: j('data/hls-cells.json'), fpga: null, target: 'asic', clockNs: 10, mul: null, add: null, mask: net.sites.map(() => true) });
parentPort.postMessage(r.totals.cycles);
`;

test('custo da MiniLenet na CIFAR 10 num worker com pilha pequena', async () => {
    const w = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`), { resourceLimits: { stackSizeMb: 0.5 } });
    const cycles = await new Promise((res, rej) => { w.once('message', res); w.once('error', rej); });
    await w.terminate();
    assert.ok(cycles > 0);
});
