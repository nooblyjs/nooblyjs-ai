import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cToF, fToC } from '../../src/temp.js';

test('conversions', () => {
  assert.equal(fToC(212), 100);
  assert.equal(fToC(100), 37.8);
  assert.equal(fToC(-40), -40);
  assert.equal(cToF(37.77), 100);
  assert.equal(cToF(100), 212);
});
