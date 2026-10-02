'use strict';

const { ProviderUnavailableError, ValidationError } = require('../lib/errors');

const { createAdapter } = require('./adapter');

const adapters = [
  createAdapter({ id: 'anthropic', label: 'Anthropic Claude' }),
  // Chat Completions rather than the Responses API: it's what OPENAI_BASE_URL gateways support.
  createAdapter({ id: 'openai', label: 'OpenAI', api: 'openai-chat' }),
  // Through Gemini's OpenAI-compatible endpoint.
  createAdapter({ id: 'gemini', label: 'Google Gemini' }),
  createAdapter({ id: 'deepseek', label: 'DeepSeek' })
];

const byId = new Map(adapters.map((a) => [a.id, a]));

function register(adapter) {
  adapters.push(adapter);
  byId.set(adapter.id, adapter);
}

function get(id) {
  return byId.get(id) || null;
}

/** Public view for the UI. Never includes key material — only whether one is present. */
function listAll() {
  return adapters.map((a) => ({
    id: a.id,
    label: a.label,
    apiKeyEnvVar: a.apiKeyEnvVar,
    configured: a.isConfigured(),
    models: a.listModels()
  }));
}

function anyConfigured() {
  return adapters.some((a) => a.isConfigured());
}

function firstConfigured() {
  return adapters.find((a) => a.isConfigured()) || null;
}

/**
 * Resolve a request to a concrete adapter and model.
 * Precedence: explicit request -> project defaults -> global settings -> first configured.
 */
function resolve({ requested = {}, projectDefaults = {}, globalSettings = {} } = {}) {
  const providerId =
    requested.provider || projectDefaults.provider || globalSettings.defaultProvider || firstConfigured()?.id;

  if (!providerId) {
    throw new ProviderUnavailableError(
      'No LLM provider is configured. Add an API key to your .env file and restart.',
      { envVars: adapters.map((a) => a.apiKeyEnvVar) }
    );
  }

  const adapter = get(providerId);
  if (!adapter) throw new ValidationError(`Unknown provider "${providerId}"`, { provider: 'unknown' });

  if (!adapter.isConfigured()) {
    throw new ProviderUnavailableError(
      `${adapter.label} is not configured. Set ${adapter.apiKeyEnvVar} in your .env file and restart.`,
      { provider: adapter.id, envVar: adapter.apiKeyEnvVar }
    );
  }

  const models = adapter.listModels();
  const requestedModel =
    requested.model ||
    (requested.provider ? null : projectDefaults.model) ||
    (requested.provider || projectDefaults.provider ? null : globalSettings.defaultModel);

  // A model from a previous provider, or one since removed from the catalogue,
  // falls back to that provider's first model rather than failing the turn.
  const model = models.find((m) => m.id === requestedModel) || models[0];
  if (!model) {
    throw new ProviderUnavailableError(`${adapter.label} has no models configured.`, { provider: adapter.id });
  }

  return {
    adapter,
    model,
    fellBack: Boolean(requestedModel) && requestedModel !== model.id
  };
}

module.exports = { adapters, register, get, listAll, resolve, anyConfigured, firstConfigured };
