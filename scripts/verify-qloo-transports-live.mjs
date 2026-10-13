import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadDotEnv, getConfig, redact } from '../src/config.mjs';

const patersonId = '00000000-0000-4000-8000-00000000006A';
const plan = {
  maximumSourceToolCalls: 4, modelCalls: 0,
  stages: ['HTTP MCP initialize/discovery and real Nujabes Search', 'Standalone STDIO MCP initialize/discovery and real artist Insights', 'HTTP MCP documented media-tag analysis', 'Optional HTTP MCP Tokyo artist context'],
};

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, executed: false, instruction: 'Pass --run to use the locally configured Qloo credential. Default execution makes no network or model calls.' }, null, 2));
} else await run();

async function run() {
  loadDotEnv();
  const config = getConfig();
  assert.ok(config.qlooKey, 'The local Qloo credential is required.');
  assert.equal(config.qlooBaseUrl, 'https://hackathon.api.qloo.com');
  const origin = process.env.STUDIO_URL || 'http://127.0.0.1:8787';
  assert.equal(new URL(origin).origin, 'http://127.0.0.1:8787', 'This diagnostic targets the existing local Studio only.');
  const reportPath = path.join(config.rootDir, 'output', `qloo-transports-live-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
  const report = { ...plan, startedAt: new Date().toISOString(), origin, discovery: {}, calls: [], errors: [], verified: false,
    interpretation: 'Live MCP/API mechanics only. Requested parameters and consistent output do not independently prove a filter was honored or improve a design.' };
  let sequence = 1, sourceCalls = 0, stdio;

  async function httpRpc(method, params = {}) {
    const notification = method.startsWith('notifications/');
    const response = await fetch(origin + '/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.accessToken ? { 'X-Demo-Token': config.accessToken } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id: sequence++ } : {}), method, params }), signal: AbortSignal.timeout(45000),
    });
    if (notification) { assert.ok(response.ok, `HTTP MCP notification returned ${response.status}.`); return; }
    const envelope = await response.json();
    assert.ok(response.ok, `HTTP MCP returned ${response.status}: ${envelope.error?.message || envelope.error || 'request rejected'}`);
    assert.ok(!envelope.error, envelope.error?.message || 'JSON-RPC request failed.');
    return envelope.result;
  }

  async function sourceCall(transport, name, argumentsValue, rpc) {
    assert.ok(sourceCalls < plan.maximumSourceToolCalls, 'The live source-tool budget is exhausted.');
    sourceCalls++;
    const record = { transport, tool: name, arguments: argumentsValue, startedAt: new Date().toISOString(), outcome: 'pending' };
    report.calls.push(record);
    try {
      const result = await rpc('tools/call', { name, arguments: argumentsValue });
      const payload = result?.structuredContent ?? parseContent(result?.content);
      record.isError = Boolean(result?.isError);
      record.data = payload;
      if (result?.isError) {
        record.outcome = 'error';
        record.error = payload?.error || { message: 'MCP source tool reported an error.' };
        return record;
      }
      assert.ok(['ok', 'empty'].includes(payload?.status), 'The source tool did not return a recognized real-result status.');
      assert.equal(payload.evidence?.provider, 'Qloo');
      assert.ok(payload.evidence?.endpoint?.startsWith('https://hackathon.api.qloo.com/'));
      assert.ok(typeof payload.evidence.retrievedAt === 'string');
      assert.ok(Array.isArray(payload.results));
      record.outcome = payload.status;
      record.resultCount = payload.results.length;
      record.metadata = { evidenceId: payload.evidence.id || payload.id || null, provider: payload.evidence.provider,
        endpoint: payload.evidence.endpoint, retrievedAt: payload.evidence.retrievedAt,
        responseQueryPresent: Object.hasOwn(payload, 'responseQuery'), warningsPresent: Object.hasOwn(payload, 'warnings'),
        perEntityExplainability: payload.results.filter(entity => Object.hasOwn(entity, 'explainability')).length,
        aggregateExplainabilityPresent: Object.hasOwn(payload, 'explainability') };
      // HTTP can retain the already running handler; source IDs are optional here.
      if (name === 'qloo_search_entities') assert.ok(payload.results.some(entity => entity.name.toLowerCase() === 'nujabes' && entity.entityId), 'An exact Nujabes catalog result was not returned.');
      if (argumentsValue.resultType === 'tag') {
        const requestedParents = argumentsValue.parentTypes.map(type => 'urn:entity:' + type);
        record.filterObservations = { requestedTagNamespace: argumentsValue.tagTypes,
          returnedRows: payload.results.length,
          returnedTagsConsistentWithNamespace: payload.results.length ? payload.results.every(entity => entity.entityId.startsWith('urn:tag:keyword:media:')) : null,
          rowsWithReturnedParentMetadata: payload.results.filter(entity => Array.isArray(entity.types) && entity.types.length).length,
          rowsWithAtLeastOneRequestedParent: payload.results.filter(entity => Array.isArray(entity.types) && entity.types.some(type => requestedParents.includes(type))).length,
          honoredFilterVerified: false,
          interpretation: 'Namespace and parent consistency are observations. No counterfactual test established that these filters changed the result.' };
      }
      if (argumentsValue.location) {
        const localityMetadata = payload.responseQuery?.localities ?? payload.responseQuery?.locality ?? null;
        const resolvedLocality = localityMetadata?.signal;
        const recognized = typeof resolvedLocality?.entity_id === 'string'
          && resolvedLocality?.subtype === 'urn:entity:locality'
          && typeof resolvedLocality?.name === 'string'
          && resolvedLocality.name.toLowerCase() === argumentsValue.location.toLowerCase();
        record.locationObservation = { requested: argumentsValue.location, returnedLocalityMetadata: localityMetadata,
          recognitionVerified: recognized, honoredLocationInfluenceVerified: false,
          interpretation: 'A matching returned locality establishes named-place resolution. It does not independently prove the geographic signal influenced the returned artists or demonstrate broader coverage.' };
      }
    } catch (error) {
      record.outcome = 'error';
      record.error = { message: redact(error.message, config) };
    } finally {
      record.finishedAt = new Date().toISOString();
      await save();
      console.log(JSON.stringify({ transport, tool: name, resultType: argumentsValue.resultType || null, outcome: record.outcome,
        results: record.resultCount ?? null, metadata: record.metadata || null, error: record.error || null }));
    }
    return record;
  }

  async function discover(transport, rpc) {
    const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'culture-live-transport-verifier', version: '1.0.0' } });
    await rpc('notifications/initialized');
    const listed = await rpc('tools/list');
    const tools = listed.tools || [];
    const search = tools.find(tool => tool.name === 'qloo_search_entities');
    const insights = tools.find(tool => tool.name === 'qloo_get_insights');
    assert.ok(search && insights, 'The transport must discover both Qloo source tools.');
    report.discovery[transport] = { protocolVersion: initialized.protocolVersion, serverInfo: initialized.serverInfo,
      toolNames: tools.map(tool => tool.name), tagFilterSchema: Boolean(insights.inputSchema?.properties?.tagTypes && insights.inputSchema?.properties?.parentTypes),
      sourceRecordIdsRequired: false };
    await save();
  }

  try {
    await discover('http', httpRpc);
    const search = await sourceCall('http', 'qloo_search_entities', { query: 'Nujabes', types: ['artist'], limit: 3 }, httpRpc);
    stdio = createStdio(config);
    await discover('stdio', stdio.rpc);
    const insights = await sourceCall('stdio', 'qloo_get_insights', { seedEntityIds: [patersonId], resultType: 'artist', limit: 3, explainability: true }, stdio.rpc);
    if (report.discovery.http.tagFilterSchema) {
      await sourceCall('http', 'qloo_get_insights', { seedEntityIds: [patersonId], resultType: 'tag', tagTypes: ['urn:tag:keyword:media'], parentTypes: ['movie', 'tv_show'], limit: 6, explainability: true }, httpRpc);
    } else report.errors.push({ stage: 'http-tag-discovery', message: 'The running HTTP handler does not yet advertise tagTypes/parentTypes; no unsupported request was sent.' });
    if (search.outcome === 'ok' && insights.outcome === 'ok') {
      await sourceCall('http', 'qloo_get_insights', { seedEntityIds: [patersonId], resultType: 'artist', location: 'Tokyo', limit: 3, explainability: true }, httpRpc);
    }
    report.verified = Boolean(report.discovery.http && report.discovery.stdio && report.calls.length === 4 && report.calls.every(call => ['ok', 'empty'].includes(call.outcome)));
  } catch (error) {
    report.errors.push({ stage: 'setup-or-discovery', message: redact(error.message, config) });
  } finally {
    if (stdio) await stdio.close();
    report.sourceToolCalls = sourceCalls;
    report.finishedAt = new Date().toISOString();
    await save();
    console.log(JSON.stringify({ reportPath, verified: report.verified, sourceToolCalls: sourceCalls, modelCalls: 0,
      successfulSourceResponses: report.calls.filter(call => ['ok', 'empty'].includes(call.outcome)).length,
      emptyResponses: report.calls.filter(call => call.outcome === 'empty').length,
      errors: report.errors.length + report.calls.filter(call => call.outcome === 'error').length }));
    if (!report.verified) process.exitCode = 1;
  }

  async function save() {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2), config), 'utf8');
  }
}

function parseContent(content = []) {
  const text = content.find(item => item.type === 'text')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

function createStdio(config) {
  const child = spawn(process.execPath, [path.join(config.rootDir, 'plugin', 'server', 'index.mjs')], {
    cwd: config.rootDir, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, QLOO_API_KEY: config.qlooKey, QLOO_BASE_URL: config.qlooBaseUrl,
      CULTURE_BRIDGE_URL: '', CULTURE_BRIDGE_TOKEN: '', CULTURE_INCLUDE_PROJECT_TOOLS: 'false', CULTURE_ENABLE_QLOO: 'true' },
  });
  let buffer = '', sequence = 1, bytes = 0, ended = false;
  const pending = new Map();
  const done = new Promise(resolve => child.once('close', code => { ended = true; resolve(code); }));
  const rejectAll = message => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)); } pending.clear(); };
  child.once('error', () => rejectAll('The standalone MCP process could not start.'));
  child.once('close', () => rejectAll('The standalone MCP process ended before replying.'));
  child.stderr.on('data', () => {}); // Do not propagate environment-adjacent stderr to reports.
  child.stdin.on('error', () => rejectAll('The standalone MCP input stream closed.'));
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 4_000_000) { rejectAll('The standalone MCP output exceeded the diagnostic bound.'); child.kill(); return; }
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let envelope;
      try { envelope = JSON.parse(line); } catch { rejectAll('Standalone MCP returned non-JSON protocol output.'); child.kill(); return; }
      const item = pending.get(envelope.id);
      if (!item) continue;
      pending.delete(envelope.id); clearTimeout(item.timer);
      if (envelope.error) item.reject(new Error(envelope.error.message || 'Standalone JSON-RPC error.'));
      else item.resolve(envelope.result);
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    if (ended) return reject(new Error('The standalone MCP process is closed.'));
    if (method.startsWith('notifications/')) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); resolve(); return; }
    const id = sequence++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The standalone MCP reply timed out.')); }, 45000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const close = async () => {
    if (ended) return;
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 3000);
    await done; clearTimeout(timer);
  };
  return { rpc, close };
}
