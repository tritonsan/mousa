import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { validatePublicResearchUrl, extractNativeWebSources, boundNativeWebResponse, normalizeNativeWebToolName, selectNativeWebText } from '../src/web-research.mjs';
import { runWebResearchHook } from '../src/kiro-web-hook.mjs';

test('native fetch inputs and recorded identities exclude private addresses, credentials and capability parameters', () => {
  for (const url of ['file:///secrets', 'https://user:secret@publisher.com/page', 'http://localhost/page', 'http://127.1/page', 'http://2130706433/page', 'http://10.4.0.2/page', 'http://172.20.0.1/page', 'http://192.168.1.4/page', 'http://169.254.169.254/page', 'http://[::1]/page', 'http://[::ffff:127.0.0.1]/page', 'https://publisher.com/?api_key=private', 'https://publisher.com/?token=private']) assert.throws(() => validatePublicResearchUrl(url));
  assert.equal(validatePublicResearchUrl('https://publisher.com/design#methods'), 'https://publisher.com/design');
});

test('native hook name normalization accepts only known web aliases', () => {
  for (const name of ['web_fetch', 'webFetch', 'WebFetch', '@builtin/web_fetch']) assert.equal(normalizeNativeWebToolName(name), 'web_fetch');
  for (const name of ['web_search', 'WebSearch', '@builtin/web_search']) assert.equal(normalizeNativeWebToolName(name), 'web_search');
  for (const name of ['@culture/web_fetch', 'shell', 'something-web_fetch', null]) assert.equal(normalizeNativeWebToolName(name), null);
});

test('only literal returned search entries become bounded sources', () => {
  const sources = extractNativeWebSources({ toolName: 'web_search', input: { query: 'fictional design reference' }, response: { success: true, result: [JSON.stringify({ results: [
    { url: 'https://publisher.com/first', title: 'Creator explains a mechanic', snippet: 'The creator describes connecting fragments.' },
    { url: 'http://127.0.0.1/private', title: 'Private reference', snippet: 'Do not include this.' },
    { url: 'https://publisher.com/no-excerpt', title: 'A title is not descriptive evidence.' },
  ] })] } });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'Creator explains a mechanic');
  assert.equal(sources[0].excerpt, 'The creator describes connecting fragments.');
  assert.equal(sources[0].tool, 'web_search');
  assert.equal(sources[0].sourceType, 'other');
  assert.deepEqual(sources[0].entityIds, []);
  assert.deepEqual(sources[0].qlooEvidenceIds, []);
});

test('native fetched page content cannot turn outgoing links into fetched sources', () => {
  const sources = extractNativeWebSources({ toolName: 'web_fetch', input: { url: 'https://creator.com/interview' }, response: {
    success: true, result: ['An actual excerpt about connecting fragments. Further reading: https://unfetched.com/not-visited'],
  } });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://creator.com/interview');
  assert.match(sources[0].excerpt, /connecting fragments/);
  assert.match(sources[0].limitation, /requested URL/);
});

test('failed and unknown native response shapes produce no successful sources', () => {
  for (const response of [null, { success: false, result: ['https://publisher.com/page actual-looking text'] }, { error: 'Provider unavailable' }, { Failure: { message: 'Native fetch unavailable.' } }, { Error: { message: 'Native fetch unavailable.' } }, { unsupported: 32 }, 'Error fetching https://publisher.com/page']) {
    assert.deepEqual(extractNativeWebSources({ toolName: 'web_fetch', input: { url: 'https://publisher.com/page' }, response }), []);
  }
  assert.deepEqual(extractNativeWebSources({ toolName: 'web_search', response: 'No source URLs are available.' }), []);
  assert.deepEqual(extractNativeWebSources({ toolName: 'agent_message', response: 'https://publisher.com/page authored text' }), []);
});

test('the observed Kiro native result envelope preserves literal content without using assistant text', () => {
  const sources = extractNativeWebSources({ toolName: 'web_fetch', input: { url: 'https://creator.com/reference', mode: 'truncated' }, response: { Success: { items: [{ Text: 'A literal native page excerpt about exploration.' }] } } });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://creator.com/reference');
  assert.equal(sources[0].excerpt, 'A literal native page excerpt about exploration.');
});

test('native response capture preserves literal prefixes and bounded source counts', () => {
  const response = { results: Array.from({ length: 40 }, (_, index) => ({ url: `https://publisher.com/reference-${index}`, title: `Reference ${index}`, snippet: 'a'.repeat(5000) })) };
  const bounded = boundNativeWebResponse(response);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 80000);
  const sources = extractNativeWebSources({ toolName: 'web_search', response });
  assert.equal(sources.length, 20);
  assert.equal(sources[0].excerpt.length, 4000);
  assert.equal(sources[0].truncated, true);
});

test('page chrome and oversized decorative infoboxes do not displace the literal article body', () => {
  const article = '**A fictional reference** is an exploration game where visitors discover connected clues in a changing world. Its creator describes a quiet journey in which each observation changes what a player understands. Further reading: https://unfetched.com/another-reference.\n\n'
    + 'The player follows their own questions rather than a prescribed list of tasks. A journal preserves the connections between discoveries while the world changes around them.\n\n'.repeat(35);
  const prefix = '[Jump to content][1]\n\nMain menu\nNavigation\n* [Main page][2]\n\n## Contents\n\n* Gameplay\n\n'
    + `A decorative infobox\n${'─'.repeat(50000)}\n\n`;
  const literal = prefix + article + '\n\nFurther reading: https://unfetched.com/another-reference';
  const response = { Success: { items: [{ Text: literal }] } };
  const bounded = boundNativeWebResponse(response);
  const sources = extractNativeWebSources({ toolName: 'web_fetch', input: { url: 'https://creator.com/article' }, response: bounded });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://creator.com/article');
  assert.equal(sources[0].excerpt, article.slice(0, 4000));
  assert.match(sources[0].excerpt, /https:\/\/unfetched.com\/another-reference/u);
  assert.ok(literal.includes(sources[0].excerpt));
  assert.doesNotMatch(sources[0].excerpt, /Main menu|Navigation|─/u);
  assert.equal(sources[0].truncated, true);
  assert.match(sources[0].limitation, /literal body window.*omitted text/u);
  assert.match(sources[0].limitation, /original runtime transcript was not modified/u);
  assert.equal(bounded.__studioCapture.selections[0].start, prefix.length);
  assert.equal(bounded.__studioCapture.selections[0].originalLength, literal.length);
  assert.equal(response.Success.items[0].Text, literal);
  assert.equal(Object.hasOwn(response, '__studioCapture'), false);
});

test('direct fetched response selection remains a contiguous literal subset and does not infer an article topic', () => {
  const paragraph = 'A reference can describe how an audience encounters a story through its own discoveries. This paragraph is retained exactly, including punctuation, Markdown links and spelling. [Related work][5] is merely an outgoing reference.\n\n';
  const literal = '[Jump to content][1]\n\nNavigation\n* [Main page][2]\n\n' + paragraph.repeat(22);
  const selected = selectNativeWebText(literal);
  assert.equal(selected.method, 'literal-body-window');
  assert.equal(selected.text, literal.slice(selected.start, selected.end));
  assert.ok(selected.start > 0);
  const source = extractNativeWebSources({ toolName: 'web_fetch', input: { url: 'https://creator.com/read' }, response: literal })[0];
  assert.equal(source.excerpt, selected.text);
  assert.match(source.limitation, /not a summary or a completeness check/u);
});

test('unrecognized pages retain a literal prefix and byte bounding never serializes excerpts into invented prose', () => {
  const literal = 'An ordinary introduction. '.repeat(700);
  assert.equal(selectNativeWebText(literal).method, 'literal-prefix');
  assert.equal(selectNativeWebText(literal).text, literal.slice(0, 4000));
  const quoted = 'Literal "quoted" characters, emoji 😀 and long rules ─ must remain exact. '.repeat(500);
  const response = { results: Array.from({ length: 20 }, (_, index) => ({ url: `https://publisher.com/${index}`, title: 'A literal reference', snippet: quoted })) };
  const bounded = boundNativeWebResponse(response);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 80000);
  const sources = extractNativeWebSources({ toolName: 'web_search', response: bounded });
  assert.ok(sources.length > 0);
  for (const source of sources) assert.ok(quoted.includes(source.excerpt));
  assert.deepEqual(extractNativeWebSources({ toolName: 'web_fetch', input: { url: 'https://publisher.com/error' }, response: boundNativeWebResponse({ Error: { message: literal } }) }), []);
});

test('authenticated pre-hook requires an allowed host receipt and never repeats a blocked request', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url: url.href, options }); return { ok: true, json: async () => ({ structuredContent: { status: 'allowed' } }) }; };
  const args = { phase: 'before', event: { tool_name: 'web_search', tool_input: { query: 'creator interview' } }, bridgeUrl: 'http://127.0.0.1:8787/internal/tools', bridgeToken: 'fixture-host-only-token', fetchImpl };
  assert.equal((await runWebResearchHook(args)).status, 'allowed');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-host-only-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), { name: 'studio_web_before', arguments: { toolName: 'web_search', input: { query: 'creator interview' } } });
  let rejected = 0;
  await assert.rejects(runWebResearchHook({ ...args, fetchImpl: async () => { rejected++; return { ok: true, json: async () => ({ structuredContent: { status: 'blocked', error: { message: 'Save the provisional plan first.' } } }) }; } }), /provisional plan/);
  assert.equal(rejected, 1);
});

test('post-hook forwards observed tool responses and fails without a recorded host receipt', async () => {
  const requests = [];
  const args = { phase: 'after', event: { tool_name: 'web_fetch', tool_input: { url: 'https://publisher.com/interview' }, tool_response: { success: true, result: ['Actual reference content.'] } },
    bridgeUrl: 'http://127.0.0.1:8787/internal/tools', bridgeToken: 'fixture-host-only-token',
    fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ structuredContent: { status: 'recorded', sources: [{ id: 'W001' }] } }) }; } };
  assert.deepEqual(await runWebResearchHook(args), { status: 'recorded', sources: [{ id: 'W001' }] });
  assert.deepEqual(requests[0].arguments.response, args.event.tool_response);
  await assert.rejects(runWebResearchHook({ ...args, event: { tool_name: 'web_fetch', tool_input: {} } }), /did not supply/);
  await assert.rejects(runWebResearchHook({ ...args, fetchImpl: async () => ({ ok: false }) }), /rejected/);
  await assert.rejects(runWebResearchHook({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ structuredContent: { status: 'ok' } }) }) }), /host receipt/);
});

test('host-controlled hook executable passes a real local receipt through stdin and keeps credentials out of output', async t => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk.toString();
    requests.push({ authorization: request.headers.authorization, body: JSON.parse(raw) });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ structuredContent: { status: 'recorded', sources: [{ id: 'W001', excerpt: 'Actual fixture response.' }] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const child = spawn(process.execPath, ['src/kiro-web-hook.mjs', 'after'], { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, CULTURE_WEB_BRIDGE_URL: `http://127.0.0.1:${server.address().port}`, CULTURE_WEB_BRIDGE_TOKEN: 'fixture-host-only-token' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ tool_name: 'web_fetch', tool_input: { url: 'https://publisher.com/interview' }, tool_response: { success: true, result: ['Actual fixture response.'] } }));
  assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }), 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, 'Bearer fixture-host-only-token');
  assert.equal(requests[0].body.name, 'studio_web_after');
  assert.equal(JSON.parse(stdout).sources[0].id, 'W001');
  assert.equal(stderr, '');
  assert.doesNotMatch(stdout + stderr, /fixture-host-only-token/u);
});
