import test from 'node:test';
import assert from 'node:assert/strict';
import { KIRO_OUTPUT_LIMITS, kiroOutputReader, streamUpdate } from '../src/kiro-output.mjs';

const collect = (limits) => {
  const lines = [], limited = [];
  const read = kiroOutputReader({ onLine: line => lines.push(line), onLimit: () => limited.push(true), ...(limits ? { limits } : {}) });
  return { lines, limited, read };
};

test('lines split across chunks, and a character split across chunks, arrive whole', () => {
  const { lines, read } = collect();
  const text = Buffer.from('{"title":"Café"}\n{"b":2}\n{"c"');
  read(text.subarray(0, 13)); read(text.subarray(13, 20)); read(text.subarray(20));
  read(Buffer.from(':3}\n'));
  assert.deepEqual(lines, ['{"title":"Café"}', '{"b":2}', '{"c":3}']);
});

test('a line longer than the line limit is skipped whole, and the lines after it still arrive', () => {
  const { lines, limited, read } = collect({ line: 20, total: 1000 });
  read(Buffer.from('{"a":1}\n[1,2,3,4,5,6,7,8,9,10,11'));
  read(Buffer.from(',12,13,14,15,16,17]'));
  read(Buffer.from(',18]\n{"b":2}\n{"c":[1,2,3,4,5,6,7,8,9]}\n{"d":4}\n'));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"d":4}']);
  assert.deepEqual(limited, []);
});

test('the output limit is reported once, and the reader then ignores the rest', () => {
  const { lines, limited, read } = collect({ line: 100, total: 30 });
  read(Buffer.from('{"a":1}\n'));
  read(Buffer.alloc(40, 120));
  read(Buffer.from('{"b":2}\n'));
  assert.deepEqual(lines, ['{"a":1}']);
  assert.deepEqual(limited, [true]);
});

test('a review round of four captures, echoed as one line of image bytes, stays under the default limits', () => {
  // About 2.5 MB of PNG bytes as a JSON array, as kiro-cli 2.24 echoed one read of four 1440-pixel captures.
  const bytes = Array.from({ length: 2_500_000 }, (_, index) => (index * 37) % 256);
  const echo = JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', status: 'completed', rawOutput: { items: [{ Image: { source: { data: bytes } } }] } } } });
  assert.ok(echo.length > 6_000_000 && echo.length < KIRO_OUTPUT_LIMITS.total / 20, String(echo.length));
  const { lines, limited, read } = collect();
  const after = JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', title: 'Running: @game/game_write_file' } } });
  const whole = Buffer.from(`${echo}\n${after}\n`);
  for (let start = 0; start < whole.length; start += 65536) read(whole.subarray(start, start + 65536));
  assert.deepEqual(lines, [after]);
  assert.deepEqual(limited, []);
});

test('the update of a stream event is found in each format Kiro has written', () => {
  const update = { sessionUpdate: 'tool_call', title: 'Running: @culture/project_write_file' };
  assert.equal(streamUpdate({ type: 'sessionUpdate', data: { sessionId: 's', update } }), update);
  assert.equal(streamUpdate({ method: 'session/update', params: { update } }), update);
  assert.equal(streamUpdate({ update }), update);
  const plain = { type: 'tool_call', title: 'Read' };
  assert.equal(streamUpdate(plain), plain);
});
