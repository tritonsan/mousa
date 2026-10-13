// One live Claude Code design session with the packaged Moûsa plugin, loaded for that session only with --plugin-dir,
// so the person's Claude Code settings stay as they are. Plan-only by default; --run starts the session.
// - The Qloo key and endpoint come from this repository's .env into the session's environment. They never go onto a
//   command line, into a record or into the output.
// - Codex images are off, so the run makes no paid image request; pictures fall back to SVG or CSS.
// - The session starts outside this repository with a clean environment: the variables a Claude Code host gives its
//   own tools are removed, so the session is a plain CLI run on the person's own login.
// - It records the session's stream to session.jsonl and a summary to summary.json beside the project folder.
//
//   node scripts/run-claude-code-live.mjs [--run] [--folder <dir>] [--max-turns 150] [--model <id>]

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
export const ALLOWED_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'mcp__plugin_mousa_mousa']);
// What a Claude Code host gives the tools it starts: its session, its messaging socket and its proxy. A test session
// started from inside a host must not inherit them.
const HOST_VARIABLES = /^(?:CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|ANTHROPIC_.*|MOUSA_.*|QLOO_.*|KIRO_.*)$/u;

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
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
  const dotenv = {};
  loadDotEnv(path.join(rootDir, '.env'), dotenv);
  const claude = await claudePath();
  const args = ['-p', '--plugin-dir', plugin, '--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns), '--allowedTools', ALLOWED_TOOLS.join(','), ...(model ? ['--model', model] : [])];
  const plan = { folder, project, plugin, claude, args, brief: BRIEF, environment: ['QLOO_API_KEY (from .env)', 'QLOO_BASE_URL (from QLOO_API_BASE_URL)', 'CODEX_IMAGES=off'],
    qlooKeyInDotEnv: Boolean(dotenv.QLOO_API_KEY), note: 'Each run is a full Claude Code session on your own login, and a measurement of at most 24 Qloo requests.' };
  if (!run) { console.log(JSON.stringify(plan, null, 2)); console.log('\nPlan only. Add --run to start the session.'); return; }
  if (!claude) throw new Error('The claude CLI was not found on PATH.');
  if (!dotenv.QLOO_API_KEY) throw new Error('No QLOO_API_KEY in .env.');
  if (path.resolve(project).toLowerCase().startsWith(path.resolve(rootDir).toLowerCase())) throw new Error('Run the session outside this repository.');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(folder, 'brief.md'), BRIEF);

  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !HOST_VARIABLES.test(name)));
  Object.assign(env, { QLOO_API_KEY: dotenv.QLOO_API_KEY, CODEX_IMAGES: 'off', ...(dotenv.QLOO_API_BASE_URL ? { QLOO_BASE_URL: dotenv.QLOO_API_BASE_URL } : {}) });
  const stream = createWriteStream(path.join(folder, 'session.jsonl'));
  const stderr = createWriteStream(path.join(folder, 'session.stderr.log'));
  const started = Date.now();
  const child = spawn(claude, args, { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(stream);
  child.stderr.pipe(stderr);
  child.stdin.end(BRIEF);
  const code = await new Promise(resolve => child.on('close', resolve));
  await new Promise(resolve => stream.end(resolve));
  await new Promise(resolve => stderr.end(resolve));
  const summary = { startedAt: new Date(started).toISOString(), minutes: Number(((Date.now() - started) / 60000).toFixed(1)), exitCode: code, project,
    ...(await summarize(path.join(folder, 'session.jsonl'))),
    stage: JSON.parse(await fs.readFile(path.join(project, '.mousa', 'session.json'), 'utf8').catch(() => '{}')).stage || null,
    files: (await fs.readdir(project).catch(() => [])).filter(name => !name.startsWith('.')),
    captures: (await fs.readdir(path.join(project, '.mousa', 'captures')).catch(() => [])) };
  await fs.writeFile(path.join(folder, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ exitCode: code, minutes: summary.minutes, model: summary.init?.model, stage: summary.stage, counts: summary.counts, held: summary.held.length, errors: summary.errors.length,
    turns: summary.result?.turns, costUsd: summary.result?.costUsd, files: summary.files, captures: summary.captures.length, folder }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
