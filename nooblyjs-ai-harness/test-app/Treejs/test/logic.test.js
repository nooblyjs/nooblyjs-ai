// Tests for the pure game logic: pathfinding, world layout and mining rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid, findPath, findPathToTarget, approachTiles, key } from '../js/grid.js';
import { existsSync } from 'node:fs';
import {
  generateWorld, shipFootprint, depotFootprint, START_TILE, WORLD_SIZE, createRandom,
  PROP_MODELS,
} from '../js/world.js';
import {
  createPlayer, createShip, stepMining, loadShip, shipFull, offload, quotaMet,
  CARGO_CAPACITY, SHIP_CAPACITY, MINE_SECONDS, QUOTA,
} from '../js/mining.js';

test('a straight walk along an open grid takes the direct tiles', () => {
  const grid = createGrid(5, 5);
  const path = findPath(grid, { col: 0, row: 0 }, { col: 3, row: 0 });
  assert.deepEqual(path, [{ col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }]);
});

test('the path goes around a wall instead of through it', () => {
  const blocked = new Set([key(2, 0), key(2, 1), key(2, 2)]);
  const grid = createGrid(5, 5, blocked);
  const path = findPath(grid, { col: 0, row: 1 }, { col: 4, row: 1 });
  assert.ok(path, 'a path should exist');
  assert.ok(path.every((t) => !blocked.has(key(t.col, t.row))), 'no step lands on a wall');
  assert.deepEqual(path.at(-1), { col: 4, row: 1 });
});

test('no path is returned when the goal is walled off', () => {
  const blocked = new Set([key(1, 0), key(0, 1), key(1, 1)]);
  const grid = createGrid(3, 3, blocked);
  assert.equal(findPath(grid, { col: 2, row: 2 }, { col: 0, row: 0 }), null);
});

test('a walker never squeezes diagonally between two blocked tiles', () => {
  // Walls at (1,0) and (0,1): the diagonal step from (0,0) to (1,1) would cut the corner.
  const grid = createGrid(2, 2, new Set([key(1, 0), key(0, 1)]));
  assert.equal(findPath(grid, { col: 0, row: 0 }, { col: 1, row: 1 }), null);
});

test('standing on the goal gives an empty path', () => {
  const grid = createGrid(3, 3);
  assert.deepEqual(findPath(grid, { col: 1, row: 1 }, { col: 1, row: 1 }), []);
});

test('clicking a blocked tile has no path', () => {
  const grid = createGrid(3, 3, new Set([key(2, 2)]));
  assert.equal(findPath(grid, { col: 0, row: 0 }, { col: 2, row: 2 }), null);
});

test('approach tiles surround a footprint and skip blocked ones', () => {
  const grid = createGrid(5, 5, new Set([key(0, 1)]));
  const tiles = approachTiles(grid, [{ col: 1, row: 1 }]);
  const keys = tiles.map((t) => key(t.col, t.row)).sort();
  assert.deepEqual(keys, ['1,0', '1,2', '2,1'].sort());
});

test('a footprint target is reached from its nearest side', () => {
  const grid = createGrid(10, 10, new Set([key(5, 5)]));
  const found = findPathToTarget(grid, { col: 0, row: 5 }, [{ col: 5, row: 5 }]);
  assert.deepEqual(found.goal, { col: 4, row: 5 });
  assert.equal(found.path.length, 4);
});

test('the generated world is the same for the same seed', () => {
  const a = generateWorld(42);
  const b = generateWorld(42);
  assert.deepEqual(a.props, b.props);
});

test('different seeds give different worlds', () => {
  assert.notDeepEqual(generateWorld(1).props, generateWorld(2).props);
});

test('the start tile and the ship footprint are always clear of rock', () => {
  for (const seed of [1, 7, 99, 2026]) {
    const world = generateWorld(seed);
    assert.ok(!world.blocked.has(key(START_TILE.col, START_TILE.row)));
    for (const t of shipFootprint()) {
      assert.ok(world.blocked.has(key(t.col, t.row)), 'the ship blocks its own tiles');
    }
    for (const prop of world.props) {
      if (prop.kind === 'ship') continue;
      for (const t of prop.footprint) {
        const nearShip = shipFootprint().some((s) =>
          Math.max(Math.abs(s.col - t.col), Math.abs(s.row - t.row)) <= 1);
        assert.ok(!nearShip, `${prop.id} must not sit next to the ship`);
      }
    }
  }
});

test('every prop sits inside the world and every ore node has ore in it', () => {
  const world = generateWorld(5);
  for (const prop of world.props) {
    for (const t of prop.footprint) {
      assert.ok(t.col >= 0 && t.col < WORLD_SIZE && t.row >= 0 && t.row < WORLD_SIZE);
    }
    if (prop.kind === 'ore') assert.ok(prop.amount >= 6);
  }
  assert.ok(world.props.some((p) => p.kind === 'ore'), 'the field has some ore');
});

test('the seeded random generator stays between 0 and 1', () => {
  const random = createRandom(123);
  for (let i = 0; i < 1000; i++) {
    const n = random();
    assert.ok(n >= 0 && n < 1);
  }
});

test('mining fills the hold one unit per interval', () => {
  const player = createPlayer();
  const node = { amount: 5 };
  const result = stepMining(player, node, MINE_SECONDS * 2 + 0.01);
  assert.equal(result.status, 'mining');
  assert.equal(result.mined, 2);
  assert.equal(player.cargo, 2);
  assert.equal(node.amount, 3);
});

test('mining stops when the hold is full', () => {
  const player = createPlayer();
  const node = { amount: 100 };
  const result = stepMining(player, node, 1000);
  assert.equal(result.status, 'full');
  assert.equal(player.cargo, CARGO_CAPACITY);
});

test('mining reports a depleted node', () => {
  const player = createPlayer();
  const node = { amount: 1 };
  const result = stepMining(player, node, MINE_SECONDS);
  assert.equal(result.status, 'depleted');
  assert.equal(node.amount, 0);
  assert.equal(player.cargo, 1);
});

test('loading moves the astronaut\'s cargo into the ship and reports how much', () => {
  const player = createPlayer();
  const ship = createShip();
  player.cargo = 7;
  assert.equal(loadShip(player, ship), 7);
  assert.equal(player.cargo, 0);
  assert.equal(ship.hold, 7);
});

test('loading stops when the ship\'s hold runs out of room', () => {
  const player = createPlayer();
  const ship = createShip();
  player.cargo = CARGO_CAPACITY;
  ship.hold = SHIP_CAPACITY - 4;
  assert.equal(loadShip(player, ship), 4, 'only the 4 units that fit are moved');
  assert.equal(player.cargo, CARGO_CAPACITY - 4, 'the rest stays with the astronaut');
  assert.equal(shipFull(ship), true);
});

test('a ship is full only once its hold reaches capacity', () => {
  const ship = createShip();
  ship.hold = SHIP_CAPACITY - 1;
  assert.equal(shipFull(ship), false);
  ship.hold = SHIP_CAPACITY;
  assert.equal(shipFull(ship), true);
});

test('offloading at the depot sells the whole hold and counts toward the quota', () => {
  const player = createPlayer();
  const ship = createShip();
  ship.hold = 4;
  const sold = offload(player, ship);
  assert.equal(sold.ore, 4);
  assert.equal(ship.hold, 0);
  assert.equal(player.delivered, 4);
  assert.equal(player.credits, sold.credits);
  assert.equal(quotaMet(player), false);
  player.delivered = QUOTA;
  assert.equal(quotaMet(player), true);
});

test('every model a prop uses is on the load list and exists on disk', () => {
  const modelDir = new URL('../ui/Models/GLTF format/', import.meta.url);
  for (const seed of [1, 7]) {
    for (const prop of generateWorld(seed).props) {
      assert.ok(PROP_MODELS.includes(prop.model), `${prop.model} is not in PROP_MODELS`);
    }
  }
  for (const name of PROP_MODELS) {
    assert.ok(existsSync(new URL(`${name}.glb`, modelDir)), `${name}.glb is missing`);
  }
});

test('the ship, depot and start fit on the map and the depot is far from the ship', () => {
  const world = generateWorld(42);
  for (const t of [...shipFootprint(), ...depotFootprint(), START_TILE]) {
    assert.ok(t.col >= 0 && t.col < WORLD_SIZE && t.row >= 0 && t.row < WORLD_SIZE, `tile ${t.col},${t.row} is off the map`);
  }
  const [ship] = shipFootprint();
  const [depot] = depotFootprint();
  const far = Math.hypot(ship.col - depot.col, ship.row - depot.row);
  assert.ok(far >= 35, `the depot should be a long trip away, got ${far.toFixed(1)} tiles`);
});

test('the depot is clear of rock and inside the world', () => {
  for (const seed of [1, 7, 99, 2026]) {
    const world = generateWorld(seed);
    for (const t of depotFootprint()) {
      assert.ok(t.col >= 0 && t.col < WORLD_SIZE && t.row >= 0 && t.row < WORLD_SIZE);
      assert.ok(world.blocked.has(key(t.col, t.row)), 'the depot itself blocks walking');
    }
    const depot = world.props.find((p) => p.kind === 'depot');
    assert.ok(depot, 'the world has a depot');
    const clearAround = world.props.filter((p) =>
      p.kind !== 'depot' && p.footprint.some((t) =>
        Math.max(Math.abs(t.col - depot.footprint[0].col), Math.abs(t.row - depot.footprint[0].row)) <= 1));
    assert.equal(clearAround.length, 0, 'nothing sits right next to the depot');
  }
});
