// Fixture inputs for the dry run and the tests. Every fixture entity is named "Fixture ..." so a dry-run record can
// never be mistaken for a Qloo result. The dry run plays both arms through the real design server with the two
// hand-made samples: Qloo off follows its sketch with the ash pilgrim, Qloo on departs from the same sketch to the
// ember tinker under a fixture profile. The profile is built by the real host taste pass from a fixture Qloo client,
// so its shared qualities come from typed tags the way a live pass derives them.

import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTasteProfile, isQualityDomain, QUALITY_DOMAIN, ART_STYLE_DOMAIN } from '../../plugin/server/culture/taste.mjs';
import { sharedMoods } from './music.mjs';

/**
 * The dry run's painter: it hands the attached blueprint back as the painting, so the blueprint, the cut, the skin and
 * its publication run through the real code without a Codex request. The pieces come back as flat colours.
 */
export function fixturePainter() {
  return {
    available: true, provider: 'fixture', version: null,
    async generate({ directory, name, attach }) {
      await fs.mkdir(directory, { recursive: true });
      await fs.copyFile(attach, path.join(directory, `${name}.png`));
      return { path: `generated/${name}.png`, format: 'png', durationMs: 0, description: 'Fixture painting: the blueprint handed back unpainted.' };
    },
  };
}

// Art styles are derived from the works' art_style tags like qualities, at no request; the render style follows them.
export const GAME_DOMAINS = Object.freeze(['brand', 'movie', 'artist', 'book', 'tv_show', 'videogame', 'style', 'aesthetic', QUALITY_DOMAIN, ART_STYLE_DOMAIN]);
// The artifact's own medium: games lead the required works when the profile has qualities.
export const GAME_MEDIUM = Object.freeze(['videogame']);

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
const typed = (type, name) => ({ id: `urn:tag:${type}:qloo:${slug(name).replaceAll('-', '_')}`, name });
const work = (name, affinity, popularity, tags) => ({ name, affinity, popularity, tags });
// Typed tags shaped like the recorded passes: look, mood and meaning tags beside catalogue metadata. Fixture Soot and
// Brass carries only metadata, the way an ice hockey team shared no quality with the films and books around it.
const CORE = {
  brand: [
    work('Fixture Tinker Works', 0.91, 0.42, [typed('aesthetic_property', 'Colorful'), typed('core_value', 'Craftsmanship'), typed('brand_type', 'Tools')]),
    work('Fixture Puffer Company', 0.84, 0.51, [typed('aesthetic_property', 'Quilted'), typed('lifestyle', 'Outdoors'), typed('brand_type', 'Outerwear')]),
    work('Fixture Soot and Brass', 0.77, 0.3, [typed('competitor_brand', 'Fixture Rival'), typed('brand_type', 'Hardware')]),
  ],
  movie: [
    work('Fixture Film: Lantern Parade', 0.93, 0.55, [typed('art_style', 'Hand-Drawn'), typed('emotional_tone', 'Playful'), typed('theme', 'Belonging')]),
    work('Fixture Film: The Chimney Sweep', 0.81, 0.38, [typed('style', 'Colorful'), typed('plot', 'Whimsical'), typed('theme', 'Curiosity')]),
    work('Fixture Film: Mint Harbour', 0.72, 0.33, [typed('emotional_tone', 'Gentle'), typed('theme', 'Belonging')]),
  ],
  artist: [
    work('Fixture Artist: Brass Choir', 0.88, 0.47, [typed('music', 'Upbeat'), typed('emotional_tone', 'Playful'), typed('emotional_tone', 'Energetic')]),
    work('Fixture Artist: Teal Hour', 0.8, 0.44, [typed('music', 'Upbeat'), typed('audience', 'Daydreamers')]),
    work('Fixture Artist: Spark Units', 0.74, 0.2, [typed('music', 'Chiptune')]),
  ],
  book: [
    work('Fixture Book: Pocket Engines', 0.83, 0.36, [typed('theme', 'Curiosity'), typed('core_value', 'Craftsmanship')]),
    work('Fixture Book: Small Roads', 0.7, 0.29, [typed('theme', 'Belonging'), typed('emotional_tone', 'Gentle')]),
    work('Fixture Book: The Quiet Mile', 0.66, 0.31, [typed('emotional_tone', 'Melancholic')]),
  ],
  tv_show: [
    work('Fixture Show: Workshop Days', 0.79, 0.4, [typed('core_value', 'Craftsmanship'), typed('aesthetic_property', 'Colorful')]),
    work('Fixture Show: Harbour Lights', 0.68, 0.37, [typed('theme', 'Belonging'), typed('business_model', 'Subscription')]),
    work('Fixture Show: Tin Crown', 0.65, 0.35, [typed('art_style', 'Hand-Drawn'), typed('plot', 'Whimsical')]),
  ],
  videogame: [
    // Energetic here and on Brass Choir makes a shared mood quality that a library track carries.
    work('Fixture Game: Pocket Quest', 0.86, 0.5, [typed('art_style', 'Hand-Drawn'), typed('emotional_tone', 'Playful'), typed('emotional_tone', 'Energetic'), typed('platform', 'PC')]),
    work('Fixture Game: Cinder Steps', 0.73, 0.32, [typed('theme', 'Curiosity'), typed('art_style', 'Hand-Drawn')]),
    work('Fixture Game: Paper Lamps', 0.71, 0.28, [typed('aesthetic_property', 'Colorful'), typed('art_style', 'Pixel Art'), typed('emotional_tone', 'Gentle'), typed('platform', 'Switch')]),
  ],
};
const DEEP = {
  brand: [work('Fixture Kite Makers', 0.62, 0.12, [typed('aesthetic_property', 'Colorful'), typed('core_value', 'Craftsmanship')])],
  movie: [work('Fixture Film: Small Hours', 0.6, 0.1, [typed('art_style', 'Hand-Drawn'), typed('plot', 'Whimsical')])],
};
// Audience-level tag rankings. The aesthetic ranking returns nothing, as in all three Echo Atlas game-site passes (the
// first character pass got eight), so the dry run exercises the fallback: costume and silhouette take measured look
// qualities.
const TAG_RANKINGS = { 'urn:tag:style:qloo': [['Bouncy', 0.92], ['Lively', 0.89], ['Contemplative', 0.7]], 'urn:tag:aesthetic_property:qloo': [] };

const evidence = endpoint => ({ provider: 'Qloo', endpoint: `https://fixture.invalid${endpoint}`, retrievedAt: '2026-10-04T00:00:00.000Z', resultCount: 0,
  interpretation: 'Fixture record for the dry run; not a Qloo result.' });
const answer = (results, endpoint, query) => ({ status: results.length ? 'ok' : 'empty', query, results, evidence: { ...evidence(endpoint), resultCount: results.length } });

/** A stand-in for the Qloo client with the same three calls; every brief reference resolves to a fixture seed. */
export function fixtureQlooClient() {
  return {
    async searchEntities({ query }) {
      return answer([{ entityId: `fixture:seed:${slug(query) || 'reference'}`, name: query, type: 'urn:entity:videogame' }], '/search', { text: query });
    },
    async searchTags({ query }) { return answer([], '/v2/tags', { text: query }); },
    async getInsights(input) {
      if (input.resultType === 'tag') {
        const type = input.tagTypes?.[0];
        const rows = (TAG_RANKINGS[type] || []).map(([name, affinity]) => ({ entityId: `${type}:fixture_${slug(name).replaceAll('-', '_')}`, name, type, affinity }));
        return answer(rows, '/v2/insights', { resultType: 'urn:tag', tagTypes: input.tagTypes });
      }
      const deep = input.popularityMax !== undefined;
      const rows = ((deep ? DEEP : CORE)[input.resultType] || []).map(item => ({ entityId: `fixture:${input.resultType}:${slug(item.name)}`, name: item.name,
        type: `urn:entity:${input.resultType}`, affinity: item.affinity, popularity: item.popularity, tags: item.tags, description: 'Fixture entity for the dry run; not a Qloo result.' }));
      return answer(rows, '/v2/insights', { resultType: `urn:entity:${input.resultType}` });
    },
  };
}

/** The dry run's profile: the real taste pass over the fixture client, marked as a fixture. */
export async function fixtureProfile({ references = [{ name: 'Fixture reference one', role: 'audience' }], knownNames = [] } = {}) {
  const profile = await buildTasteProfile({ client: fixtureQlooClient(), references, domains: GAME_DOMAINS, knownNames, retryDelayMs: 0 });
  return { ...profile, fixture: true, interpretation: 'Fixture profile for the dry run. It is not a Qloo result.', limitations: ['Fixture profile: no Qloo request was made.', ...profile.limitations] };
}

/** Both arms sketch the same quiet pilgrim before seeing any data, as blind sketches of one brief tend to. */
export function fixtureAssumption() {
  return JSON.stringify({
    schemaVersion: '1.0', audienceSummary: 'Fixture prediction for the dry run: players who like slow, wistful exploration and handmade worlds.',
    predictions: {
      brand: ['Fixture predicted brand one', 'Fixture predicted brand two', 'Fixture predicted brand three'],
      movie: ['Fixture predicted film one', 'Fixture predicted film two', 'Fixture Film: Mint Harbour'],
      artist: ['Fixture predicted artist one', 'Fixture predicted artist two', 'Fixture predicted artist three'],
      book: ['Fixture predicted book one', 'Fixture predicted book two', 'Fixture Book: The Quiet Mile'],
      tv_show: ['Fixture predicted show one', 'Fixture predicted show two', 'Fixture predicted show three'],
      videogame: ['Fixture predicted game one', 'Fixture predicted game two', 'Fixture predicted game three'],
      style: ['Contemplative', 'Slow', 'Wistful'],
      aesthetic: ['Weathered', 'Hooded Shapes', 'Muted Earth'],
      // Curious meets the measured Curiosity by its stem, so that quality is predicted, not a surprise.
      qualities: ['Solitary', 'Nostalgic', 'Curious'],
      // Every predicted art style names the watercolour style, so the measured Hand-Drawn and Pixel Art are surprises.
      [ART_STYLE_DOMAIN]: ['Watercolor', 'Painterly', 'Soft pastel'],
    },
    characterSketch: {
      summary: 'A tall, hooded pilgrim in pale ash cloth who carries a lantern high on a crooked staff and walks slowly.',
      palette: ['#d9d2c3', '#c99a3b', '#3b3a46', '#5a4434'], height: 183, headShare: 0.24, elements: ['hood', 'staff', 'scarf', 'cloak-tail'],
      gait: { cadence: 1.7, bounciness: 0.12, lean: 7, armSwing: 16, turnStyle: 'pivot' }, light: '#ffb85c', voice: 'quiet, sparse and weathered', motifs: ['ash cloth', 'a lantern held high'],
      // The ash pilgrim's own moment, which sample A paints: a faded mauve dusk with falling leaves over ruined beacons.
      scene: { sky: ['#2b2338', '#c9a98f'], palette: ['#f4e6cf', '#b9a593', '#2f2a30', '#6f7a58'], weather: 'leaves', towers: 'ruin' },
      render: 'watercolor', music: FIXTURE_TRACKS.sketch,
    },
  });
}

// Tracks of the committed music library the fixtures use: the sketch's and Qloo off's peaceful one, Qloo on's energetic one.
export const FIXTURE_TRACKS = Object.freeze({ sketch: 'peaceful-night-st-adam', measured: 'red-moonlight-extended-mix-pokki-dj' });

/**
 * A DNA whose tokens match the given character exactly, anchored to the refs the session revealed: the own
 * prediction refs in Qloo off, the profile's measured refs in Qloo on. The required anchors lead with one quality
 * per family, so the palette and the silhouette rest on qualities in both arms.
 */
export function fixtureDna({ input, character, measures, measured, sketch, deltaE, tracks = null }) {
  const entities = input.entities;
  const required = input.requiredAnchors.map(item => item.ref);
  const ofDomain = domain => entities.filter(item => item.domain === domain && (measured ? item.source === 'qloo' : item.source === 'model-assumption'));
  const looks = ofDomain(QUALITY_DOMAIN).filter(item => !measured || item.family === 'look');
  // Without measured aesthetic tags, the costume translates a measured look quality, as the protocol requires.
  const style = ofDomain('style')[0], aesthetic = ofDomain('aesthetic')[0] || looks.find(item => item.ref !== required[0]) || looks[0];
  const qualities = refs => measured ? [...new Set(refs.map(ref => entities.find(item => item.ref === ref)).flatMap(item => item?.tags || []))].slice(0, 2) : ['fixture quality'];
  const device = (id, layer, name, refs, tokens) => ({ id, layer, device: name, anchors: refs, qualities: qualities(refs), translation: `Fixture translation for the dry run: ${name.toLowerCase()}.`, tokens });
  // Colours the character is drawn with; in Qloo on, the ones far from the frozen sketch lead.
  const drawn = [...new Set(character.parts.map(part => part.fill).filter(Boolean))];
  const far = hex => Math.min(...sketch.palette.map(color => deltaE(hex, color))) >= 20;
  const colors = measured ? [...drawn.filter(far), ...drawn.filter(hex => !far(hex))] : drawn;
  const signature = character.clips.signature;
  const lines = Object.values(character.lines);
  const costume = character.cloth.map(chain => chain.id).concat(character.parts.map(part => part.id)).filter(id => !['thigh', 'shin', 'eye'].includes(id)).slice(0, 3);
  const motion = [{ param: 'walk.cadence', value: character.motion.walk.cadence }, { param: 'walk.bounciness', value: character.motion.walk.bounciness }, { param: 'turn.style', value: character.motion.turn.style }];
  // The moment, when the run opens it: the scene rests on a quality (a surprise in Qloo on, so the world departs from the
  // sketch), the render device on the strongest render style, and the music on a ref whose tags the track carries.
  const world = [];
  if (character.scene) {
    const own = entities.filter(item => item.source === (measured ? 'qloo' : 'model-assumption'));
    const sceneAnchor = own.filter(item => item.domain === QUALITY_DOMAIN).sort((a, b) => Number(Boolean(b.surprise)) - Number(Boolean(a.surprise)))[0];
    const scene = character.scene;
    world.push(device('scene1', 'scene', 'Fixture moment', [sceneAnchor.ref], { scene: { sky: scene.sky, colors: [scene.clouds, scene.rock], weather: scene.weather.kind, ...(scene.towers ? { towers: scene.towers } : {}) } }));
    const lead = input.renderStyles?.[0];
    world.push(device('render1', 'render', 'Fixture render style', [lead ? lead.ref : sceneAnchor.ref], { render: character.render.preset }));
    const track = tracks && character.music ? tracks.find(item => item.id === character.music.track) : null;
    // Qualities first: Qloo on translates a surprise quality whose name the track carries, Qloo off one of its own
    // predicted qualities with the track's own mood. A measured run whose track no surprise quality carries gets no
    // music device, and the host refuses that DNA.
    const moodsOf = own.filter(item => isQualityDomain(item.domain) && item.domain !== ART_STYLE_DOMAIN);
    const carrier = !track ? null : measured ? moodsOf.find(item => item.surprise && sharedMoods(track, item.tags || [item.name]).length) : moodsOf.find(item => item.domain === QUALITY_DOMAIN) || moodsOf[0];
    if (carrier) {
      const moods = measured ? (carrier.tags || [carrier.name]).filter(tag => sharedMoods(track, [tag]).length).slice(0, 2) : track.tags.slice(-1);
      world.push({ ...device('music1', 'music', 'Fixture track', [carrier.ref], { music: track.id }), qualities: moods });
    }
  }
  return JSON.stringify({ schemaVersion: '1.0', thesis: `Fixture thesis for the dry run: ${character.description}`, devices: [
    device('dna1', 'palette', 'Fixture palette', [required[0]], { colors: colors.slice(0, 3) }),
    device('dna2', 'silhouette', 'Fixture silhouette', [required[1]], { proportions: { height: measures.figureHeight, headShare: measures.headShare },
      parts: [character.parts.find(part => part.bone === 'head' && !part.role && (!measured || !sketch.elements.includes(part.id)))?.id].filter(Boolean) }),
    device('dna3', 'costume', 'Fixture costume', [aesthetic.ref, required[2]], { parts: costume }),
    device('dna4', 'motion', 'Fixture gait', [style.ref, required[3]], { motion }),
    device('dna5', 'signature', 'Fixture kindling move', [required[4]], { clips: [{ name: 'signature', duration: signature.duration, kindleAt: signature.kindleAt, tracks: Object.keys(signature.tracks).slice(0, 2) }] }),
    device('dna6', 'light', 'Fixture carried light', [required[5] ?? required[0]], { light: { color: character.light.color, radius: character.light.radius } }),
    device('dna7', 'voice', 'Fixture voice', [required[0]], { lines: [lines[0], lines[3]] }),
    ...world,
  ], rejected: [] });
}

// The look of the figure and its moment in one cluster, how it moves and speaks in the other.
const LOOK_LAYERS = new Set(['palette', 'silhouette', 'costume', 'light', 'imagery', 'scene', 'render']);

/**
 * A taste reading that keeps every ref the fixture DNA anchors, in two clusters that each rest on a quality of the
 * run's own source, carry the layers `layers` names and, in a measured run, gather a surprise. A measured brand that
 * carries only catalogue metadata is set aside as noise, so the dry run records a set-aside ref too.
 */
export function fixtureReading({ input, dna, layers }) {
  const source = typeof dna === 'string' ? JSON.parse(dna) : dna;
  const entities = input.entities;
  const measured = entities.some(entity => entity.source === 'qloo');
  const pool = entities.filter(entity => isQualityDomain(entity.domain) && (!measured || entity.source === 'qloo'));
  const clusters = [
    { id: 'c1', name: 'Fixture look and moment', refs: [], layers: [], reading: 'Fixture reading for the dry run: the refs that set the colours, the figure and the moment.' },
    { id: 'c2', name: 'Fixture motion and voice', refs: [], layers: [], reading: 'Fixture reading for the dry run: the refs that set the gait, the signature move and the lines.' },
  ];
  const placed = new Set();
  const place = (cluster, ref) => { if (!placed.has(ref) && cluster.refs.length < 8) { cluster.refs.push(ref); placed.add(ref); } };
  for (const device of source.devices) for (const ref of device.anchors) place(clusters[LOOK_LAYERS.has(device.layer) ? 0 : 1], ref);
  for (const cluster of clusters) {
    if (!cluster.refs.some(ref => pool.some(entity => entity.ref === ref))) { const free = pool.find(entity => !placed.has(entity.ref)); if (free) place(cluster, free.ref); }
    for (const entity of entities) { if (cluster.refs.length >= 2) break; place(cluster, entity.ref); }
  }
  if (measured && !clusters.some(cluster => cluster.refs.some(ref => entities.find(entity => entity.ref === ref)?.surprise))) {
    const surprise = entities.find(entity => entity.surprise && !placed.has(entity.ref));
    if (surprise) place(clusters[0], surprise.ref);
  }
  const look = layers.filter(layer => LOOK_LAYERS.has(layer)), rest = layers.filter(layer => !LOOK_LAYERS.has(layer));
  clusters[0].layers = look.slice(0, 4);
  clusters[1].layers = [...rest, ...look.slice(4)].slice(0, 4);
  for (const [index, cluster] of clusters.entries()) if (!cluster.layers.length) cluster.layers = [index ? 'motion' : 'palette'];
  const noise = measured ? entities.find(entity => entity.name === 'Fixture Soot and Brass' && !placed.has(entity.ref) && !input.requiredAnchors.some(item => (item.ref || item) === entity.ref)) : null;
  return JSON.stringify({ schemaVersion: '1.0', clusters,
    setAside: noise ? [{ ref: noise.ref, reason: 'Fixture reading: a hardware brand whose only tags are catalogue metadata, outside what the audience\'s works share.' }] : [],
    approach: 'Fixture approach for the dry run: the first cluster carries the palette, the figure and the moment; the second the gait, the signature move, the lines and the track.' });
}

const FIXTURE_METHODS = { palette: 'vector-rig', silhouette: 'vector-rig', costume: 'vector-rig', motion: 'rig-motion', signature: 'rig-motion', light: 'vector-rig',
  voice: 'lines', imagery: 'vector-rig', scene: 'engine-scene', render: 'engine-scene', music: 'library-track' };

/**
 * A production plan for the fixture DNA: each device made by the code method of its layer, the costume device painted
 * when the run can paint, so a painted dry run paints, and three review criteria when the host captures.
 */
export function fixturePlan({ dna, reading, capabilities }) {
  const devices = (typeof dna === 'string' ? JSON.parse(dna) : dna).devices;
  const clusters = (typeof reading === 'string' ? JSON.parse(reading) : reading).clusters;
  const steps = devices.map(device => ({ device: device.id, method: FIXTURE_METHODS[device.layer], cluster: clusters.find(cluster => device.anchors.some(ref => cluster.refs.includes(ref))).id,
    why: `Fixture plan for the dry run: the ${device.layer} device is made by ${FIXTURE_METHODS[device.layer]}.` }));
  if (capabilities.generators.paint?.available) {
    const layerOf = step => devices.find(device => device.id === step.device).layer;
    const painted = steps.find(step => layerOf(step) === 'costume') || steps.find(step => ['palette', 'silhouette'].includes(layerOf(step)));
    Object.assign(painted, { method: 'painted-rig', count: 1, fallback: 'vector-rig', why: 'Fixture plan for the dry run: the fixture painter hands the drawing back as the painted figure.' });
  }
  const views = new Set(capabilities.review.capture.available ? capabilities.review.capture.views.map(view => view.id) : []);
  const of = layer => devices.find(device => device.layer === layer)?.id;
  const review = !views.size ? [] : [
    { id: 'r1', device: of('silhouette'), look: 'Fixture criterion: the figure reads as one dark shape in the 60-pixel silhouette.', view: 'pose' },
    { id: 'r2', device: of('motion'), look: 'Fixture criterion: the six walk frames show the gait the motion device sets.', view: 'walk' },
    { id: 'r3', device: of('scene') || of('palette'), look: 'Fixture criterion: the moment on the cliff road shows the planned sky, weather and light.', view: 'scene' },
  ].filter(item => item.device && views.has(item.view));
  return JSON.stringify({ schemaVersion: '1.0', steps, review });
}

/** A review of one round that cites a capture of each criterion's view and judges nothing: no model looked at it. */
export function fixtureReview({ plan, captures, round }) {
  const criteria = (typeof plan === 'string' ? JSON.parse(plan) : plan).review;
  return JSON.stringify({ schemaVersion: '1.0', round,
    criteria: criteria.map(item => ({ id: item.id, capture: (captures.find(capture => capture.view === item.view) || captures[0]).id, verdict: 'met', observed: 'Fixture review: the dry run cites the capture without judging it.' })),
    summary: 'Fixture review for the dry run: no model looked at the captures.' });
}
