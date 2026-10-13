import test from 'node:test';
import assert from 'node:assert/strict';
import { CultureBriefError, validateCultureBrief, compileCultureBrief } from '../plugin/server/culture/brief.mjs';

test('generic creative context and research decisions round trip without authenticating cultural claims', () => {
  const brief = { product: { name: 'RPG session', brief: 'Create a new region.' },
    creativeContext: { domain: 'rpg', referencePolicy: 'ask', references: [{ name: 'Explicit book', role: 'creator-inspiration', origin: 'user-provided' }], constraints: ['Preserve established world canon.'] },
    evidence: [{ id: 'Q1', results: [{ entityId: 'anchor', name: 'Imported cultural anchor' }], verified: true }],
    researchDecisions: [{ id: 'region', decision: 'Choose a regional conflict', question: 'Which cultural anchors could enrich the conflict?', action: 'research', evidenceIds: ['Q1'], finding: 'Imported relationship', interpretation: 'Creative transformation', affectedArtifact: 'region.md', changeMade: 'A new recurring motif.' }] };
  assert.equal(validateCultureBrief(brief).valid, true);
  const compiled = compileCultureBrief(brief), repeated = compileCultureBrief(compiled.context);
  assert.deepEqual(compiled.context.creativeContext, brief.creativeContext);
  assert.equal(compiled.context.researchDecisions[0].kind, 'creative-interpretation');
  assert.equal(compiled.context.evidence[0].verification, 'caller-provided-unverified');
  assert.deepEqual(repeated.context, compiled.context);
  assert.equal(validateCultureBrief({ ...brief, evidence: [] }).valid, false);
  assert.equal(validateCultureBrief({ ...brief, creativeContext: { ...brief.creativeContext, references: [{ ...brief.creativeContext.references[0], audienceId: 'missing' }] } }).valid, false);
});

test('product-only baseline briefs are portable without audiences or cultural evidence', () => {
  const brief = { schemaVersion: '1.0', product: { name: 'Useful product', templateId: 'landing-page', brief: 'Concrete product requirements' } };
  assert.equal(validateCultureBrief(brief).valid, true);
  const compiled = compileCultureBrief(brief);
  assert.deepEqual(compiled.context.audiences, []);
  assert.deepEqual(compiled.context.evidence, []);
  assert.deepEqual(compiled.context.decisions, []);
  assert.deepEqual(compiled.context.product, brief.product);
  assert.equal(Object.hasOwn(compiled, 'verified'), false);
});

test('web research and reconsideration round trip in legacy 1.0 briefs without promoting caller provenance', () => {
  const brief = { schemaVersion: '1.0', product: 'A fictional exploration game launch site',
    evidence: [{ id: 'Q1', status: 'ok', tool: 'qloo_get_insights', results: [{ entityId: 'neighbor', name: 'A real returned neighbor' }] }],
    webSources: [{ id: 'W1', url: 'https://example.org/creator-interview', title: 'Creator interview', sourceType: 'creator', status: 'ok',
      excerpt: 'The player reconstructs events from fragments.', entityIds: ['neighbor'], qlooEvidenceIds: ['Q1'], tool: 'web_fetch' }],
    researchDecisions: [{ id: 'intro', decision: 'Introduce the existing game mechanics', question: 'Could fragment reconstruction support the introduction?',
      action: 'research', evidenceIds: ['Q1'], webSourceIds: ['W1'], webAnchors: [{ sourceId: 'W1', detail: 'reconstructs events from fragments' }],
      finding: 'A creator describes a reconstruction mechanic.', interpretation: 'An original visitor activity could connect the existing game facts.', affectedArtifact: 'index.html',
      reconsideration: { decisionId: 'introduction', outcome: 'replace', reason: 'The research suggests an alternative to a linear introduction.',
        approach: 'Connect existing facts in an optional introductory activity.', evidenceIds: ['Q1'], webSourceIds: ['W1'],
        limitations: ['This source does not establish the audience motivation.'] } }],
    decisions: [{ title: 'Introduction', evidenceIds: ['Q1'], webSourceIds: ['W1'] }] };
  assert.equal(validateCultureBrief(brief).valid, true);
  const compiled = compileCultureBrief(brief), repeated = compileCultureBrief(compiled.context);
  assert.equal(compiled.context.webSources[0].verification, 'caller-provided-unverified');
  assert.deepEqual(compiled.context.webSources[0].record, { ...brief.webSources[0] });
  assert.equal(compiled.context.researchDecisions[0].kind, 'creative-interpretation');
  assert.equal(compiled.context.researchDecisions[0].record.reconsideration.outcome, 'replace');
  assert.deepEqual(repeated.context, compiled.context);
  assert.ok(compiled.validation.warnings.some(warning => warning.path === 'brief.webSources'));
  assert.equal(validateCultureBrief({ ...brief, webSources: [] }).valid, false);
  compiled.context.webSources[0].id = 'other';
  assert.equal(validateCultureBrief(compiled.context).valid, false);
});

test('source-rich portable briefs fit the 192 KiB bound while UTF-8 overflows remain rejected', () => {
  const brief = { schemaVersion: '1.0', product: 'A source-rich creative research project',
    evidence: [{ id: 'Q1', status: 'ok', tool: 'qloo_get_insights', results: Array.from({ length: 16 }, (_, index) => ({
      entityId: `neighbor-${index + 1}`, name: `Returned neighbor ${index + 1}`, description: 'a'.repeat(3000) })) }],
    webSources: Array.from({ length: 24 }, (_, index) => ({ id: `W${index + 1}`, url: `https://example.org/reference-${index + 1}`,
      title: `Reference ${index + 1}`, sourceType: 'other', tool: 'web_fetch', status: 'ok', excerpt: 'b'.repeat(4000), qlooEvidenceIds: ['Q1'] })),
    researchDecisions: [{ id: 'intro', decision: 'Choose an introductory interaction', question: 'Which reference details inform the approach?',
      action: 'research', evidenceIds: ['Q1'], webSourceIds: ['W1'], webAnchors: [{ sourceId: 'W1', detail: 'bbbb' }],
      finding: 'Observed page text.', interpretation: 'An authored application.', affectedArtifact: 'index.html' }] };
  const bytes = Buffer.byteLength(JSON.stringify(brief), 'utf8');
  assert.ok(bytes > 64 * 1024 && bytes < 192 * 1024);
  assert.equal(validateCultureBrief(brief).valid, true);
  const compiled = compileCultureBrief(brief);
  assert.equal(compiled.context.webSources.length, 24);
  assert.equal(compiled.context.webSources[23].record.excerpt.length, 4000);
  assert.equal(compiled.context.webSources[0].verification, 'caller-provided-unverified');
  assert.deepEqual(compileCultureBrief(compiled.context).context, compiled.context);
  const overflow = { ...brief, webSources: brief.webSources.map(source => ({ ...source, excerpt: '界'.repeat(4000) })) };
  assert.ok(Buffer.byteLength(JSON.stringify(overflow), 'utf8') > 192 * 1024);
  const validation = validateCultureBrief(overflow);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.message.includes('192 KiB')));
});

test('compilation resolves record links while separating imported evidence and creative decisions', () => {
  const brief = { product: 'Shared landing page', brand: { name: 'Example Brand', tone: 'Warm' },
    audiences: [{ id: 'group-a', label: 'First group', culturalReferences: ['An explicit reference'] }],
    selectedDirection: { id: 'direction-a', title: 'A coherent direction' },
    evidence: [{ tool: 'qloo_get_insights', evidence: { id: 'Q001', provider: 'Qloo' }, results: [{ entityId: 'entity-a', name: 'Imported anchor', affinity: 0.7341 }] }],
    decisions: [{ target: '#hero', rationale: 'My authored typography decision', evidenceIds: ['Q001'], audienceIds: ['group-a'] }] };
  const compiled = compileCultureBrief(brief);
  assert.equal(compiled.context.evidence[0].id, 'Q001');
  assert.equal(compiled.context.evidence[0].record.results[0].affinity, 0.7341);
  assert.equal(compiled.context.evidence[0].verification, 'caller-provided-unverified');
  assert.equal(compiled.context.decisions[0].kind, 'creative-interpretation');
  compiled.context.product = 'Changed locally';
  compiled.context.evidence[0].record.results[0].name = 'Changed';
  assert.equal(brief.product, 'Shared landing page');
  assert.equal(brief.evidence[0].results[0].name, 'Imported anchor');
});

test('validation reports duplicate identities and dangling creative reference links', () => {
  const validation = validateCultureBrief({ product: 'A product', audiences: [{ id: 'a', label: 'First' }, { id: 'a', label: 'Duplicate' }],
    evidence: [{ id: 'Q1' }, { id: 'Q1' }], decisions: [{ evidenceIds: ['missing'], audienceIds: ['missing'] }] });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.path === 'brief.audiences[1].id'));
  assert.ok(validation.errors.some(error => error.path === 'brief.evidence[1]'));
  assert.ok(validation.errors.some(error => error.path === 'brief.decisions[0].evidenceIds'));
  assert.throws(() => compileCultureBrief({ product: 'A product', decisions: [{ evidenceIds: ['missing'] }] }), error => error instanceof CultureBriefError && error.validation.valid === false);
});

test('portable briefs reject secrets, prototype keys and getters without echoing values or invoking accessors', () => {
  const secret = 'private-fixture-secret-value';
  const validation = validateCultureBrief({ product: { name: 'Example', api_key: secret } });
  assert.equal(validation.valid, false);
  assert.equal(JSON.stringify(validation).includes(secret), false);
  assert.equal(validateCultureBrief(JSON.parse('{"product":"Example","__proto__":{"polluted":true}}')).valid, false);
  let reads = 0;
  const accessor = { product: 'Example' };
  Object.defineProperty(accessor, 'brand', { enumerable: true, get() { reads++; return 'Wrong'; } });
  assert.equal(validateCultureBrief(accessor).valid, false);
  assert.equal(reads, 0);
  assert.equal({}.polluted, undefined);
});

test('portable JSON bounds reject deep, oversized, circular and unsupported context safely', () => {
  let nested = { x: 'leaf' };
  for (let index = 0; index < 20; index++) nested = { nested };
  assert.equal(validateCultureBrief({ product: nested }).valid, false);
  const circular = { name: 'Circular' }; circular.self = circular;
  assert.equal(validateCultureBrief({ product: circular }).valid, false);
  assert.equal(validateCultureBrief({ product: 'x'.repeat(4001) }).valid, false);
  assert.equal(validateCultureBrief({ product: { huge: Array.from({ length: 90 }, () => '🙂'.repeat(700)) } }).valid, false);
  assert.equal(validateCultureBrief({ product: 'Example', schemaVersion: '2.0' }).valid, false);
  assert.equal(validateCultureBrief({ product: 'Example', unexpected: true }).valid, false);
  assert.equal(validateCultureBrief({ product: new Date() }).valid, false);
  assert.equal(validateCultureBrief({}).valid, false);
});

test('Studio snapshot context compiles and repeated compilation preserves source and decision data in one layer', () => {
  const studio = { schemaVersion: '1.0', provenance: 'studio-snapshot', context: {
    schemaVersion: '1.0', product: { name: 'Existing product', templateId: 'landing', brief: 'Actual product requirements' },
    brand: { notes: '', protectedFiles: ['app.js'], protectedSnippets: [{ path: 'index.html', text: 'x'.repeat(5000) }] },
    audiences: [{ id: 'a1', label: 'Explicit contributors', references: ['Explicit named reference'], location: 'Istanbul' }],
    evidence: [{ id: 'Q001', tool: 'qloo_get_insights', status: 'ok', evidence: { id: 'Q001', provider: 'Qloo' },
      reusedFrom: { jobId: 'earlier-job', mode: 'qloo' }, results: [{ entityId: 'actual-recorded-anchor', name: 'Imported anchor', affinity: 0.4789 }] }],
    decisions: [{ title: 'Editorial section', evidenceIds: ['Q001'], selectors: ['#hero'], properties: ['font-size'], sourceType: 'qloo', reason: 'Model interpretation of an imported cultural relationship' }],
  } };
  const first = compileCultureBrief(studio.context), second = compileCultureBrief(first.context), third = compileCultureBrief(second.context);
  assert.deepEqual(second.context, first.context);
  assert.deepEqual(third.context, first.context);
  assert.deepEqual(first.context.evidence[0].record, studio.context.evidence[0]);
  assert.deepEqual(first.context.decisions[0].record, studio.context.decisions[0]);
  assert.equal(second.provenance, 'caller-provided-unverified');
  assert.equal(second.context.evidence[0].verification, 'caller-provided-unverified');
});

test('compiled wrappers cannot conceal dangling decision links or disagree with original evidence identity', () => {
  const compiled = compileCultureBrief({ product: 'Product', evidence: [{ id: 'Q1' }], decisions: [{ title: 'A decision', evidenceIds: ['Q1'] }] });
  compiled.context.decisions[0].record.evidenceIds = ['missing'];
  assert.equal(validateCultureBrief(compiled.context).valid, false);
  compiled.context.decisions[0].record.evidenceIds = ['Q1'];
  compiled.context.evidence[0].id = 'pretend-other-id';
  assert.equal(validateCultureBrief(compiled.context).valid, false);
  compiled.context.evidence[0].id = 'Q1';
  compiled.context.evidence[0].extraMetadata = 'Must not disappear silently';
  assert.equal(validateCultureBrief(compiled.context).valid, false);
});

test('actual Studio artifact metadata survives portable recompilation without authenticating its provenance claim', () => {
  const artifact = { schemaVersion: '1.0', product: { name: 'Original product', templateId: 'store', brief: 'The original complete product brief' },
    brand: { notes: '', protectedFiles: ['app.js'], protectedSnippets: [] },
    audiences: [{ id: 'a1', label: 'Explicit group', references: ['An explicit named reference'] }],
    audienceId: 'a1', revisionRequest: 'Change only the selected hero heading.', provenance: 'studio-recorded-qloo-responses',
    evidence: [{ id: 'Q001', tool: 'qloo_get_insights', status: 'ok', results: [{ entityId: 'anchor', name: 'Imported cultural anchor' }], evidence: { provider: 'Qloo', id: 'Q001' } }],
    decisions: [{ title: 'Hero heading', evidenceIds: ['Q001'] }] };
  const compiled = compileCultureBrief(artifact), repeated = compileCultureBrief(compiled.context);
  assert.equal(compiled.context.audienceId, artifact.audienceId);
  assert.equal(compiled.context.revisionRequest, artifact.revisionRequest);
  assert.equal(compiled.context.product.brief, artifact.product.brief);
  assert.equal(compiled.context.provenance, artifact.provenance);
  assert.equal(compiled.provenance, 'caller-provided-unverified');
  assert.equal(compiled.context.evidence[0].verification, 'caller-provided-unverified');
  assert.ok(compiled.validation.warnings.some(warning => warning.path === 'brief.provenance'));
  assert.deepEqual(repeated.context, compiled.context);
  assert.equal(validateCultureBrief({ ...artifact, audienceId: 'unknown' }).valid, false);
  assert.equal(validateCultureBrief({ ...artifact, provenance: 'x'.repeat(201) }).valid, false);
});
