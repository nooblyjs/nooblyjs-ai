// services/host-tasks.js: what other NooblyJS apps ask of Teammates through register()'s `services`. The team as they
// see it, who can take work, and one task run as a teammate: checked, billed to a NooblyJS team and attributed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp } from '../helpers.js';
import { AnthropicProvider } from '../../src/services/providers/anthropic.js';
import { createProviders } from '../../src/services/providers/index.js';
import { HostTaskService } from '../../src/services/host-tasks.js';

let app;
let tasks;
before(async () => {
  app = await startApp();
  tasks = app.hostTasks;
});
after(() => app.close());

const lerato = { type: 'user', id: 'lerato-m', name: 'Lerato M.' };
const entriesFor = (id) => app.repos.timesheets.listRange(id, '2026-10-01', '2026-10-01');
const hostEvents = (type) => app.host.eventLog.filter((e) => e.type === type).map((e) => e.payload);

test('the team as other apps see it: who they are, their status, model and rate', async () => {
  const roster = await tasks.roster();
  assert.equal(roster.length, 10); // with Ines Tau (NooblyJS Phase 26)
  const rhea = roster.find((t) => t.id === 'rhea-voss');
  assert.deepEqual(
    { name: rhea.name, role: rhea.role, statusText: rhea.statusText, canWork: rhea.canWork, model: rhea.model, rate: rhea.rate },
    { name: 'Rhea Voss', role: 'Architect', statusText: 'On a task', canWork: true, model: { key: 'opus', name: 'Claude Opus', tier: '$$$' }, rate: 52 },
  );
  assert.equal((await tasks.get('ada-quill')).name, 'Ada Quill');
  assert.equal(await tasks.get('nobody'), null);
  assert.equal(tasks.provider(), 'mock');
});

test('a paused, off-shift or unknown teammate cannot take work, and the reason reads as a sentence', async () => {
  assert.deepEqual(await tasks.availability('ada-quill'), { ok: true });
  assert.deepEqual(await tasks.availability('sable-reyes'), { ok: false, code: 'teammate_paused', message: 'Sable Reyes is paused. Resume them to assign work.' });
  assert.equal((await tasks.availability('rook-vale')).code, 'teammate_off_shift');
  assert.equal((await tasks.availability('nobody')).code, 'not_found');
  const roster = await tasks.roster();
  assert.equal(roster.find((t) => t.id === 'sable-reyes').canWork, false);
  assert.match(roster.find((t) => t.id === 'sable-reyes').unavailable, /paused/);
});

test('with no model configured, a task plays the caller\'s script, and is still billed and attributed', async () => {
  const before = (await entriesFor('ada-quill')).length;
  const script = { text: 'Here is where PRD-031 stands.', cards: [{ type: 'facts', title: 'PRD-031 · status', rows: [] }] };
  const result = await tasks.runTask({
    slug: 'ada-quill', workType: 'chat.reply', itemId: 'PRD-031', system: 'product', caller: lerato,
    billTo: { teamId: 'delivery-squad', teamName: 'Delivery squad' },
    input: { task: "@Ada what's still blocking the slot pilot?", context: 'Stage: Architecture', history: [{ author: 'Thabo N.', text: 'Will look at the ADR after lunch' }] },
    scripted: async () => ({ output: script, costUsd: 0.18 }),
  });

  // The script comes back as it was given, with the model cost it names.
  assert.deepEqual(result.output, script);
  assert.equal(result.costUsd, 0.18);
  assert.equal(result.modelRoute, 'mock/scripted');
  assert.equal(result.scripted, true);
  assert.equal(result.team, 'Delivery squad');
  assert.equal(result.hours, 0.1);
  assert.equal(result.amount, 4.8);

  // The timesheet: one entry, to the NooblyJS team, for the person who asked.
  const entries = await entriesFor('ada-quill');
  assert.equal(entries.length, before + 1);
  const entry = entries.find((e) => e.workId === result.workId);
  assert.deepEqual(
    { costCentre: entry.costCentre, hours: entry.hours, amount: entry.amount, apiCost: entry.apiCost, caller: entry.caller },
    { costCentre: 'Delivery squad', hours: 0.1, amount: 4.8, apiCost: 0.18, caller: 'Lerato M.' },
  );

  // The work item records what it was for, and that it was a script. A script teaches the teammate nothing.
  const work = await app.repos.work.get('ada-quill', result.workId);
  assert.deepEqual(
    { itemId: work.itemId, system: work.system, workType: work.workType, teamId: work.teamId, scripted: work.scripted, memoriesAdded: work.memoriesAdded, toolCalls: work.toolCalls },
    { itemId: 'PRD-031', system: 'product', workType: 'chat.reply', teamId: 'delivery-squad', scripted: true, memoriesAdded: [], toolCalls: [] },
  );

  // NooblyJS hears about it, with the context every agent action carries.
  const finished = hostEvents('teammate.task_finished').find((e) => e.workId === result.workId);
  assert.deepEqual(
    { teammateId: finished.teammateId, itemId: finished.itemId, system: finished.system, modelRoute: finished.modelRoute, costUsd: finished.costUsd, team: finished.team, workType: finished.workType },
    { teammateId: 'ada-quill', itemId: 'PRD-031', system: 'product', modelRoute: 'mock/scripted', costUsd: 0.18, team: 'Delivery squad', workType: 'chat.reply' },
  );
  const audited = app.host.auditLog.find((a) => a.target === result.workId);
  assert.deepEqual([audited.actor, audited.action, audited.requestedBy, audited.costUsd], ['ada-quill', 'agent.chat.reply', 'lerato-m', 0.18]);
});

test('a task for a paused teammate is refused, bills nothing, and NooblyJS is told why', async () => {
  const before = (await entriesFor('sable-reyes')).length;
  await assert.rejects(
    tasks.runTask({ slug: 'sable-reyes', workType: 'chat.reply', itemId: 'PRD-031', system: 'product', caller: lerato, input: { task: '@Sable a headline please' }, scripted: async () => ({ output: 'x', costUsd: 1 }) }),
    (err) => err.status === 409 && err.code === 'teammate_paused',
  );
  assert.equal((await entriesFor('sable-reyes')).length, before);
  const refused = hostEvents('teammate.task_refused').at(-1);
  assert.deepEqual([refused.teammateId, refused.code, refused.costUsd], ['sable-reyes', 'teammate_paused', 0]);
});

test('a team NooblyJS names becomes a cost centre; without one the teammate\'s own is billed', async () => {
  const named = await tasks.runTask({ slug: 'pip-okafor', workType: 'meeting.answer', billTo: { teamName: 'Locker squad' }, input: { task: 'Book the room' }, scripted: async () => ({ output: 'Done.' }) });
  assert.equal(named.team, 'Locker squad');
  assert.ok((await app.repos.config.getSettings()).costCentres.includes('Locker squad'));
  const own = await tasks.runTask({ slug: 'pip-okafor', workType: 'meeting.answer', input: { task: 'Book the room again' }, scripted: async () => ({ output: 'Done.' }) });
  assert.equal(own.team, 'Operations');
  // No caller: the work was asked for by NooblyJS itself.
  assert.equal((await app.repos.work.get('pip-okafor', own.workId)).caller.name, 'NooblyJS');
});

test('a task needs words and a work type', async () => {
  await assert.rejects(tasks.runTask({ slug: 'ada-quill', workType: 'chat.reply', input: {} }), (err) => err.status === 400);
  await assert.rejects(tasks.runTask({ slug: 'ada-quill', workType: 'Chat Reply', input: { task: 'x' } }), (err) => err.status === 400);
});

test('a host task runs without tools and past the approval threshold, because a person asked for it', async () => {
  // Ada has fetch_url and an approval threshold of $200; a URL in the task would make the mock call the tool.
  await app.repos.teammates.update('ada-quill', () => ({ approvalThreshold: 0.01 }));
  const result = await tasks.runTask({ slug: 'ada-quill', workType: 'chat.reply', caller: lerato, input: { task: 'Read https://example.com/pricing and summarise it' } });
  assert.equal(result.scripted, false);
  assert.equal(result.modelRoute, 'mock/claude-opus-5-5');
  const work = await app.repos.work.get('ada-quill', result.workId);
  assert.deepEqual(work.toolCalls, []);
  assert.equal(work.status, 'succeeded');
});

test('with a real provider the model answers: the script is ignored and the model cost is what it used', async () => {
  let asked = null;
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const reflecting = JSON.stringify(body.system).includes('long-term memory');
      if (!reflecting) asked = body;
      const text = reflecting ? '[]' : 'ADR-014 is the one blocker.';
      const events = [
        { type: 'message_start', message: { model: body.model, content: [], usage: { input_tokens: 2000 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 400 } },
      ];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const anthropic = new AnthropicProvider({ apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${fake.address().port}`, env: {} });
  const real = await startApp({ providers: { get: () => anthropic, describe: () => 'anthropic' } });
  try {
    const result = await real.hostTasks.runTask({
      slug: 'ada-quill', workType: 'chat.reply', itemId: 'PRD-031', system: 'product', caller: lerato,
      input: { task: "What's blocking the pilot?", context: 'Waiting on: Thabo N.', history: [{ author: 'Lerato M.', text: 'Agenda: the slot rollout' }] },
      scripted: async () => { throw new Error('the script must not be read when a model answers'); },
    });
    assert.equal(result.output, 'ADR-014 is the one blocker.');
    assert.equal(result.scripted, false);
    assert.equal(result.modelRoute, 'anthropic/claude-opus-5-5');
    assert.ok(result.costUsd > 0);
    // What NooblyJS knows and the conversation reach the model as context; no tools are offered.
    const system = JSON.stringify(asked.system);
    assert.match(system, /Waiting on: Thabo N\./);
    assert.match(system, /Lerato M\.: Agenda: the slot rollout/);
    assert.equal(asked.tools, undefined);
  } finally {
    await real.close();
    fake.close();
  }
});

test('production refuses the direct Anthropic API, asked for or picked up from the credentials', () => {
  const production = { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-live' };
  assert.throws(() => createProviders({ mode: 'anthropic', env: production }), /development only/);
  assert.throws(() => createProviders({ mode: undefined, env: production }), /development only/);
  // The mock, and production with no direct credentials, start.
  assert.equal(createProviders({ mode: 'mock', env: production }).describe(), 'mock');
  assert.equal(createProviders({ mode: undefined, env: { NODE_ENV: 'production' } }).describe(), 'mock');
  // Development may use it.
  assert.equal(createProviders({ mode: undefined, env: { NODE_ENV: 'development', ANTHROPIC_API_KEY: 'sk-dev' } }).describe(), 'anthropic');
});

// ── NooblyJS Platform: the check before every task, the model route, Stop (NooblyJS Phase 9) ─────────────────────────────

/** A HostTaskService like the app's, asking `platform` first. */
const withPlatform = (platform, base = tasks) => new HostTaskService({ ...base, platform: () => platform });
const SONNET_ROUTE = { id: 'implementation-tests', label: 'Implementation & tests', model: 'claude-sonnet-5-5', modelLabel: 'Claude Sonnet 5.5', fallback: 'claude-haiku-4-5', fallbackLabel: 'Claude Haiku 4.5', provider: 'bedrock' };

test('Platform refuses before anything starts: no task_started, nothing billed, NooblyJS is told why', async () => {
  const asked = [];
  const platform = { checkAgentWork: async (q) => { asked.push(q); return { ok: false, code: 'repo_no_access', message: 'Agents have no access to acme/payments-gateway.' }; } };
  const before = (await entriesFor('ada-quill')).length;
  const started = hostEvents('teammate.task_started').length;
  await assert.rejects(
    withPlatform(platform).runTask({ slug: 'ada-quill', workType: 'chat.reply', system: 'home', repo: 'acme/payments-gateway', caller: lerato, input: { task: 'Summarise payments-gateway' }, scripted: async () => ({ output: 'x' }) }),
    (err) => err.status === 403 && err.code === 'repo_no_access',
  );
  assert.deepEqual(asked, [{ system: 'home', workType: 'chat.reply', repo: 'acme/payments-gateway', teammateId: 'ada-quill', itemId: null }]);
  assert.equal(hostEvents('teammate.task_started').length, started);
  assert.equal((await entriesFor('ada-quill')).length, before);
  const refused = hostEvents('teammate.task_refused').at(-1);
  assert.deepEqual([refused.code, refused.repo], ['repo_no_access', 'acme/payments-gateway']);

  const paused = { checkAgentWork: async () => ({ ok: false, code: 'budget_reached', message: 'Agents are paused: Product Factory has reached its $400 budget.' }) };
  await assert.rejects(withPlatform(paused).runTask({ slug: 'ada-quill', workType: 'spec-drafting', system: 'product', input: { task: 'Draft' } }), (err) => err.status === 402 && /paused/.test(err.message));
});

test('the route for the work type answers: its model is in modelRoute and on the work item', async () => {
  const platform = { checkAgentWork: async () => ({ ok: true, route: SONNET_ROUTE }) };
  const result = await withPlatform(platform).runTask({ slug: 'ada-quill', workType: 'chat.reply', caller: lerato, input: { task: 'Status?' }, scripted: async () => ({ output: 'On track.', costUsd: 0.05 }) });
  assert.equal(result.modelRoute, 'mock/claude-sonnet-5-5');
  assert.equal(result.scripted, true);
  const work = await app.repos.work.get('ada-quill', result.workId);
  assert.deepEqual([work.modelId, work.route], ['claude-sonnet-5-5', 'implementation-tests']);
});

test('a running task is a workload; Stop cancels it and it leaves the runtime', async () => {
  const running = new Map();
  const platform = {
    checkAgentWork: async () => ({ ok: true, route: null }),
    containers: {
      register(workload) {
        const id = `wl-${running.size + 1}`;
        running.set(id, workload);
        workload.stop(); // Stop at once: the task must end cancelled
        return () => running.delete(id);
      },
    },
  };
  await assert.rejects(withPlatform(platform).runTask({ slug: 'ada-quill', workType: 'chat.reply', repo: 'web-storefront', input: { task: 'A long job' } }), (err) => err.status === 499 && err.code === 'cancelled');
  assert.equal(running.size, 0);
});

test('when the route\'s model fails, its fallback answers once and modelRoute says so', async () => {
  const answer = (name, fail) => ({
    name,
    async run({ model }) {
      if (fail(model)) throw new Error('overloaded');
      return { text: 'Fallback answer.', content: [{ type: 'text', text: 'Fallback answer.' }], toolCalls: [], stopReason: 'end_turn', stopDetails: null, servedBy: model.modelId, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    },
  });
  const bedrock = answer('bedrock', (m) => m.modelId === 'claude-sonnet-5-5');
  const real = await startApp({ providers: { get: () => bedrock, describe: () => 'bedrock' } });
  try {
    const platform = { checkAgentWork: async () => ({ ok: true, route: SONNET_ROUTE }) };
    const result = await withPlatform(platform, real.hostTasks).runTask({ slug: 'ada-quill', workType: 'chat.reply', input: { task: 'Status?' } });
    assert.equal(result.output, 'Fallback answer.');
    assert.equal(result.modelRoute, 'bedrock/claude-haiku-4-5');
  } finally {
    await real.close();
  }
});

test('a route on a cloud host uses it when its credentials are set; until then the direct API in development, else the mock', () => {
  const route = { provider: 'bedrock', modelId: 'claude-sonnet-5-5' };
  const aws = { AWS_REGION: 'eu-west-1', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' };
  assert.equal(createProviders({ env: { NODE_ENV: 'production', ...aws } }).get(route).name, 'bedrock');
  assert.equal(createProviders({ env: { NODE_ENV: 'development', ANTHROPIC_API_KEY: 'sk' } }).get(route).name, 'anthropic');
  assert.equal(createProviders({ env: { NODE_ENV: 'production' } }).get(route).name, 'mock');
  assert.equal(createProviders({ env: { NODE_ENV: 'production', ...aws } }).describe(), 'bedrock');
  assert.throws(() => createProviders({ mode: 'vertex', env: { VERTEX_PROJECT_ID: 'p' } }), /GOOGLE_APPLICATION_CREDENTIALS/);
});
