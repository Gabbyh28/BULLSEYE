// Achievement rules. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { earnedBadges, BADGES } from '../js/achievements.js';

const D = E.makeDart;
const roster = [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }];
const throwAll = (leg, darts) => darts.reduce((l, d) => E.throwDart(l, d).leg, leg);
const ids = (list, name) => list.filter((b) => b.name === name).map((b) => b.id).sort();
const finish = (m, leg) => {
  const c = E.commitLeg({ ...m, leg });
  return { leg, match: m, outcome: c.outcome, next: c.match };
};

test('every badge has a unique id', () => {
  assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length);
});

test('a 180 and a 170 checkout in a first win', () => {
  const m = E.createMatch({ mode: '501', doubleOut: true, format: 'single' }, roster);
  let L = E.nextTurn(throwAll(m.leg, [D(20, 3), D(20, 3), D(20, 3)])); // Ann 180 -> 321
  L = E.nextTurn(throwAll(L, [D(1, 1), D(1, 1), D(1, 1)]));
  L.players[0].score = 170;
  L.turnStart = 170;
  L = throwAll(L, [D(20, 3), D(20, 3), D(25, 2)]);
  const got = earnedBadges({ ...finish(m, L) });
  assert.deepEqual(ids(got, 'Ann'), ['bigFish', 'bullFinish', 'firstWin', 'max', 'ton', 'ton40', 'tonOut', 'trebles'].sort());
  assert.deepEqual(ids(got, 'Bo'), []);
});

test('badges already owned are not given again', () => {
  const m = E.createMatch({ mode: '501', doubleOut: false, format: 'single' }, roster);
  const L = throwAll(m.leg, [D(20, 3), D(20, 3), D(20, 3)]);
  const got = earnedBadges({ leg: L, match: m, have: { ann: { max: 1, ton: 1 } } });
  assert.deepEqual(ids(got, 'Ann'), ['ton40', 'trebles']);
});

test('bed and breakfast, bag of nuts and three trebles', () => {
  const m = E.createMatch({ mode: '501', doubleOut: false, format: 'single' }, roster);
  let L = E.nextTurn(throwAll(m.leg, [D(20, 1), D(5, 1), D(1, 1)])); // 26
  L = E.nextTurn(throwAll(L, [D(20, 1), D(20, 1), D(5, 1)])); // 45
  L = throwAll(L, [D(5, 3), D(1, 3), D(20, 3)]);
  const got = earnedBadges({ leg: L, match: m });
  assert.deepEqual(ids(got, 'Ann'), ['bnb', 'trebles']);
  assert.deepEqual(ids(got, 'Bo'), ['nuts']);
});

test('a nine-darter is also a fast leg; comeback from 100+ behind', () => {
  const m = E.createMatch({ mode: '501', doubleOut: true, format: 'single' }, roster);
  let L = m.leg;
  L = E.nextTurn(throwAll(L, [D(20, 3), D(20, 3), D(20, 3)])); // Ann 321
  L = E.nextTurn(throwAll(L, [D(20, 3), D(20, 3), D(20, 3)])); // Bo 321
  L = E.nextTurn(throwAll(L, [D(20, 3), D(20, 3), D(20, 3)])); // Ann 141
  L = E.nextTurn(throwAll(L, [D(1, 1), D(1, 1), D(1, 1)])); // Bo
  L = throwAll(L, [D(20, 3), D(19, 3), D(12, 2)]); // Ann 141 → 0: nine darts
  const got = earnedBadges({ ...finish(m, L) });
  assert.ok(ids(got, 'Ann').includes('nine'));
  assert.ok(ids(got, 'Ann').includes('fastLeg'));

  const m2 = E.createMatch({ mode: '301', doubleOut: false, format: 'single' }, roster);
  let K = E.nextTurn(throwAll(m2.leg, [D(1, 1), D(1, 1), D(1, 1)])); // Ann 298
  K = E.nextTurn(throwAll(K, [D(20, 3), D(20, 3), D(20, 3)])); // Bo 121: Ann 177 behind
  K.players[0].score = 20;
  K.turnStart = 20;
  K = throwAll(K, [D(20, 1)]);
  assert.ok(ids(earnedBadges({ ...finish(m2, K) }), 'Ann').includes('comeback'));
});

test('team win, whitewash, streak and veteran at the end of a match', () => {
  const four = [1, 2, 3, 4].map((id) => ({ id, name: `P${id}` }));
  const m = E.createMatch({ mode: '301', doubleOut: false, format: 'legs', legs: 2, teams: true }, four);
  // team A wins leg 1
  let L = m.leg;
  L.players[0].score = 20;
  L.turnStart = 20;
  L = E.throwDart(L, D(20, 1)).leg;
  let c = E.commitLeg({ ...m, leg: L });
  // team A wins leg 2 (team B throws first)
  let L2 = E.nextTurn(throwAll(c.match.leg, [D(1, 1), D(1, 1), D(1, 1)]));
  L2.players[1].score = 20;
  L2.turnStart = 20;
  L2 = E.throwDart(L2, D(20, 1)).leg;
  const m2 = c.match;
  c = E.commitLeg({ ...m2, leg: L2 });
  assert.equal(c.outcome.type, 'match');
  const history = [{ players: ['P1', 'X'], winners: ['P1'] }, { players: ['P1', 'Y'], winners: ['P1'] }];
  const got = earnedBadges({ leg: L2, match: m2, outcome: c.outcome, next: c.match, history, stats: { p3: { games: 9 } } });
  assert.ok(ids(got, 'P1').includes('teamWin') && ids(got, 'P2').includes('teamWin'));
  assert.ok(ids(got, 'P1').includes('whitewash'));
  assert.ok(ids(got, 'P1').includes('streak3'));
  assert.ok(!ids(got, 'P2').includes('streak3'));
  assert.ok(ids(got, 'P3').includes('games10'));
  assert.ok(!ids(got, 'P3').includes('teamWin'));
});
