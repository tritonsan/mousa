// The Studio's Game character view: character pair jobs on the shared queue, their public records, and the preview
// server's game route. The pair runs as a dry run with the fixture Qloo client and the scripted design sessions, so no
// model, Qloo or Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getConfig } from '../src/config.mjs';
import { createStudio } from '../src/server.mjs';
import { characterRequest, newCharacterJob, pairPictures, PAIR_ID } from '../src/character-jobs.mjs';
import { HOSTED_IMAGE_REASON } from '../plugin/server/production/capabilities.mjs';
import { runPair, scriptArm } from '../game/harness/run-pair.mjs';
import { fixtureQlooClient } from '../game/harness/fixtures.mjs';
import { QLOO_AGE_BANDS } from '../plugin/server/qloo/client.mjs';

const readyKiro = async () => ({ available: true, authenticated: true, version: 'test-only', defaultModel: 'fixed-test-model' });
const dryRun = options => runPair({ ...options, mode: 'dry-run', runArm: scriptArm });
const brief = { brief: 'Design Ilo the lamplighter for an audience that loves hand-drawn games and gentle films, walking the cliff road at dusk.', references: ['Fixture reference one', 'Fixture reference two'] };

async function setup(t, { characterRunner = dryRun, overrides = {}, browser = null } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-character-test-'));
  const config = { ...getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory }), qlooKey: 'test-only-key', ...overrides };
  const studio = await createStudio({ config, inspect: readyKiro, characterRunner, qlooClientFactory: () => fixtureQlooClient(), browser });
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { studio, config, directory };
}
async function finished(studio, id) {
  // A painted dry-run pair finishes in a few seconds alone, and can take several times as long while the rest of the
  // suite starts browsers and servers beside it, so the wait is bounded by time rather than by a short count.
  for (const deadline = Date.now() + 60000; Date.now() < deadline;) {
    const job = studio.manager.publicJob(studio.manager.get(id));
    const done = status => ['completed', 'failed', 'cancelled'].includes(status);
    if (done(job.status) && job.runs.every(run => done(run.status)) && !studio.manager.characterControllers.has(id)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The character pair did not finish.');
}
const post = (studio, route, body) => fetch(`${studio.appUrl}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// Queues a character pair and waits for it to finish.
async function pair(studio, extra = {}) {
  const response = await post(studio, '/api/jobs', { kind: 'character', brief, ...extra });
  const body = await response.json();
  assert.equal(response.status, 202, body.error);
  return finished(studio, body.id);
}

test('a character pair runs on the Studio queue and records both characters with the shared qualities', async t => {
  const { studio, directory } = await setup(t);
  const response = await post(studio, '/api/jobs', { kind: 'character', brief, portraitsPerArm: 0 });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  const job = await finished(studio, id);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(job.kind, 'character');
  assert.equal(job.recordKind, 'dry-run');
  assert.deepEqual(job.runs.map(run => `${run.label}:${run.status}`), ['Qloo off:completed', 'Qloo on:completed']);
  assert.ok(job.runs[1].events.some(event => /Taste pass ok/u.test(event.message)), 'taste-pass events belong to the Qloo on run');
  assert.ok(job.runs[0].events.some(event => /Prediction frozen/u.test(event.message)));
  assert.deepEqual(job.taste.qualities.slice(0, 2).map(item => `${item.family}:${item.name}`), ['look:Colorful', 'mood:Playful']);
  // Art styles are derived from the works' art_style tags; the strongest one that names a render style draws the frame.
  assert.deepEqual(job.taste.artStyles.map(item => `${item.name}:${item.preset}`), ['Hand-Drawn:ink', 'Pixel Art:pixel']);
  assert.deepEqual(job.taste.renderStyle, { name: 'Hand-Drawn', preset: 'ink' });
  // Both arms planned from the same capability list and reviewed captures of their own character.
  assert.deepEqual(job.protocol, { artDirection: true, departure: true, music: { tracks: 20 }, production: { required: [], capture: 'fixture', rounds: 2,
    unavailable: [{ id: 'painted-rig', reason: 'This run does not paint the characters.' }, { id: 'portrait', reason: 'This run paints no portraits.' }] } });
  for (const side of [job.production.baseline, job.production.qloo]) {
    assert.deepEqual(side.byLayer.palette, ['vector-rig']);
    assert.deepEqual([side.clusters.length, side.criteria, side.review.met, side.review.audited], [2, 3, 3, false]);
  }
  assert.match(job.comparison.productionHeadline, /Both plans make every layer by the same methods/u);
  assert.match(job.comparison.headline, /rest on entities, tags or qualities/u);
  assert.match(job.comparison.qualityHeadline, /translate measured qualities/u);
  assert.match(job.comparison.worldHeadline, /Qloo on sets the moment in the ink and paper style/u);
  assert.ok(job.comparison.distance.overall > 0.3 && job.comparison.distance.world > 0.5, JSON.stringify(job.comparison.distance));
  assert.deepEqual([job.comparison.moments.baseline.render, job.comparison.moments.qloo.render], ['watercolor', 'ink']);
  assert.deepEqual([job.comparison.moments.qloo.music.license, job.comparison.moments.qloo.music.source], ['CC BY 3.0', 'Jamendo']);
  assert.ok(job.comparison.momentMoved.qloo > 0.8 && job.comparison.momentMoved.baseline < 0.2, JSON.stringify(job.comparison.momentMoved));
  assert.match(job.urls.embed, new RegExp(`/game/${id}/[a-f0-9]{48}/compare\\.html\\?pair=${job.pairId}&embed=1$`, 'u'));
  assert.deepEqual(Object.keys(job.urls.play), ['qloo-off', 'qloo-on']);
  assert.match(job.urls.play['qloo-on'], /index\.html\?character=runs%2Fpair-[^&]+%2Fqloo-on\.json$/u);
  // The pair's files sit in the job's own folder, in the layout the command-line runner writes.
  for (const file of ['pair.json', 'taste.json', 'qloo-off.json', 'qloo-on.json']) await fs.access(path.join(directory, id, job.pairId, file));
  const listed = await (await fetch(`${studio.appUrl}/api/character-jobs`)).json();
  assert.deepEqual(listed.map(item => [item.id, item.status, item.qualities, item.artDirection, item.swap, item.ablation]), [[id, 'completed', true, true, false, false]]);
  // A fixture profile is no measured profile, so it is not offered for reuse.
  assert.equal(listed[0].profile, false);
  const defaults = await (await fetch(`${studio.appUrl}/api/character-defaults`)).json();
  assert.equal(defaults.world.name, 'The Long Dusk');
  assert.equal(defaults.brief.references.length, 5);
  assert.deepEqual(defaults.ageBands.map(band => band.value), QLOO_AGE_BANDS);
  assert.equal(defaults.ageBands.find(band => band.value === '36_to_55').label, '36 to 55');
  assert.deepEqual([defaults.music.tracks, defaults.music.licenses, defaults.music.source], [20, ['CC BY 3.0'], 'Jamendo']);
  assert.deepEqual(defaults.production.requirable.map(item => item.id), ['painted-rig', 'portrait']);
  assert.equal(typeof defaults.production.review.available, 'boolean');
  // Site-file routes and the site preview refuse a character pair.
  assert.equal((await fetch(`${studio.appUrl}/api/jobs/${id}/runs/qloo/download`)).status, 404);
  const token = job.urls.embed.match(/\/([a-f0-9]{48})\//u)[1];
  assert.equal((await fetch(`${studio.previewBaseUrl}/preview/${id}/qloo/${token}/index.html`)).status, 404);
});

test('a hosted Studio runs pairs as a server without a generator, with the browser it checked at start', async t => {
  const calls = [];
  const browser = { available: false, label: 'Chromium', reason: 'Chromium could not capture a test page here. The browser could not run: its sandbox needs user namespaces, which this system blocks (a default Docker container does).' };
  const { studio } = await setup(t, { overrides: { environment: 'hosted' }, browser, characterRunner: options => { calls.push(options); return dryRun(options); } });
  const job = await pair(studio);
  assert.equal(job.status, 'completed', job.error);
  assert.deepEqual([calls[0].environment, calls[0].browser], ['hosted', browser]);
  // Both arms read that the server paints nothing, and why.
  assert.deepEqual(job.protocol.production.unavailable, [{ id: 'painted-rig', reason: HOSTED_IMAGE_REASON }, { id: 'portrait', reason: HOSTED_IMAGE_REASON }]);
  assert.equal(job.pictures, null);
  const defaults = await (await fetch(`${studio.appUrl}/api/character-defaults`)).json();
  assert.deepEqual(defaults.production.review, { available: false, reason: browser.reason });
});

test('a pair records the pictures a generator made, so a server without one can say where it was recorded', () => {
  const arms = [{ portraits: [{ status: 'generated', provider: 'codex' }, { status: 'failed', provider: 'codex' }] }, { portraits: [], paint: { status: 'painted', provider: 'codex' } }];
  assert.deepEqual(pairPictures(arms), { portraits: 1, painted: 1, providers: ['codex'] });
  // The dry run's fixture painter makes no picture of record.
  assert.equal(pairPictures([{ portraits: [], paint: { status: 'painted', provider: 'fixture' } }]), null);
  assert.equal(pairPictures([{ portraits: [{ status: 'failed' }] }, {}]), null);
});

test('the preview server plays a pair from an allowlist under the game sandbox', async t => {
  const { studio } = await setup(t);
  const { id } = await (await post(studio, '/api/jobs', { kind: 'character', brief })).json();
  const job = await finished(studio, id);
  const base = job.urls.embed.replace(/compare\.html.*$/u, '');
  const page = await fetch(job.urls.embed);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/u);
  assert.match(page.headers.get('content-security-policy'), /sandbox allow-scripts$/u);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/u);
  assert.equal(page.headers.get('access-control-allow-origin'), '*');
  for (const [file, type] of [['src/compare.js', /javascript/u], ['styles.css', /css/u], ['world/canon.json', /json/u], ['characters/maren.json', /json/u],
    ['fonts/eb-garamond-latin-wght-normal.woff2', /woff2/u], [`runs/${job.pairId}/pair.json`, /json/u], [`runs/${job.pairId}/qloo-on.json`, /json/u]]) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), type, file);
  }
  assert.equal((await (await fetch(`${base}runs/${job.pairId}/pair.json`)).json()).status, 'completed');
  // Host records, other pairs, other files and traversal are refused; so is a wrong capability.
  for (const file of [`runs/${job.pairId}/taste.json`, `runs/${job.pairId}/work/qloo-on/host/session.json`, 'runs/other-pair/pair.json', 'harness/run-pair.mjs', 'samples/sample-a.json', '%2e%2e%2f%2e%2e%2fpackage.json', 'fonts/not-a-font.woff2',
    // Allowed names this pair never wrote: a 404, not a request left open.
    `runs/${job.pairId}/qloo-on-portrait-1.jpg`, `runs/${job.pairId}/qloo-swap.json`]) {
    assert.equal((await fetch(`${base}${file}`)).status, 404, file);
  }
  assert.equal((await fetch(base.replace(/\/[a-f0-9]{48}\//u, `/${'0'.repeat(48)}/`) + 'compare.html')).status, 403);
});

test('a painted pair serves its pieces and figures as PNGs, and nothing else under those names', async t => {
  // The dry run paints with the fixture painter, so the pictures exist without a Codex request.
  const { studio } = await setup(t, { characterRunner: options => runPair({ ...options, mode: 'dry-run', runArm: scriptArm, paintPerArm: 1 }) });
  const { id } = await (await post(studio, '/api/jobs', { kind: 'character', brief })).json();
  const job = await finished(studio, id);
  assert.equal(job.status, 'completed', job.error);
  const base = job.urls.embed.replace(/compare\.html.*$/u, '');
  const character = await (await fetch(`${base}runs/${job.pairId}/qloo-on.json`)).json();
  // The review captures each arm judged are served beside the pieces.
  for (const file of [character.skin.images[0].src, character.skin.tips[0].src, `runs/${job.pairId}/qloo-on-figure.png`, `runs/${job.pairId}/qloo-off-figure.png`,
    `runs/${job.pairId}/qloo-on-review-r1-pose.png`, `runs/${job.pairId}/qloo-off-review-r1-kindle.png`]) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), /image\/png/u, file);
    await response.arrayBuffer();
  }
  for (const file of [`runs/${job.pairId}/qloo-on-skin-layer-99.png`, `runs/${job.pairId}/qloo-on-skin-blueprint.png`, `runs/${job.pairId}/qloo-on-figure.jpg`,
    `runs/${job.pairId}/work/qloo-on/skin/paint-1/painted.png`, `runs/${job.pairId}/qloo-on-review-r2-pose.png`, `runs/${job.pairId}/qloo-on-review-r1-sheet.png`,
    `runs/${job.pairId}/work/qloo-on/workspace/review/r1-pose.png`]) assert.equal((await fetch(`${base}${file}`)).status, 404, file);
  const record = await (await fetch(`${base}runs/${job.pairId}/pair.json`)).json();
  assert.deepEqual(record.arms.map(arm => arm.paint.status), ['painted', 'painted']);
});

test('the preview server plays the open music library: its catalogue and the tracks it lists, in byte ranges', async t => {
  const { studio } = await setup(t);
  const { id } = await (await post(studio, '/api/jobs', { kind: 'character', brief })).json();
  const job = await finished(studio, id);
  const base = job.urls.embed.replace(/compare\.html.*$/u, '');
  const catalog = await fetch(`${base}music/catalog.json`);
  assert.equal(catalog.status, 200);
  assert.match(catalog.headers.get('content-type'), /application\/json/u);
  assert.match(catalog.headers.get('content-security-policy'), /media-src 'self'/u);
  const { tracks } = await catalog.json();
  assert.equal(tracks.length, 20);
  assert.ok(tracks.every(track => track.license === 'CC BY 3.0' && track.attribution && /^https:\/\//u.test(track.sourceUrl)));
  const file = `${base}music/${tracks[0].file}`;
  const whole = await fetch(file);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.match(whole.headers.get('content-type'), /audio\/mpeg/u);
  assert.equal(whole.headers.get('x-content-type-options'), 'nosniff');
  const size = (await whole.arrayBuffer()).byteLength;
  assert.ok(size > 100000 && Number(whole.headers.get('content-length')) === size, String(size));
  // The preview origin serves GET only.
  assert.equal((await fetch(file, { method: 'HEAD' })).status, 405);
  // The audio element asks for ranges; the response carries exactly those bytes.
  const part = await fetch(file, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${size}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(file, { headers: { Range: `bytes=${size + 10}-` } })).status, 416);
  for (const bad of ['music/not-a-track.mp3', 'music/catalog.json.bak', 'music/..%2F..%2F.env', 'music/']) assert.equal((await fetch(`${base}${bad}`)).status, 404, bad);
});

test('a swap pair and a reused profile run without a taste pass, and an ablation turns the departure rule off', async t => {
  const { studio, directory } = await setup(t);
  const source = await pair(studio);
  assert.equal(source.status, 'completed', source.error);
  // The swapped arm designs from the source pair's recorded profile under this brief; the first arm measures this brief.
  const swap = await pair(studio, { swapFrom: source.id });
  assert.equal(swap.status, 'completed', swap.error);
  assert.deepEqual(swap.runs.map(run => `${run.key}:${run.label}:${run.status}`), ['qloo-on:Qloo on:completed', 'qloo-swap:Swapped profile:completed']);
  assert.match(swap.swapTaste.from, new RegExp(`^${source.pairId} \\(job ${source.id.slice(0, 8)}\\)$`, 'u'));
  assert.deepEqual(swap.comparison.labels, { baseline: 'Qloo on', qloo: 'Swapped profile' });
  assert.match(swap.comparison.dataHeadline, /The two profiles share/u);
  assert.ok(swap.runs[1].events.some(event => /designs from the profile recorded for/u.test(event.message)));
  assert.deepEqual(Object.keys(swap.urls.play), ['qloo-on', 'qloo-swap']);
  const base = swap.urls.embed.replace(/compare\.html.*$/u, '');
  const swapped = await fetch(`${base}runs/${swap.pairId}/qloo-swap.json`);
  assert.deepEqual([swapped.status, (await swapped.json()).id], [200, 'sample-b']);
  const missing = await fetch(`${base}runs/${swap.pairId}/qloo-off.json`);
  assert.equal(missing.status, 404);
  await missing.text();
  // A reused profile makes no request and is kept in the pair's own folder, so a later pair can reuse it again.
  const reuse = await pair(studio, { profileFrom: source.id, departure: false });
  assert.equal(reuse.status, 'completed', reuse.error);
  assert.match(reuse.taste.reusedFrom, new RegExp(`^${source.pairId} `, 'u'));
  assert.ok(reuse.runs[1].events.some(event => /Reusing the recorded taste profile of .*; no Qloo request is made/u.test(event.message)));
  assert.ok(!reuse.runs.some(run => run.events.some(event => /Host taste pass/u.test(event.message))));
  const kept = JSON.parse(await fs.readFile(path.join(directory, reuse.id, reuse.pairId, 'taste.json'), 'utf8'));
  assert.deepEqual([kept.profile.status, kept.reusedFrom, kept.evidence.length > 0], ['ok', reuse.taste.reusedFrom, true]);
  assert.deepEqual([reuse.departure, reuse.protocol.departure], [false, false]);
  const listed = await (await fetch(`${studio.appUrl}/api/character-jobs`)).json();
  const row = jobId => listed.find(item => item.id === jobId);
  assert.deepEqual([row(swap.id).swap, row(reuse.id).ablation, row(source.id).swap], [true, true, false]);
  const again = await pair(studio, { profileFrom: reuse.id });
  assert.equal(again.status, 'completed', again.error);
});

test('the audience, the departure rule and recorded profiles are validated before anything is queued', async t => {
  const { studio } = await setup(t);
  const source = await pair(studio);
  const before = studio.manager.jobs.size;
  const cases = [
    [{ age: 'teenagers' }, /Choose an audience age band Qloo knows/u],
    [{ location: 'L' }, /2–120 characters/u],
    [{ location: '<script>' }, /2–120 characters/u],
    [{ location: 42 }, /place as text/u],
    [{ departure: 'off' }, /Turn the departure rule on or off/u],
    [{ profileFrom: '00000000-0000-4000-8000-000000000000' }, /The reused taste profile must be a completed character pair/u],
    [{ swapFrom: 'not-a-job' }, /The swapped profile must be a completed character pair/u],
    [{ profileFrom: source.id, location: 'Lisbon, Portugal' }, /keeps the place and age it was measured with/u],
    [{ profileFrom: source.id, swapFrom: source.id }, /another pair than the one this pair reuses/u],
    // A study setting needs the picture method it requires to be on.
    [{ required: 'painted-rig' }, /List the methods both designers must use/u],
    [{ required: ['vector-rig'] }, /can require painted-rig or portrait/u],
    [{ required: ['painted-rig'] }, /only when painting is on/u],
  ];
  for (const [extra, pattern] of cases) {
    const response = await post(studio, '/api/jobs', { kind: 'character', brief, ...extra });
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.match((await response.json()).error, pattern, JSON.stringify(extra));
  }
  // A profile recorded before shared qualities cannot stand in for a taste pass, and it is not offered.
  const recorded = studio.manager.get(source.id), qualities = recorded.taste.qualities;
  recorded.taste.qualities = [];
  const bare = await post(studio, '/api/jobs', { kind: 'character', brief, swapFrom: source.id });
  assert.equal(bare.status, 400);
  assert.match((await bare.json()).error, /a pair whose profile has measured shared qualities/u);
  recorded.taste.qualities = qualities;
  assert.equal(studio.manager.jobs.size, before);
  const request = characterRequest({ brief, location: '  Lisbon,   Portugal ', age: '24_and_younger' });
  assert.deepEqual([request.audience, request.departure, request.profileFrom, request.swapFrom], [{ location: 'Lisbon, Portugal', age: ['24_and_younger'] }, true, null, null]);
  // A located pair weights every taste request and tells both arms the audience.
  const located = await pair(studio, { location: 'Lisbon, Portugal', age: '24_and_younger' });
  assert.equal(located.status, 'completed', located.error);
  assert.deepEqual([located.audience, located.protocol.audience, located.taste.location, located.taste.age], [request.audience, request.audience, 'Lisbon, Portugal', ['24_and_younger']]);
  assert.ok(located.runs[1].events.some(event => /weighted toward Lisbon, Portugal and ages 24 and younger/u.test(event.message)));
});

test('a character request is validated before anything is queued', async t => {
  const { studio } = await setup(t);
  const cases = [
    [{ kind: 'character', brief: { ...brief, brief: 'Too short.' } }, /40–3,500 characters/u],
    [{ kind: 'character', brief: { ...brief, references: [] } }, /Name 1–8/u],
    [{ kind: 'character', brief: { ...brief, references: Array.from({ length: 9 }, (_, index) => `Reference ${index}`) } }, /Name 1–8/u],
    [{ kind: 'character', brief, portraitsPerArm: 1 }, /Codex image generation/u],
    [{ kind: 'character', brief, portraitsPerArm: 3 }, /0–2 portraits/u],
    [{ kind: 'character', brief, paintPerArm: 1 }, /Painting the characters needs Codex image generation/u],
    [{ kind: 'character', brief, paintPerArm: 3 }, /up to two paintings, or none/u],
  ];
  for (const [body, pattern] of cases) {
    const response = await post(studio, '/api/jobs', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, pattern);
  }
  assert.equal(studio.manager.jobs.size, 0);
  // Duplicates and blank lines are dropped; every reference is an audience reference the user gave.
  const request = characterRequest({ brief: { ...brief, references: ['Paterson', ' paterson ', '', 'Nujabes'] } });
  assert.deepEqual(request.brief.references, [{ name: 'Paterson', role: 'audience', origin: 'user-provided' }, { name: 'Nujabes', role: 'audience', origin: 'user-provided' }]);
});

test('pairs queued in the same second get distinct pair IDs', () => {
  // Four live pairs queued in one second once shared a timestamp ID; the job's prefix now tells them apart.
  const request = characterRequest({ brief });
  const ids = Array.from({ length: 4 }, () => newCharacterJob({ request, model: 'fixed-test-model', effort: 'medium', images: null }).pairId);
  assert.equal(new Set(ids).size, 4);
  for (const id of ids) { assert.match(id, /^pair-\d{8}-\d{6}-[a-f0-9]{8}$/u); assert.match(id, PAIR_ID); }
});

test('a running pair can be stopped, and a restarted Studio keeps finished pairs', async t => {
  let started;
  const begun = new Promise(resolve => { started = resolve; });
  // A stand-in runner that works until it is cancelled, the way a Kiro run ends on abort.
  const waiting = ({ signal, onArm }) => new Promise(resolve => {
    onArm({ arm: 'qloo-off', status: 'running' }); started();
    signal.addEventListener('abort', () => resolve({ status: 'cancelled', error: 'The pair was cancelled.', arms: [{ key: 'qloo-off', status: 'cancelled', error: 'The run was cancelled.' }] }));
  });
  const { studio, config, directory } = await setup(t, { characterRunner: waiting });
  const { id } = await (await post(studio, '/api/jobs', { kind: 'character', brief })).json();
  await begun;
  const stopped = await (await post(studio, `/api/jobs/${id}/cancel`, {})).json();
  assert.equal(stopped.status, 'cancelled');
  const job = await finished(studio, id);
  assert.deepEqual(job.runs.map(run => run.status), ['cancelled', 'cancelled']);
  assert.equal(job.urls, null);
  await studio.close();
  const again = await createStudio({ config: { ...config, dataDir: directory }, inspect: readyKiro });
  t.after(() => again.close());
  assert.equal(again.manager.get(id).kind, 'character');
  assert.equal(again.manager.publicJob(again.manager.get(id)).status, 'cancelled');
});
