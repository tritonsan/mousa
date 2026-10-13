import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../src/server.mjs';
import { getConfig, loadDotEnv, redact } from '../src/config.mjs';
import { inspectKiro } from '../src/doctor.mjs';

const model = 'claude-opus-5.5';
const scenarios = [
  {
    id: 'creative-missing-references',
    brief: 'Redesign the Gather food-brand homepage with a distinctive new creative direction. Keep the real sample products, prices and existing local browsing interactions. The visual direction and presentation of the seasonal collection are still open. No audience tastes, creator inspirations or brand-reference examples have been supplied.',
    creativeContext: { domain: 'web', referencePolicy: 'ask', references: [], constraints: ['Preserve sample product facts and local interactions.'] },
    expected: { action: 'clarify', status: 'needs_input', question: true },
  },
  {
    id: 'technical-preserve-design',
    brief: 'Correct a navigation anchor so the existing Browse products link goes to the existing catalogue section. Preserve the current text, colours, layout and browsing behavior. This is a technical link repair; no new visual or content direction is requested.',
    creativeContext: { domain: 'web', referencePolicy: 'ask', references: [], constraints: ['Preserve the current appearance and content.'] },
    expected: { action: 'skip', status: 'ready', question: false },
  },
  {
    id: 'creative-existing-typed-references',
    brief: 'Choose an original creative direction for the Gather food-brand homepage and seasonal collection. Preserve the sample products, prices and working browsing interactions. The supplied brand and audience references are the complete starting context for this decision. Their roles must stay distinct.',
    creativeContext: {
      domain: 'web', referencePolicy: 'ask',
      references: [
        { name: 'Paterson', role: 'audience', origin: 'user-provided', audienceId: 'a1' },
        { name: 'Nujabes', role: 'audience', origin: 'user-provided', audienceId: 'a1' },
        { name: 'Muji', role: 'brand', origin: 'user-provided' },
      ],
      constraints: ['Preserve sample product facts and local interactions.', 'Keep the audience preferences distinct from the brand reference.'],
    },
    expected: { action: 'research', status: 'ready', question: false },
  },
];

const plan = {
  execution: 'opt-in', model, maximumModelJobs: scenarios.length,
  qloo: 'disabled; no live Qloo claims', websitesGenerated: false,
  scenarios: scenarios.map(({ id, brief, creativeContext, expected }) => ({ id, brief, creativeContext, expected })),
};

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ ...plan, status: 'planned-only', instruction: 'Pass --run to consume real authenticated Kiro usage for these preparation jobs. No model or CLI call was made.' }, null, 2));
} else {
  await runEvaluation();
}

async function runEvaluation() {
  loadDotEnv();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'culture-creative-policy-live-'));
  const config = getConfig({ ...process.env, HOST: '127.0.0.1', PORT: '0', PREVIEW_PORT: '0', DATA_DIR: directory,
    DEMO_ACCESS_TOKEN: '', PUBLIC_PREVIEW_BASE_URL: '', QLOO_API_KEY: '', KIRO_MODEL: model, CREATIVE_PROTOCOL: 'research' });
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const reportPath = path.join(config.rootDir, 'output', `creative-policy-live-${stamp}.json`);
  const report = { ...plan, startedAt: new Date().toISOString(), dataDirectory: directory, reportPath, executed: [], failures: [], verified: false };
  let studio;
  try {
    assert.equal(config.qlooKey, '', 'The live harness must have Qloo disabled.');
    assert.equal(config.model, model);
    const kiro = await inspectKiro(config);
    report.kiro = { available: kiro.available, authenticated: kiro.authenticated, version: kiro.version, authentication: kiro.authentication, selectedModel: model };
    assert.ok(kiro.available && kiro.authenticated, 'An available, authenticated Kiro session is required.');
    studio = await createStudio({ config, inspect: async () => kiro });
    const status = await api(studio.appUrl, '/api/status');
    assert.equal(status.qloo.configured, false);
    assert.equal(status.model, model);

    for (const scenario of scenarios) {
      const entry = { id: scenario.id, expected: scenario.expected, startedAt: new Date().toISOString(), passed: false };
      report.executed.push(entry);
      try {
        const created = await api(studio.appUrl, '/api/jobs', {
          templateId: 'local-food', kind: 'prepare', intendedKind: 'build', mode: 'baseline', brief: scenario.brief,
          cultureBrief: { brand: { notes: 'Gather is a fictional local food brand.', protectedFiles: ['app.js'], protectedSnippets: [] }, audiences: [], creativeContext: scenario.creativeContext },
        });
        entry.jobId = created.id;
        const job = await waitForJob(studio.appUrl, created.id, config.runTimeoutMs + 60000);
        const run = job.runs.find(item => item.mode === 'baseline');
        entry.actual = { jobStatus: job.status, model: job.model, kind: job.kind, runStatus: run?.status,
          error: run?.error || job.error || null, preparation: run?.preparation || null,
          assessmentCalls: run?.assessmentCalls || null,
          evidence: run?.evidence || [], events: run?.events || [], files: run?.files || [] };
        assert.equal(job.model, model, 'The real job must capture the selected model.');
        assert.equal(job.kind, 'prepare');
        assert.equal(job.status, 'completed', `Preparation did not complete: ${entry.actual.error || 'see events'}`);
        assert.ok(run, 'The baseline run is missing.');
        assert.equal(run.status, 'completed');
        assert.equal(run.previewUrl, null, 'Preparation must not publish a generated website.');
        assert.equal(run.evidence.length, 0, 'The key-free harness must not contain Qloo evidence.');
        assert.ok(!run.events.some(event => event.type === 'qloo' || /\bqloo_[a-z0-9_]+\b/u.test(event.message || '')), 'Unexpected Qloo tool-call trace.');
        assert.ok(Array.isArray(run.assessmentCalls) && run.assessmentCalls.length > 0, 'Actual assessment tool-call records must be exposed; a model-authored artifact alone is insufficient.');
        const preparation = run.preparation;
        assert.ok(preparation?.assessment, 'A validated preparation assessment is required.');
        assert.equal(preparation.assessmentPerformedByAgent, true, 'The preparation must acknowledge the recorded agent assessment.');
        assert.equal(preparation.assessment.action, scenario.expected.action);
        assert.equal(preparation.status, scenario.expected.status);
        if (scenario.expected.question) {
          assert.ok(typeof preparation.question === 'string' && preparation.question.trim(), 'A useful reference question is required.');
          assert.ok(Array.isArray(preparation.options) && preparation.options.length > 0, 'Clarification needs usable response options.');
        } else {
          assert.ok(!preparation.question, 'The model must not ask again when research is skipped or references are sufficient.');
        }
        for (const reference of scenario.creativeContext.references) {
          assert.ok(preparation.creativeContext?.references.some(actual => actual.name === reference.name && actual.role === reference.role && actual.origin === reference.origin), 'Supplied reference roles and origins must remain intact.');
        }
        entry.passed = true;
        console.log(JSON.stringify({ scenario: scenario.id, jobId: created.id, action: preparation.assessment.action, status: preparation.status, assessmentCalls: run.assessmentCalls.length, qlooRecords: run.evidence.length, passed: true }));
      } catch (error) {
        entry.error = redact(error.message, config);
        report.failures.push({ scenario: scenario.id, error: entry.error });
        console.log(JSON.stringify({ scenario: scenario.id, jobId: entry.jobId || null, passed: false, error: entry.error }));
      } finally {
        entry.finishedAt = new Date().toISOString();
        await saveReport();
      }
    }
    report.verified = report.executed.length === scenarios.length && report.executed.every(entry => entry.passed);
  } catch (error) {
    report.failures.push({ stage: 'setup', error: redact(error.message, config) });
  } finally {
    if (studio) await studio.close();
    report.finishedAt = new Date().toISOString();
    await saveReport();
    console.log(JSON.stringify({ reportPath, dataDirectory: directory, verified: report.verified, actualJobs: report.executed.filter(entry => entry.jobId).length, failedScenarios: report.failures.length }));
    if (!report.verified) process.exitCode = 1;
  }

  async function saveReport() {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, redact(JSON.stringify(report, null, 2), config), 'utf8');
  }
}

async function api(origin, pathname, body) {
  const response = await fetch(origin + pathname, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, `Studio ${response.status}: ${result.error || JSON.stringify(result)}`);
  return result;
}

async function waitForJob(origin, id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await api(origin, '/api/jobs/' + id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await api(origin, '/api/jobs/' + id + '/cancel', {});
  throw new Error('Preparation exceeded the live evaluation timeout and was cancelled.');
}
