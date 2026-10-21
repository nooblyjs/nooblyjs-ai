// NooblyJS Phase 22 (roadmap I10) on the app on its own: Production changes only through a release. Operations' deployer
// applies a release whose deploy approval two people gave (the lifecycle's record, checked here), to a share of the
// traffic, keeping what was there; the rollback returns to it in one action; anything else that applies to an
// environment is refused and audited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const API = '/infrastructure/api/v1';
const approvals = [
  { id: 'apr_ok', type: 'deploy', status: 'approved', ref: { app: 'operations', id: 'REL-001' } },
  { id: 'apr_wait', type: 'deploy', status: 'open', ref: { app: 'operations', id: 'REL-002' } },
];
const services = { workflows: { approvals: async ({ type }) => approvals.filter((a) => !type || a.type === type) } };
const NEW = [{ service: 'api', version: '0.9.4' }, { service: 'web', version: '4.12.0' }];

test('a release two people approved goes to Production, a share at a time; the rollback returns to what was there', async () => {
  const t = await startApp({ seed: true, services });
  try {
    const s = t.hosted.services;
    const candidate = await s.releaseCandidate({ itemId: 'PRD-031' });
    assert.deepEqual([candidate.product, candidate.from.name, candidate.production.name, candidate.production.deployed], ['slots', 'staging', 'prod', [{ service: 'web', version: '4.11.2' }]]);
    assert.equal(await s.releaseCandidate({ itemId: 'PRD-999' }), null);
    await assert.rejects(s.deployRelease({ product: 'slots', releaseId: 'REL-002', approvalId: 'apr_wait', deployed: NEW, percent: 10 }), { code: 'not_approved' });
    await assert.rejects(s.deployRelease({ product: 'slots', releaseId: 'REL-001', approvalId: 'apr_wait', deployed: NEW, percent: 10 }), { code: 'no_release_approval' }, 'another release\'s approval');
    const pilot = await s.deployRelease({ product: 'slots', releaseId: 'REL-001', approvalId: 'apr_ok', version: '1.0.0', deployed: NEW, percent: 10, by: { id: 'thabo-n', name: 'Thabo N.' } });
    assert.deepEqual([pilot.environment, pilot.percent, pilot.previous], ['prod', 10, [{ service: 'web', version: '4.11.2' }]]);
    const all = await s.deployRelease({ product: 'slots', releaseId: 'REL-001', approvalId: 'apr_ok', version: '1.0.0', deployed: NEW, percent: 100 });
    assert.deepEqual(all.previous, [{ service: 'web', version: '4.11.2' }], 'the next step keeps what was there before the release');
    const prod = (await t.get(`${API}/environments/prod`, { as: 'stevie' })).json;
    assert.deepEqual(prod.deployedServices, NEW);
    assert.ok(t.eventLog.some((e) => e.type === 'environment.deployed' && e.payload.percent === 10 && e.payload.releaseId === 'REL-001'));
    await assert.rejects(s.rollbackRelease({ product: 'slots', releaseId: 'REL-009', reason: 'x' }), { code: 'not_deployed' });
    const back = await s.rollbackRelease({ product: 'slots', releaseId: 'REL-001', reason: 'p95 doubled in the pilot' });
    assert.deepEqual(back.deployed, [{ service: 'web', version: '4.11.2' }]);
    assert.ok(t.eventLog.some((e) => e.type === 'environment.rolled_back' && e.payload.reason === 'p95 doubled in the pilot'));
  } finally {
    await t.close();
  }
});

test('applying to an environment directly is refused and audited: Production through a release, the others by promotion', async () => {
  const t = await startApp({ seed: true, services });
  try {
    const prod = await t.post(`${API}/environments/prod/deploy`, { as: 'stevie', body: { deployed: NEW } });
    assert.deepEqual([prod.status, prod.json.error.code], [422, 'release_only']);
    assert.ok(t.auditLog.some((a) => a.action === 'deploy.refused' && a.actor === 'stevie' && a.target === 'prod'));
    const test1 = await t.post(`${API}/environments/test-slots/deploy`, { as: 'stevie', body: { deployed: NEW } });
    assert.deepEqual([test1.status, test1.json.error.code], [422, 'promote_instead']);
    assert.equal((await t.post(`${API}/environments/nowhere/deploy`, { as: 'stevie', body: {} })).status, 404);
  } finally {
    await t.close();
  }
});
