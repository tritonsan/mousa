// Game character pairs in the Studio. A character job runs the RPG proof's Qloo off/on pair from game/harness through
// the Studio's single queue, so a pair never overlaps a site build, and records it under data/<job>/<pairId>/ in the
// same files the command-line runner writes. The preview server plays it from there with the game's own pages.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { redact } from './config.mjs';
import { runPair, normalizeBrief, pairStamp, loadRecordedProfile, ageLabel, ARMS, SWAP_ARMS, CHARACTER_RUN_TIMEOUT_MS } from '../game/harness/run-pair.mjs';
import { CHARACTER_LIMITS } from '../game/harness/protocol.mjs';
import { loadMusicLibrary } from '../game/harness/music.mjs';
import { QLOO_AGE_BANDS } from '../plugin/server/qloo/client.mjs';
import { inspectBrowser } from '../plugin/server/production/capture.mjs';

export const CHARACTER_KIND = 'character';
export const PAIR_ID = /^[a-z0-9-]{1,60}$/u;
const JOB_ID = /^[a-f0-9-]{36}$/u;
const MAX_REFERENCES = 8;
const BRIEF_LIMITS = { min: 40, max: 3500 };
const LOCATION_LIMITS = { min: 2, max: 120 };

class RequestError extends Error { constructor(message) { super(message); this.status = 400; } }

/** Whether a completed pair can lend its profile: a measured one with shared qualities (fixture profiles only in tests). */
const lendsProfile = (job, { fixtures = false } = {}) => job.status === 'completed' && job.taste?.status === 'ok' && (fixtures || !job.taste.fixture) && Boolean(job.taste.qualities?.length);

/**
 * A recorded pair whose taste profile another pair may reuse or swap in: a completed character job of this Studio.
 * `from` names it in the records; the pair ID alone repeats for pairs queued in one second before October 5, 2026.
 */
export function recordedSource(jobs, id, what) {
  if (id === undefined || id === null || id === '') return null;
  const job = typeof id === 'string' && JOB_ID.test(id) ? jobs?.get(id) : null;
  if (!job || job.kind !== CHARACTER_KIND || job.status !== 'completed' || !PAIR_ID.test(job.pairId || '') || (job.taste && job.taste.status !== 'ok')) {
    throw new RequestError(`${what} must be a completed character pair of this Studio.`);
  }
  // The design rules start from shared qualities, so a profile recorded before them cannot stand in for a taste pass.
  if (!lendsProfile(job, { fixtures: true })) throw new RequestError(`${what} must come from a pair whose profile has measured shared qualities.`);
  return { jobId: job.id, pairId: job.pairId, from: `${job.pairId} (job ${job.id.slice(0, 8)})`, references: (job.brief?.references || []).map(ref => ref.name).slice(0, MAX_REFERENCES) };
}

/** The audience's place and age band, both optional: they weight the taste pass and both runs are told them. */
function audienceRequest(input) {
  const location = typeof input.location === 'string' ? input.location.trim().replace(/\s+/gu, ' ') : '';
  if (input.location !== undefined && input.location !== null && typeof input.location !== 'string') throw new RequestError('Name the audience’s place as text.');
  if (location && (location.length < LOCATION_LIMITS.min || location.length > LOCATION_LIMITS.max || /[<>{}\p{Cc}]/u.test(location))) throw new RequestError(`Name the audience’s place as a city, region or country in ${LOCATION_LIMITS.min}–${LOCATION_LIMITS.max} characters.`);
  const age = input.age === undefined || input.age === null || input.age === '' ? null : input.age;
  if (age !== null && !QLOO_AGE_BANDS.includes(age)) throw new RequestError(`Choose an audience age band Qloo knows: ${QLOO_AGE_BANDS.map(band => band.replaceAll('_', ' ')).join(', ')}.`);
  return location || age ? { ...(location ? { location } : {}), ...(age ? { age: [age] } : {}) } : null;
}

// Methods a study may require of both arms: each is a picture method a plan could otherwise choose or leave.
export const REQUIRABLE_METHODS = Object.freeze([
  Object.freeze({ id: 'painted-rig', label: 'Paint the figure as finished game art', needs: 'paintPerArm' }),
  Object.freeze({ id: 'portrait', label: 'Paint a portrait of the character', needs: 'portraitsPerArm' }),
]);

/**
 * A character pair request from the Studio: the brief text, one to eight audience references and portraits per arm,
 * with the audience's place and age, the departure rule (on unless the request turns it off, an ablation), a recorded
 * profile to reuse instead of a taste pass, and a recorded profile to swap in for the second run. `jobs` resolves those.
 * Portraits and painting are methods each arm's production plan may choose; `required` makes one a study setting both
 * arms must use.
 */
export function characterRequest(input, { imagesAvailable = false, jobs = null } = {}) {
  const raw = input?.brief;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RequestError('A character brief with its text and references is required.');
  const text = typeof raw.brief === 'string' ? raw.brief.trim().replace(/\r\n/gu, '\n') : '';
  if (text.length < BRIEF_LIMITS.min || text.length > BRIEF_LIMITS.max) throw new RequestError(`The character brief must contain ${BRIEF_LIMITS.min}–${BRIEF_LIMITS.max.toLocaleString('en-US')} characters.`);
  const seen = new Set(), references = [];
  for (const item of Array.isArray(raw.references) ? raw.references : []) {
    const name = String(typeof item === 'string' ? item : item?.name ?? '').trim().replace(/\s+/gu, ' ');
    if (!name) continue;
    if (name.length < 2 || name.length > 200) throw new RequestError('Each reference needs 2–200 characters.');
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); references.push({ name, role: 'audience', origin: 'user-provided' });
  }
  if (!references.length || references.length > MAX_REFERENCES) throw new RequestError(`Name 1–${MAX_REFERENCES} works, artists or brands the audience loves.`);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : 'The Long Dusk character pair';
  const portraits = input.portraitsPerArm ?? 0;
  if (!Number.isInteger(portraits) || portraits < 0 || portraits > CHARACTER_LIMITS.portraitsPerRun) throw new RequestError(`Choose 0–${CHARACTER_LIMITS.portraitsPerRun} portraits per arm.`);
  if (portraits && !imagesAvailable) throw new RequestError('Portraits need Codex image generation, which this Studio does not have. Choose no portraits.');
  // Painting is one Codex edit per character, and a plan may allow a second that repairs what the review of the painted
  // figure finds, or a piece the painter left out.
  const paint = input.paintPerArm ?? 0;
  if (![0, 1, 2].includes(paint)) throw new RequestError('Allow each character up to two paintings, or none.');
  if (paint && !imagesAvailable) throw new RequestError('Painting the characters needs Codex image generation, which this Studio does not have. Leave painting off.');
  const audience = audienceRequest(input);
  if (input.departure !== undefined && typeof input.departure !== 'boolean') throw new RequestError('Turn the departure rule on or off.');
  const profileFrom = recordedSource(jobs, input.profileFrom, 'The reused taste profile');
  const swapFrom = recordedSource(jobs, input.swapFrom, 'The swapped profile');
  // A reused profile was weighted by its own place and ages; asking for others would describe data that was not measured.
  if (profileFrom && audience) throw new RequestError('A reused taste profile keeps the place and age it was measured with. Leave them empty, or run a new taste pass.');
  if (swapFrom && profileFrom && swapFrom.jobId === profileFrom.jobId) throw new RequestError('Swap in a profile from another pair than the one this pair reuses.');
  if (input.required !== undefined && !Array.isArray(input.required)) throw new RequestError('List the methods both designers must use.');
  const required = [...new Set(input.required || [])];
  for (const id of required) {
    const method = REQUIRABLE_METHODS.find(item => item.id === id);
    if (!method) throw new RequestError(`A study can require ${REQUIRABLE_METHODS.map(item => item.id).join(' or ')} of both designers.`);
    if (!(method.needs === 'paintPerArm' ? paint : portraits)) throw new RequestError(`Both designers can be required to ${method.label.toLowerCase()} only when ${method.needs === 'paintPerArm' ? 'painting is on' : 'portraits are allowed'}.`);
  }
  return { brief: normalizeBrief({ name, brief: text, references }), portraitsPerArm: portraits, paintPerArm: paint, audience, departure: input.departure !== false, profileFrom, swapFrom, required };
}

export function newCharacterJob({ request, model, effort, images }) {
  const id = crypto.randomUUID();
  const arms = request.swapFrom ? SWAP_ARMS : ARMS;
  return {
    id, kind: CHARACTER_KIND, status: 'queued', createdAt: new Date().toISOString(), model, effort, error: null,
    // The stamp alone repeats for pairs queued in the same second, so the job's prefix keeps each pair ID unique.
    previewToken: crypto.randomBytes(24).toString('hex'), pairId: `${pairStamp()}-${id.slice(0, 8)}`, world: 'The Long Dusk',
    brief: request.brief, portraitsPerArm: request.portraitsPerArm, paintPerArm: request.paintPerArm || 0,
    images: (request.portraitsPerArm || request.paintPerArm) && images ? { provider: images.provider, version: images.version || null, perRun: request.portraitsPerArm } : null,
    audience: request.audience || null, departure: request.departure !== false, profileFrom: request.profileFrom || null, swapFrom: request.swapFrom || null,
    required: request.required || [], taste: null, comparison: null, imported: null,
    runs: arms.map(arm => ({ mode: arm.mode, key: arm.key, label: arm.label, status: 'queued', error: null, events: [], durationMs: null })),
  };
}

/** The measured qualities, ranked tags and art styles an arm designed from, as the Studio lists them. */
function measuredTaste(arm) {
  const qloo = item => item.source === 'qloo';
  return {
    qualities: (arm?.taste?.qualities || []).filter(qloo).map(({ name, family, count, domains, surprise }) => ({ name, family, count, domains, surprise: Boolean(surprise) })),
    tags: (arm?.taste?.tags || []).map(({ name, domain, surprise }) => ({ name, domain, surprise: Boolean(surprise) })),
    artStyles: (arm?.taste?.artStyles || []).filter(qloo).map(({ name, count, preset, examples, surprise }) => ({ name, count, ...(preset ? { preset } : {}), examples: examples || [], surprise: Boolean(surprise) })),
    renderStyle: arm?.taste?.renderStyles?.[0] ? { name: arm.taste.renderStyles[0].name, preset: arm.taste.renderStyles[0].preset } : null,
  };
}

/** The moment an arm's character set: its render style, weather and beacons, and the credited track. */
function armMoment(arm, world) {
  if (!world) return null;
  return { render: world.render, weather: world.weather?.kind || null, towers: world.towers, sky: world.sky,
    ...(arm?.music ? { music: { title: arm.music.title, artist: arm.music.artist, license: arm.music.license, source: arm.music.source, ...(arm.music.sourceUrl ? { sourceUrl: arm.music.sourceUrl } : {}) } } : {}) };
}

/** How one arm made its character: the methods its plan chose by layer, the pictures it asked for and its last review. */
function armProduction(arm) {
  const made = arm?.production;
  if (!made?.plan) return null;
  const byLayer = {};
  for (const step of made.plan.steps) (byLayer[step.layer] ||= []).push(step.method);
  const last = made.reviews?.at(-1);
  return { methods: made.plan.uses?.methods || [], byLayer, generators: Object.fromEntries(Object.entries(made.plan.uses?.generators || {}).map(([id, use]) => [id, use.total])),
    clusters: (made.reading?.clusters || []).map(cluster => cluster.name), setAside: made.reading?.setAside?.length || 0, criteria: made.plan.review?.length || 0,
    review: last ? { rounds: made.reviews.length, met: last.stats.met, partly: last.stats.partly, missed: last.stats.missed, audited: Boolean(made.audit?.audited),
      ...(made.audit?.audited ? { unopened: made.audit.unopened.length } : {}) } : null };
}

/** The pictures an image generator made for a pair, so a server without one can say where the pair was recorded. */
export function pairPictures(arms = []) {
  const made = provider => typeof provider === 'string' && provider !== 'fixture';
  const portraits = arms.flatMap(arm => (arm.portraits || []).filter(item => item.status === 'generated' && made(item.provider)));
  const painted = arms.filter(arm => arm.paint?.status === 'painted' && made(arm.paint.provider));
  const providers = [...new Set([...portraits.map(item => item.provider), ...painted.map(arm => arm.paint.provider)])];
  return providers.length ? { portraits: portraits.length, painted: painted.length, providers } : null;
}

/**
 * What the Studio keeps from a pair record: the taste pass, the qualities and art styles the measured arm designed
 * from (both arms' in a swap pair), the protocol the pair ran under, how each arm planned and reviewed its character,
 * the pictures a generator made for it, and the comparison.
 */
export function pairSummary(record) {
  const on = record.arms?.find(arm => arm.key === 'qloo-on');
  const swapped = record.arms?.find(arm => arm.key === 'qloo-swap');
  const comparison = record.comparison, protocol = record.protocol || {};
  const seeds = taste => (taste?.seeds || []).map(seed => ({ name: seed.name, resolution: seed.resolution, ...(seed.matchedName ? { matchedName: seed.matchedName } : {}) }));
  const [first, second] = record.arms || [];
  const production = protocol.production;
  return {
    taste: record.taste ? { status: record.taste.status, calls: record.taste.calls, ...(record.taste.fixture ? { fixture: true } : {}), ...(record.taste.reusedFrom ? { reusedFrom: record.taste.reusedFrom } : {}),
      ...(record.taste.replayed ? { replayed: true } : {}), ...(record.taste.location ? { location: record.taste.location } : {}), ...(record.taste.age ? { age: record.taste.age } : {}),
      seeds: seeds(record.taste), ...measuredTaste(on) } : null,
    ...(record.swap ? { swapTaste: { from: record.swap.from || protocol.swap?.from || null, seeds: seeds(record.swap), ...measuredTaste(swapped) } } : {}),
    protocol: { artDirection: Boolean(protocol.artDirection), departure: protocol.departure !== false, music: protocol.music ? { tracks: protocol.music.tracks } : null,
      ...(protocol.audience ? { audience: protocol.audience } : {}), ...(protocol.swap ? { swap: protocol.swap } : {}),
      ...(production ? { production: { required: production.required || [], capture: production.capture || null, ...(production.browser ? { browser: production.browser } : {}), rounds: production.rounds || 0,
        unavailable: (production.methods || []).filter(item => !item.available).map(({ id, reason }) => ({ id, reason })), ...(production.captureReason ? { captureReason: production.captureReason } : {}) } } : {}) },
    ...(production ? { production: { baseline: armProduction(first), qloo: armProduction(second) } } : {}),
    pictures: pairPictures(record.arms),
    comparison: comparison ? { headline: comparison.headline, qualityHeadline: comparison.qualityHeadline || null, sketchHeadline: comparison.sketchHeadline || null, detail: comparison.detail || '',
      worldHeadline: comparison.worldHeadline || null, renderHeadline: comparison.renderHeadline || null, dataHeadline: comparison.dataHeadline || null,
      productionHeadline: comparison.production?.headline || null,
      labels: comparison.labels || { baseline: 'Qloo off', qloo: 'Qloo on' },
      distance: comparison.distance ? Object.fromEntries(['overall', 'character', 'world', 'palette', 'silhouette', 'motion', 'signature', 'voice', 'light'].filter(key => comparison.distance[key] !== undefined).map(key => [key, comparison.distance[key]])) : null,
      conformance: { baseline: comparison.baseline?.conformance ?? null, qloo: comparison.qloo?.conformance ?? null },
      sketch: { baseline: comparison.baseline?.sketch?.score ?? null, qloo: comparison.qloo?.sketch?.score ?? null },
      ...(comparison.world ? { moments: { baseline: armMoment(first, comparison.world.baseline), qloo: armMoment(second, comparison.world.qloo) },
        momentMoved: { baseline: comparison.baseline?.sketch?.world?.score ?? null, qloo: comparison.qloo?.sketch?.world?.score ?? null } } : {}) } : null,
    recordKind: record.kind || 'live',
  };
}

/**
 * Runs one queued character job to its end. `runner` is game/harness's runPair or a test stand-in with the same
 * options. Events reach the job's runs as they happen; the job is saved at most twice a second while it runs.
 */
export async function runCharacterJob(manager, job, { runner = runPair } = {}) {
  const controller = new AbortController();
  manager.characterControllers.set(job.id, controller);
  const runFor = key => job.runs.find(run => run.key === key);
  let timer = null;
  const schedule = () => { timer ||= setTimeout(() => { timer = null; manager.save(job).catch(() => {}); }, 500); };
  try {
    const images = job.images && manager.imageGenerator?.available ? manager.imageGenerator : null;
    // Recorded profiles are read from their own pair folders; neither makes a Qloo request.
    const recorded = source => (source ? loadRecordedProfile(path.join(manager.config.dataDir, source.jobId, source.pairId, 'taste.json'), source.from) : null);
    const [reuse, swap] = await Promise.all([recorded(job.profileFrom), recorded(job.swapFrom)]);
    const record = await runner({
      brief: job.brief, mode: 'live', portraitsPerArm: images ? job.portraitsPerArm : 0, paintPerArm: images ? job.paintPerArm || 0 : 0,
      codex: images ? { available: true, path: images.path, version: images.version || null } : null,
      timeoutMs: CHARACTER_RUN_TIMEOUT_MS, config: { ...manager.config, model: job.model, effort: job.effort },
      reuse, swap, departure: job.departure !== false, audience: job.audience || null,
      // Both arms plan from the same capability list; a required method is a study setting both must use.
      // Without the image generator a required picture method cannot run, and the pair stops before any request.
      production: true, required: job.required || [], environment: manager.config.environment || 'local',
      // The browser the Studio checked at start, so a pair captures exactly when the Studio's own review can.
      ...(manager.browser ? { browser: manager.browser } : {}),
      pairId: job.pairId, runsRoot: path.join(manager.config.dataDir, job.id), qlooClient: manager.qlooClientFactory(), signal: controller.signal,
      // Taste-pass events belong to the Qloo on run, as in a site comparison.
      onEvent: ({ arm, type, message }) => { manager.event(job, runFor(arm) || runFor('qloo-on'), type, message); schedule(); },
      onArm: ({ arm, status, error, durationMs }) => {
        const run = runFor(arm);
        if (!run) return;
        Object.assign(run, { status, ...(error ? { error: redact(error, manager.config).slice(0, 900) } : {}), ...(durationMs ? { durationMs } : {}) });
        schedule();
      },
    });
    Object.assign(job, pairSummary(record));
    const cancelled = job.status === 'cancelled' || record.status === 'cancelled';
    for (const run of job.runs) {
      const arm = record.arms.find(item => item.key === run.key);
      if (arm) Object.assign(run, { status: arm.status, error: arm.error ? redact(arm.error, manager.config).slice(0, 900) : null, durationMs: arm.durationMs ?? run.durationMs });
      else if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
        run.status = cancelled ? 'cancelled' : 'failed';
        run.error = cancelled ? 'Not started: the pair was cancelled.' : record.taste?.status && record.taste.status !== 'ok' ? 'Not started: the Qloo taste pass did not return enough taste signal, so the pair stopped before any model run.' : 'Not started: the other arm did not reach the design server.';
      }
    }
    job.status = cancelled ? 'cancelled' : record.status === 'completed' ? 'completed' : 'failed';
    job.error = job.status === 'completed' ? null : job.status === 'cancelled' ? job.error || 'The user cancelled the job.' : redact(record.error || 'The pair did not complete.', manager.config).slice(0, 900);
  } catch (error) {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.error = `The character pair could not run: ${redact(error.message, manager.config).slice(0, 700)}`;
    }
    for (const run of job.runs) if (!['completed', 'failed', 'cancelled'].includes(run.status)) { run.status = job.status === 'cancelled' ? 'cancelled' : 'failed'; run.error ||= job.error; }
  } finally {
    clearTimeout(timer);
    manager.characterControllers.delete(job.id);
  }
}

/**
 * The public view of a character job, with capability URLs for its pages once the pair has completed. Each arm plays
 * at its own key: qloo-off and qloo-on, or qloo-on and qloo-swap in a swap pair.
 */
export function publicCharacterJob(job, previewBaseUrl) {
  const base = `${previewBaseUrl}/game/${job.id}/${job.previewToken}/`;
  const ready = job.status === 'completed' && PAIR_ID.test(job.pairId || '');
  return {
    id: job.id, kind: CHARACTER_KIND, status: job.status, createdAt: job.createdAt, model: job.model, effort: job.effort, error: job.error,
    world: job.world, brief: job.brief, portraitsPerArm: job.portraitsPerArm, paintPerArm: job.paintPerArm || 0, pairId: job.pairId, imported: job.imported || null, recordKind: job.recordKind || null,
    audience: job.audience || null, departure: job.departure !== false, profileFrom: job.profileFrom || null, swapFrom: job.swapFrom || null, required: job.required || [],
    taste: job.taste || null, swapTaste: job.swapTaste || null, protocol: job.protocol || null, production: job.production || null, comparison: job.comparison || null,
    pictures: job.pictures || null,
    runs: job.runs.map(run => ({ mode: run.mode, key: run.key, label: run.label, status: run.status, error: run.error, events: run.events, durationMs: run.durationMs ?? null })),
    urls: ready ? {
      compare: `${base}compare.html?pair=${job.pairId}`, embed: `${base}compare.html?pair=${job.pairId}&embed=1`,
      play: Object.fromEntries(job.runs.map(run => [run.key, `${base}index.html?character=${encodeURIComponent(`runs/${job.pairId}/${run.key}.json`)}`])),
    } : null,
  };
}

/** One line per character job for the Studio's pair list, newest first, with what a later pair may reuse or swap in. */
export function listCharacterJobs(jobs) {
  return [...jobs].filter(job => job.kind === CHARACTER_KIND).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(job => ({
    id: job.id, status: job.status, createdAt: job.createdAt, pairId: job.pairId, imported: job.imported || null, name: job.brief?.name || 'Character pair',
    references: (job.brief?.references || []).map(ref => ref.name), headline: job.comparison?.headline || null, distance: job.comparison?.distance?.overall ?? null,
    qualities: Boolean(job.taste?.qualities?.length), model: job.model,
    artDirection: Boolean(job.protocol?.artDirection), swap: Boolean(job.swapFrom), ablation: job.departure === false, audience: job.audience || null,
    // A completed pair with a measured profile of shared qualities can lend it to another pair, without a Qloo request.
    profile: lendsProfile(job),
  }));
}

/**
 * The fixed world, the default brief, the age bands, the music library, the methods a study may require and whether
 * this server can capture the characters for their review, as the Studio's form starts from them.
 */
export async function characterDefaults(rootDir, { browser = inspectBrowser } = {}) {
  const read = async file => JSON.parse(await fs.readFile(path.join(rootDir, 'game', ...file.split('/')), 'utf8'));
  const [canon, brief, music, capture] = await Promise.all([read('world/canon.json'), read('harness/briefs/long-dusk.json'), loadMusicLibrary(rootDir), browser()]);
  return {
    world: { name: canon.world, premise: canon.premise, scene: { name: canon.scene.name, summary: canon.scene.summary },
      character: { name: canon.character.name, role: canon.character.role, abilities: canon.character.abilities.map(({ name, description }) => ({ name, description })), rules: canon.character.rules },
      keeper: { name: canon.keeper.name, role: canon.keeper.role } },
    brief: normalizeBrief(brief),
    ageBands: QLOO_AGE_BANDS.map(band => ({ value: band, label: ageLabel(band) })),
    music: music ? { tracks: music.tracks.length, licenses: [...new Set(music.tracks.map(track => track.license))], source: music.tracks[0]?.source || null } : null,
    production: { requirable: REQUIRABLE_METHODS.map(({ id, label }) => ({ id, label })),
      review: capture.available ? { available: true, browser: capture.label || capture.name } : { available: false, reason: capture.reason } },
    limits: { references: MAX_REFERENCES, brief: BRIEF_LIMITS, location: LOCATION_LIMITS, portraitsPerArm: CHARACTER_LIMITS.portraitsPerRun, qlooRequests: 24, runMinutes: CHARACTER_RUN_TIMEOUT_MS / 60000 },
  };
}
