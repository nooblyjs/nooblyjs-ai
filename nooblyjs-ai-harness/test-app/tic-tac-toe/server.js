import express from 'express';
import { fileURLToPath } from 'node:url';
import { AI, chooseMove, getResult, isValidBoard } from './game.js';

export const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));

// The browser sends the board after the player's move; the server replies with the AI's move.
app.post('/api/move', (req, res) => {
  const { board, difficulty } = req.body ?? {};
  if (!isValidBoard(board)) {
    return res.status(400).json({ error: 'Invalid board' });
  }

  const before = getResult(board);
  if (before) return res.json({ move: null, board, result: before });

  const move = chooseMove(board, difficulty);
  const next = [...board];
  next[move] = AI;
  res.json({ move, board: next, result: getResult(next) });
});

// Only listen when run directly (`node server.js`), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`NEON//GRID online at http://localhost:${port}`));
}
