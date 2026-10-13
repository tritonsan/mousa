import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { rootDir } from '../src/config.mjs';
import { normalizeDesignDna } from '../plugin/server/culture/taste.mjs';
import { registerMedium, mediumProfile, listMedia, checkAppConformance, checkLiteralConformance, designTokens } from '../plugin/server/production/media.mjs';
import { normalizeCapabilities, standaloneCapabilities, methodsFor } from '../plugin/server/production/capabilities.mjs';
import { normalizeTasteReading, applyReadingToDna } from '../plugin/server/production/reading.mjs';
import { normalizeProductionPlan, generationAllowance, planMatchesDna } from '../plugin/server/production/plan.mjs';
import { normalizeReview } from '../plugin/server/production/review.mjs';
import { browserArgs, captureShots, captureViews, inspectBrowser, verifyBrowser, serveDirectory } from '../plugin/server/production/capture.mjs';
import { relativePath, resolveInProject, readProjectFiles, ProjectScopeError } from '../plugin/server/production/project-files.mjs';
import { PRODUCTION_POLICY_TEXT } from '../plugin/server/production/policy.mjs';
import { createToolHandler, sessionInstructions } from '../plugin/server/mcp/server.mjs';

const quality = (family, name, extra = {}) => ({ ref: `quality:${family}:${name.toLowerCase()}`, name, domain: 'qualities', family, source: 'qloo', tags: [name], score: 2, ...extra });
const work = (ref, name, domain, tags, extra = {}) => ({ ref, name, domain, source: 'qloo', tags, affinity: 0.6, surprise: false, predictedByModel: false, ...extra });
const INPUT = { source: 'qloo-profile', entities: [
  quality('mood', 'Atmospheric', { surprise: true }), quality('look', 'Minimalist', { predictedByModel: true }), quality('meaning', 'Solitude', { surprise: true }),
  work('E-PATERSON', 'Paterson', 'movie', ['Atmospheric', 'Poetic'], { surprise: true }), work('E-ENO', 'Brian Eno', 'artist', ['Ambient', 'Atmospheric'], { predictedByModel: true }),
  work('E-KINGS', 'LA Kings', 'brand', ['Ice hockey'], { surprise: true, affinity: 0.3 }), work('E-MUJI', 'Muji', 'brand', ['Minimalist', 'Calm']),
  { ref: 'M01', name: 'Kinfolk', domain: 'brand', source: 'model-assumption' },
], requiredAnchors: ['quality:mood:atmospheric', 'quality:look:minimalist', 'quality:meaning:solitude', 'E-PATERSON', 'E-KINGS'] };
const READING = { schemaVersion: '1.0', clusters: [
  { id: 'c1', name: 'Late light', refs: ['quality:mood:atmospheric', 'E-PATERSON', 'E-ENO'], layers: ['palette', 'imagery', 'voice'], reading: 'The audience likes evening, ambient works that let a scene breathe.' },
  { id: 'c2', name: 'Spare solitude', refs: ['quality:look:minimalist', 'quality:meaning:solitude', 'E-MUJI'], layers: ['typography', 'layout'], reading: 'Spare objects and solitary routines: room around each thing.' },
], setAside: [{ ref: 'E-KINGS', reason: 'A sports team whose catalogue tags share nothing with the qualities.' }],
approach: 'The design carries late light in its palette and pictures, and solitude in single-column cards with spare type and a quiet voice.' };
const DNA = { schemaVersion: '1.0', thesis: 'Quiet evening walks told in dusk colours and hushed type.', devices: [
  { id: 'dna1', layer: 'palette', device: 'Dusk harbour palette', anchors: ['quality:mood:atmospheric'], qualities: ['Atmospheric'], translation: 'Low evening light becomes slate blue and sodium amber.', tokens: { colors: ['#1d2a33', '#e0a458'] } },
  { id: 'dna2', layer: 'typography', device: 'Spare geometric headings', anchors: ['quality:look:minimalist'], qualities: ['Minimalist'], translation: 'Spare objects become a light geometric face with wide spacing.', tokens: { fonts: ['Jost'] } },
  { id: 'dna3', layer: 'layout', device: 'Single-column walk cards', anchors: ['quality:meaning:solitude', 'E-PATERSON'], qualities: ['Solitude'], translation: 'Solitary routines become one card at a time with room around it.', tokens: { ids: ['walk-list'], css: [{ property: 'grid-template-columns', value: '1fr' }] } },
  { id: 'dna4', layer: 'imagery', device: 'Night street picture', anchors: ['E-PATERSON'], qualities: ['Poetic'], translation: 'A poetic street at dusk, in the palette.', tokens: { svg: ['street-art'], colors: ['#1d2a33', '#e0a458'] } },
  { id: 'dna5', layer: 'voice', device: 'Quiet second-person voice', anchors: ['E-ENO'], qualities: ['Ambient'], translation: 'An ambient register: short, unhurried lines.', tokens: { copy: ['Walk until the streetlights come on', 'Slow streets, late light'] } },
], rejected: [] };
const PLAN = { schemaVersion: '1.0', steps: [
  { device: 'dna1', method: 'css-palette', cluster: 'c1', why: 'The colours set the late-light mood everywhere.' },
  { device: 'dna2', method: 'library-font', cluster: 'c2', why: 'A spare geometric face from the library.' },
  { device: 'dna3', method: 'css-layout', cluster: 'c2', why: 'One column gives each walk room.' },
  { device: 'dna4', method: 'generated-image', cluster: 'c1', why: 'A painted street at dusk carries the late light.', count: 1, fallback: 'inline-svg' },
  { device: 'dna5', method: 'copy', cluster: 'c1', why: 'The voice carries the ambient register.' },
], review: [{ id: 'r1', device: 'dna1', look: 'The first screen reads as dusk: slate blue ground with amber accents.' },
  { id: 'r2', device: 'dna3', look: 'At 390 pixels the walk cards sit in one column with room around each.', view: 'mobile' }] };
const CAPABILITIES = { schemaVersion: '1.0', medium: 'web', materials: { fonts: { available: true, count: 33 } }, generators: { image: { available: true, perRun: 2 } }, review: { capture: { available: true } } };
const clone = value => structuredClone(value);
const message = pattern => error => { assert.match(error.message, pattern); return true; };
const validDna = (raw = DNA, reading = normalizeTasteReading(READING, { input: INPUT })) => normalizeDesignDna(applyReadingToDna(raw, reading), { input: INPUT });

test('media profiles name their layers, methods and views, and a host can register its own', () => {
  assert.deepEqual(listMedia().map(medium => medium.id).slice(0, 3), ['web', 'app-ui', 'generic']);
  const web = mediumProfile('web');
  assert.deepEqual(web.views.map(view => [view.id, view.width, view.height]), [['desktop', 1440, 900], ['mobile', 390, 844]]);
  for (const layer of web.layers) assert.ok(web.methods.some(item => item.kind !== 'generator' && item.layers.includes(layer)), layer);
  assert.throws(() => mediumProfile('film'), message(/Use one of: web, app-ui, generic/u));
  assert.throws(() => registerMedium({ id: 'poster', layers: ['palette', 'imagery'], methods: [{ id: 'paint', kind: 'generator', generator: 'image', layers: ['imagery'], description: 'Paint the poster picture.' },
    { id: 'colors', kind: 'code', layers: ['palette'], description: 'Declare the colors.' }] }), /no method without a generator for imagery/u);
  const poster = registerMedium({ id: 'test-poster', label: 'Poster', layers: ['palette', 'imagery'], requiredLayers: ['palette'], views: [{ id: 'print', width: 800, height: 1200 }],
    methods: [{ id: 'paint', kind: 'generator', generator: 'image', layers: ['imagery'], description: 'Paint the poster picture.' }, { id: 'vector', kind: 'code', layers: ['palette', 'imagery'], description: 'Draw the poster as vectors.' }] });
  assert.equal(mediumProfile('test-poster'), poster);
});

test('capabilities derive available methods, and a hosted server has no image generator', () => {
  const capabilities = normalizeCapabilities(CAPABILITIES);
  const status = id => capabilities.methods.find(item => item.id === id);
  assert.equal(status('generated-image').available, true); assert.equal(status('generated-image').perRun, 2);
  assert.equal(status('library-photo').available, false); assert.match(status('library-photo').reason, /no photos library/u);
  assert.deepEqual(capabilities.review.capture.views.map(view => view.id), ['desktop', 'mobile']);
  assert.deepEqual(methodsFor(capabilities, 'imagery', { generators: false }), ['inline-svg', 'css-art']);
  assert.throws(() => normalizeCapabilities({ ...CAPABILITIES, required: ['library-photo'] }), message(/cannot require library-photo here/u));
  assert.throws(() => normalizeCapabilities({ ...CAPABILITIES, generators: { image: { available: false } } }), message(/capabilities.generators.image.reason/u));
  const hosted = standaloneCapabilities({ environment: 'hosted', image: { available: true }, browser: { available: true }, fonts: { families: [{}] } });
  assert.equal(hosted.methods.find(item => item.id === 'generated-image').available, false);
  assert.match(hosted.generators.image.reason, /hosted server has no image generator/u);
  assert.equal(hosted.review.capture.available, true);
  const bare = standaloneCapabilities({ medium: 'generic' });
  assert.equal(bare.materials.fonts.available, false); assert.equal(bare.review.capture.available, false);
});

test('a taste reading clusters refs on qualities, accounts for every required anchor and gathers a surprise', () => {
  const reading = normalizeTasteReading(READING, { input: INPUT });
  assert.deepEqual(reading.coverage, { required: INPUT.requiredAnchors, clustered: INPUT.requiredAnchors.slice(0, 4), setAside: ['E-KINGS'] });
  assert.equal(reading.clusters[0].surprise, true); assert.equal(reading.stats.qualityRefs, 3);
  const broken = change => { const value = clone(READING); change(value); return () => normalizeTasteReading(value, { input: INPUT }); };
  assert.throws(broken(value => { value.clusters[1].refs = ['E-MUJI', 'M01']; }), message(/Rest each cluster on at least one measured quality ref/u));
  assert.throws(broken(value => { value.clusters[1].refs.push('E-ENO'); }), message(/already in cluster c1/u));
  assert.throws(broken(value => { value.setAside = []; }), message(/Missing: LA Kings \(E-KINGS\)/u));
  assert.throws(broken(value => { value.setAside.push({ ref: 'E-MUJI', reason: 'Gathered and set aside at once.' }); }), message(/either gathered or set aside/u));
  assert.throws(broken(value => { value.clusters[1].layers = ['layout']; }), message(/No cluster carries typography/u));
  assert.throws(broken(value => { value.clusters[0].layers = ['palette', 'voice', 'silhouette']; }), message(/Use layers of the website medium/u));
  const calm = { ...INPUT, entities: INPUT.entities.map(entity => ({ ...entity, surprise: false })) };
  assert.equal(normalizeTasteReading(READING, { input: calm }).stats.surpriseClusters, 0);
  const surprising = { ...INPUT, entities: INPUT.entities.map(entity => ({ ...entity, surprise: entity.ref === 'E-KINGS' })) };
  assert.throws(() => normalizeTasteReading(READING, { input: surprising }), message(/gather at least one surprise into a cluster, such as LA Kings/u));
  // Three required anchors set aside: the team, the solitude quality and the film.
  assert.throws(broken(value => {
    value.clusters[0].refs = ['quality:mood:atmospheric', 'E-ENO']; value.clusters[1].refs = ['quality:look:minimalist', 'E-MUJI'];
    value.setAside.push({ ref: 'quality:meaning:solitude', reason: 'Too narrow a theme for this app.' }, { ref: 'E-PATERSON', reason: 'Too narrow a film for this app.' });
  }), message(/At most 2 required anchors may be set aside/u));
});

test('the reading binds the DNA: set-aside refs cannot anchor and set-aside required anchors count as rejected', () => {
  const reading = normalizeTasteReading(READING, { input: INPUT });
  assert.throws(() => normalizeDesignDna(DNA, { input: INPUT }), message(/Missing: LA Kings \(E-KINGS\)/u));
  const dna = validDna();
  assert.deepEqual(dna.rejected, [{ ref: 'E-KINGS', reason: 'Set aside in the taste reading: A sports team whose catalogue tags share nothing with the qualities.' }]);
  assert.deepEqual(dna.coverage.rejected, ['E-KINGS']);
  const kings = clone(DNA); kings.devices[2].anchors.push('E-KINGS');
  assert.throws(() => applyReadingToDna(kings, reading), message(/dna\.devices\[2\]\.anchors\[2\].*set E-KINGS aside/u));
  const loose = clone(DNA); loose.devices[4].anchors = ['M01'];
  assert.throws(() => applyReadingToDna(loose, reading), message(/Anchor each device to at least one ref of a reading cluster/u));
  const named = clone(DNA); named.rejected = [{ ref: 'E-KINGS', reason: 'The DNA gives its own reason for this team.' }];
  assert.equal(validDna(named).rejected[0].reason, 'The DNA gives its own reason for this team.');
});

test('a production plan makes every device with an available method, realizes every cluster and gates generation', () => {
  const reading = normalizeTasteReading(READING, { input: INPUT }), dna = validDna(), capabilities = normalizeCapabilities(CAPABILITIES);
  const plan = normalizeProductionPlan(PLAN, { dna, reading, capabilities });
  assert.deepEqual(plan.uses, { methods: ['css-palette', 'library-font', 'css-layout', 'generated-image', 'copy'], generators: { image: { total: 1, devices: { dna4: 1 } } }, materials: { fonts: ['Jost'] } });
  assert.deepEqual(plan.stats, { steps: 5, methods: 5, generatorSteps: 1, clusters: 2, layerFit: 1 });
  assert.equal(planMatchesDna(plan, dna), true);
  assert.deepEqual(generationAllowance(plan, 'image', 'dna4', 0), { allowed: true, limit: 1, remaining: 1 });
  assert.match(generationAllowance(plan, 'image', 'dna4', 1).reason, /gives dna4 1 image picture, and 1 was requested/u);
  assert.match(generationAllowance(plan, 'image', 'dna1', 0).reason, /gives dna1 no image generation; it plans image pictures for dna4/u);
  const broken = (change, options = {}) => { const value = clone(PLAN); change(value); return () => normalizeProductionPlan(value, { dna, reading, capabilities, ...options }); };
  assert.throws(broken(value => { value.steps[3].method = 'library-photo'; delete value.steps[3].count; delete value.steps[3].fallback; }), message(/library-photo is not available here: This host offers no photos library\. Methods for imagery here: generated-image, inline-svg, css-art/u));
  assert.throws(broken(() => {}, { capabilities: standaloneCapabilities({ environment: 'hosted', fonts: { families: [{}] }, browser: { available: true } }) }), message(/generated-image is not available here: A hosted server has no image generator.*Methods for imagery here: inline-svg, css-art/u));
  assert.throws(broken(value => { value.steps[0].method = 'copy'; }), message(/copy makes voice, not palette/u));
  assert.throws(broken(value => { value.steps[2].method = 'inline-svg'; }), message(/inline-svg needs the id of each <svg> it draws in tokens\.svg in device dna3/u));
  assert.throws(broken(value => { delete value.steps[3].fallback; }), message(/Name a fallback that needs no generator.*inline-svg, css-art/u));
  assert.throws(broken(value => { value.steps[3].fallback = 'generated-image'; }), message(/A fallback needs no generator/u));
  assert.throws(broken(value => { value.steps[3].count = 3; }), message(/A whole number from 1 to 2/u));
  assert.throws(broken(value => { value.steps[0].count = 1; }), message(/A count belongs only to a method that uses a generator/u));
  assert.throws(broken(value => { value.steps.pop(); }), message(/No step for: dna5/u));
  assert.throws(broken(value => { value.steps[1].cluster = 'c1'; }), message(/Device dna2 anchors none of cluster c1's refs\. Its anchors belong to c2/u));
  assert.throws(broken(value => { value.review = value.review.slice(0, 1); }), message(/An array with 2-6 items is required/u));
  assert.throws(broken(value => { value.review[1].view = 'tablet'; }), message(/Use a capture view: desktop, mobile/u));
  assert.throws(broken(() => {}, { capabilities: normalizeCapabilities({ ...CAPABILITIES, required: ['inline-svg'] }) }), message(/This study requires inline-svg in both arms/u));
  // A device whose anchors span two clusters may realize either.
  const moved = clone(PLAN); moved.steps[2].cluster = 'c1';
  assert.equal(normalizeProductionPlan(moved, { dna, reading, capabilities }).stats.layerFit, 0.8);
  const noCapture = normalizeProductionPlan({ ...PLAN, review: [] }, { dna, reading, capabilities: normalizeCapabilities({ ...CAPABILITIES, review: undefined }) });
  assert.deepEqual(noCapture.review, []);
});

test('a plan realizes every cluster of the reading', () => {
  const reading = normalizeTasteReading({ ...READING, clusters: [
    { id: 'c1', name: 'Late light', refs: ['quality:mood:atmospheric', 'E-PATERSON'], layers: ['palette', 'imagery'], reading: 'Evening works that let a scene breathe.' },
    { id: 'c2', name: 'Spare sound', refs: ['quality:look:minimalist', 'E-ENO'], layers: ['typography', 'voice'], reading: 'Spare, ambient forms with room in them.' },
    { id: 'c3', name: 'Solitary routines', refs: ['quality:meaning:solitude', 'E-MUJI'], layers: ['layout'], reading: 'Solitary routines among plain, useful things.' },
  ] }, { input: INPUT });
  const dna = normalizeDesignDna(applyReadingToDna(DNA, reading), { input: INPUT });
  const plan = clone(PLAN); plan.steps[1].cluster = 'c2'; plan.steps[2].cluster = 'c1'; plan.steps[4].cluster = 'c2';
  assert.throws(() => normalizeProductionPlan(plan, { dna, reading, capabilities: normalizeCapabilities(CAPABILITIES) }), message(/Not realized: c3 \(Solitary routines\)/u));
  plan.steps[2].cluster = 'c3';
  assert.equal(normalizeProductionPlan(plan, { dna, reading, capabilities: normalizeCapabilities(CAPABILITIES) }).stats.clusters, 3);
});

test('a review judges every criterion on a capture of its round, opened in the session, and names repairs', () => {
  const plan = normalizeProductionPlan(PLAN, { dna: validDna(), reading: normalizeTasteReading(READING, { input: INPUT }), capabilities: normalizeCapabilities(CAPABILITIES) });
  const captures = [{ id: 'r1-desktop', round: 1, path: '.mousa/captures/r1-desktop.png' }, { id: 'r1-mobile', round: 1, path: '.mousa/captures/r1-mobile.png' }, { id: 'r2-mobile', round: 2, path: '.mousa/captures/r2-mobile.png' }];
  const REVIEW = { schemaVersion: '1.0', round: 1, criteria: [
    { id: 'r1', capture: 'r1-desktop', verdict: 'met', observed: 'A slate ground with amber headings fills the first screen.' },
    { id: 'r2', capture: 'r1-mobile', verdict: 'partly', observed: 'The cards stack, but the second one touches the first.', repair: 'Added a 24 pixel gap between walk cards.' },
  ], summary: 'The dusk palette reads; the card spacing needed a repair.' };
  const review = normalizeReview(REVIEW, { plan, captures, opened: new Set(['r1-desktop', 'r1-mobile']), round: 1 });
  assert.deepEqual(review.stats, { met: 1, partly: 1, missed: 0, repairs: 1, captures: ['r1-desktop', 'r1-mobile'] });
  assert.equal(review.audited, true);
  const broken = (change, options = {}) => { const value = clone(REVIEW); change(value); return () => normalizeReview(value, { plan, captures, opened: null, ...options }); };
  assert.throws(broken(value => { value.criteria[0].capture = 'r1-tablet'; }), message(/Cite a capture the host made in this round: r1-desktop, r1-mobile/u));
  assert.throws(broken(value => { value.round = 2; }), message(/r1-desktop was taken in round 1, before your repairs/u));
  assert.throws(broken(() => {}, { opened: new Set(['r1-desktop']) }), message(/r1-mobile was not opened in this session\. Open \.mousa\/captures\/r1-mobile\.png/u));
  assert.throws(broken(value => { delete value.criteria[1].repair; }), message(/A partly criterion names the repair/u));
  assert.throws(broken(value => { value.criteria.pop(); }), message(/No verdict for: r2/u));
  assert.throws(broken(value => { value.criteria[1].verdict = 'fine'; }), message(/Use one of: met, partly, missed/u));
  assert.throws(broken(() => {}, { round: 2 }), message(/This is review round 2/u));
  assert.throws(() => normalizeReview(REVIEW, { plan: { ...plan, review: [] }, captures }), message(/no review criteria/u));
});

test('an app interface keeps its values in a design token file consumed through var()', () => {
  const dna = { devices: [{ id: 'dna1', layer: 'palette', device: 'Dusk palette', tokens: { colors: ['#1d2a33', '#e0a458'], fonts: [], css: [], ids: [], copy: [], images: [], keyframes: [], svg: [] } },
    { id: 'dna2', layer: 'typography', device: 'Spare headings', tokens: { colors: [], fonts: ['Jost'], css: [], ids: [], copy: [], images: [], keyframes: [], svg: [] } }] };
  const tokens = JSON.stringify({ color: { ink: { $value: '#1D2A33' }, amber: { $value: '#e0a458' } }, font: { heading: { $value: 'Jost, sans-serif' } } });
  assert.deepEqual([...designTokens(JSON.parse(tokens))], [['color-ink', '#1D2A33'], ['color-amber', '#e0a458'], ['font-heading', 'Jost, sans-serif']]);
  const css = ':root{--color-ink:#1d2a33;--color-amber:#e0a458;--font-heading:"Jost",sans-serif}body{background:var(--color-ink);color:var(--color-amber);font-family:var(--font-heading)}';
  const good = checkAppConformance(dna, { 'index.html': '<main></main>', 'styles.css': css, 'tokens/tokens.json': tokens });
  assert.equal(good.score, 1); assert.equal(good.tokens.file, 'tokens/tokens.json'); assert.equal(good.tokens.used, 3);
  const unused = checkAppConformance(dna, { 'index.html': '<main></main>', 'styles.css': css.replace('color:var(--color-amber)', 'color:#e0a458'), 'tokens/tokens.json': tokens });
  assert.equal(unused.devices[0].status, 'partial');
  assert.deepEqual(unused.devices[0].missing, [{ kind: 'token', value: '#e0a458', detail: '--color-amber must be declared with this value in the CSS and used through var()' }]);
  const none = checkAppConformance(dna, { 'index.html': '<main></main>', 'styles.css': css });
  assert.equal(none.tokens.problem, 'no design token file such as tokens/tokens.json'); assert.equal(none.devices[1].status, 'partial');
  assert.equal(mediumProfile('app-ui').checkConformance(dna, { 'styles.css': css, 'tokens/tokens.json': tokens }).score, 1);
});

test('the generic medium accepts literal tokens and any motion, and finds them in any text project', () => {
  const generic = mediumProfile('generic');
  const motion = { id: 'dna6', layer: 'motion', device: 'Unhurried spring', anchors: ['quality:mood:atmospheric'], qualities: ['Atmospheric'], translation: 'Screens settle slowly, like evening light.', tokens: { literals: ['withSpring(0.4)'] } };
  const raw = applyReadingToDna({ ...DNA, devices: [...DNA.devices, motion] }, normalizeTasteReading(READING, { input: INPUT }));
  assert.throws(() => normalizeDesignDna(raw, { input: INPUT }), message(/Unsupported field "literals"/u));
  const dna = generic.validateDna(raw, { input: INPUT });
  assert.deepEqual(dna.devices[5].tokens.literals, ['withSpring(0.4)']);
  const files = { 'App.swift': 'let ink = Color(hex: 0xFF1D2A33)\nlet amber = "#E0A458"\n.font(.custom("Jost", size: 28))\nList { }.id("walk-list") // grid-template-columns: 1fr\nText("Walk until the streetlights come on")\nText("Slow streets, late light")\n.animation(withSpring(0.4))',
    'street-art.svg': `<svg viewBox="0 0 10 10">${'<rect width="1" height="1"/>'.repeat(8)}</svg>` };
  const report = checkLiteralConformance(dna, files);
  assert.equal(report.score, 1, JSON.stringify(report.devices.filter(device => device.status !== 'present')));
  const thin = checkLiteralConformance(dna, { ...files, 'street-art.svg': '<svg><rect/></svg>' });
  assert.equal(thin.devices[3].missing[0].detail, 'street-art draws 1 shapes; it needs at least 8');
});

test('project paths stay inside the configured folder and out of hidden or tool folders', async t => {
  for (const bad of ['../outside.txt', '/etc/passwd', 'C:/Windows/win.ini', '.env', 'src/.git/config', 'node_modules/x.js', 'a//b', '.mousa/captures.json']) assert.throws(() => relativePath(bad), ProjectScopeError, bad);
  assert.equal(relativePath('.mousa/captures.json', { state: true }), '.mousa/captures.json');
  assert.throws(() => relativePath('.mousa/.hidden', { state: true }), ProjectScopeError);
  assert.equal(relativePath('fonts\\jost.woff2'), 'fonts/jost.woff2');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-project-')));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-outside-'));
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
  await fs.writeFile(path.join(root, 'index.html'), '<main>Hi</main>');
  await fs.writeFile(path.join(outside, 'secret.html'), 'outside');
  await fs.symlink(outside, path.join(root, 'link'), 'junction');
  await assert.rejects(resolveInProject(root, 'link/secret.html'), /leads outside the project/u);
  assert.deepEqual(await readProjectFiles(root, ['index.html']), { 'index.html': '<main>Hi</main>' });
  await assert.rejects(readProjectFiles(root, ['missing.html']), /does not exist/u);
});

test('the capture server serves only web files of its folder, never dot-files or other types', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-serve-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index.html'), '<main>Page</main>');
  await fs.writeFile(path.join(root, 'styles.css'), 'main{}');
  await fs.writeFile(path.join(root, '.env'), 'SECRET=never');
  await fs.writeFile(path.join(root, 'notes.bin'), 'binary');
  await fs.mkdir(path.join(root, '.mousa')); await fs.writeFile(path.join(root, '.mousa', 'captures.json'), '{}');
  const server = await serveDirectory(root);
  t.after(() => server.close());
  const get = async name => { const response = await fetch(server.url + name); return { status: response.status, type: response.headers.get('content-type'), body: await response.text() }; };
  assert.deepEqual(await get('/'), { status: 200, type: 'text/html; charset=utf-8', body: '<main>Page</main>' });
  assert.equal((await get('/styles.css')).type, 'text/css; charset=utf-8');
  for (const name of ['/.env', '/notes.bin', '/.mousa/captures.json', '/missing.html']) assert.equal((await get(name)).status, 404, name);
  assert.equal((await fetch(server.url + '/index.html', { method: 'POST' })).status, 405);
  // URL parsing resolves "..", even encoded as %2e%2e, inside the served folder; an encoded slash or backslash reaches
  // the server as a parent segment and is refused.
  const raw = name => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: new URL(server.url).port, path: name }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(await raw('/%2e%2e/index.html'), 200);
  assert.equal(await raw('/..%2findex.html'), 404);
  assert.equal(await raw('/x%5c..%5cindex.html'), 404);
});

const pngOf = (width, height) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'latin1'); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};
/** A browser that speaks the DevTools protocol on its pipes, as the capture drives it. */
function fakeBrowser(log, { failNavigation = false } = {}) {
  return (file, args, options) => {
    log.push({ file, args, stdio: options.stdio, env: options.env });
    const child = new EventEmitter(), input = new PassThrough(), output = new PassThrough();
    child.stdio = [null, null, null, input, output]; child.exitCode = null;
    child.kill = () => { if (child.exitCode === null) { child.exitCode = 0; child.emit('close', 0); } };
    let buffer = '', metrics = null;
    input.on('data', chunk => {
      buffer += chunk;
      for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        log.push(message.method);
        const reply = result => output.write(`${JSON.stringify({ id: message.id, result })}\0`);
        if (message.method === 'Target.createTarget') reply({ targetId: 'T1' });
        else if (message.method === 'Target.attachToTarget') reply({ sessionId: 'S1' });
        else if (message.method === 'Emulation.setDeviceMetricsOverride') { metrics = message.params; reply({}); }
        else if (message.method === 'Page.navigate') {
          log.push(message.params.url);
          reply(failNavigation ? { errorText: 'net::ERR_NAME_NOT_RESOLVED' } : { frameId: 'F1' });
          if (!failNavigation) setTimeout(() => output.write(`${JSON.stringify({ method: 'Page.loadEventFired', params: {}, sessionId: 'S1' })}\0`), 5);
        } else if (message.method === 'Page.getLayoutMetrics') reply({ cssContentSize: { width: metrics.width, height: 2000 } });
        else if (message.method === 'Page.captureScreenshot') reply({ data: pngOf(metrics.width, message.params.clip?.height ?? metrics.height).toString('base64') });
        else if (message.method === 'Browser.close') { reply({}); setTimeout(() => child.kill(), 5); }
        else reply({});
      }
    });
    setImmediate(() => child.emit('spawn'));
    return child;
  };
}

test('a capture lays the page out at each exact view over the DevTools pipe, with only loopback reachable', async t => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-shots-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  const args = browserArgs({ profileDir: 'profile' });
  for (const flag of ['--headless=new', '--remote-debugging-pipe', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9', '--webrtc-ip-handling-policy=disable_non_proxied_udp']) assert.ok(args.includes(flag), flag);
  assert.equal(args.includes('--no-sandbox'), false); assert.ok(browserArgs({ profileDir: 'p', noSandbox: true }).includes('--no-sandbox'));
  const log = [], browser = { available: true, path: 'fake-browser' };
  const shots = await captureViews({ browser, baseUrl: 'http://127.0.0.1:4000', views: mediumProfile('web').views, target: 'walk-list', outDir, prefix: 'r1', spawnImpl: fakeBrowser(log), env: { QLOO_API_KEY: 'never', PATH: 'x' }, settleMs: 0 });
  assert.deepEqual(shots.map(({ file, ...shot }) => shot), [{ id: 'r1-desktop-walk-list', view: 'desktop', target: 'walk-list', width: 1440, height: 900, bytes: 33 }, { id: 'r1-mobile-walk-list', view: 'mobile', target: 'walk-list', width: 390, height: 844, bytes: 33 }]);
  assert.deepEqual(log[0].stdio, ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']);
  assert.deepEqual(log[0].env, { PATH: 'x' });
  assert.ok(log.includes('http://127.0.0.1:4000/index.html#walk-list'));
  assert.equal(log.filter(entry => entry === 'Emulation.setDeviceMetricsOverride').length, 2);
  const full = await captureViews({ browser, baseUrl: 'http://127.0.0.1:4000', views: [{ id: 'mobile', width: 390, height: 844 }], full: true, outDir, prefix: 'r1', spawnImpl: fakeBrowser([]), settleMs: 0 });
  assert.deepEqual([full[0].id, full[0].height], ['r1-mobile-full', 2000]);
  await assert.rejects(captureShots({ browser, shots: [{ url: 'https://example.com/', width: 100, height: 100, out: path.join(outDir, 'x.png') }], spawnImpl: fakeBrowser([]) }), /Only a loopback page/u);
  await assert.rejects(captureViews({ browser, baseUrl: 'http://127.0.0.1:4000', views: [{ id: 'm', width: 390, height: 844 }], outDir, prefix: 'r1', spawnImpl: fakeBrowser([], { failNavigation: true }), settleMs: 0 }), /did not load: net::ERR_NAME_NOT_RESOLVED/u);
  await assert.rejects(captureViews({ browser, baseUrl: 'http://127.0.0.1:4000', views: [], target: 'bad target', outDir, prefix: 'r1' }), /target: use an element ID/u);
});

/** A browser that stops at once with the given error output, as Chromium does when its sandbox cannot start. */
function stoppingBrowser(message) {
  return () => {
    const child = new EventEmitter(), stderr = new PassThrough();
    child.stdio = [null, null, stderr, new PassThrough(), new PassThrough()]; child.stderr = stderr; child.exitCode = null;
    child.kill = () => {};
    setImmediate(() => {
      child.emit('spawn');
      stderr.end(message);
      setTimeout(() => { child.exitCode = 1; child.emit('close', 1); }, 5);
    });
    return child;
  };
}

test('one test capture finds out a browser that is installed but cannot run, with the reason an operator can act on', async () => {
  const browser = { available: true, path: 'fake-chromium', name: 'chromium', label: 'Chromium' };
  assert.equal(await verifyBrowser(browser, { spawnImpl: fakeBrowser([]) }), browser);
  const sandbox = await verifyBrowser(browser, { spawnImpl: stoppingBrowser('[1:1:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! Update your kernel or see https://chromium.googlesource.com/chromium/src/+/main/docs/linux/suid_sandbox_development.md') });
  assert.equal(sandbox.available, false);
  assert.match(sandbox.reason, /^Chromium could not capture a test page here\. The browser could not run: its sandbox needs user namespaces, which this system blocks \(a default Docker container does\)\. Allow them, or set MOUSA_CAPTURE_NO_SANDBOX=1/u);
  // The reason fits the capability list the agent reads, which leaves the review out.
  assert.deepEqual(standaloneCapabilities({ browser: sandbox }).review.capture, { available: false, reason: sandbox.reason });
  assert.match((await verifyBrowser(browser, { spawnImpl: stoppingBrowser('Running as root without --no-sandbox is not supported. See https://crbug.com/638180.') })).reason, /could not run: it does not run as root with its sandbox on\./u);
  assert.match((await verifyBrowser(browser, { spawnImpl: stoppingBrowser('chromium: error while loading shared libraries: libnss3.so: cannot open shared object file') })).reason, /could not run: a library it needs is missing: libnss3\.so\.$/u);
  assert.match((await verifyBrowser(browser, { spawnImpl: stoppingBrowser('') })).reason, /could not capture a test page here\. The browser closed during the capture\.$/u);
  const off = { available: false, reason: 'Capture is turned off with MOUSA_CAPTURE=off.' };
  assert.equal(await verifyBrowser(off), off);
});

test('an installed browser captures a local page at the exact phone viewport', async t => {
  const browser = await inspectBrowser();
  if (!browser.available) { t.skip(browser.reason); return; }
  assert.equal(await verifyBrowser(browser), browser);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-real-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width"><title>t</title><body style="margin:0"><p id="w"></p><script>document.getElementById("w").textContent=innerWidth+"x"+innerHeight;document.title=innerWidth+"x"+innerHeight</script>');
  const server = await serveDirectory(root);
  t.after(() => server.close());
  const [shot] = await captureViews({ browser, baseUrl: server.url, views: [{ id: 'mobile', width: 390, height: 844 }], outDir: path.join(root, 'out'), prefix: 'r1' });
  assert.deepEqual([shot.width, shot.height], [390, 844]);
});

const PROJECT_ENV = root => ({ MOUSA_PROJECT_DIR: root, MOUSA_LIBRARY_ROOT: rootDir });
async function projectTools(t, { image = { available: false, reason: 'No Codex CLI was found. Install the Codex app or set CODEX_CLI_PATH.' }, generate, capture } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-tools-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const handler = createToolHandler({ includeQlooTools: false, production: { env: PROJECT_ENV(root), inspect: { image: async () => image, browser: async () => ({ available: true, path: 'fake' }) }, generate, capture } });
  const call = async (name, args = {}) => (await handler(name, args)).structuredContent;
  return { root, call };
}

test('standalone tools list capabilities and validate a reading, a DNA bound to it, and a plan against this machine', async t => {
  const { call } = await projectTools(t);
  const listed = await call('culture_list_capabilities', { medium: 'web' });
  assert.equal(listed.capabilities.materials.fonts.available, true); assert.equal(listed.capabilities.materials.fonts.count, 33);
  assert.match(listed.capabilities.methods.find(item => item.id === 'generated-image').reason, /No Codex CLI was found/u);
  assert.deepEqual(listed.medium.requiredLayers, ['palette', 'typography', 'voice']);
  const reading = await call('culture_validate_reading', { reading: READING, tasteInput: INPUT });
  assert.equal(reading.status, 'valid');
  const dna = await call('culture_validate_design_dna', { dna: DNA, tasteInput: INPUT, reading: READING });
  assert.equal(dna.status, 'valid', JSON.stringify(dna)); assert.deepEqual(dna.dna.coverage.rejected, ['E-KINGS']);
  const refused = await call('culture_validate_production_plan', { plan: PLAN, dna: dna.dna, reading: READING, tasteInput: INPUT });
  assert.equal(refused.error.code, 'TASTE_PROTOCOL_INVALID'); assert.match(refused.error.message, /generated-image is not available here: No Codex CLI was found/u);
  const svgPlan = clone(PLAN); svgPlan.steps[3] = { device: 'dna4', method: 'inline-svg', cluster: 'c1', why: 'A drawn street at dusk carries the late light.' };
  const valid = await call('culture_validate_production_plan', { plan: svgPlan, dna: dna.dna, reading: READING, tasteInput: INPUT });
  assert.equal(valid.status, 'valid'); assert.deepEqual(valid.plan.uses.generators, {});
  const withHost = await call('culture_validate_production_plan', { plan: PLAN, dna: DNA, reading: READING, tasteInput: INPUT, capabilities: CAPABILITIES });
  assert.equal(withHost.status, 'valid');
  assert.equal((await call('culture_validate_reading', { reading: { ...READING, setAside: [] }, tasteInput: INPUT })).error.code, 'TASTE_PROTOCOL_INVALID');
});

test('standalone tools find and fetch planned fonts into the project with their licences', async t => {
  const { root, call } = await projectTools(t);
  const found = await call('culture_find_materials', { kind: 'fonts', words: ['condensed', 'poster'] });
  assert.equal(found.families.length, 33); assert.deepEqual(found.families[0].matches, ['condensed', 'poster']);
  assert.ok(found.forDna.every(family => family.files.every(file => file.startsWith('fonts/'))));
  const plan = { uses: { methods: ['library-font'], generators: {}, materials: { fonts: ['Jost'] } }, steps: [], review: [] };
  const refused = await call('culture_fetch_materials', { fonts: ['Fraunces'], plan });
  assert.equal(refused.error.code, 'MATERIAL_NOT_PLANNED');
  const fetched = await call('culture_fetch_materials', { fonts: ['jost'], plan });
  assert.equal(fetched.status, 'fetched'); assert.equal(fetched.families[0].family, 'Jost');
  for (const face of fetched.families[0].files) assert.equal((await fs.readFile(path.join(root, face.path))).subarray(0, 4).toString('latin1'), 'wOF2');
  assert.match(await fs.readFile(path.join(root, fetched.families[0].licenseFile), 'utf8'), /SIL OPEN FONT LICENSE/iu);
  assert.match(fetched.fontFace[0], /^@font-face\{font-family:'Jost';src:url\('fonts\/jost-/u);
  assert.equal((await call('culture_fetch_materials', { fonts: ['Jost'], directory: '../escape' })).error.code, 'PROJECT_SCOPE_INVALID');
  assert.equal((await call('culture_fetch_materials', { fonts: ['Comic Sans'] })).error.code, 'MATERIAL_UNKNOWN');
});

test('standalone generation runs only where a generator exists and only as the plan states', async t => {
  const none = await projectTools(t);
  assert.equal((await none.call('culture_generate_image', { dna: DNA, device: 'dna4', subject: 'A quiet street corner at dusk with one lit window.' })).error.code, 'IMAGES_UNAVAILABLE');
  const made = [];
  const { root, call } = await projectTools(t, { image: { available: true, provider: 'codex', path: 'codex' }, generate: async ({ prompt, directory, name }) => {
    made.push(prompt); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, `${name}.jpg`), 'jpeg');
    return { path: `generated/${name}.jpg`, format: 'jpeg', width: 1200, height: 800, bytes: 4, description: 'A street corner at dusk.' };
  } });
  const plan = { uses: { methods: ['generated-image'], generators: { image: { total: 1, devices: { dna4: 1 } } }, materials: {} }, steps: [], review: [] };
  const named = await call('culture_generate_image', { dna: DNA, device: 'dna4', subject: 'Paterson at dusk with one lit window.', plan, tasteInput: INPUT });
  assert.equal(named.error.code, 'IMAGE_REQUEST_INVALID'); assert.match(named.error.message, /without naming taste entities \(Paterson\)/u);
  assert.equal((await call('culture_generate_image', { dna: DNA, device: 'dna1', subject: 'A quiet street corner at dusk with one lit window.', plan })).error.code, 'IMAGE_NOT_PLANNED');
  const image = await call('culture_generate_image', { dna: DNA, device: 'dna4', subject: 'A quiet street corner at dusk with one lit window.', plan, tasteInput: INPUT });
  assert.equal(image.status, 'generated'); assert.equal(image.path, 'generated/dna4-1.jpg');
  assert.equal(await fs.readFile(path.join(root, 'generated', 'dna4-1.jpg'), 'utf8'), 'jpeg');
  assert.match(made[0], /Palette: #1d2a33, #e0a458\. Qualities: Poetic\./u);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.mousa', 'images.json'), 'utf8')).images[0].device, 'dna4');
  assert.equal((await call('culture_generate_image', { dna: DNA, device: 'dna4', subject: 'A second street corner at dusk, rain on the stones.', plan })).error.code, 'IMAGE_NOT_PLANNED');
});

test('standalone capture issues round captures that a review must cite, and conformance reads project paths', async t => {
  const shots = [];
  const { root, call } = await projectTools(t, { capture: async ({ views, outDir, prefix, target, baseUrl }) => {
    shots.push(baseUrl);
    await fs.mkdir(outDir, { recursive: true });
    return Promise.all(views.map(async view => { const file = path.join(outDir, `${prefix}-${view.id}${target ? `-${target}` : ''}.png`); await fs.writeFile(file, pngOf(view.width, view.height)); return { id: path.basename(file, '.png'), view: view.id, width: view.width, height: view.height, bytes: 33, file }; }));
  } });
  await fs.writeFile(path.join(root, 'index.html'), '<main id="walk-list"><h1>Walk until the streetlights come on</h1><p>Slow streets, late light</p></main>');
  await fs.writeFile(path.join(root, 'styles.css'), 'body{background:#1d2a33;color:#e0a458;font-family:Jost,sans-serif}main{display:grid;grid-template-columns:1fr}');
  const captured = await call('culture_capture', {});
  assert.equal(captured.status, 'captured');
  assert.deepEqual(captured.captures.map(shot => [shot.id, shot.path]), [['r1-desktop', '.mousa/captures/r1-desktop.png'], ['r1-mobile', '.mousa/captures/r1-mobile.png']]);
  assert.match(shots[0], /^http:\/\/127\.0\.0\.1:\d+$/u);
  const plan = { uses: {}, steps: [], review: [{ id: 'r1', device: 'dna1', look: 'Dusk ground.' }, { id: 'r2', device: 'dna3', look: 'One column.' }] };
  const review = { schemaVersion: '1.0', round: 1, criteria: [{ id: 'r1', capture: 'r1-desktop', verdict: 'met', observed: 'A slate ground with amber type.' }, { id: 'r2', capture: 'r1-mobile', verdict: 'missed', observed: 'The cards sit in two columns.', repair: 'Set the walk list to one column below 600 pixels.' }], summary: 'One repair to the card grid.' };
  const valid = await call('culture_validate_review', { review, plan });
  assert.equal(valid.status, 'valid'); assert.match(valid.next, /capture round 2/u);
  assert.equal((await call('culture_capture', { round: 2, views: ['mobile'] })).captures[0].id, 'r2-mobile');
  const stale = await call('culture_validate_review', { review: { ...review, round: 2 }, plan });
  assert.match(stale.error.message, /r1-desktop was taken in round 1/u);
  assert.equal((await call('culture_capture', { round: 3 })).error.code, 'CAPTURE_ROUNDS_EXHAUSTED');
  assert.equal((await call('culture_capture', { views: ['tablet'] })).error.code, 'CAPTURE_INVALID');
  const dna = (await call('culture_validate_design_dna', { dna: DNA, tasteInput: INPUT, reading: READING })).dna;
  const conformance = await call('culture_check_dna_conformance', { dna, paths: ['index.html', 'styles.css'] });
  assert.equal(conformance.devices.find(device => device.id === 'dna5').status, 'present');
  assert.equal((await call('culture_check_dna_conformance', { dna, paths: ['.env'] })).error.code, 'PROJECT_SCOPE_INVALID');
  assert.equal((await call('culture_check_dna_conformance', { dna })).error.code, 'TOOL_INPUT_INVALID');
});

test('file tools refuse to run without a configured project folder, and the policy ships with the session', async () => {
  const handler = createToolHandler({ includeQlooTools: false, production: { env: { MOUSA_LIBRARY_ROOT: rootDir }, inspect: { browser: async () => ({ available: true, path: 'fake' }), image: async () => ({ available: false, reason: 'No generator in this test.' }) } } });
  const missing = (await handler('culture_capture', {})).structuredContent;
  assert.equal(missing.error.code, 'PROJECT_DIR_MISSING'); assert.match(missing.error.message, /Set MOUSA_PROJECT_DIR/u);
  assert.equal((await handler('culture_fetch_materials', { fonts: ['Jost'] })).structuredContent.error.code, 'PROJECT_DIR_MISSING');
  assert.ok(sessionInstructions().includes(PRODUCTION_POLICY_TEXT));
  assert.equal(sessionInstructions({ includeProjectTools: true, protocol: 'taste' }).includes(PRODUCTION_POLICY_TEXT), false);
  assert.equal(await fs.readFile(path.join(rootDir, 'plugin', 'skills', 'culture-grounded-design', 'production-policy.md'), 'utf8'), PRODUCTION_POLICY_TEXT);
});
