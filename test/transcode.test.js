import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../server/index.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('uploads are re-encoded to h264 mp4 when ffmpeg is around', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesh-tc-'));
  const src = path.join(dataDir, 'in.webm');
  spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=15', '-t', '1', '-c:v', 'libvpx', src]);

  const app = createApp({ dataDir, inviteCode: 'x', transcode: true });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const signup = await fetch(`${base}/api/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'tc', password: 'pass', code: 'x' }),
    });
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    const up = await fetch(`${base}/api/videos?caption=hi`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'video/webm' },
      body: fs.readFileSync(src),
    });
    const { video } = await up.json();
    assert.match(video.src, /\.webm$/, 'original is served until the encode lands');

    let current = video;
    for (let i = 0; i < 100 && !(current.src.endsWith('.mp4') && current.thumb); i++) {
      await new Promise((r) => setTimeout(r, 100));
      current = (await (await fetch(`${base}/api/videos/${video.id}`, { headers: { cookie } })).json()).video;
    }
    assert.match(current.src, /\.mp4$/);
    assert.ok(current.thumb, 'server made a poster frame since the client sent none');
    assert.deepEqual([current.width, current.height], [320, 568], 'dimensions backfilled from ffprobe');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0',
      path.join(dataDir, 'uploads', path.basename(current.src))], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim(), 'h264');
  } finally {
    app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
