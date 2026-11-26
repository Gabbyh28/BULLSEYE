// BULLSEYE — dart styles: flight artwork and barrel finishes, shared by the
// 3D board (as textures) and the customiser preview (as a 2D drawing).

export const FLIGHTS = ['classic', 'solid', 'stripes', 'checker', 'star', 'flame'];
export const BARRELS = {
  silver: { color: '#8d959e', metalness: 1, roughness: 0.32, css: ['#e6eaee', '#8d959e', '#4a5058'] },
  black: { color: '#1f2226', metalness: 0.7, roughness: 0.38, css: ['#5a6068', '#24272c', '#0c0d0f'] },
  gold: { color: '#d2a24c', metalness: 1, roughness: 0.26, css: ['#fff0bf', '#d2a24c', '#7a5518'] },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function shade(hex, amt) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
  const c = (v) => clamp(v + amt, 0, 255);
  return `#${((1 << 24) | (c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).slice(1)}`;
}

/** Paint one flight's artwork into a w×h canvas (u across the flight, v along the dart). */
export function drawFlight(ctx, w, h, color, pattern = 'classic') {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, shade(color, 40));
  g.addColorStop(0.5, color);
  g.addColorStop(1, shade(color, -70));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  switch (pattern) {
    case 'solid':
      break;
    case 'stripes': {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      const step = h / 7;
      for (let k = -8; k < 16; k += 2) {
        ctx.beginPath();
        ctx.moveTo(0, k * step);
        ctx.lineTo(w, k * step - w * 0.6);
        ctx.lineTo(w, (k + 1) * step - w * 0.6);
        ctx.lineTo(0, (k + 1) * step);
        ctx.fill();
      }
      break;
    }
    case 'checker': {
      const n = 4;
      const cw = w / n;
      ctx.fillStyle = 'rgba(10,12,16,.85)';
      for (let y = 0; y * cw < h; y++) for (let x = 0; x < n; x++) if ((x + y) % 2) ctx.fillRect(x * cw, y * cw, cw, cw);
      break;
    }
    case 'star': {
      const cx = w * 0.55;
      const cy = h * 0.55;
      const R = w * 0.36;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? R * 0.42 : R;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'flame': {
      ctx.fillStyle = '#121317';
      ctx.fillRect(0, 0, w, h);
      const fg = ctx.createLinearGradient(0, h, 0, 0);
      fg.addColorStop(0, '#fff3a0');
      fg.addColorStop(0.35, '#ffb02e');
      fg.addColorStop(0.75, color);
      fg.addColorStop(1, shade(color, -60));
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(0, h);
      const tongues = 4;
      for (let k = 0; k < tongues; k++) {
        const x0 = (k / tongues) * w;
        const x1 = ((k + 1) / tongues) * w;
        const top = h * (0.12 + ((k * 37) % 30) / 100);
        ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.1, h * 0.5, (x0 + x1) / 2, top);
        ctx.quadraticCurveTo(x1 - (x1 - x0) * 0.1, h * 0.55, x1, h * 0.7);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = w * 0.05;
      ctx.beginPath();
      ctx.moveTo(w * 0.15, h * 0.9);
      ctx.lineTo(w * 0.6, h * 0.45);
      ctx.lineTo(w * 0.15, h * 0.1);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = w * 0.02;
  ctx.strokeRect(0, 0, w, h);
}

/** Side view of a whole dart for the customiser (point on the left). */
export function drawDartPreview(canvas, { flight = 'classic', barrel = 'silver', color = '#f5c46b' } = {}) {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const W = canvas.clientWidth || 360;
  const H = canvas.clientHeight || 120;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const k = W / 400;
  const cy = H / 2;
  const X = (v) => v * k;
  // flights: two fins seen edge-on, top and bottom, filled with the artwork
  const art = document.createElement('canvas');
  art.width = 128;
  art.height = 256;
  drawFlight(art.getContext('2d'), 128, 256, color, flight);
  const fin = (dir) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(262), cy);
    ctx.lineTo(X(350), cy + dir * H * 0.4);
    ctx.quadraticCurveTo(X(372), cy + dir * H * 0.47, X(394), cy + dir * H * 0.42);
    ctx.lineTo(X(392), cy);
    ctx.closePath();
    ctx.clip();
    // the artwork runs along the dart: rotate it a quarter turn into the fin
    ctx.translate(X(262), cy);
    ctx.scale(1, -dir);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(art, 0, 0, H * 0.47, X(130));
    ctx.restore();
  };
  fin(-1);
  fin(1);
  // shaft
  const sg = ctx.createLinearGradient(0, cy - 5, 0, cy + 5);
  sg.addColorStop(0, shade(color, 10));
  sg.addColorStop(1, shade(color, -90));
  ctx.fillStyle = sg;
  ctx.fillRect(X(196), cy - 4.5 * k, X(100), 9 * k);
  // barrel with knurled rings
  const b = BARRELS[barrel] ?? BARRELS.silver;
  const bg = ctx.createLinearGradient(0, cy - 14 * k, 0, cy + 14 * k);
  bg.addColorStop(0, b.css[0]);
  bg.addColorStop(0.45, b.css[1]);
  bg.addColorStop(1, b.css[2]);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(X(70), cy - 6 * k);
  ctx.lineTo(X(92), cy - 13 * k);
  ctx.lineTo(X(186), cy - 13 * k);
  ctx.lineTo(X(200), cy - 6 * k);
  ctx.lineTo(X(200), cy + 6 * k);
  ctx.lineTo(X(186), cy + 13 * k);
  ctx.lineTo(X(92), cy + 13 * k);
  ctx.lineTo(X(70), cy + 6 * k);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 1.4 * k;
  for (let x = 100; x < 182; x += 9) {
    ctx.beginPath();
    ctx.moveTo(X(x), cy - 12 * k);
    ctx.lineTo(X(x), cy + 12 * k);
    ctx.stroke();
  }
  // steel point
  const pg = ctx.createLinearGradient(0, cy - 4, 0, cy + 4);
  pg.addColorStop(0, '#f4f7fa');
  pg.addColorStop(1, '#7d858d');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.moveTo(X(8), cy);
  ctx.lineTo(X(70), cy - 4.5 * k);
  ctx.lineTo(X(70), cy + 4.5 * k);
  ctx.closePath();
  ctx.fill();
}
