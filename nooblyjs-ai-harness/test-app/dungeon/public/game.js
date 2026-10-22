// Phase 2: the game rules. Pure functions with no DOM or canvas, so they can be tested in Node.
// Phase 3: the level exit (stairs), its exit condition, and the game status.
// The state is never changed in place: `step` returns a new state. That makes undo (Phase 5) easy
// and lets the screen compare the old and new state to decide what to animate.

/**
 * The 4 grid directions the player can move, keyed by the character sprite's direction number.
 * The sprites face 8 ways (0–7); the even ones line up with the grid.
 * On screen: 0 = up-right, 2 = down-right, 4 = down-left, 6 = up-left.
 */
export const DIRECTIONS = Object.freeze({
  0: Object.freeze({ dc: 0, dr: -1 }),
  2: Object.freeze({ dc: 1, dr: 0 }),
  4: Object.freeze({ dc: 0, dr: 1 }),
  6: Object.freeze({ dc: -1, dr: 0 }),
});

/**
 * Which edge of its tile each facing of a wall sprite stands on, as the step that would cross it.
 * Kenney's suffix is the way the wall *faces*, not the edge it is on, so this was measured from the art.
 */
export const WALL_SIDE = Object.freeze({
  S: { dc: 0, dr: -1 }, // upper-right edge on screen
  E: { dc: -1, dr: 0 }, // upper-left edge
  N: { dc: 0, dr: 1 }, // lower-left edge
  W: { dc: 1, dr: 0 }, // lower-right edge
});

/** A corner piece covers two edges: the ones meeting at one point of the diamond. */
export const CORNER_SIDES = Object.freeze({
  S: [WALL_SIDE.S, WALL_SIDE.E], // top point
  N: [WALL_SIDE.N, WALL_SIDE.W], // bottom point
  E: [WALL_SIDE.E, WALL_SIDE.N], // left point
  W: [WALL_SIDE.S, WALL_SIDE.W], // right point
});

/** Wall sprites that block the edge they stand on. Doorways (archways, open doors and gates) do not. */
export const WALL_TILES = new Set([
  'stoneWall', 'stoneWallAged', 'stoneWallAgedLeft', 'stoneWallAgedRight', 'stoneWallBroken',
  'stoneWallBrokenLeft', 'stoneWallBrokenRight', 'stoneWallColumn', 'stoneWallColumnIn', 'stoneWallHalf',
  'stoneWallRound', 'stoneWallRoundBroken', 'stoneWallRoundWindow', 'stoneWallTop', 'stoneWallStructure',
  'stoneWallWindow', 'stoneWallWindowBars', 'stoneWallHole',
]);

/** Corner wall sprites, which block two edges. */
export const CORNER_TILES = new Set(['stoneWallCorner']);

/**
 * Props that fill their whole tile, so you cannot walk onto it.
 * `woodenSupports` is here because its posts stand on the tile's corners; the overhead beam pieces
 * (`woodenSupportBeams` and friends) will stay walkable.
 */
export const OBSTACLE_TILES = new Set([
  'barrel', 'barrels', 'barrelsStacked', 'woodenCrate', 'woodenCrates', 'woodenPile',
  'stoneColumn', 'stoneColumnWood', 'tableRound', 'tableRoundChairs', 'tableRoundItemsChairs',
  'tableShort', 'tableShortChairs', 'tableChairsBroken', 'chair', 'chestClosed', 'chestOpen',
  'woodenSupports',
]);

/** The `layer` value of floor tiles in a level's drawables (the same as LAYER.floor in render.js). */
export const FLOOR_LAYER = 0;

const key = (col, row) => `${col},${row}`;
const sideKey = ({ dc, dr }) => `${dc},${dr}`;

/**
 * Work out the rules-side map of a level from its list of drawables.
 * A level is { width, height, start: { col, row, facing }, items: [{ tile, facing, col, row, layer }] }.
 * Returns { width, height, floor: Set, obstacles: Set, walls: Map(tile → Set of sides) }.
 */
export function buildMap(level) {
  const floor = new Set();
  const obstacles = new Set();
  const walls = new Map();
  const addWall = (col, row, side) => {
    const tile = key(col, row);
    if (!walls.has(tile)) walls.set(tile, new Set());
    walls.get(tile).add(sideKey(side));
  };
  for (const item of level.items) {
    if (item.layer === FLOOR_LAYER) floor.add(key(item.col, item.row));
    else if (WALL_TILES.has(item.tile)) addWall(item.col, item.row, WALL_SIDE[item.facing]);
    else if (CORNER_TILES.has(item.tile)) for (const side of CORNER_SIDES[item.facing]) addWall(item.col, item.row, side);
    else if (OBSTACLE_TILES.has(item.tile)) obstacles.add(key(item.col, item.row));
  }
  return { width: level.width, height: level.height, floor, obstacles, walls };
}

/** True when a wall stands on the edge between a tile and its neighbour in direction { dc, dr }. */
export function wallBetween(map, col, row, { dc, dr }) {
  // The wall may be drawn on either tile: on this tile's edge, or on the neighbour's facing edge.
  return Boolean(map.walls.get(key(col, row))?.has(sideKey({ dc, dr }))
    || map.walls.get(key(col + dc, row + dr))?.has(sideKey({ dc: -dc, dr: -dr })));
}

/** True when the player may stand on this tile: inside the map, with a floor and nothing in the way. */
export function isWalkable(map, col, row) {
  return col >= 0 && row >= 0 && col < map.width && row < map.height
    && map.floor.has(key(col, row))
    && !map.obstacles.has(key(col, row));
}

/**
 * A fresh game state for a level: the player at the start, on turn 0, with empty pockets.
 * `level.exit` ({ col, row, requires }) is optional, so small test levels can leave it out.
 */
export function createState(level) {
  const map = buildMap(level);
  const { col, row, facing = 0 } = level.start;
  if (!isWalkable(map, col, row)) throw new Error(`The start tile ${col}, ${row} is not walkable`);
  const exit = level.exit
    ? Object.freeze({ col: level.exit.col, row: level.exit.row, requires: Object.freeze([...(level.exit.requires ?? [])]) })
    : null;
  return Object.freeze({
    map,
    exit,
    player: Object.freeze({ col, row, facing }),
    inventory: Object.freeze([]),
    turn: 0,
    status: 'playing',
    event: 'start',
  });
}

/** The game status: 'playing' or 'complete' (Phase 5 and 6 add 'fell' and 'caught'). */
export function status(state) {
  return state.status;
}

/** What the exit still needs before it lets the player leave, e.g. ['key:brass']. Empty when it is open. */
export function missingForExit(state) {
  if (!state.exit) return [];
  return state.exit.requires.filter((item) => !state.inventory.includes(item));
}

/** True when the player is standing on the exit tile. */
export function onExit(state) {
  return Boolean(state.exit && state.player.col === state.exit.col && state.player.row === state.exit.row);
}

/**
 * Apply one player action and return the new state.
 * Actions: { type: 'move', direction: 0 | 2 | 4 | 6 } and { type: 'wait' }.
 * A move into a wall, prop or the map edge turns the player to face it, but costs no turn.
 * `event` says what happened ('moved', 'blocked' or 'waited'), so the screen knows what to animate.
 * Stepping onto the exit with nothing missing ends the floor: the status becomes 'complete'.
 * Once the floor is over, actions are ignored and the same state comes back.
 */
export function step(state, action) {
  if (state.status !== 'playing') return state;
  if (action.type === 'wait') {
    return Object.freeze({ ...state, turn: state.turn + 1, event: 'waited' });
  }
  if (action.type === 'move') {
    const delta = DIRECTIONS[action.direction];
    if (!delta) throw new Error(`Unknown direction: ${action.direction}`);
    const { col, row } = state.player;
    const to = { col: col + delta.dc, row: row + delta.dr };
    const blocked = wallBetween(state.map, col, row, delta) || !isWalkable(state.map, to.col, to.row);
    if (blocked) {
      return Object.freeze({ ...state, player: Object.freeze({ col, row, facing: action.direction }), event: 'blocked' });
    }
    const moved = Object.freeze({
      ...state,
      player: Object.freeze({ ...to, facing: action.direction }),
      turn: state.turn + 1,
      event: 'moved',
    });
    // The move still counts (and animates) as a step; the status says the floor is done.
    if (onExit(moved) && missingForExit(moved).length === 0) return Object.freeze({ ...moved, status: 'complete' });
    return moved;
  }
  throw new Error(`Unknown action: ${action.type}`);
}
