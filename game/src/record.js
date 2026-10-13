// The design record under the comparison, read from runs/<id>/pair.json as the pair runner wrote it: what each arm
// sketched blind, the taste input it then designed from, how far the saved character moved from that sketch, and
// every DNA device with the anchors it rests on. The page formats the record; it computes nothing new. Every text
// in the record is model or host output, so it is only ever set as text, never parsed as markup.

import { RENDER_PRESETS } from './scene.js';

const PAIR_ID = /^[a-z0-9-]{1,60}$/u;
const IMAGE = /^runs\/[a-z0-9-]+\/[a-z0-9-]+\.(?:jpg|png|webp)$/u;
const LAYERS = [['palette', 'Palette'], ['silhouette', 'Silhouette'], ['costume', 'Costume'], ['motion', 'Motion'], ['signature', 'Signature move'],
  ['light', 'Carried light'], ['voice', 'Voice'], ['imagery', 'Portrait'], ['scene', 'The moment'], ['render', 'Render style'], ['music', 'Music']];
const DOMAINS = { brand: 'Brand', movie: 'Film', artist: 'Artist', book: 'Book', tv_show: 'TV show', videogame: 'Video game', podcast: 'Podcast',
  place: 'Place', destination: 'Destination', person: 'Person', style: 'Style tag', aesthetic: 'Aesthetic tag', qualities: 'Shared quality', art_style: 'Art style' };
const styleName = preset => RENDER_PRESETS[preset]?.label.toLowerCase() || preset || 'lit dusk';
const weatherName = kind => (kind === 'none' ? 'clear air' : kind);
const FAMILIES = [['look', 'Look'], ['mood', 'Mood'], ['meaning', 'Meaning']];
const GAIT = { 'walk.cadence': 'cadence', 'walk.bounciness': 'bounce', 'walk.lean': 'lean', 'walk.armSwing': 'arm swing', 'turn.style': 'turning' };
const MOTION = {
  'walk.speed': v => `speed ${v} units a second`, 'walk.cadence': v => `${v} steps a second`, 'walk.stepHeight': v => `step height ${v}`,
  'walk.bob': v => `bob ${v}`, 'walk.bounciness': v => `bounce ${v}`, 'walk.lean': v => `lean ${v}°`, 'walk.armSwing': v => `arm swing ${v}°`,
  'walk.elbowBend': v => `elbow bend ${v}°`, 'walk.hipSway': v => `hip sway ${v}°`, 'walk.headStabilize': v => `head steadiness ${v}`,
  'walk.squash': v => `squash ${v}`, 'walk.accel': v => `${v} s to full speed`, 'idle.breathRate': v => `${v} breaths a minute`,
  'idle.breathDepth': v => `breath depth ${v}`, 'idle.sway': v => `idle sway ${v}`, 'idle.weightShift': v => `weight shift ${v}`,
  'idle.lookAround': v => `looks around ${v}`, 'idle.blinkInterval': v => `blinks every ${v} s`, 'idle.stance': v => `stance ${v}`,
  'turn.style': v => `turns by ${v}`, 'turn.duration': v => `turns in ${v} s`,
};
const MISSING = { color: 'colour', part: 'part', height: 'height', headShare: 'head share', motion: '', clip: 'clip', effect: 'effect', light: 'light', line: 'line', portrait: 'portrait for',
  'portrait-colors': 'portrait colours of', sky: 'sky colour', 'scene-color': 'scene colour', weather: 'weather', towers: 'beacons', fog: 'mist', render: 'render style', music: 'track' };
// How each production method makes a device, in the words of the record.
const METHODS = { 'vector-rig': 'drawn as vector parts on the rig', 'painted-rig': 'painted as finished game art', portrait: 'a painted portrait', 'rig-motion': 'motion and clips on the rig',
  lines: 'written lines', 'engine-scene': 'set in the engine\'s moment', 'library-track': 'a track from the open library' };
const VIEWS = { pose: 'the figure at rest, with its 60-pixel silhouette', walk: 'six frames of the walk', scene: 'the moment as a player sees it', kindle: 'the kindling move' };
const VERDICTS = { met: 'Met', partly: 'Partly met', missed: 'Missed' };
const CAPTURE = /^runs\/[a-z0-9-]+\/[a-z0-9-]+-review-r[1-3]-(?:pose|walk|scene|kindle)\.png$/u;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const append = (parent, ...children) => { parent.append(...children.filter(child => child !== null && child !== undefined && child !== false && child !== '')); return parent; };
const join = items => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const percent = value => `${Math.round(value * 100)}%`;
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const duration = ms => !ms || ms < 1000 ? 'under a second' : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
const clipText = (value, max = 70) => value.length > max ? `“${value.slice(0, max - 1)}…”` : value;
/** A bone key such as upperArmFront in plain words: front upper arm. */
const boneName = key => {
  const [, base, side] = /^(.*?)(Front|Back)?$/u.exec(key);
  const words = base.replace(/([A-Z])/gu, ' $1').toLowerCase();
  return side ? `${side.toLowerCase()} ${words}` : words;
};

export class PairError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'PairError';
    this.hint = hint;
  }
}

export async function loadPair(id) {
  if (!PAIR_ID.test(id)) throw new PairError('The pair ID in the address is not valid.', 'Use the ID the pair runner printed, such as compare.html?pair=dry-run.');
  const response = await fetch(`runs/${id}/pair.json`, { cache: 'no-store' });
  if (!response.ok) throw new PairError(`runs/${id}/pair.json could not be loaded (HTTP ${response.status}).`, 'Run node game/harness/run-pair.mjs --dry-run, or check the pair ID in the address.');
  const pair = await response.json();
  if (pair?.schemaVersion !== '1.0' || !Array.isArray(pair.arms) || pair.arms.length !== 2 || !pair.brief) throw new PairError(`runs/${id}/pair.json is not a pair record.`, 'Write it again with game/harness/run-pair.mjs.');
  if (pair.status !== 'completed') throw new PairError(`This pair did not complete: ${pair.error || 'an arm stopped before saving a character.'}`, 'Its record and work files stay in game/runs for review; start a new pair once the cause is fixed.');
  return pair;
}

function swatch(hex) {
  const node = element('span', 'swatch');
  node.style.background = hex;
  return node;
}
const colorChip = (hex, label = '') => append(element('span', 'color'), label && `${label} `, swatch(hex), hex);
const chipGroup = hexes => append(element('span', 'chips'), ...hexes.map(hex => colorChip(hex)));

function provenance(anchor) {
  const status = anchor.surprise ? ['surprise', 'not predicted'] : anchor.predictedByModel ? ['confirmed', 'also predicted'] : ['brief', 'named in the brief'];
  if (anchor.domain === 'art_style') {
    // An art style says which render style its name names: "Art style on 5 measured works, names the ink and paper style".
    const names = anchor.preset ? `, names the ${styleName(anchor.preset)} style` : '';
    if (anchor.source !== 'qloo') return ['own', `Art style from its own prediction${names}`];
    return [status[0], `Art style on ${count(anchor.count ?? 0, 'measured work')}${names}, ${status[1]}`];
  }
  if (anchor.domain === 'qualities') {
    if (anchor.source !== 'qloo') return ['own', 'Quality from its own prediction'];
    // A shared quality says how widely the measured works carry it: "Look quality shared by 5 measured works in 4 domains".
    const family = FAMILIES.find(([key]) => key === anchor.family)?.[1] || 'Shared';
    return [status[0], `${family} quality shared by ${count(anchor.count ?? 0, 'measured work')}${anchor.domains?.length ? ` in ${count(anchor.domains.length, 'domain')}` : ''}, ${status[1]}`];
  }
  const domain = DOMAINS[anchor.domain] || anchor.domain || 'Entity';
  if (anchor.source !== 'qloo') return ['own', `${domain} from its own prediction`];
  return [status[0], `${domain} measured by Qloo, ${status[1]}`];
}

function anchorList(anchors) {
  const list = element('ul', 'anchors');
  for (const anchor of anchors) {
    const [kind, text] = provenance(anchor);
    list.append(append(element('li', `anchor anchor--${kind}`, anchor.name || anchor.ref), element('small', '', text)));
  }
  return list;
}

function barItem(label, value, valueText, detail = null) {
  const bar = element('span', 'bar');
  bar.setAttribute('aria-hidden', 'true');
  const fill = element('span');
  fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  bar.append(fill);
  return append(element('li'), element('span', 'bar-label', label), bar, element('span', 'bar-value', valueText), detail && append(element('span', 'bar-detail'), ...detail));
}

const empty = text => element('p', 'ledger-empty', text);

function factList(entries) {
  const facts = element('dl', 'cell-facts');
  for (const [term, value] of entries) if (value) facts.append(element('dt', '', term), element('dd', '', value));
  return facts;
}

function sketchCell(arm) {
  const sketch = arm.sketch;
  if (!sketch) return [empty('No sketch was saved before the taste input.')];
  const { cadence, bounciness, lean, armSwing, turnStyle } = sketch.gait;
  const metrics = arm.taste?.metrics;
  const palette = append(element('p', 'cell-palette'), ...sketch.palette.map(hex => colorChip(hex)), sketch.light && colorChip(sketch.light, 'light'));
  // The moment it would have set the character in, when the run designed the scene too.
  const scene = sketch.scene ? append(element('p', 'cell-palette'), 'Scene ', ...[...sketch.scene.sky, ...sketch.scene.palette].map(hex => colorChip(hex))) : null;
  const moment = sketch.scene || sketch.render ? [sketch.render && `${styleName(sketch.render)} style`, sketch.scene && weatherName(sketch.scene.weather), sketch.scene && `${sketch.scene.towers} beacons`,
    sketch.music && `the track ${sketch.music}`].filter(Boolean).join('; ') : null;
  const predicted = metrics ? (metrics.tagPredictions || 0) + (metrics.qualityPredictions || 0) + (metrics.artStylePredictions || 0) : 0;
  return [element('p', 'cell-quote', sketch.summary), palette, scene, factList([
    ['Figure', `${sketch.height} units tall, the head ${percent(sketch.headShare)} of it`],
    ['Planned', join(sketch.elements)],
    ['Gait', `${cadence} steps a second, bounce ${bounciness}, lean ${lean}°, arm swing ${armSwing}°, turns by ${turnStyle}`],
    ['Voice', sketch.voice],
    ['Motifs', sketch.motifs?.length ? join(sketch.motifs) : null],
    ['Moment', moment],
    ['Prediction', metrics ? `${count(metrics.predictions, 'entity', 'entities')} and ${count(predicted, 'quality', 'qualities')} it expected this audience to like` : null],
  ])];
}

/** The qualities a run designed from, by family for measured ones: each with how many works share it, ✦ for a surprise. */
function qualityList(items, measured) {
  const list = element('ul', 'qualities');
  const name = item => `${item.name}${measured && item.surprise ? ' ✦' : ''}`;
  if (!measured) {
    list.append(append(element('li'), element('span', 'quality-family', 'Predicted'), element('span', 'quality-names', join(items.map(name)))));
    return list;
  }
  for (const [family, label] of FAMILIES) {
    const group = items.filter(item => item.family === family);
    if (group.length) list.append(append(element('li'), element('span', 'quality-family', label), element('span', 'quality-names', join(group.map(item => `${name(item)} (${item.count})`)))));
  }
  return list;
}

function tasteCell(arm) {
  const taste = arm.taste;
  if (!taste) return [empty('The run never read its taste input.')];
  const m = taste.metrics || {};
  const measured = taste.source === 'qloo-profile';
  const qualities = taste.qualities || [], tags = taste.tags || [];
  const texts = measured ? [
    `Measured Qloo taste data: ${count(m.measuredEntities, 'entity', 'entities')} and ${count(m.measuredTags ?? 0, 'style or aesthetic tag', 'style and aesthetic tags')}, revealed after the sketch was frozen.`,
    `${m.surprises} of the ${m.measuredEntities} entities and ${m.tagSurprises ?? 0} of the ${m.measuredTags ?? 0} tags were not in its prediction${m.knownFromBrief ? `, and ${m.knownFromBrief} were named in the brief` : ''}.`,
    ...(m.measuredQualities !== undefined ? [`${count(m.measuredQualities, 'quality', 'qualities')} are shared by two or more measured works; ${m.qualitySurprises} of them were not in its prediction.`] : []),
    ...(m.measuredArtStyles !== undefined ? [`${count(m.measuredArtStyles, 'art style')} came back on the measured works; ${m.artStyleSurprises} of them were not in its prediction.`] : []),
  ] : [`Its own prediction: the ${count(m.predictions, 'entity', 'entities')} and ${count((m.tagPredictions || 0) + (m.qualityPredictions || 0) + (m.artStylePredictions || 0), 'quality', 'qualities')} it had just guessed for this audience. No measured data.`];
  const shared = qualities.length ? [element('p', 'cell-label', measured ? 'Shared qualities, with the number of works that carry each (✦ not predicted)' : 'Qualities it predicted the audience\'s works share'), qualityList(qualities, measured)] : [];
  const ranked = measured && tags.length ? [element('p', 'cell-text', `Ranked tags: ${join(tags.map(tag => `${tag.name}${tag.surprise ? ' ✦' : ''}`))}.`)] : [];
  // Art styles with the render style each names; the strongest one is required on the render device.
  const styles = taste.artStyles || [];
  const lead = taste.renderStyles?.[0];
  const art = styles.length ? [element('p', 'cell-text', `${measured ? 'Art styles on its works' : 'Art styles it predicted'}: ${join(styles.map(style => `${style.name}${measured && style.surprise ? ' ✦' : ''}${measured && style.count ? ` (${style.count})` : ''}${style.preset ? `, ${styleName(style.preset)}` : ''}`))}.${lead ? ` The strongest, ${lead.name}, draws the frame in ${styleName(lead.preset)} unless the DNA sets it aside with a reason.` : ''}`)] : [];
  return [...texts.map(text => element('p', 'cell-text', text)), ...shared, ...ranked, ...art,
    element('p', 'cell-label', 'Required anchors, each used by a device or set aside with a reason'), anchorList(taste.requiredAnchors || [])];
}

function departureCell(arm) {
  const d = arm.divergence;
  if (!d) return [empty('Not measured: this arm saved no valid character.')];
  const { figure, planned, gait, colors, light } = d;
  const paletteDetail = colors.new.length ? [`${colors.new.length} of its ${colors.character.length} most visible colours are new: `, chipGroup(colors.new)] : ['Its most visible colours stay within the sketch palette.'];
  const elementsDetail = !planned.dropped.length ? `Kept all ${planned.elements.length} planned elements.`
    : planned.kept.length ? `Kept ${join(planned.kept)}; dropped ${join(planned.dropped)}.` : `Dropped every planned element: ${join(planned.dropped)}.`;
  const bars = append(element('ul', 'bars bars--detail'),
    barItem('Palette', d.palette, percent(d.palette), paletteDetail),
    barItem('Proportions', d.proportions, percent(d.proportions), [`From ${figure.sketchHeight} to ${figure.height} units tall, head share from ${figure.sketchHeadShare} to ${figure.headShare}.`]),
    barItem('Planned elements', d.elements, percent(d.elements), [elementsDetail]),
    barItem('Gait', d.motion, percent(d.motion), [gait.moved.length ? `Moved its ${join(gait.moved.map(param => GAIT[param] || param))}.` : 'Kept the sketched gait.']));
  const lightText = !light ? null : light.moved
    ? append(element('p', 'cell-text'), 'Light from ', colorChip(light.sketch), ' to ', light.character ? colorChip(light.character) : 'none', '.')
    : append(element('p', 'cell-text'), 'Kept the sketched light ', colorChip(light.sketch), '.');
  return [element('p', 'cell-score', `Moved ${percent(d.score)} from its sketch`), bars, lightText, ...momentDeparture(d.world)];
}

/** How far the moment moved from the sketched one: its scene colours, weather, beacons, render style and track. */
function momentDeparture(world) {
  if (!world) return [];
  const { sketch, character } = world;
  const change = (moved, before, after) => (moved === null || moved === undefined ? null : moved ? `${before} to ${after}` : `kept ${after}`);
  return [element('p', 'cell-score cell-score--moment', `Its moment moved ${percent(world.score)}`), factList([
    ['Scene colours', world.palette === null ? null : `${percent(world.palette)} of the scene's colours lie far from every sketched scene colour`],
    ['Weather', change(world.weather, weatherName(sketch.scene?.weather), weatherName(character.weather))],
    ['Beacons', change(world.towers, sketch.scene?.towers, character.towers)],
    ['Render style', change(world.render, styleName(sketch.render), styleName(character.render))],
    ['Track', change(world.music, sketch.music, character.music)],
  ])];
}

function thesisCell(arm) {
  const dna = arm.dna;
  if (!dna) return [empty('No valid DNA was saved.')];
  const s = dna.stats, c = arm.conformance;
  const confirmed = s.qlooAnchoredDevices - s.surpriseAnchoredDevices;
  const anchored = s.qlooAnchoredDevices
    ? `${s.surpriseAnchoredDevices} of its ${s.devices} devices rest on measured entities, tags or qualities it did not predict${confirmed ? `; ${confirmed} on measured ones it also predicted or found in the brief` : ''}.`
    : `All ${s.devices} devices rest on its own prediction.`;
  const translated = Number.isInteger(s.qualityAnchoredDevices) && s.qualityAnchoredDevices
    ? `${s.qualityAnchoredDevices} translate ${s.qlooAnchoredDevices ? 'measured' : 'its own predicted'} qualities.` : '';
  return [element('p', 'cell-quote', dna.thesis), element('p', 'cell-text', `${anchored}${translated ? ` ${translated}` : ''}`),
    c && element('p', 'cell-text', `Conformance ${percent(c.score)}: ${c.present} of ${c.total} devices found in full in the character file${c.partial ? `, ${c.partial} in part` : ''}.`)];
}

function tokenList(tokens, arm = null) {
  const list = element('ul', 'tokens');
  list.setAttribute('aria-label', 'Declared for the character file');
  const item = (...children) => list.append(append(element('li'), ...children));
  if (tokens.scene) {
    const scene = tokens.scene;
    if (scene.sky) item('sky ', chipGroup(scene.sky));
    if (scene.colors?.length) item('scene ', chipGroup(scene.colors));
    const words = [scene.weather && weatherName(scene.weather), scene.towers && `${scene.towers} beacons`, scene.fog !== undefined && `mist ${scene.fog}`].filter(Boolean);
    if (words.length) item(words.join(', '));
  }
  if (tokens.render) item(`drawn in ${styleName(tokens.render)}`);
  if (tokens.music) item(arm?.music?.id === tokens.music ? `the track “${arm.music.title}” by ${arm.music.artist}` : `the track ${tokens.music}`);
  if (tokens.colors?.length) item(chipGroup(tokens.colors));
  if (tokens.proportions) item([tokens.proportions.height !== undefined && `${tokens.proportions.height} units tall`, tokens.proportions.headShare !== undefined && `head share ${tokens.proportions.headShare}`].filter(Boolean).join(', '));
  if (tokens.parts?.length) item(`${tokens.parts.length === 1 ? 'part' : 'parts'} ${join(tokens.parts)}`);
  if (tokens.motion?.length) item(tokens.motion.map(({ param, value }) => (MOTION[param] || (v => `${param} ${v}`))(value)).join(', '));
  for (const clip of tokens.clips || []) {
    item([`${clip.name} clip`, clip.duration !== undefined && `${clip.duration} s long`, clip.kindleAt !== undefined && `kindles at ${clip.kindleAt} s`,
      clip.tracks?.length && `moves the ${join(clip.tracks.map(boneName))}`, clip.root && 'with root motion', clip.squash && 'with squash'].filter(Boolean).join(', '));
  }
  if (tokens.effects?.length) item(`${tokens.effects.length === 1 ? 'effect' : 'effects'} ${join(tokens.effects)}`);
  if (tokens.light) item(colorChip(tokens.light.color), tokens.light.radius !== undefined && `, radius ${tokens.light.radius}`);
  for (const line of tokens.lines || []) item(element('q', '', line));
  return list.children.length ? list : null;
}

function checkText(check) {
  if (check.status === 'present') return 'Found in the character file.';
  const items = check.missing.map(item => [MISSING[item.kind] ?? item.kind, clipText(String(item.value))].filter(Boolean).join(' ') + (item.detail ? ` (${item.detail})` : ''));
  return `${check.status === 'partial' ? 'Partly found in the character file' : 'Not found in the character file'}. Missing: ${items.join('; ')}.`;
}

function portraitFigure(item, className, caption = item.subject) {
  if (item.status !== 'generated' || !IMAGE.test(item.path || '')) {
    return element('p', 'device-check device-check--missing', `A portrait was requested but not painted${item.error ? `: ${item.error}` : '.'}`);
  }
  const image = element('img');
  image.src = item.path;
  image.alt = `Portrait: ${item.subject}`;
  image.decoding = 'async';
  if (item.width && item.height) { image.width = item.width; image.height = item.height; }
  return append(element('figure', className), image, element('figcaption', '', caption));
}

function deviceBlock(device, arm) {
  const block = element('article', 'device');
  const measured = device.anchors.some(anchor => anchor.source === 'qloo');
  const check = arm.conformance?.devices.find(item => item.id === device.id);
  // A render style follows the anchor that names it, and a track the device's qualities its own tags carry.
  const named = device.presetFrom && device.anchors.find(anchor => anchor.ref === device.presetFrom);
  const chosen = device.layer === 'render' && named ? `Its anchor ${named.name} names the ${styleName(named.preset || device.tokens.render)} style, so the frame had to be drawn in it.`
    : device.layer === 'music' && device.moods?.length ? `The track's own catalogue tags carry ${join(device.moods)}.` : '';
  append(block, element('h5', 'device-name', device.device), anchorList(device.anchors),
    device.qualities.length && element('p', 'device-qualities', `${measured ? 'Returned tags' : 'Assumed qualities'}: ${join(device.qualities)}`),
    chosen && element('p', 'device-qualities', chosen),
    element('p', 'device-translation', device.translation), tokenList(device.tokens, arm),
    check && element('p', `device-check device-check--${check.status}`, checkText(check)));
  if (device.layer === 'imagery') block.append(...(arm.portraits || []).filter(item => item.device === device.id).map(item => portraitFigure(item, 'device-portrait')));
  return block;
}

function layerCell(arm, layer) {
  const devices = (arm.dna?.devices || []).filter(device => device.layer === layer);
  if (!devices.length) return [empty(arm.dna ? 'No device on this layer.' : 'No valid DNA was saved.')];
  return devices.map(device => deviceBlock(device, arm));
}

function paintCell(arm) {
  const paint = arm.paint;
  if (!paint) return [empty('This run was not painted.')];
  const facts = element('dl', 'cell-facts');
  const fact = (term, value) => facts.append(element('dt', '', term), element('dd', '', value));
  fact('Technique', `${styleName(paint.technique)}, the render style's own`);
  fact('Style', paint.style);
  const described = Object.entries(paint.descriptions || {});
  if (described.length) fact('Pieces described', `${described.length}: ${described.slice(0, 3).map(([, text]) => text).join('; ')}${described.length > 3 ? '; …' : ''}`);
  fact('Outcome', paint.status === 'painted' ? `${count(paint.pieces, 'piece')} painted${paint.vector?.length ? `; ${join(paint.vector)} stayed vectors` : ''}${paint.moved?.length ? `; ${join(paint.moved)} moved back to their joints` : ''}.`
    : `Not painted${paint.error ? `: ${paint.error}` : '.'} The vector drawing plays.`);
  return [facts];
}

function rejectedCell(arm) {
  const rejected = arm.dna?.rejected || [];
  if (!rejected.length) return [empty('Every required anchor went into a device.')];
  const list = element('ul', 'rejected');
  for (const item of rejected) list.append(append(element('li'), element('span', 'rejected-name', item.name || item.ref), element('span', '', item.reason)));
  return [list];
}

const refNames = refs => join(refs.map(ref => `${ref.name || ref.ref}${ref.surprise ? ' ✦' : ''}`));
const deviceName = (arm, id) => arm.dna?.devices.find(device => device.id === id)?.device || id;

/** The arm's own reading of its taste input, before its DNA: the clusters it gathered, what it set aside and why. */
function readingCell(arm) {
  const reading = arm.production?.reading;
  if (!reading) return [empty('No reading was saved before the DNA.')];
  const clusters = element('ul', 'clusters');
  for (const cluster of reading.clusters) {
    clusters.append(append(element('li', 'cluster'), element('h5', 'device-name', cluster.name), element('p', 'device-translation', cluster.reading),
      element('p', 'device-qualities', `Gathers ${refNames(cluster.refs)}; carries the ${join(cluster.layers)}.`)));
  }
  const aside = reading.setAside.length ? [element('p', 'cell-label', 'Set aside as noise'), append(element('ul', 'rejected'),
    ...reading.setAside.map(item => append(element('li'), element('span', 'rejected-name', item.name || item.ref), element('span', '', item.reason))))] : [];
  return [element('p', 'cell-quote', reading.approach), clusters, ...aside];
}

/** How the arm planned to make each device, chosen from the capability list both arms read, and what its review would look for. */
function planCell(arm) {
  const plan = arm.production?.plan;
  if (!plan) return [empty('No production plan was saved.')];
  const clusters = new Map((arm.production.reading?.clusters || []).map(cluster => [cluster.id, cluster.name]));
  const steps = element('ul', 'plan-steps');
  for (const step of plan.steps) {
    const how = `${METHODS[step.method] || step.method}${step.count ? `, ${count(step.count, 'picture')}, falling back to ${METHODS[step.fallback] || step.fallback}` : ''}`;
    steps.append(append(element('li'), append(element('p', 'plan-step'), element('strong', '', deviceName(arm, step.device)), ` (${step.layer}): ${how}`),
      element('small', '', `Realizes ${clusters.get(step.cluster) || step.cluster}. ${step.why}`)));
  }
  const generated = Object.entries(plan.uses?.generators || {}).map(([generator, use]) => count(use.total, generator === 'paint' ? 'painting' : generator));
  const criteria = plan.review.length ? [element('p', 'cell-label', 'What its review looks for in the captures'),
    append(element('ul', 'criteria'), ...plan.review.map(item => append(element('li'), element('strong', '', `${item.id} `), `${item.look}`, element('small', '', ` ${deviceName(arm, item.device)}${item.view ? `, in ${VIEWS[item.view] || item.view}` : ''}`))))] : [];
  return [element('p', 'cell-text', `${count(plan.steps.length, 'step')} with ${join(plan.uses?.methods || [])}${generated.length ? `; it asks for ${join(generated)}` : '; no generated picture'}.`), steps, ...criteria];
}

function captureFigure(capture) {
  if (!CAPTURE.test(capture.path || '')) return null;
  const image = element('img');
  image.src = capture.path;
  image.alt = `Capture ${capture.id}: ${VIEWS[capture.view] || capture.view}${capture.painted ? ', painted' : ''}.`;
  image.loading = 'lazy';
  image.decoding = 'async';
  if (capture.width && capture.height) { image.width = capture.width; image.height = capture.height; }
  return append(element('figure', 'review-capture'), image, element('figcaption', '', `${capture.id}${capture.painted ? ', painted' : ''}`));
}

/** The arm's review of captures of its own character: per round, the captures, each criterion's verdict and repair, and the host's audit. */
function reviewCell(arm) {
  const made = arm.production;
  if (!made?.reviews?.length) return [empty(made?.captures?.length ? 'Captures were taken, but no review was saved.' : made?.capture ? 'No review was saved.' : 'This pair captured nothing to review.')];
  const looks = new Map((made.plan?.review || []).map(item => [item.id, item.look]));
  const blocks = made.reviews.map(review => {
    const shots = append(element('div', 'review-captures'), ...made.captures.filter(capture => capture.round === review.round).map(captureFigure));
    const verdicts = append(element('ul', 'verdicts'), ...review.criteria.map(item => append(element('li', `verdict verdict--${item.verdict}`),
      element('span', 'verdict-label', VERDICTS[item.verdict] || item.verdict), element('strong', '', looks.get(item.id) || item.id),
      element('small', '', ` on ${item.capture}`), element('p', '', item.observed), item.repair && element('p', 'verdict-repair', `Repair: ${item.repair}`))));
    return append(element('div', 'review-round'), element('p', 'cell-label', `Round ${review.round}: ${review.stats.met} met, ${review.stats.partly} partly, ${review.stats.missed} missed`), shots, verdicts, element('p', 'cell-text', review.summary));
  });
  const audit = made.audit;
  const audited = !audit ? null : audit.audited
    ? `The Kiro session record shows it opened ${count(audit.opened.length, 'capture')} of the ${audit.cited.length} its reviews cite${audit.unopened.length ? `; not ${join(audit.unopened)}` : ''}.`
    : 'No session record to audit: a scripted session opened nothing.';
  const after = audit?.afterLastReview ? `After its last review it ${audit.afterLastReview.character ? 'saved the character again' : 'left the character file as it was'}${audit.afterLastReview.painting ? ' and painted it again' : ''}.` : null;
  return [...blocks, element('p', 'cell-text', [audited, after].filter(Boolean).join(' '))];
}

function row(id, title, note, arms, render) {
  const section = element('section', 'ledger-row');
  section.setAttribute('aria-labelledby', `row-${id}`);
  const heading = element('h3', '', title);
  heading.id = `row-${id}`;
  append(section, heading, note && element('p', 'ledger-note', note));
  for (const arm of arms) section.append(append(element('div', 'ledger-cell'), element('h4', 'cell-arm', arm.label), ...render(arm)));
  return section;
}

function runFacts(pair) {
  const dry = pair.kind === 'dry-run';
  const taste = pair.taste || {}, protocol = pair.protocol || {};
  const brief = element('blockquote', 'run-brief', pair.brief.brief);
  const facts = element('dl', 'run-facts');
  const fact = (term, value) => facts.append(element('dt', '', term), typeof value === 'string' ? element('dd', '', value) : append(element('dd'), value));
  fact('Brief', brief);
  fact('Model', dry ? 'None. A script played both arms through the real design server.' : `${pair.model}${pair.effort ? ` at ${pair.effort} effort` : ''}, one run per arm.`);
  fact('Held equal', protocol.swap ? 'The brief, model, prompt, world, keeper, format guide and tools. Only the measured profile differs.' : 'The brief, model, prompt, world, keeper, format guide and tools. Only the taste input differs.');
  const own = taste.fixture ? 'A fixture profile. No Qloo request was made.'
    : taste.reusedFrom ? `The Qloo profile recorded for ${taste.reusedFrom}, so no new request was made.` : `${count(taste.calls, 'Qloo request')} in one taste pass, made before either run started.`;
  const swapped = pair.swap ? ` ${pair.arms[1].label} read the profile recorded for ${pair.swap.from}, seeded by ${join((pair.swap.seeds || []).map(seed => seed.name).slice(0, 4))}.` : '';
  fact('Taste data', `${own}${swapped}`);
  if (protocol.audience) fact('Audience', `${[protocol.audience.location, protocol.audience.age && `ages ${protocol.audience.age.map(band => band.replaceAll('_', ' ')).join(' or ')}`].filter(Boolean).join(', ')}: the taste pass was weighted toward it, and both arms were told it.`);
  if (protocol.artDirection) fact('The moment', `Both arms set the scene's colours, weather and beacons, the render style${protocol.music ? ` and the music, from an open library of ${protocol.music.tracks} CC BY tracks` : ''}. The lore, layout and story beats stayed fixed.`);
  if (protocol.departure === false) fact('Departure rule', 'Off in both arms, an ablation: no device had to depart from its sketch.');
  const perArm = protocol.portraitsPerArm;
  const production = protocol.production;
  if (production) {
    // Both arms read the same capability list; how each device was made was each plan's own choice.
    const open = production.methods.filter(item => item.available).map(item => item.id), closed = production.methods.filter(item => !item.available);
    fact('Production', `Both arms read the same list of methods and planned how to make each device: ${join(open)}${closed.length ? `. Not available: ${closed.map(item => `${item.id} (${item.reason.replace(/[.\s]+$/u, '')})`).join('; ')}` : ''}.${production.required?.length ? ` The study required ${join(production.required)} of both.` : ''}`);
    fact('Self-review', production.capture ? `Each arm captured its checked character in the game's own pages${production.capture === 'fixture' ? ' (flat fixture pictures in this dry run)' : production.browser ? `, in headless ${production.browser}` : ''}, opened the captures, judged its plan's criteria on them, and could repair and review again, ${count(production.rounds, 'round')} at most.`
      : `None: ${production.captureReason || 'no browser could capture the characters.'}`);
  }
  fact('Portraits', perArm ? `${perArm === 1 ? 'One' : `Up to ${perArm}`} per arm, generated with Codex from the arm's imagery device${production ? ', when its plan chose a portrait' : ''}.` : 'None in this pair.');
  if (protocol.paintPerArm) fact('Painting', production ? `A method each plan could choose: ${pair.arms.map(arm => `${arm.label} ${arm.paint?.status === 'painted' ? 'painted its drawing' : (arm.production?.plan?.steps || []).some(step => step.method === 'painted-rig') ? 'planned a painting' : 'kept the vector drawing'}`).join('; ')}.${dry ? ' The dry run paints with a fixture painter that hands the blueprint back unpainted; no Codex request was made.' : ''}`
    : dry ? 'Both drawings went through the painting step with a fixture painter that hands the blueprint back unpainted; no Codex request was made.'
      : 'Each run described the painting of its own checked drawing; Codex repainted it in one image, and the game moves the painted pieces on the same skeleton.');
  const tracks = pair.arms.filter(arm => arm.music);
  if (tracks.length) fact('Music', tracks.map(arm => `${arm.label}: “${arm.music.title}” by ${arm.music.artist}, ${arm.music.license}, via ${arm.music.source}`).join('. ') + '.');
  fact('Sessions', pair.arms.map(arm => `${arm.label}: ${count(arm.calls ?? 0, 'tool call')} and ${count(arm.checks ?? 0, 'check')} in ${duration(arm.durationMs)}`).join('. ') + '.');
  return facts;
}

function distanceFigure(comparison) {
  const d = comparison.distance;
  const figure = element('figure', 'distance');
  const moment = d.world !== undefined;
  const total = element('p', 'distance-total', `The two ${moment ? 'designs' : 'characters'} are ${d.overall.toFixed(2)} apart`);
  total.append(element('small', '', moment ? `From 0, the same design, to 1, as far apart as this measure goes: the character ${d.character.toFixed(2)}, the moment ${d.world.toFixed(2)}.` : 'From 0, the same character, to 1, as far apart as this measure goes.'));
  const bars = append(element('ul', 'bars'), ...[['Palette', d.palette], ['Silhouette', d.silhouette], ['Motion', d.motion], ['Signature move', d.signature], ['Voice', d.voice], ['Light', d.light]]
    .map(([label, value]) => barItem(label, value, value.toFixed(2))));
  if (!moment) return append(figure, total, bars);
  const parts = d.worldParts || {};
  const world = append(element('ul', 'bars'), ...[['Scene colours', parts.palette], ['Render style', parts.render], ['Weather', parts.weather], ['Music', parts.music], ['Beacons', parts.towers], ['Mist', parts.fog]]
    .filter(([, value]) => typeof value === 'number').map(([label, value]) => barItem(label, value, value.toFixed(2))));
  return append(figure, total, element('p', 'bars-title', 'The character'), bars, element('p', 'bars-title', 'The moment'), world);
}

/** The record section: headline, run facts and distance, then the ledger, one row per stage and DNA layer. */
export function renderRecord(section, pair) {
  const [off, on] = pair.arms;
  const comparison = pair.comparison;
  section.replaceChildren();
  const heading = element('h2', '', 'How each was designed');
  heading.id = 'record-title';
  const lede = append(element('div', 'record-lede'), element('p', 'record-headline', comparison.headline),
    comparison.dataHeadline && element('p', 'record-detail', comparison.dataHeadline),
    comparison.qualityHeadline && element('p', 'record-detail', comparison.qualityHeadline),
    (comparison.worldHeadline || comparison.renderHeadline) && element('p', 'record-detail', [comparison.worldHeadline, comparison.renderHeadline].filter(Boolean).join(' ')),
    comparison.production?.headline && element('p', 'record-detail', comparison.production.headline),
    element('p', 'record-detail', `${comparison.sketchHeadline} ${comparison.detail}`), runFacts(pair));
  section.append(append(element('div', 'record-intro'), heading, lede, distanceFigure(comparison)));

  const ledger = element('div', 'ledger');
  const head = element('div', 'ledger-head');
  head.setAttribute('aria-hidden', 'true');
  head.append(element('p', '', off.label), element('p', '', on.label));
  append(ledger, head,
    row('sketch', 'Blind sketch', 'Saved before the run read any taste input, then frozen. Each arm sketched its own.', pair.arms, sketchCell),
    row('taste', 'Taste input', 'What each run designed from once its sketch was frozen. This is the only input that differs.', pair.arms, tasteCell),
    pair.protocol?.production && row('reading', 'Taste reading', 'Before its DNA, each run gathered the refs that belong together into clusters, each resting on a quality, and set aside what it judged to be noise. Its devices could anchor only to refs it kept.', pair.arms, readingCell),
    row('departure', 'Departure from the sketch', pair.protocol?.departure === false
      ? 'Measured on the saved character against the arm\'s own sketch. The departure rule was off in this pair, so no device had to depart: what moved, the data moved under the other rules.'
      : 'Measured on the saved character against the arm\'s own sketch. Devices resting on measured surprises had to depart; devices resting on the model\'s own prediction were free to keep it.', pair.arms, departureCell),
    row('thesis', 'Design thesis', 'The DNA each run wrote before drawing: binding devices, each anchored to entities or tags from its taste input.', pair.arms, thesisCell),
    pair.protocol?.production && row('plan', 'Production plan', 'After its DNA and before drawing, each run chose how to make every device from the same list of methods, and wrote what its review should see. Pictures were generated only as a plan stated.', pair.arms, planCell));
  const used = new Set(pair.arms.flatMap(arm => (arm.dna?.devices || []).map(device => device.layer)));
  for (const [layer, title] of LAYERS) if (used.has(layer)) ledger.append(row(layer, title, null, pair.arms, arm => layerCell(arm, layer)));
  if (pair.arms.some(arm => arm.dna?.rejected?.length)) ledger.append(row('rejected', 'Anchors set aside', 'A required anchor may be set aside with a reason instead of a device, at most twice.', pair.arms, rejectedCell));
  if (pair.arms.some(arm => arm.paint)) ledger.append(row('paint', 'Painting', 'After its last check, each run described how its drawing should be painted; the host laid the drawing out as pieces and Codex repainted them in the technique of the render style.', pair.arms, paintCell));
  if (pair.protocol?.production) ledger.append(row('review', 'Self-review', 'After its checks, each run captured its own character in the game\'s pages, opened the captures with its read tool and judged its plan\'s criteria on what they show. The verdicts are its own: they show the plan was checked against what was drawn, not that the result is good.', pair.arms, reviewCell));
  section.append(ledger);

  const notes = append(element('footer', 'record-notes'), element('h3', '', 'What these numbers do and do not show'),
    element('p', '', comparison.limitation), element('p', '', `Distance: ${comparison.distance.method}`),
    off.divergence?.method && element('p', '', `Departure: ${off.divergence.method}`),
    off.conformance?.limitation && element('p', '', `Conformance: ${off.conformance.limitation}`));
  section.append(notes);
  section.hidden = false;
}

/** The first painted portrait of an arm, beside the character's name in its sheet. */
export function renderSheetPortrait(sheet, arm) {
  const head = sheet.querySelector('.sheet-head');
  if (!head) return;
  // A painted character shows its painted standing figure, cut from the same sheet as the pieces the game moves;
  // its portrait stays with the imagery device in the design record.
  if (arm.paint?.status === 'painted' && IMAGE.test(arm.paint.figure || '')) {
    head.classList.add('has-portrait');
    const image = element('img');
    image.src = arm.paint.figure;
    image.alt = `The painted character standing, in the ${arm.paint.technique} technique.`;
    image.decoding = 'async';
    const caption = arm.paint.provider === 'codex' ? `Painted with Codex from its drawing, in its ${styleName(arm.paint.technique)} style.` : 'Dry run: the blueprint figure, handed back unpainted by the fixture painter.';
    head.append(append(element('figure', `sheet-portrait sheet-figure${arm.paint.technique === 'pixel' ? ' is-pixel' : ''}`), image, element('figcaption', '', caption)));
    return;
  }
  const item = (arm.portraits || []).find(portrait => portrait.status === 'generated' && IMAGE.test(portrait.path || ''));
  if (!item) return;
  head.classList.add('has-portrait');
  head.append(portraitFigure(item, 'sheet-portrait', 'Painted with Codex from its imagery device.'));
}

export function pairNotice(pair) {
  if (pair.kind === 'dry-run') return 'Dry run. No model, Qloo or Codex request was made: a script played both arms with the two hand-made samples, and every taste entity is a fixture.';
  if (!pair.protocol?.domains?.includes('qualities')) return 'Recorded before shared qualities: this pair\'s required anchors are the highest-affinity entities, and its palette and silhouette did not have to rest on qualities the audience\'s works share.';
  if (!pair.protocol?.artDirection) return 'Recorded before art direction: both arms drew the character into the original dusk, so the scene, the render style and the music could not differ.';
  if (pair.protocol.departure === false) return 'Ablation: the departure rule was off in both arms, so devices resting on measured surprises were free to keep the sketch. What departs here, the data moved without being told to.';
  return null;
}
