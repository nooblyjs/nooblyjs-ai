// Phase F04: deterministic gates: run by the factory, in order, fail fast, with excerpts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { excerpt } from '../src/exec/gates/excerpt.js';
import { formatGates, runGates } from '../src/exec/gates/runner.js';
import { sandboxStatus } from '../src/exec/sandbox.js';
import { runStep } from '../src/exec/step-runner.js';
import { parseRepoConfig } from '../src/exec/workspace/repo-config.js';
import { createMockProvider } from '../src/harness.js';
import { makeRepo, testEnv, tmpDir } from './helpers.js';

const gate = (name, command, extra = {}) => ({ name, command, fast: true, timeoutMs: 5000, ...extra });
const opts = { cwd: tmpDir(), allowUnsandboxed: true };

test('all pass: passed, in the declared order', async () => {
  const { passed, results } = await runGates([gate('a', 'true'), gate('b', 'echo ok')], opts);
  assert.equal(passed, true);
  assert.deepEqual(results.map((r) => [r.name, r.status]), [['a', 'passed'], ['b', 'passed']]);
});

test('fail fast: the first failure stops the rest, which are reported as skipped', async () => {
  const { passed, results } = await runGates([gate('lint', 'true'), gate('test', 'echo "1 failing: expected 2, got 3"; exit 1'), gate('e2e', 'touch should-not-exist')], opts);
  assert.equal(passed, false);
  assert.deepEqual(results.map((r) => r.status), ['passed', 'failed', 'skipped']);
  assert.equal(results[1].exitCode, 1);
  assert.match(results[1].excerpt, /expected 2, got 3/);
  assert.ok(!fs.existsSync(path.join(opts.cwd, 'should-not-exist')), 'the skipped gate never ran');
});

test('a hung gate is a timeout, not a hang, and its children die with it', async () => {
  const started = Date.now();
  const { results } = await runGates([gate('slow', 'sleep 30 & sleep 30', { timeoutMs: 300 })], opts);
  assert.equal(results[0].status, 'timeout');
  assert.match(results[0].excerpt, /time limit/);
  assert.ok(Date.now() - started < 5000);
});

test('a gate that cannot run at all is an error, never a pass', async () => {
  const run = async () => {
    throw new Error('Refusing to run without a sandbox');
  };
  const { passed, results } = await runGates([gate('test', 'npm test')], { cwd: '.', run });
  assert.equal(passed, false);
  assert.equal(results[0].status, 'error');
});

test('fastOnly: only fast gates (for the Stop hook)', async () => {
  const { results } = await runGates([gate('unit', 'true'), gate('e2e', 'true', { fast: false })], { ...opts, fastOnly: true });
  assert.deepEqual(results.map((r) => r.name), ['unit']);
});

test('config: gates keep their order; strings and objects; defaults; bad entries warned', () => {
  const c = parseRepoConfig(JSON.stringify({ timeoutMs: 1000, gates: { lint: 'npm run lint', test: { command: 'npm test', timeoutMs: 9000 }, e2e: { command: 'x', fast: false }, broken: {} } }));
  assert.deepEqual(c.gates, [
    { name: 'lint', command: 'npm run lint', fast: true, timeoutMs: 1000 },
    { name: 'test', command: 'npm test', fast: true, timeoutMs: 9000 },
    { name: 'e2e', command: 'x', fast: false, timeoutMs: 1000 },
  ]);
  assert.match(c.warnings.join(), /gate "broken" has no command/);
});

test('excerpt: head + tail with a marker, colours removed', () => {
  const long = Array.from({ length: 200 }, (_, i) => `\x1b[31mline ${i}\x1b[0m`).join('\n');
  const e = excerpt(long, { head: 2, tail: 3 });
  assert.equal(e, 'line 0\nline 1\n… (195 lines cut) …\nline 197\nline 198\nline 199');
});

test('formatGates: a table, the first failure in full; no gates is a warning, not a pass', () => {
  const md = formatGates([
    { name: 'lint', command: 'npm run lint', status: 'passed', exitCode: 0, durationMs: 1200, excerpt: '' },
    { name: 'test', command: 'npm test', status: 'failed', exitCode: 1, durationMs: 3400, excerpt: 'AssertionError: 2 !== 3' },
  ]);
  assert.match(md, /\| ✅ lint \| `npm run lint` \| passed \| 1\.2s \|/);
  assert.match(md, /\*\*test\*\* \(failed\):\n\n```\nAssertionError: 2 !== 3\n```/);
  assert.match(formatGates([]), /No checks are configured/);
});

// ---- Gates in a step --------------------------------------------------------------------------

const CHECK_CONFIG = JSON.stringify({ gates: { check: 'grep -q fixed STATUS.txt' } });
const write = (content) => ({ text: `Writing "${content}".`, tools: [{ name: 'Write', input: { file_path: 'STATUS.txt', content } }] });

test('THE STOP HOOK: the agent tries to stop with a failing check, is told why, fixes it, and then passes', async () => {
  const provider = createMockProvider([write('broken\n'), { text: 'Done, all good!' }, write('fixed\n'), { text: 'Fixed for real.' }]);
  const step = await runStep(
    { repo: makeRepo({ '.factory/config.json': CHECK_CONFIG }), driver: 'in-process', allowUnsandboxed: true, agent: { prompt: 'fix it', provider, permissionMode: 'acceptEdits' } },
    { env: testEnv() },
  );
  assert.equal(provider.requests.length, 4, 'the hook sent the agent back to work once');
  assert.match(JSON.stringify(provider.requests[2].messages), /The factory's checks failed[\s\S]*check/);
  assert.equal(step.result.outcome, 'success');
  assert.equal(step.gates?.passed, true, 'and the gate runner agrees, independently');
});

test('the agent says "all good" but the check fails: the verdict is the gate runner\'s', async () => {
  // The Stop hook sends it back 3 times; it never fixes anything; the factory still says no.
  const claim = { text: 'All tests pass! Everything works.' };
  const provider = createMockProvider([write('broken\n'), claim, claim, claim, claim]);
  const step = await runStep(
    { repo: makeRepo({ '.factory/config.json': CHECK_CONFIG }), driver: 'in-process', allowUnsandboxed: true, agent: { prompt: 'fix it', provider, permissionMode: 'acceptEdits' } },
    { env: testEnv() },
  );
  assert.equal(step.result.text, 'All tests pass! Everything works.');
  assert.equal(step.gates?.passed, false);
  assert.equal(step.kept, true, 'failed gates keep the checkout for inspection');
});

test('the agent cannot switch off a gate by editing .factory/config.json: config comes from the base commit', async () => {
  const provider = createMockProvider([
    { text: 'Removing that pesky check.', tools: [{ name: 'Write', input: { file_path: '.factory/config.json', content: '{"gates":{}}' } }] },
    { text: 'No more failing checks.' },
    { text: 'No more failing checks.' },
    { text: 'No more failing checks.' },
    { text: 'No more failing checks.' },
  ]);
  const step = await runStep(
    { repo: makeRepo({ '.factory/config.json': CHECK_CONFIG }), driver: 'in-process', allowUnsandboxed: true, agent: { prompt: 'x', provider, permissionMode: 'acceptEdits' } },
    { env: testEnv() },
  );
  assert.equal(step.gates?.passed, false);
});

test('no sandbox and gates configured: refused BEFORE the agent runs (no money spent)', { skip: sandboxStatus().available && 'a sandbox is available here' }, async () => {
  const provider = createMockProvider([{ text: 'hi' }]);
  await assert.rejects(runStep({ repo: makeRepo({ '.factory/config.json': CHECK_CONFIG }), driver: 'in-process', agent: { prompt: 'x', provider } }, { env: testEnv() }), /has gates: its own commands, which need a sandbox/);
  assert.equal(provider.requests.length, 0);
});
