import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../src/config.mjs';
import { TEMPLATE_TASTE_DOMAINS } from '../src/jobs.mjs';
import { QUALITY_DOMAIN, buildTasteProfile, tasteInputFromProfile, compactTasteInput, normalizeTasteName, selectTasteReferences } from '../plugin/server/culture/taste.mjs';
import { GAME_MEDIUM } from '../game/harness/fixtures.mjs';
import { replayClient } from '../src/taste-replay.mjs';

// Replays a recorded taste pass through the current buildTasteProfile, answering every request from the job's own
// evidence records. No Qloo request and no model run: it shows what the shared qualities and the required anchors
// would have been for a profile Qloo already returned. Site jobs keep their evidence in meta.json; game character
// pairs keep it in their pair folder's taste.json.
const config = getConfig();
const ids = process.argv.slice(2).filter(item => !item.startsWith('--'));
if (!ids.length) {
  console.log('Usage: node scripts/replay-taste-profile.mjs <job id or prefix> [...]. Reads data/<job>/meta.json (and a character pair\'s taste.json); makes no request.');
  process.exit(1);
}

/** The recorded taste pass of a job: its evidence, the prediction and the taste input the Qloo on run received. */
async function recordedPass(job) {
  if (job.kind === 'character') {
    const pairDir = path.join(config.dataDir, job.id, job.pairId);
    const taste = JSON.parse(await fs.readFile(path.join(pairDir, 'taste.json'), 'utf8'));
    if (!Array.isArray(taste.evidence) || !taste.evidence.length) throw new Error(`Character pair ${job.id} kept no taste-pass responses, so it cannot be replayed; pairs record them from October 5, 2026 on.`);
    const session = JSON.parse(await fs.readFile(path.join(pairDir, 'work', 'qloo-on', 'host', 'session.json'), 'utf8'));
    return { evidence: taste.evidence, profile: taste.profile, assumption: session.assumption, input: session.input, brief: job.brief.brief,
      references: selectTasteReferences(job.brief.references).references, domains: taste.profile.domains || [], knownNames: job.brief.knownNames || [], medium: [...GAME_MEDIUM] };
  }
  const run = job.runs.find(item => item.mode === 'qloo' && item.taste?.profile);
  if (!run) throw new Error(`Job ${job.id} has no recorded Qloo taste profile.`);
  return { evidence: run.evidence || [], profile: run.taste.profile, assumption: run.taste.assumption, input: run.taste.input, brief: job.brief,
    references: job.taste.references, domains: job.taste.domains || [], location: job.taste.location, knownNames: job.taste.knownNames || [], medium: TEMPLATE_TASTE_DOMAINS[job.templateId] || [] };
}

async function findJob(prefix) {
  const folders = await fs.readdir(config.dataDir);
  const matches = folders.filter(name => name.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`${prefix} matches ${matches.length} recorded jobs.`);
  return JSON.parse(await fs.readFile(path.join(config.dataDir, matches[0], 'meta.json'), 'utf8'));
}

const view = entity => entity ? { ref: entity.ref, name: entity.name, domain: entity.domain, ...(entity.family ? { family: entity.family, count: entity.count, domains: entity.domains } : {}),
  ...(entity.affinity !== undefined ? { affinity: entity.affinity } : {}), surprise: entity.surprise, ...(entity.knownFromBrief ? { knownFromBrief: true } : {}) } : null;

const reports = [];
for (const id of ids) {
  const job = await findJob(id);
  const pass = await recordedPass(job);
  const missing = [];
  const domains = [...new Set([...pass.domains, QUALITY_DOMAIN])];
  const profile = await buildTasteProfile({ client: replayClient(pass.evidence, missing), references: pass.references, domains, location: pass.location,
    knownNames: pass.knownNames, retryDelayMs: 0, rateLimitRetries: 0 });
  // A recorded prediction may predate the qualities domain; its style and aesthetic qualities still mark predicted qualities.
  const assumption = pass.assumption;
  const input = tasteInputFromProfile(profile, assumption, { medium: pass.medium });
  const before = pass.input;
  const run = { taste: { profile: pass.profile } };
  const named = (source, refs) => refs.map(ref => view(source.entities.find(entity => entity.ref === ref)));
  const qualities = input.entities.filter(entity => entity.domain === QUALITY_DOMAIN && entity.source === 'qloo');
  const works = input.entities.filter(entity => entity.source === 'qloo' && !['style', 'aesthetic', QUALITY_DOMAIN].includes(entity.domain));
  const report = { jobId: job.id, kind: job.kind || 'build', brief: pass.brief.slice(0, 160), references: pass.references.map(ref => ref.name), replayedRequests: profile.calls, recordedRequests: run.taste.profile.calls,
    missing, status: profile.status,
    qualities: Object.fromEntries(['look', 'mood', 'meaning'].map(family => [family, qualities.filter(quality => quality.family === family)
      .map(quality => ({ name: quality.name, count: quality.count, domains: quality.domains, score: quality.score, affinity: quality.affinity, examples: quality.examples, surprise: quality.surprise }))])),
    requiredAnchors: { recorded: named(before, before.requiredAnchors), replayed: named(input, input.requiredAnchors) },
    // Works whose returned tags hold no look, mood or meaning tag at all; they carry none of the shared qualities either.
    worksWithoutQualities: works.filter(entity => !profile.entities.find(item => item.ref === entity.ref)?.facets).map(entity => `${entity.name} (${entity.domain})`),
    // The summed score of the shared qualities each work carries, as the anchor selection computes it, for the three most central works per domain.
    centrality: (() => {
      const scores = new Map(qualities.map(quality => [normalizeTasteName(quality.name), quality.score]));
      const rows = profile.entities.filter(entity => works.some(work => work.ref === entity.ref)).map(entity => ({ name: entity.name, domain: entity.domain, affinity: entity.affinity,
        centrality: Number([...new Set(Object.values(entity.facets || {}).flat().map(normalizeTasteName))].reduce((sum, key) => sum + (scores.get(key) ?? 0), 0).toFixed(2)) }));
      return Object.fromEntries([...new Set(rows.map(row => row.domain))].map(domain => [domain, rows.filter(row => row.domain === domain).sort((a, b) => b.centrality - a.centrality).slice(0, 3)
        .map(({ name, centrality, affinity }) => ({ name, centrality, affinity }))]));
    })(),
    metrics: input.metrics, recordedMetrics: before.metrics,
    sizes: { recordedInputBytes: Buffer.byteLength(JSON.stringify(before, null, 2)), replayedInputBytes: Buffer.byteLength(JSON.stringify(input, null, 2)),
      agentViewBytes: Buffer.byteLength(JSON.stringify(compactTasteInput(input))) },
    limitations: profile.limitations };
  reports.push(report);
}

const file = path.join(config.rootDir, 'output', `taste-qualities-replay-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, JSON.stringify({ createdAt: new Date().toISOString(), method: 'Recorded evidence replayed through the current host taste pass; no Qloo request and no model run.', reports }, null, 2));
for (const report of reports) {
  console.log(`\n${report.jobId.slice(0, 8)} · ${report.references.join(', ')} · ${report.replayedRequests} replayed of ${report.recordedRequests} recorded requests${report.missing.length ? ` · missing: ${report.missing.join('; ')}` : ''}`);
  for (const [family, items] of Object.entries(report.qualities)) console.log(`  ${family.padEnd(7)} ${items.map(item => `${item.name} (${item.count} works, ${item.domains.length} domains)`).join(' · ') || 'none'}`);
  const line = anchors => anchors.map(anchor => anchor ? `${anchor.name}${anchor.family ? ` [${anchor.family}]` : ` <${anchor.domain}>`}` : '?').join(' · ');
  console.log(`  anchors before: ${line(report.requiredAnchors.recorded)}`);
  console.log(`  anchors now:    ${line(report.requiredAnchors.replayed)}`);
  console.log(`  works without typed qualities: ${report.worksWithoutQualities.join(', ') || 'none'}`);
  console.log(`  most central: ${Object.entries(report.centrality).map(([domain, rows]) => `${domain} ${rows.map(row => `${row.name} ${row.centrality}`).join(', ')}`).join(' | ')}`);
  console.log(`  input ${report.sizes.recordedInputBytes} -> ${report.sizes.replayedInputBytes} bytes; agent view ${report.sizes.agentViewBytes} bytes`);
}
console.log(`\n${file}`);
