import { h } from '../h.js';

export function mount(root, { move }) {
  const status = h('div.game-status');
  const cells = Array.from({ length: 9 }, (_, i) => h('button', { 'aria-label': `Cell ${i + 1}`, onClick: () => move({ cell: i }) }));
  const note = h('div.big-note');
  const again = h('button.btn.primary.block.hidden', { onClick: () => move({ rematch: true }) }, 'Rematch');
  root.append(status, h('div.ttt', cells), note, again);

  return {
    update(s) {
      const mine = s.marks[s.you];
      cells.forEach((c, i) => {
        const v = s.board[i];
        c.textContent = v === null ? '' : s.marks[v];
        c.classList.toggle('o', v === 1);
        c.classList.toggle('win', !!s.line?.includes(i));
        c.disabled = v !== null || s.winner !== null || s.turn !== s.you;
      });
      status.replaceChildren(
        h('span', 'You are ', h('b', mine)),
        h('span', 'Score ', h('b', `${s.score[s.you]}–${s.score[1 - s.you]}`)),
      );
      if (s.winner === null) note.textContent = s.turn === s.you ? 'Your move.' : 'Their move.';
      else if (s.winner === 'draw') note.textContent = 'Draw.';
      else note.textContent = s.winner === s.you ? 'You win.' : 'They win.';
      again.classList.toggle('hidden', s.winner === null);
    },
  };
}
