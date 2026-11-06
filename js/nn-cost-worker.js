/**
 * Custo do hardware da página de redes em segundo plano (js/axc/nngen.js, networkCost): na ResNet 8, montar o modelo
 * de custo leva cerca de um minuto (a elaboração das convoluções), e a página não pode travar. O worker fica vivo
 * entre as chamadas e guarda os projetos elaborados (o cache de nngen.js), então trocar as unidades é rápido.
 *
 * Mensagem: {id, file, job} com job = as opções de networkCost sem os dados (target, clockNs, mul, add, mask, dirs,
 * units); resposta: {id, result} ou {id, error}.
 */
import { decodeNet } from './axc/nn.js';
import { networkCost } from './axc/nngen.js';

const base = new URL('../', import.meta.url);
const getJson = (f) => fetch(new URL(f, base).href).then((r) => (r.ok ? r.json() : Promise.reject(new Error(f))));
let data = null;
const nets = new Map();

self.onmessage = async ({ data: { id, file, job } }) => {
    try {
        data ??= await Promise.all([getJson('data/synth.json'), getJson('data/hls-cells.json'), getJson('data/vivado-units.json').catch(() => null)]).then(([synth, cells, fpga]) => ({ synth, cells, fpga }));
        if (!nets.has(file)) nets.set(file, getJson(file).then(decodeNet));
        const net = await nets.get(file);
        self.postMessage({ id, result: networkCost(net, { ...data, ...job }) });
    } catch (e) {
        self.postMessage({ id, error: e.message });
    }
};
