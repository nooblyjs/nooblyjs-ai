import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addUsage, costOf, emptyUsage, formatCost, hasPrice, normalizeUsage, priceUsage } from '../src/cost.js';

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

test('costOf and hasPrice can use another price table', () => {
  const prices = { 'my-model': { input: 1, output: 2, cacheRead: 0.5 } };
  assert.equal(hasPrice('my-model', prices), true);
  assert.equal(hasPrice('claude-opus-5-5', prices), false);
  assert.equal(costOf('my-model', { input_tokens: 1_000_000, output_tokens: 1_000_000 }, prices), 3);
});

test('cache writes cost the input price when no cacheWrite price is listed', () => {
  assert.equal(costOf('grok-4.7', { cache_creation_input_tokens: 1_000_000 }), 2);
});

test('costOf finds a model by its alias', () => {
  assert.equal(costOf('claude-haiku-4-5-20251001', { output_tokens: 1_000_000 }), 5);
  assert.equal(hasPrice('claude-haiku-4-5-20251001'), true);
});

test('pricing accepts camelCase usage too', () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }), {
    input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4,
  });
  const camel = costOf('claude-sonnet-5-5', { inputTokens: 1_000_000, cacheWriteTokens: 1_000_000 });
  assert.equal(camel, 2 + 2.5);
});

test('priceUsage prices usage at a given pricing, missing prices as 0', () => {
  assert.equal(priceUsage({ input: 1, output: 2 }, { input_tokens: 1_000_000, output_tokens: 500_000, cache_read_input_tokens: 9 }), 2);
});
