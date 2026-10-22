import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { envValue, hostName, resolveQlooConnection, testQlooKey, DEFAULT_QLOO_BASE_URL } from '../plugin/server/connections/config.mjs';
import { createConnectionStore, plainProtector, dpapiProtector, connectionsDir } from '../plugin/server/connections/store.mjs';
import { createConnectionPage } from '../plugin/server/connections/page.mjs';
import { sandboxCwdFromMeta, resolveProjectRoot, checkProjectFolder, CODEX_SANDBOX_META } from '../plugin/server/production/project-files.mjs';
import { buildImageBrief, buildImagePrompt, inspectImageProviders } from '../plugin/server/production/images.mjs';
import { createMousaServer, MOUSA_INSTRUCTIONS, MOUSA_INSTRUCTIONS_LIMIT, MOUSA_SETUP_TOOLS } from '../plugin/server/mcp/mousa.mjs';

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const qlooOk = async () => json({ results: [] });
const qlooRejects = async () => new Response('', { status: 401 });
const tempDir = prefix => mkdtemp(path.join(os.tmpdir(), prefix));
const parse = result => JSON.parse(result.content[0].text);

/** A reversible stand-in for DPAPI, so tests check that secrets are not stored as written. */
const fakeProtector = { scheme: 'dpapi', async protect(text) { return Buffer.from([...text].reverse().join('')).toString('base64'); }, async unprotect(blob) { return [...Buffer.from(blob, 'base64').toString()].reverse().join(''); } };

/** A request with a chosen Host header, which fetch does not allow. */
function rawRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({ hostname: target.hostname, port: target.port, path: target.pathname, method, headers }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.on('error', reject);
    request.end(body);
  });
}
const postForm = (url, fields, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) });

test('host settings left unfilled count as unset, and the declared host is read from MOUSA_HOST', () => {
  assert.equal(envValue('${user_config.qloo_api_key}'), '');
  assert.equal(envValue('${CLAUDE_PROJECT_DIR}'), '');
  assert.equal(envValue('%APPDATA%'), '');
  assert.equal(envValue('  '), '');
  assert.equal(envValue(' real-value '), 'real-value');
  assert.equal(hostName({ MOUSA_HOST: 'Codex' }), 'codex');
  assert.equal(hostName({ MOUSA_HOST: 'claude-code' }), 'claude-code');
  assert.equal(hostName({ MOUSA_HOST: 'something' }), 'unknown');
  assert.equal(hostName({}), 'unknown');
});

test('the connections file keeps the key protected, reports damage instead of failing, and can be cleared', async () => {
  const dir = await tempDir('mousa-store-');
  try {
    const env = { MOUSA_CONFIG_DIR: dir };
    assert.equal(connectionsDir({ env }), path.resolve(dir));
    const store = createConnectionStore({ env, protector: fakeProtector });
    assert.deepEqual((await store.read()).qloo, null);
    const saved = await store.saveQloo({ apiKey: 'qloo-test-key-123', baseUrl: 'https://api.qloo.com' });
    assert.equal(saved.protection, 'dpapi');
    const raw = await readFile(path.join(dir, 'connections.json'), 'utf8');
    assert.ok(!raw.includes('qloo-test-key-123'), 'the key is not stored as written');
    const read = await store.read();
    assert.equal(read.qloo.apiKey, 'qloo-test-key-123');
    assert.equal(read.qloo.baseUrl, 'https://api.qloo.com');
    // A second store (a new server process) reads the same file.
    assert.equal((await createConnectionStore({ env, protector: fakeProtector }).read()).qloo.apiKey, 'qloo-test-key-123');
    // A key protected on another system is reported, not misread.
    assert.match((await createConnectionStore({ env, protector: plainProtector }).read()).problem, /another system/);
    await writeFile(path.join(dir, 'connections.json'), '{broken');
    const damaged = await createConnectionStore({ env, protector: fakeProtector }).read();
    assert.equal(damaged.qloo, null);
    assert.match(damaged.problem, /damaged/);
    await store.saveQloo({ apiKey: 'qloo-test-key-456', baseUrl: DEFAULT_QLOO_BASE_URL });
    assert.equal(await store.clearQloo(), true);
    assert.equal((await store.read()).qloo, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('DPAPI protects and restores a secret for the current Windows user', { skip: process.platform !== 'win32' }, async () => {
  const protector = dpapiProtector();
  const blob = await protector.protect('qloo-secret-ğüşçö-123');
  assert.notEqual(blob, 'qloo-secret-ğüşçö-123');
  assert.equal(await protector.unprotect(blob), 'qloo-secret-ğüşçö-123');
  await assert.rejects(protector.unprotect(Buffer.from('not protected').toString('base64')), /could not be decrypted/);
});

test('the environment key wins, an unfilled host field falls through to the saved key, and a bad base URL is ignored', async () => {
  const dir = await tempDir('mousa-resolve-');
  try {
    const store = createConnectionStore({ env: { MOUSA_CONFIG_DIR: dir }, protector: fakeProtector });
    assert.deepEqual(await resolveQlooConnection({ env: {}, store }), { apiKey: '', baseUrl: DEFAULT_QLOO_BASE_URL, source: null });
    await store.saveQloo({ apiKey: 'saved-key-0001', baseUrl: 'https://api.qloo.com' });
    const fromFile = await resolveQlooConnection({ env: { QLOO_API_KEY: '${user_config.qloo_api_key}' }, store });
    assert.equal(fromFile.source, 'connections file');
    assert.equal(fromFile.apiKey, 'saved-key-0001');
    assert.equal(fromFile.baseUrl, 'https://api.qloo.com');
    const fromEnv = await resolveQlooConnection({ env: { QLOO_API_KEY: 'env-key-0001', QLOO_BASE_URL: 'http://insecure.example' }, store });
    assert.deepEqual(fromEnv, { apiKey: 'env-key-0001', baseUrl: DEFAULT_QLOO_BASE_URL, source: 'environment' });
    // Claude Code fills the plugin setting under its own name: an empty one leaves the environment's key in charge.
    const unset = { MOUSA_QLOO_API_KEY: '${user_config.qloo_api_key}', MOUSA_QLOO_BASE_URL: 'https://hackathon.api.qloo.com' };
    assert.deepEqual(await resolveQlooConnection({ env: { ...unset, QLOO_API_KEY: 'env-key-0001', QLOO_BASE_URL: 'https://api.qloo.com' }, store }),
      { apiKey: 'env-key-0001', baseUrl: 'https://api.qloo.com', source: 'environment' }, 'a key keeps its own endpoint');
    assert.deepEqual(await resolveQlooConnection({ env: { ...unset, MOUSA_QLOO_API_KEY: 'plugin-key-0001', QLOO_API_KEY: 'env-key-0001' }, store }),
      { apiKey: 'plugin-key-0001', baseUrl: 'https://hackathon.api.qloo.com', source: 'plugin settings' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a key test makes one request and explains a rejection without echoing the key', async () => {
  const requests = [];
  assert.deepEqual(await testQlooKey({ apiKey: 'good-key-0001', fetchImpl: async (url, options) => { requests.push({ url: String(url), key: options.headers['X-Api-Key'] }); return json({ results: [] }); } }), { ok: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/search\?/);
  assert.equal(requests[0].key, 'good-key-0001');
  const rejected = await testQlooKey({ apiKey: 'bad-key-0001', fetchImpl: qlooRejects });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'QLOO_AUTH');
  assert.ok(!rejected.message.includes('bad-key-0001'));
});

test('the connection page serves only its own host and path, refuses bad keys, and saves a tested key once', async () => {
  const dir = await tempDir('mousa-page-');
  const store = createConnectionStore({ env: { MOUSA_CONFIG_DIR: dir }, protector: fakeProtector });
  const tested = [];
  const page = createConnectionPage({ store, testKey: async ({ apiKey, baseUrl }) => { tested.push({ apiKey, baseUrl }); return apiKey === 'valid-key-0001' ? { ok: true } : { ok: false, code: 'QLOO_AUTH', message: 'Qloo did not accept this key.' }; } });
  try {
    const { url, expiresAt } = await page.open();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/connect\/[A-Za-z0-9_-]{32}$/);
    assert.ok(Date.parse(expiresAt) > Date.now());
    assert.equal((await page.open()).url, url, 'an open page is reused');
    const form = await fetch(url);
    assert.equal(form.status, 200);
    assert.match(form.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(form.headers.get('cache-control'), 'no-store');
    assert.match(await form.text(), /Qloo API key/);
    const origin = new URL(url).origin;
    assert.equal((await fetch(`${origin}/connect/wrong-token`)).status, 404);
    assert.equal((await rawRequest(url, { headers: { Host: 'rebound.example' } })).status, 403);
    assert.equal((await postForm(url, { apiKey: 'valid-key-0001', endpoint: 'hackathon' }, { Origin: 'https://evil.example' })).status, 403);
    const short = await postForm(url, { apiKey: 'short', endpoint: 'hackathon' });
    assert.equal(short.status, 400);
    const rejected = await postForm(url, { apiKey: 'wrong-key-0001', endpoint: 'production' });
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /not saved/);
    assert.equal((await store.read()).qloo, null);
    const done = page.done;
    const saved = await postForm(url, { apiKey: 'valid-key-0001', endpoint: 'production' }, { Origin: origin });
    assert.equal(saved.status, 200);
    assert.match(await saved.text(), /Moûsa is connected/);
    assert.deepEqual(await done, { saved: true, endpoint: 'production', savedAt: (await store.read()).qloo.savedAt });
    assert.equal((await store.read()).qloo.apiKey, 'valid-key-0001');
    assert.equal((await store.read()).qloo.baseUrl, 'https://api.qloo.com');
    assert.deepEqual(tested.map(item => item.baseUrl), ['https://api.qloo.com', 'https://api.qloo.com']);
    assert.equal(page.isOpen, false);
    await assert.rejects(fetch(url));
  } finally { page.close(); await rm(dir, { recursive: true, force: true }); }
});

test('an unused connection page closes when it expires', async () => {
  // The page's own timer does not hold a process open (an MCP server lives as long as its host), so the test does.
  const hold = setInterval(() => {}, 1000);
  try {
    const page = createConnectionPage({ store: { saveQloo: async () => ({}) }, testKey: async () => ({ ok: true }), ttlMs: 60 });
    const { url } = await page.open();
    assert.deepEqual(await page.done, { saved: false });
    assert.equal(page.isOpen, false);
    await assert.rejects(fetch(url));
  } finally { clearInterval(hold); }
});

test('the project folder comes from the host setting, then the folder Codex reports, then an approved one', async () => {
  const dir = await tempDir('mousa-project-');
  const other = await tempDir('mousa-project-b-');
  try {
    const meta = { [CODEX_SANDBOX_META]: { sandboxCwd: pathToFileURL(other).href, permissionProfile: { type: 'workspace' } } };
    assert.equal(sandboxCwdFromMeta(meta), fileURLToPath(pathToFileURL(other).href));
    assert.equal(sandboxCwdFromMeta({ [CODEX_SANDBOX_META]: { sandboxCwd: 'relative/folder' } }), null);
    assert.equal(sandboxCwdFromMeta(null), null);
    assert.equal((await resolveProjectRoot({ env: { MOUSA_PROJECT_DIR: dir }, meta })).source, 'environment');
    const reported = await resolveProjectRoot({ env: { MOUSA_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}' }, meta });
    assert.equal(reported.source, 'host');
    // The folder as the file system resolves it: a temporary folder may be named by a Windows short name.
    assert.equal(path.resolve(reported.root).toLowerCase(), path.resolve(await realpath(other)).toLowerCase());
    assert.equal((await resolveProjectRoot({ env: {}, session: { root: dir } })).source, 'approved');
    await assert.rejects(resolveProjectRoot({ env: {} }), error => error.code === 'PROJECT_DIR_MISSING' && /mousa_open_project/.test(error.message));
    await assert.rejects(checkProjectFolder('relative/path'), error => error.code === 'PROJECT_DIR_INVALID');
    await assert.rejects(checkProjectFolder(path.parse(dir).root), /too broad/);
    await assert.rejects(checkProjectFolder(os.homedir()), /home folder/);
    await assert.rejects(checkProjectFolder(path.join(dir, 'missing')), /does not exist/);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
});

test('the image brief is the Codex prompt without its Codex instruction, and providers depend on the host', async () => {
  const dna = { devices: [{ id: 'dna1', layer: 'palette', tokens: { colors: ['#112233', '#445566'] } }, { id: 'dna5', layer: 'imagery', device: 'Misty hillside shelves', qualities: ['Atmospheric'], tokens: { colors: ['#aabbcc'] } }] };
  const args = { dna, device: 'dna5', subject: 'Jars of preserves on a misty wooden shelf at dawn', aspect: 'square' };
  const { brief } = buildImageBrief(args);
  const { prompt } = buildImagePrompt(args);
  assert.ok(prompt.endsWith(`\n${brief}`));
  assert.match(prompt, /^Use your built-in image generation tool/);
  assert.match(brief, /^Subject: Jars of preserves/);
  assert.ok(!/built-in image generation tool/.test(brief));

  let checked = 0;
  const codex = async () => { checked++; return { available: true, version: '0.162.0' }; };
  const insideCodex = await inspectImageProviders({ host: 'codex', codex });
  assert.deepEqual(insideCodex.map(item => [item.id, item.status]), [['host-tool', 'available'], ['codex-cli', 'unavailable'], ['off', 'available']]);
  assert.equal(checked, 0, 'Codex is not inspected from inside Codex');
  const inClaude = await inspectImageProviders({ host: 'claude-code', codex });
  assert.deepEqual(inClaude.map(item => [item.id, item.status]), [['host-tool', 'depends'], ['codex-cli', 'available'], ['off', 'available']]);
  const hosted = await inspectImageProviders({ host: 'claude-code', environment: 'hosted', codex });
  assert.deepEqual(hosted.map(item => item.id), ['off']);
  const switchedOff = await inspectImageProviders({ host: 'codex', env: { MOUSA_IMAGES: 'off' }, codex });
  assert.deepEqual(switchedOff.map(item => item.id), ['off'], 'MOUSA_IMAGES=off turns off Codex\'s own image tool too');
  assert.match(switchedOff[0].note, /MOUSA_IMAGES=off/u);
});

function testServer({ env = {}, dir, fetchImpl = qlooOk, browser = { available: true, label: 'Microsoft Edge' }, codex = { available: false, reason: 'No Codex CLI was found.' } } = {}) {
  return createMousaServer({ env: { MOUSA_CONFIG_DIR: dir, ...env }, store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: dir }, protector: fakeProtector }), fetchImpl,
    inspect: { browser: async () => browser, codex: async () => codex, fonts: async () => ({ families: new Array(33).fill({}) }) } });
}

const MOUSA_TOOL_NAMES = ['mousa_status', 'mousa_connect', 'mousa_open_project', 'taste_profile', 'taste_ask', 'qloo_query',
  'design_validate', 'design_check', 'design_capture', 'image', 'materials', 'design_compare', 'design_report'];

test('the mousa surface stays lean: short instructions, few tools and the Codex folder capability', () => {
  assert.ok(MOUSA_INSTRUCTIONS.length <= MOUSA_INSTRUCTIONS_LIMIT, `instructions are ${MOUSA_INSTRUCTIONS.length} characters`);
  const server = createMousaServer({ env: {}, store: { read: async () => ({ qloo: null }) }, inspect: {} });
  const init = server.initialize({ protocolVersion: '2025-06-18' });
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.equal(server.initialize({ protocolVersion: '2099-01-01' }).protocolVersion, '2025-11-25');
  assert.deepEqual(init.serverInfo, { name: 'mousa', version: '0.6.0' });
  assert.deepEqual(init.capabilities.experimental, { [CODEX_SANDBOX_META]: {} });
  assert.equal(init.instructions, MOUSA_INSTRUCTIONS);
  assert.deepEqual(server.listTools().map(tool => tool.name), MOUSA_TOOL_NAMES);
  for (const tool of [...MOUSA_SETUP_TOOLS, ...server.listTools()]) assert.ok(tool.description.length <= 2048, `${tool.name} description is too long for Claude Code`);
});

test('mousa_status says what is missing in the host\'s own words and makes no request unless asked', async () => {
  const dir = await tempDir('mousa-status-');
  let requests = 0;
  const counting = async () => { requests++; return json({ results: [] }); };
  try {
    const claude = parse(await testServer({ env: { MOUSA_HOST: 'claude-code', QLOO_API_KEY: '${user_config.qloo_api_key}' }, dir, fetchImpl: counting }).callTool('mousa_status', {}));
    assert.equal(claude.status, 'needs-setup');
    assert.equal(claude.qloo.connected, false);
    assert.equal(claude.project.folder, null);
    assert.equal(claude.materials.fonts, 33);
    assert.equal(claude.capture.available, true);
    assert.ok(claude.setup.some(line => line.includes('/plugin configure mousa@mousa')));
    assert.ok(claude.setup.some(line => line.includes('mousa_open_project')));
    assert.ok(claude.setup.some(line => line.includes('own image tool')));
    const codex = parse(await testServer({ env: { MOUSA_HOST: 'codex' }, dir, fetchImpl: counting }).callTool('mousa_status', {}));
    assert.ok(codex.setup.some(line => line.startsWith('Qloo is not connected: call mousa_connect')));
    assert.deepEqual(codex.images.map(item => [item.id, item.status]), [['host-tool', 'available'], ['codex-cli', 'unavailable'], ['off', 'available']]);
    assert.equal(requests, 0);

    const ready = testServer({ env: { MOUSA_HOST: 'codex', QLOO_API_KEY: 'env-key-0001' }, dir, fetchImpl: counting });
    const meta = { [CODEX_SANDBOX_META]: { sandboxCwd: pathToFileURL(dir).href } };
    const checked = parse(await ready.callTool('mousa_status', { check: true }, meta));
    assert.equal(checked.status, 'ready');
    assert.deepEqual(checked.qloo.check, { ok: true });
    assert.equal(checked.qloo.source, 'environment');
    assert.equal(checked.project.source, 'host');
    assert.equal(requests, 1);
    const bad = parse(await testServer({ env: { QLOO_API_KEY: 'env-key-0002', MOUSA_PROJECT_DIR: dir }, dir, fetchImpl: qlooRejects }).callTool('mousa_status', { check: true }));
    assert.equal(bad.status, 'needs-setup');
    assert.equal(bad.qloo.check.code, 'QLOO_AUTH');
    const invalid = await ready.callTool('mousa_status', { check: 'yes' });
    assert.equal(invalid.isError, true);
    assert.equal(parse(invalid).error.code, 'TOOL_INPUT_INVALID');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mousa_connect hands out a page link, and the key saved there connects the session', async () => {
  const dir = await tempDir('mousa-connect-');
  const server = testServer({ env: { MOUSA_HOST: 'codex' }, dir });
  try {
    const opened = parse(await server.callTool('mousa_connect', {}));
    assert.equal(opened.status, 'open');
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/connect\//);
    assert.ok(!('note' in opened));
    assert.equal((await postForm(opened.url, { apiKey: 'page-key-0001', endpoint: 'hackathon' })).status, 200);
    const after = parse(await server.callTool('mousa_status', {}));
    assert.equal(after.qloo.connected, true);
    assert.equal(after.qloo.source, 'connections file');
    assert.equal(after.qloo.api, 'https://hackathon.api.qloo.com');
    const hosted = await createMousaServer({ env: { MOUSA_ENVIRONMENT: 'hosted' }, store: { read: async () => ({ qloo: null }) }, inspect: {} }).callTool('mousa_connect', {});
    assert.equal(parse(hosted).error.code, 'CONNECT_UNAVAILABLE');
  } finally { server.page.close(); await rm(dir, { recursive: true, force: true }); }
});

test('mousa_open_project sets an approved folder unless the host already names one', async () => {
  const dir = await tempDir('mousa-open-');
  const project = path.join(dir, 'site');
  await mkdir(project);
  try {
    const server = testServer({ env: { MOUSA_HOST: 'codex' }, dir });
    const opened = parse(await server.callTool('mousa_open_project', { path: project }));
    assert.equal(opened.status, 'opened');
    assert.equal(opened.source, 'approved');
    assert.equal(parse(await server.callTool('mousa_status', {})).project.source, 'approved');
    assert.equal(parse(await server.callTool('mousa_open_project', { path: 'relative' })).error.code, 'PROJECT_DIR_INVALID');
    const hosted = testServer({ env: { MOUSA_PROJECT_DIR: project }, dir });
    assert.equal(parse(await hosted.callTool('mousa_open_project', { path: dir })).status, 'unchanged');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the mousa entry speaks MCP over stdio and refuses tools before initialization', async () => {
  const dir = await tempDir('mousa-stdio-');
  try {
    const entry = fileURLToPath(new URL('../plugin/server/mousa.mjs', import.meta.url));
    const child = spawn(process.execPath, [entry], { env: { ...process.env, QLOO_API_KEY: '', MOUSA_HOST: 'codex', MOUSA_CONFIG_DIR: dir, MOUSA_CAPTURE: 'off', CODEX_IMAGES: 'off' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    child.stdin.end([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mousa_status', arguments: {} } }),
      JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'qloo_taste_profile', arguments: {} } }),
    ].join('\n') + '\n');
    assert.equal(await closed, 0);
    assert.equal(stderr, '');
    const messages = stdout.trim().split('\n').map(JSON.parse);
    assert.equal(messages.length, 5);
    assert.equal(messages[0].error.code, -32000);
    assert.equal(messages[1].result.serverInfo.name, 'mousa');
    assert.deepEqual(messages[2].result.tools.map(tool => tool.name), MOUSA_TOOL_NAMES);
    const status = JSON.parse(messages[3].result.content[0].text);
    assert.equal(status.host, 'codex');
    assert.equal(status.qloo.connected, false);
    assert.equal(status.capture.available, false);
    assert.ok(!('structuredContent' in messages[3].result));
    assert.equal(JSON.parse(messages[4].result.content[0].text).error.code, 'TOOL_UNKNOWN');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
