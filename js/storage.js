// BULLSEYE — local persistence and player statistics.
import { isX01 } from './engine.js';

const KEY = 'bullseye:v1';

const defaults = () => ({
  prefs: { theme: 'championship', lang: null, sound: true, voice: true, autoNext: true, motion: 'on', quality: 'high', input: 'board' },
  config: { mode: '501', doubleOut: true, format: 'single', legs: 3, sets: 1 },
  roster: [],
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

export function recordMatch(match, winners) {
  const data = load();
  const names = match.roster.map((p) => p.name);
  names.forEach((n) => (statsFor(n).games += 1));
  winners.forEach((pid) => {
    const n = match.roster.find((p) => p.id === pid)?.name;
    if (n) statsFor(n).wins += 1;
  });
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
