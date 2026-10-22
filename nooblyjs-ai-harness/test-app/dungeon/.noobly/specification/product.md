# Product Requirements Document: "Sandstone Depths", an isometric dungeon game

Status: Draft 1 · Date: 2026-10-22 · Location: `test-app/dungeon/`

## 1. Summary

Sandstone Depths is a small, browser-based isometric dungeon game. The player guides an adventurer through a series of sandstone dungeon floors: open chests, find keys, unlock doors and gates, avoid pits and patrolling guards, and reach the stairs down. It is built only from the Kenney "Dungeon Pack" art in `.noobly/ui/` and runs locally with Node.js, with no accounts, no network and no paid services.

The game sits alongside the other sample apps in `test-app/` (chess, tic-tac-toe) and follows the same shape: a small Express server, a plain-JavaScript front end and `node --test` tests.

## 2. Goals and non-goals

### Goals
- A complete, short game: 5 hand-built levels (about 15–25 minutes of play), from a title screen to a victory screen.
- It should look like the reference image `.noobly/ui/Sample.png`: warm sandstone floors, walls, wooden beams, barrels and furniture, seen from the 30°/45° isometric camera.
- Turn-based, grid-based movement that is easy to learn: one key press moves one tile. The run animation plays smoothly between tiles.
- Game rules in a pure, rendering-free module so they can be unit-tested (like `chess.js` in the chess app).
- Works offline: no CDN, no external fonts, no API keys.
- Playable with keyboard, mouse (click a tile) or touch.

### Non-goals (version 1)
- Real-time combat, health bars or weapons. The art pack has no enemy, weapon or attack animation, so we do not design around them.
- Multiplayer, accounts, leaderboards or a backend database.
- Procedural level generation (a stretch goal, see the roadmap).
- Sound and music. The pack has none; this can be added later with CC0 audio.
- The front-on "Angle" camera (see 4.2). It is a stretch goal.

## 3. Target players
- Casual players who want a short puzzle-adventure in the browser.
- Learners reading the code: the rules, rendering and level data should each be small and readable on their own.

## 4. Source assets (`.noobly/ui/`)

Kenney Dungeon Pack 2.3, licence **CC0** (free for any use, credit optional). We will credit "Kenney (www.kenney.nl)" on the title screen and in the README anyway.

### 4.1 Isometric tiles (`Isometric/`, the main set)
- 288 PNGs: **72 objects × 4 facings** (`_N`, `_E`, `_S`, `_W`). Each image is **256 × 512 px**. The floor diamond is 256 × 128 at the bottom of the image, and the empty space above is for tall objects like walls (see `Information.png`).
- Rendered at 30° / 45° / 0°. Tiles line up on a standard 2:1 isometric grid: `screenX = (col − row) × 128`, `screenY = (col + row) × 64`.

How the asset families map to gameplay:

| Gameplay role | Assets |
|---|---|
| Walkable floor | `stone`, `stoneTile`, `stoneUneven`, `stoneInset`, `stoneMissingTiles`, `dirt`, `dirtTiles`, `planks` |
| Floor edges and ledges (decorative) | `stoneSide`, `stoneSideUneven`, `stoneLeft`, `stoneRight`, `stoneCorner`, `stoneStep`, `stoneSteps` |
| Blocking walls | `stoneWall`, `stoneWallAged*`, `stoneWallBroken*`, `stoneWallCorner`, `stoneWallColumn*`, `stoneWallHalf`, `stoneWallRound*`, `stoneWallTop`, `stoneWallStructure`, `stoneWallWindow*`, `stoneWallHole` |
| Doorways (always passable) | `stoneWallArchway`, `stoneWallDoor`, `stoneWallDoorOpen`, `stoneWallGate`, `stoneWallGateOpen` |
| Locked doors and gates | `stoneWallDoorClosed`, `stoneWallDoorBars`, `stoneWallGateClosed`, `stoneWallGateBars` (swap to the `Open` version when unlocked) |
| Chests | `chestClosed` → `chestOpen` |
| Level exit | `stairs`, `stairsAged`, `stairsCorner`, `stairsSpiral` |
| Hazards | `planksHole`, `planksBroken`, `bridgeBroken` (pits); `bridge` is a safe crossing |
| Obstacles and props (block movement) | `barrel`, `barrels`, `barrelsStacked`, `woodenCrate`, `woodenCrates`, `woodenPile`, `stoneColumn`, `stoneColumnWood`, `tableRound*`, `tableShort*`, `tableChairsBroken`, `chair` |
| Overhead beams (decorative, walk under them) | `woodenSupports`, `woodenSupportsBeam`, `woodenSupportsBlock`, `woodenSupportBeams` |

### 4.2 Front-on tiles (`Angle/`)
The same 72 objects × 4 facings, drawn from a straight-on side camera. They are not used in version 1. They could be used later for a side view or for UI art.

### 4.3 Character (`Characters/Male/`)
- One male adventurer, **8 facing directions** numbered 0–7 (from `Information.png`: 0 = N, 2 = E, 4 = S, 6 = W; odd numbers are the diagonals).
- Animations per direction: `Idle` (1 frame), `Run` (10 frames), `Pickup` (10 frames). Files are named like `Male_<dir>_<anim><frame>.png`, 256 × 512 px, on the same grid as the tiles.
- Grid moves use the 4 directions 0, 2, 4 and 6. The diagonals are kept for click-to-move paths and idle "look at" turns.

### 4.4 Gaps in the pack, and how we fill them
| Missing | Decision |
|---|---|
| Enemy sprites | Guards use the same male sprite with a canvas colour tint (e.g. dark red) and a "vision cone" drawn on the floor. |
| Keys, gold, gems, HUD icons | Small inline SVG icons drawn by us, kept in `public/icons.svg`. |
| Fonts | System font stack only. |
| Levers or switches | Not in this pack (only in the Tiled sample zip). Version 1 has no switches. |

### 4.5 Samples
`Samples/Tiled Sample.zip` holds a Tiled `.tmx` map (60 × 32, 256 × 128 isometric tiles, several height layers with `offsety = -78` per floor). It confirms the grid maths and the per-floor height offset. Importing Tiled maps is a stretch goal.

## 5. Gameplay

### 5.1 Core loop
1. Arrive on a dungeon floor.
2. Explore: walk the grid, open chests for **keys** and **treasure**.
3. Use keys on locked doors and gates to open new areas.
4. Avoid hazards (pits) and stay out of the guards' sight.
5. Reach the **stairs** to go down to the next floor. You can only leave when the floor's "exit condition" is met (for example "find the brass key").
6. After the 5th floor, the victory screen shows the totals.

### 5.2 Rules
- **Turns:** each player action (move, open, wait) is one turn. After the player's action, every guard takes one step. This makes the game deterministic and testable.
- **Movement:** up, down, left and right on the grid (screen directions NE, SW, NW, SE). A move into a wall, obstacle, closed door or the map edge does nothing and costs no turn.
- **Interact:** pressing `E`/`Space` (or clicking a neighbouring chest or door) uses the tile in front of the player. Opening a chest plays the `Pickup` animation and adds its contents to the inventory.
- **Keys:** each key has a colour (brass, iron, silver). A locked door or gate opens only with a key of the same colour. Using a key removes it from the inventory.
- **Pits:** stepping on `planksHole` or `bridgeBroken` makes you fall. You restart the floor at its entrance, and your inventory goes back to what it was when you entered the floor.
- **Guards:** a guard walks a fixed patrol route (a list of waypoints in the level file). It sees 3 tiles straight ahead in its facing direction, and walls and obstacles block its view. If you end a turn in a guard's sight, or bump into a guard, you are caught and restart the floor (same reset as a pit).
- **Wait:** `Z` (or clicking the player) skips a turn, for timing a dash past a guard.
- **Undo:** `U` undoes the last turn, up to 20 turns back per floor. Treasure collected this way is counted only once.
- **Score:** treasure collected, turns taken and times caught, per floor and in total. Gold, silver and bronze "stars" per floor, based on turns versus a par number in the level file.

### 5.3 Levels
Five hand-built floors, stored as data (JSON) so they are easy to edit and to test:

| # | Name | Teaches |
|---|---|---|
| 1 | The Cellar | Moving, the camera, reaching the stairs |
| 2 | The Storeroom | Chests, keys and locked doors |
| 3 | The Broken Hall | Pits and bridges; restarting a floor |
| 4 | The Guardroom | One guard with a simple patrol; waiting |
| 5 | The Deep Gate | Everything together: two guards, two key colours |

Level file format (draft):
```json
{
  "id": 2, "name": "The Storeroom", "par": 40,
  "size": [12, 10],
  "start": { "col": 1, "row": 8, "facing": 0 },
  "floor":   ["ssss...", "..."],
  "objects": [{ "col": 4, "row": 3, "tile": "chestClosed", "facing": "S", "contains": ["key:brass", "gold:10"] }],
  "doors":   [{ "col": 6, "row": 5, "tile": "stoneWallDoorClosed", "facing": "E", "key": "brass" }],
  "guards":  [{ "patrol": [[3, 2], [3, 7]], "facing": 4 }],
  "exit":    { "col": 10, "row": 1, "tile": "stairs", "facing": "N", "requires": ["key:brass"] }
}
```
`floor` is a grid of one-character codes (an ASCII map), with a legend that maps each code to a floor tile. Objects, doors, guards and the exit are listed separately.

## 6. Screens and UI
- **Title screen:** game name, "New game", "Continue" (if there is a save), "How to play", Kenney credit.
- **Game screen:** the isometric view fills the window. A HUD shows the floor name and number, keys held (coloured icons), treasure, turn count against par, and Undo / Restart floor / Menu buttons.
- **Floor complete:** stars, turns, treasure, then "Next floor".
- **Caught / fell:** a short message ("A guard spotted you!") and an automatic restart of the floor.
- **Victory:** totals for all floors and "Play again".
- **How to play:** controls and the meaning of each tile, with sprite pictures.

### Rendering requirements
- One HTML `<canvas>`, drawn with the 2D context. Sprites are scaled to 50% by default (tile footprint 128 × 64 on screen) and scale with the window size.
- **Draw order (painter's algorithm):** sort everything by `col + row`, then floor before objects before characters. This makes nearer things cover farther things, as in the sample image.
- **Wall fading:** a wall or tall prop drawn in front of the player (closer to the camera and overlapping the player on screen) is drawn at 35% opacity, so the player is never hidden.
- **Camera:** follows the player smoothly, and stays inside the level bounds.
- **Animation:** `Run` plays over about 250 ms per tile step. `Pickup` plays when opening a chest. `Idle` shows otherwise. Input during an animation is queued (at most 1 action).
- **Highlights:** on hover or keyboard focus, the target tile gets a diamond outline. With click-to-move, the planned path is shown as dots.

## 7. Controls
| Action | Keyboard | Mouse / touch |
|---|---|---|
| Move | Arrow keys or WASD | Click or tap a reachable floor tile (walks the shortest path, one turn per step) |
| Interact | E or Space | Click a neighbouring chest or door |
| Wait | Z | Click the player |
| Undo | U | HUD button |
| Restart floor | R | HUD button |
| Menu | Esc | HUD button |

Arrow keys move in *screen* directions mapped to the grid (Up = north-east, i.e. direction 0), so "up" always looks like "up the screen and to the right".

## 8. Technical requirements
- **Stack:** Node.js ≥ 20, Express (static server only), plain ES-module JavaScript in the browser, no build step and no framework. This is the same as the chess app.
- **Layout:**
  ```
  test-app/dungeon/
    package.json  server.js  README.md
    public/
      index.html  style.css  icons.svg
      game.js       # pure rules: state, moves, guards, sight, win/lose (no DOM)
      render.js     # canvas drawing, draw order, camera, wall fading
      sprites.js    # loading the images, the sprite atlas, animation frames
      input.js      # keyboard, mouse, touch
      app.js        # screens, HUD, wiring
      levels/1.json … 5.json
      assets/       # the subset of PNGs the levels use, copied from .noobly/ui
    scripts/copy-assets.js   # copies the used sprites from .noobly/ui into public/assets
    test/  game.test.js  levels.test.js  server.test.js
  ```
- **Assets:** `.noobly/ui` stays the untouched source. `scripts/copy-assets.js` copies only the sprites the levels use (worked out from the level files), so the page loads fewer images.
- **Pure rules:** `game.js` exposes functions like `loadLevel(data)`, `step(state, action) → newState` (immutable), `visibleTiles(state, guard)` and `status(state)` (`playing`, `caught`, `fell`, `complete`). It has no DOM or canvas code.
- **Saving:** progress (highest floor reached, best stars per floor) goes in `localStorage`. The game in progress is not saved; refreshing restarts the current floor.
- **Server:** serves `public/` on `127.0.0.1`, port `PORT` (default 3000). It exports `app` for tests, like the chess server.
- **Performance:** 60 fps on a mid-range laptop for a 20 × 20 level. All sprites load before the first frame, and a loading bar shows progress.
- **Browsers:** latest Chrome, Firefox, Safari and Edge, desktop and mobile.

## 9. Accessibility
- Fully playable with the keyboard alone. Every button and screen element can be reached with Tab.
- An ARIA live region announces events in words ("Opened chest: brass key", "Door unlocked", "Guard ahead").
- Guard sight cones use a pattern as well as a colour, and key colours have letters on their icons (B / I / S), so colour is never the only signal.
- "Reduce motion" setting (it also follows `prefers-reduced-motion`): no camera easing; steps move instantly.

## 10. Testing and quality
- `npm test` runs `node --test` with no network.
- **Rules tests:** movement and blocking, chests and keys, locked doors, pits, guard patrol and line of sight (including walls blocking sight), undo, the exit condition, scoring.
- **Level tests:** every level file is valid, uses only sprite names that exist in `.noobly/ui/Isometric`, and **is solvable**. A breadth-first search over game states finds a route to the exit within the level's par plus a margin.
- **Server tests:** `/` returns the page, and asset and level files are served.
- **Manual check:** a browser smoke test, plus a screenshot compared with `Sample.png` for the look.

## 11. Success criteria
- A new player finishes floor 1 without reading instructions, in under 2 minutes.
- All 5 floors are solvable (proven by the solver test) and each takes 2–6 minutes.
- No visual sorting glitches (an object drawn over something in front of it) across all levels.
- `npm install && npm start` works offline after the install.

## 12. Assumptions and open questions
- **Assumption:** turn-based stealth and puzzles (no combat), because the pack has no enemy or attack art. *Open:* add simple combat later with tinted sprites?
- **Assumption:** only the male character exists in the pack, so there is no character choice. *Open:* offer tint options for the player's clothes?
- **Open:** should levels have more than one height (the Tiled sample stacks floors with a −78 px offset)? Version 1 keeps each level on one height; `stoneSteps` and `stairs` are decoration or exits only.
- **Open:** is the working title "Sandstone Depths" OK? Yes
