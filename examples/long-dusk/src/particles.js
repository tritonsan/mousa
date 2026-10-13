// A pooled particle system shared by character effects (footsteps, trails, auras, bursts) and the world
// (embers, sparks). Particles live in world space and draw through the view matrix.

import { lerp, clamp, deg, rgba } from './math.js';

export class Particles {
  constructor(random, max = 700) {
    this.random = random;
    this.max = max;
    this.items = [];
  }

  clear() { this.items.length = 0; }

  /** Emit `count` particles of an effect at (x, y); `facing` mirrors the direction for a left-facing character. */
  emit(effect, x, y, count, { facing = 1, scale = 1 } = {}) {
    const random = this.random;
    for (let i = 0; i < count && this.items.length < this.max; i++) {
      let direction = effect.direction;
      if (facing < 0) direction = 180 - direction;
      const angle = deg(direction + (random() - 0.5) * effect.spread);
      const speed = lerp(effect.speed[0], effect.speed[1], random()) * scale;
      this.items.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        age: 0, life: lerp(effect.life[0], effect.life[1], random()),
        size: lerp(effect.size[0], effect.size[1], random()) * scale,
        color: effect.colors[Math.floor(random() * effect.colors.length) % effect.colors.length],
        shape: effect.shape, gravity: effect.gravity, drag: effect.drag, blend: effect.blend,
        rotation: random() * Math.PI * 2, spin: (random() - 0.5) * 6,
      });
    }
  }

  update(dt, wind = () => 0) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.age += dt;
      if (p.age >= p.life) { items[i] = items[items.length - 1]; items.pop(); continue; }
      const keep = Math.max(0, 1 - p.drag * dt * 2.5);
      p.vx = p.vx * keep + wind(p.x, p.y) * 0.12 * dt;
      p.vy = p.vy * keep + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
    }
  }

  /** Draw one blend group: 'add' particles glow, 'normal' ones are lit with the scene. */
  draw(ctx, view, blend, { reduced = false } = {}) {
    const [a, b, c, d, e, f] = view;
    const zoom = Math.hypot(a, b);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (blend === 'add') ctx.globalCompositeOperation = 'lighter';
    for (const p of this.items) {
      if (p.blend !== blend) continue;
      const t = p.age / p.life;
      const alpha = clamp(t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88, 0, 1) * (reduced ? 0.7 : 1);
      if (alpha <= 0.01) continue;
      const sx = a * p.x + c * p.y + e, sy = b * p.x + d * p.y + f;
      const size = p.size * zoom * (p.shape === 'ring' ? lerp(0.6, 1.6, t) : lerp(1, 0.55, t));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      switch (p.shape) {
        case 'circle':
          ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
          break;
        case 'ring':
          ctx.lineWidth = Math.max(1, size * 0.25);
          ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.stroke();
          break;
        case 'square':
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rotation); ctx.fillRect(-size, -size, size * 2, size * 2); ctx.restore();
          break;
        case 'diamond':
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rotation);
          ctx.beginPath(); ctx.moveTo(0, -size * 1.4); ctx.lineTo(size, 0); ctx.lineTo(0, size * 1.4); ctx.lineTo(-size, 0); ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        case 'petal':
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rotation);
          ctx.beginPath(); ctx.ellipse(0, 0, size * 1.5, size * 0.6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          break;
        case 'streak': {
          const speed = Math.hypot(p.vx, p.vy) || 1;
          const length = Math.min(size * 6, 4 + speed * 0.05 * zoom);
          ctx.lineWidth = Math.max(1, size * 0.6);
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - (p.vx / speed) * length, sy - (p.vy / speed) * length); ctx.stroke();
          break;
        }
        default:
          break;
      }
    }
    ctx.restore();
  }
}

/** A soft glow sprite, drawn additively. */
export function glow(ctx, x, y, radius, color, alpha) {
  if (radius <= 0 || alpha <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.35, rgba(color, alpha * 0.35));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}
