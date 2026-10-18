// Model routing (tech.md §6, Platform · Settings · Models): which model does which kind of work. Features ask for a
// work type ('spec-drafting'), never a model id; the route names the model, its fallback and the cloud provider.
// Governance: models only through Bedrock, Vertex AI or Azure. The direct Anthropic API is for development only.
import { HttpError } from '../../util/errors.js';
import { MODELS, getModel } from 'nooblyjs-ai-common/models';

const FILE = ['platform', 'model-routes.yaml'];
export const CLOUD_PROVIDERS = ['bedrock', 'vertex', 'azure'];
export const DEV_PROVIDERS = ['anthropic'];
export const PROVIDER_TEXT = { bedrock: 'AWS Bedrock', vertex: 'Google Vertex AI', azure: 'Azure', anthropic: 'Anthropic API (development only)' };
const TIER = { 'claude-opus': '$$$', 'claude-sonnet': '$$', 'claude-haiku': '$' };

/** The Claude models a route may name, for the Settings picker. */
export const claudeModels = () => MODELS.filter((m) => m.id.startsWith('claude-') && m.pricing)
  .map((m) => ({ id: m.id, label: `Claude ${m.label}`, tier: tierOf(m.id) }));

export const tierOf = (id) => Object.entries(TIER).find(([p]) => String(id).startsWith(p))?.[1] ?? '$$';
const labelOf = (id) => (id ? `Claude ${getModel(id)?.label ?? id}` : null);

export function createRoutes({ files, production }) {
  async function list() {
    const doc = (await files.yaml(FILE)) ?? {};
    return (doc.routes ?? []).map((r) => ({
      id: r.id,
      label: r.label ?? r.id,
      systems: r.systems ?? [],
      workTypes: r.workTypes ?? [],
      model: r.model,
      modelLabel: labelOf(r.model),
      fallback: r.fallback ?? null,
      fallbackLabel: labelOf(r.fallback),
      provider: r.provider ?? 'bedrock',
      providerText: PROVIDER_TEXT[r.provider ?? 'bedrock'] ?? r.provider,
      tier: tierOf(r.model),
    }));
  }

  /** The route for a work type, or null (the teammate's own model is used, as before routing). */
  async function forWorkType(workType) {
    return (await list()).find((r) => r.workTypes.includes(workType)) ?? null;
  }

  /** Whether a provider may be used here: the cloud providers always, the direct API only outside production. */
  const allowed = (provider) => CLOUD_PROVIDERS.includes(provider) || (!production && DEV_PROVIDERS.includes(provider));

  /** Changes a route's model, fallback or provider. Returns { before, after }. */
  async function update(id, patch) {
    let before;
    let after;
    await files.updateYaml(FILE, (doc) => {
      const routes = doc?.routes ?? [];
      const route = routes.find((r) => r.id === id);
      if (!route) throw new HttpError(404, 'route_not_found', `No model route "${id}".`);
      before = { model: route.model, fallback: route.fallback ?? null, provider: route.provider };
      if (patch.model !== undefined) route.model = checkModel(patch.model, 'model');
      if (patch.fallback !== undefined) route.fallback = patch.fallback === null || patch.fallback === '' ? null : checkModel(patch.fallback, 'fallback');
      if (patch.provider !== undefined) {
        if (![...CLOUD_PROVIDERS, ...DEV_PROVIDERS].includes(patch.provider)) {
          throw new HttpError(400, 'invalid_provider', `The provider is one of ${CLOUD_PROVIDERS.join(', ')}.`);
        }
        if (!allowed(patch.provider)) {
          throw new HttpError(422, 'provider_not_allowed', 'The direct Anthropic API is for development only. In production a route uses Bedrock, Vertex AI or Azure.');
        }
        route.provider = patch.provider;
      }
      if (route.fallback && route.fallback === route.model) throw new HttpError(422, 'invalid_fallback', 'The fallback must be a different model.');
      after = { model: route.model, fallback: route.fallback ?? null, provider: route.provider };
      return { ...doc, routes };
    });
    return { before, after };
  }

  return { list, forWorkType, update, allowed };
}

function checkModel(id, field) {
  if (typeof id !== 'string' || !claudeModels().some((m) => m.id === id)) {
    throw new HttpError(400, 'invalid_model', `The ${field} is one of: ${claudeModels().map((m) => m.id).join(', ')}.`);
  }
  return id;
}
