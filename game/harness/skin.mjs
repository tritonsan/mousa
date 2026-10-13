// Painted skins. The host lays a character's vector parts out as a blueprint sheet: the parts that share a bone and a
// place in the drawing order become one flat-colour piece, each long cloth chain a straight strip and each tip (a
// lantern on a rope) a piece of its own. A painter repaints that sheet in the planned technique, keeping every piece
// where it is; the host then cuts the painted pieces out again and maps each one back onto the bind-pose box its
// blueprint came from, so the painted character walks with the same rig, motion, clips and cloth physics.

import fs from 'node:fs/promises';
import path from 'node:path';
import { flattenPath, exactBounds, rasterize } from './raster.mjs';
import { encodePng, keyOut, findParts } from './cutout.mjs';
import { pixelateCut, gridBlueprint, gridSize } from './pixel.mjs';

export const SHEET = Object.freeze({ width: 1536, height: 1024, margin: 48, gap: 64, key: [255, 0, 255], supersample: 3 });
// A cloth chain gets a painted strip when it is long and wide enough to carry texture; thinner chains, such as a
// lantern's cord, stay vectors.
const STRIP = Object.freeze({ length: 10, width: 3 });

const area = box => Math.max(1e-6, (box.maxX - box.minX) * (box.maxY - box.minY));
const union = (a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });
const grow = (box, by) => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by });
function overlapShare(a, b) {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? (w * h) / Math.min(area(a), area(b)) : 0;
}

const partBox = part => grow(exactBounds(part.d), part.stroke ? part.strokeWidth / 2 : 0);
// A chain hangs from its anchor and streams back in the wind, so it may cover anything within its length behind and below.
function chainBox(chain) {
  const [x, y] = chain.anchor, w = Math.max(...chain.width);
  return { minX: x - chain.length, minY: y - w, maxX: x + w, maxY: y + chain.length };
}
export const paintedChain = chain => chain.length >= STRIP.length && Math.max(...chain.width) >= STRIP.width;

/**
 * The character's parts gathered into layers, back to front as the painter draws the near side: a part joins the
 * last layer on its bone and side when nothing drawn between them covers it (overlaps under `tolerance` of the smaller
 * box are ignored), so one piece can be painted where the drawing order allows and split where it does not, such as
 * a funnel collar drawn over the neck.
 */
export function paintLayers(character, { tolerance = 0.12 } = {}) {
  const items = [
    ...character.parts.map((part, index) => ({ kind: 'part', part, key: `${part.bone}|${part.side}`, z: part.z, order: index, box: partBox(part) })),
    ...character.cloth.map((chain, index) => ({ kind: 'cloth', chain, z: chain.z, order: 1000 + index, box: chainBox(chain) })),
  ].sort((a, b) => a.z - b.z || a.order - b.order);
  const layers = [];
  items.forEach((item, position) => {
    if (item.kind !== 'part') return;
    const layer = layers.findLast(candidate => candidate.key === item.key);
    if (layer) {
      const between = items.slice(layer.last + 1, position).filter(other => !(other.kind === 'part' && layer.parts.includes(other.part)));
      // A line without a fill (a rim, a seam, a brow) is a detail of the piece beneath it, wherever it sits in the order.
      if (!item.part.fill || between.every(other => overlapShare(other.box, item.box) <= tolerance)) {
        layer.parts.push(item.part);
        layer.last = position;
        layer.box = union(layer.box, item.box);
        return;
      }
    }
    layers.push({ key: item.key, bone: item.part.bone, side: item.part.side, z: item.z, parts: [item.part], last: position, box: item.box });
  });
  return layers.map(({ key, last, ...layer }) => layer);
}

/** Everything a skin paints: the layers, the strips of long cloth chains and the tips, each with its own bounds. */
export function skinPieces(character) {
  const pieces = paintLayers(character).map((layer, index) => ({ kind: 'layer', id: `layer-${index + 1}`, bone: layer.bone, side: layer.side, z: layer.z,
    parts: layer.parts, bounds: grow(layer.box, 1) }));
  for (const chain of character.cloth) {
    const w = Math.max(...chain.width);
    // A strip is drawn hanging straight down from its root at y = 0, as the chain rests without wind.
    if (paintedChain(chain)) pieces.push({ kind: 'strip', id: `strip-${chain.id}`, chain: chain.id, bounds: { minX: -w / 2 - 1, minY: -1, maxX: w / 2 + 1, maxY: chain.length + 1 } });
    if (chain.tip) pieces.push({ kind: 'tip', id: `tip-${chain.id}`, chain: chain.id, bounds: grow(chain.tip.map(shape => grow(exactBounds(shape.d), shape.stroke ? shape.strokeWidth / 2 : 0)).reduce(union), 1) });
  }
  return pieces;
}

/** The flat shapes of one piece in its own coordinates, as raster.mjs fills them. */
function pieceShapes(character, piece) {
  const shape = ({ d, fill, stroke, strokeWidth, opacity }) => ({ lines: flattenPath(d), fill, stroke, strokeWidth, opacity });
  if (piece.kind === 'layer') return piece.parts.map(shape);
  const chain = character.cloth.find(item => item.id === piece.chain);
  if (piece.kind === 'tip') return chain.tip.map(shape);
  // The strip tapers from the root width to the end width; stripes run across it, one band a segment.
  const steps = chain.segments * 4, halfAt = t => (chain.width[0] + (chain.width[1] - chain.width[0]) * t) / 2;
  const band = (from, to, fill) => {
    const left = [], right = [];
    for (let i = 0; i <= 4; i++) {
      const t = from + ((to - from) * i) / 4;
      left.push([-halfAt(t), t * chain.length]);
      right.push([halfAt(t), t * chain.length]);
    }
    const lines = [[...left, ...right.reverse()]];
    lines[0].closed = true;
    return { lines, fill, stroke: null, strokeWidth: 0, opacity: 1 };
  };
  if (!chain.stripes) return [band(0, 1, chain.fill)];
  return Array.from({ length: chain.segments }, (_, i) => band(i / chain.segments, (i + 1) / chain.segments, chain.stripes[i % chain.stripes.length]));
}

/**
 * The whole character standing in its bind pose, near side only: parts in drawing order, each chain hanging straight
 * down from its anchor and each tip at the chain's end. The painter sees it as the reference for how the pieces fit.
 */
function figureShapes(character) {
  const items = [
    ...character.parts.map((part, index) => ({ z: part.z, order: index, shapes: () => [{ lines: flattenPath(part.d), fill: part.fill, stroke: part.stroke, strokeWidth: part.strokeWidth, opacity: part.opacity }] })),
    ...character.cloth.map((chain, index) => ({ z: chain.z, order: 1000 + index, shapes: () => {
      const moved = shape => shape.lines.map(line => Object.assign(line.map(([x, y]) => [x + chain.anchor[0], y + chain.anchor[1]]), { closed: line.closed }));
      const ribbon = pieceShapes(character, { kind: 'strip', chain: chain.id }).map(shape => ({ ...shape, lines: moved(shape) }));
      const tip = (chain.tip || []).map(shape => ({ lines: flattenPath(shape.d).map(line => Object.assign(line.map(([x, y]) => [x + chain.anchor[0], y + chain.anchor[1] + chain.length]), { closed: line.closed })),
        fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: shape.opacity }));
      return [...ribbon, ...tip];
    } })),
  ].sort((a, b) => a.z - b.z || a.order - b.order);
  return items.flatMap(item => item.shapes());
}

function shapesBounds(shapes) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const shape of shapes) for (const line of shape.lines) for (const [x, y] of line) {
    box.minX = Math.min(box.minX, x); box.minY = Math.min(box.minY, y); box.maxX = Math.max(box.maxX, x); box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

/** Shelf packing at `scale` pixels a unit from x = `left`, tallest pieces first; null when the pieces do not fit the sheet. */
function pack(pieces, scale, { width, height, margin, gap }, left = margin) {
  const sized = pieces.map(piece => ({ piece, w: Math.ceil((piece.bounds.maxX - piece.bounds.minX) * scale), h: Math.ceil((piece.bounds.maxY - piece.bounds.minY) * scale) }))
    .sort((a, b) => b.h - a.h || b.w - a.w);
  const placed = [];
  let x = left, y = margin, rowHeight = 0, row = 0;
  for (const item of sized) {
    if (x > left && x + item.w > width - margin) { x = left; y += rowHeight + gap; rowHeight = 0; row++; }
    if (item.w > width - margin - left || y + item.h > height - margin) return null;
    placed.push({ ...item, x, y, row });
    x += item.w + gap;
    rowHeight = Math.max(rowHeight, item.h);
  }
  return placed;
}

const hexRgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));

/** Fill shapes into the sheet at (x, y) with soft edges; returns the drawn shape's own box on the sheet. */
function drawShapes(rgba, sheet, shapes, bounds, scale, x, y, w, h) {
  const ss = sheet.supersample;
  const grid = rasterize(shapes, { cell: 1 / (scale * ss), bounds, margin: 0 });
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let r = 0, g = 0, b = 0, covered = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const col = px * ss + sx, line = py * ss + sy;
      if (col >= grid.cols || line >= grid.rows) continue;
      const color = grid.color[line * grid.cols + col];
      if (!color) continue;
      const [cr, cg, cb] = hexRgb(color);
      r += cr; g += cg; b += cb; covered++;
    }
    if (!covered) continue;
    const share = covered / (ss * ss), at = ((y + py) * sheet.width + x + px) * 4;
    rgba[at] = Math.round(r / covered * share + sheet.key[0] * (1 - share));
    rgba[at + 1] = Math.round(g / covered * share + sheet.key[1] * (1 - share));
    rgba[at + 2] = Math.round(b / covered * share + sheet.key[2] * (1 - share));
    if (share >= 0.5) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
  }
  return maxX < 0 ? { x, y, w, h } : { x: x + minX, y: y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * The blueprint sheet: every piece at one scale (the largest that packs), flat colours on the key colour with soft
 * edges, and the layout that maps each piece's pixels back to its own coordinates. With `figure`, the whole character
 * stands at the same scale in a column on the left, as the painter's reference for how the pieces fit; it is never cut.
 */
export function blueprintSheet(character, { sheet = SHEET, pieces = skinPieces(character), figure = false } = {}) {
  const standing = figure ? figureShapes(character) : null;
  const figureBounds = standing ? grow(shapesBounds(standing), 1) : null;
  const attempt = scale => {
    if (!figureBounds) return pack(pieces, scale, sheet);
    const fw = Math.ceil((figureBounds.maxX - figureBounds.minX) * scale), fh = Math.ceil((figureBounds.maxY - figureBounds.minY) * scale);
    if (fh > sheet.height - sheet.margin * 2) return null;
    return pack(pieces, scale, sheet, sheet.margin + fw + sheet.gap);
  };
  let low = 0.5, high = 40, placed = null;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2, result = attempt(mid);
    if (result) { low = mid; placed = result; } else high = mid;
  }
  if (!placed) throw new Error('The pieces do not fit a blueprint sheet.');
  const scale = low;
  const rgba = Buffer.alloc(sheet.width * sheet.height * 4);
  for (let i = 0; i < sheet.width * sheet.height; i++) rgba.set([...sheet.key, 255], i * 4);
  let reference = null;
  if (standing) {
    const w = Math.ceil((figureBounds.maxX - figureBounds.minX) * scale), h = Math.ceil((figureBounds.maxY - figureBounds.minY) * scale);
    // The figure stands on the sheet's lower margin, as the tallest pieces hang from the upper one.
    const x = sheet.margin, y = sheet.height - sheet.margin - h;
    reference = { x, y, w, h, bounds: figureBounds, content: drawShapes(rgba, sheet, standing, figureBounds, scale, x, y, w, h) };
  }
  const layout = placed.map(({ piece, x, y, w, h, row }) => ({
    id: piece.id, kind: piece.kind, ...(piece.bone ? { bone: piece.bone, side: piece.side, z: piece.z } : { chain: piece.chain }), row, bounds: piece.bounds, x, y, w, h,
    // `content` is the drawn shape's own box on the sheet, which the painted piece is registered against.
    content: drawShapes(rgba, sheet, pieceShapes(character, piece), piece.bounds, scale, x, y, w, h),
  }));
  // Reading order for the painter's brief: rows from the top, then left to right.
  layout.sort((a, b) => a.row - b.row || a.x - b.x);
  return { png: encodePng(sheet.width, sheet.height, rgba), layout: { width: sheet.width, height: sheet.height, scale, gap: sheet.gap, ...(reference ? { figure: reference } : {}), pieces: layout } };
}

const boxIoU = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
};

// The point of a piece that must stay where its blueprint put it: where it hangs from its joint for limbs, strips and
// tips, the neck for the head, the sole for the foot, the waist for the hips and the middle for the rest.
function anchorOf(piece, box) {
  const across = box.x + box.w / 2;
  if (piece.kind !== 'layer' || ['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'pelvis'].includes(piece.bone)) return [across, box.y];
  if (piece.bone === 'head' || piece.bone === 'foot') return [across, box.y + box.h];
  return [across, box.y + box.h / 2];
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const gapBetween = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));

/** The pixels of the given regions, cropped to their box with `pad` clear pixels around; soft edge pixels outside every region come along. */
function cropRegions(sheet, found, regions, pad) {
  const ids = new Set(regions.map(part => part.id));
  const minX = Math.min(...regions.map(part => part.box.x)), minY = Math.min(...regions.map(part => part.box.y));
  const maxX = Math.max(...regions.map(part => part.box.x + part.box.width)), maxY = Math.max(...regions.map(part => part.box.y + part.box.height));
  const x0 = Math.max(0, minX - 1), y0 = Math.max(0, minY - 1), x1 = Math.min(sheet.width, maxX + 1), y1 = Math.min(sheet.height, maxY + 1);
  const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2, out = Buffer.alloc(w * h * 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const owner = found.label[y * sheet.width + x];
    if (owner !== -1 && !ids.has(owner)) continue;
    sheet.rgba.copy(out, ((y - y0 + pad) * w + x - x0 + pad) * 4, (y * sheet.width + x) * 4, (y * sheet.width + x + 1) * 4);
  }
  return { x: x0 - pad, y: y0 - pad, w, h, rgba: out, png: encodePng(w, h, out) };
}

/**
 * Cut a painted sheet back into pieces. The painted regions of the whole sheet are found once; each goes to the piece
 * whose blueprint box it overlaps most (or, overlapping none, the nearest piece within half a gap), so a piece the
 * painter let grow, such as a sash whose knotted ends hang below its box, is cut whole. The standing figure's regions
 * are cut as the character's portrait. The painter paints at the blueprint's scale, so a piece keeps its painted size
 * and place; only a piece whose anchor drifted more than `drift` of its blueprint box is moved back to its anchor.
 * Returns each piece as an RGBA PNG with its rectangle in the piece's own coordinates (bind pose for layers).
 */
export function cutSheet(bytes, layout, { drift = 0.25 } = {}) {
  const painted = keyOut(bytes);
  const sx = painted.width / layout.width, sy = painted.height / layout.height;
  if (Math.abs(sx - sy) / sx > 0.03) throw new Error(`The painted sheet is ${painted.width}x${painted.height}, not the blueprint's ${layout.width}:${layout.height} shape.`);
  const scale = (sx + sy) / 2;
  const found = findParts(painted, { minShare: 0.0004 });
  // Blueprint boxes in the painted sheet's pixels; the figure, when the sheet has one, takes its own regions.
  const targets = [...layout.pieces.map(piece => ({ id: piece.id, box: piece })), ...(layout.figure ? [{ id: 'figure', box: layout.figure }] : [])]
    .map(target => ({ ...target, box: { x: target.box.x * scale, y: target.box.y * scale, w: target.box.w * scale, h: target.box.h * scale }, regions: [] }));
  for (const region of found.parts) {
    const box = { x: region.box.x, y: region.box.y, w: region.box.width, h: region.box.height };
    let best = null, bestOverlap = 0;
    for (const target of targets) { const overlap = overlapArea(box, target.box); if (overlap > bestOverlap) { best = target; bestOverlap = overlap; } }
    if (!best) {
      const near = targets.map(target => ({ target, gap: gapBetween(box, target.box) })).sort((a, b) => a.gap - b.gap)[0];
      if (near && near.gap <= (layout.gap / 2) * scale) best = near.target;
    }
    best?.regions.push(region);
  }
  const results = [];
  let figure = null;
  for (const target of targets) {
    if (target.id === 'figure') {
      if (target.regions.length) { const crop = cropRegions(painted, found, target.regions, 2); figure = { png: crop.png, width: crop.w, height: crop.h, crop: { x: crop.x, y: crop.y }, rgba: crop.rgba }; }
      continue;
    }
    const piece = layout.pieces.find(item => item.id === target.id);
    if (!target.regions.length) { results.push({ id: piece.id, missing: true }); continue; }
    const crop = cropRegions(painted, found, target.regions, 1);
    // The painted box in blueprint pixels, then in the piece's own units.
    const box = { x: crop.x / scale, y: crop.y / scale, w: crop.w / scale, h: crop.h / scale };
    const iou = boxIoU(box, piece.content);
    const [ax, ay] = anchorOf(piece, box), [bx, by] = anchorOf(piece, piece.content);
    const moved = Math.abs(ax - bx) > piece.content.w * drift || Math.abs(ay - by) > piece.content.h * drift;
    if (moved) { box.x += bx - ax; box.y += by - ay; }
    const toUnits = (value, origin, start) => origin + (value - start) / layout.scale;
    const rect = [toUnits(box.x, piece.bounds.minX, piece.x), toUnits(box.y, piece.bounds.minY, piece.y), box.w / layout.scale, box.h / layout.scale].map(value => Number(value.toFixed(2)));
    // `crop` and `rgba` keep where the picture sat on the painted sheet, for a technique that redraws it on a grid.
    results.push({ id: piece.id, kind: piece.kind, png: crop.png, width: crop.w, height: crop.h, rect, registration: Number(iou.toFixed(3)), moved,
      crop: { x: crop.x, y: crop.y }, rgba: crop.rgba });
  }
  return { key: painted.key, scale, unitsPerPixel: 1 / (layout.scale * scale), sheet: painted, pieces: results, figure };
}

const BONE_NAMES = { head: 'head', torso: 'upper body', pelvis: 'hips', upperArm: 'upper arm', forearm: 'forearm', hand: 'hand', thigh: 'thigh', shin: 'shin', foot: 'foot' };
const words = id => id.replace(/-/gu, ' ');

/** What a piece of skinPieces shows, from its bone and the IDs of the parts it gathers, when the design names it no better. */
export function pieceLabel(piece) {
  if (piece.kind === 'strip') return `the ${words(piece.chain)}, a long strip hanging straight down from its top end`;
  if (piece.kind === 'tip') return `the ${words(piece.chain).replace(/ (?:chain|rope|cord)$/u, '')} hanging at the end of its cord`;
  return `the ${BONE_NAMES[piece.bone]} piece (${piece.parts.map(part => words(part.id)).join(', ')})`;
}

/**
 * The painter's brief for one blueprint sheet: what the sheet is, the technique to paint it in, what each piece shows
 * (row by row, in the layout's reading order) and the rules that keep the pieces cuttable. `refine` lets the painter
 * redesign each piece within its place, size and joint ends, treating the flat shapes as a block-in; without it the
 * painter keeps every outline and paints inside it.
 */
export function paintBrief({ layout, style, labels, refine = false }) {
  const rows = [];
  layout.pieces.forEach((piece, index) => { (rows[piece.row] ||= []).push(`${index + 1}. ${labels[piece.id]}`); });
  const ordinal = ['Top row', 'Second row', 'Third row', 'Fourth row', 'Fifth row'];
  const count = layout.pieces.length, figure = Boolean(layout.figure);
  return [
    'Use your built-in image generation tool to edit the attached picture, blueprint.png in the working folder, into exactly one new image, then reply with one sentence describing what it shows. Do not write code, run commands or create files yourself.',
    figure
      ? `The attached picture is the blueprint of a cut-out 2D game character in flat colours on a flat magenta background. On the left the whole character stands, seen from the side and facing right; to the right are ${count} separate pieces of that character, which the game moves on a skeleton.`
      : `The attached picture is the blueprint of a cut-out 2D game character: ${count} separate flat-colour pieces on a flat magenta background. Every piece is one part of the same character, seen from the side and facing right. The game moves these pieces on a skeleton, so each piece must keep its exact place, size and outline on the sheet.`,
    `${figure ? 'Turn the whole sheet into' : 'Repaint every piece as'} finished game art in this technique: ${style}`,
    refine
      ? `The flat shapes are only a rough block-in that marks where each piece goes and where it joins the next. Design the character properly: each piece may change its outline freely and grow or shrink by up to a fifth, as long as its joints stay in place: the top and bottom ends of the arm and leg pieces, the neck at the bottom of the head, the waist at the top of the hips and the sole of the boot. Follow the descriptions of the pieces below for the design.${figure ? ' Paint the standing figure as the finished character, assembled from exactly these pieces.' : ''}`
      : 'Keep each flat colour as the base colour of its area, and paint light, shade, texture and fine detail inside the outline.',
    `${refine ? 'Use the flat colours as the palette. ' : ''}Paint every piece completely, including the areas other pieces will cover in the game. Keep any face stylized, never realistic and never a portrait of a real person.`,
    `The pieces, row by row from the top. ${rows.map((row, index) => `${ordinal[index] || `Row ${index + 1}`}, left to right: ${row.join('; ')}`).join('. ')}.`,
    `Keep the gaps: no piece may touch or overlap another${figure ? ' or the standing figure' : ''}, and nothing may be painted between them. Keep the background flat pure magenta (#FF00FF), with no shadow, floor, gradient or texture. No text, letters, numbers, labels, frames, logos, brand marks, recognizable people or copyrighted characters.`,
    'Landscape 3:2, framed exactly like the attached picture.',
  ].join('\n');
}

// The painter's technique for each render preset: the frame's style, chosen by the render device from the art styles,
// sets how the pieces are painted, so the character and the world it is drawn into share one technique.
export const TECHNIQUES = Object.freeze({
  lit: 'soft hand-painted gouache for a 2D adventure game: visible brush strokes and dry-brush texture, gentle colour variation within each area, edges in a thin darker line of the same hue, cool dusk shade on the left of each piece and warm light on its right',
  cinematic: 'painterly concept art for a 2D game: smooth, blended oil-like brushwork with fine material detail, a strong warm rim light from the right and deep soft shadow on the left',
  ink: 'ink and wash on warm paper: confident brush-ink contours of varying weight, flat washes of muted colour inside them, the paper grain showing through and a few hatching strokes in the shadows',
  watercolor: 'loose watercolour on rough paper: transparent washes that pool and bloom at the edges, pale pigment, a light pencil contour and the white of the paper for the highlights',
  cel: 'clean cel-shaded animation art: crisp dark outlines, flat base colours, one hard-edged shadow band on the left of each piece and a small hard highlight on its right, no texture',
  pixel: 'true pixel art for a 2D game: every shape built from clearly visible, equal square pixels on one coarse grid, a limited palette of the flat colours with two or three hand-placed shades each, hard edges, no anti-aliasing, no gradients and no blur',
  neon: 'luminous neon illustration: dark matte base colours, sharp glowing rim lines along the edges in the light colour, a soft bloom and subtle gradients',
  flat: 'flat minimal illustration: clean geometric shapes, flat colours with a single subtle shade step and no texture or outlines',
});
export const PAINT_LIMITS = Object.freeze({ styleMin: 20, styleMax: 400, descriptionMin: 8, descriptionMax: 240 });

/**
 * Paint a character's pieces: lay out the blueprint with the standing figure, write the brief from the technique of the
 * character's render preset, the designer's `style` sentence and its `descriptions` of the pieces (the rest keep their
 * default labels), have `generate` repaint the attached blueprint, and cut the result. Every layer piece must come back
 * or the skin is refused, since a missing piece would leave a hole in the figure; strips and tips that do not come back
 * stay vectors. Files land in `dir`: blueprint.png, layout.json, painted.png, one PNG a piece and figure.png. `source`
 * names each picture's game path from its piece ID.
 */
export async function paintCharacter({ character, style, descriptions = {}, generate, dir, source, signal }) {
  const pieces = skinPieces(character);
  const preset = character.render?.preset || 'lit';
  const { png, layout } = blueprintSheet(character, { pieces, figure: true });
  // Pixel art starts from a blueprint already on the grid the cut reads, so the painter paints on that grid.
  const cell = preset === 'pixel' ? gridSize(-character.bounds.minY, layout.scale) : null;
  await fs.mkdir(dir, { recursive: true });
  const blueprint = path.join(dir, 'blueprint.png');
  await fs.writeFile(blueprint, cell ? gridBlueprint(png, cell) : png);
  await fs.writeFile(path.join(dir, 'layout.json'), JSON.stringify(layout, null, 2));
  const labels = Object.fromEntries(pieces.map(piece => [piece.id, descriptions[piece.id] || pieceLabel(piece)]));
  const grid = cell ? ` Paint on the attached sheet's pixel grid: every pixel is one of its square blocks, ${cell} sheet pixels wide, the same for every piece and the standing figure, which stands about ${Math.round(-character.bounds.minY * layout.scale / cell)} pixels tall.` : '';
  const prompt = paintBrief({ layout, style: `${TECHNIQUES[preset] || TECHNIQUES.lit}.${grid} ${style}`, labels, refine: true });
  const started = Date.now();
  const result = await generate({ prompt, directory: dir, name: 'painted', attach: blueprint, keepPng: true, signal });
  const painted = await fs.readFile(path.join(dir, 'painted.png'));
  let cut = cutSheet(painted, layout);
  const missing = cut.pieces.filter(piece => piece.missing).map(piece => piece.id);
  const lost = missing.filter(id => layout.pieces.find(piece => piece.id === id)?.kind === 'layer');
  const technique = TECHNIQUES[preset] ? preset : 'lit';
  const report = { preset, technique, prompt, pieces: layout.pieces.length, missing, durationMs: Date.now() - started, description: result?.description || '',
    registration: cut.pieces.filter(piece => !piece.missing).map(piece => ({ id: piece.id, overlap: piece.registration, moved: piece.moved })), key: cut.key };
  if (lost.length) return { ok: false, report: { ...report, error: `The painter left out ${lost.length === 1 ? 'the piece' : 'the pieces'} ${lost.join(', ')}, so the figure would have a hole.` } };
  // Pixel art is redrawn on one grid with one palette, so the pieces keep hard, equal pixels as they move.
  if (technique === 'pixel') {
    const pixel = pixelateCut(cut, { sheet: cut.sheet, figureHeight: -character.bounds.minY });
    cut = pixel.cut;
    Object.assign(report, { grid: pixel.grid, palette: pixel.palette.length });
  }
  for (const piece of cut.pieces) if (!piece.missing) await fs.writeFile(path.join(dir, `${piece.id}.png`), piece.png);
  if (cut.figure) await fs.writeFile(path.join(dir, 'figure.png'), cut.figure.png);
  const skin = { ...skinFromCut(layout, cut, source), ...(technique === 'pixel' ? { pixel: true } : {}) };
  return { ok: true, skin, report, files: cut.pieces.filter(piece => !piece.missing).map(piece => ({ id: piece.id, file: `${piece.id}.png` })), figure: cut.figure ? 'figure.png' : null };
}

/** The `skin` block for the character file, naming each picture by the path the game loads it from. */
export function skinFromCut(layout, cut, source) {
  const byId = new Map(layout.pieces.map(piece => [piece.id, piece]));
  const skin = { images: [], cloth: [], tips: [] };
  // Layers keep the drawing order they were gathered in, which breaks ties between pictures at the same z.
  const rank = piece => (/^layer-(\d+)$/u.exec(piece.id) ? Number(/^layer-(\d+)$/u.exec(piece.id)[1]) : Infinity);
  for (const piece of [...cut.pieces].sort((a, b) => rank(a) - rank(b))) {
    if (piece.missing) continue;
    const plan = byId.get(piece.id), src = source(piece.id);
    if (plan.kind === 'layer') skin.images.push({ bone: plan.bone, side: plan.side, z: plan.z, src, rect: piece.rect });
    else if (plan.kind === 'strip') skin.cloth.push({ chain: plan.chain, src, rect: piece.rect });
    else skin.tips.push({ chain: plan.chain, src, rect: piece.rect });
  }
  if (!skin.cloth.length) delete skin.cloth;
  if (!skin.tips.length) delete skin.tips;
  return skin;
}
