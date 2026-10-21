// Game rules and the computer opponent. Kept separate from the server so it is easy to test.

export const HUMAN = 'X';
export const AI = 'O';

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

// Returns { winner: 'X' | 'O', line: [a, b, c] }, { winner: 'draw' }, or null if the game goes on.
export function getResult(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return board.every(Boolean) ? { winner: 'draw' } : null;
}

export function emptyCells(board) {
  return board.flatMap((cell, i) => (cell ? [] : [i]));
}

// Minimax: tries every possible future game and scores it.
// AI wins = positive, human wins = negative. Faster wins (lower depth) score higher.
function minimax(board, player, depth) {
  const result = getResult(board);
  if (result) {
    if (result.winner === AI) return 10 - depth;
    if (result.winner === HUMAN) return depth - 10;
    return 0;
  }

  const scores = emptyCells(board).map((i) => {
    board[i] = player;
    const score = minimax(board, player === AI ? HUMAN : AI, depth + 1);
    board[i] = null;
    return score;
  });
  return player === AI ? Math.max(...scores) : Math.min(...scores);
}

function bestMove(board) {
  const copy = [...board];
  let best = { score: -Infinity, moves: [] };
  for (const i of emptyCells(copy)) {
    copy[i] = AI;
    const score = minimax(copy, HUMAN, 1);
    copy[i] = null;
    if (score > best.score) best = { score, moves: [i] };
    else if (score === best.score) best.moves.push(i);
  }
  // Pick randomly among equally good moves so games don't all look the same.
  return pick(best.moves);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// How often the AI plays the perfect move, per difficulty.
const SKILL = { easy: 0.2, normal: 0.7, impossible: 1 };

export function chooseMove(board, difficulty = 'impossible') {
  const free = emptyCells(board);
  if (free.length === 0) return null;
  const skill = SKILL[difficulty] ?? 1;
  return Math.random() < skill ? bestMove(board) : pick(free);
}

export function isValidBoard(board) {
  if (!Array.isArray(board) || board.length !== 9) return false;
  if (!board.every((c) => c === null || c === HUMAN || c === AI)) return false;
  const x = board.filter((c) => c === HUMAN).length;
  const o = board.filter((c) => c === AI).length;
  return x - o === 0 || x - o === 1; // human always moves first
}
