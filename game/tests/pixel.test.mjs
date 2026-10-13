// Pixel art from a painted sheet: the painter's grid is found, each cell read once, the sheet reduced to one palette and
// each piece written at one picture pixel a cell, in its place. No Codex request is made.

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePng, keyOut } from '../harness/cutout.mjs';
import { detectGrid, snapPicture, medianCut, pixelateCut } from '../harness/pixel.mjs';
import { decodePng } from '../../src/image-colors.mjs';

const PALETTE = [[40, 52, 90], [226, 180, 60], [63, 142, 137], [122, 46, 44], [239, 198, 162]];

/** A painted-looking pixel sheet: cells of `size` from (phaseX, phaseY), each a palette colour with a little brush noise and soft seams. */
function pixelSheet({ width = 200, height = 160, size = 10, phaseX = 3, phaseY = 7, box = { x: 40, y: 30, w: 100, h: 90 } } = {}) {
  const rgba = Buffer.alloc(width * height * 4);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const colors = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
    if (!inside) { rgba.set([255, 0, 255, 255], at); continue; }
    const cell = `${Math.floor((x - phaseX) / size)},${Math.floor((y - phaseY) / size)}`;
    if (!colors.has(cell)) colors.set(cell, PALETTE[Math.floor(random() * PALETTE.length)]);
    const base = colors.get(cell);
    // The painter's pixels blur a little where two meet and carry a few levels of noise.
    const seam = (x - phaseX) % size === 0 || (y - phaseY) % size === 0;
    const noise = Math.round((random() - 0.5) * 8);
    rgba.set(base.map(value => Math.max(0, Math.min(255, (seam ? value * 0.85 + 20 : value) + noise))).concat(255), at);
  }
  return { width, height, rgba, colors, size, phaseX, phaseY, box };
}

test('the painter\'s grid is found from where colour changes line up, and a flat sheet shows none', () => {
  const sheet = pixelSheet();
  const keyed = keyOut(encodePng(sheet.width, sheet.height, sheet.rgba));
  const grid = detectGrid(keyed);
  assert.deepEqual([grid.size, grid.phaseX, grid.phaseY], [10, 3, 7], JSON.stringify(grid));
  assert.ok(grid.strength > 2.5, String(grid.strength));
  const flat = { width: 60, height: 60, rgba: Buffer.alloc(60 * 60 * 4) };
  for (let i = 0; i < 3600; i++) flat.rgba.set([90, 90, 90, 255], i * 4);
  assert.ok(detectGrid(flat).strength < 1.8);
});

test('each cell takes its own colour, the palette stays small and a piece keeps its place on the grid', () => {
  const sheet = pixelSheet();
  const keyed = keyOut(encodePng(sheet.width, sheet.height, sheet.rgba));
  // A crop of the piece as the cut makes it: its box with one clear pixel around.
  const crop = { x: sheet.box.x - 1, y: sheet.box.y - 1 }, width = sheet.box.w + 2, height = sheet.box.h + 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) keyed.rgba.copy(rgba, y * width * 4, ((crop.y + y) * keyed.width + crop.x) * 4, ((crop.y + y) * keyed.width + crop.x + width) * 4);
  const grid = { size: 10, phaseX: 3, phaseY: 7 };
  const snapped = snapPicture({ rgba, width, height, crop }, grid);
  assert.equal(snapped.origin.x % 10, 3);
  assert.equal(snapped.origin.y % 10, 7);
  // Every opaque cell of the source comes back as its own palette colour, within the brush noise.
  let checked = 0;
  for (let j = 0; j < snapped.rows; j++) for (let i = 0; i < snapped.columns; i++) {
    const cell = snapped.cells[j * snapped.columns + i];
    const x = snapped.origin.x + i * 10, y = snapped.origin.y + j * 10;
    const key = `${Math.floor((x + 5 - 3) / 10)},${Math.floor((y + 5 - 7) / 10)}`;
    // Cells wholly inside the painted box; a cell less than half covered is clear.
    const inside = x >= sheet.box.x && x + 10 <= sheet.box.x + sheet.box.w && y >= sheet.box.y && y + 10 <= sheet.box.y + sheet.box.h;
    if (!inside) { if (x + 10 <= sheet.box.x || y + 10 <= sheet.box.y) assert.equal(cell, null); continue; }
    assert.ok(cell, `cell ${i},${j}`);
    const expected = sheet.colors.get(key);
    assert.ok(cell.every((value, channel) => Math.abs(value - expected[channel]) <= 6), `${cell} ${expected}`);
    checked++;
  }
  assert.ok(checked > 60);
  const palette = medianCut(snapped.cells.filter(Boolean), 8);
  assert.ok(palette.length <= 8 && palette.length >= PALETTE.length - 1);
});

test('a pixelated cut writes each piece at one picture pixel a cell and grows its rect to the cells it covers', () => {
  const sheet = pixelSheet();
  const keyed = keyOut(encodePng(sheet.width, sheet.height, sheet.rgba));
  const crop = { x: sheet.box.x - 1, y: sheet.box.y - 1 }, width = sheet.box.w + 2, height = sheet.box.h + 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) keyed.rgba.copy(rgba, y * width * 4, ((crop.y + y) * keyed.width + crop.x) * 4, ((crop.y + y) * keyed.width + crop.x + width) * 4);
  const unitsPerPixel = 0.2;
  const piece = { id: 'layer-1', kind: 'layer', rect: [-10, -100, width * unitsPerPixel, height * unitsPerPixel], crop, rgba, width, height };
  const { grid, palette, cut } = pixelateCut({ unitsPerPixel, pieces: [piece], figure: null }, { sheet: keyed, figureHeight: 120 });
  assert.deepEqual([grid.size, grid.phaseX, grid.phaseY], [10, 3, 7]);
  assert.ok(palette.length <= 32);
  const [out] = cut.pieces;
  const image = decodePng(out.png);
  assert.deepEqual([image.width, image.height], [out.width, out.height]);
  assert.ok(out.width <= Math.ceil(width / 10) + 1 && out.height <= Math.ceil(height / 10) + 1);
  // The rect starts at the first cell, at most a cell before the crop, and spans whole cells.
  assert.ok(out.rect[0] <= piece.rect[0] && piece.rect[0] - out.rect[0] < 10 * unitsPerPixel);
  assert.ok(Math.abs(out.rect[2] - out.width * 10 * unitsPerPixel) < 0.02);
});
