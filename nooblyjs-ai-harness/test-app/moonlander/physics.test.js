import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUEL_MAX,
  MOON_GRAVITY,
  PLATFORMS,
  REFUEL,
  buildTerrain,
  createGame,
  groundHeight,
  step,
} from './public/physics.js';

const terrain = buildTerrain();
const opts = { terrain };
const idle = { left: false, right: false, thrust: false };
const flying = (lander, extra = {}) => ({ ...createGame(), status: 'flying', lander, ...extra });

test('the game starts parked on platform 1 with a full tank', () => {
  const game = createGame();
  assert.equal(game.status, 'landed');
  assert.equal(game.fuel, FUEL_MAX);
  assert.deepEqual(game.visited, [1]);
});

test('the terrain is flat across every platform', () => {
  for (const p of PLATFORMS) {
    assert.equal(groundHeight(terrain, p.x + 1), p.y);
    assert.equal(groundHeight(terrain, p.x + p.width - 1), p.y);
  }
});

test('the lander falls with lunar gravity', () => {
  let game = flying({ x: 50, y: 140, vx: 0, vy: 0, angle: 0 });
  for (let i = 0; i < 100; i++) game = step(game, idle, 0.01, opts);
  assert.ok(Math.abs(game.lander.vy + MOON_GRAVITY) < 1e-9);
});

test('holding space lifts off and burns fuel', () => {
  let game = createGame();
  for (let i = 0; i < 50; i++) game = step(game, { ...idle, thrust: true }, 0.01, opts);
  assert.equal(game.status, 'flying');
  assert.ok(game.lander.vy > 0);
  assert.ok(game.fuel < FUEL_MAX);
});

test('the arrow keys rotate the lander, and thrust then pushes sideways', () => {
  let game = flying({ x: 50, y: 140, vx: 0, vy: 0, angle: 0 });
  for (let i = 0; i < 20; i++) game = step(game, { ...idle, right: true }, 0.01, opts);
  assert.ok(game.lander.angle > 0);
  game = step(game, { ...idle, thrust: true }, 0.1, opts);
  assert.ok(game.lander.vx > 0);
});

test('no fuel means no thrust', () => {
  const game = step(flying({ x: 50, y: 140, vx: 0, vy: 0, angle: 0 }, { fuel: 0 }), { ...idle, thrust: true }, 0.1, opts);
  assert.equal(game.thrusting, false);
  assert.ok(game.lander.vy < 0);
});

test('a gentle touchdown on a new platform lands and refuels', () => {
  const pad = PLATFORMS[1];
  const game = step(flying({ x: pad.x + pad.width / 2, y: pad.y + 3.61, vx: 0, vy: -1, angle: 0 }, { fuel: 30 }), idle, 0.02, opts);
  assert.equal(game.status, 'landed');
  assert.equal(game.platformId, pad.id);
  assert.deepEqual(game.visited, [1, pad.id]);
  assert.ok(Math.abs(game.fuel - (30 + REFUEL)) < 1e-9);
});

test('a hard or tilted touchdown crashes', () => {
  const pad = PLATFORMS[1];
  const x = pad.x + pad.width / 2;
  const hard = step(flying({ x, y: pad.y + 3.65, vx: 0, vy: -6, angle: 0 }), idle, 0.02, opts);
  assert.equal(hard.status, 'crashed');
  const tilted = step(flying({ x, y: pad.y + 3.61, vx: 0, vy: -1, angle: 25 }), idle, 0.02, opts);
  assert.equal(tilted.status, 'crashed');
});

test('landing off the platforms crashes', () => {
  const x = 60; // between platforms 1 and 2
  const game = step(flying({ x, y: groundHeight(terrain, x) + 3.61, vx: 0, vy: -0.5, angle: 0 }), idle, 0.02, opts);
  assert.equal(game.status, 'crashed');
});

test('visiting every platform wins the game', () => {
  const pad = PLATFORMS[3];
  const game = step(
    flying({ x: pad.x + pad.width / 2, y: pad.y + 3.61, vx: 0, vy: -1, angle: 0 }, { visited: [1, 2, 3] }),
    idle, 0.02, opts,
  );
  assert.equal(game.status, 'won');
});
