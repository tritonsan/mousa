import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessCreativeDecision, normalizeCreativeContext, normalizeResearchDecisions, normalizeWebSources, normalizePublicWebUrl, creativeResearchKey, CulturePolicyError, CREATIVE_POLICY_TEXT } from '../plugin/server/culture/policy.mjs';
import { compileCultureBrief } from '../plugin/server/culture/brief.mjs';

const decision = { kind: 'creative', decision: 'Create an original character', openChoice: 'Character role and relationship to the world', culturalQuestion: 'Which cross-domain references could enrich its role?', expectedEffect: 'Change the character role and recurring motifs.', resultTypes: ['book', 'movie'] };
const reference = { name: 'An explicit reference', role: 'creator-inspiration', origin: 'user-provided', entityId: 'seed-1' };
const context = { domain: 'game', references: [reference], constraints: ['Keep the established world rules.'] };
const evidence = [{ id: 'Q1', tool: 'qloo_get_insights', status: 'ok', results: [{ entityId: 'anchor-1', name: 'A returned anchor' }], evidence: { provider: 'Qloo', endpoint: 'https://hackathon.api.qloo.com/v2/insights', retrievedAt: '2026-10-02T00:00:00Z' } }];
const priorRecord = reuseKey => ({ id: 'r1', decision: decision.decision, question: decision.culturalQuestion, action: 'research', reuseKey, evidenceIds: ['Q1'], finding: 'A returned relationship', interpretation: 'Creative inspiration', affectedArtifact: 'character.md' });

test('open creative requests ask a targeted reference question across every domain without changing context', () => {
  for (const domain of ['web', 'game', 'rpg', 'writing', 'general']) {
    const result = assessCreativeDecision({ decision, context: { domain } });
    assert.equal(result.action, 'clarify');
    assert.deepEqual(result.missingContext, ['references']);
    assert.equal(result.questions.length, 1);
    assert.ok(result.questions[0].length > 20);
    assert.equal(result.domain, domain);
  }
  assert.deepEqual(normalizeCreativeContext(), { domain: 'general', referencePolicy: 'ask', references: [], constraints: [] });
});

test('declared technical, factual, editing, routine, fully specified and explicit skip tasks avoid research', () => {
  for (const kind of ['technical', 'factual', 'editing', 'routine']) assert.equal(assessCreativeDecision({ decision: { ...decision, kind }, context }).action, 'skip');
  assert.equal(assessCreativeDecision({ decision: { ...decision, openChoice: false }, context }).action, 'skip');
  assert.equal(assessCreativeDecision({ decision, context: { referencePolicy: 'skip' } }).action, 'skip');
  assert.equal(assessCreativeDecision({ decision: { kind: 'creative', decision: 'Use supplied colors exactly' }, context }).action, 'skip');
});

test('delegated inspiration is a pending research plan rather than a claimed user preference', () => {
  const result = assessCreativeDecision({ decision, context: { domain: 'rpg', referencePolicy: 'delegated' } });
  assert.equal(result.action, 'research');
  assert.equal(result.queryPlan.referenceSelection, 'agent-selected-pending-resolution');
  assert.deepEqual(result.queryPlan.references, []);
  assert.equal(result.queryPlan.maxInitialCategories, 2);
  assert.equal(result.queryPlan.maxFollowUpRounds, 1);
  assert.equal(Object.hasOwn(result, 'verified'), false);
  const provisional = assessCreativeDecision({ decision: { kind: 'creative', decision: 'Create a character' }, context: { referencePolicy: 'delegated' } });
  assert.equal(provisional.action, 'research');
  assert.deepEqual(provisional.missingContext, ['culturalQuestion', 'expectedEffect']);
});

test('explicit contextual references allow a declared cultural question to become research', () => {
  const result = assessCreativeDecision({ decision, context });
  assert.equal(result.action, 'research');
  assert.deepEqual(result.queryPlan.references, [reference]);
  assert.deepEqual(result.queryPlan.resultTypes, ['book', 'movie']);
  assert.equal(result.queryPlan.expectedEffect, decision.expectedEffect);
  result.queryPlan.references[0].name = 'Locally changed';
  assert.equal(reference.name, 'An explicit reference');
});

test('exact matching research can be reused while imported source authenticity remains unverified', () => {
  const reuseKey = creativeResearchKey({ decision, context });
  const previousResearch = { researchDecisions: [priorRecord(reuseKey)], evidence };
  const result = assessCreativeDecision({ decision, context, previousResearch });
  assert.equal(result.action, 'reuse');
  assert.deepEqual(result.evidenceIds, ['Q1']);
  assert.equal(result.provenance, 'caller-provided-unverified');
  assert.equal(evidence[0].evidence.retrievedAt, '2026-10-02T00:00:00Z');
  assert.equal(Object.hasOwn(result, 'queryPlan'), false);
  for (const changedEvidence of [{ ...evidence[0], results: [] }, { ...evidence[0], status: 'error' }]) {
    assert.equal(assessCreativeDecision({ decision, context, previousResearch: { ...previousResearch, evidence: [changedEvidence] } }).action, 'research');
  }
});

test('changed role, origin, relevant constraint, question, effect and query category invalidate reuse', () => {
  const key = creativeResearchKey({ decision, context });
  const previousResearch = { researchDecisions: [priorRecord(key)], evidence };
  const cases = [
    { decision, context: { ...context, references: [{ ...reference, role: 'audience' }] } },
    { decision, context: { ...context, references: [{ ...reference, origin: 'agent-selected' }] } },
    { decision, context: { ...context, constraints: ['The setting changed.'] } },
    { decision: { ...decision, culturalQuestion: 'A different cultural question' }, context },
    { decision: { ...decision, expectedEffect: 'Change the world instead.' }, context },
    { decision: { ...decision, resultTypes: ['brand'] }, context },
  ];
  for (const input of cases) {
    assert.notEqual(creativeResearchKey(input), key);
    assert.equal(assessCreativeDecision({ ...input, previousResearch }).action, 'research');
  }
  assert.equal(creativeResearchKey({ decision: { ...decision, id: 'incidental', resultTypes: ['movie', 'book'] }, context }), key);
});

test('search-only, missing status and unknown source records cannot replace cultural insights research', () => {
  const reuseKey = creativeResearchKey({ decision, context });
  const researchDecisions = [priorRecord(reuseKey)];
  const search = { ...evidence[0], tool: 'qloo_search_entities', evidence: { ...evidence[0].evidence, endpoint: 'https://hackathon.api.qloo.com/search' } };
  const { status, ...missingStatus } = evidence[0];
  const { tool, ...standalone } = evidence[0];
  for (const record of [search, missingStatus, { ...standalone, evidence: { provider: 'Qloo' } }]) {
    assert.equal(assessCreativeDecision({ decision, context, previousResearch: { researchDecisions, evidence: [record] } }).action, 'research');
  }
  const result = assessCreativeDecision({ decision, context, previousResearch: { researchDecisions, evidence: [standalone] } });
  assert.equal(result.action, 'reuse');
  assert.equal(result.provenance, 'caller-provided-unverified');
});

test('research normalization supports structural drafts, validates supplied evidence and unwraps interpretation once', () => {
  const record = priorRecord('creative-v1:example');
  assert.equal(normalizeResearchDecisions([record])[0].evidenceIds[0], 'Q1');
  assert.throws(() => normalizeResearchDecisions([record], { evidence: [] }), CulturePolicyError);
  const normalized = normalizeResearchDecisions([{ kind: 'creative-interpretation', record }], { evidence });
  assert.equal(normalized[0].finding, record.finding);
  assert.throws(() => normalizeResearchDecisions([record, record], { evidence }), CulturePolicyError);
  assert.throws(() => normalizeResearchDecisions([{ kind: 'creative-interpretation', extra: true, record }], { evidence }), CulturePolicyError);
});

const application = { kind: 'interaction', priorApproach: 'Explain the existing locations with a linear feature list.', proposedChange: 'Let the visitor reveal the same location facts from a local map.', outputTarget: 'index.html#exploration', observableCheck: 'Each map point reveals its existing location description.', tradeoff: 'Discovery adds a step; keep the linear description available.' };
const groundedEvidence = [{ ...evidence[0], results: [{ entityId: 'anchor-1', name: 'A returned anchor', description: 'An expedition through an unfamiliar region.', tags: [{ id: 'tag-1', name: 'Expedition' }] }] }];
const applicationRecord = { ...priorRecord('creative-v1:example'), anchors: [{ evidenceId: 'Q1', entityId: 'anchor-1', detail: 'Expedition' }], application, disposition: 'considered', changeMade: '', limitation: 'The visitor mechanism is authored interpretation, not a returned preference.' };

test('application records link literal returned details to a bounded proposed artifact change', () => {
  const result = normalizeResearchDecisions([applicationRecord], { evidence: groundedEvidence })[0];
  assert.deepEqual(result.anchors, applicationRecord.anchors);
  assert.deepEqual(result.application, application);
  assert.equal(result.disposition, 'considered');
  assert.equal(result.changeMade, '');
  for (const detail of ['A returned anchor', 'unfamiliar region', 'Expedition']) {
    const input = { ...applicationRecord, anchors: [{ ...applicationRecord.anchors[0], detail }] };
    assert.equal(normalizeResearchDecisions([input], { evidence: groundedEvidence })[0].anchors[0].detail, detail);
  }
  const baseline = { ...applicationRecord, evidenceIds: [], anchors: [], action: 'skip', disposition: 'applied', changeMade: 'Built a product-first visitor map.', limitation: 'No cultural research support.' };
  assert.equal(normalizeResearchDecisions([baseline], { evidence: [] })[0].application.kind, 'interaction');
  assert.deepEqual(normalizeResearchDecisions([priorRecord('legacy')], { evidence })[0].anchors, undefined);
});

test('application anchors reject inferred facts, missing source entities, unlinked IDs and failed sources', () => {
  const anchor = applicationRecord.anchors[0];
  const invalidRecords = [
    { ...applicationRecord, anchors: [{ ...anchor, detail: 'Visitors prefer maps over feature lists.' }] },
    { ...applicationRecord, anchors: [{ ...anchor, entityId: 'unreturned-entity' }] },
    { ...applicationRecord, evidenceIds: [] },
    { ...applicationRecord, application: { ...application, kind: 'conversion' } },
    { ...applicationRecord, application: { ...application, observableCheck: '' } },
    { ...applicationRecord, disposition: 'validated-better' },
  ];
  for (const record of invalidRecords) assert.throws(() => normalizeResearchDecisions([record], { evidence: groundedEvidence }), CulturePolicyError);
  assert.throws(() => normalizeResearchDecisions([applicationRecord], { evidence: [{ ...groundedEvidence[0], status: 'error' }] }), CulturePolicyError);
  assert.throws(() => normalizeResearchDecisions([{ ...applicationRecord, anchors: Array(9).fill(anchor) }], { evidence: groundedEvidence }), CulturePolicyError);
});

test('portable application plans preserve imported-source uncertainty and do not authenticate literal links', () => {
  const compiled = compileCultureBrief({ product: 'An authored creative project', evidence: groundedEvidence, researchDecisions: [applicationRecord] });
  assert.equal(compiled.provenance, 'caller-provided-unverified');
  assert.equal(compiled.context.evidence[0].verification, 'caller-provided-unverified');
  assert.equal(compiled.context.researchDecisions[0].kind, 'creative-interpretation');
  const normalized = normalizeResearchDecisions(compiled.context.researchDecisions, { evidence: compiled.context.evidence });
  assert.deepEqual(normalized[0], normalizeResearchDecisions([applicationRecord], { evidence: groundedEvidence })[0]);
  assert.equal(Object.hasOwn(normalized[0], 'verified'), false);
});

const webSource = { id: 'W1', url: 'https://example.org/reference', title: 'Creator interview', sourceType: 'creator', status: 'ok',
  retrievedAt: '2026-10-03T00:00:00Z', tool: 'web_fetch', query: { url: 'https://example.org/reference' }, truncated: false,
  entityIds: ['anchor-1'], qlooEvidenceIds: ['Q1'], excerpt: 'Players piece together an event from incomplete evidence.' };
const reconsideredRecord = { ...applicationRecord, webSourceIds: ['W1'], webAnchors: [{ sourceId: 'W1', detail: 'incomplete evidence' }],
  reconsideration: { decisionId: 'visitor-introduction', outcome: 'replace', reason: 'The reference presents discovery as reconstructing an event.',
    approach: 'Replace the linear map introduction with an original evidence-connection activity using only existing game facts.',
    evidenceIds: ['Q1'], webSourceIds: ['W1'], rejectedAlternatives: ['Use the same map with a different palette.'],
    limitations: ['A creator explanation does not establish why this target audience likes the reference.'] } };

test('web excerpts and reconsidered approaches remain separate from Qloo relations and creative interpretation', () => {
  const result = normalizeResearchDecisions([reconsideredRecord], { evidence: groundedEvidence, webSources: [webSource] })[0];
  assert.deepEqual(result.webAnchors, reconsideredRecord.webAnchors);
  assert.deepEqual(result.reconsideration, reconsideredRecord.reconsideration);
  assert.deepEqual(result.anchors, applicationRecord.anchors);
  assert.equal(Object.hasOwn(result, 'verified'), false);
  for (const outcome of ['keep', 'refine', 'replace']) {
    assert.equal(normalizeResearchDecisions([{ ...reconsideredRecord, reconsideration: { ...reconsideredRecord.reconsideration, outcome } }], { evidence: groundedEvidence, webSources: [webSource] })[0].reconsideration.outcome, outcome);
  }
  const reused = assessCreativeDecision({ decision, context, previousResearch: { evidence: groundedEvidence, webSources: [webSource],
    researchDecisions: [{ ...reconsideredRecord, reuseKey: creativeResearchKey({ decision, context }) }] } });
  assert.equal(reused.action, 'reuse');
  assert.equal(reused.provenance, 'caller-provided-unverified');
});

test('web anchors reject invented audience reactions, unread sources and dangling reconsideration links', () => {
  const invalid = [
    { ...reconsideredRecord, webAnchors: [{ sourceId: 'W1', detail: 'Our audience prefers detective puzzles.' }] },
    { ...reconsideredRecord, webSourceIds: [] },
    { ...reconsideredRecord, webSourceIds: ['missing'] },
    { ...reconsideredRecord, reconsideration: { ...reconsideredRecord.reconsideration, webSourceIds: ['missing'] } },
    { ...reconsideredRecord, reconsideration: { ...reconsideredRecord.reconsideration, evidenceIds: ['missing'] } },
    { ...reconsideredRecord, reconsideration: { ...reconsideredRecord.reconsideration, outcome: 'proved-better' } },
  ];
  for (const record of invalid) assert.throws(() => normalizeResearchDecisions([record], { evidence: groundedEvidence, webSources: [webSource] }), CulturePolicyError);
  for (const status of ['empty', 'error']) assert.throws(() => normalizeResearchDecisions([reconsideredRecord], { evidence: groundedEvidence, webSources: [{ ...webSource, status }] }), CulturePolicyError);
  assert.throws(() => normalizeWebSources([{ ...webSource, excerpt: '' }]), CulturePolicyError);
  const failed = normalizeWebSources([{ ...webSource, status: 'error', excerpt: '', limitation: 'Page unavailable.' }])[0];
  assert.equal(failed.status, 'error');
  assert.equal(failed.excerpt, '');
});

test('portable web records bound captures and reject private or credential-bearing URLs without echoing values', () => {
  assert.equal(normalizeWebSources([webSource])[0].excerpt, webSource.excerpt);
  const { sourceType, ...unclassified } = webSource;
  assert.equal(normalizeWebSources([unclassified])[0].sourceType, 'other');
  for (const url of ['file:///private.txt', 'https://username:password@example.org/', 'http://localhost/', 'http://127.0.0.1/',
    'http://127.1/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/',
    'http://[::1]/', 'http://[fd00::1]/', 'https://example.org/?token=private-fixture', 'https://example.org/?X-Amz-Signature=private-fixture']) {
    assert.throws(() => normalizeWebSources([{ ...webSource, url }]), error => error instanceof CulturePolicyError && !error.message.includes('private-fixture'));
  }
  assert.equal(normalizePublicWebUrl('https://example.org/article?language=en#section'), 'https://example.org/article?language=en#section');
  assert.throws(() => normalizeWebSources([{ ...webSource, qlooEvidenceIds: ['missing'] }], { evidence: groundedEvidence }), CulturePolicyError);
  assert.throws(() => normalizeWebSources([webSource, webSource]), CulturePolicyError);
  assert.throws(() => normalizeWebSources(Array(25).fill(webSource)), CulturePolicyError);
  assert.throws(() => normalizeWebSources([{ ...webSource, query: { secret: 'private-fixture' } }]), error => error instanceof CulturePolicyError && !error.message.includes('private-fixture'));
  assert.throws(() => normalizeWebSources([{ ...webSource, query: { inventedArgs: 'not-actual' } }]), CulturePolicyError);
});

test('geographic signals and candidate query parameters participate in exact research reuse', () => {
  const original = { ...decision, queryParameters: { location: 'Tokyo', candidateEntityIds: ['candidate-a'], explainability: true } };
  const reuseKey = creativeResearchKey({ decision: original, context });
  const previousResearch = { researchDecisions: [priorRecord(reuseKey)], evidence };
  assert.equal(assessCreativeDecision({ decision: original, context, previousResearch }).action, 'reuse');
  for (const queryParameters of [
    { ...original.queryParameters, location: 'Osaka' },
    { ...original.queryParameters, candidateEntityIds: ['candidate-b'] },
    { ...original.queryParameters, explainability: false },
  ]) {
    const changed = { ...original, queryParameters };
    assert.notEqual(creativeResearchKey({ decision: changed, context }), reuseKey);
    assert.equal(assessCreativeDecision({ decision: changed, context, previousResearch }).action, 'research');
  }
  const reordered = { ...decision, queryParameters: { explainability: true, candidateEntityIds: ['candidate-a'], location: 'Tokyo' } };
  assert.equal(creativeResearchKey({ decision: reordered, context }), reuseKey);
  assert.throws(() => assessCreativeDecision({ decision: { ...decision, queryParameters: [] }, context }), CulturePolicyError);
  assert.throws(() => assessCreativeDecision({ decision: { ...decision, queryParameters: { apiKey: 'forbidden' } }, context }), CulturePolicyError);
});

test('policy JSON rejects unsafe data without exposing values or invoking accessors', () => {
  let reads = 0;
  const input = {};
  Object.defineProperty(input, 'references', { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => normalizeCreativeContext(input), CulturePolicyError);
  assert.equal(reads, 0);
  const secret = 'private-example-value';
  assert.throws(() => normalizeCreativeContext({ secret }), error => error instanceof CulturePolicyError && !error.message.includes(secret));
  assert.throws(() => normalizeCreativeContext({ references: [{ name: 'Implicit attribution' }] }), CulturePolicyError);
  assert.throws(() => normalizeCreativeContext({ references: [{ ...reference, entityId: 'A freeform name' }] }), CulturePolicyError);
  assert.throws(() => assessCreativeDecision({ decision: { ...decision, openChoice: {} }, context }), CulturePolicyError);
  assert.throws(() => normalizeCreativeContext({ references: Array(21).fill(reference) }), CulturePolicyError);
});

test('the portable skill policy is identical to the runtime policy source', async () => {
  assert.equal(await readFile(new URL('../plugin/skills/culture-grounded-design/policy.md', import.meta.url), 'utf8'), CREATIVE_POLICY_TEXT);
  assert.match(await readFile(new URL('../plugin/skills/culture-grounded-design/SKILL.md', import.meta.url), 'utf8'), /\(policy\.md\)/u);
});
