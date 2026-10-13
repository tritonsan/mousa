// True pixel art from a painted sheet. A painter asked for pixel art paints chunky square pixels, but never exactly on
// a grid the game can use: its pixels blur at the edges and drift by a fraction. The host finds the grid the painter
// used from where colour changes line up (or, when the sheet shows none, sets one from the figure's height), reads one
// colour a cell, reduces the whole sheet to one small palette and writes every piece at one picture pixel a cell. The
// engine draws those pictures without smoothing, so the character keeps hard pixels as it moves.

import { encodePng } from './cutout.mjs';
import { decodePng } from '../../src/image-colors.mjs';

const OPAQUE = 128;
export const PIXEL_LIMITS = Object.freeze({ palette: 32, minCell: 3, maxCell: 40, strength: 1.8, figurePixels: 56 });

const change = (rgba, a, b) => Math.abs(rgba[a] - rgba[b]) + Math.abs(rgba[a + 1] - rgba[b + 1]) + Math.abs(rgba[a + 2] - rgba[b + 2]);

/** For each cell size, the phase whose lines carry the most colour change, and how far above the mean it lies. */
function lineStrengths(profile, min, max) {
  const mean = profile.reduce((sum, value) => sum + value, 0) / Math.max(1, profile.length) || 1;
  const sizes = new Map();
  for (let size = min; size <= max; size++) {
    let best = { phase: 0, strength: 0 };
    for (let phase = 0; phase < size; phase++) {
      let sum = 0, count = 0;
      for (let i = phase; i < profile.length; i += size) { sum += profile[i]; count++; }
      const strength = count ? sum / count / mean : 0;
      if (strength > best.strength) best = { phase, strength };
    }
    sizes.set(size, best);
  }
  return sizes;
}

/**
 * The painter's pixel grid on a keyed sheet: the cell size in sheet pixels and its phase across and down, found from
 * where colour changes between opaque neighbours line up. `strength` is how much more change falls on the grid's lines
 * than on an average column or row: about 1 without a grid, well above 2 for clean pixel art. A grid's multiples line
 * up as well as the grid, so the smallest size within reach of the strongest is the painter's own.
 */
export function detectGrid({ width, height, rgba }, { min = PIXEL_LIMITS.minCell, max = PIXEL_LIMITS.maxCell } = {}) {
  const columns = new Float64Array(width), rows = new Float64Array(height);
  for (let y = 1; y < height; y++) for (let x = 1; x < width; x++) {
    const at = (y * width + x) * 4;
    if (rgba[at + 3] < OPAQUE) continue;
    const left = at - 4, up = at - width * 4;
    if (rgba[left + 3] >= OPAQUE) columns[x] += change(rgba, at, left);
    if (rgba[up + 3] >= OPAQUE) rows[y] += change(rgba, at, up);
  }
  const across = lineStrengths(columns, min, max), down = lineStrengths(rows, min, max);
  const sizes = [...across.keys()].map(size => ({ size, strength: (across.get(size).strength + down.get(size).strength) / 2 }));
  const strongest = Math.max(...sizes.map(item => item.strength));
  // A multiple picks the luckier half of the grid's lines and may score a little higher; a divisor puts half its
  // lines between pixels and scores about half. So the painter's size is the smallest within 70% of the strongest.
  const size = sizes.find(item => item.strength >= strongest * 0.7).size;
  return { size, phaseX: across.get(size).phase, phaseY: down.get(size).phase, strength: Number(((across.get(size).strength + down.get(size).strength) / 2).toFixed(3)) };
}

/**
 * One picture on the grid: a cell is opaque when at least half of it is, and takes the most common colour of its middle
 * (`inner` of its width), where the painter's soft edges between pixels do not reach. `crop` places the picture on the sheet.
 */
export function snapPicture({ rgba, width, height, crop }, { size, phaseX, phaseY }, { inner = 0.6 } = {}) {
  const x0 = Math.floor((crop.x - phaseX) / size), y0 = Math.floor((crop.y - phaseY) / size);
  const x1 = Math.ceil((crop.x + width - phaseX) / size), y1 = Math.ceil((crop.y + height - phaseY) / size);
  const columns = x1 - x0, rows = y1 - y0, cells = new Array(columns * rows).fill(null);
  const margin = Math.floor((size * (1 - inner)) / 2);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const sx = phaseX + (x0 + i) * size - crop.x, sy = phaseY + (y0 + j) * size - crop.y;
    let opaque = 0;
    const buckets = new Map();
    for (let y = sy; y < sy + size; y++) for (let x = sx; x < sx + size; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const at = (y * width + x) * 4;
      if (rgba[at + 3] < OPAQUE) continue;
      opaque++;
      if (x < sx + margin || x >= sx + size - margin || y < sy + margin || y >= sy + size - margin) continue;
      const key = ((rgba[at] >> 3) << 10) | ((rgba[at + 1] >> 3) << 5) | (rgba[at + 2] >> 3);
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++; bucket.r += rgba[at]; bucket.g += rgba[at + 1]; bucket.b += rgba[at + 2];
      buckets.set(key, bucket);
    }
    if (opaque * 2 < size * size || !buckets.size) continue;
    const top = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    cells[j * columns + i] = [top.r / top.count, top.g / top.count, top.b / top.count].map(Math.round);
  }
  return { columns, rows, cells, origin: { x: phaseX + x0 * size, y: phaseY + y0 * size } };
}

/** The cell size that makes a figure `figureHeight` units tall about PIXEL_LIMITS.figurePixels picture pixels, in sheet pixels. */
export const gridSize = (figureHeight, pixelsPerUnit) => Math.max(PIXEL_LIMITS.minCell, Math.round((figureHeight / PIXEL_LIMITS.figurePixels) * pixelsPerUnit));

/**
 * A blueprint redrawn on a grid of `size` from the sheet's corner: each cell takes the colour at its centre, so the flat
 * shapes the painter repaints already stand in hard pixels on the grid the cut will read.
 */
export function gridBlueprint(png, size) {
  const image = decodePng(png), { width, height } = image, rgba = Buffer.alloc(width * height * 4);
  for (let y0 = 0; y0 < height; y0 += size) for (let x0 = 0; x0 < width; x0 += size) {
    const color = image.pixel(Math.min(width - 1, x0 + (size >> 1)), Math.min(height - 1, y0 + (size >> 1)));
    for (let y = y0; y < Math.min(height, y0 + size); y++) for (let x = x0; x < Math.min(width, x0 + size); x++) rgba.set(color, (y * width + x) * 4);
  }
  return encodePng(width, height, rgba);
}

/** At most `count` colours for the weighted colours given, by median cut: the widest channel of the fullest box splits first. */
export function medianCut(colors, count = PIXEL_LIMITS.palette) {
  const boxes = [colors.slice()];
  const range = box => [0, 1, 2].map(channel => { let low = 255, high = 0; for (const color of box) { low = Math.min(low, color[channel]); high = Math.max(high, color[channel]); } return high - low; });
  while (boxes.length < count) {
    let index = -1, widest = 0, channel = 0;
    boxes.forEach((box, at) => {
      if (box.length < 2) return;
      const spans = range(box), span = Math.max(...spans);
      if (span * box.length > widest) { widest = span * box.length; index = at; channel = spans.indexOf(span); }
    });
    if (index < 0 || widest === 0) break;
    const box = boxes[index].sort((a, b) => a[channel] - b[channel]);
    boxes.splice(index, 1, box.slice(0, box.length >> 1), box.slice(box.length >> 1));
  }
  return boxes.filter(box => box.length).map(box => [0, 1, 2].map(channel => Math.round(box.reduce((sum, color) => sum + color[channel], 0) / box.length)));
}

const nearest = (palette, color) => {
  let best = palette[0], distance = Infinity;
  for (const entry of palette) {
    const d = (entry[0] - color[0]) ** 2 + (entry[1] - color[1]) ** 2 + (entry[2] - color[2]) ** 2;
    if (d < distance) { distance = d; best = entry; }
  }
  return best;
};

/**
 * Redraw a cut on one pixel grid: the painter's grid when the sheet shows one clearly, else a grid that makes the figure
 * about PIXEL_LIMITS.figurePixels picture pixels tall. Every piece and the figure keep their place: a piece's rect grows
 * to the cells it covers. Returns the grid, the palette and the cut with pixel pictures in place of the painted ones.
 */
export function pixelateCut(cut, { sheet, figureHeight }) {
  const detected = detectGrid(sheet);
  const fallback = gridSize(figureHeight, 1 / cut.unitsPerPixel);
  const grid = detected.strength >= PIXEL_LIMITS.strength ? detected : { size: fallback, phaseX: 0, phaseY: 0, strength: detected.strength };
  const pictures = [...cut.pieces.filter(piece => !piece.missing), ...(cut.figure ? [cut.figure] : [])];
  const snapped = new Map(pictures.map(picture => [picture, snapPicture(picture, grid)]));
  const colors = [...snapped.values()].flatMap(item => item.cells.filter(Boolean));
  const palette = colors.length ? medianCut(colors) : [];
  const encode = ({ columns, rows, cells }) => {
    const rgba = Buffer.alloc(columns * rows * 4);
    cells.forEach((cell, index) => { if (cell) rgba.set([...nearest(palette, cell), 255], index * 4); });
    return encodePng(columns, rows, rgba);
  };
  const pieces = cut.pieces.map(piece => {
    if (piece.missing) return piece;
    const item = snapped.get(piece), unit = cut.unitsPerPixel;
    const rect = [piece.rect[0] + (item.origin.x - piece.crop.x) * unit, piece.rect[1] + (item.origin.y - piece.crop.y) * unit, item.columns * grid.size * unit, item.rows * grid.size * unit]
      .map(value => Number(value.toFixed(2)));
    return { ...piece, png: encode(item), width: item.columns, height: item.rows, rect };
  });
  const figure = cut.figure ? (() => { const item = snapped.get(cut.figure); return { ...cut.figure, png: encode(item), width: item.columns, height: item.rows }; })() : null;
  return { grid, palette, cut: { ...cut, pieces, figure } };
}
