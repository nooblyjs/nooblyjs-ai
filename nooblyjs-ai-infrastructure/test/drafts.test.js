// NooblyJS Phase 26 (roadmap I7): Ines Tau drafts a new version of a design from the item's architecture, as her
// teammate task, when a person asks; an accepted ADR or a changed architecture only offers a new draft. With fakes for
// Product (designInputs) and Digital Teammates (the roster and runTask).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { scriptedResources } from '../src/services/drafts.js';

const API = '/infrastructure/api/v1';
const INPUTS = {
  itemId: 'PRD-031',
  containers: [
    { id: 'web', kind: 'container', label: 'Web storefront', tech: 'Node 22', status: 'existing' },
    { id: 'slots', kind: 'container', label: 'Slot API', tech: 'Node 22', status: 'new' },
    { id: 'notify', kind: 'container', label: 'Slot notifier', tech: 'Node 22', status: 'new' },
    { id: 'shopper', kind: 'person', label: 'Shopper' },
  ],
  relations: [],
  qualityAttributes: [{ category: 'latency', name: 'Slot list', target: 'p95 < 300 ms' }],
  adrs: [{ id: 'ADR-014', title: 'Event-driven slot release', status: 'accepted' }],
};
const product = { designInputs: async (itemId) => (itemId === 'PRD-031' ? INPUTS : null) };

function teammates({ hired = true, output = null } = {}) {
  const calls = [];
  return {
    calls,
    service: {
      roster: async () => (hired ? [{ id: 'ines-tau', name: 'Ines Tau', canWork: true }] : [{ id: 'ada-quill', name: 'Ada Quill', canWork: true }]),
      runTask: async (request) => {
        calls.push(request);
        return output ? { output, costUsd: 0.62, modelRoute: 'infrastructure-design', scripted: false } : { ...(await request.scripted()), costUsd: 0, modelRoute: 'mock/scripted', scripted: true };
      },
    },
  };
}

test('the scripted draft keeps the resources and adds what the architecture has that the design lacks', () => {
  const design = { resources: [{ key: 'slot-api', layer: 'compute', name: 'Slot API · container app', state: 'new' }] };
  const { resources, added } = scriptedResources(design, INPUTS);
  assert.deepEqual(added, ['Slot notifier', 'Alarms']);
  assert.equal(resources.length, 3);
  assert.deepEqual(resources.find((r) => r.key === 'slot-notifier'), { key: 'slot-notifier', layer: 'compute', name: 'Slot notifier', detail: 'Node 22 · from the container view', state: 'new', creates: 1 });
});

test('step 1: Thabo asks Ines for a new draft of INF-031: v3, drafted by her, waiting for approvals; v2 kept; her task and cost', async () => {
  const tm = teammates();
  const t = await startApp({ seed: true, services: { product, teammates: tm.service } });
  try {
    const r = await t.post(`${API}/designs/INF-031/drafts`, { as: 'thabo-n', body: {} });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.version, 3);
    assert.equal(r.json.draftedBy.name, 'Ines Tau');
    assert.match(r.json.text, /^Ines Tau drafted INF-031 v3: it adds Slot notifier\. It waits for its approvals\.$/);
    // Her teammate task: the work type, the item, who asked, and the architecture as context.
    assert.deepEqual([tm.calls[0].slug, tm.calls[0].workType, tm.calls[0].itemId, tm.calls[0].system, tm.calls[0].caller.id], ['ines-tau', 'infrastructure-design', 'PRD-031', 'infrastructure', 'thabo-n']);
    assert.match(tm.calls[0].input.context, /Slot notifier/);
    const d = (await t.get(`${API}/designs/INF-031`, { as: 'naledi-k' })).json;
    assert.deepEqual([d.version, d.status, d.draftedBy.name], [3, 'waiting-approval', 'Ines Tau']);
    // The Architect's approval through ADR-014 stands; the platform owner's waits again.
    assert.deepEqual(d.approvals.map((a) => a.stateText), ['Via ADR-014', 'Waiting']);
    assert.ok(d.builtFrom.some((b) => b.label === 'ADR-014 · Event-driven slot release'));
    const versions = (await t.get(`${API}/designs/INF-031/versions`, { as: 'naledi-k' })).json.versions;
    assert.ok(versions.some((v) => v.version === 2) && versions.some((v) => v.version === 3 && v.current));
    const action = t.eventLog.find((e) => e.type === 'agent.action' && e.payload.system === 'infrastructure');
    assert.deepEqual([action.payload.actor, action.payload.itemId, action.payload.action, action.payload.requestedBy], ['ines-tau', 'PRD-031', 'infrastructure-design', 'thabo-n']);
    assert.ok(t.auditLog.some((a) => a.action === 'agent.infrastructure.design_drafted' && a.actor === 'ines-tau' && a.requestedBy === 'thabo-n'));
  } finally {
    await t.close();
  }
});

test('a model\'s draft is used when it is a list of resources; costs and modules of the same resource carry over', async () => {
  const tm = teammates({ output: { resources: [{ key: 'slot-api', layer: 'compute', name: 'Slot API · container app', detail: '2–8 replicas', state: 'new' }, { key: 'queue', layer: 'messaging', name: 'Slot queue', state: 'new' }, { name: 'bad', layer: 'nowhere' }] } });
  const t = await startApp({ seed: true, services: { product, teammates: tm.service } });
  try {
    const r = await t.post(`${API}/designs/INF-031/drafts`, { as: 'priya-s', body: {} });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json.added, ['Slot queue']);
    assert.equal(r.json.costUsd, 0.62);
    const d = (await t.get(`${API}/designs/INF-031`, { as: 'naledi-k' })).json;
    const names = d.layers.flatMap((l) => l.resources.map((x) => x.name));
    assert.deepEqual(names.sort(), ['Slot API · container app', 'Slot queue']);
  } finally {
    await t.close();
  }
});

test('step 3: refused for an agent and a Viewer; Ines not hired says so', async () => {
  const t = await startApp({ seed: true, services: { product, teammates: teammates({ hired: false }).service } });
  try {
    assert.equal((await t.post(`${API}/designs/INF-031/drafts`, { as: 'ada-quill', body: {} })).status, 403);
    assert.equal((await t.post(`${API}/designs/INF-031/drafts`, { as: 'naledi-k', body: {} })).status, 403);
    const r = await t.post(`${API}/designs/INF-031/drafts`, { as: 'thabo-n', body: {} });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /Ines Tau drafts infrastructure designs, and isn't hired here/);
  } finally {
    await t.close();
  }
});

test('step 2: an accepted ADR offers a new draft, saying why; nothing drafts by itself; a draft clears the offer', async () => {
  const tm = teammates();
  const t = await startApp({ seed: true, services: { product, teammates: tm.service } });
  try {
    await t.emit('adr.accepted', { adrId: 'ADR-014', itemId: 'PRD-031', title: 'Event-driven slot release' }, 'thabo-n');
    await new Promise((r) => setTimeout(r, 30));
    let d = (await t.get(`${API}/designs/INF-031`, { as: 'naledi-k' })).json;
    assert.equal(d.redraft.text, 'A new draft is suggested: ADR-014 was accepted (Event-driven slot release).');
    assert.equal(d.version, 2, 'nothing drafted by itself');
    assert.equal(tm.calls.length, 0);
    await t.emit('architecture.updated', { itemId: 'PRD-031', part: 'quality-attributes' }, 'thabo-n');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await t.get(`${API}/designs/INF-031`, { as: 'naledi-k' })).json.redraft.text, "A new draft is suggested: PRD-031's quality attributes changed.");
    await t.post(`${API}/designs/INF-031/drafts`, { as: 'thabo-n', body: {} });
    d = (await t.get(`${API}/designs/INF-031`, { as: 'naledi-k' })).json;
    assert.equal(d.redraft, null);
  } finally {
    await t.close();
  }
});
