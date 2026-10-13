// The export of recorded jobs for a hosted Studio: what it copies, and what stays on this machine. No request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = '11111111-1111-4111-8111-111111111111', PAIR = '22222222-2222-4222-8222-222222222222', WORKSPACE = '33333333-3333-4333-8333-333333333333';
const PAIR_ID = 'pair-20261006-000000';

async function listFiles(dir, prefix = '') {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listFiles(path.join(dir, entry.name), relative)); else found.push(relative);
  }
  return found.sort();
}

test('the export copies recorded jobs for a hosted Studio without Kiro homes, agent configurations or work folders', async t => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-export-data-')), out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-export-out-')), 'jobs');
  t.after(async () => { await fs.rm(data, { recursive: true, force: true }); await fs.rm(path.dirname(out), { recursive: true, force: true }); });
  const write = async (file, content = 'x') => { await fs.mkdir(path.dirname(path.join(data, file)), { recursive: true }); await fs.writeFile(path.join(data, file), content); };
  await write(`${SITE}/meta.json`, JSON.stringify({ id: SITE, status: 'completed', createdAt: '2026-10-06T01:00:00.000Z', kind: 'build', templateId: 'local-food', brief: 'Test-only brief.', workspaceId: WORKSPACE,
    runs: [{ mode: 'baseline', generatedImages: [{ path: 'generated/dna3-1.jpg' }] }, { mode: 'qloo' }] }));
  for (const mode of ['baseline', 'qloo']) {
    for (const file of ['site/index.html', 'site/culture-dna.json', 'review/r1-desktop.png', 'review/notes.txt', 'kiro-home/sessions/cli/session.jsonl', '.kiro/agents/culture-demo.json']) await write(`${SITE}/${mode}/${file}`);
  }
  await write(`${SITE}/baseline/assets/generated/dna3-1.jpg`);
  await write(`workspaces/${WORKSPACE}.json`, '{}');
  await write('workspaces/44444444-4444-4444-8444-444444444444.json', '{}');
  await write(`${PAIR}/meta.json`, JSON.stringify({ id: PAIR, status: 'completed', createdAt: '2026-10-06T00:00:00.000Z', kind: 'character', pairId: PAIR_ID, runs: [{ mode: 'baseline', key: 'qloo-off' }, { mode: 'qloo', key: 'qloo-on' }] }));
  await write(`${PAIR}/${PAIR_ID}/pair.json`, JSON.stringify({ arms: [{ key: 'qloo-off', portraits: [{ status: 'generated', provider: 'codex' }] }, { key: 'qloo-on', portraits: [] }] }));
  for (const file of ['taste.json', 'qloo-off.json', 'qloo-on.json', 'qloo-off-portrait-1.jpg', 'run.log', 'work/qloo-on/kiro-home/sessions/cli/session.jsonl']) await write(`${PAIR}/${PAIR_ID}/${file}`);
  const run = (...args) => spawnSync(process.execPath, ['scripts/export-hosted-jobs.mjs', ...args], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', DATA_DIR: data }, encoding: 'utf8' });

  const exported = run('--out', out, SITE, PAIR);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /^Exported 2 jobs \(15 files, /mu);
  assert.deepEqual(await listFiles(out), [
    `${PAIR}/meta.json`, ...['pair.json', 'qloo-off-portrait-1.jpg', 'qloo-off.json', 'qloo-on.json', 'taste.json'].map(file => `${PAIR}/${PAIR_ID}/${file}`),
    `${SITE}/baseline/assets/generated/dna3-1.jpg`, `${SITE}/baseline/review/r1-desktop.png`, `${SITE}/baseline/site/culture-dna.json`, `${SITE}/baseline/site/index.html`,
    `${SITE}/meta.json`, `${SITE}/qloo/review/r1-desktop.png`, `${SITE}/qloo/site/culture-dna.json`, `${SITE}/qloo/site/index.html`, `workspaces/${WORKSPACE}.json`,
  ].sort());
  // A pair recorded before the Studio kept its pictures gets them from its own record.
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, PAIR, 'meta.json'), 'utf8')).pictures, { portraits: 1, painted: 0, providers: ['codex'] });
  assert.ok(run('--list').stdout.split(/\r?\n/u).includes(`${PAIR}  2026-10-06  character  baseline+qloo  1 pictures  Character pair`));

  assert.match(run('--out', out, SITE).stderr, /exists\. Pass --force to replace it\./u);
  assert.equal(run('--out', out, SITE, '--force').status, 0);
  assert.match(run('--out', path.join(data, 'export'), SITE).stderr, /Export to a folder outside DATA_DIR\./u);
  await write(`${SITE}/meta.json`, JSON.stringify({ id: SITE, status: 'failed', kind: 'build', templateId: 'local-food', runs: [] }));
  assert.match(run('--out', out, SITE, '--force').stderr, /did not complete \(failed\)/u);
  assert.match(run('--out', out, 'not-a-job').stderr, /not-a-job is not a Studio job ID\./u);
});

test('the export carries the showcase: its file, its jobs and only the served files of its app run', async t => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-export-data-')), out = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-export-out-')), 'jobs');
  t.after(async () => { await fs.rm(data, { recursive: true, force: true }); await fs.rm(path.dirname(out), { recursive: true, force: true }); });
  const write = async (file, content = 'x') => { await fs.mkdir(path.dirname(path.join(data, file)), { recursive: true }); await fs.writeFile(path.join(data, file), content); };
  const APP = 'ramble-2026-10-06';
  const run = (...args) => spawnSync(process.execPath, ['scripts/export-hosted-jobs.mjs', ...args], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', DATA_DIR: data }, encoding: 'utf8' });
  assert.match(run('--out', out, '--showcase').stderr, /DATA_DIR has no showcase\.json/u);

  await write(`${SITE}/meta.json`, JSON.stringify({ id: SITE, status: 'completed', createdAt: '2026-10-06T01:00:00.000Z', kind: 'build', templateId: 'local-food', brief: 'Test-only brief.', runs: [{ mode: 'baseline' }, { mode: 'qloo' }] }));
  for (const mode of ['baseline', 'qloo']) await write(`${SITE}/${mode}/site/index.html`);
  await write('showcase.json', JSON.stringify({ schemaVersion: '1.0', sites: SITE, game: null, app: APP }));
  for (const file of ['record.json', 'after/index.html', 'after/fonts/face.woff2', 'before/index.html', 'captures/r1-board.png', 'after/.kiro/agents/agent.json', 'after/run.exe', 'notes/notes.txt', 'stray.json']) await write(`showcase/app/${APP}/${file}`);
  await write('showcase/app/ramble-older/record.json');

  const exported = run('--out', out, '--showcase');
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /The showcase: websites 11111111-1111-4111-8111-111111111111, character pair none, app run ramble-2026-10-06\./u);
  assert.match(exported.stdout, /Exported 1 jobs \(9 files, /u);
  assert.deepEqual(await listFiles(out), [`${SITE}/baseline/site/index.html`, `${SITE}/meta.json`, `${SITE}/qloo/site/index.html`, 'showcase.json',
    ...['after/fonts/face.woff2', 'after/index.html', 'before/index.html', 'captures/r1-board.png', 'record.json'].map(file => `showcase/app/${APP}/${file}`)].sort());
  assert.match(run('--out', out, '--showcase').stderr, /exists\. Pass --force to replace it\./u);
  assert.equal(run('--out', out, '--showcase', '--force').status, 0);
  await write('showcase.json', JSON.stringify({ app: 'ramble-missing' }));
  assert.match(run('--out', out, '--showcase', '--force').stderr, /the app run ramble-missing has no folder/u);
});
