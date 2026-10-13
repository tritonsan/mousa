import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { QlooClient } from '../plugin/server/qloo/client.mjs';
import { buildTasteProfile } from '../plugin/server/culture/taste.mjs';

/**
 * Live probe of seed resolution for the audience references of the Echo Atlas and Gather briefs, through the host
 * taste pass itself. Only Search and tag Search requests are sent; Insights is replaced locally, so no profile is built.
 */
const references = ['Outer Wilds', 'Studio Ghibli films', 'ambient music', 'Nujabes', 'Paterson'];
const plan = { references, qlooRequests: 'one Search per reference, plus a tag Search when a reference names a genre or nothing matched', insightsRequests: 0, modelCalls: 0 };

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, executed: false, instruction: 'Pass --run to use the locally configured Qloo credential.' }, null, 2));
} else await run();

async function run() {
  loadDotEnv();
  const config = getConfig();
  assert.ok(config.qlooKey, 'The local Qloo credential is required.');
  const live = new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl });
  const calls = [];
  const client = { searchEntities: input => live.searchEntities(input), searchTags: input => live.searchTags(input),
    getInsights: async () => ({ status: 'empty', results: [], evidence: { provider: 'local', interpretation: 'Insights are not requested by this probe.' } }) };
  const report = { ...plan, startedAt: new Date().toISOString(),
    interpretation: 'How the host taste pass resolves each reference. A seed is a catalog match the pass would use, not an audience claim.' };
  const profile = await buildTasteProfile({ client, references: references.map(name => ({ name, role: 'audience' })), domains: ['movie'], deepCuts: false,
    onEvidence: record => { if (record.tool !== 'qloo_get_insights') calls.push({ tool: record.tool, query: record.query, status: record.status, results: (record.results || []).slice(0, 6).map(row => ({ name: row.name, id: row.entityId, type: row.type })) }); } });
  report.seeds = profile.seeds.map(({ name, resolution, matchedName, type, tagId, entityId, limitation, candidates }) => ({ name, resolution, ...(matchedName ? { matchedName } : {}),
    ...(type ? { type } : {}), ...(tagId ? { tagId } : {}), ...(entityId ? { entityId } : {}), ...(limitation ? { limitation } : {}), ...(candidates ? { candidates } : {}) }));
  report.requests = calls;
  report.finishedAt = new Date().toISOString();
  for (const seed of report.seeds) console.log(`${seed.name}: ${seed.resolution}${seed.matchedName ? ` → ${seed.matchedName}` : ''}${seed.type || seed.tagId ? ` (${seed.type || seed.tagId})` : ''}${seed.limitation ? ` — ${seed.limitation}` : ''}`);
  console.log(`Qloo requests: ${calls.length}`);
  const reportPath = path.join(config.rootDir, 'output', `qloo-seeds-probe-${report.startedAt.replace(/[:.]/gu, '-')}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
}
