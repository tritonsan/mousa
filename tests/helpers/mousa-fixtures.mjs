// Shared stand-ins for the mousa plugin tests: Qloo over HTTP with typed tags, a prediction and a small font library.
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { encodePng } from '../../plugin/server/production/image-files.mjs';

export const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
export const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '');
const tag = (type, name) => ({ id: `urn:tag:${type}:qloo:${slug(name)}`, name, type: `urn:tag:${type}:qloo` });
const work = (domain, name, affinity, tags, popularity = 0.4) => ({ entity_id: `F-${domain}-${slug(name)}`, name, subtype: `urn:entity:${domain}`, popularity, query: { affinity }, tags });
export const PARENTS = 'urn:audience:life_stage:parents_with_young_children';

/** Qloo over HTTP, as the real client sees it: search, tags, audiences and insights, recording every request. */
export function qlooFixture() {
  const requests = [];
  const CORE = {
    brand: [work('brand', 'Kinfolk Press', 0.9, [tag('aesthetic_property', 'Minimalist'), tag('core_value', 'Craftsmanship')]), work('brand', 'Quiet Goods', 0.8, [tag('aesthetic_property', 'Minimalist')]), work('brand', 'Field Notes Co', 0.7, [tag('theme', 'Routine')])],
    movie: [work('movie', 'Perfect Days', 0.95, [tag('aesthetic_property', 'Atmospheric'), tag('emotional_tone', 'Reflective'), tag('theme', 'Routine')]), work('movie', 'Columbus', 0.85, [tag('aesthetic_property', 'Atmospheric'), tag('theme', 'Identity')]), work('movie', 'After Yang', 0.8, [tag('emotional_tone', 'Melancholic')])],
    artist: [work('artist', 'Hiroshi Yoshimura', 0.9, [tag('aesthetic_property', 'Atmospheric'), tag('emotional_tone', 'Reflective')]), work('artist', 'Nala Sinephro', 0.8, [tag('emotional_tone', 'Melancholic'), tag('theme', 'Identity')]), work('artist', 'Khruangbin', 0.75, [tag('emotional_tone', 'Reflective')])],
    book: [work('book', 'Kitchen', 0.85, [tag('theme', 'Identity')]), work('book', 'The Housekeeper and the Professor', 0.8, [tag('theme', 'Routine')]), work('book', 'Convenience Store Woman', 0.7, [tag('emotional_tone', 'Melancholic')])],
    tv_show: [work('tv_show', 'Midnight Diner', 0.9, [tag('theme', 'Routine'), tag('aesthetic_property', 'Atmospheric')]), work('tv_show', 'Mushishi', 0.85, [tag('emotional_tone', 'Reflective')]), work('tv_show', 'Aggretsuko', 0.6, [tag('plot', 'Comedic')])],
    place: [work('place', 'Moda Coffee House', 0.7, [tag('aesthetic_property', 'Cozy')]), work('place', 'Moda Seaside', 0.65, [])],
  };
  const DEEP = { brand: [work('brand', 'Hasami Porcelain', 0.6, [tag('aesthetic_property', 'Minimalist')], 0.1)], movie: [work('movie', 'Small Hours', 0.55, [tag('aesthetic_property', 'Atmospheric')], 0.1)] };
  const RANKINGS = { 'urn:tag:style:qloo': ['Quiet', 'Pensive', 'Visually Austere'], 'urn:tag:aesthetic_property:qloo': ['Sculptural', 'Textural'], 'urn:tag:emotional_tone:qloo': ['Thoughtful', 'Introspective', 'Melancholic'] };
  const SEARCH = { Paterson: 'movie', Nujabes: 'artist', 'Hiroshi Yoshimura': 'artist', Khruangbin: 'artist', 'Tom Misch': 'artist', 'Perfect Days': 'movie' };
  const fetchImpl = async url => {
    const target = new URL(url), params = target.searchParams;
    requests.push(`${target.pathname}?${params.toString()}`);
    if (target.pathname === '/search') {
      const query = params.get('query'), type = SEARCH[query];
      return json({ results: type ? [{ entity_id: `F-${type}-${slug(query)}`, name: query, subtype: `urn:entity:${type}` }] : [] });
    }
    if (target.pathname === '/v2/tags') return json({ results: { tags: [] } });
    if (target.pathname === '/v2/audiences') {
      return json({ results: { audiences: /parent/iu.test(params.get('filter.query') || '') ? [{ entity_id: 'AUD-1', id: PARENTS, name: 'Parents With Young Children',
        parents: [{ id: 'urn:audience:life_stage', name: 'Life Stage', type: 'urn:audience' }], type: 'urn:audience:life_stage' }] : [] } });
    }
    if (target.pathname === '/v2/insights') {
      const type = params.get('filter.type');
      if (type === 'urn:tag') {
        const names = RANKINGS[params.get('filter.tag.types')] || [];
        return json({ results: { tags: names.map((name, index) => ({ tag_id: `${params.get('filter.tag.types')}:${slug(name)}`, name, query: { affinity: 0.9 - index * 0.1 } })) } });
      }
      const candidates = params.get('filter.results.entities');
      if (candidates) {
        return json({ results: { entities: candidates.split(',').map((id, index) => ({ entity_id: id, name: id.replace(/^F-[a-z_]+?-/u, '').replaceAll('_', ' '), subtype: type, query: { affinity: 0.5 + index * 0.1 } })).reverse() } });
      }
      const domain = type.replace('urn:entity:', '');
      return json({ results: { entities: (params.has('filter.popularity.max') ? DEEP : CORE)[domain] || [] } });
    }
    return new Response('', { status: 404 });
  };
  return { fetchImpl, requests };
}

export const FONTS = { families: [
  { family: 'Literata', faces: [{ path: 'fonts/literata-400.woff2' }], similarTo: ['Georgia'] },
  { family: 'Courier Prime', faces: [{ path: 'fonts/courier-prime-400.woff2' }], similarTo: ['Courier New'] },
  { family: 'Jost', faces: [{ path: 'fonts/jost-400.woff2' }], similarTo: ['Futura'] },
] };

export const prediction = (fonts = ['Literata', 'Courier Prime']) => ({ schemaVersion: '1.0', audienceSummary: 'Calm people who like slow films, lo-fi hip hop and small routines.',
  predictions: { brand: ['Muji', 'Kinfolk Press', 'Moleskine'], movie: ['Lost in Translation', 'Perfect Days', 'Before Sunrise'], artist: ['J Dilla', 'Tom Misch', 'Fat Jon'],
    book: ['Norwegian Wood', 'Kitchen', 'Lunch Poems'], tv_show: ['Midnight Diner', 'Samurai Champloo', 'Atlanta'], style: ['slow pacing', 'static takes', 'quiet'],
    aesthetic: ['paper texture', 'muted earth tones', 'hand-drawn lines'], tone: ['warm', 'wistful', 'calm'], qualities: ['nostalgic', 'everyday poetry', 'gentle'] },
  designSketch: { summary: 'A warm notebook-style shop with typed labels and a turning record.', palette: ['#f3ead8', '#2f2a24', '#b5653a'], fonts, sections: ['hero', 'catalog', 'notes'], motifs: ['turning record'] } });

export const parse = result => JSON.parse(result.content.find(item => item.type === 'text').text);
export const exists = file => stat(file).then(() => true, () => false);

/** A solid PNG of one colour, or of two side by side. */
export function png(width, height, colors) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const hex = colors[Math.min(colors.length - 1, Math.floor((x / width) * colors.length))].replace('#', '');
    const at = (y * width + x) * 4;
    rgba[at] = Number.parseInt(hex.slice(0, 2), 16); rgba[at + 1] = Number.parseInt(hex.slice(2, 4), 16); rgba[at + 2] = Number.parseInt(hex.slice(4, 6), 16); rgba[at + 3] = 255;
  }
  return encodePng(width, height, rgba);
}

/** A web DNA for the fixture profile: anchored to the reading's refs, departing from the frozen sketch. */
export function designFor(input) {
  const by = predicate => input.entities.find(entity => entity.source === 'qloo' && predicate(entity));
  const quality = family => by(entity => entity.domain === 'qualities' && entity.family === family && entity.required) || by(entity => entity.domain === 'qualities' && entity.family === family);
  const look = quality('look'), mood = quality('mood'), meaning = quality('meaning');
  const style = by(entity => entity.domain === 'style' && entity.surprise) || by(entity => entity.domain === 'style');
  const aesthetic = by(entity => entity.domain === 'aesthetic');
  const tone = by(entity => entity.domain === 'tone' && entity.surprise) || by(entity => entity.domain === 'tone');
  const works = input.requiredAnchors.filter(anchor => anchor.domain !== 'qualities').map(anchor => input.entities.find(entity => entity.ref === anchor.ref));
  const tagsOf = entity => entity?.tags?.length ? [entity.tags[0]] : [];
  const reading = { schemaVersion: '1.0', clusters: [
    { id: 'c1', name: 'Misty look', refs: [look.ref, style.ref, aesthetic.ref, works[0].ref], layers: ['palette', 'motion', 'imagery'], reading: 'What they love is hazy, slow and sculpted, seen through soft weather.' },
    { id: 'c2', name: 'Quiet voice', refs: [mood.ref, tone.ref, works[1].ref], layers: ['typography', 'voice'], reading: 'They listen for thoughtful, reflective voices that leave room between lines.' },
    { id: 'c3', name: 'Small routines', refs: [meaning.ref, works[2].ref], layers: ['structure'], reading: 'Their stories are about routine and who you become in it.' },
  ], setAside: [], approach: 'The site carries the misty look in palette, motion and drawing, the quiet voice in type and copy, and routine in a weekly structure.' };
  const dna = { schemaVersion: '1.0', thesis: 'A misty hillside pantry that moves slowly and speaks quietly.', devices: [
    { id: 'dna1', layer: 'palette', device: 'Mist and sea-glass palette', anchors: [look.ref, works[0].ref], qualities: [look.name, ...tagsOf(works[0])], translation: 'Atmospheric works become cool, hazy colours.', tokens: { colors: ['#3e5c6b', '#8fb0a9'] } },
    { id: 'dna2', layer: 'typography', device: 'Calm geometric type', anchors: [mood.ref], qualities: [mood.name], translation: 'A reflective mood becomes an even, open sans.', tokens: { fonts: ['Jost'] } },
    { id: 'dna3', layer: 'motion', device: 'Slow mist drift', anchors: [style.ref], qualities: [style.name], translation: 'Pensive pacing becomes a forty-second drift with no overshoot.', tokens: { keyframes: ['mist-drift'], css: [{ property: 'animation', value: 'mist-drift 40s ease-in-out infinite' }] } },
    { id: 'dna4', layer: 'imagery', device: 'Sculpted terrace drawing', anchors: [aesthetic.ref], qualities: [aesthetic.name], translation: 'Sculptural forms become stepped terraces drawn in line.', tokens: { svg: ['terrace'], ids: ['terrace-figure'], images: ['generated/dna4-1.png'] } },
    { id: 'dna5', layer: 'voice', device: 'Short lines with room between them', anchors: [tone.ref, works[1].ref], qualities: [tone.name, ...tagsOf(works[1])], translation: 'A thoughtful tone becomes short sentences with pauses.', tokens: { copy: ['The street turns blue at six.', 'Take your time with the shelf.'] } },
    { id: 'dna6', layer: 'structure', device: 'A week of small things', anchors: [meaning.ref, works[2].ref], qualities: [meaning.name, ...tagsOf(works[2])], translation: 'Routine becomes a strip of seven days.', tokens: { ids: ['week-strip'] } },
  ], rejected: [] };
  const plan = { schemaVersion: '1.0', steps: [
    { device: 'dna1', method: 'css-palette', cluster: 'c1', why: 'Two custom properties carry the palette everywhere.' },
    { device: 'dna2', method: 'library-font', cluster: 'c2', why: 'Jost loads from the library, so every visitor sees it.' },
    { device: 'dna3', method: 'css-motion', cluster: 'c1', why: 'A keyframed drift with a pause control and a reduced-motion fallback.' },
    { device: 'dna4', method: 'generated-image', cluster: 'c1', why: 'A picture of the terrace in the palette, with the drawing as its fallback.', count: 2, fallback: 'inline-svg' },
    { device: 'dna5', method: 'copy', cluster: 'c2', why: 'The voice lives in the words themselves.' },
    { device: 'dna6', method: 'css-layout', cluster: 'c3', why: 'Seven day cards in one row.' },
  ], review: [
    { id: 'r1', device: 'dna1', look: 'The first screen shows the mist palette, not white.', view: 'desktop' },
    { id: 'r2', device: 'dna5', look: 'The headline reads as one short line at phone width.', view: 'mobile' },
  ] };
  return { reading, dna, plan };
}

/** A site that carries every device of designFor's DNA, with the fetched @font-face rules. */
export function siteFiles(fontFace) {
  const art = `<svg id="terrace" viewBox="0 0 80 40" aria-hidden="true">${[0, 10, 20, 30, 40, 50, 60, 70].map(x => `<rect x="${x}" y="${40 - x / 2}" width="10" height="${x / 2}"/>`).join('')}</svg>`;
  return {
    'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pantry</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>The street turns blue at six.</h1><p>Take your time with the shelf.</p><figure id="terrace-figure">${art}<img src="generated/dna4-1.png" alt="A terrace"></figure><section id="week-strip"><ol><li>Mon</li></ol></section><button type="button" data-motion-toggle aria-pressed="false">Pause</button><div class="drift"></div></main></body></html>`,
    'styles.css': `${fontFace.join('\n')}\n:root{--mist:#3e5c6b;--glass:#8fb0a9;--text-font:'Jost',sans-serif}body{color:var(--mist);background:var(--glass);font-family:var(--text-font)}#week-strip ol{display:flex}@keyframes mist-drift{from{transform:translateX(0)}to{transform:translateX(12px)}}.drift{animation:mist-drift 40s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.drift{animation:none}}`,
  };
}

/** A prediction for the game recipe's domains, with a sketch that names no font, as a game's may. */
export const gamePrediction = () => ({ ...prediction(), predictions: { videogame: ['Hollow Knight', 'Celeste', 'Journey'], movie: ['Spirited Away', 'Paprika', 'Akira'],
  tv_show: ['Mushishi', 'Arcane', 'Samurai Champloo'], artist: ['Sigur Rós', 'Nujabes', 'Joe Hisaishi'], book: ['The Little Prince', 'Kitchen', 'Piranesi'],
  style: ['slow', 'dreamlike', 'quiet'], aesthetic: ['hand-drawn', 'ink wash', 'muted'], tone: ['wistful', 'gentle', 'lonely'], qualities: ['melancholic', 'atmospheric', 'whimsical'],
  art_style: ['pixel art', 'hand-drawn', 'watercolor'] },
  designSketch: { summary: 'A small hooded wanderer in slate with an amber lantern, walking slowly.', palette: ['#f3ead8', '#2f2a24', '#b5653a'], fonts: [], sections: ['hood', 'scarf', 'lantern'], motifs: ['swinging lantern'] } });

/** A game DNA for the fixture profile with no typography device: its tokens live in a character file. */
export function gameDesignFor(input) {
  const { reading: web } = designFor(input);
  const by = predicate => input.entities.find(entity => entity.source === 'qloo' && predicate(entity));
  const quality = family => by(entity => entity.domain === 'qualities' && entity.family === family && entity.required) || by(entity => entity.domain === 'qualities' && entity.family === family);
  const look = quality('look'), mood = quality('mood'), meaning = quality('meaning');
  const style = by(entity => entity.domain === 'style' && entity.surprise) || by(entity => entity.domain === 'style');
  const aesthetic = by(entity => entity.domain === 'aesthetic');
  const tone = by(entity => entity.domain === 'tone' && entity.surprise) || by(entity => entity.domain === 'tone');
  const works = input.requiredAnchors.filter(anchor => anchor.domain !== 'qualities').map(anchor => input.entities.find(entity => entity.ref === anchor.ref));
  const tagsOf = entity => entity?.tags?.length ? [entity.tags[0]] : [];
  const reading = { ...web, clusters: [
    { ...web.clusters[0], layers: ['palette', 'motion', 'imagery'] },
    { ...web.clusters[1], layers: ['voice'] },
    { ...web.clusters[2], layers: ['structure'] },
  ], approach: 'The character carries the misty look in its palette, gait and render style, the quiet voice in its lines, and routine in what it carries.' };
  const dna = { schemaVersion: '1.0', thesis: 'A slow lamplighter in mist and sea glass who speaks in short, quiet lines.', devices: [
    { id: 'dna1', layer: 'palette', device: 'Mist and sea-glass cloak', anchors: [look.ref, works[0].ref], qualities: [look.name, ...tagsOf(works[0])], translation: 'Atmospheric works become a cool, hazy cloak.', tokens: { colors: ['#3e5c6b', '#8fb0a9'] } },
    { id: 'dna2', layer: 'motion', device: 'An unhurried walk', anchors: [style.ref], qualities: [style.name], translation: 'Pensive pacing becomes a slow cadence with little bounce.', tokens: { literals: ['"cadence": 0.9'] } },
    { id: 'dna3', layer: 'imagery', device: 'Drawn in ink', anchors: [aesthetic.ref], qualities: [aesthetic.name], translation: 'Sculptural forms become an inked frame.', tokens: { literals: ['"preset": "ink"'] } },
    { id: 'dna4', layer: 'voice', device: 'Short lines with room between them', anchors: [tone.ref, mood.ref, works[1].ref], qualities: [tone.name, mood.name, ...tagsOf(works[1])], translation: 'A thoughtful tone becomes short lines with pauses.', tokens: { copy: ['The road is quiet tonight.', 'Rest. I will carry it.'] } },
    { id: 'dna5', layer: 'structure', device: 'A moth-wing lantern', anchors: [meaning.ref, works[2].ref], qualities: [meaning.name, ...tagsOf(works[2])], translation: 'A routine of small lights becomes a lantern shaped like folded wings.', tokens: { ids: ['moth-lantern'] } },
  ], rejected: [] };
  const plan = { schemaVersion: '1.0', steps: [
    { device: 'dna1', method: 'source', cluster: 'c1', why: 'The palette lives in the character file.' },
    { device: 'dna2', method: 'source', cluster: 'c1', why: 'The walk is a motion parameter of the character.' },
    { device: 'dna3', method: 'source', cluster: 'c1', why: 'The render preset draws the frame.' },
    { device: 'dna4', method: 'copy', cluster: 'c2', why: 'The voice lives in the four lines.' },
    { device: 'dna5', method: 'source', cluster: 'c3', why: 'The lantern is a named part.' },
  ], review: [
    { id: 'r1', device: 'dna1', look: 'The figure at rest reads as mist and sea glass, not grey.', view: 'frame' },
    { id: 'r2', device: 'dna2', look: 'The walk cycle shows short, even steps.', view: 'frame' },
  ] };
  const character = JSON.stringify({ id: 'ilo', palette: { cloak: '#3e5c6b', glass: '#8fb0a9' }, parts: [{ id: 'moth-lantern' }], motion: { walk: { cadence: 0.9 } }, render: { preset: 'ink' },
    lines: { arrive: 'The road is quiet tonight.', greet: 'Rest. I will carry it.' } }, null, 2);
  return { reading, dna, plan, character };
}

/** Refs written as the Taste Brief names them, with its marks, so the agent never copies an opaque ID. */
export function byName(artifact, input) {
  const named = new Map(input.entities.map(entity => [entity.ref, `${entity.name}${entity.surprise ? ' (new)' : ''}`]));
  const name = ref => named.get(ref) || ref;
  const copy = structuredClone(artifact);
  for (const cluster of copy.clusters || []) cluster.refs = cluster.refs.map(name);
  for (const item of copy.setAside || []) item.ref = name(item.ref);
  for (const device of copy.devices || []) device.anchors = device.anchors.map(name);
  for (const item of copy.rejected || []) item.ref = name(item.ref);
  return copy;
}

/** A web DNA from the agent's own prediction alone: the baseline arm of a comparison, with no measured ref. */
export function baselineDesign(input) {
  const ref = name => input.entities.find(entity => entity.name === name).ref;
  const required = input.requiredAnchors.map(item => item.name);
  const reading = { schemaVersion: '1.0', clusters: [
    { id: 'c1', name: 'Warm paper', refs: ['nostalgic', 'paper texture', 'slow pacing', 'Lost in Translation'], layers: ['palette', 'motion', 'imagery'], reading: 'I expect them to love the warmth of old paper and a slow, unhurried pace.' },
    { id: 'c2', name: 'Everyday poems', refs: ['everyday poetry', 'warm', 'Muji'], layers: ['typography', 'voice'], reading: 'I expect a quiet, plain voice that finds poetry in daily objects.' },
    { id: 'c3', name: 'Gentle routines', refs: ['gentle', 'J Dilla'], layers: ['structure'], reading: 'I expect them to like gentle routines and loops that come back around.' },
  ], setAside: [], approach: 'From my own prediction alone: paper colours and a slow drift, plain type and copy, and a weekly loop as the structure.' };
  const dna = { schemaVersion: '1.0', thesis: 'A warm notebook shop, from my own expectation of this audience.', devices: [
    { id: 'dna1', layer: 'palette', device: 'Old paper and rust', anchors: ['nostalgic', 'Lost in Translation'], qualities: ['nostalgic'], translation: 'Nostalgia becomes aged paper with a rust accent.', tokens: { colors: ['#f3ead8', '#b5653a'] } },
    { id: 'dna2', layer: 'typography', device: 'Bookish serif', anchors: ['everyday poetry', 'Muji'], qualities: ['everyday poetry'], translation: 'Everyday poetry becomes a calm reading serif.', tokens: { fonts: ['Literata'] } },
    { id: 'dna3', layer: 'motion', device: 'Slow record turn', anchors: ['slow pacing'], qualities: ['slow pacing'], translation: 'A slow pace becomes a record that turns once a minute.', tokens: { keyframes: ['turn'], css: [{ property: 'animation', value: 'turn 60s linear infinite' }] } },
    { id: 'dna4', layer: 'imagery', device: 'Hand-drawn record', anchors: ['paper texture'], qualities: ['paper texture'], translation: 'Paper texture becomes a drawn record sleeve.', tokens: { svg: ['record'] } },
    { id: 'dna5', layer: 'voice', device: 'Plain short lines', anchors: ['warm'], qualities: ['warm'], translation: 'Warmth becomes short, plain sentences.', tokens: { copy: ['Pull up a chair.', 'Something good is playing.'] } },
    { id: 'dna6', layer: 'structure', device: 'A loop of days', anchors: ['gentle', 'J Dilla'], qualities: ['gentle'], translation: 'Gentle routines become a week that loops.', tokens: { ids: ['week-loop'] } },
  ], rejected: [] };
  for (const name of required) assert.ok(dna.devices.some(device => device.anchors.includes(name)), `${name} is used`);
  void ref;
  return { reading, dna };
}
