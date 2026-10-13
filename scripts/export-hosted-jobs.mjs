// Copies completed Studio jobs into a folder that a hosted Studio reads as its job store, so a server without Codex can
// show work recorded on this machine, generated pictures included. A website job keeps its record and each run's site,
// generated pictures and review captures; a character job keeps its record and its pair's published files. Kiro homes,
// agent configurations and pair work folders stay here: they hold the design sessions and each run's bridge token.
// With --showcase it also carries the showcase (scripts/build-showcase.mjs): showcase.json, the jobs it names and the
// app run's folder, only the files the Studio serves from it. It makes no request and changes nothing in DATA_DIR.
//
//   node scripts/export-hosted-jobs.mjs --list
//   node scripts/export-hosted-jobs.mjs --out ../hosted-jobs [<job-id> ...] [--showcase] [--force]

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { CHARACTER_KIND, PAIR_ID, pairPictures } from '../src/character-jobs.mjs';
import { CAPTURE_ID, REVIEW_DIR } from '../src/site-production.mjs';
import { validModes } from '../src/jobs.mjs';
import { SHOWCASE_FILE, SHOWCASE_DIR, APP_ID, showcaseAppFile } from '../src/showcase.mjs';

const JOB_ID = /^[a-f0-9-]{36}$/u;
// The pair files the Studio's preview serves, and the taste pass a later pair may reuse or swap in.
const PAIR_FILE = /^(?:(?:pair|taste|qloo-(?:off|on|swap))\.json|qloo-(?:off|on|swap)-[a-z0-9-]{1,80}\.(?:jpg|png))$/u;
const PICTURE = /\.(?:jpe?g|png|webp)$/iu;

loadDotEnv();
const config = getConfig();
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : null;
const ids = args.filter((item, index) => !item.startsWith('--') && !(outIndex >= 0 && index === outIndex + 1));
const readJob = async id => JSON.parse(await fs.readFile(path.join(config.dataDir, id, 'meta.json'), 'utf8'));

/** Files of one folder that `accept` takes, copied without following links; with `deep`, its subfolders too. */
async function copyFolder(from, to, accept, { deep = false } = {}) {
  let files = 0, bytes = 0;
  const entries = await fs.readdir(from, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const entry of entries) {
    const source = path.join(from, entry.name), target = path.join(to, entry.name);
    if (entry.isDirectory() && deep) {
      const copied = await copyFolder(source, target, accept, { deep });
      files += copied.files; bytes += copied.bytes;
    } else if (entry.isFile() && accept(entry.name)) {
      await fs.mkdir(to, { recursive: true });
      await fs.copyFile(source, target);
      files += 1; bytes += (await fs.stat(target)).size;
    }
  }
  return { files, bytes };
}

if (args.includes('--list')) {
  const jobs = [];
  for (const item of await fs.readdir(config.dataDir, { withFileTypes: true }).catch(() => [])) {
    if (!item.isDirectory() || !JOB_ID.test(item.name)) continue;
    const job = await readJob(item.name).catch(() => null);
    if (job?.status === 'completed') jobs.push(job);
  }
  jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const job of jobs) {
    const recorded = job.kind === CHARACTER_KIND && job.pictures === undefined && PAIR_ID.test(job.pairId || '')
      ? pairPictures(JSON.parse(await fs.readFile(path.join(config.dataDir, job.id, job.pairId, 'pair.json'), 'utf8').catch(() => '{}')).arms) : job.pictures;
    const pictures = job.kind === CHARACTER_KIND ? (recorded ? recorded.portraits + recorded.painted : 0) : job.runs.reduce((sum, run) => sum + (run.generatedImages?.length || 0), 0);
    const name = job.kind === CHARACTER_KIND ? job.brief?.name || 'Character pair' : `${job.templateId} · ${String(job.brief || '').replace(/\s+/gu, ' ').slice(0, 60)}`;
    console.log([job.id, String(job.createdAt).slice(0, 10), job.kind || 'build', job.runs.map(run => run.mode).join('+'), `${pictures} pictures`, name].join('  '));
  }
  console.log(`${jobs.length} completed jobs in ${config.dataDir}.`);
  process.exit(0);
}
const withShowcase = args.includes('--showcase');
if (!out || (!ids.length && !withShowcase)) {
  console.log('Usage: node scripts/export-hosted-jobs.mjs --out <folder> [<job-id> ...] [--showcase] [--force], or --list to see the completed jobs. Makes no request.');
  process.exit(1);
}

const outDir = path.resolve(out), dataDir = path.resolve(config.dataDir);
if (outDir === dataDir || outDir.startsWith(dataDir + path.sep)) throw new Error('Export to a folder outside DATA_DIR.');
let total = { files: 0, bytes: 0 };
const add = copied => { total = { files: total.files + copied.files, bytes: total.bytes + copied.bytes }; };
const exists = file => fs.stat(file).then(() => true, () => false);
// The showcase's jobs are exported with the rest.
const showcase = withShowcase ? JSON.parse(await fs.readFile(path.join(dataDir, SHOWCASE_FILE), 'utf8').catch(() => 'null')) : null;
if (withShowcase && (!showcase || typeof showcase !== 'object' || Array.isArray(showcase))) throw new Error(`--showcase: DATA_DIR has no ${SHOWCASE_FILE}; set it with scripts/build-showcase.mjs.`);
for (const id of withShowcase ? [showcase.sites, showcase.game] : []) if (typeof id === 'string' && !ids.includes(id)) ids.push(id);

/** The showcased app run's record and the files the Studio serves from its folder, nothing else. */
async function copyShowcaseApp(id) {
  const from = path.join(dataDir, SHOWCASE_DIR, 'app', id), to = path.join(outDir, SHOWCASE_DIR, 'app', id);
  let files = 0, bytes = 0;
  const walk = async relative => {
    for (const entry of await fs.readdir(path.join(from, ...relative.split('/').filter(Boolean)), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && (next === 'record.json' || showcaseAppFile({ dataDir, id, relative: next }))) {
        const target = path.join(to, ...next.split('/'));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(from, ...next.split('/')), target);
        files += 1; bytes += (await fs.stat(target)).size;
      }
    }
  };
  await walk('');
  return { files, bytes };
}
for (const id of new Set(ids)) {
  if (!JOB_ID.test(id)) throw new Error(`${id} is not a Studio job ID.`);
  const job = await readJob(id);
  if (job.id !== id || !Array.isArray(job.runs)) throw new Error(`${id} has no job record of its own.`);
  if (job.status !== 'completed') throw new Error(`${id} did not complete (${job.status}); only completed jobs are exported.`);
  const source = path.join(dataDir, id), target = path.join(outDir, id);
  if (await fs.stat(target).then(() => true, () => false)) {
    if (!args.includes('--force')) throw new Error(`${target} exists. Pass --force to replace it.`);
    await fs.rm(target, { recursive: true, force: true });
  }
  if (job.kind === CHARACTER_KIND) {
    if (!PAIR_ID.test(job.pairId || '')) throw new Error(`${id} names no pair folder.`);
    add(await copyFolder(path.join(source, job.pairId), path.join(target, job.pairId), name => PAIR_FILE.test(name)));
    // A pair recorded before the Studio kept its pictures gets them from its own record.
    if (job.pictures === undefined) job.pictures = pairPictures(JSON.parse(await fs.readFile(path.join(source, job.pairId, 'pair.json'), 'utf8')).arms);
  } else {
    for (const run of job.runs) {
      if (!validModes.includes(run.mode)) continue;
      const from = path.join(source, run.mode), to = path.join(target, run.mode);
      add(await copyFolder(path.join(from, 'site'), path.join(to, 'site'), () => true, { deep: true }));
      add(await copyFolder(path.join(from, 'assets'), path.join(to, 'assets'), name => PICTURE.test(name), { deep: true }));
      add(await copyFolder(path.join(from, REVIEW_DIR), path.join(to, REVIEW_DIR), name => name.endsWith('.png') && CAPTURE_ID.test(name.slice(0, -4))));
    }
    if (job.parentJobId && !ids.includes(job.parentJobId)) console.log(`${id} revises ${job.parentJobId}, which is not exported: it shows, but a further revision of it needs its source.`);
    // The workspace the job was made in, which the Studio opens with it.
    if (JOB_ID.test(job.workspaceId || '')) {
      const file = `${job.workspaceId}.json`;
      add(await copyFolder(path.join(dataDir, 'workspaces'), path.join(outDir, 'workspaces'), name => name === file));
    }
  }
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'meta.json'), JSON.stringify(job, null, 2));
  add({ files: 1, bytes: (await fs.stat(path.join(target, 'meta.json'))).size });
}
if (showcase) {
  if (showcase.app !== null && showcase.app !== undefined) {
    if (typeof showcase.app !== 'string' || !APP_ID.test(showcase.app) || !await exists(path.join(dataDir, SHOWCASE_DIR, 'app', showcase.app, 'record.json'))) throw new Error(`--showcase: the app run ${showcase.app} has no folder under ${SHOWCASE_DIR}/app/; build it with scripts/build-showcase.mjs.`);
    const target = path.join(outDir, SHOWCASE_DIR, 'app', showcase.app);
    if (await exists(target)) {
      if (!args.includes('--force')) throw new Error(`${target} exists. Pass --force to replace it.`);
      await fs.rm(target, { recursive: true, force: true });
    }
    add(await copyShowcaseApp(showcase.app));
  }
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, SHOWCASE_FILE), `${JSON.stringify(showcase, null, 2)}\n`);
  add({ files: 1, bytes: (await fs.stat(path.join(outDir, SHOWCASE_FILE))).size });
  console.log(`The showcase: websites ${showcase.sites || 'none'}, character pair ${showcase.game || 'none'}, app run ${showcase.app || 'none'}. A hosted Studio serves these records and the app run without the access token.`);
}
console.log(`Exported ${new Set(ids).size} jobs (${total.files} files, ${(total.bytes / 1048576).toFixed(1)} MB) to ${outDir}. Copy its contents into the hosted Studio's DATA_DIR and restart the Studio; docs/aws-deployment.md shows the Docker commands.`);
