// BULLSEYE — the dartboard. Hand-built SVG with lighting, sisal texture,
// raised wires, animated darts and a precise hit model.
import { SECTORS, R, scoreAt, sectorIndexAt } from './engine.js';

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

export const BOARD_SKINS = {
  championship: { dark: '#17181b', light: '#efe1c0', red: '#c8253c', green: '#11734f', wire: ['#ffffff', '#9a9a9a'], ring: '#0d0d0f', numbers: ['#fff6dd', '#c9b98f'], rim: ['#d9c08a', '#6d5a32', '#f3dfae'], glow: 0 },
  neon: { dark: '#0d0a26', light: '#1c1550', red: '#ff2e88', green: '#18d8ff', wire: ['#c9fbff', '#4fd8ff'], ring: '#06041a', numbers: ['#ffffff', '#a8f3ff'], rim: ['#ff4fa0', '#3a0b5a', '#4fe3ff'], glow: 1 },
  tavern: { dark: '#1e1510', light: '#e8cf9f', red: '#a42e27', green: '#24603c', wire: ['#ffe2a6', '#9a6b2a'], ring: '#140d08', numbers: ['#ffe9bf', '#b88746'], rim: ['#8a5a2b', '#3b2412', '#c58a4c'], glow: 0 },
  daylight: { dark: '#202326', light: '#f6ecd6', red: '#d23a3a', green: '#16856a', wire: ['#ffffff', '#a3a9ad'], ring: '#16181a', numbers: ['#ffffff', '#cfd6da'], rim: ['#e7ecef', '#8d989e', '#ffffff'], glow: 0 },
  blaze: { dark: '#0c1117', light: '#26313d', red: '#ff6a2b', green: '#2fb3ff', wire: ['#e6eef6', '#6f7f8f'], ring: '#070a0e', numbers: ['#ffffff', '#9fb2c4'], rim: ['#3a4552', '#0b1016', '#8a9aac'], glow: 0.4 },
  candy: { dark: '#3b1d55', light: '#ffe6f5', red: '#ff4fae', green: '#2fd3b4', wire: ['#ffffff', '#f2b8e6'], ring: '#2a1240', numbers: ['#ffffff', '#ffc8ef'], rim: ['#ffb3e6', '#7d3fa8', '#fff0fb'], glow: 0.5 },
};

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

const rad = (deg) => (deg * Math.PI) / 180;
const pt = (r, deg) => [r * Math.cos(rad(deg)), r * Math.sin(rad(deg))];

function sectorPath(r0, r1, a0, a1) {
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`;
}

function ringPath(r0, r1) {
  return `M${r1} 0A${r1} ${r1} 0 1 1 ${-r1} 0A${r1} ${r1} 0 1 1 ${r1} 0ZM${r0} 0A${r0} ${r0} 0 1 0 ${-r0} 0A${r0} ${r0} 0 1 0 ${r0} 0Z`;
}

/** Path for the bed under a given dart (which inner/outer single it is matters). */
export function bedPath(dart) {
  if (!dart || !dart.value) return null;
  if (dart.value === 25) return dart.mult === 2 ? ringPath(0.01, R.bull) : ringPath(R.bull, R.outerBull);
  const idx = SECTORS.indexOf(dart.value);
  const a0 = -90 + idx * 18 - 9;
  const a1 = a0 + 18;
  if (dart.mult === 3) return sectorPath(R.trebleIn, R.trebleOut, a0, a1);
  if (dart.mult === 2) return sectorPath(R.doubleIn, R.doubleOut, a0, a1);
  const r = dart.x != null ? Math.hypot(dart.x, dart.y) : 130;
  return r > R.trebleOut ? sectorPath(R.trebleOut, R.doubleIn, a0, a1) : sectorPath(R.outerBull, R.trebleIn, a0, a1);
}

export class Board {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = { interactive: true, skin: 'championship', quality: 'high', ...opts };
    this.id = `b${++uid}`;
    this.darts = [];
    this.build();
    this.setSkin(this.opts.skin);
    if (this.opts.interactive) this.bindInput();
  }

  build() {
    const id = this.id;
    const svg = el('svg', { viewBox: '-231 -231 462 462', class: 'board-svg', role: 'img' });
    this.svg = svg;
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <radialGradient id="${id}-light" cx="35%" cy="28%" r="80%">
        <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
        <stop offset=".45" stop-color="#fff" stop-opacity=".04"/>
        <stop offset="1" stop-color="#000" stop-opacity=".38"/>
      </radialGradient>
      <radialGradient id="${id}-ring" cx="50%" cy="50%" r="50%">
        <stop offset=".72" stop-color="var(--ring-a)"/>
        <stop offset=".9" stop-color="var(--ring-b)"/>
        <stop offset="1" stop-color="var(--ring-a)"/>
      </radialGradient>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--rim-c)"/>
        <stop offset=".35" stop-color="var(--rim-a)"/>
        <stop offset=".7" stop-color="var(--rim-b)"/>
        <stop offset="1" stop-color="var(--rim-a)"/>
      </linearGradient>
      <linearGradient id="${id}-wire" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--wire-a)"/>
        <stop offset="1" stop-color="var(--wire-b)"/>
      </linearGradient>
      <linearGradient id="${id}-num" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--num-a)"/>
        <stop offset="1" stop-color="var(--num-b)"/>
      </linearGradient>
      <filter id="${id}-sisal" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1 .55" numOctaves="3" seed="7"/>
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.05"/>
      </filter>
      <filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="10"/>
      </filter>
      <filter id="${id}-wireShadow" x="-5%" y="-5%" width="110%" height="110%">
        <feGaussianBlur stdDeviation=".9"/>
      </filter>
      <filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <linearGradient id="${id}-barrel" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#5d6670"/><stop offset=".35" stop-color="#f4f7fa"/>
        <stop offset=".55" stop-color="#aeb7c0"/><stop offset="1" stop-color="#3b434b"/>
      </linearGradient>
      <clipPath id="${id}-face"><circle r="${R.doubleOut + 0.5}"/></clipPath>
    `;

    // Wall shadow + rim
    el('circle', { r: 228, cy: 10, fill: '#000', opacity: 0.55, filter: `url(#${id}-shadow)`, class: 'fx-heavy' }, svg);
    el('circle', { r: 229, fill: `url(#${id}-rim)` }, svg);
    el('circle', { r: 222, fill: `url(#${id}-ring)` }, svg);
    el('circle', { r: 222, fill: 'none', stroke: '#000', 'stroke-opacity': 0.5, 'stroke-width': 1.5 }, svg);

    // Board face
    const face = el('g', { class: 'face' }, svg);
    this.face = face;
    this.beds = [];
    SECTORS.forEach((value, i) => {
      const a0 = -90 + i * 18 - 9;
      const a1 = a0 + 18;
      const even = i % 2 === 0;
      const single = even ? 'var(--b-dark)' : 'var(--b-light)';
      const ring = even ? 'var(--b-red)' : 'var(--b-green)';
      el('path', { d: sectorPath(R.doubleOut, R.doubleOut + 0.01, a0, a1), fill: 'none' }, face);
      el('path', { d: sectorPath(R.outerBull, R.trebleIn, a0, a1), fill: single }, face);
      el('path', { d: sectorPath(R.trebleIn, R.trebleOut, a0, a1), fill: ring, class: 'ring-bed' }, face);
      el('path', { d: sectorPath(R.trebleOut, R.doubleIn, a0, a1), fill: single }, face);
      el('path', { d: sectorPath(R.doubleIn, R.doubleOut, a0, a1), fill: ring, class: 'ring-bed' }, face);
    });
    el('circle', { r: R.outerBull, fill: 'var(--b-green)', class: 'ring-bed' }, face);
    el('circle', { r: R.bull, fill: 'var(--b-red)', class: 'ring-bed' }, face);

    // Heat layer (stats)
    this.heatLayer = el('g', { class: 'heat', 'clip-path': `url(#${id}-face)` }, svg);

    // Sisal texture + lighting
    el('rect', { x: -172, y: -172, width: 344, height: 344, filter: `url(#${id}-sisal)`, 'clip-path': `url(#${id}-face)`, opacity: 0.42, class: 'fx-heavy sisal' }, svg);

    // Wires
    const wires = el('g', { class: 'wires' }, svg);
    const wireSet = (g) => {
      [R.bull, R.outerBull, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut].forEach((r) => el('circle', { r, fill: 'none' }, g));
      for (let i = 0; i < 20; i++) {
        const a = -90 + i * 18 - 9;
        const [x0, y0] = pt(R.outerBull, a);
        const [x1, y1] = pt(R.doubleOut + 6, a);
        el('line', { x1: x0, y1: y0, x2: x1, y2: y1 }, g);
      }
    };
    const shadow = el('g', { transform: 'translate(.9 1.4)', stroke: '#000', 'stroke-opacity': 0.55, 'stroke-width': 1.9, filter: `url(#${id}-wireShadow)`, class: 'fx-heavy' }, wires);
    wireSet(shadow);
    const metal = el('g', { stroke: `url(#${id}-wire)`, 'stroke-width': 1.25, class: 'wire-metal' }, wires);
    wireSet(metal);

    // Numbers
    const nums = el('g', { class: 'numbers' }, svg);
    this.numberEls = {};
    SECTORS.forEach((value, i) => {
      const [x, y] = pt(197, -90 + i * 18);
      const t = el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: `url(#${id}-num)`, class: 'num' }, nums);
      t.textContent = value;
      this.numberEls[value] = t;
    });

    // Lighting overlay
    el('circle', { r: 229, fill: `url(#${id}-light)`, 'pointer-events': 'none', class: 'lighting' }, svg);

    this.targetLayer = el('g', { class: 'targets' }, svg);
    this.hoverPath = el('path', { class: 'hover-bed', d: '' }, svg);
    this.dartLayer = el('g', { class: 'darts' }, svg);
    this.fxLayer = el('g', { class: 'fx' }, svg);
    this.catcher = el('circle', { r: 231, fill: 'transparent', class: 'catcher' }, svg);

    this.host.appendChild(svg);
  }

  setSkin(name) {
    const s = BOARD_SKINS[name] ?? BOARD_SKINS.championship;
    this.skin = s;
    const st = this.svg.style;
    st.setProperty('--b-dark', s.dark);
    st.setProperty('--b-light', s.light);
    st.setProperty('--b-red', s.red);
    st.setProperty('--b-green', s.green);
    st.setProperty('--wire-a', s.wire[0]);
    st.setProperty('--wire-b', s.wire[1]);
    st.setProperty('--ring-a', s.ring);
    st.setProperty('--ring-b', shade(s.ring, 18));
    st.setProperty('--num-a', s.numbers[0]);
    st.setProperty('--num-b', s.numbers[1]);
    st.setProperty('--rim-a', s.rim[0]);
    st.setProperty('--rim-b', s.rim[1]);
    st.setProperty('--rim-c', s.rim[2]);
    this.svg.classList.toggle('glow', s.glow > 0);
    this.svg.style.setProperty('--glow', s.glow);
  }

  destroy() {
    this.svg.remove();
    this.loupe = null;
  }

  setQuality(q) {
    this.svg.classList.toggle('lite', q === 'low');
  }

  /* ── input ── */
  toBoard(evt) {
    const p = this.svg.createSVGPoint();
    p.x = evt.clientX;
    p.y = evt.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return { x: 999, y: 999 };
    const q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }

  bindInput() {
    this.svg.classList.add('interactive');
    let pressed = null;
    const preview = (e) => {
      if (this.disabled) return this.clearHover();
      const { x, y } = this.toBoard(e);
      const dart = scoreAt(x, y);
      this.showHover(dart, x, y, e.pointerType !== 'mouse' && pressed != null);
      this.opts.onAim?.(dart);
      return dart;
    };
    this.catcher.addEventListener('pointerdown', (e) => {
      if (this.disabled) return;
      pressed = e.pointerId;
      this.catcher.setPointerCapture?.(e.pointerId);
      preview(e);
    });
    this.catcher.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || pressed != null) preview(e);
    });
    this.catcher.addEventListener('pointerup', (e) => {
      if (pressed == null || this.disabled) return;
      pressed = null;
      const { x, y } = this.toBoard(e);
      const dart = scoreAt(x, y);
      if (Math.hypot(x, y) > 238) return this.clearHover();
      this.opts.onHit?.(dart);
      if (e.pointerType !== 'mouse') this.clearHover();
    });
    this.catcher.addEventListener('pointercancel', () => {
      pressed = null;
      this.clearHover();
    });
    this.catcher.addEventListener('pointerleave', () => {
      if (pressed == null) this.clearHover();
    });
  }

  showHover(dart, x, y, touch) {
    const d = bedPath(dart);
    this.hoverPath.setAttribute('d', d ?? '');
    this.hoverPath.classList.toggle('on', !!d);
    if (touch) {
      if (!this.loupe) {
        this.loupe = el('g', { class: 'loupe' }, this.fxLayer);
        el('rect', { x: -34, y: -24, width: 68, height: 40, rx: 12 }, this.loupe);
        el('text', { x: 0, y: -3, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, this.loupe);
      }
      const ly = Math.max(-200, y - 62);
      this.loupe.setAttribute('transform', `translate(${Math.max(-200, Math.min(200, x))} ${ly})`);
      this.loupe.querySelector('text').textContent = dart.label;
      this.loupe.style.display = '';
    }
  }

  clearHover() {
    this.hoverPath.classList.remove('on');
    this.hoverPath.setAttribute('d', '');
    if (this.loupe) this.loupe.style.display = 'none';
  }

  setDisabled(v) {
    this.disabled = v;
    this.svg.classList.toggle('disabled', v);
    if (v) this.clearHover();
  }

  /* ── highlights ── */
  setTargets(values = []) {
    this.targetLayer.innerHTML = '';
    Object.values(this.numberEls).forEach((t) => t.classList.remove('target'));
    values.forEach((v) => {
      if (v === 25) {
        el('circle', { r: R.outerBull + 1.5, class: 'target-glow' }, this.targetLayer);
        return;
      }
      const idx = SECTORS.indexOf(v);
      if (idx < 0) return;
      const a0 = -90 + idx * 18 - 9;
      el('path', { d: sectorPath(R.outerBull, R.doubleOut, a0, a0 + 18), class: 'target-glow' }, this.targetLayer);
      this.numberEls[v]?.classList.add('target');
    });
  }

  /* ── darts ── */
  addDart(dart, { animate = true, color = '#f4c46b', index = 0 } = {}) {
    let { x, y } = dart;
    if (x == null) return;
    const outer = el('g', { transform: `translate(${x} ${y})`, class: 'dart' }, this.dartLayer);
    const body = el('g', {}, outer);
    const tilt = 34 + (index - 1) * 9 + (Math.random() * 8 - 4);
    body.innerHTML = dartSVG(this.id, color, tilt);
    this.darts.push(outer);

    if (!animate || this.svg.classList.contains('lite')) return outer;
    // Fly in from the viewer
    const start = performance.now();
    const dur = 210;
    const from = { s: 2.6, dx: 95, dy: -130 };
    const wobble = 520;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      if (t < 1) {
        const k = t * t;
        const s = from.s + (1 - from.s) * k;
        body.setAttribute('transform', `translate(${from.dx * (1 - k)} ${from.dy * (1 - k)}) scale(${s})`);
        body.style.opacity = Math.min(1, t * 3);
        requestAnimationFrame(step);
      } else {
        const tw = Math.min(1, (now - start - dur) / wobble);
        const ang = Math.sin(tw * Math.PI * 5) * 6 * (1 - tw);
        body.setAttribute('transform', `rotate(${ang})`);
        body.style.opacity = 1;
        if (tw === 0) this.impact(x, y, dart);
        if (tw < 1) requestAnimationFrame(step);
        else body.removeAttribute('transform');
      }
    };
    requestAnimationFrame(step);
    return outer;
  }

  impact(x, y, dart) {
    const ring = el('circle', { cx: x, cy: y, r: 2, class: `ripple m${dart.mult}` }, this.fxLayer);
    ring.animate([{ r: 2, opacity: 0.9 }, { r: dart.mult >= 2 ? 34 : 22, opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => ring.remove();
    const tag = el('g', { class: `float-label m${dart.mult}`, transform: `translate(${x} ${y - 24})` }, this.fxLayer);
    const txt = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, tag);
    txt.textContent = dart.value ? (dart.points ? `${dart.label}` : dart.label) : 'MISS';
    tag.animate(
      [
        { transform: `translate(${x}px, ${y - 18}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${x}px, ${y - 34}px) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${x}px, ${y - 52}px) scale(1)`, opacity: 0 },
      ],
      { duration: 1100, easing: 'ease-out' },
    ).onfinish = () => tag.remove();
  }

  clearDarts(animate = true) {
    const old = this.darts;
    this.darts = [];
    old.forEach((d, i) => {
      if (!animate) return d.remove();
      const a = d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: i * 50, fill: 'forwards' });
      a.onfinish = () => d.remove();
    });
  }

  showDarts(darts, color) {
    this.clearDarts(false);
    darts.forEach((d, i) => this.addDart(d, { animate: false, color, index: i }));
  }

  /* ── stats heatmap ── */
  setHeat(points = []) {
    this.heatLayer.innerHTML = '';
    if (!points.length) return;
    const id = this.id;
    if (!this.svg.querySelector(`#${id}-heat`)) {
      const g = el('radialGradient', { id: `${id}-heat` }, this.svg.querySelector('defs'));
      g.innerHTML = `<stop offset="0" stop-color="var(--heat)" stop-opacity=".55"/><stop offset="1" stop-color="var(--heat)" stop-opacity="0"/>`;
    }
    el('circle', { r: R.doubleOut, fill: '#000', opacity: 0.45 }, this.heatLayer);
    const g = el('g', { style: 'mix-blend-mode:screen' }, this.heatLayer);
    points.slice(-900).forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 14, fill: `url(#${id}-heat)` }, g));
    const dots = el('g', {}, this.heatLayer);
    points.slice(-300).forEach(([x, y]) => el('circle', { cx: x, cy: y, r: 1.6, fill: '#fff', opacity: 0.85 }, dots));
  }
}

function dartSVG(id, color, tilt) {
  // Drawn with the tip at (0,0), body trailing toward the viewer (up-right).
  return `
  <g transform="rotate(${tilt})">
    <ellipse cx="2" cy="5" rx="6" ry="2.2" fill="#000" opacity=".45"/>
    <g transform="rotate(-90)">
      <path d="M0 0 L2.2 -1 L16 -1.1 L16 1.1 L2.2 1Z" fill="#cfd5db"/>
      <rect x="16" y="-3.6" width="30" height="7.2" rx="3" fill="url(#${id}-barrel)"/>
      <g stroke="#2a2f35" stroke-width=".7" opacity=".55">
        <line x1="21" y1="-3.4" x2="21" y2="3.4"/><line x1="24" y1="-3.5" x2="24" y2="3.5"/>
        <line x1="27" y1="-3.5" x2="27" y2="3.5"/><line x1="30" y1="-3.5" x2="30" y2="3.5"/>
        <line x1="33" y1="-3.5" x2="33" y2="3.5"/>
      </g>
      <rect x="46" y="-2" width="20" height="4" rx="1.2" fill="#1b1e23"/>
      <rect x="46" y="-2" width="20" height="1.3" rx=".6" fill="#fff" opacity=".18"/>
      <path d="M60 0 L86 -15 Q90 -15 90 -11 L82 0 L90 11 Q90 15 86 15 Z" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>
      <path d="M60 0 L86 -15 Q90 -15 90 -11 L82 0Z" fill="#fff" opacity=".22"/>
      <path d="M62 -1 L88 -2 L88 2 L62 1Z" fill="rgba(0,0,0,.35)"/>
    </g>
  </g>`;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `#${((1 << 24) | (c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).slice(1)}`;
}

export { sectorIndexAt };
