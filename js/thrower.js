// BULLSEYE — the thrower in the winning-dart cinematic: a stylised player in
// their colours whose face is the player's photo (or their emoji). The throwing
// forearm and hand come from board3d (buildRealArm/buildArm); this builds the
// rest of the body around that elbow so the two meet.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const SKIN = '#d99b7c';

/** A tapered cylinder from a to b (radius r0 at a, r1 at b). */
function limb(a, b, r0, r1, mat, seg = 24) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg, 1), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return m;
}

function ball(p, r, mat, scale) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat);
  m.position.copy(p);
  if (scale) m.scale.set(...scale);
  return m;
}

/** What the avatar HTML holds: a photo URL or an emoji. */
export function avatarSource(avatar = '') {
  const src = /<img[^>]+src="([^"]+)"/.exec(avatar)?.[1];
  if (src) return { photo: src };
  const text = String(avatar).replace(/<[^>]*>/g, '').trim();
  return { emoji: text || '🎯' };
}

/**
 * The head's skin, wrapped around the whole head (equirectangular), with the
 * photo or emoji painted where the face is (u = .75 faces the board), feathered
 * into the skin so there is no edge.
 */
function faceTexture(avatar) {
  const S = 512; // the face area is S×S, centred at u = .75 of a 4S × 2S canvas
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S * 2;
  const FX = S * 3 - S / 2;
  const FY = S * 0.34;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const ground = () => {
    ctx.fillStyle = SKIN;
    ctx.fillRect(0, 0, c.width, c.height);
  };
  // fade the edge of the picture into the skin so the face has no hard border
  const feather = () => {
    ctx.save();
    ctx.translate(FX + S / 2, FY + S * 0.52);
    ctx.scale(1, 1.16);
    const g = ctx.createRadialGradient(0, 0, S * 0.3, 0, 0, S * 0.45);
    g.addColorStop(0, 'rgba(217,155,124,0)');
    g.addColorStop(1, SKIN);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const { photo, emoji } = avatarSource(avatar);
  ground();
  if (photo) {
    const img = new Image();
    img.onload = () => {
      ground();
      // the middle of the photo is the face; leave its background out
      const side = Math.min(img.width, img.height) * 0.66;
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) * 0.42, side, side, FX + S * 0.02, FY - S * 0.04, S * 0.96, S * 1.1);
      feather();
      tex.needsUpdate = true;
    };
    img.src = photo;
  } else {
    ctx.font = `${Math.round(S * 0.7)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, FX + S / 2, FY + S * 0.54);
    feather();
  }
  tex.needsUpdate = true;
  return tex;
}

/** The jersey: the player's colour with side panels, a chest crest and their name on the back. */
function jerseyTexture(color, name) {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, color);
  g.addColorStop(1, new THREE.Color(color).multiplyScalar(0.62).getStyle());
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // side panels (u = .25 and .75 are the flanks)
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  [0.25, 0.75].forEach((u) => ctx.fillRect(u * W - 46, 0, 92, H));
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  [0.25, 0.75].forEach((u) => {
    ctx.fillRect(u * W - 50, 0, 6, H);
    ctx.fillRect(u * W + 44, 0, 6, H);
  });
  // chest crest: a small dartboard on the left chest (front is u = .5)
  const cx = 0.5 * W + 70;
  const cy = H * 0.32;
  [[34, '#111'], [28, '#f4efe4'], [20, '#c8253c'], [12, '#f4efe4'], [6, '#11734f']].forEach(([r, f]) => {
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  });
  // name across the back (u = 0, which wraps; draw it on both edges)
  const label = (name || '').toUpperCase().slice(0, 14);
  if (label) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 84px "Big Shoulders Display", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [0, W].forEach((x) => ctx.fillText(label, x, H * 0.3, 420));
  }
  // fabric weave
  ctx.globalAlpha = 0.07;
  for (let y = 0; y < H; y += 3) {
    ctx.fillStyle = y % 6 ? '#000' : '#fff';
    ctx.fillRect(0, y, W, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Build the thrower around the throwing elbow.
 * elbow: world position of the forearm's pivot; returns { group, head, update(t), dispose() }.
 */
export function buildThrower({ elbow, color = '#f5c46b', name = '', avatar = '', skinMat = null }) {
  const group = new THREE.Group();
  const owned = [];
  const mat = (m) => (owned.push(m), m);
  const skin = skinMat ?? mat(new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.55, metalness: 0 }));
  const jersey = mat(new THREE.MeshStandardMaterial({ map: jerseyTexture(color, name), roughness: 0.82, metalness: 0 }));
  const sleeve = mat(new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.8), roughness: 0.85, metalness: 0 }));
  const trousers = mat(new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.75, metalness: 0 }));
  const shoes = mat(new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.35, metalness: 0.2 }));
  const hair = mat(new THREE.MeshStandardMaterial({ color: '#2a1f19', roughness: 0.9, metalness: 0 }));
  const faceTex = faceTexture(avatar);
  const faceMat = mat(
    new THREE.MeshPhysicalMaterial({ map: faceTex, roughness: 0.55, metalness: 0, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ff9a7a') }),
  );

  // Side-on stance: throwing (right) shoulder turned toward the board.
  const turn = 35 * (Math.PI / 180);
  const rot = new THREE.Quaternion().setFromAxisAngle(UP, turn);
  const local = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(rot);
  const S = elbow.clone().add(new THREE.Vector3(0.8, -0.5, 2.8)); // right shoulder
  const hip = S.clone().sub(local(1.75, 4.5, 0)); // hip centre
  const FLOOR = -16;

  // torso: a lathe profile, flattened front to back, wearing the jersey
  const prof = [
    [0.0, -0.2], [1.38, -0.2], [1.45, 0.4], [1.36, 1.6], [1.5, 2.6], [1.78, 3.6], [1.9, 4.35], [1.6, 4.85], [1.0, 5.15], [0.62, 5.3], [0.0, 5.32],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), jersey);
  torso.scale.set(1, 1, 0.64);
  torso.position.copy(hip);
  torso.quaternion.copy(rot);
  group.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.11, 10, 32), mat(new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 0.7 })));
  collar.position.copy(hip).add(local(0, 5.22, 0));
  collar.quaternion.copy(rot).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  collar.scale.set(1, 0.7, 1);
  group.add(collar);

  // neck and head, leaning a little toward the board to sight along the dart
  const neckBase = hip.clone().add(local(0, 5.1, 0));
  const headC = neckBase.clone().add(new THREE.Vector3(0.12, 1.75, -0.55));
  group.add(limb(neckBase, headC.clone().add(new THREE.Vector3(0, -0.8, 0.1)), 0.5, 0.44, skin));
  const head = new THREE.Group();
  head.position.copy(headC);
  group.add(head);
  const R = 1.0;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), faceMat);
  skull.scale.set(0.9, 1.12, 1.0);
  head.add(skull);
  // hair: crown and back, leaving the face clear
  const crown = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 32, 12, 0, Math.PI * 2, 0, 0.55), hair);
  crown.scale.set(0.9, 1.12, 1.0);
  head.add(crown);
  const back = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 32, 16, Math.PI * 0.5 - 2.0, 4.0, 0.3, 1.25), hair);
  back.scale.set(0.9, 1.12, 1.0);
  head.add(back);
  [-1, 1].forEach((sx) => head.add(ball(new THREE.Vector3(sx * 0.86, -0.05, 0.05), 0.2, skin, [0.45, 1, 0.8])));

  // right (throwing) upper arm: shoulder to the forearm's elbow, sleeved
  group.add(ball(S, 0.78, jersey, [1, 0.95, 0.85]));
  group.add(limb(S, elbow, 0.6, 0.44, sleeve));
  group.add(ball(elbow, 0.45, sleeve));

  // left arm hangs relaxed
  const L = hip.clone().add(local(-1.75, 4.5, 0));
  const lElbow = L.clone().add(new THREE.Vector3(-0.35, -2.9, -0.25));
  const lWrist = lElbow.clone().add(new THREE.Vector3(-0.05, -2.7, -0.45));
  group.add(ball(L, 0.78, jersey, [1, 0.95, 0.85]));
  group.add(limb(L, lElbow, 0.62, 0.46, sleeve));
  group.add(ball(lElbow, 0.45, skin));
  group.add(limb(lElbow, lWrist, 0.43, 0.3, skin));
  group.add(ball(lWrist.clone().add(new THREE.Vector3(0, -0.35, 0)), 0.38, skin, [0.8, 1.1, 0.7]));

  // legs in a throwing stance: front foot toward the oche, back foot behind
  const rHip = hip.clone().add(local(0.78, 0, 0));
  const lHip = hip.clone().add(local(-0.78, 0, 0));
  const rFoot = new THREE.Vector3(rHip.x + 0.4, FLOOR + 0.35, rHip.z - 1.6);
  const lFoot = new THREE.Vector3(lHip.x - 0.8, FLOOR + 0.35, lHip.z + 2.1);
  [[rHip, rFoot], [lHip, lFoot]].forEach(([h, f]) => {
    const knee = h.clone().lerp(f, 0.5).add(new THREE.Vector3(0, 0, -0.25));
    group.add(limb(h, knee, 0.78, 0.6, trousers));
    group.add(ball(knee, 0.6, trousers));
    group.add(limb(knee, f, 0.6, 0.48, trousers));
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 2.3), shoes);
    shoe.position.copy(f).add(new THREE.Vector3(0, -0.05, -0.55));
    group.add(shoe);
  });

  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  return {
    group,
    head,
    headCenter: headC.clone(),
    floor: FLOOR,
    /** Idle breathing and a small settle of the head while aiming. */
    update(t) {
      const b = Math.sin(t * 2.2) * 0.012;
      torso.scale.set(1 + b, 1 + b * 0.5, 0.64 + b);
      head.rotation.set(Math.sin(t * 1.3) * 0.02, -0.08 + Math.sin(t * 0.9) * 0.03, 0);
    },
    dispose() {
      group.traverse((o) => o.isMesh && o.geometry.dispose());
      owned.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      faceTex.dispose();
    },
  };
}
