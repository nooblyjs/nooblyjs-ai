import { PROVIDERS } from 'nooblyjs-ai-common/models';
import { findApiKey } from 'nooblyjs-ai-common/providers';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';

// NooblyJS governance (product.md §3): Claude models are served through AWS Bedrock, Google Vertex AI or Azure. A model
// route names its host (NooblyJS Platform · Settings · Models); these are the variables each one needs.
export const CLOUD_HOSTS = {
  bedrock: ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  vertex: ['VERTEX_PROJECT_ID'],
  azure: ['AZURE_AI_ENDPOINT', 'AZURE_AI_API_KEY'],
};
// The other providers nooblyjs-core's AI module speaks (OpenAI, Grok, Gemini, DeepSeek, Ollama): a teammate on one of
// their models is served by it when its key is set (Ollama: its address). Their public APIs are for development only.
const OTHERS = Object.keys(PROVIDERS).filter((id) => !['anthropic', 'echo'].includes(id));
const otherReady = (id, env) => (id === 'ollama' ? Boolean(env.OLLAMA_BASE_URL || env.OLLAMA_ENDPOINT) : Boolean(findApiKey(id, env)));

const cloudReady = (host, env) => CLOUD_HOSTS[host].every((k) => env[k])
  && (host !== 'vertex' || Boolean(env.GOOGLE_APPLICATION_CREDENTIALS || env.GOOGLE_ACCESS_TOKEN));

/**
 * Chooses a provider per model. AI_PROVIDER=mock forces offline mode; AI_PROVIDER=anthropic insists on the real API
 * (and fails at startup without credentials); AI_PROVIDER=bedrock|vertex|azure insists on that host's credentials.
 *
 * A model on a cloud host (a route from NooblyJS Platform) uses that host when its credentials are set. Until they are,
 * development uses the Anthropic API when its key is set, and otherwise the offline mock.
 *
 * The Anthropic API is a direct consumer API, which NooblyJS allows in development only (NooblyJS tech.md §6): in
 * production it is refused at start, whether it was asked for or would be picked up from the credentials.
 */
export function createProviders({ mode = process.env.AI_PROVIDER, mock = new MockProvider(), env = process.env } = {}) {
  const hasCredentials = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const production = env.NODE_ENV === 'production';
  if (production && (mode === 'anthropic' || (mode !== 'mock' && hasCredentials))) {
    throw new Error('The Anthropic API is for development only and is refused when NODE_ENV=production. Models in production go through AWS Bedrock, Google Vertex AI or Azure. Remove the ANTHROPIC_* credentials, or set AI_PROVIDER=mock.');
  }
  if (mode === 'anthropic' && !hasCredentials) {
    throw new Error('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Set one in .env, or use AI_PROVIDER=mock for offline mode.');
  }
  if (CLOUD_HOSTS[mode] && !cloudReady(mode, env)) {
    throw new Error(`AI_PROVIDER=${mode} needs ${CLOUD_HOSTS[mode].join(', ')}${mode === 'vertex' ? ' and GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_ACCESS_TOKEN' : ''}.`);
  }
  let anthropic = null;
  const cloud = {};
  const others = {};
  const direct = () => (anthropic ??= new AnthropicProvider({ env }));
  const host = (h) => (cloud[h] ??= new AnthropicProvider({ host: h, env }));
  return {
    get(model) {
      if (mode === 'mock') return mock;
      if (CLOUD_HOSTS[model.provider]) {
        if (cloudReady(model.provider, env)) return host(model.provider);
        return !production && hasCredentials ? direct() : mock;
      }
      // A model from another provider (offered in Settings · Models & pricing): that provider's API, else the mock.
      if (OTHERS.includes(model.provider)) {
        if (production && model.provider !== 'ollama') {
          throw Object.assign(new Error(`${PROVIDERS[model.provider].label}'s public API is for development only and is refused when NODE_ENV=production.`), { status: 422, code: 'provider_not_allowed' });
        }
        if (!otherReady(model.provider, env)) return mock;
        // ollama's address: OLLAMA_ENDPOINT is how this workspace names it.
        const baseUrl = model.provider === 'ollama' && !env.OLLAMA_BASE_URL && env.OLLAMA_ENDPOINT ? `${String(env.OLLAMA_ENDPOINT).replace(/\/+$/, '').replace(/\/v1$/, '')}/v1` : undefined;
        return (others[model.provider] ??= new AnthropicProvider({ host: model.provider, env, ...(baseUrl ? { baseUrl } : {}) }));
      }
      // A teammate's own model (models.md): the host AI_PROVIDER names, else the Anthropic API, else the mock.
      if (CLOUD_HOSTS[mode]) return host(mode);
      if (model.provider === 'anthropic' && hasCredentials) return direct();
      return mock;
    },
    describe() {
      if (mode === 'mock') return 'mock';
      if (CLOUD_HOSTS[mode]) return mode;
      const ready = Object.keys(CLOUD_HOSTS).find((h) => cloudReady(h, env));
      return ready ?? (hasCredentials ? 'anthropic' : 'mock');
    },
  };
}
