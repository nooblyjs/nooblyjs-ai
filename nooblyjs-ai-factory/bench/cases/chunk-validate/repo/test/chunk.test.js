import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunk } from '../src/chunk.js';

test('pairs', () => assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]));
