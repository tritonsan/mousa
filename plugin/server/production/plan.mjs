// The production plan: how each device of the binding DNA gets made. One step per device names a method from the
// host's capability list, the reading cluster it realizes and why; a step that needs a generator states how many
// pictures and a fallback that needs none. The plan also lists what a viewer should see in the captures, so the
// review judges the result against the agent's own intent. Hosts allow generation only as the plan states it.

import { TASTE_SCHEMA_VERSION } from '../culture/taste.mjs';
import { mediumProfile } from './media.mjs';
import { methodsFor } from './capabilities.mjs';
import { fail, plain, parsed, object, text, list, ident, integer } from './fields.mjs';

export const PLAN_LIMITS = Object.freeze({ maxSteps: 12, minCriteria: 2, maxCriteria: 6 });

/**
 * Validate a production plan against the validated DNA, the reading and the capability list. Every device is planned
 * once with an available method that makes its layer and whose tokens the device declares; every cluster is realized;
 * methods the study requires are used; generator counts stay within the host's limit. With capture available the plan
 * lists two to six review criteria.
 */
export function normalizeProductionPlan(raw, { dna, reading, capabilities } = {}) {
  if (!plain(dna) || !Array.isArray(dna.devices)) fail('dna', 'The validated DNA for this run is required.');
  if (!plain(reading) || !Array.isArray(reading.clusters)) fail('reading', 'The validated taste reading for this run is required.');
  if (!plain(capabilities) || !Array.isArray(capabilities.methods)) fail('capabilities', 'The host capability list for this run is required.');
  const profile = mediumProfile(capabilities.medium);
  const catalog = new Map(profile.methods.map(item => [item.id, item])), offered = new Map(capabilities.methods.map(item => [item.id, item]));
  const devices = new Map(dna.devices.map(device => [device.id, device])), clusters = new Map(reading.clusters.map(cluster => [cluster.id, cluster]));
  const clustersOf = device => reading.clusters.filter(cluster => (device.anchors || []).some(ref => cluster.refs.includes(ref))).map(cluster => cluster.id);
  const usable = (id, device, at, { fallback = false } = {}) => {
    const known = catalog.get(id), status = offered.get(id);
    const options = methodsFor(capabilities, device.layer, { generators: !fallback });
    if (!known || !status) fail(at, `Use a method of the ${profile.label.toLowerCase()} medium: ${profile.methods.map(item => item.id).join(', ')}.`);
    if (!status.available) fail(at, `${id} is not available here: ${status.reason} Methods for ${device.layer} here: ${options.join(', ') || 'none'}.`);
    if (!known.layers.includes(device.layer)) fail(at, `${id} makes ${known.layers.join(', ')}, not ${device.layer}. Methods for ${device.layer} here: ${options.join(', ')}.`);
    if (fallback && known.kind === 'generator') fail(at, `A fallback needs no generator. Use one of: ${options.join(', ')}.`);
    const needs = known.needs?.(device.tokens || {});
    if (needs) fail(at, `${id} needs ${needs} in device ${device.id}, and it has none. Choose another method, or revise the DNA before you build.`);
    return known;
  };
  const source = parsed(raw, 'plan');
  object(source, 'plan', ['schemaVersion', 'steps', 'review']);
  if (source.schemaVersion !== TASTE_SCHEMA_VERSION) fail('plan.schemaVersion', "Use schemaVersion '1.0'.");
  const planned = new Set(), totals = new Map();
  const steps = list(source.steps, 'plan.steps', { min: 1, max: PLAN_LIMITS.maxSteps }).map((step, index) => {
    const at = `plan.steps[${index}]`;
    object(step, at, ['device', 'method', 'cluster', 'why', 'count', 'fallback']);
    const id = text(step.device, `${at}.device`, { max: 40 });
    const device = devices.get(id);
    if (!device) fail(`${at}.device`, `Use a device ID of the saved DNA: ${[...devices.keys()].join(', ')}.`);
    if (planned.has(id)) fail(`${at}.device`, `Plan each device once; ${id} already has a step.`);
    planned.add(id);
    const method = usable(text(step.method, `${at}.method`, { max: 40 }), device, `${at}.method`);
    const clusterId = ident(step.cluster, `${at}.cluster`, { max: 20 });
    const cluster = clusters.get(clusterId);
    if (!cluster) fail(`${at}.cluster`, `Use a cluster ID of your reading: ${[...clusters.keys()].join(', ')}.`);
    if (!(device.anchors || []).some(ref => cluster.refs.includes(ref))) {
      const own = clustersOf(device);
      fail(`${at}.cluster`, `Device ${id} anchors none of cluster ${clusterId}'s refs. ${own.length ? `Its anchors belong to ${own.join(', ')}.` : 'Its anchors belong to no cluster; anchor it to a clustered ref in the DNA.'}`);
    }
    const result = { device: id, layer: device.layer, method: method.id, cluster: clusterId, why: text(step.why, `${at}.why`, { min: 10, max: 400 }) };
    if (method.kind === 'generator') {
      const limit = offered.get(method.id).perRun;
      if (step.count === undefined) fail(`${at}.count`, `State how many pictures this step needs, from 1 to ${limit}.`);
      result.count = integer(step.count, `${at}.count`, [1, limit]);
      totals.set(method.generator, (totals.get(method.generator) || 0) + result.count);
      if (step.fallback === undefined) fail(`${at}.fallback`, `Name a fallback that needs no generator, for when it cannot run: ${methodsFor(capabilities, device.layer, { generators: false }).join(', ')}.`);
      result.fallback = usable(text(step.fallback, `${at}.fallback`, { max: 40 }), device, `${at}.fallback`, { fallback: true }).id;
    } else {
      if (step.count !== undefined) fail(`${at}.count`, 'A count belongs only to a method that uses a generator.');
      if (step.fallback !== undefined) fail(`${at}.fallback`, 'A fallback belongs only to a method that uses a generator.');
    }
    return result;
  });
  const unplanned = [...devices.keys()].filter(id => !planned.has(id));
  if (unplanned.length) fail('plan.steps', `Plan every device of the DNA once. No step for: ${unplanned.join(', ')}.`);
  const realized = new Set(steps.map(step => step.cluster));
  const unrealized = reading.clusters.filter(cluster => !realized.has(cluster.id));
  if (unrealized.length) fail('plan.steps', `Realize every cluster of your reading in at least one step. Not realized: ${unrealized.map(cluster => `${cluster.id} (${cluster.name})`).join(', ')}.`);
  for (const id of capabilities.required || []) if (!steps.some(step => step.method === id)) {
    fail('plan.steps', `This study requires ${id} in both arms: use it for a device it can make (${catalog.get(id).layers.join(', ')}).`);
  }
  for (const [generator, total] of totals) {
    const limit = capabilities.generators[generator]?.perRun ?? 0;
    if (total > limit) fail('plan.steps', `The steps ask the ${generator} generator for ${total} pictures; this host allows ${limit} a run.`);
  }
  const capture = capabilities.review?.capture;
  const views = new Set((capture?.available ? capture.views : []).map(view => view.id)), criteria = new Set();
  const review = list(source.review, 'plan.review', capture?.available ? { min: PLAN_LIMITS.minCriteria, max: PLAN_LIMITS.maxCriteria } : { max: PLAN_LIMITS.maxCriteria }).map((item, index) => {
    const at = `plan.review[${index}]`;
    object(item, at, ['id', 'device', 'look', 'view']);
    const id = ident(item.id, `${at}.id`, { max: 20 });
    if (criteria.has(id)) fail(`${at}.id`, 'Use a unique criterion ID such as r1.');
    criteria.add(id);
    const device = text(item.device, `${at}.device`, { max: 40 });
    if (!devices.has(device)) fail(`${at}.device`, `Use a device ID of the saved DNA: ${[...devices.keys()].join(', ')}.`);
    if (item.view !== undefined && !views.has(item.view)) fail(`${at}.view`, views.size ? `Use a capture view: ${[...views].join(', ')}.` : 'This host captures no views.');
    return { id, device, look: text(item.look, `${at}.look`, { min: 10, max: 300 }), ...(item.view !== undefined ? { view: item.view } : {}) };
  });
  const generators = {};
  for (const step of steps.filter(item => item.count)) {
    const generator = catalog.get(step.method).generator;
    generators[generator] ||= { total: 0, devices: {} };
    generators[generator].total += step.count;
    generators[generator].devices[step.device] = step.count;
  }
  const materials = {};
  for (const step of steps) {
    const known = catalog.get(step.method);
    if (known.kind !== 'material') continue;
    const tokens = devices.get(step.device).tokens || {};
    const values = known.material === 'fonts' ? tokens.fonts : known.material === 'photos' ? tokens.images : known.material === 'tracks' ? [tokens.music].filter(Boolean) : [];
    materials[known.material] = [...new Set([...(materials[known.material] || []), ...(values || [])])];
  }
  const methods = [...new Set(steps.map(step => step.method))];
  const fitting = steps.filter(step => clusters.get(step.cluster).layers.includes(step.layer)).length;
  return { schemaVersion: TASTE_SCHEMA_VERSION, medium: profile.id, steps, review,
    uses: { methods, generators, materials },
    stats: { steps: steps.length, methods: methods.length, generatorSteps: steps.filter(step => step.count).length, clusters: realized.size,
      layerFit: steps.length ? Number((fitting / steps.length).toFixed(3)) : 0 },
    sourceType: 'model-interpretation' };
}

/**
 * How many pictures the plan lets one device request from a generator, and how many remain after `used`. A device
 * the plan did not give that generator gets none, with the reason the host returns to the agent.
 */
export function generationAllowance(plan, generator, device, used = 0) {
  const limit = plan?.uses?.generators?.[generator]?.devices?.[device] ?? 0;
  if (!limit) {
    const devices = Object.keys(plan?.uses?.generators?.[generator]?.devices || {});
    return { allowed: false, limit: 0, remaining: 0, reason: `The production plan gives ${device} no ${generator} generation${devices.length ? `; it plans ${generator} pictures for ${devices.join(', ')}` : ''}. Generate only as the plan states, or save the plan again first.` };
  }
  const remaining = Math.max(0, limit - used);
  return remaining ? { allowed: true, limit, remaining } : { allowed: false, limit, remaining: 0, reason: `The production plan gives ${device} ${limit} ${generator} picture${limit > 1 ? 's' : ''}, and ${used} ${used === 1 ? 'was' : 'were'} requested.` };
}

/** Whether a saved plan still describes this DNA: the same devices with the same layers. */
export function planMatchesDna(plan, dna) {
  const steps = new Map((plan?.steps || []).map(step => [step.device, step.layer]));
  const devices = dna?.devices || [];
  return devices.length === steps.size && devices.every(device => steps.get(device.id) === device.layer);
}
