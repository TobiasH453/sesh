import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../server/games/index.js';
import { winnerOf } from '../server/games/ttt.js';
import { normalize } from '../server/games/sketch.js';

// A controllable game context: timers only fire when we say so.
function harness(id, rand = () => 0) {
  const timers = [];
  const events = [[], []];
  const results = [];
  let now = 1_000_000;
  const ctx = {
    rand,
    now: () => now,
    update() {},
    send: (p, data) => events[p].push(data),
    after: (ms, fn) => timers.push({ at: now + ms, fn }),
    record: (w) => results.push(w),
  };
  const game = GAMES[id].create(ctx);
  return {
    game,
    events,
    results,
    view: (p) => game.view(p),
    // Advance time, firing due timers in order.
    tick(ms) {
      now += ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > now) break;
        timers.shift().fn();
      }
    },
  };
}

test('ttt: detects wins and draws', () => {
  assert.deepEqual(winnerOf([0, 0, 0, null, 1, 1, null, null, null]), { winner: 0, line: [0, 1, 2] });
  assert.equal(winnerOf([0, 1, 0, 0, 1, 1, 1, 0, 0]).winner, 'draw');
  assert.equal(winnerOf(Array(9).fill(null)), null);
});

test('ttt: enforces turns and records the winner', () => {
  const { game, results, view } = harness('ttt');
  assert.equal(view(0).turn, 0);
  game.move(1, { cell: 0 }); // not their turn
  assert.equal(view(0).board[0], null);
  for (const [p, cell] of [[0, 0], [1, 3], [0, 1], [1, 4], [0, 2]]) game.move(p, { cell });
  assert.equal(view(0).winner, 0);
  assert.deepEqual(view(1).score, [1, 0]);
  assert.deepEqual(results, [0]);
  game.move(1, { cell: 8 }); // game over, ignored
  assert.equal(view(0).board[8], null);
  game.move(1, { rematch: true });
  assert.equal(view(0).turn, 1, 'starter alternates');
  assert.ok(view(0).board.every((c) => c === null));
});

test('wyr: hides picks until both choose', () => {
  const { game, view } = harness('wyr');
  game.move(0, { pick: 1 });
  assert.equal(view(1).theyPicked, true);
  assert.equal(view(1).picks, null);
  game.move(1, { pick: 1 });
  assert.deepEqual(view(0).picks, [1, 1]);
  assert.equal(view(0).synced, 1);
  game.move(0, { pick: 0 }); // locked after reveal
  assert.deepEqual(view(0).picks, [1, 1]);
  game.move(1, { next: true });
  assert.equal(view(0).revealed, false);
  assert.equal(view(0).yourPick, null);
});

test('quickdraw: early tap is a foul, fastest tap wins, first to 3', () => {
  const { game, view, tick, results } = harness('qd');
  game.move(0, { ready: true });
  assert.equal(view(0).phase, 'ready');
  game.move(1, { ready: true });
  assert.equal(view(0).phase, 'wait');

  game.move(0, { tap: 0 }); // jumped the gun
  assert.equal(view(0).phase, 'result');
  assert.deepEqual(view(0).score, [0, 1]);

  for (let round = 0; round < 3; round++) {
    tick(2200); // result -> wait
    tick(4500); // wait -> go
    assert.equal(view(0).phase, 'go');
    game.move(1, { tap: 400 });
    game.move(0, { tap: 250 });
  }
  assert.equal(view(0).phase, 'over');
  assert.equal(view(0).winner, 0);
  assert.equal(view(0).best[0], 250);
  assert.deepEqual(results, [0]);
});

test('quickdraw: nobody tapping ends the round as a tie', () => {
  const { game, view, tick } = harness('qd');
  game.move(0, { ready: true });
  game.move(1, { ready: true });
  tick(4500);
  assert.equal(view(0).phase, 'go');
  tick(5000);
  assert.equal(view(0).phase, 'result');
  assert.equal(view(0).last.winner, null);
});

test('sketch: only the guesser sees a mask, correct guess scores and swaps', () => {
  const { game, view, events } = harness('sketch');
  const drawer = view(0).drawer;
  const guesser = 1 - drawer;
  const word = view(drawer).word;
  assert.ok(word);
  assert.equal(view(guesser).word, null);
  assert.equal(view(guesser).mask.length, word.length);

  game.move(drawer, { stroke: { pts: [[0.1, 0.1], [2, -1]], c: '#ff0000', w: 5 } });
  assert.deepEqual(events[guesser][0].stroke.pts[1], [1, 0], 'points are clamped');
  game.move(guesser, { stroke: { pts: [[0, 0]], c: '#fff', w: 1 } });
  assert.equal(events[drawer].length, 0, 'guesser cannot draw');

  game.move(guesser, { guess: 'definitely not it' });
  assert.equal(view(0).score, 0);
  game.move(guesser, { guess: word.toUpperCase().replace(/ /g, '') });
  assert.equal(view(0).score, 1);
  assert.equal(view(0).phase, 'reveal');
});

test('sketch: normalize ignores case, spaces and punctuation', () => {
  assert.equal(normalize('Hot-Dog!'), normalize('hot dog'));
});

test('deep: flips forward and back', () => {
  const { game, view } = harness('deep');
  const first = view(0).card;
  game.move(1, { next: true });
  assert.notEqual(view(0).card, first);
  assert.equal(view(1).byYou, true);
  game.move(0, { prev: true });
  assert.equal(view(0).card, first);
});
