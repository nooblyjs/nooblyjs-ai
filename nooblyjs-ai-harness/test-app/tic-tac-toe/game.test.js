import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove, getResult, isValidBoard } from './game.js';
import { app } from './server.js';

const _ = null;

test('detects a win and a draw', () => {
  assert.deepEqual(getResult(['X', 'X', 'X', _, 'O', 'O', _, _, _]), { winner: 'X', line: [0, 1, 2] });
  assert.deepEqual(getResult(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), { winner: 'draw' });
  assert.equal(getResult(Array(9).fill(null)), null);
});

test('impossible AI takes a winning move', () => {
  assert.equal(chooseMove(['X', 'X', _, 'O', 'O', _, 'X', _, _], 'impossible'), 5);
});

test('impossible AI blocks the player', () => {
  assert.equal(chooseMove(['X', 'X', _, _, 'O', _, _, _, _], 'impossible'), 2);
});

test('impossible AI never loses against every possible player', () => {
  // Play every possible human move sequence against the AI.
  function explore(board) {
    for (let i = 0; i < 9; i++) {
      if (board[i]) continue;
      const next = [...board];
      next[i] = 'X';
      let result = getResult(next);
      assert.notEqual(result?.winner, 'X', `AI lost: ${next}`);
      if (result) continue;
      next[chooseMove(next, 'impossible')] = 'O';
      result = getResult(next);
      if (!result) explore(next);
    }
  }
  explore(Array(9).fill(null));
});

test('rejects invalid boards', () => {
  assert.equal(isValidBoard('nope'), false);
  assert.equal(isValidBoard(['X', 'X', _, _, _, _, _, _, _]), false);
  assert.equal(isValidBoard(['Z', _, _, _, _, _, _, _, _]), false);
  assert.equal(isValidBoard(['X', _, _, _, _, _, _, _, _]), true);
});

test('POST /api/move returns the AI move', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/move`;
  const post = (body) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const res = await post({ board: ['X', _, _, _, _, _, _, _, _], difficulty: 'impossible' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.board.filter((c) => c === 'O').length, 1);
  assert.equal(data.board[data.move], 'O');

  assert.equal((await post({ board: [1, 2, 3] })).status, 400);
});
