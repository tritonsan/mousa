#!/usr/bin/env node
// Writes the Taste Provenance reports of a recorded design, as design_report does at the end of a session: for a run of
// scripts/run-claude-code-live.mjs or run-codex-live.mjs (its project/ folder), a comparison's two arms and the page
// that sets them side by side, or one design folder, including one recorded with the earlier 0.4 surface. It makes no
// request. The pictures are captured when a browser can run here; MOUSA_BROWSER names one.
//
//   node scripts/build-report.mjs <run-or-design-folder> [--out <folder>] [--host claude-code|codex|kiro] [--no-picture]
//
// Without --out the reports go where design_report puts them: .mousa/report/ in each design folder and
// .mousa/compare-report/ in the project. With --out a single report goes to <out>/, and a comparison to <out>/ with its
// arms in <out>/arms/<arm>/. The local user name is replaced in the agent's text wherever it stands as a word.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecords, writeSessionReport, writeComparisonReport, captureReport, REPORT_FOLDERS } from '../plugin/server/design/report.mjs';
import { pairDistance } from '../plugin/server/design/pair.mjs';
import { loadFontLibrary } from '../plugin/server/production/fonts.mjs';
import { inspectBrowser, verifyBrowser } from '../plugin/server/production/capture.mjs';
import { MOUSA_SERVER_VERSION } from '../plugin/server/mcp/mousa.mjs';

export const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARMS = Object.freeze(['compare/with-qloo', 'compare/without-qloo']);
const HOSTS = Object.freeze(['claude-code', 'codex', 'kiro']);

const isFolder = file => fs.stat(file).then(stat => stat.isDirectory(), () => false);
/** The host of a run folder named the way the live scripts name theirs, such as codex-long-dusk-compare-2. */
const hostOf = (folder, records) => HOSTS.find(host => path.basename(folder).startsWith(`${host}-`)) || (records?.legacy ? 'kiro' : null);
const localUser = () => { try { return os.userInfo().username; } catch { return null; } };

/**
 * The reports of one recorded design: `target` is a live run folder (with project/), a project with compare/ arms or one
 * design folder. Returns each report written, with its kind, folder and headline, and the pictures taken.
 */
export async function buildReports(target, { out = null, host = null, picture = true, env = process.env, now = Date.now, user = localUser(), browser = null, shoot } = {}) {
  const folder = await fs.realpath(target).catch(() => null);
  if (!folder || !(await isFolder(folder))) throw new Error(`${target} is not a folder.`);
  const project = await isFolder(path.join(folder, 'project')) ? await fs.realpath(path.join(folder, 'project')) : folder;
  const library = await loadFontLibrary(SOURCE);
  const options = record => ({ library, host: host ?? hostOf(folder, record), version: MOUSA_SERVER_VERSION, now, user });
  const written = [];
  const armRecords = await Promise.all(ARMS.map(arm => readRecords(path.join(project, ...arm.split('/')))));
  if (armRecords.every(records => records?.input)) {
    const pair = await pairDistance(project, ARMS);
    if (pair.empty) throw new Error(`${pair.empty} holds no pages, styles or scripts.`);
    const arms = ARMS.map((arm, index) => ({ folder: arm, records: armRecords[index], label: armRecords[index].input.source === 'qloo-profile' ? 'With Qloo' : 'Without Qloo' }));
    if (arms[0].label === arms[1].label) arms.forEach(arm => { arm.label = arm.folder; });
    const dir = out ? path.resolve(out) : path.join(project, '.mousa', REPORT_FOLDERS.comparison);
    const dirs = arms.map(arm => out ? path.join(dir, 'arms', path.posix.basename(arm.folder)) : path.join(arm.records.root, '.mousa', REPORT_FOLDERS.session));
    const links = dirs.map(armDir => `${path.relative(dir, armDir).split(path.sep).join('/')}/index.html`);
    // The comparison's folder is written afresh, so the arms that live inside it with --out are written after it.
    const comparison = await writeComparisonReport({ arms, pair, dir, links, ...options(arms[0].records) });
    for (const [index, arm] of arms.entries()) written.push(await writeSessionReport({ records: arm.records, dir: dirs[index], ...options(arm.records) }));
    written.push(comparison);
  } else {
    const records = await readRecords(project);
    if (!records?.input) throw new Error(`${target} holds no measured or baseline design session.`);
    written.push(await writeSessionReport({ records, ...(out ? { dir: path.resolve(out) } : {}), ...options(records) }));
  }
  const found = picture ? (browser || await verifyBrowser(await inspectBrowser({ env }), { env })) : null;
  return Promise.all(written.map(async report => {
    let pictures = null;
    if (found?.available) {
      try { pictures = await captureReport(report.dir, { browser: found, env, ...(shoot ? { shoot } : {}) }); } catch (error) { pictures = { failed: String(error?.message || error).slice(0, 240) }; }
    } else if (found) pictures = { unavailable: found.reason };
    return { kind: report.record.kind, dir: report.dir, headline: report.record.headline?.sentence || `${report.record.headline?.value} ${report.record.headline?.text}`, files: report.files.length, ...(pictures ? { pictures } : {}) };
  }));
}

function parseArgs(argv) {
  const args = { target: null, out: null, host: null, picture: true };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--out') args.out = argv[++index];
    else if (value === '--host') args.host = argv[++index];
    else if (value === '--no-picture') args.picture = false;
    else if (!value.startsWith('--') && !args.target) args.target = value;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.target) throw new Error('Name a run or design folder: node scripts/build-report.mjs <folder> [--out <folder>] [--host claude-code|codex|kiro] [--no-picture]');
  if (args.host && !HOSTS.includes(args.host)) throw new Error(`--host takes ${HOSTS.join(', ')}.`);
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    for (const report of await buildReports(args.target, args)) {
      const pictures = report.pictures?.report ? `; report.png ${report.pictures.report.width}×${report.pictures.report.height}` : report.pictures ? `; no pictures: ${report.pictures.unavailable || report.pictures.failed}` : '';
      console.log(`${report.kind}: ${path.join(report.dir, 'index.html')} (${report.files} files${pictures})\n  ${report.headline}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
