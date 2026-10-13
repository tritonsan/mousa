// One live Claude Code design session with the packaged Moûsa plugin, loaded for that session only with --plugin-dir,
// so the person's Claude Code settings stay as they are. Plan-only by default; --run starts the session.
// - The Qloo key and endpoint come from this repository's .env into the session's environment. They never go onto a
//   command line, into a record or into the output. MOUSA_QLOO_BUDGET caps the project's Qloo requests (24 by default).
// - Pictures are off (MOUSA_IMAGES=off), so the run makes no image request on the person's plan; imagery falls back to
//   SVG or CSS.
// - The session starts outside this repository with a clean environment: the variables a Claude Code host gives its
//   own tools are removed, so the session is a plain CLI run on the person's own login.
// - --from restyles a copy of an existing project instead of an empty folder, and --brief-file gives the request.
// - A request that starts with a slash command, such as /mousa:compare, is passed on the command line. The session
//   runs in dontAsk mode with the tools below, Agent included for the compare skill's subagents, which run in front.
// - It records the session's stream to session.jsonl and a summary to summary.json beside the project folder, with the
//   files the session added, changed or removed in a copied project.
//
//   node scripts/run-claude-code-live.mjs [--run] [--folder <dir>] [--from <project>] [--brief-file <file>] [--budget 24]
//     [--max-turns 150] [--model <id>]

import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadDotEnv, rootDir } from '../src/config.mjs';

export const BRIEF = `Design a one-page website for Wax & Wane, a small record shop in Moda, Istanbul. It is for people who love the film Paterson and the music of Nujabes. Use the Moûsa plugin, so the design rests on what this audience actually loves.

Facts to keep exactly:
- Name: Wax & Wane
- Address: Moda Caddesi 42, Kadıköy, Istanbul
- Open Tuesday to Sunday, 12:00 to 21:00; closed on Mondays
- New and used vinyl, a listening corner with two turntables, and a listening session every Thursday at 19:30
- This week's three records: Nujabes, Modal Soul (2005); Hiroshi Yoshimura, Music for Nine Post Cards (1982); Khruangbin, Con Todo El Mundo (2018)
- A newsletter sign-up form that asks for an email address only

Build it as static HTML and CSS in this folder, with a small script only if the design needs one. Write all copy in English.
`;
// Agent lets the compare skill give its arms to the plugin's two subagents, which use the same tools.
export const ALLOWED_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Agent', 'mcp__plugin_mousa_mousa']);
// What a Claude Code host gives the tools it starts: its session, its messaging socket and its proxy. A test session
// started from inside a host must not inherit them.
const HOST_VARIABLES = /^(?:CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|ANTHROPIC_.*|MOUSA_.*|QLOO_.*|KIRO_.*)$/u;

// What a copied project leaves behind: version control, other agents' folders, an earlier session's records and secrets.
const NOT_COPIED = /^(?:\.git|\.kiro|\.claude|\.codex|\.agents|\.mousa|\.env.*)$/u;
// What a comparison of the copy leaves out besides: installed packages and build output.
const NOT_COMPARED = new Set(['node_modules', 'dist', 'build']);

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** The request: the file given with --brief-file, or the Wax & Wane brief. */
export async function readBrief(file) {
  return file ? fs.readFile(path.resolve(file), 'utf8') : BRIEF;
}

/** Copies an existing project into the session's empty project folder, without what NOT_COPIED names. */
export async function copyProject(from, to) {
  const source = path.resolve(from);
  if (!(await fs.stat(source).then(item => item.isDirectory(), () => false))) throw new Error(`No project folder at ${source}.`);
  if ((await fs.readdir(to).catch(() => [])).length) throw new Error(`The session's project folder is not empty: ${to}`);
  await fs.cp(source, to, { recursive: true, filter: file => file === source || !NOT_COPIED.test(path.basename(file)) });
}

/** The files a session added, changed and removed in a copied project. */
export async function compareProjects(from, to) {
  async function list(root) {
    const files = new Map();
    async function walk(dir) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (NOT_COPIED.test(entry.name) || NOT_COMPARED.has(entry.name)) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) files.set(path.relative(root, file).split(path.sep).join('/'), await fs.readFile(file));
      }
    }
    await walk(root);
    return files;
  }
  const before = await list(path.resolve(from)), after = await list(to);
  return { added: [...after.keys()].filter(name => !before.has(name)), changed: [...after.keys()].filter(name => before.has(name) && !before.get(name).equals(after.get(name))),
    removed: [...before.keys()].filter(name => !after.has(name)) };
}

/** The claude executable on PATH, or null. */
async function claudePath() {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const folder of (process.env.PATH || process.env.Path || '').split(path.delimiter)) {
    for (const name of names) {
      const file = path.join(folder, name);
      if (await fs.stat(file).then(item => item.isFile(), () => false)) return file;
    }
  }
  return null;
}

/** What the stream says: the model, the tools called in order, refusals by the gate, errors and the final result. */
export async function summarize(file) {
  const calls = [], errors = [], held = [];
  let init = null, result = null;
  const pending = new Map();
  for await (const line of createInterface({ input: createReadStream(file) })) {
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.type === 'system' && message.subtype === 'init') init = { model: message.model, plugins: message.plugins, mcpServers: message.mcp_servers, tools: (message.tools || []).filter(name => /mousa/u.test(name)) };
    for (const block of message.message?.content || []) {
      if (block.type === 'tool_use') {
        const call = { tool: block.name.replace(/^mcp__plugin_mousa_mousa__/u, 'mousa:'), ...(block.input?.stage ? { stage: block.input.stage } : {}),
          ...(block.input?.skill ? { skill: block.input.skill } : {}), ...(block.input?.file_path ? { file: path.basename(block.input.file_path) } : {}),
          ...(block.input?.dryRun ? { dryRun: true } : {}), ...(block.input?.question ? { question: block.input.question } : {}), ...(block.input?.action ? { action: block.input.action } : {}) };
        calls.push(call);
        pending.set(block.id, call);
      }
      if (block.type === 'tool_result' && block.is_error) {
        const text = (Array.isArray(block.content) ? block.content.map(item => item.text || '').join(' ') : String(block.content || '')).slice(0, 400);
        const call = pending.get(block.tool_use_id);
        (/Moûsa: the (?:design|records)/u.test(text) ? held : errors).push({ ...(call || {}), text });
      }
    }
    if (message.type === 'result') result = { subtype: message.subtype, turns: message.num_turns, durationMs: message.duration_ms, costUsd: message.total_cost_usd, text: String(message.result || '').slice(0, 3000) };
  }
  const counts = {};
  for (const call of calls) counts[call.tool] = (counts[call.tool] || 0) + 1;
  return { init, counts, calls, held, errors, result };
}

async function main() {
  const run = process.argv.includes('--run');
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const folder = path.resolve(option('--folder', path.join(path.parse(rootDir).root, 'mousa-live', `claude-code-${stamp}`)));
  const project = path.join(folder, 'project');
  const plugin = path.join(rootDir, 'plugins', 'claude-code');
  const maxTurns = Number.parseInt(option('--max-turns', '150'), 10);
  const model = option('--model', null);
  const from = option('--from', null);
  const budget = Number.parseInt(option('--budget', '24'), 10);
  const brief = await readBrief(option('--brief-file', null));
  const dotenv = {};
  loadDotEnv(path.join(rootDir, '.env'), dotenv);
  const claude = await claudePath();
  // A request that starts with a slash command, such as /mousa:compare, goes on the command line, which expands it;
  // before the flags, since --allowedTools takes several values. Any other request goes on stdin.
  const command = brief.trimStart().startsWith('/');
  const args = ['-p', ...(command ? [brief.trim()] : []), '--plugin-dir', plugin, '--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns),
    '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS.join(','), ...(model ? ['--model', model] : [])];
  const plan = { folder, project, ...(from ? { from: path.resolve(from) } : {}), plugin, claude, args, brief,
    environment: ['QLOO_API_KEY (from .env)', 'QLOO_BASE_URL (from QLOO_API_BASE_URL)', `MOUSA_QLOO_BUDGET=${budget}`, 'MOUSA_IMAGES=off', 'CODEX_IMAGES=off', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1'],
    qlooKeyInDotEnv: Boolean(dotenv.QLOO_API_KEY), note: `Each run is a full Claude Code session on your own login, and at most ${budget} Qloo requests.` };
  if (!run) { console.log(JSON.stringify(plan, null, 2)); console.log('\nPlan only. Add --run to start the session.'); return; }
  if (!claude) throw new Error('The claude CLI was not found on PATH.');
  if (!dotenv.QLOO_API_KEY) throw new Error('No QLOO_API_KEY in .env.');
  if (path.resolve(project).toLowerCase().startsWith(path.resolve(rootDir).toLowerCase())) throw new Error('Run the session outside this repository.');
  await fs.mkdir(project, { recursive: true });
  if (from) await copyProject(from, project);
  await fs.writeFile(path.join(folder, 'brief.md'), brief);

  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !HOST_VARIABLES.test(name)));
  // Subagents run in the foreground, so a print-mode session waits for the arms it gave them.
  Object.assign(env, { QLOO_API_KEY: dotenv.QLOO_API_KEY, MOUSA_QLOO_BUDGET: String(budget), MOUSA_IMAGES: 'off', CODEX_IMAGES: 'off', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    ...(dotenv.QLOO_API_BASE_URL ? { QLOO_BASE_URL: dotenv.QLOO_API_BASE_URL } : {}) });
  const stream = createWriteStream(path.join(folder, 'session.jsonl'));
  const stderr = createWriteStream(path.join(folder, 'session.stderr.log'));
  const started = Date.now();
  const child = spawn(claude, args, { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(stream);
  child.stderr.pipe(stderr);
  child.stdin.end(command ? '' : brief);
  const code = await new Promise(resolve => child.on('close', resolve));
  await new Promise(resolve => stream.end(resolve));
  await new Promise(resolve => stderr.end(resolve));
  const usage = JSON.parse(await fs.readFile(path.join(project, '.mousa', 'usage.json'), 'utf8').catch(() => '{}'));
  const summary = { startedAt: new Date(started).toISOString(), minutes: Number(((Date.now() - started) / 60000).toFixed(1)), exitCode: code, project,
    ...(await summarize(path.join(folder, 'session.jsonl'))), qlooRequests: usage.qlooRequests ?? 0, budget,
    stage: JSON.parse(await fs.readFile(path.join(project, '.mousa', 'session.json'), 'utf8').catch(() => '{}')).stage || null,
    files: (await fs.readdir(project).catch(() => [])).filter(name => !name.startsWith('.')),
    ...(from ? { projectChanges: await compareProjects(from, project) } : {}),
    captures: (await fs.readdir(path.join(project, '.mousa', 'captures')).catch(() => [])) };
  await fs.writeFile(path.join(folder, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ exitCode: code, minutes: summary.minutes, model: summary.init?.model, stage: summary.stage, counts: summary.counts, held: summary.held.length, errors: summary.errors.length,
    turns: summary.result?.turns, costUsd: summary.result?.costUsd, qlooRequests: summary.qlooRequests, files: summary.files, changes: summary.projectChanges, captures: summary.captures.length, folder }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
