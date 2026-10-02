import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toRoman } from '../../src/roman.js';

test('toRoman', () => {
  const cases = { 1: 'I', 4: 'IV', 9: 'IX', 14: 'XIV', 40: 'XL', 90: 'XC', 400: 'CD', 1994: 'MCMXCIV', 3999: 'MMMCMXCIX' };
  for (const [n, r] of Object.entries(cases)) assert.equal(toRoman(Number(n)), r);
  for (const bad of [0, 4000, 1.5, -1]) assert.throws(() => toRoman(bad), RangeError);
});
