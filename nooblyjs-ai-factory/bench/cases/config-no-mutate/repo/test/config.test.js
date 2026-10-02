import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withDefaults } from '../src/config.js';

test('fills port', () => assert.equal(withDefaults({}).port, 8080));
