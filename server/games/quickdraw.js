// Reaction duel. The server decides when "go" happens; each client measures
// its own reaction time from the moment it rendered "go", so network lag
// doesn't pick the winner. Honor system, it's your friends.

const TO_WIN = 3;
const MAX_MS = 3000;

export default {
  id: 'qd',
  name: 'Quick Draw',
  blurb: 'Wait for it. Tap first. Jump early and you lose the round.',
  create(ctx) {
    const s = {
      phase: 'ready', // ready | wait | go | result | over
      seq: 0,
      round: 0,
      score: [0, 0],
      ready: [false, false],
      taps: [null, null],
      last: null,
      best: [null, null],
      winner: null,
    };

    function phase(name) {
      s.phase = name;
      s.seq++;
      return s.seq;
    }

    function startRound() {
      s.round++;
      s.taps = [null, null];
      const seq = phase('wait');
      ctx.after(1500 + ctx.rand() * 3000, () => {
        if (s.seq !== seq) return;
        const goSeq = phase('go');
        ctx.update();
        ctx.after(MAX_MS + 1500, () => {
          if (s.seq !== goSeq) return;
          finishRound(null);
        });
      });
    }

    function finishRound(foul) {
      let winner;
      if (foul !== null) {
        winner = 1 - foul;
      } else {
        const [a, b] = s.taps.map((t) => (t === null ? Infinity : t));
        winner = a === b ? null : a < b ? 0 : 1;
      }
      if (winner !== null) s.score[winner]++;
      for (const p of [0, 1]) {
        const t = s.taps[p];
        if (foul === null && t !== null && (s.best[p] === null || t < s.best[p])) s.best[p] = t;
      }
      s.last = { winner, times: [...s.taps], foul };

      if (winner !== null && s.score[winner] >= TO_WIN) {
        s.winner = winner;
        phase('over');
        ctx.record(winner);
        return ctx.update();
      }
      const seq = phase('result');
      ctx.update();
      ctx.after(2200, () => {
        if (s.seq !== seq) return;
        startRound();
        ctx.update();
      });
    }

    return {
      move(p, msg) {
        if (msg.ready && s.phase === 'ready') {
          s.ready[p] = true;
          if (s.ready[0] && s.ready[1]) startRound();
          return ctx.update();
        }
        if (msg.rematch && s.phase === 'over') {
          Object.assign(s, { round: 0, score: [0, 0], ready: [false, false], last: null, winner: null });
          phase('ready');
          return ctx.update();
        }
        if (msg.tap !== undefined) {
          if (s.phase === 'wait') return finishRound(p);
          if (s.phase !== 'go' || s.taps[p] !== null) return;
          const ms = Number(msg.tap);
          s.taps[p] = Number.isFinite(ms) ? Math.round(Math.min(Math.max(ms, 0), MAX_MS)) : MAX_MS;
          if (s.taps[0] !== null && s.taps[1] !== null) finishRound(null);
          else ctx.update();
        }
      },
      view(p) {
        const { seq, ...rest } = s;
        return { ...rest, you: p, toWin: TO_WIN };
      },
    };
  },
};
