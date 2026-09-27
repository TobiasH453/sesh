import { h, replace } from '../h.js';

export function mount(root, { move }) {
  const status = h('div.game-status');
  const optA = h('button.wyr-opt', { onClick: () => move({ pick: 0 }) });
  const optB = h('button.wyr-opt', { onClick: () => move({ pick: 1 }) });
  const note = h('div.big-note');
  const next = h('button.btn.primary.block.hidden', { onClick: () => move({ next: true }) }, 'Next one');
  root.append(status, h('div.wyr-q', 'Would you rather'), h('div.wyr-opts', optA, h('div.wyr-or', 'or'), optB), note, next);

  return {
    update(s) {
      status.replaceChildren(
        h('span', 'Round ', h('b', s.rounds + (s.revealed ? 0 : 1))),
        h('span', 'In sync ', h('b', `${s.synced}/${s.rounds}`)),
      );
      [optA, optB].forEach((btn, i) => {
        const chips = [];
        if (s.revealed) {
          if (s.picks[s.you] === i) chips.push(h('span.chip.acc', 'You'));
          if (s.picks[1 - s.you] === i) chips.push(h('span.chip', 'Them'));
        }
        replace(btn, i === 0 ? s.a : s.b, chips.length ? h('div.picks', chips) : null);
        btn.classList.toggle('mine', s.yourPick === i);
        btn.disabled = s.revealed;
      });
      if (s.revealed) note.textContent = s.picks[0] === s.picks[1] ? 'Same wavelength.' : 'Split decision. Discuss.';
      else if (s.yourPick === null) note.textContent = s.theyPicked ? 'They picked. Your turn.' : 'Pick one.';
      else note.textContent = 'Waiting on them.';
      next.classList.toggle('hidden', !s.revealed);
    },
  };
}
