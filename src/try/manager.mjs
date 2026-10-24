// The live try: a juror's request run on this server in two steps. Step one plans the taste questions, lets a short
// Kiro session freeze the model's own prediction, measures the audience with Qloo here and writes the measurement
// report. Step two, when the juror asks for it, copies the starter into two arms with the same frozen prediction, locks
// one to Qloo's measurement and the other to the prediction alone, runs one Kiro session in each and writes the
// comparison report. A run's folder is laid out as the plugin's comparisons are (project/.mousa beside
// project/compare/<arm>), so the reports and the gallery read it as they read those. Kiro's homes and the session
// streams stay in the run's private folders, and nothing of a run is public until the juror consents.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createMousaServer, MOUSA_SERVER_VERSION } from '../../plugin/server/mcp/mousa.mjs';
import { collectProjectFiles, styleFootprint } from '../../plugin/server/design/systems.mjs';
import { readQlooUsage } from '../../plugin/server/taste/cache.mjs';
import { STARTERS, checkTryInput, tryBrief, tryPlan } from './starters.mjs';
import { predictPrompt, armPrompt, TRY_PROMPTS_VERSION } from './prompts.mjs';
import { runTrySession, sessionProblem, SESSION_LIMITS, TRY_AGENT } from './kiro.mjs';

export const TRY_DIR = 'try';
export const TRY_SCHEMA_VERSION = '1.0';
// Two first steps and one pair work at once; a few more wait. Each address starts ten tries an hour and keeps at most
// two first steps and one pair waiting or working. New runs stop while the disk holds less than minFreeBytes.
export const TRY_LIMITS = Object.freeze({ quickSlots: 2, pairSlots: 1, quickWaiting: 6, pairWaiting: 3, quickPerAddress: 2, pairPerAddress: 1, perHour: 10,
  pairMs: 35 * 60 * 1000, runs: 400, starterBytes: 16 * 1024 * 1024, starterFiles: 400, minFreeBytes: 2 * 1024 ** 3 });
export const TRY_ARMS = Object.freeze([
  Object.freeze({ id: 'with-qloo', folder: 'compare/with-qloo', kind: 'qloo', label: 'With Qloo' }),
  Object.freeze({ id: 'without-qloo', folder: 'compare/without-qloo', kind: 'baseline', label: 'Without Qloo' }),
]);
export const RUN_ID = /^[a-f0-9]{32}$/u;
export const QUICK_ACTIVE = Object.freeze(['queued', 'planning', 'predicting', 'measuring']);
export const PAIR_ACTIVE = Object.freeze(['queued', 'preparing', 'designing', 'reporting']);
const PAUSE_FILE = 'PAUSED';
const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
// The records a prediction session may leave: its prediction, the design start it notes, and its stage.
const AFTER_PREDICTION = Object.freeze(['input', 'brief', 'profile', 'evidence', 'decisions']);
const NO_CONNECTIONS = Object.freeze({ read: async () => null });
const NO_PAGE = Object.freeze({ open: async () => { throw new Error('The try opens no connection page.'); } });
const HOST_INSPECT = Object.freeze({ browser: async () => ({ available: false, reason: 'The host writes its reports without pictures.' }), codex: async () => ({ available: false, reason: 'A hosted server has no image generator.' }) });

export class TryError extends Error { constructor(status, message) { super(message); this.name = 'TryError'; this.status = status; } }
/** A step that cannot go on, in words the try page shows. */
class StepError extends Error {}

// A record another process may be writing reads as missing, never as an error.
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const exists = file => fs.stat(file).then(() => true, () => false);
const hashFile = file => fs.readFile(file).then(bytes => crypto.createHash('sha256').update(bytes).digest('hex'), () => null);
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  // A reader holding the file open makes Windows refuse the rename for a moment.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temporary, file); return; } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) { await fs.rm(temporary, { force: true }); throw error; }
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

/** A starter's pattern against a relative path: ** spans folders, * stays inside one. */
export function matchesPattern(pattern, file) {
  const source = pattern.replace(/^\.\//u, '').split('**').map(part => part.split('*').map(text => text.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${source}$`, 'su').test(file);
}

/** Whether the design may change a file of its arm: a starter with `writable` names its files, one with `protect` the rest. */
export const designFile = (starter, file) => starter.writable ? starter.writable.some(pattern => matchesPattern(pattern, file)) : !(starter.protect || []).some(pattern => matchesPattern(pattern, file));

/** A folder's files by relative path, without dot entries or node_modules, regular files only; `limits` caps a starter. */
export async function folderFiles(root, limits = null) {
  const files = [];
  let bytes = 0;
  async function walk(dir, prefix) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name, full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, relative);
      else if (entry.isFile()) {
        files.push(relative);
        if (limits) {
          bytes += (await fs.stat(full)).size;
          if (files.length > limits.starterFiles || bytes > limits.starterBytes) throw new StepError('The starter is larger than the try copies.');
        }
      }
    }
  }
  await walk(root, '');
  return files.sort();
}

/** What keeps a starter from being copied as its request expects: its folder, and the files it protects or names. */
export async function starterProblem(starter, rootDir) {
  if (!starter.source) return null;
  const folder = path.resolve(rootDir, starter.source);
  if (!(await fs.stat(folder).then(stat => stat.isDirectory(), () => false))) return `${starter.id}: its folder ${starter.source} is missing.`;
  const files = await folderFiles(folder);
  const missing = [...(starter.protect || []).filter(pattern => !files.some(file => matchesPattern(pattern, file))),
    ...(starter.writable || []).filter(pattern => !pattern.includes('*') && !files.includes(pattern.replace(/^\.\//u, '')))];
  return missing.length ? `${starter.id}: ${starter.source} has nothing for ${missing.join(', ')}.` : null;
}

/**
 * After a session, the arm keeps only what its design may change: a starter's protected file that differs is put back
 * from the starter, and a file the design may not add is removed. Its .mousa records stay as they are.
 */
export async function guardArm({ folder, source, starter, original }) {
  const restored = [], removed = [];
  for (const [file, hash] of original) {
    if (designFile(starter, file)) continue;
    const target = path.join(folder, ...file.split('/'));
    if (await hashFile(target) === hash) continue;
    // A folder on the way that became a file is cleared first, so the starter's file can go back.
    for (let parent = path.dirname(target); parent.startsWith(folder) && parent !== folder; parent = path.dirname(parent)) {
      if ((await fs.lstat(parent).catch(() => null))?.isFile()) await fs.rm(parent, { force: true });
    }
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(source, ...file.split('/')), target);
    restored.push(file);
  }
  for (const file of await folderFiles(folder)) {
    if (original.has(file) || designFile(starter, file)) continue;
    await fs.rm(path.join(folder, ...file.split('/')), { force: true });
    removed.push(file);
  }
  return { restored, removed };
}

/** A session as a run keeps it: how long, how it ended and its calls by tool and outcome, with no title, input or output. */
const sessionSummary = session => ({ durationMs: session.durationMs, exitCode: session.exitCode ?? null, finished: session.finished?.at(-1)?.status ?? null,
  ...(sessionProblem(session) ? { problem: sessionProblem(session) } : {}), ...(session.refused ? { blocked: session.refused } : {}),
  // What Kiro metered: the session's credits and the fullest its context window got, and stream lines too long to keep.
  ...(Number.isFinite(session.credits) ? { credits: session.credits } : {}), ...(Number.isFinite(session.contextPeak) ? { contextPeak: session.contextPeak } : {}),
  ...(session.dropped ? { dropped: session.dropped } : {}),
  calls: session.calls.map(call => ({ at: call.at, tool: call.tool, status: call.status, ...(call.code ? { code: call.code } : {}) })) });

/**
 * The try's manager. `kiro` is the Studio's Kiro inspection (or a function that gives it); `requireAccess: false`
 * lets a run start without TRY_ACCESS_CODE, as scripts/run-try.mjs does on the operator's own machine. `starters`,
 * `limits`, `runSession`, `spawnImpl`, `fetchImpl` and `now` replace the real ones in tests.
 */
export function createTryManager({ config, kiro = {}, requireAccess = true, starters = STARTERS, limits: given = {}, runSession = runTrySession, spawnImpl, fetchImpl, now = Date.now, log = console }) {
  const limits = { ...TRY_LIMITS, ...given };
  const base = path.join(config.dataDir, TRY_DIR);
  const runs = new Map(), controllers = new Map(), live = new Map(), tasks = new Set(), recent = new Map(), broken = new Map();
  // Who asked for each step that waits or works, by address, in memory only: a restart ends those steps anyway.
  const askers = new Map(), reserving = new Set();
  const lanes = { quick: { slots: limits.quickSlots, running: new Set(), waiting: [] }, pair: { slots: limits.pairSlots, running: new Set(), waiting: [] } };
  const budget = config.tryQlooBudget || 24;
  // The Studio may inspect Kiro again while it runs, so its status is read when it is needed.
  const status = () => (typeof kiro === 'function' ? kiro() : kiro) || {};
  const model = () => config.model || status().defaultModel || '';
  const stamp = () => new Date(now()).toISOString();
  const folderOf = id => path.join(base, id);
  const projectOf = id => path.join(folderOf(id), 'project');
  const armFolder = (id, arm) => path.join(projectOf(id), ...arm.folder.split('/'));
  // A try's Qloo requests are counted in one file, step one's, whichever folder or workspace sends them.
  const usageOf = id => path.join(projectOf(id), '.mousa', 'usage.json');
  let closed = false;

  /** Why the try cannot take a run here, if it cannot: what the server lacks, never a secret. */
  function readiness() {
    const missing = [];
    if (requireAccess && !config.tryAccessCode) missing.push('TRY_ACCESS_CODE is not set.');
    if (!status().available) missing.push('Kiro CLI is not available.');
    else if (!status().authenticated) missing.push('Kiro is not signed in and has no KIRO_API_KEY.');
    if (!model()) missing.push('No Kiro model is set.');
    if (!config.qlooKey) missing.push('QLOO_API_KEY is not set.');
    if (broken.size && broken.size === Object.keys(starters).length) missing.push('No starter can be copied on this server.');
    return { open: !missing.length, missing, ...(broken.size ? { starterProblems: [...broken.values()] } : {}) };
  }
  const paused = () => exists(path.join(base, PAUSE_FILE));

  // What the whole server has spent on the try in the last day, whoever asked, against the caps TRY_DAILY_RUNS,
  // TRY_DAILY_PAIRS and TRY_DAILY_CREDITS set (0 is no cap). Credits are what Kiro metered for each session that ended
  // in the day; a host that meters nothing adds 0, so only the counts bound it then.
  const caps = Object.freeze({ runs: config.tryDailyRuns || 0, pairs: config.tryDailyPairs || 0, credits: config.tryDailyCredits || 0 });
  const within = (time, since) => Number.isFinite(Date.parse(time || '')) && Date.parse(time) > since;
  function usage() {
    const since = now() - DAY;
    let dayRuns = 0, dayPairs = 0, dayCredits = 0;
    for (const run of runs.values()) {
      if (within(run.createdAt, since)) dayRuns++;
      if (within(run.pair?.queuedAt, since)) dayPairs++;
      if (within(run.quick?.endedAt, since)) dayCredits += run.quick.session?.credits || 0;
      for (const arm of Object.values(run.pair?.arms || {})) if (within(arm.endedAt, since)) dayCredits += arm.session?.credits || 0;
    }
    return { day: { runs: dayRuns, pairs: dayPairs, credits: Math.round(dayCredits * 100) / 100 }, limits: caps };
  }

  /** A Moûsa server inside this process, for the host's own steps; only the steps that measure get the Qloo key. */
  function hostServer(root, { qloo = false, usage = null } = {}) {
    const env = { MOUSA_PROJECT_DIR: root, MOUSA_HOST: 'kiro', MOUSA_ENVIRONMENT: 'hosted', MOUSA_IMAGES: 'off', MOUSA_CAPTURE: 'off', MOUSA_LIBRARY_ROOT: config.rootDir,
      MOUSA_QLOO_BUDGET: String(budget), ...(usage ? { MOUSA_QLOO_USAGE_FILE: usage } : {}),
      ...(qloo && config.qlooKey ? { QLOO_API_KEY: config.qlooKey, ...(config.qlooBaseUrl ? { QLOO_BASE_URL: config.qlooBaseUrl } : {}) } : {}) };
    return createMousaServer({ env, store: NO_CONNECTIONS, page: NO_PAGE, inspect: HOST_INSPECT, ...(fetchImpl ? { fetchImpl } : {}) });
  }
  async function call(server, name, args) {
    const result = await server.callTool(name, args);
    let value;
    try { value = JSON.parse(result.content?.find(item => item.type === 'text')?.text || '{}'); } catch { value = {}; }
    if (result.isError) throw new StepError(value.error?.message || `${name} could not complete.`);
    return value;
  }

  // A run's two arms save it at once, and Windows refuses a rename onto a file another rename is replacing, so each
  // run's saves go one after another, each writing the run as it is then.
  const saving = new Map();
  function save(run) {
    const next = (saving.get(run.id) || Promise.resolve()).then(() => { run.updatedAt = stamp(); return writeJson(path.join(folderOf(run.id), 'meta.json'), run); });
    const kept = next.catch(() => {});
    saving.set(run.id, kept);
    kept.then(() => { if (saving.get(run.id) === kept) saving.delete(run.id); });
    return next;
  }
  const sessionConfig = () => ({ ...config, model: model(), tryQlooBudget: budget });
  const progress = (id, part) => (call, isNew) => {
    const state = live.get(`${id}:${part}`) || { calls: 0, last: null };
    if (isNew) state.calls++;
    if (call.tool) state.last = call.tool;
    live.set(`${id}:${part}`, state);
  };
  const problemOf = (error, fallback) => {
    if (error instanceof StepError) return error.message;
    log.error?.(`Try: ${String(error?.stack || error).slice(0, 600)}`);
    return fallback;
  };
  async function keepStderr(id, part, session) {
    if (session.stderr) await fs.writeFile(path.join(folderOf(id), 'sessions', `${part}.stderr.log`), `${session.stderr}\n`).catch(() => {});
  }
  const cancelled = signal => { if (signal.aborted) throw new StepError('The try was cancelled.'); };

  /** Step one: the plan, the frozen prediction, the measurement and its report. */
  async function quickStep(run, signal, release = () => {}) {
    const project = projectOf(run.id), starter = starters[run.input.starter], step = run.quick;
    const mark = async (status, extra = {}) => { Object.assign(step, { status }, extra); if (!QUICK_ACTIVE.includes(status)) release(); await save(run); };
    try {
      await mark('planning', { startedAt: stamp() });
      await fs.mkdir(project, { recursive: true });
      const planned = await call(hostServer(project), 'taste_profile', tryPlan(run.input, starters));
      if (planned.status !== 'planned') throw new StepError(planned.status === 'needs-input' ? planned.next : 'The taste questions could not be planned for this request.');
      step.plan = { domains: planned.plan.domains, estimate: planned.plan.requests?.estimate || null };
      const planFile = path.join(project, '.mousa', 'taste', 'plan.json');
      const plan = await fs.readFile(planFile, 'utf8');
      cancelled(signal);
      await mark('predicting');
      const session = await runSession({ config: sessionConfig(), kind: 'predict', home: path.join(folderOf(run.id), 'kiro', 'predict'), project, starter,
        prompt: predictPrompt({ brief: run.brief }), streamFile: path.join(folderOf(run.id), 'sessions', 'predict.jsonl'), signal, onCall: progress(run.id, 'predict'), ...(spawnImpl ? { spawnImpl } : {}) });
      step.session = sessionSummary(session);
      await keepStderr(run.id, 'predict', session);
      cancelled(signal);
      // The plan stays the juror's, and the session leaves nothing but its prediction.
      if (await fs.readFile(planFile, 'utf8').catch(() => '') !== plan) { await fs.writeFile(planFile, plan); step.planRestored = true; }
      for (const name of AFTER_PREDICTION) await fs.rm(path.join(project, '.mousa', 'taste', `${name}.json`), { force: true });
      const prediction = await readJson(path.join(project, '.mousa', 'taste', 'prediction.json'));
      if (!prediction) throw new StepError(sessionProblem(session) || 'The model ended its session without freezing a prediction.');
      if ((prediction.domains || []).join() !== step.plan.domains.join()) throw new StepError('The model froze a prediction for other domains than the plan asked for.');
      step.prediction = { frozenAt: prediction.frozenAt || null, entries: prediction.entries?.length ?? 0, ...(prediction.sha256 ? { sha256: prediction.sha256 } : {}) };
      await mark('measuring');
      const measurer = hostServer(project, { qloo: true, usage: usageOf(run.id) });
      const brief = await call(measurer, 'taste_profile', {});
      step.measured = { status: brief.status || 'unknown', qlooRequests: await readQlooUsage(usageOf(run.id)),
        ...(Array.isArray(brief.cautions) && brief.cautions.length ? { cautions: brief.cautions.slice(0, 4).map(item => String(item).slice(0, 400)) } : {}) };
      cancelled(signal);
      if (await exists(path.join(project, '.mousa', 'taste', 'input.json'))) {
        const written = await call(measurer, 'design_report', { picture: false });
        step.report = { page: written.report, headline: written.headline || null };
      }
      await mark('done', { endedAt: stamp() });
    } catch (error) {
      await mark(signal.aborted ? 'cancelled' : 'failed', { endedAt: stamp(), problem: signal.aborted ? 'The try was cancelled.' : problemOf(error, 'Step one could not complete on this server.') })
        .catch(saved => log.error?.(`Try: ${String(saved?.message || saved).slice(0, 300)}`));
    } finally { live.delete(`${run.id}:predict`); }
  }

  /** Step two: the two arms from one frozen prediction, their sessions side by side, and the comparison report. */
  async function pairStep(run, signal, release = () => {}) {
    const project = projectOf(run.id), starter = starters[run.input.starter], step = run.pair;
    const timeout = AbortSignal.timeout(limits.pairMs), sibling = new AbortController();
    // One arm that cannot go on stops the other, so no session runs on for a pair that cannot finish.
    const both = AbortSignal.any([signal, timeout, sibling.signal]);
    const mark = async (status, extra = {}) => { Object.assign(step, { status }, extra); if (!PAIR_ACTIVE.includes(status)) release(); await save(run); };
    try {
      await mark('preparing', { startedAt: stamp() });
      const source = starter.source ? path.resolve(config.rootDir, starter.source) : null;
      const files = source ? await folderFiles(source, limits) : [];
      const original = new Map();
      for (const file of files) original.set(file, await hashFile(path.join(source, ...file.split('/'))));
      const prediction = await readJson(path.join(project, '.mousa', 'taste', 'prediction.json'));
      if (!prediction) throw new StepError('Step one froze no prediction, so there is no pair to build.');
      for (const arm of TRY_ARMS) {
        const folder = armFolder(run.id, arm);
        await fs.rm(folder, { recursive: true, force: true });
        await fs.mkdir(folder, { recursive: true });
        for (const file of files) {
          const target = path.join(folder, ...file.split('/'));
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(path.join(source, ...file.split('/')), target);
        }
        // The same plan and frozen prediction in both arms; the arm with Qloo also gets step one's cached answers, so
        // the measurement is read again for free. Its requests count in step one's file, so a try keeps one budget.
        for (const name of ['taste/plan.json', 'taste/prediction.json']) {
          await fs.mkdir(path.join(folder, '.mousa', 'taste'), { recursive: true });
          await fs.copyFile(path.join(project, '.mousa', ...name.split('/')), path.join(folder, '.mousa', ...name.split('/')));
        }
        if (arm.kind === 'qloo') await fs.cp(path.join(project, '.mousa', 'cache'), path.join(folder, '.mousa', 'cache'), { recursive: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await writeJson(path.join(folder, '.mousa', 'design', 'start.json'), { savedAt: prediction.frozenAt || stamp(), ...styleFootprint(await collectProjectFiles(folder)) });
        await writeJson(path.join(folder, '.mousa', 'session.json'), { plugin: 'mousa', stage: 'predicted', updatedAt: stamp() });
      }
      // Each arm is locked to its source of taste before its session starts.
      const measured = await call(hostServer(armFolder(run.id, TRY_ARMS[0]), { qloo: true, usage: usageOf(run.id) }), 'taste_profile', {});
      if (measured.status !== 'ok') throw new StepError('The measurement could not be read again for the arm with Qloo.');
      await call(hostServer(armFolder(run.id, TRY_ARMS[1])), 'taste_profile', { baseline: true });
      step.arms = Object.fromEntries(TRY_ARMS.map(arm => [arm.id, { status: 'queued' }]));
      cancelled(signal);
      await mark('designing');
      // What lies beside each arm, which its file tools may not open: step one's records, the other arm and the run's own.
      const outside = arm => [{ folder: path.join(project, '.mousa') }, ...TRY_ARMS.filter(other => other !== arm).map(other => ({ folder: armFolder(run.id, other) })),
        { file: path.join(folderOf(run.id), 'meta.json') }, { folder: path.join(folderOf(run.id), 'kiro') }, { folder: path.join(folderOf(run.id), 'sessions') }];
      const runArm = async arm => {
        if (both.aborted) return;
        const folder = armFolder(run.id, arm);
        step.arms[arm.id] = { status: 'designing', startedAt: stamp() };
        try {
          await save(run);
          const session = await runSession({ config: sessionConfig(), kind: arm.kind, home: path.join(folderOf(run.id), 'kiro', arm.id), project: folder, starter,
            prompt: armPrompt({ brief: run.brief, arm: arm.kind }), streamFile: path.join(folderOf(run.id), 'sessions', `${arm.id}.jsonl`), signal: both,
            limitMs: SESSION_LIMITS.armMs, outside: outside(arm), ...(arm.kind === 'qloo' ? { usageFile: usageOf(run.id) } : {}), onCall: progress(run.id, arm.id), ...(spawnImpl ? { spawnImpl } : {}) });
          await keepStderr(run.id, arm.id, session);
          const guard = await guardArm({ folder, source, starter, original });
          const problem = timeout.aborted && !signal.aborted ? `The pair reached its ${Math.round(limits.pairMs / 60000)}-minute limit.` : sessionProblem(session);
          step.arms[arm.id] = { ...step.arms[arm.id], status: problem ? 'failed' : 'done', endedAt: stamp(), session: sessionSummary(session), ...(problem ? { problem } : {}),
            ...(guard.restored.length || guard.removed.length ? { guard } : {}) };
        } catch (error) {
          sibling.abort();
          step.arms[arm.id] = { ...step.arms[arm.id], status: 'failed', endedAt: stamp(), problem: problemOf(error, 'This arm could not complete on this server.') };
          throw error;
        } finally {
          live.delete(`${run.id}:${arm.id}`);
          await save(run).catch(() => {});
        }
      };
      let results;
      if (config.tryArmsParallel === false) {
        results = [];
        for (const arm of TRY_ARMS) results.push(await runArm(arm).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })));
      } else results = await Promise.allSettled(TRY_ARMS.map(runArm));
      const thrown = results.find(result => result.status === 'rejected');
      if (thrown) throw thrown.reason;
      cancelled(signal);
      await mark('reporting');
      const written = await call(hostServer(project), 'design_report', { a: TRY_ARMS[0].folder, b: TRY_ARMS[1].folder, picture: false });
      const record = await readJson(path.join(project, '.mousa', 'compare-report', 'record.json'));
      step.report = { page: written.report, headline: written.headline || null, arms: written.arms || [], distance: record?.distance?.overall ?? null, samePrediction: record?.samePrediction ?? null };
      step.qlooRequests = await readQlooUsage(usageOf(run.id));
      // The pair's cost, as Kiro metered its two sessions; left out when the host metered nothing.
      const metered = TRY_ARMS.map(arm => step.arms[arm.id]?.session?.credits).filter(Number.isFinite);
      if (metered.length) step.credits = Math.round(metered.reduce((sum, value) => sum + value, 0) * 100) / 100;
      const failed = TRY_ARMS.filter(arm => step.arms[arm.id]?.status === 'failed');
      await mark(failed.length ? 'partial' : 'done', { endedAt: stamp(), ...(failed.length ? { problem: `${failed.map(arm => arm.label).join(' and ')} ended early: ${failed.map(arm => step.arms[arm.id].problem).join(' ')}` } : {}) });
    } catch (error) {
      const problem = signal.aborted ? 'The try was cancelled.' : timeout.aborted ? `The pair reached its ${Math.round(limits.pairMs / 60000)}-minute limit.` : problemOf(error, 'Step two could not complete on this server.');
      await mark(signal.aborted ? 'cancelled' : 'failed', { endedAt: stamp(), problem }).catch(saved => log.error?.(`Try: ${String(saved?.message || saved).slice(0, 300)}`));
    } finally { for (const arm of TRY_ARMS) live.delete(`${run.id}:${arm.id}`); }
  }

  function pump() {
    if (closed) return;
    for (const [name, lane] of Object.entries(lanes)) {
      while (lane.running.size < lane.slots && lane.waiting.length) {
        const run = runs.get(lane.waiting.shift());
        if (!run) continue;
        const controller = new AbortController(), key = `${run.id}:${name}`;
        lane.running.add(run.id); controllers.set(key, controller);
        // A step gives up its slot and its address's place in the moment its status says it ended, before that status
        // is saved, so no page, request or waiting step sees an ended step still hold them. close() still waits for the save.
        let held = true;
        const release = () => {
          if (!held) return;
          held = false;
          lane.running.delete(run.id); controllers.delete(key); askers.delete(key);
          pump();
        };
        const task = (name === 'quick' ? quickStep(run, controller.signal, release) : pairStep(run, controller.signal, release))
          .catch(error => log.error?.(`Try: ${String(error?.message || error).slice(0, 300)}`))
          .finally(() => { release(); tasks.delete(task); });
        tasks.add(task);
      }
    }
  }

  /** Whether a step for this lane can be taken from this address now: the server, the disk, the hour, the queue and the address's own steps. */
  async function admissible(address, lane) {
    if (closed) throw new TryError(503, 'The server is stopping.');
    if (!readiness().open) throw new TryError(503, 'The live try is not open on this server.');
    if (await paused()) throw new TryError(503, 'The live try is paused for a moment. The recorded sessions stay open meanwhile.');
    // The server's own day: however many jurors ask, the plan behind the try is spent at most this far in a day.
    const spent = usage().day;
    if (caps.credits && spent.credits >= caps.credits) throw new TryError(503, 'The try has spent its budget for today on this server. The recorded sessions stay open; please try again tomorrow.');
    if (lane === 'quick' && caps.runs && spent.runs >= caps.runs) throw new TryError(503, 'The try has started as many first steps today as this server allows. The recorded sessions stay open; please try again tomorrow.');
    if (lane === 'pair' && caps.pairs && spent.pairs >= caps.pairs) throw new TryError(503, 'The try has built as many pairs today as this server allows. The recorded sessions stay open; please try again tomorrow.');
    const free = await fs.statfs(base).then(stats => stats.bavail * stats.bsize, () => null);
    if (free !== null && free < limits.minFreeBytes) throw new TryError(507, 'The server is short of disk space for a new try. The recorded sessions stay open.');
    const at = now(), times = (recent.get(address) || []).filter(time => at - time < HOUR);
    if (times.length >= limits.perHour) throw new TryError(429, `This address started ${limits.perHour} tries in the last hour. The next one can start in ${Math.max(1, Math.ceil((HOUR - (at - times[0])) / 60000))} minutes.`);
    const waiting = lanes[lane].waiting.length, room = lane === 'quick' ? limits.quickWaiting : limits.pairWaiting;
    if (waiting >= room) throw new TryError(503, `The try is busy: ${waiting} ${lane === 'quick' ? 'first steps' : 'pairs'} wait for a slot. Please try again in a few minutes.`);
    // A step counts while it waits or works: one whose page already shows it finished does not hold its address's place.
    const active = lane === 'quick' ? QUICK_ACTIVE : PAIR_ACTIVE;
    const mine = [...askers].filter(([key, who]) => who === address && key.endsWith(`:${lane}`) && active.includes(runs.get(key.split(':')[0])?.[lane]?.status)).length;
    const most = lane === 'quick' ? limits.quickPerAddress : limits.pairPerAddress;
    if (mine >= most) throw new TryError(429, lane === 'quick' ? 'This address has first steps waiting or working already. Let one finish first.' : 'This address has a pair waiting or working already. Let it finish first.');
    // Only a run that is taken counts toward the hour; an address whose last run is over an hour old is forgotten.
    times.push(at);
    recent.set(address, times);
    if (recent.size > 2000) for (const [key, list] of recent) if (at - list.at(-1) >= HOUR) recent.delete(key);
  }
  function get(id) {
    const run = RUN_ID.test(id || '') ? runs.get(id) : null;
    if (!run) throw new TryError(404, 'There is no such try.');
    return run;
  }
  /** A regular file at `parts` under `root` whose real path stays inside it, or null. */
  async function contained(root, parts) {
    const [real, inside] = await Promise.all([fs.realpath(root).catch(() => null), fs.realpath(path.join(root, ...parts)).catch(() => null)]);
    if (!real || !inside || !inside.startsWith(`${real}${path.sep}`)) return null;
    return (await fs.stat(inside).catch(() => null))?.isFile() ? inside : null;
  }

  return {
    get,
    readiness, paused, usage,
    /** How many steps work and wait in each lane, and how many runs are kept. */
    queues: () => ({ runs: runs.size, quick: { working: lanes.quick.running.size, waiting: lanes.quick.waiting.length }, pair: { working: lanes.pair.running.size, waiting: lanes.pair.waiting.length } }),
    starters: () => Object.values(starters).filter(starter => !broken.has(starter.id)).map(({ id, title, medium, summary }) => ({ id, title, medium, summary })),

    /**
     * Read the runs kept in DATA_DIR/try: a step a restart interrupted is marked as such, an agent file a stopped
     * session left is removed, and a run whose record cannot be read is left out with a note. Each starter is checked.
     */
    async initialize() {
      await fs.mkdir(base, { recursive: true });
      for (const starter of Object.values(starters)) {
        const problem = await starterProblem(starter, config.rootDir).catch(error => `${starter.id}: ${String(error?.message || error).slice(0, 160)}`);
        if (problem) { broken.set(starter.id, problem); log.warn?.(`Try: ${problem}`); }
      }
      for (const name of await fs.readdir(base)) {
        if (!RUN_ID.test(name)) continue;
        try {
          for (const home of await fs.readdir(path.join(base, name, 'kiro')).catch(() => [])) await fs.rm(path.join(base, name, 'kiro', home, 'agents', `${TRY_AGENT}.json`), { force: true });
          const run = await readJson(path.join(base, name, 'meta.json'));
          if (!run || run.id !== name) { log.warn?.(`Try: ${name} has no readable record and is left out.`); continue; }
          let changed = false;
          for (const [step, active] of [['quick', QUICK_ACTIVE], ['pair', PAIR_ACTIVE]]) {
            if (run[step] && active.includes(run[step].status)) { Object.assign(run[step], { status: 'failed', endedAt: run.updatedAt, problem: 'The server restarted during this step. Start it again.' }); changed = true; }
          }
          // A finished try older than the retention keeps its record, reports and designs; its Kiro homes and session
          // streams, which only the operator reads, go, so the volume holds what the site serves. A try this start found
          // interrupted keeps them for now: its streams say what the restart cut short.
          const retentionMs = (config.tryPrivateRetentionDays || 0) * DAY;
          const ended = [run.quick?.endedAt, ...Object.values(run.pair?.arms || {}).map(arm => arm.endedAt), run.pair?.endedAt].filter(Boolean).map(Date.parse).filter(Number.isFinite);
          if (retentionMs && !changed && !run.privateRemovedAt && ended.length && now() - Math.max(...ended) > retentionMs) {
            for (const folder of ['kiro', 'sessions']) await fs.rm(path.join(base, name, folder), { recursive: true, force: true });
            run.privateRemovedAt = stamp();
            changed = true;
          }
          runs.set(run.id, run);
          if (changed) await save(run);
        } catch (error) { log.warn?.(`Try: ${name} could not be read: ${String(error?.message || error).slice(0, 160)}`); }
      }
    },

    /** Start step one for a juror's request. */
    async create(body, { address = 'unknown' } = {}) {
      const input = checkTryInput(body, starters);
      if (broken.has(input.starter)) throw new TryError(503, 'This starter cannot be copied on this server; choose another.');
      if (runs.size >= limits.runs) throw new TryError(507, 'The try has reached the number of runs this server keeps.');
      await admissible(address, 'quick');
      const id = crypto.randomBytes(16).toString('hex');
      const starter = starters[input.starter];
      const run = { schemaVersion: TRY_SCHEMA_VERSION, id, createdAt: stamp(), updatedAt: stamp(), input, title: starter.title, medium: starter.medium, brief: tryBrief(input, starters), promptsVersion: TRY_PROMPTS_VERSION,
        host: 'kiro', hostVersion: /(\d+\.\d+\.\d+)/u.exec(status().version || '')?.[1] || null, model: model(), effort: config.effort || 'medium', qlooBudget: budget,
        surfaceVersion: MOUSA_SERVER_VERSION, ...(config.commit ? { commit: config.commit } : {}),
        previewToken: crypto.randomBytes(24).toString('hex'), quick: { status: 'queued', queuedAt: stamp() }, pair: null, consent: null };
      try {
        await fs.mkdir(path.join(folderOf(id), 'project'), { recursive: true });
        runs.set(id, run);
        await save(run);
      } catch (error) {
        runs.delete(id);
        await fs.rm(folderOf(id), { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      askers.set(`${id}:quick`, address);
      lanes.quick.waiting.push(id);
      pump();
      return run;
    },

    /** Start step two for a run whose measurement is ready; a finished pair is not built again. */
    async design(id, { address = 'unknown' } = {}) {
      const run = get(id);
      if (run.quick?.status !== 'done' || run.quick.measured?.status !== 'ok') throw new TryError(409, 'The pair is built from a finished measurement; this try has none.');
      // A finished pair is never built again. Its lane lets it go the moment it ends, so this is what stops a second one.
      if (run.pair && ['done', 'partial'].includes(run.pair.status)) throw new TryError(409, 'This pair is finished. Start a new try to build another.');
      // One request at a time decides, so two quick posts cannot both queue the pair.
      if (reserving.has(id) || lanes.pair.waiting.includes(id) || lanes.pair.running.has(id) || (run.pair && PAIR_ACTIVE.includes(run.pair.status))) return run;
      reserving.add(id);
      const before = { pair: run.pair, consent: run.consent };
      try {
        await admissible(address, 'pair');
        run.pair = { status: 'queued', queuedAt: stamp() };
        run.consent = null;
        await save(run);
        askers.set(`${id}:pair`, address);
        lanes.pair.waiting.push(id);
        pump();
        return run;
      } catch (error) {
        Object.assign(run, before);
        throw error;
      } finally { reserving.delete(id); }
    },

    /** Stop a run's waiting or working step. */
    async cancel(id) {
      const run = get(id);
      for (const [name, step, active] of [['quick', run.quick, QUICK_ACTIVE], ['pair', run.pair, PAIR_ACTIVE]]) {
        if (!step || !active.includes(step.status)) continue;
        const waiting = lanes[name].waiting.indexOf(id);
        if (waiting >= 0) {
          lanes[name].waiting.splice(waiting, 1);
          askers.delete(`${id}:${name}`);
          Object.assign(step, { status: 'cancelled', endedAt: stamp(), problem: 'The try was cancelled.' });
          await save(run);
        }
        controllers.get(`${id}:${name}`)?.abort();
      }
      return run;
    },

    /**
     * The consent to publish a finished try in the gallery, or its withdrawal: the juror's on the site, or the
     * operator's for a try run with scripts/run-try.mjs (`by: 'operator'`), so the gallery says who ran it.
     */
    async publish(id, consent, { by = 'juror' } = {}) {
      const run = get(id);
      // A gallery entry has designs to play, so only a finished pair is published.
      if (!run.pair || !['done', 'partial'].includes(run.pair.status) || !run.pair.report) throw new TryError(409, 'Only a try whose pair is finished can be published.');
      run.consent = consent ? { publish: true, at: stamp(), by: by === 'operator' ? 'operator' : 'juror' } : null;
      await save(run);
      return run;
    },

    /** Where a run stands, for its page: queue places, the live call counts and each arm's stage, captures and reviews. */
    async view(run) {
      const place = name => { const index = lanes[name].waiting.indexOf(run.id); return index >= 0 ? index + 1 : null; };
      const arms = run.pair ? await Promise.all(TRY_ARMS.map(async arm => {
        const folder = armFolder(run.id, arm);
        const captures = ((await readJson(path.join(folder, '.mousa', 'captures.json')))?.captures || []).filter(item => /^[A-Za-z0-9_-]{1,120}$/u.test(item?.id || ''));
        const reviews = (await readJson(path.join(folder, '.mousa', 'design', 'reviews.json')))?.reviews || [];
        return { ...arm, ...(run.pair.arms?.[arm.id] || {}), stage: (await readJson(path.join(folder, '.mousa', 'session.json')))?.stage || null,
          captures: captures.length, latest: captures.at(-1)?.id || null, reviews: Array.isArray(reviews) ? reviews.length : 0, live: live.get(`${run.id}:${arm.id}`) || null };
      })) : [];
      return { quickPlace: place('quick'), pairPlace: place('pair'), predict: live.get(`${run.id}:predict`) || null, arms };
    },

    /** A run without what stays private: its preview token. */
    publicRun(run) {
      const { previewToken: _token, ...rest } = run;
      void _token;
      return structuredClone(rest);
    },

    /** The report file a try page names, inside the run's own report folders only, or null. */
    async reportFile(id, relative) {
      const run = runs.get(id);
      if (!run || typeof relative !== 'string') return null;
      const parts = relative.split('/');
      if (parts.some(part => !part || part === '..' || /[\\:\0]/u.test(part))) return null;
      const folders = [['.mousa', 'report'], ['.mousa', 'compare-report'], ...TRY_ARMS.map(arm => [...arm.folder.split('/'), '.mousa', 'report'])];
      const inside = folders.find(prefix => prefix.every((part, index) => parts[index] === part) && parts.length > prefix.length);
      if (!inside || parts.slice(inside.length).some(part => part.startsWith('.'))) return null;
      return contained(path.join(projectOf(id), ...inside), parts.slice(inside.length));
    },

    /** The latest capture of an arm while it designs, or null. */
    async latestCapture(id, armId) {
      const arm = TRY_ARMS.find(item => item.id === armId);
      if (!arm || !runs.get(id)?.pair) return null;
      const captures = (await readJson(path.join(armFolder(id, arm), '.mousa', 'captures.json')))?.captures || [];
      const latest = (Array.isArray(captures) ? captures : []).filter(item => /^[A-Za-z0-9_-]{1,120}$/u.test(item?.id || '')).at(-1);
      return latest ? contained(path.join(armFolder(id, arm), '.mousa', 'captures'), [`${latest.id}.png`]) : null;
    },

    /** A design file of an arm for the preview origin, with its token: never a hidden file or a parent step. */
    async armFile(id, token, armId, relative) {
      const run = runs.get(id), arm = TRY_ARMS.find(item => item.id === armId);
      if (!run || !arm || !run.pair || typeof token !== 'string' || token.length !== run.previewToken.length) return null;
      if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(run.previewToken))) return null;
      const parts = String(relative || '').split('/');
      if (!parts.length || parts.some(part => !part || part.startsWith('.') || /[\\:\0]/u.test(part))) return null;
      const file = await contained(armFolder(id, arm), parts);
      return file ? { file, medium: starters[run.input.starter]?.medium || run.medium || null } : null;
    },

    folder: id => folderOf(id),

    async close() {
      closed = true;
      for (const lane of Object.values(lanes)) lane.waiting.length = 0;
      for (const controller of controllers.values()) controller.abort();
      await Promise.allSettled([...tasks]);
    },
  };
}
