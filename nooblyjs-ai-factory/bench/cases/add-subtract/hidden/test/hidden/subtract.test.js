import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add, subtract } from '../../src/math.js';

test('subtract', () => {
  assert.equal(subtract(5, 3), 2);
  assert.equal(subtract(3, 5), -2);
  assert.equal(add(2, 2), 4);
});
