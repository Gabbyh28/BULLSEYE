// BULLSEYE — achievements. Pure rules: given a finished leg (and, at the end
// of a match, the match), work out which badges each player has just earned.
// Nothing here touches the page or storage, so it is easy to test.
import { isX01 } from './engine.js';

/** Every badge: id, icon and tier (bronze → silver → gold → legend). Names live in i18n as ach_<id>. */
export const BADGES = [
  { id: 'firstWin', icon: '🏆', tier: 'bronze' },
  { id: 'ton', icon: '💯', tier: 'bronze' },
  { id: 'ton40', icon: '🔥', tier: 'silver' },
  { id: 'max', icon: '⭐', tier: 'gold' },
  { id: 'max10', icon: '🌟', tier: 'legend' },
  { id: 'tonOut', icon: '🎯', tier: 'silver' },
  { id: 'bigFish', icon: '🐟', tier: 'legend' },
  { id: 'bullFinish', icon: '🐂', tier: 'gold' },
  { id: 'madhouse', icon: '🏚️', tier: 'bronze' },
  { id: 'bnb', icon: '🛏️', tier: 'bronze' },
  { id: 'nuts', icon: '🥜', tier: 'bronze' },
  { id: 'trebles', icon: '✳️', tier: 'silver' },
  { id: 'bulls', icon: '🎪', tier: 'gold' },
  { id: 'fastLeg', icon: '⚡', tier: 'gold' },
  { id: 'nine', icon: '💎', tier: 'legend' },
  { id: 'comeback', icon: '🔄', tier: 'silver' },
  { id: 'whitewash', icon: '🧹', tier: 'silver' },
  { id: 'champion', icon: '👑', tier: 'gold' },
  { id: 'shanghai', icon: '🀄', tier: 'gold' },
  { id: 'cricket', icon: '🏏', tier: 'bronze' },
  { id: 'killer', icon: '🗡️', tier: 'bronze' },
  { id: 'clockwork', icon: '⏱️', tier: 'silver' },
  { id: 'teamWin', icon: '🤝', tier: 'bronze' },
  { id: 'streak3', icon: '📈', tier: 'silver' },
  { id: 'avg60', icon: '📊', tier: 'silver' },
  { id: 'games10', icon: '🎖️', tier: 'bronze' },
  { id: 'games50', icon: '🏅', tier: 'gold' },
];
export const BADGE_IDS = BADGES.map((b) => b.id);
export const badgeById = (id) => BADGES.find((b) => b.id === id);

const key = (name) => String(name ?? '').trim().toLowerCase();

/**
 * What was just earned. All inputs are the state *before* this result is recorded.
 *  leg      the finished leg (with winners)
 *  match    the match the leg belongs to (roster, teams, config)
 *  outcome  commitLeg's outcome ({ type, winners })
 *  next     commitLeg's next match (its legLog includes this leg)
 *  stats    lifetime stats keyed by lower-case name
 *  history  past matches, newest first
 *  have     badges already owned: { [lower-case name]: { [id]: time } }
 * Returns [{ name, id }] with no repeats and nothing already owned.
 */
export function earnedBadges({ leg, match, outcome, next, stats = {}, history = [], have = {} }) {
  const out = [];
  const nameOf = (pid) => match.roster.find((p) => p.id === pid)?.name;
  const membersOf = (pid) => match.teams?.find((t) => t.id === pid)?.members ?? [pid];
  const give = (pid, id) => {
    const name = nameOf(pid);
    if (!name || have[key(name)]?.[id] || out.some((b) => b.id === id && key(b.name) === key(name))) return;
    out.push({ name, id });
  };
  const giveUnit = (unit, id) => membersOf(unit).forEach((pid) => give(pid, id));
  const x01 = isX01(leg.mode);
  const scored = x01 || leg.mode === 'highscore';
  const start = x01 ? Number(leg.mode) : 0;

  // ── turn by turn
  const legMax = {};
  for (const t of leg.turns) {
    const who = t.thrower ?? t.pid;
    const d = t.darts;
    if (scored && !t.bust) {
      if (t.counted >= 100) give(who, 'ton');
      if (t.counted >= 140) give(who, 'ton40');
      if (t.counted === 180) {
        give(who, 'max');
        legMax[who] = (legMax[who] ?? 0) + 1;
      }
    }
    if (x01 && !t.bust && d.length === 3) {
      if (t.counted === 26) give(who, 'bnb');
      if (t.counted === 45) give(who, 'nuts');
    }
    if (d.length === 3 && d.every((x) => x.mult === 3)) give(who, 'trebles');
    if (d.length === 3 && d.every((x) => x.value === 25)) give(who, 'bulls');
    if (t.checkout) {
      const last = d.at(-1);
      if (t.startScore >= 100) give(who, 'tonOut');
      if (t.startScore === 170) give(who, 'bigFish');
      if (last?.value === 25 && last.mult === 2) give(who, 'bullFinish');
      if (last?.value === 1 && last.mult === 2) give(who, 'madhouse');
    }
  }
  for (const [pid, n] of Object.entries(legMax)) {
    const name = nameOf(Number(pid));
    if (name && (stats[key(name)]?.t180 ?? 0) + n >= 10) give(Number(pid), 'max10');
  }

  // ── the leg's winner(s)
  for (const w of leg.winners ?? []) {
    const mine = leg.turns.filter((t) => t.pid === w);
    const darts = mine.reduce((a, t) => a + t.darts.length, 0);
    // a real 501 from the first dart: the winner's turns add up to the whole 501
    const full = x01 && start === 501 && mine.reduce((a, t) => a + (t.bust ? 0 : t.counted), 0) === 501;
    if (full && darts <= 15) giveUnit(w, 'fastLeg');
    if (full && darts <= 9) giveUnit(w, 'nine');
    if (leg.mode === 'around' && darts <= 30) giveUnit(w, 'clockwork');
    if (leg.mode === 'cricket') giveUnit(w, 'cricket');
    if (leg.mode === 'killer') giveUnit(w, 'killer');
    if (leg.mode === 'shanghai') {
      const last = leg.turns.at(-1)?.darts ?? [];
      const mults = new Set(last.map((x) => x.mult));
      if (last.length === 3 && mults.size === 3 && new Set(last.map((x) => x.value)).size === 1) giveUnit(w, 'shanghai');
    }
    // comeback: 100 or more behind at some point in an X01 leg, and still won
    if (x01) {
      const score = Object.fromEntries(leg.players.map((p) => [p.pid, start]));
      let behind = false;
      for (const t of leg.turns) {
        score[t.pid] = t.after ?? score[t.pid];
        const others = Object.entries(score).filter(([pid]) => Number(pid) !== w).map(([, s]) => s);
        if (others.length && score[w] - Math.min(...others) >= 100) behind = true;
      }
      if (behind) giveUnit(w, 'comeback');
    }
  }

  // ── the end of a match
  const final = outcome && (outcome.type === 'match' || outcome.type === 'tournament');
  if (final) {
    const winners = outcome.winners.flatMap(membersOf);
    for (const pid of winners) {
      const name = nameOf(pid);
      if (!name) continue;
      const s = stats[key(name)];
      if (!s?.wins) give(pid, 'firstWin');
      if (match.teams) give(pid, 'teamWin');
      if (outcome.type === 'tournament') give(pid, 'champion');
      const recent = history.filter((h) => h.players?.some((n) => key(n) === key(name))).slice(0, 2);
      if (recent.length === 2 && recent.every((h) => h.winners?.some((n) => key(n) === key(name)))) give(pid, 'streak3');
    }
    const log = next?.legLog ?? [];
    if (match.config.format === 'legs' && log.length >= 2) {
      for (const w of outcome.winners) if (log.every((l) => l.winners.includes(w))) giveUnit(w, 'whitewash');
    }
    if (x01) {
      for (const p of match.roster) {
        let pts = 0;
        let n = 0;
        log.forEach((l) =>
          l.turns.forEach((t) => {
            if ((t.thrower ?? t.pid) !== p.id) return;
            pts += t.counted;
            n += t.darts.length;
          }),
        );
        if (n >= 9 && (pts / n) * 3 >= 60) give(p.id, 'avg60');
      }
    }
    for (const p of match.roster) {
      const games = (stats[key(p.name)]?.games ?? 0) + 1;
      if (games >= 10) give(p.id, 'games10');
      if (games >= 50) give(p.id, 'games50');
    }
  }
  return out;
}
