// The comparison page: the same moment twice, side by side, with one input walking both lamplighters and a
// character sheet under each (palette, walk-cycle frames, motion profile and lines).

import { Game, Autopilot } from './game.js';
import { Input } from './input.js';
import { loadScene, localPath, showLoadError } from './loader.js';
import { Actor } from './actor.js';
import { strideLength } from './motion.js';
import { drawFilmstrip } from './filmstrip.js';
import { loadPair, renderRecord, renderSheetPortrait, pairNotice, PairError } from './record.js';
import { RENDER_PRESETS, completeScene } from './scene.js';
import { findTrack, createPlayer, creditLine } from './music.js';

const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// The Studio frames this page under its own heading and full-screen links.
if (params.get('embed') === '1') document.body.classList.add('embedded');

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const append = (parent, ...children) => { parent.append(...children); return parent; };

/** An arm's track: a toggle beside its label, one arm at a time, and the credit under its sheet. */
async function armMusic(arm, character, label) {
  const track = await findTrack(character.music?.track);
  if (!track) return null;
  const button = arm.querySelector('.arm-music');
  const player = createPlayer(track, { volume: character.music.volume, onChange: playing => button.setAttribute('aria-pressed', String(playing)) });
  button.hidden = false;
  button.setAttribute('aria-label', `Music for ${label}: ${track.title} by ${track.artist}`);
  button.addEventListener('click', () => player.toggle());
  arm.querySelector('.sheet').append(creditLine(track, 'credit sheet-credit'));
  return player;
}

function renderSheet(sheet, character) {
  sheet.replaceChildren();
  const name = element('h3', 'sheet-name', `${character.name} `);
  name.append(element('span', '', character.role));
  const head = element('div', 'sheet-head');
  const intro = element('div', 'sheet-intro');
  intro.append(name, element('p', 'sheet-description', character.description));
  head.append(intro);
  sheet.append(head);
  const swatches = element('ul', 'swatches');
  swatches.setAttribute('aria-label', 'Palette');
  for (const [key, color] of Object.entries(character.palette)) {
    const item = element('li');
    item.style.background = color;
    item.title = `${key} ${color}`;
    item.append(element('span', 'visually-hidden', `${key} ${color}`));
    swatches.append(item);
  }
  const strip = element('canvas', 'filmstrip');
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', `${character.name}'s walk cycle in six frames.`);
  const { walk, idle, turn } = character.motion;
  const legs = (() => { const actor = new Actor(character, { ground: () => 0, x: 0 }); return { stride: strideLength(character, actor.rig) / actor.rig.legLength, leg: actor.rig.legLength }; })();
  const facts = element('dl', 'facts');
  const fact = (term, value) => facts.append(element('dt', '', term), element('dd', '', value));
  fact('Pace', `${walk.cadence.toFixed(1)} steps a second, strides of ${legs.stride.toFixed(2)} leg lengths`);
  fact('Bounce', `${Math.round(walk.bounciness * 100)}% springy, bob ${(walk.bob * 100).toFixed(1)}% of the leg, squash ${(walk.squash * 100).toFixed(0)}%`);
  fact('Carriage', `leans ${walk.lean}°, arms swing ${walk.armSwing}°, head ${walk.headStabilize >= 0.6 ? 'held level' : 'rides with the step'}`);
  fact('At rest', `${idle.breathRate} breaths a minute, glances ${idle.lookAround >= 0.6 ? 'often' : idle.lookAround >= 0.3 ? 'now and then' : 'rarely'}`);
  fact('Turn', `${turn.style} in ${turn.duration.toFixed(2)} s`);
  if (character.light) fact('Flame', `${character.light.color}, reaches ${character.light.radius} units`);
  // The moment the character file sets: its render style, weather and beacons under its own sky.
  const style = RENDER_PRESETS[character.render?.preset]?.label || RENDER_PRESETS.lit.label;
  if (character.scene) {
    const scene = completeScene(character.scene);
    const sky = element('span', 'sky');
    sky.setAttribute('aria-hidden', 'true');
    sky.style.background = `linear-gradient(90deg, ${scene.sky[0]}, ${scene.sky[1]})`;
    facts.append(element('dt', '', 'Moment'), append(element('dd'), sky, `${style}; ${scene.weather.kind === 'none' ? 'clear air' : scene.weather.kind}; ${scene.towers} beacons; sky ${scene.sky.join(' to ')}`));
  } else fact('Moment', `${style}, the original dusk`);
  const voice = element('ul', 'voice');
  voice.setAttribute('aria-label', 'Lines');
  for (const [cue, key] of [['Arrival', 'arrive'], ['Greeting', 'greet'], ['Kindling', 'kindle'], ['Closing', 'after']]) {
    const item = element('li');
    item.append(element('span', 'cue', cue), element('q', '', character.lines[key]));
    voice.append(item);
  }
  sheet.append(swatches, strip, facts, voice);
  requestAnimationFrame(() => drawFilmstrip(strip, character));
}

/** A pair record names each arm's saved character; the samples stand in when the page is opened without one. */
async function chooseCharacters() {
  const pairId = params.get('pair');
  if (pairId === null) {
    return { pair: null, paths: [localPath(params.get('a'), 'samples/sample-a.json'), localPath(params.get('b'), 'samples/sample-b.json')],
      labels: [params.get('la') || 'Sample A', params.get('lb') || 'Sample B'].map(label => label.slice(0, 40)) };
  }
  const pair = await loadPair(pairId);
  const paths = pair.arms.map(arm => {
    const file = localPath(arm.character, null);
    if (!file) throw new PairError(`${arm.label} has no playable character in this record.`, 'Write the pair again with game/harness/run-pair.mjs.');
    return file;
  });
  return { pair, paths, labels: pair.arms.map(arm => String(arm.label).slice(0, 40)) };
}

try {
  const { pair, paths, labels } = await chooseCharacters();
  const { canon, keeper, characters } = await loadScene(paths);
  const arms = [document.getElementById('arm-a'), document.getElementById('arm-b')];
  const games = characters.map((character, index) => {
    const arm = arms[index];
    arm.querySelector('.arm-label').textContent = labels[index];
    const play = arm.querySelector('.arm-play');
    play.href = `index.html?character=${encodeURIComponent(paths[index])}`;
    play.setAttribute('aria-label', `Play ${labels[index]} full screen`);
    const stage = arm.querySelector('.stage');
    const canvas = arm.querySelector('canvas');
    canvas.setAttribute('aria-label', `${labels[index]}: ${character.name} on the Vesper Cliffs. ${character.description}`);
    const sheet = arm.querySelector('.sheet');
    renderSheet(sheet, character);
    if (pair) renderSheetPortrait(sheet, pair.arms[index]);
    armMusic(arm, character, labels[index]);
    return new Game({ stage, canvas, character, keeper, canon, reducedMotion, compact: true, start: 'explore' });
  });
  if (pair) {
    document.title = `The Long Dusk: ${labels.join(' and ')}`;
    const swap = pair.protocol?.swap;
    document.getElementById('compare-lede').textContent = swap
      ? `One moment on the Vesper Cliffs, two lamplighters from the same brief and prompt, both designed from measured Qloo data: ${labels[0]} from this brief's profile, ${labels[1]} from the profile recorded for ${swap.from}.`
      : `One moment on the Vesper Cliffs, two lamplighters designed from the same brief: Qloo off from the model's own guess at the audience, Qloo on from measured Qloo taste data and the qualities its works share.${pair.protocol?.artDirection ? ' Each also set the moment: its sky, weather, beacons, render style and music.' : ''}`;
    const notice = pairNotice(pair);
    if (notice) Object.assign(document.getElementById('run-notice'), { textContent: notice, hidden: false });
    renderRecord(document.getElementById('record'), pair);
    document.getElementById('record-link').hidden = false;
  }
  const input = new Input();
  input.onManual(() => { for (const game of games) game.autopilot = null; });
  const pause = document.getElementById('pause');
  const setPaused = paused => {
    for (const game of games) game.paused = paused;
    pause.setAttribute('aria-pressed', String(paused));
    pause.textContent = paused ? 'Resume' : 'Pause';
  };
  document.getElementById('play-moment').addEventListener('click', () => {
    setPaused(false);
    for (const game of games) { game.reset({ state: 'intro' }); game.autopilot = new Autopilot(game); }
  });
  document.getElementById('reset').addEventListener('click', () => {
    for (const game of games) { game.autopilot = null; game.reset({ state: 'explore' }); }
  });
  pause.addEventListener('click', () => setPaused(!games[0].paused));

  const debug = { games, input, frames: 0, error: null };
  let last = null;
  const frame = now => {
    requestAnimationFrame(frame);
    const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    debug.frames++;
    try {
      const pressed = input.take();
      if (pressed.has('pause')) setPaused(!games[0].paused);
      const replay = pressed.has('replay');
      for (const game of games) game.frame(dt, { dir: input.dir, act: pressed.has('act'), replay });
    } catch (error) {
      if (!debug.error) { debug.error = error; console.error(error); }
    }
  };
  requestAnimationFrame(frame);
  window.longDusk = debug;
} catch (error) {
  showLoadError(document.getElementById('load-error'), error, error.hint);
  console.error(error);
}
