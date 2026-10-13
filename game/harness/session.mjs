// One arm's design session: the host side of every tool the designing model can call. It enforces the protocol's
// order (prediction, reveal, DNA, portraits, character, check), validates each artifact before it lands and
// records everything in host/session.json, which the model cannot read or write. An arm with production stages adds
// the universal protocol's taste reading before the DNA, the production plan after it, generation only as the plan
// states it, and the review of captures of the checked character.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tasteInputFromProfile, tasteInputFromAssumption, compactTasteInput, isTagDomain, isQualityDomain, QUALITY_DOMAIN, ART_STYLE_DOMAIN, TasteProtocolError, normalizeTasteName } from '../../plugin/server/culture/taste.mjs';
import { normalizeCapabilities, CAPTURE_LIMITS } from '../../plugin/server/production/capabilities.mjs';
import { normalizeTasteReading, applyReadingToDna } from '../../plugin/server/production/reading.mjs';
import { normalizeProductionPlan, generationAllowance } from '../../plugin/server/production/plan.mjs';
import { normalizeReview } from '../../plugin/server/production/review.mjs';
import { buildImagePrompt, ImageRequestError } from '../../src/image-generator.mjs';
import { normalizeCharacter, CharacterFormatError } from '../src/format.js';
import { completeScene, RENDER_PRESETS } from '../src/scene.js';
import { normalizeCharacterAssumption, normalizeCharacterDna, checkCharacterConformance, armPolicyText, CHARACTER_LIMITS, PAINTED_FIELDS, FROZEN_FIGURE, REPAIRABLE_AFTER_PAINTING } from './protocol.mjs';
import { withRenderStyles, refPreset } from './art-styles.mjs';
import { tracksFor } from './music.mjs';
import { measureCharacter } from './measure.mjs';
import { asciiPose, restRaster } from './raster.mjs';
import { skinPieces, paintCharacter, TECHNIQUES, PAINT_LIMITS } from './skin.mjs';
import { GAME_MEDIUM_ID, GAME_VIEWS, VIEW_IDS, CAPABILITIES_FILE, REVIEW_DIR, readingLayers } from './production.mjs';
import { citedCaptures } from '../../plugin/server/production/review.mjs';
import { openedCapturesSettled } from '../../src/kiro-session-audit.mjs';

export const READABLE_FILES = Object.freeze(['brief.json', 'canon.json', 'format.md', 'mannequin.json']);
// A run with a music library also lets the model read the track list.
export const MUSIC_FILE = 'music.json';
export const ARTIFACTS = Object.freeze(['game-assumption.json', 'game-dna.json', 'character.json']);
// With production stages the reading, the plan and the review join the artifacts, in the order they are saved.
export const PRODUCTION_ARTIFACTS = Object.freeze(['game-assumption.json', 'game-reading.json', 'game-dna.json', 'game-production.json', 'character.json', 'game-review.json']);
const TOOL_LIMIT = 120;
const MAX_BYTES = 131072;

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
/** A fingerprint of the fields a painting is cut from, of a normalized character; a later save must keep it. */
export const paintedDrawing = character => digest(canonical(Object.fromEntries(PAINTED_FIELDS.map(field => [field, character?.[field] ?? null]))));

const EMPTY = { type: 'object', properties: {}, additionalProperties: false };
const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** The session's tools. `production` ({capture}) adds the reading, plan and review artifacts, and the capture tool when the host can capture. */
export function toolDefinitions({ portraits = false, music = false, paint = false, production = null } = {}) {
  const files = `the brief, the world canon, the format guide, the example mannequin${music ? ', the music library' : ''}${production ? ', the capability list' : ''}`;
  const readable = `brief.json, canon.json, format.md, mannequin.json${music ? ', music.json' : ''}${production ? ', capabilities.json' : ''}`;
  const writes = production
    ? 'Save one artifact: game-assumption.json (your frozen prediction and character sketch), game-reading.json (your reading of the taste input), game-dna.json (the Character DNA), game-production.json (how each device is made and what the review looks for), character.json (the character) or game-review.json (your review of the captures).'
    : 'Save one artifact: game-assumption.json (your frozen prediction and character sketch), game-dna.json (the Character DNA) or character.json (the character).';
  return [
    { name: 'game_list_files', description: `List the files of this design session: ${files} and the artifacts you have saved.`, inputSchema: EMPTY, annotations: READS },
    { name: 'game_read_file', description: `Read one file of this session by name: ${readable}, or an artifact you saved.`,
      inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['path'], additionalProperties: false }, annotations: READS },
    { name: 'game_write_file', description: `${writes} The host validates each one and names the field to fix when it refuses.`,
      inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 80 }, content: { type: 'string', maxLength: MAX_BYTES } }, required: ['path', 'content'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'game_get_taste', description: 'Read this session\'s taste input. Until game-assumption.json is saved it returns only the domains to predict. Afterwards it returns the refs to anchor devices to: the host-recorded Qloo taste profile with surprise flags in a Qloo run, or your own prediction in a run without Qloo, plus the required anchors. Style and aesthetic refs and shared qualities are qualities rather than works.',
      inputSchema: EMPTY, annotations: READS },
    { name: 'game_check_character', description: 'Measure the saved character.json and check it against game-dna.json: figure height, head share, stride, visible colours, structural warnings, text previews of the rest, walk and kindle poses, and which DNA devices are present, partial or missing. It does not judge quality.',
      inputSchema: EMPTY, annotations: READS },
    ...(portraits ? [{ name: 'game_generate_portrait', description: `Paint one portrait of the character from an imagery device of the saved game-dna.json${production ? ' whose step in game-production.json chose the portrait method, up to the step\'s count' : ''}. Give the device ID and one sentence describing what the portrait shows, without naming taste entities; the host writes the prompt from that device's name, colours and qualities and returns a description of the picture after about a minute. The first request freezes the DNA${production ? ' and the plan' : ''}.`,
      inputSchema: { type: 'object', properties: { device: { type: 'string', minLength: 1, maxLength: 40 }, subject: { type: 'string', minLength: 10, maxLength: 240 }, aspect: { type: 'string', enum: ['portrait', 'square'] } }, required: ['device', 'subject'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }] : []),
    ...(paint ? [{ name: 'game_paint_character', description: `Paint the checked character.json as finished game art${production ? ', when game-production.json chose painted-rig for a device, up to the step\'s count' : ''}. The host lays the drawing out as a blueprint sheet of pieces (game_check_character lists their IDs), and Codex repaints it in the technique of the character's render preset, guided by your style sentence and your description of each piece; the host then cuts the painted pieces back onto their bones, so the painted character moves with your rig, motion, clips and cloth. It takes about a minute and freezes the figure in character.json, ${FROZEN_FIGURE}; its ${REPAIRABLE_AFTER_PAINTING} can still be repaired. Describe looks, materials and details, never taste entities.`,
      inputSchema: { type: 'object', properties: {
        style: { type: 'string', minLength: PAINT_LIMITS.styleMin, maxLength: PAINT_LIMITS.styleMax },
        pieces: { type: 'array', maxItems: 24, items: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 40 }, description: { type: 'string', minLength: PAINT_LIMITS.descriptionMin, maxLength: PAINT_LIMITS.descriptionMax } }, required: ['id', 'description'], additionalProperties: false } },
      }, required: ['style'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }] : []),
    ...(production?.capture ? [{ name: 'game_capture_review', description: `Capture the checked character in the game's own pages for your visual review: ${GAME_VIEWS.map(view => `${view.id}, ${view.shows}`).join('; ')}. The host writes one PNG a view to ${REVIEW_DIR}/ in your working folder and returns each capture's ID and path. Open every capture you cite with your read tool, then save game-review.json for the round. A round captures each view once; ${CAPTURE_LIMITS.rounds} rounds.`,
      inputSchema: { type: 'object', properties: { views: { type: 'array', minItems: 1, maxItems: GAME_VIEWS.length, items: { type: 'string', enum: [...VIEW_IDS] } } }, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }] : []),
  ];
}

const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const textReply = text => ({ content: [{ type: 'text', text }] });
const blocked = (message, code = 'PHASE_REQUIRED') => ({ content: [{ type: 'text', text: message }], structuredContent: { status: 'blocked', error: { code, message } }, isError: true });
const invalid = (file, error) => {
  const message = `Invalid ${file}: ${error.message.slice(0, 900)} Correct the reported field and save it again.`;
  return { content: [{ type: 'text', text: message }], structuredContent: { status: 'error', error: { code: 'ARTIFACT_INVALID', message } }, isError: true };
};
const digest = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const listing = items => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

async function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, text);
  await fs.rename(temporary, file);
}

/** Names the description and lines should not use: the taste entities and the brief's own references. */
function mentions(text, names) {
  const found = [];
  const words = ` ${normalizeTasteName(text)} `;
  for (const name of names) {
    const key = normalizeTasteName(name);
    if (key.length < 4) continue;
    // A single word counts only as written, capitalised, so "the journey home" does not name a game called Journey.
    if (key.includes(' ') ? words.includes(` ${key} `) : new RegExp(`(?<![\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text)) found.push(name);
  }
  return [...new Set(found)];
}

/**
 * What the DNA says the figure is, for the portrait prompt: how many heads tall it stands and the garments, props and
 * features its silhouette and costume devices draw. The portrait then shows the figure the game will draw.
 */
export function figureFacts(dna) {
  const devices = Array.isArray(dna?.devices) ? dna.devices : [];
  const shape = devices.find(device => device.layer === 'silhouette' && device.tokens?.proportions?.headShare);
  const parts = [...new Set(devices.filter(device => ['silhouette', 'costume'].includes(device.layer)).flatMap(device => device.tokens?.parts || []))]
    .map(id => id.replace(/-/gu, ' ')).filter(name => !/^(?:eye|eye shine|thigh|shin|foot|forearm|upper arm|hand|torso|head|pelvis)$/u.test(name)).slice(0, 6);
  if (!shape && !parts.length) return null;
  return { ...(shape ? { heads: Math.round((1 / shape.tokens.proportions.headShare) * 2) / 2 } : {}), ...(parts.length ? { parts } : {}) };
}

/** The moment a character file sets, as the check reports it. */
function momentLine(character) {
  const scene = completeScene(character.scene), preset = character.render?.preset || 'lit';
  return `Moment: ${character.scene ? `a ${scene.sky.join(' to ')} sky over ${scene.clouds} cloud and ${scene.rock} basalt, ${scene.weather.kind} at density ${scene.weather.density}, fog ${scene.fog}, ${scene.towers} beacons` : 'no scene (the original dusk)'}; drawn in ${RENDER_PRESETS[preset].label.toLowerCase()} ("${preset}")${character.music ? `; music ${character.music.track} at volume ${character.music.volume}` : ''}.`;
}

/**
 * The session for one arm directory. `images` is an image generator ({available, generate}) or null, `painter` the
 * painting generator, and `capture` the host's capture of the saved character ({dir, views, round, outDir} to shots)
 * for an arm with production stages; `now` is injectable for tests. Files the model can read live in files/, host
 * records in host/, and captures in workspace/review/, where the model's own read tool may open them.
 */
export async function createArmSession({ dir, images = null, painter = null, capture = null, now = () => new Date() }) {
  const filesDir = path.join(dir, 'files'), hostDir = path.join(dir, 'host');
  const config = JSON.parse(await fs.readFile(path.join(hostDir, 'config.json'), 'utf8'));
  const canon = JSON.parse(await fs.readFile(path.join(filesDir, 'canon.json'), 'utf8'));
  const profile = config.mode === 'qloo' ? JSON.parse(await fs.readFile(path.join(hostDir, 'profile.json'), 'utf8')) : null;
  const portraits = config.portraits && images?.available ? { perRun: Math.min(config.portraits.perRun || 1, CHARACTER_LIMITS.portraitsPerRun) } : null;
  // Painting names each picture by the path the pair publishes it under, runs/<pair>/<arm>-skin-<piece>.png.
  const painting = config.paint && painter?.available && /^runs\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,20}$/u.test(config.paint.prefix || '')
    ? { perRun: Math.min(config.paint.perRun || 1, CHARACTER_LIMITS.paintsPerRun), prefix: config.paint.prefix } : null;
  const domains = config.domains;
  const requiredCount = config.requiredAnchorCount ?? CHARACTER_LIMITS.requiredAnchors;
  // Art direction opens the scene and the render style; a music library adds the track; departure false is the ablation.
  const artDirection = Boolean(config.artDirection), departure = config.departure !== false;
  const tracks = config.music ? (JSON.parse(await fs.readFile(path.join(filesDir, MUSIC_FILE), 'utf8')).tracks || []) : null;
  const trackIds = tracks ? tracks.map(track => track.id) : null;
  // Production stages: the capability list both arms read, the methods a study requires of both, and the capture.
  const production = config.production ? await (async () => {
    const capabilities = normalizeCapabilities(JSON.parse(await fs.readFile(path.join(filesDir, CAPABILITIES_FILE), 'utf8')), { medium: GAME_MEDIUM_ID });
    const review = capabilities.review.capture;
    return { capabilities, required: capabilities.required, rounds: review.available ? review.rounds : 0, capture: review.available && typeof capture === 'function' ? capture : null, layers: readingLayers({ artDirection, music: Boolean(tracks) }) };
  })() : null;
  const readable = [...READABLE_FILES, ...(tracks ? [MUSIC_FILE] : []), ...(production ? [CAPABILITIES_FILE] : [])];
  const artifacts = production ? [...PRODUCTION_ARTIFACTS] : [...ARTIFACTS];
  const state = { schemaVersion: '1.0', mode: config.mode, startedAt: now().toISOString(), calls: 0, checks: 0,
    pipeline: { status: 'started' }, assumption: null, input: null, dna: null, character: null, measures: null, conformance: null, portraits: [], paint: [], events: [],
    ...(production ? { production: { medium: GAME_MEDIUM_ID, required: production.required, capture: production.capture ? (config.production.capture || 'host') : null, rounds: production.rounds },
      reading: null, plan: null, captures: [], reviews: [], reviewRound: 1 } : {}) };
  let normalized = null;
  const event = (type, message) => { state.events.push({ time: now().toISOString(), type, message: String(message).slice(0, 600) }); };
  const save = () => writeAtomic(path.join(hostDir, 'session.json'), JSON.stringify(state, null, 2));
  // The artifact's own medium, games here, leads the required works when the input has shared qualities.
  const medium = Array.isArray(config.medium) ? config.medium : [];
  const buildInput = assumption => {
    const input = config.mode === 'qloo'
      ? tasteInputFromProfile(profile, assumption, { requiredCount, medium })
      : tasteInputFromAssumption(assumption, { requiredCount, medium });
    // The game reads art styles as render styles and requires the strongest one for the frame.
    return artDirection ? withRenderStyles(input, { measured: config.mode === 'qloo' }) : input;
  };
  // Tags and shared qualities are qualities, not works, so a description or portrait subject may use their words.
  const tasteNames = () => [...(state.input?.entities || []).filter(entity => !isQualityDomain(entity.domain)).map(entity => entity.name),
    ...(state.input?.seeds || []).flatMap(seed => [seed.name, seed.matchedName]), ...(config.knownNames || [])].filter(name => typeof name === 'string');

  const definitions = toolDefinitions({ portraits: Boolean(portraits), music: Boolean(tracks), paint: Boolean(painting), production: production ? { capture: Boolean(production.capture) } : null });
  const painted = () => state.paint.some(item => item.status === 'painted' || item.status === 'requested');
  const paintings = () => state.paint.filter(item => item.status === 'painted').length;
  // The plan's own allowances: the devices it gives a generator, and its painted-rig step.
  const plannedFor = generator => Object.keys(state.plan?.uses?.generators?.[generator]?.devices || {});
  const paintStep = () => state.plan?.steps.find(step => step.method === 'painted-rig') || null;

  async function readFile(file) {
    if (readable.includes(file) || artifacts.includes(file)) {
      try { return await fs.readFile(path.join(filesDir, file), 'utf8'); } catch { return null; }
    }
    return undefined;
  }

  /** A model artifact the host validated: invalid ones are recorded as warnings and named back to the model. */
  const rejected = async (file, error) => {
    if (!(error instanceof TasteProtocolError)) throw error;
    event('warning', `Rejected ${file}: ${error.message}`);
    await save();
    return invalid(file, error);
  };

  async function writeReading(file, content) {
    if (!state.assumption || !state.pipeline.revealedAt) return blocked('Save game-assumption.json and read game_get_taste before saving your reading of the taste input.');
    if (state.dna) return blocked('game-reading.json is frozen: the Character DNA was compiled from it.');
    let reading;
    try { reading = normalizeTasteReading(content, { input: state.input, medium: GAME_MEDIUM_ID, requiredLayers: production.layers }); }
    catch (error) { return rejected(file, error); }
    await fs.writeFile(path.join(filesDir, file), content);
    state.reading = reading;
    Object.assign(state.pipeline, { readAt: now().toISOString(), status: 'read' });
    event('taste', `Taste reading saved: ${reading.clusters.length} clusters over ${reading.stats.refs} refs (${reading.clusters.map(cluster => cluster.name).join('; ')})${reading.setAside.length ? `; ${reading.setAside.length} set aside` : ''}.`);
    await save();
    return reply({ status: 'written', path: file, clusters: reading.clusters.length, setAside: reading.setAside.length,
      next: 'Compile game-dna.json from the refs your reading kept: anchor each device to at least one ref a cluster gathers, and none to a ref you set aside.' });
  }

  async function writePlan(file, content) {
    if (!state.dna) return blocked('Save a valid game-dna.json before the production plan: the plan names how each of its devices is made.');
    if (state.pipeline.constructionStartedAt) return blocked('game-production.json is frozen once character.json is written or the first picture is requested.');
    let plan;
    try {
      plan = normalizeProductionPlan(content, { dna: state.dna, reading: state.reading, capabilities: production.capabilities });
      const paints = plan.steps.filter(step => step.method === 'painted-rig');
      if (paints.length > 1) throw new TasteProtocolError('plan.steps', `One painting paints the whole figure, so plan painted-rig on one device: the one whose look leads the paint. It is planned for ${paints.map(step => step.device).join(', ')}.`);
    } catch (error) { return rejected(file, error); }
    await fs.writeFile(path.join(filesDir, file), content);
    state.plan = plan;
    Object.assign(state.pipeline, { plannedAt: now().toISOString(), status: 'planned' });
    const generated = Object.entries(plan.uses.generators).map(([generator, use]) => `${use.total} ${generator} for ${Object.keys(use.devices).join(', ')}`);
    event('taste', `Production plan saved: ${plan.steps.length} steps with ${listing(plan.uses.methods)}${generated.length ? `; ${generated.join('; ')}` : '; no generator'}; ${plan.review.length} review criteria.`);
    await save();
    const portraitsPlanned = plannedFor('portrait');
    return reply({ status: 'written', path: file, steps: plan.steps.length, methods: plan.uses.methods, criteria: plan.review.length,
      next: portraitsPlanned.length && portraits ? `Request the planned portraits for ${portraitsPlanned.join(', ')} with game_generate_portrait, then write character.json.` : 'Write character.json.' });
  }

  async function writeReview(file, content) {
    if (!state.plan) return blocked('Save game-production.json first: the review judges the criteria your plan lists.');
    if (!production.rounds) return blocked('This run captures nothing to review.', 'TOOL_UNKNOWN');
    if (state.reviewRound > production.rounds) return blocked(`The review is complete: all ${production.rounds} rounds were reviewed.`);
    const round = state.reviewRound;
    const current = state.captures.filter(item => item.round === round);
    if (!current.length) return blocked(`Capture the character with game_capture_review before saving the review of round ${round}.`);
    // A host that records the Kiro session confirms which captures were opened; a scripted session cannot.
    const opened = await openedCapturesSettled({ home: path.join(dir, 'kiro-home'), captures: state.captures, expected: citedCaptures(content) });
    let review;
    try { review = normalizeReview(content, { plan: state.plan, captures: state.captures.map(({ id, round: taken, path: file }) => ({ id, round: taken, path: file })), opened, round, rounds: production.rounds }); }
    catch (error) { return rejected(file, error); }
    await fs.writeFile(path.join(filesDir, file), content);
    state.reviews.push({ ...review, savedAt: now().toISOString(), opened: opened ? current.filter(item => opened.has(item.id)).map(item => item.id) : null,
      after: { character: state.character?.hash || null, paintings: paintings() } });
    state.reviewRound++;
    Object.assign(state.pipeline, { reviewedAt: now().toISOString(), status: 'reviewed' });
    const { met, partly, missed } = review.stats;
    event('review', `Review of round ${round}: ${met} met, ${partly} partly, ${missed} missed${opened ? '; every capture it cites was opened in the session' : '; the scripted session is not audited'}.`);
    await save();
    const open = partly + missed;
    // After a painting the figure is repaired by a second painting, and the rest of character.json by saving it again.
    const repairs = paintStep() && painted()
      ? `Make the repairs you named: the ${REPAIRABLE_AFTER_PAINTING} in character.json, checked with game_check_character, and a defect of the painting with a second painting, when your plan's count allows one`
      : 'Make the repairs you named in character.json, checked with game_check_character';
    // A plan that paints and has not painted yet paints between the rounds, after round 1's repairs.
    const toPaint = painting && paintStep() && !painted() && round < production.rounds ? '; then paint the checked drawing with game_paint_character as your plan says' : '';
    return reply({ status: 'written', path: file, round, ...review.stats,
      next: !open ? `Every criterion is met.${toPaint ? ` Paint the drawing as your plan says, then capture round ${round + 1} with game_capture_review and review the painted figure.` : ' Finish, keeping the DNA and the plan as they are.'}`
        : round < production.rounds ? `${repairs}${toPaint}; then capture round ${round + 1} with game_capture_review and review it.`
          : `${repairs}; this was the last review round.` });
  }

  async function writeArtifact(file, content) {
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return blocked('The file exceeds 128 KiB.', 'TOOL_INPUT_INVALID');
    if (file === 'game-assumption.json') {
      if (state.assumption) return blocked('game-assumption.json is frozen; a prediction cannot change after it is saved.');
      let assumption;
      try { assumption = normalizeCharacterAssumption(content, { domains, artDirection, tracks }); } catch (error) { if (error instanceof TasteProtocolError) return invalid(file, error); throw error; }
      await fs.writeFile(path.join(filesDir, file), content);
      state.assumption = assumption; state.input = buildInput(assumption);
      Object.assign(state.pipeline, { predictedAt: now().toISOString(), status: 'predicted' });
      event('taste', `Prediction frozen: ${assumption.entries.length} entities and qualities across ${domains.length} domains, with a character sketch.`);
      await save();
      return reply({ status: 'written', path: file, next: 'Call game_get_taste to read your taste input.' });
    }
    if (file === 'game-reading.json') return writeReading(file, content);
    if (file === 'game-production.json') return writePlan(file, content);
    if (file === 'game-review.json') return writeReview(file, content);
    if (file === 'game-dna.json') {
      if (!state.assumption || !state.pipeline.revealedAt) return blocked('Save game-assumption.json and read game_get_taste before compiling the Character DNA.');
      if (state.pipeline.constructionStartedAt) return blocked('The Character DNA is frozen once character.json is written or the first portrait is requested.');
      if (production && !state.reading) return blocked('Save game-reading.json first: the DNA anchors to the refs your reading of the taste input keeps.');
      let dna;
      // With production stages a portrait is a method the plan may choose, so the DNA needs an imagery device only when the study requires portraits.
      try { dna = normalizeCharacterDna(production ? applyReadingToDna(content, state.reading) : content, { input: state.input, sketch: state.assumption.characterSketch,
        portraits: production ? production.required.includes('portrait') : Boolean(portraits), artDirection, tracks, departure }); }
      catch (error) { if (error instanceof TasteProtocolError) { event('warning', `Rejected game-dna.json: ${error.message}`); await save(); return invalid(file, error); } throw error; }
      await fs.writeFile(path.join(filesDir, file), content);
      state.dna = dna;
      Object.assign(state.pipeline, { specifiedAt: now().toISOString(), status: 'specified' });
      event('taste', `Character DNA saved: ${dna.devices.length} devices across ${dna.stats.layers.length} layers; ${dna.stats.surpriseAnchoredDevices} rest on entities, tags or qualities the model did not predict, and ${dna.stats.qualityAnchoredDevices} translate qualities.`);
      // A plan describes the DNA it was made for, so a new DNA needs a new plan.
      if (production && state.plan) {
        state.plan = null;
        await fs.rm(path.join(filesDir, 'game-production.json'), { force: true });
        event('taste', 'The production plan was for the earlier DNA; it was set aside and must be saved again.');
      }
      await save();
      return reply({ status: 'written', path: file, devices: dna.devices.length, surpriseAnchoredDevices: dna.stats.surpriseAnchoredDevices,
        next: production ? 'Save game-production.json: one step per device, each with a method capabilities.json lists as available for its layer.'
          : portraits ? 'Request one or two portraits with game_generate_portrait, then write character.json.' : 'Write character.json.' });
    }
    if (!state.dna) return blocked('Save a valid game-dna.json before writing character.json. The DNA is the binding specification for the character.');
    if (production) {
      if (!state.plan) return blocked('Save game-production.json before writing character.json: plan how each device is made before you build it.');
      const planned = plannedFor('portrait');
      if (planned.length && portraits && !state.portraits.some(item => planned.includes(item.device))) return blocked(`Your production plan paints a portrait for ${planned.join(', ')}: request it with game_generate_portrait before writing character.json, so the figure can be drawn to match it.`);
    } else if (portraits && !state.portraits.length) return blocked('This run paints portraits: request at least one with game_generate_portrait from an imagery device of your DNA before writing character.json.');
    if (state.paint.some(item => item.status === 'requested')) return blocked('The drawing is being painted; save character.json once the painting is done.');
    // The skin names pictures the host cut from a painting, so only the host writes it, beside the model's file.
    const parsed = (() => { try { return JSON.parse(content); } catch { return null; } })();
    if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'skin')) return invalid(file, new Error('skin: leave it out; the host adds the painted pieces when game_paint_character paints the drawing.'));
    let character;
    try { character = normalizeCharacter(content, { canon, strict: true, artDirection, tracks: trackIds }); }
    catch (error) { if (error instanceof CharacterFormatError) { event('warning', `Rejected character.json: ${error.message}`); await save(); return invalid(file, error); } throw error; }
    // A painted figure keeps the fields its pieces were cut from.
    const cut = state.paint.findLast(item => item.status === 'painted');
    if (cut && cut.drawing !== paintedDrawing(character)) {
      return blocked(`character.json is frozen where the painting was cut from it: keep ${FROZEN_FIGURE} as painted, with the palette colours its parts and cloth use, or the painted pieces would no longer match them. Its ${REPAIRABLE_AFTER_PAINTING} can still be repaired.`);
    }
    const textFields = [character.description, ...Object.values(character.lines)].join(' ');
    if (/\b(?:qloo|kiro|codex|chatgpt|openai|claude)\b/iu.test(textFields)) return invalid(file, new Error('character.description and lines: the character\'s words never mention Qloo, Kiro, AI models or tools.'));
    await fs.writeFile(path.join(filesDir, file), content);
    normalized = character;
    state.character = { savedAt: now().toISOString(), bytes: Buffer.byteLength(content, 'utf8'), parts: character.parts.length, cloth: character.cloth.length, effects: character.effects.length,
      ...(production ? { hash: digest(content) } : {}) };
    if (!state.pipeline.constructionStartedAt) Object.assign(state.pipeline, { constructionStartedAt: now().toISOString() });
    state.pipeline.status = 'constructed';
    event('file', `Saved character.json: ${character.parts.length} parts, ${character.cloth.length} cloth chains, ${character.effects.length} effects.`);
    await save();
    return reply({ status: 'written', path: file, next: 'Call game_check_character and repair what it reports.' });
  }

  function reveal() {
    if (!state.pipeline.revealedAt) {
      Object.assign(state.pipeline, { revealedAt: now().toISOString(), status: 'revealed' });
      const metrics = state.input.metrics;
      event('taste', config.mode === 'qloo'
        ? `Taste profile revealed after the prediction was frozen: ${metrics.surprises} of ${metrics.measuredEntities} measured entities were neither predicted nor named in the brief.${metrics.measuredTags !== undefined ? ` ${metrics.measuredTags} style and aesthetic tags were measured; ${metrics.tagSurprises} were not predicted.` : ''}${metrics.measuredQualities !== undefined ? ` ${metrics.measuredQualities} qualities are shared by two or more measured works; ${metrics.qualitySurprises} were not predicted.` : ''}${metrics.measuredArtStyles !== undefined ? ` ${metrics.measuredArtStyles} art styles were measured on the works; ${metrics.artStyleSurprises} were not predicted${state.input.renderStyles?.[0] ? `, and the strongest render style is ${state.input.renderStyles[0].name} (${state.input.renderStyles[0].preset})` : ''}.` : ''}`
        : 'The model\'s own prediction became its taste input; no measured taste data exists in this run.');
    }
    const measured = config.mode === 'qloo';
    const measuredDomain = domain => state.input.entities.some(entity => entity.domain === domain && entity.source === 'qloo');
    const tags = state.input.entities.some(entity => isTagDomain(entity.domain));
    const shared = state.input.entities.some(entity => entity.domain === QUALITY_DOMAIN && (!measured || entity.source === 'qloo'));
    // A measured ranking that returned nothing gives way to the measured qualities of the nearest family.
    const tagRef = (domain, family) => measuredDomain(domain) ? `a measured ${domain} ref` : measured && shared ? `a measured ${family} quality (the ${domain} ranking returned no tags)` : `${domain === 'aesthetic' ? 'an' : 'a'} ${domain} ref`;
    const compact = compactTasteInput(state.input);
    // Each art style says which render preset its name names, so the render device's choice is visible before it is made.
    const withPresets = entity => (entity?.domain === ART_STYLE_DOMAIN ? { ...entity, preset: refPreset(entity) } : entity);
    const lead = state.input.renderStyles?.[0];
    const styles = artDirection ? (state.input.renderStyles || []) : [];
    // The qualities whose names a track carries choose the music, so the guidance names them with their tracks.
    const moodFits = tracks ? state.input.entities.filter(entity => isQualityDomain(entity.domain) && entity.domain !== ART_STYLE_DOMAIN && (!measured || entity.source === 'qloo'))
      .map(entity => ({ entity, fits: tracksFor(tracks, entity.tags?.length ? entity.tags : [entity.name]) })).filter(item => item.fits.length) : [];
    const music = !tracks ? '' : !measured ? ' Qualities first for the music too: anchor the music device to one of your predicted qualities and pick a track from music.json whose genres or tags share a word with it.'
      : moodFits.length ? ` Qualities first for the music too: anchor the music device to a measured quality whose name a track in music.json carries, and pick that track: ${moodFits.slice(0, 5).map(({ entity, fits }) => `${entity.name} (${entity.ref}) for ${fits.slice(0, 3).map(item => item.track.id).join(', ')}`).join('; ')}.`
        : ' No measured quality meets a track in music.json, so anchor the music device to a measured ref whose returned tags a track carries.';
    return reply({ status: 'revealed', ...compact, entities: compact.entities.map(withPresets), requiredAnchors: compact.requiredAnchors.map(withPresets),
      ...(artDirection ? { renderStyles: styles } : {}),
      guidance: (measured ? 'Anchor devices to refs. Surprises are measured entities, tags or qualities you did not predict and the brief did not name.' : 'No measured taste data exists in this run. Anchor devices to your own predicted refs.')
        + (shared ? ` Qualities first: anchor the palette device and the silhouette device${artDirection ? ' and the scene device' : ''} each to a ${measured ? 'measured ' : ''}quality ref, so the colours and the figure${artDirection ? ' and the world' : ''} translate what the audience's works share; entities are evidence of the qualities, and their own brand or team colours, logos, packaging, costumes or trade dress are never yours to take.` : '')
        + (tags ? ` Style and aesthetic refs are qualities, not works: anchor a motion device to ${tagRef('style', 'mood')} and a costume or silhouette device to ${tagRef('aesthetic', 'look')}.` : '')
        + (artDirection ? (lead ? ` The strongest render style is ${lead.name} (${lead.ref}), which draws the frame in ${RENDER_PRESETS[lead.preset].label.toLowerCase()} ("${lead.preset}"): anchor the render device to it, or reject it with a reason and anchor it to another art style that names a preset.`
          : ` No ${measured ? 'measured ' : ''}art style names a render preset, so anchor the render device to an art style or a look quality and choose the preset that translates it.`) : '')
        + music,
      ...(production ? { next: `Read the taste input and save game-reading.json before the DNA: two to four clusters of refs that belong together, each resting on a quality, the refs you set aside as noise with a reason, and how the character will carry the clusters. Together the clusters carry ${listing(production.layers)}.` } : {}) });
  }

  async function check() {
    if (!normalized) {
      const saved = await readFile('character.json');
      if (!saved) return blocked('Save character.json before checking it.');
      normalized = normalizeCharacter(saved, { canon, strict: true, artDirection, tracks: trackIds });
    }
    const raster = restRaster(normalized);
    const measures = measureCharacter(normalized, { raster, keeper: config.keeper ? { name: config.keeper.name, figureHeight: config.keeper.figureHeight } : null });
    const conformance = state.dna ? checkCharacterConformance(state.dna, normalized, { measures, portraits: portraits ? state.portraits : null,
      ...(production ? { portraitDevices: new Set(plannedFor('portrait')) } : {}) }) : null;
    const named = mentions([normalized.description, ...Object.values(normalized.lines)].join(' '), tasteNames());
    const warnings = [...measures.warnings, ...(named.length ? [{ code: 'names-entity', message: `The description or lines name ${named.join(', ')}. Translate qualities without naming taste entities.` }] : [])];
    const cell = Math.max(2, measures.height / 34);
    const previews = ['rest', 'walk', 'kindle'].map(pose => asciiPose(normalized, pose, { cell }));
    state.checks++;
    // Painting starts from the drawing the model last checked, never from one it has not seen measured.
    state.checkedSave = state.character?.savedAt || null;
    state.measures = { figureHeight: measures.figureHeight, headShare: measures.headShare, legShare: measures.legShare, height: measures.height, width: measures.width, stride: measures.stride, warnings: warnings.map(item => item.code) };
    state.conformance = conformance && { score: conformance.score, present: conformance.present, partial: conformance.partial, missing: conformance.missing, total: conformance.total };
    event('conformance', conformance ? `Character check: ${conformance.present} present, ${conformance.partial} partial, ${conformance.missing} missing; ${warnings.length} warnings.` : `Character check without a DNA; ${warnings.length} warnings.`);
    await save();
    const { silhouette, bones, visibleColors, ...summary } = measures;
    void silhouette;
    // Painting is offered from the check when the run paints, and with production stages only when the plan chose it.
    const paintable = painting && (!production || paintStep());
    const lines = [
      `CHARACTER CHECK ${state.checks}`,
      `Measures: ${JSON.stringify({ ...summary, warnings: undefined })}`,
      `Part bounds by bone (bind pose): ${JSON.stringify(bones)}`,
      `Most visible colours: ${visibleColors.slice(0, 8).map(item => `${item.hex} ${Math.round(item.share * 100)}%`).join(', ')}`,
      ...(artDirection ? [momentLine(normalized)] : []),
      warnings.length ? `Warnings:\n${warnings.map(item => `- [${item.code}] ${item.message}`).join('\n')}` : 'Warnings: none.',
      conformance ? `DNA conformance: score ${conformance.score} (${conformance.present} present, ${conformance.partial} partial, ${conformance.missing} missing of ${conformance.total}).\n${conformance.devices.map(device => `- ${device.id} ${device.layer} "${device.device}": ${device.status}${device.missing.length ? `; missing ${device.missing.map(item => `${item.kind} ${item.value}${item.detail ? ` (${item.detail})` : ''}`).join('; ')}` : ''}`).join('\n')}` : 'DNA conformance: no DNA saved.',
      ...previews.map(preview => `\nPREVIEW ${preview.pose} (cell ${preview.cell} units tall, ${preview.cell / 2} wide; the light is at ${preview.light ? `[${preview.light.join(', ')}]` : 'no light'}):\n${preview.text}\nLegend: ${preview.legend.join(' | ')}${preview.hidden.length ? `\nNot visible in this pose: ${preview.hidden.join(', ')}` : ''}`),
      ...(paintable ? [paintLines()] : []),
      // A painted plan reviews the vector drawing in round 1, while it can still be repaired, and the painted figure after.
      ...(production?.capture && state.reviewRound <= production.rounds ? [`\nREVIEW: once your repairs are done${!paintable || painted() ? '' : state.reviewRound === 1 ? ', before you paint the drawing' : ' and the drawing is painted'}, capture round ${state.reviewRound} of ${production.rounds} with game_capture_review and judge your plan's criteria in game-review.json.`] : []),
    ];
    return textReply(lines.join('\n'));
  }

  /** The pieces game_paint_character would paint from the current drawing, or what the painting made. */
  function paintLines() {
    const done = state.paint.findLast(item => item.status === 'painted');
    if (done) return `\nPAINTED: ${done.pieces} pieces in the ${done.technique} technique${done.vector?.length ? `; ${done.vector.join(', ')} stay vectors` : ''}. The figure in character.json is frozen, ${FROZEN_FIGURE}; its ${REPAIRABLE_AFTER_PAINTING} can still be repaired.`;
    const pieces = skinPieces(normalized);
    const preset = normalized.render?.preset || 'lit';
    const list = pieces.map(piece => piece.kind === 'layer'
      ? `- ${piece.id}: ${piece.bone}${piece.side === 'center' ? '' : ` (${piece.side})`}, gathers ${piece.parts.map(part => part.id).join(', ')}`
      : `- ${piece.id}: the ${piece.kind === 'strip' ? 'cloth chain' : 'tip of'} ${piece.chain}`);
    return `\nPAINTABLE PIECES for game_paint_character (${pieces.length}; the "${preset}" render preset paints them as ${TECHNIQUES[preset] || TECHNIQUES.lit}):\n${list.join('\n')}`;
  }

  async function paint(args) {
    if (!painting) return blocked('Painting is not available in this run.', 'TOOL_UNKNOWN');
    if (!normalized || !state.character) return blocked('Save character.json and check it with game_check_character before painting it.');
    if (state.checkedSave !== state.character.savedAt) return blocked('Check the saved character.json with game_check_character first, so the pieces you describe are the ones its last check listed.');
    if (production) {
      // The plan states whether the figure is painted and how many paintings it may take; a second one replaces the first.
      const step = paintStep();
      if (!step) return blocked('Your production plan does not paint the character: no step chose painted-rig, so the vector drawing is the finished character.', 'TOOL_INPUT_INVALID');
      const allowance = generationAllowance(state.plan, 'paint', step.device, state.paint.length);
      if (!allowance.allowed) return blocked(allowance.reason, 'TOOL_INPUT_INVALID');
      if (state.paint.length >= painting.perRun) return blocked(`This run already requested ${painting.perRun} painting${painting.perRun > 1 ? 's' : ''}, the limit.`, 'TOOL_INPUT_INVALID');
      // With a review, a second painting repairs what the review of the painted figure found, so that review comes first.
      const reviewedPainting = state.reviews.some(review => state.captures.some(item => item.round === review.round && item.paintings > 0));
      if (production.capture && painted() && !reviewedPainting) return blocked('A second painting repairs what the review of the painted figure found: capture the painted figure with game_capture_review and save its review first.', 'TOOL_INPUT_INVALID');
    } else {
      if (state.paint.some(item => item.status === 'painted')) return blocked('The character is painted already: this run paints it once.', 'TOOL_INPUT_INVALID');
      if (state.paint.length >= painting.perRun) return blocked(`This run already requested ${painting.perRun} painting${painting.perRun > 1 ? 's' : ''}, the limit.`, 'TOOL_INPUT_INVALID');
    }
    const clean = value => String(value).normalize('NFC').trim().replace(/\s+/gu, ' ');
    const style = clean(args.style);
    if (style.length < PAINT_LIMITS.styleMin || style.length > PAINT_LIMITS.styleMax || /[<>\p{Cc}]/u.test(style)) return blocked(`style: describe the painted look in ${PAINT_LIMITS.styleMin}-${PAINT_LIMITS.styleMax} characters of plain text.`, 'TOOL_INPUT_INVALID');
    if (args.pieces !== undefined && !Array.isArray(args.pieces)) return blocked('pieces: give a list of {id, description}.', 'TOOL_INPUT_INVALID');
    const pieces = skinPieces(normalized), ids = pieces.map(piece => piece.id), descriptions = {};
    for (const [index, item] of (args.pieces || []).entries()) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.description !== 'string') return blocked(`pieces[${index}]: give {id, description}.`, 'TOOL_INPUT_INVALID');
      if (!ids.includes(item.id)) return blocked(`pieces[${index}].id: ${JSON.stringify(item.id.slice(0, 40))} is not a piece of this drawing; game_check_character lists ${ids.join(', ')}.`, 'TOOL_INPUT_INVALID');
      const text = clean(item.description);
      if (text.length < PAINT_LIMITS.descriptionMin || text.length > PAINT_LIMITS.descriptionMax || /[<>\p{Cc}]/u.test(text)) return blocked(`pieces[${index}].description: describe the piece in ${PAINT_LIMITS.descriptionMin}-${PAINT_LIMITS.descriptionMax} characters of plain text.`, 'TOOL_INPUT_INVALID');
      descriptions[item.id] = text;
    }
    const words = [style, ...Object.values(descriptions)].join(' ');
    const named = mentions(words, tasteNames());
    if (named.length) return blocked(`Describe what the pieces look like without naming taste entities (${named.slice(0, 4).join(', ')}); translate their qualities into looks, materials and details.`, 'TOOL_INPUT_INVALID');
    if (/\b(?:qloo|kiro|codex|chatgpt|openai|claude)\b/iu.test(words)) return blocked('Describe the painted look, not the tools.', 'TOOL_INPUT_INVALID');
    const preset = normalized.render?.preset || 'lit';
    const record = { status: 'requested', requestedAt: now().toISOString(), technique: TECHNIQUES[preset] ? preset : 'lit', style, descriptions, drawing: paintedDrawing(normalized),
      provider: painter.provider, version: painter.version || null };
    state.paint.push(record);
    if (!state.pipeline.constructionStartedAt) Object.assign(state.pipeline, { constructionStartedAt: now().toISOString() });
    event('image', `Painting ${pieces.length} pieces of character.json in the ${record.technique} technique; the host lays out the blueprint and writes the brief.`);
    await save();
    try {
      const result = await paintCharacter({ character: normalized, style, descriptions, generate: options => painter.generate(options), dir: path.join(dir, 'skin', `paint-${state.paint.length}`),
        source: id => `${painting.prefix}-skin-${id}.png` });
      const { report } = result;
      Object.assign(record, { prompt: report.prompt, durationMs: report.durationMs, description: report.description, key: report.key, registration: report.registration, missing: report.missing });
      if (!result.ok) {
        Object.assign(record, { status: 'failed', error: report.error });
        event('warning', `Painting came back incomplete: ${report.error}`);
        await save();
        const again = state.paint.length < (production ? Math.min(painting.perRun, paintStep()?.count || 0) : painting.perRun);
        return { content: [{ type: 'text', text: `${report.error} ${again ? 'Call game_paint_character once more, describing each piece clearly, or finish with the vector character.' : 'The vector character stays as drawn.'}` }],
          structuredContent: { status: 'error', error: { code: 'PAINT_INCOMPLETE', message: report.error } }, isError: true };
      }
      // The skin lives beside the model's file: character.json stays the model's own drawing, and the pair publishes both together.
      normalizeCharacter({ ...JSON.parse(await fs.readFile(path.join(filesDir, 'character.json'), 'utf8')), skin: result.skin }, { canon, strict: true, artDirection, tracks: trackIds });
      const folder = path.join('skin', `paint-${state.paint.length}`);
      await writeAtomic(path.join(hostDir, 'skin.json'), JSON.stringify({ skin: result.skin, folder: folder.replaceAll('\\', '/'), files: result.files, figure: result.figure }, null, 2));
      const vector = report.missing;
      const moved = report.registration.filter(item => item.moved).map(item => item.id);
      Object.assign(record, { status: 'painted', paintedAt: now().toISOString(), pieces: result.files.length, vector, moved, figure: Boolean(result.figure) });
      event('image', `Painted ${result.files.length} pieces in ${Math.round(report.durationMs / 1000)} s${moved.length ? `; ${moved.join(', ')} moved back to their joints` : ''}${vector.length ? `; ${vector.join(', ')} stay vectors` : ''}.`);
      await save();
      return reply({ status: 'painted', technique: record.technique, pieces: result.files.length, ...(vector.length ? { vector } : {}), ...(moved.length ? { moved } : {}), ...(report.description ? { description: report.description } : {}),
        use: `On screen the painted pieces replace the vector parts, on the same bones and in the same order; cloth without a painted strip and thin cords stay vectors. The figure in character.json is frozen now, ${FROZEN_FIGURE}; its ${REPAIRABLE_AFTER_PAINTING} can still be repaired, checked with game_check_character.` });
    } catch (error) {
      Object.assign(record, { status: 'failed', error: String(error.message || error).slice(0, 300) });
      event('warning', `Painting failed: ${record.error}`);
      await save();
      return { content: [{ type: 'text', text: `The pieces could not be painted: ${record.error} The vector character stays as drawn.` }], structuredContent: { status: 'error', error: { code: 'PAINT_FAILED', message: record.error } }, isError: true };
    }
  }

  async function portrait(args) {
    if (!portraits) return blocked('Portraits are not available in this run.', 'TOOL_UNKNOWN');
    if (!state.dna) return blocked('Save a valid game-dna.json with an imagery device before requesting portraits; the host writes each prompt from that device.');
    if (production) {
      if (!state.plan) return blocked('Save game-production.json first: a portrait is requested only for a device whose step chose the portrait method.');
      const allowance = generationAllowance(state.plan, 'portrait', args.device, state.portraits.filter(item => item.device === args.device).length);
      if (!allowance.allowed) return blocked(allowance.reason, 'TOOL_INPUT_INVALID');
    }
    const attempts = state.portraits.length;
    if (attempts >= portraits.perRun) return blocked(`This run already requested ${portraits.perRun} portrait${portraits.perRun > 1 ? 's' : ''}, the limit.`, 'TOOL_INPUT_INVALID');
    let request;
    try { request = buildImagePrompt({ dna: state.dna, names: tasteNames(), device: args.device, subject: args.subject, aspect: args.aspect ?? 'portrait', attempts, figure: figureFacts(state.dna) }); }
    catch (error) {
      if (!(error instanceof ImageRequestError)) throw error;
      return blocked(error.message.replaceAll('culture-dna.json', 'game-dna.json'), 'TOOL_INPUT_INVALID');
    }
    if (!state.pipeline.constructionStartedAt) Object.assign(state.pipeline, { constructionStartedAt: now().toISOString(), status: 'constructing' });
    const name = `${request.device.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')}-${attempts + 1}`;
    const record = { device: request.device, subject: request.subject, aspect: request.aspect, prompt: request.prompt, provider: images.provider, version: images.version || null, status: 'requested', requestedAt: now().toISOString() };
    state.portraits.push(record);
    event('image', `Painting ${name} from ${request.device}; the host wrote the prompt from that device.`);
    await save();
    try {
      const result = await images.generate({ prompt: request.prompt, directory: path.join(dir, 'generated'), name });
      Object.assign(record, { status: 'generated', path: result.path, format: result.format, width: result.width, height: result.height, bytes: result.bytes, durationMs: result.durationMs, description: result.description || '',
        ...(Array.isArray(result.palette) && result.palette.length ? { palette: result.palette } : {}) });
      event('image', `Generated ${result.path} from ${request.device} in ${Math.round((result.durationMs || 0) / 1000)} s.${record.palette ? ` Its main colours: ${record.palette.slice(0, 6).map(color => color.hex).join(', ')}.` : ''}`);
      await save();
      // The figure is checked against the portrait's colours, so the model learns them before drawing.
      const colors = record.palette ? record.palette.slice(0, 6).map(color => ({ hex: color.hex, share: color.share })) : null;
      return reply({ status: 'generated', device: record.device, width: record.width, height: record.height, aspect: record.aspect, ...(record.description ? { description: record.description } : {}), ...(colors ? { colors } : {}),
        use: colors ? `The portrait is shown beside the game. Draw character.json so both are recognizably the same character: game_check_character looks for at least two of the portrait's main colours (${colors.map(color => color.hex).join(', ')}) among the figure's visible colours, within CIE76 ${CHARACTER_LIMITS.portraitDeltaE}.`
          : 'The portrait is shown beside the game. Draw character.json so both are recognizably the same character.' });
    } catch (error) {
      Object.assign(record, { status: 'failed', error: String(error.message || error).slice(0, 300) });
      event('warning', `Portrait ${name} was not generated: ${record.error}`);
      await save();
      return { content: [{ type: 'text', text: `The portrait could not be generated: ${record.error} Continue without it.` }], structuredContent: { status: 'error', error: { code: 'PORTRAIT_FAILED', message: record.error } }, isError: true };
    }
  }

  /** What the character changed after the last review: a new save of character.json or a new painting. */
  const repairsSince = review => ({ character: Boolean(state.character?.hash && review.after.character !== state.character.hash), painting: paintings() > review.after.paintings });

  async function captureReview(args) {
    if (!production?.capture) return blocked('Capture is not available in this run.', 'TOOL_UNKNOWN');
    if (!state.character || !normalized) return blocked('Save character.json and check it with game_check_character before capturing it.');
    if (state.checkedSave !== state.character.savedAt) return blocked('Check the saved character.json with game_check_character first, so the captures show the drawing its last check measured.');
    if (state.paint.some(item => item.status === 'requested')) return blocked('The drawing is being painted; capture it once the painting is done.');
    const round = state.reviewRound;
    if (round > production.rounds) return blocked(`The review allows ${production.rounds} rounds, and all of them were reviewed.`, 'TOOL_INPUT_INVALID');
    if (args.views !== undefined && (!Array.isArray(args.views) || !args.views.length || args.views.some(id => !VIEW_IDS.includes(id)))) return blocked(`views: name one or more of ${VIEW_IDS.join(', ')}.`, 'TOOL_INPUT_INVALID');
    const wanted = args.views === undefined ? [...VIEW_IDS] : [...new Set(args.views)];
    const taken = new Set(state.captures.filter(item => item.round === round).map(item => item.view));
    const views = GAME_VIEWS.filter(view => wanted.includes(view.id) && !taken.has(view.id));
    if (!views.length) return blocked(`Round ${round} already has ${listing([...taken])}. Review them in game-review.json; after your repairs, capture round ${round + 1}.`, 'TOOL_INPUT_INVALID');
    // The previous round's review named repairs; what changed since is recorded beside it.
    const last = state.reviews.at(-1);
    if (last && !last.repairs) last.repairs = repairsSince(last);
    event('review', `Capturing round ${round}: ${listing(views.map(view => view.id))}${paintings() ? ', painted' : ''}.`);
    await save();
    let shots;
    try { shots = await production.capture({ dir, views, round, outDir: path.join(dir, 'workspace', REVIEW_DIR) }); }
    catch (error) {
      const message = String(error?.message || 'The character could not be captured.').slice(0, 300);
      event('warning', `Capture failed: ${message}`);
      await save();
      return { content: [{ type: 'text', text: `The character could not be captured: ${message} Call game_capture_review again, or finish without a review if it fails again.` }], structuredContent: { status: 'error', error: { code: 'CAPTURE_FAILED', message } }, isError: true };
    }
    const issued = shots.map(shot => ({ id: shot.id, view: shot.view, round, path: `${REVIEW_DIR}/${shot.id}.png`, width: shot.width, height: shot.height, bytes: shot.bytes,
      capturedAt: now().toISOString(), character: state.character.hash || null, paintings: paintings() }));
    state.captures.push(...issued);
    event('review', `Captured ${issued.map(item => item.id).join(', ')}.`);
    await save();
    return reply({ status: 'captured', round, rounds: production.rounds,
      captures: issued.map(({ id, view, path: file, width, height }) => ({ id, view, path: file, width, height, shows: GAME_VIEWS.find(item => item.id === view).shows })),
      next: `Open each capture you cite with your read tool (the paths are relative to your working folder, such as ${issued[0].path}), judge every review criterion of game-production.json against what the captures show, and save game-review.json for round ${round}: {schemaVersion:'1.0',round:${round},criteria:[{id,capture:'${issued[0].id}',verdict:'met'|'partly'|'missed',observed,repair}],summary}.` });
  }

  async function handle(name, args = {}) {
    const definition = definitions.find(tool => tool.name === name);
    if (!definition) return blocked('This tool is not available in this session.', 'TOOL_UNKNOWN');
    if (++state.calls > TOOL_LIMIT) return blocked('The per-session tool limit was reached.', 'TOOL_LIMIT');
    if (!args || typeof args !== 'object' || Array.isArray(args)) return blocked('Arguments must be an object.', 'TOOL_INPUT_INVALID');
    const allowed = Object.keys(definition.inputSchema.properties || {});
    const extra = Object.keys(args).find(key => !allowed.includes(key));
    if (extra !== undefined) return blocked(`${name} does not accept ${JSON.stringify(extra.slice(0, 40))}.`, 'TOOL_INPUT_INVALID');
    for (const key of definition.inputSchema.required || []) if (typeof args[key] !== 'string') return blocked(`${name} needs a string ${key}.`, 'TOOL_INPUT_INVALID');
    try {
      if (name === 'game_list_files') {
        const present = [];
        for (const file of [...readable, ...artifacts]) if ((await readFile(file)) !== null) present.push(file);
        return reply({ files: present });
      }
      if (name === 'game_read_file') {
        const file = args.path.replaceAll('\\', '/').replace(/^\.\//u, '');
        const content = await readFile(file);
        if (content === undefined) return blocked(`Readable files are ${[...readable, ...artifacts].join(', ')}.`, 'SCOPE_INVALID');
        if (content === null) return blocked(`${file} has not been saved yet.`, 'NOT_FOUND');
        return textReply(content);
      }
      if (name === 'game_write_file') {
        const file = args.path.replaceAll('\\', '/').replace(/^\.\//u, '');
        if (!artifacts.includes(file)) return blocked(`Only ${artifacts.join(', ')} can be written${artifacts.includes(file.toLowerCase()) ? `; use the exact lowercase name ${file.toLowerCase()}` : ''}.`, 'SCOPE_INVALID');
        return await writeArtifact(file, args.content);
      }
      if (name === 'game_get_taste') {
        if (!state.assumption) return reply({ status: 'awaiting-prediction', domains, requiredAnchorCount: requiredCount,
          instructions: 'Save game-assumption.json with your own prediction for these domains and your character sketch first. Taste data is revealed only after the prediction is frozen.' });
        const result = reveal();
        await save();
        return result;
      }
      if (name === 'game_check_character') return await check();
      if (name === 'game_generate_portrait') return await portrait(args);
      if (name === 'game_paint_character') return await paint(args);
      if (name === 'game_capture_review') return await captureReview(args);
    } catch (error) {
      event('error', `${name} failed: ${error.message}`);
      await save().catch(() => {});
      return blocked('The tool could not complete.', 'TOOL_EXECUTION_FAILED');
    }
    return blocked('This tool is not available in this session.', 'TOOL_UNKNOWN');
  }

  await save();
  return { handle, definitions, state, policy: armPolicyText(config), get normalized() { return normalized; } };
}
