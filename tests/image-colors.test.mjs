// The PNG reader and palette that bind a portrait to the game figure drawn after it. The pictures are synthetic and
// encoded here with every row filter, so no image tool or request is involved.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, imagePalette } from '../src/image-colors.mjs';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

/** A PNG of `width` by `height` whose bytes per pixel come from `bytes(x, y)`; row y uses filter `filter(y)`. */
function encode({ width, height, type, bytes, filter = y => y % 5, depth = 8, interlace = 0, palette = null, alphas = null, stream = data => data }) {
  const chunk = (kind, data) => {
    const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = depth; header[9] = type; header[12] = interlace;
  const bpp = CHANNELS[type], stride = width * bpp;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(bytes(x, y), y * stride + x * bpp);
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const kind = filter(y), line = raw.subarray(y * stride, (y + 1) * stride), above = y ? raw.subarray((y - 1) * stride, y * stride) : null;
    rows[y * (stride + 1)] = kind;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = above ? above[i] : 0, c = above && i >= bpp ? above[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predicted = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][kind];
      rows[y * (stride + 1) + 1 + i] = (line[i] - predicted) & 255;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), ...(palette ? [chunk('PLTE', Buffer.from(palette.flatMap(rgb)))] : []),
    ...(alphas ? [chunk('tRNS', Buffer.from(alphas))] : []), chunk('IDAT', stream(zlib.deflateSync(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// A figure on paper: a rust coat over most of the body, a navy scarf and a gold lantern. Nothing of the paper colour
// is in the figure, so the border sets it aside.
const PAPER = '#e9e4d8', COAT = '#b5452f', SCARF = '#2d4b6e', LANTERN = '#f2c14e';
const figure = (x, y) => (x >= 40 && x < 80 && y >= 20 && y < 50 ? SCARF : x >= 30 && x < 90 && y >= 20 && y < 140 ? (x >= 70 && x < 82 && y >= 100 && y < 112 ? LANTERN : COAT) : PAPER);

test('the reader decodes every row filter of an RGB picture exactly', () => {
  // Gradients make each filter predict differently from the raw bytes, so a wrong predictor shows at once.
  const value = (x, y) => [(x * 7 + y * 3) & 255, (x * 11 + 40) & 255, (y * 13 + x) & 255];
  for (const filter of [() => 0, () => 1, () => 2, () => 3, () => 4, y => y % 5, y => (y * 3 + 1) % 5]) {
    const image = decodePng(encode({ width: 37, height: 23, type: 2, bytes: value, filter }));
    assert.deepEqual([image.width, image.height], [37, 23]);
    for (const [x, y] of [[0, 0], [1, 0], [36, 0], [0, 1], [18, 11], [36, 22], [5, 17]]) assert.deepEqual(image.pixel(x, y), [...value(x, y), 255], `filter ${filter(1)} at ${x},${y}`);
  }
});

test('greyscale, grey with alpha, RGBA and palette pictures read as RGBA pixels', () => {
  const grey = decodePng(encode({ width: 4, height: 3, type: 0, bytes: x => [x * 60] }));
  assert.deepEqual(grey.pixel(3, 2), [180, 180, 180, 255]);
  const greyAlpha = decodePng(encode({ width: 4, height: 3, type: 4, bytes: x => [x * 60, 255 - x * 60] }));
  assert.deepEqual(greyAlpha.pixel(2, 1), [120, 120, 120, 135]);
  const rgba = decodePng(encode({ width: 5, height: 5, type: 6, bytes: (x, y) => [x * 50, y * 50, 99, x === y ? 0 : 255] }));
  assert.deepEqual([rgba.pixel(4, 1), rgba.pixel(2, 2)], [[200, 50, 99, 255], [100, 100, 99, 0]]);
  // A palette picture takes its alpha from tRNS; entries past the tRNS list are opaque.
  const indexed = decodePng(encode({ width: 3, height: 2, type: 3, bytes: x => [x], palette: [PAPER, COAT, SCARF], alphas: [0] }));
  assert.deepEqual([indexed.pixel(0, 0), indexed.pixel(1, 1), indexed.pixel(2, 0)], [[...rgb(PAPER), 0], [...rgb(COAT), 255], [...rgb(SCARF), 255]]);
});

test('the palette names the figure\'s main colours by share and sets the background aside', () => {
  const palette = imagePalette(encode({ width: 120, height: 160, type: 2, bytes: (x, y) => rgb(figure(x, y)) }));
  assert.deepEqual(palette.map(item => item.hex), [COAT, SCARF, LANTERN]);
  // Shares are of the figure, not of the whole picture: of its 7,200 pixels the scarf has 1,200, the lantern 144 and the coat the rest.
  const shares = Object.fromEntries(palette.map(item => [item.hex, item.share]));
  assert.ok(Math.abs(shares[COAT] - 0.813) < 0.02 && Math.abs(shares[SCARF] - 0.167) < 0.02 && Math.abs(shares[LANTERN] - 0.02) < 0.01, JSON.stringify(shares));
  assert.ok(!palette.some(item => item.hex === PAPER));
  // A transparent background is skipped by its alpha, with the same result.
  const cutout = imagePalette(encode({ width: 120, height: 160, type: 6, bytes: (x, y) => figure(x, y) === PAPER ? [0, 0, 0, 0] : [...rgb(figure(x, y)), 255] }));
  assert.deepEqual(cutout.map(item => item.hex), [COAT, SCARF, LANTERN]);
  assert.equal(imagePalette(encode({ width: 120, height: 160, type: 2, bytes: (x, y) => rgb(figure(x, y)) }), { count: 2 }).length, 2);
});

test('a picture of one colour keeps it, and colours that differ by noise gather into one', () => {
  assert.deepEqual(imagePalette(encode({ width: 30, height: 30, type: 2, bytes: () => rgb(COAT) })), [{ hex: COAT, share: 1 }]);
  // Two close shades of the coat on paper count as one coat colour.
  const shaded = imagePalette(encode({ width: 100, height: 100, type: 2, bytes: (x, y) => (x > 20 && x < 80 && y > 20 && y < 80 ? ((x + y) % 2 ? [181, 69, 47] : [184, 72, 50]) : rgb(PAPER)) }));
  assert.equal(shaded.length, 1);
  assert.ok(Math.abs(parseInt(shaded[0].hex.slice(1, 3), 16) - 182) <= 2 && shaded[0].share === 1, JSON.stringify(shaded));
});

test('formats the reader does not cover give no palette rather than a guess', () => {
  const ok = { width: 8, height: 8, type: 2, bytes: () => [1, 2, 3] };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(40).fill(0)]);
  for (const [label, bytes] of [['JPEG', jpeg], ['16-bit', encode({ ...ok, depth: 16 })], ['interlaced', encode({ ...ok, interlace: 1 })], ['empty', Buffer.alloc(0)], ['not a buffer', 'png']]) {
    assert.equal(decodePng(bytes), null, label);
    assert.equal(imagePalette(bytes), null, label);
  }
  // A palette picture without its palette, a truncated image stream and a fully transparent picture.
  assert.equal(decodePng(encode({ width: 3, height: 2, type: 3, bytes: () => [0] })), null);
  assert.equal(decodePng(encode({ ...ok, stream: data => data.subarray(0, Math.floor(data.length / 2)) })), null);
  assert.equal(decodePng(encode({ ...ok, stream: data => Buffer.from(data.map(byte => byte ^ 0x5a)) })), null);
  assert.equal(imagePalette(encode({ width: 6, height: 6, type: 6, bytes: () => [9, 9, 9, 0] })), null);
});
