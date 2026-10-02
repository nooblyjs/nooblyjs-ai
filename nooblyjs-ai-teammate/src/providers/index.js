import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';

/**
 * Chooses a provider per model. AI_PROVIDER=mock forces offline mode; AI_PROVIDER=anthropic insists on the real API
 * (and fails at startup without credentials). Otherwise the real API is used when ANTHROPIC_API_KEY/AUTH_TOKEN is set.
 */
export function createProviders({ mode = process.env.AI_PROVIDER, mock = new MockProvider() } = {}) {
  const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (mode === 'anthropic' && !hasCredentials) {
    throw new Error('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Set one in .env, or use AI_PROVIDER=mock for offline mode.');
  }
  let anthropic = null;
  return {
    get(model) {
      if (mode === 'mock') return mock;
      if (model.provider === 'anthropic' && hasCredentials) {
        anthropic ??= new AnthropicProvider();
        return anthropic;
      }
      return mock;
    },
    describe() {
      if (mode === 'mock') return 'mock';
      return hasCredentials ? 'anthropic' : 'mock';
    },
  };
}
