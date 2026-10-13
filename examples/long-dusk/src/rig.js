// The fixed skeleton every character shares. A character draws its parts in one bind pose (standing, facing +x,
// arms hanging, feet on y = 0) and assigns each part to a bone; animation rotates bones around their bind-pose
// joints, as cut-out animation tools do. Front and back limbs share one drawing.

import { multiply, translation, rotationAbout, transformPoint, transformVector, clamp } from './math.js';

export const SIDES = Object.freeze(['Front', 'Back']);
const sideKey = side => (side === 'back' ? 'Back' : 'Front');
export const boneKey = (bone, side) => (['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].includes(bone) ? `${bone}${sideKey(side)}` : bone);

const angleOf = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function buildRig(character) {
  const j = character.skeleton;
  const forearmDirection = angleOf(j.elbow, j.wrist);
  const handLength = Math.max(6, distance(j.elbow, j.wrist) * 0.35);
  const handEnd = [j.wrist[0] + Math.cos(forearmDirection) * handLength, j.wrist[1] + Math.sin(forearmDirection) * handLength];
  const bones = {
    pelvis: { pivot: j.hip, end: [j.hip[0], j.hip[1] + 10] },
    torso: { pivot: j.hip, end: j.chest },
    head: { pivot: j.neck, end: j.head },
    upperArm: { pivot: j.shoulder, end: j.elbow },
    forearm: { pivot: j.elbow, end: j.wrist },
    hand: { pivot: j.wrist, end: handEnd },
    thigh: { pivot: j.hip, end: j.knee },
    shin: { pivot: j.knee, end: j.ankle },
    foot: { pivot: j.ankle, end: j.toe },
  };
  for (const bone of Object.values(bones)) {
    bone.angle = angleOf(bone.pivot, bone.end);
    bone.length = distance(bone.pivot, bone.end);
  }
  const thigh = bones.thigh.length, shin = bones.shin.length;
  const { minX, minY, maxX } = character.bounds;
  // Parts are drawn back to front: back copies of limbs sit behind everything on the near side.
  const drawList = [];
  character.parts.forEach((part, index) => {
    const sides = part.side === 'both' ? ['back', 'front'] : [part.side];
    for (const side of sides) drawList.push({ kind: 'part', part, side, key: boneKey(part.bone, side), z: part.z + (side === 'back' ? -40 : 0), order: index, back: side === 'back' });
  });
  character.cloth.forEach((chain, index) => drawList.push({ kind: 'cloth', chain, key: boneKey(chain.bone, chain.side), z: chain.z + (chain.side === 'back' ? -40 : 0), order: 1000 + index, back: chain.side === 'back' }));
  drawList.sort((a, b) => a.z - b.z || a.order - b.order);
  return {
    joints: j, bones, drawList,
    thigh, shin, legLength: thigh + shin,
    armLength: bones.upperArm.length + bones.forearm.length,
    footLength: bones.foot.length,
    ankleHeight: -j.ankle[1],
    hipHeight: -j.hip[1],
    height: -minY, width: maxX - minX, centerX: (minX + maxX) / 2,
  };
}

/** A neutral pose: every rotation zero, so the matrices reproduce the drawn bind pose. */
export function restPose() {
  return { body: [0, 0], rotation: { pelvis: 0, torso: 0, head: 0, upperArmFront: 0, forearmFront: 0, handFront: 0, upperArmBack: 0, forearmBack: 0, handBack: 0,
    thighFront: 0, shinFront: 0, footFront: 0, thighBack: 0, shinBack: 0, footBack: 0 } };
}

/** Bone matrices in root space (before the character's world position, facing and squash). */
export function boneMatrices(rig, pose) {
  const j = rig.joints, r = pose.rotation;
  const about = (joint, angle) => rotationAbout(j[joint][0], j[joint][1], angle);
  const body = translation(pose.body[0], pose.body[1]);
  const torso = multiply(body, about('hip', r.torso));
  const result = { body, pelvis: multiply(body, about('hip', r.pelvis)), torso, head: multiply(torso, about('neck', r.head)) };
  for (const side of SIDES) {
    const upperArm = multiply(torso, about('shoulder', r[`upperArm${side}`]));
    const forearm = multiply(upperArm, about('elbow', r[`forearm${side}`]));
    result[`upperArm${side}`] = upperArm;
    result[`forearm${side}`] = forearm;
    result[`hand${side}`] = multiply(forearm, about('wrist', r[`hand${side}`]));
    const thigh = multiply(body, about('hip', r[`thigh${side}`]));
    const shin = multiply(thigh, about('knee', r[`shin${side}`]));
    result[`thigh${side}`] = thigh;
    result[`shin${side}`] = shin;
    result[`foot${side}`] = multiply(shin, about('ankle', r[`foot${side}`]));
  }
  return result;
}

/**
 * Two-bone leg IK in root space. The knee bends forward (+x), as the character faces +x before mirroring.
 * Returns the bone rotations (relative to the bind pose) that put the ankle at the target and turn the foot by
 * `roll` from its drawn angle (negative lifts the toe, positive lifts the heel), plus whether the target was
 * out of reach.
 */
export function solveLeg(rig, hip, ankle, roll = 0) {
  const { thigh: l1, shin: l2, bones } = rig;
  const dx = ankle[0] - hip[0], dy = ankle[1] - hip[1];
  const reach = Math.hypot(dx, dy);
  const d = clamp(reach, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const toTarget = Math.atan2(dy, dx);
  const cosine = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const thighAngle = toTarget - Math.acos(cosine);
  const knee = [hip[0] + Math.cos(thighAngle) * l1, hip[1] + Math.sin(thighAngle) * l1];
  const target = reach > d ? [hip[0] + Math.cos(toTarget) * d, hip[1] + Math.sin(toTarget) * d] : ankle;
  const shinAngle = Math.atan2(target[1] - knee[1], target[0] - knee[0]);
  const thighRotation = thighAngle - bones.thigh.angle;
  const shinRotation = shinAngle - bones.shin.angle - thighRotation;
  const footRotation = roll - thighRotation - shinRotation;
  return { thigh: thighRotation, shin: shinRotation, foot: footRotation, stretched: reach > l1 + l2 - 0.01 };
}

export const pointOnBone = (matrices, key, local) => transformPoint(matrices[key], local[0], local[1]);
export const vectorOnBone = (matrices, key, local) => transformVector(matrices[key], local[0], local[1]);
