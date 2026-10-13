// What a designing agent asks Qloo, and why. Each taste question names the Qloo call behind it, what comes back and
// which layers of a design it informs; each medium has a recipe of domains to measure. planTaste turns a brief's
// audience signal into the plan an agent can show before any request is sent.

import { DEEP_CUT_DOMAINS, TASTE_LIMITS, isTagDomain, isDerivedDomain, selectTasteReferences, normalizeTasteName } from '../culture/taste.mjs';
import { QLOO_AGE_BANDS, AUDIENCE_ID } from '../qloo/client.mjs';

export const TASTE_QUESTIONS = Object.freeze([
  { id: 'world', ask: 'What else does this audience love?', when: 'start',
    how: 'Insights in each domain of the recipe (brands, films, music, books, TV, games, places, podcasts), excluding the named works, plus a lesser-known band for brands and films.',
    returns: 'Works ranked by affinity, each with its typed tags.', informs: ['imagery subjects', 'references', 'content', 'structure'],
    caveat: 'Affinity ranks works for this signal; it does not score a design or predict one person.' },
  { id: 'shared', ask: 'What do the things they love have in common?', when: 'start',
    how: 'No request: the look, mood and meaning tags that two or more measured works carry, ranked by those works\' affinity and how many domains they span.',
    returns: 'Qualities by family (look, mood, meaning) with the works that carry them.', informs: ['palette', 'typography', 'imagery', 'motion', 'voice', 'structure'],
    caveat: 'A quality carried mostly by brands describes their products\' design more than the audience.' },
  { id: 'pacing', ask: 'How do the films and series they love move?', when: 'start', domain: 'style',
    how: 'Style tags ranked for the audience, from films and TV.', returns: 'Tags such as Quiet, Pensive or Visually Austere.', informs: ['motion', 'rhythm', 'layout density'] },
  { id: 'surfaces', ask: 'Which surfaces, materials and forms do they favor?', when: 'start', domain: 'aesthetic',
    how: 'Aesthetic tags ranked for the audience; art styles from the measured works\' own tags.', returns: 'Tags such as Sculptural, Textural or Pixel Art.', informs: ['illustration', 'texture', 'imagery treatment', 'render style'] },
  { id: 'tone', ask: 'What emotional tone runs through what they love?', when: 'start', domain: 'tone',
    how: 'Emotional-tone tags ranked for the audience.', returns: 'Tags such as Thoughtful, Introspective or Melancholic.', informs: ['voice', 'copy', 'motion'] },
  { id: 'difference', ask: 'What did I not expect?', when: 'start',
    how: 'No request: the measured profile against your frozen prediction.', returns: 'Surprises and the guesses Qloo confirmed.', informs: ['what moves the design off its default'] },
  { id: 'shortlist', ask: 'Which of these would they choose?', when: 'during design',
    how: 'Insights limited to a shortlist of up to five resolved candidates of one kind.', returns: 'The candidates ranked by affinity.', informs: ['music', 'partners', 'featured items', 'references'] },
  { id: 'local', ask: 'What do they love around here?', when: 'during design',
    how: 'Place insights for the audience, weighted by the location.', returns: 'Places ranked by affinity there.', informs: ['local imagery', 'venues', 'partners'] },
  { id: 'overlap', ask: 'Where do two audiences meet?', when: 'during design',
    how: 'The same domain measured for each audience, then the works both share.', returns: 'Shared works and what is distinct to each.', informs: ['shared ground', 'a deliberate split'] },
].map(question => Object.freeze(question)));

/**
 * Domains per medium. The artifact's own medium (games for a game, places for a café) takes the first required work
 * place. Recipes stay within the 24-request pass: about 3-6 searches for the references plus one request per domain.
 */
export const MEDIUM_RECIPES = Object.freeze({
  web: { label: 'Website or landing page', domains: ['brand', 'movie', 'artist', 'book', 'tv_show', 'style', 'aesthetic', 'tone', 'qualities'], medium: [] },
  'app-ui': { label: 'App interface', domains: ['brand', 'tv_show', 'movie', 'artist', 'podcast', 'style', 'aesthetic', 'tone', 'qualities'], medium: [] },
  brand: { label: 'Brand identity, packaging or campaign', domains: ['brand', 'artist', 'movie', 'tv_show', 'book', 'aesthetic', 'style', 'tone', 'qualities'], medium: ['brand'] },
  place: { label: 'A physical place: café, restaurant, shop or hotel', domains: ['place', 'brand', 'artist', 'movie', 'tv_show', 'aesthetic', 'tone', 'qualities'], medium: ['place'], needs: ['location'] },
  game: { label: 'Game, character or game art', domains: ['videogame', 'movie', 'tv_show', 'artist', 'book', 'style', 'aesthetic', 'tone', 'qualities', 'art_style'], medium: ['videogame'] },
  writing: { label: 'Copy, naming or narrative', domains: ['book', 'movie', 'tv_show', 'podcast', 'artist', 'style', 'tone', 'qualities'], medium: ['book'] },
  generic: { label: 'Any other design work', domains: ['brand', 'movie', 'artist', 'book', 'tv_show', 'style', 'aesthetic', 'tone', 'qualities'], medium: [] },
});
export const MEDIA = Object.freeze(Object.keys(MEDIUM_RECIPES));

const PREDICTION_SHAPE = '{schemaVersion:"1.0", audienceSummary:"one or two sentences", predictions:{<each domain>:[3-6 entries]}, designSketch:{summary, palette:[3-6 #rrggbb], fonts:[1-3 library families], sections:[3-8 element IDs], motifs:[1-5 phrases]}}';
const QUALITY_HINT = { style: 'pacing qualities of the films and TV it likes', aesthetic: 'visual and material qualities of what it likes', tone: 'emotional tones of what it likes',
  qualities: 'looks, moods or themes its favorite works share', art_style: 'art styles of what it likes, such as hand-drawn or pixel art' };

/**
 * The plan for one audience and medium, with no request: the questions asked now and later, the domains measured, an
 * estimate of the requests, what is missing from the brief, and the domains the frozen prediction must cover.
 * `references` keep their roles: audience works seed the pass (creator inspiration only when there is no audience
 * reference); brand and canon references are known names, never seeds. `segments` are audience descriptions or URNs.
 */
export function planTaste({ medium = 'web', references = [], segments = [], location, ages, decisions = [], deepCuts = true } = {}) {
  const recipe = MEDIUM_RECIPES[medium] ? medium : 'generic';
  const { domains: base, medium: own, needs = [], label } = MEDIUM_RECIPES[recipe];
  const domains = [...base];
  if (location && !domains.includes('place') && domains.length < TASTE_LIMITS.domains) domains.push('place');
  const named = (Array.isArray(references) ? references : []).map(ref => typeof ref === 'string' ? { name: ref, role: 'audience' } : { role: 'audience', ...ref });
  const { basis, references: seeds } = selectTasteReferences(named);
  const seedKeys = new Set(seeds.map(ref => normalizeTasteName(ref.name)));
  const knownNames = named.filter(ref => typeof ref?.name === 'string' && !seedKeys.has(normalizeTasteName(ref.name))).map(ref => ref.name.trim()).slice(0, 40);
  const segmentList = (Array.isArray(segments) ? segments : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 3);
  const ageList = (Array.isArray(ages) ? ages : ages ? [ages] : []).filter(age => QLOO_AGE_BANDS.includes(age)).slice(0, 3);
  const missing = [];
  if (!seeds.length && !segmentList.length) missing.push({ field: 'audience', ask: 'Who is this for? Name 3-5 things they love (films, music, games, brands, places), describe the audience (for example parents with young children), or give both.' });
  if (needs.includes('location') && !location) missing.push({ field: 'location', ask: 'Where is it? A city or neighborhood weights what Qloo measures toward it.' });

  const entityDomains = domains.filter(domain => !isTagDomain(domain) && !isDerivedDomain(domain));
  const tagDomains = domains.filter(isTagDomain);
  const deep = deepCuts ? DEEP_CUT_DOMAINS.filter(domain => domains.includes(domain)) : [];
  const lookups = seeds.length + segmentList.filter(item => !AUDIENCE_ID.test(item)).length;
  const fixed = entityDomains.length + tagDomains.length + deep.length;
  const estimate = [lookups + fixed, lookups + seeds.length + fixed];
  const notes = [];
  if (estimate[1] > TASTE_LIMITS.calls) notes.push(`With ${seeds.length} references the pass may reach its ${TASTE_LIMITS.calls}-request limit; later domains would then stay empty. Fewer references keep every domain.`);
  if (!seeds.length && segmentList.length) notes.push('Audience segments without named works give a broader signal; add a few works the audience loves when you can.');
  if (location && location.includes(',')) notes.push(`Qloo weights the measurement by one place name, and a full address such as "${location}" may match nothing; the city or the neighbourhood alone is safer, such as "${location.split(',').map(part => part.trim()).filter(Boolean).at(-1)}".`);
  if (named.length > seeds.length) notes.push(`${named.length - seeds.length} reference${named.length - seeds.length === 1 ? ' is' : 's are'} not an audience taste (brand, canon or extra creator inspiration), so ${named.length - seeds.length === 1 ? 'it is' : 'they are'} known names, not seeds.`);

  const asked = new Set(['world', 'shared', 'difference', ...TASTE_QUESTIONS.filter(question => question.domain && domains.includes(question.domain)).map(question => question.id)]);
  if (domains.includes('art_style')) asked.add('surfaces');
  const later = ['shortlist', ...(location ? ['local'] : []), 'overlap'];
  const focus = (Array.isArray(decisions) ? decisions : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().toLowerCase()).slice(0, 8);
  const question = item => ({ id: item.id, ask: item.ask, how: item.how, informs: item.informs, ...(focus.length ? { relevant: item.informs.some(layer => focus.some(word => layer.includes(word) || word.includes(layer))) } : {}), ...(item.caveat ? { caveat: item.caveat } : {}) });

  return {
    medium: recipe, recipe: label, domains, ownMedium: own,
    signal: { basis, references: seeds, knownNames, segments: segmentList, ...(location ? { location } : {}), ...(ageList.length ? { ages: ageList } : {}), deepCuts },
    questions: { now: TASTE_QUESTIONS.filter(item => asked.has(item.id)).map(question), later: TASTE_QUESTIONS.filter(item => later.includes(item.id)).map(question) },
    requests: { estimate, limit: TASTE_LIMITS.calls, ...(notes.length ? { notes } : {}) },
    missing,
    prediction: { domains, shape: PREDICTION_SHAPE,
      entries: domains.map(domain => `${domain}: ${isTagDomain(domain) || isDerivedDomain(domain) ? QUALITY_HINT[domain] : 'real names you expect this audience to love'}`) },
  };
}
