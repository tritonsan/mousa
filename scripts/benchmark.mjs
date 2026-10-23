// The blind spot benchmark of docs/benchmark/README.md: how much of what an audience loves, as Qloo measures it, an AI
// coding agent already knows when it is asked to design for it. Four steps, each resumable:
//   node scripts/benchmark.mjs plan                         the folders and the engine's plans: no model, no request
//   node scripts/benchmark.mjs predict --host <claude-code|codex|kiro> [--only id,id]
//                                                           the agent freezes its prediction, with no Qloo key
//   node scripts/benchmark.mjs measure                      Qloo, engine only, after the predictions are committed
//   node scripts/benchmark.mjs analyze                      docs/benchmark/results.json and results.md
// --folder moves the work folders (default <drive>/mousa-live/benchmark, outside this repository); --pilot "A,B" runs
// one audience that is not in the list, into <folder>/pilot, to try the steps without touching the benchmark.
// The sessions get no Qloo key, no connections file and no file, shell or web tool; a prediction whose session made a
// Qloo request, changed the plan or broke its seal is not accepted.
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadDotEnv, getConfig, rootDir } from '../src/config.mjs';
import { createMousaServer } from '../plugin/server/mcp/mousa.mjs';
import { listText } from '../plugin/server/design/report.mjs';
import { sealHolds } from '../plugin/server/taste/seal.mjs';
import { runTrySession } from '../src/try/kiro.mjs';
import { summarize } from './run-claude-code-live.mjs';

const run = promisify(execFile);
const BENCH = path.join(rootDir, 'docs', 'benchmark');
const HOSTS = ['claude-code', 'codex', 'kiro'];
// What a session must not inherit: a host's own variables, and every key and setting of Moûsa, Qloo and Kiro.
const HOST_VARIABLES = /^(?:CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|ANTHROPIC_.*|MOUSA_.*|QLOO_.*|KIRO_.*|CODEX_HOME)$/u;
const PREDICT_LIMIT_MS = 6 * 60 * 1000;
const BOOTSTRAP = { resamples: 10000, seed: 20261023 };
const WORK_DOMAINS_EXCLUDED = new Set(['style', 'aesthetic', 'tone', 'qualities', 'art_style']);

const option = (name, fallback = null) => { const at = process.argv.indexOf(name); return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback; };
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse, () => null);
const writeJson = (file, value) => fs.mkdir(path.dirname(file), { recursive: true }).then(() => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`));
const exists = file => fs.stat(file).then(() => true, () => false);

loadDotEnv();
const config = getConfig();
const spec = JSON.parse(await fs.readFile(path.join(BENCH, 'audiences.json'), 'utf8'));
const pilotSeeds = option('--pilot');
const work = path.resolve(option('--folder', path.join(path.parse(rootDir).root, 'mousa-live', 'benchmark')), ...(pilotSeeds ? ['pilot'] : []));
const audiences = pilotSeeds
  ? [{ id: 'pilot', seeds: pilotSeeds.split(',').map(item => item.trim()).filter(Boolean) }]
  : spec.audiences.filter(item => !option('--only') || option('--only').split(',').includes(item.id));
const briefOf = audience => spec.brief.replace('{audience}', listText(audience.seeds));
const folderOf = (host, audience) => path.join(work, host, audience.id);
const projectOf = (host, audience) => path.join(folderOf(host, audience), 'project');
const taste = (host, audience, name) => path.join(projectOf(host, audience), '.mousa', 'taste', `${name}.json`);

/** Moûsa's engine for one project folder, as the live try runs it: with the Qloo key only to measure. */
function engine(project, host, { qloo = false } = {}) {
  const env = { MOUSA_PROJECT_DIR: project, MOUSA_HOST: host, MOUSA_IMAGES: 'off', MOUSA_CAPTURE: 'off', MOUSA_LIBRARY_ROOT: rootDir, MOUSA_QLOO_BUDGET: '40',
    ...(qloo ? { QLOO_API_KEY: config.qlooKey, ...(config.qlooBaseUrl ? { QLOO_BASE_URL: config.qlooBaseUrl } : {}) } : {}) };
  return createMousaServer({ env, store: { read: async () => null }, page: { open: async () => { throw new Error('The benchmark opens no key page.'); } },
    inspect: { browser: async () => ({ available: false, reason: 'The benchmark captures nothing.' }), codex: async () => ({ available: false, reason: 'The benchmark makes no picture.' }) } });
}
async function call(server, name, args) {
  const result = await server.callTool(name, args);
  let value;
  try { value = JSON.parse(result.content?.find(item => item.type === 'text')?.text || '{}'); } catch { value = {}; }
  if (result.isError) throw new Error(value.error?.message || `${name} could not complete.`);
  return value;
}

/** The prediction prompt: the live try's, for a run where Qloo is off on purpose. */
function predictPrompt(brief) {
  return `You are Moûsa's agent in a benchmark run. The request is at the end. Moûsa has already planned the taste questions for it, so do only this:

1. Call Moûsa's taste_profile tool with dryRun: true and no other field. It returns the saved plan and the domains your prediction must cover.
2. Before any Qloo data, write your own prediction of what this audience loves in each of those domains, three to six entries each, and the design you would make from that alone, as Moûsa's taste-brief skill describes. Save it with Moûsa's design_validate tool, with stage "prediction". If it refuses the artifact, fix what it names and save again.
3. Stop there. Qloo is not connected in this run on purpose: do not try to measure the audience, connect Qloo, design anything or write any file.

The request:
${brief}`;
}

/** A clean environment for a session: none of the host's, Moûsa's, Qloo's or Kiro's variables, and an empty connections folder. */
function cleanEnv(folder) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !HOST_VARIABLES.test(name)));
  return { ...env, MOUSA_CONFIG_DIR: path.join(folder, 'connections'), MOUSA_IMAGES: 'off', CODEX_IMAGES: 'off', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' };
}

async function version(command, args = ['--version']) {
  try { return (await run(command, args, { windowsHide: true, timeout: 30000 })).stdout.trim().split('\n')[0]; } catch { return null; }
}

/** Runs a process with a time limit; its stdout goes to a file. */
function runProcess(command, args, { cwd, env, input, streamFile, limitMs = PREDICT_LIMIT_MS }) {
  return new Promise(resolve => {
    const started = Date.now();
    const stream = createWriteStream(streamFile);
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '', stopped = null;
    child.stdout.pipe(stream);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const timer = setTimeout(() => { stopped = 'time limit'; child.kill(); }, limitMs);
    child.on('close', code => { clearTimeout(timer); stream.end(() => resolve({ exitCode: code, stopped, stderr, durationMs: Date.now() - started })); });
    child.stdin.end(input || '');
  });
}

const RUNNERS = {
  async 'claude-code'({ folder, project, prompt }) {
    const claude = process.platform === 'win32' ? 'claude.exe' : 'claude';
    // Only Moûsa's tools and the skill reader: no file, shell or web tool.
    const args = ['-p', '--plugin-dir', path.join(rootDir, 'plugins', 'claude-code'), '--output-format', 'stream-json', '--verbose', '--max-turns', '24',
      '--permission-mode', 'dontAsk', '--allowedTools', 'Skill,mcp__plugin_mousa_mousa'];
    const streamFile = path.join(folder, 'predict.jsonl');
    const result = await runProcess(claude, args, { cwd: project, env: cleanEnv(folder), input: prompt, streamFile });
    const stream = await summarize(streamFile);
    return { ...result, model: stream.init?.model || null, hostVersion: await version(claude), calls: stream.counts, errors: stream.errors.length, turns: stream.result?.turns ?? null };
  },
  async codex({ folder, project, prompt }) {
    const codex = await codexPath();
    // The person's config.toml is ignored for its approvals, sandbox and servers, so its model and reasoning effort are
    // passed on by name (amendment 1 of the protocol).
    const { model, effort } = await codexModel();
    const overrides = ['-c', `marketplaces={ mousa = { source_type = "local", source = '${rootDir}' } }`, '-c', 'plugins={ "mousa@mousa" = { enabled = true, mcp_servers = { mousa = { default_tools_approval_mode = "approve" } } } }',
      ...(model ? ['-c', `model="${model}"`] : []), ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
      ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="elevated"'] : [])];
    // A read-only sandbox: the session writes nothing itself, and Moûsa's server saves the prediction.
    const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', project, ...overrides,
      '--dangerously-bypass-hook-trust', '-o', path.join(folder, 'last-message.md'), '-'];
    const streamFile = path.join(folder, 'predict.jsonl');
    const result = await runProcess(codex, args, { cwd: project, env: cleanEnv(folder), input: prompt, streamFile });
    const items = (await fs.readFile(streamFile, 'utf8').catch(() => '')).split('\n').map(line => { try { return JSON.parse(line).item; } catch { return null; } }).filter(Boolean);
    // Codex reads a skill's files with its shell, in the read-only sandbox; any other command is reported.
    const commands = items.filter(item => item.type === 'command_execution' && item.exit_code !== null && item.exit_code !== undefined).map(item => String(item.command || ''));
    const otherCommands = commands.filter(command => !/Get-Content\s+-LiteralPath\s+'[^']*[\\/]plugins[\\/]cache[\\/]mousa[\\/]mousa[\\/][^']*[\\/]skills[\\/][^']+\.md'"?$/u.test(command.trim()));
    const mousa = items.filter(item => item.type === 'mcp_tool_call' && item.status === 'completed').map(item => item.tool);
    return { ...result, model: model ? `${model}${effort ? ` (reasoning effort ${effort})` : ''}` : null, hostVersion: await version(codex),
      calls: { mousa: mousa.length, skillReads: commands.length - otherCommands.length }, ...(otherCommands.length ? { otherCommands: otherCommands.map(command => command.slice(0, 200)) } : {}) };
  },
  async kiro({ folder, project, prompt }) {
    // The live try's own prediction session: Moûsa's tools only, no read, write or shell, and no Qloo key, with the
    // model the hosted try runs (amendment 1: Kiro's own default, auto, does not say which model answered).
    const model = config.model || 'claude-opus-5.5';
    const session = await runTrySession({ config: { ...config, model }, kind: 'predict', home: path.join(folder, 'kiro-home'), project,
      starter: { id: 'benchmark', medium: spec.medium, protect: [] }, prompt, model, streamFile: path.join(folder, 'predict.jsonl') });
    return { exitCode: session.exitCode ?? null, stopped: session.stopped ?? null, durationMs: session.durationMs, model,
      hostVersion: await version(config.kiroPath), calls: { mousa: (session.calls || []).length }, ...(Number.isFinite(session.credits) ? { credits: session.credits } : {}),
      ...(session.error ? { error: String(session.error).slice(0, 300) } : {}) };
  },
};

/** The model and reasoning effort the person's own Codex config.toml names at its top level, before any table. */
async function codexModel() {
  const text = await fs.readFile(path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex'), 'config.toml'), 'utf8').catch(() => '');
  const top = text.split(/^\s*\[/mu)[0];
  const value = key => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'mu').exec(top)?.[1] || null;
  return { model: value('model'), effort: value('model_reasoning_effort') };
}

/** The newest Codex CLI the desktop app installed, or CODEX_CLI_PATH, or codex on PATH. */
async function codexPath() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  const bin = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  const found = [];
  for (const entry of await fs.readdir(bin, { withFileTypes: true }).catch(() => [])) {
    const file = entry.isDirectory() ? path.join(bin, entry.name, 'codex.exe') : entry.name === 'codex.exe' ? path.join(bin, entry.name) : null;
    const stat = file ? await fs.stat(file).catch(() => null) : null;
    if (stat?.isFile()) found.push({ file, time: stat.mtimeMs });
  }
  return found.sort((a, b) => b.time - a.time)[0]?.file || 'codex';
}

async function plan() {
  for (const host of HOSTS) for (const audience of audiences) {
    const project = projectOf(host, audience);
    await fs.mkdir(project, { recursive: true });
    if (await exists(taste(host, audience, 'plan'))) continue;
    const planned = await call(engine(project, host), 'taste_profile', { dryRun: true, medium: spec.medium,
      references: audience.seeds.map(name => ({ name, role: 'audience', origin: 'user-provided' })) });
    await writeJson(path.join(folderOf(host, audience), 'run.json'), { audience: audience.id, seeds: audience.seeds, host, brief: briefOf(audience),
      plan: { status: planned.status, domains: planned.plan?.domains || null } });
    console.log(`${host} ${audience.id}: ${planned.status} ${planned.plan?.domains?.join(', ') || planned.next || ''}`);
  }
}

async function predict(host) {
  if (!RUNNERS[host]) throw new Error(`--host must be one of ${HOSTS.join(', ')}.`);
  if (host === 'codex') await codexPlugin('install');
  try {
    for (const audience of audiences) {
      const folder = folderOf(host, audience), project = projectOf(host, audience);
      if (!(await exists(taste(host, audience, 'plan')))) { console.log(`${audience.id}: no plan; run plan first`); continue; }
      if (await exists(taste(host, audience, 'prediction'))) { console.log(`${audience.id}: already predicted`); continue; }
      const planText = await fs.readFile(taste(host, audience, 'plan'), 'utf8');
      const attempts = [];
      for (let attempt = 1; attempt <= 2; attempt++) {
        const started = new Date().toISOString();
        const result = await RUNNERS[host]({ folder, project, prompt: predictPrompt(briefOf(audience)) });
        attempts.push({ attempt, startedAt: started, ...result, stderr: undefined });
        if ((await fs.readFile(taste(host, audience, 'plan'), 'utf8').catch(() => '')) !== planText) { await fs.writeFile(taste(host, audience, 'plan'), planText); attempts.at(-1).planRestored = true; }
        // A session that ran anything besides its skill reads is set aside and run once more (amendment 1).
        if (result.otherCommands?.length && attempt < 2 && await exists(taste(host, audience, 'prediction'))) {
          await fs.rename(taste(host, audience, 'prediction'), path.join(folder, `prediction.rejected-${attempt}.json`));
          continue;
        }
        if (await exists(taste(host, audience, 'prediction'))) break;
      }
      const prediction = await readJson(taste(host, audience, 'prediction'));
      const usage = await readJson(path.join(project, '.mousa', 'usage.json'));
      const problems = [];
      if (!prediction) problems.push('no prediction was frozen');
      if (prediction && sealHolds(prediction) !== true) problems.push('the prediction does not match its seal');
      if ((usage?.qlooRequests || 0) > 0) problems.push(`the session made ${usage.qlooRequests} Qloo requests`);
      if (await exists(taste(host, audience, 'profile'))) problems.push('the session measured the audience');
      if (attempts.at(-1)?.otherCommands?.length) problems.push(`the session ran ${attempts.at(-1).otherCommands.length} command(s) besides reading its skill files`);
      const last = attempts.at(-1) || {};
      const record = { audience: audience.id, seeds: audience.seeds, host, hostVersion: last.hostVersion || null, model: last.model || null, attempts, accepted: !problems.length, problems };
      await writeJson(path.join(folder, 'predict.json'), record);
      if (!problems.length && !pilotSeeds) {
        await writeJson(path.join(BENCH, 'predictions', host, `${audience.id}.json`), { audience: audience.id, seeds: audience.seeds, host, hostVersion: record.hostVersion,
          model: record.model, brief: briefOf(audience), prediction });
      }
      console.log(`${host} ${audience.id}: ${problems.length ? `REJECTED (${problems.join('; ')})` : `frozen ${prediction.frozenAt}, ${prediction.entries.length} entries, sealed ${prediction.sha256.slice(0, 12)}`}`
        + ` · ${attempts.length} attempt(s), ${Math.round((last.durationMs || 0) / 1000)} s, model ${record.model || 'unknown'}`);
    }
  } finally {
    if (host === 'codex') await codexPlugin('remove');
  }
}

/** Codex has no per-session plugin folder: the plugin is installed from this repository's marketplace for the batch. */
async function codexPlugin(action) {
  const codex = await codexPath();
  const steps = action === 'install' ? [['plugin', 'remove', 'mousa@mousa'], ['plugin', 'marketplace', 'add', rootDir], ['plugin', 'add', 'mousa@mousa']]
    : [['plugin', 'remove', 'mousa@mousa'], ['plugin', 'marketplace', 'remove', 'mousa']];
  for (const args of steps) {
    const outcome = await run(codex, args, { windowsHide: true, timeout: 120000 }).then(() => 'ok', error => String(error.stderr || error.message).slice(0, 200));
    if (action === 'install' && args.at(-1) === 'mousa@mousa' && args[1] === 'add' && outcome !== 'ok') throw new Error(`The Codex plugin did not install: ${outcome}`);
  }
}

async function measure() {
  if (!config.qlooKey) throw new Error('No QLOO_API_KEY in .env.');
  for (const host of HOSTS) for (const audience of audiences) {
    const folder = folderOf(host, audience), project = projectOf(host, audience);
    const predicted = await readJson(path.join(folder, 'predict.json'));
    if (!predicted?.accepted) continue;
    if (await exists(path.join(folder, 'measure.json'))) continue;
    let result;
    try {
      const brief = await call(engine(project, host, { qloo: true }), 'taste_profile', {});
      result = { status: brief.status, at: new Date().toISOString() };
    } catch (error) { result = { status: 'error', error: String(error.message).slice(0, 300), at: new Date().toISOString() }; }
    const usage = await readJson(path.join(project, '.mousa', 'usage.json'));
    await writeJson(path.join(folder, 'measure.json'), { ...result, qlooRequests: usage?.qlooRequests ?? null });
    console.log(`${host} ${audience.id}: ${result.status}${result.error ? ` (${result.error})` : ''}, ${usage?.qlooRequests ?? 0} requests`);
  }
}

// mulberry32: a small seeded generator, so the intervals come out the same on every machine.
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
function interval(values, seed = BOOTSTRAP.seed) {
  if (values.length < 2) return null;
  const next = random(seed), means = [];
  for (let index = 0; index < BOOTSTRAP.resamples; index++) {
    let total = 0;
    for (let pick = 0; pick < values.length; pick++) total += values[Math.floor(next() * values.length)];
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * means.length)], means[Math.ceil(0.975 * means.length) - 1]];
}
const round = value => value === null || value === undefined ? null : Math.round(value * 1000) / 1000;
function verdict(estimate, range, threshold) {
  if (estimate === null) return 'no data';
  if (range && range[1] < threshold) return 'supported';
  return estimate < threshold ? 'not established' : 'not supported';
}

/** One run's numbers from its own records: the engine's metrics, and the names on both sides by domain. */
async function runResult(host, audience) {
  const folder = folderOf(host, audience);
  const predicted = await readJson(path.join(folder, 'predict.json'));
  const measured = await readJson(path.join(folder, 'measure.json'));
  const input = await readJson(taste(host, audience, 'input'));
  const prediction = await readJson(taste(host, audience, 'prediction'));
  const base = { audience: audience.id, seeds: audience.seeds, host, hostVersion: predicted?.hostVersion || null, model: predicted?.model || null };
  if (!predicted?.accepted) return { ...base, status: 'failed', problems: predicted?.problems || ['not run'] };
  if (measured?.status !== 'ok' || !input?.metrics) return { ...base, status: 'not measurable', measureStatus: measured?.status || null };
  const metrics = input.metrics;
  const works = (input.entities || []).filter(entity => entity.source === 'qloo' && !WORK_DOMAINS_EXCLUDED.has(entity.domain));
  const byDomain = {};
  for (const entity of works) {
    const row = byDomain[entity.domain] ||= { works: 0, known: 0 };
    row.works += 1;
    if (entity.predictedByModel) row.known += 1;
  }
  // Names only, as the gallery shows them: up to six measured works per domain, each marked, and the prediction's own.
  const measuredNames = {};
  for (const entity of works) {
    const list = measuredNames[entity.domain] ||= [];
    if (list.length < 6) list.push({ name: entity.name, mark: entity.predictedByModel ? 'predicted' : 'new' });
  }
  const predictedNames = {};
  for (const entry of prediction?.entries || []) (predictedNames[entry.domain] ||= []).push(entry.name);
  const known = metrics.predictedByModel ?? 0, total = metrics.measuredEntities ?? 0, guessed = metrics.predictions ?? 0, confirmed = metrics.predictionsConfirmed ?? 0;
  return { ...base, status: 'measured', sha256: prediction?.sha256 || null, works: total, known, knownShare: total ? known / total : null, guessed, confirmed,
    confirmedShare: guessed ? confirmed / guessed : null, qualities: metrics.measuredQualities ?? null, qualitiesKnown: metrics.qualitiesPredicted ?? null,
    qualitiesKnownShare: metrics.measuredQualities ? (metrics.qualitiesPredicted ?? 0) / metrics.measuredQualities : null, knownFromBrief: metrics.knownFromBrief ?? 0,
    byDomain, names: { predicted: predictedNames, measured: measuredNames } };
}

async function analyze() {
  const runs = [];
  for (const host of HOSTS) for (const audience of audiences) runs.push(await runResult(host, audience));
  // An audience Qloo could not measure for any agent is out of every agent's means.
  const measurable = new Set(audiences.filter(audience => runs.some(item => item.audience === audience.id && item.status === 'measured')).map(audience => audience.id));
  const hosts = {};
  for (const host of HOSTS) {
    const rows = runs.filter(item => item.host === host && item.status === 'measured' && measurable.has(item.audience));
    const measureOf = key => { const values = rows.map(item => item[key]).filter(value => value !== null); const estimate = mean(values); return { mean: round(estimate), interval: interval(values)?.map(round) || null, n: values.length }; };
    const pooled = (part, whole) => { const a = rows.reduce((t, item) => t + (item[part] || 0), 0), b = rows.reduce((t, item) => t + (item[whole] || 0), 0); return { part: a, whole: b, share: b ? round(a / b) : null }; };
    const known = measureOf('knownShare'), confirmed = measureOf('confirmedShare');
    const domains = {};
    for (const item of rows) for (const [domain, row] of Object.entries(item.byDomain)) { const sum = domains[domain] ||= { works: 0, known: 0 }; sum.works += row.works; sum.known += row.known; }
    hosts[host] = {
      runs: rows.length, failed: runs.filter(item => item.host === host && item.status === 'failed').length,
      models: [...new Set(rows.map(item => item.model).filter(Boolean))], versions: [...new Set(rows.map(item => item.hostVersion).filter(Boolean))],
      knownShare: known, confirmedShare: confirmed, qualitiesKnownShare: measureOf('qualitiesKnownShare'),
      pooled: { known: pooled('known', 'works'), confirmed: pooled('confirmed', 'guessed') },
      byDomain: Object.fromEntries(Object.entries(domains).map(([domain, row]) => [domain, { ...row, knownShare: row.works ? round(row.known / row.works) : null }])),
      hypotheses: { H1: verdict(known.mean, known.interval, 0.15), H2: verdict(confirmed.mean, confirmed.interval, 0.25) },
    };
  }
  // Exploratory: paired by audience, each agent against each other on the known share.
  const pairs = [];
  for (const [a, b] of [['claude-code', 'codex'], ['claude-code', 'kiro'], ['codex', 'kiro']]) {
    const diffs = [];
    for (const id of measurable) {
      const x = runs.find(item => item.host === a && item.audience === id && item.status === 'measured'), y = runs.find(item => item.host === b && item.audience === id && item.status === 'measured');
      if (x && y && x.knownShare !== null && y.knownShare !== null) diffs.push(x.knownShare - y.knownShare);
    }
    pairs.push({ hosts: [a, b], audiences: diffs.length, meanDifference: round(mean(diffs)), interval: interval(diffs)?.map(round) || null, exploratory: true });
  }
  const results = { protocol: 'docs/benchmark/README.md', analyzedAt: new Date().toISOString(), audiences: audiences.length, measurable: measurable.size,
    notMeasurable: audiences.filter(audience => !measurable.has(audience.id)).map(audience => audience.id), bootstrap: BOOTSTRAP, hosts, pairs,
    runs: runs.map(item => ({ ...item, knownShare: round(item.knownShare), confirmedShare: round(item.confirmedShare), qualitiesKnownShare: round(item.qualitiesKnownShare) })) };
  if (pilotSeeds) { console.log(JSON.stringify(results, null, 2)); return; }
  await writeJson(path.join(BENCH, 'results.json'), results);
  await fs.writeFile(path.join(BENCH, 'results.md'), resultsText(results));
  console.log(resultsText(results));
}

const percent = value => value === null || value === undefined ? 'n/a' : `${(100 * value).toFixed(1)}%`;
const range = value => value ? `${percent(value[0])} to ${percent(value[1])}` : 'n/a';
function resultsText(results) {
  const lines = ['# The blind spot benchmark: results', '', `Analyzed ${results.analyzedAt.slice(0, 10)} under the [pre-registered protocol](README.md). ${results.measurable} of ${results.audiences} audiences could be measured${results.notMeasurable.length ? `; not measurable: ${results.notMeasurable.join(', ')}` : ''}.`, '',
    '| Agent | Runs | Known share (mean, 95% interval) | Confirmed share (mean, 95% interval) | H1 (< 15%) | H2 (< 25%) |', '|---|---|---|---|---|---|'];
  for (const [host, row] of Object.entries(results.hosts)) lines.push(`| ${host} (${row.models.join(', ') || 'model unknown'}) | ${row.runs}${row.failed ? `, ${row.failed} failed` : ''} | ${percent(row.knownShare.mean)} (${range(row.knownShare.interval)}) | ${percent(row.confirmedShare.mean)} (${range(row.confirmedShare.interval)}) | ${row.hypotheses.H1} | ${row.hypotheses.H2} |`);
  lines.push('', 'Pooled over audiences:');
  for (const [host, row] of Object.entries(results.hosts)) lines.push(`- ${host}: the predictions named ${row.pooled.known.part} of ${row.pooled.known.whole} measured works (${percent(row.pooled.known.share)}); ${row.pooled.confirmed.part} of ${row.pooled.confirmed.whole} predicted works were measured (${percent(row.pooled.confirmed.share)}).`);
  lines.push('', 'Exploratory, paired by audience (known share, first agent minus second):');
  for (const pair of results.pairs) lines.push(`- ${pair.hosts.join(' − ')}: ${percent(pair.meanDifference)} over ${pair.audiences} audiences (${range(pair.interval)})`);
  lines.push('', 'Every run, its prediction and its seal are in results.json and predictions/. Qloo\'s names appear there; its ids, scores and descriptions do not.', '');
  return lines.join('\n');
}

const command = process.argv[2];
if (command === 'plan') await plan();
else if (command === 'predict') await predict(option('--host'));
else if (command === 'measure') await measure();
else if (command === 'analyze') await analyze();
else console.log('Usage: node scripts/benchmark.mjs plan | predict --host <claude-code|codex|kiro> [--only id,id] | measure | analyze  [--folder dir] [--pilot "A,B"]');
