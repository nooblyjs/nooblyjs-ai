import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unique, uniqueBy } from '../../src/unique.js';

test('uniqueBy', () => {
  const people = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 1, n: 'c' }];
  assert.deepEqual(uniqueBy(people, (p) => p.id), [{ id: 1, n: 'a' }, { id: 2, n: 'b' }]);
  assert.deepEqual(uniqueBy(['aa', 'b', 'cc'], (s) => s.length), ['aa', 'b']);
  assert.deepEqual(unique([3, 3]), [3]);
});
