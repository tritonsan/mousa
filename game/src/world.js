// The Vesper Cliffs: a seeded scene shared by every character. A basalt cliff road above a sea of cloud under a sun
// frozen on the horizon, ending at the cold Vesper beacon. Its layout and lore are fixed. Its art direction (the
// colours, the weather, the mist and the beacons' style) comes from the scene a character file sets, or the original
// dusk; the flame the character brings colours the beacon and the far towers when kindled.

import { clamp, lerp, damp, smoothstep, seededRandom, valueNoise, mixHex, rgba, TAU, easingFunction } from './math.js';
import { Particles, glow } from './particles.js';
import { scenePalette, completeScene } from './scene.js';
import { Weather, drawMist } from './weather.js';
import { beaconShapes, towerShape, BEACON_FIRE } from './beacons.js';

export const SCENE = Object.freeze({
  minX: 70, maxX: 2570, edgeX: 2655, left: -460, right: 3060,
  entryX: -170, introStopX: 180,
  bridge: [1130, 1330],
  keeperX: 1606, talkX: 1460, benchX: 1548, pitX: 1668,
  beaconX: 1890, kindleX: 1796, kindleRange: 70, bowlY: -446,
  overlookX: 2410,
});
const HORIZON = 12;

/** The original dusk's colours, which every scene shifts from. */
export const WORLD_COLORS = Object.freeze(scenePalette(null));

const easeOut = easingFunction('out'), easeInOut = easingFunction('inOut'), easeOutBack = easingFunction('outBack');

function baseGround(x) {
  return -0.011 * clamp(x, -500, 2800) + 7 * Math.sin(x / 210 + 0.4) + 4 * Math.sin(x / 97 + 1.7);
}
function flatten(x, y, center, half, value) {
  return lerp(y, value, 1 - smoothstep(half, half + 60, Math.abs(x - center)));
}
/** Height of the walkable surface (y grows downward; the road sits near y = 0). */
export function groundAt(x) {
  let y = baseGround(x);
  const [b0, b1] = SCENE.bridge;
  if (x >= b0 && x <= b1) {
    const t = (x - b0) / (b1 - b0);
    y = lerp(baseGround(b0), baseGround(b1), t) + 10 * Math.sin(Math.PI * t);
  }
  y = flatten(x, y, SCENE.benchX + 50, 100, baseGround(SCENE.benchX + 50));
  y = flatten(x, y, SCENE.beaconX - 30, 120, baseGround(SCENE.beaconX - 30));
  return y;
}

/** Columnar basalt: a run of vertical columns with slanted tops, the motif repeated at every distance. */
function columns(path, random, { from, to, base, top, jitter, width: [minW, maxW], slant = 3, gap = 0, edges = null, joints = null }) {
  let x = from;
  while (x < to) {
    const w = lerp(minW, maxW, random());
    if (random() < gap) { x += w; continue; }
    const height = top(x + w / 2) + (random() - 0.5) * jitter;
    const tilt = (random() - 0.5) * 2 * slant;
    const y0 = base, yl = base - height - tilt, yr = base - height + tilt;
    path.moveTo(x, y0); path.lineTo(x, yl); path.lineTo(x + w, yr); path.lineTo(x + w, y0); path.closePath();
    if (edges) { edges.moveTo(x + 0.5, yl + 0.6); edges.lineTo(x + w - 0.5, yr + 0.6); }
    if (joints && random() < 0.8) { joints.moveTo(x + w, yr + 3); joints.lineTo(x + w, y0); }
    x += w;
  }
}

/**
 * A weathered rock pinnacle: tapered, slightly leaning, with a stepped basalt top. Its outline continues far
 * below `base`, where the cloud sea or the road hides it. The sun side (+x) and the top get a lit rim.
 */
function pinnacle(path, random, { x, base, height, width, top = 0.34, lean = 0, steps = 2, rim = null, depth = 500 }) {
  const n = 7, left = [], right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const half = (width / 2) * lerp(1, top, t ** 0.85);
    const shift = lean * height * t;
    const rough = width * 0.07 * (1 - t * 0.4);
    left.push([x + shift - half + (random() - 0.5) * rough, base - height * t]);
    right.push([x + shift + half + (random() - 0.5) * rough, base - height * t]);
  }
  const tl = left[n], tr = right[n];
  const crest = [];
  for (let s = 1; s <= steps; s++) {
    const u = s / (steps + 1);
    crest.push([lerp(tl[0], tr[0], u), lerp(tl[1], tr[1], u) + (random() - 0.35) * height * 0.06]);
  }
  path.moveTo(left[0][0], base + depth);
  for (const p of left) path.lineTo(p[0], p[1]);
  for (const p of crest) { path.lineTo(p[0], p[1] - 0.01); path.lineTo(p[0] + 0.01, p[1]); }
  for (let i = n; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.lineTo(right[0][0], base + depth);
  path.closePath();
  if (rim) {
    rim.moveTo(tl[0] + 1, tl[1] + 1);
    for (const p of crest) rim.lineTo(p[0], p[1] + 1);
    rim.lineTo(tr[0] - 0.5, tr[1] + 1);
    for (let i = n - 1; i >= Math.floor(n * 0.35); i--) rim.lineTo(right[i][0] - 0.8, right[i][1]);
  }
  return { x: (tl[0] + tr[0]) / 2, y: Math.min(tl[1], tr[1], ...crest.map(p => p[1])), left: tl[0], right: tr[0] };
}

export class World {
  /**
   * `scene` is a character file's art direction or null for the original dusk. `style` carries what a render style
   * changes in the world's own drawing: ink lines around its shapes, banded skies and light, flat cloud, neon edges.
   */
  constructor({ seed = 20261004, reducedMotion = false, scene = null, style = {} } = {}) {
    this.seed = seed;
    this.reducedMotion = reducedMotion;
    this.spec = completeScene(scene);
    this.colors = scenePalette(scene);
    this.style = style || {};
    this.fire = BEACON_FIRE[this.spec.towers] || BEACON_FIRE.stone;
    this.build();
    this.reset();
  }

  reset() {
    this.time = 0;
    this.ignition = { active: false, t: 0, color: '#ffd28a', from: [0, 0], spark: null, level: 0, glow: 0, ringDone: false };
    for (const lantern of this.lanterns) { lantern.lit = 0; lantern.litAt = null; }
    for (const tower of this.towers) { tower.lit = 0; tower.litAt = null; }
    for (const bird of this.birds) Object.assign(bird, bird.home, { flying: false, t: 0, alpha: 1 });
    this.particles.clear();
    this.emberDebt = 0;
    this.smokeDebt = 0;
    // The air starts over with the moment, so the two lamplighters of a pair always share the same weather.
    const { kind, density, color } = this.spec.weather;
    this.weather = new Weather({ kind, density, color, haze: this.colors.haze, foliage: this.colors.grass[1], seed: this.seed, reducedMotion: this.reducedMotion, fireflies: this.fireflies });
  }

  build() {
    const random = seededRandom(this.seed);
    this.random = random;
    this.noise = valueNoise(this.seed + 11);
    this.particles = new Particles(seededRandom(this.seed + 5), 900);

    this.stars = Array.from({ length: 170 }, () => {
      const height = random() ** 1.6;
      return { x: lerp(-1300, 1300, random()), y: lerp(HORIZON - 70, -600, height), size: lerp(0.5, 1.7, random() ** 2), speed: lerp(0.4, 2.2, random()), phase: random() * TAU, bright: lerp(0.25, 0.9, random()) };
    });

    // High, thin streaks of cloud catching the last light.
    this.cirrus = Array.from({ length: 6 }, () => ({ x: lerp(-900, 1100, random()), y: lerp(-420, -150, random()), w: lerp(220, 520, random()), h: lerp(5, 12, random()), alpha: lerp(0.05, 0.12, random()), tilt: (random() - 0.5) * 0.06 }));

    // Cloud sea: periodic bands of puffs, far and thin at the horizon, large and dark below the cliffs.
    const { bandLit, bandShade } = this.colors;
    const bandSpecs = [
      { p: 0.04, y: HORIZON - 3, r: [8, 18], drift: 1.2 },
      { p: 0.08, y: HORIZON + 26, r: [16, 36], drift: 2.2 },
      { p: 0.14, y: HORIZON + 76, r: [28, 58], drift: 3.6 },
      { p: 0.24, y: HORIZON + 160, r: [46, 92], drift: 5.4 },
      { p: 0.42, y: HORIZON + 300, r: [70, 140], drift: 8 },
    ].map((spec, index) => ({ ...spec, lit: bandLit[index], shade: bandShade[index] }));
    this.bands = bandSpecs.map(spec => {
      const period = 3200;
      const path = new Path2D();
      let x = 0;
      while (x < period) {
        const r = lerp(spec.r[0], spec.r[1], random());
        const y = spec.y + r * 0.55 + (random() - 0.5) * r * 0.35;
        path.moveTo(x + r, y); path.arc(x, y, r, 0, TAU);
        x += r * lerp(0.9, 1.5, random());
      }
      // Overlapping puffs at both ends keep the tiling seamless.
      path.moveTo(period + spec.r[1], spec.y + spec.r[1]);
      path.arc(period, spec.y + spec.r[1] * 0.6, spec.r[1] * 0.9, 0, TAU);
      path.rect(-spec.r[1], spec.y + spec.r[1] * 0.8, period + spec.r[1] * 2, 3200);
      return { ...spec, period, path };
    });

    // Distant sea stacks rising from the cloud sea, three layers deep; seven carry beacon towers.
    const towerSpots = { 0.11: [380, 640, 905], 0.19: [300, 575, 830, 1080] };
    this.spires = [
      { p: 0.06, base: HORIZON + 34, color: this.colors.spires[0], rimAlpha: 0.2, heights: [30, 130], widths: [40, 120], count: 15, ridge: 16 },
      { p: 0.11, base: HORIZON + 76, color: this.colors.spires[1], rimAlpha: 0.28, heights: [70, 230], widths: [50, 150], count: 12, ridge: 26 },
      { p: 0.19, base: HORIZON + 150, color: this.colors.spires[2], rimAlpha: 0.36, heights: [110, 340], widths: [70, 200], count: 10, ridge: 40 },
    ].map(layer => {
      const path = new Path2D(), rim = new Path2D();
      const span = [-1700, 1700 + 3000 * layer.p];
      path.moveTo(span[0], layer.base + 500);
      for (let x = span[0]; x <= span[1]; x += 30) path.lineTo(x, layer.base - this.noise(x * 0.004 + layer.p * 100) * layer.ridge);
      path.lineTo(span[1], layer.base + 500);
      path.closePath();
      const spots = towerSpots[layer.p] || [];
      const xs = [...spots, ...Array.from({ length: layer.count }, () => lerp(span[0], span[1], random()))];
      const tops = [];
      for (const [index, x] of xs.entries()) {
        const tower = index < spots.length;
        const height = tower ? lerp(layer.heights[1] * 0.62, layer.heights[1] * 0.85, random()) : lerp(layer.heights[0], layer.heights[1], random() ** 1.4);
        const width = lerp(layer.widths[0], layer.widths[1], random()) * (tower ? 0.8 : 1);
        const shape = pinnacle(path, random, { x, base: layer.base, height, width, top: tower ? lerp(0.3, 0.42, random()) : lerp(0.18, 0.55, random()),
          lean: (random() - 0.5) * 0.12, steps: 1 + Math.floor(random() * 3), rim });
        if (tower) tops.push({ x: shape.x, y: shape.y, scale: 0.5 + layer.p * 3.2 });
      }
      return { ...layer, path, rim, tops };
    });
    this.towers = this.spires.flatMap(layer => layer.tops.map(top => ({ ...top, p: layer.p, color: layer.color, lit: 0, litAt: null })));
    // Each far tower is a small beacon in the scene's style: by default a squat stone shaft, a ledge and a shallow bowl.
    this.towerPaths = this.towers.map(tower => towerShape(this.spec.towers, tower.x, tower.y + 2 * tower.scale, tower.scale));

    // Mid cliffs: basalt terraces falling toward the clouds, and four tall outcrops with gaps for the view.
    this.mid = { p: 0.62, terraces: new Path2D(), masses: new Path2D(), rim: new Path2D(), joints: new Path2D() };
    const terrace = x => 70 + 50 * this.noise(x * 0.003 + 4) + 40 * Math.sin(x * 0.0021);
    columns(this.mid.terraces, random, { from: -900, to: 2600, base: 900, top: x => 900 - terrace(x), jitter: 18, width: [16, 30], slant: 3, edges: this.mid.rim });
    // The overlook end stays open, so the far towers can be seen answering the beacon.
    for (const [x, width, height] of [[-620, 360, 520], [-200, 200, 400], [1080, 260, 480]]) {
      const shape = pinnacle(this.mid.masses, random, { x, base: 220, height, width, top: lerp(0.24, 0.34, random()), lean: (random() - 0.5) * 0.14, steps: 4, rim: this.mid.rim, depth: 700 });
      for (let jx = x - width / 2 + 10; jx < x + width / 2 - 6; jx += lerp(14, 26, random())) {
        this.mid.joints.moveTo(jx, shape.y + 12 + random() * 30);
        this.mid.joints.lineTo(jx + (random() - 0.5) * 6, 640);
      }
    }

    // The arch ruin on the near side of the road, where the birds roost: two pillars of dressed blocks and a
    // broken arch springing from the left one.
    this.arch = { p: 0.86, body: new Path2D(), rim: new Path2D() };
    let archTop = 0;
    for (const [pillar, levels] of [[560, 7], [742, 4]]) {
      let y = 40;
      for (let level = 0; level < levels; level++) {
        const h = lerp(26, 33, random()), w = lerp(44, 50, random()) - level * 0.8;
        const x = pillar - w / 2 + (random() - 0.5) * 3;
        this.arch.body.rect(x, y - h + 1.4, w, h - 1.4);
        this.arch.rim.moveTo(x + 1, y - h + 2.1); this.arch.rim.lineTo(x + w - 1, y - h + 2.1);
        y -= h;
      }
      if (pillar === 560) archTop = y;
      else { // a fallen block leans against the shorter pillar
        this.arch.body.moveTo(pillar + 26, 40); this.arch.body.lineTo(pillar + 30, 40 - 30); this.arch.body.lineTo(pillar + 62, 40 - 22); this.arch.body.lineTo(pillar + 60, 40); this.arch.body.closePath();
      }
    }
    const archCenter = [651, archTop + 8], radius = 91, thick = 22;
    for (let k = 0; k < 6; k++) {
      const s0 = lerp(Math.PI, Math.PI * 1.62, k / 6), s1 = lerp(Math.PI, Math.PI * 1.62, (k + 1) / 6) - 0.018;
      const [cx, cy] = archCenter;
      this.arch.body.moveTo(cx + Math.cos(s0) * (radius + thick / 2), cy + Math.sin(s0) * (radius + thick / 2));
      this.arch.body.arc(cx, cy, radius + thick / 2, s0, s1);
      this.arch.body.lineTo(cx + Math.cos(s1) * (radius - thick / 2), cy + Math.sin(s1) * (radius - thick / 2));
      this.arch.body.arc(cx, cy, radius - thick / 2, s1, s0, true);
      this.arch.body.closePath();
      this.arch.rim.moveTo(cx + Math.cos(s0) * (radius + thick / 2 - 1), cy + Math.sin(s0) * (radius + thick / 2 - 1));
      this.arch.rim.arc(cx, cy, radius + thick / 2 - 1, s0, s1);
    }
    this.vines = Array.from({ length: 7 }, (_, i) => {
      const angle = lerp(Math.PI * 1.1, Math.PI * 1.5, i / 6 + random() * 0.05);
      return { x: archCenter[0] + Math.cos(angle) * (radius - thick / 2), top: archCenter[1] + Math.sin(angle) * (radius - thick / 2), length: 30 + random() * 70, phase: random() * TAU };
    });
    this.birds = Array.from({ length: 6 }, (_, i) => {
      const home = { x: 542 + i * 7 + random() * 4, y: archTop - 2 - (i % 2) * 1.5, vx: lerp(40, 70, random()), vy: lerp(-60, -30, random()), delay: random() * 0.5, flap: lerp(6, 9, random()) };
      return { home, ...home, flying: false, t: 0, alpha: 1 };
    });

    // The road: basalt with a lichen crown, broken at the bridge and ending at the overlook edge.
    // Its face is a row of basalt columns in three tones that sink into shadow below the road.
    this.ground = { tones: [new Path2D(), new Path2D(), new Path2D()], crown: new Path2D(), rim: new Path2D(), joints: new Path2D(), pebbles: new Path2D(), moss: new Path2D() };
    const [b0, b1] = SCENE.bridge;
    for (const [from, to] of [[SCENE.left, b0], [b1, SCENE.edgeX]]) {
      const crown = this.ground.crown, rim = this.ground.rim, joints = this.ground.joints;
      for (let x = from; x < to;) {
        const w = Math.min(lerp(22, 46, random()), to - x);
        const column = this.ground.tones[Math.floor(random() * 3)];
        column.moveTo(x - 0.4, 900);
        for (let px = x - 0.4; px < x + w; px += 8) column.lineTo(px, groundAt(px));
        column.lineTo(x + w + 0.4, groundAt(x + w)); column.lineTo(x + w + 0.4, 900); column.closePath();
        if (x + w < to - 1 && random() < 0.85) { joints.moveTo(x + w, groundAt(x + w) + 8 + random() * 6); joints.lineTo(x + w + (random() - 0.5) * 2, 900); }
        if (random() < 0.55) {
          const crack = groundAt(x) + lerp(40, 190, random());
          joints.moveTo(x + 2, crack); joints.lineTo(x + w - 2, crack + (random() - 0.5) * 5);
        }
        x += w;
      }
      rim.moveTo(from, groundAt(from));
      for (let x = from; x <= to; x += 8) rim.lineTo(x, groundAt(Math.min(x, to)) + 0.5);
      crown.moveTo(from, groundAt(from) - 1);
      for (let x = from; x <= to; x += 8) crown.lineTo(x, groundAt(x) - 1);
      for (let x = to; x >= from; x -= 11) crown.lineTo(x, groundAt(x) + 5 + this.noise(x * 0.09) * 6);
      crown.closePath();
      for (let x = from + 4; x < to - 4; x += lerp(10, 38, random())) {
        const y = groundAt(x) + 6, length = lerp(4, 18, random() ** 1.5);
        this.ground.moss.moveTo(x, y); this.ground.moss.quadraticCurveTo(x + 1.5, y + length * 0.5, x + (random() - 0.5) * 3, y + length);
      }
      for (let x = from; x < to; x += lerp(18, 60, random())) {
        const y = groundAt(x) + 1, r = lerp(1.5, 4, random());
        this.ground.pebbles.moveTo(x + r, y); this.ground.pebbles.ellipse(x, y, r * 1.4, r, 0, Math.PI, TAU);
      }
    }
    // The far end drops away under the overlook.
    this.ground.edge = new Path2D();
    this.ground.edge.moveTo(SCENE.edgeX, groundAt(SCENE.edgeX)); this.ground.edge.lineTo(SCENE.edgeX + 8, 60); this.ground.edge.lineTo(SCENE.edgeX - 4, 900);

    // Bridge planks follow the walkable sag; rope rails hang from posts at each end.
    this.bridge = { planks: new Path2D(), posts: new Path2D(), ropes: new Path2D() };
    for (let x = b0 - 4; x < b1 + 4; x += 14.5) {
      const y = groundAt(clamp(x + 6, b0, b1));
      const tilt = (random() - 0.5) * 2.2;
      this.bridge.planks.moveTo(x, y + tilt); this.bridge.planks.lineTo(x + 13, y - tilt); this.bridge.planks.lineTo(x + 13, y + 6 - tilt); this.bridge.planks.lineTo(x, y + 6 + tilt); this.bridge.planks.closePath();
    }
    for (const x of [b0 - 8, b1 + 2]) this.bridge.posts.rect(x, groundAt(x + 3) - 52, 7, 60);
    for (const lift of [48, 22]) {
      const y0 = groundAt(b0) - lift, y1 = groundAt(b1) - lift;
      this.bridge.ropes.moveTo(b0 - 4, y0);
      for (let i = 1; i <= 24; i++) { const t = i / 24; this.bridge.ropes.lineTo(lerp(b0 - 4, b1 + 5, t), lerp(y0, y1, t) + 16 * Math.sin(Math.PI * t)); }
    }
    for (let x = b0 + 20; x < b1; x += 26) {
      const t = (x - (b0 - 4)) / (b1 - b0 + 9);
      const top = lerp(groundAt(b0) - 48, groundAt(b1) - 48, t) + 16 * Math.sin(Math.PI * t);
      this.bridge.ropes.moveTo(x, top); this.bridge.ropes.lineTo(x, groundAt(x));
    }

    // Iron lantern posts along the road; their lanterns swing and light up after the beacon.
    this.lanterns = [300, 790, 1086, 1404, 1742, 2124, 2470].map((x, index) => {
      const flip = index % 2 ? -1 : 1;
      const base = groundAt(x), top = base - 132;
      const post = new Path2D();
      post.rect(x - 2.5, top, 5, 134);
      post.moveTo(x, top + 4); post.quadraticCurveTo(x + 4 * flip, top - 6, x + 22 * flip, top - 2);
      post.lineTo(x + 22 * flip, top + 2); post.quadraticCurveTo(x + 4 * flip, top - 2, x, top + 9); post.closePath();
      post.rect(x - 6, base - 4, 12, 6);
      const anchor = [x + 21 * flip, top - 1];
      return { x, post, anchor, points: [0, 1, 2].map(i => ({ x: anchor[0], y: anchor[1] + i * 6, px: anchor[0], py: anchor[1] + i * 6 })), lit: 0, litAt: null };
    });

    // Prayer-flag line between two poles near the arch.
    const pole = [826, 1036].map(x => ({ x, top: groundAt(x) - 172 }));
    this.flagLine = { poles: new Path2D(), rope: new Path2D(), flags: [] };
    for (const { x, top } of pole) this.flagLine.poles.rect(x - 2.5, top, 5, groundAt(x) - top + 2);
    const ropeAt = t => [lerp(pole[0].x, pole[1].x, t), lerp(pole[0].top + 6, pole[1].top + 6, t) + 30 * Math.sin(Math.PI * t)];
    this.flagLine.rope.moveTo(...ropeAt(0));
    for (let i = 1; i <= 30; i++) this.flagLine.rope.lineTo(...ropeAt(i / 30));
    for (let i = 1; i <= 9; i++) {
      const [x, y] = ropeAt(i / 10);
      this.flagLine.flags.push({ anchor: [x, y], color: this.colors.flags[i % this.colors.flags.length], points: [0, 1, 2, 3].map(k => ({ x, y: y + k * 6, px: x, py: y + k * 6 })) });
    }

    // The keeper's bench, the cold fire pit and the overlook balustrade.
    this.props = { stone: new Path2D(), stoneEdges: new Path2D(), wood: new Path2D() };
    const by = groundAt(SCENE.benchX);
    this.props.stone.rect(SCENE.benchX - 30, by - 22, 60, 9);
    this.props.stone.rect(SCENE.benchX - 24, by - 13, 9, 14); this.props.stone.rect(SCENE.benchX + 15, by - 13, 9, 14);
    this.props.stoneEdges.moveTo(SCENE.benchX - 29, by - 21.4); this.props.stoneEdges.lineTo(SCENE.benchX + 29, by - 21.4);
    for (let i = 0; i < 7; i++) {
      const x = SCENE.pitX - 22 + i * 7.5, y = groundAt(SCENE.pitX) + 1;
      this.props.stone.moveTo(x + 5, y); this.props.stone.ellipse(x, y, 5, 4.5, 0, Math.PI, TAU);
    }
    for (let x = 2432; x < 2630; x += 24) {
      if (x > 2510 && x < 2560) continue;
      const y = groundAt(x);
      this.props.stone.rect(x - 3, y - 26, 6, 27);
      this.props.stone.rect(x - 2, y - 30, 26, 5);
      this.props.stoneEdges.moveTo(x - 2, y - 29.4); this.props.stoneEdges.lineTo(x + 24, y - 29.4);
    }
    // A fallen balustrade post at the break.
    this.props.stone.moveTo(2530, groundAt(2530)); this.props.stone.lineTo(2556, groundAt(2556) - 4); this.props.stone.lineTo(2558, groundAt(2558)); this.props.stone.closePath();

    // The Vesper beacon in the scene's style: by default a plinth, a banded shaft, a capital and a bowl.
    const bx = SCENE.beaconX, gy = groundAt(bx);
    this.beacon = { ...beaconShapes(this.spec.towers, { bx, gy, bowlY: SCENE.bowlY }), x: bx, bowlY: SCENE.bowlY };

    // Grass: a taller back row behind the feet and a sparse, short front row.
    this.grass = [];
    for (let x = SCENE.left; x < SCENE.edgeX; x += lerp(9, 19, random())) {
      if (x > b0 - 6 && x < b1 + 6) continue;
      const count = 2 + Math.floor(random() * 4);
      for (let i = 0; i < count; i++) this.grass.push({ x: x + (random() - 0.5) * 8, h: lerp(8, 25, random() ** 1.4), lean: (random() - 0.5) * 0.5, color: Math.floor(random() * 3), phase: random() * TAU, front: false, bend: 0 });
    }
    for (let x = SCENE.left; x < SCENE.edgeX; x += lerp(34, 70, random())) {
      if (x > b0 - 6 && x < b1 + 6) continue;
      for (let i = 0; i < 2 + Math.floor(random() * 2); i++) this.grass.push({ x: x + (random() - 0.5) * 7, h: lerp(5, 11, random()), lean: (random() - 0.5) * 0.4, color: 0, phase: random() * TAU, front: true, bend: 0 });
    }

    // Foreground silhouettes framing the road (they move faster than the playfield).
    this.foreground = { p: 1.28, body: new Path2D(), rim: new Path2D() };
    const fg = this.foreground.body;
    const rock = (x, w, h) => {
      fg.moveTo(x - w / 2, 260);
      fg.quadraticCurveTo(x - w * 0.54, 150 - h * 0.55, x - w * 0.22, 150 - h);
      fg.quadraticCurveTo(x + w * 0.04, 150 - h * 1.1, x + w * 0.28, 150 - h * 0.86);
      fg.quadraticCurveTo(x + w * 0.54, 150 - h * 0.52, x + w / 2, 260);
      fg.closePath();
      this.foreground.rim.moveTo(x - w * 0.36, 150 - h * 0.78);
      this.foreground.rim.quadraticCurveTo(x - w * 0.12, 150 - h * 1.1, x + w * 0.26, 150 - h * 0.88);
    };
    rock(-140, 260, 70); rock(1190, 170, 34); rock(2860, 300, 90);
    const fern = (x, size) => {
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i - 4) * 0.28, length = size * lerp(0.6, 1, random());
        const tx = x + Math.cos(a) * length, ty = 150 + Math.sin(a) * length;
        fg.moveTo(x - 3, 160); fg.quadraticCurveTo(x + Math.cos(a) * length * 0.4 - 6, 150 + Math.sin(a) * length * 0.6, tx, ty);
        fg.quadraticCurveTo(x + Math.cos(a) * length * 0.4 + 6, 150 + Math.sin(a) * length * 0.6, x + 3, 160); fg.closePath();
      }
    };
    fern(420, 70); fern(1650, 84); fern(2240, 64);
    // A wind-bent dead tree whose branches cross the top of the frame.
    const tree = new Path2D();
    tree.moveTo(930, 260); tree.bezierCurveTo(940, 120, 900, -10, 960, -160); tree.bezierCurveTo(990, -240, 1060, -300, 1150, -330);
    tree.lineTo(1146, -318); tree.bezierCurveTo(1070, -290, 1010, -230, 984, -150); tree.bezierCurveTo(950, -40, 972, 110, 978, 260); tree.closePath();
    tree.moveTo(968, -120); tree.bezierCurveTo(1010, -150, 1040, -150, 1080, -190); tree.lineTo(1083, -184); tree.bezierCurveTo(1046, -142, 1012, -138, 972, -106); tree.closePath();
    tree.moveTo(1010, -260); tree.bezierCurveTo(990, -300, 1000, -340, 980, -390); tree.lineTo(988, -392); tree.bezierCurveTo(1006, -340, 1004, -300, 1022, -268); tree.closePath();
    this.foreground.tree = tree;

    // The original thirty fireflies keep their places; firefly weather of another density adds or leaves out some.
    this.fireflies = Array.from({ length: 30 }, () => ({ x: lerp(0, 2600, random()), y: lerp(-150, -18, random()), sx: random() * 100, sy: random() * 100, phase: random() * TAU }));
  }

  /** Horizontal wind acceleration; it blows from the frozen sun toward the road's start. */
  windAt(x) {
    const t = this.time;
    return -140 * (0.55 + 0.3 * Math.sin(t * 0.31 + x * 0.0013) + 0.2 * Math.sin(t * 1.07 + x * 0.004 + 1.3));
  }

  /** Light the beacon with the colour the character brought, starting from where its flame is. */
  ignite({ color, from }) {
    if (this.ignition.active) return;
    Object.assign(this.ignition, { active: true, t: 0, color, from, spark: { x: from[0], y: from[1] }, level: 0, glow: 0, ringDone: false });
    const bowl = [SCENE.beaconX, SCENE.bowlY];
    this.lanterns.forEach(lantern => { lantern.litAt = 1 + Math.abs(lantern.x - bowl[0]) / 600; });
    // The light travels outward: the nearer ridge answers first, then the far one, each from left to right.
    const order = [...this.towers].sort((a, b) => b.p - a.p || a.x - b.x);
    order.forEach((tower, rank) => { tower.litAt = 1.9 + rank * 0.55; });
    this.birds.forEach(bird => { bird.flying = true; bird.t = -bird.delay - 0.9; });
  }

  get kindled() { return this.ignition.active && this.ignition.t > 0.7; }

  update(dt, actors = []) {
    this.time += dt;
    const ignition = this.ignition;
    if (ignition.active) {
      ignition.t += dt;
      const t = ignition.t;
      const travel = clamp(t / 0.7, 0, 1);
      const [fx, fy] = ignition.from;
      const tx = SCENE.beaconX, ty = SCENE.bowlY - 6;
      const e = easeInOut(travel);
      // The spark rises on an arc from the character's flame to the bowl.
      ignition.spark = travel < 1 ? { x: lerp(fx, tx, e), y: lerp(fy, ty, e) - Math.sin(Math.PI * e) * 120 } : null;
      if (ignition.spark) this.particles.emit({ direction: 90, spread: 180, speed: [5, 40], life: [0.3, 0.8], size: [1.2, 3], colors: [ignition.color, '#fff4e0'], shape: 'circle', gravity: 30, drag: 0.4, blend: 'add' }, ignition.spark.x, ignition.spark.y, 3);
      ignition.level = t < 0.7 ? 0 : easeOutBack(clamp((t - 0.7) / 1.3, 0, 1));
      ignition.glow = smoothstep(0.7, 7, t);
      for (const lantern of this.lanterns) if (lantern.litAt !== null) lantern.lit = clamp((t - lantern.litAt) / 0.5, 0, 1);
      for (const tower of this.towers) if (tower.litAt !== null) tower.lit = clamp((t - tower.litAt) / 0.8, 0, 1);
    }

    // Embers from the bowl: a dull trickle while cold, a column once lit.
    const bowlX = SCENE.beaconX, bowlTop = SCENE.bowlY;
    const lit = ignition.level;
    this.emberDebt += dt * (lit > 0 ? 34 * lit : 0.9) * (this.reducedMotion ? 0.5 : 1);
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      const color = lit > 0 ? (this.random() < 0.5 ? ignition.color : mixHex(ignition.color, '#ffffff', 0.6)) : this.colors.emberCold;
      this.particles.emit({ direction: -90, spread: 50, speed: lit > 0 ? [40, 130] : [8, 24], life: lit > 0 ? [0.8, 2.4] : [0.6, 1.4], size: lit > 0 ? [1, 2.8] : [0.8, 1.6],
        colors: [color], shape: this.random() < 0.3 ? 'streak' : 'circle', gravity: -26, drag: 0.35, blend: 'add' }, bowlX + (this.random() - 0.5) * (lit > 0 ? 110 : 60), bowlTop - 2, 1);
    }
    this.smokeDebt += dt * 1.6;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      this.particles.emit({ direction: -90, spread: 30, speed: [6, 16], life: [2.5, 4.5], size: [4, 9], colors: [this.colors.smoke], shape: 'circle', gravity: -4, drag: 0.1, blend: 'normal' }, SCENE.pitX + (this.random() - 0.5) * 20, groundAt(SCENE.pitX) - 4, 1);
    }
    this.particles.update(dt, x => this.windAt(x));
    this.weather.update(dt, x => this.windAt(x));

    // Lantern pendulums and flags in the wind.
    const step = (points, anchor, rest, gravity, windScale) => {
      points[0].x = points[0].px = anchor[0];
      points[0].y = points[0].py = anchor[1];
      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        const vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
        p.px = p.x; p.py = p.y;
        p.x += vx + this.windAt(p.x) * windScale * dt * dt;
        p.y += vy + gravity * dt * dt;
      }
      for (let k = 0; k < 4; k++) for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6, c = (d - rest) / d;
        if (i === 0) { b.x -= dx * c; b.y -= dy * c; } else { a.x += dx * c * 0.5; a.y += dy * c * 0.5; b.x -= dx * c * 0.5; b.y -= dy * c * 0.5; }
      }
    };
    for (const lantern of this.lanterns) step(lantern.points, lantern.anchor, 6, 900, 0.18);
    for (const flag of this.flagLine.flags) step(flag.points, flag.anchor, 6, 260, 1.4);

    // Grass bends with the wind and away from anyone walking through it.
    for (const blade of this.grass) {
      let push = 0;
      for (const actor of actors) {
        const d = blade.x - actor.x;
        if (Math.abs(d) < 40) push += Math.sign(d || 1) * Math.exp(-(d * d) / 300) * 0.9;
      }
      blade.bend = damp(blade.bend, push, 9, dt);
    }

    for (const bird of this.birds) {
      if (!bird.flying) continue;
      bird.t += dt;
      if (bird.t < 0) continue;
      bird.vx += 12 * dt; bird.vy -= 4 * dt;
      bird.x += bird.vx * dt; bird.y += bird.vy * dt;
      bird.alpha = clamp(1 - (bird.t - 4) / 3, 0, 1);
    }
  }

  /** Lights for the lightmap, in playfield coordinates. */
  lights() {
    const list = [];
    const ignition = this.ignition;
    if (ignition.level > 0) {
      const flicker = 0.92 + 0.08 * Math.sin(this.time * 13) * Math.sin(this.time * 7.3);
      list.push({ x: SCENE.beaconX, y: SCENE.bowlY - 30, radius: 720 * Math.min(1.1, ignition.level), color: ignition.color, intensity: 1.05 * Math.min(1, ignition.level) * flicker });
    }
    if (ignition.spark) list.push({ x: ignition.spark.x, y: ignition.spark.y, radius: 170, color: ignition.color, intensity: 0.9 });
    for (const lantern of this.lanterns) {
      if (lantern.lit <= 0) continue;
      const end = lantern.points[lantern.points.length - 1];
      list.push({ x: end.x, y: end.y + 8, radius: 150, color: ignition.color, intensity: 0.8 * lantern.lit });
    }
    return list;
  }

  ambient() {
    return mixHex(this.colors.ambient, mixHex(this.colors.ambientWarm, this.ignition.color, 0.25), this.ignition.glow * 0.62);
  }

  // ---------- Drawing ----------

  /**
   * Ink lines around a filled shape, for the drawn render styles: a dark line of constant screen width that boils,
   * shifting a fraction of a pixel a few times a second as if each frame were drawn again.
   */
  ink(ctx, path, view, weight = 1) {
    const style = this.style;
    if (!style.lines) return;
    ctx.save();
    if (style.boil && !this.reducedMotion) {
      const beat = Math.floor(this.time * 7);
      const jitter = seed => (Math.sin(beat * 12.9898 + seed * 78.233) * 43758.5453) % 1;
      ctx.translate((jitter(1) * 0.8) / view[0], (jitter(2) * 0.8) / view[0]);
    }
    ctx.strokeStyle = style.lineColor;
    ctx.lineWidth = (style.lines * weight * this.unit) / view[0];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(path);
    ctx.restore();
  }

  /** A vertical gradient, smooth or in hard steps for the banded render styles. `stops` are [offset, colour] pairs. */
  gradient(ctx, y0, y1, stops, steps = 0) {
    const gradient = ctx.createLinearGradient(0, y0, 0, y1);
    if (!steps) { for (const [offset, color] of stops) gradient.addColorStop(offset, color); return gradient; }
    const sample = t => {
      const next = stops.findIndex(([offset]) => offset >= t);
      if (next <= 0) return stops[next === -1 ? stops.length - 1 : 0][1];
      const [a, ca] = stops[next - 1], [b, cb] = stops[next];
      return mixHex(ca, cb, b > a ? (t - a) / (b - a) : 0);
    };
    for (let i = 0; i < steps; i++) {
      const color = sample((i + 0.5) / steps);
      gradient.addColorStop(i / steps, color);
      gradient.addColorStop(Math.max(i / steps, (i + 1) / steps - 0.0005), color);
    }
    return gradient;
  }

  drawBackdrop(ctx, camera) {
    const { width, height } = camera;
    const colors = this.colors, style = this.style;
    this.unit = camera.unit;
    const glowAmount = this.ignition.glow, flame = this.ignition.color;
    const warm = (color, amount) => (glowAmount > 0 ? mixHex(color, flame, glowAmount * amount) : color);
    const horizonY = camera.toScreen(0, HORIZON, 0.04)[1];
    const stop = clamp(horizonY / height, 0.2, 0.95);
    // Banded styles step the sky only above the horizon; the haze below it stays one tone.
    const sky = this.gradient(ctx, 0, height, [[0, warm(colors.zenith, 0.06)], [stop * 0.45, warm(colors.upper, 0.1)], [stop * 0.82, warm(colors.middle, 0.2)],
      [stop, warm(colors.horizon, 0.34)], [Math.min(1, stop + 0.04), warm(colors.haze, 0.3)], [1, colors.skyBottom]], style.skySteps || 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Stars fade as the light returns.
    const starView = camera.view(0.01);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = colors.star;
    const fade = 1 - glowAmount * 0.45;
    for (const star of this.stars) {
      const [sx, sy] = [starView[0] * star.x + starView[4], starView[3] * star.y + starView[5]];
      if (sx < -4 || sx > width + 4 || sy < -4 || sy > horizonY) continue;
      const twinkle = this.reducedMotion ? 0.8 : 0.6 + 0.4 * Math.sin(this.time * star.speed + star.phase);
      ctx.globalAlpha = star.bright * twinkle * fade * clamp((horizonY - sy) / 120, 0, 1);
      const size = star.size * camera.unit;
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
    ctx.restore();

    const cirrusView = camera.view(0.015);
    ctx.save();
    ctx.setTransform(...cirrusView);
    for (const streak of this.cirrus) {
      const drift = this.reducedMotion ? 0 : (this.time * 1.5) % 2600;
      const x = ((streak.x + drift + 1300) % 2600) - 1300;
      const gradient = ctx.createLinearGradient(x - streak.w / 2, 0, x + streak.w / 2, 0);
      const color = warm(colors.cirrus, 0.4);
      gradient.addColorStop(0, rgba(color, 0));
      gradient.addColorStop(0.5, rgba(color, streak.alpha + glowAmount * 0.06));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, streak.y, streak.w / 2, streak.h, streak.tilt, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // The frozen sun: a pale, banded disc half sunk in the cloud sea, with a corona that warms after the kindling.
    const [sunX, sunY] = camera.toScreen(380, HORIZON + 36, 0.025);
    const radius = 210 * camera.scaleFor(0.025);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, sunX, sunY, radius * 3.2, warm(colors.sunGlow, 0.3), 0.32 + glowAmount * 0.18);
    ctx.restore();
    ctx.save();
    const disc = ctx.createRadialGradient(sunX - radius * 0.2, sunY - radius * 0.25, radius * 0.1, sunX, sunY, radius);
    disc.addColorStop(0, warm(colors.sun, 0.12));
    disc.addColorStop(1, warm(colors.sunEdge, 0.2));
    ctx.beginPath(); ctx.arc(sunX, sunY, radius, 0, TAU);
    ctx.globalAlpha = 0.94; ctx.fillStyle = disc; ctx.fill();
    ctx.clip();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = colors.sunBands;
    for (let i = 0; i < 6; i++) {
      const y = sunY - radius * 0.86 + i * radius * 0.25 + Math.sin(this.time * 0.05 + i) * 2;
      ctx.fillRect(sunX - radius, y, radius * 2, radius * (0.035 + i * 0.012));
    }
    ctx.restore();

    // Cloud bands and spires, alternating from the horizon down; mist gathers at the foot of each spire layer.
    const fog = this.spec.fog;
    const order = [this.bands[0], this.spires[0], this.bands[1], this.spires[1], this.bands[2], this.spires[2], this.bands[3], this.bands[4]];
    for (const layer of order) {
      if (layer.path && layer.period) this.drawBand(ctx, camera, layer, warm);
      else {
        this.drawSpires(ctx, camera, layer, warm);
        drawMist(ctx, camera, { y: layer.base - 10, p: layer.p, thickness: 40 + layer.p * 420, color: warm(colors.haze, 0.3), alpha: 0.5 * fog, time: this.time, noise: this.noise, spacing: 260 });
      }
      if (layer === this.bands[3]) drawMist(ctx, camera, { y: layer.y + 10, p: layer.p, thickness: 150, color: warm(colors.haze, 0.3), alpha: 0.4 * fog, time: this.time, noise: this.noise, drift: 9, spacing: 300 });
    }
    this.weather.draw(ctx, camera, 'far');
  }

  drawBand(ctx, camera, band, warm) {
    const view = camera.view(band.p);
    const [from, to] = camera.visible(band.p, 200);
    const offset = (this.reducedMotion ? 0 : this.time * band.drift) % band.period;
    ctx.fillStyle = this.style.flat ? mixHex(warm(band.lit, 0.32), warm(band.shade, 0.12), 0.45)
      : this.gradient(ctx, band.y - band.r[1], band.y + band.r[1] * 2.4, [[0, warm(band.lit, 0.32)], [1, warm(band.shade, 0.12)]], this.style.cloudSteps || 0);
    for (let k = Math.floor((from - offset) / band.period); k <= Math.floor((to - offset) / band.period); k++) {
      const x = offset + k * band.period;
      ctx.setTransform(view[0], 0, 0, view[3], view[4] + x * view[0], view[5]);
      ctx.fill(band.path);
    }
    if (this.style.flat) return;
    // A thin haze where the band meets the air above it.
    const haze = warm(this.colors.haze, 0.3);
    const [, top] = camera.toScreen(0, band.y - band.r[1] * 0.4, band.p);
    const gradient = ctx.createLinearGradient(0, top - 30 * camera.unit, 0, top + 40 * camera.unit);
    gradient.addColorStop(0, rgba(haze, 0));
    gradient.addColorStop(0.5, rgba(haze, 0.12));
    gradient.addColorStop(1, rgba(haze, 0));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, top - 30 * camera.unit, camera.width, 70 * camera.unit);
  }

  drawSpires(ctx, camera, layer, warm) {
    const view = camera.view(layer.p);
    ctx.setTransform(...view);
    ctx.fillStyle = warm(layer.color, 0.14);
    ctx.fill(layer.path);
    this.ink(ctx, layer.path, view, 0.45);
    // The frozen sun lights the stacks' sun-facing edges and crests.
    ctx.strokeStyle = rgba(warm(this.colors.spireRim, 0.3), layer.rimAlpha + this.ignition.glow * 0.15);
    ctx.lineWidth = 1.2 / Math.max(0.5, view[0]);
    ctx.lineJoin = 'round';
    ctx.stroke(layer.rim);
    for (const [index, tower] of this.towers.entries()) {
      if (tower.p !== layer.p) continue;
      ctx.fillStyle = mixHex(warm(layer.color, 0.14), this.colors.towerShade, 0.25);
      ctx.fill(this.towerPaths[index]);
      this.ink(ctx, this.towerPaths[index], view, 0.35);
    }
    // Tower flames belong to their layer, so nearer cloud and rock hide them where they should.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const flame = this.ignition.color;
    for (const tower of this.towers) {
      if (tower.p !== layer.p) continue;
      const [x, y] = camera.toScreen(tower.x, tower.y - this.fire.tower * tower.scale, tower.p);
      const z = camera.scaleFor(tower.p) * tower.scale;
      if (tower.lit > 0) {
        glow(ctx, x, y, 70 * z * tower.lit, flame, 0.55 * tower.lit);
        this.drawFlame(ctx, x, y + 2 * z, 12 * z, 24 * z * tower.lit, flame, tower.x);
      } else glow(ctx, x, y, 7 * z, this.colors.coldEmber, 0.32);
    }
    ctx.restore();
  }

  /** The lit near layer: everything on or around the road. `actors` draws characters at the right depth. */
  drawNear(ctx, camera, actors) {
    const flame = this.ignition.color, colors = this.colors, fog = this.spec.fog;
    this.unit = camera.unit;
    // Mid cliffs.
    let view = camera.view(this.mid.p);
    ctx.setTransform(...view);
    ctx.fillStyle = colors.basaltDeep;
    ctx.fill(this.mid.terraces);
    this.ink(ctx, this.mid.terraces, view, 0.6);
    ctx.fillStyle = colors.midMass;
    ctx.fill(this.mid.masses);
    ctx.save();
    ctx.clip(this.mid.masses);
    ctx.strokeStyle = rgba(colors.midJoint, 0.32); ctx.lineWidth = 1.1;
    ctx.stroke(this.mid.joints);
    ctx.restore();
    this.ink(ctx, this.mid.masses, view, 0.8);
    ctx.strokeStyle = rgba(colors.rim, 0.45); ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    ctx.stroke(this.mid.rim);
    drawMist(ctx, camera, { y: 150, p: this.mid.p, thickness: 220, color: colors.haze, alpha: 0.32 * fog, time: this.time, noise: this.noise, drift: 7 });

    // Arch ruin, vines and roosting birds.
    view = camera.view(this.arch.p);
    ctx.setTransform(...view);
    ctx.fillStyle = colors.stone;
    ctx.fill(this.arch.body);
    this.ink(ctx, this.arch.body, view, 0.9);
    ctx.strokeStyle = rgba(colors.rim, 0.5); ctx.lineWidth = 1.3;
    ctx.stroke(this.arch.rim);
    ctx.strokeStyle = colors.vine; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (const vine of this.vines) {
      const sway = this.reducedMotion ? 0 : Math.sin(this.time * 1.3 + vine.phase) * 3;
      ctx.beginPath(); ctx.moveTo(vine.x, vine.top); ctx.quadraticCurveTo(vine.x + sway, vine.top + vine.length * 0.6, vine.x + sway * 1.6, vine.top + vine.length); ctx.stroke();
    }
    for (const bird of this.birds) this.drawBird(ctx, bird);

    // Beacon, posts, flags, bench and balustrade sit behind the road's edge.
    view = camera.view(1);
    ctx.setTransform(...view);
    ctx.fillStyle = colors.basalt;
    ctx.fill(this.beacon.body);
    ctx.fillStyle = colors.basaltDeep;
    ctx.fill(this.beacon.bands);
    ctx.fillStyle = colors.bowl;
    ctx.fill(this.beacon.bowl);
    this.ink(ctx, this.beacon.body, view, 1);
    this.ink(ctx, this.beacon.bowl, view, 1);
    ctx.strokeStyle = rgba(colors.rim, 0.55); ctx.lineWidth = 1.5;
    ctx.stroke(this.beacon.edges);
    const lit = this.ignition.level;
    ctx.fillStyle = lit > 0 ? mixHex(colors.coalsWarm, flame, 0.6 * Math.min(1, lit)) : colors.coals;
    ctx.beginPath(); ctx.ellipse(SCENE.beaconX, SCENE.bowlY + this.fire.base + 4, this.fire.coals, 6, 0, 0, TAU); ctx.fill();

    ctx.fillStyle = colors.iron;
    ctx.fill(this.flagLine.poles);
    this.ink(ctx, this.flagLine.poles, view, 0.6);
    ctx.strokeStyle = colors.rope; ctx.lineWidth = 1.3;
    ctx.stroke(this.flagLine.rope);
    for (const flag of this.flagLine.flags) {
      const [a, b, c, d] = flag.points;
      ctx.fillStyle = flag.color;
      ctx.beginPath();
      ctx.moveTo(a.x - 6, a.y); ctx.lineTo(a.x + 6, a.y);
      ctx.quadraticCurveTo(b.x + 6, b.y, c.x + 5.5, c.y); ctx.lineTo(d.x + 4, d.y); ctx.lineTo(d.x - 4, d.y); ctx.lineTo(c.x - 5.5, c.y);
      ctx.quadraticCurveTo(b.x - 6, b.y, a.x - 6, a.y); ctx.closePath();
      ctx.fill();
    }
    for (const lantern of this.lanterns) {
      ctx.fillStyle = colors.iron;
      ctx.fill(lantern.post);
      this.ink(ctx, lantern.post, view, 0.6);
      const [a, , c] = lantern.points;
      ctx.strokeStyle = colors.chain; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      const angle = Math.atan2(c.y - lantern.points[1].y, c.x - lantern.points[1].x) - Math.PI / 2;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(angle);
      ctx.fillStyle = colors.iron;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(8, 4); ctx.lineTo(-8, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lantern.lit > 0 ? mixHex(colors.glassCold, mixHex(flame, '#ffffff', 0.35), lantern.lit) : colors.glassCold;
      ctx.fillRect(-6, 4, 12, 13);
      ctx.fillStyle = colors.iron;
      ctx.fillRect(-7, 16, 14, 3); ctx.fillRect(-1, 4, 2, 13);
      ctx.restore();
    }
    ctx.fillStyle = colors.stone;
    ctx.fill(this.props.stone);
    this.ink(ctx, this.props.stone, view, 0.8);
    ctx.strokeStyle = rgba(colors.rim, 0.45); ctx.lineWidth = 1.2;
    ctx.stroke(this.props.stoneEdges);

    // Road, bridge and back grass.
    for (const [index, tone] of colors.road.entries()) {
      ctx.fillStyle = this.style.flat ? mixHex(tone, colors.roadDeep, 0.3) : this.gradient(ctx, -30, 380, [[0, tone], [1, colors.roadDeep]], this.style.cloudSteps || 0);
      ctx.fill(this.ground.tones[index]);
      this.ink(ctx, this.ground.tones[index], view, 0.7);
    }
    ctx.strokeStyle = rgba(colors.roadJoint, 0.6); ctx.lineWidth = 1.2;
    ctx.stroke(this.ground.joints);
    ctx.fillStyle = colors.moss;
    ctx.fill(this.ground.crown);
    ctx.strokeStyle = colors.mossStroke; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.stroke(this.ground.moss);
    ctx.fillStyle = colors.stone;
    ctx.fill(this.ground.pebbles);
    ctx.strokeStyle = rgba(colors.rim, 0.6); ctx.lineWidth = 1.5;
    ctx.stroke(this.ground.rim);
    ctx.strokeStyle = colors.basaltDeep; ctx.lineWidth = 3;
    ctx.stroke(this.ground.edge);
    ctx.fillStyle = colors.woodDark;
    ctx.fill(this.bridge.posts);
    ctx.fillStyle = colors.wood;
    ctx.fill(this.bridge.planks);
    this.ink(ctx, this.bridge.planks, view, 0.5);
    ctx.strokeStyle = colors.rope; ctx.lineWidth = 1.4;
    ctx.stroke(this.bridge.ropes);
    this.drawGrass(ctx, camera, false);

    actors(ctx);

    this.particles.draw(ctx, camera.view(1), 'normal', { reduced: this.reducedMotion });
    ctx.setTransform(...camera.view(1));
    this.drawGrass(ctx, camera, true);
    // Mist over the road, lit by the lights like everything on it.
    drawMist(ctx, camera, { y: -4, p: 1, thickness: 120, color: colors.haze, alpha: 0.3 * fog, time: this.time, noise: this.noise, drift: 12, spacing: 170 });

    // Foreground frame.
    view = camera.view(this.foreground.p);
    ctx.setTransform(...view);
    ctx.fillStyle = colors.silhouette;
    ctx.fill(this.foreground.body);
    ctx.fill(this.foreground.tree);
    ctx.strokeStyle = rgba(colors.rim, 0.22); ctx.lineWidth = 1.5;
    ctx.stroke(this.foreground.rim);
  }

  /** Weather in front of the road: snow, rain, petals and the rest, drawn after the lit layer. */
  drawWeather(ctx, camera) {
    this.weather.draw(ctx, camera, 'near');
  }

  drawBird(ctx, bird) {
    if (bird.alpha <= 0) return;
    const flapping = bird.flying && bird.t >= 0;
    const wing = flapping ? Math.sin(this.time * bird.flap * TAU * 0.5) * 5 : 0;
    ctx.globalAlpha = bird.alpha;
    ctx.fillStyle = this.colors.bird;
    ctx.beginPath(); ctx.ellipse(bird.x, bird.y, 4.2, 2.4, flapping ? -0.2 : 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    if (flapping) { ctx.moveTo(bird.x - 1, bird.y); ctx.lineTo(bird.x - 7, bird.y - wing - 1); ctx.lineTo(bird.x + 2, bird.y - 1); ctx.moveTo(bird.x + 1, bird.y); ctx.lineTo(bird.x + 7, bird.y - wing - 2); ctx.lineTo(bird.x - 1, bird.y - 1); }
    else { ctx.moveTo(bird.x + 3, bird.y - 1); ctx.lineTo(bird.x + 6.5, bird.y - 2.5); ctx.lineTo(bird.x + 3.5, bird.y + 0.5); }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawGrass(ctx, camera, front) {
    const [from, to] = camera.visible(1, 40);
    const paths = front ? [new Path2D()] : [new Path2D(), new Path2D(), new Path2D()];
    const t = this.time;
    for (const blade of this.grass) {
      if (blade.front !== front || blade.x < from || blade.x > to) continue;
      const base = groundAt(blade.x) + (front ? 5 : 1);
      const sway = (this.reducedMotion ? 0.3 : 0.18 + 0.12 * Math.sin(t * 2.1 + blade.phase + blade.x * 0.02)) * (this.windAt(blade.x) / -140);
      const angle = blade.lean - sway + blade.bend;
      const tipX = blade.x + Math.sin(angle) * blade.h, tipY = base - Math.cos(angle) * blade.h;
      const path = paths[front ? 0 : blade.color];
      path.moveTo(blade.x - 1.6, base);
      path.quadraticCurveTo(blade.x + Math.sin(angle) * blade.h * 0.4 - 0.6, base - blade.h * 0.55, tipX, tipY);
      path.quadraticCurveTo(blade.x + Math.sin(angle) * blade.h * 0.4 + 0.8, base - blade.h * 0.5, blade.x + 1.6, base);
      path.closePath();
    }
    if (front) { ctx.fillStyle = this.colors.grassFront; ctx.fill(paths[0]); }
    else paths.forEach((path, index) => { ctx.fillStyle = this.colors.grass[index]; ctx.fill(path); });
  }

  /** Neon edges: the sunlit rims of the cliffs, the arch, the beacon and the road, glowing in the rim colour. */
  drawNeonEdges(ctx, camera) {
    const color = mixHex(this.colors.rim, '#ffffff', 0.15);
    const stroke = (path, p) => {
      const view = camera.view(p);
      ctx.setTransform(...view);
      for (const [width, alpha] of [[5, 0.12], [2.2, 0.32], [1, 0.75]]) {
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = (width * camera.unit) / view[0];
        ctx.stroke(path);
      }
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    // The cliffs and the arch stand behind the road, so their edges stop where the road's surface hides them.
    const [from, to] = camera.visible(1, 60);
    const above = new Path2D();
    above.moveTo(from, -4000);
    for (let x = from; x < to + 20; x += 20) above.lineTo(x, groundAt(x) + 2);
    above.lineTo(to + 20, -4000);
    above.closePath();
    ctx.save();
    ctx.setTransform(...camera.view(1));
    ctx.clip(above);
    stroke(this.mid.rim, this.mid.p);
    stroke(this.arch.rim, this.arch.p);
    ctx.restore();
    for (const [path, p] of [[this.beacon.edges, 1], [this.props.stoneEdges, 1], [this.ground.rim, 1], [this.foreground.rim, this.foreground.p]]) stroke(path, p);
    ctx.restore();
  }

  /** Additive pass: flames, lantern glass, the travelling spark, far towers, fireflies and embers. */
  drawGlows(ctx, camera) {
    const ignition = this.ignition, flame = ignition.color;
    if (this.style.neon) this.drawNeonEdges(ctx, camera);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const unit = camera.scaleFor(1);
    const [bx, by] = camera.toScreen(SCENE.beaconX, SCENE.bowlY + this.fire.base);
    if (ignition.level > 0) {
      const level = Math.min(1.15, ignition.level);
      glow(ctx, bx, by - 60 * unit, 520 * unit * level, flame, 0.42 * Math.min(1, level));
      this.drawFlame(ctx, bx, by, this.fire.width * unit, 210 * unit * level, flame, 0);
      if (!this.reducedMotion && ignition.t > 0.7 && ignition.t < 2.3) {
        const u = (ignition.t - 0.7) / 1.6;
        ctx.globalAlpha = 0.35 * (1 - u);
        ctx.strokeStyle = mixHex(flame, '#ffffff', 0.4);
        ctx.lineWidth = lerp(8, 1, u) * unit;
        ctx.beginPath(); ctx.arc(bx, by - 40 * unit, easeOut(u) * 1100 * unit, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else glow(ctx, bx, by - 4 * unit, 46 * unit, this.colors.coldGlow, 0.4 + 0.1 * Math.sin(this.time * 1.7));
    if (ignition.spark) {
      const [sx, sy] = camera.toScreen(ignition.spark.x, ignition.spark.y);
      glow(ctx, sx, sy, 60 * unit, flame, 0.9);
      glow(ctx, sx, sy, 14 * unit, '#ffffff', 0.9);
    }
    for (const lantern of this.lanterns) {
      if (lantern.lit <= 0) continue;
      const end = lantern.points[lantern.points.length - 1];
      const [x, y] = camera.toScreen(end.x, end.y + 10);
      glow(ctx, x, y, 46 * unit * lantern.lit, flame, 0.6 * lantern.lit);
    }
    this.weather.drawFireflies(ctx, camera, groundAt, flame, ignition.glow);
    ctx.restore();
    this.particles.draw(ctx, camera.view(1), 'add', { reduced: this.reducedMotion });
  }

  drawFlame(ctx, x, y, width, height, color, seed) {
    if (height <= 0.5) return;
    const t = this.time;
    const deep = mixHex(color, '#1a0d08', 0.3), hot = mixHex(color, '#ffffff', 0.5);
    // Side tongues lick up at their own pace around a taller core; the hottest layers sit innermost.
    const tongues = [
      { dx: -0.3, w: 0.5, h: 0.58, c: deep, a: 0.4, rate: 2.7 },
      { dx: 0.32, w: 0.46, h: 0.66, c: deep, a: 0.4, rate: 3.1 },
      { dx: 0, w: 1, h: 1, c: deep, a: 0.42, rate: 1.6 },
      { dx: -0.14, w: 0.66, h: 0.82, c: color, a: 0.55, rate: 2.3 },
      { dx: 0.16, w: 0.5, h: 0.72, c: color, a: 0.5, rate: 2.9 },
      { dx: 0, w: 0.46, h: 0.58, c: hot, a: 0.72, rate: 2.5 },
      { dx: 0, w: 0.22, h: 0.34, c: '#fffaf0', a: 0.85, rate: 3.6 },
    ];
    const lean = (this.windAt(0) / 140) * 0.12;
    for (const [index, tongue] of tongues.entries()) {
      const wobble = this.reducedMotion ? 0.5 : this.noise(t * tongue.rate + index * 3.1 + seed * 0.01);
      const h = height * tongue.h * (0.8 + 0.4 * wobble);
      const w = width * tongue.w;
      const base = x + tongue.dx * width;
      const sway = (this.reducedMotion ? 0 : (this.noise(t * 1.4 + index * 1.7 + seed) - 0.5) * w * 0.6) + lean * h;
      ctx.globalAlpha = tongue.a;
      ctx.fillStyle = tongue.c;
      ctx.beginPath();
      ctx.moveTo(base - w / 2, y);
      ctx.bezierCurveTo(base - w / 2, y - h * 0.45, base + sway - w * 0.16, y - h * 0.72, base + sway, y - h);
      ctx.bezierCurveTo(base + sway + w * 0.16, y - h * 0.72, base + w / 2, y - h * 0.45, base + w / 2, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
