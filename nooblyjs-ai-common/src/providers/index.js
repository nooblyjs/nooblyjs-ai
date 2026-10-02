// @ts-check
// One way to talk to every model.
//
// A PROVIDER is an object with a `stream(request, { signal })` method that
// yields events (see events.js) and ends with the complete, Anthropic-shaped
// reply. Every adapter speaks it, so an app writes its model code once:
//
//   const provider = createProvider('anthropic');            // the key comes from ANTHROPIC_API_KEY
//   const reply = await complete(provider, {
//     model: 'claude-sonnet-5-5', system: 'Be brief.', maxTokens: 1000,
//     messages: [{ role: 'user', content: 'What is a token?' }],
//   }, { onText: (text) => process.stdout.write(text) });
//
// The request, whichever provider gets it:
//   model, messages (Anthropic shape: text, image, tool_use and tool_result blocks),
//   system, context (volatile system text, kept out of the prompt cache), tools
//   ({ name, description, input_schema }), maxTokens, temperature (dropped for models
//   that reject it), effort, and for Anthropic thinking and fallbacks.
//
// Three adapters cover the catalogue's providers, chosen by each one's `api`:
//   anthropic          Claude's Messages API
//   openai-responses   OpenAI's Responses API (reasoning models with tools)
//   openai-chat        Chat Completions: Grok, Gemini, DeepSeek, Ollama, and any compatible server
import { normalizeUsage } from '../cost.js';
import { PROVIDERS } from '../models.js';
import { withRetry } from '../retry.js';
import { createAnthropicProvider } from './anthropic.js';
import { EVENT } from './events.js';
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import { createOpenAIResponsesProvider } from './openai-responses.js';

export { EVENT } from './events.js';
export { createAnthropicProvider } from './anthropic.js';
export { createOpenAICompatibleProvider } from './openai-compatible.js';
export { createOpenAIResponsesProvider } from './openai-responses.js';
export { createMockProvider } from './mock.js';
export { addCacheBreakpoints } from './cache.js';

/**
 * The API key for a provider, and which variable it came from, or null.
 * @param {string} id
 * @param {Record<string, string | undefined>} [env]
 */
export function findApiKey(id, env = process.env) {
  for (const name of PROVIDERS[id]?.envKeys ?? []) {
    const apiKey = env[name];
    if (apiKey) return { apiKey, keyName: name };
  }
  return null;
}

/**
 * A ready-to-use provider for one of the catalogue's providers.
 *
 * The key comes from `apiKey`, else the provider's environment variables; for
 * Anthropic a bearer `authToken` (or ANTHROPIC_AUTH_TOKEN) also works. The
 * address is `baseUrl`, else $<ID>_BASE_URL (e.g. DEEPSEEK_BASE_URL, OLLAMA_BASE_URL),
 * else the catalogue's. OpenAI is a special case: given a `baseUrl` (LM Studio,
 * vLLM…) it uses Chat Completions, which those servers have, instead of Responses.
 * Pass `api` to choose the style yourself. Other options (caching, thinking,
 * effort, fallbacks, fetchImpl, onExchange) go to the adapter.
 *
 * @param {string} id
 * @param {{ apiKey?: string, authToken?: string, baseUrl?: string, api?: 'anthropic' | 'openai-responses' | 'openai-chat',
 *           env?: Record<string, string | undefined>, [option: string]: any }} [options]
 */
export function createProvider(id, { apiKey, authToken, baseUrl, api, env = process.env, ...options } = {}) {
  const info = PROVIDERS[id];
  if (!info) throw new Error(`Unknown provider "${id}". Choose one of: ${Object.keys(PROVIDERS).join(', ')}.`);
  const style = api ?? (id === 'openai' && baseUrl ? 'openai-chat' : info.api);
  if (!style) throw new Error(`${info.label} has no shared adapter.`);

  // An empty value (e.g. `OPENAI_BASE_URL=` left in a .env file) counts as not set.
  const key = apiKey || findApiKey(id, env)?.apiKey;
  const token = key ? undefined : authToken || (info.tokenKeys ?? []).map((name) => env[name]).find(Boolean);
  if (!key && !token && info.envKeys.length) {
    throw new Error(`No API key for ${info.label}. Set ${[...info.envKeys, ...(info.tokenKeys ?? [])].join(' or ')}.`);
  }
  const url = baseUrl || env[`${id.toUpperCase()}_BASE_URL`] || info.baseUrl;
  if (!url) throw new Error(`${info.label} has no address. Pass a baseUrl.`);

  switch (style) {
    case 'anthropic':
      return createAnthropicProvider({ ...options, apiKey: key, authToken: token, baseUrl: url });
    case 'openai-responses':
      return createOpenAIResponsesProvider({ ...options, name: id, apiKey: /** @type {string} */ (key), baseUrl: url });
    case 'openai-chat':
      // A server that needs no key (Ollama) still gets an Authorization header: some insist on one.
      return createOpenAICompatibleProvider({ tokenParam: info.tokenParam, ...options, name: id, apiKey: key ?? id, baseUrl: url });
    default:
      throw new Error(`Unknown API style "${style}".`);
  }
}

/**
 * @typedef {Object} Reply
 * @property {import('./events.js').Message} message  the complete reply: send it back as-is in a tool loop
 * @property {string} text                            its text blocks, joined
 * @property {Array<{ id: string, name: string, input: object }>} toolCalls  tools the model wants to run
 * @property {string | null} stopReason               end_turn, tool_use, max_tokens, refusal…
 * @property {ReturnType<typeof normalizeUsage>} usage
 * @property {string | undefined} model               the model that answered
 */

/**
 * Send one request and wait for the whole reply, for apps that don't need every event.
 * Temporary failures (rate limits, overload, network) are retried with backoff
 * as long as nothing has streamed yet.
 *
 * @param {{ name: string, stream: (request: any, options?: { signal?: AbortSignal }) => AsyncIterable<any> }} provider
 * @param {object} request
 * @param {{ signal?: AbortSignal, onText?: (text: string) => void, onEvent?: (event: any) => void, maxRetries?: number }} [options]
 * @returns {Promise<Reply>}
 */
export async function complete(provider, request, { signal, onText, onEvent, maxRetries = 2 } = {}) {
  /** @type {import('./events.js').Message | undefined} */
  let message;
  const events = /** @type {AsyncIterable<any>} */ (withRetry(() => provider.stream(request, { signal }), { maxRetries, signal }));
  for await (const event of events) {
    onEvent?.(event);
    if (event.type === EVENT.TEXT_DELTA) onText?.(event.text);
    else if (event.type === EVENT.MESSAGE) message = event.message;
  }
  if (!message) throw new Error(`${provider.name}: the reply ended without a message`);
  return {
    message,
    text: message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    toolCalls: message.content.filter((b) => b.type === 'tool_use').map(({ id, name, input }) => ({ id, name, input })),
    stopReason: message.stop_reason,
    usage: normalizeUsage(message.usage),
    model: message.model,
  };
}
