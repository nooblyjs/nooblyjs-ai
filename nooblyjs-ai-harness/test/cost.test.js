import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addUsage, costOf, emptyUsage, formatCost } from '../src/core/cost.js';

test('costOf prices input and output tokens per million', () => {
  // claude-opus-5-5: $4 in, $20 out per million tokens
  const cost = costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.equal(cost, 24);
});

test('costOf returns 0 for an unknown model', () => {
  assert.equal(costOf('mystery-model', { input_tokens: 500 }), 0);
});

test('addUsage adds fields and treats missing ones as 0', () => {
  const total = addUsage(addUsage(emptyUsage(), { input_tokens: 10, output_tokens: 5 }), { input_tokens: 3 });
  assert.equal(total.input_tokens, 13);
  assert.equal(total.output_tokens, 5);
});

test('formatCost shows 4 decimals for tiny amounts', () => {
  assert.equal(formatCost(0.00042), '$0.0004');
  assert.equal(formatCost(1.5), '$1.50');
});
