// Phase F01: the harness as a library, driven with a scripted model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inProcessDriver } from '../src/exec/harness/in-process.js';
import { costOf } from 'nooblyjs-ai-common/cost';
import { createMockProvider } from '../src/harness.js';

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-f01-'));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'remember the milk\n');
  return dir;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a plain answer: success, the text, exact cost', async () => {
  const provider = createMockProvider([{ text: 'All done.', usage: { input_tokens: 1000, output_tokens: 100 } }]);
  const events = [];
  const result = await inProcessDriver.run({ cwd: tempDir(), prompt: 'hi', provider, model: 'claude-sonnet-5-5', onEvent: (e) => events.push(e) });
  assert.equal(result.outcome, 'success');
  assert.equal(result.text, 'All done.');
  assert.equal(result.turns, 1);
  assert.equal(result.costIsEstimate, false);
  assert.equal(result.costUsd, costOf('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }));
  assert.equal(events.at(-1).type, 'turn_end');
});

test('tool use runs for real in the workspace, and is reported through events', async () => {
  const provider = createMockProvider([{ text: 'Reading.', tools: [{ name: 'Read', input: { file_path: 'notes.txt' } }] }, { text: 'It says to remember the milk.' }]);
  const events = [];
  const result = await inProcessDriver.run({ cwd: tempDir(), prompt: 'what do my notes say?', provider, onEvent: (e) => events.push(e) });
  assert.equal(result.outcome, 'success');
  assert.equal(result.toolCalls, 1);
  const toolEnd = events.find((e) => e.type === 'tool_end');
  assert.match(toolEnd.content, /remember the milk/);
  assert.equal(result.text, 'It says to remember the milk.', 'only the LAST message, not "Reading." too');
});

test('maxTurns: the harness stops the loop; we report max_turns', async () => {
  const again = { text: 'Once more.', tools: [{ name: 'Read', input: { file_path: 'notes.txt' } }] };
  const provider = createMockProvider([again, again, again]);
  const result = await inProcessDriver.run({ cwd: tempDir(), prompt: 'loop', provider, limits: { maxTurns: 2 } });
  assert.equal(result.outcome, 'max_turns');
  assert.equal(provider.requests.length, 2);
});

test('the caller can interrupt (kill switch): outcome interrupted', async () => {
  const controller = new AbortController();
  const provider = createMockProvider([{ text: 'a long, slow answer that takes a while', onChunk: () => sleep(20) }], { chunkSize: 1 });
  setTimeout(() => controller.abort(), 30);
  const result = await inProcessDriver.run({ cwd: tempDir(), prompt: 'go', provider, signal: controller.signal });
  assert.equal(result.outcome, 'interrupted');
});

test('timeoutMs: a slow run is stopped with outcome timeout', async () => {
  const provider = createMockProvider([{ text: 'slow slow slow slow slow slow', onChunk: () => sleep(20) }], { chunkSize: 1 });
  const started = Date.now();
  const result = await inProcessDriver.run({ cwd: tempDir(), prompt: 'go', provider, limits: { timeoutMs: 50 } });
  assert.equal(result.outcome, 'timeout');
  assert.ok(Date.now() - started < 1000);
});

test('budgetUsd: stopped as soon as the ESTIMATE crosses it, before the next request', async () => {
  // 1M input tokens on Opus is several dollars: message_start alone crosses a $1 budget.
  const expensive = { text: 'Let me read everything.', tools: [{ name: 'Read', input: { file_path: 'notes.txt' } }], usage: { input_tokens: 1_000_000, output_tokens: 50 }, onChunk: () => sleep(1) };
  const provider = createMockProvider([expensive, { text: 'never reached' }]);
  const result = await inProcessDriver.run({ cwd: tempDir(), prompt: 'go', provider, model: 'claude-opus-5-5', limits: { budgetUsd: 1 } });
  assert.equal(result.outcome, 'budget');
  assert.equal(provider.requests.length, 1, 'the second (paid) request was never made');
  assert.ok(result.costUsd > 1);
});

test('a harness error (the model API failing) is an error outcome, not a crash', async () => {
  const provider = createMockProvider([new Error('boom: bad request')]);
  const result = await inProcessDriver.run({ cwd: tempDir(), prompt: 'go', provider });
  assert.equal(result.outcome, 'error');
  assert.match(result.text, /boom/);
});
