// Releases (root roadmap Phase 22 on the app on its own): a release is one feature whose stories have all passed Test,
// with its evidence pack, the release agent's notes, a rollout and a rollback; an open high finding with no accepted risk
// holds its deploy approval; two approvals deploy the pilot through Infrastructure and record the Jira fix version and
// the tags; a person takes it to everyone or rolls it back with a reason; agents are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { fakes } from './fakes.js';
import { scriptedNotes } from '../src/services/notes.js';

const API = '/operations/api/v1';
const HIGH = { id: 'FND-001', title: 'The hold endpoint builds a Redis key from the request body', severity: 'high', severityLabel: 'High', state: 'open' };
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; for (;;) { try { return await fn(); } catch (err) { if (Date.now() > end) throw err; await new Promise((r) => setTimeout(r, 10)); } } };

test('a release of one feature: refused until its stories have passed Test; then the evidence, the notes, the plans', async () => {
  const early = fakes({ featureStage: 'build' });
  const t1 = await startApp({ seed: true, services: early.services });
  try {
    const refused = await t1.post(`${API}/releases`, { as: 'priya-s', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1' } });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'feature_not_ready']);
    assert.match(refused.json.error.message, /STORY-031-1 is in build/);
  } finally {
    await t1.close();
  }
  const f = fakes();
  const t = await startApp({ seed: true, services: f.services });
  try {
    const res = await t.post(`${API}/releases`, { as: 'priya-s', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1', version: '1.0.0' } });
    assert.equal(res.status, 201, res.text);
    const r = res.json;
    assert.deepEqual([r.id, r.name, r.version, r.product, r.status, r.stories], ['REL-001', 'Slots 1.0', '1.0.0', 'slots', 'draft', ['STORY-031-1']]);
    assert.deepEqual(r.deploys, [{ service: 'api', version: '0.9.4' }, { service: 'web', version: '4.12.0' }]);
    assert.equal(r.rollback.text, 'Return prod to web 4.11.2 in one action (the deployer, through Infrastructure).');
    assert.equal(r.rollout.text, '10% pilot, then Everyone');
    assert.deepEqual(r.evidence.approvals.map((a) => [a.label, a.by]), [['Build approval', 'Lerato M.'], ['Test approval', 'Naledi K.']]);
    assert.match(r.evidence.text, /^1 merged pull request with 2 approvals · 1 of 1 story passing at Build · staging passed · 0 open findings · SBOM of 0 components$/);
    assert.equal(r.notes.draftedBy.name, 'Pip Okafor');
    assert.match(r.notes.text, /^Slots 1\.0 \(1\.0\.0\) releases See which stores still have same-day capacity\./);
    assert.equal((await t.post(`${API}/releases`, { as: 'priya-s', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1' } })).status, 409, 'one release per feature');
    assert.ok(t.eventLog.some((e) => e.type === 'release.created' && e.payload.system === 'operations'));
  } finally {
    await t.close();
  }
});

test('an open high finding with no accepted risk holds the deploy approval; accepted, the approval is asked for', async () => {
  const f = fakes({ open: [HIGH] });
  const t = await startApp({ seed: true, services: f.services });
  try {
    await t.post(`${API}/releases`, { as: 'priya-s', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1' } });
    const held = await t.post(`${API}/releases/REL-001/approval`, { as: 'priya-s' });
    assert.deepEqual([held.status, held.json.error.code], [422, 'risk_not_accepted']);
    assert.match(held.json.error.message, /FND-001 \(High\): The hold endpoint builds a Redis key/);
    f.state.accepted.push({ ...HIGH, state: 'accepted', acceptance: { expiresAt: '2026-11-20T00:00:00.000Z', byName: 'Stevie' } });
    f.state.open.length = 0;
    const asked = await t.post(`${API}/releases/REL-001/approval`, { as: 'priya-s' });
    assert.equal(asked.status, 200, asked.text);
    assert.equal(asked.json.status, 'waiting-approval');
    const call = f.calls.find((c) => c.name === 'workflows.requestAppApproval').input;
    assert.deepEqual([call.type, call.itemId, call.ref], ['deploy', 'PRD-031', { app: 'operations', id: 'REL-001', version: '1.0.0', kind: 'release' }]);
    assert.match(asked.json.notes.text, /Accepted risks:\n- FND-001 \(High\)/, 'the notes are drafted again with the fresh evidence');
  } finally {
    await t.close();
  }
});

test('two approvals deploy the pilot and record the writes; a person takes it to everyone, or rolls it back with a reason', async () => {
  const f = fakes();
  const t = await startApp({ seed: true, services: f.services });
  try {
    await t.post(`${API}/releases`, { as: 'priya-s', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1' } });
    await t.post(`${API}/releases/REL-001/approval`, { as: 'priya-s' });
    // The lifecycle relays each decision; an agent is never relayed (the engine refuses it first).
    assert.deepEqual(await t.hosted.services.decideApproval({ id: 'REL-001', decision: 'approve', person: { id: 'lerato-m', accessRole: 'Approver' } }), { id: 'REL-001', text: null, by: 'lerato-m' });
    // Deciding for someone else still needs deploy-production; an agent never.
    await assert.rejects(t.hosted.services.decideApproval({ id: 'REL-001', decision: 'approve', person: { id: 'priya-s', accessRole: 'Contributor' } }), { status: 403 });
    await assert.rejects(t.hosted.services.decideApproval({ id: 'REL-001', decision: 'approve', person: { id: 'ada-quill', kind: 'agent', accessRole: 'Owner' } }), { code: 'people_only' });
    await t.emit('approval.decided', { type: 'deploy', outcome: 'pending', by: 'lerato-m', ref: { app: 'operations', id: 'REL-001' } });
    assert.equal((await t.get(`${API}/releases/REL-001`, { as: 'stevie' })).json.status, 'waiting-approval', 'one approval is not enough');
    await t.emit('approval.decided', { type: 'deploy', outcome: 'approved', by: 'stevie', ref: { app: 'operations', id: 'REL-001' } });
    const piloting = await until(async () => { const r = (await t.get(`${API}/releases/REL-001`, { as: 'stevie' })).json; assert.equal(r.status, 'piloting'); return r; });
    assert.deepEqual([piloting.percent, piloting.deployments[0].label, piloting.deployments[0].by.name], [10, '10% pilot', 'Stevie']);
    const deployed = f.calls.find((c) => c.name === 'infrastructure.deployRelease').input;
    assert.deepEqual([deployed.product, deployed.releaseId, deployed.approvalId, deployed.percent], ['slots', 'REL-001', 'apr_deploy1', 10]);
    assert.deepEqual(f.calls.find((c) => c.name === 'workflows.featureDeployed').input, { itemId: 'PRD-031', featureId: 'FEAT-031-1', releaseId: 'REL-001' });
    const writes = f.calls.find((c) => c.name === 'devtools.release.record').input;
    assert.deepEqual([writes.project, writes.tags], ['DTE', [{ slug: 'web-storefront', sha: 'abc1234def', name: 'slots-1.0.0' }]]);
    assert.deepEqual(piloting.writes.map((w) => [w.kind, w.state]), [['jira.fix-version', 'recorded'], ['bitbucket.tag', 'recorded']]);
    assert.equal((await t.hosted.services.releaseFor('REL-001')).approved, true);
    // Only a person with deploy-production moves it on or rolls it back.
    assert.equal((await t.post(`${API}/releases/REL-001/advance`, { as: 'priya-s' })).status, 403);
    const everyone = await t.post(`${API}/releases/REL-001/advance`, { as: 'lerato-m' });
    assert.deepEqual([everyone.status, everyone.json.status, everyone.json.percent], [200, 'complete', 100]);
    assert.equal((await t.post(`${API}/releases/REL-001/rollback`, { as: 'lerato-m', body: {} })).status, 400, 'a reason is needed');
    const back = await t.post(`${API}/releases/REL-001/rollback`, { as: 'lerato-m', body: { reason: 'Slot list p95 doubled in the pilot stores' } });
    assert.deepEqual([back.status, back.json.status, back.json.rolledBack.reason], [200, 'rolled-back', 'Slot list p95 doubled in the pilot stores']);
    assert.deepEqual(back.json.rolledBack.to, [{ service: 'web', version: '4.11.2' }]);
    const deployments = (await t.get(`${API}/deployments`, { as: 'naledi-k' })).json.deployments;
    assert.deepEqual(deployments.map((d) => (d.rolledBack ? 'rollback' : d.percent)), ['rollback', 100, 10]);
    assert.ok(['release.deployed', 'release.rolled_back'].every((type) => t.eventLog.some((e) => e.type === type)));
  } finally {
    await t.close();
  }
});

test('the scripted notes say what changes, the evidence and the accepted risks', () => {
  const text = scriptedNotes({ name: 'Slots 1.0', version: '1.0.0', feature: { title: 'Capacity', stories: [{ id: 'S', ref: 'S', title: 'See capacity', status: 'active' }] }, pack: { text: 'all good', findings: { accepted: [{ id: 'FND-1', severityLabel: 'High', title: 'x', acceptedUntil: '2026-11-20T00:00:00Z' }] } } });
  assert.equal(text, 'Slots 1.0 (1.0.0) releases Capacity.\n\nWhat changes:\n- See capacity (S)\n\nEvidence: all good.\n\nAccepted risks:\n- FND-1 (High): x, accepted until 2026-11-20');
});
