// Co-op pictionary. One draws, the other guesses, swap every round.
// Strokes are relayed as events rather than kept in the view so a long
// drawing doesn't get re-sent on every guess.

import { SKETCH_WORDS, shuffled } from './decks.js';

const ROUNDS = 4;
const ROUND_MS = 75_000;
const REVEAL_MS = 3500;

export const normalize = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');

export default {
  id: 'sketch',
  name: 'Sketch',
  blurb: 'One draws, one guesses. Four rounds, keep the streak.',
  create(ctx) {
    const order = shuffled(SKETCH_WORDS, ctx.rand);
    const s = {
      phase: 'draw', // draw | reveal | over
      seq: 0,
      round: 0,
      drawer: Math.floor(ctx.rand() * 2),
      word: '',
      endsAt: 0,
      guesses: [],
      score: 0,
      solved: false,
    };

    function startRound() {
      s.round++;
      if (s.round > 1) s.drawer = 1 - s.drawer;
      s.word = SKETCH_WORDS[order[(s.round - 1) % order.length]];
      s.guesses = [];
      s.solved = false;
      s.phase = 'draw';
      s.endsAt = ctx.now() + ROUND_MS;
      const seq = ++s.seq;
      ctx.after(ROUND_MS, () => s.seq === seq && endRound());
    }

    function endRound() {
      const seq = ++s.seq;
      if (s.round >= ROUNDS) {
        s.phase = 'over';
        return ctx.update();
      }
      s.phase = 'reveal';
      ctx.update();
      ctx.after(REVEAL_MS, () => {
        if (s.seq !== seq) return;
        startRound();
        ctx.update();
      });
    }

    startRound();

    return {
      move(p, msg) {
        const drawing = s.phase === 'draw';
        if (msg.stroke && drawing && p === s.drawer) {
          const { pts, c, w } = msg.stroke;
          if (!Array.isArray(pts) || pts.length > 400) return;
          const clean = pts
            .filter((pt) => Array.isArray(pt) && pt.length === 2)
            .map(([x, y]) => [Math.min(1, Math.max(0, +x || 0)), Math.min(1, Math.max(0, +y || 0))]);
          const stroke = { pts: clean, c: /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff', w: Math.min(40, Math.max(1, +w || 4)) };
          return ctx.send(1 - p, { stroke });
        }
        if (msg.clear && drawing && p === s.drawer) {
          return ctx.send(1 - p, { clear: true });
        }
        if (msg.skip && drawing && p === s.drawer) {
          return endRound();
        }
        if (typeof msg.guess === 'string' && drawing && p !== s.drawer) {
          const text = msg.guess.trim().slice(0, 40);
          if (!text) return;
          const correct = normalize(text) === normalize(s.word);
          s.guesses.push({ text, correct });
          if (s.guesses.length > 30) s.guesses.shift();
          if (correct) {
            s.solved = true;
            s.score++;
            return endRound();
          }
          return ctx.update();
        }
        if (msg.rematch && s.phase === 'over') {
          s.round = 0;
          s.score = 0;
          startRound();
          ctx.update();
        }
      },
      view(p) {
        const showWord = p === s.drawer || s.phase !== 'draw';
        return {
          phase: s.phase,
          round: s.round,
          rounds: ROUNDS,
          drawer: s.drawer,
          you: p,
          word: showWord ? s.word : null,
          mask: s.word.replace(/[a-z0-9]/gi, '_'),
          remaining: Math.max(0, s.endsAt - ctx.now()),
          guesses: s.guesses,
          score: s.score,
          solved: s.solved,
        };
      },
    };
  },
};
