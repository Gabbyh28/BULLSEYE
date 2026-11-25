// BULLSEYE — local persistence and player statistics.
import { isX01 } from './engine.js';

const KEY = 'bullseye:v1';

const defaults = () => ({
  prefs: { theme: 'championship', lang: null, sound: true, voice: true, autoNext: true, motion: 'on', quality: 'high', input: 'board' },
  config: { mode: '501', doubleOut: true, format: 'single', legs: 3, sets: 1 },
  roster: [],
  photos: {},
  match: null,
  stats: {},
  history: [],
});

let cache = null;

export function load() {
  if (cache) return cache;
  let data = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      data = { ...data, ...parsed, prefs: { ...data.prefs, ...parsed.prefs }, config: { ...data.config, ...parsed.config } };
    }
  } catch {
    /* storage unavailable: run in-memory */
  }
  cache = data;
  return data;
}

let timer = 0;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 120);
}

export function flush() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota or private mode */
  }
}

const blankStats = () => ({
  games: 0,
  wins: 0,
  darts: 0,
  x01Darts: 0,
  x01Points: 0,
  turns: 0,
  t180: 0,
  t140: 0,
  t100: 0,
  bestTurn: 0,
  bestCheckout: 0,
  checkouts: 0,
  bulls: 0,
  trebles: 0,
  doubles: 0,
  misses: 0,
  beds: {},
  points: [],
  legAverages: [],
  turnMs: 0,
});

export function statsFor(name) {
  const data = load();
  const k = name.trim().toLowerCase();
  data.stats[k] ??= { name, ...blankStats() };
  return data.stats[k];
}

/** Fold a finished leg into each player's lifetime stats. */
export function recordLeg(leg, roster) {
  const nameOf = (pid) => roster.find((p) => p.id === pid)?.name ?? '?';
  for (const p of leg.players) {
    const s = statsFor(nameOf(p.pid));
    const turns = leg.turns.filter((t) => t.pid === p.pid);
    let legPts = 0;
    let legDarts = 0;
    for (const t of turns) {
      s.turns += 1;
      s.turnMs += Math.min(t.ms || 0, 120000);
      for (const d of t.darts) {
        s.darts += 1;
        if (!d.value) s.misses += 1;
        if (d.value === 25) s.bulls += 1;
        if (d.mult === 3) s.trebles += 1;
        if (d.mult === 2) s.doubles += 1;
        if (d.value) s.beds[d.label] = (s.beds[d.label] ?? 0) + 1;
        if (d.x != null) s.points.push([Math.round(d.x * 10) / 10, Math.round(d.y * 10) / 10]);
      }
      if (isX01(leg.mode)) {
        s.x01Darts += t.darts.length;
        s.x01Points += t.counted;
        legPts += t.counted;
        legDarts += t.darts.length;
        if (t.counted === 180) s.t180 += 1;
        else if (t.counted >= 140) s.t140 += 1;
        else if (t.counted >= 100) s.t100 += 1;
        if (t.checkout) {
          s.checkouts += 1;
          s.bestCheckout = Math.max(s.bestCheckout, t.startScore);
        }
        if (leg.doubleOut) countDoubles(s, t);
      }
      s.bestTurn = Math.max(s.bestTurn, t.counted);
    }
    if (s.points.length > 1500) s.points = s.points.slice(-1500);
    if (legDarts) {
      s.legAverages.push(Math.round((legPts / legDarts) * 300) / 100);
      if (s.legAverages.length > 60) s.legAverages = s.legAverages.slice(-60);
    }
  }
  save();
}

/**
 * A dart "at a double" is one thrown while the score left can be finished with
 * a single dart (an even number up to 40, or 50 for the bull).
 */
function countDoubles(s, turn) {
  let left = turn.startScore;
  for (const d of turn.darts) {
    if (left === 50 || (left >= 2 && left <= 40 && left % 2 === 0)) {
      s.dblAttempts = (s.dblAttempts ?? 0) + 1;
      if (d.mult === 2 && d.points === left) s.dblHits = (s.dblHits ?? 0) + 1;
    }
    left -= d.points;
    if (left <= 1) break;
  }
}

function headToHead(winner, loser) {
  if (!winner || !loser || winner === loser) return;
  const w = statsFor(winner);
  const l = statsFor(loser);
  w.h2h ??= {};
  l.h2h ??= {};
  (w.h2h[loser] ??= { w: 0, l: 0 }).w += 1;
  (l.h2h[winner] ??= { w: 0, l: 0 }).l += 1;
}

/** bracket: the finished tournament bracket, so every knockout match counts head-to-head. */
export function recordMatch(match, winners, bracket = null) {
  const data = load();
  const names = match.roster.map((p) => p.name);
  const nameOf = (pid) => match.roster.find((p) => p.id === pid)?.name;
  names.forEach((n) => (statsFor(n).games += 1));
  winners.forEach((pid) => {
    const n = nameOf(pid);
    if (n) statsFor(n).wins += 1;
  });
  if (bracket) {
    bracket.rounds.flat().forEach((m) => {
      if (m.a != null && m.b != null && m.winner != null) headToHead(nameOf(m.winner), nameOf(m.winner === m.a ? m.b : m.a));
    });
  } else {
    winners.forEach((w) => match.roster.forEach((p) => !winners.includes(p.id) && headToHead(nameOf(w), p.name)));
  }
  data.history.unshift({
    at: Date.now(),
    mode: match.config.mode,
    format: match.config.format,
    players: names,
    winners: winners.map((pid) => match.roster.find((p) => p.id === pid)?.name).filter(Boolean),
    legs: match.history.length,
  });
  data.history = data.history.slice(0, 60);
  save();
}

export function resetStats() {
  const data = load();
  data.stats = {};
  data.history = [];
  save();
}

/* ───────────── backup & restore ───────────── */

const MODES = ['501', '301', '701', 'cricket', 'around', 'shanghai', 'killer', 'highscore'];
const THEMES = ['championship', 'neon', 'tavern', 'daylight', 'blaze', 'candy'];

/** Everything worth keeping, as a JSON string. The live match is left out on purpose. */
export function exportBackup() {
  const d = load();
  return JSON.stringify(
    {
      app: 'BULLSEYE',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { prefs: d.prefs, config: d.config, roster: d.roster, photos: d.photos, stats: d.stats, history: d.history },
    },
    null,
    1,
  );
}

const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const safeText = (v, max) => str(v, max).replace(/[<>"'&]/g, '');

/** Parse and clean a backup file. Throws if it isn't a BULLSEYE backup. */
export function readBackup(text) {
  const o = JSON.parse(text);
  if (!o || o.app !== 'BULLSEYE' || typeof o.data !== 'object' || !o.data) throw new Error('not a BULLSEYE backup');
  const src = o.data;
  const roster = (Array.isArray(src.roster) ? src.roster : []).slice(0, 8).map((p, i) => ({
    id: Number.isFinite(p?.id) ? p.id : Date.now() + i,
    name: str(p?.name, 24) || `Player ${i + 1}`,
    avatar: safeText(p?.avatar, 8) || '🎯',
    color: /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : '#f5c46b',
  }));
  const photos = {};
  for (const [k, v] of Object.entries(src.photos ?? {})) {
    if (typeof v === 'string' && v.length < 400000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) photos[k] = v;
  }
  const stats = {};
  for (const [k, v] of Object.entries(src.stats ?? {})) {
    if (!v || typeof v !== 'object') continue;
    const clean = { name: str(v.name, 24) || str(k, 24) };
    for (const f of ['games', 'wins', 'darts', 'x01Darts', 'x01Points', 'turns', 't180', 't140', 't100', 'bestTurn', 'bestCheckout', 'checkouts', 'bulls', 'trebles', 'doubles', 'misses', 'turnMs', 'dblAttempts', 'dblHits']) clean[f] = num(v[f]);
    clean.beds = {};
    for (const [bk, bv] of Object.entries(v.beds ?? {})) if (/^(MISS|BULL|25|[SDT]\d{1,2})$/.test(bk)) clean.beds[bk] = num(bv);
    clean.points = (Array.isArray(v.points) ? v.points : []).filter((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite)).slice(-1500);
    clean.legAverages = (Array.isArray(v.legAverages) ? v.legAverages : []).filter(Number.isFinite).slice(-60);
    clean.h2h = {};
    for (const [opp, rec] of Object.entries(v.h2h ?? {})) clean.h2h[str(opp, 24)] = { w: num(rec?.w), l: num(rec?.l) };
    stats[str(k, 24).toLowerCase()] = clean;
  }
  const history = (Array.isArray(src.history) ? src.history : []).slice(0, 60).map((h) => ({
    at: num(h?.at),
    mode: MODES.includes(h?.mode) ? h.mode : '501',
    format: ['single', 'legs', 'tournament'].includes(h?.format) ? h.format : 'single',
    players: (Array.isArray(h?.players) ? h.players : []).map((n) => str(n, 24)).slice(0, 8),
    winners: (Array.isArray(h?.winners) ? h.winners : []).map((n) => str(n, 24)).slice(0, 8),
    legs: num(h?.legs),
  }));
  const base = defaults();
  const prefs = { ...base.prefs };
  for (const k of Object.keys(base.prefs)) if (typeof src.prefs?.[k] === typeof base.prefs[k] || (k === 'lang' && ['he', 'en'].includes(src.prefs?.lang))) prefs[k] = src.prefs[k];
  if (!THEMES.includes(prefs.theme)) prefs.theme = base.prefs.theme;
  const config = { ...base.config };
  if (MODES.includes(src.config?.mode)) config.mode = src.config.mode;
  if (['single', 'legs', 'tournament'].includes(src.config?.format)) config.format = src.config.format;
  config.doubleOut = typeof src.config?.doubleOut === 'boolean' ? src.config.doubleOut : config.doubleOut;
  config.legs = Math.min(11, Math.max(1, num(src.config?.legs) || 1));
  config.sets = Math.min(7, Math.max(1, num(src.config?.sets) || 1));
  return { exportedAt: str(o.exportedAt, 40), data: { prefs, config, roster, photos, stats, history } };
}

/** Replace everything on this device with a cleaned backup (from readBackup). */
export function restoreBackup(backup) {
  cache = { ...defaults(), ...backup.data, match: null };
  flush();
}
