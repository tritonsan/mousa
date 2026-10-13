// Pictures the production tools read and write: a small PNG reader (8-bit greyscale, RGB, palette and RGBA,
// non-interlaced, as image tools and browsers write them) and RGBA writer, JPEG and PNG sizes, and the main colours of
// a generated picture, so a portrait
// can bind the game figure drawn after it. The palette samples the picture on a grid, sets the background aside by
// reading it from the border, and gathers the rest into a few colours in CIE Lab.

import zlib from 'node:zlib';

/** Pixel size from a baseline or progressive JPEG frame header, or null when the bytes are not a JPEG. */
export function jpegSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

/** Pixel size from a PNG header, or null when the bytes are not a PNG. */
export const pngSize = bytes => Buffer.isBuffer(bytes) && bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;

/** An 8-bit RGBA PNG of `width` by `height` from `rgba` (a Buffer of width * height * 4 bytes). */
export function encodePng(width, height, rgba) {
  const chunk = (kind, data) => {
    const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const stride = width * 4, rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decoded pixels of a PNG, or null for a format this reader does not cover. */
export function decodePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  let offset = 8, width = 0, height = 0, depth = 0, type = -1, interlace = 0, palette = null, alphas = null;
  const data = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('latin1', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; type = chunk[9]; interlace = chunk[12]; }
    else if (kind === 'PLTE') palette = chunk;
    else if (kind === 'tRNS') alphas = chunk;
    else if (kind === 'IDAT') data.push(chunk);
    else if (kind === 'IEND') break;
    offset += 12 + length;
  }
  const channels = CHANNELS[type];
  if (depth !== 8 || interlace !== 0 || !channels || !width || !height || width * height > 40e6 || (type === 3 && !palette)) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(data)); } catch { return null; }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride), above = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0, b = above ? above[x] : 0, c = above && x >= channels ? above[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[x] = value & 255;
    }
  }
  const pixel = (x, y) => {
    const at = y * stride + x * channels;
    if (type === 2) return [pixels[at], pixels[at + 1], pixels[at + 2], 255];
    if (type === 6) return [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]];
    if (type === 0) return [pixels[at], pixels[at], pixels[at], 255];
    if (type === 4) return [pixels[at], pixels[at], pixels[at], pixels[at + 1]];
    const index = pixels[at];
    return [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], alphas && index < alphas.length ? alphas[index] : 255];
  };
  return { width, height, pixel };
}

const linear = value => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function toLab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(linear);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const hex = rgb => `#${rgb.map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Up to `count` main colours of a picture's subject, each with its share of the subject. The background is what fills
 * most of the border: border colours that together cover 60% of it are set aside, with every colour close to them.
 */
export function imagePalette(bytes, { count = 6, samples = 180 } = {}) {
  const image = decodePng(bytes);
  if (!image) return null;
  const step = Math.max(1, Math.floor(Math.max(image.width, image.height) / samples));
  const points = [];
  const band = Math.max(1, Math.round(Math.min(image.width, image.height) * 0.04));
  for (let y = 0; y < image.height; y += step) for (let x = 0; x < image.width; x += step) {
    const [r, g, b, a] = image.pixel(x, y);
    if (a < 128) continue;
    points.push({ rgb: [r, g, b], lab: toLab([r, g, b]), border: x < band || y < band || x >= image.width - band || y >= image.height - band });
  }
  if (!points.length) return null;
  const bin = point => `${point.rgb[0] >> 4},${point.rgb[1] >> 4},${point.rgb[2] >> 4}`;
  const borderBins = new Map();
  const border = points.filter(point => point.border);
  for (const point of border) {
    const key = bin(point);
    if (!borderBins.has(key)) borderBins.set(key, []);
    borderBins.get(key).push(point);
  }
  const background = [];
  let covered = 0;
  for (const group of [...borderBins.values()].sort((a, b) => b.length - a.length)) {
    if (covered >= 0.6 * border.length || background.length >= 3) break;
    background.push(group.reduce((sum, point) => sum.map((value, index) => value + point.lab[index] / group.length), [0, 0, 0]));
    covered += group.length;
  }
  let subject = points.filter(point => !point.border && background.every(lab => distance(lab, point.lab) > 14));
  if (subject.length < points.length * 0.05) subject = points;
  // Gather the subject's colours: fine Lab bins first, then bins within CIE76 12 of a larger one join it.
  const bins = new Map();
  for (const point of subject) {
    const key = `${Math.round(point.lab[0] / 6)},${Math.round(point.lab[1] / 8)},${Math.round(point.lab[2] / 8)}`;
    const item = bins.get(key) || { count: 0, lab: [0, 0, 0], rgb: [0, 0, 0] };
    item.count++; point.lab.forEach((value, index) => { item.lab[index] += value; }); point.rgb.forEach((value, index) => { item.rgb[index] += value; });
    bins.set(key, item);
  }
  const clusters = [];
  for (const item of [...bins.values()].sort((a, b) => b.count - a.count)) {
    const centre = item.lab.map(value => value / item.count);
    const near = clusters.find(cluster => distance(cluster.lab, centre) <= 12);
    if (near) {
      const total = near.count + item.count;
      near.lab = near.lab.map((value, index) => (value * near.count + centre[index] * item.count) / total);
      near.rgb = near.rgb.map((value, index) => value + item.rgb[index]);
      near.count = total;
    } else clusters.push({ lab: centre, rgb: [...item.rgb], count: item.count });
  }
  return clusters.sort((a, b) => b.count - a.count).filter(cluster => cluster.count >= subject.length * 0.02).slice(0, count)
    .map(cluster => ({ hex: hex(cluster.rgb.map(value => value / cluster.count)), share: Number((cluster.count / subject.length).toFixed(3)) }));
}
