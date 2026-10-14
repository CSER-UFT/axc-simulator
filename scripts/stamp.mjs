#!/usr/bin/env node
/**
 * Marca a versão nos arquivos do site publicado (pasta _site), para o navegador não misturar versões depois de
 * uma atualização: o GitHub Pages deixa os arquivos em cache por alguns minutos, e um index.html novo com um
 * módulo JavaScript antigo quebra a página. Acrescenta ?v=<versão> ao app.js e às folhas de estilo e um import
 * map que faz o mesmo com todos os módulos importados.
 * Uso: node scripts/stamp.mjs _site <versão>
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !version) { console.error('uso: node scripts/stamp.mjs <pasta> <versão>'); process.exit(1); }
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk(join(dir, 'js'));
const imports = Object.fromEntries(files.map((f) => { const r = `./${relative(dir, f).split('\\').join('/')}`; return [r, `${r}?v=${version}`]; }));
const index = join(dir, 'index.html');
let html = readFileSync(index, 'utf8');
html = html.replace(/(href="\.\/css\/[^"]+\.css)"/g, `$1?v=${version}"`);
html = html.replace('<script type="module" src="js/app.js"></script>',
    `<script type="importmap">${JSON.stringify({ imports })}</script>\n        <script type="module" src="./js/app.js?v=${version}"></script>`);
html = html.replace("fetch('data/synth.json')", `fetch('data/synth.json?v=${version}')`);
writeFileSync(index, html);
// O app.js busca data/synth.json pelo próprio código: a versão vai no endereço.
const app = join(dir, 'js', 'app.js');
writeFileSync(app, readFileSync(app, 'utf8').replace("fetch('data/synth.json')", `fetch('data/synth.json?v=${version}')`));
console.log(`${files.length} módulos marcados com ?v=${version}`);
