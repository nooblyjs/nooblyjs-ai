import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeDeep } from '../../src/merge.js';

test('merges', () => {
  const a = { x: 1, nested: { y: 2, z: [1] } };
  const b = { nested: { z: [2], w: 3 }, v: 4 };
  assert.deepEqual(mergeDeep(a, b), { x: 1, nested: { y: 2, z: [2], w: 3 }, v: 4 });
  assert.deepEqual(a, { x: 1, nested: { y: 2, z: [1] } }, 'target untouched');
  assert.deepEqual(b, { nested: { z: [2], w: 3 }, v: 4 }, 'source untouched');
});
