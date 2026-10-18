// @ts-check
// Which models are there right now: each provider's own list (its "models" endpoint), read with the keys in the
// environment, merged with what the catalogue (models.js) knows and priced from the best source there is.
//
//   discoverModels()   every configured provider's chat models: id, name, context window, max output, deprecation
//   openRouterPrices() OpenRouter's public catalogue: list prices for every frontier model (a reference, not a bill)
//   availableModels()  the two together, cached for a day: what an app offers people to choose from
//
// Prices, best first: the catalogue's (curated, reviewed by a person) · the provider's own list (only xAI publishes
// one) · OpenRouter's list price, labelled as a reference · none ("price unknown"). Every request here is a GET.
//
// Governance: the direct public APIs are refused in production (providers/index.js), so production lists none of
// them; Claude is reached there through AWS Bedrock, Vertex AI or Azure, whose model ids are configured.
import { DIRECT_APIS, PROVIDERS, getModel } from './models.js';

const DAY = 86_400_000;
const TIMEOUT_MS = 20_000;
const OPENROUTER = 'https://openrouter.ai/api/v1/models';
// OpenRouter names a model "<vendor>/<model>"; our provider ids are not always the vendor's.
const VENDOR = { anthropic: 'anthropic', openai: 'openai', grok: 'x-ai', gemini: 'google', deepseek: 'deepseek' };
// Models a list holds that are not for chat: speech, images, embeddings, search, moderation, realtime audio.
const NOT_CHAT = /(audio|tts|transcribe|realtime|image|dall-e|embedding|moderation|search|whisper|babbage|davinci|computer-use|-live|lyria|banana|robotics|imagen|veo-)/i;

/**
 * @typedef {{ input: number, output: number, cacheRead: number, cacheWrite?: number }} Pricing
 * @typedef {{ id: string, provider: string, label: string, contextWindow: number | null, maxOutput: number | null,
 *   created: string | null, deprecated: string | null, pricing?: Pricing }} FoundModel
 * @typedef {{ ok: true, models: FoundModel[] } | { ok: false, reason: string, message: string }} ProviderList
 * @typedef {{ ok: false, reason: string, message: string }} Failure
 * @typedef {{ apiKey: string, keyName: string }} Key
 * @typedef {{ key: Key, env: Record<string, string | undefined>, fetchImpl: typeof fetch }} ListerArgs
 */

/**
 * A GET that never throws: { ok, status, body } or { ok: false, reason, message }.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ ok: true, status: number, body: any } | Failure>}
 */
async function getJson(fetchImpl, url, headers = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, reason: 'unreachable', message: `No answer: ${/** @type {any} */ (err).cause?.code ?? /** @type {any} */ (err).message}` };
  }
  const body = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, body };
  const message = body?.error?.message ?? body?.error ?? body?.message ?? `HTTP ${res.status}`;
  return { ok: false, reason: res.status === 401 || res.status === 403 || /api key/i.test(String(message)) ? 'unauthorised' : 'failed', message: String(message).slice(0, 200) };
}

/** @param {unknown} value */
const iso = (value) => {
  if (value == null || value === '') return null;
  const t = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(String(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** @param {unknown} v */
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
/** @param {string} id */
const labelFrom = (id) => id.replace(/[-_]/g, ' ').replace(/\b(gpt|o\d)\b/gi, (m) => m.toUpperCase()).replace(/\b\w/g, (c) => c.toUpperCase());

/** A JSON field that should hold a list, as one (anything else is an empty list). */
const list = (/** @type {unknown} */ v) => /** @type {any[]} */ (Array.isArray(v) ? v : []);

/**
 * How each provider lists its models, and how its entries read.
 * @type {Record<string, (args: ListerArgs) => Promise<Omit<FoundModel, 'provider'>[] | Failure>>}
 */
const LISTERS = {
  async anthropic({ key, env, fetchImpl }) {
    const base = env.ANTHROPIC_BASE_URL || PROVIDERS.anthropic.baseUrl;
    /** @type {Record<string, string>} */
    const auth = key.keyName === 'ANTHROPIC_AUTH_TOKEN' ? { authorization: `Bearer ${key.apiKey}` } : { 'x-api-key': key.apiKey };
    const r = await getJson(fetchImpl, `${base}/v1/models?limit=1000`, { ...auth, 'anthropic-version': '2023-06-01' });
    if (!r.ok) return r;
    return list(r.body?.data).map((m) => ({
      id: m.id, label: m.display_name ?? labelFrom(m.id), contextWindow: num(m.max_input_tokens), maxOutput: num(m.max_tokens),
      created: iso(m.created_at), deprecated: iso(m.deprecated_at ?? m.retires_at),
    }));
  },
  async openai({ key, env, fetchImpl }) {
    const base = env.OPENAI_BASE_URL || PROVIDERS.openai.baseUrl;
    const r = await getJson(fetchImpl, `${base}/models`, { authorization: `Bearer ${key.apiKey}` });
    if (!r.ok) return r;
    return list(r.body?.data)
      .filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id))
      .map((m) => ({ id: m.id, label: labelFrom(m.id), contextWindow: null, maxOutput: null, created: iso(m.created), deprecated: null }));
  },
  async grok({ key, env, fetchImpl }) {
    const base = env.GROK_BASE_URL || PROVIDERS.grok.baseUrl;
    const r = await getJson(fetchImpl, `${base}/language-models`, { authorization: `Bearer ${key.apiKey}` });
    if (!r.ok) return r;
    // xAI prices in US cents per 100 million tokens: 12500 is $1.25 per million.
    const perMillion = (/** @type {unknown} */ v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) / 10000 : null);
    return list(r.body?.models).map((m) => {
      const input = perMillion(m.prompt_text_token_price);
      const output = perMillion(m.completion_text_token_price);
      return {
        id: m.id, label: labelFrom(m.id), contextWindow: null, maxOutput: null, created: iso(m.created), deprecated: null,
        ...(input != null && output != null ? { pricing: { input, output, cacheRead: perMillion(m.cached_prompt_text_token_price) ?? input } } : {}),
      };
    });
  },
  async gemini({ key, fetchImpl }) {
    const r = await getJson(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key.apiKey)}`);
    if (!r.ok) return r;
    return list(r.body?.models)
      .filter((m) => list(m.supportedGenerationMethods).includes('generateContent'))
      .map((m) => ({
        id: String(m.name).replace(/^models\//, ''), label: m.displayName ?? labelFrom(m.name), contextWindow: num(m.inputTokenLimit), maxOutput: num(m.outputTokenLimit),
        created: null, deprecated: null,
      }));
  },
  async deepseek({ key, env, fetchImpl }) {
    const base = env.DEEPSEEK_BASE_URL || PROVIDERS.deepseek.baseUrl;
    const r = await getJson(fetchImpl, `${base}/models`, { authorization: `Bearer ${key.apiKey}` });
    if (!r.ok) return r;
    return list(r.body?.data).map((m) => ({ id: m.id, label: m.name ?? labelFrom(m.id), contextWindow: num(m.context_window), maxOutput: num(m.max_output_tokens), created: null, deprecated: null }));
  },
  async ollama({ env, fetchImpl }) {
    const base = String(env.OLLAMA_BASE_URL || env.OLLAMA_ENDPOINT || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    const r = await getJson(fetchImpl, `${base}/api/tags`);
    if (!r.ok) return r;
    return list(r.body?.models).map((m) => ({ id: m.name, label: m.name, contextWindow: null, maxOutput: null, created: iso(m.modified_at), deprecated: null, pricing: { input: 0, output: 0, cacheRead: 0 } }));
  },
};

/**
 * The key a provider is read with, or null. Ollama needs none, only an address.
 * @param {string} id
 * @param {Record<string, string | undefined>} env
 * @returns {Key | null}
 */
function keyFor(id, env) {
  if (id === 'ollama') return env.OLLAMA_BASE_URL || env.OLLAMA_ENDPOINT ? { apiKey: '', keyName: '' } : null;
  for (const name of [...(PROVIDERS[id]?.envKeys ?? []), ...(PROVIDERS[id]?.tokenKeys ?? [])]) if (env[name]) return { apiKey: String(env[name]), keyName: name };
  return null;
}

/**
 * Every configured provider's chat models, straight from its own list. A provider with no key is left out; one that
 * refuses or doesn't answer says why. In production the direct public APIs are not listed (they are refused there).
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, providers?: string[] }} [options]
 * @returns {Promise<Record<string, ProviderList>>}
 */
export async function discoverModels({ env = process.env, fetch: fetchImpl = globalThis.fetch, providers = Object.keys(LISTERS) } = {}) {
  const production = env.NODE_ENV === 'production';
  const out = /** @type {Record<string, ProviderList>} */ ({});
  await Promise.all(providers.filter((id) => LISTERS[id]).map(async (id) => {
    const key = keyFor(id, env);
    if (!key) return;
    if (production && DIRECT_APIS.includes(id)) {
      out[id] = { ok: false, reason: 'production', message: `${PROVIDERS[id].label}'s public API is not used in production.` };
      return;
    }
    const listed = await LISTERS[id]({ key, env, fetchImpl });
    if (!Array.isArray(listed)) {
      out[id] = { ok: false, reason: listed.reason, message: listed.message };
      return;
    }
    const models = listed.filter((m) => m.id && !NOT_CHAT.test(m.id)).map((m) => ({ ...m, provider: id }));
    models.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? '') || a.id.localeCompare(b.id));
    out[id] = { ok: true, models };
  }));
  return out;
}

/** "claude-sonnet-5.5", "claude-sonnet-5-5-20260101" and "Claude Sonnet 5.5" all become "claude-sonnet-5-5". */
export const modelKey = (/** @type {unknown} */ id) => String(id).toLowerCase().replace(/^models\//, '').replace(/[._\s]+/g, '-').replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '').replace(/-latest$/, '');

/**
 * OpenRouter's public catalogue as list prices: Map "<provider>:<model key>" → { input, output, cacheRead, contextWindow }.
 * USD per million tokens. No key is needed. Batch and other variants (":batch") are left out.
 * @param {{ fetch?: typeof fetch }} [options]
 */
export async function openRouterPrices({ fetch: fetchImpl = globalThis.fetch } = {}) {
  const r = await getJson(fetchImpl, OPENROUTER);
  if (!r.ok) return { ok: false, reason: r.reason, message: r.message, prices: new Map() };
  const provider = Object.fromEntries(Object.entries(VENDOR).map(([p, v]) => [v, p]));
  const prices = new Map();
  for (const m of list(r.body?.data)) {
    const [vendor, name] = String(m.id ?? '').split('/');
    if (!provider[vendor] || !name || name.includes(':')) continue;
    const perMillion = (/** @type {unknown} */ v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 1e6 * 10000) / 10000 : null);
    const input = perMillion(m.pricing?.prompt);
    const output = perMillion(m.pricing?.completion);
    if (input == null || output == null) continue;
    const key = `${provider[vendor]}:${modelKey(name)}`;
    if (!prices.has(key)) prices.set(key, { input, output, cacheRead: perMillion(m.pricing?.input_cache_read) ?? input, contextWindow: num(m.context_length) });
  }
  return { ok: true, prices };
}

/**
 * The tier a model suggests by its output price, against the Claude rate cards: up to $5 per million is LIGHT (Haiku),
 * up to $12 BALANCED (Sonnet), more PREMIUM (Opus). Unknown: BALANCED, for a person to change.
 * @param {Pricing | undefined | null} pricing
 */
export function suggestedTier(pricing) {
  const out = Number(pricing?.output);
  if (!Number.isFinite(out)) return 'BALANCED';
  return out <= 5 ? 'LIGHT' : out <= 12 ? 'BALANCED' : 'PREMIUM';
}

/**
 * One model as an app shows it: the provider's facts, the catalogue's where it has them, and a price with its source.
 * @param {FoundModel} found
 * @param {Map<string, any>} reference  openRouterPrices().prices
 */
export function describeModel(found, reference = new Map()) {
  const known = getModel(found.id);
  const fromReference = reference.get(`${found.provider}:${modelKey(found.id)}`) ?? null;
  let pricing = null;
  let priceSource = null;
  if (known?.pricing) [pricing, priceSource] = [known.pricing, 'catalogue'];
  else if (found.pricing) [pricing, priceSource] = [found.pricing, found.provider === 'ollama' ? 'local' : 'provider'];
  else if (fromReference) [pricing, priceSource] = [{ input: fromReference.input, output: fromReference.output, cacheRead: fromReference.cacheRead }, 'openrouter'];
  return {
    id: found.id,
    provider: found.provider,
    providerLabel: PROVIDERS[found.provider]?.label ?? found.provider,
    label: known?.label ?? found.label,
    contextWindow: found.contextWindow ?? known?.contextWindow ?? fromReference?.contextWindow ?? null,
    maxOutput: found.maxOutput,
    created: found.created,
    deprecated: found.deprecated,
    catalogued: Boolean(known),
    pricing,
    priceSource,
    priceNote: { catalogue: 'NooblyJS catalogue price', provider: `${PROVIDERS[found.provider]?.label ?? found.provider}'s own list price`, openrouter: 'OpenRouter list price (a reference: check the provider)', local: 'Runs locally: no charge' }[priceSource ?? ''] ?? 'Price unknown',
    tier: suggestedTier(pricing),
  };
}

const cache = { at: 0, value: /** @type {any} */ (null), pending: /** @type {Promise<any> | null} */ (null) };

/**
 * What an app offers people to choose from: every configured provider's chat models, described and priced, grouped
 * by provider. Cached for a day in this process; `refresh` asks again.
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, refresh?: boolean, now?: () => number, maxAgeMs?: number }} [options]
 */
export async function availableModels({ env = process.env, fetch: fetchImpl = globalThis.fetch, refresh = false, now = Date.now, maxAgeMs = DAY } = {}) {
  if (!refresh && cache.value && now() - cache.at < maxAgeMs) return cache.value;
  if (cache.pending && !refresh) return cache.pending;
  cache.pending = (async () => {
    const [lists, reference] = await Promise.all([discoverModels({ env, fetch: fetchImpl }), openRouterPrices({ fetch: fetchImpl })]);
    const providers = Object.entries(lists).map(([id, list]) => (list.ok
      ? { id, label: PROVIDERS[id]?.label ?? id, ok: true, models: list.models.map((m) => describeModel(m, reference.prices)) }
      : { id, label: PROVIDERS[id]?.label ?? id, ok: false, reason: list.reason, message: list.message, models: [] }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const value = {
      checkedAt: new Date(now()).toISOString(),
      providers,
      prices: reference.ok ? { source: 'openrouter', count: reference.prices.size } : { source: null, message: reference.message },
    };
    cache.at = now();
    cache.value = value;
    return value;
  })();
  try {
    return await cache.pending;
  } finally {
    cache.pending = null;
  }
}

/** Forgets the cached list (tests). */
export function forgetAvailableModels() {
  cache.at = 0;
  cache.value = null;
}
