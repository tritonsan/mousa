// The jury's pages and the blind spot on the landing page and the cards, drawn from a gallery's records: the numbers
// come from the records' own counts, the pages have no script, and the Qloo page names the requests without any id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { landingPage, galleryPage } from '../src/site/render.mjs';
import { judgesPage, qlooPage, benchmarkPage, galleryBlindSpot, benchmarkSentence } from '../src/site/judge-pages.mjs';

const record = (works, known, guessed, confirmed, frozenAt) => ({ kind: 'session', prediction: { frozenAt, groups: [] }, measured: { counts: { works, worksPredicted: known, predictions: guessed, predictionsMeasured: confirmed } } });
function gallery() {
  const items = [
    { id: 'try-one', kind: 'comparison', host: 'kiro', medium: 'web', title: 'A record shop', origin: 'try', record: { ...record(69, 1, 28, 1, 'T1'), kind: 'comparison' }, distance: { overall: 0.6 } },
    { id: 'game-one', kind: 'session', host: 'claude-code', medium: 'game', title: 'Ilo', record: record(60, 3, 28, 3, 'T2') },
  ];
  return { index: { featured: 'try-one', entries: items.map(({ record: _, ...entry }) => entry) }, entries: new Map(items.map(item => [item.id, item])) };
}

test('the landing page and the cards carry the blind spot the records counted', () => {
  const html = landingPage({ gallery: gallery(), repository: 'https://github.com/tritonsan/mousa' });
  assert.match(html, /96\.9%/u, '125 of 129 measured works were not in the guesses');
  assert.match(html, /125 of 129, in 2 recorded sessions/u);
  assert.match(html, /The agent&#39;s guess named 1 of the 69 works Qloo measured\./u);
  assert.match(html, /href="\/judges\/"/u);
  assert.doesNotMatch(html, /<script/u);
  assert.match(galleryPage({ gallery: gallery() }), /named 3 of the 60 works/u);
});

test('the jury page gives the numbers, the path and what each kind of evidence does not show', () => {
  const spot = galleryBlindSpot(gallery());
  assert.equal(spot.works, 129);
  const html = judgesPage({ gallery: gallery(), repository: 'https://github.com/tritonsan/mousa' });
  for (const text of ['Moûsa in one minute', '96.9%', 'of the works the agents guessed turned up', 'A path through the evidence', 'What it does not show', 'p = 0.005', '/gallery/try-one/', '/benchmark/', '/try/']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<script/u);
  const benchmark = { measurable: 20, hosts: { 'claude-code': { knownShare: { mean: 0.031 } }, codex: { knownShare: { mean: 0.04 } } } };
  assert.equal(benchmarkSentence(benchmark), 'Over 20 audiences, the share of measured works each agent\'s sealed guess already named: Claude Code 3.1%, Codex 4.0%.');
  assert.ok(judgesPage({ gallery: gallery(), benchmark }).includes('Claude Code 3.1%'));
});

test('the Qloo page names each request and what the live API taught, with no id', () => {
  const html = qlooPage({ repository: 'https://github.com/tritonsan/mousa' });
  for (const text of ['/search', '/v2/tags', '/v2/audiences', '/v2/insights, entities', 'filter.results.entities', 'X-Api-Key', 'at most 24 requests', 'video_game', 'docs/qloo-integration.md']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/u);
  assert.doesNotMatch(html, /<script/u);
});

test('the benchmark page shows each agent\'s measures and every audience, and waits for results without them', () => {
  const empty = benchmarkPage({ repository: 'https://github.com/tritonsan/mousa' });
  assert.match(empty, /not published yet/u);
  const run = (host, audience, known, works) => ({ host, audience, seeds: ['Paterson', 'Nujabes'], status: 'measured', known, works, knownShare: known / works, guessed: 28, confirmed: known,
    names: { measured: { movie: [{ name: 'Anomalisa', mark: 'new' }, { name: 'Paterson', mark: 'predicted' }] }, predicted: { movie: ['Lost in Translation'] } } });
  const benchmark = { audiences: 1, measurable: 1, notMeasurable: [], bootstrap: { resamples: 10000, seed: 20261023 }, pairs: [],
    hosts: { 'claude-code': { runs: 1, failed: 0, models: ['claude-opus-5-5[1m]'], knownShare: { mean: 0.029, interval: [0.01, 0.05] }, confirmedShare: { mean: 0.07, interval: null },
      pooled: { known: { part: 2, whole: 69, share: 0.029 }, confirmed: { part: 2, whole: 28, share: 0.071 } }, byDomain: { movie: { works: 20, known: 1, knownShare: 0.05 } }, hypotheses: { H1: 'supported', H2: 'not established' } } },
    runs: [run('claude-code', 'paterson-nujabes', 2, 69)] };
  const html = benchmarkPage({ benchmark, repository: 'https://github.com/tritonsan/mousa' });
  for (const text of ['How well do AI agents know an audience?', '2.9%', '1.0% to 5.0%', 'supported', 'Paterson and Nujabes', 'named 2 of the 69 works', 'Anomalisa', 'Lost in Translation', 'docs/benchmark/README.md', 'What it does not show']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<script/u);
});
