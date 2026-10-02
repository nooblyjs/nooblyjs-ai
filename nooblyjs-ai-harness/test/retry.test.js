import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/providers/anthropic.js';
import { backoffDelay, isRetryable, sleep, withRetry } from '../src/providers/retry.js';
import { collect } from './helpers.js';

const overloaded = () => new ApiError(529, 'overloaded_error', 'Overloaded');
const noSleep = async () => {};

test('isRetryable: temporary problems yes, permanent ones no', () => {
  assert.equal(isRetryable(overloaded()), true);
  assert.equal(isRetryable(new ApiError(429, 'rate_limit_error', 'slow down')), true);
  assert.equal(isRetryable(new TypeError('fetch failed')), true);
  assert.equal(isRetryable(new ApiError(401, 'authentication_error', 'bad key')), false);
  assert.equal(isRetryable(new ApiError(400, 'invalid_request_error', 'bad body')), false);
  assert.equal(isRetryable(new DOMException('stop', 'AbortError')), false);
});

test('backoffDelay doubles each time and respects the cap and retry-after', () => {
  const noJitter = { random: () => 0 };
  assert.deepEqual([1, 2, 3, 4].map((n) => backoffDelay(n, noJitter)), [500, 1000, 2000, 4000]);
  assert.equal(backoffDelay(20, noJitter), 20_000);
  assert.equal(backoffDelay(1, { retryAfterMs: 3000 }), 3000);
});

test('withRetry retries a failure that happens before any event', async () => {
  let calls = 0;
  const events = await collect(
    withRetry(
      async function* () {
        calls++;
        if (calls < 3) throw overloaded();
        yield { type: 'text_delta', text: 'ok' };
      },
      { sleepFn: noSleep },
    ),
  );
  assert.equal(calls, 3);
  assert.deepEqual(events.map((e) => e.type), ['retry', 'retry', 'text_delta']);
});

test('withRetry does NOT retry once events have been received', async () => {
  let calls = 0;
  const run = collect(
    withRetry(
      async function* () {
        calls++;
        yield { type: 'text_delta', text: 'partial' };
        throw overloaded();
      },
      { sleepFn: noSleep },
    ),
  );
  await assert.rejects(run, /Overloaded/);
  assert.equal(calls, 1);
});

test('withRetry gives up after maxRetries', async () => {
  let calls = 0;
  const run = collect(
    withRetry(
      async function* () {
        calls++;
        throw overloaded();
      },
      { maxRetries: 2, sleepFn: noSleep },
    ),
  );
  await assert.rejects(run, /Overloaded/);
  assert.equal(calls, 3);
});

test('sleep stops early when aborted', async () => {
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(sleep(5000, controller.signal), { name: 'AbortError' });
  assert.ok(Date.now() - started < 1000);
});
