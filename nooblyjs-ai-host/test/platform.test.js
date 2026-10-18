// Roadmap Phase 9, the test script, through the real apps: NooblyJS with the Product Factory, the lifecycle engine,
// Digital Teammates, the Wiki and the Software Factory hosted. Each step is what a person does, and what the files
// and the audit log then say. No model is configured: agents play their scripts, and the route shows as
// mock/<model>. The same steps run in a browser in test/e2e/platform.story.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually, clockDay, clockNow } from './helpers.js';

let env;
let stevie;
let lerato;
const patch = (c, url, json) => c.request(url, { method: 'PATCH', json });
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const audit = async (action) => (await today(env.store, 'audit')).filter((a) => a.action === action);

before(async () => {
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-knowledge', mountPath: '/wiki', enabled: true },
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
    ],
  });
  [stevie, lerato] = [env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
});
after(async () => { await env?.stop(); });

test('step 1: payments-gateway set to "No agent access"; asking a teammate to read it is refused, and the refusal is audited', async () => {
  assert.equal((await patch(stevie, '/api/v1/platform/repositories/acme__payments-gateway', { access: 'read' })).status, 200);
  assert.equal((await patch(stevie, '/api/v1/platform/repositories/acme__payments-gateway', { access: 'none' })).status, 200);
  const { body } = await stevie.json('/api/v1/chat/thread?kind=repository&id=acme__payments-gateway');
  assert.equal((await post(stevie, `/api/v1/chat/threads/${body.thread.id}/messages`, { text: '@Ada summarise what this repository does' })).status, 201);
  await env.noobly.chat.settled();
  const { messages } = (await stevie.json('/api/v1/chat/thread?kind=repository&id=acme__payments-gateway')).body;
  assert.equal(messages.at(-1).text, "Ada Quill couldn't answer. Agents have no access to acme/payments-gateway. An Owner can grant it in Platform · Repositories. Nothing was posted on their behalf.");
  const [refused] = await audit('agent.work_refused');
  assert.deepEqual([refused.actor, refused.code, refused.repo, refused.workType], ['ada-quill', 'repo_no_access', 'acme/payments-gateway', 'chat.reply']);
  // Digital Teammates was refused before anything started: no task, nothing billed.
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'teammate.task_refused' && e.payload.code === 'repo_no_access'));
  assert.ok(!events.some((e) => e.type === 'teammate.task_started' && e.payload.teammateId === 'ada-quill'));
});

test('step 2: the Product Factory budget below this month\'s spend pauses its agents; budget.reached is in Activity; a new draft says why', async () => {
  const saved = await patch(stevie, '/api/v1/platform/settings/budgets', { systems: { product: 400 } });
  assert.deepEqual((await saved.json()).reached, [{ budget: 'product', text: 'Product Factory has reached its $400 budget' }]);
  const { body } = await lerato.json('/api/v1/activity?filter=platform');
  assert.ok(body.rows.some((r) => r.type === 'budget.reached' && /Product Factory reached its \$400 budget \(\$412 spent\): its agents are paused/.test(r.action)));
  const refused = await post(lerato, '/product/api/v1/specs/PRD-031/drafts', { kind: 'rollout-plan' });
  assert.equal(refused.status, 402);
  assert.equal((await refused.json()).error.message, 'Agents are paused: Product Factory has reached its $400 budget ($412 spent this month). An Owner can raise it in Platform · Settings · Budgets.');
  // Other systems keep working, and raising it again lets drafting go on, with no restart.
  assert.equal((await env.noobly.platform.checkAgentWork({ system: 'home', workType: 'chat.reply' })).ok, true);
  await patch(stevie, '/api/v1/platform/settings/budgets', { systems: { product: 1500 } });
  assert.equal((await env.noobly.platform.checkAgentWork({ system: 'product', workType: 'spec-drafting' })).ok, true);
});

test('step 3: "Redact personal data on ingest" off needs an Owner and a reason; it shows in policy history and the audit log; the next import is not redacted', async () => {
  assert.equal((await patch(lerato, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: false, reason: 'Importing contacts' })).status, 403);
  assert.equal((await patch(stevie, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: false })).status, 400);
  assert.equal((await patch(stevie, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: false, reason: 'Importing the contacts export for the pilot' })).status, 200);
  await eventually(async () => {
    const { history } = (await lerato.json('/api/v1/platform/guardrails/history')).body;
    assert.deepEqual(history.map((h) => [h.guardrail, h.from, h.to, h.actorName, h.reason]), [['redact-on-ingest', true, false, 'Stevie', 'Importing the contacts export for the pilot']]);
  });
  const [changed] = await audit('guardrail.changed');
  assert.deepEqual([changed.actor, changed.target, changed.reason], ['stevie', 'guardrail:redact-on-ingest', 'Importing the contacts export for the pilot']);

  // The wiki asks Platform at its next import.
  const drop = path.join(env.dataDir, 'wiki', 'imports', 'contacts-export', 'Contacts Space');
  await fs.mkdir(drop, { recursive: true });
  await fs.writeFile(path.join(drop, 'Duty.md'), '# Duty\n\nCall +27 21 555 0199.\n');
  const imported = await post(stevie, '/wiki/api/v1/knowledge/import', { name: 'contacts-export' });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).source.redaction, 'off');
  await patch(stevie, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: true, reason: 'Import done' });
});

test('step 4: the "Specs, architecture, review" route changed to Sonnet; the next drafting call uses it (its modelRoute)', async () => {
  const saved = await patch(stevie, '/api/v1/platform/settings/routes/specs-architecture-review', { model: 'claude-sonnet-5-5', fallback: 'claude-haiku-4-5' });
  assert.equal((await saved.json()).route.modelLabel, 'Claude Sonnet 5.5');
  assert.equal((await post(lerato, '/product/api/v1/specs/PRD-031/drafts', { kind: 'rollout-plan' })).status, 202);
  await eventually(async () => {
    const finished = (await today(env.store, 'events')).filter((e) => e.type === 'teammate.task_finished' && e.payload.workType === 'spec-drafting');
    assert.equal(finished.at(-1)?.payload.modelRoute, 'mock/claude-sonnet-5-5');
  }, { ms: 20_000 });
  // Teammates audits the task just after it emits task_finished.
  await eventually(async () => assert.equal((await audit('agent.spec-drafting')).at(-1)?.modelRoute, 'mock/claude-sonnet-5-5'));
  // The spend went on the ledger, against the route.
  await eventually(async () => assert.ok((await env.noobly.platform.budgets.routeSpend(new Date(await clockNow(env.store)).toISOString()))['specs-architecture-review'] > 0));
});

test('step 5: Stop all containers stops every running workload and the Software Factory; the tiles show 0 running', async () => {
  const before = (await stevie.json('/api/v1/platform/containers')).body;
  assert.ok(before.tiles.running > 0);
  const result = await post(stevie, '/api/v1/platform/containers/stop-all', { reason: 'Phase 9 drill' });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual([body.usage.running, body.factoryStopped], [0, true]);
  assert.equal((await stevie.json('/api/v1/platform/containers')).body.tiles.running, 0);
  // The Software Factory starts no new runs until a person resumes it in the Factory.
  assert.equal((await stevie.json('/factory/api/v1/status')).body.stopped, true);
  await eventually(async () => assert.equal((await audit('containers.stopped_all'))[0]?.reason, 'Phase 9 drill'));
});

test('step 6: the audit log filters by actor, action and date, and matches the files', async () => {
  const day = await clockDay(env.store);
  const files = (await today(env.store, 'audit')).filter((r) => r.actor === 'stevie' && String(r.action).startsWith('repo.')).reverse();
  const { body } = await lerato.json(`/api/v1/platform/audit?actor=stevie&action=repo.&from=${day}&to=${day}`);
  assert.deepEqual(body.records.map((r) => r.id), files.map((r) => r.id));
  assert.ok(body.total >= 2);
});
