import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock } from '../src/util/clock.js';
import { idTime, newId, slugify } from '../src/util/ids.js';

test('ids sort by creation time, as plain strings', () => {
  const clock = createFakeClock(1_000);
  const ids = [];
  for (const step of [5, 1_000_000, 3, 86_400_000]) {
    clock.advance(step);
    ids.push(newId('run', clock));
  }
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(idTime(ids[0]), 1_005);
  assert.match(ids[0], /^run-[0-9a-z]{9}-[0-9a-f]{6}$/);
});

test('two ids made in the same millisecond still differ', () => {
  const clock = createFakeClock(42);
  assert.notEqual(newId('ws', clock), newId('ws', clock));
});

test('slugify makes folder- and branch-safe names', () => {
  assert.equal(slugify('Add a --json flag!'), 'add-a-json-flag');
  assert.equal(slugify('!!!'), 'x');
  assert.equal(slugify('a'.repeat(50)).length, 30);
});
