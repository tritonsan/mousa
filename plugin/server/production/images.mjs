import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeTasteName } from '../culture/taste.mjs';
import { jpegSize, pngSize, imagePalette } from './image-files.mjs';

/**
 * Generated images for taste-led builds, made by Codex's built-in image tool through the user's ChatGPT sign-in.
 * The host writes every prompt from one imagery device of the saved Design DNA (its name, colors and qualities) plus
 * the agent's one-sentence subject, so the taste the device translates directs the picture, and the prompt is recorded.
 * Codex runs only where it is installed and signed in, so a hosted deployment reports image generation as unavailable
 * and production plans fall back to methods that need no generator.
 */
export const IMAGE_LIMITS = Object.freeze({ perRun: 8, subjectMin: 10, subjectMax: 240, timeoutMs: 200000, convertTimeoutMs: 30000, maxWidth: 1600 });
export const IMAGE_ASPECTS = Object.freeze({ landscape: 'Landscape, 3:2.', portrait: 'Portrait, 2:3.', square: 'Square, 1:1.' });
export const GENERATED_IMAGE_PATH = /^generated\/[a-z0-9][a-z0-9_-]{0,60}\.(?:jpg|png)$/u;
// 0.160.0 is the first Codex CLI observed here with --ignore-user-config, --ephemeral and working image generation.
const MIN_CODEX = [0, 160, 0];
const run = promisify(execFile);
const isHex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);

export class ImageRequestError extends Error {
  constructor(message) { super(message); this.name = 'ImageRequestError'; this.code = 'IMAGE_REQUEST_INVALID'; }
}
function fail(message) { throw new ImageRequestError(message); }

const WORD = /[\p{L}\p{M}\p{N}]+|&/gu;
const wordsOf = value => [...value.matchAll(WORD)].map(match => ({ raw: match[0], key: match[0] === '&' ? 'and' : normalizeTasteName(match[0]), start: match.index, end: match.index + match[0].length }));

/**
 * Where a text names a taste entity: a multi-word name in any case or punctuation, a one-word name only as written,
 * as a proper noun, so "an island market at dusk" does not name a film called Island while "Anomalisa" does.
 */
function entityMentions(value, names) {
  const tokens = wordsOf(value), found = [];
  for (const name of names) {
    const parts = wordsOf(name.normalize('NFC'));
    // A leading article is not needed to name a work: "Office" names The Office.
    if (parts.length > 1 && ['the', 'a', 'an'].includes(parts[0].key)) parts.shift();
    if (!parts.length || parts.map(part => part.key).join(' ').length < 3) continue;
    for (let index = 0; index + parts.length <= tokens.length; index++) {
      const slice = tokens.slice(index, index + parts.length);
      if (!(parts.length > 1 ? slice.every((token, at) => token.key === parts[at].key) : slice[0].raw === parts[0].raw)) continue;
      // A directly preceding article belongs to the mention, so removing the name does not leave "the" behind.
      const start = index && ['the', 'a', 'an'].includes(tokens[index - 1].key) ? tokens[index - 1].start : slice[0].start;
      found.push({ name, start, end: slice.at(-1).end });
    }
  }
  return found;
}

/** The device's own words with any entity names removed: the art direction carries qualities, never a work to imitate. */
function withoutEntities(value, names) {
  const ranges = entityMentions(value, names).sort((a, b) => a.start - b.start), merged = [];
  for (const range of ranges) {
    if (merged.length && range.start <= merged.at(-1).end) merged.at(-1).end = Math.max(merged.at(-1).end, range.end);
    else merged.push({ ...range });
  }
  let result = value;
  for (const { start, end } of merged.reverse()) result = result.slice(0, start) + result.slice(end).replace(/^['’]s\b/u, '');
  result = result.replace(/\(\s*\)/gu, '').replace(/\s+/gu, ' ').replace(/\s+([,.;:!?])/gu, '$1');
  // A removed name can leave a dangling connective at either end, as in "photographs, after" or "of seasons".
  const connective = 'after|of|from|like|by|with|in|at|for|to|and|or|the|a|an';
  for (let previous; previous !== result;) {
    previous = result;
    result = result.replace(/[\s,;:–—-]+$/u, '').replace(new RegExp(`\\s+(?:${connective})$`, 'iu'), '')
      .replace(/^[\s,.;:–—-]+/u, '').replace(new RegExp(`^(?:${connective})\\s+`, 'iu'), '');
  }
  return result.trim();
}

/**
 * The host prompt for one image: the agent supplies only the subject; the art direction comes from the saved DNA device.
 * `figure` ({heads, parts}) is a game character's declared figure, so a portrait shows the proportions and garments the
 * game draws.
 */
export function buildImagePrompt({ dna, names = [], device: deviceId, subject, aspect = 'landscape', attempts = 0, figure = null } = {}) {
  if (attempts >= IMAGE_LIMITS.perRun) fail(`This run already requested ${IMAGE_LIMITS.perRun} images, the limit.`);
  const devices = Array.isArray(dna?.devices) ? dna.devices : [];
  const imagery = devices.filter(item => item?.layer === 'imagery');
  const device = imagery.find(item => item.id === deviceId);
  if (!device) fail(`device: use the ID of an imagery device in your saved culture-dna.json (${imagery.map(item => item.id).join(', ') || 'it has none, so this run cannot generate images'}).`);
  const length = `subject: describe the picture in one sentence of ${IMAGE_LIMITS.subjectMin}-${IMAGE_LIMITS.subjectMax} characters.`;
  if (typeof subject !== 'string' || /[\u0000-\u001f\u007f]/u.test(subject)) fail(length);
  const text = subject.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (text.length < IMAGE_LIMITS.subjectMin || text.length > IMAGE_LIMITS.subjectMax) fail(length);
  if (!Object.hasOwn(IMAGE_ASPECTS, aspect)) fail('aspect: use landscape, portrait or square.');
  const entityNames = [...new Set(names.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
  // Entities are cultural relationships, not picture content: a named film or band invites a copy of its stills or artwork.
  const named = [...new Set(entityMentions(text, entityNames).map(item => item.name))];
  if (named.length) fail(`subject: describe what the picture shows without naming taste entities (${named.slice(0, 4).join(', ')}); the device already carries the qualities you translate.`);
  if (/\b(?:qloo|kiro|codex|openai|chatgpt)\b/iu.test(text)) fail('subject: describe the picture, not the tools.');
  // The device's own colors, completed from the DNA palette devices, so every picture shares the page's colors.
  const own = (device.tokens?.colors || []).filter(isHex);
  const colors = (own.length >= 2 ? own : [...new Set([...own, ...devices.filter(item => item?.layer === 'palette').flatMap(item => item.tokens?.colors || []).filter(isHex)])]).slice(0, 6);
  const qualities = [...new Set((device.qualities || []).filter(value => typeof value === 'string').map(value => withoutEntities(value.normalize('NFC'), entityNames)).filter(Boolean))];
  const look = withoutEntities(String(device.device || '').normalize('NFC'), entityNames).replace(/[.\s]+$/u, '');
  const parts = Array.isArray(figure?.parts) ? figure.parts.filter(part => typeof part === 'string' && /^[a-z0-9 ]{2,40}$/u.test(part))
    .map(part => withoutEntities(part, entityNames)).filter(Boolean).slice(0, 6) : [];
  const heads = Number.isFinite(figure?.heads) && figure.heads >= 1.5 && figure.heads <= 12 ? figure.heads : null;
  const body = heads || parts.length ? `Figure: ${[heads ? `about ${heads} heads tall` : '', parts.length ? `with ${parts.join(', ')}` : ''].filter(Boolean).join(', ')}.` : '';
  const direction = [look ? `Art direction: ${look}.` : '', colors.length ? `Palette: ${colors.join(', ')}.` : '', qualities.length ? `Qualities: ${qualities.join(', ')}.` : '', body].filter(Boolean).join(' ');
  const prompt = ['Use your built-in image generation tool to create exactly one image, then reply with one sentence describing what it shows. Do not write code, run commands or create files yourself.',
    `Subject: ${text}`, direction, 'No text, letters, numbers, logos, brand marks, recognizable people or copyrighted characters.', IMAGE_ASPECTS[aspect]].filter(Boolean).join('\n');
  return { device: device.id, subject: text, aspect, prompt };
}

function parseVersion(output) {
  const match = /codex-cli\s+(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/u.exec(String(output));
  return match ? { text: `${match[1]}.${match[2]}.${match[3]}${match[4] || ''}`, parts: match.slice(1, 4).map(Number), prerelease: Boolean(match[4]) } : null;
}
function compareVersions(a, b) {
  for (let index = 0; index < 3; index++) if (a.parts[index] !== b.parts[index]) return a.parts[index] - b.parts[index];
  return Number(b.prerelease) - Number(a.prerelease);
}

/** The explicit CODEX_CLI_PATH, else every CLI the Codex app bundles on Windows, else `codex` on PATH elsewhere. */
async function codexCandidates({ config, env, platform }) {
  if (config?.codexCliPath) return [config.codexCliPath];
  if (platform !== 'win32') return ['codex'];
  const bin = path.join(env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin'), found = [];
  for (const entry of await fs.readdir(bin, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) found.push(path.join(bin, entry.name, 'codex.exe'));
    else if (entry.name.toLowerCase() === 'codex.exe') found.push(path.join(bin, entry.name));
  }
  return found;
}

/** Codex is usable only when a recent CLI is signed in with ChatGPT, so images draw on the plan rather than an API key. */
export async function inspectCodex({ config, env = process.env, platform = process.platform, execImpl = run } = {}) {
  if (config?.codexImages === 'off') return { available: false, provider: 'codex', reason: 'Image generation is turned off with CODEX_IMAGES=off.' };
  const options = { timeout: 20000, windowsHide: true, maxBuffer: 200000, env };
  let best = null;
  for (const file of await codexCandidates({ config, env, platform })) {
    try {
      const version = parseVersion((await execImpl(file, ['--version'], options)).stdout);
      if (version && (!best || compareVersions(version, best.version) > 0)) best = { file, version };
    } catch { /* A missing or broken candidate is skipped; another may work. */ }
  }
  if (!best) return { available: false, provider: 'codex', reason: 'No Codex CLI was found. Install the Codex app or set CODEX_CLI_PATH.' };
  if (compareVersions(best.version, { parts: MIN_CODEX, prerelease: false }) < 0) return { available: false, provider: 'codex', version: best.version.text, reason: `Codex CLI ${best.version.text} is older than ${MIN_CODEX.join('.')}.` };
  try {
    const { stdout, stderr } = await execImpl(best.file, ['login', 'status'], options);
    if (!/Logged in using ChatGPT/iu.test(`${stdout}\n${stderr}`)) return { available: false, provider: 'codex', version: best.version.text, reason: 'Codex is not signed in with ChatGPT, so images would not use the ChatGPT plan.' };
  } catch { return { available: false, provider: 'codex', version: best.version.text, reason: 'The Codex sign-in could not be checked.' }; }
  return { available: true, provider: 'codex', version: best.version.text, path: best.file };
}

/**
 * One non-interactive turn: no user config, no shell tool, a read-only sandbox, low reasoning and no saved session.
 * `images` are attached to the prompt, for an edit of a picture the host made; the prompt stays the last argument.
 */
export function codexImageArgs({ prompt, workDir, images = [] }) {
  return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--disable', 'shell_tool', '--sandbox', 'read-only',
    '-c', 'model_reasoning_effort="low"', ...images.flatMap(file => ['--image', file]), '--cd', workDir, '--json', prompt];
}

export function parseCodexEvents(stdout) {
  let threadId = null, reply = '', usage = null, error = null;
  for (const line of String(stdout).split(/\r?\n/u)) {
    if (!line.trim().startsWith('{')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
    else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') reply = event.item.text;
    else if (event.type === 'turn.completed') usage = event.usage || null;
    else if (event.type === 'turn.failed' || event.type === 'error') error = String(event.error?.message || event.message || 'Codex reported an error.').slice(0, 300);
  }
  return { threadId: threadId && /^[0-9a-f-]{36}$/u.test(threadId) ? threadId : null, reply: reply.replace(/\s+/gu, ' ').trim().slice(0, 400), usage, error };
}

function runProcess(spawnImpl, file, args, { env, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('The job was cancelled.'));
    const child = spawnImpl(file, args, { env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); settle(value);
    };
    const abort = () => { child.kill(); finish(reject, new Error('The job was cancelled.')); };
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error(`Codex did not finish the image within ${Math.round(timeoutMs / 1000)} seconds.`)); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { if (stdout.length < 2_000_000) stdout += chunk; });
    child.stderr.on('data', chunk => { if (stderr.length < 20000) stderr += chunk; });
    child.on('error', error => finish(reject, error.code === 'ENOENT' ? new Error('The Codex CLI could not be started.') : error));
    child.on('close', code => finish(resolve, { code, stdout, stderr }));
  });
}

/** The generated PNG copied as it is, for a picture the host cuts apart. */
async function keptPng(source, target) {
  await fs.copyFile(source, `${target}.png`);
  const bytes = await fs.readFile(`${target}.png`);
  return { file: `${target}.png`, format: 'png', ...(pngSize(bytes) || { width: null, height: null }), bytes: bytes.length };
}

/** A web-sized JPEG through Windows' own imaging library; elsewhere, or if that fails, the generated PNG is kept. */
async function toWebImage(source, target, { platform, env, execImpl }) {
  if (platform === 'win32') {
    // Paths travel in environment variables, never in the script text.
    const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $src=[System.Drawing.Image]::FromFile($env:MOUSA_IMAGE_IN); try { "
      + "$w=[Math]::Min($src.Width,[int]$env:MOUSA_IMAGE_MAX); $h=[int][Math]::Round($src.Height*$w/$src.Width); $bmp=New-Object System.Drawing.Bitmap $w,$h; $g=[System.Drawing.Graphics]::FromImage($bmp); "
      + "$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g.DrawImage($src,0,0,$w,$h); "
      + "$codec=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }; $p=New-Object System.Drawing.Imaging.EncoderParameters 1; "
      + "$p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality,[long]84); $bmp.Save($env:MOUSA_IMAGE_OUT,$codec,$p); $g.Dispose(); $bmp.Dispose() } finally { $src.Dispose() }";
    try {
      const shell = path.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      await execImpl(shell, ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: IMAGE_LIMITS.convertTimeoutMs, windowsHide: true,
        env: { ...env, MOUSA_IMAGE_IN: source, MOUSA_IMAGE_OUT: `${target}.jpg`, MOUSA_IMAGE_MAX: String(IMAGE_LIMITS.maxWidth) } });
      const bytes = await fs.readFile(`${target}.jpg`);
      const size = jpegSize(bytes);
      if (size) return { file: `${target}.jpg`, format: 'jpeg', width: size.width, height: size.height, bytes: bytes.length };
    } catch { /* Keep the generated PNG instead. */ }
    await fs.rm(`${target}.jpg`, { force: true });
  }
  await fs.copyFile(source, `${target}.png`);
  const bytes = await fs.readFile(`${target}.png`);
  return { file: `${target}.png`, format: 'png', ...(pngSize(bytes) || { width: null, height: null }), bytes: bytes.length };
}

/**
 * The production generator. Codex saves each image under $CODEX_HOME/generated_images/<session>/; the host moves it into
 * the run's asset folder and removes that session folder, so the user's Codex home does not fill with demo images.
 * `attach` names a PNG the host made, copied into the work folder as blueprint.png and attached to the prompt, so Codex
 * edits it; `keepPng` keeps the generated PNG as it is, alpha and flat key colours intact, instead of a web JPEG.
 */
export function createCodexImageGenerator({ codex, env = process.env, platform = process.platform, spawnImpl = spawn, execImpl = run }) {
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  // Host secrets stay out of Codex: it signs in with the stored ChatGPT session, so an API key in the environment is never used.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(key)));
  return {
    // The executable is kept so a game character pair can hand it to the design server it starts for each arm.
    available: true, provider: 'codex', version: codex.version, path: codex.path,
    async generate({ prompt, directory, name, signal, timeoutMs = IMAGE_LIMITS.timeoutMs, attach = null, keepPng = false }) {
      if (!/^[a-z0-9][a-z0-9_-]{0,60}$/u.test(name)) throw new Error('Invalid generated image name.');
      // An empty folder per request: Codex runs read-only there and has nothing of the project to read but the attachment.
      const workDir = path.join(directory, '..', 'codex-work', name);
      await fs.mkdir(workDir, { recursive: true }); await fs.mkdir(directory, { recursive: true });
      const started = Date.now();
      try {
        const attached = [];
        if (attach) {
          const copy = path.join(workDir, 'blueprint.png');
          await fs.copyFile(attach, copy);
          attached.push(copy);
        }
        const result = await runProcess(spawnImpl, codex.path, codexImageArgs({ prompt, workDir, images: attached }), { env: childEnv, signal, timeoutMs });
        const events = parseCodexEvents(result.stdout);
        if (result.code !== 0 || events.error) throw new Error(`Codex could not generate the image: ${events.error || result.stderr.trim().split(/\r?\n/u).at(-1)?.slice(0, 200) || `exit code ${result.code}`}`);
        if (!events.threadId) throw new Error('Codex finished without reporting its session, so the image could not be located.');
        const session = path.join(home, 'generated_images', events.threadId);
        const images = [];
        for (const file of await fs.readdir(session).catch(() => [])) if (/\.(?:png|jpe?g|webp)$/iu.test(file)) images.push({ file: path.join(session, file), time: (await fs.stat(path.join(session, file))).mtimeMs });
        const newest = images.sort((a, b) => b.time - a.time)[0];
        if (!newest) throw new Error('Codex finished without saving an image.');
        // The main colours are read from the generated PNG before it becomes a JPEG.
        const palette = await fs.readFile(newest.file).then(bytes => imagePalette(bytes)).catch(() => null);
        const saved = keepPng && /\.png$/iu.test(newest.file) ? await keptPng(newest.file, path.join(directory, name)) : await toWebImage(newest.file, path.join(directory, name), { platform, env: childEnv, execImpl });
        await fs.rm(session, { recursive: true, force: true });
        return { path: `generated/${path.basename(saved.file)}`, format: saved.format, width: saved.width, height: saved.height, bytes: saved.bytes,
          durationMs: Date.now() - started, description: events.reply, usage: events.usage, ...(palette?.length ? { palette } : {}) };
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
        // Removed only once empty, so a parallel request keeps its own folder.
        await fs.rmdir(path.dirname(workDir)).catch(() => {});
      }
    },
  };
}

/** The Studio's generator: Codex when it is installed and signed in with ChatGPT, otherwise a disabled status with its reason. */
export async function createImageGenerator(config, options = {}) {
  const codex = await inspectCodex({ config, ...options });
  if (!codex.available) return { available: false, provider: codex.provider, ...(codex.version ? { version: codex.version } : {}), reason: codex.reason };
  return createCodexImageGenerator({ codex, ...options });
}
