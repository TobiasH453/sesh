// Live: presence, a random matchmaking queue, WebRTC signaling relay and
// server-authoritative mini games for each matched pair.

import { WebSocketServer } from 'ws';
import { GAMES, catalog } from './games/index.js';

const REMATCH_COOLDOWN_MS = 8000;
const RANK = { idle: 0, waiting: 1, live: 2 };

export function createLive({ server, auth, db }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const clients = new Set();
  const queue = [];
  let nextId = 1;
  let presenceTimer = null;

  const insertResult = db.prepare(
    'INSERT INTO game_results (game, winner_id, loser_id, created_at) VALUES (?, ?, ?, ?)',
  );

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== '/ws') return socket.destroy();
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && new URL(origin).host !== host) return socket.destroy();
    const user = auth.userFromRequest(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, user));
  });

  function send(c, msg) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  function presence() {
    const byUser = new Map();
    for (const c of clients) {
      const prev = byUser.get(c.user.id);
      if (!prev || RANK[c.status] > RANK[prev.status]) {
        byUser.set(c.user.id, { handle: c.user.handle, status: c.status });
      }
    }
    return [...byUser.values()].sort((a, b) => a.handle.localeCompare(b.handle));
  }

  function broadcastPresence() {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      const msg = { t: 'presence', people: presence() };
      for (const c of clients) send(c, msg);
    }, 150);
  }

  function connect(ws, user) {
    const c = { id: nextId++, ws, user, status: 'idle', match: null, lastPartner: null, lastPartnerAt: 0, queuedAt: 0, alive: true };
    clients.add(c);
    send(c, { t: 'hello', you: user.handle, games: catalog(), people: presence() });
    broadcastPresence();

    ws.on('pong', () => (c.alive = true));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        handle(c, msg);
      } catch (err) {
        console.error('live: failed to handle', msg.t, err);
      }
    });
    ws.on('close', () => {
      leave(c);
      clients.delete(c);
      broadcastPresence();
    });
  }

  function enqueue(c) {
    if (c.match) endMatch(c.match, c);
    if (!queue.includes(c)) queue.push(c);
    c.status = 'waiting';
    c.queuedAt = Date.now();
    send(c, { t: 'queued' });
    broadcastPresence();
    tryMatch();
  }

  function dequeue(c) {
    const i = queue.indexOf(c);
    if (i >= 0) queue.splice(i, 1);
  }

  function leave(c) {
    dequeue(c);
    if (c.match) endMatch(c.match, c);
    c.status = 'idle';
    broadcastPresence();
  }

  function canPair(a, b, now) {
    if (a.user.id === b.user.id) return false;
    const recent =
      (a.lastPartner === b.user.id && now - a.lastPartnerAt < REMATCH_COOLDOWN_MS) ||
      (b.lastPartner === a.user.id && now - b.lastPartnerAt < REMATCH_COOLDOWN_MS);
    return !recent;
  }

  function tryMatch() {
    const now = Date.now();
    for (let i = 0; i < queue.length; i++) {
      for (let j = i + 1; j < queue.length; j++) {
        const a = queue[i];
        const b = queue[j];
        if (!canPair(a, b, now)) continue;
        queue.splice(j, 1);
        queue.splice(i, 1);
        startMatch(a, b);
        return tryMatch();
      }
    }
  }

  function startMatch(a, b) {
    const match = { id: `${a.id}-${b.id}-${Date.now().toString(36)}`, players: [a, b], game: null };
    for (const [c, other, initiator] of [[a, b, true], [b, a, false]]) {
      c.match = match;
      c.status = 'live';
      send(c, { t: 'matched', matchId: match.id, partner: { handle: other.user.handle }, initiator });
    }
    broadcastPresence();
  }

  function endMatch(match, by) {
    stopGame(match);
    for (const c of match.players) {
      c.match = null;
      c.lastPartner = match.players.find((o) => o !== c).user.id;
      c.lastPartnerAt = Date.now();
    }
    const other = match.players.find((c) => c !== by);
    if (other && clients.has(other)) {
      send(other, { t: 'partner-left' });
      if (other.ws.readyState === 1) enqueue(other);
    }
  }

  function partnerOf(c) {
    return c.match ? c.match.players.find((o) => o !== c) : null;
  }

  // --- games -------------------------------------------------------------

  function stopGame(match) {
    if (!match.game) return;
    for (const t of match.game.timers) clearTimeout(t);
    match.game = null;
  }

  function pushGame(match) {
    const g = match.game;
    if (!g || !g.inst) return;
    match.players.forEach((c, p) => {
      send(c, { t: 'game', game: { id: g.def.id, name: g.def.name }, by: g.by, state: g.inst.view(p) });
    });
  }

  function startGame(match, id, by) {
    const def = GAMES[id];
    if (!def) return;
    stopGame(match);
    const g = { def, by: by.user.handle, timers: new Set(), inst: null };
    const live = () => match.game === g;
    const ctx = {
      rand: Math.random,
      now: Date.now,
      update: () => live() && pushGame(match),
      send: (p, data) => live() && send(match.players[p], { t: 'game:event', data }),
      after: (ms, fn) => {
        const t = setTimeout(() => {
          g.timers.delete(t);
          if (live()) fn();
        }, ms);
        g.timers.add(t);
      },
      record: (winner) => {
        const w = match.players[winner].user.id;
        const l = match.players[1 - winner].user.id;
        insertResult.run(def.id, w, l, Date.now());
      },
    };
    match.game = g;
    g.inst = def.create(ctx);
    pushGame(match);
  }

  // --- messages ----------------------------------------------------------

  function handle(c, msg) {
    const partner = partnerOf(c);
    switch (msg.t) {
      case 'queue':
      case 'next':
        return enqueue(c);
      case 'leave':
        return leave(c);
      case 'signal':
        if (partner && msg.matchId === c.match.id) send(partner, { t: 'signal', matchId: c.match.id, data: msg.data });
        return;
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 500);
        if (partner && text) send(partner, { t: 'chat', text });
        return;
      }
      case 'game:start':
        if (c.match) startGame(c.match, msg.game, c);
        return;
      case 'game:move':
        if (c.match?.game?.inst && msg.move && typeof msg.move === 'object') {
          c.match.game.inst.move(c.match.players.indexOf(c), msg.move);
        }
        return;
      case 'game:quit':
        if (c.match?.game) {
          stopGame(c.match);
          for (const p of c.match.players) send(p, { t: 'game', game: null, by: c.user.handle });
        }
        return;
    }
  }

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 30_000);

  // Re-run matching so people held apart by the rematch cooldown get paired.
  const matcher = setInterval(tryMatch, 1000);

  return {
    close() {
      clearInterval(heartbeat);
      clearInterval(matcher);
      clearTimeout(presenceTimer);
      for (const c of clients) c.ws.terminate();
      wss.close();
    },
  };
}
