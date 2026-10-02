// The agent loop, tested with the scripted mock model and simple fake tools.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batchTools } from '../src/core/loop.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { ApiError } from '../src/providers/anthropic.js';
import { createMockProvider } from '../src/providers/mock.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/tool.js';
import { collect } from './helpers.js';

const echoTool = defineTool({
  name: 'Echo',
  description: 'Returns its input',
  isReadOnly: true,
  inputSchema: { type: 'object', properties: { say: { type: 'string' } }, required: ['say'] },
  summarize: (input) => input.say,
  call: async ({ say }) => ({ content: `echo: ${say}`, display: 'ok' }),
});

const brokenTool = defineTool({
  name: 'Broken',
  description: 'Always crashes',
  inputSchema: { type: 'object', properties: {} },
  call: async () => {
    throw new Error('disk on fire');
  },
});

function setup(script, { tools = [echoTool, brokenTool], ...options } = {}) {
  const provider = createMockProvider(script);
  // These tests are about the loop, not permissions (see permissions.test.js), so nothing asks.
  const session = new Session({
    provider,
    tools: new ToolRegistry(tools),
    retry: { maxRetries: 0 },
    permissions: createPermissions({ mode: 'bypass' }),
    ...options,
  });
  return { provider, session };
}

const types = (events) => events.map((e) => e.type).filter((t) => t !== 'text_delta' && t !== 'message_start');

test('one tool call: run it, send the result back, get the final answer', async () => {
  const { provider, session } = setup([
    { text: 'Let me check.', tools: [{ id: 't1', name: 'Echo', input: { say: 'hi' } }] },
    { text: 'It said hi.' },
  ]);

  const events = await collect(session.stream('go'));

  assert.deepEqual(types(events), ['tool_start', 'tool_end', 'turn_end']);
  assert.equal(provider.requests.length, 2);
  // The second request ends with the tool result.
  assert.deepEqual(provider.requests[1].messages.at(-1), {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 't1', content: 'echo: hi' }],
  });
  const end = events.at(-1);
  assert.equal(end.rounds, 2);
  assert.equal(end.toolCalls, 1);
  assert.equal(end.text, 'Let me check.It said hi.');
  assert.deepEqual(
    session.history.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
});

test('every request includes the tool list', async () => {
  const { provider, session } = setup([{ text: 'hi' }]);
  await session.send('go');
  assert.deepEqual(provider.requests[0].tools.map((t) => t.name), ['Echo', 'Broken']);
});

test('two tool calls in one reply: both run, results go back in ONE message', async () => {
  const { provider, session } = setup([
    {
      tools: [
        { id: 'a', name: 'Echo', input: { say: '1' } },
        { id: 'b', name: 'Echo', input: { say: '2' } },
      ],
    },
    { text: 'done' },
  ]);
  await session.send('go');
  const results = provider.requests[1].messages.at(-1).content;
  assert.deepEqual(results.map((r) => [r.tool_use_id, r.content]), [
    ['a', 'echo: 1'],
    ['b', 'echo: 2'],
  ]);
});

test('unknown tools, bad input and crashing tools become error results, and the loop continues', async () => {
  const { provider, session } = setup([
    {
      tools: [
        { id: 'a', name: 'Teleport', input: {} },
        { id: 'b', name: 'Echo', input: { wrong: 1 } },
        { id: 'c', name: 'Broken', input: {} },
      ],
    },
    { text: 'I will try something else.' },
  ]);
  const events = await collect(session.stream('go'));
  const results = provider.requests[1].messages.at(-1).content;

  assert.ok(results.every((r) => r.is_error === true));
  assert.match(results[0].content, /no tool called "Teleport". Available tools: Echo, Broken/);
  assert.match(results[1].content, /Invalid input for Echo: Missing required field "say"/);
  assert.match(results[2].content, /Broken failed: disk on fire/);
  assert.equal(events.at(-1).text, 'I will try something else.');
});

test('stops after maxTurns rounds, leaving a valid history', async () => {
  const again = { tools: [{ name: 'Echo', input: { say: 'again' } }] };
  const { provider, session } = setup([again, again, again], { settings: { maxTurns: 2 } });
  const events = await collect(session.stream('loop forever'));

  assert.equal(provider.requests.length, 2);
  assert.ok(events.some((e) => e.type === 'notice' && /Stopped after 2 rounds/.test(e.text)));
  assert.equal(events.at(-1).stopReason, 'max_turns');
  // Ends with the tool results, so every tool_use is answered.
  assert.equal(session.history.at(-1).content[0].type, 'tool_result');
});

test('interrupting during a tool answers every tool_use and keeps history valid', async () => {
  const controller = new AbortController();
  const stopper = defineTool({
    name: 'Stopper',
    description: 'Presses the interrupt button',
    inputSchema: { type: 'object', properties: {} },
    call: async () => {
      controller.abort();
      return { content: 'finished anyway' };
    },
  });
  const { session } = setup(
    [{ tools: [{ id: 'a', name: 'Stopper' }, { id: 'b', name: 'Echo', input: { say: 'x' } }] }, { text: 'never' }],
    { tools: [stopper, echoTool] },
  );

  const end = await session.send('go', { signal: controller.signal });

  assert.equal(end.interrupted, true);
  const results = session.history.at(-1).content;
  assert.deepEqual(results.map((r) => r.tool_use_id), ['a', 'b']);
  assert.equal(results[0].content, 'finished anyway');
  assert.equal(results[1].is_error, true);
  assert.match(results[1].content, /Interrupted by user/);
});

test('a reply cut off by max_tokens does not run its (possibly incomplete) tool call', async () => {
  const { provider, session } = setup([
    { text: 'Reading', tools: [{ name: 'Echo', input: {} }], stopReason: 'max_tokens' },
    { text: 'Again', tools: [{ name: 'Echo', input: {} }], stopReason: 'max_tokens' },
  ]);
  const end = await session.send('go');

  // Phase 18: the model is told once why nothing ran, then the loop stops.
  assert.equal(provider.requests.length, 2);
  assert.match(JSON.stringify(provider.requests[1].messages.at(-1)), /output limit \(max_tokens\).*NOT run/);
  assert.equal(end.stopReason, 'max_tokens');
  // The tool_use blocks were dropped, so history has no unanswered tool call.
  assert.deepEqual(session.history[1].content, [{ type: 'text', text: 'Reading' }]);
  assert.equal(JSON.stringify(session.history).includes('tool_use'), false);
});

test('an API error in a later round keeps the completed rounds', async () => {
  const { session } = setup([
    { tools: [{ id: 'a', name: 'Echo', input: { say: 'x' } }] },
    new ApiError(400, 'invalid_request_error', 'bad request'),
  ]);
  await assert.rejects(session.send('go'), /bad request/);
  assert.deepEqual(
    session.history.map((m) => m.role),
    ['user', 'assistant', 'user'],
  );
});

test('usage and cost add up over all rounds', async () => {
  const { session } = setup(
    [{ tools: [{ name: 'Echo', input: { say: 'x' } }] }, { text: 'done' }],
    { model: 'claude-opus-5-5' },
  );
  const end = await session.send('go');
  assert.equal(end.usage.input_tokens, 20);
  assert.equal(session.usage.output_tokens, 10);
  assert.ok(end.cost > 0);
});

test('batchTools groups neighbouring read-only tools and isolates the rest', () => {
  const writer = defineTool({ name: 'Writer', description: 'w', inputSchema: { type: 'object' }, call: async () => ({ content: '' }) });
  const { session } = setup([], { tools: [echoTool, writer] });
  const uses = ['Echo', 'Echo', 'Writer', 'Echo', 'Writer', 'Writer'].map((name, i) => ({ id: String(i), name }));
  assert.deepEqual(
    batchTools(session, uses).map((batch) => batch.map((use) => use.id)),
    [['0', '1'], ['2'], ['3'], ['4'], ['5']],
  );
});

test('read-only tools in one reply run at the same time; results keep the model\'s order', async () => {
  const running = { now: 0, max: 0 };
  const slow = (name, ms) =>
    defineTool({
      name,
      description: 'slow',
      isReadOnly: true,
      inputSchema: { type: 'object' },
      call: async () => {
        running.max = Math.max(running.max, ++running.now);
        await new Promise((resolve) => setTimeout(resolve, ms));
        running.now--;
        return { content: name };
      },
    });
  const { provider, session } = setup(
    [{ tools: [{ id: 'a', name: 'Slow' }, { id: 'b', name: 'Fast' }] }, { text: 'done' }],
    { tools: [slow('Slow', 80), slow('Fast', 10)] },
  );
  await session.send('go');
  assert.equal(running.max, 2);
  assert.deepEqual(provider.requests[1].messages.at(-1).content.map((r) => r.content), ['Slow', 'Fast']);
});
