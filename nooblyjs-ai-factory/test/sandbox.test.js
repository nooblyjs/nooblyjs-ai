// Phase F02: when is it OK to run without a sandbox?
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isolationProblem, runCommand, sandboxStatus } from '../src/exec/sandbox.js';
import { tmpDir } from './helpers.js';

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
