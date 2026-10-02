import assert from 'node:assert/strict';
import { test } from 'node:test';
import { range } from '../src/range.js';

test('range returns an array', () => assert.ok(Array.isArray(range(2))));
