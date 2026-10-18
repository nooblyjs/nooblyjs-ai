// services/invocation.js: cost estimates and billable hours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvocationService } from '../../src/services/invocation.js';

test('estimates count prompt characters plus typical output and bill like real usage', () => {
  const e = InvocationService.estimate({ system: 'x'.repeat(4000), context: '', messages: [{ role: 'user', content: 'y'.repeat(400) }] }, { tokensPerHour: 300000, billingIncrementHours: 0.1, estimateOutputTokens: 4000 }, 50);
  assert.deepEqual(e, { inputTokens: 1100, outputTokens: 4000, tokens: 5100, hours: 0.1, amount: 5 });
});

test('billable hours round up to the billing increment', () => {
  const billing = { tokensPerHour: 300000, billingIncrementHours: 0.1 };
  assert.equal(InvocationService.billableHours(500, billing), 0.1);
  assert.equal(InvocationService.billableHours(300000, billing), 1);
  assert.equal(InvocationService.billableHours(300001, billing), 1.1);
  assert.equal(InvocationService.apiCost({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 }, { input: 4, output: 20 }), 24);
});
