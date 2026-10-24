import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampFocus, panFocus, edgePan, minimapToWorld, worldToMinimap, flightSeconds,
} from '../js/view.js';

const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} vs ${b}`);

test('the camera focus cannot leave the map', () => {
  assert.deepEqual(clampFocus({ x: -5, z: 60 }, 48), { x: 0, z: 47 });
  assert.deepEqual(clampFocus({ x: 20, z: 10 }, 48), { x: 20, z: 10 });
});

test('pressing right moves the view along the screen-right direction of the ground', () => {
  const next = panFocus({ x: 20, z: 20 }, { right: 1 }, 10, 1, 48);
  close(next.x - 20, 10 * Math.SQRT1_2, 'x moves with the diagonal');
  close(next.z - 20, -10 * Math.SQRT1_2, 'z moves against the diagonal');
});

test('pressing up moves the view towards the far side of the map', () => {
  const next = panFocus({ x: 20, z: 20 }, { up: 1 }, 10, 1, 48);
  assert.ok(next.x < 20 && next.z < 20, 'both x and z go down');
});

test('a diagonal pan moves the view no faster than a straight one', () => {
  const start = { x: 24, z: 24 };
  const dist = (p) => Math.hypot(p.x - start.x, p.z - start.z);
  const straight = panFocus(start, { right: 1 }, 10, 0.1, 48);
  const diagonal = panFocus(start, { right: 1, up: 1 }, 10, 0.1, 48);
  close(dist(diagonal), dist(straight), 'same distance per tick');
});

test('panning stops at the map edge', () => {
  const next = panFocus({ x: 0, z: 0 }, { right: -1, up: 1 }, 10, 5, 48);
  assert.deepEqual(clampFocus(next, 48), next);
  assert.ok(next.x >= 0 && next.z >= 0);
});

test('the mouse near an edge pans that way, the middle does not', () => {
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  assert.deepEqual(edgePan(5, 300, rect), { right: -1, up: 0 });
  assert.deepEqual(edgePan(795, 300, rect), { right: 1, up: 0 });
  assert.deepEqual(edgePan(400, 5, rect), { right: 0, up: 1 });
  assert.deepEqual(edgePan(400, 595, rect), { right: 0, up: -1 });
  assert.deepEqual(edgePan(400, 300, rect), { right: 0, up: 0 });
});

test('minimap pixels and map tiles convert both ways', () => {
  // Pixel 96 is the left edge of tile 24, whose centre is world x 24.
  const world = minimapToWorld(96, 48, 4);
  assert.deepEqual(world, { x: 23.5, z: 11.5 });
  assert.deepEqual(worldToMinimap(24, 12, 4), { px: 98, py: 50 }, 'a tile centre lands mid-tile');
  assert.deepEqual(worldToMinimap(world.x, world.z, 4), { px: 96, py: 48 });
});

test('a longer trip takes longer, within limits', () => {
  const short = flightSeconds({ x: 0, z: 0 }, { x: 4, z: 0 });
  const long = flightSeconds({ x: 0, z: 0 }, { x: 40, z: 0 });
  assert.equal(short, 2.5, 'short trips still take the minimum');
  assert.equal(long, 5);
  assert.equal(flightSeconds({ x: 0, z: 0 }, { x: 200, z: 0 }), 8, 'very long trips are capped');
});
