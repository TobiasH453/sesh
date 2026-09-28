// The "algorithm". Deliberately small: engagement decays with age, people
// you like float up, and a bit of noise keeps the order from being identical
// every time. Anything you've already watched goes behind everything you
// haven't, so the feed only repeats once you've seen it all.

const HOUR = 60 * 60 * 1000;

export function scoreVideo(v, ctx) {
  const ageHours = Math.max(0, (ctx.now - v.created_at) / HOUR);
  const engagement = 1 + v.likes * 3 + v.comments * 2 + v.views * 0.5;
  let score = engagement / Math.pow(ageHours + 2, 1.2);

  const affinity = ctx.affinity.get(v.user_id) || 0;
  score *= 1 + 0.25 * Math.min(affinity, 8);

  if (v.user_id === ctx.viewerId) score *= 0.3;

  const seen = ctx.seen.get(v.id);
  if (seen) score /= seen;

  return score * (0.75 + ctx.rand() * 0.5);
}

export function rankForYou(videos, ctx) {
  return videos
    .map((v) => ({ v, seen: ctx.seen.has(v.id), s: scoreVideo(v, ctx) }))
    .sort((a, b) => a.seen - b.seen || b.s - a.s)
    .map((x) => x.v);
}
