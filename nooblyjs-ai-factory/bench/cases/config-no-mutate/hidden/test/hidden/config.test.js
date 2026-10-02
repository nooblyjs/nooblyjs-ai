import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withDefaults } from '../../src/config.js';

test('no mutation', () => {
  const input = { port: 3000 };
  const out = withDefaults(input);
  assert.deepEqual(out, { port: 3000, host: 'localhost', debug: false });
  assert.deepEqual(input, { port: 3000 });
  assert.notEqual(out, input);
});
