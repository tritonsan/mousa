// The designer's half of the stages after the house-style finding of 24 October 2026: a reading names how each
// cluster's works look as a genre, the palette or type translates one of those conventions, and the review carries a
// critique that names the page's most generic choices and asks whether a fan of the audience's best-loved works would
// take the page for theirs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignDna } from '../plugin/server/culture/taste.mjs';
import { normalizeTasteReading, applyReadingToDna } from '../plugin/server/production/reading.mjs';
import { normalizeReview, citedCaptures } from '../plugin/server/production/review.mjs';

const work = (ref, name, domain, tags, extra = {}) => ({ ref, name, domain, source: 'qloo', tags, affinity: 0.8, surprise: true, predictedByModel: false, ...extra });
const INPUT = { source: 'qloo-profile', requiredAnchors: [], entities: [
  { ref: 'quality:look:bold-typography', name: 'Bold Typography', domain: 'qualities', family: 'look', source: 'qloo', score: 9, lift: 2.7, surprise: true, tags: ['Bold Typography'] },
  { ref: 'quality:mood:determined', name: 'Determined', domain: 'qualities', family: 'mood', source: 'qloo', score: 8, lift: 2.9, surprise: true, tags: ['Determined'] },
  work('B-LEAGUE', 'Fixture League', 'brand', ['Bold Typography'], { affinity: 0.92 }),
  work('M-DOC', 'Fixture Court Documentary', 'movie', ['Determined', 'Gritty'], { affinity: 0.9 }),
  work('A-RAP', 'Fixture Rapper', 'artist', ['Charismatic'], { affinity: 0.96 }),
  work('A-SINGER', 'Fixture Singer', 'artist', ['Smooth'], { affinity: 0.95, surprise: false, predictedByModel: true }),
  { ref: 'M01', name: 'Fixture Guess', domain: 'brand', source: 'model-assumption' },
] };
const READING = { schemaVersion: '1.0', clusters: [
  { id: 'c1', name: 'Sport as broadcast', refs: ['quality:look:bold-typography', 'B-LEAGUE'], layers: ['palette', 'layout'], reading: 'They watch the game as it is broadcast, numbers first.',
    conventions: ['Broadcast score bugs: boxed condensed capitals on a dark bar', 'Stat tables with tabular figures and one ruled line per row'] },
  { id: 'c2', name: 'Underdog stories', refs: ['quality:mood:determined', 'M-DOC', 'A-RAP'], layers: ['typography', 'voice', 'structure'], reading: 'Stories of grinding up from nothing, told to the camera.',
    conventions: ['Sports documentary title cards in heavy condensed capitals'] },
], setAside: [], approach: 'The page reads as a broadcast package: score bugs and stat tables for the facts, title cards for the story.' };
const DNA = { schemaVersion: '1.0', thesis: 'The product told as a broadcast package, from score bug to title card.', devices: [
  { id: 'dna1', layer: 'palette', device: 'Score bug black and broadcast yellow', anchors: ['quality:look:bold-typography', 'B-LEAGUE'], qualities: ['Bold Typography'], translation: 'Bold type on a dark bar becomes near-black with one broadcast yellow.', convention: 'c1.1', tokens: { colors: ['#0b0b0b', '#f2c200'] } },
  { id: 'dna2', layer: 'typography', device: 'Title-card condensed capitals', anchors: ['quality:mood:determined'], qualities: ['Determined'], translation: 'Determination becomes heavy condensed capitals, one word to a line.', tokens: { fonts: ['Oswald'] } },
  { id: 'dna3', layer: 'layout', device: 'Stat-table rows', anchors: ['B-LEAGUE'], qualities: ['Bold Typography'], translation: 'Each fact sits on a ruled stat row with its figure first.', tokens: { ids: ['stat-rows'] } },
  { id: 'dna4', layer: 'voice', device: 'Sideline call', anchors: ['A-RAP'], qualities: ['Charismatic'], translation: 'Short, confident lines, as called from the sideline.', tokens: { copy: ['Guess first. Then the tape.', 'The numbers do not lie.'] } },
  { id: 'dna5', layer: 'structure', device: 'Season ladder', anchors: ['quality:mood:determined', 'M-DOC'], qualities: ['Determined'], translation: 'The five steps climb like a season, game by game.', tokens: { ids: ['season-ladder'] } },
], rejected: [] };
const reading = () => normalizeTasteReading(READING, { input: INPUT });
const message = pattern => error => { assert.match(error.message, pattern); return true; };
const withCluster = (index, change) => ({ ...READING, clusters: READING.clusters.map((cluster, at) => at === index ? { ...cluster, ...change } : cluster) });
const withDevice = (id, change) => ({ ...DNA, devices: DNA.devices.map(device => device.id === id ? { ...device, ...change } : device) });

test('a reading names one to three visual conventions per cluster, how its works look as a genre, never a brand\'s marks', () => {
  const read = reading();
  assert.deepEqual(read.clusters.map(cluster => cluster.conventions.length), [2, 1]);
  assert.equal(read.stats.conventions, 3);
  const { conventions, ...without } = READING.clusters[0];
  void conventions;
  assert.throws(() => normalizeTasteReading({ ...READING, clusters: [without, READING.clusters[1]] }, { input: INPUT }), message(/clusters\[0\]\.conventions: An array with 1-3 items is required/u));
  assert.throws(() => normalizeTasteReading(withCluster(0, { conventions: ['a', 'b', 'c', 'd'] }), { input: INPUT }), message(/1-3 items/u));
  for (const marked of ['The league logo on every card, big and centered', 'Team colours: the club\'s red and gold kit']) {
    assert.throws(() => normalizeTasteReading(withCluster(0, { conventions: [marked] }), { input: INPUT }), message(/how the genre or medium looks/u), marked);
  }
  assert.throws(() => normalizeTasteReading(withCluster(1, { conventions: ['Title cards in heavy capitals', 'title cards in heavy capitals'] }), { input: INPUT }), message(/Name each convention once/u));
});

test('the palette or type translates a convention, named by key or words, of a cluster the device anchors', () => {
  const dna = normalizeDesignDna(applyReadingToDna(DNA, reading()), { input: INPUT });
  assert.deepEqual(dna.devices[0].convention, { cluster: 'c1', text: 'Broadcast score bugs: boxed condensed capitals on a dark bar' });
  assert.equal(dna.devices[1].convention, undefined);
  // By its words, in any case; and on the type device instead of the palette.
  const byWords = applyReadingToDna(withDevice('dna2', { convention: 'sports documentary title cards in heavy condensed capitals' }), reading());
  assert.deepEqual(byWords.devices[1].convention, { cluster: 'c2', text: 'Sports documentary title cards in heavy condensed capitals' });
  // A saved DNA keeps {cluster, text}, which is checked again.
  assert.deepEqual(applyReadingToDna(dna, reading()).devices[0].convention, dna.devices[0].convention);
  assert.throws(() => applyReadingToDna(withDevice('dna1', { convention: { cluster: 'c2', text: dna.devices[0].convention.text } }), reading()), message(/Name a convention of your reading/u));
  assert.throws(() => applyReadingToDna(withDevice('dna1', { convention: 'c3.1' }), reading()), message(/c1\.1 "Broadcast score bugs.*c2\.1 "Sports documentary/u));
  assert.throws(() => applyReadingToDna(withDevice('dna1', { convention: 'c2.1' }), reading()), message(/c2\.1 belongs to cluster c2; anchor this device to one of its refs too/u));
  const { convention, ...plain } = DNA.devices[0];
  void convention;
  assert.throws(() => applyReadingToDna({ ...DNA, devices: [plain, ...DNA.devices.slice(1)] }, reading()), message(/Let the palette or the typography device translate a convention of your reading/u));
  // A reading saved before conventions existed binds the DNA as it did.
  const older = { ...reading(), clusters: reading().clusters.map(({ conventions: dropped, ...cluster }) => { void dropped; return cluster; }) };
  assert.equal(applyReadingToDna({ ...DNA, devices: [plain, ...DNA.devices.slice(1)] }, older).devices.length, 5);
});

const PLAN = { review: [{ id: 'r1', device: 'dna1', look: 'The first screen reads as a broadcast: dark bar, yellow figures.' }] };
const CAPTURES = [{ id: 'r1-desktop', round: 1 }, { id: 'r1-mobile', round: 1 }];
const dnaRecord = () => normalizeDesignDna(applyReadingToDna(DNA, reading()), { input: INPUT });
const critique = (change = {}) => ({ generic: [
  { choice: 'Pill buttons with soft rounded ends, as any page has.', capture: 'r1-desktop', action: 'replaced' },
  { choice: 'A centred hero with one line of body text under it.', capture: 'r1-mobile', action: 'replaced' },
  { choice: 'Condensed capitals for every heading.', capture: 'r1-desktop', anchor: 'quality:mood:determined', action: 'kept' },
], fan: { works: ['Fixture Rapper', 'Fixture League', 'Fixture Court Documentary'], verdict: 'partly', why: 'The score bug reads as theirs; the soft buttons do not.' }, ...change });
const REVIEW = (value = critique()) => ({ schemaVersion: '1.0', round: 1, criteria: [{ id: 'r1', capture: 'r1-desktop', verdict: 'met', observed: 'A dark bar with yellow figures across the top.' }],
  summary: 'The broadcast reads; two generic choices go.', critique: value });
const review = (value, taste = {}) => normalizeReview(REVIEW(value), { plan: PLAN, captures: CAPTURES, opened: new Set(['r1-desktop', 'r1-mobile']), round: 1,
  taste: { input: INPUT, dna: dnaRecord(), signatures: [], ...taste } });

test('with the run\'s taste, a review carries a critique: three generic choices, each kept only for an anchor, and a fan\'s verdict', () => {
  const done = review();
  assert.deepEqual(done.critique.generic.map(item => item.action), ['replaced', 'replaced', 'kept']);
  assert.equal(done.critique.open, true, 'a replaced choice and a partly verdict call for another round');
  assert.deepEqual([done.stats.replaced, done.stats.fan], [2, 'partly']);
  assert.deepEqual(citedCaptures(REVIEW()), ['r1-desktop', 'r1-mobile'], 'the critique\'s captures are audited like the verdicts\'');
  const clean = critique({ generic: critique().generic.map(item => ({ ...item, anchor: 'quality:mood:determined', action: 'kept' })), fan: { ...critique().fan, verdict: 'yes' } });
  assert.equal(review(clean).critique.open, false);
  assert.throws(() => normalizeReview({ ...REVIEW(), critique: undefined }, { plan: PLAN, captures: CAPTURES, round: 1, taste: { input: INPUT, dna: dnaRecord(), signatures: [] } }), message(/Add a critique/u));
  const one = (index, change) => critique({ generic: critique().generic.map((item, at) => at === index ? { ...item, ...change } : item) });
  assert.throws(() => review(one(0, { action: 'kept' })), message(/Keep a generic choice only when an anchor of your DNA requires it/u));
  assert.throws(() => review(one(2, { anchor: 'A-SINGER' })), message(/Name a ref that a device of your DNA anchors/u));
  assert.throws(() => review(one(1, { capture: 'r0-desktop' })), message(/Cite a capture the host made in this round/u));
  assert.throws(() => review(critique({ generic: critique().generic.slice(0, 2) })), message(/generic: An array with 3-3 items/u));
  // Without the run's taste, as in a host that has none, the critique may be left out.
  assert.equal(normalizeReview({ ...REVIEW(), critique: undefined }, { plan: PLAN, captures: CAPTURES, round: 1 }).critique, undefined);
});

test('every default-look signature still on the page is named among the three, and the fan loves the audience\'s best-loved works', () => {
  const signatures = [{ id: 'pill-buttons', label: 'fully rounded pill buttons', evidence: '.btn border-radius: 999px' }];
  assert.throws(() => review(critique(), { signatures }), message(/The page still carries fully rounded pill buttons \(pill-buttons\): name each among your three generic choices/u));
  const named = critique({ generic: critique().generic.map((item, at) => at === 0 ? { ...item, signature: 'pill-buttons' } : item) });
  assert.equal(review(named, { signatures }).critique.generic[0].signature, 'pill-buttons');
  assert.throws(() => review(named), message(/The host finds no default-look signature on this page; leave signature out/u));
  assert.throws(() => review(critique({ fan: { ...critique().fan, works: ['Fixture Rapper', 'A Film Nobody Measured', 'Fixture League'] } })), message(/Name works of this run's taste input/u));
  assert.throws(() => review(critique({ fan: { ...critique().fan, works: ['Fixture Rapper', 'Fixture League'] } })), message(/fan\.works: An array with 3-5 items/u));
  // In a measured run at least two of the fan's works are among the audience's highest-affinity works.
  const wide = { ...INPUT, entities: [...INPUT.entities, ...Array.from({ length: 12 }, (_, index) => work(`X${index}`, `Fixture Hit ${index}`, 'artist', ['Loud'], { affinity: 0.99 - index / 1000 }))] };
  assert.throws(() => review(critique(), { input: wide }), message(/name at least 2 of its highest-affinity works, such as Fixture Hit 0/u));
  assert.equal(review(critique({ fan: { ...critique().fan, works: ['Fixture Hit 0', 'Fixture Hit 1', 'Fixture Rapper'] } }), { input: wide }).critique.fan.works.length, 3);
});

test('a critique may name its anchors as the brief lists them, and an unknown name is refused', async () => {
  const { resolveTasteRefs } = await import('../plugin/server/design/tools.mjs');
  const named = (anchor) => REVIEW(critique({ generic: critique().generic.map((item, at) => at === 2 ? { ...item, anchor } : item) }));
  assert.equal(resolveTasteRefs('review', named('Determined'), INPUT).critique.generic[2].anchor, 'quality:mood:determined');
  assert.equal(resolveTasteRefs('review', named('quality:mood:determined'), INPUT).critique.generic[2].anchor, 'quality:mood:determined', 'a ref stays as it is');
  assert.throws(() => resolveTasteRefs('review', named('A Name Nobody Measured'), INPUT), /review\.critique\.generic\[2\]\.anchor: A Name Nobody Measured is not a name in this session's taste input/u);
});
