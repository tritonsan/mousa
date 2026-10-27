// The jury's pages and the blind spot on the landing page and the cards, drawn from a gallery's records: the numbers
// come from the records' own counts, the pages have no script, and the Qloo page names the requests without any id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { landingPage, galleryPage, pairStage } from '../src/site/render.mjs';
import { judgesPage, qlooPage, benchmarkPage, showcasePage, SHOWCASE_ID, galleryBlindSpot, benchmarkSentence } from '../src/site/judge-pages.mjs';

const record = (works, known, guessed, confirmed, frozenAt) => ({ kind: 'session', prediction: { frozenAt, groups: [] }, measured: { counts: { works, worksPredicted: known, predictions: guessed, predictionsMeasured: confirmed } } });
function gallery() {
  const items = [
    { id: 'try-one', kind: 'comparison', host: 'kiro', medium: 'web', title: 'A record shop', origin: 'try', record: { ...record(69, 1, 28, 1, 'T1'), kind: 'comparison' }, distance: { overall: 0.6 } },
    { id: 'game-one', kind: 'session', host: 'claude-code', medium: 'game', title: 'Ilo', record: record(60, 3, 28, 3, 'T2') },
  ];
  return { index: { featured: 'try-one', entries: items.map(({ record: _, ...entry }) => entry) }, entries: new Map(items.map(item => [item.id, item])) };
}

test('the landing page carries the blind spot the records counted, and the gallery page each session\'s card', () => {
  const html = landingPage({ gallery: gallery(), repository: 'https://github.com/tritonsan/mousa' });
  assert.match(html, /96\.9%/u, '125 of 129 measured works were not in the guesses');
  assert.match(html, /125 of 129, in 2 recorded sessions/u);
  assert.match(html, /One recorded pair/u);
  assert.match(html, /href="\/judges\/"/u);
  assert.doesNotMatch(html, /<script/u);
  const cards = galleryPage({ gallery: gallery() });
  assert.match(cards, /The agent&#39;s guess named 1 of the 69 works Qloo measured\./u);
  assert.match(cards, /named 3 of the 60 works/u);
});

/** A gallery whose featured pair has clips, a story, a sealed guess, a measurement and devices, as a built one has. */
function storyGallery() {
  const pair = {
    id: 'rpg-pair', kind: 'comparison', host: 'claude-code', medium: 'game', title: 'Thistledown, an RPG from one sentence, with Qloo and without: Claude Code',
    brief: '/mousa:compare Build the game twice. The brief: Make a small RPG for people who love Stardew Valley. Use the Moûsa plugin.',
    story: { ask: 'a small RPG for people who love Stardew Valley', guess: 'farming and fishing', measured: 'herding and tape interviews' },
    clips: ['With Qloo', 'Without Qloo'].map(label => ({ label, file: `report/clips/${label === 'With Qloo' ? 'with' : 'without'}-qloo.webp`, poster: `report/clips/${label === 'With Qloo' ? 'with' : 'without'}-qloo.jpg`,
      width: 800, height: 500, seconds: 10.8, scenes: [label === 'With Qloo' ? 'herding puffs' : 'tilling a plot'] })),
    distance: { overall: 0.62 }, headline: { sentence: '1 of 1 devices rest on what the prediction did not contain.' },
    record: { kind: 'comparison', distance: { overall: 0.62 }, views: [],
      arms: [{ label: 'With Qloo', taste: 'qloo', headline: { sentence: '1 of 1 devices rest on what the prediction did not contain.' } }, { label: 'Without Qloo', taste: 'own prediction' }],
      prediction: { frozenAt: '2026-10-26T20:49:35.770Z', summary: 'A gentle farm life.', groups: [{ entries: [{ name: 'Animal Crossing: New Horizons', measured: true }, { name: 'Minecraft', measured: false }] }] },
      measured: { counts: { works: 60, worksPredicted: 1 }, worlds: [{ label: 'Games', works: [{ name: 'Slime Rancher', mark: 'new' }] }, { label: 'Films, lesser known', works: [{ name: 'Eldorado', mark: 'new' }] }, { label: 'Music', works: [{ name: 'Modern Baseball', mark: 'new' }] }] },
      layers: [{ layer: 'interaction', arms: [[{ device: 'Herd puffs into the pen', anchors: [{ name: 'Slime Rancher', mark: 'new' }] }], [{ device: 'Till, plant and water', anchors: [{ name: 'Harvest Moon', mark: 'own' }] }]] }] },
  };
  const app = { id: 'app-pair', kind: 'comparison', host: 'claude-code', medium: 'app-ui', title: 'A run club app, with Qloo and without: Claude Code',
    story: { ask: 'a run club app', guess: 'a notebook', measured: 'a wall of every Thursday' }, report: { cardSmall: 'report/card-small.png' }, record: { kind: 'comparison', arms: [], views: [] } };
  const items = [pair, app];
  return { index: { featured: 'rpg-pair', highlights: ['app-pair', 'gone-pair'], entries: items.map(({ record: _, ...entry }) => entry) }, entries: new Map(items.map(item => [item.id, item])) };
}

test('the landing page tells the featured pair: both clips with the guess first, its story, its session step by step and the pairs after it', () => {
  const html = landingPage({ gallery: storyGallery(), repository: 'https://github.com/tritonsan/mousa' });
  assert.ok(html.indexOf('The agent&#39;s guess') < html.indexOf('<b>With Qloo</b>'), 'the guess is shown first');
  assert.match(html, /<source media="\(prefers-reduced-motion: reduce\)" srcset="\/gallery\/rpg-pair\/report\/clips\/without-qloo\.jpg"><img src="\/gallery\/rpg-pair\/report\/clips\/without-qloo\.webp"/u, 'a visitor who asks for less motion gets the still');
  assert.match(html, /Asked for a small RPG for people who love Stardew Valley, Claude Code&#39;s own guess built farming and fishing\. Given Qloo&#39;s measurement of that audience, it built herding and tape interviews\./u);
  assert.match(html, /\/mousa:compare … Make a small RPG for people who love Stardew Valley\. …/u, 'the request, marked as cut from a longer brief');
  assert.match(html, /sealed the guess at 20:49 UTC on 26 October 2026|seals the guess at 20:49 UTC on 26 October 2026/u);
  assert.match(html, /Qloo measured 60 works this audience loves, across games and music\. The guess had named one of them\./u, 'the lesser-known rows stay in the record');
  assert.match(html, /Slime Rancher <small>new<\/small>/u);
  assert.doesNotMatch(html, /Eldorado/u);
  assert.match(html, /Herd puffs into the pen[\s\S]*Till, plant and water|Till, plant and water[\s\S]*Herd puffs into the pen/u);
  assert.match(html, /<span class="story-tag">With Qloo<\/span> a wall of every Thursday/u, 'a highlight tells what each arm made');
  assert.match(html, /href="\/gallery\/"/u);
  assert.doesNotMatch(html, /<script/u);
  // The first screen says what Moûsa is and where to try it before the clips; the vote card counts the votes, none included.
  assert.match(html, /Moûsa, a plugin for Claude Code, Codex and Kiro, makes them design for the one Qloo measures\./u);
  assert.ok(html.indexOf('href="/try/"') < html.indexOf('class="story-stage"'), 'the try link comes before the clips');
  assert.doesNotMatch(html, /and on one another/u);
  assert.match(landingPage({ gallery: storyGallery(), votes: 0 }), /No votes yet: the results page counts each one as it comes\./u);
  assert.match(landingPage({ gallery: storyGallery(), votes: 1 }), /1 vote so far, all on the results page\./u);
  assert.match(html, /presses the game's own keys, scene for scene; each clip runs 11 seconds\. <a class="site-link" href="\/gallery\/rpg-pair\/">Play both, and read the record<\/a>/u);
  const jury = judgesPage({ gallery: storyGallery() });
  assert.match(jury, /\/gallery\/rpg-pair\/report\/clips\/with-qloo\.webp/u, 'the jury page shows the same pair at play');
  assert.match(jury, /<a class="site-link" href="\/gallery\/rpg-pair\/">Thistledown, an RPG from one sentence<\/a>/u);
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

test('the jury page says every device rests on what the guess missed only when every pair\'s record says so', () => {
  const g = gallery();
  g.entries.get('try-one').headline = { sentence: '7 of 7 devices rest on what the prediction did not contain.' };
  const whole = judgesPage({ gallery: g });
  assert.match(whole, /The protocol requires the names the guess missed to change the Qloo design&#39;s palette, type and structure; in every pair, each device of the Qloo design rests on such a name/u);
  g.entries.set('try-two', { id: 'try-two', kind: 'comparison', host: 'kiro', record: { ...record(69, 1, 28, 1, 'T3'), kind: 'comparison' }, distance: { overall: 0.68 },
    headline: { sentence: '7 of 8 devices rest on what the prediction did not contain.' } });
  const html = judgesPage({ gallery: g });
  assert.match(html, /2 recorded pairs[\s\S]*in 1 of them every device rests on such a name/u);
  assert.doesNotMatch(html, /in every pair, each device/u);
  // The variance study says the move is the protocol's, and the vote says how many have voted, none included.
  assert.match(html, /The move is required by the protocol, so this shows that the measurement changes the design, not that the change is better/u);
  assert.doesNotMatch(html, /so far\)/u);
  assert.match(judgesPage({ gallery: g, votes: 0 }), /are few \(none so far\)/u);
  assert.match(judgesPage({ gallery: g, votes: 3 }), /are few \(3 votes so far\)/u);
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

test('the showcase shows the Qloo design large and the guess-only design beneath, or says it is being recorded', () => {
  assert.match(showcasePage({ gallery: gallery() }), /being recorded/u);
  const g = gallery();
  g.entries.set(SHOWCASE_ID, { id: SHOWCASE_ID, kind: 'comparison', host: 'claude-code', title: 'Moûsa, for the jury', record: record(70, 2, 30, 2, 'T3'),
    play: [{ label: 'With Qloo', path: 'out/with-qloo/index.html' }, { label: 'Without Qloo', path: 'out/without-qloo/index.html' }] });
  const html = showcasePage({ gallery: g, previewBase: 'https://preview.example' });
  assert.ok(html.indexOf('https://preview.example/gallery/showcase-claude-code/out/with-qloo/index.html') < html.indexOf('out/without-qloo/index.html'), 'the Qloo arm comes first');
  for (const text of ['Moûsa, explained by Moûsa', '2 of 70', 'The same facts, from the guess alone', `/gallery/${SHOWCASE_ID}/`]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<script/u);
  // The arms are placed by the label taken from their taste records, not by their folders' names or their order.
  g.entries.get(SHOWCASE_ID).play = [{ label: 'Without Qloo', path: 'out/qloo-notes/index.html' }, { label: 'With Qloo', path: 'out/second/index.html' }];
  const swapped = showcasePage({ gallery: g });
  assert.ok(swapped.indexOf('out/second/index.html') < swapped.indexOf('out/qloo-notes/index.html'), 'the arm labelled With Qloo comes first');
  assert.match(swapped, /<b>With Qloo<\/b>[\s\S]*<b>Without Qloo<\/b>/u);
  // With the first build kept in the gallery, the page sets its signature count beside this build's.
  g.entries.get(SHOWCASE_ID).play = [{ label: 'With Qloo', path: 'out/with-qloo/index.html' }, { label: 'Without Qloo', path: 'out/without-qloo/index.html' }];
  g.entries.get(SHOWCASE_ID).houseStyle = [{ label: 'With Qloo', count: 0, of: 12 }, { label: 'Without Qloo', count: 1, of: 12 }];
  g.entries.set('showcase-claude-code-first', { id: 'showcase-claude-code-first', kind: 'comparison', houseStyle: [{ label: 'With Qloo', count: 7, of: 12 }, { label: 'Without Qloo', count: 3, of: 12 }] });
  const withFirst = showcasePage({ gallery: g });
  assert.match(withFirst, /The first build[\s\S]*<b>7 of the 12<\/b>[\s\S]*This build's Qloo arm carries <b>0<\/b>/u);
  assert.ok(withFirst.includes('/gallery/showcase-claude-code-first/'));
  // A pair with no measured arm presents nothing as the Qloo design.
  g.entries.get(SHOWCASE_ID).play = [{ label: 'Without Qloo', path: 'out/a/index.html' }, { label: 'Without Qloo', path: 'out/b/index.html' }];
  assert.doesNotMatch(showcasePage({ gallery: g }), /Open the Qloo design|<b>With Qloo<\/b>/u);
});

test('a pair\'s own page plays its clips, a game\'s with its keys and a phone app\'s at a phone\'s height, with no link to itself', () => {
  const pair = storyGallery().entries.get('rpg-pair');
  const game = pairStage(pair);
  assert.match(game, /^<section class="story-stage" aria-label="Both designs at play"><div class="story-arms">/u);
  assert.match(game, /presses the game's own keys, scene for scene; each clip runs 11 seconds\.<\/p>/u);
  assert.doesNotMatch(game, /Play both, and read the record/u);
  const app = { ...pair, id: 'app-pair', medium: 'app-ui', clips: pair.clips.map(clip => ({ ...clip, width: 390, height: 844, seconds: 12.3 })) };
  const page = pairStage(app);
  assert.match(page, /<div class="story-arms portrait">/u);
  assert.match(page, /Both designs as they run in a browser: a script opens each screen and taps the app's own buttons, scene for scene; each clip runs 12 seconds\./u);
  assert.equal(pairStage({ ...app, clips: undefined }), '');
});
