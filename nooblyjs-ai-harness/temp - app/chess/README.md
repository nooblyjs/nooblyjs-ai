# Oblique — Isometric Chess

A self-contained Node.js + Express chess web game. The board is an isometric SVG projection with six original SVG piece designs in ivory and slate. No API key, external fonts, CDN, or paid chess service is needed.

## Run

```bash
cd /home/stephen/Code/engx-ai-harness/temp/chess
npm install
npm start
```

Open **http://localhost:3000**. If that port is busy, use `PORT=3001 npm start`.
The server binds to your own computer (`127.0.0.1`).

## Play

- Select one of your pieces, then a highlighted destination. Available captures have a ring.
- Play white or black; choose your side before starting a new game.
- Choose Casual, Thoughtful, or Focused computer strength. The setting applies to the next computer search (and restarts a search already in progress).
- Rotate the board, undo your last turn (including the computer reply), or download the move history as PGN, the standard chess game notation format.
- Use Tab to focus the board, arrow keys to navigate, Enter/Space to select, and Escape to deselect.
- Promotion opens a choice of queen, rook, bishop, or knight. Escape cancels the selection.

Includes legal move enforcement, checks, checkmate, stalemate, castling, en passant, promotion, common insufficient-material draws, threefold repetition and the fifty-move rule. For casual play, repetition and fifty-move draws are automatic rather than requiring a claim. No clock is used. Games are kept in browser memory; refreshing starts a new game.

## Computer opponent

The computer searches possible replies with **minimax** (specifically negamax): it assumes both sides want the best available move. Alpha-beta pruning skips branches that cannot improve the result. Material, piece activity and pawn advancement inform its evaluation; a short capture search helps avoid obvious tactical mistakes. Search runs in a **Web Worker**, a browser background thread, so the interface stays responsive. The maximum search budgets are approximately 0.25, 0.9 and 2.2 seconds. This is a lightweight casual opponent, not a grandmaster-strength engine.

## Tests

```bash
npm test
```

Uses Node's built-in test runner. Tests cover reference legal-move counts ("perft"), special moves, checks and draws, notation, computer moves, immutability and the Express routes.

## Files

- `server.js` — Express static server with security headers.
- `public/index.html`, `style.css`, `app.js` — responsive UI and projected SVG board.
- `public/pieces.svg` — original, reusable SVG piece symbols.
- `public/chess.js` — pure rules and computer search, shared by tests and browser.
- `public/ai-worker.js` — background computer search.
- `test/` — rules and HTTP smoke tests.
