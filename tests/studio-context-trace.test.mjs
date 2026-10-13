import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual Studio handlers with a small DOM fixture; no service or model calls.
const source = await fs.readFile(new URL('../web/app.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this._text = ''; this.className = ''; this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = [...children]; }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  get childElementCount() { return this.children.filter(child => child instanceof Element).length; }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  closest() { return new Element('label'); }
  scrollIntoView() { this.scrolled = true; }
  querySelectorAll(selector) { return descendants(this).filter(child => selector === '[data-evidence-id]' ? child.dataset.evidenceId : false); }
}
function descendants(element) { return element.children.filter(child => child instanceof Element).flatMap(child => [child, ...descendants(child)]); }
function fixture() {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const radios = ['compare', 'baseline', 'qloo'].map(value => Object.assign(new Element('input'), { value, checked: value === 'compare' }));
  const protectedInputs = ['index.html', 'styles.css', 'app.js'].map(value => Object.assign(new Element('input'), { value, checked: value === 'app.js' }));
  const document = {
    getElementById: get, createElement: tag => new Element(tag), createTextNode: value => String(value), body: new Element('body'),
    querySelector: () => radios.find(input => input.checked),
    querySelectorAll: selector => selector === 'input[name="mode"]' ? radios : selector === '.protected-files input' ? protectedInputs : selector === '.protected-files input:checked' ? protectedInputs.filter(input => input.checked) : selector === '.template-button' ? get('template-grid').children : [],
  };
  const context = vm.createContext({ document, URL, location: { href: 'http://127.0.0.1:8787/', origin: 'http://127.0.0.1:8787' }, history: { replaceState() {} }, window: { addEventListener() {} }, fetch: () => new Promise(() => {}), setTimeout: () => 1, clearTimeout() {}, console });
  vm.runInContext(source, context);
  const handlers = vm.runInContext('({ state, applyCultureBrief, readCultureBrief, selectTemplate, renderRecords, renderInspection, renderTaste, renderDirections, renderControls })', context);
  return { ...handlers, get, document };
}
const templates = [
  { id: 'local-food', name: 'Local food', defaultBrief: 'Design a food shop.', defaultCultureBrief: { brand: { notes: 'Factory food brand' }, audiences: [{ id: 'a1', label: 'Factory audience', references: ['Factory film'] }] } },
  { id: 'indie-game', name: 'Indie game', defaultBrief: 'Design an indie game launch.' },
];
const copy = value => JSON.parse(JSON.stringify(value));
const HOSTED = 'A hosted server has no image generator: Codex runs only on a machine where it is installed and signed in.';

test('switching starters replaces only unchanged factory cultural context', () => {
  const ui = fixture(); ui.state.templates = templates;
  ui.selectTemplate(templates[0]);
  assert.equal(ui.readCultureBrief().brand.notes, 'Factory food brand');
  ui.selectTemplate(templates[1]);
  assert.equal(ui.readCultureBrief().brand.notes, '');
  assert.deepEqual(copy(ui.readCultureBrief().audiences), []);
  assert.equal(ui.get('context-origin-note').hidden, true);
});

test('edited audience references and brand constraints survive starter changes with a visible notice', () => {
  const ui = fixture(); ui.state.templates = templates;
  ui.selectTemplate(templates[0]);
  ui.get('brand-notes').value = 'My intentional brand constraints';
  ui.state.audiences[0].references.push('My intentional film');
  const before = copy(ui.readCultureBrief());
  ui.selectTemplate(templates[1]);
  assert.deepEqual(copy(ui.readCultureBrief()), before);
  assert.equal(ui.get('context-origin-note').hidden, false);
  assert.match(ui.get('context-origin-note').textContent, /Local food.*retained.*Indie game/);
});

test('explicit saved, imported and historical context is retained even when it matches a factory default', () => {
  for (const source of ['workspace', 'imported', 'job']) {
    const ui = fixture(); ui.state.templates = templates; ui.selectTemplate(templates[0]);
    ui.applyCultureBrief(templates[0].defaultCultureBrief, { source, templateId: 'local-food' });
    const archived = { id: 'existing-workspace', templateId: 'local-food', cultureBrief: copy(ui.readCultureBrief()) };
    ui.state.workspace = archived;
    const before = copy(archived);
    ui.selectTemplate(templates[1]);
    assert.deepEqual(copy(ui.readCultureBrief()), before.cultureBrief);
    assert.deepEqual(archived, before);
    assert.equal(ui.state.workspace, null);
    assert.equal(ui.get('context-origin-note').hidden, false);
  }
});

test('invalid unsaved protected snippets are retained rather than silently discarded on starter change', () => {
  const ui = fixture(); ui.state.templates = templates; ui.selectTemplate(templates[0]);
  ui.get('protected-snippets').value = '{unfinished';
  ui.selectTemplate(templates[1]);
  assert.equal(ui.get('protected-snippets').value, '{unfinished');
  assert.equal(ui.get('context-origin-note').hidden, false);
});

function researchFixture(ui, record) {
  const evidence = [{ id: 'Q001', results: [{ entityId: 'real-entity', name: 'Real returned reference' }] }];
  ui.state.status = { previewOrigin: 'http://127.0.0.1:8788' };
  ui.state.job = { runs: [{ mode: 'qloo', evidence, researchDecisions: [record], previewUrl: 'http://127.0.0.1:8788/preview/test/index.html' }] };
  ui.renderRecords(ui.get('panel-evidence'), evidence.map(record => ({ record, mode: 'qloo' })), 'evidence');
  ui.renderRecords(ui.get('panel-decisions'), [{ record, mode: 'qloo' }], 'research');
  return ui.get('panel-decisions');
}
const application = { kind: 'interaction', priorApproach: 'A conventional linear feature list.', proposedChange: 'Let the visitor reveal a route in their chosen order.', outputTarget: 'index.html#route-choice', observableCheck: 'Choose a route and inspect the updated local reading sequence.', tradeoff: 'Visitors need an obvious direct path to the wishlist.' };
const research = { id: 'route', decision: 'Choose a discovery sequence', action: 'research', question: 'Could an exploratory structure support this launch?', evidenceIds: ['Q001'], anchors: [{ evidenceId: 'Q001', entityId: 'real-entity', detail: 'A returned detail, kept separate from interpretation.' }], finding: 'The real response contains a related work.', interpretation: 'The agent interprets that connection as a possible visitor route.', application, disposition: 'applied', changeMade: 'An authored local route control.', verification: { status: 'checked', planTiming: 'before-write', sourceAnchors: 'recorded', targetPresence: 'present', artifactChange: 'changed', targetFragmentChange: 'changed', limitation: 'Record checks do not establish quality or causal impact.' } };

test('application traces expose source links, interpretation, visitor check and bounded verification', () => {
  const ui = fixture(); const panel = researchFixture(ui, research);
  const nodes = descendants(panel);
  for (const expected of ['Initial approach', application.priorApproach, 'Agent interpretation', application.observableCheck, application.tradeoff, 'Record checks do not establish quality or causal impact.']) assert.ok(panel.textContent.includes(expected), expected);
  const anchorButton = nodes.find(node => node.tagName === 'BUTTON' && node.textContent === 'Q001');
  assert.equal(anchorButton.disabled, false);
  anchorButton.listeners.get('click')();
  assert.equal(ui.state.activeTab, 'evidence');
  assert.equal(descendants(ui.get('panel-evidence')).find(node => node.dataset.evidenceId === 'Q001').scrolled, true);
  const target = nodes.find(node => node.className === 'research-target-link');
  assert.equal(new URL(target.href).hash, '#route-choice');
  assert.equal(nodes.some(node => node.className === 'research-status-note' && /Application detail unavailable/.test(node.textContent)), false);
});

test('imported application plans cannot appear as checked live sources or link to a coincidental live evidence ID', () => {
  const ui = fixture(); const panel = researchFixture(ui, { ...research, provenance: 'caller-provided-unverified' });
  const nodes = descendants(panel);
  assert.equal(nodes.find(node => node.tagName === 'BUTTON' && node.textContent === 'Q001').disabled, true);
  assert.match(nodes.find(node => node.className === 'research-status-note').textContent, /source and application were not verified/);
  assert.equal(nodes.some(node => node.className === 'research-checks'), false);
  assert.equal(nodes.some(node => node.className === 'research-target-link'), false);
});

test('historical rationale is labeled insufficient for application tracing and never gets a target shortcut', () => {
  const ui = fixture(); const panel = researchFixture(ui, { id: 'legacy', decision: 'Choose typography', action: 'research', evidenceIds: ['Q001'], finding: 'Calm', interpretation: 'Use a serif.', changeMade: 'Used a serif.', verification: { status: 'legacy', planTiming: 'untracked' } });
  const nodes = descendants(panel);
  assert.match(nodes.find(node => node.className === 'research-status-note').textContent, /Application detail unavailable.*does not establish/);
  assert.equal(nodes.some(node => node.className === 'research-target-link'), false);
});

test('reconsideration and native web sources are visible without mixing equal IDs across comparison arms', () => {
  const ui = fixture();
  const initial = { id: 'discovery', decision: 'Choose how visitors discover the game', initialApproach: 'A linear introduction', alternatives: ['A visitor-led route'], openQuestions: ['Would choosing a route explain exploration?'], fixedFacts: ['The factual game catalogue remains.'] };
  const modes = ['baseline', 'qloo'];
  ui.state.job = { runs: modes.map(mode => ({ mode, events: [], evidence: [], decisions: [], researchDecisions: [], creativePipeline: { status: 'completed' }, provisionalPlan: { decisions: [initial] }, reconsideration: { summary: 'A reconsidered design.', decisions: [{ decisionId: initial.id, outcome: mode === 'qloo' ? 'replace' : 'keep', reason: 'An explicitly authored interpretation.', approach: mode === 'qloo' ? 'Visitor-led route' : 'Linear introduction', webSourceIds: ['W001'], evidenceIds: [], rejectedAlternatives: [], limitations: [] }] }, webCalls: [{ tool: 'web_fetch', status: 'ok' }], webSources: [{ id: 'W001', title: `${mode} source`, url: 'https://kiro.dev/docs/', tool: 'web_fetch', excerpt: `Literal ${mode} content.` }] })) };
  ui.renderInspection();
  assert.match(ui.get('panel-decisions').textContent, /Provisional approach.*linear introduction/i);
  assert.match(ui.get('panel-decisions').textContent, /Kept/);
  assert.match(ui.get('panel-decisions').textContent, /Replaced/);
  assert.match(ui.get('panel-evidence').textContent, /Fetched page content.*Literal baseline content/);
  assert.equal(ui.get('evidence-count').textContent, '2');
  const buttons = descendants(ui.get('panel-decisions')).filter(element => element.tagName === 'BUTTON' && element.textContent === 'W001');
  buttons[1].listeners.get('click')();
  const sources = descendants(ui.get('panel-evidence')).filter(element => element.dataset.evidenceId === 'W001');
  assert.equal(sources.find(element => element.dataset.evidenceMode === 'qloo').scrolled, true);
  assert.equal(sources.find(element => element.dataset.evidenceMode === 'baseline').scrolled, undefined);
});

test('web sources remain in an unverified imported research bundle through Studio context round trips', () => {
  const ui = fixture(); const source = { id: 'W001', url: 'https://kiro.dev/docs/', title: 'Imported source', excerpt: 'Caller-supplied text', status: 'ok' };
  ui.applyCultureBrief({ webSources: [source], researchDecisions: [], audiences: [] }, { source: 'imported' });
  const roundTrip = copy(ui.readCultureBrief());
  assert.equal(roundTrip.importedResearch.provenance, 'caller-provided-unverified');
  assert.deepEqual(roundTrip.importedResearch.webSources, [source]);
});

function tasteJob() {
  const entities = [
    { ref: 'movie-deep-2', name: 'Fixture Animated Essay', domain: 'movie', source: 'qloo', band: 'deep-cut', affinity: 0.55, popularity: 0.3, surprise: true, predictedByModel: false, evidenceId: 'Q007' },
    { ref: 'movie-core-0', name: 'Fixture Film Alpha', domain: 'movie', source: 'qloo', affinity: 0.95, surprise: false, predictedByModel: true, evidenceId: 'Q006' },
    { ref: 'M01', name: 'Fixture Film Alpha', domain: 'movie', source: 'model-assumption', confirmedBy: 'movie-core-0' },
    { ref: 'M02', name: 'Lost in Translation', domain: 'movie', source: 'model-assumption' },
  ];
  const qloo = { mode: 'qloo', status: 'completed', events: [], evidence: [], decisions: [], tastePipeline: { status: 'completed' }, taste: {
    profile: { status: 'ok', entities: entities.slice(0, 2), seeds: [{ name: 'Blade Runner', resolution: 'entity', matchedName: 'Blade Runner' }, { name: 'Unknown Zine', resolution: 'unresolved' }] },
    assumption: { entries: [{ id: 'M01', domain: 'movie', name: 'Fixture Film Alpha' }, { id: 'M02', domain: 'movie', name: 'Lost in Translation' }] },
    input: { source: 'qloo-profile', requiredAnchors: ['movie-deep-2'], entities, metrics: { measuredEntities: 2, predictedByModel: 1, knownFromBrief: 0, surprises: 1, predictions: 2, predictionsConfirmed: 1 } },
    dna: { devices: [{ id: 'dna1', layer: 'palette', device: 'Ink and brass', anchors: ['movie-deep-2'], tokens: { colors: ['#1d1a17', '#c9a227'], fonts: [], css: [], ids: [], copy: [] } },
      { id: 'dna2', layer: 'typography', device: 'Book serif', anchors: ['M01'], tokens: { colors: [], fonts: ['Georgia'], css: [], ids: [], copy: [] } }], stats: { devices: 2, surpriseAnchoredDevices: 1 } },
    conformance: { score: 0.75, present: 1, partial: 1, missing: 0, meetsThreshold: true, devices: [{ id: 'dna1', status: 'present' }, { id: 'dna2', status: 'partial' }] } } };
  const baseline = { mode: 'baseline', status: 'completed', events: [], evidence: [], decisions: [], tastePipeline: { status: 'completed' }, taste: {
    profile: null, assumption: { entries: [{ id: 'M01', domain: 'movie', name: 'Lost in Translation' }] },
    input: { source: 'model-assumption', requiredAnchors: ['M01'], entities: [{ ref: 'M01', name: 'Lost in Translation', domain: 'movie', source: 'model-assumption' }], metrics: { predictions: 1 } }, dna: null, conformance: null } };
  return { id: 'job-taste', status: 'completed', kind: 'build', protocol: 'taste', runs: [baseline, qloo], tasteComparison: {
    headline: '1 of 2 design devices in the Qloo on design rest on entities the model did not predict.', detail: 'The model predicted 1 of 2 measured entities before seeing them; 1 were new to it.',
    distance: { overall: 0.71, palette: 1, typography: 1, structure: 0.5, features: 0.2 }, qloo: { surpriseShare: 0.5, prediction: { predictions: 2, predictionsConfirmed: 1 }, conformance: 0.75 }, baseline: { conformance: 1 },
    limitation: 'One pair. Compare repeated pairs before claiming the difference exceeds model variance.' } };
}

test('the taste panel shows the frozen prediction, measured surprises, binding DNA and the comparison headline', () => {
  const ui = fixture(); ui.state.job = tasteJob();
  ui.renderTaste();
  assert.equal(ui.get('taste-panel').hidden, false);
  assert.match(ui.get('taste-headline').textContent, /^1 of 2 design devices in the Qloo on design/);
  assert.match(ui.get('taste-detail').textContent, /predicted 1 of 2/);
  const nodes = descendants(ui.get('taste-grid'));
  const columns = nodes.filter(node => /^taste-column /.test(node.className));
  assert.deepEqual(columns.map(node => node.className), ['taste-column baseline', 'taste-column qloo']);
  assert.match(columns[0].textContent, /Model assumed/); assert.doesNotMatch(columns[0].textContent, /Qloo measured/);
  assert.match(columns[1].textContent, /Qloo measured/); assert.match(columns[1].textContent, /Blade Runner · Unknown Zine \(unresolved\)/);
  const surprise = nodes.find(node => node.className === 'taste-chip surprise required');
  assert.match(surprise.textContent, /^✦ Not predicted: +Fixture Animated Essay required anchor$/u, 'A surprise has a visible mark and spoken text, not color alone.');
  assert.equal(descendants(surprise).find(node => node.className === 'taste-mark').attributes.get('aria-hidden'), 'true');
  assert.match(surprise.title, /affinity 0\.55.*lesser-known/);
  assert.ok(nodes.some(node => node.className === 'taste-chip matched' && /confirmed by Qloo/.test(node.textContent)));
  const dna = nodes.find(node => node.className === 'dna-chip surprise');
  assert.match(dna.textContent, /Qloo surprise/); assert.match(dna.textContent, /In the site/); assert.match(dna.textContent, /Fixture Animated Essay · Qloo, not predicted · affinity 0\.55/);
  assert.deepEqual(nodes.filter(node => node.className === 'dna-swatch').map(node => node.attributes.get('style')), ['--swatch:#1d1a17', '--swatch:#c9a227']);
  assert.ok(nodes.some(node => node.className === 'dna-chip' && /Partly in the site/.test(node.textContent) && /model prediction/.test(node.textContent)));
  assert.match(columns[1].textContent, /DNA conformance 75%/);
  assert.equal(ui.get('taste-metrics').hidden, false);
  assert.match(ui.get('taste-metrics').textContent, /0\.71/); assert.match(ui.get('taste-metrics').textContent, /1 \/ 2/);
  assert.match(ui.get('taste-note').textContent, /only the taste source differs.*Compare repeated pairs/);
  ui.state.job = { ...tasteJob(), protocol: 'research' }; ui.renderTaste();
  assert.equal(ui.get('taste-panel').hidden, true);
});

test('the taste panel shows each run\'s frozen design sketch and what the saved site changed from it', () => {
  const ui = fixture(); const job = tasteJob();
  const sketch = { summary: 'A pocket notebook beside a turning record.', palette: ['#f1ece1', '#26241f', '#9a3b2b'], fonts: ['Iowan Old Style', 'Courier New'], sections: ['hero', 'notes', 'shelf'], motifs: ['vinyl record'] };
  for (const run of job.runs) run.taste.assumption = { ...run.taste.assumption, designSketch: sketch };
  const [baseline, qloo] = job.runs;
  qloo.taste.sketchDivergence = { score: 0.667, typography: 1, palette: 0.5, structure: 0.5, fonts: { new: ['Futura'], kept: [] } };
  baseline.taste.sketchDivergence = { score: 0, typography: 0, palette: 0, structure: 0, fonts: { new: [], kept: ['Iowan Old Style', 'Courier New'] } };
  qloo.taste.dna.devices[0] = { ...qloo.taste.dna.devices[0], qualities: ['Black And Silver Palette'], novel: { colors: ['#c9a227'], fonts: [], ids: ['island-map'] } };
  qloo.taste.dna.devices[1] = { ...qloo.taste.dna.devices[1], qualities: ['Assumed calm'] };
  job.tasteComparison = { ...job.tasteComparison, sketchHeadline: 'Against each run\'s own frozen sketch, the Qloo on site moved 67% of its type, color and section tokens; the Qloo off site moved 0%.',
    qloo: { ...job.tasteComparison.qloo, sketch: qloo.taste.sketchDivergence }, baseline: { ...job.tasteComparison.baseline, sketch: baseline.taste.sketchDivergence } };
  ui.state.job = job; ui.renderTaste();
  const nodes = descendants(ui.get('taste-grid'));
  const columns = nodes.filter(node => /^taste-column /.test(node.className));
  for (const column of columns) {
    assert.match(column.textContent, /Design the model would make · frozen with it/); assert.match(column.textContent, /A pocket notebook beside a turning record\./);
    assert.match(column.textContent, /Type · Iowan Old Style · Courier New/); assert.match(column.textContent, /Sections · #hero · #notes · #shelf/); assert.match(column.textContent, /Motifs · vinyl record/);
  }
  assert.match(columns[0].textContent, /Saved site against this sketch · 0% moved/); assert.match(columns[0].textContent, /Kept Iowan Old Style, Courier New/);
  assert.match(columns[1].textContent, /Saved site against this sketch · 67% moved: type 100%, colors 50%, sections 50%/); assert.match(columns[1].textContent, /New type Futura/);
  const dna = nodes.find(node => node.className === 'dna-chip surprise');
  assert.match(dna.textContent, /Translates Black And Silver Palette/); assert.match(dna.textContent, /New against the model’s sketch · #c9a227 · #island-map/);
  const own = nodes.find(node => node.className === 'dna-chip' && /model prediction/.test(node.textContent));
  assert.match(own.textContent, /Model’s own qualities · Assumed calm/); assert.doesNotMatch(own.textContent, /Translates/, 'Free-text qualities are not presented as returned tags.');
  assert.match(ui.get('taste-detail').textContent, /predicted 1 of 2.*Qloo on site moved 67%/);
  assert.match(ui.get('taste-metrics').textContent, /0% · 67%.*moved from the model’s own frozen sketch/);
});

test('the taste panel says how much starter copy each voice rewrote and how many sentences the two sites share', () => {
  const ui = fixture(); const job = tasteJob();
  const [baseline, qloo] = job.runs;
  qloo.taste.narrative = { lines: 16, rewritten: 14, kept: [{ field: 'addMessage', text: 'Added to your list.' }] };
  baseline.taste.narrative = { lines: 16, rewritten: 9, kept: [] };
  job.tasteComparison = { ...job.tasteComparison, copyHeadline: 'The two sites share 4 of 120 sentences word for word. Qloo on rewrote 14 of 16 starter narrative lines and Qloo off 9.' };
  ui.state.job = job; ui.renderTaste();
  const columns = descendants(ui.get('taste-grid')).filter(node => /^taste-column /.test(node.className));
  assert.match(columns[0].textContent, /Copy · 9 of 16 starter lines rewritten in the DNA's voice/);
  assert.match(columns[1].textContent, /Copy · 14 of 16 starter lines rewritten in the DNA's voice/);
  assert.match(ui.get('taste-detail').textContent, /predicted 1 of 2.*The two sites share 4 of 120 sentences word for word\./);
});

test('the taste panel shows shared qualities with their spread and how many devices translate them', () => {
  const ui = fixture(); const job = tasteJob();
  const qloo = job.runs[1];
  const quality = { ref: 'quality:look:atmospheric', name: 'Atmospheric', domain: 'qualities', source: 'qloo', band: 'derived', family: 'look', count: 5, domains: ['movie', 'artist', 'tv_show'],
    score: 13.35, affinity: 0.89, examples: ['Fixture Film Alpha', 'Fixture Ambient Duo', 'Fixture Kitchen Series'], evidenceIds: ['Q006', 'Q007'], tags: ['Atmospheric'], surprise: true, predictedByModel: false };
  qloo.taste.input = { ...qloo.taste.input, entities: [...qloo.taste.input.entities, quality], requiredAnchors: [...qloo.taste.input.requiredAnchors, quality.ref],
    metrics: { ...qloo.taste.input.metrics, measuredQualities: 1, qualitiesPredicted: 0, qualitySurprises: 1, qualityPredictions: 3 } };
  qloo.taste.dna.devices[0] = { ...qloo.taste.dna.devices[0], anchors: [quality.ref], qualities: ['Atmospheric'] };
  job.tasteComparison = { ...job.tasteComparison, qualityHeadline: '1 of 2 Qloo on devices translate measured qualities; 1 of 2 Qloo off devices translate qualities the model predicted.' };
  ui.state.job = job; ui.renderTaste();
  const nodes = descendants(ui.get('taste-grid'));
  const chip = nodes.find(node => /^taste-chip/.test(node.className) && /Atmospheric/.test(node.textContent));
  assert.equal(chip.className, 'taste-chip surprise required');
  assert.match(chip.textContent, /Atmospheric look · 5 works · 3 domains · required anchor$/);
  assert.match(chip.title, /^Mean Qloo affinity of the works carrying it 0\.89 · for example Fixture Film Alpha, Fixture Ambient Duo, Fixture Kitchen Series$/);
  assert.ok(nodes.some(node => node.className === 'taste-domain-label' && node.textContent === 'Qualities'));
  assert.match(nodes.find(node => node.className === 'dna-chip surprise').textContent, /Translates Atmospheric.*Anchored to Atmospheric · Qloo, not predicted · look quality of 5 works · affinity 0\.89/);
  assert.match(ui.get('taste-detail').textContent, /1 of 2 Qloo on devices translate measured qualities; 1 of 2 Qloo off devices translate qualities the model predicted\./);
  // Before the comparison exists, the summary reads the Qloo on run's own stats and metrics.
  delete job.tasteComparison; qloo.taste.dna.stats = { ...qloo.taste.dna.stats, qualityAnchoredDevices: 1 };
  ui.state.job = { ...job }; ui.renderTaste();
  assert.match(ui.get('taste-headline').textContent, /rest on entities or qualities the model did not predict\.$/);
  assert.match(ui.get('taste-detail').textContent, /The measured works share 1 quality; 1 were new to it\. 1 of 2 Qloo on devices translate measured qualities\.$/);
});

test('Design DNA chips show the library photos a device chose, with their IDs as the text', () => {
  const ui = fixture(); const job = { ...tasteJob(), templateId: 'local-food' };
  job.runs[1].taste.dna.devices.push({ id: 'dna3', layer: 'imagery', device: 'Duotone product photographs', anchors: ['movie-deep-2'], qualities: ['Moody'],
    tokens: { colors: ['#1d1a17', '#c9a227'], fonts: [], css: [], ids: [], copy: [], images: ['library/olive-oil-2.jpg', 'library/jam-1.jpg', 'https://example.com/photo.jpg'] } });
  ui.state.job = job; ui.renderTaste();
  const nodes = descendants(ui.get('taste-grid'));
  const strip = nodes.find(node => node.className === 'dna-photos');
  assert.equal(strip.attributes.get('aria-hidden'), 'true', 'The photo IDs beside the thumbnails are their text alternative.');
  assert.deepEqual(strip.children.map(image => [image.tagName, image.attributes.get('src'), image.attributes.get('alt')]),
    [['IMG', '/library/local-food/olive-oil-2.jpg', ''], ['IMG', '/library/local-food/jam-1.jpg', '']], 'Only library paths become thumbnails.');
  assert.ok(nodes.some(node => node.className === 'dna-tokens' && node.textContent === 'Photos olive-oil-2 · jam-1'));
  assert.match(nodes.find(node => node.className === 'dna-chip surprise' && /Duotone/.test(node.textContent)).textContent, /Translates Moody/);
});

test('generated images show a preview-origin thumbnail, their device, use and the host prompt', () => {
  const ui = fixture(); const job = tasteJob();
  ui.state.status = { previewOrigin: 'http://127.0.0.1:8788' };
  const image = { path: 'generated/dna3-1.jpg', device: 'dna3', subject: 'Olive oil bottles on a dark counter at night', width: 1536, height: 1024, used: true, durationMs: 41000, provider: 'codex', version: '0.160.0',
    prompt: 'Use your built-in image generation tool to create exactly one image.\nSubject: Olive oil bottles on a dark counter at night' };
  job.runs[1].generatedImages = [{ ...image, url: 'http://127.0.0.1:8788/preview/job-taste/qloo/token/generated/dna3-1.jpg' },
    { ...image, path: 'generated/dna3-2.jpg', used: false, url: 'https://elsewhere.example/generated/dna3-2.jpg' }];
  ui.state.job = job; ui.renderTaste();
  const nodes = descendants(ui.get('taste-grid'));
  const items = nodes.filter(node => node.className === 'generated-item');
  assert.equal(items.length, 2);
  const [first, second] = items.map(item => descendants(item));
  const thumbnail = first.find(node => node.tagName === 'IMG');
  assert.equal(thumbnail.attributes.get('src'), 'http://127.0.0.1:8788/preview/job-taste/qloo/token/generated/dna3-1.jpg');
  assert.equal(thumbnail.attributes.get('alt'), image.subject); assert.equal(thumbnail.attributes.get('height'), '75');
  assert.equal(second.some(node => node.tagName === 'IMG'), false, 'A URL outside the preview origin is not shown.');
  assert.match(items[0].textContent, /dna3-1\.jpg · from dna3/); assert.match(items[0].textContent, /In the site · 41 s · Codex 0\.160\.0/);
  assert.match(items[1].textContent, /Not used in the site/);
  assert.equal(first.find(node => node.tagName === 'PRE').textContent, image.prompt);
  assert.ok(nodes.some(node => node.tagName === 'H4' && node.textContent === 'Generated images · prompts written from DNA devices'));
  // A server without a generator, such as a hosted one, says where the recorded pictures were made.
  ui.state.status = { previewOrigin: 'http://127.0.0.1:8788', images: { available: false, reason: HOSTED } };
  ui.state.job = { ...job }; ui.renderTaste();
  assert.ok(descendants(ui.get('taste-grid')).some(node => node.tagName === 'H4' && node.textContent === 'Generated images · prompts written from DNA devices · recorded with local image generation'));
});

test('without an image generator the form says why and how the plans make imagery, and offers no image study', () => {
  const ui = fixture();
  ui.state.status = { protocol: 'taste', production: { stages: true }, images: { available: false, reason: HOSTED } };
  ui.renderControls();
  assert.equal(ui.get('site-images-hint').hidden, false);
  assert.equal(ui.get('site-images-hint').textContent, `No generated pictures here. ${HOSTED} Each designer’s plan makes its imagery with methods that need no generator.`);
  assert.equal(ui.get('study-images-field').hidden, true);
  ui.state.status = { protocol: 'taste', production: { stages: true }, images: { available: true, provider: 'codex' } };
  ui.renderControls();
  assert.deepEqual([ui.get('site-images-hint').hidden, ui.get('study-images-field').hidden], [true, false]);
});

test('the taste panel shows each run\'s reading, production plan and self-review, the host audit and the methods both could choose', () => {
  const ui = fixture(); const job = tasteJob();
  ui.state.status = { previewOrigin: 'http://127.0.0.1:8788' };
  const qloo = job.runs[1];
  qloo.production = {
    reading: { clusters: [{ id: 'c1', name: 'Ink at dusk', refs: ['movie-deep-2', 'M01'], layers: ['palette', 'typography'], reading: 'Test-only: these share an inked, dusky look.', surprise: true }],
      setAside: [{ ref: 'M02', reason: 'Test-only: a label outside the shared taste.' }], approach: 'Test-only: the palette carries the dusk and the type its ink.' },
    plan: { steps: [{ device: 'dna1', layer: 'palette', method: 'css-palette', cluster: 'c1', why: 'Test-only: two custom properties carry it.' },
      { device: 'dna2', layer: 'typography', method: 'library-font', cluster: 'c1', why: 'Test-only: a library serif.' },
      { device: 'dna3', layer: 'imagery', method: 'generated-image', count: 2, fallback: 'css-art', cluster: 'c1', why: 'Test-only: pictures of the dusk.' }],
      review: [{ id: 'r1', device: 'dna1', look: 'Test-only: the brass reads against the ink at desktop width.', view: 'desktop' }] },
    captures: [{ id: 'r1-desktop', view: 'desktop', round: 1, width: 1440, height: 900, url: 'http://127.0.0.1:8788/preview/job-taste/qloo/token/__review/r1-desktop.png' },
      { id: 'r1-mobile-top', view: 'mobile', round: 1, width: 390, height: 844, target: 'top', url: 'https://elsewhere.example/__review/r1-mobile-top.png' }],
    reviews: [{ round: 1, criteria: [{ id: 'r1', capture: 'r1-desktop', verdict: 'partly', observed: 'Test-only: the brass is faint.', repair: 'Test-only: deepen the brass.' }], summary: 'Test-only: one repair.', repairs: { site: true } }],
    audit: { rounds: 1, captures: 2, cited: ['r1-desktop'], audited: true, opened: ['r1-desktop'], unopened: [], afterLastReview: { site: false } },
  };
  job.production = { medium: 'web', environment: 'hosted', required: [], capture: { available: true, rounds: 2 },
    methods: [{ id: 'css-palette', available: true }, { id: 'library-font', available: true }, { id: 'generated-image', available: false, reason: 'A hosted server has no image generator: Codex runs only on a machine where it is installed and signed in.' }] };
  job.tasteComparison = { ...job.tasteComparison, productionHeadline: 'The plans make 1 layer differently: imagery by css-art in Qloo off and generated-image in Qloo on.',
    production: { baseline: { review: null, criteria: 0 }, qloo: { review: { rounds: 1, met: 0, partly: 1, missed: 0 }, criteria: 1 } } };
  ui.state.job = job; ui.renderTaste();
  const nodes = descendants(ui.get('taste-grid'));
  const columns = nodes.filter(node => /^taste-column /.test(node.className));
  assert.doesNotMatch(columns[0].textContent, /Reading ·|Production plan ·|Self-review ·/, 'A run without production stages shows none.');
  assert.match(columns[1].textContent, /Reading · the model’s own judgment of its taste input.*Design DNA · binding specification.*Production plan · how each device is made.*Self-review · captures the model opened and judged/);
  assert.match(nodes.find(node => node.className === 'reading-cluster surprise').textContent, /^palette · typography Gathers a Qloo surprise Ink at dusk Test-only: these share an inked, dusky look\. Gathers Fixture Animated Essay · Fixture Film Alpha$/);
  assert.match(columns[1].textContent, /Set aside · Lost in Translation: Test-only: a label outside the shared taste\./);
  const steps = nodes.filter(node => node.className === 'plan-step');
  assert.deepEqual(steps.map(step => step.textContent), ['palette css-palette Ink and brass Realizes Ink at dusk · Test-only: two custom properties carry it.',
    'typography library-font Book serif Realizes Ink at dusk · Test-only: a library serif.', 'imagery generated-image · 2 pictures · fallback css-art dna3 Realizes Ink at dusk · Test-only: pictures of the dusk.']);
  assert.ok(nodes.some(node => node.className === 'plan-method generator'));
  assert.match(columns[1].textContent, /Review criteria · r1 \(desktop\) Test-only: the brass reads against the ink at desktop width\./);
  const shots = nodes.filter(node => node.className === 'review-shot');
  const image = descendants(shots[0]).find(node => node.tagName === 'IMG');
  assert.equal(image.attributes.get('src'), 'http://127.0.0.1:8788/preview/job-taste/qloo/token/__review/r1-desktop.png');
  assert.equal(image.attributes.get('alt'), 'Capture r1-desktop: the Qloo on site, 1440 by 900 pixels');
  assert.deepEqual([image.attributes.get('width'), image.attributes.get('height')], ['150', '94']);
  assert.equal(descendants(shots[0]).find(node => node.tagName === 'A').attributes.get('rel'), 'noopener noreferrer');
  assert.equal(descendants(shots[1]).some(node => node.tagName === 'IMG'), false, 'A capture URL outside the preview origin is not shown.');
  assert.match(shots[1].textContent, /r1-mobile-top/);
  assert.equal(nodes.find(node => node.className === 'review-verdict partly').textContent,
    'Partly r1 on r1-desktop Wanted · Test-only: the brass reads against the ink at desktop width. Saw · Test-only: the brass is faint. Repair · Test-only: deepen the brass.');
  assert.match(columns[1].textContent, /The site changed before the next capture\..*Host audit · the session’s read tool opened 1 of the 1 captures its reviews cite\. The site did not change after the last review\./);
  assert.match(ui.get('taste-detail').textContent, /The plans make 1 layer differently: imagery by css-art in Qloo off and generated-image in Qloo on\.$/);
  assert.match(ui.get('taste-metrics').textContent, /— · 0\/1 own review criteria met at the last self-review/);
  assert.match(ui.get('taste-note').textContent, /Both designers chose how to make each device from the same 2 methods; generated-image is off: A hosted server has no image generator: Codex runs only on a machine where it is installed and signed in\. Each reviews captures of its saved site in up to 2 rounds\. One pair\./);
  qloo.production = { ...qloo.production, audit: { rounds: 1, captures: 2, cited: ['r1-desktop'], audited: false } };
  ui.state.job = { ...job }; ui.renderTaste();
  assert.match(descendants(ui.get('taste-grid')).filter(node => /^taste-column /.test(node.className))[1].textContent, /Host audit · no Kiro session record, so the reviews are recorded as unaudited\./);
});

test('taste-led direction cards label the model default and its measured support', () => {
  const ui = fixture();
  const anchors = [{ ref: 'movie-deep-2', name: 'Fixture Animated Essay', domain: 'movie', source: 'qloo', affinity: 0.55, surprise: true, required: true }, { ref: 'M02', name: 'Lost in Translation', domain: 'movie', source: 'model-assumption' }];
  const direction = (id, basis) => ({ id, basis, title: `Direction ${id}`, summary: 'Test-only summary.', anchors: basis === 'model-default' ? anchors.slice(1) : anchors, devices: [{ layer: 'palette', device: 'Ink and brass' }], changes: [{ selector: '#hero', change: 'Test change' }], tradeoffs: [], audienceIds: [] });
  ui.state.planJob = { id: 'plan-1', status: 'completed', kind: 'plan', protocol: 'taste', runs: [{ mode: 'qloo', status: 'completed', evidence: [], directions: [direction('d0', 'model-default'), direction('d1', 'taste-input')],
    taste: { directionScores: { recommendedId: 'd1', modelDefaultId: 'd0', scores: [{ id: 'd0', support: 0 }, { id: 'd1', support: 0.28, surpriseAnchors: 1 }] } } }] };
  ui.renderDirections();
  const cards = ui.get('direction-list').children;
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /Model default · from its own prediction/); assert.match(cards[0].textContent, /Measured Qloo support 0(?!\.)/);
  assert.match(cards[1].textContent, /From the taste input/); assert.match(cards[1].textContent, /Measured Qloo support 0\.28 · highest of the four · 1 unpredicted anchor/);
  assert.match(cards[1].textContent, /Fixture Animated Essay · Qloo, not predicted · affinity 0\.55/);
  assert.match(cards[1].textContent, /palette · Ink and brass/);
});

test('evidence cards name a taste-pass request that was sent with the entity seeds alone', () => {
  const ui = fixture();
  ui.state.job = { runs: [{ mode: 'qloo', evidence: [] }] };
  const record = (id, tastePass) => ({ id, tool: 'qloo_get_insights', results: [], tastePass });
  ui.renderRecords(ui.get('panel-evidence'), [record('Q001', { stage: 'insights', domain: 'style', band: 'core', seeds: 'entities' }), record('Q002', { stage: 'insights', domain: 'artist', band: 'core' })]
    .map(item => ({ record: item, mode: 'qloo' })), 'evidence');
  const titles = descendants(ui.get('panel-evidence')).filter(node => node.tagName === 'H4').map(node => node.textContent);
  assert.match(titles[0], /^Q001 · Cultural connections · .+ · entity seeds only · host taste pass$/);
  assert.match(titles[1], /^Q002 · Cultural connections · .+ · host taste pass$/); assert.doesNotMatch(titles[1], /entity seeds only/);
});
