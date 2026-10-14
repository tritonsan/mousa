// The blind vote: sealed ballots that expire and count once, limits per address, picture URLs that never say which arm
// they show, the Wilson interval, a record that survives a restart and keeps no address, and the vote's pages served by
// a Studio from a fixture gallery. No model, Qloo or browser request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getConfig } from '../src/config.mjs';
import { createStudio } from '../src/server.mjs';
import { createVoteBox, wilson, voterAddress, VoteError, VOTE_LIMITS } from '../src/votes.mjs';
import { png } from './helpers/mousa-fixtures.mjs';

const ARMS = [{ label: 'With Qloo', taste: 'qloo' }, { label: 'Without Qloo', taste: 'own prediction' }];
const readyKiro = async () => ({ available: true, authenticated: true, version: 'test-only', defaultModel: 'fixed-test-model' });

/** A clock that moves only when told, and bytes from a counter, so ballots and sides are reproducible. */
function determinism(start = Date.parse('2026-10-20T10:00:00Z')) {
  let time = start, counter = 0;
  return { now: () => time, advance: ms => { time += ms; }, random: size => Buffer.from(Array.from({ length: size }, () => (counter++ * 37) % 256)) };
}

test('a ballot is sealed: altered, expired or foreign tokens open nothing, and a side names its arm only on the server', async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-votes-'));
  try {
    const clock = determinism();
    const box = await createVoteBox({ dataDir: data, secret: 'test-only-secret', pairs: [{ id: 'pair-one', arms: ARMS }], now: clock.now, random: clock.random });
    const ballot = box.issue('203.0.113.7');
    assert.equal(ballot.pair, 'pair-one');
    assert.doesNotMatch(ballot.token, /pair-one|qloo|true|false/iu, 'the token says nothing readable');
    const left = box.side(ballot.token, 'left'), right = box.side(ballot.token, 'right');
    assert.deepEqual([left.arm, right.arm].sort(), [0, 1]);
    assert.equal(left.arm, ballot.flip ? 1 : 0);
    const altered = `${ballot.token.slice(0, -2)}${ballot.token.at(-2) === 'A' ? 'B' : 'A'}${ballot.token.at(-1)}`;
    assert.equal(box.side(altered, 'left'), null);
    const other = await createVoteBox({ dataDir: data, secret: 'another-secret', pairs: [{ id: 'pair-one', arms: ARMS }], now: clock.now });
    assert.equal(other.side(ballot.token, 'left'), null, 'a ballot sealed under another key opens nothing');
    clock.advance(VOTE_LIMITS.ballotMs + 1);
    assert.equal(box.side(ballot.token, 'left'), null, 'an expired ballot opens nothing');
    await assert.rejects(box.cast({ token: ballot.token, choice: 'left', address: '203.0.113.7' }), error => error instanceof VoteError && error.status === 400);
  } finally { await fs.rm(data, { recursive: true, force: true }); }
});

test('a vote counts once, an address votes once a day on a pair and a limited number of times an hour, and the record keeps no address', async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-votes-cast-'));
  try {
    const clock = determinism();
    const pairs = Array.from({ length: 40 }, (_, index) => ({ id: `pair-${index}`, arms: ARMS }));
    const box = await createVoteBox({ dataDir: data, secret: 'test-only-secret', pairs, now: clock.now, random: clock.random });
    const address = '198.51.100.23';
    const first = box.issue(address);
    const outcome = await box.cast({ token: first.token, choice: 'left', address });
    assert.equal(outcome.choice, first.flip ? 'baseline' : 'qloo', 'left shows arm 0 unless the sides were flipped');
    assert.equal(outcome.qlooSide, first.flip ? 'right' : 'left');
    await assert.rejects(box.cast({ token: first.token, choice: 'left', address }), error => error.status === 409, 'the same ballot counts once');
    const again = box.issue(address, { pair: first.pair });
    await assert.rejects(box.cast({ token: again.token, choice: 'right', address }), error => error.status === 409 && /already voted on this pair today/u.test(error.message));
    await assert.rejects(box.cast({ token: box.issue(address).token, choice: 'maybe', address }), error => error.status === 400);
    // The least-voted pair comes first, so each new ballot is another pair; the hour's limit then stops the address.
    for (let index = 1; index < VOTE_LIMITS.perHour; index++) {
      const ballot = box.issue(address);
      assert.notEqual(ballot.pair, first.pair);
      await box.cast({ token: ballot.token, choice: 'same', address });
    }
    await assert.rejects(box.cast({ token: box.issue(address).token, choice: 'left', address }), error => error.status === 429);
    await box.cast({ token: box.issue('192.0.2.1').token, choice: 'right', address: '192.0.2.1' });
    const saved = await fs.readFile(path.join(data, 'votes', 'votes.jsonl'), 'utf8');
    assert.equal(saved.trim().split('\n').length, VOTE_LIMITS.perHour + 1);
    assert.ok(!saved.includes(address) && !saved.includes('192.0.2.1'), 'no address is written');
    // A restart reads the record back: the results stay, and a cast ballot still counts once.
    const restarted = await createVoteBox({ dataDir: data, secret: 'test-only-secret', pairs, now: clock.now, random: clock.random });
    assert.deepEqual(restarted.results(), box.results());
    await assert.rejects(restarted.cast({ token: first.token, choice: 'right', address: '192.0.2.99' }), error => error.status === 409);
    const counted = box.results().find(result => result.pair === first.pair);
    assert.equal(counted.votes, 1);
    assert.equal(counted.qloo + counted.baseline, 1);
  } finally { await fs.rm(data, { recursive: true, force: true }); }
});

test('a visitor draws a limited number of ballots an hour, the address comes from a proxy only when it is trusted, and the interval is Wilson\'s', async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-votes-limits-'));
  try {
    const clock = determinism();
    const box = await createVoteBox({ dataDir: data, secret: 'x', pairs: [{ id: 'pair-one', arms: ARMS }], now: clock.now, random: clock.random });
    for (let index = 0; index < VOTE_LIMITS.ballotsPerHour; index++) box.issue('203.0.113.9');
    assert.throws(() => box.issue('203.0.113.9'), error => error.status === 429);
    clock.advance(60 * 60 * 1000 + 1);
    assert.ok(box.issue('203.0.113.9').token, 'the limit is per hour');
  } finally { await fs.rm(data, { recursive: true, force: true }); }
  const req = { headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.2' } };
  assert.equal(voterAddress(req, false), '10.0.0.2');
  assert.equal(voterAddress(req, true), '198.51.100.1');
  assert.equal(wilson(0, 0), null);
  const [low, high] = wilson(5, 10);
  assert.ok(Math.abs(low - 0.2366) < 0.001 && Math.abs(high - 0.7634) < 0.001, `${low} ${high}`);
  const [none, top] = wilson(0, 4);
  assert.equal(none, 0);
  assert.ok(top > 0.45 && top < 0.5);
});

/** A data folder with a gallery of one comparison whose arms' captures differ, so a picture tells its arm. */
async function comparisonGallery() {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-votes-site-'));
  const write = async (file, content) => { await fs.mkdir(path.dirname(path.join(data, file)), { recursive: true }); await fs.writeFile(path.join(data, file), content); };
  const capture = (file, color) => ({ file, width: 8, height: 4, label: 'frame · pose', color });
  const views = [{ key: 'frame-pose', label: 'frame · pose', a: capture('assets/captures/a-r1-frame-pose.png'), b: capture('assets/captures/b-r1-frame-pose.png') }];
  const record = { schemaVersion: '1.0', kind: 'comparison', title: 'For an audience that loves a test-only work', medium: 'game', audience: { references: [{ name: 'A test-only work' }] },
    headline: { value: '0.50', text: 'heuristic distance', sentence: 'Test-only.' }, arms: ARMS.map(arm => ({ ...arm, headline: { value: '1', text: 'x', sentence: 'x' } })), samePrediction: true,
    measure: 'data', distance: { overall: 0.5 }, views, layers: [], limits: [], records: [{ taste: 'qloo', reviews: [] }, { taste: 'own prediction', reviews: [] }] };
  await write('gallery/pair-one/report/record.json', JSON.stringify(record));
  await write('gallery/pair-one/report/assets/captures/a-r1-frame-pose.png', png(8, 4, ['#ff0000']));
  await write('gallery/pair-one/report/assets/captures/b-r1-frame-pose.png', png(8, 4, ['#0000ff']));
  await write('gallery/pair-one/entry.json', JSON.stringify({ schemaVersion: '1.0', id: 'pair-one', kind: 'comparison', title: 'Test-only pair', host: 'codex', medium: 'game', arms: ARMS, play: [], report: {}, timeline: { lanes: [] } }));
  await write('gallery/gallery.json', JSON.stringify({ schemaVersion: '1.0', featured: 'pair-one', vote: ['pair-one'], entries: [{ id: 'pair-one', kind: 'comparison', title: 'Test-only pair', host: 'codex', medium: 'game' }] }));
  return data;
}

test('the vote\'s pages ask blind, take the vote from their own form, say which side was Qloo after it and count it', async t => {
  const data = await comparisonGallery();
  const studio = await createStudio({ config: getConfig({ HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: data, SITE_SECRET: 'test-only-site-secret' }), inspect: readyKiro });
  t.after(async () => { await studio.close(); await fs.rm(data, { recursive: true, force: true }); });
  const app = studio.appUrl;
  const ballotPage = await fetch(`${app}/vote/`);
  const html = await ballotPage.text();
  assert.equal(ballotPage.status, 200);
  assert.doesNotMatch(html, /<script/iu);
  assert.doesNotMatch(html, /a-r1-frame-pose|b-r1-frame-pose/u, 'the page names no capture file');
  assert.match(html, /Which character would this audience rather play\?/u);
  const token = /name="ballot" value="([A-Za-z0-9_-]+)"/u.exec(html)[1];
  const pictures = {};
  for (const side of ['left', 'right']) {
    const response = await fetch(`${app}/vote/image/${token}/${side}/0`);
    assert.equal(response.status, 200);
    pictures[side] = Buffer.from(await response.arrayBuffer());
  }
  assert.ok(!pictures.left.equals(pictures.right), 'the two sides show the two arms');
  const qloo = await fs.readFile(path.join(data, 'gallery', 'pair-one', 'report', 'assets', 'captures', 'a-r1-frame-pose.png'));
  const qlooSide = pictures.left.equals(qloo) ? 'Left' : 'Right';
  assert.equal((await fetch(`${app}/vote/image/${token}/left/1`)).status, 404, 'only the views the ballot shows');
  const post = (body, headers = {}) => fetch(`${app}/vote/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body });
  assert.equal((await post(`ballot=${token}&choice=left`, { Origin: 'https://elsewhere.example' })).status, 403, 'a vote from another site is refused');
  const thanks = await post(`ballot=${token}&choice=left`, { Origin: app });
  assert.equal(thanks.status, 200);
  assert.match(await thanks.text(), new RegExp(`${qlooSide} was the design made with Qloo\\.`, 'u'));
  assert.equal((await post(`ballot=${token}&choice=right`)).status, 409, 'a ballot counts once');
  const results = await (await fetch(`${app}/api/vote/results`)).json();
  assert.deepEqual(results.pairs.map(item => [item.pair, item.votes, item.title]), [['pair-one', 1, 'Test-only pair']]);
  const table = await fetch(`${app}/vote/results/`);
  assert.equal(table.status, 200);
  assert.match(await table.text(), /Results so far/u);
});
