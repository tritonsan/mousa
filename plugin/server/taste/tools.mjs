// The taste tools of the mousa surface: plan the Qloo questions, freeze the agent's own prediction, measure, and ask
// further questions while designing. Records live in the project's .mousa/taste folder (plan, prediction, profile,
// evidence, taste input, brief, decisions) and Qloo answers in .mousa/cache/qloo, so nothing large is passed back and
// forth and a second design for the same audience costs no request.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { QlooClient, QLOO_AGE_BANDS, QLOO_AUDIENCE_CATEGORIES, AUDIENCE_ID } from '../qloo/client.mjs';
import { buildTasteProfile, normalizeTasteAssumption, tasteInputFromProfile, tasteInputFromAssumption, compactTasteInput, tasteNameMatch, normalizeTasteName, TasteProtocolError } from '../culture/taste.mjs';
import { resolveQlooConnection } from '../connections/config.mjs';
import { readState, writeState, STATE_DIR, WORKSPACE_FIELD } from '../production/project-files.mjs';
import { fontsForDna } from '../production/fonts.mjs';
import { planTaste, MEDIA, TASTE_QUESTIONS } from './questions.mjs';
import { createCachingClient } from './cache.mjs';
import { buildTasteBrief, buildBaselineBrief } from './brief.mjs';

const ENTITY_KINDS = Object.freeze(['artist', 'book', 'brand', 'destination', 'movie', 'person', 'place', 'podcast', 'tv_show', 'videogame']);
const QUESTION_IDS = Object.freeze(TASTE_QUESTIONS.map(question => question.id));
const REFERENCE = { type: 'object', properties: {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  role: { type: 'string', enum: ['audience', 'creator-inspiration', 'brand', 'world-canon'], description: 'audience (default): what the audience loves. brand and world-canon are fixed context, never seeds.' },
  origin: { type: 'string', enum: ['user-provided', 'existing-context', 'agent-selected'] },
}, required: ['name'], additionalProperties: false };
const NAMES = (min, max, description) => ({ type: 'array', minItems: min, maxItems: max, items: { type: 'string', minLength: 1, maxLength: 200 }, description });

export const TASTE_TOOLS = Object.freeze([
  {
    name: 'taste_profile',
    description: 'Measure what an audience loves with Qloo. First call it with dryRun:true and the brief\'s audience: it returns, with no request, the taste questions for this medium, the domains to measure, a request estimate, anything missing to ask the person, and the domains your prediction must cover. Then save your prediction with design_validate (stage prediction). Then call it again without dryRun: it measures (at most 24 requests, cached for a week), saves the full profile in .mousa/taste/ and returns the Taste Brief: shared qualities, pacing, surface and tone tags, works per domain, what you did not predict, required anchors, cautions and where each design layer should look. With baseline:true instead, it designs without Qloo: your prediction becomes the taste input, with no request.',
    inputSchema: { type: 'object', properties: {
      dryRun: { type: 'boolean', description: 'Plan only: no request, nothing measured.' },
      medium: { type: 'string', enum: MEDIA, description: 'What is being designed: web, app-ui, brand, place (a café, shop or hotel), game, writing or generic.' },
      references: { type: 'array', minItems: 1, maxItems: 8, items: REFERENCE, description: 'Things the audience loves: films, music, books, TV, games, brands, places.' },
      segments: NAMES(1, 3, 'Audience descriptions such as "parents with young children", or audience URNs from qloo_query kind audiences.'),
      location: { type: 'string', minLength: 2, maxLength: 120, description: 'A city or neighborhood that weights the measurement.' },
      ages: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: QLOO_AGE_BANDS } },
      decisions: NAMES(1, 8, 'The layers or choices this design must settle, such as palette, motion, voice or music.'),
      deepCuts: { type: 'boolean', description: 'Also measure lesser-known brands and films (default true).' },
      refresh: { type: 'boolean', description: 'Ignore cached Qloo answers.' },
      baseline: { type: 'boolean', description: 'Design without Qloo: after your prediction, take it as the taste input, with no request. For the baseline arm of a comparison, or when the person declines Qloo.' },
      workspace: WORKSPACE_FIELD,
    }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'taste_ask',
    description: 'Ask one taste question while designing, after the measurement. Write myGuess first: your own answer without data, so the difference is visible. From the saved profile, with no request: world, shared, pacing, surfaces, tone, difference. With a few cached requests: shortlist (rank 2-5 named candidates of one kind, such as artists for a playlist), local (places this audience loves in a location) and overlap (works this audience shares with another named audience). Each answer is recorded in .mousa/taste/decisions.json.',
    inputSchema: { type: 'object', properties: {
      question: { type: 'string', enum: QUESTION_IDS },
      decision: { type: 'string', minLength: 3, maxLength: 300, description: 'The design decision this answers.' },
      myGuess: { type: 'string', minLength: 1, maxLength: 600 },
      candidates: NAMES(2, 5, 'For shortlist: names of the options.'),
      kind: { type: 'string', enum: ENTITY_KINDS, description: 'For shortlist: what the candidates are; for overlap: the domain compared.' },
      place: { type: 'string', minLength: 2, maxLength: 120, description: 'For local: defaults to the brief\'s location.' },
      otherReferences: NAMES(1, 5, 'For overlap: what the other audience loves.'),
      workspace: WORKSPACE_FIELD,
    }, required: ['question', 'decision'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'qloo_query',
    description: 'Ask Qloo directly when no taste question fits: search (entities by name), tags (genre or interest tags), audiences (segments by a partial name or category) or insights (entities or tags for given signals). Answers are cached in the project. Returns compact rows; affinity ranks results for the signal, it does not score designs.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['search', 'tags', 'audiences', 'insights'] },
      query: { type: 'string', minLength: 1, maxLength: 200 },
      types: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: ENTITY_KINDS } },
      categories: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: QLOO_AUDIENCE_CATEGORIES } },
      resultType: { type: 'string', enum: [...ENTITY_KINDS, 'tag'] },
      seedEntityIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 160 } },
      seedTagIds: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 9, maxLength: 168 } },
      audiences: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 14, maxLength: 200 } },
      location: { type: 'string', minLength: 2, maxLength: 120 },
      ages: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: QLOO_AGE_BANDS } },
      tagTypes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 9, maxLength: 148 } },
      parentTypes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: ENTITY_KINDS } },
      candidateEntityIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 160 } },
      popularityMax: { type: 'number', minimum: 0, maximum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      workspace: WORKSPACE_FIELD,
    }, required: ['kind'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
]);

export class TasteToolError extends Error {
  constructor(code, message) { super(message); this.name = 'TasteToolError'; this.code = code; }
}
const refuse = (code, message) => { throw new TasteToolError(code, message); };

/** A row as the agent needs it: ID, name, kind, affinity and a few tags. */
function row(entity) {
  return { id: entity.audienceId || entity.entityId, name: entity.name, ...(entity.type ? { type: entity.type.replace(/^urn:entity:/u, '') } : {}),
    ...(entity.affinity !== undefined ? { affinity: Number(entity.affinity.toFixed(3)) } : {}), ...(entity.popularity !== undefined ? { popularity: Number(entity.popularity.toFixed(3)) } : {}),
    ...(entity.parents?.length ? { parents: entity.parents } : {}), ...(entity.tags?.length ? { tags: entity.tags.slice(0, 5).map(tag => tag.name) } : {}),
    ...(entity.location ? { location: entity.location } : {}) };
}

/** The best catalogue match for a name, as the taste pass resolves references: strict word overlap, then Qloo's order. */
function bestNamed(results, name, threshold = 0.75) {
  let best = null;
  for (const item of results || []) {
    const score = tasteNameMatch(name, item.name);
    if (score >= threshold && (!best || score > best.score)) best = { ...item, score };
  }
  return best;
}

/**
 * The tools. `context` gives: env, connections (the store), project(meta) for the project folder, fonts() for the font
 * library, fetchImpl, now.
 */
export function createTasteTools(context) {
  const { env = process.env, connections, project, fonts = async () => null, fetchImpl, now = Date.now } = context;
  // design_validate is listed by the design tools; its prediction stage is answered here, where the taste plan lives.
  const names = [...TASTE_TOOLS.map(tool => tool.name), 'design_validate'];

  async function qlooClient(root, { refresh = false } = {}) {
    const connection = await resolveQlooConnection({ env, store: connections });
    if (!connection.apiKey) refuse('QLOO_KEY_MISSING', 'Qloo is not connected. Call mousa_status for the one-line fix, or mousa_connect for the local key page.');
    const client = new QlooClient({ apiKey: connection.apiKey, baseUrl: connection.baseUrl, ...(fetchImpl ? { fetchImpl } : {}) });
    return root ? createCachingClient({ client, dir: path.join(root, STATE_DIR, 'cache', 'qloo'), baseUrl: connection.baseUrl, refresh, now }) : Object.assign(client, { stats: { hits: 0, misses: 0 } });
  }
  const session = (root, stage) => writeState(root, 'session', { plugin: 'mousa', stage, updatedAt: new Date(now()).toISOString() });

  async function plan(args, meta) {
    const root = await project(meta, args.workspace);
    const planned = planTaste({ medium: args.medium, references: args.references, segments: args.segments, location: args.location, ages: args.ages, decisions: args.decisions, deepCuts: args.deepCuts ?? true });
    const prediction = await readState(root, 'taste/prediction');
    // A plan for other domains is saved, and the frozen prediction it no longer fits waits for a new session.
    const differs = Boolean(prediction) && !samePlan(prediction, planned);
    await writeState(root, 'taste/plan', { ...planned, plannedAt: new Date(now()).toISOString() });
    if (!prediction) await session(root, 'planned');
    const next = planned.missing.length ? `Ask the person: ${planned.missing.map(item => item.ask).join(' ')} Then plan again.`
      : differs ? restartFor(prediction, planned)
        : prediction ? 'Your prediction stays frozen. Call taste_profile without dryRun to measure.'
          : 'Before any Qloo data, write your own prediction for each listed domain and the design you would make from it alone, then save it with design_validate({stage:"prediction", artifact}).';
    return { status: planned.missing.length ? 'needs-input' : differs ? 'needs-restart' : 'planned', plan: planned, next };
  }
  const samePlan = (prediction, planned) => prediction.domains.join() === planned.domains.join();
  const restartFor = (prediction, planned) => `Your frozen prediction covers ${prediction.domains.join(', ')}, and this plan measures ${planned.domains.join(', ')}. Start a new design session for this plan: write a prediction for its domains and save it with design_validate({stage:"prediction", artifact, restart:true}).`;

  async function validatePrediction(args, meta) {
    const root = await project(meta, args.workspace);
    const planned = await readState(root, 'taste/plan');
    if (!planned) refuse('PLAN_MISSING', 'Plan first: call taste_profile with dryRun:true and the brief\'s audience.');
    const existing = await readState(root, 'taste/prediction');
    if (existing && !args.restart) refuse('PREDICTION_FROZEN', `Your prediction was frozen at ${existing.frozenAt}. It is the default the measurement is compared with, so it is not rewritten. To start a new design session, call again with restart:true.`);
    const library = await fonts();
    const prediction = normalizeTasteAssumption(args.artifact, { domains: planned.domains, requireSketch: true, ...(library ? { fonts: fontsForDna(library) } : {}) });
    let archived = null;
    if (existing) archived = await archiveSession(root);
    const frozenAt = new Date(now()).toISOString();
    await writeState(root, 'taste/prediction', { ...prediction, frozenAt });
    await session(root, 'predicted');
    return { status: 'frozen', stage: 'prediction', domains: prediction.domains, entries: prediction.entries.length, designSketch: prediction.designSketch, frozenAt,
      ...(archived ? { archived } : {}), next: 'Call taste_profile without dryRun to measure the audience with Qloo.' };
  }

  /**
   * Moves this session's records to .mousa/history/<time>/, so a new session starts clean: its taste records, its design
   * stages, its captures and its picture records. The plan stays, because it is the new session's, and so does the cache.
   */
  async function archiveSession(root) {
    const stamp = new Date(now()).toISOString().replace(/[:.]/gu, '-');
    const state = path.join(root, STATE_DIR), to = path.join(state, 'history', stamp);
    await fs.mkdir(path.join(to, 'design'), { recursive: true });
    const moves = [...['prediction', 'profile', 'evidence', 'input', 'brief', 'decisions'].map(name => [`taste/${name}.json`, `${name}.json`]),
      ...['reading', 'dna', 'plan', 'reviews', 'check'].map(name => [`design/${name}.json`, `design/${name}.json`]),
      ...['captures.json', 'images.json', 'opened.json', 'captures'].map(name => [name, name])];
    for (const [from, name] of moves) await fs.rename(path.join(state, ...from.split('/')), path.join(to, ...name.split('/'))).catch(() => {});
    return `${STATE_DIR}/history/${stamp}`;
  }

  /** A session without Qloo keeps its own prediction as the taste input, so no taste question has a measured answer. */
  const BASELINE = 'This session designs from your own prediction without Qloo, so it makes no Qloo request. Decide from your prediction, and say that no measured taste was used.';
  const isBaseline = async root => (await readState(root, 'taste/input'))?.source === 'model-assumption';

  /** The design session without Qloo: the frozen prediction becomes the taste input, with no request. */
  async function baseline(args, meta) {
    const root = await project(meta, args.workspace);
    const planned = await readState(root, 'taste/plan');
    if (!planned) refuse('PLAN_MISSING', 'Plan first: call taste_profile with dryRun:true and the brief\'s audience.');
    const prediction = await readState(root, 'taste/prediction');
    if (!prediction) refuse('PREDICTION_MISSING', `Save your own prediction first: design_validate({stage:"prediction", artifact}) for ${planned.domains.join(', ')}.`);
    if (!samePlan(prediction, planned)) refuse('PREDICTION_FROZEN', restartFor(prediction, planned));
    if ((await readState(root, 'taste/input'))?.source === 'qloo-profile') refuse('SESSION_MEASURED', 'This session already measured the audience with Qloo. Design without Qloo in a workspace of its own, or start a new session: design_validate with stage prediction and restart:true.');
    const input = tasteInputFromAssumption(prediction, { medium: planned.ownMedium || [] });
    await writeState(root, 'taste/input', compactTasteInput(input));
    const brief = buildBaselineBrief({ plan: planned, input, files: { tasteInput: `${STATE_DIR}/taste/input.json` } });
    await writeState(root, 'taste/brief', brief);
    await session(root, 'baseline');
    return { ...brief, next: 'Design from your own prediction through the same stages: design_validate the reading, the DNA and the plan, build, design_check, then design_capture and review. Say that no measured taste was used.' };
  }

  async function measure(args, meta) {
    if (args.baseline) return baseline(args, meta);
    const root = await project(meta, args.workspace);
    const planned = await readState(root, 'taste/plan');
    if (!planned) refuse('PLAN_MISSING', 'Plan first: call taste_profile with dryRun:true and the brief\'s audience.');
    if (planned.missing.some(item => item.field === 'audience')) refuse('AUDIENCE_MISSING', `The plan has no audience yet. ${planned.missing[0].ask}`);
    const prediction = await readState(root, 'taste/prediction');
    if (!prediction) refuse('PREDICTION_MISSING', `Save your own prediction first: design_validate({stage:"prediction", artifact}) for ${planned.domains.join(', ')}.`);
    if (!samePlan(prediction, planned)) refuse('PREDICTION_FROZEN', restartFor(prediction, planned));
    if (await isBaseline(root)) refuse('BASELINE_SESSION', `${BASELINE} To measure, use a workspace of its own, or start a new session: design_validate with stage prediction and restart:true.`);
    const client = await qlooClient(root, { refresh: args.refresh === true });
    // Audience descriptions become Qloo segments by name; one that matches none is reported, never replaced.
    const segments = [];
    for (const query of planned.signal.segments) {
      if (AUDIENCE_ID.test(query)) { segments.push({ query, audienceId: query, name: query }); continue; }
      try {
        const found = await client.searchAudiences({ query, limit: 6 });
        const key = normalizeTasteName(query);
        const match = (found.results || []).filter(item => item.audienceId).map(item => ({ ...item, score: Math.max(tasteNameMatch(query, item.name), normalizeTasteName(item.name).includes(key) ? 0.5 : 0) }))
          .sort((a, b) => b.score - a.score).find(item => item.score >= 0.5);
        segments.push(match ? { query, audienceId: match.audienceId, name: match.name } : { query });
      } catch (error) { segments.push({ query, error: error?.code || 'QLOO_NETWORK' }); }
    }
    const audiences = segments.filter(item => item.audienceId).map(item => item.audienceId);
    if (!planned.signal.references.length && !audiences.length) {
      const brief = { status: 'unresolved', audience: { segments: segments.map(item => ({ query: item.query, found: false })) },
        cautions: ['No audience segment matched these descriptions, so nothing was measured. Name a few works the audience loves, or look segments up with qloo_query kind audiences.'] };
      await writeState(root, 'taste/brief', brief);
      return brief;
    }
    const evidence = [];
    const profile = await buildTasteProfile({ client, references: planned.signal.references, domains: planned.domains, deepCuts: planned.signal.deepCuts,
      ...(planned.signal.location ? { location: planned.signal.location } : {}), ...(planned.signal.ages?.length ? { age: planned.signal.ages } : {}),
      ...(audiences.length ? { audiences } : {}), knownNames: planned.signal.knownNames, placeCheck: true,
      onEvidence: async record => {
        if (record.evidence && typeof record.evidence === 'object') record.evidence.id ||= `mousa-source:${randomUUID()}`;
        evidence.push({ tool: record.tool, query: record.query, status: record.status, results: record.results, evidence: record.evidence, tastePass: record.tastePass, ...(record.cache ? { cache: record.cache } : {}) });
      } });
    const input = tasteInputFromProfile(profile, prediction, { medium: planned.ownMedium || [] });
    const files = { profile: `${STATE_DIR}/taste/profile.json`, tasteInput: `${STATE_DIR}/taste/input.json`, evidence: `${STATE_DIR}/taste/evidence.json` };
    await writeState(root, 'taste/profile', profile);
    await writeState(root, 'taste/evidence', { records: evidence });
    await writeState(root, 'taste/input', compactTasteInput(input));
    const brief = buildTasteBrief({ plan: planned, profile, input, segments, cache: client.stats, files });
    await writeState(root, 'taste/brief', brief);
    await session(root, 'measured');
    const unmatchedPlace = (profile.limitations || []).find(item => /likely did not recognise that place/u.test(item));
    return { ...brief, next: profile.status === 'ok'
      ? 'Read the brief, then design from it: group the refs that belong together, and anchor palette and type to look qualities, motion to pacing, illustration to surfaces and the copy to tone. Use taste_ask for later choices.'
      : unmatchedPlace ? `${unmatchedPlace.replace(/^.*?(Plan again)/u, '$1')} Plan with taste_profile dryRun and that location, then measure; your prediction stays frozen.`
        : 'This profile is too thin to govern a design. Add a few named works the audience loves, plan again with taste_profile dryRun, then measure.' };
  }

  /** The audience signal of the measured profile, for further requests. */
  function signalOf(profile) {
    const entities = (profile.seeds || []).filter(seed => seed.resolution === 'entity').map(seed => seed.entityId);
    const tags = (profile.seeds || []).filter(seed => seed.resolution === 'tag').map(seed => seed.tagId);
    return { ...(entities.length ? { seedEntityIds: entities } : {}), ...(!entities.length && tags.length ? { seedTagIds: tags } : {}),
      ...(profile.audiences?.length ? { audiences: profile.audiences } : {}), ...(profile.location ? { location: profile.location } : {}), ...(profile.age?.length ? { age: profile.age } : {}) };
  }

  async function resolveNames(client, names, kind) {
    const resolved = [], missing = [];
    for (const name of names) {
      const found = await client.searchEntities({ query: name, ...(kind ? { types: [kind] } : {}), limit: 5 });
      const match = bestNamed(found.results, name);
      if (match) resolved.push({ name, id: match.entityId, matched: match.name, type: String(match.type || '').replace(/^urn:entity:/u, '') });
      else missing.push(name);
    }
    return { resolved, missing };
  }

  async function ask(args, meta) {
    const root = await project(meta, args.workspace);
    if (await isBaseline(root)) refuse('BASELINE_SESSION', BASELINE);
    const brief = await readState(root, 'taste/brief'), profile = await readState(root, 'taste/profile');
    if (!brief || !profile) refuse('PROFILE_MISSING', 'Measure the audience first: taste_profile with dryRun, then design_validate for your prediction, then taste_profile.');
    let answer, client = null;
    const fromProfile = { world: () => ({ worlds: brief.worlds }), shared: () => ({ qualities: brief.qualities }), pacing: () => ({ pacing: brief.tags?.pacing || [] }),
      surfaces: () => ({ surfaces: brief.tags?.surfaces || [], ...(brief.tags?.artStyles ? { artStyles: brief.tags.artStyles } : {}) }), tone: () => ({ tone: brief.tags?.tone || [] }),
      difference: async () => {
        const input = await readState(root, 'taste/input');
        const own = (input?.entities || []).filter(entity => entity.source === 'model-assumption');
        return { surprises: brief.surprises || [], confirmed: brief.confirmed || [], predictedButNotMeasured: own.filter(entity => !entity.confirmedBy).map(entity => entity.name).slice(0, 15) };
      } };
    if (fromProfile[args.question]) answer = await fromProfile[args.question]();
    else {
      client = await qlooClient(root);
      const signal = signalOf(profile);
      if (args.question === 'shortlist') {
        if (!args.candidates?.length) refuse('TOOL_INPUT_INVALID', 'shortlist needs 2-5 candidates.');
        const { resolved, missing } = await resolveNames(client, args.candidates, args.kind);
        if (!resolved.length) answer = { ranked: [], notFound: missing };
        else {
          const kind = args.kind || resolved[0].type;
          const same = resolved.filter(item => item.type === kind);
          const result = await client.getInsights({ ...signal, resultType: kind, candidateEntityIds: same.map(item => item.id), limit: Math.min(20, same.length) });
          const ranked = (result.results || []).map(entity => ({ name: entity.name, ...(entity.affinity !== undefined ? { affinity: Number(entity.affinity.toFixed(3)) } : {}) }));
          answer = { ranked, ...(missing.length ? { notFound: missing } : {}), ...(resolved.length > same.length ? { otherKinds: resolved.filter(item => item.type !== kind).map(item => item.name) } : {}),
            note: 'Ranked by Qloo affinity for this audience among the candidates only.' };
        }
      } else if (args.question === 'local') {
        const place = args.place || profile.location;
        if (!place) refuse('TOOL_INPUT_INVALID', 'local needs a place, or a location in the plan.');
        const { location: _location, ...rest } = signal;
        void _location;
        const result = await client.getInsights({ ...rest, location: place, resultType: 'place', limit: 8 });
        answer = { place, places: (result.results || []).map(row) };
      } else if (args.question === 'overlap') {
        if (!args.otherReferences?.length) refuse('TOOL_INPUT_INVALID', 'overlap needs otherReferences: what the other audience loves.');
        const { resolved, missing } = await resolveNames(client, args.otherReferences);
        if (!resolved.length) answer = { shared: [], notFound: missing };
        else {
          const kind = args.kind || (profile.domains || []).find(domain => ENTITY_KINDS.includes(domain)) || 'movie';
          const mine = await client.getInsights({ ...signal, resultType: kind, limit: 20 });
          const theirs = await client.getInsights({ seedEntityIds: resolved.map(item => item.id), resultType: kind, limit: 20 });
          const ids = new Set((theirs.results || []).map(entity => entity.entityId));
          answer = { kind, shared: (mine.results || []).filter(entity => ids.has(entity.entityId)).map(entity => entity.name),
            onlyThisAudience: (mine.results || []).filter(entity => !ids.has(entity.entityId)).slice(0, 5).map(entity => entity.name),
            onlyTheOther: (theirs.results || []).filter(entity => !(mine.results || []).some(other => other.entityId === entity.entityId)).slice(0, 5).map(entity => entity.name),
            ...(missing.length ? { notFound: missing } : {}), note: 'Shared works within two bounded result lists, not a measured overlap of people.' };
        }
      }
    }
    const requests = client ? client.stats.misses : 0, cached = client ? client.stats.hits : 0;
    const record = { at: new Date(now()).toISOString(), question: args.question, decision: args.decision, ...(args.myGuess ? { myGuess: args.myGuess } : {}), answer, requests, fromCache: cached };
    const decisions = (await readState(root, 'taste/decisions'))?.decisions || [];
    await writeState(root, 'taste/decisions', { decisions: [...decisions, record].slice(-200) });
    return { question: args.question, decision: args.decision, ...(args.myGuess ? { yourGuess: args.myGuess } : {}), answer, requests, fromCache: cached };
  }

  async function query(args, meta) {
    let root = null;
    try { root = await project(meta, args.workspace); } catch { /* Without a project folder, answers are not cached. */ }
    if (root && await isBaseline(root)) refuse('BASELINE_SESSION', BASELINE);
    const client = await qlooClient(root);
    let result;
    if (args.kind === 'search') {
      if (!args.query) refuse('TOOL_INPUT_INVALID', 'search needs a query.');
      result = await client.searchEntities({ query: args.query, ...(args.types ? { types: args.types } : {}), limit: args.limit ?? 6 });
    } else if (args.kind === 'tags') {
      if (!args.query) refuse('TOOL_INPUT_INVALID', 'tags needs a query.');
      result = await client.searchTags({ query: args.query, ...(args.tagTypes ? { tagTypes: args.tagTypes } : {}), limit: args.limit ?? 6 });
    } else if (args.kind === 'audiences') {
      result = await client.searchAudiences({ ...(args.query ? { query: args.query } : {}), ...(args.categories ? { categories: args.categories } : {}), limit: args.limit ?? 10 });
    } else {
      if (!args.resultType) refuse('TOOL_INPUT_INVALID', 'insights needs a resultType.');
      result = await client.getInsights({ resultType: args.resultType, ...(args.seedEntityIds ? { seedEntityIds: args.seedEntityIds } : {}), ...(args.seedTagIds ? { seedTagIds: args.seedTagIds } : {}),
        ...(args.audiences ? { audiences: args.audiences } : {}), ...(args.location ? { location: args.location } : {}), ...(args.ages ? { age: args.ages } : {}),
        ...(args.tagTypes ? { tagTypes: args.tagTypes } : {}), ...(args.parentTypes ? { parentTypes: args.parentTypes } : {}),
        ...(args.candidateEntityIds ? { candidateEntityIds: args.candidateEntityIds } : {}), ...(args.popularityMax !== undefined ? { popularityMax: args.popularityMax } : {}), limit: args.limit ?? 10 });
    }
    return { kind: args.kind, status: result.status, results: (result.results || []).map(row), cached: Boolean(result.cache?.hit),
      note: 'Rows Qloo returned for this request. Affinity ranks results for the signal; it does not score designs or people.' };
  }

  async function handle(name, args, meta) {
    try {
      if (name === 'taste_profile') return args.dryRun ? await plan(args, meta) : await measure(args, meta);
      if (name === 'design_validate') return await validatePrediction(args, meta);
      if (name === 'taste_ask') return await ask(args, meta);
      if (name === 'qloo_query') return await query(args, meta);
    } catch (error) {
      if (error instanceof TasteProtocolError) throw new TasteToolError(error.code, error.message);
      throw error;
    }
    return null;
  }

  return { definitions: TASTE_TOOLS, names, handle };
}
