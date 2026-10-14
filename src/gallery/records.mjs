// A recorded design session as the gallery reads it: which host and model ran it, with which Moûsa version and at
// which commit of this repository, how long it took, the request it was given, the Qloo requests every design folder
// counted, the design records the report draws from and the session's timeline. Two kinds of record are read: a run of
// scripts/run-claude-code-live.mjs or run-codex-live.mjs (summary.json, session.jsonl, brief.md and project/), and the
// October 6 Kiro run of scripts/run-mobile-example-live.mjs, made with the earlier 0.4 tool surface.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readRecords } from '../../plugin/server/design/report.mjs';
import { claudeCodeTimeline, codexTimeline, kiroTimeline, jsonLines } from './timeline.mjs';

const run = promisify(execFile);
const ARMS = Object.freeze(['compare/with-qloo', 'compare/without-qloo']);
const HOSTS = Object.freeze(['claude-code', 'codex', 'kiro']);
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse, () => null);
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
    brief: typeof saved.request === 'string' ? saved.request : '', briefFile: null, qlooRequests: null,
    commit: await commitAt(repo, saved.startedAt), timeline: kiroTimeline(saved.calls),
  };
}
