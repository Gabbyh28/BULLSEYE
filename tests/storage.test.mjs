// Stats, head-to-head and backup/restore tests. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { load, recordLeg, recordMatch, statsFor, exportBackup, readBackup, restoreBackup, photoKey } from '../js/storage.js';

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
