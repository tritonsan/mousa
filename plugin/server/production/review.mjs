// The visual self-review: after the conformance check the host captures the result, the agent opens each capture with
// its own image-reading tool, and judges every criterion of its production plan as met, partly or missed, with what it
// observed and the repair it made. A host that can audit the session also confirms that each cited capture was opened.
//
// With the run's taste context the review also carries a critique, because a page can meet every criterion of its own
// plan and still look like any page: the agent names the three most generic choices it sees, keeps each only for an
// anchor of its DNA that requires it, and names among them every default-look signature the host still finds; then it
// pictures someone who loves the audience's best-loved works and says whether they would take the page for theirs.

import { TASTE_SCHEMA_VERSION, isQualityDomain, normalizeTasteName } from '../culture/taste.mjs';
import { CAPTURE_LIMITS } from './capabilities.mjs';
import { fail, plain, parsed, object, text, list, choice, integer } from './fields.mjs';

export const VERDICTS = Object.freeze(['met', 'partly', 'missed']);
export const CRITIQUE_ACTIONS = Object.freeze(['kept', 'replaced']);
export const FAN_VERDICTS = Object.freeze(['yes', 'partly', 'no']);
export const CRITIQUE_LIMITS = Object.freeze({ generic: 3, minFanWorks: 3, maxFanWorks: 5, headWorks: 10, headInFan: 2 });

/** The capture IDs a review source cites, read leniently before it is validated, so a host can audit them first. */
export function citedCaptures(raw) {
  let source = raw;
  if (typeof raw === 'string') { try { source = JSON.parse(raw); } catch { return []; } }
  const criteria = Array.isArray(source?.criteria) ? source.criteria.slice(0, 12) : [];
  const generic = Array.isArray(source?.critique?.generic) ? source.critique.generic.slice(0, CRITIQUE_LIMITS.generic) : [];
  return [...new Set([...criteria, ...generic].map(item => item?.capture).filter(id => typeof id === 'string' && id.length <= 80))];
}

/**
 * Validate a review against the plan's criteria and the captures the host issued. `opened` is the set of capture IDs
 * an audit of the session shows the agent opened, or null when the host cannot audit; `round` is the host's current
 * review round, and a capture from an earlier round cannot be cited after repairs. `taste` ({input, dna, signatures})
 * is the run's taste input, its DNA and the default-look signatures on the page now; with it the critique is required.
 */
export function normalizeReview(raw, { plan, captures = [], opened = null, round, rounds = CAPTURE_LIMITS.rounds, taste = null } = {}) {
  if (!plain(plan) || !Array.isArray(plan.review)) fail('plan', 'The validated production plan for this run is required.');
  if (!plan.review.length) fail('plan.review', 'The production plan lists no review criteria, so there is nothing to review.');
  const criteria = new Map(plan.review.map(item => [item.id, item]));
  const issued = new Map((Array.isArray(captures) ? captures : []).map(capture => [capture.id, capture]));
  const source = parsed(raw, 'review');
  object(source, 'review', ['schemaVersion', 'round', 'criteria', 'summary', 'critique']);
  if (source.schemaVersion !== TASTE_SCHEMA_VERSION) fail('review.schemaVersion', "Use schemaVersion '1.0'.");
  const at = integer(source.round, 'review.round', [1, rounds]);
  if (round !== undefined && at !== round) fail('review.round', `This is review round ${round}.`);
  const current = [...issued.values()].filter(capture => capture.round === undefined || capture.round === at);
  // A capture cited by a verdict or by the critique: made in this round, and opened when the host can tell.
  const cited = (value, path) => {
    const capture = text(value, path, { max: 80 });
    const shot = issued.get(capture);
    if (!shot) fail(path, current.length ? `Cite a capture the host made in this round: ${current.map(item => item.id).join(', ')}.` : 'Ask the host for captures of the result first, then cite them.');
    if (shot.round !== undefined && shot.round !== at) fail(path, `${capture} was taken in round ${shot.round}, before your repairs. Capture again and cite this round's captures.`);
    if (opened && !opened.has(capture)) fail(path, `${capture} was not opened in this session. Open ${shot.path || 'its PNG'} with your image-reading tool before judging it.`);
    return capture;
  };
  const judged = new Set();
  const verdicts = list(source.criteria, 'review.criteria', { min: 1, max: criteria.size }).map((item, index) => {
    const path = `review.criteria[${index}]`;
    object(item, path, ['id', 'capture', 'verdict', 'observed', 'repair']);
    const id = text(item.id, `${path}.id`, { max: 20 });
    if (!criteria.has(id)) fail(`${path}.id`, `Use a criterion ID of the production plan: ${[...criteria.keys()].join(', ')}.`);
    if (judged.has(id)) fail(`${path}.id`, `Judge each criterion once; ${id} already has a verdict.`);
    judged.add(id);
    const capture = cited(item.capture, `${path}.capture`);
    const verdict = choice(item.verdict, VERDICTS, `${path}.verdict`);
    const observed = text(item.observed, `${path}.observed`, { min: 10, max: 400 });
    if (verdict !== 'met' && item.repair === undefined) fail(`${path}.repair`, `A ${verdict} criterion names the repair it needs, which you then make in the files.`);
    return { id, device: criteria.get(id).device, capture, verdict, observed, ...(item.repair !== undefined ? { repair: text(item.repair, `${path}.repair`, { min: 10, max: 400 }) } : {}) };
  });
  const unjudged = [...criteria.keys()].filter(id => !judged.has(id));
  if (unjudged.length) fail('review.criteria', `Judge every criterion of the production plan. No verdict for: ${unjudged.join(', ')}.`);
  if (taste && source.critique === undefined) fail('review.critique', 'Add a critique: {generic: [3 {choice, capture, signature?, anchor?, action: kept|replaced}], fan: {works: [3-5 names], verdict: yes|partly|no, why}}.');
  const critique = source.critique === undefined ? null : normalizeCritique(source.critique, { taste, cited });
  const count = verdict => verdicts.filter(item => item.verdict === verdict).length;
  return { schemaVersion: TASTE_SCHEMA_VERSION, round: at, criteria: verdicts, summary: text(source.summary, 'review.summary', { min: 10, max: 600 }), ...(critique ? { critique } : {}),
    stats: { met: count('met'), partly: count('partly'), missed: count('missed'), repairs: verdicts.filter(item => item.repair).length,
      captures: [...new Set([...verdicts.map(item => item.capture), ...(critique?.generic || []).map(item => item.capture)])],
      ...(critique ? { replaced: critique.generic.filter(item => item.action === 'replaced').length, fan: critique.fan.verdict } : {}) },
    audited: Boolean(opened), sourceType: 'model-review' };
}

/**
 * The critique. Each generic choice cites a capture of this round; it is kept only for an anchor a device of the DNA
 * uses, and each default-look signature still on the page is named by one of them. The fan's works are works of the
 * run's own taste source, and in a measured run at least two of them are among its highest-affinity works.
 */
function normalizeCritique(raw, { taste, cited }) {
  const path = 'review.critique';
  object(raw, path, ['generic', 'fan']);
  const used = new Set((taste?.dna?.devices || []).flatMap(device => device.anchors || []));
  const signatures = new Map((taste?.signatures || []).map(item => [item.id, item]));
  const generic = list(raw.generic, `${path}.generic`, { min: CRITIQUE_LIMITS.generic, max: CRITIQUE_LIMITS.generic }).map((item, index) => {
    const at = `${path}.generic[${index}]`;
    object(item, at, ['choice', 'capture', 'signature', 'anchor', 'action']);
    const choiceText = text(item.choice, `${at}.choice`, { min: 10, max: 200 });
    const capture = cited(item.capture, `${at}.capture`);
    const signature = item.signature === undefined || item.signature === null ? null : text(item.signature, `${at}.signature`, { max: 40 });
    if (signature && taste && !signatures.has(signature)) fail(`${at}.signature`, signatures.size ? `Use a signature the host finds on this page: ${[...signatures.keys()].join(', ')}.` : 'The host finds no default-look signature on this page; leave signature out.');
    const anchor = item.anchor === undefined || item.anchor === null ? null : text(item.anchor, `${at}.anchor`, { max: 160 });
    if (anchor && taste && !used.has(anchor)) fail(`${at}.anchor`, 'Name a ref that a device of your DNA anchors, exactly as the taste input lists it, when that anchor requires this choice.');
    const action = choice(item.action, CRITIQUE_ACTIONS, `${at}.action`);
    if (action === 'kept' && !anchor) fail(`${at}.action`, 'Keep a generic choice only when an anchor of your DNA requires it: name that anchor, or replace the choice.');
    return { choice: choiceText, capture, ...(signature ? { signature } : {}), ...(anchor ? { anchor } : {}), action };
  });
  const named = new Set(generic.map(item => item.signature).filter(Boolean));
  const unnamed = [...signatures.values()].filter(item => !named.has(item.id));
  if (unnamed.length) fail(`${path}.generic`, `The page still carries ${unnamed.map(item => `${item.label} (${item.id})`).join(' and ')}: name each among your three generic choices with its signature, then keep it for an anchor that requires it or replace it.`);
  object(raw.fan, `${path}.fan`, ['works', 'verdict', 'why']);
  const own = taste?.input?.source === 'qloo-profile' ? 'qloo' : 'model-assumption';
  const works = (taste?.input?.entities || []).filter(entity => entity.source === own && !isQualityDomain(entity.domain));
  const head = own === 'qloo' ? [...works].sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)).slice(0, CRITIQUE_LIMITS.headWorks) : [];
  const names = [...new Set(list(raw.fan.works, `${path}.fan.works`, { min: CRITIQUE_LIMITS.minFanWorks, max: CRITIQUE_LIMITS.maxFanWorks }).map((value, index) => {
    const name = text(value, `${path}.fan.works[${index}]`, { min: 2, max: 120 });
    if (taste && works.length && !works.some(entity => normalizeTasteName(entity.name) === normalizeTasteName(name))) fail(`${path}.fan.works[${index}]`, `Name works of this run's taste input, exactly as it lists them, such as ${(head.length ? head : works).slice(0, 6).map(entity => entity.name).join(', ')}.`);
    return name;
  }))];
  if (head.length && names.filter(name => head.some(entity => normalizeTasteName(entity.name) === normalizeTasteName(name))).length < Math.min(CRITIQUE_LIMITS.headInFan, head.length)) {
    fail(`${path}.fan.works`, `Picture someone who loves the audience's best-loved works: name at least ${CRITIQUE_LIMITS.headInFan} of its highest-affinity works, such as ${head.slice(0, 6).map(entity => entity.name).join(', ')}.`);
  }
  const verdict = choice(raw.fan.verdict, FAN_VERDICTS, `${path}.fan.verdict`);
  const fan = { works: names, verdict, why: text(raw.fan.why, `${path}.fan.why`, { min: 10, max: 400 }) };
  return { generic, fan, open: generic.some(item => item.action === 'replaced') || verdict !== 'yes' };
}
