// BULLSEYE — sound (synthesised, no files), caller voice, confetti and callouts.

let ctx = null;
let master = null;
const settings = { sound: true, voice: true, lang: 'en' };

export function configureFx(s) {
  Object.assign(settings, s);
}

function audio() {
  if (!settings.sound) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c, seconds) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(c, { type = 'sine', f0, f1 = f0, t = 0, dur = 0.2, gain = 0.3, attack = 0.005 }) {
  const o = c.createOscillator();
  const g = c.createGain();
  const now = c.currentTime + t;
  o.type = type;
  o.frequency.setValueAtTime(f0, now);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + dur + 0.05);
}

function noise(c, { t = 0, dur = 0.1, gain = 0.4, type = 'bandpass', freq = 1800, q = 1, attack = 0.002, swell = false }) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c, dur + 0.1);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  const now = c.currentTime + t;
  g.gain.setValueAtTime(0.0001, now);
  if (swell) {
    g.gain.exponentialRampToValueAtTime(gain, now + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  } else {
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  }
  s.connect(f).connect(g).connect(master);
  s.start(now);
  s.stop(now + dur + 0.1);
}

export const sfx = {
  hit(dart) {
    const c = audio();
    if (!c) return;
    if (!dart.value) {
      noise(c, { dur: 0.12, gain: 0.25, freq: 600, q: 0.7 });
      tone(c, { f0: 140, f1: 70, dur: 0.12, gain: 0.25 });
      return;
    }
    noise(c, { dur: 0.06, gain: 0.55, freq: 2400, q: 0.9 });
    tone(c, { f0: 190, f1: 80, dur: 0.11, gain: 0.45, type: 'triangle' });
    if (dart.mult === 3 || (dart.value === 25 && dart.mult === 2)) {
      tone(c, { f0: 1568, dur: 0.25, gain: 0.12, t: 0.04 });
      tone(c, { f0: 2093, dur: 0.35, gain: 0.1, t: 0.09 });
    } else if (dart.mult === 2) {
      tone(c, { f0: 1175, dur: 0.22, gain: 0.1, t: 0.04 });
    }
  },
  bust() {
    const c = audio();
    if (!c) return;
    tone(c, { type: 'sawtooth', f0: 320, f1: 90, dur: 0.45, gain: 0.18 });
    tone(c, { type: 'square', f0: 160, f1: 60, dur: 0.45, gain: 0.08, t: 0.02 });
  },
  fanfare(big = false) {
    const c = audio();
    if (!c) return;
    const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      tone(c, { type: 'triangle', f0: f, dur: 0.5, gain: 0.16, t: i * 0.09 });
      tone(c, { type: 'sine', f0: f * 2, dur: 0.4, gain: 0.05, t: i * 0.09 });
    });
    noise(c, { dur: big ? 2.6 : 1.6, gain: big ? 0.22 : 0.14, freq: 1200, q: 0.4, swell: true, t: 0.05 });
  },
  tick() {
    const c = audio();
    if (!c) return;
    tone(c, { f0: 900, dur: 0.04, gain: 0.05 });
  },
  whoosh() {
    const c = audio();
    if (!c) return;
    noise(c, { dur: 0.25, gain: 0.08, freq: 900, q: 0.6, swell: true });
  },
};

/* ── Caller voice ── */
let voices = [];
const loadVoices = () => {
  try {
    voices = speechSynthesis.getVoices() || [];
  } catch {
    voices = [];
  }
};
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

/**
 * Speak a line. Lines queue one after another (e.g. "60" then the next
 * player's name); pass { interrupt: true } to cut off whatever is playing.
 * Hebrew is spoken with a Hebrew voice when the device has one; otherwise the
 * line is still sent as he-IL so the system speech engine can handle it.
 */
const HEBREW_NAME = /hebrew|carmit|asaf|עברית/i;
const keepAlive = new Set();
let unlocked = false;

function pickVoice(hebrew) {
  if (!voices.length) loadVoices();
  const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
  if (hebrew) {
    return (
      voices.find((v) => norm(v) === 'he-il' || norm(v) === 'iw-il') ??
      voices.find((v) => norm(v).startsWith('he') || norm(v).startsWith('iw')) ??
      voices.find((v) => HEBREW_NAME.test(v.name)) ??
      null
    );
  }
  return voices.find((v) => norm(v) === 'en-gb') ?? voices.find((v) => norm(v).startsWith('en')) ?? null;
}

/**
 * Phones (iOS Safari especially) only allow speech that starts inside a tap.
 * Speaking a silent line on the first tap unlocks it for the rest of the visit.
 */
export function unlockSpeech() {
  if (unlocked || !('speechSynthesis' in window)) return;
  unlocked = true;
  try {
    loadVoices();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    keepAlive.add(u);
    u.onend = u.onerror = () => keepAlive.delete(u);
    speechSynthesis.speak(u);
  } catch {
    /* speech not available */
  }
}

/** What the caller can do on this device, for the settings screen. */
export function voiceStatus(lang) {
  if (!('speechSynthesis' in window)) return { supported: false, voice: null };
  const v = pickVoice(lang === 'he');
  return { supported: true, voice: v ? v.name : null };
}

/**
 * Speak a line. Lines queue one after another (e.g. "60" then the next
 * player's name); pass { interrupt: true } to cut off whatever is playing.
 */
export function say(text, { interrupt = false, force = false } = {}) {
  if ((!settings.voice && !force) || !('speechSynthesis' in window)) return;
  try {
    const line = String(text);
    const hebrew = settings.lang === 'he' || /[֐-׿]/.test(line);
    const v = pickVoice(hebrew);
    const u = new SpeechSynthesisUtterance(line);
    u.lang = v?.lang?.replace('_', '-') || (hebrew ? 'he-IL' : 'en-GB');
    if (v) u.voice = v;
    u.rate = 1;
    u.volume = 1;
    // Chrome drops utterances that get garbage-collected mid-queue.
    keepAlive.add(u);
    u.onend = u.onerror = () => keepAlive.delete(u);
    if (interrupt) speechSynthesis.cancel();
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
  } catch {
    /* speech not available */
  }
}

/* ── Confetti ── */
let canvas = null;
let parts = [];
let raf = 0;

export function confetti(amount = 160, colors) {
  if (document.documentElement.dataset.motion === 'off') return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    document.body.appendChild(canvas);
  }
  const css = getComputedStyle(document.documentElement);
  const palette = colors ?? [css.getPropertyValue('--accent'), css.getPropertyValue('--accent-2'), '#ffffff', css.getPropertyValue('--hot')].map((s) => s.trim() || '#fff');
  const w = (canvas.width = innerWidth * devicePixelRatio);
  const h = (canvas.height = innerHeight * devicePixelRatio);
  for (let i = 0; i < amount; i++) {
    const side = i % 2 ? 1 : -1;
    parts.push({
      x: side > 0 ? w * 0.1 : w * 0.9,
      y: h * 0.75,
      vx: (side > 0 ? 1 : -1) * (6 + Math.random() * 14) * devicePixelRatio,
      vy: -(14 + Math.random() * 16) * devicePixelRatio,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      s: (5 + Math.random() * 7) * devicePixelRatio,
      c: palette[i % palette.length],
      life: 1,
      shape: Math.random() < 0.3 ? 'circle' : 'rect',
    });
  }
  if (!raf) loop();
}

function loop() {
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  const g = 0.45 * devicePixelRatio;
  parts = parts.filter((p) => p.y < canvas.height + 40 && p.life > 0);
  for (const p of parts) {
    p.vy += g;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    p.life -= 0.004;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.r);
    c.globalAlpha = Math.min(1, p.life * 2);
    c.fillStyle = p.c;
    if (p.shape === 'circle') {
      c.beginPath();
      c.arc(0, 0, p.s / 2.4, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2 * Math.abs(Math.cos(p.r * 2)) + 1);
    }
    c.restore();
  }
  if (parts.length) raf = requestAnimationFrame(loop);
  else {
    raf = 0;
    c.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/* ── Big callouts over the board ── */
export function callout(host, { title, sub = '', tone = 'gold', duration = 1600 }) {
  if (!host) return;
  host.querySelectorAll('.callout').forEach((n) => n.remove());
  const n = document.createElement('div');
  n.className = `callout tone-${tone}`;
  n.innerHTML = `<div class="callout-burst"></div><strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}`;
  host.appendChild(n);
  setTimeout(() => n.classList.add('out'), duration);
  setTimeout(() => n.remove(), duration + 500);
}

export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* noop */
  }
}
