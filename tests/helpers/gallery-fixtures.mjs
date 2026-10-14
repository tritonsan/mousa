// A recorded run as scripts/run-claude-code-live.mjs leaves one, made from fixtures: a measured design session in
// project/, a stream whose tool calls carry a local path, a command and an artifact the gallery must never publish,
// the summary and the request. No model, Qloo or browser is used.
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { qlooFixture, parse, reportServer, measuredSession } from './mousa-fixtures.mjs';

export const RUN_NAME = 'claude-code-fixture-1';
export const PRIVATE = Object.freeze({ path: 'D:\\mousa-live\\private\\notes.md', command: 'cat .env && echo fixture-secret-value', guess: 'my private fixture reasoning' });
const iso = ms => new Date(ms).toISOString();

/** The run folder `RUN_NAME` inside `runsDir`; `leak` writes that text into a public file of the design. */
export async function fixtureRun(runsDir, { leak = null } = {}) {
  const root = path.join(runsDir, RUN_NAME), project = path.join(root, 'project');
  await mkdir(project, { recursive: true });
  const config = await mkdtemp(path.join(os.tmpdir(), 'mousa-gallery-config-'));
  try {
    const { fetchImpl } = qlooFixture();
    const mousa = reportServer(project, config, fetchImpl);
    await measuredSession(async (name, args) => parse(await mousa.callTool(name, args)), project);
  } finally { await rm(config, { recursive: true, force: true }); }
  if (leak) await writeFile(path.join(project, 'about.txt'), `Notes: ${leak}`);
  const start = Date.parse('2026-10-13T10:00:00.000Z');
  const use = (at, id, name, input) => ({ type: 'assistant', timestamp: iso(start + at * 1000), parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (at, id, text, isError = false) => ({ type: 'user', timestamp: iso(start + at * 1000), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text }] }] } });
  const lines = [
    { type: 'system', subtype: 'init', claude_code_version: '2.1.284', model: 'claude-opus-5-5', cwd: PRIVATE.path },
    use(0, 't1', 'mcp__plugin_mousa_mousa__mousa_status', {}), result(1, 't1', JSON.stringify({ status: 'ready', version: '0.6.0', project: { folder: PRIVATE.path } })),
    use(4, 't2', 'Read', { file_path: PRIVATE.path }), result(5, 't2', 'private file text'),
    use(6, 't3', 'Read', { file_path: 'index.html' }), result(6, 't3', 'more text'),
    use(9, 't4', 'Bash', { command: PRIVATE.command }), result(10, 't4', 'output', true),
    use(12, 't5', 'mcp__plugin_mousa_mousa__taste_profile', { dryRun: true, references: [{ name: 'Paterson' }] }), result(13, 't5', JSON.stringify({ status: 'planned' })),
    use(20, 't6', 'mcp__plugin_mousa_mousa__design_validate', { stage: 'dna', artifact: { thesis: PRIVATE.guess } }),
    result(21, 't6', JSON.stringify({ status: 'error', error: { code: 'TASTE_PROTOCOL_INVALID', message: `dna.devices[0]: ${PRIVATE.guess}` } })),
    use(30, 't7', 'mcp__plugin_mousa_mousa__design_validate', { stage: 'dna', artifact: {} }), result(31, 't7', JSON.stringify({ status: 'valid' })),
    use(40, 't8', 'Write', { file_path: 'index.html', content: PRIVATE.guess }), result(41, 't8', 'written'),
  ];
  await writeFile(path.join(root, 'session.jsonl'), `${lines.map(line => JSON.stringify(line)).join('\n')}\n`);
  await writeFile(path.join(root, 'summary.json'), JSON.stringify({ startedAt: iso(start), minutes: 4.2, exitCode: 0, project, init: { model: 'claude-opus-5-5' }, result: { turns: 12 } }));
  await writeFile(path.join(root, 'brief.md'), 'Design a test-only pantry site for people who love slow films and lo-fi music.\n');
  return { root, project };
}

export const fixtureConfig = () => ({ schemaVersion: '1.0', featured: 'fixture-pantry', vote: [], entries: [{ id: 'fixture-pantry', run: RUN_NAME, title: 'A test-only pantry', summary: 'Fixture session.' }] });
