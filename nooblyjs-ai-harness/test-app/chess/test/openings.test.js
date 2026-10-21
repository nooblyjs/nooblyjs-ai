import test from 'node:test';
import assert from 'node:assert/strict';
import { fromFen, applyMove, legalMoves, notation } from '../public/chess.js';
import { OPENINGS, getOpening, findMove, bookStatus, identifyOpening } from '../public/openings.js';

test('every opening line is legal from the start and written exactly as the move history writes it', () => {
  for (const opening of OPENINGS) {
    let state = fromFen();
    for (const [index, { san, note }] of opening.moves.entries()) {
      const move = findMove(state, san);
      assert.ok(move, `${opening.name}: move ${index + 1} (${san}) is not legal`);
      assert.equal(notation(state, move, legalMoves(state)).replace(/[+#]/g, ''), san, `${opening.name}: ${san} should be written exactly so`);
      assert.ok(note?.length > 10, `${opening.name}: move ${index + 1} needs a note`);
      state = applyMove(state, move);
    }
  }
});

test('openings have unique ids and the details the study panel shows', () => {
  assert.equal(new Set(OPENINGS.map((o) => o.id)).size, OPENINGS.length);
  for (const opening of OPENINGS) {
    for (const field of ['name', 'eco', 'group', 'summary']) assert.ok(opening[field], `${opening.id} needs ${field}`);
    assert.ok(opening.plans.w && opening.plans.b);
    assert.ok(opening.moves.length >= 10, `${opening.id} should show at least five moves each`);
  }
  assert.equal(getOpening('italian').name, 'Italian Game (Giuoco Piano)');
  assert.equal(getOpening('none'), undefined);
});

test('book status gives the next move while the game follows the line', () => {
  const italian = getOpening('italian');
  assert.equal(bookStatus(italian, []).next.san, 'e4');
  const status = bookStatus(italian, ['e4', 'e5', 'Nf3']);
  assert.deepEqual([status.matched, status.left, status.next.san], [3, false, 'Nc6']);
});

test('book status notices when a player leaves the line, and when it is finished', () => {
  const italian = getOpening('italian');
  const left = bookStatus(italian, ['e4', 'e5', 'Nf3', 'd6']);
  assert.deepEqual([left.matched, left.left, left.next], [3, true, null]);
  const done = bookStatus(italian, [...italian.moves.map((m) => m.san), 'Re1']);
  assert.deepEqual([done.complete, done.left, done.next], [true, false, null]);
});

test('check signs in the history do not break book matching', () => {
  const status = bookStatus({ moves: [{ san: 'Bb5' }, { san: 'c6' }] }, ['Bb5+']);
  assert.equal(status.next.san, 'c6');
});

test('identifies an opening only once the moves single it out', () => {
  assert.equal(identifyOpening(['e4', 'e5']), null);
  assert.equal(identifyOpening(['e4', 'e5', 'Nf3', 'Nc6']), null); // Italian, Spanish or Scotch?
  assert.equal(identifyOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']).id, 'ruy-lopez');
  assert.equal(identifyOpening(['e4', 'c5', 'Nf3']).id, 'sicilian');
  assert.equal(identifyOpening(['e4', 'c5', 'Nf3', 'Nc6', 'Bb5']).id, 'sicilian'); // left the Najdorf, still a Sicilian
  assert.equal(identifyOpening(['a3', 'e5', 'h3']), null);
});
