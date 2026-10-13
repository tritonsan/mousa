// Weather over the moment: particles in a few depths that tile the air around the camera, so it is full wherever the
// camera looks. Far depths sit behind the cliffs, near ones in front of the road. Fireflies keep their place low over
// the road, as the original scene had them. Everything is seeded, so both lamplighters of a pair share the same air.

import { lerp, clamp, seededRandom, valueNoise, TAU, rgba, mixHex } from './math.js';
import { glow } from './particles.js';

// Per kind: depths (parallax factor, particle count at density 0 and 1), how particles move and how they are drawn.
const KINDS = {
  snow: { layers: [[0.42, 40, 190], [0.8, 26, 130], [1.18, 6, 36]], fall: [16, 34], drift: 0.09, sway: 16, size: [1.1, 2.6], shape: 'flake', alpha: 0.85 },
  rain: { layers: [[0.5, 60, 240], [0.9, 40, 170], [1.22, 6, 40]], fall: [560, 720], drift: 0.6, sway: 0, size: [0.7, 1.2], shape: 'streak', alpha: 0.32 },
  petals: { layers: [[0.5, 14, 70], [0.88, 12, 56], [1.2, 3, 16]], fall: [22, 48], drift: 0.22, sway: 34, size: [2.2, 3.8], shape: 'petal', alpha: 0.9, spin: 2.4 },
  leaves: { layers: [[0.5, 8, 40], [0.88, 8, 36], [1.2, 2, 12]], fall: [34, 66], drift: 0.26, sway: 42, size: [3.6, 6], shape: 'leaf', alpha: 0.92, spin: 3 },
  embers: { layers: [[0.55, 14, 70], [0.95, 12, 60], [1.2, 2, 14]], fall: [-44, -18], drift: 0.12, sway: 20, size: [0.8, 1.9], shape: 'spark', alpha: 0.9, glow: true },
  ash: { layers: [[0.45, 30, 140], [0.85, 22, 100], [1.2, 4, 26]], fall: [7, 18], drift: 0.11, sway: 10, size: [1.1, 2.6], shape: 'ash', alpha: 0.7, spin: 1.2 },
  motes: { layers: [[0.6, 20, 90], [1, 14, 70]], fall: [-3, 3], drift: 0.04, sway: 26, size: [0.6, 1.5], shape: 'mote', alpha: 0.55, glow: true },
};
// The tile each depth repeats over, in layer units: wider than the widest view the camera takes.
const TILE = [2800, 1400];

export class Weather {
  /** `fireflies` are the world's own firefly places; a density above 0.4 adds more, below it leaves some out. */
  constructor({ kind = 'fireflies', density = 0.4, color = '#d6f0dc', haze = '#d1d9c9', foliage = '#4a6855', seed = 20261004, reducedMotion = false, fireflies = [] } = {}) {
    this.kind = kind;
    this.color = color;
    this.haze = haze;
    this.reducedMotion = reducedMotion;
    this.time = 0;
    const random = seededRandom(seed + 41);
    this.noise = valueNoise(seed + 43);
    const spec = KINDS[kind];
    this.spec = spec || null;
    // Fireflies, as before: points over the road that follow the ground.
    const flies = kind === 'fireflies' ? Math.round(lerp(10, 60, density)) : 0;
    this.fireflies = fireflies.slice(0, flies);
    while (this.fireflies.length < flies) this.fireflies.push({ x: lerp(0, 2600, random()), y: lerp(-150, -18, random()), sx: random() * 100, sy: random() * 100, phase: random() * TAU });
    const shades = [color, mixHex(color, '#ffffff', 0.35), mixHex(color, kind === 'leaves' ? foliage : '#000000', kind === 'leaves' ? 0.45 : 0.18)];
    this.layers = !spec ? [] : spec.layers.map(([p, low, high]) => ({
      p, items: Array.from({ length: Math.round(lerp(low, high, density) * (reducedMotion ? 0.5 : 1)) }, () => ({
        x: random() * TILE[0], y: random() * TILE[1], fall: lerp(spec.fall[0], spec.fall[1], random()), size: lerp(spec.size[0], spec.size[1], random()),
        phase: random() * TAU, rate: lerp(0.6, 1.4, random()), rotation: random() * TAU, color: shades[Math.floor(random() * shades.length)],
      })),
    }));
  }

  update(dt, windAt) {
    if (this.reducedMotion) dt *= 0.5;
    this.time += dt;
    const spec = this.spec;
    if (!spec) return;
    for (const layer of this.layers) for (const item of layer.items) {
      const wind = windAt(item.x) * spec.drift;
      item.x += (wind + Math.sin(this.time * item.rate + item.phase) * spec.sway * 0.3) * dt * (0.4 + layer.p * 0.6);
      item.y += item.fall * dt * (0.5 + layer.p * 0.5);
      if (spec.spin) item.rotation += spec.spin * item.rate * dt;
    }
  }

  /** Draw the depths in one range of parallax factors, `far` (behind the cliffs) or `near` (in front of the road). */
  draw(ctx, camera, depth) {
    const spec = this.spec;
    if (!spec) return;
    for (const layer of this.layers) {
      if ((depth === 'far') !== (layer.p < 0.7)) continue;
      const view = camera.view(layer.p), z = view[0];
      const [left] = camera.visible(layer.p, 40);
      const top = camera.y * layer.p - camera.height / 2 / z - 40;
      const right = left + camera.width / z + 80, bottom = top + camera.height / z + 80;
      // Far depths take on the haze, as the cliffs and spires do.
      const fade = layer.p < 0.7 ? 0.55 : layer.p > 1.1 ? 1 : 0.85;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (spec.glow) ctx.globalCompositeOperation = 'lighter';
      for (const item of layer.items) {
        const x = left + (((item.x - left) % TILE[0]) + TILE[0]) % TILE[0];
        const y = top + (((item.y - top) % TILE[1]) + TILE[1]) % TILE[1];
        if (x > right || y > bottom) continue;
        const sx = view[0] * x + view[4], sy = view[3] * y + view[5];
        const size = item.size * z * (0.6 + layer.p * 0.4);
        const color = layer.p < 0.7 ? mixHex(item.color, this.haze, 0.35) : item.color;
        this.drawItem(ctx, spec, item, sx, sy, size, color, spec.alpha * fade, z);
      }
      ctx.restore();
    }
  }

  drawItem(ctx, spec, item, x, y, size, color, alpha, z) {
    switch (spec.shape) {
      case 'flake':
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
        break;
      case 'ash':
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.save(); ctx.translate(x, y); ctx.rotate(item.rotation);
        ctx.fillRect(-size, -size * 0.55, size * 2, size * 1.1);
        ctx.restore();
        break;
      case 'streak': {
        const length = 16 * z;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.8, size * z * 0.9);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length * 0.18, y - length); ctx.stroke();
        break;
      }
      case 'petal':
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.save(); ctx.translate(x, y); ctx.rotate(item.rotation);
        // A turning petal narrows and widens as it shows its edge.
        ctx.beginPath(); ctx.ellipse(0, 0, size * 1.5, size * (0.35 + 0.35 * Math.abs(Math.sin(item.rotation * 0.7))), 0, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      case 'leaf':
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.save(); ctx.translate(x, y); ctx.rotate(item.rotation); ctx.scale(1, 0.4 + 0.6 * Math.abs(Math.cos(item.rotation * 0.6)));
        ctx.beginPath(); ctx.moveTo(-size * 1.4, 0); ctx.quadraticCurveTo(0, -size, size * 1.4, 0); ctx.quadraticCurveTo(0, size, -size * 1.4, 0); ctx.fill();
        ctx.restore();
        break;
      case 'spark': {
        const flicker = 0.55 + 0.45 * Math.sin(this.time * 9 * item.rate + item.phase);
        glow(ctx, x, y, size * 5, color, alpha * 0.45 * flicker);
        glow(ctx, x, y, size * 1.6, '#fff4e0', alpha * flicker);
        break;
      }
      case 'mote': {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 1.3 * item.rate + item.phase);
        glow(ctx, x, y, size * 6, color, alpha * 0.35 * pulse);
        break;
      }
      default:
        break;
    }
  }

  /** Fireflies, in the additive pass. `ground` gives the road height; `flame` and `glowAmount` warm them once the beacon burns. */
  drawFireflies(ctx, camera, ground, flame, glowAmount) {
    const unit = camera.scaleFor(1);
    for (const fly of this.fireflies) {
      const drift = this.reducedMotion ? 0 : this.time * 0.25;
      const x = fly.x + (this.noise(fly.sx + drift) - 0.5) * 90, y = fly.y + ground(fly.x) + (this.noise(fly.sy + drift * 1.3) - 0.5) * 50;
      const [sx, sy] = camera.toScreen(x, y);
      if (sx < -20 || sx > camera.width + 20) continue;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.3 + fly.phase);
      const color = mixHex(this.color, flame, glowAmount * 0.5);
      glow(ctx, sx, sy, 9 * unit, color, 0.4 * pulse);
      glow(ctx, sx, sy, 2.2 * unit, '#ffffff', 0.7 * pulse);
    }
  }
}

/**
 * A drifting band of mist at one layer's height: a row of soft, overlapping puffs in layer space, thicker where the
 * noise gathers, so it moves with its layer as the camera pans and never shows a seam.
 */
export function drawMist(ctx, camera, { y, p, thickness, color, alpha, time, noise, drift = 6, spacing = 220 }) {
  if (alpha <= 0.002) return;
  const view = camera.view(p);
  const [left, right] = camera.visible(p, spacing * 2);
  const offset = (time * drift) % spacing;
  ctx.save();
  ctx.setTransform(...view);
  for (let x = Math.floor((left - offset) / spacing) * spacing + offset; x < right; x += spacing) {
    const amount = clamp(0.25 + noise(x * 0.004 + p * 40), 0, 1);
    const rx = spacing * (1.1 + 0.5 * noise(x * 0.011 + 7)), ry = thickness / 2;
    ctx.save();
    ctx.translate(x, y + (noise(x * 0.007 + 3) - 0.5) * thickness * 0.3);
    ctx.scale(1, ry / rx);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    gradient.addColorStop(0, rgba(color, alpha * amount));
    gradient.addColorStop(0.6, rgba(color, alpha * amount * 0.45));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  }
  ctx.restore();
}
