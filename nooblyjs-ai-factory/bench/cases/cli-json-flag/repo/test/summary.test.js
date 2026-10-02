import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summary } from '../src/summary.js';

test('summary', () => assert.deepEqual(summary([1, 2]), { items: 2, total: 3 }));
