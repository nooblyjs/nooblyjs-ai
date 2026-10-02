// Phase 22: background tasks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { collectReminders } from '../src/context/reminders.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createSandbox, detectBackend } from '../src/sandbox/index.js';
import { createTaskRegistry } from '../src/tasks/registry.js';
import { taskOutputTool, taskStopTool } from '../src/tools/background.js';
import { bashTool } from '../src/tools/bash.js';
import { makeProject } from './helpers.js';

const isRunning = (pattern) => spawnSync('pgrep', ['-f', pattern]).status === 0;

async function context({ sandbox = null } = {}) {
  const cwd = await makeProject();
  const session = { cwd, shellCwd: cwd, readFiles: new Map(), tasks: createTaskRegistry(), sandbox };
  const ctx = { cwd, session };
  const bash = (input) => bashTool.call(input, ctx);
  const output = (input) => taskOutputTool.call(input, ctx);
  return { cwd, session, ctx, bash, output };
}

test('start → early output at once → only NEW output on each read → stop leaves nothing running', async () => {
  const { session, bash, output } = await context();
  const started = Date.now();
  const out = await bash({ command: 'echo booting; sleep 0.8; for i in 1 2 3; do sleep 0.2; echo tick $i; done; sleep 41.5', run_in_background: true });
  assert.ok(Date.now() - started < 2000, 'returns without waiting for the command');
  assert.match(out.content, /^Started background task 1\.[\s\S]*Output so far:\nbooting$/);
  assert.equal(out.display, 'background task 1 · running');

  const ticks = await output({ task_id: 1, until: 'tick 3', wait_seconds: 10 });
  assert.match(ticks.content, /is running for \d+s\.\ntick 1\ntick 2\ntick 3$/);
  assert.doesNotMatch(ticks.content.split('\n').slice(1).join('\n'), /booting/, 'already read');
  assert.match((await output({ task_id: 1 })).content, /\(no new output\)$/);

  assert.ok(isRunning('sleep 41.5'));
  assert.match((await taskStopTool.call({ task_id: 1 }, { session })).content, /^Stopped task 1/);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(isRunning('sleep 41.5'), false, 'the whole process group is gone');
  assert.deepEqual(session.tasks.takeFinished(), [], 'the model stopped it: no "it exited" reminder');
});

test('a task that ends is announced exactly once, with how much output is unread', async () => {
  const { session, bash } = await context();
  await bash({ command: 'sleep 0.6; echo built; exit 3', run_in_background: true });
  await session.tasks.wait(1, { ms: 5000 });
  const reminders = collectReminders(session);
  assert.equal(reminders.length, 1);
  assert.match(reminders[0], /Background task 1 \(`sleep 0\.6; echo built; exit 3`\) exited with code 3\. It has 1 line\(s\) of output you haven't read: use TaskOutput with task_id 1\./);
  assert.deepEqual(collectReminders(session), []);
});

test('a task that fails at once is reported by Bash itself (no later reminder)', async () => {
  const { session, bash } = await context();
  const out = await bash({ command: 'no-such-command-xyz', run_in_background: true });
  assert.match(out.content, /already exited with code 127[\s\S]*command not found/);
  assert.deepEqual(session.tasks.takeFinished(), []);
});

test('the loop tells the model mid-turn when a task ends while other tools run', async () => {
  const cwd = await makeProject();
  const provider = createMockProvider([
    { tools: [{ name: 'Bash', input: { command: 'sleep 0.8; echo done', run_in_background: true } }] },
    { tools: [{ name: 'Bash', input: { command: 'sleep 1' } }] },
    { text: 'ok' },
  ]);
  const session = new Session({ provider, cwd, retry: { maxRetries: 0 }, permissions: createPermissions({ mode: 'bypass' }) });
  await session.send('start it');
  const sent = JSON.stringify(provider.requests[2].messages.at(-1));
  assert.match(sent, /<system-reminder>\\nBackground task 1 \(`sleep 0\.8; echo done`\) exited with code 0/);
  assert.deepEqual(collectReminders(session), [], 'and not again with the next message');
});

test('/tasks lists and stops tasks; /clear stops them all', async () => {
  const cwd = await makeProject();
  const session = new Session({ provider: createMockProvider([]), cwd });
  await session.tasks.start('sleep 42.5', { cwd });
  await session.tasks.start('sleep 43.5', { cwd });
  assert.match((await runCommand('/tasks', session)).text, /1\. ● running for \d+s\s+sleep 42\.5\n\s+2\. ● running/);
  assert.match((await runCommand('/tasks stop 1', session)).text, /Stopped task 1/);
  session.clear();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(isRunning('sleep 42.5') || isRunning('sleep 43.5'), false);
});

test('TaskOutput explains unknown ids and bad patterns', async () => {
  const { output, bash } = await context();
  await assert.rejects(output({ task_id: 9 }), /There is no background task 9\. Start one with Bash/);
  await bash({ command: 'sleep 1', run_in_background: true });
  await assert.rejects(output({ task_id: 1, until: '(' }), /not a valid regular expression/);
});

test('in the sandbox, a background server is reachable from the next command (one sandbox per session)', { skip: detectBackend().backend !== 'bwrap' && 'bubblewrap is not available' }, async () => {
  const cwd = await makeProject({ 'index.html': '<h1>Hello from the dev server</h1>' });
  const sandbox = createSandbox({}, { cwd });
  const { bash, output, session } = await context({ sandbox });
  session.cwd = session.shellCwd = cwd;
  const ctx = { cwd, session };
  try {
    const server = await bashTool.call({ command: 'node -e "require(\'http\').createServer((q, s) => s.end(require(\'fs\').readFileSync(\'index.html\'))).listen(4567, () => setTimeout(() => console.log(\'ready on 4567\'), 800))"', run_in_background: true }, ctx);
    assert.match(server.display, /^sandboxed · background task 1/);
    const started = Date.now();
    const ready = await taskOutputTool.call({ task_id: 1, until: 'ready', wait_seconds: 10 }, ctx);
    assert.match(ready.content, /ready on 4567/);
    assert.ok(Date.now() - started < 5000, 'stopped waiting as soon as the line appeared');
    const page = await bashTool.call({ command: 'node -e "fetch(\'http://127.0.0.1:4567/\').then(r => r.text()).then(console.log)"' }, ctx);
    assert.match(page.content, /Hello from the dev server/);
    const outside = await bashTool.call({ command: 'node -e "fetch(\'https://example.com\').then(() => console.log(\'reached\'), e => console.log(\'no internet:\', e.cause?.code))"' }, ctx);
    assert.match(outside.content, /no internet/, 'still no internet');
    void bash;
    void output;
  } finally {
    session.tasks.stopAll();
    await sandbox.close();
  }
});
