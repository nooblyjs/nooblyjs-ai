import test from 'node:test';
import assert from 'node:assert/strict';
import { fromFen, squareIndex, squareName, colorOf, legalMoves, applyMove, inCheck, outcome, positionKey, notation, chooseMove } from '../public/chess.js';

function find(state, from, to, promotion) {
  const move = legalMoves(state).find((m) => m.from === squareIndex(from) && m.to === squareIndex(to) && (!promotion || m.promotion === promotion));
  assert.ok(move, `Expected legal move ${from}-${to}`);
  return move;
}
function play(state, from, to, promotion) { return applyMove(state, find(state, from, to, promotion)); }
function perft(state, depth) {
  if (!depth) return 1;
  return legalMoves(state).reduce((sum, move) => sum + perft(applyMove(state, move), depth - 1), 0);
}

test('starting position matches reference move counts through depth three', () => {
  const state = fromFen();
  assert.equal(state.board.length, 64);
  assert.equal(legalMoves(state).length, 20);
  assert.equal(perft(state, 2), 400);
  assert.equal(perft(state, 3), 8902);
});

test('Kiwipete reference position covers castling and pins', () => {
  const state = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(state, 1), 48);
  assert.equal(perft(state, 2), 2039);
  assert.equal(perft(state, 3), 97862);
});

test('endgame reference position covers en passant and discovered checks', () => {
  const state = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(perft(state, 1), 14);
  assert.equal(perft(state, 2), 191);
  assert.equal(perft(state, 3), 2812);
});

test('square names round-trip and moving does not mutate the old state', () => {
  for (let i = 0; i < 64; i++) assert.equal(squareIndex(squareName(i)), i);
  const state = fromFen(), original = structuredClone(state);
  const next = play(state, 'e2', 'e4');
  assert.deepEqual(state, original);
  assert.equal(next.turn, 'b');
  assert.equal(next.ep, squareIndex('e3'));
  assert.equal(next.board[squareIndex('e4')], 'P');
});

test('castling moves both king and rook and removes rights', () => {
  const state = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const kingSide = find(state, 'e1', 'g1');
  assert.equal(notation(state, kingSide), 'O-O');
  const next = applyMove(state, kingSide);
  assert.equal(next.board[squareIndex('f1')], 'R');
  assert.equal(next.board[squareIndex('h1')], null);
  assert.equal(next.castling, 'kq');
  const queenSide = applyMove(state, find(state, 'e1', 'c1'));
  assert.equal(queenSide.board[squareIndex('d1')], 'R');
});

test('cannot castle out of check or through an attacked square', () => {
  for (const fen of ['4kr2/8/8/8/8/8/8/4K2R w K - 0 1', 'k3r3/8/8/8/8/8/8/4K2R w K - 0 1']) {
    assert.ok(!legalMoves(fromFen(fen)).some((m) => m.castle));
  }
});

test('rook movement and capture permanently remove appropriate castling rights', () => {
  let state = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  state = play(state, 'a1', 'a8');
  assert.equal(state.castling, 'Kk');
});

test('en passant removes the captured pawn and expires after one move', () => {
  let state = fromFen();
  for (const [from, to] of [['e2','e4'],['a7','a6'],['e4','e5'],['d7','d5']]) state = play(state, from, to);
  const capture = find(state, 'e5', 'd6');
  assert.equal(capture.enPassant, true);
  assert.equal(notation(state, capture), 'exd6');
  const next = applyMove(state, capture);
  assert.equal(next.board[squareIndex('d5')], null);
  assert.equal(next.board[squareIndex('d6')], 'P');
  state = play(state, 'h2', 'h3');
  assert.equal(state.ep, -1);
});

test('en passant is illegal when it exposes the king', () => {
  const state = fromFen('k7/8/8/4KPpr/8/8/8/8 w - g6 0 1');
  assert.ok(!legalMoves(state).some((m) => m.enPassant));
});

test('promotion offers all four choices, including captures and black promotion', () => {
  const state = fromFen('1r5k/P7/8/8/8/8/8/7K w - - 0 1');
  for (const target of ['a8', 'b8']) {
    const promotions = legalMoves(state).filter((m) => m.to === squareIndex(target));
    assert.deepEqual(promotions.map((m) => m.promotion).sort(), ['b','n','q','r']);
    assert.equal(play(state, 'a7', target, 'n').board[squareIndex(target)], 'N');
  }
  assert.equal(play(fromFen('7k/8/8/8/8/8/p7/7K b - - 0 1'), 'a2', 'a1', 'q').board[56], 'q');
});

test('pinned pieces may not expose their own king', () => {
  const state = fromFen('k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1');
  const rookMoves = legalMoves(state).filter((m) => m.from === squareIndex('e2'));
  assert.ok(rookMoves.length > 0);
  assert.ok(rookMoves.every((m) => m.to % 8 === 4));
});

test('Fool’s mate ends the game and produces checkmate notation', () => {
  let state = fromFen();
  for (const [from, to] of [['f2','f3'],['e7','e5'],['g2','g4']]) state = play(state, from, to);
  const mate = find(state, 'd8', 'h4');
  assert.equal(notation(state, mate), 'Qh4#');
  state = applyMove(state, mate);
  assert.equal(inCheck(state), true);
  assert.deepEqual(outcome(state), { over: true, winner: 'b', reason: 'Checkmate' });
});

test('stalemate, insufficient material and fifty-move draw are detected', () => {
  assert.equal(outcome(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).reason, 'Stalemate');
  for (const fen of ['7k/8/8/8/8/8/8/K7 w - - 0 1', '7k/8/8/8/8/8/8/KN6 w - - 0 1', '7k/8/8/8/8/8/8/KB6 w - - 0 1']) {
    assert.equal(outcome(fromFen(fen)).reason, 'Insufficient material');
  }
  assert.equal(outcome(fromFen('7k/8/8/8/8/8/8/KR6 w - - 100 51')).reason, 'Fifty-move rule');
});

test('threefold repetition counts board, side, rights and legal en passant', () => {
  let state = fromFen();
  const history = [positionKey(state)];
  for (let i = 0; i < 2; i++) {
    for (const [from, to] of [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']]) {
      state = play(state, from, to);
      history.push(positionKey(state));
    }
  }
  assert.equal(outcome(state, history).reason, 'Threefold repetition');
  const irrelevant = fromFen('7k/8/8/8/4P3/8/8/K7 b - e3 0 1');
  assert.equal(positionKey(irrelevant), positionKey({ ...irrelevant, ep: -1 }));
  const relevant = fromFen('7k/8/8/8/3pP3/8/8/K7 b - e3 0 1');
  assert.notEqual(positionKey(relevant), positionKey({ ...relevant, ep: -1 }));
});

test('notation disambiguates knights that can reach the same square', () => {
  const state = fromFen('7k/8/8/8/8/8/8/KN3N2 w - - 0 1');
  assert.equal(notation(state, find(state, 'b1', 'd2')), 'Nbd2');
});

test('computer returns legal moves on every difficulty without changing state', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const state = fromFen(), original = structuredClone(state);
    const move = chooseMove(state, level, [positionKey(state)], { timeMs: 150 });
    assert.ok(legalMoves(state).some((m) => JSON.stringify(m) === JSON.stringify(move)));
    assert.deepEqual(state, original);
    assert.equal(colorOf(state.board[move.from]), 'w');
  }
});

test('computer finds mate in one and does not move after game over', () => {
  const state = fromFen('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
  const move = chooseMove(state, 'medium', [positionKey(state)], { timeMs: 1500 });
  assert.equal(outcome(applyMove(state, move)).reason, 'Checkmate');
  assert.equal(chooseMove(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), null);
});
