import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays } from '../src/dates.js';

test('returns a string', () => assert.equal(typeof addDays('2024-01-01', 1), 'string'));
