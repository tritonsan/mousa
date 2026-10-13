import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { QlooClient } from '../plugin/server/qloo/client.mjs';

/**
 * Live probe of audience-level style tags: tag Insights for the Gather audience seeds (Nujabes and Paterson, resolved
 * in the recorded live runs), filtered to style, aesthetic and music-feel tag types. No model jobs and no Search calls.
 */
const seeds = { Nujabes: '00000000-0000-4000-8000-000000000076', Paterson: '00000000-0000-4000-8000-00000000006A' };
const requests = [
  { label: 'style, aesthetic and music feel', input: { tagTypes: ['urn:tag:style:qloo', 'urn:tag:aesthetic_property:qloo', 'urn:tag:music:qloo'], limit: 12 } },
  { label: 'aesthetic properties only', input: { tagTypes: ['urn:tag:aesthetic_property:qloo'], limit: 8 } },
  { label: 'style of films and TV', input: { tagTypes: ['urn:tag:style:qloo'], parentTypes: ['movie', 'tv_show'], limit: 8 } },
];
const plan = { qlooRequests: requests.length, modelCalls: 0, seeds, requests: requests.map(request => request.label) };

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, executed: false, instruction: 'Pass --run to use the locally configured Qloo credential.' }, null, 2));
} else await run();

async function run() {
  loadDotEnv();
  const config = getConfig();
  assert.ok(config.qlooKey, 'The local Qloo credential is required.');
  const client = new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl });
  const report = { ...plan, startedAt: new Date().toISOString(), results: [],
    interpretation: 'Tags ranked by Qloo affinity for the seeds. A requested tag-type filter is checked against the returned tag IDs, not assumed.' };
  for (const request of requests) {
    const entry = { label: request.label, input: request.input };
    try {
      const result = await client.getInsights({ seedEntityIds: Object.values(seeds), resultType: 'tag', explainability: true, ...request.input });
      entry.status = result.status;
      entry.tags = result.results.map(tag => ({ id: tag.entityId, name: tag.name, ...(tag.affinity !== undefined ? { affinity: Number(tag.affinity.toFixed(4)) } : {}) }));
      entry.typesHonored = entry.tags.every(tag => request.input.tagTypes.some(type => tag.id.startsWith(`${type}:`)));
    } catch (error) {
      entry.status = 'error';
      entry.error = { code: error.code || 'ERROR', message: String(error.message).slice(0, 300) };
    }
    report.results.push(entry);
    console.log(`${entry.label}: ${entry.status}${entry.tags ? `\n  ${entry.tags.map(tag => `${tag.name} (${tag.affinity ?? '-'}) ${tag.id}`).join('\n  ')}` : ` ${entry.error?.code}`}`);
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(config.rootDir, 'output', `qloo-style-probe-${report.startedAt.replace(/[:.]/gu, '-')}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
}
