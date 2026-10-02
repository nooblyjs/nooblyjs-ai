// @ts-check
// The model catalogue: what we know about each model and each provider, in one place.
//
// This is data, not logic: adding a model is a one-entry edit. Before this file,
// the harness, desktop and teammate each kept their own list and the lists had
// drifted apart (different model names, prices known in one app and not another).
// Apps still choose WHICH models they offer; the facts about a model live here.

/**
 * @typedef {{ input: number, output: number, cacheRead: number, cacheWrite?: number }} Pricing
 *   US dollars per 1 million tokens. `cacheRead` is input served from the provider's cache;
 *   with no `cacheWrite`, writing to the cache costs the input price.
 *
 * @typedef {Object} ModelInfo
 * @property {string} id                the model name the API expects
 * @property {string} provider          a key of PROVIDERS
 * @property {string} label             a short name for menus
 * @property {number} [contextWindow]   the most tokens one request may contain (unknown: DEFAULT_CONTEXT_WINDOW)
 * @property {Pricing} [pricing]        list price (unknown: the app shows "price unknown")
 * @property {string} [pricingReviewedAt] when `pricing` was last checked against the provider's page
 * @property {string[]} [aliases]       other names for the same model, e.g. a dated snapshot
 * @property {false} [supportsTemperature] false: the API rejects a custom temperature (reasoning models)
 * @property {string} [tokenParam]      the max-output field an OpenAI-style API wants, when it isn't `max_tokens`
 *
 * @typedef {Object} ProviderInfo
 * @property {string} label
 * @property {string[]} envKeys        environment variables that hold its API key, checked in order
 * @property {string[]} [tokenKeys]    environment variables that hold a bearer token, used when there's no API key
 * @property {string} [keyUrl]         where to get a key
 * @property {string} defaultModel
 * @property {string} smallModel       a cheaper model for side jobs like summarising
 * @property {string[]} modelPrefixes  model names starting with these belong to this provider
 * @property {boolean} [images]        whether its models can look at images
 * @property {'anthropic' | 'openai-responses' | 'openai-chat'} [api]  which API style it speaks (see src/providers/);
 *                                     none: there is no shared adapter (echo is the harness's own)
 * @property {string} [baseUrl]        where its API lives (the openai-chat style appends /chat/completions)
 * @property {string} [tokenParam]     its max-output field when it isn't `max_completion_tokens` (a model's own tokenParam wins)
 */

/** @type {Record<string, ProviderInfo>} */
export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
    tokenKeys: ['ANTHROPIC_AUTH_TOKEN'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    smallModel: 'claude-haiku-4-5',
    modelPrefixes: ['claude-'],
    images: true,
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
  },
  openai: {
    label: 'OpenAI',
    envKeys: ['OPENAI_API_KEY'],
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-6-astra',
    smallModel: 'gpt-6-luna',
    modelPrefixes: ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'],
    images: true,
    // The Responses API: the only OpenAI API that lets reasoning models use tools.
    api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
  },
  grok: {
    label: 'xAI Grok',
    envKeys: ['XAI_API_KEY', 'GROK_API_KEY'],
    keyUrl: 'https://console.x.ai',
    defaultModel: 'grok-4.7',
    smallModel: 'grok-4.3',
    modelPrefixes: ['grok-'],
    images: true,
    api: 'openai-chat',
    baseUrl: 'https://api.x.ai/v1',
  },
  gemini: {
    label: 'Google Gemini',
    envKeys: ['GEMINI_API_KEY'],
    defaultModel: 'gemini-2.5-pro',
    smallModel: 'gemini-2.5-flash',
    modelPrefixes: ['gemini-'],
    // Gemini's OpenAI-compatible endpoint, so it needs no adapter of its own.
    api: 'openai-chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    tokenParam: 'max_tokens',
  },
  deepseek: {
    label: 'DeepSeek',
    envKeys: ['DEEPSEEK_API_KEY'],
    defaultModel: 'deepseek-chat',
    smallModel: 'deepseek-chat',
    modelPrefixes: ['deepseek-'],
    api: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    tokenParam: 'max_tokens',
  },
  // A model running on your own computer. Ollama needs no key.
  ollama: {
    label: 'Ollama (local)',
    envKeys: [],
    defaultModel: 'llama3.2',
    smallModel: 'llama3.2',
    modelPrefixes: [],
    images: false, // depends on the model; most local ones are text-only
    api: 'openai-chat', // Ollama speaks the OpenAI API
    baseUrl: 'http://localhost:11434/v1',
  },
  // The harness's offline provider: answers without a model, for free.
  echo: {
    label: 'Echo (offline)',
    envKeys: [],
    defaultModel: 'echo',
    smallModel: 'echo',
    modelPrefixes: [],
    images: false,
  },
};

// Prices are standard rates from each provider's pricing page, September 2026; they
// change, so check before relying on them:
//   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI    https://developers.openai.com/api/docs/pricing
//   xAI       https://docs.x.ai/docs/models (prompts under 200k tokens; cached price not listed, so full price is assumed)
// Context windows are from each provider's model documentation, September 2026.
// Models without a price are ones an app offers but nobody has priced yet.

/** @type {ModelInfo[]} */
export const MODELS = [
  // Anthropic
  { id: 'claude-opus-5-5', provider: 'anthropic', label: 'Opus 5.5', contextWindow: 1_000_000, pricing: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, pricingReviewedAt: '2026-09-25' },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Sonnet 5.5', contextWindow: 1_000_000, pricing: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, pricingReviewedAt: '2026-09-25' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Haiku 4.5', contextWindow: 200_000, pricing: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, pricingReviewedAt: '2026-09-25', aliases: ['claude-haiku-4-5-20251001'] },
  // Newer Claude models reject a custom temperature.
  { id: 'claude-opus-5', provider: 'anthropic', label: 'Opus 5', contextWindow: 200_000, supportsTemperature: false },
  { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Sonnet 5', contextWindow: 200_000, supportsTemperature: false },

  // OpenAI
  { id: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra', contextWindow: 1_050_000, pricing: { input: 10, output: 50, cacheRead: 1 } },
  { id: 'gpt-6-sol', provider: 'openai', label: 'GPT-6 Sol', pricing: { input: 2, output: 10, cacheRead: 0.2 } },
  { id: 'gpt-6-luna', provider: 'openai', label: 'GPT-6 Luna', pricing: { input: 0.1, output: 0.5, cacheRead: 0.01 } },
  { id: 'gpt-5.6-sol', provider: 'openai', label: 'GPT-5.6 Sol', pricing: { input: 4, output: 20, cacheRead: 0.4 } },
  { id: 'gpt-5.6-terra', provider: 'openai', label: 'GPT-5.6 Terra', pricing: { input: 2, output: 12, cacheRead: 0.2 } },
  { id: 'gpt-5.6-luna', provider: 'openai', label: 'GPT-5.6 Luna', pricing: { input: 0.2, output: 1.2, cacheRead: 0.02 } },
  // Reasoning models: no custom temperature, and Chat Completions wants max_completion_tokens.
  { id: 'gpt-5', provider: 'openai', label: 'GPT-5', contextWindow: 400_000, tokenParam: 'max_completion_tokens', supportsTemperature: false },
  { id: 'gpt-5-mini', provider: 'openai', label: 'GPT-5 mini', contextWindow: 400_000, tokenParam: 'max_completion_tokens', supportsTemperature: false },
  { id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1', contextWindow: 1_000_000 },
  { id: 'gpt-4o', provider: 'openai', label: 'GPT-4o', contextWindow: 128_000 },

  // xAI
  { id: 'grok-4.7', provider: 'grok', label: 'Grok 4.7', contextWindow: 500_000, pricing: { input: 2, output: 6, cacheRead: 2 } },
  { id: 'grok-4.3', provider: 'grok', label: 'Grok 4.3', contextWindow: 1_000_000, pricing: { input: 1.25, output: 2.5, cacheRead: 1.25 } },
  { id: 'grok-build-0.1', provider: 'grok', label: 'Grok Build 0.1', contextWindow: 256_000, pricing: { input: 1, output: 2, cacheRead: 1 } },

  // Google
  { id: 'gemini-2.5-pro', provider: 'gemini', label: 'Gemini 2.5 Pro', contextWindow: 1_048_576 },
  { id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', contextWindow: 1_048_576 },

  // DeepSeek
  { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek Chat', contextWindow: 64_000 },
  { id: 'deepseek-reasoner', provider: 'deepseek', label: 'DeepSeek Reasoner', contextWindow: 64_000 },

  // The offline echo provider is free. Its window is tiny on purpose, so you can watch
  // the harness compact a conversation without spending anything.
  { id: 'echo', provider: 'echo', label: 'Echo', contextWindow: 20_000, pricing: { input: 0, output: 0, cacheRead: 0 } },
];

export const DEFAULT_CONTEXT_WINDOW = 128_000;

const byName = new Map();
for (const model of MODELS) {
  for (const name of [model.id, ...(model.aliases ?? [])]) {
    if (byName.has(name)) throw new Error(`Model catalogue: "${name}" is listed twice`);
    byName.set(name, model);
  }
}

/**
 * A model by its id or one of its aliases, or null.
 * @param {string} name
 * @returns {ModelInfo | null}
 */
export function getModel(name) {
  return byName.get(name) ?? null;
}

/**
 * Every catalogued model of one provider, in catalogue order.
 * @param {string} provider
 */
export function modelsFor(provider) {
  return MODELS.filter((m) => m.provider === provider);
}

/**
 * Which provider a model belongs to: its catalogue entry, else its name's prefix
 * ("grok-9" → "grok"), else null.
 * @param {string} model
 */
export function providerForModel(model) {
  const known = getModel(model);
  if (known) return known.provider;
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    if (provider.modelPrefixes.some((prefix) => model.startsWith(prefix))) return id;
  }
  return null;
}

/**
 * Price per model id, for the models that have one (aliases resolve through getModel).
 * @type {Record<string, Pricing>}
 */
export const PRICES = Object.fromEntries(MODELS.filter((m) => m.pricing).map((m) => [m.id, /** @type {Pricing} */ (m.pricing)]));

/**
 * Context window per model id, for the models where we know it.
 * @type {Record<string, number>}
 */
export const CONTEXT_WINDOWS = Object.fromEntries(MODELS.filter((m) => m.contextWindow).map((m) => [m.id, /** @type {number} */ (m.contextWindow)]));
