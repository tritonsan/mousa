// A Qloo off/on pair for one playable character. Without flags it prints the plan and what is ready, and makes no
// request. --dry-run plays both arms through the real design server with a fixture Qloo client and the two hand-made
// samples. --run makes the live pair: one host Qloo taste pass (at most 24 requests), then one Kiro run per arm with
// the same model, prompt and tools, and up to two Codex portraits per arm. The Studio runs the same pair as a job.
// Both arms design the character and the moment's art direction: the scene, the render style and the music.
// --paint=1 lets each arm paint its checked drawing as finished game art: one Codex edit of a host blueprint per arm;
// --paint=2 allows a second edit. The dry run paints with a fixture painter and makes no request.
//
// Both arms run the universal protocol's production stages: a taste reading before the DNA, a production plan that
// chooses how each device is made from the capability list both arms share (so portraits and painting are methods a
// plan may choose, within the limits above), and a review of captures of the checked character in the game's own
// pages, opened with Kiro's read tool. --require=painted-rig (or portrait) makes a method a study setting both arms
// must use; --no-production runs the earlier protocol without these stages.
//
//   node game/harness/run-pair.mjs [--brief=game/harness/briefs/long-dusk.json] [--dry-run | --run]
//     [--portraits=0..2] [--paint=0..2] [--profile-from=<pair-id>] [--timeout-minutes=35]
//     [--location="Lisbon, Portugal"] [--age=24_and_younger] [--no-departure] [--swap-from=<pair-id>]
//     [--require=painted-rig,portrait] [--capture=browser|fixture|off] [--no-production]
//
// --location and --age weight the taste pass toward a place and an age band and tell both arms the brief's audience.
// --no-departure leaves the sketch-departure rule out of both arms (an ablation). --swap-from keeps the brief and
// swaps the data: Qloo on with this brief's profile, then Qloo on with the recorded profile of another pair.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, getConfig, redact } from '../../src/config.mjs';
import { QlooClient, QLOO_AGE_BANDS } from '../../plugin/server/qloo/client.mjs';
import { buildTasteProfile, selectTasteReferences, normalizeTasteDomains, predictionMatches, isTagDomain, isQualityDomain, QUALITY_DOMAIN, ART_STYLE_DOMAIN } from '../../plugin/server/culture/taste.mjs';
import { replayTasteProfile } from '../../src/taste-replay.mjs';
import { inspectCodex } from '../../src/image-generator.mjs';
import { normalizeCharacter } from '../src/format.js';
import { measureCharacter } from './measure.mjs';
import { restRaster } from './raster.mjs';
import { formatGuide } from './guide.mjs';
import { makeCharacterPrompt } from './prompt.mjs';
import { normalizeCharacterSketch, checkCharacterConformance, characterSketchDivergence, compareCharacterRuns, characterDecisions, qualityFacts, deltaE, CHARACTER_LIMITS } from './protocol.mjs';
import { loadMusicLibrary, musicListing } from './music.mjs';
import { MUSIC_FILE } from './session.mjs';
import { runKiro } from './kiro.mjs';
import { connect } from './mcp-client.mjs';
import { GAME_DOMAINS, GAME_MEDIUM, fixtureQlooClient, fixtureAssumption, fixtureDna, fixtureReading, fixturePlan, fixtureReview } from './fixtures.mjs';
import { inspectBrowser, verifyBrowser } from '../../plugin/server/production/capture.mjs';
import { compareProduction } from '../../plugin/server/production/compare.mjs';
import { gameCapabilities, readingLayers, CAPABILITIES_FILE, REVIEW_DIR, GAME_MEDIUM_ID } from './production.mjs';
import { auditReviews } from '../../src/kiro-session-audit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(here, '..');
const rootDir = path.resolve(gameDir, '..');
export const ARMS = Object.freeze([
  Object.freeze({ key: 'qloo-off', mode: 'baseline', label: 'Qloo off' }),
  Object.freeze({ key: 'qloo-on', mode: 'qloo', label: 'Qloo on' }),
]);
// A swap pair keeps the brief, the prompt and the protocol and changes only the measured profile, so a difference
// between its arms can only come from the data: Qloo on with this brief's profile, then with another pair's.
export const SWAP_ARMS = Object.freeze([
  Object.freeze({ key: 'qloo-on', mode: 'qloo', label: 'Qloo on' }),
  Object.freeze({ key: 'qloo-swap', mode: 'qloo', label: 'Swapped profile' }),
]);
export const PAIR_ID_PATTERN = /^[a-z0-9-]{1,60}$/u;
/** How an age band reads in the prompt: 36_to_55 is "36 to 55". */
export const ageLabel = ages => (Array.isArray(ages) ? ages : [ages]).filter(Boolean).map(band => band.replaceAll('_', ' ')).join(' or ');
// Model time per arm; portrait and painting waits do not count. The production stages add the reading, the plan and
// up to two review rounds to the run.
export const CHARACTER_RUN_TIMEOUT_MS = 35 * 60000;
export const CAPTURE_MODES = Object.freeze(['browser', 'fixture', 'off']);
const CAPTURE_ID = /^r[1-3]-(?:pose|walk|scene|kindle)$/u;

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const option = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);
export const pairStamp = (date = new Date()) => `pair-${date.toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15).toLowerCase()}`;

/** A brief as the runner uses it: a name, the text, up to eight references and names the brief already gives. */
export function normalizeBrief(brief, source = 'The brief') {
  if (!brief || typeof brief.name !== 'string' || typeof brief.brief !== 'string' || brief.brief.length < 40 || !Array.isArray(brief.references) || !brief.references.length) {
    throw new Error(`${source} needs a name, a brief of at least 40 characters and at least one reference.`);
  }
  return { name: brief.name.slice(0, 200), brief: brief.brief.slice(0, 3500), references: brief.references.slice(0, 8).map(ref => ({ name: String(ref.name).slice(0, 200), role: ref.role || 'audience', ...(ref.origin ? { origin: ref.origin } : {}) })),
    knownNames: Array.isArray(brief.knownNames) ? brief.knownNames.filter(name => typeof name === 'string') : [] };
}

export async function loadBrief(file) {
  return normalizeBrief(await readJson(file), file);
}

/** The world every arm shares, and the keeper's measured height for the format guide and the check tool. */
export async function loadWorld() {
  const canon = await readJson(path.join(gameDir, 'world', 'canon.json'));
  const keeper = normalizeCharacter(await readJson(path.join(gameDir, 'characters', 'maren.json')), { npc: true });
  return { canon, keeper: { name: keeper.name, figureHeight: measureCharacter(keeper).figureHeight } };
}

/**
 * An arm directory: files/ the model may read, host/ for the session's config, the profile and its record. With art
 * direction the arm designs the scene and the render style as well, and with a music library (`music`, the catalog)
 * the track from music.json. `departure: false` is the ablation; `audience` the brief's place and age band.
 * `production` ({capabilities, capture, browser}) adds the production stages: the capability list the model reads as
 * capabilities.json, and how the host captures the character for its review.
 */
export async function prepareArm({ dir, arm, brief, world, domains, profile = null, portraits = null, codex = null, artDirection = true, music = null, departure = true, audience = null, paint = null, pairId = 'dry-run', production = null }) {
  const files = path.join(dir, 'files'), host = path.join(dir, 'host');
  const library = artDirection && music?.tracks?.length ? music : null;
  await fs.mkdir(files, { recursive: true });
  await fs.mkdir(host, { recursive: true });
  await fs.writeFile(path.join(files, 'brief.json'), JSON.stringify({ name: brief.name, brief: brief.brief, references: brief.references, ...(audience ? { audience } : {}),
    fixedFacts: { name: world.canon.character.name, role: world.canon.character.role, abilities: world.canon.character.abilities, rules: world.canon.character.rules } }, null, 2));
  await fs.writeFile(path.join(files, 'canon.json'), JSON.stringify(world.canon, null, 2));
  await fs.writeFile(path.join(files, 'format.md'), formatGuide({ canon: world.canon, keeperHeight: world.keeper.figureHeight, artDirection, music: Boolean(library) }));
  await fs.copyFile(path.join(here, 'mannequin.json'), path.join(files, 'mannequin.json'));
  if (library) await fs.writeFile(path.join(files, MUSIC_FILE), JSON.stringify(musicListing(library), null, 2));
  if (production) await fs.writeFile(path.join(files, CAPABILITIES_FILE), JSON.stringify(production.capabilities, null, 2));
  // A painted arm names its pictures by the paths the pair publishes them under, runs/<pair>/<arm>-skin-<piece>.png.
  await fs.writeFile(path.join(host, 'config.json'), JSON.stringify({ arm: arm.key, mode: arm.mode, domains, medium: [...GAME_MEDIUM], requiredAnchorCount: CHARACTER_LIMITS.requiredAnchors,
    portraits, codex, knownNames: [...brief.references.map(ref => ref.name), ...brief.knownNames], keeper: world.keeper,
    artDirection, departure, music: Boolean(library), ...(audience ? { audience } : {}),
    ...(paint ? { paint: { perRun: paint.perRun, prefix: `runs/${pairId}/${arm.key}`, ...(paint.fixture ? { fixture: true } : {}) } } : {}),
    ...(production ? { production: { medium: GAME_MEDIUM_ID, required: production.capabilities.required, capture: production.capture || null, ...(production.browser ? { browser: production.browser } : {}) } } : {}) }, null, 2));
  if (arm.mode === 'qloo') await fs.writeFile(path.join(host, 'profile.json'), JSON.stringify(profile, null, 2));
}

/** The track IDs an arm could pick, or null when it had no music library. */
async function armTracks(dir, config) {
  if (!config.music) return null;
  try { return (await readJson(path.join(dir, 'files', MUSIC_FILE))).tracks || []; } catch { return null; }
}

/** What the host can say about one finished arm, recomputed from the saved files rather than the model's last check. */
export async function collectArm({ dir, arm, world, portraitsEnabled }) {
  let state;
  try { state = await readJson(path.join(dir, 'host', 'session.json')); }
  catch { return { status: 'failed', error: 'The design session left no record.' }; }
  const config = await readJson(path.join(dir, 'host', 'config.json')).catch(() => ({}));
  const tracks = await armTracks(dir, config);
  const problems = [];
  if (!state.assumption) problems.push('no prediction (game-assumption.json) was saved before the taste input');
  if (!state.pipeline?.revealedAt) problems.push('the taste input was never read with game_get_taste');
  if (!state.dna) problems.push('no valid game-dna.json was saved');
  let raw = null, character = null;
  try {
    raw = await fs.readFile(path.join(dir, 'files', 'character.json'), 'utf8');
    character = normalizeCharacter(raw, { canon: world.canon, strict: true, artDirection: Boolean(config.artDirection), tracks: tracks ? tracks.map(track => track.id) : null });
  } catch (error) { problems.push(raw === null ? 'no character.json was saved' : `character.json is not valid: ${error.message}`); }
  if (problems.length) return { status: 'failed', error: `The taste-led protocol was not completed: ${problems.join('; ')}.`, state };
  const raster = restRaster(character);
  const measures = measureCharacter(character, { raster, keeper: world.keeper });
  // A plan's portrait method is what makes an imagery device a portrait; other imagery devices are drawn.
  const portraitDevices = state.plan ? new Set(Object.keys(state.plan.uses?.generators?.portrait?.devices || {})) : null;
  const conformance = checkCharacterConformance(state.dna, character, { measures, portraits: portraitsEnabled ? state.portraits : null, ...(portraitDevices ? { portraitDevices } : {}) });
  const divergence = characterSketchDivergence(state.assumption.characterSketch, character, measures);
  return { status: 'completed', state, raw, character, measures, conformance, divergence, ...(state.production ? { review: await reviewAudit({ dir, state }) } : {}) };
}

/**
 * The host's account of an arm's review, after the run: which cited captures the Kiro session opened with its read
 * tool, read from the session record Kiro kept, and what changed after the last review. A scripted dry run has no
 * session record, so its review is unaudited.
 */
export async function reviewAudit({ dir, state }) {
  const paintings = (state.paint || []).filter(item => item.status === 'painted').length;
  return auditReviews({ home: path.join(dir, 'kiro-home'), reviews: state.reviews || [], captures: state.captures || [],
    changed: review => ({ character: Boolean(state.character?.hash && review.after?.character !== state.character.hash), painting: paintings > (review.after?.paintings ?? 0) }) });
}

const entityView = (input, ref) => {
  const entity = input.entities.find(item => item.ref === ref);
  return entity ? { ref, name: entity.name, domain: entity.domain, source: entity.source, ...qualityFacts(entity),
    ...(entity.source === 'qloo' ? { surprise: Boolean(entity.surprise), predictedByModel: Boolean(entity.predictedByModel) } : {}) } : { ref };
};
/**
 * The qualities, ranked tags and art styles a run designed from: measured ones in Qloo on, its own predicted ones in
 * Qloo off, with the render styles the art styles name, strongest first.
 */
const qualityViews = input => {
  const own = input.source === 'qloo-profile' ? 'qloo' : 'model-assumption';
  const of = test => input.entities.filter(entity => test(entity.domain) && entity.source === own).map(entity => entityView(input, entity.ref));
  return { qualities: of(domain => domain === QUALITY_DOMAIN), tags: of(isTagDomain), artStyles: of(domain => domain === ART_STYLE_DOMAIN),
    ...(Array.isArray(input.renderStyles) ? { renderStyles: input.renderStyles } : {}) };
};

/** The credit a played track needs, from the library's catalog: CC BY asks for the title, the artist, the licence and the source. */
export function trackCredit(library, id) {
  const track = id ? library?.tracks?.find(item => item.id === id) : null;
  return track ? { id: track.id, title: track.title, artist: track.artist, license: track.license, ...(track.licenseUrl ? { licenseUrl: track.licenseUrl } : {}), source: track.source,
    ...(track.sourceUrl ? { sourceUrl: track.sourceUrl } : {}), ...(track.artistUrl ? { artistUrl: track.artistUrl } : {}), attribution: track.attribution, file: `music/${track.file}`,
    genres: track.genres, tags: track.tags } : null;
}

// How the two arms chose to make their characters is the protocol's own comparison of their plans and reviews.
export { compareProduction };

/**
 * What the pair record keeps of an arm's production stages: its reading of the taste input with each ref's name, its
 * production plan, its reviews with the captures they cite (as published beside the record) and the host's audit.
 */
function productionRecord(state, { captures = [], audit = null } = {}) {
  if (!state?.production) return null;
  const named = ref => { const view = entityView(state.input, ref); return { ref, ...(view.name ? { name: view.name, domain: view.domain, source: view.source } : {}), ...(view.surprise ? { surprise: true } : {}) }; };
  const reading = state.reading && { clusters: state.reading.clusters.map(cluster => ({ ...cluster, refs: cluster.refs.map(named) })),
    setAside: state.reading.setAside.map(item => ({ ...named(item.ref), reason: item.reason })), approach: state.reading.approach, coverage: state.reading.coverage, stats: state.reading.stats };
  const plan = state.plan && { steps: state.plan.steps, review: state.plan.review, uses: state.plan.uses, stats: state.plan.stats };
  const reviews = (state.reviews || []).map(({ round, criteria, summary, stats, audited, opened, savedAt, repairs }) => ({ round, criteria, summary, stats, audited, ...(opened ? { opened } : {}), savedAt, ...(repairs ? { repairs } : {}) }));
  return { required: state.production.required, capture: state.production.capture, rounds: state.production.rounds,
    ...(reading ? { reading } : {}), ...(plan ? { plan } : {}), reviews, captures, ...(audit ? { audit } : {}) };
}

/** The per-arm part of pair.json: what the comparison page shows and what a reviewer needs to trace it. */
function armRecord({ arm, result, pairId, durationMs, portraits, library = null, profileFrom = null, figure = null, captures = [] }) {
  const base = { key: arm.key, label: arm.label, mode: arm.mode, status: result.status, ...(profileFrom ? { profileFrom } : {}), ...(result.error ? { error: result.error } : {}), ...(result.runError ? { runError: result.runError } : {}), ...(durationMs ? { durationMs } : {}) };
  const state = result.state;
  if (!state) return base;
  const paint = paintRecord(state, figure);
  const production = productionRecord(state, { captures, audit: result.review || null });
  const record = { ...base, calls: state.calls, checks: state.checks, events: state.events.slice(-40),
    ...(state.assumption ? { audienceSummary: state.assumption.audienceSummary, predictions: state.assumption.entries.length, sketch: state.assumption.characterSketch } : {}),
    ...(state.input ? { taste: { source: state.input.source, metrics: state.input.metrics, requiredAnchors: state.input.requiredAnchors.map(ref => entityView(state.input, ref)), ...qualityViews(state.input) } } : {}),
    ...(state.dna ? { dna: { thesis: state.dna.thesis, devices: characterDecisions(state.dna, state.input).map(device => ({ ...device, tokens: state.dna.devices.find(item => item.id === device.id).tokens, ...(state.dna.devices.find(item => item.id === device.id).surprise ? { surprise: true } : {}) })),
      rejected: state.dna.rejected.map(item => ({ ...item, name: entityView(state.input, item.ref).name })), stats: state.dna.stats } } : {}),
    ...(production ? { production } : {}),
    portraits: portraits.map(item => ({ ...item })), ...(paint ? { paint } : {}) };
  if (result.status !== 'completed') return record;
  const { silhouette, bones, ...measures } = result.measures;
  void silhouette; void bones;
  const music = trackCredit(library, result.character.music?.track);
  return { ...record, character: `runs/${pairId}/${arm.key}.json`, ...(music ? { music: { ...music, volume: result.character.music.volume } } : {}), measures: { ...measures, warnings: measures.warnings.map(item => item.message) },
    conformance: { score: result.conformance.score, present: result.conformance.present, partial: result.conformance.partial, missing: result.conformance.missing, total: result.conformance.total,
      devices: result.conformance.devices.map(device => ({ id: device.id, status: device.status, missing: device.missing })), limitation: result.conformance.limitation }, divergence: result.divergence };
}

/** What the pair record keeps of an arm's painting requests: the plan the model gave, the host's prompt and the outcome. */
function paintRecord(state, figure = null) {
  const requests = state?.paint || [];
  if (!requests.length) return null;
  const done = requests.find(item => item.status === 'painted');
  const item = done || requests.at(-1);
  return { status: done ? 'painted' : item.status, technique: item.technique, style: item.style, descriptions: item.descriptions || {}, attempts: requests.length,
    ...(item.prompt ? { prompt: item.prompt } : {}), ...(item.description ? { description: item.description } : {}), ...(item.durationMs ? { durationMs: item.durationMs } : {}),
    ...(done ? { pieces: done.pieces, vector: done.vector || [], moved: done.moved || [] } : {}), ...(item.error ? { error: item.error } : {}),
    provider: item.provider || null, version: item.version || null, ...(figure ? { figure } : {}) };
}

/**
 * Publishes an arm's painted skin beside the pair record, where the game's server can serve it: each piece as
 * <arm>-skin-<piece>.png and the standing figure as <arm>-figure.png. Returns the skin and the figure's path, or null.
 */
async function publishSkin({ dir, arm, runsDir, pairId, state }) {
  if (!(state?.paint || []).some(item => item.status === 'painted')) return null;
  let saved;
  try { saved = await readJson(path.join(dir, 'host', 'skin.json')); } catch { return null; }
  if (!saved?.skin || !/^skin\/paint-\d$/u.test(saved.folder || '')) return null;
  for (const { id, file } of saved.files || []) {
    if (!/^[a-z0-9-]{1,60}$/u.test(id) || file !== `${id}.png`) return null;
    await fs.copyFile(path.join(dir, saved.folder, file), path.join(runsDir, `${arm.key}-skin-${id}.png`));
  }
  const figure = saved.figure === 'figure.png' ? `${arm.key}-figure.png` : null;
  if (figure) await fs.copyFile(path.join(dir, saved.folder, 'figure.png'), path.join(runsDir, figure));
  return { skin: saved.skin, figure: figure ? `runs/${pairId}/${figure}` : null };
}

/** Copies each generated portrait next to the pair record, where the game's server can serve it. */
async function publishPortraits({ dir, arm, runsDir, pairId, state }) {
  const published = [];
  for (const [index, item] of (state?.portraits || []).entries()) {
    if (item.status !== 'generated' || !/^generated\/[a-z0-9][a-z0-9_-]{0,60}\.(?:jpg|png)$/u.test(item.path || '')) {
      published.push({ device: item.device, subject: item.subject, status: item.status, ...(item.error ? { error: item.error } : {}) });
      continue;
    }
    const name = `${arm.key}-portrait-${index + 1}${path.extname(item.path)}`;
    await fs.copyFile(path.join(dir, item.path), path.join(runsDir, name));
    published.push({ path: `runs/${pairId}/${name}`, device: item.device, subject: item.subject, aspect: item.aspect, prompt: item.prompt, width: item.width, height: item.height,
      description: item.description, durationMs: item.durationMs, provider: item.provider, version: item.version, status: 'generated', ...(Array.isArray(item.palette) ? { palette: item.palette } : {}) });
  }
  return published;
}

/** Copies each review capture next to the pair record as <arm>-review-<id>.png, so the comparison can show what the model judged. */
async function publishCaptures({ dir, arm, runsDir, pairId, state }) {
  const published = [];
  for (const capture of state?.captures || []) {
    if (!CAPTURE_ID.test(capture.id || '') || capture.path !== `${REVIEW_DIR}/${capture.id}.png`) continue;
    const name = `${arm.key}-review-${capture.id}.png`;
    try { await fs.copyFile(path.join(dir, 'workspace', REVIEW_DIR, `${capture.id}.png`), path.join(runsDir, name)); } catch { continue; }
    published.push({ id: capture.id, view: capture.view, round: capture.round, path: `runs/${pairId}/${name}`, width: capture.width, height: capture.height, ...(capture.paintings ? { painted: true } : {}) });
  }
  return published;
}

/**
 * The dry run's stand-in for Kiro: the same tool calls a model makes, through the real design server. Qloo off draws
 * the ash pilgrim and every measured arm the ember tinker, a swapped profile included. With production stages it
 * saves a fixture reading and plan around the fixture DNA, paints when its plan paints, and reviews one round of
 * captures without judging them.
 */
export async function scriptArm({ dir, arm, world }) {
  const sample = arm.mode === 'qloo' ? 'sample-b.json' : 'sample-a.json';
  const client = await connect({ dir });
  const write = async (file, content) => {
    const saved = await client.call('game_write_file', { path: file, content });
    if (saved.isError) throw new Error(saved.text);
  };
  try {
    await client.call('game_read_file', { path: 'format.md' });
    const listed = await client.call('game_read_file', { path: MUSIC_FILE });
    const tracks = listed.isError ? null : JSON.parse(listed.text).tracks;
    const offered = await client.call('game_read_file', { path: CAPABILITIES_FILE });
    const capabilities = offered.isError ? null : JSON.parse(offered.text);
    const assumption = fixtureAssumption();
    await write('game-assumption.json', assumption);
    const taste = await client.call('game_get_taste', {});
    const raw = await fs.readFile(path.join(gameDir, 'samples', sample), 'utf8');
    const character = normalizeCharacter(raw, { canon: world.canon, strict: true });
    const dna = fixtureDna({ input: taste.value, character, measures: measureCharacter(character), measured: arm.mode === 'qloo', sketch: normalizeCharacterSketch(JSON.parse(assumption).characterSketch), deltaE, tracks });
    let plan = null;
    if (capabilities) {
      // The reading carries the layers the run requires, which are the required layers among the DNA's own.
      const own = new Set(JSON.parse(dna).devices.map(device => device.layer));
      const reading = fixtureReading({ input: taste.value, dna, layers: readingLayers({ artDirection: true, music: true }).filter(layer => own.has(layer)) });
      await write('game-reading.json', reading);
      await write('game-dna.json', dna);
      plan = fixturePlan({ dna, reading, capabilities });
      await write('game-production.json', plan);
    } else await write('game-dna.json', dna);
    await write('character.json', raw);
    await client.call('game_check_character', {});
    const tools = new Set((await client.tools()).map(tool => tool.name));
    // A painted dry run paints with the fixture painter, which hands the blueprint back unpainted.
    if (tools.has('game_paint_character') && (!plan || JSON.parse(plan).steps.some(step => step.method === 'painted-rig'))) {
      const painted = await client.call('game_paint_character', { style: 'Fixture painting: the flat blueprint colours, handed back unpainted by the fixture painter.' });
      if (painted.isError) throw new Error(painted.text);
    }
    if (plan && tools.has('game_capture_review')) {
      const captured = await client.call('game_capture_review', {});
      if (captured.isError) throw new Error(captured.text);
      await write('game-review.json', fixtureReview({ plan, captures: captured.value.captures, round: captured.value.round }));
    }
  } finally { await client.close(); }
}

/**
 * Follows an arm's host session record while the model works: new session events go to onEvents, and while a
 * portrait or the pieces are being painted the run's deadline is paused, since that wait is the host's, not the model's.
 */
export function watchSession({ dir, onEvents = () => {}, every = 1000 }) {
  const file = path.join(dir, 'host', 'session.json');
  let seen = 0, waiting = false, wait = null, stopped = false, timer = null, running = null;
  const read = async () => {
    try {
      const state = JSON.parse(await fs.readFile(file, 'utf8'));
      const events = Array.isArray(state.events) ? state.events : [];
      if (events.length > seen) { const fresh = events.slice(seen); seen = events.length; onEvents(fresh); }
      const painting = [...(state.portraits || []), ...(state.paint || [])].some(item => item.status === 'requested');
      if (wait && painting !== waiting) { waiting = painting; if (painting) wait.pause(); else wait.resume(); }
    } catch { /* The record is replaced atomically; before the first save there is nothing to read. */ }
  };
  const tick = async () => { running = read(); await running; if (!stopped) timer = setTimeout(tick, every); };
  timer = setTimeout(tick, every);
  return {
    register(handle) { wait = handle; },
    async stop() { stopped = true; clearTimeout(timer); await running; await read(); },
  };
}

/**
 * A taste profile an earlier pair recorded in its taste.json, to reuse or to swap in without a Qloo request. A profile
 * recorded before the art style domain is read again from its own recorded responses with today's taste pass, which
 * derives its art styles; its pair.json supplies the references. No request is made either way.
 */
export async function loadRecordedProfile(file, from) {
  let source;
  try { source = await readJson(file); } catch { throw new Error(`${from} has no recorded taste profile.`); }
  if (!source?.profile || !Array.isArray(source.profile.entities) || source.profile.status !== 'ok') throw new Error(`${from} has no usable recorded taste profile.`);
  const profile = source.profile;
  // The recorded responses travel with the profile, so a pair that reuses it can be replayed from its own folder.
  const evidence = Array.isArray(source.evidence) ? source.evidence : [];
  if (!(profile.domains || []).includes(ART_STYLE_DOMAIN) && evidence.length) {
    const pair = await readJson(path.join(path.dirname(file), 'pair.json')).catch(() => null);
    if (Array.isArray(pair?.brief?.references) && pair.brief.references.length) {
      const { profile: replayed, missing } = await replayTasteProfile({ evidence, references: selectTasteReferences(pair.brief.references).references,
        domains: normalizeTasteDomains(GAME_DOMAINS), location: profile.location, age: profile.age, knownNames: profile.entities.filter(entity => entity.knownFromBrief).map(entity => entity.name) });
      if (replayed.status === 'ok') return { profile: { ...replayed, replayed: { recordedDomains: profile.domains || [], missing } }, from, evidence };
    }
  }
  return { profile, from, evidence };
}

/** A recorded profile read for another brief: an entity counts as named in the brief only when this brief names it. */
export function forBrief(profile, brief) {
  const known = [...brief.references.map(ref => ref.name), ...(brief.knownNames || [])];
  return { ...profile, entities: profile.entities.map(entity => {
    const { knownFromBrief, ...rest } = entity;
    void knownFromBrief;
    return !isQualityDomain(entity.domain) && known.some(name => predictionMatches(name, entity.name)) ? { ...rest, knownFromBrief: true } : rest;
  }) };
}

/**
 * The audience a pair is weighted toward and tells both arms: a place and one to three Qloo age bands, each optional.
 * They are facts of the brief that the model cannot predict from its references, so they reach the data, not only the text.
 */
export function normalizeAudience(value) {
  if (!value) return null;
  const location = typeof value.location === 'string' ? value.location.trim().replace(/\s+/gu, ' ') : '';
  if (location && (location.length < 2 || location.length > 120 || /[<>{}\p{Cc}]/u.test(location))) throw new Error('location: name a city, region or country in 2-120 characters.');
  const raw = value.age === undefined || value.age === null || value.age === '' ? [] : Array.isArray(value.age) ? value.age : String(value.age).split(',');
  const age = [...new Set(raw.map(item => String(item).trim()).filter(Boolean))];
  if (age.length > 3 || age.some(band => !QLOO_AGE_BANDS.includes(band))) throw new Error(`age: use 1-3 of ${QLOO_AGE_BANDS.join(', ')}.`);
  return location || age.length ? { ...(location ? { location } : {}), ...(age.length ? { age } : {}) } : null;
}
const audienceText = audience => [audience.location, audience.age ? `ages ${ageLabel(audience.age)}` : ''].filter(Boolean).join(' and ');

/**
 * One character pair. `qlooClient` replaces the live client (the dry run uses the fixture client), `runArm` replaces
 * Kiro (the dry run plays scriptArm), `signal` cancels between and during runs, `onEvent` receives
 * {arm, type, message, time} and `onArm` each arm's status as it changes. `reuse` ({profile, from}) or `profileFrom`
 * (a pair ID under runsRoot) skips the taste pass; `swap` ({profile, from}) makes a swap pair; `music` is the music
 * library's catalog (by default library/music; null for none); `departure: false` is the ablation; `audience` is
 * {location, age} for the taste pass and both prompts. `production` (on by default) adds the production stages:
 * `required` names methods a study requires of both arms, `capture` is how the host captures for the review
 * (browser, fixture for a dry run, or off), `browser` an inspectBrowser result, and `environment` local or hosted.
 */
export async function runPair({ brief, mode, portraitsPerArm = 0, paintPerArm = 0, codex = null, profileFrom = null, reuse = null, swap = null, artDirection = true, music, departure = true, audience = null,
  production = true, required = [], capture = mode === 'dry-run' ? 'fixture' : 'browser', browser = null, environment = 'local',
  timeoutMs = CHARACTER_RUN_TIMEOUT_MS, config = null, pairId = mode === 'dry-run' ? 'dry-run' : pairStamp(),
  runsRoot = path.join(gameDir, 'runs'), onEvent = () => {}, onArm = () => {}, qlooClient = null, runArm = null, signal = null }) {
  const world = await loadWorld();
  const domains = normalizeTasteDomains(GAME_DOMAINS);
  const library = artDirection ? (music === undefined ? await loadMusicLibrary(rootDir) : music) : null;
  const arms = swap ? SWAP_ARMS : ARMS;
  // Both arms paint alike: with Codex in a live pair, with the fixture painter (no request) in a dry run.
  const paint = paintPerArm > 0 && (mode === 'dry-run' || codex?.available)
    ? { perRun: Math.min(paintPerArm, CHARACTER_LIMITS.paintsPerRun), ...(mode === 'dry-run' ? { fixture: true } : {}) } : null;
  const portraits = portraitsPerArm > 0 && codex?.available ? { perRun: portraitsPerArm } : null;
  // Both arms read the same capability list, so the methods each plan chooses are the arm's own choice. The list is
  // made before the taste pass: a study that requires a method this host cannot run stops before any request.
  if (!CAPTURE_MODES.includes(capture)) throw new Error(`capture: use one of ${CAPTURE_MODES.join(', ')}.`);
  if (production && capture === 'fixture' && mode !== 'dry-run') throw new Error('A live pair captures its characters in a browser; fixture captures are for dry runs.');
  const found = production && capture === 'browser' ? (browser || await verifyBrowser(await inspectBrowser())) : null;
  const capturing = Boolean(production && (capture === 'fixture' || found?.available));
  const capabilities = production ? gameCapabilities({ portraits, paint, capture: capturing, required, environment,
    music: library ? { tracks: library.tracks.length, licenses: [...new Set(library.tracks.map(track => track.license).filter(Boolean))] } : null,
    reasons: { ...(portraitsPerArm > 0 && !portraits ? { portrait: codex?.reason || 'No image generator is available here to paint portraits.' } : {}),
      ...(paintPerArm > 0 && !paint ? { paint: codex?.reason || 'No image generator is available here to paint the characters.' } : {}),
      ...(capture === 'off' ? { capture: 'Capture is turned off for this pair, so there is no visual review.' } : found && !found.available ? { capture: found.reason } : {}) } }) : null;
  const runsDir = path.join(runsRoot, pairId);
  const secrets = config || {};
  const emit = (event) => onEvent({ arm: null, time: new Date().toISOString(), ...event, message: redact(String(event.message), secrets).slice(0, 600) });
  const recorded = reuse || (profileFrom ? await loadRecordedProfile(path.join(runsRoot, profileFrom, 'taste.json'), profileFrom) : null);
  // A reused profile was weighted by its own place and ages, so those are the audience both arms are told.
  const requested = normalizeAudience(audience);
  const located = recorded ? normalizeAudience({ location: recorded.profile.location, age: recorded.profile.age }) : requested;
  if (mode === 'dry-run') await fs.rm(runsDir, { recursive: true, force: true });
  await fs.mkdir(path.join(runsDir, 'work'), { recursive: true });
  const record = { schemaVersion: '1.0', pairId, kind: mode === 'dry-run' ? 'dry-run' : 'live', createdAt: new Date().toISOString(),
    brief: { name: brief.name, brief: brief.brief, references: brief.references }, model: mode === 'dry-run' ? 'scripted fixture (no model)' : config.model, effort: mode === 'dry-run' ? null : config.effort,
    protocol: { domains, medium: [...GAME_MEDIUM], requiredAnchors: CHARACTER_LIMITS.requiredAnchors, portraitsPerArm, paintPerArm: paint ? paint.perRun : 0, artDirection, departure,
      music: library ? { tracks: library.tracks.length, source: library.source, license: library.license } : null,
      ...(located ? { audience: located } : {}), ...(swap ? { swap: { from: swap.from } } : {}),
      ...(capabilities ? { production: { medium: GAME_MEDIUM_ID, environment: capabilities.environment, required: capabilities.required,
        capture: capturing ? capture : null, ...(capturing && found?.available ? { browser: found.label || found.name } : {}), rounds: capturing ? capabilities.review.capture.rounds : 0,
        methods: capabilities.methods.map(({ id, kind, layers, available, reason }) => ({ id, kind, layers, available, ...(reason ? { reason } : {}) })),
        ...(!capturing ? { captureReason: capabilities.review.capture.reason } : {}) } } : {}) }, arms: [] };
  const save = () => fs.writeFile(path.join(runsDir, 'pair.json'), redact(JSON.stringify(record, null, 2), secrets));
  const cancelled = () => {
    record.status = 'cancelled'; record.error = 'The pair was cancelled.'; record.finishedAt = new Date().toISOString();
    return save().then(() => record);
  };

  // The taste pass runs once, before any model run, so a thin profile stops the pair before anything is paid for.
  // Every response is kept in taste.json, so the pass can be replayed later without a request.
  let profile;
  if (recorded) {
    profile = { ...recorded.profile, reusedFrom: recorded.from };
    // The pair keeps the profile it designed from, so a later pair can reuse or swap it in from this folder too.
    await fs.writeFile(path.join(runsDir, 'taste.json'), redact(JSON.stringify({ profile, calls: [], evidence: recorded.evidence || [], reusedFrom: recorded.from }, null, 2), secrets));
    emit({ type: 'taste', message: `Reusing the recorded taste profile of ${recorded.from}${recorded.profile.replayed ? ', read again from its recorded responses with the current taste pass' : ''}; no Qloo request is made.` });
    if (requested && JSON.stringify(requested) !== JSON.stringify(located)) emit({ type: 'warning', message: 'The reused profile keeps the place and ages it was measured with; the requested audience was not applied.' });
  } else {
    const calls = [], evidence = [];
    const client = qlooClient || (mode === 'dry-run' ? fixtureQlooClient() : new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl }));
    const queried = domains.filter(domain => domain !== QUALITY_DOMAIN && domain !== ART_STYLE_DOMAIN).length;
    emit({ type: 'taste', message: `Host taste pass: resolving ${brief.references.length} references and querying ${queried} domains${located ? `, weighted toward ${audienceText(located)},` : ''} before any model run.` });
    profile = await buildTasteProfile({ client, references: selectTasteReferences(brief.references).references, domains, knownNames: brief.knownNames,
      ...(located?.location ? { location: located.location } : {}), ...(located?.age ? { age: located.age } : {}),
      ...(mode === 'dry-run' ? { retryDelayMs: 0 } : {}),
      onEvidence: item => {
        const id = `Q${String(evidence.length + 1).padStart(3, '0')}`;
        if (item.evidence && typeof item.evidence === 'object') item.evidence.id = id;
        evidence.push({ ...item, id, time: new Date().toISOString() });
      },
      onCall: call => { calls.push({ tool: call.tool, status: call.status, time: new Date().toISOString(), meta: call.meta, ...(call.evidenceId ? { evidenceId: call.evidenceId } : {}), ...(call.error ? { error: call.error } : {}) }); } });
    if (mode === 'dry-run') Object.assign(profile, { fixture: true, interpretation: 'Fixture profile for the dry run. It is not a Qloo result.', limitations: ['Fixture profile: no Qloo request was made.', ...profile.limitations] });
    await fs.writeFile(path.join(runsDir, 'taste.json'), redact(JSON.stringify({ profile, calls, evidence }, null, 2), secrets));
    const qualities = profile.entities.filter(entity => entity.domain === QUALITY_DOMAIN).length;
    emit({ type: 'taste', message: `Taste pass ${profile.status}: ${profile.entities.length - qualities} measured entities and tags${qualities ? ` and ${qualities} shared qualities` : ''} from ${profile.calls} ${mode === 'dry-run' ? 'fixture' : 'Qloo'} requests.` });
  }
  const tasteSummary = item => ({ status: item.status, calls: item.calls, ...(item.fixture ? { fixture: true } : {}), ...(item.reusedFrom ? { reusedFrom: item.reusedFrom } : {}),
    ...(item.replayed ? { replayed: true, ...(item.replayed.missing?.length ? { replayMissing: item.replayed.missing } : {}) } : {}),
    ...(item.location ? { location: item.location } : {}), ...(item.age ? { age: item.age } : {}), seeds: item.seeds, results: item.results || [], limitations: item.limitations || [] });
  record.taste = tasteSummary(profile);
  if (profile.status !== 'ok') {
    record.status = 'failed';
    record.error = profile.status === 'unresolved' ? 'No brief reference resolved to a Qloo entity or tag, so no model run started.' : 'Qloo returned too little taste signal to govern a design, so no model run started.';
    await save();
    return record;
  }
  // The swapped profile is a recorded one: the second arm reads another audience's data under the same brief.
  const swapped = swap ? { ...forBrief(swap.profile, brief), reusedFrom: swap.from } : null;
  if (swapped) {
    record.swap = tasteSummary(swapped);
    emit({ arm: arms[1].key, type: 'taste', message: `The ${arms[1].label.toLowerCase()} arm designs from the profile recorded for ${swap.from}, seeded by ${(swapped.seeds || []).map(seed => seed.name).slice(0, 4).join(', ') || 'its references'}; no Qloo request is made for it.` });
  }
  await save();
  if (signal?.aborted) return cancelled();

  const runner = runArm || (mode === 'dry-run' ? scriptArm
    : ({ dir, prompt, signal: stop, registerHostWait, onEvent: note }) => runKiro({ dir, config, model: config.model, prompt, timeoutMs, signal: stop, registerHostWait, onEvent: note }));
  const promptAudience = located ? { ...(located.location ? { location: located.location } : {}), ...(located.age ? { ageLabel: ageLabel(located.age) } : {}) } : null;
  const results = {};
  const armProduction = capabilities ? { capabilities, capture: capturing ? capture : null, ...(capturing && found?.available ? { browser: { path: found.path, name: found.name } } : {}) } : null;
  const promptProduction = capabilities ? { capabilities, layers: readingLayers({ artDirection, music: Boolean(library) }) } : null;
  for (const arm of arms) {
    if (signal?.aborted) break;
    const dir = path.join(runsDir, 'work', arm.key);
    await fs.rm(dir, { recursive: true, force: true });
    const armProfile = arm.key === 'qloo-swap' ? swapped : profile;
    const usesCodex = Boolean(portraits || (paint && !paint.fixture));
    await prepareArm({ dir, arm, brief, world, domains, profile: armProfile, portraits, codex: usesCodex ? { path: codex.path, version: codex.version } : null, artDirection, music: library, departure, audience: located,
      paint, pairId, production: armProduction });
    const started = Date.now();
    onArm({ arm: arm.key, status: 'running' });
    emit({ arm: arm.key, type: 'agent', message: mode === 'dry-run' ? 'Scripted session started through the design server; no model is called.' : `Kiro run with ${config.model} started.` });
    const watcher = watchSession({ dir, onEvents: events => { for (const item of events) emit({ arm: arm.key, type: item.type, message: item.message, time: item.time }); } });
    let failure = null;
    try {
      const prompt = makeCharacterPrompt({ brief, canon: world.canon, mode: arm.mode, domains, portraits, artDirection, music: library ? library.tracks.length : null, departure, audience: promptAudience, swap: Boolean(swap), paint,
        production: promptProduction });
      await runner({ dir, arm, world, prompt, timeoutMs, signal, registerHostWait: watcher.register, onEvent: message => emit({ arm: arm.key, type: 'agent', message }) });
    } catch (error) { failure = redact(error.message, secrets); }
    finally { await watcher.stop(); }
    const result = await collectArm({ dir, arm, world, portraitsEnabled: Boolean(portraits) });
    // A run that ends badly after saving a valid character still counts; the run error is kept beside it.
    if (failure) Object.assign(result, result.status === 'completed' ? { runError: failure } : { error: `${failure} ${result.error || ''}`.trim() });
    if (failure && result.status === 'completed') emit({ arm: arm.key, type: 'warning', message: `Kiro stopped before the session ended, and the character it had saved counts: ${failure.slice(0, 240)}` });
    if (signal?.aborted && result.status !== 'completed') result.status = 'cancelled';
    let figure = null;
    if (result.status === 'completed') {
      // The published file is the model's drawing with the host's painted skin beside it, when the arm was painted.
      let file = result.raw;
      const painted = await publishSkin({ dir, arm, runsDir, pairId, state: result.state });
      if (painted) {
        const merged = { ...JSON.parse(result.raw), skin: painted.skin };
        try {
          normalizeCharacter(merged, { canon: world.canon, strict: true, artDirection, tracks: library ? library.tracks.map(track => track.id) : null });
          file = JSON.stringify(merged, null, 2);
          figure = painted.figure;
        } catch (error) { emit({ arm: arm.key, type: 'warning', message: `The painted skin was left out of the published character: ${error.message}` }); }
      }
      await fs.writeFile(path.join(runsDir, `${arm.key}.json`), file);
    }
    const published = await publishPortraits({ dir, arm, runsDir, pairId, state: result.state });
    const captures = await publishCaptures({ dir, arm, runsDir, pairId, state: result.state });
    if (result.status === 'completed' && capturing && !result.state.reviews?.length) emit({ arm: arm.key, type: 'warning', message: 'The arm saved no review of its captures.' });
    if (result.review?.audited && result.review.unopened.length) emit({ arm: arm.key, type: 'warning', message: `The session record shows no read of ${result.review.unopened.join(', ')}, which the review cites.` });
    results[arm.key] = result;
    record.arms.push(armRecord({ arm, result, pairId, durationMs: Date.now() - started, portraits: published, library, profileFrom: arm.key === 'qloo-swap' ? swap.from : null, figure, captures }));
    onArm({ arm: arm.key, status: result.status, ...(result.error ? { error: result.error } : {}), durationMs: Date.now() - started });
    emit({ arm: arm.key, type: result.status === 'completed' ? 'agent' : 'error', message: `${result.status[0].toUpperCase()}${result.status.slice(1)}${result.error ? ` (${result.error})` : ''} in ${Math.round((Date.now() - started) / 1000)} s.` });
    await save();
    // An arm without a session record never reached the design server, so the other arm would fail the same way;
    // the pair stops before paying for it.
    if (!result.state) break;
  }
  if (signal?.aborted) return cancelled();

  const [first, second] = arms.map(arm => results[arm.key]);
  if (first?.status === 'completed' && second?.status === 'completed') {
    const view = result => ({ character: result.character, measures: result.measures, dna: result.state.dna, input: result.state.input, conformance: result.conformance, divergence: result.divergence });
    record.comparison = compareCharacterRuns({ baseline: view(first), qloo: view(second), labels: { baseline: arms[0].label, qloo: arms[1].label } });
    const made = compareProduction({ baseline: first.state, qloo: second.state, labels: { baseline: arms[0].label, qloo: arms[1].label } });
    if (made) record.comparison.production = made;
    record.status = 'completed';
  } else {
    record.status = 'failed';
    record.error = [first, second].find(result => result?.error)?.error || 'An arm did not complete.';
    if (!second) record.error += ` The ${arms[1].label} arm was not started.`;
  }
  record.finishedAt = new Date().toISOString();
  await save();
  return record;
}

async function main() {
  loadDotEnv(path.join(rootDir, '.env'));
  const config = getConfig();
  const brief = await loadBrief(path.resolve(rootDir, option('brief', 'game/harness/briefs/long-dusk.json')));
  const live = flag('run'), dry = flag('dry-run');
  const codex = await inspectCodex({ config });
  // The production stages: methods a study requires of both arms, and how the host captures for the review.
  const production = !flag('no-production');
  const required = [...new Set(option('require', '').split(',').map(item => item.trim()).filter(Boolean))];
  const portraits = Math.max(0, Math.min(CHARACTER_LIMITS.portraitsPerRun, Number(option('portraits', codex.available ? '1' : '0')) || 0));
  // Painting is opt-in: one Codex edit per arm, and a second only when the first leaves out a piece. With production
  // stages it is a method each plan may choose; a study that requires it paints once per arm unless told otherwise.
  const paints = Math.max(0, Math.min(CHARACTER_LIMITS.paintsPerRun, Number(option('paint', required.includes('painted-rig') ? '1' : '0')) || 0));
  if (live && paints && !codex.available) throw new Error(`--paint needs Codex image generation: ${codex.reason}`);
  const profileFrom = option('profile-from', null), swapFrom = option('swap-from', null);
  for (const [name, value] of [['profile-from', profileFrom], ['swap-from', swapFrom]]) {
    if (value !== null && !PAIR_ID_PATTERN.test(value)) throw new Error(`--${name} needs a pair ID such as pair-20261004-210500.`);
  }
  const audience = normalizeAudience({ location: option('location', ''), age: option('age', '') });
  const departure = !flag('no-departure');
  const swap = swapFrom ? await loadRecordedProfile(path.join(gameDir, 'runs', swapFrom, 'taste.json'), swapFrom) : null;
  const library = await loadMusicLibrary(rootDir);
  const arms = swap ? SWAP_ARMS : ARMS;
  const kiroReady = await fs.access(config.kiroPath).then(() => true, () => false);
  // A dry run captures in the browser when one is installed and can capture a test page here, which is free, and with
  // fixture pictures otherwise.
  const browser = await verifyBrowser(await inspectBrowser());
  const capture = option('capture', dry && !browser.available ? 'fixture' : 'browser');
  if (!CAPTURE_MODES.includes(capture)) throw new Error(`--capture needs one of ${CAPTURE_MODES.join(', ')}.`);
  if (!production && (required.length || process.argv.some(item => item.startsWith('--capture=')))) throw new Error('--require and --capture belong to the production stages, which --no-production leaves out.');
  const plan = {
    brief: brief.name, references: brief.references, domains: GAME_DOMAINS, model: config.model || null, effort: config.effort,
    arms: arms.map(arm => arm.label), qlooRequests: profileFrom ? 0 : `at most 24, one host taste pass before any model run`, kiroRuns: 2, portraitsPerArm: portraits, paintPerArm: paints,
    artDirection: 'scene, render style and music', music: library ? `${library.tracks.length} tracks from ${library.source.split(' (')[0]}` : 'none: library/music/catalog.json is missing',
    departure, audience, ...(swap ? { swapFrom } : {}),
    production: production ? { stages: 'taste reading, production plan, generation only as planned, visual self-review of captures', required,
      capture: capture === 'off' ? 'off' : capture === 'fixture' ? 'fixture pictures (dry run)' : browser.available ? `headless ${browser.label}` : `unavailable: ${browser.reason}` } : 'off: the earlier protocol, without the reading, the plan and the review',
    readiness: { kiro: kiroReady, model: Boolean(config.model), qlooKey: Boolean(config.qlooKey), codex: codex.available ? { available: true, version: codex.version } : { available: false, reason: codex.reason },
      browser: browser.available ? { available: true, name: browser.label } : { available: false, reason: browser.reason } },
    scope: swap ? `Both arms get the same brief, model, prompt, world, format guide and tools; the second arm reads the profile recorded for ${swapFrom} instead of this brief's.`
      : 'Both arms get the same model, prompt, world, format guide and tools; only the taste source paragraph and game_get_taste differ. Qloo off designs from its own prediction; Qloo on from the measured profile and the qualities its works share.',
  };
  if (!live && !dry) {
    console.log(JSON.stringify({ ...plan, status: 'planned-only', instruction: 'Pass --dry-run to exercise the pipeline with fixtures, or --run to start the live pair: a Qloo taste pass, two paid Kiro runs and Codex portraits.' }, null, 2));
    return;
  }
  if (live) {
    const missing = [!kiroReady && 'the Kiro CLI', !config.model && 'KIRO_MODEL', !config.qlooKey && !profileFrom && 'QLOO_API_KEY'].filter(Boolean);
    if (missing.length) throw new Error(`The live pair needs ${missing.join(', ')}.`);
  }
  const minutes = production ? CHARACTER_RUN_TIMEOUT_MS / 60000 : 25;
  const timeoutMs = Math.max(5, Math.min(60, Number(option('timeout-minutes', String(minutes))) || minutes)) * 60000;
  const labels = Object.fromEntries(arms.map(arm => [arm.key, arm.label]));
  const record = await runPair({ brief, mode: live ? 'live' : 'dry-run', portraitsPerArm: live ? portraits : 0, paintPerArm: paints, codex, profileFrom, swap, music: library, departure, audience, timeoutMs, config,
    production, required, capture, browser,
    ...(dry && swap ? { pairId: 'dry-run-swap' } : {}),
    onEvent: ({ arm, message, time }) => console.log(`[${time.slice(11, 19)}] ${arm ? `${labels[arm]}: ` : ''}${message}`) });
  console.log(JSON.stringify({ pairId: record.pairId, status: record.status, error: record.error, headline: record.comparison?.headline, qualities: record.comparison?.qualityHeadline,
    world: record.comparison?.worldHeadline, render: record.comparison?.renderHeadline, production: record.comparison?.production?.headline, distance: record.comparison?.distance?.overall,
    compare: `http://127.0.0.1:8790/game/compare.html?pair=${record.pairId}` }, null, 2));
  if (record.status !== 'completed') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
