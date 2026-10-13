// The game medium of the mousa surface, and the Long Dusk example it is proven on. A game plan designs in the game
// medium even when the game is played in a page; its sketch and DNA may leave typography out; its tokens are found
// in the game's own data; and a capture waits for a canvas page's window.captureReady and asks a review page for its
// view through the URL fragment. The example is built from game/ and loads in the game's own validator. No model or
// Qloo request is made; a browser is used only when one is installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { normalizeDesignSketch, normalizeDesignDna } from '../plugin/server/culture/taste.mjs';
import { mediumProfile } from '../plugin/server/production/media.mjs';
import { inspectBrowser, verifyBrowser, serveDirectory, captureViews } from '../plugin/server/production/capture.mjs';
import { createMousaServer } from '../plugin/server/mcp/mousa.mjs';
import { createConnectionStore, plainProtector } from '../plugin/server/connections/store.mjs';
import { normalizeCharacter } from '../game/src/format.js';
import { gameExampleFiles, GAME_EXAMPLE_DIR } from '../scripts/build-game-example.mjs';
import { qlooFixture, gamePrediction, gameDesignFor, parse, png, FONTS } from './helpers/mousa-fixtures.mjs';

const SKETCH = { summary: 'A hooded wanderer with an amber lantern.', palette: ['#2f3440', '#f2a541', '#d9d2c3'], sections: ['hood', 'scarf', 'lantern'], motifs: ['swinging lantern'] };

test('a game\'s sketch may name no font, and its DNA may leave typography out, while a website\'s may not', () => {
  assert.throws(() => normalizeDesignSketch({ ...SKETCH, fonts: [] }), /fonts/u);
  assert.deepEqual(normalizeDesignSketch({ ...SKETCH, fonts: [] }, 'designSketch', { typography: 'optional' }).fonts, []);
  assert.deepEqual(normalizeDesignSketch(SKETCH, 'designSketch', { typography: 'optional' }).fonts, [], 'the field itself may be left out');
  assert.throws(() => normalizeDesignSketch({ ...SKETCH, fonts: ['serif'] }, 'designSketch', { typography: 'optional' }), /Name at least one font family/u, 'a sketch that names type still names a family');
  assert.throws(() => normalizeDesignDna({}, { input: { entities: [] }, rules: { typography: 'sometimes' } }), /typography:"required"\|"optional"/u);
  const game = mediumProfile('game');
  assert.deepEqual([game.requiredLayers, game.views.map(view => view.id)], [['palette', 'motion', 'voice'], ['frame']]);
});

test('a game plan designs in the game medium: no typography, tokens in the character file, captures by view', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-game-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-game-config-'));
  const { fetchImpl } = qlooFixture();
  const calls = [];
  const fakeCapture = async ({ views, outDir, prefix, entry, target, ready }) => {
    calls.push({ entry, target, ready, views: views.map(view => view.id) });
    return Promise.all(views.map(async view => {
      const id = [prefix, view.id, target].filter(Boolean).join('-'), file = path.join(outDir, `${id}.png`);
      await writeFile(file, png(64, 36, ['#3e5c6b', '#8fb0a9']));
      return { id, view: view.id, ...(target ? { target } : {}), width: 64, height: 36, bytes: 1, file };
    }));
  };
  const server = createMousaServer({ env: { MOUSA_PROJECT_DIR: project, QLOO_API_KEY: 'fixture-key-123' }, fetchImpl, capture: fakeCapture,
    store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: true, label: 'Test browser' }), codex: async () => ({ available: false, reason: 'Not in tests.' }), fonts: async () => FONTS } });
  const call = async (name, args) => parse(await server.callTool(name, args));
  try {
    // The game is played in a page whose interface keeps its values in custom properties, as the Long Dusk's does.
    await writeFile(path.join(project, 'index.html'), '<!doctype html><main id="stage"><canvas id="view"></canvas></main>');
    await writeFile(path.join(project, 'capture.html'), '<!doctype html><canvas id="view"></canvas><script>window.captureReady = Promise.resolve(true);</script>');
    await writeFile(path.join(project, 'styles.css'), ':root { --night: #10151f; --parchment: #e9e0cc; --pewter: #98a2b6; } body { background: var(--night); color: var(--parchment); }');
    await mkdir(path.join(project, 'characters'), { recursive: true });

    const planned = await call('taste_profile', { dryRun: true, medium: 'game', references: [{ name: 'Paterson' }, { name: 'Nujabes' }] });
    assert.equal(planned.plan.typography, 'optional');
    assert.match(planned.plan.prediction.shape, /fonts:\[0-3 library families/u);
    assert.equal((await call('design_validate', { stage: 'prediction', artifact: gamePrediction() })).status, 'frozen', 'a sketch with no font');
    assert.equal((await call('taste_profile', {})).status, 'ok');
    const input = JSON.parse(await readFile(path.join(project, '.mousa', 'taste', 'input.json'), 'utf8'));
    const { reading, dna, plan, character } = gameDesignFor(input);

    const read = await call('design_validate', { stage: 'reading', artifact: reading });
    assert.equal(read.status, 'valid', JSON.stringify(read));
    assert.equal(read.medium, 'game', 'the plan\'s recipe, though the project has a page');
    const asProject = await call('design_validate', { stage: 'dna', artifact: dna, medium: 'generic' });
    assert.match(asProject.error.message, /Include palette and typography devices/u, 'any other project still needs its type');
    const specified = await call('design_validate', { stage: 'dna', artifact: dna });
    assert.equal(specified.status, 'valid', JSON.stringify(specified));
    assert.equal(specified.medium, 'game');
    assert.ok(specified.methods.motion.includes('source'));
    // Both live game sessions first named the review page's own view; the refusal says where it goes.
    const byPageView = await call('design_validate', { stage: 'plan', artifact: { ...plan, review: plan.review.map(item => ({ ...item, view: 'walk' })) } });
    assert.match(byPageView.error.message, /Use a capture view: frame\. A view the page draws itself, such as a game's walk, is the capture's target/u);
    const planSaved = await call('design_validate', { stage: 'plan', artifact: plan });
    assert.equal(planSaved.status, 'valid', JSON.stringify(planSaved));

    await writeFile(path.join(project, 'characters', 'ilo.json'), character);
    const checked = await call('design_check', {});
    assert.equal(checked.medium, 'game');
    assert.equal(checked.score, 1, JSON.stringify(checked.devices));
    assert.equal(checked.bindings, undefined, 'a game\'s palette is not asked of its interface\'s custom properties');

    const shot = parse(await server.callTool('design_capture', { entry: 'capture.html', target: 'walk' }));
    assert.deepEqual(shot.captures.map(item => item.id), ['r1-frame-walk']);
    assert.deepEqual(calls.at(-1), { entry: 'capture.html', target: 'walk', ready: calls.at(-1).ready, views: ['frame'] });
    assert.match(calls.at(-1).ready, /window\.captureReady/u, 'the capture waits for the page to draw');
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('the Long Dusk example is built from game/, and its starting Ilo passes the game\'s own validator', async () => {
  const files = await gameExampleFiles();
  const committed = async name => readFile(path.join(GAME_EXAMPLE_DIR, ...name.split('/')));
  for (const [name, content] of files) assert.ok((await committed(name)).equals(Buffer.from(content)), `${name} is what the build makes; run node scripts/build-game-example.mjs`);
  const listed = async dir => (await readdir(path.join(GAME_EXAMPLE_DIR, dir))).map(name => `${dir}/${name}`);
  for (const dir of ['src', 'characters', 'world', 'fonts']) for (const name of await listed(dir)) assert.ok(files.has(name), `${name} is no longer built`);
  const canon = JSON.parse(files.get('world/canon.json'));
  const ilo = normalizeCharacter(JSON.parse(files.get('characters/ilo.json')), { canon });
  assert.equal(ilo.name, 'Ilo');
  assert.match(files.get('src/capture.js'), /location\.hash\.slice\(1\)/u, 'the review page takes its view from the fragment');
  assert.ok(!/compare\.html/u.test(files.get('index.html')));
  assert.ok(!/game_[a-z_]+|mannequin\.json/u.test(files.get('FORMAT.md')), 'the guide names no Studio tool');
  assert.match(await readFile(path.join(GAME_EXAMPLE_DIR, 'README.md'), 'utf8'), /design_capture\(\{ entry: 'capture\.html', target: 'walk' \}\)/u);
});

test('the example\'s review page draws each view in a real browser, and names an invalid field', async t => {
  const browser = await verifyBrowser(await inspectBrowser({}));
  if (!browser.available) { t.skip(browser.reason); return; }
  const READY = 'Promise.resolve(window.captureReady).then(value => value === undefined ? true : value, error => String(error && error.message || error))';
  const out = await mkdtemp(path.join(os.tmpdir(), 'mousa-game-shots-'));
  const copy = await mkdtemp(path.join(os.tmpdir(), 'mousa-game-copy-'));
  try {
    const served = await serveDirectory(GAME_EXAMPLE_DIR);
    try {
      for (const target of ['pose', 'walk']) {
        const [shot] = await captureViews({ browser, baseUrl: served.url, entry: 'capture.html', views: [{ id: 'frame', width: 960, height: 540 }], target, outDir: out, prefix: 't', ready: READY });
        assert.equal(shot.id, `t-frame-${target}`);
        assert.ok(shot.bytes > 5000, `${target} drew something`);
      }
    } finally { await served.close(); }
    for (const [name, content] of await gameExampleFiles()) {
      await mkdir(path.dirname(path.join(copy, name)), { recursive: true });
      await writeFile(path.join(copy, name), name === 'characters/ilo.json' ? content.replace('"name": "Ilo"', '"name": "Ila"') : content);
    }
    const broken = await serveDirectory(copy);
    try {
      await assert.rejects(captureViews({ browser, baseUrl: broken.url, entry: 'capture.html', views: [{ id: 'frame', width: 960, height: 540 }], target: 'pose', outDir: out, prefix: 'b', ready: READY }),
        /The page could not draw the capture: characters\/ilo\.json is not a valid character\. character\.name: The name is a fixed fact/u);
    } finally { await broken.close(); }
  } finally {
    await rm(out, { recursive: true, force: true });
    await rm(copy, { recursive: true, force: true });
  }
});
