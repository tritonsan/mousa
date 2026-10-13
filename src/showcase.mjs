// The Studio's showcase: the recorded work a reviewer sees first, readable without the access token. DATA_DIR/
// showcase.json names a website comparison, a character pair and an app run; the app run is not a Studio job, so its
// files live in DATA_DIR/showcase/app/<id>/, where scripts/build-showcase.mjs copies them. Everything else stays
// behind the token, and nothing here can change a showcased record.

import fs from 'node:fs/promises';
import path from 'node:path';

export const SHOWCASE_FILE = 'showcase.json';
export const SHOWCASE_DIR = 'showcase';
export const APP_ID = /^[a-z0-9][a-z0-9-]{2,60}$/u;
const JOB_ID = /^[a-f0-9-]{36}$/u;
// An app run keeps the starter as it was, the redesign and the captures its reviews judged.
export const APP_PARTS = Object.freeze(['before', 'after', 'captures']);
export const APP_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
});
// The app is the model's own code, so it runs sandboxed on the preview origin; it reads its data file, so it may
// connect to that origin, unlike a site preview.
export const SHOWCASE_APP_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors *; sandbox allow-scripts allow-forms";

export const EMPTY_SHOWCASE = Object.freeze({ sites: null, game: null, app: null, notes: [] });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const completed = job => job?.status === 'completed' && Array.isArray(job.runs) && job.runs.length > 0 && job.runs.every(run => run.status === 'completed');

/**
 * The showcase this Studio serves, from DATA_DIR/showcase.json: the ID of each entry that names a usable record, the
 * app run's record, and a note for each entry left out. `jobs` is the Studio's job map. A missing file is no showcase;
 * a broken one leaves its entries out without stopping the Studio.
 */
export async function loadShowcase({ dataDir, jobs }) {
  let raw;
  try { raw = JSON.parse(await fs.readFile(path.join(dataDir, SHOWCASE_FILE), 'utf8')); }
  catch (error) { return error.code === 'ENOENT' ? { ...EMPTY_SHOWCASE, notes: [] } : { ...EMPTY_SHOWCASE, notes: [`${SHOWCASE_FILE} could not be read: ${String(error.message).slice(0, 160)}`] }; }
  if (!plain(raw)) return { ...EMPTY_SHOWCASE, notes: [`${SHOWCASE_FILE} must hold an object.`] };
  const notes = [];
  const job = (key, accept, what) => {
    const id = raw[key];
    if (id === undefined || id === null) return null;
    if (typeof id !== 'string' || !JOB_ID.test(id)) { notes.push(`${key}: use a Studio job ID.`); return null; }
    const found = jobs.get(id);
    if (!found) { notes.push(`${key}: job ${id} is not in this Studio's data.`); return null; }
    if (!accept(found)) { notes.push(`${key}: job ${id} is not ${what}.`); return null; }
    return id;
  };
  const sites = job('sites', found => (found.kind || 'build') === 'build' && found.runs?.length === 2 && completed(found), 'a completed website comparison');
  const game = job('game', found => found.kind === 'character' && completed(found), 'a completed character pair');
  let app = null;
  if (raw.app !== undefined && raw.app !== null) {
    if (typeof raw.app !== 'string' || !APP_ID.test(raw.app)) notes.push('app: use the ID of a folder under showcase/app/.');
    else {
      const record = await fs.readFile(path.join(dataDir, SHOWCASE_DIR, 'app', raw.app, 'record.json'), 'utf8').then(JSON.parse, () => null);
      const entry = record && await fs.stat(path.join(dataDir, SHOWCASE_DIR, 'app', raw.app, 'after', 'index.html')).then(() => true, () => false);
      if (!plain(record) || record.id !== raw.app || !entry) notes.push(`app: showcase/app/${raw.app}/ needs its record.json and after/index.html; run scripts/build-showcase.mjs.`);
      else app = { id: raw.app, record };
    }
  }
  return { sites, game, app, notes };
}

/** Whether a job is part of the showcase, which a reviewer may read without the access token. */
export const isShowcaseJob = (showcase, id) => Boolean(id) && (showcase?.sites === id || showcase?.game === id);

/**
 * The file a showcase app URL names, inside the app's before/, after/ or captures/ folder, or null: only the listed
 * types, and never a hidden file, a parent step or a drive letter.
 */
export function showcaseAppFile({ dataDir, id, relative }) {
  if (typeof id !== 'string' || !APP_ID.test(id) || typeof relative !== 'string') return null;
  const parts = relative.split('/');
  if (parts.length < 2 || !APP_PARTS.includes(parts[0]) || parts.some(part => !part || part.startsWith('.') || /[\\:\0]/u.test(part))) return null;
  const type = APP_TYPES[path.extname(parts.at(-1)).toLowerCase()];
  return type ? { file: path.join(dataDir, SHOWCASE_DIR, 'app', id, ...parts), type } : null;
}
