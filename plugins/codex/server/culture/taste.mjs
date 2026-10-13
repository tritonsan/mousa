import { QLOO_RESULT_TYPES, QLOO_AGE_BANDS, QLOO_AUDIENCE_WEIGHTS, AUDIENCE_ID } from '../qloo/client.mjs';

export const TASTE_SCHEMA_VERSION = '1.0';
/**
 * Tag domains measure qualities rather than works: Qloo's tags ranked by affinity for the whole audience. Style is the
 * pacing and look of the films and TV it likes; aesthetic is the visual and material properties of what it likes.
 * A live probe for the Gather audience returned, for example, Quiet, Pensive, Dreamlike and Deadpan, and Sculptural,
 * Textural and Fluid Silhouettes. Motion translates style tags and illustration translates aesthetic tags.
 */
export const TASTE_TAG_DOMAINS = Object.freeze({
  style: Object.freeze({ tagTypes: Object.freeze(['urn:tag:style:qloo']), parentTypes: Object.freeze(['movie', 'tv_show']) }),
  aesthetic: Object.freeze({ tagTypes: Object.freeze(['urn:tag:aesthetic_property:qloo']) }),
  // The emotional tone of what the audience likes, for voice: a live probe on 2026-10-13 returned Thoughtful,
  // Introspective, Inspiring and Melancholic for the Gather seeds. Plugin plans ask for it; Studio's defaults do not.
  tone: Object.freeze({ tagTypes: Object.freeze(['urn:tag:emotional_tone:qloo']) }),
});
export const TAG_DOMAINS = Object.freeze(Object.keys(TASTE_TAG_DOMAINS));
// Qualities the host aggregates from the typed tags Qloo returns on the measured works; never requested on their own.
export const QUALITY_DOMAIN = 'qualities';
// Art styles are aggregated the same way from the works' art_style tags, such as Pixel Art, Hand-drawn or Cel-Shaded.
export const ART_STYLE_DOMAIN = 'art_style';
export const TASTE_DOMAINS = Object.freeze(['brand', 'movie', 'artist', 'book', 'tv_show', 'videogame', 'podcast', 'place', 'destination', ...TAG_DOMAINS, QUALITY_DOMAIN, ART_STYLE_DOMAIN]);
export const DEFAULT_TASTE_DOMAINS = Object.freeze(['brand', 'movie', 'artist', 'book', 'tv_show', 'style', 'aesthetic', QUALITY_DOMAIN]);
/**
 * Qloo tag types grouped by what they describe, for design: look sets palette, type and imagery, mood sets motion and
 * voice, meaning sets voice and structure. The grouping is the host's; the tags, the works carrying them and their
 * affinities are Qloo's. Recorded Gather and Echo Atlas passes returned these types on most works.
 */
export const QUALITY_FAMILIES = Object.freeze({
  look: Object.freeze(['urn:tag:aesthetic_property:qloo', 'urn:tag:art_style:qloo', 'urn:tag:style:qloo']),
  mood: Object.freeze(['urn:tag:emotional_tone:qloo', 'urn:tag:plot:qloo', 'urn:tag:music:qloo', 'urn:tag:artist:qloo', 'urn:tag:character:qloo']),
  meaning: Object.freeze(['urn:tag:theme:qloo', 'urn:tag:archetype:qloo', 'urn:tag:audience:qloo', 'urn:tag:core_value:qloo', 'urn:tag:interests:qloo', 'urn:tag:lifestyle:qloo']),
});
// Catalogue metadata rather than taste, such as platforms, business models and age ranges.
const METADATA_TAG_TYPES = new Set(['urn:tag:platform:qloo', 'urn:tag:business_model:qloo', 'urn:tag:brand_type:qloo', 'urn:tag:brand_subtype:qloo',
  'urn:tag:age_ranges:qloo', 'urn:tag:competitor_brand:qloo', 'urn:tag:wikipedia_category:wikidata', 'urn:tag:influenced_by:qloo']);
const FAMILY_OF = new Map(Object.entries(QUALITY_FAMILIES).flatMap(([family, types]) => types.map(type => [type, family])));
const ART_STYLE_TAG_TYPE = 'urn:tag:art_style:qloo';
const tagType = id => typeof id === 'string' ? id.split(':').slice(0, 4).join(':') : '';
export const DEEP_CUT_DOMAINS = Object.freeze(['brand', 'movie']);
export const DNA_LAYERS = Object.freeze(['palette', 'typography', 'layout', 'imagery', 'voice', 'structure', 'interaction', 'motion']);
export const STRUCTURAL_DNA_LAYERS = Object.freeze(['layout', 'structure', 'interaction', 'imagery']);
export const TASTE_LIMITS = Object.freeze({
  references: 8, calls: 24, perDomain: 10, perTagDomain: 8, domains: 10, requiredAnchors: 6, maxRequiredRejections: 2,
  minDevices: 5, maxDevices: 10, deepCutPopularityMax: 0.6, conformanceThreshold: 0.75, sketchDeltaE: 20, illustrationShapes: 8,
  qualitiesPerFamily: 6, qualityAnchors: 3, artStyles: 8,
});
export const isTagDomain = domain => Object.hasOwn(TASTE_TAG_DOMAINS, domain);
/** Domains the host derives from the measured works' typed tags instead of requesting them. */
export const isDerivedDomain = domain => domain === QUALITY_DOMAIN || domain === ART_STYLE_DOMAIN;
/** Refs that are qualities rather than works: ranked style and aesthetic tags, the aggregated qualities and art styles. */
export const isQualityDomain = domain => isTagDomain(domain) || isDerivedDomain(domain);

export const TASTE_POLICY_TEXT = `# Taste-led design policy

Use this workflow when a host or user chooses measured cultural taste to govern a design. It applies to websites first and equally to games, RPG material, writing and other creative artifacts. The creative decision policy still decides whether cultural research is warranted and how provenance is kept; this policy defines how measured taste becomes a binding design specification. All saved artifacts are English.

1. Predict before you look. Before reading any taste data, record what you expect this audience to like in the same domains the profile covers, such as brands, films, music artists, books and TV: three to six real names per domain, from your own knowledge only. For the style and aesthetic domains, predict three to six qualities instead: the pacing and look of the films and TV the audience likes, and the visual and material properties of what it likes. For the qualities domain, predict three to six moods, themes or looks you expect its favorite works to share. Then sketch the design you would make from that expectation alone: one sentence, a palette, one to three font families, the major sections and a few visual motifs. Prediction and sketch are frozen once saved. In a run without Qloo the prediction is the entire taste input and the sketch is your own starting point. In a Qloo run they separate measured signal from what you already assumed and would have designed.

2. Read the measured profile. A Qloo taste profile contains resolved seeds, cross-domain neighbors with affinity, popularity and tags, and a lower-popularity band. It also contains style and aesthetic tags ranked by affinity for the audience as a whole, and qualities: the look, mood and meaning tags that two or more measured works share, ranked by the affinity of those works and the number of domains they span. Measured entities, tags and qualities your prediction did not contain, and that the brief did not already name, form the surprise set: signal that exists only because Qloo was consulted. When the profile has qualities, the host requires the strongest quality of each family and the works most central to the qualities; otherwise it selects required anchors from the highest-affinity entities across domains, favoring surprises.

3. Compile a Design DNA. Translate the taste input into five to ten named, concrete design devices across at least four layers: palette, typography, layout, imagery, voice, structure, interaction and motion. Palette and typography are required, plus at least one of layout, structure, interaction or imagery. Each device names its anchor entities, explains the translation as your interpretation and declares literal tokens a host can check: hex colors, font families every visitor can load, CSS property values, keyframes names, element IDs, SVG illustration IDs or visible copy. Adjectives are not devices. "Calm and minimal" is not a device; "square 1:1 frames that widen on selection", anchored to a specific film, is. Every required anchor becomes a device or is rejected with a specific reason; at most two required anchors may be rejected.

Qualities come first. When the taste input has qualities, the palette and the typography each anchor to a quality, a measured one in a measured run, so the colors and the type translate what the audience's works share; the entities are evidence of it. Never take an entity's own brand or team colors, logo, packaging or trade dress.

When the taste input contains surprises, they must move the design, not just relabel it. Devices anchored to surprise entities or qualities name the returned tags they translate. Together they depart from your frozen sketch in three places: palette colors far from every sketch color, a type system outside the sketch fonts used for headings or body text, and at least one new major section or component. Devices anchored to your own predictions may follow the sketch. A run without surprises keeps its sketch as its starting point, so the departure measures what the measured data changed.

Motion and illustration are layers of the DNA, like color and type. When the taste input has style refs, a motion device anchored to one translates it into tempo, easing, rhythm and what moves, and declares the keyframes or transitions it uses. When it has aesthetic refs, a device anchored to one draws an original SVG illustration with real detail and declares its ID. In a measured run each anchors to a measured tag when its domain returned tags; when it returned none, motion anchors to a measured mood quality and illustration to a measured look quality instead. Motion honors a reduced-motion preference, and an animation that loops for more than five seconds can be paused.

Voice is a layer too. Keep the artifact's structure and every product fact, but write its narrative, such as the headline, introductions, headings, calls to action and item descriptions, in the register of a voice device anchored to the taste input, a measured ref in a measured run. Declare lines you wrote as its copy tokens. The words are yours: translate the anchor's qualities, never its lyrics, dialogue or slogans.

When the host provides a font library, typography uses only its families, loaded from local files with @font-face, so the type the DNA names is the type every visitor sees.

When the host provides a photo library, use only its photographs. A device lists the photos it uses, and each photo must carry one of the device's qualities among its tags, so in a measured run the returned tags choose the pictures. The device then treats its photos with at least two of its own palette colors through a filter or blend mode, so they take on the page's look instead of bringing their own.

When the host can also generate images, the DNA includes at least one imagery device, and before construction its imagery devices request one or more images within the host's limit. You describe only what a picture shows; the host writes the prompt from that device's name, colors and qualities, so in a measured run the returned tags direct the picture. A subject never names a taste entity, generated images carry no text, logos, recognizable people or copyrighted characters, and the site uses every image it received.

4. Build to the DNA. The DNA is binding. Implement every device with its declared tokens, keep product facts, protected files and accessibility intact, and do not fall back to a generic default look where a device specifies otherwise. Transform qualities, never copy logos, artwork, stills, lyrics or trade dress. Visitor-facing pages never mention Qloo, agents or APIs.

5. Check conformance. Compare the saved files with the DNA and repair missing devices before finishing. Conformance shows that declared tokens exist in the artifact, not that the design is good or that visitors prefer it.

Keep provenance honest. Qloo supplies entities, tags and relationships, never design tokens: every color, font, layout, motion or copy choice is your labeled interpretation of an entity or tag. Never invent entities, seeds, affinities or explainability; an unresolved reference stays unresolved and an empty profile is reported, not replaced. A run without Qloo follows the same steps with its own prediction as the taste input, so the only difference between the two arms is where taste comes from. Attribution metrics such as the share of devices anchored to surprise entities, prediction overlap and design distance are bounded heuristics: they show that measured data changed the specification and the output, not that the result is better.
`;

const INTERPRETATION = 'Aggregate Qloo cultural affinity for the resolved seeds. Entities are cultural relationships, not design tokens, individual preferences or quality scores.';
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'with', 'at', 'in', 'on', 'for', 'to', 'from', 'by', 'my', 'our', 'their', 'his', 'her', 'its']);
const GENERIC = new Set(['music', 'film', 'films', 'movie', 'movies', 'cinema', 'game', 'games', 'videogame', 'videogames', 'book', 'books', 'novel', 'novels',
  'series', 'show', 'shows', 'tv', 'television', 'band', 'artist', 'artists', 'brand', 'brands', 'album', 'albums', 'genre', 'genres', 'style', 'songs', 'podcast', 'podcasts']);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const ELEMENT_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,119}$/u;
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial']);
const REFERENCE_ROLES = ['audience', 'creator-inspiration', 'brand', 'world-canon'];
const REFERENCE_ORIGINS = ['user-provided', 'existing-context', 'agent-selected'];

export class TasteProtocolError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'TasteProtocolError';
    this.code = 'TASTE_PROTOCOL_INVALID';
    this.path = path;
  }
}

function fail(path, message) { throw new TasteProtocolError(path, message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function parsed(value, path) {
  if (typeof value !== 'string') return value;
  if (value.length > 131072) fail(path, 'The artifact exceeds 128 KiB.');
  try { return JSON.parse(value); } catch { fail(path, 'The artifact must contain valid JSON.'); }
}
function object(value, path, fields) {
  if (!plain(value)) fail(path, 'An object is required.');
  const extra = Object.keys(value).find(key => !fields.includes(key));
  if (extra !== undefined) fail(path, `Unsupported field ${JSON.stringify(extra.slice(0, 60))}; allowed fields are ${fields.join(', ')}.`);
}
function text(value, path, { min = 1, max = 1000 } = {}) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(path, `Text of ${min}-${max} characters is required.`);
  const result = value.trim().replace(/\s+/gu, ' ');
  if (result.length < min || result.length > max) fail(path, `Text of ${min}-${max} characters is required.`);
  return result;
}
function list(value, path, { min = 0, max }) {
  if (value === undefined && min === 0) return [];
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, min ? `An array with ${min}-${max} items is required.` : `An array with at most ${max} items is required.`);
  return value;
}
function choice(value, options, path) {
  if (!options.includes(value)) fail(path, `Use one of: ${options.join(', ')}.`);
  return value;
}
const round = (value, digits = 4) => typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined;

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => { while (next < items.length) { const index = next++; results[index] = await worker(items[index], index); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}

/** Lowercase, accent-free and punctuation-free; a leading article is ignored. */
export function normalizeTasteName(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    .replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^(?:the|a|an) /u, '');
}
function significant(value) { return normalizeTasteName(value).split(' ').filter(token => token && !STOPWORDS.has(token) && !GENERIC.has(token)); }

/** Strict catalogue match: both recall and precision of meaningful words, so "ambient music" is not "Ambient Music Therapy". */
export function tasteNameMatch(query, candidate) {
  const q = normalizeTasteName(query), c = normalizeTasteName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  const queryTokens = significant(query), candidateTokens = significant(candidate);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens), querySet = new Set(queryTokens);
  const recall = queryTokens.filter(token => candidateSet.has(token)).length / queryTokens.length;
  const precision = candidateTokens.filter(token => querySet.has(token)).length / candidateTokens.length;
  return Math.min(recall, precision);
}

/** Liberal prediction match: when unsure, an entity counts as predicted, which only lowers surprise claims. */
export function predictionMatches(a, b) {
  const x = normalizeTasteName(a), y = normalizeTasteName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = significant(a), ys = significant(b);
  if (!xs.length || !ys.length) return false;
  const [small, large] = xs.length <= ys.length ? [xs, new Set(ys)] : [ys, new Set(xs)];
  if (small.length === 1 && small[0].length < 4) return false;
  return small.every(token => large.has(token));
}

export function normalizeTasteDomains(value = DEFAULT_TASTE_DOMAINS) {
  const domains = [...new Set(list(value, 'domains', { min: 1, max: TASTE_LIMITS.domains }).map((domain, index) => {
    const type = typeof domain === 'string' ? domain.replace(/^urn:entity:/u, '') : domain;
    // Tag domains are requested as urn:tag results and qualities are aggregated by the host, so only entity domains
    // must be Qloo entity result types.
    if (!TASTE_DOMAINS.includes(type) || (!isQualityDomain(type) && !QLOO_RESULT_TYPES.includes(type))) fail(`domains[${index}]`, `Use taste domains from: ${TASTE_DOMAINS.join(', ')}.`);
    return type;
  }))];
  return domains;
}

export function normalizeTasteReferences(references) {
  const items = list(references, 'references', { min: 1, max: 20 });
  const seen = new Set(), result = [];
  items.forEach((reference, index) => {
    const at = `references[${index}]`;
    const value = typeof reference === 'string' ? { name: reference } : reference;
    object(value, at, ['name', 'role', 'origin', 'audienceId', 'entityId']);
    const name = text(value.name, `${at}.name`, { max: 200 });
    const key = normalizeTasteName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const record = { name, role: value.role === undefined ? 'audience' : choice(value.role, REFERENCE_ROLES, `${at}.role`) };
    if (value.origin !== undefined) record.origin = choice(value.origin, REFERENCE_ORIGINS, `${at}.origin`);
    if (value.audienceId !== undefined) record.audienceId = text(value.audienceId, `${at}.audienceId`, { max: 100 });
    if (value.entityId !== undefined) {
      const entityId = text(value.entityId, `${at}.entityId`, { max: 160 });
      if (!/^[a-zA-Z0-9:_-]{1,160}$/u.test(entityId) || entityId.startsWith('urn:tag:')) fail(`${at}.entityId`, 'A resolved Qloo entity ID is required.');
      record.entityId = entityId;
    }
    result.push(record);
  });
  return result;
}

/** Audience preferences seed the profile; creator inspiration is used only when no audience reference exists. Brand and canon references never do. */
export function selectTasteReferences(references = [], { audienceId } = {}) {
  const usable = (Array.isArray(references) ? references : []).filter(ref => plain(ref) && typeof ref.name === 'string' && ref.name.trim());
  const audience = usable.filter(ref => ref.role === 'audience' && (!audienceId || !ref.audienceId || ref.audienceId === audienceId));
  const chosen = audience.length ? audience : usable.filter(ref => ref.role === 'creator-inspiration');
  const seen = new Set(), selected = [];
  for (const ref of chosen) {
    const key = normalizeTasteName(ref.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push({ name: ref.name.trim().slice(0, 200), role: ref.role, ...(ref.origin ? { origin: ref.origin } : {}), ...(ref.audienceId ? { audienceId: ref.audienceId } : {}), ...(typeof ref.entityId === 'string' ? { entityId: ref.entityId } : {}) });
    if (selected.length >= TASTE_LIMITS.references) break;
  }
  return { basis: selected.length ? (audience.length ? 'audience' : 'creator-inspiration') : 'none', references: selected };
}

const PLACE_TYPE = /^urn:entity:(?:place|destination|locality)(?::|$)/u;

/** Best name match; equal scores keep Qloo's order. With preferWorks, a same-named place yields to a work or creator. */
function bestMatch(rows, name, threshold, { preferWorks = false } = {}) {
  let best = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.entityId !== 'string' || typeof row.name !== 'string') continue;
    const score = tasteNameMatch(name, row.name);
    const work = preferWorks && !PLACE_TYPE.test(String(row.type ?? '')) ? 1 : 0;
    if (score >= threshold && (!best || score > best.score || (score === best.score && work > best.work))) best = { ...row, score, work };
  }
  if (best) delete best.work;
  return best;
}

/**
 * What a reference's last word says it names. The name match ignores these words, so without them "Studio Ghibli films"
 * matched the music artist Studio Ghibli and "ambient music" an artist called Ambient Music in the live Echo Atlas pass.
 * A work word admits only entities that are such works or can stand for their maker; a genre word asks for a genre tag first.
 */
const REFERENCE_KINDS = [
  { words: ['film', 'films', 'movie', 'movies', 'cinema'], label: 'films', types: ['movie', 'person', 'director', 'actor', 'brand'] },
  { words: ['series', 'show', 'shows', 'tv', 'television'], label: 'TV', types: ['tv_show', 'person', 'director', 'actor', 'brand'] },
  { words: ['book', 'books', 'novel', 'novels'], label: 'books', types: ['book', 'author', 'person', 'brand'] },
  { words: ['game', 'games', 'videogame', 'videogames'], label: 'games', types: ['videogame', 'brand'] },
  { words: ['podcast', 'podcasts'], label: 'podcasts', types: ['podcast', 'person'] },
  { words: ['album', 'albums'], label: 'albums', types: ['album', 'artist'] },
  { words: ['band', 'artist', 'artists', 'songs'], label: 'music artists', types: ['artist'] },
  { words: ['brand', 'brands'], label: 'brands', types: ['brand'] },
  { words: ['music', 'genre', 'genres'], label: 'a music genre', types: ['artist', 'album'], tagTypes: ['urn:tag:genre:music'] },
].map(kind => ({ ...kind, types: kind.types.map(type => `urn:entity:${type}`) }));
const TYPE_LABELS = { artist: 'a music artist', author: 'an author', album: 'an album', tv_show: 'a TV show', videogame: 'a video game', place: 'a place', locality: 'a place', destination: 'a place', person: 'a person' };
// Tags about venues and places never stand for works or music, whatever their name.
const PLACE_TAG = /^urn:tag:(?:category:place|genre:place|nearby_attraction|ambience|decor|amenity)(?::|$)/u;

function referenceKind(name) {
  const words = normalizeTasteName(name).split(' ').filter(Boolean);
  if (words.length < 2 || !significant(name).length) return null;
  return REFERENCE_KINDS.find(kind => kind.words.includes(words.at(-1))) || null;
}
const typesOf = row => [row?.type, ...(Array.isArray(row?.types) ? row.types : [])].filter(type => typeof type === 'string');
const typeLabel = type => { const key = String(type).replace(/^urn:entity:/u, ''); return TYPE_LABELS[key] || `a ${key.replaceAll('_', ' ')}`; };

async function resolveReference(reference, call) {
  if (reference.entityId) return { ...reference, resolution: 'entity', matchedName: reference.name, source: 'supplied-id' };
  const kind = referenceKind(reference.name);
  let search = null, tags = null, mismatch = null;
  const findEntity = async () => {
    search = await call('qloo_search_entities', { query: reference.name, limit: 6 }, { stage: 'resolve', reference: reference.name });
    const rows = search.ok ? search.record.results || [] : [];
    // "Paterson" returns the city first and the film second. Taste references name works and creators;
    // places are a separate location input, so an equally named place is only used when nothing else matches.
    const entity = bestMatch(kind ? rows.filter(row => typesOf(row).some(type => kind.types.includes(type))) : rows, reference.name, 0.75, { preferWorks: true });
    if (!entity && kind) mismatch = bestMatch(rows, reference.name, 0.75, { preferWorks: true });
    return entity ? { ...reference, resolution: 'entity', entityId: entity.entityId, matchedName: entity.name, ...(typeof entity.type === 'string' ? { type: entity.type } : {}), score: round(entity.score, 3), evidenceId: search.evidenceId } : null;
  };
  const findTag = async () => {
    tags = await call('qloo_search_tags', { query: reference.name, ...(kind?.tagTypes ? { tagTypes: kind.tagTypes } : {}), limit: 6 }, { stage: 'resolve', reference: reference.name });
    const rows = (tags.ok ? tags.record.results || [] : []).filter(row => /^urn:tag:[a-z0-9:_.-]{1,160}$/iu.test(row?.entityId || ''))
      .filter(row => kind?.tagTypes ? kind.tagTypes.some(type => row.entityId.startsWith(`${type}:`)) : !kind || !PLACE_TAG.test(row.entityId));
    const tag = bestMatch(rows, reference.name, 0.5);
    return tag ? { ...reference, resolution: 'tag', tagId: tag.entityId, matchedName: tag.name, score: round(tag.score, 3), evidenceId: tags.evidenceId } : null;
  };
  for (const find of kind?.tagTypes ? [findTag, findEntity] : [findEntity, findTag]) {
    const found = await find();
    if (found) return found;
  }
  const candidates = [...(search?.ok ? search.record.results || [] : []), ...(tags?.ok ? tags.record.results || [] : [])].map(row => row?.name).filter(name => typeof name === 'string').slice(0, 5);
  return { ...reference, resolution: 'unresolved', ...(candidates.length ? { candidates } : {}),
    limitation: mismatch ? `The closest match, ${mismatch.name}, is ${typeLabel(mismatch.type)}, not ${kind.label}, so it was not used as a seed.`
      : search?.ok || tags?.ok ? 'No returned entity or tag matched this name closely enough, so it was not used as a seed.' : 'The lookup failed, so this name was not used as a seed.' };
}

function explainedSeeds(value, seedNames) {
  const found = new Map();
  const note = (id, score) => { if (seedNames.has(id)) found.set(id, Math.max(found.get(id) ?? -Infinity, Number.isFinite(score) ? score : 0)); };
  const visit = (item, depth) => {
    if (depth > 6 || !item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.slice(0, 50).forEach(child => visit(child, depth + 1)); return; }
    const id = item.entity_id ?? item.entityId ?? item.tag_id ?? item.id;
    if (typeof id === 'string') note(id, [item.score, item.weight, item.contribution, item.affinity].find(Number.isFinite));
    for (const [key, child] of Object.entries(item).slice(0, 40)) {
      if (typeof child === 'number') note(key, child);
      else visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => seedNames.get(id));
}

function profileEntity(entity, { domain, band, evidenceId, seedNames, typed = false }) {
  if (!plain(entity) || typeof entity.entityId !== 'string' || typeof entity.name !== 'string' || !entity.name.trim()) return null;
  const result = { ref: entity.entityId, entityId: entity.entityId, name: entity.name.trim().slice(0, 240), domain, band, evidenceId };
  if (typeof entity.type === 'string') result.type = entity.type.slice(0, 120);
  const affinity = round(entity.affinity), popularity = round(entity.popularity);
  if (affinity !== undefined) result.affinity = affinity;
  if (popularity !== undefined) result.popularity = popularity;
  const returned = (Array.isArray(entity.tags) ? entity.tags : []).filter(tag => typeof tag?.name === 'string' && tag.name.trim());
  let tags;
  // A measured tag is its own quality, so a device anchored to it names the tag itself.
  if (isTagDomain(domain)) tags = [result.name.slice(0, 120)];
  else if (typed) {
    // With qualities requested, a work's tags lead with its look, mood and meaning, and catalogue metadata such as
    // platforms or business models is left out; the evidence record keeps every returned tag.
    const facets = { look: [], mood: [], meaning: [] }, other = [], artStyles = [];
    for (const tag of returned) {
      const type = tagType(tag.id), name = tag.name.trim().slice(0, 120);
      if (METADATA_TAG_TYPES.has(type)) continue;
      const family = FAMILY_OF.get(type);
      (family ? facets[family] : other).push(name);
      if (type === ART_STYLE_TAG_TYPE) artStyles.push(name);
    }
    tags = [...new Set([...facets.look, ...facets.mood, ...facets.meaning, ...other])].slice(0, 8);
    const kept = Object.entries(facets).filter(([, names]) => names.length).map(([family, names]) => [family, [...new Set(names)].slice(0, 6)]);
    if (kept.length) result.facets = Object.fromEntries(kept);
    if (artStyles.length) result.artStyles = [...new Set(artStyles)].slice(0, 6);
  } else tags = returned.map(tag => tag.name.trim().slice(0, 120)).slice(0, 8);
  if (tags.length) result.tags = tags;
  if (typeof entity.description === 'string' && entity.description.trim()) result.description = entity.description.trim().replace(/\s+/gu, ' ').slice(0, 320);
  const contributors = explainedSeeds(entity.explainability, seedNames);
  if (contributors.length) result.contributors = contributors;
  return result;
}

function tasteSignature(entities) {
  const weights = new Map();
  for (const entity of entities) for (const tag of entity.tags || []) {
    const key = normalizeTasteName(tag);
    if (!key) continue;
    const item = weights.get(key) || { name: tag, count: 0, weight: 0 };
    item.count++; item.weight += entity.affinity ?? 0.5;
    weights.set(key, item);
  }
  return [...weights.values()].filter(item => item.count >= 2).sort((a, b) => b.weight - a.weight || b.count - a.count).slice(0, 12)
    .map(item => ({ name: item.name, count: item.count, weight: round(item.weight, 3) }));
}

/**
 * Qualities the measured works share: each look, mood or meaning tag that at least two of them carry, ranked by the
 * summed affinity of those works times the number of domains they span, so a quality running through films, books and
 * music outranks one repeated inside a single domain. A name the style or aesthetic ranking already returned stays with
 * that ref. Recorded Gather and Echo Atlas passes give, for example, Atmospheric, Reflective, Identity and Melancholic,
 * and Stylized, wonder and exploration-focused.
 */
function tasteQualities(works, ranked = []) {
  const skip = new Set(ranked.map(normalizeTasteName));
  const found = new Map();
  for (const work of works) {
    const names = new Map();
    for (const [family, values] of Object.entries(work.facets || {})) for (const name of values) {
      const key = normalizeTasteName(name);
      if (key && !skip.has(key) && !names.has(key)) names.set(key, { name, family });
    }
    for (const [key, { name, family }] of names) {
      const item = found.get(key) || { name, families: new Map(), works: [] };
      item.families.set(family, (item.families.get(family) || 0) + 1);
      item.works.push(work);
      found.set(key, item);
    }
  }
  const families = Object.keys(QUALITY_FAMILIES);
  const qualities = [...found.entries()].filter(([, item]) => item.works.length >= 2).map(([key, item]) => {
    // A name Qloo types in two families, such as a style and a music tag, joins the family most of its works give it.
    const family = [...item.families.entries()].sort((a, b) => b[1] - a[1] || families.indexOf(a[0]) - families.indexOf(b[0]))[0][0];
    const works = [...item.works].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1));
    const weight = works.reduce((sum, work) => sum + (work.affinity ?? 0.5), 0), domains = [...new Set(works.map(work => work.domain))];
    return { ref: `quality:${family}:${key.replaceAll(' ', '-')}`, name: item.name, domain: QUALITY_DOMAIN, band: 'derived', family, count: works.length, domains,
      score: round(weight * domains.length, 3), affinity: round(weight / works.length), examples: works.slice(0, 3).map(work => work.name),
      refs: works.slice(0, 8).map(work => work.ref), evidenceIds: [...new Set(works.map(work => work.evidenceId).filter(id => typeof id === 'string'))].slice(0, 8), tags: [item.name] };
  });
  return families.flatMap(family => qualities.filter(quality => quality.family === family)
    .sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name)).slice(0, TASTE_LIMITS.qualitiesPerFamily));
}

/**
 * Art styles the measured works carry: each art_style tag Qloo returns on them, ranked like qualities by the summed
 * affinity of its works times the number of domains they span. One work is enough, since a film, show or game carries
 * only a few. Recorded game passes returned, for example, Pixel Art on Hyper Light Drifter, Owlboy and Eastward, and
 * Cel-shaded visuals on Persona 5 Royal.
 */
function tasteArtStyles(works) {
  const found = new Map();
  for (const work of works) for (const name of work.artStyles || []) {
    const key = normalizeTasteName(name);
    if (!key) continue;
    const item = found.get(key) || { name, works: [] };
    if (!item.works.includes(work)) item.works.push(work);
    found.set(key, item);
  }
  return [...found.entries()].map(([key, item]) => {
    const carriers = [...item.works].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1));
    const weight = carriers.reduce((sum, work) => sum + (work.affinity ?? 0.5), 0), domains = [...new Set(carriers.map(work => work.domain))];
    return { ref: `art-style:${key.replaceAll(' ', '-')}`, name: item.name, domain: ART_STYLE_DOMAIN, band: 'derived', count: carriers.length, domains,
      score: round(weight * domains.length, 3), affinity: round(weight / carriers.length), examples: carriers.slice(0, 3).map(work => work.name),
      refs: carriers.slice(0, 8).map(work => work.ref), evidenceIds: [...new Set(carriers.map(work => work.evidenceId).filter(id => typeof id === 'string'))].slice(0, 8), tags: [item.name] };
  }).sort((a, b) => b.score - a.score || b.count - a.count || a.name.localeCompare(b.name)).slice(0, TASTE_LIMITS.artStyles);
}

/**
 * Host-run Taste Pass: resolve seeds, then query several domains with bounded concurrency, each excluding the seeds,
 * plus a lower-popularity band. Data failures are returned as status, never replaced with invented entities.
 * A live pass with four parallel requests hit the hackathon rate limit on three of seven insights calls, so
 * requests run two at a time, and a request that fails transiently (rate limit, timeout, network or server error) is
 * retried after a short pause within the same call budget; rateLimitRetries bounds those retries.
 * Tag seeds join entity seeds only where Qloo answers them: tag rankings use the entity seeds alone when there are
 * any, and an entity request whose tag seeds meet a timeout or server error is sent once more without them.
 * With the qualities domain, the works' typed tags are kept by family and aggregated into qualities, and with the art
 * style domain their art_style tags into art styles; neither costs a request.
 */
export async function buildTasteProfile({ client, references, domains = DEFAULT_TASTE_DOMAINS, location, age, audiences, audienceWeight, deepCuts = true, perDomain = TASTE_LIMITS.perDomain,
  maxCalls = TASTE_LIMITS.calls, concurrency = 2, rateLimitRetries = 2, retryDelayMs = 1500, knownNames = [], onEvidence, onCall, placeCheck = false } = {}) {
  if (!client || typeof client.searchEntities !== 'function' || typeof client.searchTags !== 'function' || typeof client.getInsights !== 'function') fail('client', 'A Qloo client with entity search, tag search and insights is required.');
  // Audience segments (URNs from an audience search) weight every request, and can stand in for named works: a
  // profile from segments alone is broader, so it is reported as such.
  const segments = audiences === undefined || audiences === null ? undefined : [...new Set(list(audiences, 'audiences', { min: 1, max: 3 }))];
  if (segments?.some(id => typeof id !== 'string' || !AUDIENCE_ID.test(id))) fail('audiences', 'Use audience URNs such as urn:audience:life_stage:parents_with_young_children.');
  if (audienceWeight !== undefined && (!segments || !(QLOO_AUDIENCE_WEIGHTS.includes(audienceWeight) || (typeof audienceWeight === 'number' && audienceWeight >= 0 && audienceWeight <= 100)))) fail('audienceWeight', `Use one of ${QLOO_AUDIENCE_WEIGHTS.join(', ')} with audiences.`);
  const noReferences = references === undefined || references === null || (Array.isArray(references) && !references.length);
  const seedsInput = noReferences && segments ? [] : normalizeTasteReferences(references).slice(0, TASTE_LIMITS.references);
  const domainList = normalizeTasteDomains(domains);
  const place = location === undefined || location === null || location === '' ? undefined : text(location, 'location', { max: 300 });
  // An age band weights the whole pass toward those ages, as a location does toward a place.
  const ages = age === undefined || age === null || age === '' ? undefined : [...new Set(Array.isArray(age) ? age : [age])];
  if (ages && (!ages.length || ages.length > 3 || ages.some(value => !QLOO_AGE_BANDS.includes(value)))) fail('age', `Use 1-3 of: ${QLOO_AGE_BANDS.join(', ')}.`);
  if (!Number.isInteger(perDomain) || perDomain < 3 || perDomain > 20) fail('perDomain', 'Use an integer from 3 to 20.');
  if (!Number.isInteger(maxCalls) || maxCalls < 2 || maxCalls > 40) fail('maxCalls', 'Use an integer from 2 to 40.');
  if (typeof deepCuts !== 'boolean') fail('deepCuts', 'A boolean is required.');
  if (!Number.isInteger(rateLimitRetries) || rateLimitRetries < 0 || rateLimitRetries > 3) fail('rateLimitRetries', 'Use an integer from 0 to 3.');
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10000) fail('retryDelayMs', 'Use an integer from 0 to 10000.');
  let calls = 0, localIds = 0;
  const limitations = [];
  const call = async (tool, input, meta, { retryOn = () => true } = {}) => {
    for (let attempt = 0; ; attempt++) {
      if (calls >= maxCalls) {
        const message = 'The taste pass call budget was reached; later requests were not sent.';
        if (!limitations.includes(message)) limitations.push(message);
        return { ok: false, skipped: true, error: { code: 'TASTE_BUDGET', message, retryable: false } };
      }
      calls++;
      try {
        const result = tool === 'qloo_search_entities' ? await client.searchEntities(input) : tool === 'qloo_search_tags' ? await client.searchTags(input) : await client.getInsights(input);
        const record = { tool, ...result, tastePass: meta };
        if (onEvidence) await onEvidence(record);
        let evidenceId = record.evidence?.id ?? record.id;
        if (!evidenceId) {
          evidenceId = `taste-source-${++localIds}`;
          if (plain(record.evidence)) record.evidence.id = evidenceId;
        }
        await onCall?.({ tool, input, meta, status: record.status || 'ok', evidenceId });
        return { ok: true, record, evidenceId };
      } catch (error) {
        const qloo = typeof error?.code === 'string' && error.code.startsWith('QLOO_');
        const failure = { code: qloo ? error.code : 'TASTE_SOURCE_FAILED', message: qloo ? String(error.message).slice(0, 300) : 'The Qloo request or its host audit could not complete.', retryable: Boolean(error?.retryable) };
        // Every attempt is a real request, so a failed one stays in the call record before the retry. A rate limit,
        // a timeout or a server error is often transient: one live Echo Atlas pass lost four domains to timeouts, and
        // three of them answered a minute later.
        await onCall?.({ tool, input, meta, status: 'error', error: failure });
        if (!failure.retryable || !retryOn(failure) || attempt >= rateLimitRetries || calls >= maxCalls) return { ok: false, error: failure };
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
  };
  const seeds = await mapLimit(seedsInput, concurrency, reference => resolveReference(reference, call));
  const entityIds = [...new Set(seeds.filter(seed => seed.resolution === 'entity').map(seed => seed.entityId))].slice(0, 20);
  const tagIds = [...new Set(seeds.filter(seed => seed.resolution === 'tag').map(seed => seed.tagId))].slice(0, 10);
  for (const seed of seeds) if (seed.resolution === 'unresolved') limitations.push(`"${seed.name}" was not resolved and did not contribute to the profile.${/^The closest match/u.test(seed.limitation || '') ? ` ${seed.limitation}` : ''}`);
  const base = { schemaVersion: TASTE_SCHEMA_VERSION, provider: 'Qloo', createdAt: new Date().toISOString(), domains: domainList, ...(place ? { location: place } : {}), ...(ages ? { age: ages } : {}),
    ...(segments ? { audiences: segments, ...(audienceWeight !== undefined ? { audienceWeight } : {}) } : {}), seeds, interpretation: INTERPRETATION };
  if (!entityIds.length && !tagIds.length && !segments) {
    return { ...base, status: 'unresolved', calls, results: [], entities: [], signature: [],
      limitations: [...new Set([...limitations, 'No reference resolved to a Qloo entity or tag, so no taste profile was requested.'])].slice(0, 20) };
  }
  if (!entityIds.length && !tagIds.length) limitations.push('Measured from audience segments without named works: a broader signal than the works an audience names.');
  const located = { ...(place ? { location: place } : {}), ...(ages ? { age: ages } : {}), ...(segments ? { audiences: segments, ...(audienceWeight !== undefined ? { audienceWeight } : {}) } : {}) };
  const entitySeeds = entityIds.length ? { seedEntityIds: entityIds } : {}, tagSeeds = tagIds.length ? { seedTagIds: tagIds } : {};
  const signal = { ...entitySeeds, ...(entityIds.length ? { excludeEntityIds: entityIds } : {}), ...tagSeeds, ...located };
  // Tag requests rank qualities, so they exclude no seed. A live Echo Atlas probe ranked eight style tags for the game
  // Outer Wilds alone and got HTTP 500 once the Ambient genre tag joined it, with or without explainability, so tag
  // rankings use the entity seeds alone when there are any.
  const mixed = entityIds.length > 0 && tagIds.length > 0;
  const tagSignal = { ...entitySeeds, ...(mixed ? {} : tagSeeds), ...located };
  const tagSeedNames = seeds.filter(seed => seed.resolution === 'tag').map(seed => `"${seed.name}"`).join(' and ');
  const tagDomains = domainList.filter(isTagDomain);
  if (mixed && tagDomains.length) limitations.push(`${tagDomains.join(' and ')} tags were ranked from the entity seeds alone, so ${tagSeedNames} did not shape them.`);
  const typed = domainList.some(isDerivedDomain);
  const requests = domainList.filter(domain => !isDerivedDomain(domain)).map(domain => isTagDomain(domain)
    ? { domain, band: 'core', ...(mixed ? { seeds: 'entities' } : {}), input: { ...tagSignal, resultType: 'tag', tagTypes: [...TASTE_TAG_DOMAINS[domain].tagTypes],
      ...(TASTE_TAG_DOMAINS[domain].parentTypes ? { parentTypes: [...TASTE_TAG_DOMAINS[domain].parentTypes] } : {}), limit: Math.min(perDomain, TASTE_LIMITS.perTagDomain), explainability: true } }
    : { domain, band: 'core', input: { ...signal, resultType: domain, limit: perDomain, explainability: true } });
  if (deepCuts) for (const domain of DEEP_CUT_DOMAINS) if (domainList.includes(domain)) requests.push({ domain, band: 'deep-cut', input: { ...signal, resultType: domain, limit: perDomain, explainability: true, popularityMax: TASTE_LIMITS.deepCutPopularityMax } });
  const seedNames = new Map(seeds.flatMap(seed => [[seed.entityId, seed.name], [seed.tagId, seed.name]]).filter(([id]) => typeof id === 'string'));
  // The same probe's artist request with both kinds of seed timed out after 30 seconds, as it had on all three attempts
  // in the pass before it, though a later pass got its answer at once; that pass's film request timed out once and then
  // answered with both. An entity request with both kinds of seed is therefore repeated once as sent after a timeout or
  // server error, then sent with the entity seeds alone.
  const seedFailure = failure => failure.retryable && (failure.code === 'QLOO_TIMEOUT' || failure.code === 'QLOO_UPSTREAM');
  // With placeCheck, a place Qloo does not recognise stops the pass early. In the first live plugin session,
  // "Moda, Kadıköy, Istanbul" emptied every one of twelve answers, and "Istanbul" alone filled them. After the first
  // answers weighted by the place all come back empty, the rest are not requested.
  const placeAnswers = { answered: 0, empty: 0, stopped: false };
  const responses = await mapLimit(requests, concurrency, async request => {
    const meta = { stage: 'insights', domain: request.domain, band: request.band, ...(request.seeds ? { seeds: request.seeds } : {}) };
    if (placeAnswers.stopped) return { domain: request.domain, band: request.band, status: 'skipped', error: { code: 'TASTE_PLACE_UNMATCHED', message: 'Not requested: the place matched nothing.', retryable: false }, entities: [] };
    const fallback = mixed && !isTagDomain(request.domain);
    let seedFailures = 0, input = request.input, sent = meta;
    let response = await call('qloo_get_insights', input, meta, fallback ? { retryOn: failure => !seedFailure(failure) || ++seedFailures < 2 } : undefined);
    if (fallback && !response.ok && !response.skipped && seedFailure(response.error)) {
      const { seedTagIds, ...rest } = input;
      void seedTagIds;
      const first = response.error.code;
      input = rest; sent = { ...meta, seeds: 'entities' };
      response = await call('qloo_get_insights', input, sent);
      if (response.ok) limitations.push(`${request.domain} (${request.band}) was ranked from the entity seeds alone after the request with ${tagSeedNames} failed: ${first}.`);
    }
    // A request Qloo refuses outright with the age signal is sent once more without it, so an unsupported combination
    // costs that signal, not the domain.
    if (ages && !response.ok && !response.skipped && response.error.code === 'QLOO_UPSTREAM' && !response.error.retryable) {
      const { age: dropped, ...rest } = input;
      void dropped;
      response = await call('qloo_get_insights', rest, { ...sent, age: 'dropped' });
      if (response.ok) limitations.push(`${isTagDomain(request.domain) ? `${request.domain} tags were` : `${request.domain} (${request.band}) was`} ranked without the age signal after Qloo refused the request with it.`);
    }
    if (!response.ok) return { domain: request.domain, band: request.band, status: response.skipped ? 'skipped' : 'error', error: response.error, entities: [] };
    const entities = (Array.isArray(response.record.results) ? response.record.results : []).slice(0, perDomain)
      .map(entity => profileEntity(entity, { ...request, evidenceId: response.evidenceId, seedNames, typed })).filter(Boolean);
    if (placeCheck && place && !placeAnswers.stopped) {
      placeAnswers.answered++;
      if (!entities.length) placeAnswers.empty++;
      if (placeAnswers.answered >= 2 && placeAnswers.empty === placeAnswers.answered) {
        placeAnswers.stopped = true;
        const parts = place.split(',').map(part => part.trim()).filter(Boolean);
        limitations.push(`Qloo returned nothing for the first ${placeAnswers.answered} domains weighted by the place "${place}", so it likely did not recognise that place, and the other domains were not requested. Plan again with ${parts.length > 1 ? `the city or the neighbourhood alone, such as "${parts.at(-1)}"` : 'another name for the place, such as its city'}.`);
      }
    }
    return { domain: request.domain, band: request.band, status: response.record.status || (entities.length ? 'ok' : 'empty'), evidenceId: response.evidenceId, entities };
  });
  const entities = [], seen = new Set();
  for (const response of responses) for (const entity of response.entities) {
    if (seen.has(entity.ref)) continue;
    seen.add(entity.ref); entities.push(entity);
  }
  const works = entities.filter(entity => !isTagDomain(entity.domain));
  const shared = domainList.includes(QUALITY_DOMAIN), styled = domainList.includes(ART_STYLE_DOMAIN);
  const artStyles = styled ? tasteArtStyles(works) : [];
  // An art style stays with its art-style ref, as a ranked style or aesthetic tag stays with its own.
  const qualities = shared ? tasteQualities(works, [...entities.filter(entity => isTagDomain(entity.domain)).map(entity => entity.name), ...artStyles.map(style => style.name)]) : [];
  entities.push(...qualities, ...artStyles);
  if (shared && !qualities.length) limitations.push('No look, mood or meaning tag was shared by two or more measured works, so no qualities were derived.');
  if (styled && !artStyles.length) limitations.push('No measured work carried an art style tag, so no art styles were derived.');
  const known = [...(Array.isArray(knownNames) ? knownNames : []).filter(name => typeof name === 'string'), ...seedsInput.map(seed => seed.name)];
  for (const entity of entities) if (known.some(name => predictionMatches(name, entity.name))) entity.knownFromBrief = true;
  for (const response of responses) {
    const label = isTagDomain(response.domain) ? `${response.domain} tags` : `${response.domain} (${response.band})`;
    if (response.status === 'error') limitations.push(`${label} insights failed: ${response.error.code}.`);
    else if (!response.entities.length) limitations.push(`${label} returned ${isTagDomain(response.domain) ? 'no tags' : 'no entities'}.`);
  }
  // Tags describe qualities, so only entity domains decide whether the profile can govern a design.
  const usableDomains = responses.filter(response => !isTagDomain(response.domain) && response.entities.length >= 3).length;
  if (usableDomains < 2) limitations.push('Fewer than two domains returned three or more entities; this profile is too thin to govern a design.');
  return { ...base, status: usableDomains >= 2 ? 'ok' : 'insufficient', calls,
    results: [...responses.map(({ entities: rows, ...meta }) => ({ ...meta, count: rows.length })),
      ...(shared ? [{ domain: QUALITY_DOMAIN, band: 'derived', status: qualities.length ? 'ok' : 'empty', count: qualities.length }] : []),
      ...(styled ? [{ domain: ART_STYLE_DOMAIN, band: 'derived', status: artStyles.length ? 'ok' : 'empty', count: artStyles.length }] : [])],
    entities, signature: tasteSignature(entities.filter(entity => !isQualityDomain(entity.domain))), limitations: [...new Set(limitations)].slice(0, 20) };
}

function hexColor(value, path) {
  const hex = text(value, path, { max: 7 });
  if (!HEX.test(hex)) fail(path, 'Use a #rgb or #rrggbb hex color.');
  return expandHex(hex);
}
function fontName(value, path) {
  const name = text(value, path, { max: 60 }).replace(/^["']|["']$/gu, '');
  if (!/^[\p{L}\p{N} ._-]{1,60}$/u.test(name)) fail(path, 'Use one font family name without quotes, commas or semicolons.');
  return name;
}
function elementId(value, path) {
  const result = text(value, path, { max: 120 }).replace(/^#/u, '');
  if (!ELEMENT_ID.test(result)) fail(path, 'Use an HTML element ID without spaces.');
  return result;
}
const CSS_WIDE = new Set(['none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer', 'default']);
function keyframesName(value, path) {
  const name = text(value, path, { max: 60 });
  if (!/^-?[A-Za-z_][A-Za-z0-9_-]{0,59}$/u.test(name) || CSS_WIDE.has(name.toLowerCase())) fail(path, 'Use the name of an @keyframes rule, such as drift.');
  return name;
}

/**
 * Host font library as normalized family name -> family, files and the system faces it stands in for; null when the
 * caller supplied none, so any family name is accepted for form only.
 */
function fontLibrary(fonts) {
  if (!Array.isArray(fonts)) return null;
  return new Map(fonts.filter(item => plain(item) && typeof item.family === 'string' && item.family.trim()).map(item => [normalizeTasteName(item.family), {
    family: item.family.trim(), files: (Array.isArray(item.files) ? item.files : []).filter(file => typeof file === 'string'),
    similarTo: (Array.isArray(item.similarTo) ? item.similarTo : []).filter(name => typeof name === 'string') }]));
}
/** A named family must come from the font library, so the type a device declares is the type every visitor sees. */
function libraryFamily(name, fonts, path) {
  if (!fonts || GENERIC_FONTS.has(name.toLowerCase())) return name;
  const found = fonts.get(normalizeTasteName(name));
  if (found) return found.family;
  const stands = [...fonts.values()].filter(item => item.similarTo.some(other => normalizeTasteName(other) === normalizeTasteName(name))).map(item => item.family);
  fail(path, `${name} is not in culture-fonts.json, so most visitors would see a fallback font. Use a listed family${stands.length ? `; ${stands.join(' or ')} stands in for ${name}` : `, such as ${[...fonts.values()].slice(0, 8).map(item => item.family).join(', ')}`}.`);
}

/**
 * The design the model would make from its own prediction, frozen before any taste data. Without Qloo it is the
 * starting point; with Qloo it is the counterfactual that surprise-anchored devices must depart from.
 */
export function normalizeDesignSketch(value, path = 'designSketch', { fonts: fontsInput } = {}) {
  object(value, path, ['summary', 'palette', 'fonts', 'sections', 'motifs']);
  const library = fontsInput instanceof Map ? fontsInput : fontLibrary(fontsInput);
  const palette = [...new Set(list(value.palette, `${path}.palette`, { min: 3, max: 6 }).map((color, index) => hexColor(color, `${path}.palette[${index}]`)))];
  const fonts = [...new Set(list(value.fonts, `${path}.fonts`, { min: 1, max: 3 }).map((font, index) => libraryFamily(fontName(font, `${path}.fonts[${index}]`), library, `${path}.fonts[${index}]`)))];
  if (!fonts.some(font => !GENERIC_FONTS.has(font.toLowerCase()))) fail(`${path}.fonts`, 'Name at least one font family, not only a generic family such as serif.');
  const sections = [...new Set(list(value.sections, `${path}.sections`, { min: 3, max: 8 }).map((id, index) => elementId(id, `${path}.sections[${index}]`)))];
  const motifs = [...new Set(list(value.motifs, `${path}.motifs`, { min: 1, max: 5 }).map((motif, index) => text(motif, `${path}.motifs[${index}]`, { min: 3, max: 80 })))];
  return { summary: text(value.summary, `${path}.summary`, { min: 10, max: 400 }), palette, fonts, sections, motifs };
}

/** The prediction is the model's own taste input; IDs are host assigned so they cannot collide with catalogue IDs. */
export function normalizeTasteAssumption(raw, { domains = DEFAULT_TASTE_DOMAINS, requireSketch = false, fonts } = {}) {
  const domainList = normalizeTasteDomains(domains);
  const source = parsed(raw, 'assumption');
  object(source, 'assumption', ['schemaVersion', 'audienceSummary', 'predictions', 'designSketch']);
  if (requireSketch && source.designSketch === undefined) fail('assumption.designSketch', 'Also sketch the design you would make from this prediction alone: {summary,palette:[3-6 hex colors],fonts:[1-3 font families],sections:[3-8 element IDs],motifs:[1-5 short phrases]}.');
  const designSketch = source.designSketch === undefined ? null : normalizeDesignSketch(source.designSketch, 'assumption.designSketch', { fonts });
  if (source.schemaVersion !== TASTE_SCHEMA_VERSION) fail('assumption.schemaVersion', "Use schemaVersion '1.0'.");
  const audienceSummary = text(source.audienceSummary, 'assumption.audienceSummary', { min: 10, max: 600 });
  if (!plain(source.predictions)) fail('assumption.predictions', `An object keyed by domain is required: ${domainList.join(', ')}.`);
  const unexpected = Object.keys(source.predictions).find(key => !domainList.includes(key));
  if (unexpected !== undefined) fail(`assumption.predictions.${unexpected.slice(0, 40)}`, `Use exactly these domains: ${domainList.join(', ')}.`);
  const entries = [], seen = new Set();
  for (const domain of domainList) {
    const names = list(source.predictions[domain], `assumption.predictions.${domain}`, { min: 3, max: 6 });
    names.forEach((value, index) => {
      const name = text(value, `assumption.predictions.${domain}[${index}]`, { min: 2, max: 120 });
      const key = normalizeTasteName(name);
      if (!key) fail(`assumption.predictions.${domain}[${index}]`, isQualityDomain(domain) ? 'A quality such as a word or short phrase is required.' : 'A real name is required.');
      // A quality and a work may share a word, so names and qualities are deduplicated separately.
      const seenKey = `${isQualityDomain(domain) ? 'tag' : 'entity'}:${key}`;
      if (seen.has(seenKey)) return;
      seen.add(seenKey);
      entries.push({ id: `M${String(entries.length + 1).padStart(2, '0')}`, domain, name });
    });
  }
  return { schemaVersion: TASTE_SCHEMA_VERSION, audienceSummary, domains: domainList, entries, ...(designSketch ? { designSketch } : {}), sourceType: 'model-assumption' };
}

function compareCandidates(a, b) {
  return Number(Boolean(b.surprise)) - Number(Boolean(a.surprise)) || (b.affinity ?? -1) - (a.affinity ?? -1);
}

/** Round-robin across domain bands so one category cannot dominate; surprises lead within each band. */
export function selectRequiredAnchors(entities, count = TASTE_LIMITS.requiredAnchors) {
  const groups = new Map();
  for (const entity of entities) {
    const key = `${entity.domain}:${entity.band || 'core'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entity);
  }
  const ordered = [...groups.values()].map(group => [...group].sort(compareCandidates)).sort((a, b) => compareCandidates(a[0], b[0]));
  const picks = [];
  for (let pass = 0; picks.length < count; pass++) {
    let added = false;
    for (const group of ordered) {
      if (picks.length >= count) break;
      if (group[pass]) { picks.push(group[pass].ref); added = true; }
    }
    if (!added) break;
  }
  return picks;
}

/** How many of the required anchors are qualities when the taste input has them: half, and at most one per family. */
const qualityAnchorCount = (count, available) => Math.min(TASTE_LIMITS.qualityAnchors, Math.floor(count / 2), available);

/**
 * Required anchors by Qloo's own structure: the strongest quality of each family, then the works most central to the
 * qualities, one domain at a time. A work's centrality is the summed score of the qualities it carries, so a work
 * outside the audience's shared taste, such as an ice hockey team among films and novels, comes last whatever its
 * affinity. Works then rank by affinity and surprise. Films and TV carry more typed tags than games, so the artifact's
 * own medium, such as games for a game site, takes the first work place when it has a central work.
 */
export function selectQualityAnchors(works, qualities, count = TASTE_LIMITS.requiredAnchors, { medium = [] } = {}) {
  const ranked = [...qualities].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const take = qualityAnchorCount(count, ranked.length), picks = [];
  for (const family of Object.keys(QUALITY_FAMILIES)) {
    const top = ranked.find(quality => quality.family === family);
    if (top && picks.length < take) picks.push(top.ref);
  }
  for (const quality of ranked) if (picks.length < take && !picks.includes(quality.ref)) picks.push(quality.ref);
  const scores = new Map(ranked.map(quality => [normalizeTasteName(quality.name), quality.score ?? 0]));
  const central = work => [...new Set(Object.values(work.facets || {}).flat().map(normalizeTasteName))].reduce((sum, key) => sum + (scores.get(key) ?? 0), 0);
  const rows = works.map(work => ({ work, centrality: central(work) }));
  const order = (a, b) => b.centrality - a.centrality || (b.work.affinity ?? -1) - (a.work.affinity ?? -1) || Number(Boolean(b.work.surprise)) - Number(Boolean(a.work.surprise));
  const groups = new Map();
  for (const row of rows.filter(item => item.centrality > 0)) { if (!groups.has(row.work.domain)) groups.set(row.work.domain, []); groups.get(row.work.domain).push(row); }
  const own = group => Number(medium.includes(group[0].work.domain));
  const ordered = [...groups.values()].map(group => group.sort(order)).sort((a, b) => own(b) - own(a) || order(a[0], b[0]));
  for (let pass = 0; picks.length < count; pass++) {
    let added = false;
    for (const group of ordered) if (group[pass] && picks.length < count) { picks.push(group[pass].work.ref); added = true; }
    if (!added) break;
  }
  // Works that carry none of the qualities fill any remaining place, as the selection without qualities would order them.
  for (const row of rows.filter(item => !item.centrality).sort((a, b) => compareCandidates(a.work, b.work))) if (picks.length < count) picks.push(row.work.ref);
  return picks;
}

/** Prediction match for aggregated qualities, which also accepts a shared five-letter stem: Minimal is Minimalist, Atmosphere is Atmospheric. */
function qualityMatches(a, b) {
  if (predictionMatches(a, b)) return true;
  const xs = significant(a), ys = significant(b);
  if (!xs.length || !ys.length) return false;
  const [small, large] = xs.length <= ys.length ? [xs, ys] : [ys, xs];
  return small.every(token => token.length >= 5 && large.some(other => other.length >= 5 && other.slice(0, 5) === token.slice(0, 5)));
}

export function tasteInputFromProfile(profile, assumption, { requiredCount = TASTE_LIMITS.requiredAnchors, requiredRefs, medium = [] } = {}) {
  if (!plain(profile) || !Array.isArray(profile.entities)) fail('profile', 'A recorded taste profile is required.');
  const predictions = Array.isArray(assumption?.entries) ? assumption.entries : [];
  // Predicted qualities match measured tags and qualities, and predicted names match measured entities, never across
  // the two: a predicted quality "Calm" is not a prediction of a brand called Calm. The stem match for aggregated
  // qualities only lowers surprise claims.
  const measured = profile.entities.map(entity => {
    const quality = isQualityDomain(entity.domain), matches = isDerivedDomain(entity.domain) ? qualityMatches : predictionMatches;
    const match = predictions.find(prediction => isQualityDomain(prediction.domain) === quality && matches(prediction.name, entity.name));
    return { ...entity, source: 'qloo', predictedByModel: Boolean(match), ...(match ? { matchedPrediction: match.id } : {}), surprise: !match && !entity.knownFromBrief };
  });
  const own = predictions.map(prediction => {
    const confirmed = measured.find(entity => entity.matchedPrediction === prediction.id);
    return { ref: prediction.id, name: prediction.name, domain: prediction.domain, source: 'model-assumption',
      ...(confirmed ? { confirmedBy: confirmed.ref, ...(confirmed.affinity !== undefined ? { confirmedAffinity: confirmed.affinity } : {}) } : {}) };
  });
  // Entity metrics keep their earlier meaning; measured tags and qualities are counted on their own.
  const works = measured.filter(entity => !isQualityDomain(entity.domain)), tags = measured.filter(entity => isTagDomain(entity.domain));
  const qualities = measured.filter(entity => entity.domain === QUALITY_DOMAIN), artStyles = measured.filter(entity => entity.domain === ART_STYLE_DOMAIN);
  const ownWorks = own.filter(entity => !isQualityDomain(entity.domain)), ownTags = own.filter(entity => isTagDomain(entity.domain));
  const ownQualities = own.filter(entity => entity.domain === QUALITY_DOMAIN), ownArtStyles = own.filter(entity => entity.domain === ART_STYLE_DOMAIN);
  // A work's facets and art styles serve only the host's aggregation; its typed tags already lead with them.
  const entities = [...measured.map(({ facets, artStyles: styles, ...entity }) => { void facets; void styles; return entity; }), ...own];
  const refs = new Set(entities.map(entity => entity.ref));
  const requiredAnchors = Array.isArray(requiredRefs) ? [...new Set(requiredRefs)].filter(ref => refs.has(ref))
    : qualities.length ? selectQualityAnchors(works, qualities, requiredCount, { medium }) : selectRequiredAnchors(works, requiredCount);
  const surprises = works.filter(entity => entity.surprise).length;
  return { schemaVersion: TASTE_SCHEMA_VERSION, source: 'qloo-profile', entities, requiredAnchors,
    metrics: { measuredEntities: works.length, predictedByModel: works.filter(entity => entity.predictedByModel).length,
      knownFromBrief: works.filter(entity => entity.knownFromBrief && !entity.predictedByModel).length, surprises,
      surpriseShare: works.length ? round(surprises / works.length, 3) : 0,
      predictions: ownWorks.length, predictionsConfirmed: ownWorks.filter(entity => entity.confirmedBy).length,
      ...(tags.length || ownTags.length ? { measuredTags: tags.length, tagsPredicted: tags.filter(entity => entity.predictedByModel).length,
        tagSurprises: tags.filter(entity => entity.surprise).length, tagPredictions: ownTags.length } : {}),
      ...(qualities.length || ownQualities.length ? { measuredQualities: qualities.length, qualitiesPredicted: qualities.filter(entity => entity.predictedByModel).length,
        qualitySurprises: qualities.filter(entity => entity.surprise).length, qualityPredictions: ownQualities.length } : {}),
      ...(artStyles.length || ownArtStyles.length ? { measuredArtStyles: artStyles.length, artStylesPredicted: artStyles.filter(entity => entity.predictedByModel).length,
        artStyleSurprises: artStyles.filter(entity => entity.surprise).length, artStylePredictions: ownArtStyles.length } : {}) },
    seeds: (profile.seeds || []).map(seed => ({ name: seed.name, role: seed.role, resolution: seed.resolution, ...(seed.matchedName ? { matchedName: seed.matchedName } : {}) })),
    signature: profile.signature || [], limitations: profile.limitations || [] };
}

export function tasteInputFromAssumption(assumption, { requiredCount = TASTE_LIMITS.requiredAnchors, requiredRefs, medium = [] } = {}) {
  if (!plain(assumption) || !Array.isArray(assumption.entries)) fail('assumption', 'A saved prediction is required.');
  const entities = assumption.entries.map(entry => ({ ref: entry.id, name: entry.name, domain: entry.domain, source: 'model-assumption' }));
  const refs = new Set(entities.map(entity => entity.ref));
  const shared = entities.filter(entity => entity.domain === QUALITY_DOMAIN);
  let requiredAnchors;
  if (Array.isArray(requiredRefs)) requiredAnchors = [...new Set(requiredRefs)].filter(ref => refs.has(ref));
  else {
    // As in a measured run: with predicted qualities, the first of them are required beside the predicted works, and
    // the artifact's own medium comes first. Predicted style and aesthetic qualities direct motion and illustration.
    requiredAnchors = shared.slice(0, qualityAnchorCount(requiredCount, shared.length)).map(entity => entity.ref);
    const byDomain = new Map();
    for (const entity of entities.filter(item => !isQualityDomain(item.domain))) { if (!byDomain.has(entity.domain)) byDomain.set(entity.domain, []); byDomain.get(entity.domain).push(entity); }
    const groups = [...byDomain.values()].sort((a, b) => shared.length ? Number(medium.includes(b[0].domain)) - Number(medium.includes(a[0].domain)) : 0);
    for (let pass = 0; requiredAnchors.length < requiredCount; pass++) {
      let added = false;
      for (const group of groups) if (group[pass] && requiredAnchors.length < requiredCount) { requiredAnchors.push(group[pass].ref); added = true; }
      if (!added) break;
    }
  }
  const tags = entities.filter(entity => isTagDomain(entity.domain)).length, styles = entities.filter(entity => entity.domain === ART_STYLE_DOMAIN).length;
  return { schemaVersion: TASTE_SCHEMA_VERSION, source: 'model-assumption', entities, requiredAnchors,
    metrics: { predictions: entities.filter(entity => !isQualityDomain(entity.domain)).length, ...(tags ? { tagPredictions: tags } : {}), ...(shared.length ? { qualityPredictions: shared.length } : {}),
      ...(styles ? { artStylePredictions: styles } : {}) },
    seeds: [], signature: [], limitations: [] };
}

/** What the agent reads from project_get_taste: bounded, with every valid anchor ref. */
export function compactTasteInput(input) {
  const required = new Set(input.requiredAnchors);
  const byRef = new Map(input.entities.map(entity => [entity.ref, entity]));
  const view = entity => ({ ref: entity.ref, name: entity.name, domain: entity.domain, source: entity.source,
    ...(entity.band && entity.band !== 'core' ? { band: entity.band } : {}),
    // A quality says how widely the measured works share it: its family, how many works carry it, their domains and a few of them.
    ...(entity.family ? { family: entity.family } : {}), ...(Number.isInteger(entity.count) ? { count: entity.count } : {}),
    ...(Array.isArray(entity.domains) ? { domains: entity.domains } : {}), ...(entity.examples?.length ? { examples: entity.examples } : {}),
    ...(entity.affinity !== undefined ? { affinity: entity.affinity } : {}), ...(entity.popularity !== undefined ? { popularity: entity.popularity } : {}),
    ...(entity.tags?.length ? { tags: entity.tags.slice(0, 5) } : {}), ...(entity.description ? { description: entity.description.slice(0, 200) } : {}),
    ...(entity.contributors?.length ? { contributors: entity.contributors } : {}),
    ...(entity.source === 'qloo' ? { predictedByModel: entity.predictedByModel, surprise: entity.surprise, ...(entity.knownFromBrief ? { knownFromBrief: true } : {}) } : {}),
    ...(entity.confirmedBy ? { confirmedBy: entity.confirmedBy } : {}), ...(required.has(entity.ref) ? { required: true } : {}) });
  return { source: input.source, requiredAnchors: input.requiredAnchors.map(ref => view(byRef.get(ref))), entities: input.entities.map(view),
    metrics: input.metrics, seeds: input.seeds || [], signature: (input.signature || []).slice(0, 10).map(tag => tag.name) };
}

// A picture made for a device and registered with the plugin, such as generated/dna5-1.png.
const GENERATED_PICTURE = /^generated\/[a-z0-9][a-z0-9_-]{0,60}\.(?:jpg|png)$/u;

/**
 * A host library photo as a literal site path: `olive-oil-1`, `olive-oil-1.jpg` and `library/olive-oil-1.jpg` are the
 * same photo. A generated picture keeps its own path; its colours are checked when it is registered, not here.
 */
function libraryImagePath(value, path) {
  const name = text(value, path, { max: 90 }).toLowerCase();
  if (GENERATED_PICTURE.test(name)) return name;
  const match = name.match(/^(?:library\/)?([a-z0-9][a-z0-9-]{0,60})(?:\.jpg)?$/u);
  if (!match) fail(path, 'Use a photo ID or path listed in culture-library.json, such as library/olive-oil-1.jpg, or a picture generated for this device, such as generated/dna5-1.png.');
  return `library/${match[1]}.jpg`;
}
/** Host photo library as path -> tags; null when the caller supplied none, so image tokens are checked for form only. */
function photoLibrary(library) {
  return Array.isArray(library) ? new Map(library.filter(item => plain(item) && Array.isArray(item.tags))
    .map(item => [libraryImagePath(item.path ?? item.id, 'library'), { tags: item.tags.filter(tag => typeof tag === 'string') }])) : null;
}
/** Site files without the culture records, where a library photo path counts as used: an img src, a CSS url() or a local script. */
function siteText(files) {
  return Object.entries(files || {}).filter(([file, content]) => typeof content === 'string' && !/^culture-.*\.json$/u.test(file)).map(([, content]) => content).join('\n');
}
const photoReferences = value => [...new Set(value.match(/library\/[a-z0-9][a-z0-9-]{0,60}\.jpg/gu) || [])].sort();

/**
 * What a medium asks of motion and illustration devices. A website moves with CSS keyframes or transitions and draws
 * inline SVG; a medium the host checks by literal text, such as a native app's source, may move and draw with any
 * declared token, and its devices may declare literals: exact strings the host finds in its files.
 */
export const WEB_DNA_RULES = Object.freeze({ motion: 'css', illustration: 'svg', literals: false });
function dnaRules(rules) {
  if (rules === undefined) return WEB_DNA_RULES;
  if (!plain(rules) || !['css', 'any'].includes(rules.motion ?? 'css') || !['svg', 'any'].includes(rules.illustration ?? 'svg') || typeof (rules.literals ?? false) !== 'boolean') fail('rules', 'Use {motion:"css"|"any", illustration:"svg"|"any", literals:boolean}.');
  return { motion: rules.motion ?? 'css', illustration: rules.illustration ?? 'svg', literals: rules.literals ?? false };
}

function normalizeTokens(value, path, { fonts: fontsLibrary = null, literals: allowLiterals = false } = {}) {
  object(value, path, ['colors', 'fonts', 'css', 'ids', 'copy', 'images', 'keyframes', 'svg', ...(allowLiterals ? ['literals'] : [])]);
  const colors = [...new Set(list(value.colors, `${path}.colors`, { max: 6 }).map((color, index) => hexColor(color, `${path}.colors[${index}]`)))];
  const fonts = [...new Set(list(value.fonts, `${path}.fonts`, { max: 4 }).map((font, index) => libraryFamily(fontName(font, `${path}.fonts[${index}]`), fontsLibrary, `${path}.fonts[${index}]`)))];
  const css = list(value.css, `${path}.css`, { max: 6 }).map((rule, index) => {
    const at = `${path}.css[${index}]`;
    object(rule, at, ['property', 'value']);
    const property = text(rule.property, `${at}.property`, { max: 60 }).toLowerCase();
    if (!/^(?:--)?[a-z][a-z0-9-]*$/u.test(property)) fail(`${at}.property`, 'Use a CSS property name such as aspect-ratio.');
    const declared = text(rule.value, `${at}.value`, { max: 120 });
    if (/[;{}<>]/u.test(declared)) fail(`${at}.value`, 'Use one literal CSS value without semicolons or braces.');
    return { property, value: declared };
  });
  const ids = [...new Set(list(value.ids, `${path}.ids`, { max: 6 }).map((id, index) => elementId(id, `${path}.ids[${index}]`)))];
  const copy = [...new Set(list(value.copy, `${path}.copy`, { max: 3 }).map((line, index) => text(line, `${path}.copy[${index}]`, { min: 3, max: 160 })))];
  const images = [...new Set(list(value.images, `${path}.images`, { max: 4 }).map((image, index) => libraryImagePath(image, `${path}.images[${index}]`)))];
  // Motion and illustration tokens: @keyframes names the CSS defines and uses, and IDs of inline <svg> illustrations.
  const keyframes = [...new Set(list(value.keyframes, `${path}.keyframes`, { max: 4 }).map((name, index) => keyframesName(name, `${path}.keyframes[${index}]`)))];
  const svg = [...new Set(list(value.svg, `${path}.svg`, { max: 4 }).map((id, index) => elementId(id, `${path}.svg[${index}]`)))];
  const literals = allowLiterals ? [...new Set(list(value.literals, `${path}.literals`, { max: 6 }).map((line, index) => text(line, `${path}.literals[${index}]`, { min: 2, max: 120 })))] : [];
  if (!colors.length && !fonts.length && !css.length && !ids.length && !copy.length && !images.length && !keyframes.length && !svg.length && !literals.length) fail(path, 'Declare at least one literal token the host can check.');
  return { colors, fonts, css, ids, copy, images, keyframes, svg, ...(allowLiterals ? { literals } : {}) };
}
const movesWith = tokens => tokens.keyframes.length > 0 || tokens.css.some(rule => /^(?:animation|transition)/u.test(rule.property));
// A medium checked by literal text moves with whatever its devices declare: keyframes, CSS values or literals.
const movesBy = (tokens, rules) => rules.motion === 'css' ? movesWith(tokens) : movesWith(tokens) || tokens.css.length > 0 || (tokens.literals || []).length > 0;
const drawsBy = (tokens, rules) => rules.illustration === 'svg' ? tokens.svg.length > 0 : tokens.svg.length > 0 || tokens.images.length > 0 || (tokens.literals || []).length > 0;

/**
 * Library photos follow the device, not the other way round: each photo must carry one of the device's qualities
 * (returned tags for measured anchors), and the device must treat it with its own palette so it fits the page.
 */
function checkDeviceImages(device, at, library) {
  const { colors, css } = device.tokens;
  // Library photos must fit the device and take on its palette; generated pictures were made from the device itself.
  const images = device.tokens.images.filter(image => !GENERATED_PICTURE.test(image));
  if (!images.length) return;
  if (library) {
    if (!library.size) fail(`${at}.tokens.images`, 'This run has no host photo library, so a device cannot list photos. Use original SVG or CSS imagery instead.');
    const qualities = new Set((device.qualities || []).map(normalizeTasteName));
    images.forEach((image, index) => {
      const photo = library.get(image);
      if (!photo) fail(`${at}.tokens.images[${index}]`, `${image} is not in culture-library.json. Use a listed photo path.`);
      if (!photo.tags.some(tag => qualities.has(normalizeTasteName(tag)))) fail(`${at}.tokens.images[${index}]`, `${image} is tagged ${photo.tags.join(', ')}; it fits a device only when one of those tags is among the device's qualities. Choose a photo that matches the qualities, or describe this device without photos.`);
    });
  }
  if (colors.length < 2 || !css.some(rule => ['filter', 'mix-blend-mode'].includes(rule.property))) fail(`${at}.tokens`, 'A device that uses library photos must treat them with its own palette: declare at least two of its colors and a filter or mix-blend-mode CSS value, for example a grayscale filter on the photo blended over the two colors.');
}

/** Tokens of a device that the frozen sketch did not contain: far colors, other font families and new element IDs. */
function sketchNovelty(tokens, sketch, existingIds) {
  const sketchLab = sketch.palette.map(srgbToLab), sketchFonts = new Set(sketch.fonts.map(normalizeTasteName));
  const known = new Set([...sketch.sections, ...existingIds]);
  return { colors: tokens.colors.filter(hex => Math.min(...sketchLab.map(lab => deltaE(srgbToLab(hex), lab))) >= TASTE_LIMITS.sketchDeltaE),
    fonts: tokens.fonts.filter(font => !GENERIC_FONTS.has(font.toLowerCase()) && !sketchFonts.has(normalizeTasteName(font))),
    ids: tokens.ids.filter(id => !known.has(id)) };
}

/**
 * Validate a Design DNA against the taste input the agent actually received. With a frozen design sketch and measured
 * surprises, surprise-anchored devices must depart from the sketch in palette, type and structure; the live 0.4.0 runs
 * kept the model's own serif-and-typewriter system and section plan even when every device cited a surprise.
 */
export function normalizeDesignDna(raw, { input, sketch, existingIds = [], library, fonts, maxRequiredRejections = TASTE_LIMITS.maxRequiredRejections, rules: ruleInput } = {}) {
  if (!plain(input) || !Array.isArray(input.entities)) fail('input', 'The taste input for this run is required.');
  const rules = dnaRules(ruleInput);
  const refs = new Map(input.entities.map(entity => [entity.ref, entity]));
  const frozen = plain(sketch) ? sketch : null, starterIds = Array.isArray(existingIds) ? existingIds : [];
  const photos = photoLibrary(library), typefaces = fontLibrary(fonts);
  const source = parsed(raw, 'dna');
  object(source, 'dna', ['schemaVersion', 'thesis', 'devices', 'rejected']);
  if (source.schemaVersion !== TASTE_SCHEMA_VERSION) fail('dna.schemaVersion', "Use schemaVersion '1.0'.");
  const thesis = text(source.thesis, 'dna.thesis', { min: 10, max: 600 });
  const ids = new Set();
  const devices = list(source.devices, 'dna.devices', { min: TASTE_LIMITS.minDevices, max: TASTE_LIMITS.maxDevices }).map((device, index) => {
    const at = `dna.devices[${index}]`;
    object(device, at, ['id', 'layer', 'device', 'anchors', 'qualities', 'translation', 'tokens']);
    const id = text(device.id, `${at}.id`, { max: 40 });
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(id) || ids.has(id)) fail(`${at}.id`, 'Use a unique ID such as dna1.');
    ids.add(id);
    const layer = choice(device.layer, DNA_LAYERS, `${at}.layer`);
    const anchors = [...new Set(list(device.anchors, `${at}.anchors`, { min: 1, max: 3 }).map((ref, anchorIndex) => {
      const value = text(ref, `${at}.anchors[${anchorIndex}]`, { max: 160 });
      if (!refs.has(value)) fail(`${at}.anchors[${anchorIndex}]`, 'Use a ref exactly as returned by project_get_taste.');
      return value;
    }))];
    // Qualities of measured anchors are their returned tags; for the model's own predictions they are its assumption.
    const measured = anchors.map(ref => refs.get(ref)).filter(entity => entity.source === 'qloo');
    const tags = new Map(measured.flatMap(entity => entity.tags || []).map(tag => [normalizeTasteName(tag), tag]));
    const qualities = [...new Set(list(device.qualities, `${at}.qualities`, { max: 4 }).map((value, qualityIndex) => {
      const quality = text(value, `${at}.qualities[${qualityIndex}]`, { min: 2, max: 120 });
      if (measured.length && !tags.has(normalizeTasteName(quality))) fail(`${at}.qualities[${qualityIndex}]`, `Use a tag returned for this device's measured anchors, exactly as listed: ${[...tags.values()].slice(0, 12).join('; ') || 'none returned'}.`);
      return measured.length ? tags.get(normalizeTasteName(quality)) : quality;
    }))];
    const surprise = measured.some(entity => entity.surprise);
    if (surprise && tags.size && !qualities.length) fail(`${at}.qualities`, `Name 1-4 returned tags of the surprise anchor that this device translates: ${[...tags.values()].slice(0, 12).join('; ')}.`);
    const tokens = normalizeTokens(device.tokens ?? {}, `${at}.tokens`, { fonts: typefaces, literals: rules.literals });
    if (layer === 'palette' && tokens.colors.length < 2) fail(`${at}.tokens.colors`, 'A palette device declares at least two hex colors used in the CSS.');
    if (layer === 'typography' && !tokens.fonts.some(font => !GENERIC_FONTS.has(font.toLowerCase()))) fail(`${at}.tokens.fonts`, `A typography device declares at least one named font family${typefaces ? ' from culture-fonts.json' : ' that visitors have'}.`);
    if (layer === 'motion' && !movesBy(tokens, rules)) fail(`${at}.tokens`, rules.motion === 'css' ? 'A motion device declares what moves: tokens.keyframes for the @keyframes it defines and uses, or an animation or transition CSS value.'
      : 'A motion device declares what moves: tokens.keyframes, an animation or transition value in tokens.css, or the literal code of the motion in tokens.literals, such as a spring or duration call.');
    checkDeviceImages({ tokens, qualities }, at, photos);
    return { id, layer, device: text(device.device, `${at}.device`, { min: 3, max: 200 }), anchors, ...(qualities.length ? { qualities } : {}),
      translation: text(device.translation, `${at}.translation`, { min: 10, max: 900 }), tokens, ...(surprise ? { surprise: true } : {}),
      ...(frozen ? { novel: sketchNovelty(tokens, frozen, starterIds) } : {}) };
  });
  const layers = new Set(devices.map(device => device.layer));
  if (!layers.has('palette') || !layers.has('typography')) fail('dna.devices', 'Include palette and typography devices.');
  if (!STRUCTURAL_DNA_LAYERS.some(layer => layers.has(layer))) fail('dna.devices', `Include at least one device in ${STRUCTURAL_DNA_LAYERS.join(', ')}.`);
  if (layers.size < 4) fail('dna.devices', 'Cover at least four distinct layers.');
  const listed = entities => entities.slice(0, 8).map(entity => `${entity.name} (${entity.ref})`).join(', ');
  const measuredRun = input.entities.some(entity => entity.source === 'qloo');
  // Qualities first: palette and type translate qualities the audience's works share, and entities are evidence of them.
  // Recorded runs took one entity's own look instead, such as an ice hockey team's black and silver for a food shop.
  // The rule applies when the taste input has aggregated qualities: measured ones in a measured run, predicted ones otherwise.
  const shared = input.entities.filter(entity => entity.domain === QUALITY_DOMAIN && (!measuredRun || entity.source === 'qloo'));
  if (shared.length) {
    const pool = [...shared].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .concat(input.entities.filter(entity => isTagDomain(entity.domain) && (!measuredRun || entity.source === 'qloo')));
    const poolRefs = new Set(pool.map(entity => entity.ref));
    for (const layer of ['palette', 'typography']) if (!devices.some(device => device.layer === layer && device.anchors.some(ref => poolRefs.has(ref)))) {
      fail('dna.devices', `Qualities first: anchor a ${layer} device to at least one ${measuredRun ? 'measured ' : ''}quality ref, such as ${listed(pool)}, and let it set the ${layer === 'palette' ? 'colors' : 'type'}. Entities are evidence of the qualities; never take an entity's own brand or team colors, logo, packaging or trade dress.`);
    }
  }
  // Motion translates the audience's style tags and illustration its aesthetic tags: measured ones when the run has them,
  // otherwise the qualities the model predicted. Both arms follow the same rule; only the source of the tags differs.
  // A measured ranking that returned nothing gives way to the measured qualities of the nearest family, mood for motion
  // and look for illustration: the Echo Atlas passes returned no aesthetic tag, and both arms drew from the prediction.
  const tagAnchors = (domain, family) => {
    const all = input.entities.filter(entity => entity.domain === domain), measured = all.filter(entity => entity.source === 'qloo');
    const derived = all.length && !measured.length ? input.entities.filter(entity => entity.domain === QUALITY_DOMAIN && entity.source === 'qloo' && entity.family === family) : [];
    const pool = measured.length ? measured : derived.length ? derived : all;
    return { refs: new Set(pool.map(entity => entity.ref)), names: listed(pool),
      label: derived.length ? `measured ${family} quality (the ${domain} ranking returned no tags)` : `${measured.length ? 'measured ' : ''}${domain} ref` };
  };
  const style = tagAnchors('style', 'mood'), aesthetic = tagAnchors('aesthetic', 'look');
  if (style.refs.size && !devices.some(device => device.layer === 'motion' && device.anchors.some(ref => style.refs.has(ref)) && movesBy(device.tokens, rules))) {
    fail('dna.devices', `Include a motion device anchored to a ${style.label} that translates it into tempo, easing and what moves: ${style.names}. ${rules.motion === 'css' ? 'Declare tokens.keyframes for the @keyframes it defines and uses, or an animation or transition CSS value.' : 'Declare its keyframes, an animation or transition value, or the literal code of the motion in tokens.literals.'}`);
  }
  if (aesthetic.refs.size && !devices.some(device => drawsBy(device.tokens, rules) && device.anchors.some(ref => aesthetic.refs.has(ref)))) {
    fail('dna.devices', rules.illustration === 'svg' ? `Include a device anchored to a ${aesthetic.label} that draws an original inline SVG illustration of it: ${aesthetic.names}. List the id of each <svg> it draws in tokens.svg; each needs at least ${TASTE_LIMITS.illustrationShapes} drawn shapes.`
      : `Include a device anchored to a ${aesthetic.label} that draws an original illustration of it: ${aesthetic.names}. List the id of each inline <svg> in tokens.svg, the photos it shows in tokens.images, or the file or asset name of the drawing in tokens.literals.`);
  }
  if (frozen && input.entities.some(entity => entity.source === 'qloo' && entity.surprise)) {
    const moved = devices.filter(device => device.surprise);
    const named = device => device.tokens.fonts.filter(font => !GENERIC_FONTS.has(font.toLowerCase()));
    // Name the offending tokens so the agent can repair the DNA in one save instead of guessing color distances.
    const kept = (layers, pick) => [...new Set(moved.filter(device => layers.includes(device.layer)).flatMap(pick))];
    const nearest = hex => frozen.palette.map(color => ({ color, distance: deltaE(srgbToLab(hex), srgbToLab(color)) })).sort((a, b) => a.distance - b.distance)[0];
    const close = kept(['palette'], device => device.tokens.colors.filter(hex => !device.novel.colors.includes(hex))).slice(0, 6).map(hex => { const { color, distance } = nearest(hex); return `${hex} (${Math.round(distance)} from ${color})`; });
    const sketchFonts = kept(['typography'], device => named(device).filter(font => !device.novel.fonts.includes(font)));
    const knownIds = kept(STRUCTURAL_DNA_LAYERS, device => device.tokens.ids.filter(id => !device.novel.ids.includes(id))).slice(0, 6).map(id => `#${id}`);
    if (!moved.some(device => device.layer === 'palette' && device.novel.colors.length >= 2)) fail('dna.devices', `Measured surprises must move the palette away from your frozen sketch (${frozen.palette.join(', ')}). Give a palette device anchored to a surprise entity or quality at least two colors with a CIE76 difference of at least ${TASTE_LIMITS.sketchDeltaE} from every sketch color.${close.length ? ` Too close now: ${close.join(', ')}.` : ''}`);
    if (!moved.some(device => device.layer === 'typography' && named(device).length && device.novel.fonts.length === named(device).length)) fail('dna.devices', `Measured surprises must move the type system away from your frozen sketch (${frozen.fonts.join(', ')}). Give a typography device anchored to a surprise entity or quality only named font families outside the sketch, and use them for headings or body text.${sketchFonts.length ? ` Still from the sketch: ${sketchFonts.join(', ')}.` : ''}`);
    if (!moved.some(device => STRUCTURAL_DNA_LAYERS.includes(device.layer) && device.novel.ids.length)) fail('dna.devices', `Measured surprises must change the page structure, not only its surface. Give a ${STRUCTURAL_DNA_LAYERS.join(', ')} device anchored to a surprise entity or quality at least one new element ID for a new major section or component: not a sketch section (${frozen.sections.join(', ')}) and not an existing starter ID.${knownIds.length ? ` Already known: ${knownIds.join(', ')}.` : ''}`);
  }
  const used = new Set(devices.flatMap(device => device.anchors));
  const rejectedRefs = new Set();
  const rejected = list(source.rejected, 'dna.rejected', { max: 6 }).map((item, index) => {
    const at = `dna.rejected[${index}]`;
    object(item, at, ['ref', 'reason']);
    const ref = text(item.ref, `${at}.ref`, { max: 160 });
    if (!refs.has(ref)) fail(`${at}.ref`, 'Use a ref exactly as returned by project_get_taste.');
    if (rejectedRefs.has(ref) || used.has(ref)) fail(`${at}.ref`, 'A ref is either used by a device or rejected once, not both.');
    rejectedRefs.add(ref);
    return { ref, reason: text(item.reason, `${at}.reason`, { min: 10, max: 400 }) };
  });
  const required = Array.isArray(input.requiredAnchors) ? input.requiredAnchors.filter(ref => refs.has(ref)) : [];
  const missing = required.filter(ref => !used.has(ref) && !rejectedRefs.has(ref));
  if (missing.length) fail('dna.devices', `Every required anchor needs a device or a reasoned rejection. Missing: ${missing.map(ref => `${refs.get(ref).name} (${ref})`).join(', ')}.`);
  const rejectedRequired = required.filter(ref => rejectedRefs.has(ref));
  if (rejectedRequired.length > maxRequiredRejections) fail('dna.rejected', `At most ${maxRequiredRejections} required anchors may be rejected.`);
  // Voice writes the narrative over the fixed facts. The live Echo Atlas pair kept the starter's headline and every
  // item description in both arms, so the two sites read alike whatever their taste input.
  const measuredRefs = new Set(input.entities.filter(entity => entity.source === 'qloo').map(entity => entity.ref));
  if (!devices.some(device => device.layer === 'voice' && device.tokens.copy.length >= 2 && (!measuredRefs.size || device.anchors.some(ref => measuredRefs.has(ref))))) {
    fail('dna.devices', `Include a voice device anchored to a ${measuredRefs.size ? 'measured ' : ''}ref whose quality sets the register, rhythm and vocabulary of the visitor copy, and declare at least two lines you wrote in that voice in tokens.copy, such as the headline.`);
  }
  const dna = { schemaVersion: TASTE_SCHEMA_VERSION, thesis, devices, rejected,
    coverage: { required, used: required.filter(ref => used.has(ref)), rejected: rejectedRequired }, sourceType: 'model-interpretation' };
  return { ...dna, stats: designDnaStats(dna, input) };
}

export function designDnaStats(dna, input) {
  const refs = new Map((input?.entities || []).map(entity => [entity.ref, entity]));
  const anchored = (dna?.devices || []).map(device => device.anchors.map(ref => refs.get(ref)).filter(Boolean));
  const qloo = anchored.filter(anchors => anchors.some(entity => entity.source === 'qloo')).length;
  const surprise = anchored.filter(anchors => anchors.some(entity => entity.source === 'qloo' && entity.surprise)).length;
  const model = anchored.filter(anchors => anchors.length && anchors.every(entity => entity.source === 'model-assumption')).length;
  // Devices translating a quality of the run's own taste source: measured tags and qualities with Qloo, predicted ones without.
  const own = input?.source === 'qloo-profile' ? 'qloo' : 'model-assumption';
  const quality = anchored.filter(anchors => anchors.some(entity => isQualityDomain(entity.domain) && entity.source === own)).length;
  const total = anchored.length;
  const novel = (dna?.devices || []).filter(device => device.novel);
  const unique = key => [...new Set(novel.flatMap(device => device.novel[key]))];
  return { devices: total, layers: [...new Set((dna?.devices || []).map(device => device.layer))], qlooAnchoredDevices: qloo,
    surpriseAnchoredDevices: surprise, modelAnchoredDevices: model, qualityAnchoredDevices: quality, surpriseShare: total ? round(surprise / total, 3) : 0,
    ...(novel.length ? { sketchMoves: { devices: novel.filter(device => device.novel.colors.length || device.novel.fonts.length || device.novel.ids.length).length,
      colors: unique('colors'), fonts: unique('fonts'), ids: unique('ids') } } : {}) };
}

/** Decisions for the inspector come from the binding DNA, so every rationale names its anchor entity. */
export function dnaDecisions(dna, input) {
  const refs = new Map((input?.entities || []).map(entity => [entity.ref, entity]));
  return (dna?.devices || []).map(device => {
    const anchors = device.anchors.map(ref => refs.get(ref)).filter(Boolean);
    // A quality rests on the responses of the works that carry it.
    const evidenceIds = [...new Set(anchors.flatMap(entity => [entity.evidenceId, ...(Array.isArray(entity.evidenceIds) ? entity.evidenceIds : [])]).filter(id => typeof id === 'string'))];
    const label = entity => entity.source === 'qloo' ? `${entity.name} (Qloo${entity.family ? ` ${entity.family} quality of ${entity.count} works` : ''}${entity.surprise ? ', not predicted' : entity.predictedByModel ? ', also predicted' : ''})` : `${entity.name} (model prediction)`;
    return { title: `${device.layer[0].toUpperCase()}${device.layer.slice(1)} · ${device.device}`.slice(0, 200), change: device.translation,
      reason: `Anchored to ${anchors.map(label).join(', ')}.`.slice(0, 1200), evidenceIds,
      anchorEntityIds: anchors.filter(entity => entity.source === 'qloo' && typeof entity.entityId === 'string').map(entity => entity.entityId),
      selectors: [...new Set([...device.tokens.ids, ...(device.tokens.svg || [])])].map(id => `#${id}`), properties: [...new Set(device.tokens.css.map(rule => rule.property))].filter(property => !property.startsWith('--')),
      sourceType: evidenceIds.length ? 'qloo' : 'model-interpretation', dnaId: device.id, layer: device.layer };
  });
}

function expandHex(value) {
  const hex = value.toLowerCase().replace('#', '');
  return '#' + (hex.length === 3 || hex.length === 4 ? hex.slice(0, 3).split('').map(char => char + char).join('') : hex.slice(0, 6));
}
function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360, sat = Math.min(1, Math.max(0, s / 100)), light = Math.min(1, Math.max(0, l / 100));
  const convert = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let r, g, b;
  if (!sat) r = g = b = light;
  else { const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat, p = 2 * light - q; r = convert(p, q, hue + 1 / 3); g = convert(p, q, hue); b = convert(p, q, hue - 1 / 3); }
  return '#' + [r, g, b].map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
}
/** Every color a CSS value names (hex, rgb() or hsl()) as #rrggbb. */
export function colorsIn(value) {
  const found = [];
  for (const match of value.matchAll(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/giu)) found.push(expandHex(match[0]));
  for (const match of value.matchAll(/rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})/giu)) found.push('#' + match.slice(1, 4).map(part => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join(''));
  for (const match of value.matchAll(/hsla?\(\s*(-?[\d.]+)(?:deg)?(?:\s*,\s*|\s+)([\d.]+)%(?:\s*,\s*|\s+)([\d.]+)%/giu)) found.push(hslToHex(Number(match[1]), Number(match[2]), Number(match[3])));
  return found;
}

function cssSources(files) {
  const parts = [];
  for (const [file, content] of Object.entries(files || {})) {
    if (typeof content !== 'string' || /^culture-.*\.json$/u.test(file)) continue;
    if (file.endsWith('.css')) parts.push(content);
    if (file.endsWith('.html')) {
      for (const match of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)) parts.push(match[1]);
      for (const match of content.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/giu)) parts.push(`{${match[2]}}`);
    }
  }
  return parts.join('\n');
}
function declarations(css) {
  const result = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//gu, ' ');
  for (const block of clean.matchAll(/\{([^{}]*)\}/gu)) {
    for (const part of block[1].split(';')) {
      const index = part.indexOf(':');
      if (index < 1) continue;
      const property = part.slice(0, index).trim().toLowerCase();
      const value = part.slice(index + 1).trim();
      if (value && /^(?:--)?[a-z][a-z0-9-]*$/u.test(property)) result.push({ property, value: value.replace(/\s*!important\s*$/iu, '') });
    }
  }
  return result;
}
const compact = value => value.toLowerCase().replace(/\s+/gu, '');
function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|middot|mdash|ndash|rsquo|lsquo|ldquo|rdquo|hellip);/giu, (whole, code) => {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' }[code.toLowerCase()];
    if (named) return named;
    const number = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
  });
}
function visibleText(html) {
  return decode(html.replace(/<script\b[\s\S]*?<\/script\s*>/giu, ' ').replace(/<style\b[\s\S]*?<\/style\s*>/giu, ' ').replace(/<!--[\s\S]*?-->/gu, ' ').replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ').trim().toLowerCase();
}
function htmlIds(html) {
  return new Set([...html.matchAll(/\sid\s*=\s*(["'])([^"']+)\1/giu)].map(match => match[2]));
}
/** String values of the page's JSON data islands, such as a catalogue its script renders, as lowercase text. */
function dataIslandText(html) {
  const values = [];
  const visit = (value, depth) => {
    if (depth > 6 || values.length >= 2000) return;
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(item => visit(item, depth + 1));
    else if (plain(value)) Object.values(value).forEach(item => visit(item, depth + 1));
  };
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*(["'])application\/(?:ld\+)?json\1[^>]*>([\s\S]*?)<\/script\s*>/giu)) {
    try { visit(JSON.parse(match[2]), 0); } catch { /* A data island that is not JSON holds no copy. */ }
  }
  return values.join('\n').replace(/[^\S\n]+/gu, ' ').toLowerCase();
}

/** Token-level normalization for a caller-supplied DNA whose anchors cannot be checked here. */
export function normalizeDnaForCheck(raw, { literals = false } = {}) {
  const source = parsed(raw, 'dna');
  if (!plain(source)) fail('dna', 'A Design DNA object is required.');
  const devices = list(source.devices, 'dna.devices', { min: 1, max: TASTE_LIMITS.maxDevices }).map((device, index) => {
    const at = `dna.devices[${index}]`;
    if (!plain(device)) fail(at, 'A device object is required.');
    return { id: text(device.id, `${at}.id`, { max: 40 }), layer: choice(device.layer, DNA_LAYERS, `${at}.layer`),
      device: text(device.device ?? device.id, `${at}.device`, { max: 200 }), tokens: normalizeTokens(device.tokens ?? {}, `${at}.tokens`, { literals }) };
  });
  return { devices };
}

/** Every CSS declaration of the files, from stylesheets, style elements and style attributes, without @font-face rules. */
export function cssDeclarations(files) {
  if (!plain(files)) fail('files', 'An object of file paths and text contents is required.');
  return cssModel(files).rules;
}

/**
 * All site CSS without comments, with @font-face rules split out and the @keyframes names it defines. A font-family
 * inside @font-face only names a file, so it never counts as using that family.
 */
function cssModel(files) {
  const fontFaces = [];
  const text = cssSources(files).replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/@font-face\s*\{([^{}]*)\}/giu, (whole, body) => {
    const family = declarations(`{${body}}`).find(rule => rule.property === 'font-family')?.value.trim().replace(/^["']|["']$/gu, '');
    const sources = [...body.matchAll(/url\(\s*(["']?)([^"')]+?)\1\s*\)/giu)].map(match => match[2].trim().replace(/^\.\//u, ''));
    if (family) fontFaces.push({ family, sources });
    return ' ';
  });
  const keyframes = [...new Set([...text.matchAll(/@(?:-webkit-)?keyframes\s+(["']?)(-?[A-Za-z_][\w-]*)\1\s*\{/giu)].map(match => match[2]))];
  return { text, rules: declarations(text), fontFaces, keyframes };
}
const ANIMATION_WORDS = new Set(['none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both',
  'running', 'paused', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'auto']);
/** Keyframes names that animation declarations use, and those that loop without end, rule block by rule block. */
function animationUse(text) {
  const used = new Set(), infinite = new Set();
  for (const block of text.matchAll(/\{([^{}]*)\}/gu)) {
    const rules = declarations(`{${block[1]}}`), names = [];
    for (const rule of rules) {
      if (rule.property !== 'animation' && rule.property !== 'animation-name') continue;
      for (const part of rule.value.split(',')) {
        const words = part.replace(/[a-z-]+\([^)]*\)/giu, ' ').trim().split(/\s+/u).filter(Boolean);
        const name = words.find(word => /^-?[A-Za-z_][\w-]*$/u.test(word) && !ANIMATION_WORDS.has(word.toLowerCase()));
        if (!name) continue;
        names.push(name); used.add(name);
        if (rule.property === 'animation' && words.some(word => word.toLowerCase() === 'infinite')) infinite.add(name);
      }
    }
    if (rules.some(rule => rule.property === 'animation-iteration-count' && /\binfinite\b/iu.test(rule.value))) for (const name of names) infinite.add(name);
  }
  return { used: [...used], infinite: [...infinite] };
}
/** Whether a prefers-reduced-motion media query changes animation, transitions or smooth scrolling. */
function honorsReducedMotion(text) {
  for (const match of text.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{/giu)) {
    let depth = 1, index = match.index + match[0].length;
    const start = index;
    while (index < text.length && depth) { if (text[index] === '{') depth++; else if (text[index] === '}') depth--; index++; }
    if (/\b(?:animation|transition|scroll-behavior)\b/iu.test(text.slice(start, index))) return true;
  }
  return false;
}
const SVG_SHAPE = /<(?:path|circle|ellipse|line|polyline|polygon|rect|use)\b/giu;
/** Inline SVG elements that have an id, with the number of shapes each draws. */
function svgIllustrations(html) {
  const result = new Map();
  for (const match of html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg\s*>/giu)) {
    const id = /\sid\s*=\s*(["'])([^"']+)\1/iu.exec(` ${match[1]}`)?.[2];
    if (id && !result.has(id)) result.set(id, (match[2].match(SVG_SHAPE) || []).length);
  }
  return result;
}
const fontReferences = value => [...new Set(value.match(/fonts\/[a-z0-9][a-z0-9-]{0,80}\.woff2/gu) || [])].sort();

/**
 * Literal token presence only: a host check, not a judgment of quality, legibility or visitor preference.
 * With the host photo library it also lists photo paths the site references that the library does not contain; with the
 * font library, whether each declared family is loaded from its listed files. A device that animates also needs the
 * reduced-motion fallback and, for an endless loop, a pause control, because motion is only acceptable when it can stop.
 */
export function checkDnaConformance(dna, files = {}, { library, fonts } = {}) {
  if (!plain(dna) || !Array.isArray(dna.devices)) fail('dna', 'A validated Design DNA is required.');
  if (!plain(files)) fail('files', 'An object of file paths and text contents is required.');
  const model = cssModel(files), css = model.rules;
  const html = typeof files['index.html'] === 'string' ? files['index.html'] : Object.entries(files).find(([file, content]) => file.endsWith('.html') && typeof content === 'string')?.[1] || '';
  const colors = new Set(css.flatMap(rule => colorsIn(rule.value)));
  const fontValues = css.filter(rule => rule.property === 'font-family' || rule.property === 'font' || rule.property.startsWith('--')).map(rule => rule.value.toLowerCase());
  const ids = htmlIds(html), visible = visibleText(html), data = dataIslandText(html), site = siteText(files);
  const copy = value => { const line = value.replace(/\s+/gu, ' ').trim().toLowerCase(); return visible.includes(line) || data.includes(line); };
  const photos = photoLibrary(library), referenced = photoReferences(site);
  const typefaces = fontLibrary(fonts);
  const loaded = family => model.fontFaces.some(face => normalizeTasteName(face.family) === normalizeTasteName(family.family) && face.sources.some(source => family.files.includes(source)));
  const animations = animationUse(model.text), reduced = honorsReducedMotion(model.text), pauseControl = /data-motion-toggle/u.test(site);
  const illustrations = svgIllustrations(html);
  const devices = dna.devices.map(device => {
    const tokens = device.tokens || {};
    const animated = (tokens.keyframes || []).length > 0 || (tokens.css || []).some(rule => rule.property.startsWith('animation'));
    const names = [...(tokens.keyframes || []), ...(tokens.css || []).filter(rule => rule.property.startsWith('animation')).flatMap(rule => animations.used.filter(name => new RegExp(`(?:^|[\\s,])${name}(?:$|[\\s,])`, 'u').test(rule.value)))];
    const checks = [
      ...(tokens.images || []).map(value => ({ kind: 'image', value, present: site.includes(value) })),
      ...(tokens.colors || []).map(value => ({ kind: 'color', value, present: colors.has(expandHex(value)) })),
      ...(tokens.fonts || []).map(value => ({ kind: 'font', value, present: fontValues.some(rule => rule.includes(value.toLowerCase())) })),
      ...(typefaces ? (tokens.fonts || []).map(value => typefaces.get(normalizeTasteName(value))).filter(Boolean).map(family => ({ kind: 'font-file', value: family.family, present: loaded(family),
        detail: `@font-face for ${family.family} with src ${family.files[0]}` })) : []),
      ...(tokens.css || []).map(rule => ({ kind: 'css', value: `${rule.property}: ${rule.value}`, present: css.some(item => item.property === rule.property && compact(item.value).includes(compact(rule.value))) })),
      ...(tokens.keyframes || []).map(value => ({ kind: 'keyframes', value, present: model.keyframes.includes(value) && animations.used.includes(value),
        detail: !model.keyframes.includes(value) ? `no @keyframes ${value} rule` : `@keyframes ${value} is defined but no animation uses it` })),
      ...(tokens.svg || []).map(value => ({ kind: 'svg', value, present: (illustrations.get(value) ?? -1) >= TASTE_LIMITS.illustrationShapes,
        detail: illustrations.has(value) ? `the <svg id="${value}"> draws ${illustrations.get(value)} shapes; it needs at least ${TASTE_LIMITS.illustrationShapes}` : `no inline <svg id="${value}"> in index.html` })),
      ...(tokens.ids || []).map(value => ({ kind: 'id', value, present: ids.has(value) })),
      ...(tokens.copy || []).map(value => ({ kind: 'copy', value, present: copy(value) })),
      ...(animated ? [{ kind: 'motion', value: 'reduced-motion fallback', present: reduced, detail: '@media (prefers-reduced-motion: reduce) that stops or simplifies the animation' }] : []),
      ...(names.some(name => animations.infinite.includes(name)) ? [{ kind: 'motion', value: 'pause control', present: pauseControl, detail: 'a button with data-motion-toggle that pauses endless animation' }] : []),
    ];
    const found = checks.filter(check => check.present).length;
    return { id: device.id, layer: device.layer, device: device.device, status: !checks.length ? 'missing' : found === checks.length ? 'present' : found ? 'partial' : 'missing',
      tokens: checks.length, found, missing: checks.filter(check => !check.present).map(({ kind, value, detail }) => ({ kind, value, ...(detail ? { detail } : {}) })) };
  });
  const present = devices.filter(device => device.status === 'present').length, partial = devices.filter(device => device.status === 'partial').length;
  const score = devices.length ? round((present + partial / 2) / devices.length, 3) : 0;
  const fontFiles = fontReferences(site), listedFiles = new Set(typefaces ? [...typefaces.values()].flatMap(family => family.files) : []);
  return { status: 'checked', score, threshold: TASTE_LIMITS.conformanceThreshold, meetsThreshold: score >= TASTE_LIMITS.conformanceThreshold,
    present, partial, missing: devices.length - present - partial, total: devices.length, devices,
    ...(photos ? { photos: { used: referenced.filter(item => photos.has(item)), unknown: referenced.filter(item => !photos.has(item)) } } : {}),
    ...(typefaces ? { fonts: { loaded: [...typefaces.values()].filter(loaded).map(family => family.family), unknown: fontFiles.filter(file => !listedFiles.has(file)) } } : {}),
    motion: { keyframes: model.keyframes, used: animations.used, undefined: animations.used.filter(name => !model.keyframes.includes(name)), infinite: animations.infinite, reducedMotion: reduced, pauseControl },
    illustrations: [...illustrations].map(([id, shapes]) => ({ id, shapes })),
    limitation: 'Checks that declared colors, font families and their font files, CSS values, keyframes, element IDs, SVG illustrations, copy and library photo paths literally occur in the saved files, and that animation has a reduced-motion fallback and, when it loops, a pause control. It does not measure visual quality, legibility, motion quality, semantic fit or visitor preference.' };
}

function classifyFont(name) {
  const value = name.toLowerCase();
  if (/mono|courier|consolas|menlo|monaco|lucida console|typewriter/u.test(value)) return 'mono';
  if (/sans/u.test(value)) return /condensed|black|display/u.test(value) ? 'display' : 'sans';
  if (/serif|georgia|times|garamond|palatino|baskerv|iowan|charter|didot|bodoni|caslon|cambria|constantia|antiqua|hoefler|minion|sitka|playfair|fraunces|lora|merriweather|cochin|literata|gelasio|prata|rozha|zilla|slab/u.test(value)) return 'serif';
  if (/impact|futura|rockwell|copperplate|black|condensed|fantasy|cursive|bahnschrift|franklin gothic|haettenschweiler|marker|brush|chalk|stencil|script|display|oswald|bebas|shoulders|syne|unbounded|poiret|caveat/u.test(value)) return 'display';
  return 'sans';
}
function fontFamilies(rules) {
  const variables = new Map(rules.filter(rule => rule.property.startsWith('--')).map(rule => [rule.property, rule.value]));
  const resolve = (value, depth = 0) => depth > 4 ? value : value.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,([^)]*))?\)/giu, (whole, name, fallback) => variables.has(name.toLowerCase()) ? resolve(variables.get(name.toLowerCase()), depth + 1) : (fallback || ''));
  const families = [];
  for (const rule of rules) {
    if (rule.property !== 'font-family' && rule.property !== 'font') continue;
    let value = resolve(rule.value);
    if (rule.property === 'font') { const match = /(?:^|\s)[\d.]+(?:px|r?em|%|pt|vw|vh|ch|ex)?(?:\s*\/\s*[\d.]+[a-z%]*)?\s+(.+)$/iu.exec(value); if (!match) continue; value = match[1]; }
    const first = value.split(',')[0]?.trim().replace(/^["']|["']$/gu, '');
    if (first && !/^(?:inherit|initial|unset|revert)$/iu.test(first)) families.push(first);
  }
  return families;
}
function srgbToLab(hex) {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = channels;
  const xyz = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883];
  const f = value => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const [x, y, z] = xyz.map(f);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const SIGNATURE_FEATURES = ['aspect-ratio', 'grid-template-areas', 'grid-template-columns', 'clip-path', 'mix-blend-mode', 'filter', 'backdrop-filter', 'writing-mode', 'column-count', 'columns',
  'text-transform', 'letter-spacing', 'font-variant', 'text-decoration', 'border-radius', 'box-shadow', 'transform', 'animation', 'transition', 'scroll-snap-type', 'outline-offset', 'background-image', 'mask-image', 'object-fit', 'position'];

/** A bounded, deterministic fingerprint of visual tokens and page structure for A/B distance. */
export function designFingerprint(files = {}) {
  if (!plain(files)) fail('files', 'An object of file paths and text contents is required.');
  const model = cssModel(files), rules = model.rules;
  const html = typeof files['index.html'] === 'string' ? files['index.html'] : '';
  const animations = animationUse(model.text), illustrations = svgIllustrations(html);
  const counts = new Map();
  for (const rule of rules) for (const color of colorsIn(rule.value)) counts.set(color, (counts.get(color) || 0) + 1);
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([hex, count]) => ({ hex, count }));
  const families = [...new Set(fontFamilies(rules))].slice(0, 8);
  const sections = [...html.matchAll(/<(section|header|footer|nav|aside|article|main)\b[^>]*?\sid\s*=\s*(["'])([^"']+)\2/giu)].map(match => match[3]).slice(0, 40);
  const properties = [...new Set(rules.map(rule => rule.property).filter(property => !property.startsWith('--')))].sort();
  const features = SIGNATURE_FEATURES.filter(feature => rules.some(rule => rule.property === feature && !(feature === 'position' && !/sticky|fixed/iu.test(rule.value))));
  const radii = rules.filter(rule => rule.property === 'border-radius').map(rule => Number.parseFloat(rule.value)).filter(Number.isFinite).sort((a, b) => a - b);
  const weighted = palette.reduce((sum, item) => sum + srgbToLab(item.hex)[0] * item.count, 0), weight = palette.reduce((sum, item) => sum + item.count, 0);
  // Library photos referenced anywhere in the site are recorded for analysis; they are not weighted in the distance.
  return { palette, fonts: { families, classes: [...new Set(families.map(classifyFont))].sort() }, sections, properties, features, images: photoReferences(siteText(files)),
    ...(radii.length ? { medianRadius: radii[Math.floor(radii.length / 2)] } : {}), ...(weight ? { paletteLightness: round(weighted / weight, 1) } : {}),
    interactiveElements: (html.match(/<(?:button|details|input|select|textarea|dialog)\b/giu) || []).length, svgElements: (html.match(/<svg\b/giu) || []).length,
    // Motion and illustration are recorded for analysis; like photos, they are not weighted in the distance.
    svgShapes: (html.match(SVG_SHAPE) || []).length, illustrations: [...illustrations.values()].filter(shapes => shapes >= TASTE_LIMITS.illustrationShapes).length,
    motion: { keyframes: model.keyframes.length, animated: animations.used.filter(name => model.keyframes.includes(name)).length, infinite: animations.infinite.length,
      transitions: rules.filter(rule => rule.property === 'transition' || rule.property === 'transition-property').length, reducedMotion: honorsReducedMotion(model.text),
      easings: [...new Set(rules.filter(rule => /^(?:animation|transition)(?:-timing-function)?$/u.test(rule.property)).flatMap(rule => rule.value.match(/cubic-bezier\([^)]*\)|steps\([^)]*\)|ease-in-out|ease-in|ease-out|linear|ease\b/giu) || []).map(value => value.toLowerCase().replace(/\s+/gu, '')))].sort() },
    visibleTextLength: visibleText(html).length };
}

const jaccard = (a, b) => { const x = new Set(a), y = new Set(b); const union = new Set([...x, ...y]); return union.size ? [...x].filter(item => y.has(item)).length / union.size : 1; };
function paletteDistance(a, b) {
  const left = a.slice(0, 6).map(item => srgbToLab(item.hex)), right = b.slice(0, 6).map(item => srgbToLab(item.hex));
  if (!left.length && !right.length) return 0;
  if (!left.length || !right.length) return 1;
  const directed = (from, to) => from.reduce((sum, color) => sum + Math.min(...to.map(other => deltaE(color, other))), 0) / from.length;
  return Math.min(1, (directed(left, right) + directed(right, left)) / 2 / 50);
}

export function compareDesignFingerprints(a, b) {
  if (!plain(a) || !plain(b)) fail('fingerprints', 'Two design fingerprints are required.');
  const palette = paletteDistance(a.palette || [], b.palette || []);
  const typography = 1 - (jaccard(a.fonts?.classes || [], b.fonts?.classes || []) + jaccard((a.fonts?.families || []).map(normalizeTasteName), (b.fonts?.families || []).map(normalizeTasteName))) / 2;
  const structure = 1 - jaccard(a.sections || [], b.sections || []);
  const features = 1 - jaccard([...(a.properties || []), ...(a.features || []).map(item => `feature:${item}`)], [...(b.properties || []), ...(b.features || []).map(item => `feature:${item}`)]);
  const overall = 0.35 * palette + 0.2 * typography + 0.25 * structure + 0.2 * features;
  return { overall: round(overall, 3), palette: round(palette, 3), typography: round(typography, 3), structure: round(structure, 3), features: round(features, 3),
    method: 'Weighted heuristic: palette CIE76 color distance (35%), font family/class difference (20%), landmark section ID difference (25%), CSS property and signature-feature difference (20%).' };
}

export function htmlElementIds(html) { return [...htmlIds(typeof html === 'string' ? html : '')]; }

/** A fingerprint-shaped view of a frozen sketch, so two runs' blind sketches compare like saved sites (palette, type, structure). */
export function sketchFingerprint(sketch) {
  if (!plain(sketch) || !Array.isArray(sketch.palette) || !Array.isArray(sketch.fonts) || !Array.isArray(sketch.sections)) return null;
  const families = sketch.fonts.filter(font => typeof font === 'string');
  return { palette: sketch.palette.filter(hex => typeof hex === 'string' && /^#[0-9a-f]{6}$/iu.test(hex)).map(hex => ({ hex: hex.toLowerCase(), count: 1 })),
    fonts: { families, classes: [...new Set(families.map(classifyFont))].sort() }, sections: sketch.sections.filter(id => typeof id === 'string') };
}

/**
 * How far a saved site moved from the run's own frozen sketch. Unlike an A/B distance it needs no second run:
 * each run carries its counterfactual, so ordinary run-to-run variance does not enter the comparison.
 */
export function sketchDivergence(sketch, files, { existingIds = [] } = {}) {
  if (!plain(sketch) || !Array.isArray(sketch.palette) || !Array.isArray(sketch.fonts) || !Array.isArray(sketch.sections)) return null;
  const fingerprint = designFingerprint(files);
  const sketchFonts = new Set(sketch.fonts.map(normalizeTasteName)), sketchLab = sketch.palette.map(srgbToLab);
  const families = fingerprint.fonts.families.filter(font => !GENERIC_FONTS.has(font.toLowerCase()));
  const newFonts = families.filter(font => !sketchFonts.has(normalizeTasteName(font)));
  const colors = fingerprint.palette.map(item => item.hex);
  const newColors = colors.filter(hex => Math.min(...sketchLab.map(lab => deltaE(srgbToLab(hex), lab))) >= TASTE_LIMITS.sketchDeltaE);
  const known = new Set([...sketch.sections, ...(Array.isArray(existingIds) ? existingIds : [])]);
  const newSections = fingerprint.sections.filter(id => !known.has(id));
  const share = (part, whole) => whole ? round(part / whole, 3) : 0;
  const typography = share(newFonts.length, families.length), palette = share(newColors.length, colors.length), structure = share(newSections.length, fingerprint.sections.length);
  return { typography, palette, structure, score: round((typography + palette + structure) / 3, 3),
    fonts: { site: families, new: newFonts, kept: sketch.fonts.filter(font => families.some(family => normalizeTasteName(family) === normalizeTasteName(font))) },
    colors: { site: colors, new: newColors }, sections: { site: fingerprint.sections, new: newSections },
    method: `Shares of the saved site's named font families outside the frozen sketch, of its eight most frequent colors at least CIE76 ${TASTE_LIMITS.sketchDeltaE} from every sketch color, and of its landmark section IDs absent from the sketch and the starter; the score is their mean.` };
}

/** Planning directions: d0 is the model's default from its own prediction, d1-d3 come from the taste input. */
export function normalizeTasteDirections(raw, { input, audiences = [] } = {}) {
  if (!plain(input) || !Array.isArray(input.entities)) fail('input', 'The taste input for this run is required.');
  const refs = new Map(input.entities.map(entity => [entity.ref, entity]));
  const required = new Set(input.requiredAnchors || []);
  const audienceIds = new Set((audiences || []).map(audience => audience?.id).filter(Boolean));
  const source = parsed(raw, 'directions');
  if (!Array.isArray(source) || source.length !== 4) fail('directions', 'Save exactly four directions: d0, your default from your own prediction, and d1-d3 from the taste input.');
  const items = source;
  const seen = new Set();
  const directions = items.map((item, index) => {
    const at = `directions[${index}]`;
    object(item, at, ['id', 'title', 'summary', 'basis', 'anchors', 'devices', 'changes', 'tradeoffs', 'audienceIds']);
    const id = choice(item.id, ['d0', 'd1', 'd2', 'd3'], `${at}.id`);
    if (seen.has(id)) fail(`${at}.id`, 'Use d0, d1, d2 and d3 once each.');
    seen.add(id);
    const basis = id === 'd0' ? 'model-default' : 'taste-input';
    if (item.basis !== undefined && item.basis !== basis) fail(`${at}.basis`, `Direction ${id} has basis ${basis}.`);
    const anchors = [...new Set(list(item.anchors, `${at}.anchors`, { min: 2, max: 4 }).map((ref, anchorIndex) => {
      const value = text(ref, `${at}.anchors[${anchorIndex}]`, { max: 160 });
      if (!refs.has(value)) fail(`${at}.anchors[${anchorIndex}]`, 'Use a ref exactly as returned by project_get_taste.');
      return value;
    }))];
    if (id === 'd0' && anchors.some(ref => refs.get(ref).source !== 'model-assumption')) fail(`${at}.anchors`, 'd0 is your default from your own prediction; anchor it only to M refs.');
    if (id !== 'd0' && required.size && !anchors.some(ref => required.has(ref))) fail(`${at}.anchors`, 'Anchor each taste-input direction to at least one required anchor.');
    const devices = list(item.devices, `${at}.devices`, { min: 3, max: 6 }).map((device, deviceIndex) => {
      object(device, `${at}.devices[${deviceIndex}]`, ['layer', 'device']);
      return { layer: choice(device.layer, DNA_LAYERS, `${at}.devices[${deviceIndex}].layer`), device: text(device.device, `${at}.devices[${deviceIndex}].device`, { min: 3, max: 200 }) };
    });
    const changes = list(item.changes, `${at}.changes`, { min: 1, max: 6 }).map((change, changeIndex) => {
      object(change, `${at}.changes[${changeIndex}]`, ['selector', 'change']);
      const selector = text(change.selector, `${at}.changes[${changeIndex}].selector`, { max: 200 });
      if (/[\0-\x1f{};@\\<>]/u.test(selector)) fail(`${at}.changes[${changeIndex}].selector`, 'Use a plain CSS selector such as #hero.');
      return { selector, change: text(change.change, `${at}.changes[${changeIndex}].change`, { min: 3, max: 1200 }) };
    });
    const groups = [...new Set(list(item.audienceIds, `${at}.audienceIds`, { max: 3 }).map((value, groupIndex) => {
      const group = text(value, `${at}.audienceIds[${groupIndex}]`, { max: 60 });
      if (!audienceIds.has(group)) fail(`${at}.audienceIds[${groupIndex}]`, 'Use an audience ID from the brief.');
      return group;
    }))];
    return { id, title: text(item.title, `${at}.title`, { min: 3, max: 180 }), summary: text(item.summary, `${at}.summary`, { min: 10, max: 1200 }), basis,
      anchors: anchors.map(ref => { const entity = refs.get(ref); return { ref, name: entity.name, domain: entity.domain, source: entity.source,
        ...(entity.entityId ? { entityId: entity.entityId } : {}), ...(entity.evidenceId ? { evidenceId: entity.evidenceId } : {}),
        ...(entity.affinity !== undefined ? { affinity: entity.affinity } : {}), ...(entity.confirmedAffinity !== undefined ? { confirmedAffinity: entity.confirmedAffinity } : {}),
        ...(entity.surprise !== undefined ? { surprise: entity.surprise } : {}), ...(required.has(ref) ? { required: true } : {}) }; }),
      devices, changes, tradeoffs: [...new Set(list(item.tradeoffs, `${at}.tradeoffs`, { max: 4 }).map((value, tradeoffIndex) => text(value, `${at}.tradeoffs[${tradeoffIndex}]`, { min: 3, max: 600 })))],
      audienceIds: groups, sourceType: 'model-interpretation' };
  });
  return directions.sort((a, b) => a.id.localeCompare(b.id));
}

/** Support is the mean measured affinity of a direction's anchors inside the bounded profile; unmeasured anchors count as zero. */
export function scoreTasteDirections(directions, { input } = {}) {
  if (input?.source !== 'qloo-profile') return { basis: 'model-assumption', recommendedId: null, modelDefaultId: 'd0', scores: directions.map(direction => ({ id: direction.id, support: null })),
    limitation: 'No measured taste data exists in this run, so directions are not scored.' };
  const scores = directions.map(direction => {
    const values = direction.anchors.map(anchor => anchor.source === 'qloo' ? anchor.affinity : anchor.confirmedAffinity);
    const measured = values.filter(value => typeof value === 'number' && Number.isFinite(value));
    return { id: direction.id, support: round(values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / values.length, 3),
      measuredAnchors: measured.length, anchors: values.length, surpriseAnchors: direction.anchors.filter(anchor => anchor.surprise).length };
  });
  const best = scores.reduce((winner, score) => !winner || score.support > winner.support ? score : winner, null);
  const modelDefault = scores.find(score => score.id === 'd0');
  return { basis: 'qloo-profile', recommendedId: best?.id ?? null, modelDefaultId: 'd0', scores,
    headline: best && modelDefault ? `Model default d0 has measured support ${modelDefault.support}; Qloo support is highest for ${best.id} (${best.support}).` : '',
    limitation: 'Support averages Qloo affinity of each direction\'s anchors within this bounded profile, counting anchors absent from it as zero. Affinities from separate domain queries are not a calibrated common scale, and support is not a design-quality score.' };
}

/** Single-pair comparison; repeated pairs are required to compare against baseline-to-baseline variance. */
export function compareTasteRuns({ baseline, qloo }) {
  const fingerprints = { baseline: designFingerprint(baseline.files), qloo: designFingerprint(qloo.files) };
  const distance = compareDesignFingerprints(fingerprints.baseline, fingerprints.qloo);
  const qlooStats = qloo.dna && qloo.input ? designDnaStats(qloo.dna, qloo.input) : null;
  const baselineStats = baseline.dna && baseline.input ? designDnaStats(baseline.dna, baseline.input) : null;
  const prediction = qloo.input?.metrics || null;
  const sketch = { baseline: baseline.sketchDivergence ?? null, qloo: qloo.sketchDivergence ?? null };
  const percent = value => `${Math.round(value * 100)}%`;
  // Reported when the Qloo on input had shared qualities, so older pairs keep their headlines.
  const shared = (qloo.input?.entities || []).some(entity => entity.domain === QUALITY_DOMAIN && entity.source === 'qloo');
  return { schemaVersion: TASTE_SCHEMA_VERSION, computedAt: new Date().toISOString(), distance, fingerprints,
    qloo: { ...(qlooStats || {}), conformance: qloo.conformance?.score ?? null, prediction, sketch: sketch.qloo },
    baseline: { ...(baselineStats || {}), conformance: baseline.conformance?.score ?? null, sketch: sketch.baseline },
    headline: qlooStats ? `${qlooStats.surpriseAnchoredDevices} of ${qlooStats.devices} design devices in the Qloo on design rest on entities${shared ? ' or qualities' : ''} the model did not predict.` : 'No Qloo design specification was recorded.',
    detail: prediction ? `The model predicted ${prediction.predictedByModel} of ${prediction.measuredEntities} measured entities before seeing them; ${prediction.surprises} were new to it.` : '',
    ...(sketch.qloo && sketch.baseline ? { sketchHeadline: `Against each run's own frozen sketch, the Qloo on site moved ${percent(sketch.qloo.score)} of its type, color and section tokens; the Qloo off site moved ${percent(sketch.baseline.score)}.` } : {}),
    ...(shared && qlooStats ? { qualityHeadline: `${qlooStats.qualityAnchoredDevices} of ${qlooStats.devices} Qloo on devices translate measured qualities${baselineStats ? `; ${baselineStats.qualityAnchoredDevices} of ${baselineStats.devices} Qloo off devices translate qualities the model predicted` : ''}.` } : {}),
    limitation: 'One pair. Token and structure distance is a heuristic, not a perceptual or quality measure. Compare repeated Qloo-to-baseline distances with baseline-to-baseline distances before claiming the difference exceeds model variance. Departure from the sketch is required of surprise-anchored devices, so it shows what measured data changed under this protocol, not an unprompted effect.' };
}
