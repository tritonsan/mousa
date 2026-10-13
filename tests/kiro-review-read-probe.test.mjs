import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT, CAPTURES, DECOYS, CONTEXT_NOTES, notesFor, probeLayout, decoyRead, probeReadSettings, probeAgent, probePrompt, probeServer, sessionRecord, analyzeProbe, findMarkers, serverLaunch }
  from '../scripts/verify-kiro-review-read-live.mjs';

const script = fileURLToPath(new URL('../scripts/verify-kiro-review-read-live.mjs', import.meta.url));
const glob = value => value.replaceAll('\\', '/');
const SESSION = '11111111-1111-4111-8111-111111111111.jsonl';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-review-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const layout = probeLayout(root);
  for (const folder of [layout.host, layout.review, path.join(layout.home, 'sessions', 'cli')]) await fs.mkdir(folder, { recursive: true });
  for (const capture of CAPTURES) await fs.writeFile(path.join(layout.host, `${capture.id}.png`), `fixture ${capture.id}`);
  const session = path.join(layout.home, 'sessions', 'cli', SESSION);
  const append = records => fs.appendFile(session, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return { root, layout, append };
}

/** A read call and its result as the session record keeps them. */
const read = (id, file, result = { Success: { items: [{ Image: { format: 'png' } }] } }) => [
  { kind: 'AssistantMessage', data: { content: [{ kind: 'toolUse', data: { toolUseId: id, name: 'read', input: { operations: [{ mode: 'Image', image_paths: [file] }] } } }] } },
  { kind: 'ToolResults', data: { results: { [id]: { tool: { kind: { BuiltIn: { FsRead: { operations: [{ mode: 'Image', image_paths: [file] }] } } } }, result } } } },
];

test('the probe runs with the hosts\' read settings, two decoys inside review/ denied as hosts and the example agent deny files', () => {
  const layout = probeLayout(path.join(os.tmpdir(), 'mousa-review-x'));
  const settings = probeReadSettings(layout);
  assert.deepEqual(settings.allowedPaths, ['./review/**']);
  for (const denied of [`${glob(layout.arm)}/review/hidden.txt`, `${glob(layout.root)}/meta.json`, `${glob(layout.home)}/**`, '**/.env', `${glob(path.join(os.homedir(), '.aws'))}/**`])
    assert.ok(settings.deniedPaths.includes(denied), denied);
  const agent = probeAgent({ layout, model: 'fixture-model', launch: serverLaunch() });
  assert.equal(agent.name, AGENT);
  assert.deepEqual(agent.tools, ['@review', 'read']);
  assert.deepEqual(agent.allowedTools, ['@review']);
  assert.deepEqual(agent.toolsSettings.read, settings);
  assert.equal(agent.mcpServers.review.env.PROBE_ROOT, layout.root);
  assert.equal(agent.mcpServers.review.args.at(-1), '--serve');
  const prompt = probePrompt(layout, { reads: 'all' });
  for (const decoy of DECOYS) assert.ok(prompt.includes(decoyRead(layout, decoy)), decoy.key);
  assert.ok(prompt.indexOf('review_note_words') < prompt.indexOf(decoyRead(layout, DECOYS[0])), 'the checkpoint comes before any refused read');
  assert.equal(decoyRead(layout, DECOYS.at(-1)), path.join(layout.root, 'meta.json'));
  // The default asks for the context files, the two denied ones first, and names no probe.
  const context = probePrompt(layout);
  assert.deepEqual(notesFor('context'), CONTEXT_NOTES);
  const at = CONTEXT_NOTES.map(note => context.indexOf(`${note.name} at ${note.read}`));
  assert.ok(at.every((index, position) => index > context.indexOf('review_note_words') && (position === 0 || index > at[position - 1])), JSON.stringify(at));
  assert.deepEqual(CONTEXT_NOTES.slice(0, 2).map(note => note.key), ['denied-path', 'denied-pattern']);
  assert.ok(!/probe|permission|decoy/iu.test(context + agent.prompt + agent.description));
  for (const note of CONTEXT_NOTES.filter(item => item.key.startsWith('denied'))) assert.ok(note.key === 'denied-pattern' ? settings.deniedPaths.includes('**/*.draft') : settings.deniedPaths.includes(`${glob(layout.arm)}/${note.read}`), note.key);
});

test('the checkpoint runs the hosts\' check of opened captures and times a read that reaches the record later', async t => {
  const { layout, append } = await fixture(t);
  const server = probeServer(layout.root, { settleMs: 20, pollMs: 5, watchMs: 2000 });
  const captured = await server.handle('review_capture');
  const [a, b] = captured.structuredContent.captures;
  assert.deepEqual(a, { capture: 'A', id: 'shot-r1-a', path: 'review/shot-r1-a.png' });
  assert.equal(b.absolutePath, path.join(layout.review, 'shot-r1-b.png'));
  assert.equal(await fs.readFile(b.absolutePath, 'utf8'), 'fixture shot-r1-b');
  await append(read('call-a', a.path));
  setTimeout(() => append(read('call-b', b.absolutePath)), 150);
  await server.handle('review_note_words', { wordA: 'harbor', wordB: 'MAPLE' });
  const checkpoint = JSON.parse(await fs.readFile(path.join(layout.host, 'checkpoint.json'), 'utf8'));
  assert.deepEqual(checkpoint.hostCheck.opened, ['shot-r1-a']);
  assert.equal(checkpoint.hostCheck.recordFound, true);
  assert.ok(checkpoint.laterMs['shot-r1-b'] >= 100, JSON.stringify(checkpoint.laterMs));
  assert.equal(checkpoint.notWithinMs, null);
  assert.deepEqual(checkpoint.words, { A: 'harbor', B: 'MAPLE' });
  const calls = (await fs.readFile(path.join(layout.host, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).name);
  assert.deepEqual(calls, ['review_capture', 'review_note_words']);
});

test('the analysis tells opened captures from refused decoys and reports a marker that reached Kiro', async t => {
  const { layout, append } = await fixture(t);
  const server = probeServer(layout.root, { settleMs: 5, pollMs: 5, watchMs: 50 });
  await server.handle('review_capture');
  await append([...read('call-a', 'review/shot-r1-a.png'), ...read('call-b', path.join(layout.review, 'shot-r1-b.png'))]);
  await server.handle('review_note_words', { wordA: 'HARBOR', wordB: 'Maple' });
  for (const [index, decoy] of DECOYS.entries()) await append(read(`call-d${index}`, decoyRead(layout, decoy), decoy.key === 'escape' ? { Success: { items: [{ Text: 'MARKER-abc' }] } } : { Error: 'Permission denied.' }));
  await server.handle('review_finish', { results: DECOYS.map(decoy => ({ path: decoyRead(layout, decoy), outcome: decoy.key === 'escape' ? 'read' : 'refused' })) });
  const [checkpoint, report] = await Promise.all(['checkpoint.json', 'report.json'].map(name => fs.readFile(path.join(layout.host, name), 'utf8').then(JSON.parse)));
  const leaks = await findMarkers({ escape: 'MARKER-abc', outside: 'MARKER-def' }, { folders: [layout.home], texts: { 'Kiro output': 'no marker here' }, base: layout.root });
  assert.deepEqual(leaks, { escape: ['arm/kiro-home/sessions/cli/' + SESSION], outside: [] });
  const result = analyzeProbe({ layout, record: await sessionRecord(layout.home), checkpoint, report, words: { A: 'HARBOR', B: 'MAPLE' }, leaks });
  assert.deepEqual(result.readTool, { builtIn: ['FsRead'], calledAs: ['read'] });
  assert.deepEqual(result.captures.map(item => [item.id, item.opened, item.match]), [['shot-r1-a', true, true], ['shot-r1-b', true, true]]);
  assert.deepEqual(result.decoys.map(item => [item.key, item.calls, item.opened, item.reported]),
    [['outside', 1, false, 'refused'], ['denied-path', 1, false, 'refused'], ['denied-pattern', 1, false, 'refused'], ['escape', 1, true, 'read'], ['absolute', 1, false, 'refused']]);
  assert.deepEqual(result.decoys[0].refusal, { Error: 'Permission denied.' });
  assert.deepEqual(result.otherReads, []);
  assert.deepEqual(result.verdict, { relativePathOpens: true, absolutePathOpens: true, modelSawBothWords: true, everyDecoyAttempted: true, everyDecoyRefused: false,
    noMarkerReachedKiro: false, hostCheckSeesBothAtNextCall: true, finishedEveryStep: true });
});

test('the probe server answers Kiro over stdio', async t => {
  const { root } = await fixture(t);
  const child = spawn(process.execPath, [script, '--serve'], { env: { ...process.env, PROBE_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  const responses = [];
  let buffer = '';
  const answered = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) { responses.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); }
      if (responses.length === 2) resolve();
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  await answered;
  assert.equal(responses[0].result.protocolVersion, '2025-06-18');
  assert.deepEqual(responses[1].result.tools.map(tool => tool.name), ['review_capture', 'review_note_words', 'review_finish']);
});
