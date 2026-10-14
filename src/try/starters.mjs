// What a juror can design in the live try: three starters, each with its medium, the files the design may not change
// and the request it sends, into which the audience the juror names is set. The requests are the recorded sessions'
// own, so a live try and the gallery's records ask the same thing.

import { listText } from '../../plugin/server/design/report.mjs';
import { QLOO_AGE_BANDS } from '../../plugin/server/qloo/client.mjs';

export const TRY_INPUT_LIMITS = Object.freeze({ references: 8, reference: 120, place: 120, ages: 3 });
export const AGE_BANDS = QLOO_AGE_BANDS;

const ending = 'Use the Moûsa plugin, so the design rests on what this audience actually loves.';

export const STARTERS = Object.freeze({
  'blank-site': Object.freeze({
    id: 'blank-site', title: 'A record shop\'s website', medium: 'web', source: null,
    summary: 'Wax & Wane, a small record shop in Moda, Istanbul: a one-page website from an empty folder.',
    // Nothing exists yet, so every file is the design's.
    protect: [],
    brief: audience => `Design a one-page website for Wax & Wane, a small record shop in Moda, Istanbul. It is for people who love ${audience}. ${ending}

Facts to keep exactly:
- Name: Wax & Wane
- Address: Moda Caddesi 42, Kadıköy, Istanbul
- Open Tuesday to Sunday, 12:00 to 21:00; closed on Mondays
- New and used vinyl, a listening corner with two turntables, and a listening session every Thursday at 19:30
- A newsletter sign-up form that asks for an email address only

Build it as static HTML and CSS in this folder, with a small script only if the design needs one. Write all copy in English.`,
  }),
  ramble: Object.freeze({
    id: 'ramble', title: 'Ramble, a walking app', medium: 'app-ui', source: 'examples/mobile-app',
    summary: 'An existing app for self-guided walks, restyled through its own design tokens.',
    // The walks are the product's facts, and the server script is not the design.
    protect: ['data/**', 'serve.mjs', 'README.md'],
    brief: audience => `Redesign Ramble, the walking app in this folder, for visitors who love ${audience}. ${ending}`,
  }),
  'long-dusk': Object.freeze({
    id: 'long-dusk', title: 'Ilo, a game character', medium: 'game', source: 'examples/long-dusk',
    summary: 'The playable lamplighter of The Long Dusk, designed for one moment on the Vesper Cliffs.',
    // Only Ilo's character file and the pictures made for it are the design's; the world, the keeper and the engine stay.
    writable: ['characters/ilo.json', 'generated/**'],
    brief: audience => `Design Ilo, the playable lamplighter of The Long Dusk, the game in this folder, for one moment on the Vesper Cliffs: walking the cliff road, answering the keeper and waking the cold beacon. My audience loves ${audience}. Make Ilo a character this audience would want to play: their look, the way they move and the way they speak. Keep the world, its lore, the keeper and Ilo's fixed facts. Write the character's description and lines in English. ${ending}`,
  }),
});

export class TryInputError extends Error { constructor(message) { super(message); this.name = 'TryInputError'; this.status = 400; } }

/** A juror's request, checked: a starter, one to eight references, and an optional place and age bands. */
export function checkTryInput({ starter, references, place, ages } = {}, starters = STARTERS) {
  const chosen = Object.hasOwn(starters, starter || '') ? starters[starter] : null;
  if (!chosen) throw new TryInputError(`Choose a starter: ${Object.keys(starters).join(', ')}.`);
  const names = [...new Set((Array.isArray(references) ? references : String(references || '').split(/\r?\n|,/u)).map(item => String(item).replace(/\s+/gu, ' ').trim()).filter(Boolean))];
  if (!names.length || names.length > TRY_INPUT_LIMITS.references) throw new TryInputError(`Name one to ${TRY_INPUT_LIMITS.references} things the audience loves: films, music, books, games, brands or places.`);
  const long = names.find(name => name.length > TRY_INPUT_LIMITS.reference || /[<>{}\\]/u.test(name));
  if (long) throw new TryInputError(`"${long.slice(0, 40)}" is not a name Moûsa can send: use plain names of at most ${TRY_INPUT_LIMITS.reference} characters.`);
  const where = String(place || '').replace(/\s+/gu, ' ').trim();
  if (where.length > TRY_INPUT_LIMITS.place || /[<>{}\\]/u.test(where)) throw new TryInputError('Give the place as a plain city or neighbourhood name.');
  const bands = [...new Set((Array.isArray(ages) ? ages : ages ? [ages] : []).map(String))];
  if (bands.length > TRY_INPUT_LIMITS.ages || bands.some(band => !AGE_BANDS.includes(band))) throw new TryInputError(`Choose up to ${TRY_INPUT_LIMITS.ages} age bands from the list.`);
  return { starter: chosen.id, references: names, ...(where.length >= 2 ? { place: where } : {}), ...(bands.length ? { ages: bands } : {}) };
}

/** The request a try sends, with the juror's audience set into its starter's own words. */
export function tryBrief(input, starters = STARTERS) {
  const starter = starters[input.starter];
  const audience = `${listText(input.references)}${input.place ? `, in ${input.place}` : ''}`;
  return starter.brief(audience);
}

/** The plan's arguments, as taste_profile takes them for this request. */
export function tryPlan(input, starters = STARTERS) {
  const starter = starters[input.starter];
  return { dryRun: true, medium: starter.medium, references: input.references.map(name => ({ name, role: 'audience', origin: 'user-provided' })),
    ...(input.place ? { location: input.place } : {}), ...(input.ages ? { ages: input.ages } : {}) };
}
