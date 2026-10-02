// Phase 30: the Agent Client Protocol, with a fake editor on the other end.
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { promptText, serveAcp } from '../src/ui/acp.js';
import { makeProject } from './helpers.js';

/** A fake editor: sends requests, collects everything noobly writes, answers permission requests. */
function fakeEditor({ makeSession, answer = () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }) }) {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const received = [];
  const pending = new Map();
  let id = 0;
  let buffer = '';
  fromAgent.on('data', (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      received.push(message);
      if (message.method === 'session/request_permission') toAgent.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: answer(message.params) }) + '\n');
      else if (message.id !== undefined && pending.has(message.id)) pending.get(message.id)(message);
    }
  });
  const done = serveAcp({ input: toAgent, output: fromAgent, makeSession, version: '9.9.9' });
  return {
    received,
    call: (method, params) => new Promise((resolve) => {
      pending.set(++id, resolve);
      toAgent.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    }),
    notify: (method, params) => toAgent.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    close: () => (toAgent.end(), done),
  };
}

const updates = (received) => received.filter((m) => m.method === 'session/update').map((m) => m.params.update);

test('initialize → session/new → session/prompt: text, tool calls, a permission question, and the stop reason', async () => {
  const cwd = await makeProject();
  const provider = createMockProvider([{ text: 'Checking.', tools: [{ name: 'Bash', input: { command: 'echo hello' } }] }, { text: 'It printed hello.' }]);
  const asked = [];
  const editor = fakeEditor({
    makeSession: async (dir) => new Session({ provider, cwd: dir, retry: { maxRetries: 0 }, permissions: createPermissions() }),
    answer: (params) => (asked.push(params), { outcome: { outcome: 'selected', optionId: 'allow_once' } }),
  });
  const init = await editor.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
  assert.equal(init.result.protocolVersion, 1);
  assert.equal(init.result.agentInfo.name, 'noobly');
  const { result: { sessionId } } = await editor.call('session/new', { cwd, mcpServers: [] });
  const reply = await editor.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'run echo hello' }] });
  assert.deepEqual(reply.result, { stopReason: 'end_turn' });

  assert.equal(asked.length, 1, 'Bash asked the editor (no sandbox in this session)');
  assert.match(asked[0].toolCall.title, /^Bash\(echo hello\)$/);
  assert.deepEqual(asked[0].options.map((o) => o.kind), ['allow_once', 'allow_always', 'reject_once']);

  const all = updates(editor.received);
  const text = all.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => u.content.text).join('');
  assert.equal(text, 'Checking.It printed hello.');
  const call = all.find((u) => u.sessionUpdate === 'tool_call');
  assert.equal(call.kind, 'execute');
  const done = all.find((u) => u.sessionUpdate === 'tool_call_update');
  assert.equal(done.toolCallId, call.toolCallId);
  assert.equal(done.status, 'completed');
  assert.match(done.content[0].content.text, /^hello\n\[exit 0\]/);
  await editor.close();
});

test('a declined permission reaches the model; cancel stops a prompt; unknown methods are errors', async () => {
  const cwd = await makeProject();
  const provider = createMockProvider([
    { tools: [{ name: 'Bash', input: { command: 'rm notes.txt' } }] },
    { text: 'OK, I will not.' },
    { text: 'x'.repeat(3000), onChunk: () => new Promise((r) => setTimeout(r, 5)) }, // a slow reply, to cancel
  ]);
  const editor = fakeEditor({
    makeSession: async (dir) => new Session({ provider, cwd: dir, retry: { maxRetries: 0 }, permissions: createPermissions() }),
    answer: () => ({ outcome: { outcome: 'selected', optionId: 'reject_once' } }),
  });
  const { result: { sessionId } } = await editor.call('session/new', { cwd });
  await editor.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'delete notes' }] });
  assert.match(JSON.stringify(provider.requests[1].messages.at(-1)), /declined this Bash call in the editor/);

  const slow = editor.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'talk' }] });
  setTimeout(() => editor.notify('session/cancel', { sessionId }), 50);
  assert.deepEqual((await slow).result, { stopReason: 'cancelled' });

  assert.equal((await editor.call('nope', {})).error.code, -32601);
  await editor.close();
});

test('promptText: attached files become tagged sections', () => {
  assert.equal(
    promptText([{ type: 'text', text: 'Explain' }, { type: 'resource', resource: { uri: 'file:///a.js', text: 'x()' } }, { type: 'resource_link', uri: 'file:///b.js' }]),
    'Explain\n\n<file uri="file:///a.js">\nx()\n</file>\n\n(See file:///b.js)',
  );
});
