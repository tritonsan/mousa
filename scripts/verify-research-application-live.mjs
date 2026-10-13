import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig, redact } from '../src/config.mjs';
import { templates } from '../src/templates.mjs';
import { compileCultureBrief } from '../plugin/server/culture/brief.mjs';

const template = templates.find(item => item.id === 'indie-game');
const webReplanning = process.argv.includes('--web-replanning');
const cultureBrief = {
  brand: { notes: 'Echo Atlas is a fictional exploration game. Preserve its existing mechanics, sample levels and local wishlist.', protectedFiles: ['app.js'], protectedSnippets: [] },
  audiences: [{ id: 'explorers', label: 'Audience described in the Echo Atlas brief', references: ['Outer Wilds', 'Studio Ghibli films', 'ambient music'] }],
  creativeContext: { domain: 'web', referencePolicy: 'ask', references: [
    { name: 'Outer Wilds', role: 'audience', origin: 'user-provided', audienceId: 'explorers' },
    { name: 'Studio Ghibli films', role: 'audience', origin: 'user-provided', audienceId: 'explorers' },
    { name: 'ambient music', role: 'audience', origin: 'user-provided', audienceId: 'explorers' },
  ], constraints: ['Preserve the factual sample catalogue and existing local wishlist.', 'Additional website interactions may explain existing mechanics, but must not invent game capabilities.', 'All saved presentation is English.'] },
};
const plan = { model: 'claude-opus-5.5', templateId: template.id, brief: template.defaultBrief, cultureBrief,
  maximumModelRuns: 3, purpose: webReplanning ? 'Compare two complete researched workflows with equal native web access: original references versus Qloo-discovered cultural neighbors. Observe provisional plans, captured sources, reconsideration and working visitor outputs; one comparison does not isolate causal necessity or prove creative superiority.' : 'Observe real research applications with equal baseline capabilities and the original game brief. Checks establish provenance and implementation, not creative superiority or causal necessity.' };
const verifyId = process.argv.find(arg => arg.startsWith('--verify-job='))?.slice('--verify-job='.length);
const fromPreparation = process.argv.find(arg => arg.startsWith('--from-preparation='))?.slice('--from-preparation='.length);
if (!process.argv.includes('--run') && !verifyId) {
  console.log(JSON.stringify({ ...plan, status: 'planned-only', instruction: 'Use --run to start one shared preparation and two real model runs, or --verify-job=ID for local read-only verification.' }, null, 2));
} else {
  loadDotEnv();
  const config = getConfig(), origin = process.env.STUDIO_URL || `http://127.0.0.1:${config.port}`;
  const reportPath = path.join(config.rootDir, 'output', 'qloo-difference-audit', `${webReplanning ? 'replanning' : 'application'}-live-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const report = { startedAt: new Date().toISOString(), verified: false, newRunsRequested: 0, checks: {}, limitations: plan.purpose };
  const api = async (pathname, body) => {
    const response = await fetch(origin + pathname, { headers: { ...(config.accessToken ? { 'X-Demo-Token': config.accessToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, `Studio ${response.status}: ${value.error || 'Request failed.'}`); return value;
  };
  const save = async () => { await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2), config)); };
  const wait = async id => {
    let lastState = '';
    const deadline = Date.now() + 2 * config.runTimeoutMs + 120000;
    while (Date.now() < deadline) {
      const job = await api('/api/jobs/' + id);
      const state = JSON.stringify({ jobId: id, status: job.status, runs: job.runs.map(run => ({ mode: run.mode, status: run.status, sourceRecords: run.evidence.length, webCalls: run.webCalls?.length || 0, webSources: run.webSources?.length || 0, phase: run.creativePipeline?.status, lastEvent: run.events.at(-1)?.message })) });
      if (state !== lastState) { console.log(redact(state, config)); lastState = state; }
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    await api('/api/jobs/' + id + '/cancel', {}); throw new Error('The live verification reached its deadline and cancelled its own job.');
  };
  try {
    let job;
    if (verifyId) {
      assert.match(verifyId, /^[a-f0-9-]{36}$/); job = await api('/api/jobs/' + verifyId);
    } else {
      const status = await api('/api/status'); assert.equal(status.model, plan.model); assert.equal(status.comparisonReady, true);
      let common, prep, prepared;
      if (fromPreparation) {
        assert.match(fromPreparation, /^[a-f0-9-]{36}$/);
        prepared = await api('/api/jobs/' + fromPreparation); prep = { id: fromPreparation };
        assert.equal(prepared.kind, 'prepare'); assert.equal(prepared.brief, plan.brief); assert.equal(prepared.templateId, template.id);
        common = { workspaceId: prepared.workspaceId, templateId: template.id, brief: plan.brief, cultureBrief: prepared.baseCultureBrief, audienceId: prepared.audienceId };
      } else {
        const workspace = await api('/api/workspaces', { name: webReplanning ? 'Echo Atlas — source research and reconsideration' : 'Echo Atlas — research application check', templateId: template.id, brief: plan.brief, cultureBrief });
        common = { workspaceId: workspace.id, templateId: template.id, brief: plan.brief, cultureBrief: workspace.cultureBrief, audienceId: 'explorers' };
        prep = await api('/api/jobs', { ...common, kind: 'prepare', mode: 'baseline', intendedKind: 'build' });
        report.newRunsRequested++; report.preparationJobId = prep.id; await save();
        prepared = await wait(prep.id);
      }
      report.preparationJobId = prep.id;
      assert.equal(prepared.status, 'completed', prepared.error || 'Preparation failed.');
      assert.equal(prepared.runs[0].preparation.status, 'ready', 'This supplied-reference scenario should not need another reference question.');
      const created = await api('/api/jobs', { ...common, cultureBrief: prepared.baseCultureBrief, kind: 'build', mode: 'compare', preparationJobId: prep.id, protocol: 'research' });
      report.newRunsRequested += 2; report.jobId = created.id; await save(); job = await wait(created.id);
    }
    report.jobId = job.id; report.studioUrl = `${origin}/?job=${job.id}`; report.model = job.model;
    report.runStatus = job.runs.map(run => ({ mode: run.mode, status: run.status, error: run.error }));
    assert.equal(job.status, 'completed', job.error || 'Comparison failed.'); assert.equal(job.kind, 'build');
    assert.equal(job.model, plan.model);
    const baseline = job.runs.find(run => run.mode === 'baseline'), qloo = job.runs.find(run => run.mode === 'qloo');
    assert.ok(baseline && qloo); assert.equal(baseline.evidence.length, 0); assert.equal(baseline.researchCalls.length, 0);
    const prepared = await api('/api/jobs/' + job.preparationJobId);
    assert.deepEqual(job.baseCultureBrief, prepared.baseCultureBrief);
    assert.deepEqual(job.cultureBrief.creativeContext, prepared.runs[0].preparation.creativeContext);
    const bundles = await Promise.all(['baseline', 'qloo'].map(mode => api(`/api/jobs/${job.id}/runs/${mode}/download`)));
    const starter = templates.find(item => item.id === job.templateId);
    for (const bundle of bundles) assert.equal(bundle.files['app.js'], starter.files['app.js']);
    assert.ok(!JSON.stringify({ job, bundles }).includes(config.qlooKey), 'Credential leaked to public data.');
    const insights = qloo.evidence.filter(record => record.tool === 'qloo_get_insights' && record.status === 'ok' && record.results?.length);
    report.sources = { requests: qloo.researchCalls.length, usableInsights: insights.length, domains: [...new Set(insights.map(record => record.query.resultType))], records: qloo.evidence };
    report.traces = job.runs.map(run => ({ mode: run.mode, researchDecisions: run.researchDecisions }));
    if (webReplanning) {
      report.pipeline = job.runs.map(run => ({ mode: run.mode, phase: run.creativePipeline, provisionalPlan: run.provisionalPlan, webCalls: run.webCalls, webSources: run.webSources, reconsideration: run.reconsideration }));
      for (const run of job.runs) {
        assert.ok(run.provisionalPlan?.decisions.length, 'A provisional plan must precede research.');
        assert.ok(run.reconsideration?.decisions.length, 'A reconsideration must precede construction.');
        assert.ok(run.webCalls?.length <= 6, 'The native web budget was exceeded.');
        assert.ok(run.webSources?.some(source => source.tool === 'web_fetch' && source.status === 'ok' && source.excerpt), 'The researched comparison needs at least one actual captured page in each arm.');
        assert.equal(run.webCalls?.some(call => call.status === 'pending'), false, 'An incomplete native tool receipt was silently accepted.');
        assert.ok(new Date(run.creativePipeline.planSavedAt) <= new Date(run.creativePipeline.reconsideredAt));
        assert.ok(new Date(run.creativePipeline.reconsideredAt) <= new Date(run.creativePipeline.constructionStartedAt));
        assert.deepEqual(run.provisionalPlan.decisions.map(record => record.id).sort(), run.reconsideration.decisions.map(record => record.decisionId).sort());
        const compiled = compileCultureBrief(JSON.parse(bundles.find(bundle => bundle.mode === run.mode)?.files?.['culture-brief.json'] || '{}'));
        assert.equal(compiled.context.webSources?.length || 0, run.webSources?.length || 0);
        assert.ok((compiled.context.webSources || []).every(source => source.verification === 'caller-provided-unverified'));
      }
    }
    const applied = qloo.researchDecisions.filter(record => record.disposition === 'applied' && record.anchors?.length);
    report.observation = { sourceAnchoredApplications: applied.length, sourceAnchoredNonPresentationApplications: applied.filter(record => record.application?.kind !== 'presentation').length,
      checkedBeforeWriteApplications: applied.filter(record => record.verification?.planTiming === 'before-write' && record.verification?.targetPresence === 'present' && record.verification?.artifactChange === 'changed').length,
      additionalScripts: bundles.map(bundle => ({ mode: bundle.mode, scripts: Object.keys(bundle.files).filter(file => file.endsWith('.js') && file !== 'app.js') })) };
    report.checks = { equalPreparedContext: true, baselineQlooCalls: 0, protectedRuntimeIdentical: true, credentialAbsent: true, ...(webReplanning ? { enforcedResearchPhases: true, capturedNativeWebCalls: job.runs.map(run => ({ mode: run.mode, calls: run.webCalls.length, sources: run.webSources.length })) } : {}) };
    report.verified = true;
  } catch (error) { report.error = redact(error.message, config); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ reportPath, jobId: report.jobId, verified: report.verified, observation: report.observation, error: report.error })); }
}
