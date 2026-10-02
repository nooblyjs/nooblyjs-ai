// Phase 09: transcripts, resume, and prompt caching.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { addCacheBreakpoints } from '../src/context/cache.js';
import { Session } from '../src/core/session.js';
import { buildRequest } from '../src/providers/anthropic.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createTranscript, findSession, hashTools, listSessions, readTranscript } from '../src/session-store/transcript.js';
import { makeProject } from './helpers.js';

async function setup(script = []) {
  const cwd = await makeProject();
  const env = { NOOBLY_HOME: await makeProject() };
  const session = new Session({ provider: createMockProvider(script), cwd, systemPrompt: 'SYSTEM v1', newTranscript: () => createTranscript(cwd, { env }) });
  return { cwd, env, session };
}

test('messages and turns are appended to a JSONL transcript, starting with a meta line', async () => {
  const { session } = await setup([{ text: 'hello there', usage: { input_tokens: 10, output_tokens: 5 } }]);
  assert.equal(fs.existsSync(session.transcript.file), false); // nothing written before the first message
  await session.send('hi');

  const lines = fs.readFileSync(session.transcript.file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((l) => l.type), ['meta', 'message', 'message', 'turn']);
  assert.equal(lines[0].systemPrompt, 'SYSTEM v1');
  assert.equal(lines[0].toolsHash, hashTools(session.tools.toApiSchemas()));
  assert.equal(lines[1].message.content, 'hi');
});

test('readTranscript rebuilds history and totals, skips broken lines, and follows compaction', async () => {
  const { session } = await setup([{ text: 'one' }, { text: 'two' }]);
  await session.send('first');
  await session.send('second');
  fs.appendFileSync(session.transcript.file, '{"type":"message", this line was cut off in a cra');
  let saved = readTranscript(session.transcript.file);
  assert.equal(saved.history.length, 4);
  assert.equal(saved.turns, 2);
  assert.equal(saved.title, 'first');

  session.replaceHistory([{ role: 'user', content: 'summary' }], { reason: 'test' });
  saved = readTranscript(session.transcript.file);
  assert.deepEqual(saved.history, [{ role: 'user', content: 'summary' }]);
});

test('listSessions (newest first) and findSession by number or id prefix', async () => {
  const { cwd, env, session } = await setup([{ text: 'a' }, { text: 'b' }]);
  await session.send('older conversation');
  const firstId = session.transcript.id;
  session.clear(); // a new conversation = a new transcript
  await session.send('newer conversation');
  fs.utimesSync(session.transcript.file, new Date(), new Date(Date.now() + 5000));

  const sessions = listSessions(cwd, { env });
  assert.deepEqual(sessions.map((s) => s.title), ['newer conversation', 'older conversation']);
  assert.equal(findSession(cwd, '2', { env }).id, firstId);
  assert.equal(findSession(cwd, firstId.slice(0, 8), { env }).id, firstId);
  assert.equal(findSession(cwd, 'zzzz', { env }), null);
});

test('resume restores history, totals and the SAVED system prompt, and keeps writing to the same file', async () => {
  const { cwd, env, session } = await setup([{ text: 'answer', usage: { input_tokens: 10, output_tokens: 5 } }]);
  await session.send('question');
  const file = session.transcript.file;

  const later = new Session({ provider: createMockProvider([{ text: 'more' }]), cwd, systemPrompt: 'SYSTEM v2 (new date, new git status)', newTranscript: () => createTranscript(cwd, { env }) });
  later.resume(file);
  assert.equal(later.history.length, 2);
  assert.equal(later.usage.input_tokens, 10);
  assert.equal(later.systemPrompt, 'SYSTEM v1');
  await later.send('follow-up');
  assert.equal(later.transcript.file, file);
  assert.equal(readTranscript(file).history.length, 4);
});

test('resume strips thinking blocks if the tools changed since', async () => {
  const { session } = await setup();
  const file = session.transcript.file;
  session.transcript.setMeta({ ...session.describe(), toolsHash: 'from-an-older-noobly' });
  session.transcript.append({ type: 'message', message: { role: 'user', content: 'hi' } });
  session.transcript.append({ type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'yo' }] } });
  session.resume(file);
  assert.deepEqual(session.history[1].content, [{ type: 'text', text: 'yo' }]);
});

test('/resume lists and resumes through the command', async () => {
  const { env, session } = await setup([{ text: 'reply' }]);
  await session.send('remember me');
  const saved = process.env.NOOBLY_HOME;
  process.env.NOOBLY_HOME = env.NOOBLY_HOME;
  try {
    session.clear();
    assert.match((await runCommand('/resume', session)).text, /1\. .* remember me\s+\(2 msgs\)/);
    const result = await runCommand('/resume 1', session);
    assert.equal(result.action, 'resumed');
    assert.equal(session.history.length, 2);
    assert.equal(result.last.role, 'assistant');
  } finally {
    if (saved === undefined) delete process.env.NOOBLY_HOME;
    else process.env.NOOBLY_HOME = saved;
  }
});

test('cache breakpoints: last tool, system prompt, last message block; nothing mutated', () => {
  const tools = [{ name: 'A' }, { name: 'B' }];
  const messages = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }, { role: 'user', content: 'again' }];
  const before = JSON.stringify({ tools, messages });
  const cached = addCacheBreakpoints({ system: 'S', tools, messages });

  assert.deepEqual(cached.tools[1].cache_control, { type: 'ephemeral' });
  assert.equal(cached.tools[0].cache_control, undefined);
  assert.deepEqual(cached.system, [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(cached.messages.at(-1).content, [{ type: 'text', text: 'again', cache_control: { type: 'ephemeral' } }]);
  assert.equal(JSON.stringify({ tools, messages }), before);
});

test('the Anthropic request carries breakpoints only when caching is on', () => {
  const params = { apiKey: 'k', model: 'm', system: 'S', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'A' }], maxTokens: 10 };
  const on = JSON.parse(buildRequest({ ...params, caching: true }).init.body);
  const off = JSON.parse(buildRequest({ ...params, caching: false }).init.body);
  assert.equal(on.system[0].cache_control.type, 'ephemeral');
  assert.equal(off.system, 'S');
});
