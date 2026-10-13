import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createStudio } from '../src/server.mjs';
import { getConfig } from '../src/config.mjs';
import { templates } from '../src/templates.mjs';
import { creativeContextForBrief, normalizePreparation, answerPreparation } from '../src/preparation.mjs';
import { makeDesignPrompt } from '../src/kiro-runner.mjs';
import { CREATIVE_POLICY_TEXT } from '../plugin/server/culture/policy.mjs';
import { normalizeCultureBrief } from '../src/design-artifacts.mjs';
import { validateCultureBrief } from '../plugin/server/culture/brief.mjs';

const request = { templateId: 'local-food', brief: 'Give this food brand an original seasonal creative direction.', mode: 'baseline' };
const decision = { id: 'direction', domain: 'web', kind: 'creative', decision: 'Choose the seasonal direction', openChoice: 'Atmosphere and collection presentation', culturalQuestion: 'Which cultural relationships could inform the presentation?', expectedEffect: 'Change the collection narrative', resultTypes: ['movie', 'artist'] };
const option = { id: 'quiet', title: 'Everyday rituals', summary: 'A quiet cinematic and musical inspiration.', references: [{ name: 'Paterson', role: 'creator-inspiration', origin: 'agent-selected' }] };
const artifact = { decision, question: 'Which audience tastes or creator inspirations should guide the seasonal direction?', options: [option] };
const html = '<!doctype html><html><head><title>Test-only seasonal site</title></head><body><section id="hero"><h1>Seasonal collection</h1></section><script src="app.js"></script></body></html>';
const directions = [1, 2, 3].map(n => ({ id: `d${n}`, title: `Test direction ${n}`, summary: 'A feasible interpretation.', audienceIds: [], anchors: [], changes: [{ selector: '#hero', change: 'Change collection hierarchy.' }], tradeoffs: [] }));

async function setup(t, { key = '', mutate, noReferences = false, researchToolFailure = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-preparation-test-'));
  const config = getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, QLOO_API_KEY: key, CREATIVE_PROTOCOL: 'research' });
  const calls = [];
  const inspect = async () => ({ available: true, authenticated: true, defaultModel: 'test-only-model' });
  const runner = async ({ project, job, mode, bridgeUrl, bridgeToken, onEvidence }) => {
    calls.push({ kind: job.kind, mode, context: structuredClone(job.cultureBrief), start: await project.exportFiles() });
    const context = creativeContextForBrief(job.cultureBrief);
    if (job.preparationResponse?.type === 'references' && !noReferences) context.references.push({ name: job.preparationResponse.text, role: 'creator-inspiration', origin: 'user-provided' });
    const classified = job.brief.includes('technical') ? { ...decision, kind: 'technical' } : decision;
    const response = await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken }, body: JSON.stringify({ name: 'culture_assess_decision', arguments: { decision: classified, context } }) });
    const assessment = await response.json(); assert.ok(!assessment.isError, JSON.stringify(assessment));
    if (job.kind === 'prepare') {
      await project.writeFile('culture-preparation.json', JSON.stringify({ ...artifact, decision: classified, creativeContext: context }));
      if (mutate) await mutate(project);
      return;
    }
    if (mode === 'qloo' && assessment.structuredContent.action === 'research') {
      if (researchToolFailure) {
        const source = await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken }, body: JSON.stringify({ name: 'qloo_get_insights', arguments: { seedEntityIds: ['test-only-id'], resultType: 'movie' } }) });
        assert.equal((await source.json()).isError, true);
      } else await onEvidence({ tool: 'qloo_get_insights', status: 'ok', query: { seedEntityIds: ['test-only-id'], resultType: 'movie' }, results: [{ entityId: 'test-only-film', name: 'Test-only cultural finding' }] });
    }
    if (job.kind === 'plan') await project.writeFile('culture-directions.json', JSON.stringify(directions));
    else if (job.kind === 'revise') await project.writeFile('culture-revision.json', JSON.stringify({ selector: '#hero', fragment: '<section id="hero"><h1>A revised seasonal collection</h1></section>', css: '' }));
    else await project.writeFile('index.html', html);
    await project.writeFile('culture-decisions.json', '[]');
    await project.writeFile('culture-research.json', JSON.stringify([{ id: 'r1', decision: classified.decision, question: classified.culturalQuestion, action: assessment.structuredContent.action, reuseKey: assessment.structuredContent.reuseKey, evidenceIds: [], finding: mode === 'baseline' ? 'Qloo is unavailable.' : 'Test-only route.', interpretation: 'Test-only interpretation.', affectedArtifact: '#hero' }]));
  };
  const studio = await createStudio({ config, inspect, runner });
  // This injected fixture covers preparation/legacy production independently of phase enforcement.
  studio.manager.enforceResearchPhases = false;
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { studio, calls, config, inspect, runner };
}
async function wait(studio, job) {
  for (let i = 0; i < 400; i++) {
    const current = studio.manager.get(job.id);
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return current;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Preparation test timed out.');
}
async function prepare(studio, extra = {}) {
  const job = await wait(studio, await studio.manager.create({ ...request, kind: 'prepare', intendedKind: 'build', ...extra }));
  assert.equal(job.status, 'completed', job.error); return job;
}
const responseRequest = (job, preparationResponse) => ({ ...request, kind: 'prepare', intendedKind: job.intendedKind, cultureBrief: job.baseCultureBrief, preparationJobId: job.id, preparationResponse });

test('preparation records actual assessment without a Qloo key and cannot become a site variant', async t => {
  const { studio } = await setup(t);
  const workspace = await studio.workspaces.upsert({ ...request, name: 'Preparation workspace' });
  const job = await prepare(studio, { workspaceId: workspace.id });
  const run = studio.manager.publicJob(job).runs[0];
  assert.equal(run.preparation.status, 'needs_input'); assert.equal(run.preparation.assessment.action, 'clarify');
  assert.equal(run.preparation.assessmentPerformedByAgent, true); assert.equal(run.assessmentCalls.length, 1);
  assert.deepEqual(run.evidence, []); assert.equal(run.previewUrl, null);
  assert.equal(await studio.manager.project(job, 'baseline').readFile('index.html'), templates[0].files['index.html']);
  const saved = await (await fetch(`${studio.appUrl}/api/workspaces/${workspace.id}`)).json(); assert.deepEqual(saved.variants, []);
  const download = await fetch(`${studio.appUrl}/api/jobs/${job.id}/runs/baseline/download`); assert.equal(download.status, 404);
  const preview = await fetch(`${studio.previewBaseUrl}/preview/${job.id}/baseline/${job.previewToken}/index.html`); assert.equal(preview.status, 404);
  await assert.rejects(studio.manager.create({ ...request, mode: 'compare', workspaceId: workspace.id, preparationJobId: job.id, cultureBrief: job.baseCultureBrief }), /Answer the preparation/);
});

test('explicit option, delegation and skip preserve reference origin and avoid another model run', async t => {
  const { studio, calls } = await setup(t);
  const parent = await prepare(studio);
  for (const response of [{ type: 'option', optionId: 'quiet' }, { type: 'delegate' }, { type: 'skip' }]) {
    const job = await wait(studio, await studio.manager.create(responseRequest(parent, response)));
    assert.equal(job.status, 'completed', job.error); const prep = job.runs[0].preparation;
    assert.equal(prep.status, 'ready'); assert.equal(prep.referenceResolution.type, response.type);
    assert.equal(prep.assessment.action, response.type === 'skip' ? 'skip' : 'research');
    if (response.type !== 'skip') { assert.equal(prep.creativeContext.references[0].origin, 'agent-selected'); assert.equal(prep.creativeContext.references[0].role, 'creator-inspiration'); }
  }
  assert.equal(calls.length, 1);
});

test('free reference answer runs one further preparation and shares authored context in comparison', async t => {
  const { studio, calls } = await setup(t, { key: 'test-only-key' });
  const parent = await prepare(studio);
  const answered = await wait(studio, await studio.manager.create(responseRequest(parent, { type: 'references', text: 'Nujabes' })));
  assert.equal(answered.status, 'completed', answered.error); assert.equal(answered.preparationRound, 1);
  assert.equal(answered.runs[0].preparation.status, 'ready'); assert.equal(calls.length, 2);
  const built = await wait(studio, await studio.manager.create({ ...request, mode: 'compare', preparationJobId: answered.id, cultureBrief: answered.baseCultureBrief }));
  assert.equal(built.status, 'completed', built.error);
  const production = calls.filter(call => call.kind === 'build'); assert.equal(production.length, 2);
  assert.deepEqual(production[0].context, production[1].context);
  assert.deepEqual(production[0].start, production[1].start);
  assert.equal(production[0].context.creativeContext.references[0].origin, 'user-provided');
  assert.deepEqual(built.runs[0].evidence, []); assert.equal(built.runs[1].evidence.length, 1);
});

test('an unhelpful answer cannot create an endless free-text clarification loop', async t => {
  const { studio } = await setup(t, { noReferences: true }); const parent = await prepare(studio);
  const answered = await wait(studio, await studio.manager.create(responseRequest(parent, { type: 'references', text: 'I cannot name any inspirations.' })));
  assert.equal(answered.status, 'completed', answered.error); assert.equal(answered.runs[0].preparation.status, 'needs_input');
  assert.equal(answered.runs[0].preparation.question, parent.runs[0].preparation.question);
  await assert.rejects(studio.manager.create(responseRequest(answered, { type: 'references', text: 'Still no idea.' })), /round is complete/);
  const skipped = await wait(studio, await studio.manager.create(responseRequest(answered, { type: 'skip' })));
  assert.equal(skipped.runs[0].preparation.status, 'ready');
});

test('changed brief, roles, brand, audience or workspace reject an old preparation', async t => {
  const { studio } = await setup(t); const parent = await prepare(studio);
  const ready = await wait(studio, await studio.manager.create(responseRequest(parent, { type: 'option', optionId: 'quiet' })));
  for (const changes of [
    { brief: 'A completely different seasonal product and creative task.' },
    { cultureBrief: { ...ready.baseCultureBrief, brand: { ...ready.baseCultureBrief.brand, notes: 'Changed identity' } } },
    { cultureBrief: { ...ready.baseCultureBrief, creativeContext: { references: [{ name: 'Paterson', role: 'audience', origin: 'user-provided' }] } } },
    { cultureBrief: { ...ready.baseCultureBrief, audiences: [{ id: 'a1', label: 'Audience', references: ['Paterson'] }] }, audienceId: 'a1' },
  ]) await assert.rejects(studio.manager.create({ ...request, preparationJobId: ready.id, cultureBrief: ready.baseCultureBrief, ...changes }), /context has changed/);
  const workspace = await studio.workspaces.upsert({ ...request, name: 'Different workspace' });
  await assert.rejects(studio.manager.create({ ...request, preparationJobId: ready.id, cultureBrief: ready.baseCultureBrief, workspaceId: workspace.id }), /context has changed/);
});

test('completed preparation survives restart but never starts production on its own', async t => {
  const { studio, config, inspect, runner, calls } = await setup(t); const parent = await prepare(studio);
  const second = await createStudio({ config, inspect, runner }); second.manager.enforceResearchPhases = false; t.after(() => second.close());
  const recovered = second.manager.publicJob(second.manager.get(parent.id));
  assert.equal(recovered.runs[0].preparation.status, 'needs_input'); assert.equal(recovered.runs[0].previewUrl, null);
  assert.equal(second.manager.queue.length, 0); assert.equal(calls.length, 1);
});

test('preparation cannot mutate starter files even through a faulty runner', async t => {
  const { studio } = await setup(t, { mutate: project => project.writeFile('styles.css', 'body{color:red}') });
  const job = await wait(studio, await studio.manager.create({ ...request, kind: 'prepare' }));
  assert.equal(job.status, 'failed'); assert.match(job.error, /protected starter/);
});

test('prepared plan and build share context while a technical skip in Qloo mode needs no forced insights', async t => {
  const { studio } = await setup(t, { key: 'test-only-key' });
  const parent = await prepare(studio); const ready = await wait(studio, await studio.manager.create(responseRequest(parent, { type: 'skip' })));
  const binding = { ...request, preparationJobId: ready.id, cultureBrief: ready.baseCultureBrief };
  const plan = await wait(studio, await studio.manager.create({ ...binding, kind: 'plan', mode: 'qloo' }));
  assert.equal(plan.status, 'completed', plan.error); assert.deepEqual(plan.runs[0].evidence, []);
  const built = await wait(studio, await studio.manager.create({ ...binding, kind: 'build', mode: 'qloo', planJobId: plan.id, planMode: 'qloo', directionId: 'd1' }));
  assert.equal(built.status, 'completed', built.error); assert.deepEqual(built.runs[0].evidence, []);
  assert.ok(built.runs[0].events.some(event => event.message.includes('no Qloo research support')));
});

test('revision preparation retains selected inspiration and rejects a changed target', async t => {
  const { studio } = await setup(t); const parent = await prepare(studio);
  const ready = await wait(studio, await studio.manager.create(responseRequest(parent, { type: 'option', optionId: 'quiet' })));
  const built = await wait(studio, await studio.manager.create({ ...request, preparationJobId: ready.id, cultureBrief: ready.baseCultureBrief }));
  const input = { templateId: built.templateId, brief: 'Give only this hero a quieter original narrative presentation.', kind: 'prepare', intendedKind: 'revise', mode: 'baseline', parentJobId: built.id, parentMode: 'baseline', targetSelector: '#hero', cultureBrief: built.baseCultureBrief };
  const prep = await prepare(studio, input); assert.equal(prep.runs[0].preparation.status, 'ready');
  assert.equal(prep.runs[0].preparation.creativeContext.references[0].origin, 'agent-selected');
  await assert.rejects(studio.manager.create({ ...input, kind: 'revise', preparationJobId: prep.id, targetSelector: '#other' }), /context has changed/);
  const revised = await wait(studio, await studio.manager.create({ ...input, kind: 'revise', preparationJobId: prep.id }));
  assert.equal(revised.status, 'completed', revised.error);
});

test('prepared references cannot fabricate audience preferences or silently delegate selection', () => {
  assert.throws(() => normalizePreparation({ ...artifact, creativeContext: { referencePolicy: 'delegated', references: option.references } }), /user answer/);
  assert.throws(() => normalizePreparation({ ...artifact, options: [{ ...option, references: [{ ...option.references[0], role: 'audience' }] }] }), /invented audience/);
  const delegated = normalizePreparation({ ...artifact, creativeContext: { referencePolicy: 'delegated', references: option.references } }, { cultureBrief: { creativeContext: { referencePolicy: 'delegated' } } });
  assert.equal(delegated.status, 'ready'); assert.equal(delegated.creativeContext.references[0].origin, 'agent-selected');
  assert.throws(() => answerPreparation(normalizePreparation(artifact), { type: 'option', optionId: 'unknown' }), /inspiration option/);
});

test('production and preparation Kiro prompts contain the exact shared policy', () => {
  for (const kind of ['prepare', 'build', 'plan', 'revise']) {
    const prompt = makeDesignPrompt({ template: templates[0], ...request, kind });
    assert.ok(prompt.includes(CREATIVE_POLICY_TEXT));
    assert.ok(prompt.includes('culture_assess_decision'));
  }
});

test('a failed source request is recorded separately from evidence and is not automatically retried', async t => {
  const { studio } = await setup(t, { key: 'test-only-key', researchToolFailure: true });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).startsWith('https://hackathon.api.qloo.com/')
    ? Promise.resolve(new Response('Private upstream response test-only-key', { status: 403 })) : realFetch(url, options);
  t.after(() => { globalThis.fetch = realFetch; });
  const parent = await prepare(studio);
  const ready = await wait(studio, await studio.manager.create(responseRequest(parent, { type: 'option', optionId: 'quiet' })));
  const job = await wait(studio, await studio.manager.create({ ...request, mode: 'qloo', preparationJobId: ready.id, cultureBrief: ready.baseCultureBrief }));
  const run = studio.manager.publicJob(job).runs[0];
  assert.equal(job.status, 'failed'); assert.equal(run.previewUrl, null); assert.deepEqual(run.evidence, []);
  assert.equal(run.researchCalls.length, 1); assert.equal(run.researchCalls[0].status, 'error');
  assert.equal(run.researchCalls[0].sourceRequestAttempted, true); assert.ok(run.researchCalls[0].error.code);
  assert.deepEqual(run.researchCalls[0].query, { seedEntityIds: ['test-only-id'], resultType: 'movie' });
  assert.ok(!JSON.stringify(run).includes('test-only-key')); assert.ok(!JSON.stringify(run).includes('Private upstream'));
});

test('standalone HTTP assessment works without a key and preserves legacy brief tools', async t => {
  const { studio } = await setup(t);
  async function rpc(name, argumentsValue) {
    const response = await fetch(studio.appUrl + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: argumentsValue } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  }
  const assessment = await rpc('culture_assess_decision', { decision, context: { references: [] } });
  assert.equal(assessment.structuredContent.action, 'clarify');
  const legacy = await rpc('culture_validate_brief', { brief: { schemaVersion: '1.0', product: 'An original game project' } });
  assert.equal(legacy.structuredContent.valid, true);
  assert.equal(studio.manager.jobs.size, 0);
});

test('real portable STDIO entrypoint negotiates and assesses without credentials', async () => {
  const child = spawn(process.execPath, ['plugin/server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, QLOO_API_KEY: '', CULTURE_BRIDGE_URL: '', CULTURE_BRIDGE_TOKEN: '' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`STDIO failed (${code}): ${errors}`))); });
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'culture_assess_decision', arguments: { decision, context: {} } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'culture_compile_brief', arguments: { brief: { schemaVersion: '1.0', product: 'An original writing project' } } } },
  ];
  child.stdin.end(messages.map(message => JSON.stringify(message)).join('\n') + '\n');
  await done;
  const responses = output.trim().split(/\r?\n/u).map(line => JSON.parse(line)); assert.equal(responses.length, 3);
  assert.equal(responses[0].result.serverInfo.version, '0.4.0');
  assert.equal(responses[0].result.protocolVersion, '2025-03-26');
  assert.equal(responses[1].result.structuredContent.action, 'clarify');
  assert.equal(responses[2].result.structuredContent.context.product, 'An original writing project');
});

test('imported research keeps original unverified links outside operational Studio evidence', async t => {
  const { studio } = await setup(t);
  const evidence = [{ id: 'Q001', tool: 'qloo_get_insights', status: 'ok', results: [{ entityId: 'source-film', name: 'Imported source film' }] }];
  const records = [{ id: 'external-r1', decision: 'An imported creative choice', question: 'An external question', action: 'research', evidenceIds: ['Q001'], finding: 'Caller-provided finding', interpretation: 'Caller-provided creative interpretation', affectedArtifact: 'External chapter' }];
  const cultureBrief = normalizeCultureBrief({ researchDecisions: records, evidence });
  assert.equal(cultureBrief.importedResearch.provenance, 'caller-provided-unverified');
  assert.equal(cultureBrief.importedResearch.complete, true);
  assert.equal(cultureBrief.importedResearch.evidence[0].verification, 'caller-provided-unverified');
  assert.deepEqual(normalizeCultureBrief(cultureBrief), cultureBrief);
  const orphan = normalizeCultureBrief({ researchDecisions: records });
  assert.equal(orphan.importedResearch.complete, false); assert.deepEqual(normalizeCultureBrief(orphan), orphan);
  const workspace = await studio.workspaces.upsert({ ...request, name: 'Imported context', cultureBrief });
  const job = await wait(studio, await studio.manager.create({ ...request, workspaceId: workspace.id, cultureBrief }));
  assert.equal(job.status, 'completed', job.error); assert.deepEqual(job.runs[0].evidence, []);
  const actual = JSON.parse(await studio.manager.project(job, 'baseline').readFile('culture-brief.json'));
  assert.equal(validateCultureBrief(actual).valid, true); assert.equal(actual.importedResearch, undefined);
  assert.ok(actual.researchDecisions.every(record => record.id !== 'external-r1'));
  const sidecar = JSON.parse(await studio.manager.project(job, 'baseline').readFile('culture-imported-context.json'));
  assert.deepEqual(sidecar.researchDecisions[0].evidenceIds, ['Q001']); assert.equal(sidecar.provenance, 'caller-provided-unverified');
  const exported = await (await fetch(`${studio.appUrl}/api/workspaces/${workspace.id}/export`)).json();
  assert.equal(validateCultureBrief(exported.context).valid, true);
  assert.deepEqual(exported.importedResearch, sidecar); assert.equal(exported.context.importedResearch, undefined);
  assert.ok(exported.context.researchDecisions.every(record => record.id !== 'external-r1'));
  const restored = await studio.workspaces.upsert({ ...request, name: 'Restored imports', cultureBrief: exported.workspaceDraft.cultureBrief });
  assert.deepEqual(restored.cultureBrief.importedResearch, sidecar);
});
