// Pure chess rules, shared by the browser, AI worker and Node tests.
// Squares are 0..63, starting with a8. Uppercase pieces are white.
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const colorOf = (piece) => !piece ? null : piece === piece.toUpperCase() ? 'w' : 'b';
export const opposite = (color) => color === 'w' ? 'b' : 'w';
export const squareName = (square) => 'abcdefgh'[square % 8] + (8 - Math.floor(square / 8));
export const squareIndex = (name) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
const knightSteps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const diagonals = [[-1,-1],[-1,1],[1,-1],[1,1]];
const straights = [[-1,0],[1,0],[0,-1],[0,1]];
const inside = (row, col) => row >= 0 && row < 8 && col >= 0 && col < 8;

export function fromFen(fen = START_FEN) {
  const [layout, turn, castling, ep, halfmove, fullmove] = fen.split(' ');
  const board = [];
  for (const char of layout.replaceAll('/', '')) {
    if (/\d/.test(char)) board.push(...Array(Number(char)).fill(null));
    else board.push(char);
  }
  return { board, turn, castling: castling === '-' ? '' : castling, ep: ep === '-' ? -1 : squareIndex(ep), halfmove: Number(halfmove), fullmove: Number(fullmove) };
}

export function attacked(state, square, by) {
  const { board } = state;
  const row = Math.floor(square / 8), col = square % 8;
  const pawnRow = row + (by === 'w' ? 1 : -1);
  for (const dc of [-1, 1]) {
    if (inside(pawnRow, col + dc) && board[pawnRow * 8 + col + dc] === (by === 'w' ? 'P' : 'p')) return true;
  }
  for (const [dr, dc] of knightSteps) {
    if (inside(row + dr, col + dc) && board[(row + dr) * 8 + col + dc] === (by === 'w' ? 'N' : 'n')) return true;
  }
  for (const [dr, dc] of [...diagonals, ...straights]) {
    for (let distance = 1; distance < 8; distance++) {
      const r = row + dr * distance, c = col + dc * distance;
      if (!inside(r, c)) break;
      const piece = board[r * 8 + c];
      if (!piece) continue;
      if (colorOf(piece) === by) {
        const type = piece.toLowerCase();
        if (type === 'q' || (type === 'k' && distance === 1) || (dr && dc ? type === 'b' : type === 'r')) return true;
      }
      break;
    }
  }
  return false;
}

export function inCheck(state, color = state.turn) {
  const king = state.board.indexOf(color === 'w' ? 'K' : 'k');
  return king === -1 || attacked(state, king, opposite(color));
}

function pseudoMoves(state) {
  const moves = [], { board, turn } = state;
  function add(from, to, extra = {}) {
    if (board[to]?.toLowerCase() === 'k') return;
    if (board[from].toLowerCase() === 'p' && (to < 8 || to >= 56)) {
      for (const promotion of ['q', 'r', 'b', 'n']) moves.push({ from, to, ...extra, promotion });
    } else moves.push({ from, to, ...extra });
  }
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (colorOf(piece) !== turn) continue;
    const type = piece.toLowerCase(), row = Math.floor(from / 8), col = from % 8;
    if (type === 'p') {
      const direction = turn === 'w' ? -1 : 1;
      const next = from + direction * 8;
      if (inside(row + direction, col) && !board[next]) {
        add(from, next);
        if (row === (turn === 'w' ? 6 : 1) && !board[from + direction * 16]) add(from, from + direction * 16);
      }
      for (const dc of [-1, 1]) {
        if (!inside(row + direction, col + dc)) continue;
        const to = next + dc;
        if (board[to] && colorOf(board[to]) !== turn) add(from, to);
        else if (to === state.ep && board[to - direction * 8] === (turn === 'w' ? 'p' : 'P')) add(from, to, { enPassant: true });
      }
      continue;
    }
    const directions = type === 'n' ? knightSteps : type === 'b' ? diagonals : type === 'r' ? straights : [...diagonals, ...straights];
    for (const [dr, dc] of directions) {
      for (let distance = 1; distance <= (type === 'n' || type === 'k' ? 1 : 7); distance++) {
        const r = row + dr * distance, c = col + dc * distance;
        if (!inside(r, c)) break;
        const to = r * 8 + c;
        if (colorOf(board[to]) === turn) break;
        add(from, to);
        if (board[to]) break;
      }
    }
    if (type === 'k') {
      const home = turn === 'w' ? 60 : 4, enemy = opposite(turn);
      if (from !== home || attacked(state, home, enemy)) continue;
      for (const kingSide of [true, false]) {
        const right = turn === 'w' ? (kingSide ? 'K' : 'Q') : (kingSide ? 'k' : 'q');
        const rook = home + (kingSide ? 3 : -4), step = kingSide ? 1 : -1;
        const empty = kingSide ? [home + 1, home + 2] : [home - 1, home - 2, home - 3];
        if (state.castling.includes(right) && board[rook] === (turn === 'w' ? 'R' : 'r') && empty.every((s) => !board[s]) && !attacked(state, home + step, enemy) && !attacked(state, home + step * 2, enemy)) {
          add(from, home + step * 2, { castle: kingSide ? 'K' : 'Q' });
        }
      }
    }
  }
  return moves;
}

// Returns a new state; the old board is never mutated (important for undo/search).
export function applyMove(state, move) {
  const board = [...state.board], piece = board[move.from];
  const captured = board[move.to] || (move.enPassant ? (state.turn === 'w' ? 'p' : 'P') : null);
  board[move.from] = null;
  board[move.to] = move.promotion ? (state.turn === 'w' ? move.promotion.toUpperCase() : move.promotion) : piece;
  if (move.enPassant) board[move.to + (state.turn === 'w' ? 8 : -8)] = null;
  if (move.castle) {
    const rookFrom = move.from + (move.castle === 'K' ? 3 : -4);
    const rookTo = move.from + (move.castle === 'K' ? 1 : -1);
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  let castling = state.castling;
  if (piece === 'K') castling = castling.replace(/[KQ]/g, '');
  if (piece === 'k') castling = castling.replace(/[kq]/g, '');
  for (const [square, right] of [[0,'q'],[7,'k'],[56,'Q'],[63,'K']]) {
    if (move.from === square || move.to === square) castling = castling.replace(right, '');
  }
  return {
    board, turn: opposite(state.turn), castling,
    ep: piece.toLowerCase() === 'p' && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) / 2 : -1,
    halfmove: piece.toLowerCase() === 'p' || captured ? 0 : state.halfmove + 1,
    fullmove: state.fullmove + (state.turn === 'b' ? 1 : 0),
  };
}

export function legalMoves(state) {
  return pseudoMoves(state).filter((move) => !inCheck(applyMove(state, move), state.turn));
}

export function positionKey(state) {
  // An en-passant target changes repetition only when a legal capture exists.
  const ep = state.ep !== -1 && legalMoves(state).some((move) => move.enPassant) ? state.ep : '-';
  return `${state.board.map((p) => p || '.').join('')} ${state.turn} ${state.castling} ${ep}`;
}

export function insufficientMaterial(state) {
  const pieces = state.board.map((piece, square) => ({ piece: piece?.toLowerCase(), square })).filter(({ piece }) => piece && piece !== 'k');
  if (!pieces.length) return true;
  if (pieces.length === 1 && ['b', 'n'].includes(pieces[0].piece)) return true;
  if (pieces.every(({ piece }) => piece === 'b')) {
    const colors = new Set(pieces.map(({ square }) => (Math.floor(square / 8) + square % 8) % 2));
    return colors.size === 1;
  }
  return false;
}

export function outcome(state, history = [], moves = legalMoves(state)) {
  if (!moves.length) return inCheck(state) ? { over: true, winner: opposite(state.turn), reason: 'Checkmate' } : { over: true, winner: null, reason: 'Stalemate' };
  if (insufficientMaterial(state)) return { over: true, winner: null, reason: 'Insufficient material' };
  if (state.halfmove >= 100) return { over: true, winner: null, reason: 'Fifty-move rule' };
  if (history.filter((key) => key === positionKey(state)).length >= 3) return { over: true, winner: null, reason: 'Threefold repetition' };
  return { over: false, winner: null, reason: inCheck(state) ? 'Check' : '' };
}

export function notation(state, move, moves = legalMoves(state)) {
  let text;
  if (move.castle) text = move.castle === 'K' ? 'O-O' : 'O-O-O';
  else {
    const type = state.board[move.from].toUpperCase();
    const capture = state.board[move.to] || move.enPassant;
    let prefix = type === 'P' ? (capture ? squareName(move.from)[0] : '') : type;
    const others = moves.filter((m) => m.to === move.to && m.from !== move.from && state.board[m.from] === state.board[move.from]);
    if (type !== 'P' && others.length) {
      if (others.every((m) => m.from % 8 !== move.from % 8)) prefix += squareName(move.from)[0];
      else if (others.every((m) => Math.floor(m.from / 8) !== Math.floor(move.from / 8))) prefix += squareName(move.from)[1];
      else prefix += squareName(move.from);
    }
    text = prefix + (capture ? 'x' : '') + squareName(move.to) + (move.promotion ? `=${move.promotion.toUpperCase()}` : '');
  }
  const next = applyMove(state, move);
  if (inCheck(next)) text += legalMoves(next).length ? '+' : '#';
  return text;
}

const values = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
function evaluate(state) {
  let score = 0;
  for (let square = 0; square < 64; square++) {
    const piece = state.board[square];
    if (!piece) continue;
    const type = piece.toLowerCase(), color = colorOf(piece);
    const row = Math.floor(square / 8), col = square % 8;
    const center = 7 - Math.abs(3.5 - row) - Math.abs(3.5 - col);
    const advance = color === 'w' ? 6 - row : row - 1;
    let positional = type === 'p' ? advance * 9 + center * 3 : ['n','b'].includes(type) ? center * 12 : type === 'q' ? center * 3 : 0;
    if (type === 'k' && (color === 'w' ? row === 7 : row === 0) && [2,6].includes(col)) positional += 35;
    score += (color === 'w' ? 1 : -1) * (values[type] + positional);
  }
  return score * (state.turn === 'w' ? 1 : -1);
}
const priority = (state, move) => (state.board[move.to] ? values[state.board[move.to].toLowerCase()] * 10 - values[state.board[move.from].toLowerCase()] : 0) + (move.enPassant ? 1000 : 0) + (move.promotion ? values[move.promotion] : 0) + (move.castle ? 60 : 0);

// Iterative-deepening negamax, with alpha-beta pruning and a bounded capture search.
export function chooseMove(state, difficulty = 'medium', history = [], options = {}) {
  const settings = { easy: { depth: 1, ms: 250 }, medium: { depth: 3, ms: 900 }, hard: { depth: 4, ms: 2200 } }[difficulty] || { depth: 3, ms: 900 };
  const deadline = Date.now() + (options.timeMs ?? settings.ms);
  const rootMoves = legalMoves(state).sort((a, b) => priority(state, b) - priority(state, a));
  if (outcome(state, history, rootMoves).over) return null;
  let best = rootMoves[0], nodes = 0;
  const timeout = Symbol('timeout');
  function search(position, depth, alpha, beta, ply, keys, captureDepth = 0) {
    if ((++nodes & 63) === 0 && Date.now() > deadline) throw timeout;
    const moves = legalMoves(position);
    const result = outcome(position, keys, moves);
    if (result.over) return result.winner ? -100000 + ply : 0;
    let candidates = moves;
    if (depth <= 0) {
      const checked = inCheck(position);
      const standing = evaluate(position);
      if (captureDepth >= 4) return standing;
      if (!checked) {
        if (standing >= beta) return standing;
        alpha = Math.max(alpha, standing);
        candidates = moves.filter((m) => position.board[m.to] || m.enPassant || m.promotion);
      }
    }
    candidates.sort((a, b) => priority(position, b) - priority(position, a));
    for (const move of candidates) {
      const next = applyMove(position, move);
      const score = -search(next, depth - 1, -beta, -alpha, ply + 1, [...keys, positionKey(next)], depth <= 0 ? captureDepth + 1 : 0);
      if (score >= beta) return score;
      alpha = Math.max(alpha, score);
    }
    return alpha;
  }
  for (let depth = 1; depth <= settings.depth; depth++) {
    let iterationBest = best, bestScore = -Infinity;
    rootMoves.sort((a, b) => Number(b === best) - Number(a === best));
    try {
      for (const move of rootMoves) {
        if (Date.now() > deadline) throw timeout;
        const next = applyMove(state, move);
        let score = -search(next, depth - 1, -Infinity, -bestScore, 1, [...history, positionKey(next)]);
        if (difficulty === 'easy') score += Math.random() * 100;
        if (score > bestScore) { bestScore = score; iterationBest = move; }
      }
      best = iterationBest;
    } catch (error) {
      if (error !== timeout) throw error;
      break;
    }
  }
  return best;
}
