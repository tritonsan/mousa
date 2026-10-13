import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStudio } from '../src/server.mjs';
import { getConfig } from '../src/config.mjs';
import { validateCultureBrief } from '../plugin/server/culture/brief.mjs';

const originalBrief = 'Design a quiet local food shop for film collectors.';
const originalCulture = { brand: { notes: 'Original brand', protectedFiles: ['app.js'], protectedSnippets: [] },
  audiences: [{ id: 'a1', label: 'Original audience', references: ['Original reference'] }] };
const directions = [1, 2, 3].map(number => ({ id: 'd' + number, title: 'Test-only direction ' + number, summary: 'Creative interpretation, not cultural proof.',
  audienceIds: ['a1'], anchors: [], changes: [{ selector: '#hero', change: 'A concrete heading change.' }], tradeoffs: [] }));
const html = '<!doctype html><html><head><title>Test-only site</title></head><body><section id="hero"><h1>A complete test-only changed heading</h1></section><script src="app.js"></script></body></html>';

async function setup(t, { revisionFragment = '<section id="hero"><h1>A revised heading</h1></section>' } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-workflow-audit-'));
  const config = getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, CREATIVE_PROTOCOL: 'research' });
  const studio = await createStudio({ config, inspect: async () => ({ available: true, authenticated: true, defaultModel: 'test-only-model' }),
    runner: async ({ project, job }) => {
      if (job.kind === 'plan') await project.writeFile('culture-directions.json', JSON.stringify(directions));
      else if (job.kind === 'revise') await project.writeFile('culture-revision.json', JSON.stringify({ selector: '#hero', fragment: revisionFragment, css: '#hero { color: olive; }' }));
      else await project.writeFile('index.html', html);
      await project.writeFile('culture-decisions.json', '[]');
    } });
  // The fixture intentionally omits the newly required research phases.
  studio.manager.enforceResearchPhases = false;
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return studio;
}
async function terminal(studio, job) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const current = studio.manager.get(job.id);
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return current;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Test-only runner did not complete.');
}
async function wait(studio, job) {
  const current = await terminal(studio, job);
  assert.equal(current.status, 'completed', current.error);
  return current;
}
async function workspace(studio) {
  return studio.workspaces.upsert({ name: 'Audit workspace', templateId: 'local-food', brief: originalBrief, cultureBrief: originalCulture });
}

test('a direction plan cannot be reused after the product brief changes', async t => {
  const studio = await setup(t), saved = await workspace(studio);
  const plan = await wait(studio, await studio.manager.create({ workspaceId: saved.id, kind: 'plan', mode: 'baseline' }));
  await studio.workspaces.upsert({ brief: 'Design a fast convenience shop for office commuters.' }, saved.id);
  await assert.rejects(studio.manager.create({ workspaceId: saved.id, kind: 'build', mode: 'baseline', planJobId: plan.id, planMode: 'baseline', directionId: 'd1' }));
});

test('standalone plans cannot be reused with a different cultural context', async t => {
  const studio = await setup(t);
  const plan = await wait(studio, await studio.manager.create({ templateId: 'local-food', brief: originalBrief, cultureBrief: originalCulture, kind: 'plan', mode: 'baseline' }));
  await assert.rejects(studio.manager.create({ templateId: 'local-food', brief: originalBrief, cultureBrief: { ...originalCulture, brand: { ...originalCulture.brand, notes: 'Different brand' } }, mode: 'baseline', planJobId: plan.id, planMode: 'baseline', directionId: 'd1' }), /brief has changed/);
});

test('selected variant export uses its immutable context rather than the edited workspace draft', async t => {
  const studio = await setup(t), saved = await workspace(studio);
  const built = await wait(studio, await studio.manager.create({ workspaceId: saved.id, mode: 'baseline' }));
  await studio.workspaces.select(saved.id, { jobId: built.id, mode: 'baseline' });
  await studio.workspaces.upsert({ brief: 'Design a bright fast shop for an entirely new audience.', cultureBrief: {
    brand: { notes: 'Changed brand', protectedFiles: ['app.js'], protectedSnippets: [] },
    audiences: [{ id: 'b1', label: 'Different audience', references: ['Different reference'] }],
  } }, saved.id);
  const response = await fetch(studio.appUrl + `/api/workspaces/${saved.id}/export`);
  assert.equal(response.status, 200);
  const exported = await response.json();
  assert.equal(exported.context.product.brief, built.brief);
  assert.deepEqual(exported.context.brand, built.cultureBrief.brand);
  assert.deepEqual(exported.context.audiences, built.cultureBrief.audiences);
  assert.equal(exported.exportedFrom, 'selected-variant');
  assert.equal(exported.workspaceDraft.brief, 'Design a bright fast shop for an entirely new audience.');
  const imported = await studio.workspaces.upsert(exported);
  assert.equal(imported.brief, originalBrief);
  assert.deepEqual(imported.cultureBrief, built.cultureBrief);
});

test('latest workspace export uses creation time after nonchronological job loading', async t => {
  const studio = await setup(t), saved = await workspace(studio);
  const older = await wait(studio, await studio.manager.create({ workspaceId: saved.id, mode: 'baseline' }));
  await studio.workspaces.upsert({ brief: 'Choose a new seasonal collection direction for this local food shop.' }, saved.id);
  const newer = await wait(studio, await studio.manager.create({ workspaceId: saved.id, mode: 'baseline' }));
  older.createdAt = '2026-10-02T10:00:00.000Z'; newer.createdAt = '2026-10-02T11:00:00.000Z';
  // Filesystem UUID order after restart need not match creation order.
  studio.manager.jobs = new Map([[newer.id, newer], [older.id, older]]);
  const exported = await (await fetch(studio.appUrl + `/api/workspaces/${saved.id}/export`)).json();
  assert.equal(exported.exportedFrom, 'latest-completed-work');
  assert.equal(exported.source.jobId, newer.id); assert.equal(exported.context.product.brief, newer.brief);
  await studio.workspaces.select(saved.id, { jobId: older.id, mode: 'baseline' });
  const selected = await (await fetch(studio.appUrl + `/api/workspaces/${saved.id}/export`)).json();
  assert.equal(selected.exportedFrom, 'selected-variant'); assert.equal(selected.source.jobId, older.id);
});

test('the Studio cultural brief artifact is accepted by the portable plugin validator', async t => {
  const studio = await setup(t), saved = await workspace(studio);
  const built = await wait(studio, await studio.manager.create({ workspaceId: saved.id, mode: 'baseline', audienceId: 'a1' }));
  const response = await fetch(studio.appUrl + `/api/jobs/${built.id}/runs/baseline/brief`);
  assert.equal(response.status, 200);
  const artifact = await response.json();
  const portable = artifact.context || artifact;
  const validation = validateCultureBrief(portable);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('revision artifacts keep the original product brief separate from the revision request', async t => {
  const studio = await setup(t), saved = await workspace(studio);
  const parent = await wait(studio, await studio.manager.create({ workspaceId: saved.id, mode: 'baseline' }));
  const request = 'Change only this hero heading to a quieter presentation.';
  const child = await wait(studio, await studio.manager.create({ workspaceId: saved.id, kind: 'revise', mode: 'baseline', parentJobId: parent.id, parentMode: 'baseline', targetSelector: '#hero', brief: request }));
  const artifact = JSON.parse(await studio.manager.project(child, 'baseline').readFile('culture-brief.json'));
  assert.equal(artifact.product.brief, originalBrief);
  assert.equal(artifact.revisionRequest, request);
  assert.equal(validateCultureBrief(artifact).valid, true);
  assert.equal(await studio.manager.project(parent, 'baseline').readFile('index.html'), html);
});

test('revision cannot silently discard source brand locks when the workspace is omitted', async t => {
  const studio = await setup(t, { revisionFragment: '<section id="hero"><h2>The source locked markup was removed</h2></section>' });
  const cultureBrief = structuredClone(originalCulture);
  cultureBrief.brand.protectedSnippets = [{ path: 'index.html', text: '<h1>' }];
  const saved = await studio.workspaces.upsert({ name: 'Locked source', templateId: 'local-food', brief: originalBrief, cultureBrief });
  const parent = await wait(studio, await studio.manager.create({ workspaceId: saved.id, mode: 'baseline' }));
  let revision;
  try {
    revision = await studio.manager.create({ templateId: 'local-food', kind: 'revise', mode: 'baseline', parentJobId: parent.id, parentMode: 'baseline', targetSelector: '#hero', brief: 'Revise this heading without dropping the source brand locks.' });
  } catch (error) {
    assert.equal(error.status, 400);
    return;
  }
  const done = await terminal(studio, revision);
  assert.equal(done.status, 'failed', 'A locked source must not become an unprotected completed revision.');
  assert.match(done.error, /lock|koruma|kaynak/i);
  assert.equal(await studio.manager.project(parent, 'baseline').readFile('index.html'), html);
});
