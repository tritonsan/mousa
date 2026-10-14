#!/usr/bin/env node
// Builds the public gallery in DATA_DIR/gallery (or --out) from the recorded sessions scripts/gallery.config.json lists:
// each entry's Taste Provenance report and pictures, its playable files, its starter for a restyle and entry.json. The
// gallery is then scanned for local paths, the user's name, this deployment's secrets, tokens and Qloo ids; with any
// finding, gallery.json is not written and the script fails. --check scans a built gallery again without building.
// It makes no request. Pictures need a browser that can run here (MOUSA_BROWSER names one); restart the Studio after.
//
//   node scripts/build-gallery.mjs [--runs D:/mousa-live] [--out <folder>] [--config <file>] [--no-picture]
//   node scripts/build-gallery.mjs --check [--out <folder>]

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, getConfig } from '../src/config.mjs';
import { buildGallery, checkGallery } from '../src/gallery/build.mjs';
import { GALLERY_DIR } from '../src/gallery.mjs';
import { loadFontLibrary } from '../plugin/server/production/fonts.mjs';
import { inspectBrowser, verifyBrowser } from '../plugin/server/production/capture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = ['QLOO_API_KEY', 'KIRO_API_KEY', 'DEMO_ACCESS_TOKEN', 'SITE_SECRET', 'TRY_ACCESS_CODE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

function parseArgs(argv) {
  const args = { runs: 'D:/mousa-live', out: null, config: path.join(repo, 'scripts', 'gallery.config.json'), picture: true, check: false };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--runs') args.runs = argv[++index];
    else if (value === '--out') args.out = argv[++index];
    else if (value === '--config') args.config = argv[++index];
    else if (value === '--no-picture') args.picture = false;
    else if (value === '--check') args.check = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args.out || path.join(getConfig().dataDir, GALLERY_DIR));
  const user = (() => { try { return os.userInfo().username; } catch { return null; } })();
  const secrets = SECRETS.map(name => process.env[name]).filter(Boolean);
  if (args.check) {
    const findings = await checkGallery(out, { user, runsDir: path.resolve(args.runs), secrets });
    for (const finding of findings) console.error(`${finding.entry}/${finding.file}: ${finding.pattern}: …${finding.sample}…`);
    console.log(findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'} in ${out}.` : `Clean: ${out}`);
    if (findings.length) process.exitCode = 1;
    return;
  }
  const config = JSON.parse(await fs.readFile(args.config, 'utf8'));
  const browser = args.picture ? await verifyBrowser(await inspectBrowser()) : null;
  if (browser && !browser.available) console.warn(`No pictures: ${browser.reason}`);
  const result = await buildGallery({ config, runsDir: path.resolve(args.runs), repo, out, library: await loadFontLibrary(repo), browser, user, secrets, log: line => console.log(line) });
  for (const finding of result.findings) console.error(`${finding.entry}/${finding.file}: ${finding.pattern}: …${finding.sample}…`);
  if (!result.written) { console.error(`${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}: gallery.json was not written.`); process.exitCode = 1; return; }
  console.log(`${result.entries.length} entries in ${out}. Restart the Studio to show them.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
