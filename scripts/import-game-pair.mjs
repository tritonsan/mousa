// Imports a character pair recorded with the command-line runner (game/runs/<pair-id>) into the Studio as a completed
// character job, so the Game character view can list and play it. It copies the pair record, the taste pass, both
// characters, the published portraits, painted pieces and review captures; the work folders (prompts, design sessions,
// Kiro homes) stay in game/runs.
// It makes no request. The Studio reads jobs when it starts, so restart it afterwards.
//
//   node scripts/import-game-pair.mjs game/runs/pair-20261004-210303 [--force]

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { CHARACTER_KIND, PAIR_ID, pairSummary } from '../src/character-jobs.mjs';
import { ARMS, SWAP_ARMS } from '../game/harness/run-pair.mjs';

loadDotEnv();
const config = getConfig();
const source = process.argv.slice(2).find(item => !item.startsWith('--'));
if (!source) {
  console.log('Usage: node scripts/import-game-pair.mjs game/runs/<pair-id> [--force]. Copies a completed pair into the Studio; makes no request.');
  process.exit(1);
}
const sourceDir = path.resolve(config.rootDir, source);
const pair = JSON.parse(await fs.readFile(path.join(sourceDir, 'pair.json'), 'utf8'));
if (pair.schemaVersion !== '1.0' || !Array.isArray(pair.arms) || pair.arms.length !== 2 || !PAIR_ID.test(pair.pairId || '') || path.basename(sourceDir) !== pair.pairId) {
  throw new Error(`${source} does not hold a pair record whose ID matches its folder.`);
}
if (pair.status !== 'completed') throw new Error(`${pair.pairId} did not complete (${pair.status}); only completed pairs can be played.`);

// One Studio job per recorded pair, unless --force asks for another copy.
for (const item of await fs.readdir(config.dataDir, { withFileTypes: true }).catch(() => [])) {
  if (!item.isDirectory()) continue;
  const meta = await fs.readFile(path.join(config.dataDir, item.name, 'meta.json'), 'utf8').then(JSON.parse, () => null);
  if (meta?.kind === CHARACTER_KIND && meta.imported?.pairId === pair.pairId && !process.argv.includes('--force')) {
    console.log(`${pair.pairId} is already in the Studio as job ${meta.id}. Pass --force to import another copy.`);
    process.exit(0);
  }
}

const id = crypto.randomUUID();
const target = path.join(config.dataDir, id, pair.pairId);
await fs.mkdir(target, { recursive: true });
const portraits = pair.arms.flatMap(arm => (arm.portraits || []).map(item => item.path)).filter(file => typeof file === 'string' && file.startsWith(`runs/${pair.pairId}/`)).map(file => path.basename(file));
// A swap pair's arms are Qloo on and the swapped profile.
const arms = pair.protocol?.swap ? SWAP_ARMS : ARMS;
// A painted arm brings its pieces, named in its character file's skin, and its standing figure.
const painted = [];
for (const arm of arms) {
  const character = JSON.parse(await fs.readFile(path.join(sourceDir, `${arm.key}.json`), 'utf8').catch(() => 'null'));
  const skin = character?.skin;
  if (skin) painted.push(...[...skin.images, ...(skin.cloth || []), ...(skin.tips || [])].map(item => item.src).filter(src => src.startsWith(`runs/${pair.pairId}/`)).map(src => path.basename(src)));
  const figure = pair.arms.find(item => item.key === arm.key)?.paint?.figure;
  if (typeof figure === 'string' && figure.startsWith(`runs/${pair.pairId}/`)) painted.push(path.basename(figure));
}
// An arm with production stages brings the captures its review judged.
const captures = pair.arms.flatMap(arm => (arm.production?.captures || []).map(item => item.path)).filter(file => typeof file === 'string' && file.startsWith(`runs/${pair.pairId}/`)).map(file => path.basename(file));
const files = ['pair.json', 'taste.json', ...arms.map(arm => `${arm.key}.json`), ...portraits, ...new Set(painted), ...captures];
for (const file of files) {
  if (!/^[a-z0-9-]+\.(?:json|jpg|png)$/u.test(file)) throw new Error(`Unexpected file name in the pair record: ${file}.`);
  await fs.copyFile(path.join(sourceDir, file), path.join(target, file)).catch(error => { if (file !== 'taste.json') throw error; });
}
const job = {
  id, kind: CHARACTER_KIND, status: 'completed', createdAt: pair.createdAt, model: pair.model, effort: pair.effort, error: null,
  previewToken: crypto.randomBytes(24).toString('hex'), pairId: pair.pairId, world: 'The Long Dusk',
  brief: { name: pair.brief.name, brief: pair.brief.brief, references: pair.brief.references, knownNames: [] },
  portraitsPerArm: pair.protocol?.portraitsPerArm ?? 0, paintPerArm: pair.protocol?.paintPerArm ?? 0, images: null, required: pair.protocol?.production?.required || [],
  audience: pair.protocol?.audience || null, departure: pair.protocol?.departure !== false,
  profileFrom: pair.taste?.reusedFrom ? { from: pair.taste.reusedFrom } : null, swapFrom: pair.protocol?.swap ? { from: pair.protocol.swap.from } : null,
  ...pairSummary(pair),
  imported: { pairId: pair.pairId, from: path.relative(config.rootDir, sourceDir).split(path.sep).join('/'), importedAt: new Date().toISOString() },
  runs: arms.map(arm => {
    const recorded = pair.arms.find(item => item.key === arm.key) || {};
    return { mode: arm.mode, key: arm.key, label: arm.label, status: recorded.status || 'failed', error: recorded.error || null, durationMs: recorded.durationMs ?? null,
      events: (recorded.events || []).map(({ time, type, message }) => ({ time, type, message: String(message).slice(0, 350) })) };
  }),
};
await fs.writeFile(path.join(config.dataDir, id, 'meta.json'), JSON.stringify(job, null, 2));
console.log(`Imported ${pair.pairId} as character job ${id} (${files.length} files). Restart the Studio, then open ${`http://127.0.0.1:${config.port}/?view=game&character=${id}`}.`);
