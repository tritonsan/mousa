import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { IMAGE_LIMITS, ImageRequestError, buildImagePrompt, codexImageArgs, parseCodexEvents, inspectCodex, createCodexImageGenerator, createImageGenerator } from '../src/image-generator.mjs';
import { jpegSize } from '../src/library.mjs';

// Test-only Design DNA and names. No real Codex process or image request is made unless a test says so.
const DNA = { devices: [
  { id: 'dna1', layer: 'palette', device: 'Midnight and brass palette', tokens: { colors: ['#111111', '#c9a227'] } },
  { id: 'dna2', layer: 'typography', device: 'Engraved serif headings', tokens: { fonts: ['Georgia'] } },
  { id: 'dna5', layer: 'imagery', device: 'Anomalisa night-lobby photographs, after The Grand Budapest Hotel', qualities: ['Moody', 'Hotel'], tokens: { colors: ['#0b1d3a'], css: [{ property: 'object-fit', value: 'cover' }] } },
  { id: 'dna6', layer: 'imagery', device: 'Bright market close-ups', qualities: ['Close-up'], tokens: { colors: ['#f4efe6', '#2c6e49'] } },
  // Shaped like a live device anchored to the novel Island: the name opens the device, and the common word stays.
  { id: 'dna8', layer: 'imagery', device: 'Island of seasons: an imagined island garden pantry', qualities: ['Utopia'], tokens: { colors: ['#1f4e5a', '#7fc4bb'] } },
] };
const NAMES = ['Anomalisa', 'The Grand Budapest Hotel', 'Nujabes', 'Island'];

test('the host writes each image prompt from the imagery device and keeps taste entities out of it', () => {
  const request = buildImagePrompt({ dna: DNA, names: NAMES, device: 'dna5', subject: '  Olive oil bottles on a dark marble counter at night ' });
  assert.equal(request.device, 'dna5'); assert.equal(request.aspect, 'landscape');
  assert.equal(request.subject, 'Olive oil bottles on a dark marble counter at night');
  const lines = request.prompt.split('\n');
  assert.match(lines[0], /^Use your built-in image generation tool to create exactly one image/);
  assert.equal(lines[1], 'Subject: Olive oil bottles on a dark marble counter at night');
  // One device color is completed from the DNA palette; entity names leave the device's own words.
  assert.equal(lines[2], 'Art direction: night-lobby photographs. Palette: #0b1d3a, #111111, #c9a227. Qualities: Moody, Hotel.');
  assert.match(lines[3], /No text, letters, numbers, logos, brand marks, recognizable people or copyrighted characters/);
  assert.equal(lines[4], 'Landscape, 3:2.');
  assert.doesNotMatch(request.prompt, /Anomalisa|Budapest/u);
  const own = buildImagePrompt({ dna: DNA, names: NAMES, device: 'dna6', subject: 'Tomatoes and basil in a crate, seen from above', aspect: 'square' });
  assert.match(own.prompt, /Palette: #f4efe6, #2c6e49\./); assert.match(own.prompt, /Square, 1:1\.$/);
  const island = buildImagePrompt({ dna: DNA, names: NAMES, device: 'dna8', subject: 'Terraced olive trees above a lagoon at dusk' });
  assert.match(island.prompt, /\nArt direction: seasons: an imagined island garden pantry\. Palette/);
});

test('a game portrait states the figure the game draws: its height in heads and its garments, without entity names', () => {
  const portrait = (figure, subject = 'A small tinker with a lantern on a cliff road at dusk') => buildImagePrompt({ dna: DNA, names: NAMES, device: 'dna6', subject, figure }).prompt.split('\n')[2];
  assert.equal(portrait({ heads: 3.5, parts: ['wide hat', 'satchel', 'boots'] }), 'Art direction: Bright market close-ups. Palette: #f4efe6, #2c6e49. Qualities: Close-up. Figure: about 3.5 heads tall, with wide hat, satchel, boots.');
  assert.match(portrait({ heads: 7 }), /Figure: about 7 heads tall\.$/u);
  assert.match(portrait({ parts: ['scarf'] }), /Figure: with scarf\.$/u);
  // Out-of-range heights, odd part names and entity names are left out; with nothing left, the line is too.
  assert.match(portrait({ heads: 40, parts: ['Nujabes', 'cloak<script>', 'x', 'hood'] }), /Qualities: Close-up\. Figure: with hood\.$/u);
  assert.match(portrait({ heads: 1, parts: [] }), /Qualities: Close-up\.$/u);
  assert.match(portrait(null), /Qualities: Close-up\.$/u);
});

test('image requests need an imagery device, an unnamed one-sentence subject and stay within the run limit', () => {
  const rejects = (input, pattern) => assert.throws(() => buildImagePrompt({ dna: DNA, names: NAMES, device: 'dna5', subject: 'Olive oil bottles on a dark marble counter', ...input }), error => error instanceof ImageRequestError && pattern.test(error.message));
  rejects({ device: 'dna1' }, /imagery device in your saved culture-dna\.json \(dna5, dna6, dna8\)/);
  rejects({ dna: { devices: DNA.devices.slice(0, 2) }, device: 'dna1' }, /it has none/);
  rejects({ subject: 'A lobby from Anomalisa at night' }, /without naming taste entities \(Anomalisa\)/);
  rejects({ subject: 'Breakfast in the grand budapest hotel lobby' }, /without naming taste entities \(The Grand Budapest Hotel\)/);
  rejects({ subject: 'Short' }, /10-240 characters/);
  rejects({ subject: 'Two lines\nof subject text here' }, /10-240 characters/);
  rejects({ subject: 'A picture made by Codex of olive oil' }, /not the tools/);
  rejects({ aspect: 'wide' }, /landscape, portrait or square/);
  rejects({ attempts: IMAGE_LIMITS.perRun }, /already requested 8 images/);
  assert.ok(buildImagePrompt({ dna: DNA, names: NAMES, device: 'dna5', subject: 'Olive oil bottles on a dark marble counter', attempts: IMAGE_LIMITS.perRun - 1 }));
  // A one-word name counts only as a proper noun, so ordinary words stay available.
  assert.ok(buildImagePrompt({ dna: DNA, names: NAMES, device: 'dna5', subject: 'An island market at dusk with jars of jam' }));
});

test('Codex runs one ephemeral turn without user config, shell tool or write access', () => {
  const args = codexImageArgs({ prompt: 'A test-only prompt.', workDir: 'C:\\work' });
  assert.deepEqual(args.slice(0, 8), ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--disable', 'shell_tool', '--sandbox', 'read-only']);
  assert.equal(args[args.indexOf('--cd') + 1], 'C:\\work'); assert.ok(args.includes('--json')); assert.equal(args.at(-1), 'A test-only prompt.');
  const events = parseCodexEvents(['progress text', JSON.stringify({ type: 'thread.started', thread_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }),
    '{not json', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'A bottle of oil\non a table.' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } })].join('\n'));
  assert.deepEqual(events, { threadId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', reply: 'A bottle of oil on a table.', usage: { input_tokens: 10, output_tokens: 5 }, error: null });
  assert.equal(parseCodexEvents(JSON.stringify({ type: 'thread.started', thread_id: '../escape' })).threadId, null);
  assert.equal(parseCodexEvents(JSON.stringify({ type: 'turn.failed', error: { message: 'Usage limit reached.' } })).error, 'Usage limit reached.');
});

test('Codex is used only when a recent bundled CLI is signed in with ChatGPT', async t => {
  const local = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-codex-inspect-'));
  t.after(() => fs.rm(local, { recursive: true, force: true }));
  for (const name of ['old', 'new']) await fs.mkdir(path.join(local, 'OpenAI', 'Codex', 'bin', name), { recursive: true });
  const exec = ({ login = 'Logged in using ChatGPT', versions = { old: 'codex-cli 0.130.0-alpha.5', new: 'codex-cli 0.160.0' } } = {}) => async (file, args) => {
    if (args[0] === '--version') return { stdout: `${versions[path.basename(path.dirname(file))]}\n`, stderr: '' };
    return { stdout: '', stderr: `${login}\n` };
  };
  const env = { LOCALAPPDATA: local };
  const ready = await inspectCodex({ config: {}, env, platform: 'win32', execImpl: exec() });
  assert.deepEqual(ready, { available: true, provider: 'codex', version: '0.160.0', path: path.join(local, 'OpenAI', 'Codex', 'bin', 'new', 'codex.exe') });
  assert.match((await inspectCodex({ config: {}, env, platform: 'win32', execImpl: exec({ login: 'Logged in using an API key' }) })).reason, /not signed in with ChatGPT/);
  assert.match((await inspectCodex({ config: {}, env, platform: 'win32', execImpl: exec({ versions: { old: 'codex-cli 0.130.0', new: 'codex-cli 0.159.9' } }) })).reason, /older than 0\.160\.0/);
  assert.match((await inspectCodex({ config: { codexImages: 'off' }, env, platform: 'win32', execImpl: exec() })).reason, /CODEX_IMAGES=off/);
  assert.match((await inspectCodex({ config: {}, env: { LOCALAPPDATA: path.join(local, 'missing') }, platform: 'win32', execImpl: exec() })).reason, /No Codex CLI was found/);
  const explicit = [];
  await inspectCodex({ config: { codexCliPath: 'D:\\tools\\codex.exe' }, env, platform: 'win32', execImpl: async (file, args) => { explicit.push(file); return exec()(path.join(local, 'x', 'new', 'codex.exe'), args); } });
  assert.deepEqual([...new Set(explicit)], ['D:\\tools\\codex.exe']);
  const disabled = await createImageGenerator({ codexImages: 'off' });
  assert.equal(disabled.available, false); assert.equal(typeof disabled.generate, 'undefined');
});

/** A real PNG: the Windows conversion path decodes it with System.Drawing. */
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, 90);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function generatorFixture(t, { platform, events, image = png(6, 4) }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-codex-home-'));
  const run = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-codex-run-'));
  t.after(async () => { await fs.rm(home, { recursive: true, force: true }); await fs.rm(run, { recursive: true, force: true }); });
  const thread = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', spawns = [];
  const spawnImpl = (file, args, options) => {
    spawns.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(async () => {
      if (image) { await fs.mkdir(path.join(home, 'generated_images', thread), { recursive: true }); await fs.writeFile(path.join(home, 'generated_images', thread, 'ig_test.png'), image); }
      child.stdout.write((events || [{ type: 'thread.started', thread_id: thread }, { type: 'item.completed', item: { type: 'agent_message', text: 'Test-only jars on a shelf.' } }, { type: 'turn.completed', usage: { output_tokens: 3 } }]).map(item => JSON.stringify(item)).join('\n'));
      child.emit('close', 0);
    });
    return child;
  };
  const env = { ...process.env, CODEX_HOME: home, QLOO_API_KEY: 'test-only-secret', OPENAI_API_KEY: 'test-only-secret', DEMO_ACCESS_TOKEN: 'test-only-secret' };
  const generator = createCodexImageGenerator({ codex: { path: 'test-only-codex', version: '0.160.0' }, env, platform, spawnImpl });
  return { generator, home, thread, spawns, directory: path.join(run, 'assets', 'generated') };
}

test('the Codex generator moves its image into the run, removes the Codex session folder and passes no host secrets', async t => {
  const f = await generatorFixture(t, { platform: 'linux' });
  const result = await f.generator.generate({ prompt: 'A test-only prompt.', directory: f.directory, name: 'dna5-1' });
  assert.equal(result.path, 'generated/dna5-1.png'); assert.equal(result.format, 'png');
  assert.deepEqual([result.width, result.height], [6, 4]); assert.equal(result.description, 'Test-only jars on a shelf.');
  // The picture's main colours, read before any conversion; a single grey fills this one.
  assert.deepEqual(result.palette, [{ hex: '#5a5a5a', share: 1 }]);
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'dna5-1.png')), png(6, 4));
  await assert.rejects(fs.stat(path.join(f.home, 'generated_images', f.thread)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.directory, '..', 'codex-work')), { code: 'ENOENT' });
  const [spawn] = f.spawns;
  assert.equal(spawn.file, 'test-only-codex'); assert.equal(spawn.args.at(-1), 'A test-only prompt.'); assert.equal(spawn.options.shell, false);
  for (const key of ['QLOO_API_KEY', 'OPENAI_API_KEY', 'DEMO_ACCESS_TOKEN']) assert.equal(spawn.options.env[key], undefined, key);
  assert.equal(spawn.options.env.CODEX_HOME, f.home);
  await assert.rejects(f.generator.generate({ prompt: 'x', directory: f.directory, name: '../escape' }), /Invalid generated image name/);
});

test('the Codex generator reports a turn without an image or session instead of guessing a file', async t => {
  const missing = await generatorFixture(t, { platform: 'linux', image: null });
  await assert.rejects(missing.generator.generate({ prompt: 'x', directory: missing.directory, name: 'dna5-1' }), /without saving an image/);
  const failed = await generatorFixture(t, { platform: 'linux', events: [{ type: 'turn.failed', error: { message: 'Usage limit reached.' } }] });
  await assert.rejects(failed.generator.generate({ prompt: 'x', directory: failed.directory, name: 'dna5-1' }), /Codex could not generate the image: Usage limit reached\./);
  const anonymous = await generatorFixture(t, { platform: 'linux', events: [{ type: 'turn.completed' }] });
  await assert.rejects(anonymous.generator.generate({ prompt: 'x', directory: anonymous.directory, name: 'dna5-1' }), /without reporting its session/);
});

test('an edit attaches the host picture from the empty work folder and can keep the generated PNG as it is', async t => {
  const args = codexImageArgs({ prompt: 'A test-only prompt.', workDir: 'C:\\work', images: ['C:\\work\\blueprint.png'] });
  // The picture is attached before --cd, so the prompt stays the last, positional argument.
  assert.deepEqual(args.slice(args.indexOf('--image'), args.indexOf('--image') + 3), ['--image', 'C:\\work\\blueprint.png', '--cd']);
  assert.equal(args.at(-1), 'A test-only prompt.');
  // On Windows a kept PNG skips the JPEG conversion, so a flat key colour and alpha survive for the cut.
  const f = await generatorFixture(t, { platform: 'win32', image: png(30, 20) });
  const source = path.join(f.directory, '..', 'source-blueprint.png');
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, png(8, 8));
  const result = await f.generator.generate({ prompt: 'A test-only edit.', directory: f.directory, name: 'painted', attach: source, keepPng: true });
  const [spawn] = f.spawns;
  const attached = spawn.args[spawn.args.indexOf('--image') + 1];
  assert.equal(path.basename(attached), 'blueprint.png');
  assert.equal(path.dirname(attached), path.join(f.directory, '..', 'codex-work', 'painted'));
  assert.equal(result.format, 'png'); assert.equal(result.path, 'generated/painted.png');
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'painted.png')), png(30, 20));
  await assert.rejects(fs.stat(path.join(f.directory, '..', 'codex-work')), { code: 'ENOENT' });
});

test('on Windows the generated PNG becomes a web JPEG through the system imaging library', { skip: process.platform !== 'win32' && 'Windows only' }, async t => {
  const f = await generatorFixture(t, { platform: 'win32', image: png(30, 20) });
  const result = await f.generator.generate({ prompt: 'A test-only prompt.', directory: f.directory, name: 'dna5-2' });
  assert.equal(result.path, 'generated/dna5-2.jpg'); assert.equal(result.format, 'jpeg');
  assert.deepEqual(jpegSize(await fs.readFile(path.join(f.directory, 'dna5-2.jpg'))), { width: 30, height: 20 });
  await assert.rejects(fs.stat(path.join(f.directory, 'dna5-2.png')), { code: 'ENOENT' });
});
