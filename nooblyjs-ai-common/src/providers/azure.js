// @ts-check
// Claude through Azure (Microsoft Foundry). Foundry serves Claude with the Anthropic Messages API itself, at the
// resource's /anthropic address with the resource's key, so this is anthropic.js pointed there, without the
// server-side fallbacks beta (an Anthropic API feature).
//
//   AZURE_AI_ENDPOINT   e.g. https://<resource>.services.ai.azure.com/anthropic   [CONFIRM when a resource exists]
//   AZURE_AI_API_KEY    the resource's key
//
// The model is the deployment's name; by default the catalogue id (a deployment named after its model).
import { createAnthropicProvider } from './anthropic.js';
import { cloudModelId } from '../models.js';

/**
 * @param {{ env?: Record<string, string | undefined>, endpoint?: string, apiKey?: string, caching?: boolean | 'system',
 *           thinking?: string, effort?: string, fetchImpl?: typeof fetch, onExchange?: (request: object, response: object) => void }} [options]
 */
export function createAzureProvider({ env = process.env, endpoint = env.AZURE_AI_ENDPOINT, apiKey = env.AZURE_AI_API_KEY, ...options } = {}) {
  if (!endpoint) throw new Error('No Azure endpoint. Set AZURE_AI_ENDPOINT (https://<resource>.services.ai.azure.com/anthropic).');
  if (!apiKey) throw new Error('No Azure key. Set AZURE_AI_API_KEY.');
  const inner = createAnthropicProvider({ ...options, apiKey, baseUrl: endpoint.replace(/\/+$/, '').replace(/\/v1\/messages$/, ''), fallbacks: false });
  return {
    name: 'azure',
    /** @param {any} request @param {{ signal?: AbortSignal }} [o] */
    stream: (request, o) => inner.stream({ ...request, model: cloudModelId('azure', request.model, env) }, o),
  };
}
