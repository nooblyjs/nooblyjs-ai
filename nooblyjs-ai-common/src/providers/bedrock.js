// @ts-check
// Claude through AWS Bedrock (governance: models only via Bedrock, Vertex AI or Azure). Same request and reply
// shapes as the Anthropic API: the body is the Messages API body without `model` and `stream`, plus
// anthropic_version; the reply is AWS event-stream frames, each carrying one Anthropic stream event (base64 JSON).
//
//   POST https://bedrock-runtime.<region>.amazonaws.com/model/<model id>/invoke-model-with-response-stream
//   signed with AWS Signature V4 (aws-sigv4.js)
import { EVENT } from './events.js';
import { assembleMessage, buildRequest } from './anthropic.js';
import { awsCredentials, signRequest } from './aws-sigv4.js';
import { parseEventStream } from './aws-eventstream.js';
import { ApiError, retryAfterMs } from '../errors.js';
import { cloudModelId } from '../models.js';

export const BEDROCK_VERSION = 'bedrock-2023-05-31';

// Bedrock's exception names, as the HTTP status they stand for (so retry.js treats them as it treats the others).
const STATUS = {
  throttlingException: 429, serviceUnavailableException: 503, internalServerException: 500, modelNotReadyException: 503,
  validationException: 400, accessDeniedException: 403, resourceNotFoundException: 404, modelTimeoutException: 408,
  modelStreamErrorException: 500, serviceQuotaExceededException: 429,
};

/**
 * Builds the signed HTTP request without sending it, so tests can check what goes over the wire.
 * @param {{ region: string, credentials: { accessKeyId: string, secretAccessKey: string, sessionToken?: string },
 *           modelId: string, request: object, caching?: boolean | 'system', thinking?: string, effort?: string, date?: Date, baseUrl?: string }} o
 */
export function buildBedrockRequest({ region, credentials, modelId, request, caching = true, thinking, effort, date, baseUrl }) {
  const { model, system, context, messages, tools, maxTokens, temperature } = /** @type {any} */ (request);
  const anthropic = buildRequest({ apiKey: 'unused', model, system, context, messages, tools, maxTokens, temperature, caching, thinking, effort, fallbacks: false });
  const { model: _model, stream: _stream, ...rest } = JSON.parse(anthropic.init.body);
  const body = JSON.stringify({ anthropic_version: BEDROCK_VERSION, ...rest });
  const host = baseUrl ?? `https://bedrock-runtime.${region}.amazonaws.com`;
  const url = `${host}/model/${encodeURIComponent(modelId)}/invoke-model-with-response-stream`;
  const headers = signRequest({
    method: 'POST', url, body, region, service: 'bedrock', credentials, date,
    headers: { 'content-type': 'application/json', accept: 'application/vnd.amazon.eventstream' },
  });
  delete /** @type {Record<string, string | undefined>} */ (headers).host; // fetch sets it
  return { url, init: { method: 'POST', headers, body } };
}

/**
 * @param {{ region?: string, credentials?: { accessKeyId: string, secretAccessKey: string, sessionToken?: string },
 *           env?: Record<string, string | undefined>, caching?: boolean | 'system', thinking?: string, effort?: string,
 *           baseUrl?: string, fetchImpl?: typeof fetch, now?: () => Date }} [options]
 */
export function createBedrockProvider({ env = process.env, region = env.AWS_REGION || env.AWS_DEFAULT_REGION, credentials = awsCredentials(env) ?? undefined, caching = true, thinking, effort, baseUrl, fetchImpl = fetch, now = () => new Date() } = {}) {
  if (!region) throw new Error('No AWS region for Bedrock. Set AWS_REGION.');
  if (!credentials) throw new Error('No AWS credentials for Bedrock. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN for temporary credentials).');
  return {
    name: 'bedrock',
    /** @param {any} request @param {{ signal?: AbortSignal }} [options] */
    async *stream(request, { signal } = {}) {
      const modelId = cloudModelId('bedrock', request.model, env);
      const { url, init } = buildBedrockRequest({
        region, credentials, modelId, request, caching, baseUrl, date: now(),
        thinking: request.thinking ?? thinking, effort: request.effort ?? effort,
      });
      const response = await fetchImpl(url, { ...init, signal });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        const type = String(response.headers.get('x-amzn-errortype') ?? json.__type ?? 'unknown_error').split(':')[0];
        throw new ApiError(response.status, type, json.message ?? json.Message ?? response.statusText, { retryAfterMs: retryAfterMs(response) });
      }
      const message = yield* assembleMessage(anthropicEvents(parseEventStream(/** @type {any} */ (response.body))));
      if (!message.model) message.model = request.model;
      yield { type: EVENT.MESSAGE, message };
    },
  };
}

/**
 * Bedrock frames → the { data } events assembleMessage reads. An exception frame is an ApiError.
 * @param {AsyncIterable<{ headers: Record<string, any>, payload: Uint8Array }>} frames
 */
async function* anthropicEvents(frames) {
  for await (const { headers, payload } of frames) {
    const text = Buffer.from(payload).toString('utf8');
    if (headers[':message-type'] === 'exception' || headers[':message-type'] === 'error') {
      const type = String(headers[':exception-type'] ?? headers[':error-code'] ?? 'unknown_error');
      const detail = safeJson(text)?.message ?? headers[':error-message'] ?? text;
      throw new ApiError(/** @type {Record<string, number>} */ (STATUS)[type] ?? 0, type, detail);
    }
    if (headers[':event-type'] !== 'chunk') continue;
    const bytes = safeJson(text)?.bytes;
    if (!bytes) continue;
    const data = JSON.parse(Buffer.from(bytes, 'base64').toString('utf8'));
    yield { event: data.type, data };
  }
}

/** @param {string} text */
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
