// Phase F00: time you can control.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock, isoNow, systemClock } from '../../src/utils/clock.js';

test('a fake clock only moves when told to', () => {
  const clock = createFakeClock(1000);
  assert.equal(clock.now(), 1000);
  clock.advance(60_000);
  assert.equal(clock.now(), 61_000);
  clock.set(5);
  assert.equal(clock.now(), 5);
  assert.equal(createFakeClock().now(), 0);
});

test('isoNow: an ISO timestamp from any clock', () => {
  assert.equal(isoNow(createFakeClock(Date.UTC(2026, 9, 9, 12))), '2026-10-09T12:00:00.000Z');
  const before = Date.now();
  assert.ok(Date.parse(isoNow()) >= before - 1);
  assert.ok(Math.abs(systemClock.now() - Date.now()) < 1000);
});
