import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStudio } from '../src/server.mjs';
import { getConfig } from '../src/config.mjs';

const context = { brand: { notes: 'Sade ve yerel marka', protectedFiles: ['app.js'], protectedSnippets: [] }, audiences: [
  { id: 'a1', label: 'Birinci grup', references: ['A named movie', 'A named artist'] },
  { id: 'a2', label: 'Second group', references: ['Another named book'] },
] };
const directions = [1, 2, 3].map(n => ({ id: `d${n}`, title: `Test direction ${n}`, summary: 'Test-only creative interpretation', audienceIds: ['a1', 'a2'], anchors: [], changes: [{ selector: '#hero', change: 'A specific presentation change' }], tradeoffs: ['Requires user review'] }));
const sampleHtml = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><section id="hero"><h1>Original heading</h1></section><section id="catalog">Preserved catalogue</section><script src="app.js"></script></body></html>';
async function setup(t, runner, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-workflow-test-'));
  const config = { ...getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, CREATIVE_PROTOCOL: 'research' }), ...extra };
  const studio = await createStudio({ config, inspect: async () => ({ available: true, authenticated: true, defaultModel: 'test-fixed-model' }), runner });
  // These legacy injected fixtures test their original contracts; phase enforcement has separate production-path tests.
  studio.manager.enforceResearchPhases = false;
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return studio;
}
async function wait(studio, id) {
  for (let n = 0; n < 300; n++) { const job = studio.manager.get(id); if (['completed', 'failed', 'cancelled'].includes(job.status)) return studio.manager.publicJob(job); await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Test-only runner did not finish');
}
async function workspace(studio) { return studio.workspaces.upsert({ name: 'Test workspace', templateId: 'local-food', brief: 'Design a useful and original local food site.', cultureBrief: context }); }

test('the production bridge rejects invalid creative records before write and accepts corrected records', async t => {
  const outcomes = [];
  const studio = await setup(t, async ({ project, bridgeUrl, bridgeToken }) => {
    const write = async (file, record) => {
      const response = await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken },
        body: JSON.stringify({ name: 'project_write_file', arguments: { path: file, content: JSON.stringify(record) } }) });
      return response.json();
    };
    const decision = { title: 'Accessible heading', change: 'A heading with visible keyboard focus.', reason: 'Explicit product requirements.', sourceType: 'product-requirement', selectors: ['#hero'], evidenceIds: [], properties: [':focus-visible'] };
    outcomes.push(await write('culture-decisions.json', [decision]));
    await assert.rejects(project.readFile('culture-decisions.json'));
    outcomes.push(await write('culture-decisions.json', [{ ...decision, properties: ['outline'] }]));
    const research = { id: 'r1', decision: 'Keep interactions intact', action: 'skip', reuseKey: '', evidenceIds: [], finding: 'No cultural research needed.', interpretation: 'Product requirement.', affectedArtifact: 'index.html' };
    outcomes.push(await write('culture-research.json', [research]));
    await assert.rejects(project.readFile('culture-research.json'));
    const { reuseKey, ...corrected } = research; void reuseKey;
    outcomes.push(await write('culture-research.json', [corrected]));
    await project.writeFile('index.html', sampleHtml);
  });
  const job = await studio.manager.create({ templateId: 'local-food', brief: 'Improve an original seasonal food site.', mode: 'baseline' });
  const completed = await wait(studio, job.id);
  assert.equal(completed.status, 'completed');
  for (const index of [0, 2]) { assert.equal(outcomes[index].isError, true); assert.equal(outcomes[index].structuredContent.error.code, 'CULTURE_ARTIFACT_INVALID'); }
  for (const index of [1, 3]) assert.equal(outcomes[index].structuredContent.status, 'written');
  assert.equal(completed.runs[0].decisions.length, 1); assert.equal(completed.runs[0].researchDecisions.length, 1);
  assert.ok(!completed.runs[0].events.some(event => /absent or invalid|did not save valid/u.test(event.message)));
});

test('the production bridge verifies source-linked application timing and output without exporting trusted host checks', async t => {
  const studio = await setup(t, async ({ project, bridgeUrl, bridgeToken, onEvidence }) => {
    // Injected test-only source fixture; no Qloo or model request is made.
    await onEvidence({ tool: 'qloo_get_insights', status: 'ok', results: [{ entityId: 'fixture-film', name: 'Fixture film', description: 'A city explored through letters.' }], evidence: {} });
    const write = async (file, content) => (await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken },
      body: JSON.stringify({ name: 'project_write_file', arguments: { path: file, content: typeof content === 'string' ? content : JSON.stringify(content) } }) })).json();
    const record = { id: 'r1', decision: 'Choose how the opening unfolds', question: 'Which returned narrative detail can shape the opening?', action: 'research', evidenceIds: ['Q001'],
      finding: 'The test fixture describes letters.', interpretation: 'Use a letter-shaped opening.', anchors: [{ evidenceId: 'Q001', entityId: 'fixture-film', detail: 'A city explored through letters.' }],
      application: { kind: 'content', priorApproach: 'Plain title.', proposedChange: 'A letter-shaped opening.', outputTarget: 'index.html#hero', observableCheck: 'Read the opening.', tradeoff: 'Longer copy.' }, disposition: 'considered' };
    assert.equal((await write('culture-research.json', [record])).isError, undefined);
    assert.equal((await write('index.html', sampleHtml)).isError, undefined);
    assert.equal((await write('culture-research.json', [{ ...record, disposition: 'applied' }])).isError, undefined);
    await project.writeFile('culture-decisions.json', '[]');
  }, { qlooKey: 'test-fixture-only' });
  const job = await studio.manager.create({ templateId: 'local-food', brief: 'Design a coherent opening for a local food site.', mode: 'qloo' });
  const completed = await wait(studio, job.id);
  assert.equal(completed.status, 'completed', completed.error);
  const check = completed.runs[0].researchDecisions[0].verification;
  assert.equal(check.status, 'checked'); assert.equal(check.planTiming, 'before-write'); assert.equal(check.targetPresence, 'present'); assert.equal(check.targetFragmentChange, 'changed');
  const artifact = JSON.parse(await studio.manager.project(job, 'qloo').readFile('culture-brief.json'));
  assert.equal(Object.hasOwn(artifact.researchDecisions[0], 'verification'), false, 'Portable records cannot import host checks as verified claims.');
});

test('late, missing-target and old research records keep a useful generation while declaring limitations', async t => {
  const studio = await setup(t, async ({ project, bridgeUrl, bridgeToken }) => {
    const write = async (file, content) => (await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken },
      body: JSON.stringify({ name: 'project_write_file', arguments: { path: file, content: typeof content === 'string' ? content : JSON.stringify(content) } }) })).json();
    await write('index.html', sampleHtml);
    const record = { id: 'late', decision: 'A model interpretation opening', action: 'skip', evidenceIds: [], disposition: 'applied',
      application: { kind: 'content', priorApproach: 'Original opening.', proposedChange: 'Changed opening.', outputTarget: 'index.html#hero', observableCheck: 'Read the opening.', tradeoff: 'More copy.' } };
    await write('culture-research.json', [record, { ...record, id: 'missing', application: { ...record.application, outputTarget: 'index.html#absent' } }, { id: 'legacy', decision: 'Old record', action: 'skip', evidenceIds: [] }]);
    await project.writeFile('culture-decisions.json', '[]');
  });
  const job = await studio.manager.create({ templateId: 'local-food', brief: 'Improve the opening while preserving this local food site.', mode: 'baseline' });
  const completed = await wait(studio, job.id);
  assert.equal(completed.status, 'completed', completed.error);
  const checks = completed.runs[0].researchDecisions.map(record => record.verification);
  assert.equal(checks[0].planTiming, 'after-write'); assert.equal(checks[0].sourceAnchors, 'none');
  assert.equal(checks[1].targetPresence, 'missing'); assert.equal(checks[1].status, 'unchecked');
  assert.equal(checks[2].status, 'legacy');
  const loaded = studio.manager.get(job.id); delete loaded.runs[0].researchVerification;
  const legacy = studio.manager.publicJob(loaded).runs[0].researchDecisions[0].verification;
  assert.equal(legacy.status, 'unchecked'); assert.equal(legacy.planTiming, 'untracked'); assert.equal(legacy.sourceAnchors, 'unchecked');
});

test('parallel bridge writes cannot overtake the research declaration transaction', async t => {
  const studio = await setup(t, async ({ project, bridgeUrl, bridgeToken }) => {
    const write = async (file, content) => (await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken },
      body: JSON.stringify({ name: 'project_write_file', arguments: { path: file, content: typeof content === 'string' ? content : JSON.stringify(content) } }) })).json();
    const record = { id: 'ordered', decision: 'A product-first opening', action: 'skip', evidenceIds: [], disposition: 'considered',
      application: { kind: 'content', priorApproach: 'Original opening.', proposedChange: 'Changed opening.', outputTarget: 'index.html#hero', observableCheck: 'Read the opening.', tradeoff: 'More copy.' } };
    const originalWrite = project.writeFile.bind(project);
    let release, entered, siteWriteStarted = false;
    const held = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    project.writeFile = async (file, content) => {
      if (file === 'culture-research.json' && content.includes('considered')) { entered(); await held; }
      if (file === 'index.html') siteWriteStarted = true;
      return originalWrite(file, content);
    };
    const declaration = write('culture-research.json', [record]);
    await started;
    const website = write('index.html', sampleHtml);
    try {
      await new Promise(resolve => setTimeout(resolve, 35));
      assert.equal(siteWriteStarted, false, 'Site writes wait until the declaration snapshot is persisted.');
    } finally { release(); }
    assert.equal((await declaration).isError, undefined); assert.equal((await website).isError, undefined);
    await write('culture-research.json', [{ ...record, disposition: 'applied' }]);
    await project.writeFile('culture-decisions.json', '[]');
  });
  const job = await studio.manager.create({ templateId: 'local-food', brief: 'Improve an opening while preserving the local food site.', mode: 'baseline' });
  const completed = await wait(studio, job.id);
  assert.equal(completed.status, 'completed', completed.error);
  assert.equal(completed.runs[0].researchDecisions[0].verification.planTiming, 'before-write');
});

test('a research declaration after a scoped revision artifact cannot claim preconstruction timing', async t => {
  const studio = await setup(t, async ({ project, job, bridgeUrl, bridgeToken }) => {
    if (job.kind !== 'revise') { await project.writeFile('index.html', sampleHtml); await project.writeFile('culture-decisions.json', '[]'); return; }
    const write = async (file, content) => (await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bridgeToken },
      body: JSON.stringify({ name: 'project_write_file', arguments: { path: file, content: JSON.stringify(content) } }) })).json();
    await write('culture-revision.json', { selector: '#hero', fragment: '<section id="hero"><h1>A revised opening</h1></section>', css: '' });
    await write('culture-research.json', [{ id: 'late-revision', decision: 'A model interpretation opening', action: 'skip', evidenceIds: [], disposition: 'applied',
      application: { kind: 'content', priorApproach: 'Original opening.', proposedChange: 'Revised opening.', outputTarget: 'index.html#hero', observableCheck: 'Read the opening.', tradeoff: 'More copy.' } }]);
    await project.writeFile('culture-decisions.json', '[]');
  });
  const parent = await studio.manager.create({ templateId: 'local-food', brief: 'Improve the original opening of this local food site.', mode: 'baseline' });
  assert.equal((await wait(studio, parent.id)).status, 'completed');
  const child = await studio.manager.create({ templateId: 'local-food', brief: 'Change only the hero opening for this local food site.', kind: 'revise', mode: 'baseline', parentJobId: parent.id, parentMode: 'baseline', targetSelector: '#hero' });
  const completed = await wait(studio, child.id);
  assert.equal(completed.status, 'completed', completed.error);
  assert.equal(completed.runs[0].researchDecisions[0].verification.planTiming, 'after-write');
  assert.equal(completed.runs[0].researchDecisions[0].verification.targetFragmentChange, 'changed');
});

test('workspaces save, reload and export context without Qloo or a model call', async t => {
  let calls = 0; const studio = await setup(t, async () => { calls++; });
  const response = await fetch(studio.appUrl + '/api/workspaces', { method: 'POST', body: JSON.stringify({ name: 'Persistent brief', templateId: 'local-food', brief: 'An explicit design requirement.', cultureBrief: context }) });
  assert.equal(response.status, 201); const saved = await response.json();
  const exported = await (await fetch(studio.appUrl + `/api/workspaces/${saved.id}/export`)).json();
  assert.deepEqual(exported.context.audiences, saved.cultureBrief.audiences);
  assert.equal(exported.context.evidence.length, 0); assert.equal(calls, 0);
  const conflict = await fetch(studio.appUrl + `/api/workspaces/${saved.id}`, { method: 'PUT', body: JSON.stringify({ brief: 'Updated design requirement.', version: saved.version - 1 }) }); assert.equal(conflict.status, 409);
});

test('a real planning artifact is selectable and drives a single audience variant', async t => {
  const prompts = []; const studio = await setup(t, async ({ project, job, prompt }) => {
    prompts.push(prompt);
    if (job.kind === 'plan') await project.writeFile('culture-directions.json', JSON.stringify(directions));
    else await project.writeFile('index.html', sampleHtml);
    await project.writeFile('culture-decisions.json', JSON.stringify([{ title: 'Test-specific direction', change: 'Hero changed', reason: 'Product requirements', sourceType: 'product-requirement', evidenceIds: [], selectors: ['#hero'], properties: ['layout'] }]));
  });
  const saved = await workspace(studio);
  const plan = await studio.manager.create({ workspaceId: saved.id, kind: 'plan', mode: 'baseline' });
  const ready = await wait(studio, plan.id); assert.equal(ready.status, 'completed'); assert.equal(ready.runs[0].directions.length, 3); assert.equal(ready.runs[0].previewUrl, null);
  const build = await studio.manager.create({ workspaceId: saved.id, kind: 'build', mode: 'baseline', planJobId: plan.id, planMode: 'baseline', directionId: 'd2', audienceId: 'a2' });
  const built = await wait(studio, build.id); assert.equal(built.status, 'completed'); assert.ok(prompts[1].includes('Test direction 2')); assert.ok(prompts[1].includes('Target audience ID: a2'));
  assert.deepEqual(built.runs[0].decisions[0].selectors, ['#hero']);
  const record = await (await fetch(studio.appUrl + `/api/workspaces/${saved.id}`)).json(); assert.equal(record.variants.length, 1);
  assert.ok(built.runs[0].diff.files.some(f => f.path === 'index.html'));
});

test('protected product code violations fail instead of exposing a preview', async t => {
  const studio = await setup(t, async ({ project }) => { await project.writeFile('index.html', sampleHtml); await project.writeFile('app.js', 'unexpected replacement'); });
  const saved = await workspace(studio); const job = await studio.manager.create({ workspaceId: saved.id, mode: 'baseline' }); const done = await wait(studio, job.id);
  assert.equal(done.status, 'failed'); assert.equal(done.runs[0].previewUrl, null);
});

test('scoped revision preserves source, applies real diff and supports accept/revert', async t => {
  const studio = await setup(t, async ({ project, job }) => {
    if (job.kind === 'revise') await project.writeFile('culture-revision.json', JSON.stringify({ selector: '#hero', fragment: '<section id="hero"><h1>Revised heading</h1></section>', css: '#hero { color: olive; }' }));
    else await project.writeFile('index.html', sampleHtml);
    await project.writeFile('culture-decisions.json', JSON.stringify([{ title: 'Hero direction', change: 'Heading presentation', reason: 'Explicit request', selectors: ['#hero'], sourceType: 'product-requirement', evidenceIds: [] }]));
  });
  const saved = await workspace(studio); const first = await studio.manager.create({ workspaceId: saved.id, mode: 'baseline' }); const before = await wait(studio, first.id); assert.equal(before.status, 'completed');
  const child = await studio.manager.create({ workspaceId: saved.id, kind: 'revise', mode: 'baseline', parentJobId: first.id, parentMode: 'baseline', targetSelector: '#hero', brief: 'Change only the selected hero to a calm presentation.' });
  const revised = await wait(studio, child.id); assert.equal(revised.status, 'completed');
  assert.match(await studio.manager.project(first, 'baseline').readFile('index.html'), /Original heading/);
  assert.match(await studio.manager.project(child, 'baseline').readFile('index.html'), /Revised heading/);
  assert.match(await studio.manager.project(child, 'baseline').readFile('index.html'), /Preserved catalogue/);
  assert.equal(await studio.manager.project(first, 'baseline').readFile('app.js'), await studio.manager.project(child, 'baseline').readFile('app.js'));
  for (const jobId of [child.id, first.id]) {
    const response = await fetch(studio.appUrl + `/api/workspaces/${saved.id}/select`, { method: 'POST', body: JSON.stringify({ jobId, mode: 'baseline' }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).selectedVariant.jobId, jobId);
  }
  const preview = await fetch(revised.runs[0].previewUrl); assert.match(await preview.text(), /__culture-inspector\.js/);
  const script = await fetch(new URL('__culture-inspector.js', revised.runs[0].previewUrl)); assert.equal(script.status, 200);
  assert.ok(revised.runs[0].diff.files.some(f => f.path === 'styles.css'));
});

test('Qloo-derived plans cannot contaminate a baseline comparison', async t => {
  const studio = await setup(t, async ({ project, onEvidence }) => {
    await onEvidence({ tool: 'qloo_get_insights', status: 'ok', results: [{ entityId: 'test-entity', name: 'Test fixture only' }], evidence: {} });
    const planned = structuredClone(directions); planned[0].anchors = [{ entityId: 'test-entity', evidenceId: 'Q001' }];
    await project.writeFile('culture-directions.json', JSON.stringify(planned));
  }, { qlooKey: 'test-fixture-only' });
  const saved = await workspace(studio); const job = await studio.manager.create({ workspaceId: saved.id, kind: 'plan', mode: 'qloo' }); assert.equal((await wait(studio, job.id)).status, 'completed');
  await assert.rejects(studio.manager.create({ workspaceId: saved.id, mode: 'baseline', planJobId: job.id, planMode: 'qloo', directionId: 'd1' }), /baseline mode/);
});
