import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordCount } from '../../src/words.js';

test('wordCount', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('  hi   there '), 2);
  assert.equal(wordCount('one\ttwo\nthree'), 3);
  assert.equal(wordCount('a b'), 2);
});
