// Draws a posed character: parts through cached Path2D objects in bone space, cloth chains as ribbons in world
// space, and tip shapes (a lantern on a rope) in the chain's end frame.

import { multiply, rotationAbout, translation, rotation, scaling, mixHex } from './math.js';
import { boneKey } from './rig.js';

// Back limbs and back-side cloth are darkened toward the dusk's shadow tone.
const SHADOW_TONE = '#141a29';

/** A picture tinted toward the shadow tone, for the back copy of a painted limb. */
function shaded(picture, amount) {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(picture.width, picture.height) : Object.assign(document.createElement('canvas'), { width: picture.width, height: picture.height });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(picture, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = amount;
  ctx.fillStyle = SHADOW_TONE;
  ctx.fillRect(0, 0, picture.width, picture.height);
  return canvas;
}

export class CharacterPainter {
  constructor(character, rig) {
    this.character = character;
    this.rig = rig;
    this.paths = new Map(character.parts.map(part => [part.id, new Path2D(part.d)]));
    this.tips = new Map(character.cloth.filter(chain => chain.tip).map(chain => [chain.id, chain.tip.map(shape => ({ shape, path: new Path2D(shape.d) }))]));
    const shade = color => (color ? mixHex(color, SHADOW_TONE, character.style.backShade) : null);
    this.back = new Map(character.parts.map(part => [part.id, { fill: shade(part.fill), stroke: shade(part.stroke) }]));
    this.backCloth = new Map(character.cloth.map(chain => [chain.id, { fill: shade(chain.fill), stripes: chain.stripes?.map(shade) || null }]));
    this.eyeCenters = new Map(character.parts.filter(part => part.role === 'eye').map(part => [part.id, (part.bounds.minY + part.bounds.maxY) / 2]));
    // A painted skin replaces the vector parts on screen: each loaded picture is drawn on its bone, and the back copy
    // of a limb is tinted like a vector back limb. A chain with a painted strip lays it along the simulated chain and
    // a painted tip replaces the tip shapes; other chains and tips stay vectors.
    this.drawList = rig.drawList;
    this.strips = new Map();
    this.tipPictures = new Map();
    const pictures = character.skinPictures;
    if (character.skin && pictures) {
      this.pictures = pictures;
      const backSources = [...character.skin.images.filter(image => image.side !== 'center').map(image => image.src),
        ...character.skin.cloth.filter(item => character.cloth.find(chain => chain.id === item.chain)?.side === 'back').map(item => item.src)];
      this.backPictures = new Map([...new Set(backSources)].filter(src => pictures.has(src)).map(src => [src, shaded(pictures.get(src), character.style.backShade)]));
      for (const { chain, src, rect } of character.skin.cloth) if (pictures.has(src)) this.strips.set(chain, { src, rect });
      for (const { chain, src, rect } of character.skin.tips) if (pictures.has(src)) this.tipPictures.set(chain, { picture: pictures.get(src), rect });
      const skin = character.skin.images.flatMap((image, index) => (image.side === 'both' ? ['back', 'front'] : [image.side]).map(side => ({
        kind: 'skin', image, side, key: boneKey(image.bone, side), z: image.z + (side === 'back' ? -40 : 0), order: index, back: side === 'back' })));
      this.drawList = [...skin, ...rig.drawList.filter(item => item.kind === 'cloth')].sort((a, b) => a.z - b.z || a.order - b.order);
    }
  }

  /**
   * view: world-to-canvas matrix. state: { matrices (world-space bone matrices), secondary, blink, facing }.
   * `only` limits drawing to bones in a set, which the dialogue portrait uses to show head and shoulders.
   * `outline` is the render style's ink line, used when the character draws no outline of its own.
   */
  draw(ctx, view, state, { only = null, outline = null } = {}) {
    ctx.save();
    // Pixel pictures hold one pixel a cell of the art, so they scale up hard-edged.
    if (this.pictures && this.character.skin.pixel) ctx.imageSmoothingEnabled = false;
    const line = this.character.style.outline || outline;
    for (const item of this.drawList) {
      if (only && !only.has(item.kind === 'part' ? item.part.bone : item.kind === 'skin' ? item.image.bone : item.chain.bone)) continue;
      if (item.kind === 'part') this.drawPart(ctx, view, item, state, line);
      else if (item.kind === 'skin') this.drawSkin(ctx, view, item, state);
      // Beside painted pieces a vector chain (a lantern's cord) keeps its colour but loses the ink line.
      else this.drawChain(ctx, view, item, state, this.pictures ? null : line);
    }
    ctx.restore();
  }

  drawSkin(ctx, view, item, state) {
    const picture = item.back ? this.backPictures.get(item.image.src) : this.pictures.get(item.image.src);
    if (!picture) return;
    const matrix = multiply(view, state.matrices[item.key]);
    ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    ctx.globalAlpha = 1;
    const [x, y, width, height] = item.image.rect;
    ctx.drawImage(picture, x, y, width, height);
  }

  stroke(ctx, path, color, width) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(path);
  }

  drawPart(ctx, view, item, state, outline) {
    const part = item.part;
    let matrix = multiply(view, state.matrices[item.key]);
    const springAngle = state.secondary?.angles.get(part.id);
    if (springAngle) matrix = multiply(matrix, rotationAbout(part.spring.pivot[0], part.spring.pivot[1], springAngle));
    if (part.role === 'eye' && state.blink < 0.999) {
      const cy = this.eyeCenters.get(part.id);
      matrix = multiply(matrix, [1, 0, 0, state.blink, 0, cy * (1 - state.blink)]);
    }
    ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    ctx.globalAlpha = part.opacity;
    const path = this.paths.get(part.id);
    const colors = item.back ? this.back.get(part.id) : part;
    if (colors.fill) { ctx.fillStyle = colors.fill; ctx.fill(path); }
    if (part.stroke) this.stroke(ctx, path, colors.stroke, part.strokeWidth);
    else if (outline && part.fill && part.outlined) this.stroke(ctx, path, outline.color, outline.width);
  }

  /**
   * A painted strip laid along the chain: the chain is smoothed through its points, and each short run of it shows the
   * matching rows of the picture. The picture's rect places it in the strip's frame, x across the chain and y along it
   * from the root, so the painted edges, not the vector widths, give the ribbon its outline. Across the chain the
   * picture follows the character's facing, as the painted parts do.
   */
  drawStrip(ctx, view, def, points, picture, [rx, ry, rw, rh], facing) {
    const smooth = [];
    const at = i => points[Math.max(0, Math.min(points.length - 1, i))];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let s = 0; s < 4; s++) {
        const t = s / 4, t2 = t * t, t3 = t2 * t;
        // Catmull-Rom through the chain's points, so the strip bends smoothly between them.
        smooth.push({
          x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    smooth.push(at(points.length - 1));
    const lengths = [0];
    for (let i = 1; i < smooth.length; i++) lengths.push(lengths[i - 1] + Math.hypot(smooth[i].x - smooth[i - 1].x, smooth[i].y - smooth[i - 1].y));
    const total = lengths.at(-1) || 1;
    const width = picture.width, height = picture.height;
    // The simulated chain may stretch, so its arc length is spread over the strip's rest length; then a picture row
    // covers `perRow` world units along the chain and a picture column `perColumn` across it.
    const rowOf = arc => ((arc / total) * def.length - ry) / rh * height;
    const perRow = (total / def.length) * (rh / height), perColumn = (rw / width) * facing;
    for (let i = 0; i < smooth.length - 1; i++) {
      const a = smooth[i], b = smooth[i + 1];
      const length = lengths[i + 1] - lengths[i];
      if (length < 1e-6) continue;
      const v0 = Math.max(0, rowOf(lengths[i])), v1 = Math.min(height, rowOf(lengths[i + 1]) + 0.75);
      if (v1 <= v0) continue;
      const tx = (b.x - a.x) / length, ty = (b.y - a.y) / length;
      // Across is the chain's right-hand side as it hangs (world +x for a chain hanging straight down).
      const ax = ty, ay = -tx, start = rowOf(lengths[i]);
      const m = multiply(view, [ax * perColumn, ay * perColumn, tx * perRow, ty * perRow,
        a.x + ax * rx * facing - tx * start * perRow, a.y + ay * rx * facing - ty * start * perRow]);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(picture, 0, v0, width, v1 - v0, 0, v0, width, v1 - v0);
    }
  }

  drawChain(ctx, view, item, state, outline) {
    const def = item.chain;
    const chain = state.secondary?.byId.get(def.id);
    if (!chain?.points) return;
    const points = chain.points;
    const strip = this.strips.get(def.id);
    if (strip) {
      ctx.globalAlpha = def.opacity;
      const picture = item.back ? this.backPictures.get(strip.src) : this.pictures.get(strip.src);
      this.drawStrip(ctx, view, def, points, picture, strip.rect, Math.sign(state.facing || 1));
      this.drawTip(ctx, view, def, state, outline);
      return;
    }
    const n = points.length - 1;
    const left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const length = Math.hypot(tx, ty) || 1;
      tx /= length; ty /= length;
      const half = (def.width[0] + (def.width[1] - def.width[0]) * (i / n)) / 2;
      left.push([points[i].x - ty * half, points[i].y + tx * half]);
      right.push([points[i].x + ty * half, points[i].y - tx * half]);
    }
    ctx.setTransform(view[0], view[1], view[2], view[3], view[4], view[5]);
    ctx.globalAlpha = def.opacity;
    const colors = item.back ? this.backCloth.get(def.id) : def;
    const ribbon = new Path2D();
    ribbon.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < n; i++) ribbon.quadraticCurveTo(left[i][0], left[i][1], (left[i][0] + left[i + 1][0]) / 2, (left[i][1] + left[i + 1][1]) / 2);
    ribbon.lineTo(left[n][0], left[n][1]);
    ribbon.lineTo(right[n][0], right[n][1]);
    for (let i = n - 1; i > 0; i--) ribbon.quadraticCurveTo(right[i][0], right[i][1], (right[i][0] + right[i - 1][0]) / 2, (right[i][1] + right[i - 1][1]) / 2);
    ribbon.lineTo(right[0][0], right[0][1]);
    ribbon.closePath();
    const stripes = colors.stripes;
    if (stripes) {
      ctx.save();
      ctx.clip(ribbon);
      for (let i = 0; i < n; i++) {
        // Each band overlaps the next slightly so no seam shows between quads.
        const extend = 0.6;
        ctx.fillStyle = stripes[i % stripes.length];
        ctx.beginPath();
        ctx.moveTo(left[i][0], left[i][1]);
        ctx.lineTo(left[i + 1][0] + (left[i + 1][0] - left[i][0]) * extend * 0.1, left[i + 1][1] + (left[i + 1][1] - left[i][1]) * extend * 0.1);
        ctx.lineTo(right[i + 1][0] + (right[i + 1][0] - right[i][0]) * extend * 0.1, right[i + 1][1] + (right[i + 1][1] - right[i][1]) * extend * 0.1);
        ctx.lineTo(right[i][0], right[i][1]);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (colors.fill) {
      ctx.fillStyle = colors.fill;
      ctx.fill(ribbon);
    }
    if (def.stroke) this.stroke(ctx, ribbon, def.stroke, def.strokeWidth);
    else if (outline) this.stroke(ctx, ribbon, outline.color, outline.width);
    this.drawTip(ctx, view, def, state, outline);
  }

  drawTip(ctx, view, def, state, outline) {
    const tip = this.tips.get(def.id), painted = this.tipPictures.get(def.id);
    if (!tip && !painted) return;
    const frame = state.secondary.tipFrame(def.id);
    const facing = Math.sign(state.facing || 1);
    const matrix = multiply(view, multiply(translation(frame.x, frame.y), multiply(rotation(Math.atan2(frame.uy, frame.ux) - Math.PI / 2), scaling(facing, 1))));
    ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    if (painted) {
      const [x, y, width, height] = painted.rect;
      ctx.globalAlpha = 1;
      ctx.drawImage(painted.picture, x, y, width, height);
      return;
    }
    for (const { shape, path } of tip) {
      ctx.globalAlpha = shape.opacity;
      if (shape.fill) { ctx.fillStyle = shape.fill; ctx.fill(path); }
      if (shape.stroke) this.stroke(ctx, path, shape.stroke, shape.strokeWidth);
      else if (outline && shape.fill && shape.outlined) this.stroke(ctx, path, outline.color, outline.width);
    }
  }
}
