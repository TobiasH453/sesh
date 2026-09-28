const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function winnerOf(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((c) => c !== null)) return { winner: 'draw', line: null };
  return null;
}

export default {
  id: 'ttt',
  name: 'Tic-Tac-Toe',
  blurb: 'Three in a row. Loser rolls the next one.',
  create(ctx) {
    const s = {
      board: Array(9).fill(null),
      starter: Math.floor(ctx.rand() * 2),
      turn: 0,
      winner: null,
      line: null,
      score: [0, 0],
    };
    s.turn = s.starter;

    return {
      move(p, msg) {
        if (msg.rematch) {
          if (s.winner === null) return;
          s.board = Array(9).fill(null);
          s.starter = 1 - s.starter;
          s.turn = s.starter;
          s.winner = null;
          s.line = null;
          return ctx.update();
        }
        const cell = msg.cell;
        if (s.winner !== null || s.turn !== p) return;
        if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.board[cell] !== null) return;
        s.board[cell] = p;
        const result = winnerOf(s.board);
        if (result) {
          s.winner = result.winner;
          s.line = result.line;
          if (result.winner !== 'draw') {
            s.score[result.winner]++;
            ctx.record(result.winner);
          }
        } else {
          s.turn = 1 - p;
        }
        ctx.update();
      },
      view(p) {
        return { ...s, you: p, marks: ['X', 'O'] };
      },
    };
  },
};
