// Stats, head-to-head and backup/restore tests. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { load, recordLeg, recordMatch, statsFor, exportBackup, readBackup, restoreBackup, photoKey, rivalry, doublesReport } from '../js/storage.js';

const D = E.makeDart;
const roster = [
  { id: 1, name: 'Gabby' },
  { id: 2, name: 'Dan' },
];

test('checkout % counts darts thrown at a finishing double', () => {
  const m = E.createMatch({ mode: '501', doubleOut: true, format: 'single' }, roster);
  m.leg.players[0].score = 40;
  m.leg.turnStart = 40;
  // D20 missed into S20 (attempt at 40), then D10 hit (attempt at 20, finishes)
  let L = E.throwDart(m.leg, D(20, 1)).leg;
  L = E.throwDart(L, D(10, 2)).leg;
  assert.deepEqual(L.winners, [1]);
  recordLeg(L, roster);
  const s = statsFor('Gabby');
  assert.equal(s.dblAttempts, 2);
  assert.equal(s.dblHits, 1);
});

test('head-to-head records the winner over each loser', () => {
  const m = E.createMatch({ mode: '301', doubleOut: false, format: 'single' }, roster);
  recordMatch(m, [2]);
  assert.deepEqual(statsFor('Dan').h2h.Gabby, { w: 1, l: 0 });
  assert.deepEqual(statsFor('Gabby').h2h.Dan, { w: 0, l: 1 });
});

test('knockout head-to-head uses every bracket match', () => {
  const four = [1, 2, 3, 4].map((id) => ({ id, name: `K${id}` }));
  let m = E.createMatch({ mode: '301', doubleOut: false, format: 'tournament', legs: 1 }, four);
  let last;
  while (!m.finished) {
    m.leg.players[0].score = 20;
    m.leg.turnStart = 20;
    const r = E.throwDart(m.leg, D(20, 1));
    last = E.commitLeg({ ...m, leg: r.leg });
    m = last.match;
  }
  recordMatch(m, last.outcome.winners, m.bracket);
  const champ = statsFor(four.find((p) => p.id === m.champion).name);
  const wins = Object.values(champ.h2h).reduce((a, r) => a + r.w, 0);
  assert.equal(wins, 2, 'champion of 4 won two knockout matches');
});

test('backup round-trips through readBackup and restoreBackup', () => {
  const data = load();
  data.roster = [{ id: 7, name: 'Noa', avatar: '🐯', color: '#ff6b8b' }];
  data.photos = { noa: 'data:image/jpeg;base64,AAAA' };
  const text = exportBackup();
  const parsed = readBackup(text);
  assert.equal(parsed.data.roster[0].name, 'Noa');
  assert.equal(parsed.data.photos.noa, 'data:image/jpeg;base64,AAAA');
  restoreBackup(parsed);
  assert.equal(load().roster[0].name, 'Noa');
  assert.equal(load().match, null, 'restore never brings back a live match');
});

test('readBackup rejects files that are not BULLSEYE backups', () => {
  assert.throws(() => readBackup('not json'));
  assert.throws(() => readBackup(JSON.stringify({ app: 'Other', data: {} })));
  assert.throws(() => readBackup(JSON.stringify({ app: 'BULLSEYE' })));
});

test('readBackup cleans hostile or malformed fields', () => {
  const evil = {
    app: 'BULLSEYE',
    data: {
      roster: [{ id: 1, name: 'X', avatar: '<img src=x onerror=alert(1)>', color: 'red;background:url(x)' }],
      photos: { 1: 'javascript:alert(1)', 2: 'data:image/svg+xml;base64,PHN2Zz4=' },
      history: [{ at: 1, mode: '<script>', players: ['A'], winners: ['A'] }],
      prefs: { theme: 'nope', sound: 'yes' },
      stats: { a: { name: 'A', games: '5', beds: { '<b>': 3, T20: 2 }, points: [[1, 2], ['x', 3]] } },
    },
  };
  const { data } = readBackup(JSON.stringify(evil));
  assert.ok(!/[<>]/.test(data.roster[0].avatar), 'avatar markup stripped');
  assert.equal(data.roster[0].color, '#f5c46b', 'bad colour replaced');
  assert.deepEqual(data.photos, {}, 'only jpeg/png/webp data URLs survive');
  assert.equal(data.history[0].mode, '501', 'unknown mode replaced');
  assert.equal(data.prefs.theme, 'championship');
  assert.equal(data.prefs.sound, true, 'wrong-typed pref ignored');
  assert.equal(data.stats.a.games, 0, 'non-numeric counters zeroed');
  assert.deepEqual(data.stats.a.beds, { T20: 2 });
  assert.deepEqual(data.stats.a.points, [[1, 2]]);
});

test('photos are saved per name: case and spaces do not matter', () => {
  assert.equal(photoKey('  Gabby '), 'gabby');
  assert.equal(photoKey('GABBY'), photoKey('gabby'));
});

test('older backups keyed by player id move to the player name', () => {
  const old = { app: 'BULLSEYE', data: { roster: [{ id: 3, name: 'Maya', avatar: '🚀', color: '#7ee081' }], photos: { 3: 'data:image/png;base64,BBBB' } } };
  const { data } = readBackup(JSON.stringify(old));
  assert.deepEqual(data.photos, { maya: 'data:image/png;base64,BBBB' });
});

test('per-double hit rates are recorded for darts thrown at a finish', () => {
  const m = E.createMatch({ mode: '501', doubleOut: true, format: 'single' }, [{ id: 31, name: 'Dee' }]);
  m.leg.players[0].score = 32;
  m.leg.turnStart = 32;
  let L = E.throwDart(m.leg, D(16, 1)).leg; // missed D16 -> 16 left
  L = E.throwDart(L, D(8, 2)).leg; // hit D8
  recordLeg(L, [{ id: 31, name: 'Dee' }]);
  assert.deepEqual(statsFor('Dee').dblTargets, { D16: { a: 1, h: 0 }, D8: { a: 1, h: 1 } });
});

test('team play credits turns to the thrower and wins to both members', () => {
  const four = [41, 42, 43, 44].map((id) => ({ id, name: `T${id}` }));
  const m = E.createMatch({ mode: '301', doubleOut: false, format: 'single', teams: true }, four);
  let L = m.leg;
  L = E.nextTurn([D(20, 3), D(20, 3), D(20, 3)].reduce((l, d) => E.throwDart(l, d).leg, L)); // T41 throws 180
  L = E.nextTurn([D(1, 1), D(1, 1), D(1, 1)].reduce((l, d) => E.throwDart(l, d).leg, L)); // T43
  L.players[0].score = 20;
  L.turnStart = 20;
  L = E.throwDart(L, D(20, 1)).leg; // T42 finishes for team A
  recordLeg(L, four);
  assert.equal(statsFor('T41').t180, 1);
  assert.equal(statsFor('T42').checkouts, 1);
  recordMatch(m, L.winners);
  assert.equal(statsFor('T41').wins, 1);
  assert.equal(statsFor('T42').wins, 1);
  assert.equal(statsFor('T43').wins, 0);
});

test('rivalry: wins each, the last five and the streak', () => {
  const h = (w, l) => ({ players: [w, l], winners: [w] });
  const history = [h('Ann', 'Bo'), h('Ann', 'Bo'), h('Bo', 'Ann'), h('Ann', 'Bo'), { players: ['Ann', 'Bo', 'Cy'], winners: ['Bo'] }, { ...h('Bo', 'Ann'), teams: [['Bo'], ['Ann']] }];
  const r = rivalry('ann', 'Bo', history);
  assert.equal(r.played, 4);
  assert.equal(r.a, 3);
  assert.equal(r.b, 1);
  assert.deepEqual(r.last, [true, true, false, true]);
  assert.equal(r.streak, 2);
  assert.equal(r.streakA, true);
});

test('doubles report: best and weakest need enough attempts', () => {
  const s = { dblTargets: { D16: { a: 10, h: 5 }, D20: { a: 8, h: 1 }, D8: { a: 2, h: 2 }, BULL: { a: 4, h: 1 } } };
  const r = doublesReport(s);
  assert.equal(r.rows[0].d, 'D8', 'rows sorted by hit rate');
  assert.equal(r.best.d, 'D16');
  assert.equal(r.best.value, 32);
  assert.equal(r.weak.d, 'D20');
  assert.equal(doublesReport({}).best, null);
});

test('backups carry dart styles and the custom arena, cleaned', () => {
  const evil = {
    app: 'BULLSEYE',
    data: {
      darts: { ' Gabby ': { flight: 'flame', barrel: 'gold', color: '#ff0000' }, x: { flight: '<svg>', barrel: 'lead', color: 'red;x' } },
      prefs: { theme: 'custom', customTheme: { name: '<b>Win</b>', mode: 'light', accent: 'url(x)', wall: 'lava', dark: '#112233' } },
      stats: { a: { name: 'A', dblTargets: { D16: { a: 4, h: 'x' }, D99: { a: 1, h: 1 }, '<i>': { a: 1, h: 1 } } } },
    },
  };
  const { data } = readBackup(JSON.stringify(evil));
  assert.deepEqual(data.darts.gabby, { flight: 'flame', barrel: 'gold', color: '#ff0000' });
  assert.deepEqual(data.darts.x, { flight: 'classic', barrel: 'silver', color: '' });
  assert.equal(data.prefs.theme, 'custom');
  assert.equal(data.prefs.customTheme.accent, '#f5c46b', 'bad colour replaced');
  assert.equal(data.prefs.customTheme.wall, 'panels');
  assert.equal(data.prefs.customTheme.dark, '#112233');
  assert.ok(!/[<>]/.test(data.prefs.customTheme.name));
  assert.deepEqual(data.stats.a.dblTargets, { D16: { a: 4, h: 0 } });
  const noTheme = readBackup(JSON.stringify({ app: 'BULLSEYE', data: { prefs: { theme: 'custom' } } })).data;
  assert.equal(noTheme.prefs.theme, 'championship', 'custom without a theme falls back');
});
