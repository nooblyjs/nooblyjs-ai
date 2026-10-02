// Phase 11: the todo list and leaving plan mode.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createDefaultTools } from '../src/tools/index.js';
import { checkTodos, formatTodos, todosFromHistory, todoWriteTool } from '../src/tools/todo.js';
import { collect, makeProject } from './helpers.js';

const todos = [
  { content: 'Read the code', status: 'completed' },
  { content: 'Run the tests', status: 'in_progress', activeForm: 'Running the tests' },
  { content: 'Update the docs', status: 'pending' },
];

function setup(script, options = {}) {
  const provider = createMockProvider(script);
  const session = new Session({ provider, retry: { maxRetries: 0 }, tools: createDefaultTools(), ...options });
  return { provider, session };
}

const lastToolResult = (provider, n) => provider.requests[n].messages.at(-1).content[0];

test('TodoWrite replaces the whole list and shows it as a checklist', async () => {
  const session = { todos: [] };
  const output = await todoWriteTool.call({ todos }, { session });
  assert.deepEqual(session.todos, todos);
  assert.equal(output.display, '1/3 done');
  assert.deepEqual(output.preview, ['☒ Read the code', '◐ Running the tests', '☐ Update the docs']);
  assert.match(output.content, /2 item\(s\) still open/);

  await todoWriteTool.call({ todos: [] }, { session });
  assert.deepEqual(session.todos, []);
});

test('TodoWrite refuses two items in progress, bad statuses and empty items', () => {
  assert.match(checkTodos([{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }]), /one thing at a time/);
  assert.match(checkTodos([{ content: 'a', status: 'done' }]), /status "done"/);
  assert.match(checkTodos([{ content: ' ', status: 'pending' }]), /non-empty/);
  assert.equal(checkTodos(todos), null);
});

test('TodoWrite works in plan mode (it only changes noobly\'s notes), and /todos shows the list', async () => {
  const { session } = setup([{ tools: [{ name: 'TodoWrite', input: { todos } }] }, { text: 'ok' }], {
    permissions: createPermissions({ mode: 'plan' }),
  });
  const events = await collect(session.stream('plan it'));
  assert.equal(events.find((e) => e.type === 'tool_end').isError, false);
  assert.match((await runCommand('/todos', session)).text, /◐ Running the tests/);
});

test('the todo list survives compaction: it comes back as a reminder in the next message', async () => {
  const { provider, session } = setup([
    { tools: [{ name: 'TodoWrite', input: { todos } }] },
    { text: 'Working on it.' },
    { text: 'Summary of the work so far.' }, // the compaction summary
    { text: 'Continuing.' },
  ]);
  await session.send('do three things');
  await session.compact({ force: true });
  assert.equal(JSON.stringify(session.history).includes('TodoWrite'), false, 'the TodoWrite call was summarised away');

  await session.send('go on');
  const sent = JSON.stringify(provider.requests[3].messages.at(-1));
  assert.match(sent, /Your todo list/);
  assert.match(sent, /\[in_progress\] Run the tests/);

  // Only once.
  const again = setup([{ text: 'x' }]);
  again.session.todos = todos;
  await again.session.send('hi');
  assert.doesNotMatch(JSON.stringify(again.provider.requests[0].messages), /Your todo list/);
});

test('auto-compaction puts the todo reminder into the SAME message', async () => {
  const { provider, session } = setup(
    [
      { tools: [{ name: 'TodoWrite', input: { todos } }] },
      { text: 'Working on it.' },
      { text: 'x'.repeat(2000) },
      { text: 'Summary.' }, // auto-compaction of the first turn
      { text: 'Continuing.' },
    ],
    // The system prompt and tools alone are ~3,000 tokens; the long second reply pushes past 55% of 6,000.
    { settings: { contextWindow: 6000, compactThreshold: 0.55 } },
  );
  await session.send('do three things');
  await session.send('and then?');
  const events = await collect(session.stream('go on'));
  assert.ok(events.some((e) => e.type === 'compact'));
  assert.match(JSON.stringify(provider.requests.at(-1).messages.at(-1)), /Your todo list/);
});

test('resuming rebuilds the todo list from the last successful TodoWrite', () => {
  const history = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'TodoWrite', input: { todos } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'TodoWrite', input: { todos: [{ content: 'x', status: 'nope' }] } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'Invalid', is_error: true }] },
  ];
  assert.deepEqual(todosFromHistory(history), todos);
  assert.deepEqual(todosFromHistory([]), []);
});

test('plan mode blocks mutations, and ExitPlanMode needs approval before anything changes', async () => {
  const dir = await makeProject({});
  const asked = [];
  const { provider, session } = setup(
    [
      { tools: [{ name: 'Write', input: { file_path: 'a.txt', content: 'x' } }] },
      { tools: [{ name: 'ExitPlanMode', input: { plan: '1. Write a.txt' } }] },
      { tools: [{ name: 'Write', input: { file_path: 'a.txt', content: 'x' } }] },
      { text: 'Done.' },
    ],
    {
      cwd: dir,
      permissions: createPermissions({ mode: 'plan' }),
      requestPlanApproval: async (request) => {
        asked.push(request.plan);
        return { behavior: 'approve', mode: 'acceptEdits' };
      },
    },
  );
  await session.send('write a.txt');

  assert.match(lastToolResult(provider, 1).content, /plan mode, so Write is not allowed/);
  assert.deepEqual(asked, ['1. Write a.txt']);
  assert.match(lastToolResult(provider, 2).content, /approved your plan.*"accept edits"/s);
  assert.equal(session.permissions.mode, 'acceptEdits');
  assert.equal(lastToolResult(provider, 3).is_error, undefined, 'the Write now runs without asking');
});

test('a rejected plan keeps plan mode and passes the feedback to the model', async () => {
  const { provider, session } = setup([{ tools: [{ name: 'ExitPlanMode', input: { plan: 'Delete everything' } }] }, { text: 'Revising.' }], {
    permissions: createPermissions({ mode: 'plan' }),
    requestPlanApproval: async () => ({ behavior: 'reject', message: 'keep the tests' }),
  });
  await session.send('clean up');
  const result = lastToolResult(provider, 1);
  assert.equal(result.is_error, true);
  assert.match(result.content, /did not approve.*keep the tests.*still in plan mode/s);
  assert.equal(session.permissions.mode, 'plan');
});

test('ExitPlanMode outside plan mode, and without a UI, explain themselves', async () => {
  const outside = setup([{ tools: [{ name: 'ExitPlanMode', input: { plan: 'x' } }] }, { text: 'ok' }]);
  await outside.session.send('go');
  assert.match(lastToolResult(outside.provider, 1).content, /not in plan mode/);

  const headless = setup([{ tools: [{ name: 'ExitPlanMode', input: { plan: 'x' } }] }, { text: 'ok' }], { permissions: createPermissions({ mode: 'plan' }) });
  await headless.session.send('go');
  assert.match(lastToolResult(headless.provider, 1).content, /non-interactively/);
});

test('formatTodos uses activeForm for the item in progress', () => {
  assert.deepEqual(formatTodos([{ content: 'Run tests', status: 'in_progress' }]), ['◐ Run tests']);
});
