import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cToF } from '../src/temp.js';

test('boiling', () => assert.equal(cToF(100), 212));
