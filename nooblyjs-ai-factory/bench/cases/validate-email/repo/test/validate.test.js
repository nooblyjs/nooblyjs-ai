import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNonEmpty } from '../src/validate.js';

test('nonempty', () => assert.equal(isNonEmpty(' x '), true));
