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
import { runTrySession, sessionProblem, SESSION_LIMITS } from './kiro.mjs';

export const TRY_DIR = 'try';
export const TRY_SCHEMA_VERSION = '1.0';
export const TRY_LIMITS = Object.freeze({ quickSlots: 2, pairSlots: 1, perHour: 10, pairMs: 35 * 60 * 1000, runs: 400, starterBytes: 16 * 1024 * 1024, starterFiles: 400 });
export const TRY_ARMS = Object.freeze([
  Object.freeze({ id: 'with-qloo', folder: 'compare/with-qloo', kind: 'qloo', label: 'With Qloo' }),
  Object.freeze({ id: 'without-qloo', folder: 'compare/without-qloo', kind: 'baseline', label: 'Without Qloo' }),
]);
export const RUN_ID = /^[a-f0-9]{32}$/u;
export const QUICK_ACTIVE = Object.freeze(['queued', 'planning', 'predicting', 'measuring']);
export const PAIR_ACTIVE = Object.freeze(['queued', 'preparing', 'designing', 'reporting']);
const PAUSE_FILE = 'PAUSED';
const HOUR = 60 * 60 * 1000;
// The records a prediction session may leave: its prediction, the design start it notes, and its stage.
const AFTER_PREDICTION = Object.freeze(['input', 'brief', 'profile', 'evidence', 'decisions']);
const NO_CONNECTIONS = Object.freeze({ read: async () => null });
const NO_PAGE = Object.freeze({ open: async () => { throw new Error('The try opens no connection page.'); } });
const HOST_INSPECT = Object.freeze({ browser: async () => ({ available: false, reason: 'The host writes its reports without pictures.' }), codex: async () => ({ available: false, reason: 'A hosted server has no image generator.' }) });

export class TryError extends Error { constructor(status, message) { super(message); this.name = 'TryError'; this.status = status; } }
/** A step that cannot go on, in words the try page shows. */
class StepError extends Error {}

const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse, () => null);
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
  return new RegExp(`^${source}$`, 'u').test(file);
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
  calls: session.calls.map(call => ({ at: call.at, tool: call.tool, status: call.status, ...(call.code ? { code: call.code } : {}) })) });

/**
 * The try's manager. `kiro` is the Studio's Kiro inspection (or a function that gives it); `requireAccess: false`
 * lets a run start without TRY_ACCESS_CODE, as scripts/run-try.mjs does on the operator's own machine. `starters`,
 * `limits`, `runSession`, `spawnImpl`, `fetchImpl` and `now` replace the real ones in tests.
 */
export function createTryManager({ config, kiro = {}, requireAccess = true, starters = STARTERS, limits = TRY_LIMITS, runSession = runTrySession, spawnImpl, fetchImpl, now = Date.now, log = console }) {
  const base = path.join(config.dataDir, TRY_DIR);
  const runs = new Map(), controllers = new Map(), live = new Map(), tasks = new Set(), recent = new Map();
  const lanes = { quick: { slots: limits.quickSlots, running: new Set(), waiting: [] }, pair: { slots: limits.pairSlots, running: new Set(), waiting: [] } };
  const budget = config.tryQlooBudget || 24;
  // The Studio may inspect Kiro again while it runs, so its status is read when it is needed.
  const status = () => (typeof kiro === 'function' ? kiro() : kiro) || {};
  const model = () => config.model || status().defaultModel || '';
  const stamp = () => new Date(now()).toISOString();
  const folderOf = id => path.join(base, id);
  const projectOf = id => path.join(folderOf(id), 'project');
  const armFolder = (id, arm) => path.join(projectOf(id), ...arm.folder.split('/'));
  let closed = false;

  /** Why the try cannot take a run here, if it cannot: what the server lacks, never a secret. */
  function readiness() {
    const missing = [];
    if (requireAccess && !config.tryAccessCode) missing.push('TRY_ACCESS_CODE is not set.');
    if (!status().available) missing.push('Kiro CLI is not available.');
    else if (!status().authenticated) missing.push('Kiro is not signed in and has no KIRO_API_KEY.');
    if (!model()) missing.push('No Kiro model is set.');
    if (!config.qlooKey) missing.push('QLOO_API_KEY is not set.');
    return { open: !missing.length, missing };
  }
  const paused = () => exists(path.join(base, PAUSE_FILE));

  /** A Moûsa server inside this process, for the host's own steps; only the steps that measure get the Qloo key. */
  function hostServer(root, { qloo = false } = {}) {
    const env = { MOUSA_PROJECT_DIR: root, MOUSA_HOST: 'kiro', MOUSA_ENVIRONMENT: 'hosted', MOUSA_IMAGES: 'off', MOUSA_CAPTURE: 'off', MOUSA_LIBRARY_ROOT: config.rootDir,
      MOUSA_QLOO_BUDGET: String(budget), ...(qloo && config.qlooKey ? { QLOO_API_KEY: config.qlooKey, ...(config.qlooBaseUrl ? { QLOO_BASE_URL: config.qlooBaseUrl } : {}) } : {}) };
    return createMousaServer({ env, store: NO_CONNECTIONS, page: NO_PAGE, inspect: HOST_INSPECT, ...(fetchImpl ? { fetchImpl } : {}) });
  }
  async function call(server, name, args) {
    const result = await server.callTool(name, args);
    const value = JSON.parse(result.content?.find(item => item.type === 'text')?.text || '{}');
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

  /** Step one: the plan, the frozen prediction, the measurement and its report. */
  async function quickStep(run, signal) {
    const project = projectOf(run.id), starter = starters[run.input.starter], step = run.quick;
    const mark = async (status, extra = {}) => { Object.assign(step, { status }, extra); await save(run); };
    try {
      await mark('planning', { startedAt: stamp() });
      await fs.mkdir(project, { recursive: true });
      const planned = await call(hostServer(project), 'taste_profile', tryPlan(run.input, starters));
      if (planned.status !== 'planned') throw new StepError(planned.status === 'needs-input' ? planned.next : 'The taste questions could not be planned for this request.');
      step.plan = { domains: planned.plan.domains, estimate: planned.plan.requests?.estimate || null };
      const planFile = path.join(project, '.mousa', 'taste', 'plan.json');
      const plan = await fs.readFile(planFile, 'utf8');
      if (signal.aborted) throw new StepError('The try was cancelled.');
      await mark('predicting');
      const session = await runSession({ config: sessionConfig(), kind: 'predict', home: path.join(folderOf(run.id), 'kiro', 'predict'), project, starter,
        prompt: predictPrompt({ brief: run.brief }), streamFile: path.join(folderOf(run.id), 'sessions', 'predict.jsonl'), signal, onCall: progress(run.id, 'predict'), ...(spawnImpl ? { spawnImpl } : {}) });
      step.session = sessionSummary(session);
      await keepStderr(run.id, 'predict', session);
      if (signal.aborted) throw new StepError('The try was cancelled.');
      // The plan stays the juror's, and the session leaves nothing but its prediction.
      if (await fs.readFile(planFile, 'utf8').catch(() => '') !== plan) { await fs.writeFile(planFile, plan); step.planRestored = true; }
      for (const name of AFTER_PREDICTION) await fs.rm(path.join(project, '.mousa', 'taste', `${name}.json`), { force: true });
      const prediction = await readJson(path.join(project, '.mousa', 'taste', 'prediction.json'));
      if (!prediction) throw new StepError(sessionProblem(session) || 'The model ended its session without freezing a prediction.');
      if ((prediction.domains || []).join() !== step.plan.domains.join()) throw new StepError('The model froze a prediction for other domains than the plan asked for.');
      step.prediction = { frozenAt: prediction.frozenAt || null, entries: prediction.entries?.length ?? 0 };
      await mark('measuring');
      const measurer = hostServer(project, { qloo: true });
      const brief = await call(measurer, 'taste_profile', {});
      step.measured = { status: brief.status || 'unknown', qlooRequests: await readQlooUsage(path.join(project, '.mousa', 'usage.json')),
        ...(Array.isArray(brief.cautions) && brief.cautions.length ? { cautions: brief.cautions.slice(0, 4).map(item => String(item).slice(0, 400)) } : {}) };
      if (await exists(path.join(project, '.mousa', 'taste', 'input.json'))) {
        const written = await call(measurer, 'design_report', { picture: false });
        step.report = { page: written.report, headline: written.headline || null };
      }
      await mark('done', { endedAt: stamp() });
    } catch (error) {
      await mark(signal.aborted ? 'cancelled' : 'failed', { endedAt: stamp(), problem: signal.aborted ? 'The try was cancelled.' : problemOf(error, 'Step one could not complete on this server.') });
    } finally { live.delete(`${run.id}:predict`); }
  }

  /** Step two: the two arms from one frozen prediction, their sessions side by side, and the comparison report. */
  async function pairStep(run, signal) {
    const project = projectOf(run.id), starter = starters[run.input.starter], step = run.pair;
    const timeout = AbortSignal.timeout(limits.pairMs);
    const both = AbortSignal.any([signal, timeout]);
    const mark = async (status, extra = {}) => { Object.assign(step, { status }, extra); await save(run); };
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
        // The same plan and frozen prediction in both arms; the arm with Qloo also gets step one's cached answers and
        // its request count, so a try's requests stay within one budget and the measurement is read again for free.
        const copied = ['taste/plan.json', 'taste/prediction.json', ...(arm.kind === 'qloo' ? ['usage.json'] : [])];
        for (const name of copied) {
          const from = path.join(project, '.mousa', ...name.split('/'));
          if (await exists(from)) { await fs.mkdir(path.dirname(path.join(folder, '.mousa', ...name.split('/'))), { recursive: true }); await fs.copyFile(from, path.join(folder, '.mousa', ...name.split('/'))); }
        }
        if (arm.kind === 'qloo') await fs.cp(path.join(project, '.mousa', 'cache'), path.join(folder, '.mousa', 'cache'), { recursive: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await writeJson(path.join(folder, '.mousa', 'design', 'start.json'), { savedAt: prediction.frozenAt || stamp(), ...styleFootprint(await collectProjectFiles(folder)) });
        await writeJson(path.join(folder, '.mousa', 'session.json'), { plugin: 'mousa', stage: 'predicted', updatedAt: stamp() });
      }
      // Each arm is locked to its source of taste before its session starts.
      const measured = await call(hostServer(armFolder(run.id, TRY_ARMS[0]), { qloo: true }), 'taste_profile', {});
      if (measured.status !== 'ok') throw new StepError('The measurement could not be read again for the arm with Qloo.');
      await call(hostServer(armFolder(run.id, TRY_ARMS[1])), 'taste_profile', { baseline: true });
      step.arms = Object.fromEntries(TRY_ARMS.map(arm => [arm.id, { status: 'queued' }]));
      await mark('designing');
      const runArm = async arm => {
        if (both.aborted) return;
        const folder = armFolder(run.id, arm);
        step.arms[arm.id] = { status: 'designing', startedAt: stamp() };
        await save(run);
        const session = await runSession({ config: sessionConfig(), kind: arm.kind, home: path.join(folderOf(run.id), 'kiro', arm.id), project: folder, starter,
          prompt: armPrompt({ brief: run.brief, arm: arm.kind }), streamFile: path.join(folderOf(run.id), 'sessions', `${arm.id}.jsonl`), signal: both,
          limitMs: SESSION_LIMITS.armMs, onCall: progress(run.id, arm.id), ...(spawnImpl ? { spawnImpl } : {}) });
        await keepStderr(run.id, arm.id, session);
        const guard = await guardArm({ folder, source, starter, original });
        const problem = timeout.aborted && !signal.aborted ? `The pair reached its ${Math.round(limits.pairMs / 60000)}-minute limit.` : sessionProblem(session);
        step.arms[arm.id] = { ...step.arms[arm.id], status: problem ? 'failed' : 'done', endedAt: stamp(), session: sessionSummary(session), ...(problem ? { problem } : {}),
          ...(guard.restored.length || guard.removed.length ? { guard } : {}) };
        live.delete(`${run.id}:${arm.id}`);
        await save(run);
      };
      if (config.tryArmsParallel === false) for (const arm of TRY_ARMS) await runArm(arm);
      else await Promise.all(TRY_ARMS.map(runArm));
      if (signal.aborted) throw new StepError('The try was cancelled.');
      await mark('reporting');
      const written = await call(hostServer(project), 'design_report', { a: TRY_ARMS[0].folder, b: TRY_ARMS[1].folder, picture: false });
      const record = await readJson(path.join(project, '.mousa', 'compare-report', 'record.json'));
      step.report = { page: written.report, headline: written.headline || null, arms: written.arms || [], distance: record?.distance?.overall ?? null, samePrediction: record?.samePrediction ?? null };
      step.qlooRequests = await readQlooUsage(path.join(armFolder(run.id, TRY_ARMS[0]), '.mousa', 'usage.json'));
      const failed = TRY_ARMS.filter(arm => step.arms[arm.id]?.status === 'failed');
      await mark(failed.length ? 'partial' : 'done', { endedAt: stamp(), ...(failed.length ? { problem: `${failed.map(arm => arm.label).join(' and ')} ended early: ${failed.map(arm => step.arms[arm.id].problem).join(' ')}` } : {}) });
    } catch (error) {
      const problem = signal.aborted ? 'The try was cancelled.' : timeout.aborted ? `The pair reached its ${Math.round(limits.pairMs / 60000)}-minute limit.` : problemOf(error, 'Step two could not complete on this server.');
      await mark(signal.aborted ? 'cancelled' : 'failed', { endedAt: stamp(), problem });
    } finally { for (const arm of TRY_ARMS) live.delete(`${run.id}:${arm.id}`); }
  }

  function pump() {
    if (closed) return;
    for (const [name, lane] of Object.entries(lanes)) {
      while (lane.running.size < lane.slots && lane.waiting.length) {
        const run = runs.get(lane.waiting.shift());
        if (!run) continue;
        const controller = new AbortController();
        lane.running.add(run.id); controllers.set(`${run.id}:${name}`, controller);
        const task = (name === 'quick' ? quickStep(run, controller.signal) : pairStep(run, controller.signal))
          .catch(error => log.error?.(`Try: ${String(error?.message || error).slice(0, 300)}`))
          .finally(() => { lane.running.delete(run.id); controllers.delete(`${run.id}:${name}`); tasks.delete(task); pump(); });
        tasks.add(task);
      }
    }
  }

  /** One more run for this address in the hour, or the wait until the next. */
  function admit(address) {
    const at = now(), times = (recent.get(address) || []).filter(time => at - time < HOUR);
    if (times.length >= limits.perHour) throw new TryError(429, `This address started ${limits.perHour} tries in the last hour. The next one can start in ${Math.max(1, Math.ceil((HOUR - (at - times[0])) / 60000))} minutes.`);
    times.push(at);
    recent.set(address, times);
    // Addresses whose last run is over an hour old are forgotten, so a long-running server keeps a small table.
    if (recent.size > 2000) for (const [key, list] of recent) if (at - list.at(-1) >= HOUR) recent.delete(key);
  }
  async function admissible(address) {
    if (closed) throw new TryError(503, 'The server is stopping.');
    if (!readiness().open) throw new TryError(503, 'The live try is not open on this server.');
    if (await paused()) throw new TryError(503, 'The live try is paused for a moment. The recorded sessions stay open meanwhile.');
    admit(address);
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
    readiness, paused,
    /** How many steps work and wait in each lane, and how many runs are kept. */
    queues: () => ({ runs: runs.size, quick: { working: lanes.quick.running.size, waiting: lanes.quick.waiting.length }, pair: { working: lanes.pair.running.size, waiting: lanes.pair.waiting.length } }),
    starters: () => Object.values(starters).map(({ id, title, medium, summary }) => ({ id, title, medium, summary })),

    /** Read the runs kept in DATA_DIR/try; a step a restart interrupted is marked as such. */
    async initialize() {
      await fs.mkdir(base, { recursive: true });
      for (const name of await fs.readdir(base)) {
        if (!RUN_ID.test(name)) continue;
        const run = await readJson(path.join(base, name, 'meta.json'));
        if (!run || run.id !== name) continue;
        let changed = false;
        for (const [step, active] of [['quick', QUICK_ACTIVE], ['pair', PAIR_ACTIVE]]) {
          if (run[step] && active.includes(run[step].status)) { Object.assign(run[step], { status: 'failed', endedAt: run.updatedAt, problem: 'The server restarted during this step. Start it again.' }); changed = true; }
        }
        runs.set(run.id, run);
        if (changed) await save(run);
      }
    },

    /** Start step one for a juror's request. */
    async create(body, { address = 'unknown' } = {}) {
      const input = checkTryInput(body, starters);
      if (runs.size >= limits.runs) throw new TryError(507, 'The try has reached the number of runs this server keeps.');
      await admissible(address);
      const id = crypto.randomBytes(16).toString('hex');
      const starter = starters[input.starter];
      const run = { schemaVersion: TRY_SCHEMA_VERSION, id, createdAt: stamp(), updatedAt: stamp(), input, title: starter.title, medium: starter.medium, brief: tryBrief(input, starters), promptsVersion: TRY_PROMPTS_VERSION,
        host: 'kiro', hostVersion: /(\d+\.\d+\.\d+)/u.exec(status().version || '')?.[1] || null, model: model(), effort: config.effort || 'medium', qlooBudget: budget,
        surfaceVersion: MOUSA_SERVER_VERSION, ...(config.commit ? { commit: config.commit } : {}),
        previewToken: crypto.randomBytes(24).toString('hex'), quick: { status: 'queued', queuedAt: stamp() }, pair: null, consent: null };
      await fs.mkdir(path.join(folderOf(id), 'project'), { recursive: true });
      runs.set(id, run);
      await save(run);
      lanes.quick.waiting.push(id);
      pump();
      return run;
    },

    /** Start step two for a run whose measurement is ready. */
    async design(id, { address = 'unknown' } = {}) {
      const run = get(id);
      if (run.quick?.status !== 'done' || run.quick.measured?.status !== 'ok') throw new TryError(409, 'The pair is built from a finished measurement; this try has none.');
      if (run.pair && PAIR_ACTIVE.includes(run.pair.status)) return run;
      await admissible(address);
      run.pair = { status: 'queued', queuedAt: stamp() };
      run.consent = null;
      await save(run);
      lanes.pair.waiting.push(id);
      pump();
      return run;
    },

    /** Stop a run's waiting or working step. */
    async cancel(id) {
      const run = get(id);
      for (const [name, step, active] of [['quick', run.quick, QUICK_ACTIVE], ['pair', run.pair, PAIR_ACTIVE]]) {
        if (!step || !active.includes(step.status)) continue;
        const waiting = lanes[name].waiting.indexOf(id);
        if (waiting >= 0) { lanes[name].waiting.splice(waiting, 1); Object.assign(step, { status: 'cancelled', endedAt: stamp(), problem: 'The try was cancelled.' }); await save(run); }
        controllers.get(`${id}:${name}`)?.abort();
      }
      return run;
    },

    /** The juror's consent to publish a finished try in the gallery, or its withdrawal. */
    async publish(id, consent) {
      const run = get(id);
      // A gallery entry has designs to play, so only a finished pair is published.
      if (!run.pair || !['done', 'partial'].includes(run.pair.status) || !run.pair.report) throw new TryError(409, 'Only a try whose pair is finished can be published.');
      run.consent = consent ? { publish: true, at: stamp() } : null;
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
          captures: captures.length, latest: captures.at(-1)?.id || null, reviews: reviews.length, live: live.get(`${run.id}:${arm.id}`) || null };
      })) : [];
      return { quickPlace: place('quick'), pairPlace: place('pair'), predict: live.get(`${run.id}:predict`) || null, arms };
    },

    /** A run without what stays private: its preview token and the files' places. */
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
      const latest = captures.filter(item => /^[A-Za-z0-9_-]{1,120}$/u.test(item?.id || '')).at(-1);
      return latest ? path.join(armFolder(id, arm), '.mousa', 'captures', `${latest.id}.png`) : null;
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
