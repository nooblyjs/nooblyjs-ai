import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  loadLevel, LevelError, TILE_NAMES, LEVEL_COUNT, levelUrl, WALL_EDGE, BACK_CORNER,
} from '../public/levels.js';
import { createState, step, status } from '../public/game.js';
import { LAYER } from '../public/render.js';
import { STARTER_TILES, SOURCE_DIR } from '../scripts/copy-assets.js';

const PUBLIC = new URL('../public/', import.meta.url);
const readLevel = async (id) => JSON.parse(await readFile(new URL(levelUrl(id), PUBLIC), 'utf8'));
const levelIds = Array.from({ length: LEVEL_COUNT }, (_, index) => index + 1);
const MOVES = [0, 2, 4, 6].map((direction) => ({ type: 'move', direction }));

/** A small valid level file; tests change one thing to break it. */
function tinyLevel(changes = {}) {
  return {
    id: 9,
    name: 'Test Floor',
    par: 10,
    size: [4, 3],
    legend: { s: 'stone' },
    floor: ['ssss', 'ssss', 'ss..'],
    start: { col: 0, row: 2, facing: 0 },
    objects: [{ col: 2, row: 1, tile: 'barrel', facing: 'N' }],
    exit: { col: 3, row: 0, tile: 'stairs', facing: 'N' },
    ...changes,
  };
}

/** The problems loadLevel reports for some level data (fails the test if it loads). */
function problemsWith(data) {
  try {
    loadLevel(data);
  } catch (error) {
    assert.ok(error instanceof LevelError, error.message);
    return error.problems;
  }
  assert.fail('the level loaded, but it should not have');
}

/** The fewest turns that reach the exit, found by trying every move from every reachable state (breadth-first). */
function shortestWin(level) {
  const keyOf = ({ player }) => `${player.col},${player.row}`; // facing does not matter for moving
  let frontier = [createState(level)];
  const seen = new Set(frontier.map(keyOf));
  for (let turns = 1; frontier.length; turns++) {
    const next = [];
    for (const state of frontier) {
      for (const move of MOVES) {
        const after = step(state, move);
        if (status(after) === 'complete') return turns;
        if (after.event !== 'moved' || seen.has(keyOf(after))) continue;
        seen.add(keyOf(after));
        next.push(after);
      }
    }
    frontier = next;
  }
  return Infinity;
}

test('TILE_NAMES lists exactly the tile sprites in the pack', async () => {
  const files = await readdir(path.join(SOURCE_DIR, 'Isometric'));
  const names = new Set(files.filter((file) => file.endsWith('.png')).map((file) => file.replace(/_[NESW]\.png$/, '')));
  assert.deepEqual([...TILE_NAMES].sort(), [...names].sort());
});

test('there is a level file for every level, and nothing else in public/levels', async () => {
  const files = (await readdir(new URL('levels/', PUBLIC))).sort();
  assert.deepEqual(files, levelIds.map((id) => `${id}.json`).sort());
});

for (const id of levelIds) {
  test(`level ${id} loads, and its id matches its file name`, async () => {
    const level = loadLevel(await readLevel(id));
    assert.equal(level.id, id);
    assert.ok(level.name);
  });

  test(`every sprite in level ${id} exists in the pack and is copied by the asset script`, async () => {
    const files = new Set(await readdir(path.join(SOURCE_DIR, 'Isometric')));
    for (const { tile, facing } of loadLevel(await readLevel(id)).items) {
      assert.ok(files.has(`${tile}_${facing}.png`), `${tile}_${facing}.png`);
      assert.ok(STARTER_TILES.includes(tile), `${tile} is not in STARTER_TILES`);
    }
  });

  test(`level ${id} can be finished within its par`, async () => {
    const level = loadLevel(await readLevel(id));
    const turns = shortestWin(level);
    assert.ok(turns <= level.par, `the shortest route takes ${turns} turns, but par is ${level.par}`);
  });
}

test('Level 1 is The Cellar, and walking its shortest route ends the floor', async () => {
  const level = loadLevel(await readLevel(1));
  assert.equal(level.name, 'The Cellar');
  assert.ok(Number.isFinite(shortestWin(level)));
});

test('a tiny level loads into floor tiles, automatic back walls, its props and the stairs', () => {
  const level = loadLevel(tinyLevel());
  assert.equal(level.width, 4);
  assert.equal(level.height, 3);
  assert.deepEqual(level.start, { col: 0, row: 2, facing: 0 });
  assert.deepEqual(level.exit, { col: 3, row: 0, requires: [] });
  const floor = level.items.filter((item) => item.layer === LAYER.floor);
  assert.equal(floor.length, 10); // 12 squares, 2 of them "."
  const at = (col, row) => level.items.filter((item) => item.layer === LAYER.object && item.col === col && item.row === row);
  // The top tile gets a corner; the rest of the back edges get straight walls; the front stays open.
  assert.deepEqual(at(0, 0).map(({ tile, facing }) => [tile, facing]), [['stoneWallCorner', BACK_CORNER]]);
  assert.deepEqual(at(2, 0).map(({ tile, facing }) => [tile, facing]), [['stoneWall', WALL_EDGE.backRow]]);
  assert.deepEqual(at(0, 1).map(({ tile, facing }) => [tile, facing]), [['stoneWall', WALL_EDGE.backCol]]);
  assert.deepEqual(at(1, 1), []);
  assert.deepEqual(at(2, 1).map(({ tile }) => tile), ['barrel']);
  assert.deepEqual(at(3, 0).map(({ tile }) => tile), ['stoneWall', 'stairs']); // the wall first, so the stairs cover it
});

test('a tile with its own wall pieces gets no automatic wall, and walls are drawn before props', () => {
  const level = loadLevel(tinyLevel({
    objects: [
      { col: 1, row: 0, tile: 'barrel', facing: 'N' },
      { col: 1, row: 0, tile: 'stoneWallWindow', facing: 'S' },
    ],
  }));
  const at10 = level.items.filter((item) => item.layer === LAYER.object && item.col === 1 && item.row === 0);
  assert.deepEqual(at10.map(({ tile }) => tile), ['stoneWallWindow', 'barrel']);
});

test('a legend entry can fix the facing of its floor tile', () => {
  const level = loadLevel(tinyLevel({ legend: { s: { tile: 'dirt', facing: 'W' } } }));
  const floor = level.items.filter((item) => item.layer === LAYER.floor);
  assert.ok(floor.every(({ tile, facing }) => tile === 'dirt' && facing === 'W'));
});

test('the exit condition lists keys', () => {
  const level = loadLevel(tinyLevel({ exit: { col: 3, row: 0, tile: 'stairs', facing: 'N', requires: ['key:brass'] } }));
  assert.deepEqual(level.exit.requires, ['key:brass']);
  assert.match(problemsWith(tinyLevel({ exit: { col: 3, row: 0, tile: 'stairs', facing: 'N', requires: ['gold:5'] } }))[0], /only keys/);
});

test('loadLevel explains unknown tiles', () => {
  assert.match(problemsWith(tinyLevel({ legend: { s: 'lava' } }))[0], /legend code "s" uses an unknown tile: "lava"/);
  assert.match(problemsWith(tinyLevel({ objects: [{ col: 1, row: 1, tile: 'dragon', facing: 'N' }] }))[0], /object 1 at 1, 1 uses an unknown tile: "dragon"/);
  assert.match(problemsWith(tinyLevel({ floor: ['ssss', 'sxss', 'ss..'] }))[0], /floor tile 1, 1 uses "x", which is not in the legend/);
});

test('loadLevel refuses a start that is not walkable', () => {
  assert.match(problemsWith(tinyLevel({ start: { col: 2, row: 1, facing: 0 } }))[0], /start 2, 1 is not walkable/); // the barrel
  assert.match(problemsWith(tinyLevel({ start: { col: 3, row: 2, facing: 0 } }))[0], /start 3, 2 is not walkable/); // no floor
  assert.match(problemsWith(tinyLevel({ start: { col: 9, row: 0, facing: 0 } }))[0], /outside the map/);
  assert.match(problemsWith(tinyLevel({ start: undefined }))[0], /no start/);
});

test('loadLevel needs an exit made of stairs, on a free floor tile', () => {
  assert.match(problemsWith(tinyLevel({ exit: undefined }))[0], /the level has no exit/);
  assert.match(problemsWith(tinyLevel({ exit: { col: 3, row: 0, tile: 'barrel', facing: 'N' } }))[0], /not stairs/);
  assert.match(problemsWith(tinyLevel({ exit: { col: 3, row: 2, tile: 'stairs', facing: 'N' } }))[0], /not on a floor tile/);
  assert.match(problemsWith(tinyLevel({ exit: { col: 0, row: 2, tile: 'stairs', facing: 'N' } }))[0], /start is on the exit/);
  const blocked = tinyLevel({ objects: [{ col: 3, row: 0, tile: 'barrel', facing: 'N' }] });
  assert.match(problemsWith(blocked)[0], /exit at 3, 0 is blocked/);
});

test('loadLevel checks the size and shape of the floor map', () => {
  assert.match(problemsWith(tinyLevel({ size: [4] }))[0], /"size" should be/);
  assert.match(problemsWith(tinyLevel({ floor: ['ssss', 'ssss'] }))[0], /list of 3 lines/);
  assert.match(problemsWith(tinyLevel({ floor: ['ssss', 'sss', 'ss..'] }))[0], /line 1 is 3 characters long/);
});

test('loadLevel lists every problem at once, including typos and features from later phases', () => {
  const problems = problemsWith(tinyLevel({
    name: '', par: 0, exits: [], doors: [{ col: 1, row: 1 }], guards: [{ patrol: [] }],
  }));
  assert.ok(problems.some((p) => /unknown field "exits"/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /"name" is missing/.test(p)));
  assert.ok(problems.some((p) => /"par"/.test(p)));
  assert.ok(problems.some((p) => /doors are not supported yet/.test(p)));
  assert.ok(problems.some((p) => /guards are not supported yet/.test(p)));
  assert.throws(() => loadLevel(null), /should be a JSON object/);
  assert.throws(() => loadLevel(tinyLevel({ legend: { s: 'lava' } })), /Level 9 \("Test Floor"\) has a problem:\n- legend/);
});
