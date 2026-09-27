import { h, navigate, replace, toast } from '../h.js';
import { api } from '../api.js';
import { icon } from '../icons.js';

const MAX_RECORD_S = 60;
const RECORD_TYPES = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const EXT_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

const once = (el, ev, ms = 4000) =>
  new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      el.removeEventListener(ev, done);
      resolve();
    }
    el.addEventListener(ev, done);
  });

// Read size/duration and grab a poster frame, without trusting any of it to work.
async function probe(blob, fallbackDuration = 0) {
  const url = URL.createObjectURL(blob);
  const v = h('video', { muted: true, playsinline: true, preload: 'auto', src: url });
  try {
    await once(v, 'loadedmetadata');
    let duration = v.duration;
    if (!Number.isFinite(duration)) {
      // MediaRecorder WebM has no duration until you seek past the end.
      v.currentTime = 1e101;
      await once(v, 'durationchange', 2000);
      duration = Number.isFinite(v.duration) ? v.duration : fallbackDuration;
    }
    v.currentTime = Math.min(1, (duration || 0) * 0.25);
    await once(v, 'seeked', 3000);
    let thumb = null;
    if (v.videoWidth) {
      const scale = Math.min(1, 540 / v.videoWidth);
      const c = h('canvas', { width: Math.round(v.videoWidth * scale), height: Math.round(v.videoHeight * scale) });
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      thumb = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    }
    return { width: v.videoWidth, height: v.videoHeight, duration: duration || fallbackDuration, thumb };
  } catch {
    return { width: 0, height: 0, duration: fallbackDuration, thumb: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PostView() {
  const el = h('div.page');
  let cleanup = () => {};

  function choose() {
    cleanup();
    const file = h('input', { type: 'file', accept: 'video/*', class: 'hidden' });
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      const ext = f.name.split('.').pop().toLowerCase();
      const type = EXT_TYPES[ext] || f.type;
      if (!type.startsWith('video/')) return toast('That is not a video');
      compose(new Blob([f], { type }), 0);
    });
    replace(el, h('div.page-inner',
      h('h1.page-title', 'Post'),
      h('p.dim', { style: 'margin:0 0 28px' }, 'Up to a minute works best. Everyone in the crew sees it.'),
      h('div.choice',
        h('button', { onClick: record }, h('span.label', '01'), h('div', h('b', 'Record'), h('span.dim', 'Use your camera'))),
        h('button', { onClick: () => file.click() }, h('span.label', '02'), h('div', h('b', 'Upload'), h('span.dim', 'Pick a video file'))),
      ),
      file,
    ));
  }

  async function record() {
    cleanup();
    let facing = 'user';
    let stream = null;
    let recorder = null;
    let chunks = [];
    let startedAt = 0;
    let timer = 0;

    const video = h('video.mirror', { muted: true, playsinline: true, autoplay: true });
    const time = h('span.rec-time', `0:00 / 1:00`);
    const recBtn = h('button.rec-btn', { 'aria-label': 'Record', onClick: toggle }, h('i'));
    const flipBtn = h('button.rec-side', { 'aria-label': 'Flip camera', onClick: flip }, icon('flip'));
    const cancelBtn = h('button.rec-side', { onClick: () => { stopAll(); choose(); } }, 'Back');
    replace(el, h('div.recorder', video,
      h('div.rec-top', cancelBtn, time, h('span', { style: 'width:64px' })),
      h('div.rec-bar', flipBtn, recBtn, h('span', { style: 'width:64px' })),
    ));

    async function open() {
      stream?.getTracks().forEach((t) => t.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: true,
        });
      } catch (err) {
        toast(err.name === 'NotAllowedError' ? 'Camera blocked. Allow it in your browser settings.' : 'No camera available');
        return choose();
      }
      video.srcObject = stream;
      video.classList.toggle('mirror', facing === 'user');
    }

    function flip() {
      if (recorder) return;
      facing = facing === 'user' ? 'environment' : 'user';
      open();
    }

    function fmt(s) {
      return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    }

    function toggle() {
      if (recorder) return recorder.stop();
      if (!stream) return;
      const mimeType = RECORD_TYPES.find((t) => window.MediaRecorder?.isTypeSupported(t));
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : {});
      } catch {
        return toast('Recording is not supported in this browser');
      }
      chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        const seconds = (Date.now() - startedAt) / 1000;
        const type = (recorder.mimeType || mimeType || 'video/webm').split(';')[0];
        clearInterval(timer);
        recorder = null;
        const blob = new Blob(chunks, { type });
        stopAll();
        if (seconds < 0.5 || !blob.size) return record();
        compose(blob, seconds);
      };
      recorder.start(250);
      startedAt = Date.now();
      recBtn.classList.add('on');
      flipBtn.disabled = true;
      time.classList.add('live');
      timer = setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        time.textContent = `${fmt(s)} / 1:00`;
        if (s >= MAX_RECORD_S) recorder?.stop();
      }, 200);
    }

    function stopAll() {
      clearInterval(timer);
      if (recorder) {
        recorder.onstop = null;
        recorder.stop();
        recorder = null;
      }
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    cleanup = stopAll;
    open();
  }

  async function compose(blob, recordedSeconds) {
    cleanup();
    const url = URL.createObjectURL(blob);
    cleanup = () => URL.revokeObjectURL(url);
    const preview = h('video', { src: url, muted: true, playsinline: true, autoplay: true, loop: true });
    const caption = h('textarea.input', { maxlength: 200, placeholder: 'Say something about it (optional)' });
    const counter = h('span.label', '0 / 200');
    caption.addEventListener('input', () => (counter.textContent = `${caption.value.length} / 200`));
    const bar = h('i');
    const status = h('span.label', '');
    const progress = h('div.stack.hidden', h('div.bar', bar), status);
    const postBtn = h('button.btn.primary', { onClick: submit }, 'Post');
    const againBtn = h('button.btn', { onClick: choose }, 'Start over');
    const meta = probe(blob, recordedSeconds);

    replace(el, h('div.page-inner',
      h('h1.page-title', { style: 'margin-bottom:24px' }, 'Post'),
      h('div.compose',
        preview,
        h('div.stack',
          h('label.field', h('span.label', 'Caption'), caption),
          h('div.row', counter, h('div.spacer')),
          progress,
          h('div.row', postBtn, againBtn),
        ),
      ),
    ));
    caption.focus();

    async function submit() {
      postBtn.disabled = true;
      againBtn.disabled = true;
      caption.disabled = true;
      progress.classList.remove('hidden');
      status.textContent = 'Preparing';
      try {
        const m = await meta;
        const q = new URLSearchParams({
          caption: caption.value.trim(),
          duration: String(m.duration || 0),
          width: String(m.width || 0),
          height: String(m.height || 0),
        });
        const { video } = await api.upload('POST', `/api/videos?${q}`, blob, (p) => {
          bar.style.width = `${Math.round(p * 100)}%`;
          status.textContent = `Uploading ${Math.round(p * 100)}%`;
        });
        if (m.thumb) {
          status.textContent = 'Finishing';
          await api.upload('PUT', `/api/videos/${video.id}/thumb`, m.thumb).catch(() => {});
        }
        navigate(`/v/${video.id}`, { replace: true });
      } catch (err) {
        toast(err.message);
        status.textContent = err.message;
        postBtn.disabled = false;
        againBtn.disabled = false;
        caption.disabled = false;
      }
    }
  }

  choose();
  return { el, destroy: () => cleanup() };
}
