/**
 * Worker de avaliação da busca da página de redes: classifica as configurações que o worker da busca manda
 * (js/axc/nnsearch.js, evalHandler).
 */
import { evalHandler } from './axc/nnsearch.js';

const handle = evalHandler();
self.onmessage = ({ data: { id, msg } }) => {
    try { self.postMessage({ id, reply: handle(msg) }); } catch (e) { self.postMessage({ id, reply: { type: 'error', message: e.message } }); }
};
