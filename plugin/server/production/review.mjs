// The visual self-review: after the conformance check the host captures the result, the agent opens each capture with
// its own image-reading tool, and judges every criterion of its production plan as met, partly or missed, with what it
// observed and the repair it made. A host that can audit the session also confirms that each cited capture was opened.

import { TASTE_SCHEMA_VERSION } from '../culture/taste.mjs';
import { CAPTURE_LIMITS } from './capabilities.mjs';
import { fail, plain, parsed, object, text, list, choice, integer } from './fields.mjs';

export const VERDICTS = Object.freeze(['met', 'partly', 'missed']);

/** The capture IDs a review source cites, read leniently before it is validated, so a host can audit them first. */
export function citedCaptures(raw) {
  let source = raw;
  if (typeof raw === 'string') { try { source = JSON.parse(raw); } catch { return []; } }
  const criteria = Array.isArray(source?.criteria) ? source.criteria.slice(0, 12) : [];
  return [...new Set(criteria.map(item => item?.capture).filter(id => typeof id === 'string' && id.length <= 80))];
}

/**
 * Validate a review against the plan's criteria and the captures the host issued. `opened` is the set of capture IDs
 * an audit of the session shows the agent opened, or null when the host cannot audit; `round` is the host's current
 * review round, and a capture from an earlier round cannot be cited after repairs.
 */
export function normalizeReview(raw, { plan, captures = [], opened = null, round, rounds = CAPTURE_LIMITS.rounds } = {}) {
  if (!plain(plan) || !Array.isArray(plan.review)) fail('plan', 'The validated production plan for this run is required.');
  if (!plan.review.length) fail('plan.review', 'The production plan lists no review criteria, so there is nothing to review.');
  const criteria = new Map(plan.review.map(item => [item.id, item]));
  const issued = new Map((Array.isArray(captures) ? captures : []).map(capture => [capture.id, capture]));
  const source = parsed(raw, 'review');
  object(source, 'review', ['schemaVersion', 'round', 'criteria', 'summary']);
  if (source.schemaVersion !== TASTE_SCHEMA_VERSION) fail('review.schemaVersion', "Use schemaVersion '1.0'.");
  const at = integer(source.round, 'review.round', [1, rounds]);
  if (round !== undefined && at !== round) fail('review.round', `This is review round ${round}.`);
  const current = [...issued.values()].filter(capture => capture.round === undefined || capture.round === at);
  const judged = new Set();
  const verdicts = list(source.criteria, 'review.criteria', { min: 1, max: criteria.size }).map((item, index) => {
    const path = `review.criteria[${index}]`;
    object(item, path, ['id', 'capture', 'verdict', 'observed', 'repair']);
    const id = text(item.id, `${path}.id`, { max: 20 });
    if (!criteria.has(id)) fail(`${path}.id`, `Use a criterion ID of the production plan: ${[...criteria.keys()].join(', ')}.`);
    if (judged.has(id)) fail(`${path}.id`, `Judge each criterion once; ${id} already has a verdict.`);
    judged.add(id);
    const capture = text(item.capture, `${path}.capture`, { max: 80 });
    const shot = issued.get(capture);
    if (!shot) fail(`${path}.capture`, current.length ? `Cite a capture the host made in this round: ${current.map(item => item.id).join(', ')}.` : 'Ask the host for captures of the result first, then cite them.');
    if (shot.round !== undefined && shot.round !== at) fail(`${path}.capture`, `${capture} was taken in round ${shot.round}, before your repairs. Capture again and cite this round's captures.`);
    if (opened && !opened.has(capture)) fail(`${path}.capture`, `${capture} was not opened in this session. Open ${shot.path || 'its PNG'} with your image-reading tool before judging it.`);
    const verdict = choice(item.verdict, VERDICTS, `${path}.verdict`);
    const observed = text(item.observed, `${path}.observed`, { min: 10, max: 400 });
    if (verdict !== 'met' && item.repair === undefined) fail(`${path}.repair`, `A ${verdict} criterion names the repair it needs, which you then make in the files.`);
    return { id, device: criteria.get(id).device, capture, verdict, observed, ...(item.repair !== undefined ? { repair: text(item.repair, `${path}.repair`, { min: 10, max: 400 }) } : {}) };
  });
  const unjudged = [...criteria.keys()].filter(id => !judged.has(id));
  if (unjudged.length) fail('review.criteria', `Judge every criterion of the production plan. No verdict for: ${unjudged.join(', ')}.`);
  const count = verdict => verdicts.filter(item => item.verdict === verdict).length;
  return { schemaVersion: TASTE_SCHEMA_VERSION, round: at, criteria: verdicts, summary: text(source.summary, 'review.summary', { min: 10, max: 600 }),
    stats: { met: count('met'), partly: count('partly'), missed: count('missed'), repairs: verdicts.filter(item => item.repair).length, captures: [...new Set(verdicts.map(item => item.capture))] },
    audited: Boolean(opened), sourceType: 'model-review' };
}
