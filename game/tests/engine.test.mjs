// Engine checks that run without a browser: the character format, the rig, the gait and the clips.
// Run with: node --test game/tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCharacter, characterStats, CharacterFormatError } from '../src/format.js';
import { parsePath, capsulePath, ellipsePath } from '../src/geometry.js';
import { buildRig, boneMatrices, restPose, solveLeg } from '../src/rig.js';
import { CharacterController, strideLength } from '../src/motion.js';
import { Secondary } from '../src/physics.js';
import { multiply, transformPoint } from '../src/math.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const canon = read('world/canon.json');
const samples = ['samples/sample-a.json', 'samples/sample-b.json'].map(read);
const keeper = read('characters/maren.json');

test('sample characters and the keeper validate; strict mode accepts the samples', () => {
  for (const raw of samples) {
    const character = normalizeCharacter(raw, { canon, strict: true });
    assert.equal(character.name, canon.character.name);
    assert.ok(character.light, 'a lamplighter carries a light');
    assert.ok(character.clips.signature.kindleAt > 0);
  }
  assert.equal(normalizeCharacter(keeper, { npc: true }).name, 'Maren');
});

test('fixed facts and malformed content are refused with the field named', () => {
  const renamed = structuredClone(samples[0]);
  renamed.name = 'Someone else';
  assert.throws(() => normalizeCharacter(renamed, { canon }), error => error instanceof CharacterFormatError && error.path === 'character.name');
  const badPath = structuredClone(samples[0]);
  badPath.parts[2].d = 'M0,0 L10,10 <script>';
  assert.throws(() => normalizeCharacter(badPath, { canon }), error => error.path === 'parts[2].d');
  const reversed = structuredClone(samples[0]);
  reversed.skeleton.knee = [3, -95];
  assert.throws(() => normalizeCharacter(reversed, { canon }), error => error.path.startsWith('skeleton'));
  const loose = structuredClone(samples[1]);
  delete loose.motion.walk.cadence;
  assert.throws(() => normalizeCharacter(loose, { canon, strict: true }), error => error.path === 'motion.walk.cadence');
  assert.doesNotThrow(() => normalizeCharacter(loose, { canon }));
});

test('path parsing handles relative commands, compact arc flags and primitives', () => {
  const parsed = parsePath('m10 10 h20 v-5 a5 5 0 0110 0 z');
  assert.equal(parsed.subpaths, 1);
  assert.ok(parsed.bounds.minX <= 10 && parsed.bounds.maxX >= 40);
  for (const d of [capsulePath([0, 0], [0, 40], 10, 6), capsulePath([0, 0], [30, -20], 4, 9), ellipsePath(5, 5, 8, 3, 30)]) assert.doesNotThrow(() => parsePath(d));
  assert.throws(() => parsePath('L0 0'), /start with M/u);
});

test('rest pose reproduces the drawn joints and leg IK reaches its target', () => {
  const character = normalizeCharacter(samples[0], { canon });
  const rig = buildRig(character);
  const matrices = boneMatrices(rig, restPose());
  const knee = transformPoint(matrices.thighFront, ...rig.joints.knee);
  assert.deepEqual(knee.map(Math.round), rig.joints.knee);
  const pose = restPose();
  const target = [rig.joints.ankle[0] + 20, rig.joints.ankle[1] - 6];
  const leg = solveLeg(rig, rig.joints.hip, target, 0);
  pose.rotation.thighFront = leg.thigh;
  pose.rotation.shinFront = leg.shin;
  const ankle = transformPoint(boneMatrices(rig, pose).shinFront, ...rig.joints.ankle);
  assert.ok(Math.hypot(ankle[0] - target[0], ankle[1] - target[1]) < 0.05, `ankle ${ankle} should reach ${target}`);
});

function walk(character, seconds, { dir = 1 } = {}) {
  const rig = buildRig(character);
  const controller = new CharacterController(character, rig, { ground: () => 0, x: 0, seed: 5 });
  const secondary = new Secondary(character);
  const samplesOut = [];
  controller.input.dir = dir;
  for (let i = 0; i < seconds * 120; i++) {
    controller.update(1 / 120);
    const local = boneMatrices(rig, controller.pose);
    const world = Object.fromEntries(Object.entries(local).map(([key, matrix]) => [key, multiply(controller.worldMatrix, matrix)]));
    secondary.update(1 / 120, world, { wind: () => -80, ground: () => 0 });
    samplesOut.push({ x: controller.x, phase: controller.phase, toe: transformPoint(world.footFront, ...rig.joints.toe), hip: transformPoint(world.torso, ...rig.joints.hip), events: controller.events });
  }
  return { rig, controller, secondary, samples: samplesOut };
}

test('walking is deterministic, plants the feet and produces the declared cadence', () => {
  for (const raw of samples) {
    const character = normalizeCharacter(raw, { canon });
    const first = walk(character, 4), second = walk(character, 4);
    assert.deepEqual(first.samples.at(-1).toe, second.samples.at(-1).toe, 'same input, same pose');
    const steps = first.samples.slice(240).reduce((count, sample) => count + sample.events.filter(event => event.type === 'step').length, 0);
    const expected = (strideLength(character, first.rig) === (2 * character.motion.walk.speed) / character.motion.walk.cadence ? character.motion.walk.cadence : null);
    if (expected) assert.ok(Math.abs(steps / 2 - expected) <= 0.6, `${raw.id}: ${steps / 2} steps a second, expected about ${expected}`);
    // During the planted part of the stance the toe stays within a few units of the ground.
    const planted = first.samples.slice(240).filter(sample => sample.phase > 0.2 && sample.phase < 0.45);
    assert.ok(planted.every(sample => Math.abs(sample.toe[1]) < 4), `${raw.id}: planted toe heights ${planted.map(s => s.toe[1].toFixed(1)).slice(0, 5)}`);
    assert.ok(first.secondary.chains.every(chain => chain.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))));
  }
});

test('the signature clip fires its kindling event once, at its declared time', () => {
  for (const raw of samples) {
    const character = normalizeCharacter(raw, { canon });
    const rig = buildRig(character);
    const controller = new CharacterController(character, rig, { ground: () => 0, x: 0, seed: 5 });
    controller.playClip('signature');
    let kindledAt = null, kindles = 0;
    for (let i = 0; i < 6 * 120; i++) {
      controller.update(1 / 120);
      for (const event of controller.events) if (event.type === 'kindle') { kindles++; kindledAt = (i + 1) / 120; }
    }
    assert.equal(kindles, 1);
    assert.ok(Math.abs(kindledAt - character.clips.signature.kindleAt) < 0.02);
    assert.equal(controller.clip, null, 'the clip ends and hands back to the engine');
  }
});

test('the two samples differ in the measures the comparison will report', () => {
  const [a, b] = samples.map(raw => normalizeCharacter(raw, { canon }));
  const [statsA, statsB] = [a, b].map(characterStats);
  assert.ok(Math.abs(statsA.height - statsB.height) > 30);
  assert.notEqual(a.motion.turn.style, b.motion.turn.style);
  assert.ok(Math.abs(a.motion.walk.cadence - b.motion.walk.cadence) > 1);
});
