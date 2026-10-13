// The moment's music: one track of the open music library, looped while the moment plays. Sound starts only when the
// player turns it on, and only one track plays at a time, so the comparison page never layers the two arms. Every
// track is credited where it can play, with its title, artist, licence and source, as CC BY asks.

const CATALOG = 'music/catalog.json';
const TRACK_FILE = /^[a-z0-9][a-z0-9-]{0,60}\.mp3$/u;
let catalog = null;
let active = null;

/** The library's record of a track ID, or null when the catalog or the track is missing. */
export async function findTrack(id) {
  if (typeof id !== 'string' || !id) return null;
  catalog ||= fetch(CATALOG, { cache: 'no-store' }).then(response => (response.ok ? response.json() : null)).catch(() => null);
  const data = await catalog;
  const track = Array.isArray(data?.tracks) ? data.tracks.find(item => item.id === id) : null;
  return track && TRACK_FILE.test(track.file || '') ? track : null;
}

/** A looping player for one track. `onChange(playing)` follows it, also when another player takes the sound over. */
export function createPlayer(track, { volume = 0.6, onChange = () => {} } = {}) {
  const audio = new Audio();
  audio.preload = 'none';
  audio.loop = true;
  audio.volume = Math.max(0, Math.min(1, volume));
  audio.src = `music/${track.file}`;
  audio.addEventListener('play', () => onChange(true));
  audio.addEventListener('pause', () => onChange(false));
  const player = {
    track,
    get playing() { return !audio.paused; },
    async play() {
      if (active && active !== player) active.stop();
      active = player;
      // A browser may refuse to play; the button then simply stays off.
      try { await audio.play(); } catch { if (active === player) active = null; onChange(false); }
    },
    stop() {
      audio.pause();
      if (active === player) active = null;
    },
    toggle() { return audio.paused ? player.play() : player.stop(); },
  };
  return player;
}

/** The credit for a track, linked to its source, artist and licence where the catalog gives https addresses. */
export function creditLine(track, className = 'credit') {
  const node = document.createElement('p');
  node.className = className;
  const link = (text, href) => {
    if (typeof href !== 'string' || !href.startsWith('https://')) return document.createTextNode(text);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = text;
    return anchor;
  };
  node.append('Music: “', link(track.title, track.sourceUrl), '” by ', link(track.artist, track.artistUrl), ', ', link(track.license, track.licenseUrl), `, via ${track.source}.`);
  return node;
}
