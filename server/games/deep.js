import { DEEP_THOUGHTS, shuffled } from './decks.js';

export default {
  id: 'deep',
  name: 'Deep Thoughts',
  blurb: 'A deck of questions for when the conversation needs a nudge.',
  create(ctx) {
    const s = { order: shuffled(DEEP_THOUGHTS, ctx.rand), i: 0, by: null };

    return {
      move(p, msg) {
        if (msg.next) s.i = (s.i + 1) % s.order.length;
        else if (msg.prev) s.i = (s.i - 1 + s.order.length) % s.order.length;
        else return;
        s.by = p;
        ctx.update();
      },
      view(p) {
        return {
          card: DEEP_THOUGHTS[s.order[s.i]],
          n: s.i + 1,
          total: s.order.length,
          byYou: s.by === p,
          by: s.by,
        };
      },
    };
  },
};
