// Measures of a validated character that the protocol compares and the check tool reports: proportions, visible
// colours, stride, the light's position, and structural warnings that catch parts drawn off their joints. The
// warnings are hints for a blind author; none of them refuses a character.

import { unionBounds } from '../src/geometry.js';
import { strideLength } from '../src/motion.js';
import { buildRig } from '../src/rig.js';
import { restRaster, silhouetteMask, lightPosition, exactBounds } from './raster.mjs';

const round = (value, digits = 2) => Number(value.toFixed(digits));
const JOINTS_OF = { thigh: ['hip', 'knee'], shin: ['knee', 'ankle'], upperArm: ['shoulder', 'elbow'], forearm: ['elbow', 'wrist'] };

function near(bounds, [x, y], margin) {
  return x >= bounds.minX - margin && x <= bounds.maxX + margin && y >= bounds.minY - margin && y <= bounds.maxY + margin;
}
function gap(bounds, [x, y]) {
  const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX), dy = Math.max(bounds.minY - y, 0, y - bounds.maxY);
  return Math.hypot(dx, dy);
}

/** Every colour the character draws with: parts, cloth, stripes, tip shapes, the outline, the light and effects. */
export function colorsUsed(character) {
  const colors = new Set();
  const add = value => { if (typeof value === 'string') colors.add(value.toLowerCase()); };
  for (const part of character.parts) { add(part.fill); add(part.stroke); }
  for (const chain of character.cloth) {
    add(chain.fill); add(chain.stroke);
    for (const color of chain.stripes || []) add(color);
    for (const shape of chain.tip || []) { add(shape.fill); add(shape.stroke); }
  }
  add(character.style.outline?.color);
  add(character.light?.color);
  for (const effect of character.effects) for (const color of effect.colors) add(color);
  return colors;
}

/**
 * Proportions use the figure, not its props: the figure height is the top of the highest part on any bone but the
 * hand, so a staff held overhead does not make a character taller. Head share is the vertical extent of the head
 * bone's parts (hair, hats and hoods included) over the figure height.
 */
export function measureCharacter(character, { keeper = null, raster = restRaster(character) } = {}) {
  const rig = buildRig(character);
  const j = character.skeleton;
  // The drawn outlines' own bounds: validation's bounds are conservative around arcs and control points.
  const exact = new Map(character.parts.map(part => [part.id, exactBounds(part.d)]));
  const on = bone => character.parts.filter(part => part.bone === bone);
  const boundsFor = parts => (parts.length ? unionBounds(parts.map(part => exact.get(part.id))) : null);
  const figureParts = character.parts.filter(part => part.bone !== 'hand');
  const overall = boundsFor(character.parts);
  const figure = boundsFor(figureParts) || overall;
  const figureHeight = -figure.minY;
  const head = boundsFor(on('head'));
  const headHeight = head ? head.maxY - head.minY : 0;
  const bones = Object.fromEntries(['pelvis', 'torso', 'head', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot']
    .map(bone => [bone, boundsFor(on(bone))]).filter(([, bounds]) => bounds)
    .map(([bone, b]) => [bone, { minX: round(b.minX, 1), minY: round(b.minY, 1), maxX: round(b.maxX, 1), maxY: round(b.maxY, 1) }]));
  const walk = character.motion.walk;
  const rawStride = (2 * walk.speed) / walk.cadence;
  const stride = strideLength(character, rig);
  const light = character.light ? { color: character.light.color, radius: character.light.radius, position: lightPosition(character, raster.posed) } : null;

  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });
  for (const [bone, [pivot, end]] of Object.entries(JOINTS_OF)) {
    const bounds = boundsFor(on(bone));
    if (!bounds) continue;
    if (!near(bounds, j[pivot], 4)) warn('joint-gap', `Parts on the ${bone} bone stop ${Math.round(gap(bounds, j[pivot]))} units from the ${pivot} joint at [${j[pivot].join(', ')}]. A limb turns around that joint, so a gap would open as it swings; let a part cover the joint.`);
    if (!near(bounds, j[end], 6)) warn('joint-gap', `Parts on the ${bone} bone stop ${Math.round(gap(bounds, j[end]))} units short of the ${end} joint at [${j[end].join(', ')}], where the next bone begins.`);
  }
  if (head && !near(head, j.neck, 8)) warn('head-detached', `The head parts end ${Math.round(gap(head, j.neck))} units from the neck joint at [${j.neck.join(', ')}]. The head turns around the neck, so it would look detached; extend a head part (a chin, hair or hood) down to the neck.`);
  const torso = boundsFor(on('torso'));
  if (torso && (torso.minY > j.chest[1] + 6 || torso.maxY < j.hip[1] - 8)) warn('torso-short', `The torso parts span y ${Math.round(torso.minY)} to ${Math.round(torso.maxY)}, but the torso bone runs from the hip (y ${j.hip[1]}) to the chest (y ${j.chest[1]}). Cover that span so the body bends as one piece.`);
  const feet = boundsFor(on('foot'));
  if (!feet) warn('no-feet', 'No part is drawn on the foot bone, so the feet are invisible and steps will not read. Draw a shoe or foot on the foot bone, resting on y = 0.');
  else if (feet.maxY < -3 || feet.maxY > 4) warn('floating-feet', `The lowest point of the foot parts is at y ${round(feet.maxY, 1)}; the ground is y = 0, so the character would ${feet.maxY < 0 ? 'float above' : 'sink into'} the road.`);
  const eyes = character.parts.filter(part => part.role === 'eye');
  if (!eyes.length) warn('no-eye', 'No part has role "eye", so the character never blinks. Mark the visible eye (and any eye shine) with role "eye".');
  for (const eye of eyes) {
    const b = exact.get(eye.id), cx = (b.minX + b.maxX) / 2;
    if (cx < j.head[0] - 2) warn('eye-behind', `The eye ${eye.id} sits at x ${round(cx, 1)}, behind the head joint (x ${j.head[0]}). Characters face +x, so the face belongs on the right of the head.`);
    if (head && !near(head, [cx, (b.minY + b.maxY) / 2], 1)) warn('eye-outside', `The eye ${eye.id} lies outside the head parts.`);
  }
  for (const chain of character.cloth) {
    const bounds = boundsFor(on(chain.bone));
    if (bounds && gap(bounds, chain.anchor) > 12) warn('cloth-anchor', `The cloth ${chain.id} is anchored at [${chain.anchor.join(', ')}], ${Math.round(gap(bounds, chain.anchor))} units from any part on its ${chain.bone} bone, so it would hang in the air.`);
  }
  for (const part of character.parts.filter(item => item.spring)) {
    if (!near(exact.get(part.id), part.spring.pivot, 4)) warn('spring-pivot', `The spring pivot of ${part.id} lies outside the part; a spring swings around a point on its own edge or base.`);
  }
  const share = rawStride / rig.legLength;
  if (share < 0.6 || share > 2.2) {
    const low = Math.round(0.4 * walk.cadence * rig.legLength), high = Math.round(0.9 * walk.cadence * rig.legLength);
    warn('stride', `With speed ${walk.speed} and cadence ${walk.cadence}, each stride would be ${round(share)} leg lengths, so the engine clamps it to ${round(stride / rig.legLength)} and the feet would ${share > 2.2 ? 'slide' : 'scuff'}. For this cadence and these legs (${Math.round(rig.legLength)} units), a speed from ${low} to ${high} keeps the stride natural.`);
  }
  if (light?.position && gap(figure, light.position) > 60) warn('light-far', `The light sits at [${light.position.join(', ')}], ${Math.round(gap(figure, light.position))} units from the figure.`);
  const tiny = new Set(eyes.map(part => part.id));
  const area = part => { const b = exact.get(part.id); return (b.maxX - b.minX) * (b.maxY - b.minY); };
  const hidden = character.parts.filter(part => !raster.visible.has(part.id) && !tiny.has(part.id) && area(part) > 40).map(part => part.id);
  if (hidden.length) warn('hidden-parts', `These parts are completely covered when standing: ${hidden.slice(0, 12).join(', ')}. Check their z order, or remove them if they only show in motion by design.`);

  const width = overall.maxX - overall.minX;
  const result = {
    height: round(-overall.minY, 1), figureHeight: round(figureHeight, 1), headHeight: round(headHeight, 1), headShare: figureHeight ? round(headHeight / figureHeight, 3) : 0,
    hipHeight: round(-j.hip[1], 1), legShare: figureHeight ? round(-j.hip[1] / figureHeight, 3) : 0, width: round(width, 1), aspect: figureHeight ? round(width / figureHeight, 3) : 0,
    legLength: round(rig.legLength, 1), armLength: round(rig.armLength, 1),
    stride: { length: round(stride, 1), legs: round(stride / rig.legLength), clamped: share < 0.6 || share > 2.2 },
    bones, light, visibleColors: raster.colors.slice(0, 10), parts: character.parts.length, cloth: character.cloth.length, effects: character.effects.length,
    warnings,
  };
  if (keeper) result.keeper = { name: keeper.name, figureHeight: keeper.figureHeight, ratio: round(figureHeight / keeper.figureHeight) };
  result.silhouette = silhouetteMask(character, { figureHeight, raster });
  return result;
}
