// Builds the asteroid field: where the rocks, crystal ore, decoration and the ship sit.
// Pure data, no three.js. The same seed always gives the same field, so tests can check it.

import { key } from './grid.js';

export const WORLD_SIZE = 48;

// The ship covers a 2 x 2 block of tiles. Its top-left tile is stored here.
// The ship starts at the bottom of the map and the depot is at the top-left, so the trip is long.
export const SHIP_TILE = { col: 23, row: 42 };
export const START_TILE = { col: 24, row: 39 };
export const SHIP_MODEL = 'craft_miner';
// The depot is a 2 x 2 station. The ship parks just south of it, at the dock.
export const DEPOT_TILE = { col: 4, row: 5 };
export const DEPOT_DOCK = { x: DEPOT_TILE.col + 0.5, z: DEPOT_TILE.row + 3.2 }; // in world units
export const DEPOT_MODEL = 'hangar_largeA';

// Kenney model names, grouped by what they are for.
export const ASTEROID_MODELS = ['rock_largeA', 'rock_largeB', 'meteor', 'meteor_half'];
export const ORE_MODELS = ['rock_crystalsLargeA', 'rock_crystalsLargeB', 'rock_crystals'];
export const DECOR_MODELS = ['rocks_smallA', 'rocks_smallB', 'crater', 'bones'];
// Every model a prop can use. The game loads these up front; a missing one would break start-up.
export const PROP_MODELS = [
  SHIP_MODEL, DEPOT_MODEL, ...ASTEROID_MODELS, ...ORE_MODELS, ...DECOR_MODELS,
];

/** A small seeded random number generator (mulberry32). Same seed, same numbers. */
export function createRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 2 x 2 tiles a block of the given top-left tile covers. */
function block2x2({ col, row }) {
  return [
    { col, row }, { col: col + 1, row },
    { col, row: row + 1 }, { col: col + 1, row: row + 1 },
  ];
}

/** The 2 x 2 tiles the ship covers. */
export function shipFootprint() {
  return block2x2(SHIP_TILE);
}

/** The 2 x 2 tiles the depot covers. */
export function depotFootprint() {
  return block2x2(DEPOT_TILE);
}

// Tiles near the ship, the depot and the start are kept clear so nothing spawns in the way.
function isSafe(col, row) {
  const near = (t) => Math.max(Math.abs(col - t.col), Math.abs(row - t.row)) <= 2;
  return near(SHIP_TILE) || near(DEPOT_TILE) || near(START_TILE);
}

/**
 * Makes a world: { width, height, start, props, blocked }.
 * Each prop: { id, kind, model, footprint, rotation, amount? }.
 * kind is 'ship', 'depot', 'asteroid', 'ore' or 'decor'. Only decor is walkable.
 */
export function generateWorld(seed = 1) {
  const random = createRandom(seed);
  const props = [];

  props.push({
    id: 'ship', kind: 'ship', model: SHIP_MODEL,
    footprint: shipFootprint(), rotation: 0,
  });
  props.push({
    id: 'depot', kind: 'depot', model: DEPOT_MODEL,
    footprint: depotFootprint(), rotation: 0,
  });

  for (let row = 0; row < WORLD_SIZE; row++) {
    for (let col = 0; col < WORLD_SIZE; col++) {
      if (isSafe(col, row)) continue;
      const roll = random();
      const rotation = Math.floor(random() * 4);
      const id = `p${props.length}`;
      const footprint = [{ col, row }];
      const pick = (list) => list[Math.floor(random() * list.length)];

      if (roll < 0.10) {
        props.push({ id, kind: 'asteroid', model: pick(ASTEROID_MODELS), footprint, rotation });
      } else if (roll < 0.14) {
        // Crystal ore: mine it for cargo. Each node holds a few units.
        const amount = 6 + Math.floor(random() * 5);
        props.push({ id, kind: 'ore', model: pick(ORE_MODELS), footprint, rotation, amount });
      } else if (roll < 0.20) {
        props.push({ id, kind: 'decor', model: pick(DECOR_MODELS), footprint, rotation });
      }
    }
  }

  const blocked = new Set();
  for (const prop of props) {
    if (prop.kind === 'decor') continue;
    for (const { col, row } of prop.footprint) blocked.add(key(col, row));
  }

  return {
    width: WORLD_SIZE,
    height: WORLD_SIZE,
    start: { ...START_TILE },
    props,
    blocked,
  };
}
