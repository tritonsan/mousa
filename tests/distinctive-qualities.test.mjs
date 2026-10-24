// How the engine reads an audience after the house-style finding of 24 October 2026: shared qualities rank by how
// distinctive they are against the reference audiences' base rates, so a tag Qloo puts on most audiences' works no
// longer leads every one; required works come from what the audience loves most; and the brief shows each quality's
// lift and reads a look carried by brands as the design the audience sees every day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tasteQualities, selectQualityAnchors } from '../plugin/server/culture/taste.mjs';
import { QUALITY_BASE_RATES, QUALITY_BASE_RATES_CORPUS } from '../plugin/server/culture/quality-base-rates.mjs';
import { buildTasteBrief } from '../plugin/server/taste/brief.mjs';

const work = (ref, domain, affinity, facets) => ({ ref, name: `Fixture ${ref}`, domain, affinity, facets });
const filler = count => Array.from({ length: count }, (_, index) => work(`x${index}`, 'book', 0.5, { meaning: [`Only here ${index}`] }));

test('the base rates are a frozen table of tag shares over the reference audiences', () => {
  assert.ok(Object.isFrozen(QUALITY_BASE_RATES));
  assert.ok(QUALITY_BASE_RATES_CORPUS.audiences >= 20, 'built from at least the benchmark\'s twenty audiences');
  assert.ok(Object.values(QUALITY_BASE_RATES).every(rate => rate >= QUALITY_BASE_RATES_CORPUS.floor && rate < 1));
  assert.ok(Object.keys(QUALITY_BASE_RATES).every(key => key === key.toLowerCase().trim()), 'keyed by normalized tag name');
  // The tags that led nearly every audience are the most common ones.
  for (const name of ['intimate', 'atmospheric', 'minimalist']) assert.ok(QUALITY_BASE_RATES[name] > 0.05, name);
});

test('a tag most audiences share loses to one this audience owns, though more works carry it', () => {
  const rates = { intimate: 0.1, gritty: 0.01 };
  const works = [
    work('m1', 'movie', 0.9, { look: ['Intimate', 'Gritty'] }), work('m2', 'movie', 0.9, { look: ['Intimate'] }), work('t1', 'tv_show', 0.9, { look: ['Intimate', 'Gritty'] }),
    work('a1', 'artist', 0.9, { look: ['Intimate'] }), work('a2', 'artist', 0.9, { look: ['Intimate', 'Gritty'] }), ...filler(15),
  ];
  const [first, second] = tasteQualities(works, [], { rates, floor: 0.004 });
  assert.deepEqual([first.name, first.count, first.lift], ['Gritty', 3, 3.33], 'three of twenty works against a 1% base rate');
  assert.deepEqual([second.name, second.count, second.lift], ['Intimate', 5, 2], 'five of twenty against 10%');
  assert.ok(first.score > second.score);
  // Without base rates every tag reads as rare, and the more widely carried one leads again.
  assert.equal(tasteQualities(works, [], { rates: {}, floor: 0.004 })[0].name, 'Intimate');
  // A tag the ranked style or aesthetic tags already returned stays with them.
  assert.equal(tasteQualities(works, ['Gritty'], { rates }).some(quality => quality.name === 'Gritty'), false);
});

test('the required works are the most central of the works each domain\'s audience loves most', () => {
  const works = [
    ...['f1', 'f2', 'f3', 'f4', 'f5'].map((ref, index) => work(ref, 'movie', 0.95 - index / 100, { look: index === 2 ? ['Gritty', 'Raw'] : ['Gritty'] })),
    work('f6', 'movie', 0.5, { look: ['Gritty', 'Raw'], mood: ['Tense'] }), work('f7', 'movie', 0.4, { mood: ['Tense'] }),
  ];
  const qualities = tasteQualities(works, [], { rates: {}, floor: 0.004 });
  const picks = selectQualityAnchors(works, qualities, 6);
  const chosen = picks.filter(ref => ref.startsWith('f'));
  assert.equal(chosen[0], 'f3', 'the most central of the five best-loved films');
  assert.equal(picks.includes('f6'), false, 'a film carrying more qualities far down the ranking does not stand for the audience');
});

test('the brief shows each quality\'s lift and reads a look carried by brands as the design the audience sees every day', () => {
  const quality = { ref: 'quality:look:bold-typography', name: 'Bold Typography', domain: 'qualities', family: 'look', source: 'qloo', score: 9, lift: 2.73,
    examples: ['Fixture League', 'Fixture Sports Network'], domains: ['brand'], refs: ['b1', 'b2', 'm1'], surprise: true };
  const entities = [quality, { ref: 'b1', name: 'Fixture League', domain: 'brand', source: 'qloo' }, { ref: 'b2', name: 'Fixture Sports Network', domain: 'brand', source: 'qloo' },
    { ref: 'm1', name: 'Fixture Documentary', domain: 'movie', source: 'qloo' }];
  const brief = buildTasteBrief({ plan: {}, profile: { entities, seeds: [], results: [] }, input: { entities, requiredAnchors: [] } });
  assert.equal(brief.qualities.look[0].lift, 2.73);
  assert.match(brief.cautions[0], /^Bold Typography is carried mostly by brands \(Fixture League, Fixture Sports Network\): it is the design this audience sees every day\. Translate the genre/u);
  assert.match(brief.cautions[0], /never a brand's logo, mascot, exact colours or products/u);
  assert.match(brief.layers.palette, /visual convention your reading names/u);
  assert.match(brief.rules, /lift is how many times more often/u);
});
