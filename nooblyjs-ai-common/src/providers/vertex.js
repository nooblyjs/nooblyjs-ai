// @ts-check
// Claude through Google Vertex AI. The body is the Messages API body without `model`, plus anthropic_version; the
// reply is the Anthropic API's own SSE stream, so it is read exactly as anthropic.js reads it.
//
//   POST https://<region>-aiplatform.googleapis.com/v1/projects/<project>/locations/<region>/publishers/anthropic/models/<model>:streamRawPredict
//   (region "global": https://aiplatform.googleapis.com/…), with a Google access token (google-auth.js)
import { EVENT } from './events.js';
import { assembleMessage, buildRequest } from './anthropic.js';
import { createGoogleAuth } from './google-auth.js';
import { ApiError, retryAfterMs } from '../errors.js';
import { cloudModelId } from '../models.js';
import { parseSSE } from '../sse.js';

export const VERTEX_VERSION = 'vertex-2023-10-16';

/**
 * The streamRawPredict address for a model.
 * @param {{ project: string, region: string, modelId: string, baseUrl?: string }} o
 */
export function vertexUrl({ project, region, modelId, baseUrl }) {
  const host = baseUrl ?? (region === 'global' ? 'https://aiplatform.googleapis.com' : `https://${region}-aiplatform.googleapis.com`);
  return `${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/anthropic/models/${encodeURIComponent(modelId)}:streamRawPredict`;
}

/**
 * The HTTP request without sending it.
 * @param {{ project: string, region: string, modelId: string, token: string, request: any, caching?: boolean | 'system',
 *           thinking?: string, effort?: string, baseUrl?: string }} o
 */
export function buildVertexRequest({ project, region, modelId, token, request, caching = true, thinking, effort, baseUrl }) {
  const { model, system, context, messages, tools, maxTokens, temperature } = request;
  const anthropic = buildRequest({ apiKey: 'unused', model, system, context, messages, tools, maxTokens, temperature, caching, thinking, effort, fallbacks: false });
  const { model: _model, ...rest } = JSON.parse(anthropic.init.body);
  return {
    url: vertexUrl({ project, region, modelId, baseUrl }),
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ anthropic_version: VERTEX_VERSION, ...rest, stream: true }),
    },
  };
}

/**
 * @param {{ env?: Record<string, string | undefined>, project?: string, region?: string,
 *           auth?: { token: () => Promise<string> }, caching?: boolean | 'system', thinking?: string, effort?: string,
 *           baseUrl?: string, fetchImpl?: typeof fetch }} [options]
 */
export function createVertexProvider({ env = process.env, project = env.VERTEX_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT, region = env.VERTEX_REGION || 'global', auth, caching = true, thinking, effort, baseUrl, fetchImpl = fetch } = {}) {
  if (!project) throw new Error('No Google Cloud project for Vertex AI. Set VERTEX_PROJECT_ID.');
  const google = auth ?? createGoogleAuth({ env, fetchImpl });
  if (!auth && !(/** @type {any} */ (google).source)) throw new Error('No Google credentials for Vertex AI. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_ACCESS_TOKEN.');
  return {
    name: 'vertex',
    /** @param {any} request @param {{ signal?: AbortSignal }} [options] */
    async *stream(request, { signal } = {}) {
      const { url, init } = buildVertexRequest({
        project, region, modelId: cloudModelId('vertex', request.model, env), token: await google.token(), request, caching, baseUrl,
        thinking: request.thinking ?? thinking, effort: request.effort ?? effort,
      });
      const response = await fetchImpl(url, { ...init, signal });
      if (!response.ok) {
        // Either the Anthropic error shape or Google's: { error: { code, message, status } }.
        const json = await response.json().catch(() => ({}));
        const error = Array.isArray(json) ? json[0]?.error : json.error;
        throw new ApiError(response.status, error?.type ?? error?.status ?? 'unknown_error', error?.message ?? response.statusText, { retryAfterMs: retryAfterMs(response) });
      }
      const message = yield* assembleMessage(parseSSE(/** @type {any} */ (response.body)));
      if (!message.model) message.model = request.model;
      yield { type: EVENT.MESSAGE, message };
    },
  };
}
