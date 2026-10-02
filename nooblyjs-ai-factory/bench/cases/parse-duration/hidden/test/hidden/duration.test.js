import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDuration } from '../../src/duration.js';

test('parses', () => {
  assert.equal(parseDuration('1h30m'), 5400);
  assert.equal(parseDuration('45s'), 45);
  assert.equal(parseDuration('2h'), 7200);
  assert.equal(parseDuration('1h2m3s'), 3723);
});
test('rejects', () => {
  for (const bad of ['', 'abc', '5x', '30m1h']) assert.throws(() => parseDuration(bad), TypeError, bad);
});
