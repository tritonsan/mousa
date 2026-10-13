import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { checkDnaConformance } from '../plugin/server/culture/taste.mjs';
import { detectDesignSystem, checkCssVariables, mergedPages, collectProjectFiles } from '../plugin/server/design/systems.mjs';
import { buildSpecimen, keyframesRules } from '../plugin/server/design/specimen.mjs';
import { pngSize, scalePng, colorDistance } from '../plugin/server/production/image-files.mjs';
import { inspectBrowser, verifyBrowser, serveDirectory, captureViews } from '../plugin/server/production/capture.mjs';
import { loadFontLibrary, fontLibraryRoot } from '../plugin/server/production/fonts.mjs';
import { createMousaServer } from '../plugin/server/mcp/mousa.mjs';
import { createConnectionStore, plainProtector } from '../plugin/server/connections/store.mjs';
import { qlooFixture, prediction, parse, exists, png, designFor, siteFiles } from './helpers/mousa-fixtures.mjs';

const device = (id, layer, tokens) => ({ id, layer, device: `${layer} device`, tokens: { colors: [], fonts: [], css: [], ids: [], copy: [], images: [], keyframes: [], svg: [], ...tokens } });

test('the design system is read from the project: custom properties, tokens, components and Tailwind', () => {
  const site = { 'index.html': '<h1>Hi</h1>', 'about.html': '<p>About</p>', 'styles.css': ':root{--a:#111;--b:#222;--c:#333}body{color:var(--a)}' };
  assert.deepEqual(detectDesignSystem(site), { system: 'css-vars', medium: 'web', entry: 'index.html', pages: 2, customProperties: 3 });
  const app = { 'index.html': '<main></main>', 'tokens/tokens.json': '{}', 'tokens/tokens.css': ':root{--ink:#000;--paper:#fff;--accent:#f00}' };
  assert.equal(detectDesignSystem(app).medium, 'app-ui');
  assert.equal(detectDesignSystem(app).tokensFile, 'tokens/tokens.json');
  const react = { 'src/App.jsx': 'export default () => null', 'src/index.css': '@tailwind base;' };
  const detected = detectDesignSystem(react);
  assert.equal(detected.medium, 'generic');
  assert.equal(detected.system, 'tailwind');
  assert.ok(detected.notes.some(note => /Tailwind found: palette and type are checked in its theme/u.test(note)) && detected.notes.some(note => /Component sources/u.test(note)));
  assert.match(mergedPages(site)['index.html'], /About/u);
  assert.equal(mergedPages({ 'index.html': '<p>x</p>' })['index.html'], '<p>x</p>');
});

test('the project files are collected within bounds, without dependencies, records or binaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mousa-files-'));
  try {
    await mkdir(path.join(root, 'node_modules', 'x'), { recursive: true });
    await mkdir(path.join(root, '.mousa'), { recursive: true });
    await mkdir(path.join(root, 'css'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<p>home</p>');
    await writeFile(path.join(root, 'css', 'site.css'), 'body{}');
    await writeFile(path.join(root, 'node_modules', 'x', 'index.js'), 'nope');
    await writeFile(path.join(root, '.mousa', 'session.json'), '{}');
    await writeFile(path.join(root, 'logo.png'), 'binary');
    await writeFile(path.join(root, 'package.json'), '{}');
    assert.deepEqual(Object.keys(await collectProjectFiles(root)).sort(), ['css/site.css', 'index.html']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the CSS variable adapter binds palette and type to used custom properties and resolves var() values', () => {
  const dna = { devices: [
    device('dna1', 'palette', { colors: ['#a8552f', '#5e6b52', '#aabbcc'] }),
    device('dna2', 'typography', { fonts: ['Literata'] }),
    device('dna3', 'layout', { css: [{ property: 'letter-spacing', value: '.08em' }] }),
  ] };
  const files = { 'index.html': '<p class="x">Hello</p>', 'styles.css': [
    ':root{--rust:#a8552f;--accent:var(--rust);--moss:#5e6b52;--mist:#abc;--tracking:.08em;--reading:"Literata", Georgia, serif}',
    'body{color:var(--accent);font-family:var(--reading);background:var(--mist)}',
    '.x{letter-spacing:var(--tracking)}',
  ].join('') };
  const base = checkDnaConformance(dna, files);
  assert.equal(base.devices.find(item => item.id === 'dna3').status, 'missing', 'the literal check alone misses a value written through var()');
  const report = checkCssVariables(dna, files, base);
  const palette = report.devices.find(item => item.id === 'dna1');
  assert.equal(palette.status, 'partial');
  assert.deepEqual(palette.missing.map(item => [item.kind, item.value]), [['variable', '#5e6b52']], 'the moss value is declared but nothing uses it');
  assert.match(palette.missing[0].detail, /--moss holds it but nothing uses it/u);
  assert.equal(report.devices.find(item => item.id === 'dna2').status, 'present');
  assert.equal(report.devices.find(item => item.id === 'dna3').status, 'present');
  const bindings = Object.fromEntries(report.system.bindings.map(item => [item.value, item.property ?? item.declaredAs]));
  assert.equal(bindings['#a8552f'], '--rust', 'a value reached through another custom property counts as used');
  assert.equal(bindings['#aabbcc'], '--mist', '#abc holds #aabbcc');
  assert.equal(bindings.Literata, '--reading');
  assert.deepEqual(bindings['#5e6b52'], ['--moss']);
  assert.equal(report.system.name, 'css-vars');
  assert.match(report.limitation, /custom propert/u);
});

test('a theme override keeps the light value bound, and both values of a themed property count', () => {
  const dna = { devices: [device('dna1', 'palette', { colors: ['#3e5c6b', '#0e1a20'] })] };
  const files = { 'index.html': '<p>Hi</p>', 'styles.css': ':root{--mist:#3e5c6b;--a:#111;--b:#222}[data-theme="dark"]{--mist:#0e1a20}body{color:var(--mist)}' };
  const report = checkCssVariables(dna, files, checkDnaConformance(dna, files));
  assert.equal(report.devices[0].status, 'present');
  assert.deepEqual(report.system.bindings.map(item => [item.value, item.property]), [['#3e5c6b', '--mist'], ['#0e1a20', '--mist']]);
});

test('the specimen board draws the DNA with its fonts, keyframes, drawings, pictures and lines', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mousa-specimen-'));
  const out = await mkdtemp(path.join(os.tmpdir(), 'mousa-specimen-out-'));
  try {
    await mkdir(path.join(root, 'generated'), { recursive: true });
    await writeFile(path.join(root, 'generated', 'dna4-1.png'), png(4, 4, ['#3e5c6b']));
    const svg = `<svg id="terrace" viewBox="0 0 10 10">${'<rect x="1" y="1" width="2" height="2"/>'.repeat(8)}<script>alert(1)</script></svg>`;
    const files = { 'index.html': `<main>${svg}</main>`, 'styles.css': '@keyframes mist-drift{from{transform:translateX(0)}50%{transform:translateX(4px)}to{transform:none}}.x{color:red}' };
    const library = await loadFontLibrary(await fontLibraryRoot());
    const dna = { thesis: 'A misty hillside pantry.', devices: [
      device('dna1', 'palette', { colors: ['#3e5c6b', '#8fb0a9'] }), device('dna2', 'typography', { fonts: ['Jost'] }),
      device('dna3', 'motion', { keyframes: ['mist-drift'], css: [{ property: 'animation', value: 'mist-drift 40s ease-in-out infinite' }] }),
      device('dna4', 'imagery', { svg: ['terrace'], images: ['generated/dna4-1.png'] }), device('dna5', 'voice', { copy: ['The street turns blue at six.', 'Take your time.'] }),
      device('dna6', 'structure', { ids: ['week-strip'] }),
    ] };
    const made = await buildSpecimen({ dna, library, root, files, outDir: out });
    assert.deepEqual(made.fonts, ['Jost']);
    assert.deepEqual(made.pictures, ['generated/dna4-1.png']);
    assert.deepEqual(made.drawings, ['terrace']);
    const html = await readFile(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /@font-face\{font-family:'Jost';src:url\('fonts\/jost-/u);
    assert.match(html, /@keyframes mist-drift\{from\{transform:translateX\(0\)\}50%/u);
    assert.match(html, /animation:mist-drift 40s ease-in-out infinite/u);
    assert.match(html, /#3e5c6b/u);
    assert.match(html, /The street turns blue at six\./u);
    assert.match(html, /#week-strip/u);
    assert.ok(!/<script>alert/u.test(html), 'scripts inside a drawing are left out');
    assert.ok(await exists(path.join(out, 'pictures', 'generated-dna4-1.png')));
    assert.deepEqual([...keyframesRules('@keyframes a{0%{x:1}100%{x:2}} @keyframes b{to{y:1}}').keys()], ['a', 'b']);
  } finally { await rm(root, { recursive: true, force: true }); await rm(out, { recursive: true, force: true }); }
});

test('captures for a model are scaled to fit, and colours are compared in CIE Lab', () => {
  const wide = png(2000, 20, ['#ff0000', '#0000ff']);
  assert.deepEqual(pngSize(scalePng(wide, 1568)), { width: 1568, height: 16 });
  const small = png(10, 10, ['#00ff00']);
  assert.equal(scalePng(small, 1568), small);
  assert.ok(colorDistance('#3e5c6b', '#3e5c6b') < 0.001);
  assert.ok(colorDistance('#3e5c6b', '#f3ead8') > 50);
});

test('the design stages run end to end: reading, DNA, plan, fonts, pictures, check, captures and review', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-design-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-design-config-'));
  const { fetchImpl, requests } = qlooFixture();
  const captured = [];
  const fakeCapture = async ({ views, outDir, prefix, full }) => {
    const shots = [];
    for (const view of views) {
      const id = `${prefix}-${view.id}${full ? '-full' : ''}`, file = path.join(outDir, `${id}.png`);
      await writeFile(file, png(view.width, Math.min(view.height, 40), ['#3e5c6b', '#8fb0a9']));
      shots.push({ id, view: view.id, ...(full ? { full: true } : {}), width: view.width, height: Math.min(view.height, 40), bytes: 1, file });
    }
    captured.push(prefix);
    return shots;
  };
  const fakeGenerate = async ({ directory, name }) => {
    await writeFile(path.join(directory, `${name}.png`), png(64, 64, ['#3e5c6b', '#8fb0a9']));
    return { path: `generated/${name}.png`, format: 'png', width: 64, height: 64, bytes: 1, durationMs: 1 };
  };
  const server = createMousaServer({ env: { MOUSA_PROJECT_DIR: project, QLOO_API_KEY: 'fixture-key-123', MOUSA_HOST: 'codex' }, fetchImpl, capture: fakeCapture, generate: fakeGenerate,
    store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: true, label: 'Test browser' }), codex: async () => ({ available: false, reason: 'Not in tests.' }) } });
  const call = async (name, args) => parse(await server.callTool(name, args));
  try {
    assert.equal((await call('design_validate', { stage: 'reading', artifact: {} })).error.code, 'STAGE_MISSING');
    await call('taste_profile', { dryRun: true, medium: 'web', references: [{ name: 'Paterson' }, { name: 'Nujabes' }] });
    assert.equal((await call('design_validate', { stage: 'prediction', artifact: prediction() })).status, 'frozen');
    assert.equal((await call('taste_profile', {})).status, 'ok');
    const input = JSON.parse(await readFile(path.join(project, '.mousa', 'taste', 'input.json'), 'utf8'));
    const { reading, dna, plan } = designFor(input);

    const read = await call('design_validate', { stage: 'reading', artifact: reading });
    assert.equal(read.status, 'valid', JSON.stringify(read));
    assert.equal(read.medium, 'web', 'an empty project takes the recipe\'s medium');
    const specified = await call('design_validate', { stage: 'dna', artifact: dna });
    assert.equal(specified.status, 'valid', JSON.stringify(specified));
    assert.ok(specified.methods.palette.includes('css-palette') && specified.methods.imagery.includes('generated-image'));
    assert.deepEqual(specified.pictures, { perRun: 4, provider: 'host-tool' });
    assert.equal((await call('design_validate', { stage: 'reading', artifact: reading })).error.code, 'STAGE_FROZEN');
    const planned = await call('design_validate', { stage: 'plan', artifact: plan });
    assert.equal(planned.status, 'valid', JSON.stringify(planned));
    assert.deepEqual(planned.fonts, ['Jost']);
    assert.equal((await call('design_validate', { stage: 'dna', artifact: dna })).error.code, 'STAGE_FROZEN');

    const found = await call('materials', { action: 'find', words: ['geometric'] });
    assert.equal(found.families[0].family, 'Jost');
    assert.equal((await call('materials', { action: 'fetch', fonts: ['Literata'] })).error.code, 'MATERIAL_NOT_PLANNED');
    const fetched = await call('materials', { action: 'fetch', fonts: ['Jost'] });
    assert.ok(fetched.fontFace.every(rule => rule.includes("font-family:'Jost'") && rule.includes("url('fonts/jost-")));
    assert.ok(await exists(path.join(project, fetched.families[0].files[0])));
    // The rules' URLs are written from the stylesheet named, and a folder a build serves as it is loads from the root.
    const nested = await call('materials', { action: 'fetch', fonts: ['Jost'], stylesheet: 'src/style.css' });
    assert.ok(nested.fontFace.every(rule => rule.includes("url('../fonts/jost-")), nested.fontFace[0]);
    const served = await call('materials', { action: 'fetch', fonts: ['Jost'], directory: 'public/fonts', stylesheet: 'src/style.css' });
    assert.ok(served.fontFace.every(rule => rule.includes("url('/fonts/jost-")), served.fontFace[0]);
    assert.match(served.note, /serves this folder from its root/u);
    assert.ok(await exists(path.join(project, 'public', 'fonts', path.basename(fetched.families[0].files[0]))));

    const named = await call('image', { action: 'prompt', device: 'dna4', subject: 'A still from Perfect Days on a misty street', aspect: 'landscape' });
    assert.equal(named.error.code, 'IMAGE_REQUEST_INVALID');
    assert.match(named.error.message, /without naming taste entities \(Perfect Days\)/u);
    const brief = await call('image', { action: 'prompt', device: 'dna4', subject: 'Stepped stone terraces under low mist at dawn', aspect: 'landscape' });
    assert.equal(brief.status, 'requested');
    assert.equal(brief.saveAs, 'generated/dna4-1.png');
    assert.match(brief.brief, /^Subject: Stepped stone terraces/u);
    assert.match(brief.brief, /#3e5c6b/u);
    assert.match(brief.how, /image generation tool/u);
    assert.equal((await call('image', { action: 'register', device: 'dna4', path: 'generated/dna4-1.png' })).error.code, 'IMAGE_MISSING');
    await mkdir(path.join(project, 'generated'), { recursive: true });
    await writeFile(path.join(project, 'generated', 'dna4-1.png'), png(64, 64, ['#3e5c6b', '#8fb0a9']));
    const registered = await call('image', { action: 'register', device: 'dna4', path: 'generated/dna4-1.png' });
    assert.equal(registered.status, 'registered');
    assert.equal(registered.palette.fits, true);
    const generated = await call('image', { action: 'generate', device: 'dna4', subject: 'A jar of preserves on a misty stone step', aspect: 'square' });
    assert.equal(generated.status, 'generated');
    assert.equal(generated.path, 'generated/dna4-2.png');
    assert.equal((await call('image', { action: 'prompt', device: 'dna4', subject: 'A third picture the plan did not ask for' })).error.code, 'IMAGE_NOT_PLANNED');
    assert.equal((await call('image', { action: 'prompt', device: 'dna1', subject: 'A picture for the palette device' })).error.code, 'IMAGE_NOT_PLANNED');

    for (const [name, content] of Object.entries(siteFiles(fetched.fontFace))) await writeFile(path.join(project, name), content);
    const checked = await call('design_check', {});
    assert.equal(checked.system, 'css-vars');
    assert.deepEqual(checked.devices.filter(item => item.status !== 'present'), [], JSON.stringify(checked.devices));
    assert.equal(checked.score, 1);
    assert.ok(checked.bindings.some(item => item.value === '#3e5c6b' && item.property === '--mist'));
    assert.ok(checked.bindings.some(item => item.value === 'Jost' && item.property === '--text-font'));
    assert.deepEqual(checked.style.atStart, { stylesheets: [], handWritten: 0, classes: 0 }, 'the project as the prediction found it: empty');
    assert.ok(checked.style.now.handWritten > 0);
    assert.ok(!(checked.notes || []).some(note => /bypasses its classes/u.test(note)), 'a new design in an empty folder has no way of styling to keep');

    const shots = await server.callTool('design_capture', {});
    assert.ok(!('structuredContent' in shots), 'no structuredContent, so Codex keeps the pictures');
    assert.deepEqual(shots.content.filter(item => item.type === 'image').length, 2);
    assert.equal(shots.content[0].mimeType, 'image/png');
    const capture = parse(shots);
    assert.deepEqual(capture.captures.map(item => item.id), ['r1-desktop', 'r1-mobile']);
    const board = parse(await server.callTool('design_capture', { specimen: true }));
    assert.deepEqual(board.captures.map(item => item.id), ['r1-specimen-board-full']);
    assert.ok(await exists(path.join(project, '.mousa', 'captures', 'r1-specimen-board-full.png')));
    assert.deepEqual(captured, ['r1', 'r1-specimen']);

    const review = await call('design_validate', { stage: 'review', artifact: { schemaVersion: '1.0', round: 1, criteria: [
      { id: 'r1', capture: 'r1-desktop', verdict: 'met', observed: 'The first screen is mist blue on sea glass, with no white ground.' },
      { id: 'r2', capture: 'r1-mobile', verdict: 'partly', observed: 'The headline wraps onto two lines at phone width.', repair: 'Shorten the headline size at phone width.' },
    ], summary: 'The palette lands; the headline needs a smaller size on phones.' } });
    assert.equal(review.status, 'valid', JSON.stringify(review));
    assert.equal(review.audited, true, 'captures returned in the result count as seen');
    assert.match(review.next, /round 2/u);
    const status = await call('mousa_status', {});
    assert.equal(status.stage, 'reviewed');
    assert.equal(status.designSystem.system, 'css-vars');

    // A new session starts clean: the earlier stages, captures and pictures move to the history.
    const fresh = await call('design_validate', { stage: 'prediction', artifact: prediction(), restart: true });
    assert.equal(fresh.status, 'frozen');
    for (const record of ['design/reading.json', 'design/dna.json', 'design/plan.json', 'design/reviews.json', 'captures.json', 'images.json']) {
      assert.ok(!(await exists(path.join(project, '.mousa', ...record.split('/')))), `${record} left the session`);
      assert.ok(await exists(path.join(project, ...fresh.archived.split('/'), ...record.split('/'))), `${record} is kept in the history`);
    }
    assert.ok(await exists(path.join(project, ...fresh.archived.split('/'), 'design', 'start.json')), 'the earlier session\'s starting point is kept');
    assert.ok(JSON.parse(await readFile(path.join(project, '.mousa', 'design', 'start.json'), 'utf8')).handWritten > 0, 'the new session starts from the project as it is now');
    const sent = requests.length;
    assert.equal((await call('taste_profile', {})).status, 'ok');
    assert.equal(requests.length, sent, 'the same audience is measured again from the cache');
    assert.equal((await call('design_validate', { stage: 'reading', artifact: reading })).status, 'valid', 'the new session reads without revise');

    await mkdir(path.join(project, 'a'), { recursive: true });
    await mkdir(path.join(project, 'b'), { recursive: true });
    await writeFile(path.join(project, 'a', 'index.html'), '<style>body{color:#111;font-family:Jost}</style><section id="x"></section>');
    await writeFile(path.join(project, 'b', 'index.html'), '<style>body{color:#f3ead8;font-family:"Courier Prime"}</style><section id="y"></section>');
    const compared = await call('design_compare', { a: 'a', b: 'b' });
    assert.ok(compared.distance.overall > 0, JSON.stringify(compared.distance));
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('an installed browser captures the specimen board as the agent would see it', async t => {
  const browser = await verifyBrowser(await inspectBrowser());
  if (!browser.available) { t.skip(`No usable browser: ${browser.reason}`); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'mousa-specimen-real-'));
  const out = await mkdtemp(path.join(os.tmpdir(), 'mousa-specimen-shots-'));
  try {
    const dna = { thesis: 'A misty hillside pantry.', devices: [device('dna1', 'palette', { colors: ['#3e5c6b', '#8fb0a9'] }), device('dna2', 'typography', { fonts: ['Jost'] }), device('dna3', 'voice', { copy: ['The street turns blue at six.'] })] };
    await buildSpecimen({ dna, library: await loadFontLibrary(await fontLibraryRoot()), root, files: {}, outDir: root });
    const served = await serveDirectory(root, { entry: 'index.html' });
    try {
      const [shot] = await captureViews({ browser, baseUrl: served.url, entry: 'index.html', views: [{ id: 'board', width: 1440, height: 900 }], full: true, outDir: out, prefix: 'r1-specimen' });
      assert.equal(shot.id, 'r1-specimen-board-full');
      assert.equal(shot.width, 1440);
      assert.ok(shot.height >= 300);
    } finally { await served.close(); }
  } finally { await rm(root, { recursive: true, force: true }); await rm(out, { recursive: true, force: true }); }
});
