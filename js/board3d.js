// BULLSEYE — real-time 3D dartboard (three.js / WebGL).
// Physically based board with sisal fibre, chrome spider and numbers, a pro
// surround with an LED ring, spotlit wall with light beams, 3D darts with
// shadows, bloom and filmic tone mapping. Same API as the SVG Board.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SECTORS, R, scoreAt } from './engine.js';
import { BOARD_SKINS } from './board.js';

const U = 0.01; // world units per millimetre
const BOARD_R = 2.26; // sisal face radius (226mm)
const HOST_HALF = 2.42; // the square host maps to ±HOST_HALF at the board plane
const OVERSCAN = 1.4; // the canvas is this much larger than the host square
const DEG = Math.PI / 180;

const SCENES = {
  championship: { wall: 'panels', a: '#222c42', b: '#0c111c', led: '#ffcf86', led2: '#ffcf86', ledI: 2.4, key: '#fff0d8', fill: '#7a9cff', amb: 0.22, bloom: 0.6, surround: '#141619', beam: 0.07, exposure: 1.05 },
  neon: { wall: 'grid', a: '#1a0d3a', b: '#06021a', led: '#ff2e88', led2: '#18d8ff', ledI: 2.4, key: '#ffe6f6', fill: '#3fe2ff', amb: 0.14, bloom: 0.8, surround: '#0c0822', beam: 0.11, exposure: 1.05 },
  tavern: { wall: 'brick', a: '#6b3520', b: '#2a140b', led: '#ffb15a', led2: '#ffb15a', ledI: 1.5, key: '#ffd09a', fill: '#ff9248', amb: 0.2, bloom: 0.5, surround: '#1c130c', beam: 0.1, exposure: 1.08 },
  daylight: { wall: 'plaster', a: '#e9edf0', b: '#cfd6db', led: '#ffffff', led2: '#ffffff', ledI: 1.1, key: '#ffffff', fill: '#e3f0ff', amb: 0.9, bloom: 0.12, surround: '#2b2f34', beam: 0, exposure: 1.0 },
  blaze: { wall: 'carbon', a: '#1a222b', b: '#080b0f', led: '#ff6a2b', led2: '#2fb3ff', ledI: 2.8, key: '#ffe8da', fill: '#4fb8ff', amb: 0.18, bloom: 0.75, surround: '#0e1217', beam: 0.08, exposure: 1.05 },
  candy: { wall: 'dots', a: '#5f2c93', b: '#2c0f4d', led: '#ff7ac8', led2: '#5ef2d0', ledI: 2.8, key: '#ffe6f7', fill: '#a68bff', amb: 0.34, bloom: 0.8, surround: '#2b1342', beam: 0.09, exposure: 1.05 },
};

export function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

const coarse = () => matchMedia?.('(pointer: coarse)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function canvasTex(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ───────────── textures ───────────── */

function drawFace(ctx, S, skin) {
  const c = S / 2;
  const k = (S / 2) / (BOARD_R / U); // px per mm
  const arc = (r0, r1, a0, a1, fill) => {
    ctx.beginPath();
    ctx.arc(c, c, r1 * k, a0, a1);
    ctx.arc(c, c, r0 * k, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  ctx.fillStyle = skin.ring;
  ctx.fillRect(0, 0, S, S);
  SECTORS.forEach((v, i) => {
    const a0 = (-90 + i * 18 - 9) * DEG;
    const a1 = a0 + 18 * DEG;
    const even = i % 2 === 0;
    const single = even ? skin.dark : skin.light;
    const ring = even ? skin.red : skin.green;
    arc(R.outerBull, R.trebleIn, a0, a1, single);
    arc(R.trebleIn, R.trebleOut, a0, a1, ring);
    arc(R.trebleOut, R.doubleIn, a0, a1, single);
    arc(R.doubleIn, R.doubleOut, a0, a1, ring);
  });
  arc(R.bull, R.outerBull, 0, Math.PI * 2, skin.green);
  arc(0, R.bull, 0, Math.PI * 2, skin.red);

  // Sisal: compressed fibres, mostly radial, with fine grain.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, BOARD_R / U * k, 0, Math.PI * 2);
  ctx.clip();
  const n = S > 1500 ? 52000 : 26000;
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(Math.random()) * (S / 2);
    const a = Math.random() * Math.PI * 2;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const len = 2 + Math.random() * 5 * (S / 2048);
    const da = a + (Math.random() - 0.5) * 0.9;
    ctx.strokeStyle = Math.random() < 0.5 ? `rgba(0,0,0,${0.05 + Math.random() * 0.12})` : `rgba(255,255,255,${0.015 + Math.random() * 0.035})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(da) * len, y + Math.sin(da) * len);
    ctx.stroke();
  }
  // Wire contact shadows (ambient occlusion under the spider)
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 3 * (S / 2048);
  [R.bull, R.outerBull, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut].forEach((r) => {
    ctx.beginPath();
    ctx.arc(c + 1.5, c + 2, r * k, 0, Math.PI * 2);
    ctx.stroke();
  });
  for (let i = 0; i < 20; i++) {
    const a = (-90 + i * 18 - 9) * DEG;
    ctx.beginPath();
    ctx.moveTo(c + 1.5 + Math.cos(a) * R.outerBull * k, c + 2 + Math.sin(a) * R.outerBull * k);
    ctx.lineTo(c + 1.5 + Math.cos(a) * R.doubleOut * k, c + 2 + Math.sin(a) * R.doubleOut * k);
    ctx.stroke();
  }
  // Soft wear toward the treble 20 and bull, like a well-used board.
  const wear = ctx.createRadialGradient(c, c - 102 * k, 0, c, c - 102 * k, 40 * k);
  wear.addColorStop(0, 'rgba(255,255,255,.05)');
  wear.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();
}

function drawBump(ctx, S) {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 120;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

function drawNumbers(ctx, S) {
  const c = S / 2;
  const k = (S / 2) / (BOARD_R / U);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(27 * k)}px "Big Shoulders Display", "Rubik", Impact, sans-serif`;
  SECTORS.forEach((v, i) => {
    const a = (-90 + i * 18) * DEG;
    const r = 197 * k;
    ctx.save();
    ctx.translate(c + Math.cos(a) * r, c + Math.sin(a) * r);
    ctx.fillText(String(v), 0, 0);
    ctx.restore();
  });
  // Outer numbers wire ring
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.2 * k;
  ctx.beginPath();
  ctx.arc(c, c, 219 * k, 0, Math.PI * 2);
  ctx.stroke();
}

function noise(ctx, w, h, amt, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    d[i + 3] = d[i + 3] * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

function drawWall(ctx, S, sc) {
  const { a, b } = sc;
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, S, S);
  switch (sc.wall) {
    case 'panels': {
      const w = S / 8;
      for (let i = 0; i < 8; i++) {
        const g = ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
        g.addColorStop(0, b);
        g.addColorStop(0.15, a);
        g.addColorStop(0.85, a);
        g.addColorStop(1, b);
        ctx.fillStyle = g;
        ctx.fillRect(i * w + 3, 0, w - 6, S);
      }
      noise(ctx, S, S, 18);
      break;
    }
    case 'grid': {
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, S, S);
      noise(ctx, S, S, 10);
      ctx.strokeStyle = a;
      ctx.lineWidth = 3;
      for (let i = 0; i <= 8; i++) {
        ctx.beginPath();
        ctx.moveTo(i * (S / 8), 0);
        ctx.lineTo(i * (S / 8), S);
        ctx.moveTo(0, i * (S / 8));
        ctx.lineTo(S, i * (S / 8));
        ctx.stroke();
      }
      break;
    }
    case 'brick': {
      const bh = S / 16;
      const bw = S / 4;
      for (let row = 0; row < 16; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < 5; col++) {
          const shade = Math.random() * 0.35;
          ctx.fillStyle = a;
          ctx.globalAlpha = 1 - shade;
          ctx.fillRect(col * bw + off + 4, row * bh + 4, bw - 8, bh - 8);
        }
      }
      ctx.globalAlpha = 1;
      noise(ctx, S, S, 40);
      break;
    }
    case 'plaster': {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, S, S);
      noise(ctx, S, S, 14);
      break;
    }
    case 'carbon': {
      const t = S / 32;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const g = (x + y) % 2 ? ctx.createLinearGradient(x * t, 0, x * t + t, 0) : ctx.createLinearGradient(0, y * t, 0, y * t + t);
          g.addColorStop(0, b);
          g.addColorStop(0.5, a);
          g.addColorStop(1, b);
          ctx.fillStyle = g;
          ctx.fillRect(x * t, y * t, t, t);
        }
      break;
    }
    case 'dots': {
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = a;
      const step = S / 10;
      for (let y = 0; y < 11; y++)
        for (let x = 0; x < 11; x++) {
          ctx.beginPath();
          ctx.arc(x * step + (y % 2 ? step / 2 : 0), y * step, step * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
      noise(ctx, S, S, 10);
      break;
    }
  }
}

function drawFlight(ctx, w, h, color) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, shade(color, 40));
  g.addColorStop(0.5, color);
  g.addColorStop(1, shade(color, -70));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.75)';
  ctx.lineWidth = w * 0.05;
  ctx.beginPath();
  ctx.moveTo(w * 0.15, h * 0.9);
  ctx.lineTo(w * 0.6, h * 0.45);
  ctx.lineTo(w * 0.15, h * 0.1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = w * 0.02;
  ctx.strokeRect(0, 0, w, h);
}

function shade(hex, amt) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const c = (v) => clamp(v + amt, 0, 255);
  return `#${((1 << 24) | (c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).slice(1)}`;
}

/* ───────────── geometry helpers ───────────── */

/** Bed under a dart, as a RingGeometry in world space (y up). */
function bedGeometry(dart) {
  if (!dart || !dart.value) return null;
  if (dart.value === 25) {
    return dart.mult === 2 ? new THREE.CircleGeometry(R.bull * U, 48) : new THREE.RingGeometry(R.bull * U, R.outerBull * U, 64);
  }
  const idx = SECTORS.indexOf(dart.value);
  const start = (90 - idx * 18 - 9) * DEG;
  const len = 18 * DEG;
  let r0;
  let r1;
  if (dart.mult === 3) [r0, r1] = [R.trebleIn, R.trebleOut];
  else if (dart.mult === 2) [r0, r1] = [R.doubleIn, R.doubleOut];
  else {
    const r = dart.x != null ? Math.hypot(dart.x, dart.y) : 130;
    [r0, r1] = r > R.trebleOut ? [R.trebleOut, R.doubleIn] : [R.outerBull, R.trebleIn];
  }
  return new THREE.RingGeometry(r0 * U, r1 * U, 24, 1, start, len);
}

function sectorGeometry(value) {
  if (value === 25) return new THREE.CircleGeometry(R.outerBull * U * 1.08, 48);
  const idx = SECTORS.indexOf(value);
  return new THREE.RingGeometry(R.outerBull * U, R.doubleOut * U, 24, 1, (90 - idx * 18 - 9) * DEG, 18 * DEG);
}

/* ───────────── the dart model ───────────── */

const flightCache = new Map();

function buildDart(color) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#d7dde3', metalness: 1, roughness: 0.18 });
  const tungsten = new THREE.MeshStandardMaterial({ color: '#8d959e', metalness: 1, roughness: 0.32 });
  const shaftMat = new THREE.MeshStandardMaterial({ color: shade(color, -60), metalness: 0.85, roughness: 0.28 });

  // Point (tip at y=0, body toward +y)
  const point = new THREE.LatheGeometry(
    [new THREE.Vector2(0, 0), new THREE.Vector2(0.0045, 0.02), new THREE.Vector2(0.0105, 0.07), new THREE.Vector2(0.0115, 0.3)],
    12,
  );
  g.add(new THREE.Mesh(point, steel));

  // Knurled tungsten barrel
  const prof = [new THREE.Vector2(0.0115, 0.3), new THREE.Vector2(0.028, 0.34)];
  for (let y = 0.36; y < 0.76; y += 0.032) {
    prof.push(new THREE.Vector2(0.034, y), new THREE.Vector2(0.034, y + 0.02), new THREE.Vector2(0.03, y + 0.026));
  }
  prof.push(new THREE.Vector2(0.032, 0.78), new THREE.Vector2(0.018, 0.82), new THREE.Vector2(0.012, 0.83));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 24), tungsten));

  // Shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.0125, 0.42, 12), shaftMat);
  shaft.position.y = 1.04;
  g.add(shaft);

  // Flights (standard shape, four wings)
  if (!flightCache.has(color)) {
    flightCache.set(
      color,
      new THREE.MeshPhysicalMaterial({
        map: canvasTex(128, 256, (ctx, w, h) => drawFlight(ctx, w, h, color)),
        roughness: 0.35,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.08,
      }),
    );
  }
  const shape = new THREE.Shape();
  shape.moveTo(0.012, 1.1);
  shape.lineTo(0.17, 1.34);
  shape.quadraticCurveTo(0.19, 1.4, 0.17, 1.5);
  shape.lineTo(0.012, 1.5);
  shape.closePath();
  const fg = new THREE.ShapeGeometry(shape);
  const pos = fg.attributes.position;
  const uv = fg.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 0.19, (pos.getY(i) - 1.1) / 0.4);
  const flights = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(fg, flightCache.get(color));
    m.rotation.y = k * (Math.PI / 2) + Math.PI / 4;
    flights.add(m);
  }
  g.add(flights);
  g.userData.flights = flights;
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

/* ───────────── Board3D ───────────── */

export class Board3D {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = { interactive: true, skin: 'championship', cinematic: false, ...opts };
    this.darts = [];
    this.anims = [];
    this.disposables = [];
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.shake = 0;
    this.clock = new THREE.Clock();
    this.visible = true;
    this.is3D = true;
    host.classList.add('board3d');

    this.overlay = document.createElement('div');
    this.overlay.className = 'b3d-overlay';
    host.appendChild(this.overlay);

    this.initRenderer();
    this.buildScene();
    this.setSkin(this.opts.skin);
    if (this.opts.interactive) this.bindInput();
    this.observe();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    document.fonts?.ready?.then(() => !this.dead && this.paintNumbers());
  }

  initRenderer() {
    const mobile = coarse();
    const r = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.6 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    this.canvas = r.domElement;
    this.canvas.className = 'b3d-canvas';
    this.host.prepend(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);

    const pmrem = new THREE.PMREMGenerator(r);
    this.envTex = pmrem.fromScene(new RoomEnvironment(r), 0.04).texture;
    this.scene.environment = this.envTex;
    pmrem.dispose();

    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.mobile = mobile;
  }

  buildScene() {
    const s = this.scene;
    const faceSize = this.mobile ? 1536 : 2048;

    // Wall
    this.wallMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, envMapIntensity: 0.12 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), this.wallMat);
    wall.position.z = -0.75;
    wall.receiveShadow = true;
    s.add(wall);

    // Board body (metal band) and sisal face
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(BOARD_R + 0.015, BOARD_R + 0.015, 0.38, 128, 1, true),
      new THREE.MeshStandardMaterial({ color: '#16181b', metalness: 0.7, roughness: 0.4, envMapIntensity: 0.5 }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.z = -0.19;
    band.castShadow = true;
    s.add(band);

    this.faceTex = canvasTex(faceSize, faceSize, () => {});
    this.bumpTex = canvasTex(1024, 1024, (ctx, w) => drawBump(ctx, w), { srgb: false, repeat: true });
    this.bumpTex.repeat.set(2, 2);
    this.faceMat = new THREE.MeshStandardMaterial({
      map: this.faceTex,
      bumpMap: this.bumpTex,
      bumpScale: 1.4,
      roughness: 0.93,
      metalness: 0,
      envMapIntensity: 0.08,
    });
    const face = new THREE.Mesh(new THREE.CircleGeometry(BOARD_R, 160), this.faceMat);
    face.receiveShadow = true;
    s.add(face);

    // Chrome numbers + outer wire, as a metal decal
    this.numTex = canvasTex(faceSize, faceSize, () => {}, { srgb: false });
    this.numMat = new THREE.MeshStandardMaterial({ color: '#e9e9e9', metalness: 1, roughness: 0.22, alphaMap: this.numTex, transparent: true, depthWrite: false });
    const nums = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_R * 2, BOARD_R * 2), this.numMat);
    nums.position.z = 0.006;
    s.add(nums);
    this.paintNumbers();

    // Spider (raised round wires)
    this.wireMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', metalness: 1, roughness: 0.32, envMapIntensity: 0.7 });
    const spider = new THREE.Group();
    [R.bull, R.outerBull, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut].forEach((r) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r * U, 0.0062, 8, Math.max(48, Math.round(r * 1.2))), this.wireMat);
      t.position.z = 0.004;
      t.castShadow = true;
      spider.add(t);
    });
    const len = (R.doubleOut + 6 - R.outerBull) * U;
    const wireGeo = new THREE.CylinderGeometry(0.0052, 0.0052, len, 6);
    for (let i = 0; i < 20; i++) {
      const a = (90 - i * 18 - 9) * DEG;
      const m = new THREE.Mesh(wireGeo, this.wireMat);
      const mid = (R.outerBull * U + len / 2);
      m.position.set(Math.cos(a) * mid, Math.sin(a) * mid, 0.004);
      m.rotation.z = a - Math.PI / 2;
      m.castShadow = true;
      spider.add(m);
    }
    s.add(spider);

    // Pro surround + LED ring
    const prof = [
      [BOARD_R + 0.02, -0.5], [BOARD_R + 0.02, 0.04], [BOARD_R + 0.08, 0.12], [3.0, 0.12], [3.1, 0.06], [3.12, -0.5],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    this.surroundMat = new THREE.MeshStandardMaterial({ color: '#141619', roughness: 0.5, metalness: 0.1, envMapIntensity: 0.35, side: THREE.DoubleSide });
    const surround = new THREE.Mesh(new THREE.LatheGeometry(prof, 160), this.surroundMat);
    surround.rotation.x = Math.PI / 2;
    surround.receiveShadow = true;
    surround.castShadow = true;
    s.add(surround);

    this.ledTex = canvasTex(512, 4, () => {});
    this.ledMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff', emissiveMap: this.ledTex, emissiveIntensity: 2.5 });
    const led = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.032, 12, 220), this.ledMat);
    led.position.z = 0.13;
    s.add(led);
    this.led = led;

    // Lights
    this.hemi = new THREE.HemisphereLight('#ffffff', '#000000', 0.25);
    s.add(this.hemi);

    this.key = new THREE.SpotLight('#ffffff', 2.0, 0, 0.42, 0.75, 0);
    this.key.position.set(4.2, 7.5, 7.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.015;
    this.key.shadow.radius = 3;
    this.key.shadow.camera.near = 4;
    this.key.shadow.camera.far = 20;
    s.add(this.key, this.key.target);

    this.rim = new THREE.SpotLight('#88aaff', 0.9, 0, 0.5, 0.8, 0);
    this.rim.position.set(-6, 6, 5);
    s.add(this.rim, this.rim.target);

    this.ledLight = new THREE.PointLight('#ffffff', 0.6, 0, 0);
    this.ledLight.position.set(0, 0, 1.6);
    s.add(this.ledLight);

    // Volumetric beams
    this.beams = [this.key, this.rim].map((light) => {
      const from = light.position.clone();
      const to = new THREE.Vector3(0, 0, -0.2);
      const h = from.distanceTo(to);
      const geo = new THREE.ConeGeometry(Math.tan(light.angle) * h * 0.85, h, 48, 1, true);
      geo.translate(0, -h / 2, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        alphaMap: canvasTex(4, 256, (ctx, w, hh) => {
          const g = ctx.createLinearGradient(0, 0, 0, hh);
          g.addColorStop(0, '#fff');
          g.addColorStop(0.55, '#555');
          g.addColorStop(1, '#000');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, hh);
        }, { srgb: false }),
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const cone = new THREE.Mesh(geo, mat);
      cone.position.copy(from);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      s.add(cone);
      return cone;
    });

    // Dust motes drifting through the light
    const N = this.mobile ? 220 : 420;
    const dp = new Float32Array(N * 3);
    this.dustVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      dp[i * 3] = (Math.random() - 0.5) * 9;
      dp[i * 3 + 1] = (Math.random() - 0.5) * 9;
      dp[i * 3 + 2] = Math.random() * 5;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.02;
      this.dustVel[i * 3 + 1] = -0.01 - Math.random() * 0.02;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    const dot = canvasTex(64, 64, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    });
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.035, map: dot, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.add(this.dust);

    // Interaction layers
    this.hoverMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    this.hover = new THREE.Mesh(new THREE.BufferGeometry(), this.hoverMat);
    this.hover.position.z = 0.003;
    this.hover.visible = false;
    s.add(this.hover);

    this.targetMat = new THREE.MeshBasicMaterial({ color: '#f5c46b', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
    this.targets = new THREE.Group();
    this.targets.position.z = 0.002;
    s.add(this.targets);

    this.dartGroup = new THREE.Group();
    s.add(this.dartGroup);
    this.fx = new THREE.Group();
    s.add(this.fx);

    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.ray = new THREE.Raycaster();
  }

  paintNumbers() {
    const img = this.numTex.image;
    drawNumbers(img.getContext('2d'), img.width);
    this.numTex.needsUpdate = true;
  }

  setSkin(name) {
    const skin = BOARD_SKINS[name] ?? BOARD_SKINS.championship;
    const sc = SCENES[name] ?? SCENES.championship;
    this.skinName = name;
    const fimg = this.faceTex.image;
    drawFace(fimg.getContext('2d'), fimg.width, skin);
    this.faceTex.needsUpdate = true;

    if (this.wallTex) this.wallTex.dispose();
    this.wallTex = canvasTex(1024, 1024, (ctx, w) => drawWall(ctx, w, sc), { repeat: true });
    this.wallTex.repeat.set(5, 5);
    this.wallMat.map = this.wallTex;
    this.wallMat.emissive = new THREE.Color(sc.wall === 'grid' ? sc.led2 : '#000000');
    this.wallMat.emissiveMap = sc.wall === 'grid' ? this.wallTex : null;
    this.wallMat.emissiveIntensity = sc.wall === 'grid' ? 0.35 : 0;
    this.wallMat.needsUpdate = true;

    const limg = this.ledTex.image;
    const lctx = limg.getContext('2d');
    const g = lctx.createLinearGradient(0, 0, limg.width, 0);
    g.addColorStop(0, sc.led);
    g.addColorStop(0.5, sc.led2);
    g.addColorStop(1, sc.led);
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, limg.width, limg.height);
    this.ledTex.needsUpdate = true;
    this.ledMat.emissiveIntensity = sc.ledI;
    this.ledLight.color.set(sc.led);
    this.ledLight.intensity = sc.ledI * 0.1;

    this.surroundMat.color.set(sc.surround).multiplyScalar(0.55);
    this.wireMat.color.set(skin.wire[0]);
    this.numMat.color.set(skin.numbers[0]);
    this.key.color.set(sc.key);
    this.rim.color.set(sc.fill);
    this.hemi.color.set(sc.fill);
    this.hemi.intensity = sc.amb * 0.8;
    this.beams.forEach((b, i) => {
      b.material.opacity = sc.beam * (i ? 0.7 : 1);
      b.material.color.set(i ? sc.fill : sc.key);
      b.visible = sc.beam > 0;
    });
    this.bloom.strength = sc.bloom * 1.1;
    this.renderer.toneMappingExposure = sc.exposure * 0.9;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || sc.led;
    this.targetMat.color.set(accent);
    this.dust.material.color.set(sc.key);
    this.sc = sc;
  }

  setQuality() {}

  /* ── sizing & loop ── */
  observe() {
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
    this.io = new IntersectionObserver(([e]) => (this.visible = e.isIntersecting));
    this.io.observe(this.host);
    this.resize();
  }

  resize() {
    const w = this.host.clientWidth;
    if (!w) return;
    const size = Math.round(w * OVERSCAN);
    this.size = size;
    this.renderer.setSize(size, size, false);
    this.composer.setSize(size, size);
    this.canvas.style.width = `${OVERSCAN * 100}%`;
    this.canvas.style.height = `${OVERSCAN * 100}%`;
  }

  cameraPose(t) {
    const cam = this.camera;
    const half = HOST_HALF * OVERSCAN;
    const dist = half / Math.tan((cam.fov / 2) * DEG);
    let pos;
    let look = new THREE.Vector3(0, 0, 0);
    if (this.opts.cinematic) {
      const a = Math.sin(t * 0.18) * 0.32 - 0.12;
      const d = dist * 1.18;
      pos = new THREE.Vector3(Math.sin(a) * d, -0.9 + Math.sin(t * 0.23) * 0.5, Math.cos(a) * d);
      look = new THREE.Vector3(0, -0.1, 0);
    } else {
      // Fly-in on first frames, then settle into the throwing view.
      const intro = easeOut(clamp(t / 1.4, 0, 1));
      this.introK = intro;
      this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.06;
      this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.06;
      pos = new THREE.Vector3(1.3 + this.pointer.x * 0.3 + (1 - intro) * 6, -1.25 + this.pointer.y * 0.22 - (1 - intro) * 4, dist + (1 - intro) * 9);
    }
    if (this.shake > 0.001) {
      pos.x += (Math.random() - 0.5) * this.shake;
      pos.y += (Math.random() - 0.5) * this.shake;
      this.shake *= 0.86;
    }
    cam.position.copy(pos);
    cam.lookAt(look);
  }

  loop() {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.cameraPose(t);

    // Animations
    const now = performance.now();
    this.anims = this.anims.filter((a) => a(now) !== false);

    // LED breathing + target pulse
    if (this.sc) this.ledMat.emissiveIntensity = this.sc.ledI * (0.92 + Math.sin(t * 1.6) * 0.08);
    this.targetMat.opacity = 0.08 + (Math.sin(t * 3.2) * 0.5 + 0.5) * 0.12;

    // Dust
    const p = this.dust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) + this.dustVel[i * 3] * dt * 8;
      let y = p.getY(i) + this.dustVel[i * 3 + 1] * dt * 8;
      let z = p.getZ(i) + this.dustVel[i * 3 + 2] * dt * 8;
      if (y < -4.5) y = 4.5;
      if (x < -4.5) x = 4.5;
      if (x > 4.5) x = -4.5;
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;

    this.composer.render(dt);
  }

  /* ── input ── */
  toBoard(e) {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hit)) return null;
    return { x: hit.x / U, y: -hit.y / U };
  }

  bindInput() {
    const el = this.host;
    let pressed = null;
    const aim = (e) => {
      if (this.disabled) return this.clearHover();
      const p = this.toBoard(e);
      if (!p) return this.clearHover();
      const dart = scoreAt(p.x, p.y);
      this.showHover(dart, e, e.pointerType !== 'mouse' && pressed != null);
      return dart;
    };
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        const r = el.getBoundingClientRect();
        this.pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
        this.pointer.ty = -((e.clientY - r.top) / r.height - 0.5) * 2;
      }
      if (e.pointerType === 'mouse' || pressed != null) aim(e);
    });
    el.addEventListener('pointerdown', (e) => {
      if (this.disabled) return;
      pressed = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      aim(e);
    });
    el.addEventListener('pointerup', (e) => {
      if (pressed == null || this.disabled) return;
      pressed = null;
      const p = this.toBoard(e);
      if (!p || Math.hypot(p.x, p.y) > 320) return this.clearHover();
      this.opts.onHit?.(scoreAt(p.x, p.y));
      if (e.pointerType !== 'mouse') this.clearHover();
    });
    el.addEventListener('pointercancel', () => {
      pressed = null;
      this.clearHover();
    });
    el.addEventListener('pointerleave', () => {
      this.pointer.tx = this.pointer.ty = 0;
      if (pressed == null) this.clearHover();
    });
  }

  showHover(dart, e, touch) {
    const key = dart.value ? `${dart.label}:${dart.mult === 1 && dart.value !== 25 ? (Math.hypot(dart.x, dart.y) > R.trebleOut ? 'o' : 'i') : ''}` : '';
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.hover.geometry.dispose();
      const g = bedGeometry(dart);
      this.hover.geometry = g ?? new THREE.BufferGeometry();
      this.hover.visible = !!g;
    }
    this.hostEl = this.host;
    if (touch) {
      if (!this.loupe) {
        this.loupe = document.createElement('div');
        this.loupe.className = 'b3d-loupe';
        this.overlay.appendChild(this.loupe);
      }
      const r = this.host.getBoundingClientRect();
      this.loupe.textContent = dart.label;
      this.loupe.style.left = `${e.clientX - r.left}px`;
      this.loupe.style.top = `${e.clientY - r.top - 70}px`;
      this.loupe.hidden = false;
    }
  }

  clearHover() {
    this.hover.visible = false;
    this.hoverKey = null;
    if (this.loupe) this.loupe.hidden = true;
  }

  setDisabled(v) {
    this.disabled = v;
    this.host.classList.toggle('disabled', v);
    if (v) this.clearHover();
  }

  setTargets(values = []) {
    const key = values.join(',');
    if (key === this.targetKey) return;
    this.targetKey = key;
    this.targets.children.forEach((m) => m.geometry.dispose());
    this.targets.clear();
    values.forEach((v) => {
      if (v === 25 || SECTORS.includes(v)) this.targets.add(new THREE.Mesh(sectorGeometry(v), this.targetMat));
    });
  }

  /* ── darts ── */
  project(v) {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    const h = this.host.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * r.width + (r.left - h.left), y: ((1 - p.y) / 2) * r.height + (r.top - h.top) };
  }

  addDart(dart, { animate = true, color = '#f4c46b', index = 0 } = {}) {
    if (dart.x == null) return null;
    const model = buildDart(color);
    const holder = new THREE.Group();
    holder.add(model);
    // Axis points out of the board, flights slightly raised as on a real throw.
    const yaw = ((index - 1) * 5 + (Math.random() * 6 - 3)) * DEG;
    const pitch = (14 + Math.random() * 6) * DEG;
    const dir = new THREE.Vector3(Math.sin(yaw), Math.sin(pitch), 1).normalize();
    const finalQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const tip = new THREE.Vector3(dart.x * U, -dart.y * U, -0.035);
    holder.position.copy(tip);
    holder.quaternion.copy(finalQ);
    this.dartGroup.add(holder);
    const entry = { holder, model, dart };
    this.darts.push(entry);

    if (!animate || document.documentElement.dataset.motion === 'off') return entry;

    const start = new THREE.Vector3(tip.x * 0.4 + 0.8, tip.y * 0.4 - 2.2, 9.5);
    const t0 = performance.now();
    const dur = 300;
    const arc = 1.1;
    const prev = new THREE.Vector3().copy(start);
    holder.visible = false;
    this.anims.push((now) => {
      const k = clamp((now - t0) / dur, 0, 1);
      holder.visible = true;
      const pos = new THREE.Vector3().lerpVectors(start, tip, k);
      pos.y += arc * 4 * k * (1 - k);
      holder.position.copy(pos);
      const vel = pos.clone().sub(prev);
      prev.copy(pos);
      if (k < 1 && vel.lengthSq() > 1e-8) {
        const back = vel.clone().negate().normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), back);
        holder.quaternion.copy(q.slerp(finalQ, k * k));
        model.userData.flights.rotation.y += 0.45;
        return true;
      }
      holder.position.copy(tip);
      holder.quaternion.copy(finalQ);
      this.impact(entry);
      return false;
    });
    return entry;
  }

  impact(entry) {
    const { holder, dart } = entry;
    this.shake = dart.mult >= 2 ? 0.05 : 0.025;
    // Wobble
    const t0 = performance.now();
    const base = holder.quaternion.clone();
    const axis = new THREE.Vector3(1, 0, 0);
    this.anims.push((now) => {
      const k = (now - t0) / 520;
      if (k >= 1) {
        holder.quaternion.copy(base);
        return false;
      }
      const ang = Math.sin(k * Math.PI * 6) * 0.06 * (1 - k);
      holder.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      return true;
    });
    // Sisal dust puff
    const n = 26;
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      pos.set([holder.position.x, holder.position.y, 0.02], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.2) * 0.9, Math.random() * 0.8));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ size: 0.028, color: dart.mult >= 2 ? this.targetMat.color : new THREE.Color('#e8dcc0'), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    this.fx.add(pts);
    const p0 = performance.now();
    this.anims.push((now) => {
      const k = (now - p0) / 600;
      if (k >= 1) {
        this.fx.remove(pts);
        g.dispose();
        m.dispose();
        return false;
      }
      const a = g.attributes.position;
      for (let i = 0; i < n; i++) {
        a.setXYZ(i, a.getX(i) + vel[i].x * 0.016, a.getY(i) + vel[i].y * 0.016 - k * 0.01, a.getZ(i) + vel[i].z * 0.016);
      }
      a.needsUpdate = true;
      m.opacity = 0.9 * (1 - k);
      return true;
    });
    // Bed flash
    const bg = bedGeometry(dart);
    if (bg) {
      const fm = new THREE.MeshBasicMaterial({ color: dart.mult >= 2 ? this.targetMat.color.clone() : new THREE.Color('#ffffff'), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
      const flash = new THREE.Mesh(bg, fm);
      flash.position.z = 0.004;
      this.fx.add(flash);
      const f0 = performance.now();
      this.anims.push((now) => {
        const k = (now - f0) / 650;
        if (k >= 1) {
          this.fx.remove(flash);
          bg.dispose();
          fm.dispose();
          return false;
        }
        fm.opacity = 0.7 * (1 - easeOut(k));
        return true;
      });
    }
    // Floating label
    const at = this.project(holder.position);
    const lab = document.createElement('div');
    lab.className = `b3d-label m${dart.mult}`;
    lab.textContent = dart.label;
    lab.style.left = `${at.x}px`;
    lab.style.top = `${at.y}px`;
    this.overlay.appendChild(lab);
    setTimeout(() => lab.remove(), 1200);
  }

  clearDarts(animate = true) {
    const old = this.darts;
    this.darts = [];
    old.forEach((d, i) => {
      if (!animate) return this.removeDart(d);
      const t0 = performance.now() + i * 70;
      const from = d.holder.position.clone();
      const out = new THREE.Vector3(0, 0, 1).applyQuaternion(d.holder.quaternion).multiplyScalar(1.4);
      this.anims.push((now) => {
        const k = (now - t0) / 320;
        if (k < 0) return true;
        if (k >= 1) {
          this.removeDart(d);
          return false;
        }
        d.holder.position.copy(from).addScaledVector(out, easeOut(k));
        d.holder.scale.setScalar(1 - k * 0.6);
        return true;
      });
    });
  }

  removeDart(d) {
    this.dartGroup.remove(d.holder);
    d.holder.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o.material !== flightCacheGet(o.material)) o.material.dispose?.();
      }
    });
  }

  showDarts(darts, color) {
    this.clearDarts(false);
    darts.forEach((d, i) => this.addDart(d, { animate: false, color, index: i }));
  }

  setHeat() {}

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.darts.forEach((d) => this.removeDart(d));
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => {
        Object.values(m).forEach((v) => v?.isTexture && v.dispose());
        m.dispose();
      });
    });
    this.envTex?.dispose();
    this.composer.dispose?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.overlay.remove();
    this.host.classList.remove('board3d');
  }
}

function flightCacheGet(mat) {
  for (const m of flightCache.values()) if (m === mat) return m;
  return null;
}
