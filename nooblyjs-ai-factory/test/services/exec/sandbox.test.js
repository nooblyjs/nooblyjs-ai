// Phase F02: when is it OK to run without a sandbox?
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolationProblem, runCommand, sandboxStatus } from '../../../src/services/exec/sandbox.js';
import { tmpDir } from '../../helpers.js';

const none = { available: false, reason: 'bubblewrap is not installed' };
const bwrap = { available: true };

test('with a sandbox, anything goes (the sandbox limits it)', () => {
  assert.equal(isolationProblem({ allowedTools: ['Bash'], permissionMode: 'bypass' }, bwrap), null);
});

test('without a sandbox: reading and editing is fine, because every Bash command is denied ("ask" = no)', () => {
  assert.equal(isolationProblem({ allowedTools: ['Read', 'Edit(src/**)'], permissionMode: 'acceptEdits' }, none), null);
});

test('without a sandbox: Bash allow rules or bypass mode would run commands unsandboxed, so refuse…', () => {
  assert.match(isolationProblem({ allowedTools: ['Bash(npm test:*)'] }, none), /Bash allow rules[\s\S]*bubblewrap/);
  assert.match(isolationProblem({ permissionMode: 'bypass' }, none), /bypass mode/);
});

test('…unless the operator explicitly accepts it', () => {
  assert.equal(isolationProblem({ allowedTools: ['Bash'], allowUnsandboxed: true }, none), null);
});

test('runCommand runs the command (sandboxed when possible) and refuses without one unless allowed', async () => {
  const cwd = tmpDir();
  if (sandboxStatus().available) {
    const result = await runCommand('echo inside', { cwd });
    assert.equal(result.sandboxed, true);
    assert.match(result.output, /inside/);
  } else {
    await assert.rejects(runCommand('echo hi', { cwd }), /Refusing to run "echo hi" without a sandbox/);
    const result = await runCommand('echo hi; exit 3', { cwd, allowUnsandboxed: true });
    assert.deepEqual([result.code, result.output.trim(), result.sandboxed], [3, 'hi', false]);
  }
});

// BUG-007: in the sandbox, the repository's own commands got this process's whole environment: the factory's secrets,
// and NODE_TEST_CONTEXT, under which a failing `node --test` gate exits 0 (and passes) when a test runner started us.
test('a command gets the scrubbed environment, sandboxed or not: no secrets, and not a child of a test runner', async () => {
  const cwd = tmpDir();
  const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT };
  process.env.GITHUB_TOKEN = 'ghp_not_for_the_repo';
  process.env.NODE_TEST_CONTEXT = 'child-v8';
  try {
    const result = await runCommand('echo "token=${GITHUB_TOKEN:-none} context=${NODE_TEST_CONTEXT:-none}"', { cwd, allowUnsandboxed: true });
    assert.match(result.output, /token=none context=none/);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
