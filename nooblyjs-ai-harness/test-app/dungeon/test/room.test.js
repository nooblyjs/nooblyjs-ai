import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { testRoom, ROOM_SIZE } from '../public/room.js';
import { spritesFor, tileUrl } from '../public/sprites.js';
import { LAYER } from '../public/render.js';
import { STARTER_TILES, SOURCE_DIR } from '../scripts/copy-assets.js';

test('the test room has exactly one floor tile on every square', () => {
  const floor = testRoom().filter((item) => item.layer === LAYER.floor);
  assert.equal(floor.length, ROOM_SIZE * ROOM_SIZE);
  assert.equal(new Set(floor.map(({ col, row }) => `${col},${row}`)).size, ROOM_SIZE * ROOM_SIZE);
});

test('everything in the test room is inside the room', () => {
  for (const { col, row } of testRoom()) {
    assert.ok(col >= 0 && col < ROOM_SIZE && row >= 0 && row < ROOM_SIZE, `${col}, ${row}`);
  }
});

test('every sprite the room uses is copied by the asset script and exists in the pack', async () => {
  for (const { tile, facing } of testRoom()) {
    assert.ok(STARTER_TILES.includes(tile), `${tile} is not in STARTER_TILES`);
    await stat(path.join(SOURCE_DIR, 'Isometric', `${tile}_${facing}.png`));
  }
});

test('spritesFor lists each sprite once, with its asset URL', () => {
  const list = spritesFor(testRoom());
  assert.equal(new Set(list.map(({ key }) => key)).size, list.length);
  assert.ok(list.some(({ key, url }) => key === 'stoneWall_S' && url === tileUrl('stoneWall', 'S')));
  assert.equal(tileUrl('barrel', 'N'), 'assets/tiles/barrel_N.png');
});

test('the character frames the game loads are the ones the asset script copies', async () => {
  const { characterSprites, CHARACTER_FRAMES, characterKey, animationFrame } = await import('../public/sprites.js');
  const { assetList, CHARACTER_ANIMATIONS: COPIED } = await import('../scripts/copy-assets.js');
  assert.deepEqual(CHARACTER_FRAMES, COPIED);
  const copied = new Set(assetList().map(({ to }) => to.split(path.sep).join('/')));
  for (const { url } of characterSprites()) assert.ok(copied.has(url.replace('assets/', '')), url);
  assert.equal(characterSprites().length, 8 * (1 + 10));
  assert.equal(characterKey(6, 'Run', 9), 'Male_6_Run9');
  assert.equal(animationFrame('Run', 0), 0);
  assert.equal(animationFrame('Run', 0.55), 5);
  assert.equal(animationFrame('Run', 1), 9);
  assert.equal(animationFrame('Idle', 0.7), 0);
});
