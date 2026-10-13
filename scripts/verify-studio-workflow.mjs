import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compileCultureBrief } from '../plugin/server/culture/brief.mjs';
import { findHtmlTarget } from '../src/design-artifacts.mjs';
const require = createRequire(path.join(process.env.USERPROFILE || process.env.HOME, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'));
const { chromium } = require('playwright');
const saved = JSON.parse(await fs.readFile('output/workflow-live.json', 'utf8'));
const origin = process.env.STUDIO_URL || 'http://127.0.0.1:8787';
const build = await (await fetch(origin + '/api/jobs/' + saved.buildJobId)).json();
assert.equal(build.status, 'completed');
const revision = await (await fetch(origin + '/api/jobs/' + saved.revisionJobId)).json();
assert.equal(revision.status, 'completed');
assert.equal(revision.parentJobId, build.id);
const parentFiles = (await (await fetch(`${origin}/api/jobs/${build.id}/runs/baseline/download`)).json()).files;
const revisedFiles = (await (await fetch(`${origin}/api/jobs/${revision.id}/runs/baseline/download`)).json()).files;
const beforeTarget = findHtmlTarget(parentFiles['index.html'], revision.targetSelector);
const afterTarget = findHtmlTarget(revisedFiles['index.html'], revision.targetSelector);
assert.equal(parentFiles['index.html'].slice(0, beforeTarget.start), revisedFiles['index.html'].slice(0, afterTarget.start));
assert.equal(parentFiles['index.html'].slice(beforeTarget.end), revisedFiles['index.html'].slice(afterTarget.end));
assert.notEqual(parentFiles['index.html'].slice(beforeTarget.start, beforeTarget.end), revisedFiles['index.html'].slice(afterTarget.start, afterTarget.end));
assert.equal(revisedFiles['app.js'], parentFiles['app.js']);
assert.ok(revisedFiles['styles.css'].startsWith(parentFiles['styles.css']));
assert.equal(revision.productBrief, build.productBrief);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], modelRequests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/jobs')) modelRequests.push(req.url()); });
try {
  await page.goto(origin + '/?job=' + saved.planJobId);
  await page.locator('.direction-card').first().waitFor();
  assert.equal(await page.locator('.direction-card').count(), 3);
  assert.equal(await page.locator('.audience-editor').count(), 2);
  await page.locator('.direction-card button').first().click();
  assert.equal(await page.locator('#selected-direction-note').isVisible(), true);
  for (const width of [375, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(size.scroll <= size.client + 1, `Plan overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-workspace').click();
  const downloaded = await downloadPromise; await downloaded.saveAs('output/workflow-export.json');
  const exported = JSON.parse(await fs.readFile('output/workflow-export.json', 'utf8'));
  assert.equal(exported.context.audiences.length, 2);
  const compiled = compileCultureBrief(exported.context);
  assert.equal(compiled.status, 'compiled');
  await page.locator('#workspace-import-file').setInputFiles('output/workflow-export.json');
  assert.equal(await page.locator('.audience-editor').count(), 2);
  await page.goto(origin + '/?job=' + saved.buildJobId);
  await page.locator('#baseline-frame').waitFor({ state: 'visible' });
  const frame = page.frameLocator('#baseline-frame');
  await frame.locator('#catalog .card').first().waitFor();
  assert.equal(await frame.locator('#catalog .card').count(), 6);
  await frame.locator('#catalog .card button').first().click();
  assert.equal(await frame.locator('#selection-count').textContent(), '1');
  await frame.locator('#search').fill('Tahini');
  assert.equal(await frame.locator('#catalog .card').count(), 1);
  await frame.locator('#search').fill('');
  await page.locator('#inspect-toggle').click();
  await frame.locator('#intro-section h1').click();
  await page.waitForFunction(() => document.querySelector('#revision-target').value === '#intro-section');
  assert.ok(await page.locator('.inspector-decision').count() > 0);
  const inspected = await page.locator('#inspector-selection').textContent();
  await page.evaluate(() => window.postMessage({ type: 'culture-inspector:select', nonce: 'a'.repeat(32), selector: '#forged', tag: 'section', text: 'forged message' }, '*'));
  assert.equal(await page.locator('#inspector-selection').textContent(), inspected);
  await page.locator('#inspect-toggle').click();
  await page.locator('#tab-diff').click();
  assert.ok(await page.locator('.diff-file').count() >= 2);
  await page.locator('#diff-content .diff-file').first().locator('summary').click();
  await page.goto(origin + '/?job=' + saved.revisionJobId);
  await page.frameLocator('#baseline-frame').locator('#catalog .card').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.variant-card').length === 2);
  assert.equal(await page.locator('#brief').inputValue(), build.productBrief);
  assert.equal(await page.locator('#revision-brief').inputValue(), revision.revisionRequest);
  assert.equal(await page.locator('#production-audience').inputValue(), revision.audienceId);
  // The latest completed revision is first; retain all files when accepting
  // or returning to an earlier variant. These clicks make no model calls.
  for (const index of [0, 1, 0]) {
    const card = page.locator('.variant-card').nth(index);
    if (!(await card.getAttribute('class')).includes('selected')) await card.getByRole('button', { name: 'Select this variant', exact: true }).click();
    await page.waitForFunction(i => document.querySelectorAll('.variant-card')[i].classList.contains('selected'), index);
    const current = await (await fetch(`${origin}/api/workspaces/${saved.workspaceId}`)).json();
    assert.equal((current.workspace || current).selectedVariant.jobId, index === 0 ? revision.id : build.id);
  }
  const revisedFrame = page.frameLocator('#baseline-frame');
  await revisedFrame.locator('#catalog .card button').first().click();
  assert.equal(await revisedFrame.locator('#selection-count').textContent(), '1');
  await revisedFrame.locator('#search').fill('Tahini');
  assert.equal(await revisedFrame.locator('#catalog .card').count(), 1);
  await revisedFrame.locator('#search').fill('');
  await page.locator('#inspect-toggle').click();
  await revisedFrame.locator('#intro-section h1').click();
  await page.waitForFunction(() => document.querySelector('#revision-target').value === '#intro-section');
  assert.ok(await page.locator('.inspector-decision').count() > 0);
  await page.locator('#inspect-toggle').click();
  // Reload before capture to let Chromium paint the preview iframe before
  // interactions scroll it outside the visible viewport.
  await page.goto(origin + '/?job=' + saved.revisionJobId);
  await page.frameLocator('#baseline-frame').locator('#catalog .card').first().waitFor();
  await page.setViewportSize({ width: 1440, height: 2400 });
  await page.evaluate(async () => { document.activeElement?.blur(); window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({ path: 'output/workflow-studio-1440.png', fullPage: true });
  await page.goto(build.runs[0].previewUrl);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#catalog .card').first().waitFor();
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(size.scroll <= size.client + 1, `Variant overflow at ${width}`);
    await page.screenshot({ path: `output/workflow-site-${width}.png`, fullPage: true });
  }
  await page.goto(revision.runs[0].previewUrl);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#catalog .card').first().waitFor();
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(size.scroll <= size.client + 1, `Revision overflow at ${width}`);
    await page.screenshot({ path: `output/workflow-revision-${width}.png`, fullPage: true });
  }
  const sourceAgain = (await (await fetch(`${origin}/api/jobs/${build.id}/runs/baseline/download`)).json()).files;
  assert.deepEqual(sourceAgain, parentFiles);
  assert.equal(errors.length, 0); assert.equal(modelRequests.length, 0);
  console.log(JSON.stringify({ source: 'real-account-backed-Kiro-plan-build-and-revision', directions: 3, groups: 2, exportCompileImport: 'passed', productSelectionAndSearch: 'passed', inspectorAndForgedMessageRejection: 'passed', realDiff: 'passed', scopedRevisionAndProtectedFiles: 'passed', acceptRevert: 'passed', originalProductBrief: 'preserved', responsive: [375, 800, 1440], pageErrors: errors, newModelCalls: 0 }));
} finally { await browser.close(); }
