import { h, ago, link, nav, navigate, replace, toast } from '../h.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import * as ws from '../ws.js';
import { openComments } from './comments.js';

// Sound preference survives navigation within the session.
let muted = true;

const VIEW_THRESHOLD_S = 3;

export function FeedView({ mode, id, handle }) {
  const scroller = h('div.scroller');
  const slides = [];
  const loaded = new Set();
  let active = -1;
  let loading = false;
  let done = false;
  let endCard = null;
  let raf = 0;
  let destroyed = false;

  // --- chrome --------------------------------------------------------------

  const soundBtn = h('button.sound-btn', { 'aria-label': 'Toggle sound', onClick: () => setMuted(!muted) });
  const drawSound = () => replace(soundBtn, icon(muted ? 'soundOff' : 'soundOn'));
  drawSound();

  let top;
  if (mode === 'foryou' || mode === 'fresh') {
    top = h('div.feed-top',
      link('/', { class: `feed-tab${mode === 'foryou' ? ' on' : ''}` }, 'For you'),
      link('/fresh', { class: `feed-tab${mode === 'fresh' ? ' on' : ''}` }, 'Fresh'),
      soundBtn,
    );
  } else {
    top = h('div.feed-top',
      h('button.sound-btn.feed-back', {
        'aria-label': 'Back',
        onClick: () => (nav.depth > 0 ? history.back() : navigate(mode === 'user' ? `/u/${handle}` : '/', { replace: true })),
      }, icon('back')),
      h('span.feed-tab.on', mode === 'user' ? handle : 'Clip'),
      soundBtn,
    );
  }

  const livePill = link('/live', { class: 'live-pill hidden' });
  function drawLivePill() {
    const people = ws.livePeople();
    const looking = people.filter((p) => p.status === 'waiting');
    livePill.classList.toggle('hidden', people.length === 0);
    replace(livePill, h('span.live-dot'),
      looking.length
        ? `${looking.length === 1 ? looking[0].handle + ' is' : looking.length + ' people'} looking for a sesh`
        : `${people.length} in a call`,
    );
  }
  const offPresence = ws.on('presence', drawLivePill);
  drawLivePill();

  const frame = h('div.feed-frame', top, livePill, scroller);
  const el = h('div.feed', frame);

  // --- sound ---------------------------------------------------------------

  function setMuted(m) {
    muted = m;
    drawSound();
    const s = slides[active];
    if (s) {
      s.video.muted = muted;
      if (!muted) s.video.play().catch(() => {});
    }
  }

  // --- slides --------------------------------------------------------------

  function makeSlide(v) {
    const video = h('video', {
      playsinline: true,
      'webkit-playsinline': true,
      loop: true,
      muted: true,
      preload: 'none',
      poster: v.thumb || '',
      disablePictureInPicture: true,
    });
    video.setAttribute('muted', '');

    const bar = h('i');
    const pausedMark = h('div.paused-mark.hidden', 'Paused');
    const likeCount = h('span', v.likes);
    const commentCount = h('span', v.comments);
    const likeBtn = h(`button.act${v.liked ? '.on' : ''}`, { 'aria-label': 'Like', onClick: () => toggleLike() }, icon('heart'), likeCount);

    async function toggleLike(force) {
      const want = force ?? !v.liked;
      if (want === v.liked) return;
      v.liked = want;
      v.likes += want ? 1 : -1;
      likeBtn.classList.toggle('on', v.liked);
      likeCount.textContent = v.likes;
      try {
        const r = want ? await api.post(`/api/videos/${v.id}/like`) : await api.del(`/api/videos/${v.id}/like`);
        v.likes = r.likes;
        likeCount.textContent = v.likes;
      } catch (err) {
        toast(err.message);
      }
    }

    const actions = h('div.actions',
      likeBtn,
      h('button.act', {
        'aria-label': 'Comments',
        onClick: () => openComments(v, (n) => {
          v.comments = n;
          commentCount.textContent = n;
        }),
      }, icon('comment'), commentCount),
      h('button.act', { 'aria-label': 'Share', onClick: () => share(v) }, icon('share'), 'share'),
      v.mine && h('button.act', { 'aria-label': 'Delete', onClick: () => remove(slide) }, icon('trash'), 'del'),
    );

    const meta = h('div.slide-meta',
      h('div.who', link(`/u/${v.author.handle}`, {}, v.author.handle), h('span.when', ago(v.created_at))),
      v.caption && h('p.caption', v.caption),
    );

    const clip = h('div.clip', video, h('div.shade'), pausedMark, meta, h('div.progress', bar));
    const el = h(`div.slide${v.width > v.height ? '.landscape' : ''}`, clip, actions);

    // Tap to pause, double tap to like.
    let lastTap = 0;
    let tapTimer = 0;
    clip.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      const now = Date.now();
      if (now - lastTap < 280) {
        clearTimeout(tapTimer);
        lastTap = 0;
        burst(clip, e);
        toggleLike(true);
        return;
      }
      lastTap = now;
      tapTimer = setTimeout(() => {
        if (video.paused) {
          video.play().catch(() => {});
          slide.userPaused = false;
        } else {
          video.pause();
          slide.userPaused = true;
        }
      }, 280);
    });
    video.addEventListener('play', () => pausedMark.classList.add('hidden'));
    video.addEventListener('pause', () => slide.userPaused && pausedMark.classList.remove('hidden'));

    const slide = {
      v,
      el,
      video,
      bar,
      watched: 0,
      counted: false,
      userPaused: false,
      attached: false,
      attach() {
        if (this.attached) return;
        this.attached = true;
        video.src = v.src;
        video.preload = 'auto';
      },
      detach() {
        if (!this.attached) return;
        this.attached = false;
        video.pause();
        video.removeAttribute('src');
        video.load();
      },
    };
    return slide;
  }

  function burst(el, e) {
    const r = el.getBoundingClientRect();
    const b = h('div.burst', { style: `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px` }, icon('heart'));
    el.append(b);
    setTimeout(() => b.remove(), 600);
  }

  async function share(v) {
    const url = `${location.origin}/v/${v.id}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch {}
  }

  async function remove(slide) {
    if (!confirm('Delete this clip for good?')) return;
    try {
      await api.del(`/api/videos/${slide.v.id}`);
    } catch (err) {
      return toast(err.message);
    }
    const i = slides.indexOf(slide);
    slide.detach();
    observer.unobserve(slide.el);
    slide.el.remove();
    slides.splice(i, 1);
    active = -1;
    toast('Deleted');
    if (!slides.length) showEnd();
  }

  // --- activation + playback ------------------------------------------------

  function setActive(i) {
    if (i === active) return;
    const prev = slides[active];
    if (prev) prev.video.pause();
    active = i;
    slides.forEach((s, j) => {
      if (Math.abs(j - i) <= 1) s.attach();
      else if (Math.abs(j - i) > 2) s.detach();
    });
    const s = slides[i];
    if (!s) return;
    s.userPaused = false;
    s.video.currentTime = 0;
    s.video.muted = muted;
    s.video.play().catch(() => {
      // Autoplay with sound blocked: fall back to muted.
      if (!s.video.muted) {
        muted = true;
        drawSound();
        s.video.muted = true;
        s.video.play().catch(() => {});
      }
    });
    if (i >= slides.length - 3) loadMore();
  }

  let lastFrame = 0;
  function tick(t) {
    raf = requestAnimationFrame(tick);
    const dt = lastFrame ? (t - lastFrame) / 1000 : 0;
    lastFrame = t;
    const s = slides[active];
    if (!s) return;
    const { video } = s;
    if (video.duration) s.bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
    if (!video.paused && dt < 0.5) {
      s.watched += dt;
      const need = Math.min(VIEW_THRESHOLD_S, (video.duration || 6) * 0.5);
      if (!s.counted && s.watched >= need) {
        s.counted = true;
        api.post(`/api/videos/${s.v.id}/view`, { watched: s.watched }).catch(() => {});
      }
    }
  }
  raf = requestAnimationFrame(tick);

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = slides.findIndex((s) => s.el === e.target);
      if (i >= 0) setActive(i);
      else if (e.target === endCard) {
        slides[active]?.video.pause();
        active = -1;
      }
    }
  }, { root: scroller, threshold: 0.6 });

  // --- loading -------------------------------------------------------------

  function add(videos) {
    for (const v of videos) {
      if (loaded.has(v.id)) continue;
      loaded.add(v.id);
      const s = makeSlide(v);
      slides.push(s);
      if (endCard) scroller.insertBefore(s.el, endCard);
      else scroller.append(s.el);
      observer.observe(s.el);
    }
  }

  function showEnd() {
    if (endCard) return;
    const empty = slides.length === 0;
    endCard = h('div.slide.end-card', h('div',
      h('h2', empty ? 'Nothing here yet.' : "That's everything."),
      h('p', empty ? 'Nobody has posted a clip. Could be you.' : "You've seen every clip. Post one or go find someone live."),
      h('div.row', link('/post', { class: 'btn primary' }, 'Post a clip'), link('/live', { class: 'btn' }, 'Go live')),
    ));
    scroller.append(endCard);
    observer.observe(endCard);
  }

  async function loadMore() {
    if (loading || done || destroyed) return;
    loading = true;
    try {
      const feedMode = mode === 'fresh' ? 'fresh' : mode === 'user' ? 'user' : 'foryou';
      const r = await api.post('/api/feed', { mode: feedMode, handle, exclude: [...loaded], limit: mode === 'user' ? 30 : 8 });
      if (destroyed) return;
      add(r.videos);
      done = r.done;
      if (done) showEnd();
    } catch (err) {
      toast(err.message);
    } finally {
      loading = false;
    }
  }

  async function init() {
    if (mode === 'single') {
      try {
        const { video } = await api.get(`/api/videos/${id}`);
        if (!destroyed) add([video]);
      } catch (err) {
        toast(err.message);
      }
    }
    await loadMore();
    if (mode === 'user' && id) {
      const i = slides.findIndex((s) => s.v.id === id);
      if (i > 0) scroller.scrollTop = i * scroller.clientHeight;
    }
  }

  // --- keyboard ------------------------------------------------------------

  function onKey(e) {
    if (e.target.closest('input, textarea') || document.querySelector('.sheet')) return;
    const step = scroller.clientHeight;
    if (e.key === 'ArrowDown' || e.key === 'j') scroller.scrollBy({ top: step, behavior: 'smooth' });
    else if (e.key === 'ArrowUp' || e.key === 'k') scroller.scrollBy({ top: -step, behavior: 'smooth' });
    else if (e.key === 'm') setMuted(!muted);
    else if (e.key === ' ') {
      const s = slides[active];
      if (!s) return;
      e.preventDefault();
      s.userPaused = !s.video.paused;
      s.video.paused ? s.video.play().catch(() => {}) : s.video.pause();
    } else return;
    e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  const onVisibility = () => {
    const s = slides[active];
    if (!s) return;
    if (document.hidden) s.video.pause();
    else if (!s.userPaused) s.video.play().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    el,
    mounted: init,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      offPresence();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      slides.forEach((s) => s.detach());
    },
  };
}
