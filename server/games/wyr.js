import { WOULD_YOU_RATHER, shuffled } from './decks.js';

export default {
  id: 'wyr',
  name: 'Would You Rather',
  blurb: 'Both pick in secret. See if you are on the same wavelength.',
  create(ctx) {
    const s = {
      order: shuffled(WOULD_YOU_RATHER, ctx.rand),
      i: 0,
      picks: [null, null],
      revealed: false,
      rounds: 0,
      synced: 0,
    };

    return {
      move(p, msg) {
        if (msg.next) {
          if (!s.revealed) return;
          s.i = (s.i + 1) % s.order.length;
          s.picks = [null, null];
          s.revealed = false;
          return ctx.update();
        }
        if (s.revealed || (msg.pick !== 0 && msg.pick !== 1)) return;
        s.picks[p] = msg.pick;
        if (s.picks[0] !== null && s.picks[1] !== null) {
          s.revealed = true;
          s.rounds++;
          if (s.picks[0] === s.picks[1]) s.synced++;
        }
        ctx.update();
      },
      view(p) {
        const [a, b] = WOULD_YOU_RATHER[s.order[s.i]];
        return {
          a,
          b,
          you: p,
          yourPick: s.picks[p],
          theyPicked: s.picks[1 - p] !== null,
          picks: s.revealed ? s.picks : null,
          revealed: s.revealed,
          rounds: s.rounds,
          synced: s.synced,
        };
      },
    };
  },
};
