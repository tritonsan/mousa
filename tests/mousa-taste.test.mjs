import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { QlooClient } from '../plugin/server/qloo/client.mjs';
import { buildTasteProfile } from '../plugin/server/culture/taste.mjs';
import { planTaste, MEDIUM_RECIPES, TASTE_QUESTIONS } from '../plugin/server/taste/questions.mjs';
import { createCachingClient } from '../plugin/server/taste/cache.mjs';
import { BRIEF_LIMIT_BYTES } from '../plugin/server/taste/brief.mjs';
import { createMousaServer } from '../plugin/server/mcp/mousa.mjs';
import { createConnectionStore, plainProtector } from '../plugin/server/connections/store.mjs';

import { json, PARENTS, qlooFixture, FONTS, prediction, parse, exists } from './helpers/mousa-fixtures.mjs';

test('the client finds audience segments and weights Insights by them, and any one signal is enough', async () => {
  const urls = [];
  const client = new QlooClient({ apiKey: 'fixture', fetchImpl: async url => { urls.push(new URL(url)); return json(urls.at(-1).pathname === '/v2/audiences'
    ? { results: { audiences: [{ entity_id: 'AUD-1', id: PARENTS, name: 'Parents With Young Children', parents: [{ id: 'urn:audience:life_stage', name: 'Life Stage' }] }] } }
    : { results: { entities: [] } }); } });
  const found = await client.searchAudiences({ query: 'parent', categories: ['life_stage'] });
  assert.equal(urls[0].pathname, '/v2/audiences');
  assert.equal(urls[0].searchParams.get('filter.query'), 'parent');
  assert.equal(urls[0].searchParams.get('filter.parents.types'), 'urn:audience:life_stage');
  assert.equal(found.results[0].audienceId, PARENTS);
  assert.deepEqual(found.results[0].parents, ['Life Stage']);
  await client.getInsights({ resultType: 'brand', audiences: [PARENTS], audienceWeight: 'high', location: 'Istanbul', age: ['25_to_29'] });
  assert.equal(urls[1].searchParams.get('signal.demographics.audiences'), PARENTS);
  assert.equal(urls[1].searchParams.get('signal.demographics.audiences.weight'), 'high');
  await client.getInsights({ resultType: 'place', location: 'Kadıköy' });
  assert.equal(urls[2].searchParams.get('signal.location.query'), 'Kadıköy');
  await assert.rejects(client.getInsights({ resultType: 'movie' }), error => error.code === 'QLOO_INPUT_INVALID' && /at least one signal/u.test(error.message));
  await assert.rejects(client.getInsights({ resultType: 'movie', audiences: ['parents'] }), error => error.code === 'QLOO_INPUT_INVALID');
  await assert.rejects(client.getInsights({ resultType: 'movie', seedEntityIds: ['A'], audienceWeight: 'high' }), error => error.code === 'QLOO_INPUT_INVALID');
  await assert.rejects(client.searchAudiences({}), error => error.code === 'QLOO_INPUT_INVALID');
});

test('a taste pass can measure from audience segments alone and says the signal is broader', async () => {
  const { fetchImpl, requests } = qlooFixture();
  const profile = await buildTasteProfile({ client: new QlooClient({ apiKey: 'fixture', fetchImpl }), references: [], audiences: [PARENTS], domains: ['brand', 'movie', 'tone', 'qualities'], retryDelayMs: 0 });
  assert.equal(profile.status, 'ok');
  assert.deepEqual(profile.audiences, [PARENTS]);
  assert.ok(requests.every(url => url.includes('signal.demographics.audiences=')));
  assert.ok(requests.some(url => url.includes('filter.tag.types=urn%3Atag%3Aemotional_tone%3Aqloo')));
  assert.ok(profile.entities.some(entity => entity.domain === 'tone' && entity.name === 'Thoughtful'));
  assert.ok(profile.limitations.some(line => /audience segments without named works/u.test(line)));
  await assert.rejects(buildTasteProfile({ client: new QlooClient({ apiKey: 'fixture', fetchImpl }), references: [] }), /references/u);
});

test('the plan picks domains by medium, keeps brand references out of the seeds and asks for what is missing', () => {
  const web = planTaste({ medium: 'web', references: [{ name: 'Paterson' }, { name: 'Nujabes' }, { name: 'Muji', role: 'brand' }], decisions: ['palette', 'motion'] });
  assert.deepEqual(web.domains, MEDIUM_RECIPES.web.domains);
  assert.deepEqual(web.signal.references.map(ref => ref.name), ['Paterson', 'Nujabes']);
  assert.deepEqual(web.signal.knownNames, ['Muji']);
  assert.deepEqual(web.missing, []);
  assert.deepEqual(web.questions.now.map(question => question.id), ['world', 'shared', 'pacing', 'surfaces', 'tone', 'difference']);
  assert.deepEqual(web.questions.later.map(question => question.id), ['shortlist', 'overlap']);
  assert.ok(web.questions.now.find(question => question.id === 'pacing').relevant);
  assert.deepEqual(web.requests.estimate, [2 + 5 + 3 + 2, 2 + 2 + 5 + 3 + 2]);
  assert.deepEqual(web.prediction.domains, web.domains);
  const located = planTaste({ medium: 'web', references: ['Paterson'], location: 'Kadıköy, Istanbul' });
  assert.ok(located.domains.includes('place'));
  assert.ok(located.questions.later.some(question => question.id === 'local'));
  const place = planTaste({ medium: 'place', references: ['Paterson'] });
  assert.deepEqual(place.missing.map(item => item.field), ['location']);
  const nobody = planTaste({ medium: 'game' });
  assert.deepEqual(nobody.missing.map(item => item.field), ['audience']);
  assert.ok(nobody.domains.includes('videogame') && nobody.domains.includes('art_style'));
  const segmentsOnly = planTaste({ medium: 'app-ui', segments: ['parents with young children'] });
  assert.deepEqual(segmentsOnly.missing, []);
  assert.ok(segmentsOnly.requests.notes.some(note => /broader signal/u.test(note)));
  assert.equal(planTaste({ medium: 'unknown-medium', references: ['Paterson'] }).medium, 'generic');
  assert.equal(TASTE_QUESTIONS.length, 9);
});

test('the Qloo cache answers repeats from the project, expires, can be skipped and never stores errors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mousa-cache-'));
  try {
    let calls = 0, clock = Date.parse('2026-10-13T10:00:00Z');
    const client = { async searchEntities(args) { calls++; if (args.query === 'fail') throw Object.assign(new Error('down'), { code: 'QLOO_NETWORK' }); return { status: 'ok', results: [{ entityId: 'A', name: args.query }] }; } };
    const cached = createCachingClient({ client, dir, baseUrl: 'https://x.test', now: () => clock });
    assert.equal((await cached.searchEntities({ query: 'Paterson', limit: 2 })).cache.hit, false);
    assert.equal((await cached.searchEntities({ limit: 2, query: 'Paterson' })).cache.hit, true, 'argument order does not matter');
    assert.equal(calls, 1);
    assert.deepEqual(cached.stats, { hits: 1, misses: 1 });
    assert.equal(await readFile(path.join(dir, '.gitignore'), 'utf8'), '*\n');
    clock += 8 * 24 * 60 * 60 * 1000;
    assert.equal((await cached.searchEntities({ query: 'Paterson', limit: 2 })).cache.hit, false, 'a week-old answer is asked again');
    const fresh = createCachingClient({ client, dir, baseUrl: 'https://x.test', now: () => clock, refresh: true });
    assert.equal((await fresh.searchEntities({ query: 'Paterson', limit: 2 })).cache.hit, false);
    await assert.rejects(cached.searchEntities({ query: 'fail' }));
    await assert.rejects(cached.searchEntities({ query: 'fail' }));
    assert.equal(calls, 5, 'errors are asked again');
    const other = createCachingClient({ client, dir, baseUrl: 'https://other.test', now: () => clock });
    assert.equal((await other.searchEntities({ query: 'Paterson', limit: 2 })).cache.hit, false, 'another API address has its own answers');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the taste flow plans without a request, freezes the prediction, measures once and answers later questions', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-taste-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-taste-config-'));
  const { fetchImpl, requests } = qlooFixture();
  const server = createMousaServer({ env: { MOUSA_PROJECT_DIR: project, QLOO_API_KEY: 'fixture-key-123', MOUSA_HOST: 'claude-code' }, fetchImpl,
    store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }), fonts: async () => FONTS } });
  const call = async (name, args) => parse(await server.callTool(name, args));
  try {
    assert.equal((await call('design_validate', { stage: 'prediction', artifact: prediction() })).error.code, 'PLAN_MISSING');
    const planned = await call('taste_profile', { dryRun: true, medium: 'web', decisions: ['palette', 'voice'],
      references: [{ name: 'Paterson' }, { name: 'Nujabes' }, { name: 'Studio Ghibli films' }, { name: 'Muji', role: 'brand' }], segments: ['parents with young children'] });
    assert.equal(planned.status, 'planned');
    assert.equal(requests.length, 0, 'planning makes no request');
    assert.deepEqual(planned.plan.prediction.domains, MEDIUM_RECIPES.web.domains);
    assert.match(planned.next, /design_validate/u);
    assert.ok(await exists(path.join(project, '.mousa', 'taste', 'plan.json')));
    assert.equal((await call('taste_profile', {})).error.code, 'PREDICTION_MISSING');

    const futura = await call('design_validate', { stage: 'prediction', artifact: prediction(['Futura']) });
    assert.equal(futura.error.code, 'TASTE_PROTOCOL_INVALID');
    assert.match(futura.error.message, /Jost stands in for Futura/u);
    const frozen = await call('design_validate', { stage: 'prediction', artifact: prediction() });
    assert.equal(frozen.status, 'frozen');
    assert.equal(frozen.designSketch.fonts.join(), 'Literata,Courier Prime');
    assert.equal((await call('design_validate', { stage: 'prediction', artifact: prediction() })).error.code, 'PREDICTION_FROZEN');
    assert.equal(JSON.parse(await readFile(path.join(project, '.mousa', 'session.json'), 'utf8')).stage, 'predicted');

    const brief = await call('taste_profile', {});
    assert.equal(brief.status, 'ok');
    const sent = requests.length;
    assert.ok(sent > 0 && sent <= 24);
    assert.ok(requests.filter(url => url.startsWith('/v2/insights')).every(url => url.includes(`signal.demographics.audiences=${encodeURIComponent(PARENTS)}`)), 'the segment weights every request');
    assert.deepEqual(brief.audience.segments, [{ query: 'parents with young children', found: 'Parents With Young Children', id: PARENTS }]);
    assert.ok(brief.audience.references.some(ref => ref.name === 'Studio Ghibli films' && ref.found === false));
    assert.ok(brief.qualities.look.some(item => item.name === 'Atmospheric' && item.works.length >= 2));
    assert.ok(brief.qualities.meaning.some(item => item.name === 'Routine'));
    assert.deepEqual(brief.tags.tone, ['Thoughtful (new)', 'Introspective (new)', 'Melancholic (new)']);
    assert.deepEqual(brief.tags.pacing.slice(0, 1), ['Quiet (predicted)']);
    assert.ok(brief.worlds.films.length && brief.worlds['films (lesser known)'].length);
    const perfectDays = brief.worlds.films.find(item => item.name === 'Perfect Days');
    assert.deepEqual(perfectDays, { name: 'Perfect Days', predicted: true, tags: ['Atmospheric', 'Reflective', 'Routine'] }, 'a work shows its leading returned tags');
    assert.ok(brief.surprises.length && brief.confirmed.includes('Perfect Days'));
    assert.ok(brief.requiredAnchors.length >= 3);
    assert.ok(brief.requiredAnchors.filter(anchor => !/quality|tag$/u.test(anchor.is)).every(anchor => anchor.tags?.length), 'a required work shows the tags a device may name');
    assert.ok(brief.cautions.some(line => /Minimalist is carried mostly by brands/u.test(line)));
    assert.ok(brief.cautions.some(line => /Studio Ghibli films/u.test(line)));
    assert.match(brief.layers.palette, /Atmospheric/u);
    assert.match(brief.layers.voice, /Thoughtful/u);
    assert.ok(Buffer.byteLength(JSON.stringify(brief)) <= BRIEF_LIMIT_BYTES + 1024, 'the result stays small enough to show inline');
    for (const file of ['profile', 'evidence', 'input', 'brief']) assert.ok(await exists(path.join(project, '.mousa', 'taste', `${file}.json`)), file);
    assert.equal(JSON.parse(await readFile(path.join(project, '.mousa', 'session.json'), 'utf8')).stage, 'measured');
    const input = JSON.parse(await readFile(path.join(project, '.mousa', 'taste', 'input.json'), 'utf8'));
    assert.ok(input.requiredAnchors.length && input.entities.some(entity => entity.source === 'model-assumption'));

    const again = await call('taste_profile', {});
    assert.equal(requests.length, sent, 'a second measurement comes from the cache');
    assert.equal(again.measured.answeredFromCache, sent);

    const difference = await call('taste_ask', { question: 'difference', decision: 'what moves the hero off the notebook', myGuess: 'warm paper' });
    assert.equal(difference.requests, 0);
    assert.equal(difference.yourGuess, 'warm paper');
    assert.ok(difference.answer.predictedButNotMeasured.includes('Lost in Translation'));
    const shortlist = await call('taste_ask', { question: 'shortlist', kind: 'artist', decision: 'which artist plays in the shop', myGuess: 'Khruangbin', candidates: ['Hiroshi Yoshimura', 'Khruangbin', 'Tom Misch', 'Nobody Known'] });
    assert.equal(shortlist.answer.ranked.length, 3);
    assert.deepEqual(shortlist.answer.notFound, ['Nobody Known']);
    assert.equal(shortlist.requests, 5);
    assert.ok(requests.at(-1).includes('filter.results.entities='));
    assert.equal((await call('taste_ask', { question: 'local', decision: 'nearby partners' })).error.code, 'TOOL_INPUT_INVALID');
    const decisions = JSON.parse(await readFile(path.join(project, '.mousa', 'taste', 'decisions.json'), 'utf8')).decisions;
    assert.deepEqual(decisions.map(item => item.question), ['difference', 'shortlist']);

    const audiences = await call('qloo_query', { kind: 'audiences', query: 'parent' });
    assert.equal(audiences.results[0].id, PARENTS);

    const restarted = await call('design_validate', { stage: 'prediction', artifact: prediction(['Jost']), restart: true });
    assert.equal(restarted.status, 'frozen');
    assert.match(restarted.archived, /^\.mousa\/history\//u);
    const history = await readdir(path.join(project, '.mousa', 'history'));
    assert.equal(history.length, 1);
    assert.ok(await exists(path.join(project, '.mousa', 'history', history[0], 'brief.json')));
    assert.ok(!(await exists(path.join(project, '.mousa', 'taste', 'brief.json'))));
    assert.ok(await exists(path.join(project, '.mousa', 'cache', 'qloo', '.gitignore')));
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('taste tools say what to do when Qloo is not connected or no audience is named', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-taste-empty-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-taste-empty-config-'));
  const server = createMousaServer({ env: { MOUSA_PROJECT_DIR: project }, store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }), fonts: async () => FONTS } });
  const call = async (name, args) => parse(await server.callTool(name, args));
  try {
    const nobody = await call('taste_profile', { dryRun: true, medium: 'web' });
    assert.equal(nobody.status, 'needs-input');
    assert.match(nobody.next, /Who is this for/u);
    await call('taste_profile', { dryRun: true, medium: 'web', references: [{ name: 'Paterson' }] });
    await call('design_validate', { stage: 'prediction', artifact: prediction() });
    const offline = await call('taste_profile', {});
    assert.equal(offline.error.code, 'QLOO_KEY_MISSING');
    assert.match(offline.error.message, /mousa_connect/u);
    assert.equal((await call('taste_ask', { question: 'world', decision: 'imagery' })).error.code, 'PROFILE_MISSING');
    // A plan for other domains is kept, and the prediction that no longer fits it waits for a new session.
    const replanned = await call('taste_profile', { dryRun: true, medium: 'game', references: [{ name: 'Paterson' }] });
    assert.equal(replanned.status, 'needs-restart');
    assert.match(replanned.next, /covers brand, movie.*measures videogame.*restart:true/u);
    assert.equal((await call('taste_profile', {})).error.code, 'PREDICTION_FROZEN', 'no measurement against a prediction for other domains');
    assert.equal((await call('design_validate', { stage: 'prediction', artifact: prediction() })).error.code, 'PREDICTION_FROZEN');
    const game = { ...prediction(), predictions: { videogame: ['Hollow Knight', 'Celeste', 'Journey'], movie: ['Spirited Away', 'Paprika', 'Akira'], tv_show: ['Mushishi', 'Arcane', 'Samurai Champloo'],
      artist: ['Sigur Rós', 'Nujabes', 'Joe Hisaishi'], book: ['The Little Prince', 'Kitchen', 'Piranesi'], style: ['slow', 'dreamlike', 'quiet'], aesthetic: ['hand-drawn', 'ink wash', 'muted'],
      tone: ['wistful', 'gentle', 'lonely'], qualities: ['melancholic', 'atmospheric', 'whimsical'], art_style: ['pixel art', 'hand-drawn', 'watercolor'] } };
    const restarted = await call('design_validate', { stage: 'prediction', artifact: game, restart: true });
    assert.equal(restarted.status, 'frozen', JSON.stringify(restarted));
    assert.deepEqual(restarted.domains, replanned.plan.domains);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('a place Qloo does not recognise stops the measurement after its first empty answers and says what to try', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-taste-place-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-taste-place-config-'));
  const fixture = qlooFixture();
  // As in the first live plugin session: every answer weighted by the full address came back empty.
  const sent = [];
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    sent.push(target.pathname);
    if (target.pathname === '/v2/insights' && target.searchParams.get('signal.location.query') === 'Moda, Kadıköy, Istanbul') return json({ results: { entities: [] } });
    return fixture.fetchImpl(url, init);
  };
  const server = createMousaServer({ env: { MOUSA_PROJECT_DIR: project, QLOO_API_KEY: 'fixture-key-123' }, fetchImpl, store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }), fonts: async () => FONTS } });
  const call = async (name, args) => parse(await server.callTool(name, args));
  const references = [{ name: 'Paterson' }, { name: 'Nujabes' }];
  try {
    const planned = await call('taste_profile', { dryRun: true, medium: 'web', references, location: 'Moda, Kadıköy, Istanbul' });
    assert.ok(planned.plan.requests.notes.some(note => /may match nothing.*"Istanbul"/u.test(note)), 'the plan warns about a full address');
    const guess = prediction();
    assert.equal((await call('design_validate', { stage: 'prediction', artifact: { ...guess, predictions: { ...guess.predictions, place: ['Moda Sahili', 'Kronotrop', 'Walter\'s Coffee Roastery'] } } })).status, 'frozen');
    const empty = await call('taste_profile', {});
    assert.equal(empty.status, 'insufficient');
    const insights = sent.filter(item => item === '/v2/insights').length;
    assert.ok(insights <= 3, `${insights} Insights requests, not one per domain`);
    assert.ok(empty.cautions.some(line => /likely did not recognise that place/u.test(line)));
    assert.match(empty.next, /^Plan again with the city or the neighbourhood alone, such as "Istanbul"\..*prediction stays frozen/u);
    // Planned again with the city alone, the plan keeps its references and medium, and the frozen prediction measures.
    const city = await call('taste_profile', { dryRun: true, location: 'Istanbul' });
    assert.equal(city.status, 'planned');
    assert.deepEqual(city.kept, ['medium', 'references']);
    assert.deepEqual(city.plan.signal.references.map(item => item.name), ['Paterson', 'Nujabes']);
    assert.equal(city.plan.signal.location, 'Istanbul');
    assert.equal((await call('taste_profile', {})).status, 'ok');
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});

test('a Qloo budget caps the requests a project sends, counts failed ones, and leaves cached answers free', async () => {
  const { createCachingClient: caching, readQlooUsage } = await import('../plugin/server/taste/cache.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mousa-budget-'));
  try {
    let sent = 0;
    const client = { searchEntities: async args => { sent++; if (args.query === 'broken') throw Object.assign(new Error('down'), { code: 'QLOO_UPSTREAM' }); return { status: 'ok', results: [{ name: args.query }] }; } };
    const budget = { limit: 3, file: path.join(dir, 'usage.json') };
    const first = caching({ client, dir: path.join(dir, 'cache'), budget });
    await first.searchEntities({ query: 'Paterson' });
    await assert.rejects(first.searchEntities({ query: 'broken' }), { code: 'QLOO_UPSTREAM' });
    assert.equal(await readQlooUsage(budget.file), 2, 'a failed request was sent, so it counts');
    // Two at once with one request left: exactly one is sent.
    const both = await Promise.allSettled([first.searchEntities({ query: 'Nujabes' }), first.searchEntities({ query: 'Khruangbin' })]);
    assert.deepEqual(both.map(item => item.status).sort(), ['fulfilled', 'rejected']);
    assert.equal(both.find(item => item.status === 'rejected').reason.code, 'QLOO_BUDGET');
    assert.equal(sent, 3);
    assert.equal((await first.searchEntities({ query: 'Paterson' })).cache.hit, true, 'a cached answer is free');
    // A later session reads the same count from the project.
    const later = caching({ client, dir: path.join(dir, 'cache'), budget });
    await assert.rejects(later.searchEntities({ query: 'Tom Misch' }), error => error.code === 'QLOO_BUDGET' && /budget of 3 requests/u.test(error.message));
    assert.equal(sent, 3);
    assert.equal(await readQlooUsage(budget.file), 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the server counts a project\'s Qloo requests, shows them in mousa_status and stops at MOUSA_QLOO_BUDGET', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-budget-project-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-budget-config-'));
  const { fetchImpl, requests } = qlooFixture();
  const server = createMousaServer({ env: { MOUSA_PROJECT_DIR: project, QLOO_API_KEY: 'fixture-key-123', MOUSA_QLOO_BUDGET: '5' }, fetchImpl,
    store: createConnectionStore({ env: { MOUSA_CONFIG_DIR: config }, protector: plainProtector }),
    inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }), fonts: async () => FONTS } });
  const call = async (name, args) => parse(await server.callTool(name, args));
  try {
    await call('taste_profile', { dryRun: true, medium: 'web', references: [{ name: 'Paterson' }, { name: 'Nujabes' }] });
    await call('design_validate', { stage: 'prediction', artifact: prediction() });
    await call('taste_profile', {});
    assert.equal(requests.length, 5, 'no request beyond the budget left the server');
    const profile = JSON.parse(await readFile(path.join(project, '.mousa', 'taste', 'profile.json'), 'utf8'));
    assert.ok(profile.results.some(result => result.error?.code === 'QLOO_BUDGET'), 'the domains past the budget say why they are empty');
    const status = await call('mousa_status', {});
    assert.deepEqual([status.qloo.requests, status.qloo.budget], [5, 5]);
    assert.equal((await call('qloo_query', { kind: 'search', query: 'Khruangbin' })).error.code, 'QLOO_BUDGET');
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(config, { recursive: true, force: true });
  }
});
