// Serves this game on a loopback port for a browser: its own files only, never a dot-folder such as .mousa, and
// nothing outside this folder. Stop it with Ctrl+C.
//
//   node serve.mjs [port]

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer(async (request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/u, '') || 'index.html';
  const parts = name.split('/');
  const file = path.join(here, ...parts);
  if (parts.some(part => !part || part.startsWith('.') || part === '..') || !TYPES[path.extname(name)] || !file.startsWith(here + path.sep)) { response.writeHead(404).end('Not found'); return; }
  try { const body = await fs.readFile(file); response.writeHead(200, { 'Content-Type': TYPES[path.extname(name)], 'Cache-Control': 'no-store' }).end(body); }
  catch { response.writeHead(404).end('Not found'); }
});
server.listen(Number(process.argv[2]) || 8795, '127.0.0.1', () => console.log(`The Long Dusk: http://127.0.0.1:${server.address().port}/index.html`));
