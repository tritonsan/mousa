import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig, redact } from '../src/config.mjs';
import { QlooClient } from '../src/qloo/client.mjs';
import { DEFAULT_TASTE_DOMAINS, QUALITY_DOMAIN, TASTE_LIMITS, buildTasteProfile, normalizeTasteAssumption, tasteInputFromProfile, compactTasteInput } from '../plugin/server/culture/taste.mjs';

// Live check of the host taste pass only: real Qloo requests, no model job.
const argument = name => process.argv.filter(item => item.startsWith(`--${name}=`)).map(item => item.slice(name.length + 3));
const references = (argument('reference').length ? argument('reference') : ['Nujabes', 'Paterson']).map(name => ({ name, role: 'audience', origin: 'user-provided' }));
const location = argument('location')[0];
const domains = [...DEFAULT_TASTE_DOMAINS];
// Authored before the run so the report can show how surprise flags work on live data. It is a fixture, not a model prediction.
const fixturePrediction = { schemaVersion: '1.0', audienceSummary: 'Script-authored fixture prediction for a quiet, everyday-poetry audience.', predictions: {
  brand: ['Muji', 'Aesop', 'Patagonia'], movie: ['Paterson', 'Lost in Translation', 'Perfect Days'], artist: ['Nujabes', 'Bonobo', 'Khruangbin'],
  book: ['Norwegian Wood', 'The Little Prince', 'Invisible Cities'], tv_show: ['Midnight Diner', 'Twin Peaks', "Chef's Table"],
  style: ['Quiet', 'Melancholic', 'Dreamlike'], aesthetic: ['Minimal', 'Handmade', 'Warm wood'], qualities: ['Contemplative', 'Nostalgia', 'Everyday life'] } };
// Qualities are derived from the returned works, so they add no request.
const requested = domains.filter(domain => domain !== QUALITY_DOMAIN);
const plan = { scope: 'One bounded host taste pass against the live Qloo API. No Kiro or other model job is started.', references, domains, ...(location ? { location } : {}),
  maximumQlooRequests: TASTE_LIMITS.calls, expectedRequests: `${references.length}-${references.length * 2} resolution requests plus ${requested.length + 2} insights requests`,
  predictionSource: 'script-authored fixture, not a model prediction' };

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, status: 'planned-only', instruction: 'Pass --run to send these requests with the configured QLOO_API_KEY. Override seeds with --reference=Name (repeatable) and add --location=City.' }, null, 2));
} else {
  loadDotEnv(); const config = getConfig();
  const reportPath = path.join(config.rootDir, 'output', `qloo-taste-live-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
  const report = { ...plan, startedAt: new Date().toISOString(), verified: false, reportPath };
  try {
    if (!config.qlooKey) throw new Error('QLOO_API_KEY is not configured.');
    // Checked before any request, so a fixture that no longer covers every domain costs no Qloo request.
    const assumption = normalizeTasteAssumption(fixturePrediction, { domains });
    const calls = [];
    const profile = await buildTasteProfile({ client: new QlooClient({ apiKey: config.qlooKey, baseUrl: config.qlooBaseUrl }), references, domains, location,
      knownNames: references.map(ref => ref.name), onCall: call => { calls.push({ tool: call.tool, stage: call.meta?.stage, domain: call.meta?.domain, band: call.meta?.band, status: call.status, ...(call.error ? { error: call.error.code } : {}) }); } });
    const input = profile.status === 'ok' ? tasteInputFromProfile(profile, assumption) : null;
    const byDomain = Object.fromEntries(domains.map(domain => [domain, profile.entities.filter(entity => entity.domain === domain).map(entity => ({ name: entity.name, band: entity.band, affinity: entity.affinity, popularity: entity.popularity,
      ...(entity.family ? { family: entity.family, count: entity.count, domains: entity.domains, examples: entity.examples } : {}),
      ...(input ? { surprise: input.entities.find(item => item.ref === entity.ref)?.surprise } : {}), tags: (entity.tags || []).slice(0, 4) }))]));
    Object.assign(report, { status: profile.status, requests: profile.calls, calls, seeds: profile.seeds, results: profile.results, signature: profile.signature, limitations: profile.limitations,
      entitiesByDomain: byDomain, ...(input ? { metrics: input.metrics, requiredAnchors: compactTasteInput(input).requiredAnchors } : {}) });
    report.verified = profile.status === 'ok' && profile.calls <= TASTE_LIMITS.calls && calls.length === profile.calls;
    if (!report.verified) process.exitCode = 1;
  } catch (error) { report.error = redact(error.message, config); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2), config));
    console.log(JSON.stringify({ reportPath, status: report.status, requests: report.requests, metrics: report.metrics || null, verified: report.verified, error: report.error }));
  }
}
