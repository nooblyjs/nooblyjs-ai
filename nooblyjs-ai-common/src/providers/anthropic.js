// Talk to Claude with plain HTTP requests. No SDK, so nothing is hidden.
// Moved here from the harness's providers/anthropic.js; the phases below are the harness's.
//
// Phase 01: one request, one complete JSON reply.
// Phase 03: `stream: true`, so the reply arrives as a series of small events
//           (see sse.js). We pass the text on as it arrives and build up the
//           complete message at the same time.
// Phase 18: extended THINKING. Current Claude models always think before
//           answering; by default the API sends back empty thinking blocks
//           ("omitted"). With the `thinking: "summarized"` setting we ask for a
//           readable summary and stream it as thinking_delta events. `effort`
//           (low … max) sets how hard the model thinks, and so its cost.
import { EVENT } from './events.js';
import { addCacheBreakpoints } from './cache.js';
import { ApiError, retryAfterMs } from '../errors.js';
import { getModel } from '../models.js';
import { parseSSE } from '../sse.js';

export { ApiError };

export const BASE_URL = 'https://api.anthropic.com';
export const API_URL = `${BASE_URL}/v1/messages`;
export const API_VERSION = '2023-06-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Build the HTTP request without sending it. Kept separate so tests can check
 * exactly what goes over the wire without spending tokens.
 *
 * `context` is volatile system text (e.g. memory) that goes after the cached
 * system prompt. `temperature` is only sent to models that accept one.
 */
export function buildRequest({ apiKey, authToken, baseUrl = BASE_URL, model, system, context, messages, tools, maxTokens, temperature, fallbacks, caching = false, stream = true, thinking, effort }) {
  const headers = {
    'content-type': 'application/json',
    ...authHeaders({ apiKey, authToken }),
    'anthropic-version': API_VERSION,
  };
  // Phase 09: mark the stable start of the request as cacheable.
  // caching: true marks tools, system and the latest message; 'system' marks only the system prompt.
  if (caching === 'system') ({ system } = addCacheBreakpoints({ system, context, messages: [] }));
  else if (caching) ({ system, tools, messages } = addCacheBreakpoints({ system, context, tools, messages }));
  else if (context) system = [...(system ? [{ type: 'text', text: system }] : []), { type: 'text', text: context }];
  const body = { model, max_tokens: maxTokens, system, messages, stream };
  if (temperature !== undefined && getModel(model)?.supportsTemperature !== false) body.temperature = temperature;
  if (tools?.length) body.tools = tools; // Phase 04: the tools the model may ask us to run
  Object.assign(body, thinkingParams(model, { thinking, effort, maxTokens })); // Phase 18

  if (fallbacks) {
    // If the model declines a request, the API retries it on a suitable fallback model.
    headers['anthropic-beta'] = FALLBACK_BETA;
    body.fallbacks = 'default';
  }

  return { url: `${baseUrl}/v1/messages`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

/** Older models set thinking with a token budget; current ones think adaptively and take an `effort`. */
const BUDGET_THINKING_MODELS = /^claude-(haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0|3)/;

/**
 * Phase 18: the request fields for thinking and effort.
 *   thinking: "summarized" → show a summary of the reasoning; anything else → the API default (thinking, not shown)
 *   effort: "low" | "medium" | "high" | "xhigh" | "max" → output_config.effort (current models only)
 * (Current models can't switch thinking off, and reject the old `budget_tokens` form, so we never send those.)
 */
export function thinkingParams(model = '', { thinking, effort, maxTokens = 16000 } = {}) {
  const params = {};
  const budgetStyle = BUDGET_THINKING_MODELS.test(model);
  if (thinking === 'summarized') {
    params.thinking = budgetStyle
      ? { type: 'enabled', budget_tokens: Math.max(1024, Math.min(8000, maxTokens - 4000)) } // must stay below max_tokens
      : { type: 'adaptive', display: 'summarized' };
  }
  if (effort && !budgetStyle) params.output_config = { effort };
  return params;
}

/**
 * Create a provider: an object with a `stream(request)` method that yields
 * events (see events.js), ending with { type: 'message', message }.
 * Apps only know about this shape, so fake providers can stand in.
 *
 * `fallbacks`, `thinking` and `effort` set here are defaults: a request can
 * override them (e.g. a different effort per model).
 *
 * Sign in with an API key (x-api-key), or else an OAuth-style bearer `authToken`.
 *
 * @param {{ apiKey?: string, authToken?: string, baseUrl?: string, fallbacks?: boolean, caching?: boolean | 'system', thinking?: string, effort?: string,
 *           fetchImpl?: typeof fetch, onExchange?: (request: object, response: object) => void }} options
 */
export function createAnthropicProvider({ apiKey, authToken, baseUrl = BASE_URL, fallbacks = true, caching = true, thinking, effort, fetchImpl = fetch, onExchange }) {
  return {
    name: 'anthropic',

    async *stream(request, { signal } = {}) {
      const { model, system, context, messages, tools, maxTokens, temperature } = request;
      const options = { fallbacks, thinking, effort, ...defined({ fallbacks: request.fallbacks, thinking: request.thinking, effort: request.effort }) };
      const { url, init } = buildRequest({ apiKey, authToken, baseUrl, caching, model, system, context, messages, tools, maxTokens, temperature, ...options });
      const response = await fetchImpl(url, { ...init, signal });

      if (!response.ok) {
        // Errors are still plain JSON: { type: 'error', error: { type, message } }
        const json = await response.json().catch(() => ({}));
        onExchange?.(JSON.parse(init.body), json);
        throw new ApiError(response.status, json.error?.type ?? 'unknown_error', json.error?.message ?? response.statusText, {
          retryAfterMs: retryAfterMs(response),
        });
      }

      const message = yield* assembleMessage(parseSSE(response.body));
      onExchange?.(JSON.parse(init.body), message);
      yield { type: EVENT.MESSAGE, message };
    },

    /** The models this API key can use, straight from the API. */
    async listModels() {
      const response = await fetchImpl(`${baseUrl}/v1/models?limit=100`, {
        headers: { ...authHeaders({ apiKey, authToken }), 'anthropic-version': API_VERSION },
      });
      const json = await response.json();
      if (!response.ok) throw new ApiError(response.status, json.error?.type, json.error?.message ?? response.statusText);
      return json.data.map((model) => model.id);
    },
  };
}

/**
 * Read raw SSE events, yield text as it arrives, and return the complete message.
 *
 * The event order for one reply is:
 *   message_start          → the message shell: id, model, input token usage
 *   content_block_start    → a new block begins (text, thinking, tool_use…)
 *   content_block_delta ×N → pieces of that block
 *   content_block_stop     → the block is finished
 *   (more blocks…)
 *   message_delta          → stop_reason and final output token count
 *   message_stop           → done
 * plus `ping` keep-alives, and `error` if something breaks mid-stream.
 */
export async function* assembleMessage(sseEvents) {
  let message = { content: [], usage: {}, stop_reason: null };
  const partialJson = new Map(); // block index → tool input JSON text received so far (used from Phase 04)

  for await (const { data } of sseEvents) {
    switch (data.type) {
      case 'message_start':
        message = { ...data.message, content: [] };
        yield { type: EVENT.MESSAGE_START, model: message.model, usage: message.usage };
        break;

      case 'content_block_start':
        message.content[data.index] = { ...data.content_block };
        break;

      case 'content_block_delta': {
        const block = message.content[data.index];
        const delta = data.delta;
        if (delta.type === 'text_delta') {
          block.text += delta.text;
          yield { type: EVENT.TEXT_DELTA, text: delta.text };
        } else if (delta.type === 'thinking_delta') {
          block.thinking = (block.thinking ?? '') + delta.thinking;
          yield { type: EVENT.THINKING_DELTA, text: delta.thinking }; // Phase 18: shown dim in the UI
        } else if (delta.type === 'signature_delta') {
          block.signature = (block.signature ?? '') + delta.signature;
        } else if (delta.type === 'input_json_delta') {
          partialJson.set(data.index, (partialJson.get(data.index) ?? '') + delta.partial_json);
        }
        break;
      }

      case 'content_block_stop':
        // A tool's input arrives as pieces of JSON text. Only now is it complete enough to parse.
        if (partialJson.has(data.index)) {
          message.content[data.index].input = parseToolInput(partialJson.get(data.index));
        }
        break;

      case 'message_delta':
        Object.assign(message, data.delta); // stop_reason, stop_details…
        message.usage = { ...message.usage, ...data.usage };
        break;

      case 'error':
        // e.g. the API became overloaded halfway through the reply
        throw new ApiError(0, data.error?.type ?? 'unknown_error', data.error?.message ?? 'Stream error');

      // 'ping' and 'message_stop' need no action
    }
  }

  message.content = message.content.filter(Boolean);
  return message;
}

/** Parse streamed tool input. If the reply was cut off mid-JSON, return {} (the loop won't run it anyway). */
function parseToolInput(json) {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** The fields of `object` that aren't undefined, so a request only overrides what it sets. */
function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/** An API key goes in x-api-key; without one, a bearer token goes in Authorization. */
function authHeaders({ apiKey, authToken }) {
  return apiKey || !authToken ? { 'x-api-key': apiKey } : { authorization: `Bearer ${authToken}` };
}
