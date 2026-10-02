// @ts-check
// Retry temporary failures with exponential backoff.
// Moved here from the harness's providers/retry.js (harness Phase 03).
//
// Some errors are worth trying again: 429 (too many requests), 529 (API
// overloaded), 5xx server errors, and network drops. Others are not: a bad
// API key or a malformed request will fail the same way every time.
//
// We wait longer after each failure: 0.5s, 1s, 2s, 4s… plus a little random
// "jitter" so many clients don't all retry at the same instant. If the server
// sends a `retry-after` header, we wait that long instead.

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const RETRYABLE_TYPES = new Set(['overloaded_error', 'rate_limit_error', 'api_error']);

/** @param {any} error */
export function isRetryable(error) {
  if (error?.name === 'AbortError') return false; // the user cancelled: never retry
  if (error?.name === 'ApiError') return RETRYABLE_STATUS.has(error.status) || RETRYABLE_TYPES.has(error.type);
  return error instanceof TypeError; // fetch throws TypeError('fetch failed') on network problems
}

/**
 * How long to wait before retry number `attempt` (1, 2, 3…).
 * @param {number} attempt
 * @param {{ baseMs?: number, maxMs?: number, retryAfterMs?: number, random?: () => number }} [options]
 */
export function backoffDelay(attempt, { baseMs = 500, maxMs = 20_000, retryAfterMs, random = Math.random } = {}) {
  if (retryAfterMs != null) return Math.min(retryAfterMs, maxMs);
  const exponential = baseMs * 2 ** (attempt - 1);
  const jitter = exponential * 0.25 * random();
  return Math.min(exponential + jitter, maxMs);
}

/**
 * Wait `ms` milliseconds, but stop early (with an AbortError) if `signal` fires.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run a streaming request, retrying if it fails BEFORE anything was received.
 * Once events have started arriving we don't retry: the user has already
 * seen part of the answer, and starting again would repeat it.
 *
 * Yields every event from the stream, plus { type: 'retry', attempt, delayMs, error }
 * before each new attempt so the UI can say what's happening.
 *
 * @param {() => AsyncIterable<object>} makeStream starts a fresh request each call
 * @param {{ maxRetries?: number, signal?: AbortSignal, sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *           baseMs?: number, maxMs?: number, random?: () => number }} [options]
 */
export async function* withRetry(makeStream, { maxRetries = 4, signal, sleepFn = sleep, ...delayOptions } = {}) {
  for (let attempt = 1; ; attempt++) {
    let received = false;
    try {
      for await (const event of makeStream()) {
        received = true;
        yield event;
      }
      return;
    } catch (/** @type {any} */ error) {
      if (received || attempt > maxRetries || !isRetryable(error)) throw error;
      const delayMs = backoffDelay(attempt, { ...delayOptions, retryAfterMs: error.retryAfterMs });
      yield { type: 'retry', attempt, delayMs, error: error.message };
      await sleepFn(delayMs, signal);
    }
  }
}
