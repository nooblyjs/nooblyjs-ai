'use strict';

// A fake adapter for local development and tests. It echoes back the system
// prompt it received, which makes it easy to confirm the project description is
// actually reaching the model. Never registered by the real server.

function makeMockProvider({ id = 'mock', label = 'Mock (dev)', delayMs = 18, failWith = null } = {}) {
  return {
    id,
    label,
    apiKeyEnvVar: 'MOCK_API_KEY',
    isConfigured: () => true,
    listModels: () => [
      { id: 'mock-large', label: 'Mock Large', contextWindow: 200000 },
      { id: 'mock-small', label: 'Mock Small', contextWindow: 8000 }
    ],
    async *streamCompletion({ system, messages, model, signal }) {
      if (failWith) {
        yield { type: 'error', error: { code: 'PROVIDER_FAILED', message: failWith, retryable: false } };
        return;
      }

      const last = messages[messages.length - 1]?.content ?? '';
      const reply =
        `**Mock reply** from \`${model}\`.\n\n` +
        `You asked: _${last}_\n\n` +
        `I received ${messages.length} message(s) of history and this system context:\n\n` +
        '```\n' + system + '\n```\n';

      for (const token of reply.match(/\s*\S+/g) || []) {
        if (signal?.aborted) return;
        await new Promise((r) => setTimeout(r, delayMs));
        yield { type: 'delta', text: token };
      }

      yield {
        type: 'done',
        usage: { inputTokens: Math.ceil(system.length / 4), outputTokens: Math.ceil(reply.length / 4) },
        finishReason: 'end_turn'
      };
    }
  };
}

module.exports = { makeMockProvider };
