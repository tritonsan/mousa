// Secondary motion: verlet cloth chains (capes, scarves, hair, ropes holding lanterns) and springy parts
// (hat tips, ears, antennae) that react to how the character moves. Simulated in world space.

import { transformPoint, transformVector, determinant, clamp, lerp, deg } from './math.js';
import { boneKey } from './rig.js';

const GRAVITY = 980;

export class Secondary {
  constructor(character) {
    this.chains = character.cloth.map(def => ({ def, key: boneKey(def.bone, def.side), points: null, rest: def.length / def.segments }));
    this.springs = character.parts.filter(part => part.spring).map(part => ({
      part, key: boneKey(part.bone, part.side === 'back' ? 'back' : 'front'), angle: 0, velocity: 0, history: [],
      lever: [(part.bounds.minX + part.bounds.maxX) / 2 - part.spring.pivot[0], (part.bounds.minY + part.bounds.maxY) / 2 - part.spring.pivot[1]],
    }));
    this.angles = new Map();
    this.byId = new Map(this.chains.map(chain => [chain.def.id, chain]));
  }

  reset() {
    for (const chain of this.chains) chain.points = null;
    for (const spring of this.springs) { spring.angle = 0; spring.velocity = 0; spring.history = []; }
    this.angles.clear();
  }

  /** matrices: world-space bone matrices; wind(x, y) gives horizontal acceleration; ground(x) the surface y. */
  update(dt, matrices, { wind = () => 0, ground = () => Infinity } = {}) {
    if (dt <= 0) return;
    for (const chain of this.chains) this.stepChain(chain, dt, matrices[chain.key], wind, ground);
    for (const spring of this.springs) this.stepSpring(spring, dt, matrices[spring.key]);
  }

  stepChain(chain, dt, matrix, wind, ground) {
    const def = chain.def;
    const anchor = transformPoint(matrix, def.anchor[0], def.anchor[1]);
    const restAngle = deg(def.rest);
    const raw = transformVector(matrix, Math.cos(restAngle), Math.sin(restAngle));
    const length = Math.hypot(raw[0], raw[1]) || 1;
    const direction = [raw[0] / length, raw[1] / length];
    if (!chain.points) {
      chain.points = Array.from({ length: def.segments + 1 }, (_, i) => {
        const x = anchor[0] + direction[0] * chain.rest * i, y = anchor[1] + direction[1] * chain.rest * i;
        return { x, y, px: x, py: y };
      });
    }
    const points = chain.points;
    points[0].x = points[0].px = anchor[0];
    points[0].y = points[0].py = anchor[1];
    const retain = 1 - lerp(0.004, 0.07, def.damping);
    const gravity = GRAVITY * def.gravity;
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      const vx = (p.x - p.px) * retain, vy = (p.y - p.py) * retain;
      p.px = p.x; p.py = p.y;
      p.x += vx + wind(p.x, p.y) * def.wind * dt * dt;
      p.y += vy + gravity * dt * dt;
    }
    // Shape memory pulls stiff cloth toward its drawn direction; soft cloth only hangs and trails.
    const memory = def.stiffness * 0.08;
    if (memory > 0) {
      for (let i = 1; i < points.length; i++) {
        const weight = memory * (1 - (0.6 * i) / points.length);
        points[i].x += (anchor[0] + direction[0] * chain.rest * i - points[i].x) * weight;
        points[i].y += (anchor[1] + direction[1] * chain.rest * i - points[i].y) * weight;
      }
    }
    for (let iteration = 0; iteration < 6; iteration++) {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const correction = (d - chain.rest) / d;
        if (i === 0) { b.x -= dx * correction; b.y -= dy * correction; }
        else {
          a.x += dx * correction * 0.5; a.y += dy * correction * 0.5;
          b.x -= dx * correction * 0.5; b.y -= dy * correction * 0.5;
        }
      }
    }
    for (let i = 1; i < points.length; i++) {
      const floor = ground(points[i].x) - 1;
      if (points[i].y > floor) { points[i].y = floor; points[i].px = points[i].x - (points[i].x - points[i].px) * 0.5; }
    }
  }

  stepSpring(spring, dt, matrix) {
    const { pivot, stiffness, damping, gain } = spring.part.spring;
    const world = transformPoint(matrix, pivot[0], pivot[1]);
    const lever = transformVector(matrix, spring.lever[0], spring.lever[1]);
    const angle = Math.atan2(matrix[1], matrix[0]);
    const history = spring.history;
    history.push({ x: world[0], y: world[1], angle });
    if (history.length > 3) history.shift();
    let torque = 0;
    if (history.length === 3) {
      const [a, b, c] = history;
      const ax = (c.x - 2 * b.x + a.x) / (dt * dt), ay = (c.y - 2 * b.y + a.y) / (dt * dt);
      let turn = (c.angle - b.angle) - (b.angle - a.angle);
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const leverLength = Math.hypot(lever[0], lever[1]) || 1;
      // Inertia: the part lags behind the pivot's acceleration, so its tip swings against it.
      torque = ((ax * lever[1] - ay * lever[0]) / leverLength) * 0.0035 * gain - (turn / (dt * dt)) * 0.18 * gain;
      torque = clamp(torque, -900, 900) * Math.sign(determinant(matrix) || 1);
    }
    const k = lerp(40, 420, stiffness), c = lerp(2, 28, damping);
    spring.velocity += (-k * spring.angle - c * spring.velocity + torque) * dt;
    spring.angle = clamp(spring.angle + spring.velocity * dt, deg(-40), deg(40));
    this.angles.set(spring.part.id, spring.angle);
  }

  /** Direction of a chain's last segment, the frame its tip shapes are drawn in. */
  tipFrame(id) {
    const chain = this.byId.get(id);
    if (!chain?.points) return null;
    const points = chain.points, end = points[points.length - 1], before = points[points.length - 2];
    const dx = end.x - before.x, dy = end.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: end.x, y: end.y, ux: dx / length, uy: dy / length };
  }

  /**
   * World position of a point in a chain's tip frame (for a light inside a hanging lantern). In that frame +y
   * runs along the chain and +x to the character's front, so it mirrors with the facing.
   */
  tip(id, offset = [0, 0], facing = 1) {
    const frame = this.tipFrame(id);
    if (!frame) return null;
    const [ox, oy] = offset;
    return [frame.x + facing * ox * frame.uy + oy * frame.ux, frame.y - facing * ox * frame.ux + oy * frame.uy];
  }
}
