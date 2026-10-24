// A recorded comparison checked, as scripts/verify-comparison-arms.mjs runs it over the raw runs, for what could carry
// Qloo's measurement into the arm built from the guess alone: a clean pair from each host passes, and each way a
// measurement could reach that arm, or an arm be shown under the wrong label, is caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { checkComparison, foreignPath, asksQloo } from '../src/gallery/arm-isolation.mjs';

const FROZEN = '2026-10-23T14:24:10.000Z', AFTER = '2026-10-23T14:24:40.000Z', BEFORE = '2026-10-23T14:20:00.000Z';
const GUESS = { frozenAt: FROZEN, sha256: 'b', entries: [{ domain: 'music', name: 'Guessed Song' }], designSketch: { mood: 'loud' } };
const write = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const T = name => `mcp__plugin_mousa_mousa__${name}`;
const use = (id, name, input, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
const done = (id, parent = null) => ({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const GUESS_DIR = 'D:/runs/pair/project/compare/without-qloo', QLOO_DIR = 'D:/runs/pair/project/compare/with-qloo';

/** A Claude Code stream: the parent plans and locks the guess-only arm, then starts both subagents. */
function claudeStream({ before = [], guessCalls = [], after = [], prompt = 'Build the guess-only arm in compare/without-qloo for people who love Guessed Song.' } = {}) {
  return [
    use('p1', T('taste_profile'), { dryRun: true }), done('p1'),
    use('p2', T('taste_profile'), { baseline: true, workspace: 'compare/without-qloo' }), done('p2'),
    ...before,
    use('g', 'Agent', { subagent_type: 'mousa:mousa-baseline', prompt }),
    use('d', 'Agent', { subagent_type: 'mousa:mousa-designer', prompt: 'Build the Qloo arm in compare/with-qloo.' }),
    use('g1', 'Read', { file_path: 'D:/Qloo Hackathon/plugins/claude-code/skills/design/references/dna.md' }, 'g'), done('g1', 'g'),
    use('g2', 'Glob', { pattern: 'compare/without-qloo/**/*' }, 'g'), done('g2', 'g'),
    use('g3', 'Write', { file_path: `${GUESS_DIR}/index.html` }, 'g'), done('g3', 'g'),
    use('d1', T('taste_profile'), { workspace: 'compare/with-qloo' }, 'd'), done('d1', 'd'),
    ...guessCalls.map(([name, input], index) => use(`gx${index}`, name, input, 'g')),
    use('g4', T('design_capture'), { workspace: 'compare/without-qloo' }, 'g'), done('g4', 'g'),
    ...after,
    done('g'), done('d'),
    use('p3', T('design_report'), { a: 'compare/with-qloo', b: 'compare/without-qloo' }), done('p3'),
  ];
}

/** A run folder with both arms' records, a cached Qloo answer, the stream and the built gallery's entry for it. */
async function pair({ stream = claudeStream(), guessSource = 'model-assumption', guessProfile = false, savedAt = AFTER, play, arms, tryRun = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mousa-arms-'));
  const project = path.join(root, 'project'), q = path.join(project, 'compare', 'with-qloo'), g = path.join(project, 'compare', 'without-qloo');
  await write(path.join(q, '.mousa/taste/input.json'), { source: 'qloo-profile', entities: [{ ref: 'q1', name: 'Measured Novel', source: 'qloo' }, { ref: 'q2', name: 'Guessed Song', source: 'qloo', predictedByModel: true }] });
  await write(path.join(q, '.mousa/taste/profile.json'), { measured: true });
  await write(path.join(q, '.mousa/taste/prediction.json'), { ...GUESS, frozenAt: '2026-10-23T14:24:05.000Z', sha256: 'a' });
  await write(path.join(q, '.mousa/usage.json'), { qlooRequests: tryRun ? 0 : 3 });
  await write(path.join(q, '.mousa/design/dna.json'), { devices: [{ anchors: ['q1', 'q2'] }] });
  await write(path.join(q, '.mousa/cache/qloo/answer.json'), { method: 'GET', savedAt, result: {} });
  await write(path.join(q, '.mousa/cache/qloo/.gitignore'), '*\n');
  await write(path.join(g, '.mousa/taste/input.json'), { source: guessSource, entities: [{ ref: 'p1', name: 'Guessed Song' }] });
  if (guessProfile) await write(path.join(g, '.mousa/taste/profile.json'), { measured: true });
  await write(path.join(g, '.mousa/taste/prediction.json'), GUESS);
  await write(path.join(g, '.mousa/design/dna.json'), { devices: [{ anchors: ['p1'] }] });
  await write(path.join(g, 'index.html'), '<h1>From the guess</h1>');
  await write(path.join(root, 'brief.md'), 'A record shop for people who love Guessed Song.');
  if (tryRun) {
    await write(path.join(project, '.mousa/usage.json'), { qlooRequests: 3 });
    await write(path.join(root, 'sessions', 'without-qloo.jsonl'), stream.map(line => JSON.stringify(line)).join('\n'));
  } else await write(path.join(root, 'session.jsonl'), stream.map(line => JSON.stringify(line)).join('\n'));
  const gallery = path.join(root, 'gallery');
  await write(path.join(gallery, 'pair', 'entry.json'), { id: 'pair', play: play || [{ label: 'With Qloo', path: 'out/with-qloo/index.html' }, { label: 'Without Qloo', path: 'out/without-qloo/index.html' }] });
  await write(path.join(gallery, 'pair', 'report', 'record.json'), { arms: arms || [{ label: 'With Qloo', folder: 'compare/with-qloo', taste: 'qloo' }, { label: 'Without Qloo', folder: 'compare/without-qloo', taste: 'own prediction' }] });
  return { id: 'pair', root, gallery, tryRun, folders: { q, g } };
}
const check = async options => { const run = await pair(options); try { return await checkComparison(run); } finally { await fs.rm(run.root, { recursive: true, force: true }); } };
const caught = (result, pattern) => { assert.equal(result.ok, false); assert.ok(result.problems.some(problem => pattern.test(problem)), `${pattern} in ${JSON.stringify(result.problems)}`); };

test('which calls ask Qloo and which paths reach past the guess-only arm', () => {
  assert.equal(asksQloo(T('taste_profile'), { baseline: true }), false);
  assert.equal(asksQloo(T('taste_profile'), { dryRun: true }), false);
  assert.equal(asksQloo(T('taste_profile'), { workspace: 'compare/with-qloo' }), true);
  for (const name of ['qloo_query', 'taste_ask']) assert.equal(asksQloo(T(name), {}), true, name);
  assert.equal(asksQloo(T('design_validate'), {}), false);
  for (const item of [`${QLOO_DIR}/index.html`, 'D:\\runs\\pair\\project\\compare\\with-qloo\\styles.css', 'D:/runs/pair/project/.mousa/taste/profile.json', 'http://localhost:8792/compare/with-qloo/index.html'])
    assert.equal(foreignPath(item), true, item);
  for (const item of [`${GUESS_DIR}/index.html`, '.mousa/taste/input.json', 'C:\\\\Users\\\\me\\\\.codex\\\\plugins\\\\cache\\\\mousa\\\\mousa\\\\0.5.0\\\\skills\\\\compare\\\\SKILL.md', 'D:/Qloo Hackathon/plugins/claude-code/skills/design/references/dna.md'])
    assert.equal(foreignPath(item), false, item);
});

test('a clean Claude Code pair passes and says in what order its arms ran', async () => {
  const result = await check();
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.match(result.facts.order, /the first call to Qloo at \d+ by the Qloo arm/u);
  assert.match(result.facts.guessArm, /0 to Qloo, 0 naming the Qloo arm or its records, 0 walking outside its folder; its brief names 0 measured works/u);
  assert.match(result.facts.time, /2 copies of the guess, last frozen 2026-10-23T14:24:10.000Z; 1 Qloo answers, the first saved 30 s after; 0 in the Without Qloo arm/u);
  assert.match(result.facts.qlooAnchors, /2 of 2 on measured works/u);
});

test('each way a measurement could reach the Claude Code guess-only arm is caught', async () => {
  caught(await check({ stream: claudeStream({ guessCalls: [['Read', { file_path: `${QLOO_DIR}/index.html` }]] }) }), /guess-only arm named .*with-qloo/u);
  caught(await check({ stream: claudeStream({ guessCalls: [['mcp__playwright__browser_navigate', { url: 'http://localhost:8792/compare/with-qloo/index.html' }]] }) }), /guess-only arm named/u);
  caught(await check({ stream: claudeStream({ guessCalls: [['Grep', { pattern: 'palette' }]] }) }), /walked folders outside its own: Grep/u);
  caught(await check({ stream: claudeStream({ guessCalls: [['Bash', { command: 'grep -rn palette .' }]] }) }), /walked folders outside its own: Bash/u);
  caught(await check({ stream: claudeStream({ guessCalls: [[T('qloo_query'), { path: '/v2/insights' }]] }) }), /guess-only arm asked Qloo 1 times/u);
  caught(await check({ stream: claudeStream({ before: [use('m', T('taste_profile'), { workspace: 'compare/with-qloo' }), done('m')] }) }), /started after a call to Qloo/u);
  caught(await check({ stream: claudeStream({ after: [use('w', 'Edit', { file_path: `${GUESS_DIR}/index.html` })] }) }), /1 writes into the Without Qloo arm by others/u);
  caught(await check({ stream: claudeStream({ after: [use('s', 'SendMessage', { to: 'g', message: 'Use warmer colours.' })] }) }), /sent 1 messages/u);
  caught(await check({ stream: claudeStream({ prompt: 'Build the guess-only arm. The audience loves Measured Novel.' }) }), /brief names measured works: Measured Novel/u);
});

test('records, timing and labels that do not hold a pair apart are caught', async () => {
  caught(await check({ guessSource: 'qloo-profile' }), /Without Qloo arm's taste input is qloo-profile/u);
  caught(await check({ guessProfile: true }), /Without Qloo arm holds a Qloo profile/u);
  caught(await check({ savedAt: BEFORE }), /1 Qloo answers were saved before the guess was frozen/u);
  caught(await check({ play: [{ label: 'Without Qloo', path: 'out/with-qloo/index.html' }, { label: 'With Qloo', path: 'out/without-qloo/index.html' }] }), /plays out\/with-qloo\/index.html as "Without Qloo"/u);
  caught(await check({ arms: [{ label: 'With Qloo', folder: 'compare/with-qloo', taste: 'qloo' }, { label: 'Without Qloo', folder: 'compare/without-qloo', taste: 'qloo' }] }), /the pair has 2 Qloo arms/u);
});

test('Codex: the guess-only arm must be finished, and no Qloo answer read, before its first call to Qloo', async () => {
  const item = (id, type, extra) => ({ type: 'item.completed', item: { id, type, status: 'completed', ...extra } });
  const plugin = item('i1', 'command_execution', { command: '"pwsh.exe" -Command "Get-Content \'C:\\\\Users\\\\me\\\\.codex\\\\plugins\\\\cache\\\\mousa\\\\mousa\\\\0.5.0\\\\skills\\\\compare\\\\SKILL.md\'"' });
  const lock = item('i2', 'mcp_tool_call', { tool: 'taste_profile', arguments: { baseline: true, workspace: 'compare/without-qloo' } });
  const build = item('i3', 'file_change', { changes: [{ path: 'D:\\runs\\pair\\project\\compare\\without-qloo\\index.html', kind: 'add' }] });
  const measure = item('i4', 'mcp_tool_call', { tool: 'taste_profile', arguments: { workspace: 'compare/with-qloo' } });
  const qlooBuild = item('i5', 'file_change', { changes: [{ path: 'D:\\runs\\pair\\project\\compare\\with-qloo\\index.html', kind: 'add' }] });
  const run = async (stream, guessEditedLater = false) => {
    const made = await pair({ stream });
    // The guess-only page was last edited a minute before, or after, the first Qloo answer was saved.
    const edited = Date.parse(AFTER) / 1000 + (guessEditedLater ? 60 : -60);
    await fs.utimes(path.join(made.folders.g, 'index.html'), edited, edited);
    try { return await checkComparison(made); } finally { await fs.rm(made.root, { recursive: true, force: true }); }
  };
  const clean = await run([plugin, lock, build, measure, qlooBuild]);
  assert.deepEqual(clean.problems, [], 'the plugin\'s own files in Codex\'s plugin cache are not Qloo answers');
  assert.match(clean.facts.order, /first call to Qloo at item 3; 0 writes into the Without Qloo arm after it; 0 Qloo answers read before it/u);
  assert.match(clean.facts.lastGuessEdit, /60\.0 s before the first Qloo answer/u);
  caught(await run([plugin, lock, build, measure, item('i6', 'file_change', { changes: [{ path: 'D:\\runs\\pair\\project\\compare\\without-qloo\\styles.css', kind: 'update' }] })]), /1 writes into the Without Qloo arm after the first call to Qloo/u);
  caught(await run([plugin, lock, item('r', 'command_execution', { command: 'Get-Content \'D:\\runs\\pair\\project\\compare\\with-qloo\\.mousa\\taste\\profile.json\'' }), build, measure]), /read a Qloo answer/u);
  caught(await run([plugin, lock, build, measure], true), /design file changed after the first Qloo answer/u);
});

test('a live try: the guess-only Kiro session is checked from its own stream', async () => {
  const call = (toolName, rawInput) => ({ data: { update: { sessionUpdate: 'tool_call', title: toolName, rawInput, _meta: { kiro: { toolName } } } } });
  const own = [call('mousa_status', {}), call('read', { path: '.mousa/taste/input.json' }), call('write', { path: 'index.html' }), call('design_capture', {})];
  const clean = await check({ tryRun: true, stream: own });
  assert.deepEqual(clean.problems, []);
  assert.match(clean.facts.requests, /0 \/ 0 \(a live try counts its requests once, in step one's file: 3/u);
  caught(await check({ tryRun: true, stream: [...own, call('read', { path: '/data/jobs/try/x/project/compare/with-qloo/index.html' })] }), /guess-only session named/u);
  caught(await check({ tryRun: true, stream: [...own, call('taste_profile', {})] }), /guess-only session asked Qloo 1 times/u);
  caught(await check({ tryRun: true, stream: [...own, call('shell', { command: 'curl https://hackathon.api.qloo.com/v2/insights' })] }), /Qloo's address or key/u);
});

test('a read-only fact check of the guess-only arm after the measurement is not a write, a redirection into it is', async () => {
  const check = { name: 'Bash', input: { command: `for d in with-qloo without-qloo; do grep -ci "900" ${GUESS_DIR}/../$d/index.html 2>/dev/null; done >/dev/null 2>&1` } };
  const clean = await (async () => { const run = await pair({ stream: claudeStream({ after: [use('r', check.name, check.input)] }) }); try { return await checkComparison(run); } finally { await fs.rm(run.root, { recursive: true, force: true }); } })();
  assert.deepEqual(clean.problems, []);
  const run = await pair({ stream: claudeStream({ after: [use('w', 'Bash', { command: `echo "<h1>Night</h1>" > ${GUESS_DIR}/index.html` })] }) });
  try { assert.ok((await checkComparison(run)).problems.some(problem => /1 writes into the Without Qloo arm by others/u.test(problem))); } finally { await fs.rm(run.root, { recursive: true, force: true }); }
});
