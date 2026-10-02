import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordCount } from '../src/words.js';

test('two words', () => assert.equal(wordCount('a b'), 2));
