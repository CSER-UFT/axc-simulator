/**
 * Exportação do projeto da rede para o Vitis HLS e o Vivado em segundo plano (página de redes): carrega os dados, gera
 * os arquivos (js/axc/nnexport.js) e devolve o .zip.
 */
import { decodeNet, decodeTestSet } from './axc/nn.js';
import { networkProject } from './axc/nnexport.js';
import { makeZip } from './ui/zip.js';

const getJson = (f) => fetch(f).then((r) => (r.ok ? r.json() : Promise.reject(new Error(f))));
const getBin = (f) => fetch(f).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(f))));
const base = new URL('../', import.meta.url);
const url = (f) => new URL(f, base).href;

self.onmessage = async ({ data: o }) => {
    try {
        const [synth, cells, fpga, netJson] = await Promise.all([getJson(url('data/synth.json')), getJson(url('data/hls-cells.json')), getJson(url('data/vivado-units.json')).catch(() => null), getJson(url(o.file))]);
        const net = decodeNet(netJson);
        const test = decodeTestSet(await getBin(url(net.dataset.file)), net.dataset);
        self.postMessage({ type: 'status', key: 'nn.exportBuilding' });
        let last = 0;
        const { files, summary } = networkProject(net, {
            synth, cells, fpga, target: 'fpga', clockNs: o.clockNs, dirs: o.dirs, units: o.units, test, images: o.images, id: o.id, layers: o.layers,
            progress: (k, n) => { const now = Date.now(); if (now - last > 300 || k === n) { last = now; self.postMessage({ type: 'progress', k, n }); } },
        });
        const zip = makeZip(Object.fromEntries(Object.entries(files).map(([f, c]) => [`${o.id}/${f}`, c])));
        self.postMessage({ type: 'done', zip, files: Object.keys(files).length, summary }, [zip.buffer]);
    } catch (e) {
        self.postMessage({ type: 'error', message: e.message });
    }
};
