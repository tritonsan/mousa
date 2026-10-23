// Builds the public gallery from recorded design sessions, as scripts/gallery.config.json lists them. Each entry gets
// its Taste Provenance report (for a comparison, the comparison page with each arm's own inside it), the design's
// playable files, the starter as it was for a restyle, and entry.json: the host and model, the Moûsa version and the
// commit it ran at, the time, the request, the Qloo requests, the timeline and how to run it again. Every entry is
// then scanned, and a gallery with any finding is not published: gallery.json is written only when the scan is clean.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeSessionReport, writeComparisonReport, captureReport, scrubText } from '../../plugin/server/design/report.mjs';
import { scalePng } from '../../plugin/server/production/image-files.mjs';
import { pairDistance } from '../../plugin/server/design/pair.mjs';
import { MOUSA_SERVER_VERSION } from '../../plugin/server/mcp/mousa.mjs';
import { readPluginRun, readKiroRun, readTryRun } from './records.mjs';
import { copyPublic, rebaseRootUrls, leakPatterns, leakScan, PUBLIC_TYPES, PUBLIC_LIMITS, PublishError } from './sanitize.mjs';
import { blindSpotOf, blindSpotTotals } from './blind-spot.mjs';

const exec = promisify(execFile);
export const GALLERY_SCHEMA_VERSION = '1.0';
export const ENTRY_ID = /^[a-z0-9][a-z0-9-]{2,60}$/u;
const ARMS = Object.freeze(['compare/with-qloo', 'compare/without-qloo']);
const CARD_SMALL = 640;
const RUNNERS = Object.freeze({ 'claude-code': 'scripts/run-claude-code-live.mjs', codex: 'scripts/run-codex-live.mjs', kiro: 'scripts/run-mobile-example-live.mjs' });

/** The config's entries, checked: unique ids, one source each (a run, a Kiro record or a try), and a featured entry and vote pool among them. */
export function checkConfig(config) {
  if (!config || !Array.isArray(config.entries) || !config.entries.length) throw new Error('The gallery config lists no entries.');
  const ids = new Set();
  for (const entry of config.entries) {
    if (!ENTRY_ID.test(entry.id || '') || ids.has(entry.id)) throw new Error(`Entry ${entry.id || '(no id)'} needs a unique id of lowercase letters, digits and hyphens.`);
    ids.add(entry.id);
    if (['run', 'kiro', 'try'].filter(key => entry[key]).length !== 1) throw new Error(`Entry ${entry.id} names one source: a run folder, a Kiro record or a live try.`);
    if (typeof entry.title !== 'string' || !entry.title.trim()) throw new Error(`Entry ${entry.id} needs a title.`);
  }
  for (const id of [config.featured, ...(config.vote || [])].filter(Boolean)) if (!ids.has(id)) throw new Error(`${id} is named but is not an entry.`);
  return config;
}

/** The files of `source` at `commit` in git, by web type, written into `to`: a starter as it was when a run copied it. */
async function starterAt(repo, commit, source, to, budget) {
  const { stdout } = await exec('git', ['ls-tree', '-r', '--name-only', commit, '--', source], { cwd: repo, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const copied = [];
  for (const file of stdout.split('\n').map(line => line.trim()).filter(Boolean)) {
    const relative = path.posix.relative(source, file);
    if (!relative || relative.split('/').some(part => part.startsWith('.') || part === 'node_modules') || !PUBLIC_TYPES[path.posix.extname(relative).toLowerCase()]) continue;
    const { stdout: bytes } = await exec('git', ['show', `${commit}:${file}`], { cwd: repo, windowsHide: true, encoding: 'buffer', maxBuffer: PUBLIC_LIMITS.fileBytes + 1 });
    budget.bytes += bytes.length; budget.files += 1;
    if (budget.bytes > PUBLIC_LIMITS.entryBytes || budget.files > PUBLIC_LIMITS.files) throw new PublishError(`The entry's starter goes past ${PUBLIC_LIMITS.entryBytes / 1024 / 1024} MB.`);
    const target = path.join(to, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    copied.push(relative);
  }
  return copied;
}

/** The command that runs the session again, with what it needs; the result will differ, since models vary. */
function reproduceOf(run, entry) {
  if (run.reproduce) return run.reproduce;
  const flags = ['--run', ...(entry.from ? [`--from ${entry.from}`] : []), ...(entry.install ? ['--install'] : []), ...(run.briefFile ? [`--brief-file ${run.briefFile}`] : []),
    ...(entry.images ? ['--images'] : [])];
  const kiro = run.host === 'kiro';
  return { commit: run.commit, command: `node ${RUNNERS[run.host]} ${kiro ? '--run' : flags.join(' ')}`,
    needs: [`Your own Qloo API key as QLOO_API_KEY in this repository's .env.`, kiro ? 'Kiro CLI 2.24.0, signed in.' : run.host === 'codex' ? 'Codex CLI, signed in.' : 'Claude Code, signed in.',
      ...(entry.images ? ['Codex image generation on your own ChatGPT plan.'] : [])],
    note: 'Models vary from run to run, so a new session reaches its own design; the prediction it freezes and the measurement are compared in the same way.' };
}

const armName = folder => path.posix.basename(folder);
const label = records => records.input?.source === 'qloo-profile' ? 'With Qloo' : 'Without Qloo';

/**
 * Build one entry into `dir`: its reports, pictures, playable files, starter and entry.json. `run` is what records.mjs
 * read; returns the entry's record for gallery.json.
 */
export async function buildEntry({ entry, run, dir, repo, runsDir, library, browser, env, now, user, shoot }) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const options = { library, host: run.host, version: MOUSA_SERVER_VERSION, now, user };
  const base = `/gallery/${entry.id}`;
  const reports = [];
  let record;
  if (run.kind === 'comparison') {
    const arms = run.arms.map(arm => ({ ...arm, label: label(arm.records) }));
    if (arms[0].label === arms[1].label) arms.forEach(arm => { arm.label = armName(arm.folder); });
    const pair = await pairDistance(run.project, ARMS);
    if (pair.empty) throw new PublishError(`${entry.id}: ${pair.empty} holds no pages, styles or scripts.`);
    // The comparison's folder is written afresh, so its arms' reports, which live inside it, follow it.
    const written = await writeComparisonReport({ arms, pair, dir: path.join(dir, 'report'), links: arms.map(arm => `${base}/arms/${armName(arm.folder)}/`), ...options });
    record = written.record;
    reports.push(written.dir);
    for (const arm of arms) reports.push((await writeSessionReport({ records: arm.records, dir: path.join(dir, 'report', 'arms', armName(arm.folder)), ...options })).dir);
  } else {
    const written = await writeSessionReport({ records: run.records, dir: path.join(dir, 'report'), ...options });
    record = written.record;
    reports.push(written.dir);
  }
  const pictures = [];
  if (browser?.available) for (const folder of reports) pictures.push(await captureReport(folder, { browser, env, ...(shoot ? { shoot } : {}) }).then(() => true, () => false));
  // The gallery's cards show a smaller copy of each card, which a page can load at once.
  const card = await fs.readFile(path.join(dir, 'report', 'card.png')).catch(() => null);
  if (card) await fs.writeFile(path.join(dir, 'report', 'card-small.png'), scalePng(card, CARD_SMALL));

  const budget = { bytes: 0, files: 0 };
  // Each copy plays from its own folder of the gallery, so a build's root-relative URLs are made relative to it.
  const published = async (from, to, options = {}) => { const copied = await copyPublic(from, to, { budget, ...options }); await rebaseRootUrls(to, copied); return copied; };
  const play = [];
  if (run.kind === 'comparison') {
    for (const arm of run.arms) {
      const name = armName(arm.folder);
      const copied = await published(path.join(run.project, ...arm.folder.split('/'), ...(entry.play ? entry.play.split('/') : [])), path.join(dir, 'out', name));
      if (copied.includes('index.html')) play.push({ label: label(arm.records), path: `out/${name}/index.html` });
    }
  } else {
    const copied = await published(path.join(run.project, ...(entry.play ? entry.play.split('/') : [])), path.join(dir, 'out', 'design'), { skip: ['compare'] });
    if (copied.includes('index.html')) play.push({ label: 'The design', path: 'out/design/index.html' });
  }
  let before = null;
  if (entry.before?.repo && run.commit) {
    const copied = await starterAt(repo, run.commit, entry.before.repo, path.join(dir, 'before'), budget);
    await rebaseRootUrls(path.join(dir, 'before'), copied);
    if (copied.includes('index.html')) before = 'before/index.html';
  } else if (entry.before?.folder) {
    const copied = await published(path.resolve(runsDir, entry.before.folder), path.join(dir, 'before'));
    if (copied.includes('index.html')) before = 'before/index.html';
  }
  const exists = file => fs.stat(path.join(dir, ...file.split('/'))).then(() => true, () => false);
  const arms = run.kind === 'comparison' ? run.arms.map(arm => ({ label: label(arm.records), folder: armName(arm.folder) })) : null;
  const saved = {
    schemaVersion: GALLERY_SCHEMA_VERSION, id: entry.id, kind: run.kind, title: entry.title.trim(), ...(entry.summary ? { summary: entry.summary.trim() } : {}),
    host: run.host, hostVersion: entry.hostVersion || run.hostVersion || null, model: entry.model || run.model || null, surfaceVersion: run.surfaceVersion,
    ...(run.legacy ? { surface: 'earlier tool surface (0.4)' } : {}), ...(run.origin === 'try' ? { origin: 'try', tryBy: run.tryBy } : {}), medium: record.medium || null, startedAt: run.startedAt, minutes: run.minutes, turns: run.turns,
    qlooRequests: run.qlooRequests, pictures: entry.images ? 'Codex image generation' : 'none: imagery drawn in SVG or CSS',
    brief: scrubText(run.brief, { user }), headline: record.headline, ...(record.kind === 'comparison' ? { distance: record.distance, samePrediction: record.samePrediction, arms } : {}),
    ...(blindSpotOf(record) ? { blindSpot: blindSpotOf(record) } : {}),
    play, ...(before ? { before } : {}),
    report: { page: 'report/index.html', card: await exists('report/card.png') ? 'report/card.png' : null, cardSmall: await exists('report/card-small.png') ? 'report/card-small.png' : null,
      picture: await exists('report/report.png') ? 'report/report.png' : null },
    timeline: run.timeline, reproduce: reproduceOf(run, entry),
  };
  await fs.writeFile(path.join(dir, 'entry.json'), `${JSON.stringify(saved, null, 2)}\n`);
  return { saved, pictures: pictures.every(Boolean) && pictures.length > 0 };
}

/**
 * Build the gallery into `out` from `config`: every entry, then the scan. Returns {entries, findings, written}; the
 * gallery.json index is written only when nothing was found.
 */
export async function buildGallery({ config, runsDir, triesDir = null, repo, out, library = null, browser = null, env = process.env, now = Date.now, user = null, secrets = [], shoot, log = () => {} }) {
  checkConfig(config);
  await fs.mkdir(out, { recursive: true });
  const entries = [];
  for (const entry of config.entries) {
    if (entry.try && !triesDir) throw new Error(`${entry.id} is a live try, and no folder of tries was given.`);
    const run = entry.try ? await readTryRun(path.join(triesDir, entry.try), { repo })
      : entry.kiro ? await readKiroRun({ record: path.resolve(repo, entry.kiro.record), project: path.resolve(repo, entry.kiro.project), repo })
        : await readPluginRun(path.resolve(runsDir, entry.run), { repo });
    const built = await buildEntry({ entry, run, dir: path.join(out, entry.id), repo, runsDir, library, browser, env, now, user, shoot });
    log(`${entry.id}: ${built.saved.headline?.sentence || built.saved.headline?.value}${built.pictures ? '' : ' (no pictures)'}`);
    entries.push(built.saved);
  }
  const patterns = leakPatterns({ user, runsDir, folders: triesDir ? [triesDir] : [], secrets });
  const findings = [];
  for (const entry of entries) for (const finding of await leakScan(path.join(out, entry.id), patterns)) findings.push({ entry: entry.id, ...finding });
  const index = { schemaVersion: GALLERY_SCHEMA_VERSION, builtAt: new Date(now()).toISOString(), featured: config.featured || entries[0]?.id || null, vote: config.vote || [],
    entries: entries.map(entry => ({ id: entry.id, kind: entry.kind, title: entry.title, host: entry.host, medium: entry.medium, startedAt: entry.startedAt,
      headline: entry.headline, ...(entry.distance ? { distance: entry.distance.overall } : {}), card: entry.report.cardSmall || entry.report.card,
      ...(entry.blindSpot ? { blindSpot: entry.blindSpot } : {}), ...(entry.surface ? { surface: entry.surface } : {}), ...(entry.origin ? { origin: entry.origin } : {}) })),
    blindSpot: blindSpotTotals(entries) };
  if (!findings.length) await fs.writeFile(path.join(out, 'gallery.json'), `${JSON.stringify(index, null, 2)}\n`);
  else await fs.rm(path.join(out, 'gallery.json'), { force: true });
  return { entries, findings, written: !findings.length };
}

/** Scan a built gallery again, as a deployment does before it serves it. */
export async function checkGallery(out, { user = null, runsDir = null, folders = [], secrets = [] } = {}) {
  const findings = [];
  const patterns = leakPatterns({ user, runsDir, folders, secrets });
  for (const entry of await fs.readdir(out, { withFileTypes: true })) {
    if (entry.isDirectory()) for (const finding of await leakScan(path.join(out, entry.name), patterns)) findings.push({ entry: entry.name, ...finding });
  }
  return findings;
}
