// Phase F01: the harness as a separate process. A fake noobly replays recorded
// output, so these tests are fast and offline; the last test runs the REAL noobly
// (with its offline echo provider) as a contract test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nooblyArgs, subprocessDriver } from '../src/exec/harness/subprocess.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-noobly.js', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'factory-f01-'));

function withFake(mode, extraEnv = {}) {
  return { FACTORY_NOOBLY_BIN: FAKE, FAKE_NOOBLY_MODE: mode, ...extraEnv };
}

async function runWithFake(mode, run = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, withFake(mode, run.env));
  try {
    const events = [];
    const result = await subprocessDriver.run({ cwd: tmp(), prompt: 'read a.txt', provider: 'echo', onEvent: (e) => events.push(e), ...run });
    return { result, events };
  } finally {
    process.env = saved;
  }
}

test('the command line: flags from the run, and "--" before the prompt', () => {
  const args = nooblyArgs({ cwd: '.', prompt: '-rf? no, a prompt', provider: 'anthropic', model: 'claude-sonnet-5-5', permissionMode: 'acceptEdits', allowedTools: ['Read', 'Bash(npm test:*)'], disallowedTools: ['Bash(git push:*)'], limits: { maxTurns: 7 } });
  assert.deepEqual(args, ['-p', '--output-format', 'stream-json', '--provider', 'anthropic', '--model', 'claude-sonnet-5-5', '--max-turns', '7', '--permission-mode', 'acceptEdits', '--allowed-tools', 'Read, Bash(npm test:*)', '--deny', 'Bash(git push:*)', '--', '-rf? no, a prompt']);
});

test('a recorded run is replayed into events and one result', async () => {
  const argsFile = path.join(tmp(), 'args.json');
  const { result, events } = await runWithFake('normal', { harnessHome: '/tmp/some-home', env: { FAKE_NOOBLY_ARGS: argsFile } });
  assert.equal(result.outcome, 'success');
  assert.equal(result.turns, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.sessionId?.length, 36);
  assert.match(result.text, /hello file/);
  assert.equal(events.filter((e) => e.type === 'tool_end').length, 1);
  assert.ok(!events.some((e) => e.type === 'result' || e.type === 'system'), 'init and result are not passed on as events');
  assert.equal(JSON.parse(fs.readFileSync(argsFile, 'utf8')).home, '/tmp/some-home', 'harnessHome becomes NOOBLY_HOME');
});

test('output arriving in awkward chunks (mid-line, mid-character) still parses', async () => {
  const { result, events } = await runWithFake('split');
  assert.equal(result.outcome, 'success');
  assert.ok(events.some((e) => e.text === 'café'));
});

test('a stray non-JSON line is skipped', async () => {
  const { result } = await runWithFake('noise');
  assert.equal(result.outcome, 'success');
});

test('a crash without a result: outcome error, with stderr in the message', async () => {
  const { result } = await runWithFake('crash');
  assert.equal(result.outcome, 'error');
  assert.match(result.text, /code 3/);
  assert.match(result.text, /something broke inside noobly/);
});

test('timeout: SIGINT, and noobly reports interrupted; we know it was the timeout', async () => {
  const { result } = await runWithFake('hang', { limits: { timeoutMs: 300 } });
  assert.equal(result.outcome, 'timeout');
});

test('a process that ignores SIGINT is killed after the grace period', async () => {
  const grace = subprocessDriver.graceMs;
  subprocessDriver.graceMs = 200;
  try {
    const started = Date.now();
    const { result } = await runWithFake('stubborn', { limits: { timeoutMs: 300 } });
    assert.equal(result.outcome, 'timeout');
    assert.ok(Date.now() - started < 3000);
  } finally {
    subprocessDriver.graceMs = grace;
  }
});

test('a missing noobly binary is an error outcome', async () => {
  const saved = process.env.FACTORY_NOOBLY_BIN;
  process.env.FACTORY_NOOBLY_BIN = '/nonexistent/noobly.js';
  try {
    const result = await subprocessDriver.run({ cwd: tmp(), prompt: 'hi', provider: 'echo' });
    assert.equal(result.outcome, 'error');
  } finally {
    if (saved === undefined) delete process.env.FACTORY_NOOBLY_BIN;
    else process.env.FACTORY_NOOBLY_BIN = saved;
  }
});

test('CONTRACT: the real noobly (echo provider) speaks the stream-json we expect', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'hello contract\n');
  const home = tmp();
  const events = [];
  const result = await subprocessDriver.run({ cwd, prompt: 'read a.txt', provider: 'echo', harnessHome: home, onEvent: (e) => events.push(e) });
  assert.equal(result.outcome, 'success', result.text);
  assert.equal(result.toolCalls, 1);
  assert.match(result.text, /hello contract/);
  for (const type of ['message_start', 'text_delta', 'tool_start', 'tool_end', 'turn_end']) {
    assert.ok(events.some((e) => e.type === type), `expected a ${type} event`);
  }
  // The transcript went to OUR harness home, not ~/.noobly. (checkpoints/…/index.jsonl is the harness's undo record.)
  const transcripts = fs.readdirSync(path.join(home, 'projects'), { recursive: true }).filter((f) => String(f).endsWith('.jsonl') && !String(f).includes('checkpoints'));
  assert.equal(transcripts.length, 1);
  assert.ok(String(transcripts[0]).includes(result.sessionId));
});
