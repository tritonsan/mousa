import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig, redact } from '../src/config.mjs';
import { designFingerprint, compareDesignFingerprints } from '../plugin/server/culture/taste.mjs';

// Repeated taste-led comparisons through a running Studio. One pair is an anecdote; the claim needs
// Qloo-to-baseline distances that exceed baseline-to-baseline distances for the same brief and model.
const option = (name, fallback) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const pairs = Number(option('pairs', '2')), baselinePairs = Number(option('baseline-pairs', '1')), swapFrom = option('swap-from');
const brief = 'Create an original seasonal food discovery website for Gather, a fictional small food producer. The audience likes Nujabes and the film Paterson. Preserve every sample product, price and the working search, category filter, sort, selection and request form. Keep all presentation in English.';
const cultureBrief = {
  brand: { notes: 'Gather is a fictional seasonal food producer. Its sample product facts and local browsing interactions must remain usable.', protectedFiles: ['app.js'], protectedSnippets: [] },
  audiences: [{ id: 'a1', label: 'Quiet discovery audience — fictional test brief', references: ['Nujabes', 'Paterson'] }],
};
const input = option('brief-file') ? JSON.parse(await fs.readFile(option('brief-file'), 'utf8')) : { templateId: 'local-food', brief, cultureBrief, audienceId: 'a1' };
const plan = { protocol: 'taste', templateId: input.templateId, pairs, baselinePairs, ...(swapFrom ? { swapFrom } : {}),
  modelRuns: pairs * 2 + baselinePairs * 2 + (swapFrom ? 1 : 0), qlooTastePasses: pairs,
  scope: 'Each pair runs the host taste pass once and two Kiro generations with the same model, prompt and starter. Baseline pairs measure ordinary model variance. A swap reuses another brief’s recorded Qloo profile as a manipulation check.' };

if (!Number.isInteger(pairs) || pairs < 1 || pairs > 5 || !Number.isInteger(baselinePairs) || baselinePairs < 0 || baselinePairs > 5) throw new Error('Use --pairs=1..5 and --baseline-pairs=0..5.');
if (swapFrom !== undefined && !/^[a-f0-9-]{36}$/u.test(swapFrom)) throw new Error('--swap-from needs a Studio job ID with a recorded Qloo taste profile.');
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, status: 'planned-only', instruction: 'Pass --run to start real paid Kiro generations and live Qloo taste passes through the running local Studio.' }, null, 2));
} else await run();

async function run() {
  loadDotEnv(); const config = getConfig();
  const origin = process.env.STUDIO_URL || `http://127.0.0.1:${config.port}`;
  const reportPath = path.join(config.rootDir, 'output', `taste-difference-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
  const report = { ...plan, origin, reportPath, startedAt: new Date().toISOString(), comparisons: [], baselines: [], verified: false };
  let imageAllowanceMs = 0;
  const save = async () => { await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2), config)); };
  const files = async (job, mode) => (await api(`/api/jobs/${job.id}/runs/${mode}/download`)).files;
  const distance = (a, b) => compareDesignFingerprints(designFingerprint(a), designFingerprint(b));
  const leaks = site => Object.entries(site).filter(([file, content]) => file.endsWith('.html') && /\b(?:Qloo|Kiro)\b/iu.test(content.replace(/<script\b[\s\S]*?<\/script\s*>/giu, ''))).map(([file]) => file);
  // How far each saved site moved from the design its run froze before any taste data.
  const moved = run => { const value = run?.taste?.sketchDivergence; return value ? { score: value.score, typography: value.typography, palette: value.palette, structure: value.structure } : null; };
  // The shared qualities each arm read, the anchors the host required and what the palette and type devices anchor to.
  const qualityRecord = run => {
    const refs = new Map((run?.taste?.input?.entities || []).map(entity => [entity.ref, entity]));
    const label = entity => entity ? { name: entity.name, domain: entity.domain, source: entity.source, ...(entity.family ? { family: entity.family, count: entity.count, domains: entity.domains } : {}),
      ...(entity.source === 'qloo' ? { surprise: entity.surprise } : {}) } : null;
    const stats = run?.taste?.dna?.stats;
    return { qualities: [...refs.values()].filter(entity => entity.domain === 'qualities' && (run?.mode !== 'qloo' || entity.source === 'qloo')).map(label),
      required: (run?.taste?.input?.requiredAnchors || []).map(ref => label(refs.get(ref))),
      paletteAndType: (run?.taste?.dna?.devices || []).filter(device => ['palette', 'typography'].includes(device.layer))
        .map(device => ({ id: device.id, layer: device.layer, device: device.device, anchors: device.anchors.map(ref => label(refs.get(ref))), qualities: device.qualities || [] })),
      qualityAnchoredDevices: stats ? { devices: stats.qualityAnchoredDevices ?? 0, of: stats.devices } : null };
  };
  const copyRecord = copy => copy ? { shared: copy.shared, distinct: copy.distinct, share: copy.share, sentences: copy.sentences, examples: copy.examples,
    narrative: Object.fromEntries(['baseline', 'qloo'].map(mode => [mode, copy.narrative?.[mode] ? { lines: copy.narrative[mode].lines, rewritten: copy.narrative[mode].rewritten, kept: copy.narrative[mode].kept } : null])) } : null;
  // Type, motion and illustration of each saved site, and which style or aesthetic ref each motion or illustration device translates.
  const richness = (run, site) => {
    const print = designFingerprint(site), refs = new Map((run?.taste?.input?.entities || []).map(entity => [entity.ref, entity]));
    const devices = (run?.taste?.dna?.devices || []).filter(device => device.layer === 'motion' || device.tokens?.svg?.length).map(device => ({ id: device.id, layer: device.layer, device: device.device,
      anchors: device.anchors.map(ref => refs.get(ref)).filter(Boolean).map(entity => ({ name: entity.name, domain: entity.domain, source: entity.source, ...(entity.source === 'qloo' ? { surprise: entity.surprise } : {}) })),
      qualities: device.qualities || [], keyframes: device.tokens.keyframes || [], svg: device.tokens.svg || [] }));
    const conformance = run?.taste?.conformance || {};
    return { codeCharacters: Object.entries(site).filter(([file]) => !/^culture-.*\.json$/u.test(file)).reduce((sum, [, content]) => sum + (typeof content === 'string' ? content.length : 0), 0),
      fonts: print.fonts.families, fontsLoaded: conformance.fonts?.loaded || [], motion: print.motion, svgShapes: print.svgShapes, illustrations: conformance.illustrations || [],
      pauseControl: conformance.motion?.pauseControl ?? null, devices };
  };
  try {
    const status = await api('/api/status');
    assert.equal(status.protocol, 'taste', 'Start the Studio with CREATIVE_PROTOCOL=taste (the default).'); assert.equal(status.comparisonReady, true);
    report.model = status.model; report.images = status.images || null;
    // Image generation pauses each run's deadline, so the wait allows for the most images a run can request.
    imageAllowanceMs = status.images?.available ? status.images.perRun * 200000 : 0;
    const workspace = await api('/api/workspaces', { name: input.name || 'Gather — taste difference check', templateId: input.templateId, brief: input.brief, cultureBrief: input.cultureBrief });
    report.workspaceId = workspace.id;
    const common = { templateId: input.templateId, workspaceId: workspace.id, brief: input.brief, cultureBrief: workspace.cultureBrief, ...(input.audienceId ? { audienceId: input.audienceId } : {}), kind: 'build', protocol: 'taste' };
    for (let index = 0; index < pairs; index++) {
      const job = await waitForJob((await api('/api/jobs', { ...common, mode: 'compare' })).id);
      assert.equal(job.status, 'completed', job.error || 'A comparison failed.');
      const [baselineFiles, qlooFiles] = [await files(job, 'baseline'), await files(job, 'qloo')];
      report.comparisons.push({ jobId: job.id, studioUrl: `${origin}/?job=${job.id}`, comparison: job.tasteComparison, conformance: Object.fromEntries(job.runs.map(item => [item.mode, item.taste?.conformance?.score ?? null])),
        surprises: job.runs.find(item => item.mode === 'qloo').taste.input.metrics, sketch: Object.fromEntries(job.runs.map(item => [item.mode, moved(item)])),
        richness: { baseline: richness(job.runs.find(item => item.mode === 'baseline'), baselineFiles), qloo: richness(job.runs.find(item => item.mode === 'qloo'), qlooFiles) },
        // The words beside the tokens: sentences the two sites share and how much starter narrative each voice rewrote.
        copy: copyRecord(job.tasteComparison?.copy),
        qualities: { baseline: qualityRecord(job.runs.find(item => item.mode === 'baseline')), qloo: qualityRecord(job.runs.find(item => item.mode === 'qloo')) },
        ...(job.images ? { generatedImages: Object.fromEntries(job.runs.map(item => [item.mode, (item.generatedImages || []).map(({ path: file, device, subject, prompt, used, durationMs }) => ({ path: file, device, subject, prompt, used, durationMs }))])) } : {}),
        visitorPageMentions: { baseline: leaks(baselineFiles), qloo: leaks(qlooFiles) }, files: { baseline: baselineFiles, qloo: qlooFiles } });
      await save();
    }
    for (let index = 0; index < baselinePairs; index++) {
      const jobs = [];
      for (let arm = 0; arm < 2; arm++) {
        const job = await waitForJob((await api('/api/jobs', { ...common, mode: 'baseline' })).id);
        assert.equal(job.status, 'completed', job.error || 'A baseline generation failed.');
        jobs.push({ id: job.id, files: await files(job, 'baseline'), sketch: moved(job.runs.find(item => item.mode === 'baseline')) });
      }
      report.baselines.push({ jobIds: jobs.map(job => job.id), distance: distance(jobs[0].files, jobs[1].files), sketch: jobs.map(job => job.sketch) });
      await save();
    }
    if (swapFrom) {
      const job = await waitForJob((await api('/api/jobs', { ...common, mode: 'qloo', tasteSourceJobId: swapFrom })).id);
      assert.equal(job.status, 'completed', job.error || 'The manipulation check failed.');
      const swapped = await files(job, 'qloo');
      report.swap = { jobId: job.id, sourceJobId: swapFrom, anchoredEntities: job.runs[0].taste.dna.devices.flatMap(device => device.anchors),
        distanceToPairs: report.comparisons.map(item => ({ jobId: item.jobId, qloo: distance(item.files.qloo, swapped).overall, baseline: distance(item.files.baseline, swapped).overall })) };
    }
    const mean = values => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
    report.summary = {
      qlooToBaseline: mean(report.comparisons.map(item => item.comparison?.distance?.overall).filter(Number.isFinite)),
      baselineToBaseline: mean(report.baselines.map(item => item.distance.overall)),
      qlooToQloo: report.comparisons.length > 1 ? mean(report.comparisons.slice(1).map(item => distance(report.comparisons[0].files.qloo, item.files.qloo).overall)) : null,
      surpriseAnchoredShare: mean(report.comparisons.map(item => item.comparison?.qloo?.surpriseShare).filter(Number.isFinite)),
      movedFromSketch: Object.fromEntries(['score', 'typography', 'palette', 'structure'].map(key => [key, {
        qloo: mean(report.comparisons.map(item => item.sketch?.qloo?.[key]).filter(Number.isFinite)),
        baseline: mean([...report.comparisons.map(item => item.sketch?.baseline?.[key]), ...report.baselines.flatMap(item => (item.sketch || []).map(value => value?.[key]))].filter(Number.isFinite)) }])),
      // Motion and illustration devices of the Qloo on arm that translate a measured tag or quality the model did not predict.
      surpriseTagDevices: Object.fromEntries(['motion', 'illustration'].map(kind => [kind, report.comparisons.reduce((count, item) => count + (item.richness?.qloo?.devices || [])
        .filter(device => (kind === 'motion' ? device.layer === 'motion' : device.svg.length) && device.anchors.some(anchor => anchor.source === 'qloo' && anchor.surprise && ['style', 'aesthetic', 'qualities'].includes(anchor.domain))).length, 0)])),
      richness: Object.fromEntries(['codeCharacters', 'svgShapes'].map(key => [key, { qloo: mean(report.comparisons.map(item => item.richness?.qloo?.[key]).filter(Number.isFinite)),
        baseline: mean(report.comparisons.map(item => item.richness?.baseline?.[key]).filter(Number.isFinite)) }])),
      // Share of the two sites' distinct sentences that are word for word the same, and of starter narrative lines each arm rewrote.
      copy: { sharedSentenceShare: mean(report.comparisons.map(item => item.copy?.share).filter(Number.isFinite)),
        rewrittenShare: Object.fromEntries(['qloo', 'baseline'].map(mode => [mode, mean(report.comparisons.map(item => item.copy?.narrative?.[mode]).filter(Boolean).map(value => value.rewritten / value.lines).filter(Number.isFinite))])) },
      // Share of each arm's devices anchored to its own qualities: measured tags and shared qualities with Qloo, predicted ones without.
      qualityAnchoredShare: Object.fromEntries(['qloo', 'baseline'].map(mode => [mode, mean(report.comparisons.map(item => item.qualities?.[mode]?.qualityAnchoredDevices)
        .filter(value => value && value.of).map(value => value.devices / value.of))])),
      visitorPageMentions: report.comparisons.reduce((count, item) => count + item.visitorPageMentions.baseline.length + item.visitorPageMentions.qloo.length, 0),
      interpretation: 'Distances are bounded token and structure heuristics. A Qloo-to-baseline mean above the baseline-to-baseline mean, with high surprise-anchored share, supports that measured taste changed the output beyond ordinary variance for this brief. movedFromSketch is the share of each saved site’s fonts, top colors and landmark sections that are new against its own run’s frozen sketch; the protocol requires that departure for surprise-anchored devices, so it shows the requirement reached the site and that baseline runs did not move on their own. None of this shows the result is better or preferred.',
    };
    report.verified = report.summary.visitorPageMentions === 0;
  } catch (error) { report.error = redact(error.message, config); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString();
    // Keep the report readable: generated files stay downloadable from the Studio.
    for (const item of report.comparisons) delete item.files;
    await save();
    console.log(JSON.stringify({ reportPath, summary: report.summary || null, verified: report.verified, error: report.error }));
  }

  async function api(pathname, body) {
    const headers = { ...(config.accessToken ? { 'X-Demo-Token': config.accessToken } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    const response = await fetch(origin + pathname, { headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const result = await response.json(); assert.ok(response.ok, `Studio ${response.status}: ${result.error || 'Request failed.'}`); return result;
  }
  async function waitForJob(id) {
    const deadline = Date.now() + 2 * (config.runTimeoutMs + imageAllowanceMs) + 180000;
    while (Date.now() < deadline) {
      const job = await api('/api/jobs/' + id);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    await api('/api/jobs/' + id + '/cancel', {}); throw new Error('A live comparison exceeded its timeout and was cancelled.');
  }
}
