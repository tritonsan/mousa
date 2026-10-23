// The Taste Provenance report: the records of one design session drawn as a page a reader can follow without opening
// the JSON. It sets the prediction the agent froze before any data beside what Qloo measured, marks each measured name
// new or predicted, and follows the taste through the reading and the Design DNA, token by token, to the captures, the
// review and the check, with the limits. A comparison report sets two arms side by side. The page runs no script and
// carries its own fonts, so it opens from its folder or from any server; record.json holds the same evidence as data,
// with names only: Qloo's ids, affinities, popularity and descriptions stay in the project.

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeTasteName, designDnaStats, isQualityDomain, QUALITY_DOMAIN, ART_STYLE_DOMAIN, STRUCTURAL_DNA_LAYERS, TASTE_LIMITS } from '../culture/taste.mjs';
import { readState, STATE_DIR } from '../production/project-files.mjs';
import { colorDistance, scalePng } from '../production/image-files.mjs';
import { serveDirectory, captureShots } from '../production/capture.mjs';
import { TASTE_QUESTIONS } from '../taste/questions.mjs';
import { sealHolds } from '../taste/seal.mjs';
import { collectProjectFiles, detectDesignSystem } from './systems.mjs';

export const REPORT_SCHEMA_VERSION = '1.0';
/** Where the reports go inside a design folder's .mousa: one session's, and a comparison's in the project folder. */
export const REPORT_FOLDERS = Object.freeze({ session: 'report', comparison: 'compare-report' });
/** The pictures of a report: the whole page at a reading width, and a card at the size link previews use. */
export const REPORT_PICTURES = Object.freeze({ page: Object.freeze({ width: 1280, height: 900, maxHeight: 16000 }), card: Object.freeze({ width: 1200, height: 630 }) });
// The report's own type, from the font library: a soft display serif, a neutral sans and a calm monospace.
const REPORT_FONTS = Object.freeze([['Fraunces', ['normal']], ['Inter', ['normal']], ['DM Mono', ['normal']]]);
const PICTURE_MAX_SIDE = 960;

const DOMAIN_LABELS = Object.freeze({ brand: 'brand', movie: 'film', artist: 'music', book: 'book', tv_show: 'TV', videogame: 'game', podcast: 'podcast', place: 'place',
  destination: 'destination', style: 'pacing', aesthetic: 'surface', tone: 'tone', [ART_STYLE_DOMAIN]: 'art style', [QUALITY_DOMAIN]: 'quality' });
const DOMAIN_GROUPS = Object.freeze({ brand: 'Brands', movie: 'Films', artist: 'Music', book: 'Books', tv_show: 'TV', videogame: 'Games', podcast: 'Podcasts', place: 'Places',
  destination: 'Destinations', style: 'Pacing', aesthetic: 'Surfaces', tone: 'Tone', [ART_STYLE_DOMAIN]: 'Art styles', [QUALITY_DOMAIN]: 'Shared qualities' });
const MEDIUM_LABELS = Object.freeze({ web: 'Website', 'app-ui': 'App interface', game: 'Game', generic: 'Source design' });
const HOST_LABELS = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex', kiro: 'Kiro' });
const KIND_LABELS = Object.freeze({ session: 'Design with Qloo', baseline: 'Design without Qloo', measurement: 'Measurement', comparison: 'Comparison' });
const MARK_LABELS = Object.freeze({ new: 'new', predicted: 'predicted', brief: 'from the brief', own: 'own prediction', unknown: '' });
const LAYER_ORDER = Object.freeze(['palette', 'typography', 'imagery', 'motion', 'voice', 'layout', 'structure', 'interaction']);
const STATUS_LABELS = Object.freeze({ present: 'In the files', partial: 'Partly in the files', missing: 'Not in the files' });
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math']);
const QUESTION_ASKS = new Map(TASTE_QUESTIONS.map(question => [question.id, question.ask]));
const ANSWER_LABELS = Object.freeze({ worlds: '', surprises: 'Not predicted', confirmed: 'Predicted and measured', predictedButNotMeasured: 'Predicted, not measured',
  ranked: 'Ranked for this audience', notFound: 'Not found', otherKinds: 'Of another kind', qualities: '', look: 'Look', mood: 'Mood', meaning: 'Meaning', pacing: 'Pacing',
  surfaces: 'Surfaces', artStyles: 'Art styles', tone: 'Tone', places: 'Places', shared: 'Shared', onlyThisAudience: 'Only this audience', onlyTheOther: 'Only the other audience' });
// What an answer may carry that is not published: Qloo's ids, scores and texts.
const PRIVATE_FIELDS = new Set(['id', 'ids', 'ref', 'entityId', 'audienceId', 'affinity', 'popularity', 'description', 'location', 'note', 'requests', 'fromCache']);

const RECORDS = Object.freeze({ plan: 'taste/plan', prediction: 'taste/prediction', input: 'taste/input', brief: 'taste/brief', decisions: 'taste/decisions',
  reading: 'design/reading', dna: 'design/dna', production: 'design/plan', reviews: 'design/reviews', check: 'design/check', captures: 'captures', images: 'images', usage: 'usage' });

/**
 * A design folder's records as the report reads them: the .mousa records Moûsa's tools wrote, or, for a session made
 * with the earlier tool surface (0.4), the culture-*.json files it kept in the project, whose DNA counts are worked out
 * again from its taste input. Null when the folder holds neither.
 */
export async function readRecords(folder) {
  const root = await fs.realpath(folder).catch(() => null);
  if (!root) return null;
  const saved = Object.fromEntries(await Promise.all(Object.entries(RECORDS).map(async ([key, name]) => [key, await readState(root, name).catch(() => null)])));
  if (!saved.input && !saved.prediction) return legacyRecords(root);
  return { root, legacy: false, medium: saved.dna?.medium || saved.reading?.medium || saved.production?.medium || null, plan: saved.plan, prediction: saved.prediction,
    input: saved.input, brief: saved.brief, decisions: saved.decisions?.decisions || [], reading: saved.reading?.reading || null, dna: saved.dna?.dna || null,
    production: saved.production?.plan || null, reviews: saved.reviews?.reviews || [], check: saved.check, captures: saved.captures?.captures || [],
    images: saved.images?.images || [], usage: saved.usage };
}

async function legacyRecords(root) {
  const read = async name => { try { return JSON.parse(await fs.readFile(path.join(root, name), 'utf8')); } catch { return null; } };
  const input = await read('culture-taste.json');
  if (!input || !Array.isArray(input.entities)) return null;
  const [assumption, dna, reading, production, review] = await Promise.all(['culture-assumption.json', 'culture-dna.json', 'culture-reading.json', 'culture-production.json', 'culture-review.json'].map(read));
  // The earlier surface kept the agent's own names in the taste input with their refs, so the entries come from there.
  const own = input.entities.filter(entity => entity.source === 'model-assumption');
  const prediction = assumption ? { audienceSummary: assumption.audienceSummary, entries: own.map(entity => ({ id: entity.ref, domain: entity.domain, name: entity.name })), designSketch: assumption.designSketch || null } : null;
  return { root, legacy: true, medium: detectDesignSystem(await collectProjectFiles(root)).medium, plan: null, prediction, input, brief: null, decisions: [], reading,
    dna: dna && Array.isArray(dna.devices) ? { ...dna, stats: designDnaStats(dna, input) } : null, production, reviews: Array.isArray(review?.rounds) ? review.rounds : [],
    check: null, captures: (await readState(root, 'captures').catch(() => null))?.captures || [], images: [], usage: null };
}

// ---------------------------------------------------------------------------------------------------------------
// The record: what the page shows, as data.

const hex = value => { const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(String(value ?? '').trim()); return match ? `#${(match[1].length === 3 ? match[1].replace(/./gu, char => char + char) : match[1]).toLowerCase()}` : null; };
const kindOf = entity => entity.domain === QUALITY_DOMAIN && entity.family ? `${entity.family} quality` : DOMAIN_LABELS[entity.domain] || String(entity.domain || 'entry');
const markOf = entity => entity.source !== 'qloo' ? 'own' : entity.surprise ? 'new' : entity.predictedByModel ? 'predicted' : 'brief';
const score = entity => entity.score ?? entity.affinity ?? -1;
const ranked = (list, order = new Map()) => [...list].sort((a, b) => (order.get(normalizeTasteName(a.name)) ?? Infinity) - (order.get(normalizeTasteName(b.name)) ?? Infinity) || score(b) - score(a));
/** The order the Taste Brief listed its names in, so the page shows what the agent read in the order it read it. */
function briefOrder(brief) {
  const names = [...Object.values(brief?.qualities || {}).flat().map(item => item?.name), ...Object.values(brief?.tags || {}).flat(),
    ...Object.values(brief?.worlds || {}).flat().map(item => item?.name)].filter(value => typeof value === 'string').map(value => normalizeTasteName(value.replace(/ \((?:new|predicted)\)$/u, '')));
  const order = new Map();
  names.forEach((name, index) => { if (!order.has(name)) order.set(name, index); });
  return order;
}
const chipOf = entity => ({ name: entity.name, kind: kindOf(entity), mark: markOf(entity) });
const compact = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && !value.length)));
export const listText = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** A ref of the taste input as the page names it: its name, what it is and whether the prediction held it, never its id. */
function namer(input) {
  const byRef = new Map((input?.entities || []).map(entity => [entity.ref, entity]));
  return ref => { const entity = byRef.get(ref); return entity ? chipOf(entity) : { name: 'An entry outside the taste input', kind: 'unknown', mark: 'unknown' }; };
}

const ID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const URN_PATTERN = /\burn:(?:tag|entity|audience)(?::[\w-]+(?:\.[\w-]+)*)+/gu;
// A path runs to the next quote or space, and over a space when what follows still holds a slash, as in
// D:/Qloo Hackathon/plugin; a full stop or comma after it ends the sentence, not the path.
const PATH_RUN = String.raw`(?:[^\s"'\x60<>|)]|[ ](?=[^\s"'\x60<>|)]*[\\/]))*`;
const DRIVE_PATH = new RegExp(String.raw`\b[A-Za-z]:[\\/]${PATH_RUN}`, 'gu');
const HOME_PATH = new RegExp(String.raw`(?<![\w.-])\/(?:home|Users|root)\/${PATH_RUN}`, 'gu');
const localPath = match => `[local path]${/[,.;:]+$/u.exec(match)?.[0] || ''}`;
const SECRET = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b/gu;
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * Text fit to publish: a Qloo id or tag URN becomes the name the taste input gives it, local paths and secret-shaped
 * strings are removed, and `user`, when given, is replaced wherever it stands as a word. `names` maps refs to names.
 */
export function scrubText(value, { names = new Map(), user = null } = {}) {
  let text = String(value ?? '');
  text = text.replace(ID_PATTERN, id => names.get(id) || names.get(id.toUpperCase()) || 'a Qloo entry');
  text = text.replace(URN_PATTERN, urn => names.get(urn) || (urn.startsWith('urn:tag') ? 'a Qloo tag' : urn.startsWith('urn:audience') ? 'a Qloo audience' : 'a Qloo entry'));
  text = text.replace(DRIVE_PATH, localPath).replace(HOME_PATH, localPath).replace(SECRET, '[secret]');
  if (typeof user === 'string' && user.length >= 3) text = text.replace(new RegExp(`\\b${escapeRegExp(user)}\\b`, 'giu'), '[user]');
  return text;
}
const scrubDeep = (value, scrub) => typeof value === 'string' ? scrub(value) : Array.isArray(value) ? value.map(item => scrubDeep(item, scrub))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubDeep(item, scrub)])) : value;

function audienceOf(records) {
  const signal = records.plan?.signal || {}, brief = records.brief?.audience;
  const measured = records.input?.source === 'qloo-profile';
  const named = (signal.references || []).filter(item => (item.role || 'audience') === 'audience').map(item => ({ name: item.name }));
  const references = measured && brief?.references ? brief.references.map(item => compact({ name: item.name, found: item.found !== false,
    as: typeof item.found === 'string' && normalizeTasteName(item.found) !== normalizeTasteName(item.name) ? item.found : null }))
    : measured && !named.length ? (records.input?.seeds || []).map(seed => compact({ name: seed.name, found: seed.resolution !== 'unresolved',
      as: seed.matchedName && normalizeTasteName(seed.matchedName) !== normalizeTasteName(seed.name) ? seed.matchedName : null })) : named;
  const context = (signal.references || []).filter(item => ['brand', 'world-canon'].includes(item.role)).map(item => item.name);
  const segments = brief?.segments ? brief.segments.map(item => compact({ name: item.query, found: item.found !== false, as: typeof item.found === 'string' ? item.found : null }))
    : (signal.segments || []).map(name => ({ name }));
  return compact({ references, segments, context, place: brief?.place || signal.location || null, ages: brief?.ages || signal.ages || null });
}

function titleOf(audience) {
  const names = (audience.references || []).map(item => item.name);
  if (names.length) return `For an audience that loves ${listText(names.slice(0, 5))}${names.length > 5 ? ' and more' : ''}`;
  if (audience.segments?.length) return `For ${listText(audience.segments.map(item => item.name))}`;
  return 'A design led by measured taste';
}

function sketchOf(value) {
  if (!value || typeof value !== 'object') return null;
  return { summary: String(value.summary || ''), palette: (value.palette || []).map(hex).filter(Boolean), fonts: (value.fonts || []).filter(font => typeof font === 'string'),
    sections: (value.sections || []).filter(id => typeof id === 'string'), motifs: (value.motifs || []).filter(item => typeof item === 'string') };
}

function predictionOf(records) {
  const prediction = records.prediction;
  if (!prediction) return null;
  const measured = records.input?.source === 'qloo-profile';
  const own = new Map((records.input?.entities || []).filter(entity => entity.source === 'model-assumption').map(entity => [entity.ref, entity]));
  const byRef = new Map((records.input?.entities || []).map(entity => [entity.ref, entity]));
  const groups = [];
  for (const entry of prediction.entries || []) {
    let group = groups.find(item => item.domain === entry.domain);
    if (!group) groups.push(group = { domain: entry.domain, label: DOMAIN_GROUPS[entry.domain] || entry.domain, quality: isQualityDomain(entry.domain), entries: [] });
    // The match is liberal by design, so a matched name is shown: "Journey" matched the series "Kino's Journey".
    const match = byRef.get(own.get(entry.id)?.confirmedBy);
    group.entries.push(compact({ name: entry.name, measured: measured ? Boolean(match) : null,
      as: match && normalizeTasteName(match.name) !== normalizeTasteName(entry.name) ? `${match.name}${match.domain !== entry.domain ? ` (${kindOf(match)})` : ''}` : null }));
  }
  // A prediction frozen before seals existed has none; a seal that no longer matches says so rather than hiding it.
  const seal = sealHolds(prediction);
  return compact({ frozenAt: prediction.frozenAt || null, ...(seal === null ? {} : { sha256: prediction.sha256, sealHolds: seal }),
    summary: prediction.audienceSummary || null, groups, sketch: sketchOf(prediction.designSketch) });
}

/** What Qloo measured, by the same cuts as the Taste Brief: qualities by family, ranked tags and the works per domain. */
function measuredOf(records) {
  const qloo = (records.input?.entities || []).filter(entity => entity.source === 'qloo');
  if (!qloo.length) return null;
  const order = briefOrder(records.brief);
  const qualities = Object.fromEntries(['look', 'mood', 'meaning'].map(family => [family, ranked(qloo.filter(entity => entity.domain === QUALITY_DOMAIN && entity.family === family), order).slice(0, 5)
    .map(entity => ({ ...chipOf(entity), works: (entity.examples || []).slice(0, 3), domains: (entity.domains || []).map(domain => DOMAIN_LABELS[domain] || domain) }))]));
  const tags = Object.fromEntries([['pacing', 'style'], ['surfaces', 'aesthetic'], ['tone', 'tone'], ['artStyles', ART_STYLE_DOMAIN]]
    .map(([key, domain]) => [key, ranked(qloo.filter(entity => entity.domain === domain), order).slice(0, 6).map(chipOf)]).filter(([, list]) => list.length));
  const worlds = [];
  for (const domain of [...new Set(qloo.filter(entity => !isQualityDomain(entity.domain)).map(entity => entity.domain))]) {
    for (const band of ['core', 'deep-cut']) {
      const works = ranked(qloo.filter(entity => entity.domain === domain && (entity.band || 'core') === band), order).slice(0, band === 'core' ? 4 : 2);
      if (works.length) worlds.push({ label: `${DOMAIN_GROUPS[domain] || domain}${band === 'deep-cut' ? ', lesser known' : ''}`, works: works.map(entity => compact({ ...chipOf(entity), tags: (entity.tags || []).slice(0, 3) })) });
    }
  }
  const metrics = records.input.metrics || {};
  const requests = records.usage?.qlooRequests ?? records.brief?.measured?.requests ?? null;
  const counts = compact({ works: metrics.measuredEntities ?? null, worksPredicted: metrics.predictedByModel ?? null, worksNew: metrics.surprises ?? null,
    qualities: metrics.measuredQualities ?? null, qualitiesPredicted: metrics.qualitiesPredicted ?? null, tags: metrics.measuredTags ?? null, tagsPredicted: metrics.tagsPredicted ?? null,
    artStyles: metrics.measuredArtStyles ?? null, predictions: metrics.predictions ?? null, predictionsMeasured: metrics.predictionsConfirmed ?? null, requests,
    fromCache: records.brief?.measured?.answeredFromCache ?? null });
  const required = qloo.filter(entity => entity.required).map(chipOf);
  return compact({ counts, qualities, tags, worlds, required, cautions: records.brief?.cautions || null });
}

function readingOf(records, name) {
  const reading = records.reading;
  if (!reading) return null;
  return compact({ clusters: (reading.clusters || []).map(cluster => compact({ id: cluster.id, name: cluster.name, reading: cluster.reading, layers: cluster.layers || [],
    refs: (cluster.refs || []).map(name), surprise: cluster.surprise || (cluster.refs || []).some(ref => name(ref).mark === 'new') || null })),
    setAside: (reading.setAside || []).map(item => ({ ...name(item.ref), reason: item.reason })), approach: reading.approach || null });
}

/** The tokens a device declares, without the empty kinds; CSS rules as property: value. */
const tokensOf = (tokens = {}) => compact({ colors: (tokens.colors || []).map(hex).filter(Boolean), fonts: tokens.fonts || [], css: (tokens.css || []).map(rule => `${rule.property}: ${rule.value}`),
  ids: tokens.ids || [], copy: tokens.copy || [], keyframes: tokens.keyframes || [], svg: tokens.svg || [], images: tokens.images || [], literals: tokens.literals || [] });

/** The tokens of a device its frozen sketch did not contain, as the DNA validation recorded them or worked out again. */
function movedOf(device, sketch) {
  if (device.novel) return { colors: device.novel.colors || [], fonts: device.novel.fonts || [], ids: device.novel.ids || [] };
  if (!sketch) return null;
  const fonts = new Set(sketch.fonts.map(normalizeTasteName));
  return { colors: (device.tokens?.colors || []).map(hex).filter(Boolean).filter(color => !sketch.palette.length || Math.min(...sketch.palette.map(other => colorDistance(color, other))) >= TASTE_LIMITS.sketchDeltaE),
    fonts: (device.tokens?.fonts || []).filter(font => !GENERIC_FONTS.has(font.toLowerCase()) && !fonts.has(normalizeTasteName(font))),
    ids: STRUCTURAL_DNA_LAYERS.includes(device.layer) ? (device.tokens?.ids || []).filter(id => !sketch.sections.includes(id)) : [] };
}

function dnaOf(records, name, sketch, pictures) {
  const dna = records.dna;
  if (!dna) return null;
  const steps = new Map((records.production?.steps || []).map(step => [step.device, step]));
  const checked = new Map((records.check?.devices || []).map(item => [item.id, item]));
  const clusters = new Map((records.reading?.clusters || []).map(cluster => [cluster.id, cluster.name]));
  const stats = dna.stats || designDnaStats(dna, records.input);
  const devices = (dna.devices || []).map(device => {
    const anchors = (device.anchors || []).map(name), step = steps.get(device.id), status = checked.get(device.id);
    const moved = movedOf(device, sketch);
    const shown = pictures.filter(picture => picture.device === device.id || (device.tokens?.images || []).includes(picture.path));
    return compact({ id: device.id, layer: device.layer, device: device.device, anchors, qualities: device.qualities || [], translation: device.translation,
      tokens: tokensOf(device.tokens), surprise: Boolean(device.surprise ?? anchors.some(anchor => anchor.mark === 'new')),
      moved: moved && (moved.colors.length || moved.fonts.length || moved.ids.length) ? moved : null,
      method: step?.method || null, why: step?.why || null, cluster: step?.cluster ? clusters.get(step.cluster) || step.cluster : null, count: step?.count || null,
      check: status?.status || null, pictures: shown.map(picture => picture.file).filter(Boolean) });
  });
  return compact({ thesis: dna.thesis, devices, rejected: (dna.rejected || []).map(item => ({ ...name(item.ref), reason: item.reason })),
    stats: compact({ devices: stats.devices, layers: stats.layers, surpriseAnchored: stats.surpriseAnchoredDevices, measuredAnchored: stats.qlooAnchoredDevices,
      predictionAnchored: stats.modelAnchoredDevices, qualityAnchored: stats.qualityAnchoredDevices }) });
}

/** How far the DNA moved from the frozen sketch: each palette colour against its nearest sketch colour, the type and new ids. */
function departureOf(records, sketch) {
  const devices = records.dna?.devices || [];
  if (!sketch || !devices.length) return null;
  const palette = [...new Set(devices.filter(device => device.layer === 'palette').flatMap(device => (device.tokens?.colors || []).map(hex).filter(Boolean)))].map(color => {
    const nearest = sketch.palette.map(other => ({ color: other, delta: colorDistance(color, other) })).sort((a, b) => a.delta - b.delta)[0];
    return compact({ color, nearest: nearest?.color || null, delta: nearest ? Math.round(nearest.delta) : null, moved: !nearest || nearest.delta >= TASTE_LIMITS.sketchDeltaE });
  });
  const sketchFonts = new Set(sketch.fonts.map(normalizeTasteName));
  const fonts = [...new Set(devices.flatMap(device => device.tokens?.fonts || []))].filter(font => !GENERIC_FONTS.has(font.toLowerCase())).map(font => ({ name: font, moved: !sketchFonts.has(normalizeTasteName(font)) }));
  const ids = [...new Set(devices.flatMap(device => movedOf(device, sketch)?.ids || []))];
  return { sketch: { palette: sketch.palette, fonts: sketch.fonts, sections: sketch.sections }, palette, fonts, ids, threshold: TASTE_LIMITS.sketchDeltaE };
}

/** A taste_ask answer as lists of names under readable labels: no ids, affinities or descriptions. */
export function answerLists(answer) {
  const lists = [];
  const walk = (value, label) => {
    if (Array.isArray(value)) {
      const names = value.map(item => typeof item === 'string' ? item : item && typeof item.name === 'string' ? item.name : null).filter(Boolean);
      if (names.length) lists.push({ label: label || 'Answer', names: names.slice(0, 12) });
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (PRIVATE_FIELDS.has(key)) continue;
      const own = ANSWER_LABELS[key] ?? (key === key.toUpperCase() ? key : `${key[0].toUpperCase()}${key.slice(1).replace(/([A-Z])/gu, ' $1').toLowerCase()}`);
      walk(item, [label, own].filter(Boolean).join(' · '));
    }
  };
  walk(answer, '');
  return lists;
}

function decisionsOf(records) {
  return (records.decisions || []).map(item => compact({ question: item.question, ask: QUESTION_ASKS.get(item.question) || item.question, decision: item.decision,
    guess: item.myGuess || null, answer: answerLists(item.answer), requests: Number.isInteger(item.requests) ? item.requests : null }));
}

// The files a report may copy: the captures and pictures Moûsa's tools name, and nothing a record could point elsewhere.
const CAPTURE_FILE = /^\.mousa\/captures\/[A-Za-z0-9_-]{1,120}\.png$/u;
const PICTURE_FILE = /^generated\/[a-z0-9][a-z0-9_-]{0,80}\.(?:png|jpe?g)$/iu;
const safeName = value => String(value).replace(/[^A-Za-z0-9_-]/gu, '-');

const captureLabel = capture => `${capture.specimen ? 'Specimen board' : capture.view}${capture.target ? ` · ${capture.target}` : ''}${capture.full ? ' · full page' : ''}`;

/** The captures of the last reviewed round (or the last round taken), as the report shows them. */
function capturesOf(records, prefix) {
  const all = (records.captures || []).filter(item => typeof item.id === 'string' && CAPTURE_FILE.test(item.path ?? ''));
  if (!all.length) return [];
  const reviewed = (records.reviews || []).map(review => review.round).filter(Number.isInteger);
  const round = reviewed.length ? Math.max(...reviewed) : Math.max(...all.map(item => item.round || 1));
  const cited = new Set(((records.reviews || []).find(review => review.round === round)?.criteria || []).map(item => item.capture));
  return all.filter(item => (item.round || 1) === round).map(item => compact({ id: item.id, round, view: item.specimen ? 'board' : item.view, target: item.target || null,
    full: item.full || null, specimen: item.specimen || null, width: item.width, height: item.height, label: captureLabel(item), cited: cited.has(item.id),
    source: item.path, file: `assets/captures/${prefix}${safeName(item.id)}.png` }));
}

function picturesOf(records, prefix) {
  return (records.images || []).filter(item => item.status === 'registered' && PICTURE_FILE.test(item.path ?? ''))
    .map(item => compact({ device: item.device, path: item.path, provider: item.provider || null, width: item.width, height: item.height,
      fits: item.palette ? item.palette.fits : null, file: `assets/pictures/${prefix}${path.posix.basename(item.path)}` }));
}

function reviewsOf(records) {
  const looks = new Map((records.production?.review || []).map(item => [item.id, item]));
  return [...(records.reviews || [])].sort((a, b) => a.round - b.round).map(review => {
    const criteria = (review.criteria || []).map(item => compact({ id: item.id, device: item.device || looks.get(item.id)?.device || null, look: looks.get(item.id)?.look || null,
      capture: item.capture || null, verdict: item.verdict, observed: item.observed, repair: item.repair || null }));
    const stats = review.stats || { met: criteria.filter(item => item.verdict === 'met').length, partly: criteria.filter(item => item.verdict === 'partly').length, missed: criteria.filter(item => item.verdict === 'missed').length };
    return compact({ round: review.round, summary: review.summary || null, met: stats.met ?? 0, partly: stats.partly ?? 0, missed: stats.missed ?? 0, criteria });
  });
}

function checkOf(records) {
  const check = records.check;
  if (!check) return null;
  const devices = (check.devices || []).map(item => ({ id: item.id, status: item.status }));
  return compact({ score: check.score, system: check.system || null, present: devices.filter(item => item.status === 'present').length, devices, style: check.style || null });
}

function limitsOf(kind, records) {
  const limits = [];
  if (kind !== 'baseline') limits.push('Qloo measured the entities, tags and shared qualities named here and how they relate to this audience. Every colour, font, layout, motion and line drawn from them is the agent\'s interpretation, marked as such.');
  else limits.push('No Qloo data was used: the taste input is the agent\'s own prediction, frozen before the design began.');
  if (kind !== 'baseline') limits.push('A name marked new was not in the prediction the agent froze before any data. Only names are published here: Qloo\'s ids, affinity scores, popularity and descriptions stay in the project.');
  if (records.dna) limits.push('The check shows that the declared tokens are in the files, not that the design is good. The review is the agent\'s own reading of its captures.');
  limits.push('One session is one sample. It shows where this design\'s choices came from, not that people prefer it.');
  if (records.legacy) limits.push('Recorded with the earlier tool surface (0.4), which kept no Taste Brief, no check record and no Qloo request count.');
  return limits;
}

function headlineOf(kind, dna, measured, prediction) {
  if (kind === 'session' && dna?.stats) {
    const { surpriseAnchored: found = 0, devices = 0 } = dna.stats;
    return { value: `${found} of ${devices}`, text: 'design devices rest on what the model did not predict', sentence: `${found} of ${devices} devices rest on what the prediction did not contain.` };
  }
  if (kind === 'measurement' && measured?.counts) {
    const { worksNew = 0, works = 0 } = measured.counts;
    return { value: `${worksNew} of ${works}`, text: 'measured works were not in the model\'s prediction', sentence: `${worksNew} of ${works} measured works were not in the prediction.` };
  }
  const devices = dna?.stats?.devices;
  if (devices) return { value: String(devices), text: 'design devices rest on the model\'s own prediction, with no Qloo data', sentence: `${devices} devices rest on the prediction alone; no Qloo data was used.` };
  const entries = (prediction?.groups || []).reduce((sum, group) => sum + group.entries.length, 0);
  return { value: String(entries), text: 'predicted entries, with no Qloo data yet', sentence: `${entries} entries were predicted; nothing was measured.` };
}

function numbersOf(kind, measured, dna, prediction) {
  const counts = measured?.counts || {};
  const numbers = [];
  if (measured) {
    if (counts.works !== undefined) numbers.push({ value: counts.works, label: `works measured, ${counts.worksPredicted ?? 0} of them predicted` });
    if (counts.qualities !== undefined) numbers.push({ value: counts.qualities, label: `shared qualities, ${counts.qualitiesPredicted ?? 0} predicted` });
    if (counts.tags !== undefined) numbers.push({ value: counts.tags, label: `pacing, surface and tone tags, ${counts.tagsPredicted ?? 0} predicted` });
    if (counts.requests !== undefined) numbers.push({ value: counts.requests, label: 'Qloo requests' });
  } else {
    const entries = (prediction?.groups || []).reduce((sum, group) => sum + group.entries.length, 0);
    numbers.push({ value: entries, label: 'entries in the prediction' }, { value: 0, label: 'Qloo requests' });
  }
  if (dna?.stats && numbers.length < 4) numbers.push({ value: dna.stats.devices, label: `design devices over ${dna.stats.layers?.length ?? 0} layers` });
  return numbers.slice(0, 4);
}

/**
 * The record of one design folder: what the page shows, as data. `prefix` names its assets apart when two arms share
 * a page; `user` is scrubbed from the text wherever it stands as a word.
 */
export function provenance(records, { host = null, version = null, now = Date.now, prefix = '', user = null } = {}) {
  const measuredRun = records.input?.source === 'qloo-profile';
  const kind = measuredRun ? (records.dna ? 'session' : 'measurement') : 'baseline';
  const name = namer(records.input);
  const prediction = predictionOf(records);
  const sketch = prediction?.sketch || null;
  const pictures = picturesOf(records, prefix);
  const dna = dnaOf(records, name, sketch, pictures);
  const measured = measuredRun ? measuredOf(records) : null;
  const audience = audienceOf(records);
  const record = compact({
    schemaVersion: REPORT_SCHEMA_VERSION, kind, generatedAt: new Date(now()).toISOString(), host, writtenBy: version ? { name: 'mousa', version } : null,
    surface: records.legacy ? 'earlier tool surface (0.4)' : null, medium: records.medium, taste: measuredRun ? 'qloo' : 'own prediction',
    title: titleOf(audience), audience, headline: headlineOf(kind, dna, measured, prediction), numbers: numbersOf(kind, measured, dna, prediction),
    prediction, measured, reading: readingOf(records, name), dna, departure: departureOf(records, sketch), decisions: decisionsOf(records),
    reviews: reviewsOf(records), captures: capturesOf(records, prefix), pictures, check: checkOf(records), limits: limitsOf(kind, records),
  });
  const names = new Map((records.input?.entities || []).map(entity => [entity.ref, entity.name]));
  return scrubDeep(record, text => scrubText(text, { names, user }));
}

/** The captures of two arms paired by what they show: the same view and target in each round. */
function pairedViews(a, b) {
  const key = capture => capture.id.replace(/^r\d+-/u, '');
  const keys = [...new Set([...a, ...b].map(key))];
  return keys.map(id => ({ key: id, label: (a.find(item => key(item) === id) || b.find(item => key(item) === id)).label,
    a: a.find(item => key(item) === id) || null, b: b.find(item => key(item) === id) || null }));
}

/**
 * The record of a comparison: two arm records (each from provenance, with its own asset prefix), the distance and the
 * prediction both started from, their captures paired by view and their devices layer by layer.
 */
export function comparison(arms, pair, { host = null, version = null, now = Date.now, links = [] } = {}) {
  const records = arms.map(arm => arm.record);
  const qloo = records.find(record => record.taste === 'qloo') || records[0];
  const layers = LAYER_ORDER.filter(layer => records.some(record => (record.dna?.devices || []).some(device => device.layer === layer)))
    .map(layer => ({ layer, arms: records.map(record => (record.dna?.devices || []).filter(device => device.layer === layer)) }));
  const views = pairedViews(records[0].captures || [], records[1].captures || []);
  const limits = ['One pair is one sample. Model variance alone makes two designs differ, so one distance does not isolate what Qloo changed; repeat the pair before calling a difference the data\'s effect.',
    `The distance is a heuristic over ${pair.measure === 'data' ? 'the palettes, part ids and words of the files the two arms changed differently' : 'palettes, type classes, landmark sections and CSS features'}. It does not measure quality or what people prefer.`,
    'The headline counts devices anchored to what the prediction did not contain. It shows that the data changed the specification, not that the result is better.',
    ...(pair.samePrediction ? [] : ['The two arms did not start from the same frozen prediction, so their difference mixes the taste source with two starting points.'])];
  return compact({ schemaVersion: REPORT_SCHEMA_VERSION, kind: 'comparison', generatedAt: new Date(now()).toISOString(), host, writtenBy: version ? { name: 'mousa', version } : null,
    medium: qloo.medium || records[1].medium || null, title: qloo.title, audience: qloo.audience,
    headline: { value: pair.distance?.overall?.toFixed?.(2) ?? '–', text: 'heuristic distance between the two designs, from 0 (alike) to 1', sentence: qloo.headline?.sentence || null },
    arms: arms.map((arm, index) => compact({ label: arm.label, folder: arm.folder, taste: arm.record.taste, kind: arm.record.kind, headline: arm.record.headline, link: links[index] || null })),
    samePrediction: pair.samePrediction, measure: pair.measure, distance: pair.distance, prediction: qloo.prediction || records[0].prediction || null, measured: qloo.measured || null,
    views, layers, limits, records });
}

// ---------------------------------------------------------------------------------------------------------------
// The page.

const escape = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cssName = value => String(value).replace(/[^A-Za-z0-9 -]/gu, '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`; };
const capital = value => value ? `${value[0].toUpperCase()}${value.slice(1)}` : '';

const chip = item => {
  const note = [item.kind !== 'unknown' ? item.kind : null, MARK_LABELS[item.mark]].filter(Boolean).join(' · ');
  return `<span class="mr-chip" data-mark="${escape(item.mark)}">${escape(item.name)}${note ? ` <small>${escape(note)}</small>` : ''}</span>`;
};
const chips = items => items?.length ? `<div class="mr-chips">${items.map(chip).join('')}</div>` : '';
const swatches = (colors, notes = {}) => colors?.length ? `<div class="mr-swatches">${colors.map(hex).filter(Boolean).map(color => `<span class="mr-swatch"><i style="background:${color}"></i><code>${color}</code>${notes[color] ? `<em>${escape(notes[color])}</em>` : ''}</span>`).join('')}</div>` : '';
const codes = (items, format = value => value) => items?.length ? `<div class="mr-codes">${items.map(item => `<code class="mr-code">${escape(format(item))}</code>`).join('')}</div>` : '';
const section = (id, title, note, body) => body ? `<section class="mr-section" id="${id}"><div class="mr-section-head"><h2>${escape(title)}</h2>${note ? `<p>${escape(note)}</p>` : ''}</div>${body}</section>` : '';
const asset = (base, file) => escape(`${base}${file}`);

function masthead(record) {
  const meta = [KIND_LABELS[record.kind], MEDIUM_LABELS[record.medium] || record.medium, HOST_LABELS[record.host] || record.host,
    record.prediction?.frozenAt ? `Prediction frozen ${day(record.prediction.frozenAt)}` : null,
    record.prediction?.sha256 ? (record.prediction.sealHolds === false ? 'Prediction seal broken' : `Sealed ${record.prediction.sha256.slice(0, 12)}`) : null,
    record.surface ? `Recorded with the ${record.surface}` : null].filter(Boolean);
  const lede =record.dna?.thesis || (record.kind === 'measurement' ? 'What the model expected of this audience, set beside what Qloo measured, before any design was made.' : null);
  return `<header class="mr-masthead"><p class="mr-kicker">Moûsa · Taste Provenance</p><h1>${escape(record.title)}</h1>${lede ? `<p class="mr-lede">${escape(lede)}</p>` : ''}
<p class="mr-meta">${meta.map(item => `<span>${escape(item)}</span>`).join('')}</p></header>`;
}

function headlineBand(record) {
  const headline = record.headline || {};
  const references = record.audience?.references || [];
  return `<div class="mr-headline"><div><p class="mr-big">${escape(headline.value)}</p><p class="mr-big-text">${escape(headline.text)}</p>
${references.length ? `<p class="mr-audience"><span class="mr-label">The audience, as the person named it</span>${references.map(item => `<span class="mr-ref"${item.found === false ? ' data-found="false"' : ''}>${escape(item.name)}${item.as ? ` <small>found as ${escape(item.as)}</small>` : ''}${item.found === false ? ' <small>not found in Qloo</small>' : ''}</span>`).join('')}</p>` : ''}</div>
<div class="mr-numbers">${(record.numbers || []).map(item => `<p class="mr-number"><b>${escape(item.value)}</b><span>${escape(item.label)}</span></p>`).join('')}</div></div>`;
}

function predictionSection(record) {
  const prediction = record.prediction;
  if (!prediction) return '';
  const sketch = prediction.sketch;
  const measured = record.kind !== 'baseline';
  const groups = list => list.map(group => `<div class="mr-group"><p class="mr-label">${escape(group.label)}</p><p class="mr-names">${group.entries.map(entry =>
    `<span${entry.measured ? ' class="mr-hit"' : ''}>${escape(entry.name)}${entry.measured ? ` <small>${escape(entry.as ? `matched ${entry.as}` : 'measured')}</small>` : ''}</span>`).join('')}</p></div>`).join('');
  const qualities = (prediction.groups || []).filter(group => group.quality), works = (prediction.groups || []).filter(group => !group.quality);
  const sketchCard = sketch ? `<div class="mr-card"><p class="mr-label">The design the model would make from it alone</p><p class="mr-sketch">${escape(sketch.summary)}</p>${swatches(sketch.palette)}
${sketch.fonts.length ? `<p class="mr-small">Type: ${escape(listText(sketch.fonts))}</p>` : '<p class="mr-small">Type: none sketched</p>'}${codes(sketch.sections, id => `#${id}`)}
${sketch.motifs.length ? `<ul class="mr-motifs">${sketch.motifs.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}</div>` : '';
  const expected = `<div class="mr-card">${prediction.summary ? `<p class="mr-label">The audience it expected</p><p>${escape(prediction.summary)}</p>` : ''}${groups(qualities)}</div>`;
  const seal = prediction.sha256 ? `<p class="mr-small mr-seal">${prediction.sealHolds === false
    ? 'Sealed at the freeze, but this prediction no longer matches its seal: it was changed afterwards.'
    : `Sealed at the freeze: SHA-256 <code class="mr-code">${escape(prediction.sha256)}</code>. The prediction shown here still matches it.`}</p>` : '';
  return section('prediction', 'Before any data: the model\'s own prediction',
    measured ? 'Frozen before Qloo was asked, so what Qloo adds can be told apart from what the model already assumed. An entry a measured name matches is marked; the match is liberal, so it only lowers what counts as new.' : 'Frozen before the design began. Without Qloo it is the whole taste input.',
    `<div class="mr-grid two">${sketchCard}${expected}</div>${works.length ? `<div class="mr-card mr-predicted-works"><p class="mr-label">The works it expected them to love</p><div class="mr-columns">${groups(works)}</div></div>` : ''}${seal}`);
}

function measuredSection(record) {
  const measured = record.measured;
  if (!measured) return '';
  const families = Object.entries(measured.qualities || {}).filter(([, list]) => list.length).map(([family, list]) => `<div class="mr-card"><p class="mr-label">${escape(capital(family))} qualities</p>
<ul class="mr-qualities">${list.map(item => `<li>${chip({ ...item, kind: null })}${item.works?.length ? `<span class="mr-works">in ${escape(listText(item.works))}</span>` : ''}</li>`).join('')}</ul></div>`).join('');
  const tagLabels = { pacing: 'Pacing', surfaces: 'Surfaces', tone: 'Tone', artStyles: 'Art styles' };
  const tags = Object.entries(measured.tags || {}).map(([key, list]) => `<div class="mr-row"><p class="mr-label">${escape(tagLabels[key] || key)}</p>${chips(list.map(item => ({ ...item, kind: null })))}</div>`).join('');
  const worlds = (measured.worlds || []).map(world => `<div class="mr-card mr-world"><p class="mr-label">${escape(world.label)}</p><ul>${world.works.map(work => `<li>${chip({ ...work, kind: null })}${work.tags?.length ? `<span class="mr-works">${escape(work.tags.join(' · '))}</span>` : ''}</li>`).join('')}</ul></div>`).join('');
  const cautions = measured.cautions?.length ? `<div class="mr-note"><p class="mr-label">Cautions the measurement raised</p><ul>${measured.cautions.map(item => `<li>${escape(item)}</li>`).join('')}</ul></div>` : '';
  return section('measured', 'What Qloo measured', 'What this audience loves, the qualities those works share and the tags ranked for it. New means the prediction did not contain it.',
    `${families ? `<div class="mr-grid three">${families}</div>` : ''}${tags ? `<div class="mr-card mr-tags">${tags}</div>` : ''}${worlds ? `<div class="mr-grid three mr-worlds">${worlds}</div>` : ''}${cautions}`);
}

function readingSection(record) {
  const reading = record.reading;
  if (!reading?.clusters?.length) return '';
  const clusters = reading.clusters.map(cluster => `<div class="mr-card mr-cluster"><p class="mr-label">${escape(cluster.id)} · carries ${escape(listText(cluster.layers || []))}</p><h3>${escape(cluster.name)}</h3>
<p class="mr-interp"><b>Interpretation</b>${escape(cluster.reading)}</p>${chips(cluster.refs)}</div>`).join('');
  const aside = reading.setAside?.length ? `<div class="mr-note"><p class="mr-label">Set aside as noise</p><ul>${reading.setAside.map(item => `<li>${chip(item)} ${escape(item.reason)}</li>`).join('')}</ul></div>` : '';
  return section('reading', 'How the agent read it', 'Before deciding anything, the agent grouped what belongs together. Each cluster rests on a quality; the works are its evidence.',
    `<div class="mr-grid two">${clusters}</div>${reading.approach ? `<p class="mr-approach"><span class="mr-label">How the medium carries it</span>${escape(reading.approach)}</p>` : ''}${aside}`);
}

function deviceTokens(device, { base, fonts, sample }) {
  const tokens = device.tokens || {};
  const parts = [];
  if (tokens.colors) parts.push(swatches(tokens.colors));
  for (const font of tokens.fonts || []) parts.push(fonts.has(normalizeTasteName(font)) ? `<p class="mr-sample" style="font-family:'${cssName(font)}',serif">${escape(sample)}</p><p class="mr-small">${escape(font)}</p>` : `<p class="mr-small">${escape(font)}</p>`);
  for (const line of tokens.copy || []) parts.push(`<blockquote class="mr-copy">${escape(line)}</blockquote>`);
  for (const file of device.pictures || []) parts.push(`<img class="mr-picture" src="${asset(base, file)}" alt="A picture made for ${escape(device.device)}">`);
  const code = [...(tokens.ids || []).map(id => `#${id}`), ...(tokens.svg || []).map(id => `svg#${id}`), ...(tokens.keyframes || []).map(name => `@keyframes ${name}`), ...(tokens.css || []), ...(tokens.literals || []),
    ...(device.pictures?.length ? [] : tokens.images || [])];
  if (code.length) parts.push(codes(code));
  return parts.join('');
}

function dnaSection(record, { base, fonts }) {
  const dna = record.dna;
  if (!dna?.devices?.length) return '';
  const sample = dna.devices.flatMap(device => device.tokens?.copy || [])[0] || dna.thesis || 'The quick brown fox jumps over the lazy dog';
  const ordered = [...dna.devices].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
  const cards = ordered.map(device => {
    const moved = device.moved ? [device.moved.colors.length ? `${device.moved.colors.length} colour${device.moved.colors.length === 1 ? '' : 's'}` : null, device.moved.fonts.length ? `${device.moved.fonts.length} type famil${device.moved.fonts.length === 1 ? 'y' : 'ies'}` : null,
      device.moved.ids.length ? `${device.moved.ids.length} new part${device.moved.ids.length === 1 ? '' : 's'}` : null].filter(Boolean) : [];
    return `<article class="mr-device"${device.surprise ? ' data-surprise="true"' : ''}><div class="mr-device-top"><span class="mr-layer">${escape(device.layer)} · ${escape(device.id)}</span>${device.check ? `<span class="mr-status" data-status="${escape(device.check)}">${escape(STATUS_LABELS[device.check] || device.check)}</span>` : ''}</div>
<h3>${escape(device.device)}</h3><div><p class="mr-label">Anchored to</p>${chips(device.anchors)}</div>${device.qualities?.length ? `<p class="mr-small">Translates: ${escape(device.qualities.join(' · '))}</p>` : ''}
<p class="mr-interp"><b>Interpretation</b>${escape(device.translation)}</p>${deviceTokens(device, { base, fonts, sample })}
${device.method ? `<p class="mr-method">Made with <b>${escape(device.method)}</b>${device.count ? ` ×${escape(device.count)}` : ''}${device.cluster ? ` for “${escape(device.cluster)}”` : ''}${device.why ? `: ${escape(device.why)}` : ''}</p>` : ''}
${moved.length ? `<p class="mr-moved">Away from the sketch: ${escape(listText(moved))}</p>` : ''}</article>`;
  }).join('');
  const rejected = dna.rejected?.length ? `<div class="mr-note"><p class="mr-label">Required anchors rejected, with the reason</p><ul>${dna.rejected.map(item => `<li>${chip(item)} ${escape(item.reason)}</li>`).join('')}</ul></div>` : '';
  const stats = dna.stats || {};
  return section('dna', 'The Design DNA', `${stats.devices ?? dna.devices.length} binding devices with literal tokens the check looks for in the files. ${record.kind === 'baseline' ? 'Each rests on the model\'s own prediction.' : `${stats.surpriseAnchored ?? 0} rest on what the prediction did not contain.`}`,
    `<div class="mr-devices">${cards}</div>${rejected}`);
}

function departureSection(record) {
  const departure = record.departure;
  if (!departure || (!departure.palette.length && !departure.fonts.length && !departure.ids.length)) return '';
  const notes = Object.fromEntries(departure.palette.map(item => [item.color, item.nearest ? `ΔE ${item.delta} from ${item.nearest}` : 'no sketch colour']));
  const moved = departure.palette.filter(item => item.moved).length;
  return section('departure', 'Away from the sketch', `The design's palette, type and parts against the sketch frozen with the prediction. A colour counts as moved at a CIE76 difference of ${departure.threshold} or more from every sketch colour.`,
    `<div class="mr-grid two"><div class="mr-card"><p class="mr-label">Sketch palette</p>${swatches(departure.sketch.palette)}<p class="mr-label">Design palette: ${moved} of ${departure.palette.length} moved</p>${swatches(departure.palette.map(item => item.color), notes)}</div>
<div class="mr-card"><p class="mr-label">Type</p><p>${departure.sketch.fonts.length ? `Sketch: ${escape(listText(departure.sketch.fonts))}.` : 'The sketch named no type.'} ${departure.fonts.length ? `Design: ${departure.fonts.map(item => `${escape(item.name)}${item.moved ? ' (new)' : ''}`).join(', ')}.` : 'The design names no type.'}</p>
<p class="mr-label">Parts</p><p>Sketch sections: ${escape(departure.sketch.sections.map(id => `#${id}`).join(' ')) || 'none'}</p>${departure.ids.length ? `<p class="mr-small">New in the design</p>${codes(departure.ids, id => `#${id}`)}` : '<p class="mr-small">No new parts.</p>'}</div></div>`);
}

function decisionsSection(record) {
  if (!record.decisions?.length) return '';
  const cards = record.decisions.map(item => `<div class="mr-card mr-decision"><p class="mr-label">${escape(item.ask)}</p><h3>${escape(item.decision)}</h3>
${item.guess ? `<p class="mr-guess"><span class="mr-label">The agent's guess, written first</span>${escape(item.guess)}</p>` : ''}
<div class="mr-answer"><span class="mr-label">Qloo's answer${Number.isInteger(item.requests) ? `, ${item.requests} request${item.requests === 1 ? '' : 's'}` : ''}</span>${item.answer.map(list => `<p><b>${escape(list.label)}</b> ${escape(list.names.join(', '))}</p>`).join('') || '<p>No answer recorded.</p>'}</div></div>`).join('');
  return section('decisions', 'Questions asked while designing', 'Each question was asked with the agent\'s own guess written first, so the answer\'s difference stays visible.', `<div class="mr-grid two">${cards}</div>`);
}

// Captures load at once: the page's own picture is taken at its full height without scrolling.
function capturesBlock(captures, base, label = '') {
  return captures?.length ? `<div class="mr-shots">${captures.map(capture => `<figure class="mr-shot"><img src="${asset(base, capture.file)}" alt="${escape(`${label}${capture.label}, round ${capture.round}`)}" width="${escape(capture.width)}" height="${escape(capture.height)}">
<figcaption>${escape(capture.label)} · round ${escape(capture.round)}${capture.cited ? ' · judged in the review' : ''}</figcaption></figure>`).join('')}</div>` : '';
}

function criteriaBlock(criteria) {
  return `<div class="mr-criteria">${criteria.map(item => `<div class="mr-criterion"><span class="mr-verdict" data-verdict="${escape(item.verdict)}">${escape(item.verdict)}</span><div>
${item.look ? `<p class="mr-look">${escape(item.look)}</p>` : ''}<p><span class="mr-label">Observed${item.capture ? ` in ${escape(item.capture)}` : ''}</span>${escape(item.observed)}</p>${item.repair ? `<p class="mr-repair"><span class="mr-label">Repair</span>${escape(item.repair)}</p>` : ''}</div></div>`).join('')}</div>`;
}

function resultSection(record, base) {
  if (!record.captures?.length) return '';
  const last = (record.reviews || []).at(-1);
  return section('result', 'The result', last ? `The captures of round ${last.round}, the last the agent reviewed: ${last.met} criteria met, ${last.partly} partly, ${last.missed} missed.` : 'The last captures taken.', capturesBlock(record.captures, base));
}

/** The last round's verdicts in full; of the earlier rounds, only what was not met and the repair it got. */
function reviewSection(record) {
  const reviews = record.reviews || [];
  if (!reviews.length) return '';
  const last = reviews.at(-1);
  const earlier = reviews.slice(0, -1).map(review => {
    const open = review.criteria.filter(item => item.verdict !== 'met');
    return `<div class="mr-round"><p><b>Round ${escape(review.round)}</b>: ${escape(review.met)} met, ${escape(review.partly)} partly, ${escape(review.missed)} missed.${review.summary ? ` ${escape(review.summary)}` : ''}</p>${open.length ? criteriaBlock(open) : ''}</div>`;
  }).join('');
  return section('review', 'The review', 'The agent judged each criterion of its plan on the captures it took, then repaired what fell short. The verdicts are its own.',
    `${last.summary ? `<p class="mr-approach mr-first">${escape(last.summary)}</p>` : ''}${criteriaBlock(last.criteria)}${earlier ? `<div class="mr-earlier"><p class="mr-label">What earlier rounds found short, and the repairs</p>${earlier}</div>` : ''}`);
}

function checkSection(record) {
  const check = record.check;
  if (!check) return '';
  const style = check.style?.atStart && check.style?.now ? `<p class="mr-small">Styling at the start: ${escape(check.style.atStart.handWritten)} hand-written declarations and ${escape(check.style.atStart.classes)} classes; now ${escape(check.style.now.handWritten)} and ${escape(check.style.now.classes)}.</p>` : '';
  return section('check', 'The check', 'Whether each device\'s declared tokens are in the project\'s files, through its own design system.',
    `<div class="mr-card"><p class="mr-check"><b>${escape(Number(check.score).toFixed(2))}</b> conformance · ${escape(check.present)} of ${escape(check.devices.length)} devices in the files${check.system ? ` · design system: ${escape(check.system)}` : ''}</p>
<div class="mr-codes">${check.devices.map(item => `<span class="mr-code" data-status="${escape(item.status)}">${escape(item.id)} ${escape(item.status)}</span>`).join('')}</div>${style}</div>`);
}

const limitsSection = record => section('limits', 'Limits', '', `<ul class="mr-limits">${(record.limits || []).map(item => `<li>${escape(item)}</li>`).join('')}</ul>`);

/** The sections of a session's page, for this report and for pages that set it inside their own, with `base` before asset paths. */
export function renderSections(record, { base = '', fonts = [] } = {}) {
  const loaded = new Set(fonts.map(normalizeTasteName));
  return [masthead(record), headlineBand(record), resultSection(record, base), predictionSection(record), measuredSection(record), readingSection(record),
    dnaSection(record, { base, fonts: loaded }), departureSection(record), decisionsSection(record), reviewSection(record), checkSection(record), limitsSection(record)].join('\n');
}

function comparisonSections(record, { base = '', fonts = [] } = {}) {
  const loaded = new Set(fonts.map(normalizeTasteName));
  const [a, b] = record.arms;
  const parts = record.measure === 'data' ? [['palette', 'Palette'], ['structure', 'Part ids'], ['voice', 'Words']] : [['palette', 'Palette'], ['typography', 'Type'], ['structure', 'Sections'], ['features', 'CSS features']];
  const meta = [KIND_LABELS.comparison, MEDIUM_LABELS[record.medium] || record.medium, HOST_LABELS[record.host] || record.host, record.prediction?.frozenAt ? `Prediction frozen ${day(record.prediction.frozenAt)}` : null,
  ].filter(Boolean);
  const head = `<header class="mr-masthead"><p class="mr-kicker">Moûsa · Comparison</p><h1>${escape(record.title)}</h1><p class="mr-lede">${escape(`${a.label} and ${b.label}: the same brief, ${record.samePrediction ? 'the same frozen prediction' : 'two different predictions'} and the same stages. Only the source of the taste differs.`)}</p>
<p class="mr-meta">${meta.map(item => `<span>${escape(item)}</span>`).join('')}</p></header>`;
  const band = `<div class="mr-headline"><div><p class="mr-big">${escape(record.headline.value)}</p><p class="mr-big-text">${escape(record.headline.text)}</p>
<p class="mr-parts">${parts.map(([key, label]) => record.distance?.[key] !== undefined ? `<span><b>${escape(Number(record.distance[key]).toFixed(2))}</b> ${escape(label)}</span>` : '').join('')}</p></div>
<div class="mr-numbers">${record.arms.map(arm => `<p class="mr-number"><b>${escape(arm.headline?.value ?? '')}</b><span>${escape(arm.label)}: ${escape(arm.headline?.text ?? '')}</span></p>`).join('')}
<p class="mr-number"><b>${record.samePrediction ? 'Same' : 'Different'}</b><span>frozen prediction in both arms</span></p></div></div>`;
  const views = record.views.length ? section('side-by-side', 'Side by side', 'The last reviewed captures of each arm, paired by what they show.', record.views.map(view => `<div class="mr-pair-view"><p class="mr-label">${escape(view.label)}</p><div class="mr-pair">${[[a, view.a], [b, view.b]].map(([arm, capture]) =>
    `<figure class="mr-shot">${capture ? `<img src="${asset(base, capture.file)}" alt="${escape(`${arm.label}: ${capture.label}`)}" width="${escape(capture.width)}" height="${escape(capture.height)}">` : '<div class="mr-missing">No capture of this view</div>'}<figcaption>${escape(arm.label)}</figcaption></figure>`).join('')}</div></div>`).join('')) : '';
  const prediction = predictionSection({ ...record, kind: 'session' });
  const measured = measuredSection({ measured: record.measured ? { ...record.measured, worlds: (record.measured.worlds || []).slice(0, 3) } : null });
  const layers = record.layers.length ? section('layers', 'Layer by layer', 'Each arm\'s devices for the same layer of the design.', `<div class="mr-layers">${record.layers.map(row => `<div class="mr-layer-row"><p class="mr-layer">${escape(row.layer)}</p>${row.arms.map((devices, index) =>
    `<div class="mr-card"><p class="mr-label">${escape(record.arms[index].label)}</p>${devices.length ? devices.map(device => `<div class="mr-mini"><h3>${escape(device.device)}</h3>${chips(device.anchors)}${deviceTokens({ ...device, tokens: { ...device.tokens, css: undefined, literals: undefined } }, { base, fonts: loaded, sample: device.tokens?.copy?.[0] || device.device })}</div>`).join('') : '<p class="mr-small">No device in this layer.</p>'}</div>`).join('')}</div>`).join('')}</div>`) : '';
  const reviews = section('reviews', 'Each arm\'s own review', 'The agent of each arm judged its own captures against its own plan.', `<div class="mr-grid two">${record.records.map((arm, index) => {
    const last = (arm.reviews || []).at(-1);
    return `<div class="mr-card"><p class="mr-label">${escape(record.arms[index].label)}</p>${last ? `<p><b>Round ${escape(last.round)}</b>: ${escape(last.met)} met, ${escape(last.partly)} partly, ${escape(last.missed)} missed.</p>${last.summary ? `<p class="mr-small">${escape(last.summary)}</p>` : ''}` : '<p class="mr-small">No review recorded.</p>'}
${arm.check ? `<p class="mr-small">Check: ${escape(Number(arm.check.score).toFixed(2))}, ${escape(arm.check.present)} of ${escape(arm.check.devices.length)} devices in the files.</p>` : ''}${record.arms[index].link ? `<p><a href="${escape(record.arms[index].link)}">${escape(record.arms[index].label)}: the full report</a></p>` : ''}</div>`;
  }).join('')}</div>`);
  return [head, band, views, prediction, measured, layers, reviews, limitsSection(record)].join('\n');
}

export const REPORT_CSS = `.mr{--paper:#f7f7fc;--surface:#fff;--ink:#202139;--ink-soft:#45455f;--muted:#66667e;--line:#e3e2ef;--violet:#7855cf;--violet-deep:#6340b5;--violet-soft:#f2edfc;--violet-line:#dccff7;--apricot-soft:#fff5e6;--apricot-ink:#8a5a12;--met:#267b67;--partly:#94590f;--missed:#ad3f58;
--display:'Fraunces',Georgia,'Times New Roman',serif;--text:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--mono:'DM Mono',ui-monospace,Consolas,monospace;color:var(--ink);font:16px/1.55 var(--text);-webkit-font-smoothing:antialiased}
.mr *{box-sizing:border-box}:where(.mr) :is(h1,h2,h3,p,figure,blockquote,ul){margin:0}:where(.mr) ul{padding-left:18px}
.mr-page{max-width:1180px;margin:0 auto;padding:56px 40px 64px}
.mr-kicker{font:600 12px/1.2 var(--text);letter-spacing:.16em;text-transform:uppercase;color:var(--violet-deep)}
.mr h1{font:600 46px/1.06 var(--display);letter-spacing:-.015em;margin-top:14px;max-width:980px}
.mr-lede{margin-top:16px;font-size:19px;line-height:1.5;color:var(--ink-soft);max-width:860px}
.mr-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:18px}.mr-meta span{font-size:12.5px;color:var(--ink-soft);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.mr-headline{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:32px;align-items:center;margin-top:36px;padding:32px 36px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:0 18px 40px -28px rgba(99,64,181,.45)}
.mr-big{font:600 78px/.95 var(--display);letter-spacing:-.02em;color:var(--violet-deep)}.mr-big-text{margin-top:10px;font-size:18px;color:var(--ink-soft);max-width:470px}
.mr-audience{display:flex;flex-wrap:wrap;gap:6px;margin-top:22px}.mr-audience .mr-label{width:100%}.mr-ref{font-size:14px;padding:3px 10px;border-radius:8px;background:var(--paper);border:1px solid var(--line)}.mr-ref small{color:var(--muted)}.mr-ref[data-found=false]{opacity:.7;text-decoration:line-through}
.mr-numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 24px}.mr-number b{display:block;font:600 32px/1 var(--display)}.mr-number span{display:block;margin-top:5px;font-size:13px;line-height:1.35;color:var(--muted)}
.mr-parts{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.mr-parts span{font-size:13px;color:var(--ink-soft);background:var(--paper);border-radius:8px;padding:4px 10px}.mr-parts b{font-family:var(--mono);font-weight:500}
.mr-section{margin-top:64px}.mr-section-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:8px 32px;padding-bottom:12px;margin-bottom:24px;border-bottom:1px solid var(--line)}
.mr h2{font:600 30px/1.15 var(--display);letter-spacing:-.01em}.mr-section-head p{color:var(--muted);font-size:14.5px;max-width:620px}.mr h3{font:600 16px/1.35 var(--text)}
.mr-label{display:block;font:600 11.5px/1.4 var(--text);letter-spacing:.11em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.mr-small{font-size:13.5px;color:var(--ink-soft)}.mr-seal{margin-top:12px}.mr-seal .mr-code{overflow-wrap:anywhere}
.mr-grid{display:grid;gap:20px}.mr-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.mr-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.mr-grid + *{margin-top:20px}
.mr-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:12px;min-width:0}
.mr-chips{display:flex;flex-wrap:wrap;gap:6px}.mr-chip{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font-size:13.5px;line-height:1.35}
.mr-chip small{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.mr-chip[data-mark=new]{background:var(--violet-soft);border-color:var(--violet-line);color:var(--violet-deep)}.mr-chip[data-mark=new] small{color:var(--violet)}
.mr-chip[data-mark=own]{border-style:dashed}.mr-chip[data-mark=brief]{background:var(--paper)}
.mr-swatches{display:flex;flex-wrap:wrap;gap:10px}.mr-swatch{width:72px}.mr-swatch i{display:block;height:46px;border-radius:10px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
.mr-swatch code{display:block;margin-top:5px;font:11px/1.2 var(--mono);color:var(--muted)}.mr-swatch em{display:block;margin-top:2px;font:10.5px/1.25 var(--mono);font-style:normal;color:var(--violet-deep)}
.mr-codes{display:flex;flex-wrap:wrap;gap:6px}.mr-code{font:12px/1.45 var(--mono);background:#f3f2f8;border-radius:6px;padding:2px 8px;color:var(--ink-soft);overflow-wrap:anywhere}
.mr-code[data-status=partial]{background:#fdf1de;color:var(--partly)}.mr-code[data-status=missing]{background:#fbe9ee;color:var(--missed)}
.mr-sketch{font:500 18px/1.45 var(--display);font-style:italic}.mr-motifs{color:var(--ink-soft);font-size:14px}
.mr-group{display:flex;flex-direction:column}.mr-names{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14.5px}.mr-names small{color:var(--violet);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}.mr-hit{font-weight:600}
.mr-qualities{list-style:none;padding:0;display:flex;flex-direction:column;gap:10px}.mr-qualities li,.mr-world li{display:flex;flex-direction:column;align-items:flex-start;gap:3px}.mr-works{font-size:12.5px;color:var(--muted);padding-left:4px}
.mr-world ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:9px}.mr-tags{gap:14px}.mr-row{display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px;align-items:baseline}
.mr-note{margin-top:20px;padding:16px 20px;border-radius:14px;background:var(--surface);border:1px dashed var(--line)}.mr-note ul{display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--ink-soft)}
.mr-interp{padding:10px 14px;border-radius:10px;background:var(--apricot-soft);color:#3f3220;font-size:14.5px}.mr-interp b{display:block;font:600 10.5px/1.4 var(--text);letter-spacing:.12em;text-transform:uppercase;color:var(--apricot-ink);margin-bottom:2px}
.mr-approach{margin-top:20px;font-size:15.5px;color:var(--ink-soft);max-width:900px}
.mr-devices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.mr-device{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 24px;display:flex;flex-direction:column;gap:12px;min-width:0}
.mr-device[data-surprise=true]{border-color:var(--violet-line);box-shadow:inset 3px 0 0 var(--violet)}.mr-device-top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.mr-layer{font:600 11.5px/1.2 var(--text);letter-spacing:.12em;text-transform:uppercase;color:var(--violet-deep)}.mr-device h3,.mr-cluster h3,.mr-decision h3{font:600 21px/1.25 var(--display)}
.mr-status{font-size:12px;padding:2px 9px;border-radius:999px;background:#e8f4ef;color:var(--met);white-space:nowrap}.mr-status[data-status=partial]{background:#fdf1de;color:var(--partly)}.mr-status[data-status=missing]{background:#fbe9ee;color:var(--missed)}
.mr-sample{font-size:28px;line-height:1.15;overflow-wrap:anywhere}.mr-copy{font:500 17px/1.45 var(--display);font-style:italic;border-left:3px solid var(--violet-line);padding-left:12px}
.mr-picture{display:block;max-width:100%;max-height:300px;border-radius:10px;border:1px solid var(--line)}.mr-method{font-size:13.5px;color:var(--ink-soft)}.mr-method b{font:500 13px var(--mono)}.mr-moved{font-size:13px;font-weight:600;color:var(--violet-deep)}
.mr-guess,.mr-answer{font-size:14.5px}.mr-answer{display:flex;flex-direction:column;gap:6px}.mr-answer b{font-weight:600}
.mr-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;align-items:start}.mr-shot{min-width:0}.mr-shot img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid var(--line);background:#fff}
.mr-shot figcaption{margin-top:8px;font-size:13px;color:var(--muted)}.mr-missing{display:grid;place-items:center;min-height:200px;border-radius:12px;border:1px dashed var(--line);color:var(--muted);font-size:14px}
.mr-criteria{display:grid;gap:12px;margin-top:20px}.mr-criterion{display:grid;grid-template-columns:96px minmax(0,1fr);gap:16px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:14px}
.mr-criterion > div{display:flex;flex-direction:column;gap:8px;font-size:14.5px}.mr-look{font-weight:600}.mr-repair{color:var(--partly)}
.mr-verdict{font:600 11.5px/1 var(--text);letter-spacing:.1em;text-transform:uppercase;padding:7px 10px;border-radius:999px;text-align:center;align-self:start;background:#e8f4ef;color:var(--met)}
.mr-verdict[data-verdict=partly]{background:#fdf1de;color:var(--partly)}.mr-verdict[data-verdict=missed]{background:#fbe9ee;color:var(--missed)}
.mr-earlier{margin-top:28px}.mr-round{margin-top:12px;padding:16px 18px;border-radius:14px;border:1px solid var(--line);background:var(--surface)}.mr-round > p{font-size:14px;color:var(--ink-soft)}.mr-round .mr-criteria{margin-top:12px}.mr-first{margin-top:0}
.mr-predicted-works{margin-top:20px}.mr-columns{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px 28px}
.mr-check b{font:600 30px/1 var(--display);margin-right:6px}.mr-limits{display:flex;flex-direction:column;gap:8px;color:var(--ink-soft);font-size:15px;max-width:900px}
.mr-pair-view + .mr-pair-view{margin-top:28px}.mr-pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
.mr-layers{display:flex;flex-direction:column;gap:16px}.mr-layer-row{display:grid;grid-template-columns:120px minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}.mr-layer-row > .mr-layer{padding-top:22px}
.mr-mini{display:flex;flex-direction:column;gap:10px}.mr-mini + .mr-mini{padding-top:14px;border-top:1px solid var(--line)}.mr-mini h3{font:600 17px/1.3 var(--display)}
.mr a{color:var(--violet-deep)}.mr-footer{margin-top:64px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
@media (max-width:820px){.mr-page{padding:32px 16px 48px}.mr h1{font-size:32px}.mr-headline{grid-template-columns:1fr;padding:24px 20px}.mr-big{font-size:56px}
.mr-grid.two,.mr-grid.three,.mr-devices,.mr-pair{grid-template-columns:1fr}.mr-criterion,.mr-row{grid-template-columns:1fr}.mr-layer-row{grid-template-columns:1fr}.mr-layer-row > .mr-layer{padding-top:0}}`;

const CARD_CSS = `html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#f7f7fc}
.mr-cardpage{display:grid;grid-template-columns:620px 580px;width:1200px;height:630px}.mr-cardtext{padding:54px 44px 46px 56px;display:flex;flex-direction:column;min-height:0}
.mr-cardtitle{margin-top:18px;font:600 31px/1.16 var(--display);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.mr-cardbig{margin-top:auto;font:600 100px/.9 var(--display);letter-spacing:-.025em;color:var(--violet-deep)}.mr-cardline{margin-top:12px;font-size:21px;line-height:1.3;color:var(--ink-soft)}
.mr-cardfoot{margin-top:22px;font-size:14px;color:var(--muted)}.mr-cardvisual{position:relative;background:#202139;overflow:hidden}
.mr-cardvisual img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}.mr-cardpair{display:grid;grid-template-rows:1fr 1fr;height:100%;gap:4px;background:#202139}
.mr-cardpair figure{position:relative;margin:0;overflow:hidden}.mr-cardpair figcaption{position:absolute;left:14px;top:12px;font:600 12px/1 var(--text);letter-spacing:.1em;text-transform:uppercase;color:#fff;background:rgba(32,33,57,.72);padding:6px 9px;border-radius:999px}
.mr-cardpalettes{position:absolute;left:22px;right:22px;bottom:22px;background:rgba(255,255,255,.95);border-radius:14px;padding:13px 16px;display:grid;gap:8px}
.mr-cardpalettes p{display:flex;align-items:center;gap:7px}.mr-cardpalettes span{width:70px;font:600 11px/1 var(--text);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}.mr-cardpalettes i{width:36px;height:22px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
.mr-cardqualities{padding:54px 40px;display:flex;flex-direction:column;gap:12px}.mr-cardqualities .mr-chip{font-size:20px;padding:8px 16px}`;

/** The card: a 1200 by 630 summary of the report, for link previews and the gallery. */
export function renderCard(record, { base = '', fontCss = '' } = {}) {
  const comparing = record.kind === 'comparison';
  const shots = comparing ? record.views.find(view => view.a && view.b) : null;
  const first = !comparing ? (record.captures || []).find(item => item.cited && !item.specimen) || (record.captures || [])[0] : null;
  const strip = (label, colors) => colors?.length ? `<p><span>${escape(label)}</span>${colors.slice(0, 7).map(hex).filter(Boolean).map(color => `<i style="background:${color}"></i>`).join('')}</p>` : '';
  const palettes = record.departure ? `<div class="mr-cardpalettes">${strip('Sketch', record.departure.sketch.palette)}${strip('Design', record.departure.palette.map(item => item.color))}</div>` : '';
  const newQualities = Object.values(record.measured?.qualities || {}).flat().filter(item => item.mark === 'new').slice(0, 6);
  const visual = shots ? `<div class="mr-cardpair">${[[record.arms[0], shots.a], [record.arms[1], shots.b]].map(([arm, capture]) => `<figure><img src="${asset(base, capture.file)}" alt=""><figcaption>${escape(arm.label)}</figcaption></figure>`).join('')}</div>`
    : first ? `<img src="${asset(base, first.file)}" alt="">${palettes}` : newQualities.length ? `<div class="mr-cardqualities">${newQualities.map(item => chip({ ...item, kind: null })).join('')}</div>${palettes}` : palettes;
  const foot = [comparing ? KIND_LABELS.comparison : KIND_LABELS[record.kind], MEDIUM_LABELS[record.medium] || record.medium, HOST_LABELS[record.host] || record.host].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(record.title)}</title><style>${fontCss}\n${REPORT_CSS}\n${CARD_CSS}</style></head>
<body class="mr"><div class="mr-cardpage"><div class="mr-cardtext"><p class="mr-kicker">Moûsa · ${comparing ? 'With Qloo and without' : 'Taste Provenance'}</p><p class="mr-cardtitle">${escape(record.title)}</p>
<p class="mr-cardbig">${escape(record.headline?.value)}</p><p class="mr-cardline">${escape(record.headline?.text)}</p><p class="mr-cardfoot">${escape(foot)}</p></div><div class="mr-cardvisual">${visual}</div></div></body></html>`;
}

/** The sections of a session's or a comparison's record, for a page that sets them inside its own. */
export const renderBody = (record, options = {}) => record.kind === 'comparison' ? comparisonSections(record, options) : renderSections(record, options);

/**
 * A stylesheet for pages that show reports from a server: @font-face rules for the library's families at `url` (where
 * the server serves fonts/<file>), loaded only by the text that uses them, and the report's own styles.
 */
export function reportStylesheet(library, { url = '/library/' } = {}) {
  const rules = (library?.families || []).flatMap(family => family.faces.map(face =>
    `@font-face{font-family:'${cssName(family.family)}';src:url('${url}${face.path}') format('woff2');font-weight:${face.weight};font-style:${face.style};font-display:swap}`));
  return `${rules.join('\n')}\n${REPORT_CSS}\n`;
}

/** The page of a session or a comparison record. */
export function renderReport(record, { base = '', fontCss = '', fonts = [] } = {}) {
  const body = renderBody(record, { base, fonts });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(record.title)} · Moûsa</title>
<style>${fontCss}\nbody{margin:0;background:#f7f7fc}\n${REPORT_CSS}</style></head><body class="mr"><main class="mr-page">
${body}
<footer class="mr-footer">Written by Moûsa${record.writtenBy ? ` ${escape(record.writtenBy.version)}` : ''} from the design's own records on ${escape(day(record.generatedAt))}. Only names are published: Qloo's ids, affinity scores, popularity and descriptions stay in the project.</footer>
</main></body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Files.

/** The library fonts a record's page loads: the report's own and the families its DNA names, at most four of those. */
function fontsFor(records) {
  const named = [...new Set(records.flatMap(record => (record.dna?.devices || []).flatMap(device => device.tokens?.fonts || [])))].filter(font => !GENERIC_FONTS.has(font.toLowerCase())).slice(0, 4);
  return [...REPORT_FONTS, ...named.map(font => [font, ['normal']])];
}

/**
 * @font-face rules for `families` from the font library, embedded as data so the page also opens from its folder, and
 * the font files with their OFL licences to keep beside it. Families the library lacks are left to the fallbacks.
 */
export async function fontFaces(library, families) {
  const rules = [], files = [], loaded = [];
  for (const [name, styles] of families) {
    const family = library?.families?.find(item => normalizeTasteName(item.family) === normalizeTasteName(name));
    if (!family || loaded.includes(family.family)) continue;
    loaded.push(family.family);
    for (const face of family.faces.filter(item => styles.includes(item.style))) {
      const bytes = await fs.readFile(face.file).catch(() => null);
      if (!bytes) continue;
      rules.push(`@font-face{font-family:'${cssName(family.family)}';src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');font-weight:${face.weight};font-style:${face.style};font-display:block}`);
      files.push({ from: face.file, to: `assets/fonts/${path.basename(face.file)}` });
    }
    const licence = path.basename(family.licenseRepositoryPath || '');
    if (licence && family.faces[0]) files.push({ from: path.join(path.dirname(family.faces[0].file), licence), to: `assets/fonts/${licence}` });
  }
  return { css: rules.join('\n'), files, families: loaded };
}

/** What a record's page copies from its design folder: the captures it shows and the pictures its devices list. */
function assetsOf(root, record) {
  return [...(record.captures || []).map(capture => ({ from: path.join(root, ...capture.source.split('/')), to: capture.file })),
    ...(record.pictures || []).map(picture => ({ from: path.join(root, ...picture.path.split('/')), to: picture.file, scale: true }))];
}

async function writeFolder(dir, { html, card, record, assets }) {
  // The folder is the report's own, so it is written afresh: nothing of an earlier report stays behind.
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  const copied = [];
  for (const item of assets) {
    const target = path.join(dir, ...item.to.split('/'));
    const bytes = await fs.readFile(item.from).catch(() => null);
    if (!bytes) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, item.scale ? scalePng(bytes, PICTURE_MAX_SIDE) : bytes);
    copied.push(item.to);
  }
  await fs.writeFile(path.join(dir, 'index.html'), html);
  await fs.writeFile(path.join(dir, 'card.html'), card);
  await fs.writeFile(path.join(dir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  return ['index.html', 'card.html', 'record.json', ...copied];
}

/**
 * Write one design folder's report into `dir` (by default its .mousa/report): the page, the card, the record and their
 * assets. Returns the record and the files written, relative to `dir`.
 */
export async function writeSessionReport({ records, dir = path.join(records.root, STATE_DIR, REPORT_FOLDERS.session), library = null, host = null, version = null, now = Date.now, user = null }) {
  const record = provenance(records, { host, version, now, user });
  const faces = await fontFaces(library, fontsFor([record]));
  const html = renderReport(record, { fontCss: faces.css, fonts: faces.families });
  const card = renderCard(record, { fontCss: (await fontFaces(library, REPORT_FONTS)).css });
  const files = await writeFolder(dir, { html, card, record: { ...record, fonts: faces.families.map(family => ({ family, license: 'OFL-1.1' })) }, assets: [...assetsOf(records.root, record), ...faces.files] });
  return { dir, record, files };
}

/**
 * Write a comparison of two design folders into `dir` (by default the project's .mousa/compare-report). `arms` are
 * [{folder, label, records}], `pair` is pairDistance's result and `links` the pages of the arms' own reports, if any.
 */
export async function writeComparisonReport({ arms, pair, dir, library = null, host = null, version = null, now = Date.now, user = null, links = [] }) {
  const prefixes = ['a-', 'b-'];
  const named = arms.map((arm, index) => ({ ...arm, record: provenance(arm.records, { host, version, now, user, prefix: prefixes[index] }) }));
  const record = comparison(named, pair, { host, version, now, links });
  const faces = await fontFaces(library, fontsFor(named.map(arm => arm.record)));
  const html = renderReport(record, { fontCss: faces.css, fonts: faces.families });
  const card = renderCard(record, { fontCss: (await fontFaces(library, REPORT_FONTS)).css });
  const assets = [...named.flatMap(arm => assetsOf(arm.records.root, arm.record)), ...faces.files];
  const files = await writeFolder(dir, { html, card, record: { ...record, fonts: faces.families.map(family => ({ family, license: 'OFL-1.1' })) }, assets });
  return { dir, record, files };
}

/**
 * The pictures of a written report: report.png, the whole page at a reading width, and card.png, served from the
 * report's folder and captured by one browser. `shoot` stands in for captureShots in tests.
 */
export async function captureReport(dir, { browser, env = process.env, shoot = captureShots } = {}) {
  const served = await serveDirectory(dir, { entry: 'index.html' });
  try {
    const { page, card } = REPORT_PICTURES;
    const shots = await shoot({ browser, env, timeoutMs: 90000, shots: [
      { url: `${served.url}/index.html`, width: page.width, height: page.height, full: true, maxHeight: page.maxHeight, out: path.join(dir, 'report.png') },
      { url: `${served.url}/card.html`, width: card.width, height: card.height, out: path.join(dir, 'card.png') }] });
    return { report: { file: 'report.png', width: shots[0].width, height: shots[0].height }, card: { file: 'card.png', width: shots[1].width, height: shots[1].height } };
  } finally { await served.close(); }
}
