// The site's own pages and the Studio keep out of the look models default to, as the designs they show are asked to:
// the engine's own check, reading each page with the stylesheets the browser applies to it in the order it loads them,
// finds none of the house-style signatures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { houseStyleSignatures } from '../plugin/server/design/house-style.mjs';
import { REPORT_CSS } from '../plugin/server/design/report.mjs';
import { landingPage, galleryPage } from '../src/site/render.mjs';
import { judgesPage, qlooPage, benchmarkPage, showcasePage, SHOWCASE_ID } from '../src/site/judge-pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFile(path.join(root, file), 'utf8');
const ids = files => houseStyleSignatures(files).map(item => item.id);
const repository = 'https://github.com/tritonsan/mousa';

const record = (works, known) => ({ kind: 'comparison', prediction: { frozenAt: 'T1', groups: [] }, measured: { counts: { works, worksPredicted: known, predictions: 28, predictionsMeasured: known } } });
function gallery() {
  const items = [
    { id: 'try-one', kind: 'comparison', host: 'kiro', medium: 'web', title: 'A record shop', origin: 'try', record: record(69, 1), distance: { overall: 0.6 },
      houseStyle: [{ label: 'With Qloo', count: 0, of: 12 }, { label: 'Without Qloo', count: 1, of: 12 }] },
    { id: SHOWCASE_ID, kind: 'comparison', host: 'claude-code', medium: 'web', title: 'Moûsa, for the jury', record: record(70, 2),
      play: [{ label: 'With Qloo', path: 'out/with-qloo/index.html' }, { label: 'Without Qloo', path: 'out/without-qloo/index.html' }] },
  ];
  return { index: { featured: 'try-one', entries: items.map(({ record: _, ...entry }) => entry) }, entries: new Map(items.map(item => [item.id, item])) };
}

test('the site\'s pages carry none of the looks models default to', async () => {
  const styles = { 'report.css': REPORT_CSS, 'site/site.css': await read('web/site/site.css'), 'brand.css': await read('web/brand.css') };
  const pages = { landing: landingPage({ gallery: gallery(), repository }), gallery: galleryPage({ gallery: gallery() }), judges: judgesPage({ gallery: gallery(), repository }),
    qloo: qlooPage({ repository }), benchmark: benchmarkPage({ repository }), showcase: showcasePage({ gallery: gallery(), previewBase: 'https://preview.example' }) };
  for (const [name, html] of Object.entries(pages)) assert.deepEqual(ids({ 'index.html': html, ...styles }), [], name);
  // The report's styles alone set a stock display serif, which the check finds: the site's own styles are what leave it.
  assert.ok(ids({ 'index.html': pages.landing, 'report.css': REPORT_CSS }).includes('stock-display-serif'));
});

test('the Studio carries none of them either', async () => {
  assert.deepEqual(ids({ 'index.html': await read('web/index.html'), 'styles.css': await read('web/styles.css'), 'brand.css': await read('web/brand.css') }), []);
});
