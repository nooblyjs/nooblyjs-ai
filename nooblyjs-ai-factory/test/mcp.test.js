// Phase F16: factory tools for agents (MCP), and the operator's MCP server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMockProvider } from '../src/harness.js';
import { answerEntry, openEntries } from '../src/humans/inbox.js';
import { continueRun, runJob, submitJob } from '../src/job/run-job.js';
import { OPERATOR_TOOLS } from '../src/mcp/operator-tools.js';
import { STEP_TOOLS } from '../src/mcp/step-tools.js';
import { stepToken, verifyStepToken } from '../src/mcp/tokens.js';
import { resumeRun } from '../src/scheduler/kill-switch.js';
import { openStore } from '../src/store/events.js';
import { approve, makeRepo, testEnv, tmpDir, writeFiles } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/factory.js', import.meta.url));
const tool = (name) => STEP_TOOLS.find((t) => t.name === name);
const op = (name) => OPERATOR_TOOLS.find((t) => t.name === name);
const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const call = (name, input) => ({ name: `mcp__factory__${name}`, input });

function issueFile(text = '# Add half\n\nhalf(n) returns n / 2.\n') {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, text);
  return file;
}
const triage = () => createMockProvider([{ text: '```json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"one function"}\n```' }]);

/** A real store with one queued run whose spec is in `workspace`. */
function stubStep({ autonomy = 'L2' } = {}) {
  const env = testEnv();
  const store = openStore({ env });
  const runId = submitJob(store, { repo: makeRepo(), issueFile: issueFile(), autonomy });
  const workspace = tmpDir();
  const specDir = '.factory/specs/issue-1';
  writeFiles(workspace, {
    [`${specDir}/requirements.md`]: '# Requirements\n\n## R1 Halving\n\n- R1.1 WHEN half(n) is called THE SYSTEM SHALL return n / 2\n\n## R2 Doubling\n\n- R2.1 WHEN double(n) is called THE SYSTEM SHALL return n * 2\n',
    [`${specDir}/tasks.md`]: '# Tasks\n\n## T1 half\n\nPaths: half.js\n\n## T2 double\n\nPaths: double.js\n',
    'report.md': '# Benchmarks\n',
  });
  store.append(`run:${runId}`, 'step.finished', { runId, step: 'spec', result: { specDir } });
  return { env, store, runId, ctx: { store, runId, step: 'build', station: 'build', workspace, env } };
}

test('step tools: read_spec (all, a file, one id), progress, decisions, artifacts: each an event on the run', () => {
  const { store, runId, ctx } = stubStep();
  assert.match(tool('read_spec').handle(ctx, {}), /R1\.1[\s\S]*T2 double/);
  assert.match(tool('read_spec').handle(ctx, { section: 'tasks' }), /^# Tasks/);
  const r2 = tool('read_spec').handle(ctx, { section: 'R2' });
  assert.match(r2, /R2 Doubling/);
  assert.doesNotMatch(r2, /Halving/, 'only the part about R2');
  assert.match(tool('read_spec').handle(ctx, { section: 'T9' }), /Nothing in the spec mentions "T9"/);

  tool('report_progress').handle(ctx, { message: 'tests written', percent: 40 });
  tool('record_decision').handle(ctx, { title: 'Use n / 2, not n >> 1', rationale: '>> truncates odd numbers' });
  assert.match(tool('submit_artifact').handle(ctx, { kind: 'report', path: 'report.md' }), /Stored as agent-report/);
  assert.match(tool('submit_artifact').handle(ctx, { kind: 'report', path: '../../etc/passwd' }), /outside the workspace/);
  const types = store.read({ stream: `run:${runId}` }).map((e) => e.type);
  for (const t of ['step.progress', 'decision.recorded', 'artifact.stored']) assert.ok(types.includes(t), t);
});

test('request_scope: at L3 granted at once; otherwise a person approves, and then it is granted', () => {
  const l3 = stubStep({ autonomy: 'L3' });
  assert.match(tool('request_scope').handle(l3.ctx, { paths: ['README.md'], reason: 'document half()' }), /^Granted/);
  assert.deepEqual(l3.store.get('runs', l3.runId).scopeGranted, ['README.md']);

  const l2 = stubStep({ autonomy: 'L2' });
  assert.match(tool('request_scope').handle(l2.ctx, { paths: ['README.md'], reason: 'document half()' }), /Asked a person/);
  assert.equal(l2.store.get('runs', l2.runId).scopeGranted, undefined, 'not yet');
  const [entry] = openEntries(l2.store);
  assert.equal(entry.gate, 'scope');
  answerEntry(l2.store, entry.id, 'approved', { by: 'sam' });
  assert.deepEqual(l2.store.get('runs', l2.runId).scopeGranted, ['README.md']);
});

test('tokens: a token is for one step of one run', () => {
  const env = testEnv();
  const token = stepToken(env, 'run-a', 'build');
  assert.equal(verifyStepToken(env, 'run-a', 'build', token), true);
  assert.equal(verifyStepToken(env, 'run-b', 'build', token), false, 'another run');
  assert.equal(verifyStepToken(env, 'run-a', 'review', token), false, 'another step');
  assert.equal(verifyStepToken(env, 'run-a', 'build', undefined), false);
  assert.equal(stepToken(testEnv(), 'run-a', 'build') === token, false, 'another factory, another secret');
});

/** Talk MCP to `factory mcp …` over stdio. */
function mcpClient(args, env) {
  const child = spawn(process.execPath, [BIN, 'mcp', ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
  });
  let id = 0;
  const request = (method, params) => new Promise((resolve) => {
    waiting.set(++id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const exit = new Promise((resolve) => child.on('exit', (code) => resolve({ code, stderr })));
  return { request, notify: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`), close: () => (child.stdin.end(), exit), exit };
}

test('factory mcp --step speaks MCP, and refuses a token for another step', async () => {
  const { env, runId, ctx } = stubStep();
  const good = mcpClient(['--step', `${runId}/build`], { FACTORY_HOME: env.FACTORY_HOME, FACTORY_STEP_TOKEN: stepToken(env, runId, 'build'), FACTORY_WORKSPACE: ctx.workspace });
  const init = await good.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  good.notify('notifications/initialized');
  const list = await good.request('tools/list');
  assert.deepEqual(list.result.tools.map((t) => t.name), ['read_spec', 'report_progress', 'ask_human', 'record_decision', 'submit_artifact', 'request_scope']);
  assert.equal(list.result.tools[0].annotations.readOnlyHint, true);
  const spec = await good.request('tools/call', { name: 'read_spec', arguments: { section: 'R1.1' } });
  assert.match(spec.result.content[0].text, /R1\.1 WHEN half/);
  assert.equal((await good.request('nope/method')).error.code, -32601);
  assert.equal((await good.close()).code, 0);

  const stolen = mcpClient(['--step', `${runId}/review`], { FACTORY_HOME: env.FACTORY_HOME, FACTORY_STEP_TOKEN: stepToken(env, runId, 'build') });
  const out = await stolen.exit;
  assert.equal(out.code, 1);
  assert.match(out.stderr, /token does not match .*\/review/);
});

test('END TO END: the builder asks a person (ask_human) → the run PARKS → answered → the builder starts again WITH the answer', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo();
  const build = createMockProvider([
    { text: 'Rounding is unclear.', tools: [call('read_spec', {}), call('ask_human', { question: 'Should half(3) be 1.5 or 1?', options: ['1.5', '1'] })] },
    { text: 'Waiting for an answer.' },
    // …after the answer: a fresh session.
    { text: 'Implementing.', tools: [write('half.js', 'export const half = (n) => n / 2;\n'), call('record_decision', { title: 'Exact halves', rationale: 'The person answered 1.5' })] },
    { text: 'Done: half(3) is 1.5, as answered.' },
  ]);
  const providers = { triage: triage(), build, review: await approve() };
  const first = await runJob({ issueFile: issueFile(), repo, autonomy: 'L2', providers }, { env, store });
  assert.equal(first.status, 'parked');
  assert.match(build.requests[1].messages.at(-1).content.map((c) => c.content ?? c.text).join('\n'), /END YOUR TURN NOW/, 'the tool told the agent to stop');
  assert.match(build.requests[1].messages.at(-1).content.map((c) => c.content ?? c.text).join('\n'), /no spec: it was small enough/);
  const [ask] = openEntries(store);
  assert.equal(ask.kind, 'question');
  assert.match(ask.body, /1\.5 or 1\?[\s\S]*- 1\.5/);

  answerEntry(store, ask.id, 'answered', { answer: '1.5: exact halves', by: 'sam' });
  resumeRun(store, first.runId);
  const second = await continueRun(store, first.runId, { live: { providers } });
  assert.equal(second.status, 'delivered');
  assert.match(JSON.stringify(build.requests[2].messages), /Answers to your questions[\s\S]*1\.5 or 1\?[\s\S]*A \(sam\): 1\.5: exact halves/);
  const pr = fs.readFileSync(second.pr.path, 'utf8');
  assert.match(pr, /## Decisions[\s\S]*Exact halves/, 'the decision reached the evidence');
});

test('operator tools: submit an item, list runs, see the inbox, read a run', () => {
  const env = testEnv();
  const store = openStore({ env });
  const ctx = { store, env };
  const repo = makeRepo();
  const queued = op('submit_item').handle(ctx, { repo, title: 'Add --json to status', body: '`factory status --json` prints JSON.' });
  const runId = queued.match(/Queued (\S+):/)[1];
  assert.equal(store.get('runs', runId).status, 'queued');
  assert.match(op('list_runs').handle(ctx, {}), new RegExp(`${runId}\\s+queued .* Add --json to status`));
  assert.match(op('get_run').handle(ctx, { runId }), /queued/);
  assert.equal(op('answer_inbox').handle(ctx, {}), 'The inbox is empty.');
  assert.match(op('submit_item').handle(ctx, { repo: tmpDir(), title: 'x', body: 'y' }), /not a git repository/);
});
