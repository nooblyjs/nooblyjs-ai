// @ts-check
// Token accounting. Every API response reports `usage`; we add it up and price it.
// Moved here from the harness's core/cost.js.
//
// Usage objects use the Anthropic API's field names (input_tokens, output_tokens,
// cache_read_input_tokens, cache_creation_input_tokens). Pricing also accepts the
// camelCase names some apps use (inputTokens, outputTokens, cacheReadTokens,
// cacheWriteTokens): see normalizeUsage.
import { PRICES, getModel } from './models.js';

/** @typedef {import('./models.js').Pricing} Pricing */
/** @typedef {{ input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number }} Usage */
/** @typedef {{ inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number }} CamelUsage */

export function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

/**
 * @param {Record<string, number>} total
 * @param {Record<string, number>} [usage]
 */
export function addUsage(total, usage = {}) {
  const sum = { ...total };
  for (const key of Object.keys(sum)) sum[key] += usage[key] ?? 0;
  return sum;
}

/**
 * Either spelling of usage → the API's field names, with missing counts as 0.
 * @param {Usage & CamelUsage} usage
 */
export function normalizeUsage(usage = {}) {
  return {
    input_tokens: usage.input_tokens ?? usage.inputTokens ?? 0,
    output_tokens: usage.output_tokens ?? usage.outputTokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? usage.cacheReadTokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? usage.cacheWriteTokens ?? 0,
  };
}

/**
 * The price of a model: from `prices` if given, otherwise from the catalogue (by id or alias).
 * @param {string} model
 * @param {Record<string, Pricing>} [prices]
 * @returns {Pricing | undefined}
 */
function priceOf(model, prices) {
  return prices ? prices[model] : (PRICES[model] ?? getModel(model)?.pricing);
}

/**
 * True if we know this model's price.
 * @param {string} model
 * @param {Record<string, Pricing>} [prices] another price table, e.g. one an app lets its admin edit
 */
export function hasPrice(model, prices) {
  return Boolean(priceOf(model, prices));
}

/**
 * Cost in US dollars of `usage` at `pricing`. Writing to the cache costs the
 * input price unless the pricing lists a `cacheWrite` price.
 * @param {Partial<Pricing>} pricing
 * @param {Usage & CamelUsage} usage
 */
export function priceUsage(pricing, usage) {
  const u = normalizeUsage(usage);
  /** @param {number} [perMillion] */
  const perToken = (perMillion = 0) => perMillion / 1_000_000;
  return (
    u.input_tokens * perToken(pricing.input) +
    u.output_tokens * perToken(pricing.output) +
    u.cache_read_input_tokens * perToken(pricing.cacheRead) +
    u.cache_creation_input_tokens * perToken(pricing.cacheWrite ?? pricing.input)
  );
}

/**
 * Cost in US dollars of `usage` on `model`. Unknown models cost 0 (see hasPrice).
 * @param {string} model
 * @param {Usage & CamelUsage} usage
 * @param {Record<string, Pricing>} [prices]
 */
export function costOf(model, usage, prices) {
  const price = priceOf(model, prices);
  return price ? priceUsage(price, usage) : 0;
}

/** @param {number} dollars */
export function formatCost(dollars) {
  return dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`;
}
