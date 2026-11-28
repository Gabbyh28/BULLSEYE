// Rules-engine tests. Run with: npm test  (Node 18+, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';

const D = E.makeDart;
const roster = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));
const throwAll = (leg, darts) => darts.reduce((l, d) => E.throwDart(l, d).leg, leg);
const points = (label) => (label === 'BULL' ? 50 : label === '25' ? 25 : { T: 3, D: 2, S: 1 }[label[0]] * Number(label.slice(1)));

test('board geometry scores the right beds', () => {
  assert.equal(E.scoreAt(0, -103).label, 'T20');
  assert.equal(E.scoreAt(0, -165).label, 'D20');
  assert.equal(E.scoreAt(0, 103).label, 'T3');
  assert.equal(E.scoreAt(103, 0).label, 'T6');
  assert.equal(E.scoreAt(-103, 0).label, 'T11');
  assert.equal(E.scoreAt(0, 0).label, 'BULL');
  assert.equal(E.scoreAt(0, 14).label, '25');
  assert.equal(E.scoreAt(0, 200).label, 'MISS');
});

test('widened beds: treble and double rings are 15mm, bull is wider', () => {
  assert.equal(E.R.trebleOut - E.R.trebleIn, 15);
  assert.equal(E.R.doubleOut - E.R.doubleIn, 15);
  assert.ok(E.R.bull > 6.35 && E.R.outerBull > 15.9);
});

test('keypad landing points fall inside the bed they claim', () => {
  for (const v of E.SECTORS) for (const m of [1, 2, 3]) {
    for (let k = 0; k < 20; k++) {
      const p = E.randomPointFor(v, m);
      assert.equal(E.scoreAt(p.x, p.y).label, E.dartLabel(v, m), `${v}x${m}`);
    }
  }
  for (const m of [1, 2]) {
    const p = E.randomPointFor(25, m);
    assert.equal(E.scoreAt(p.x, p.y).label, E.dartLabel(25, m));
  }
});

test('checkout routes are valid for every finishable score', () => {
  const bogey = [159, 162, 163, 165, 166, 168, 169];
  for (let s = 2; s <= 170; s++) {
    const route = E.checkout(s);
    if (bogey.includes(s)) {
      assert.equal(route, null, `${s} should have no checkout`);
      continue;
    }
    assert.ok(route, `missing route for ${s}`);
    assert.equal(route.reduce((a, l) => a + points(l), 0), s, `route for ${s} adds up`);
    const last = route.at(-1);
    assert.ok(last[0] === 'D' || last === 'BULL', `route for ${s} ends on a double`);
  }
  assert.deepEqual(E.checkout(170), ['T20', 'T20', 'BULL']);
  assert.deepEqual(E.checkout(40), ['D20']);
  assert.deepEqual(E.checkout(101, 2), ['T17', 'BULL']);
  assert.equal(E.checkout(1), null);
});

test('X01: bust on 1 left or overshoot, checkout on a double', () => {
  const m = E.createMatch({ mode: '301', doubleOut: true, format: 'single' }, roster(2));
  const L = m.leg;
  L.players[0].score = 40;
  L.turnStart = 40;
  let r = E.throwDart(L, D(20, 1));
  r = E.throwDart(r.leg, D(19, 1));
  assert.ok(r.events.includes('bust'));
  assert.equal(r.leg.players[0].score, 40, 'score reverts to turn start');
  assert.ok(r.leg.turnDone);

  const next = E.nextTurn(r.leg);
  assert.equal(next.current, 1);
  const back = E.nextTurn(throwAll(next, [D(1, 1), D(1, 1), D(1, 1)]));
  const win = E.throwDart(back, D(20, 2));
  assert.deepEqual(win.leg.winners, [1]);
  assert.ok(win.events.includes('checkout'));
  assert.equal(E.commitLeg({ ...m, leg: win.leg }).outcome.type, 'match');
});

test('X01 without double-out finishes on any dart; legs rotate the starter', () => {
  const m = E.createMatch({ mode: '501', doubleOut: false, format: 'legs', legs: 2, sets: 1 }, roster(2));
  m.leg.players[0].score = 60;
  m.leg.turnStart = 60;
  const r = E.throwDart(m.leg, D(20, 3));
  assert.deepEqual(r.leg.winners, [1]);
  const c = E.commitLeg({ ...m, leg: r.leg });
  assert.equal(c.outcome.type, 'leg');
  assert.equal(c.match.leg.players[0].pid, 2, 'player 2 throws first in leg 2');
  assert.equal(c.match.legWins[1], 1);
});

test('180 and ton events', () => {
  const m = E.createMatch({ mode: '501', doubleOut: true, format: 'single' }, roster(1));
  const r = E.throwDart(E.throwDart(E.throwDart(m.leg, D(20, 3)).leg, D(20, 3)).leg, D(20, 3));
  assert.ok(r.events.includes('180'));
  assert.equal(r.leg.turns.at(-1).counted, 180);
});

test('Cricket: marks close numbers, extra marks score while others are open', () => {
  const m = E.createMatch({ mode: 'cricket', format: 'single' }, roster(2));
  let r = E.throwDart(m.leg, D(20, 3));
  assert.equal(r.leg.players[0].marks['20'], 3);
  r = E.throwDart(r.leg, D(20, 3));
  assert.equal(r.leg.players[0].score, 60);
});

test('Around the Clock: 1 to 20 then bull', () => {
  const m = E.createMatch({ mode: 'around', format: 'single' }, roster(1));
  let L = m.leg;
  for (let v = 1; v <= 20; v++) {
    L = E.throwDart(L, D(v, 1)).leg;
    if (L.turnDone) L = E.nextTurn(L);
  }
  L = E.throwDart(L, D(25, 1)).leg;
  assert.deepEqual(L.winners, [1]);
});

test('Shanghai: single, double and treble of the round wins instantly', () => {
  const m = E.createMatch({ mode: 'shanghai', format: 'single' }, roster(1));
  const r = E.throwDart(E.throwDart(E.throwDart(m.leg, D(1, 1)).leg, D(1, 2)).leg, D(1, 3));
  assert.ok(r.events.includes('shanghai'));
});

test('Killer: charge your number, then take lives', () => {
  const m = E.createMatch({ mode: 'killer', format: 'single' }, roster(2));
  const [a, b] = m.leg.players.map((p) => p.target);
  assert.notEqual(a, b, 'targets are unique');
  let r = E.throwDart(m.leg, D(a, 3));
  assert.ok(r.leg.players[0].killer);
  r = E.throwDart(r.leg, D(b, 3));
  assert.deepEqual(r.leg.winners, [1]);
});

test('High Score: highest total after 8 rounds wins', () => {
  const m = E.createMatch({ mode: 'highscore', format: 'single' }, roster(2));
  let L = m.leg;
  for (let i = 0; i < 16; i++) {
    L = throwAll(L, [0, 1, 2].map(() => D(i % 2 ? 20 : 5, 1)));
    if (!L.winners) L = E.nextTurn(L);
  }
  assert.equal(L.round, 8);
  assert.deepEqual(L.winners, [2]);
});

test('Knockout tournament with byes runs to a champion', () => {
  for (const n of [3, 5, 8]) {
    let m = E.createMatch({ mode: '301', doubleOut: false, format: 'tournament', legs: 1 }, roster(n));
    let guard = 0;
    let type;
    while (!m.finished && guard++ < 20) {
      m.leg.players[0].score = 20;
      m.leg.turnStart = 20;
      const r = E.throwDart(m.leg, D(20, 1));
      const c = E.commitLeg({ ...m, leg: r.leg });
      m = c.match;
      type = c.outcome.type;
    }
    assert.ok(m.finished, `${n} players finish`);
    assert.equal(type, 'tournament');
    assert.equal(guard, n - 1, `${n} players need ${n - 1} matches`);
  }
});

test('throwDart never mutates its input (undo relies on this)', () => {
  const m = E.createMatch({ mode: '501', doubleOut: true, format: 'single' }, roster(2));
  const before = JSON.stringify(m.leg);
  E.throwDart(m.leg, D(20, 3));
  assert.equal(JSON.stringify(m.leg), before);
});

test('turn records carry the standing after the turn, and finished legs are logged', () => {
  const m = E.createMatch({ mode: '301', doubleOut: false, format: 'legs', legs: 2 }, roster(2));
  let L = throwAll(m.leg, [D(20, 3), D(20, 3), D(20, 1)]);
  assert.equal(L.turns.at(-1).after, 301 - 140);
  L = E.nextTurn(L);
  L.players[1].score = 20;
  L.turnStart = 20;
  L = E.throwDart(L, D(20, 1)).leg;
  const c = E.commitLeg({ ...m, leg: L });
  assert.equal(c.match.legLog.length, 1);
  assert.equal(c.match.legLog[0].turns.length, 2);
  assert.equal(c.match.legLog[0].turns[1].after, 0);
  assert.equal(c.match.legLog[0].turns[0].darts[0].x, undefined, 'coordinates are dropped');
});

test('teams: 4 players make two teams that share a score and alternate throwers', () => {
  const m = E.createMatch({ mode: '501', doubleOut: true, format: 'single', teams: true }, roster(4));
  assert.equal(m.teams.length, 2);
  assert.deepEqual(m.teams[0].members, [1, 2]);
  let L = m.leg;
  assert.equal(L.players.length, 2, 'two scoring units');
  assert.equal(E.currentThrower(L), 1);
  L = E.nextTurn(throwAll(L, [D(20, 3), D(20, 3), D(20, 3)]));
  assert.equal(E.currentThrower(L), 3, 'team B, first member');
  L = E.nextTurn(throwAll(L, [D(1, 1), D(1, 1), D(1, 1)]));
  assert.equal(E.currentThrower(L), 2, 'team A, second member');
  assert.equal(L.players[0].score, 321, 'team score shared');
  L = throwAll(L, [D(20, 1)]);
  assert.equal(L.turn.length, 1);
  const rec = E.nextTurn(throwAll(L, [D(20, 1), D(20, 1)])).turns.at(-1);
  assert.equal(rec.thrower, 2, 'turn credited to the member who threw');
  assert.equal(rec.pid, m.teams[0].id);
});

test('teams are ignored for knockouts and odd player counts', () => {
  assert.equal(E.createMatch({ mode: '501', format: 'tournament', teams: true }, roster(4)).teams, null);
  assert.equal(E.createMatch({ mode: '501', format: 'single', teams: true }, roster(3)).teams, null);
});

test('team legs: the next leg keeps the teams and rotates the starter', () => {
  const m = E.createMatch({ mode: '301', doubleOut: false, format: 'legs', legs: 2, teams: true }, roster(4));
  m.leg.players[0].score = 20;
  m.leg.turnStart = 20;
  const r = E.throwDart(m.leg, D(20, 1));
  const c = E.commitLeg({ ...m, leg: r.leg });
  assert.equal(c.match.leg.players.length, 2);
  assert.equal(c.match.leg.players[0].pid, m.teams[1].id, 'team B starts leg 2');
  assert.deepEqual(c.match.leg.players[0].members, [3, 4]);
});
