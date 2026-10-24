# Roadmap: "Sandstone Depths"

Companion to `product.md`. The game is built in small phases. Each phase ends with something you can run or test, and the game stays playable from Phase 2 onwards. "Done when" lists the acceptance checks for each phase.

Sizes: **S** = under half a day, **M** = about a day, **L** = 2+ days.

---

## Phase 0: Project skeleton (S)
- `package.json` (ES modules, Node ≥ 20, Express, scripts `start`, `dev`, `test`, `assets`), `server.js` (serves `public/` on `127.0.0.1:$PORT`, exports `app`), `README.md` with run steps and the Kenney CC0 credit.
- `public/index.html` with a full-window `<canvas>`, `style.css`, and an empty `app.js`.
- `scripts/copy-assets.js`: copies the needed PNGs from `noobly/ui/Isometric` and `noobly/ui/Characters/Male` into `public/assets/`. To begin with it copies a fixed starter list; Phase 6 changes it to read the level files.
- `test/server.test.js`.

**Done when:** `npm install && npm run assets && npm start` serves a blank page, and `npm test` passes.

## Phase 1: Draw a static isometric room (M)
- `sprites.js`: loads images with a promise, shows load progress, and finds a sprite by name and facing (`stoneWall`, `N`).
- `render.js`: grid-to-screen maths (`(col − row) × 128`, `(col + row) × 64`, scaled), with the image anchored so the diamond at the bottom of the 256 × 512 sprite sits on its tile. Draw order sorted by `col + row`, then by layer (floor → object → character).
- A hard-coded 8 × 8 room: `stone` floor, `stoneWall` edges with a `stoneWallCorner`, a `stoneWallDoorOpen`, a barrel, a chest and a `woodenSupports` beam.
- Fit the canvas to the window and to the device pixel ratio.

**Done when:** the room looks right next to `Sample.png`: no gaps between floor tiles, walls stand on their tiles, and nearer objects cover farther ones. Unit tests cover the grid-to-screen and screen-to-grid maths.

## Phase 2: Player, movement and animation (M)
- `game.js` (pure): `createState(level)`, `step(state, action)` for `move` (4 directions) and `wait`. Walls, obstacles and the map edge block movement, and a blocked move costs no turn.
- `input.js`: arrow keys and WASD, mapped to screen directions, with a one-action queue.
- Player sprite: `Idle` facing the last direction; `Run` (10 frames) while moving between tiles over about 250 ms.
- Camera follows the player with easing and stays inside the level bounds.

**Done when:** you can walk around the Phase 1 room and cannot walk through walls or props. `game.test.js` covers movement, blocking and turn counting.

## Phase 3: Level files and the level exit (M)
- JSON level format (`product.md` §5.3): ASCII floor map with a legend, plus `objects`, `doors`, `exit`, `start`, `par`.
- `loadLevel(data)` checks the file and gives clear errors (unknown tile, start position on a wall, exit missing).
- `stairs` exit: stepping onto it with the exit condition met → status `complete`.
- Level 1, "The Cellar", built from the format.
- `test/levels.test.js`: each level's JSON is valid, and every sprite name exists in `noobly/ui/Isometric`.

**Done when:** Level 1 loads from JSON, can be played to its stairs, and shows a simple "Floor complete" message.

## Phase 4: Chests, keys and locked doors (M)
- Interact action (`E`/`Space`) on the tile in front of the player.
- Chests: `chestClosed` → `chestOpen`, contents (`key:<colour>`, `gold:<n>`) go into the inventory, and the `Pickup` animation plays.
- Locked doors and gates (`stoneWallDoorClosed`, `stoneWallGateClosed`, `…Bars`) block until opened with a matching key, then swap to the `Open` sprite and become passable. The key is used up.
- Exit conditions such as `requires: ["key:brass"]`.
- Simple HUD: keys (inline SVG icons with letters), gold, turns against par.
- Level 2, "The Storeroom".

**Done when:** Level 2 can only be finished by opening the right chest and door. Rules tests cover chests, matching and wrong keys, and the exit condition.

## Phase 5: Hazards and restarting a floor (S)
- Pits: `planksHole`, `planksBroken`, `bridgeBroken` → status `fell`. The safe `bridge` is walkable.
- Restart a floor: back to the start, with the inventory as it was on entry (`R` key and HUD button).
- Undo, up to 20 turns (`U`), using the immutable state history.
- Level 3, "The Broken Hall".

**Done when:** falling restarts the floor with a message, undo works across chest opening and door unlocking, and these have tests.

## Phase 6: Guards and line of sight (L)
- Guards: the male sprite tinted at draw time (cached on an offscreen canvas), walking their patrol waypoints one step per turn, turning to face each move.
- `visibleTiles(state, guard)`: 3 tiles straight ahead, blocked by walls, closed doors and obstacles. Sight cones drawn on the floor with a colour and a hatched pattern.
- Caught (ending a turn in sight, or bumping into a guard) → status `caught`, then restart.
- Level 4, "The Guardroom".
- `copy-assets.js` now works out which sprites to copy from the level files.

**Done when:** guards move in step with the player's turns, walls block sight, and being seen restarts the floor. Tests cover patrol order, sight blocking and catching (including a guard stepping into the player).

## Phase 7: Full game flow (M)
- Screens: title (New game / Continue / How to play / credit), floor complete (stars, turns, gold), caught/fell message, victory with totals.
- Progress in `localStorage`: highest floor reached, best stars per floor.
- Level 5, "The Deep Gate".
- **Solver test:** a breadth-first search over `step()` proves every level can be finished within `par` + 50%.

**Done when:** you can play from the title screen through all 5 floors to the victory screen, Continue resumes at the highest floor reached, and the solver test passes for every level.

## Phase 8: Mouse, touch and polish (M)
- Click or tap a tile → shortest path (breadth-first search) walked one turn per step, with path dots and a hover diamond. Click the player to wait; click a chest or door next to you to use it.
- Wall fading: walls and tall props in front of the player drawn at 35% opacity.
- Props from the sample image for atmosphere: `woodenSupportBeams`, `tableRoundChairs`, `barrelsStacked`, `stoneWallBroken*`, `stoneWallWindow*`, `stoneColumn`.
- A warm sandstone background colour like the reference, a soft vignette, and a short fade between floors.

**Done when:** the whole game can be played with only a mouse or only touch on a phone, and the player is never hidden behind a wall.

## Phase 9: Accessibility, performance and release (S–M)
- ARIA live region for events. All screens and buttons work with Tab, Enter and Esc. Focus outlines are visible.
- "Reduce motion" option, which also follows `prefers-reduced-motion`.
- Performance: keep floor tiles drawn on an offscreen canvas until something changes. Check 60 fps on a 20 × 20 level.
- Test in Chrome, Firefox, Safari and mobile Safari/Chrome. Desktop and mobile screenshots for the README (like the chess app).
- Final README: how to play, controls, level file format, credits.

**Done when:** every item in `product.md` §9–§11 is checked, and `npm test` passes offline.

---

## Stretch goals (after version 1)
| Idea | Notes |
|---|---|
| Level editor in the browser | Paint tiles and objects on the grid and export JSON. Reuses `render.js`. |
| Import Tiled `.tmx` maps | Use `Samples/Tiled Sample.zip` as a test map. Height layers come from `offsety`. |
| Several heights per level | `stoneSteps`, `stairs` and raised floors, using the −78 px per-floor offset from the Tiled sample. |
| Procedural floors | Rooms and corridors, then the solver checks that the floor can be finished. |
| Simple combat | Tinted guards that can be knocked out by sneaking up behind them, using the `Pickup` animation as the action. |
| Player tint choice | Recolour the clothes on the title screen. |
| Sound | CC0 footsteps, a chest creak and a door unlock sound. |
| Side-view mode | Use the `Angle/` sprite set. |

## Dependencies and risks
| Risk | Mitigation |
|---|---|
| Draw-order glitches with tall and wide sprites | Keep every object to one tile. Test the order early (Phase 1) with a test room that has the tricky cases. |
| Large images (256 × 512) slow down loading on mobile | Copy only the sprites in use (Phase 6). Later: pack them into a sprite sheet or downscale them to 50% at copy time. |
| No enemy art | Tinted player sprite plus sight cones (decided in `product.md` §4.4). |
| Levels that cannot be finished | The solver test runs in `npm test` (Phase 7). |
| Tinting is slow on canvas | Tint each frame once into an offscreen canvas and cache it. |
