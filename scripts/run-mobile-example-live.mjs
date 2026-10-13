#!/usr/bin/env node
// A live run of the portable plugin outside the Studio. Kiro CLI starts the agent of examples/mobile-app (the plugin's
// MCP server, its skill and policies, and Kiro's own read and write tools) in a copy of Ramble, and the agent
// redesigns it with the production stages. The run uses Kiro credits, up to 24 Qloo requests and, when its plan asks
// for pictures, Codex, so the script only prints its plan unless given --run.
//
//   node scripts/run-mobile-example-live.mjs [--run] [--model=<id>] [--request="<the user's request>"]
//
// The copy is examples/mobile-app-run-<stamp>, beside the example, where the agent's relative paths reach the plugin.
// The copy's agent names the model, since kiro-cli 2.24.0's v2 engine warns that it cannot set --model and runs the
// agent's own. Kiro's home, with the session record, is output/mobile-app-run/<stamp>/kiro-home, outside the copy;
// run.json beside it lists the tool calls, the artifacts the run left and which captures its review cites and its
// read tool opened. Keys travel only in Kiro's environment and are never written or printed.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { kiroOutputReader, streamUpdate } from '../src/kiro-output.mjs';
import { openedCaptures } from '../src/kiro-session-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLE = path.join(root, 'examples', 'mobile-app');
export const AGENT = 'mousa-designer';
export const REQUEST = 'Redesign Ramble for visitors who love Studio Ghibli films, Khruangbin and the photographs of Vivian Maier.';
export const ARTIFACTS = Object.freeze(['culture-assumption.json', 'culture-taste.json', 'culture-reading.json', 'culture-dna.json', 'culture-production.json', 'culture-review.json']);
const LIMIT_MS = 45 * 60 * 1000;
// A tool refused for want of an approval, which a run without prompts cannot give; two writes refused end the run.
const REFUSED = /approval is not supported in non-interactive mode/u;
const SYSTEM_VARIABLES = ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'LANG', 'TERM'];

export const stampOf = date => date.toISOString().replace(/[:.]/gu, '-');

/** Where one run lives: the copy beside the example, at the depth the agent's relative paths expect, and its record outside it. */
export function runLayout(stamp, { rootDir = root } = {}) {
  const out = path.join(rootDir, 'output', 'mobile-app-run', stamp);
  return { copy: path.join(rootDir, 'examples', `mobile-app-run-${stamp}`), out, home: path.join(out, 'kiro-home'), record: path.join(out, 'run.json') };
}

/**
 * Kiro's environment: the system's own variables, Kiro's key, and what the plugin's MCP server needs from the
 * environment it inherits: the Qloo key for its taste pass and Codex's path for pictures. This Node comes first on the
 * path, so the agent's bare `node` starts the plugin with it.
 */
export function runEnvironment({ config, home, base = process.env, nodeDir = path.dirname(process.execPath) }) {
  const env = {};
  for (const name of SYSTEM_VARIABLES) if (base[name]) env[name] = base[name];
  const paths = ['PATH', 'Path'].filter(name => env[name]);
  if (!paths.length) env.PATH = nodeDir;
  for (const name of paths) env[name] = `${nodeDir}${path.delimiter}${env[name]}`;
  env.KIRO_HOME = home;
  if (config.kiroApiKey) env.KIRO_API_KEY = config.kiroApiKey;
  if (config.qlooKey) env.QLOO_API_KEY = config.qlooKey;
  if (config.qlooBaseUrl) env.QLOO_BASE_URL = config.qlooBaseUrl;
  if (config.codexCliPath) env.CODEX_CLI_PATH = config.codexCliPath;
  return env;
}

/** The Kiro arguments, as the Studio's hosts pass them. */
export const kiroArgs = ({ model, effort = 'medium' }) => ['chat', '--agent', AGENT, '--agent-engine', 'v2', '--model', model, '--effort', effort, '--no-interactive', '--output-format', 'stream-json', '--require-mcp-startup'];

/** Copy the example as it is, then name the model in the copy's agent; the example itself is never changed. */
export async function prepareCopy({ layout, model, example = EXAMPLE }) {
  await fs.cp(example, layout.copy, { recursive: true, errorOnExist: true, force: false });
  const file = path.join(layout.copy, '.kiro', 'agents', `${AGENT}.json`);
  const agent = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, `${JSON.stringify({ ...agent, model }, null, 2)}\n`);
  await fs.mkdir(layout.home, { recursive: true });
}

/** One Kiro session in the copy: the tool calls it made, how it ended and how long it took. */
function runSession({ config, layout, model, request, limitMs = LIMIT_MS, platform = process.platform }) {
  const started = Date.now();
  const child = spawn(config.kiroPath, kiroArgs({ model, effort: config.effort }), { cwd: layout.copy, env: runEnvironment({ config, home: layout.home }),
    stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: platform === 'win32' });
  const calls = new Map(), finished = [];
  let stderr = '', refusedWrites = 0, stopped = null, settled = false;
  const stop = reason => { if (stopped) return; stopped = reason; child.kill(); };
  const onLine = line => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'runFinished') { finished.push({ status: event.data?.status ?? null, stopReason: event.data?.stopReason ?? null }); return; }
    const update = streamUpdate(event);
    if (!['tool_call', 'tool_call_update'].includes(update?.sessionUpdate) || typeof update.toolCallId !== 'string') return;
    const call = calls.get(update.toolCallId) || { at: Math.round((Date.now() - started) / 1000), title: null, kind: null, status: null, purpose: null };
    call.title ??= typeof update.title === 'string' ? update.title.slice(0, 160) : null;
    call.kind = update.kind ?? call.kind;
    call.status = update.status ?? call.status;
    call.purpose ??= typeof update.rawInput?.__tool_use_purpose === 'string' ? update.rawInput.__tool_use_purpose.slice(0, 160) : null;
    if (update.status === 'failed' && REFUSED.test(line)) {
      call.refused = true;
      if (/writ|edit|creat/iu.test(`${call.title} ${call.kind}`) && ++refusedWrites >= 2) stop('Kiro refused two writes for want of an approval.');
    }
    calls.set(update.toolCallId, call);
  };
  const timer = setTimeout(() => stop(`The run reached its ${Math.round(limitMs / 60000)}-minute limit.`), limitMs);
  child.stdout.on('data', kiroOutputReader({ onLine, onLimit: () => stop('The run exceeded its output limit.') }));
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.stdin.on('error', () => {});
  child.stdin.end(request);
  return new Promise(resolve => {
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started, stopped, finished, calls: [...calls.values()], stderr: stderr.replace(/\x1B\[[0-9;]*m/gu, '').trim().slice(-1500) });
    };
    child.on('error', error => finish({ exitCode: null, error: error.code === 'ENOENT' ? 'Kiro CLI not found.' : 'The Kiro process could not be started.' }));
    child.on('close', code => finish({ exitCode: code }));
  });
}

const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse, () => null);
const hashOf = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

async function filesUnder(dir, base = dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(full, base));
    else found.push(path.relative(base, full).replaceAll('\\', '/'));
  }
  return found;
}

/**
 * What the run left in the copy: the artifacts, the files it changed or added against the example, the pictures and
 * fonts the plugin wrote, the captures it issued, and which of the captures the last review cites the session's read
 * tool opened, from the session record in Kiro's home.
 */
export async function summarizeRun({ layout, example = EXAMPLE }) {
  const artifacts = {};
  for (const name of ARTIFACTS) {
    const stat = await fs.stat(path.join(layout.copy, name)).catch(() => null);
    artifacts[name] = stat ? stat.size : null;
  }
  const before = new Set(await filesUnder(example)), after = await filesUnder(layout.copy);
  const changed = [], added = [];
  // The plugin's records, the artifacts and the agent this script named the model in are reported apart.
  for (const file of after) {
    if (file.startsWith('.mousa/') || file.startsWith('.kiro/') || ARTIFACTS.includes(file)) continue;
    if (!before.has(file)) added.push(file);
    else if (await hashOf(path.join(example, file)) !== await hashOf(path.join(layout.copy, file))) changed.push(file);
  }
  const captures = (await readJson(path.join(layout.copy, '.mousa', 'captures.json')))?.captures || [];
  const review = await readJson(path.join(layout.copy, 'culture-review.json'));
  // The agent keeps its review as one round, or every round under rounds.
  const rounds = Array.isArray(review?.rounds) ? review.rounds : review ? [review] : [];
  const criteria = rounds.flatMap(round => (Array.isArray(round?.criteria) ? round.criteria : []).map(item => ({ round: round.round ?? null, id: item?.id ?? null, capture: item?.capture ?? null, verdict: item?.verdict ?? null })));
  const cited = [...new Set(criteria.map(item => item.capture).filter(id => typeof id === 'string'))];
  const opened = captures.length ? await openedCaptures({ home: layout.home, captures }) : null;
  const sessions = await fs.readdir(path.join(layout.home, 'sessions', 'cli')).catch(() => []);
  const models = new Set();
  for (const name of sessions.filter(file => file.endsWith('.json'))) {
    const text = await fs.readFile(path.join(layout.home, 'sessions', 'cli', name), 'utf8').catch(() => '');
    for (const match of text.matchAll(/"model_id"\s*:\s*"([^"]{1,120})"/gu)) models.add(match[1]);
  }
  return { artifacts, changed: changed.sort(), added: added.sort(), captures: captures.map(({ id, round, path: file }) => ({ id, round, path: file })),
    review: rounds.length ? { rounds: rounds.length, criteria, cited,
      ...(opened ? { audited: true, opened: cited.filter(id => opened.has(id)), unopened: cited.filter(id => !opened.has(id)) } : { audited: false }) } : null,
    models: [...models] };
}

async function main(argv = process.argv.slice(2)) {
  loadDotEnv();
  const config = getConfig();
  const model = argv.find(arg => arg.startsWith('--model='))?.slice('--model='.length) || config.model;
  const request = argv.find(arg => arg.startsWith('--request='))?.slice('--request='.length) || REQUEST;
  // --summarize=<stamp> reads a finished run again, without a session, and updates its run.json.
  const again = argv.find(arg => arg.startsWith('--summarize='))?.slice('--summarize='.length);
  if (again) {
    const done = runLayout(again);
    const record = { ...(await readJson(done.record)), ...(await summarizeRun({ layout: done })) };
    await fs.writeFile(done.record, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ artifacts: record.artifacts, changed: record.changed, added: record.added, review: record.review, models: record.models }, null, 2));
    return;
  }
  const layout = runLayout(stampOf(new Date()));
  const plan = { copy: path.relative(root, layout.copy), record: path.relative(root, layout.record), kiro: config.kiroPath, args: kiroArgs({ model: model || '<model>', effort: config.effort }), request,
    environment: Object.keys(runEnvironment({ config, home: layout.home })).sort(), qloo: Boolean(config.qlooKey), kiroKey: Boolean(config.kiroApiKey) };
  if (!argv.includes('--run')) {
    console.log(JSON.stringify({ status: 'planned-only', ...plan, instruction: 'Pass --run to start the session, which uses Kiro credits, up to 24 Qloo requests and Codex pictures when the plan asks for them.' }, null, 2));
    return;
  }
  if (!model) throw new Error('Set KIRO_MODEL or pass --model=<id>.');
  if (!config.qlooKey) throw new Error('The run needs QLOO_API_KEY in .env or the environment.');
  await prepareCopy({ layout, model });
  console.log(JSON.stringify({ status: 'started', copy: plan.copy, record: plan.record, model, request }));
  const session = await runSession({ config, layout, model, request });
  const summary = await summarizeRun({ layout });
  const record = { schemaVersion: '1.0', kind: 'mobile-app-live-run', startedAt: new Date(Date.now() - session.durationMs).toISOString(), model, request, kiro: config.kiroPath,
    exitCode: session.exitCode, ...(session.error ? { error: session.error } : {}), ...(session.stopped ? { stopped: session.stopped } : {}), finished: session.finished,
    durationMs: session.durationMs, calls: session.calls, ...summary, stderr: session.stderr };
  await fs.writeFile(layout.record, `${JSON.stringify(record, null, 2)}\n`);
  const tools = {};
  for (const call of session.calls) { const key = call.title?.replace(/^Running: /u, '').split(' ')[0] || call.kind || 'tool'; tools[key] = (tools[key] || 0) + 1; }
  console.log(JSON.stringify({ status: session.exitCode === 0 && !session.stopped ? 'finished' : 'stopped', exitCode: session.exitCode, stopped: session.stopped, finished: session.finished,
    minutes: Math.round(session.durationMs / 6000) / 10, tools, refused: session.calls.filter(call => call.refused).map(call => call.title), ...summary }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
