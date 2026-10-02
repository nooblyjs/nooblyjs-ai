import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCents } from '../../src/money.js';

test('formatCents', () => {
  assert.equal(formatCents(1234), '$12.34');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(-5), '-$0.05');
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.throws(() => formatCents(1.5), TypeError);
});
