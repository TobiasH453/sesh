import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../server/index.js';

let app;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesh-test-'));
  app = createApp({ dataDir, inviteCode: 'letmein', transcode: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => {
  app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { cookie, body, raw, type } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (type) headers['content-type'] = type;
  const res = await fetch(base + url, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const setCookie = res.headers.get('set-cookie');
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, cookie: setCookie?.split(';')[0], headers: res.headers };
}

async function signup(handle) {
  const r = await call('POST', '/api/signup', { body: { handle, password: 'hunter2', code: 'letmein' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.cookie;
}

function socket(cookie) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie, origin: base } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('timed out waiting for message')), 3000);
      });
    },
    open: () => new Promise((r) => ws.once('open', r)),
  };
}

let alice;
let bob;

test('signup needs the invite code and a unique handle', async () => {
  let r = await call('POST', '/api/signup', { body: { handle: 'alice', password: 'hunter2', code: 'nope' } });
  assert.equal(r.status, 403);
  alice = await signup('alice');
  bob = await signup('bob');
  r = await call('POST', '/api/signup', { body: { handle: 'ALICE', password: 'hunter2', code: 'letmein' } });
  assert.equal(r.status, 409);
  r = await call('POST', '/api/login', { body: { handle: 'alice', password: 'wrong' } });
  assert.equal(r.status, 401);
  r = await call('GET', '/api/me', { cookie: alice });
  assert.equal(r.data.user.handle, 'alice');
});

test('the api and media are private', async () => {
  assert.equal((await call('POST', '/api/feed', { body: {} })).status, 401);
  assert.equal((await call('GET', '/media/abc.mp4')).status, 401);
});

test('upload, feed, like, comment, delete', async () => {
  const bytes = Buffer.alloc(4096, 7);
  let r = await call('POST', '/api/videos?caption=first%20one&duration=3&width=720&height=1280', { cookie: alice, raw: bytes, type: 'video/mp4' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const video = r.data.video;
  assert.equal(video.caption, 'first one');
  assert.equal(video.mine, true);

  r = await call('POST', '/api/videos', { cookie: alice, raw: 'x', type: 'text/plain' });
  assert.equal(r.status, 415);

  r = await call('PUT', `/api/videos/${video.id}/thumb`, { cookie: bob, raw: Buffer.alloc(10), type: 'image/jpeg' });
  assert.equal(r.status, 403, 'only the owner sets a thumb');

  // Range requests are what make video seeking work on iOS.
  const media = await fetch(base + video.src, { headers: { cookie: bob, range: 'bytes=100-199' } });
  assert.equal(media.status, 206);
  assert.equal(media.headers.get('content-range'), 'bytes 100-199/4096');
  assert.equal((await media.arrayBuffer()).byteLength, 100);

  r = await call('POST', '/api/feed', { cookie: bob, body: { mode: 'foryou' } });
  assert.deepEqual(r.data.videos.map((v) => v.id), [video.id]);
  assert.equal(r.data.done, true);

  r = await call('POST', `/api/videos/${video.id}/like`, { cookie: bob, body: {} });
  assert.deepEqual(r.data, { liked: true, likes: 1 });
  r = await call('POST', `/api/videos/${video.id}/like`, { cookie: bob, body: {} });
  assert.equal(r.data.likes, 1, 'liking twice is idempotent');

  r = await call('POST', `/api/videos/${video.id}/comments`, { cookie: bob, body: { body: 'lol' } });
  assert.equal(r.data.comment.body, 'lol');
  r = await call('GET', `/api/videos/${video.id}/comments`, { cookie: alice });
  assert.equal(r.data.comments[0].canDelete, true, 'video owner can moderate');

  r = await call('POST', `/api/videos/${video.id}/view`, { cookie: bob, body: { watched: 3 } });
  assert.equal(r.status, 200);
  r = await call('GET', `/api/videos/${video.id}`, { cookie: bob });
  assert.equal(r.data.video.views, 1);
  assert.equal(r.data.video.liked, true);
  assert.equal(r.data.video.comments, 1);

  r = await call('GET', '/api/users/alice', { cookie: bob });
  assert.equal(r.data.stats.likes, 1);
  assert.equal(r.data.videos.length, 1);

  assert.equal((await call('DELETE', `/api/videos/${video.id}`, { cookie: bob })).status, 403);
  assert.equal((await call('DELETE', `/api/videos/${video.id}`, { cookie: alice })).status, 200);
  assert.equal((await call('GET', `/api/videos/${video.id}`, { cookie: bob })).status, 404);
});

test('sweep removes stale files nothing references', async () => {
  const uploads = path.join(dataDir, 'uploads');
  const stale = path.join(uploads, 'orphan.mp4');
  const fresh = path.join(uploads, 'inflight.mp4');
  fs.writeFileSync(stale, 'x');
  fs.writeFileSync(fresh, 'x');
  const hourAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(stale, hourAgo, hourAgo);
  const r = await call('POST', '/api/videos', { cookie: alice, raw: Buffer.alloc(64, 1), type: 'video/webm' });
  const kept = path.join(uploads, path.basename(r.data.video.src));
  fs.utimesSync(kept, hourAgo, hourAgo);

  app.sweep();
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(fresh), true, 'recent files may be in-flight uploads');
  assert.equal(fs.existsSync(kept), true, 'referenced clips stay');
  await call('DELETE', `/api/videos/${r.data.video.id}`, { cookie: alice });
});

test('client routes fall back to the app shell, missing assets 404', async () => {
  let r = await call('GET', '/u/some.handle');
  assert.equal(r.status, 200);
  assert.match(r.data, /<div id="app">/);
  r = await call('GET', '/js/nope.js');
  assert.equal(r.status, 404);
});

test('live: match, relay signals, chat, play a game, skip', async () => {
  const a = socket(alice);
  const b = socket(bob);
  await Promise.all([a.open(), b.open()]);
  await a.next((m) => m.t === 'hello');
  await b.next((m) => m.t === 'hello');

  a.send({ t: 'queue' });
  b.send({ t: 'queue' });
  const ma = await a.next((m) => m.t === 'matched');
  const mb = await b.next((m) => m.t === 'matched');
  assert.equal(ma.partner.handle, 'bob');
  assert.equal(mb.partner.handle, 'alice');
  assert.notEqual(ma.initiator, mb.initiator);

  a.send({ t: 'signal', matchId: ma.matchId, data: { sdp: { type: 'offer', sdp: 'x' } } });
  const sig = await b.next((m) => m.t === 'signal');
  assert.equal(sig.data.sdp.type, 'offer');

  b.send({ t: 'chat', text: '  yo  ' });
  assert.equal((await a.next((m) => m.t === 'chat')).text, 'yo');

  a.send({ t: 'game:start', game: 'ttt' });
  const ga = await a.next((m) => m.t === 'game');
  const gb = await b.next((m) => m.t === 'game');
  assert.equal(ga.game.id, 'ttt');
  const players = { [ga.state.you]: a, [gb.state.you]: b };
  const first = players[ga.state.turn];
  const second = players[1 - ga.state.turn];
  for (const [who, cell] of [[first, 0], [second, 3], [first, 1], [second, 4], [first, 2]]) {
    who.send({ t: 'game:move', move: { cell } });
    await a.next((m) => m.t === 'game');
    await b.next((m) => m.t === 'game');
  }
  const winnerHandle = first === a ? 'alice' : 'bob';
  const r = await call('GET', `/api/users/${winnerHandle}`, { cookie: alice });
  assert.equal(r.data.stats.wins.ttt, 1);

  // Skipping puts both back in the queue; the cooldown keeps them apart.
  a.send({ t: 'next' });
  await b.next((m) => m.t === 'partner-left');
  await a.next((m) => m.t === 'queued');
  await new Promise((res) => setTimeout(res, 300));
  const rematch = [...(await Promise.race([
    a.next((m) => m.t === 'matched').then(() => ['matched']),
    new Promise((res) => setTimeout(() => res(['apart']), 1500)),
  ]))];
  assert.deepEqual(rematch, ['apart']);

  a.ws.close();
  b.ws.close();
});

test('live: rejects sockets without a session', async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const err = await new Promise((r) => ws.on('error', r));
  assert.match(String(err.message), /401/);
});
