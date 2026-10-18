// Model discovery (src/aiservice/common/discovery.js): each provider's own list, priced from the best source.
// Offline: `fetch` is a fake answering with the shapes the real lists have. Run with `node --test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableModels, describeModel, discoverModels, forgetAvailableModels, modelKey, openRouterPrices, suggestedTier } from '../src/discovery.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fakeFetch() {
  const calls = [];
  const fn = async (href, init = {}) => {
    calls.push({ href, ...init });
    const url = new URL(href);
    if (url.host === 'api.anthropic.com') {
      return json({ data: [
        { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1_000_000, max_tokens: 128_000, created_at: '2026-08-01T00:00:00Z' },
        { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', max_input_tokens: 1_000_000, max_tokens: 64_000, created_at: '2026-09-01T00:00:00Z', deprecated_at: null },
      ] });
    }
    if (url.host === 'api.openai.com') return json({ error: { message: 'Incorrect API key provided: sk-x***' } }, 401);
    if (url.host === 'api.x.ai') return json({ models: [{ id: 'grok-4.6', created: 1760000000, prompt_text_token_price: 20000, completion_text_token_price: 60000, cached_prompt_text_token_price: 5000 }] });
    if (url.host === 'generativelanguage.googleapis.com') {
      return json({ models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'TTS', supportedGenerationMethods: ['generateContent'] },
      ] });
    }
    if (url.host === 'openrouter.ai') {
      return json({ data: [
        { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.0000001', completion: '0.0000005', input_cache_read: '0.00000001' }, context_length: 1000000 },
        { id: 'anthropic/claude-haiku-5.5:batch', pricing: { prompt: '0.00000005', completion: '0.00000025' } },
        { id: 'google/gemini-2.5-pro', pricing: { prompt: '0.00000125', completion: '0.00001' }, context_length: 1048576 },
        { id: 'meta/llama-9', pricing: { prompt: '0.0000001', completion: '0.0000001' } },
      ] });
    }
    return json({}, 404);
  };
  return Object.assign(fn, { calls });
}
const ENV = { ANTHROPIC_API_KEY: 'a-key', OPENAI_API_KEY: 'old-key', GROK_API_KEY: 'x-key', GEMINI_API_KEY: 'g-key' };

test('each configured provider is asked for its own list (GET only); one with no key is not asked; a refusal says why', async () => {
  const fetch = fakeFetch();
  const lists = await discoverModels({ env: ENV, fetch });
  assert.deepEqual(Object.keys(lists).sort(), ['anthropic', 'gemini', 'grok', 'openai']);
  assert.deepEqual(lists.anthropic.models.map((m) => [m.id, m.contextWindow, m.maxOutput]), [['claude-haiku-5-5', 1_000_000, 64_000], ['claude-opus-5-5', 1_000_000, 128_000]]);
  assert.deepEqual([lists.openai.ok, lists.openai.reason], [false, 'unauthorised']);
  // Not chat: embeddings and speech are left out.
  assert.deepEqual(lists.gemini.models.map((m) => m.id), ['gemini-2.5-pro']);
  // xAI publishes prices in cents per 100 million tokens.
  assert.deepEqual(lists.grok.models[0].pricing, { input: 2, output: 6, cacheRead: 0.5 });
  assert.ok(fetch.calls.every((c) => c.method === 'GET' && c.body === undefined));
  assert.ok(!fetch.calls.some((c) => c.href.includes('deepseek')), 'no key, no request');
  assert.equal(fetch.calls.find((c) => c.href.startsWith('https://api.anthropic.com')).headers['x-api-key'], 'a-key');
});

test('in production the public APIs are not listed', async () => {
  const fetch = fakeFetch();
  const lists = await discoverModels({ env: { ...ENV, NODE_ENV: 'production' }, fetch });
  assert.ok(Object.values(lists).every((l) => l.ok === false && l.reason === 'production'));
  assert.equal(fetch.calls.length, 0);
});

test('OpenRouter prices per million tokens, keyed by provider and a normalised model name; variants left out', async () => {
  const { ok, prices } = await openRouterPrices({ fetch: fakeFetch() });
  assert.equal(ok, true);
  assert.deepEqual(prices.get('anthropic:claude-haiku-5-5'), { input: 0.1, output: 0.5, cacheRead: 0.01, contextWindow: 1000000 });
  assert.equal(prices.size, 2);
  assert.equal(modelKey('claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5');
  assert.equal(modelKey('models/gemini-2.5-pro'), 'gemini-2-5-pro');
});

test('the price comes from the catalogue first, then the provider, then OpenRouter (labelled), else it is unknown; the tier follows the price', async () => {
  const { prices } = await openRouterPrices({ fetch: fakeFetch() });
  const opus = describeModel({ id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', contextWindow: 1_000_000, maxOutput: 128_000, created: null, deprecated: null }, prices);
  assert.deepEqual([opus.priceSource, opus.pricing.output, opus.tier, opus.catalogued], ['catalogue', 20, 'PREMIUM', true]);
  const haiku = describeModel({ id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5', contextWindow: null, maxOutput: null, created: null, deprecated: null }, prices);
  assert.deepEqual([haiku.priceSource, haiku.pricing, haiku.tier, haiku.contextWindow], ['openrouter', { input: 0.1, output: 0.5, cacheRead: 0.01 }, 'LIGHT', 1000000]);
  assert.match(haiku.priceNote, /OpenRouter list price/);
  const grok = describeModel({ id: 'grok-4.6', provider: 'grok', label: 'Grok 4.6', contextWindow: null, maxOutput: null, created: null, deprecated: null, pricing: { input: 2, output: 6, cacheRead: 0.5 } }, prices);
  assert.equal(grok.priceSource, 'provider');
  const unknown = describeModel({ id: 'gemini-9-ultra', provider: 'gemini', label: 'Gemini 9', contextWindow: null, maxOutput: null, created: null, deprecated: null }, prices);
  assert.deepEqual([unknown.pricing, unknown.priceSource, unknown.priceNote, unknown.tier], [null, null, 'Price unknown', 'BALANCED']);
  assert.deepEqual([suggestedTier({ output: 5 }), suggestedTier({ output: 12 }), suggestedTier({ output: 12.5 })], ['LIGHT', 'BALANCED', 'PREMIUM']);
});

test('availableModels groups by provider and is cached for a day; refresh asks again', async () => {
  forgetAvailableModels();
  const fetch = fakeFetch();
  let t = Date.parse('2026-10-10T10:00:00Z');
  const now = () => t;
  const first = await availableModels({ env: ENV, fetch, now });
  assert.deepEqual(first.providers.map((p) => [p.id, p.ok, p.models.length]), [['anthropic', true, 2], ['gemini', true, 1], ['openai', false, 0], ['grok', true, 1]]);
  assert.deepEqual(first.prices, { source: 'openrouter', count: 2 });
  const asked = fetch.calls.length;
  t += 60 * 60_000;
  assert.equal(await availableModels({ env: ENV, fetch, now }), first);
  assert.equal(fetch.calls.length, asked);
  await availableModels({ env: ENV, fetch, now, refresh: true });
  assert.ok(fetch.calls.length > asked);
  forgetAvailableModels();
});
