import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

export const VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const SERVE_TYPES = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  // Most .mov uploads are H.264 in an MP4-compatible container; browsers that
  // won't touch video/quicktime will happily play them as video/mp4.
  mov: 'video/mp4',
  jpg: 'image/jpeg',
};

export const newId = (bytes = 6) => crypto.randomBytes(bytes).toString('base64url');

export function baseMime(contentType = '') {
  return contentType.split(';')[0].trim().toLowerCase();
}

// Stream a request body to disk, refusing anything over `limit` bytes.
export function saveBody(req, dest, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) return reject(Object.assign(new Error('file too big'), { status: 413 }));
    let size = 0;
    let settled = false;
    const out = fs.createWriteStream(dest);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      req.unpipe(out);
      req.resume();
      out.destroy();
      fs.rm(dest, { force: true }, () => reject(err));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) fail(Object.assign(new Error('file too big'), { status: 413 }));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(Object.assign(new Error('upload aborted'), { status: 400 })));
    out.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      if (size === 0) return fail(Object.assign(new Error('empty upload'), { status: 400 }));
      settled = true;
      resolve(size);
    });
    req.pipe(out);
  });
}

export function serveFile(req, res, file, { cache = 'private, max-age=31536000, immutable' } = {}) {
  const ext = path.extname(file).slice(1);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  const headers = {
    'Content-Type': SERVE_TYPES[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start;
    let end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    } else {
      start = Math.max(0, stat.size - Number(range[2]));
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function exec(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Optional: if ffmpeg is installed, re-encode uploads to H.264/AAC MP4 so
// every phone can play every clip (iPhone HEVC, Chrome WebM, etc).
export function createTranscoder({ dir, onDone, enabled = process.env.TRANSCODE !== '0' }) {
  const available = enabled && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  const jobs = [];
  let running = false;

  async function probe(file) {
    const r = await exec('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file,
    ]);
    try {
      const j = JSON.parse(r.stdout);
      return { width: j.streams?.[0]?.width || 0, height: j.streams?.[0]?.height || 0, duration: Number(j.format?.duration) || 0 };
    } catch {
      return null;
    }
  }

  async function encode({ id, file }) {
    const input = path.join(dir, file);
    const outName = `${newId(9)}.mp4`;
    const output = path.join(dir, outName);
    const r = await exec('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', input,
      '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
    ]);
    if (r.code !== 0) {
      fs.rm(output, { force: true }, () => {});
      console.error(`transcode failed for ${id}: ${r.stderr.trim().split('\n').pop()}`);
      return;
    }
    const kept = onDone(id, outName, await probe(output));
    if (!kept) return fs.rm(output, { force: true }, () => {});
    // Give anyone mid-playback on the old file a few minutes before removing it.
    setTimeout(() => fs.rm(input, { force: true }, () => {}), 5 * 60_000).unref();
  }

  async function run() {
    if (running) return;
    running = true;
    while (jobs.length) await encode(jobs.shift());
    running = false;
  }

  return {
    available,
    push(id, file) {
      if (!available) return;
      jobs.push({ id, file });
      run();
    },
    // Grab a poster frame for clips whose uploader couldn't make one.
    async thumbnail(file, name) {
      if (!available) return null;
      const r = await exec('ffmpeg', [
        '-y', '-loglevel', 'error', '-ss', '0.5', '-i', path.join(dir, file),
        '-frames:v', '1', '-vf', "scale='min(540,iw)':-2", '-q:v', '4', path.join(dir, name),
      ]);
      return r.code === 0 ? name : null;
    },
  };
}
