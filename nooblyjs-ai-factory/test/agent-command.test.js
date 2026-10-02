// Phase F01: `factory agent` flags → an AgentRun.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { agentRunFromFlags } from '../src/commands/agent.js';

test('flags become an AgentRun with limits in the right units', () => {
  const run = agentRunFromFlags({ cwd: 'x', model: 'm', 'max-turns': '5', timeout: '90', budget: '0.25', allow: ['Read'], echo: true }, 'do it');
  assert.equal(run.cwd, path.resolve('x'));
  assert.equal(run.provider, 'echo');
  assert.deepEqual(run.limits, { maxTurns: 5, timeoutMs: 90_000, budgetUsd: 0.25 });
  assert.deepEqual(run.allowedTools, ['Read']);
});

test('bad numbers are refused with a clear message', () => {
  assert.throws(() => agentRunFromFlags({ budget: 'lots' }, 'x'), /--budget needs a positive number/);
});
