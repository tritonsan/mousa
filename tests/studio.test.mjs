import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getConfig } from '../src/config.mjs';
import { FileProject, validateProjectPath } from '../src/project.mjs';
import { createStudio } from '../src/server.mjs';
import { prepareKiroWorkspace } from '../src/kiro-runner.mjs';
import { templates } from '../src/templates.mjs';

const readyKiro = async () => ({ available: true, authenticated: true, version: 'test-only', defaultModel: 'fixed-test-model' });
async function setup(t, overrides = {}, runner) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-studio-test-'));
  const config = { ...getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, CREATIVE_PROTOCOL: 'research' }), ...overrides };
  const studio = await createStudio({ config, inspect: readyKiro, runner });
  // Preserve legacy fixture coverage; dedicated phase tests keep the default enforcement enabled.
  studio.manager.enforceResearchPhases = false;
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return studio;
}
async function terminal(studio, id) {
  for (let i = 0; i < 200; i++) {
    const job = studio.manager.publicJob(studio.manager.get(id));
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Test job did not finish.');
}
const request = { templateId: 'local-food', brief: 'A calm local food shop with a working product selection.', mode: 'baseline' };

test('public binding requires gated access and explicit preview origin', () => {
  assert.throws(() => getConfig({ HOST: '0.0.0.0' }), /DEMO_ACCESS_TOKEN/);
  assert.throws(() => getConfig({ HOST: '0.0.0.0', DEMO_ACCESS_TOKEN: 'a'.repeat(32) }), /PREVIEW/);
});

test('Kiro job configuration restricts tools and disables inherited resources', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-kiro-config-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const home = await prepareKiroWorkspace({ directory, config: getConfig({}), model: 'fixed-test-model', bridgeUrl: 'http://127.0.0.1:8787/internal/tools', bridgeToken: 'test-only', mode: 'baseline' });
  const agent = JSON.parse(await fs.readFile(path.join(home, 'agents', 'culture-demo.json'), 'utf8'));
  assert.deepEqual(agent.tools, ['@culture']);
  assert.deepEqual(agent.allowedTools, ['@culture']);
  assert.deepEqual(agent.resources, []);
  assert.equal(agent.includeMcpJson, false);
  assert.equal(agent.includePowers, false);
  assert.equal(agent.model, 'fixed-test-model');
  assert.equal(agent.mcpServers.culture.env.CULTURE_ENABLE_QLOO, 'false');
  assert.equal(agent.mcpServers.culture.env.QLOO_API_KEY, undefined);
  for (const location of [path.join(home, 'settings', 'cli.json'), path.join(directory, '.kiro', 'settings', 'cli.json')]) {
    const settings = JSON.parse(await fs.readFile(location, 'utf8'));
    assert.equal(settings['chat.disableInheritingDefaultResources'], true);
    assert.equal(settings['app.disableAutoupdates'], true, 'a run never updates Kiro when it starts');
  }
});
test('project rejects absolute, traversing, private and executable paths', () => {
  for (const file of ['../.env', '/etc/passwd', 'C:\\keys.txt', '.kiro/agents/x.json', 'a/../x.html', 'a//x.css', 'run.exe', 'x\0.html']) assert.throws(() => validateProjectPath(file));
  assert.equal(validateProjectPath('assets/mark.svg'), 'assets/mark.svg');
});
test('scoped project bounds file and aggregate sizes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-project-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = new FileProject(directory, { maxFileBytes: 10, maxProjectBytes: 15, maxFiles: 2 });
  await project.writeFile('a.txt', '1234567890');
  await assert.rejects(project.writeFile('b.txt', '123456'), /size limit/);
  await assert.rejects(project.writeFile('a.txt', '12345678901'), /too large/);
});
test('Qloo missing preflight prevents comparison before any model call', async t => {
  let calls = 0; const studio = await setup(t, {}, async () => { calls++; });
  const response = await fetch(studio.appUrl + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, mode: 'compare' }) });
  assert.equal(response.status, 503); assert.equal(calls, 0); assert.equal(studio.manager.jobs.size, 0);
});
test('access token and cross-origin requests are enforced', async t => {
  const studio = await setup(t, { accessToken: 'a'.repeat(32) }, async () => {});
  let response = await fetch(studio.appUrl + '/api/jobs', { method: 'POST', body: JSON.stringify(request) });
  assert.equal(response.status, 401);
  response = await fetch(studio.appUrl + '/api/jobs', { method: 'POST', headers: { 'X-Demo-Token': 'a'.repeat(32), Origin: 'https://unrelated.example' }, body: JSON.stringify(request) });
  assert.equal(response.status, 403);
});
test('baseline generation publishes actual saved files on a separate limited preview', async t => {
  const studio = await setup(t, {}, async ({ project }) => {
    await project.writeFile('index.html', '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>A changed test-only website</h1><script src="app.js"></script></body></html>');
    await project.writeFile('culture-decisions.json', JSON.stringify([{ title: 'Clear content', change: 'Changed hero', reason: 'Product brief', sourceType: 'qloo', evidenceIds: ['fabricated'] }]));
  });
  const response = await fetch(studio.appUrl + '/api/jobs', { method: 'POST', body: JSON.stringify(request) });
  assert.equal(response.status, 202); const { id } = await response.json(); const job = await terminal(studio, id);
  assert.equal(job.status, 'completed'); const run = job.runs[0];
  assert.equal(run.evidence.length, 0); assert.equal(run.decisions[0].sourceType, 'model-interpretation'); assert.deepEqual(run.decisions[0].evidenceIds, []);
  assert.notEqual(new URL(run.previewUrl).origin, new URL(studio.appUrl).origin);
  const preview = await fetch(run.previewUrl); assert.equal(preview.status, 200);
  const policy = preview.headers.get('content-security-policy');
  assert.match(policy, /sandbox allow-scripts allow-forms/);
  assert.match(policy, /form-action 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.doesNotMatch(policy, /allow-same-origin/);
  assert.match(await preview.text(), /test-only/);
  const asset = await fetch(new URL('styles.css', run.previewUrl)); assert.equal(asset.status, 200);
  const invalid = run.previewUrl.replace(/\/[a-f0-9]{48}\//, '/' + 'b'.repeat(48) + '/'); assert.equal((await fetch(invalid)).status, 403);
});
test('both modes start from identical files and use one captured model', async t => {
  const starts = [], models = [], prompts = [];
  const studio = await setup(t, { qlooKey: 'test-placeholder-not-live' }, async ({ project, mode, model, prompt, onEvidence }) => {
    starts.push(await project.fingerprint()); models.push(model); prompts.push(prompt);
    await project.writeFile('index.html', (await project.readFile('index.html')).replace('</body>', '<p>Test artifact changed</p></body>'));
    if (mode === 'qloo') await onEvidence({ tool: 'qloo_get_insights', status: 'ok', results: [{ entityId: 'test-only', name: 'Not production data' }], evidence: {} });
  });
  const job = await studio.manager.create({ ...request, mode: 'compare' }); const done = await terminal(studio, job.id);
  assert.equal(done.status, 'completed'); assert.equal(starts[0], starts[1]); assert.deepEqual(models, ['fixed-test-model', 'fixed-test-model']);
  assert.ok(prompts.every(p => p.includes(request.brief)));
});
test('Qloo mode without real insights is not presented as a successful Qloo result', async t => {
  const studio = await setup(t, { qlooKey: 'test-only' }, async ({ project }) => {
    await project.writeFile('index.html', (await project.readFile('index.html')).replace('</body>', '<p>Changed</p></body>'));
  });
  const job = await studio.manager.create({ ...request, mode: 'qloo' }); const done = await terminal(studio, job.id);
  assert.equal(done.status, 'failed'); assert.equal(done.runs[0].previewUrl, null); assert.match(done.error, /insights/);
});
test('no changed site is not silently promoted to a successful generation', async t => {
  const studio = await setup(t, {}, async () => {});
  const job = await studio.manager.create(request); const done = await terminal(studio, job.id);
  assert.equal(done.status, 'failed'); assert.match(done.error, /did not change/);
});
test('standalone HTTP MCP exposes cultural tools but no demo file tools', async t => {
  const studio = await setup(t);
  const response = await fetch(studio.appUrl + '/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const result = await response.json();
  assert.ok(result.result.tools.some(t => t.name === 'qloo_get_insights'));
  assert.ok(result.result.tools.some(t => t.name === 'culture_compile_brief'));
  assert.ok(result.result.tools.every(t => !t.name.startsWith('project_')));
});
test('all six neutral starters contain real local interactions', () => {
  assert.equal(templates.length, 6);
  for (const template of templates) {
    assert.ok(template.files['index.html']); assert.ok(template.files['app.js'].length > 100); assert.ok(template.files['styles.css']);
  }
});
