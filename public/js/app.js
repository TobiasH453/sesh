import { h, link, nav, navigate, replace } from './h.js';
import { api } from './api.js';
import * as ws from './ws.js';
import { AuthView } from './views/auth.js';
import { FeedView } from './views/feed.js';
import { LiveView } from './views/live.js';
import { PostView } from './views/post.js';
import { ProfileView } from './views/profile.js';
import { session } from './session.js';

const ROUTES = [
  [/^\/$/, () => FeedView({ mode: 'foryou' }), 'feed'],
  [/^\/fresh$/, () => FeedView({ mode: 'fresh' }), 'feed'],
  [/^\/v\/([\w-]+)$/, (id) => FeedView({ mode: 'single', id }), 'feed'],
  [/^\/u\/([\w.]+)\/([\w-]+)$/, (handle, id) => FeedView({ mode: 'user', handle, id }), 'me'],
  [/^\/live$/, () => LiveView(), 'live'],
  [/^\/post$/, () => PostView(), 'post'],
  [/^\/me$/, () => ProfileView({ handle: session.user.handle }), 'me'],
  [/^\/u\/([\w.]+)$/, (handle) => ProfileView({ handle }), 'me'],
];

const app = document.getElementById('app');
let current = null;
let shell = null;

function buildShell() {
  const view = h('main.view');
  const liveCount = h('span.count.hidden');
  const tabs = {
    feed: link('/', { class: 'feed-tab-link' }, 'Feed'),
    live: link('/live', {}, 'Live', liveCount),
    post: link('/post', { class: 'post-tab', 'aria-label': 'Post' }, h('span', h('b', '+'))),
    me: link('/me', {}, 'Me'),
  };
  const nav = h('nav.nav', h('div.brand', h('span.mark'), 'sesh'), tabs.feed, tabs.live, tabs.post, tabs.me);
  const el = h('div.shell', view, nav);

  const updateCount = () => {
    const n = ws.livePeople().length;
    liveCount.textContent = n;
    liveCount.classList.toggle('hidden', n === 0);
  };
  ws.on('presence', updateCount);
  updateCount();

  return { el, view, tabs };
}

function render() {
  current?.destroy?.();
  current = null;

  if (!session.user) {
    shell = null;
    const v = AuthView({
      onDone(user) {
        session.user = user;
        ws.connect();
        render();
      },
    });
    current = v;
    replace(app, v.el);
    v.mounted?.();
    return;
  }

  if (!shell) {
    shell = buildShell();
    replace(app, shell.el);
  }

  const path = location.pathname.replace(/\/+$/, '') || '/';
  for (const [re, make, tab] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    for (const [name, a] of Object.entries(shell.tabs)) a.classList.toggle('active', name === tab);
    current = make(...m.slice(1).map(decodeURIComponent));
    replace(shell.view, current.el);
    current.mounted?.();
    return;
  }
  navigate('/', { replace: true });
}

window.addEventListener('popstate', () => {
  nav.depth = Math.max(0, nav.depth - 1);
  render();
});
window.addEventListener('sesh:navigate', render);
window.addEventListener('sesh:logout', () => {
  session.user = null;
  ws.disconnect();
  render();
});

(async function boot() {
  try {
    const me = await api.get('/api/me');
    session.user = me.user;
    session.iceServers = me.iceServers;
  } catch {
    session.user = null;
  }
  if (session.user) ws.connect();
  render();
})();
