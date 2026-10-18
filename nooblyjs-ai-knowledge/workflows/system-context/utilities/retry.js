/**
 * @fileoverview Timeout + retry helpers shared by the context-build services.
 *
 * Workflow steps run inside an isolated worker thread with no shared cache or
 * AI registry, so every outbound call (HTTP to the running backend, or a prompt
 * to a local/remote AI provider) is a potential hang or transient failure. These
 * helpers give every such call a wall-clock budget and a bounded number of
 * retries with exponential backoff, so a single slow document or a flaky model
 * never wedges the whole bottom-up sweep.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

/**
 * Resolve after `ms` milliseconds. The timer is unref()'d so it never keeps the
 * worker's event loop alive on its own.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t && typeof t.unref === 'function') t.unref();
  });
}

/**
 * Race a promise-producing function against a wall-clock timeout.
 *
 * `factory` is a function (not a promise) so each attempt creates a fresh
 * operation — important when the caller also wires an AbortController per call.
 * A timeout of 0 (or falsy) disables the race and just runs the factory.
 *
 * @param {() => Promise<*>} factory - Produces the promise to await.
 * @param {number} timeoutMs - Budget in ms; 0 disables the timeout.
 * @param {string} [label='operation'] - Used in the timeout error message.
 * @returns {Promise<*>}
 */
async function withTimeout(factory, timeoutMs, label = 'operation') {
  if (!timeoutMs || timeoutMs <= 0) {
    return factory();
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([Promise.resolve().then(factory), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `fn` with retries and exponential backoff. Each attempt is given the
 * supplied per-attempt timeout budget. Throws a single aggregated error after
 * the final attempt fails.
 *
 * @param {(attempt:number) => Promise<*>} fn - The operation; receives the 1-based attempt number.
 * @param {Object} [options]
 * @param {number} [options.retries=3] - Total attempts (not additional retries).
 * @param {number} [options.delayMs=2000] - Base backoff delay between attempts.
 * @param {number} [options.timeoutMs=0] - Per-attempt timeout (0 = none; caller may abort itself).
 * @param {string} [options.label='operation'] - Label for log + error messages.
 * @param {Object} [options.logger=console] - Logger with a warn() method.
 * @param {number} [options.backoff=2] - Backoff multiplier.
 * @returns {Promise<*>}
 */
async function retry(fn, options = {}) {
  const {
    retries = 3,
    delayMs = 2000,
    timeoutMs = 0,
    label = 'operation',
    logger = console,
    backoff = 2,
  } = options;

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await withTimeout(() => fn(attempt), timeoutMs, label);
    } catch (err) {
      lastErr = err;
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[retry] ${label} attempt ${attempt}/${retries} failed: ${err.message}`);
      }
      if (attempt < retries) {
        await delay(delayMs * Math.pow(backoff, attempt - 1));
      }
    }
  }
  throw new Error(`${label} failed after ${retries} attempt(s): ${lastErr && lastErr.message}`);
}

module.exports = { withTimeout, retry, delay };
