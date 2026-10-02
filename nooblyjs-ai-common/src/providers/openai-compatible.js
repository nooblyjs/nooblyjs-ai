// Talk to OpenAI, xAI (Grok), Gemini, DeepSeek, Ollama and other "OpenAI-compatible" APIs.
// Moved here from the harness's providers/openai-compatible.js.
//
// Many providers copy OpenAI's Chat Completions API: POST /chat/completions
// with a `messages` array. It's close to Anthropic's Messages API, but not the
// same. This adapter TRANSLATES at the edge:
//
//   our history (Anthropic shape) ──► OpenAI shape ──► the API
//   the API's streamed chunks ──► our events + an Anthropic-shaped message
//
// So the Session, the agent loop, the tools and the UI don't change at all.
// That is the payoff of having ONE internal message format.
//
// The main differences it handles:
//
//   Anthropic                               OpenAI Chat Completions
//   ───────────────────────────────────     ─────────────────────────────────────────────
//   system: "..." (separate field)          { role: "system", content: "..." } first message
//   tools: [{ name, description,            tools: [{ type: "function", function:
//            input_schema }]                         { name, description, parameters } }]
//   assistant content: [{ type: "tool_use",  assistant: { tool_calls: [{ id, type: "function",
//     id, name, input: {...} }]                function: { name, arguments: "<JSON string>" } }] }
//   user content: [{ type: "tool_result",   { role: "tool", tool_call_id, content } one message
//     tool_use_id, content }]                  per result
//   stop_reason: end_turn / tool_use /      finish_reason: stop / tool_calls / length /
//     max_tokens / refusal                    content_filter
//   usage: input_tokens / output_tokens     usage: prompt_tokens / completion_tokens
import { dataUrl, imagesIn } from './images.js';
import { EVENT } from './events.js';
import { ApiError, retryAfterMs } from '../errors.js';
import { getModel } from '../models.js';
import { parseSSE } from '../sse.js';

// ── Request translation ─────────────────────────────────────────────────

/** Our (Anthropic-shaped) system prompt + history → OpenAI `messages`. */
export function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });

  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const toolCalls = message.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      // Other block types (thinking, fallback markers) are Anthropic-only, so they are dropped.
      out.push({ role: 'assistant', content: text || (toolCalls.length ? null : ''), ...(toolCalls.length && { tool_calls: toolCalls }) });
      continue;
    }

    // A user message: tool results become separate "tool" messages, and must
    // come first (straight after the assistant message that asked for them).
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: resultText(block) });
      }
    }
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    // Phase 28: images (yours, or from a tool like Read) can't go in a "tool" message: they follow in a user message.
    const images = imagesIn(message.content);
    if (images.length) {
      out.push({ role: 'user', content: [...(text ? [{ type: 'text', text }] : [{ type: 'text', text: '(Images from the tool results above.)' }]), ...images.map((img) => ({ type: 'image_url', image_url: { url: dataUrl(img) } }))] });
    } else if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

function resultText(block) {
  const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((b) => b.text ?? '').join('');
  return block.is_error ? `Error: ${text}` : text;
}

/** Our tool list (Anthropic shape) → OpenAI function tools. */
export function toOpenAITools(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
}

/**
 * `context` is volatile system text (e.g. memory): it's added to the system message.
 * The max-output field is `max_completion_tokens` unless the model, or else the
 * provider (`tokenParam`), says otherwise; DeepSeek and Gemini want `max_tokens`.
 * `temperature` is only sent to models that accept one.
 */
export function buildOpenAIRequest({ baseUrl, apiKey, model, system, context, messages, tools, maxTokens, temperature, tokenParam = 'max_completion_tokens' }) {
  const known = getModel(model);
  const body = {
    model,
    messages: toOpenAIMessages(context ? [system, context].filter(Boolean).join('\n\n') : system, messages),
    stream: true,
    stream_options: { include_usage: true }, // send token usage in the last chunk
    [known?.tokenParam ?? tokenParam]: maxTokens,
  };
  if (temperature !== undefined && known?.supportsTemperature !== false) body.temperature = temperature;
  if (tools?.length) body.tools = toOpenAITools(tools);

  return {
    url: `${baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

// ── Response translation ────────────────────────────────────────────────

const STOP_REASONS = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

/**
 * Read streamed Chat Completions chunks, yield our events, and return an
 * Anthropic-shaped message. Each chunk looks like:
 *   { model, choices: [{ delta: { content?, tool_calls? }, finish_reason? }], usage? }
 */
export async function* assembleChatCompletion(sseEvents) {
  let text = '';
  const toolCalls = []; // by index: { id, name, arguments (JSON text so far) }
  let finishReason = null;
  let usage = {};
  let model;
  let started = false;

  for await (const { data } of sseEvents) {
    if (data === null) break; // [DONE]
    if (data.error) throw new ApiError(0, data.error.type ?? data.error.code ?? 'api_error', data.error.message ?? 'Stream error');

    if (!started) {
      started = true;
      model = data.model;
      yield { type: EVENT.MESSAGE_START, model, usage: {} };
    }

    const choice = data.choices?.[0];
    const delta = choice?.delta ?? {};
    const piece = delta.content ?? delta.refusal;
    if (piece) {
      text += piece;
      yield { type: EVENT.TEXT_DELTA, text: piece };
    }
    for (const call of delta.tool_calls ?? []) {
      const slot = (toolCalls[call.index ?? 0] ??= { id: '', name: '', arguments: '' });
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.name += call.function.name;
      if (call.function?.arguments) slot.arguments += call.function.arguments;
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (data.usage) usage = toAnthropicUsage(data.usage);
  }

  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const call of toolCalls.filter(Boolean)) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: parseArguments(call.arguments) });
  }

  return {
    model,
    content,
    stop_reason: STOP_REASONS[finishReason] ?? finishReason ?? 'end_turn',
    usage,
  };
}

function toAnthropicUsage(usage) {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: (usage.prompt_tokens ?? 0) - cached,
    output_tokens: usage.completion_tokens ?? 0,
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

/**
 * "Compatible" APIs still differ in their error format:
 *   OpenAI: { error: { message, type, code } }
 *   xAI:    { code: "invalid-argument", error: "Incorrect API key provided…" }
 * @returns {[type: string, message: string]}
 */
export function describeError(json, response) {
  if (typeof json.error === 'string') return [json.code ?? 'api_error', json.error];
  const error = json.error ?? {};
  return [error.type ?? error.code ?? json.code ?? 'unknown_error', error.message ?? json.message ?? response.statusText];
}

// ── The provider ────────────────────────────────────────────────────────

/**
 * @param {{ name: string, baseUrl: string, apiKey: string, tokenParam?: string, fetchImpl?: typeof fetch,
 *           onExchange?: (request: object, response: object) => void }} options
 */
export function createOpenAICompatibleProvider({ name, baseUrl, apiKey, tokenParam, fetchImpl = fetch, onExchange }) {
  return {
    name,

    async *stream({ model, system, context, messages, tools, maxTokens, temperature }, { signal } = {}) {
      const { url, init } = buildOpenAIRequest({ baseUrl, apiKey, model, system, context, messages, tools, maxTokens, temperature, tokenParam });
      const response = await fetchImpl(url, { ...init, signal });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        onExchange?.(JSON.parse(init.body), json);
        throw new ApiError(response.status, ...describeError(json, response), { retryAfterMs: retryAfterMs(response) });
      }

      const message = yield* assembleChatCompletion(parseSSE(response.body));
      onExchange?.(JSON.parse(init.body), message);
      yield { type: EVENT.MESSAGE, message };
    },

    /** The models this API key can use, straight from GET /models (non-chat models filtered out). */
    async listModels() {
      const response = await fetchImpl(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
      const json = await response.json();
      if (!response.ok) throw new ApiError(response.status, ...describeError(json, response));
      const notChat = /embed|tts|whisper|dall-e|image|audio|realtime|moderation|transcribe|sora|video/i;
      return json.data.map((model) => model.id).filter((id) => !notChat.test(id)).sort();
    },
  };
}
