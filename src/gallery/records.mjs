// A recorded design session as the gallery reads it: which host and model ran it, with which Moûsa version and at
// which commit of this repository, how long it took, the request it was given, the Qloo requests every design folder
// counted, the design records the report draws from and the session's timeline. Two kinds of record are read: a run of
// scripts/run-claude-code-live.mjs or run-codex-live.mjs (summary.json, session.jsonl, brief.md and project/), and the
// October 6 Kiro run of scripts/run-mobile-example-live.mjs, made with the earlier 0.4 tool surface.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readRecords, listText } from '../../plugin/server/design/report.mjs';
import { claudeCodeTimeline, codexTimeline, kiroTimeline, tryTimeline, jsonLines } from './timeline.mjs';

const run = promisify(execFile);
const ARMS = Object.freeze(['compare/with-qloo', 'compare/without-qloo']);
const HOSTS = Object.freeze(['claude-code', 'codex', 'kiro']);
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const isFolder = file => fs.stat(file).then(stat => stat.isDirectory(), () => false);

/** The commit of this repository that was current when a run started, as its short hash, or null outside git. */
export async function commitAt(repo, startedAt) {
  if (!startedAt) return null;
  try {
    const { stdout } = await run('git', ['log', '-1', `--before=${startedAt}`, '--format=%h'], { cwd: repo, windowsHide: true });
    return stdout.trim() || null;
  } catch { return null; }
}

/** The Qloo requests a project's design folders counted, the project's own and each arm's. */
async function qlooRequests(project) {
  let total = 0;
  for (const folder of [project, ...ARMS.map(arm => path.join(project, ...arm.split('/')))]) total += (await readJson(path.join(folder, '.mousa', 'usage.json')))?.qlooRequests || 0;
  return total;
}

/** The Moûsa version a session's first mousa_status answered with, as the stream recorded it. */
function surfaceVersion(lines) {
  for (const line of lines) {
    const texts = line.type === 'user' ? (line.message?.content || []).flatMap(part => Array.isArray(part?.content) ? part.content.map(item => item?.text) : [part?.content])
      : line.item?.type === 'mcp_tool_call' ? (line.item.result?.content || []).map(item => item?.text) : [];
    for (const text of texts) {
      const version = typeof text === 'string' ? /"version":"(\d+\.\d+\.\d+)"/u.exec(text)?.[1] : null;
      if (version) return version;
    }
  }
  return null;
}

/** The brief file of scripts/briefs whose text is the run's request, for the command that reproduces it. */
async function briefFile(repo, text) {
  const folder = path.join(repo, 'scripts', 'briefs');
  for (const name of (await fs.readdir(folder).catch(() => [])).filter(file => file.endsWith('.md')).sort()) {
    if ((await fs.readFile(path.join(folder, name), 'utf8')).trim() === text.trim()) return `scripts/briefs/${name}`;
  }
  return null;
}

/**
 * A run of the live Claude Code or Codex script. Its design records are the project's own or, for a comparison, each
 * arm's. `host` comes from the run folder's name (claude-code-… or codex-…) unless given.
 */
export async function readPluginRun(folder, { repo, host: given = null } = {}) {
  const root = await fs.realpath(folder);
  const summary = await readJson(path.join(root, 'summary.json'));
  if (!summary) throw new Error(`${path.basename(root)} has no summary.json.`);
  const host = given || HOSTS.find(name => path.basename(root).startsWith(`${name}-`));
  if (!host) throw new Error(`${path.basename(root)} does not name its host; give it.`);
  const project = path.join(root, 'project');
  const lines = jsonLines(await fs.readFile(path.join(root, 'session.jsonl'), 'utf8').catch(() => ''));
  const brief = (await fs.readFile(path.join(root, 'brief.md'), 'utf8').catch(() => '')).trim();
  const init = lines.find(line => line.type === 'system' && line.subtype === 'init');
  const arms = [];
  for (const arm of ARMS) {
    const records = await isFolder(path.join(project, ...arm.split('/'))) ? await readRecords(path.join(project, ...arm.split('/'))) : null;
    if (records?.input) arms.push({ folder: arm, records });
  }
  const records = arms.length === 2 ? null : await readRecords(project);
  if (arms.length !== 2 && !records?.input) throw new Error(`${path.basename(root)} holds no measured or baseline design session.`);
  return {
    name: path.basename(root), host, kind: arms.length === 2 ? 'comparison' : 'session', root, project, ...(arms.length === 2 ? { arms } : { records }),
    startedAt: summary.startedAt || null, minutes: Number.isFinite(summary.minutes) ? summary.minutes : null, exitCode: summary.exitCode ?? null,
    model: summary.init?.model || init?.model || null, hostVersion: init?.claude_code_version || null, surfaceVersion: surfaceVersion(lines),
    turns: summary.result?.turns ?? null, brief, briefFile: brief ? await briefFile(repo, brief) : null,
    qlooRequests: await qlooRequests(project), commit: await commitAt(repo, summary.startedAt),
    timeline: host === 'codex' ? codexTimeline(lines) : claudeCodeTimeline(lines),
  };
}

/**
 * The October 6 run of scripts/run-mobile-example-live.mjs: its record (run.json) beside the copy of the example the
 * Kiro agent designed in, whose culture-*.json files the report reads.
 */
export async function readKiroRun({ record, project, repo }) {
  const saved = await readJson(record);
  if (!saved) throw new Error(`${record} could not be read.`);
  const records = await readRecords(project);
  if (!records?.input) throw new Error(`${project} holds no design session.`);
  return {
    name: path.basename(project), host: 'kiro', kind: 'session', root: path.dirname(record), project: await fs.realpath(project), records,
    startedAt: saved.startedAt || null, minutes: Number.isFinite(saved.durationMs) ? Math.round(saved.durationMs / 6000) / 10 : null, exitCode: saved.exitCode ?? null,
    model: saved.model || null, hostVersion: /chat-cli-(\d+\.\d+\.\d+)/u.exec(saved.kiro || '')?.[1] || null, surfaceVersion: '0.4.0', turns: null,
    // The earlier surface kept no count of its Qloo requests.
    brief: typeof saved.request === 'string' ? saved.request : '', briefFile: null, qlooRequests: null, legacy: true,
    commit: await commitAt(repo, saved.startedAt), timeline: kiroTimeline(saved.calls),
  };
}

const RUN_ID = /^[a-f0-9]{32}$/u;
const finishedPair = run => Boolean(run?.consent?.publish && ['done', 'partial'].includes(run.pair?.status) && run.pair.report);
const stepMinutes = step => { const ms = Date.parse(step?.endedAt) - Date.parse(step?.startedAt); return Number.isFinite(ms) && ms > 0 ? ms : 0; };

/**
 * The live tries of a server's DATA_DIR/try that their jurors agreed to publish, with a finished pair each, as entries
 * for the gallery's config: try-<first eight of the id>, titled by the starter and the audience.
 */
export async function publishedTries(dir, { starters = {} } = {}) {
  const entries = [];
  for (const name of (await fs.readdir(dir).catch(() => [])).filter(item => RUN_ID.test(item)).sort()) {
    const run = await readJson(path.join(dir, name, 'meta.json'));
    if (run?.id !== name || !finishedPair(run)) continue;
    const source = starters[run.input?.starter]?.source;
    entries.push({ id: `try-${name.slice(0, 8)}`, try: name, title: `${run.title || 'A live try'}, for people who love ${listText(run.input?.references || [])}`,
      summary: run.consent.by === 'operator' ? 'Recorded with the live try\'s own runner: the same prompts, agent files and Kiro sessions the hosted try runs for a juror.'
        : 'A juror ran this pair in the live try on the hosted server and agreed to publish it.', ...(source ? { before: { repo: source } } : {}) });
  }
  return entries;
}

/**
 * One live try: its run record (meta.json) beside its project, whose arms the report reads as a plugin comparison's.
 * Only a try whose juror agreed to publish it, with a finished pair, is read. Its sessions' calls make the timeline,
 * one lane each.
 */
export async function readTryRun(folder, { repo }) {
  const root = await fs.realpath(folder);
  const run = await readJson(path.join(root, 'meta.json'));
  if (!run?.id || !RUN_ID.test(run.id)) throw new Error(`${path.basename(root)} holds no try record.`);
  if (!finishedPair(run)) throw new Error(`try ${run.id.slice(0, 8)}: only a finished pair its juror agreed to publish is read.`);
  const project = path.join(root, 'project');
  const arms = [];
  for (const arm of ARMS) {
    const records = await readRecords(path.join(project, ...arm.split('/'))).catch(() => null);
    if (records?.input) arms.push({ folder: arm, records });
  }
  if (arms.length !== 2) throw new Error(`try ${run.id.slice(0, 8)}: both arms need their design records.`);
  const startedAt = run.quick?.startedAt || run.createdAt || null;
  const commit = run.commit || await commitAt(repo, startedAt);
  const sessions = [{ id: 'predict', label: 'The prediction session', calls: run.quick?.session?.calls },
    { id: 'with-qloo', label: 'The arm with Qloo', calls: run.pair.arms?.['with-qloo']?.session?.calls }, { id: 'without-qloo', label: 'The arm without Qloo', calls: run.pair.arms?.['without-qloo']?.session?.calls }];
  // The same request again, through the runner that takes the try's own steps without the site.
  const quoted = value => `"${String(value).replaceAll('"', '\\"')}"`;
  const input = run.input || {};
  const command = ['node scripts/run-try.mjs', `--starter ${input.starter}`, `--references ${quoted((input.references || []).join('; '))}`,
    ...(input.place ? [`--place ${quoted(input.place)}`] : []), ...(input.ages?.length ? [`--ages ${input.ages.join(',')}`] : []), '--pair'].join(' ');
  return {
    name: `try-${run.id.slice(0, 8)}`, host: 'kiro', kind: 'comparison', origin: 'try', tryBy: run.consent.by === 'operator' ? 'operator' : 'juror', root, project, arms,
    startedAt, minutes: Math.round((stepMinutes(run.quick) + stepMinutes(run.pair)) / 6000) / 10, exitCode: null,
    model: run.model || null, hostVersion: run.hostVersion || null, surfaceVersion: run.surfaceVersion || null, turns: null,
    brief: run.brief || '', briefFile: null, qlooRequests: run.pair.qlooRequests ?? run.quick?.measured?.qlooRequests ?? null, commit,
    timeline: tryTimeline(sessions),
    reproduce: { commit, command,
      needs: ['Your own Qloo API key as QLOO_API_KEY in this repository\'s .env.', `Kiro CLI${run.hostVersion ? ` ${run.hostVersion}` : ''}, signed in or with KIRO_API_KEY.`, 'A Chromium-based browser for the review captures (MOUSA_BROWSER names one).'],
      note: 'A try runs the same prompts each time; the model reaches its own prediction and design, and the measurement and the comparison are made the same way.' },
  };
}
