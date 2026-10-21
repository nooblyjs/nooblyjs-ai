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

## Watch the computer play itself

Set **Game** to *Computer vs computer · watch and learn* and press **New game**. The engine plays both sides, slowly, and the **engine's reasoning** panel explains each move in plain English: captures and trades, checks and forks, pieces moved out of danger, development, the centre, castling, and unprotected pieces it has left behind. A closing line gives its overall verdict, for example "It thinks White is ahead by about 1.5 pawns (looking 3 half-moves ahead)". Choose the **Time between moves** (about 8, 5 or 2.5 seconds), and use **Pause**/**Resume** at any time. Hover a move in the history to see its reasons again. The panel also explains the computer's moves when you play against it.

The reasons are worked out from the position after the move, not read out of the search, so they describe *what the move does* rather than every line the engine considered.

Includes legal move enforcement, checks, checkmate, stalemate, castling, en passant, promotion, common insufficient-material draws, threefold repetition and the fifty-move rule. For casual play, repetition and fifty-move draws are automatic rather than requiring a claim. No clock is used. Games are kept in browser memory; refreshing starts a new game.

## Learn the openings

An **opening** is the first handful of moves. Strong players don't work these out at the board: they play well-tested "book" lines, each with a plan behind it. Choose one under **Opening** (or click it in **All openings in the book**) and the computer plays that line's moves instead of searching. The board highlights your next book move in blue, the **engine's reasoning** panel explains each book move, and **The opening** panel shows the whole line, how far the game has got, and each side's plan. Hover a move in the line to read its note.

- Leave the line whenever you like. The panel shows where the game left the book, and the engine thinks for itself from there. Undo puts you back on the line.
- In **Computer vs computer** mode the engine plays both sides of the line, so you can watch a whole opening at your own pace.
- With no opening chosen, the panel names the opening your game is following once the moves single it out. The PGN download also records it.

| Opening | ECO | Main line in the book |
| --- | --- | --- |
| Italian Game (Giuoco Piano) | C53 | 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d3 d6 6.O-O O-O |
| Ruy Lopez (Spanish Game) | C84 | 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O |
| Scotch Game | C45 | 1.e4 e5 2.Nf3 Nc6 3.d4 exd4 4.Nxd4 Nf6 5.Nxc6 bxc6 6.e5 Qe7 7.Qe2 Nd5 8.c4 |
| King's Gambit | C39 | 1.e4 e5 2.f4 exf4 3.Nf3 g5 4.h4 g4 5.Ne5 Nf6 |
| Sicilian Defence (Najdorf) | B90 | 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 |
| French Defence (Advance) | C02 | 1.e4 e6 2.d4 d5 3.e5 c5 4.c3 Nc6 5.Nf3 Qb6 |
| Caro-Kann Defence (Classical) | B18 | 1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Bf5 5.Ng3 Bg6 6.h4 h6 7.Nf3 Nd7 |
| Scandinavian Defence | B01 | 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qa5 4.d4 Nf6 5.Nf3 c6 |
| Queen's Gambit Declined | D53 | 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5 Be7 5.e3 O-O 6.Nf3 |
| Queen's Gambit Accepted | D27 | 1.d4 d5 2.c4 dxc4 3.Nf3 Nf6 4.e3 e6 5.Bxc4 c5 6.O-O a6 |
| Slav Defence | D15 | 1.d4 d5 2.c4 c6 3.Nf3 Nf6 4.Nc3 dxc4 5.a4 Bf5 |
| London System | D02 | 1.d4 d5 2.Bf4 Nf6 3.e3 e6 4.Nf3 c5 5.c3 Nc6 6.Nbd2 Bd6 7.Bg3 O-O 8.Bd3 |
| King's Indian Defence | E97 | 1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 O-O 6.Be2 e5 7.O-O Nc6 8.d5 Ne7 |
| Nimzo-Indian Defence | E53 | 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.e3 O-O 5.Bd3 d5 6.Nf3 c5 7.O-O |
| English Opening | A29 | 1.c4 e5 2.Nc3 Nf6 3.g3 d5 4.cxd5 Nxd5 5.Bg2 Nb6 6.Nf3 Nc6 |

ECO codes are the standard catalogue numbers for openings (A–E). To add a line, add an entry to `public/openings.js`. The tests check that every move is legal and is written the way the move history writes it.

## Computer opponent

The computer searches possible replies with **minimax** (specifically negamax): it assumes both sides want the best available move. Alpha-beta pruning skips branches that cannot improve the result. Material, piece activity and pawn advancement inform its evaluation; a short capture search helps avoid obvious tactical mistakes. Search runs in a **Web Worker**, a browser background thread, so the interface stays responsive. The maximum search budgets are approximately 0.25, 0.9 and 2.2 seconds. This is a lightweight casual opponent, not a grandmaster-strength engine.

## Tests

```bash
npm test
```

Uses Node's built-in test runner. Tests cover reference legal-move counts ("perft"), special moves, checks and draws, notation, computer moves, immutability, the opening book and the Express routes.

## Files

- `server.js` — Express static server with security headers.
- `public/index.html`, `style.css`, `app.js` — responsive UI and projected SVG board.
- `public/pieces.svg` — original, reusable SVG piece symbols.
- `public/chess.js` — pure rules, computer search (`analyze`, `chooseMove`) and move explanations (`explainMove`), shared by tests and browser.
- `public/openings.js` — the opening book (lines, notes, plans) and helpers to follow and recognise it.
- `public/ai-worker.js` — background computer search.
- `test/` — rules and HTTP smoke tests.
