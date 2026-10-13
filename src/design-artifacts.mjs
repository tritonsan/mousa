import { validateProjectPath } from './project.mjs';
import { normalizeCreativeContext, normalizeResearchDecisions, normalizeWebSources } from '../plugin/server/culture/policy.mjs';
import { compileCultureBrief } from '../plugin/server/culture/brief.mjs';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const objectInput = value => value && typeof value === 'object' && !Array.isArray(value);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/;
const TARGET_ID = /^[a-zA-Z_][a-zA-Z0-9_-]{0,119}$/;
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const FORBIDDEN_FRAGMENT = new Set(['html', 'head', 'body', 'script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'template', 'noscript', 'animate', 'animatemotion', 'animatetransform', 'set']);
const CULTURE_ARTIFACT_FILES = new Set(['culture-brief.json', 'culture-imported-context.json', 'culture-preparation.json', 'culture-plan.json',
  'culture-reconsideration.json', 'culture-directions.json', 'culture-revision.json', 'culture-decisions.json', 'culture-research.json',
  'culture-assumption.json', 'culture-taste.json', 'culture-dna.json', 'culture-library.json', 'culture-fonts.json',
  // The production stages: the host's capability list, then the model's reading, production plan and review.
  'culture-capabilities.json', 'culture-reading.json', 'culture-production.json', 'culture-review.json']);
export const isCultureArtifactPath = value => CULTURE_ARTIFACT_FILES.has(value);

/**
 * A taste pass records many full Qloo responses. The portable brief keeps only the records its decisions
 * cite, trimmed to the cited fields, so it stays inside the plugin's bounded JSON limits.
 */
export function portableTasteRecords({ evidence = [], decisions = [] } = {}) {
  const cited = new Set(decisions.flatMap(decision => decision.evidenceIds || []));
  // Research anchors quote a returned name, description or tag, so those rows keep their literal fields.
  const quoted = new Set(decisions.flatMap(decision => Array.isArray(decision.anchors) ? decision.anchors.map(anchor => anchor?.entityId) : []));
  const anchored = new Set([...decisions.flatMap(decision => decision.anchorEntityIds || []), ...quoted]);
  const kept = evidence.filter(record => cited.has(record?.id)).slice(0, 10).map(record => ({
    id: record.id, tool: record.tool, status: record.status, ...(record.time ? { time: record.time } : {}),
    ...(record.tastePass ? { tastePass: record.tastePass } : {}), ...(record.reusedFrom ? { reusedFrom: record.reusedFrom } : {}),
    results: [...(record.results || []).filter(row => anchored.has(row?.entityId)), ...(record.results || []).filter(row => !anchored.has(row?.entityId))].slice(0, 8)
      .map(({ entityId, name, type, affinity, popularity, description, tags }) => ({ entityId, name, ...(type ? { type } : {}),
        ...(affinity !== undefined ? { affinity } : {}), ...(popularity !== undefined ? { popularity } : {}),
        ...(quoted.has(entityId) && typeof description === 'string' ? { description } : {}),
        ...(quoted.has(entityId) && Array.isArray(tags) ? { tags: tags.slice(0, 8).map(tag => ({ id: tag?.id, name: tag?.name })) } : {}) })),
    ...(record.evidence ? { evidence: { id: record.evidence.id, provider: record.evidence.provider, endpoint: record.evidence.endpoint, retrievedAt: record.evidence.retrievedAt, resultCount: record.evidence.resultCount } } : {}),
  }));
  const ids = new Set(kept.map(record => record.id));
  return { evidence: kept, decisions: decisions.map(decision => ({ ...decision, evidenceIds: (decision.evidenceIds || []).filter(id => ids.has(id)) })) };
}

/** Portable records for any run: taste-pass responses are compacted to the cited ones; other evidence stays as recorded. */
export function portableRunRecords({ evidence = [], decisions = [], researchDecisions = [] } = {}) {
  if (!evidence.some(record => record?.tastePass)) return { evidence, decisions };
  const compacted = portableTasteRecords({ evidence: evidence.filter(record => record?.tastePass), decisions: [...decisions, ...researchDecisions] }).evidence;
  const kept = [...compacted, ...evidence.filter(record => !record?.tastePass)];
  const ids = new Set(kept.map(record => record.id));
  return { evidence: kept, decisions: decisions.map(decision => ({ ...decision, evidenceIds: (decision.evidenceIds || []).filter(id => ids.has(id)) })) };
}

/**
 * Text of the host taste record within the project file limit. A real profile's long descriptions once pushed the
 * record past the limit and failed a finished run; descriptions go first because the Studio job record keeps them.
 */
export function tasteRecordText(record, maxBytes) {
  const text = JSON.stringify(record, null, 2);
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const entities = (record.input?.entities || []).map(({ description, ...entity }) => { void description; return entity; });
  return JSON.stringify({ ...record, input: { ...record.input, entities },
    limitations: ['Entity descriptions were omitted from this file to fit the project file limit; the Studio job record keeps them.'] });
}

function fail(message) { throw new Error(message); }
function text(value, name, limit, { optional = false, trim = true } = {}) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) fail(`Invalid ${name}.`);
  const result = trim ? value.trim() : value;
  if (!optional && !result.trim()) fail(`${name} must not be empty.`);
  return result;
}
function list(value, name, limit, { optional = true } = {}) {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) fail(`Invalid ${name}; maximum ${limit} items.`);
  return value;
}
function parsed(value, name) {
  if (typeof value !== 'string') return value;
  if (value.length > 100000) fail(`${name} is too large.`);
  try { return JSON.parse(value); } catch { fail(`${name} must contain valid JSON.`); }
}
function selectorValue(value) {
  const result = text(value, 'selector', 200);
  if (/[\0-\x1f{};@\\]/.test(result) || /<|>\s*<|\/\*/.test(result)) fail('Invalid selector.');
  return result;
}
function stringList(value, name, limit, itemLimit) {
  return [...new Set(list(value, name, limit).map(item => text(item, name, itemLimit)))];
}

/** Defaults are deliberately unlocked; callers opt into brand protection explicitly. */
export function normalizeCultureBrief(input, { templateId, brief } = {}) {
  void templateId; void brief;
  const source = parsed(input ?? {}, 'Culture brief');
  if (!objectInput(source)) fail('Culture brief must be an object.');
  if (source.schemaVersion !== undefined && source.schemaVersion !== '1.0') fail('Unsupported culture brief schema version.');
  const brand = source.brand ?? {};
  if (!objectInput(brand)) fail('Brand must be an object.');
  const protectedFiles = [...new Set(list(brand.protectedFiles, 'protectedFiles', 12).map(validateProjectPath))];
  const protectedSnippets = list(brand.protectedSnippets, 'protectedSnippets', 12).map(item => {
    if (!objectInput(item)) fail('Protected snippet must be an object.');
    return { path: validateProjectPath(item.path), text: text(item.text, 'protected snippet text', 8000, { trim: false }) };
  });
  const seenIds = new Set();
  const audiences = list(source.audiences, 'audiences', 3).map((item, index) => {
    if (!objectInput(item)) fail('Audience must be an object.');
    const id = item.id === undefined ? `audience-${index + 1}` : text(item.id, 'audience ID', 60);
    if (!ID.test(id) || seenIds.has(id)) fail('Audience IDs must be valid and unique.');
    seenIds.add(id);
    const result = { id, label: text(item.label, 'audience label', 200), references: stringList(item.references, 'audience references', 6, 180) };
    if (item.location !== undefined) result.location = text(item.location, 'audience location', 300);
    return result;
  });
  const result = { schemaVersion: '1.0', brand: { notes: text(brand.notes, 'brand notes', 2500, { optional: true }), protectedFiles, protectedSnippets }, audiences };
  if (source.creativeContext !== undefined) result.creativeContext = normalizeCreativeContext(source.creativeContext);
  if (source.webSources !== undefined) result.webSources = normalizeWebSources(source.webSources, source.evidence === undefined ? {} : { evidence: source.evidence });
  if (source.researchDecisions !== undefined) result.researchDecisions = normalizeResearchDecisions(source.researchDecisions, { ...(source.evidence === undefined ? {} : { evidence: source.evidence }), ...(source.webSources === undefined ? {} : { webSources: source.webSources }) });
  if (source.importedResearch !== undefined || source.evidence?.length || source.researchDecisions?.length || source.webSources?.length) {
    const imported = source.importedResearch ?? { evidence: source.evidence || [], researchDecisions: source.researchDecisions || [], webSources: source.webSources || [] };
    if (!objectInput(imported)) fail('Imported research must be an authored context object.');
    const evidence = imported.evidence || [];
    const webSources = normalizeWebSources(imported.webSources || []);
    const records = normalizeResearchDecisions(imported.researchDecisions || [], { webSources });
    const compiled = compileCultureBrief({ schemaVersion: '1.0', product: 'Caller-provided research context', evidence, webSources });
    const knownIds = new Set(compiled.context.evidence.map(record => record.id));
    result.importedResearch = { provenance: 'caller-provided-unverified', evidence: compiled.context.evidence,
      webSources: compiled.context.webSources || [], researchDecisions: records,
      complete: records.every(record => record.evidenceIds.every(id => knownIds.has(id)) && (record.webSourceIds || []).every(id => webSources.some(source => source.id === id))) };
  }
  return result;
}

function actualEvidence(evidence) {
  const result = new Map();
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!item || typeof item.id !== 'string' || item.status !== 'ok'
      || !['qloo_get_insights', 'qloo_search_entities'].includes(item.tool) || !Array.isArray(item.results)) continue;
    const entities = new Set(item.results.map(row => row?.entityId).filter(id => typeof id === 'string' && id));
    if (entities.size) result.set(item.id, entities);
  }
  return result;
}

/** A validated direction remains the model's interpretation, not a Qloo design claim. */
export function normalizeDirections(raw, { evidence = [], audiences = [] } = {}) {
  const source = parsed(raw, 'Directions');
  if (!Array.isArray(source) || source.length < 2 || source.length > 3) fail('Directions must contain two or three model-produced options.');
  const records = actualEvidence(evidence);
  const audienceIds = new Set(audiences.map(audience => audience.id));
  const seenIds = new Set();
  return source.map((item, index) => {
    if (!objectInput(item)) fail('Direction must be an object.');
    const id = item.id === undefined ? `direction-${index + 1}` : text(item.id, 'direction ID', 60);
    if (!ID.test(id) || seenIds.has(id)) fail('Direction IDs must be valid and unique.');
    seenIds.add(id);
    const groups = stringList(item.audienceIds, 'direction audience IDs', 3, 60);
    if (groups.some(group => !audienceIds.has(group))) fail('Direction references an unknown audience.');
    const anchors = list(item.anchors, 'direction anchors', 8).map(anchor => {
      if (!objectInput(anchor)) fail('Direction anchor must be an object.');
      const entityId = text(anchor.entityId, 'anchor entity ID', 160);
      const evidenceId = text(anchor.evidenceId, 'anchor evidence ID', 80);
      if (!records.get(evidenceId)?.has(entityId)) fail('Direction anchor does not match an actual Qloo evidence entity.');
      return { entityId, evidenceId };
    });
    const changes = list(item.changes, 'direction changes', 8, { optional: false }).map(change => {
      if (!objectInput(change)) fail('Direction change must be an object.');
      return { selector: selectorValue(change.selector), change: text(change.change, 'direction change', 1200) };
    });
    if (!changes.length) fail('Direction must describe at least one change.');
    return { id, title: text(item.title, 'direction title', 180), summary: text(item.summary, 'direction summary', 1200),
      audienceIds: groups, anchors, changes, tradeoffs: stringList(item.tradeoffs, 'direction tradeoffs', 6, 600), sourceType: 'model-interpretation' };
  });
}

export function normalizeDecisions(raw, evidence = []) {
  const source = parsed(raw, 'Decisions');
  if (!Array.isArray(source)) fail('Decisions must be an array.');
  const ids = actualEvidence(evidence);
  return source.slice(0, 8).filter(item => objectInput(item) && typeof item.title === 'string' && item.title.trim()).map(item => {
    const evidenceIds = stringList(item.evidenceIds, 'decision evidence IDs', 16, 80).filter(id => ids.has(id));
    const selectors = [...new Set(list(item.selectors, 'decision selectors', 12).map(selectorValue))];
    const properties = stringList(item.properties, 'decision properties', 16, 80);
    if (properties.some(property => !/^(?:--)?[a-zA-Z][a-zA-Z0-9-]*$/.test(property))) fail('Invalid decision property.');
    return { title: text(item.title, 'decision title', 200), change: text(item.change, 'decision change', 1200, { optional: true }),
      reason: text(item.reason, 'decision reason', 1200, { optional: true }), evidenceIds, selectors, properties,
      sourceType: item.sourceType === 'qloo' && evidenceIds.length ? 'qloo' : item.sourceType === 'product-requirement' ? 'product-requirement' : 'model-interpretation' };
  });
}

/** A provisional plan is an authored hypothesis, never a source-backed conclusion. */
export function normalizeCreativePlan(raw) {
  const source = parsed(raw, 'Provisional creative plan');
  if (!objectInput(source) || source.schemaVersion !== '1.0') fail('A provisional creative plan with schemaVersion 1.0 is required.');
  const seen = new Set();
  const decisions = list(source.decisions, 'provisional plan decisions', 4, { optional: false }).map(item => {
    if (!objectInput(item)) fail('A provisional plan decision must be an object.');
    const id = text(item.id, 'provisional decision ID', 60);
    if (!ID.test(id) || seen.has(id)) fail('Provisional decision IDs must be valid and unique.');
    seen.add(id);
    const alternatives = stringList(item.alternatives, 'provisional alternatives', 3, 1600);
    if (!alternatives.length) fail('A provisional decision needs an alternative to its initial approach.');
    return { id, decision: text(item.decision, 'provisional decision', 1200),
      initialApproach: text(item.initialApproach, 'initial approach', 2000), alternatives,
      openQuestions: stringList(item.openQuestions, 'open research questions', 6, 1200),
      fixedFacts: stringList(item.fixedFacts, 'fixed product facts', 12, 1200) };
  });
  if (!decisions.length) fail('A provisional creative plan needs at least one decision.');
  return { schemaVersion: '1.0', decisions, sourceType: 'model-interpretation' };
}

/** Verify record links, not the truth of a design interpretation or its benefit. */
export function normalizeCreativeReconsideration(raw, { plan, evidence = [], webSources = [] } = {}) {
  const source = parsed(raw, 'Creative reconsideration');
  if (!objectInput(source) || source.schemaVersion !== '1.0') fail('Creative reconsideration with schemaVersion 1.0 is required.');
  const provisional = normalizeCreativePlan(plan);
  const planIds = new Set(provisional.decisions.map(item => item.id));
  const evidenceIds = new Set(actualEvidence(evidence).keys());
  const webIds = new Set(webSources.filter(item => item?.status === 'ok' && typeof item.id === 'string').map(item => item.id));
  const seen = new Set();
  const decisions = list(source.decisions, 'reconsidered decisions', 4, { optional: false }).map(item => {
    if (!objectInput(item)) fail('A reconsidered decision must be an object.');
    const decisionId = text(item.decisionId, 'reconsidered decision ID', 60);
    if (!planIds.has(decisionId) || seen.has(decisionId)) fail('Reconsideration must reference each provisional decision exactly once.');
    seen.add(decisionId);
    if (!['keep', 'refine', 'replace'].includes(item.outcome)) fail('Choose keep, refine or replace for a reconsidered decision.');
    const sourceEvidenceIds = stringList(item.evidenceIds, 'reconsideration Qloo source IDs', 24, 80);
    if (sourceEvidenceIds.some(id => !evidenceIds.has(id))) fail('Reconsideration refers to unavailable Qloo records.');
    const webSourceIds = stringList(item.webSourceIds, 'reconsideration web source IDs', 24, 80);
    if (webSourceIds.some(id => !webIds.has(id))) fail('Reconsideration refers to unavailable recorded web sources.');
    return { decisionId, outcome: item.outcome, reason: text(item.reason, 'reconsideration reason', 2500),
      approach: text(item.approach, 'reconsidered approach', 2500), evidenceIds: sourceEvidenceIds, webSourceIds,
      rejectedAlternatives: stringList(item.rejectedAlternatives, 'rejected alternatives', 3, 1600),
      limitations: stringList(item.limitations, 'reconsideration limitations', 8, 1600) };
  });
  if (seen.size !== planIds.size) fail('Reconsideration must address every provisional decision.');
  return { schemaVersion: '1.0', summary: text(source.summary, 'reconsideration summary', 2500), decisions, sourceType: 'model-interpretation' };
}

const RESEARCH_VERIFICATION_LIMITATION = 'Checks recorded source anchors, declaration timing, target presence and file differences only. It does not verify creative quality, semantic relevance or causal impact relative to a baseline.';

/** Studio checks are host-owned; model-authored and imported records cannot assert them. */
export function uncheckedResearchVerification(record) {
  return { id: record.id, status: record.application ? 'unchecked' : 'legacy', sourceAnchors: 'unchecked',
    planTiming: 'untracked', targetPresence: 'not-checked', artifactChange: 'not-checked',
    targetFragmentChange: 'not-checked', limitation: RESEARCH_VERIFICATION_LIMITATION };
}

function researchTarget(outputTarget) {
  if (typeof outputTarget !== 'string') return null;
  const pieces = outputTarget.split('#');
  if (pieces.length > 2 || (pieces.length === 2 && !TARGET_ID.test(pieces[1]))) return null;
  try {
    const file = validateProjectPath(pieces[0]);
    if (isCultureArtifactPath(file) || (pieces.length === 2 && !file.endsWith('.html'))) return null;
    return { file, selector: pieces.length === 2 ? '#' + pieces[1] : null };
  } catch { return null; }
}

function researchRelevantFiles(record, files) {
  const target = researchTarget(record.application?.outputTarget);
  if (!target) return [];
  // A CSS-only presentation change can leave the target's HTML unchanged. This
  // is a file-level check, not proof that the CSS affects this particular node.
  return [...new Set([target.file,
    ...(record.application.kind === 'presentation' ? Object.keys(files).filter(file => file.endsWith('.css') && !isCultureArtifactPath(file)) : []),
    ...(record.application.kind === 'interaction' ? linkedLocalScripts(target.file, files[target.file]) : [])])];
}

function linkedLocalScripts(file, html) {
  if (!file.endsWith('.html') || typeof html !== 'string') return [];
  let nodes;
  try { nodes = htmlElements(html); } catch { return []; }
  const parent = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  return nodes.filter(node => node.tagName === 'script').flatMap(node => {
    const src = node.attrs.find(attribute => attribute.name === 'src')?.value?.trim();
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(src) || src.includes('\\')) return [];
    const local = src.split(/[?#]/u)[0];
    const candidate = local.startsWith('/') ? local.slice(1) : parent + local.replace(/^\.\//u, '');
    try { return candidate.endsWith('.js') ? [validateProjectPath(candidate)] : []; } catch { return []; }
  });
}

const researchApplicationSignature = record => JSON.stringify({ application: record.application, anchors: record.anchors || [], evidenceIds: record.evidenceIds || [],
  webSourceIds: record.webSourceIds || [], webAnchors: record.webAnchors || [], reconsideration: record.reconsideration });

/** Capture the declared application before production; changes to the plan need a new snapshot. */
export function snapshotResearchApplications(records, { beforeFiles = {}, currentFiles = {}, changedFiles = [] } = {}) {
  const siteChangesAtDeclaration = [...new Set([...changedFiles, ...new Set([...Object.keys(beforeFiles), ...Object.keys(currentFiles)])])]
    .filter(file => !isCultureArtifactPath(file) && (changedFiles.includes(file) || beforeFiles[file] !== currentFiles[file]));
  return records.filter(record => record.application).map(record => {
    const relevantFiles = [...new Set([...researchRelevantFiles(record, beforeFiles), ...researchRelevantFiles(record, currentFiles)])];
    const beforeWrite = relevantFiles.length > 0 && relevantFiles.every(file => !changedFiles.includes(file) && currentFiles[file] === beforeFiles[file]);
    return { id: record.id, signature: researchApplicationSignature(record), planTiming: beforeWrite ? 'before-write' : 'after-write', siteChangesAtDeclaration };
  });
}

/** Verify bounded implementation facts without inferring usefulness or novelty. */
export function verifyResearchApplications(records, { beforeFiles = {}, afterFiles = {}, snapshots = [], kind = 'build' } = {}) {
  return records.map(record => {
    const result = uncheckedResearchVerification(record);
    result.sourceAnchors = record.anchors?.length || record.webAnchors?.length ? 'recorded' : 'none';
    if (!record.application) return result;
    const snapshot = snapshots.find(item => item.id === record.id && item.signature === researchApplicationSignature(record));
    result.planTiming = snapshot?.planTiming || 'untracked';
    if (record.disposition !== 'applied') {
      result.status = record.disposition === 'not-applied' ? 'not-applied' : 'planned';
      return result;
    }
    if (!['build', 'revise'].includes(kind)) { result.status = 'planned'; return result; }
    const target = researchTarget(record.application.outputTarget);
    if (!target) { result.targetPresence = 'unsupported'; return result; }
    const after = afterFiles[target.file];
    if (typeof after !== 'string') { result.targetPresence = 'missing'; return result; }
    result.targetPresence = 'present';
    let finalFragment;
    if (target.selector) {
      try { finalFragment = findHtmlTarget(after, target.selector).html; }
      catch { result.targetPresence = 'missing'; return result; }
      try { result.targetFragmentChange = findHtmlTarget(beforeFiles[target.file], target.selector).html === finalFragment ? 'unchanged' : 'changed'; }
      catch { result.targetFragmentChange = 'changed'; }
    }
    const relevantFiles = [...new Set([...researchRelevantFiles(record, beforeFiles), ...researchRelevantFiles(record, afterFiles)])];
    if (result.planTiming === 'before-write' && relevantFiles.some(file => snapshot.siteChangesAtDeclaration?.includes(file))) result.planTiming = 'after-write';
    result.artifactChange = relevantFiles.some(file => beforeFiles[file] !== afterFiles[file]) ? 'changed' : 'unchanged';
    if (record.application.kind === 'interaction' && target.selector && result.targetFragmentChange === 'unchanged'
      && relevantFiles.some(file => file.endsWith('.js') && beforeFiles[file] !== afterFiles[file])) {
      result.status = 'unchecked';
      result.limitation += ' A linked local script changed while the target markup stayed the same; the script\'s effect on this target was not checked.';
      return result;
    }
    result.status = result.artifactChange === 'unchanged' || (target.selector && result.targetFragmentChange === 'unchanged' && record.application.kind !== 'presentation') ? 'no-impact' : 'checked';
    return result;
  });
}

function filesInput(files) {
  if (!objectInput(files)) fail('Project files must be an object.');
  for (const [file, content] of Object.entries(files)) {
    validateProjectPath(file);
    if (typeof content !== 'string') fail('Project file contents must be strings.');
  }
  return files;
}
function lineChanges(before, after) {
  const oldLines = before ? before.split('\n') : [], newLines = after ? after.split('\n') : [];
  let prefix = 0, suffix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix), newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const lines = [];
  for (let i = Math.max(0, prefix - 3); i < prefix; i++) lines.push({ type: 'context', beforeLine: i + 1, afterLine: i + 1, text: oldLines[i] });
  let oldIndex = 0, newIndex = 0;
  const pushOld = () => { lines.push({ type: 'removed', beforeLine: prefix + oldIndex + 1, text: oldMiddle[oldIndex++] }); };
  const pushNew = () => { lines.push({ type: 'added', afterLine: prefix + newIndex + 1, text: newMiddle[newIndex++] }); };
  const bounded = oldMiddle.length > 400 || newMiddle.length > 400;
  if (bounded) {
    while (oldIndex < oldMiddle.length) pushOld();
    while (newIndex < newMiddle.length) pushNew();
  } else {
    const matrix = Array.from({ length: oldMiddle.length + 1 }, () => new Uint16Array(newMiddle.length + 1));
    for (let i = oldMiddle.length - 1; i >= 0; i--) for (let j = newMiddle.length - 1; j >= 0; j--)
      matrix[i][j] = oldMiddle[i] === newMiddle[j] ? 1 + matrix[i + 1][j + 1] : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
      if (oldIndex < oldMiddle.length && newIndex < newMiddle.length && oldMiddle[oldIndex] === newMiddle[newIndex]) {
        lines.push({ type: 'context', beforeLine: prefix + oldIndex + 1, afterLine: prefix + newIndex + 1, text: oldMiddle[oldIndex] }); oldIndex++; newIndex++;
      } else if (oldIndex < oldMiddle.length && (newIndex === newMiddle.length || matrix[oldIndex + 1][newIndex] >= matrix[oldIndex][newIndex + 1])) pushOld();
      else pushNew();
    }
  }
  for (let i = 0; i < Math.min(3, suffix); i++) lines.push({ type: 'context', beforeLine: oldLines.length - suffix + i + 1, afterLine: newLines.length - suffix + i + 1, text: oldLines[oldLines.length - suffix + i] });
  const omittedLines = Math.max(0, lines.length - 160);
  const visible = omittedLines ? [...lines.slice(0, 80), ...lines.slice(-80)] : lines;
  let longLines = false;
  const rendered = visible.map(line => {
    if (line.text.length <= 500) return line;
    longLines = true; return { ...line, text: line.text.slice(0, 500) + '…' };
  });
  return { lines: rendered, truncated: Boolean(omittedLines || longLines), omittedLines, algorithm: bounded ? 'bounded-replacement' : 'line-lcs' };
}

/** Diffs actual strings; large edits use a bounded replacement diff, not guessed changes. */
export function fileDiff(beforeFiles, afterFiles) {
  filesInput(beforeFiles); filesInput(afterFiles);
  return [...new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)])].sort().filter(file => beforeFiles[file] !== afterFiles[file]).map(file => {
    const before = beforeFiles[file] ?? '', after = afterFiles[file] ?? '';
    return { path: file, status: !own(beforeFiles, file) ? 'added' : !own(afterFiles, file) ? 'deleted' : 'modified',
      beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after), ...lineChanges(before, after) };
  });
}

function occurrences(value, needle) {
  let count = 0, position = 0;
  while ((position = value.indexOf(needle, position)) !== -1) { count++; position += needle.length; }
  return count;
}
export function assertBrandLocks(beforeFiles, afterFiles, brand = {}) {
  filesInput(beforeFiles); filesInput(afterFiles);
  const normalized = normalizeCultureBrief({ brand }).brand;
  for (const file of normalized.protectedFiles) {
    if (!own(beforeFiles, file)) fail(`Protected file does not exist: ${file}`);
    if (!own(afterFiles, file) || beforeFiles[file] !== afterFiles[file]) fail(`Brand lock violated for protected file: ${file}`);
  }
  for (const snippet of normalized.protectedSnippets) {
    const before = beforeFiles[snippet.path];
    if (typeof before !== 'string' || !occurrences(before, snippet.text)) fail(`Protected snippet does not exist: ${snippet.path}`);
    if (typeof afterFiles[snippet.path] !== 'string' || occurrences(before, snippet.text) !== occurrences(afterFiles[snippet.path], snippet.text)) fail(`Brand lock violated for protected snippet: ${snippet.path}`);
  }
  return true;
}

// Studio starters keep their catalogue in a JSON data island that app.js renders. A build keeps its facts; its narrative
// fields, like the page's own copy, are written in the voice of the run's Design DNA.
const SITE_DATA = /<script\b[^>]*\bid\s*=\s*["']site-data["'][^>]*>([\s\S]*?)<\/script\s*>/iu;
const SITE_FACTS = ['brand', 'priceSuffix', 'formDescription', 'formSuccess'];
const ITEM_FACTS = ['id', 'name', 'category', 'meta', 'price', 'priceLabel'];
// Narrative the starter renders into index.html, and narrative app.js renders from the data island.
const PAGE_NARRATIVE = ['headline', 'description', 'catalogLabel', 'catalogLink', 'searchPlaceholder', 'selectionTitle', 'formTitle', 'formButton'];
const DATA_NARRATIVE = ['addLabel', 'addMessage'];
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copyLine = value => entityText(String(value)).replace(/\s+/gu, ' ').trim().toLowerCase();

/** The parsed site-data island of a page, or null when it has none. */
export function siteData(html) {
  const match = typeof html === 'string' ? SITE_DATA.exec(html) : null;
  if (!match) return null;
  try { const value = JSON.parse(match[1]); return objectInput(value) ? value : null; } catch { return null; }
}

/**
 * Product facts a build keeps: the brand, the form's honesty notes and each catalogue item's id, name, category, meta,
 * price and price label, with every item in the starter's order. Item descriptions and the add label and message are
 * narrative. A starter without a data island has nothing to check.
 */
export function assertStarterFacts(beforeHtml, afterHtml) {
  const before = siteData(beforeHtml);
  if (!before) return true;
  const after = siteData(afterHtml);
  if (!after) fail('Keep the <script type="application/json" id="site-data"> block that app.js reads, with every product fact.');
  for (const key of SITE_FACTS) if (own(before, key) && !sameValue(before[key], after[key])) fail(`site-data.${key} is a product fact; keep ${JSON.stringify(before[key])}.`);
  const items = Array.isArray(before.items) ? before.items : [];
  if (!Array.isArray(after.items) || after.items.length !== items.length) fail(`site-data.items keeps all ${items.length} catalogue items, in their order.`);
  items.forEach((item, index) => {
    const next = objectInput(after.items[index]) ? after.items[index] : {};
    for (const key of ITEM_FACTS) if (own(item, key) && !sameValue(item[key], next[key])) fail(`site-data.items[${index}].${key} is a product fact; keep ${JSON.stringify(item[key])}.`);
    if (own(item, 'description') && (typeof next.description !== 'string' || next.description.trim().length < 3 || next.description.length > 280)) fail(`site-data.items[${index}].description: write 3-280 characters that keep what the item is and does.`);
  });
  for (const key of DATA_NARRATIVE) if (own(before, key) && (typeof after[key] !== 'string' || !after[key].trim() || after[key].length > 160)) fail(`site-data.${key}: write 1-160 characters.`);
  return true;
}

/** Text a visitor reads outside the data island: text nodes plus placeholder, label, alt and title attributes, one per line. */
function pageCopy(html) {
  const page = html.replace(SITE_DATA, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/giu, ' ').replace(/<!--[\s\S]*?-->/gu, ' ');
  const labels = [...page.matchAll(/\s(?:placeholder|aria-label|alt|title)\s*=\s*(["'])([^"']*)\1/giu)].map(match => match[2]);
  return { page, text: [...page.split(/<[^>]+>/u), ...labels].map(copyLine).filter(Boolean).join('\n') };
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/**
 * Whether the page still shows a line word for word as whole text or whole sentences. Markup may split it, but a short
 * line inside a longer one does not count: "Products" within the placeholder "Search products or ingredients".
 */
function showsLine(text, line) {
  const words = copyLine(line).split(' ').filter(Boolean);
  if (!words.length) return false;
  const end = /[.!?]$/u.test(words.at(-1)) ? '(?=\\s|$)' : '(?=[^\\p{L}\\p{N}\\n]*$|[.!?:]\\s)';
  return new RegExp(`(?:^|(?<=[.!?:]\\s))[^\\p{L}\\p{N}\\n]*${words.map(escapeRegExp).join('\\s+')}${end}`, 'mu').test(text);
}

/**
 * Starter narrative lines a saved site still shows word for word: the headline, introduction, headings and calls to
 * action of the page, the add label and message, and each item description. Facts are not counted; they never change.
 */
export function narrativeRetention(starterHtml, html) {
  const starter = siteData(starterHtml);
  if (!starter || typeof html !== 'string') return null;
  const saved = siteData(html) || {}, page = pageCopy(html).text;
  const savedItems = Array.isArray(saved.items) ? saved.items : [];
  const lines = [
    ...PAGE_NARRATIVE.filter(key => typeof starter[key] === 'string' && starter[key].trim()).map(key => ({ field: key, text: starter[key], kept: showsLine(page, starter[key]) })),
    ...DATA_NARRATIVE.filter(key => typeof starter[key] === 'string').map(key => ({ field: key, text: starter[key], kept: copyLine(saved[key] ?? '') === copyLine(starter[key]) })),
    ...(Array.isArray(starter.items) ? starter.items : []).filter(item => typeof item?.description === 'string').map(item => ({ field: `items.${item.id}.description`, text: item.description,
      kept: copyLine(savedItems.find(next => next?.id === item.id)?.description ?? '') === copyLine(item.description) })),
  ];
  const kept = lines.filter(line => line.kept).map(({ field, text }) => ({ field, text }));
  return { lines: lines.length, rewritten: lines.length - kept.length, kept,
    method: 'Starter headline, introduction, headings, calls to action, add label and message, and item descriptions that the saved page or its site-data still shows word for word. Product facts are excluded.' };
}

const sentencesOf = value => entityText(value).split(/(?<=[.!?])\s+/u).map(copyLine);

/** Distinct sentences of a page and of its site-data narrative, without the starter's product facts. */
function copySentences(html, facts) {
  if (typeof html !== 'string') return new Set();
  const chunks = pageCopy(html).page.split(/<[^>]+>/u);
  const data = siteData(html);
  if (data) chunks.push(...DATA_NARRATIVE.map(key => data[key]), ...(Array.isArray(data.items) ? data.items.map(item => item?.description) : []));
  return new Set(chunks.filter(chunk => typeof chunk === 'string').flatMap(sentencesOf).filter(line => line.split(' ').length >= 2 && !facts.has(line)));
}

/** Sentences two saved sites share word for word, with the starter's product facts left out because they never change. */
export function copyOverlap(starterHtml, baselineHtml, qlooHtml) {
  const starter = siteData(starterHtml) || {};
  // A fact of several sentences, such as the form description, is left out sentence by sentence.
  const facts = new Set([...SITE_FACTS.map(key => starter[key]), ...(Array.isArray(starter.items) ? starter.items.flatMap(item => ['name', 'category', 'meta', 'priceLabel'].map(key => item?.[key])) : [])]
    .filter(value => typeof value === 'string').flatMap(sentencesOf));
  const baseline = copySentences(baselineHtml, facts), qloo = copySentences(qlooHtml, facts);
  const shared = [...baseline].filter(line => qloo.has(line)), distinct = new Set([...baseline, ...qloo]).size;
  return { shared: shared.length, distinct, sentences: { baseline: baseline.size, qloo: qloo.size }, share: distinct ? Math.round(shared.length / distinct * 1000) / 1000 : 0, examples: shared.slice(0, 8),
    method: 'Sentences of each page and of its site-data narrative, lowercased and compared word for word; the starter\'s product facts are left out. share is shared sentences over the distinct sentences of both sites.' };
}

function entityText(value) {
  return value.replace(/&(#x[0-9a-f]+;?|#[0-9]+;?|amp;|quot;|apos;|lt;|gt;|tab;|newline;)/gi, (whole, rawCode) => {
    const code = rawCode.replace(/;$/, '');
    if (code[0] === '#') {
      const number = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : whole;
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', tab: '\t', newline: '\n' })[code.toLowerCase()];
  });
}
function attributes(raw) {
  const result = [];
  let position = 0;
  while (position < raw.length) {
    while (/\s/.test(raw[position] || '') && position < raw.length) position++;
    if (position >= raw.length || raw.slice(position).trim() === '/') break;
    const match = /^[^\s=<>"'`/]+/.exec(raw.slice(position));
    if (!match) fail('Malformed HTML attribute.');
    const name = match[0].toLowerCase(); position += match[0].length;
    while (/\s/.test(raw[position] || '') && position < raw.length) position++;
    let value = '';
    if (raw[position] === '=') {
      position++;
      while (/\s/.test(raw[position] || '') && position < raw.length) position++;
      if (raw[position] === '"' || raw[position] === "'") {
        const quote = raw[position++], end = raw.indexOf(quote, position);
        if (end < 0) fail('Unclosed HTML attribute.');
        value = raw.slice(position, end); position = end + 1;
      } else {
        const unquoted = /^[^\s<>"'`=]+/.exec(raw.slice(position));
        if (!unquoted) fail('Invalid HTML attribute value.');
        value = unquoted[0]; position += unquoted[0].length;
      }
    }
    result.push({ name, value: entityText(value) });
  }
  if (result.filter(item => item.name === 'id').length > 1) fail('Duplicate id attributes are ambiguous.');
  return result;
}

/** Conservative balanced HTML scanner, not a forgiving browser HTML parser. */
function htmlElements(html) {
  if (typeof html !== 'string' || html.length > 500000 || html.includes('\0')) fail('Invalid or oversized HTML.');
  const nodes = [], stack = [];
  let position = 0;
  while (position < html.length) {
    const start = html.indexOf('<', position);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4); if (end === -1) fail('Unclosed HTML comment.');
      position = end + 3; continue;
    }
    if (/^<!doctype\b/i.test(html.slice(start))) {
      const end = html.indexOf('>', start + 2); if (end === -1) fail('Unclosed doctype.');
      position = end + 1; continue;
    }
    if (html.startsWith('<![CDATA[', start)) {
      const end = html.indexOf(']]>', start + 9); if (end === -1) fail('Unclosed CDATA.');
      position = end + 3; continue;
    }
    let end = start + 1, quote = '';
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end >= html.length) fail('Unclosed HTML tag.');
    const raw = html.slice(start + 1, end);
    const closing = /^\/\s*([a-zA-Z][a-zA-Z0-9:-]*)\s*$/.exec(raw);
    if (closing) {
      const name = closing[1].toLowerCase(), node = stack.pop();
      if (!node || node.tagName !== name) fail('HTML is not balanced; a narrow revision cannot be applied.');
      node.end = end + 1; position = end + 1; continue;
    }
    const opening = /^([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*)$/.exec(raw);
    if (!opening) fail('Unsupported HTML syntax.');
    const tagName = opening[1].toLowerCase();
    const attrs = attributes(opening[2]);
    const selfClosing = /\/\s*$/.test(raw);
    const foreign = tagName === 'svg' || tagName === 'math' || stack.some(node => node.foreign);
    if (selfClosing && !VOID.has(tagName) && !foreign) fail('Self-closing HTML containers are ambiguous.');
    const node = { start, end: end + 1, openEnd: end + 1, tagName, attrs, id: attrs.find(attr => attr.name === 'id')?.value,
      foreign, insideTemplate: stack.some(parent => parent.tagName === 'template') };
    nodes.push(node); position = end + 1;
    if (VOID.has(tagName) || selfClosing) continue;
    if (RAW.has(tagName)) {
      const expression = new RegExp(`</${tagName}\\s*>`, 'gi'); expression.lastIndex = position;
      const close = expression.exec(html); if (!close) fail(`Unclosed ${tagName} element.`);
      node.end = close.index + close[0].length; position = node.end; continue;
    }
    stack.push(node);
  }
  if (stack.length) fail('HTML is not balanced; a narrow revision cannot be applied.');
  return nodes;
}

function targetId(selector) {
  if (typeof selector !== 'string' || selector[0] !== '#' || !TARGET_ID.test(selector.slice(1))) fail('Narrow revisions support one simple #id selector only.');
  return selector.slice(1);
}
export function findHtmlTarget(html, selector) {
  const id = targetId(selector);
  const matches = htmlElements(html).filter(node => node.id === id && !node.insideTemplate);
  if (matches.length !== 1) fail('The HTML target must exist exactly once.');
  const node = matches[0];
  if (VOID.has(node.tagName) || FORBIDDEN_FRAGMENT.has(node.tagName) || RAW.has(node.tagName)) fail('This HTML element cannot be a narrow revision target.');
  return { start: node.start, end: node.end, html: html.slice(node.start, node.end), id, tagName: node.tagName };
}

function withoutCssComments(css) {
  let result = '', quote = '';
  for (let position = 0; position < css.length; position++) {
    const char = css[position];
    if (quote) { result += char; if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; result += char; continue; }
    if (css.startsWith('/*', position)) {
      const end = css.indexOf('*/', position + 2); if (end < 0) fail('Unclosed CSS comment.');
      result += ' '; position = end + 1;
    } else result += char;
  }
  if (quote) fail('Unclosed CSS string.');
  return result;
}
function cssDelimiter(css, position, desired) {
  let quote = '', parentheses = 0, brackets = 0;
  for (let index = position; index < css.length; index++) {
    const char = css[index];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') parentheses++;
    if (char === ')') parentheses--;
    if (char === '[') brackets++;
    if (char === ']') brackets--;
    if (parentheses < 0 || brackets < 0) fail('Unbalanced CSS.');
    if (!parentheses && !brackets && desired.includes(char)) return index;
  }
  if (quote || parentheses || brackets) fail('Unbalanced CSS.');
  return -1;
}
function scopedCss(value, selector) {
  const raw = text(value, 'revision CSS', 20000, { optional: true });
  if (!raw) return '';
  const css = withoutCssComments(raw);
  if (/[@\\\0]|url\s*\(|expression\s*\(|(?:behavior|-moz-binding)\s*:/i.test(css)) fail('Revision CSS must contain plain rules without URLs, escapes or at-rules.');
  let position = 0;
  while (position < css.length) {
    if (!css.slice(position).trim()) break;
    const open = cssDelimiter(css, position, '{}');
    if (open < 0 || css[open] !== '{') fail('Invalid CSS rule.');
    const prelude = css.slice(position, open).trim();
    if (!prelude) fail('Empty CSS selector.');
    let cursor = 0;
    while (cursor < prelude.length) {
      const comma = cssDelimiter(prelude, cursor, ',');
      const ruleSelector = prelude.slice(cursor, comma < 0 ? undefined : comma).trim();
      if (!ruleSelector.startsWith(selector) || !/^(?:$|[\s.:#\[>])/.test(ruleSelector.slice(selector.length))
        || /[+~]/.test(ruleSelector) || /::(?:backdrop|view-transition)/i.test(ruleSelector)) fail('Every CSS selector must remain within the selected element.');
      if (comma < 0) break;
      cursor = comma + 1;
      if (!prelude.slice(cursor).trim()) fail('Empty CSS selector.');
    }
    const close = cssDelimiter(css, open + 1, '{}');
    if (close < 0 || css[close] !== '}') fail('CSS nesting is not supported for narrow revisions.');
    const declarations = css.slice(open + 1, close).trim();
    if (!declarations || declarations.includes('<') || declarations.includes('>')) fail('Invalid CSS declarations.');
    position = close + 1;
  }
  return raw;
}

/** Server applies a model artifact; the model never receives broad write permission. */
export function applyScopedRevision(beforeFiles, { selector, fragment, css = '' } = {}) {
  filesInput(beforeFiles);
  const source = beforeFiles['index.html'];
  if (typeof source !== 'string') fail('index.html is required for a narrow revision.');
  const target = findHtmlTarget(source, selector);
  const replacement = text(fragment, 'revision fragment', 100000);
  const nodes = htmlElements(replacement);
  const root = findHtmlTarget(replacement, selector);
  if (replacement.slice(0, root.start).trim() || replacement.slice(root.end).trim()) fail('Revision fragment must contain exactly the selected element.');
  for (const node of nodes) {
    if (FORBIDDEN_FRAGMENT.has(node.tagName)) fail('Revision fragments cannot contain active or document-level elements.');
    for (const attribute of node.attrs) {
      if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc'
        || /^(?:javascript|vbscript|data)\s*:/i.test(attribute.value.replace(/[\x00-\x20]/g, ''))) fail('Revision fragments cannot contain active attributes or executable URLs.');
      if (['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'poster', 'data'].includes(attribute.name)
        && /(?:https?:|\/\/|&(?:#|tab|newline))/i.test(attribute.value.replace(/[\x00-\x20]/g, ''))) fail('Revision fragments cannot request external resources or navigate externally.');
    }
  }
  const outsideIds = new Set(htmlElements(source).filter(node => !node.insideTemplate && !(node.start >= target.start && node.end <= target.end)).map(node => node.id).filter(Boolean));
  const seen = new Set();
  for (const node of nodes) if (node.id) {
    if (seen.has(node.id) || outsideIds.has(node.id)) fail('Revision creates a duplicate or out-of-scope element ID.');
    seen.add(node.id);
  }
  const additionalCss = scopedCss(css, selector);
  const result = { ...beforeFiles, 'index.html': source.slice(0, target.start) + replacement + source.slice(target.end) };
  if (additionalCss) result['styles.css'] = (beforeFiles['styles.css'] ?? '') + '\n/* Scoped revision: ' + selector + ' */\n' + additionalCss + '\n';
  return result;
}
