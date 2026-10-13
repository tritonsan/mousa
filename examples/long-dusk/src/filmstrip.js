// Walk-cycle frames, drawn on a canvas: the character walks unseen for two seconds, then six evenly spaced poses are
// drawn on one ground line. The comparison page's character sheet and the review captures both show it.

import { Actor } from './actor.js';
import { transformPoint } from './math.js';

export const NO_PARTICLES = Object.freeze({ emit() {} });

/** The pose an actor holds now, kept for drawing later: its bone matrices and its cloth. */
export function poseFrame(actor) {
  const secondary = actor.secondary;
  return {
    x: actor.controller.x, matrices: { ...actor.matrices }, blink: 1, facing: 1,
    secondary: {
      angles: new Map(secondary.angles),
      byId: new Map([...secondary.byId].map(([id, chain]) => [id, { points: chain.points.map(point => ({ ...point })) }])),
      tipFrame: secondary.tipFrame,
    },
  };
}

/** The box around every frame, props and cloth included, rather than only the drawn standing pose; x is relative to each frame's own position. */
export function framesBounds(actor, frames) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: 0 };
  const include = (x, y) => {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  };
  for (const frame of frames) {
    for (const item of actor.rig.drawList) {
      if (item.kind === 'part') {
        const b = item.part.bounds, m = frame.matrices[item.key];
        for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) {
          const [px, py] = transformPoint(m, x, y);
          include(px - frame.x, py);
        }
      } else {
        const chain = frame.secondary.byId.get(item.chain.id);
        for (const point of chain?.points || []) include(point.x - frame.x, point.y);
        const end = chain?.points.at(-1);
        if (end && item.chain.tip) for (const shape of item.chain.tip) { include(end.x - frame.x + shape.bounds.minX, end.y + shape.bounds.minY); include(end.x - frame.x + shape.bounds.maxX, end.y + shape.bounds.maxY); }
      }
    }
  }
  return bounds;
}

export function drawFilmstrip(canvas, character, { count = 6, background = '#161d2d', scale: density = Math.min(devicePixelRatio || 1, 2), outline = null } = {}) {
  const width = Math.round(canvas.clientWidth * density);
  const height = Math.round(canvas.clientHeight * density);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const actor = new Actor(character, { ground: () => 0, x: 0, facing: 1, seed: 3, bounds: [-1e9, 1e9] });
  const controller = actor.controller;
  controller.input.dir = 1;
  const wind = () => -70;
  for (let i = 0; i < 260; i++) actor.step(1 / 120, { wind, particles: NO_PARTICLES });
  const frames = [];
  let travelled = 0, lastPhase = controller.phase, guard = 0;
  while (frames.length < count && guard++ < 6000) {
    if (travelled >= frames.length / count) {
      frames.push(poseFrame(actor));
      continue;
    }
    actor.step(1 / 240, { wind, particles: NO_PARTICLES });
    travelled += (controller.phase - lastPhase + 1) % 1;
    lastPhase = controller.phase;
  }
  const bounds = framesBounds(actor, frames);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const slot = width / count;
  const scale = Math.min((height * 0.86) / (bounds.maxY - bounds.minY), (slot * 0.94) / (bounds.maxX - bounds.minX));
  const baseline = height * 0.07 - bounds.minY * scale;
  const middle = (bounds.minX + bounds.maxX) / 2;
  ctx.strokeStyle = 'rgba(147,185,173,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, baseline + 0.5); ctx.lineTo(width, baseline + 0.5); ctx.stroke();
  frames.forEach((frame, index) => {
    const centerX = slot * (index + 0.5);
    actor.painter.draw(ctx, [scale, 0, 0, scale, centerX - (frame.x + middle) * scale, baseline], frame, { outline });
  });
  return { frames: frames.length, bounds };
}
