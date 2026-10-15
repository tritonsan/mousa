// What a hosted server does differently from a desk: smaller review captures for the model, a log a collector can read
// with no id or token in it, and the engine's capture side as MOUSA_CAPTURE_INLINE_SIDE sets it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { inlineCaptureSide, INLINE_CAPTURE_MAX_SIDE, HOSTED_CAPTURE_MAX_SIDE } from '../plugin/server/design/tools.mjs';
import { createLogger, routePattern } from '../src/log.mjs';

test('a hosted server hands the model smaller captures, and MOUSA_CAPTURE_INLINE_SIDE sets the side within its bounds', () => {
  assert.equal(inlineCaptureSide({}), INLINE_CAPTURE_MAX_SIDE);
  assert.equal(inlineCaptureSide({ MOUSA_ENVIRONMENT: 'hosted' }), HOSTED_CAPTURE_MAX_SIDE);
  assert.equal(inlineCaptureSide({ MOUSA_ENVIRONMENT: 'hosted', MOUSA_CAPTURE_INLINE_SIDE: '800' }), 800);
  assert.equal(inlineCaptureSide({ MOUSA_CAPTURE_INLINE_SIDE: '640' }), 640);
  for (const bad of ['100', '9000', 'big', '1024.5', '']) assert.equal(inlineCaptureSide({ MOUSA_ENVIRONMENT: 'hosted', MOUSA_CAPTURE_INLINE_SIDE: bad }), HOSTED_CAPTURE_MAX_SIDE, bad);
  assert.ok(HOSTED_CAPTURE_MAX_SIDE < INLINE_CAPTURE_MAX_SIDE);
});

test('a route pattern keeps no try id, preview token, ballot or file name', () => {
  assert.equal(routePattern('/try/f8d19b290fe8f8d30b03aa50e9a0d2af/'), '/try/:id');
  assert.equal(routePattern('/try/f8d19b290fe8f8d30b03aa50e9a0d2af/files/.mousa/report/index.html'), '/try/:id/files/*');
  assert.equal(routePattern('/try/f8d19b290fe8f8d30b03aa50e9a0d2af/progress/with-qloo.png'), '/try/:id/progress/*');
  assert.equal(routePattern(`/try/${'a'.repeat(32)}/${'b'.repeat(48)}/with-qloo/index.html`), '/try/:id/:id/with-qloo/index.html');
  assert.equal(routePattern('/vote/image/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-/left/0'), '/vote/image/:long/left/0');
  assert.equal(routePattern('/gallery/try-f8d19b29/report/card.png'), '/gallery/try-f8d19b29/report/*');
  assert.equal(routePattern('/api/jobs/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0/cancel'), '/api/jobs/:id/cancel');
  assert.equal(routePattern('/api/health?x=1'), '/api/health');
  assert.equal(routePattern('/'), '/');
  assert.equal(routePattern(''), '/');
});

const capture = () => { const stream = new PassThrough(); let text = ''; stream.on('data', chunk => { text += chunk; }); return { stream, text: () => text }; };

test('the JSON log writes one redacted object a line, and answers the console\'s own methods', () => {
  const out = capture(), err = capture();
  const log = createLogger({ format: 'json', redact: value => value.replaceAll('ksk_secret_1', '[redacted]'), stdout: out.stream, stderr: err.stream, now: () => new Date('2026-10-15T10:00:00Z') });
  log.info('request', { route: '/try/:id', status: 200, ms: 12.3 });
  log.warn('Try: not open. Key ksk_secret_1 missing.');
  log.error?.('Try: failed with ksk_secret_1');
  log.log('started', { app: 'http://127.0.0.1:8787' });
  const lines = out.text().trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines[0], { time: '2026-10-15T10:00:00.000Z', level: 'info', event: 'request', route: '/try/:id', status: 200, ms: 12.3 });
  assert.deepEqual(lines[1], { time: '2026-10-15T10:00:00.000Z', level: 'warn', message: 'Try: not open. Key [redacted] missing.' });
  assert.deepEqual(lines[2], { time: '2026-10-15T10:00:00.000Z', level: 'error', message: 'Try: failed with [redacted]' });
  assert.equal(lines[3].event, 'started');
  assert.equal(err.text(), '', 'JSON goes to one stream');
});

test('the text log writes warnings and errors to the error stream, as the console did', () => {
  const out = capture(), err = capture();
  const log = createLogger({ format: 'text', stdout: out.stream, stderr: err.stream });
  log.info('started', { app: 'http://127.0.0.1:8787' });
  log.warn('Gallery: an entry was left out.');
  log.error('unhandled-rejection', { message: 'boom' });
  assert.equal(out.text(), 'started {"app":"http://127.0.0.1:8787"}\n');
  assert.equal(err.text(), 'warn: Gallery: an entry was left out.\nerror: unhandled-rejection boom\n');
});
