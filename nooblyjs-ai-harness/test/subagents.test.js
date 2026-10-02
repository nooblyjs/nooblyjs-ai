// Phase 13: subagents and the Task tool.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadAgents } from '../src/agents/definitions.js';
import { toolsForAgent } from '../src/agents/subagent.js';
import { runCommand } from '../src/commands/index.js';
import { batchTools } from '../src/core/loop.js';
import { EVENT } from '../src/core/events.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createDefaultTools } from '../src/tools/index.js';
import { collect, makeProject } from './helpers.js';

/**
 * A fake provider that answers by looking at the request, so parent and
 * children (which share it, possibly at the same time) each get their own script.
 * `route(request)` returns { text?, tools? } like the mock provider.
 */
function routingProvider(route) {
  const requests = [];
  let ids = 0;
  return {
    name: 'routing',
    requests,
    async *stream(request) {
      requests.push(structuredClone(request));
      const reply = await route(request);
      const toolUses = (reply.tools ?? []).map((t) => ({ type: 'tool_use', id: t.id ?? `toolu_${++ids}`, name: t.name, input: t.input }));
      const content = [...(reply.text ? [{ type: 'text', text: reply.text }] : []), ...toolUses];
      yield { type: EVENT.MESSAGE_START, model: request.model, usage: { input_tokens: 100 } };
      yield { type: EVENT.MESSAGE, message: { model: request.model, content, stop_reason: toolUses.length ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } } };
    },
  };
}

const isChild = (request) => request.system.includes('subagent');
const lastUser = (request) => request.messages.at(-1);
const hasToolResult = (request) => Array.isArray(lastUser(request).content) && lastUser(request).content[0]?.type === 'tool_result';
const task = (prompt, type = 'explore', id) => ({ id, name: 'Task', input: { subagent_type: type, description: prompt.slice(0, 20), prompt } });

async function setup(route, options = {}) {
  const cwd = await makeProject({ 'src/settings.js': 'export const x = readSetting("model");\n' });
  const provider = routingProvider(route);
  const session = new Session({ provider, cwd, tools: createDefaultTools(), retry: { maxRetries: 0 }, permissions: createPermissions(), ...options });
  return { provider, session, cwd };
}

test('a subagent works in its own history and returns only its final reply', async () => {
  const { provider, session } = await setup((request) => {
    if (isChild(request)) {
      if (!hasToolResult(request)) return { text: 'Searching.', tools: [{ name: 'Grep', input: { pattern: 'readSetting' } }] };
      return { text: 'Settings are read in src/settings.js:1.' };
    }
    if (!hasToolResult(request)) return { tools: [task('Find where settings are read')] };
    return { text: 'Done.' };
  });

  const events = await collect(session.stream('where are settings read?'));

  // The parent sees one tool result: the child's final text. Not its Grep call or output.
  const parentResult = lastUser(provider.requests.at(-1)).content[0];
  assert.equal(parentResult.content, 'Settings are read in src/settings.js:1.');
  assert.doesNotMatch(JSON.stringify(session.history), /readSetting\("model"\)/);
  assert.equal(session.history.length, 4);

  // The child started from scratch: its first request has only the task.
  const childFirst = provider.requests.find(isChild);
  assert.deepEqual(childFirst.messages, [{ role: 'user', content: 'Find where settings are read' }]);
  assert.match(childFirst.system, /"explore" subagent/);

  // Its progress was forwarded for the UI.
  const progress = events.filter((e) => e.type === EVENT.SUBAGENT);
  assert.deepEqual(progress.map((e) => [e.agent, e.event.type, e.event.name]), [['explore', 'tool_start', 'Grep'], ['explore', 'tool_end', 'Grep']]);
  assert.equal(progress[0].parentId, events.find((e) => e.type === 'tool_start').id);
});

test('the subagent\'s tokens are added to the parent\'s turn and /cost', async () => {
  const { session } = await setup((request) => {
    if (isChild(request)) return { text: 'Found it.' };
    return hasToolResult(request) ? { text: 'Done.' } : { tools: [task('look')] };
  });
  const end = await session.send('go');
  // Parent: 2 requests; child: 1 request. 100 input tokens each.
  assert.equal(end.usage.input_tokens, 300);
  assert.equal(session.usage.input_tokens, 300);
});

test('the explore agent only has read-only tools: Edit is not available to it', async () => {
  const { provider, session } = await setup((request) => {
    if (isChild(request)) {
      if (!hasToolResult(request)) return { tools: [{ name: 'Edit', input: { file_path: 'src/settings.js', old_string: 'x', new_string: 'y' } }] };
      return { text: 'Could not edit.' };
    }
    return hasToolResult(request) ? { text: 'Done.' } : { tools: [task('change the file')] };
  });
  await session.send('go');
  const child = provider.requests.filter(isChild);
  assert.deepEqual(child[0].tools.map((t) => t.name), ['Read', 'Glob', 'Grep']);
  assert.match(lastUser(child[1]).content[0].content, /There is no tool called "Edit"/);
});

test('subagents cannot start subagents, or leave plan mode', () => {
  const general = toolsForAgent(createDefaultTools(), { name: 'general', tools: null });
  assert.equal(general.get('Task'), undefined);
  assert.equal(general.get('ExitPlanMode'), undefined);
  assert.ok(general.get('Edit'));
});

test('parallel Task calls run at the same time and both complete', async () => {
  let arrived = 0;
  let release;
  const bothStarted = new Promise((resolve) => (release = resolve));
  const { provider, session } = await setup(async (request) => {
    if (isChild(request)) {
      // Each child waits until BOTH have sent their first request: only possible if they run in parallel.
      if (++arrived === 2) release();
      await Promise.race([bothStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('subagents ran one after the other')), 2000))]);
      return { text: `Answer to: ${request.messages[0].content}` };
    }
    return hasToolResult(request) ? { text: 'Done.' } : { tools: [task('question A', 'explore', 'a'), task('question B', 'explore', 'b')] };
  });
  await session.send('go');
  const results = lastUser(provider.requests.at(-1)).content;
  assert.deepEqual(results.map((r) => [r.tool_use_id, r.content]), [['a', 'Answer to: question A'], ['b', 'Answer to: question B']]);
});

test('Task with an agent that can edit runs alone; read-only agents can share a batch', async () => {
  const { session } = await setup(() => ({ text: '' }));
  const uses = [task('a', 'explore', '1'), task('b', 'explore', '2'), task('c', 'general', '3'), { id: '4', name: 'Read', input: { file_path: 'x' } }];
  assert.deepEqual(batchTools(session, uses).map((batch) => batch.map((u) => u.id)), [['1', '2'], ['3'], ['4']]);
});

test('subagents share the permission gate: plan mode binds them, questions reach the user', async () => {
  const asked = [];
  const { provider, session } = await setup(
    (request) => {
      if (isChild(request)) {
        if (!hasToolResult(request)) return { tools: [{ name: 'Bash', input: { command: 'npm test' } }] };
        return { text: `Result: ${lastUser(request).content[0].content}` };
      }
      return hasToolResult(request) ? { text: 'Done.' } : { tools: [task('run the tests', 'general')] };
    },
    { requestPermission: async (request) => (asked.push(`${request.agent}: ${request.tool.name}`), { behavior: 'deny' }) },
  );
  await session.send('go');
  assert.deepEqual(asked, ['general: Bash']);

  session.permissions.mode = 'plan';
  await session.send('again');
  assert.match(lastUser(provider.requests.at(-1)).content[0].content, /plan mode, so Bash is not allowed/);
});

test('unknown subagent types are explained to the model', async () => {
  const { provider, session } = await setup((request) => (hasToolResult(request) ? { text: 'ok' } : { tools: [task('x', 'wizard')] }));
  await session.send('go');
  assert.match(lastUser(provider.requests.at(-1)).content[0].content, /no subagent called "wizard".*explore/);
});

test('your own agents load from .noobly/agents, with tools and model', async () => {
  const cwd = await makeProject({
    '.noobly/agents/test-runner.md': '---\nname: test-runner\ndescription: Runs tests\ntools: Bash, Read\nmodel: small-model\n---\nRun npm test and report failures.',
    'home/agents/explore.md': '---\ndescription: My own explorer\n---\nBe brief.',
  });
  const agents = loadAgents(cwd, { nooblyDir: path.join(cwd, 'home') });
  const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName), ['general', 'explore', 'test-runner']);
  assert.equal(byName.explore.description, 'My own explorer', 'yours replace built-ins with the same name');
  assert.deepEqual(byName['test-runner'].tools, ['Bash', 'Read']);
  assert.equal(byName['test-runner'].model, 'small-model');
  assert.equal(byName['test-runner'].instructions, 'Run npm test and report failures.');

  const session = new Session({ provider: routingProvider(() => ({})), cwd, context: { agents } });
  assert.match((await runCommand('/agents', session)).text, /test-runner\s+Runs tests\s+tools: Bash, Read · model: small-model · project/);
  assert.match(session.systemPrompt, /# Subagents[\s\S]*- test-runner: Runs tests \(tools: Bash, Read\)/);
});
