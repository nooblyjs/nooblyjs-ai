// Grid helpers and pathfinding. No three.js here, so this file runs in plain Node tests.

const SQRT2 = Math.SQRT2;

// The eight directions a walker can step in: four straight, four diagonal.
const STEPS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Turns a tile position into a string key, so tiles can live in a Set or Map. */
export function key(col, row) {
  return `${col},${row}`;
}

/** Makes a grid: a width x height area plus the set of tile keys that block walking. */
export function createGrid(width, height, blocked = new Set()) {
  return { width, height, blocked };
}

/** True when the tile is inside the grid and nothing blocks it. */
export function isWalkable(grid, col, row) {
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return false;
  return !grid.blocked.has(key(col, row));
}

// Octile distance: the cheapest possible cost to reach a tile when diagonals cost sqrt(2).
function heuristic(a, b) {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Finds the cheapest walk from start to goal (A* search).
 * Returns the tiles to step through, not including start, or null if there is no way.
 */
export function findPath(grid, start, goal) {
  if (!isWalkable(grid, goal.col, goal.row)) return null;
  if (start.col === goal.col && start.row === goal.row) return [];

  const startKey = key(start.col, start.row);
  const goalKey = key(goal.col, goal.row);
  const cost = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const closed = new Set();
  // A plain array is fine here: the map is small, and it keeps the code easy to follow.
  const open = [{ col: start.col, row: start.row, f: heuristic(start, goal) }];

  while (open.length > 0) {
    // Take the open tile that looks closest to the goal so far.
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[best].f) best = i;
    }
    const current = open.splice(best, 1)[0];
    const currentKey = key(current.col, current.row);
    if (currentKey === goalKey) return rebuildPath(cameFrom, goalKey);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    for (const [dc, dr, stepCost] of STEPS) {
      const col = current.col + dc;
      const row = current.row + dr;
      const nextKey = key(col, row);
      if (closed.has(nextKey) || !isWalkable(grid, col, row)) continue;
      // Stop diagonal steps from squeezing between two blocked tiles.
      if (dc !== 0 && dr !== 0 &&
          (!isWalkable(grid, current.col + dc, current.row) ||
           !isWalkable(grid, current.col, current.row + dr))) {
        continue;
      }
      const g = cost.get(currentKey) + stepCost;
      if (g < (cost.get(nextKey) ?? Infinity)) {
        cost.set(nextKey, g);
        cameFrom.set(nextKey, currentKey);
        open.push({ col, row, f: g + heuristic({ col, row }, goal) });
      }
    }
  }
  return null;
}

function rebuildPath(cameFrom, goalKey) {
  const tiles = [];
  let k = goalKey;
  while (cameFrom.has(k)) {
    const [col, row] = k.split(',').map(Number);
    tiles.unshift({ col, row });
    k = cameFrom.get(k);
  }
  return tiles;
}

/**
 * Tiles next to a target that a walker can stand on.
 * footprint is the list of tiles the target covers (one tile for a rock, four for the ship).
 */
export function approachTiles(grid, footprint) {
  const taken = new Set(footprint.map((t) => key(t.col, t.row)));
  const seen = new Set();
  const tiles = [];
  for (const { col, row } of footprint) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc;
      const r = row + dr;
      const k = key(c, r);
      if (taken.has(k) || seen.has(k) || !isWalkable(grid, c, r)) continue;
      seen.add(k);
      tiles.push({ col: c, row: r });
    }
  }
  return tiles;
}

/**
 * Walks to whichever approach tile of the footprint is quickest to reach.
 * Returns { path, goal } or null if nothing can be reached.
 */
export function findPathToTarget(grid, start, footprint) {
  let best = null;
  for (const goal of approachTiles(grid, footprint)) {
    const path = findPath(grid, start, goal);
    if (path && (!best || path.length < best.path.length)) best = { path, goal };
  }
  return best;
}
