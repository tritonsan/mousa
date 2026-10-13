// Colours in the notations real design systems write them, as #rrggbb, and a sameness test that tolerates the rounding
// of a conversion. A Design DNA names its colours in hex, while a project may hold them as rgb() or hsl(), as the bare
// HSL triplets shadcn/ui keeps in its custom properties (222.2 47.4% 11.2%), or as the oklch() values of a Tailwind 4
// theme. Converted back to hex they land within a unit or two of the original, which no one can see.

import { colorsIn } from '../culture/taste.mjs';
import { colorDistance } from '../production/image-files.mjs';

// CIE76: about 2 is a barely visible difference; a conversion's rounding stays well below it.
export const SAME_COLOR_DELTA_E = 2.5;
export const sameColor = (a, b) => colorDistance(a, b) <= SAME_COLOR_DELTA_E;

const hex = channels => `#${channels.map(value => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')).join('')}`;
const number = (value, percentScale = 1) => (String(value).endsWith('%') ? Number.parseFloat(value) / 100 * percentScale : Number.parseFloat(value));

export function hslToHex(hue, saturation, lightness) {
  const h = (((hue % 360) + 360) % 360) / 360, s = Math.min(1, Math.max(0, saturation / 100)), l = Math.min(1, Math.max(0, lightness / 100));
  if (!s) return hex([l, l, l]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const part = t => { const x = ((t % 1) + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return hex([part(h + 1 / 3), part(h), part(h - 1 / 3)]);
}

/** OKLab to sRGB, after Björn Ottosson's reference conversion. */
export function oklabToHex(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gamma = value => (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055);
  return hex([gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]);
}

const NUMBER = '(-?[\\d.]+%?)';
const OKLCH = new RegExp(`oklch\\(\\s*${NUMBER}\\s+${NUMBER}\\s+(-?[\\d.]+)(?:deg)?(?:\\s*\\/\\s*[\\d.]+%?)?\\s*\\)`, 'giu');
const OKLAB = new RegExp(`oklab\\(\\s*${NUMBER}\\s+${NUMBER}\\s+${NUMBER}(?:\\s*\\/\\s*[\\d.]+%?)?\\s*\\)`, 'giu');
// A custom property that holds only the three HSL numbers, as shadcn/ui writes them: hsl(var(--primary)) uses it.
const BARE_HSL = /^\s*(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*[\d.]+%?\s*)?$/u;

/** Every colour a CSS value holds, as #rrggbb, in any of the notations above. */
export function colorValues(value) {
  const text = String(value ?? '');
  const found = [...colorsIn(text)];
  for (const match of text.matchAll(OKLCH)) {
    const L = number(match[1]), C = number(match[2], 0.4), H = Number.parseFloat(match[3]) * Math.PI / 180;
    found.push(oklabToHex(L, C * Math.cos(H), C * Math.sin(H)));
  }
  for (const match of text.matchAll(OKLAB)) found.push(oklabToHex(number(match[1]), number(match[2], 0.4), number(match[3], 0.4)));
  const bare = BARE_HSL.exec(text);
  if (bare) found.push(hslToHex(Number(bare[1]), Number(bare[2]), Number(bare[3])));
  return [...new Set(found)];
}

/** Whether a value holds a colour the same as `wanted`, and in which notation. */
export function holdsColor(value, wanted) {
  return colorValues(value).some(color => sameColor(color, wanted));
}
