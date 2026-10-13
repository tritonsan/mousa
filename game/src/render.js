// Render styles for the whole frame. A style changes how the world draws its own shapes (ink lines, banded skies,
// stepped cloud and light, neon edges), gives the characters an outline when they draw none, and finishes the frame:
// a paper grain, a soft wash, bloom, scanlines, a letterbox, a colour grade, or the frame redrawn in hard pixels. The
// default, lit, draws exactly as the original scene did.

import { RENDER_PRESETS } from './scene.js';
import { clamp, seededRandom } from './math.js';

export const RENDER_SETTINGS = Object.freeze({
  lit: { grain: 0.05, vignette: 0.55 },
  ink: { world: { lines: 1.8, lineColor: '#120d0a', boil: true }, outline: { color: '#120d0a', width: 1.6 }, grain: 0, vignette: 0.3, paper: 0.62,
    grade: 'sepia(0.34) saturate(0.78) contrast(1.06) brightness(1.06)' },
  watercolor: { world: {}, grain: 0, vignette: 0.2, paper: 0.55, wash: 0.26, soften: 0.55, blur: 2.2, grade: 'saturate(0.84) brightness(1.12) contrast(0.93)' },
  cel: { world: { lines: 1.9, lineColor: '#0a0910', skySteps: 7, cloudSteps: 2 }, outline: { color: '#0a0910', width: 1.9 }, lightSteps: 3, grain: 0, vignette: 0.26,
    grade: 'saturate(1.3) contrast(1.08)' },
  pixel: { grain: 0, vignette: 0.42, pixelRows: 176, levels: 8, dither: 0.6 },
  neon: { world: { neon: true }, grain: 0.03, vignette: 0.6, bloom: 0.6, scanlines: 0.16, grade: 'saturate(1.55) contrast(1.16) brightness(0.84)' },
  flat: { world: { flat: true, skySteps: 5 }, lightSteps: 2, grain: 0, vignette: 0, grade: 'saturate(0.96)' },
  cinematic: { grain: 0.09, vignette: 0.78, bloom: 0.34, letterbox: 0.11, grade: 'contrast(1.12) saturate(1.08)' },
});

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(value => value / 16 - 0.5);

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

/** Paper: a warm sheet with fibres and speckles that multiplies into the frame. */
function paperTexture(size = 256) {
  const canvas = makeCanvas(size, size), ctx = canvas.getContext('2d'), random = seededRandom(7);
  ctx.fillStyle = '#f4ecdc';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.05 + random() * 0.1;
    ctx.fillStyle = random() < 0.5 ? '#c9b99c' : '#ffffff';
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
  }
  ctx.strokeStyle = '#bba98a';
  for (let i = 0; i < 70; i++) {
    const x = random() * size, y = random() * size, angle = random() * Math.PI, length = 6 + random() * 18;
    ctx.globalAlpha = 0.08 + random() * 0.1;
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
  }
  return canvas;
}

/** A wash: blotches of pigment, from a small noise field drawn large and soft. */
function washTexture() {
  const size = 48, canvas = makeCanvas(size, size), ctx = canvas.getContext('2d'), random = seededRandom(11);
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 196 + Math.round(random() * 59);
    image.data[i] = value; image.data[i + 1] = value - 4; image.data[i + 2] = value - 10; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export class Finish {
  constructor(preset = 'lit', { reducedMotion = false } = {}) {
    this.preset = Object.hasOwn(RENDER_SETTINGS, preset) ? preset : 'lit';
    this.label = RENDER_PRESETS[this.preset].label;
    this.settings = RENDER_SETTINGS[this.preset];
    this.reducedMotion = reducedMotion;
    // The default style draws straight onto the visible canvas, exactly as before; the others finish an offscreen frame.
    this.direct = this.preset === 'lit';
    this.world = this.settings.world || {};
    this.outline = this.settings.outline || null;
    this.buffers = new Map();
    this.paper = this.settings.paper ? paperTexture() : null;
    this.wash = this.settings.wash ? washTexture() : null;
  }

  buffer(name, width, height, options) {
    let entry = this.buffers.get(name);
    if (!entry) { const canvas = makeCanvas(width, height); entry = { canvas, ctx: canvas.getContext('2d', options) }; this.buffers.set(name, entry); }
    if (entry.canvas.width !== width || entry.canvas.height !== height) { entry.canvas.width = width; entry.canvas.height = height; }
    return entry;
  }

  /** Alpha stops of a light pool: smooth, or hard bands for the stepped styles. */
  lightStops(intensity) {
    const i = clamp(intensity, 0, 1), steps = this.settings.lightSteps;
    if (steps === 3) return [[0, i], [0.3, i], [0.3005, i * 0.52], [0.6, i * 0.52], [0.6005, i * 0.2], [0.85, i * 0.2], [0.8505, 0], [1, 0]];
    if (steps === 2) return [[0, i * 0.82], [0.48, i * 0.82], [0.4805, i * 0.3], [0.84, i * 0.3], [0.8405, 0], [1, 0]];
    return [[0, i], [0.45, clamp(intensity * 0.38, 0, 1)], [1, 0]];
  }

  /** Texture and atmosphere on the frame itself: bloom, a soft wash, paper, the vignette, grain and scanlines. */
  overlay(ctx, { width, height, grain, time }) {
    const s = this.settings;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (s.bloom) {
      const small = this.buffer('bloom', Math.max(1, Math.round(width / 4)), Math.max(1, Math.round(height / 4)));
      small.ctx.setTransform(1, 0, 0, 1, 0, 0);
      small.ctx.clearRect(0, 0, small.canvas.width, small.canvas.height);
      small.ctx.filter = 'brightness(0.78) contrast(2.3) blur(2.5px)';
      small.ctx.drawImage(ctx.canvas, 0, 0, small.canvas.width, small.canvas.height);
      small.ctx.filter = 'none';
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = s.bloom; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small.canvas, 0, 0, width, height);
      ctx.restore();
    }
    if (s.soften) {
      const soft = this.buffer('soft', width, height);
      soft.ctx.setTransform(1, 0, 0, 1, 0, 0);
      soft.ctx.filter = `blur(${(s.blur || 2) * (height / 720)}px)`;
      soft.ctx.drawImage(ctx.canvas, 0, 0);
      soft.ctx.filter = 'none';
      ctx.save(); ctx.globalAlpha = s.soften; ctx.drawImage(soft.canvas, 0, 0); ctx.restore();
    }
    if (this.wash) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = s.wash; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.wash, 0, 0, width, height);
      ctx.restore();
    }
    if (this.paper) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = s.paper;
      ctx.fillStyle = ctx.createPattern(this.paper, 'repeat');
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = s.paper * 0.5;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    if (s.vignette) {
      const vignette = ctx.createRadialGradient(width / 2, height * 0.52, Math.max(width, height) * 0.32, width / 2, height * 0.52, Math.max(width, height) * 0.78);
      vignette.addColorStop(0, 'rgba(8,10,18,0)');
      vignette.addColorStop(1, `rgba(8,10,18,${s.vignette})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    }
    if (s.grain) {
      ctx.save();
      ctx.globalAlpha = s.grain;
      ctx.globalCompositeOperation = 'overlay';
      const offset = this.reducedMotion ? 0 : Math.floor((time * 60) % 7) * 17;
      ctx.translate(-offset, -offset);
      ctx.fillStyle = ctx.createPattern(grain, 'repeat');
      ctx.fillRect(0, 0, width + 128, height + 128);
      ctx.restore();
    }
    if (s.scanlines) {
      const lines = this.buffer('scanlines', 1, 3);
      if (!lines.ready) { lines.ctx.fillStyle = '#000000'; lines.ctx.fillRect(0, 0, 1, 1); lines.ready = true; }
      ctx.save(); ctx.globalAlpha = s.scanlines; ctx.fillStyle = ctx.createPattern(lines.canvas, 'repeat'); ctx.fillRect(0, 0, width, height); ctx.restore();
    }
  }

  /** Copy the finished frame to the visible canvas: graded, or redrawn in hard pixels, then the letterbox. */
  present(target, frame) {
    const s = this.settings, { width, height } = target.canvas;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = 'source-over';
    target.globalAlpha = 1;
    if (s.pixelRows) {
      const rows = s.pixelRows, columns = Math.max(1, Math.round(rows * width / height));
      const small = this.buffer('pixels', columns, rows, { willReadFrequently: true });
      small.ctx.imageSmoothingEnabled = true;
      small.ctx.drawImage(frame, 0, 0, columns, rows);
      const image = small.ctx.getImageData(0, 0, columns, rows), data = image.data, levels = s.levels - 1, dither = s.dither ?? 1;
      for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        const index = (y * columns + x) * 4, threshold = BAYER[(y & 3) * 4 + (x & 3)] * dither / levels;
        for (let c = 0; c < 3; c++) data[index + c] = Math.round(clamp(data[index + c] / 255 + threshold, 0, 1) * levels) / levels * 255;
      }
      small.ctx.putImageData(image, 0, 0);
      target.imageSmoothingEnabled = false;
      target.drawImage(small.canvas, 0, 0, width, height);
      target.imageSmoothingEnabled = true;
    } else {
      target.filter = s.grade || 'none';
      target.drawImage(frame, 0, 0);
      target.filter = 'none';
    }
    if (s.letterbox) {
      const bar = Math.round(height * s.letterbox);
      target.fillStyle = '#050608';
      target.fillRect(0, 0, width, bar);
      target.fillRect(0, height - bar, width, bar);
    }
  }
}
