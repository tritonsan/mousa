// Shared stand-ins for the mousa plugin tests: Qloo over HTTP with typed tags, a prediction and a small font library.
import { stat } from 'node:fs/promises';

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
