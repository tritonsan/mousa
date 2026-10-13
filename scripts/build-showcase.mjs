#!/usr/bin/env node
// Sets the Studio's showcase in DATA_DIR/showcase.json: the website comparison and the character pair a reviewer sees
// first, and the app run, which is not a Studio job. For the app it builds DATA_DIR/showcase/app/<id>/ from a
// recorded run of scripts/run-mobile-example-live.mjs: the example as it was (before/), the run's redesign (after/),
// the captures its reviews judged (captures/) and record.json, a summary of the run's artifacts. The copy's agent
// files, Kiro's home and the session record are never copied. Entries not named keep their value; none clears one.
// It makes no request; restart the Studio to show the new showcase.
//
//   node scripts/build-showcase.mjs [--sites=<job-id>|none] [--game=<job-id>|none] [--app=<run stamp>|none]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { SHOWCASE_FILE, SHOWCASE_DIR, APP_TYPES } from '../src/showcase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOB_ID = /^[a-f0-9-]{36}$/u;
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/u;
// The web files of the app: what its pages load, never its server script, its notes or its agent's folders.
const WEB_FILES = ['index.html', 'styles.css', 'app.js', 'tokens', 'data', 'fonts'];

const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse);
const clip = (value, length = 400) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, length) : null);

/** Files of a folder or a single file whose type the showcase serves, copied without following links. */
async function copyWeb(from, to) {
  const stat = await fs.lstat(from).catch(() => null);
  if (!stat) return 0;
  if (stat.isFile()) {
    if (!APP_TYPES[path.extname(from).toLowerCase()] || path.basename(from).startsWith('.')) return 0;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return 1;
  }
  if (!stat.isDirectory()) return 0;
  let copied = 0;
  for (const entry of await fs.readdir(from)) if (!entry.startsWith('.')) copied += await copyWeb(path.join(from, entry), path.join(to, entry));
  return copied;
}

/**
 * The record the App interface view shows, from the run's artifacts, run.json and the captures copied with it; refs are
 * shown by their names.
 */
export function appRecord({ id, run, taste, reading, dna, plan, review, captures = [] }) {
  const names = new Map([...(taste?.entities || []), ...(taste?.requiredAnchors || [])].map(entity => [entity.ref, entity.name]));
  const named = refs => (Array.isArray(refs) ? refs : []).map(ref => names.get(ref) || null).filter(Boolean);
  const rounds = Array.isArray(review?.rounds) ? review.rounds : review ? [review] : [];
  const kiro = /(\d+\.\d+\.\d+)/u.exec(path.basename(String(run.kiro || '')))?.[1] || null;
  return {
    schemaVersion: '1.0', id, title: 'Ramble', medium: 'app-ui',
    description: 'A self-guided walking app for Port Calder, a fictional city: four screens whose walks, distances and stops are fixed facts.',
    request: clip(run.request, 600), model: run.model || null, kiro, recordedAt: run.startedAt || null, durationMs: run.durationMs ?? null,
    seeds: (taste?.seeds || []).map(seed => seed.matchedName || seed.name).filter(Boolean),
    taste: taste?.metrics ? Object.fromEntries(['measuredEntities', 'surprises', 'predictions', 'predictionsConfirmed', 'measuredQualities', 'qualitySurprises', 'measuredTags'].map(key => [key, taste.metrics[key] ?? null])) : null,
    reading: reading ? { approach: clip(reading.approach, 900), setAside: (reading.setAside || []).length,
      clusters: (reading.clusters || []).map(cluster => ({ name: clip(cluster.name, 120), layers: cluster.layers || [], refs: named(cluster.refs).slice(0, 8) })) } : null,
    dna: dna ? { thesis: clip(dna.thesis, 900), devices: (dna.devices || []).map(device => ({ id: device.id, layer: device.layer, device: clip(device.device, 160), translation: clip(device.translation, 400), anchors: named(device.anchors).slice(0, 6), qualities: (device.qualities || []).slice(0, 6) })) } : null,
    plan: plan ? { steps: (plan.steps || []).map(step => ({ device: step.device, method: step.method, why: clip(step.why, 300) })),
      criteria: (plan.review || []).map(item => ({ id: item.id, device: item.device, view: item.view, look: clip(item.look, 300) })) } : null,
    review: { note: clip(review?.audit, 300), rounds: rounds.map(round => ({ round: round.round ?? null, summary: clip(round.summary, 400),
      criteria: (round.criteria || []).map(item => ({ id: item.id, capture: item.capture, verdict: item.verdict, observed: clip(item.observed, 400), repair: clip(item.repair, 400) })) })) },
    audit: run.review ? { audited: Boolean(run.review.audited), cited: run.review.cited || [], opened: run.review.opened || [], unopened: run.review.unopened || [] } : null,
    changed: run.changed || [], fonts: (run.added || []).filter(file => file.endsWith('.woff2')).map(file => path.basename(file)),
    captures,
  };
}

/** Builds showcase/app/<id>/ from one recorded run, replacing an earlier build of the same ID. */
export async function buildApp({ stamp, dataDir, rootDir = root }) {
  if (!STAMP.test(stamp)) throw new Error('--app: give the stamp of a run of scripts/run-mobile-example-live.mjs, such as 2026-10-06T10-20-02-669Z.');
  const copy = path.join(rootDir, 'examples', `mobile-app-run-${stamp}`), example = path.join(rootDir, 'examples', 'mobile-app');
  const run = await readJson(path.join(rootDir, 'output', 'mobile-app-run', stamp, 'run.json')).catch(() => null);
  if (!run || !await fs.stat(path.join(copy, 'index.html')).then(() => true, () => false)) throw new Error(`No recorded run ${stamp}: it needs ${path.relative(rootDir, copy)} and output/mobile-app-run/${stamp}/run.json.`);
  const id = `ramble-${stamp.slice(0, 10)}`;
  const target = path.join(dataDir, SHOWCASE_DIR, 'app', id);
  await fs.rm(target, { recursive: true, force: true });
  let files = 0;
  for (const item of WEB_FILES) {
    files += await copyWeb(path.join(example, item), path.join(target, 'before', item));
    files += await copyWeb(path.join(copy, item), path.join(target, 'after', item));
  }
  // Only the captures the plugin issued in the run, under the names its record gives them.
  const captures = [];
  for (const capture of (await readJson(path.join(copy, '.mousa', 'captures.json')).catch(() => null))?.captures || []) {
    if (!/^[A-Za-z0-9_-]{1,90}$/u.test(capture?.id || '')) continue;
    if (!await copyWeb(path.join(copy, '.mousa', 'captures', `${capture.id}.png`), path.join(target, 'captures', `${capture.id}.png`))) continue;
    files += 1;
    captures.push({ id: capture.id, round: capture.round ?? null, view: capture.view || null, target: capture.target || null, width: capture.width ?? null, height: capture.height ?? null, file: `captures/${capture.id}.png` });
  }
  const artifact = name => readJson(path.join(copy, name)).catch(() => null);
  const [taste, reading, dna, plan, review] = await Promise.all(['culture-taste.json', 'culture-reading.json', 'culture-dna.json', 'culture-production.json', 'culture-review.json'].map(artifact));
  await fs.writeFile(path.join(target, 'record.json'), `${JSON.stringify(appRecord({ id, run, taste, reading, dna, plan, review, captures }), null, 2)}\n`);
  return { id, files: files + 1 };
}

/** The completed job a showcase entry names, read from its record in DATA_DIR. */
async function completedJob(dataDir, id, kind) {
  if (!JOB_ID.test(id)) throw new Error(`${id} is not a Studio job ID.`);
  const job = await readJson(path.join(dataDir, id, 'meta.json')).catch(() => null);
  if (!job || job.id !== id) throw new Error(`${id} is not in ${dataDir}.`);
  if (job.status !== 'completed') throw new Error(`${id} did not complete (${job.status}).`);
  if (kind === 'character' ? job.kind !== 'character' : (job.kind || 'build') !== 'build' || job.runs?.length !== 2) throw new Error(`${id} is not ${kind === 'character' ? 'a character pair' : 'a website comparison'}.`);
  return id;
}

async function main(argv = process.argv.slice(2)) {
  loadDotEnv();
  const dataDir = path.resolve(getConfig().dataDir);
  const option = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [sites, game, stamp] = ['sites', 'game', 'app'].map(option);
  if (sites === undefined && game === undefined && stamp === undefined) {
    console.log('Usage: node scripts/build-showcase.mjs [--sites=<job-id>|none] [--game=<job-id>|none] [--app=<run stamp>|none]. Makes no request.');
    process.exitCode = 1;
    return;
  }
  const file = path.join(dataDir, SHOWCASE_FILE);
  const current = await readJson(file).catch(() => ({}));
  const next = { schemaVersion: '1.0', sites: current.sites ?? null, game: current.game ?? null, app: current.app ?? null };
  if (sites !== undefined) next.sites = sites === 'none' ? null : await completedJob(dataDir, sites, 'build');
  if (game !== undefined) next.game = game === 'none' ? null : await completedJob(dataDir, game, 'character');
  if (stamp === 'none') next.app = null;
  else if (stamp !== undefined) {
    const built = await buildApp({ stamp, dataDir });
    next.app = built.id;
    console.log(`Built ${SHOWCASE_DIR}/app/${built.id}/ (${built.files} files).`);
  }
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Showcase in ${file}: sites ${next.sites || 'none'}, game ${next.game || 'none'}, app ${next.app || 'none'}. Restart the Studio to show it.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
