// The public gallery's build: what a timeline keeps of a session stream, what a copy publishes, the scan that blocks a
// gallery holding a local path, a user name, a secret or a Qloo id, the URLs a built site gets back, and a whole entry
// built from a fixture run. No model, Qloo or browser request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { claudeCodeTimeline, codexTimeline, kiroTimeline } from '../src/gallery/timeline.mjs';
import { copyPublic, leakPatterns, leakScan, rebaseRootUrls, PublishError, PUBLIC_LIMITS } from '../src/gallery/sanitize.mjs';
import { buildGallery, checkGallery, checkConfig } from '../src/gallery/build.mjs';
import { loadGallery, galleryFile } from '../src/gallery.mjs';
import { loadFontLibrary } from '../plugin/server/production/fonts.mjs';
import { exists } from './helpers/mousa-fixtures.mjs';
import { fixtureRun, fixtureConfig, PRIVATE } from './helpers/gallery-fixtures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = prefix => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const write = async (root, file, content) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); };

test('a timeline keeps the tools, stages and outcomes of a session, never what they read, ran or wrote', () => {
  const at = seconds => new Date(Date.parse('2026-10-13T10:00:00Z') + seconds * 1000).toISOString();
  const claude = claudeCodeTimeline([
    { type: 'system', subtype: 'task_started', tool_use_id: 'agent-1', subagent_type: 'mousa:mousa-baseline' },
    { type: 'assistant', timestamp: at(0), message: { content: [{ type: 'tool_use', id: 'a', name: 'mcp__plugin_mousa_mousa__design_validate', input: { stage: 'dna', artifact: { thesis: PRIVATE.guess } } }] } },
    { type: 'user', timestamp: at(1), message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: { code: 'TASTE_PROTOCOL_INVALID', message: PRIVATE.guess } }) }] }] } },
    { type: 'assistant', timestamp: at(3), message: { content: [{ type: 'tool_use', id: 'b', name: 'Read', input: { file_path: PRIVATE.path } }, { type: 'tool_use', id: 'c', name: 'Read', input: { file_path: 'x' } }] } },
    { type: 'assistant', timestamp: at(9), parent_tool_use_id: 'agent-1', message: { content: [{ type: 'tool_use', id: 'd', name: 'Bash', input: { command: PRIVATE.command } }] } },
    { type: 'user', timestamp: at(10), message: { content: [{ type: 'tool_result', tool_use_id: 'd', is_error: true, content: 'failed' }] } },
    { type: 'assistant', timestamp: at(12), message: { content: [{ type: 'tool_use', id: 'e', name: 'Skill', input: { skill: 'mousa:design' } }] } },
  ]);
  assert.deepEqual(claude.lanes.map(lane => lane.label), ['Main session', 'mousa:mousa-baseline']);
  assert.deepEqual(claude.lanes[0].steps, [{ at: 0, tool: 'mousa:design_validate', detail: 'dna', status: 'refused', code: 'TASTE_PROTOCOL_INVALID' },
    { at: 3, tool: 'read', status: 'ok', count: 2 }, { at: 12, tool: 'skill', detail: 'mousa:design', status: 'ok' }], 'two reads in a row become one step');
  assert.deepEqual(claude.lanes[1].steps, [{ at: 9, tool: 'shell', status: 'error' }]);
  assert.deepEqual(claude.totals, { mousa: 1, refused: 1, reads: 2, writes: 0, shell: 1 });
  const codex = codexTimeline([
    { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'mousa', tool: 'taste_profile', arguments: { baseline: true }, result: { content: [{ type: 'text', text: '{"status":"baseline"}' }] }, status: 'completed' } },
    { type: 'item.completed', item: { type: 'command_execution', command: PRIVATE.command, aggregated_output: PRIVATE.path, exit_code: 1, status: 'failed' } },
    { type: 'item.completed', item: { type: 'file_change', changes: [{ path: PRIVATE.path }], status: 'completed' } },
    { type: 'item.completed', item: { type: 'agent_message', text: PRIVATE.guess } },
  ]);
  assert.deepEqual(codex.lanes[0].steps.map(step => [step.tool, step.detail ?? null, step.status]), [['mousa:taste_profile', 'baseline', 'ok'], ['shell', null, 'error'], ['write', null, 'ok']]);
  const kiro = kiroTimeline([{ at: 7, title: 'Running: @mousa/culture_list_capabilities', status: 'completed' }, { at: 9, title: `Reading ${PRIVATE.path}`, kind: 'read', status: 'completed' }]);
  assert.deepEqual(kiro.lanes[0].steps.map(step => [step.at, step.tool]), [[7, 'mousa:culture_list_capabilities'], [9, 'read']]);
  for (const timeline of [claude, codex, kiro]) {
    const text = JSON.stringify(timeline);
    for (const secret of Object.values(PRIVATE)) assert.ok(!text.includes(secret), `the timeline keeps ${secret}`);
  }
});

test('a copy publishes web files only, within bounds, and a built site\'s root URLs become relative', async () => {
  const from = await temp('mousa-gallery-from-'), to = await temp('mousa-gallery-to-');
  try {
    for (const [file, content] of [['index.html', '<link href="/assets/site.css"><script src="/assets/app.js"></script><a href="/">Home</a><img src="https://example.com/assets/x.png">'],
      ['assets/site.css', 'body{background:url(/fonts/face.woff2)}'], ['assets/app.js', 'import("/assets/chunk.js"); fetch("/api/x")'], ['fonts/face.woff2', 'font'],
      ['.env', 'QLOO_API_KEY=x'], ['.mousa/taste/input.json', '{}'], ['node_modules/x/index.js', 'x'], ['package.json', '{}'], ['serve.mjs', 'x'], ['README.md', 'x'],
      ['culture-dna.json', '{}'], ['data/walks.json', '{"walks":[]}'], ['compare/with-qloo/index.html', 'arm']]) await write(from, file, content);
    const copied = await copyPublic(from, to, { skip: ['compare'] });
    assert.deepEqual(copied.sort(), ['assets/app.js', 'assets/site.css', 'data/walks.json', 'fonts/face.woff2', 'index.html']);
    assert.equal(await rebaseRootUrls(to, copied), 3);
    assert.equal(await fs.readFile(path.join(to, 'index.html'), 'utf8'), '<link href="./assets/site.css"><script src="./assets/app.js"></script><a href="/">Home</a><img src="https://example.com/assets/x.png">', 'only URLs to its own files change');
    assert.equal(await fs.readFile(path.join(to, 'assets', 'site.css'), 'utf8'), 'body{background:url(../fonts/face.woff2)}');
    assert.equal(await fs.readFile(path.join(to, 'assets', 'app.js'), 'utf8'), 'import("../assets/chunk.js"); fetch("/api/x")');
    await fs.writeFile(path.join(from, 'big.png'), Buffer.alloc(PUBLIC_LIMITS.fileBytes + 1));
    await assert.rejects(copyPublic(from, await temp('mousa-gallery-big-')), PublishError);
  } finally { await fs.rm(from, { recursive: true, force: true }); await fs.rm(to, { recursive: true, force: true }); }
});

test('the scan finds local paths, the run folder, the user, secrets, tokens and Qloo ids in any text file', async () => {
  const dir = await temp('mousa-gallery-scan-');
  try {
    const patterns = leakPatterns({ user: 'fixtureuser', runsDir: 'E:/runs-archive', secrets: ['fixture-secret-value'] });
    assert.deepEqual(await leakScan(dir, patterns), []);
    await write(dir, 'a.html', '<p>Saved in C:\\Users\\someone\\site</p>');
    await write(dir, 'b/c.json', '{"by":"fixtureuser","from":"E:/runs-archive/x"}');
    await write(dir, 'd.js', 'const key = "fixture-secret-value"; const t = "ghp_abcdefghijklmnopqrstuvwxyz";');
    await write(dir, 'e.txt', 'ref 00000000-0000-4000-8000-00000000003F and urn:tag:style:qloo:quiet');
    await write(dir, 'f.png', 'C:\\Users\\binary is not scanned');
    const found = (await leakScan(dir, patterns)).map(item => `${item.file}:${item.pattern}`).sort();
    assert.deepEqual(found, ['a.html:local path', 'b/c.json:run folder', 'b/c.json:user name', 'd.js:secret', 'd.js:token', 'e.txt:Qloo URN', 'e.txt:Qloo id']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('a fixture run becomes a gallery entry with its report, playable files, timeline and command, and a leak blocks the gallery', async () => {
  const runs = await temp('mousa-gallery-runs-'), out = await temp('mousa-gallery-out-');
  try {
    assert.throws(() => checkConfig({ entries: [{ id: 'Bad Id', run: 'x', title: 't' }] }), /unique id/u);
    assert.throws(() => checkConfig({ featured: 'missing', entries: [{ id: 'one-entry', run: 'x', title: 't' }] }), /missing is named/u);
    await fixtureRun(runs);
    const library = await loadFontLibrary(repo);
    const built = await buildGallery({ config: fixtureConfig(), runsDir: runs, repo, out, library, user: 'fixtureuser', secrets: ['fixture-secret-value'] });
    assert.deepEqual(built.findings, []);
    assert.equal(built.written, true);
    const entry = JSON.parse(await fs.readFile(path.join(out, 'fixture-pantry', 'entry.json'), 'utf8'));
    assert.equal(entry.host, 'claude-code');
    assert.equal(entry.hostVersion, '2.1.284');
    assert.equal(entry.surfaceVersion, '0.6.0', 'the version the session\'s own mousa_status answered with');
    assert.equal(entry.model, 'claude-opus-5-5');
    assert.equal(entry.qlooRequests > 0, true);
    assert.match(entry.reproduce.command, /^node scripts\/run-claude-code-live\.mjs --run$/u, 'a request no brief file holds runs without --brief-file');
    assert.match(entry.reproduce.commit || '', /^[0-9a-f]{7,}$/u, 'the commit current when the run started');
    assert.deepEqual(entry.play, [{ label: 'The design', path: 'out/design/index.html' }]);
    assert.deepEqual(entry.timeline.totals, { mousa: 4, refused: 1, reads: 2, writes: 1, shell: 1 });
    for (const file of ['report/index.html', 'report/record.json', 'out/design/index.html', 'out/design/styles.css']) assert.ok(await exists(path.join(out, 'fixture-pantry', ...file.split('/'))), file);
    assert.ok(!(await exists(path.join(out, 'fixture-pantry', 'out', 'design', '.mousa'))), 'the design\'s records stay out');
    const text = JSON.stringify(entry);
    for (const secret of Object.values(PRIVATE)) assert.ok(!text.includes(secret), `entry.json keeps ${secret}`);
    const data = await relocate(out);
    const gallery = await loadGallery({ dataDir: data });
    await fs.rm(data, { recursive: true, force: true });
    assert.deepEqual([...gallery.entries.keys()], ['fixture-pantry']);
    assert.equal(gallery.index.featured, 'fixture-pantry');
    assert.equal(gallery.entries.get('fixture-pantry').record.kind, 'session');
    assert.deepEqual(await checkGallery(out, { user: 'fixtureuser' }), []);

    // The same run with a local path in one of its public files: the scan names it and gallery.json is not written.
    await fs.rm(runs, { recursive: true, force: true });
    await fixtureRun(runs, { leak: 'C:\\Users\\fixtureuser\\Documents\\notes' });
    const leaked = await buildGallery({ config: fixtureConfig(), runsDir: runs, repo, out, library, user: 'fixtureuser' });
    assert.equal(leaked.written, false);
    assert.deepEqual([...new Set(leaked.findings.map(item => `${item.file}:${item.pattern}`))].sort(), ['out/design/about.txt:local path', 'out/design/about.txt:user name']);
    assert.ok(!(await exists(path.join(out, 'gallery.json'))), 'a gallery with a finding is not published');
  } finally { await fs.rm(runs, { recursive: true, force: true }); await fs.rm(out, { recursive: true, force: true }); }
});

/** A data folder whose gallery folder holds a copy of `out`, as a Studio reads it. */
async function relocate(out) {
  const data = await temp('mousa-gallery-data-');
  await fs.cp(out, path.join(data, 'gallery'), { recursive: true });
  return data;
}

test('a gallery URL names a file inside one part of an entry, never a hidden file or a step out', () => {
  const dataDir = path.join(os.tmpdir(), 'data');
  assert.ok(galleryFile({ dataDir, id: 'fixture-pantry', part: 'report', relative: 'assets/captures/r1-desktop.png' }));
  assert.equal(galleryFile({ dataDir, id: 'fixture-pantry', part: 'out', relative: 'design/index.html' }).type, 'text/html; charset=utf-8');
  for (const [part, relative] of [['report', '../entry.json'], ['out', 'design/.mousa/session.json'], ['out', 'design/serve.mjs'], ['entry', 'entry.json'], ['out', 'C:/x.html'], ['out', 'a//b.html']]) {
    assert.equal(galleryFile({ dataDir, id: 'fixture-pantry', part, relative }), null, `${part}/${relative}`);
  }
  assert.equal(galleryFile({ dataDir, id: '../x', part: 'out', relative: 'index.html' }), null);
});
