import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig, redact } from '../src/config.mjs';

const brief = 'Create an original, polished seasonal food discovery website for Gather, a fictional small food producer. The audience likes Nujabes and the film Paterson; Muji is a brand reference, not an audience preference. Choose a distinctive creative direction for the homepage, seasonal catalogue and collection presentation. Preserve every sample product, price and the working search, category filter, sort, selection and request form. Keep all presentation in English. Treat associations as creative starting points, not demographic facts or proof of design quality. Both comparison variants must receive the same starting facts and references.';
const cultureBrief = {
  brand: { notes: 'Gather is a fictional seasonal food producer. Its existing sample product facts and local browsing interactions must remain usable.', protectedFiles: ['app.js'], protectedSnippets: [] },
  audiences: [{ id: 'a1', label: 'Quiet discovery audience — fictional test brief', references: ['Nujabes', 'Paterson'] }],
  creativeContext: { domain: 'web', referencePolicy: 'ask', references: [
    { name: 'Nujabes', role: 'audience', origin: 'user-provided', audienceId: 'a1' },
    { name: 'Paterson', role: 'audience', origin: 'user-provided', audienceId: 'a1' },
    { name: 'Muji', role: 'brand', origin: 'user-provided' },
  ], constraints: ['Preserve sample product facts, prices and all existing local interactions.', 'Keep audience preferences distinct from the brand reference.', 'All website content and research explanations must be English.'] },
};
const plan = { model: 'claude-opus-5.5', starter: 'local-food', maximumModelJobs: 3, brief, cultureBrief,
  scope: 'One shared preparation, one baseline website and one live Qloo-assisted website. This checks integration and traceability, not superior design quality.' };
const existingJobId = process.argv.find(argument => argument.startsWith('--verify-job='))?.slice('--verify-job='.length);
const reusePreparationId = process.argv.find(argument => argument.startsWith('--from-preparation='))?.slice('--from-preparation='.length);
if (!process.argv.includes('--run') && !existingJobId) {
  console.log(JSON.stringify({ ...plan, status: 'planned-only', instruction: 'Pass --run to use real authenticated Kiro and Qloo through the running local Studio.' }, null, 2));
} else {
  await run();
}

async function run() {
  loadDotEnv(); const config = getConfig();
  const origin = process.env.STUDIO_URL || `http://127.0.0.1:${config.port}`;
  const reportPath = path.join(config.rootDir, 'output', `qloo-studio-live-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
  const report = { ...plan, origin, reportPath, startedAt: new Date().toISOString(), verified: false };
  const save = async () => { await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2), config)); };
  try {
    const status = await api('/api/status');
    assert.equal(status.model, plan.model); assert.equal(status.qloo.configured, true); assert.equal(status.comparisonReady, true);
    report.status = { model: status.model, qlooConfigured: status.qloo.configured, comparisonReady: status.comparisonReady };
    if (existingJobId) {
      assert.match(existingJobId, /^[a-f0-9-]{36}$/u);
      report.comparisonJobId = existingJobId; report.studioUrl = `${origin}/?job=${existingJobId}`;
      const job = await api('/api/jobs/' + existingJobId);
      const prepared = await api('/api/jobs/' + job.preparationJobId);
      report.workspaceId = job.workspaceId; report.preparationJobId = prepared.id; report.preparation = prepared; report.comparison = job;
      await verifyComparison(job, prepared); report.verified = true; return;
    }
    const reusablePreparation = reusePreparationId ? await api('/api/jobs/' + reusePreparationId) : null;
    if (reusablePreparation) { assert.equal(reusablePreparation.kind, 'prepare'); assert.equal(reusablePreparation.status, 'completed'); assert.equal(reusablePreparation.brief, brief); }
    const workspace = reusablePreparation ? await api('/api/workspaces/' + reusablePreparation.workspaceId) : await api('/api/workspaces', { name: 'Gather — live Qloo comparison', templateId: 'local-food', brief, cultureBrief });
    report.workspaceId = workspace.id; await save();
    const common = { templateId: 'local-food', workspaceId: workspace.id, brief, cultureBrief: workspace.cultureBrief, audienceId: 'a1' };
    const preparation = reusablePreparation || await api('/api/jobs', { ...common, kind: 'prepare', intendedKind: 'build', mode: 'baseline' });
    report.preparationJobId = preparation.id; await save();
    report.preparationReused = Boolean(reusablePreparation);
    console.log(JSON.stringify({ stage: reusablePreparation ? 'preparation-reused' : 'preparation-started', jobId: preparation.id }));
    const prepared = reusablePreparation || await waitForJob(preparation.id, config.runTimeoutMs + 60000);
    report.preparation = prepared;
    assert.equal(prepared.status, 'completed', prepared.runs[0]?.error || 'Preparation failed.');
    assert.equal(prepared.runs[0].preparation.status, 'ready');
    assert.equal(prepared.runs[0].preparation.assessment.action, 'research');
    assert.ok(prepared.runs[0].assessmentCalls.length > 0);
    assert.equal(prepared.runs[0].evidence.length, 0);
    assert.equal(prepared.runs[0].previewUrl, null);
    const created = await api('/api/jobs', { ...common, cultureBrief: prepared.baseCultureBrief, kind: 'build', mode: 'compare', preparationJobId: prepared.id, protocol: 'research' });
    report.comparisonJobId = created.id; report.studioUrl = `${origin}/?job=${created.id}`; await save();
    console.log(JSON.stringify({ stage: 'comparison-started', jobId: created.id, studioUrl: report.studioUrl }));
    const job = await waitForJob(created.id, 2 * config.runTimeoutMs + 120000);
    report.comparison = job; await save();
    await verifyComparison(job, prepared);
    report.verified = true;
  } catch (error) { report.error = redact(error.message, config); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ reportPath, comparisonJobId: report.comparisonJobId || null, verified: report.verified, checks: report.checks, error: report.error })); }

  async function verifyComparison(job, prepared) {
    assert.equal(job.status, 'completed', job.runs.map(item => item.error).filter(Boolean).join('; ') || 'Comparison did not complete.');
    const baseline = job.runs.find(item => item.mode === 'baseline'); const qloo = job.runs.find(item => item.mode === 'qloo');
    assert.equal(job.model, plan.model); assert.equal(job.kind, 'build');
    assert.equal(baseline.status, 'completed'); assert.equal(qloo.status, 'completed');
    assert.equal(baseline.evidence.length, 0); assert.equal(baseline.researchCalls.length, 0);
    const insightIds = new Set(qloo.evidence.filter(item => item.tool === 'qloo_get_insights' && item.status === 'ok' && item.results.length > 0).map(item => item.id));
    assert.ok(insightIds.size > 0);
    const groundedDecisions = qloo.decisions.filter(item => item.sourceType === 'qloo' && item.evidenceIds.some(id => insightIds.has(id)) && item.selectors.length > 0);
    assert.ok(groundedDecisions.length > 0, 'At least one site decision must cite actual usable insights and an output selector.');
    assert.ok(qloo.researchDecisions.length > 0, 'The live run must carry the decision-to-evidence chain.');
    const evidenceIds = new Set(qloo.evidence.map(item => item.id));
    for (const decision of qloo.researchDecisions) {
      for (const id of decision.evidenceIds) assert.ok(evidenceIds.has(id), 'Research decisions must refer to recorded live evidence.');
    }
    assert.ok(qloo.researchDecisions.some(item => ['research', 'reuse'].includes(item.action) && item.evidenceIds.some(id => insightIds.has(id)) && item.finding && item.interpretation && item.affectedArtifact && item.changeMade), 'A complete creative trace must use real insights and describe its actual effect.');
    assert.equal(job.preparationJobId, prepared.id);
    assert.deepEqual(job.baseCultureBrief, prepared.baseCultureBrief);
    assert.deepEqual(job.cultureBrief.creativeContext, prepared.runs[0].preparation.creativeContext);
    const downloads = await Promise.all(['baseline', 'qloo'].map(mode => api(`/api/jobs/${job.id}/runs/${mode}/download`)));
    const [baselineFiles, qlooFiles] = downloads.map(download => download.files);
    assert.ok(!JSON.stringify({ job, downloads }).includes(config.qlooKey), 'Public job records and generated files must not expose the server credential.');
    assert.equal(baselineFiles['app.js'], qlooFiles['app.js'], 'Protected runtime must remain equal in both variants.');
    const { templates } = await import('../src/templates.mjs');
    assert.equal(baselineFiles['app.js'], templates.find(template => template.id === job.templateId).files['app.js'], 'Protected runtime must remain byte-identical to the independent starter.');
    for (const decision of groundedDecisions) {
      assert.ok(decision.selectors.some(selector => /^#[a-zA-Z_][a-zA-Z0-9_-]*$/u.test(selector) && new RegExp(`\\bid\\s*=\\s*["']${selector.slice(1)}["']`, 'u').test(qlooFiles['index.html'])), 'A grounded decision must point to an existing HTML target.');
    }
    const countSourceCalls = calls => calls.filter(call => call.sourceRequestAttempted).reduce((sum, call) => sum + (call.tool === 'qloo_compare_tastes' ? call.query.groups.length : 1), 0);
    report.checks = { sharedJobAndStarter: true, sharedPreparedContext: true, baselineSourceCalls: baseline.researchCalls.length,
      qlooSourceCalls: countSourceCalls(qloo.researchCalls), qlooEvidenceRecords: qloo.evidence.length, researchDecisions: qloo.researchDecisions.length,
      qlooDesignDecisions: groundedDecisions.length, protectedRuntimeIdentical: true, existingGroundedTargets: true, serverCredentialAbsent: true, model: job.model };
  }

  async function api(pathname, body) {
    const headers = { ...(config.accessToken ? { 'X-Demo-Token': config.accessToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    const response = await fetch(origin + pathname, { headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok, `Studio ${response.status}: ${result.error || 'Request failed.'}`); return result;
  }
  async function waitForJob(id, timeoutMs) {
    const deadline = Date.now() + timeoutMs; let previous = ''; let lastProgress = 0;
    while (Date.now() < deadline) {
      const job = await api('/api/jobs/' + id);
      const state = JSON.stringify({ jobId: id, status: job.status, runs: job.runs.map(item => ({ mode: item.mode, status: item.status, calls: item.researchCalls.length, evidence: item.evidence.length, lastEvent: item.events.at(-1)?.message })) });
      if (state !== previous && Date.now() - lastProgress > 15000) { console.log(redact(state, config)); previous = state; lastProgress = Date.now(); }
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await api('/api/jobs/' + id + '/cancel', {}); throw new Error('The live integration exceeded its timeout and was cancelled.');
  }
}
