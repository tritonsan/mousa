// The live run of the mobile app example, checked without a model: where the copy and its record go, what Kiro's
// environment carries, the copy's agent and what the summary reads from a finished copy. No Kiro session or Qloo
// request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runLayout, runEnvironment, kiroArgs, prepareCopy, summarizeRun, EXAMPLE, AGENT } from '../scripts/run-mobile-example-live.mjs';

test('the copy sits beside the example, where its agent reaches the plugin, and the record stays outside it', () => {
  const rootDir = path.resolve('repository-root');
  const layout = runLayout('2026-10-06T10-00-00-000Z', { rootDir });
  assert.equal(path.dirname(layout.copy), path.join(rootDir, 'examples'));
  assert.equal(path.resolve(layout.copy, '../../plugin/server/index.mjs'), path.join(rootDir, 'plugin', 'server', 'index.mjs'));
  assert.ok(path.relative(layout.copy, layout.home).startsWith('..'), 'Kiro\'s home and its session record are outside what the agent may read');
});

test('Kiro gets the system variables, the keys the plugin needs and this Node first, and nothing else', () => {
  const base = { PATH: 'system', USERPROFILE: 'profile', DEMO_ACCESS_TOKEN: 'not for Kiro', AWS_SECRET_ACCESS_KEY: 'not for Kiro' };
  const env = runEnvironment({ config: { kiroApiKey: 'kiro', qlooKey: 'qloo', codexCliPath: 'codex.exe' }, home: 'home', base, nodeDir: 'node' });
  assert.deepEqual(Object.keys(env).sort(), ['CODEX_CLI_PATH', 'KIRO_API_KEY', 'KIRO_HOME', 'PATH', 'QLOO_API_KEY', 'USERPROFILE']);
  assert.equal(env.PATH, `node${path.delimiter}system`);
  assert.deepEqual(kiroArgs({ model: 'model' }).slice(0, 3), ['chat', '--agent', AGENT]);
  assert.ok(kiroArgs({ model: 'model' }).includes('--no-interactive'));
});

test('the copy names the model in its own agent, and the summary reads what the run left', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-app-run-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const layout = runLayout('stamp', { rootDir });
  await fs.mkdir(path.dirname(layout.copy), { recursive: true });
  await prepareCopy({ layout, model: 'test-model' });
  const agentFile = path.join('.kiro', 'agents', `${AGENT}.json`);
  assert.equal(JSON.parse(await fs.readFile(path.join(layout.copy, agentFile), 'utf8')).model, 'test-model');
  assert.equal(JSON.parse(await fs.readFile(path.join(EXAMPLE, agentFile), 'utf8')).model, undefined, 'the example keeps its own agent');
  await assert.rejects(prepareCopy({ layout, model: 'test-model' }), 'a copy is never overwritten');

  // A finished run: one artifact, a changed stylesheet, two captures of which the review cites both and the session opened one.
  await fs.writeFile(path.join(layout.copy, 'culture-dna.json'), '{}');
  await fs.appendFile(path.join(layout.copy, 'styles.css'), '\n/* redesigned */\n');
  await fs.mkdir(path.join(layout.copy, '.mousa'), { recursive: true });
  await fs.writeFile(path.join(layout.copy, '.mousa', 'captures.json'), JSON.stringify({ captures: ['r1-phone', 'r1-board'].map(id => ({ id, round: 1, path: `.mousa/captures/${id}.png` })) }));
  await fs.writeFile(path.join(layout.copy, 'culture-review.json'), JSON.stringify({ round: 1, criteria: [{ id: 'c1', capture: 'r1-phone', verdict: 'met' }, { id: 'c2', capture: 'r1-board', verdict: 'partly' }] }));
  const sessions = path.join(layout.home, 'sessions', 'cli');
  await fs.mkdir(sessions, { recursive: true });
  const read = { kind: 'ToolResults', data: { results: { a: { tool: { kind: { BuiltIn: { FileRead: { operations: [{ mode: 'Image', paths: ['.mousa/captures/r1-phone.png'] }] } } } }, result: { Success: {} } } } } };
  await fs.writeFile(path.join(sessions, '0b0b0b0b-0000-4000-8000-000000000003.jsonl'), `${JSON.stringify(read)}\n`);
  const summary = await summarizeRun({ layout });
  assert.equal(summary.artifacts['culture-dna.json'], 2);
  assert.equal(summary.artifacts['culture-reading.json'], null);
  assert.deepEqual([summary.changed, summary.added], [['styles.css'], []]);
  assert.deepEqual([summary.review.rounds, summary.review.audited, summary.review.opened, summary.review.unopened], [1, true, ['r1-phone'], ['r1-board']]);
  // The live agent kept both rounds in one file, under rounds.
  await fs.writeFile(path.join(layout.copy, 'culture-review.json'), JSON.stringify({ rounds: [{ round: 1, criteria: [{ id: 'c1', capture: 'r1-phone', verdict: 'partly' }] }, { round: 2, criteria: [{ id: 'c1', capture: 'r1-board', verdict: 'met' }] }] }));
  const both = await summarizeRun({ layout });
  assert.deepEqual([both.review.rounds, both.review.criteria.map(item => `${item.round}:${item.verdict}`), both.review.cited], [2, ['1:partly', '2:met'], ['r1-phone', 'r1-board']]);
});
