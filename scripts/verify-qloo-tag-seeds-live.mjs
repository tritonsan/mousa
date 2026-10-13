import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { QlooClient } from '../plugin/server/qloo/client.mjs';
import { DEFAULT_TASTE_DOMAINS, TASTE_LIMITS, buildTasteProfile } from '../plugin/server/culture/taste.mjs';

/**
 * Live check of the whole host taste pass for the Echo Atlas references. Their Ambient genre tag seed had made the
 * style and aesthetic rankings return HTTP 500 and the artist request time out. Search and Insights requests are sent
 * with the locally configured credential; no model job starts.
 */
const references = ['Outer Wilds', 'Studio Ghibli films', 'ambient music'];
const domains = [...DEFAULT_TASTE_DOMAINS, 'videogame'];
const plan = { references, domains, maximumQlooRequests: TASTE_LIMITS.calls, modelCalls: 0 };

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, executed: false, instruction: 'Pass --run to use the locally configured Qloo credential.' }, null, 2));
} else await run();

async function run() {
  loadDotEnv();
  const config = getConfig();
  assert.ok(config.qlooKey, 'The local Qloo credential is required.');
  const calls = [];
  const startedAt = new Date().toISOString();
  const profile = await buildTasteProfile({ client: new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl }), references: references.map(name => ({ name, role: 'audience' })), domains,
    onCall: ({ tool, input, meta, status, error }) => { calls.push({ tool, ...(meta?.domain ? { domain: meta.domain, band: meta.band } : { query: input?.query }),
      ...(meta?.seeds ? { seeds: meta.seeds } : {}), tagSeeds: Boolean(input?.seedTagIds?.length), status, ...(error ? { error: error.code } : {}) }); } });
  const names = (domain, band = 'core') => profile.entities.filter(entity => entity.domain === domain && entity.band === band).map(entity => entity.name);
  const mixed = profile.seeds.some(seed => seed.resolution === 'entity') && profile.seeds.some(seed => seed.resolution === 'tag');
  const tagRequests = calls.filter(call => call.domain === 'style' || call.domain === 'aesthetic');
  const report = { ...plan, startedAt, finishedAt: new Date().toISOString(), status: profile.status, requests: profile.calls, calls,
    seeds: profile.seeds.map(({ name, resolution, matchedName, type, tagId, entityId, limitation }) => ({ name, resolution, ...(matchedName ? { matchedName } : {}), ...(type ? { type } : {}),
      ...(tagId ? { tagId } : {}), ...(entityId ? { entityId } : {}), ...(limitation ? { limitation } : {}) })),
    results: profile.results, limitations: profile.limitations, tags: { style: names('style'), aesthetic: names('aesthetic') },
    entities: Object.fromEntries(profile.results.filter(result => result.domain !== 'style' && result.domain !== 'aesthetic').map(result => [`${result.domain} (${result.band})`, names(result.domain, result.band).slice(0, 6)])),
    checks: { entityAndTagSeeds: mixed, tagRankingsWithoutTagSeeds: tagRequests.length > 0 && tagRequests.every(call => !call.tagSeeds),
      failedDomains: profile.results.filter(result => result.status === 'error').map(result => `${result.domain} (${result.band}): ${result.error?.code}`) },
    interpretation: 'Whether the fixed pass returns style and aesthetic tags and artist entities for these seeds today. One pass is a snapshot of the hackathon API, not a guarantee.' };
  report.verified = profile.status === 'ok' && mixed && report.checks.tagRankingsWithoutTagSeeds && profile.calls === calls.length && profile.calls <= TASTE_LIMITS.calls;
  const reportPath = path.join(config.rootDir, 'output', `qloo-tag-seeds-probe-${startedAt.replace(/[:.]/gu, '-')}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const call of calls) console.log(`${call.tool} ${call.domain ? `${call.domain} (${call.band})` : call.query}${call.seeds ? ' [entity seeds only]' : ''}${call.tagSeeds ? ' [tag seed]' : ''}: ${call.status}${call.error ? ` ${call.error}` : ''}`);
  console.log(`style: ${report.tags.style.join(', ') || 'none'}\naesthetic: ${report.tags.aesthetic.join(', ') || 'none'}`);
  console.log(`status ${profile.status}, ${profile.calls} requests, verified ${report.verified}\nReport: ${reportPath}`);
  if (!report.verified) process.exitCode = 1;
}
