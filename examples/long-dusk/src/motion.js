// Procedural locomotion and keyframed clips. The engine owns the gait (planted feet through leg IK, pelvis bob,
// lean, arm swing, idle breathing and glances); a character owns the parameters that give it personality, and
// its clips override bones while they play. Deterministic for a given seed and input, and free of the DOM.

import { clamp, lerp, damp, deg, TAU, wrap01, seededRandom, easingFunction, smoothstep, multiply, translation, scaling } from './math.js';
import { restPose, solveLeg, SIDES } from './rig.js';

// Share of a gait cycle each foot spends on the ground while walking.
export const STANCE = 0.6;
// Seconds over which a clip track takes over before its first key and hands back after its last.
const TRACK_EDGE = 0.14;
const easeInOut = easingFunction('inOut');

/** Stride length per gait cycle, kept within what the legs can plausibly cover. */
export function strideLength(character, rig) {
  const { speed, cadence } = character.motion.walk;
  return clamp((2 * speed) / cadence, 0.6 * rig.legLength, 2.2 * rig.legLength);
}

export function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0].values;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.values;
  let index = 0;
  while (index < keys.length - 2 && keys[index + 1].t <= t) index++;
  const a = keys[index], b = keys[index + 1];
  const span = b.t - a.t;
  const u = span > 0 ? easingFunction(a.ease)((t - a.t) / span) : 1;
  return a.values.map((value, i) => lerp(value, b.values[i], u));
}

export class CharacterController {
  constructor(character, rig, { ground = () => 0, x = 0, facing = 1, seed = 7, bounds = [-Infinity, Infinity] } = {}) {
    this.character = character;
    this.rig = rig;
    this.ground = ground;
    this.bounds = bounds;
    this.seed = seed;
    this.reset({ x, facing });
  }

  reset({ x = this.x ?? 0, facing = this.facing ?? 1 } = {}) {
    const idle = this.character.motion.idle;
    this.random = seededRandom(this.seed);
    this.x = x;
    this.vx = 0;
    this.facing = facing;
    this.visualFacing = facing;
    this.turn = null;
    this.phase = 0;
    this.gait = 0;
    this.time = 0;
    this.input = { dir: 0 };
    this.locked = false;
    this.lean = 0;
    this.leanVelocity = 0;
    this.hipDrop = 0;
    this.breath = this.random() * TAU;
    this.blink = { wait: 0.8 + this.random() * idle.blinkInterval, t: -1 };
    this.blinkAmount = 1;
    this.idle = { shiftWait: 2.5, shiftSide: 1, shift: 0, lookWait: 2.2, lookTarget: 0, look: 0, fidgetWait: 7 + this.random() * 5 };
    this.lookAt = null;
    this.clip = null;
    this.events = [];
    this.pose = restPose();
    this.scale = [1, 1];
    this.stride = strideLength(this.character, this.rig);
    this.rootY = this.ground(x);
    this.worldMatrix = multiply(translation(x, this.rootY), scaling(facing, 1));
    this.update(0);
  }

  /** Turn toward a world x, through the character's own turn style. */
  face(direction) {
    if (!direction || direction === this.facing || this.turn) return;
    const { style, duration } = this.character.motion.turn;
    if (style === 'flip' || duration <= 0) { this.facing = direction; this.visualFacing = direction; return; }
    this.turn = { from: this.facing, to: direction, t: 0, duration };
  }

  playClip(name, { lock = true, onEnd } = {}) {
    const def = this.character.clips[name];
    if (!def) return false;
    this.clip = { name, def, t: 0, lock, fadeIn: 0.14, fadeOut: 0.24, onEnd, kindled: false };
    return true;
  }

  stopClip() {
    if (!this.clip) return;
    const { onEnd } = this.clip;
    this.clip = null;
    onEnd?.();
  }

  update(dt) {
    const { walk, idle, turn: turnStyle, carry } = this.character.motion;
    const rig = this.rig;
    const legLength = rig.legLength;
    this.time += dt;
    this.events = [];
    let clip = this.clip;
    const want = this.locked || clip?.lock ? 0 : Math.sign(this.input.dir || 0);
    // Walking interrupts an idle flourish; a locking clip such as the signature plays to its end.
    if (clip && !clip.lock && want !== 0) { this.stopClip(); clip = null; }
    if (want !== 0) this.face(want);

    // Turning: the visual width passes through a thin sliver for the squash and pivot styles.
    let turnStretch = 1, turnHop = 0;
    if (this.turn) {
      const turn = this.turn;
      turn.t += dt;
      const u = clamp(turn.t / turn.duration, 0, 1);
      if (u >= 0.5) this.facing = turn.to;
      const shaped = turnStyle.style === 'pivot' ? easeInOut(u) : u;
      const width = Math.cos(Math.PI * shaped);
      this.visualFacing = turn.from * Math.sign(width || -1) * Math.max(Math.abs(width), 0.06);
      if (turnStyle.style === 'squash') turnStretch = 1 + 0.08 * Math.sin(Math.PI * u);
      if (turnStyle.style === 'pivot') turnHop = Math.sin(Math.PI * u) * 0.06 * legLength;
      if (u >= 1) { this.turn = null; this.visualFacing = this.facing; }
    } else this.visualFacing = this.facing;

    // Speed eases toward the target; a turn brings the character to a stop first.
    const target = this.turn ? 0 : want * walk.speed;
    this.vx = damp(this.vx, target, 3 / walk.accel, dt);
    if (target === 0 && Math.abs(this.vx) < 0.6) this.vx = 0;
    this.x += this.vx * dt;
    if (this.x < this.bounds[0]) { this.x = this.bounds[0]; this.vx = Math.max(0, this.vx); }
    if (this.x > this.bounds[1]) { this.x = this.bounds[1]; this.vx = Math.min(0, this.vx); }
    const speed = Math.abs(this.vx);

    // Gait phase advances with distance travelled, so planted feet do not slide.
    const stride = strideLength(this.character, rig);
    this.stride = stride;
    const previous = this.phase;
    this.phase = wrap01(this.phase + (speed / stride) * dt);
    this.gait = damp(this.gait, clamp(speed / (0.3 * walk.speed), 0, 1), 12, dt);
    const g = this.gait, still = 1 - g;
    if (g > 0.4 && dt > 0) {
      if (this.phase < previous) this.events.push({ type: 'step', side: 'Front' });
      if (previous < 0.5 && this.phase >= 0.5) this.events.push({ type: 'step', side: 'Back' });
    }
    const speedShare = clamp(speed / walk.speed, 0, 1.3);

    // Body: bob (sharp at each footfall when springy, rounded when heavy), breathing, sway and weight shift.
    const sharpness = lerp(2.2, 0.45, walk.bounciness);
    const bob = walk.bob * legLength * Math.abs(Math.sin(TAU * this.phase)) ** sharpness * g;
    this.breath += (dt * TAU * idle.breathRate) / 60;
    const breath = Math.sin(this.breath) * idle.breathDepth;
    let bodyX = idle.sway * 2.2 * Math.sin((TAU * this.time) / 5.3) * still;
    let bodyY = -bob - breath * 0.9 * still - turnHop;
    if (idle.weightShift > 0.02 && still > 0.6) {
      this.idle.shiftWait -= dt;
      if (this.idle.shiftWait <= 0) {
        this.idle.shiftSide *= -1;
        this.idle.shiftWait = lerp(9, 3.2, idle.weightShift) * (0.75 + this.random() * 0.5);
      }
    }
    this.idle.shift = damp(this.idle.shift, this.idle.shiftSide * idle.weightShift * 0.07 * legLength * still, 2.2, dt);
    bodyX += this.idle.shift;

    // Lean follows speed through a spring: a springy character rocks back when it stops.
    const leanTarget = deg(walk.lean) * speedShare * g;
    const frequency = lerp(11, 7, walk.bounciness), dampingRatio = lerp(1, 0.32, walk.bounciness);
    const acceleration = frequency * frequency * (leanTarget - this.lean) - 2 * dampingRatio * frequency * this.leanVelocity;
    this.leanVelocity += acceleration * dt;
    this.lean += this.leanVelocity * dt;

    const rotation = this.pose.rotation;
    for (const key of Object.keys(rotation)) rotation[key] = 0;
    rotation.pelvis = deg(walk.hipSway) * 0.6 * Math.sin(TAU * this.phase) * g;
    rotation.torso = this.lean + deg(walk.hipSway) * 0.25 * Math.sin(2 * TAU * this.phase) * g
      + deg(1.6) * breath * still * 0.6 + deg(1.1) * idle.sway * Math.sin((TAU * this.time) / 5.3 + 1.1) * still;

    // Glances: idle look-around, or a look at a target such as the keeper.
    if (this.lookAt) {
      const dx = (this.lookAt[0] - this.x) * this.facing;
      const dy = this.lookAt[1] - (this.rootY + rig.joints.head[1]);
      this.idle.lookTarget = clamp(Math.atan2(dy, Math.max(30, dx)), deg(-30), deg(24));
    } else if (still > 0.8) {
      this.idle.lookWait -= dt;
      if (this.idle.lookWait <= 0) {
        this.idle.lookTarget = (this.random() - 0.45) * deg(26) * idle.lookAround;
        this.idle.lookWait = lerp(9, 2.8, idle.lookAround) * (0.7 + this.random() * 0.6);
      }
    } else this.idle.lookTarget = 0;
    this.idle.look = damp(this.idle.look, this.idle.lookTarget, 4, dt);
    const nod = deg(5) * (walk.bob / 0.08) * Math.sin(2 * TAU * this.phase + 1.2) * g * (1 - walk.headStabilize);
    rotation.head = -rotation.torso * walk.headStabilize + nod + this.idle.look - deg(0.8) * breath * still;

    // Arms swing against the legs; the elbow bends more on the forward swing.
    const swing = deg(walk.armSwing) * g * Math.min(1.2, speedShare);
    const cycle = Math.cos(TAU * this.phase);
    const elbow = deg(walk.elbowBend);
    const restArm = deg(1.5) * breath * still;
    rotation.upperArmFront = swing * cycle + restArm;
    rotation.upperArmBack = -swing * cycle + restArm;
    rotation.forearmFront = -elbow * (0.25 + 0.75 * g * (1 - cycle) / 2) - elbow * 0.1 * still;
    rotation.forearmBack = -elbow * (0.25 + 0.75 * g * (1 + cycle) / 2) - elbow * 0.1 * still;
    if (carry) {
      const side = carry.arm === 'back' ? 'Back' : 'Front';
      rotation[`upperArm${side}`] = deg(carry.upperArm) + swing * 0.15 * (side === 'Front' ? cycle : -cycle) + restArm;
      rotation[`forearm${side}`] = deg(carry.forearm);
      rotation[`hand${side}`] = deg(carry.hand);
    }

    // Clip root motion and squash act before the legs are solved, so the knees absorb a crouch or a hop.
    let scaleX = 1, scaleY = 1;
    let clipWeight = 0, clipTime = 0;
    if (clip) {
      clip.t += dt;
      const def = clip.def;
      clipTime = Math.min(clip.t, def.duration);
      const fadeIn = clip.t < clip.fadeIn ? clip.t / clip.fadeIn : 1;
      const fadeOut = clip.t > def.duration ? 1 - (clip.t - def.duration) / clip.fadeOut : 1;
      clipWeight = smoothstep(0, 1, clamp(Math.min(fadeIn, fadeOut), 0, 1));
      if (def.root) {
        const [dx, dy] = sampleKeys(def.root, clipTime);
        bodyX += dx * clipWeight;
        bodyY += dy * clipWeight;
      }
      if (def.squash) {
        const [value] = sampleKeys(def.squash, clipTime);
        scaleY *= lerp(1, value, clipWeight);
        scaleX *= lerp(1, 1 / Math.sqrt(value), clipWeight);
      }
      const before = clip.t - dt;
      for (const event of def.events) if (before < event.t && clip.t >= event.t) this.events.push({ type: 'emit', effect: event.emit });
      if (def.kindleAt !== null && !clip.kindled && clip.t >= def.kindleAt) { clip.kindled = true; this.events.push({ type: 'kindle' }); }
    }

    // Feet: planted during stance, arcing forward during swing, rolling heel to toe; idle stance when still.
    const stepLift = walk.stepHeight * legLength;
    const stanceWidth = idle.stance * legLength;
    const feet = {};
    for (const [side, offset, idleX] of [['Front', 0, stanceWidth / 2], ['Back', 0.5, -stanceWidth / 2]]) {
      const p = wrap01(this.phase + offset);
      let fx, lift, roll;
      if (p < STANCE) {
        const q = p / STANCE;
        fx = stride * STANCE * (0.5 - q);
        lift = 0;
        roll = q < 0.15 ? lerp(deg(-12), 0, q / 0.15) : q > 0.72 ? lerp(0, deg(28), (q - 0.72) / 0.28) : 0;
      } else {
        const q = (p - STANCE) / (1 - STANCE);
        fx = stride * STANCE * (easeInOut(q) - 0.5);
        lift = stepLift * Math.sin(Math.PI * q ** 0.85);
        roll = lerp(deg(28), deg(-12), smoothstep(0, 0.7, q));
      }
      const x = lerp(idleX, fx, g);
      const footRoll = roll * g;
      const heel = footRoll > 0 ? Math.sin(footRoll) * rig.footLength * 0.55 : 0;
      const groundOffset = this.ground(this.x + this.facing * x) - this.ground(this.x);
      feet[side] = { ankle: [rig.joints.ankle[0] + x, rig.joints.ankle[1] + groundOffset - lift * g - heel], roll: footRoll };
    }
    const hip = [rig.joints.hip[0] + bodyX, rig.joints.hip[1] + bodyY];
    const reach = legLength * 0.985;
    let need = 0;
    for (const foot of Object.values(feet)) {
      const dx = foot.ankle[0] - hip[0], dy = foot.ankle[1] - hip[1];
      if (dx * dx + dy * dy > reach * reach && Math.abs(dx) < reach) need = Math.max(need, dy - Math.sqrt(reach * reach - dx * dx));
    }
    // A clip may lift the body on purpose (a hop), so only procedural reach lowers the hip.
    if (clipWeight > 0.5 && clip?.def.root) need = 0;
    this.hipDrop = Math.max(need, damp(this.hipDrop, need, 18, dt));
    bodyY += this.hipDrop;
    hip[1] += this.hipDrop;
    for (const side of SIDES) {
      const leg = solveLeg(rig, hip, feet[side].ankle, feet[side].roll);
      rotation[`thigh${side}`] = leg.thigh;
      rotation[`shin${side}`] = leg.shin;
      rotation[`foot${side}`] = leg.foot;
    }

    // Clip bone tracks replace the procedural rotations from a track's first key to its last, easing in and out
    // around them, so a clip that tucks the legs mid-hop leaves them to the leg IK for the rest of the clip.
    if (clip) {
      for (const [track, keys] of Object.entries(clip.def.tracks)) {
        const window = TRACK_EDGE > 0 ? Math.min(smoothstep(keys[0].t - TRACK_EDGE, keys[0].t, clipTime), 1 - smoothstep(keys[keys.length - 1].t, keys[keys.length - 1].t + TRACK_EDGE, clipTime)) : 1;
        const own = keys[0].t <= 0 && keys[keys.length - 1].t >= clip.def.duration ? 1 : window;
        rotation[track] = lerp(rotation[track], deg(sampleKeys(keys, clipTime)[0]), clipWeight * own);
      }
      if (clip.t >= clip.def.duration + clip.fadeOut) this.stopClip();
    }

    // Each footfall squashes the body a little; the squash turn stretches it as it flips.
    const distance = Math.min(this.phase, Math.abs(this.phase - 0.5), 1 - this.phase);
    const pulse = Math.max(0, 1 - distance / 0.11) ** 2 * g;
    scaleY *= (1 - walk.squash * pulse) * turnStretch;
    scaleX *= 1 + walk.squash * 0.5 * pulse;

    // Blinks and occasional idle flourishes.
    const blink = this.blink;
    if (blink.t < 0) {
      blink.wait -= dt;
      if (blink.wait <= 0) blink.t = 0;
    } else {
      blink.t += dt;
      if (blink.t > 0.16) { blink.t = -1; blink.wait = idle.blinkInterval * (0.6 + this.random() * 0.8); }
    }
    this.blinkAmount = blink.t < 0 ? 1 : 1 - 0.92 * Math.sin(Math.PI * clamp(blink.t / 0.16, 0, 1));
    if (this.character.clips.fidget && still > 0.95 && !this.clip && !this.locked && want === 0) {
      this.idle.fidgetWait -= dt;
      if (this.idle.fidgetWait <= 0) {
        this.playClip('fidget', { lock: false });
        this.idle.fidgetWait = 9 + this.random() * 7;
      }
    }

    this.pose.body = [bodyX, bodyY];
    this.scale = [scaleX, scaleY];
    this.rootY = this.ground(this.x);
    this.worldMatrix = multiply(translation(this.x, this.rootY), scaling(this.visualFacing * scaleX, scaleY));
    this.lift = Math.max(0, -bodyY);
  }
}
