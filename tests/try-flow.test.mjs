// The live try's two steps on a fake Kiro: step one plans, freezes the model's prediction in a Kiro session with no
// Qloo key, measures here and writes the measurement report; step two copies the starter into two arms with that one
// prediction, runs a session in each (only the arm with Qloo holds the key), puts back what a design may not change
// and writes the comparison report. Moûsa's server runs from each agent file's own environment; Qloo is a fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.mjs';
import { createTryManager, TRY_ARMS, guardArm, matchesPattern, designFile } from '../src/try/manager.mjs';
import { publishedTries } from '../src/gallery/records.mjs';
import { buildGallery } from '../src/gallery/build.mjs';
import { loadFontLibrary } from '../plugin/server/production/fonts.mjs';
import { qlooFixture, prediction } from './helpers/mousa-fixtures.mjs';
import { fakeKiro, predictScript, qlooArmScript, baselineArmScript } from './helpers/fake-kiro.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = file => fs.stat(file).then(() => true, () => false);
const KIRO = Object.freeze({ available: true, authenticated: true, version: 'kiro-cli 2.24.0', defaultModel: 'fixed-test-model' });
// What the manager logs of an unexpected error, for a failing assertion to show.
const logged = [];
const quiet = { error: message => logged.push(message), warn: () => {} };

/** Wait until `check` returns a value, or fail after `ms`. */
async function until(check, ms = 20000, what = 'the step') {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`${what} did not finish in time.`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const settled = (manager, id, step) => until(() => { const run = manager.get(id); return run[step] && !['queued', 'planning', 'predicting', 'measuring', 'preparing', 'designing', 'reporting'].includes(run[step].status) ? run : null; }, 30000, step);

/** A starter like Ramble: a page, its data and its server script, the last two protected. */
async function fixtureStarter(dir) {
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>Shop</h1></main></body></html>');
  await fs.writeFile(path.join(dir, 'styles.css'), 'body{color:#222;background:#fff}');
  await fs.writeFile(path.join(dir, 'data', 'walks.json'), '{"walks":[{"id":"moda","km":3.2}]}\n');
  await fs.writeFile(path.join(dir, 'serve.mjs'), '// serves the folder\n');
  await fs.mkdir(path.join(dir, '.kiro'), { recursive: true });
  await fs.writeFile(path.join(dir, '.kiro', 'secret.md'), 'never copied');
  return { 'fixture-shop': { id: 'fixture-shop', title: 'A test-only shop', medium: 'web', source: dir, summary: 'A fixture.', protect: ['data/**', 'serve.mjs'],
    brief: audience => `Redesign the shop in this folder for people who love ${audience}. Use the Moûsa plugin.` } };
}

async function setup(t, { scripts = {}, env = {}, limits, starters } = {}) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-data-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-starter-'));
  const qloo = qlooFixture(), seen = [];
  const config = getConfig({ HOST: '127.0.0.1', DATA_DIR: data, TRY_ACCESS_CODE: 'a-test-only-access-code', QLOO_API_KEY: 'fixture-key-123', KIRO_CLI_PATH: 'kiro-cli-test-only', ...env });
  const manager = createTryManager({ config, kiro: KIRO, starters: starters || await fixtureStarter(source), fetchImpl: qloo.fetchImpl, log: quiet,
    spawnImpl: fakeKiro({ fetchImpl: qloo.fetchImpl, seen, scripts: { predict: predictScript, qloo: qlooArmScript, baseline: baselineArmScript, ...scripts } }), ...(limits ? { limits } : {}) });
  await manager.initialize();
  t.after(async () => { await manager.close(); await fs.rm(data, { recursive: true, force: true }); await fs.rm(source, { recursive: true, force: true }); });
  return { manager, data, source, qloo, seen, config };
}

test('step one freezes the prediction in a Kiro session without Qloo, then measures here and writes the measurement report', async t => {
  const { manager, data, qloo, seen } = await setup(t);
  const created = await manager.create({ starter: 'fixture-shop', references: 'Paterson\nNujabes' }, { address: '203.0.113.7' });
  assert.match(created.id, /^[a-f0-9]{32}$/u);
  const run = await settled(manager, created.id, 'quick');
  assert.equal(run.quick.status, 'done', `${run.quick.problem} ${logged.join(' | ')}`);
  const project = path.join(data, 'try', run.id, 'project');

  // The prediction session: Moûsa's tools only, no file tool, and no Qloo key anywhere it runs.
  const predict = seen.find(item => item.kind === 'predict');
  assert.deepEqual(predict.agent.tools, ['@mousa']);
  assert.equal(predict.agent.mcpServers.mousa.env.QLOO_API_KEY, undefined);
  assert.equal(predict.env.QLOO_API_KEY, undefined);
  assert.equal(predict.agent.mcpServers.mousa.env.MOUSA_PROJECT_DIR, project);
  assert.equal(predict.agent.mcpServers.mousa.env.MOUSA_ENVIRONMENT, 'hosted');
  assert.equal(predict.agent.includePowers, false);
  assert.ok(predict.agent.permissions.rules.some(rule => rule.capability === 'shell' && rule.effect === 'deny'));
  assert.deepEqual(predict.args.slice(0, 7), ['chat', '--agent', 'mousa-try', '--agent-engine', 'v2', '--model', 'fixed-test-model']);
  assert.ok(predict.args.includes('--require-mcp-startup') && predict.args.includes('--no-interactive'));
  assert.match(predict.prompt, /Call taste_profile with dryRun: true and no other field/u);
  assert.match(predict.prompt, /people who love Paterson and Nujabes/u);
  for (const resource of predict.agent.resources) {
    assert.match(resource, /^file:\/\//u);
    assert.ok(await exists(resource.slice('file://'.length)), `${resource} is a skill file`);
  }

  // The host measured, within the try's budget, and the report is the measurement's.
  assert.equal(run.quick.measured.status, 'ok');
  assert.ok(run.quick.measured.qlooRequests > 0 && run.quick.measured.qlooRequests <= 24, String(run.quick.measured.qlooRequests));
  assert.equal(run.quick.measured.qlooRequests, qloo.requests.length, 'every Qloo request is counted');
  assert.equal(run.quick.prediction.entries > 0, true);
  assert.equal(run.quick.report.page, '.mousa/report/index.html');
  const record = await readJson(path.join(project, '.mousa', 'report', 'record.json'));
  assert.equal(record.kind, 'measurement');
  assert.ok(Object.values(record.measured.qualities).flat().some(item => item.mark === 'new'), 'the report marks what the prediction missed');
  assert.ok(await exists(path.join(data, 'try', run.id, 'sessions', 'predict.jsonl')), 'the stream is kept for the operator');

  // What the run keeps of the session: tools and outcomes, no title or output; the public view drops the preview token.
  const meta = await fs.readFile(path.join(data, 'try', run.id, 'meta.json'), 'utf8');
  assert.doesNotMatch(meta, /Running:|fixture-key-123|a-test-only-access-code/u);
  assert.deepEqual(run.quick.session.calls.map(call => call.tool), ['mousa:taste_profile', 'mousa:design_validate']);
  assert.equal(manager.publicRun(run).previewToken, undefined);
  assert.ok(await manager.reportFile(run.id, '.mousa/report/index.html'));
  for (const bad of ['.mousa/taste/profile.json', '.mousa/cache/qloo/x.json', '.mousa/report/../taste/brief.json', 'compare/with-qloo/index.html', '.mousa/report/.hidden']) assert.equal(await manager.reportFile(run.id, bad), null, bad);
});

test('step two builds both arms from the one frozen prediction, keeps the key in the Qloo arm and puts back what a design may not change', async t => {
  const tampering = async context => {
    await baselineArmScript(context);
    // A design that changes the data and adds beside it: the try puts the data back and removes the addition.
    await context.write('data/walks.json', '{"walks":[]}\n');
    await context.write('data/extra.json', '{}\n');
  };
  const { manager, data, qloo, seen } = await setup(t, { scripts: { baseline: tampering } });
  const created = await manager.create({ starter: 'fixture-shop', references: ['Paterson', 'Nujabes'] }, { address: '203.0.113.8' });
  await settled(manager, created.id, 'quick');
  const measuredRequests = qloo.requests.length;
  await manager.design(created.id, { address: '203.0.113.8' });
  const run = await settled(manager, created.id, 'pair');
  assert.equal(run.pair.status, 'done', `${run.pair.problem || JSON.stringify(run.pair.arms)} ${logged.join(' | ')}`);
  const project = path.join(data, 'try', run.id, 'project');

  // One frozen prediction in both arms, each locked to its own source of taste.
  const frozen = await fs.readFile(path.join(project, '.mousa', 'taste', 'prediction.json'), 'utf8');
  for (const arm of TRY_ARMS) assert.equal(await fs.readFile(path.join(project, ...arm.folder.split('/'), '.mousa', 'taste', 'prediction.json'), 'utf8'), frozen, arm.id);
  assert.equal((await readJson(path.join(project, 'compare', 'with-qloo', '.mousa', 'taste', 'input.json'))).source, 'qloo-profile');
  assert.equal((await readJson(path.join(project, 'compare', 'without-qloo', '.mousa', 'taste', 'input.json'))).source, 'model-assumption');
  assert.equal(qloo.requests.length, measuredRequests, 'the arm with Qloo read the measurement again from step one\'s cache');
  assert.equal(run.pair.qlooRequests, run.quick.measured.qlooRequests, 'the try\'s requests are counted once, in one budget');
  assert.ok(!(await exists(path.join(project, 'compare', 'without-qloo', '.mousa', 'cache'))), 'the arm without Qloo has no Qloo answers');
  assert.ok(!(await exists(path.join(project, 'compare', 'with-qloo', '.kiro'))), 'a starter\'s hidden folders are not copied');

  // The key only where Qloo is used, and the same tools, limits and stages otherwise.
  const arms = Object.fromEntries(['qloo', 'baseline'].map(kind => [kind, seen.find(item => item.kind === kind)]));
  assert.equal(arms.qloo.agent.mcpServers.mousa.env.QLOO_API_KEY, 'fixture-key-123');
  for (const arm of TRY_ARMS) assert.ok(!(await exists(path.join(data, 'try', run.id, 'kiro', arm.id, 'agents', 'mousa-try.json'))), 'no agent file, with its key, outlives its session');
  assert.equal(arms.qloo.env.QLOO_API_KEY, 'fixture-key-123');
  assert.equal(arms.baseline.agent.mcpServers.mousa.env.QLOO_API_KEY, undefined);
  assert.equal(arms.baseline.env.QLOO_API_KEY, undefined);
  for (const arm of Object.values(arms)) {
    assert.deepEqual(arm.agent.tools, ['@mousa', 'read', 'write']);
    assert.ok(arm.agent.toolsSettings.write.deniedPaths.includes('.mousa/**') && arm.agent.toolsSettings.write.deniedPaths.includes('data/**'));
    assert.ok(arm.agent.permissions.rules.some(rule => rule.capability === 'fs_write' && rule.effect === 'deny' && rule.match.includes('serve.mjs')));
    assert.equal(arm.agent.model, 'fixed-test-model');
  }
  assert.equal(arms.qloo.agent.mcpServers.mousa.env.MOUSA_QLOO_USAGE_FILE, path.join(project, '.mousa', 'usage.json'), 'the arm counts in step one\'s file');
  assert.ok(!(await exists(path.join(project, 'compare', 'with-qloo', '.mousa', 'usage.json'))), 'no second count of the try\'s requests');
  const slashed = file => file.split(path.sep).join('/');
  assert.ok(arms.baseline.agent.toolsSettings.read.deniedPaths.includes(`${slashed(path.join(project, 'compare', 'with-qloo'))}/**`), 'the arm without Qloo may not open the other arm');
  assert.ok(arms.baseline.agent.toolsSettings.read.deniedPaths.includes(`${slashed(path.join(project, '.mousa'))}/**`), 'nor step one\'s measurement');
  assert.match(arms.qloo.prompt, /Call taste_profile\(\{\}\) to read the Taste Brief/u);
  assert.match(arms.baseline.prompt, /taste_profile\(\{ baseline: true \}\).*never measure/su);

  // The protected data is back as the starter has it, and the addition is gone.
  const own = path.join(project, 'compare', 'without-qloo');
  assert.equal(await fs.readFile(path.join(own, 'data', 'walks.json'), 'utf8'), '{"walks":[{"id":"moda","km":3.2}]}\n');
  assert.ok(!(await exists(path.join(own, 'data', 'extra.json'))));
  assert.deepEqual(run.pair.arms['without-qloo'].guard, { restored: ['data/walks.json'], removed: ['data/extra.json'] });
  assert.equal(run.pair.arms['with-qloo'].guard, undefined);

  // The comparison report, from the same frozen prediction, with each arm's own report.
  const record = await readJson(path.join(project, '.mousa', 'compare-report', 'record.json'));
  assert.equal(record.kind, 'comparison');
  assert.equal(record.samePrediction, true);
  assert.deepEqual(record.arms.map(arm => arm.label), ['With Qloo', 'Without Qloo']);
  assert.equal(run.pair.report.page, '.mousa/compare-report/index.html');
  assert.equal(typeof run.pair.report.distance, 'number');
  for (const file of ['.mousa/compare-report/index.html', 'compare/with-qloo/.mousa/report/index.html', 'compare/without-qloo/.mousa/report/record.json']) assert.ok(await manager.reportFile(run.id, file), file);
  const view = await manager.view(run);
  assert.deepEqual(view.arms.map(arm => [arm.id, arm.status, arm.captures > 0]), [['with-qloo', 'done', true], ['without-qloo', 'done', true]]);
  assert.ok(await manager.latestCapture(run.id, 'with-qloo'));

  // The designs play from the preview origin with the run's token only, and never a hidden file.
  assert.ok(await manager.armFile(run.id, run.previewToken, 'with-qloo', 'index.html'));
  assert.equal(await manager.armFile(run.id, 'f'.repeat(48), 'with-qloo', 'index.html'), null);
  assert.equal(await manager.armFile(run.id, run.previewToken, 'with-qloo', '.mousa/taste/profile.json'), null);

  // Publishing needs the juror's consent, and a finished try; the operator's consent says it is the operator's.
  assert.deepEqual([(await manager.publish(run.id, true)).consent.publish, run.consent.by], [true, 'juror']);
  assert.equal((await manager.publish(run.id, true, { by: 'operator' })).consent.by, 'operator');
  assert.equal((await manager.publish(run.id, false)).consent, null);
});

test('a prediction session that plans again or sets the baseline leaves only its prediction, and one that freezes nothing fails in words', async t => {
  const meddling = async context => {
    await context.call('taste_profile', { dryRun: true, references: [{ name: 'Khruangbin' }], segments: ['parents with young children'] });
    await predictScript(context);
    await context.call('taste_profile', { baseline: true });
  };
  const first = await setup(t, { scripts: { predict: meddling } });
  const created = await first.manager.create({ starter: 'fixture-shop', references: ['Paterson', 'Nujabes'] }, { address: '203.0.113.9' });
  const run = await settled(first.manager, created.id, 'quick');
  assert.equal(run.quick.status, 'done', run.quick.problem);
  assert.equal(run.quick.planRestored, true, 'the juror\'s plan is put back');
  const plan = await readJson(path.join(first.data, 'try', run.id, 'project', '.mousa', 'taste', 'plan.json'));
  assert.deepEqual(plan.args.references.map(item => item.name), ['Paterson', 'Nujabes']);
  assert.equal(plan.args.segments, undefined);
  assert.equal(run.quick.measured.status, 'ok', 'the session\'s baseline was set aside and the audience measured');

  const second = await setup(t, { scripts: { predict: async ({ call }) => { await call('taste_profile', { dryRun: true }); } } });
  const idle = await second.manager.create({ starter: 'fixture-shop', references: ['Paterson'] }, { address: '203.0.113.10' });
  const failed = await settled(second.manager, idle.id, 'quick');
  assert.equal(failed.quick.status, 'failed');
  assert.match(failed.quick.problem, /without freezing a prediction/u);
  await assert.rejects(second.manager.design(idle.id), error => error.status === 409);
});

test('the try takes a run only when it is open, within each address\'s hourly limit, and not while paused; a restart ends what it interrupted', async t => {
  const slow = async ({ stopped }) => { await stopped(); };
  const { manager, data, config } = await setup(t, { scripts: { predict: slow }, limits: { quickSlots: 1, pairSlots: 1, perHour: 2, pairMs: 60000, runs: 10, starterBytes: 1e6, starterFiles: 50 } });
  const first = await manager.create({ starter: 'fixture-shop', references: ['Paterson'] }, { address: '198.51.100.1' });
  const second = await manager.create({ starter: 'fixture-shop', references: ['Nujabes'] }, { address: '198.51.100.1' });
  await assert.rejects(manager.create({ starter: 'fixture-shop', references: ['Akira'] }, { address: '198.51.100.1' }), error => error.status === 429 && /next one can start/u.test(error.message));
  await assert.rejects(manager.create({ starter: 'nowhere', references: ['Akira'] }, { address: '198.51.100.2' }), error => error.status === 400);
  await assert.rejects(manager.create({ starter: 'fixture-shop', references: ['<script>'] }, { address: '198.51.100.2' }), error => error.status === 400);
  assert.equal((await manager.view(manager.get(second.id))).quickPlace, 1, 'the second run waits for the one slot');

  // A waiting run is cancelled at once; a working one when its session stops.
  assert.equal((await manager.cancel(second.id)).quick.status, 'cancelled');
  await until(() => manager.get(first.id).quick.status === 'predicting', 5000, 'the prediction session');
  await manager.cancel(first.id);
  assert.equal((await settled(manager, first.id, 'quick')).quick.status, 'cancelled');

  await fs.writeFile(path.join(data, 'try', 'PAUSED'), '');
  await assert.rejects(manager.create({ starter: 'fixture-shop', references: ['Paterson'] }, { address: '198.51.100.3' }), error => error.status === 503 && /paused/u.test(error.message));
  await fs.rm(path.join(data, 'try', 'PAUSED'));

  const closed = createTryManager({ config: { ...config, tryAccessCode: '' }, kiro: KIRO, log: quiet });
  await closed.initialize();
  assert.deepEqual(closed.readiness(), { open: false, missing: ['TRY_ACCESS_CODE is not set.'] });
  await assert.rejects(closed.create({ starter: 'blank-site', references: ['Paterson'] }), error => error.status === 503);

  // A run a restart interrupted is marked so, with the reason, when the next manager reads it.
  const interrupted = path.join(data, 'try', 'b'.repeat(32));
  await fs.mkdir(interrupted, { recursive: true });
  await fs.writeFile(path.join(interrupted, 'meta.json'), JSON.stringify({ id: 'b'.repeat(32), updatedAt: '2026-10-14T10:00:00.000Z', input: { starter: 'fixture-shop', references: ['Paterson'] }, previewToken: 'c'.repeat(48),
    quick: { status: 'done', measured: { status: 'ok' } }, pair: { status: 'designing' } }));
  const restarted = createTryManager({ config, kiro: KIRO, log: quiet });
  await restarted.initialize();
  const after = restarted.get('b'.repeat(32));
  assert.equal(after.pair.status, 'failed');
  assert.match(after.pair.problem, /restarted/u);
  assert.equal(after.quick.status, 'done');
  await closed.close(); await restarted.close();
});

test('two quick posts queue one pair, a finished pair is not built again, and the queue and each address are bounded', async t => {
  const { manager } = await setup(t, { limits: { quickSlots: 1, pairSlots: 1, quickWaiting: 1, pairWaiting: 3, quickPerAddress: 2, pairPerAddress: 1, perHour: 50 } });
  const first = await manager.create({ starter: 'fixture-shop', references: ['Paterson', 'Nujabes'] }, { address: '198.51.100.20' });
  await settled(manager, first.id, 'quick');
  const [one, two] = await Promise.all([manager.design(first.id, { address: '198.51.100.20' }), manager.design(first.id, { address: '198.51.100.20' })]);
  assert.equal(one, two);
  const run = await settled(manager, first.id, 'pair');
  assert.equal(run.pair.status, 'done', run.pair.problem);
  assert.equal(run.pair.arms['with-qloo'].session.calls.filter(call => call.tool === 'mousa:taste_profile').length, 1, 'the pair ran once');
  await assert.rejects(manager.design(first.id, { address: '198.51.100.20' }), error => error.status === 409 && /finished/u.test(error.message));

  // An address holds at most two first steps, and two waiting fill this queue.
  const slow = await setup(t, { scripts: { predict: async ({ stopped }) => { await stopped(); } }, limits: { quickSlots: 1, quickWaiting: 2, quickPerAddress: 2, perHour: 50 } });
  const ask = (address, name) => slow.manager.create({ starter: 'fixture-shop', references: [name] }, { address });
  const a = await ask('198.51.100.21', 'Paterson');
  await ask('198.51.100.21', 'Nujabes');
  await assert.rejects(ask('198.51.100.21', 'Akira'), error => error.status === 429 && /first steps waiting or working/u.test(error.message));
  await ask('198.51.100.22', 'Akira');
  await assert.rejects(ask('198.51.100.23', 'Mushishi'), error => error.status === 503 && /busy: 2 first steps wait/u.test(error.message));
  // A step that ends frees its address's place.
  await slow.manager.cancel(a.id);
  await settled(slow.manager, a.id, 'quick');
  assert.ok(await ask('198.51.100.21', 'Akira'));
});

test('a starter that lacks what it protects is left out, and a record that cannot be read does not stop the server', async t => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-broken-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-broken-starter-'));
  t.after(async () => { await fs.rm(data, { recursive: true, force: true }); await fs.rm(source, { recursive: true, force: true }); });
  await fs.writeFile(path.join(source, 'index.html'), '<!doctype html><title>x</title>');
  const bad = 'd'.repeat(32), stale = 'e'.repeat(32);
  await fs.mkdir(path.join(data, 'try', bad), { recursive: true });
  await fs.writeFile(path.join(data, 'try', bad, 'meta.json'), '{"id": "dd');
  await fs.mkdir(path.join(data, 'try', stale, 'kiro', 'with-qloo', 'agents'), { recursive: true });
  await fs.writeFile(path.join(data, 'try', stale, 'kiro', 'with-qloo', 'agents', 'mousa-try.json'), '{"mcpServers":{"mousa":{"env":{"QLOO_API_KEY":"fixture-key-123"}}}}');
  await fs.writeFile(path.join(data, 'try', stale, 'meta.json'), JSON.stringify({ id: stale, updatedAt: '2026-10-14T10:00:00.000Z', input: { starter: 'kept', references: ['Paterson'] }, previewToken: 'c'.repeat(48), quick: { status: 'done' }, pair: null }));
  const brief = audience => `Design for ${audience}.`;
  const starters = { kept: { id: 'kept', title: 'Kept', medium: 'web', source, summary: 'Has its page.', protect: [], brief },
    missing: { id: 'missing', title: 'Missing', medium: 'web', source, summary: 'Protects data it lacks.', protect: ['data/**'], brief } };
  const config = getConfig({ HOST: '127.0.0.1', DATA_DIR: data, TRY_ACCESS_CODE: 'a-test-only-access-code', QLOO_API_KEY: 'fixture-key-123', KIRO_CLI_PATH: 'kiro-cli-test-only' });
  const warned = [];
  const manager = createTryManager({ config, kiro: KIRO, starters, log: { error: () => {}, warn: message => warned.push(message) } });
  await manager.initialize();
  t.after(() => manager.close());
  assert.deepEqual(manager.starters().map(item => item.id), ['kept']);
  assert.match(manager.readiness().starterProblems[0], /missing: .* has nothing for data\/\*\*/u);
  assert.equal(manager.readiness().open, true, 'the other starter still runs');
  await assert.rejects(manager.create({ starter: 'missing', references: ['Paterson'] }, { address: '198.51.100.30' }), error => error.status === 503);
  assert.ok(warned.some(message => message.includes(bad)), 'the unreadable record is named in the log');
  assert.throws(() => manager.get(bad), error => error.status === 404);
  assert.equal(manager.get(stale).quick.status, 'done');
  assert.ok(!(await exists(path.join(data, 'try', stale, 'kiro', 'with-qloo', 'agents', 'mousa-try.json'))), 'a left agent file, with its key, is removed at start');
});

test('a finished pair its juror agreed to publish joins the gallery as a Kiro comparison, with its three sessions, and nothing of the server', async t => {
  const { manager, data } = await setup(t);
  const runs = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-gallery-runs-'));
  t.after(() => fs.rm(runs, { recursive: true, force: true }));
  const shared = await manager.create({ starter: 'fixture-shop', references: ['Paterson', 'Nujabes'] }, { address: '192.0.2.1' });
  const kept = await manager.create({ starter: 'fixture-shop', references: ['Paterson'] }, { address: '192.0.2.2' });
  for (const id of [shared.id, kept.id]) await settled(manager, id, 'quick');
  await assert.rejects(manager.publish(shared.id, true), error => error.status === 409, 'a measurement alone is not published');
  for (const id of [shared.id, kept.id]) { await manager.design(id, { address: '192.0.2.3' }); await settled(manager, id, 'pair'); }
  await manager.publish(shared.id, true);

  const tries = path.join(data, 'try');
  const entries = await publishedTries(tries);
  assert.deepEqual(entries.map(entry => [entry.id, entry.try]), [[`try-${shared.id.slice(0, 8)}`, shared.id]], 'only the try its juror agreed to publish');
  assert.equal(entries[0].title, 'A test-only shop, for people who love Paterson and Nujabes');
  const out = path.join(data, 'gallery');
  const built = await buildGallery({ config: { entries, featured: entries[0].id, vote: [entries[0].id] }, runsDir: runs, triesDir: tries, repo, out, library: await loadFontLibrary(repo) });
  assert.equal(built.written, true, JSON.stringify(built.findings));
  const entry = await readJson(path.join(out, entries[0].id, 'entry.json'));
  assert.deepEqual([entry.kind, entry.host, entry.origin, entry.surfaceVersion, entry.model], ['comparison', 'kiro', 'try', '0.6.0', 'fixed-test-model']);
  assert.equal(entry.surface, undefined, 'a try runs the current surface');
  assert.deepEqual(entry.timeline.lanes.map(lane => lane.label), ['The prediction session', 'The arm with Qloo', 'The arm without Qloo']);
  assert.ok(entry.timeline.totals.mousa > 0 && entry.timeline.totals.writes > 0);
  assert.equal(entry.reproduce.command, 'node scripts/run-try.mjs --starter fixture-shop --references "Paterson; Nujabes" --pair');
  assert.equal(entry.tryBy, 'juror', 'consent given on the site is the juror\'s');
  assert.match(entries[0].summary, /A juror ran this pair/u);
  assert.deepEqual(entry.play.map(item => item.path), ['out/with-qloo/index.html', 'out/without-qloo/index.html']);
  assert.ok(Number.isInteger(entry.qlooRequests) && entry.qlooRequests > 0);
  const index = await readJson(path.join(out, 'gallery.json'));
  assert.equal(index.entries[0].origin, 'try');
  // The scan knows the folder the tries were kept in: a path to it blocks the gallery.
  await fs.writeFile(path.join(out, entries[0].id, 'report', 'leak.html'), `<p>${path.join(tries, shared.id)}</p>`);
  const { checkGallery } = await import('../src/gallery/build.mjs');
  assert.ok((await checkGallery(out, { folders: [tries] })).some(finding => finding.pattern === 'run folder'));
});

test('the guard knows what each starter lets a design change', async () => {
  assert.ok(matchesPattern('data/**', 'data/walks.json') && matchesPattern('data/**', 'data/a/b.json') && !matchesPattern('data/**', 'database.json'));
  assert.ok(matchesPattern('generated/**', 'generated/portrait-1.png') && matchesPattern('characters/ilo.json', 'characters/ilo.json') && !matchesPattern('characters/ilo.json', 'characters/maren.json'));
  const game = { writable: ['characters/ilo.json', 'generated/**'] }, app = { protect: ['data/**', 'serve.mjs', 'README.md'] };
  assert.deepEqual(['characters/ilo.json', 'characters/maren.json', 'src/game.js', 'generated/x.png'].map(file => designFile(game, file)), [true, false, false, true]);
  assert.deepEqual(['index.html', 'tokens/tokens.css', 'data/walks.json', 'serve.mjs'].map(file => designFile(app, file)), [true, true, false, false]);

  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-guard-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-try-guard-source-'));
  try {
    for (const [file, text] of [['characters/ilo.json', '{}'], ['characters/maren.json', '{"keeper":true}'], ['src/game.js', 'run()']]) {
      for (const root of [folder, source]) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
    }
    const crypto = await import('node:crypto');
    const original = new Map();
    for (const file of ['characters/ilo.json', 'characters/maren.json', 'src/game.js']) original.set(file, crypto.createHash('sha256').update(await fs.readFile(path.join(source, file))).digest('hex'));
    await fs.writeFile(path.join(folder, 'characters', 'ilo.json'), '{"palette":{}}');
    await fs.writeFile(path.join(folder, 'src', 'game.js'), 'hack()');
    await fs.writeFile(path.join(folder, 'world.json'), '{}');
    await fs.mkdir(path.join(folder, 'generated'), { recursive: true });
    await fs.writeFile(path.join(folder, 'generated', 'portrait-1.png'), 'png');
    await fs.mkdir(path.join(folder, '.mousa'), { recursive: true });
    await fs.writeFile(path.join(folder, '.mousa', 'session.json'), '{}');
    assert.deepEqual(await guardArm({ folder, source, starter: game, original }), { restored: ['src/game.js'], removed: ['world.json'] });
    assert.equal(await fs.readFile(path.join(folder, 'src', 'game.js'), 'utf8'), 'run()');
    assert.equal(await fs.readFile(path.join(folder, 'characters', 'ilo.json'), 'utf8'), '{"palette":{}}', 'the character is the design\'s');
    assert.ok(await exists(path.join(folder, 'generated', 'portrait-1.png')) && await exists(path.join(folder, '.mousa', 'session.json')));
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  }
  void prediction; void repo;
});
