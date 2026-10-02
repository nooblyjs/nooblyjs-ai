// Phase F02: an agent step in its own workspace, end to end.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { sandboxStatus } from '../src/exec/sandbox.js';
import { runStep } from '../src/exec/step-runner.js';
import { listWorkspaces } from '../src/exec/workspace/worktree.js';
import { createMockProvider } from '../src/harness.js';
import { gitIn, makeRepo, testEnv } from './helpers.js';

const writeReply = (file, content) => ({ text: `Writing ${file}.`, tools: [{ name: 'Write', input: { file_path: file, content } }] });

test('a scripted agent edits its workspace; the change lands on the step\'s branch, and the checkout is removed', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const provider = createMockProvider([writeReply('GREETING.md', 'Hello from the factory!\n'), { text: 'Done.' }]);
  const step = await runStep({ repo, driver: 'in-process', agent: { prompt: 'Add a greeting', provider, permissionMode: 'acceptEdits' } }, { env });

  assert.equal(step.result.outcome, 'success');
  assert.equal(step.commits, 1);
  assert.equal(step.kept, false);
  assert.ok(!fs.existsSync(step.workspace.path));
  assert.equal(gitIn(step.workspace.mirror, 'show', `${step.branch}:GREETING.md`), 'Hello from the factory!');
  assert.equal(gitIn(step.workspace.mirror, 'log', '-1', '--format=%s', step.branch), 'factory: Add a greeting');
  assert.equal(gitIn(repo, 'status', '--porcelain'), '', 'the source repo never changes');
});

test('two agents at once, one repo: two branches, no interference', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const agent = (file) => ({ prompt: `Write ${file}`, provider: createMockProvider([writeReply(file, `${file}\n`), { text: 'Done.' }]), permissionMode: 'acceptEdits' });
  const [a, b] = await Promise.all([runStep({ repo, driver: 'in-process', agent: agent('A.md') }, { env }), runStep({ repo, driver: 'in-process', agent: agent('B.md') }, { env })]);
  assert.notEqual(a.branch, b.branch);
  const files = (s) => gitIn(s.workspace.mirror, 'ls-tree', '--name-only', s.branch).split('\n');
  assert.ok(files(a).includes('A.md') && !files(a).includes('B.md'));
  assert.ok(files(b).includes('B.md') && !files(b).includes('A.md'));
});

test('a run that does not succeed keeps its checkout for inspection', async () => {
  const env = testEnv();
  const again = { ...writeReply('WIP.md', 'wip\n') };
  const provider = createMockProvider([again, again, again]);
  const step = await runStep({ repo: makeRepo(), driver: 'in-process', agent: { prompt: 'loop', provider, permissionMode: 'acceptEdits', limits: { maxTurns: 1 } } }, { env });
  assert.equal(step.result.outcome, 'max_turns');
  assert.equal(step.kept, true);
  assert.ok(fs.existsSync(path.join(step.workspace.path, 'WIP.md')));
  assert.equal(listWorkspaces(env)[0].status, 'kept');
});

test('the subprocess driver gets the workspace\'s own harness home: settings in, transcript out', async () => {
  const env = testEnv();
  const repo = makeRepo({ 'a.txt': 'hello subprocess\n' });
  const step = await runStep({ repo, driver: 'subprocess', agent: { prompt: 'read a.txt', provider: 'echo' } }, { env });
  assert.equal(step.result.outcome, 'success', step.result.text);
  assert.match(step.result.text, /hello subprocess/);
  const files = fs.readdirSync(step.workspace.harnessHome, { recursive: true }).map(String);
  assert.ok(files.includes('settings.json'));
  assert.ok(files.some((f) => f.endsWith(`${step.result.sessionId}.jsonl`)), 'the transcript is in the workspace\'s harness home');
});

test('a failing setup keeps the workspace and reports the error', async () => {
  const env = testEnv();
  const repo = makeRepo({ '.factory/config.json': JSON.stringify({ setup: 'exit 1' }) });
  const runSetup = async () => ({ code: 1, output: 'boom', sandboxed: false });
  await assert.rejects(runStep({ repo, driver: 'in-process', allowUnsandboxed: true, agent: { prompt: 'x', provider: createMockProvider([]) } }, { env, runSetup }), /Setup "exit 1" failed/);
  assert.equal(listWorkspaces(env)[0].status, 'kept');
});

test('no sandbox + an agent allowed to run Bash: refused before any workspace is made', { skip: sandboxStatus().available && 'a sandbox is available here' }, async () => {
  const env = testEnv();
  await assert.rejects(runStep({ repo: makeRepo(), agent: { prompt: 'x', allowedTools: ['Bash(npm test:*)'] } }, { env }), /No sandbox/);
  assert.equal(listWorkspaces(env).length, 0);
});
