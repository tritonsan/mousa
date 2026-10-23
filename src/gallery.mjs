// The public gallery a Studio serves, from DATA_DIR/gallery: gallery.json, written by scripts/build-gallery.mjs only
// after its scan found nothing, and one folder per entry. It is read once at start, like the showcase. The app origin
// serves each entry's report and its pictures; the designs themselves, the model's own code, play only from the
// preview origin, sandboxed. Nothing here changes a record.

import fs from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_TYPES } from './gallery/sanitize.mjs';

export const GALLERY_DIR = 'gallery';
export const ENTRY_ID = /^[a-z0-9][a-z0-9-]{2,60}$/u;
const ARM = /^[a-z0-9][a-z0-9-]{0,60}$/u;
export const EMPTY_GALLERY = Object.freeze({ index: null, entries: new Map(), notes: [] });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

/**
 * The gallery this Studio serves: its index and each entry's record. A missing gallery.json is no gallery; an entry
 * whose folder is not usable is left out with a note.
 */
export async function loadGallery({ dataDir }) {
  const folder = path.join(dataDir, GALLERY_DIR);
  let index;
  try { index = JSON.parse(await fs.readFile(path.join(folder, 'gallery.json'), 'utf8')); }
  catch (error) { return { ...EMPTY_GALLERY, entries: new Map(), notes: error.code === 'ENOENT' ? [] : [`gallery.json could not be read: ${String(error.message).slice(0, 160)}`] }; }
  if (!plain(index) || !Array.isArray(index.entries)) return { ...EMPTY_GALLERY, entries: new Map(), notes: ['gallery.json must list its entries.'] };
  const entries = new Map(), notes = [];
  for (const item of index.entries) {
    if (!ENTRY_ID.test(item?.id || '')) { notes.push('An entry without a valid id was left out.'); continue; }
    const entry = await fs.readFile(path.join(folder, item.id, 'entry.json'), 'utf8').then(JSON.parse, () => null);
    const record = await fs.readFile(path.join(folder, item.id, 'report', 'record.json'), 'utf8').then(JSON.parse, () => null);
    if (!plain(entry) || entry.id !== item.id || !plain(record)) { notes.push(`${item.id}: its entry.json or report is missing; build the gallery again.`); continue; }
    entries.set(item.id, { ...entry, record });
  }
  // The blind spot benchmark's results (docs/benchmark/results.json), which build-gallery copies beside the index.
  const benchmark = await fs.readFile(path.join(folder, 'benchmark.json'), 'utf8').then(JSON.parse, () => null);
  return { index: { ...index, entries: index.entries.filter(item => entries.has(item.id)) }, entries, notes, ...(plain(benchmark) ? { benchmark } : {}) };
}

/** An arm's own report record inside a comparison entry, or null. */
export async function armRecord({ dataDir, id, arm }) {
  if (!ENTRY_ID.test(id || '') || !ARM.test(arm || '')) return null;
  return fs.readFile(path.join(dataDir, GALLERY_DIR, id, 'report', 'arms', arm, 'record.json'), 'utf8').then(JSON.parse, () => null);
}

/**
 * The file a gallery URL names inside one part of an entry (report, out or before), or null: only the public types,
 * and never a hidden file, a parent step or a drive letter.
 */
export function galleryFile({ dataDir, id, part, relative }) {
  if (!ENTRY_ID.test(id || '') || !['report', 'out', 'before'].includes(part) || typeof relative !== 'string') return null;
  const parts = relative.split('/');
  if (!parts.length || parts.some(item => !item || item.startsWith('.') || /[\\:\0]/u.test(item))) return null;
  const type = PUBLIC_TYPES[path.extname(parts.at(-1)).toLowerCase()];
  return type ? { file: path.join(dataDir, GALLERY_DIR, id, part, ...parts), type } : null;
}
