import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { bashTool, runCommand } from '../src/tools/bash.js';
import { truncateMiddle } from '../src/tools/truncate.js';
import { makeProject, toolContext } from './helpers.js';

test('returns stdout and stderr together, with the exit code', async () => {
  const dir = await makeProject();
  const out = await bashTool.call({ command: 'echo out; echo err >&2; exit 3' }, toolContext(dir));
  assert.equal(out.content, 'out\nerr\n[exit 3]');
  assert.equal(out.display, 'exit 3 · 2 lines');
});

test('the working directory persists between commands', async () => {
  const dir = await makeProject({ 'sub/file.txt': 'x' });
  const ctx = toolContext(dir);
  await bashTool.call({ command: 'cd sub' }, ctx);
  assert.equal(ctx.session.shellCwd, path.join(dir, 'sub'));
  const out = await bashTool.call({ command: 'ls' }, ctx);
  assert.match(out.content, /^file.txt/);
});

test('cd outside the project is undone', async () => {
  const dir = await makeProject();
  const ctx = toolContext(dir);
  const out = await bashTool.call({ command: 'cd /' }, ctx);
  assert.match(out.content, /Shell cwd was reset/);
  assert.equal(ctx.session.shellCwd, dir);
});

test('if the shell\'s folder is deleted, the next command runs in the project again', async () => {
  const dir = await makeProject({ 'build/a.txt': 'x' });
  const ctx = toolContext(dir);
  await bashTool.call({ command: 'cd build' }, ctx);
  assert.equal(ctx.session.shellCwd, path.join(dir, 'build'));
  const removed = await bashTool.call({ command: 'rm -r ../build && echo gone' }, ctx);
  assert.match(removed.content, /gone\n\[exit 0\]\nShell cwd was reset .*no longer exists/);
  assert.equal(ctx.session.shellCwd, dir);
  assert.match((await bashTool.call({ command: 'pwd' }, ctx)).content, new RegExp(`^${dir}\n`));
});

test('commands get no keyboard input, so they cannot hang waiting for it', async () => {
  const result = await runCommand('read line; echo "status=$?"', { cwd: process.cwd(), timeoutMs: 5000 });
  assert.equal(result.output, 'status=1\n');
});

test('a timeout kills the command and everything it started', async () => {
  const dir = await makeProject();
  const started = Date.now();
  const out = await bashTool.call({ command: `sleep 30 & echo $! > pid; sleep 30`, timeout: 300 }, toolContext(dir));
  assert.ok(Date.now() - started < 5000);
  assert.match(out.content, /timed out after 0.3s/);
  const pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'background process should be gone');
});

test('an abort signal stops the command', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const result = await runCommand('sleep 30', { cwd: process.cwd(), signal: controller.signal });
  assert.equal(result.interrupted, true);
});

test('API keys are not visible to commands', async () => {
  const names = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY'];
  for (const name of names) process.env[name] = 'secret';
  try {
    const script = names.map((name) => `echo "${name}=\${${name}:-none}"`).join('; ');
    const result = await runCommand(script, { cwd: process.cwd() });
    assert.equal(result.output, names.map((name) => `${name}=none\n`).join(''));
  } finally {
    for (const name of names) delete process.env[name];
  }
});

test('Bash returns ALL the output; the loop decides what fits (Phase 26)', async () => {
  const dir = await makeProject();
  const out = await bashTool.call({ command: 'seq 1 20000' }, toolContext(dir));
  assert.match(out.content, /^1\n2\n3\n/);
  assert.match(out.content, /\n10000\n/, 'nothing cut here');
  assert.match(out.content, /19999\n20000\n\[exit 0\]$/);
});

test('truncateMiddle leaves short text alone', () => {
  assert.equal(truncateMiddle('short', 100), 'short');
  assert.equal(truncateMiddle('a'.repeat(50) + 'b'.repeat(50), 20), `${'a'.repeat(10)}\n\n… [80 characters omitted] …\n\n${'b'.repeat(10)}`);
});
