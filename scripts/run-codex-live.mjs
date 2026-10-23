// One live Codex design session with the packaged Moûsa plugin, by default with the same brief as the Claude Code
// session. Plan-only by default; --run starts the session.
// - Codex has no per-session plugin folder, so --run installs the plugin from this repository's marketplace into the
//   person's Codex, and removes the plugin and the marketplace again afterwards unless --keep.
// - The session ignores the person's config.toml (--ignore-user-config), so their approval, sandbox and MCP server
//   settings do not apply; -c names only Moûsa's marketplace and plugin. The sandbox lets it write only in the project
//   folder, and Moûsa's own write gate runs without a persisted trust for this run only (--dangerously-bypass-hook-trust:
//   with the person's config ignored, Moûsa's is the only plugin and its gate the only hook).
// - The Qloo key comes from this repository's .env into the environment Codex starts from, never onto a command line,
//   and MOUSA_QLOO_BUDGET caps the project folder's Qloo requests (24 by default).
// - Pictures are off (MOUSA_IMAGES=off): Codex's own image tool would draw on the person's ChatGPT plan, which a run asks
//   for separately. --images keeps them on.
// - --from restyles a copy of an existing project, --brief-file gives the request, and --install runs the copy's
//   npm ci before the session, which reaches npm; the session's sandbox has no network.
// - It records Codex's event stream to session.jsonl and a summary to summary.json beside the project folder, with the
//   files the session added, changed or removed in a copied project.
//
//   node scripts/run-codex-live.mjs [--run] [--keep] [--folder <dir>] [--from <project>] [--install] [--brief-file <file>]
//     [--budget 24] [--images] [--windows-sandbox elevated]

import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, rootDir } from '../src/config.mjs';
import { readBrief, copyProject, compareProjects, qlooRequestsIn } from './run-claude-code-live.mjs';

const HOST_VARIABLES = /^(?:CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|ANTHROPIC_.*|MOUSA_.*|QLOO_.*|KIRO_.*|CODEX_HOME)$/u;

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** The newest Codex CLI the desktop app installed, or CODEX_CLI_PATH. */
async function codexPath() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  const bin = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  const found = [];
  for (const entry of await fs.readdir(bin, { withFileTypes: true }).catch(() => [])) {
    const file = entry.isDirectory() ? path.join(bin, entry.name, 'codex.exe') : entry.name === 'codex.exe' ? path.join(bin, entry.name) : null;
    const stat = file ? await fs.stat(file).catch(() => null) : null;
    if (stat?.isFile()) found.push({ file, time: stat.mtimeMs });
  }
  return found.sort((a, b) => b.time - a.time)[0]?.file || null;
}

/** A Codex command that changes only the plugin's own entries; its output is returned, never the environment. */
function codexCommand(codex, args, env) {
  return new Promise(resolve => {
    const child = spawn(codex, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve({ code, out: out.split('\n').filter(line => !/PATH aliases/u.test(line)).join('\n').trim() }));
  });
}

/** npm ci in the copied project, through the shell npm needs on Windows; its output is returned, never the environment. */
function npmCi(project, env) {
  return new Promise(resolve => {
    const child = spawn('npm ci --no-audit --no-fund', { cwd: project, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve({ code, out: out.trim() }));
  });
}

/** What Codex's event stream says: the Moûsa calls in order, file changes, commands, refusals, errors and usage. */
export async function summarize(file) {
  const calls = [], changes = [], commands = [], errors = [], held = [], items = {};
  let usage = null, last = '';
  for await (const line of createInterface({ input: createReadStream(file) })) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const item = event.item;
    if (event.type === 'turn.completed' && event.usage) usage = event.usage;
    if (event.type === 'error' || event.type === 'turn.failed') errors.push({ type: event.type, text: String(event.message || event.error?.message || '').slice(0, 300) });
    if (!item || event.type !== 'item.completed') continue;
    items[item.type] = (items[item.type] || 0) + 1;
    const text = JSON.stringify(item).slice(0, 4000);
    if (/Moûsa: the (?:design|records)/u.test(text)) held.push({ type: item.type, text: text.slice(0, 300) });
    if (item.type === 'mcp_tool_call') {
      const args = item.arguments || {};
      calls.push({ tool: `${item.server}:${item.tool}`, status: item.status, ...(args.stage ? { stage: args.stage } : {}), ...(args.action ? { action: args.action } : {}),
        ...(args.dryRun ? { dryRun: true } : {}), ...(args.question ? { question: args.question } : {}), ...(item.error ? { error: String(item.error.message || item.error).slice(0, 200) } : {}) });
    }
    if (item.type === 'file_change') changes.push(...(item.changes || []).map(change => `${change.kind || ''} ${path.basename(change.path || '')}`.trim()));
    if (item.type === 'command_execution') commands.push({ command: String(item.command || '').slice(0, 160), exit: item.exit_code, status: item.status });
    if (item.type === 'agent_message') last = String(item.text || '').slice(0, 3000);
  }
  const counts = {};
  for (const call of calls) counts[call.tool] = (counts[call.tool] || 0) + 1;
  return { items, counts, calls, changes, commands, held, errors, usage, last };
}

async function main() {
  const run = process.argv.includes('--run'), keep = process.argv.includes('--keep'), install = process.argv.includes('--install'), images = process.argv.includes('--images');
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const folder = path.resolve(option('--folder', path.join(path.parse(rootDir).root, 'mousa-live', `codex-${stamp}`)));
  const project = path.join(folder, 'project');
  const budget = Number.parseInt(option('--budget', '24'), 10);
  const from = option('--from', null);
  const brief = await readBrief(option('--brief-file', null));
  const dotenv = {};
  loadDotEnv(path.join(rootDir, '.env'), dotenv);
  const codex = await codexPath();
  // Only Moûsa's marketplace and plugin, as inline tables: the person's config.toml is not loaded. A run without a
  // person cannot answer approvals, and Codex asks one for every tool that reaches the network, so Moûsa's tools are
  // approved for this run, as the person approves them in the app; MOUSA_QLOO_BUDGET still caps Qloo. On Windows the
  // sandbox mode comes back by name too, because without it Codex cannot sandbox a command and refuses every one: the
  // first session could not even read its skills.
  const windowsSandbox = option('--windows-sandbox', 'elevated');
  const overrides = ['-c', `marketplaces={ mousa = { source_type = "local", source = '${rootDir}' } }`, '-c', 'plugins={ "mousa@mousa" = { enabled = true, mcp_servers = { mousa = { default_tools_approval_mode = "approve" } } } }',
    ...(process.platform === 'win32' ? ['-c', `windows.sandbox="${windowsSandbox}"`] : [])];
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', project, ...overrides,
    '--dangerously-bypass-hook-trust', '-o', path.join(folder, 'last-message.md'), '-'];
  const plan = { folder, project, ...(from ? { from: path.resolve(from), packages: install ? 'npm ci in the copy, before the session' : 'as copied' } : {}), codex,
    install: ['plugin remove mousa@mousa (if present)', `plugin marketplace add ${rootDir}`, 'plugin add mousa@mousa'], args, brief,
    environment: ['QLOO_API_KEY (from .env)', 'QLOO_BASE_URL (from QLOO_API_BASE_URL)', `MOUSA_QLOO_BUDGET=${budget}`, ...(images ? [] : ['MOUSA_IMAGES=off'])], afterwards: keep ? 'keep the plugin installed' : 'plugin remove mousa@mousa; plugin marketplace remove mousa',
    qlooKeyInDotEnv: Boolean(dotenv.QLOO_API_KEY), note: `A full Codex session on your own sign-in, ${images ? 'with pictures from Codex\'s image tool' : 'with no pictures'}, and at most ${budget} Qloo requests.` };
  if (!run) { console.log(JSON.stringify(plan, null, 2)); console.log('\nPlan only. Add --run to start the session.'); return; }
  if (!codex) throw new Error('No Codex CLI was found; set CODEX_CLI_PATH.');
  if (!dotenv.QLOO_API_KEY) throw new Error('No QLOO_API_KEY in .env.');
  if (path.resolve(project).toLowerCase().startsWith(path.resolve(rootDir).toLowerCase())) throw new Error('Run the session outside this repository.');
  await fs.mkdir(project, { recursive: true });
  if (from) await copyProject(from, project);
  await fs.writeFile(path.join(folder, 'brief.md'), brief);

  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !HOST_VARIABLES.test(name)));
  if (from && install) {
    const packages = await npmCi(project, env);
    await fs.writeFile(path.join(folder, 'npm-ci.log'), `exit ${packages.code}\n${packages.out}`);
    if (packages.code !== 0) throw new Error(`npm ci failed in the copy: ${packages.out.slice(-300)}`);
  }
  const installed = [];
  installed.push(await codexCommand(codex, ['plugin', 'remove', 'mousa@mousa'], env));
  installed.push(await codexCommand(codex, ['plugin', 'marketplace', 'add', rootDir], env));
  installed.push(await codexCommand(codex, ['plugin', 'add', 'mousa@mousa'], env));
  await fs.writeFile(path.join(folder, 'install.log'), installed.map(item => `exit ${item.code}\n${item.out}`).join('\n---\n'));
  if (installed.at(-1).code !== 0) throw new Error(`The plugin did not install: ${installed.at(-1).out.slice(0, 300)}`);

  // The browser the session captures with is the one this run names, as the Claude Code runner passes it.
  const browser = process.env.MOUSA_BROWSER || dotenv.MOUSA_BROWSER || '';
  Object.assign(env, { QLOO_API_KEY: dotenv.QLOO_API_KEY, MOUSA_QLOO_BUDGET: String(budget), ...(images ? {} : { MOUSA_IMAGES: 'off' }), ...(browser ? { MOUSA_BROWSER: browser } : {}), ...(dotenv.QLOO_API_BASE_URL ? { QLOO_BASE_URL: dotenv.QLOO_API_BASE_URL } : {}) });
  const stream = createWriteStream(path.join(folder, 'session.jsonl'));
  const stderr = createWriteStream(path.join(folder, 'session.stderr.log'));
  const started = Date.now();
  const child = spawn(codex, args, { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(stream);
  child.stderr.pipe(stderr);
  child.stdin.end(brief);
  const code = await new Promise(resolve => child.on('close', resolve));
  await new Promise(resolve => stream.end(resolve));
  await new Promise(resolve => stderr.end(resolve));

  const cleanup = [];
  if (!keep) {
    delete env.QLOO_API_KEY;
    cleanup.push(await codexCommand(codex, ['plugin', 'remove', 'mousa@mousa'], env));
    cleanup.push(await codexCommand(codex, ['plugin', 'marketplace', 'remove', 'mousa'], env));
  }
  const summary = { startedAt: new Date(started).toISOString(), minutes: Number(((Date.now() - started) / 60000).toFixed(1)), exitCode: code, project,
    ...(await summarize(path.join(folder, 'session.jsonl'))), qlooRequests: await qlooRequestsIn(project), budget,
    stage: JSON.parse(await fs.readFile(path.join(project, '.mousa', 'session.json'), 'utf8').catch(() => '{}')).stage || null,
    files: (await fs.readdir(project).catch(() => [])).filter(name => !name.startsWith('.')),
    captures: (await fs.readdir(path.join(project, '.mousa', 'captures')).catch(() => [])),
    pictures: (await fs.readdir(path.join(project, 'generated')).catch(() => [])),
    ...(from ? { projectChanges: await compareProjects(from, project) } : {}),
    cleanup: cleanup.map(item => item.code) };
  await fs.writeFile(path.join(folder, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ exitCode: code, minutes: summary.minutes, stage: summary.stage, counts: summary.counts, items: summary.items, held: summary.held.length, errors: summary.errors.length,
    qlooRequests: summary.qlooRequests, files: summary.files, changes: summary.projectChanges, captures: summary.captures.length, pictures: summary.pictures, cleanup: summary.cleanup, folder }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
