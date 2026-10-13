// The review captures of one character, drawn by the game's own code so its designer sees what a player sees. The
// host's capture server opens this page headless at each view's size: pose (the figure at rest, large, beside its
// 60-pixel silhouette and its 60-pixel figure), walk (six frames of one walk cycle), scene (the moment on the cliff
// road near the keeper) and kindle (the signature move as the beacon catches). window.captureReady settles once the
// view is drawn.

import { Game } from './game.js';
import { Actor } from './actor.js';
import { SCENE } from './world.js';
import { glow } from './particles.js';
import { RENDER_SETTINGS } from './render.js';
import { loadScene, localPath, showLoadError } from './loader.js';
import { drawFilmstrip, poseFrame, framesBounds, NO_PARTICLES } from './filmstrip.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || location.hash.slice(1) || 'pose';
const characterPath = localPath(params.get('character'), 'characters/ilo.json');
const STEP = 1 / 120;
const LABEL = '600 15px "Alegreya Sans", "Segoe UI", sans-serif';

/** The character at rest after a moment of idling in a light wind, so its cloth hangs as it does in play. */
function restingActor(character) {
  const actor = new Actor(character, { ground: () => 0, x: 0, facing: 1, seed: 3, bounds: [-1e9, 1e9] });
  for (let i = 0; i < 180; i++) actor.step(STEP, { wind: () => -40, particles: NO_PARTICLES });
  return actor;
}

/** Draw one frame of the actor standing on y = 0 at `scale`, its box centred on `centerX` and its feet on `baseline`. */
function drawStanding(ctx, actor, frame, bounds, { scale, centerX, baseline, outline }) {
  const middle = (bounds.minX + bounds.maxX) / 2;
  actor.painter.draw(ctx, [scale, 0, 0, scale, centerX - (frame.x + middle) * scale, baseline], frame, { outline });
  return { x: centerX - middle * scale, y: baseline };
}

function label(ctx, text, x, y, color = '#98a2b6') {
  ctx.save();
  ctx.font = LABEL;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.restore();
}

function drawPose(canvas, character) {
  const width = canvas.width = canvas.clientWidth, height = canvas.height = canvas.clientHeight;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#1d2638');
  sky.addColorStop(1, '#10151f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  const actor = restingActor(character), frame = poseFrame(actor), bounds = framesBounds(actor, [frame]);
  const outline = RENDER_SETTINGS[character.render?.preset]?.outline || null;
  const tall = bounds.maxY - bounds.minY, wide = bounds.maxX - bounds.minX;
  // The figure large on the left, its feet on a ground line.
  const area = { left: 36, right: width * 0.68, top: 64, bottom: height - 70 };
  const scale = Math.min((area.bottom - area.top) / tall, (area.right - area.left) / wide);
  const ground = area.bottom;
  ctx.strokeStyle = 'rgba(147,185,173,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(area.left, ground + 0.5); ctx.lineTo(area.right, ground + 0.5); ctx.stroke();
  label(ctx, 'At rest', area.left, 24);
  const centerX = (area.left + area.right) / 2;
  const light = character.light ? actor.lightPosition() : null;
  if (light) {
    // The carried light as it glows in play, beneath the figure.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const middle = (bounds.minX + bounds.maxX) / 2;
    glow(ctx, centerX + (light[0] - frame.x - middle) * scale, ground + light[1] * scale, Math.min(character.light.radius, 160) * scale * 0.5, character.light.color, 0.5);
    ctx.restore();
  }
  drawStanding(ctx, actor, frame, bounds, { scale, centerX, baseline: ground, outline });
  // At game size: 60 pixels tall, once as one dark shape on a pale ground and once in colour on the dusk.
  const small = 60 / tall, column = { left: width * 0.72, right: width - 28 };
  const panel = (top, bottom, fill) => { ctx.fillStyle = fill; ctx.fillRect(column.left, top, column.right - column.left, bottom - top); };
  const middleX = (column.left + column.right) / 2;
  label(ctx, '60 px silhouette', column.left, 120);
  panel(146, 386, '#cfc8b8');
  const shape = document.createElement('canvas');
  shape.width = width; shape.height = height;
  const shapeCtx = shape.getContext('2d');
  drawStanding(shapeCtx, actor, frame, bounds, { scale: small, centerX: middleX, baseline: 296, outline });
  shapeCtx.globalCompositeOperation = 'source-in';
  shapeCtx.fillStyle = '#141821';
  shapeCtx.fillRect(0, 0, width, height);
  ctx.drawImage(shape, 0, 0);
  label(ctx, '60 px', column.left, 470);
  panel(496, 736, '#1d2436');
  drawStanding(ctx, actor, frame, bounds, { scale: small, centerX: middleX, baseline: 646, outline });
}

function drawWalk(canvas, character) {
  drawFilmstrip(canvas, character, { count: 6, scale: 1, outline: RENDER_SETTINGS[character.render?.preset]?.outline || null });
}

/** The moment a player sees just before the greeting: the character has walked the cliff road and stands near the keeper. */
function drawScene(game) {
  const player = game.player.controller;
  for (let t = 0; t < 30 && player.x < SCENE.talkX - 240; t += STEP) game.step(STEP, { dir: 1, act: false });
  for (let t = 0; t < 1.2; t += STEP) game.step(STEP, { dir: 0, act: false });
  game.camera.target = game.followTarget();
  game.camera.snap();
  game.render();
}

/**
 * The signature move as the beacon catches: the greeting is taken as given, the character kindles from beside the
 * plinth, and the frame keeps the close view of the kindling before the camera would pull back along the cliffs.
 */
function drawKindle(game) {
  game.talked = true;
  game.player.reset({ x: SCENE.kindleX - 60, facing: 1 });
  game.startKindle();
  for (let t = 0; t < 20; t += STEP) {
    game.step(STEP, { dir: 0, act: false });
    if (game.world.ignition.active && game.world.ignition.t >= 0.9) break;
  }
  game.camera.target = { x: SCENE.kindleX + 70, y: -230, zoom: 0.84 };
  game.camera.snap();
  game.render();
}

async function draw() {
  const { canon, keeper, characters: [character] } = await loadScene([characterPath]);
  const canvas = document.getElementById('view');
  canvas.setAttribute('aria-label', `${character.name}: the ${view} view for the designer's review.`);
  await document.fonts.ready;
  if (view === 'pose') return drawPose(canvas, character);
  if (view === 'walk') return drawWalk(canvas, character);
  if (view !== 'scene' && view !== 'kindle') throw new Error(`There is no ${view} view: use pose, walk, scene or kindle.`);
  const game = new Game({ stage: document.getElementById('stage'), canvas, character, keeper, canon, reducedMotion: false, compact: false, start: 'explore' });
  return view === 'scene' ? drawScene(game) : drawKindle(game);
}

window.captureReady = draw().then(() => true, error => {
  showLoadError(document.getElementById('load-error'), error, 'The capture could not be drawn.');
  console.error(error);
  throw error;
});
