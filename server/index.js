import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as defaults } from './config.js';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createApi, json } from './api.js';
import { createLive } from './live.js';
import { createTranscoder, serveFile } from './media.js';

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const MEDIA_RE = /^\/media\/([\w-]+\.(?:mp4|webm|mov|jpg))$/;

export function createApp(overrides = {}) {
  const config = { ...defaults, ...overrides };
  const uploads = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });

  const db = overrides.db || openDb(config.dataDir);
  const auth = createAuth(db, config);
  let api;
  const transcoder = createTranscoder({
    dir: uploads,
    enabled: config.transcode ?? process.env.TRANSCODE !== '0',
    onDone: (id, file, meta) => api.swapFile(id, file, meta),
  });
  api = createApi({ db, auth, config, uploads, transcoder });
  api.sweep();
  const sweeper = setInterval(() => api.sweep(), 6 * 60 * 60_000).unref();

  function serveStatic(req, res, pathname) {
    let file = path.normalize(path.join(config.publicDir, pathname));
    if (!file.startsWith(config.publicDir)) return res.writeHead(403).end();
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // Missing assets 404; everything else is a client-side route.
      if (STATIC_TYPES[path.extname(pathname)]) return res.writeHead(404).end();
      file = path.join(config.publicDir, 'index.html');
    }
    const stat = fs.statSync(file);
    const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
    if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
    res.writeHead(200, {
      'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': pathname.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: etag,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!(await api.handle(req, res, url))) json(res, 404, { error: 'not found' });
        return;
      }
      const media = MEDIA_RE.exec(url.pathname);
      if (media) {
        if (!auth.userFromRequest(req)) return res.writeHead(401).end();
        return serveFile(req, res, path.join(uploads, media[1]));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return res.writeHead(400).end();
      }
      serveStatic(req, res, pathname);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'server error' : err.message });
      else res.end();
    }
  });

  const live = createLive({ server, auth, db });

  return {
    server,
    config,
    transcoder,
    sweep: () => api.sweep(),
    close() {
      clearInterval(sweeper);
      live.close();
      server.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.listen(app.config.port, app.config.host, () => {
    console.log(`sesh on http://localhost:${app.config.port}`);
    console.log(`invite code: ${app.config.inviteCode}${process.env.SESH_CODE ? '' : '  (default, set SESH_CODE)'}`);
    console.log(`transcoding: ${app.transcoder.available ? 'ffmpeg' : 'off (ffmpeg not found)'}`);
  });
}
