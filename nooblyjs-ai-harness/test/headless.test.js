// Phase 17: headless output formats, exit codes, the library API, and the CLI with piped input.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSession, query } from '../src/index.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { runHeadless } from '../src/ui/headless.js';
import { collect, makeProject } from './helpers.js';

const capture = () => ({ text: '', write(chunk) { this.text += chunk; } });

function run(script, prompt, options = {}) {
  const session = new Session({ provider: createMockProvider(script), retry: { maxRetries: 0 }, permissions: createPermissions({ mode: 'bypass' }), ...options.session });
  const stdout = capture();
  const stderr = capture();
  return runHeadless(session, prompt, { stdout, stderr, ...options }).then((code) => ({ code, stdout: stdout.text, stderr: stderr.text, session }));
}

test('json: one result object with the answer, usage and cost; exit 0', async () => {
  const { code, stdout, stderr } = await run([{ text: 'Four.' }], 'What is 2 + 2?', { outputFormat: 'json' });
  assert.equal(code, 0);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  assert.deepEqual(
    { type: result.type, subtype: result.subtype, is_error: result.is_error, result: result.result, stop_reason: result.stop_reason, num_rounds: result.num_rounds },
    { type: 'result', subtype: 'success', is_error: false, result: 'Four.', stop_reason: 'end_turn', num_rounds: 1 },
  );
  assert.equal(result.usage.input_tokens, 10);
  assert.equal(typeof result.total_cost_usd, 'number');
});

test('stream-json: an init line, one line per event, then the result', async () => {
  const { code, stdout } = await run([{ text: 'Hi there' }], 'hello', { outputFormat: 'stream-json' });
  assert.equal(code, 0);
  const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines[0].type + '/' + lines[0].subtype, 'system/init');
  assert.ok(Array.isArray(lines[0].tools));
  assert.ok(lines.some((l) => l.type === 'text_delta'));
  assert.equal(lines.at(-2).type, 'turn_end');
  assert.equal(lines.at(-1).type, 'result');
});

test('text: only the answer on stdout; tool lines and stats on stderr', async () => {
  const { stdout, stderr } = await run([{ text: 'Answer.' }], 'q', { outputFormat: 'text' });
  assert.equal(stdout, 'Answer.\n');
  assert.match(stderr, /in: 10 · out: 5/);
});

test('exit codes: round limit and errors are 1, an interrupt is 130', async () => {
  const limited = await run([{ tools: [{ name: 'Nope', input: {} }] }], 'go', { outputFormat: 'json', session: { settings: { maxTurns: 1 } } });
  assert.equal(limited.code, 1);
  assert.equal(JSON.parse(limited.stdout).subtype, 'error_max_turns');

  const broken = await run([new Error('API is down')], 'go', { outputFormat: 'json' });
  assert.equal(broken.code, 1);
  assert.deepEqual([JSON.parse(broken.stdout).subtype, JSON.parse(broken.stdout).result], ['error', 'API is down']);

  const controller = new AbortController();
  const interrupted = await run([{ text: 'a long answer '.repeat(20), onChunk: (i) => i > 10 && controller.abort() }], 'go', { outputFormat: 'json', signal: controller.signal });
  assert.equal(interrupted.code, 130);
  assert.equal(JSON.parse(interrupted.stdout).subtype, 'interrupted');
});

test('slash commands work headless too', async () => {
  const { code, stdout } = await run([], '/history', { outputFormat: 'json' });
  assert.equal(code, 0);
  assert.match(JSON.parse(stdout).result, /0 message\(s\) in history/);
});

test('library: query() yields the same events; options map to settings', async () => {
  const cwd = await makeProject({ 'a.txt': 'hello' });
  const provider = createMockProvider([{ tools: [{ name: 'Read', input: { file_path: 'a.txt' } }] }, { text: 'It says hello.' }]);
  const events = await collect(query({ prompt: 'What is in a.txt?', options: { cwd, provider, permissionMode: 'plan', maxTurns: 3 } }));
  assert.deepEqual(events.filter((e) => ['tool_start', 'tool_end', 'turn_end'].includes(e.type)).map((e) => e.type), ['tool_start', 'tool_end', 'turn_end']);
  assert.equal(events.at(-1).text, 'It says hello.');
  assert.match(provider.requests[1].messages.at(-1).content[0].content, /hello/);

  const session = await createSession({ cwd, provider: createMockProvider([]), allowedTools: ['Bash(npm test:*)'], disallowedTools: ['Edit'], maxTurns: 7 });
  assert.equal(session.maxTurns, 7);
  assert.ok(session.permissions.allow.some((r) => r.text === 'Bash(npm test:*)'));
  assert.ok(session.permissions.deny.some((r) => r.text === 'Edit'));
  assert.equal(session.transcript, null, 'the library saves nothing unless asked');
});

const BIN = fileURLToPath(new URL('../bin/noobly.js', import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'noobly-home-'));
const cli = (args, input) => spawnSync(process.execPath, [BIN, '--echo', ...args], { input, encoding: 'utf8', env: { ...process.env, NOOBLY_HOME: home }, timeout: 30_000 });

test('CLI: piped stdin becomes the prompt, and --output-format json works with jq-style use', () => {
  const result = cli(['-p', '--output-format', 'json'], 'list TODOs');
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.match(json.result, /You said: "list TODOs"/);
});

test('CLI: bad flags and a missing prompt fail with a clear message', () => {
  assert.match(cli(['-p', '--output-format', 'yaml'], 'x').stderr, /Unknown --output-format "yaml"/);
  const noPrompt = cli(['-p'], '');
  assert.equal(noPrompt.status, 1);
  assert.match(noPrompt.stderr, /No prompt/);
});
