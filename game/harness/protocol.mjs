// The taste-led protocol for a game character: the website protocol's frozen prediction, binding DNA, departure
// rule and conformance check, translated from pages to one playable character. A device's tokens are literal
// values the host can find in the character file: colours, part IDs, proportions, motion parameters, clip
// timings, effects, the carried light and the lines Ilo speaks.

import { TASTE_SCHEMA_VERSION, TasteProtocolError, normalizeTasteAssumption, normalizeTasteName, isTagDomain, isQualityDomain, QUALITY_DOMAIN, ART_STYLE_DOMAIN } from '../../plugin/server/culture/taste.mjs';
import { MOTION_RANGES, TURN_STYLES, CLIP_NAMES, ROTATION_TRACKS, TRACK_ID } from '../src/format.js';
import { WEATHER_KINDS, TOWER_STYLES, RENDER_NAMES, RENDER_PRESETS, completeScene, sceneColors } from '../src/scene.js';
import { colorsUsed } from './measure.mjs';
import { refPreset } from './art-styles.mjs';
import { sharedMoods, tracksFor } from './music.mjs';
import { PRODUCTION_POLICY_TEXT } from '../../plugin/server/production/policy.mjs';

// Scene, render and music are the moment's art direction: the world's colours, weather and beacons, the style the
// whole frame is drawn in, and the track. A run with art direction requires the first two, and music when the host
// has a music library; earlier runs had none of them.
export const CHARACTER_LAYERS = Object.freeze(['palette', 'silhouette', 'costume', 'motion', 'signature', 'light', 'voice', 'imagery', 'scene', 'render', 'music']);
const REQUIRED_LAYERS = ['palette', 'silhouette', 'motion', 'voice'];
const FORM_LAYERS = ['costume', 'signature', 'light'];
export const CHARACTER_LIMITS = Object.freeze({
  minDevices: 5, maxDevices: 12, requiredAnchors: 6, maxRequiredRejections: 2, sketchDeltaE: 20, portraitDeltaE: 22,
  // Departure from the frozen sketch for surprise-anchored devices.
  heightShift: 0.12, headShift: 0.05, gaitMoves: 2,
  // Conformance tolerances between declared tokens and the drawn character.
  heightTolerance: 0.06, headTolerance: 0.03, timeTolerance: 0.05, radiusTolerance: 0.1, conformanceThreshold: 0.75, portraitsPerRun: 2,
  // Painted pieces: one painting a run, a second only when the first comes back without a piece.
  paintsPerRun: 2,
});
// How far a gait parameter must move from the sketch to count as a different walk.
export const GAIT_THRESHOLDS = Object.freeze({ 'walk.cadence': 0.4, 'walk.bounciness': 0.25, 'walk.lean': 6, 'walk.armSwing': 15 });
const SKETCH_GAIT = Object.freeze({ cadence: 'walk.cadence', bounciness: 'walk.bounciness', lean: 'walk.lean', armSwing: 'walk.armSwing', turnStyle: 'turn.style' });
export const MOTION_PARAMS = Object.freeze([
  ...Object.keys(MOTION_RANGES.walk).map(key => `walk.${key}`), ...Object.keys(MOTION_RANGES.idle).map(key => `idle.${key}`), 'turn.style', 'turn.duration']);

/**
 * What a painting is cut from: the figure's skeleton, parts, cloth, style and render, with the colours its parts and
 * cloth resolve from the palette. A later save of character.json may change the rest, such as the scene, light,
 * effects, motion, clips, lines and music, which the painted pieces do not depend on. Both arms of the third live pair
 * left review criteria on the sky, the weather and the light unrepaired because painting had frozen the whole file.
 */
export const PAINTED_FIELDS = Object.freeze(['skeleton', 'parts', 'cloth', 'style', 'render']);
export const FROZEN_FIGURE = `its ${PAINTED_FIELDS.slice(0, -1).join(', ')} and ${PAINTED_FIELDS.at(-1)}`;
export const REPAIRABLE_AFTER_PAINTING = 'scene, light, effects, motion, clips, lines and music';

/**
 * The policy a run's model works under. `artDirection` opens the moment's scene and render style, `music` the track,
 * and `departure: false` leaves out the rule that surprise-anchored devices depart from the frozen sketch, for an
 * ablation pair that measures how far the data moves the design without being told to.
 */
export function characterPolicyText({ departure = true, artDirection = false, music = false, paint = false, production = false } = {}) {
  const world = artDirection ? `, and the moment's art direction: the scene's colours, weather and beacons, the style the frame is drawn in${music ? ' and the music' : ''}` : '';
  return `# Taste-led character policy

Use this workflow when measured cultural taste governs the design of a game character. It is the website taste-led policy applied to one playable character in a fixed world: the world${artDirection ? "'s lore, layout and story beats" : ', its lore'}, the engine and the character's fixed facts are shared, and the character's look, movement and voice${world} are what taste may change. All saved artifacts are English.

1. Predict before you look. Before reading any taste data, record what you expect this audience to like in the same domains the profile covers: three to six real names per work domain, from your own knowledge only, and three to six qualities for the style domain (the pacing and look of the films and TV it likes) and the aesthetic domain (the visual and material properties of what it likes). For the qualities domain, predict three to six moods, themes or looks you expect its favorite works to share.${artDirection ? ' For the art style domain, predict three to six art styles of the games, films and shows it likes.' : ''} Then sketch the character you would make from that expectation alone: one sentence, a palette, its figure height and head share, the garments, props and features you would draw as element IDs, its gait, the colour of its light, its voice and a few motifs${artDirection ? `, and the moment you would set it in: the sky and scene colours, the weather and the beacons' form, the render style of the frame${music ? ' and the track' : ''}` : ''}. Prediction and sketch are frozen once saved. In a run without Qloo the prediction is the entire taste input and the sketch is your own starting point. In a Qloo run they separate measured signal from what you already assumed and would have designed.

2. Read the measured profile. A Qloo taste profile contains resolved seeds, cross-domain neighbors with affinity, popularity and tags, a lower-popularity band, and style and aesthetic tags ranked by affinity for the audience as a whole. It also contains qualities: the look, mood and meaning tags that two or more measured works share, ranked by the affinity of those works and the number of domains they span.${artDirection ? ' And it contains art styles: the art style tags Qloo returns on the measured works, such as a game\'s pixel art or a show\'s cel shading, ranked the same way.' : ''} Measured entities, tags and qualities your prediction did not contain, and that the brief did not already name, form the surprise set: signal that exists only because Qloo was consulted. When the profile has qualities, the host requires the strongest quality of each family and the works most central to the qualities, a game first; otherwise it selects required anchors from the highest-affinity entities across domains, favoring surprises.

3. Compile a Character DNA. Translate the taste input into five to ${artDirection ? 'twelve' : 'ten'} named, concrete devices across the character's layers: palette, silhouette, costume, motion, signature, light, voice${artDirection ? `, imagery, scene, render${music ? ' and music' : ''}` : ' and imagery'}. Palette, silhouette, motion and voice are required${artDirection ? `, and so are scene and render${music ? ' and music' : ''}` : ''}, plus at least one of costume, signature or light. Each device names its anchor entities or qualities, explains the translation as your interpretation and declares literal tokens the host can check in the character file: hex colours, part and cloth IDs, proportions, motion parameter values, clip timings, effect IDs, the light's colour${artDirection ? `, the scene's sky, colours, weather and beacons, the render style${music ? ', the track' : ''}` : ''} and the exact lines the character speaks. Adjectives are not devices. "Mysterious and elegant" is not a device; "a stiff, knee-length coat that flares only at the hem, in two shades of slate", anchored to a specific quality or film, is. Every required anchor becomes a device or is rejected with a specific reason; at most two required anchors may be rejected.

Qualities come first. When the taste input has qualities, the palette and the silhouette${artDirection ? ' and the scene' : ''} each anchor to a quality, a measured one in a measured run, so the colours and the figure${artDirection ? ' and the world' : ''} translate what the audience's works share; the entities are evidence of it. Never take an entity's own brand or team colours, logo, packaging, costume or trade dress.${artDirection ? `

The moment's art direction is part of the design. The lore, the layout of the cliffs and the road, the story beats and the keeper stay fixed; the scene's colours, its weather and mist, the form of the beacon and the far towers, and the style the whole frame is drawn in${music ? ', and the music,' : ''} are yours. A scene device paints the sky, the sun, the cloud sea, the basalt, the foliage, the flags and the weather. A render device sets the frame's style and anchors to an art style, a measured one in a measured run: when the taste input has art styles that name a render style, the strongest of them is required on the render device or rejected with a reason, and a render device draws in the style its anchor names, so Pixel Art draws in pixels and Cel-Shaded in cel.${music ? ' A music device picks the moment\'s track from the open music library. Like the palette, it anchors to a quality, a measured one in a measured run, and the track carries that quality: its catalogue genres or tags share a word with the quality\'s name. So the audience\'s shared qualities choose the music, never an entity\'s own catalogue tags; only when no measured quality meets a track may the device translate another measured ref\'s returned tags.' : ''}` : ''}${departure ? `

When the taste input contains surprises, they must move the character, not just relabel it. Devices anchored to surprise entities or qualities name the returned tags they translate, and together they depart from your frozen sketch in four places: palette colours far from every sketch colour, different proportions, at least one garment, prop or feature the sketch did not plan, and a different gait.${artDirection ? ` The world departs too: a scene device anchored to a surprise gives the sky and the scene colours far from your sketch's scene${music ? ', and a music device anchored to a surprise picks another track than your sketch\'s whenever a surprise quality meets one' : ''}.` : ''} Devices anchored to your own predictions may follow the sketch. A run without surprises keeps its sketch as its starting point, so the departure measures what the measured data changed.` : ''}

Motion translates style tags into how the character moves: cadence, bounce, lean, arm swing, how it turns and the timing of its signature move. Costume and silhouette translate aesthetic tags into garments, materials and outline. In a measured run each anchors to a measured tag when its domain returned tags; when it returned none, motion anchors to a measured mood quality and costume or silhouette to a measured look quality instead. Without measured data, each anchors to the qualities you predicted.

Voice is a layer too. The character's four lines are yours to write in the register of a voice device anchored to the taste input, a measured ref in a measured run, around the fixed facts of the scene. The words are yours: translate the anchor's qualities, never its lyrics, dialogue or slogans.

${production ? 'When the host can paint a portrait and your production plan chooses the portrait method for an imagery device, that device requests its planned portraits before you draw the character.' : 'When the host can paint a portrait, the DNA includes an imagery device, and before drawing the character that device requests one or two portraits.'} You describe only what the portrait shows; the host writes the prompt from the device's name, colours and qualities, so in a measured run the returned tags direct the picture. A subject never names a taste entity, and portraits carry no text, logos, recognizable people or copyrighted characters.

4. Build to the DNA. The DNA is binding. Implement every device with its declared tokens and keep the fixed facts: the character's name and role, its abilities, the world's lore and the keeper's lines. Do not fall back to a generic default where a device specifies otherwise. Transform qualities; never copy a character, costume, logo or trade dress of an anchor entity. Character text never mentions Qloo, agents or APIs.

5. Check conformance. Compare the saved character with the DNA and repair missing devices before finishing. Conformance shows that declared tokens exist in the character, not that the design is good or that players prefer it.${paint ? `

6. Paint the checked drawing${production ? ' when your production plan chooses painted-rig' : ''}. The drawing is the blueprint: its parts, bones, proportions and order. The host lays it out as pieces, and the painter repaints them in the technique of the render preset, which the render device took from an art style, guided by your style sentence and your description of each piece. Translate the DNA into the paint: the materials, wear, brushwork and light of the qualities its devices anchor to, the garments and details of the costume and silhouette devices. Descriptions never name a taste entity, and the painting carries no text, logos, recognizable people or copyrighted characters. Painting freezes the figure, ${FROZEN_FIGURE}, so paint after the last repair to the figure${production ? '; a defect of the painting is repaired by a second painting, when the plan\'s count allows one' : ''}. Its ${REPAIRABLE_AFTER_PAINTING} can still be repaired after the painting.` : ''}

Keep provenance honest. Qloo supplies entities, tags and relationships, never design tokens: every colour, shape, motion or line is your labeled interpretation of an entity or tag. Never invent entities, seeds, affinities or explainability; an unresolved reference stays unresolved and an empty profile is reported, not replaced. A run without Qloo follows the same steps with its own prediction as the taste input, so the only difference between the two arms is where taste comes from. Attribution metrics such as the share of devices anchored to surprise entities, prediction overlap and character distance are bounded heuristics: they show that measured data changed the specification and the character, not that the result is better.
`;
}
export const CHARACTER_TASTE_POLICY_TEXT = characterPolicyText();
/**
 * The policy for an arm's host config, so the agent, the design server and the prompt state the same rules. An arm
 * with production stages also reads the plugin's production policy: the taste reading, the plan and the review.
 */
export const armPolicyText = config => {
  const production = Boolean(config?.production);
  const policy = characterPolicyText({ departure: config?.departure !== false, artDirection: Boolean(config?.artDirection), music: Boolean(config?.artDirection && config?.music), paint: Boolean(config?.paint), production });
  return production ? `${policy}\n${PRODUCTION_POLICY_TEXT}` : policy;
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const IDENT = /^[a-z][a-z0-9-]{0,39}$/u;
const fail = (path, message) => { throw new TasteProtocolError(path, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const round = (value, digits = 3) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined);

function object(value, path, fields) {
  if (!plain(value)) fail(path, 'An object is required.');
  const extra = Object.keys(value).find(key => !fields.includes(key));
  if (extra !== undefined) fail(path, `Unsupported field ${JSON.stringify(extra.slice(0, 60))}; allowed fields are ${fields.join(', ')}.`);
}
function text(value, path, { min = 1, max = 1000 } = {}) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/u.test(value)) fail(path, `Plain text of ${min}-${max} characters without angle brackets is required.`);
  const result = value.trim().replace(/\s+/gu, ' ');
  if (result.length < min || result.length > max) fail(path, `Text of ${min}-${max} characters is required.`);
  return result;
}
function list(value, path, { min = 0, max }) {
  if (value === undefined && min === 0) return [];
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, min ? `An array with ${min}-${max} items is required.` : `An array with at most ${max} items is required.`);
  return value;
}
function number(value, path, [low, high]) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(path, `A number from ${low} to ${high} is required.`);
  return value;
}
function hexColor(value, path) {
  if (typeof value !== 'string' || !HEX.test(value.trim())) fail(path, 'Use a #rgb or #rrggbb hex colour.');
  const digits = value.trim().slice(1).toLowerCase();
  return `#${digits.length === 3 ? digits.split('').map(c => c + c).join('') : digits}`;
}
function ident(value, path) {
  if (typeof value !== 'string' || !IDENT.test(value)) fail(path, 'Use a lowercase ID of letters, digits and hyphens that starts with a letter, as in the character file.');
  return value;
}
function parsed(value, path) {
  if (typeof value !== 'string') return value;
  if (value.length > 131072) fail(path, 'The artifact exceeds 128 KiB.');
  try { return JSON.parse(value); } catch { fail(path, 'The artifact must contain valid JSON.'); }
}

function srgbToLab(hex) {
  const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const xyz = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883];
  const f = value => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const [x, y, z] = xyz.map(f);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const deltaE = (a, b) => { const p = srgbToLab(a), q = srgbToLab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const nearest = (hex, palette) => palette.map(color => ({ color, distance: deltaE(hex, color) })).sort((a, b) => a.distance - b.distance)[0];

/**
 * The character the model would make from its own prediction, frozen before any taste data. Without Qloo it is the
 * starting point; with Qloo it is the counterfactual that surprise-anchored devices must depart from.
 */
export function normalizeCharacterSketch(value, path = 'characterSketch', { artDirection = false, tracks = null } = {}) {
  object(value, path, ['summary', 'palette', 'height', 'headShare', 'elements', 'gait', 'light', 'voice', 'motifs', 'scene', 'render', 'music']);
  const world = sketchWorld(value, path, { artDirection, tracks });
  const palette = [...new Set(list(value.palette, `${path}.palette`, { min: 3, max: 6 }).map((color, index) => hexColor(color, `${path}.palette[${index}]`)))];
  const elements = [...new Set(list(value.elements, `${path}.elements`, { min: 3, max: 8 }).map((id, index) => ident(id, `${path}.elements[${index}]`)))];
  object(value.gait, `${path}.gait`, ['cadence', 'bounciness', 'lean', 'armSwing', 'turnStyle']);
  const gait = {
    cadence: number(value.gait.cadence, `${path}.gait.cadence`, MOTION_RANGES.walk.cadence),
    bounciness: number(value.gait.bounciness, `${path}.gait.bounciness`, MOTION_RANGES.walk.bounciness),
    lean: number(value.gait.lean, `${path}.gait.lean`, MOTION_RANGES.walk.lean),
    armSwing: number(value.gait.armSwing, `${path}.gait.armSwing`, MOTION_RANGES.walk.armSwing),
    turnStyle: TURN_STYLES.includes(value.gait.turnStyle) ? value.gait.turnStyle : fail(`${path}.gait.turnStyle`, `Use one of: ${TURN_STYLES.join(', ')}.`),
  };
  const motifs = [...new Set(list(value.motifs, `${path}.motifs`, { min: 1, max: 5 }).map((motif, index) => text(motif, `${path}.motifs[${index}]`, { min: 3, max: 80 })))];
  return { summary: text(value.summary, `${path}.summary`, { min: 10, max: 400 }), palette, height: number(value.height, `${path}.height`, [60, 280]),
    headShare: number(value.headShare, `${path}.headShare`, [0.08, 0.7]), elements, gait, light: hexColor(value.light, `${path}.light`),
    voice: text(value.voice, `${path}.voice`, { min: 3, max: 160 }), motifs, ...world };
}

const choiceOf = (value, options, path) => (options.includes(value) ? value : fail(path, `Use one of: ${options.join(', ')}.`));

/** The moment the sketch would be set in: its sky and scene colours, weather and beacons, render style and track. */
function sketchWorld(value, path, { artDirection, tracks }) {
  const world = {};
  if (value.scene === undefined) { if (artDirection) fail(`${path}.scene`, `Also sketch the moment you would set the character in: ${SCENE_SKETCH_SHAPE}.`); }
  else {
    object(value.scene, `${path}.scene`, ['sky', 'palette', 'weather', 'towers']);
    world.scene = { sky: list(value.scene.sky, `${path}.scene.sky`, { min: 2, max: 2 }).map((color, index) => hexColor(color, `${path}.scene.sky[${index}]`)),
      palette: [...new Set(list(value.scene.palette, `${path}.scene.palette`, { min: 2, max: 6 }).map((color, index) => hexColor(color, `${path}.scene.palette[${index}]`)))],
      weather: choiceOf(value.scene.weather, WEATHER_KINDS, `${path}.scene.weather`), towers: choiceOf(value.scene.towers ?? 'stone', TOWER_STYLES, `${path}.scene.towers`) };
  }
  if (value.render === undefined) { if (artDirection) fail(`${path}.render`, `Also name the render style you would draw the frame in: one of ${RENDER_NAMES.join(', ')}.`); }
  else world.render = choiceOf(value.render, RENDER_NAMES, `${path}.render`);
  const ids = tracks ? tracks.map(track => track.id) : null;
  if (value.music === undefined) { if (ids) fail(`${path}.music`, 'Also name the track you would choose from music.json, by its ID.'); }
  else {
    if (typeof value.music !== 'string' || !TRACK_ID.test(value.music) || (ids && !ids.includes(value.music))) fail(`${path}.music`, 'Use a track ID from music.json.');
    world.music = value.music;
  }
  return world;
}

const SKETCH_SHAPE = "{summary:'one sentence',palette:['3-6 #rrggbb'],height:figure height in units (60-280),headShare:0.08-0.7,elements:['3-8 part or cloth IDs you would draw'],gait:{cadence,bounciness,lean,armSwing,turnStyle},light:'#rrggbb',voice:'the register of the lines',motifs:['1-5 short phrases']}";
export const SCENE_SKETCH_SHAPE = `scene:{sky:['#zenith','#horizon'],palette:['2-6 #rrggbb: the sun, clouds, rock, foliage, rim or flags'],weather:'one of ${WEATHER_KINDS.join(', ')}',towers:'one of ${TOWER_STYLES.join(', ')}'},render:'one of ${RENDER_NAMES.join(', ')}'`;

/** The website prediction plus a character sketch in place of the page sketch. */
export function normalizeCharacterAssumption(raw, { domains, artDirection = false, tracks = null } = {}) {
  const source = parsed(raw, 'assumption');
  object(source, 'assumption', ['schemaVersion', 'audienceSummary', 'predictions', 'characterSketch']);
  if (source.characterSketch === undefined) fail('assumption.characterSketch', `Also sketch the character you would make from this prediction alone: ${SKETCH_SHAPE}.`);
  const { characterSketch, ...prediction } = source;
  const assumption = normalizeTasteAssumption(prediction, { domains });
  return { ...assumption, characterSketch: normalizeCharacterSketch(characterSketch, 'assumption.characterSketch', { artDirection, tracks }) };
}

function motionToken(raw, path) {
  object(raw, path, ['param', 'value']);
  if (!MOTION_PARAMS.includes(raw.param)) fail(`${path}.param`, `Use a motion parameter such as walk.cadence: ${MOTION_PARAMS.join(', ')}.`);
  if (raw.param === 'turn.style') return { param: raw.param, value: TURN_STYLES.includes(raw.value) ? raw.value : fail(`${path}.value`, `Use one of: ${TURN_STYLES.join(', ')}.`) };
  const [section, key] = raw.param.split('.');
  const bounds = raw.param === 'turn.duration' ? [0, 0.6] : MOTION_RANGES[section][key];
  return { param: raw.param, value: number(raw.value, `${path}.value`, bounds) };
}

function clipToken(raw, path) {
  object(raw, path, ['name', 'duration', 'kindleAt', 'tracks', 'root', 'squash']);
  if (!CLIP_NAMES.includes(raw.name)) fail(`${path}.name`, `Use one of: ${CLIP_NAMES.join(', ')}.`);
  const result = { name: raw.name };
  if (raw.duration !== undefined) result.duration = number(raw.duration, `${path}.duration`, [0.4, 8]);
  if (raw.kindleAt !== undefined) {
    if (raw.name !== 'signature') fail(`${path}.kindleAt`, 'Only the signature clip kindles the beacon.');
    result.kindleAt = number(raw.kindleAt, `${path}.kindleAt`, [0.1, 8]);
  }
  if (raw.tracks !== undefined) result.tracks = [...new Set(list(raw.tracks, `${path}.tracks`, { min: 1, max: 8 }).map((track, index) => ROTATION_TRACKS.includes(track) ? track : fail(`${path}.tracks[${index}]`, `Use a track name: ${ROTATION_TRACKS.join(', ')}.`)))];
  for (const flag of ['root', 'squash']) if (raw[flag] !== undefined) { if (typeof raw[flag] !== 'boolean') fail(`${path}.${flag}`, 'Use true or false.'); result[flag] = raw[flag]; }
  return result;
}

/** The moment's tokens: the sky and scene colours, weather, beacons and mist, the render style and the track. */
function worldTokens(value, path) {
  let scene = null;
  if (value.scene !== undefined) {
    object(value.scene, `${path}.scene`, ['sky', 'colors', 'weather', 'towers', 'fog']);
    scene = {};
    if (value.scene.sky !== undefined) scene.sky = list(value.scene.sky, `${path}.scene.sky`, { min: 2, max: 2 }).map((color, index) => hexColor(color, `${path}.scene.sky[${index}]`));
    if (value.scene.colors !== undefined) scene.colors = [...new Set(list(value.scene.colors, `${path}.scene.colors`, { min: 1, max: 6 }).map((color, index) => hexColor(color, `${path}.scene.colors[${index}]`)))];
    if (value.scene.weather !== undefined) scene.weather = choiceOf(value.scene.weather, WEATHER_KINDS, `${path}.scene.weather`);
    if (value.scene.towers !== undefined) scene.towers = choiceOf(value.scene.towers, TOWER_STYLES, `${path}.scene.towers`);
    if (value.scene.fog !== undefined) scene.fog = number(value.scene.fog, `${path}.scene.fog`, [0, 1]);
    if (!Object.keys(scene).length) fail(`${path}.scene`, 'Declare the sky, scene colours, weather, towers or fog this device paints.');
  }
  const render = value.render === undefined ? null : choiceOf(value.render, RENDER_NAMES, `${path}.render`);
  let music = null;
  if (value.music !== undefined) {
    if (typeof value.music !== 'string' || !TRACK_ID.test(value.music)) fail(`${path}.music`, 'Use a track ID from music.json.');
    music = value.music;
  }
  return { scene, render, music };
}

function normalizeTokens(value, path) {
  object(value, path, ['colors', 'parts', 'proportions', 'motion', 'clips', 'effects', 'light', 'lines', 'scene', 'render', 'music']);
  const colors = [...new Set(list(value.colors, `${path}.colors`, { max: 6 }).map((color, index) => hexColor(color, `${path}.colors[${index}]`)))];
  const parts = [...new Set(list(value.parts, `${path}.parts`, { max: 6 }).map((id, index) => ident(id, `${path}.parts[${index}]`)))];
  let proportions = null;
  if (value.proportions !== undefined) {
    object(value.proportions, `${path}.proportions`, ['height', 'headShare']);
    proportions = {};
    if (value.proportions.height !== undefined) proportions.height = number(value.proportions.height, `${path}.proportions.height`, [60, 280]);
    if (value.proportions.headShare !== undefined) proportions.headShare = number(value.proportions.headShare, `${path}.proportions.headShare`, [0.08, 0.7]);
    if (!Object.keys(proportions).length) fail(`${path}.proportions`, 'Declare height, headShare or both.');
  }
  const motion = list(value.motion, `${path}.motion`, { max: 8 }).map((item, index) => motionToken(item, `${path}.motion[${index}]`));
  if (new Set(motion.map(item => item.param)).size !== motion.length) fail(`${path}.motion`, 'Declare each motion parameter once.');
  const clips = list(value.clips, `${path}.clips`, { max: 3 }).map((item, index) => clipToken(item, `${path}.clips[${index}]`));
  const effects = [...new Set(list(value.effects, `${path}.effects`, { max: 4 }).map((id, index) => ident(id, `${path}.effects[${index}]`)))];
  let light = null;
  if (value.light !== undefined) {
    object(value.light, `${path}.light`, ['color', 'radius']);
    light = { color: hexColor(value.light.color, `${path}.light.color`), ...(value.light.radius === undefined ? {} : { radius: number(value.light.radius, `${path}.light.radius`, [60, 420]) }) };
  }
  const lines = [...new Set(list(value.lines, `${path}.lines`, { max: 4 }).map((line, index) => text(line, `${path}.lines[${index}]`, { min: 2, max: 160 })))];
  const { scene, render, music } = worldTokens(value, path);
  if (!colors.length && !parts.length && !proportions && !motion.length && !clips.length && !effects.length && !light && !lines.length && !scene && !render && !music) fail(path, 'Declare at least one literal token the host can check.');
  return { colors, parts, proportions, motion, clips, effects, light, lines, ...(scene ? { scene } : {}), ...(render ? { render } : {}), ...(music ? { music } : {}) };
}

/** Tokens of a device that the frozen sketch did not contain: far colours, unplanned elements, moved proportions and gait. */
function sketchNovelty(tokens, sketch) {
  const gait = [];
  for (const [key, param] of Object.entries(SKETCH_GAIT)) {
    const declared = tokens.motion.find(item => item.param === param);
    if (!declared) continue;
    const before = sketch.gait[key];
    if (param === 'turn.style' ? declared.value !== before : Math.abs(declared.value - before) >= GAIT_THRESHOLDS[param]) gait.push({ param, from: before, to: declared.value });
  }
  const proportions = tokens.proportions ? {
    ...(tokens.proportions.height !== undefined ? { height: round(Math.abs(tokens.proportions.height - sketch.height) / sketch.height) } : {}),
    ...(tokens.proportions.headShare !== undefined ? { headShare: round(Math.abs(tokens.proportions.headShare - sketch.headShare)) } : {}),
  } : null;
  return { colors: tokens.colors.filter(hex => farFrom(hex, sketch.palette)),
    parts: tokens.parts.filter(id => !sketch.elements.includes(id)), proportions, gait, ...(sketchHasWorld(sketch) ? { world: worldNovelty(tokens, sketch) } : {}) };
}
const movedProportions = novel => Boolean(novel?.proportions && ((novel.proportions.height ?? 0) >= CHARACTER_LIMITS.heightShift || (novel.proportions.headShare ?? 0) >= CHARACTER_LIMITS.headShift));
const farFrom = (hex, palette) => Math.min(...palette.map(color => deltaE(hex, color))) >= CHARACTER_LIMITS.sketchDeltaE;
const sketchHasWorld = sketch => Boolean(sketch?.scene || sketch?.render || sketch?.music);
const sketchSceneColors = sketch => (sketch?.scene ? [...sketch.scene.sky, ...sketch.scene.palette] : []);

/** What a device's world tokens change against the sketch's moment: far scene colours, weather, beacons, render style and track. */
function worldNovelty(tokens, sketch) {
  const planned = sketchSceneColors(sketch), scene = tokens.scene;
  return { sceneColors: planned.length && scene ? [...(scene.sky || []), ...(scene.colors || [])].filter(hex => farFrom(hex, planned)) : [],
    weather: Boolean(sketch.scene && scene?.weather && scene.weather !== sketch.scene.weather), towers: Boolean(sketch.scene && scene?.towers && scene.towers !== sketch.scene.towers),
    render: Boolean(sketch.render && tokens.render && tokens.render !== sketch.render), music: Boolean(sketch.music && tokens.music && tokens.music !== sketch.music) };
}

/**
 * Validate a Character DNA against the taste input the agent actually received. With a frozen sketch and measured
 * surprises, surprise-anchored devices must depart from the sketch in palette, proportions, elements and gait, and with
 * art direction in the scene and the track too, unless `departure` is false for an ablation pair. `artDirection`
 * requires scene and render devices; `tracks`, the music library's tracks, requires a music device.
 */
export function normalizeCharacterDna(raw, { input, sketch, portraits = false, maxRequiredRejections = CHARACTER_LIMITS.maxRequiredRejections, artDirection = false, tracks = null, departure = true } = {}) {
  if (!plain(input) || !Array.isArray(input.entities)) fail('input', 'The taste input for this run is required.');
  const refs = new Map(input.entities.map(entity => [entity.ref, entity]));
  const library = Array.isArray(tracks) && tracks.length ? tracks : null;
  const frozen = plain(sketch) ? sketch : null;
  const measuredRun = input.entities.some(entity => entity.source === 'qloo');
  // Qualities first for the music too: a quality or ranked tag whose name a track carries chooses it, so an entity's
  // own catalogue tags (a team's "Energy", a brand's "Electronics") never do. Only when no measured quality meets a
  // track may another measured ref's returned tags choose it. Without measured data, the model's own qualities do.
  const moodRef = entity => isQualityDomain(entity.domain) && entity.domain !== ART_STYLE_DOMAIN && (!measuredRun || entity.source === 'qloo');
  const fitsTrack = entity => tracksFor(library, entity.tags?.length ? entity.tags : [entity.name]).length > 0;
  const moodRefs = library ? input.entities.filter(moodRef) : [];
  const musicPool = !library ? [] : !measuredRun ? moodRefs : moodRefs.some(fitsTrack) ? moodRefs.filter(fitsTrack) : input.entities.filter(entity => entity.source === 'qloo');
  const musicByQuality = measuredRun && musicPool.length > 0 && musicPool.every(moodRef);
  const source = parsed(raw, 'dna');
  object(source, 'dna', ['schemaVersion', 'thesis', 'devices', 'rejected']);
  if (source.schemaVersion !== TASTE_SCHEMA_VERSION) fail('dna.schemaVersion', "Use schemaVersion '1.0'.");
  const thesis = text(source.thesis, 'dna.thesis', { min: 10, max: 600 });
  const ids = new Set();
  const devices = list(source.devices, 'dna.devices', { min: CHARACTER_LIMITS.minDevices, max: CHARACTER_LIMITS.maxDevices }).map((device, index) => {
    const at = `dna.devices[${index}]`;
    object(device, at, ['id', 'layer', 'device', 'anchors', 'qualities', 'translation', 'tokens', 'convention']);
    const id = text(device.id, `${at}.id`, { max: 40 });
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(id) || ids.has(id)) fail(`${at}.id`, 'Use a unique ID such as dna1.');
    ids.add(id);
    if (!CHARACTER_LAYERS.includes(device.layer)) fail(`${at}.layer`, `Use one of: ${CHARACTER_LAYERS.join(', ')}.`);
    const layer = device.layer;
    const anchors = [...new Set(list(device.anchors, `${at}.anchors`, { min: 1, max: 3 }).map((ref, anchorIndex) => {
      const value = text(ref, `${at}.anchors[${anchorIndex}]`, { max: 160 });
      if (!refs.has(value)) fail(`${at}.anchors[${anchorIndex}]`, 'Use a ref exactly as returned by game_get_taste.');
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
    const tokens = normalizeTokens(device.tokens ?? {}, `${at}.tokens`);
    if (layer === 'palette' && tokens.colors.length < 2) fail(`${at}.tokens.colors`, 'A palette device declares at least two hex colours the character is drawn with.');
    if (layer === 'silhouette' && (tokens.proportions?.height === undefined || tokens.proportions?.headShare === undefined)) fail(`${at}.tokens.proportions`, 'A silhouette device declares the figure height and head share it draws: {height, headShare}. game_check_character measures both.');
    if (layer === 'costume' && !tokens.parts.length) fail(`${at}.tokens.parts`, 'A costume device names at least one part or cloth ID it draws.');
    if (layer === 'motion' && tokens.motion.length < 2) fail(`${at}.tokens.motion`, 'A motion device declares at least two motion parameters with their values, such as {param:"walk.cadence",value:2.4}.');
    if (layer === 'signature' && !tokens.clips.some(clip => clip.name === 'signature' && clip.duration !== undefined && clip.kindleAt !== undefined)) fail(`${at}.tokens.clips`, 'A signature device declares the signature clip with its duration and kindleAt: {name:"signature",duration,kindleAt,tracks:[...]}.');
    if (layer === 'light' && !tokens.light) fail(`${at}.tokens.light`, 'A light device declares the carried light: {color, radius}.');
    if (layer === 'voice' && tokens.lines.length < 2) fail(`${at}.tokens.lines`, 'A voice device declares at least two of the lines you wrote, exactly as they appear in the character file.');
    if (layer === 'scene' && (!tokens.scene?.sky || !tokens.scene.weather)) fail(`${at}.tokens.scene`, "A scene device declares the sky it paints and the weather: {sky:['#zenith','#horizon'],colors:['#rrggbb'],weather:'snow',towers:'spire',fog:0.3}.");
    if (layer === 'render' && !tokens.render) fail(`${at}.tokens.render`, `A render device declares the style the frame is drawn in: one of ${RENDER_NAMES.join(', ')}.`);
    let preset = null, moods = null;
    if (layer === 'render') {
      // The render style follows the first anchor whose name names one, so a measured art style chooses it.
      const named = anchors.map(ref => refs.get(ref)).find(entity => refPreset(entity));
      if (named) {
        preset = refPreset(named);
        if (tokens.render !== preset) fail(`${at}.tokens.render`, `This render device is anchored to ${named.name} (${named.ref}), which names the ${RENDER_PRESETS[preset].label.toLowerCase()} style, so it draws in "${preset}". Anchor it to another art style to draw in another style.`);
      }
    }
    if (layer === 'music') {
      if (!tokens.music) fail(`${at}.tokens.music`, 'A music device declares the track it picks from music.json, by its ID.');
      if (library) {
        const track = library.find(item => item.id === tokens.music);
        if (!track) fail(`${at}.tokens.music`, 'Use a track ID from music.json.');
        // A measured run's qualities are returned tags; when measured qualities meet tracks, only the names of the
        // device's quality anchors count, so the audience's shared qualities decide which tracks can play.
        const named = new Set(measured.filter(moodRef).flatMap(entity => entity.tags?.length ? entity.tags : [entity.name]).map(normalizeTasteName));
        const counted = musicByQuality ? qualities.filter(quality => named.has(normalizeTasteName(quality))) : qualities;
        moods = sharedMoods(track, counted);
        if (!moods.length) {
          const fitting = tracksFor(library, counted).slice(0, 5).map(item => `${item.track.id} (${item.moods.join(', ')})`);
          fail(`${at}.qualities`, `The track must carry this device's qualities: none of "${track.title}"'s genres and tags (${[...track.genres, ...track.tags].join(', ')}) shares a word, or a close form of it, with ${counted.length ? counted.join(', ') : musicByQuality ? 'a quality anchor of this device' : 'the device\'s qualities, which are empty'}. ${fitting.length ? `Tracks that carry them: ${fitting.join('; ')}.` : `No track carries these qualities; anchor the device to ${musicByQuality ? 'a measured quality' : 'a ref'} whose name or tags a track carries${musicPool.length ? `, such as ${musicPool.slice(0, 4).map(entity => entity.name).join(', ')}` : ''}.`}`);
        }
      }
    }
    return { id, layer, device: text(device.device, `${at}.device`, { min: 3, max: 200 }), anchors, ...(qualities.length ? { qualities } : {}),
      translation: text(device.translation, `${at}.translation`, { min: 10, max: 900 }), tokens, ...(surprise ? { surprise: true } : {}),
      // The genre convention it translates, as the reading named it and bound it (see applyReadingToDna).
      ...(device.convention !== undefined ? { convention: plain(device.convention) ? { ...(device.convention.cluster ? { cluster: text(device.convention.cluster, `${at}.convention.cluster`, { max: 20 }) } : {}), text: text(device.convention.text, `${at}.convention.text`, { min: 3, max: 200 }) }
        : { text: text(device.convention, `${at}.convention`, { min: 3, max: 200 }) } } : {}),
      ...(preset ? { presetFrom: anchors.find(ref => refPreset(refs.get(ref))) } : {}), ...(moods ? { moods } : {}),
      ...(frozen ? { novel: sketchNovelty(tokens, frozen) } : {}) };
  });
  const layers = new Set(devices.map(device => device.layer));
  const requiredLayers = [...REQUIRED_LAYERS, ...(artDirection ? ['scene', 'render'] : []), ...(library ? ['music'] : [])];
  const missingLayers = requiredLayers.filter(layer => !layers.has(layer));
  if (missingLayers.length) fail('dna.devices', `Include ${missingLayers.join(', ')} device${missingLayers.length > 1 ? 's' : ''}: ${requiredLayers.slice(0, -1).join(', ')} and ${requiredLayers.at(-1)} are required.`);
  if (!FORM_LAYERS.some(layer => layers.has(layer))) fail('dna.devices', `Include at least one device in ${FORM_LAYERS.join(', ')}.`);
  if (portraits && !layers.has('imagery')) fail('dna.devices', 'This run paints portraits, so include an imagery device. Its name, colours and qualities become the art direction of the portraits you request.');
  const listed = entities => entities.slice(0, 8).map(entity => `${entity.name} (${entity.ref})`).join(', ');
  // Qualities first: the colours and the figure translate what the audience's works share, and entities are evidence
  // of it. The first live pair took an ice hockey team's black and silver for its palette instead. The rule applies
  // when the taste input has aggregated qualities: measured ones in a measured run, predicted ones otherwise.
  const shared = input.entities.filter(entity => entity.domain === QUALITY_DOMAIN && (!measuredRun || entity.source === 'qloo'));
  if (shared.length) {
    // Art styles are look qualities too, so they may anchor the palette, the figure and the scene.
    const pool = [...shared].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .concat(input.entities.filter(entity => (isTagDomain(entity.domain) || entity.domain === ART_STYLE_DOMAIN) && (!measuredRun || entity.source === 'qloo')));
    const poolRefs = new Set(pool.map(entity => entity.ref));
    const sets = { palette: 'colours', silhouette: 'figure and its proportions', scene: 'sky, the scene\'s colours and its weather' };
    for (const layer of ['palette', 'silhouette', ...(artDirection ? ['scene'] : [])]) if (!devices.some(device => device.layer === layer && device.anchors.some(ref => poolRefs.has(ref)))) {
      fail('dna.devices', `Qualities first: anchor a ${layer} device to at least one ${measuredRun ? 'measured ' : ''}quality ref, such as ${listed(pool)}, and let it set the ${sets[layer]}. Entities are evidence of the qualities; never take an entity's own brand or team colours, logo, packaging, costume or trade dress.`);
    }
  }
  // The frame's style rests on an art style: a measured one in a measured run, the model's own prediction otherwise.
  // The strongest render style of the input is required on the render device or rejected below.
  const renderStyles = artDirection && Array.isArray(input.renderStyles) ? input.renderStyles : [];
  if (artDirection) {
    const styles = input.entities.filter(entity => entity.domain === ART_STYLE_DOMAIN && (!measuredRun || entity.source === 'qloo'));
    const styleRefs = new Set(styles.map(entity => entity.ref));
    if (styles.length && !devices.some(device => device.layer === 'render' && device.anchors.some(ref => styleRefs.has(ref)))) {
      const naming = renderStyles.map(style => `${style.name} (${style.ref}) for ${style.preset}`);
      fail('dna.devices', `Include a render device anchored to a${measuredRun ? ' measured' : 'n'} art style ref; it draws in the style its art style names.${naming.length ? ` Art styles that name a render style, strongest first: ${naming.join(', ')}.` : ` None of them names a render style, so the device chooses one: ${listed(styles)}.`}`);
    }
  }
  // The track is chosen by the device's qualities: a measured quality whose name a track carries, when there is one.
  const measuredRefs = new Set(input.entities.filter(entity => entity.source === 'qloo').map(entity => entity.ref));
  const poolRefs = new Set(musicPool.map(entity => entity.ref));
  if (library && poolRefs.size && !devices.some(device => device.layer === 'music' && device.anchors.some(ref => poolRefs.has(ref)))) {
    const offers = musicPool.map(entity => ({ entity, fits: tracksFor(library, entity.tags?.length ? entity.tags : [entity.name]) })).filter(item => item.fits.length).slice(0, 6)
      .map(({ entity, fits }) => `${entity.name} (${entity.ref}): ${fits.slice(0, 2).map(item => `${item.track.id} by ${item.moods.join(', ')}`).join('; ')}`);
    fail('dna.devices', musicByQuality
      ? `Qualities first: anchor the music device to a measured quality or tag and translate its name, so the audience's shared qualities choose the track, not an entity's own catalogue tags. Measured qualities a track carries: ${offers.join(' | ')}.`
      : measuredRun ? `Anchor the music device to a measured ref and translate its returned tags, so the measured data chooses the track; no measured quality meets a track in this library.${offers.length ? ` Measured refs whose tags a track carries: ${offers.join(' | ')}.` : ''}`
        : `Qualities first: anchor the music device to one of the qualities you predicted, such as ${listed(musicPool)}, and pick a track that carries it.`);
  }
  // Motion translates the audience's style tags and costume or silhouette its aesthetic tags: measured ones when the
  // run has them, otherwise the qualities the model predicted. Both arms follow the same rule. A measured ranking that
  // returned nothing gives way to the measured qualities of the nearest family, mood for motion and look for costume:
  // all three Echo Atlas game-site passes returned no aesthetic tag.
  const tagAnchors = (domain, family) => {
    const all = input.entities.filter(entity => entity.domain === domain), measured = all.filter(entity => entity.source === 'qloo');
    const derived = all.length && !measured.length ? input.entities.filter(entity => entity.domain === QUALITY_DOMAIN && entity.source === 'qloo' && entity.family === family) : [];
    const pool = measured.length ? measured : derived.length ? derived : all;
    return { refs: new Set(pool.map(entity => entity.ref)), names: listed(pool),
      label: derived.length ? `measured ${family} quality (the ${domain} ranking returned no tags)` : `${measured.length ? 'measured ' : ''}${domain} ref` };
  };
  const style = tagAnchors('style', 'mood'), aesthetic = tagAnchors('aesthetic', 'look');
  if (style.refs.size && !devices.some(device => device.layer === 'motion' && device.anchors.some(ref => style.refs.has(ref)))) {
    fail('dna.devices', `Include a motion device anchored to a ${style.label} that translates it into cadence, bounce, lean, arm swing and turning: ${style.names}.`);
  }
  if (aesthetic.refs.size && !devices.some(device => ['costume', 'silhouette'].includes(device.layer) && device.tokens.parts.length && device.anchors.some(ref => aesthetic.refs.has(ref)))) {
    fail('dna.devices', `Include a costume or silhouette device anchored to a ${aesthetic.label} that turns it into garments, materials or outline, naming the part or cloth IDs it draws in tokens.parts: ${aesthetic.names}.`);
  }
  if (!devices.some(device => device.layer === 'voice' && device.tokens.lines.length >= 2 && (!measuredRefs.size || device.anchors.some(ref => measuredRefs.has(ref))))) {
    fail('dna.devices', `Include a voice device anchored to a ${measuredRefs.size ? 'measured ' : ''}ref whose quality sets the register, rhythm and vocabulary of the character's lines, and declare at least two of those lines in tokens.lines.`);
  }
  const surprises = input.entities.filter(entity => entity.source === 'qloo' && entity.surprise);
  if (departure && frozen && surprises.length) {
    const moved = devices.filter(device => device.surprise);
    const of = layerList => moved.filter(device => layerList.includes(device.layer));
    if (!of(['palette']).some(device => device.novel.colors.length >= 2)) {
      const close = [...new Set(of(['palette']).flatMap(device => device.tokens.colors.filter(hex => !device.novel.colors.includes(hex))))].slice(0, 6)
        .map(hex => { const { color, distance } = nearest(hex, frozen.palette); return `${hex} (${Math.round(distance)} from ${color})`; });
      fail('dna.devices', `Measured surprises must move the palette away from your frozen sketch (${frozen.palette.join(', ')}). Give a palette device anchored to a surprise entity or quality at least two colours with a CIE76 difference of at least ${CHARACTER_LIMITS.sketchDeltaE} from every sketch colour.${close.length ? ` Too close now: ${close.join(', ')}.` : ''}`);
    }
    if (!of(['silhouette']).some(device => movedProportions(device.novel))) {
      const low = Math.floor(frozen.height * (1 - CHARACTER_LIMITS.heightShift)), high = Math.ceil(frozen.height * (1 + CHARACTER_LIMITS.heightShift));
      fail('dna.devices', `Measured surprises must change the figure, not only its surface. Your sketch is ${frozen.height} units tall with a head share of ${frozen.headShare}. Give a silhouette device anchored to a surprise entity or quality a height of at most ${low} or at least ${high}, or a head share of at most ${round(frozen.headShare - CHARACTER_LIMITS.headShift, 2)} or at least ${round(frozen.headShare + CHARACTER_LIMITS.headShift, 2)}.`);
    }
    if (!of(['costume', 'silhouette']).some(device => device.novel.parts.length)) {
      fail('dna.devices', `Measured surprises must add something the sketch did not plan. Give a costume or silhouette device anchored to a surprise entity or quality at least one part or cloth ID for a new garment, prop or feature: not one of your sketch's elements (${frozen.elements.join(', ')}).`);
    }
    if (!of(['motion']).some(device => device.novel.gait.length >= CHARACTER_LIMITS.gaitMoves)) {
      const { cadence, bounciness, lean, armSwing, turnStyle } = frozen.gait;
      fail('dna.devices', `Measured surprises must change how the character moves. Your sketch walks at cadence ${cadence}, bounciness ${bounciness}, lean ${lean}, arm swing ${armSwing} and turns by ${turnStyle}. Give a motion device anchored to a surprise entity or quality at least ${CHARACTER_LIMITS.gaitMoves} of: walk.cadence at least 0.4 away, walk.bounciness at least 0.25 away, walk.lean at least 6 away, walk.armSwing at least 15 away, or a different turn.style.`);
    }
    // The world departs with the character: the scene's colours, and the track when a surprise's tags meet another one.
    if (artDirection && frozen.scene && !of(['scene']).some(device => device.novel.world?.sceneColors.length >= 2)) {
      fail('dna.devices', `Measured surprises must move the world as well as the character. Your sketch sets the moment in ${sketchSceneColors(frozen).join(', ')} with ${frozen.scene.weather}. Give a scene device anchored to a surprise entity or quality at least two sky or scene colours with a CIE76 difference of at least ${CHARACTER_LIMITS.sketchDeltaE} from every colour of that scene.`);
    }
    // Only the refs that may choose the track can require another one.
    const movers = surprises.filter(entity => poolRefs.has(entity.ref));
    if (library && frozen.music && movers.some(entity => tracksFor(library.filter(track => track.id !== frozen.music), entity.tags?.length ? entity.tags : [entity.name]).length) && !of(['music']).some(device => device.novel.world?.music)) {
      const sketched = library.find(track => track.id === frozen.music);
      fail('dna.devices', `Measured surprises must change the music too: your sketch picks "${sketched?.title || frozen.music}". Anchor the music device to a surprise ${musicByQuality ? 'quality whose name' : 'entity or quality whose returned tags'} another track carries, and pick that track.`);
    }
  }
  const used = new Set(devices.flatMap(device => device.anchors));
  const rejectedRefs = new Set();
  const rejected = list(source.rejected, 'dna.rejected', { max: 6 }).map((item, index) => {
    const at = `dna.rejected[${index}]`;
    object(item, at, ['ref', 'reason']);
    const ref = text(item.ref, `${at}.ref`, { max: 160 });
    if (!refs.has(ref)) fail(`${at}.ref`, 'Use a ref exactly as returned by game_get_taste.');
    if (rejectedRefs.has(ref) || used.has(ref)) fail(`${at}.ref`, 'A ref is either used by a device or rejected once, not both.');
    rejectedRefs.add(ref);
    return { ref, reason: text(item.reason, `${at}.reason`, { min: 10, max: 400 }) };
  });
  const required = Array.isArray(input.requiredAnchors) ? input.requiredAnchors.filter(ref => refs.has(ref)) : [];
  const missing = required.filter(ref => !used.has(ref) && !rejectedRefs.has(ref));
  if (missing.length) fail('dna.devices', `Every required anchor needs a device or a reasoned rejection. Missing: ${missing.map(ref => `${refs.get(ref).name} (${ref})`).join(', ')}.`);
  const rejectedRequired = required.filter(ref => rejectedRefs.has(ref));
  if (rejectedRequired.length > maxRequiredRejections) fail('dna.rejected', `At most ${maxRequiredRejections} required anchors may be rejected.`);
  // The strongest render style draws the frame unless the DNA gives a reason against it; then another one that names
  // a render style does, so the frame's style always comes from the input's art styles when it has any.
  const lead = renderStyles[0];
  const renderDevices = devices.filter(device => device.layer === 'render');
  if (lead && !rejectedRefs.has(lead.ref) && !renderDevices.some(device => device.anchors.includes(lead.ref))) {
    fail('dna.devices', `Anchor the render device to ${lead.name} (${lead.ref}), the strongest render style in the taste input, which draws in "${lead.preset}"${lead.examples?.length ? ` (carried by ${lead.examples.join(', ')})` : ''}, or reject it in dna.rejected with a specific reason.`);
  }
  if (lead && rejectedRefs.has(lead.ref)) {
    const others = renderStyles.slice(1);
    const named = new Set(input.entities.filter(entity => entity.domain === ART_STYLE_DOMAIN && others.some(style => style.preset === refPreset(entity))).map(entity => entity.ref));
    if (others.length && !renderDevices.some(device => device.anchors.some(ref => named.has(ref)))) {
      fail('dna.devices', `With ${lead.name} rejected, anchor the render device to another art style that names a render style: ${others.map(style => `${style.name} (${style.ref}) for ${style.preset}`).join(', ')}.`);
    }
  }
  const dna = { schemaVersion: TASTE_SCHEMA_VERSION, thesis, devices, rejected,
    coverage: { required, used: required.filter(ref => used.has(ref)), rejected: rejectedRequired }, sourceType: 'model-interpretation',
    ...(artDirection || library || !departure ? { rules: { artDirection, music: Boolean(library), departure } } : {}) };
  return { ...dna, stats: characterDnaStats(dna, input) };
}

export function characterDnaStats(dna, input) {
  const refs = new Map((input?.entities || []).map(entity => [entity.ref, entity]));
  const anchored = (dna?.devices || []).map(device => device.anchors.map(ref => refs.get(ref)).filter(Boolean));
  const total = anchored.length;
  const surprise = anchored.filter(anchors => anchors.some(entity => entity.source === 'qloo' && entity.surprise)).length;
  const novel = (dna?.devices || []).filter(device => device.novel);
  // Devices translating a quality of the run's own taste source: measured tags and qualities with Qloo, predicted ones without.
  const own = input?.source === 'qloo-profile' ? 'qloo' : 'model-assumption';
  return { devices: total, layers: [...new Set((dna?.devices || []).map(device => device.layer))],
    qlooAnchoredDevices: anchored.filter(anchors => anchors.some(entity => entity.source === 'qloo')).length, surpriseAnchoredDevices: surprise,
    modelAnchoredDevices: anchored.filter(anchors => anchors.length && anchors.every(entity => entity.source === 'model-assumption')).length,
    qualityAnchoredDevices: anchored.filter(anchors => anchors.some(entity => isQualityDomain(entity.domain) && entity.source === own)).length,
    surpriseShare: total ? round(surprise / total) : 0,
    ...(novel.length ? { sketchMoves: { colors: [...new Set(novel.flatMap(device => device.novel.colors))], parts: [...new Set(novel.flatMap(device => device.novel.parts))],
      proportions: novel.some(device => movedProportions(device.novel)), gait: [...new Set(novel.flatMap(device => device.novel.gait.map(item => item.param)))],
      ...(novel.some(device => device.novel.world) ? { world: { sceneColors: [...new Set(novel.flatMap(device => device.novel.world?.sceneColors || []))],
        changed: ['weather', 'towers', 'render', 'music'].filter(key => novel.some(device => device.novel.world?.[key])) } } : {}) } } : {}) };
}

/** Labels for the comparison page: each device with its anchors and where they came from. */
export function characterDecisions(dna, input) {
  const refs = new Map((input?.entities || []).map(entity => [entity.ref, entity]));
  return (dna?.devices || []).map(device => ({ id: device.id, layer: device.layer, device: device.device, translation: device.translation, qualities: device.qualities || [],
    ...(device.presetFrom ? { presetFrom: device.presetFrom } : {}), ...(device.moods?.length ? { moods: device.moods } : {}),
    anchors: device.anchors.map(ref => refs.get(ref)).filter(Boolean).map(entity => ({ ref: entity.ref, name: entity.name, domain: entity.domain, source: entity.source,
      ...qualityFacts(entity),
      ...(entity.source === 'qloo' ? { surprise: Boolean(entity.surprise), predictedByModel: Boolean(entity.predictedByModel), ...(entity.affinity !== undefined ? { affinity: entity.affinity } : {}) } : {}) })) }));
}

/** What a record says about a shared quality: its family, how many works carry it, their domains and a few of them. */
export function qualityFacts(entity) {
  if (entity?.domain === ART_STYLE_DOMAIN) {
    const preset = refPreset(entity);
    return { ...(Number.isInteger(entity.count) ? { count: entity.count } : {}), ...(Array.isArray(entity.domains) ? { domains: entity.domains } : {}),
      ...(Array.isArray(entity.examples) && entity.examples.length ? { examples: entity.examples.slice(0, 3) } : {}), ...(preset ? { preset } : {}) };
  }
  if (entity?.domain !== QUALITY_DOMAIN || !entity.family) return {};
  return { family: entity.family, ...(Number.isInteger(entity.count) ? { count: entity.count } : {}), ...(Array.isArray(entity.domains) ? { domains: entity.domains } : {}),
    ...(Array.isArray(entity.examples) && entity.examples.length ? { examples: entity.examples.slice(0, 3) } : {}) };
}

const sameText = (a, b) => a.replace(/\s+/gu, ' ').trim().toLowerCase() === b.replace(/\s+/gu, ' ').trim().toLowerCase();
const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

/**
 * Literal token presence in the saved character, plus portraits made from imagery devices. A host check, not a
 * judgment of quality, motion feel, likeness or player preference. `portraitDevices` limits the portrait checks to the
 * imagery devices a production plan made with the portrait method; without it every imagery device is checked.
 */
export function checkCharacterConformance(dna, character, { measures, portraits = null, portraitDevices = null } = {}) {
  if (!plain(dna) || !Array.isArray(dna.devices)) fail('dna', 'A validated Character DNA is required.');
  const colors = colorsUsed(character);
  const scene = character.scene ? completeScene(character.scene) : null, painted = new Set(scene ? sceneColors(character.scene) : []);
  const sceneDetail = scene ? `the scene paints a ${scene.sky.join(' to ')} sky with ${scene.weather.kind} and ${scene.towers} beacons` : 'the character file paints no scene';
  const preset = character.render?.preset || 'lit';
  // A portrait and the figure are recognizably one character when they share colours: at least two of the portrait's
  // main subject colours lie close to colours the figure shows.
  const visible = (measures?.visibleColors || []).slice(0, 10).map(item => item.hex);
  const portraitColors = device => {
    const painting = (portraits || []).filter(item => item.device === device.id && item.status === 'generated' && Array.isArray(item.palette) && item.palette.length);
    if (!painting.length || !visible.length) return [];
    const main = [...new Set(painting.flatMap(item => item.palette.slice(0, 6).map(color => color.hex)))];
    const shared = main.filter(hex => Math.min(...visible.map(other => deltaE(hex, other))) <= CHARACTER_LIMITS.portraitDeltaE);
    return [{ kind: 'portrait-colors', value: device.id, present: shared.length >= 2, detail: `${shared.length} of the portrait's main colours (${main.join(', ')}) are within CIE76 ${CHARACTER_LIMITS.portraitDeltaE} of a colour the figure shows` }];
  };
  const ids = new Set([...character.parts.map(part => part.id), ...character.cloth.map(chain => chain.id)]);
  const effects = new Set(character.effects.map(effect => effect.id));
  const lines = Object.values(character.lines || {});
  const valueOf = param => {
    const [section, key] = param.split('.');
    return character.motion[section]?.[key];
  };
  const devices = dna.devices.map(device => {
    const tokens = device.tokens;
    const checks = [
      ...tokens.colors.map(value => ({ kind: 'color', value, present: colors.has(value) })),
      ...tokens.parts.map(value => ({ kind: 'part', value, present: ids.has(value) })),
      ...(tokens.proportions?.height !== undefined ? [{ kind: 'height', value: tokens.proportions.height, present: Boolean(measures) && Math.abs(measures.figureHeight - tokens.proportions.height) <= tokens.proportions.height * CHARACTER_LIMITS.heightTolerance,
        detail: measures ? `measured figure height ${measures.figureHeight}` : 'not measured' }] : []),
      ...(tokens.proportions?.headShare !== undefined ? [{ kind: 'headShare', value: tokens.proportions.headShare, present: Boolean(measures) && close(measures.headShare, tokens.proportions.headShare, CHARACTER_LIMITS.headTolerance),
        detail: measures ? `measured head share ${measures.headShare}` : 'not measured' }] : []),
      ...tokens.motion.map(({ param, value }) => {
        const actual = valueOf(param);
        return { kind: 'motion', value: `${param} ${value}`, present: typeof value === 'string' ? actual === value : typeof actual === 'number' && close(actual, value, Math.max(1e-6, Math.abs(value) * 0.005)), detail: `the character has ${actual}` };
      }),
      ...tokens.clips.map(clip => {
        const actual = character.clips[clip.name];
        const problems = !actual ? [`no ${clip.name} clip`] : [
          ...(clip.duration !== undefined && !close(actual.duration, clip.duration, CHARACTER_LIMITS.timeTolerance) ? [`duration ${actual.duration}`] : []),
          ...(clip.kindleAt !== undefined && !close(actual.kindleAt ?? -1, clip.kindleAt, CHARACTER_LIMITS.timeTolerance) ? [`kindleAt ${actual.kindleAt}`] : []),
          ...(clip.tracks || []).filter(track => !actual.tracks[track]).map(track => `no ${track} track`),
          ...(clip.root && !actual.root ? ['no root motion'] : []), ...(clip.squash && !actual.squash ? ['no squash'] : []),
        ];
        return { kind: 'clip', value: clip.name, present: !problems.length, ...(problems.length ? { detail: problems.join(', ') } : {}) };
      }),
      ...tokens.effects.map(value => ({ kind: 'effect', value, present: effects.has(value) })),
      ...(tokens.light ? [{ kind: 'light', value: tokens.light.color, present: character.light?.color === tokens.light.color && (tokens.light.radius === undefined || close(character.light.radius, tokens.light.radius, tokens.light.radius * CHARACTER_LIMITS.radiusTolerance)),
        detail: character.light ? `the light is ${character.light.color}, radius ${character.light.radius}` : 'the character carries no light' }] : []),
      ...tokens.lines.map(value => ({ kind: 'line', value, present: lines.some(line => sameText(line, value)) })),
      ...(tokens.scene?.sky || []).map((value, index) => ({ kind: 'sky', value, present: Boolean(scene) && scene.sky[index] === value, detail: sceneDetail })),
      ...(tokens.scene?.colors || []).map(value => ({ kind: 'scene-color', value, present: painted.has(value), detail: sceneDetail })),
      ...(tokens.scene?.weather ? [{ kind: 'weather', value: tokens.scene.weather, present: scene?.weather.kind === tokens.scene.weather, detail: sceneDetail }] : []),
      ...(tokens.scene?.towers ? [{ kind: 'towers', value: tokens.scene.towers, present: scene?.towers === tokens.scene.towers, detail: sceneDetail }] : []),
      ...(tokens.scene?.fog !== undefined ? [{ kind: 'fog', value: tokens.scene.fog, present: Boolean(scene) && close(scene.fog, tokens.scene.fog, 0.05), detail: scene ? `the fog is ${scene.fog}` : 'the character file paints no scene' }] : []),
      ...(tokens.render ? [{ kind: 'render', value: tokens.render, present: preset === tokens.render, detail: `the frame is drawn in ${preset}` }] : []),
      ...(tokens.music ? [{ kind: 'music', value: tokens.music, present: character.music?.track === tokens.music, detail: character.music ? `the track is ${character.music.track}` : 'the character file sets no music' }] : []),
      ...(device.layer === 'imagery' && portraits && (!portraitDevices || portraitDevices.has(device.id)) ? [{ kind: 'portrait', value: device.id, present: portraits.some(item => item.device === device.id && item.status === 'generated'), detail: 'a portrait generated from this device' }, ...portraitColors(device)] : []),
    ];
    const found = checks.filter(check => check.present).length;
    return { id: device.id, layer: device.layer, device: device.device, status: !checks.length ? 'missing' : found === checks.length ? 'present' : found ? 'partial' : 'missing',
      tokens: checks.length, found, missing: checks.filter(check => !check.present).map(({ kind, value, detail }) => ({ kind, value, ...(detail ? { detail } : {}) })) };
  });
  const present = devices.filter(device => device.status === 'present').length, partial = devices.filter(device => device.status === 'partial').length;
  const score = devices.length ? round((present + partial / 2) / devices.length) : 0;
  return { status: 'checked', score, threshold: CHARACTER_LIMITS.conformanceThreshold, meetsThreshold: score >= CHARACTER_LIMITS.conformanceThreshold,
    present, partial, missing: devices.length - present - partial, total: devices.length, devices,
    limitation: 'Checks that declared colours, part and cloth IDs, proportions, motion values, clip timings and tracks, effects, the light, the lines, the scene, the render style and the track literally occur in the saved character, and that imagery devices produced portraits that share colours with the figure. It does not measure visual quality, motion feel, likeness or player preference.' };
}

/** A bounded, deterministic description of a character for A/B distance. */
export function characterFingerprint(character, measures) {
  const clip = character.clips.signature;
  return {
    palette: measures.visibleColors.slice(0, 8).map(({ hex, share }) => ({ hex, share })),
    silhouette: { figureHeight: measures.figureHeight, headShare: measures.headShare, legShare: measures.legShare, aspect: measures.aspect, mask: measures.silhouette },
    motion: { walk: { ...character.motion.walk }, idle: { ...character.motion.idle }, turn: { ...character.motion.turn }, stride: measures.stride.legs },
    signature: clip ? { duration: clip.duration, kindleAt: clip.kindleAt, kindleShare: round(clip.kindleAt / clip.duration), tracks: Object.keys(clip.tracks).length,
      root: Boolean(clip.root), squash: Boolean(clip.squash), events: clip.events.length } : null,
    light: character.light ? { color: character.light.color, radius: character.light.radius, intensity: character.light.intensity, flicker: { ...character.light.flicker } } : null,
    effects: character.effects.map(effect => effect.kind).sort(),
    lines: { ...character.lines },
    world: worldFingerprint(character),
  };
}

/** The moment a character file sets: its scene colours, weather, beacons and mist, render style and track. A file without a scene draws the default. */
export function worldFingerprint(character) {
  const scene = completeScene(character.scene);
  return { declared: Boolean(character.scene || (character.render && character.render.preset !== 'lit') || character.music), colors: sceneColors(character.scene),
    sky: [...scene.sky], weather: { kind: scene.weather.kind, density: scene.weather.density }, towers: scene.towers, fog: scene.fog,
    render: character.render?.preset || 'lit', music: character.music?.track || null };
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'it', 'is', 'i', 'you', 'we', 'me', 'my', 'your', 'be', 'this', 'that', 'for', 'with', 'will', 'not', 'from', 'so', 'up', 'its', "it's", 'are', 'was', 'there', 'here', 'now', 'just', 'one', 'all']);
const words = lines => new Set(Object.values(lines || {}).join(' ').toLowerCase().match(/[a-z']+/gu)?.filter(word => word.length > 2 && !STOPWORDS.has(word)) || []);
const jaccard = (a, b) => { const union = new Set([...a, ...b]); return union.size ? [...a].filter(item => b.has(item)).length / union.size : 1; };

function paletteDistance(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length || !b.length) return 1;
  const directed = (from, to) => from.reduce((sum, color) => sum + color.share * Math.min(...to.map(other => deltaE(color.hex, other.hex))), 0) / (from.reduce((sum, color) => sum + color.share, 0) || 1);
  return Math.min(1, (directed(a, b) + directed(b, a)) / 2 / 50);
}
function maskOverlap(a, b) {
  let both = 0, either = 0;
  for (let row = 0; row < Math.min(a.length, b.length); row++) for (let col = 0; col < Math.min(a[row].length, b[row].length); col++) {
    const x = a[row][col] === '1', y = b[row][col] === '1';
    if (x && y) both++;
    if (x || y) either++;
  }
  return either ? both / either : 1;
}

export function compareCharacterFingerprints(a, b) {
  if (!plain(a) || !plain(b)) fail('fingerprints', 'Two character fingerprints are required.');
  const palette = paletteDistance(a.palette, b.palette);
  const sa = a.silhouette, sb = b.silhouette;
  const proportions = (Math.min(1, Math.abs(sa.figureHeight - sb.figureHeight) / ((sa.figureHeight + sb.figureHeight) / 2) / 0.4)
    + Math.min(1, Math.abs(sa.headShare - sb.headShare) / 0.2) + Math.min(1, Math.abs(sa.aspect - sb.aspect) / 0.4)) / 3;
  const silhouette = 0.6 * (1 - maskOverlap(sa.mask, sb.mask)) + 0.4 * proportions;
  const differences = [];
  for (const section of ['walk', 'idle']) for (const [key, [low, high]] of Object.entries(MOTION_RANGES[section])) differences.push(Math.abs(a.motion[section][key] - b.motion[section][key]) / (high - low));
  differences.push(a.motion.turn.style === b.motion.turn.style ? 0 : 1, Math.abs(a.motion.turn.duration - b.motion.turn.duration) / 0.6);
  const motion = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const signature = a.signature && b.signature ? (Math.min(1, Math.abs(a.signature.duration - b.signature.duration) / 4) + Math.abs(a.signature.kindleShare - b.signature.kindleShare)
    + Math.min(1, Math.abs(a.signature.tracks - b.signature.tracks) / 8) + (a.signature.root === b.signature.root ? 0 : 1) + (a.signature.squash === b.signature.squash ? 0 : 1)) / 5 : 1;
  const voice = 1 - jaccard(words(a.lines), words(b.lines));
  const light = a.light && b.light ? Math.min(1, deltaE(a.light.color, b.light.color) / 50) : 1;
  const character = 0.25 * palette + 0.25 * silhouette + 0.25 * motion + 0.1 * signature + 0.1 * voice + 0.05 * light;
  const method = 'Weighted heuristic: visible palette CIE76 distance (25%), silhouette outline overlap and proportions (25%), gait, idle and turn parameters by their ranges (25%), signature clip timing and structure (10%), shared content words of the four lines (10%) and light colour (5%).';
  // Earlier pairs drew one fixed world, so their distance is the character's alone; a pair with art direction adds the moment.
  const world = a.world && b.world && (a.world.declared || b.world.declared) ? worldDistance(a.world, b.world) : null;
  const overall = world ? 0.65 * character + 0.35 * world.overall : character;
  return { overall: round(overall), character: round(character), palette: round(palette), silhouette: round(silhouette), motion: round(motion), signature: round(signature), voice: round(voice), light: round(light),
    ...(world ? { world: round(world.overall), worldParts: Object.fromEntries(Object.entries(world).filter(([key]) => key !== 'overall').map(([key, value]) => [key, round(value)])) } : {}),
    method: world ? `65% the character and 35% the moment. Character: ${method.replace('Weighted heuristic: ', '')} Moment: scene colour CIE76 distance (30%), render style (25%), weather kind and density (15%), the music track (15%), the beacons' form (10%) and the mist (5%).` : method };
}

function worldDistance(a, b) {
  const palette = paletteDistance(a.colors.map(hex => ({ hex, share: 1 })), b.colors.map(hex => ({ hex, share: 1 })));
  const weather = a.weather.kind === b.weather.kind ? Math.min(1, Math.abs(a.weather.density - b.weather.density) / 0.6) * 0.5 : 1;
  const towers = a.towers === b.towers ? 0 : 1, fog = Math.min(1, Math.abs(a.fog - b.fog)), render = a.render === b.render ? 0 : 1, music = a.music === b.music ? 0 : 1;
  return { overall: 0.3 * palette + 0.25 * render + 0.15 * weather + 0.15 * music + 0.1 * towers + 0.05 * fog, palette, render, weather, music, towers, fog };
}

/**
 * How far a saved character moved from its run's own frozen sketch. Each run carries its counterfactual, so
 * ordinary run-to-run variance does not enter this measure.
 */
export function characterSketchDivergence(sketch, character, measures) {
  if (!plain(sketch)) return null;
  const share = (part, whole) => (whole ? round(part / whole) : 0);
  const colors = measures.visibleColors.slice(0, 8).map(item => item.hex);
  const newColors = colors.filter(hex => Math.min(...sketch.palette.map(color => deltaE(hex, color))) >= CHARACTER_LIMITS.sketchDeltaE);
  const heightShift = Math.abs(measures.figureHeight - sketch.height) / sketch.height, headShift = Math.abs(measures.headShare - sketch.headShare);
  const ids = new Set([...character.parts.map(part => part.id), ...character.cloth.map(chain => chain.id)]);
  const kept = sketch.elements.filter(id => ids.has(id));
  const gait = Object.entries(SKETCH_GAIT).filter(([key, param]) => {
    const value = param === 'turn.style' ? character.motion.turn.style : character.motion.walk[param.slice(5)];
    return param === 'turn.style' ? value !== sketch.gait.turnStyle : Math.abs(value - sketch.gait[key]) >= GAIT_THRESHOLDS[param];
  }).map(([, param]) => param);
  const palette = share(newColors.length, colors.length);
  const proportions = round(Math.min(1, Math.max(heightShift / (2 * CHARACTER_LIMITS.heightShift), headShift / (2 * CHARACTER_LIMITS.headShift))));
  const elements = share(sketch.elements.length - kept.length, sketch.elements.length);
  const motion = share(gait.length, Object.keys(SKETCH_GAIT).length);
  const score = round((palette + proportions + elements + motion) / 4);
  // The moment against the sketch's: scene colours far from every sketched scene colour, and the weather, beacons,
  // render style and track that changed. The character's own score keeps its earlier meaning.
  let world = null;
  if (sketchHasWorld(sketch)) {
    const painted = sceneColors(character.scene), planned = sketchSceneColors(sketch), scene = completeScene(character.scene);
    const moved = { weather: sketch.scene ? scene.weather.kind !== sketch.scene.weather : null, towers: sketch.scene ? scene.towers !== sketch.scene.towers : null,
      render: sketch.render ? (character.render?.preset || 'lit') !== sketch.render : null, music: sketch.music ? (character.music?.track || null) !== sketch.music : null };
    const sceneShare = planned.length ? share(painted.filter(hex => farFrom(hex, planned)).length, painted.length) : null;
    const parts = [sceneShare, ...Object.values(moved).map(value => (value === null ? null : Number(value)))].filter(value => value !== null);
    world = { palette: sceneShare, ...moved, score: parts.length ? round(parts.reduce((sum, value) => sum + value, 0) / parts.length) : 0,
      sketch: { scene: sketch.scene || null, render: sketch.render || null, music: sketch.music || null },
      character: { sky: scene.sky, weather: scene.weather.kind, towers: scene.towers, render: character.render?.preset || 'lit', music: character.music?.track || null } };
  }
  return { palette, proportions, elements, motion, score, ...(world ? { world, combined: round(0.65 * score + 0.35 * world.score) } : {}),
    colors: { character: colors, new: newColors }, figure: { sketchHeight: sketch.height, height: measures.figureHeight, sketchHeadShare: sketch.headShare, headShare: measures.headShare },
    planned: { elements: sketch.elements, kept, dropped: sketch.elements.filter(id => !ids.has(id)) }, gait: { moved: gait },
    light: { sketch: sketch.light, character: character.light?.color ?? null, moved: Boolean(character.light) && deltaE(character.light.color, sketch.light) >= CHARACTER_LIMITS.sketchDeltaE },
    method: `Shares of the character's eight most visible colours at least CIE76 ${CHARACTER_LIMITS.sketchDeltaE} from every sketch colour, of the sketch's planned elements the character does not draw, and of the sketch's five gait choices that moved past their thresholds, with a proportion score that reaches 1 at twice the departure threshold; the score is their mean.` };
}

/** What two measured taste inputs have in common: the names of their qualities and art styles, and of their works. */
export function profileOverlap(a, b) {
  const names = (input, derived) => new Set((input?.entities || []).filter(entity => entity.source === 'qloo' && (derived ? [QUALITY_DOMAIN, ART_STYLE_DOMAIN].includes(entity.domain) : !isQualityDomain(entity.domain)))
    .map(entity => normalizeTasteName(entity.name)));
  const part = derived => {
    const left = names(a, derived), right = names(b, derived);
    const display = new Map();
    for (const entity of [...(a?.entities || []), ...(b?.entities || [])]) if (!display.has(normalizeTasteName(entity.name))) display.set(normalizeTasteName(entity.name), entity.name);
    const shared = [...left].filter(name => right.has(name)).map(name => display.get(name));
    return { shared, total: new Set([...left, ...right]).size };
  };
  return { qualities: part(true), works: part(false) };
}

/** Where a run's render style came from: the anchor that named it, with the works Qloo returned it on. */
function renderSource(arm) {
  const device = (arm.dna?.devices || []).find(item => item.layer === 'render');
  const entity = device?.presetFrom ? (arm.input?.entities || []).find(item => item.ref === device.presetFrom) : null;
  return entity ? { ref: entity.ref, name: entity.name, source: entity.source, domain: entity.domain, ...(Number.isInteger(entity.count) ? { works: entity.count } : {}),
    ...(Array.isArray(entity.examples) ? { examples: entity.examples.slice(0, 3) } : {}), ...(entity.source === 'qloo' ? { surprise: Boolean(entity.surprise) } : {}) } : null;
}
const momentText = world => `${RENDER_PRESETS[world.render]?.label.toLowerCase() || world.render} style with ${world.weather.kind === 'none' ? 'clear air' : world.weather.kind} and ${world.towers} beacons`;
const renderText = (label, from) => (from ? `${label}'s from ${from.source === 'qloo' ? `the measured art style ${from.name}${from.examples?.length ? `, which Qloo returned on ${from.examples.join(', ')}` : ''}` : `its own predicted ${from.domain === ART_STYLE_DOMAIN ? 'art style' : 'quality'} ${from.name}`}` : `${label} chose its render style freely`);

/**
 * Single-pair comparison; repeated pairs are required to compare against baseline-to-baseline variance. `labels` names
 * the two arms in the headlines: Qloo off and Qloo on, or two measured profiles in a swap pair.
 */
export function compareCharacterRuns({ baseline, qloo, labels = { baseline: 'Qloo off', qloo: 'Qloo on' } }) {
  const fingerprints = { baseline: characterFingerprint(baseline.character, baseline.measures), qloo: characterFingerprint(qloo.character, qloo.measures) };
  const distance = compareCharacterFingerprints(fingerprints.baseline, fingerprints.qloo);
  const qlooStats = qloo.dna && qloo.input ? characterDnaStats(qloo.dna, qloo.input) : null;
  const baselineStats = baseline.dna && baseline.input ? characterDnaStats(baseline.dna, baseline.input) : null;
  const prediction = qloo.input?.metrics || null;
  const percent = value => `${Math.round(value * 100)}%`;
  const qualities = (qloo.input?.entities || []).filter(entity => entity.domain === QUALITY_DOMAIN && entity.source === 'qloo');
  const worlds = { baseline: fingerprints.baseline.world, qloo: fingerprints.qloo.world };
  const art = Boolean(worlds.baseline.declared || worlds.qloo.declared);
  const sources = { baseline: renderSource(baseline), qloo: renderSource(qloo) };
  const moment = art ? { world: { baseline: { ...worlds.baseline, renderFrom: sources.baseline }, qloo: { ...worlds.qloo, renderFrom: sources.qloo } },
    worldHeadline: `${labels.qloo} sets the moment in the ${momentText(worlds.qloo)}; ${labels.baseline} in the ${momentText(worlds.baseline)}. The moment's distance is ${distance.world ?? 0}.`,
    renderHeadline: `${renderText(labels.qloo, sources.qloo).replace(/^(.*?)'s from/u, '$1\'s render style comes from')}; ${renderText(labels.baseline, sources.baseline)}.` } : {};
  // In a swap pair both arms are measured: the baseline read this brief's profile and the other arm another one.
  const measuredBaseline = baseline.input?.source === 'qloo-profile';
  const data = measuredBaseline && qloo.input ? profileOverlap(baseline.input, qloo.input) : null;
  return { schemaVersion: TASTE_SCHEMA_VERSION, computedAt: new Date().toISOString(), distance, fingerprints, labels, ...moment,
    qloo: { ...(qlooStats || {}), conformance: qloo.conformance?.score ?? null, prediction, sketch: qloo.divergence ?? null },
    baseline: { ...(baselineStats || {}), conformance: baseline.conformance?.score ?? null, sketch: baseline.divergence ?? null, ...(measuredBaseline ? { prediction: baseline.input?.metrics || null } : {}) },
    headline: qlooStats ? `${qlooStats.surpriseAnchoredDevices} of ${qlooStats.devices} character devices in the ${labels.qloo} design rest on entities, tags or qualities the model did not predict.${measuredBaseline && baselineStats ? ` In the ${labels.baseline} design, ${baselineStats.surpriseAnchoredDevices} of ${baselineStats.devices} do.` : ''}` : 'No Qloo character specification was recorded.',
    ...(qlooStats && qualities.length ? { qualityHeadline: `${qlooStats.qualityAnchoredDevices} of ${qlooStats.devices} ${labels.qloo} devices translate measured qualities: the ${qualities.length} look, mood and meaning tags the audience's works share, or its ranked style and aesthetic tags. ${measuredBaseline ? `${labels.baseline} translated the measured qualities of its own profile` : `${labels.baseline} translated its own predicted qualities`} in ${baselineStats?.qualityAnchoredDevices ?? 0} of ${baselineStats?.devices ?? 0}.` } : {}),
    ...(data ? { data, dataHeadline: `The two profiles share ${data.qualities.shared.length} of ${data.qualities.total} measured qualities and art styles${data.qualities.shared.length ? ` (${data.qualities.shared.slice(0, 4).join(', ')})` : ''} and ${data.works.shared.length} of ${data.works.total} measured works, ${data.qualities.shared.length === data.qualities.total && data.works.shared.length === data.works.total ? 'so both arms read the same data under one brief.' : 'so the arms read different data under one brief.'}` } : {}),
    detail: prediction ? `The model predicted ${prediction.predictedByModel} of ${prediction.measuredEntities} measured entities before seeing them; ${prediction.surprises} were new to it.${prediction.measuredQualities ? ` Of ${prediction.measuredQualities} shared qualities, ${prediction.qualitySurprises} were not in its prediction.` : ''}` : '',
    ...(qloo.divergence && baseline.divergence ? { sketchHeadline: `Against each run's own frozen sketch, the ${labels.qloo} character moved ${percent(qloo.divergence.score)} of its palette, proportions, planned elements and gait; the ${labels.baseline} character moved ${percent(baseline.divergence.score)}.${qloo.divergence.world && baseline.divergence.world ? ` Its moment moved ${percent(qloo.divergence.world.score)} of the sketched scene colours, weather, beacons, render style and track; ${labels.baseline}'s moved ${percent(baseline.divergence.world.score)}.` : ''}` } : {}),
    ...(qloo.dna?.rules?.departure === false ? { ablation: 'departure' } : {}),
    limitation: `One pair. Character distance is a heuristic over tokens, outline and motion parameters, not a perceptual or quality measure. Compare repeated Qloo-to-baseline distances with baseline-to-baseline distances before claiming the difference exceeds model variance. ${qloo.dna?.rules?.departure === false
      ? 'The departure rule was off in this pair, so any departure from the sketch is the data\'s own effect under the other rules, not a required one.'
      : 'Departure from the sketch is required of surprise-anchored devices, so it shows what measured data changed under this protocol, not an unprompted effect.'}` };
}

export { isTagDomain, isQualityDomain, QUALITY_DOMAIN, ART_STYLE_DOMAIN };
