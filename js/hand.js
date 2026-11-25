// BULLSEYE — the thrower's hand for the winning-dart cinematic.
// Rigged right-hand mesh from the WebXR Input Profiles project (MIT, © Amazon;
// see assets/hand/LICENSE.md), posed into a dart grip with a skin material.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const HAND_URL = new URL('../assets/hand/right.glb', import.meta.url).href;
let pending = null;

/** Loads (once) and returns { root, mesh, bones } for the right hand. */
export function loadHand() {
  pending ??= new GLTFLoader()
    .loadAsync(HAND_URL)
    .then((gltf) => {
      const root = gltf.scene;
      const bones = {};
      let mesh = null;
      root.traverse((o) => {
        if (o.isBone) {
          bones[o.name] = o;
          o.userData.rest = o.quaternion.clone();
        }
        if (o.isSkinnedMesh) mesh = o;
      });
      mesh.material = skinMaterial();
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      return { root, mesh, bones };
    })
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

function skinMaterial() {
  // Fine pores and creases as a bump map; warm sheen reads as light scattering in skin.
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(60,60,60,.5)';
  for (let i = 0; i < 90; i++) {
    ctx.lineWidth = 0.6 + Math.random();
    ctx.beginPath();
    const y = Math.random() * 512;
    ctx.moveTo(Math.random() * 512, y);
    ctx.bezierCurveTo(Math.random() * 512, y + 6, Math.random() * 512, y - 6, Math.random() * 512, y + Math.random() * 10);
    ctx.stroke();
  }
  const bump = new THREE.CanvasTexture(c);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(3, 3);
  return new THREE.MeshPhysicalMaterial({
    color: '#d99b7c',
    roughness: 0.5,
    metalness: 0,
    bumpMap: bump,
    bumpScale: 0.35,
    sheen: 0.7,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#ff9a7a'),
    clearcoat: 0.12,
    clearcoatRoughness: 0.6,
    envMapIntensity: 0.6,
  });
}

/*
 * Joint flexion in radians, applied about each bone's local X axis
 * (WebXR joints point down -Z; bending toward the palm is a negative X turn).
 * Fingers: [proximal, intermediate, distal]; thumb: [metacarpal, proximal, distal].
 */
export const GRIP = {
  // The thumb is aimed at the index fingertip (a pinch) after its own small bend.
  thumb: { flex: [0.1, 0.25, 0.35], spread: 0, pinch: 0.013 },
  index: { flex: [0.75, 0.95, 0.4], spread: 0.04 },
  middle: { flex: [0.8, 0.85, 0.35], spread: 0.02 },
  ring: { flex: [1.2, 1.35, 0.8], spread: -0.02 },
  pinky: { flex: [1.3, 1.35, 0.85], spread: -0.08 },
};

// Full chains (the hand's joints are siblings, so bending is done here by
// forward kinematics: each bend rotates every later joint around the pivot).
const CHAIN = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index: ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring: ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky: ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};

export const RIG = { sign: 1 };
const ORDER = ['index', 'middle', 'ring', 'pinky', 'thumb'];

function restOf(hand) {
  if (hand.rest) return hand.rest;
  const rest = {};
  for (const [name, b] of Object.entries(hand.bones)) rest[name] = { p: b.position.clone(), q: b.quaternion.clone() };
  // Palm normal (armature space): perpendicular to the plane through the wrist and knuckles.
  const w = rest['wrist'].p;
  const i = rest['index-finger-phalanx-proximal'].p.clone().sub(w);
  const k = rest['pinky-finger-phalanx-proximal'].p.clone().sub(w);
  rest.palm = new THREE.Vector3().crossVectors(i, k).normalize();
  hand.rest = rest;
  return rest;
}

function rotateFrom(pos, quat, i, R) {
  for (let j = i + 1; j < pos.length; j++) pos[j].sub(pos[i]).applyQuaternion(R).add(pos[i]);
  for (let j = i; j < pos.length; j++) quat[j].premultiply(R);
}

/** Planar CCD: bend joints (about the finger's hinge axis) so the tip reaches target. */
function reach(pos, quat, joints, axis, target, flex, limits) {
  const last = pos.length - 1;
  for (let it = 0; it < 14; it++) {
    for (let s = joints.length - 1; s >= 0; s--) {
      const i = joints[s];
      const v1 = pos[last].clone().sub(pos[i]).projectOnPlane(axis);
      const v2 = target.clone().sub(pos[i]).projectOnPlane(axis);
      if (v1.lengthSq() < 1e-12 || v2.lengthSq() < 1e-12) continue;
      let ang = Math.atan2(axis.dot(new THREE.Vector3().crossVectors(v1, v2)), v1.dot(v2));
      const next = THREE.MathUtils.clamp(flex[s] + ang, limits[0], limits[1]);
      ang = next - flex[s];
      flex[s] = next;
      rotateFrom(pos, quat, i, new THREE.Quaternion().setFromAxisAngle(axis, ang));
    }
  }
}

/** Pose the hand into the dart grip. k blends from rest (0) to the full grip (1). */
export function poseHand(hand, pose = GRIP, k = 1, rig = RIG) {
  const rest = restOf(hand);
  const S = rig.sign;
  const chains = {};
  for (const finger of ORDER) {
    const chain = CHAIN[finger];
    const p = pose[finger];
    const pos = chain.map((n) => rest[n].p.clone());
    const quat = chain.map((n) => rest[n].q.clone());
    const first = finger === 'thumb' ? 0 : 1;
    if (p.spread) rotateFrom(pos, quat, first, new THREE.Quaternion().setFromAxisAngle(rest.palm, p.spread * k));
    const dir = pos[first + 1].clone().sub(pos[first]).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, rest.palm).normalize().multiplyScalar(S);
    const flex = p.flex.map((f) => f * k);
    flex.forEach((f, s) => rotateFrom(pos, quat, first + s, new THREE.Quaternion().setFromAxisAngle(axis, f)));
    chains[finger] = { chain, pos, quat, axis, flex, first };
  }

  // Pinch: thumb pad and index fingertip meet on either side of the barrel.
  const I = chains.index;
  const T = chains.thumb;
  if (pose.thumb.pinch && k > 0) {
    const iTip = I.pos[I.pos.length - 1];
    const tTip = T.pos[T.pos.length - 1];
    const grip = iTip.clone().lerp(tTip, 0.5);
    const across = iTip.clone().sub(tTip).normalize();
    const gap = pose.thumb.pinch / 2;
    // Thumb: swing from its base toward its side of the barrel, then bend to touch.
    const tTarget = grip.clone().addScaledVector(across, -gap);
    const R = new THREE.Quaternion().setFromUnitVectors(tTip.clone().sub(T.pos[0]).normalize(), tTarget.clone().sub(T.pos[0]).normalize());
    rotateFrom(T.pos, T.quat, 0, R);
    T.axis.applyQuaternion(R);
    reach(T.pos, T.quat, [1, 2], T.axis, tTarget, T.flex.slice(1), [-0.3, 1.2]);
    // Index: bend so its tip lands on the other side of the barrel.
    const iTarget = T.pos[T.pos.length - 1].clone().addScaledVector(across, pose.thumb.pinch);
    reach(I.pos, I.quat, [1, 2, 3], I.axis, iTarget, I.flex, [0, 1.6]);
    hand.grip = I.pos[I.pos.length - 1].clone().lerp(T.pos[T.pos.length - 1], 0.5);
  }

  for (const f of ORDER) {
    const c = chains[f];
    c.chain.forEach((n, j) => {
      hand.bones[n].position.copy(c.pos[j]);
      hand.bones[n].quaternion.copy(c.quat[j]);
    });
  }
  // Palm side: where the curled fingers point.
  const kn = rest['index-finger-phalanx-proximal'].p;
  hand.palmSide = rest.palm.clone();
  if (I.pos[I.pos.length - 1].clone().sub(kn).dot(rest.palm) < 0) hand.palmSide.negate();
  hand.root.updateMatrixWorld(true);
}

/** World positions of a few landmarks, for placing the dart in the grip. */
export function landmarks(hand) {
  const w = (n) => hand.bones[n].getWorldPosition(new THREE.Vector3());
  return {
    wrist: w('wrist'),
    thumbTip: w('thumb-tip'),
    indexTip: w('index-finger-tip'),
    indexMid: w('index-finger-phalanx-distal'),
    middleTip: w('middle-finger-tip'),
    indexBase: w('index-finger-phalanx-proximal'),
    pinkyBase: w('pinky-finger-phalanx-proximal'),
  };
}
