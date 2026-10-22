import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, step, buildMap, wallBetween, isWalkable, DIRECTIONS, WALL_SIDE, FLOOR_LAYER,
  status, missingForExit, onExit,
} from '../public/game.js';
import { LAYER, gridToScreen } from '../public/render.js';
import { testLevel } from '../public/room.js';

const UP = { type: 'move', direction: 0 }; // up-right on screen, row − 1
const RIGHT = { type: 'move', direction: 2 }; // down-right, col + 1
const DOWN = { type: 'move', direction: 4 }; // down-left, row + 1
const LEFT = { type: 'move', direction: 6 }; // up-left, col − 1
const WAIT = { type: 'wait' };

/** A small open level: a floor of `width` × `height`, plus any extra drawables. */
function openLevel({ width = 4, height = 4, start = { col: 1, row: 1, facing: 0 }, items = [], exit } = {}) {
  const floor = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) floor.push({ tile: 'stone', facing: 'N', col, row, layer: FLOOR_LAYER });
  }
  return { width, height, start, items: [...floor, ...items], exit };
}

const object = (tile, facing, col, row) => ({ tile, facing, col, row, layer: LAYER.object });
const play = (state, actions) => actions.reduce(step, state);

test('the rules and the renderer agree on which layer is the floor', () => {
  assert.equal(FLOOR_LAYER, LAYER.floor);
});

test('each direction moves the way its sprite faces on screen', () => {
  // Direction 0 faces up-right, 2 down-right, 4 down-left, 6 up-left (see .noobly/ui/Information.png).
  const screen = (direction) => gridToScreen(DIRECTIONS[direction].dc, DIRECTIONS[direction].dr);
  assert.ok(screen(0).x > 0 && screen(0).y < 0, 'up-right');
  assert.ok(screen(2).x > 0 && screen(2).y > 0, 'down-right');
  assert.ok(screen(4).x < 0 && screen(4).y > 0, 'down-left');
  assert.ok(screen(6).x < 0 && screen(6).y < 0, 'up-left');
});

test('a new game puts the player on the start tile on turn 0', () => {
  const state = createState(openLevel({ start: { col: 2, row: 3, facing: 4 } }));
  assert.deepEqual(state.player, { col: 2, row: 3, facing: 4 });
  assert.equal(state.turn, 0);
});

test('a start tile that cannot be stood on is an error', () => {
  assert.throws(() => createState(openLevel({ start: { col: 9, row: 9 } })), /start tile 9, 9 is not walkable/);
  assert.throws(() => createState(openLevel({ items: [object('barrel', 'N', 1, 1)] })), /not walkable/);
});

test('moving changes the tile and facing, and takes a turn', () => {
  const start = createState(openLevel());
  const moved = step(start, RIGHT);
  assert.deepEqual(moved.player, { col: 2, row: 1, facing: 2 });
  assert.equal(moved.turn, 1);
  assert.equal(moved.event, 'moved');
  assert.deepEqual(play(start, [DOWN, DOWN, LEFT, UP]).player, { col: 0, row: 2, facing: 0 });
});

test('step never changes the state it was given', () => {
  const start = createState(openLevel());
  const before = structuredClone({ player: start.player, turn: start.turn });
  step(start, RIGHT);
  step(start, WAIT);
  assert.deepEqual({ player: start.player, turn: start.turn }, before);
  assert.ok(Object.isFrozen(start) && Object.isFrozen(start.player));
});

test('the map edge blocks a move, turns the player, and costs no turn', () => {
  const state = createState(openLevel({ start: { col: 0, row: 0, facing: 2 } }));
  const blocked = step(state, UP);
  assert.deepEqual(blocked.player, { col: 0, row: 0, facing: 0 });
  assert.equal(blocked.turn, 0);
  assert.equal(blocked.event, 'blocked');
  assert.equal(step(state, LEFT).event, 'blocked');
});

test('a missing floor tile blocks a move', () => {
  const level = openLevel();
  level.items = level.items.filter((item) => !(item.col === 2 && item.row === 1));
  assert.equal(step(createState(level), RIGHT).event, 'blocked');
});

test('props fill their tile, and you can walk round them', () => {
  const state = createState(openLevel({ items: [object('barrel', 'N', 2, 1), object('chestClosed', 'S', 1, 2)] }));
  assert.equal(step(state, RIGHT).event, 'blocked');
  assert.equal(step(state, DOWN).event, 'blocked');
  assert.deepEqual(play(state, [UP, RIGHT, RIGHT, DOWN]).player, { col: 3, row: 1, facing: 4 });
});

test('a wall blocks the edge it stands on, from both sides', () => {
  // stoneWall_W stands on the lower-right edge of tile 1, 1: between it and tile 2, 1.
  const state = createState(openLevel({ items: [object('stoneWall', 'W', 1, 1)] }));
  assert.equal(step(state, RIGHT).event, 'blocked');
  const otherSide = play(state, [UP, RIGHT, DOWN]); // round the end of the wall to 2, 1
  assert.deepEqual(otherSide.player, { col: 2, row: 1, facing: 4 });
  assert.equal(step(otherSide, LEFT).event, 'blocked');
  // Moving along the wall is fine.
  assert.equal(step(state, DOWN).event, 'moved');
  assert.equal(step(state, UP).event, 'moved');
});

test('every wall facing blocks the right edge', () => {
  for (const [facing, side] of Object.entries(WALL_SIDE)) {
    const map = buildMap(openLevel({ items: [object('stoneWall', facing, 1, 1)] }));
    for (const direction of Object.values(DIRECTIONS)) {
      const expected = direction.dc === side.dc && direction.dr === side.dr;
      assert.equal(wallBetween(map, 1, 1, direction), expected, `wall ${facing}, step ${direction.dc},${direction.dr}`);
    }
  }
});

test('a corner blocks the two edges meeting at its point', () => {
  // stoneWallCorner_S is at the top point of the tile: the row − 1 and col − 1 edges.
  const map = buildMap(openLevel({ items: [object('stoneWallCorner', 'S', 1, 1)] }));
  assert.equal(wallBetween(map, 1, 1, DIRECTIONS[0]), true);
  assert.equal(wallBetween(map, 1, 1, DIRECTIONS[6]), true);
  assert.equal(wallBetween(map, 1, 1, DIRECTIONS[2]), false);
  assert.equal(wallBetween(map, 1, 1, DIRECTIONS[4]), false);
});

test('an open doorway does not block', () => {
  const state = createState(openLevel({ items: [object('stoneWallDoorOpen', 'W', 1, 1)] }));
  assert.equal(step(state, RIGHT).event, 'moved');
});

test('waiting takes a turn without moving', () => {
  const state = step(createState(openLevel()), WAIT);
  assert.deepEqual(state.player, { col: 1, row: 1, facing: 0 });
  assert.equal(state.turn, 1);
  assert.equal(state.event, 'waited');
});

test('unknown actions and directions are errors', () => {
  const state = createState(openLevel());
  assert.throws(() => step(state, { type: 'fly' }), /Unknown action/);
  assert.throws(() => step(state, { type: 'move', direction: 1 }), /Unknown direction/);
});

test('in the test room the player starts on the floor and the walls and props block', () => {
  const state = createState(testLevel());
  const { map } = state;
  assert.ok(isWalkable(map, 3, 6));
  for (const [col, row] of [[1, 1], [2, 1], [1, 4], [4, 3], [5, 5]]) assert.equal(isWalkable(map, col, row), false, `${col}, ${row}`);
  // Walk to the back wall (row 0) and try to go through it.
  const atWall = play(state, [UP, UP, UP, UP, UP, UP]);
  assert.deepEqual(atWall.player, { col: 3, row: 0, facing: 0 });
  assert.equal(atWall.turn, 6);
  assert.equal(step(atWall, UP).event, 'blocked');
});

// Phase 3: the exit.

test('a new game is playing, with empty pockets, and a level without an exit never ends', () => {
  const state = createState(openLevel());
  assert.equal(status(state), 'playing');
  assert.deepEqual(state.inventory, []);
  assert.equal(state.exit, null);
  assert.equal(onExit(state), false);
  assert.deepEqual(missingForExit(state), []);
});

test('stepping onto the exit completes the floor, and the step still counts', () => {
  const state = play(createState(openLevel({ exit: { col: 3, row: 1 } })), [RIGHT, RIGHT]);
  assert.equal(status(state), 'complete');
  assert.equal(state.event, 'moved');
  assert.equal(state.turn, 2);
  assert.ok(onExit(state));
});

test('once the floor is complete, actions are ignored', () => {
  const done = play(createState(openLevel({ exit: { col: 2, row: 1 } })), [RIGHT]);
  assert.equal(status(done), 'complete');
  assert.equal(step(done, LEFT), done);
  assert.equal(step(done, WAIT), done);
});

test('an exit that needs a key lets you stand on it but does not end the floor', () => {
  const state = play(createState(openLevel({ exit: { col: 2, row: 1, requires: ['key:brass'] } })), [RIGHT]);
  assert.ok(onExit(state));
  assert.equal(status(state), 'playing');
  assert.deepEqual(missingForExit(state), ['key:brass']);
  // With the key in the inventory (Phase 4 adds a way to get it), stepping back on finishes.
  const withKey = Object.freeze({ ...play(state, [LEFT]), inventory: Object.freeze(['key:brass']) });
  assert.equal(status(step(withKey, RIGHT)), 'complete');
});
