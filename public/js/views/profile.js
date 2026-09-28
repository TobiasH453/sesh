import { h, link, navigate, replace } from '../h.js';
import { api } from '../api.js';
import * as ws from '../ws.js';

const GAME_NAMES = { ttt: 'Tic-Tac-Toe', qd: 'Quick Draw' };
const STATUS = { idle: 'around', waiting: 'looking', live: 'in a call' };

export function ProfileView({ handle }) {
  const inner = h('div.page-inner', h('div.empty', 'Loading'));
  const el = h('div.page', inner);
  let offPresence = () => {};
  let destroyed = false;

  async function load() {
    let data;
    try {
      data = await api.get(`/api/users/${encodeURIComponent(handle)}`);
    } catch (err) {
      return replace(inner, h('div.empty', err.message));
    }
    const { user, stats, videos } = data;
    const wins = Object.values(stats.wins).reduce((a, b) => a + b, 0);

    const grid = videos.length
      ? h('div.grid', videos.map((v) =>
          link(`/u/${user.handle}/${v.id}`, { class: 'tile' },
            v.thumb ? h('img', { src: v.thumb, alt: v.caption || 'clip', loading: 'lazy' }) : null,
            h('span.tile-meta', `${v.likes} like${v.likes === 1 ? '' : 's'}`),
          ),
        ))
      : h('div.empty', user.me ? 'You have not posted yet.' : 'Nothing posted yet.');

    const winLines = Object.entries(stats.wins).map(([g, n]) => h('div.row', h('span', GAME_NAMES[g] || g), h('div.spacer'), h('span.mono', n)));

    const sections = [
      h('div.profile-head',
        h('div',
          h('div.label', { style: 'margin-bottom:10px' }, `Since ${new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`),
          h('div.handle-big', user.handle),
        ),
        user.me && h('button.btn.small', {
          async onClick() {
            await api.post('/api/logout');
            window.dispatchEvent(new Event('sesh:logout'));
            navigate('/', { replace: true });
          },
        }, 'Log out'),
      ),
      h('div.stats',
        h('div', h('b', stats.videos), h('span.label', 'Clips')),
        h('div', h('b', stats.likes), h('span.label', 'Likes')),
        h('div', h('b', stats.played), h('span.label', 'Games')),
        h('div', h('b', wins), h('span.label', 'Wins')),
      ),
      winLines.length ? h('div.stack', { style: 'margin-top:16px' }, h('span.label', 'Wins by game'), ...winLines) : null,
      h('hr.rule'),
      grid,
    ];

    if (user.me) {
      const crew = h('div.people');
      const drawCrew = (people) => {
        const status = new Map(ws.state.people.map((p) => [p.handle, p.status]));
        replace(crew, people.filter((p) => p.handle !== user.handle).map((p) => {
          const st = status.get(p.handle);
          return link(`/u/${p.handle}`, { class: 'person' },
            h(`span.status-dot${st ? '.s-' + st : ''}`),
            h('span', p.handle),
            h('div.spacer'),
            h('span.label', st ? STATUS[st] : `${p.videos} clips`),
          );
        }));
      };
      sections.push(h('hr.rule'), h('div.label', { style: 'margin-bottom:12px' }, 'The crew'), crew);
      api.get('/api/users').then(({ users }) => {
        if (destroyed) return;
        drawCrew(users);
        offPresence = ws.on('presence', () => drawCrew(users));
      });
    }

    replace(inner, sections);
  }

  load();
  return {
    el,
    destroy() {
      destroyed = true;
      offPresence();
    },
  };
}
