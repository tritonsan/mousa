// The Studio's showcase: the recorded work a reviewer sees first without the access token, read-only, and the app run
// folder scripts/build-showcase.mjs builds for it. Fixture records only; no model, Qloo or Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.mjs';
import { createStudio } from '../src/server.mjs';
import { loadShowcase, showcaseAppFile, isShowcaseJob, SHOWCASE_APP_CSP } from '../src/showcase.mjs';
import { buildApp, appRecord } from '../scripts/build-showcase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITES = '11111111-1111-4111-8111-111111111111', PAIR = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
const FAILED = '44444444-4444-4444-8444-444444444444', WORKSPACE = '55555555-5555-4555-8555-555555555555';
const APP = 'ramble-2026-10-06', STAMP = '2026-10-06T10-20-02-669Z', TOKEN = 'a'.repeat(32), PREVIEW_TOKEN = 'b'.repeat(48);
const readyKiro = async () => ({ available: true, authenticated: true, version: 'test-only', defaultModel: 'fixed-test-model' });
const completedRuns = [{ mode: 'baseline', status: 'completed', events: [], evidence: [], decisions: [] }, { mode: 'qloo', status: 'completed', events: [], evidence: [], decisions: [] }];

async function listFiles(dir, prefix = '') {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listFiles(path.join(dir, entry.name), relative)); else found.push(relative);
  }
  return found.sort();
}

/** A data folder with a website comparison, a character pair, two other jobs and a built app run. */
async function fixtureData(showcase) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-showcase-data-'));
  const write = async (file, content = 'x') => { await fs.mkdir(path.dirname(path.join(data, file)), { recursive: true }); await fs.writeFile(path.join(data, file), content); };
  const job = (id, fields) => write(`${id}/meta.json`, JSON.stringify({ id, createdAt: '2026-10-06T10:13:24.186Z', previewToken: PREVIEW_TOKEN, ...fields }));
  await job(SITES, { status: 'completed', kind: 'build', templateId: 'local-food', brief: 'Test-only brief for the showcased comparison.', workspaceId: WORKSPACE, runs: completedRuns });
  await job(PAIR, { status: 'completed', kind: 'character', pairId: 'pair-20261006-000000', brief: { name: 'Test-only pair', references: [{ name: 'Fixture reference' }] },
    runs: [{ mode: 'baseline', key: 'qloo-off', label: 'Qloo off', status: 'completed' }, { mode: 'qloo', key: 'qloo-on', label: 'Qloo on', status: 'completed' }] });
  await job(OTHER, { status: 'completed', kind: 'build', templateId: 'local-food', brief: 'Test-only brief for a job outside the showcase.', runs: completedRuns });
  await job(FAILED, { status: 'failed', kind: 'build', templateId: 'local-food', brief: 'Test-only brief for a failed job.', runs: [{ mode: 'baseline', status: 'failed' }, { mode: 'qloo', status: 'failed' }] });
  await write(`workspaces/${WORKSPACE}.json`, JSON.stringify({ id: WORKSPACE, name: 'Test-only workspace', templateId: 'local-food', brief: 'Test-only brief.', cultureBrief: {} }));
  const app = `showcase/app/${APP}`;
  await write(`${app}/record.json`, JSON.stringify({ schemaVersion: '1.0', id: APP, title: 'Ramble', captures: [{ id: 'r1-board', round: 1, file: 'captures/r1-board.png' }] }));
  await write(`${app}/after/index.html`, '<!doctype html><title>After</title>');
  await write(`${app}/after/data/walks.json`, '{"walks":[]}');
  await write(`${app}/after/fonts/face.woff2`, 'font');
  await write(`${app}/before/index.html`, '<!doctype html><title>Before</title>');
  await write(`${app}/captures/r1-board.png`, 'png');
  // Files the Studio never serves, even inside the app folder.
  await write(`${app}/after/.kiro/agents/agent.json`, '{}');
  await write(`${app}/after/run.exe`, 'binary');
  await write(`${app}/notes/notes.txt`, 'notes');
  if (showcase) await write('showcase.json', JSON.stringify(showcase));
  return data;
}

/** The fixture data and, unless `serve` is false, a Studio on it; the Studio closes before the data is removed. */
async function setup(t, { showcase = { schemaVersion: '1.0', sites: SITES, game: PAIR, app: APP }, overrides = {}, serve = true } = {}) {
  const data = await fixtureData(showcase);
  const config = { ...getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: data }), ...overrides };
  const studio = serve ? await createStudio({ config, inspect: readyKiro }) : null;
  t.after(async () => { await studio?.close(); await fs.rm(data, { recursive: true, force: true }); });
  return { data, studio };
}

test('the showcase names a completed website comparison, a completed character pair and a built app run', async t => {
  const { data, studio } = await setup(t);
  const showcase = await loadShowcase({ dataDir: data, jobs: studio.manager.jobs });
  assert.equal(showcase.sites, SITES);
  assert.equal(showcase.game, PAIR);
  assert.equal(showcase.app.id, APP);
  assert.equal(showcase.app.record.title, 'Ramble');
  assert.deepEqual(showcase.notes, []);
  assert.ok(isShowcaseJob(showcase, SITES) && isShowcaseJob(showcase, PAIR));
  assert.ok(!isShowcaseJob(showcase, OTHER) && !isShowcaseJob(showcase, null));

  // Each entry that names the wrong kind of record is left out with a note; the Studio still starts.
  const jobs = studio.manager.jobs;
  const swapped = async value => { await fs.writeFile(path.join(data, 'showcase.json'), JSON.stringify(value)); return loadShowcase({ dataDir: data, jobs }); };
  let loaded = await swapped({ sites: PAIR, game: SITES, app: 'Not An Id' });
  assert.deepEqual([loaded.sites, loaded.game, loaded.app], [null, null, null]);
  assert.equal(loaded.notes.length, 3);
  assert.match(loaded.notes.join(' '), /not a completed website comparison.*not a completed character pair.*use the ID of a folder/su);
  loaded = await swapped({ sites: FAILED, game: '99999999-9999-4999-8999-999999999999', app: 'ramble-missing' });
  assert.deepEqual([loaded.sites, loaded.game, loaded.app], [null, null, null]);
  assert.match(loaded.notes.join(' '), /not a completed website comparison.*not in this Studio's data.*needs its record\.json and after\/index\.html/su);
  loaded = await swapped({ sites: 'not-a-job' });
  assert.match(loaded.notes[0], /use a Studio job ID/u);
  await fs.writeFile(path.join(data, 'showcase.json'), '{broken');
  loaded = await loadShowcase({ dataDir: data, jobs });
  assert.deepEqual([loaded.sites, loaded.game, loaded.app], [null, null, null]);
  assert.match(loaded.notes[0], /could not be read/u);
  await fs.writeFile(path.join(data, 'showcase.json'), '[]');
  assert.match((await loadShowcase({ dataDir: data, jobs })).notes[0], /must hold an object/u);
  await fs.rm(path.join(data, 'showcase.json'));
  assert.deepEqual(await loadShowcase({ dataDir: data, jobs }), { sites: null, game: null, app: null, notes: [] });
});

test('an app run URL names only the listed file types inside its before, after and captures folders', () => {
  const dataDir = path.join(os.tmpdir(), 'mousa-showcase-paths');
  const file = relative => showcaseAppFile({ dataDir, id: APP, relative });
  assert.equal(file('after/index.html').type, 'text/html; charset=utf-8');
  assert.equal(file('after/index.html').file, path.join(dataDir, 'showcase', 'app', APP, 'after', 'index.html'));
  assert.equal(file('before/data/walks.json').type, 'application/json; charset=utf-8');
  assert.equal(file('after/fonts/face.WOFF2').type, 'font/woff2');
  assert.equal(file('captures/r1-board.png').type, 'image/png');
  for (const relative of ['record.json', 'index.html', 'notes/notes.txt', 'after/.kiro/agents/agent.json', 'after/.env', 'after/../record.json', 'after//index.html',
    'after/run.exe', 'after/a\\b.js', 'after/c:x.js', 'after/x\0.html', 'after/', '']) assert.equal(file(relative), null, relative);
  assert.equal(showcaseAppFile({ dataDir, id: '../app', relative: 'after/index.html' }), null);
  assert.equal(showcaseAppFile({ dataDir, id: APP, relative: null }), null);
});

test('with an access token set, the showcase is readable without it and nothing else is', async t => {
  const { studio } = await setup(t, { overrides: { accessToken: TOKEN } });
  const get = (route, headers = {}) => fetch(`${studio.appUrl}${route}`, { headers });
  let response = await get('/api/showcase');
  assert.equal(response.status, 200);
  const showcase = await response.json();
  assert.deepEqual([showcase.sites.id, showcase.sites.kind, showcase.game.id, showcase.game.kind, showcase.app.id], [SITES, 'build', PAIR, 'character', APP]);
  assert.equal(showcase.app.record.title, 'Ramble');
  assert.equal(showcase.app.base, `${studio.previewBaseUrl}/showcase/app/${APP}/`);
  assert.ok(showcase.sites.runs.every(run => run.previewUrl?.startsWith(studio.previewBaseUrl)));

  // The showcased records and their read-only parts open without the token.
  assert.equal((await get(`/api/jobs/${SITES}`)).status, 200);
  assert.equal((await get(`/api/jobs/${PAIR}`)).status, 200);
  assert.equal((await get(`/api/jobs/${SITES}/runs/qloo/diff`)).status, 200);
  // Every other record, the lists, the workspaces and every change still need it.
  for (const route of [`/api/jobs/${OTHER}`, `/api/jobs/${OTHER}/runs/qloo/diff`, '/api/character-jobs', '/api/workspaces', `/api/workspaces/${WORKSPACE}`]) assert.equal((await get(route)).status, 401, route);
  for (const route of [`/api/jobs/${SITES}/cancel`, `/api/jobs/${PAIR}/cancel`]) assert.equal((await fetch(`${studio.appUrl}${route}`, { method: 'POST' })).status, 401, route);
  response = await fetch(`${studio.appUrl}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: 'local-food', brief: 'A test-only brief for a new site.', mode: 'baseline', parentJobId: SITES }) });
  assert.equal(response.status, 401);
  assert.equal((await get(`/api/jobs/${OTHER}`, { 'X-Demo-Token': TOKEN })).status, 200);
  assert.equal((await get('/api/character-jobs', { 'X-Demo-Token': TOKEN })).status, 200);

  // The app run plays from the preview origin under the sandboxed policy; only its listed files are served.
  response = await fetch(`${showcase.app.base}after/index.html`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-security-policy'), SHOWCASE_APP_CSP);
  assert.match(SHOWCASE_APP_CSP, /sandbox allow-scripts allow-forms$/u);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(await response.text(), '<!doctype html><title>After</title>');
  for (const [file, type] of [['before/index.html', 'text/html; charset=utf-8'], ['after/data/walks.json', 'application/json; charset=utf-8'], ['after/fonts/face.woff2', 'font/woff2'], ['captures/r1-board.png', 'image/png']]) {
    response = await fetch(`${showcase.app.base}${file}`);
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get('content-type'), type, file);
  }
  for (const file of ['record.json', 'after/.kiro/agents/agent.json', 'after/run.exe', 'notes/notes.txt', 'after/missing.html', 'after/%2e%2e/record.json', 'after/%2E%2E%2Frecord.json', 'after/%E0%A4%A.html']) {
    assert.equal((await fetch(`${showcase.app.base}${file}`)).status, 404, file);
  }
  assert.equal((await fetch(`${studio.previewBaseUrl}/showcase/app/ramble-other/after/index.html`)).status, 404);
  // The app runs on the preview origin, never on the Studio's own.
  assert.equal((await get(`/showcase/app/${APP}/after/index.html`)).status, 404);
  assert.equal((await get('/showcase.js')).status, 200);
});

test('a Studio without a showcase serves an empty one and keeps every record behind the token', async t => {
  const { studio } = await setup(t, { showcase: null, overrides: { accessToken: TOKEN } });
  const response = await fetch(`${studio.appUrl}/api/showcase`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sites: null, game: null, app: null });
  assert.equal((await fetch(`${studio.appUrl}/api/jobs/${SITES}`)).status, 401);
  assert.equal((await fetch(`${studio.previewBaseUrl}/showcase/app/${APP}/after/index.html`)).status, 404);
});

test('build-showcase copies a recorded app run without its agent files, Kiro home or session record', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-showcase-root-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const write = async (file, content = 'x') => { await fs.mkdir(path.dirname(path.join(fixture, file)), { recursive: true }); await fs.writeFile(path.join(fixture, file), content); };
  for (const file of ['index.html', 'styles.css', 'app.js', 'tokens/tokens.css', 'tokens/tokens.json', 'data/walks.json', 'serve.mjs', 'README.md', '.kiro/agents/ramble.json']) await write(`examples/mobile-app/${file}`);
  const copy = `examples/mobile-app-run-${STAMP}`;
  for (const file of ['index.html', 'styles.css', 'app.js', 'tokens/tokens.css', 'data/walks.json', 'fonts/face.woff2', 'fonts/face.OFL.txt', 'serve.mjs', '.kiro/agents/ramble.json',
    'kiro-home/sessions/cli/session.jsonl', '.mousa/session.json', '.mousa/captures/r1-board.png', '.mousa/captures/r1-unlisted.png', 'culture-assumption.json']) await write(`${copy}/${file}`);
  await write(`${copy}/.mousa/captures.json`, JSON.stringify({ captures: [{ id: 'r1-board', view: 'board', width: 1440, height: 900, round: 1 }, { id: 'r2-missing', view: 'phone', round: 2 }, { id: '../escape', round: 2 }] }));
  await write(`${copy}/culture-taste.json`, JSON.stringify({ seeds: [{ name: 'Seed one', matchedName: 'Seed One' }], metrics: { measuredEntities: 3, surprises: 2, predictions: 4, predictionsConfirmed: 1, measuredQualities: 2, qualitySurprises: 2, measuredTags: 1, other: 9 },
    entities: [{ ref: 'E1', name: 'Entity one' }], requiredAnchors: [{ ref: 'quality:look:bright', name: 'Bright' }] }));
  await write(`${copy}/culture-reading.json`, JSON.stringify({ approach: 'Test-only approach.', setAside: [{ ref: 'E2' }], clusters: [{ id: 'c1', name: 'Cluster one', refs: ['E1', 'quality:look:bright', 'unknown'], layers: ['palette'], reading: 'Long text.' }] }));
  await write(`${copy}/culture-dna.json`, JSON.stringify({ thesis: 'Test-only thesis.', devices: [{ id: 'd1', layer: 'palette', device: 'Device one', anchors: ['quality:look:bright'], qualities: ['Bright'], translation: 'Test-only translation.', tokens: {} }] }));
  await write(`${copy}/culture-production.json`, JSON.stringify({ steps: [{ device: 'd1', method: 'design-tokens', cluster: 'c1', why: 'Test-only reason.' }], review: [{ id: 'k1', device: 'd1', look: 'Test-only look.', view: 'board' }] }));
  await write(`${copy}/culture-review.json`, JSON.stringify({ audit: 'Test-only audit note.', rounds: [{ round: 1, summary: 'Round one.', criteria: [{ id: 'k1', capture: 'r1-board', verdict: 'partly', observed: 'Seen.', repair: 'Fixed.' }] }] }));
  await write(`output/mobile-app-run/${STAMP}/run.json`, JSON.stringify({ startedAt: '2026-10-06T10:20:02.769Z', model: 'fixed-test-model', kiro: 'C:/test/chat-cli-2.24.0.exe', request: 'Test-only request.', durationMs: 60000,
    changed: ['index.html'], added: ['fonts/face.woff2', 'fonts/face.OFL.txt'], review: { audited: true, cited: ['r1-board'], opened: ['r1-board'], unopened: [] } }));
  const data = path.join(fixture, 'data');

  const built = await buildApp({ stamp: STAMP, dataDir: data, rootDir: fixture });
  assert.equal(built.id, APP);
  const folder = path.join(data, 'showcase', 'app', APP);
  assert.deepEqual(await listFiles(folder), ['after/app.js', 'after/data/walks.json', 'after/fonts/face.OFL.txt', 'after/fonts/face.woff2', 'after/index.html', 'after/styles.css', 'after/tokens/tokens.css',
    'before/app.js', 'before/data/walks.json', 'before/index.html', 'before/styles.css', 'before/tokens/tokens.css', 'before/tokens/tokens.json', 'captures/r1-board.png', 'record.json']);
  assert.equal(built.files, 15);
  const record = JSON.parse(await fs.readFile(path.join(folder, 'record.json'), 'utf8'));
  assert.deepEqual([record.id, record.title, record.model, record.kiro, record.request, record.seeds], [APP, 'Ramble', 'fixed-test-model', '2.24.0', 'Test-only request.', ['Seed One']]);
  assert.deepEqual(record.taste, { measuredEntities: 3, surprises: 2, predictions: 4, predictionsConfirmed: 1, measuredQualities: 2, qualitySurprises: 2, measuredTags: 1 });
  // Refs are shown by the names the taste record gives them; a ref it does not name is left out.
  assert.deepEqual(record.reading.clusters, [{ name: 'Cluster one', layers: ['palette'], refs: ['Entity one', 'Bright'] }]);
  assert.equal(record.reading.setAside, 1);
  assert.deepEqual(record.dna.devices[0].anchors, ['Bright']);
  assert.deepEqual(record.plan, { steps: [{ device: 'd1', method: 'design-tokens', why: 'Test-only reason.' }], criteria: [{ id: 'k1', device: 'd1', view: 'board', look: 'Test-only look.' }] });
  assert.equal(record.review.note, 'Test-only audit note.');
  assert.deepEqual(record.review.rounds[0].criteria[0], { id: 'k1', capture: 'r1-board', verdict: 'partly', observed: 'Seen.', repair: 'Fixed.' });
  assert.deepEqual(record.audit, { audited: true, cited: ['r1-board'], opened: ['r1-board'], unopened: [] });
  assert.deepEqual(record.fonts, ['face.woff2']);
  assert.deepEqual(record.captures, [{ id: 'r1-board', round: 1, view: 'board', target: null, width: 1440, height: 900, file: 'captures/r1-board.png' }]);
  // The Studio serves what was built, once showcase.json names it.
  assert.equal((await loadShowcase({ dataDir: data, jobs: new Map() })).app, null);
  await fs.writeFile(path.join(data, 'showcase.json'), JSON.stringify({ app: APP }));
  assert.equal((await loadShowcase({ dataDir: data, jobs: new Map() })).app.record.id, APP);

  // A rebuild replaces the folder; a stamp without a recorded run is refused.
  await fs.writeFile(path.join(folder, 'after', 'stale.html'), 'stale');
  await buildApp({ stamp: STAMP, dataDir: data, rootDir: fixture });
  assert.ok(!(await listFiles(folder)).includes('after/stale.html'));
  await assert.rejects(buildApp({ stamp: '2026-10-07T00-00-00-000Z', dataDir: data, rootDir: fixture }), /No recorded run/u);
  await assert.rejects(buildApp({ stamp: '../escape', dataDir: data, rootDir: fixture }), /give the stamp/u);
  assert.equal(appRecord({ id: APP, run: {} }).review.rounds.length, 0);
});

test('build-showcase sets the showcase jobs in DATA_DIR and checks each one', async t => {
  const { data } = await setup(t, { showcase: null, serve: false });
  const run = (...args) => spawnSync(process.execPath, ['scripts/build-showcase.mjs', ...args], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', DATA_DIR: data }, encoding: 'utf8' });
  const read = async () => JSON.parse(await fs.readFile(path.join(data, 'showcase.json'), 'utf8'));
  let result = run(`--sites=${SITES}`, `--game=${PAIR}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Restart the Studio to show it\./u);
  assert.deepEqual(await read(), { schemaVersion: '1.0', sites: SITES, game: PAIR, app: null });
  // An entry not named keeps its value; none clears the pair.
  assert.equal(run('--game=none').status, 0);
  assert.deepEqual(await read(), { schemaVersion: '1.0', sites: SITES, game: null, app: null });
  for (const [arg, message] of [[`--game=${SITES}`, /is not a character pair/u], [`--sites=${PAIR}`, /is not a website comparison/u], [`--sites=${FAILED}`, /did not complete \(failed\)/u],
    ['--sites=99999999-9999-4999-8999-999999999999', /is not in /u], ['--sites=not-a-job', /is not a Studio job ID/u], ['--app=../escape', /give the stamp/u]]) {
    result = run(arg);
    assert.equal(result.status, 1, arg);
    assert.match(result.stderr, message, arg);
  }
  assert.deepEqual(await read(), { schemaVersion: '1.0', sites: SITES, game: null, app: null }, 'a refused entry changes nothing');
  assert.equal(run('--sites=none', '--app=none').status, 0);
  assert.deepEqual(await read(), { schemaVersion: '1.0', sites: null, game: null, app: null });
  result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^Usage: /u);
});
