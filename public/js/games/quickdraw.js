import { h, replace } from '../h.js';

function verdict(ms) {
  if (ms == null) return '';
  if (ms < 230) return 'suspiciously sober';
  if (ms < 300) return 'functional';
  if (ms < 400) return 'toasty';
  if (ms < 550) return 'baked';
  return 'fried';
}

const pips = (n, of) => h('span.pips', Array.from({ length: of }, (_, i) => h(`i${i < n ? '.on' : ''}`)));

export function mount(root, { move }) {
  let s = null;
  let goAt = 0;
  let tapped = false;
  let round = -1;

  const score = h('div.score');
  const pad = h('div.qd-pad', { role: 'button', tabindex: 0 });
  const foot = h('div.game-status');
  const again = h('button.btn.primary.block.hidden', { onClick: () => move({ rematch: true }) }, 'Rematch');
  root.append(score, pad, foot, again);

  function tap() {
    if (!s) return;
    if (s.phase === 'ready' && !s.ready[s.you]) return move({ ready: true });
    if (s.phase === 'wait' && !tapped) {
      tapped = true;
      return move({ tap: 0 });
    }
    if (s.phase === 'go' && !tapped) {
      tapped = true;
      move({ tap: performance.now() - goAt });
      pad.classList.remove('go');
      replace(pad, h('div', `${Math.round(performance.now() - goAt)}`, h('small', 'ms · waiting on them')));
    }
  }

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tap();
  });
  const onKey = (e) => {
    if (e.code !== 'Space' || e.target.closest('input, textarea')) return;
    e.preventDefault();
    tap();
  };
  document.addEventListener('keydown', onKey);

  return {
    update(next) {
      const wasGo = s?.phase === 'go' && s.round === next.round;
      s = next;
      if (s.round !== round) {
        round = s.round;
        tapped = false;
      }
      const me = s.you;
      const them = 1 - me;

      replace(score,
        h('div', h('span.label', 'You'), h('b', s.score[me]), pips(s.score[me], s.toWin)),
        h('div', h('span.label', 'Them'), h('b', s.score[them]), pips(s.score[them], s.toWin)),
      );

      pad.className = 'qd-pad';
      const fmt = (t) => (t == null ? '—' : `${t}ms`);
      switch (s.phase) {
        case 'ready':
          replace(pad, h('div', 'Ready?', h('small', s.ready[me] ? 'Waiting on them' : 'Tap when you are')));
          break;
        case 'wait':
          pad.classList.add('wait');
          replace(pad, h('div', 'Wait', h('small', 'Tap on green. Not before.')));
          break;
        case 'go':
          if (tapped) break;
          pad.classList.add('go');
          replace(pad, h('div', 'Tap'));
          if (!wasGo) requestAnimationFrame(() => (goAt = performance.now()));
          break;
        case 'result':
        case 'over': {
          const l = s.last;
          let head;
          if (l.foul !== null) {
            pad.classList.add('foul');
            head = l.foul === me ? 'Too early.' : 'They jumped.';
          } else if (l.winner === null) head = 'Dead even.';
          else head = l.winner === me ? 'You got it.' : 'They got it.';
          if (s.phase === 'over') head = s.winner === me ? 'You win.' : 'They win.';
          replace(pad, h('div', head, h('small', `You ${fmt(l.times[me])} · Them ${fmt(l.times[them])}`)));
          break;
        }
      }

      foot.replaceChildren(
        h('span', 'First to ', h('b', s.toWin)),
        h('span', 'Best ', h('b', s.best[me] == null ? '—' : `${s.best[me]}ms`), s.best[me] != null ? ` · ${verdict(s.best[me])}` : ''),
      );
      again.classList.toggle('hidden', s.phase !== 'over');
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
