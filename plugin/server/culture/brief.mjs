import { normalizeCreativeContext, normalizeResearchDecisions, normalizeWebSources, CulturePolicyError, MAX_PORTABLE_JSON_BYTES } from './policy.mjs';

const MAX_BYTES = MAX_PORTABLE_JSON_BYTES;
const FORBIDDEN_KEYS = new Set([
  'proto', 'constructor', 'prototype', 'apikey', 'qlooapikey', 'password',
  'secret', 'authorization', 'token', 'accesstoken', 'refreshtoken', 'bridgetoken',
  'credentials', 'credential', 'privatekey',
]);
const TOP_FIELDS = new Set(['schemaVersion', 'product', 'brand', 'audiences', 'selectedDirection', 'evidence', 'decisions', 'constraints', 'audienceId', 'revisionRequest', 'provenance', 'creativeContext', 'researchDecisions', 'webSources']);

export class CultureBriefError extends Error {
  constructor(validation) {
    super('The cultural brief is invalid. Review the validation errors.');
    this.name = 'CultureBriefError';
    this.code = 'CULTURE_BRIEF_INVALID';
    this.validation = validation;
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function meaningful(value) {
  return typeof value === 'string' ? Boolean(value.trim()) : plainObject(value) && Object.keys(value).length > 0;
}

function boundedJson(value, errors) {
  let nodes = 0;
  const seen = new Set();
  const issue = (path, message) => { if (errors.length < 30) errors.push({ path, message }); };
  const visit = (item, path = 'brief', depth = 0) => {
    if (++nodes > 1500) { if (nodes === 1501) issue('brief', 'The brief exceeds the JSON node limit.'); return; }
    if (depth > 16) { issue(path, 'The brief exceeds the nesting limit.'); return; }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) issue(path, 'Numbers must be finite.'); return; }
    if (typeof item === 'string') {
      const maximum = /^brief\.brand\.protectedSnippets\[\d+\]\.text$/u.test(path) ? 8000 : 4000;
      if (item.length > maximum) issue(path, `Text must not exceed ${maximum} characters per field.`);
      return;
    }
    if (!Array.isArray(item) && !plainObject(item)) { issue(path, 'Values must be plain JSON data.'); return; }
    if (seen.has(item)) { issue(path, 'Circular object references are not portable JSON.'); return; }
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 100) issue(path, 'Arrays must contain at most 100 items.');
      item.slice(0, 100).forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
    } else {
      const keys = Object.keys(item);
      if (keys.length > 40) issue(path, 'Objects must contain at most 40 fields.');
      for (const key of keys.slice(0, 40)) {
        if (key.length > 100) { issue(path, 'Object field names must contain at most 100 characters.'); continue; }
        if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/gu, ''))) { issue(path, 'Secrets and prototype fields are not allowed in a portable brief.'); continue; }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) { issue(path, 'Accessor properties are not portable JSON.'); continue; }
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(item);
  };
  visit(value);
  if (!errors.length) {
    try { if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_BYTES) issue('brief', 'The brief exceeds the 192 KiB UTF-8 limit.'); }
    catch { issue('brief', 'The brief is not portable JSON.'); }
  }
}

function recordId(record) { return record?.id ?? record?.evidence?.id; }

function authoredRecord(record, kind, issue = () => {}, path = 'brief') {
  let result = record;
  const marker = kind === 'evidence' ? 'verification' : 'kind';
  const markerValue = kind === 'evidence' ? 'caller-provided-unverified' : 'creative-interpretation';
  const allowed = kind === 'evidence' ? ['id', 'verification', 'record'] : ['kind', 'record'];
  while (plainObject(result) && result[marker] === markerValue && Object.hasOwn(result, 'record')) {
    if (Object.keys(result).some(key => !allowed.includes(key)) || !plainObject(result.record)) {
      issue(path, 'A compiled record wrapper has unsupported fields or invalid record data.');
      return null;
    }
    if (kind === 'evidence' && result.id !== recordId(result.record)) {
      issue(path, 'A compiled evidence wrapper id must match its record id.');
      return null;
    }
    result = result.record;
  }
  return result;
}

/** Structural validation only. Caller-supplied Qloo-looking records are never authenticated. */
export function validateCultureBrief(brief) {
  const errors = [], warnings = [];
  const issue = (path, message) => { if (errors.length < 30) errors.push({ path, message }); };
  if (!plainObject(brief)) {
    return { status: 'invalid', valid: false, errors: [{ path: 'brief', message: 'brief must be a plain JSON object.' }], warnings };
  }
  boundedJson(brief, errors);
  // Stop before semantic reads if descriptors, prototypes, sizes or JSON values are unsafe.
  if (errors.length) return { status: 'invalid', valid: false, errors, warnings };
  for (const key of Object.keys(brief)) if (!TOP_FIELDS.has(key)) issue('brief', 'The brief contains an unsupported top-level field.');
  if (brief.schemaVersion !== undefined && brief.schemaVersion !== '1.0') issue('brief.schemaVersion', 'Only brief schema version 1.0 is supported.');
  if (!meaningful(brief.product)) issue('brief.product', 'A nonempty product description or object is required.');
  if (brief.brand !== undefined && !meaningful(brief.brand)) issue('brief.brand', 'brand must be a nonempty string or object.');
  if (brief.selectedDirection !== undefined && !meaningful(brief.selectedDirection)) issue('brief.selectedDirection', 'selectedDirection must be a nonempty string or object.');
  for (const [field, maximum] of [['audienceId', 100], ['revisionRequest', 4000], ['provenance', 200]]) {
    if (brief[field] !== undefined && (typeof brief[field] !== 'string' || !brief[field].trim() || brief[field].length > maximum)) {
      issue(`brief.${field}`, `${field} must be a nonempty string of at most ${maximum} characters.`);
    }
  }

  const audienceIds = new Set(), evidenceIds = new Set(), webSourceIds = new Set();
  const audiences = brief.audiences ?? [], evidence = brief.evidence ?? [], decisions = brief.decisions ?? [];
  if (!Array.isArray(audiences) || audiences.length > 8) issue('brief.audiences', 'audiences must be an array with at most 8 groups.');
  else {
    if (!audiences.length) warnings.push({ path: 'brief.audiences', message: 'No audience groups are specified. This brief represents product context only.' });
    audiences.forEach((audience, index) => {
      const path = `brief.audiences[${index}]`;
      if (!plainObject(audience)) { issue(path, 'Each audience must be an object.'); return; }
      if (typeof audience.id !== 'string' || !audience.id.trim() || audience.id.length > 100) issue(`${path}.id`, 'Each audience needs a nonempty id of at most 100 characters.');
      else if (audienceIds.has(audience.id)) issue(`${path}.id`, 'Audience ids must be unique.');
      else audienceIds.add(audience.id);
      if (typeof audience.label !== 'string' || !audience.label.trim() || audience.label.length > 200) issue(`${path}.label`, 'Each audience needs a nonempty label of at most 200 characters.');
    });
  }
  if (!Array.isArray(evidence) || evidence.length > 100) issue('brief.evidence', 'evidence must be an array with at most 100 records.');
  else evidence.forEach((record, index) => {
    const original = authoredRecord(record, 'evidence', issue, `brief.evidence[${index}]`);
    if (original === null) return;
    const id = recordId(original);
    if (!plainObject(original) || typeof id !== 'string' || !id.trim() || id.length > 100) issue(`brief.evidence[${index}]`, 'Each evidence record needs an id, either directly or in evidence.id.');
    else if (evidenceIds.has(id)) issue(`brief.evidence[${index}]`, 'Evidence ids must be unique.');
    else evidenceIds.add(id);
  });
  if (Array.isArray(evidence) && evidence.length) warnings.push({ path: 'brief.evidence', message: 'Imported evidence is caller-provided and unverified. Only a host that performed the calls can attest to its provenance.' });
  if (brief.webSources !== undefined) {
    try {
      const sources = normalizeWebSources(brief.webSources, { evidence: brief.evidence ?? [] });
      sources.forEach(source => webSourceIds.add(source.id));
      if (sources.length) warnings.push({ path: 'brief.webSources', message: 'Imported web sources are caller-provided and unverified. Source type and timestamps are caller claims, not authenticated page reads.' });
    } catch (error) {
      if (error instanceof CulturePolicyError) issue(`brief.${error.path}`, 'The web sources contain an invalid field, source URL, bound or Qloo annotation.');
      else throw error;
    }
  }
  if (brief.audienceId !== undefined && !audienceIds.has(brief.audienceId)) issue('brief.audienceId', 'The selected audienceId must exist in this brief.');
  if (brief.provenance !== undefined) warnings.push({ path: 'brief.provenance', message: 'The imported provenance value is a caller claim, not an authenticated source attestation.' });
  if (!Array.isArray(decisions) || decisions.length > 80) issue('brief.decisions', 'decisions must be an array with at most 80 creative decisions.');
  else decisions.forEach((record, index) => {
    const path = `brief.decisions[${index}]`;
    const decision = authoredRecord(record, 'decision', issue, path);
    if (decision === null) return;
    if (!plainObject(decision)) { issue(path, 'Each creative decision must be an object.'); return; }
    for (const [field, known] of [['evidenceIds', evidenceIds], ['audienceIds', audienceIds], ['webSourceIds', webSourceIds]]) {
      if (decision[field] === undefined) continue;
      if (!Array.isArray(decision[field]) || decision[field].length > 20 || decision[field].some(id => typeof id !== 'string' || !known.has(id))) {
        issue(`${path}.${field}`, 'Decision references must resolve to ids in this brief and contain at most 20 items.');
      }
    }
  });
  if (brief.creativeContext !== undefined) {
    try {
      const context = normalizeCreativeContext(brief.creativeContext);
      if (context.references.some(reference => reference.audienceId !== undefined && !audienceIds.has(reference.audienceId))) {
        issue('brief.creativeContext.references', 'Reference audienceIds must exist in this brief.');
      }
    } catch (error) {
      if (error instanceof CulturePolicyError) issue(`brief.${error.path}`, 'The creative context is invalid. Check its declared fields and limits.');
      else throw error;
    }
  }
  if (brief.researchDecisions !== undefined) {
    try { normalizeResearchDecisions(brief.researchDecisions, { evidence: brief.evidence ?? [], webSources: brief.webSources ?? [] }); }
    catch (error) {
      if (error instanceof CulturePolicyError) issue(`brief.${error.path}`, 'The research decisions contain an invalid field, bound or evidence reference.');
      else throw error;
    }
  }
  return { status: errors.length ? 'invalid' : 'valid', valid: !errors.length, errors, warnings };
}

/** Compile a portable context, without files, network calls or claims of source authenticity. */
export function compileCultureBrief(brief) {
  const validation = validateCultureBrief(brief);
  if (!validation.valid) throw new CultureBriefError(validation);
  const data = structuredClone(brief);
  return {
    status: 'compiled',
    schemaVersion: '1.0',
    provenance: 'caller-provided-unverified',
    context: {
      product: data.product,
      ...(data.brand !== undefined ? { brand: data.brand } : {}),
      audiences: data.audiences ?? [],
      ...(data.selectedDirection !== undefined ? { selectedDirection: data.selectedDirection } : {}),
      ...(data.constraints !== undefined ? { constraints: data.constraints } : {}),
      ...(data.audienceId !== undefined ? { audienceId: data.audienceId } : {}),
      ...(data.revisionRequest !== undefined ? { revisionRequest: data.revisionRequest } : {}),
      ...(data.provenance !== undefined ? { provenance: data.provenance } : {}),
      ...(data.creativeContext !== undefined ? { creativeContext: normalizeCreativeContext(data.creativeContext) } : {}),
      ...(data.researchDecisions !== undefined ? { researchDecisions: normalizeResearchDecisions(data.researchDecisions, { evidence: data.evidence ?? [], webSources: data.webSources ?? [] }).map(record => ({ kind: 'creative-interpretation', record })) } : {}),
      ...(data.webSources !== undefined ? { webSources: normalizeWebSources(data.webSources, { evidence: data.evidence ?? [] }).map(record => ({ id: record.id, verification: 'caller-provided-unverified', record })) } : {}),
      evidence: (data.evidence ?? []).map(value => {
        const record = authoredRecord(value, 'evidence');
        return { id: recordId(record), verification: 'caller-provided-unverified', record };
      }),
      decisions: (data.decisions ?? []).map(value => ({ kind: 'creative-interpretation', record: authoredRecord(value, 'decision') })),
    },
    validation,
    interpretation: 'This tool validates structure and links only. Imported cultural evidence and web sources are unverified; design decisions are creative interpretation, not Qloo predictions or validated design quality.',
  };
}
