import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { QlooClient, QlooError } from '../src/qloo/client.mjs';
import { createToolHandler, createBridgeHandler, dispatchRpc, getToolDefinitions } from '../src/mcp/server.mjs';
import { createStudio } from '../src/server.mjs';
import { getConfig } from '../src/config.mjs';

test('HTTP MCP discovers separate search categories and bounded tag filters without source or model calls', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'culture-mcp-discovery-'));
  let modelCalls = 0;
  const studio = await createStudio({
    config: getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory, CREATIVE_PROTOCOL: 'research' }),
    inspect: async () => ({ available: true, authenticated: true, defaultModel: 'test-only' }),
    runner: async () => { modelCalls++; },
  });
  t.after(async () => { await studio.close(); await rm(directory, { recursive: true, force: true }); });
  const rpc = async (id, method, params) => {
    const response = await fetch(studio.appUrl + '/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) });
    assert.equal(response.status, 200); return response.json();
  };
  const discovery = await rpc(1, 'tools/list');
  const search = discovery.result.tools.find(tool => tool.name === 'qloo_search_entities');
  assert.ok(search.inputSchema.properties.types.items.enum.includes('author'));
  assert.equal(search.inputSchema.properties.types.items.enum.includes('tag'), false);
  for (const name of ['qloo_get_insights', 'qloo_compare_tastes']) {
    const tool = discovery.result.tools.find(tool => tool.name === name);
    assert.equal(tool.inputSchema.properties.tagTypes.maxItems, 4);
    assert.equal(tool.inputSchema.properties.parentTypes.maxItems, 4);
    assert.ok(tool.inputSchema.properties.parentTypes.items.enum.includes('videogame'));
  }
  const missing = await rpc(2, 'tools/call', { name: 'qloo_get_insights', arguments: { seedEntityIds: ['seed-id'], resultType: 'tag', tagTypes: ['urn:tag:theme'], parentTypes: ['movie'] } });
  assert.equal(missing.result.structuredContent.error.code, 'QLOO_KEY_MISSING');
  assert.equal(modelCalls, 0);
});

test('taste comparison forwards tag filters to every independent group and rejects invalid filters before querying', async () => {
  const calls = [];
  const handler = createToolHandler({ qlooClient: { getInsights: async input => {
    calls.push(input); return { status: 'ok', results: [{ entityId: 'urn:tag:theme:qloo:routine', name: 'Routine', type: 'urn:tag', affinity: 0.3 }], evidence: {} };
  } } });
  const groups = [{ id: 'one', label: 'First', seedEntityIds: ['seed-one'] }, { id: 'two', label: 'Second', seedEntityIds: ['seed-two'] }];
  const result = await handler('qloo_compare_tastes', { groups, resultType: 'tag', tagTypes: ['urn:tag:theme'], parentTypes: ['movie'] });
  assert.equal(result.isError, undefined); assert.equal(calls.length, 2);
  assert.ok(calls.every(call => JSON.stringify(call.tagTypes) === '["urn:tag:theme"]' && JSON.stringify(call.parentTypes) === '["movie"]'));
  assert.equal(result.structuredContent.sharedCandidates[0].entityId, 'urn:tag:theme:qloo:routine');
  for (const input of [{ resultType: 'movie', tagTypes: ['urn:tag:theme'] }, { resultType: 'tag', tagTypes: ['theme'] }, { resultType: 'tag', parentTypes: ['author'] }]) {
    const invalid = await handler('qloo_compare_tastes', { groups, ...input });
    assert.equal(invalid.structuredContent.error.code, 'TOOL_INPUT_INVALID');
  }
  assert.equal(calls.length, 2);
});

test('tool discovery negotiates older clients and reveals project tools only in an active bridge', async () => {
  const response = await dispatchRpc({ message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } } });
  assert.equal(response.result.protocolVersion, '2024-11-05');
  assert.equal(response.result.serverInfo.name, 'culture-grounded-design');
  assert.ok(getToolDefinitions().some(tool => tool.name === 'culture_compile_brief'));
  assert.ok(getToolDefinitions().some(tool => tool.name === 'qloo_compare_tastes'));
  assert.equal(getToolDefinitions().some(tool => tool.name.startsWith('project_')), false);
  const all = getToolDefinitions({ includeProjectTools: true });
  assert.ok(all.some(tool => tool.name === 'project_read_file'));
  assert.ok(all.some(tool => tool.name === 'project_get_research'));
  assert.equal(all.find(tool => tool.name === 'project_write_file').annotations.readOnlyHint, false);
  const next = await dispatchRpc({ message: { jsonrpc: '2.0', id: 2, method: 'tools/list' }, includeProjectTools: true });
  assert.deepEqual(next.result.tools.map(tool => tool.name), all.map(tool => tool.name));
});

test('scoped research discovery delegates to the host and cannot manufacture receipts when unsupported', async () => {
  const sources = { webSources: [{ id: 'W001', url: 'https://kiro.dev/docs/', excerpt: 'Literal host-captured content.' }], creativePipeline: { status: 'researching' } };
  const handler = createToolHandler({ project: { getResearch: async () => sources } });
  assert.deepEqual((await handler('project_get_research')).structuredContent, sources);
  assert.equal((await handler('project_get_research', { fabricatedSources: [] })).structuredContent.error.code, 'TOOL_INPUT_INVALID');
  assert.equal((await createToolHandler({ project: {} })('project_get_research')).structuredContent.error.code, 'PROJECT_RESEARCH_UNAVAILABLE');
  assert.equal((await createToolHandler()('project_get_research')).structuredContent.error.code, 'TOOL_UNKNOWN');
});

test('JSON-RPC distinguishes notifications, malformed requests, invalid params and unknown methods', async () => {
  assert.equal(await dispatchRpc({ message: { jsonrpc: '2.0', method: 'notifications/initialized' } }), null);
  assert.equal((await dispatchRpc({ message: null })).error.code, -32600);
  assert.equal((await dispatchRpc({ message: [] })).error.code, -32600);
  assert.equal((await dispatchRpc({ message: { jsonrpc: '2.0', id: 3, method: 'initialize', params: {} } })).error.code, -32602);
  assert.equal((await dispatchRpc({ message: { jsonrpc: '2.0', id: 4, method: 'unknown' } })).error.code, -32601);
  assert.equal((await dispatchRpc({ message: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} } })).error.code, -32602);
});

test('baseline omits Qloo tools and blocks direct calls without executing a supplied handler', async () => {
  assert.deepEqual(getToolDefinitions({ includeQlooTools: false }).map(tool => tool.name), ['culture_assess_decision', 'culture_validate_brief', 'culture_compile_brief', 'culture_validate_design_dna', 'culture_check_dna_conformance', 'culture_compare_designs',
    'culture_list_capabilities', 'culture_validate_reading', 'culture_validate_production_plan', 'culture_find_materials', 'culture_fetch_materials', 'culture_generate_image', 'culture_capture', 'culture_validate_review']);
  const baseline = getToolDefinitions({ includeProjectTools: true, includeQlooTools: false });
  assert.equal(baseline.some(tool => tool.name.startsWith('qloo_')), false);
  assert.ok(baseline.some(tool => tool.name === 'project_write_file'));
  let called = false;
  const response = await dispatchRpc({ includeQlooTools: false, handler: async () => { called = true; }, message: {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'qloo_search_entities', arguments: { query: 'Example' } },
  } });
  assert.equal(response.result.structuredContent.error.code, 'TOOL_UNKNOWN');
  assert.equal(called, false);
  const handler = createToolHandler({ includeQlooTools: false, qlooClient: { searchEntities: async () => { called = true; } } });
  assert.equal((await handler('qloo_search_entities', { query: 'Example' })).isError, true);
  assert.equal(called, false);
});

test('MCP validation rejects unknown argument fields and keeps missing-key failure truthful', async () => {
  const handler = createToolHandler({ qlooClient: new QlooClient() });
  const extra = await handler('qloo_search_entities', { query: 'Example', apiKey: 'never-used' });
  assert.equal(extra.structuredContent.error.code, 'TOOL_INPUT_INVALID');
  assert.equal(JSON.stringify(extra).includes('never-used'), false);
  const missing = await handler('qloo_search_entities', { query: 'Example' });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.error.code, 'QLOO_KEY_MISSING');
  assert.equal((await handler('project_list_files')).structuredContent.error.code, 'TOOL_UNKNOWN');
});

test('evidence callback receives the same sanitized real source fields as the caller', async () => {
  let recorded;
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async () => new Response(JSON.stringify({ results: [{ entity_id: 'entity-1', name: 'Example', affinity: 0.1234 }] })) });
  const handler = createToolHandler({ qlooClient: client, onEvidence: async evidence => {
    assert.equal(Object.hasOwn(evidence.evidence, 'id'), false);
    assert.equal(Object.hasOwn(evidence.evidence, 'idKind'), false);
    recorded = evidence; evidence.evidence.id = 'Q001';
  } });
  const result = await handler('qloo_search_entities', { query: 'Example' });
  assert.equal(result.isError, undefined);
  assert.equal(recorded.tool, 'qloo_search_entities');
  assert.equal(recorded.results[0].affinity, result.structuredContent.results[0].affinity);
  assert.equal(recorded.evidence.provider, 'Qloo');
  assert.equal(result.structuredContent.evidence.id, 'Q001');
});

test('standalone successful and empty Qloo replies receive distinct application source IDs without altering client records', async () => {
  const original = { status: 'ok', results: [{ entityId: 'entity-a', name: 'A real returned reference' }], evidence: { provider: 'Qloo', endpoint: 'https://hackathon.api.qloo.com/search', retrievedAt: '2026-10-03T00:00:00Z' } };
  const handler = createToolHandler({ qlooClient: { searchEntities: async () => original, getInsights: async () => ({ status: 'empty', results: [], evidence: { provider: 'Qloo', endpoint: 'https://hackathon.api.qloo.com/v2/insights' } }) } });
  const first = (await handler('qloo_search_entities', { query: 'Explicit reference' })).structuredContent;
  const second = (await handler('qloo_search_entities', { query: 'Explicit reference' })).structuredContent;
  const empty = (await handler('qloo_get_insights', { seedEntityIds: ['entity-a'], resultType: 'book' })).structuredContent;
  for (const result of [first, second, empty]) {
    assert.match(result.evidence.id, /^culture-source:[0-9a-f-]{36}$/u);
    assert.equal(result.evidence.idKind, 'application-source-record');
  }
  assert.notEqual(first.evidence.id, second.evidence.id);
  assert.equal(first.results[0].entityId, 'entity-a');
  assert.equal(first.evidence.retrievedAt, original.evidence.retrievedAt);
  assert.equal(Object.hasOwn(original.evidence, 'id'), false);
  assert.equal(empty.status, 'empty'); assert.deepEqual(empty.results, []);
  const failed = createToolHandler({ qlooClient: { getInsights: async () => { throw new QlooError('QLOO_TIMEOUT', 'The request timed out.'); } } });
  assert.equal(Object.hasOwn((await failed('qloo_get_insights', { seedEntityIds: ['entity-a'], resultType: 'book' })).structuredContent, 'evidence'), false);
});

test('standalone comparison retains unique per-group source IDs and reports only successful sources on partial failure', async () => {
  const response = seed => ({ status: 'ok', results: [{ entityId: 'shared-entity', name: 'Shared anchor', affinity: seed === 'seed-a' ? 0.1 : 0.2 }], evidence: { provider: 'Qloo', endpoint: 'https://hackathon.api.qloo.com/v2/insights', retrievedAt: '2026-10-03T00:00:00Z' } });
  const groups = [{ id: 'a', label: 'First', seedEntityIds: ['seed-a'] }, { id: 'b', label: 'Second', seedEntityIds: ['seed-b'] }];
  const handler = createToolHandler({ qlooClient: { getInsights: async ({ seedEntityIds }) => response(seedEntityIds[0]) } });
  const result = (await handler('qloo_compare_tastes', { groups, resultType: 'book' })).structuredContent;
  const ids = result.groups.map(group => group.insights.evidence.id);
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(result.sharedCandidates[0].support.map(item => item.evidenceId), ids);
  assert.deepEqual(result.sharedCandidates[0].support.map(item => item.affinity), [0.1, 0.2]);
  const failing = createToolHandler({ qlooClient: { getInsights: async ({ seedEntityIds }) => {
    if (seedEntityIds[0] === 'seed-b') throw new QlooError('QLOO_RATE_LIMIT', 'The request was limited.');
    return response(seedEntityIds[0]);
  } } });
  const partial = (await failing('qloo_compare_tastes', { groups, resultType: 'book' })).structuredContent;
  assert.equal(partial.comparisonComplete, false); assert.equal(partial.groups.length, 1);
  assert.match(partial.groups[0].insights.evidence.id, /^culture-source:/u);
  assert.equal(Object.hasOwn(partial.failedGroups[0], 'evidence'), false);
});

test('portable plugin points at its real contained entrypoint and has matching skill identity', async () => {
  const pluginRoot = fileURLToPath(new URL('../plugin/', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  const config = JSON.parse(await readFile(path.join(pluginRoot, 'mcp.json'), 'utf8'));
  assert.equal(manifest.name, 'culture-grounded-design');
  assert.equal(manifest.version, '0.4.0');
  assert.ok(manifest.extensions['com.openai'].interface.shortDescription.length <= 30);
  const entry = config.mcpServers[manifest.name].args[0].replace('${PLUGIN_ROOT}', pluginRoot);
  await access(entry);
  assert.ok(entry.startsWith(pluginRoot));
  assert.match(await readFile(path.join(pluginRoot, 'skills', manifest.name, 'SKILL.md'), 'utf8'), /^---\s+name: culture-grounded-design/u);
});

test('creative assessment is discoverable in baseline and standalone sessions and never calls Qloo', async () => {
  let calls = 0;
  const qlooClient = { searchEntities: async () => { calls++; }, getInsights: async () => { calls++; } };
  for (const includeQlooTools of [false, true]) {
    const handler = createToolHandler({ qlooClient, includeQlooTools });
    const response = await handler('culture_assess_decision', { decision: { kind: 'creative', decision: 'Create an original character' }, context: { domain: 'game' } });
    assert.equal(response.structuredContent.action, 'clarify');
    assert.equal(response.structuredContent.questions.length, 1);
    assert.equal(response.isError, undefined);
  }
  assert.equal(calls, 0);
  const handler = createToolHandler();
  const invalid = await handler('culture_assess_decision', { decision: { kind: 'creative', decision: 'Create a character', openChoice: {} } });
  assert.equal(invalid.structuredContent.error.code, 'CULTURE_POLICY_INVALID');
  const initialized = await dispatchRpc({ message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
  assert.equal(initialized.result.serverInfo.version, '0.4.0');
  assert.match(initialized.result.instructions, /Creative decision policy/u);
});

test('project callback access rejects traversal and bounds UTF-8 writes before invoking callbacks', async () => {
  const writes = [];
  const project = { listFiles: async () => ['index.html'], readFile: async path => `content:${path}`, writeFile: async (path, content) => writes.push({ path, content }) };
  const handler = createToolHandler({ project });
  for (const path of ['../other.txt', '/absolute.txt', 'D:\\secret.txt', 'nested/../../other.txt', '.aws/config', 'node_modules/file.js']) {
    assert.equal((await handler('project_write_file', { path, content: 'x' })).structuredContent.error.code, 'PROJECT_SCOPE_INVALID');
  }
  assert.equal((await handler('project_write_file', { path: 'assets/text.txt', content: '🙂'.repeat(40000) })).structuredContent.error.code, 'TOOL_INPUT_INVALID');
  assert.equal(writes.length, 0);
  assert.equal((await handler('project_write_file', { path: 'assets\\style.css', content: 'body{}' })).structuredContent.status, 'written');
  assert.deepEqual(writes, [{ path: 'assets/style.css', content: 'body{}' }]);
  assert.equal((await handler('project_read_file', { path: 'index.html' })).structuredContent.content, 'content:index.html');
  assert.deepEqual((await handler('project_list_files')).structuredContent.files, ['index.html']);
});

test('bridge forwards one scoped tool request with a private token and returns MCP content', async () => {
  let call;
  const result = { content: [{ type: 'text', text: '{"files":[]}' }], structuredContent: { files: [] } };
  const handler = createBridgeHandler({ baseUrl: 'http://127.0.0.1:3210', token: 'fixture-bridge-token', fetchImpl: async (url, options) => {
    call = { url, options }; return new Response(JSON.stringify(result));
  } });
  assert.deepEqual(await handler('project_list_files', {}), result);
  assert.equal(call.url.pathname, '/internal/tools');
  assert.equal(call.options.headers.Authorization, 'Bearer fixture-bridge-token');
  assert.deepEqual(JSON.parse(call.options.body), { name: 'project_list_files', arguments: {} });
  assert.throws(() => createBridgeHandler({ baseUrl: 'http://external.invalid', token: 'fixture' }));
  assert.throws(() => createBridgeHandler({ baseUrl: 'http://127.0.0.1:3210', token: '' }));
});

test('standalone stdio emits only protocol responses and refuses tools before initialization', async () => {
  const entry = fileURLToPath(new URL('../plugin/server/index.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry], { env: { ...process.env, QLOO_API_KEY: '', CULTURE_BRIDGE_URL: '', CULTURE_BRIDGE_TOKEN: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
  child.stdin.end([
    'null',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'qloo_search_entities', arguments: { query: 'Example' } } }),
  ].join('\n') + '\n');
  assert.equal(await closed, 0);
  assert.equal(stderr, '');
  const messages = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(messages.length, 5);
  assert.equal(messages[0].error.code, -32600);
  assert.equal(messages[1].error.code, -32000);
  assert.equal(messages[2].result.protocolVersion, '2025-06-18');
  assert.ok(messages[3].result.tools.some(tool => tool.name === 'culture_validate_brief'));
  assert.ok(messages[3].result.tools.some(tool => tool.name === 'qloo_get_insights'));
  assert.equal(messages[4].result.structuredContent.error.code, 'QLOO_KEY_MISSING');
});

test('portable brief tools work without Qloo and never authenticate imported evidence', async () => {
  const handler = createToolHandler({ includeQlooTools: false });
  const authored = { product: { name: 'Shared storefront', customProductDetail: 'A real product context' }, audiences: [],
    evidence: [{ id: 'Q-imported', provider: 'Qloo', verified: true }],
    decisions: [{ target: '#hero', rationale: 'Authored designer interpretation', evidenceIds: ['Q-imported'] }] };
  const validation = await handler('culture_validate_brief', { brief: authored });
  assert.equal(validation.structuredContent.valid, true);
  const compiled = await handler('culture_compile_brief', { brief: authored });
  assert.equal(compiled.isError, undefined);
  assert.equal(compiled.structuredContent.context.product.customProductDetail, 'A real product context');
  assert.equal(compiled.structuredContent.provenance, 'caller-provided-unverified');
  assert.equal(compiled.structuredContent.context.evidence[0].verification, 'caller-provided-unverified');
  assert.equal(compiled.structuredContent.context.decisions[0].kind, 'creative-interpretation');
  const bad = await handler('culture_compile_brief', { brief: { product: 'A product', decisions: [{ evidenceIds: ['does-not-exist'] }] } });
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.error.code, 'CULTURE_BRIEF_INVALID');
  assert.equal((await handler('qloo_compare_tastes', {})).structuredContent.error.code, 'TOOL_UNKNOWN');
});

test('compare queries independent groups in parallel and audits only actual per-group sources', { timeout: 1500 }, async () => {
  const calls = [], audits = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = new QlooClient({ apiKey: 'fixture-key', fetchImpl: async url => {
    const seed = url.searchParams.get('signal.interests.entities');
    calls.push(seed);
    if (calls.length === 3) release();
    await barrier;
    return new Response(JSON.stringify({ results: { entities: [
      { entity_id: 'shared', name: 'Shared cultural anchor', subtype: 'urn:entity:brand', query: { affinity: { 'seed-a': 0.11, 'seed-b': 0.27, 'seed-c': 0.63 }[seed] } },
      { entity_id: `${seed}-only`, name: 'Different anchor', query: { affinity: 0.9 } },
    ] } }));
  } });
  const handler = createToolHandler({ qlooClient: client, onEvidence: async record => { record.evidence.id = `Q${audits.length + 1}`; audits.push(record); } });
  const result = await handler('qloo_compare_tastes', { groups: [
    { id: 'a', label: 'First contributor', seedEntityIds: ['seed-a'] },
    { id: 'b', label: 'Second contributor', seedEntityIds: ['seed-b'] },
    { id: 'c', label: 'Third contributor', seedEntityIds: ['seed-c'] },
  ], resultType: 'brand', explainability: true });
  assert.equal(result.isError, undefined);
  assert.equal(audits.length, 3);
  assert.ok(audits.every(record => record.tool === 'qloo_get_insights'));
  assert.deepEqual(audits.map(record => record.comparisonGroupId), ['a', 'b', 'c']);
  assert.equal(result.structuredContent.apiCalls, 3);
  assert.deepEqual(result.structuredContent.sharedCandidates, [{ entityId: 'shared', name: 'Shared cultural anchor', type: 'urn:entity:brand', support: [
    { groupId: 'a', affinity: 0.11, evidenceId: 'Q1' }, { groupId: 'b', affinity: 0.27, evidenceId: 'Q2' }, { groupId: 'c', affinity: 0.63, evidenceId: 'Q3' },
  ] }]);
  assert.equal(result.structuredContent.groups[0].insights.evidence.id, 'Q1');
  assert.equal(Object.hasOwn(result.structuredContent.sharedCandidates[0], 'compatibilityScore'), false);
});

test('compare preserves partial successful evidence and reports failed groups without claiming an intersection', async () => {
  const audits = [];
  const handler = createToolHandler({ qlooClient: { getInsights: async ({ seedEntityIds }) => {
    if (seedEntityIds[0] === 'seed-b') throw new QlooError('QLOO_TIMEOUT', 'The Qloo request timed out.', { retryable: true });
    return { status: 'ok', results: [{ entityId: 'anchor', name: 'An anchor', type: 'brand', affinity: 0.33 }], evidence: { provider: 'Qloo', resultCount: 1 } };
  } }, onEvidence: async record => { record.evidence.id = 'Q1'; audits.push(record); } });
  const result = await handler('qloo_compare_tastes', { groups: [
    { id: 'a', label: 'First', seedEntityIds: ['seed-a'] }, { id: 'b', label: 'Second', seedEntityIds: ['seed-b'] },
  ], resultType: 'brand' });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'QLOO_COMPARISON_INCOMPLETE');
  assert.equal(result.structuredContent.comparisonComplete, false);
  assert.equal(Object.hasOwn(result.structuredContent, 'sharedCandidates'), false);
  assert.equal(result.structuredContent.failedGroups[0].id, 'b');
  assert.equal(result.structuredContent.failedGroups[0].error.code, 'QLOO_TIMEOUT');
  assert.equal(result.structuredContent.groups[0].insights.evidence.id, 'Q1');
  assert.equal(audits.length, 1);
});

test('compare rejects duplicate groups and invalid seeds before any source call', async () => {
  let calls = 0;
  const handler = createToolHandler({ qlooClient: { getInsights: async () => { calls++; } } });
  for (const groups of [
    [{ id: 'a', label: 'First', seedEntityIds: ['seed-a'] }, { id: 'a', label: 'Second', seedEntityIds: ['seed-b'] }],
    [{ id: 'a', label: 'First', seedEntityIds: ['seed-a'] }, { id: 'b', label: 'Second', seedEntityIds: ['Not a resolved ID'] }],
  ]) assert.equal((await handler('qloo_compare_tastes', { groups, resultType: 'brand' })).structuredContent.error.code, 'TOOL_INPUT_INVALID');
  const invalidBoolean = await handler('qloo_get_insights', { seedEntityIds: ['seed-a'], resultType: 'brand', explainability: 'true' });
  assert.equal(invalidBoolean.structuredContent.error.code, 'TOOL_INPUT_INVALID');
  assert.equal(calls, 0);
});

test('one host audit failure cannot suppress auditing other fulfilled group queries', async () => {
  const auditedGroups = [];
  const handler = createToolHandler({ qlooClient: { getInsights: async () => ({ results: [], evidence: { provider: 'Qloo', resultCount: 0 } }) },
    onEvidence: async record => { auditedGroups.push(record.comparisonGroupId); if (record.comparisonGroupId === 'a') throw new Error('private host failure'); } });
  const result = await handler('qloo_compare_tastes', { groups: [
    { id: 'a', label: 'First', seedEntityIds: ['seed-a'] }, { id: 'b', label: 'Second', seedEntityIds: ['seed-b'] },
  ], resultType: 'brand' });
  assert.deepEqual(auditedGroups, ['a', 'b']);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.failedGroups[0].error.code, 'QLOO_EVIDENCE_AUDIT_FAILED');
  assert.equal(JSON.stringify(result).includes('private host failure'), false);
  assert.equal(Object.hasOwn(result.structuredContent, 'sharedCandidates'), false);
});
