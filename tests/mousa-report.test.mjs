// The Taste Provenance report: the page and record design_report writes from a session's records, for one design, a
// comparison, a measurement before any design and a session without Qloo; names only, no script, the same distance as
// design_compare, the earlier 0.4 records, and the page and card pictures through a real browser when one can run.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createMousaServer } from '../plugin/server/mcp/mousa.mjs';
import { createConnectionStore, plainProtector } from '../plugin/server/connections/store.mjs';
import { readRecords, provenance, writeSessionReport, captureReport, scrubText, answerLists, REPORT_PICTURES } from '../plugin/server/design/report.mjs';
import { inspectBrowser, verifyBrowser } from '../plugin/server/production/capture.mjs';
import { loadFontLibrary, fontLibraryRoot } from '../plugin/server/production/fonts.mjs';
import { pngSize } from '../plugin/server/production/image-files.mjs';
import { buildReports } from '../scripts/build-report.mjs';
import { qlooFixture, prediction, parse, exists, designFor, baselineDesign, fakeShoot, reportServer as server, measuredSession, PLAN } from './helpers/mousa-fixtures.mjs';

const QLOO = 'compare/with-qloo', OWN = 'compare/without-qloo';
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

/** What may never reach a published report: the taste input's refs, which hold Qloo's ids and tag URNs, and its scores. */
function assertNamesOnly(text, input, label) {
  for (const entity of input.entities) assert.ok(!text.includes(`"${entity.ref}"`) && !text.includes(`>${entity.ref}<`), `${label} carries the ref ${entity.ref}`);
  assert.doesNotMatch(text, /urn:(?:tag|entity|audience):/u, `${label} carries a Qloo URN`);
  assert.doesNotMatch(text, /"(?:affinity|popularity|description)"\s*:/u, `${label} carries a Qloo score or description`);
}

test('a session\'s report sets the prediction beside the measurement and follows it to the review, with names only', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-config-'));
  const { fetchImpl, requests } = qlooFixture();
  const asked = [];
  const mousa = server(project, config, fetchImpl, { shoot: fakeShoot(asked) });
  const call = async (name, args) => parse(await mousa.callTool(name, args));
  try {
    assert.equal((await call('design_report', {})).error.code, 'REPORT_EMPTY', 'nothing to report before the measurement');
    const input = await measuredSession(call, project);
    const sent = requests.length;
    const written = await call('design_report', {});
    assert.equal(written.status, 'written', JSON.stringify(written));
    assert.equal(requests.length, sent, 'the report makes no Qloo request');
    assert.equal(written.kind, 'session');
    assert.equal(written.report, '.mousa/report/index.html');
    assert.deepEqual(written.pictures, { report: '.mousa/report/report.png', card: '.mousa/report/card.png' });
    assert.deepEqual(asked.map(shot => [new URL(shot.url).pathname, shot.width, shot.full === true, shot.maxHeight ?? null]),
      [['/index.html', 1280, true, REPORT_PICTURES.page.maxHeight], ['/card.html', 1200, false, null]], 'the whole page at a reading width and the card at its size');

    const dir = path.join(project, '.mousa', 'report');
    const record = await readJson(path.join(dir, 'record.json'));
    const stats = (await readJson(path.join(project, '.mousa', 'design', 'dna.json'))).dna.stats;
    assert.equal(record.headline.sentence, `${stats.surpriseAnchoredDevices} of ${stats.devices} devices rest on what the prediction did not contain.`, 'the headline is the DNA\'s own count');
    assert.equal(written.headline, record.headline.sentence);
    assert.equal(record.title, 'For an audience that loves Paterson and Nujabes');
    assert.equal(record.writtenBy.version, '0.7.1');
    assert.deepEqual(record.prediction.sketch.palette, ['#f3ead8', '#2f2a24', '#b5653a']);
    assert.ok(record.prediction.groups.find(group => group.domain === 'movie').entries.some(entry => entry.name === 'Perfect Days' && entry.measured), 'a predicted work Qloo measured is marked');
    assert.ok(Object.values(record.measured.qualities).flat().some(item => item.mark === 'new'), 'measured qualities carry their marks');
    assert.equal(record.dna.devices.length, 6);
    const terrace = record.dna.devices.find(device => device.id === 'dna4');
    assert.deepEqual(terrace.pictures, ['assets/pictures/dna4-1.png']);
    assert.equal(terrace.method, 'generated-image');
    assert.equal(terrace.check, 'present');
    assert.ok(record.dna.devices.every(device => device.anchors.every(anchor => anchor.name && anchor.mark)), 'every anchor is named, never given by its ref');
    assert.deepEqual(record.captures.map(capture => [capture.id, capture.file, capture.cited]), [['r1-desktop', 'assets/captures/r1-desktop.png', true], ['r1-mobile', 'assets/captures/r1-mobile.png', true]]);
    assert.deepEqual(record.reviews.map(review => [review.round, review.met, review.partly]), [[1, 1, 1]]);
    assert.equal(record.check.score, 1);
    assert.ok(record.fonts.some(font => font.family === 'Jost'), 'the DNA\'s family is loaded for its sample');
    assert.ok(record.limits.some(limit => /interpretation/u.test(limit)));

    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<script/iu, 'the page runs no script');
    assert.match(html, /@font-face\{font-family:'Fraunces';src:url\(data:font\/woff2;base64,/u, 'its fonts are embedded, so it opens from its folder');
    assert.match(html, /<b>Interpretation<\/b>/u);
    assert.match(html, /data-mark="new"/u);
    assert.match(html, /src="assets\/captures\/r1-desktop\.png"/u);
    assert.match(html, /Shorten the headline size at phone width\./u, 'the repair is on the page');
    for (const [label, text] of [['record.json', JSON.stringify(record)], ['index.html', html], ['card.html', await readFile(path.join(dir, 'card.html'), 'utf8')]]) assertNamesOnly(text, input, label);
    for (const file of ['assets/captures/r1-desktop.png', 'assets/captures/r1-mobile.png', 'assets/pictures/dna4-1.png', 'report.png', 'card.png']) assert.ok(await exists(path.join(dir, ...file.split('/'))), file);
    assert.ok((await readdir(path.join(dir, 'assets', 'fonts'))).some(name => name.endsWith('.OFL.txt')), 'the fonts\' licences sit beside them');

    // The report is written afresh each time, and the design's own check never reads it.
    await writeFile(path.join(dir, 'stale.html'), '<p>old</p>');
    assert.equal((await call('design_report', { picture: false })).pictures, undefined, 'picture:false takes no picture');
    assert.ok(!(await exists(path.join(dir, 'stale.html'))) && !(await exists(path.join(dir, 'report.png'))), 'nothing of the earlier report stays behind');
    assert.equal((await call('design_check', {})).score, 1);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('a comparison report pairs the arms\' captures, beside each arm\'s own, and gives design_compare\'s distance', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-compare-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-compare-config-'));
  const { fetchImpl } = qlooFixture();
  const mousa = server(project, config, fetchImpl);
  const call = async (name, args) => parse(await mousa.callTool(name, args));
  try {
    const input = await measuredSession(call, project, QLOO);
    await call('taste_profile', { ...PLAN, workspace: OWN });
    await call('design_validate', { stage: 'prediction', artifact: prediction(), workspace: OWN });
    assert.equal((await call('taste_profile', { baseline: true, workspace: OWN })).status, 'baseline');
    const own = baselineDesign(await readJson(path.join(project, 'compare', 'without-qloo', '.mousa', 'taste', 'input.json')));
    for (const [stage, artifact] of [['reading', own.reading], ['dna', own.dna]]) assert.equal((await call('design_validate', { stage, artifact, workspace: OWN })).status, 'valid');
    await writeFile(path.join(project, 'compare', 'without-qloo', 'index.html'), '<!doctype html><html><head><style>:root{--paper:#f3ead8;--rust:#b5653a}body{background:var(--paper);color:var(--rust);font-family:Literata,serif}</style></head><body><main><section id="week-loop"></section></main></body></html>');
    await call('design_capture', { workspace: OWN });

    assert.equal((await call('design_report', { a: QLOO })).error.code, 'TOOL_INPUT_INVALID', 'a comparison needs both arms');
    assert.equal((await call('design_report', { a: QLOO, b: OWN, workspace: QLOO })).error.code, 'TOOL_INPUT_INVALID');
    const compared = await call('design_compare', { a: QLOO, b: OWN });
    const written = await call('design_report', { a: QLOO, b: OWN });
    assert.equal(written.status, 'written', JSON.stringify(written));
    assert.equal(written.report, '.mousa/compare-report/index.html');
    assert.deepEqual(written.arms.map(arm => arm.report), ['compare/with-qloo/.mousa/report/index.html', 'compare/without-qloo/.mousa/report/index.html']);
    const record = await readJson(path.join(project, '.mousa', 'compare-report', 'record.json'));
    assert.deepEqual(record.distance, compared.distance, 'the page gives the distance design_compare gives');
    assert.equal(record.samePrediction, true);
    assert.deepEqual(record.arms.map(arm => [arm.label, arm.taste, arm.kind]), [['With Qloo', 'qloo', 'session'], ['Without Qloo', 'own prediction', 'baseline']]);
    assert.deepEqual(record.views.map(view => [view.key, view.a?.file, view.b?.file]), [['desktop', 'assets/captures/a-r1-desktop.png', 'assets/captures/b-r1-desktop.png'], ['mobile', 'assets/captures/a-r1-mobile.png', 'assets/captures/b-r1-mobile.png']]);
    assert.ok(record.layers.some(row => row.layer === 'palette' && row.arms.every(devices => devices.length)), 'both arms have a palette row');
    const html = await readFile(path.join(project, '.mousa', 'compare-report', 'index.html'), 'utf8');
    assert.match(html, /href="\.\.\/\.\.\/compare\/with-qloo\/\.mousa\/report\/index\.html"/u, 'the page links each arm\'s own report');
    assertNamesOnly(html, input, 'the comparison page');
    assertNamesOnly(JSON.stringify(record), input, 'the comparison record');
    for (const file of ['a-r1-desktop.png', 'b-r1-mobile.png']) assert.ok(await exists(path.join(project, '.mousa', 'compare-report', 'assets', 'captures', file)), file);
    const baseline = await readJson(path.join(project, 'compare', 'without-qloo', '.mousa', 'report', 'record.json'));
    assert.equal(baseline.kind, 'baseline');
    assert.equal(baseline.measured, undefined, 'a session without Qloo claims no measurement');
    assert.match(baseline.headline.sentence, /no Qloo data was used/u);
    assert.doesNotMatch(await readFile(path.join(project, 'compare', 'without-qloo', '.mousa', 'report', 'index.html'), 'utf8'), /What Qloo measured/u);

    // The script writes the same reports elsewhere: the comparison in the folder named, its arms inside it.
    const out = path.join(project, 'published');
    const reports = await buildReports(project, { out, picture: false });
    assert.deepEqual(reports.map(report => report.kind), ['session', 'baseline', 'comparison']);
    for (const file of ['index.html', 'arms/with-qloo/index.html', 'arms/without-qloo/record.json']) assert.ok(await exists(path.join(out, ...file.split('/'))), `${file} is kept`);
    assert.match(await readFile(path.join(out, 'index.html'), 'utf8'), /href="arms\/with-qloo\/index\.html"/u);
    assert.deepEqual((await readJson(path.join(out, 'record.json'))).distance, compared.distance);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('a measurement before any design is reported against the prediction, and pictures wait for a browser', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-measure-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-measure-config-'));
  const { fetchImpl } = qlooFixture();
  const mousa = server(project, config, fetchImpl, { browser: { available: false, reason: 'No browser in this test.' } });
  const call = async (name, args) => parse(await mousa.callTool(name, args));
  try {
    await call('taste_profile', PLAN);
    await call('design_validate', { stage: 'prediction', artifact: prediction() });
    assert.equal((await call('design_report', {})).error.code, 'REPORT_EMPTY', 'a frozen prediction alone is not reported');
    await call('taste_profile', {});
    const written = await call('design_report', {});
    assert.equal(written.kind, 'measurement');
    assert.deepEqual(written.pictures, { unavailable: 'No browser in this test.' });
    const record = await readJson(path.join(project, '.mousa', 'report', 'record.json'));
    assert.equal(record.dna, undefined);
    assert.match(record.headline.sentence, /^\d+ of \d+ measured works were not in the prediction\.$/u);
    assert.ok(record.measured.counts.requests > 0, 'the requests the measurement sent are counted');
    const html = await readFile(path.join(project, '.mousa', 'report', 'index.html'), 'utf8');
    assert.match(html, /What Qloo measured/u);
    assert.doesNotMatch(html, /The Design DNA/u);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('published text keeps names and drops ids, local paths and secrets; answers keep their names in order', () => {
  const names = new Map([['00000000-0000-4000-8000-000000000056', 'Kino\'s Journey'], ['urn:tag:style:qloo:majestic', 'Majestic']]);
  assert.equal(scrubText('As in 00000000-0000-4000-8000-000000000056 and urn:tag:style:qloo:majestic.', { names }), 'As in Kino\'s Journey and Majestic.');
  assert.equal(scrubText('An unknown 0e1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8 and urn:tag:theme:qloo:x.'), 'An unknown a Qloo entry and a Qloo tag.');
  assert.equal(scrubText('Saved in D:\\mousa-live\\run-1\\project and /home/alice/site, with key sk-abcdefghijklmnopqrstuv.'), 'Saved in [local path] and [local path], with key [secret].');
  assert.equal(scrubText('tekes wrote this, not tekeszz.', { user: 'tekes' }), '[user] wrote this, not tekeszz.');
  assert.equal(scrubText('A ratio of 16:9 and http://localhost:8787/ stay.'), 'A ratio of 16:9 and http://localhost:8787/ stay.');
  assert.deepEqual(answerLists({ ranked: [{ name: 'Khruangbin', affinity: 0.9 }, { name: 'Tom Misch', affinity: 0.6 }], notFound: ['Nobody'], note: 'Ranked by Qloo affinity.' }),
    [{ label: 'Ranked for this audience', names: ['Khruangbin', 'Tom Misch'] }, { label: 'Not found', names: ['Nobody'] }]);
  assert.deepEqual(answerLists({ place: 'Moda', places: [{ id: 'F-place-x', name: 'Moda Coffee House', affinity: 0.7, popularity: 0.4 }] }), [{ label: 'Places', names: ['Moda Coffee House'] }]);
  assert.deepEqual(answerLists({ worlds: { TV: [{ name: 'Mushishi', new: true }], films: [{ name: 'Columbus' }] } }), [{ label: 'TV', names: ['Mushishi'] }, { label: 'Films', names: ['Columbus'] }]);
});

test('a session of the earlier 0.4 surface is read from its culture files, and a run folder is reported by the script', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-legacy-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-legacy-config-'));
  const out = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-legacy-out-'));
  const { fetchImpl } = qlooFixture();
  const mousa = server(project, config, fetchImpl);
  const call = async (name, args) => parse(await mousa.callTool(name, args));
  try {
    const input = await measuredSession(call, project);
    // The same session as the 0.4 surface kept it: the agent's artifacts as culture-*.json files, the captures under .mousa.
    const { reading, dna, plan } = designFor(input);
    const review = (await readJson(path.join(project, '.mousa', 'design', 'reviews.json'))).reviews[0];
    const files = { 'culture-taste.json': input, 'culture-assumption.json': prediction(), 'culture-reading.json': reading, 'culture-dna.json': dna, 'culture-production.json': plan,
      'culture-review.json': { schemaVersion: '1.0', rounds: [{ round: review.round, criteria: review.criteria, summary: review.summary }] } };
    for (const [name, value] of Object.entries(files)) await writeFile(path.join(project, name), JSON.stringify(value));
    for (const folder of ['taste', 'design']) await rm(path.join(project, '.mousa', folder), { recursive: true, force: true });
    await rm(path.join(project, '.mousa', 'images.json'), { force: true });
    const records = await readRecords(project);
    assert.equal(records.legacy, true);
    assert.equal(records.medium, 'web');
    const record = provenance(records, { host: 'kiro' });
    assert.equal(record.surface, 'earlier tool surface (0.4)');
    assert.equal(record.kind, 'session');
    assert.equal(record.dna.devices.length, 6);
    assert.ok(record.dna.devices.some(device => device.moved), 'the departure from the sketch is worked out again');
    assert.match(record.headline.sentence, /^\d+ of 6 devices rest on what the prediction did not contain\.$/u);
    assert.ok(record.limits.some(limit => /earlier tool surface/u.test(limit)));
    assert.deepEqual(record.reviews.map(item => item.round), [1]);
    assert.equal(record.prediction.groups.reduce((sum, group) => sum + group.entries.length, 0), input.entities.filter(entity => entity.source === 'model-assumption').length);

    const reports = await buildReports(project, { out, picture: false, host: 'kiro' });
    assert.deepEqual(reports.map(report => report.kind), ['session']);
    assert.ok(await exists(path.join(out, 'index.html')) && await exists(path.join(out, 'assets', 'captures', 'r1-desktop.png')));
    assertNamesOnly(await readFile(path.join(out, 'record.json'), 'utf8'), input, 'the script\'s record');
  } finally {
    for (const folder of [project, config, out]) await rm(folder, { recursive: true, force: true });
  }
});

test('an installed browser takes the whole report page past the capture height and the card at its size', async t => {
  const browser = await verifyBrowser(await inspectBrowser());
  if (!browser.available) { t.skip(`No usable browser: ${browser.reason}`); return; }
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-real-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-report-real-config-'));
  const { fetchImpl } = qlooFixture();
  const mousa = server(project, config, fetchImpl);
  const call = async (name, args) => parse(await mousa.callTool(name, args));
  try {
    await measuredSession(call, project);
    const written = await writeSessionReport({ records: await readRecords(project), library: await loadFontLibrary(await fontLibraryRoot()) });
    const shots = await captureReport(written.dir, { browser });
    assert.equal(shots.report.width, REPORT_PICTURES.page.width);
    assert.ok(shots.report.height > 3200, `the page is taken past the 3,200 pixels of a design capture (${shots.report.height})`);
    assert.deepEqual(pngSize(await readFile(path.join(written.dir, 'card.png'))), { width: 1200, height: 630 });
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
