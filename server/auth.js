import crypto from 'node:crypto';

const KEYLEN = 32;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAuth(db, { secureCookies }) {
  const q = {
    userByHandle: db.prepare('SELECT * FROM users WHERE handle = ?'),
    insertUser: db.prepare('INSERT INTO users (handle, pass_hash, created_at) VALUES (?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(
      'SELECT u.id, u.handle FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  };

  function cookie(token, maxAge) {
    const parts = [`sesh=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  return {
    signup(handle, password) {
      if (q.userByHandle.get(handle)) throw Object.assign(new Error('handle taken'), { status: 409 });
      const { lastInsertRowid } = q.insertUser.run(handle, hashPassword(password), Date.now());
      return { id: Number(lastInsertRowid), handle };
    },
    login(handle, password) {
      const row = q.userByHandle.get(handle);
      if (!row || !verifyPassword(password, row.pass_hash)) {
        throw Object.assign(new Error('wrong handle or password'), { status: 401 });
      }
      return { id: row.id, handle: row.handle };
    },
    startSession(userId) {
      const token = crypto.randomBytes(24).toString('base64url');
      q.insertSession.run(token, userId, Date.now());
      return cookie(token, 60 * 60 * 24 * 365);
    },
    endSession(req) {
      const token = parseCookies(req.headers.cookie).sesh;
      if (token) q.deleteSession.run(token);
      return cookie('', 0);
    },
    userFromRequest(req) {
      const token = parseCookies(req.headers.cookie).sesh;
      if (!token) return null;
      return q.sessionUser.get(token) || null;
    },
  };
}
