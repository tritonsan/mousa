import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildPlugins, serverModules, SKILLS, SOURCE } from '../scripts/build-plugins.mjs';
import { createMousaServer, MOUSA_SERVER_VERSION } from '../plugin/server/mcp/mousa.mjs';
import { CODEX_SANDBOX_META } from '../plugin/server/production/project-files.mjs';

let root, built;
const pkg = (name, ...parts) => path.join(root, 'plugins', name, ...parts);
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const exists = file => stat(file).then(() => true, () => false);
const TOOLS = createMousaServer({ env: {}, inspect: { browser: async () => ({ available: false, reason: 'Not in tests.' }), codex: async () => ({ available: false, reason: 'Not in tests.' }) } }).listTools().map(tool => tool.name);

async function filesUnder(folder, prefix = '') {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await filesUnder(path.join(folder, entry.name), relative));
    else found.push(relative);
  }
  return found.sort();
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'mousa-build-'));
  built = await buildPlugins({ root });
});
after(async () => { await rm(root, { recursive: true, force: true }); });

test('the Claude Code package carries the server, the key setting, the project folder, the gate, the skills and the agents', async () => {
  const manifest = await read(pkg('claude-code', '.claude-plugin', 'plugin.json'));
  assert.equal(manifest.name, 'mousa');
  assert.equal(manifest.version, MOUSA_SERVER_VERSION);
  assert.equal(manifest.license, 'MIT');
  assert.deepEqual(manifest.author, { name: 'tritonsan' }, 'a name, never an email address');
  assert.equal(manifest.userConfig.qloo_api_key.sensitive, true);
  const server = (await read(pkg('claude-code', '.mcp.json'))).mcpServers.mousa;
  assert.deepEqual([server.command, server.args], ['node', ['${CLAUDE_PLUGIN_ROOT}/server/mousa.mjs']]);
  assert.deepEqual(server.env, { MOUSA_QLOO_API_KEY: '${user_config.qloo_api_key}', MOUSA_QLOO_BASE_URL: '${user_config.qloo_base_url}', MOUSA_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}', MOUSA_HOST: 'claude-code' });
  const hook = (await read(pkg('claude-code', 'hooks', 'hooks.json'))).hooks.PreToolUse[0];
  assert.equal(hook.matcher, 'Write|Edit|MultiEdit|NotebookEdit');
  assert.equal(hook.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs"');
  for (const skill of SKILLS) {
    assert.ok(await exists(pkg('claude-code', 'skills', skill, 'SKILL.md')), skill);
    assert.ok(!(await exists(pkg('claude-code', 'skills', skill, 'agents'))), `${skill} carries no Codex metadata here`);
  }
  assert.deepEqual(await readdir(pkg('claude-code', 'agents')), ['mousa-baseline.md', 'mousa-designer.md']);
  assert.ok(await exists(pkg('claude-code', 'evals', 'site-for-audience', 'prompt.md')));
  assert.ok(!(await exists(pkg('claude-code', '.codex-plugin'))) && !(await exists(pkg('claude-code', 'plugin.json'))));
});

test('the Codex package has its own manifest and no root plugin.json, and passes the key by name', async () => {
  assert.ok(!(await exists(pkg('codex', 'plugin.json'))), 'a root plugin.json would be read first and its hooks skipped');
  assert.ok(!(await exists(pkg('codex', '.claude-plugin'))));
  const manifest = await read(pkg('codex', '.codex-plugin', 'plugin.json'));
  assert.equal(manifest.version, MOUSA_SERVER_VERSION);
  assert.deepEqual([manifest.skills, manifest.mcpServers], ['./skills/', './.mcp.json']);
  const face = manifest.interface;
  assert.equal(face.displayName, 'Moûsa');
  assert.ok(face.defaultPrompt.length <= 3 && face.defaultPrompt.every(item => item.length <= 128));
  assert.match(face.brandColor, /^#[0-9A-F]{6}$/u);
  assert.equal(manifest.extensions['com.openai'].onboardingSkill, './skills/connect/SKILL.md');
  const server = (await read(pkg('codex', '.mcp.json'))).mcpServers.mousa;
  assert.deepEqual([server.command, server.args, server.cwd], ['node', ['./server/mousa.mjs'], '.']);
  assert.deepEqual(server.env, { MOUSA_HOST: 'codex' });
  assert.ok(server.env_vars.includes('QLOO_API_KEY') && server.env_vars.includes('QLOO_BASE_URL'));
  assert.equal(server.tools.mousa_open_project.approval_mode, 'prompt', 'the person approves a project folder');
  assert.ok(server.tool_timeout_sec >= 600);
  const hook = (await read(pkg('codex', 'hooks', 'hooks.json'))).hooks.PreToolUse[0];
  assert.equal(hook.matcher, 'apply_patch|Write|Edit');
  assert.equal(hook.hooks[0].command, 'node "${PLUGIN_ROOT}/hooks/gate.mjs"');
  for (const skill of SKILLS) for (const part of ['SKILL.md', 'agents/openai.yaml', 'evals/evals.json']) assert.ok(await exists(pkg('codex', 'skills', skill, ...part.split('/'))), `${skill}/${part}`);
  assert.ok(!(await exists(pkg('codex', 'agents'))), 'the comparison agents are Claude Code\'s');
});

test('every path a manifest names starts with ./, stays in its package and exists', async () => {
  const manifest = await read(pkg('codex', '.codex-plugin', 'plugin.json'));
  const paths = [manifest.skills, manifest.mcpServers, manifest.interface.composerIcon, manifest.interface.logo, manifest.extensions['com.openai'].onboardingSkill];
  for (const value of paths) {
    assert.match(value, /^\.\//u, value);
    const target = path.resolve(pkg('codex'), value);
    assert.ok(target.startsWith(pkg('codex')) && await exists(target), value);
  }
});

test('every copied file is its source, byte for byte, and the server holds only what mousa.mjs imports', async () => {
  const modules = await serverModules();
  assert.ok(modules.includes('mousa.mjs') && modules.includes('mcp/mousa.mjs') && !modules.includes('index.mjs'), 'the older standalone entry stays out');
  for (const name of ['claude-code', 'codex']) {
    assert.deepEqual((await filesUnder(pkg(name, 'server'))), modules, `${name} server`);
    for (const { from, to } of built.packages[name].copied) assert.ok((await readFile(from)).equals(await readFile(pkg(name, ...to.split('/')))), `${name}/${to}`);
    assert.ok(await exists(pkg(name, 'library', 'fonts', 'fonts.json')));
  }
});

/** The packaged server as a host starts it, over stdio, in a bare environment. */
async function startPackaged(name, extra) {
  const bare = Object.fromEntries(['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOME', 'TMPDIR']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const child = spawn(process.execPath, [pkg(name, 'server', 'mousa.mjs')], { cwd: pkg(name), env: { ...bare, MOUSA_CAPTURE: 'off', ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
  // A pipe that breaks while the server closes must not end the test process.
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => {});
  child.stderr.resume();
  const exited = new Promise(resolve => child.once('exit', resolve));
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    pending.get(message.id)?.(message);
  });
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    id += 1;
    const timer = setTimeout(() => reject(new Error(`${name}: no answer to ${method}`)), 30000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  // The server ends when its input closes; it is stopped only if it does not.
  const stop = async () => {
    child.stdin.end();
    const late = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(late);
  };
  return { request, stop };
}

test('each packaged server starts on its own in a bare environment and finds its own fonts', async () => {
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-build-config-'));
  const project = await mkdtemp(path.join(os.tmpdir(), 'mousa-build-project-'));
  try {
    for (const [name, env, meta] of [['claude-code', { MOUSA_HOST: 'claude-code', MOUSA_PROJECT_DIR: project }, undefined],
      ['codex', { MOUSA_HOST: 'codex' }, { [CODEX_SANDBOX_META]: { sandboxCwd: pathToFileURL(project).href } }]]) {
      const server = await startPackaged(name, { ...env, MOUSA_CONFIG_DIR: config });
      try {
        const init = await server.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
        assert.equal(init.result.serverInfo.name, 'mousa');
        assert.ok(init.result.instructions.length <= 2048);
        const listed = await server.request('tools/list', {});
        assert.deepEqual(listed.result.tools.map(tool => tool.name), TOOLS, `${name} lists the thirteen tools`);
        const status = JSON.parse((await server.request('tools/call', { name: 'mousa_status', arguments: {}, ...(meta ? { _meta: meta } : {}) })).result.content[0].text);
        assert.equal(status.host, name);
        assert.equal(status.materials.fonts, 33, `${name} reads the font library it carries`);
        assert.equal(status.project.folder, await import('node:fs/promises').then(fs => fs.realpath(project)));
        assert.equal(status.project.source, name === 'codex' ? 'host' : 'environment');
        assert.equal(status.qloo.connected, false, 'no key in a bare environment and an empty connections folder');
      } finally { await server.stop(); }
    }
  } finally {
    await rm(config, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test('the marketplaces point each host at its own package', async () => {
  const claude = await read(path.join(root, '.claude-plugin', 'marketplace.json'));
  assert.equal(claude.name, 'mousa');
  assert.deepEqual(claude.plugins.map(item => [item.name, item.source, item.version]), [['mousa', './plugins/claude-code', MOUSA_SERVER_VERSION]]);
  const codex = await read(path.join(root, '.agents', 'plugins', 'marketplace.json'));
  assert.deepEqual(codex.plugins[0].source, { source: 'local', path: './plugins/codex' });
  assert.deepEqual(codex.plugins[0].policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
  assert.ok(codex.plugins[0].category);
});

test('the Kiro template runs the mousa entry with the two skills and keeps writes out of .mousa', async () => {
  const agent = await read(pkg('kiro', 'mousa-designer.json'));
  assert.deepEqual(agent.mcpServers.mousa.args, ['MOUSA_PLUGIN_DIR/server/mousa.mjs']);
  assert.equal(agent.mcpServers.mousa.env.MOUSA_HOST, 'kiro');
  assert.deepEqual(agent.resources, ['file://MOUSA_PLUGIN_DIR/skills/taste-brief/SKILL.md', 'file://MOUSA_PLUGIN_DIR/skills/design/SKILL.md']);
  assert.ok(agent.toolsSettings.write.deniedPaths.includes('.mousa/**'));
  assert.match(await readFile(pkg('kiro', 'prompts', 'mousa-designer.md'), 'utf8'), /mousa_status/u);
});

test('the eval suites name only tools, skills and fields that exist', async () => {
  const PROMPT_FIELDS = new Set(['max_turns', 'runs', 'timeout_seconds', 'allowed_tools', 'tags', 'plugins', 'model', 'env', 'append_system_prompt', 'name', 'description', 'expected_outcome']);
  const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline']);
  const fields = text => Object.fromEntries((/^---\n([\s\S]*?)\n---/u.exec(text.replaceAll('\r\n', '\n'))?.[1] || '').split('\n').map(line => /^([a-z_]+):\s*(.*)$/u.exec(line)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^'|'$/gu, '')]));
  const tool = value => value === 'Skill' || (value.startsWith('mcp__plugin_mousa_mousa__') && TOOLS.includes(value.slice('mcp__plugin_mousa_mousa__'.length)));
  const evals = path.join(SOURCE, 'plugin', 'evals');
  const cases = (await readdir(evals)).filter(name => name !== 'mocks');
  assert.ok(cases.length >= 4);
  for (const name of cases) {
    const prompt = fields(await readFile(path.join(evals, name, 'prompt.md'), 'utf8'));
    for (const key of Object.keys(prompt)) assert.ok(PROMPT_FIELDS.has(key), `${name}: ${key}`);
    for (const file of await readdir(path.join(evals, name, 'graders'))) {
      const grader = fields(await readFile(path.join(evals, name, 'graders', file), 'utf8'));
      assert.ok(GRADER_TYPES.has(grader.type), `${name}/${file}`);
      for (const key of ['tool', 'before', 'after']) if (grader[key]) assert.ok(tool(grader[key]), `${name}/${file}: ${grader[key]}`);
      if (grader.input_match?.includes('skill')) assert.ok(SKILLS.some(skill => grader.input_match.includes(skill)), `${name}/${file} names a Moûsa skill`);
    }
  }
  for (const file of await readdir(path.join(evals, 'mocks', 'mousa'))) assert.ok(TOOLS.includes(file.replace(/\.md$/u, '')), `mock ${file}`);
  for (const skill of SKILLS) {
    const suite = await read(path.join(SOURCE, 'plugin', 'skills', skill, 'evals', 'evals.json'));
    assert.equal(suite.skill_name, skill);
    suite.evals.forEach((item, index) => {
      assert.equal(item.id, index + 1);
      assert.ok(item.prompt && item.expected_output && Array.isArray(item.files) && item.expectations.length);
      for (const [name] of item.expectations.join(' ').matchAll(/\b(?:mousa|taste|qloo|design)_[a-z_]+\b/gu)) assert.ok(TOOLS.includes(name), `${skill} eval ${item.id} names ${name}`);
    });
  }
});

test('the packages in the repository are the ones its sources build', async () => {
  for (const name of ['claude-code', 'codex', 'kiro']) {
    const fresh = await filesUnder(pkg(name)), committed = await filesUnder(path.join(SOURCE, 'plugins', name)).catch(() => []);
    assert.deepEqual(committed, fresh, `${name}: run node scripts/build-plugins.mjs`);
    for (const file of fresh) assert.ok((await readFile(pkg(name, ...file.split('/')))).equals(await readFile(path.join(SOURCE, 'plugins', name, ...file.split('/')))), `${name}/${file} is stale: run node scripts/build-plugins.mjs`);
  }
  for (const file of built.marketplaces) assert.equal(await readFile(path.join(SOURCE, ...file.split('/')), 'utf8'), await readFile(path.join(root, ...file.split('/')), 'utf8'), file);
  void mkdir;
});
