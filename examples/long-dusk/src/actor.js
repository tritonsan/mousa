// One character in the scene: rig, controller, secondary motion, painter and effect emitters together.

import { multiply, transformPoint, rgba } from './math.js';
import { buildRig, boneMatrices, boneKey } from './rig.js';
import { CharacterController } from './motion.js';
import { Secondary } from './physics.js';
import { CharacterPainter } from './painter.js';

export class Actor {
  constructor(character, { ground, x, facing = 1, seed = 7, bounds }) {
    this.character = character;
    this.rig = buildRig(character);
    this.controller = new CharacterController(character, this.rig, { ground, x, facing, seed, bounds });
    this.secondary = new Secondary(character);
    this.painter = new CharacterPainter(character, this.rig);
    this.ground = ground;
    this.debts = new Map(character.effects.map(effect => [effect.id, 0]));
    this.matrices = null;
    this.computeMatrices();
  }

  get x() { return this.controller.x; }
  get facing() { return this.controller.facing; }

  reset(options) {
    this.controller.reset(options);
    this.secondary.reset();
    for (const key of this.debts.keys()) this.debts.set(key, 0);
    this.computeMatrices();
  }

  computeMatrices() {
    const local = boneMatrices(this.rig, this.controller.pose);
    const world = this.controller.worldMatrix;
    this.matrices = {};
    for (const [key, matrix] of Object.entries(local)) this.matrices[key] = multiply(world, matrix);
  }

  /** Advance one fixed step; returns the controller's events (footsteps, effect cues, the kindling). */
  step(dt, { wind, particles }) {
    this.controller.update(dt);
    this.computeMatrices();
    this.secondary.update(dt, this.matrices, { wind, ground: this.ground });
    const facing = Math.sign(this.controller.visualFacing) || 1;
    for (const event of this.controller.events) {
      if (event.type === 'step') {
        const toe = transformPoint(this.matrices[`foot${event.side}`], ...this.rig.joints.toe);
        for (const effect of this.character.effects) if (effect.kind === 'footstep') particles.emit(effect, toe[0], toe[1] - 1, Math.round(effect.rate), { facing });
      } else if (event.type === 'emit') {
        const effect = this.character.effects.find(item => item.id === event.effect);
        const at = effect && this.attachPoint(effect.attach);
        if (at) particles.emit(effect, at[0], at[1], Math.round(effect.rate), { facing });
      }
    }
    for (const effect of this.character.effects) {
      if (effect.kind !== 'trail' && effect.kind !== 'aura') continue;
      const rate = effect.kind === 'trail' ? effect.rate * (0.25 + 0.75 * this.controller.gait) : effect.rate;
      let debt = this.debts.get(effect.id) + rate * dt;
      const at = this.attachPoint(effect.attach);
      while (debt >= 1 && at) { particles.emit(effect, at[0], at[1], 1, { facing }); debt -= 1; }
      this.debts.set(effect.id, Math.min(debt, 4));
    }
    return this.controller.events;
  }

  attachPoint(attach) {
    if (!attach) return null;
    const facing = Math.sign(this.controller.visualFacing) || 1;
    if (attach.light) return this.lightPosition();
    if (attach.cloth) return this.secondary.tip(attach.cloth, attach.offset, facing);
    if (attach.bone) return transformPoint(this.matrices[boneKey(attach.bone, attach.side)], attach.offset[0], attach.offset[1]);
    return null;
  }

  lightPosition() {
    const light = this.character.light;
    if (!light) return null;
    return this.attachPoint(light.attach) || transformPoint(this.matrices.torso, ...this.rig.joints.chest);
  }

  /** The light this character carries, with its flicker, for the lightmap. */
  light(time) {
    const light = this.character.light;
    if (!light) return null;
    const at = this.lightPosition();
    if (!at) return null;
    const { speed, amount } = light.flicker;
    const flicker = 1 - amount * (0.5 + 0.5 * Math.sin(time * speed * 1.7) * Math.sin(time * speed * 0.9 + 1.3));
    return { x: at[0], y: at[1], radius: light.radius, color: light.color, intensity: light.intensity * flicker };
  }

  headPosition() { return transformPoint(this.matrices.head, ...this.rig.joints.head); }
  chestPosition() { return transformPoint(this.matrices.torso, ...this.rig.joints.chest); }

  drawShadow(ctx, view) {
    const shadow = this.character.style.shadow;
    if (shadow <= 0) return;
    const x = this.controller.x, y = this.ground(x);
    const lift = this.controller.lift || 0;
    const fade = Math.max(0, 1 - lift / 50);
    ctx.setTransform(...view);
    ctx.fillStyle = rgba('#0b0e16', 0.42 * shadow * fade);
    ctx.beginPath();
    ctx.ellipse(x + this.rig.centerX * this.controller.visualFacing * 0.3, y + 1, Math.max(14, this.rig.width * 0.42) * (1 - lift / 200), 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  draw(ctx, view, options) {
    this.painter.draw(ctx, view, { matrices: this.matrices, secondary: this.secondary, blink: this.controller.blinkAmount, facing: this.controller.visualFacing }, options);
  }
}
