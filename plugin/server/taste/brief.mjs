// The Taste Brief: what a designing agent reads after the measurement, kept under 10 KiB so every host shows it inline
// (Claude Code moves a tool result over 50,000 characters into a file). It answers the taste questions in a few names
// each, marks what the agent did not predict, warns where a signal is weak and points each design layer at the refs
// that should set it. The full profile and taste input stay in .mousa/taste/ for the validators.

import { QUALITY_FAMILIES, QUALITY_DOMAIN, ART_STYLE_DOMAIN, isTagDomain, isQualityDomain } from '../culture/taste.mjs';

export const BRIEF_LIMIT_BYTES = 10 * 1024;
const DOMAIN_LABELS = { brand: 'brands', movie: 'films', artist: 'music', book: 'books', tv_show: 'TV', videogame: 'games', podcast: 'podcasts', place: 'places', destination: 'destinations' };
const byScore = (a, b) => (b.score ?? b.affinity ?? -1) - (a.score ?? a.affinity ?? -1);
const mark = entity => `${entity.name}${entity.surprise ? ' (new)' : entity.predictedByModel ? ' (predicted)' : ''}`;

/** Brands whose own design tags lift a look quality: their logos and products, not the audience's eye. */
function brandCarried(quality, entities) {
  if (quality.family !== 'look' || !Array.isArray(quality.refs) || quality.refs.length < 2) return null;
  const carriers = quality.refs.map(ref => entities.find(entity => entity.ref === ref)).filter(Boolean);
  const brands = carriers.filter(entity => entity.domain === 'brand');
  return brands.length / carriers.length >= 0.5 ? brands.slice(0, 3).map(entity => entity.name) : null;
}

export function buildTasteBrief({ plan, profile, input, segments = [], cache = null, files = {} }) {
  const entities = Array.isArray(input?.entities) ? input.entities.filter(entity => entity.source === 'qloo') : [];
  const profileEntities = Array.isArray(profile?.entities) ? profile.entities : [];
  const qualities = entities.filter(entity => entity.domain === QUALITY_DOMAIN);
  const family = name => qualities.filter(entity => entity.family === name).sort(byScore).slice(0, 4).map(entity => {
    const source = profileEntities.find(item => item.ref === entity.ref) || entity;
    return { name: entity.name, works: (source.examples || entity.examples || []).slice(0, 3), domains: (source.domains || entity.domains || []).map(domain => DOMAIN_LABELS[domain] || domain),
      ...(entity.surprise ? { new: true } : entity.predictedByModel ? { predicted: true } : {}) };
  });
  const tags = domain => entities.filter(entity => entity.domain === domain).sort(byScore).slice(0, 6).map(mark);
  const worlds = {};
  for (const result of profile?.results || []) {
    if (isTagDomain(result.domain) || isQualityDomain(result.domain) || !result.count) continue;
    const label = `${DOMAIN_LABELS[result.domain] || result.domain}${result.band === 'deep-cut' ? ' (lesser known)' : ''}`;
    worlds[label] = entities.filter(entity => entity.domain === result.domain && (entity.band || 'core') === result.band).sort(byScore).slice(0, result.band === 'deep-cut' ? 3 : 5).map(mark);
  }
  const anchors = (input?.requiredAnchors || []).map(ref => entities.find(entity => entity.ref === ref)).filter(Boolean)
    .map(entity => ({ ref: entity.ref, name: entity.name, is: entity.family ? `${entity.family} quality` : isTagDomain(entity.domain) ? `${entity.domain} tag` : DOMAIN_LABELS[entity.domain] || entity.domain }));

  const cautions = [];
  for (const quality of qualities) {
    const source = profileEntities.find(item => item.ref === quality.ref) || quality;
    const brands = brandCarried(source, profileEntities);
    if (brands) cautions.push(`${quality.name} is carried mostly by brands (${brands.join(', ')}): it may describe their products' design more than this audience's eye.`);
  }
  for (const seed of profile?.seeds || []) if (seed.resolution === 'unresolved') cautions.push(`"${seed.name}" was not found in Qloo: ${seed.limitation || 'it did not contribute.'}`);
  for (const segment of segments) if (!segment.audienceId) cautions.push(`The audience "${segment.query}" matched no Qloo audience segment, so it did not contribute.`);
  for (const limitation of profile?.limitations || []) if (!/was not resolved and did not contribute/u.test(limitation)) cautions.push(limitation);

  const names = list => list.length ? list.join(', ') : 'none measured';
  const look = family('look'), mood = family('mood'), meaning = family('meaning');
  const pacing = tags('style'), surfaces = tags('aesthetic'), tone = tags('tone'), artStyles = entities.filter(entity => entity.domain === ART_STYLE_DOMAIN).sort(byScore).slice(0, 4).map(mark);
  const strip = value => value.replace(/ \((?:new|predicted)\)$/u, '');
  const layers = {
    palette: `Anchor to a look quality: ${names(look.map(item => item.name))}. The works are evidence of it; never use a brand's or team's own colors, logo or packaging.`,
    typography: `Anchor to a look or mood quality: ${names([...look.slice(0, 2), ...mood.slice(0, 2)].map(item => item.name))}.`,
    motion: `Pacing: ${names(pacing.map(strip))}${tone.length ? `; tone: ${names(tone.slice(0, 3).map(strip))}` : ''}.`,
    imagery: `Surfaces: ${names([...surfaces.map(strip), ...artStyles.map(strip)])}. Describe pictures by these qualities, never by a work's name.`,
    voice: `Tone: ${names(tone.map(strip))}; mood: ${names(mood.map(item => item.name))}. Write your own lines; never quote lyrics, dialogue or slogans.`,
    structure: `Meaning: ${names(meaning.map(item => item.name))}.`,
  };

  const surprises = entities.filter(entity => entity.surprise).sort(byScore).slice(0, 15).map(entity => entity.name);
  const confirmed = entities.filter(entity => entity.predictedByModel).sort(byScore).slice(0, 10).map(entity => entity.name);
  const metrics = input?.metrics || {};
  const brief = {
    status: profile?.status || 'unknown',
    audience: {
      references: (profile?.seeds || []).map(seed => ({ name: seed.name, ...(seed.resolution === 'unresolved' ? { found: false } : { found: seed.matchedName || seed.name }) })),
      ...(segments.length ? { segments: segments.map(segment => ({ query: segment.query, ...(segment.audienceId ? { found: segment.name, id: segment.audienceId } : { found: false }) })) } : {}),
      ...(plan?.signal?.location ? { place: plan.signal.location } : {}), ...(plan?.signal?.ages?.length ? { ages: plan.signal.ages } : {}),
    },
    measured: { requests: profile?.calls ?? 0, ...(cache ? { answeredFromCache: cache.hits } : {}), worksMeasured: metrics.measuredEntities ?? 0,
      worksYouPredicted: metrics.predictedByModel ?? 0, surprises: metrics.surprises ?? 0 },
    qualities: { look, mood, meaning },
    tags: { pacing, surfaces, tone, ...(artStyles.length ? { artStyles } : {}) },
    worlds,
    surprises, confirmed,
    requiredAnchors: anchors,
    ...(cautions.length ? { cautions: [...new Set(cautions)].slice(0, 8) } : {}),
    layers,
    rules: 'Qloo measured entities, tags and their relationships; every color, font, layout, motion or line you derive from them is your interpretation. Use or reject each required anchor with a reason, and let the surprises move the design away from your frozen sketch.',
    files,
  };
  return fitBrief(brief);
}

/** Trim the longest lists until the brief fits; the trim is recorded, never silent. */
function fitBrief(brief) {
  const size = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size(brief) <= BRIEF_LIMIT_BYTES) return brief;
  const trimmed = structuredClone(brief);
  const steps = [
    () => { for (const key of Object.keys(trimmed.worlds)) trimmed.worlds[key] = trimmed.worlds[key].slice(0, 3); },
    () => { trimmed.surprises = trimmed.surprises.slice(0, 8); trimmed.confirmed = trimmed.confirmed.slice(0, 5); },
    () => { for (const key of Object.keys(trimmed.qualities)) trimmed.qualities[key] = trimmed.qualities[key].slice(0, 3).map(item => ({ ...item, works: item.works.slice(0, 2) })); },
    () => { trimmed.cautions = (trimmed.cautions || []).slice(0, 4); },
  ];
  for (const step of steps) {
    step();
    if (size(trimmed) <= BRIEF_LIMIT_BYTES) break;
  }
  trimmed.trimmed = 'Some lists were shortened to keep this brief small; the full profile is in the files listed.';
  return trimmed;
}

/** The family each look, mood and meaning tag type belongs to, for readers of the brief. */
export const QUALITY_FAMILY_TYPES = QUALITY_FAMILIES;
