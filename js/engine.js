// BULLSEYE — rules engine. Pure functions, no DOM.

export const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Board radii in millimetres (the board is drawn in these units).
// The treble, double and bull beds are wider than regulation (8mm rings,
// 12.7mm bull) so they are easy to hit with a finger or a mouse.
export const R = {
  bull: 9,
  outerBull: 20,
  trebleIn: 95,
  trebleOut: 110,
  doubleIn: 155,
  doubleOut: 170,
};

export const MODES = [
  { id: '501', x01: 501 },
  { id: '301', x01: 301 },
  { id: '701', x01: 701 },
  { id: 'cricket' },
  { id: 'around' },
  { id: 'shanghai', rounds: 7 },
  { id: 'killer' },
  { id: 'highscore', rounds: 8 },
];

export const CRICKET_KEYS = ['20', '19', '18', '17', '16', '15', 'B'];

export const modeInfo = (id) => MODES.find((m) => m.id === id) ?? MODES[0];
export const isX01 = (id) => !!modeInfo(id).x01;

export function dartLabel(value, mult) {
  if (!value || !mult) return 'MISS';
  if (value === 25) return mult === 2 ? 'BULL' : '25';
  return (mult === 3 ? 'T' : mult === 2 ? 'D' : 'S') + value;
}

export function makeDart(value, mult, x = null, y = null) {
  if (!value) mult = 0;
  return { value, mult, points: value * mult, label: dartLabel(value, mult), x, y };
}

/** Score a point on the board, in mm from the centre (y grows downward). */
export function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= R.bull) return makeDart(25, 2, x, y);
  if (r <= R.outerBull) return makeDart(25, 1, x, y);
  if (r > R.doubleOut) return makeDart(0, 0, x, y);
  const idx = sectorIndexAt(x, y);
  const value = SECTORS[idx];
  const mult = r >= R.doubleIn ? 2 : r >= R.trebleIn && r <= R.trebleOut ? 3 : 1;
  return makeDart(value, mult, x, y);
}

export function sectorIndexAt(x, y) {
  const a = (Math.atan2(y, x) * 180) / Math.PI;
  return (((Math.round((a + 90) / 18)) % 20) + 20) % 20;
}

/** A plausible landing point for a dart entered from the keypad. */
export function randomPointFor(value, mult) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  if (!value) {
    const a = rnd(0, Math.PI * 2);
    const r = rnd(176, 196);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  if (value === 25) {
    const a = rnd(0, Math.PI * 2);
    const r = mult === 2 ? rnd(0, R.bull - 1.5) : rnd(R.bull + 1.5, R.outerBull - 1.5);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  const idx = SECTORS.indexOf(value);
  const a = ((-90 + idx * 18 + rnd(-6.5, 6.5)) * Math.PI) / 180;
  let r;
  if (mult === 3) r = rnd(R.trebleIn + 1.5, R.trebleOut - 1.5);
  else if (mult === 2) r = rnd(R.doubleIn + 1.5, R.doubleOut - 1.5);
  else r = Math.random() < 0.55 ? rnd(R.trebleOut + 8, R.doubleIn - 8) : rnd(R.outerBull + 10, R.trebleIn - 6);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/* ───────────────────────── Checkout suggestions ───────────────────────── */

const FINISH_DOUBLES = [20, 16, 8, 18, 12, 10, 14, 4, 6, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1];
const SETUP_ORDER = [
  [20, 3], [19, 3], [18, 3], [17, 3], [16, 3], [15, 3], [14, 3], [13, 3], [12, 3], [11, 3], [10, 3],
  [25, 2], [25, 1],
  ...Array.from({ length: 20 }, (_, i) => [20 - i, 1]),
  ...[9, 8, 7, 6, 5, 4, 3, 2, 1].map((v) => [v, 3]),
  ...Array.from({ length: 20 }, (_, i) => [20 - i, 2]),
];

function oneDartSetup(score) {
  if (score <= 0) return null;
  if (score <= 20) return [score, 1];
  if (score === 25) return [25, 1];
  if (score === 50) return [25, 2];
  if (score % 3 === 0 && score <= 60) return [score / 3, 3];
  if (score % 2 === 0 && score <= 40) return [score / 2, 2];
  return null;
}

function finishOne(score, doubleOut) {
  if (doubleOut) {
    if (score === 50) return [[25, 2]];
    if (score % 2 === 0 && score <= 40 && score >= 2) return [[score / 2, 2]];
    return null;
  }
  const s = oneDartSetup(score);
  return s ? [s] : null;
}

function finishTwo(score, doubleOut) {
  const finals = doubleOut
    ? [...FINISH_DOUBLES.map((v) => [v, 2]), [25, 2]]
    : SETUP_ORDER;
  for (const [v, m] of finals) {
    const rest = score - v * m;
    const setup = oneDartSetup(rest);
    if (setup) return [setup, [v, m]];
  }
  return null;
}

/** Returns an array of labels (e.g. ["T20","T20","BULL"]) or null. */
export function checkout(score, dartsLeft = 3, doubleOut = true) {
  if (score <= 0 || score > 170 || dartsLeft <= 0) return null;
  let route = finishOne(score, doubleOut);
  if (!route && dartsLeft >= 2) route = finishTwo(score, doubleOut);
  if (!route && dartsLeft >= 3) {
    for (const [v, m] of SETUP_ORDER) {
      const rest = score - v * m;
      if (rest < 2) continue;
      const two = finishOne(rest, doubleOut) ?? finishTwo(rest, doubleOut);
      if (two) {
        route = [[v, m], ...two];
        break;
      }
    }
  }
  return route ? route.map(([v, m]) => dartLabel(v, m)) : null;
}

/* ───────────────────────────── Legs ───────────────────────────── */

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createLeg(config, playerIds, starter = 0) {
  const info = modeInfo(config.mode);
  const order = playerIds.slice(starter).concat(playerIds.slice(0, starter));
  const targets = config.mode === 'killer' ? shuffle(SECTORS).slice(0, order.length) : [];
  return {
    mode: config.mode,
    doubleOut: !!config.doubleOut,
    players: order.map((pid, i) => ({
      pid,
      score: info.x01 ?? 0,
      marks: Object.fromEntries(CRICKET_KEYS.map((k) => [k, 0])),
      progress: 1,
      lives: 3,
      charge: 0,
      killer: false,
      target: targets[i] ?? null,
      darts: 0,
    })),
    current: 0,
    round: 1,
    turn: [],
    turnStart: info.x01 ?? 0,
    turnStartedAt: Date.now(),
    turnDone: false,
    bust: false,
    winners: null,
    turns: [],
  };
}

export const activePlayer = (leg) => leg.players[leg.current];

export function aroundTarget(progress) {
  return progress >= 21 ? 25 : progress;
}

/** Throw one dart. Returns { leg, events } — leg is a new object. */
export function throwDart(input, dart) {
  const leg = clone(input);
  const events = [];
  if (leg.turnDone || leg.winners) return { leg, events };
  const p = activePlayer(leg);
  const others = leg.players.filter((o) => o !== p);
  leg.turn.push(dart);
  p.darts += 1;

  switch (leg.mode) {
    case '501':
    case '301':
    case '701': {
      const next = p.score - dart.points;
      const badFinish = leg.doubleOut ? next === 1 || (next === 0 && dart.mult !== 2) : false;
      if (next < 0 || badFinish) {
        p.score = leg.turnStart;
        leg.bust = true;
        events.push('bust');
      } else {
        p.score = next;
        if (next === 0) {
          leg.winners = [p.pid];
          events.push('checkout');
        }
      }
      break;
    }
    case 'cricket': {
      const key = dart.value === 25 ? 'B' : String(dart.value);
      if (CRICKET_KEYS.includes(key)) {
        const before = p.marks[key];
        const extra = Math.max(0, before + dart.mult - 3);
        p.marks[key] = Math.min(3, before + dart.mult);
        if (before < 3 && p.marks[key] === 3) events.push('closed');
        if (extra && others.some((o) => o.marks[key] < 3)) p.score += extra * dart.value;
      }
      const allClosed = CRICKET_KEYS.every((k) => p.marks[k] >= 3);
      if (allClosed && others.every((o) => o.score <= p.score)) {
        leg.winners = [p.pid];
        events.push('win');
      }
      break;
    }
    case 'around': {
      if (dart.value && dart.value === aroundTarget(p.progress)) {
        p.progress += 1;
        events.push('advance');
        if (p.progress > 21) {
          leg.winners = [p.pid];
          events.push('win');
        }
      }
      break;
    }
    case 'shanghai': {
      if (dart.value === leg.round) p.score += dart.points;
      const hits = leg.turn.filter((d) => d.value === leg.round).map((d) => d.mult);
      if ([1, 2, 3].every((m) => hits.includes(m))) {
        leg.winners = [p.pid];
        events.push('shanghai');
      }
      break;
    }
    case 'killer': {
      if (!dart.value || dart.value === 25) break;
      if (dart.value === p.target) {
        if (!p.killer) {
          p.charge = Math.min(3, p.charge + dart.mult);
          if (p.charge >= 3) {
            p.killer = true;
            events.push('killer');
          }
        }
      } else if (p.killer) {
        const victim = others.find((o) => o.target === dart.value && o.lives > 0);
        if (victim) {
          victim.lives = Math.max(0, victim.lives - dart.mult);
          events.push(victim.lives === 0 ? 'eliminated' : 'hit-life');
        }
      }
      const alive = leg.players.filter((o) => o.lives > 0);
      if (alive.length === 1) {
        leg.winners = [alive[0].pid];
        events.push('win');
      }
      break;
    }
    case 'highscore': {
      p.score += dart.points;
      break;
    }
  }

  if (leg.winners || leg.bust || leg.turn.length >= 3) endTurn(leg, events);
  return { leg, events };
}

function turnCounted(leg, p) {
  switch (leg.mode) {
    case '501':
    case '301':
    case '701':
      return leg.bust ? 0 : leg.turn.reduce((s, d) => s + d.points, 0);
    case 'shanghai':
      return leg.turn.filter((d) => d.value === leg.round).reduce((s, d) => s + d.points, 0);
    case 'highscore':
      return leg.turn.reduce((s, d) => s + d.points, 0);
    default:
      return leg.turn.reduce((s, d) => s + d.points, 0);
  }
}

function endTurn(leg, events) {
  const p = activePlayer(leg);
  leg.turnDone = true;
  const info = modeInfo(leg.mode);
  if (!leg.winners && info.rounds && leg.round >= info.rounds && isLastInRound(leg)) {
    const best = Math.max(...leg.players.map((o) => o.score));
    leg.winners = leg.players.filter((o) => o.score === best).map((o) => o.pid);
    events.push('win');
  }
  const record = {
    pid: p.pid,
    round: leg.round,
    darts: leg.turn.slice(),
    counted: turnCounted(leg, p),
    total: leg.turn.reduce((s, d) => s + d.points, 0),
    bust: leg.bust,
    startScore: leg.turnStart,
    checkout: isX01(leg.mode) && !!leg.winners && leg.winners.includes(p.pid),
    ms: Date.now() - (leg.turnStartedAt ?? Date.now()),
    // the player's standing after this turn: remaining (X01), points, progress or lives
    after: leg.mode === 'around' ? Math.min(21, p.progress - 1) : leg.mode === 'killer' ? p.lives : p.score,
  };
  leg.turns.push(record);
  events.push('turn-end');
  if (record.counted === 180 && isX01(leg.mode)) events.push('180');
  else if (record.counted >= 100 && isX01(leg.mode)) events.push('ton');
}

function isLastInRound(leg) {
  for (let i = leg.current + 1; i < leg.players.length; i++) if (isActive(leg, leg.players[i])) return false;
  return true;
}

const isActive = (leg, p) => leg.mode !== 'killer' || p.lives > 0;

export function nextTurn(input) {
  const leg = clone(input);
  if (!leg.turnDone || leg.winners) return leg;
  let i = leg.current;
  for (let step = 0; step < leg.players.length; step++) {
    i += 1;
    if (i >= leg.players.length) {
      i = 0;
      leg.round += 1;
    }
    if (isActive(leg, leg.players[i])) break;
  }
  leg.current = i;
  leg.turn = [];
  leg.turnDone = false;
  leg.bust = false;
  leg.turnStart = leg.players[i].score;
  leg.turnStartedAt = Date.now();
  return leg;
}

/** Highlights: which numbers matter for the current player. */
export function targetsFor(leg) {
  if (!leg || leg.winners) return [];
  const p = activePlayer(leg);
  switch (leg.mode) {
    case 'around':
      return [aroundTarget(p.progress)];
    case 'shanghai':
      return [leg.round];
    case 'cricket':
      return CRICKET_KEYS.filter((k) => p.marks[k] < 3 || leg.players.some((o) => o.marks[k] < 3)).map((k) =>
        k === 'B' ? 25 : Number(k),
      );
    case 'killer':
      return p.killer
        ? leg.players.filter((o) => o !== p && o.lives > 0).map((o) => o.target)
        : [p.target];
    default:
      return [];
  }
}

/* ───────────────────────────── Matches ───────────────────────────── */

export function createMatch(config, roster) {
  const ids = roster.map((p) => p.id);
  const match = {
    config: clone(config),
    roster: clone(roster),
    legWins: Object.fromEntries(ids.map((id) => [id, 0])),
    setWins: Object.fromEntries(ids.map((id) => [id, 0])),
    legNo: 1,
    starter: 0,
    bracket: null,
    champion: null,
    finished: false,
    history: [],
    legLog: [],
  };
  if (config.format === 'tournament') {
    match.bracket = createBracket(ids);
    const m = activeBracketMatch(match.bracket);
    match.leg = createLeg(config, [m.a, m.b]);
  } else {
    match.leg = createLeg(config, ids);
  }
  return match;
}

export const legsTarget = (config) => (config.format === 'single' ? 1 : Math.max(1, config.legs || 1));
export const setsTarget = (config) => (config.format === 'legs' ? Math.max(1, config.sets || 1) : 1);

/**
 * Commit a finished leg. Returns { match, outcome }:
 * outcome.type: 'leg' | 'set' | 'match' | 'tournament-match' | 'tournament'
 */
export function commitLeg(input) {
  const match = clone(input);
  const leg = match.leg;
  const winners = leg.winners ?? [];
  const { config } = match;
  const legIds = leg.players.map((p) => p.pid);
  match.history.push({ legNo: match.legNo, winners, mode: leg.mode });
  // keep every finished leg for the match report (without dart coordinates)
  match.legLog ??= [];
  match.legLog.push({
    legNo: match.legNo,
    mode: leg.mode,
    doubleOut: leg.doubleOut,
    winners,
    players: leg.players.map((p) => p.pid),
    start: modeInfo(leg.mode).x01 ?? 0,
    turns: leg.turns.map((t) => ({ ...t, darts: t.darts.map((d) => ({ value: d.value, mult: d.mult, points: d.points, label: d.label })) })),
  });
  winners.forEach((w) => (match.legWins[w] = (match.legWins[w] ?? 0) + 1));

  const needLegs = legsTarget(config);
  const needSets = setsTarget(config);
  const legLeader = winners.find((w) => match.legWins[w] >= needLegs);
  let outcome = { type: 'leg', winners };

  if (legLeader != null) {
    if (needSets > 1) {
      match.setWins[legLeader] += 1;
      legIds.forEach((id) => (match.legWins[id] = 0));
      outcome = { type: 'set', winners: [legLeader] };
      if (match.setWins[legLeader] >= needSets) outcome = { type: 'match', winners: [legLeader] };
    } else {
      outcome = { type: 'match', winners: winners.filter((w) => match.legWins[w] >= needLegs) };
    }
  }

  if (outcome.type === 'match' && config.format === 'tournament') {
    const bm = activeBracketMatch(match.bracket);
    advanceBracket(match.bracket, bm, outcome.winners[0]);
    const champ = bracketChampion(match.bracket);
    if (champ != null) {
      match.champion = champ;
      match.finished = true;
      outcome = { type: 'tournament', winners: [champ], matchWinner: outcome.winners[0] };
    } else {
      outcome = { type: 'tournament-match', winners: outcome.winners };
      const next = activeBracketMatch(match.bracket);
      legIds.forEach((id) => (match.legWins[id] = 0));
      match.starter = 0;
      match.legNo += 1;
      match.leg = createLeg(config, [next.a, next.b]);
    }
    return { match, outcome };
  }

  if (outcome.type === 'match') {
    match.finished = true;
    match.champion = outcome.winners[0];
    return { match, outcome };
  }

  match.legNo += 1;
  match.starter = (match.starter + 1) % legIds.length;
  const base = config.format === 'tournament' ? legIds : match.roster.map((p) => p.id);
  match.leg = createLeg(config, base, match.starter % base.length);
  return { match, outcome };
}

/* Knockout bracket */
export function createBracket(ids) {
  let size = 2;
  while (size < ids.length) size *= 2;
  const realMatches = ids.length - size / 2;
  const rounds = [];
  const first = [];
  let k = 0;
  for (let i = 0; i < size / 2; i++) {
    if (i < realMatches) {
      first.push({ a: ids[k], b: ids[k + 1], winner: null });
      k += 2;
    } else {
      first.push({ a: ids[k], b: null, winner: ids[k] });
      k += 1;
    }
  }
  rounds.push(first);
  let n = size / 4;
  while (n >= 1) {
    rounds.push(Array.from({ length: n }, () => ({ a: null, b: null, winner: null })));
    n /= 2;
  }
  const bracket = { rounds };
  // propagate byes
  rounds[0].forEach((m, i) => m.winner != null && placeWinner(bracket, 0, i, m.winner));
  return bracket;
}

function placeWinner(bracket, r, i, winner) {
  const next = bracket.rounds[r + 1];
  if (!next) return;
  const slot = next[Math.floor(i / 2)];
  if (i % 2 === 0) slot.a = winner;
  else slot.b = winner;
}

export function activeBracketMatch(bracket) {
  for (const round of bracket.rounds) for (const m of round) if (m.a != null && m.b != null && m.winner == null) return m;
  return null;
}

function advanceBracket(bracket, match, winner) {
  bracket.rounds.forEach((round, r) =>
    round.forEach((m, i) => {
      if (m.a === match.a && m.b === match.b && m.winner == null) {
        m.winner = winner;
        placeWinner(bracket, r, i, winner);
      }
    }),
  );
}

export function bracketChampion(bracket) {
  return bracket.rounds.at(-1)[0].winner;
}
