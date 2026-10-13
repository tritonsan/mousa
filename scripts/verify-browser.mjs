import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const cache = path.join(process.env.USERPROFILE || process.env.HOME, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node');
const require = createRequire(path.join(cache, 'package.json'));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const executablePath = process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const origin = process.env.STUDIO_URL || 'http://127.0.0.1:8787';
await fs.mkdir('output', { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin);
  await page.locator('.template-button').first().waitFor({ state: 'visible', timeout: 10000 }).catch(async () => {
    await page.locator('#template-grid button').first().waitFor({ state: 'visible' });
  });
  assert.equal(await page.locator('#template-grid button').count(), 6);
  await page.waitForFunction(() => document.querySelector('#kiro-state').textContent === 'Connected');
  assert.equal(await page.locator('input[value=compare]').isDisabled(), true);
  assert.equal(await page.locator('input[value=qloo]').isDisabled(), true);
  assert.equal(await page.locator('#start-button').isEnabled(), true);
  for (const width of [375, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(sizes.scroll <= sizes.client + 1, `Horizontal overflow at ${width}`);
    await page.screenshot({ path: `output/studio-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const frame = page.frameLocator('#starter-frame');
  await frame.locator('button').first().waitFor();
  const buttons = await frame.locator('button').allTextContents();
  console.log(JSON.stringify({ templates: 6, responsiveWidths: [375, 800, 1440], starterButtons: buttons, errors }));
  assert.equal(errors.length, 0);
  if (process.argv.includes('--generate')) {
    // Explicit flag only: this is a real account-backed model invocation, never a default QA side effect.
    await page.locator('#brief').fill('Create a simple but distinctive English-language website for a local food seller. Preserve the existing products, search and product selection. The brand is a neighborhood producer; make seasonality, craft and origin visible. Use responsive layouts, expressive typography and original CSS or SVG illustrations. Do not invent reviews or sales figures.');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/jobs') && response.request().method() === 'POST');
    await page.locator('#start-button').click();
    const response = await responsePromise; assert.equal(response.status(), 202);
    const job = await response.json();
    await fs.writeFile('output/live-job.json', JSON.stringify(job, null, 2));
    await page.waitForFunction(() => document.querySelector('#cancel-button').hidden === false);
    await page.screenshot({ path: 'output/studio-live-start.png', fullPage: true });
    console.log(JSON.stringify({ liveJob: job.id, restoredUrl: page.url() }));
  }
} finally { await browser.close(); }
