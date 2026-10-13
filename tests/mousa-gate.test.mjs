import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decide, targetsOf, sessionOf, denial, GATED_STAGES } from '../plugin/hooks/gate.mjs';

const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'hooks', 'gate.mjs');

async function project(stages) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mousa-gate-'));
  for (const [folder, stage] of Object.entries(stages)) {
    await mkdir(path.join(root, folder, '.mousa'), { recursive: true });
    await writeFile(path.join(root, folder, '.mousa', 'session.json'), JSON.stringify({ plugin: 'mousa', stage }));
  }
  return root;
}

/** The gate as a host runs it: the event on stdin, the decision on stdout. */
function run(event) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GATE], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, out }));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => {});
    child.stdin.end(typeof event === 'string' ? event : JSON.stringify(event));
  });
}

test('the gate reads the files of a Claude Code edit and of a Codex patch', () => {
  assert.deepEqual(targetsOf({ tool_name: 'Write', tool_input: { file_path: 'D:/site/index.html', content: 'x' } }), ['D:/site/index.html']);
  assert.deepEqual(targetsOf({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'a.ipynb' } }), ['a.ipynb']);
  const patch = ['*** Begin Patch', '*** Add File: site/index.html', '+<p>Hi</p>', '*** Update File: site/styles.css', '@@', '-a', '+b',
    '*** Update File: old.css', '*** Move to: site/new.css', '*** Delete File: site/gone.js', '*** End Patch'].join('\n');
  assert.deepEqual(targetsOf({ tool_name: 'apply_patch', tool_input: { command: patch } }), ['site/index.html', 'site/styles.css', 'old.css', 'site/new.css', 'site/gone.js']);
  assert.deepEqual(targetsOf({ tool_name: 'Bash', tool_input: { command: 'echo hi > a.txt' } }), [], 'shell commands are not read');
});

test('from the frozen prediction until a valid DNA, a design\'s files wait, and only there', async () => {
  const root = await project({ 'compare/with-qloo': 'measured', 'compare/without-qloo': 'specified', shop: 'planned', '.': 'read' });
  try {
    const write = file => ({ tool_name: 'Write', cwd: root, tool_input: { file_path: path.join(root, ...file.split('/')) } });
    assert.match(decide(write('compare/with-qloo/index.html')), /compare[\\/]with-qloo is at stage "measured", before a valid Design DNA.*save the reading and the Design DNA/u);
    assert.equal(decide(write('compare/without-qloo/index.html')), null, 'a valid DNA lets the build through');
    assert.equal(decide(write('shop/index.html')), null, 'before the prediction nothing is held');
    assert.match(decide(write('notes.md')), /this project is at stage "read".*save the Design DNA/u, 'the nearest session decides');
    assert.equal(sessionOf(path.join(root, 'compare', 'with-qloo', 'css', 'site.css')).stage, 'measured');
    const codex = { tool_name: 'apply_patch', cwd: path.join(root, 'compare', 'without-qloo'), tool_input: { command: '*** Begin Patch\n*** Add File: ../with-qloo/app.js\n+x\n*** End Patch' } };
    assert.match(decide(codex), /stage "measured"/u, 'a patch path is resolved from the session folder Codex reports');
    for (const stage of Object.keys(GATED_STAGES)) assert.ok(['predicted', 'measured', 'baseline', 'read'].includes(stage));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the records in .mousa are never edited by hand, at any stage', async () => {
  const root = await project({ '.': 'reviewed' });
  try {
    assert.match(decide({ tool_name: 'Edit', cwd: root, tool_input: { file_path: path.join(root, '.mousa', 'design', 'dna.json') } }), /written only by Moûsa's tools/u);
    assert.match(decide({ tool_name: 'apply_patch', cwd: root, tool_input: { command: '*** Begin Patch\n*** Update File: .mousa/taste/input.json\n*** End Patch' } }), /written only by Moûsa's tools/u);
    assert.equal(decide({ tool_name: 'Write', cwd: root, tool_input: { file_path: path.join(root, 'index.html') } }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the gate answers on stdout in the shape both hosts read, and lets through what it cannot read', async () => {
  const root = await project({ '.': 'baseline' });
  try {
    const held = await run({ hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: root, tool_input: { file_path: path.join(root, 'index.html') } });
    assert.equal(held.code, 0);
    const answer = JSON.parse(held.out);
    assert.deepEqual(Object.keys(answer.hookSpecificOutput), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
    assert.equal(answer.hookSpecificOutput.permissionDecision, 'deny');
    assert.deepEqual(denial('x').hookSpecificOutput.hookEventName, 'PreToolUse');
    for (const event of ['not json', JSON.stringify({ tool_name: 'Write' }), JSON.stringify({ tool_name: 'Write', cwd: os.tmpdir(), tool_input: { file_path: path.join(os.tmpdir(), 'free.txt') } })]) {
      const passed = await run(event);
      assert.deepEqual([passed.code, passed.out], [0, ''], event.slice(0, 40));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
