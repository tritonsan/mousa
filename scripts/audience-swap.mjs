// The audience swap: one starter designed for several audiences, each twice from its own frozen guess (with Qloo's
// measurement and from the guess alone), as the live try records them. For every two audiences it measures how far
// apart their Qloo designs are, and how far apart their guess-only designs are, with the same heuristic distance the
// comparisons use, so one can see whether the measured audiences pull the designs apart more than the guesses do.
// Exploratory: it was not pre-registered. No network, no model.
//   node scripts/audience-swap.mjs [--tries <DATA_DIR/try>] [--starter blank-site] [--json]
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { designFingerprint, compareDesignFingerprints } from '../plugin/server/culture/taste.mjs';
import { collectProjectFiles } from '../plugin/server/design/systems.mjs';

const option = (name, fallback = null) => { const at = process.argv.indexOf(name); return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback; };
loadDotEnv();
const triesDir = path.resolve(option('--tries', path.join(getConfig().dataDir, 'try')));
const starter = option('--starter', 'blank-site');

const tries = [];
for (const id of await fs.readdir(triesDir).catch(() => [])) {
  const meta = JSON.parse(await fs.readFile(path.join(triesDir, id, 'meta.json'), 'utf8').catch(() => 'null'));
  if (!meta || meta.input?.starter !== starter || meta.pair?.status !== 'done') continue;
  const arms = {};
  for (const arm of ['with-qloo', 'without-qloo']) {
    const files = await collectProjectFiles(path.join(triesDir, id, 'project', 'compare', arm)).catch(() => ({}));
    if (Object.keys(files).length) arms[arm] = designFingerprint(files);
  }
  if (arms['with-qloo'] && arms['without-qloo']) tries.push({ id: id.slice(0, 8), audience: (meta.input.references || []).join(' and '), arms });
}
const distance = (a, b) => compareDesignFingerprints(a, b).overall;
const within = tries.map(item => ({ audience: item.audience, distance: distance(item.arms['with-qloo'], item.arms['without-qloo']) }));
const across = [];
for (let i = 0; i < tries.length; i++) for (let j = i + 1; j < tries.length; j++) {
  across.push({ audiences: [tries[i].audience, tries[j].audience], withQloo: distance(tries[i].arms['with-qloo'], tries[j].arms['with-qloo']),
    guessOnly: distance(tries[i].arms['without-qloo'], tries[j].arms['without-qloo']) });
}
const mean = list => list.length ? list.reduce((total, value) => total + value, 0) / list.length : null;
const result = { starter, audiences: tries.length, within, across, means: { within: mean(within.map(item => item.distance)), acrossWithQloo: mean(across.map(item => item.withQloo)), acrossGuessOnly: mean(across.map(item => item.guessOnly)) } };
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  const two = value => value === null ? 'n/a' : value.toFixed(2);
  console.log(`${tries.length} audiences for the ${starter} starter.`);
  for (const item of within) console.log(`  ${item.audience}: with Qloo against guess only ${two(item.distance)}`);
  for (const item of across) console.log(`  ${item.audiences.join(' / ')}: Qloo designs ${two(item.withQloo)} apart, guess-only designs ${two(item.guessOnly)} apart`);
  console.log(`Mean: within an audience ${two(result.means.within)}; across audiences, Qloo designs ${two(result.means.acrossWithQloo)} and guess-only designs ${two(result.means.acrossGuessOnly)} apart.`);
}
