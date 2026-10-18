// Governance (stack.md §3): each rule has a test that proves the server refuses. A hidden button is not a control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from './helpers.js';

const API = '/infrastructure/api/v1';
const approve = (t, as, kind = 'test', headers) => t.post(`${API}/designs/INF-031/decision`, { as, body: { decision: 'approve', kind }, headers });
const refusals = (t, actor) => t.auditLog.filter((a) => a.action === 'access.refused' && a.actor === actor);

async function story(options) {
  return startApp({ seed: true, ...options });
}

test('refuses: an agent approves a design, even with a raised access role', async () => {
  const people = [
    { id: 'stevie', name: 'Stevie', accessRole: 'Owner', active: true },
    { id: 'ines-tau', name: 'Ines Tau', accessRole: 'Owner', kind: 'agent', active: true },
  ];
  const t = await story({ people });
  try {
    const res = await approve(t, 'ines-tau');
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'people_only');
    assert.equal(refusals(t, 'ines-tau').length, 1);
    assert.equal((await t.get(`${API}/designs/INF-031`, { as: 'stevie' })).json.status, 'waiting-approval');
  } finally {
    await t.close();
  }
});

test('refuses: someone who is not the platform owner approves or asks for changes', async () => {
  const t = await story();
  try {
    for (const who of ['priya-s', 'lerato-m', 'thabo-n']) {
      const res = await approve(t, who);
      assert.equal(res.status, 403, who);
      assert.equal(res.json.error.code, 'forbidden', who);
      assert.equal(refusals(t, who).length, 1, who);
    }
    assert.equal((await t.post(`${API}/designs/INF-031/decision`, { as: 'priya-s', body: { decision: 'request-changes', comment: 'no' } })).status, 403);
    assert.deepEqual(t.eventLog.filter((e) => e.type.startsWith('infra_design.')), []);
  } finally {
    await t.close();
  }
});

test('refuses: Production from here, by anyone', async () => {
  const t = await story();
  try {
    const decision = await approve(t, 'stevie', 'production');
    assert.equal(decision.status, 422);
    assert.equal(decision.json.error.code, 'release_only');
    const created = await t.post(`${API}/environments`, { as: 'stevie', body: { name: 'prod-slots', kind: 'production', designId: 'INF-031' } });
    assert.equal(created.status, 422);
    assert.equal(created.json.error.code, 'release_only');
  } finally {
    await t.close();
  }
});

test('refuses: a Test environment from a design with no version approved for Test', async () => {
  const t = await story({
    before: undefined,
  });
  try {
    // Take the earlier approval away: v2 has never been approved, and now nothing has.
    const file = path.join(t.dataDir, 'designs', 'INF-031.md');
    const text = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, text.replace('approvedVersion: 1\n', '').replace('approvedKinds: [test, staging]\n', 'approvedKinds: []\n'));
    const res = await t.post(`${API}/environments`, { as: 'stevie', body: { name: 'test-two', kind: 'test', designId: 'INF-031' } });
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, 'no_approved_design');
    assert.equal((await t.get(`${API}/environments/test-two`, { as: 'stevie' })).status, 404);
  } finally {
    await t.close();
  }
});

test('refuses: approval while a blocking policy fails; a warning does not block', async () => {
  const t = await story();
  try {
    // v2 uses redis v2. Withdraw that blueprint's approval.
    const file = path.join(t.dataDir, 'blueprints.yaml');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('name: redis, version: 2, approved: true', 'name: redis, version: 2, approved: false'));
    const res = await approve(t, 'stevie');
    assert.equal(res.status, 422);
    assert.equal(res.json.error.code, 'policy_failed');
    assert.deepEqual(res.json.error.details.failed.map((c) => c.id), ['approved-blueprints']);
    assert.deepEqual(await (await t.get(`${API}/runs?status=queued`, { as: 'stevie' })).json.runs, []);

    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('name: redis, version: 2, approved: false', 'name: redis, version: 2, approved: true'));
    const design = await t.get(`${API}/designs/INF-031?kind=test`, { as: 'stevie' });
    assert.ok(design.json.policyChecks.some((c) => c.result === 'warning'), 'the cache-tier warning is still there');
    assert.equal((await approve(t, 'stevie')).status, 200);
  } finally {
    await t.close();
  }
});

test('refuses: a decision on a version the person has not seen (If-Match)', async () => {
  const t = await story();
  try {
    const stale = await approve(t, 'stevie', 'test', { 'if-match': '"INF-031@1"' });
    assert.equal(stale.status, 409);
    assert.equal((await approve(t, 'stevie', 'test', { 'if-match': '"INF-031@2"' })).status, 200);
    // And once decided, it can't be decided again for the same kind.
    assert.equal((await approve(t, 'stevie')).status, 409);
  } finally {
    await t.close();
  }
});

test('refuses: an agent restores drift or keeps a hand-made change; a Viewer does neither', async () => {
  const t = await story();
  try {
    for (const action of ['restore', 'keep']) {
      const agent = await t.post(`${API}/drift/drf_seedredis/${action}`, { as: 'ada-quill' });
      assert.equal(agent.status, 403, action);
      assert.equal(agent.json.error.code, 'people_only', action);
      assert.equal((await t.post(`${API}/drift/drf_seedredis/${action}`, { as: 'naledi-k' })).status, 403, action);
    }
    assert.equal((await t.get(`${API}/drift`, { as: 'stevie' })).json.drift[0].status, 'open');
  } finally {
    await t.close();
  }
});

test('refuses: anyone but an Owner switches a policy; an agent never does', async () => {
  const t = await story();
  try {
    assert.equal((await t.put(`${API}/policies/in-region`, { as: 'thabo-n', body: { enabled: false } })).status, 403);
    assert.equal((await t.put(`${API}/policies/in-region`, { as: 'ada-quill', body: { enabled: false } })).json.error.code, 'people_only');
    assert.equal((await t.get(`${API}/policies`, { as: 'stevie' })).json.policies.find((p) => p.id === 'in-region').enabled, true);
  } finally {
    await t.close();
  }
});

test('an approved version is kept and never rewritten', async () => {
  const t = await story();
  try {
    await approve(t, 'stevie');
    await t.hosted.idle();
    const kept = path.join(t.dataDir, 'designs', 'INF-031', 'versions', 'v2.md');
    const before = await fs.readFile(kept, 'utf8');
    // Keeping a drift makes v3; v2 on disk must not change.
    await t.post(`${API}/drift/drf_seedredis/keep`, { as: 'priya-s' });
    await t.hosted.idle();
    assert.equal(await fs.readFile(kept, 'utf8'), before);
    const design = await t.get(`${API}/designs/INF-031`, { as: 'stevie' });
    assert.equal(design.json.version, 3);
    assert.equal(design.json.status, 'waiting-approval');
    assert.equal(design.json.approvedVersion, 2);
  } finally {
    await t.close();
  }
});
