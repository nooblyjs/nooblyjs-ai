'use strict';

// Every provider adapter, built on nooblyjs-ai-common's provider layer. Common
// talks to each API over plain HTTP and translates its streamed reply into one
// shape; this file turns that into the contract in types.js. No vendor SDKs.
//
// Each provider's address can be moved with <ID>_BASE_URL (e.g. DEEPSEEK_BASE_URL),
// for a gateway or a local fake in tests.

const { EVENT, PROVIDERS, createProvider, explainError, normalizeUsage, withRetry } = require('nooblyjs-ai-common');
const catalogue = require('../config/models');

/**
 * @param {object} options
 * @param {string} options.id      a provider in common's catalogue
 * @param {string} options.label
 * @param {string} [options.api]   force an API style, e.g. 'openai-chat' for OpenAI
 * @param {number} [options.maxRetries]  retries for a temporary failure before anything streamed
 */
function createAdapter({ id, label, api, maxRetries = 2 }) {
  const apiKeyEnvVar = PROVIDERS[id].envKeys[0];

  // Built on first use, once the environment (and a test's fake base URL) is set.
  let provider = null;
  function getProvider() {
    if (!provider) {
      provider = createProvider(id, {
        api,
        apiKey: process.env[apiKeyEnvVar],
        // Anthropic's server-side fallback retries a declined request on another model.
        // The app shows which model answered, so keep it to the one the user chose.
        fallbacks: false
      });
    }
    return provider;
  }

  async function* streamCompletion({ system, messages, model, temperature, maxOutputTokens, signal }) {
    const request = { model, system, messages, temperature, maxTokens: maxOutputTokens };
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finishReason = 'end_turn';

    try {
      const events = withRetry(() => getProvider().stream(request, { signal }), { maxRetries, signal });
      for await (const event of events) {
        if (event.type === EVENT.TEXT_DELTA) {
          yield { type: 'delta', text: event.text };
        } else if (event.type === EVENT.MESSAGE) {
          const used = normalizeUsage(event.message.usage);
          // Input counts every prompt token, whether or not the provider's cache served it.
          usage = {
            inputTokens: used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens,
            outputTokens: used.output_tokens
          };
          finishReason = event.message.stop_reason || finishReason;
        }
      }
    } catch (err) {
      // Normalises whatever went wrong into one vocabulary, so the route and the UI
      // never branch on vendor-specific errors. Null means it was an abort: a clean end.
      const explained = explainError(err, label, signal);
      if (!explained) return;
      const message =
        explained.status === 401 || explained.status === 403
          ? `${label}: API key rejected. Check the key in your .env file.`
          : explained.message;
      yield { type: 'error', error: { code: 'PROVIDER_FAILED', message, retryable: explained.retryable } };
      return;
    }

    yield { type: 'done', usage, finishReason };
  }

  return {
    id,
    label,
    api,
    apiKeyEnvVar,
    isConfigured: () => Boolean(process.env[apiKeyEnvVar]),
    listModels: () => catalogue[id],
    streamCompletion
  };
}

module.exports = { createAdapter };
