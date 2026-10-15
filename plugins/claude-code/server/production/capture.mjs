// Captures for the visual self-review, with no dependency: an installed Chromium-based browser (Edge, Chrome or
// Chromium) renders a page from a loopback server headless, driven over the DevTools protocol on a pipe, so the page
// is laid out at the exact viewport of each view. (A headless window's own size includes a frame on Windows: Edge laid
// a 390 by 844 window out at 492 by 705.) The browser gets a fresh profile each time and can reach only the loopback
// server: host names resolve nowhere and other connections go to a closed local proxy. Where the browser's own sandbox
// cannot start (as root, or in a container that blocks user namespaces), MOUSA_CAPTURE_NO_SANDBOX=1 adds --no-sandbox;
// verifyBrowser captures one test page first, so a host knows before a run whether captures work at all.

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pngSize } from './image-files.mjs';

export const CAPTURE_TIMING = Object.freeze({ timeoutMs: 45000, settleMs: 600, maxFullHeight: 3200 });
const TARGET = /^[A-Za-z][A-Za-z0-9_:=-]{0,59}$/u;
const TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' });
const MAX_SERVED_BYTES = 20 * 1024 * 1024;

function candidates({ env, platform }) {
  const explicit = [env.MOUSA_BROWSER, env.BROWSER_EXECUTABLE].filter(value => typeof value === 'string' && value.trim());
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.ProgramFiles || 'C:\\Program Files', env.LOCALAPPDATA].filter(Boolean);
    return [...explicit, ...roots.flatMap(root => [path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(root, 'Chromium', 'Application', 'chrome.exe')])];
  }
  if (platform === 'darwin') return [...explicit, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  return [...explicit, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
}

/** The browser's own name, for records: Microsoft Edge, Google Chrome or Chromium. */
const browserLabel = file => /msedge|microsoft[- ]edge/iu.test(file) ? 'Microsoft Edge' : /chromium/iu.test(file) ? 'Chromium' : /chrome/iu.test(file) ? 'Google Chrome' : path.basename(file);

/** The first installed Chromium-based browser, or the reason none can capture. */
export async function inspectBrowser({ env = process.env, platform = process.platform, access = file => fs.access(file) } = {}) {
  if (env.MOUSA_CAPTURE === 'off') return { available: false, reason: 'Capture is turned off with MOUSA_CAPTURE=off.' };
  for (const file of candidates({ env, platform })) {
    try { await access(file); return { available: true, path: file, name: path.basename(file), label: browserLabel(file) }; } catch { /* Try the next location. */ }
  }
  return { available: false, reason: 'No Chromium-based browser (Edge, Chrome or Chromium) was found. Set MOUSA_BROWSER to its executable.' };
}

/**
 * A headless browser on a DevTools pipe that can reach only loopback addresses, and with `allow` (host:port entries,
 * such as 127.0.0.1:4000) only those: the browser's implicit proxy bypass for loopback is withdrawn, so a page's request
 * to any other local port goes to the closed proxy like every other address.
 */
export function browserArgs({ profileDir, noSandbox = false, allow = [] }) {
  return ['--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-sync', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--no-pings', '--dns-prefetch-disable',
    '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,InterestFeedContentSuggestions',
    // The rules apply to IP literals too, so the loopback address is excluded by name.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9', '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    ...(allow.length ? [`--proxy-bypass-list=<-loopback>;${allow.join(';')}`] : []),
    ...(noSandbox ? ['--no-sandbox'] : []), `--user-data-dir=${profileDir}`, 'about:blank'];
}

/** The DevTools protocol over the pipe the browser reads on fd 3 and writes on fd 4: NUL-terminated JSON messages. */
function devtools(child) {
  const pending = new Map(), listeners = new Set();
  let next = 0, buffer = '', closed = null;
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString('utf8');
    for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(raw); } catch { continue; }
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`The browser refused ${message.error.message || 'a capture step'}.`)); else resolve(message.result || {});
      } else for (const listener of listeners) listener(message);
    }
  });
  const fail = error => { closed = error; for (const { reject } of pending.values()) reject(error); pending.clear(); };
  child.on('close', () => fail(new Error('The browser closed during the capture.')));
  child.stdio[3].on('error', () => {});
  return {
    send(method, params = {}, sessionId) {
      if (closed) return Promise.reject(closed);
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    once(method, sessionId) {
      return new Promise(resolve => {
        const listener = message => { if (message.method === method && (!sessionId || message.sessionId === sessionId)) { listeners.delete(listener); resolve(message.params || {}); } };
        listeners.add(listener);
      });
    },
  };
}

const withTimeout = (promise, timeoutMs, message) => {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]).finally(() => clearTimeout(timer));
};

/** What the browser's own error output says stopped it, in words an operator can act on, or null. */
export function browserFailure(output = '') {
  if (/No usable sandbox/iu.test(output)) return 'its sandbox needs user namespaces, which this system blocks (a default Docker container does). Allow them, or set MOUSA_CAPTURE_NO_SANDBOX=1 if the container is the isolation boundary.';
  if (/Running as root without --no-sandbox/iu.test(output)) return 'it does not run as root with its sandbox on. Run it as another user, or set MOUSA_CAPTURE_NO_SANDBOX=1.';
  const library = /error while loading shared libraries: ([\w.+-]{1,80})/u.exec(output)?.[1];
  return library ? `a library it needs is missing: ${library}.` : null;
}

/**
 * Capture loopback pages, one PNG per shot: each shot is {url, width, height, out, full?, maxHeight?, ready?}. The page
 * is laid out at exactly width by height (as a phone below 768 pixels wide), loaded, given its fonts and a moment to
 * settle, then captured; `full` captures the whole page height up to maxHeight, by default maxFullHeight, which a
 * report page raises. `ready` is an expression for a page that draws after it loads, such as a canvas: a promise that
 * resolves to true once the drawing is done, or to the text of what went wrong. One browser serves all shots of a call.
 */
export async function captureShots({ browser, shots, timeoutMs = CAPTURE_TIMING.timeoutMs, settleMs = CAPTURE_TIMING.settleMs, env = process.env, spawnImpl = spawn }) {
  if (!browser?.available || typeof browser.path !== 'string') throw new Error(browser?.reason || 'No browser is available to capture the page.');
  for (const shot of shots) {
    const address = new URL(shot.url);
    if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) throw new Error('Only a loopback page can be captured.');
  }
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-capture-'));
  // Host secrets stay out of the browser, as they stay out of Codex.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(key)));
  const noSandbox = ['1', 'true'].includes(String(env.MOUSA_CAPTURE_NO_SANDBOX || '').toLowerCase());
  // Only the servers the shots name are reachable, not every port on the loopback interface.
  const allow = [...new Set(shots.map(shot => new URL(shot.url).host))];
  const child = spawnImpl(browser.path, browserArgs({ profileDir, noSandbox, allow }), { env: childEnv, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const started = new Promise((resolve, reject) => { child.once('error', error => reject(error.code === 'ENOENT' ? new Error('The browser could not be started.') : error)); child.once('spawn', resolve); });
  // The tail of the browser's error output is kept to name why it stopped, such as a sandbox that cannot start.
  let output = '';
  child.stderr?.on('data', chunk => { output = (output + chunk.toString('utf8')).slice(-4000); });
  child.stderr?.on('error', () => {});
  const results = [];
  let closing = false;
  try {
    await withTimeout(started, 10000, 'The browser did not start.');
    const cdp = devtools(child);
    await withTimeout((async () => {
      for (const shot of shots) {
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: 1, mobile: shot.width < 768 }, sessionId);
        const loaded = cdp.once('Page.loadEventFired', sessionId);
        const navigation = await cdp.send('Page.navigate', { url: shot.url }, sessionId);
        if (navigation.errorText) throw new Error(`The page did not load: ${navigation.errorText}.`);
        await withTimeout(loaded, 20000, 'The page did not finish loading within 20 seconds.');
        if (shot.ready) {
          const drawn = await withTimeout(cdp.send('Runtime.evaluate', { expression: shot.ready, awaitPromise: true, returnByValue: true }, sessionId), 20000, 'The page did not finish drawing within 20 seconds.');
          if (drawn.exceptionDetails || drawn.result?.value !== true) throw new Error(`The page could not draw the capture: ${String(drawn.result?.value ?? drawn.exceptionDetails?.text ?? 'it gave no answer').slice(0, 240)}`);
        }
        await cdp.send('Runtime.evaluate', { expression: `document.fonts.ready.then(() => new Promise(done => setTimeout(done, ${Number(settleMs)})))`, awaitPromise: true, returnByValue: true }, sessionId);
        let clip;
        if (shot.full) {
          const { cssContentSize, contentSize } = await cdp.send('Page.getLayoutMetrics', {}, sessionId);
          const height = Math.min(shot.maxHeight ?? CAPTURE_TIMING.maxFullHeight, Math.max(shot.height, Math.ceil((cssContentSize || contentSize).height)));
          clip = { x: 0, y: 0, width: shot.width, height, scale: 1 };
        }
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) }, sessionId);
        const bytes = Buffer.from(data, 'base64');
        const size = pngSize(bytes);
        if (!size) throw new Error('The browser returned no screenshot.');
        await fs.mkdir(path.dirname(shot.out), { recursive: true });
        await fs.writeFile(shot.out, bytes);
        results.push({ file: shot.out, width: size.width, height: size.height, bytes: bytes.length });
        await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
      }
      closing = true;
      await cdp.send('Browser.close').catch(() => {});
    })(), timeoutMs, `The browser did not finish the capture within ${Math.round(timeoutMs / 1000)} seconds.`);
    return results;
  } catch (error) {
    const cause = browserFailure(output);
    throw cause ? new Error(`The browser could not run: ${cause}`, { cause: error }) : error;
  } finally {
    // A browser asked to close gets a moment to exit on its own; after a failure it is stopped at once.
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('close', resolve));
      if (closing) setTimeout(() => child.kill(), 1500).unref(); else child.kill();
      await withTimeout(exited, 5000, 'exit').catch(() => child.kill('SIGKILL'));
    }
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

const verified = new Map();

async function probeBrowser(browser, { env, spawnImpl, timeoutMs }) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><title>Capture check</title><p>Capture check</p>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-check-'));
  try {
    await captureShots({ browser, env, spawnImpl, timeoutMs, settleMs: 0, shots: [{ url: `http://127.0.0.1:${server.address().port}/`, width: 320, height: 240, out: path.join(outDir, 'check.png') }] });
    return browser;
  } catch (error) {
    const message = String(error?.message || 'It gave no answer.').replace(/[<>]/gu, '').slice(0, 220);
    return { available: false, label: browser.label || browser.name, reason: `${browser.label || browser.name || 'The browser'} could not capture a test page here. ${message}` };
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(() => resolve()));
    await fs.rm(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

/**
 * Whether an installed browser can capture here: one small loopback page is captured, once per executable and sandbox
 * setting for the life of the process. A browser that is installed but cannot run, such as Chromium whose sandbox
 * needs user namespaces a default container blocks, comes back unavailable with the reason, so a host leaves the
 * review out of its capability list instead of failing in the middle of a run. An unavailable browser passes through.
 */
export function verifyBrowser(browser, { env = process.env, spawnImpl, timeoutMs = 30000 } = {}) {
  if (!browser?.available) return Promise.resolve(browser);
  // A stand-in browser is checked each time; a real one once.
  if (spawnImpl) return probeBrowser(browser, { env, spawnImpl, timeoutMs });
  const key = `${browser.path}\0${String(env.MOUSA_CAPTURE_NO_SANDBOX || '').toLowerCase()}`;
  if (!verified.has(key)) verified.set(key, probeBrowser(browser, { env, timeoutMs }));
  return verified.get(key);
}

/**
 * A read-only loopback server for one folder, closed after the capture. It serves files with a known web type only, never
 * a dot-file or dot-folder (such as .env, .git or .mousa) or node_modules, and nothing outside the folder.
 */
export async function serveDirectory(root, { entry = 'index.html' } = {}) {
  const base = await fs.realpath(root);
  const server = http.createServer(async (request, response) => {
    const missing = () => { if (!response.headersSent) response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/u, '') || entry;
      const segments = name.split('/');
      if (segments.some(part => !part || part === '..' || part.startsWith('.') || part.toLowerCase() === 'node_modules' || /[\\:\u0000-\u001f]/u.test(part))) return missing();
      const type = TYPES[path.extname(name).toLowerCase()];
      if (!type) return missing();
      const file = await fs.realpath(path.join(base, ...segments));
      if (!file.startsWith(base + path.sep)) return missing();
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_SERVED_BYTES) return missing();
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') { response.end(); return; }
      createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch { missing(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

/** Whether `target` can name an element ID or route in a capture's URL fragment. */
export const captureTarget = value => typeof value === 'string' && TARGET.test(value);

/** The ID of one capture, and the name of its file without .png: <prefix>-<view>[-<target>][-full]. */
export const captureName = ({ prefix, view, target, full = false }) => [prefix, view.id, target ? target.replace(/[^A-Za-z0-9_-]/gu, '-') : null, full ? 'full' : null].filter(Boolean).join('-');

/**
 * Capture each view of a page that `baseUrl` serves, optionally scrolled to an element or route by `target` (the URL
 * fragment) or at its full height. Files are named <prefix>-<view>[-<target>][-full].png in `outDir`.
 */
export async function captureViews({ browser, baseUrl, entry = 'index.html', views, target, full = false, outDir, prefix, env, spawnImpl, timeoutMs, settleMs, ready }) {
  if (target !== undefined && !captureTarget(target)) throw new Error('target: use an element ID or route of letters, digits, hyphens, underscores, colons and equals signs.');
  const page = `${baseUrl.replace(/\/$/u, '')}/${entry.split('/').map(encodeURIComponent).join('/')}${target ? `#${target}` : ''}`;
  const named = views.map(view => ({ view, id: captureName({ prefix, view, target, full }) }));
  // `ready` is an expression the page resolves to true once it has drawn, for pages that draw after load.
  const shots = await captureShots({ browser, env, spawnImpl, timeoutMs, settleMs,
    shots: named.map(({ view, id }) => ({ url: page, width: view.width, height: view.height, full, out: path.join(outDir, `${id}.png`), ...(ready ? { ready } : {}) })) });
  return named.map(({ view, id }, index) => ({ id, view: view.id, ...(target ? { target } : {}), ...(full ? { full: true } : {}), width: shots[index].width, height: shots[index].height, bytes: shots[index].bytes, file: shots[index].file }));
}
