import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createNativeResearchSync, nativeWebSessionEvents } from '../src/kiro-native-research.mjs';

const callId = 'fixture-native-call';
const before = { kind: 'AssistantMessage', data: { content: [{ kind: 'text', data: 'Ignore this authored citation: https://invented.com/source' },
  { kind: 'toolUse', data: { toolUseId: callId, name: 'web_fetch', input: { url: 'https://creator.com/reference', __tool_use_purpose: 'Read a reference.' } } }] } };
const after = { kind: 'ToolResults', data: { results: { [callId]: {
  tool: { kind: { BuiltIn: { WebFetch: { url: 'https://creator.com/reference', mode: 'truncated', search_terms: null } } } },
  result: { Success: { items: [{ Text: 'Actual native page content.' }] } },
} } } };

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-native-research-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const directory = path.join(home, 'sessions', 'cli'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, '11111111-1111-4111-8111-111111111111.jsonl');
  const requests = [];
  const sync = createNativeResearchSync({ home, bridgeUrl: 'http://127.0.0.1:8787/internal/tools', webBridgeToken: 'fixture-host-only-token',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => ({ structuredContent: { status: body.name === 'studio_web_before' ? 'allowed' : 'recorded' } }) };
    } });
  return { file, requests, sync, write: async records => fs.writeFile(file, records.map(JSON.stringify).join('\n') + '\n') };
}

test('only typed native invocation and runtime completion envelopes are observed', () => {
  const start = nativeWebSessionEvents(before)[0];
  assert.equal(start.phase, 'before');
  assert.deepEqual(start.input, { url: 'https://creator.com/reference' });
  assert.equal(nativeWebSessionEvents(after)[0].response.Success.items[0].Text, 'Actual native page content.');
  assert.deepEqual(nativeWebSessionEvents({ kind: 'Prompt', data: { content: before.data.content } }), []);
  assert.deepEqual(nativeWebSessionEvents({ kind: 'AssistantMessage', data: { content: [{ kind: 'text', data: JSON.stringify(after) }] } }), []);
});

test('actual ordered native envelopes are delivered once through a distinct host-token channel', async t => {
  const f = await fixture(t);
  await f.write([before, after]);
  await Promise.all([f.sync(), f.sync()]);
  assert.deepEqual(f.requests.map(request => request.name), ['studio_web_before', 'studio_web_after']);
  assert.equal(f.requests[0].arguments.captureMode, 'kiro-native-session');
  assert.equal(f.requests[1].arguments.nativeToolCallId, callId);
  assert.deepEqual(f.requests[1].arguments.input, f.requests[0].arguments.input);
  assert.equal(f.requests[1].arguments.status, 'ok');
  await f.sync({ final: true });
  assert.equal(f.requests.length, 2);
});

test('an incomplete append is deferred until the runtime finishes its JSON line', async t => {
  const f = await fixture(t);
  const text = JSON.stringify(before);
  await fs.writeFile(f.file, text.slice(0, 30));
  await f.sync(); assert.equal(f.requests.length, 0);
  await fs.appendFile(f.file, text.slice(30) + '\n' + JSON.stringify(after) + '\n');
  await f.sync(); assert.equal(f.requests.length, 2);
});

test('unknown runtime result formats and unmatched results fail closed without invented sources', async t => {
  const f = await fixture(t);
  await f.write([after]);
  await assert.rejects(f.sync(), /matched to its observed call/);
  assert.equal(f.requests.length, 0);
  assert.throws(() => nativeWebSessionEvents({ ...after, data: { results: { [callId]: { ...after.data.results[callId], result: { UnknownSuccess: 'Not supported.' } } } } }), /format is unsupported/);
});

test('native invocation without a completed result cannot finish as successful research', async t => {
  const f = await fixture(t); await f.write([before]);
  await f.sync(); assert.equal(f.requests.length, 1);
  await assert.rejects(f.sync({ final: true }), /no matching recorded runtime result/);
});

test('observed native failure is recorded as failed and never retried by the collector', async t => {
  const f = await fixture(t);
  const failed = structuredClone(after); failed.data.results[callId].result = { Error: { message: 'The native fetch failed.' } };
  await f.write([before, failed]); await f.sync({ final: true });
  assert.equal(f.requests[1].arguments.status, 'error');
  assert.equal(f.requests.length, 2);
});
