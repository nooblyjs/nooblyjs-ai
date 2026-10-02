// @ts-check
// An error returned by a model API, e.g. a bad key (401) or rate limit (429).
// Shared by every provider, so retry.js and the UI treat them all the same way.
// Moved here from the harness's providers/errors.js.
import { isRetryable } from './retry.js';

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} type   the API's error type, e.g. "overloaded_error"
   * @param {string} message
   * @param {{ retryAfterMs?: number }} [options]
   */
  constructor(status, type, message, { retryAfterMs } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Seconds from a `retry-after` header, as milliseconds (or undefined).
 * @param {{ headers: { get(name: string): string | null } }} response
 */
export function retryAfterMs(response) {
  const seconds = Number(response.headers.get('retry-after'));
  return seconds > 0 ? seconds * 1000 : undefined;
}

const NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

/**
 * Whatever a provider threw, as one plain description an app can show:
 * a readable message, the HTTP status (0 if none), and whether trying again
 * might work. Returns null for a cancelled request, which is a clean stop, not
 * a failure. (fetch throws a plain AbortError on abort, so the signal is the
 * surest sign.) Adapted from nooblyjs-ai-desktop's error mapping.
 *
 * @param {any} error
 * @param {string} provider  a label for the message, e.g. "Anthropic"
 * @param {AbortSignal} [signal]
 * @returns {{ message: string, status: number, retryable: boolean } | null}
 */
export function explainError(error, provider, signal) {
  if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return null;

  const status = typeof error?.status === 'number' ? error.status : 0;
  const detail = error?.message || 'Unknown error';
  const retryable = isRetryable(error);
  const network = error?.cause?.code ?? error?.code;

  if (status === 401 || status === 403) return { status, retryable, message: `${provider}: API key rejected. Check the key.` };
  if (status === 404) return { status, retryable, message: `${provider}: model not found or not available to this account.` };
  if (status === 429) return { status, retryable, message: `${provider}: rate limit or quota exceeded. Try again shortly.` };
  if (status === 529 || error?.type === 'overloaded_error') return { status, retryable, message: `${provider}: overloaded. Try again shortly.` };
  if (status >= 500) return { status, retryable, message: `${provider}: upstream service error. Try again shortly.` };
  if (NETWORK_CODES.has(network)) return { status, retryable: true, message: `${provider}: network error (${network}).` };
  if (status === 400) return { status, retryable, message: `${provider}: request rejected — ${detail}` };
  return { status, retryable, message: `${provider}: ${detail}` };
}
