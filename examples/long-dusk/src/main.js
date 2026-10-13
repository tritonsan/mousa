// The single-character page: one lamplighter, the full moment, from the title card to the lit beacon.

import { Game } from './game.js';
import { Input } from './input.js';
import { loadScene, localPath, showLoadError } from './loader.js';
import { findTrack, createPlayer, creditLine } from './music.js';

const params = new URLSearchParams(location.search);
const characterPath = localPath(params.get('character'), 'characters/ilo.json');
const stage = document.getElementById('stage');
const titleCard = document.getElementById('title-card');
const pause = document.getElementById('pause');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

try {
  const { canon, keeper, characters: [character] } = await loadScene([characterPath]);
  document.getElementById('premise').textContent = canon.premise;
  const canvas = document.getElementById('view');
  canvas.setAttribute('aria-label', `${canon.scene.summary} ${character.name} the ${character.role.toLowerCase()}: ${character.description}`);
  const game = new Game({ stage, canvas, character, keeper, canon, reducedMotion, start: 'title' });
  const input = new Input();
  input.bindTouch(document.querySelector('.touch'));

  const showTitle = state => { titleCard.hidden = state !== 'title'; };
  game.onState = showTitle;
  showTitle(game.state);
  document.getElementById('begin').addEventListener('click', () => { game.begin(); stage.focus?.(); });
  const setPaused = paused => {
    game.paused = paused;
    pause.setAttribute('aria-pressed', String(paused));
    pause.textContent = paused ? 'Resume' : 'Pause';
  };
  pause.addEventListener('click', () => setPaused(!game.paused));

  const debug = { game, input, music: null, frames: 0, error: null };
  // The character's track, when it sets one: off until the player turns it on, credited on the title card and while it plays.
  findTrack(character.music?.track).then(track => {
    if (!track) return;
    const button = document.getElementById('music'), nowPlaying = document.getElementById('now-playing');
    const music = createPlayer(track, { volume: character.music.volume, onChange: playing => {
      button.setAttribute('aria-pressed', String(playing));
      nowPlaying.hidden = !playing;
    } });
    button.hidden = false;
    button.title = `${track.title} by ${track.artist}`;
    button.addEventListener('click', () => music.toggle());
    const credit = document.getElementById('title-credit');
    credit.append(creditLine(track));
    credit.hidden = false;
    nowPlaying.append(creditLine(track));
    debug.music = music;
  });

  let last = null;
  const frame = now => {
    requestAnimationFrame(frame);
    const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    debug.frames++;
    try {
      const pressed = input.take();
      if (pressed.has('pause')) setPaused(!game.paused);
      if (game.state === 'title' && pressed.has('act')) game.begin();
      game.frame(dt, { dir: input.dir, act: pressed.has('act'), replay: pressed.has('replay') && game.state !== 'title' });
    } catch (error) {
      // Report once and keep the loop alive, so one bad frame does not freeze the moment.
      if (!debug.error) { debug.error = error; console.error(error); }
    }
  };
  requestAnimationFrame(frame);
  window.longDusk = debug;
} catch (error) {
  titleCard.hidden = true;
  showLoadError(document.getElementById('load-error'), error);
  console.error(error);
}
