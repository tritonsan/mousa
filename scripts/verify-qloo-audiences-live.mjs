import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';

/**
 * Live probe of Qloo audiences and of the extra tag rankings, before the plugin relies on them: the audience type list,
 * audience search by words and by category, Insights weighted by an audience alone, with place and age, and an
 * emotional-tone ranking for the recorded Gather seeds. Raw response shapes are recorded (bounded), because the client
 * does not read audiences yet. At most 8 requests, no model calls. Prints the plan unless given --run.
 */
const gather = { Nujabes: '00000000-0000-4000-8000-000000000076', Paterson: '00000000-0000-4000-8000-00000000006A' };
const AUDIENCE = '{audience}';
// --audience=<urn> presets the audience; --steps=5,6,7 runs only those steps (1-based), so a rerun repeats nothing.
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const steps = [
  { label: 'audience types', path: '/v2/audiences/types', params: { take: 50 } },
  { label: 'audience search: remote workers', path: '/v2/audiences', params: { 'filter.query': 'remote', take: 10 }, pick: true },
  { label: 'audience search: parents', path: '/v2/audiences', params: { 'filter.query': 'parent', take: 10 }, pick: true },
  { label: 'audiences in hobbies and interests', path: '/v2/audiences', params: { 'filter.parents.types': 'urn:audience:hobbies_and_interests', take: 10 } },
  { label: 'brands for the audience alone', path: '/v2/insights', params: { 'filter.type': 'urn:entity:brand', 'signal.demographics.audiences': AUDIENCE, take: 10 } },
  { label: 'aesthetic tags for the audience alone', path: '/v2/insights', params: { 'filter.type': 'urn:tag', 'filter.tag.types': 'urn:tag:aesthetic_property:qloo', 'signal.demographics.audiences': AUDIENCE, take: 8 } },
  { label: 'films for the audience in Istanbul, ages 25-34', path: '/v2/insights', params: { 'filter.type': 'urn:entity:movie', 'signal.demographics.audiences': AUDIENCE, 'signal.demographics.audiences.weight': 'high', 'signal.location.query': 'Istanbul', 'signal.demographics.age': '25_to_29,30_to_34', take: 10 } },
  { label: 'emotional tone tags for the Gather seeds', path: '/v2/insights', params: { 'filter.type': 'urn:tag', 'filter.tag.types': 'urn:tag:emotional_tone:qloo', 'signal.interests.entities': Object.values(gather).join(','), take: 8 } },
];
const plan = { qlooRequests: steps.length, modelCalls: 0, steps: steps.map(step => `${step.label}: GET ${step.path}`) };

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, executed: false, instruction: 'Pass --run to use the locally configured Qloo credential.' }, null, 2));
} else await run();

/** A bounded picture of a response: its keys, the row container and up to four rows with their ID, name and types. */
function shape(payload) {
  const results = payload?.results;
  const container = Array.isArray(results) ? 'results[]' : results && typeof results === 'object'
    ? Object.keys(results).filter(key => Array.isArray(results[key])).map(key => `results.${key}[]`).join(', ') || 'results{}' : 'none';
  const rows = Array.isArray(results) ? results : Object.values(results || {}).find(Array.isArray) || [];
  const brief = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['properties', 'external', 'query'].includes(key))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 120) : Array.isArray(value) ? value.slice(0, 6) : value && typeof value === 'object' ? Object.keys(value).slice(0, 10) : value]));
  return { keys: Object.keys(payload || {}), container, count: rows.length, rows: rows.slice(0, 4).map(brief), ...(payload?.query ? { query: JSON.stringify(payload.query).slice(0, 600) } : {}) };
}

async function run() {
  loadDotEnv();
  const config = getConfig();
  assert.ok(config.qlooKey, 'The local Qloo credential is required.');
  const report = { ...plan, baseUrl: config.qlooBaseUrl, startedAt: new Date().toISOString(), results: [],
    interpretation: 'Response shapes and returned names, recorded to build the client. Affinities rank results for these signals only.' };
  // Insights take the audience's URN (urn:audience:<type>:<name>), not its entity UUID.
  let audience = option('audience');
  const only = option('steps') ? new Set(option('steps').split(',').map(Number)) : null;
  for (const [index, step] of steps.entries()) {
    if (only && !only.has(index + 1)) continue;
    const params = Object.fromEntries(Object.entries(step.params).map(([key, value]) => [key, value === AUDIENCE ? audience : value]));
    const entry = { label: step.label, path: step.path, params };
    if (Object.values(params).includes(null)) { entry.status = 'skipped'; entry.reason = 'No audience ID was found to use.'; report.results.push(entry); console.log(`${step.label}: skipped`); continue; }
    const url = new URL(`${config.qlooBaseUrl}${step.path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    try {
      const response = await fetch(url, { headers: { 'X-Api-Key': config.qlooKey, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      entry.httpStatus = response.status;
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { entry.body = text.slice(0, 300); }
      if (payload) entry.shape = shape(payload);
      if (step.pick && response.ok && !audience) {
        const first = (entry.shape?.rows || []).find(row => typeof row.id === 'string' && row.id.startsWith('urn:audience:'));
        if (first) { audience = first.id; entry.picked = audience; }
      }
      entry.status = response.ok ? 'ok' : 'error';
    } catch (error) {
      entry.status = 'error';
      entry.error = String(error?.message || error).slice(0, 200);
    }
    report.results.push(entry);
    console.log(`${step.label}: ${entry.status} ${entry.httpStatus ?? ''} ${entry.shape ? `${entry.shape.container} ×${entry.shape.count}` : entry.error || entry.body || ''}`);
    for (const row of entry.shape?.rows || []) console.log(`  ${JSON.stringify(row).slice(0, 260)}`);
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(config.rootDir, 'output', `qloo-audiences-probe-${report.startedAt.replace(/[:.]/gu, '-')}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
}
