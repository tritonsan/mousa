import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadDotEnv, getConfig, redact } from '../src/config.mjs';
import { QlooClient } from '../plugin/server/qloo/client.mjs';

const plan = { realQloo: true, modelCalls: 0, maximumApiCalls: 10,
  stages: ['Resolve three explicitly named references', 'Explore two relevant insights domains', 'Compare a real returned entity shortlist', 'Check conflicting official game category spellings'] };
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, executed: false, instruction: 'Pass --run to use the locally configured Qloo credential. No request has been made.' }));
} else await run();

async function run() {
  loadDotEnv(); const config = getConfig();
  assert.ok(config.qlooKey, 'The local Qloo key is not configured.');
  assert.equal(config.qlooBaseUrl, 'https://hackathon.api.qloo.com');
  const report = { ...plan, startedAt: new Date().toISOString(), calls: [], sources: [], errors: [], categoryProbes: [], verified: false };
  const reportPath = path.join(config.rootDir, 'output', `qloo-live-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
  async function save() { await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2), config)); }
  const fetchAudit = async (url, options) => {
    assert.ok(report.calls.length < plan.maximumApiCalls, 'The live diagnostic request budget is exhausted.');
    const call = { url: String(url), method: options.method, time: new Date().toISOString(), authenticationHeader: 'X-Api-Key', status: null };
    report.calls.push(call);
    try {
      const response = await fetch(url, options); call.status = response.status;
      if (response.ok) {
        const raw = await response.clone().json();
        const rows = Array.isArray(raw.results) ? raw.results : raw.results?.entities || raw.results?.tags || raw.entities || [];
        call.shape = { topLevelKeys: Object.keys(raw).slice(0, 30), queryKeys: Object.keys(raw.query || {}).slice(0, 40),
          firstResultKeys: Object.keys(rows[0] || {}).slice(0, 40), firstResultQueryKeys: Object.keys(rows[0]?.query || {}).slice(0, 40),
          resultCount: rows.length, firstResultType: rows[0]?.subtype || rows[0]?.type || null };
      }
      await save(); return response;
    } catch (error) { call.error = 'Network or JSON response inspection failed.'; await save(); throw error; }
  };
  const client = new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl, fetchImpl: fetchAudit });
  async function record(tool, parameters) {
    const source = tool === 'qloo_search_entities' ? await client.searchEntities(parameters) : await client.getInsights(parameters);
    source.id = `L${String(report.sources.length + 1).padStart(3, '0')}`;
    report.sources.push({ tool, ...source }); await save();
    console.log(JSON.stringify({ tool, status: source.status, results: source.results.length, names: source.results.slice(0, 3).map(entity => entity.name) }));
    return source;
  }
  try {
    const resolved = [];
    for (const [query, type] of [['Nujabes', 'artist'], ['Paterson', 'movie'], ['Muji', 'brand']]) {
      const source = await record('qloo_search_entities', { query, types: [type], limit: 5 });
      const exact = source.results.find(entity => entity.name.toLowerCase() === query.toLowerCase());
      assert.ok(exact, `No unambiguous exact catalog name was returned for ${query}.`); resolved.push(exact);
    }
    const seeds = resolved.slice(0, 2).map(entity => entity.entityId);
    const artists = await record('qloo_get_insights', { seedEntityIds: seeds, resultType: 'artist', limit: 6, explainability: true });
    const brands = await record('qloo_get_insights', { seedEntityIds: seeds, resultType: 'brand', limit: 6, explainability: true });
    assert.ok(artists.results.length && brands.results.length, 'Two declared cultural domains must return usable insights.');
    const shortlist = await record('qloo_get_insights', { seedEntityIds: [resolved[0].entityId], resultType: 'artist', candidateEntityIds: artists.results.slice(0, 3).map(entity => entity.entityId), limit: 3, explainability: true });
    assert.ok(shortlist.results.every(entity => artists.results.slice(0, 3).some(candidate => candidate.entityId === entity.entityId)), 'The real candidate filter was not honored.');
    for (const spelling of ['videogame', 'video_game']) {
      const url = new URL('/v2/insights', config.qlooBaseUrl);
      url.searchParams.set('filter.type', `urn:entity:${spelling}`); url.searchParams.set('signal.interests.entities', resolved[1].entityId); url.searchParams.set('take', '2');
      const response = await fetchAudit(url, { method: 'GET', headers: { 'X-Api-Key': config.qlooKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      const probe = { spelling, httpStatus: response.status, accepted: response.ok };
      if (response.ok) { const data = await response.json(); const rows = data.results?.entities || data.results || []; probe.results = rows.length; probe.returnedTypes = [...new Set(rows.map(entity => entity.subtype || entity.type))]; }
      report.categoryProbes.push(probe); await save(); console.log(JSON.stringify(probe));
    }
    assert.ok(report.categoryProbes.some(probe => probe.accepted), 'Neither documented game spelling was accepted.');
    report.verified = true;
  } catch (error) {
    report.errors.push({ code: error.code || 'LIVE_VERIFICATION_FAILED', message: redact(error.message, config) });
    console.log(JSON.stringify({ verified: false, error: report.errors.at(-1) })); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); await save();
    console.log(JSON.stringify({ reportPath, verified: report.verified, actualApiCalls: report.calls.length }));
  }
}
