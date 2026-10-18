// /api/v1/platform (routes/platform.js): who may read and change what, that every change is audited and evented,
// and that the audit log screen's query matches the files. No hosted apps; the six-step story is platform.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually, clockDay } from './helpers.js';

let env;
let stevie;
let lerato;
let priya;
before(async () => {
  env = await startApp();
  [stevie, lerato, priya] = [env.client(), env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
  await priya.signIn('priya-s');
});
after(async () => { await env?.stop(); });

const patch = (c, p, json) => c.request(p, { method: 'PATCH', json });

test('repositories: filters with counts, the detail with its secrets, and only an Owner changes access (audited, evented)', async () => {
  const { body } = await priya.json('/api/v1/platform/repositories');
  assert.deepEqual(body.counts, { all: 7, factory: 4, 'read-only': 2, 'not-indexed': 3 });
  const ro = await priya.json('/api/v1/platform/repositories?filter=read-only');
  assert.deepEqual(ro.body.repositories.map((r) => r.shortName), ['delivery-planner', 'inventory-service']);
  const detail = await priya.json('/api/v1/platform/repositories/acme__slots-api');
  assert.deepEqual(detail.body.secrets.map((s) => s.name), ['REDIS_URL', 'KAFKA_BROKERS', 'PLANNER_TOKEN']);

  const refused = await patch(priya, '/api/v1/platform/repositories/acme__slots-api', { access: 'none' });
  assert.equal(refused.status, 403);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'change-repo-access')));

  const ok = await patch(stevie, '/api/v1/platform/repositories/acme__slots-api', { access: 'read', reason: 'Pausing PRs during the pilot' });
  assert.equal(ok.status, 200);
  const repo = (await ok.json()).repository;
  assert.deepEqual([repo.access, repo.may.openPrs, repo.gates], ['read', false, '']);
  await eventually(async () => {
    const a = (await today(env.store, 'audit')).find((r) => r.action === 'repo.access_changed');
    assert.deepEqual([a.actor, a.target, a.from.access, a.to.access, a.reason], ['stevie', 'acme/slots-api', 'read-prs', 'read', 'Pausing PRs during the pilot']);
  });
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'repo.access_changed'));
  assert.equal((await patch(stevie, '/api/v1/platform/repositories/acme__slots-api', { may: { merge: true } })).status, 422);
  await patch(stevie, '/api/v1/platform/repositories/acme__slots-api', { access: 'read-prs' });

  const made = await stevie.request('/api/v1/platform/repositories', { method: 'POST', json: { name: 'acme/data-pipelines', stack: 'Python 3.13' } });
  assert.equal(made.status, 201);
  assert.equal((await made.json()).repository.access, 'read');
  assert.equal((await stevie.request('/api/v1/platform/repositories', { method: 'POST', json: { name: 'not a repo' } })).status, 400);
});

test('settings: one read for every tab; routes and budgets need their permissions and say what changed', async () => {
  const { body } = await priya.json('/api/v1/platform/settings');
  assert.deepEqual(body.models.routes.map((r) => r.id), ['specs-architecture-review', 'implementation-tests', 'indexing-triage-cleanup']);
  assert.deepEqual(body.budgets.systems.map((s) => s.key), ['teammates', 'product', 'factory', 'knowledge', 'cloud']);
  assert.equal(body.guardrails.find((g) => g.key === 'agents-open-prs').locked, true);
  assert.deepEqual(body.integrations.map((i) => i.label), ['Bitbucket', 'Jira', 'Microsoft Teams / Outlook']);
  assert.ok(!body.integrations.some((i) => /datadog|drive|sharepoint|targetprocess/i.test(i.label)), 'only what NooblyJS is connected to');
  assert.ok(!body.integrations.some((i) => /slack/i.test(i.label)));

  assert.equal((await patch(lerato, '/api/v1/platform/settings/routes/specs-architecture-review', { model: 'claude-sonnet-5-5' })).status, 403);
  const r = await patch(stevie, '/api/v1/platform/settings/routes/specs-architecture-review', { model: 'claude-sonnet-5-5', fallback: 'claude-haiku-4-5' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).route.modelLabel, 'Claude Sonnet 5.5');
  assert.equal((await env.noobly.platform.route('spec-drafting')).model, 'claude-sonnet-5-5');
  await patch(stevie, '/api/v1/platform/settings/routes/specs-architecture-review', { model: 'claude-opus-5-5', fallback: 'claude-sonnet-5-5' });

  assert.equal((await patch(lerato, '/api/v1/platform/settings/budgets', { systems: { product: 400 } })).status, 403);
  const b = await patch(stevie, '/api/v1/platform/settings/budgets', { systems: { product: 400 } });
  const answer = await b.json();
  assert.deepEqual(answer.reached, [{ budget: 'product', text: 'Product Factory has reached its $400 budget' }]);
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'budget.changed' && e.actor === 'stevie'));
  assert.ok(events.some((e) => e.type === 'budget.reached' && e.payload.budget === 'product'));
  assert.equal((await env.noobly.platform.checkAgentWork({ system: 'product' })).code, 'budget_reached');
  assert.equal((await patch(stevie, '/api/v1/platform/settings/budgets', { systems: { product: 'lots' } })).status, 400);
  await patch(stevie, '/api/v1/platform/settings/budgets', { systems: { product: 1500 } });
  assert.equal((await env.noobly.platform.checkAgentWork({ system: 'product' })).ok, true);
});

test('guardrails: an Owner and a reason; the change is in policy history and the audit log', async () => {
  assert.equal((await patch(lerato, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: false, reason: 'test' })).status, 403);
  const noReason = await patch(stevie, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: false });
  assert.equal(noReason.status, 400);
  assert.equal((await noReason.json()).error.code, 'reason_required');
  assert.equal((await patch(stevie, '/api/v1/platform/settings/guardrails/agents-open-prs', { on: false, reason: 'faster' })).status, 422);
  const ok = await patch(stevie, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: false, reason: 'Importing the contacts export for the pilot' });
  assert.equal(ok.status, 200);
  assert.equal((await env.noobly.platform.guardrail('redact-on-ingest')).on, false);
  await eventually(async () => {
    const { body } = await lerato.json('/api/v1/platform/guardrails/history');
    assert.deepEqual(body.history.map((h) => [h.guardrail, h.from, h.to, h.reason, h.actorName]), [['redact-on-ingest', true, false, 'Importing the contacts export for the pilot', 'Stevie']]);
  });
  await patch(stevie, '/api/v1/platform/settings/guardrails/redact-on-ingest', { on: true, reason: 'Import done' });
});

test('secrets: references only; production refused', async () => {
  const bad = await stevie.request('/api/v1/platform/secrets', { method: 'POST', json: { repo: 'acme/slots-api', name: 'DB_URL', ref: 'vault:production/DB_URL' } });
  assert.equal(bad.status, 422);
  const ok = await stevie.request('/api/v1/platform/secrets', { method: 'POST', json: { repo: 'acme/slots-api', name: 'DB_URL', ref: 'vault:staging/DB_URL' } });
  assert.equal(ok.status, 201);
  assert.equal((await stevie.request('/api/v1/platform/secrets?repo=acme/slots-api&name=DB_URL', { method: 'DELETE' })).status, 200);
  assert.equal((await priya.request('/api/v1/platform/secrets', { method: 'POST', json: { repo: 'acme/slots-api', name: 'X', ref: 'vault:staging/X' } })).status, 403);
  const envs = await priya.json('/api/v1/platform/environments');
  assert.deepEqual(envs.body.environments.map((e) => e.kind), ['Preview', 'Dev', 'Test', 'Staging', 'Production']);
});

test('members: an Owner changes a person\'s access role with a reason; never the last Owner, never an agent', async () => {
  const { body } = await priya.json('/api/v1/platform/members');
  assert.deepEqual(body.roles, ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner']);
  assert.ok(body.members.some((m) => m.id === 'stevie' && m.accessRole === 'Owner'));
  assert.equal((await patch(lerato, '/api/v1/platform/members/priya-s', { accessRole: 'Approver', reason: 'x' })).status, 403);
  assert.equal((await patch(stevie, '/api/v1/platform/members/priya-s', { accessRole: 'Approver' })).status, 400);
  const ok = await patch(stevie, '/api/v1/platform/members/priya-s', { accessRole: 'Approver', reason: 'Approves the checkout squad\'s specs' });
  assert.equal(ok.status, 200);
  assert.equal((await env.noobly.people.get('priya-s')).accessRole, 'Approver');
  await patch(stevie, '/api/v1/platform/members/priya-s', { accessRole: 'Contributor', reason: 'Back to Contributor' });
  const last = await patch(stevie, '/api/v1/platform/members/stevie', { accessRole: 'Viewer', reason: 'Stepping down' });
  assert.equal(last.status, 422);
  assert.equal((await last.json()).error.code, 'last_owner');
  assert.equal((await patch(stevie, '/api/v1/platform/members/nobody', { accessRole: 'Viewer', reason: 'x y z' })).status, 404);
});

test('audit log: read-audit only; filters by actor, action and date; matches the files, newest first', async () => {
  assert.equal((await priya.get('/api/v1/platform/audit')).status, 403);
  const day = await clockDay(env.store);
  await eventually(async () => {
    const files = (await today(env.store, 'audit')).filter((r) => r.actor === 'stevie').reverse();
    const { body } = await lerato.json(`/api/v1/platform/audit?actor=stevie&from=${day}&to=${day}`);
    assert.deepEqual(body.records.map((r) => r.id), files.slice(0, 100).map((r) => r.id));
    assert.equal(body.total, files.length);
  });
  const g = await lerato.json(`/api/v1/platform/audit?action=guardrail.changed&from=${day}&to=${day}`);
  assert.equal(g.body.records.length, 2);
  assert.ok(g.body.records.every((r) => r.action === 'guardrail.changed'));
  const prefix = await lerato.json(`/api/v1/platform/audit?action=repo.&from=${day}&to=${day}`);
  assert.ok(prefix.body.records.length >= 2 && prefix.body.records.every((r) => r.action.startsWith('repo.')));
  assert.equal((await lerato.json('/api/v1/platform/audit?from=2026-13-01')).status, 400);
  assert.equal((await lerato.json('/api/v1/platform/audit?from=2026-01-01&to=2026-12-31')).status, 400);
});

test('containers: anyone signed in reads them; only an Owner stops one or all, and it is audited', async () => {
  const { body } = await priya.json('/api/v1/platform/containers');
  assert.equal(body.tiles.running, 6);
  const status = await priya.json('/api/v1/platform/status');
  assert.equal(status.body.cluster, 'Cluster healthy (simulated)');
  const otis = body.workloads.find((w) => w.title === 'Otis Fern · CRM dedupe');
  assert.deepEqual((await priya.json(`/api/v1/platform/containers/${otis.id}/logs`)).body.lines.length, 2);
  assert.equal((await lerato.request(`/api/v1/platform/containers/${otis.id}/stop`, { method: 'POST', json: {} })).status, 403);
  assert.equal((await stevie.request(`/api/v1/platform/containers/${otis.id}/stop`, { method: 'POST', json: { reason: 'stuck' } })).status, 200);
  assert.equal((await stevie.request(`/api/v1/platform/containers/${otis.id}/stop`, { method: 'POST', json: {} })).status, 404);
  assert.equal((await lerato.request('/api/v1/platform/containers/stop-all', { method: 'POST', json: {} })).status, 403);
  const all = await stevie.request('/api/v1/platform/containers/stop-all', { method: 'POST', json: { reason: 'drill' } });
  assert.equal(all.status, 200);
  assert.equal((await all.json()).usage.running, 0);
  assert.equal((await priya.json('/api/v1/platform/containers')).body.tiles.running, 0);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((a) => a.action === 'container.stopped' && a.actor === 'stevie' && a.reason === 'stuck'));
    assert.ok(audit.some((a) => a.action === 'containers.stopped_all' && a.actor === 'stevie' && a.stopped.length === 5));
  });
});
