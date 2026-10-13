// One playable instance of the moment: world, camera, the lamplighter and the keeper, the story beats and the
// lit render pipeline. The comparison page runs two instances side by side with one shared input.

import { World, SCENE, groundAt } from './world.js';
import { Camera } from './camera.js';
import { Actor } from './actor.js';
import { GameUI } from './ui.js';
import { glow } from './particles.js';
import { rgba, mixHex } from './math.js';
import { Finish } from './render.js';

const STEP = 1 / 120;
const MAX_DPR = 1.5;
const MAX_WIDTH = 1920;

function makeGrain(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  let seed = 12345;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const value = (seed >>> 24) & 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Plays the moment by itself: walk, listen, kindle, then stop at the overlook. */
export class Autopilot {
  constructor(game) {
    this.game = game;
    this.wait = 0;
    this.finished = false;
  }

  next(dt) {
    const game = this.game, controller = game.player.controller;
    let dir = 0, act = false;
    switch (game.state) {
      case 'title':
        act = true;
        break;
      case 'explore':
        if (!game.talked) dir = 1;
        else {
          const distance = SCENE.kindleX - controller.x;
          if (Math.abs(distance) > 30) dir = Math.sign(distance);
          else if ((this.wait += dt) > 0.5) { act = true; this.wait = 0; }
        }
        break;
      case 'dialogue':
        if (game.ui.done && (this.wait += dt) > 0.9 + game.ui.text.length * 0.035) { act = true; this.wait = 0; }
        break;
      case 'free': {
        const distance = SCENE.overlookX - controller.x;
        if (Math.abs(distance) > 16) dir = Math.sign(distance);
        else this.finished = true;
        break;
      }
      default:
        break;
    }
    return { dir, act };
  }
}

export class Game {
  constructor({ stage, canvas, character, keeper, canon, reducedMotion = false, compact = false, start = 'title' }) {
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.near = document.createElement('canvas');
    this.nearCtx = this.near.getContext('2d');
    this.lightmap = document.createElement('canvas');
    this.lightCtx = this.lightmap.getContext('2d');
    this.canon = canon;
    this.compact = compact;
    this.reducedMotion = reducedMotion;
    // The lamplighter's file carries the moment's art direction: the scene, and the render style that finishes it.
    this.finish = new Finish(character.render?.preset || 'lit', { reducedMotion });
    if (!this.finish.direct) { this.frameCanvas = document.createElement('canvas'); this.frameCtx = this.frameCanvas.getContext('2d'); }
    this.world = new World({ reducedMotion, scene: character.scene, style: this.finish.world });
    this.camera = new Camera();
    this.camera.limits = [SCENE.left + 40, SCENE.right - 140];
    this.player = new Actor(character, { ground: groundAt, x: SCENE.entryX, facing: 1, seed: 11, bounds: [SCENE.entryX - 10, SCENE.maxX] });
    this.keeper = new Actor(keeper, { ground: groundAt, x: SCENE.keeperX, facing: -1, seed: 23, bounds: [SCENE.keeperX, SCENE.keeperX] });
    this.ui = new GameUI(stage, { reducedMotion, compact });
    this.grain = makeGrain();
    this.accumulator = 0;
    this.time = 0;
    this.paused = false;
    this.autopilot = null;
    this.onState = null;
    this.reset({ state: start });
  }

  reset({ state = 'intro' } = {}) {
    this.world.reset();
    const startX = state === 'explore' ? SCENE.introStopX : SCENE.entryX;
    this.player.reset({ x: startX, facing: 1 });
    this.keeper.reset({ x: SCENE.keeperX, facing: -1 });
    this.player.controller.locked = false;
    this.ui.reset();
    this.talked = false;
    this.kindle = null;
    this.lines = [];
    this.lineIndex = -1;
    this.speaker = null;
    this.setState(state);
    this.camera.target = state === 'title' ? { x: 520, y: -560, zoom: 0.92 } : this.followTarget();
    this.camera.snap();
    if (state === 'explore') this.ui.objective('Follow the cliff road to the beacon.');
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
    this.onState?.(state);
  }

  begin() {
    if (this.state === 'title') this.setState('intro');
  }

  followTarget() {
    const controller = this.player.controller;
    // The road sits in the lower third, leaving the sky, the cloud sea and the far towers in view. The
    // comparison's smaller views move closer, because there the character is the subject.
    const zoom = this.compact ? 1.3 : 1;
    return { x: controller.x + controller.facing * (this.compact ? 40 : 70), y: groundAt(controller.x) - (this.compact ? 130 : 160), zoom };
  }

  /** Advance by a frame's worth of fixed steps. `input` is { dir, act, replay } for this frame. */
  frame(dt, input = { dir: 0, act: false }) {
    if (input.replay) this.reset({ state: 'intro' });
    if (!this.paused) {
      this.accumulator += Math.min(dt, 0.1);
      let act = input.act;
      while (this.accumulator >= STEP) {
        const stepInput = this.autopilot && !this.autopilot.finished ? this.autopilot.next(STEP) : { dir: input.dir, act };
        this.step(STEP, stepInput);
        act = false;
        this.accumulator -= STEP;
      }
    }
    this.render();
  }

  step(dt, input) {
    this.time += dt;
    this.stateTime += dt;
    const player = this.player.controller, keeper = this.keeper.controller;
    const script = this.canon.script, lines = this.player.character.lines;
    let prompt = null;

    switch (this.state) {
      case 'title':
        player.input.dir = 0;
        this.camera.target = { x: 520 + Math.sin(this.time * 0.05) * 40, y: -560, zoom: 0.92 };
        if (input.act) this.setState('intro');
        break;
      case 'intro':
        player.input.dir = player.x < SCENE.introStopX ? 1 : 0;
        if (player.x >= SCENE.introStopX && player.vx === 0 && this.stateTime > 1) {
          this.ui.subtitle(lines.arrive, 3.4);
          this.ui.objective('Follow the cliff road to the beacon.');
          this.setState('explore');
        }
        this.camera.target = this.followTarget();
        break;
      case 'explore': {
        player.input.dir = input.dir;
        if (!this.talked && player.x >= SCENE.talkX) { this.startDialogue('greeting'); break; }
        const atBeacon = this.talked && Math.abs(player.x - SCENE.kindleX) < SCENE.kindleRange;
        if (atBeacon) {
          prompt = 'Kindle the beacon';
          if (input.act) { this.startKindle(); prompt = null; }
        }
        this.camera.target = this.followTarget();
        break;
      }
      case 'dialogue':
        if (input.act) { if (this.ui.done) this.nextLine(); else this.ui.revealAll(); }
        this.camera.target = { x: (player.x + keeper.x) / 2, y: groundAt(player.x) - (this.compact ? 120 : 150), zoom: this.compact ? 1.5 : 1.16 };
        break;
      case 'kindle':
        this.stepKindle(dt);
        break;
      case 'free':
        player.input.dir = input.dir;
        this.camera.target = this.followTarget();
        break;
      default:
        break;
    }

    // The keeper turns to meet the lamplighter once they are close, and watches the beacon once it burns.
    if (this.state !== 'dialogue') {
      if (this.world.kindled) keeper.lookAt = [SCENE.beaconX, SCENE.bowlY];
      else if (Math.abs(player.x - keeper.x) < 420) keeper.face(Math.sign(player.x - keeper.x) || -1);
    }

    const wind = x => this.world.windAt(x);
    const events = this.player.step(dt, { wind, particles: this.world.particles });
    this.keeper.step(dt, { wind, particles: this.world.particles });
    for (const event of events) if (event.type === 'kindle' && this.kindle) this.igniteFromPlayer();
    this.world.update(dt, [player, keeper]);
    this.ui.update(dt);
    if (prompt) {
      const head = this.player.headPosition();
      const [sx, sy] = this.camera.toScreen(head[0], head[1] - this.player.rig.height * 0.32);
      const scale = this.canvas.clientWidth / (this.canvas.width || 1);
      this.ui.prompt(prompt, [sx * scale, sy * scale]);
    } else this.ui.prompt(null);
    this.camera.update(dt, this.state === 'kindle' ? 1.6 : 2.6, this.state === 'kindle' ? 1.1 : 2);
  }

  startDialogue(kind) {
    const player = this.player.controller, keeper = this.keeper.controller;
    const script = this.canon.script, lines = this.player.character.lines;
    this.dialogueKind = kind;
    this.lines = kind === 'greeting'
      ? [{ who: 'keeper', text: script.keeperGreeting, clip: 'greet' }, { who: 'player', text: lines.greet, clip: 'greet' }, { who: 'keeper', text: script.keeperRequest }]
      : [{ who: 'keeper', text: script.keeperAfter }, { who: 'player', text: lines.after }];
    this.lineIndex = -1;
    player.input.dir = 0;
    player.locked = true;
    player.face(Math.sign(keeper.x - player.x) || 1);
    keeper.face(Math.sign(player.x - keeper.x) || -1);
    player.lookAt = this.keeper.headPosition();
    keeper.lookAt = this.player.headPosition();
    this.ui.objective('');
    this.setState('dialogue');
    this.nextLine();
  }

  nextLine() {
    this.lineIndex++;
    const player = this.player.controller, keeper = this.keeper.controller;
    if (this.lineIndex >= this.lines.length) {
      this.ui.closeDialogue();
      this.speaker = null;
      player.locked = false;
      player.lookAt = null;
      keeper.lookAt = null;
      if (this.dialogueKind === 'greeting') {
        this.talked = true;
        this.ui.objective('Kindle the beacon.');
        this.setState('explore');
      } else {
        this.ui.objective('The beacon is lit.');
        this.setState('free');
      }
      return;
    }
    const line = this.lines[this.lineIndex];
    const actor = line.who === 'keeper' ? this.keeper : this.player;
    this.speaker = actor;
    this.ui.say(actor.character.name, line.text);
    if (line.clip) actor.controller.playClip(line.clip, { lock: true });
  }

  startKindle() {
    this.kindle = { walking: true, delay: 0.3, started: false, ended: false, ignitedAt: null };
    this.ui.objective('');
    this.setState('kindle');
  }

  stepKindle(dt) {
    const player = this.player.controller;
    const kindle = this.kindle;
    if (kindle.walking) {
      // Step closer to the plinth if needed; the character eases to a stop, so close enough is enough.
      const distance = SCENE.kindleX - player.x;
      if (Math.abs(distance) > 26) { player.locked = false; player.input.dir = Math.sign(distance); }
      else { player.input.dir = 0; player.locked = true; kindle.walking = false; }
    } else if (!kindle.started) {
      player.input.dir = 0;
      player.face(1);
      if (!player.turn && player.vx === 0 && (kindle.delay -= dt) <= 0) {
        kindle.started = true;
        player.lookAt = [SCENE.beaconX, SCENE.bowlY];
        player.playClip('signature', { lock: true, onEnd: () => { kindle.ended = true; } });
        this.ui.subtitle(this.player.character.lines.kindle, 2.8);
      }
    }
    const since = kindle.ignitedAt === null ? null : this.world.ignition.t;
    if (since === null) {
      this.camera.target = { x: SCENE.kindleX + 70, y: -205, zoom: this.compact ? 1 : 0.9 };
    } else if (since < 6.6) {
      // Pull back to show the light travelling along the cliffs to the far towers.
      const wide = since > 0.5;
      this.camera.target = wide ? { x: 2160, y: -270, zoom: this.compact ? 0.62 : 0.6 } : { x: SCENE.kindleX + 70, y: -230, zoom: this.compact ? 0.92 : 0.84 };
    } else {
      this.camera.target = this.followTarget();
      if (kindle.ended && since > 7.2) {
        player.lookAt = null;
        this.startDialogue('after');
      }
    }
  }

  igniteFromPlayer() {
    if (this.kindle.ignitedAt !== null) return;
    this.kindle.ignitedAt = this.time;
    const light = this.player.character.light;
    this.world.ignite({ color: light ? light.color : '#ffd28a', from: this.player.lightPosition() || this.player.chestPosition() });
  }

  lights() {
    const list = this.world.lights();
    const own = this.player.light(this.time);
    if (own) list.push(own);
    // A soft, neutral fill keeps each character's own colours readable in the dusk.
    for (const [actor, intensity] of [[this.player, 0.5], [this.keeper, 0.32]]) {
      const [x, y] = actor.chestPosition();
      list.push({ x, y: y + 10, radius: actor.rig.height * 1.35, color: '#dde3ef', intensity });
    }
    return list;
  }

  resize() {
    const cssWidth = this.canvas.clientWidth, cssHeight = this.canvas.clientHeight;
    if (!cssWidth || !cssHeight) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR, MAX_WIDTH / cssWidth);
    const width = Math.round(cssWidth * dpr), height = Math.round(cssHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      for (const canvas of [this.canvas, this.near, this.lightmap, this.frameCanvas].filter(Boolean)) { canvas.width = width; canvas.height = height; }
      this.camera.resize(width, height);
    }
    return true;
  }

  drawActors(ctx) {
    const view = this.camera.view(1), outline = this.finish.outline;
    this.keeper.drawShadow(ctx, view);
    this.player.drawShadow(ctx, view);
    this.keeper.draw(ctx, view, { outline });
    this.player.draw(ctx, view, { outline });
  }

  render() {
    if (!this.resize()) return;
    const { camera, world, finish } = this;
    // The default style draws straight to the screen; the others draw a frame first and finish it on the way there.
    const ctx = finish.direct ? this.ctx : this.frameCtx;
    const width = this.canvas.width, height = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    world.drawBackdrop(ctx, camera);

    const near = this.nearCtx;
    near.setTransform(1, 0, 0, 1, 0, 0);
    near.globalCompositeOperation = 'source-over';
    near.globalAlpha = 1;
    near.clearRect(0, 0, width, height);
    world.drawNear(near, camera, target => this.drawActors(target));

    // Lightmap: ambient plus every light, kept only where the near layer has content, then multiplied in.
    const light = this.lightCtx;
    light.setTransform(1, 0, 0, 1, 0, 0);
    light.globalCompositeOperation = 'source-over';
    light.globalAlpha = 1;
    light.fillStyle = world.ambient();
    light.fillRect(0, 0, width, height);
    light.globalCompositeOperation = 'lighter';
    const unit = camera.scaleFor(1);
    for (const source of this.lights()) {
      const [x, y] = camera.toScreen(source.x, source.y);
      const radius = source.radius * unit;
      if (x < -radius || x > width + radius || y < -radius || y > height + radius) continue;
      const gradient = light.createRadialGradient(x, y, 0, x, y, radius);
      for (const [offset, alpha] of finish.lightStops(source.intensity)) gradient.addColorStop(offset, rgba(source.color, alpha));
      light.fillStyle = gradient;
      light.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    light.globalCompositeOperation = 'destination-in';
    light.drawImage(this.near, 0, 0);
    near.globalCompositeOperation = 'multiply';
    near.drawImage(this.lightmap, 0, 0);
    near.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.near, 0, 0);

    world.drawWeather(ctx, camera);
    world.drawGlows(ctx, camera);
    const own = this.player.light(this.time);
    if (own) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const [x, y] = camera.toScreen(own.x, own.y);
      glow(ctx, x, y, 56 * unit, own.color, 0.6 * own.intensity);
      glow(ctx, x, y, 10 * unit, '#ffffff', 0.55 * own.intensity);
      ctx.restore();
    }

    // Vignette and a fine grain, so the flat shapes sit in one atmosphere, or the render style's own finish.
    finish.overlay(ctx, { width, height, grain: this.grain, time: this.time });
    if (!finish.direct) finish.present(this.ctx, this.frameCanvas);

    if (this.speaker && !this.ui.dialogue.hidden) this.drawPortrait();
  }

  drawPortrait() {
    const canvas = this.ui.portrait;
    const size = Math.round((canvas.clientWidth || 88) * Math.min(window.devicePixelRatio || 1, 2));
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The portrait sits in the scene's own dusk; the original scene keeps its original backdrop.
    const colors = this.world.colors, original = !this.player.character.scene;
    const backdrop = ctx.createRadialGradient(size * 0.5, size * 0.4, size * 0.05, size * 0.5, size * 0.5, size * 0.7);
    backdrop.addColorStop(0, original ? '#45597a' : mixHex(colors.middle, colors.upper, 0.45));
    backdrop.addColorStop(1, original ? '#161c2b' : mixHex(colors.zenith, '#000000', 0.25));
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, size, size);
    const actor = this.speaker;
    const [hx, hy] = actor.headPosition();
    const scale = size / (actor.rig.height * 0.6);
    actor.draw(ctx, [scale, 0, 0, scale, size / 2 - hx * scale, size * 0.52 - hy * scale], { outline: this.finish.outline });
  }
}
