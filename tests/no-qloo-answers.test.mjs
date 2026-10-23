// Qloo's developer guide asks that its response data never sit in a public repository, and this one is public. No
// tracked file holds a Qloo entity id (Qloo writes them as uppercase UUIDs; the two recorded runs kept here carry
// synthetic stand-ins), and no tracked JSON outside the game's replay fixtures holds an entity Qloo scored. A live
// run's records stay in output/ or in a run folder .gitignore keeps out.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QLOO_ID = /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/gu;
// The recorded runs' stand-ins (00000000-0000-4000-8000-…) and the tests' repeated-digit ids (11111111-1111-4111-…).
const SYNTHETIC = [/^00000000-0000-4000-8000-[0-9A-F]{12}$/u, /^([0-9A-F])\1{7}-\1{4}-[0-9A-F]\1{3}-[0-9A-F]\1{3}-\1{12}$/u];
const TEXT = /\.(json|jsonl|md|html|txt|csv|mjs|js|css|svg|ya?ml|sh|py)$/u;
// The game's replay fixtures (fixture: true) carry fixture ids and invented scores; the tests build their own.
const FIXTURES = ['game/runs/dry-run/', 'tests/', 'game/tests/'];

/** The tracked files, or null outside a git checkout (an unpacked archive has nothing to compare). */
function tracked() {
  try { return execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean); }
  catch { return null; }
}

test('no tracked file holds a Qloo entity id', async t => {
  const files = tracked();
  if (!files) return t.skip('not a git checkout');
  const found = [];
  for (const file of files.filter(name => TEXT.test(name))) {
    const text = await fs.readFile(path.join(repo, ...file.split('/')), 'utf8').catch(() => '');
    const ids = (text.match(QLOO_ID) || []).filter(id => !SYNTHETIC.some(pattern => pattern.test(id)));
    if (ids.length) found.push(`${file} (${ids.length})`);
  }
  assert.deepEqual(found, [], 'Qloo ids stay in output/ or an ignored run folder, never in the public repository');
});

test('no tracked JSON outside the replay fixtures holds an entity Qloo scored', async t => {
  const files = tracked();
  if (!files) return t.skip('not a git checkout');
  const found = [];
  for (const file of files.filter(name => name.endsWith('.json') && !FIXTURES.some(prefix => name.startsWith(prefix)))) {
    let data;
    try { data = JSON.parse(await fs.readFile(path.join(repo, ...file.split('/')), 'utf8')); } catch { continue; }
    let scored = 0;
    (function walk(value) {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== 'object') return;
      if (['affinity', 'popularity', 'confirmedAffinity'].some(key => typeof value[key] === 'number')) scored += 1;
      Object.values(value).forEach(walk);
    })(data);
    if (scored) found.push(`${file} (${scored})`);
  }
  assert.deepEqual(found, [], 'a scored entity is Qloo\'s answer: keep it out of the public repository');
});

test('the two recorded runs kept here are ignored for anything new', async () => {
  const ignored = file => {
    try { execFileSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: repo }); return true; } catch { return false; }
  };
  for (const file of ['game/runs/pair-20991231-000000/taste.json', 'examples/mobile-app-run-2099-12-31T00-00-00-000Z/culture-taste.json', 'game/runs/pair-20261004-210303/work/qloo-on/kiro-home/x.json']) {
    assert.ok(ignored(file), `${file} would be committed`);
  }
  assert.ok(!ignored('game/runs/dry-run/taste.json'), 'the replay fixtures stay tracked');
});
