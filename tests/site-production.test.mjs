import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStudio } from '../src/server.mjs';
import { getConfig } from '../src/config.mjs';
import { prepareKiroWorkspace } from '../src/kiro-runner.mjs';
import { siteData } from '../src/design-artifacts.mjs';
import { getTemplate } from '../src/templates.mjs';
import { loadLibrary } from '../src/library.mjs';
import { loadFontLibrary } from '../src/fonts.mjs';
import { HOSTED_IMAGE_REASON, SITE_VIEWS, PREVIEW_CSP, serveSiteCapture, createSiteCapture, fixtureSiteCapture } from '../src/site-production.mjs';
import { getToolDefinitions, dispatchRpc } from '../plugin/server/mcp/server.mjs';
import { decodePng } from '../plugin/server/production/image-files.mjs';
import { inspectBrowser } from '../plugin/server/production/capture.mjs';

// Test-only fixtures, as in tests/taste.test.mjs. No real Qloo request, model call or image generation is made here.
const rootDir = path.resolve(import.meta.dirname, '..');
const CORE = {
  brand: ['Fixture Workwear Co', 'Fixture Ceramics', 'Fixture Bicycle Works', 'Fixture Tea House'],
  movie: ['Fixture Film Alpha', 'Blade Runner 2049', 'Fixture Night Drive', 'Fixture Harbor Story'],
  artist: ['Fixture Ambient Duo', 'Fixture Choir', 'Fixture Synth Collective', 'Fixture Folk Singer'],
  book: ['Fixture Rain Novel', 'Fixture City Atlas', 'Fixture Essay Collection', 'Fixture Garden Diary'],
  tv_show: ['Fixture Kitchen Series', 'Fixture Detective Show', 'Fixture Travel Diary', 'Fixture Night Market'],
};
const DEEP = { brand: ['Fixture Indie Press', 'Fixture Letterpress', 'Fixture Kiln', 'Fixture Map Maker'], movie: ['Fixture Short Film', 'Fixture Silent Feature', 'Fixture Animated Essay', 'Fixture Documentary'] };
const SEARCH = { 'Blade Runner': [{ entityId: 'E-BLADE', name: 'Blade Runner', type: 'urn:entity:movie' }], 'Brian Eno': [{ entityId: 'E-ENO', name: 'Brian Eno', type: 'urn:entity:artist' }] };
const TAGS = { 'Ambient Music': [{ entityId: 'urn:tag:genre:music:ambient', name: 'Ambient', type: 'urn:tag:genre:music' }] };
const TAG_RESULTS = { 'urn:tag:style:qloo': ['Fixture Hushed', 'Fixture Lantern Lit', 'Fixture Slow Pan', 'Fixture Drifting Light'],
  'urn:tag:aesthetic_property:qloo': ['Fixture Woven', 'Fixture Lacquered', 'Fixture Folded Paper', 'Fixture Brass Inlay'] };
const evidence = endpoint => ({ provider: 'Qloo', endpoint: `https://hackathon.api.qloo.com${endpoint}`, retrievedAt: '2026-10-06T00:00:00.000Z', resultCount: 0, interpretation: 'Test-only fixture.' });
function fakeQloo() {
  return {
    async searchEntities({ query }) { const results = SEARCH[query] || []; return { status: results.length ? 'ok' : 'empty', query: { text: query }, results, evidence: evidence('/search') }; },
    async searchTags({ query, tagTypes }) {
      const results = (TAGS[query] || []).filter(row => !tagTypes || tagTypes.includes(row.type));
      return { status: results.length ? 'ok' : 'empty', query: { text: query }, results, evidence: evidence('/v2/tags') };
    },
    async getInsights(input) {
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
  style: ['Fixture Hushed', 'Melancholic', 'Nostalgic'], aesthetic: ['Minimal', 'Warm wood', 'Handmade'], qualities: ['Nocturnal', 'Wistful', 'Atmosphere'],
};
const SKETCH = { summary: 'A bright market stall page with photo cards and a leaf-green accent.', palette: ['#ffffff', '#2c6e49', '#f4efe6'], fonts: ['Jost'], sections: ['top', 'gallery', 'hero'], motifs: ['market baskets'] };
const assumptionFor = domains => ({ schemaVersion: '1.0', audienceSummary: 'Test-only prediction of what this audience enjoys.',
  predictions: Object.fromEntries(domains.map(domain => [domain, PREDICTIONS[domain]])), designSketch: SKETCH });
const references = ['Blade Runner', 'Brian Eno', 'Ambient Music', 'Unknown Zine'].map(name => ({ name, role: 'audience' }));
const cultureBrief = { brand: { notes: 'Seasonal and local.', protectedFiles: ['app.js'], protectedSnippets: [] }, audiences: [{ id: 'a1', label: 'Night-market regulars', references: references.map(ref => ref.name) }] };
const brief = 'Redesign a local food shop for night-market regulars while keeping the catalogue working.';

const LAYERS = ['palette', 'typography', 'layout', 'structure', 'interaction', 'voice', 'imagery'];
const VOICE = { qloo: ['Late light, slow food', 'Pressed slowly for late suppers.'], baseline: ['Fresh from the market', 'Picked for the morning table.'] };
const STARTER_DATA = siteData(getTemplate('local-food').files['index.html']);
function dataIsland(mode) {
  const qloo = mode === 'qloo';
  const data = { ...STARTER_DATA, addLabel: qloo ? 'Set aside for supper' : 'Add to basket', items: STARTER_DATA.items.map((item, index) => ({ ...item, ...(!index ? { description: VOICE[mode][1] } : {}) })) };
  return `<script type="application/json" id="site-data">${JSON.stringify(data).replace(/</gu, '\\u003c')}</script>`;
}
function tagRef(input, domain) {
  const all = (input?.entities || []).filter(entity => entity.domain === domain), measured = all.filter(entity => entity.source === 'qloo');
  const pool = measured.length ? measured : all;
  return pool.find(entity => entity.surprise) || pool[0] || null;
}
function dnaFor(mode, refs, input) {
  const qloo = mode === 'qloo';
  const tagOf = ref => input?.entities?.find(entity => entity.ref === ref)?.tags?.[0] ?? 'Night markets';
  const devices = refs.map((ref, index) => {
    const layer = LAYERS[index % LAYERS.length];
    const tokens = { palette: { colors: qloo ? ['#1d1a17', '#c9a227'] : ['#ffffff', '#2c6e49'] }, typography: { fonts: [qloo ? 'Gelasio' : 'Jost'] },
      layout: { css: [{ property: 'grid-template-columns', value: qloo ? '2fr 1fr' : 'repeat(3, 1fr)' }] }, structure: { ids: [qloo ? 'ledger' : 'gallery'] },
      interaction: { ids: ['taste-toggle'] }, voice: { copy: VOICE[mode] }, imagery: { css: [{ property: 'aspect-ratio', value: '1 / 1' }] } }[layer];
    return { id: `dna${index + 1}`, layer, device: `Test-only ${layer} device ${index + 1}`, anchors: [ref], qualities: [qloo ? tagOf(ref) : 'Assumed calm'], translation: `Test-only interpretation of the anchor for ${layer}.`, tokens };
  });
  const style = tagRef(input, 'style'), aesthetic = tagRef(input, 'aesthetic');
  const quality = (entity, own) => entity.source === 'qloo' ? [entity.name] : [own];
  if (style) devices.push({ id: 'dna-motion', layer: 'motion', device: 'Test-only drifting lantern motion', anchors: [style.ref], qualities: quality(style, 'Assumed slow'),
    translation: 'Test-only: the style quality becomes a slow twelve-second drift.', tokens: { keyframes: ['fixture-drift'], css: [{ property: 'animation', value: 'fixture-drift 12s ease-in-out infinite' }] } });
  if (aesthetic) devices.push({ id: 'dna-art', layer: 'layout', device: 'Test-only lacquered line drawing', anchors: [aesthetic.ref], qualities: quality(aesthetic, 'Assumed handmade'),
    translation: 'Test-only: the aesthetic quality becomes an eight-shape line drawing.', tokens: { svg: ['fixture-art'] } });
  return { schemaVersion: '1.0', thesis: `A test-only ${mode} design thesis.`, devices };
}
const imageryDevice = ref => ({ id: 'dna7', layer: 'imagery', device: 'Lamp-lit night photographs', anchors: [ref], qualities: ['Assumed calm'],
  translation: 'Test-only: the calm quality becomes dark, lamp-lit product pictures.', tokens: { colors: ['#0b1d3a'], css: [{ property: 'object-fit', value: 'cover' }] } });
const ART = `<svg id="fixture-art" viewBox="0 0 120 80" aria-hidden="true">${[10, 30, 50, 70].map(x => `<circle cx="${x}" cy="20" r="6"/><rect x="${x}" y="50" width="8" height="8"/>`).join('')}</svg>`;
const MOTION_CSS = '@keyframes fixture-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}.drift{animation:fixture-drift 12s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.drift{animation:none}}';
function siteFor(mode) {
  const qloo = mode === 'qloo';
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture food shop</title><link rel="stylesheet" href="styles.css"></head><body><header id="top"><h1>Fixture food shop</h1></header><main><section id="${qloo ? 'ledger' : 'gallery'}" class="grid"><p>${VOICE[mode][0]}</p><button id="taste-toggle" type="button">Toggle</button></section><button type="button" data-motion-toggle aria-pressed="false">Pause motion</button><div class="drift">${ART}</div></main>${dataIsland(mode)}<script src="app.js"></script></body></html>`,
    css: (qloo ? "@font-face{font-family:'Gelasio';src:url('fonts/gelasio-latin-wght-normal.woff2') format('woff2')}:root{--ink:#1d1a17;--gold:#c9a227}body{font-family:Gelasio,serif;color:var(--ink)}.grid{display:grid;grid-template-columns:2fr 1fr}"
      : "@font-face{font-family:'Jost';src:url('fonts/jost-latin-wght-normal.woff2') format('woff2')}:root{--paper:#ffffff;--leaf:#2c6e49}body{font-family:Jost,\"Trebuchet MS\",sans-serif}.grid{display:grid;grid-template-columns:repeat(3, 1fr)}") + MOTION_CSS,
  };
}

// The production stages' own artifacts, as a designing model would save them.
const isQuality = entity => ['style', 'aesthetic', 'qualities', 'art_style'].includes(entity?.domain);
const anchorsOf = (revealed, dna) => [...new Set([...revealed.requiredAnchors.map(anchor => anchor.ref), ...dna.devices.flatMap(device => device.anchors)])];
/** A ref the reading sets aside: neither required nor anchored, and not a quality or, when it can be helped, a measured surprise. */
function asideRef(revealed, dna) {
  const kept = anchorsOf(revealed, dna), free = revealed.entities.filter(entity => !kept.includes(entity.ref) && !isQuality(entity));
  return (free.find(entity => !(entity.source === 'qloo' && entity.surprise)) || free[0]).ref;
}
/** Two clusters, each resting on a quality, that gather every required anchor and every ref the DNA anchors. */
function readingFor(revealed, dna, { aside = null } = {}) {
  const measured = revealed.entities.some(entity => entity.source === 'qloo');
  const pool = revealed.entities.filter(entity => isQuality(entity) && (!measured || entity.source === 'qloo')).map(entity => entity.ref);
  const refs = anchorsOf(revealed, dna);
  const [first, second] = [...refs.filter(ref => pool.includes(ref)), ...pool.filter(ref => !refs.includes(ref))];
  const rest = refs.filter(ref => ref !== first && ref !== second);
  const clusters = [
    { id: 'c1', name: 'Lamp-lit evenings', refs: [first, ...rest.filter((ref, index) => index % 2 === 0)], layers: ['palette', 'typography', 'imagery'], reading: 'Test-only: these refs share a slow, lamp-lit evening mood.' },
    { id: 'c2', name: 'Spoken softly', refs: [second, ...rest.filter((ref, index) => index % 2 === 1)], layers: ['voice', 'layout', 'motion'], reading: 'Test-only: these refs share a quiet, unhurried way of speaking.' },
  ];
  const surprises = revealed.entities.filter(entity => entity.source === 'qloo' && entity.surprise).map(entity => entity.ref);
  if (surprises.length && !clusters.some(cluster => cluster.refs.some(ref => surprises.includes(ref)))) clusters[0].refs.push(surprises.find(ref => ref !== aside));
  return { schemaVersion: '1.0', clusters, setAside: aside ? [{ ref: aside, reason: 'Test-only: a catalogue label outside what the audience shares.' }] : [],
    approach: 'Test-only: the first cluster sets the palette and the type, the second the copy, the layout and the motion of the site.' };
}
const METHODS = { palette: 'css-palette', typography: 'library-font', layout: 'css-layout', structure: 'css-layout', interaction: 'css-layout', voice: 'copy', imagery: 'css-art', motion: 'css-motion' };
function planFor(dna, reading, { methods = {}, images = {}, review = true } = {}) {
  const steps = dna.devices.map(device => {
    const method = methods[device.id] || (device.tokens.svg?.length ? 'inline-svg' : METHODS[device.layer]);
    return { device: device.id, method, cluster: reading.clusters.find(cluster => device.anchors.some(ref => cluster.refs.includes(ref))).id,
      why: `Test-only: ${method} suits this ${device.layer} device.`, ...(images[device.id] ? { count: images[device.id], fallback: 'css-art' } : {}) };
  });
  return { schemaVersion: '1.0', steps, ...(review ? { review: [
    { id: 'r1', device: dna.devices[0].id, look: 'Test-only: the palette fills the first screen at desktop width.', view: 'desktop' },
    { id: 'r2', device: dna.devices[1].id, look: 'Test-only: the headline type reads on one line at phone width.', view: 'mobile' }] } : {}) };
}
const reviewFor = (round, criteria) => ({ schemaVersion: '1.0', round, summary: `Test-only review of round ${round}.`,
  criteria: criteria.map(([id, capture, verdict]) => ({ id, capture, verdict, observed: `Test-only: what ${capture} shows for ${id}.`, ...(verdict === 'met' ? {} : { repair: `Test-only: the repair ${id} needs.` }) })) });
/** A Kiro session record in which the built-in read tool opened `files`, shaped like the records the host audits. */
async function openedInSession(directory, files) {
  const folder = path.join(directory, 'kiro-home', 'sessions', 'cli');
  await fs.mkdir(folder, { recursive: true });
  const results = Object.fromEntries(files.map((file, index) => [`tooluse_${index}`, { tool: { kind: { BuiltIn: { fs_read: { operations: [{ mode: 'Image', image_paths: [file] }] } } } }, result: { Success: { items: [] } } }]));
  const lines = [{ kind: 'Prompt', data: { text: 'test-only' } }, { kind: 'ToolResults', data: { results } }].map(line => JSON.stringify(line));
  await fs.writeFile(path.join(folder, '6f1c2a3b-0000-4000-8000-00000000c0de.jsonl'), `${lines.join('\n')}\n`);
}
/** A test-only image generator: it copies a library JPEG instead of calling Codex, and fails on request. */
function fakeImages(log) {
  return { available: true, provider: 'codex', version: '0.160.0-test',
    async generate({ prompt, directory, name }) {
      log.push({ prompt, name });
      if (prompt.includes('FAIL')) throw new Error('Test-only generation failure.');
      const bytes = await fs.readFile(path.join(rootDir, 'library', 'local-food', 'olive-oil-1.jpg'));
      await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, `${name}.jpg`), bytes);
      return { path: `generated/${name}.jpg`, format: 'jpeg', width: 640, height: 427, bytes: bytes.length, durationMs: 1200, description: 'Test-only: a bottle of oil on a table.' };
    } };
}

const readyKiro = async () => ({ available: true, authenticated: true, version: 'test-only', defaultModel: 'fixed-test-model' });
async function setup(t, runner, { env = {}, imageGenerator, siteCapture } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-site-production-'));
  const config = { ...getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, ...env }), qlooKey: 'test-fixture-only-key' };
  const studio = await createStudio({ config, inspect: readyKiro, runner, qlooClientFactory: () => fakeQloo(), imageGenerator, siteCapture });
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { studio, directory };
}
async function finished(studio, id) {
  for (let i = 0; i < 2000; i++) {
    const job = studio.manager.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return studio.manager.publicJob(job);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Test job did not finish.');
}
const bridge = ({ bridgeUrl, bridgeToken }) => async (name, args = {}) => (await fetch(bridgeUrl + '/internal/tools', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken }, body: JSON.stringify({ name, arguments: args }) })).json();
const write = (call, file, content) => call('project_write_file', { path: file, content: typeof content === 'string' ? content : JSON.stringify(content) });
const said = result => result?.content?.[0]?.text || '';
const literal = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const stripSource = prompt => prompt.replace(/TASTE SOURCE FOR THIS RUN:[^\n]*\n/u, '');

/** A test-only designer that follows the production stages through the real bridge and probes every gate on the way. */
function productionAgent(log, live) {
  return async context => {
    const { mode, project, directory } = context;
    const call = bridge(context);
    const entry = { mode, prompt: context.prompt, production: context.production, review: context.review, images: context.images, probes: {} };
    log.push(entry);
    entry.capabilities = JSON.parse(await project.readFile('culture-capabilities.json'));
    entry.probes.hostFile = await write(call, 'culture-capabilities.json', '{}');
    entry.probes.readingEarly = await write(call, 'culture-reading.json', { schemaVersion: '1.0' });
    await write(call, 'culture-assumption.json', assumptionFor((await call('project_get_taste')).structuredContent.domains));
    const revealed = entry.revealed = (await call('project_get_taste')).structuredContent;
    const required = revealed.requiredAnchors.map(anchor => anchor.ref);
    const dna = dnaFor(mode, required, revealed);
    entry.probes.dnaEarly = await write(call, 'culture-dna.json', dna);
    const aside = entry.aside = asideRef(revealed, dna);
    const reading = readingFor(revealed, dna, { aside });
    // A reading that leaves a required anchor out is refused.
    const dropped = entry.dropped = required.find(ref => !reading.clusters.some(cluster => cluster.refs[0] === ref));
    entry.probes.uncovered = await write(call, 'culture-reading.json', { ...reading, clusters: reading.clusters.map(cluster => ({ ...cluster, refs: cluster.refs.filter(ref => ref !== dropped) })) });
    entry.probes.reading = await write(call, 'culture-reading.json', reading);
    entry.probes.asideAnchor = await write(call, 'culture-dna.json', { ...dna, devices: dna.devices.map((device, index) => index === 2 ? { ...device, anchors: [aside] } : device) });
    entry.probes.dna = await write(call, 'culture-dna.json', dna);
    entry.probes.readingLate = await write(call, 'culture-reading.json', reading);
    const site = siteFor(mode);
    entry.probes.siteEarly = await write(call, 'index.html', site.html);
    // The two arms make one layer differently, as the comparison should report.
    const plan = planFor(dna, reading, { methods: mode === 'qloo' ? { dna5: 'interaction-script' } : {} });
    entry.probes.unavailable = await write(call, 'culture-production.json', { ...plan, steps: plan.steps.map((step, index) => index ? step : { ...step, method: 'generated-image', count: 1, fallback: 'css-art' }) });
    entry.probes.unplanned = await write(call, 'culture-production.json', { ...plan, steps: plan.steps.slice(0, -1) });
    entry.probes.plan = await write(call, 'culture-production.json', plan);
    entry.probes.captureEarly = await call('project_capture_review', {});
    await write(call, 'index.html', site.html); await write(call, 'styles.css', site.css);
    entry.probes.captureUnchecked = await call('project_capture_review', {});
    entry.probes.reviewEarly = await write(call, 'culture-review.json', reviewFor(1, [['r1', 'r1-desktop', 'met'], ['r2', 'r1-mobile', 'met']]));
    entry.probes.check = (await call('project_check_dna')).structuredContent;
    entry.probes.badTarget = await call('project_capture_review', { target: 'nowhere' });
    entry.probes.badView = await call('project_capture_review', { views: ['tablet'] });
    entry.probes.capture1 = (await call('project_capture_review', {})).structuredContent;
    entry.probes.repeat = await call('project_capture_review', { views: ['mobile'] });
    entry.probes.targeted = (await call('project_capture_review', { views: ['mobile'], target: 'top' })).structuredContent;
    entry.probes.overLimit = await call('project_capture_review', { full: true });
    // The captures are on the preview origin while the run is still working.
    entry.live = await live(context);
    const first = reviewFor(1, [['r1', 'r1-desktop', 'met'], ['r2', 'r1-mobile-top', 'partly']]);
    if (mode === 'qloo') {
      // This arm has a Kiro session record: a capture the review cites must be one its read tool opened.
      await openedInSession(directory, ['review/r1-desktop.png']);
      entry.probes.unopened = await write(call, 'culture-review.json', first);
      await openedInSession(directory, [path.join(directory, 'review', 'r1-desktop.png'), 'review\\r1-mobile-top.png']);
    }
    entry.probes.review1 = await write(call, 'culture-review.json', first);
    await write(call, 'index.html', site.html.replace('<h1>Fixture food shop</h1>', '<h1>Fixture food shop</h1><p>Test-only repair: a shorter headline line.</p>'));
    entry.probes.captureStale = await call('project_capture_review', {});
    entry.probes.reviewBeforeCapture = await write(call, 'culture-review.json', reviewFor(2, [['r1', 'r1-desktop', 'met'], ['r2', 'r1-mobile', 'met']]));
    await call('project_check_dna');
    entry.probes.capture2 = (await call('project_capture_review', {})).structuredContent;
    entry.probes.oldCapture = await write(call, 'culture-review.json', reviewFor(2, [['r1', 'r1-desktop', 'met'], ['r2', 'r2-mobile', 'met']]));
    if (mode === 'qloo') await openedInSession(directory, ['review/r1-desktop.png', 'review/r1-mobile-top.png', 'review/r2-desktop.png', 'review/r2-mobile.png']);
    entry.probes.review2 = await write(call, 'culture-review.json', reviewFor(2, [['r1', 'r2-desktop', 'met'], ['r2', 'r2-mobile', 'met']]));
    entry.probes.captureDone = await call('project_capture_review', {});
    entry.probes.reviewDone = await write(call, 'culture-review.json', reviewFor(2, [['r1', 'r2-desktop', 'met'], ['r2', 'r2-mobile', 'met']]));
  };
}

test('a taste-led build reads the taste input, plans how each device is made and reviews captures of its site, in both arms alike', async t => {
  const log = [], captured = [];
  let studio;
  const live = async context => {
    const run = studio.manager.publicJob(context.job).runs.find(item => item.mode === context.mode);
    const response = await fetch(run.production.captures[0].url);
    return { status: run.status, url: run.production.captures[0].url, fetched: response.status };
  };
  ({ studio } = await setup(t, productionAgent(log, live), { siteCapture: fixtureSiteCapture({ onCapture: request => captured.push(request) }) }));
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'compare', cultureBrief });
  const capabilities = job.production.capabilities;
  assert.deepEqual([capabilities.medium, capabilities.environment, capabilities.required], ['web', 'local', []]);
  assert.deepEqual(capabilities.generators.image, { available: false, reason: 'This Studio was started without image generation.' });
  assert.deepEqual(capabilities.review.capture, { available: true, views: [{ id: 'desktop', width: 1440, height: 900 }, { id: 'mobile', width: 390, height: 844 }], rounds: 2, perRound: 4 });
  assert.deepEqual(capabilities.methods.filter(item => !item.available).map(item => item.id), ['generated-image']);
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error);
  assert.deepEqual(done.production.capture, { available: true, views: capabilities.review.capture.views, rounds: 2 });

  const [baseline, qloo] = ['baseline', 'qloo'].map(mode => log.find(entry => entry.mode === mode));
  for (const entry of [baseline, qloo]) {
    const { mode, probes } = entry;
    // Both arms read the same capability list, the same stages and the same prompt but for its taste source.
    assert.deepEqual(entry.capabilities, capabilities, mode);
    assert.deepEqual([entry.production, entry.review, entry.images], [true, true, false], mode);
    assert.match(entry.prompt, /4\. Save culture-reading\.json before the DNA/u, mode);
    assert.match(entry.prompt, /6\. Save culture-production\.json before any picture or site file/u, mode);
    assert.match(entry.prompt, /Not available here: generated-image \(This Studio was started without image generation\)\./u, mode);
    assert.match(entry.prompt, /9\. Review what you made: after the check, call project_capture_review/u, mode);
    assert.equal(said(probes.hostFile), 'culture-capabilities.json is written by the host.');
    assert.equal(said(probes.readingEarly), 'Save culture-assumption.json and read project_get_taste before saving your reading of the taste input.');
    assert.equal(said(probes.dnaEarly), 'Save culture-reading.json first: the DNA anchors to the refs your reading of the taste input keeps.');
    assert.match(said(probes.uncovered), new RegExp(`Every required anchor belongs to a cluster or is set aside with a reason\\. Missing: .*\\(${literal(entry.dropped)}\\)`, 'u'), mode);
    assert.deepEqual([probes.reading.structuredContent.status, probes.reading.structuredContent.clusters, probes.reading.structuredContent.setAside], ['written', 2, 1], mode);
    assert.match(probes.reading.structuredContent.next, /^Compile culture-dna\.json from the refs your reading kept/u);
    assert.match(said(probes.asideAnchor), new RegExp(`Your taste reading set ${literal(entry.aside)} aside \\(Test-only: a catalogue label`, 'u'), mode);
    assert.equal(probes.dna.structuredContent.status, 'written', said(probes.dna));
    assert.match(probes.dna.structuredContent.next, /^Save culture-production\.json: one step per device/u);
    assert.equal(said(probes.readingLate), 'culture-reading.json is frozen: the Design DNA was compiled from it.');
    assert.equal(said(probes.siteEarly), 'Save culture-production.json before writing site files: plan how each device is made before you build it.');
    assert.match(said(probes.unavailable), /generated-image is not available here: This Studio was started without image generation\. Methods for palette here: css-palette\./u);
    assert.match(said(probes.unplanned), /Plan every device of the DNA once\. No step for: dna-art\./u);
    assert.equal(probes.plan.structuredContent.status, 'written', said(probes.plan));
    assert.deepEqual([probes.plan.structuredContent.criteria, probes.plan.structuredContent.next], [2, 'Build the site to the DNA, each device by the method its step names.']);
    assert.equal(said(probes.captureEarly), 'Write the site files and check them with project_check_dna before capturing the site.');
    assert.match(said(probes.captureUnchecked), /^Check the saved site with project_check_dna first/u);
    assert.equal(said(probes.reviewEarly), 'Capture the site with project_capture_review before saving the review of round 1.');
    assert.equal(probes.check.review, 'Once your repairs are done, capture round 1 of 2 with project_capture_review and judge your plan\'s criteria in culture-review.json.');
    assert.match(said(probes.badTarget), /^target: index\.html has no element with the ID nowhere\. Its IDs include top/u);
    assert.equal(said(probes.badView), 'views: name one or more of desktop, mobile.');
    assert.deepEqual(probes.capture1.captures, [
      { id: 'r1-desktop', view: 'desktop', path: 'review/r1-desktop.png', width: 1440, height: 900, shows: 'the first screen of the page as a desktop visitor sees it' },
      { id: 'r1-mobile', view: 'mobile', path: 'review/r1-mobile.png', width: 390, height: 844, shows: 'the first screen of the page as a phone visitor sees it' }]);
    assert.match(probes.capture1.next, /^Open each capture you cite with your read tool \(the paths are relative to your working folder, such as review\/r1-desktop\.png\)/u);
    assert.match(said(probes.repeat), /^Round 1 already has r1-mobile\./u);
    assert.deepEqual(probes.targeted.captures, [{ id: 'r1-mobile-top', view: 'mobile', path: 'review/r1-mobile-top.png', width: 390, height: 844, target: 'top', shows: 'the page scrolled to #top at 390x844' }]);
    assert.equal(said(probes.overLimit), 'Round 1 allows 4 captures, and 3 were taken.');
    assert.deepEqual([entry.live.status, entry.live.fetched], ['running', 200], 'A capture is served while its run works.');
    assert.match(entry.live.url, new RegExp(`/preview/${job.id}/${mode}/[a-f0-9]{48}/__review/r1-desktop\\.png$`, 'u'));
    assert.deepEqual([probes.review1.structuredContent.met, probes.review1.structuredContent.partly], [1, 1], said(probes.review1));
    assert.equal(probes.review1.structuredContent.next, 'Make the repairs you named in the site files, check them with project_check_dna, then capture round 2 with project_capture_review and review it.');
    assert.match(said(probes.captureStale), /^Check the saved site with project_check_dna first/u, 'A repair is checked before it is captured.');
    assert.equal(said(probes.reviewBeforeCapture), 'Capture the site with project_capture_review before saving the review of round 2.');
    assert.deepEqual(probes.capture2.captures.map(item => item.id), ['r2-desktop', 'r2-mobile']);
    assert.match(said(probes.oldCapture), /r1-desktop was taken in round 1, before your repairs\./u);
    assert.equal(probes.review2.structuredContent.next, 'Every criterion is met. Finish, keeping the DNA and the plan as they are.', said(probes.review2));
    assert.equal(said(probes.captureDone), 'The review allows 2 rounds, and all of them were reviewed.');
    assert.equal(said(probes.reviewDone), 'The review is complete: all 2 rounds were reviewed.');
  }
  assert.equal(stripSource(baseline.prompt), stripSource(qloo.prompt));
  assert.match(said(qloo.probes.unopened), /r1-mobile-top was not opened in this session\. Open review\/r1-mobile-top\.png with your image-reading tool/u);

  // The capture saw what the preview serves: the run's own folder, library photos, fonts and recorded pictures.
  assert.deepEqual(captured.map(request => [request.round, request.views.map(view => view.id).join('+'), request.target || null]).sort(),
    [[1, 'desktop+mobile', null], [1, 'desktop+mobile', null], [1, 'mobile', 'top'], [1, 'mobile', 'top'], [2, 'desktop+mobile', null], [2, 'desktop+mobile', null]]);
  for (const request of captured) {
    assert.ok(request.library && request.fonts && Array.isArray(request.images));
    assert.match(request.outDir, new RegExp(`${job.id}[\\\\/](?:baseline|qloo)[\\\\/]review$`, 'u'));
  }

  const runs = Object.fromEntries(done.runs.map(run => [run.mode, run]));
  for (const run of done.runs) {
    const made = run.production;
    assert.deepEqual([made.reading.clusters.length, made.reading.setAside.length, made.plan.steps.length, made.reviews.length, made.round], [2, 1, 8, 2, 3], run.mode);
    assert.deepEqual(made.captures.map(item => item.id), ['r1-desktop', 'r1-mobile', 'r1-mobile-top', 'r2-desktop', 'r2-mobile']);
    assert.ok(made.captures.every(item => item.url.endsWith(`/__review/${item.id}.png`)));
    // The first review's repairs changed the site before round 2; nothing changed after the last review.
    assert.deepEqual(made.reviews[0].repairs, { site: true });
    assert.equal(made.reviews[1].repairs, undefined);
    assert.deepEqual(made.audit.afterLastReview, { site: false });
    assert.ok(run.events.some(event => /^Taste reading saved: 2 clusters over \d+ refs \(Lamp-lit evenings; Spoken softly\); 1 set aside\.$/u.test(event.message)), run.mode);
    assert.ok(run.events.some(event => /^Production plan saved: 8 steps with .+; no generator; 2 review criteria\.$/u.test(event.message)), run.mode);
    assert.ok(run.events.some(event => event.message === 'Capturing round 2: r2-desktop and r2-mobile.'), run.mode);
    const record = JSON.parse(await studio.manager.project(job, run.mode).readFile('culture-taste.json')).production;
    assert.deepEqual([record.medium, record.required, record.reviews.length, record.captures.length], ['web', [], 2, 5]);
    assert.deepEqual(record.captures[2], { id: 'r1-mobile-top', view: 'mobile', round: 1, path: 'review/r1-mobile-top.png', width: 390, height: 844, target: 'top' });
    assert.deepEqual(record.audit, made.audit);
  }
  // The arm with a session record is audited: every capture its reviews cite was opened. The other is recorded as unaudited.
  const cited = ['r1-desktop', 'r1-mobile-top', 'r2-desktop', 'r2-mobile'];
  assert.deepEqual(runs.qloo.production.audit, { rounds: 2, captures: 5, cited, audited: true, opened: cited, unopened: [], afterLastReview: { site: false } });
  assert.deepEqual(runs.baseline.production.audit, { rounds: 2, captures: 5, cited, audited: false, afterLastReview: { site: false } });
  assert.deepEqual(runs.qloo.production.reviews[0].opened, ['r1-desktop', 'r1-mobile-top']); assert.equal(runs.baseline.production.reviews[0].opened, null);
  assert.ok(runs.qloo.events.some(event => event.message === 'Review of round 1: 1 met, 1 partly, 0 missed; every capture it cites was opened in the session.'));
  assert.ok(runs.baseline.events.some(event => event.message === 'Review of round 1: 1 met, 1 partly, 0 missed; the session record could not be audited.'));
  assert.ok(runs.qloo.events.some(event => event.message === 'Review audit: the session opened 4 of the 4 captures its reviews cite.'));
  assert.ok(runs.baseline.events.some(event => event.message === 'Review audit: no Kiro session record to audit, so the reviews are recorded as unaudited.'));
  // The comparison reports how the two plans made the site.
  assert.deepEqual(done.tasteComparison.production.differingLayers, ['interaction']);
  assert.equal(done.tasteComparison.productionHeadline, 'The plans make 1 layer differently: interaction by css-layout in Qloo off and interaction-script in Qloo on.');
  assert.equal(done.tasteComparison.production.qloo.review.met, 2);

  // The preview serves the captures a run recorded, as PNGs under the preview's policy, and nothing else from its folder.
  const shot = runs.qloo.production.captures[2];
  const response = await fetch(shot.url);
  assert.equal(response.status, 200);
  assert.deepEqual([response.headers.get('content-type'), response.headers.get('content-security-policy')], ['image/png', PREVIEW_CSP]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await fs.readFile(path.join(studio.manager.config.dataDir, job.id, 'qloo', 'review', 'r1-mobile-top.png')));
  assert.equal((await fetch(shot.url.replace('r1-mobile-top', 'r3-mobile'))).status, 404);
  assert.equal((await fetch(shot.url.replace('r1-mobile-top', 'r1-mobile-full'))).status, 404);
  assert.equal((await fetch(shot.url.replace(/[a-f0-9]{48}/u, 'f'.repeat(48)))).status, 403);
});

test('a plan that generates pictures gets them only for its generated-image step, up to its count, and names its fallback when one fails', async t => {
  const log = [], generated = [];
  const subject = 'Olive oil bottles on a dark marble counter at night';
  const agent = async context => {
    const call = bridge(context);
    const entry = { prompt: context.prompt, production: context.production, review: context.review, images: context.images, probes: {} };
    log.push(entry);
    await write(call, 'culture-assumption.json', assumptionFor((await call('project_get_taste')).structuredContent.domains));
    const revealed = (await call('project_get_taste')).structuredContent;
    const required = revealed.requiredAnchors.map(anchor => anchor.ref);
    const plain = dnaFor('baseline', required, revealed);
    const dna = { ...plain, devices: [...plain.devices, imageryDevice(required[0])] };
    const reading = readingFor(revealed, dna);
    await write(call, 'culture-reading.json', reading);
    entry.probes.noImagery = await write(call, 'culture-dna.json', plain);
    assert.equal((await write(call, 'culture-dna.json', dna)).structuredContent.status, 'written');
    entry.probes.imageEarly = await call('project_generate_image', { device: 'dna7', subject });
    entry.probes.notRequired = await write(call, 'culture-production.json', planFor(dna, reading, { review: false }));
    const plan = planFor(dna, reading, { methods: { dna7: 'generated-image' }, images: { dna7: 2 }, review: false });
    entry.probes.noFallback = await write(call, 'culture-production.json', { ...plan, steps: plan.steps.map(({ fallback, ...step }) => (step.device === 'dna7' ? step : { ...step, ...(fallback ? { fallback } : {}) })) });
    entry.probes.plan = await write(call, 'culture-production.json', plan);
    const site = siteFor('baseline');
    entry.probes.siteEarly = await write(call, 'index.html', site.html);
    entry.probes.otherDevice = await call('project_generate_image', { device: 'dna1', subject });
    entry.probes.failed = await call('project_generate_image', { device: 'dna7', subject: 'FAIL: a test-only picture that cannot be made' });
    entry.probes.image = await call('project_generate_image', { device: 'dna7', subject });
    entry.probes.overCount = await call('project_generate_image', { device: 'dna7', subject });
    entry.probes.planLate = await write(call, 'culture-production.json', plan);
    await write(call, 'index.html', site.html.replace('</main>', '<figure id="night"><img src="generated/dna7-2.jpg" alt="Olive oil bottles at night" width="640" height="427"></figure></main>'));
    await write(call, 'styles.css', `${site.css}#night img{object-fit:cover;background:#0b1d3a}`);
    entry.probes.check = (await call('project_check_dna')).structuredContent;
    entry.probes.capture = await call('project_capture_review', {});
    entry.probes.review = await write(call, 'culture-review.json', reviewFor(1, [['r1', 'r1-desktop', 'met']]));
  };
  const { studio } = await setup(t, agent, { imageGenerator: fakeImages(generated) });
  for (const required of [['css-palette'], 'generated-image', ['generated-image', 'library-photo', 'library-font', 'generated-image']]) {
    await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief, required }), { status: 400, message: 'A study can require generated-image, library-photo, library-font of both designers.' }, JSON.stringify(required));
  }
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief, required: ['generated-image'] });
  assert.deepEqual([job.production.required, job.production.capabilities.required], [['generated-image'], ['generated-image']]);
  assert.deepEqual(job.production.capabilities.generators.image, { available: true, perRun: 8, provider: 'codex' });
  assert.deepEqual(job.production.capabilities.review.capture, { available: false, reason: 'This Studio was started without a browser to capture the site.' });
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error);
  const [{ prompt, probes, ...context }] = log;
  assert.deepEqual([context.production, context.review, context.images], [true, false, true]);
  assert.match(prompt, /- Generated images: this study requires generated pictures in both arms/u);
  assert.match(prompt, /This study requires generated-image in both arms\. A generated-image step also states count, the pictures it needs, at most 8 in this run/u);
  assert.match(prompt, /7\. Pictures, if your plan chose generated-image for an imagery device/u);
  assert.doesNotMatch(prompt, /project_capture_review|Not available here/u);
  assert.match(said(probes.noImagery), /This study requires generated images in both arms, so include at least one imagery device/u);
  assert.equal(said(probes.imageEarly), 'Save culture-production.json first: a picture is requested only for a device whose step chose generated-image.');
  assert.match(said(probes.notRequired), /This study requires generated-image in both arms: use it for a device it can make \(imagery\)\./u);
  assert.match(said(probes.noFallback), /Name a fallback that needs no generator, for when it cannot run: library-photo, inline-svg, css-art\./u);
  assert.equal(probes.plan.structuredContent.next, 'Request the planned pictures for dna7 with project_generate_image, then build the site around them.', said(probes.plan));
  assert.equal(said(probes.siteEarly), 'Your production plan generates pictures for dna7: request them with project_generate_image before writing site files, then build the site around the pictures it returns.');
  assert.equal(said(probes.otherDevice), 'The production plan gives dna1 no image generation; it plans image pictures for dna7. Generate only as the plan states, or save the plan again first.');
  assert.equal(said(probes.failed), 'The image could not be generated: Test-only generation failure. Make dna7 with the fallback your plan names, css-art, unless the step\'s count allows another request.');
  assert.equal(probes.image.structuredContent.path, 'generated/dna7-2.jpg', said(probes.image));
  assert.equal(said(probes.overCount), 'The production plan gives dna7 2 image pictures, and 2 were requested. Make the rest with the step\'s fallback method.');
  assert.equal(said(probes.planLate), 'culture-production.json is frozen once the first site file is written or the first picture is requested.');
  assert.equal(probes.check.score, 1); assert.equal(probes.check.review, undefined);
  assert.equal(said(probes.capture), 'Capture is not available in this run.');
  assert.equal(said(probes.review), 'This run captures nothing to review.');
  assert.deepEqual(generated.map(item => item.name), ['dna7-1', 'dna7-2'], 'Only the planned device was generated, twice as its step allows.');
  const [run] = done.runs;
  assert.deepEqual(run.production.plan.uses.generators, { image: { total: 2, devices: { dna7: 2 } } });
  assert.deepEqual(run.generatedImages.map(image => [image.path, image.used]), [['generated/dna7-2.jpg', true]]);
  assert.ok(run.events.some(event => event.message.startsWith('Refused an image request the production plan does not make. The production plan gives dna1 no image generation')));
  assert.deepEqual(run.production.audit, { rounds: 0, captures: 0, cited: [], audited: false });
  assert.deepEqual(run.tastePipeline.limitations, [], 'A run without capture owes no review.');
});

test('a hosted Studio offers no image generator, so no study can require pictures and plans make imagery without one', async t => {
  const log = [], generated = [];
  const agent = async context => {
    const call = bridge(context);
    const entry = { prompt: context.prompt, images: context.images, probes: {} };
    log.push(entry);
    await write(call, 'culture-assumption.json', assumptionFor((await call('project_get_taste')).structuredContent.domains));
    const revealed = (await call('project_get_taste')).structuredContent;
    const required = revealed.requiredAnchors.map(anchor => anchor.ref);
    const plain = dnaFor('baseline', required, revealed);
    const dna = { ...plain, devices: [...plain.devices, imageryDevice(required[0])] };
    const reading = readingFor(revealed, dna);
    await write(call, 'culture-reading.json', reading);
    await write(call, 'culture-dna.json', dna);
    entry.probes.generated = await write(call, 'culture-production.json', planFor(dna, reading, { methods: { dna7: 'generated-image' }, images: { dna7: 1 } }));
    entry.probes.plan = await write(call, 'culture-production.json', planFor(dna, reading));
    entry.probes.image = await call('project_generate_image', { device: 'dna7', subject: 'Olive oil bottles on a dark marble counter at night' });
    const site = siteFor('baseline');
    await write(call, 'index.html', site.html); await write(call, 'styles.css', `${site.css}.frame{object-fit:cover;background:#0b1d3a}`);
    await call('project_check_dna');
    entry.probes.capture = (await call('project_capture_review', {})).structuredContent;
    // The run ends without reviewing its captures.
  };
  const { studio } = await setup(t, agent, { env: { MOUSA_ENVIRONMENT: 'hosted' }, imageGenerator: fakeImages(generated), siteCapture: fixtureSiteCapture() });
  const status = await (await fetch(`${studio.appUrl}/api/status`)).json();
  assert.deepEqual(status.images, { available: false, provider: null, reason: HOSTED_IMAGE_REASON });
  assert.deepEqual([status.production, status.capture], [{ stages: true, environment: 'hosted' }, { available: true, label: 'Fixture capture' }]);
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief, required: ['generated-image'] }),
    { status: 400, message: `A study cannot require generated-image here: ${HOSTED_IMAGE_REASON}` });
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief });
  assert.equal(job.images, null);
  assert.deepEqual([job.production.capabilities.environment, job.production.capabilities.generators.image], ['hosted', { available: false, reason: HOSTED_IMAGE_REASON }]);
  const done = await finished(studio, job.id);
  assert.equal(done.status, 'completed', done.error);
  const [{ prompt, images, probes }] = log;
  assert.equal(images, false);
  assert.match(prompt, /Not available here: generated-image \(A hosted server has no image generator: Codex runs only on a machine where it is installed and signed in\)\./u);
  assert.doesNotMatch(prompt, /project_generate_image/u);
  assert.match(said(probes.generated), /generated-image is not available here: A hosted server has no image generator/u);
  assert.equal(probes.plan.structuredContent.status, 'written', said(probes.plan));
  assert.equal(said(probes.image), 'Image generation is not available in this run.');
  assert.deepEqual(probes.capture.captures.map(item => item.id), ['r1-desktop', 'r1-mobile']);
  assert.deepEqual(generated, [], 'Nothing was generated on the hosted server.');
  const [run] = done.runs;
  assert.deepEqual(run.tastePipeline.limitations, ['The site was captured, but no review of the captures was saved.']);
  assert.ok(run.events.some(event => event.type === 'warning' && event.message === 'The site was captured, but no review of the captures was saved.'));
  assert.deepEqual(run.production.audit, { rounds: 0, captures: 2, cited: [], audited: false });
});

test('without production stages a build runs the taste-led protocol alone and refuses a study setting', async t => {
  const { studio } = await setup(t, async () => {}, { env: { PRODUCTION_STAGES: 'off' } });
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief, required: ['generated-image'] }),
    { status: 400, message: 'A study setting applies to a taste-led site build with production stages.' });
  const job = await studio.manager.create({ templateId: 'local-food', brief, mode: 'baseline', cultureBrief });
  assert.deepEqual([job.production, job.runs[0].production], [undefined, undefined]);
  const done = await finished(studio, job.id);
  assert.deepEqual([done.production, done.runs[0].production], [null, null]);
  assert.equal(await studio.manager.project(job, 'baseline').readFile('culture-capabilities.json').then(() => true, () => false), false);
  const status = await (await fetch(`${studio.appUrl}/api/status`)).json();
  assert.deepEqual([status.production, status.capture], [{ stages: false, environment: 'local' }, { available: false, reason: 'This Studio was started without a browser to capture the site.' }]);
});

test('the production stages reach Kiro as policy, a capture tool and a read tool limited to the review captures', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-production-kiro-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = getConfig({});
  const glob = value => value.replaceAll('\\', '/');
  const prepare = async (mode, options) => {
    const dir = path.join(directory, `job-${Object.keys(options).join('-') || 'plain'}`, mode);
    const home = await prepareKiroWorkspace({ directory: dir, config, model: 'fixed-test-model', bridgeUrl: 'http://127.0.0.1:8787', bridgeToken: 'test-only', mode, protocol: 'taste', ...options });
    return { dir, agent: JSON.parse(await fs.readFile(path.join(home, 'agents', 'culture-demo.json'), 'utf8')) };
  };
  const { dir, agent } = await prepare('qloo', { production: true, review: true });
  assert.deepEqual([agent.tools, agent.allowedTools], [['@culture', 'read'], ['@culture']], 'The read tool is offered but never pre-approved.');
  const read = agent.toolsSettings.read;
  assert.deepEqual(read.allowedPaths, ['./review/**']);
  for (const folder of ['site', 'assets', 'kiro-home', '.kiro']) assert.ok(read.deniedPaths.includes(`${glob(path.join(dir, folder))}/**`), folder);
  assert.ok(read.deniedPaths.includes(`${glob(path.join(dir, '..', 'baseline'))}/**`), 'The other arm stays closed.');
  assert.ok(read.deniedPaths.includes(glob(path.join(dir, '..', 'meta.json'))), 'The job record stays closed.');
  assert.ok(read.deniedPaths.includes(glob(path.join(config.rootDir, '.env'))));
  for (const folder of ['.codex', '.aws', '.ssh']) assert.ok(read.deniedPaths.includes(`${glob(path.join(os.homedir(), folder))}/**`), folder);
  const env = agent.mcpServers.culture.env;
  assert.deepEqual([env.CULTURE_PROTOCOL, env.CULTURE_PRODUCTION, env.CULTURE_CAPTURE_TOOL, agent.mcpServers.culture.timeout], ['taste', 'true', 'true', 180000]);
  assert.match(agent.prompt, /^Use only the available project tools, and the read tool only to open the review captures in review\/\./u);
  assert.match(agent.prompt, /# Production policy/u);
  assert.ok((await fs.stat(path.join(dir, 'review'))).isDirectory());
  assert.ok((await prepare('baseline', { production: true, review: true })).agent.toolsSettings.read.deniedPaths.includes(`${glob(dir)}/**`), 'The Qloo on arm stays closed to Qloo off.');
  // Production stages without capture add their policy only; image generation keeps its longer wait.
  const staged = (await prepare('qloo', { production: true, images: true })).agent;
  assert.deepEqual([staged.tools, staged.toolsSettings, staged.mcpServers.culture.env.CULTURE_PRODUCTION, staged.mcpServers.culture.env.CULTURE_CAPTURE_TOOL, staged.mcpServers.culture.timeout],
    [['@culture'], undefined, 'true', undefined, 600000]);
  assert.match(staged.prompt, /# Production policy/u);
  // The research protocol has no production stages.
  const research = (await prepare('qloo', { protocol: 'research', production: true, review: true })).agent;
  assert.deepEqual([research.toolsSettings, research.mcpServers.culture.env.CULTURE_PRODUCTION], [undefined, undefined]);
  assert.doesNotMatch(research.prompt, /# Production policy/u);

  // The MCP server lists the capture tool only on a taste bridge whose host captures, and its policy only with the stages.
  const names = options => getToolDefinitions({ includeProjectTools: true, includeQlooTools: false, protocol: 'taste', ...options }).map(tool => tool.name);
  assert.ok(names({ captureTool: true }).includes('project_capture_review'));
  assert.equal(names({}).includes('project_capture_review'), false);
  assert.equal(getToolDefinitions({ captureTool: true }).some(tool => tool.name === 'project_capture_review'), false, 'A portable session uses culture_capture instead.');
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
  const instructions = async production => (await dispatchRpc({ includeProjectTools: true, includeQlooTools: false, protocol: 'taste', production, message: initialize })).result.instructions;
  assert.match(await instructions(true), /# Production policy/u);
  assert.doesNotMatch(await instructions(false), /# Production policy/u);
  const refused = await dispatchRpc({ includeProjectTools: true, includeQlooTools: false, protocol: 'taste', handler: async () => assert.fail('The host is not asked.'),
    message: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'project_capture_review', arguments: {} } } });
  assert.equal(refused.result.structuredContent.error.code, 'TOOL_UNKNOWN');
});

test('the capture server serves a run\'s site as its preview does, under the preview policy, and nothing else', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-site-capture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = { 'index.html': '<!doctype html><title>Fixture</title>', 'styles.css': 'body{color:#123456}' };
  const project = { readFile: async file => { if (!Object.hasOwn(files, file)) throw new Error('Not a project file.'); return files[file]; } };
  const picture = await fs.readFile(path.join(rootDir, 'library', 'local-food', 'olive-oil-1.jpg'));
  await fs.mkdir(path.join(root, 'generated'), { recursive: true });
  for (const name of ['dna7-1.jpg', 'dna7-9.jpg']) await fs.writeFile(path.join(root, 'generated', name), picture);
  const [library, fonts] = await Promise.all([loadLibrary(rootDir, 'local-food'), loadFontLibrary(rootDir)]);
  const server = await serveSiteCapture({ project, assets: root, images: [{ path: 'generated/dna7-1.jpg', format: 'jpeg' }, { path: '../escape.jpg' }], library, fonts });
  t.after(() => server.close());
  const get = (name, init) => fetch(`${server.url}/${name}`, init);
  const page = await get('');
  assert.equal(page.status, 200);
  assert.deepEqual([page.headers.get('content-security-policy'), page.headers.get('access-control-allow-origin'), page.headers.get('content-type')], [PREVIEW_CSP, '*', 'text/html; charset=utf-8']);
  assert.equal(await page.text(), files['index.html']);
  assert.equal(await (await get('styles.css')).text(), files['styles.css']);
  const photo = await get(library.images[0].path);
  assert.deepEqual([photo.status, photo.headers.get('content-type')], [200, 'image/jpeg']);
  const font = await get('fonts/jost-latin-wght-normal.woff2');
  assert.deepEqual([font.status, font.headers.get('content-type')], [200, 'font/woff2']);
  assert.deepEqual(Buffer.from(await (await get('generated/dna7-1.jpg')).arrayBuffer()), picture);
  for (const name of ['library/not-listed.jpg', 'fonts/not-listed.woff2', 'generated/dna7-9.jpg', 'app.js', '..%2F.env', '%2e%2e/.env', 'meta.json']) assert.equal((await get(name)).status, 404, name);
  assert.equal((await get('index.html', { method: 'POST' })).status, 405);
});

test('an installed browser captures a run\'s site under the preview policy, running its scripts and scrolling to a target', async t => {
  const browser = await inspectBrowser();
  if (!browser.available) { t.skip(browser.reason); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-site-shot-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = {
    'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fixture</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Fixture</h1><section id="far"></section></main><script src="app.js"></script></body></html>',
    'styles.css': "@font-face{font-family:'Jost';src:url('fonts/jost-latin-wght-normal.woff2') format('woff2')}html,body{margin:0}body{background:#123456;font-family:Jost,sans-serif}h1{margin:0;height:2400px}#far{height:1200px;background:#20c040}",
    'app.js': "document.body.style.background = 'rgb(200, 30, 40)';",
  };
  const project = { readFile: async file => { if (!Object.hasOwn(files, file)) throw new Error('Not a project file.'); return files[file]; } };
  const [library, fonts] = await Promise.all([loadLibrary(rootDir, 'local-food'), loadFontLibrary(rootDir)]);
  const capture = createSiteCapture({ browser });
  assert.equal(capture.available, true);
  const request = { project, assets: root, images: [], library, fonts, round: 1, outDir: path.join(root, 'review') };
  const shots = await capture.capture({ ...request, views: SITE_VIEWS });
  assert.deepEqual(shots.map(shot => [shot.id, shot.width, shot.height]), [['r1-desktop', 1440, 900], ['r1-mobile', 390, 844]]);
  const near = (actual, expected) => actual.slice(0, 3).every((value, index) => Math.abs(value - expected[index]) <= 3);
  // The page's own script ran under the preview's sandboxed policy.
  const top = decodePng(await fs.readFile(shots[0].file)).pixel(720, 450);
  assert.ok(near(top, [200, 30, 40]), `The script did not run: ${top}`);
  const [far] = await capture.capture({ ...request, views: [SITE_VIEWS[1]], target: 'far' });
  assert.equal(far.id, 'r1-mobile-far');
  const scrolled = decodePng(await fs.readFile(far.file)).pixel(195, 400);
  assert.ok(near(scrolled, [32, 192, 64]), `The view did not scroll to #far: ${scrolled}`);
  assert.deepEqual(createSiteCapture({ browser: { available: false, reason: 'Test-only: no browser.' } }), { available: false, reason: 'Test-only: no browser.' });
});
