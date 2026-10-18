// Platform's rules on their own (src/services/platform/): the check every agent action passes, the spend ledger and
// budget.reached, guardrails, routes, repositories and secrets. Files only, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FsStore, tempDir } from '../helpers.js';
import { seedFiles, seedMissing } from '../../src/seed/index.js';
import { createPlatform } from '../../src/services/platform/index.js';

const NOW = '2026-10-10T09:00:00.000Z';

async function setup({ production = false, now = NOW } = {}) {
  const store = new FsStore(await tempDir());
  await seedFiles(store, { now });
  const emitted = [];
  const audited = [];
  const listeners = new Map();
  const events = {
    async emit(type, payload, { actor = null } = {}) {
      const record = { type, at: clock.iso, actor, payload };
      emitted.push(record);
      for (const fn of listeners.get(type) ?? []) await fn(record);
      return record;
    },
    on(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      return () => listeners.set(type, listeners.get(type).filter((f) => f !== fn));
    },
  };
  const auditLog = { record: async (r) => { audited.push(r); return r; } };
  const clock = { iso: now, now() { return new Date(this.iso).getTime(); } };
  const platform = createPlatform({ store, events, auditLog, clock, production });
  /** A finished teammate task, as Digital Teammates emits it; resolves when Platform has recorded it. */
  const finished = async (payload) => {
    const record = { type: 'teammate.task_finished', at: clock.iso, payload };
    await Promise.all((listeners.get('teammate.task_finished') ?? []).map((fn) => fn(record)));
  };
  return { store, platform, emitted, audited, clock, finished };
}

test('the seed writes Platform: seven repositories, three routes, budgets, guardrails and this month\'s sample spend', async () => {
  const { platform } = await setup();
  const repos = await platform.repositories.list();
  assert.equal(repos.length, 7);
  const pg = await platform.repository('payments-gateway');
  assert.deepEqual([pg.name, pg.access, pg.accessText, pg.notes], ['acme/payments-gateway', 'none', 'No agent access', 'restricted']);
  assert.equal((await platform.repository('acme__web-storefront')).may.openPrs, true);
  assert.deepEqual((await platform.routes.list()).map((r) => [r.label, r.model, r.fallback, r.provider]), [
    ['Specs, architecture, review', 'claude-opus-5-5', 'claude-sonnet-5-5', 'bedrock'],
    ['Implementation & tests', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'bedrock'],
    ['Indexing, triage, clean-up', 'claude-haiku-4-5', null, 'bedrock'],
  ]);
  const s = await platform.budgets.status(NOW);
  // The cloud budget's spend is Infrastructure's, which isn't running here.
  assert.deepEqual(s.systems.map((x) => [x.key, x.limit, x.spent]), [['teammates', 9000, 1816], ['product', 1500, 412], ['factory', 20, 0], ['knowledge', 500, 96], ['cloud', 6000, 0]]);
  assert.equal(s.total.spent, 2690);
  assert.equal(s.total.limit, 11600);
});

test('seedMissing gives a data folder from before Phase 9 its Platform files and the new permissions, once', async () => {
  const store = new FsStore(await tempDir());
  await seedFiles(store, { now: NOW });
  await fs.rm(path.join(store.root, 'platform'), { recursive: true });
  const roles = (await store.readText(['access', 'roles.yaml'])).replace(/^ {2}manage-members.*\n|^ {2}read-audit.*\n/gm, '');
  await store.writeText(['access', 'roles.yaml'], `${roles}\n# kept\n`);
  const added = await seedMissing(store, { now: NOW });
  assert.ok(added.includes('platform/model-routes.yaml'));
  assert.ok(added.includes('access/roles.yaml#read-audit'));
  const doc = await store.readYaml(['access', 'roles.yaml']);
  assert.deepEqual(doc.permissions['read-audit'], ['Approver', 'Architect', 'Owner']);
  assert.deepEqual(doc.permissions['manage-members'], ['Owner']);
  assert.deepEqual(doc.permissions.merge, ['Approver', 'Architect', 'Owner']);
  assert.match(await store.readText(['access', 'roles.yaml']), /# kept/);
  assert.deepEqual(await seedMissing(store, { now: NOW }), []);
});

test('a repository with no agent access refuses an agent reading it, and the refusal is audited', async () => {
  const { platform, audited } = await setup();
  const no = await platform.checkAgentWork({ system: 'home', workType: 'chat.reply', repo: 'acme/payments-gateway', teammateId: 'ada-quill' });
  assert.equal(no.ok, false);
  assert.equal(no.code, 'repo_no_access');
  assert.match(no.message, /Agents have no access to acme\/payments-gateway/);
  assert.deepEqual([audited[0].action, audited[0].actor, audited[0].code, audited[0].repo], ['agent.work_refused', 'ada-quill', 'repo_no_access', 'acme/payments-gateway']);
  // Read only allows reading but not a Factory run; a repository Platform doesn't know may be read, never changed.
  assert.equal((await platform.checkAgentWork({ repo: 'delivery-planner' })).ok, true);
  assert.equal((await platform.checkAgentWork({ system: 'factory', repo: 'delivery-planner', needs: 'openPrs' })).code, 'repo_no_access');
  assert.equal((await platform.checkAgentWork({ repo: 'someone/else' })).ok, true);
  assert.equal((await platform.checkAgentWork({ repo: 'someone/else', needs: 'openPrs' })).ok, false);
  const ok = await platform.checkAgentWork({ system: 'product', workType: 'spec-drafting', repo: 'slots-api', needs: 'openPrs' });
  assert.deepEqual([ok.ok, ok.route.id, ok.repository.name], [true, 'specs-architecture-review', 'acme/slots-api']);
});

test('access changes apply to the next check, and agents can never merge', async () => {
  const { platform } = await setup();
  await platform.repositories.update('payments-gateway', { access: 'read' });
  assert.equal((await platform.checkAgentWork({ repo: 'payments-gateway' })).ok, true);
  await platform.repositories.update('payments-gateway', { access: 'none' });
  const pg = await platform.repository('payments-gateway');
  assert.deepEqual(Object.values(pg.may), [false, false, false, false, false]);
  await assert.rejects(platform.repositories.update('slots-api', { may: { merge: true } }), { code: 'merge_not_allowed' });
  await assert.rejects(platform.repositories.update('delivery-planner', { may: { openPrs: true } }), { code: 'toggle_not_allowed' });
});

test('spend is recorded by system and route; a budget reached pauses that system once pauseOnLimit is on, and is said once', async () => {
  const { platform, emitted, audited, finished } = await setup();
  await finished({ system: 'product', workType: 'spec-drafting', costUsd: 2.5 });
  const s = await platform.budgets.status(NOW);
  assert.equal(s.systems.find((x) => x.key === 'product').spent, 414.5);
  assert.deepEqual(await platform.budgets.routeSpend(NOW), { 'specs-architecture-review': 2.5 });
  assert.equal(emitted.filter((e) => e.type === 'budget.reached').length, 0);

  // Lowering the Product Factory budget below this month's spend: said at once, and drafting is refused.
  const change = await platform.budgets.update({ systems: { product: 400 } });
  assert.deepEqual(change.changed, ['product']);
  await platform.sayReached({ again: change.changed, actor: 'stevie' });
  const reached = emitted.filter((e) => e.type === 'budget.reached');
  assert.deepEqual(reached.map((e) => [e.payload.budget, e.payload.limitUsd, e.payload.spentUsd, e.payload.paused, e.actor]), [['product', 400, 414.5, true, 'stevie']]);
  assert.ok(audited.some((a) => a.action === 'budget.reached' && a.target === 'budget:product'));
  const no = await platform.checkAgentWork({ system: 'product', workType: 'spec-drafting' });
  assert.equal(no.code, 'budget_reached');
  assert.equal(no.message, 'Agents are paused: Product Factory has reached its $400 budget ($414.50 spent this month). An Owner can raise it in Platform · Settings · Budgets.');
  // Other systems keep working; more spend does not say it again.
  assert.equal((await platform.checkAgentWork({ system: 'home', workType: 'chat.reply' })).ok, true);
  await finished({ system: 'product', workType: 'spec-drafting', costUsd: 1 });
  assert.equal(emitted.filter((e) => e.type === 'budget.reached').length, 1);

  // pauseOnLimit off: work goes on.
  await platform.budgets.update({ pauseOnLimit: false });
  assert.equal((await platform.checkAgentWork({ system: 'product' })).ok, true);
});

test('the Software Factory\'s cap is daily, and the month\'s total pauses every system', async () => {
  const { platform, finished, clock } = await setup();
  await finished({ system: 'factory', workType: 'implementation', costUsd: 20 });
  assert.match((await platform.checkAgentWork({ system: 'factory' })).message, /Software Factory has reached its \$20 daily cap \(\$20 spent today\)/);
  clock.iso = '2026-10-11T09:00:00.000Z';
  assert.equal((await platform.checkAgentWork({ system: 'factory' })).ok, true);
  await platform.budgets.update({ total: 2000 });
  assert.match((await platform.checkAgentWork({ system: 'home' })).message, /this month's total budget of \$2,000 is reached/);
  await assert.rejects(platform.budgets.update({ systems: { product: -1 } }), { code: 'invalid_budget' });
  await assert.rejects(platform.budgets.update({ systems: { nope: 1 } }), { code: 'budget_not_found' });
});

test('guardrails need a reason, the governance one is locked, and redaction can be turned off', async () => {
  const { platform } = await setup();
  assert.equal((await platform.guardrail('redact-on-ingest')).on, true);
  await assert.rejects(platform.guardrails.set('redact-on-ingest', { on: false }), { code: 'reason_required' });
  await assert.rejects(platform.guardrails.set('agents-open-prs', { on: false, reason: 'faster' }), { code: 'guardrail_locked' });
  const r = await platform.guardrails.set('redact-on-ingest', { on: false, reason: 'Importing a contacts export for the pilot' });
  assert.deepEqual([r.before, r.after, r.reason], [true, false, 'Importing a contacts export for the pilot']);
  assert.equal((await platform.guardrail('redact-on-ingest')).on, false);
});

test('routes: the next task uses the changed model; a direct API is refused in production', async () => {
  const { platform } = await setup();
  await platform.routes.update('specs-architecture-review', { model: 'claude-sonnet-5-5', fallback: 'claude-haiku-4-5' });
  assert.equal((await platform.route('spec-drafting')).model, 'claude-sonnet-5-5');
  await assert.rejects(platform.routes.update('specs-architecture-review', { model: 'gpt-6' }), { code: 'invalid_model' });
  await assert.rejects(platform.routes.update('specs-architecture-review', { fallback: 'claude-sonnet-5-5' }), { code: 'invalid_fallback' });
  await platform.routes.update('implementation-tests', { provider: 'anthropic' });

  const prod = await setup({ production: true });
  await assert.rejects(prod.platform.routes.update('implementation-tests', { provider: 'anthropic' }), { code: 'provider_not_allowed' });
  // A route someone set to the direct API by hand: tasks on it are refused in production.
  const text = (await prod.store.readText(['platform', 'model-routes.yaml'])).replace('provider: bedrock\n    tier: $$\n', 'provider: anthropic\n    tier: $$\n');
  await prod.store.writeText(['platform', 'model-routes.yaml'], text);
  assert.equal((await prod.platform.checkAgentWork({ system: 'home', workType: 'chat.reply' })).code, 'provider_not_allowed');
});

test('a file edited by hand applies to the next check (no restart)', async () => {
  const { platform, store } = await setup();
  assert.equal((await platform.checkAgentWork({ repo: 'payments-gateway' })).ok, false);
  const file = ['platform', 'repositories', 'acme__payments-gateway.md'];
  await store.writeText(file, (await store.readText(file)).replace('access: none', 'access: read').replace('readCode: false', 'readCode: true'));
  assert.equal((await platform.checkAgentWork({ repo: 'payments-gateway' })).ok, true);
  const budgets = ['platform', 'budgets.yaml'];
  await store.writeText(budgets, (await store.readText(budgets)).replace('monthly: 1500', 'monthly: 100'));
  assert.equal((await platform.checkAgentWork({ system: 'product' })).code, 'budget_reached');
});

test('secrets are references only, and a production reference is refused', async () => {
  const { platform } = await setup();
  assert.equal((await platform.secrets.list()).length, 4);
  await assert.rejects(platform.secrets.add({ repo: 'slots-api', name: 'DB_URL', ref: 'postgres://user:pw@host/db' }), { code: 'invalid_reference' });
  await assert.rejects(platform.secrets.add({ repo: 'slots-api', name: 'DB_URL', ref: 'vault:production/DB_URL' }), { code: 'production_secret_refused' });
  const added = await platform.secrets.add({ repo: 'slots-api', name: 'DB_URL', ref: 'vault:staging/DB_URL' });
  assert.deepEqual(added, { repo: 'acme/slots-api', name: 'DB_URL', ref: 'vault:staging/DB_URL' });
  await assert.rejects(platform.secrets.add({ repo: 'slots-api', name: 'DB_URL', ref: 'vault:staging/DB_URL' }), { code: 'secret_exists' });
  await platform.secrets.remove({ repo: 'slots-api', name: 'DB_URL' });
  assert.equal((await platform.secrets.list()).length, 4);
});

test('the ledger can be rebuilt from the events', async () => {
  const { platform } = await setup();
  const days = await platform.budgets.rebuild('2026-10', {
    eventsOfDay: async (day) => (day === '2026-10-09' ? [
      { type: 'teammate.task_finished', payload: { system: 'product', workType: 'spec-drafting', costUsd: 1.25 } },
      { type: 'teammate.task_finished', payload: { system: 'teams', workType: 'meeting.answer', costUsd: 0.5 } },
      { type: 'chat.message_posted', payload: { costUsd: 9 } },
    ] : []),
    routeOf: async (w) => (await platform.route(w))?.id ?? null,
  });
  assert.deepEqual(days, { '2026-10-09': { systems: { product: 1.25, teammates: 0.5 }, routes: { 'specs-architecture-review': 1.25, 'implementation-tests': 0.5 } } });
});

test('containers: the samples and real work run side by side; Stop ends one, Stop all ends everything and the Factory', async () => {
  const { platform, emitted, clock } = await setup();
  const { containers } = platform;
  let overview = await containers.overview();
  assert.equal(overview.simulated, true);
  assert.equal(overview.tiles.running, 6);
  assert.deepEqual(overview.pools.map((p) => [p.name, p.used, p.slots, p.full]), [
    ['Factory stations', 2, 3, false], ['Teammate sandboxes', 2, 8, false], ['Preview environments', 1, 6, false], ['Knowledge indexers', 1, 2, false],
  ]);
  // Sorted by uptime: Otis's two-hour sandbox first.
  assert.equal(overview.workloads[0].title, 'Otis Fern · CRM dedupe');
  assert.equal(overview.workloads[0].uptimeText, '2 h 03');
  assert.equal(overview.workloads.find((w) => w.title === 'PR #481 preview').action, 'open');
  assert.deepEqual(overview.images.list.map((i) => [i.image, i.cveText]).slice(0, 2), [['node-22:22.11', '0 CVEs'], ['temurin-21', '2 medium']]);

  // A teammate task registers itself while it runs; Stop aborts it.
  let aborted = 0;
  const off = containers.register({ kind: 'teammate', title: 'Ada Quill · rollout plan', itemId: 'PRD-031', stop: () => { aborted += 1; } });
  clock.iso = '2026-10-10T09:05:00.000Z';
  const ada = (await containers.workloads()).find((w) => w.title === 'Ada Quill · rollout plan');
  assert.deepEqual([ada.kind, ada.uptimeText, ada.sample], ['teammate', '5 min', false]);
  assert.deepEqual(await containers.logs(ada.id), ['2026-10-10T09:00:00.000Z started: Ada Quill · rollout plan', 'for PRD-031']);
  await containers.stop(ada.id, { by: { id: 'stevie', name: 'Stevie' }, reason: 'wrong item' });
  assert.equal(aborted, 1);
  assert.ok(emitted.some((e) => e.type === 'container.stopped' && e.actor === 'stevie' && /Ada Quill/.test(e.payload.summary)));
  off(); // the task ends after its stop: removing it again is harmless
  await assert.rejects(containers.stop(ada.id), { code: 'workload_not_found' });

  // Stop all: every workload, and the Software Factory.
  containers.register({ kind: 'factory', title: 'Run abc123 · SlotChip', stop: () => { aborted += 1; } });
  const result = await containers.stopAll({ by: { id: 'stevie', name: 'Stevie' }, reason: 'drill' });
  assert.equal(result.stopped.length, 7);
  assert.equal(aborted, 2);
  overview = await containers.overview();
  assert.deepEqual([overview.tiles.running, overview.tiles.queued, overview.tiles.vcpu.used], [0, 0, 0]);
  assert.ok(emitted.some((e) => e.type === 'containers.stopped_all' && e.payload.count === 7));
});
