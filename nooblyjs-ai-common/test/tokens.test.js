import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONTEXT_WINDOW } from '../src/models.js';
import { IMAGE_TOKENS, contextWindowFor, estimateTokens } from '../src/tokens.js';

test('estimateTokens counts about 4 characters per token', () => {
  assert.equal(estimateTokens('abcd'.repeat(10)), 10);
  assert.equal(estimateTokens('abcde'), 2); // rounds up
  assert.equal(estimateTokens(''), 0);
});

test('estimateTokens measures JSON values', () => {
  assert.equal(estimateTokens({ a: 1 }), Math.ceil(JSON.stringify({ a: 1 }).length / 4));
  assert.equal(estimateTokens(undefined), 1); // '""'
});

test('estimateTokens charges a flat price per image, not per base64 character', () => {
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x'.repeat(100_000) } };
  const tokens = estimateTokens([{ role: 'user', content: [image] }]);
  assert.ok(tokens > IMAGE_TOKENS && tokens < IMAGE_TOKENS + 100);
});

test('estimateTokens takes a smaller charsPerToken for a safety margin', () => {
  assert.equal(estimateTokens('x'.repeat(36), { charsPerToken: 3.6 }), 10);
});

test('contextWindowFor: override, then known model, then the default', () => {
  assert.equal(contextWindowFor('claude-haiku-4-5'), 200_000);
  assert.equal(contextWindowFor('claude-haiku-4-5', 20_000), 20_000);
  assert.equal(contextWindowFor('mystery-model'), DEFAULT_CONTEXT_WINDOW);
});

test('contextWindowFor resolves aliases through the catalogue', () => {
  assert.equal(contextWindowFor('claude-haiku-4-5-20251001'), 200_000);
});
