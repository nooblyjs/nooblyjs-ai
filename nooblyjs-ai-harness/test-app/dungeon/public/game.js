// Phase 2: the game rules. Pure functions with no DOM or canvas, so they can be tested in Node.
// Phase 3: the level exit (stairs), its exit condition, and the game status.
// Phase 4: the interact action, chests (keys and gold), and locked doors and gates.
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

/** The `layer` value of objects: walls, props, chests and doors (the same as LAYER.object in render.js). */
export const OBJECT_LAYER = 1;

/**
 * Locked doors and gates, and the sprite each one turns into once unlocked.
 * They are not in WALL_TILES: whether they block depends on the game state, not just the map.
 */
export const LOCKED_DOORS = Object.freeze({
  stoneWallDoorClosed: 'stoneWallDoorOpen',
  stoneWallDoorBars: 'stoneWallDoorOpen',
  stoneWallGateClosed: 'stoneWallGateOpen',
  stoneWallGateBars: 'stoneWallGateOpen',
});

/** The chest sprites before and after opening. */
export const CHEST_CLOSED = 'chestClosed';
export const CHEST_OPEN = 'chestOpen';

const key = (col, row) => `${col},${row}`;
const sideKey = ({ dc, dr }) => `${dc},${dr}`;

/**
 * One name for the edge between a tile and its neighbour in direction { dc, dr }.
 * The same edge can be described from either side (a W wall on 1, 1 is an E wall on 2, 1),
 * so we always name it from the tile with the smaller col or row.
 */
export function edgeKey(col, row, { dc, dr }) {
  if (dc === 1) return `${col},${row}|col`;
  if (dc === -1) return `${col - 1},${row}|col`;
  if (dr === 1) return `${col},${row}|row`;
  return `${col},${row - 1}|row`;
}

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
 * `level.chests` ([{ col, row, facing, contains }]) and `level.doors` ([{ col, row, tile, facing, key }])
 * are optional too. They live in the state, not the map, because opening them changes them.
 */
export function createState(level) {
  const map = buildMap(level);
  const { col, row, facing = 0 } = level.start;
  if (!isWalkable(map, col, row)) throw new Error(`The start tile ${col}, ${row} is not walkable`);
  const exit = level.exit
    ? Object.freeze({ col: level.exit.col, row: level.exit.row, requires: Object.freeze([...(level.exit.requires ?? [])]) })
    : null;
  // Chests fill their tile whether open or not, so they are obstacles on the map.
  for (const chest of level.chests ?? []) map.obstacles.add(key(chest.col, chest.row));
  const chests = (level.chests ?? []).map((chest) => Object.freeze({
    col: chest.col, row: chest.row, facing: chest.facing, contains: Object.freeze([...(chest.contains ?? [])]), open: false,
  }));
  const doors = (level.doors ?? []).map((door) => {
    if (!LOCKED_DOORS[door.tile]) throw new Error(`${door.tile} is not a locked door or gate`);
    return Object.freeze({
      col: door.col, row: door.row, tile: door.tile, facing: door.facing, key: door.key,
      edge: edgeKey(door.col, door.row, WALL_SIDE[door.facing]), open: false,
    });
  });
  return Object.freeze({
    map,
    exit,
    player: Object.freeze({ col, row, facing }),
    inventory: Object.freeze([]),
    gold: 0,
    chests: Object.freeze(chests),
    doors: Object.freeze(doors),
    turn: 0,
    status: 'playing',
    event: 'start',
    found: Object.freeze([]),
  });
}

/** The locked (still closed) door on the edge between a tile and its neighbour in direction { dc, dr }, or null. */
export function lockedDoorBetween(state, col, row, side) {
  const edge = edgeKey(col, row, side);
  return state.doors.find((door) => !door.open && door.edge === edge) ?? null;
}

/**
 * What the player is facing and could use with the interact action:
 * { kind: 'door', index, door } for a locked door on the edge in front,
 * { kind: 'chest', index, chest } for a closed chest on the tile in front, or null.
 * A wall between the player and a chest gets in the way.
 */
export function facingTarget(state) {
  const { col, row, facing } = state.player;
  const side = DIRECTIONS[facing];
  const door = lockedDoorBetween(state, col, row, side);
  if (door) return { kind: 'door', index: state.doors.indexOf(door), door };
  if (wallBetween(state.map, col, row, side)) return null;
  const index = state.chests.findIndex((chest) => !chest.open && chest.col === col + side.dc && chest.row === row + side.dr);
  return index === -1 ? null : { kind: 'chest', index, chest: state.chests[index] };
}

/** The colour of each key in an inventory, e.g. ['brass', 'brass', 'iron'] (one entry per key held). */
export function keysHeld(state) {
  return state.inventory.filter((item) => item.startsWith('key:')).map((item) => item.slice(4));
}

/**
 * The drawables that come from the game state: chests (open or closed) and doors (locked or open).
 * Put them together with a level's static `items` for drawing. Doors go first and chests last,
 * so on a shared tile a door is drawn like a wall (behind) and a chest like a prop (in front).
 */
export function sceneItems(items, state) {
  const doors = state.doors.map(({ col, row, tile, facing, open }) => ({
    tile: open ? LOCKED_DOORS[tile] : tile, facing, col, row, layer: OBJECT_LAYER,
  }));
  const chests = state.chests.map(({ col, row, facing, open }) => ({
    tile: open ? CHEST_OPEN : CHEST_CLOSED, facing, col, row, layer: OBJECT_LAYER,
  }));
  return [...doors, ...items, ...chests];
}

/** A new state with some changes. `found` (what a chest held) only lasts for the turn it was found. */
const next = (state, changes) => Object.freeze({ ...state, found: Object.freeze([]), ...changes });

/** Replace one entry of a frozen list. */
const replaceAt = (list, index, value) => Object.freeze(list.map((item, i) => (i === index ? value : item)));

/** The interact action: open the chest or unlock the door in front of the player. */
function interact(state) {
  const target = facingTarget(state);
  if (!target) return next(state, { event: 'nothing' });
  if (target.kind === 'chest') {
    const { chest, index } = target;
    const keys = chest.contains.filter((item) => item.startsWith('key:'));
    const gold = chest.contains
      .filter((item) => item.startsWith('gold:'))
      .reduce((sum, item) => sum + Number(item.slice(5)), 0);
    return next(state, {
      chests: replaceAt(state.chests, index, Object.freeze({ ...chest, open: true })),
      inventory: Object.freeze([...state.inventory, ...keys]),
      gold: state.gold + gold,
      turn: state.turn + 1,
      event: 'opened',
      found: chest.contains,
    });
  }
  const { door, index } = target;
  const keyIndex = state.inventory.indexOf(`key:${door.key}`);
  // No matching key: like walking into a wall, trying costs no turn.
  if (keyIndex === -1) return next(state, { event: 'locked' });
  return next(state, {
    doors: replaceAt(state.doors, index, Object.freeze({ ...door, open: true })),
    inventory: Object.freeze(state.inventory.filter((_, i) => i !== keyIndex)), // the key is used up
    turn: state.turn + 1,
    event: 'unlocked',
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
 * Actions: { type: 'move', direction: 0 | 2 | 4 | 6 }, { type: 'wait' } and { type: 'interact' }.
 * A move into a wall, prop, locked door or the map edge turns the player to face it, but costs no turn.
 * Interact opens the chest or unlocks the door in front (with a key of the same colour, which is used up).
 * `event` says what happened ('moved', 'blocked', 'waited', 'opened', 'unlocked', 'locked' or 'nothing'),
 * so the screen knows what to animate. After 'opened', `found` lists what was in the chest.
 * Stepping onto the exit with nothing missing ends the floor: the status becomes 'complete'.
 * Once the floor is over, actions are ignored and the same state comes back.
 */
export function step(state, action) {
  if (state.status !== 'playing') return state;
  if (action.type === 'wait') return next(state, { turn: state.turn + 1, event: 'waited' });
  if (action.type === 'interact') return interact(state);
  if (action.type === 'move') {
    const delta = DIRECTIONS[action.direction];
    if (!delta) throw new Error(`Unknown direction: ${action.direction}`);
    const { col, row } = state.player;
    const to = { col: col + delta.dc, row: row + delta.dr };
    const blocked = wallBetween(state.map, col, row, delta)
      || lockedDoorBetween(state, col, row, delta)
      || !isWalkable(state.map, to.col, to.row);
    if (blocked) return next(state, { player: Object.freeze({ col, row, facing: action.direction }), event: 'blocked' });
    const moved = next(state, {
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
