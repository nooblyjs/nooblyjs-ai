// The seed story through the API: what the two mocked screens show, then a decision, its runs, and drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

const API = '/infrastructure/api/v1';

test('Environments: the table, the promotion path, the agent and cost by kind', async () => {
  const t = await startApp({ seed: true });
  try {
    const { environments } = (await t.get(`${API}/environments`, { as: 'priya-s' })).json;
    assert.deepEqual(environments.map((e) => e.name), ['pr-485', 'pr-486', 'dev-slots', 'test-slots', 'staging', 'prod']);
    const row = Object.fromEntries(environments.map((e) => [e.name, e]));
    assert.equal(row['pr-485'].deployed, 'PR #485 · 12 min ago');
    assert.equal(row['pr-485'].note.text, 'web-storefront · destroys on merge');
    assert.equal(row['pr-486'].deployed, 'Provisioning · 70%');
    assert.equal(row['pr-486'].tests.text, 'Waiting');
    assert.deepEqual(row['dev-slots'].note, { text: 'Drift: Redis maxmemory changed by hand', tone: 'warning' });
    assert.deepEqual([row['test-slots'].tests.text, row['test-slots'].tests.tone], ['e2e 41/42 · load passed', 'warning']);
    assert.deepEqual(environments.map((e) => e.costText), ['$0.40', '$0.60', '$9', '$18', '$41', '—']);
    assert.equal((await t.get(`${API}/environments?kind=preview`, { as: 'priya-s' })).json.environments.length, 2);

    const path = (await t.get(`${API}/promotion-paths/slots`, { as: 'priya-s' })).json;
    assert.deepEqual(path.tiles.map((x) => [x.label, x.value, x.line.text]), [
      ['Preview', '2 per-PR', 'Created per PR, destroyed on merge'],
      ['Dev', '0.9.4', 'Drift on Redis config'],
      ['Test', '0.9.4', '41 of 42 e2e · 1 failing'],
      ['Staging', '0.9.2', 'Load test tonight 18:00'],
      ['Production', 'Not yet', 'Release Slots 1.0 · 2 approvers'],
    ]);

    const summary = (await t.get(`${API}/summary`, { as: 'priya-s' })).json;
    assert.equal(summary.agent.working, 'Provisioning pr-486 · 70%');
    assert.deepEqual(summary.spend.byKind.map((k) => [k.label, k.text]), [['Staging', '$1,230'], ['Test', '$540'], ['Dev', '$270'], ['Previews', '$100']]);
    assert.equal(summary.spend.text, '$2,140 of $6,000');
  } finally {
    await t.close();
  }
});

test('Design INF-031: resources, code, plan, cost estimate, policy checks and approvals', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.get(`${API}/designs/INF-031?kind=test`, { as: 'stevie' });
    const d = res.json;
    assert.equal(res.etag, '"INF-031@2"');
    assert.equal(d.statusText, 'Waiting for the platform owner');
    assert.equal(d.draftedText, 'Drafted by Ines Tau from the architecture · 40 min ago');
    assert.deepEqual(d.layers.map((l) => [l.label, l.resources.map((r) => r.state)]), [
      ['Edge', ['changed']], ['Compute', ['new', 'new']], ['Data', ['new', 'existing']],
      ['Messaging', ['changed']], ['Security', ['new', 'existing']], ['Observe', ['new', 'existing']],
    ]);
    assert.deepEqual(d.plan, { add: 7, change: 2, destroy: 0 });
    assert.deepEqual(d.costEstimate.map((c) => c.text), ['$0.60', '$9', '$18', '$41', '~$62']);
    assert.deepEqual(d.policyChecks.map((c) => [c.result, c.text]), [
      ['passed', 'Customer data stays in-region'], ['passed', 'Encrypted at rest and in transit'],
      ['passed', 'Only approved blueprints used'], ['passed', 'Fits the Delivery squad budget'],
      ['warning', 'Cache tier above Test default'],
    ]);
    assert.equal(d.code.path, 'infra/slots/test');
    assert.equal(d.code.pullRequest, 91);
    assert.match(d.code.text, /module "slot_cache" \{\n {2}source {9}= "blueprints\/redis\/v2"/);
    assert.deepEqual(d.approvals.map((a) => [a.name, a.role, a.stateText]), [['Thabo N.', 'Architect', 'Via ADR-014'], ['You', 'Platform owner', 'Waiting']]);
    assert.deepEqual(d.decision, { allowed: true, canRequestChanges: true, label: 'Approve & provision Test', reason: '' });

    // Someone who can't decide is told why, and sees the role rather than "You".
    const priya = (await t.get(`${API}/designs/INF-031?kind=test`, { as: 'priya-s' })).json;
    assert.equal(priya.decision.allowed, false);
    assert.equal(priya.decision.reason, 'Only the platform owner can decide.');
    assert.equal(priya.approvals[1].name, null);
    // Other kinds say what applies to them.
    assert.match((await t.get(`${API}/designs/INF-031?kind=production`, { as: 'stevie' })).json.decision.reason, /through a release/);
    assert.match((await t.get(`${API}/designs/INF-031?kind=dev`, { as: 'stevie' })).json.decision.reason, /applies automatically/);
    assert.deepEqual((await t.get(`${API}/designs/INF-031/versions`, { as: 'stevie' })).json.versions.map((v) => [v.version, v.status]), [[1, 'approved'], [2, 'waiting-approval']]);
  } finally {
    await t.close();
  }
});

test('Approve & provision Test: the approved kind and the automatic kinds get runs, and say so in events', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'approve', kind: 'test' } });
    assert.equal(res.status, 200);
    // test-slots was approved; pr-485 is a preview behind v2. dev-slots is skipped (drift waits for a person)
    // and pr-486 is already being provisioned.
    assert.deepEqual(res.json.runs.map((r) => [r.environment, r.designVersion]).sort(), [['pr-485', 2], ['test-slots', 2]]);
    assert.equal(res.json.runs.find((r) => r.environment === 'test-slots').approvedBy.id, 'stevie');
    await t.hosted.idle();

    const env = (await t.get(`${API}/environments/test-slots`, { as: 'stevie' })).json;
    assert.equal(env.status, 'live');
    assert.equal(env.design.version, 2);
    assert.equal(env.design.behind, false);
    assert.equal(env.runs[0].statusText, 'Provisioned');
    const types = t.eventLog.map((e) => e.type);
    for (const type of ['infra_design.approved', 'environment.plan_ready', 'environment.provisioning_started', 'environment.provisioning_progressed', 'environment.provisioned']) assert.ok(types.includes(type), type);
    assert.deepEqual(t.eventLog.find((e) => e.type === 'infra_design.approved').payload, { system: 'infrastructure', designId: 'INF-031', version: 2, kind: 'test', itemId: 'PRD-031', summary: 'approved infrastructure design INF-031 v2 for Test' });

    const after = (await t.get(`${API}/designs/INF-031?kind=test`, { as: 'stevie' })).json;
    assert.equal(after.statusText, 'Approved · v2');
    assert.equal(after.decision.allowed, false);
    // Staging still needs its own approval of this version.
    assert.equal((await t.get(`${API}/designs/INF-031?kind=staging`, { as: 'stevie' })).json.decision.allowed, true);
  } finally {
    await t.close();
  }
});

test('Request changes needs a comment, and sends the design back', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'request-changes' } })).status, 400);
    const res = await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'request-changes', comment: 'Use the Test default cache tier.' } });
    assert.equal(res.json.design.statusText, 'Changes requested');
    assert.deepEqual(res.json.runs, []);
    assert.equal(t.eventLog.at(-1).type, 'infra_design.changes_requested');
  } finally {
    await t.close();
  }
});

test('Drift: restore is a run that puts the environment back; a check then finds nothing', async () => {
  const t = await startApp({ seed: true });
  try {
    // Priya is a Contributor: Dev applies automatically, so `draft` is enough.
    const res = await t.post(`${API}/drift/drf_seedredis/restore`, { as: 'priya-s' });
    assert.equal(res.status, 202);
    assert.equal(res.json.drift.statusText, 'Restoring from the design');
    await t.hosted.idle();
    assert.deepEqual((await t.get(`${API}/drift`, { as: 'priya-s' })).json.drift, []);
    assert.equal((await t.get(`${API}/drift?status=all`, { as: 'priya-s' })).json.drift[0].status, 'restored');
    assert.deepEqual((await t.post(`${API}/environments/dev-slots/drift-check`, { as: 'priya-s' })).json.found, []);
    assert.equal((await t.hosted.status()).card.pill.text, 'No drift');
    assert.equal((await t.post(`${API}/drift/drf_seedredis/restore`, { as: 'priya-s' })).status, 409);
  } finally {
    await t.close();
  }
});

test('Drift: a check records a hand-made change once; keeping it makes a new design version', async () => {
  const t = await startApp({ seed: true });
  try {
    // The seeded drift is already recorded, so the check adds nothing.
    const again = (await t.post(`${API}/environments/dev-slots/drift-check`, { as: 'priya-s' })).json;
    assert.deepEqual([again.found.length, again.open], [0, 1]);

    const kept = await t.post(`${API}/drift/drf_seedredis/keep`, { as: 'priya-s' });
    assert.equal(kept.status, 200);
    assert.equal(kept.json.design.version, 3);
    assert.equal(kept.json.design.statusText, 'Waiting for the platform owner');
    await t.hosted.idle();
    const design = (await t.get(`${API}/designs/INF-031?kind=dev`, { as: 'stevie' })).json;
    // The architect's sign-off came with ADR-014 and stands; the platform owner is asked again.
    assert.deepEqual(design.approvals.map((a) => a.stateText), ['Via ADR-014', 'Waiting']);
    assert.equal((await t.get(`${API}/environments/dev-slots`, { as: 'stevie' })).json.drift, null);
    assert.ok(t.eventLog.some((e) => e.type === 'drift.accepted'));
  } finally {
    await t.close();
  }
});

test('New environment: Dev at once for a Contributor; Test only for the platform owner', async () => {
  const t = await startApp({ seed: true });
  try {
    const dev = await t.post(`${API}/environments`, { as: 'priya-s', body: { name: 'dev-slots-2', kind: 'dev', designId: 'INF-031' } });
    assert.equal(dev.status, 201);
    assert.equal(dev.json.environment.statusText, 'Provisioning · 0%');
    assert.equal(dev.json.environment.designVersion, 2, 'automatic kinds take the latest version');
    assert.equal(dev.json.environment.costText, '$9');

    assert.equal((await t.post(`${API}/environments`, { as: 'priya-s', body: { name: 'test-two', kind: 'test', designId: 'INF-031' } })).status, 403);
    const tst = await t.post(`${API}/environments`, { as: 'stevie', body: { name: 'test-two', kind: 'test', designId: 'INF-031' } });
    assert.equal(tst.status, 201);
    assert.equal(tst.json.environment.designVersion, 1, 'approval kinds take the version approved for them');

    assert.equal((await t.post(`${API}/environments`, { as: 'stevie', body: { name: 'test-two', kind: 'dev', designId: 'INF-031' } })).status, 409);
    assert.equal((await t.post(`${API}/environments`, { as: 'stevie', body: { name: 'Bad Name', kind: 'dev', designId: 'INF-031' } })).status, 400);
    assert.equal((await t.post(`${API}/environments`, { as: 'naledi-k', body: { name: 'dev-three', kind: 'dev', designId: 'INF-031' } })).status, 403);
    await t.hosted.idle();
    assert.equal((await t.get(`${API}/environments/dev-slots-2`, { as: 'stevie' })).json.status, 'live');
  } finally {
    await t.close();
  }
});

test('Govern: blueprints with who uses them, policies, and cost for a month with nothing in it', async () => {
  const t = await startApp({ seed: true });
  try {
    const { blueprints } = (await t.get(`${API}/blueprints`, { as: 'naledi-k' })).json;
    assert.deepEqual(blueprints.find((b) => b.name === 'redis').usedBy, ['INF-031']);
    assert.equal(blueprints.find((b) => b.name === 'node-service' && b.version === 2).stateText, 'Not approved');

    const off = await t.put(`${API}/policies/default-tier`, { as: 'stevie', body: { enabled: false } });
    assert.equal(off.json.stateText, 'Off');
    const checks = (await t.get(`${API}/designs/INF-031?kind=test`, { as: 'stevie' })).json.policyChecks;
    assert.equal(checks.find((c) => c.id === 'default-tier').result, 'off');
    assert.equal(t.eventLog.at(-1).type, 'policy.changed');

    const empty = (await t.get(`${API}/cost?month=2020-01`, { as: 'naledi-k' })).json;
    assert.deepEqual([empty.spentUsd, empty.byKind.length, empty.monthName], [0, 0, 'January']);
    assert.equal((await t.get(`${API}/cost?month=tomorrow`, { as: 'naledi-k' })).status, 400);
  } finally {
    await t.close();
  }
});

test('with nothing on disk, the status card says zero rather than sample numbers', async () => {
  const t = await startApp();
  try {
    const status = await t.hosted.status();
    assert.deepEqual(status.badges, { runs: 0 });
    assert.deepEqual(status.card.pill, { text: 'No drift', tone: 'ok' });
    assert.equal(status.card.items[0].value, '0 · 0 of them previews');
    assert.match(status.card.meter.value, /^\$0 this month$/);
    assert.deepEqual((await t.get(`${API}/environments`, { as: 'stevie' })).json.environments, []);
    assert.equal(await t.hosted.services.designFor('PRD-031'), null);
  } finally {
    await t.close();
  }
});

test('services for other apps: the design and environments of an item, a PR\'s preview, what waits', async () => {
  const t = await startApp({ seed: true });
  try {
    const { services } = t.hosted;
    assert.equal((await services.designFor('PRD-031')).id, 'INF-031');
    assert.equal((await services.environmentsFor('PRD-031')).length, 5);
    assert.deepEqual(await services.previewFor('web-storefront', 485), { name: 'pr-485', status: 'live', href: '/infrastructure/environments/pr-485' });
    assert.equal(await services.previewFor('web-storefront', 1), null);
    assert.deepEqual((await services.waitingFor()).map((w) => w.id), ['INF-031']);
    assert.equal((await services.metrics()).cloudSpendUsd, 2140);
  } finally {
    await t.close();
  }
});
