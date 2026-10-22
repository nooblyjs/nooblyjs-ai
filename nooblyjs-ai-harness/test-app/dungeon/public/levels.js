// Phase 3: level files. Each floor is stored as JSON in public/levels/ (see product.md §5.3), so it is
// easy to edit by hand and to test. loadLevel checks a file and turns it into the level object that
// game.js plays and render.js draws: a size, a start, an exit and a list of drawables.
import { LAYER } from './render.js';
import { buildMap, isWalkable, DIRECTIONS } from './game.js';

/** Every tile sprite name in the Kenney pack (.noobly/ui/Isometric). A test checks this list against the files. */
export const TILE_NAMES = new Set([
  'barrel', 'barrels', 'barrelsStacked', 'bridge', 'bridgeBroken', 'chair', 'chestClosed', 'chestOpen',
  'dirt', 'dirtTiles', 'planks', 'planksBroken', 'planksHole', 'stairs', 'stairsAged', 'stairsCorner',
  'stairsSpiral', 'stone', 'stoneColumn', 'stoneColumnWood', 'stoneCorner', 'stoneInset', 'stoneLeft',
  'stoneMissingTiles', 'stoneRight', 'stoneSide', 'stoneSideUneven', 'stoneStep', 'stoneSteps', 'stoneTile',
  'stoneUneven', 'stoneWall', 'stoneWallAged', 'stoneWallAgedLeft', 'stoneWallAgedRight', 'stoneWallArchway',
  'stoneWallBroken', 'stoneWallBrokenLeft', 'stoneWallBrokenRight', 'stoneWallColumn', 'stoneWallColumnIn',
  'stoneWallCorner', 'stoneWallDoor', 'stoneWallDoorBars', 'stoneWallDoorClosed', 'stoneWallDoorOpen',
  'stoneWallGate', 'stoneWallGateBars', 'stoneWallGateClosed', 'stoneWallGateOpen', 'stoneWallHalf',
  'stoneWallHole', 'stoneWallRound', 'stoneWallRoundBroken', 'stoneWallRoundWindow', 'stoneWallStructure',
  'stoneWallTop', 'stoneWallWindow', 'stoneWallWindowBars', 'tableChairsBroken', 'tableRound',
  'tableRoundChairs', 'tableRoundItemsChairs', 'tableShort', 'tableShortChairs', 'woodenCrate', 'woodenCrates',
  'woodenPile', 'woodenSupportBeams', 'woodenSupports', 'woodenSupportsBeam', 'woodenSupportsBlock',
]);

/** The four facings every tile sprite comes in. */
export const FACINGS = ['N', 'E', 'S', 'W'];

/** Sprites that can be a level's exit. */
export const EXIT_TILES = new Set(['stairs', 'stairsAged', 'stairsSpiral']);

/** Key colours (product.md §5.2). An exit condition looks like "key:brass". */
export const KEY_COLOURS = ['brass', 'iron', 'silver'];

/** The floor map character for "nothing here" (outside the dungeon). */
export const VOID = '.';

/** How many level files there are in public/levels/ (1.json, 2.json, …). */
export const LEVEL_COUNT = 1;

/**
 * The facing of a wall sprite for each edge of its tile (see WALL_SIDE in game.js for the reverse).
 * The "back" edges are the two upper edges of the diamond on screen, the "front" edges the two lower ones.
 */
export const WALL_EDGE = Object.freeze({
  backRow: 'S', // upper-right edge, towards row − 1
  backCol: 'E', // upper-left edge, towards col − 1
  frontRow: 'N', // lower-left edge, towards row + 1
  frontCol: 'W', // lower-right edge, towards col + 1
});

/** The facing of `stoneWallCorner` that joins the two back walls at the top corner of a tile. */
export const BACK_CORNER = 'S';

/** The top-level fields a level file may have. Anything else is probably a typo. */
const FIELDS = new Set(['id', 'name', 'par', 'size', 'legend', 'floor', 'start', 'objects', 'doors', 'guards', 'exit']);

/** An error that lists everything wrong with a level file, not just the first problem. */
export class LevelError extends Error {
  constructor(title, problems) {
    super(`${title} has ${problems.length === 1 ? 'a problem' : 'problems'}:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.name = 'LevelError';
    this.problems = problems;
  }
}

/** The URL of a level file, e.g. levels/1.json. */
export function levelUrl(id) {
  return `levels/${id}.json`;
}

const isWhole = (value) => Number.isInteger(value) && value > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A floor tile's facing when the legend does not give one: turning the same tile breaks up the pattern. */
export function floorFacing(col, row) {
  return FACINGS[(col * 3 + row * 5) % 4];
}

/**
 * Check a level file's data and build the level from it.
 * Returns { id, name, par, width, height, start, exit: { col, row, requires }, items }.
 * Throws a LevelError listing every problem found (unknown tiles, a start on a wall, a missing exit…).
 */
export function loadLevel(data) {
  if (!isObject(data)) throw new LevelError('The level file', ['it should be a JSON object']);
  const title = `Level ${data.id ?? '?'}${typeof data.name === 'string' ? ` ("${data.name}")` : ''}`;
  const problems = [];
  const fail = () => new LevelError(title, problems);

  for (const field of Object.keys(data)) if (!FIELDS.has(field)) problems.push(`unknown field "${field}"`);
  if (!isWhole(data.id)) problems.push('"id" should be a whole number above 0');
  if (typeof data.name !== 'string' || !data.name.trim()) problems.push('"name" is missing');
  if (!isWhole(data.par)) problems.push('"par" should be a whole number of turns above 0');

  // The size, legend and floor map come next: every other check needs the grid, so a broken grid stops here.
  const generalProblems = problems.length;
  const [width, height] = Array.isArray(data.size) ? data.size : [];
  if (!isWhole(width) || !isWhole(height) || data.size.length !== 2) {
    problems.push('"size" should be [width, height], two whole numbers above 0');
    throw fail();
  }
  const legend = new Map();
  if (!isObject(data.legend)) problems.push('"legend" should map floor map characters to floor tiles');
  for (const [code, value] of Object.entries(isObject(data.legend) ? data.legend : {})) {
    const entry = typeof value === 'string' ? { tile: value } : value;
    if (code.length !== 1 || code === VOID) problems.push(`legend code "${code}" should be one character other than "${VOID}"`);
    else if (!isObject(entry) || !TILE_NAMES.has(entry.tile)) problems.push(`legend code "${code}" uses an unknown tile: ${JSON.stringify(entry?.tile ?? value)}`);
    else if (entry.facing !== undefined && !FACINGS.includes(entry.facing)) problems.push(`legend code "${code}" has an unknown facing "${entry.facing}"`);
    else legend.set(code, entry);
  }
  const floor = data.floor;
  if (!Array.isArray(floor) || floor.length !== height || floor.some((line) => typeof line !== 'string')) {
    problems.push(`"floor" should be a list of ${height} lines (the height in "size")`);
    throw fail();
  }
  floor.forEach((line, row) => {
    if (line.length !== width) problems.push(`floor line ${row} is ${line.length} characters long, but the width is ${width}`);
    [...line].forEach((code, col) => {
      if (code !== VOID && !legend.has(code) && isObject(data.legend) && !(code in data.legend)) {
        problems.push(`floor tile ${col}, ${row} uses "${code}", which is not in the legend`);
      }
    });
  });
  if (problems.length > generalProblems) throw fail();

  const inside = (col, row) => Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < width && row < height;
  const hasFloor = (col, row) => inside(col, row) && floor[row][col] !== VOID;

  /** Check one placed sprite ({ col, row, tile, facing }) and return a problem, or null if it is fine. */
  const placement = (thing, what, tiles = TILE_NAMES) => {
    if (!isObject(thing)) return `${what} should be an object`;
    const { col, row, tile, facing } = thing;
    if (!inside(col, row)) return `${what} at ${col}, ${row} is outside the map`;
    if (!tiles.has(tile)) return `${what} at ${col}, ${row} uses an unknown tile: ${JSON.stringify(tile)}`;
    if (!FACINGS.includes(facing)) return `${what} at ${col}, ${row} has an unknown facing ${JSON.stringify(facing)}`;
    if (!hasFloor(col, row)) return `${what} at ${col}, ${row} is not on a floor tile`;
    return null;
  };

  const objects = data.objects ?? [];
  if (!Array.isArray(objects)) problems.push('"objects" should be a list');
  else objects.forEach((thing, index) => {
    const problem = placement(thing, `object ${index + 1}`);
    if (problem) problems.push(problem);
  });
  // Doors and guards have rules of their own, which arrive in later phases.
  if (data.doors?.length) problems.push('doors are not supported yet (they arrive in Phase 4)');
  if (data.guards?.length) problems.push('guards are not supported yet (they arrive in Phase 6)');

  const exit = data.exit;
  if (!exit) problems.push('the level has no exit');
  else {
    const problem = placement(exit, 'the exit', EXIT_TILES);
    if (problem) problems.push(problem.replace('an unknown tile', `a tile that is not stairs (${[...EXIT_TILES].join(', ')})`));
    const requires = exit.requires ?? [];
    if (!Array.isArray(requires)) problems.push('the exit\'s "requires" should be a list');
    else for (const item of requires) {
      const colour = typeof item === 'string' && item.startsWith('key:') ? item.slice(4) : null;
      if (!KEY_COLOURS.includes(colour)) problems.push(`the exit requires ${JSON.stringify(item)}, but only keys can be required (${KEY_COLOURS.map((c) => `key:${c}`).join(', ')})`);
    }
  }
  if (problems.length) throw fail();

  const items = buildItems({ width, height, floor, legend, objects, exit, hasFloor });

  // With the drawables built, the rules can say which tiles are walkable.
  const map = buildMap({ width, height, items });
  const start = data.start;
  const facing = start?.facing ?? 0;
  if (!isObject(start)) problems.push('the level has no start');
  else if (!inside(start.col, start.row)) problems.push(`the start ${start.col}, ${start.row} is outside the map`);
  else if (!isWalkable(map, start.col, start.row)) problems.push(`the start ${start.col}, ${start.row} is not walkable (no floor, or something is in the way)`);
  if (isObject(start) && !(facing in DIRECTIONS)) problems.push(`the start facing should be 0, 2, 4 or 6, not ${JSON.stringify(facing)}`);
  if (!isWalkable(map, exit.col, exit.row)) problems.push(`the exit at ${exit.col}, ${exit.row} is blocked by an object`);
  if (isObject(start) && start.col === exit.col && start.row === exit.row) problems.push('the start is on the exit');
  if (problems.length) throw fail();

  return Object.freeze({
    id: data.id,
    name: data.name,
    par: data.par,
    width,
    height,
    start: Object.freeze({ col: start.col, row: start.row, facing }),
    exit: Object.freeze({ col: exit.col, row: exit.row, requires: Object.freeze([...(exit.requires ?? [])]) }),
    items: Object.freeze(items),
  });
}

/** Wall sprites, which stand on a tile's edges (used to decide where to add automatic walls). */
const isWallPiece = (tile) => tile.startsWith('stoneWall');

/**
 * Turn the checked level data into drawables: { tile, facing, col, row, layer }.
 * The back walls are added automatically: a floor tile with no floor behind it (row − 1 or col − 1)
 * gets a wall on that edge, or a corner piece if both are open. The front edges stay open, so we can
 * see into the room (a cut-away view). A tile with its own wall pieces in `objects` gets no
 * automatic walls, so a level can swap in a window or a doorway.
 */
function buildItems({ width, height, floor, legend, objects, exit, hasFloor }) {
  const items = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const code = floor[row][col];
      if (code === VOID) continue;
      const { tile, facing = floorFacing(col, row) } = legend.get(code);
      items.push({ tile, facing, col, row, layer: LAYER.floor });
    }
  }

  const ownWalls = new Set(objects.filter(({ tile }) => isWallPiece(tile)).map(({ col, row }) => `${col},${row}`));
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!hasFloor(col, row) || ownWalls.has(`${col},${row}`)) continue;
      const openBehind = !hasFloor(col, row - 1);
      const openLeft = !hasFloor(col - 1, row);
      if (openBehind && openLeft) items.push({ tile: 'stoneWallCorner', facing: BACK_CORNER, col, row, layer: LAYER.object });
      else if (openBehind) items.push({ tile: 'stoneWall', facing: WALL_EDGE.backRow, col, row, layer: LAYER.object });
      else if (openLeft) items.push({ tile: 'stoneWall', facing: WALL_EDGE.backCol, col, row, layer: LAYER.object });
    }
  }

  // Walls first, then props, so a prop on the same tile as a wall is drawn in front of it.
  const byKind = [...objects].sort((a, b) => Number(!isWallPiece(a.tile)) - Number(!isWallPiece(b.tile)));
  for (const { tile, facing, col, row } of byKind) items.push({ tile, facing, col, row, layer: LAYER.object });
  items.push({ tile: exit.tile, facing: exit.facing, col: exit.col, row: exit.row, layer: LAYER.object });
  return items;
}
