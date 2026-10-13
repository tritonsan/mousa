// SVG path data for character parts. Primitive shapes become path data, so every part draws through one
// Path2D route in the browser and is measured the same way in Node (validation, bounds, shape counts).

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/u;
const COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';

export class PathSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathSyntaxError';
  }
}

/**
 * Parse path data into absolute segments. Bounds include control points and, for arcs, a conservative box,
 * so they never undercount the drawn area. Arc flags may be written without separators, as SVG allows.
 */
export function parsePath(d, { maxCommands = 400 } = {}) {
  if (typeof d !== 'string') throw new PathSyntaxError('Path data must be a string.');
  const n = d.length;
  let i = 0;
  let commands = 0, subpaths = 0;
  let x = 0, y = 0, startX = 0, startY = 0;
  let control = null, previous = '';
  const segments = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (px, py) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new PathSyntaxError('Path data contains a non-finite number.');
    if (px < bounds.minX) bounds.minX = px;
    if (py < bounds.minY) bounds.minY = py;
    if (px > bounds.maxX) bounds.maxX = px;
    if (py > bounds.maxY) bounds.maxY = py;
  };
  const skip = () => {
    while (i < n) {
      const code = d.charCodeAt(i);
      if (code === 32 || code === 44 || code === 9 || code === 10 || code === 13) i++;
      else break;
    }
  };
  const startsNumber = () => {
    skip();
    if (i >= n) return false;
    const c = d[i];
    return c === '-' || c === '+' || c === '.' || (c >= '0' && c <= '9');
  };
  const number = () => {
    skip();
    const match = NUMBER.exec(d.slice(i, i + 40));
    if (!match) throw new PathSyntaxError(`Expected a number at character ${i}.`);
    i += match[0].length;
    return Number(match[0]);
  };
  const flag = () => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new PathSyntaxError(`Expected an arc flag (0 or 1) at character ${i}.`);
    i++;
    return c === '1';
  };
  skip();
  if (i < n && d[i] !== 'M' && d[i] !== 'm') throw new PathSyntaxError('Path data must start with M or m.');
  while (true) {
    skip();
    if (i >= n) break;
    const letter = d[i];
    if (!COMMANDS.includes(letter)) throw new PathSyntaxError(`Unexpected "${letter.slice(0, 1)}" at character ${i}.`);
    i++;
    if (++commands > maxCommands) throw new PathSyntaxError(`A path may have at most ${maxCommands} commands.`);
    const relative = letter === letter.toLowerCase();
    const command = letter.toUpperCase();
    if (command === 'Z') {
      x = startX; y = startY;
      segments.push({ command: 'Z' });
      control = null; previous = 'Z';
      continue;
    }
    let first = true;
    do {
      const ox = relative ? x : 0, oy = relative ? y : 0;
      switch (command) {
        case 'M': {
          const px = number() + ox, py = number() + oy;
          include(px, py);
          if (first) { startX = px; startY = py; subpaths++; segments.push({ command: 'M', points: [[px, py]] }); }
          else segments.push({ command: 'L', points: [[px, py]] });
          x = px; y = py; control = null;
          break;
        }
        case 'L': {
          const px = number() + ox, py = number() + oy;
          include(px, py);
          segments.push({ command: 'L', points: [[px, py]] });
          x = px; y = py; control = null;
          break;
        }
        case 'H': {
          const px = number() + ox;
          include(px, y);
          segments.push({ command: 'L', points: [[px, y]] });
          x = px; control = null;
          break;
        }
        case 'V': {
          const py = number() + oy;
          include(x, py);
          segments.push({ command: 'L', points: [[x, py]] });
          y = py; control = null;
          break;
        }
        case 'C': {
          const x1 = number() + ox, y1 = number() + oy, x2 = number() + ox, y2 = number() + oy, px = number() + ox, py = number() + oy;
          include(x1, y1); include(x2, y2); include(px, py);
          segments.push({ command: 'C', points: [[x1, y1], [x2, y2], [px, py]] });
          control = [x2, y2]; x = px; y = py;
          break;
        }
        case 'S': {
          const reflected = (previous === 'C' || previous === 'S') && control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
          const x2 = number() + ox, y2 = number() + oy, px = number() + ox, py = number() + oy;
          include(reflected[0], reflected[1]); include(x2, y2); include(px, py);
          segments.push({ command: 'C', points: [reflected, [x2, y2], [px, py]] });
          control = [x2, y2]; x = px; y = py;
          break;
        }
        case 'Q': {
          const x1 = number() + ox, y1 = number() + oy, px = number() + ox, py = number() + oy;
          include(x1, y1); include(px, py);
          segments.push({ command: 'Q', points: [[x1, y1], [px, py]] });
          control = [x1, y1]; x = px; y = py;
          break;
        }
        case 'T': {
          const reflected = (previous === 'Q' || previous === 'T') && control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
          const px = number() + ox, py = number() + oy;
          include(reflected[0], reflected[1]); include(px, py);
          segments.push({ command: 'Q', points: [reflected, [px, py]] });
          control = reflected; x = px; y = py;
          break;
        }
        case 'A': {
          const rx = Math.abs(number()), ry = Math.abs(number());
          const angle = number();
          const large = flag(), sweep = flag();
          const px = number() + ox, py = number() + oy;
          // Every point of an ellipse lies within one diameter of any other point on it, so the arc stays inside
          // the overlap of the two diameter-sized boxes around its endpoints. Radii that are too small to span
          // the chord are scaled up by the renderer, which the half-chord term covers.
          const reach = 2 * Math.max(rx, ry, Math.hypot(px - x, py - y) / 2);
          include(Math.max(x, px) - reach, Math.max(y, py) - reach);
          include(Math.min(x, px) + reach, Math.min(y, py) + reach);
          include(px, py);
          segments.push({ command: 'A', points: [[px, py]], rx, ry, angle, large, sweep });
          x = px; y = py; control = null;
          break;
        }
        default:
          throw new PathSyntaxError(`Unsupported command ${command}.`);
      }
      previous = command;
      first = false;
    } while (startsNumber());
  }
  if (!subpaths) throw new PathSyntaxError('Path data must draw at least one subpath.');
  return { segments, commands, subpaths, bounds };
}

const r2 = value => Number(value.toFixed(2));
const point = (px, py) => `${r2(px)} ${r2(py)}`;

export function circlePath(cx, cy, r) {
  return `M${point(cx - r, cy)}A${r2(r)} ${r2(r)} 0 1 0 ${point(cx + r, cy)}A${r2(r)} ${r2(r)} 0 1 0 ${point(cx - r, cy)}Z`;
}

export function ellipsePath(cx, cy, rx, ry, rotationDegrees = 0) {
  const angle = rotationDegrees * Math.PI / 180;
  const dx = Math.cos(angle) * rx, dy = Math.sin(angle) * rx;
  const radii = `${r2(rx)} ${r2(ry)} ${r2(rotationDegrees)}`;
  return `M${point(cx - dx, cy - dy)}A${radii} 1 0 ${point(cx + dx, cy + dy)}A${radii} 1 0 ${point(cx - dx, cy - dy)}Z`;
}

/** A limb segment: two end circles joined by their outer tangents, so a capsule can taper. */
export function capsulePath([x1, y1], [x2, y2], radius1, radius2 = radius1) {
  const dx = x2 - x1, dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return circlePath(x1, y1, Math.max(radius1, radius2));
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
  const sine = Math.max(-0.98, Math.min(0.98, (radius1 - radius2) / length));
  const cosine = Math.sqrt(1 - sine * sine);
  const lx = nx * cosine + ux * sine, ly = ny * cosine + uy * sine;
  const rx = -nx * cosine + ux * sine, ry = -ny * cosine + uy * sine;
  // The cap around the narrower end spans less than half a turn; the wider end's cap spans more.
  const largeStart = sine > 0 ? 1 : 0, largeEnd = sine < 0 ? 1 : 0;
  return `M${point(x1 + lx * radius1, y1 + ly * radius1)}L${point(x2 + lx * radius2, y2 + ly * radius2)}` +
    `A${r2(radius2)} ${r2(radius2)} 0 ${largeEnd} 0 ${point(x2 + rx * radius2, y2 + ry * radius2)}` +
    `L${point(x1 + rx * radius1, y1 + ry * radius1)}A${r2(radius1)} ${r2(radius1)} 0 ${largeStart} 0 ${point(x1 + lx * radius1, y1 + ly * radius1)}Z`;
}

export function unionBounds(list) {
  const result = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const bounds of list) {
    if (!bounds) continue;
    result.minX = Math.min(result.minX, bounds.minX);
    result.minY = Math.min(result.minY, bounds.minY);
    result.maxX = Math.max(result.maxX, bounds.maxX);
    result.maxY = Math.max(result.maxY, bounds.maxY);
  }
  return result;
}
