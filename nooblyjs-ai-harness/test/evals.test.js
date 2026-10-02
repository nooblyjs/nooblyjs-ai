// Phase 19: tracing, /stats, and the eval harness (offline: no model is called).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { formatStats, percentiles, summarizeTraces } from '../src/core/trace.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createTranscript } from '../src/session-store/transcript.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/tool.js';
import { applySolution, check, compareRuns, loadCases, prepareCase, runCase, summarizeRun } from './evals/lib.js';
import { makeProject } from './helpers.js';

const slowTool = defineTool({
  name: 'Slow',
  description: 'waits',
  isReadOnly: true,
  inputSchema: { type: 'object', properties: {} },
  call: async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { content: 'done' };
  },
});

test('every turn records a trace: per request TTFT and duration, per tool duration', async () => {
  const provider = createMockProvider([
    { text: 'Let me wait.', tools: [{ name: 'Slow' }], usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 300 } },
    { text: 'Done.', onChunk: () => new Promise((r) => setTimeout(r, 5)) },
  ]);
  const session = new Session({ provider, tools: new ToolRegistry([slowTool]), retry: { maxRetries: 0 }, permissions: createPermissions({ mode: 'bypass' }) });
  const end = await session.send('go');

  assert.equal(end.trace.requests.length, 2);
  for (const request of end.trace.requests) {
    assert.ok(request.ttftMs >= 0 && request.ttftMs <= request.durationMs);
    assert.equal(request.restarts, 0);
  }
  assert.equal(end.trace.requests[0].stopReason, 'tool_use');
  assert.equal(end.trace.tools[0].name, 'Slow');
  assert.ok(end.trace.tools[0].durationMs >= 25);
  assert.equal(session.traces.length, 1);

  const summary = summarizeTraces(session.traces);
  assert.equal(summary.requests, 2);
  assert.equal(summary.tokens.cacheRead, 300);
  assert.equal(summary.cacheHitRate, 300 / (110 + 300));
  const { text } = await runCommand('/stats', session);
  assert.match(text, /Time to first token: +p50/);
  assert.match(text, /Slow +1 +0/);
  assert.match(text, /Cache hit rate: 73%/);
});

test('traces are saved in the transcript and come back on resume', async () => {
  const home = await makeProject({});
  const cwd = await makeProject({});
  const session = new Session({ provider: createMockProvider([{ text: 'hi' }]), cwd, newTranscript: () => createTranscript(cwd, { env: { NOOBLY_HOME: home } }) });
  await session.send('hello');
  const file = session.transcript.file;
  const again = new Session({ provider: createMockProvider([]), cwd });
  again.resume(file);
  assert.equal(again.traces.length, 1);
  assert.equal(again.traces[0].requests[0].stopReason, 'end_turn');
});

test('percentiles and an empty /stats', () => {
  assert.deepEqual(percentiles([5, 1, 3, 2, 4]), { p50: 3, p90: 5, max: 5 });
  assert.equal(percentiles([]), null);
  assert.equal(formatStats(summarizeTraces([])), 'No model requests yet in this session.');
});

test('eval checkers: each fails on the starter repo and passes on the reference solution', async () => {
  const cases = loadCases();
  assert.ok(cases.length >= 10, `${cases.length} cases`);
  for (const evalCase of cases) {
    assert.ok(evalCase.prompt && evalCase.description, `${evalCase.name}: case.json needs a prompt and a description`);
    const untouched = prepareCase(evalCase);
    assert.equal((await check(evalCase, untouched, '')).pass, false, `${evalCase.name}: passes without any work`);
    const solved = prepareCase(evalCase);
    const answer = applySolution(evalCase, solved);
    const result = await check(evalCase, solved, answer);
    assert.equal(result.pass, true, `${evalCase.name}: the solution fails: ${result.message}`);
    for (const dir of [untouched, solved]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runCase: the agent works in a throwaway copy, and the result has pass/fail, tokens and cost', async () => {
  const [evalCase] = loadCases(['create-gitignore']);
  // A scripted "model" that solves the task, so the whole pipeline runs without an API.
  const provider = createMockProvider([
    { tools: [{ name: 'Write', input: { file_path: '.gitignore', content: 'node_modules/\n*.log\ndist/\n' } }] },
    { text: 'Created .gitignore.' },
  ]);
  const result = await runCase(evalCase, { provider, keep: true });
  assert.equal(result.pass, true, result.message);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.tokens.input, 20);
  assert.ok(!fs.existsSync(path.join(evalCase.dir, 'repo', '.gitignore')), 'the starter repo is untouched');
  fs.rmSync(result.dir, { recursive: true, force: true });

  const failing = await runCase(evalCase, { provider: createMockProvider([{ text: 'I did nothing.' }]) });
  assert.equal(failing.pass, false);
  assert.match(failing.message, /not created/);
});

test('A/B: summaries and a comparison of two runs', () => {
  const result = (name, pass, cost) => ({ case: name, pass, cost, toolCalls: 2, durationMs: 1000, tokens: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 } });
  const a = { label: 'baseline', results: [result('x', true, 0.01), result('y', false, 0.02)] };
  const b = { label: 'concise', results: [result('x', true, 0.01), result('y', true, 0.01)] };
  a.summary = summarizeRun(a.results);
  b.summary = summarizeRun(b.results);
  assert.equal(a.summary.passRate, 0.5);
  const text = compareRuns(a, b);
  assert.match(text, /pass rate +50% +100% +50 points/);
  assert.match(text, /cost .* -33%/);
  assert.match(text, /y: fail → pass/);
});
