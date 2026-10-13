// Node-side drawing of a character for the harness. It poses the character through the game's own rig, gait,
// clips and cloth physics, then fills a grid of cells with whichever part is on top. The grid gives the check
// tool its text previews, and the measures their visible colours and silhouette; the browser stays the real renderer.

import { buildRig, boneMatrices } from '../src/rig.js';
import { CharacterController } from '../src/motion.js';
import { Secondary } from '../src/physics.js';
import { parsePath } from '../src/geometry.js';
import { multiply, rotationAbout, translation, rotation, scaling, transformPoint, mixHex } from '../src/math.js';

// The painter darkens back limbs toward the same tone.
const SHADOW_TONE = '#141a29';
const WIND = () => -70;
const STEP = 1 / 120;

function cubic(p0, p1, p2, p3, steps) {
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    points.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return points;
}

function quadratic(p0, p1, p2, steps) {
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    points.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return points;
}

/** SVG endpoint arc to points, through the centre parametrisation of the SVG implementation notes (F.6.5). */
function arc([x1, y1], { points: [[x2, y2]], rx, ry, angle, large, sweep }) {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [[x2, y2]];
  const phi = angle * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const numerator = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  let factor = Math.sqrt(Math.max(0, numerator / denominator));
  if (large === sweep) factor = -factor;
  const cxp = factor * (rx * yp) / ry, cyp = -factor * (ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angleBetween = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angleBetween(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angleBetween((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  else if (sweep && delta < 0) delta += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 16)));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = start + (delta * i) / steps;
    points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  points[points.length - 1] = [x2, y2];
  return points;
}

const flatCache = new Map();
/** Path data as polylines in its own coordinates; curves and arcs become short straight runs. */
export function flattenPath(d) {
  if (flatCache.has(d)) return flatCache.get(d);
  const lines = [];
  let current = null, at = [0, 0], start = [0, 0];
  const open = () => { if (!current) { current = [at]; lines.push(current); } };
  for (const segment of parsePath(d, { maxCommands: 20000 }).segments) {
    if (segment.command === 'M') { at = segment.points[0]; start = at; current = [at]; lines.push(current); continue; }
    if (segment.command === 'Z') { if (current) current.closed = true; at = start; current = null; continue; }
    open();
    const next = segment.command === 'L' ? [segment.points[0]]
      : segment.command === 'C' ? cubic(at, ...segment.points, 10)
      : segment.command === 'Q' ? quadratic(at, ...segment.points, 8)
      : arc(at, segment);
    current.push(...next);
    at = next[next.length - 1];
  }
  const result = lines.filter(line => line.length > 1);
  if (flatCache.size > 4000) flatCache.clear();
  flatCache.set(d, result);
  return result;
}

/** Bounds of the drawn outline itself; parsed path bounds are conservative around control points and arcs. */
export function exactBounds(d) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const line of flattenPath(d)) for (const [x, y] of line) {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  }
  return bounds;
}

const transformLines = (lines, matrix) => lines.map(line => {
  const moved = line.map(([x, y]) => transformPoint(matrix, x, y));
  moved.closed = line.closed;
  return moved;
});

function worldMatrices(rig, controller) {
  const local = boneMatrices(rig, controller.pose);
  return Object.fromEntries(Object.entries(local).map(([key, matrix]) => [key, multiply(controller.worldMatrix, matrix)]));
}

/**
 * The character in one of three poses, simulated as the game would: `rest` stands still for two seconds,
 * `walk` walks for two seconds and stops at the widest step, `kindle` plays the signature clip to its kindling.
 */
export function poseCharacter(character, pose = 'rest') {
  const rig = buildRig(character);
  const controller = new CharacterController(character, rig, { ground: () => 0, x: 0, facing: 1, seed: 5 });
  const secondary = new Secondary(character);
  let matrices = worldMatrices(rig, controller);
  const step = () => {
    controller.update(STEP);
    matrices = worldMatrices(rig, controller);
    secondary.update(STEP, matrices, { wind: WIND, ground: () => 0 });
  };
  for (let i = 0; i < 240; i++) step();
  if (pose === 'walk') {
    controller.input.dir = 1;
    for (let i = 0; i < 240; i++) step();
    // Phase 0 puts the front foot at its farthest forward and the back foot at the end of its stance.
    for (let guard = 0; guard < 480 && !(controller.phase > 0.01 && controller.phase < 0.05); guard++) step();
  } else if (pose === 'kindle' && character.clips.signature) {
    controller.playClip('signature', { lock: true });
    const until = character.clips.signature.kindleAt;
    for (let guard = 0; guard < 1200 && controller.clip && controller.clip.t < until; guard++) step();
  }
  return { rig, controller, secondary, matrices, offsetX: controller.x };
}

/** Every drawn shape of a posed character in world coordinates, back to front, as the painter orders them. */
export function posedShapes(character, posed) {
  const { rig, secondary, matrices } = posed;
  const shapes = [];
  const shade = color => (color ? mixHex(color, SHADOW_TONE, character.style.backShade) : null);
  for (const item of rig.drawList) {
    if (item.kind === 'part') {
      const part = item.part;
      let matrix = matrices[item.key];
      const spring = secondary.angles.get(part.id);
      if (spring) matrix = multiply(matrix, rotationAbout(part.spring.pivot[0], part.spring.pivot[1], spring));
      shapes.push({ kind: 'part', id: part.id, bone: part.bone, back: item.back, lines: transformLines(flattenPath(part.d), matrix),
        fill: item.back ? shade(part.fill) : part.fill, stroke: item.back ? shade(part.stroke) : part.stroke, strokeWidth: part.strokeWidth, opacity: part.opacity, role: part.role });
      continue;
    }
    const def = item.chain, chain = secondary.byId.get(def.id);
    if (!chain?.points) continue;
    const points = chain.points, n = points.length - 1, left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const length = Math.hypot(tx, ty) || 1;
      tx /= length; ty /= length;
      const half = (def.width[0] + (def.width[1] - def.width[0]) * (i / n)) / 2;
      left.push([points[i].x - ty * half, points[i].y + tx * half]);
      right.push([points[i].x + ty * half, points[i].y - tx * half]);
    }
    const ribbon = [...left, ...right.reverse()];
    ribbon.closed = true;
    const fill = def.stripes ? def.stripes[0] : def.fill;
    shapes.push({ kind: 'cloth', id: def.id, bone: def.bone, back: item.back, lines: [ribbon], fill: item.back ? shade(fill) : fill,
      stroke: def.stroke, strokeWidth: def.strokeWidth, opacity: def.opacity, stripes: def.stripes });
    if (def.tip) {
      const frame = secondary.tipFrame(def.id);
      const facing = Math.sign(posed.controller.visualFacing || 1);
      const matrix = multiply(translation(frame.x, frame.y), multiply(rotation(Math.atan2(frame.uy, frame.ux) - Math.PI / 2), scaling(facing, 1)));
      def.tip.forEach((shape, index) => shapes.push({ kind: 'tip', id: `${def.id}-tip-${index + 1}`, chain: def.id, bone: def.bone, back: item.back,
        lines: transformLines(flattenPath(shape.d), matrix), fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: shape.opacity }));
    }
  }
  return shapes;
}

function boundsOf(shapes) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const shape of shapes) for (const line of shape.lines) for (const [x, y] of line) {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  }
  return bounds;
}

/**
 * Fill a grid of cells with the top-most shape at each cell centre. Fills use the non-zero rule, as canvas does;
 * strokes cover cells within half their width of the line, and at least a cell's width so thin lines survive.
 * Shapes under half opacity do not hide what lies beneath them.
 */
export function rasterize(shapes, { cell, cellWidth = cell, bounds = boundsOf(shapes), margin = 1 } = {}) {
  const minX = bounds.minX - margin * cellWidth, minY = bounds.minY - margin * cell;
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellWidth) + margin * 2);
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cell) + margin * 2);
  const owner = new Int16Array(cols * rows).fill(-1);
  const color = new Array(cols * rows).fill(null);
  shapes.forEach((shape, index) => {
    if (shape.opacity < 0.5) return;
    if (shape.fill) {
      const edges = [];
      for (const line of shape.lines) for (let i = 0; i < line.length; i++) {
        const a = line[i], b = line[(i + 1) % line.length];
        if (a[1] !== b[1]) edges.push(a[1] < b[1] ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1], dir: 1 } : { x0: b[0], y0: b[1], x1: a[0], y1: a[1], dir: -1 });
      }
      if (edges.length) {
        const top = Math.max(0, Math.floor((Math.min(...edges.map(edge => edge.y0)) - minY) / cell));
        const bottom = Math.min(rows - 1, Math.ceil((Math.max(...edges.map(edge => edge.y1)) - minY) / cell));
        for (let row = top; row <= bottom; row++) {
          const y = minY + (row + 0.5) * cell;
          const crossings = [];
          for (const edge of edges) if (y >= edge.y0 && y < edge.y1) crossings.push({ x: edge.x0 + ((y - edge.y0) * (edge.x1 - edge.x0)) / (edge.y1 - edge.y0), dir: edge.dir });
          crossings.sort((a, b) => a.x - b.x);
          let winding = 0;
          for (let i = 0; i < crossings.length - 1; i++) {
            winding += crossings[i].dir;
            if (!winding) continue;
            const from = Math.max(0, Math.ceil((crossings[i].x - minX) / cellWidth - 0.5));
            const to = Math.min(cols - 1, Math.floor((crossings[i + 1].x - minX) / cellWidth - 0.5));
            for (let col = from; col <= to; col++) { owner[row * cols + col] = index; color[row * cols + col] = shape.fill; }
          }
        }
      }
    }
    if (shape.stroke && shape.strokeWidth > 0) {
      // Reach is at least half a cell in each direction, so a line thinner than a cell still marks one.
      const reachX = Math.max(shape.strokeWidth / 2, cellWidth / 2), reachY = Math.max(shape.strokeWidth / 2, cell / 2);
      for (const line of shape.lines) {
        const count = line.closed ? line.length : line.length - 1;
        for (let i = 0; i < count; i++) {
          const [ax, ay] = line[i], [bx, by] = line[(i + 1) % line.length];
          const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - reachX - minX) / cellWidth)), c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + reachX - minX) / cellWidth));
          const r0 = Math.max(0, Math.floor((Math.min(ay, by) - reachY - minY) / cell)), r1 = Math.min(rows - 1, Math.ceil((Math.max(ay, by) + reachY - minY) / cell));
          const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy || 1e-9;
          for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
            const px = minX + (col + 0.5) * cellWidth, py = minY + (row + 0.5) * cell;
            const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
            const ex = ax + t * dx - px, ey = ay + t * dy - py;
            if ((ex / reachX) ** 2 + (ey / reachY) ** 2 <= 1) { owner[row * cols + col] = index; color[row * cols + col] = shape.stroke; }
          }
        }
      }
    }
  });
  return { cols, rows, minX, minY, cell, cellWidth, owner, color, shapes };
}

const FRONT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$=+~^?!';

/**
 * A text picture of one pose: each cell shows the top-most part's symbol, back copies of limbs in lowercase, and
 * the ground as a row of dashes. Cells are half as wide as they are tall, like terminal text, so shapes keep
 * their proportions.
 */
export function asciiPose(character, pose, { cell } = {}) {
  const posed = poseCharacter(character, pose);
  const shapes = posedShapes(character, posed);
  const bounds = boundsOf(shapes);
  const size = cell ?? Math.max(2, -bounds.minY / 34);
  const grid = rasterize(shapes, { cell: size, cellWidth: size / 2, bounds: { ...bounds, maxY: Math.max(bounds.maxY, size) } });
  const ids = [...new Set([...character.parts.map(part => part.id), ...character.cloth.flatMap(chain => [chain.id, ...(chain.tip ? [`${chain.id}-tip`] : [])])])];
  const symbolOf = new Map(ids.map((id, index) => [id, FRONT[index] ?? '*']));
  const key = shape => shape.kind === 'tip' ? `${shape.chain}-tip` : shape.id;
  const seen = new Map();
  const lines = [];
  for (let row = 0; row < grid.rows; row++) {
    let text = '';
    const y = grid.minY + (row + 0.5) * grid.cell;
    for (let col = 0; col < grid.cols; col++) {
      const index = grid.owner[row * grid.cols + col];
      if (index < 0) { text += y > 0 ? '-' : ' '; continue; }
      const shape = shapes[index], id = key(shape);
      let symbol = symbolOf.get(id) ?? '*';
      if (shape.back) symbol = /[A-Z]/u.test(symbol) ? symbol.toLowerCase() : ':';
      seen.set(id, (seen.get(id) || 0) + 1);
      text += symbol;
    }
    lines.push(text.replace(/\s+$/u, ''));
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  // One row of dashes is enough to show where the ground is.
  while (lines.length > 1 && /^-+$/u.test(lines.at(-1)) && /^-+$/u.test(lines.at(-2))) lines.pop();
  const legend = ids.filter(id => seen.has(id)).map(id => `${symbolOf.get(id)} ${id}`);
  const hidden = ids.filter(id => !seen.has(id));
  return { pose, cell: Number(size.toFixed(2)), text: lines.join('\n'), legend, hidden,
    width: Math.round(bounds.maxX - bounds.minX), height: Math.round(-bounds.minY), light: lightPosition(character, posed) };
}

/** Where the carried light sits in a posed character, in the same coordinates (x from the hip, ground at 0). */
export function lightPosition(character, posed) {
  const light = character.light;
  if (!light) return null;
  const { attach } = light;
  let at = null;
  if (attach.cloth) at = posed.secondary.tip(attach.cloth, attach.offset, Math.sign(posed.controller.visualFacing) || 1);
  else if (attach.bone) {
    const key = ['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].includes(attach.bone) ? `${attach.bone}${attach.side === 'back' ? 'Back' : 'Front'}` : attach.bone;
    at = transformPoint(posed.matrices[key], attach.offset[0], attach.offset[1]);
  }
  return at ? [Math.round(at[0] - posed.offsetX), Math.round(at[1])] : null;
}

/** Visible colour shares and a coarse silhouette mask of the standing character, for fingerprints. */
export function restRaster(character, { rows = 120 } = {}) {
  const posed = poseCharacter(character, 'rest');
  const shapes = posedShapes(character, posed);
  const bounds = boundsOf(shapes);
  const cell = Math.max(0.5, -bounds.minY / rows);
  const grid = rasterize(shapes, { cell, bounds: { ...bounds, maxY: Math.min(bounds.maxY, 0) } });
  const counts = new Map();
  let covered = 0;
  for (let i = 0; i < grid.color.length; i++) {
    const value = grid.color[i];
    if (!value) continue;
    covered++;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([hex, count]) => ({ hex, share: Number((count / covered).toFixed(4)) }));
  const visible = new Map();
  for (let i = 0; i < grid.owner.length; i++) if (grid.owner[i] >= 0) { const shape = shapes[grid.owner[i]]; visible.set(shape.kind === 'tip' ? shape.chain : shape.id, (visible.get(shape.kind === 'tip' ? shape.chain : shape.id) || 0) + 1); }
  return { grid, shapes, bounds, posed, colors, covered, visible };
}

/**
 * Occupancy of the standing figure on a fixed lattice: height normalised to the figure, x centred on the hip, so
 * two characters' outlines can be compared whatever their size. Returned as rows of 0/1 characters.
 */
export function silhouetteMask(character, { figureHeight, cols = 24, rows = 36, raster = restRaster(character) } = {}) {
  const height = figureHeight || -raster.bounds.minY;
  const hipX = character.skeleton.hip[0];
  const grid = raster.grid;
  const result = [];
  // Square lattice cells: the lattice is as many figure heights wide as cols / rows, centred on the hip.
  const step = height / rows;
  for (let row = 0; row < rows; row++) {
    let text = '';
    for (let col = 0; col < cols; col++) {
      const x = hipX + (col + 0.5 - cols / 2) * step, y = -height + (row + 0.5) * step;
      const gc = Math.floor((x - grid.minX) / grid.cellWidth), gr = Math.floor((y - grid.minY) / grid.cell);
      text += gc >= 0 && gc < grid.cols && gr >= 0 && gr < grid.rows && grid.owner[gr * grid.cols + gc] >= 0 ? '1' : '0';
    }
    result.push(text);
  }
  return result;
}
