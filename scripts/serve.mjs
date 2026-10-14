#!/usr/bin/env node
/**
 * Servidor local para desenvolvimento (npm start): arquivos estáticos sem cache, para o navegador nunca misturar
 * uma versão nova do index.html com módulos JavaScript antigos.
 * Uso: node scripts/serve.mjs [porta]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = +(process.argv[2] ?? 8005);
const root = process.cwd();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.v': 'text/plain; charset=utf-8' };

createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('não encontrado');
    }
}).listen(port, () => console.log(`http://localhost:${port}/`));
