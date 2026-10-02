import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLeapYear } from '../../src/leap.js';

test('leap years', () => {
  for (const y of [2000, 2024, 1996, 2400]) assert.equal(isLeapYear(y), true, y);
  for (const y of [1900, 2100, 2023, 1800]) assert.equal(isLeapYear(y), false, y);
});
