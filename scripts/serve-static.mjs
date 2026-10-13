#!/usr/bin/env node
// Serves one folder on a fixed loopback port, to look at recorded output in a browser: GET and HEAD of known web file
// types only, never a dot-file or dot-folder and nothing outside the folder. It listens on 127.0.0.1 alone and has
// no sign-in, so it is for this machine only. Stop it with Ctrl+C.
//
//   node scripts/serve-static.mjs <folder> [port]

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
});

const root = path.resolve(process.argv[2] || '.');
const port = Number.parseInt(process.argv[3] || '8792', 10);

const server = http.createServer(async (request, response) => {
  const refuse = status => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(status === 405 ? 'Method not allowed' : 'Not found'); };
  if (!['GET', 'HEAD'].includes(request.method)) return refuse(405);
  let name;
  try { name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); } catch { return refuse(404); }
  if (name.endsWith('/')) name += 'index.html';
  const parts = name.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part.startsWith('.') || /[\\:]/u.test(part))) return refuse(404);
  const file = path.join(root, ...parts), type = TYPES[path.extname(file).toLowerCase()];
  if (!type || !file.startsWith(root + path.sep)) return refuse(404);
  try {
    const bytes = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { refuse(404); }
});
server.listen(port, '127.0.0.1', () => console.log(`Serving ${root} at http://127.0.0.1:${port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
