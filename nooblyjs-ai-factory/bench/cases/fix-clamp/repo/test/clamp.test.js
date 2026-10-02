import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp } from '../src/clamp.js';

test('below min', () => assert.equal(clamp(-5, 0, 10), 0));
