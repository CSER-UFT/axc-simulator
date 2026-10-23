/**
 * Worker de avaliação da busca das redes (node bin/axc.mjs nnsearch --workers N): recebe a rede e o conjunto de
 * validação e classifica as configurações que a busca manda (js/axc/nnsearch.js, evalHandler).
 */
import { parentPort } from 'node:worker_threads';
import { evalHandler } from '../js/axc/nnsearch.js';

const handle = evalHandler();
parentPort.on('message', ({ id, msg }) => {
    try { parentPort.postMessage({ id, reply: handle(msg) }); } catch (e) { parentPort.postMessage({ id, reply: { type: 'error', message: e.message } }); }
});
