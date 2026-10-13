import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compileCultureBrief } from '../plugin/server/culture/brief.mjs';

const args = process.argv.slice(2);
const jobId = args.find(value => value.startsWith('--job='))?.slice(6);
const origin = args.find(value => value.startsWith('--origin='))?.slice(9) || 'http://127.0.0.1:8787';
if (jobId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(jobId)) throw new Error('Pass a valid saved job ID with --job=ID.');
if (!args.includes('--run')) {
  console.log(JSON.stringify({ status: 'planned-only', jobId: jobId || null, command: 'node scripts/verify-qloo-comparison-browser.mjs --job=ID --run', checks: ['Completed actual baseline/Qloo comparison', 'Equal authored inputs and preparation references', 'Both preview search/category/sort/selection/local form interactions', 'Actual evidence and decision links', 'Download and portable brief provenance', 'Studio and preview responsive layouts at 375/1440'], sideEffects: 'GET requests and local browser interactions only. No generation, workspace writes, Kiro calls or Qloo calls.', interpretation: 'Integration verification, not proof of design quality or cultural benefit.' }));
  process.exit(0);
}
assert.ok(jobId, '--run requires --job=ID');
const appOrigin = new URL(origin);
assert.ok(appOrigin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(appOrigin.hostname) && appOrigin.pathname === '/' && !appOrigin.username && !appOrigin.password && !appOrigin.search && !appOrigin.hash, 'Only a local Studio origin is supported.');
const readJson = async pathname => {
  const response = await fetch(new URL(pathname, appOrigin));
  assert.equal(response.status, 200, `GET ${pathname} must succeed`);
  return response.json();
};
const job = await readJson(`/api/jobs/${jobId}`);
assert.equal(job.status, 'completed', 'The supplied comparison must be completed; this script never starts or waits for generation.');
assert.equal(job.kind, 'build');
assert.equal(job.templateId, 'local-food', 'This harness verifies the local-food live comparison and its catalog contract.');
assert.equal(job.runs.length, 2);
const runByMode = Object.fromEntries(job.runs.map(run => [run.mode, run]));
for (const mode of ['baseline', 'qloo']) { assert.equal(runByMode[mode]?.status, 'completed'); assert.ok(runByMode[mode].previewUrl); }
assert.deepEqual(runByMode.baseline.evidence, []);
assert.ok(runByMode.qloo.evidence.some(record => record.tool === 'qloo_get_insights' && record.status === 'ok' && record.results?.length), 'Require usable actual Qloo insight records, not a skipped-research comparison.');
for (const mode of ['baseline', 'qloo']) assert.ok(runByMode[mode].assessmentCalls?.length, `${mode} must record its assessment call`);
const preparation = job.preparationJobId ? await readJson(`/api/jobs/${job.preparationJobId}`) : null;
assert.ok(preparation, 'The comparison must have a saved preparation.');
assert.equal(preparation.kind, 'prepare'); assert.equal(preparation.status, 'completed');
assert.equal(preparation.runs[0].preparation.status, 'ready'); assert.deepEqual(preparation.runs[0].evidence, []);
assert.deepEqual(preparation.runs[0].researchCalls || [], []);
assert.equal(preparation.brief, job.productBrief || job.brief);
const briefs = Object.fromEntries(await Promise.all(['baseline', 'qloo'].map(async mode => [mode, await readJson(`/api/jobs/${jobId}/runs/${mode}/brief`)])));
const inputContext = brief => Object.fromEntries(['product', 'brand', 'audiences', 'creativeContext', 'constraints', 'selectedDirection', 'audienceId', 'revisionRequest'].filter(key => brief[key] !== undefined).map(key => [key, brief[key]]));
assert.deepEqual(inputContext(briefs.baseline), inputContext(briefs.qloo), 'Both actual runs must export identical authored inputs.');
assert.deepEqual(briefs.baseline.creativeContext, preparation.runs[0].preparation.creativeContext);
assert.deepEqual(briefs.qloo.evidence, runByMode.qloo.evidence);
const compiled = compileCultureBrief(briefs.qloo);
assert.equal(compiled.status, 'compiled');
assert.ok(compiled.context.evidence.every(record => record.verification === 'caller-provided-unverified'), 'Portable copies must not upgrade source attestation.');
const sourceIds = new Set(runByMode.qloo.evidence.map(record => record.id));
const sourceDecisions = runByMode.qloo.decisions.filter(record => record.sourceType === 'qloo');
assert.ok(sourceDecisions.length, 'At least one actual design decision must link its Qloo evidence.');
for (const record of [...runByMode.qloo.decisions, ...runByMode.qloo.researchDecisions]) for (const id of record.evidenceIds || []) assert.ok(sourceIds.has(id), `Unknown evidence link ${id}`);
assert.ok(runByMode.qloo.researchDecisions.length, 'Require a saved creative research trace.');
const starterResponse = await fetch(new URL(`/templates/${job.templateId}/index.html`, appOrigin)); assert.equal(starterResponse.status, 200);
const starterHtml = await starterResponse.text();
const starterDataMatch = starterHtml.match(/<script\b[^>]*\bid\s*=\s*["']site-data["'][^>]*>([\s\S]*?)<\/script>/i);
assert.ok(starterDataMatch, 'The original starter must include its catalog facts.');
const starterData = JSON.parse(starterDataMatch[1]);
const productFacts = data => data.items.map(({ id, name, price, meta }) => ({ id, name, price, meta })).sort((a, b) => a.id.localeCompare(b.id));

const cache = path.join(process.env.USERPROFILE || process.env.HOME, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node');
const require = createRequire(path.join(cache, 'package.json'));
const { chromium } = require('playwright');
const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
const prefix = `qloo-comparison-${jobId.slice(0, 8)}`;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 2400 }, reducedMotion: 'reduce' });
const errors = [], rejectedRequests = [], screenshots = [], interactionResults = [], downloads = [], languageChecks = [];
const allowedOrigins = new Set([appOrigin.origin]);
for (const mode of ['baseline', 'qloo']) {
  const preview = new URL(runByMode[mode].previewUrl);
  assert.ok(preview.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(preview.hostname) && !preview.username && !preview.password, 'A preview must remain local.');
  allowedOrigins.add(preview.origin);
}
// Fail closed: UI mistakes cannot trigger a generation, upload or external call.
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (request.method() !== 'GET' || !allowedOrigins.has(url.origin)) {
    rejectedRequests.push({ method: request.method(), origin: url.origin, path: url.pathname.replace(/\/preview\/([^/]+)\/([^/]+)\/[^/]+\//, '/preview/$1/$2/[capability]/') });
    await route.abort(); return;
  }
  await route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const checkEnglishPresentation = async (targetPage, label) => {
  const presentation = await targetPage.evaluate(() => ({
    language: document.documentElement.lang,
    visibleCopy: document.body.innerText,
    controlCopy: [...document.querySelectorAll('input, textarea, button, a, select')].filter(element => element.getClientRects().length).flatMap(element => ['placeholder', 'aria-label', 'title'].map(attribute => element.getAttribute(attribute)).filter(Boolean)),
  }));
  assert.equal(presentation.language, 'en', `${label} must declare English presentation.`);
  // A regression guard for previously untranslated authored interface words.
  // Cultural entity names in source cards are valid names, not UI translations.
  const authoredCopy = label === 'studio' ? await targetPage.evaluate(() => {
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll('#panel-evidence, #panel-decisions').forEach(element => element.remove());
    return copy.innerText || copy.textContent;
  }) : presentation.visibleCopy;
  const untranslated = /\b(?:masa|gönder|ürünler|sepetim|tasarım|kaydet|seçiniz|keşfet|etkinlik|karşılaştır|bekleniyor|hazırlanıyor)\b/iu;
  assert.equal(untranslated.test([authoredCopy, ...presentation.controlCopy].join('\n')), false, `${label} contains a known untranslated authored word.`);
  languageChecks.push({ surface: label, documentLanguage: presentation.language, authoredCopyResidueCheck: 'passed', culturalEntityNames: 'preserved' });
};
const capture = async (targetPage, label, width) => {
  await targetPage.setViewportSize({ width, height: label === 'studio' && width === 1440 ? 2400 : 1000 });
  await targetPage.evaluate(async () => { document.activeElement?.blur(); window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  // Chromium can omit offscreen sandboxed frame paint from fullPage captures.
  // Put both Studio previews inside the actual viewport before capturing them.
  if (label === 'studio') {
    const pageHeight = await targetPage.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    await targetPage.setViewportSize({ width, height: Math.max(1000, pageHeight) });
    await targetPage.evaluate(async () => { window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await Promise.all(['baseline', 'qloo'].map(mode => targetPage.frameLocator(`#${mode}-frame`).locator('#catalog .card').first().waitFor()));
  }
  const size = await targetPage.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(size.scroll <= size.client + 1, `${label} horizontal overflow at ${width}`);
  const filename = `${prefix}-${label}-${width}.png`;
  await targetPage.screenshot({ path: path.join(output, filename), fullPage: true }); screenshots.push(`output/${filename}`);
};
try {
  await page.goto(`${appOrigin.origin}/?job=${jobId}`);
  await page.locator('#baseline-frame').waitFor({ state: 'visible' }); await page.locator('#qloo-frame').waitFor({ state: 'visible' });
  for (const mode of ['starter', 'baseline', 'qloo']) {
    const sandbox = (await page.locator(`#${mode}-frame`).getAttribute('sandbox')).split(/\s+/);
    assert.ok(sandbox.includes('allow-scripts') && sandbox.includes('allow-forms'));
    assert.equal(sandbox.includes('allow-same-origin'), false, 'Local form handlers must not relax origin isolation.');
  }
  await page.frameLocator('#baseline-frame').locator('#catalog .card').first().waitFor();
  await page.frameLocator('#qloo-frame').locator('#catalog .card').first().waitFor();
  for (const mode of ['baseline', 'qloo']) {
    const frame = page.frameLocator(`#${mode}-frame`), data = JSON.parse(await frame.locator('#site-data').textContent());
    await frame.locator('#catalog .card button').first().click();
    await frame.locator('#request-form input[name="name"]').fill('Embedded verification');
    await frame.locator('#request-form input[name="email"]').fill('reviewer@example.invalid');
    await frame.locator('#request-form button[type="submit"]').click();
    assert.equal(await frame.locator('#form-message').textContent(), data.formSuccess, `${mode} local form must work inside the Studio sandbox.`);
  }
  assert.equal(await page.locator('#brief').inputValue(), job.productBrief || job.brief);
  await page.locator('#tab-evidence').click();
  assert.equal(await page.locator('#evidence-count').textContent(), String(runByMode.qloo.evidence.length));
  assert.equal(await page.locator('#panel-evidence .record-card').count(), runByMode.qloo.evidence.length);
  for (const id of sourceIds) assert.equal(await page.locator(`#panel-evidence [data-evidence-id="${id}"]`).count(), 1);
  await page.locator('#tab-decisions').click();
  const link = page.locator('#panel-decisions .evidence-reference').first(); await link.waitFor(); await link.click();
  assert.equal(await page.locator('#tab-evidence').getAttribute('aria-selected'), 'true');
  for (const mode of ['baseline', 'qloo']) {
    const downloaded = page.waitForEvent('download'); await page.locator(`[data-download="${mode}"]`).click();
    const download = await downloaded, filename = `${prefix}-${mode}-files.json`; await download.saveAs(path.join(output, filename));
    const content = JSON.parse(await fs.readFile(path.join(output, filename), 'utf8'));
    assert.equal(content.jobId, jobId); assert.equal(content.mode, mode);
    assert.deepEqual(JSON.parse(content.files['culture-brief.json']), briefs[mode]);
    downloads.push(`output/${filename}`);
  }
  // Verify the saved workspace's latest comparison through a GET-only export.
  // Never click Export brief: that button first saves a draft.
  assert.ok(job.workspaceId, 'The actual comparison must belong to a saved workspace.');
  const exported = await readJson(`/api/workspaces/${job.workspaceId}/export`);
  assert.equal(exported.source?.jobId, jobId, 'The workspace must export this latest completed comparison without any selection write.');
  assert.ok(runByMode[exported.source.mode], 'The export must identify an actual comparison mode.');
  assert.deepEqual(exported.context.evidence, runByMode[exported.source.mode].evidence);
  assert.equal(compileCultureBrief(exported.context).status, 'compiled');
  const workspaceExport = { status: 'matching latest snapshot verified via GET', sourceJobId: exported.source.jobId, sourceMode: exported.source.mode };
  await page.goto(`${appOrigin.origin}/?job=${jobId}`);
  await page.frameLocator('#baseline-frame').locator('#catalog .card').first().waitFor();
  await page.frameLocator('#qloo-frame').locator('#catalog .card').first().waitFor();
  await checkEnglishPresentation(page, 'studio');
  for (const width of [1440, 375]) await capture(page, 'studio', width);
  for (const mode of ['baseline', 'qloo']) {
    const previewPage = await context.newPage(); previewPage.on('pageerror', error => errors.push(error.message));
    for (const width of [1440, 375]) {
      await previewPage.setViewportSize({ width, height: 1000 }); await previewPage.goto(runByMode[mode].previewUrl);
      await previewPage.locator('#catalog .card').first().waitFor();
      await checkEnglishPresentation(previewPage, `${mode}-${width}`);
      const siteData = await previewPage.locator('#site-data').textContent(); const data = JSON.parse(siteData);
      assert.equal(data.items.length, 6, 'The live local-food demo must preserve all six products.');
      assert.deepEqual(productFacts(data), productFacts(starterData), `${mode} must preserve the original product IDs, names, prices and units.`);
      assert.equal(await previewPage.locator('#catalog .card').count(), data.items.length);
      await previewPage.locator('#catalog .card button').first().click(); assert.equal(await previewPage.locator('#selection-count').textContent(), '1');
      await previewPage.locator('#search').fill(data.items[0].name); assert.equal(await previewPage.locator('#catalog .card').count(), 1); await previewPage.locator('#search').fill('');
      const category = data.items[0].category; await previewPage.locator('#category').selectOption(category);
      assert.equal(await previewPage.locator('#catalog .card').count(), data.items.filter(item => item.category === category).length); await previewPage.locator('#category').selectOption('');
      await previewPage.locator('#sort').selectOption('name');
      assert.deepEqual(await previewPage.locator('#catalog .card h3').allTextContents(), data.items.map(item => item.name).sort((a, b) => a.localeCompare(b, 'en-US')));
      await previewPage.locator('#sort').selectOption('price');
      assert.deepEqual(await previewPage.locator('#catalog .card h3').allTextContents(), [...data.items].sort((a, b) => a.price - b.price).map(item => item.name));
      await previewPage.locator('#selected-items button').click(); assert.equal(await previewPage.locator('#selection-count').textContent(), '0');
      await previewPage.locator('#sort').selectOption('default'); await previewPage.locator('#catalog .card button').first().click();
      await previewPage.locator('#request-form input[name="name"]').fill('Local verification');
      await previewPage.locator('#request-form input[name="email"]').fill('reviewer@example.invalid');
      await previewPage.locator('#request-form button[type="submit"]').click(); assert.equal(await previewPage.locator('#form-message').textContent(), data.formSuccess);
      interactionResults.push({ mode, width, search: 'passed', category: 'passed', nameAndPriceSort: 'passed', addRemoveSelection: 'passed', localForm: 'passed', products: data.items.length, originalProductFacts: 'preserved' });
      await previewPage.reload(); await previewPage.locator('#catalog .card').first().waitFor(); await capture(previewPage, mode, width);
    }
    await previewPage.close();
  }
  assert.deepEqual(rejectedRequests, [], 'No verification action may cause a write or external request.'); assert.deepEqual(errors, []);
  const report = { source: 'read-only browser integration over saved actual Kiro/Qloo comparison', interpretation: 'Verifies delivery, interactions, input parity and provenance. Does not prove superior design quality or cultural benefit.', jobId, model: job.model, preparationJobId: job.preparationJobId, newKiroModelCalls: 0, newQlooApiCalls: 0, workspaceWrites: 0, authoredInputParity: 'passed', preparationSourceCalls: 0, evidenceRecords: runByMode.qloo.evidence.length, usableInsightRecords: runByMode.qloo.evidence.filter(record => record.tool === 'qloo_get_insights' && record.status === 'ok' && record.results?.length).length, sourceLinkedDecisions: sourceDecisions.length, researchTraceRecords: runByMode.qloo.researchDecisions.length, evidenceIds: [...sourceIds], portableEvidenceAttestation: 'caller-provided-unverified', workspaceExport, embeddedLocalForms: 'passed in both Studio preview frames', sandboxOriginIsolation: 'retained', englishPresentation: languageChecks, interactions: interactionResults, screenshots, downloads, pageErrors: errors, rejectedRequests };
  await fs.writeFile(path.join(output, `${prefix}-verification.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
