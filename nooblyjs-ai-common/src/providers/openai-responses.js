// Talk to OpenAI through its RESPONSES API (POST /v1/responses).
// Moved here from the harness's providers/openai-responses.js.
//
// Why a second OpenAI adapter? Newer OpenAI models (e.g. gpt-6-astra) reason
// before answering, and OpenAI only allows reasoning TOGETHER WITH function
// tools on /v1/responses. On the older /v1/chat/completions every noobly
// request (which always has tools) failed with:
//   "Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions."
// Chat Completions stays in openai-compatible.js for Grok, Ollama and other
// "OpenAI-compatible" servers, which often don't have /responses.
//
// Same idea as before: translate at the edge, so nothing else changes.
//
//   Anthropic (our history)                     Responses API
//   ────────────────────────────────────────    ──────────────────────────────────────────────
//   system: "..."                               instructions: "..."
//   { role, content: "text" }                   { role, content: "text" }        (an input "message")
//   assistant [{ type: "tool_use", id,           { type: "function_call", call_id, name,
//     name, input: {...} }]                        arguments: "<JSON string>" }  (its own input item)
//   user [{ type: "tool_result",                { type: "function_call_output", call_id, output }
//     tool_use_id, content }]
//   tools: [{ name, description, input_schema }] tools: [{ type: "function", name, description, parameters }]
//
// Streamed events we use:
//   response.created                          → message_start
//   response.output_text.delta { delta }      → text_delta
//   response.output_item.added { item }       a function_call begins: { id, call_id, name }
//   response.function_call_arguments.delta { item_id, delta }   its JSON arguments, in pieces
//   response.output_item.done { item }        the finished item (complete arguments)
//   response.completed / .incomplete          the end: status, incomplete_details, usage
//   response.failed / error                   something broke
//
// The model's own reasoning items are not sent back (we don't ask OpenAI to
// store them, `store: false`), so each request reasons afresh from the visible
// conversation. Simpler, and it works with switching providers mid-chat.
import { dataUrl, imagesIn } from './images.js';
import { EVENT } from './events.js';
import { ApiError, retryAfterMs } from '../errors.js';
import { createOpenAICompatibleProvider, describeError } from './openai-compatible.js';
import { getModel } from '../models.js';
import { parseSSE } from '../sse.js';

// ── Request translation ─────────────────────────────────────────────────

/** Our (Anthropic-shaped) history → Responses API `input` items. */
export function toResponsesInput(messages) {
  const input = [];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      input.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (text) input.push({ role: 'assistant', content: text });
      for (const block of message.content.filter((b) => b.type === 'tool_use')) {
        input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
      }
      // Other block types (Anthropic thinking, fallback markers) have no OpenAI equivalent: dropped.
      continue;
    }
    // A user message: tool results first (they answer the calls just before), then any text.
    for (const block of message.content.filter((b) => b.type === 'tool_result')) {
      input.push({ type: 'function_call_output', call_id: block.tool_use_id, output: resultText(block) });
    }
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    // Phase 28: images (yours, or from a tool like Read) follow as input_image parts of a user message.
    const images = imagesIn(message.content);
    if (images.length) {
      input.push({ role: 'user', content: [{ type: 'input_text', text: text || '(Images from the tool results above.)' }, ...images.map((img) => ({ type: 'input_image', image_url: dataUrl(img) }))] });
    } else if (text) input.push({ role: 'user', content: text });
  }
  return input;
}

function resultText(block) {
  const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((b) => b.text ?? '').join('');
  return block.is_error ? `Error: ${text}` : text;
}

/** Our tool list → Responses function tools (flatter than Chat Completions: no nested `function`). */
export function toResponsesTools(tools = []) {
  return tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema }));
}

// OpenAI's reasoning.effort values. Our `effort` setting also allows Anthropic's "xhigh" and "max": those aren't sent.
const OPENAI_EFFORTS = new Set(['minimal', 'low', 'medium', 'high']);

/**
 * `context` is volatile system text (e.g. memory): it's added to the instructions.
 * `temperature` is only sent to models that accept one (reasoning models don't).
 */
export function buildResponsesRequest({ baseUrl, apiKey, model, system, context, messages, tools, maxTokens, temperature, effort }) {
  const body = {
    model,
    input: toResponsesInput(messages),
    stream: true,
    store: false, // don't keep the conversation on OpenAI's side: we send the history every time anyway
    max_output_tokens: maxTokens,
  };
  const instructions = [system, context].filter(Boolean).join('\n\n');
  if (instructions) body.instructions = instructions;
  if (temperature !== undefined && getModel(model)?.supportsTemperature !== false) body.temperature = temperature;
  if (tools?.length) body.tools = toResponsesTools(tools);
  if (OPENAI_EFFORTS.has(effort)) body.reasoning = { effort };
  return {
    url: `${baseUrl}/responses`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

// ── Response translation ────────────────────────────────────────────────

/** Read Responses API events, yield our events, and return an Anthropic-shaped message. */
export async function* assembleResponse(sseEvents) {
  let text = '';
  const calls = new Map(); // item id → { call_id, name, arguments }
  let final = null;
  let model;
  let started = false;

  const start = function* (fromModel) {
    if (started) return;
    started = true;
    model = fromModel;
    yield { type: EVENT.MESSAGE_START, model, usage: {} };
  };

  for await (const { data } of sseEvents) {
    if (!data || typeof data !== 'object') continue;
    switch (data.type) {
      case 'response.created':
        yield* start(data.response?.model);
        break;
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        yield* start(model);
        text += data.delta;
        yield { type: EVENT.TEXT_DELTA, text: data.delta };
        break;
      case 'response.output_item.added':
        if (data.item?.type === 'function_call') {
          calls.set(data.item.id, { call_id: data.item.call_id, name: data.item.name, arguments: data.item.arguments ?? '' });
        }
        break;
      case 'response.function_call_arguments.delta': {
        const call = calls.get(data.item_id);
        if (call) call.arguments += data.delta;
        break;
      }
      case 'response.output_item.done':
        if (data.item?.type === 'function_call') {
          // The finished item has the complete arguments: trust it over the pieces.
          calls.set(data.item.id, { call_id: data.item.call_id, name: data.item.name, arguments: data.item.arguments ?? calls.get(data.item.id)?.arguments ?? '' });
        }
        break;
      case 'response.completed':
      case 'response.incomplete':
        final = data.response;
        break;
      case 'response.failed': {
        const error = data.response?.error ?? {};
        throw new ApiError(0, error.code ?? 'api_error', error.message ?? 'The response failed');
      }
      case 'error':
        throw new ApiError(0, data.code ?? data.error?.code ?? 'api_error', data.message ?? data.error?.message ?? 'Stream error');
    }
  }

  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const call of calls.values()) content.push({ type: 'tool_use', id: call.call_id, name: call.name, input: parseArguments(call.arguments) });

  return {
    model: final?.model ?? model,
    content,
    stop_reason: stopReason(final, calls.size > 0),
    usage: toAnthropicUsage(final?.usage),
  };
}

function stopReason(response, hasCalls) {
  if (response?.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    return reason === 'content_filter' ? 'refusal' : 'max_tokens'; // "max_output_tokens"
  }
  return hasCalls ? 'tool_use' : 'end_turn';
}

function toAnthropicUsage(usage = {}) {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: (usage.input_tokens ?? 0) - cached,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: cached,
  };
}

function parseArguments(json) {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {}; // cut off mid-JSON; the loop won't run it (stop_reason will be max_tokens)
  }
}

// ── The provider ────────────────────────────────────────────────────────

/**
 * `effort` set here is a default: a request can override it.
 * @param {{ name: string, baseUrl: string, apiKey: string, effort?: string, fetchImpl?: typeof fetch,
 *           onExchange?: (request: object, response: object) => void }} options
 */
export function createOpenAIResponsesProvider({ name, baseUrl, apiKey, effort, fetchImpl = fetch, onExchange }) {
  // Listing models works the same on both APIs, so reuse it.
  const { listModels } = createOpenAICompatibleProvider({ name, baseUrl, apiKey, fetchImpl });
  return {
    name,
    listModels,

    async *stream({ model, system, context, messages, tools, maxTokens, temperature, effort: requested }, { signal } = {}) {
      const { url, init } = buildResponsesRequest({ baseUrl, apiKey, model, system, context, messages, tools, maxTokens, temperature, effort: requested ?? effort });
      const response = await fetchImpl(url, { ...init, signal });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        onExchange?.(JSON.parse(init.body), json);
        throw new ApiError(response.status, ...describeError(json, response), { retryAfterMs: retryAfterMs(response) });
      }

      const message = yield* assembleResponse(parseSSE(response.body));
      onExchange?.(JSON.parse(init.body), message);
      yield { type: EVENT.MESSAGE, message };
    },
  };
}
