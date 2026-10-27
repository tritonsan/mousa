// The agents' blind spot as the gallery, the site and scripts/blind-spot-stats.mjs read it: one record's counts, the
// totals over a gallery with one frozen prediction counted once, and a design made without Qloo left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { benchmarkTotals, blindSpotOf, blindSpotTotals, readGalleryBlindSpots } from '../src/gallery/blind-spot.mjs';

const measured = (works, known, guessed, confirmed, frozenAt) => ({ prediction: { frozenAt }, measured: { counts: { works, worksPredicted: known, worksNew: works - known, predictions: guessed, predictionsMeasured: confirmed, qualities: 18, qualitiesPredicted: 1 } } });

test('a record\'s blind spot is what its own measurement counted, and a design without Qloo has none', () => {
  assert.deepEqual(blindSpotOf(measured(60, 4, 28, 4, '2026-10-13T20:29:09.519Z')),
    { works: 60, known: 4, guessed: 28, confirmed: 4, qualities: 18, qualitiesKnown: 1, frozenAt: '2026-10-13T20:29:09.519Z' });
  assert.equal(blindSpotOf({ prediction: { frozenAt: 'x' } }), null, 'no measurement, no blind spot');
  assert.equal(blindSpotOf({ measured: { counts: { works: 0 } } }), null);
});

test('the totals count one frozen prediction once and split by host', () => {
  const items = [
    { id: 'pair', host: 'claude-code', blindSpot: blindSpotOf(measured(60, 4, 28, 4, 'T1')) },
    { id: 'pair-arm', host: 'claude-code', blindSpot: blindSpotOf(measured(60, 4, 28, 4, 'T1')) },
    { id: 'site', host: 'codex', blindSpot: blindSpotOf(measured(80, 1, 18, 1, 'T2')) },
    { id: 'legacy', host: 'kiro', blindSpot: blindSpotOf(measured(46, 0, 23, 0, undefined)) },
    { id: 'baseline', host: 'codex', blindSpot: null },
  ];
  const totals = blindSpotTotals(items);
  assert.equal(totals.sessions, 3);
  assert.equal(totals.works, 186);
  assert.equal(totals.known, 5);
  assert.equal(totals.missed, Math.round(1000 * 181 / 186) / 1000);
  assert.equal(totals.guessed, 69);
  assert.equal(totals.confirmed, 5);
  assert.deepEqual(Object.keys(totals.byHost), ['claude-code', 'codex', 'kiro']);
  assert.equal(totals.byHost.codex.sessions, 1);
});

test('a built gallery folder is read from its index and each entry\'s record', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-blind-spot-'));
  try {
    await fs.writeFile(path.join(dir, 'gallery.json'), JSON.stringify({ entries: [{ id: 'one', host: 'kiro', title: 'One', kind: 'session' }, { id: 'two', host: 'codex', title: 'Two', kind: 'session' }] }));
    await fs.mkdir(path.join(dir, 'one', 'report'), { recursive: true });
    await fs.writeFile(path.join(dir, 'one', 'report', 'record.json'), JSON.stringify(measured(69, 1, 28, 1, 'T')));
    const items = await readGalleryBlindSpots(dir);
    assert.equal(items.length, 2);
    assert.equal(items[0].blindSpot.works, 69);
    assert.equal(items[1].blindSpot, null, 'an entry without a record counts nothing');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('the benchmark totals count both ways: measured works the guesses named, and guessed works Qloo measured', () => {
  const totals = benchmarkTotals({ measurable: 20, hosts: {
    'claude-code': { runs: 20, pooled: { known: { part: 95, whole: 1395 }, confirmed: { part: 92, whole: 571 } } },
    codex: { runs: 20, pooled: { known: { part: 65, whole: 1395 }, confirmed: { part: 64, whole: 456 } } },
    kiro: { runs: 20, pooled: { known: { part: 92, whole: 1395 }, confirmed: { part: 89, whole: 565 } } } } });
  assert.deepEqual(totals, { runs: 60, audiences: 20, agents: 3, works: 4185, known: 252, missed: 0.94, guessed: 1592, confirmed: 245, confirmedShare: 0.154 });
  assert.equal(benchmarkTotals({ hosts: {} }), null);
});
