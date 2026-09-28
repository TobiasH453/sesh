import { h } from '../h.js';

export function mount(root, { move }) {
  const count = h('span.label');
  const text = h('p');
  const by = h('span.label');
  root.append(
    h('div.deep-card', count, text, by),
    h('div.row',
      h('button.btn', { onClick: () => move({ prev: true }) }, 'Back'),
      h('button.btn.primary', { style: 'flex:1', onClick: () => move({ next: true }) }, 'Next card'),
    ),
  );

  return {
    update(s) {
      count.textContent = `${s.n} / ${s.total}`;
      text.textContent = s.card;
      by.textContent = s.by === null ? 'Either of you can flip' : `Flipped by ${s.byYou ? 'you' : 'them'}`;
    },
  };
}
