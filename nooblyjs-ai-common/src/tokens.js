// @ts-check
// Counting tokens, roughly, and knowing how much room a model has.
//
// Every request re-sends the system prompt, the tool definitions and the whole
// conversation. A model can only read so much at once: its CONTEXT WINDOW.
// We need to know roughly how full it is BEFORE sending, so we can make room.
//
// Exact counts depend on each provider's tokenizer. A good-enough estimate for
// English and code is ~4 characters per token. (Anthropic also offers a
// count_tokens endpoint for exact numbers, at the cost of an extra request.)
// Moved here from the harness's context/tokens.js (harness Phase 08).
import { DEFAULT_CONTEXT_WINDOW, getModel } from './models.js';

export const CHARS_PER_TOKEN = 4;

// What an image costs in the context window, roughly (Anthropic: width × height / 750, capped by resizing to ~1,600 tokens).
export const IMAGE_TOKENS = 1_600;

/**
 * Rough token count of a string or any JSON-able value.
 * An image's base64 is long, but the model pays per image, not per character,
 * so image blocks count as IMAGE_TOKENS each.
 * @param {unknown} value
 * @param {{ charsPerToken?: number }} [options] a smaller charsPerToken over-estimates, for a safety margin
 */
export function estimateTokens(value, { charsPerToken = CHARS_PER_TOKEN } = {}) {
  if (typeof value === 'string') return Math.ceil(value.length / charsPerToken);
  let images = 0;
  const text = JSON.stringify(value ?? '', (key, v) => (v?.type === 'image' && v.source?.data ? (images++, '[image]') : v));
  return Math.ceil(text.length / charsPerToken) + images * IMAGE_TOKENS;
}

/**
 * The model's context window (an `override`, e.g. from a setting, wins).
 * Looked up in the catalogue by id or alias; unknown models get DEFAULT_CONTEXT_WINDOW.
 * @param {string} model
 * @param {number} [override]
 */
export function contextWindowFor(model, override) {
  return override ?? getModel(model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}
