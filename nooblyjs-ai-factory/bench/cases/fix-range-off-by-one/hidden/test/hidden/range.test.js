import assert from 'node:assert/strict';
import { test } from 'node:test';
import { range } from '../../src/range.js';

test('range', () => {
  assert.deepEqual(range(3), [0, 1, 2]);
  assert.deepEqual(range(0), []);
  assert.deepEqual(range(1), [0]);
});
