import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { QlooClient } from '../plugin/server/qloo/client.mjs';
import { tasteNameMatch, predictionMatches, selectTasteReferences, buildTasteProfile, normalizeTasteAssumption, tasteInputFromProfile, tasteInputFromAssumption, selectRequiredAnchors,
  compactTasteInput, normalizeDesignDna, checkDnaConformance, designFingerprint, compareDesignFingerprints, normalizeTasteDirections, scoreTasteDirections, sketchDivergence, sketchFingerprint,
  dnaDecisions, compareTasteRuns } from '../plugin/server/culture/taste.mjs';
import { createToolHandler, getToolDefinitions, dispatchRpc } from '../plugin/server/mcp/server.mjs';
import { validateCultureBrief } from '../plugin/server/culture/brief.mjs';
import { tasteRecordText, siteData, assertStarterFacts, narrativeRetention, copyOverlap } from '../src/design-artifacts.mjs';
import { getTemplate } from '../src/templates.mjs';
import { createStudio } from '../src/server.mjs';
import { getConfig } from '../src/config.mjs';
import { prepareKiroWorkspace, makeTastePrompt } from '../src/kiro-runner.mjs';

// Test-only fixture catalogue. No real Qloo request or model call is made in this file.
const CORE = {
  brand: ['Fixture Workwear Co', 'Fixture Ceramics', 'Fixture Bicycle Works', 'Fixture Tea House'],
  movie: ['Fixture Film Alpha', 'Blade Runner 2049', 'Fixture Night Drive', 'Fixture Harbor Story'],
  artist: ['Fixture Ambient Duo', 'Fixture Choir', 'Fixture Synth Collective', 'Fixture Folk Singer'],
  book: ['Fixture Rain Novel', 'Fixture City Atlas', 'Fixture Essay Collection', 'Fixture Garden Diary'],
  tv_show: ['Fixture Kitchen Series', 'Fixture Detective Show', 'Fixture Travel Diary', 'Fixture Night Market'],
};
const DEEP = { brand: ['Fixture Indie Press', 'Fixture Letterpress', 'Fixture Kiln', 'Fixture Map Maker'], movie: ['Fixture Short Film', 'Fixture Silent Feature', 'Fixture Animated Essay', 'Fixture Documentary'] };
const SEARCH = { 'Blade Runner': [{ entityId: 'E-BLADE', name: 'Blade Runner', type: 'urn:entity:movie' }], 'Brian Eno': [{ entityId: 'E-ENO', name: 'Brian Eno', type: 'urn:entity:artist' }], 'Ambient Music': [{ entityId: 'E-AMT', name: 'Ambient Music Therapy', type: 'urn:entity:podcast' }],
  // Shaped like the live "Paterson" search, which returned the city before the film.
  Paterson: [{ entityId: 'E-PAT-CITY', name: 'Paterson', type: 'urn:entity:locality' }, { entityId: 'E-PAT-FILM', name: 'Paterson', type: 'urn:entity:movie' }],
  Kyoto: [{ entityId: 'E-KYOTO', name: 'Kyoto', type: 'urn:entity:locality' }],
  // Shaped like the live Echo Atlas searches: no film entity for the studio, and an artist literally named Ambient Music.
  'Studio Ghibli films': [{ entityId: 'E-GHIBLI-ARTIST', name: 'Studio Ghibli', type: 'urn:entity:artist' }, { entityId: 'E-GHIBLI-AUTHOR', name: 'Studio Ghibli', type: 'urn:entity:author' },
    { entityId: 'E-GHIBLI-ALBUM', name: 'A Tribute to Studio Ghibli', type: 'urn:entity:album' }],
  'ambient music': [{ entityId: 'E-AMBIENT-ARTIST', name: 'Ambient Music', type: 'urn:entity:artist' }],
  'Nujabes music': [{ entityId: 'E-NUJABES', name: 'Nujabes', type: 'urn:entity:artist' }] };
const TAGS = { 'Ambient Music': [{ entityId: 'urn:tag:genre:music:ambient', name: 'Ambient', type: 'urn:tag:genre:music' }],
  // The live tag search listed a place-ambience tag named Ambient Music before the Ambient genre.
  'ambient music': [{ entityId: 'urn:tag:ambience:qloo:ambient_music', name: 'Ambient Music', type: 'urn:tag:ambience:qloo' }, { entityId: 'urn:tag:genre:music:ambient', name: 'Ambient', type: 'urn:tag:genre:music' }] };
// Audience-level tags the fixture returns for the style and aesthetic tag requests.
const TAG_RESULTS = { 'urn:tag:style:qloo': ['Fixture Hushed', 'Fixture Lantern Lit', 'Fixture Slow Pan', 'Fixture Drifting Light'],
  'urn:tag:aesthetic_property:qloo': ['Fixture Woven', 'Fixture Lacquered', 'Fixture Folded Paper', 'Fixture Brass Inlay'] };
const evidence = endpoint => ({ provider: 'Qloo', endpoint: `https://hackathon.api.qloo.com${endpoint}`, retrievedAt: '2026-10-03T00:00:00.000Z', resultCount: 0, interpretation: 'Test-only fixture.' });
function fakeQloo(calls = []) {
  return {
    calls,
    async searchEntities({ query }) { calls.push({ tool: 'search', query }); const results = SEARCH[query] || []; return { status: results.length ? 'ok' : 'empty', query: { text: query }, results, evidence: evidence('/search') }; },
    async searchTags({ query, tagTypes }) {
      calls.push({ tool: 'tags', query, ...(tagTypes ? { tagTypes } : {}) });
      const results = (TAGS[query] || []).filter(row => !tagTypes || tagTypes.includes(row.type));
      return { status: results.length ? 'ok' : 'empty', query: { text: query }, results, evidence: evidence('/v2/tags') };
    },
    async getInsights(input) {
      calls.push({ tool: 'insights', input });
      if (input.resultType === 'tag') {
        const type = input.tagTypes?.[0];
        const results = (TAG_RESULTS[type] || []).map((name, index) => ({ entityId: `${type}:${name.toLowerCase().replaceAll(' ', '_')}`, name, type, affinity: Number((0.98 - index * 0.02).toFixed(2)) }));
        return { status: results.length ? 'ok' : 'empty', query: { resultType: 'urn:tag' }, results, evidence: evidence('/v2/insights') };
      }
      const deep = input.popularityMax !== undefined;
      const names = (deep ? DEEP : CORE)[input.resultType] || [];
      const results = names.map((name, index) => ({ entityId: `${input.resultType}-${deep ? 'deep' : 'core'}-${index}`, name, type: `urn:entity:${input.resultType}`,
        affinity: Number((0.95 - index * 0.1 - (deep ? 0.2 : 0)).toFixed(2)), popularity: deep ? 0.3 : 0.9,
        tags: [{ id: 'urn:tag:keyword:fixture:night', name: 'Night markets' }, { id: `urn:tag:keyword:fixture:${input.resultType}`, name: `${input.resultType} fixture tag` }],
        description: `${name} is a test-only fixture description.` }));
      return { status: results.length ? 'ok' : 'empty', query: { resultType: input.resultType }, results, evidence: evidence('/v2/insights') };
    },
  };
}
const PREDICTIONS = {
  brand: ['Patagonia', 'Muji', 'Aesop'], movie: ['Fixture Film Alpha', 'In the Mood for Love', 'Lost in Translation'], artist: ['Nujabes', 'Bonobo', 'Khruangbin'],
  book: ['Norwegian Wood', 'The Little Prince', 'Invisible Cities'], tv_show: ['Midnight Diner', 'Twin Peaks', 'Chef Stories'],
  // Predicted qualities: one matches a measured style tag; none is a measured work.
  style: ['Fixture Hushed', 'Melancholic', 'Nostalgic'], aesthetic: ['Minimal', 'Warm wood', 'Handmade'],
  // Qualities the model expects the works to share; Atmosphere meets the typed fixture's Atmospheric by its stem.
  qualities: ['Nocturnal', 'Wistful', 'Atmosphere'],
};
const DEFAULT_DOMAINS = ['brand', 'movie', 'artist', 'book', 'tv_show'];
const ALL_DOMAINS = [...DEFAULT_DOMAINS, 'style', 'aesthetic'];
// The Studio and the portable tool default to the shared qualities as well.
const STUDIO_DOMAINS = [...ALL_DOMAINS, 'qualities'];
// The model's frozen sketch matches the baseline fixture site, so only measured surprises can move a design away from it.
// Its font is a family of the repository's font library, as the Studio requires.
const SKETCH = { summary: 'A bright market stall page with photo cards and a leaf-green accent.', palette: ['#ffffff', '#2c6e49', '#f4efe6'], fonts: ['Jost'], sections: ['top', 'gallery', 'hero'], motifs: ['market baskets'] };
const assumptionFor = (domains, { sketch = SKETCH, predictions = {} } = {}) => ({ schemaVersion: '1.0', audienceSummary: 'Test-only prediction of what this audience enjoys.',
  predictions: Object.fromEntries(domains.map(domain => [domain, predictions[domain] || PREDICTIONS[domain]])), ...(sketch ? { designSketch: sketch } : {}) });
// Typed tags shaped like the recorded passes: look, mood and meaning tags on the works beside catalogue metadata. The
// first brand carries only metadata, the way an ice hockey team shared no quality with the films and books around it.
const typed = (type, name) => ({ id: `urn:tag:${type}:qloo:${name.toLowerCase().replace(/[^a-z0-9]+/gu, '_')}`, name });
const TYPED_TAGS = {
  brand: [[typed('platform', 'PC'), typed('brand_type', 'Outdoor Gear')], [typed('aesthetic_property', 'Minimalist'), typed('audience', 'Reflective')],
    [typed('aesthetic_property', 'Minimalist'), typed('core_value', 'Craftsmanship')], [typed('aesthetic_property', 'Clean Lines')]],
  movie: [[typed('style', 'Atmospheric'), typed('emotional_tone', 'Melancholic'), typed('theme', 'Memory')], [typed('style', 'Atmospheric'), typed('plot', 'Melancholic')],
    [typed('style', 'Atmospheric'), typed('theme', 'Identity')], [typed('emotional_tone', 'Wonder')]],
  artist: [[typed('music', 'Lo-Fi'), typed('style', 'Atmospheric')], [typed('music', 'Lo-Fi'), typed('audience', 'Reflective')], [typed('music', 'Experimental')], [typed('artist', 'Soulful')]],
  // Fixture Hushed is also a ranked style tag, so it stays with that ref; Minimalism is not Minimalist.
  book: [[typed('theme', 'Memory'), typed('emotional_tone', 'Melancholic')], [typed('theme', 'Memory'), typed('style', 'Fixture Hushed')], [typed('style', 'Fixture Hushed')], [typed('aesthetic_property', 'Minimalism')]],
  tv_show: [[typed('style', 'Atmospheric'), typed('theme', 'Routine')], [typed('theme', 'Routine'), typed('business_model', 'Subscription')], [typed('audience', 'Reflective')], []],
};
/** The fixture catalogue with typed tags on its core works; `empty` lists tag namespaces whose ranking returns nothing. */
function typedQloo(calls = [], { empty = [] } = {}) {
  const base = fakeQloo(calls);
  return { ...base, async getInsights(input) {
    if (input.resultType === 'tag' && empty.includes(input.tagTypes?.[0])) { calls.push({ tool: 'insights', input }); return { status: 'empty', results: [], evidence: evidence('/v2/insights') }; }
    const response = await base.getInsights(input);
    if (input.resultType === 'tag' || input.popularityMax !== undefined) return response;
    return { ...response, results: response.results.map((entity, index) => ({ ...entity, tags: [...entity.tags, ...(TYPED_TAGS[input.resultType]?.[index] || [])] })) };
  } };
}
async function typedInput(options) {
  const profile = await buildTasteProfile({ client: typedQloo([], options), references, knownNames: references.map(ref => ref.name) });
  const assumption = normalizeTasteAssumption(assumptionFor(profile.domains), { domains: profile.domains });
  return { profile, assumption, input: tasteInputFromProfile(profile, assumption) };
}
const references = ['Blade Runner', 'Brian Eno', 'Ambient Music', 'Unknown Zine'].map(name => ({ name, role: 'audience' }));
const cultureBrief = { brand: { notes: 'Seasonal and local.', protectedFiles: ['app.js'], protectedSnippets: [] }, audiences: [{ id: 'a1', label: 'Night-market regulars', references: references.map(ref => ref.name) }] };
const brief = 'Redesign a local food shop for night-market regulars while keeping the catalogue working.';

async function measuredInput() {
  const profile = await buildTasteProfile({ client: fakeQloo(), references, knownNames: references.map(ref => ref.name) });
  const assumption = normalizeTasteAssumption(assumptionFor(profile.domains), { domains: profile.domains });
  return { profile, assumption, input: tasteInputFromProfile(profile, assumption) };
}

const LAYERS = ['palette', 'typography', 'layout', 'structure', 'interaction', 'voice', 'imagery'];
// Each arm's voice writes one page line and the first catalogue item's description in the starter's site-data.
const VOICE = { qloo: ['Late light, slow food', 'Pressed slowly for late suppers.'], baseline: ['Fresh from the market', 'Picked for the morning table.'] };
const STARTER_HTML = getTemplate('local-food').files['index.html'];
const STARTER_DATA = siteData(STARTER_HTML);
/** The starter's data island with its narrative in an arm's voice; every product fact stays as the starter has it. */
function dataIsland(mode, { voice = true, change = {} } = {}) {
  const qloo = mode === 'qloo';
  const data = { ...STARTER_DATA, ...(voice ? { addLabel: qloo ? 'Set aside for supper' : 'Add to basket' } : {}),
    items: STARTER_DATA.items.map((item, index) => ({ ...item, ...(voice && !index ? { description: VOICE[qloo ? 'qloo' : 'baseline'][1] } : {}) })), ...change };
  return `<script type="application/json" id="site-data">${JSON.stringify(data).replace(/</gu, '\\u003c')}</script>`;
}
/** The style or aesthetic ref a fixture device anchors to: a measured surprise when the input has measured tags. */
function tagRef(input, domain) {
  const all = (input?.entities || []).filter(entity => entity.domain === domain), measured = all.filter(entity => entity.source === 'qloo');
  const pool = measured.length ? measured : all;
  return pool.find(entity => entity.surprise) || pool[0] || null;
}
function dnaFor(mode, refs, input) {
  const qloo = mode === 'qloo';
  // A measured anchor's first returned tag is the quality its device translates.
  const tagOf = ref => input?.entities?.find(entity => entity.ref === ref)?.tags?.[0] ?? 'Night markets';
  const devices = refs.map((ref, index) => {
    const layer = LAYERS[index % LAYERS.length];
    const tokens = { palette: { colors: qloo ? ['#1d1a17', '#c9a227'] : ['#ffffff', '#2c6e49'] }, typography: { fonts: [qloo ? 'Gelasio' : 'Jost'] },
      layout: { css: [{ property: 'grid-template-columns', value: qloo ? '2fr 1fr' : 'repeat(3, 1fr)' }] }, structure: { ids: [qloo ? 'ledger' : 'gallery'] },
      interaction: { ids: ['taste-toggle'] }, voice: { copy: VOICE[mode === 'qloo' ? 'qloo' : 'baseline'] }, imagery: { css: [{ property: 'aspect-ratio', value: '1 / 1' }] } }[layer];
    return { id: `dna${index + 1}`, layer, device: `Test-only ${layer} device ${index + 1}`, anchors: [ref], qualities: [qloo ? tagOf(ref) : 'Assumed calm'], translation: `Test-only interpretation of the anchor for ${layer}.`, tokens };
  });
  // With style and aesthetic refs, motion and an SVG illustration translate them, as the protocol requires.
  const style = tagRef(input, 'style'), aesthetic = tagRef(input, 'aesthetic');
  const quality = (entity, own) => entity.source === 'qloo' ? [entity.name] : [own];
  if (style) devices.push({ id: 'dna-motion', layer: 'motion', device: 'Test-only drifting lantern motion', anchors: [style.ref], qualities: quality(style, 'Assumed slow'),
    translation: 'Test-only: the style quality becomes a slow twelve-second drift.', tokens: { keyframes: ['fixture-drift'], css: [{ property: 'animation', value: 'fixture-drift 12s ease-in-out infinite' }] } });
  if (aesthetic) devices.push({ id: 'dna-art', layer: 'layout', device: 'Test-only lacquered line drawing', anchors: [aesthetic.ref], qualities: quality(aesthetic, 'Assumed handmade'),
    translation: 'Test-only: the aesthetic quality becomes an eight-shape line drawing.', tokens: { svg: ['fixture-art'] } });
  return { schemaVersion: '1.0', thesis: `A test-only ${mode} design thesis.`, devices };
}
// Both fixture sites draw the same eight-shape SVG and run one drifting loop with its reduced-motion fallback and pause control.
const ART = `<svg id="fixture-art" viewBox="0 0 120 80" aria-hidden="true">${[10, 30, 50, 70].map(x => `<circle cx="${x}" cy="20" r="6"/><rect x="${x}" y="50" width="8" height="8"/>`).join('')}</svg>`;
const MOTION_CSS = '@keyframes fixture-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}.drift{animation:fixture-drift 12s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.drift{animation:none}}';
function siteFor(mode, { omitCopy = false } = {}) {
  const qloo = mode === 'qloo';
  const copy = omitCopy ? 'Copy pending' : VOICE[qloo ? 'qloo' : 'baseline'][0];
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture food shop</title><link rel="stylesheet" href="styles.css"></head><body><header id="top"><h1>Fixture food shop</h1></header><main><section id="${qloo ? 'ledger' : 'gallery'}" class="grid"><p>${copy}</p><button id="taste-toggle" type="button">Toggle</button></section><button type="button" data-motion-toggle aria-pressed="false">Pause motion</button><div class="drift">${ART}</div></main>${dataIsland(mode, { voice: !omitCopy })}<script src="app.js"></script></body></html>`,
    css: (qloo ? "@font-face{font-family:'Gelasio';src:url('fonts/gelasio-latin-wght-normal.woff2') format('woff2')}:root{--ink:#1d1a17;--gold:#c9a227}body{font-family:Gelasio,serif;color:var(--ink)}.grid{display:grid;grid-template-columns:2fr 1fr}.frame{aspect-ratio:1 / 1}"
      : "@font-face{font-family:'Jost';src:url('fonts/jost-latin-wght-normal.woff2') format('woff2')}:root{--paper:#ffffff;--leaf:#2c6e49}body{font-family:Jost,\"Trebuchet MS\",sans-serif}.grid{display:grid;grid-template-columns:repeat(3, 1fr)}.frame{aspect-ratio:1 / 1}") + MOTION_CSS,
  };
}

test('Qloo client sends tag search, tag seeds, seed exclusion and popularity bounds as documented parameters', async () => {
  const urls = [];
  const client = new QlooClient({ apiKey: 'fixture-key', fetchImpl: async url => { urls.push(new URL(url)); return new Response(JSON.stringify({ results: { tags: [{ id: 'urn:tag:genre:music:ambient', name: 'Ambient' }] } })); } });
  const tags = await client.searchTags({ query: 'ambient', limit: 3 });
  assert.equal(urls[0].pathname, '/v2/tags'); assert.equal(urls[0].searchParams.get('filter.query'), 'ambient'); assert.equal(urls[0].searchParams.get('take'), '3');
  assert.equal(tags.results[0].entityId, 'urn:tag:genre:music:ambient');
  await client.getInsights({ seedTagIds: ['urn:tag:genre:music:ambient'], resultType: 'movie', excludeEntityIds: ['E-1'], popularityMax: 0.6, limit: 5 });
  const insights = urls[1];
  assert.equal(insights.pathname, '/v2/insights');
  assert.equal(insights.searchParams.get('signal.interests.tags'), 'urn:tag:genre:music:ambient');
  assert.equal(insights.searchParams.has('signal.interests.entities'), false);
  assert.equal(insights.searchParams.get('filter.exclude.entities'), 'E-1');
  assert.equal(insights.searchParams.get('filter.popularity.max'), '0.6');
  assert.equal(insights.searchParams.get('filter.type'), 'urn:entity:movie');
  for (const input of [{ seedEntityIds: ['E-1'], resultType: 'movie', popularityMax: 1.5 }, { seedEntityIds: ['E-1'], resultType: 'movie', popularityMin: 0.8, popularityMax: 0.2 },
    { seedTagIds: ['ambient'], resultType: 'movie' }, { resultType: 'movie' }]) await assert.rejects(client.getInsights(input), { code: 'QLOO_INPUT_INVALID' });
  assert.equal(urls.length, 2, 'Invalid inputs are rejected before any request.');
});

test('name matching is strict for catalogue resolution and liberal for prediction overlap', () => {
  assert.equal(tasteNameMatch('Blade Runner', 'Blade Runner'), 1);
  assert.equal(tasteNameMatch('The Beatles', 'Beatles'), 1);
  assert.ok(tasteNameMatch('Ambient Music', 'Ambient Music Therapy') < 0.75);
  assert.ok(tasteNameMatch('Ambient Music', 'Ambient') >= 0.5);
  assert.equal(predictionMatches('Blade Runner', 'Blade Runner 2049'), true);
  assert.equal(predictionMatches('Amélie', 'Amelie'), true);
  assert.equal(predictionMatches('Muji', 'Fixture Ceramics'), false);
});

test('taste references use audience preferences first and never brand or world-canon references', () => {
  const mixed = [{ name: 'Brand mark', role: 'brand' }, { name: 'Canon world', role: 'world-canon' }, { name: 'Creator book', role: 'creator-inspiration' }, { name: 'Audience film', role: 'audience', audienceId: 'a1' }, { name: 'Other film', role: 'audience', audienceId: 'a2' }];
  assert.deepEqual(selectTasteReferences(mixed, { audienceId: 'a1' }).references.map(ref => ref.name), ['Audience film']);
  assert.deepEqual(selectTasteReferences(mixed.slice(0, 3)), { basis: 'creator-inspiration', references: [{ name: 'Creator book', role: 'creator-inspiration' }] });
  assert.equal(selectTasteReferences(mixed.slice(0, 2)).basis, 'none');
});

test('the host taste pass resolves seeds, excludes them, adds a lower-popularity band and never invents unresolved seeds', async () => {
  const calls = [];
  const profile = await buildTasteProfile({ client: fakeQloo(calls), references, knownNames: references.map(ref => ref.name) });
  assert.equal(profile.status, 'ok');
  assert.deepEqual(profile.seeds.map(seed => seed.resolution), ['entity', 'entity', 'tag', 'unresolved']);
  assert.equal(profile.seeds[2].tagId, 'urn:tag:genre:music:ambient');
  assert.ok(profile.limitations.some(item => /Unknown Zine/.test(item)));
  const insights = calls.filter(call => call.tool === 'insights');
  assert.equal(insights.length, 9, 'Five core domains, brand and film deep cuts, and the style and aesthetic tags.');
  for (const call of insights) {
    const tag = call.input.resultType === 'tag';
    assert.deepEqual(call.input.seedEntityIds, ['E-BLADE', 'E-ENO']); assert.equal(call.input.explainability, true);
    // Tag results rank qualities, so only entity requests exclude the seeds, and with entity seeds they leave the tag seed out.
    assert.deepEqual(call.input.seedTagIds, tag ? undefined : ['urn:tag:genre:music:ambient']);
    assert.deepEqual(call.input.excludeEntityIds, tag ? undefined : ['E-BLADE', 'E-ENO']);
  }
  assert.ok(profile.limitations.includes('style and aesthetic tags were ranked from the entity seeds alone, so "Ambient Music" did not shape them.'));
  const tagCalls = insights.filter(call => call.input.resultType === 'tag');
  assert.deepEqual(tagCalls.map(call => [call.input.tagTypes, call.input.parentTypes, call.input.limit]),
    [[['urn:tag:style:qloo'], ['movie', 'tv_show'], 8], [['urn:tag:aesthetic_property:qloo'], undefined, 8]]);
  assert.deepEqual(insights.filter(call => call.input.popularityMax === 0.6).map(call => call.input.resultType).sort(), ['brand', 'movie']);
  assert.equal(profile.calls, calls.length);
  assert.equal(profile.entities.length, 36);
  const hushed = profile.entities.find(entity => entity.name === 'Fixture Hushed');
  assert.deepEqual([hushed.domain, hushed.ref, hushed.tags, hushed.affinity], ['style', 'urn:tag:style:qloo:fixture_hushed', ['Fixture Hushed'], 0.98], 'A measured tag is its own quality.');
  assert.equal(profile.signature.some(tag => /Fixture Hushed/.test(tag.name)), false, 'Tags do not enter the entity tag signature.');
  assert.equal(profile.entities.find(entity => entity.name === 'Blade Runner 2049').knownFromBrief, true);
  assert.equal(profile.entities.find(entity => entity.name === 'Fixture Kiln').band, 'deep-cut');
  const unresolved = await buildTasteProfile({ client: fakeQloo(), references: [{ name: 'Nothing Matches' }] });
  assert.equal(unresolved.status, 'unresolved'); assert.deepEqual(unresolved.entities, []);
  const thin = await buildTasteProfile({ client: { ...fakeQloo(), getInsights: async () => ({ status: 'empty', results: [], evidence: evidence('/v2/insights') }) }, references });
  assert.equal(thin.status, 'insufficient');
  const budget = await buildTasteProfile({ client: fakeQloo(), references, maxCalls: 6 });
  assert.equal(budget.calls, 6); assert.ok(budget.limitations.some(item => /budget/.test(item)));
});

test('a category word decides what may seed a reference: films are not a music artist, and ambient music is a genre', async () => {
  const calls = [];
  const profile = await buildTasteProfile({ client: fakeQloo(calls), references: ['Studio Ghibli films', 'ambient music', 'Nujabes music', 'Paterson'].map(name => ({ name, role: 'audience' })) });
  const [ghibli, ambient, nujabes, paterson] = profile.seeds;
  assert.equal(ghibli.resolution, 'unresolved');
  assert.equal(ghibli.limitation, 'The closest match, Studio Ghibli, is a music artist, not films, so it was not used as a seed.');
  assert.ok(profile.limitations.includes('"Studio Ghibli films" was not resolved and did not contribute to the profile. The closest match, Studio Ghibli, is a music artist, not films, so it was not used as a seed.'));
  assert.deepEqual([ambient.resolution, ambient.tagId, ambient.matchedName], ['tag', 'urn:tag:genre:music:ambient', 'Ambient'], 'The genre, not the place-ambience tag or the artist named Ambient Music.');
  assert.deepEqual([nujabes.resolution, nujabes.entityId], ['entity', 'E-NUJABES'], 'Without a genre of that name, the artist seeds.');
  assert.equal(paterson.entityId, 'E-PAT-FILM');
  const lookups = query => calls.filter(call => call.query === query);
  assert.deepEqual(lookups('ambient music'), [{ tool: 'tags', query: 'ambient music', tagTypes: ['urn:tag:genre:music'] }], 'A genre word asks for a genre tag first and stops there.');
  assert.deepEqual(lookups('Studio Ghibli films').map(call => call.tool), ['search', 'tags']);
  assert.deepEqual(lookups('Nujabes music').map(call => call.tool), ['tags', 'search']);
  assert.deepEqual(lookups('Paterson').map(call => call.tool), ['search'], 'A name without a category word resolves as before.');
});

test('seeds prefer a same-named work over a place, and a rate-limited request is retried within the budget', async () => {
  const film = await buildTasteProfile({ client: fakeQloo(), references: [{ name: 'Paterson' }] });
  assert.equal(film.seeds[0].entityId, 'E-PAT-FILM'); assert.equal(film.seeds[0].type, 'urn:entity:movie');
  const place = await buildTasteProfile({ client: fakeQloo(), references: [{ name: 'Kyoto' }] });
  assert.equal(place.seeds[0].entityId, 'E-KYOTO', 'A place still seeds when nothing else matches.');
  const client = fakeQloo();
  const limit = () => Object.assign(new Error('Qloo rate limit reached. Try again later.'), { code: 'QLOO_RATE_LIMIT', retryable: true });
  let limited = 0;
  const log = [];
  const once = await buildTasteProfile({ client: { ...client, async getInsights(input) { if (input.resultType === 'artist' && !limited++) throw limit(); return client.getInsights(input); } },
    references, retryDelayMs: 0, onCall: call => log.push([call.tool, call.status, call.error?.code]) });
  assert.equal(once.status, 'ok'); assert.equal(once.calls, 15, 'The retried request counts against the call budget.');
  assert.ok(once.entities.some(entity => entity.domain === 'artist'));
  assert.equal(once.limitations.some(item => /insights failed/.test(item)), false);
  assert.deepEqual(log.filter(([, status]) => status === 'error'), [['qloo_get_insights', 'error', 'QLOO_RATE_LIMIT']], 'The limited attempt stays in the call record.');
  assert.equal(once.limitations.some(item => /entity seeds alone after/.test(item)), false, 'A rate limit is not a seed failure, so the request is repeated as sent.');
  const always = await buildTasteProfile({ client: { ...client, async getInsights(input) { if (input.resultType === 'artist') throw limit(); return client.getInsights(input); } }, references, retryDelayMs: 0 });
  assert.equal(always.calls, 16); assert.ok(always.limitations.includes('artist (core) insights failed: QLOO_RATE_LIMIT.'));
  // A timeout or server error is retried like a rate limit; a refusal the client does not mark retryable is not.
  const transient = (code, retryable) => Object.assign(new Error('Test-only Qloo failure.'), { code, retryable });
  let slow = 0, refused = 0;
  const recovered = await buildTasteProfile({ client: { ...client, async getInsights(input) {
    if (input.resultType === 'book' && !slow++) throw transient('QLOO_TIMEOUT', true);
    if (input.resultType === 'tv_show') { refused++; throw transient('QLOO_UPSTREAM', false); }
    return client.getInsights(input);
  } }, references: references.filter(ref => ref.name !== 'Ambient Music'), retryDelayMs: 0 });
  assert.ok(recovered.entities.some(entity => entity.domain === 'book'), 'The timed-out request succeeded on its retry.');
  assert.equal(refused, 1, 'A non-retryable failure is sent once.'); assert.ok(recovered.limitations.includes('tv_show (core) insights failed: QLOO_UPSTREAM.'));
  assert.equal(always.entities.some(entity => entity.domain === 'artist'), false, 'A persistent limit is reported, never filled in.');
  // A failed tag request is reported like any domain, but tags never decide whether the profile can govern a design.
  const noTags = await buildTasteProfile({ client: { ...client, async getInsights(input) { if (input.resultType === 'tag') throw limit(); return client.getInsights(input); } }, references, rateLimitRetries: 0 });
  assert.equal(noTags.status, 'ok'); assert.ok(noTags.limitations.includes('style tags insights failed: QLOO_RATE_LIMIT.'));
  assert.equal(noTags.entities.some(entity => entity.domain === 'style'), false);
  const onlyTags = await buildTasteProfile({ client: { ...client, async getInsights(input) { return input.resultType === 'tag' ? client.getInsights(input) : { status: 'empty', results: [], evidence: evidence('/v2/insights') }; } }, references });
  assert.equal(onlyTags.status, 'insufficient', 'Tags alone cannot govern a design.');
});

test('a tag seed joins entity seeds only where Qloo answers: tag rankings leave it out, and a failing entity request drops it', async () => {
  const client = fakeQloo();
  const failure = code => Object.assign(new Error('Test-only Qloo failure.'), { code, retryable: true });
  // Shaped like the live Echo Atlas pass and probe: tag rankings seeded with a genre tag got HTTP 500, the artist request
  // with both kinds of seed always timed out, and the film request timed out once before it answered.
  const sent = [];
  let filmTimeouts = 0;
  const profile = await buildTasteProfile({ client: { ...client, async getInsights(input) {
    sent.push(input);
    if (input.resultType === 'tag' && input.seedTagIds) throw failure('QLOO_UPSTREAM');
    if (input.resultType === 'artist' && input.seedTagIds) throw failure('QLOO_TIMEOUT');
    if (input.resultType === 'movie' && input.popularityMax === undefined && !filmTimeouts++) throw failure('QLOO_TIMEOUT');
    return client.getInsights(input);
  } }, references, retryDelayMs: 0 });
  const core = type => sent.filter(input => input.resultType === type && input.popularityMax === undefined);
  assert.deepEqual(core('tag').map(input => [input.tagTypes[0], input.seedEntityIds, input.seedTagIds]),
    [['urn:tag:style:qloo', ['E-BLADE', 'E-ENO'], undefined], ['urn:tag:aesthetic_property:qloo', ['E-BLADE', 'E-ENO'], undefined]], 'One request per tag domain, from the entity seeds.');
  assert.ok(['style', 'aesthetic'].every(domain => profile.entities.some(entity => entity.domain === domain)));
  assert.deepEqual(core('artist').map(input => input.seedTagIds), [['urn:tag:genre:music:ambient'], ['urn:tag:genre:music:ambient'], undefined], 'Repeated once as sent, then sent without the tag seed.');
  assert.deepEqual([core('artist')[2].seedEntityIds, core('artist')[2].excludeEntityIds], [['E-BLADE', 'E-ENO'], ['E-BLADE', 'E-ENO']]);
  assert.ok(profile.entities.some(entity => entity.domain === 'artist'));
  assert.deepEqual(core('movie').map(input => input.seedTagIds), [['urn:tag:genre:music:ambient'], ['urn:tag:genre:music:ambient']], 'A single timeout keeps both kinds of seed.');
  assert.deepEqual(profile.limitations.filter(item => /entity seeds alone/.test(item)), ['style and aesthetic tags were ranked from the entity seeds alone, so "Ambient Music" did not shape them.',
    'artist (core) was ranked from the entity seeds alone after the request with "Ambient Music" failed: QLOO_TIMEOUT.']);
  assert.equal(profile.limitations.some(item => /insights failed/.test(item)), false);
  assert.equal(profile.calls, 17, 'Five lookups, nine insights requests, one film retry and two more artist requests.');
  // Without an entity seed there is nothing to fall back to: the tag seed alone is sent and a failure is reported.
  const tagOnly = await buildTasteProfile({ client: { ...client, async getInsights(input) { if (input.resultType === 'tag') throw failure('QLOO_UPSTREAM'); return client.getInsights(input); } },
    references: [{ name: 'Ambient Music', role: 'audience' }], retryDelayMs: 0, rateLimitRetries: 0 });
  assert.deepEqual(tagOnly.seeds.map(seed => seed.resolution), ['tag']);
  assert.ok(tagOnly.limitations.includes('style tags insights failed: QLOO_UPSTREAM.'));
  assert.equal(tagOnly.limitations.some(item => /entity seeds alone/.test(item)), false);
});

test('typed tags: works lead with their look, mood and meaning, metadata is left out, and shared qualities rank by their spread', async () => {
  const calls = [];
  const profile = await buildTasteProfile({ client: typedQloo(calls), references, knownNames: references.map(ref => ref.name) });
  assert.equal(calls.filter(call => call.tool === 'insights').length, 9, 'Qualities cost no request.');
  const work = name => profile.entities.find(entity => entity.name === name);
  assert.deepEqual(work('Fixture Ceramics').tags, ['Minimalist', 'Reflective', 'Night markets', 'brand fixture tag'], 'Look, mood and meaning lead; other tags follow.');
  assert.deepEqual(work('Fixture Ceramics').facets, { look: ['Minimalist'], meaning: ['Reflective'] });
  assert.deepEqual(work('Fixture Workwear Co').tags, ['Night markets', 'brand fixture tag'], 'A platform and a brand type are catalogue metadata.');
  assert.equal(work('Fixture Workwear Co').facets, undefined);
  assert.deepEqual(work('Fixture Detective Show').tags, ['Routine', 'Night markets', 'tv_show fixture tag'], 'So is a business model.');
  const qualities = profile.entities.filter(entity => entity.domain === 'qualities');
  // Spread outranks weight: Reflective, in three domains, leads Memory, whose works have more affinity in two.
  assert.deepEqual(qualities.map(quality => [quality.family, quality.name, quality.count, quality.domains.length, quality.score]), [
    ['look', 'Atmospheric', 5, 3, 13.35], ['look', 'Minimalist', 2, 1, 1.6], ['mood', 'Melancholic', 3, 2, 5.5], ['mood', 'Lo-Fi', 2, 1, 1.8],
    ['meaning', 'Reflective', 3, 3, 7.35], ['meaning', 'Memory', 3, 2, 5.5], ['meaning', 'Routine', 2, 1, 1.8]]);
  const [atmospheric] = qualities;
  assert.deepEqual([atmospheric.ref, atmospheric.band, atmospheric.affinity, atmospheric.domains, atmospheric.examples, atmospheric.tags],
    ['quality:look:atmospheric', 'derived', 0.89, ['movie', 'artist', 'tv_show'], ['Fixture Film Alpha', 'Fixture Ambient Duo', 'Fixture Kitchen Series'], ['Atmospheric']]);
  assert.deepEqual(atmospheric.refs, ['movie-core-0', 'artist-core-0', 'tv_show-core-0', 'movie-core-1', 'movie-core-2']);
  assert.equal(atmospheric.evidenceIds.length, 3, 'It rests on the film, music and TV responses.');
  assert.equal(qualities.some(quality => quality.name === 'Fixture Hushed'), false, 'A name the style ranking returned stays with that ref.');
  assert.equal(qualities.some(quality => ['Clean Lines', 'Minimalism', 'Wonder', 'Identity'].includes(quality.name)), false, 'A tag on one work is not shared.');
  assert.deepEqual(profile.results.at(-1), { domain: 'qualities', band: 'derived', status: 'ok', count: 7 });
  // Without the qualities domain, as in the game harness, tags keep Qloo's order and nothing is derived.
  const untyped = await buildTasteProfile({ client: typedQloo(), references, domains: ALL_DOMAINS });
  assert.deepEqual(untyped.entities.find(entity => entity.name === 'Fixture Workwear Co').tags, ['Night markets', 'brand fixture tag', 'PC', 'Outdoor Gear']);
  assert.equal(untyped.entities.some(entity => entity.domain === 'qualities' || entity.facets), false);
  assert.equal(untyped.results.some(result => result.domain === 'qualities'), false);
  // Works without typed tags share no quality, which is reported rather than filled in.
  const bare = await buildTasteProfile({ client: fakeQloo(), references });
  assert.ok(bare.limitations.includes('No look, mood or meaning tag was shared by two or more measured works, so no qualities were derived.'));
  assert.deepEqual(bare.results.at(-1), { domain: 'qualities', band: 'derived', status: 'empty', count: 0 });
});

test('with shared qualities, the required anchors are the strongest quality of each family and the works most central to them', async () => {
  const { profile, assumption, input } = await typedInput();
  // The music and TV works are equally central and equally liked; the TV work is a surprise, while the brief's Ambient Music names the duo.
  assert.deepEqual(input.requiredAnchors, ['quality:look:atmospheric', 'quality:mood:melancholic', 'quality:meaning:reflective', 'movie-core-0', 'tv_show-core-0', 'artist-core-0']);
  // Chosen by surprise and affinity alone, the anchors would include the brand that carries none of the qualities.
  const works = input.entities.filter(entity => entity.source === 'qloo' && !['style', 'aesthetic', 'qualities'].includes(entity.domain));
  assert.ok(selectRequiredAnchors(works).includes('brand-core-0'));
  // A predicted quality meets a measured one by its stem or from another quality domain, never a work.
  const quality = name => input.entities.find(entity => entity.domain === 'qualities' && entity.source === 'qloo' && entity.name === name);
  assert.equal(quality('Atmospheric').predictedByModel, true, 'Atmosphere is Atmospheric.');
  assert.equal(quality('Minimalist').predictedByModel, true, 'The aesthetic prediction Minimal is Minimalist.');
  assert.equal(quality('Melancholic').predictedByModel, true, 'A predicted style quality can name a shared mood.');
  assert.deepEqual(['Lo-Fi', 'Reflective', 'Memory', 'Routine'].map(name => quality(name).surprise), [true, true, true, true]);
  assert.equal(predictionMatches('Atmosphere', 'Atmospheric'), false, 'Works and ranked tags keep the stricter match.');
  assert.deepEqual([input.metrics.measuredQualities, input.metrics.qualitiesPredicted, input.metrics.qualitySurprises, input.metrics.qualityPredictions], [7, 3, 4, 3]);
  assert.deepEqual([input.metrics.measuredEntities, input.metrics.predictions, input.metrics.tagPredictions, input.metrics.measuredTags], [28, 15, 6, 8], 'Entity and tag metrics keep their meaning.');
  assert.equal(input.entities.some(entity => entity.facets), false, 'The facets stay in the profile, and the typed tags lead with them.');
  assert.deepEqual(profile.entities.find(entity => entity.ref === 'movie-core-0').facets, { look: ['Atmospheric'], mood: ['Melancholic'], meaning: ['Memory'] });
  // The agent reads each quality with its family, how many works carry it, their domains and a few of them.
  const view = compactTasteInput(input);
  assert.deepEqual(view.requiredAnchors[0], { ref: 'quality:look:atmospheric', name: 'Atmospheric', domain: 'qualities', source: 'qloo', band: 'derived', family: 'look', count: 5,
    domains: ['movie', 'artist', 'tv_show'], examples: ['Fixture Film Alpha', 'Fixture Ambient Duo', 'Fixture Kitchen Series'], affinity: 0.89, tags: ['Atmospheric'],
    predictedByModel: true, surprise: false, required: true });
  // A selected direction's anchors stay as they are.
  assert.deepEqual(tasteInputFromProfile(profile, assumption, { requiredRefs: ['movie-core-3', 'quality:mood:lo-fi'] }).requiredAnchors, ['movie-core-3', 'quality:mood:lo-fi']);
  // The artifact's own medium, such as games for a game site, takes the first work place with its most central work.
  assert.deepEqual(tasteInputFromProfile(profile, assumption, { medium: ['book'] }).requiredAnchors.slice(3), ['book-core-0', 'movie-core-0', 'tv_show-core-0']);
  // Without Qloo the first predicted qualities stand beside the predicted works in the same places.
  const ownAssumption = normalizeTasteAssumption(assumptionFor(STUDIO_DOMAINS), { domains: STUDIO_DOMAINS });
  const own = tasteInputFromAssumption(ownAssumption);
  const names = input => input.requiredAnchors.map(ref => input.entities.find(entity => entity.ref === ref).name);
  assert.deepEqual(names(own), ['Nocturnal', 'Wistful', 'Atmosphere', 'Patagonia', 'Fixture Film Alpha', 'Nujabes']);
  assert.deepEqual(names(tasteInputFromAssumption(ownAssumption, { medium: ['tv_show'] })).slice(3), ['Midnight Diner', 'Patagonia', 'Fixture Film Alpha']);
  assert.deepEqual(own.metrics, { predictions: 15, tagPredictions: 6, qualityPredictions: 3 });
  // Without shared qualities the medium changes nothing, so earlier selections are reproduced.
  const older = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(ALL_DOMAINS), { domains: ALL_DOMAINS }), { medium: ['tv_show'] });
  assert.deepEqual(names(older), ['Patagonia', 'Fixture Film Alpha', 'Nujabes', 'Norwegian Wood', 'Midnight Diner', 'Muji']);
});

test('a frozen prediction separates measured surprises from what the model and the brief already contained', async () => {
  assert.throws(() => normalizeTasteAssumption({ ...assumptionFor(['brand']), extra: true }, { domains: ['brand'] }), /Unsupported field/);
  assert.throws(() => normalizeTasteAssumption(assumptionFor(['brand']), { domains: ['brand', 'movie'] }), /predictions\.movie/);
  assert.throws(() => normalizeTasteAssumption({ ...assumptionFor(['brand']), predictions: { brand: ['One', 'Two'] } }, { domains: ['brand'] }), /3-6 items/);
  const { input } = await measuredInput();
  const byName = name => input.entities.find(entity => entity.name === name && entity.source === 'qloo');
  assert.equal(byName('Fixture Film Alpha').predictedByModel, true); assert.equal(byName('Fixture Film Alpha').surprise, false);
  assert.equal(byName('Blade Runner 2049').surprise, false);
  assert.equal(byName('Fixture Kiln').surprise, true);
  const own = input.entities.find(entity => entity.source === 'model-assumption' && entity.name === 'Fixture Film Alpha');
  assert.equal(own.confirmedBy, byName('Fixture Film Alpha').ref); assert.equal(own.ref, 'M04');
  assert.equal(input.metrics.measuredEntities, 28); assert.equal(input.metrics.predictedByModel, 1); assert.equal(input.metrics.predictionsConfirmed, 1);
  assert.equal(input.metrics.surprises, input.metrics.measuredEntities - input.metrics.predictedByModel - input.metrics.knownFromBrief);
  // Measured tags are counted on their own, so the entity metrics keep their earlier meaning.
  assert.deepEqual([input.metrics.measuredTags, input.metrics.tagsPredicted, input.metrics.tagSurprises, input.metrics.tagPredictions, input.metrics.predictions], [8, 1, 7, 6, 15]);
  assert.equal(byName('Fixture Hushed').predictedByModel, true); assert.equal(byName('Fixture Lantern Lit').surprise, true);
  assert.ok(input.requiredAnchors.every(ref => !['style', 'aesthetic'].includes(input.entities.find(entity => entity.ref === ref).domain)), 'Required anchors are works, as before.');
  // A predicted quality never counts as predicting a work of the same name, nor a predicted work as predicting a tag.
  const crossed = tasteInputFromProfile({ entities: [{ ref: 'brand-x', entityId: 'brand-x', name: 'Calm', domain: 'brand', band: 'core' }, { ref: 'urn:tag:style:qloo:muji', entityId: 'urn:tag:style:qloo:muji', name: 'Muji', domain: 'style', band: 'core', tags: ['Muji'] }] },
    { entries: [{ id: 'M01', domain: 'brand', name: 'Muji' }, { id: 'M02', domain: 'style', name: 'Calm' }] });
  assert.deepEqual(crossed.entities.filter(entity => entity.source === 'qloo').map(entity => entity.surprise), [true, true]);
  assert.equal(input.requiredAnchors.length, 6);
  assert.equal(new Set(input.requiredAnchors.map(ref => input.entities.find(entity => entity.ref === ref).domain)).size >= 5, true, 'Required anchors are spread across domains.');
  assert.ok(input.requiredAnchors.every(ref => input.entities.find(entity => entity.ref === ref).surprise), 'Surprises lead the required anchors.');
  const view = compactTasteInput(input);
  assert.equal(view.requiredAnchors.every(anchor => anchor.required), true);
  assert.equal(view.entities.length, input.entities.length);
  const baseline = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(DEFAULT_DOMAINS), { domains: DEFAULT_DOMAINS }));
  assert.equal(baseline.source, 'model-assumption'); assert.equal(baseline.requiredAnchors.length, 6); assert.ok(baseline.entities.every(entity => entity.source === 'model-assumption'));
});

test('a Design DNA must be concrete, checkable and account for every required anchor', async () => {
  const { input } = await measuredInput();
  const dna = normalizeDesignDna(dnaFor('qloo', input.requiredAnchors, input), { input });
  assert.equal(dna.devices.length, 8); assert.equal(dna.stats.qlooAnchoredDevices, 8); assert.equal(dna.stats.surpriseAnchoredDevices, 8);
  assert.deepEqual(dna.coverage.used, input.requiredAnchors);
  const source = dnaFor('qloo', input.requiredAnchors, input);
  const own = input.entities.find(entity => entity.source === 'model-assumption').ref;
  // The first six devices carry the required anchors; the last two are the motion and illustration devices.
  const works = source.devices.slice(0, 6), tagged = source.devices.slice(6);
  const cases = [
    [{ ...source, devices: source.devices.map((device, index) => index ? device : { ...device, anchors: ['invented-entity'] }) }, /exactly as returned/],
    [{ ...source, devices: source.devices.map((device, index) => index ? device : { ...device, tokens: { colors: ['#111111'] } }) }, /at least two hex colors/],
    [{ ...source, devices: source.devices.map((device, index) => index !== 1 ? device : { ...device, tokens: { fonts: ['serif'] } }) }, /at least one named font family/],
    [{ ...source, devices: [...works.slice(0, 5), ...tagged] }, /Missing:/],
    [{ ...source, devices: source.devices.map(device => ({ ...device, layer: ['palette', 'typography'].includes(device.layer) ? device.layer : 'voice', tokens: ['palette', 'typography'].includes(device.layer) ? device.tokens : { copy: ['Visible test line'] } })) }, /at least one device in layout/],
    [{ ...source, devices: source.devices.map(device => ({ ...device, tokens: {} })) }, /at least one literal token|two hex colors/],
    [{ ...source, devices: [...works.slice(0, 3), ...works.slice(3).map(device => ({ ...device, anchors: [own] })), ...tagged],
      rejected: input.requiredAnchors.slice(3).map(ref => ({ ref, reason: 'Test-only rejection with a specific reason.' })) }, /At most 2 required anchors/],
  ];
  for (const [value, pattern] of cases) assert.throws(() => normalizeDesignDna(value, { input }), pattern);
  const rejected = normalizeDesignDna({ ...source, devices: [...works.slice(0, 4), { ...works[4], anchors: [own] }, works[5], ...tagged],
    rejected: [{ ref: input.requiredAnchors[4], reason: 'Its returned qualities conflict with the product facts.' }] }, { input });
  assert.deepEqual(rejected.coverage.rejected, [input.requiredAnchors[4]]);
});

test('motion translates a style tag and an SVG illustration an aesthetic tag, measured ones when the run has them', async () => {
  const { input } = await measuredInput();
  const source = dnaFor('qloo', input.requiredAnchors, input);
  const works = source.devices.slice(0, 6), [motion, art] = source.devices.slice(6);
  const dna = normalizeDesignDna(source, { input });
  assert.deepEqual(dna.devices.find(device => device.id === 'dna-motion').tokens.keyframes, ['fixture-drift']);
  assert.deepEqual(dna.devices.find(device => device.id === 'dna-motion').qualities, ['Fixture Lantern Lit'], 'A measured tag names itself as the quality.');
  assert.deepEqual(dna.devices.find(device => device.id === 'dna-art').tokens.svg, ['fixture-art']);
  const predictedStyle = input.entities.find(entity => entity.domain === 'style' && entity.source === 'model-assumption').ref;
  for (const [devices, pattern] of [
    [[...works, art], /Include a motion device anchored to a measured style ref .*Fixture Lantern Lit \(urn:tag:style:qloo:fixture_lantern_lit\)/],
    [[...works, { ...motion, anchors: [predictedStyle], qualities: ['Assumed slow'] }, art], /measured style ref/],
    [[...works, { ...motion, layer: 'interaction' }, art], /Include a motion device/],
    [[...works, { ...motion, tokens: { css: [{ property: 'opacity', value: '.9' }] } }, art], /A motion device declares what moves/],
    [[...works, motion], /Include a device anchored to a measured aesthetic ref that draws an original inline SVG illustration/],
    [[...works, motion, { ...art, tokens: { ids: ['fixture-art'] } }], /tokens\.svg/],
    [[...works, { ...motion, qualities: ['Invented drift'] }, art], /Use a tag returned for this device's measured anchors, exactly as listed: Fixture Lantern Lit/],
  ]) assert.throws(() => normalizeDesignDna({ ...source, devices }, { input }), pattern);
  assert.throws(() => normalizeDesignDna({ ...source, devices: [...works, { ...motion, tokens: { keyframes: ['none'] } }, art] }, { input }), /name of an @keyframes rule/);
  // Without measured tags the model's own predicted qualities direct motion and illustration under the same rule.
  const ownInput = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(ALL_DOMAINS), { domains: ALL_DOMAINS }));
  const ownDna = normalizeDesignDna(dnaFor('baseline', ownInput.requiredAnchors, ownInput), { input: ownInput });
  assert.deepEqual(ownDna.devices.slice(6).map(device => [device.layer, device.qualities, ownInput.entities.find(entity => entity.ref === device.anchors[0]).domain]),
    [['motion', ['Assumed slow'], 'style'], ['layout', ['Assumed handmade'], 'aesthetic']]);
  assert.equal(ownInput.metrics.tagPredictions, 6); assert.equal(ownInput.metrics.predictions, 15);
  assert.ok(ownInput.requiredAnchors.every(ref => !['style', 'aesthetic'].includes(ownInput.entities.find(entity => entity.ref === ref).domain)));
  // Inputs without tag domains, such as older records, need neither device.
  const entitiesOnly = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(DEFAULT_DOMAINS), { domains: DEFAULT_DOMAINS }));
  assert.equal(normalizeDesignDna(dnaFor('baseline', entitiesOnly.requiredAnchors), { input: entitiesOnly }).devices.length, 6);
});

test('voice writes the narrative from the taste input: a voice device declares at least two lines, from a measured ref in a measured run', async () => {
  const { input } = await measuredInput();
  const source = dnaFor('qloo', input.requiredAnchors, input);
  const at = source.devices.findIndex(device => device.layer === 'voice');
  const own = input.entities.find(entity => entity.source === 'model-assumption').ref;
  assert.deepEqual(normalizeDesignDna(source, { input }).devices[at].tokens.copy, VOICE.qloo);
  const replaced = change => ({ ...source, devices: source.devices.map((device, index) => index === at ? { ...device, ...change } : device) });
  const ownVoice = { id: 'dna-own-voice', layer: 'voice', device: 'Test-only voice from the model\'s own prediction', anchors: [own], qualities: ['Assumed warm'],
    translation: 'Test-only: the predicted quality sets short, warm lines.', tokens: { copy: VOICE.qloo } };
  for (const [dna, pattern] of [
    [replaced({ tokens: { copy: [VOICE.qloo[0]] } }), /Include a voice device anchored to a measured ref whose quality sets the register, rhythm and vocabulary of the visitor copy, and declare at least two lines/],
    [replaced({ layer: 'imagery', tokens: { css: [{ property: 'object-fit', value: 'cover' }] } }), /Include a voice device/],
    // The model's own prediction cannot carry the voice of a measured run.
    [{ ...replaced({ layer: 'imagery', tokens: { css: [{ property: 'object-fit', value: 'cover' }] } }), devices: [...replaced({ layer: 'imagery', tokens: { css: [{ property: 'object-fit', value: 'cover' }] } }).devices, ownVoice] }, /anchored to a measured ref/],
  ]) assert.throws(() => normalizeDesignDna(dna, { input }), pattern);
  // Without measured data the model's own predictions carry the voice under the same rule.
  const ownInput = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(DEFAULT_DOMAINS), { domains: DEFAULT_DOMAINS }));
  const ownSource = dnaFor('baseline', ownInput.requiredAnchors, ownInput);
  assert.throws(() => normalizeDesignDna({ ...ownSource, devices: ownSource.devices.map(device => device.layer === 'voice' ? { ...device, tokens: { copy: [VOICE.baseline[0]] } } : device) }, { input: ownInput }),
    /Include a voice device anchored to a ref whose quality/);
});

test('qualities first: palette and type anchor to a quality in both arms, and motion and illustration fall back to measured mood and look qualities', async () => {
  const { input } = await typedInput();
  const source = dnaFor('qloo', input.requiredAnchors, input);
  const dna = normalizeDesignDna(source, { input });
  assert.deepEqual(dna.devices.slice(0, 2).map(device => [device.layer, device.anchors, device.qualities]),
    [['palette', ['quality:look:atmospheric'], ['Atmospheric']], ['typography', ['quality:mood:melancholic'], ['Melancholic']]]);
  assert.equal(dna.stats.qualityAnchoredDevices, 5, 'Palette, type, the layout from Reflective, motion and the illustration.');
  // A work carrying the same tag is evidence, not the quality itself.
  const onWork = layer => ({ ...source, devices: source.devices.map(device => device.layer === layer ? { ...device, anchors: ['movie-core-0'], qualities: ['Atmospheric'] } : device) });
  for (const layer of ['palette', 'typography']) {
    assert.throws(() => normalizeDesignDna(onWork(layer), { input }), new RegExp(`Qualities first: anchor a ${layer} device to at least one measured quality ref, such as Atmospheric \\(quality:look:atmospheric\\), Reflective \\(quality:meaning:reflective\\), Melancholic.*never take an entity's own brand or team colors, logo, packaging or trade dress\\.`));
  }
  // The model's own predicted quality cannot stand in for a measured one; a measured style tag can.
  const ownQuality = input.entities.find(entity => entity.source === 'model-assumption' && entity.domain === 'qualities').ref;
  const palette = change => ({ ...source, devices: source.devices.map(device => device.layer === 'palette' ? { ...device, ...change } : device),
    rejected: [{ ref: 'quality:look:atmospheric', reason: 'Test-only: another quality carries the palette.' }] });
  assert.throws(() => normalizeDesignDna(palette({ anchors: [ownQuality], qualities: ['Assumed dusk'] }), { input }), /Qualities first: anchor a palette device to at least one measured quality ref/);
  const hushed = input.entities.find(entity => entity.domain === 'style' && entity.source === 'qloo');
  assert.deepEqual(normalizeDesignDna(palette({ anchors: [hushed.ref], qualities: [hushed.name] }), { input }).devices[0].anchors, [hushed.ref]);
  // Without Qloo the same rule reads the model's own predicted qualities.
  const own = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(STUDIO_DOMAINS), { domains: STUDIO_DOMAINS }));
  const ownSource = dnaFor('baseline', own.requiredAnchors, own);
  assert.equal(normalizeDesignDna(ownSource, { input: own }).stats.qualityAnchoredDevices, 5);
  assert.throws(() => normalizeDesignDna({ ...ownSource, devices: ownSource.devices.map(device => device.layer === 'palette' ? { ...device, anchors: [own.requiredAnchors[3]] } : device) }, { input: own }),
    /Qualities first: anchor a palette device to at least one quality ref, such as Nocturnal \(M22\), Wistful \(M23\), Atmosphere \(M24\)/);
  // Surprise qualities count as surprises: leaving the frozen sketch takes a palette and type anchored to a surprise entity or quality.
  assert.throws(() => normalizeDesignDna(source, { input, sketch: SKETCH }), /Give a palette device anchored to a surprise entity or quality at least two colors/);
  const departed = normalizeDesignDna({ ...source, devices: source.devices.map(device => device.layer === 'palette' ? { ...device, anchors: [...device.anchors, 'quality:meaning:reflective'] }
    : device.layer === 'typography' ? { ...device, anchors: [...device.anchors, 'quality:mood:lo-fi'] } : device) }, { input, sketch: SKETCH });
  assert.deepEqual(departed.devices.slice(0, 2).map(device => device.surprise), [true, true]);
  // An empty aesthetic ranking gives way to the measured look qualities, an empty style ranking to the measured mood qualities.
  const flat = (await typedInput({ empty: ['urn:tag:aesthetic_property:qloo'] })).input;
  const flatSource = dnaFor('qloo', flat.requiredAnchors, flat);
  assert.throws(() => normalizeDesignDna(flatSource, { input: flat }),
    /Include a device anchored to a measured look quality \(the aesthetic ranking returned no tags\) that draws an original inline SVG illustration of it: Atmospheric \(quality:look:atmospheric\), Minimalist \(quality:look:minimalist\)\./);
  const drawn = normalizeDesignDna({ ...flatSource, devices: flatSource.devices.map(device => device.id === 'dna-art' ? { ...device, anchors: ['quality:look:minimalist'], qualities: ['Minimalist'] } : device) }, { input: flat });
  assert.deepEqual(drawn.devices.find(device => device.id === 'dna-art').anchors, ['quality:look:minimalist']);
  const still = (await typedInput({ empty: ['urn:tag:style:qloo'] })).input;
  assert.throws(() => normalizeDesignDna(dnaFor('qloo', still.requiredAnchors, still), { input: still }),
    /Include a motion device anchored to a measured mood quality \(the style ranking returned no tags\) that translates it into tempo, easing and what moves: Melancholic \(quality:mood:melancholic\), Lo-Fi \(quality:mood:lo-fi\)\./);
  assert.ok(still.entities.some(entity => entity.domain === 'qualities' && entity.name === 'Fixture Hushed'), 'Without the style ranking, its name is a shared quality like any other.');
});

test('decisions and comparisons name the qualities a design translates', async () => {
  const { input } = await typedInput();
  const dna = normalizeDesignDna(dnaFor('qloo', input.requiredAnchors, input), { input });
  const [palette] = dnaDecisions(dna, input);
  assert.equal(palette.reason, 'Anchored to Atmospheric (Qloo look quality of 5 works, also predicted).');
  assert.equal(palette.sourceType, 'qloo'); assert.equal(palette.evidenceIds.length, 3, 'A quality rests on the responses of the works that carry it.'); assert.deepEqual(palette.anchorEntityIds, []);
  const own = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(STUDIO_DOMAINS), { domains: STUDIO_DOMAINS }));
  const ownDna = normalizeDesignDna(dnaFor('baseline', own.requiredAnchors, own), { input: own });
  const files = mode => { const site = siteFor(mode); return { 'index.html': site.html, 'styles.css': site.css }; };
  const comparison = compareTasteRuns({ qloo: { files: files('qloo'), dna, input }, baseline: { files: files('baseline'), dna: ownDna, input: own } });
  assert.equal(comparison.qualityHeadline, '5 of 8 Qloo on devices translate measured qualities; 5 of 8 Qloo off devices translate qualities the model predicted.');
  assert.match(comparison.headline, /^\d of 8 design devices in the Qloo on design rest on entities or qualities the model did not predict\.$/);
  // Pairs without measured qualities keep their earlier headlines.
  const { input: bare } = await measuredInput();
  const older = compareTasteRuns({ qloo: { files: files('qloo'), dna: normalizeDesignDna(dnaFor('qloo', bare.requiredAnchors, bare), { input: bare }), input: bare }, baseline: { files: files('baseline') } });
  assert.equal(older.qualityHeadline, undefined); assert.match(older.headline, /rest on entities the model did not predict\.$/);
});

test('a build keeps the catalogue facts and writes the narrative; the host measures how much starter copy it rewrote', () => {
  const page = (mode, options) => siteFor(mode).html.replace(dataIsland(mode), dataIsland(mode, options));
  const items = change => STARTER_DATA.items.map((item, index) => index ? item : { ...item, ...change });
  assert.equal(assertStarterFacts(STARTER_HTML, siteFor('qloo').html), true, 'Descriptions and the add label are narrative.');
  for (const [html, pattern] of [
    [page('qloo', { change: { items: items({ meta: '1 l · Tin' }) } }), /site-data\.items\[0\]\.meta is a product fact; keep "500 ml · Glass bottle"\.$/],
    [page('qloo', { change: { items: items({ name: 'Grand cru olive oil' }) } }), /items\[0\]\.name is a product fact/],
    [page('qloo', { change: { items: STARTER_DATA.items.slice(1) } }), /site-data\.items keeps all 6 catalogue items, in their order\./],
    [page('qloo', { change: { items: [...STARTER_DATA.items].reverse() } }), /items\[0\]\.id is a product fact/],
    [page('qloo', { change: { formSuccess: 'Your order is confirmed.' } }), /site-data\.formSuccess is a product fact/],
    [page('qloo', { change: { items: items({ description: '' }) } }), /items\[0\]\.description: write 3-280 characters that keep what the item is and does\./],
    [page('qloo', { change: { addMessage: '' } }), /site-data\.addMessage: write 1-160 characters\./],
    [siteFor('qloo').html.replace(dataIsland('qloo'), ''), /Keep the <script type="application\/json" id="site-data"> block/],
  ]) assert.throws(() => assertStarterFacts(STARTER_HTML, html), pattern);
  assert.equal(assertStarterFacts('<main>No data island</main>', '<main>Anything</main>'), true, 'A starter without a data island has nothing to check.');
  // The starter keeps every one of its 16 narrative lines; the fixture sites keep only the add message and five descriptions.
  assert.deepEqual([narrativeRetention(STARTER_HTML, STARTER_HTML).lines, narrativeRetention(STARTER_HTML, STARTER_HTML).rewritten], [16, 0]);
  const written = narrativeRetention(STARTER_HTML, siteFor('qloo').html);
  assert.deepEqual([written.lines, written.rewritten], [16, 10]);
  assert.deepEqual(written.kept.map(line => line.field), ['addMessage', ...STARTER_DATA.items.slice(1).map(item => `items.${item.id}.description`)]);
  const headline = narrativeRetention(STARTER_HTML, siteFor('qloo').html.replace('<h1>Fixture food shop</h1>', `<h1>${STARTER_DATA.headline}</h1>`));
  assert.equal(headline.kept[0].field, 'headline', 'A starter line left on the page counts as kept, whatever its styling.');
  // Kept means whole text or whole sentences, however the markup splits them; a short line inside a longer one is not kept.
  const PAGE_FIELDS = new Set(['headline', 'description', 'catalogLabel', 'catalogLink', 'searchPlaceholder', 'selectionTitle', 'formTitle', 'formButton']);
  const pageLines = extra => narrativeRetention(STARTER_HTML, siteFor('qloo').html.replace('</main>', `${extra}</main>`)).kept.map(line => line.field).filter(field => PAGE_FIELDS.has(field));
  assert.deepEqual(pageLines(`<input placeholder="${STARTER_DATA.searchPlaceholder}">`), ['searchPlaceholder'], '"Products" inside the placeholder is not the catalogue label.');
  assert.deepEqual(pageLines(`<a href="#catalog-section">${STARTER_DATA.catalogLabel}</a><a href="#catalog-section">${STARTER_DATA.catalogLink} →</a>`), ['catalogLabel', 'catalogLink']);
  assert.deepEqual(pageLines(`<p>Gather. ${STARTER_DATA.headline}</p>`), ['headline'], 'A kept line may follow another sentence.');
  assert.deepEqual(pageLines(`<h2><em>${STARTER_DATA.headline.replace('. ', '.</em> ')}</h2>`), ['headline']);
  assert.deepEqual(pageLines(`<p>Nobody says ${STARTER_DATA.formButton.toLowerCase()} here.</p>`), []);
  assert.equal(narrativeRetention('<main>No data island</main>', siteFor('qloo').html), null);
  // Shared sentences leave the product facts out, sentence by sentence: they are the same in every build by design.
  const fact = html => html.replace('</main>', `<p>Virgin olive oil</p><p>${STARTER_DATA.formDescription}</p></main>`);
  const overlap = copyOverlap(STARTER_HTML, fact(siteFor('baseline').html), fact(siteFor('qloo').html));
  assert.ok(overlap.examples.includes('pause motion'));
  for (const line of ['virgin olive oil', 'this form is a local shopping demo.', 'no order is placed and no email is sent.']) assert.equal(overlap.examples.includes(line), false, line);
  assert.deepEqual(copyOverlap(STARTER_HTML, fact(siteFor('baseline').html), fact(siteFor('qloo').html)).shared, copyOverlap(STARTER_HTML, siteFor('baseline').html, siteFor('qloo').html).shared);
  assert.equal(overlap.share, Math.round(overlap.shared / overlap.distinct * 1000) / 1000);
  assert.ok(overlap.sentences.qloo > overlap.shared && overlap.sentences.baseline > overlap.shared, 'Each voice wrote lines of its own.');
});

test('with a font library, the sketch and the DNA name only its families and conformance checks they are loaded', async () => {
  const fonts = [{ family: 'Jost', files: ['fonts/jost-latin-wght-normal.woff2'], similarTo: ['Futura'] }, { family: 'Gelasio', files: ['fonts/gelasio-latin-wght-normal.woff2'], similarTo: ['Georgia'] }];
  const domains = ['brand'];
  assert.throws(() => normalizeTasteAssumption(assumptionFor(domains, { sketch: { ...SKETCH, fonts: ['Futura'] } }), { domains, fonts }), /Futura is not in culture-fonts\.json.*Jost stands in for Futura/);
  assert.deepEqual(normalizeTasteAssumption(assumptionFor(domains, { sketch: { ...SKETCH, fonts: ['jost', 'serif'] } }), { domains, fonts }).designSketch.fonts, ['Jost', 'serif'], 'Names take the library spelling; generic families stay allowed.');
  const { input } = await measuredInput();
  const source = dnaFor('qloo', input.requiredAnchors, input);
  const withFont = font => ({ ...source, devices: source.devices.map(device => device.layer === 'typography' ? { ...device, tokens: { fonts: [font, 'serif'] } } : device) });
  assert.throws(() => normalizeDesignDna(withFont('Georgia'), { input, fonts }), /Georgia is not in culture-fonts\.json.*Gelasio stands in for Georgia/);
  assert.throws(() => normalizeDesignDna(withFont('Comic Sans MS'), { input, fonts }), /such as Jost, Gelasio/);
  const dna = normalizeDesignDna(withFont('gelasio'), { input, fonts });
  assert.deepEqual(dna.devices.find(device => device.layer === 'typography').tokens.fonts, ['Gelasio', 'serif']);
  // A family named only inside @font-face is not in use, and a used family must load from one of its listed files.
  const site = siteFor('qloo');
  const files = css => ({ 'index.html': site.html, 'styles.css': css });
  const loaded = checkDnaConformance(dna, files(site.css), { fonts });
  assert.equal(loaded.score, 1); assert.deepEqual(loaded.fonts, { loaded: ['Gelasio'], unknown: [] });
  const typography = report => report.devices.find(device => device.layer === 'typography');
  const unloaded = checkDnaConformance(dna, files(site.css.replace("url('fonts/gelasio-latin-wght-normal.woff2')", "url('fonts/gelasio-missing.woff2')")), { fonts });
  assert.deepEqual(typography(unloaded).missing, [{ kind: 'font-file', value: 'Gelasio', detail: '@font-face for Gelasio with src fonts/gelasio-latin-wght-normal.woff2' }]);
  assert.deepEqual(unloaded.fonts.unknown, ['fonts/gelasio-missing.woff2']);
  const faceOnly = checkDnaConformance(dna, files(site.css.replace('body{font-family:Gelasio,serif;', 'body{')), { fonts });
  assert.deepEqual(typography(faceOnly).missing.map(item => [item.kind, item.value]), [['font', 'Gelasio'], ['font', 'serif']]);
  assert.deepEqual(designFingerprint(files(site.css.replace('body{font-family:Gelasio,serif;', 'body{'))).fonts.families, [], 'The fingerprint ignores families named only in @font-face.');
  assert.equal(checkDnaConformance(dna, files(site.css)).fonts, undefined, 'Without a library there is nothing to compare against.');
});

test('conformance checks keyframes, SVG illustrations and motion safety', async () => {
  const { input } = await measuredInput();
  const dna = normalizeDesignDna(dnaFor('qloo', input.requiredAnchors, input), { input });
  const site = siteFor('qloo');
  const report = (html, css) => checkDnaConformance(dna, { 'index.html': html, 'styles.css': css });
  const device = (result, id) => result.devices.find(item => item.id === id);
  const full = report(site.html, site.css);
  assert.equal(full.score, 1);
  // A voice line in a JSON data island counts, because the page's script renders it; one inside script code does not.
  const voice = result => result.devices.find(item => item.layer === 'voice');
  assert.equal(voice(full).status, 'present');
  assert.deepEqual(voice(report(site.html.replace(dataIsland('qloo'), `<script>const note = ${JSON.stringify(VOICE.qloo[1])};</script>`), site.css)).missing, [{ kind: 'copy', value: VOICE.qloo[1] }]);
  assert.deepEqual(full.motion, { keyframes: ['fixture-drift'], used: ['fixture-drift'], undefined: [], infinite: ['fixture-drift'], reducedMotion: true, pauseControl: true });
  assert.deepEqual(full.illustrations, [{ id: 'fixture-art', shapes: 8 }]);
  const kinds = result => device(result, 'dna-motion').missing.map(item => item.value);
  assert.deepEqual(kinds(report(site.html, site.css.replace('@media (prefers-reduced-motion: reduce){.drift{animation:none}}', ''))), ['reduced-motion fallback']);
  assert.deepEqual(kinds(report(site.html.replace(' data-motion-toggle', ''), site.css)), ['pause control']);
  assert.deepEqual(kinds(report(site.html.replace(' data-motion-toggle', ''), site.css.replace('12s ease-in-out infinite', '12s ease-in-out 2'))).filter(value => value === 'pause control'), [], 'A finite animation needs no pause control.');
  const undefinedKeyframes = report(site.html, site.css.replace(/@keyframes fixture-drift\{from\{[^}]*\}to\{[^}]*\}\}/u, ''));
  assert.deepEqual(device(undefinedKeyframes, 'dna-motion').missing[0], { kind: 'keyframes', value: 'fixture-drift', detail: 'no @keyframes fixture-drift rule' });
  assert.deepEqual(undefinedKeyframes.motion.undefined, ['fixture-drift']);
  const unused = report(site.html, site.css.replace('.drift{animation:fixture-drift 12s ease-in-out infinite}', ''));
  assert.match(device(unused, 'dna-motion').missing.find(item => item.kind === 'keyframes').detail, /defined but no animation uses it/);
  // Longhand properties in one rule count too.
  const longhand = report(site.html, site.css.replace('.drift{animation:fixture-drift 12s ease-in-out infinite}', '.drift{animation-name:fixture-drift;animation-duration:12s;animation-iteration-count:infinite}'));
  assert.deepEqual(longhand.motion.infinite, ['fixture-drift']);
  const sparse = report(site.html.replace(/<circle[^>]*\/>/gu, ''), site.css);
  assert.deepEqual(device(sparse, 'dna-art').missing, [{ kind: 'svg', value: 'fixture-art', detail: `the <svg id="fixture-art"> draws 4 shapes; it needs at least 8` }]);
  assert.match(device(report(site.html.replace('id="fixture-art"', 'id="other-art"'), site.css), 'dna-art').missing[0].detail, /no inline <svg id="fixture-art">/);
  const fingerprint = designFingerprint({ 'index.html': site.html, 'styles.css': site.css });
  assert.deepEqual(fingerprint.motion, { keyframes: 1, animated: 1, infinite: 1, transitions: 0, reducedMotion: true, easings: ['ease-in-out'] });
  assert.equal(fingerprint.svgShapes, 8); assert.equal(fingerprint.illustrations, 1);
});

test('the frozen design sketch is validated with the prediction and required by the Studio protocol', () => {
  const domains = ['brand'];
  assert.throws(() => normalizeTasteAssumption(assumptionFor(domains, { sketch: null }), { domains, requireSketch: true }), /designSketch: Also sketch the design/);
  assert.equal(normalizeTasteAssumption(assumptionFor(domains, { sketch: null }), { domains }).designSketch, undefined, 'Portable callers may omit the sketch.');
  for (const [sketch, pattern] of [[{ ...SKETCH, palette: ['#fff', '#000'] }, /palette: An array with 3-6 items/], [{ ...SKETCH, fonts: ['serif'] }, /Name at least one font family/],
    [{ ...SKETCH, sections: ['top', 'two words', 'x'] }, /without spaces/], [{ ...SKETCH, extra: true }, /Unsupported field/]]) {
    assert.throws(() => normalizeTasteAssumption(assumptionFor(domains, { sketch }), { domains, requireSketch: true }), pattern);
  }
  const saved = normalizeTasteAssumption(assumptionFor(domains, { sketch: { ...SKETCH, palette: ['#FFF', '#2c6e49', '#f4efe6'] } }), { domains, requireSketch: true });
  assert.deepEqual(saved.designSketch.palette, ['#ffffff', '#2c6e49', '#f4efe6']); assert.deepEqual(saved.designSketch.sections, ['top', 'gallery', 'hero']);
});

test('measured surprises must move palette, type and structure away from the frozen sketch and name the tags they translate', async () => {
  const { input } = await measuredInput();
  const required = input.requiredAnchors;
  const accepted = normalizeDesignDna(dnaFor('qloo', required, input), { input, sketch: SKETCH, existingIds: ['top'] });
  const palette = accepted.devices.find(device => device.layer === 'palette');
  assert.deepEqual(palette.novel.colors, ['#1d1a17', '#c9a227']); assert.deepEqual(palette.qualities, ['Night markets']); assert.equal(palette.surprise, true);
  assert.deepEqual(accepted.stats.sketchMoves.fonts, ['Gelasio']); assert.ok(accepted.stats.sketchMoves.ids.includes('ledger'));
  const near = { ...SKETCH, palette: ['#1d1a17', '#c9a227', '#ffffff'] };
  // Each rejection names the offending tokens, so a live agent can repair the DNA in one save.
  assert.throws(() => normalizeDesignDna(dnaFor('qloo', required, input), { input, sketch: near }), /move the palette away from your frozen sketch.*Too close now: #1d1a17 \(0 from #1d1a17\), #c9a227 \(0 from #c9a227\)\./);
  assert.throws(() => normalizeDesignDna(dnaFor('qloo', required, input), { input, sketch: { ...SKETCH, fonts: ['Gelasio'] } }), /move the type system away.*Still from the sketch: Gelasio\./);
  assert.throws(() => normalizeDesignDna(dnaFor('qloo', required, input), { input, sketch: { ...SKETCH, sections: ['ledger', 'top', 'hero'] }, existingIds: ['taste-toggle'] }), /change the page structure.*Already known: #ledger, #taste-toggle\./);
  const untagged = dnaFor('qloo', required, input);
  untagged.devices[0] = { ...untagged.devices[0], qualities: [] };
  assert.throws(() => normalizeDesignDna(untagged, { input, sketch: SKETCH }), /qualities: Name 1-4 returned tags of the surprise anchor/);
  untagged.devices[0] = { ...untagged.devices[0], qualities: ['Invented mood'] };
  assert.throws(() => normalizeDesignDna(untagged, { input, sketch: SKETCH }), /Use a tag returned for this device's measured anchors, exactly as listed: Night markets/);
  // Without measured surprises the same rule text asks nothing: the model's own prediction may follow its sketch.
  const own = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(DEFAULT_DOMAINS), { domains: DEFAULT_DOMAINS }));
  const baseline = normalizeDesignDna(dnaFor('baseline', own.requiredAnchors), { input: own, sketch: SKETCH });
  assert.equal(baseline.stats.surpriseAnchoredDevices, 0); assert.deepEqual(baseline.stats.sketchMoves.fonts, []);
  assert.deepEqual(baseline.devices[0].qualities, ['Assumed calm'], 'Qualities of the model\'s own predictions are its assumption.');
});

test('departure from the frozen sketch is measured on the saved site against its own run', () => {
  const qloo = siteFor('qloo'), baseline = siteFor('baseline');
  const moved = sketchDivergence(SKETCH, { 'index.html': qloo.html, 'styles.css': qloo.css });
  assert.deepEqual(moved.fonts.new, ['Gelasio']); assert.deepEqual(moved.colors.new, ['#1d1a17', '#c9a227']); assert.deepEqual(moved.sections.new, ['ledger']);
  assert.equal(moved.typography, 1); assert.equal(moved.palette, 1); assert.equal(moved.structure, 0.5); assert.equal(moved.score, 0.833);
  const kept = sketchDivergence(SKETCH, { 'index.html': baseline.html, 'styles.css': baseline.css });
  assert.equal(kept.score, 0); assert.deepEqual(kept.fonts.kept, ['Jost']);
  assert.equal(sketchDivergence(SKETCH, { 'index.html': qloo.html, 'styles.css': qloo.css }, { existingIds: ['ledger'] }).structure, 0, 'Starter IDs are not new structure.');
  assert.equal(sketchDivergence(null, {}), null);
});

test('two blind sketches compare like saved sites on palette, type and structure', () => {
  const same = compareDesignFingerprints(sketchFingerprint(SKETCH), sketchFingerprint({ ...SKETCH, palette: SKETCH.palette.map(hex => hex.toUpperCase()) }));
  assert.equal(same.palette, 0); assert.equal(same.typography, 0); assert.equal(same.structure, 0);
  const other = compareDesignFingerprints(sketchFingerprint(SKETCH), sketchFingerprint({ ...SKETCH, palette: ['#1d1a17', '#c9a227', '#3a3530'], fonts: ['Courier New'], sections: ['ledger', 'hero', 'notes'] }));
  assert.ok(other.palette > 0.5); assert.equal(other.typography, 1); assert.equal(other.structure, 0.8);
  assert.deepEqual(sketchFingerprint(SKETCH).fonts.classes, ['sans']); assert.equal(sketchFingerprint({ summary: 'x' }), null);
});

test('conformance checks literal tokens across CSS color syntaxes, IDs and visible copy without judging quality', () => {
  const dna = { devices: [
    { id: 'p', layer: 'palette', device: 'Palette', tokens: { colors: ['#1d1a17', '#c9a227'], fonts: [], css: [], ids: [], copy: [] } },
    { id: 't', layer: 'typography', device: 'Type', tokens: { colors: [], fonts: ['Iowan Old Style'], css: [{ property: 'letter-spacing', value: '.08em' }], ids: [], copy: [] } },
    { id: 's', layer: 'structure', device: 'Ledger', tokens: { colors: [], fonts: [], css: [], ids: ['ledger', 'absent-id'], copy: ['Late light'] } },
  ] };
  const report = checkDnaConformance(dna, { 'index.html': '<main><section id="ledger"><p>Late&nbsp;light</p></section></main>', 'styles.css': 'body{color:rgb(29, 26, 23);background:hsl(43 66% 71%)}h1{font-family:"Iowan Old Style",Georgia,serif;letter-spacing:.08em}' });
  assert.deepEqual(report.devices.map(device => device.status), ['partial', 'present', 'partial']);
  assert.deepEqual(report.devices[0].missing, [{ kind: 'color', value: '#c9a227' }]);
  assert.deepEqual(report.devices[2].missing, [{ kind: 'id', value: 'absent-id' }]);
  assert.equal(report.score, 0.667); assert.equal(report.meetsThreshold, false); assert.match(report.limitation, /does not measure visual quality/);
});

// Test-only photo library: what each photo shows, in the same tag vocabulary the fixture profile returns.
const PHOTOS = [{ path: 'library/market-1.jpg', tags: ['Night markets', 'Moody'] }, { path: 'library/bright-1.jpg', tags: ['Bright'] }];
const PHOTO_TOKENS = { colors: ['#1d1a17', '#c9a227'], css: [{ property: 'filter', value: 'grayscale(1)' }, { property: 'mix-blend-mode', value: 'multiply' }], images: ['market-1'] };
const photoDevice = (ref, { tokens = {}, ...overrides } = {}) => ({ id: 'dna7', layer: 'imagery', device: 'Duotone market photographs', anchors: [ref], qualities: ['Night markets'],
  translation: 'Test-only: the returned night-market tag chooses a dim market photo, tinted with two palette colors.', tokens: { ...PHOTO_TOKENS, ...tokens }, ...overrides });

test('library photos are chosen by a device\'s qualities and treated with its own palette', async () => {
  const { input } = await measuredInput();
  const required = input.requiredAnchors;
  const withPhoto = (device, source = dnaFor('qloo', required, input)) => ({ ...source, devices: [...source.devices, device] });
  const dna = normalizeDesignDna(withPhoto(photoDevice(required[0])), { input, sketch: SKETCH, library: PHOTOS });
  assert.deepEqual(dna.devices.at(-1).tokens.images, ['library/market-1.jpg'], 'An ID, a file name and a path name the same photo.');
  for (const [tokens, pattern] of [
    [{ images: ['bright-1.jpg'] }, /library\/bright-1\.jpg is tagged Bright; it fits a device only when one of those tags is among the device's qualities/],
    [{ images: ['library/absent-1.jpg'] }, /library\/absent-1\.jpg is not in culture-library\.json/],
    [{ images: ['https://example.com/photo.jpg'] }, /Use a photo ID or path listed in culture-library\.json/],
    [{ css: [{ property: 'opacity', value: '.9' }] }, /must treat them with its own palette/],
    [{ colors: ['#1d1a17'] }, /at least two of its colors and a filter or mix-blend-mode/],
  ]) assert.throws(() => normalizeDesignDna(withPhoto(photoDevice(required[0], { tokens })), { input, sketch: SKETCH, library: PHOTOS }), pattern);
  assert.throws(() => normalizeDesignDna(withPhoto(photoDevice(required[0])), { input, sketch: SKETCH, library: [] }), /no host photo library/);
  // A portable caller without a library gets the form and treatment checks only.
  assert.deepEqual(normalizeDesignDna(withPhoto(photoDevice(required[0])), { input, sketch: SKETCH }).devices.at(-1).tokens.images, ['library/market-1.jpg']);
  // Without measured data the model's own qualities choose the photos, under the same rule.
  const own = tasteInputFromAssumption(normalizeTasteAssumption(assumptionFor(DEFAULT_DOMAINS), { domains: DEFAULT_DOMAINS }));
  const ownDna = normalizeDesignDna(withPhoto(photoDevice(own.requiredAnchors[0], { qualities: ['Bright'], tokens: { images: ['bright-1'] } }), dnaFor('baseline', own.requiredAnchors)), { input: own, sketch: SKETCH, library: PHOTOS });
  assert.deepEqual(ownDna.devices.at(-1).tokens.images, ['library/bright-1.jpg']);
});

test('conformance finds library photo paths in site files and lists photos the library does not contain', () => {
  const dna = { devices: [{ id: 'i', layer: 'imagery', device: 'Photos', tokens: { colors: [], fonts: [], css: [], ids: [], copy: [], images: ['library/market-1.jpg', 'library/bright-1.jpg'] } }] };
  const files = { 'index.html': '<main><img src="library/market-1.jpg" alt="A dim market stall"></main>', 'experience.js': "card.style.backgroundImage = 'url(library/absent-2.jpg)';", 'culture-dna.json': '{"images":["library/bright-1.jpg"]}' };
  const report = checkDnaConformance(dna, files, { library: PHOTOS });
  assert.equal(report.devices[0].status, 'partial');
  assert.deepEqual(report.devices[0].missing, [{ kind: 'image', value: 'library/bright-1.jpg' }], 'A culture record does not count as showing a photo.');
  assert.deepEqual(report.photos, { used: ['library/market-1.jpg'], unknown: ['library/absent-2.jpg'] });
  assert.equal(checkDnaConformance(dna, files).photos, undefined, 'Without a library there is nothing to compare against.');
  assert.deepEqual(designFingerprint(files).images, ['library/absent-2.jpg', 'library/market-1.jpg']);
});

test('a build prompt gives both arms the same photo library rules; plans and starters without photos omit them', () => {
  const common = { template: { name: 'Local food', description: 'Product catalog, category filters and a sample order list.' }, brief, cultureBrief, kind: 'build', photoLibrary: { photos: 21 } };
  const [baseline, qloo] = ['baseline', 'qloo'].map(mode => makeTastePrompt({ ...common, mode }));
  for (const prompt of [baseline, qloo]) {
    assert.match(prompt, /1\. Read index\.html, styles\.css, app\.js, culture-brief\.json and culture-library\.json\./);
    assert.match(prompt, /copy:\['exact visible text'\],images:\['library\/photo\.jpg'\]/);
    assert.match(prompt, /lists the host's 21 openly licensed product photographs/);
    assert.match(prompt, /each listed photo must carry one of that device's qualities among its tags/);
    assert.match(prompt, /MutationObserver on #catalog/);
  }
  const withoutSource = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');
  assert.equal(withoutSource(baseline), withoutSource(qloo), 'Only the taste-source paragraph differs between arms.');
  for (const prompt of [makeTastePrompt({ ...common, mode: 'qloo', kind: 'plan' }), makeTastePrompt({ ...common, mode: 'qloo', photoLibrary: null })]) assert.doesNotMatch(prompt, /culture-library|library\/|tokens\.images/);
  assert.match(makeTastePrompt({ ...common, mode: 'qloo', photoLibrary: null }), /1\. Read index\.html, styles\.css, app\.js and culture-brief\.json\./);
  // Image generation, like the library, is offered to builds only and changes no other part of the prompt.
  assert.doesNotMatch(baseline, /project_generate_image|Generated images:/);
  const imaging = makeTastePrompt({ ...common, mode: 'baseline', imageGeneration: { perRun: 8 } });
  assert.match(imaging, /Include at least one imagery device in the DNA\. After saving the DNA and before writing any site file, call project_generate_image one to 8 times, for example for a hero, a section or each catalogue product, one call at a time/);
  assert.match(imaging, /never a film, artist, brand or other taste entity/);
  assert.match(imaging, /Use every returned image in the site/);
  assert.match(imaging, /replace any photo or generated image path it reports as unknown, use every generated image it reports as unused/);
  assert.match(makeTastePrompt({ ...common, mode: 'baseline', photoLibrary: null, imageGeneration: { perRun: 4 } }), /\(generated images are local\)/);
  assert.doesNotMatch(makeTastePrompt({ ...common, mode: 'qloo', kind: 'plan', imageGeneration: { perRun: 4 } }), /project_generate_image/);
});

test('both arms get the same font library, motion and illustration rules; only the source of the tags differs', () => {
  const common = { template: { name: 'Local food', description: 'Product catalog, category filters and a sample order list.' }, brief, cultureBrief, kind: 'build', fontLibrary: { families: 33 } };
  const [baseline, qloo] = ['baseline', 'qloo'].map(mode => makeTastePrompt({ ...common, mode }));
  for (const prompt of [baseline, qloo]) {
    assert.match(prompt, /1\. Read index\.html, styles\.css, app\.js, culture-brief\.json and culture-fonts\.json\./);
    assert.match(prompt, /style:\['3-6 qualities of the pacing and look of the films and TV this audience likes'\],aesthetic:\['3-6 visual or material properties of the objects and design this audience likes'\]/);
    assert.match(prompt, /For style, aesthetic and qualities, predict qualities as single words or short phrases, not names\./);
    assert.match(prompt, /fonts:\['1-3 font families from culture-fonts\.json'\]/);
    assert.match(prompt, /keyframes:\['name'\],svg:\['svg-id'\]/);
    assert.match(prompt, /load every listed family you use with the fontFace rules given for it there, and name no other fonts/);
    assert.match(prompt, /- Motion: include a motion device anchored to a style ref, a measured one when the taste input has measured style tags or, without them, a measured mood quality,/);
    assert.match(prompt, /- Illustration: include a device anchored to an aesthetic ref, a measured one when the taste input has measured aesthetic tags or, without them, a measured look quality,/);
    // Shared qualities carry palette and type in both arms; entities are their evidence, never a source of trade dress.
    assert.match(prompt, /qualities:\['3-6 moods, themes or looks you expect the favorite works of this audience to share'\]/);
    assert.match(prompt, /- Qualities first: anchor the palette device and the typography device each to at least one quality ref, from the qualities, style or aesthetic domain, a measured one when the taste input has measured qualities/);
    assert.match(prompt, /never take an entity's own brand or team colors, logo, packaging or trade dress\./);
    assert.match(prompt, /- If the taste input contains surprise entities or qualities, they must move the design/);
    assert.match(prompt, /each needs at least 8 drawn shapes/); assert.match(prompt, /never trace a logo, character or artwork/);
    assert.match(prompt, /Keep total generated site code under 45,000 characters/);
    assert.match(prompt, /IntersectionObserver/); assert.match(prompt, /a button with data-motion-toggle and aria-pressed/);
    assert.match(prompt, /\(the culture-fonts\.json fonts are local\)/);
  }
  const withoutSource = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');
  assert.equal(withoutSource(baseline), withoutSource(qloo), 'Only the taste-source paragraph differs between arms.');
  assert.match(qloo, /are Qloo tags rather than works, ranked by affinity for this audience as a whole: style is the pacing and look of the films and TV it likes, aesthetic the visual and material properties of what it likes\. A tag's own name is its quality\./);
  assert.match(qloo, /Refs in the qualities domain are look, mood and meaning tags that two or more of the measured works carry, ranked by the affinity of those works and the number of domains they span/);
  assert.doesNotMatch(baseline, /Refs in the qualities domain/);
  // A job recorded before shared qualities keeps its earlier rules.
  const tagged = makeTastePrompt({ ...common, mode: 'qloo', domains: ALL_DOMAINS });
  assert.doesNotMatch(tagged, /- Qualities first:|or, without them, a measured (?:mood|look) quality|Refs in the qualities domain|surprise entities or qualities, they must move/); assert.match(tagged, /For style and aesthetic, predict qualities/);
  assert.match(baseline, /returns your predicted entities and qualities as the taste input/); assert.doesNotMatch(baseline, /Qloo tags/);
  assert.match(makeTastePrompt({ ...common, mode: 'baseline', domains: ALL_DOMAINS }), /returns your predicted entities and your predicted style and aesthetic qualities as the taste input/);
  // Older jobs without tag domains get neither rule, and without a font library typography names system fonts.
  const older = makeTastePrompt({ ...common, mode: 'qloo', domains: DEFAULT_DOMAINS, fontLibrary: null });
  assert.doesNotMatch(older, /- Motion:|- Illustration:|- Qualities first:|culture-fonts|Qloo tags/); assert.match(older, /installed on most systems, with fallbacks/);
  // A plan's frozen sketch names library fonts too, but a plan builds no motion or illustration.
  const plan = makeTastePrompt({ ...common, mode: 'qloo', kind: 'plan' });
  assert.match(plan, /fonts:\['1-3 font families from culture-fonts\.json'\]/); assert.doesNotMatch(plan, /- Motion:|- Illustration:/);
  assert.match(makeTastePrompt({ ...common, mode: 'qloo', photoLibrary: { photos: 21 }, imageGeneration: { perRun: 8 } }), /\(the culture-fonts\.json fonts, library photos and generated images are local\)/);
});

test('the host taste record stays within the project file limit', () => {
  const entities = Array.from({ length: 40 }, (_, index) => ({ ref: `E${index}`, name: `Fixture entity ${index}`, description: 'A test-only description. '.repeat(12) }));
  const record = { schemaVersion: '1.0', input: { source: 'qloo-profile', entities }, dna: { devices: [] } };
  const full = tasteRecordText(record, 1_000_000);
  assert.equal(full, JSON.stringify(record, null, 2));
  const limit = Buffer.byteLength(full) - 1;
  const text = tasteRecordText(record, limit);
  assert.ok(Buffer.byteLength(text) <= limit);
  const bounded = JSON.parse(text);
  assert.ok(bounded.input.entities.every(entity => entity.description === undefined && entity.name));
  assert.match(bounded.limitations[0], /descriptions were omitted/);
});

test('design fingerprints are deterministic and distance separates different token systems', () => {
  const a = siteFor('qloo'), b = siteFor('baseline');
  const filesA = { 'index.html': a.html, 'styles.css': a.css }, filesB = { 'index.html': b.html, 'styles.css': b.css };
  assert.deepEqual(designFingerprint(filesA), designFingerprint(filesA));
  assert.equal(compareDesignFingerprints(designFingerprint(filesA), designFingerprint(filesA)).overall, 0);
  const distance = compareDesignFingerprints(designFingerprint(filesA), designFingerprint(filesB));
  assert.ok(distance.overall > 0.3, JSON.stringify(distance));
  assert.equal(distance.typography, 1);
  assert.deepEqual(designFingerprint(filesA).fonts.classes, ['serif']);
});

test('taste-led directions add a model-default d0 and are scored by measured support', async () => {
  const { input } = await measuredInput();
  const own = input.entities.filter(entity => entity.source === 'model-assumption').map(entity => entity.ref);
  const extra = input.entities.find(entity => entity.source === 'qloo' && !input.requiredAnchors.includes(entity.ref)).ref;
  const direction = (id, anchors) => ({ id, title: `Direction ${id}`, summary: 'A test-only direction summary.', anchors, devices: [{ layer: 'palette', device: 'Test palette' }, { layer: 'typography', device: 'Test type' }, { layer: 'layout', device: 'Test layout' }], changes: [{ selector: '#hero', change: 'A test-only change.' }] });
  const valid = [direction('d0', own.slice(0, 2)), direction('d1', [input.requiredAnchors[0], extra]), direction('d2', [input.requiredAnchors[1], extra]), direction('d3', [input.requiredAnchors[2], extra])];
  const directions = normalizeTasteDirections(valid, { input });
  assert.deepEqual(directions.map(item => item.basis), ['model-default', 'taste-input', 'taste-input', 'taste-input']);
  assert.throws(() => normalizeTasteDirections(valid.slice(0, 3), { input }), /exactly four/);
  assert.throws(() => normalizeTasteDirections([direction('d0', [extra, own[0]]), ...valid.slice(1)], { input }), /only to M refs/);
  assert.throws(() => normalizeTasteDirections([valid[0], direction('d1', [extra, own[0]]), ...valid.slice(2)], { input }), /required anchor/);
  const scores = scoreTasteDirections(directions, { input });
  assert.equal(scores.modelDefaultId, 'd0'); assert.equal(scores.recommendedId, 'd1');
  assert.ok(scores.scores.find(score => score.id === 'd1').support > scores.scores.find(score => score.id === 'd0').support);
  assert.equal(scoreTasteDirections(directions, { input: tasteInputFromAssumption({ entries: [] }) }).recommendedId, null);
});

test('portable MCP taste tools validate a prediction before any request and expose surprise sets, DNA checks and distance', async () => {
  const calls = [];
  const handler = createToolHandler({ qlooClient: fakeQloo(calls) });
  const invalid = await handler('qloo_taste_profile', { references, assumption: { schemaVersion: '1.0', audienceSummary: 'Too short a prediction here.', predictions: { brand: ['One'] } } });
  assert.equal(invalid.structuredContent.error.code, 'TASTE_PROTOCOL_INVALID'); assert.equal(calls.length, 0);
  const result = (await handler('qloo_taste_profile', { references, assumption: assumptionFor(STUDIO_DOMAINS), knownNames: references.map(ref => ref.name) })).structuredContent;
  assert.equal(result.status, 'ok'); assert.equal(result.tasteInput.requiredAnchors.length, 6);
  assert.ok(result.tasteInput.entities.some(entity => entity.surprise === true));
  assert.deepEqual([...new Set(result.tasteInput.entities.filter(entity => entity.source === 'qloo').map(entity => entity.domain))].filter(domain => ['style', 'aesthetic'].includes(domain)), ['style', 'aesthetic'], 'The default domains include the style and aesthetic tags.');
  assert.ok(result.profile.results.filter(item => item.band !== 'derived').every(item => /^culture-source:[0-9a-f-]{36}$/u.test(item.evidenceId)), 'Standalone records get application source IDs.');
  // Qualities are derived from those records without a request of their own; these fixture works carry no typed tags.
  assert.deepEqual(result.profile.results.at(-1), { domain: 'qualities', band: 'derived', status: 'empty', count: 0 });
  assert.equal(Object.hasOwn(result.profile, 'entities'), false, 'With a prediction, entities are returned once, inside tasteInput.');
  const dna = dnaFor('qloo', result.tasteInput.requiredAnchors.map(anchor => anchor.ref), result.tasteInput);
  const validated = await handler('culture_validate_design_dna', { dna, tasteInput: result.tasteInput });
  assert.equal(validated.structuredContent.status, 'valid');
  const missing = await handler('culture_validate_design_dna', { dna: { ...dna, devices: dna.devices.slice(1) }, tasteInput: result.tasteInput });
  assert.equal(missing.structuredContent.error.code, 'TASTE_PROTOCOL_INVALID');
  // A portable host passes its font library the same way, and the check reports which families load.
  const fonts = [{ family: 'Gelasio', files: ['fonts/gelasio-latin-wght-normal.woff2'], similarTo: ['Georgia'] }];
  const georgia = { ...dna, devices: dna.devices.map(device => device.layer === 'typography' ? { ...device, tokens: { fonts: ['Georgia'] } } : device) };
  assert.match((await handler('culture_validate_design_dna', { dna: georgia, tasteInput: result.tasteInput, fonts })).structuredContent.error.message, /Gelasio stands in for Georgia/);
  assert.equal((await handler('culture_validate_design_dna', { dna, tasteInput: result.tasteInput, fonts })).structuredContent.status, 'valid');
  // A portable host passes its photo library the same way the Studio does.
  const photoDna = { ...dna, devices: [...dna.devices, photoDevice(dna.devices[0].anchors[0])] };
  assert.equal((await handler('culture_validate_design_dna', { dna: photoDna, tasteInput: result.tasteInput, library: PHOTOS })).structuredContent.status, 'valid');
  const unlisted = await handler('culture_validate_design_dna', { dna: photoDna, tasteInput: result.tasteInput, library: PHOTOS.slice(1) });
  assert.equal(unlisted.structuredContent.error.code, 'TASTE_PROTOCOL_INVALID'); assert.match(unlisted.structuredContent.error.message, /market-1\.jpg is not in culture-library\.json/);
  const site = siteFor('qloo');
  const conformance = (await handler('culture_check_dna_conformance', { dna, files: { 'index.html': site.html, 'styles.css': site.css } })).structuredContent;
  assert.equal(conformance.score, 1); assert.equal(conformance.motion.reducedMotion, true); assert.deepEqual(conformance.illustrations, [{ id: 'fixture-art', shapes: 8 }]);
  const fontCheck = (await handler('culture_check_dna_conformance', { dna, files: { 'index.html': site.html, 'styles.css': site.css }, fonts })).structuredContent;
  assert.deepEqual(fontCheck.fonts, { loaded: ['Gelasio'], unknown: [] });
  const photoCheck = (await handler('culture_check_dna_conformance', { dna: photoDna, files: { 'index.html': site.html.replace('</main>', '<img src="library/absent-3.jpg" alt=""></main>'), 'styles.css': site.css }, library: PHOTOS })).structuredContent;
  assert.deepEqual(photoCheck.photos, { used: [], unknown: ['library/absent-3.jpg'] });
  const compared = (await handler('culture_compare_designs', { a: { 'index.html': site.html, 'styles.css': site.css }, b: { 'index.html': site.html, 'styles.css': site.css } })).structuredContent;
  assert.equal(compared.distance.overall, 0);
});

test('a taste bridge exposes host-owned taste tools only; the research bridge keeps its tools', async () => {
  const names = options => getToolDefinitions(options).map(tool => tool.name);
  const taste = names({ includeProjectTools: true, includeQlooTools: false, protocol: 'taste' });
  for (const name of ['project_get_taste', 'project_check_dna', 'project_write_file']) assert.ok(taste.includes(name), name);
  for (const name of ['project_get_research', 'culture_validate_design_dna', 'qloo_taste_profile']) assert.equal(taste.includes(name), false, name);
  assert.equal(taste.some(name => name.startsWith('qloo_')), false);
  const research = names({ includeProjectTools: true, includeQlooTools: true });
  assert.ok(research.includes('project_get_research')); assert.ok(research.includes('qloo_search_tags')); assert.equal(research.includes('qloo_taste_profile'), false);
  const portable = names({});
  for (const name of ['qloo_taste_profile', 'culture_validate_design_dna', 'culture_check_dna_conformance', 'culture_compare_designs']) assert.ok(portable.includes(name), name);
  // The image tool exists only on a taste bridge whose host can generate images.
  assert.equal(taste.includes('project_generate_image'), false);
  assert.ok(names({ includeProjectTools: true, includeQlooTools: false, protocol: 'taste', imageTool: true }).includes('project_generate_image'));
  for (const options of [{ includeProjectTools: true, imageTool: true }, { imageTool: true }]) assert.equal(names(options).includes('project_generate_image'), false, JSON.stringify(options));
  const listed = await dispatchRpc({ includeProjectTools: true, includeQlooTools: false, protocol: 'taste', imageTool: true, message: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  assert.deepEqual(listed.result.tools.find(tool => tool.name === 'project_generate_image').inputSchema.required, ['device', 'subject']);
  const initialized = await dispatchRpc({ includeProjectTools: true, includeQlooTools: false, protocol: 'taste', message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
  assert.match(initialized.result.instructions, /Taste-led design policy/); assert.doesNotMatch(initialized.result.instructions, /Creative decision policy/);
});

test('taste-led Kiro sessions get no web or direct Qloo tools in either arm', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-taste-kiro-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const home = await prepareKiroWorkspace({ directory, config: getConfig({}), model: 'fixed-test-model', bridgeUrl: 'http://127.0.0.1:8787', bridgeToken: 'test-only', mode: 'qloo', webBridgeToken: 'test-only-web', protocol: 'taste' });
  const agent = JSON.parse(await fs.readFile(path.join(home, 'agents', 'culture-demo.json'), 'utf8'));
  assert.deepEqual(agent.tools, ['@culture']); assert.deepEqual(agent.allowedTools, ['@culture']);
  assert.equal(agent.mcpServers.culture.env.CULTURE_ENABLE_QLOO, 'false'); assert.equal(agent.mcpServers.culture.env.CULTURE_PROTOCOL, 'taste');
  assert.equal(agent.mcpServers.culture.env.CULTURE_IMAGE_TOOL, undefined); assert.equal(agent.mcpServers.culture.timeout, 30000);
  assert.match(agent.prompt, /Taste-led design policy/);
  // With host image generation the MCP server lists the image tool and waits long enough for it.
  const imageHome = await prepareKiroWorkspace({ directory: path.join(directory, 'images'), config: getConfig({}), model: 'fixed-test-model', bridgeUrl: 'http://127.0.0.1:8787', bridgeToken: 'test-only', mode: 'baseline', protocol: 'taste', images: true });
  const imageAgent = JSON.parse(await fs.readFile(path.join(imageHome, 'agents', 'culture-demo.json'), 'utf8'));
  assert.equal(imageAgent.mcpServers.culture.env.CULTURE_IMAGE_TOOL, 'true'); assert.equal(imageAgent.mcpServers.culture.timeout, 600000);
  assert.deepEqual(imageAgent.tools, ['@culture']);
});

const readyKiro = async () => ({ available: true, authenticated: true, version: 'test-only', defaultModel: 'fixed-test-model' });
async function setup(t, runner, { calls = [], factory, imageGenerator } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-taste-studio-'));
  // These are the taste-led protocol's own tests; tests/site-production.test.mjs runs builds with the production stages.
  const config = { ...getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, PRODUCTION_STAGES: 'off' }), qlooKey: 'test-fixture-only-key' };
  assert.equal(config.creativeProtocol, 'taste', 'The taste-led protocol is the default.');
  let created = 0;
  const studio = await createStudio({ config, inspect: readyKiro, runner, qlooClientFactory: factory || (() => { created++; return fakeQloo(calls); }), imageGenerator });
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { studio, calls, created: () => created };
}
async function finished(studio, id) {
  for (let i = 0; i < 400; i++) {
    const job = studio.manager.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return studio.manager.publicJob(job);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Test job did not finish.');
}
const bridge = ({ bridgeUrl, bridgeToken }) => async (name, args = {}) => (await fetch(bridgeUrl + '/internal/tools', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken }, body: JSON.stringify({ name, arguments: args }) })).json();
const write = (call, file, content) => call('project_write_file', { path: file, content: typeof content === 'string' ? content : JSON.stringify(content) });

/** A test-only agent that follows the taste-led protocol through the real bridge and probes every gate. */
function tasteAgent(log) {
  return async context => {
    const { mode, kind, project } = context;
    const call = bridge(context);
    const entry = { mode, kind, prompt: context.prompt, protocol: context.protocol, webBridgeToken: context.webBridgeToken, probes: {} };
    log.push(entry);
    entry.blindBrief = JSON.parse(await project.readFile('culture-brief.json'));
    entry.tasteFileBefore = await project.readFile('culture-taste.json').then(() => true, () => false);
    entry.library = await project.readFile('culture-library.json').then(JSON.parse, () => null);
    entry.fonts = await project.readFile('culture-fonts.json').then(JSON.parse, () => null);
    entry.probes.pending = (await call('project_get_taste')).structuredContent;
    if (entry.probes.pending.status === 'awaiting-prediction') {
      entry.probes.dnaEarly = await write(call, 'culture-dna.json', { schemaVersion: '1.0' });
      entry.probes.siteEarly = await write(call, 'index.html', '<p>Too early</p>');
      entry.probes.qloo = await call('qloo_search_entities', { query: 'Blade Runner' });
      entry.probes.web = await call('studio_web_before', { toolName: 'web_search', input: { query: 'x' } });
      entry.probes.hostFile = await write(call, 'culture-taste.json', '{}');
      entry.probes.libraryFile = await write(call, 'culture-library.json', '{}');
      entry.probes.fontsFile = await write(call, 'culture-fonts.json', '{}');
      entry.probes.cased = await write(call, 'Culture-Taste.json', '{}');
      entry.probes.invalidAssumption = await write(call, 'culture-assumption.json', { schemaVersion: '1.0', audienceSummary: 'Missing domains.', predictions: {} });
      entry.probes.noSketch = await write(call, 'culture-assumption.json', assumptionFor(entry.probes.pending.domains, { sketch: null }));
      entry.probes.assumption = await write(call, 'culture-assumption.json', assumptionFor(entry.probes.pending.domains));
    }
    entry.probes.refreeze = await write(call, 'culture-assumption.json', assumptionFor(DEFAULT_DOMAINS));
    const revealed = (await call('project_get_taste')).structuredContent;
    entry.revealed = revealed;
    const required = revealed.requiredAnchors.map(anchor => anchor.ref);
    if (kind === 'plan') {
      const own = revealed.entities.filter(entity => entity.source === 'model-assumption').map(entity => entity.ref);
      const pool = revealed.entities.filter(entity => entity.source === 'qloo').map(entity => entity.ref);
      const other = (pool.length ? pool : own).find(ref => !required.includes(ref));
      entry.probes.site = await write(call, 'index.html', siteFor(mode).html);
      entry.probes.directions = await write(call, 'culture-directions.json', ['d0', 'd1', 'd2', 'd3'].map((id, index) => ({ id, title: `Test direction ${id}`, summary: 'A test-only direction summary.',
        anchors: id === 'd0' ? own.slice(0, 2) : [required[index - 1], other], devices: [{ layer: 'palette', device: 'Test palette move' }, { layer: 'typography', device: 'Test type move' }, { layer: 'layout', device: 'Test layout move' }],
        changes: [{ selector: '#hero', change: 'A test-only change.' }], tradeoffs: [], audienceIds: ['a1'] })));
      return;
    }
    const refs = [...required];
    for (const entity of revealed.entities) if (refs.length < 6 && !refs.includes(entity.ref)) refs.push(entity.ref);
    const unlisted = dnaFor(mode, refs, revealed);
    unlisted.devices[0] = { ...unlisted.devices[0], tokens: { ...unlisted.devices[0].tokens, css: [{ property: 'filter', value: 'grayscale(1)' }], images: ['library/not-listed.jpg'] } };
    entry.probes.unlistedPhoto = await write(call, 'culture-dna.json', unlisted);
    // A family outside culture-fonts.json is refused with the library family that stands in for it.
    const systemFont = dnaFor(mode, refs, revealed);
    systemFont.devices[1] = { ...systemFont.devices[1], tokens: { fonts: ['Futura', 'sans-serif'] } };
    entry.probes.systemFont = await write(call, 'culture-dna.json', systemFont);
    entry.probes.dna = await write(call, 'culture-dna.json', dnaFor(mode, refs, revealed));
    entry.probes.imageOff = await call('project_generate_image', { device: 'dna7', subject: 'A test-only picture of jars on a shelf' });
    // The catalogue facts in the starter's data island are fixed; its narrative fields follow the voice device.
    entry.probes.factChanged = await write(call, 'index.html', siteFor(mode).html.replace(dataIsland(mode), dataIsland(mode, { change: { items: STARTER_DATA.items.map((item, index) => index ? item : { ...item, price: 1 }) } })));
    entry.probes.noData = await write(call, 'index.html', siteFor(mode).html.replace(dataIsland(mode), ''));
    const draft = siteFor(mode, { omitCopy: true });
    await write(call, 'index.html', draft.html); await write(call, 'styles.css', draft.css);
    entry.probes.firstCheck = (await call('project_check_dna')).structuredContent;
    entry.probes.dnaLate = await write(call, 'culture-dna.json', dnaFor(mode, refs, revealed));
    await write(call, 'index.html', siteFor(mode).html);
    entry.probes.finalCheck = (await call('project_check_dna')).structuredContent;
  };
}

test('a taste-led comparison predicts blind, reveals measured taste, binds a DNA and records attributable differences', async t => {
  const log = [];
  const { studio, calls, created } = await setup(t, tasteAgent(log));
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'compare', cultureBrief });
  assert.equal(job.protocol, 'taste'); assert.deepEqual(job.taste.domains, STUDIO_DOMAINS);
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error);
  assert.equal(created(), 1); assert.equal(calls.length, 14, 'One bounded host taste pass before any model run.');
  assert.deepEqual(log.map(entry => [entry.mode, entry.protocol, entry.webBridgeToken]), [['baseline', 'taste', undefined], ['qloo', 'taste', undefined]]);
  const withoutSource = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');
  assert.notEqual(log[0].prompt, log[1].prompt);
  assert.equal(withoutSource(log[0].prompt), withoutSource(log[1].prompt), 'Only the taste-source paragraph differs between arms.');
  for (const entry of log) {
    assert.deepEqual(entry.blindBrief.evidence, []); assert.equal(entry.blindBrief.provenance, 'taste-protocol-blind-until-prediction');
    assert.equal(entry.tasteFileBefore, false); assert.equal(entry.probes.pending.status, 'awaiting-prediction');
    for (const probe of ['dnaEarly', 'siteEarly', 'qloo', 'web', 'hostFile', 'libraryFile', 'fontsFile', 'cased', 'refreeze', 'unlistedPhoto', 'systemFont', 'dnaLate', 'imageOff', 'factChanged', 'noData']) assert.equal(entry.probes[probe].isError, true, `${entry.mode} ${probe}`);
    assert.match(entry.probes.cased.content[0].text, /exact lowercase/);
    // Both arms keep the same catalogue facts and write their own narrative, and the check lists starter lines still on the page.
    assert.match(entry.probes.factChanged.content[0].text, /^Invalid index\.html: site-data\.items\[0\]\.price is a product fact; keep 420\./);
    assert.match(entry.probes.noData.content[0].text, /Keep the <script type="application\/json" id="site-data"> block that app\.js reads/);
    assert.match(entry.prompt, /- Voice: include a voice device anchored to a ref, a measured one when the taste input has measured entities/);
    assert.match(entry.prompt, /keep its facts, the brand, priceSuffix, formDescription and formSuccess and each item's id, name, category, meta, price and priceLabel/);
    assert.match(entry.prompt, /1\. Read [^\n]*\. Product facts and protected files are fixed; the narrative copy is yours to write in the voice of your DNA\./);
    assert.deepEqual([entry.probes.finalCheck.narrative.lines, entry.probes.finalCheck.narrative.rewritten], [16, 10]);
    assert.match(entry.probes.finalCheck.narrative.note, /Rewrite any that do not fit your voice device/);
    // Both arms read the same host font library and may name only its families.
    assert.match(entry.probes.fontsFile.content[0].text, /culture-fonts\.json is written by the host/);
    assert.match(entry.probes.systemFont.content[0].text, /Futura is not in culture-fonts\.json.*Jost stands in for Futura/);
    assert.equal(entry.fonts.provenance, 'host-font-library'); assert.equal(entry.fonts.families.length, 33);
    assert.ok(entry.fonts.families.every(family => family.category && family.fontFace.length && family.fontFace.every(rule => /^@font-face\{font-family:'[^']+';src:url\('fonts\/[a-z0-9-]+\.woff2'\) format\('woff2'\)/u.test(rule))));
    assert.match(entry.prompt, /1\. Read index\.html, styles\.css, app\.js, culture-brief\.json, culture-fonts\.json and culture-library\.json\./);
    // Motion and illustration are required in both arms, from measured tags in one and predicted qualities in the other.
    assert.match(entry.prompt, /- Motion: include a motion device anchored to a style ref/); assert.match(entry.prompt, /- Illustration: include a device anchored to an aesthetic ref/);
    assert.match(entry.probes.pending.domains.join(','), /style,aesthetic,qualities$/);
    // Without a host image generator neither arm is offered images, and the bridge refuses the tool.
    assert.match(entry.probes.imageOff.content[0].text, /Image generation is not available in this run/);
    assert.doesNotMatch(entry.prompt, /project_generate_image/);
    assert.match(entry.probes.libraryFile.content[0].text, /culture-library\.json is written by the host/);
    assert.match(entry.probes.unlistedPhoto.content[0].text, /library\/not-listed\.jpg is not in culture-library\.json/);
    assert.equal(entry.library.provenance, 'host-photo-library'); assert.equal(entry.library.photos.length, 21);
    assert.ok(entry.library.photos.every(photo => photo.productName && photo.tags.length && /^library\/[a-z0-9-]+\.jpg$/u.test(photo.path)));
    assert.match(entry.prompt, /culture-library\.json lists the host's 21 openly licensed product photographs/);
    assert.equal(entry.probes.invalidAssumption.structuredContent.error.code, 'CULTURE_ARTIFACT_INVALID');
    assert.equal(entry.probes.noSketch.structuredContent.error.code, 'CULTURE_ARTIFACT_INVALID'); assert.match(entry.probes.noSketch.content[0].text, /designSketch/);
    assert.equal(entry.probes.assumption.structuredContent.status, 'written'); assert.equal(entry.probes.dna.structuredContent.status, 'written');
    assert.equal(entry.probes.firstCheck.missing, 1); assert.equal(entry.probes.finalCheck.score, 1);
  }
  const [baseline, qloo] = done.runs;
  assert.equal(done.images, null); assert.deepEqual(baseline.generatedImages, []);
  assert.equal(baseline.taste.input.source, 'model-assumption'); assert.equal(baseline.taste.profile, null); assert.deepEqual(baseline.evidence, []);
  assert.ok(log[0].revealed.entities.every(entity => entity.source === 'model-assumption'));
  assert.equal(qloo.taste.input.source, 'qloo-profile'); assert.equal(qloo.taste.profile.status, 'ok');
  assert.ok(log[1].revealed.requiredAnchors.every(anchor => anchor.source === 'qloo' && anchor.surprise));
  assert.equal(qloo.evidence.length, 14); assert.ok(qloo.researchCalls.every(call => call.origin === 'host-taste-pass'));
  assert.deepEqual(log[1].revealed.entities.filter(entity => entity.domain === 'style' && entity.source === 'qloo').map(entity => [entity.name, entity.surprise]).slice(0, 2), [['Fixture Hushed', false], ['Fixture Lantern Lit', true]]);
  assert.match(log[1].revealed.guidance, /anchor a motion device to a measured style ref and an SVG illustration to a measured aesthetic ref/);
  assert.match(log[0].revealed.guidance, /anchor a motion device to a style ref and an SVG illustration to an aesthetic ref/);
  assert.ok(qloo.events.some(event => /Qloo also measured 4 style and 4 aesthetic tags; 7 were not predicted\./.test(event.message)));
  for (const run of done.runs) {
    assert.equal(run.tastePipeline.status, 'completed');
    assert.ok(run.tastePipeline.predictedAt <= run.tastePipeline.revealedAt && run.tastePipeline.revealedAt <= run.tastePipeline.specifiedAt && run.tastePipeline.specifiedAt <= run.tastePipeline.constructionStartedAt);
    assert.equal(run.taste.conformance.score, 1); assert.equal(run.taste.selfChecks, 2); assert.equal(run.decisions.length, 8);
    assert.deepEqual(run.taste.conformance.motion, { keyframes: ['fixture-drift'], used: ['fixture-drift'], undefined: [], infinite: ['fixture-drift'], reducedMotion: true, pauseControl: true });
    assert.deepEqual(run.taste.conformance.fonts, { loaded: [run.mode === 'qloo' ? 'Gelasio' : 'Jost'], unknown: [] });
    assert.deepEqual(run.decisions.find(decision => decision.dnaId === 'dna-art').selectors, ['#fixture-art']);
    assert.ok(run.previewUrl);
  }
  assert.ok(qloo.decisions.every(decision => decision.sourceType === 'qloo' && /^Q\d{3}$/.test(decision.evidenceIds[0]) && /not predicted/.test(decision.reason)));
  assert.ok(baseline.decisions.every(decision => decision.sourceType === 'model-interpretation' && !decision.evidenceIds.length));
  assert.deepEqual(qloo.decisions.find(decision => decision.layer === 'structure').selectors, ['#ledger']);
  const comparison = done.tasteComparison;
  assert.equal(comparison.qloo.surpriseAnchoredDevices, 8); assert.equal(comparison.baseline.qlooAnchoredDevices, 0);
  assert.match(comparison.headline, /^8 of 8 design devices in the Qloo on design rest on entities the model did not predict\.$/);
  // Each run carries its own counterfactual: the Qloo on site left its frozen sketch, the Qloo off site kept it.
  assert.equal(qloo.taste.sketchDivergence.score, 0.833); assert.equal(baseline.taste.sketchDivergence.score, 0);
  assert.equal(comparison.qloo.sketch.score, 0.833); assert.equal(comparison.baseline.sketch.score, 0);
  assert.match(comparison.sketchHeadline, /Qloo on site moved 83% .* Qloo off site moved 0%/);
  // The words beside the tokens: each arm rewrote the same starter fields in its own voice, so only those lines differ.
  for (const run of done.runs) assert.deepEqual([run.taste.narrative.lines, run.taste.narrative.rewritten], [16, 10]);
  assert.ok(qloo.events.some(event => event.message === 'Narrative: 10 of 16 starter lines rewritten in the DNA\'s voice; the product facts are unchanged.'));
  assert.ok(comparison.copy.examples.includes('pause motion')); assert.equal(comparison.copy.examples.some(line => line.includes('late suppers')), false);
  assert.match(comparison.copyHeadline, /^The two sites share \d+ of \d+ sentences word for word\. Qloo on rewrote 10 of 16 starter narrative lines and Qloo off 10\.$/);
  assert.ok(qloo.taste.dna.devices.every(device => device.surprise && device.qualities?.length && device.novel));
  assert.ok(comparison.distance.overall > 0.3); assert.match(comparison.limitation, /baseline-to-baseline/);
  const portable = JSON.parse(await studio.manager.project(job, 'qloo').readFile('culture-brief.json'));
  assert.equal(portable.provenance, 'studio-recorded-qloo-taste-profile'); assert.ok(portable.evidence.length >= 1 && portable.evidence.length <= 10);
  const ids = new Set(portable.evidence.map(record => record.id));
  assert.ok(portable.decisions.every(decision => decision.evidenceIds.every(id => ids.has(id))));
  assert.equal(validateCultureBrief(portable).valid, true, JSON.stringify(validateCultureBrief(portable).errors));
  const record = JSON.parse(await studio.manager.project(job, 'qloo').readFile('culture-taste.json'));
  assert.equal(record.source, 'qloo-profile'); assert.equal(record.dna.devices.length, 8); assert.equal(record.conformance.score, 1);
  assert.equal(record.profile.entities, undefined, 'Profile entities appear once, in input.entities.'); assert.equal(record.profile.entityCount, 36);
  const baselineRecord = JSON.parse(await studio.manager.project(job, 'baseline').readFile('culture-taste.json'));
  assert.equal(Object.hasOwn(baselineRecord, 'profile'), false);
  const exported = await (await fetch(`${studio.appUrl}/api/status`)).json();
  assert.equal(exported.protocol, 'taste');
  assert.deepEqual(log[0].library, log[1].library, 'Both arms read the same photo library.');
  // Previews serve listed library photos for the job's starter only; the Studio serves the same files as thumbnails.
  const photo = await fetch(qloo.previewUrl.replace(/index\.html$/u, 'library/olive-oil-1.jpg'));
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()).subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
  for (const name of ['library/olive-oil-9.jpg', 'library/library.json', 'library%2F..%2Fpackage.json']) assert.equal((await fetch(qloo.previewUrl.replace(/index\.html$/u, name))).status >= 400, true, name);
  assert.equal((await fetch(`${studio.appUrl}/library/local-food/olive-oil-1.jpg`)).headers.get('content-type'), 'image/jpeg');
  for (const name of ['indie-game/olive-oil-1.jpg', 'local-food/library.json', 'local-food/olive-oil-9.jpg']) assert.equal((await fetch(`${studio.appUrl}/library/${name}`)).status, 404, name);
  // Previews serve listed library fonts to the sandboxed page, which loads them as cross-origin fonts; nothing else under fonts/.
  const font = await fetch(qloo.previewUrl.replace(/index\.html$/u, 'fonts/gelasio-latin-wght-normal.woff2'));
  assert.equal(font.status, 200); assert.equal(font.headers.get('content-type'), 'font/woff2'); assert.equal(font.headers.get('access-control-allow-origin'), '*');
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString('latin1'), 'wOF2');
  for (const name of ['fonts/gelasio-missing.woff2', 'fonts/fonts.json', 'fonts/gelasio.OFL.txt', 'fonts%2F..%2Fpackage.json']) assert.equal((await fetch(qloo.previewUrl.replace(/index\.html$/u, name))).status >= 400, true, name);
  const families = await (await fetch(`${studio.appUrl}/api/fonts`)).json();
  assert.equal(families.length, 33); assert.deepEqual(families.find(item => item.family === 'Jost').files.map(file => file.path), ['fonts/jost-latin-wght-normal.woff2', 'fonts/jost-latin-wght-italic.woff2']);
  assert.equal((await fetch(`${studio.appUrl}/library/fonts/jost-latin-wght-normal.woff2`)).headers.get('content-type'), 'font/woff2');
  for (const name of ['fonts/fonts.json', 'fonts/jost.OFL.txt', 'fonts/absent.woff2']) assert.equal((await fetch(`${studio.appUrl}/library/${name}`)).status, 404, name);
});

test('a pass without aesthetic tags asks for a measured style ref and the model\'s own aesthetic ref', async t => {
  // Shaped like the live Echo Atlas pass, whose aesthetic request returned no tags while style returned eight.
  const log = [], base = fakeQloo();
  const factory = () => ({ ...base, async getInsights(input) {
    return input.tagTypes?.[0] === 'urn:tag:aesthetic_property:qloo' ? { status: 'empty', results: [], evidence: evidence('/v2/insights') } : base.getInsights(input);
  } });
  const { studio } = await setup(t, tasteAgent(log), { factory });
  const done = await finished(studio, (await studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief })).id);
  assert.equal(done.status, 'completed', done.error);
  const [run] = done.runs;
  assert.match(log[0].revealed.guidance, /anchor a motion device to a measured style ref and an SVG illustration to an aesthetic ref\./);
  assert.ok(run.events.some(event => /Qloo also measured 4 style and 0 aesthetic tags; 3 were not predicted\./.test(event.message)));
  assert.ok(run.taste.profile.limitations.includes('aesthetic tags returned no tags.'));
  const refs = new Map(run.taste.input.entities.map(entity => [entity.ref, entity]));
  const anchored = id => run.taste.dna.devices.find(device => device.id === id).anchors.map(ref => [refs.get(ref).domain, refs.get(ref).source]);
  assert.deepEqual(anchored('dna-motion'), [['style', 'qloo']]); assert.deepEqual(anchored('dna-art'), [['aesthetic', 'model-assumption']]);
  assert.equal(run.taste.conformance.score, 1);
});

test('a taste-led pair with typed tags requires shared qualities in both arms, anchors palette and type to them and lets them describe images', async t => {
  const log = [], generated = [];
  // A prediction that misses every shared quality, so the measured ones are surprises the design has to move with.
  const predictions = { style: ['Brisk', 'Glossy', 'Bold'], aesthetic: ['Chrome', 'Neon', 'Polished'], qualities: ['Cheerful', 'Sporty', 'Loud'] };
  const agent = async context => {
    const call = bridge(context);
    const entry = { mode: context.mode, probes: {} };
    log.push(entry);
    await write(call, 'culture-assumption.json', assumptionFor((await call('project_get_taste')).structuredContent.domains, { predictions }));
    const revealed = entry.revealed = (await call('project_get_taste')).structuredContent;
    const refs = revealed.requiredAnchors.map(anchor => anchor.ref), [lead] = revealed.requiredAnchors;
    const dna = dnaFor(context.mode, refs, revealed);
    dna.devices.push({ id: 'dna7', layer: 'imagery', device: 'Hazy dusk photographs', anchors: [lead.ref], qualities: [lead.name],
      translation: 'Test-only: the shared quality becomes dim, hazy product photographs.', tokens: { colors: ['#0b1d3a'], css: [{ property: 'object-fit', value: 'cover' }] } });
    const work = revealed.requiredAnchors.find(anchor => !['style', 'aesthetic', 'qualities'].includes(anchor.domain)).ref;
    entry.probes.workPalette = await write(call, 'culture-dna.json', { ...dna, devices: dna.devices.map(device => device.layer === 'palette' ? { ...device, anchors: [work] } : device) });
    entry.probes.dna = await write(call, 'culture-dna.json', dna);
    entry.probes.image = await call('project_generate_image', { device: 'dna7', subject: `${lead.name} olive oil bottles on a counter at dusk` });
    const site = siteFor(context.mode);
    await write(call, 'index.html', site.html.replace('</main>', '<figure id="dusk"><img src="generated/dna7-1.jpg" alt="Olive oil bottles at dusk" width="640" height="427"></figure></main>'));
    await write(call, 'styles.css', `${site.css}#dusk img{object-fit:cover;background:#0b1d3a}`);
    entry.probes.check = (await call('project_check_dna')).structuredContent;
  };
  const { studio } = await setup(t, agent, { factory: () => typedQloo(), imageGenerator: fakeImages(generated) });
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'compare', cultureBrief });
  assert.deepEqual(job.taste.domains, STUDIO_DOMAINS);
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error);
  const [baseline, qloo] = log;
  assert.deepEqual(qloo.revealed.requiredAnchors.map(anchor => anchor.ref), ['quality:look:atmospheric', 'quality:mood:melancholic', 'quality:meaning:reflective', 'movie-core-0', 'tv_show-core-0', 'artist-core-0']);
  assert.deepEqual(baseline.revealed.requiredAnchors.map(anchor => anchor.name), ['Cheerful', 'Sporty', 'Loud', 'Patagonia', 'Fixture Film Alpha', 'Nujabes']);
  assert.deepEqual(qloo.revealed.requiredAnchors.slice(0, 3).map(anchor => [anchor.family, anchor.count, anchor.surprise]), [['look', 5, true], ['mood', 3, true], ['meaning', 3, true]]);
  assert.match(qloo.revealed.guidance, /Refs in the qualities domain are look, mood and meaning tags that two or more measured works share: anchor the palette and the typography device each to a measured quality, style or aesthetic ref/);
  assert.match(baseline.revealed.guidance, /Refs in the qualities domain are the qualities you predicted the audience's favorite works share/);
  assert.match(qloo.probes.workPalette.content[0].text, /Qualities first: anchor a palette device to at least one measured quality ref, such as Atmospheric \(quality:look:atmospheric\)/);
  assert.match(baseline.probes.workPalette.content[0].text, /Qualities first: anchor a palette device to at least one quality ref, such as Cheerful \(M22\)/);
  for (const entry of log) {
    assert.equal(entry.probes.dna.structuredContent.status, 'written', entry.mode);
    // A shared quality is a quality, not a taste entity, so it may describe the picture.
    assert.equal(entry.probes.image.structuredContent.status, 'generated', entry.mode);
    assert.equal(entry.probes.check.score, 1, entry.mode);
  }
  assert.match(generated[1].prompt, /\nSubject: Atmospheric olive oil bottles on a counter at dusk\n/); assert.match(generated[1].prompt, /Qualities: Atmospheric\./);
  const run = done.runs.find(item => item.mode === 'qloo');
  assert.ok(run.events.some(event => /The measured works share 7 look, mood and meaning qualities; 7 were not predicted\./.test(event.message)));
  assert.equal(run.decisions[0].reason, 'Anchored to Atmospheric (Qloo look quality of 5 works, not predicted).');
  assert.ok(run.decisions[0].evidenceIds.every(id => /^Q\d{3}$/u.test(id)) && run.decisions[0].evidenceIds.length === 3);
  assert.equal(done.tasteComparison.qualityHeadline, '6 of 9 Qloo on devices translate measured qualities; 6 of 9 Qloo off devices translate qualities the model predicted.');
  assert.match(done.tasteComparison.headline, /rest on entities or qualities the model did not predict\.$/);
  const record = JSON.parse(await studio.manager.project(job, 'qloo').readFile('culture-taste.json'));
  assert.deepEqual(record.profile.results.at(-1), { domain: 'qualities', band: 'derived', status: 'ok', count: 7 });
  assert.equal(record.input.entities.filter(entity => entity.domain === 'qualities' && entity.source === 'qloo').length, 7);
});

test('a taste-led build shows library photos its device qualities chose, and records them for checks, comparison and download', async t => {
  const checks = [];
  const photoAgent = async context => {
    const call = bridge(context);
    const library = JSON.parse(await context.project.readFile('culture-library.json'));
    const photo = library.photos.find(item => item.tags.includes('Moody'));
    await write(call, 'culture-assumption.json', assumptionFor((await call('project_get_taste')).structuredContent.domains));
    const revealed = (await call('project_get_taste')).structuredContent;
    const refs = revealed.requiredAnchors.map(anchor => anchor.ref);
    const dna = dnaFor('baseline', refs, revealed);
    dna.devices.push({ id: 'dna7', layer: 'imagery', device: 'Duotone product photographs', anchors: [refs[0]], qualities: ['Moody'], translation: 'Test-only: a moody photo tinted with two palette colors.',
      tokens: { colors: ['#2c6e49', '#f4efe6'], css: [{ property: 'filter', value: 'grayscale(1)' }, { property: 'mix-blend-mode', value: 'multiply' }], images: [photo.path] } });
    assert.equal((await write(call, 'culture-dna.json', dna)).structuredContent.status, 'written');
    const site = siteFor('baseline');
    const figure = src => `<figure id="photo"><img src="${src}" alt="${photo.alt}" width="${photo.width}" height="${photo.height}"></figure></main>`;
    await write(call, 'index.html', site.html.replace('</main>', figure('library/olive-oil-9.jpg')));
    await write(call, 'styles.css', `${site.css}#photo{background:#2c6e49}#photo img{filter:grayscale(1);mix-blend-mode:multiply;background:#f4efe6}`);
    checks.push((await call('project_check_dna')).structuredContent);
    await write(call, 'index.html', site.html.replace('</main>', figure(photo.path)));
    checks.push((await call('project_check_dna')).structuredContent);
  };
  const { studio } = await setup(t, photoAgent);
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief });
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error);
  assert.deepEqual(checks[0].photos, { used: [], unknown: ['library/olive-oil-9.jpg'] }); assert.equal(checks[0].devices.find(device => device.id === 'dna7').status, 'partial');
  assert.deepEqual(checks[1].photos, { used: ['library/olive-oil-2.jpg'], unknown: [] }); assert.equal(checks[1].score, 1);
  const [run] = done.runs;
  assert.deepEqual(run.taste.dna.devices.at(-1).tokens.images, ['library/olive-oil-2.jpg']); assert.deepEqual(run.taste.conformance.photos.used, ['library/olive-oil-2.jpg']);
  assert.ok(run.decisions.some(decision => decision.title === 'Imagery · Duotone product photographs'));
  assert.equal(run.events.some(event => /photos the library does not contain/.test(event.message)), false, 'The repaired site references listed photos only.');
  const preview = await fetch(run.previewUrl.replace(/index\.html$/u, 'library/olive-oil-2.jpg'));
  assert.equal(preview.status, 200);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), await fs.readFile(path.join(studio.manager.config.rootDir, 'library', 'local-food', 'olive-oil-2.jpg')));
  const download = await (await fetch(`${studio.appUrl}/api/jobs/${job.id}/runs/baseline/download`)).json();
  assert.equal(download.files['culture-library.json'] !== undefined, true);
  assert.deepEqual(download.photos, [{ path: 'library/olive-oil-2.jpg', repositoryPath: 'library/local-food/olive-oil-2.jpg', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    creator: null, provider: 'rawpixel', sourceUrl: 'https://www.rawpixel.com/image/5927777/photo-image-background-public-domain-black' }]);
  assert.match(download.photoNote, /openly licensed photos/);
  // Font files, like photos, are named with their repository paths and licences.
  assert.deepEqual(download.fonts.map(({ path: file, family, repositoryPath, license, licenseRepositoryPath }) => [file, family, repositoryPath, license, licenseRepositoryPath]),
    [['fonts/jost-latin-wght-normal.woff2', 'Jost', 'library/fonts/jost-latin-wght-normal.woff2', 'OFL-1.1', 'library/fonts/jost.OFL.txt']]);
  assert.match(download.fontNote, /open-licence fonts/); assert.equal(typeof download.files['culture-fonts.json'], 'string');
});

/** A test-only image generator: it copies a library JPEG instead of calling Codex, and fails on request. */
function fakeImages(log) {
  return { available: true, provider: 'codex', version: '0.160.0-test',
    async generate({ prompt, directory, name }) {
      log.push({ prompt, name });
      if (prompt.includes('FAIL')) throw new Error('Test-only generation failure.');
      const bytes = await fs.readFile(path.join(import.meta.dirname, '..', 'library', 'local-food', 'olive-oil-1.jpg'));
      await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, `${name}.jpg`), bytes);
      return { path: `generated/${name}.jpg`, format: 'jpeg', width: 640, height: 427, bytes: bytes.length, durationMs: 1200, description: 'Test-only: a bottle of oil on a table.' };
    } };
}
const REVISION_PLAN = { schemaVersion: '1.0', decisions: [{ id: 'ledger', decision: 'Revise the ledger section.', initialApproach: 'Warm the ledger copy.', alternatives: ['Keep the ledger unchanged.'], openQuestions: [], fixedFacts: ['Catalogue facts stay.'] }] };
const REVISION_KEEP = { schemaVersion: '1.0', summary: 'The inherited taste evidence is sufficient.', decisions: [{ decisionId: 'ledger', outcome: 'keep', reason: 'No new research is needed for a copy change.', approach: 'Warm the ledger copy.', evidenceIds: [], webSourceIds: [], rejectedAlternatives: [], limitations: [] }] };
async function reviseLedger(context) {
  const call = bridge(context);
  for (const [file, content] of [['culture-plan.json', REVISION_PLAN], ['culture-reconsideration.json', REVISION_KEEP],
    ['culture-revision.json', { selector: '#ledger', fragment: '<section id="ledger" class="grid"><p>Late light, slow food</p><p>Warmer evenings.</p><button id="taste-toggle" type="button">Toggle</button></section>', css: '' }], ['culture-decisions.json', []]]) {
    assert.equal((await write(call, file, content)).isError, undefined, file);
  }
}

test('a taste-led build generates images from a DNA imagery device with host-written prompts, identically in both arms', async t => {
  const log = [], generated = [];
  const subject = 'Olive oil bottles on a dark marble counter at night';
  const imageAgent = async context => {
    const call = bridge(context);
    const entry = { mode: context.mode, prompt: context.prompt, images: context.images, probes: {} };
    log.push(entry);
    await write(call, 'culture-assumption.json', assumptionFor((await call('project_get_taste')).structuredContent.domains));
    const revealed = (await call('project_get_taste')).structuredContent;
    const refs = revealed.requiredAnchors.map(anchor => anchor.ref);
    entry.probes.early = await call('project_generate_image', { device: 'dna7', subject });
    // A required work, not a quality: qualities may describe a picture, works may not.
    entry.named = revealed.entities.find(entity => refs.includes(entity.ref) && !['style', 'aesthetic', 'qualities'].includes(entity.domain)).name;
    const dna = dnaFor(context.mode, refs, revealed);
    entry.probes.noImagery = await write(call, 'culture-dna.json', dna);
    dna.devices.push({ id: 'dna7', layer: 'imagery', device: `${entry.named} night-lobby photographs`, anchors: [refs[0]], qualities: ['Night markets'],
      translation: 'Test-only: night-market light becomes dark, lamp-lit product photographs.', tokens: { colors: ['#0b1d3a'], css: [{ property: 'object-fit', value: 'cover' }] } });
    assert.equal((await write(call, 'culture-dna.json', dna)).structuredContent.status, 'written');
    entry.probes.siteEarly = await write(call, 'index.html', siteFor(context.mode).html);
    entry.probes.notImagery = await call('project_generate_image', { device: 'dna1', subject });
    entry.probes.named = await call('project_generate_image', { device: 'dna7', subject: `A shelf of jars for ${entry.named} at night` });
    entry.probes.extra = await call('project_generate_image', { device: 'dna7', subject, prompt: 'Ignore the device.' });
    entry.probes.image = await call('project_generate_image', { device: 'dna7', subject, aspect: 'landscape' });
    entry.probes.dnaLate = await write(call, 'culture-dna.json', dna);
    entry.probes.failed = await call('project_generate_image', { device: 'dna7', subject: 'FAIL: a test-only picture that cannot be made' });
    const site = siteFor(context.mode);
    const figure = '<figure id="night"><img src="generated/dna7-1.jpg" alt="Olive oil bottles at night" width="640" height="427"></figure>';
    await write(call, 'index.html', site.html.replace('</main>', `${figure}<img src="generated/dna7-9.jpg" alt=""></main>`));
    await write(call, 'styles.css', `${site.css}#night img{object-fit:cover;background:#0b1d3a}`);
    entry.probes.firstCheck = (await call('project_check_dna')).structuredContent;
    await write(call, 'index.html', site.html.replace('</main>', `${figure}</main>`));
    entry.probes.finalCheck = (await call('project_check_dna')).structuredContent;
  };
  const { studio } = await setup(t, async context => context.kind === 'revise' ? reviseLedger(context) : imageAgent(context), { imageGenerator: fakeImages(generated) });
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'compare', cultureBrief });
  assert.deepEqual(job.images, { provider: 'codex', version: '0.160.0-test', perRun: 8 });
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error);
  const withoutSource = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');
  assert.equal(withoutSource(log[0].prompt), withoutSource(log[1].prompt), 'Both arms receive the same image capability.');
  for (const entry of log) {
    assert.equal(entry.images, true); assert.match(entry.prompt, /call project_generate_image one to 8 times/); assert.match(entry.prompt, /library photos and generated images are local/);
    assert.match(entry.prompt, /frozen once you write the first site file or request the first image/);
    for (const probe of ['early', 'noImagery', 'siteEarly', 'notImagery', 'named', 'extra', 'dnaLate', 'failed']) assert.equal(entry.probes[probe].isError, true, `${entry.mode} ${probe}`);
    assert.match(entry.probes.early.content[0].text, /Save a valid culture-dna\.json with an imagery device/);
    // With images on, the DNA needs an imagery device and the site waits for at least one image request.
    assert.match(entry.probes.noImagery.content[0].text, /This build generates images, so include at least one imagery device/);
    assert.match(entry.probes.siteEarly.content[0].text, /request at least one with project_generate_image .* before writing site files/);
    assert.match(entry.probes.notImagery.content[0].text, /imagery device in your saved culture-dna\.json \(dna7\)/);
    assert.match(entry.probes.named.content[0].text, /without naming taste entities/);
    assert.equal(entry.probes.extra.structuredContent.error.code, 'TOOL_INPUT_INVALID');
    assert.match(entry.probes.dnaLate.content[0].text, /frozen/, 'An image request freezes the DNA like the first site file.');
    assert.equal(entry.probes.failed.structuredContent.error.code, 'IMAGE_GENERATION_FAILED');
    const { use, ...reply } = entry.probes.image.structuredContent;
    assert.deepEqual(reply, { status: 'generated', path: 'generated/dna7-1.jpg', width: 640, height: 427, aspect: 'landscape', device: 'dna7', description: 'Test-only: a bottle of oil on a table.' });
    assert.match(use, /img src/);
    assert.deepEqual(entry.probes.firstCheck.generatedImages, { used: ['generated/dna7-1.jpg'], unused: [], unknown: ['generated/dna7-9.jpg'] });
    assert.deepEqual(entry.probes.finalCheck.generatedImages, { used: ['generated/dna7-1.jpg'], unused: [], unknown: [] });
  }
  assert.equal(generated.length, 4, 'Each arm sent its image and its failing request to the generator; rejected requests never reached it.');
  for (const run of done.runs) {
    const entry = log.find(item => item.mode === run.mode);
    assert.equal(run.generatedImages.length, 1);
    const [image] = run.generatedImages;
    assert.equal(image.path, 'generated/dna7-1.jpg'); assert.equal(image.used, true); assert.equal(image.provider, 'codex'); assert.equal(image.device, 'dna7');
    assert.match(image.prompt, /^Use your built-in image generation tool/); assert.match(image.prompt, /\nSubject: Olive oil bottles on a dark marble counter at night\n/);
    assert.match(image.prompt, /\nArt direction: night-lobby photographs\. Palette: #0b1d3a, /); assert.match(image.prompt, /Qualities: Night markets\./);
    assert.equal(image.prompt.includes(entry.named), false, 'The anchor entity named in the device stays out of the image prompt.');
    assert.equal(image.url, run.previewUrl.replace(/index\.html$/u, 'generated/dna7-1.jpg'));
    assert.deepEqual(run.taste.conformance.generatedImages, { used: ['generated/dna7-1.jpg'], unused: [], unknown: [] });
    assert.ok(run.events.some(event => /Rejected an image request/.test(event.message)));
    assert.ok(run.events.some(event => /dna7-2 was not generated: Test-only generation failure/.test(event.message)));
    const preview = await fetch(image.url);
    assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'image/jpeg');
    const bytes = Buffer.from(await preview.arrayBuffer());
    assert.deepEqual(bytes, await fs.readFile(path.join(import.meta.dirname, '..', 'library', 'local-food', 'olive-oil-1.jpg')));
    for (const name of ['generated/dna7-2.jpg', 'generated/dna7-9.jpg', 'generated/..%2Fmeta.json']) assert.ok((await fetch(run.previewUrl.replace(/index\.html$/u, name))).status >= 400, name);
    const record = JSON.parse(await studio.manager.project(job, run.mode).readFile('culture-taste.json'));
    assert.deepEqual(record.generatedImages.map(item => [item.path, item.used, item.prompt]), [[image.path, true, image.prompt]]);
    const download = await (await fetch(`${studio.appUrl}/api/jobs/${job.id}/runs/${run.mode}/download`)).json();
    assert.deepEqual(download.generatedImages.map(item => [item.path, item.mimeType, item.prompt]), [[image.path, 'image/jpeg', image.prompt]]);
    assert.deepEqual(Buffer.from(download.generatedImages[0].base64, 'base64'), bytes);
  }
  const status = await (await fetch(`${studio.appUrl}/api/status`)).json();
  assert.deepEqual(status.images, { available: true, provider: 'codex', version: '0.160.0-test', perRun: 8 });
  const page = await fetch(`${studio.appUrl}/`);
  assert.ok(page.headers.get('content-security-policy').includes(`img-src 'self' data: ${new URL(studio.previewBaseUrl).origin};`), 'The Studio can show generated-image thumbnails from the preview origin.');
  // A scoped revision copies the images its source recorded, so its preview keeps them.
  const revision = await finished(studio, (await studio.manager.create({ kind: 'revise', mode: 'qloo', parentJobId: job.id, parentMode: 'qloo', targetSelector: '#ledger', brief: 'Make only the ledger section warmer in tone.' })).id);
  assert.equal(revision.status, 'completed', revision.error);
  const [revised] = revision.runs;
  assert.deepEqual(revised.generatedImages.map(item => [item.path, item.reusedFrom]), [['generated/dna7-1.jpg', { jobId: job.id, mode: 'qloo' }]]);
  assert.equal((await fetch(revised.generatedImages[0].url)).status, 200);
});

test('a scoped revision of a taste-led variant keeps its taste evidence and a portable brief', async t => {
  const log = [];
  const plan = { schemaVersion: '1.0', decisions: [{ id: 'ledger', decision: 'Revise the ledger section.', initialApproach: 'Warm the ledger copy.', alternatives: ['Keep the ledger unchanged.'], openQuestions: [], fixedFacts: ['Catalogue facts stay.'] }] };
  const reconsideration = { schemaVersion: '1.0', summary: 'The inherited taste evidence is sufficient.', decisions: [{ decisionId: 'ledger', outcome: 'keep', reason: 'No new research is needed for a copy change.', approach: 'Warm the ledger copy.', evidenceIds: [], webSourceIds: [], rejectedAlternatives: [], limitations: [] }] };
  const revise = async context => {
    const call = bridge(context);
    for (const [file, content] of [['culture-plan.json', plan], ['culture-reconsideration.json', reconsideration],
      ['culture-revision.json', { selector: '#ledger', fragment: '<section id="ledger" class="grid"><p>Late light, slow food</p><p>Warmer evenings.</p><button id="taste-toggle" type="button">Toggle</button></section>', css: '' }], ['culture-decisions.json', []]]) {
      assert.equal((await write(call, file, content)).isError, undefined, file);
    }
  };
  const { studio } = await setup(t, async context => context.kind === 'revise' ? revise(context) : tasteAgent(log)(context));
  const source = await finished(studio, (await studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief })).id);
  assert.equal(source.status, 'completed', source.error);
  const job = await studio.manager.create({ kind: 'revise', mode: 'qloo', parentJobId: source.id, parentMode: 'qloo', targetSelector: '#ledger', brief: 'Make only the ledger section warmer in tone.' });
  assert.equal(job.protocol, 'research');
  const revised = await finished(studio, job.id);
  assert.equal(revised.status, 'completed', revised.error);
  assert.equal(revised.runs[0].evidence.length, source.runs[0].evidence.length);
  assert.ok(revised.runs[0].evidence.every(record => record.reusedFrom?.jobId === source.id));
  const portable = JSON.parse(await studio.manager.project(job, 'qloo').readFile('culture-brief.json'));
  assert.ok(portable.evidence.length <= 10 && portable.evidence.length < revised.runs[0].evidence.length);
  assert.equal(validateCultureBrief(portable).valid, true, JSON.stringify(validateCultureBrief(portable).errors));
});

test('a failed taste pass stops the comparison before any paid model run', async t => {
  let runs = 0;
  const { studio } = await setup(t, async () => { runs++; });
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'compare', cultureBrief: { ...cultureBrief, audiences: [{ id: 'a1', label: 'Unmatched', references: ['Nothing Matches'] }] } });
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'failed'); assert.equal(runs, 0);
  assert.match(done.error, /taste pass failed before any model run/);
  assert.match(done.runs[1].error, /taste pass failed before any model run.*No brief reference resolved/);
  assert.match(done.runs[0].error, /Not started/);
});

test('taste-led Qloo runs require references; baseline-only runs never construct a Qloo client', async t => {
  const log = [];
  const { studio, created } = await setup(t, tasteAgent(log));
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief: { brand: cultureBrief.brand, audiences: [] } }), { status: 400, message: /needs audience or inspiration references/ });
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief: { ...cultureBrief, creativeContext: { domain: 'web', referencePolicy: 'skip', references: [], constraints: [] } } }), { status: 400, message: /skipped/ });
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief, tasteSourceJobId: '00000000-0000-4000-8000-000000000000' }), { status: 400 });
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', protocol: 'other' }), { status: 400 });
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief });
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error); assert.equal(created(), 0); assert.equal(done.tasteComparison, null);
  const research = await studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', protocol: 'research' });
  assert.equal(research.protocol, 'research'); assert.equal(research.runs[0].tastePipeline, undefined); assert.ok(research.runs[0].creativePipeline);
  await studio.manager.cancel(research.id);
});

test('a reused taste profile makes a manipulation check without new Qloo requests', async t => {
  const log = [];
  const { studio, calls, created } = await setup(t, tasteAgent(log));
  const first = await finished(studio, (await studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief })).id);
  assert.equal(first.status, 'completed', first.error);
  const before = calls.length;
  const second = await finished(studio, (await studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief, tasteSourceJobId: first.id })).id);
  assert.equal(second.status, 'completed', second.error);
  assert.equal(calls.length, before); assert.equal(created(), 1);
  assert.deepEqual(second.runs[0].taste.profile.reusedFrom, { jobId: first.id, mode: 'qloo' });
  assert.ok(second.runs[0].evidence.every(record => record.reusedFrom?.jobId === first.id));
  assert.deepEqual(second.taste.sourceJobId, first.id);
});

test('a taste-led plan scores four directions and its chosen direction builds from the frozen prediction', async t => {
  const log = [];
  const { studio, calls } = await setup(t, tasteAgent(log));
  const plan = await finished(studio, (await studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', kind: 'plan', cultureBrief })).id);
  assert.equal(plan.status, 'completed', plan.error);
  const run = plan.runs[0];
  assert.equal(log[0].probes.site.isError, true, 'Planning cannot write site files.');
  assert.deepEqual(run.directions.map(direction => direction.id), ['d0', 'd1', 'd2', 'd3']);
  assert.equal(run.taste.directionScores.basis, 'qloo-profile'); assert.equal(run.taste.directionScores.modelDefaultId, 'd0');
  assert.ok(['d1', 'd2', 'd3'].includes(run.taste.directionScores.recommendedId));
  assert.equal(run.previewUrl, null);
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'compare', cultureBrief, planJobId: plan.id, planMode: 'qloo', directionId: 'd2' }), { status: 400 });
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief, planJobId: plan.id, planMode: 'qloo', directionId: 'd2', protocol: 'research' }), { status: 400, message: /creative protocol of its plan/ });
  const passCalls = calls.length;
  const build = await finished(studio, (await studio.manager.create({ templateId: 'local-food', brief, mode: 'qloo', cultureBrief, planJobId: plan.id, planMode: 'qloo', directionId: 'd2' })).id);
  assert.equal(build.status, 'completed', build.error);
  assert.equal(calls.length, passCalls, 'The build reuses the plan’s taste pass.');
  const entry = log[1];
  assert.equal(entry.tasteFileBefore, true); assert.equal(entry.probes.pending.status, 'revealed'); assert.equal(entry.probes.refreeze.isError, true);
  assert.match(entry.prompt, /prediction was frozen in the planning run/);
  const chosen = run.directions.find(direction => direction.id === 'd2');
  assert.deepEqual(build.runs[0].taste.input.requiredAnchors, chosen.anchors.map(anchor => anchor.ref));
  assert.deepEqual(build.runs[0].taste.assumption, run.taste.assumption);
  assert.equal(build.runs[0].taste.profile.reusedFrom.jobId, plan.id);
  assert.ok(build.runs[0].tastePipeline.limitations.some(item => /inherited from the planning run/.test(item)));
});
