// Checks that every comparison in the built gallery kept its two arms apart: the arm shown as "With Qloo" designed
// from Qloo's measurement, the arm shown as "Without Qloo" from the frozen guess alone, with nothing measured reaching
// it (the checks are listed in src/gallery/arm-isolation.mjs):
//   node scripts/verify-comparison-arms.mjs [--runs D:/mousa-live] [--tries <folder>] [--gallery <folder>] [--config <file>] [--json]
// It reads the raw runs the gallery was built from. They hold Qloo's answers, so they stay on this machine; the
// published records alone cannot show what a session read. No network, no model. Exits 1 when a pair fails a check.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { checkComparison } from '../src/gallery/arm-isolation.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv();
const args = { runs: 'D:/mousa-live', tries: path.join(getConfig().dataDir, 'try'), gallery: path.join(getConfig().dataDir, 'gallery'), config: path.join(repo, 'scripts', 'gallery.config.json'), json: false };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const name = argv[index].replace(/^--/u, '');
  if (name === 'json') args.json = true;
  else if (['runs', 'tries', 'gallery', 'config'].includes(name) && argv[index + 1]) args[name] = argv[++index];
  else throw new Error(`Unknown argument: ${argv[index]}`);
}

const config = JSON.parse(await fs.readFile(path.resolve(args.config), 'utf8'));
const index = JSON.parse(await fs.readFile(path.join(path.resolve(args.gallery), 'gallery.json'), 'utf8'));
const pairs = config.entries.filter(entry => entry.run).map(entry => ({ id: entry.id, root: path.join(path.resolve(args.runs), entry.run) }));
// A live try's gallery entry is named after the first eight characters of its run's folder.
const tries = await fs.readdir(path.resolve(args.tries)).catch(() => []);
for (const entry of index.entries.filter(item => item.origin === 'try')) {
  const folder = tries.find(name => entry.id === `try-${name.slice(0, 8)}`);
  if (folder) pairs.push({ id: entry.id, root: path.join(path.resolve(args.tries), folder), tryRun: true });
}
const results = (await Promise.all(pairs.map(pair => checkComparison({ ...pair, gallery: path.resolve(args.gallery) })))).filter(Boolean);
if (args.json) console.log(JSON.stringify(results, null, 2));
else {
  for (const result of results) {
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${result.id}`);
    for (const [key, value] of Object.entries(result.facts)) console.log(`       ${key}: ${value}`);
    for (const problem of result.problems) console.log(`       PROBLEM: ${problem}`);
  }
  console.log(`\n${results.filter(result => result.ok).length} of ${results.length} comparisons pass every check.`);
}
if (results.some(result => !result.ok)) process.exitCode = 1;
