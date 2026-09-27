import fs from 'node:fs';
import path from 'node:path';
import { rankForYou } from './feed.js';
import { VIDEO_TYPES, baseMime, newId, saveBody } from './media.js';

const HANDLE_RE = /^[a-z0-9_.]{2,20}$/i;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    if (!baseMime(req.headers['content-type']).endsWith('json')) {
      return reject(new HttpError(415, 'expected json'));
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'body too big'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'bad json'));
      }
    });
    req.on('error', reject);
  });
}

export function createApi({ db, auth, config, uploads, transcoder }) {
  const VIDEO_SELECT = `
    SELECT v.*, u.handle,
      (SELECT COUNT(*) FROM likes l WHERE l.video_id = v.id) AS likes,
      (SELECT COUNT(*) FROM comments c WHERE c.video_id = v.id) AS comments,
      (SELECT COUNT(*) FROM views w WHERE w.video_id = v.id) AS views,
      EXISTS (SELECT 1 FROM likes l WHERE l.video_id = v.id AND l.user_id = :me) AS liked
    FROM videos v JOIN users u ON u.id = v.user_id`;

  const q = {
    allVideos: db.prepare(`${VIDEO_SELECT} ORDER BY v.created_at DESC`),
    oneVideo: db.prepare(`${VIDEO_SELECT} WHERE v.id = :id`),
    userVideos: db.prepare(`${VIDEO_SELECT} WHERE v.user_id = :uid ORDER BY v.created_at DESC`),
    seen: db.prepare('SELECT video_id, count FROM views WHERE user_id = ?'),
    affinity: db.prepare(
      'SELECT v.user_id, COUNT(*) AS n FROM likes l JOIN videos v ON v.id = l.video_id WHERE l.user_id = ? GROUP BY v.user_id',
    ),
    insertVideo: db.prepare(
      'INSERT INTO videos (id, user_id, caption, file, mime, duration, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    videoRow: db.prepare('SELECT * FROM videos WHERE id = ?'),
    setThumb: db.prepare('UPDATE videos SET thumb = ? WHERE id = ?'),
    setFile: db.prepare('UPDATE videos SET file = ?, mime = ? WHERE id = ?'),
    setDims: db.prepare('UPDATE videos SET width = ?, height = ?, duration = ? WHERE id = ?'),
    deleteVideo: db.prepare('DELETE FROM videos WHERE id = ?'),
    like: db.prepare('INSERT OR IGNORE INTO likes (user_id, video_id, created_at) VALUES (?, ?, ?)'),
    unlike: db.prepare('DELETE FROM likes WHERE user_id = ? AND video_id = ?'),
    likeCount: db.prepare('SELECT COUNT(*) AS n FROM likes WHERE video_id = ?'),
    view: db.prepare(`
      INSERT INTO views (user_id, video_id, count, watched, last_at) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT (user_id, video_id) DO UPDATE SET
        count = count + 1, watched = max(watched, excluded.watched), last_at = excluded.last_at`),
    comments: db.prepare(`
      SELECT c.id, c.body, c.created_at, c.user_id, u.handle
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.video_id = ? ORDER BY c.created_at ASC`),
    insertComment: db.prepare('INSERT INTO comments (video_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'),
    commentRow: db.prepare(
      'SELECT c.*, v.user_id AS video_owner FROM comments c JOIN videos v ON v.id = c.video_id WHERE c.id = ?',
    ),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
    userByHandle: db.prepare('SELECT id, handle, created_at FROM users WHERE handle = ?'),
    users: db.prepare(`
      SELECT u.handle, u.created_at, (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id) AS videos
      FROM users u ORDER BY u.handle COLLATE NOCASE`),
    likesReceived: db.prepare(
      'SELECT COUNT(*) AS n FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.user_id = ?',
    ),
    wins: db.prepare('SELECT game, COUNT(*) AS n FROM game_results WHERE winner_id = ? GROUP BY game'),
    played: db.prepare('SELECT COUNT(*) AS n FROM game_results WHERE winner_id = ? OR loser_id = ?'),
    files: db.prepare('SELECT file, thumb FROM videos'),
  };

  function shape(row, me) {
    return {
      id: row.id,
      caption: row.caption,
      src: `/media/${row.file}`,
      thumb: row.thumb ? `/media/${row.thumb}` : null,
      duration: row.duration,
      width: row.width,
      height: row.height,
      created_at: row.created_at,
      author: { handle: row.handle },
      likes: row.likes,
      comments: row.comments,
      views: row.views,
      liked: !!row.liked,
      mine: row.user_id === me,
    };
  }

  function findVideo(id, me) {
    const row = q.oneVideo.get({ id, me });
    if (!row) throw new HttpError(404, 'video not found');
    return row;
  }

  const removeUpload = (name) => name && fs.rm(path.join(uploads, name), { force: true }, () => {});

  const routes = [];
  const route = (method, pattern, handler, opts = {}) =>
    routes.push({ method, re: new RegExp(`^${pattern}$`), handler, open: !!opts.open });

  // --- auth ----------------------------------------------------------------

  route('GET', '/api/me', ({ user }) => ({
    user: user && { handle: user.handle },
    iceServers: config.iceServers,
  }), { open: true });

  route('POST', '/api/signup', async ({ req, res }) => {
    const { handle = '', password = '', code = '' } = await readJson(req);
    if (String(code).trim().toLowerCase() !== config.inviteCode.toLowerCase()) throw new HttpError(403, 'wrong invite code');
    if (!HANDLE_RE.test(handle)) throw new HttpError(400, 'handle: 2-20 letters, numbers, _ or .');
    if (String(password).length < 4) throw new HttpError(400, 'password: at least 4 characters');
    const user = auth.signup(handle, String(password));
    res.setHeader('Set-Cookie', auth.startSession(user.id));
    return { user: { handle: user.handle } };
  }, { open: true });

  route('POST', '/api/login', async ({ req, res }) => {
    const { handle = '', password = '' } = await readJson(req);
    const user = auth.login(String(handle), String(password));
    res.setHeader('Set-Cookie', auth.startSession(user.id));
    return { user: { handle: user.handle } };
  }, { open: true });

  route('POST', '/api/logout', ({ req, res }) => {
    res.setHeader('Set-Cookie', auth.endSession(req));
    return { ok: true };
  }, { open: true });

  // --- feed ----------------------------------------------------------------

  route('POST', '/api/feed', async ({ req, user }) => {
    const { mode = 'foryou', exclude = [], limit = 8, handle } = await readJson(req);
    const skip = new Set(Array.isArray(exclude) ? exclude.map(String) : []);
    const n = Math.min(Math.max(Number(limit) || 8, 1), 30);
    let rows;
    if (mode === 'user') {
      const owner = q.userByHandle.get(String(handle || ''));
      if (!owner) throw new HttpError(404, 'no such person');
      rows = q.userVideos.all({ uid: owner.id, me: user.id });
    } else if (mode === 'fresh') {
      rows = q.allVideos.all({ me: user.id });
    } else {
      const seen = new Map(q.seen.all(user.id).map((r) => [r.video_id, r.count]));
      const affinity = new Map(q.affinity.all(user.id).map((r) => [r.user_id, r.n]));
      rows = rankForYou(q.allVideos.all({ me: user.id }), {
        now: Date.now(),
        viewerId: user.id,
        seen,
        affinity,
        rand: Math.random,
      });
    }
    const remaining = rows.filter((r) => !skip.has(r.id));
    return { videos: remaining.slice(0, n).map((r) => shape(r, user.id)), done: remaining.length <= n };
  });

  // --- videos --------------------------------------------------------------

  route('GET', '/api/videos/([\\w-]+)', ({ user, params: [id] }) => ({ video: shape(findVideo(id, user.id), user.id) }));

  route('POST', '/api/videos', async ({ req, url, user }) => {
    const mime = baseMime(req.headers['content-type']);
    const ext = VIDEO_TYPES[mime];
    if (!ext) throw new HttpError(415, 'upload an mp4, webm or mov');
    const id = newId();
    const file = `${id}.${ext}`;
    await saveBody(req, path.join(uploads, file), config.maxUploadBytes);
    const p = url.searchParams;
    const num = (k) => (Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : 0);
    const caption = String(p.get('caption') || '').trim().slice(0, 200);
    q.insertVideo.run(id, user.id, caption, file, mime, num('duration'), Math.round(num('width')), Math.round(num('height')), Date.now());
    transcoder.push(id, file);
    return { video: shape(findVideo(id, user.id), user.id) };
  });

  route('PUT', '/api/videos/([\\w-]+)/thumb', async ({ req, user, params: [id] }) => {
    const row = q.videoRow.get(id);
    if (!row) throw new HttpError(404, 'video not found');
    if (row.user_id !== user.id) throw new HttpError(403, 'not yours');
    if (baseMime(req.headers['content-type']) !== 'image/jpeg') throw new HttpError(415, 'thumb must be jpeg');
    const name = `${id}-${newId(4)}.jpg`;
    await saveBody(req, path.join(uploads, name), 2 * 1024 * 1024);
    q.setThumb.run(name, id);
    removeUpload(row.thumb);
    return { thumb: `/media/${name}` };
  });

  route('DELETE', '/api/videos/([\\w-]+)', ({ user, params: [id] }) => {
    const row = q.videoRow.get(id);
    if (!row) throw new HttpError(404, 'video not found');
    if (row.user_id !== user.id) throw new HttpError(403, 'not yours');
    q.deleteVideo.run(id);
    removeUpload(row.file);
    removeUpload(row.thumb);
    return { ok: true };
  });

  route('POST', '/api/videos/([\\w-]+)/like', ({ user, params: [id] }) => {
    findVideo(id, user.id);
    q.like.run(user.id, id, Date.now());
    return { liked: true, likes: q.likeCount.get(id).n };
  });

  route('DELETE', '/api/videos/([\\w-]+)/like', ({ user, params: [id] }) => {
    q.unlike.run(user.id, id);
    return { liked: false, likes: q.likeCount.get(id).n };
  });

  route('POST', '/api/videos/([\\w-]+)/view', async ({ req, user, params: [id] }) => {
    const { watched = 0 } = await readJson(req);
    findVideo(id, user.id);
    q.view.run(user.id, id, Math.max(0, Number(watched) || 0), Date.now());
    return { ok: true };
  });

  // --- comments ------------------------------------------------------------

  const shapeComment = (c, me, owner) => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    author: { handle: c.handle },
    canDelete: c.user_id === me || owner === me,
  });

  route('GET', '/api/videos/([\\w-]+)/comments', ({ user, params: [id] }) => {
    const video = findVideo(id, user.id);
    return { comments: q.comments.all(id).map((c) => shapeComment(c, user.id, video.user_id)) };
  });

  route('POST', '/api/videos/([\\w-]+)/comments', async ({ req, user, params: [id] }) => {
    const { body = '' } = await readJson(req);
    const text = String(body).trim().slice(0, 300);
    if (!text) throw new HttpError(400, 'say something');
    const video = findVideo(id, user.id);
    const { lastInsertRowid } = q.insertComment.run(id, user.id, text, Date.now());
    const c = { id: Number(lastInsertRowid), body: text, created_at: Date.now(), user_id: user.id, handle: user.handle };
    return { comment: shapeComment(c, user.id, video.user_id) };
  });

  route('DELETE', '/api/comments/(\\d+)', ({ user, params: [id] }) => {
    const c = q.commentRow.get(Number(id));
    if (!c) throw new HttpError(404, 'comment not found');
    if (c.user_id !== user.id && c.video_owner !== user.id) throw new HttpError(403, 'not yours');
    q.deleteComment.run(c.id);
    return { ok: true };
  });

  // --- people --------------------------------------------------------------

  route('GET', '/api/users', () => ({ users: q.users.all() }));

  route('GET', '/api/users/([\\w.]+)', ({ user, params: [handle] }) => {
    const owner = q.userByHandle.get(handle);
    if (!owner) throw new HttpError(404, 'no such person');
    const wins = Object.fromEntries(q.wins.all(owner.id).map((r) => [r.game, r.n]));
    const videos = q.userVideos.all({ uid: owner.id, me: user.id }).map((r) => shape(r, user.id));
    return {
      user: { handle: owner.handle, created_at: owner.created_at, me: owner.id === user.id },
      stats: {
        videos: videos.length,
        likes: q.likesReceived.get(owner.id).n,
        wins,
        played: q.played.get(owner.id, owner.id).n,
      },
      videos,
    };
  });

  // Called by the transcoder once a normalized MP4 is ready. Returns false
  // if the clip was deleted in the meantime so the encode can be dropped.
  function swapFile(id, file, meta) {
    const row = q.videoRow.get(id);
    if (!row) return false;
    q.setFile.run(file, 'video/mp4', id);
    if (meta && (!row.width || !row.height || !row.duration)) {
      q.setDims.run(meta.width, meta.height, meta.duration, id);
    }
    // The uploader's browser normally sends a poster frame right after the
    // upload; fill one in if it never arrived.
    if (!row.thumb) {
      transcoder.thumbnail(file, `${id}-${newId(4)}.jpg`).then((name) => {
        if (!name) return;
        if (q.videoRow.get(id)?.thumb === null) q.setThumb.run(name, id);
        else removeUpload(name);
      });
    }
    return true;
  }

  // Remove uploads nothing points at anymore (replaced originals, deleted
  // clips whose cleanup was interrupted). Recent files are left alone since
  // they may be uploads or encodes still in flight.
  function sweep(minAgeMs = 30 * 60_000) {
    const keep = new Set();
    for (const r of q.files.all()) {
      keep.add(r.file);
      if (r.thumb) keep.add(r.thumb);
    }
    for (const name of fs.readdirSync(uploads)) {
      if (keep.has(name)) continue;
      const full = path.join(uploads, name);
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > minAgeMs) fs.rmSync(full, { force: true });
      } catch {}
    }
  }

  async function handle(req, res, url) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const user = auth.userFromRequest(req);
      if (!r.open && !user) throw new HttpError(401, 'log in first');
      const out = await r.handler({ req, res, url, user, params: m.slice(1) });
      json(res, 200, out);
      return true;
    }
    return false;
  }

  return { handle, swapFile, sweep };
}
