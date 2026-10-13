import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runKiro, makeDesignPrompt, prepareKiroWorkspace, mcpServerLaunch } from '../src/kiro-runner.mjs';

class FakeChild extends EventEmitter {
  constructor(afterInput, killCode = 3221225786) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killCalls = 0;
    this.unrefCalls = 0;
    this.prompt = '';
    this.killCode = killCode;
    this.stdin.on('data', chunk => { this.prompt += chunk.toString(); });
    this.stdin.once('finish', () => setImmediate(() => afterInput?.(this)));
  }
  kill() {
    this.killCalls++;
    setImmediate(() => this.emit('close', this.killCode));
    return true;
  }
  unref() { this.unrefCalls++; }
}

async function fixture(t, afterInput, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-kiro-runner-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const child = new FakeChild(afterInput);
  const spawns = [];
  const events = [];
  const config = {
    rootDir: path.resolve(import.meta.dirname, '..'),
    kiroPath: 'test-only-kiro',
    runTimeoutMs: 1000,
    effort: 'medium',
    qlooKey: 'fixture-qloo-secret',
    kiroApiKey: '',
    ...overrides.config,
  };
  const input = {
    directory, config, model: 'test-only-model', prompt: 'A harmless test request.',
    bridgeUrl: 'http://127.0.0.1:8787/internal/tools', bridgeToken: 'test-only-token',
    mode: 'baseline', platform: 'win32', onEvent: event => events.push(event),
    spawnImpl: (command, args, options) => {
      spawns.push({ command, args, options });
      return child;
    },
    ...overrides.input,
  };
  return { input, child, spawns, events, config, directory };
}

test('runner isolates Windows console ownership while retaining hidden piped child control', async t => {
  const f = await fixture(t, child => {
    child.stdout.write(JSON.stringify({ type: 'tool_call', title: 'Read fixture-qloo-secret' }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'text_delta', text: 'Generated text is not an audit event.' }) + '\n');
    child.emit('close', 0);
  });
  assert.deepEqual(await runKiro(f.input), { exitCode: 0 });
  assert.equal(f.spawns.length, 1);
  const spawn = f.spawns[0];
  assert.equal(spawn.options.detached, true);
  assert.equal(spawn.options.windowsHide, true);
  assert.equal(spawn.options.shell, false);
  assert.deepEqual(spawn.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(spawn.options.cwd, f.directory);
  assert.equal(spawn.args[spawn.args.indexOf('--model') + 1], 'test-only-model');
  assert.equal(spawn.options.env.QLOO_API_KEY, undefined);
  assert.equal(f.child.prompt, f.input.prompt);
  assert.equal(f.child.killCalls, 0);
  assert.equal(f.child.unrefCalls, 0);
  assert.deepEqual(f.events, [{ type: 'agent', message: 'Read [redacted]' }]);
});

test('runner preserves ordinary non-Windows process grouping', async t => {
  const f = await fixture(t, child => child.emit('close', 0), { input: { platform: 'linux' } });
  await runKiro(f.input);
  assert.equal(f.spawns[0].options.detached, false);
  assert.equal(f.child.unrefCalls, 0);
});

test('Windows MCP launch avoids a spaced Node command combined with a spaced project path', async t => {
  assert.deepEqual(mcpServerLaunch({ rootDir: 'D:\\Spaced Project', execPath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32' }),
    { command: 'node', args: ['D:\\Spaced Project\\src\\mcp\\server.mjs'], pathPrefix: 'C:\\Program Files\\nodejs' });
  for (const [rootDir, execPath] of [['D:\\Spaced Project', 'C:\\node\\node.exe'], ['D:\\project', 'C:\\Program Files\\nodejs\\node.exe']]) {
    assert.deepEqual(mcpServerLaunch({ rootDir, execPath, platform: 'win32' }), { command: execPath, args: [`${rootDir}\\src\\mcp\\server.mjs`], pathPrefix: null });
  }
  assert.equal(mcpServerLaunch({ rootDir: '/srv/spaced project', execPath: '/opt/node js/bin/node', platform: 'linux' }).command, '/opt/node js/bin/node');
  // The runner applies one launch decision to the agent file and the Kiro environment on this host.
  const f = await fixture(t, child => child.emit('close', 0));
  await runKiro(f.input);
  const agent = JSON.parse(await fs.readFile(path.join(f.directory, '.kiro', 'agents', 'culture-demo.json'), 'utf8'));
  const expected = mcpServerLaunch({ rootDir: f.config.rootDir, platform: 'win32' });
  assert.equal(agent.mcpServers.culture.command, expected.command);
  assert.deepEqual(agent.mcpServers.culture.args, expected.args);
  const env = f.spawns[0].options.env;
  if (expected.pathPrefix) assert.ok((env.PATH ?? env.Path).startsWith(`${expected.pathPrefix};`));
});

test('both production modes receive only project tools and the same native web tools without duplicate hooks', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-kiro-web-config-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const mode of ['baseline', 'qloo']) {
    const home = await prepareKiroWorkspace({ directory: path.join(directory, mode), config: { rootDir: path.resolve(import.meta.dirname, '..') },
      model: 'fixed-test-model', bridgeUrl: 'http://127.0.0.1:8787/internal/tools', bridgeToken: 'fixture-mcp-token', webBridgeToken: 'fixture-host-only-token', mode });
    const agent = JSON.parse(await fs.readFile(path.join(home, 'agents', 'culture-demo.json'), 'utf8'));
    assert.deepEqual(agent.tools, ['@culture', 'web_search', 'web_fetch']);
    assert.deepEqual(agent.allowedTools, agent.tools);
    assert.deepEqual(agent.resources, []);
    assert.equal(agent.includeMcpJson, false);
    assert.equal(agent.includePowers, false);
    assert.equal(agent.hooks, undefined, 'A future native hook must not double-count the private session observer.');
    await assert.rejects(fs.stat(path.join(directory, mode, '.kiro', 'hooks', 'culture-web-research.json')), { code: 'ENOENT' });
    assert.doesNotMatch(JSON.stringify(agent), /fixture-host-only-token/u);
    assert.equal(agent.mcpServers.culture.env.CULTURE_BRIDGE_TOKEN, 'fixture-mcp-token');
  }
});

test('preparation cannot inherit native web access or host hook credentials', async t => {
  const f = await fixture(t, child => child.emit('close', 0), { input: { kind: 'prepare', webBridgeToken: 'fixture-host-only-token' } });
  await runKiro(f.input);
  const agent = JSON.parse(await fs.readFile(path.join(f.directory, '.kiro', 'agents', 'culture-demo.json'), 'utf8'));
  assert.deepEqual(agent.tools, ['@culture']);
  assert.deepEqual(agent.allowedTools, ['@culture']);
  assert.equal(agent.hooks, undefined);
  await assert.rejects(fs.stat(path.join(f.directory, '.kiro', 'hooks', 'culture-web-research.json')), { code: 'ENOENT' });
  assert.equal(f.spawns[0].options.env.CULTURE_WEB_BRIDGE_TOKEN, undefined);
  assert.equal(f.spawns[0].options.env.CULTURE_WEB_BRIDGE_URL, undefined);
});

test('the private native observer registers before launch and its token never reaches the child environment', async t => {
  let observer;
  const f = await fixture(t, child => child.emit('close', 0), { input: { webBridgeToken: 'fixture-host-only-token', registerNativeResearchSync: sync => { observer = sync; } } });
  await runKiro(f.input);
  assert.equal(typeof observer, 'function');
  assert.equal(f.spawns[0].options.env.CULTURE_WEB_BRIDGE_TOKEN, undefined);
  assert.equal(f.spawns[0].options.env.CULTURE_WEB_BRIDGE_URL, undefined);
  assert.doesNotMatch(JSON.stringify(f.spawns[0].options.env), /fixture-host-only-token/u);
  assert.doesNotMatch(f.spawns[0].args.join(' '), /fixture-host-only-token/u);
});

for (const code of [3221225786, -1073741510]) {
  test(`runner explains Windows console interruption for exit ${code}`, async t => {
    const f = await fixture(t, child => child.emit('close', code));
    await assert.rejects(runKiro(f.input), /interrupted.*Windows console/i);
    assert.equal(f.spawns.length, 1, 'Interruption must not trigger a paid automatic retry.');
    assert.equal(f.child.killCalls, 0);
  });
}

test('runner preserves ordinary nonzero exit diagnostics and redacts credentials', async t => {
  const f = await fixture(t, child => {
    child.stderr.write('\u001b[31mfixture-qloo-secret failed\u001b[0m');
    child.emit('close', 2);
  });
  await assert.rejects(runKiro(f.input), error => {
    assert.match(error.message, /failed \(exit 2\)/);
    assert.match(error.message, /\[redacted\] failed/);
    assert.doesNotMatch(error.message, /fixture-qloo-secret|\u001b/);
    return true;
  });
});

test('explicit cancellation kills the owned child and is not reported as console interruption', async t => {
  const controller = new AbortController();
  const f = await fixture(t, () => controller.abort(), { input: { signal: controller.signal } });
  await assert.rejects(runKiro(f.input), { message: 'The job was cancelled.' });
  assert.equal(f.child.killCalls, 1);
  assert.equal(f.child.unrefCalls, 0);
});

test('completed runner removes its cancellation listener', async t => {
  const controller = new AbortController();
  const f = await fixture(t, child => child.emit('close', 0), { input: { signal: controller.signal } });
  await runKiro(f.input);
  controller.abort();
  assert.equal(f.child.killCalls, 0);
});

test('runner timeout kills the owned child and retains its distinct diagnostic', async t => {
  const f = await fixture(t, () => {}, { config: { runTimeoutMs: 20 } });
  await assert.rejects(runKiro(f.input), { message: 'The Kiro run reached its time limit.' });
  assert.equal(f.child.killCalls, 1);
  assert.equal(f.child.unrefCalls, 0);
});

test('host waits such as image generation pause the run deadline instead of spending model time', async t => {
  let wait;
  const f = await fixture(t, child => {
    wait.pause(); wait.pause();
    setTimeout(() => { wait.resume(); setTimeout(() => { wait.resume(); setTimeout(() => child.emit('close', 0), 5); }, 40); }, 60);
  }, { config: { runTimeoutMs: 40 }, input: { registerHostWait: value => { wait = value; } } });
  assert.deepEqual(await runKiro(f.input), { exitCode: 0 }, 'Nested waits of about 100 ms did not count against a 40 ms deadline.');
  assert.equal(f.child.killCalls, 0);
  // The remaining time still applies once every wait has ended.
  let later;
  const g = await fixture(t, () => { later.pause(); setTimeout(() => later.resume(), 30); }, { config: { runTimeoutMs: 40 }, input: { registerHostWait: value => { later = value; } } });
  await assert.rejects(runKiro(g.input), { message: 'The Kiro run reached its time limit.' });
  assert.equal(g.child.killCalls, 1);
});

test('runner output limit kills the owned child and retains its distinct diagnostic', async t => {
  const f = await fixture(t, child => child.stdout.write(Buffer.alloc(4_001, 120)), { input: { outputLimits: { line: 1_000, total: 4_000 } } });
  await assert.rejects(runKiro(f.input), { message: 'The Kiro run exceeded its output limit.' });
  assert.equal(f.child.killCalls, 1);
  assert.equal(f.spawns.length, 1);
});

test('an image the read tool echoes as one very long line is skipped, and the run goes on to its tool titles', async t => {
  // kiro-cli 2.24 writes each update under data.update and echoes an opened image as its bytes in a JSON array.
  const echo = JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', status: 'completed', title: 'Reading images', rawOutput: { items: [{ Image: { source: { data: Array.from({ length: 2_000_000 }, () => 137) } } }] } } } });
  const start = JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', title: 'Running: @culture/project_capture_review' } } });
  const f = await fixture(t, child => { child.stdout.write(`${start}\n${echo}\n${start}\n`); child.emit('close', 0); });
  assert.ok(echo.length > 4_000_000);
  assert.deepEqual(await runKiro(f.input), { exitCode: 0 });
  assert.equal(f.child.killCalls, 0);
  assert.deepEqual(f.events.map(event => event.message), ['Running: @culture/project_capture_review', 'Running: @culture/project_capture_review']);
});

test('already cancelled requests never launch a Kiro child', async t => {
  const controller = new AbortController();
  controller.abort();
  const f = await fixture(t, () => {}, { input: { signal: controller.signal } });
  await assert.rejects(runKiro(f.input), { message: 'The job was cancelled.' });
  assert.equal(f.spawns.length, 0);
});

test('cancellation during workspace preparation prevents subsequent child launch', async t => {
  const controller = new AbortController();
  const f = await fixture(t, () => {}, { input: { signal: controller.signal } });
  const rootDir = f.config.rootDir;
  // Agent configuration reads rootDir after asynchronous workspace setup begins.
  Object.defineProperty(f.config, 'rootDir', { get() { controller.abort(); return rootDir; } });
  await assert.rejects(runKiro(f.input), { message: 'The job was cancelled.' });
  assert.equal(f.spawns.length, 0);
});

test('runner startup errors remain distinct from Windows console interruption', async t => {
  const f = await fixture(t, child => child.emit('error', Object.assign(new Error('fixture missing'), { code: 'ENOENT' })));
  await assert.rejects(runKiro(f.input), { message: 'Kiro CLI not found.' });
  assert.equal(f.spawns.length, 1);
});

test('both build modes receive considered application planning and the same protected additive interaction capability', () => {
  const input = { template: { name: 'Test-only game', description: 'A factual static game introduction.' }, brief: 'Explain the existing game to visitors.', cultureBrief: { brand: { protectedFiles: ['app.js'] }, audiences: [] } };
  for (const mode of ['baseline', 'qloo']) {
    const prompt = makeDesignPrompt({ ...input, mode });
    assert.match(prompt, /tentative product-first approach/u);
    assert.match(prompt, /AFTER reconsideration and BEFORE writing any website file or revision artifact, save the considered application plan/u);
    assert.match(prompt, /BEFORE any Qloo call, web_search\/web_fetch call or website write save culture-plan\.json/u);
    assert.match(prompt, /Account for EVERY provisional decision exactly once/u);
    assert.match(prompt, /Maximum SIX TOTAL web tool calls/u);
    assert.match(prompt, /Both comparison modes have the SAME native web_search and web_fetch capabilities/u);
    assert.match(prompt, /retain the same application/u);
    assert.match(prompt, /small local experience\.js.*either mode/u);
    assert.match(prompt, /protectedFiles byte-for-byte/u);
    assert.match(prompt, /every existing script-bound element ID and catalogue data intact/u);
    assert.match(prompt, /No minimum number of cultural changes is required/u);
    assert.doesNotMatch(prompt, /improve only HTML presentation and CSS/u);
  }
  const baseline = makeDesignPrompt({ ...input, mode: 'baseline' });
  assert.match(baseline, /same freedom to develop useful content, structure and interactions/u);
  assert.match(baseline, /Use anchors:\[\] for baseline/u);
  const qloo = makeDesignPrompt({ ...input, mode: 'qloo' });
  assert.match(qloo, /at most two relevant result domains.*at most one follow-up/u);
  assert.match(qloo, /broad descriptors simply echo the brief/u);
  assert.match(qloo, /A name or affinity alone cannot substantiate/u);
});

test('planning-only and scoped revision prompts preserve their existing artifact permissions', () => {
  const input = { template: { name: 'Test-only project', description: 'A factual product.' }, brief: 'Improve the introduction.', mode: 'qloo', targetSelector: '#hero', targetHtml: '<section id="hero">Existing facts</section>' };
  const plan = makeDesignPrompt({ ...input, kind: 'plan' });
  assert.match(plan, /save ONLY culture-plan\.json, culture-reconsideration\.json, culture-directions\.json, culture-decisions\.json and culture-research\.json/u);
  assert.match(plan, /In planning-only work, retain considered/u);
  assert.match(plan, /Do not generate a website in this phase/u);
  const revision = makeDesignPrompt({ ...input, kind: 'revise' });
  assert.match(revision, /Do NOT write any site file/u);
  assert.match(revision, /No script\/style\/iframe\/object\/form elements/u);
  assert.match(revision, /save the considered application plan/u);
  assert.doesNotMatch(revision, /You may add a small local experience\.js/u);
});
