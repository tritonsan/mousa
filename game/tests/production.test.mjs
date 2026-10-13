// The game host's production stages: the capability list both arms read, the reading before the DNA, the plan that
// gates every picture, the review of captures with its audit, the Kiro read tool scoped to the captures, the capture
// page in a real browser when one is installed, and dry runs that record it all. No model, Qloo or Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCharacter } from '../src/format.js';
import { measureCharacter } from '../harness/measure.mjs';
import { makeCharacterPrompt } from '../harness/prompt.mjs';
import { normalizeCharacterAssumption, deltaE, CHARACTER_LAYERS } from '../harness/protocol.mjs';
import { createArmSession } from '../harness/session.mjs';
import { prepareWorkspace, AGENT_NAME } from '../harness/kiro.mjs';
import { GAME_DOMAINS, fixtureProfile, fixtureAssumption, fixtureDna, fixtureReading, fixturePlan, fixtureReview, fixturePainter } from '../harness/fixtures.mjs';
import { gameCapabilities, readingLayers, methodSummary, captureCharacter, fixtureCapture, serveArmCapture, GAME_VIEWS } from '../harness/production.mjs';
import { prepareArm, loadWorld, runPair, reviewAudit, ARMS } from '../harness/run-pair.mjs';
import { inspectBrowser } from '../../plugin/server/production/capture.mjs';
import { HOSTED_IMAGE_REASON } from '../../plugin/server/production/capabilities.mjs';
import { PRODUCTION_POLICY_TEXT } from '../../plugin/server/production/policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fss.readFileSync(path.join(root, file), 'utf8'));
const canon = read('world/canon.json');
const emberRaw = read('samples/sample-b.json');
const ember = normalizeCharacter(emberRaw, { canon, strict: true });
const emberMeasures = measureCharacter(ember);
const sketch = normalizeCharacterAssumption(fixtureAssumption(), { domains: GAME_DOMAINS }).characterSketch;
const profile = await fixtureProfile();
const brief = { name: 'Test', brief: 'A test brief long enough to pass the brief loader in this suite.', references: [{ name: 'Fixture reference one', role: 'audience' }], knownNames: [] };
const text = result => result.content[0].text;
const SUBJECT = 'A small lamplighter in a mustard jacket holding a mint lantern at dusk';

/** An arm directory with production stages: its capability list in files/ and its capture mode in the host config. */
async function productionArm(t, mode, { portraits = null, paint = null, capture = 'fixture', required = [] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-production-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const capabilities = gameCapabilities({ portraits, paint, capture: Boolean(capture), required });
  await prepareArm({ dir, arm: ARMS.find(arm => arm.mode === mode), brief, world: await loadWorld(), domains: GAME_DOMAINS, profile, portraits, paint, production: { capabilities, capture } });
  return { dir, capabilities };
}

const fixtureImages = () => ({ available: true, provider: 'fixture', version: '0', async generate({ directory, name }) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${name}.png`), 'not really an image');
  return { path: `generated/${name}.png`, format: 'png', width: 2, height: 3, bytes: 19, durationMs: 1, description: 'A fixture portrait.' };
} });

/** One ToolResults record of a Kiro session log in which the built-in read tool opened `files`. */
const readRecord = (files, ok = true) => JSON.stringify({ kind: 'ToolResults', data: { results: Object.fromEntries(files.map((file, index) => [`tooluse_${index}`,
  { tool: { kind: { BuiltIn: { fs_read: { operations: [{ mode: 'Image', image_paths: [file] }] } } } }, result: ok ? { Success: { items: [] } } : { Error: 'The read was denied.' } }])) } });

test('the game capability list offers both arms the same methods and refuses a study this host cannot run', () => {
  const local = gameCapabilities({ portraits: { perRun: 2 }, paint: { perRun: 1 }, capture: true, music: { tracks: 12, licenses: ['CC BY 4.0'] } });
  assert.deepEqual(local.methods.filter(item => !item.available), []);
  assert.deepEqual(local.review.capture.views.map(view => view.id), ['pose', 'walk', 'scene', 'kindle']);
  assert.ok(local.notes.every(note => note.length <= 300));
  // A hosted server paints nothing, even when given a generator, and says why.
  const hosted = gameCapabilities({ environment: 'hosted', portraits: { perRun: 1 }, paint: { perRun: 1 } });
  assert.equal(hosted.environment, 'hosted');
  assert.deepEqual([hosted.generators.portrait, hosted.generators.paint], [{ available: false, reason: HOSTED_IMAGE_REASON }, { available: false, reason: HOSTED_IMAGE_REASON }]);
  assert.deepEqual(hosted.methods.filter(item => !item.available).map(item => item.id), ['painted-rig', 'portrait', 'library-track']);
  // Every layer but the track has a method that needs no generator, so a plan can always fall back.
  for (const layer of CHARACTER_LAYERS.filter(item => item !== 'music')) assert.ok(hosted.methods.some(item => item.available && item.layers.includes(layer)), layer);
  const summary = methodSummary(hosted, ['palette', 'imagery', 'music']);
  assert.deepEqual(summary.available, ['palette: vector-rig', 'imagery: vector-rig', 'music: none']);
  assert.match(summary.unavailable.join('; '), /painted-rig \(A hosted server has no image generator: Codex runs only on a machine where it is installed and signed in\)/u);
  assert.throws(() => gameCapabilities({ required: ['painted-rig'] }), /cannot require painted-rig here: This run does not paint the characters/u);
  assert.deepEqual(gameCapabilities({ paint: { perRun: 1 }, required: ['painted-rig'] }).required, ['painted-rig']);
});

test('the production stages order the reading, the DNA and the plan, and the plan gates every picture', async t => {
  const { dir, capabilities } = await productionArm(t, 'qloo', { portraits: { perRun: 1 }, paint: { perRun: 2, fixture: true } });
  const session = await createArmSession({ dir, images: fixtureImages(), painter: fixturePainter(), capture: fixtureCapture });
  const call = (name, args = {}) => session.handle(name, args);
  const write = (file, value) => call('game_write_file', { path: file, content: typeof value === 'string' ? value : JSON.stringify(value) });
  assert.deepEqual(session.definitions.map(tool => tool.name).sort(), ['game_capture_review', 'game_check_character', 'game_generate_portrait', 'game_get_taste', 'game_list_files', 'game_paint_character', 'game_read_file', 'game_write_file']);
  assert.equal(JSON.parse(text(await call('game_read_file', { path: 'capabilities.json' }))).medium, 'game-character');
  assert.ok(!(await write('game-assumption.json', fixtureAssumption())).isError);
  const taste = (await call('game_get_taste')).structuredContent;
  assert.match(taste.next, /save game-reading\.json before the DNA/u);
  const dna = JSON.parse(fixtureDna({ input: taste, character: ember, measures: emberMeasures, measured: true, sketch, deltaE }));
  const anchor = taste.entities.find(entity => entity.ref === taste.requiredAnchors[0].ref);
  dna.devices.push({ id: 'dna8', layer: 'imagery', device: 'A painted portrait in the jacket colours', anchors: [anchor.ref], qualities: anchor.tags.slice(0, 1), translation: 'Fixture translation for the portrait device.', tokens: { colors: ['#e2b43c', '#3f8e89'] } });
  assert.match(text(await write('game-dna.json', dna)), /Save game-reading\.json first/u, 'the reading comes before the DNA');

  // The reading accounts for every required anchor and sets the noise aside with a reason.
  const reading = JSON.parse(fixtureReading({ input: taste, dna, layers: readingLayers({ artDirection: true }) }));
  const partial = structuredClone(reading);
  for (const cluster of partial.clusters) cluster.refs = cluster.refs.filter(ref => ref !== anchor.ref);
  assert.match(text(await write('game-reading.json', partial)), /Every required anchor belongs to a cluster or is set aside/u);
  assert.ok(!(await write('game-reading.json', reading)).isError);
  assert.equal(reading.setAside.length, 1, 'the brand that carries only catalogue metadata is set aside');
  const noisy = structuredClone(dna);
  noisy.devices[0].anchors.push(reading.setAside[0].ref);
  assert.match(text(await write('game-dna.json', noisy)), /Your taste reading set .+ aside/u, 'no device anchors a set-aside ref');
  assert.ok(!(await write('game-dna.json', dna)).isError);
  assert.match(text(await write('game-reading.json', reading)), /frozen/u, 'the reading is frozen once the DNA is compiled from it');

  // The plan comes before any picture or drawing, chooses its methods from the list and paints once at most.
  assert.match(text(await write('character.json', emberRaw)), /Save game-production\.json before writing character\.json/u);
  assert.match(text(await call('game_generate_portrait', { device: 'dna8', subject: SUBJECT })), /Save game-production\.json first/u);
  const plan = JSON.parse(fixturePlan({ dna, reading, capabilities }));
  assert.equal(plan.steps.find(step => step.method === 'painted-rig').device, 'dna3');
  Object.assign(plan.steps.find(step => step.device === 'dna8'), { method: 'portrait', count: 1, fallback: 'vector-rig' });
  const misplaced = structuredClone(plan);
  Object.assign(misplaced.steps[0], { method: 'portrait', count: 1, fallback: 'vector-rig' });
  assert.match(text(await write('game-production.json', misplaced)), /portrait makes imagery, not palette/u);
  const twice = structuredClone(plan);
  Object.assign(twice.steps[0], { method: 'painted-rig', count: 1, fallback: 'vector-rig' });
  assert.match(text(await write('game-production.json', twice)), /One painting paints the whole figure/u);
  assert.ok(!(await write('game-production.json', plan)).isError);
  // A new DNA sets the plan made for the old one aside.
  assert.ok(!(await write('game-dna.json', dna)).isError);
  assert.ok(!fss.existsSync(path.join(dir, 'files', 'game-production.json')));
  assert.match(text(await write('character.json', emberRaw)), /Save game-production\.json before/u);
  assert.ok(!(await write('game-production.json', plan)).isError);

  // Pictures only as planned: a portrait for the planned device, before the drawing, within its count.
  assert.match(text(await call('game_generate_portrait', { device: 'dna1', subject: SUBJECT })), /gives dna1 no portrait generation; it plans portrait pictures for dna8/u);
  assert.match(text(await write('character.json', emberRaw)), /paints a portrait for dna8/u);
  assert.equal((await call('game_generate_portrait', { device: 'dna8', subject: SUBJECT })).structuredContent.status, 'generated');
  assert.match(text(await call('game_generate_portrait', { device: 'dna8', subject: SUBJECT })), /gives dna8 1 portrait picture, and 1 was requested/u);
  assert.match(text(await write('game-production.json', plan)), /frozen/u, 'the first picture freezes the plan');
  assert.ok(!(await write('character.json', emberRaw)).isError);
  assert.match(text(await call('game_capture_review')), /Check the saved character\.json/u, 'captures show a checked drawing');
  const check = text(await call('game_check_character'));
  assert.match(check, /DNA conformance: score 1 /u);
  assert.match(check, /PAINTABLE PIECES/u);
  assert.match(check, /REVIEW: once your repairs are done/u);
  assert.equal((await call('game_paint_character', { style: 'Fixture painting: the flat blueprint colours, handed back unpainted by the fixture painter.' })).structuredContent.status, 'painted');
  assert.match(text(await call('game_paint_character', { style: 'Fixture painting: the flat blueprint colours, handed back unpainted by the fixture painter.' })), /gives dna3 1 paint picture, and 1 was requested/u, 'the step\'s count, not the host\'s limit, caps the paintings');

  // The review: captures of this round, opened with the read tool as the session log records it.
  assert.match(text(await write('game-review.json', '{}')), /Capture the character with game_capture_review before saving the review of round 1/u);
  const first = (await call('game_capture_review')).structuredContent;
  assert.deepEqual(first.captures.map(item => item.id), ['r1-pose', 'r1-walk', 'r1-scene', 'r1-kindle']);
  assert.ok(fss.existsSync(path.join(dir, 'workspace', 'review', 'r1-pose.png')));
  assert.match(text(await call('game_capture_review', { views: ['pose'] })), /Round 1 already has/u);
  const log = path.join(dir, 'kiro-home', 'sessions', 'cli', '0b0b0b0b-0000-4000-8000-000000000001.jsonl');
  await fs.mkdir(path.dirname(log), { recursive: true });
  await fs.writeFile(log, `${readRecord(['review/r1-pose.png'])}\n${readRecord(['review/r1-walk.png'], false)}\n`);
  const review = JSON.parse(fixtureReview({ plan, captures: first.captures, round: 1 }));
  assert.match(text(await write('game-review.json', review)), /r1-walk was not opened in this session/u, 'a failed read is not an opened capture');
  await fs.appendFile(log, `${readRecord(['review\\r1-walk.png', 'D:/elsewhere/review/r1-scene.png'])}\n`);
  review.criteria[1].verdict = 'missed';
  assert.match(text(await write('game-review.json', review)), /A missed criterion names the repair it needs/u);
  review.criteria[1].repair = 'Slow the cadence so the six frames show the stately gait.';
  const saved = (await write('game-review.json', review)).structuredContent;
  assert.deepEqual([saved.round, saved.met, saved.missed], [1, 2, 1]);
  assert.match(saved.next, /capture round 2/u);

  const second = (await call('game_capture_review', { views: ['walk'] })).structuredContent;
  assert.deepEqual(second.captures.map(item => item.id), ['r2-walk']);
  assert.match(text(await write('game-review.json', fixtureReview({ plan, captures: first.captures, round: 2 }))), /r1-pose was taken in round 1, before your repairs/u);
  await fs.appendFile(log, `${readRecord(['review/r2-walk.png'])}\n`);
  assert.ok(!(await write('game-review.json', fixtureReview({ plan, captures: second.captures, round: 2 }))).isError);
  assert.match(text(await call('game_capture_review')), /all of them were reviewed/u);
  assert.match(text(await write('game-review.json', review)), /The review is complete/u);

  const state = JSON.parse(await fs.readFile(path.join(dir, 'host', 'session.json'), 'utf8'));
  assert.deepEqual(state.plan.uses.generators, { portrait: { total: 1, devices: { dna8: 1 } }, paint: { total: 1, devices: { dna3: 1 } } });
  assert.deepEqual(state.reviews.map(item => [item.round, item.audited, item.opened]), [[1, true, ['r1-pose', 'r1-walk', 'r1-scene']], [2, true, ['r2-walk']]]);
  assert.deepEqual(state.reviews[0].repairs, { character: false, painting: false }, 'nothing changed between the rounds');
  assert.deepEqual(await reviewAudit({ dir, state }), { rounds: 2, captures: 5, cited: ['r1-pose', 'r1-walk', 'r1-scene', 'r2-walk'], audited: true,
    opened: ['r1-pose', 'r1-walk', 'r1-scene', 'r2-walk'], unopened: [], afterLastReview: { character: false, painting: false } });
});

test('an arm that reviews captures gives Kiro a read tool pointed at its review folder, with the arm\'s host files denied', async t => {
  const { dir } = await productionArm(t, 'baseline');
  const { workspace } = await prepareWorkspace({ dir, model: 'test-model' });
  const agent = JSON.parse(await fs.readFile(path.join(workspace, '.kiro', 'agents', `${AGENT_NAME}.json`), 'utf8'));
  assert.deepEqual([agent.tools, agent.allowedTools], [['@game', 'read'], ['@game']]);
  assert.deepEqual(agent.toolsSettings.read.allowedPaths, ['./review/**']);
  const denied = agent.toolsSettings.read.deniedPaths;
  for (const folder of ['host', 'kiro-home', 'files', 'skin', 'generated']) assert.ok(denied.includes(`${dir.replaceAll('\\', '/')}/${folder}/**`), folder);
  assert.ok(denied.some(item => item.endsWith('/.env')) && denied.some(item => item.endsWith('/.codex/**')));
  assert.match(agent.prompt, /the read tool only to open the review captures in review\//u);
  assert.ok(agent.prompt.includes(PRODUCTION_POLICY_TEXT));
  assert.ok(fss.existsSync(path.join(workspace, 'review')));
  // Without capture the arm keeps only its design tools, and its read tool is not offered.
  const { dir: blind } = await productionArm(t, 'baseline', { capture: null });
  const plain = JSON.parse(await fs.readFile(path.join((await prepareWorkspace({ dir: blind, model: 'test-model' })).workspace, '.kiro', 'agents', `${AGENT_NAME}.json`), 'utf8'));
  assert.deepEqual(plain.tools, ['@game']);
  assert.equal(plain.toolsSettings, undefined);
});

test('the capture server serves only the capture page, its code, the world and the arm\'s character', async t => {
  const { dir } = await productionArm(t, 'qloo');
  await fs.writeFile(path.join(dir, 'files', 'character.json'), JSON.stringify(emberRaw));
  const server = await serveArmCapture({ dir });
  t.after(() => server.close());
  const status = async name => (await fetch(`${server.url}${name}`)).status;
  for (const name of ['/game/capture.html', '/game/styles.css', '/game/src/capture.js', '/game/world/canon.json', '/game/characters/maren.json']) assert.equal(await status(name), 200, name);
  assert.equal((await (await fetch(`${server.url}/game/runs/capture/character.json`)).json()).name, emberRaw.name);
  for (const name of ['/game/harness/session.mjs', '/game/src%2F..%2F..%2F.env', '/game/runs/dry-run/pair.json', '/.env', '/game/index.html', '/game/fonts/x.ttf']) assert.equal(await status(name), 404, name);
});

test('the capture page draws each view of a saved character in an installed browser', async t => {
  const browser = await inspectBrowser();
  if (!browser.available) { t.skip(browser.reason); return; }
  const { dir } = await productionArm(t, 'qloo');
  await fs.writeFile(path.join(dir, 'files', 'character.json'), JSON.stringify(emberRaw));
  const shots = await captureCharacter({ dir, browser, views: GAME_VIEWS, round: 1, outDir: path.join(dir, 'workspace', 'review') });
  assert.deepEqual(shots.map(shot => `${shot.id}:${shot.width}x${shot.height}`), ['r1-pose:960x960', 'r1-walk:1440x480', 'r1-scene:1440x810', 'r1-kindle:1440x810']);
  // A drawn view compresses far less than the flat frame of a page that failed to draw.
  assert.ok(shots.every(shot => shot.bytes > 30000), JSON.stringify(shots.map(shot => shot.bytes)));
});

test('the production prompt adds the reading, the plan and the review, and the arms still differ only in their taste source', () => {
  const capabilities = gameCapabilities({ paint: { perRun: 1 }, capture: true, music: { tracks: 12, licenses: ['CC BY 4.0'] } });
  const production = { capabilities, layers: readingLayers({ artDirection: true, music: true }) };
  const [off, on] = ['baseline', 'qloo'].map(mode => makeCharacterPrompt({ brief, canon, mode, domains: GAME_DOMAINS, artDirection: true, music: 12, paint: { perRun: 1 }, production }));
  const strip = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');
  assert.equal(strip(off), strip(on));
  for (const phrase of [/Save game-reading\.json before the DNA/u, /Together the clusters carry palette, silhouette, motion, voice, scene, render and music/u,
    /Save game-production\.json before any portrait, painting or character file/u, /Methods available here, by layer: palette: vector-rig, painted-rig/u,
    /Not available here: portrait \(This run paints no portraits\)/u, /call game_capture_review/u, /Open each capture you cite with your read tool/u, /Paint, if your plan chose painted-rig/u]) assert.match(on, phrase);
  assert.doesNotMatch(on, /Paint the character: this run paints your drawing/u, 'painting is a method a plan chooses, not a step every run takes');
  // The painting comes between the review rounds, so the first review can still repair the drawing.
  const at = phrase => on.indexOf(phrase);
  assert.ok(at('Review what you made: after the check, call game_capture_review') < at('Paint, if your plan chose painted-rig') && at('Paint, if your plan chose painted-rig') < at('Capture round 2, of the painted figure'), on);
  assert.match(on, /After round 1's repairs to the drawing and their check, call game_paint_character/u);
  // A painting freezes the figure only, so round 2 can still repair the moment around it.
  assert.match(on, /Painting freezes the figure in character\.json, its skeleton, parts, cloth, style and render; its scene, light, effects, motion, clips, lines and music can still be repaired/u);
  assert.match(capabilities.notes[0], /Paint between the review rounds/u);
  assert.match(capabilities.notes[1], /while its scene, light, effects, motion, clips, lines and music can still be repaired/u);
});

test('a plan that paints twice reviews the drawing first and repaints only after the review of the painted figure', async t => {
  const { dir, capabilities } = await productionArm(t, 'qloo', { paint: { perRun: 2, fixture: true } });
  const session = await createArmSession({ dir, painter: fixturePainter(), capture: fixtureCapture });
  const call = (name, args = {}) => session.handle(name, args);
  const write = (file, value) => call('game_write_file', { path: file, content: typeof value === 'string' ? value : JSON.stringify(value) });
  assert.ok(!(await write('game-assumption.json', fixtureAssumption())).isError);
  const taste = (await call('game_get_taste')).structuredContent;
  const dna = JSON.parse(fixtureDna({ input: taste, character: ember, measures: emberMeasures, measured: true, sketch, deltaE }));
  const reading = JSON.parse(fixtureReading({ input: taste, dna, layers: readingLayers({ artDirection: true }) }));
  assert.ok(!(await write('game-reading.json', reading)).isError);
  assert.ok(!(await write('game-dna.json', dna)).isError);
  const plan = JSON.parse(fixturePlan({ dna, reading, capabilities }));
  plan.steps.find(step => step.method === 'painted-rig').count = 2;
  assert.ok(!(await write('game-production.json', plan)).isError);
  assert.ok(!(await write('character.json', emberRaw)).isError);
  assert.match(text(await call('game_check_character')), /REVIEW: once your repairs are done, before you paint the drawing, capture round 1 of 2/u);
  const style = 'Fixture painting: the flat blueprint colours, handed back unpainted by the fixture painter.';
  const log = path.join(dir, 'kiro-home', 'sessions', 'cli', '0b0b0b0b-0000-4000-8000-000000000002.jsonl');
  await fs.mkdir(path.dirname(log), { recursive: true });
  // Round 1 judges the vector drawing, and its answer names the painting before round 2.
  const first = (await call('game_capture_review')).structuredContent;
  await fs.writeFile(log, `${readRecord(first.captures.map(item => item.path))}\n`);
  const reviewed = (await write('game-review.json', fixtureReview({ plan, captures: first.captures, round: 1 }))).structuredContent;
  assert.match(reviewed.next, /Paint the drawing as your plan says, then capture round 2 with game_capture_review and review the painted figure/u);
  assert.equal((await call('game_paint_character', { style })).structuredContent.status, 'painted');
  // The second painting waits for the review of the painted figure.
  assert.match(text(await call('game_paint_character', { style })), /A second painting repairs what the review of the painted figure found/u);
  const second = (await call('game_capture_review')).structuredContent;
  assert.deepEqual(second.captures.map(item => item.id), ['r2-pose', 'r2-walk', 'r2-scene', 'r2-kindle']);
  await fs.appendFile(log, `${readRecord(second.captures.map(item => item.path))}\n`);
  const review = JSON.parse(fixtureReview({ plan, captures: second.captures, round: 2 }));
  Object.assign(review.criteria[0], { verdict: 'partly', repair: 'Repaint the boots below the leg wraps, where the drawing places them.' });
  assert.match((await write('game-review.json', review)).structuredContent.next,
    /the scene, light, effects, motion, clips, lines and music in character\.json, checked with game_check_character, and a defect of the painting with a second painting/u);
  // The moment around the painted figure is repaired in character.json, and the figure by a second painting of it.
  const brighter = { ...emberRaw, scene: { ...emberRaw.scene, sky: ['#1b2f48', '#f09468'] } };
  assert.ok(!(await write('character.json', brighter)).isError, 'the sky changes after the painting');
  assert.match(text(await write('character.json', { ...brighter, parts: emberRaw.parts.map(part => (part.id === 'thigh' ? { ...part, r1: 7 } : part)) })), /frozen where the painting was cut from it/u);
  assert.match(text(await call('game_paint_character', { style })), /Check the saved character\.json/u, 'the second painting follows a check of the repaired file');
  assert.match(text(await call('game_check_character')), /PAINTED: \d+ pieces/u);
  assert.equal((await call('game_paint_character', { style })).structuredContent.status, 'painted');
  const state = JSON.parse(await fs.readFile(path.join(dir, 'host', 'session.json'), 'utf8'));
  assert.deepEqual(state.paint.map(item => item.status), ['painted', 'painted']);
  assert.equal(state.paint[0].drawing, state.paint[1].drawing, 'both paintings were cut from one figure');
  assert.deepEqual(state.captures.map(item => item.paintings), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual((await reviewAudit({ dir, state })).afterLastReview, { character: true, painting: true });
});

test('a dry run records each arm\'s reading, plan and reviewed captures, and how the two plans make the character', async t => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-runs-'));
  t.after(() => fs.rm(runsRoot, { recursive: true, force: true }));
  const record = await runPair({ brief, mode: 'dry-run', pairId: 'production-pair', runsRoot, paintPerArm: 1, capture: 'fixture' });
  assert.equal(record.status, 'completed', record.error);
  assert.deepEqual([record.protocol.production.capture, record.protocol.production.rounds], ['fixture', 2]);
  assert.deepEqual(record.protocol.production.methods.filter(item => !item.available).map(item => item.id), ['portrait']);
  for (const arm of record.arms) {
    const made = arm.production;
    assert.equal(made.reading.clusters.length, 2);
    assert.ok(made.reading.clusters.every(cluster => cluster.refs.every(ref => ref.name)), 'cluster refs carry their names');
    assert.equal(made.plan.steps.find(step => step.method === 'painted-rig').device, 'dna3');
    assert.equal(arm.paint.status, 'painted');
    assert.deepEqual(made.captures.map(capture => capture.id), ['r1-pose', 'r1-walk', 'r1-scene', 'r1-kindle']);
    assert.ok(made.captures.every(capture => capture.painted && fss.existsSync(path.join(runsRoot, 'production-pair', path.basename(capture.path)))));
    assert.deepEqual([made.reviews.length, made.reviews[0].stats.met, made.audit.audited], [1, 3, false]);
  }
  assert.equal(record.arms[1].production.reading.setAside[0].name, 'Fixture Soot and Brass');
  assert.match(record.comparison.production.headline, /Both plans make every layer by the same methods/u);

  // Without a browser the plans list no criteria and nothing is reviewed; without the stages the record has none.
  const blind = await runPair({ brief, mode: 'dry-run', pairId: 'no-capture', runsRoot, capture: 'off' });
  assert.equal(blind.status, 'completed', blind.error);
  assert.equal(blind.protocol.production.capture, null);
  assert.match(blind.protocol.production.captureReason, /turned off/u);
  assert.ok(blind.arms.every(arm => !arm.production.plan.review.length && !arm.production.reviews.length));
  const legacy = await runPair({ brief, mode: 'dry-run', pairId: 'legacy', runsRoot, production: false });
  assert.equal(legacy.status, 'completed', legacy.error);
  assert.equal(legacy.protocol.production, undefined);
  assert.ok(legacy.arms.every(arm => arm.production === undefined && arm.conformance.score === 1));
  // A study setting this host cannot honour stops the pair before the taste pass.
  await assert.rejects(runPair({ brief, mode: 'dry-run', pairId: 'required', runsRoot, required: ['portrait'] }), /cannot require portrait here/u);
  assert.ok(!fss.existsSync(path.join(runsRoot, 'required')));
  await assert.rejects(runPair({ brief, mode: 'live', pairId: 'live-fixture', runsRoot, capture: 'fixture', config: {} }), /fixture captures are for dry runs/u);
});
