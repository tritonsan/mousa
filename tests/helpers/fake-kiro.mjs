// A Kiro CLI stand-in for the live try's tests: it reads the agent file the try wrote into the session's KIRO_HOME,
// runs Moûsa's server from that file's own environment in this process, plays the script for the session's kind and
// writes stream-json as kiro-cli 2.24 does (tool calls named in _meta.kiro, results in rawOutput, runFinished last).
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createMousaServer } from '../../plugin/server/mcp/mousa.mjs';
import { prediction, designFor, byName, siteFiles, baselineDesign, fakeCapture, fakeShoot, parse, critiqueFor } from './mousa-fixtures.mjs';

/** The session's kind, as the agent file the try wrote describes it. */
export const sessionKind = agent => /frozen prediction/u.test(agent.description) ? 'predict' : /without Qloo/u.test(agent.description) ? 'baseline' : 'qloo';

/**
 * A spawn for runTrySession. `scripts` maps a kind (predict, qloo, baseline) to an async function of
 * {call, write, cwd, agent, prompt, stopped}; `seen` collects each session's command, folder, environment, agent and prompt.
 */
export function fakeKiro({ fetchImpl, scripts, seen = [] }) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let prompt = '', killed = false;
    child.kill = () => { killed = true; child.emit('killed'); return true; };
    child.stdin = new Writable({ write(chunk, encoding, done) { prompt += chunk; done(); } });
    child.stdin.on('finish', async () => {
      let code = 0, n = 0;
      const emit = value => child.stdout.write(`${JSON.stringify(value)}\n`);
      try {
        const agent = JSON.parse(await readFile(path.join(options.env.KIRO_HOME, 'agents', `${args[args.indexOf('--agent') + 1]}.json`), 'utf8'));
        const kind = sessionKind(agent);
        seen.push({ command, args, cwd: options.cwd, env: options.env, agent, prompt, kind });
        emit({ type: 'runStarted', data: { payloadSchema: 'acp', acpProtocolVersion: 1, engine: 'v2' } });
        const server = createMousaServer({ env: agent.mcpServers.mousa.env, ...(fetchImpl ? { fetchImpl } : {}), capture: fakeCapture, shoot: fakeShoot(), store: { read: async () => null },
          inspect: { browser: async () => ({ available: true, label: 'Test browser' }), codex: async () => ({ available: false, reason: 'Not in tests.' }) } });
        const call = async (name, input = {}) => {
          const id = `tool-${++n}`, title = `Running: @mousa/${name}`, meta = { kiro: { toolName: name, mcpServerName: 'mousa' } };
          emit({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: id, title, rawInput: { __tool_use_purpose: 'Test call' }, _meta: meta } } });
          const result = await server.callTool(name, input);
          emit({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, kind: 'other', status: 'completed', title, _meta: meta,
            rawOutput: { items: [{ Json: { content: result.content.filter(item => item.type === 'text') } }] } } } });
          return parse(result);
        };
        // The write tool, as Kiro names it; the file lands in the session's folder.
        const write = async (file, text) => {
          const id = `tool-${++n}`;
          emit({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: id, title: `Writing ${file}`, kind: 'edit', _meta: { kiro: { toolName: 'write' } } } } });
          await mkdir(path.dirname(path.join(options.cwd, ...file.split('/'))), { recursive: true });
          await writeFile(path.join(options.cwd, ...file.split('/')), text);
          emit({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, kind: 'edit', status: 'completed', title: `Writing ${file}` } } });
        };
        const stopped = () => new Promise(resolve => { if (killed) resolve(); else child.once('killed', resolve); });
        await scripts[kind]({ call, write, cwd: options.cwd, agent, prompt, stopped, killed: () => killed });
        // What kiro-cli meters as a session goes: how full the context window got and the credits so far, in its last
        // metadata event the whole total. One call of the fixture is one credit, so a test can foresee the sum.
        emit({ type: 'metadata', data: { sessionId: 'fake', contextUsagePercentage: 12.5 + n, reasoning: { support: 'alwaysOn' } } });
        emit({ type: 'metadata', data: { sessionId: 'fake', contextUsagePercentage: 10 + n, meteringUsage: Array.from({ length: n }, () => ({ value: 1, unit: 'credit', unitPlural: 'credits' })) } });
        emit({ type: 'runFinished', data: { status: 'success', stopReason: 'end_turn' } });
      } catch (error) { code = 1; child.stderr.write(String(error?.stack || error)); }
      child.stdout.end();
      setImmediate(() => child.emit('close', killed ? null : code));
    });
    return child;
  };
}

/** The prediction session as the try asks for it: the saved plan, then the frozen prediction. */
export async function predictScript({ call }) {
  assert.equal((await call('taste_profile', { dryRun: true })).status, 'planned');
  const saved = await call('design_validate', { stage: 'prediction', artifact: prediction() });
  assert.equal(saved.status, 'frozen', JSON.stringify(saved));
}

/** The arm with Qloo: the measured brief, the web design of the fixtures with its imagery drawn, a review round and the report. */
export async function qlooArmScript({ call, write, cwd }) {
  const brief = await call('taste_profile', {});
  assert.equal(brief.status, 'ok', JSON.stringify(brief).slice(0, 400));
  const input = JSON.parse(await readFile(path.join(cwd, '.mousa', 'taste', 'input.json'), 'utf8'));
  const { reading, dna, plan } = designFor(input);
  // A hosted server makes no picture, so the terrace is drawn.
  dna.devices[3].tokens = { svg: ['terrace'], ids: ['terrace-figure'] };
  plan.steps[3] = { device: 'dna4', method: 'inline-svg', cluster: 'c1', why: 'The terrace is drawn in line, in the palette.' };
  for (const [stage, artifact] of [['reading', byName(reading, input)], ['dna', byName(dna, input)], ['plan', plan]]) {
    const saved = await call('design_validate', { stage, artifact });
    assert.equal(saved.status, 'valid', JSON.stringify(saved).slice(0, 600));
  }
  const fetched = await call('materials', { action: 'fetch', fonts: ['Jost'] });
  const files = siteFiles(fetched.fontFace);
  files['index.html'] = files['index.html'].replace(/<img[^>]*>/u, '');
  for (const [name, content] of Object.entries(files)) await write(name, content);
  await call('design_check', {});
  await call('design_capture', {});
  assert.equal((await call('design_validate', { stage: 'review', artifact: { schemaVersion: '1.0', round: 1, criteria: [
    { id: 'r1', capture: 'r1-desktop', verdict: 'met', observed: 'The first screen is mist blue on sea glass, with no white ground.' },
    { id: 'r2', capture: 'r1-mobile', verdict: 'met', observed: 'The headline sits on one short line at phone width.' },
  ], summary: 'The palette and the headline land.', critique: critiqueFor(input) } })).status, 'valid');
  assert.equal((await call('design_report', { picture: false })).status, 'written');
}

/** The arm without Qloo: the prediction as its taste, a reading and DNA from it, one page, a capture and the report. */
export async function baselineArmScript({ call, write, cwd }) {
  assert.equal((await call('taste_profile', { baseline: true })).status, 'baseline');
  const own = baselineDesign(JSON.parse(await readFile(path.join(cwd, '.mousa', 'taste', 'input.json'), 'utf8')));
  for (const [stage, artifact] of [['reading', own.reading], ['dna', own.dna]]) assert.equal((await call('design_validate', { stage, artifact })).status, 'valid');
  await write('index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title><style>:root{--paper:#f3ead8;--rust:#b5653a}body{background:var(--paper);color:var(--rust);font-family:Literata,serif}</style></head><body><main><h1>Pull up a chair.</h1><section id="week-loop"></section></main></body></html>');
  await call('design_capture', {});
  assert.equal((await call('design_report', { picture: false })).status, 'written');
}
