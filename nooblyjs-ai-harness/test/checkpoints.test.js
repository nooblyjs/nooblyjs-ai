// Phase 21: checkpoints and rewind.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createCheckpointStore } from '../src/checkpoints/store.js';
import { runCommand } from '../src/commands/index.js';
import { createPermissions } from '../src/permissions/gate.js';
import { collectReminders } from '../src/context/reminders.js';
import { Session } from '../src/core/session.js';
import { createMockProvider } from '../src/providers/mock.js';
import { makeProject } from './helpers.js';

/** A session in a fresh project where everything is allowed (bypass), with checkpoints in `store`. */
async function setup(files, script) {
  const cwd = await makeProject(files);
  const store = path.join(cwd, '..', `${path.basename(cwd)}-checkpoints`);
  const session = new Session({
    provider: createMockProvider(script),
    cwd,
    retry: { maxRetries: 0 },
    permissions: createPermissions({ mode: 'bypass' }),
    newCheckpoints: (id) => createCheckpointStore(path.join(store, id), { cwd }),
  });
  const read = (name) => fs.readFileSync(path.join(cwd, name), 'utf8');
  return { cwd, session, read, store };
}

const turn = (tools, text = 'ok') => [{ tools }, { text }];

test('rewind: code and conversation go back to before a turn, byte for byte', async () => {
  const { session, read, cwd } = await setup({ 'a.txt': 'one\n' }, [
    ...turn([{ name: 'Read', input: { file_path: 'a.txt' } }]),
    ...turn([{ name: 'Edit', input: { file_path: 'a.txt', old_string: 'one', new_string: 'two' } }]),
    ...turn([
      { name: 'Edit', input: { file_path: 'a.txt', old_string: 'two', new_string: 'three' } },
      { name: 'Write', input: { file_path: 'new/b.txt', content: 'brand new' } },
    ]),
  ]);
  await session.send('read a');
  await session.send('change to two');
  const lengthBefore3 = session.history.length;
  await session.send('change to three and add b');
  assert.equal(read('a.txt'), 'three\n');

  const turns = session.checkpoints.turns();
  assert.deepEqual(turns.map((t) => t.prompt), ['read a', 'change to two', 'change to three and add b']);
  assert.deepEqual(turns[2].files.map((f) => path.relative(cwd, f)), ['a.txt', 'new/b.txt']);

  const result = await session.rewind(turns[2].id);
  assert.equal(read('a.txt'), 'two\n');
  assert.equal(fs.existsSync(path.join(cwd, 'new/b.txt')), false, 'a file Write created is deleted again');
  assert.equal(session.history.length, lengthBefore3);
  assert.equal(result.turn.prompt, 'change to three and add b');
  assert.deepEqual(session.checkpoints.turns().map((t) => t.prompt), ['read a', 'change to two']);

  // Rewinding further back undoes the earlier edit too.
  await session.rewind(turns[1].id);
  assert.equal(read('a.txt'), 'one\n');
});

test('rewind code only: the conversation stays, the model is told, and must Read again before editing', async () => {
  const { session, read, cwd } = await setup({ 'a.txt': 'one\n' }, [
    ...turn([{ name: 'Read', input: { file_path: 'a.txt' } }, { name: 'Edit', input: { file_path: 'a.txt', old_string: 'one', new_string: 'two' } }]),
    { tools: [{ name: 'Edit', input: { file_path: 'a.txt', old_string: 'one', new_string: 'uno' } }] },
    { text: 'I need to read it again' },
  ]);
  await session.send('change it');
  const length = session.history.length;
  const [first] = session.checkpoints.turns();
  await session.rewind(first.id, { code: true, conversation: false });
  assert.equal(read('a.txt'), 'one\n');
  assert.equal(session.history.length, length, 'the conversation is kept');

  const provider = session.provider;
  await session.send('now change it to uno');
  const toolResult = session.history.at(-2).content[0];
  assert.match(toolResult.content, /You must Read a\.txt before changing it/);
  assert.equal(read('a.txt'), 'one\n');
  const sent = provider.requests.at(-2).messages.at(-1).content.map((block) => block.text).join('\n');
  assert.match(sent, /rewound the project's files to how they were before .*"change it"[\s\S]*Restored: a\.txt/, 'the model was told');
  assert.deepEqual(collectReminders(session), [], 'only once');
  void cwd;
});

test('rewind conversation only: files keep their changes', async () => {
  const { session, read } = await setup({ 'a.txt': 'one\n' }, [
    ...turn([{ name: 'Read', input: { file_path: 'a.txt' } }, { name: 'Edit', input: { file_path: 'a.txt', old_string: 'one', new_string: 'two' } }]),
  ]);
  await session.send('change it');
  await session.rewind(session.checkpoints.turns()[0].id, { code: false, conversation: true });
  assert.equal(read('a.txt'), 'two\n');
  assert.equal(session.history.length, 0);
});

test('files changed by Bash are reported, not silently skipped', async () => {
  const { session, read } = await setup({ 'a.txt': 'one\n' }, [
    ...turn([{ name: 'Bash', input: { command: 'echo changed > a.txt && echo made > c.txt' } }]),
  ]);
  await session.send('use a command');
  const [first] = session.checkpoints.turns();
  assert.deepEqual(first.bashFiles.map((f) => path.basename(f)).sort(), ['a.txt', 'c.txt']);
  const { text } = await runCommand(`/rewind ${first.id} code`, session);
  assert.match(text, /⚠ changed by commands, NOT restored: (a\.txt, c\.txt|c\.txt, a\.txt)/);
  assert.equal(read('a.txt'), 'changed\n');
});

test('checkpoints survive a restart (they are saved with the conversation id)', async () => {
  const { session, read, store, cwd } = await setup({ 'a.txt': 'one\n' }, [
    ...turn([{ name: 'Read', input: { file_path: 'a.txt' } }, { name: 'Edit', input: { file_path: 'a.txt', old_string: 'one', new_string: 'two' } }]),
  ]);
  await session.send('change it');
  const id = path.basename(session.checkpoints.dir);
  const reopened = createCheckpointStore(path.join(store, id), { cwd });
  assert.deepEqual(reopened.turns().map((t) => t.prompt), ['change it']);
  await reopened.restoreTo(reopened.turns()[0].id);
  assert.equal(read('a.txt'), 'one\n');
});

test('after compaction only the code can be rewound', async () => {
  const { session } = await setup({ 'a.txt': 'one\n' }, [{ text: 'hi' }]);
  await session.send('hello');
  session.replaceHistory([], { reason: 'cleared' });
  const [first] = session.checkpoints.turns();
  assert.equal(first.historyLength, null);
  await assert.rejects(session.rewind(first.id), /compacted after that turn.*\/rewind 1 code/);
  await session.rewind(first.id, { conversation: false });
});

test('/rewind lists turns, /diff shows everything changed this conversation', async () => {
  const { session } = await setup({ 'a.txt': 'one\n' }, [
    ...turn([{ name: 'Read', input: { file_path: 'a.txt' } }, { name: 'Edit', input: { file_path: 'a.txt', old_string: 'one', new_string: 'two' } }]),
    ...turn([{ name: 'Write', input: { file_path: 'b.txt', content: 'new\n' } }]),
  ]);
  assert.match((await runCommand('/rewind', session)).text, /Nothing to rewind yet/);
  await session.send('edit a');
  await session.send('make b');
  const list = (await runCommand('/rewind', session)).text;
  assert.match(list, /1\. \d\d:\d\d  edit a  \(a\.txt\)\n\s+2\. \d\d:\d\d  make b  \(b\.txt\)/);

  const diff = (await runCommand('/diff', session)).text;
  assert.match(diff, /--- a\/a\.txt\n\+\+\+ b\/a\.txt\n@@ -1 \+1 @@\n-one\n\+two/);
  assert.match(diff, /--- \/dev\/null\n\+\+\+ b\/b\.txt\n@@ -0,0 \+1 @@\n\+new/);

  const rewound = await runCommand('/rewind 2', session);
  assert.equal(rewound.action, 'rewound');
  assert.equal(rewound.prompt, 'make b', 'your message goes back into the input box');
  assert.match(rewound.text, /deleted \(didn't exist then\): b\.txt/);
});
