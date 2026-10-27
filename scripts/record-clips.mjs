#!/usr/bin/env node
// Records a short looping clip of each arm of a gallery comparison as it plays, for the site's pages. A headless
// browser plays the arm's published files from the built gallery on a loopback server, a scripted player presses the
// game's own keys in real time, and the frames become an animated WebP, with a still poster for visitors who ask for
// reduced motion. Each entry's player lives in scripts/clips/<entry id>.mjs: per arm, the scenes it plays.
//
// The clips are written beside the session's record (<runs>/<run>/clips/), where the gallery build finds them, and
// into the built gallery's entry, so a site already running shows them after a restart, without a rebuild.
//
//   node scripts/record-clips.mjs <entry id> [--runs D:/mousa-live] [--gallery <folder>] [--fps 12] [--width 800] [--keep]
//
// It needs a browser (MOUSA_BROWSER names one) and ffmpeg with libwebp (MOUSA_FFMPEG, or ffmpeg on the PATH). It makes
// no request beyond loopback; --keep leaves the sampled frames in the system's temporary folder.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { browserArgs, inspectBrowser, serveDirectory } from '../plugin/server/production/capture.mjs';
import { getConfig, loadDotEnv } from '../src/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const id = args.find((arg, at) => !arg.startsWith('--') && !(at > 0 && args[at - 1].startsWith('--') && args[at - 1] !== '--keep'));
if (!id) { console.error('usage: node scripts/record-clips.mjs <entry id> [--runs <folder>] [--gallery <folder>] [--fps 12] [--width 800] [--keep]'); process.exit(64); }
loadDotEnv?.();
const config = getConfig(process.env);
const runsDir = path.resolve(option('runs', 'D:/mousa-live'));
const galleryDir = path.resolve(option('gallery', path.join(config.dataDir, 'gallery')));
const fps = Number(option('fps', 12));
const width = Number(option('width', 800));
const ffmpeg = process.env.MOUSA_FFMPEG || 'ffmpeg';

const configured = JSON.parse(await fs.readFile(path.join(root, 'scripts', 'gallery.config.json'), 'utf8')).entries.find(entry => entry.id === id);
if (!configured?.run) throw new Error(`${id} is not a recorded run of scripts/gallery.config.json.`);
const player = (await import(pathToFileURL(path.join(root, 'scripts', 'clips', `${id}.mjs`)).href)).default;
const entryFile = path.join(galleryDir, id, 'entry.json');
const entry = JSON.parse(await fs.readFile(entryFile, 'utf8'));
const browser = await inspectBrowser();
if (!browser.available) throw new Error(browser.reason);

/** The DevTools protocol over the pipe the browser reads on fd 3 and writes on fd 4, as the capture module speaks it. */
function devtools(child) {
  const pending = new Map(), listeners = new Set();
  let next = 0, buffer = '';
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString('utf8');
    for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result || {});
      } else for (const listener of listeners) listener(message);
    }
  });
  child.on('close', () => { for (const { reject } of pending.values()) reject(new Error('The browser closed.')); pending.clear(); });
  return {
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const message = ++next;
      pending.set(message, { resolve, reject });
      child.stdio[3].write(`${JSON.stringify({ id: message, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    }),
    on: (method, sessionId, listener) => listeners.add(message => { if (message.method === method && message.sessionId === sessionId) listener(message.params); }),
    once: (method, sessionId) => new Promise(resolve => {
      const listener = message => { if (message.method === method && message.sessionId === sessionId) { listeners.delete(listener); resolve(message.params); } };
      listeners.add(listener);
    }),
  };
}

// What every scene can call in the page: the game's own keys, pressed as the arms' own play-tests press them.
const HELPERS = `window.__clip = {
  down: code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })),
  up: code => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })),
  press: code => { window.__clip.down(code); window.__clip.up(code); },
  sleep: ms => new Promise(done => setTimeout(done, ms)),
  frame: () => new Promise(done => requestAnimationFrame(done)),
  hold: async (code, ms) => { window.__clip.down(code); await window.__clip.sleep(ms); window.__clip.up(code); },
}; true`;

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`The page threw: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
  return result.result?.value;
}

/** Plays one arm's scenes and returns the screencast's frames with the time span of each scene. */
async function playArm(folder, arm) {
  const server = await serveDirectory(folder);
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-clip-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(key)));
  const child = spawn(browser.path, browserArgs({ profileDir, allow: [new URL(server.url).host] }), { env, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  child.stdio[3].on('error', () => {});
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const cdp = devtools(child);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    const viewport = arm.viewport || player.viewport;
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
    const loaded = cdp.once('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url: `${server.url}/${arm.page || 'index.html'}` });
    await loaded;
    await evaluate(send, 'Promise.resolve(window.captureReady).then(() => document.fonts.ready).then(() => new Promise(done => setTimeout(done, 400))).then(() => true)');
    await evaluate(send, HELPERS);
    const frames = [];
    cdp.on('Page.screencastFrame', sessionId, frame => {
      frames.push({ at: frame.metadata.timestamp, data: frame.data });
      send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    // A scene with `seconds` lasts exactly that long, so two arms' clips can play side by side scene for scene.
    const spans = [];
    for (const scene of arm.scenes) {
      if (scene.setup) await evaluate(send, `(${scene.setup})().then(() => true)`);
      await evaluate(send, 'new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 60)))).then(() => true)');
      const start = Date.now() / 1000;
      await evaluate(send, `(${scene.play})().then(() => true)`);
      const left = scene.seconds ? start + scene.seconds - Date.now() / 1000 : 0;
      if (left > 0) await new Promise(done => setTimeout(done, left * 1000));
      spans.push({ name: scene.name, start, end: scene.seconds ? start + scene.seconds : Date.now() / 1000 });
    }
    await send('Page.stopScreencast');
    await cdp.send('Browser.close').catch(() => {});
    return { frames: frames.sort((a, b) => a.at - b.at), spans, viewport };
  } finally {
    if (child.exitCode === null) child.kill();
    await server.close();
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

const outDir = path.join(runsDir, configured.run, 'clips');
await fs.mkdir(outDir, { recursive: true });
const made = [];
for (const [name, arm] of Object.entries(player.arms)) {
  const folder = path.join(galleryDir, id, 'out', name);
  const { frames, spans, viewport } = await playArm(folder, arm);
  if (!frames.length) throw new Error(`${name}: the browser sent no frames.`);
  // The screencast sends a frame when the page repaints; each tick of the clip shows the last frame drawn by then.
  const work = await fs.mkdtemp(path.join(os.tmpdir(), `mousa-clip-${name}-`));
  let count = 0;
  for (const span of spans) {
    for (let tick = span.start; tick < span.end; tick += 1 / fps) {
      const frame = frames.findLast(item => item.at <= tick) || frames.find(item => item.at > tick);
      await fs.writeFile(path.join(work, `f${String(++count).padStart(5, '0')}.jpg`), Buffer.from(frame.data, 'base64'));
    }
  }
  const height = Math.round(width * viewport.height / viewport.width / 2) * 2;
  const clip = path.join(outDir, `${name}.webp`), poster = path.join(outDir, `${name}.jpg`);
  await promisify(execFile)(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(work, 'f%05d.jpg'),
    '-vf', `scale=${width}:${height}:flags=lanczos`, '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '72', '-compression_level', '6', '-loop', '0', '-an', clip]);
  // The poster is a moment of one scene: `poster` names the scene's index and how far into it, 0.5 by default.
  const { scene: posterScene = 0, at: posterAt = 0.5 } = arm.poster || {};
  const before = spans.slice(0, posterScene).reduce((sum, span) => sum + Math.ceil((span.end - span.start) * fps), 0);
  const posterFrame = Math.max(1, before + Math.round(posterAt * (spans[posterScene].end - spans[posterScene].start) * fps));
  await promisify(execFile)(ffmpeg, ['-y', '-loglevel', 'error', '-i', path.join(work, `f${String(posterFrame).padStart(5, '0')}.jpg`), '-vf', `scale=${width}:${height}:flags=lanczos`, '-q:v', '3', poster]);
  if (!args.includes('--keep')) await fs.rm(work, { recursive: true, force: true });
  const seconds = Math.round(count / fps * 10) / 10;
  const label = entry.arms?.find(item => item.folder === name)?.label || name;
  made.push({ arm: name, label, file: `${name}.webp`, poster: `${name}.jpg`, width, height, seconds, scenes: spans.map(span => span.name) });
  console.log(`${name}: ${spans.map(span => `${span.name} ${(span.end - span.start).toFixed(1)} s`).join(', ')}; ${count} frames, ${(await fs.stat(clip)).size} bytes${args.includes('--keep') ? `; frames in ${work}` : ''}`);
}
await fs.writeFile(path.join(outDir, 'clips.json'), `${JSON.stringify({ entry: id, player: `scripts/clips/${id}.mjs`, fps, clips: made }, null, 2)}\n`);

// The built gallery shows them at once: the files beside the report, and the entry naming them.
const shown = path.join(galleryDir, id, 'report', 'clips');
await fs.mkdir(shown, { recursive: true });
for (const clip of made) for (const file of [clip.file, clip.poster]) await fs.copyFile(path.join(outDir, file), path.join(shown, file));
entry.clips = made.map(clip => ({ label: clip.label, file: `report/clips/${clip.file}`, poster: `report/clips/${clip.poster}`, width: clip.width, height: clip.height, seconds: clip.seconds, scenes: clip.scenes }));
await fs.writeFile(entryFile, `${JSON.stringify(entry, null, 2)}\n`);
console.log(`wrote ${made.length} clips to ${outDir} and ${shown}`);
