// Phase 16: memory across sessions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { loadContext } from '../src/context/system-prompt.js';
import { Session } from '../src/core/session.js';
import { loadMemory, memoryDir } from '../src/memory/memory.js';
import { createPermissions, decide } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createDefaultTools } from '../src/tools/index.js';
import { makeProject } from './helpers.js';

async function setup(script = []) {
  const home = await makeProject({});
  const cwd = await makeProject({ 'src/app.js': 'x' });
  const context = await loadContext(cwd, { home, git: false });
  const provider = createMockProvider(script);
  const session = new Session({ provider, cwd, context, tools: createDefaultTools(), retry: { maxRetries: 0 }, permissions: createPermissions() });
  return { home, cwd, context, provider, session, dir: context.memory.dir };
}

const fact = '---\nname: prefers-tabs\ndescription: The user indents with tabs\ntype: user\n---\nUse tabs, not spaces, in every file.\n';

test('the memory folder is per project and outside it', async () => {
  const { cwd, home, dir } = await setup();
  assert.equal(dir, memoryDir(cwd, path.join(home, '.noobly')));
  assert.ok(!dir.startsWith(cwd));
});

test('the system prompt explains the conventions, and says when nothing is remembered yet', async () => {
  const { session, dir } = await setup();
  assert.match(session.systemPrompt, /# Memory/);
  assert.match(session.systemPrompt, new RegExp(`${dir}/prefers-tabs\\.md`));
  assert.match(session.systemPrompt, /type: user \| feedback \| project \| reference/);
  assert.match(session.systemPrompt, /MEMORY\.md does not exist yet/);
});

test('"remember that…": the model writes memory files without being asked permission, then a NEW session knows', async () => {
  const { home, cwd, dir, session } = await setup();
  const provider = createMockProvider([
    {
      tools: [
        { name: 'Write', input: { file_path: `${dir}/prefers-tabs.md`, content: fact } },
        { name: 'Write', input: { file_path: `${dir}/MEMORY.md`, content: '- [Prefers tabs](prefers-tabs.md) — indent with tabs\n' } },
      ],
    },
    { text: 'I will remember that.' },
  ]);
  session.provider = provider;
  session.requestPermission = async () => assert.fail('memory writes should not ask');
  await session.send('Remember that I prefer tabs over spaces');
  assert.deepEqual(provider.requests[1].messages.at(-1).content.map((r) => r.is_error), [undefined, undefined]);
  assert.equal(fs.readFileSync(path.join(dir, 'prefers-tabs.md'), 'utf8'), fact);

  // Next session: the index is in the system prompt from the start.
  const next = await loadContext(cwd, { home, git: false });
  const nextSession = new Session({ provider: createMockProvider([]), cwd, context: next });
  assert.match(nextSession.systemPrompt, /Contents of MEMORY\.md:\n- \[Prefers tabs\]\(prefers-tabs\.md\) — indent with tabs/);
});

test('/clear picks up memories saved during the conversation', async () => {
  const { session, dir } = await setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '- [Test command](test-command.md) — npm run test:unit\n');
  assert.doesNotMatch(session.systemPrompt, /test:unit/, 'the running conversation keeps its prompt (caching)');
  await runCommand('/clear', session);
  assert.match(session.systemPrompt, /npm run test:unit/);
});

test('memory access is limited to the memory folder: other paths outside the project are still refused', async () => {
  const { dir, session } = await setup();
  const write = session.tools.get('Write');
  assert.equal(decide(session, write, { file_path: `${dir}/a.md`, content: 'x' }).behavior, 'allow');
  assert.equal(decide(session, write, { file_path: `${dir}/../../other.md`, content: 'x' }).behavior, 'ask');
  assert.equal(decide(session, write, { file_path: 'src/app.js', content: 'x' }).behavior, 'ask', 'project files still ask');

  const ctx = { cwd: session.cwd, session };
  await assert.rejects(write.call({ file_path: path.join(path.dirname(dir), 'escape.md'), content: 'x' }, ctx), /outside the project/);
});

test('deny rules and plan mode still apply to memory files', async () => {
  const { dir, session } = await setup();
  const write = session.tools.get('Write');
  session.permissions.mode = 'plan';
  assert.equal(decide(session, write, { file_path: `${dir}/a.md`, content: 'x' }).behavior, 'deny');
  session.permissions = createPermissions({ deny: [`Write(${dir}/**)`] });
  assert.equal(decide(session, write, { file_path: `${dir}/a.md`, content: 'x' }).behavior, 'deny');
});

test('Edit on a memory file follows the usual rules (Read it first)', async () => {
  const { dir, session } = await setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prefers-tabs.md'), fact);
  const ctx = { cwd: session.cwd, session };
  const edit = session.tools.get('Edit');
  const input = { file_path: `${dir}/prefers-tabs.md`, old_string: 'Use tabs', new_string: 'Always use tabs' };
  await assert.rejects(edit.call(input, ctx), /Read/);
  await session.tools.get('Read').call({ file_path: `${dir}/prefers-tabs.md` }, ctx);
  await edit.call(input, ctx);
  assert.match(fs.readFileSync(path.join(dir, 'prefers-tabs.md'), 'utf8'), /Always use tabs/);
});

test('/memory lists memories with their type; a huge index is cut', async () => {
  const { session, dir } = await setup();
  assert.match((await runCommand('/memory', session)).text, /Nothing remembered yet/);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prefers-tabs.md'), fact);
  assert.match((await runCommand('/memory', session)).text, /prefers-tabs\s+\[user\] The user indents with tabs/);

  fs.writeFileSync(path.join(dir, 'MEMORY.md'), Array.from({ length: 300 }, (_, i) => `- line ${i}`).join('\n'));
  const memory = loadMemory(session.cwd, { nooblyDir: path.dirname(path.dirname(path.dirname(dir))) });
  assert.equal(memory.truncated, true);
  assert.equal(memory.index.split('\n').length, 200);
});
