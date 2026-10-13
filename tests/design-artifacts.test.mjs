import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCultureBrief, normalizeDirections, normalizeDecisions, fileDiff, assertBrandLocks, findHtmlTarget, applyScopedRevision, snapshotResearchApplications, verifyResearchApplications, uncheckedResearchVerification } from '../src/design-artifacts.mjs';

const evidence = [
  { id: 'Q001', tool: 'qloo_get_insights', status: 'ok', results: [{ entityId: 'real-film', name: 'Returned film' }] },
  { id: 'Q002', tool: 'qloo_search_entities', status: 'ok', results: [{ entityId: 'real-artist', name: 'Returned artist' }] },
  { id: 'Q003', tool: 'qloo_get_insights', status: 'empty', results: [] },
];
const directions = [
  { id: 'editorial', title: 'Editorial direction', summary: 'Model interpretation of the supplied references.', audienceIds: ['a1'], anchors: [{ entityId: 'real-film', evidenceId: 'Q001' }], changes: [{ selector: '#hero', change: 'A quiet introduction.' }], tradeoffs: ['Less immediate catalogue visibility.'] },
  { id: 'catalogue', title: 'Catalogue direction', summary: 'Put the working catalogue first.', audienceIds: [], anchors: [], changes: [{ selector: '#catalog', change: 'A denser grid.' }], tradeoffs: [] },
];

test('culture brief defaults do not invent an audience or lock existing app behavior', () => {
  assert.deepEqual(normalizeCultureBrief(undefined, { templateId: 'local-food', brief: 'A new shop' }), {
    schemaVersion: '1.0', brand: { notes: '', protectedFiles: [], protectedSnippets: [] }, audiences: [],
  });
});
test('culture brief validates real user groups, path scope and literal brand snippets', () => {
  const normalized = normalizeCultureBrief({ brand: { protectedFiles: ['app.js'], protectedSnippets: [{ path: 'index.html', text: ' Logo ' }] }, audiences: [{ id: 'a1', label: 'Film enthusiasts', references: ['Film A', 'Film A'], location: 'Istanbul' }] });
  assert.deepEqual(normalized.audiences[0].references, ['Film A']);
  assert.equal(normalized.brand.protectedSnippets[0].text, ' Logo ');
  for (const file of ['../app.js', '/etc/passwd', 'a/../x.css', '.env', 'C:\\keys.txt']) assert.throws(() => normalizeCultureBrief({ brand: { protectedFiles: [file] } }));
  assert.throws(() => normalizeCultureBrief({ audiences: Array.from({ length: 4 }, (_, i) => ({ id: 'a' + i, label: 'Group' })) }));
  assert.throws(() => normalizeCultureBrief({ audiences: [{ label: 'Group', references: Array(7).fill('Film') }] }));
  assert.throws(() => normalizeCultureBrief({ audiences: [{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }] }));
  assert.throws(() => normalizeCultureBrief({ schemaVersion: '99' }));
});
test('directions accept empty baseline anchors while validating every claimed Qloo entity', () => {
  const value = normalizeDirections(JSON.stringify(directions), { evidence, audiences: [{ id: 'a1' }] });
  assert.equal(value[0].sourceType, 'model-interpretation');
  assert.deepEqual(value[1].anchors, []);
  const baseline = directions.map(direction => ({ ...direction, anchors: [], audienceIds: [] }));
  assert.equal(normalizeDirections(baseline).length, 2);
  for (const anchor of [{ entityId: 'invented', evidenceId: 'Q001' }, { entityId: 'real-film', evidenceId: 'invented' }, { entityId: 'real-film', evidenceId: 'Q003' }]) {
    assert.throws(() => normalizeDirections([{ ...directions[0], anchors: [anchor] }, directions[1]], { evidence, audiences: [{ id: 'a1' }] }), /actual Qloo evidence/);
  }
  assert.throws(() => normalizeDirections(directions, { evidence }), /unknown audience/);
  assert.throws(() => normalizeDirections([directions[1]]), /two or three/);
});
test('decision attribution cannot promote fabricated or empty Qloo evidence', () => {
  const records = normalizeDecisions([
    { title: 'Linked', sourceType: 'qloo', evidenceIds: ['Q001', 'invented'], selectors: ['#hero'], properties: ['background-color', '--accent'] },
    { title: 'Not measured', sourceType: 'qloo', evidenceIds: ['Q003'] },
  ], evidence);
  assert.equal(records[0].sourceType, 'qloo');
  assert.deepEqual(records[0].evidenceIds, ['Q001']);
  assert.equal(records[1].sourceType, 'model-interpretation');
  assert.deepEqual(records[1].selectors, []);
  assert.throws(() => normalizeDecisions([{ title: 'Unsafe selector', selectors: ['#hero; body{}'] }]), /selector/);
});
test('brand locks enforce exact file bytes and preserve snippet occurrence counts', () => {
  const before = { 'index.html': '<p>Brand</p><footer>Brand</footer>', 'app.js': 'const brand = 1;\n' };
  assert.equal(assertBrandLocks(before, { ...before }, { protectedFiles: ['app.js'], protectedSnippets: [{ path: 'index.html', text: 'Brand' }] }), true);
  assert.throws(() => assertBrandLocks(before, { ...before, 'app.js': before['app.js'] + ' ' }, { protectedFiles: ['app.js'] }), /Brand lock/);
  assert.throws(() => assertBrandLocks(before, { ...before, 'index.html': '<p>Brand</p>' }, { protectedSnippets: [{ path: 'index.html', text: 'Brand' }] }), /Brand lock/);
  assert.throws(() => assertBrandLocks(before, { ...before, 'index.html': before['index.html'] + 'Brand' }, { protectedSnippets: [{ path: 'index.html', text: 'Brand' }] }), /Brand lock/);
  assert.throws(() => assertBrandLocks(before, before, { protectedSnippets: [{ path: 'index.html', text: 'Never present' }] }), /does not exist/);
  assert.throws(() => assertBrandLocks(before, before, { protectedFiles: ['missing.css'] }), /does not exist/);
});
test('file diff reports real additions, deletions and line numbers without unchanged files', () => {
  const result = fileDiff({ 'styles.css': 'a\nb\nc\n', 'old.txt': 'old', 'app.js': 'same' }, { 'styles.css': 'a\nnew\nc\n', 'new.txt': 'new', 'app.js': 'same' });
  assert.deepEqual(result.map(file => [file.path, file.status]), [['new.txt', 'added'], ['old.txt', 'deleted'], ['styles.css', 'modified']]);
  const modified = result[2];
  assert.deepEqual(modified.lines.filter(line => line.type !== 'context'), [{ type: 'removed', beforeLine: 2, text: 'b' }, { type: 'added', afterLine: 2, text: 'new' }]);
  assert.deepEqual(fileDiff({ 'a.txt': 'same' }, { 'a.txt': 'same' }), []);
  assert.deepEqual(result[0].lines, [{ type: 'added', afterLine: 1, text: 'new' }]);
  assert.deepEqual(result[1].lines, [{ type: 'removed', beforeLine: 1, text: 'old' }]);
});
test('large and minified file diffs are bounded and disclose truncation', () => {
  const [large] = fileDiff({ 'a.txt': Array.from({ length: 800 }, (_, i) => 'old ' + i).join('\n') }, { 'a.txt': Array.from({ length: 800 }, (_, i) => 'new ' + i).join('\n') });
  assert.equal(large.truncated, true);
  assert.equal(large.algorithm, 'bounded-replacement');
  assert.equal(large.lines.length, 160);
  assert.ok(large.omittedLines > 0);
  const [minified] = fileDiff({ 'styles.css': 'a'.repeat(1000) }, { 'styles.css': 'b'.repeat(1000) });
  assert.equal(minified.truncated, true);
  assert.ok(minified.lines.every(line => line.text.length <= 501));
});

const html = '<!doctype html><html><head><script>const fake = \'<section id="hero">fake</section>\';</script></head><body><!-- <section id="hero">comment</section> --><nav id="nav">Brand</nav><section id="hero" data-label="a > b"><div><p>Before</p><img src="mark.svg"></div></section><footer id="footer">Foot</footer></body></html>';
test('target scanner balances nested tags, quotes and voids and ignores comments/raw scripts', () => {
  const target = findHtmlTarget(html, '#hero');
  assert.equal(target.html, '<section id="hero" data-label="a > b"><div><p>Before</p><img src="mark.svg"></div></section>');
  assert.equal(html.slice(target.start, target.end), target.html);
  assert.equal(target.tagName, 'section');
  assert.equal(findHtmlTarget('<section id="he&#114;o"><svg><path d="M0 0"/></svg></section>', '#hero').id, 'hero');
});
test('target scanner rejects ambiguous, missing, void and unbalanced targets', () => {
  for (const input of ['<div id="hero"></div><div id="hero"></div>', '<div id="hero" id="other"></div>', '<section id="hero"><div></section>', '<div id="hero"/>', '<img id="hero">']) assert.throws(() => findHtmlTarget(input, '#hero'));
  assert.throws(() => findHtmlTarget(html, '.hero'), /#id/);
  assert.throws(() => findHtmlTarget(html, '#missing'), /exactly once/);
  assert.throws(() => findHtmlTarget('<template><div id="hero"></div></template>', '#hero'), /exactly once/);
});
test('narrow revision changes exactly one region, appends scoped CSS and leaves scripts unchanged', () => {
  const before = { 'index.html': html, 'styles.css': ':root { --brand: red; }', 'app.js': 'workingInteraction();', 'assets/mark.svg': '<svg></svg>' };
  const target = findHtmlTarget(html, '#hero');
  const fragment = '<section id="hero"><h1>After</h1><div class="card">New</div></section>';
  const after = applyScopedRevision(before, { selector: '#hero', fragment, css: '#hero { padding: 2rem; } #hero > .card, #hero h1:hover { color: red; }' });
  assert.equal(after['index.html'], html.slice(0, target.start) + fragment + html.slice(target.end));
  assert.equal(after['app.js'], before['app.js']);
  assert.equal(after['assets/mark.svg'], before['assets/mark.svg']);
  assert.ok(after['styles.css'].startsWith(before['styles.css']));
  assert.equal(before['index.html'], html);
  assertBrandLocks(before, after, { protectedFiles: ['app.js'], protectedSnippets: [{ path: 'index.html', text: '<nav id="nav">Brand</nav>' }] });
});
test('narrow revision rejects fragments escaping the selected root or changing IDs', () => {
  const before = { 'index.html': html, 'app.js': 'same' };
  for (const fragment of ['<section id="other">No</section>', '<section id="hero">Yes</section><aside>Outside</aside>', '<section id="hero"><div id="nav">Collision</div></section>', '<section id="hero"><div id="x"></div><div id="x"></div></section>']) assert.throws(() => applyScopedRevision(before, { selector: '#hero', fragment }));
});
test('narrow revision rejects active HTML that could mutate outside the selected element', () => {
  const before = { 'index.html': html };
  for (const body of ['<script>document.body.remove()</script>', '<div onclick="document.body.remove()">Bad</div>', '<iframe srcdoc="bad"></iframe>', '<a href="java&#115;cript:alert(1)">Bad</a>', '<a href="&#106avascript:alert(1)">Bad</a>', '<a href="java&Tab;script:alert(1)">Bad</a>', '<img srcset="local.svg 1x, https://example.com/x 2x">', '<a href="//example.com">Bad</a>', '<style>body { display:none }</style>', '<svg><set href="#nav" attributeName="display" to="none"/></svg>']) {
    assert.throws(() => applyScopedRevision(before, { selector: '#hero', fragment: `<section id="hero">${body}</section>` }));
  }
});
test('narrow revision rejects global, sibling, hidden and malformed CSS scope escapes', () => {
  const before = { 'index.html': html };
  const fragment = '<section id="hero">After</section>';
  for (const css of ['body { display:none }', '#hero, body { color:red }', '#hero + #nav { color:red }', '#hero ~ footer { color:red }', '#heroic { color:red }', '@import "https://example.com";', '@media (min-width:1px) { #hero { color:red } }', '#hero { background:url(https://example.com/x) }', '#hero { x: 1; & body { color:red } }', '#hero { color:red', '#hero\\2b #nav { color:red }', '#hero { color:red } trailing', '#hero, { color:red }', '{ color:red }']) {
    assert.throws(() => applyScopedRevision(before, { selector: '#hero', fragment, css }), undefined, css);
  }
  assert.doesNotThrow(() => applyScopedRevision(before, { selector: '#hero', fragment, css: '/* Comment */ #hero :is(h1, p) { color: rgb(1, 2, 3); }' }));
});

const applicationRecord = { id: 'r1', evidenceIds: ['Q001'], anchors: [{ evidenceId: 'Q001', entityId: 'real-film', detail: 'Returned film' }], disposition: 'applied',
  application: { kind: 'content', priorApproach: 'A single hero claim.', proposedChange: 'An additional chapter opening.', outputTarget: 'index.html#hero', observableCheck: 'The hero includes a chapter opening.', tradeoff: 'More copy.' } };
const applicationBefore = { 'index.html': '<html><body><section id="hero">Before</section><footer id="footer">Same</footer></body></html>', 'styles.css': '#hero{color:red}' };

test('research application checks require matching prewrite declarations and compare the actual target', () => {
  const snapshots = snapshotResearchApplications([{ ...applicationRecord, disposition: 'considered' }], { beforeFiles: applicationBefore, currentFiles: applicationBefore });
  const afterFiles = { ...applicationBefore, 'index.html': applicationBefore['index.html'].replace('Before', 'A chapter opening') };
  const [check] = verifyResearchApplications([applicationRecord], { beforeFiles: applicationBefore, afterFiles, snapshots });
  assert.equal(check.status, 'checked'); assert.equal(check.planTiming, 'before-write'); assert.equal(check.targetPresence, 'present');
  assert.equal(check.targetFragmentChange, 'changed'); assert.equal(check.artifactChange, 'changed'); assert.equal(check.sourceAnchors, 'recorded');
  assert.match(check.limitation, /does not verify.*quality.*causal impact/u);
  const changedPlan = { ...applicationRecord, application: { ...applicationRecord.application, proposedChange: 'A different plan.' } };
  assert.equal(verifyResearchApplications([changedPlan], { beforeFiles: applicationBefore, afterFiles, snapshots })[0].planTiming, 'untracked');
  const changedAnchor = { ...applicationRecord, anchors: [{ ...applicationRecord.anchors[0], detail: 'Changed detail' }] };
  assert.equal(verifyResearchApplications([changedAnchor], { beforeFiles: applicationBefore, afterFiles, snapshots })[0].planTiming, 'untracked');
  assert.equal(snapshotResearchApplications([applicationRecord], { beforeFiles: applicationBefore, currentFiles: afterFiles })[0].planTiming, 'after-write');
  assert.equal(snapshotResearchApplications([applicationRecord], { beforeFiles: applicationBefore, currentFiles: applicationBefore, changedFiles: ['index.html'] })[0].planTiming, 'after-write', 'Reverting a changed artifact does not restore prewrite timing.');
});

test('research checks label missing targets, unchanged target fragments and legacy records without claiming impact', () => {
  const checks = verifyResearchApplications([
    applicationRecord,
    { ...applicationRecord, id: 'missing', application: { ...applicationRecord.application, outputTarget: 'index.html#missing' } },
    { ...applicationRecord, id: 'portable', application: { ...applicationRecord.application, outputTarget: 'Chapter 2 opening scene' } },
    { id: 'old', decision: 'Legacy decision', evidenceIds: ['Q001'] },
    { ...applicationRecord, id: 'declined', disposition: 'not-applied' },
  ], { beforeFiles: applicationBefore, afterFiles: { ...applicationBefore, 'index.html': applicationBefore['index.html'].replace('Same', 'Changed elsewhere') } });
  assert.equal(checks[0].status, 'no-impact'); assert.equal(checks[0].artifactChange, 'changed'); assert.equal(checks[0].targetFragmentChange, 'unchanged');
  assert.equal(checks[1].targetPresence, 'missing'); assert.equal(checks[1].status, 'unchecked');
  assert.equal(checks[2].targetPresence, 'unsupported'); assert.equal(checks[2].status, 'unchecked');
  assert.equal(checks[3].status, 'legacy'); assert.equal(checks[3].planTiming, 'untracked');
  assert.equal(checks[4].status, 'not-applied'); assert.equal(checks[4].artifactChange, 'not-checked');
  assert.equal(uncheckedResearchVerification(applicationRecord).sourceAnchors, 'unchecked');
});

test('CSS-only presentation checks stay explicit about unchanged HTML and limited specificity', () => {
  const record = { ...applicationRecord, application: { ...applicationRecord.application, kind: 'presentation' } };
  const [check] = verifyResearchApplications([record], { beforeFiles: applicationBefore, afterFiles: { ...applicationBefore, 'styles.css': '#hero{color:blue}' } });
  assert.equal(check.status, 'checked'); assert.equal(check.artifactChange, 'changed'); assert.equal(check.targetFragmentChange, 'unchanged');
  assert.match(check.limitation, /semantic relevance/u);
  const [unchanged] = verifyResearchApplications([record], { beforeFiles: applicationBefore, afterFiles: applicationBefore });
  assert.equal(unchanged.status, 'no-impact');
});

test('JS-only interaction checks report linked file changes without claiming the target interaction was verified', () => {
  const record = { ...applicationRecord, application: { ...applicationRecord.application, kind: 'interaction' } };
  const beforeFiles = { ...applicationBefore, 'index.html': applicationBefore['index.html'].replace('</body>', '<script src="./experience.js"></script></body>'), 'experience.js': 'before();' };
  const afterFiles = { ...beforeFiles, 'experience.js': 'after();' };
  const [check] = verifyResearchApplications([record], { beforeFiles, afterFiles });
  assert.equal(check.status, 'unchecked'); assert.equal(check.artifactChange, 'changed'); assert.equal(check.targetFragmentChange, 'unchanged');
  assert.match(check.limitation, /linked local script changed.*effect on this target was not checked/u);
  const [late] = snapshotResearchApplications([record], { beforeFiles, currentFiles: afterFiles });
  assert.equal(late.planTiming, 'after-write');
  const external = { ...beforeFiles, 'index.html': beforeFiles['index.html'].replace('./experience.js', 'https://example.com/experience.js') };
  assert.equal(verifyResearchApplications([record], { beforeFiles: external, afterFiles: { ...external, 'experience.js': 'after();' } })[0].artifactChange, 'unchanged');
  const unlinkedBefore = { ...applicationBefore, 'experience.js': 'before();' };
  const alreadyChanged = { ...unlinkedBefore, 'experience.js': 'after();' };
  const snapshots = snapshotResearchApplications([record], { beforeFiles: unlinkedBefore, currentFiles: alreadyChanged });
  const newlyLinked = { ...alreadyChanged, 'index.html': alreadyChanged['index.html'].replace('</body>', '<script src="experience.js"></script></body>') };
  assert.equal(verifyResearchApplications([record], { beforeFiles: unlinkedBefore, afterFiles: newlyLinked, snapshots })[0].planTiming, 'after-write', 'Later linking a script does not erase construction that preceded the declaration.');
});
