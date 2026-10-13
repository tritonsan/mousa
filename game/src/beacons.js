// The beacons' styles. The Vesper beacon always stands at the same place with its bowl at the same height, and the far
// towers on the same spires, so the kindling and the light's journey are unchanged; only their form follows the scene.

import { lerp } from './math.js';

/** Where each style holds its fire: the main bowl's flame base and width, and a far tower's flame height in tower scales. */
export const BEACON_FIRE = Object.freeze({
  stone: { base: 2, width: 150, coals: 74, tower: 26 },
  spire: { base: 14, width: 108, coals: 30, tower: 38 },
  pagoda: { base: 10, width: 122, coals: 50, tower: 30 },
  ruin: { base: 4, width: 132, coals: 60, tower: 19 },
});

function plinth(body, edges, bx, gy) {
  body.rect(bx - 74, gy - 20, 148, 24); edges.moveTo(bx - 73, gy - 19.3); edges.lineTo(bx + 73, gy - 19.3);
  body.rect(bx - 60, gy - 40, 120, 22); edges.moveTo(bx - 59, gy - 39.3); edges.lineTo(bx + 59, gy - 39.3);
}

/** An eave with upturned tips: its underside sags a little, its top rises to a ridge. */
function eave(path, edges, bx, top, half) {
  path.moveTo(bx - half, top - 10);
  path.quadraticCurveTo(bx - half * 0.55, top + 5, bx, top + 5);
  path.quadraticCurveTo(bx + half * 0.55, top + 5, bx + half, top - 10);
  path.quadraticCurveTo(bx + half * 0.45, top - 6, bx + half * 0.16, top - 22);
  path.lineTo(bx - half * 0.16, top - 22);
  path.quadraticCurveTo(bx - half * 0.45, top - 6, bx - half, top - 10);
  path.closePath();
  edges.moveTo(bx - half + 3, top - 9); edges.quadraticCurveTo(bx - half * 0.45, top - 5, bx - half * 0.16, top - 21);
}

/** The Vesper beacon in one style: body, darker bands, lit edges and the bowl, around (bx, bowlY). */
export function beaconShapes(style, { bx, gy, bowlY }) {
  const body = new Path2D(), bands = new Path2D(), edges = new Path2D(), bowl = new Path2D();
  if (style === 'spire') {
    plinth(body, edges, bx, gy);
    const mid = (gy - 40 + bowlY + 70) / 2;
    body.moveTo(bx - 23, gy - 40); body.quadraticCurveTo(bx - 17, mid, bx - 9, bowlY + 70); body.lineTo(bx + 9, bowlY + 70); body.quadraticCurveTo(bx + 17, mid, bx + 23, gy - 40); body.closePath();
    for (let y = gy - 76; y > bowlY + 100; y -= 68) {
      const t = (y - (gy - 40)) / (bowlY + 70 - (gy - 40)), half = lerp(23, 9, t ** 0.8) + 4;
      bands.rect(bx - half, y - 6, half * 2, 6); edges.moveTo(bx - half + 1, y - 5.4); edges.lineTo(bx + half - 1, y - 5.4);
    }
    body.rect(bx - 16, bowlY + 56, 32, 16); edges.moveTo(bx - 15, bowlY + 56.6); edges.lineTo(bx + 15, bowlY + 56.6);
    // A cup on the needle, and four horns curving out and up around the fire.
    bowl.moveTo(bx - 36, bowlY + 18); bowl.quadraticCurveTo(bx, bowlY + 66, bx + 36, bowlY + 18); bowl.lineTo(bx + 30, bowlY + 15);
    bowl.quadraticCurveTo(bx, bowlY + 52, bx - 30, bowlY + 15); bowl.closePath();
    for (const side of [-1, 1]) for (const reach of [0.62, 1]) {
      const root = bx + side * 16 * reach, tip = [bx + side * 60 * reach, bowlY - 30 * reach];
      bowl.moveTo(root - 3 * side, bowlY + 34);
      bowl.quadraticCurveTo(bx + side * 52 * reach, bowlY + 26, tip[0], tip[1]);
      bowl.quadraticCurveTo(bx + side * 44 * reach, bowlY + 18, root + 4 * side, bowlY + 30);
      bowl.closePath();
    }
  } else if (style === 'pagoda') {
    plinth(body, edges, bx, gy);
    const tiers = [[gy - 40, gy - 156, 31, 96], [gy - 162, gy - 272, 25, 80], [gy - 278, bowlY + 70, 19, 64]];
    for (const [bottom, top, half, roof] of tiers) {
      body.rect(bx - half, top, half * 2, bottom - top + 1);
      // A dark window in each wall, arched at the top.
      const h = Math.min(34, (bottom - top) * 0.36), wy = (bottom + top) / 2 - h / 2;
      bands.moveTo(bx - 6, wy + h); bands.lineTo(bx - 6, wy + 6); bands.quadraticCurveTo(bx, wy - 3, bx + 6, wy + 6); bands.lineTo(bx + 6, wy + h); bands.closePath();
      eave(body, edges, bx, top, roof);
    }
    // The lantern room on the top roof holds the fire in a broad dish on a short post.
    body.rect(bx - 8, bowlY + 36, 16, 16);
    bowl.moveTo(bx - 58, bowlY + 10); bowl.lineTo(bx + 58, bowlY + 10); bowl.quadraticCurveTo(bx + 50, bowlY + 34, bx + 22, bowlY + 38); bowl.lineTo(bx - 22, bowlY + 38);
    bowl.quadraticCurveTo(bx - 50, bowlY + 34, bx - 58, bowlY + 10); bowl.closePath();
    bowl.rect(bx - 62, bowlY + 5, 124, 6);
  } else if (style === 'ruin') {
    // A cracked plinth, a shaft with blocks missing that leans a little, a dish knocked askew, and fallen blocks.
    body.moveTo(bx - 74, gy + 4); body.lineTo(bx - 74, gy - 20); body.lineTo(bx + 30, gy - 20); body.lineTo(bx + 40, gy - 12); body.lineTo(bx + 74, gy - 14); body.lineTo(bx + 74, gy + 4); body.closePath();
    edges.moveTo(bx - 73, gy - 19.3); edges.lineTo(bx + 29, gy - 19.3);
    body.moveTo(bx - 64, gy - 20); body.lineTo(bx - 62, gy - 41); body.lineTo(bx + 56, gy - 39); body.lineTo(bx + 52, gy - 20); body.closePath();
    edges.moveTo(bx - 61, gy - 40.3); edges.lineTo(bx + 55, gy - 38.3);
    const lean = 6;
    const left = [[bx - 36, gy - 40], [bx - 35, gy - 120], [bx - 25, gy - 132], [bx - 34, gy - 146], [bx - 33, gy - 250], [bx - 22, gy - 262], [bx - 31, gy - 280], [bx - 29 + lean, bowlY + 44]];
    // Down the right side from the crest, with two blocks bitten out of it.
    const right = [[bx + 29 + lean, bowlY + 46], [bx + 31, gy - 330], [bx + 19, gy - 322], [bx + 21, gy - 300], [bx + 33, gy - 294], [bx + 34, gy - 190], [bx + 24, gy - 180],
      [bx + 26, gy - 160], [bx + 36, gy - 150], [bx + 36, gy - 40]];
    body.moveTo(...left[0]);
    for (const point of left.slice(1)) body.lineTo(...point);
    // The broken crest: two jagged blocks across the top, which the tipped dish rests on.
    body.lineTo(bx - 14 + lean, bowlY + 36.5); body.lineTo(bx - 4 + lean, bowlY + 47); body.lineTo(bx + 10 + lean, bowlY + 38);
    for (const point of right) body.lineTo(...point);
    body.closePath();
    for (const y of [gy - 96, gy - 206, gy - 300]) { bands.rect(bx - 39, y - 7, 76, 7); edges.moveTo(bx - 38, y - 6.4); edges.lineTo(bx + 36, y - 6.4); }
    body.rect(bx + 82, gy - 12, 26, 14); body.moveTo(bx + 112, gy + 2); body.lineTo(bx + 118, gy - 18); body.lineTo(bx + 138, gy - 12); body.lineTo(bx + 132, gy + 2); body.closePath();
    // The dish tips a few degrees, with a notch broken from its rim.
    const tilt = 0.07, cx = bx, cy = bowlY + 22;
    const at = (x, y) => [cx + (x - cx) * Math.cos(tilt) - (y - cy) * Math.sin(tilt), cy + (x - cx) * Math.sin(tilt) + (y - cy) * Math.cos(tilt)];
    const rim = [[bx - 80, bowlY + 6], [bx + 18, bowlY + 6], [bx + 26, bowlY + 16], [bx + 34, bowlY + 6], [bx + 80, bowlY + 6]];
    bowl.moveTo(...at(...rim[0]));
    for (const point of rim.slice(1)) bowl.lineTo(...at(...point));
    bowl.quadraticCurveTo(...at(bx + 68, bowlY + 36), ...at(bx + 30, bowlY + 38)); bowl.lineTo(...at(bx - 30, bowlY + 38));
    bowl.quadraticCurveTo(...at(bx - 68, bowlY + 36), ...at(bx - 80, bowlY + 6)); bowl.closePath();
  } else {
    plinth(body, edges, bx, gy);
    body.moveTo(bx - 36, gy - 40); body.lineTo(bx - 29, bowlY + 52); body.lineTo(bx + 29, bowlY + 52); body.lineTo(bx + 36, gy - 40); body.closePath();
    for (let y = gy - 70; y > bowlY + 70; y -= 52) {
      const half = lerp(29, 36, (y - bowlY) / (gy - bowlY)) + 4;
      bands.rect(bx - half, y - 7, half * 2, 7);
      edges.moveTo(bx - half + 1, y - 6.4); edges.lineTo(bx + half - 1, y - 6.4);
    }
    body.rect(bx - 46, bowlY + 36, 92, 18); edges.moveTo(bx - 45, bowlY + 36.6); edges.lineTo(bx + 45, bowlY + 36.6);
    bowl.moveTo(bx - 82, bowlY + 6); bowl.lineTo(bx + 82, bowlY + 6);
    bowl.quadraticCurveTo(bx + 70, bowlY + 36, bx + 30, bowlY + 38); bowl.lineTo(bx - 30, bowlY + 38);
    bowl.quadraticCurveTo(bx - 70, bowlY + 36, bx - 82, bowlY + 6); bowl.closePath();
    bowl.rect(bx - 88, bowlY + 1, 176, 6);
  }
  return { body, bands, edges, bowl };
}

/** A far tower in one style at scale s, standing on (x, y). */
export function towerShape(style, x, y, s) {
  const path = new Path2D();
  if (style === 'spire') {
    path.moveTo(x - 3.6 * s, y); path.lineTo(x - 1.5 * s, y - 34 * s); path.lineTo(x + 1.5 * s, y - 34 * s); path.lineTo(x + 3.6 * s, y); path.closePath();
    path.moveTo(x - 6.5 * s, y - 41 * s); path.lineTo(x, y - 33 * s); path.lineTo(x + 6.5 * s, y - 41 * s); path.lineTo(x + 4.6 * s, y - 41.5 * s); path.lineTo(x, y - 36 * s); path.lineTo(x - 4.6 * s, y - 41.5 * s); path.closePath();
  } else if (style === 'pagoda') {
    path.rect(x - 4 * s, y - 14 * s, 8 * s, 14 * s);
    for (const [top, half] of [[y - 14 * s, 9 * s], [y - 24 * s, 7 * s]]) {
      path.moveTo(x - half, top - 2 * s); path.quadraticCurveTo(x, top + 1.4 * s, x + half, top - 2 * s); path.lineTo(x + half * 0.3, top - 4.5 * s); path.lineTo(x - half * 0.3, top - 4.5 * s); path.closePath();
    }
    path.rect(x - 3 * s, y - 24 * s, 6 * s, 10 * s);
    path.moveTo(x - 6 * s, y - 29 * s); path.lineTo(x + 6 * s, y - 29 * s); path.lineTo(x + 4 * s, y - 27 * s); path.lineTo(x - 4 * s, y - 27 * s); path.closePath();
  } else if (style === 'ruin') {
    path.moveTo(x - 6 * s, y); path.lineTo(x - 5 * s, y - 13 * s); path.lineTo(x - 2.5 * s, y - 16.5 * s); path.lineTo(x + 0.5 * s, y - 12.5 * s); path.lineTo(x + 3.5 * s, y - 15.5 * s); path.lineTo(x + 5.6 * s, y); path.closePath();
    path.moveTo(x - 6 * s, y - 18 * s); path.lineTo(x + 6 * s, y - 17 * s); path.lineTo(x + 4 * s, y - 14 * s); path.lineTo(x - 4 * s, y - 15 * s); path.closePath();
  } else {
    path.moveTo(x - 6 * s, y); path.lineTo(x - 4 * s, y - 20 * s); path.lineTo(x + 4 * s, y - 20 * s); path.lineTo(x + 6 * s, y); path.closePath();
    path.rect(x - 7 * s, y - 23 * s, 14 * s, 3 * s);
    path.moveTo(x - 9 * s, y - 23 * s); path.lineTo(x + 9 * s, y - 23 * s); path.lineTo(x + 7 * s, y - 28 * s); path.lineTo(x - 7 * s, y - 28 * s); path.closePath();
  }
  return path;
}
