// The look models give a page when nothing else decides it, read from a design's own files: each signature is found
// where it is written and said where, the near misses are not taken for it, and a page may keep at most two.
import test from 'node:test';
import assert from 'node:assert/strict';
import { houseStyleSignatures, houseStyleReport, HOUSE_STYLE, HOUSE_STYLE_LIMIT } from '../plugin/server/design/house-style.mjs';

const ids = files => houseStyleSignatures(files).map(item => item.id);

// The showcase's Qloo arm of 23 October 2026, reduced to the habits it carried.
const EDITORIAL = {
  'index.html': `<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body>
<p class="kicker">An entry to the hackathon</p><h1>Design from what it <em>actually</em> loves.</h1>
<section><p class="num">01 · The blind spot</p><p class="num">02 · The benchmark</p><p class="num">03 · The mechanism</p></section>
<a class="btn" href="#">Open the live site</a></body></html>`,
  'styles.css': `:root{--paper:#ece4d6;--ink:#241f1b;--font-display:'Instrument Serif',serif;--mono:'Courier Prime',monospace}
body{background:var(--paper);color:var(--ink);font-family:'Libre Franklin',sans-serif}
h1,h2,h3{font-family:var(--font-display);font-weight:400}
.kicker{font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em;font-size:.75rem}
.kicker::before{content:"";display:inline-block;width:2.2rem;height:1px;background:currentColor}
.btn{border-radius:999px;padding:.8rem 1.4rem}
@media (max-width:600px){h1{font-size:2.4rem}}`,
};

test('the editorial habits are each found, with where they are written', () => {
  const found = houseStyleSignatures(EDITORIAL);
  assert.deepEqual(found.map(item => item.id), ['cream-ground', 'stock-display-serif', 'mono-kicker', 'italic-accent', 'numbered-sections', 'pill-buttons', 'hairline-kicker']);
  const evidence = Object.fromEntries(found.map(item => [item.id, item.evidence]));
  assert.equal(evidence['cream-ground'], 'body background: #ece4d6', 'a ground set through a custom property is resolved');
  assert.equal(evidence['stock-display-serif'], 'h1,h2,h3 in instrument serif');
  assert.match(evidence['mono-kicker'], /^\.kicker: uppercase courier prime, letter-spacing \.08em$/u);
  assert.match(evidence['italic-accent'], /sets “actually” apart/u);
  assert.equal(evidence['numbered-sections'], 'the page numbers its parts 01, 02, 03');
  assert.equal(evidence['pill-buttons'], '.btn border-radius: 999px');
  assert.match(evidence['hairline-kicker'], /^\.kicker::before: 35\.2px rule$/u);
  for (const item of found) assert.equal(item.label, HOUSE_STYLE.find(entry => entry.id === item.id).label);
  const report = houseStyleReport(EDITORIAL);
  assert.deepEqual([report.count, report.limit, report.over], [7, HOUSE_STYLE_LIMIT, true]);
});

test('the other pole: violet gradients, frosted glass, one neutral sans and emoji icons', () => {
  const files = {
    'index.html': '<main><h1>Ship faster</h1><ul><li>🚀 Fast</li><li>🔒 Secure</li><li>✨ Delightful</li></ul></main>',
    'app.css': `body{font-family:Inter,system-ui,sans-serif;background:#fff}
.hero{background:linear-gradient(135deg,#7c3aed,#4f46e5)}
.card{backdrop-filter:blur(12px);background:rgba(255,255,255,.12)}`,
  };
  assert.deepEqual(ids(files), ['violet-gradient', 'frosted-glass', 'neutral-sans-only', 'emoji-icons']);
});

test('near misses are not taken for the habits', () => {
  const files = {
    'index.html': `<h1><i class="fa fa-star"></i> Opening hours</h1><p>Doors 09:30, close 01:00. Since 2026-01-05.</p><p>Track 07 of 12</p>
<p>© 2026 Shop ™ ↗</p><button class="btn">Book</button>`,
    'styles.css': `body{background:#ffffff;font-family:'Alegreya Sans',sans-serif}h1{font-family:'Big Shoulders Display',sans-serif}
.btn{border-radius:8px}.label{text-transform:uppercase;letter-spacing:.2em;font-family:'Big Shoulders Display'}
.rule::before{content:"";width:240px;height:1px}.hero{background:linear-gradient(#0d1b2a,#e0a458)}
@keyframes drift{from{background:#ece4d6}to{background:#f7f2e8}}`,
  };
  assert.deepEqual(ids(files), [], JSON.stringify(houseStyleSignatures(files)));
  assert.deepEqual(houseStyleReport(files), { signatures: [], count: 0, limit: 2, over: false });
});

test('a page with two habits is within the limit, and grounds set on html or :root count', () => {
  const files = { 'index.html': '<h1>Hello</h1>', 'site.css': 'html{background-color:#f7f2e8}:root{--x:1}h2{font:italic 400 2rem/1.1 "Fraunces", serif}' };
  assert.deepEqual(ids(files), ['cream-ground', 'stock-display-serif'], 'the family is read from the font shorthand too');
  assert.equal(houseStyleReport(files).over, false);
  assert.deepEqual(ids({ 'index.html': '<ol style="list-style:decimal-leading-zero"></ol>', 'a.css': 'ol{list-style:decimal-leading-zero}' }), ['numbered-sections']);
});

test('design_check reports the default look, a review is refused over the limit, and the report shows what the page kept', async () => {
  const os = await import('node:os'), path = await import('node:path'), fs = await import('node:fs/promises');
  const { qlooFixture, prediction, parse, png, designFor, byName, siteFiles, critiqueFor, reportServer, PLAN } = await import('./helpers/mousa-fixtures.mjs');
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-house-')), config = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-house-config-'));
  const { fetchImpl } = qlooFixture();
  const server = reportServer(project, config, fetchImpl);
  const call = async (name, args) => parse(await server.callTool(name, args));
  try {
    await call('taste_profile', PLAN);
    assert.equal((await call('design_validate', { stage: 'prediction', artifact: prediction() })).status, 'frozen');
    assert.equal((await call('taste_profile', {})).status, 'ok');
    const input = JSON.parse(await fs.readFile(path.join(project, '.mousa', 'taste', 'input.json'), 'utf8'));
    const { reading, dna, plan } = designFor(input);
    for (const [stage, artifact] of [['reading', byName(reading, input)], ['dna', byName(dna, input)], ['plan', plan]]) assert.equal((await call('design_validate', { stage, artifact })).status, 'valid');
    const fetched = await call('materials', { action: 'fetch', fonts: ['Jost'] });
    await call('image', { action: 'prompt', device: 'dna4', subject: 'Stepped stone terraces under low mist at dawn', aspect: 'landscape' });
    await fs.mkdir(path.join(project, 'generated'), { recursive: true });
    await fs.writeFile(path.join(project, 'generated', 'dna4-1.png'), png(64, 64, ['#3e5c6b', '#8fb0a9']));
    assert.equal((await call('image', { action: 'register', device: 'dna4', path: 'generated/dna4-1.png' })).status, 'registered');
    const site = siteFiles(fetched.fontFace);
    // The fixture site with four of the habits laid over it.
    const laden = { ...site, 'styles.css': `${site['styles.css']}\nbody{background:#ece4d6}h2{font-family:'Instrument Serif',serif}.kicker{font-family:'Courier Prime',monospace;text-transform:uppercase;letter-spacing:.1em}`,
      'index.html': site['index.html'].replace('<main>', '<main><p class="kicker">Open late</p><h2>Night <em>shelves</em></h2>') };
    for (const [name, content] of Object.entries(laden)) await fs.writeFile(path.join(project, name), content);
    const checked = await call('design_check', {});
    assert.deepEqual(checked.houseStyle.found.map(item => item.id), ['cream-ground', 'stock-display-serif', 'mono-kicker', 'italic-accent']);
    assert.deepEqual([checked.houseStyle.count, checked.houseStyle.limit, checked.houseStyle.over], [4, 2, true]);
    assert.match(checked.next, /^Keep at most 2 of the default-look signatures found \(houseStyle\)/u);
    await call('design_capture', {});
    const artifact = { schemaVersion: '1.0', round: 1, criteria: [
      { id: 'r1', capture: 'r1-desktop', verdict: 'met', observed: 'The first screen is mist blue on sea glass, with no white ground.' },
      { id: 'r2', capture: 'r1-mobile', verdict: 'met', observed: 'The headline sits on one short line at phone width.' },
    ], summary: 'Both criteria hold on this round\'s captures.', critique: critiqueFor(input) };
    const refused = await call('design_validate', { stage: 'review', artifact });
    assert.equal(refused.error.code, 'HOUSE_STYLE');
    assert.match(refused.error.message, /carries 4 signatures of the look models default to/u);
    // Back within the limit, the review takes its critique.
    for (const [name, content] of Object.entries(site)) await fs.writeFile(path.join(project, name), content);
    assert.equal((await call('design_check', {})).houseStyle.count, 0);
    const reviewed = await call('design_validate', { stage: 'review', artifact });
    assert.equal(reviewed.status, 'valid', JSON.stringify(reviewed));
    assert.deepEqual([reviewed.stats.replaced, reviewed.stats.fan], [3, 'partly']);
    assert.match(reviewed.next, /replace the generic choices you marked replaced, then design_capture with round 2/u);
    const report = await call('design_report', { picture: false });
    const record = JSON.parse(await fs.readFile(path.join(project, ...report.record.split('/')), 'utf8'));
    assert.deepEqual(record.houseStyle, { signatures: [], count: 0, of: HOUSE_STYLE.length, limit: 2 });
    assert.equal(record.reviews.at(-1).critique.fan.verdict, 'partly');
    assert.equal(record.reviews.at(-1).critique.generic.length, 3);
    assert.equal(record.reading.clusters[0].conventions.length, 2);
    assert.match(record.dna.devices.find(device => device.layer === 'palette').convention, /^Long-lens landscape stills/u);
  } finally {
    await fs.rm(project, { recursive: true, force: true }); await fs.rm(config, { recursive: true, force: true });
  }
});

test('the night pole: a near-black ground lit by one warm amber lamp, and its near misses', () => {
  assert.deepEqual(ids({ 'index.html': '<h1>Doors at seven</h1>', 'styles.css': ':root{--night:#120f0c;--lamp:#d9822b}body{background:var(--night);color:#e8dcc8}a{color:var(--lamp)}' }), ['lamp-dark']);
  assert.match(houseStyleSignatures({ 'a.css': 'html{background-color:#0d0b0a}.cta{border:1px solid #ffb300}' })[0].evidence, /^html #0d0b0a lit by #ffb300$/u);
  // A dark page lit in another colour, and a lamp on a light page, are not it.
  assert.deepEqual(ids({ 'a.css': 'body{background:#101418}a{color:#5aa9e6}' }), []);
  assert.deepEqual(ids({ 'a.css': 'body{background:#f4f4f4}a{color:#d9822b}' }), []);
});
