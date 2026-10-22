# Sandstone Depths: an isometric dungeon game

A small, turn-based dungeon game for the browser. Guide an adventurer through sandstone dungeon floors: open chests, find keys, unlock doors, avoid pits and patrolling guards, and reach the stairs down. It runs locally with Node.js and needs no account, API key or internet connection.

**Status: Phase 2 (player and movement).** You can walk an adventurer around an 8 × 8 test room. Walls, barrels, the chest and the wooden posts block your way. Levels, keys and doors come in later phases. See `.noobly/specification/product.md` for the full design and `.noobly/specification/roadmap.md` for the build plan.

## Run

```bash
cd test-app/dungeon
npm install
npm start
```

Open **http://localhost:3000**. If that port is busy, use `PORT=3001 npm start`. The server listens only on your own computer (`127.0.0.1`).

`npm start` first runs `npm run assets`, which copies the sprites the game uses from `.noobly/ui` into `public/assets/`. You can also run it on its own. Files already copied are skipped.

## Play

| Key | Action |
|---|---|
| ↑ or W | Walk up-right |
| → or D | Walk down-right |
| ↓ or S | Walk down-left |
| ← or A | Walk up-left |
| Z | Wait a turn |

The floor is a diamond grid turned 45° on screen, so each arrow key walks along the grid line nearest to it, turned clockwise. Walking into something turns you to face it but doesn't use a turn.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Copy the assets, then start the server |
| `npm run dev` | The same, restarting the server when a file changes |
| `npm run assets` | Copy the sprites only |
| `npm test` | Run the tests (offline) |

## Layout

```
server.js               Express server for public/ (exports `app` for tests)
public/                 Everything the browser loads
  index.html  style.css
  app.js                Loads the sprites, runs the walk animation and the camera, draws each frame
  game.js               The rules: game state and `step(state, action)`; no DOM, so it is tested in Node
  input.js              Keys → actions, and a one-action queue
  render.js             Isometric maths (grid ↔ screen), draw order, camera, drawing
  sprites.js            Image loading with progress; tile and character sprite names
  room.js               The hard-coded test room (replaced by level files in Phase 3)
  assets/               Copied sprites (not committed; made by `npm run assets`)
scripts/copy-assets.js  Copies the sprites from .noobly/ui
test/                   node --test tests
.noobly/ui/             The original Kenney asset pack (left untouched)
.noobly/specification/  Product requirements and roadmap
```

## How the drawing works

- **Isometric grid.** Each tile's top face is a 256 × 128 diamond in the art. Tile (col, row) has its centre at `x = (col − row) × 128`, `y = (col + row) × 64`. One column goes right-and-down the screen; one row goes left-and-down.
- **Anchor.** Every sprite is a 256 × 512 image. The point (128, 428) in the image is the centre of the tile's top face, so that point is placed on the tile centre. The tall empty space above is for walls; the strip below is the side of the floor slab.
- **Painter's algorithm.** Draw the farthest things first and the nearest last, so near things cover far ones. All floor goes first, then everything else sorted by `col + row`.
- **Wall facings.** Kenney's `_N/_E/_S/_W` suffix is the way a wall *faces*, not the edge it stands on. Measured from the art: `S` is on the upper-right edge (towards row − 1), `E` the upper-left (col − 1), `N` the lower-left (row + 1), `W` the lower-right (col + 1). See `WALL_SIDE` in `game.js`.
- **Walls block edges, props block tiles.** A wall stands on the edge between two tiles, so it stops you crossing that edge. A prop such as a barrel fills its tile.

## How movement works

- **The rules are pure.** `step(state, action)` returns a *new* state and never changes the old one. Each state says what happened (`moved`, `blocked` or `waited`), and the screen uses that to decide what to animate. This also makes undo easy later: keep the old states.
- **Turns, then animation.** A key press is one turn and is decided at once. The screen then spends 250 ms sliding the character to the new tile while the 10-frame run cycle plays.
- **One-action queue.** A key pressed during a step is remembered (only the latest), so walking feels responsive. Holding a key doesn't pile up moves that carry on after you let go.
- **Draw order while walking.** Between two tiles, the character is sorted as if standing on whichever tile is nearer the camera, so it isn't hidden by something it's walking in front of.
- **Camera.** If the whole room fits in the window, it's centred and stays still. In a small window the camera follows the player, stops at the room's edges, and eases into place. The easing uses the time between frames, so it moves at the same speed at any frame rate.

## Credits

Art: **Dungeon Pack** by Kenney ([www.kenney.nl](https://www.kenney.nl)), licensed under [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/).
