import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const cache = path.join(process.env.USERPROFILE || process.env.HOME, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node');
const require = createRequire(path.join(cache, 'package.json'));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const jobId = process.argv[2] || JSON.parse(await fs.readFile('output/live-job.json', 'utf8')).id;
const origin = 'http://127.0.0.1:8787';
const job = await (await fetch(`${origin}/api/jobs/${jobId}`)).json();
assert.equal(job.status, 'completed');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => requests.push(req.url()));
try {
  await page.goto(`${origin}/?job=${jobId}`);
  await page.locator('#baseline-frame').waitFor({ state: 'visible' });
  const frame = page.frameLocator('#baseline-frame');
  await frame.locator('#catalog .card').first().waitFor();
  assert.equal(await frame.locator('#catalog .card').count(), 6);
  await frame.locator('#catalog .card button').first().click();
  assert.equal(await frame.locator('#selection-count').textContent(), '1');
  await frame.locator('#search').fill('Tahini');
  assert.equal(await frame.locator('#catalog .card').count(), 1);
  await frame.locator('#search').fill('');
  await frame.locator('#season').selectOption({ label: 'Summer dried' });
  assert.equal(await frame.locator('#catalog .card').count(), 1);
  await frame.locator('#season').selectOption('');
  await page.locator('#tab-decisions').click();
  assert.equal(await page.locator('#decisions-count').textContent(), '8');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-download=baseline]').click();
  const download = await downloadPromise; await download.saveAs('output/generated-files.json');
  const exported = JSON.parse(await fs.readFile('output/generated-files.json', 'utf8'));
  assert.ok(exported.files['index.html']);
  // Flush a full-page capture from the top; Chromium can omit offscreen OOPIF
  // paint after native controls/downloads even when the viewport is correct.
  await page.evaluate(async () => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: 'output/studio-completed.png', fullPage: true });
  await page.goto(job.runs[0].previewUrl);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#catalog .card').first().waitFor();
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(size.scroll <= size.client + 1, `Generated site overflow at ${width}`);
    await page.screenshot({ path: `output/generated-site-${width}.png`, fullPage: true });
  }
  assert.equal(errors.length, 0);
  assert.ok(requests.every(url => ['http://127.0.0.1:8787', 'http://127.0.0.1:8788'].includes(new URL(url).origin)));
  console.log(JSON.stringify({ actualKiro: true, jobStatus: job.status, selectedCount: 1, searchAndSeasonFilters: 'passed', decisions: 8, download: 'passed', responsive: [375, 1440], pageErrors: errors, externalRequests: 0 }));
} finally { await browser.close(); }
