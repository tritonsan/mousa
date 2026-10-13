// Painted cut-out parts from a generated parts sheet. The image model paints each body part apart from the others on
// a flat key colour; the host reads the key colour from the border, turns it transparent, separates the parts by
// connectivity and writes each one as its own RGBA PNG. The engine then draws those pictures on the bones that the
// vector parts used, so a painted character walks with the same rig, motion and clips.

import { decodePng, encodePng } from '../../plugin/server/production/image-files.mjs';

// The PNG writer is the plugin's own, beside its reader.
export { encodePng };

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

/**
 * The sheet with its key colour turned transparent. The key is the median colour of the border; a pixel within
 * `near` of it is background, beyond `far` it is the part, and between the two it is an edge whose colour is
 * separated from the key, so no magenta fringe stays on the part. A sheet whose border is already transparent keeps
 * its own alpha. Pixels next to the background lose any magenta cast left from the key (despill).
 */
export function keyOut(bytes, { near = 70, far = 150 } = {}) {
  const image = decodePng(bytes);
  if (!image) throw new Error('The parts sheet is not an 8-bit PNG this reader covers.');
  const { width, height } = image;
  const border = [];
  for (let x = 0; x < width; x += 2) border.push(image.pixel(x, 0), image.pixel(x, height - 1));
  for (let y = 0; y < height; y += 2) border.push(image.pixel(0, y), image.pixel(width - 1, y));
  const transparent = median(border.map(pixel => pixel[3])) < 16;
  const key = transparent ? null : [0, 1, 2].map(channel => median(border.map(pixel => pixel[channel])));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a] = image.pixel(x, y), at = (y * width + x) * 4;
    let alpha = a / 255, color = [r, g, b];
    if (key) {
      const distance = Math.hypot(r - key[0], g - key[1], b - key[2]);
      alpha *= Math.min(1, Math.max(0, (distance - near) / (far - near)));
      if (alpha > 0 && alpha < 1) {
        // The edge pixel is a mix of the part and the key; take the key out again.
        if (alpha < 0.25) alpha = 0;
        else color = color.map((value, channel) => (value - (1 - alpha) * key[channel]) / alpha);
      }
    }
    rgba[at] = Math.round(Math.min(255, Math.max(0, color[0])));
    rgba[at + 1] = Math.round(Math.min(255, Math.max(0, color[1])));
    rgba[at + 2] = Math.round(Math.min(255, Math.max(0, color[2])));
    rgba[at + 3] = Math.round(alpha * 255);
  }
  // A magenta key leaves red and blue raised above green in the pixels it bled into; within a few pixels of the
  // background that excess is taken out again, which leaves the part's own colours inside untouched.
  if (key && key[0] > 160 && key[2] > 160 && key[1] < 96) despill(width, height, rgba, 3);
  return { width, height, rgba, key: key ? `#${key.map(value => value.toString(16).padStart(2, '0')).join('')}` : 'transparent' };
}

function despill(width, height, rgba, reach) {
  // Distance in pixels to the nearest clear pixel, by two passes of a chamfer transform capped at `reach` + 1.
  const far = reach + 1, distance = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) distance[i] = rgba[i * 4 + 3] < 250 ? 0 : far;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x < width - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (y < height - 1) distance[i] = Math.min(distance[i], distance[i + width] + 1);
  }
  for (let i = 0; i < width * height; i++) {
    if (distance[i] > reach || !rgba[i * 4 + 3]) continue;
    const at = i * 4, spill = Math.min(rgba[at], rgba[at + 2]) - rgba[at + 1];
    if (spill > 0) { rgba[at] -= spill; rgba[at + 2] -= spill; }
  }
}

/**
 * The separate parts of a keyed sheet: 8-connected regions of opaque pixels, largest first, with their bounding
 * boxes. Specks smaller than `minShare` of the largest part are dropped.
 */
export function findParts({ width, height, rgba }, { minShare = 0.01 } = {}) {
  const label = new Int32Array(width * height).fill(-1);
  const parts = [];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || rgba[start * 4 + 3] < 128) continue;
    const id = parts.length;
    let head = 0, tail = 0, minX = width, minY = height, maxX = 0, maxY = 0, area = 0;
    queue[tail++] = start; label[start] = id;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = (index - x) / width;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (label[next] === -1 && rgba[next * 4 + 3] >= 128) { label[next] = id; queue[tail++] = next; }
      }
    }
    parts.push({ id, area, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } });
  }
  const largest = Math.max(0, ...parts.map(part => part.area));
  const kept = parts.filter(part => part.area >= largest * minShare);
  return { parts: kept.sort((a, b) => b.area - a.area), label };
}

/** One part as its own RGBA PNG: its box with `pad` transparent pixels around it, other parts left out. */
export function cropPart({ width, rgba }, { label }, part, { pad = 2 } = {}) {
  const w = part.box.width + pad * 2, h = part.box.height + pad * 2;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < part.box.height; y++) for (let x = 0; x < part.box.width; x++) {
    const sx = part.box.x + x, sy = part.box.y + y, from = (sy * width + sx) * 4, to = ((y + pad) * w + x + pad) * 4;
    // Soft edge pixels outside the part's own label still belong to it when no other part claims them.
    const owner = label[sy * width + sx];
    if (owner !== part.id && owner !== -1) continue;
    rgba.copy(out, to, from, from + 4);
  }
  return { width: w, height: h, png: encodePng(w, h, out) };
}
