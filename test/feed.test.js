import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankForYou } from '../server/feed.js';

const HOUR = 3600_000;
const now = 100 * HOUR;
const vid = (id, o = {}) => ({ id, user_id: 2, created_at: now - HOUR, likes: 0, comments: 0, views: 0, ...o });
const ctx = (o = {}) => ({ now, viewerId: 1, seen: new Map(), affinity: new Map(), rand: () => 0.5, ...o });
const ids = (list) => list.map((v) => v.id);

test('unseen clips come before seen ones', () => {
  const ranked = rankForYou([vid('seen', { likes: 50 }), vid('new')], ctx({ seen: new Map([['seen', 1]]) }));
  assert.deepEqual(ids(ranked), ['new', 'seen']);
});

test('engagement and freshness both count', () => {
  const ranked = rankForYou(
    [vid('old', { created_at: now - 72 * HOUR, likes: 3 }), vid('fresh'), vid('liked', { likes: 5 })],
    ctx(),
  );
  assert.deepEqual(ids(ranked), ['liked', 'fresh', 'old']);
});

test('people you like float up, your own clips sink', () => {
  const ranked = rankForYou(
    [vid('mine', { user_id: 1 }), vid('stranger', { user_id: 3 }), vid('friend', { user_id: 4 })],
    ctx({ affinity: new Map([[4, 4]]) }),
  );
  assert.deepEqual(ids(ranked), ['friend', 'stranger', 'mine']);
});
