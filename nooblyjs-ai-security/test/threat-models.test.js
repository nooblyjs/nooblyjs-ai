// Threat models (root roadmap Phase 19, step 1 on the app on its own): drafted from PRD-031's container view by the
// security agent (Rook Vale is off shift, so Rhea Voss drafts, and says why), STRIDE per trust boundary with a
// mitigation each, threats on the slot hold flow; the draft opens a threat-model approval; a Contributor can't accept,
// an agent is refused and audited, an Architect accepts and the approval is closed; a decision through Home is not
// closed twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { fakes } from './fakes.js';
import { strideFrom, zoneOf } from '../src/services/stride.js';
import { PRD031 } from './fakes.js';

const API = '/security/api/v1';

test('the zones and the STRIDE draft from the container view', () => {
  const zones = Object.fromEntries(PRD031.containers.map((c) => [c.id, zoneOf(c)]));
  assert.deepEqual(zones, { customerApp: 'device', console: 'device', gateway: 'edge', slotApi: 'service', slotCache: 'data', eventBus: 'data', inventory: 'data', planner: 'outside' });
  const { boundaries, threats } = strideFrom(PRD031);
  assert.equal(boundaries.length, 7, 'every relation crosses a boundary');
  assert.ok(threats.every((t) => t.mitigation.text && ['requirement', 'quality-attribute'].includes(t.mitigation.becomes)));
  assert.deepEqual(threats.map((t) => t.id).slice(0, 3), ['THR-031-1', 'THR-031-2', 'THR-031-3']);
  assert.ok(threats.some((t) => t.holdFlow && /hold/.test(t.title)), 'threats on the slot hold flow');
  assert.ok(!threats.some((t) => t.stride === 'Tampering' && /Store inventory/.test(t.title)), 'read only: no tampering threat');
  assert.equal(threats.find((t) => t.stride === 'Denial of service').mitigation.target, 'At most 5 holds a minute per customer');
});

test('drafted by the agent who can work; a Contributor can\'t accept; an agent is refused and audited; an Architect accepts', async () => {
  const f = fakes();
  const t = await startApp({ seed: true, services: f.services });
  try {
    assert.equal((await t.post(`${API}/threat-models`, { as: 'naledi-k', body: { itemId: 'PRD-031' } })).status, 403, 'a Viewer');
    assert.equal((await t.post(`${API}/threat-models`, { as: 'priya-s', body: { itemId: 'PRD-999' } })).status, 409, 'no container view');
    const res = await t.post(`${API}/threat-models`, { as: 'priya-s', body: { itemId: 'PRD-031' } });
    assert.equal(res.status, 201);
    const tm = res.json;
    assert.deepEqual([tm.id, tm.version, tm.status, tm.draftedBy.name], ['TM-031', 1, 'waiting', 'Rhea Voss']);
    assert.equal(tm.why, 'Rook Vale is off shift, so Rhea Voss drafted it');
    assert.equal(f.calls.find((c) => c.name === 'teammates.runTask').input.workType, 'threat-modelling');
    const asked = f.calls.find((c) => c.name === 'workflows.requestAppApproval').input;
    assert.deepEqual([asked.type, asked.itemId, asked.subject, asked.ref], ['threat-model', 'PRD-031', 'TM-031 v1', { app: 'security', id: 'TM-031', version: 1, kind: 'threat-model' }]);
    // Priya (Contributor) can't; the refusal is audited.
    assert.equal((await t.post(`${API}/threat-models/TM-031/decision`, { as: 'priya-s', body: { decision: 'approve' } })).status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'accept-threat-model'));
    // An agent, even with an Owner's role, is refused.
    await assert.rejects(t.hosted.services.decideApproval({ id: 'TM-031', decision: 'approve', person: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' } }), { code: 'people_only' });
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'ada-quill'));
    // Asking for changes needs a reason; a stale version is refused.
    assert.equal((await t.post(`${API}/threat-models/TM-031/decision`, { as: 'thabo-n', body: { decision: 'request-changes' } })).status, 400);
    assert.equal((await t.post(`${API}/threat-models/TM-031/decision`, { as: 'thabo-n', body: { decision: 'approve', version: 3 } })).status, 409);
    const ok = await t.post(`${API}/threat-models/TM-031/decision`, { as: 'thabo-n', body: { decision: 'approve', version: 1 } });
    assert.deepEqual([ok.status, ok.json.status, ok.json.decision.by], [200, 'accepted', 'thabo-n']);
    assert.deepEqual(f.calls.find((c) => c.name === 'workflows.closeAppApproval').input.ref, { app: 'security', id: 'TM-031', version: 1, kind: 'threat-model' });
    assert.ok(t.eventLog.some((e) => e.type === 'threat_model.accepted' && e.payload.system === 'security' && /accepted threat model TM-031 v1/.test(e.payload.summary)));
    assert.equal((await t.post(`${API}/threat-models/TM-031/decision`, { as: 'thabo-n', body: { decision: 'approve' } })).status, 409, 'decided already');
    // Drafting again is version 2, waiting again; decided through Home, the approval is not closed again here.
    await t.post(`${API}/threat-models`, { as: 'priya-s', body: { itemId: 'PRD-031' } });
    await t.hosted.services.decideApproval({ id: 'TM-031', version: 2, decision: 'approve', person: { id: 'stevie', name: 'Stevie', accessRole: 'Owner' } });
    assert.equal(f.calls.filter((c) => c.name === 'workflows.closeAppApproval').length, 1);
    const checks = await t.hosted.services.checksFor('PRD-031');
    assert.deepEqual([checks[0].key, checks[0].result], ['threat-model-accepted', 'passed']);
    const trace = await t.hosted.services.trace('PRD-031');
    assert.ok(trace.links.some((l) => l.rel === 'mitigates' && l.from === 'MIT-031-1' && l.to === 'THR-031-1'));
  } finally {
    await t.close();
  }
});
