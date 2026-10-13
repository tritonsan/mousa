import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Builds library/music: tracks under CC0 or CC BY from Jamendo, found through the Openverse API, each kept with its
 * title, artist, licence, source page and the genres and tags its own catalogue gives it. A game character picks its
 * track by those tags, so a track's moods come from the library's metadata, never from the host. Run once with --run;
 * the result is committed so Studio runs never fetch music.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'library', 'music');
const API = 'https://api.openverse.org/v1/audio/';

// One search per mood or genre word. A track is kept only when its own genres or tags carry the word, so the search
// word finds candidates and the library's metadata decides; the word is recorded as foundBy for the audit.
const QUERIES = ['melancholic', 'atmospheric', 'peaceful', 'dreamy', 'mysterious', 'dark', 'epic', 'playful', 'happy', 'nostalgic', 'calm', 'energetic',
  'sad', 'adventure', 'hopeful', 'romantic', 'chiptune', 'celtic', 'piano', 'orchestral', 'folk', 'jazz', 'ambient', 'synthwave'];
const LIMITS = { minSeconds: 60, maxSeconds: 270, maxBytes: Math.round(4.5 * 1024 * 1024), perArtist: 2, pause: 13000 };
const LICENSES = { cc0: 'CC0', by: 'CC BY' };
const VOICE = new Set(['vocal', 'vocals', 'voice', 'female', 'male', 'singer', 'singing', 'rap', 'lyrics', 'choir']);

const slug = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
const words = values => [...new Set((values || []).flatMap(value => String(value).toLowerCase().split(/[\s_/,-]+/u)).filter(Boolean))];
// The stem rule the game's music device uses: the same word, or a close form (the same first five letters, lengths
// within three letters).
const sameStem = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 3 && a.slice(0, 5) === b.slice(0, 5));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(url, kind = 'json') {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'follow', headers: { 'User-Agent': 'long-dusk-music-library/1.0' } });
    if (response.ok) return kind === 'json' ? response.json() : Buffer.from(await response.arrayBuffer());
    // Anonymous Openverse requests are throttled; a 429 waits out the window.
    if (attempt >= 3 || (response.status < 500 && response.status !== 429)) throw new Error(`${url} returned ${response.status}.`);
    await pause(response.status === 429 ? 60000 : 2000 * (attempt + 1));
  }
}

const isMp3 = bytes => bytes.subarray(0, 3).toString('latin1') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);

function candidate(result, query, chosen) {
  if (result.category !== 'music' || result.source !== 'jamendo' || !LICENSES[result.license]) return null;
  const seconds = Math.round((result.duration || 0) / 1000);
  if (seconds < LIMITS.minSeconds || seconds > LIMITS.maxSeconds) return null;
  const genres = words(result.genres), tags = words((result.tags || []).map(tag => tag.name));
  // Background music for a scene with spoken subtitles: instrumental tracks only.
  if ([...genres, ...tags].some(word => VOICE.has(word))) return null;
  if (![...genres, ...tags].some(word => sameStem(word, query))) return null;
  if (chosen.some(track => track.openverseId === result.id) || chosen.filter(track => track.artist === result.creator).length >= LIMITS.perArtist) return null;
  return { result, seconds, genres, tags };
}

async function findTrack(query, chosen) {
  // Anonymous requests may ask for at most 20 results a page, so a word gets two pages.
  for (const number of [1, 2]) {
    if (number > 1) await pause(LIMITS.pause);
    const page = await get(`${API}?${new URLSearchParams({ q: query, license: 'cc0,by', source: 'jamendo', page_size: '20', page: String(number) })}`);
    const track = await pickFrom(page.results || [], query, chosen);
    if (track) return track;
  }
  return null;
}

async function pickFrom(results, query, chosen) {
  for (const result of results) {
    const item = candidate(result, query, chosen);
    if (!item) continue;
    const { genres, tags, seconds } = item;
    // Jamendo's small MP3 rendition (mp31) keeps the library light.
    const audio = String(result.url).replace(/format=mp3\d/u, 'format=mp31');
    if (!/^https:\/\/[a-z0-9.-]+\.jamendo\.com\//u.test(audio)) continue;
    const bytes = await get(audio, 'binary');
    if (!isMp3(bytes) || bytes.length > LIMITS.maxBytes) continue;
    const id = slug(`${result.title} ${result.creator}`).slice(0, 60).replace(/-$/u, '');
    if (chosen.some(track => track.id === id)) continue;
    const speed = (result.tags || []).map(tag => tag.name).find(name => /^speed_/u.test(name));
    const tempo = speed ? { speed_verylow: 'slow', speed_low: 'slow', speed_medium: 'medium', speed_high: 'fast', speed_veryhigh: 'fast' }[speed] || null : null;
    return { id, title: result.title.trim(), artist: result.creator.trim(), ...(result.creator_url ? { artistUrl: result.creator_url } : {}),
      license: `${LICENSES[result.license]}${result.license === 'cc0' ? ' 1.0' : ` ${result.license_version}`}`, licenseCode: result.license, licenseVersion: result.license_version, licenseUrl: result.license_url,
      source: 'Jamendo', sourceUrl: result.foreign_landing_url, openverseId: result.id, attribution: result.attribution,
      genres, tags: tags.filter(tag => !['speed', 'verylow', 'low', 'medium', 'high', 'veryhigh', 'instrumental'].includes(tag)), ...(tempo ? { tempo } : {}),
      duration: seconds, file: `${id}.mp3`, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), foundBy: query, audio: bytes };
  }
  return null;
}

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ queries: QUERIES.length, target: path.relative(root, target), licences: Object.values(LICENSES), instruction: 'Pass --run to search Openverse and download the tracks from Jamendo.' }, null, 2));
} else {
  await fs.mkdir(target, { recursive: true });
  // A rebuild starts clean; only the files this script writes are removed.
  for (const name of await fs.readdir(target)) if (/\.mp3$/u.test(name) || name === 'catalog.json') await fs.rm(path.join(target, name));
  const tracks = [], misses = [];
  for (const [index, query] of QUERIES.entries()) {
    if (index) await pause(LIMITS.pause);
    try {
      const track = await findTrack(query, tracks);
      if (!track) { misses.push(query); console.log(`${query}: no instrumental CC0 or CC BY track carries the word`); continue; }
      const { audio, ...entry } = track;
      await fs.writeFile(path.join(target, entry.file), audio);
      tracks.push(entry);
      console.log(`${query}: ${entry.title} by ${entry.artist} (${entry.license}, ${entry.duration} s, ${Math.round(entry.bytes / 1024)} KB) [${[...entry.genres, ...entry.tags].join(', ')}]`);
    } catch (error) { misses.push(query); console.log(`FAILED ${query}: ${error.message}`); }
  }
  const catalog = { schemaVersion: '1.0', source: 'Jamendo tracks found through the Openverse API (https://openverse.org). Genres and tags are each track\'s own catalogue metadata.',
    license: 'Each track is CC0 1.0 or CC BY 3.0/4.0 as listed; CC BY tracks are credited wherever they play.', retrievedAt: new Date().toISOString(), tracks };
  await fs.writeFile(path.join(target, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  const total = tracks.reduce((sum, track) => sum + track.bytes, 0);
  console.log(`${tracks.length} tracks, ${Math.round(total / 1024 / 1024 * 10) / 10} MB${misses.length ? `; no track for ${misses.join(', ')}` : ''}.`);
}
