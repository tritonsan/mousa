// Character format v1: a declarative description of one side-view character. The engine is fixed and shared;
// a character file supplies only drawing, proportions, colour, secondary motion, motion parameters, keyframed
// clips, effects and dialogue lines. Validation runs in the browser and in Node and never executes content.

import { parsePath, PathSyntaxError, circlePath, ellipsePath, capsulePath, unionBounds } from './geometry.js';
import { WEATHER_KINDS, TOWER_STYLES, RENDER_NAMES, lightness } from './scene.js';

export const CHARACTER_SCHEMA_VERSION = '1.0';
export const TRACK_ID = /^[a-z0-9][a-z0-9-]{0,59}$/u;
// The moment is always dusk and the road is basalt: a scene may recolour both, within these bounds.
export const SCENE_RULES = Object.freeze({ duskContrast: 10, rockLightness: 40, flags: [2, 5] });
export const BONES = Object.freeze(['pelvis', 'torso', 'head', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot']);
export const LIMB_BONES = Object.freeze(['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot']);
export const JOINTS = Object.freeze(['hip', 'chest', 'neck', 'head', 'shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe']);
export const CLIP_NAMES = Object.freeze(['signature', 'greet', 'fidget']);
export const ROTATION_TRACKS = Object.freeze(['pelvis', 'torso', 'head',
  'upperArmFront', 'forearmFront', 'handFront', 'upperArmBack', 'forearmBack', 'handBack',
  'thighFront', 'shinFront', 'footFront', 'thighBack', 'shinBack', 'footBack']);
export const EASING_NAMES = Object.freeze(['linear', 'in', 'out', 'inOut', 'outBack', 'inBack', 'inOutBack', 'outElastic', 'outBounce', 'step']);
export const TURN_STYLES = Object.freeze(['flip', 'squash', 'pivot']);
export const EFFECT_KINDS = Object.freeze(['footstep', 'trail', 'aura', 'burst']);
export const PARTICLE_SHAPES = Object.freeze(['circle', 'diamond', 'square', 'streak', 'ring', 'petal']);
export const LINE_KEYS = Object.freeze(['arrive', 'greet', 'kindle', 'after']);
export const LIMITS = Object.freeze({
  bytes: 98304, palette: 14, parts: 80, cloth: 8, tipShapes: 8, effects: 6, pathChars: 4000, pathCommands: 400, skinImages: 24,
  totalCommands: 6000, keys: 32, events: 8, coordinate: 320,
});
/** Motion parameters with their accepted ranges. Units are noted beside each in MOTION_UNITS. */
export const MOTION_RANGES = Object.freeze({
  walk: Object.freeze({ speed: [50, 220], cadence: [1, 3.4], stepHeight: [0, 0.4], bob: [0, 0.16], bounciness: [0, 1], lean: [-10, 25],
    armSwing: [0, 70], elbowBend: [0, 100], hipSway: [0, 15], headStabilize: [0, 1], squash: [0, 0.2], accel: [0.05, 1.2] }),
  idle: Object.freeze({ breathRate: [6, 30], breathDepth: [0, 1], sway: [0, 1], weightShift: [0, 1], lookAround: [0, 1], blinkInterval: [1.5, 9], stance: [0, 0.5] }),
});
export const MOTION_UNITS = Object.freeze({
  walk: { speed: 'world units per second', cadence: 'steps per second', stepHeight: 'share of leg length', bob: 'share of leg length',
    bounciness: '0 heavy and grounded, 1 springy', lean: 'degrees, positive leans forward', armSwing: 'degrees', elbowBend: 'degrees',
    hipSway: 'degrees', headStabilize: '0 head follows the body, 1 head stays level', squash: 'share of height at each footfall', accel: 'seconds to reach full speed' },
  idle: { breathRate: 'breaths per minute', breathDepth: '0-1', sway: '0-1', weightShift: '0-1', lookAround: '0-1', blinkInterval: 'seconds', stance: 'share of leg length between the feet' },
});

export class CharacterFormatError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'CharacterFormatError';
    this.code = 'CHARACTER_FORMAT_INVALID';
    this.path = path;
  }
}

const fail = (path, message) => { throw new CharacterFormatError(path, message); };
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const IDENT = /^[a-z][a-z0-9-]{0,39}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function object(value, path, allowed, required = []) {
  if (!plain(value)) fail(path, 'An object is required.');
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra !== undefined) fail(path, `Unsupported field ${JSON.stringify(extra.slice(0, 40))}; allowed fields are ${allowed.join(', ')}.`);
  const missing = required.find(key => value[key] === undefined);
  if (missing !== undefined) fail(`${path}.${missing}`, 'This field is required.');
}
function number(value, path, [min, max]) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `A number from ${min} to ${max} is required.`);
  return value;
}
function integer(value, path, range) {
  number(value, path, range);
  if (!Number.isInteger(value)) fail(path, 'A whole number is required.');
  return value;
}
function text(value, path, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/u.test(value)) fail(path, `Plain text of ${min}-${max} characters without angle brackets is required.`);
  const result = value.trim().replace(/\s+/gu, ' ');
  if (result.length < min || result.length > max) fail(path, `Plain text of ${min}-${max} characters is required.`);
  return result;
}
function ident(value, path) {
  if (typeof value !== 'string' || !IDENT.test(value)) fail(path, 'Use a lowercase ID of letters, digits and hyphens, starting with a letter (at most 40 characters).');
  return value;
}
function choice(value, options, path) {
  if (!options.includes(value)) fail(path, `Use one of: ${options.join(', ')}.`);
  return value;
}
function point(value, path, limit = LIMITS.coordinate) {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'A point [x, y] is required.');
  return [number(value[0], `${path}[0]`, [-limit, limit]), number(value[1], `${path}[1]`, [-limit, limit])];
}
function range(value, path, [min, max]) {
  if (!Array.isArray(value) || value.length !== 2) fail(path, `A [min, max] pair from ${min} to ${max} is required.`);
  const low = number(value[0], `${path}[0]`, [min, max]), high = number(value[1], `${path}[1]`, [min, max]);
  if (low > high) fail(path, 'The first value must not exceed the second.');
  return [low, high];
}
function hex(value, path) {
  if (typeof value !== 'string' || !HEX.test(value)) fail(path, 'Use a #rgb or #rrggbb colour.');
  const digits = value.slice(1).toLowerCase();
  return `#${digits.length === 3 ? digits.split('').map(c => c + c).join('') : digits}`;
}

function paletteColor(value, palette, path, { allowNone = false } = {}) {
  if (allowNone && value === 'none') return null;
  if (typeof value === 'string' && Object.hasOwn(palette, value)) return palette[value];
  if (typeof value === 'string' && HEX.test(value)) return hex(value, path);
  fail(path, `Use a palette name (${Object.keys(palette).join(', ')}) or a hex colour${allowNone ? ', or "none"' : ''}.`);
}

function shapePath(raw, path) {
  const shape = choice(raw.shape, ['path', 'capsule', 'ellipse', 'circle'], `${path}.shape`);
  let d;
  if (shape === 'path') {
    if (typeof raw.d !== 'string' || !raw.d.trim() || raw.d.length > LIMITS.pathChars) fail(`${path}.d`, `SVG path data of at most ${LIMITS.pathChars} characters is required.`);
    d = raw.d.trim();
  } else if (shape === 'capsule') {
    const from = point(raw.from, `${path}.from`), to = point(raw.to, `${path}.to`);
    const r1 = number(raw.r1, `${path}.r1`, [0.5, 80]);
    const r2 = raw.r2 === undefined ? r1 : number(raw.r2, `${path}.r2`, [0.5, 80]);
    d = capsulePath(from, to, r1, r2);
  } else if (shape === 'ellipse') {
    const center = point(raw.center, `${path}.center`);
    d = ellipsePath(center[0], center[1], number(raw.rx, `${path}.rx`, [0.5, 160]), number(raw.ry, `${path}.ry`, [0.5, 160]),
      raw.rotation === undefined ? 0 : number(raw.rotation, `${path}.rotation`, [-180, 180]));
  } else {
    const center = point(raw.center, `${path}.center`);
    d = circlePath(center[0], center[1], number(raw.r, `${path}.r`, [0.5, 160]));
  }
  let parsed;
  try { parsed = parsePath(d, { maxCommands: LIMITS.pathCommands }); }
  catch (error) { if (error instanceof PathSyntaxError) fail(`${path}.d`, error.message); throw error; }
  const { minX, minY, maxX, maxY } = parsed.bounds;
  const limit = LIMITS.coordinate;
  if (minX < -limit || maxX > limit || minY < -limit || maxY > limit) fail(`${path}`, `The shape must stay within ${limit} units of the origin.`);
  return { shape, d, bounds: parsed.bounds, commands: parsed.commands, subpaths: parsed.subpaths };
}

const SHAPE_FIELDS = ['shape', 'd', 'from', 'to', 'r1', 'r2', 'center', 'r', 'rx', 'ry', 'rotation'];
const PAINT_FIELDS = ['fill', 'stroke', 'strokeWidth', 'opacity'];

function paint(raw, palette, path) {
  const fill = paletteColor(raw.fill, palette, `${path}.fill`, { allowNone: true });
  const stroke = raw.stroke === undefined ? null : paletteColor(raw.stroke, palette, `${path}.stroke`);
  if (!fill && !stroke) fail(`${path}.stroke`, 'A shape with fill "none" needs a stroke colour.');
  const strokeWidth = raw.strokeWidth === undefined ? (stroke ? 1.5 : 0) : number(raw.strokeWidth, `${path}.strokeWidth`, [0, 10]);
  const opacity = raw.opacity === undefined ? 1 : number(raw.opacity, `${path}.opacity`, [0.05, 1]);
  // strokeWidth 0 without a stroke opts a detail (a blush, a highlight) out of the character's outline style.
  const outlined = !(raw.strokeWidth === 0 && !stroke);
  return { fill, stroke, strokeWidth, opacity, outlined };
}

function normalizePart(raw, index, palette) {
  const path = `parts[${index}]`;
  object(raw, path, ['id', 'bone', 'side', 'z', 'role', 'spring', ...SHAPE_FIELDS, ...PAINT_FIELDS], ['id', 'bone', 'shape', 'fill']);
  const id = ident(raw.id, `${path}.id`);
  const bone = choice(raw.bone, BONES, `${path}.bone`);
  const limb = LIMB_BONES.includes(bone);
  const side = raw.side === undefined ? (limb ? 'both' : 'center') : choice(raw.side, limb ? ['front', 'back', 'both'] : ['center'], `${path}.side`);
  const geometry = shapePath(raw, path);
  const z = raw.z === undefined ? 0 : integer(raw.z, `${path}.z`, [-20, 20]);
  const role = raw.role === undefined ? null : choice(raw.role, ['eye'], `${path}.role`);
  let spring = null;
  if (raw.spring !== undefined) {
    object(raw.spring, `${path}.spring`, ['pivot', 'stiffness', 'damping', 'gain'], ['pivot']);
    spring = { pivot: point(raw.spring.pivot, `${path}.spring.pivot`),
      stiffness: raw.spring.stiffness === undefined ? 0.5 : number(raw.spring.stiffness, `${path}.spring.stiffness`, [0, 1]),
      damping: raw.spring.damping === undefined ? 0.4 : number(raw.spring.damping, `${path}.spring.damping`, [0, 1]),
      gain: raw.spring.gain === undefined ? 1 : number(raw.spring.gain, `${path}.spring.gain`, [0, 2]) };
  }
  return { id, bone, side, z, role, spring, ...geometry, ...paint(raw, palette, path) };
}

function normalizeTipShape(raw, index, palette, path) {
  const at = `${path}[${index}]`;
  object(raw, at, [...SHAPE_FIELDS, ...PAINT_FIELDS], ['shape', 'fill']);
  return { ...shapePath(raw, at), ...paint(raw, palette, at) };
}

function normalizeCloth(raw, index, palette) {
  const path = `cloth[${index}]`;
  object(raw, path, ['id', 'bone', 'side', 'anchor', 'segments', 'length', 'width', 'fill', 'stripes', 'stroke', 'strokeWidth', 'opacity', 'rest',
    'stiffness', 'damping', 'gravity', 'wind', 'z', 'tip'], ['id', 'bone', 'anchor', 'segments', 'length', 'width', 'fill']);
  const bone = choice(raw.bone, BONES, `${path}.bone`);
  const limb = LIMB_BONES.includes(bone);
  const side = raw.side === undefined ? (limb ? 'front' : 'center') : choice(raw.side, limb ? ['front', 'back'] : ['center'], `${path}.side`);
  if (!Array.isArray(raw.width) || raw.width.length !== 2) fail(`${path}.width`, 'Give the width at the anchor and at the end: [start, end].');
  const width = raw.width.map((value, i) => number(value, `${path}.width[${i}]`, [0.5, 90]));
  const stripes = raw.stripes === undefined ? null : (() => {
    if (!Array.isArray(raw.stripes) || raw.stripes.length < 2 || raw.stripes.length > 4) fail(`${path}.stripes`, 'Use two to four colours.');
    return raw.stripes.map((color, i) => paletteColor(color, palette, `${path}.stripes[${i}]`));
  })();
  let tip = null;
  if (raw.tip !== undefined) {
    if (!Array.isArray(raw.tip) || !raw.tip.length || raw.tip.length > LIMITS.tipShapes) fail(`${path}.tip`, `Use an array of one to ${LIMITS.tipShapes} shapes drawn around the chain's end, with +y pointing along the chain.`);
    tip = raw.tip.map((shape, i) => normalizeTipShape(shape, i, palette, `${path}.tip`));
  }
  const paints = paint({ fill: raw.fill, stroke: raw.stroke, strokeWidth: raw.strokeWidth, opacity: raw.opacity }, palette, path);
  return { id: ident(raw.id, `${path}.id`), bone, side, anchor: point(raw.anchor, `${path}.anchor`),
    segments: integer(raw.segments, `${path}.segments`, [2, 14]), length: number(raw.length, `${path}.length`, [6, 240]), width, stripes,
    rest: raw.rest === undefined ? 90 : number(raw.rest, `${path}.rest`, [-180, 180]),
    stiffness: raw.stiffness === undefined ? 0.2 : number(raw.stiffness, `${path}.stiffness`, [0, 1]),
    damping: raw.damping === undefined ? 0.3 : number(raw.damping, `${path}.damping`, [0, 1]),
    gravity: raw.gravity === undefined ? 1 : number(raw.gravity, `${path}.gravity`, [0, 2]),
    wind: raw.wind === undefined ? 1 : number(raw.wind, `${path}.wind`, [0, 2]),
    z: raw.z === undefined ? -10 : integer(raw.z, `${path}.z`, [-20, 20]), tip, ...paints };
}

function attachment(raw, path, { bones = true, cloth = [], light = false, feet = false } = {}) {
  object(raw, path, ['bone', 'side', 'offset', 'cloth', 'light', 'feet']);
  if (raw.cloth !== undefined) {
    if (!cloth.includes(raw.cloth)) fail(`${path}.cloth`, cloth.length ? `Use a cloth ID: ${cloth.join(', ')}.` : 'This character has no cloth to attach to.');
    return { cloth: raw.cloth, offset: raw.offset === undefined ? [0, 0] : point(raw.offset, `${path}.offset`, 80) };
  }
  if (raw.light !== undefined) {
    if (!light || raw.light !== true) fail(`${path}.light`, 'Only effects may attach to the light, with light: true.');
    return { light: true };
  }
  if (raw.feet !== undefined) {
    if (!feet || raw.feet !== true) fail(`${path}.feet`, 'Only footstep effects attach to the feet, with feet: true.');
    return { feet: true };
  }
  if (!bones || raw.bone === undefined) fail(path, 'Attach to a bone with {bone, side?, offset}, or to a cloth tip with {cloth}.');
  const bone = choice(raw.bone, BONES, `${path}.bone`);
  const limb = LIMB_BONES.includes(bone);
  const side = raw.side === undefined ? (limb ? 'front' : 'center') : choice(raw.side, limb ? ['front', 'back'] : ['center'], `${path}.side`);
  return { bone, side, offset: raw.offset === undefined ? [0, 0] : point(raw.offset, `${path}.offset`) };
}

function normalizeSkeleton(raw) {
  object(raw, 'skeleton', JOINTS, JOINTS);
  const j = Object.fromEntries(JOINTS.map(name => [name, point(raw[name], `skeleton.${name}`, 300)]));
  const above = (upper, lower, minimum = 2) => {
    if (!(j[upper][1] <= j[lower][1] - minimum)) fail(`skeleton.${upper}`, `${upper} must be at least ${minimum} units above ${lower} (smaller y; the ground is y = 0).`);
  };
  if (j.toe[1] < -8 || j.toe[1] > 4) fail('skeleton.toe', 'The toe rests on the ground: y from -8 to 4.');
  if (j.toe[0] <= j.ankle[0]) fail('skeleton.toe', 'The toe points forward: its x must be greater than the ankle x (the character faces +x).');
  above('ankle', 'toe', 1); above('knee', 'ankle', 6); above('hip', 'knee', 6); above('chest', 'hip', 10);
  above('neck', 'hip', 12); above('head', 'neck', 2);
  if (j.shoulder[1] < j.neck[1] - 6 || j.shoulder[1] > j.hip[1] - 6) fail('skeleton.shoulder', 'The shoulder sits between the neck and the hip.');
  above('shoulder', 'elbow', 4);
  const length = (a, b) => Math.hypot(j[a][0] - j[b][0], j[a][1] - j[b][1]);
  const bones = { thigh: length('hip', 'knee'), shin: length('knee', 'ankle'), upperArm: length('shoulder', 'elbow'), forearm: length('elbow', 'wrist'), foot: length('ankle', 'toe') };
  for (const [name, value] of Object.entries(bones)) if (value < 5) fail('skeleton', `The ${name} must be at least 5 units long.`);
  const leg = bones.thigh + bones.shin;
  if (leg < 20 || leg > 160) fail('skeleton', 'Thigh plus shin must be 20-160 units.');
  return j;
}

function normalizeMotion(raw, { strict, npc }) {
  object(raw, 'motion', ['walk', 'idle', 'turn', 'carry'], strict && !npc ? ['walk', 'idle', 'turn'] : []);
  const section = (name, defaults) => {
    const input = raw[name] ?? {};
    const ranges = MOTION_RANGES[name];
    object(input, `motion.${name}`, Object.keys(ranges), strict && !npc ? Object.keys(ranges) : []);
    return Object.fromEntries(Object.entries(ranges).map(([key, bounds]) => [key, input[key] === undefined ? defaults[key] : number(input[key], `motion.${name}.${key}`, bounds)]));
  };
  const walk = section('walk', { speed: 100, cadence: 2, stepHeight: 0.15, bob: 0.05, bounciness: 0.4, lean: 6, armSwing: 30, elbowBend: 30, hipSway: 4, headStabilize: 0.6, squash: 0.03, accel: 0.35 });
  const idle = section('idle', { breathRate: 14, breathDepth: 0.5, sway: 0.4, weightShift: 0.4, lookAround: 0.4, blinkInterval: 4, stance: 0.15 });
  let turn = { style: 'squash', duration: 0.2 };
  if (raw.turn !== undefined) {
    object(raw.turn, 'motion.turn', ['style', 'duration'], ['style', 'duration']);
    turn = { style: choice(raw.turn.style, TURN_STYLES, 'motion.turn.style'), duration: number(raw.turn.duration, 'motion.turn.duration', [0, 0.6]) };
  }
  let carry = null;
  if (raw.carry !== undefined && raw.carry !== null) {
    object(raw.carry, 'motion.carry', ['arm', 'upperArm', 'forearm', 'hand'], ['arm', 'upperArm', 'forearm']);
    carry = { arm: choice(raw.carry.arm, ['front', 'back'], 'motion.carry.arm'), upperArm: number(raw.carry.upperArm, 'motion.carry.upperArm', [-180, 180]),
      forearm: number(raw.carry.forearm, 'motion.carry.forearm', [-180, 180]), hand: raw.carry.hand === undefined ? 0 : number(raw.carry.hand, 'motion.carry.hand', [-180, 180]) };
  }
  return { walk, idle, turn, carry };
}

function keyEase(value, path) {
  if (value === undefined) return 'inOut';
  if (Array.isArray(value)) {
    if (value.length !== 4) fail(path, 'A cubic-bezier easing is [x1, y1, x2, y2].');
    return [number(value[0], `${path}[0]`, [0, 1]), number(value[1], `${path}[1]`, [-2, 3]), number(value[2], `${path}[2]`, [0, 1]), number(value[3], `${path}[3]`, [-2, 3])];
  }
  return choice(value, EASING_NAMES, path);
}

function keys(raw, path, duration, width, bounds) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > LIMITS.keys) fail(path, `Use an array of 1-${LIMITS.keys} keys.`);
  let last = -1;
  return raw.map((key, index) => {
    const at = `${path}[${index}]`;
    if (!Array.isArray(key) || key.length < 1 + width || key.length > 2 + width) fail(at, `A key is [time, ${width === 1 ? 'value' : 'dx, dy'}, easing?].`);
    const t = number(key[0], `${at}[0]`, [0, duration]);
    if (t < last) fail(at, 'Keys must be in time order.');
    last = t;
    const values = key.slice(1, 1 + width).map((value, i) => number(value, `${at}[${i + 1}]`, bounds));
    return { t, values, ease: keyEase(key[1 + width], `${at}[${1 + width}]`) };
  });
}

function normalizeClip(raw, name, { effects, signature }) {
  const path = `clips.${name}`;
  object(raw, path, ['duration', 'kindleAt', 'tracks', 'root', 'squash', 'events'], ['duration', 'tracks']);
  const duration = number(raw.duration, `${path}.duration`, [0.4, 8]);
  let kindleAt = null;
  if (signature) kindleAt = number(raw.kindleAt, `${path}.kindleAt`, [0.1, duration]);
  else if (raw.kindleAt !== undefined) fail(`${path}.kindleAt`, 'Only the signature clip kindles the beacon.');
  object(raw.tracks, `${path}.tracks`, ROTATION_TRACKS);
  const tracks = Object.fromEntries(Object.entries(raw.tracks).map(([track, list]) => [track, keys(list, `${path}.tracks.${track}`, duration, 1, [-240, 240])]));
  if (!Object.keys(tracks).length) fail(`${path}.tracks`, 'Animate at least one bone.');
  const root = raw.root === undefined ? null : keys(raw.root, `${path}.root`, duration, 2, [-160, 160]);
  const squash = raw.squash === undefined ? null : keys(raw.squash, `${path}.squash`, duration, 1, [0.5, 1.5]);
  let events = [];
  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events) || raw.events.length > LIMITS.events) fail(`${path}.events`, `Use at most ${LIMITS.events} events.`);
    events = raw.events.map((event, index) => {
      const at = `${path}.events[${index}]`;
      object(event, at, ['t', 'emit'], ['t', 'emit']);
      if (!effects.includes(event.emit)) fail(`${at}.emit`, effects.length ? `Use a burst effect ID: ${effects.join(', ')}.` : 'This character has no burst effects.');
      return { t: number(event.t, `${at}.t`, [0, duration]), emit: event.emit };
    });
  }
  return { duration, kindleAt, tracks, root, squash, events };
}

function normalizeEffect(raw, index, palette, cloth) {
  const path = `effects[${index}]`;
  object(raw, path, ['id', 'kind', 'shape', 'colors', 'size', 'life', 'rate', 'speed', 'spread', 'direction', 'gravity', 'drag', 'blend', 'attach'],
    ['id', 'kind', 'shape', 'colors', 'size', 'life', 'rate', 'speed']);
  const kind = choice(raw.kind, EFFECT_KINDS, `${path}.kind`);
  if (!Array.isArray(raw.colors) || !raw.colors.length || raw.colors.length > 4) fail(`${path}.colors`, 'Use one to four colours.');
  const rateBounds = kind === 'burst' ? [1, 80] : kind === 'footstep' ? [1, 12] : [0.5, 60];
  const attach = kind === 'footstep' ? { feet: true } : raw.attach === undefined ? { light: true }
    : attachment(raw.attach, `${path}.attach`, { cloth, light: true });
  return { id: ident(raw.id, `${path}.id`), kind, shape: choice(raw.shape, PARTICLE_SHAPES, `${path}.shape`),
    colors: raw.colors.map((color, i) => paletteColor(color, palette, `${path}.colors[${i}]`)),
    size: range(raw.size, `${path}.size`, [0.5, 30]), life: range(raw.life, `${path}.life`, [0.1, 6]),
    rate: number(raw.rate, `${path}.rate`, rateBounds), speed: range(raw.speed, `${path}.speed`, [0, 400]),
    spread: raw.spread === undefined ? 60 : number(raw.spread, `${path}.spread`, [0, 360]),
    direction: raw.direction === undefined ? -90 : number(raw.direction, `${path}.direction`, [-180, 180]),
    gravity: raw.gravity === undefined ? 0 : number(raw.gravity, `${path}.gravity`, [-400, 400]),
    drag: raw.drag === undefined ? 0.2 : number(raw.drag, `${path}.drag`, [0, 1]),
    blend: raw.blend === undefined ? 'add' : choice(raw.blend, ['normal', 'add'], `${path}.blend`), attach };
}

/**
 * The scene's art direction: anchor colours, weather, mist and the beacons' style. Lore and layout are not here; the
 * road, the bridge, the bench and the beacon stand where they always do. `full` requires the anchors a designed scene
 * needs, as the design harness does.
 */
function normalizeScene(raw, { full }) {
  object(raw, 'scene', ['sky', 'sun', 'clouds', 'rock', 'foliage', 'rim', 'flags', 'weather', 'fog', 'towers'], full ? ['sky', 'clouds', 'rock', 'foliage', 'weather'] : []);
  const scene = {};
  if (raw.sky !== undefined) {
    if (!Array.isArray(raw.sky) || raw.sky.length !== 2) fail('scene.sky', 'Give the sky as [zenith, horizon]: two colours from the top of the sky down to the horizon.');
    scene.sky = raw.sky.map((color, index) => hex(color, `scene.sky[${index}]`));
    const [top, bottom] = scene.sky.map(lightness);
    if (top > bottom - SCENE_RULES.duskContrast) fail('scene.sky', `It is always dusk on the Vesper Cliffs: the zenith must be darker than the horizon by at least ${SCENE_RULES.duskContrast} CIE L* (now ${Math.round(top)} over ${Math.round(bottom)}).`);
  }
  for (const key of ['sun', 'clouds', 'rock', 'foliage', 'rim']) if (raw[key] !== undefined) scene[key] = hex(raw[key], `scene.${key}`);
  if (scene.rock && lightness(scene.rock) > SCENE_RULES.rockLightness) fail('scene.rock', `The road and the cliffs are basalt: use a dark rock colour, CIE L* at most ${SCENE_RULES.rockLightness} (this one is ${Math.round(lightness(scene.rock))}).`);
  if (raw.flags !== undefined) {
    const [low, high] = SCENE_RULES.flags;
    if (!Array.isArray(raw.flags) || raw.flags.length < low || raw.flags.length > high) fail('scene.flags', `Use ${low} to ${high} colours for the prayer flags.`);
    scene.flags = raw.flags.map((color, index) => hex(color, `scene.flags[${index}]`));
  }
  if (raw.weather !== undefined) {
    object(raw.weather, 'scene.weather', ['kind', 'density', 'color'], ['kind']);
    scene.weather = { kind: choice(raw.weather.kind, WEATHER_KINDS, 'scene.weather.kind'),
      density: raw.weather.density === undefined ? 0.4 : number(raw.weather.density, 'scene.weather.density', [0, 1]),
      ...(raw.weather.color === undefined ? {} : { color: hex(raw.weather.color, 'scene.weather.color') }) };
  }
  if (raw.fog !== undefined) scene.fog = number(raw.fog, 'scene.fog', [0, 1]);
  if (raw.towers !== undefined) scene.towers = choice(raw.towers, TOWER_STYLES, 'scene.towers');
  return scene;
}

// A painted skin: pictures the host cut from a painted blueprint sheet. Each image is drawn on one bone in the bind
// pose's coordinates, a cloth picture is laid along its chain from the root, and a tip picture replaces the chain's
// tip shapes in their own frame. The vector parts stay the character's measured shape; on screen the pictures
// replace them.
export const SKIN_SOURCE = /^runs\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,80}\.png$/u;
function skinSource(value, at) {
  if (typeof value !== 'string' || !SKIN_SOURCE.test(value)) fail(`${at}.src`, 'Use a PNG of this pair, such as runs/<pair>/<name>.png.');
  return value;
}
function skinRect(value, at, frame) {
  if (!Array.isArray(value) || value.length !== 4) fail(`${at}.rect`, `Use [x, y, width, height] in ${frame}.`);
  const [x, y] = point(value.slice(0, 2), `${at}.rect`);
  return [x, y, number(value[2], `${at}.rect[2]`, [0.5, LIMITS.coordinate]), number(value[3], `${at}.rect[3]`, [0.5, LIMITS.coordinate])];
}
function normalizeSkin(raw, cloth) {
  object(raw, 'skin', ['images', 'cloth', 'tips', 'pixel'], ['images']);
  // Pixel pictures hold one picture pixel a cell of the art, and are drawn without smoothing.
  if (raw.pixel !== undefined && typeof raw.pixel !== 'boolean') fail('skin.pixel', 'Use true for pixel art pictures, or leave it out.');
  if (!Array.isArray(raw.images) || !raw.images.length || raw.images.length > LIMITS.skinImages) fail('skin.images', `Use 1-${LIMITS.skinImages} pictures.`);
  const images = raw.images.map((item, index) => {
    const at = `skin.images[${index}]`;
    object(item, at, ['bone', 'side', 'z', 'src', 'rect'], ['bone', 'src', 'rect']);
    const bone = choice(item.bone, BONES, `${at}.bone`), limb = LIMB_BONES.includes(bone);
    const side = item.side === undefined ? (limb ? 'both' : 'center') : choice(item.side, limb ? ['front', 'back', 'both'] : ['center'], `${at}.side`);
    return { bone, side, z: item.z === undefined ? 0 : number(item.z, `${at}.z`, [-50, 50]), src: skinSource(item.src, at), rect: skinRect(item.rect, at, 'the bind pose') };
  });
  // A cloth picture's rect is in the strip's frame (x across the chain, y along it from the root); a tip's in the tip's.
  const chains = (key, tip) => {
    if (raw[key] === undefined) return [];
    if (!Array.isArray(raw[key]) || raw[key].length > LIMITS.cloth) fail(`skin.${key}`, `Use at most ${LIMITS.cloth} pictures.`);
    const seen = new Set();
    return raw[key].map((item, index) => {
      const at = `skin.${key}[${index}]`;
      object(item, at, ['chain', 'src', 'rect'], ['chain', 'src', 'rect']);
      const chain = cloth.find(candidate => candidate.id === item.chain);
      if (!chain) fail(`${at}.chain`, `There is no cloth chain ${JSON.stringify(String(item.chain).slice(0, 40))}.`);
      if (tip && !chain.tip) fail(`${at}.chain`, `The chain ${chain.id} has no tip to paint.`);
      if (seen.has(chain.id)) fail(`${at}.chain`, `The chain ${chain.id} has a picture already.`);
      seen.add(chain.id);
      return { chain: chain.id, src: skinSource(item.src, at), rect: skinRect(item.rect, at, tip ? "the tip's frame" : "the strip's frame") };
    });
  };
  return { images, cloth: chains('cloth', false), tips: chains('tips', true), pixel: raw.pixel === true };
}

/**
 * Validate and normalise a character. Fixed facts (name and role) must match the world canon when one is given.
 * `strict` requires every motion parameter, so a generated character cannot lean on engine defaults.
 * `npc` relaxes the lamplighter rules (light, lines and signature clip) for world characters such as the keeper.
 * `artDirection` requires a designed scene and a render style, and `tracks` the music, by a track ID from that list.
 */
export function normalizeCharacter(input, { canon = null, strict = false, npc = false, artDirection = false, tracks = null } = {}) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.bytes) fail('character', `The file exceeds ${LIMITS.bytes} bytes.`);
    try { raw = JSON.parse(raw); } catch { fail('character', 'The file must contain valid JSON.'); }
  } else if (JSON.stringify(raw ?? null).length > LIMITS.bytes) fail('character', `The file exceeds ${LIMITS.bytes} bytes.`);
  object(raw, 'character', ['schemaVersion', 'id', 'name', 'role', 'description', 'palette', 'style', 'skeleton', 'parts', 'cloth', 'light', 'motion', 'clips', 'effects', 'lines', 'scene', 'render', 'music', 'skin'],
    ['schemaVersion', 'id', 'name', 'role', 'description', 'palette', 'skeleton', 'parts', 'motion', ...(npc ? [] : ['light', 'clips', 'lines']),
      ...(artDirection && !npc ? ['scene', 'render'] : []), ...(tracks && !npc ? ['music'] : [])]);
  if (raw.schemaVersion !== CHARACTER_SCHEMA_VERSION) fail('character.schemaVersion', `Use "${CHARACTER_SCHEMA_VERSION}".`);
  const name = text(raw.name, 'character.name', { max: 60 });
  const role = text(raw.role, 'character.role', { max: 80 });
  if (canon && !npc) {
    if (name !== canon.character.name) fail('character.name', `The name is a fixed fact: "${canon.character.name}".`);
    if (role !== canon.character.role) fail('character.role', `The role is a fixed fact: "${canon.character.role}".`);
  }
  object(raw.palette, 'palette', Object.keys(raw.palette ?? {}));
  const paletteEntries = Object.entries(raw.palette);
  if (paletteEntries.length < 3 || paletteEntries.length > LIMITS.palette) fail('palette', `Name 3-${LIMITS.palette} colours.`);
  const palette = Object.fromEntries(paletteEntries.map(([key, value]) => [ident(key, `palette key ${JSON.stringify(key.slice(0, 40))}`), hex(value, `palette.${key}`)]));

  let style = { outline: null, backShade: 0.32, shadow: 0.6 };
  if (raw.style !== undefined) {
    object(raw.style, 'style', ['outline', 'backShade', 'shadow']);
    let outline = null;
    if (raw.style.outline !== undefined && raw.style.outline !== null) {
      object(raw.style.outline, 'style.outline', ['color', 'width'], ['color', 'width']);
      outline = { color: paletteColor(raw.style.outline.color, palette, 'style.outline.color'), width: number(raw.style.outline.width, 'style.outline.width', [0.5, 5]) };
    }
    style = { outline, backShade: raw.style.backShade === undefined ? style.backShade : number(raw.style.backShade, 'style.backShade', [0, 0.7]),
      shadow: raw.style.shadow === undefined ? style.shadow : number(raw.style.shadow, 'style.shadow', [0, 1]) };
  }

  const skeleton = normalizeSkeleton(raw.skeleton);
  if (!Array.isArray(raw.parts) || raw.parts.length < 4 || raw.parts.length > LIMITS.parts) fail('parts', `Draw the character with 4-${LIMITS.parts} parts.`);
  const parts = raw.parts.map((part, index) => normalizePart(part, index, palette));
  const partIds = new Set();
  for (const [index, part] of parts.entries()) {
    if (partIds.has(part.id)) fail(`parts[${index}].id`, `The ID ${part.id} is used twice.`);
    partIds.add(part.id);
  }
  for (const bone of ['torso', 'head']) if (!parts.some(part => part.bone === bone)) fail('parts', `Draw at least one part on the ${bone} bone.`);
  for (const bone of ['thigh', 'shin', 'upperArm', 'forearm']) if (!parts.some(part => part.bone === bone)) fail('parts', `Draw at least one part on the ${bone} bone, so walking reads.`);

  if (raw.cloth !== undefined && (!Array.isArray(raw.cloth) || raw.cloth.length > LIMITS.cloth)) fail('cloth', `Use at most ${LIMITS.cloth} cloth chains.`);
  const cloth = (raw.cloth ?? []).map((chain, index) => normalizeCloth(chain, index, palette));
  const clothIds = cloth.map(chain => chain.id);
  for (const [index, id] of clothIds.entries()) if (clothIds.indexOf(id) !== index || partIds.has(id)) fail(`cloth[${index}].id`, `The ID ${id} is already used.`);
  const totalCommands = parts.reduce((sum, part) => sum + part.commands, 0) + cloth.reduce((sum, chain) => sum + (chain.tip || []).reduce((s, shape) => s + shape.commands, 0), 0);
  if (totalCommands > LIMITS.totalCommands) fail('parts', `Use at most ${LIMITS.totalCommands} path commands in total.`);

  let light = null;
  if (raw.light !== undefined) {
    object(raw.light, 'light', ['color', 'radius', 'intensity', 'flicker', 'attach'], ['color', 'radius', 'intensity', 'attach']);
    let flicker = { speed: 0, amount: 0 };
    if (raw.light.flicker !== undefined) {
      object(raw.light.flicker, 'light.flicker', ['speed', 'amount'], ['speed', 'amount']);
      flicker = { speed: number(raw.light.flicker.speed, 'light.flicker.speed', [0, 14]), amount: number(raw.light.flicker.amount, 'light.flicker.amount', [0, 0.6]) };
    }
    light = { color: hex(raw.light.color, 'light.color'), radius: number(raw.light.radius, 'light.radius', [60, 420]),
      intensity: number(raw.light.intensity, 'light.intensity', [0.2, 1.5]), flicker, attach: attachment(raw.light.attach, 'light.attach', { cloth: clothIds }) };
  }

  if (raw.effects !== undefined && (!Array.isArray(raw.effects) || raw.effects.length > LIMITS.effects)) fail('effects', `Use at most ${LIMITS.effects} effects.`);
  const effects = (raw.effects ?? []).map((effect, index) => normalizeEffect(effect, index, palette, clothIds));
  for (const [index, effect] of effects.entries()) if (effects.findIndex(other => other.id === effect.id) !== index) fail(`effects[${index}].id`, `The ID ${effect.id} is used twice.`);
  const bursts = effects.filter(effect => effect.kind === 'burst').map(effect => effect.id);

  const motion = normalizeMotion(raw.motion, { strict, npc });
  const clips = {};
  if (raw.clips !== undefined) {
    object(raw.clips, 'clips', CLIP_NAMES, npc ? [] : ['signature']);
    for (const [name, clip] of Object.entries(raw.clips)) clips[name] = normalizeClip(clip, name, { effects: bursts, signature: name === 'signature' && !npc });
  }

  let lines = {};
  if (raw.lines !== undefined) {
    object(raw.lines, 'lines', LINE_KEYS, npc ? [] : LINE_KEYS);
    lines = Object.fromEntries(Object.entries(raw.lines).map(([key, value]) => [key, text(value, `lines.${key}`, { min: 2, max: 160 })]));
  }

  const bounds = unionBounds(parts.map(part => part.bounds));
  const height = -bounds.minY;
  if (height < 60 || height > 280) fail('parts', `The drawn character should stand 60-280 units tall; it is ${Math.round(height)}.`);

  // The moment's art direction travels with the character that sets it; a file without it plays the default dusk.
  const scene = raw.scene === undefined ? null : normalizeScene(raw.scene, { full: artDirection });
  let render = { preset: 'lit' };
  if (raw.render !== undefined) {
    object(raw.render, 'render', ['preset'], ['preset']);
    render = { preset: choice(raw.render.preset, RENDER_NAMES, 'render.preset') };
  }
  let music = null;
  if (raw.music !== undefined) {
    object(raw.music, 'music', ['track', 'volume'], ['track']);
    if (typeof raw.music.track !== 'string' || !TRACK_ID.test(raw.music.track)) fail('music.track', 'Use a track ID from music.json, such as quiet-harbour.');
    if (tracks && !tracks.includes(raw.music.track)) fail('music.track', `There is no track ${JSON.stringify(raw.music.track.slice(0, 60))} in music.json; use one of its IDs.`);
    music = { track: raw.music.track, volume: raw.music.volume === undefined ? 0.6 : number(raw.music.volume, 'music.volume', [0.1, 1]) };
  }
  const skin = raw.skin === undefined ? null : normalizeSkin(raw.skin, cloth);
  return { schemaVersion: CHARACTER_SCHEMA_VERSION, id: ident(raw.id, 'character.id'), name, role, description: text(raw.description, 'character.description', { min: 20, max: 400 }),
    palette, style, skeleton, parts, cloth, light, motion, clips, effects, lines, bounds, npc, scene, render, music, skin };
}

/** Counts that later measures compare between two characters. */
export function characterStats(character) {
  const colors = new Set();
  for (const part of character.parts) { if (part.fill) colors.add(part.fill); if (part.stroke) colors.add(part.stroke); }
  for (const chain of character.cloth) { if (chain.fill) colors.add(chain.fill); (chain.stripes || []).forEach(color => colors.add(color)); }
  const { minX, minY, maxX, maxY } = character.bounds;
  return { parts: character.parts.length, cloth: character.cloth.length, effects: character.effects.length,
    commands: character.parts.reduce((sum, part) => sum + part.commands, 0), colorsUsed: colors.size,
    height: Math.round(-minY), width: Math.round(maxX - minX), clips: Object.keys(character.clips) };
}
