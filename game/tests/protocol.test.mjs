// The character taste protocol: sketch, DNA and its departure rule, conformance, measures, previews, the design
// session's order and the pair runner's dry run. No model, Qloo or Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { tasteInputFromProfile, tasteInputFromAssumption, compactTasteInput, TasteProtocolError } from '../../plugin/server/culture/taste.mjs';
import { normalizeCharacter, MOTION_RANGES } from '../src/format.js';
import { measureCharacter } from '../harness/measure.mjs';
import { asciiPose } from '../harness/raster.mjs';
import { formatGuide } from '../harness/guide.mjs';
import { makeCharacterPrompt } from '../harness/prompt.mjs';
import { normalizeCharacterAssumption, normalizeCharacterDna, checkCharacterConformance, characterFingerprint, compareCharacterFingerprints, characterSketchDivergence, deltaE } from '../harness/protocol.mjs';
import { createArmSession } from '../harness/session.mjs';
import { connect } from '../harness/mcp-client.mjs';
import { runKiro } from '../harness/kiro.mjs';
import { GAME_DOMAINS, GAME_MEDIUM, fixtureProfile, fixtureAssumption, fixtureDna } from '../harness/fixtures.mjs';
import { prepareArm, loadWorld, runPair, watchSession, ARMS } from '../harness/run-pair.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fss.readFileSync(path.join(root, file), 'utf8'));
const canon = read('world/canon.json');
const [ashRaw, emberRaw] = ['samples/sample-a.json', 'samples/sample-b.json'].map(read);
const [ash, ember] = [ashRaw, emberRaw].map(raw => normalizeCharacter(raw, { canon, strict: true }));
const [ashMeasures, emberMeasures] = [ash, ember].map(character => measureCharacter(character));
const assumption = normalizeCharacterAssumption(fixtureAssumption(), { domains: GAME_DOMAINS });
const sketch = assumption.characterSketch;
const profile = await fixtureProfile();
const measuredInput = tasteInputFromProfile(profile, assumption, { medium: GAME_MEDIUM });
const ownInput = tasteInputFromAssumption(assumption, { medium: GAME_MEDIUM });
const byRef = (input, ref) => input.entities.find(entity => entity.ref === ref);
const dnaFor = (input, character, measures, measured) => JSON.parse(fixtureDna({ input: compactTasteInput(input), character, measures, measured, sketch, deltaE }));
const rejects = (fn, pattern) => assert.throws(fn, error => error instanceof TasteProtocolError && pattern.test(error.message), `expected ${pattern}`);

test('the format guide names every motion parameter and the mannequin is a valid, warning-free example', () => {
  const guide = formatGuide({ canon, keeperHeight: 156 });
  for (const section of ['walk', 'idle']) for (const key of Object.keys(MOTION_RANGES[section])) assert.ok(guide.includes(`${section}.${key}`), `${section}.${key} is documented`);
  for (const phrase of ['Figure height', 'role: "eye"', 'kindleAt', canon.script.keeperGreeting]) assert.ok(guide.includes(phrase), phrase);
  const mannequin = normalizeCharacter(read('harness/mannequin.json'), { canon, strict: true });
  assert.deepEqual(measureCharacter(mannequin).warnings, []);
});

test('the prompt differs between the arms only in its taste-source paragraph', () => {
  const brief = { brief: 'A brief long enough to describe the character for this audience and moment.', references: [{ name: 'Fixture reference one', role: 'audience' }] };
  const [off, on] = ['baseline', 'qloo'].map(mode => makeCharacterPrompt({ brief, canon, mode, domains: GAME_DOMAINS, portraits: { perRun: 1 } }));
  const strip = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');
  assert.notEqual(off, on);
  assert.equal(strip(off), strip(on));
  assert.match(on, /measured/u);
  assert.match(off, /your own prediction/u);
  // Both arms read the same qualities-first rule; only the measured arm is told what its quality refs are.
  for (const prompt of [off, on]) assert.match(prompt, /Qualities first: anchor the palette device and the silhouette device/u);
  assert.match(on, /Refs in the qualities domain are shared qualities/u);
  assert.match(off, /qualities you predicted for style, aesthetic, qualities and art_style/u);
  assert.match(off, /qualities:\['3-6 moods, themes or looks/u);
});

test('the taste pass keeps typed tags by family, derives shared qualities and leads the required anchors with them', () => {
  const qualities = profile.entities.filter(entity => entity.domain === 'qualities');
  const named = family => qualities.filter(entity => entity.family === family).map(entity => entity.name);
  // Art style tags become art styles, not look qualities: one work is enough, and Hand-Drawn's five works lead.
  assert.deepEqual(named('look'), ['Colorful']);
  assert.deepEqual(profile.entities.filter(entity => entity.domain === 'art_style').map(entity => `${entity.name}:${entity.count}`), ['Hand-Drawn:5', 'Pixel Art:1']);
  assert.deepEqual(named('mood').slice(0, 2), ['Playful', 'Gentle']);
  assert.equal(named('meaning')[0], 'Craftsmanship');
  // Catalogue metadata never becomes a quality or a work's tag; a brand with only metadata carries no facet.
  assert.ok(!profile.entities.some(entity => (entity.tags || []).some(tag => ['Tools', 'PC', 'Switch', 'Subscription'].includes(tag))));
  assert.equal(profile.entities.find(entity => entity.name === 'Fixture Soot and Brass').facets, undefined);
  const required = measuredInput.requiredAnchors.map(ref => byRef(measuredInput, ref));
  assert.deepEqual(required.slice(0, 3).map(entity => `${entity.family}:${entity.name}`), ['look:Colorful', 'mood:Playful', 'meaning:Craftsmanship']);
  assert.equal(required[3].domain, 'videogame', 'the game medium leads the central works');
  assert.ok(!required.some(entity => entity.name === 'Fixture Soot and Brass'));
  assert.ok(required.every(entity => entity.surprise));
  // A predicted quality meets a measured one by its stem, so it is not a surprise.
  assert.equal(measuredInput.entities.find(entity => entity.name === 'Curiosity').predictedByModel, true);
  assert.equal(measuredInput.metrics.measuredQualities, qualities.length);
  const view = compactTasteInput(measuredInput).requiredAnchors[0];
  assert.equal(view.family, 'look');
  assert.ok(view.count >= 2 && view.domains.length >= 2 && view.examples.length);
  // Without Qloo, the first predicted qualities are required beside predicted works, a game first.
  assert.deepEqual(ownInput.requiredAnchors.slice(0, 3).map(ref => byRef(ownInput, ref).domain), ['qualities', 'qualities', 'qualities']);
  assert.equal(byRef(ownInput, ownInput.requiredAnchors[3]).domain, 'videogame');
});

test('the frozen prediction needs a character sketch with planned elements and a gait', () => {
  const raw = JSON.parse(fixtureAssumption());
  const { characterSketch, ...withoutSketch } = raw;
  rejects(() => normalizeCharacterAssumption(withoutSketch, { domains: GAME_DOMAINS }), /assumption\.characterSketch/u);
  rejects(() => normalizeCharacterAssumption({ ...raw, characterSketch: { ...characterSketch, gait: { ...characterSketch.gait, turnStyle: 'spin' } } }, { domains: GAME_DOMAINS }), /turnStyle/u);
  rejects(() => normalizeCharacterAssumption({ ...raw, characterSketch: { ...characterSketch, elements: ['Hood'] } }, { domains: GAME_DOMAINS }), /elements/u);
  assert.equal(sketch.height, 183);
});

test('a DNA that follows its own prediction passes in Qloo off, and Qloo on must depart from the sketch', () => {
  assert.doesNotThrow(() => normalizeCharacterDna(dnaFor(ownInput, ash, ashMeasures, false), { input: ownInput, sketch }));
  const departed = normalizeCharacterDna(dnaFor(measuredInput, ember, emberMeasures, true), { input: measuredInput, sketch });
  assert.equal(departed.stats.surpriseAnchoredDevices, departed.devices.length);
  assert.ok(departed.stats.sketchMoves.proportions);
  // The ash pilgrim's own tokens anchored to measured surprises would be relabelling, which the rule refuses.
  const relabelled = dnaFor(measuredInput, ash, ashMeasures, true);
  rejects(() => normalizeCharacterDna(relabelled, { input: measuredInput, sketch }), /move the palette|change the figure|add something|change how the character moves/u);
  const base = dnaFor(measuredInput, ember, emberMeasures, true);
  const variant = edit => { const copy = structuredClone(base); edit(copy.devices); return copy; };
  rejects(() => normalizeCharacterDna(variant(devices => { devices[0].tokens.colors = sketch.palette.slice(0, 3); }), { input: measuredInput, sketch }), /move the palette/u);
  rejects(() => normalizeCharacterDna(variant(devices => { devices[1].tokens.proportions = { height: sketch.height, headShare: sketch.headShare }; }), { input: measuredInput, sketch }), /change the figure/u);
  rejects(() => normalizeCharacterDna(variant(devices => { devices[1].tokens.parts = ['hood']; devices[2].tokens.parts = ['scarf']; }), { input: measuredInput, sketch }), /add something the sketch did not plan/u);
  rejects(() => normalizeCharacterDna(variant(devices => { devices[3].tokens.motion = [{ param: 'walk.cadence', value: 1.8 }, { param: 'turn.style', value: 'pivot' }]; }), { input: measuredInput, sketch }), /change how the character moves/u);
  rejects(() => normalizeCharacterDna(variant(devices => { devices[3].qualities = ['Not a returned tag']; }), { input: measuredInput, sketch }), /returned for this device's measured anchors/u);
  const tagsOf = ref => measuredInput.entities.find(entity => entity.ref === ref).tags;
  rejects(() => normalizeCharacterDna(variant(devices => { devices[3].anchors = [devices[3].anchors[1]]; devices[3].qualities = tagsOf(devices[3].anchors[0]).slice(0, 1); }), { input: measuredInput, sketch }), /motion device anchored to a measured style ref/u);
  rejects(() => normalizeCharacterDna(variant(devices => { devices.splice(5, 1); }), { input: measuredInput, sketch }), /required anchor/u);
  rejects(() => normalizeCharacterDna(base, { input: measuredInput, sketch, portraits: true }), /imagery device/u);
});

test('qualities come first: palette and silhouette rest on qualities, and empty rankings give way to qualities', () => {
  const base = dnaFor(measuredInput, ember, emberMeasures, true);
  const variant = edit => { const copy = structuredClone(base); edit(copy.devices); return copy; };
  const works = measuredInput.requiredAnchors.filter(ref => byRef(measuredInput, ref).domain !== 'qualities');
  const onWork = (device, ref = works[0]) => { device.anchors = [ref]; device.qualities = byRef(measuredInput, ref).tags.slice(0, 1); };
  const departed = normalizeCharacterDna(base, { input: measuredInput, sketch });
  assert.ok(departed.stats.qualityAnchoredDevices >= 4, JSON.stringify(departed.stats));
  // A palette or a figure taken from one work, the way the first live pair took a hockey team's colours, is refused.
  for (const index of [0, 1]) {
    const dna = variant(devices => { onWork(devices[index]); devices.push({ ...structuredClone(devices[0]), id: 'dna9', layer: 'light', anchors: [measuredInput.requiredAnchors[index]], qualities: byRef(measuredInput, measuredInput.requiredAnchors[index]).tags, tokens: { light: { color: ember.light.color } } }); });
    rejects(() => normalizeCharacterDna(dna, { input: measuredInput, sketch }), new RegExp(`Qualities first: anchor a ${index ? 'silhouette' : 'palette'} device to at least one measured quality ref.*trade dress`, 'u'));
  }
  // The aesthetic ranking returned no tags, so a costume or silhouette part device must translate a measured look quality.
  rejects(() => normalizeCharacterDna(variant(devices => { devices[2].anchors = [works[1], measuredInput.requiredAnchors[2]]; devices[2].qualities = ['Craftsmanship']; }), { input: measuredInput, sketch }),
    /measured look quality \(the aesthetic ranking returned no tags\)/u);
  // Without Qloo the same rule holds with the qualities the model predicted.
  const own = dnaFor(ownInput, ash, ashMeasures, false);
  own.devices[0].anchors = [ownInput.requiredAnchors.find(ref => byRef(ownInput, ref).domain === 'videogame')];
  rejects(() => normalizeCharacterDna(own, { input: ownInput, sketch }), /Qualities first: anchor a palette device to at least one quality ref/u);
});

test('conformance finds every declared token in the character and names what is missing', () => {
  const dna = normalizeCharacterDna(dnaFor(measuredInput, ember, emberMeasures, true), { input: measuredInput, sketch });
  assert.equal(checkCharacterConformance(dna, ember, { measures: emberMeasures }).score, 1);
  const dimmer = normalizeCharacter({ ...emberRaw, light: { ...emberRaw.light, color: '#ffffff' }, lines: { ...emberRaw.lines, arrive: 'Something else entirely.' } }, { canon, strict: true });
  const report = checkCharacterConformance(dna, dimmer, { measures: measureCharacter(dimmer) });
  assert.ok(report.score < 1);
  const missing = report.devices.flatMap(device => device.missing.map(item => item.kind));
  assert.ok(missing.includes('light') && missing.includes('line'), JSON.stringify(missing));
});

test('measures use the figure, not held props, and warn about parts drawn off their joints', () => {
  assert.ok(ashMeasures.height > ashMeasures.figureHeight + 15, 'the staff overhead does not count toward the figure');
  assert.ok(emberMeasures.headShare > ashMeasures.headShare + 0.15);
  const broken = structuredClone(ashRaw);
  broken.parts.find(part => part.id === 'thigh').from = [0, -70];
  broken.parts.find(part => part.id === 'boot').d = 'M-6,-25 L20,-25 L20,-12 L-7,-12 Z';
  broken.motion.walk.speed = 220; broken.motion.walk.cadence = 1;
  const codes = measureCharacter(normalizeCharacter(broken, { canon, strict: true })).warnings.map(item => item.code);
  for (const code of ['joint-gap', 'floating-feet', 'stride']) assert.ok(codes.includes(code), `${code} in ${codes}`);
});

test('text previews draw the three poses with a legend and the ground', () => {
  for (const pose of ['rest', 'walk', 'kindle']) {
    const preview = asciiPose(ash, pose);
    assert.match(preview.text, /^-+$/mu, 'a ground row');
    assert.ok(preview.legend.some(item => item.endsWith(' hood')));
    assert.ok(preview.text.split('\n').length > 25);
  }
  // At the kindling moment the lantern is raised above where it hangs at rest.
  assert.ok(asciiPose(ash, 'kindle').light[1] < asciiPose(ash, 'rest').light[1] - 20);
});

test('fingerprints separate the two samples and each run is measured against its own sketch', () => {
  const [a, b] = [characterFingerprint(ash, ashMeasures), characterFingerprint(ember, emberMeasures)];
  assert.equal(compareCharacterFingerprints(a, a).overall, 0);
  const distance = compareCharacterFingerprints(a, b);
  assert.ok(distance.overall > 0.35 && distance.silhouette > 0.3 && distance.motion > 0.25, JSON.stringify(distance));
  assert.ok(characterSketchDivergence(sketch, ash, ashMeasures).score < 0.15);
  assert.ok(characterSketchDivergence(sketch, ember, emberMeasures).score > 0.6);
});

async function armDir(mode, { portraits = null } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-arm-'));
  const world = await loadWorld();
  await prepareArm({ dir, arm: ARMS.find(arm => arm.mode === mode), brief: { name: 'Test', brief: 'A test brief long enough to pass the brief loader in this suite.', references: [{ name: 'Fixture reference one', role: 'audience' }], knownNames: [] },
    world, domains: GAME_DOMAINS, profile, portraits });
  return dir;
}

test('the session enforces the protocol order and freezes what it should', async () => {
  const images = { available: true, provider: 'fixture', version: '0', async generate({ directory, name }) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `${name}.png`), 'not really an image');
    return { path: `generated/${name}.png`, format: 'png', width: 2, height: 3, bytes: 19, durationMs: 1, description: 'A fixture portrait.' };
  } };
  const dir = await armDir('qloo', { portraits: { perRun: 1 } });
  const session = await createArmSession({ dir, images });
  const call = (name, args = {}) => session.handle(name, args);
  assert.equal((await call('game_get_taste')).structuredContent.status, 'awaiting-prediction');
  assert.ok((await call('game_write_file', { path: 'game-dna.json', content: '{}' })).isError, 'no DNA before the prediction');
  assert.ok((await call('game_read_file', { path: 'host/profile.json' })).isError, 'host records are out of reach');
  assert.ok((await call('game_write_file', { path: 'notes.txt', content: 'x' })).isError, 'only the three artifacts can be written');
  assert.ok(!(await call('game_write_file', { path: 'game-assumption.json', content: fixtureAssumption() })).isError);
  assert.ok((await call('game_write_file', { path: 'game-assumption.json', content: fixtureAssumption() })).isError, 'the prediction is frozen');
  assert.ok((await call('game_write_file', { path: 'game-dna.json', content: '{}' })).isError, 'no DNA before the reveal');
  const taste = (await call('game_get_taste')).structuredContent;
  assert.equal(taste.status, 'revealed');
  assert.ok(taste.entities.some(entity => entity.surprise));
  const dna = JSON.parse(fixtureDna({ input: taste, character: ember, measures: emberMeasures, measured: true, sketch, deltaE }));
  const refused = await call('game_write_file', { path: 'game-dna.json', content: JSON.stringify(dna) });
  assert.match(refused.content[0].text, /imagery device/u, 'portraits need an imagery device');
  const portraitAnchor = taste.entities.find(entity => entity.ref === taste.requiredAnchors[0].ref);
  dna.devices.push({ id: 'dna8', layer: 'imagery', device: 'A painted portrait in the jacket colours', anchors: [portraitAnchor.ref], qualities: portraitAnchor.tags.slice(0, 1), translation: 'Fixture translation for the portrait device.', tokens: { colors: ['#e2b43c', '#3f8e89'] } });
  assert.ok(!(await call('game_write_file', { path: 'game-dna.json', content: JSON.stringify(dna) })).isError);
  assert.match((await call('game_write_file', { path: 'character.json', content: JSON.stringify(emberRaw) })).content[0].text, /portrait/u, 'a portrait comes before the character');
  assert.match((await call('game_generate_portrait', { device: 'dna8', subject: 'Fixture Film: Lantern Parade in a teal beanie' })).content[0].text, /taste entities/u, 'a subject may not name a taste entity');
  const painted = await call('game_generate_portrait', { device: 'dna8', subject: 'A small lamplighter in a mustard jacket holding a mint lantern at dusk', aspect: 'portrait' });
  assert.equal(painted.structuredContent.status, 'generated');
  assert.ok((await call('game_write_file', { path: 'game-dna.json', content: JSON.stringify(dna) })).isError, 'the first portrait freezes the DNA');
  const named = { ...emberRaw, lines: { ...emberRaw.lines, arrive: 'Qloo told me about these cliffs.' } };
  assert.ok((await call('game_write_file', { path: 'character.json', content: JSON.stringify(named) })).isError, 'the lines never mention the tools');
  assert.ok(!(await call('game_write_file', { path: 'character.json', content: JSON.stringify(emberRaw) })).isError);
  const check = (await call('game_check_character')).content[0].text;
  assert.match(check, /DNA conformance: score 1 /u);
  assert.match(check, /PREVIEW kindle/u);
  const record = JSON.parse(await fs.readFile(path.join(dir, 'host', 'session.json'), 'utf8'));
  assert.equal(record.portraits[0].status, 'generated');
  assert.ok(record.pipeline.revealedAt > record.pipeline.predictedAt);
  await fs.rm(dir, { recursive: true, force: true });
});

test('the design server speaks MCP over stdio and lists only the session tools', async () => {
  const dir = await armDir('baseline');
  const client = await connect({ dir });
  try {
    const names = (await client.tools()).map(tool => tool.name).sort();
    assert.deepEqual(names, ['game_check_character', 'game_get_taste', 'game_list_files', 'game_read_file', 'game_write_file']);
    const guide = await client.call('game_read_file', { path: 'format.md' });
    assert.match(guide.text, /^# Character format/u);
    assert.ok((await client.call('game_read_file', { path: '../host/config.json' })).isError);
  } finally { await client.close(); }
  await fs.rm(dir, { recursive: true, force: true });
});

test('the dry run plays both arms end to end and records a comparison', async () => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-runs-'));
  const events = [], arms = [];
  const record = await runPair({ brief: { name: 'Dry run', brief: 'A test brief long enough to pass the brief loader in this suite.', references: [{ name: 'Fixture reference one', role: 'audience' }], knownNames: [] },
    mode: 'dry-run', pairId: 'test-pair', runsRoot, onEvent: event => events.push(event), onArm: event => arms.push(`${event.arm}:${event.status}`) });
  assert.equal(record.status, 'completed', record.error);
  assert.equal(record.kind, 'dry-run');
  assert.equal(record.taste.fixture, true);
  assert.ok(record.protocol.domains.includes('qualities'));
  assert.deepEqual(record.arms.map(arm => arm.conformance.score), [1, 1]);
  assert.ok(record.arms[1].divergence.score > record.arms[0].divergence.score + 0.4);
  assert.ok(record.comparison.distance.overall > 0.35);
  assert.match(record.comparison.qualityHeadline, /Qloo on devices translate measured qualities/u);
  const [off, on] = record.arms;
  assert.deepEqual(on.taste.qualities.slice(0, 2).map(item => item.family), ['look', 'mood']);
  assert.deepEqual(on.taste.artStyles.map(item => `${item.name}:${item.preset}`), ['Hand-Drawn:ink', 'Pixel Art:pixel']);
  assert.equal(on.taste.renderStyles[0].preset, 'ink');
  // Both arms set the moment: the scene, the render style each anchor names and a credited track.
  assert.equal(record.protocol.artDirection, true);
  assert.equal(record.protocol.music.tracks > 0, true);
  assert.deepEqual(record.arms.map(arm => arm.music.id), ['peaceful-night-st-adam', 'red-moonlight-extended-mix-pokki-dj']);
  assert.match(on.music.attribution, /licensed under CC BY/u);
  assert.deepEqual(record.arms.map(arm => arm.dna.devices.find(device => device.layer === 'render').tokens.render), ['watercolor', 'ink']);
  assert.ok(record.comparison.distance.world > 0.5, JSON.stringify(record.comparison.distance));
  assert.match(record.comparison.renderHeadline, /measured art style Hand-Drawn/u);
  assert.ok(on.divergence.world.score > off.divergence.world.score + 0.5);
  assert.ok(on.taste.requiredAnchors[0].count >= 2 && on.taste.requiredAnchors[0].family === 'look');
  assert.ok(off.taste.qualities.every(item => item.source === 'model-assumption'));
  assert.ok(on.dna.devices.find(device => device.layer === 'palette').anchors.some(anchor => anchor.domain === 'qualities' && anchor.family));
  for (const arm of record.arms) assert.ok(fss.existsSync(path.join(runsRoot, 'test-pair', `${arm.key}.json`)));
  // Every taste-pass response is kept, so the pass can be replayed; the profile cites the records by ID.
  const taste = JSON.parse(await fs.readFile(path.join(runsRoot, 'test-pair', 'taste.json'), 'utf8'));
  assert.equal(taste.evidence[0].id, 'Q001');
  assert.equal(taste.evidence.length, taste.calls.length);
  // Qualities and art styles are derived from the works' tags, so they cite the works rather than one record.
  assert.ok(taste.profile.entities.every(entity => ['qualities', 'art_style'].includes(entity.domain) || /^Q\d{3}$/u.test(entity.evidenceId)));
  assert.ok(taste.profile.entities.some(entity => entity.domain === 'art_style'));
  // Session events reach the caller live, per arm, and each arm reports its status.
  assert.ok(events.some(event => event.arm === 'qloo-on' && /Prediction frozen/u.test(event.message)));
  assert.ok(events.some(event => event.arm === null && /Taste pass ok/u.test(event.message)));
  assert.deepEqual(arms, ['qloo-off:running', 'qloo-off:completed', 'qloo-on:running', 'qloo-on:completed']);
  await fs.rm(runsRoot, { recursive: true, force: true });
});

test('a cancelled pair stops before the next arm and says so', async () => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-runs-'));
  const controller = new AbortController();
  const record = await runPair({ brief: { name: 'Dry run', brief: 'A test brief long enough to pass the brief loader in this suite.', references: [{ name: 'Fixture reference one', role: 'audience' }], knownNames: [] },
    mode: 'dry-run', pairId: 'cancelled-pair', runsRoot, signal: controller.signal, onArm: event => { if (event.status === 'completed') controller.abort(); } });
  assert.equal(record.status, 'cancelled');
  assert.deepEqual(record.arms.map(arm => arm.key), ['qloo-off']);
  assert.equal(JSON.parse(await fs.readFile(path.join(runsRoot, 'cancelled-pair', 'pair.json'), 'utf8')).status, 'cancelled');
  await fs.rm(runsRoot, { recursive: true, force: true });
});

test('the session watcher forwards new events and pauses the deadline while a portrait is painted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-watch-'));
  await fs.mkdir(path.join(dir, 'host'));
  const write = state => fs.writeFile(path.join(dir, 'host', 'session.json'), JSON.stringify(state));
  const seen = [], calls = [];
  const watcher = watchSession({ dir, every: 5, onEvents: events => seen.push(...events.map(event => event.message)) });
  watcher.register({ pause: () => calls.push('pause'), resume: () => calls.push('resume') });
  const until = async predicate => { for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5)); };
  await write({ events: [{ message: 'one' }], portraits: [{ status: 'requested' }] });
  await until(() => calls.length === 1);
  await write({ events: [{ message: 'one' }, { message: 'two' }], portraits: [{ status: 'generated' }] });
  await until(() => calls.length === 2);
  await write({ events: [{ message: 'one' }, { message: 'two' }, { message: 'three' }], portraits: [{ status: 'generated' }] });
  await watcher.stop();
  assert.deepEqual(calls, ['pause', 'resume']);
  assert.deepEqual(seen, ['one', 'two', 'three']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('the Kiro deadline counts model time only: a host wait pauses it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-kiro-'));
  await fs.mkdir(path.join(dir, 'host'));
  // A stand-in Kiro process that exits cleanly after 120 ms, or at once when it is stopped.
  const spawnImpl = () => {
    const child = new EventEmitter();
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    const timer = setTimeout(() => child.emit('close', 0), 120);
    child.kill = () => { clearTimeout(timer); setImmediate(() => child.emit('close', null)); };
    return child;
  };
  const config = { kiroPath: 'kiro-cli', effort: 'medium' };
  await assert.rejects(runKiro({ dir, config, model: 'test-model', prompt: 'x', timeoutMs: 40, spawnImpl }), /time limit/u);
  const done = await runKiro({ dir, config, model: 'test-model', prompt: 'x', timeoutMs: 40, spawnImpl, registerHostWait: wait => wait.pause() });
  assert.equal(done.exitCode, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('an arm\'s review images echoed on Kiro\'s output do not stop it, and its output limit has its own error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-kiro-'));
  await fs.mkdir(path.join(dir, 'host'));
  // kiro-cli 2.24 echoed a read of four captures as one line of some 9 MB; the arm's 6 MB cap stopped it mid-review.
  const echo = JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', status: 'completed', rawOutput: { items: [{ Image: { source: { data: Array.from({ length: 2_600_000 }, () => 211) } } }] } } } });
  const start = JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', title: 'Running: @game/game_capture_review' } } });
  const spawnImpl = output => () => {
    const child = new EventEmitter();
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() });
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); };
    setImmediate(() => { child.stdout.write(output); setTimeout(() => { if (!child.killed) child.emit('close', 0); }, 20); });
    return child;
  };
  const config = { kiroPath: 'kiro-cli', effort: 'medium' };
  const titles = [];
  assert.ok(echo.length > 6_000_000);
  const done = await runKiro({ dir, config, model: 'test-model', prompt: 'x', timeoutMs: 5000, spawnImpl: spawnImpl(`${start}\n${echo}\n`), onEvent: title => titles.push(title) });
  assert.equal(done.exitCode, 0);
  assert.deepEqual(titles, ['Running: @game/game_capture_review']);
  assert.match(await fs.readFile(path.join(dir, 'host', 'kiro-events.log'), 'utf8'), /game_capture_review/u);
  await assert.rejects(runKiro({ dir, config, model: 'test-model', prompt: 'x', timeoutMs: 5000, spawnImpl: spawnImpl('x'.repeat(5000)), outputLimits: { line: 1000, total: 4000 } }), /exceeded its output limit/u);
  await fs.rm(dir, { recursive: true, force: true });
});
