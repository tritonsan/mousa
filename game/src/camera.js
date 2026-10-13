// A side-scrolling camera with parallax. Layer factor p = 1 is the playfield; p < 1 recedes, p > 1 is foreground.
// World units are fixed: 720 units span the view height at zoom 1, whatever the canvas size.

import { damp, clamp } from './math.js';

export const VIEW_HEIGHT = 720;

export class Camera {
  constructor() {
    this.x = 0; this.y = -95; this.zoom = 1;
    this.target = { x: 0, y: -95, zoom: 1 };
    this.width = 1280; this.height = 720; this.unit = 1;
    this.limits = [-Infinity, Infinity];
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.unit = height / VIEW_HEIGHT;
  }

  /** Half the visible width in playfield units. */
  halfWidth(zoom = this.zoom) { return this.width / 2 / (zoom * this.unit); }

  clampX(x, zoom = this.zoom) {
    const half = this.halfWidth(zoom);
    const [low, high] = this.limits;
    if (high - low < half * 2) return (low + high) / 2;
    return clamp(x, low + half, high - half);
  }

  snap() {
    this.zoom = this.target.zoom;
    this.x = this.clampX(this.target.x);
    this.y = this.target.y;
  }

  update(dt, rate = 3, zoomRate = 2) {
    this.zoom = damp(this.zoom, this.target.zoom, zoomRate, dt);
    this.x = damp(this.x, this.clampX(this.target.x), rate, dt);
    this.y = damp(this.y, this.target.y, rate, dt);
    this.x = this.clampX(this.x);
  }

  scaleFor(p) { return (1 + (this.zoom - 1) * p) * this.unit; }

  view(p = 1) {
    const z = this.scaleFor(p);
    return [z, 0, 0, z, this.width / 2 - this.x * p * z, this.height / 2 - this.y * p * z];
  }

  toScreen(x, y, p = 1) {
    const z = this.scaleFor(p);
    return [(x - this.x * p) * z + this.width / 2, (y - this.y * p) * z + this.height / 2];
  }

  /** Layer-space x range on screen, with a margin, for culling scenery. */
  visible(p = 1, margin = 120) {
    const z = this.scaleFor(p);
    const half = this.width / 2 / z;
    return [this.x * p - half - margin, this.x * p + half + margin];
  }
}
