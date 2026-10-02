import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsvLine } from '../src/csv.js';

test('simple', () => assert.deepEqual(parseCsvLine('a,b'), ['a', 'b']));
