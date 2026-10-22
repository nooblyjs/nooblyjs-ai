import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gridToScreen, screenToGrid, spriteOrigin, drawOrder, fitView, sceneBounds, drawScene,
  walkingDrawable, viewScale, cameraFocus, viewAt, ease,
  LAYER, SPRITE_ANCHOR, TILE_WIDTH, TILE_HEIGHT,
} from '../public/render.js';

test('tile 0, 0 is at the screen origin', () => {
  assert.deepEqual(gridToScreen(0, 0), { x: 0, y: 0 });
});

test('one column goes right and down, one row goes left and down', () => {
  assert.deepEqual(gridToScreen(1, 0), { x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
  assert.deepEqual(gridToScreen(0, 1), { x: -TILE_WIDTH / 2, y: TILE_HEIGHT / 2 });
  assert.deepEqual(gridToScreen(3, 2), { x: 128, y: 320 });
});

test('screenToGrid finds the tile under the centre of every tile', () => {
  for (let col = -3; col < 10; col++) {
    for (let row = -3; row < 10; row++) {
      const { x, y } = gridToScreen(col, row);
      assert.deepEqual(screenToGrid(x, y), { col, row }, `tile ${col}, ${row}`);
    }
  }
});

test('screenToGrid uses the diamond shape, not a square box', () => {
  const centre = gridToScreen(2, 2);
  // Just inside each corner of the diamond still belongs to the tile.
  assert.deepEqual(screenToGrid(centre.x + 120, centre.y), { col: 2, row: 2 });
  assert.deepEqual(screenToGrid(centre.x, centre.y - 60), { col: 2, row: 2 });
  // The corner of the bounding box is outside the diamond: it is the tile up and to the right.
  assert.deepEqual(screenToGrid(centre.x + 120, centre.y - 60), { col: 2, row: 1 });
  // Past the lower-left edge is the next row.
  assert.deepEqual(screenToGrid(centre.x - 70, centre.y + 40), { col: 2, row: 3 });
});

test('a sprite is placed so its anchor point lands on the tile centre', () => {
  const origin = spriteOrigin(3, 1);
  const centre = gridToScreen(3, 1);
  assert.equal(origin.x + SPRITE_ANCHOR.x, centre.x);
  assert.equal(origin.y + SPRITE_ANCHOR.y, centre.y);
});

test('the draw order puts all floor first, then farther things before nearer ones', () => {
  const nearWall = { tile: 'stoneWall', col: 3, row: 3, layer: LAYER.object };
  const farBarrel = { tile: 'barrel', col: 0, row: 1, layer: LAYER.object };
  const nearFloor = { tile: 'stone', col: 5, row: 5, layer: LAYER.floor };
  const farFloor = { tile: 'stone', col: 0, row: 0, layer: LAYER.floor };
  const hero = { tile: 'Male', col: 3, row: 3, layer: LAYER.character };
  const order = drawOrder([hero, nearWall, nearFloor, farBarrel, farFloor]);
  assert.deepEqual(order.map((item) => item.tile), ['stone', 'stone', 'barrel', 'stoneWall', 'Male']);
  assert.equal(order[0], farFloor);
});

test('things at the same depth and layer keep their list order', () => {
  const wall = { tile: 'stoneWall', col: 2, row: 0, layer: LAYER.object };
  const barrel = { tile: 'barrel', col: 2, row: 0, layer: LAYER.object };
  const sideways = { tile: 'chestClosed', col: 1, row: 1, layer: LAYER.object };
  assert.deepEqual(drawOrder([wall, barrel, sideways]), [wall, barrel, sideways]);
  assert.deepEqual(drawOrder([barrel, wall]), [barrel, wall]);
});

test('fitView centres the content and never scales above the maximum', () => {
  const bounds = { left: -100, top: -50, right: 100, bottom: 50 };
  const view = fitView(bounds, { width: 1000, height: 800 }, { padding: 0, maxScale: 0.5 });
  assert.equal(view.scale, 0.5);
  // The centre of the content (0, 0) lands on the centre of the viewport.
  assert.equal(view.offsetX, 500);
  assert.equal(view.offsetY, 400);
});

test('fitView shrinks content that is too big for the viewport', () => {
  const bounds = { left: 0, top: 0, right: 2000, bottom: 500 };
  const view = fitView(bounds, { width: 1040, height: 800 }, { padding: 20 });
  assert.equal(view.scale, 0.5);
  const small = fitView(bounds, { width: 540, height: 800 }, { padding: 20 });
  assert.equal(small.scale, 0.25);
  assert.equal(small.offsetX + 2000 * small.scale + small.offsetX, 540); // equal margins left and right
});

test('sceneBounds covers every sprite image', () => {
  const bounds = sceneBounds([{ col: 0, row: 0 }, { col: 1, row: 0 }]);
  assert.deepEqual(bounds, { left: -128, top: -428, right: 256, bottom: 148 });
});

test('drawScene draws each sprite in order, scaled and offset, and skips unknown ones', () => {
  const calls = [];
  const ctx = { drawImage: (...args) => calls.push(args) };
  const sprites = new Map([
    ['stone_N', { image: 'floor-image' }],
    ['barrel_E', { image: 'barrel-image' }],
  ]);
  const items = [
    { tile: 'barrel', facing: 'E', col: 0, row: 0, layer: LAYER.object },
    { tile: 'stone', facing: 'N', col: 0, row: 0, layer: LAYER.floor },
    { tile: 'missing', facing: 'S', col: 1, row: 1, layer: LAYER.object },
  ];
  drawScene(ctx, items, sprites, { scale: 0.5, offsetX: 10, offsetY: 20 });
  assert.deepEqual(calls, [
    ['floor-image', 10 - 64, 20 - 214, 128, 256],
    ['barrel-image', 10 - 64, 20 - 214, 128, 256],
  ]);
});

test('a walking character slides between tiles but is drawn at the nearer tile', () => {
  const towardsCamera = walkingDrawable({ from: { col: 2, row: 2 }, to: { col: 3, row: 2 }, progress: 0.25, key: 'Male_2_Run2' });
  assert.deepEqual(towardsCamera, { key: 'Male_2_Run2', col: 2.25, row: 2, depth: 5, layer: LAYER.character });
  const awayFromCamera = walkingDrawable({ from: { col: 3, row: 2 }, to: { col: 3, row: 1 }, progress: 0.5, key: 'k' });
  assert.equal(awayFromCamera.depth, 5);
  assert.equal(awayFromCamera.row, 1.5);
  // Progress is kept between 0 and 1.
  assert.equal(walkingDrawable({ from: { col: 0, row: 0 }, to: { col: 1, row: 0 }, progress: 3, key: 'k' }).col, 1);
});

test('a walking character is drawn over a prop beside the tile it is stepping onto', () => {
  // Walking from 2, 2 to 2, 3 (towards the camera); a barrel stands at 1, 4 — depth 5, the same as 2, 3.
  const barrel = { tile: 'barrel', facing: 'N', col: 1, row: 4, layer: LAYER.object };
  const hero = walkingDrawable({ from: { col: 2, row: 2 }, to: { col: 2, row: 3 }, progress: 0.1, key: 'hero' });
  assert.deepEqual(drawOrder([hero, barrel]), [barrel, hero]);
  // But a prop nearer the camera than both tiles still covers the character.
  const nearBarrel = { tile: 'barrel', facing: 'N', col: 3, row: 3, layer: LAYER.object };
  assert.deepEqual(drawOrder([nearBarrel, hero]), [hero, nearBarrel]);
});

test('drawScene uses a drawable\'s own sprite key when it has one', () => {
  const calls = [];
  const ctx = { drawImage: (image) => calls.push(image) };
  const sprites = new Map([['Male_4_Idle0', { image: 'hero-image' }]]);
  drawScene(ctx, [{ key: 'Male_4_Idle0', col: 0, row: 0, layer: LAYER.character }], sprites, { scale: 1, offsetX: 0, offsetY: 0 });
  assert.deepEqual(calls, ['hero-image']);
});

test('the zoom is at most the maximum, fits the level if it can, and has a lower limit', () => {
  const room = { left: 0, top: 0, right: 2000, bottom: 1000 };
  assert.equal(viewScale(room, { width: 1600, height: 900 }, { padding: 0 }), 0.5);
  assert.equal(viewScale(room, { width: 800, height: 900 }, { padding: 0 }), 0.4);
  assert.equal(viewScale(room, { width: 300, height: 600 }, { padding: 0 }), 0.3);
});

test('the camera stays still and centred when the whole level fits', () => {
  const room = { left: -500, top: -100, right: 500, bottom: 400 };
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(cameraFocus({ x: -400, y: 300 }, room, viewport, 0.5), { x: 0, y: 150 });
  assert.deepEqual(cameraFocus({ x: 400, y: -50 }, room, viewport, 0.5), { x: 0, y: 150 });
});

test('the camera follows the player in a big level but stops at its edges', () => {
  const level = { left: 0, top: 0, right: 4000, bottom: 4000 };
  const viewport = { width: 400, height: 400 }; // 800 scene pixels across at scale 0.5
  const options = { padding: 0 };
  assert.deepEqual(cameraFocus({ x: 2000, y: 1500 }, level, viewport, 0.5, options), { x: 2000, y: 1500 });
  assert.deepEqual(cameraFocus({ x: 100, y: 3990 }, level, viewport, 0.5, options), { x: 400, y: 3600 });
});

test('viewAt puts the focus point in the middle of the window', () => {
  const view = viewAt({ x: 100, y: 50 }, { width: 800, height: 600 }, 0.5);
  assert.deepEqual(view, { scale: 0.5, offsetX: 350, offsetY: 275 });
});

test('easing covers half the distance per half-life, whatever the frame rate', () => {
  const from = { x: 0, y: 100 };
  const to = { x: 100, y: 0 };
  assert.deepEqual(ease(from, to, 0), from);
  assert.deepEqual(ease(from, to, 120, 120), { x: 50, y: 50 });
  // Two 60 ms frames end up in the same place as one 120 ms frame.
  const twoFrames = ease(ease(from, to, 60, 120), to, 60, 120);
  assert.ok(Math.abs(twoFrames.x - 50) < 1e-9 && Math.abs(twoFrames.y - 50) < 1e-9);
});
