// Local static server for the game. It serves only the game folder, the bundled OFL font files and the tracks the
// music library's catalog lists, on the loopback interface, so nothing else in the project (such as .env) is
// reachable through it.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMusicLibrary, musicLibraryFile, sendLibraryFile } from './harness/music.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fonts = path.resolve(here, '..', 'library', 'fonts');
const port = Number(process.env.GAME_PORT || 8790);
const host = '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
const SERVED = /^(?:index\.html|compare\.html|styles\.css|src\/[a-z-]+\.js|world\/[a-z0-9-]+\.json|characters\/[a-z0-9-]+\.json|samples\/[a-z0-9-]+\.json|runs\/[a-z0-9-]+\/[a-z0-9-]+\.(?:json|jpg|png|webp))$/u;
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function resolve(pathname) {
  if (pathname === '/' || pathname === '/game' || pathname === '/game/') return { redirect: '/game/index.html' };
  // The stylesheet names its fonts relative to itself, so the same page works here and inside the Studio.
  for (const prefix of ['/game/fonts/', '/fonts/']) if (pathname.startsWith(prefix)) {
    const name = pathname.slice(prefix.length);
    return /^[a-z0-9-]+\.woff2$/u.test(name) ? { file: path.join(fonts, name) } : null;
  }
  if (!pathname.startsWith('/game/')) return null;
  let relative;
  try { relative = decodeURIComponent(pathname.slice('/game/'.length)); } catch { return null; }
  if (!SERVED.test(relative)) return null;
  const file = path.resolve(here, relative);
  return file.startsWith(here + path.sep) ? { file } : null;
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, HEADERS).end(); return; }
  const pathname = new URL(request.url, `http://${host}`).pathname;
  // The music library's catalog and listed tracks, at game/music/ as the pages name them.
  if (pathname.startsWith('/game/music/')) {
    const music = musicLibraryFile(root, await loadMusicLibrary(root), pathname.slice('/game/'.length));
    if (!music) { response.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
    try { await sendLibraryFile(request, response, music, HEADERS); }
    catch { if (!response.headersSent) response.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); response.end(); }
    return;
  }
  const target = resolve(pathname);
  if (target?.redirect) { response.writeHead(302, { ...HEADERS, Location: target.redirect }).end(); return; }
  if (!target) { response.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
  try {
    const body = await fs.readFile(target.file);
    response.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[path.extname(target.file)] || 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, host, () => console.log(`The Long Dusk: http://${host}:${port}/game/index.html`));
