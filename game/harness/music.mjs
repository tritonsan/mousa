// The open music library for the moment: CC0 and CC BY tracks in library/music, each with the genres and tags its own
// catalogue gives it (scripts/fetch-music-library.mjs). The designing model reads music.json and picks a track whose
// genres or tags carry the qualities of its music device, so a measured run's track follows the measured tags.

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeTasteName } from '../../plugin/server/culture/taste.mjs';

export const MUSIC_PATH = /^music\/(?:[a-z0-9][a-z0-9-]{0,60}\.mp3|catalog\.json)$/u;
// Catalogue words that say nothing about a mood.
const PLAIN = new Set(['music', 'film', 'films', 'movie', 'movies', 'game', 'games', 'video', 'videos', 'show', 'shows', 'series', 'book', 'books', 'brand', 'brands',
  'song', 'songs', 'sound', 'neutral', 'commercial', 'education', 'free', 'loop', 'mix', 'extended', 'the', 'and']);

export async function loadMusicLibrary(rootDir) {
  try {
    const catalog = JSON.parse(await fs.readFile(path.join(rootDir, 'library', 'music', 'catalog.json'), 'utf8'));
    return Array.isArray(catalog.tracks) && catalog.tracks.length ? catalog : null;
  } catch { return null; }
}

/** What the designing model reads as music.json: each track's ID, title, artist, catalogue genres and tags, tempo, length and licence. */
export function musicListing(catalog) {
  return { about: 'Tracks for the moment, from an open music library. Genres and tags are each track\'s own catalogue metadata. A music device picks one track by ID; its genres or tags must share a word with a quality of the device, or a close form of it: the same first five letters in a word at most three letters longer or shorter.',
    tracks: catalog.tracks.map(({ id, title, artist, genres, tags, tempo, duration, license }) => ({ id, title, artist, genres, tags, ...(tempo ? { tempo } : {}), seconds: duration, license })) };
}

const words = values => [...new Set(values.flatMap(value => normalizeTasteName(value).split(' ')).filter(word => word.length >= 3 && !PLAIN.has(word)))];
// A close form shares the first five letters and differs in length by at most three letters. A live pair matched the
// aesthetic tag Classic Lines to a track's "classicalguitar" on the first five letters alone.
const sameStem = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 3 && a.slice(0, 5) === b.slice(0, 5));

/** The qualities' words a track carries in its genres or tags: the same word or a close form, so Melancholy meets melancholic. */
export function sharedMoods(track, qualities) {
  const own = words([...(track?.genres || []), ...(track?.tags || [])]);
  return words(qualities || []).filter(word => own.some(other => sameStem(word, other)));
}

/** Tracks that carry at least one of these qualities, best matched first. */
export function tracksFor(tracks, qualities) {
  return tracks.map(track => ({ track, moods: sharedMoods(track, qualities) })).filter(item => item.moods.length).sort((a, b) => b.moods.length - a.moods.length);
}

/** A credit line for a track: title, artist and licence, as CC BY asks. */
export const musicCredit = track => `"${track.title}" by ${track.artist}, ${track.license} (${track.source})`;

/**
 * The file a game page's music URL names: the catalog, or a track the catalog lists. Anything else in library/music,
 * or outside it, is not reachable. Returns {file, type} or null.
 */
export function musicLibraryFile(rootDir, catalog, requested) {
  if (!catalog || typeof requested !== 'string' || !MUSIC_PATH.test(requested)) return null;
  const folder = path.join(rootDir, 'library', 'music');
  if (requested === 'music/catalog.json') return { file: path.join(folder, 'catalog.json'), type: 'application/json; charset=utf-8' };
  const track = catalog.tracks.find(item => `music/${item.file}` === requested);
  return track ? { file: path.join(folder, track.file), type: 'audio/mpeg' } : null;
}

/**
 * The single byte range a Range header asks of a file of `size` bytes, as an audio element sends it: {start, end},
 * null to send the whole file (no header, or one this server does not split, such as several ranges), or false when
 * the range lies outside the file.
 */
export function byteRange(header, size) {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? false : { start, end };
}

/** Sends a library file, honouring a single Range so the audio element can stream and seek. */
export async function sendLibraryFile(request, response, { file, type }, headers = {}) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const range = type === 'audio/mpeg' ? byteRange(request.headers.range, size) : null;
    const base = { ...headers, 'Content-Type': type, 'Accept-Ranges': type === 'audio/mpeg' ? 'bytes' : 'none', 'Cache-Control': 'private, max-age=3600' };
    if (range === false) { response.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` }); response.end(); return; }
    const { start, end } = range || { start: 0, end: size - 1 };
    const length = Math.max(0, end - start + 1);
    response.writeHead(range ? 206 : 200, { ...base, 'Content-Length': String(length), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    if (request.method === 'HEAD' || !length) { response.end(); return; }
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    response.end(buffer);
  } finally { await handle.close(); }
}
