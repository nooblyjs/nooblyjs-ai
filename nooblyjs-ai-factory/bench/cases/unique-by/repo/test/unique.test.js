import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unique } from '../src/unique.js';

test('unique', () => assert.deepEqual(unique([1, 1, 2]), [1, 2]));
