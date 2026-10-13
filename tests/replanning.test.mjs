import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStudio } from '../src/server.mjs';
import { getConfig } from '../src/config.mjs';
import { normalizeCreativePlan, normalizeCreativeReconsideration, normalizeCultureBrief } from '../src/design-artifacts.mjs';

const plan = { schemaVersion: '1.0', decisions: [{ id: 'opening', decision: 'Choose an opening experience.', initialApproach: 'A direct feature list.',
  alternatives: ['A local discovery interaction.'], openQuestions: ['Could a discovery sequence explain the product?'], fixedFacts: ['Keep the existing wishlist.'] }] };
const reconsideration = (webSourceIds = []) => ({ schemaVersion: '1.0', summary: 'A bounded design interpretation after research.', decisions: [{ decisionId: 'opening', outcome: webSourceIds.length ? 'refine' : 'keep',
  reason: webSourceIds.length ? 'The literal test fixture mentions discovering connections.' : 'No additional recorded research supports a change.', approach: 'An opening with a direct route to the wishlist.', evidenceIds: [], webSourceIds,
  rejectedAlternatives: [], limitations: ['This fixture does not establish design quality or cultural benefit.'] }] });
const html = '<!doctype html><html><head><title>Phase fixture</title></head><body><section id="hero"><h1>A changed test-only opening</h1></section><script src="app.js"></script></body></html>';
const sourceResponse = { results: [{ url: 'https://www.mobiusdigitalgames.com/outer-wilds.html', title: 'Literal fixture reference', snippet: 'A fixture describes discovering connections through exploration.' }] };

async function setup(t, runner, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-replanning-test-'));
  const config = { ...getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, CREATIVE_PROTOCOL: 'research' }), ...overrides };
  const studio = await createStudio({ config, inspect: async () => ({ available: true, authenticated: true, defaultModel: 'test-only-model' }), runner });
  t.after(async () => { await studio.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return studio;
}
async function wait(studio, job) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const current = studio.manager.publicJob(studio.manager.get(job.id));
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return current;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Phase fixture did not finish.');
}
function client({ bridgeUrl, bridgeToken, webBridgeToken }) {
  const call = async (token, name, args) => (await fetch(bridgeUrl + '/internal/tools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name, arguments: args }) })).json();
  return {
    tool: (name, args = {}) => call(bridgeToken, name, args),
    hook: (name, args = {}) => call(webBridgeToken, name, args),
    write: (file, content) => call(bridgeToken, 'project_write_file', { path: file, content: typeof content === 'string' ? content : JSON.stringify(content) }),
  };
}

test('provisional and reconsidered plans keep explicit alternatives and validate recorded source links', () => {
  const normalized = normalizeCreativePlan({ ...plan, verification: 'claimed' });
  assert.equal(normalized.sourceType, 'model-interpretation'); assert.equal(Object.hasOwn(normalized, 'verification'), false);
  assert.throws(() => normalizeCreativePlan({ ...plan, decisions: [{ ...plan.decisions[0], alternatives: [] }] }), /alternative/u);
  assert.throws(() => normalizeCreativeReconsideration(reconsideration(['W001']), { plan }), /unavailable recorded web/u);
  assert.throws(() => normalizeCreativeReconsideration({ ...reconsideration(), decisions: [] }, { plan }), /every provisional decision/u);
  const result = normalizeCreativeReconsideration(reconsideration(['W001']), { plan, webSources: [{ id: 'W001', status: 'ok' }] });
  assert.equal(result.decisions[0].outcome, 'refine'); assert.equal(result.sourceType, 'model-interpretation');
});

test('default production phases reject source/production shortcuts and cannot be forged with the agent token', async t => {
  let checks;
  const studio = await setup(t, async args => {
    const { tool, hook, write } = client(args);
    checks = [];
    checks.push(await write('index.html', html));
    checks.push(await write('culture-experience.js', 'document.body.dataset.phaseFixture = "early";'));
    checks.push(await hook('studio_web_before', { toolName: 'web_search', input: { query: 'test-only reference' } }));
    checks.push(await tool('studio_web_after', { toolName: 'web_search', input: { query: 'test-only reference' }, response: sourceResponse }));
    checks.push(await hook('project_write_file', { path: 'index.html', content: html }));
    assert.equal((await write('culture-plan.json', plan)).isError, undefined);
    checks.push(await tool('project_get_research', { claimedSource: 'https://www.mobiusdigitalgames.com/' }));
    checks.push(await write('culture-research.json', [{ id: 'early', decision: 'Choose an opening.', action: 'skip', evidenceIds: [], disposition: 'considered',
      application: { kind: 'content', priorApproach: 'A direct opening.', proposedChange: 'A shorter opening.', outputTarget: 'index.html#hero', observableCheck: 'Read the opening.', tradeoff: 'Less introductory copy.' } }]));
    checks.push(await write('index.html', html));
    assert.equal((await write('culture-reconsideration.json', reconsideration())).isError, undefined);
    assert.equal((await write('index.html', html)).isError, undefined);
    await write('culture-decisions.json', []); await write('culture-research.json', []);
  });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Design a useful exploration game launch site.', mode: 'baseline' }));
  assert.equal(done.status, 'completed', done.error);
  assert.ok(checks.every(result => result.isError === true));
  assert.equal(done.runs[0].webSources.length, 0); assert.equal(done.runs[0].creativePipeline.status, 'completed');
  assert.equal(done.runs[0].provisionalPlan.decisions.length, 1);
});

test('native research invalidates reconsideration, captures literal records and enforces the last thinking stage before construction', async t => {
  const studio = await setup(t, async args => {
    const { tool, hook, write } = client(args);
    assert.equal((await write('culture-plan.json', plan)).isError, undefined);
    assert.equal((await write('culture-reconsideration.json', reconsideration())).isError, undefined);
    const native = { toolName: 'web_search', input: { query: 'A named reference and its discovery design' } };
    // This payload stands in for the private native hook; it makes no external or model request.
    assert.equal((await hook('studio_web_before', native)).structuredContent.status, 'allowed');
    assert.equal((await write('index.html', html)).isError, true);
    assert.equal((await write('culture-reconsideration.json', reconsideration())).isError, true, 'Pending source calls cannot be reconsidered.');
    assert.equal((await write('culture-plan.json', plan)).isError, true, 'A researched plan cannot be overwritten retrospectively.');
    const captured = await hook('studio_web_after', { ...native, response: sourceResponse });
    assert.deepEqual(captured.structuredContent.sourceIds, ['W001']);
    const observed = (await tool('project_get_research')).structuredContent;
    assert.equal(observed.reconsideration, null); assert.equal(observed.webSources[0].excerpt, sourceResponse.results[0].snippet);
    assert.equal(observed.webSources[0].provenance, 'studio-recorded-native-web-response');
    assert.equal((await write('culture-reconsideration.json', reconsideration(['invented']))).isError, true);
    assert.equal((await write('culture-reconsideration.json', reconsideration(['W001']))).isError, undefined);
    await write('index.html', html); await write('culture-decisions.json', []);
    await write('culture-research.json', [{ id: 'opening', decision: 'Choose an opening', action: 'skip', evidenceIds: [], webSourceIds: ['W001'],
      webAnchors: [{ sourceId: 'W001', detail: 'discovering connections through exploration' }], interpretation: 'A model interpretation of a literal source fixture.' }]);
    assert.equal((await hook('studio_web_before', { toolName: 'web_search', input: { query: 'More research after construction' } })).isError, true);
  });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Build an exploration game launch with preserved interactions.', mode: 'baseline' }));
  assert.equal(done.status, 'completed', done.error);
  const run = done.runs[0]; assert.equal(run.webCalls.length, 1); assert.equal(run.webSources.length, 1);
  assert.equal(run.researchDecisions[0].webAnchors.length, 1);
  assert.ok(run.creativePipeline.planSavedAt <= run.webCalls[0].startedAt);
  assert.ok(run.webCalls[0].finishedAt <= run.creativePipeline.reconsideredAt);
  assert.ok(run.creativePipeline.reconsideredAt <= run.creativePipeline.constructionStartedAt);
  const exported = JSON.parse(await studio.manager.project(studio.manager.get(done.id), 'baseline').readFile('culture-brief.json'));
  assert.equal(Object.hasOwn(exported.webSources[0], 'provenance'), false);
  const imported = normalizeCultureBrief(exported);
  assert.equal(imported.importedResearch.provenance, 'caller-provided-unverified');
  assert.equal(imported.importedResearch.webSources[0].verification, 'caller-provided-unverified');
});

test('native hook budgets and failed responses cannot become successful research', async t => {
  const studio = await setup(t, async args => {
    const { hook, write } = client(args); await write('culture-plan.json', plan);
    for (const url of ['http://127.0.0.1:8787/', 'https://docs.qloo.com/?api_key=not-a-real-secret', 'http://10.0.0.1/']) {
      assert.equal((await hook('studio_web_before', { toolName: 'web_fetch', input: { url } })).isError, true);
    }
    assert.equal((await hook('studio_web_after', { toolName: 'web_search', input: { query: 'Never authorized' }, response: sourceResponse })).isError, true);
    for (let index = 0; index < 6; index++) {
      const native = { toolName: 'web_search', input: { query: `Empty fixture ${index}` } };
      assert.equal((await hook('studio_web_before', native)).structuredContent.status, 'allowed');
      await hook('studio_web_after', { ...native, response: index === 0 ? { isError: true, error: 'Fixture unavailable' } : { results: [] }, ...(index === 0 ? { status: 'error' } : {}) });
    }
    assert.equal((await hook('studio_web_before', { toolName: 'web_search', input: { query: 'Over budget' } })).isError, true);
    await write('culture-reconsideration.json', reconsideration()); await write('index.html', html);
    await write('culture-decisions.json', []); await write('culture-research.json', []);
  });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Design a coherent fictional exploration launch.', mode: 'baseline' }));
  assert.equal(done.status, 'completed', done.error);
  assert.equal(done.runs[0].webSources.length, 0); assert.equal(done.runs[0].webCalls.length, 6);
  assert.equal(done.runs[0].webCalls[0].status, 'error'); assert.equal(done.runs[0].webCalls[1].status, 'empty');
  assert.ok(done.runs[0].webCalls.every(call => call.limitation));
});

test('missing research phases fail generation and historical jobs retain a null phase record', async t => {
  const studio = await setup(t, async ({ project }) => { await project.writeFile('index.html', html); });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Build an exploration launch with a real local wishlist.', mode: 'baseline' }));
  assert.equal(done.status, 'failed'); assert.match(done.error, /stages were not completed/u); assert.equal(done.runs[0].previewUrl, null);
  const job = studio.manager.get(done.id); delete job.runs[0].creativePipeline; delete job.runs[0].provisionalPlan; delete job.runs[0].reconsideration;
  const historical = studio.manager.publicJob(job).runs[0];
  assert.equal(historical.creativePipeline, null); assert.equal(historical.provisionalPlan, null); assert.equal(historical.reconsideration, null);
});

test('Qloo source calls are rejected before provisional planning without making an upstream request', async t => {
  let blocked;
  const studio = await setup(t, async args => {
    const { tool, write } = client(args);
    blocked = await tool('qloo_get_insights', { seedEntityIds: ['test-only-nonexistent-entity'], resultType: 'videogame', limit: 1 });
    await write('culture-plan.json', plan); await write('culture-reconsideration.json', reconsideration());
  }, { qlooKey: 'test-only-never-sent-key', qlooBaseUrl: 'https://127.0.0.1:1' });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Consider an exploration game launch introduction.', mode: 'qloo' }));
  assert.equal(blocked.isError, true); assert.equal(blocked.structuredContent.error.code, 'CREATIVE_PHASE_REQUIRED');
  assert.equal(done.runs[0].evidence.length, 0); assert.equal(done.runs[0].researchCalls.length, 0);
  assert.equal(done.status, 'failed'); assert.match(done.error, /No usable Qloo insights/u);
});

test('rewriting a provisional plan invalidates its earlier reconsideration', async t => {
  const studio = await setup(t, async args => {
    const { tool, write } = client(args);
    await write('culture-plan.json', plan); await write('culture-reconsideration.json', reconsideration());
    await write('culture-plan.json', { ...plan, decisions: [{ ...plan.decisions[0], initialApproach: 'A newly revised provisional opening.' }] });
    const state = (await tool('project_get_research')).structuredContent;
    assert.equal(state.reconsideration, null); assert.equal(state.creativePipeline.reconsideredAt, null);
    assert.equal((await write('index.html', html)).isError, true);
    await write('culture-reconsideration.json', reconsideration()); await write('index.html', html);
  });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Reconsider an exploration game launch opening.', mode: 'baseline' }));
  assert.equal(done.status, 'completed', done.error);
});

test('actual source capture is bounded in aggregate before returning IDs and workspace exports retain their links', async t => {
  const studio = await setup(t, async args => {
    const { hook, tool, write } = client(args); await write('culture-plan.json', plan);
    const literal = '界🙂'.repeat(1200);
    const native = { toolName: 'web_search', input: { query: 'Bounded literal source fixture' } };
    await hook('studio_web_before', native);
    await hook('studio_web_after', { ...native, response: { results: Array.from({ length: 20 }, (_, index) => ({ url: 'https://docs.qloo.com/reference/bounds-fixture-' + index, title: 'Bounds fixture ' + index, snippet: literal })) } });
    const observed = (await tool('project_get_research')).structuredContent;
    assert.ok(Buffer.byteLength(JSON.stringify(observed.webSources), 'utf8') <= 64 * 1024);
    assert.ok(observed.webSources.some(source => source.truncated));
    for (const source of observed.webSources) assert.ok(literal.startsWith(source.excerpt), 'Clipping preserves a literal Unicode prefix.');
    assert.deepEqual(observed.webSources.map(source => source.id), observed.webSources.map((_, index) => 'W' + String(index + 1).padStart(3, '0')));
    await write('culture-reconsideration.json', reconsideration(['W001'])); await write('index.html', html);
    await write('culture-research.json', [{ id: 'opening', decision: 'Choose a useful opening.', action: 'skip', evidenceIds: [], webSourceIds: ['W001'], webAnchors: [{ sourceId: 'W001', detail: observed.webSources[0].excerpt.slice(0, 100) }] }]);
  });
  const workspace = await studio.workspaces.upsert({ name: 'Web source export fixture', templateId: 'indie-game', brief: 'Design a coherent exploration game introduction.' });
  const done = await wait(studio, await studio.manager.create({ workspaceId: workspace.id, mode: 'baseline' }));
  assert.equal(done.status, 'completed', done.error);
  await studio.workspaces.select(workspace.id, { jobId: done.id, mode: 'baseline' });
  const exported = await (await fetch(studio.appUrl + '/api/workspaces/' + workspace.id + '/export')).json();
  assert.equal(exported.context.webSources[0].id, 'W001'); assert.equal(Object.hasOwn(exported.context.webSources[0], 'provenance'), false);
  const imported = await studio.workspaces.upsert(exported);
  assert.equal(imported.cultureBrief.importedResearch.provenance, 'caller-provided-unverified');
  assert.deepEqual(imported.cultureBrief.importedResearch.researchDecisions[0].webSourceIds, ['W001']);
});

test('private native log capture is flushed before construction and over-budget observed calls remain visible', async t => {
  const studio = await setup(t, async args => {
    const { hook, tool, write } = client(args); let needsSync = false;
    args.registerNativeResearchSync(async () => {
      if (!needsSync) return; needsSync = false;
      const native = { toolName: 'web_search', input: { query: 'Observed native fixture' }, captureMode: 'kiro-native-session', nativeToolCallId: 'fixture-id' };
      await hook('studio_web_before', native); await hook('studio_web_after', { ...native, response: sourceResponse });
    });
    await write('culture-plan.json', plan); needsSync = true;
    const observed = (await tool('project_get_research')).structuredContent;
    assert.equal(observed.webSources[0].id, 'W001'); assert.equal(observed.creativePipeline.captureMode, 'kiro-native-session');
    assert.ok(observed.creativePipeline.limitations.some(message => message.includes('does not prevent')));
    for (let index = 1; index < 6; index++) {
      const native = { toolName: 'web_search', input: { query: 'Observed fixture ' + index }, captureMode: 'kiro-native-session', nativeToolCallId: 'fixture-' + index };
      await hook('studio_web_before', native); await hook('studio_web_after', { ...native, response: { results: [] } });
    }
    assert.equal((await hook('studio_web_before', { toolName: 'web_search', input: { query: 'Observed seventh call' }, captureMode: 'kiro-native-session', nativeToolCallId: 'fixture-7' })).isError, true);
    const after = (await tool('project_get_research')).structuredContent;
    assert.equal(after.webCalls.length, 7); assert.equal(after.webCalls[6].status, 'error'); assert.equal(after.webCalls[6].observedAfterInvocation, true);
    assert.match(after.webCalls[6].limitation, /already invoked/u);
    throw new Error('Observed over-budget request fails this fixture generation.');
  });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Design a source-grounded exploration introduction.', mode: 'baseline' }));
  assert.equal(done.status, 'failed'); assert.equal(done.runs[0].webCalls.length, 7); assert.equal(done.runs[0].previewUrl, null);
});

test('a live native capture failure interrupts the owned run and remains failed rather than user-cancelled', async t => {
  let ownedSignal;
  const studio = await setup(t, async args => {
    ownedSignal = args.signal;
    args.registerNativeResearchSync(async () => { throw new Error('Fixture native ordering violation.'); });
    const { tool } = client(args);
    const result = await tool('project_get_research');
    assert.equal(result.error, 'Native web research capture failed: Fixture native ordering violation.');
    assert.equal(args.signal.aborted, true);
    throw new Error('The job was cancelled.');
  });
  const done = await wait(studio, await studio.manager.create({ templateId: 'indie-game', brief: 'Design a source-grounded exploration introduction.', mode: 'baseline' }));
  assert.equal(ownedSignal.aborted, true); assert.equal(done.status, 'failed'); assert.equal(done.runs[0].status, 'failed');
  assert.match(done.error, /native ordering violation/u); assert.equal(done.runs[0].previewUrl, null);
});
