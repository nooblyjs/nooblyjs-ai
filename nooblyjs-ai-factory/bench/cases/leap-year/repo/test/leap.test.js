import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLeapYear } from '../src/leap.js';

test('2024', () => assert.equal(isLeapYear(2024), true));
