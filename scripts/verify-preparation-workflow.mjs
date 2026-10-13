import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createStudio } from '../src/server.mjs';
import { getConfig, rootDir } from '../src/config.mjs';
import { creativeContextForBrief } from '../src/preparation.mjs';

// Real HTTP/Studio/browser integration with a dependency-injected TEST runner.
// No Kiro CLI process, external Qloo request, .env load or default data directory.
const require = createRequire(path.join(process.env.USERPROFILE || process.env.HOME, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'));
const { chromium } = require('playwright');
const temporaryRoot = path.resolve(os.tmpdir());
const directory = await fs.mkdtemp(path.join(temporaryRoot, 'culture-preparation-browser-'));
const output = path.join(rootDir, 'output');
await fs.mkdir(output, { recursive: true });
const config = getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, KIRO_MODEL: 'test-only-fixture-model', QLOO_API_KEY: 'test-only-fixture-key', CREATIVE_PROTOCOL: 'research' });
const calls = [], evidenceFixtures = [], requests = [], errors = [], screenshots = [];
const decision = { id: 'presentation', domain: 'web', kind: 'creative', decision: 'Choose a seasonal presentation', goal: 'Help visitors discover the sample collection', openChoice: 'Atmosphere and collection hierarchy', culturalQuestion: 'Which cultural references could inform this presentation?', expectedEffect: 'Change the collection narrative', resultTypes: ['movie', 'artist'] };
const options = [
  { id: 'quiet', title: 'Everyday rituals', summary: 'A quiet cinematic and musical direction for small daily discoveries.', references: [{ name: 'Paterson', role: 'creator-inspiration', origin: 'agent-selected' }, { name: 'Nujabes', role: 'creator-inspiration', origin: 'agent-selected' }] },
  { id: 'shared', title: 'Shared discovery', summary: 'A warm, communal direction built around cooking and collective experience.', references: [{ name: 'Chef', role: 'creator-inspiration', origin: 'agent-selected' }, { name: 'Khruangbin', role: 'creator-inspiration', origin: 'agent-selected' }] },
];
const runner = async ({ project, job, mode, bridgeUrl, bridgeToken, onEvidence }) => {
  const start = await project.exportFiles();
  calls.push({ jobId: job.id, kind: job.kind, mode, context: structuredClone(job.cultureBrief), start });
  const context = creativeContextForBrief(job.cultureBrief);
  if (job.preparationResponse?.type === 'references') context.references.push({ name: job.preparationResponse.text, role: 'creator-inspiration', origin: 'user-provided' });
  const response = await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken }, body: JSON.stringify({ name: 'culture_assess_decision', arguments: { decision, context } }) });
  assert.equal(response.status, 200);
  const result = await response.json(); assert.ok(!result.isError, JSON.stringify(result));
  if (job.kind === 'prepare') {
    await project.writeFile('culture-preparation.json', JSON.stringify({ decision, creativeContext: context, question: 'What feeling and cultural inspirations should guide this brand?', options }));
    return;
  }
  let evidenceIds = [];
  if (mode === 'qloo' && result.structuredContent.action === 'research') {
    // Intentionally injected fixture data, never a real Qloo API response.
    const fixture = { tool: 'qloo_get_insights', status: 'ok', query: { seedEntityIds: ['test-only-seed'], resultType: 'urn:entity:movie' }, results: [{ entityId: 'test-only-film', name: 'TEST FIXTURE cultural finding' }] };
    evidenceFixtures.push({ jobId: job.id, mode, fixture }); await onEvidence(fixture); evidenceIds = ['Q001'];
  }
  const note = `<aside id="fixture-note" style="padding:12px 18px;background:#e7eccc;color:#3b4b2e;font:12px/1.5 system-ui">TEST FIXTURE — ${mode === 'qloo' ? 'injected research plumbing' : 'baseline plumbing'}. No real model or Qloo data.</aside>`;
  await project.writeFile('index.html', start['index.html'].replace(/<body[^>]*>/i, match => match + note));
  await project.writeFile('culture-decisions.json', JSON.stringify([{ title: 'Fixture presentation', change: 'Add an explicitly labeled integration fixture note.', reason: 'This validates delivery and source linkage only; no cultural benefit is claimed.', selectors: ['#fixture-note'], properties: [], evidenceIds, sourceType: evidenceIds.length ? 'qloo' : 'model-interpretation' }]));
  await project.writeFile('culture-research.json', JSON.stringify([{ id: 'r1', decision: decision.decision, question: decision.culturalQuestion, action: result.structuredContent.action, reuseKey: result.structuredContent.reuseKey, evidenceIds, finding: evidenceIds.length ? 'TEST FIXTURE response injected by the test runner.' : 'No Qloo calls in baseline.', interpretation: 'Test-only presentation to verify the workflow.', affectedArtifact: '#fixture-note', changeMade: 'Added the fixture note.' }]));
};

let studio, browser;
try {
  studio = await createStudio({ config, inspect: async () => ({ available: true, authenticated: true, defaultModel: 'test-only-fixture-model', version: 'TEST FIXTURE' }), runner });
  assert.notEqual(studio.appUrl, 'http://127.0.0.1:8787');
  assert.notEqual(studio.previewBaseUrl, 'http://127.0.0.1:8788');
  browser = await chromium.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2400 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/jobs')) requests.push(request.postDataJSON()); });
  const currentJob = async () => {
    const id = new URL(page.url()).searchParams.get('job'); assert.ok(id); const response = await fetch(`${studio.appUrl}/api/jobs/${id}`); assert.equal(response.status, 200); return response.json();
  };
  const inputReady = () => page.locator('#preparation-question-area').waitFor({ state: 'visible' });
  const contextReady = () => page.waitForFunction(() => document.getElementById('preparation-status').textContent === 'Context ready');
  const builtReady = async () => {
    await page.waitForFunction(() => document.getElementById('job-status').textContent === 'Completed' && !document.getElementById('comparison-grid').hidden);
    await page.frameLocator('#baseline-frame').locator('#fixture-note').waitFor();
    await page.frameLocator('#qloo-frame').locator('#fixture-note').waitFor();
  };
  const capture = async (name, width) => {
    await page.setViewportSize({ width, height: width === 1440 ? 2400 : 1000 });
    await page.evaluate(async () => { document.activeElement?.blur(); window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(size.scroll <= size.client + 1, `${name} overflow at ${width}`);
    const relative = `output/preparation-flow-${name}-${width}.png`; await page.screenshot({ path: path.join(rootDir, relative), fullPage: true }); screenshots.push(relative);
  };
  await page.goto(studio.appUrl);
  await page.waitForFunction(() => !document.getElementById('prepare-button').disabled);
  const initialBrief = 'Create an original seasonal food brand experience while preserving the existing catalog and shopping interactions.';
  await page.locator('#brief').fill(initialBrief); await page.locator('#prepare-button').click(); await inputReady();
  const initial = await currentJob(); assert.equal(initial.kind, 'prepare'); assert.equal(initial.runs[0].preparation.status, 'needs_input'); assert.equal(initial.runs[0].assessmentCalls.length, 1); assert.equal(initial.runs[0].preparation.assessmentPerformedByAgent, true); assert.equal(initial.runs[0].previewUrl, null); assert.deepEqual(initial.runs[0].evidence, []);
  assert.equal(await page.locator('#comparison-grid').isVisible(), false);
  for (const width of [1440, 375]) await capture('question', width);
  const countBeforeReload = studio.manager.jobs.size, runnerCountBeforeReload = calls.length;
  await page.reload(); await inputReady(); assert.equal(studio.manager.jobs.size, countBeforeReload); assert.equal(calls.length, runnerCountBeforeReload); assert.equal(new URL(page.url()).searchParams.get('job'), initial.id);
  await page.locator('.preparation-option button').first().click(); await contextReady();
  const ready = await currentJob(); assert.equal(ready.runs[0].preparation.referenceResolution.type, 'option'); assert.equal(calls.length, runnerCountBeforeReload, 'An explicit option must not run the model again');
  assert.equal(ready.runs[0].preparation.creativeContext.references[0].origin, 'agent-selected');
  await page.locator('#start-button').click(); await builtReady();
  const built = await currentJob(); assert.equal(built.status, 'completed', built.error); assert.equal(built.runs.length, 2); assert.equal(built.preparationJobId, ready.id);
  const production = calls.filter(call => call.jobId === built.id); assert.equal(production.length, 2); assert.deepEqual(production[0].context, production[1].context); assert.deepEqual(production[0].start, production[1].start);
  assert.deepEqual(built.runs.find(run => run.mode === 'baseline').evidence, []); assert.equal(built.runs.find(run => run.mode === 'qloo').evidence.length, 1);
  await page.locator('#tab-decisions').click(); assert.equal(await page.locator('.research-decisions .record-card').count(), 2);
  for (const width of [1440, 375]) await capture('comparison', width);
  await page.locator('#brief').fill('Create another original seasonal collection direction while preserving the existing local shopping functions.');
  await page.locator('#start-button').click(); await inputReady();
  const freeParent = await currentJob();
  await page.locator('#preparation-answer').fill('Nujabes'); await page.locator('#preparation-submit').click(); await builtReady();
  const freeBuilt = await currentJob(), answered = studio.manager.publicJob(studio.manager.get(freeBuilt.preparationJobId));
  assert.equal(answered.preparationRound, 1); assert.equal(answered.runs[0].preparation.status, 'ready'); assert.equal(answered.preparationResponse.type, 'references');
  assert.equal(answered.runs[0].preparation.creativeContext.references[0].origin, 'user-provided');
  assert.equal(calls.filter(call => call.kind === 'prepare' && call.jobId === answered.id).length, 1);
  assert.deepEqual(calls.filter(call => call.jobId === freeBuilt.id).map(call => call.context), [freeBuilt.cultureBrief, freeBuilt.cultureBrief]);
  assert.equal(freeParent.runs[0].preparation.status, 'needs_input');
  await page.locator('#brief').fill('Create a fresh creative food presentation with a new open narrative direction.'); await page.locator('#prepare-button').click(); await inputReady();
  const stale = await currentJob(), countBeforeStale = studio.manager.jobs.size, requestsBeforeStale = requests.length;
  await page.locator('#brief').fill('Create a changed product presentation with a different purpose and narrative direction.'); await page.locator('#preparation-delegate').click();
  await page.waitForFunction(() => document.getElementById('form-error').textContent.includes('changed'));
  assert.equal(studio.manager.jobs.size, countBeforeStale); assert.equal(requests.length, requestsBeforeStale);
  const staleResponse = await fetch(`${studio.appUrl}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: stale.templateId, brief: 'Create a changed product presentation with a different purpose.', kind: 'prepare', intendedKind: 'build', mode: 'baseline', workspaceId: stale.workspaceId, cultureBrief: stale.baseCultureBrief, preparationJobId: stale.id, preparationResponse: { type: 'delegate' } }) });
  assert.equal(staleResponse.status, 400); assert.match((await staleResponse.json()).error, /context has changed/);
  const importedContext = {
    schemaVersion: '1.0', product: { name: 'Imported fixture workspace', templateId: 'local-food', brief: initialBrief },
    brand: { notes: 'TEST FIXTURE imported creative context', protectedFiles: ['app.js'], protectedSnippets: [] }, audiences: [],
    creativeContext: { domain: 'web', referencePolicy: 'ask', references: [{ name: 'Paterson', role: 'creator-inspiration', origin: 'user-provided' }], constraints: [] },
    evidence: [{ id: 'IMPORT001', tool: 'qloo_get_insights', status: 'ok', query: { seedEntityIds: ['test-import-seed'], resultType: 'urn:entity:movie' }, results: [{ entityId: 'test-import-film', name: 'TEST FIXTURE imported claim' }] }],
    researchDecisions: [{ id: 'import-r1', decision: 'Choose the former presentation', question: 'What references support the former presentation?', action: 'research', evidenceIds: ['IMPORT001'], finding: 'TEST FIXTURE caller-provided finding.', interpretation: 'An unverified imported creative interpretation.', affectedArtifact: '#former-output' }],
  };
  const importFile = { name: 'fixture-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ context: importedContext, importedResearch: { provenance: 'caller-provided-unverified', evidence: [], researchDecisions: [] } })) };
  await page.locator('#workspace-import-file').setInputFiles(importFile);
  await page.waitForFunction(() => document.getElementById('workspace-feedback').textContent.includes('imported'));
  await page.locator('#save-workspace').click();
  await page.waitForFunction(() => document.getElementById('workspace-feedback').textContent.startsWith('Workspace saved'));
  const importedWorkspaceId = await page.locator('#workspace-select').inputValue(); assert.ok(importedWorkspaceId);
  const savedImport = await (await fetch(`${studio.appUrl}/api/workspaces/${importedWorkspaceId}`)).json();
  assert.equal(savedImport.cultureBrief.importedResearch.provenance, 'caller-provided-unverified');
  assert.equal(savedImport.cultureBrief.importedResearch.complete, true);
  assert.equal(savedImport.cultureBrief.importedResearch.evidence[0].id, 'IMPORT001', 'Context-owned source records must override an outer fallback');
  assert.equal(savedImport.cultureBrief.importedResearch.evidence[0].verification, 'caller-provided-unverified');
  await page.locator('#new-workspace').click(); await page.locator('#workspace-select').selectOption(importedWorkspaceId);
  await page.waitForFunction(() => document.getElementById('workspace-feedback').textContent.startsWith('Workspace opened'));
  await page.locator('#save-workspace').click(); await page.waitForFunction(() => document.getElementById('workspace-feedback').textContent.startsWith('Workspace saved'));
  const reopenedImport = await (await fetch(`${studio.appUrl}/api/workspaces/${importedWorkspaceId}`)).json();
  assert.deepEqual(reopenedImport.cultureBrief.importedResearch, savedImport.cultureBrief.importedResearch);
  await page.locator('input[name="mode"][value="baseline"]').check();
  await page.locator('#prepare-button').click(); await contextReady();
  const importedPrep = await currentJob(); assert.equal(importedPrep.runs[0].preparation.status, 'ready');
  assert.deepEqual(importedPrep.runs[0].evidence, []);
  await page.locator('#start-button').click();
  await page.waitForFunction(() => document.getElementById('job-status').textContent === 'Completed' && !document.getElementById('comparison-grid').hidden);
  await page.frameLocator('#baseline-frame').locator('#fixture-note').waitFor();
  const importedBuilt = await currentJob(); assert.equal(importedBuilt.preparationJobId, importedPrep.id, 'Saved normalized context must retain preparation compatibility');
  assert.deepEqual(importedBuilt.runs[0].evidence, []);
  assert.equal(importedBuilt.runs[0].researchDecisions.some(record => record.id === 'import-r1'), false);
  const importedFiles = await (await fetch(`${studio.appUrl}/api/jobs/${importedBuilt.id}/runs/baseline/download`)).json();
  const operational = JSON.parse(importedFiles.files['culture-brief.json']);
  assert.equal(Object.hasOwn(operational, 'importedResearch'), false);
  assert.deepEqual(operational.evidence, []); assert.equal(operational.researchDecisions.some(record => record.id === 'import-r1'), false);
  assert.equal(JSON.parse(importedFiles.files['culture-imported-context.json']).evidence[0].id, 'IMPORT001');
  const importedExport = await (await fetch(`${studio.appUrl}/api/workspaces/${importedWorkspaceId}/export`)).json();
  assert.deepEqual(importedExport.importedResearch, reopenedImport.cultureBrief.importedResearch);
  assert.deepEqual(importedExport.workspaceDraft.cultureBrief.importedResearch, reopenedImport.cultureBrief.importedResearch);
  assert.deepEqual(errors, []);
  const report = {
    source: 'test-only dependency-injected runner with real Studio HTTP, scoped assessment bridge, persistence, and browser',
    claims: { realKiroModelCalls: 0, realQlooApiCalls: 0, qlooEvidence: 'Injected test fixtures only; cultural usefulness and real agent behavior are not evaluated.' },
    isolation: { ephemeralPorts: true, temporaryDataDirectory: true, defaultDataAndEnvUntouched: true },
    passed: { preparationQuestion: true, actualAssessmentBridge: true, noPreparationPreview: true, reloadNoAutoProduction: true, optionNoAdditionalRunnerCall: true, comparisonEqualContextAndStartingFiles: true, separateBaselineAndFixtureEvidence: true, freeAnswerOneAdditionalPreparation: true, pendingProductionResumes: true, staleAnswerBlockedInUiAndBackend: true, researchDecisionDisplay: true, importedResearchSaveReopen: true, contextOwnedSourcesTakePrecedence: true, normalizedImportedContextReusesPreparation: true, importedSourcesNeverBecomeOperationalEvidence: true, importedSidecarAndExportPreserved: true, responsive: [375, 1440] },
    fixtureRunnerCalls: calls.map(({ jobId, kind, mode }) => ({ jobId, kind, mode })), assessmentBridgeCalls: calls.length,
    injectedQlooEvidenceCount: evidenceFixtures.length, browserJobRequests: requests.length, javascriptErrors: errors, screenshots,
  };
  await fs.writeFile(path.join(output, 'preparation-flow-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (browser) await browser.close();
  if (studio) await studio.close();
  // The recursive target is a verified direct child of the OS temporary root.
  if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith('culture-preparation-browser-')) throw new Error('Unexpected temporary cleanup target.');
  await fs.rm(directory, { recursive: true, force: true });
}
