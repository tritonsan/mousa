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
import { readFileSync } from 'node:fs';
import { dataFingerprint, compareDataFingerprints, differingFiles } from '../plugin/server/design/distance.mjs';
import { normalizeDesignSketch, normalizeDesignDna } from '../plugin/server/culture/taste.mjs';
import { mediumProfile } from '../plugin/server/production/media.mjs';
import { inspectBrowser, verifyBrowser, serveDirectory, captureViews } from '../plugin/server/production/capture.mjs';
import { createMousaServer } from '../plugin/server/mcp/mousa.mjs';
import { createDesignTools } from '../plugin/server/design/tools.mjs';
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

test('a character may name a portrait for the title card, a picture in the game folder', () => {
  const canon = JSON.parse(readFileSync(path.join(GAME_EXAMPLE_DIR, 'world', 'canon.json'), 'utf8'));
  const ilo = JSON.parse(readFileSync(path.join(GAME_EXAMPLE_DIR, 'characters', 'ilo.json'), 'utf8'));
  assert.equal(normalizeCharacter(ilo, { canon }).portrait, undefined, 'no portrait, no field');
  const portrait = { src: 'generated/dna5-1.png', alt: 'Ilo in a moss cardigan, lantern raised, at dusk.' };
  assert.deepEqual(normalizeCharacter({ ...ilo, portrait }, { canon }).portrait, portrait);
  assert.throws(() => normalizeCharacter({ ...ilo, portrait: { ...portrait, src: 'https://example.com/a.png' } }, { canon }), /portrait\.src: Use a PNG or JPEG in the game folder/u);
  assert.throws(() => normalizeCharacter({ ...ilo, portrait: { src: portrait.src } }, { canon }), /portrait/u);
});

test('design_compare copies the starter into both arms, fonts included, and measures game arms by the files they changed', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-compare-game-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-compare-game-config-'));
  const server = createMousaServer({ env: { MOUSA_PROJECT_DIR: project }, store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }), fonts: async () => FONTS } });
  const call = async (name, args) => parse(await server.callTool(name, args));
  const font = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0x10]);
  try {
    await mkdir(path.join(project, 'fonts'), { recursive: true });
    await mkdir(path.join(project, 'characters'), { recursive: true });
    await mkdir(path.join(project, 'node_modules', 'x'), { recursive: true });
    await writeFile(path.join(project, 'index.html'), '<canvas id="view"></canvas>');
    await writeFile(path.join(project, 'fonts', 'face.woff2'), font);
    await writeFile(path.join(project, 'characters', 'maren.json'), '{"palette":{"coat":"#5b6b55"},"parts":[{"id":"coat"}]}');
    await writeFile(path.join(project, 'node_modules', 'x', 'index.js'), 'skip');
    const arms = { a: 'compare/with-qloo', b: 'compare/without-qloo' };
    // Planning both arms first leaves only their records in the folders, which prepare allows.
    await mkdir(path.join(project, 'compare', 'with-qloo', '.mousa'), { recursive: true });
    const prepared = await call('design_compare', { ...arms, prepare: true });
    assert.deepEqual([prepared.status, prepared.copied], ['prepared', 3], JSON.stringify(prepared));
    for (const arm of Object.values(arms)) {
      assert.ok((await readFile(path.join(project, ...arm.split('/'), 'fonts', 'face.woff2'))).equals(font), `${arm} has the font, byte for byte`);
      await assert.rejects(readFile(path.join(project, ...arm.split('/'), 'node_modules', 'x', 'index.js')));
    }
    assert.equal((await call('design_compare', { ...arms, prepare: true })).error.code, 'COMPARE_NOT_EMPTY', 'never over an arm\'s work');

    // Each arm designs its own Ilo; the shared keeper and page cannot tell them apart.
    const write = async (arm, character) => {
      await writeFile(path.join(project, ...arm.split('/'), 'characters', 'ilo.json'), JSON.stringify(character, null, 2));
      await mkdir(path.join(project, ...arm.split('/'), '.mousa', 'design'), { recursive: true });
      await writeFile(path.join(project, ...arm.split('/'), '.mousa', 'design', 'dna.json'), JSON.stringify({ medium: 'game', dna: { devices: [] } }));
    };
    await write(arms.a, { palette: { knit: '#3f5a4c', glass: '#ffc29e' }, parts: [{ id: 'knit-cap' }, { id: 'lamp-pole' }], lines: { greet: 'I nearly did too. The bridge sways under me.' } });
    await write(arms.b, { palette: { cloak: '#1c1f3a', glass: '#ffd27a' }, parts: [{ id: 'hood' }, { id: 'lamp-pole' }], lines: { greet: 'Rest now, keeper. I will carry the light.' } });
    const compared = await call('design_compare', arms);
    assert.equal(compared.status, 'compared', JSON.stringify(compared));
    assert.match(compared.distance.method, /files that differ/u);
    assert.ok(compared.distance.palette > 0.1 && compared.distance.structure > 0.5 && compared.distance.voice > 0.5, JSON.stringify(compared.distance));
    // Two identical designs are no distance apart.
    const same = dataFingerprint({ 'a.json': '{"palette":{"x":"#112233"},"parts":[{"id":"hood"}]}' });
    assert.equal(compareDataFingerprints(same, same).overall, 0);
    assert.deepEqual(differingFiles({ 'x.json': '1', 'y.json': '2' }, { 'x.json': '1', 'y.json': '3' }), [{ 'y.json': '2' }, { 'y.json': '3' }]);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('in a comparison arm, the picture brief names the file in the arm\'s folder and how to register it', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-game-picture-'));
  try {
    const arm = path.join(project, 'compare', 'with-qloo');
    await mkdir(path.join(arm, '.mousa', 'design'), { recursive: true });
    const dna = { devices: [{ id: 'dna3', layer: 'imagery', device: 'Title-card portrait', anchors: [], translation: 'x', tokens: { colors: ['#3f5a4c', '#ffc29e'], fonts: [], css: [], ids: [], copy: [], images: ['generated/dna3-1.png'], keyframes: [], svg: [] } }] };
    await writeFile(path.join(arm, '.mousa', 'design', 'dna.json'), JSON.stringify({ medium: 'game', dna }));
    await writeFile(path.join(arm, '.mousa', 'design', 'plan.json'), JSON.stringify({ medium: 'game', plan: { steps: [{ device: 'dna3', method: 'generated-image', count: 1, fallback: 'source' }], uses: { generators: { image: { devices: { dna3: 1 } } } } } }));
    const tools = createDesignTools({ host: 'codex', project: async (meta, workspace) => (workspace ? path.join(project, ...workspace.split('/')) : project) });
    const asked = await tools.handle('image', { action: 'prompt', device: 'dna3', subject: 'A lamplighter in a moss cardigan, lantern raised at dusk', aspect: 'square', workspace: 'compare/with-qloo' });
    assert.deepEqual([asked.saveAs, asked.file], ['generated/dna3-1.png', 'compare/with-qloo/generated/dna3-1.png']);
    assert.match(asked.how, /\$CODEX_HOME\/generated_images\/\) to compare\/with-qloo\/generated\/dna3-1\.png, then call image with action register, path generated\/dna3-1\.png and workspace compare\/with-qloo\./u);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('the title card shows the portrait a character names, and a capture waits for it', async t => {
  const browser = await verifyBrowser(await inspectBrowser({}));
  if (!browser.available) { t.skip(browser.reason); return; }
  const READY = 'Promise.resolve(window.captureReady).then(value => value === undefined ? true : value, error => String(error && error.message || error))';
  const copy = await mkdtemp(path.join(os.tmpdir(), 'mousa-game-portrait-'));
  const out = await mkdtemp(path.join(os.tmpdir(), 'mousa-game-portrait-shots-'));
  try {
    for (const [name, content] of await gameExampleFiles()) {
      await mkdir(path.dirname(path.join(copy, name)), { recursive: true });
      await writeFile(path.join(copy, name), content);
    }
    const file = path.join(copy, 'characters', 'ilo.json');
    const ilo = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...ilo, portrait: { src: 'generated/portrait-1.png', alt: 'A grey placeholder of Ilo with a lantern.' } }));
    const served = await serveDirectory(copy);
    try {
      await assert.rejects(captureViews({ browser, baseUrl: served.url, entry: 'index.html', views: [{ id: 'frame', width: 960, height: 540 }], outDir: out, prefix: 'm', ready: READY }),
        /The portrait generated\/portrait-1\.png could not be loaded/u, 'a portrait the folder lacks fails the capture');
      await mkdir(path.join(copy, 'generated'), { recursive: true });
      await writeFile(path.join(copy, 'generated', 'portrait-1.png'), png(64, 64, ['#3f5a4c', '#ffc29e']));
      const [shot] = await captureViews({ browser, baseUrl: served.url, entry: 'index.html', views: [{ id: 'frame', width: 960, height: 540 }], outDir: out, prefix: 'p', ready: READY });
      assert.ok(shot.bytes > 5000);
    } finally { await served.close(); }
  } finally {
    await rm(copy, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});
