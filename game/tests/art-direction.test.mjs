// The moment's art direction: the scene, the render style an art style names and the track from the open music
// library, with the departure rule, its ablation, the audience's place and age, swap pairs and recorded profiles read
// again with today's taste pass. No model, Qloo or Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasteInputFromProfile, tasteInputFromAssumption, compactTasteInput, buildTasteProfile, TasteProtocolError } from '../../plugin/server/culture/taste.mjs';
import { normalizeCharacter } from '../src/format.js';
import { measureCharacter } from '../harness/measure.mjs';
import { makeCharacterPrompt } from '../harness/prompt.mjs';
import { normalizeCharacterAssumption, normalizeCharacterDna, checkCharacterConformance, characterFingerprint, compareCharacterFingerprints, characterSketchDivergence,
  compareCharacterRuns, characterPolicyText, armPolicyText, profileOverlap, deltaE } from '../harness/protocol.mjs';
import { withRenderStyles } from '../harness/art-styles.mjs';
import { loadMusicLibrary, musicListing, sharedMoods, tracksFor, byteRange, musicLibraryFile, MUSIC_PATH } from '../harness/music.mjs';
import { createArmSession } from '../harness/session.mjs';
import { GAME_DOMAINS, GAME_MEDIUM, fixtureProfile, fixtureAssumption, fixtureDna, fixtureQlooClient, FIXTURE_TRACKS } from '../harness/fixtures.mjs';
import { prepareArm, loadWorld, runPair, loadRecordedProfile, normalizeAudience, forBrief, ARMS } from '../harness/run-pair.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const read = file => JSON.parse(fss.readFileSync(path.join(root, file), 'utf8'));
const canon = read('world/canon.json');
const [ashRaw, emberRaw] = ['samples/sample-a.json', 'samples/sample-b.json'].map(read);
const library = await loadMusicLibrary(repo);
const tracks = musicListing(library).tracks;
const ids = tracks.map(track => track.id);
const strict = { canon, strict: true, artDirection: true, tracks: ids };
const [ash, ember] = [ashRaw, emberRaw].map(raw => normalizeCharacter(raw, strict));
const [ashMeasures, emberMeasures] = [ash, ember].map(character => measureCharacter(character));
const assumption = normalizeCharacterAssumption(fixtureAssumption(), { domains: GAME_DOMAINS, artDirection: true, tracks });
const sketch = assumption.characterSketch;
const profile = await fixtureProfile();
const measured = withRenderStyles(tasteInputFromProfile(profile, assumption, { medium: GAME_MEDIUM }), { measured: true });
const own = withRenderStyles(tasteInputFromAssumption(assumption, { medium: GAME_MEDIUM }), { measured: false });
const byRef = (input, ref) => input.entities.find(entity => entity.ref === ref);
// What game_get_taste returns: the compact input beside the render styles.
const view = input => ({ ...compactTasteInput(input), renderStyles: input.renderStyles });
const dnaFor = (input, character, measures, isMeasured, { withTracks = true } = {}) => JSON.parse(fixtureDna({ input: view(input), character, measures, measured: isMeasured, sketch, deltaE, tracks: withTracks ? tracks : null }));
const rules = (input, extra = {}) => ({ input, sketch, artDirection: true, tracks, ...extra });
const rejects = (fn, pattern) => assert.throws(fn, error => error instanceof TasteProtocolError && pattern.test(error.message), `expected ${pattern}`);
const layer = (devices, name) => devices.find(device => device.layer === name);
const brief = { name: 'Art direction test', brief: 'A test brief long enough to pass the brief loader in this suite.', references: [{ name: 'Fixture reference one', role: 'audience' }], knownNames: [] };

test('art styles become render styles: the strongest is required, and a predicted style of the same preset is no surprise', () => {
  assert.deepEqual(measured.renderStyles.map(style => `${style.name}:${style.preset}`), ['Hand-Drawn:ink', 'Pixel Art:pixel']);
  assert.ok(measured.requiredAnchors.includes(measured.renderStyles[0].ref));
  assert.equal(byRef(measured, measured.renderStyles[0].ref).surprise, true);
  assert.deepEqual(own.renderStyles.map(style => style.preset), ['watercolor']);
  // A prediction that names the ink style in other words counts as predicting Hand-Drawn.
  const raw = JSON.parse(fixtureAssumption());
  raw.predictions.art_style = ['Ink illustration', 'Watercolor', 'Painterly'];
  const inky = normalizeCharacterAssumption(raw, { domains: GAME_DOMAINS, artDirection: true, tracks });
  const input = withRenderStyles(tasteInputFromProfile(profile, inky, { medium: GAME_MEDIUM }), { measured: true });
  const hand = input.entities.find(entity => entity.name === 'Hand-Drawn');
  assert.deepEqual([hand.predictedByModel, hand.surprise], [true, false]);
  assert.equal(input.metrics.artStyleSurprises, 1);
});

test('with art direction the frozen sketch includes its moment and a listed track', () => {
  const raw = JSON.parse(fixtureAssumption());
  const { scene, render, music, ...figure } = raw.characterSketch;
  void music;
  const domains = { domains: GAME_DOMAINS, artDirection: true, tracks };
  rejects(() => normalizeCharacterAssumption({ ...raw, characterSketch: figure }, domains), /characterSketch\.scene/u);
  rejects(() => normalizeCharacterAssumption({ ...raw, characterSketch: { ...figure, scene, render } }, domains), /characterSketch\.music/u);
  rejects(() => normalizeCharacterAssumption({ ...raw, characterSketch: { ...raw.characterSketch, music: 'not-listed' } }, domains), /track ID from music\.json/u);
  assert.deepEqual([sketch.render, sketch.music, sketch.scene.towers, sketch.scene.weather], ['watercolor', FIXTURE_TRACKS.sketch, 'ruin', 'leaves']);
});

test('a character file with art direction sets its scene and render style and picks a listed track', () => {
  const { scene, render, music, ...bare } = emberRaw;
  void render; void music;
  assert.throws(() => normalizeCharacter(bare, strict), /character\.scene/u);
  assert.throws(() => normalizeCharacter({ ...emberRaw, music: { track: 'not-a-track' } }, strict), /no track "not-a-track"/u);
  assert.throws(() => normalizeCharacter({ ...emberRaw, scene: { ...scene, sky: [scene.sky[1], scene.sky[0]] } }, strict), /always dusk/u);
  assert.throws(() => normalizeCharacter({ ...emberRaw, scene: { ...scene, rock: '#d8d0c0' } }, strict), /basalt/u);
  // Without art direction the same fields stay optional, so earlier characters still load.
  assert.doesNotThrow(() => normalizeCharacter(bare, { canon, strict: true }));
  assert.deepEqual([ember.render.preset, ember.music.track, ember.scene.towers], ['ink', FIXTURE_TRACKS.measured, 'pagoda']);
});

test('the DNA sets the moment: a scene, the render style its anchor names and a track that carries its qualities', () => {
  const base = dnaFor(measured, ember, emberMeasures, true);
  const dna = normalizeCharacterDna(base, rules(measured));
  assert.deepEqual(dna.devices.filter(device => ['scene', 'render', 'music'].includes(device.layer)).map(device => device.layer), ['scene', 'render', 'music']);
  assert.equal(layer(dna.devices, 'render').presetFrom, measured.renderStyles[0].ref);
  assert.deepEqual(layer(dna.devices, 'music').moods, ['energetic']);
  assert.deepEqual([...dna.stats.sketchMoves.world.changed].sort(), ['music', 'render', 'towers', 'weather']);
  assert.deepEqual(dna.rules, { artDirection: true, music: true, departure: true });
  assert.ok(normalizeCharacterDna(dnaFor(own, ash, ashMeasures, false), rules(own)));
  const variant = edit => { const copy = structuredClone(base); edit(copy.devices, copy); return copy; };
  rejects(() => normalizeCharacterDna(variant(devices => { devices.splice(devices.indexOf(layer(devices, 'scene')), 1); }), rules(measured)), /Include scene device/u);
  rejects(() => normalizeCharacterDna(variant(devices => { devices.splice(devices.indexOf(layer(devices, 'music')), 1); }), rules(measured)), /Include music device/u);
  // The anchor names the style: Hand-Drawn draws in ink, so another preset is refused.
  rejects(() => normalizeCharacterDna(variant(devices => { layer(devices, 'render').tokens.render = 'pixel'; }), rules(measured)), /names the ink and paper style, so it draws in "ink"/u);
  // The strongest render style draws the frame unless the DNA gives a reason against it; then another one that names a preset does.
  const [lead, pixel] = measured.renderStyles;
  const onPixel = devices => Object.assign(layer(devices, 'render'), { anchors: [pixel.ref], qualities: ['Pixel Art'], tokens: { render: 'pixel' } });
  rejects(() => normalizeCharacterDna(variant(devices => { onPixel(devices); layer(devices, 'scene').anchors.push(lead.ref); }), rules(measured)), /Anchor the render device to Hand-Drawn/u);
  assert.ok(normalizeCharacterDna(variant((devices, copy) => { onPixel(devices); copy.rejected.push({ ref: lead.ref, reason: 'Fixture reason: the ink outline fights the soft ember glow in this moment.' }); }), rules(measured)));
  rejects(() => normalizeCharacterDna(variant(devices => { const scene = layer(devices, 'scene'); Object.assign(layer(devices, 'render'), { anchors: [scene.anchors[0]], qualities: scene.qualities, tokens: { render: 'ink' } }); }), rules(measured)), /render device anchored to a measured art style ref/u);
  // The track carries the device's qualities; qualities come first, so a measured quality's name chooses it.
  assert.deepEqual(layer(dna.devices, 'music').anchors.map(ref => byRef(measured, ref).name), ['Energetic']);
  rejects(() => normalizeCharacterDna(variant(devices => { layer(devices, 'music').tokens.music = 'sad-piano-alexander-blu'; }), rules(measured)), /The track must carry this device's qualities.*red-moonlight-extended-mix-pokki-dj/u);
  // Neither an entity's own returned tags nor the model's own prediction may choose it while a measured quality meets a track.
  const choir = measured.entities.find(entity => entity.name === 'Fixture Artist: Brass Choir');
  const ownArtist = measured.entities.find(entity => entity.source === 'model-assumption' && entity.domain === 'artist');
  for (const anchor of [choir, ownArtist]) {
    rejects(() => normalizeCharacterDna(variant(devices => { Object.assign(layer(devices, 'music'), { anchors: [anchor.ref], qualities: ['Energetic'] }); }), rules(measured)), /anchor the device to a measured quality whose name or tags a track carries, such as Energetic/u);
  }
  rejects(() => normalizeCharacterDna(variant(devices => { devices.find(device => device.layer === 'music').anchors.push(choir.ref); layer(devices, 'music').anchors.shift(); layer(devices, 'music').qualities = ['Upbeat']; }), rules(measured)), /a quality anchor of this device/u);
  // Only when no measured quality meets a track may another measured ref's returned tags choose it.
  const chiptune = tracks.filter(track => ['idempotence-social-bot-73xt', FIXTURE_TRACKS.sketch].includes(track.id));
  const spark = measured.entities.find(entity => entity.name === 'Fixture Artist: Spark Units');
  const fallback = variant(devices => { Object.assign(layer(devices, 'music'), { anchors: [spark.ref], qualities: ['Chiptune'], tokens: { music: 'idempotence-social-bot-73xt' } }); });
  assert.deepEqual(layer(normalizeCharacterDna(fallback, rules(measured, { tracks: chiptune })).devices, 'music').moods, ['chiptune']);
  rejects(() => normalizeCharacterDna(fallback, rules(measured)), /such as Energetic/u);
});

test('surprises move the world too, unless the departure rule is off for an ablation', () => {
  const base = dnaFor(measured, ember, emberMeasures, true);
  const variant = edit => { const copy = structuredClone(base); edit(copy.devices); return copy; };
  rejects(() => normalizeCharacterDna(variant(devices => { layer(devices, 'scene').tokens.scene = { sky: sketch.scene.sky, colors: sketch.scene.palette.slice(0, 2), weather: 'embers', towers: 'pagoda' }; }), rules(measured)), /move the world as well as the character/u);
  // A sketch that already picked the energetic track cannot keep it: a surprise's tags meet another track.
  const picked = { ...sketch, music: FIXTURE_TRACKS.measured };
  rejects(() => normalizeCharacterDna(base, rules(measured, { sketch: picked })), /change the music too/u);
  // The ash pilgrim's tokens on measured anchors are relabelling: refused with the rule, accepted without it.
  const relabelled = dnaFor(measured, ash, ashMeasures, true, { withTracks: false });
  layer(relabelled.devices, 'render').tokens.render = 'ink';
  rejects(() => normalizeCharacterDna(relabelled, rules(measured, { tracks: null })), /move the palette|change the figure|add something|change how the character moves|move the world/u);
  const ablation = normalizeCharacterDna(relabelled, rules(measured, { tracks: null, departure: false }));
  assert.deepEqual(ablation.rules, { artDirection: true, music: false, departure: false });
});

test('conformance checks the moment: sky, scene colours, weather, beacons, render style and track', () => {
  const dna = normalizeCharacterDna(dnaFor(measured, ember, emberMeasures, true), rules(measured));
  assert.equal(checkCharacterConformance(dna, ember, { measures: emberMeasures }).score, 1);
  const other = normalizeCharacter({ ...emberRaw, render: { preset: 'pixel' }, music: { track: 'sad-piano-alexander-blu' }, scene: { ...emberRaw.scene, weather: { kind: 'snow' }, towers: 'spire' } }, strict);
  const report = checkCharacterConformance(dna, other, { measures: measureCharacter(other) });
  const missing = report.devices.flatMap(device => device.missing.map(item => item.kind));
  for (const kind of ['render', 'music', 'weather', 'towers']) assert.ok(missing.includes(kind), JSON.stringify(missing));
  assert.ok(report.score < 1);
});

test('the moment counts in the distance and in the departure from the sketch', () => {
  const distance = compareCharacterFingerprints(characterFingerprint(ash, ashMeasures), characterFingerprint(ember, emberMeasures));
  assert.deepEqual([distance.worldParts.render, distance.worldParts.music, distance.worldParts.towers], [1, 1, 1]);
  assert.ok(distance.world > 0.6 && Math.abs(distance.overall - (0.65 * distance.character + 0.35 * distance.world)) < 0.002, JSON.stringify(distance));
  // A pair before art direction drew one fixed world, so its distance is the character's alone.
  const strip = ({ scene, render, music, ...rest }) => { void scene; void render; void music; return rest; };
  const [a, b] = [ashRaw, emberRaw].map(raw => normalizeCharacter(strip(raw), { canon, strict: true }));
  const plain = compareCharacterFingerprints(characterFingerprint(a, measureCharacter(a)), characterFingerprint(b, measureCharacter(b)));
  assert.equal(plain.world, undefined);
  assert.equal(plain.overall, plain.character);
  const [off, on] = [characterSketchDivergence(sketch, ash, ashMeasures), characterSketchDivergence(sketch, ember, emberMeasures)];
  assert.ok(off.world.score < 0.2 && on.world.score > 0.8, JSON.stringify([off.world, on.world]));
  assert.deepEqual([on.world.render, on.world.music, on.world.weather, on.world.towers], [true, true, true, true]);
  assert.ok(on.combined > off.combined + 0.5);
});

test('a comparison names its arms, and a swap pair reports how much data its two profiles share', () => {
  const arm = (character, measures, input, isMeasured) => {
    const dna = normalizeCharacterDna(dnaFor(input, character, measures, isMeasured), rules(input));
    return { character, measures, dna, input, conformance: checkCharacterConformance(dna, character, { measures }), divergence: characterSketchDivergence(sketch, character, measures) };
  };
  const pair = compareCharacterRuns({ baseline: arm(ash, ashMeasures, own, false), qloo: arm(ember, emberMeasures, measured, true) });
  assert.match(pair.worldHeadline, /Qloo on sets the moment in the ink and paper style with embers and pagoda beacons; Qloo off in the watercolour style with leaves and ruin beacons/u);
  assert.match(pair.renderHeadline, /Qloo off's from its own predicted art style Watercolor/u);
  assert.equal(pair.data, undefined);
  const swap = compareCharacterRuns({ baseline: arm(ember, emberMeasures, measured, true), qloo: arm(ember, emberMeasures, measured, true), labels: { baseline: 'Qloo on', qloo: 'Swapped profile' } });
  assert.match(swap.headline, /in the Swapped profile design rest on/u);
  assert.match(swap.headline, /In the Qloo on design, \d+ of \d+ do\./u);
  assert.match(swap.qualityHeadline, /Qloo on translated the measured qualities of its own profile/u);
  assert.equal(swap.data.qualities.shared.length, swap.data.qualities.total);
  assert.match(swap.dataHeadline, /share \d+ of \d+ measured qualities and art styles/u);
  assert.equal(swap.distance.overall, 0);
  const a = { entities: [{ name: 'Colorful', domain: 'qualities', source: 'qloo' }, { name: 'Work A', domain: 'movie', source: 'qloo' }] };
  const b = { entities: [{ name: 'colorful', domain: 'qualities', source: 'qloo' }, { name: 'Pixel Art', domain: 'art_style', source: 'qloo' }, { name: 'Work B', domain: 'movie', source: 'qloo' }] };
  assert.deepEqual(profileOverlap(a, b), { qualities: { shared: ['Colorful'], total: 2 }, works: { shared: [], total: 2 } });
});

test('the policy and the prompt state the moment, the music and the departure rule as the arm sets them', () => {
  const art = characterPolicyText({ artDirection: true, music: true });
  for (const phrase of ["The moment's art direction is part of the design", "A music device picks the moment's track", 'The world departs too']) assert.ok(art.includes(phrase), phrase);
  const ablation = characterPolicyText({ artDirection: true, music: true, departure: false });
  assert.ok(!ablation.includes('they must move the character'));
  assert.equal(armPolicyText({ artDirection: true, music: true, departure: false }), ablation);
  assert.equal(armPolicyText({}), characterPolicyText());
  assert.ok(!/\n{3}/u.test(art) && !/\n{3}/u.test(ablation), 'paragraphs stay single-spaced');
  const make = (mode, extra = {}) => makeCharacterPrompt({ brief, canon, mode, domains: GAME_DOMAINS, artDirection: true, music: tracks.length, ...extra });
  const strip = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');
  const [off, on] = ['baseline', 'qloo'].map(mode => make(mode));
  assert.equal(strip(off), strip(on));
  for (const phrase of ['music.json', '- Scene: include a scene device', '- Render: include a render device anchored to an art style ref', '- Music: include a music device', 'The moment moves too']) assert.ok(on.includes(phrase), phrase);
  assert.ok(!make('qloo', { departure: false }).includes('they must move the character away'), 'the ablation drops the departure bullet');
  assert.match(make('qloo', { audience: { location: 'Lisbon, Portugal', ageLabel: '24 and younger' } }), /Audience: players in or around Lisbon, Portugal, aged 24 and younger\. This is a fact of the brief for both runs/u);
  // In a swap pair both arms are measured and read the same text, which does not say whose references the profile came from.
  assert.doesNotMatch(make('qloo', { swap: true }), /taste pass from the brief's references/u);
});

test('a session with a music library lists music.json, reveals render styles and reports the moment it checks', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-art-'));
  await prepareArm({ dir, arm: ARMS[1], brief, world: await loadWorld(), domains: GAME_DOMAINS, profile, music: library });
  const session = await createArmSession({ dir });
  const call = (name, args = {}) => session.handle(name, args);
  assert.ok((await call('game_list_files')).structuredContent.files.includes('music.json'));
  assert.equal(JSON.parse((await call('game_read_file', { path: 'music.json' })).content[0].text).tracks.length, library.tracks.length);
  assert.ok(session.policy.includes("A music device picks the moment's track"));
  assert.ok(!(await call('game_write_file', { path: 'game-assumption.json', content: fixtureAssumption() })).isError);
  const taste = (await call('game_get_taste')).structuredContent;
  assert.equal(taste.renderStyles[0].preset, 'ink');
  assert.match(taste.guidance, /The strongest render style is Hand-Drawn/u);
  assert.match(taste.guidance, /Qualities first for the music too: anchor the music device to a measured quality whose name a track in music\.json carries, and pick that track: Energetic \(quality:mood:energetic\) for [^;]*red-moonlight-extended-mix-pokki-dj/u);
  assert.equal(taste.requiredAnchors.find(anchor => anchor.ref === taste.renderStyles[0].ref).preset, 'ink');
  const dna = fixtureDna({ input: taste, character: ember, measures: emberMeasures, measured: true, sketch, deltaE, tracks });
  assert.ok(!(await call('game_write_file', { path: 'game-dna.json', content: dna })).isError);
  const { scene, ...bare } = emberRaw;
  void scene;
  assert.ok((await call('game_write_file', { path: 'character.json', content: JSON.stringify(bare) })).isError, 'a run with art direction needs the scene');
  assert.ok(!(await call('game_write_file', { path: 'character.json', content: JSON.stringify(emberRaw) })).isError);
  const check = (await call('game_check_character')).content[0].text;
  assert.match(check, /Moment: a #13253a to #e8845a sky over #5f9c96 cloud and #1d2630 basalt, embers at density 0\.55, fog 0\.15, pagoda beacons; drawn in ink and paper \("ink"\); music red-moonlight-extended-mix-pokki-dj at volume 0\.5\./u);
  assert.match(check, /DNA conformance: score 1 /u);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a swap pair keeps the brief and the prompt and swaps the measured profile', async () => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-swap-'));
  const record = await runPair({ brief, mode: 'dry-run', pairId: 'swap-pair', runsRoot, swap: { profile: await fixtureProfile(), from: 'fixture-source' } });
  assert.equal(record.status, 'completed', record.error);
  assert.deepEqual(record.arms.map(arm => `${arm.key}:${arm.label}`), ['qloo-on:Qloo on', 'qloo-swap:Swapped profile']);
  assert.deepEqual([record.protocol.swap.from, record.arms[1].profileFrom, record.swap.reusedFrom], ['fixture-source', 'fixture-source', 'fixture-source']);
  assert.deepEqual(record.comparison.labels, { baseline: 'Qloo on', qloo: 'Swapped profile' });
  assert.match(record.comparison.dataHeadline, /The two profiles share/u);
  const config = key => JSON.parse(fss.readFileSync(path.join(runsRoot, 'swap-pair', 'work', key, 'host', 'config.json'), 'utf8'));
  assert.deepEqual([config('qloo-on').mode, config('qloo-swap').mode], ['qloo', 'qloo']);
  assert.ok(fss.existsSync(path.join(runsRoot, 'swap-pair', 'qloo-swap.json')));
  await fs.rm(runsRoot, { recursive: true, force: true });
  // A recorded profile read for another brief counts only that brief's names as named in it.
  const recorded = { entities: [{ name: 'Fixture Film: Lantern Parade', domain: 'movie', knownFromBrief: true }, { name: 'Fixture Game: Pocket Quest', domain: 'videogame' }, { name: 'Colorful', domain: 'qualities' }] };
  const read = forBrief(recorded, { references: [{ name: 'Fixture Game: Pocket Quest' }], knownNames: [] });
  assert.deepEqual(read.entities.map(entity => Boolean(entity.knownFromBrief)), [false, true, false]);
});

test('an ablation pair turns the departure rule off in both arms and says so', async () => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-ablation-'));
  const record = await runPair({ brief, mode: 'dry-run', pairId: 'ablation-pair', runsRoot, departure: false });
  assert.equal(record.status, 'completed', record.error);
  assert.equal(record.protocol.departure, false);
  assert.equal(record.comparison.ablation, 'departure');
  assert.match(record.comparison.limitation, /The departure rule was off in this pair/u);
  for (const key of ['qloo-off', 'qloo-on']) assert.equal(JSON.parse(fss.readFileSync(path.join(runsRoot, 'ablation-pair', 'work', key, 'host', 'config.json'), 'utf8')).departure, false);
  await fs.rm(runsRoot, { recursive: true, force: true });
});

test('a place and an age band weight every taste request and reach both arms', async () => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-audience-'));
  const sent = [], base = fixtureQlooClient();
  const qlooClient = { ...base, async getInsights(input) { sent.push(input); return base.getInsights(input); } };
  const record = await runPair({ brief, mode: 'dry-run', pairId: 'audience-pair', runsRoot, qlooClient, audience: { location: 'Lisbon, Portugal', age: '24_and_younger' } });
  assert.equal(record.status, 'completed', record.error);
  assert.deepEqual(record.protocol.audience, { location: 'Lisbon, Portugal', age: ['24_and_younger'] });
  assert.deepEqual([record.taste.location, record.taste.age], ['Lisbon, Portugal', ['24_and_younger']]);
  assert.ok(sent.length && sent.every(input => input.location === 'Lisbon, Portugal' && input.age?.[0] === '24_and_younger'), JSON.stringify(sent.slice(0, 2)));
  const briefFile = JSON.parse(fss.readFileSync(path.join(runsRoot, 'audience-pair', 'work', 'qloo-off', 'files', 'brief.json'), 'utf8'));
  assert.deepEqual(briefFile.audience, record.protocol.audience);
  await fs.rm(runsRoot, { recursive: true, force: true });
  assert.throws(() => normalizeAudience({ age: 'teenagers' }), /age: use 1-3 of/u);
  assert.throws(() => normalizeAudience({ location: '<b>Lisbon</b>' }), /location/u);
  assert.equal(normalizeAudience({ location: ' ', age: '' }), null);
  assert.deepEqual(normalizeAudience({ age: '36_to_55,55_and_older' }), { age: ['36_to_55', '55_and_older'] });
});

test('a profile recorded before art styles is read again from its own responses, with no request', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-dusk-replay-'));
  const evidence = [];
  const references = [{ name: 'Fixture reference one', role: 'audience' }];
  const old = await buildTasteProfile({ client: fixtureQlooClient(), references, domains: GAME_DOMAINS.filter(domain => domain !== 'art_style'), retryDelayMs: 0,
    onEvidence: item => evidence.push({ ...item, id: `Q${String(evidence.length + 1).padStart(3, '0')}` }) });
  assert.ok(!old.entities.some(entity => entity.domain === 'art_style'));
  await fs.writeFile(path.join(dir, 'taste.json'), JSON.stringify({ profile: old, calls: [], evidence }));
  await fs.writeFile(path.join(dir, 'pair.json'), JSON.stringify({ brief: { references } }));
  const { profile: replayed, from } = await loadRecordedProfile(path.join(dir, 'taste.json'), 'old-pair');
  assert.equal(from, 'old-pair');
  assert.deepEqual(replayed.entities.filter(entity => entity.domain === 'art_style').map(entity => entity.name), ['Hand-Drawn', 'Pixel Art']);
  assert.deepEqual(replayed.replayed.missing, []);
  assert.equal(replayed.calls, old.calls);
  await assert.rejects(loadRecordedProfile(path.join(dir, 'missing.json'), 'nothing'), /nothing has no recorded taste profile/u);
  await fs.rm(dir, { recursive: true, force: true });
});

test('the music library: tracks carry qualities by word or stem, and only listed files are served, in byte ranges', () => {
  const track = id => tracks.find(item => item.id === id);
  assert.deepEqual(sharedMoods(track('piano-jams-razvan-veina'), ['Melancholy']), ['melancholy']);
  assert.deepEqual(sharedMoods(track('sad-piano-alexander-blu'), ['Sentimentality', 'Upbeat']), ['sentimentality']);
  // Catalogue words that say nothing about a mood never match.
  assert.deepEqual(sharedMoods(track('piano-jams-razvan-veina'), ['Music', 'Film']), []);
  assert.deepEqual(sharedMoods(track('a-melancholical-hero-daniel-bautista'), ['Films', 'Battle Royale']), []);
  // A close form is about as long: Classic Lines, a look tag, does not meet the instrument tag classicalguitar.
  assert.deepEqual(sharedMoods(track('white-beach-christian-petermann'), ['Classic Lines']), []);
  assert.deepEqual(sharedMoods(track('white-beach-christian-petermann'), ['Romance']), ['romance']);
  assert.equal(tracksFor(tracks, ['Energetic'])[0].moods[0], 'energetic');
  assert.deepEqual(byteRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.equal(byteRange('bytes=200-', 100), false);
  assert.equal(byteRange('bytes=0-1,5-6', 100), null);
  assert.equal(byteRange(undefined, 100), null);
  assert.equal(musicLibraryFile(repo, library, 'music/catalog.json').type, 'application/json; charset=utf-8');
  assert.equal(musicLibraryFile(repo, library, `music/${library.tracks[0].file}`).type, 'audio/mpeg');
  for (const bad of ['music/not-listed.mp3', 'music/../.env', 'music/catalog.json.bak', 'fonts/eb-garamond-latin-wght-normal.woff2']) assert.equal(musicLibraryFile(repo, library, bad), null, bad);
  assert.ok(library.tracks.every(item => /^CC(?:0| BY)/u.test(item.license) && item.attribution && MUSIC_PATH.test(`music/${item.file}`) && fss.existsSync(path.join(repo, 'library', 'music', item.file))));
});
