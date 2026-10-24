// Tests for the astronaut's pose maths: walking, mining and standing still.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heroPose, hitCount, swingPhase, STRIKE_AT,
  createShake, addShake, stepShake, arcPoint,
} from '../js/animation.js';
import { MINE_SECONDS } from '../js/mining.js';

const KEYS = ['bodyX', 'bodyY', 'armLeft', 'armRight', 'legLeft', 'legRight'];

test('every pose gives finite angles for every mode', () => {
  for (const mode of ['idle', 'walk', 'mine']) {
    for (const t of [0, 0.3, 1.7, 42.5]) {
      const pose = heroPose(mode, t, t);
      for (const k of KEYS) assert.ok(Number.isFinite(pose[k]), `${mode}.${k} at ${t}`);
    }
  }
});

test('walking swings the legs in opposite directions', () => {
  const pose = heroPose('walk', 0.123);
  assert.ok(Math.abs(pose.legLeft + pose.legRight) < 1e-9);
  assert.ok(Math.abs(pose.armLeft + pose.armRight) < 1e-9);
});

test('the pick is raised first, then strikes the rock at STRIKE_AT', () => {
  const rest = heroPose('mine', 0, 0).armRight;
  const raised = heroPose('mine', 0, STRIKE_AT * MINE_SECONDS - 0.001).armRight;
  const struck = heroPose('mine', 0, STRIKE_AT * MINE_SECONDS + 0.12 * MINE_SECONDS).armRight;
  assert.ok(raised < rest - 1, 'the arm is well above rest before the strike');
  assert.ok(struck > raised + 1, 'the arm comes down hard on the strike');
});

test('the swing returns to rest by the end of the cycle', () => {
  const end = heroPose('mine', 0, MINE_SECONDS * 0.9999).armRight;
  assert.ok(Math.abs(end) < 0.05, `expected near 0, got ${end}`);
});

test('the astronaut leans into the rock on the strike', () => {
  const lean = heroPose('mine', 0, STRIKE_AT * MINE_SECONDS).bodyX;
  const upright = heroPose('mine', 0, 0).bodyX;
  assert.ok(lean > upright);
});

test('hits are counted once per swing, starting at the strike', () => {
  assert.equal(hitCount(0), 0);
  assert.equal(hitCount(STRIKE_AT * MINE_SECONDS - 0.01), 0);
  assert.equal(hitCount(STRIKE_AT * MINE_SECONDS + 0.01), 1);
  assert.equal(hitCount(STRIKE_AT * MINE_SECONDS + MINE_SECONDS), 2);
  assert.equal(hitCount(STRIKE_AT * MINE_SECONDS + 3 * MINE_SECONDS), 4);
});

test('the swing phase wraps from 0 to 1 once per unit of ore', () => {
  assert.equal(swingPhase(0), 0);
  assert.ok(Math.abs(swingPhase(MINE_SECONDS / 2) - 0.5) < 1e-9);
  assert.equal(swingPhase(MINE_SECONDS), 0);
});

test('a camera shake starts strong and fades to nothing', () => {
  const shake = createShake();
  addShake(shake, 0.2);
  const first = stepShake(shake, 0.016, () => 1);
  assert.ok(Math.abs(first.x) > 0.1, 'the first frame is clearly shaken');
  for (let i = 0; i < 120; i++) stepShake(shake, 0.016, () => 1);
  assert.deepEqual(stepShake(shake, 0.016, () => 1), { x: 0, y: 0, z: 0 });
});

test('stacked shakes never grow past the maximum', () => {
  const shake = createShake();
  for (let i = 0; i < 20; i++) addShake(shake, 0.12, 0.3);
  assert.equal(shake.strength, 0.3);
});

test('with no shake the camera does not move', () => {
  assert.deepEqual(stepShake(createShake(), 0.1), { x: 0, y: 0, z: 0 });
});

test('the ore flight starts on the astronaut and lands on the ship', () => {
  const from = { x: 1, y: 1, z: 1 };
  const to = { x: 5, y: 0.8, z: 4 };
  assert.deepEqual(arcPoint(from, to, 0), from);
  assert.deepEqual(arcPoint(from, to, 1), to);
});

test('the ore flight rises above both ends in the middle', () => {
  const from = { x: 0, y: 1, z: 0 };
  const to = { x: 4, y: 1, z: 0 };
  const middle = arcPoint(from, to, 0.5, 2.5);
  assert.equal(middle.x, 2);
  assert.equal(middle.y, 1 + 2.5);
});
