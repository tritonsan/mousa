import { assessCreativeDecision, normalizeCreativeContext } from '../plugin/server/culture/policy.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/u;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, label, max = 1000, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) || (required && !value.trim())) throw new Error(`Invalid ${label}.`);
  return value.trim();
}

export function creativeContextForBrief(brief = {}) {
  const context = normalizeCreativeContext(brief.creativeContext || { domain: 'web' });
  const references = [...context.references];
  for (const audience of brief.audiences || []) for (const name of audience.references || []) {
    if (!references.some(ref => ref.name.toLowerCase() === name.toLowerCase() && ref.role === 'audience' && ref.audienceId === audience.id)) {
      references.push({ name, role: 'audience', origin: 'user-provided', audienceId: audience.id });
    }
  }
  return normalizeCreativeContext({ ...context, domain: 'web', references });
}

export function normalizePreparationResponse(raw) {
  if (!plain(raw) || !['option', 'references', 'delegate', 'skip'].includes(raw.type)) throw new Error('Choose a valid preparation response.');
  const allowed = raw.type === 'option' ? ['type', 'optionId'] : raw.type === 'references' ? ['type', 'text'] : ['type'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error('The preparation response contains an unsupported field.');
  if (raw.type === 'option') {
    const optionId = text(raw.optionId, 'inspiration option', 60, true);
    if (!ID.test(optionId)) throw new Error('Choose a valid inspiration option.');
    return { type: raw.type, optionId };
  }
  return raw.type === 'references' ? { type: raw.type, text: text(raw.text, 'reference answer', 3500, true) } : { type: raw.type };
}

/** Normalize model-authored intake. Its route is recomputed by the shared tool. */
export function normalizePreparation(raw, { cultureBrief = {}, brief = '', reply = '', parentPreparation, response, assessments = [] } = {}) {
  if (!plain(raw) || !plain(raw.decision)) throw new Error('The agent did not save a valid preparation decision.');
  const base = creativeContextForBrief(cultureBrief);
  let proposed = normalizeCreativeContext(raw.creativeContext || base);
  // An agent cannot silently turn an open request into delegated reference selection.
  proposed.referencePolicy = base.referencePolicy;
  const references = [...base.references];
  for (const ref of proposed.references) {
    const existing = base.references.find(candidate => candidate.name.toLowerCase() === ref.name.toLowerCase() && candidate.role === ref.role);
    if (existing) continue;
    if (base.referencePolicy === 'delegated' && ref.origin === 'agent-selected' && ref.role !== 'audience') {
      references.push(ref); continue;
    }
    if (ref.origin === 'agent-selected' || ![brief, reply].some(value => value.toLowerCase().includes(ref.name.toLowerCase()))) {
      throw new Error('New reference names require a user answer, an inspiration choice, or explicit delegation.');
    }
    references.push({ ...ref, origin: 'user-provided' });
  }
  const creativeContext = normalizeCreativeContext({ ...proposed, domain: 'web', references,
    constraints: [...new Set([...base.constraints, ...proposed.constraints])] });
  const assessment = assessCreativeDecision({ decision: raw.decision, context: creativeContext });
  const options = raw.options === undefined ? [] : raw.options;
  if (!Array.isArray(options) || options.length > 3) throw new Error('Preparation supports at most three inspiration options.');
  const seen = new Set();
  const normalizedOptions = options.map(option => {
    if (!plain(option)) throw new Error('Invalid inspiration option.');
    const id = text(option.id, 'option ID', 60, true);
    if (!ID.test(id) || seen.has(id)) throw new Error('Inspiration options need unique IDs.');
    seen.add(id);
    const refs = normalizeCreativeContext({ domain: 'web', references: option.references || [], constraints: [] }).references;
    if (!refs.length || refs.length > 6 || refs.some(ref => ref.origin !== 'agent-selected' || ref.role === 'audience')) throw new Error('Inspiration options must contain agent-selected creative references, not invented audience tastes.');
    return { id, title: text(option.title, 'option title', 160, true), summary: text(option.summary, 'option summary', 700, true), references: refs };
  });
  const needsInput = assessment.action === 'clarify';
  const question = needsInput ? parentPreparation?.question || text(raw.question, 'preparation question', 1000) : '';
  const finalOptions = needsInput && parentPreparation ? structuredClone(parentPreparation.options) : normalizedOptions;
  if (needsInput && (!question || !finalOptions.length)) throw new Error('An incomplete creative request needs one question and inspiration choices.');
  return {
    status: needsInput ? 'needs_input' : 'ready', decision: structuredClone(raw.decision), assessment,
    question: needsInput ? question : '', options: needsInput ? finalOptions : [], creativeContext,
    referenceResolution: response ? structuredClone(response) : null,
    assessmentPerformedByAgent: assessments.length > 0,
    interpretation: 'Preparation gathers authored context only. It makes no Qloo calls and does not verify creative quality.',
  };
}

/** Explicit selection/delegation/skip completes intake without another paid model run. */
export function answerPreparation(parent, response) {
  const creativeContext = structuredClone(parent.creativeContext);
  let selected;
  if (response.type === 'option') {
    selected = parent.options.find(option => option.id === response.optionId);
    if (!selected) throw new Error('Choose an inspiration option from this preparation.');
  } else if (response.type === 'delegate') {
    selected = parent.options[0];
    if (!selected) throw new Error('No prepared inspiration direction is available to delegate.');
    creativeContext.referencePolicy = 'delegated';
  } else if (response.type === 'skip') creativeContext.referencePolicy = 'skip';
  else throw new Error('A free-text answer requires the agent preparation step.');
  if (selected) creativeContext.references = normalizeCreativeContext({ ...creativeContext, references: [...creativeContext.references, ...selected.references] }).references;
  const assessment = assessCreativeDecision({ decision: parent.decision, context: creativeContext });
  return { ...structuredClone(parent), status: 'ready', assessment, creativeContext,
    question: '', options: [], referenceResolution: structuredClone(response),
    selectedInspiration: selected ? { id: selected.id, title: selected.title } : null,
    completionMethod: 'explicit-user-response',
  };
}
