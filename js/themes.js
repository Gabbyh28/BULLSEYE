// BULLSEYE — the custom arena: one small set of choices (base, accent, board
// colours, wall, lights) expanded into a full theme for the page, the 2D board
// and the 3D scene. Seasonal packs are ready-made starting points.
import { BOARD_SKINS } from './board.js';

export const WALLS = ['panels', 'grid', 'brick', 'plaster', 'carbon', 'dots'];

export const PRESETS = {
  classic: { name: 'Classic', mode: 'dark', accent: '#f5c46b', dark: '#17181b', light: '#efe1c0', red: '#c8253c', green: '#11734f', wall: 'panels', lightColor: '#fff0d8' },
  winter: { name: 'Winter', mode: 'dark', accent: '#9fd8ff', dark: '#14202c', light: '#eef6fb', red: '#2f6fb8', green: '#8fd0ea', wall: 'dots', lightColor: '#dff1ff' },
  summer: { name: 'Summer', mode: 'light', accent: '#ff7a2f', dark: '#2a2320', light: '#fff1c9', red: '#ff5a5f', green: '#18b6a4', wall: 'panels', lightColor: '#fff3d6' },
  party: { name: 'Party', mode: 'dark', accent: '#c86bff', dark: '#1a0f2e', light: '#ffd84d', red: '#ff3fa4', green: '#2ee6d6', wall: 'grid', lightColor: '#ffd1f5' },
};

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const toHex = (r) => `#${r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** Blend a toward b by k (0 = a, 1 = b). */
export const mix = (a, b, k) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * k));
const rgba = (h, a) => `rgba(${hex(h).join(', ')}, ${a})`;
const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Expand a cleaned custom theme into a board skin (with its 3D scene) and page tokens. */
export function expandTheme(t) {
  const light = t.mode === 'light';
  const wallA = light ? mix(t.accent, '#eef0f2', 0.86) : mix(t.accent, '#1b2030', 0.82);
  const skin = {
    dark: t.dark,
    light: t.light,
    red: t.red,
    green: t.green,
    wire: ['#ffffff', '#9a9a9a'],
    ring: mix(t.dark, '#000000', 0.35),
    numbers: ['#ffffff', mix(t.accent, '#ffffff', 0.5)],
    rim: [t.accent, mix(t.accent, '#000000', 0.6), mix(t.accent, '#ffffff', 0.45)],
    glow: 0,
    scene: {
      wall: t.wall,
      a: wallA,
      b: mix(wallA, '#000000', light ? 0.14 : 0.55),
      led: t.accent,
      led2: t.lightColor,
      ledI: 2,
      key: t.lightColor,
      fill: mix(t.accent, t.lightColor, 0.4),
      amb: light ? 0.85 : 0.22,
      bloom: 0.5,
      surround: light ? '#2b2f34' : mix(t.accent, '#0e1014', 0.9),
      beam: light ? 0 : 0.08,
      exposure: light ? 1 : 1.05,
    },
  };
  const bg = light ? mix(t.accent, '#e8ebee', 0.9) : mix(t.accent, '#05070c', 0.92);
  const ink = light ? '#141a20' : '#f4efe4';
  const vars = {
    '--bg': bg,
    '--bg-2': light ? mix(t.accent, '#f6f7f8', 0.94) : mix(t.accent, '#0c111c', 0.86),
    '--surface': light ? 'rgba(255, 255, 255, .66)' : rgba(mix(t.accent, '#ffffff', 0.7), 0.05),
    '--surface-2': light ? 'rgba(255, 255, 255, .92)' : rgba(mix(t.accent, '#ffffff', 0.7), 0.09),
    '--line': light ? 'rgba(20, 30, 40, .1)' : rgba(mix(t.accent, '#ffffff', 0.6), 0.11),
    '--line-2': light ? 'rgba(20, 30, 40, .18)' : rgba(mix(t.accent, '#ffffff', 0.6), 0.2),
    '--text': ink,
    '--muted': light ? '#5e6974' : mix(t.accent, '#8e97a9', 0.8),
    '--accent': light && lum(t.accent) > 0.6 ? mix(t.accent, '#000000', 0.35) : t.accent,
    '--accent-2': t.green,
    '--hot': t.red,
    '--on-accent': lum(t.accent) > 0.5 ? '#141005' : '#ffffff',
    '--glow-1': rgba(t.accent, light ? 0.16 : 0.26),
    '--glow-2': rgba(t.lightColor, light ? 0.18 : 0.14),
    '--spot': rgba(t.lightColor, light ? 0.7 : 0.2),
    '--logo-ring': t.dark,
    '--logo-mid': t.green,
    '--heat': t.accent,
  };
  return { skin, vars, light };
}

/** Register the custom arena so boards can use the skin name "custom". */
export function installTheme(t) {
  if (!t) {
    delete BOARD_SKINS.custom;
    return null;
  }
  const ex = expandTheme(t);
  BOARD_SKINS.custom = ex.skin;
  return ex;
}
