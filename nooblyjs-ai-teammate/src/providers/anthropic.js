// Claude Messages API adapter, on nooblyjs-ai-common's provider layer (plain HTTP, no SDK).
// Streams text deltas and returns normalized usage.
import { complete, createProvider } from 'nooblyjs-ai-common/providers';

export class AnthropicProvider {
  name = 'anthropic';

  /**
   * Signs in with ANTHROPIC_API_KEY, or else ANTHROPIC_AUTH_TOKEN; ANTHROPIC_BASE_URL moves the address.
   * @param {object} [options]  passed to common's createProvider (tests pass `fetchImpl` and `env`)
   */
  constructor(options = {}) {
    // Only the persona is marked for the prompt cache, as before: `context` (memory) changes every
    // task, and caching each task's messages would add a cache-write charge to one-shot work.
    this.provider = createProvider('anthropic', { caching: 'system', ...options });
  }

  /**
   * @param {object} opts
   * @param {object} opts.model     model config from models.md (modelId, maxTokens, effort, fallbacks)
   * @param {string} opts.system    stable system prompt (persona + skills) — cached
   * @param {string} [opts.context] volatile system context (memory) — placed after the cache breakpoint
   * @param {Array}  opts.messages
   * @param {Array}  [opts.tools]   client tool definitions ({ name, description, input_schema }); the caller runs the loop
   */
  async run({ model, system, context, messages, tools, maxTokens, onText, signal }) {
    const reply = await complete(
      this.provider,
      {
        model: model.modelId,
        system,
        context,
        messages,
        tools: tools?.length ? tools : undefined,
        maxTokens: maxTokens ?? model.maxTokens ?? 16000,
        effort: model.effort,
        // Server-side refusal fallback (routes by refusal category), for the models configured to use it.
        fallbacks: Boolean(model.fallbacks),
      },
      { signal, onText },
    );
    return {
      text: reply.text,
      // The full content goes back unchanged in the next request of a tool loop (thinking blocks included).
      content: reply.message.content,
      toolCalls: reply.toolCalls,
      stopReason: reply.stopReason,
      stopDetails: reply.message.stop_details ?? null,
      servedBy: reply.model,
      usage: {
        inputTokens: reply.usage.input_tokens,
        outputTokens: reply.usage.output_tokens,
        cacheReadTokens: reply.usage.cache_read_input_tokens,
        cacheWriteTokens: reply.usage.cache_creation_input_tokens,
      },
    };
  }
}
