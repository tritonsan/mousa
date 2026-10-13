// Shared numeric helpers: easing, 2D affine matrices, seeded randomness and colour. No DOM access, so the
// motion system can run in Node for measurement as well as in the browser.

export const TAU = Math.PI * 2;
export const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = degrees => degrees * Math.PI / 180;
export const toDeg = radians => radians * 180 / Math.PI;
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential approach: the same rate gives the same motion at 60 or 120 Hz.
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));
export const wrap01 = value => value - Math.floor(value);

/** Mulberry32: small, fast and seedable, so both characters in a comparison share one identical world. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [0, 1]. */
export function valueNoise(seed) {
  const random = seededRandom(seed);
  const table = Float32Array.from({ length: 256 }, () => random());
  return x => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i & 255];
    const b = table[(i + 1) & 255];
    return a + (b - a) * f * f * (3 - 2 * f);
  };
}

/** CSS-style cubic-bezier timing function: Newton steps with a bisection fallback. */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = t => ((ax * t + bx) * t + cx) * t;
  const sampleY = t => ((ay * t + by) * t + cy) * t;
  const slopeX = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const error = sampleX(t) - x;
      const slope = slopeX(t);
      if (Math.abs(error) < 1e-5) return sampleY(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0, high = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-5) break;
      if (value < x) low = t; else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}

const BACK = 1.70158;
export const EASINGS = Object.freeze({
  linear: t => t,
  in: t => t * t * t,
  out: t => 1 - (1 - t) ** 3,
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: t => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2,
  inBack: t => (BACK + 1) * t * t * t - BACK * t * t,
  inOutBack: t => {
    const c = BACK * 1.525;
    return t < 0.5 ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2 : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
  },
  outElastic: t => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  outBounce: t => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
  step: t => (t < 1 ? 0 : 1),
});
const bezierCache = new Map();
export function easingFunction(spec) {
  if (Array.isArray(spec)) {
    const key = spec.join(',');
    if (!bezierCache.has(key)) bezierCache.set(key, cubicBezier(...spec));
    return bezierCache.get(key);
  }
  return EASINGS[spec] || EASINGS.inOut;
}

// Affine matrices in canvas order [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const translation = (x, y) => [1, 0, 0, 1, x, y];
export const scaling = (sx, sy) => [sx, 0, 0, sy, 0, 0];
export function rotation(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, -s, c, 0, 0];
}
/** Rotation by angle around (px, py): translate(p) · rotate · translate(-p). */
export function rotationAbout(px, py, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, -s, c, px - c * px + s * py, py - s * px - c * py];
}
export const transformPoint = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const transformVector = (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
export const determinant = m => m[0] * m[3] - m[1] * m[2];
export const matrixAngle = m => Math.atan2(m[1], m[0]);

// Colour helpers work on #rrggbb strings.
export function parseHex(hex) {
  let digits = hex.slice(1);
  if (digits.length === 3) digits = digits.split('').map(character => character + character).join('');
  const value = Number.parseInt(digits, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
export function toHex([r, g, b]) {
  return `#${[r, g, b].map(channel => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}
export function mixHex(a, b, t) {
  const x = parseHex(a), y = parseHex(b);
  return toHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}
export function rgba(hex, alpha = 1) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1).toFixed(3)})`;
}
/** Relative luminance in [0, 1] (sRGB, WCAG formula). */
export function luminance(hex) {
  const channel = value => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
