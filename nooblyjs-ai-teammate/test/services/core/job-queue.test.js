// services/core/job-queue.js on core queueing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testHost, closeHost } from '../../helpers.js';
import { JobQueue } from '../../../src/services/core/job-queue.js';
import { serverManager as registry } from '../../fixtures/host.js';

// The stand-in host initialises nooblyjs-core's registry, which the queue runs on.
before(() => testHost());
after(() => closeHost());

const waitFor = async (check, { timeoutMs = 5000, stepMs = 25 } = {}) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, stepMs));
  }
};

test('the job queue runs jobs with limited concurrency, retries, and reports when idle', async () => {
  const queue = registry.queue('memory', { instanceName: 'job-queue-test' });
  let running = 0;
  let peak = 0;
  const seen = [];
  const jobs = new JobQueue({
    queue, name: 'work', concurrency: 2, retryDelaysMs: [5],
    handler: async (payload, { attempt }) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      seen.push(`${payload.n}:${attempt}`);
      return { ok: payload.n !== 3 || attempt > 1 };
    },
    shouldRetry: (result) => !result.ok,
  });
  const first = await Promise.all([1, 2, 3, 4].map((n) => jobs.push({ n })));
  assert.deepEqual(first.map((r) => r.ok), [true, true, false, true], 'push resolves with the first attempt');
  assert.equal(peak, 2);
  await waitFor(() => seen.includes('3:2'));
  await jobs.idle();
  assert.deepEqual([...seen].sort(), ['1:1', '2:1', '3:1', '3:2', '4:1']);
  assert.equal(await jobs.size(), 0);

  // A handler that throws rejects the first attempt; close() drops waiting retries.
  const failing = new JobQueue({ queue, name: 'failing', retryDelaysMs: [60000], handler: async () => { throw new Error('boom'); } });
  await assert.rejects(failing.push({}), /boom/);
  assert.equal(failing.retrying, 1);
  failing.close();
  assert.equal(failing.retrying, 0);
});
