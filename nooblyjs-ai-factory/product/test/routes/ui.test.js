// Stage 4 · UI design (docs/roadmap-history.md P6): screens, design-system reuse, accessibility, the handoff preview and
// Send to Software Factory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

const API = '/product/api/v1';

/** A fake lifecycle engine: records the handoff and, like the real one will, emits handoff.created. */
function fakeWorkflows(t) {
  const calls = [];
  return {
    calls,
    async handoff(input) {
      calls.push(input);
      await t().emit('handoff.created', { itemId: input.itemId, system: 'product', workItemIds: input.workItems.map((_, i) => `wi_${i + 1}`) }, input.actor.id);
      return { handoffId: 'hnd_test0001' };
    },
  };
}

async function eventually(check, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('step 5: screens show their status, and the checks list the failing timer label', async () => {
  const t = await startApp({ seed: true });
  try {
    const s = (await t.get(`${API}/ui/PRD-031/screens`, { as: 'lerato-m' })).json;
    assert.deepEqual(s.screens.map((x) => [x.title, x.statusText]), [['Slot picker', 'Approved'], ['Nearby stores', 'In review'], ['Basket with hold', 'Approved'], ['Confirmation', 'Approved']]);
    assert.deepEqual(s.devices.map((d) => [d.label, d.count]), [['Mobile', 4], ['Web', 0], ['Store console', 0]]);
    const ds = (await t.get(`${API}/ui/PRD-031/design-system`, { as: 'lerato-m' })).json;
    assert.deepEqual([ds.version, ds.text, ds.newComponents], ['v3.2', '14 of 16', ['SlotChip', 'HoldTimer']]);
    const a11y = (await t.get(`${API}/ui/PRD-031/accessibility-checks`, { as: 'lerato-m' })).json;
    assert.equal(a11y.text, '3 of 4');
    assert.deepEqual(a11y.checks.filter((c) => c.passed === false).map((c) => c.text), ['Timer needs a screen-reader label']);
  } finally {
    await t.close();
  }
});

test('the handoff preview: 6 work items, the repo count from them (D5), and the cost range', async () => {
  const t = await startApp({ seed: true });
  try {
    const h = (await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json;
    assert.equal(h.title, '6 work items for the Software Factory');
    assert.equal(h.text, 'Estimated $18–$26 · 4 repos');
    assert.deepEqual(h.repos.map((r) => [r.name, r.workItems]), [['slots-api', 2], ['web-storefront', 2], ['mobile-app', 1], ['design-system', 1]]);
    assert.equal(h.workItems[0].text, 'slots-api · hold & release endpoints');
  } finally {
    await t.close();
  }
});

test('step 6: the Design lead sends PRD-031 to the Software Factory; the NooblyJS lifecycle engine creates the handoff', async () => {
  let t;
  const workflows = fakeWorkflows(() => t);
  t = await startApp({ seed: true, services: { workflows } });
  try {
    const res = await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: { note: 'Timer label follows in the first PR.' } });
    assert.equal(res.status, 202);
    assert.equal(res.json.text, 'Sent 6 work items across 4 repos to the Software Factory. The NooblyJS lifecycle engine creates them.');
    assert.deepEqual(res.json.openChecks, ['Timer needs a screen-reader label']);
    assert.equal(workflows.calls[0].workItems.length, 6);
    assert.deepEqual(workflows.calls[0].estimate, { lowUsd: 18, highUsd: 26 });
    assert.deepEqual(workflows.calls[0].actor, { id: 'lerato-m', kind: 'person' });

    const h = await eventually(async () => {
      const x = (await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json;
      return x.status === 'handed-off' && x;
    });
    assert.equal(h.statusText, 'Handed off to the Software Factory');
    assert.equal((await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} })).status, 409);
    const history = (await t.get(`${API}/handoffs`, { as: 'lerato-m' })).json.handoffs;
    assert.equal(history[0].text, 'UI design → Software Factory · 6 work items · 4 repos');
  } finally {
    await t.close();
  }
});

test('sending to the Factory is for Approvers and up, people only, and 503 without the NooblyJS lifecycle engine', async () => {
  let t;
  const workflows = fakeWorkflows(() => t);
  t = await startApp({ seed: true, services: { workflows } });
  try {
    assert.equal((await t.post(`${API}/ui/PRD-031/handoff`, { as: 'priya-s', body: {} })).status, 403);
    assert.equal((await t.post(`${API}/ui/PRD-031/handoff`, { as: 'ada-quill', body: {} })).status, 403);
    assert.equal(workflows.calls.length, 0);
  } finally {
    await t.close();
  }
  const alone = await startApp({ seed: true });
  try {
    const res = await alone.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} });
    assert.equal(res.status, 503);
    assert.equal((await alone.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json.status, 'draft');
  } finally {
    await alone.close();
  }
});

test('a screen is saved with If-Match; the UI agent drafts a screen and plans a handoff', async () => {
  const t = await startApp({ seed: true });
  try {
    const s = (await t.get(`${API}/ui/PRD-031/screens`, { as: 'lerato-m' })).json.screens[1];
    const approved = await t.put(`${API}/ui/PRD-031/screens/nearby-stores`, { as: 'lerato-m', headers: { 'if-match': s.etag }, body: { status: 'approved' } });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.statusText, 'Approved');
    assert.ok(t.eventLog.some((e) => e.type === 'ui.screen_updated'));
    assert.equal((await t.put(`${API}/ui/PRD-031/screens/nearby-stores`, { as: 'lerato-m', headers: { 'if-match': s.etag }, body: { status: 'draft' } })).status, 409);

    await t.post(`${API}/ui/PRD-027/drafts`, { as: 'lerato-m', body: { kind: 'screen', brief: 'order tracking map' } });
    await t.hosted.idle();
    const map = (await t.get(`${API}/ui/PRD-027/screens`, { as: 'lerato-m' })).json.screens;
    assert.deepEqual(map.map((x) => [x.title, x.statusText]), [['Order tracking map', 'Draft']]);

    await t.post(`${API}/ui/PRD-027/drafts`, { as: 'lerato-m', body: { kind: 'handoff-plan' } });
    await t.hosted.idle();
    const plan = (await t.get(`${API}/ui/PRD-027/handoff-preview`, { as: 'lerato-m' })).json;
    assert.ok(plan.count >= 1);
    assert.match(plan.workItems.map((w) => w.title).join(), /Order tracking map/);
  } finally {
    await t.close();
  }
});

test('where it is built (NooblyJS Phase 11): Architecture confirms the repositories; the handoff only sends work there, by full name', async () => {
  let t;
  const workflows = fakeWorkflows(() => t);
  const known = ['acme/slots-api', 'acme/web-storefront', 'acme/mobile-app', 'acme/design-system', 'acme/old'];
  const platform = {
    repository: async (ref) => {
      const name = known.find((n) => n === ref || n.split('/').pop() === ref);
      return name ? { name, source: 'bitbucket', gone: name.endsWith('/old'), access: 'read', url: `https://bitbucket.org/${name}` } : null;
    },
  };
  t = await startApp({ seed: true, services: { workflows, platform } });
  try {
    const before = (await t.get(`${API}/architecture/PRD-031/repositories`, { as: 'priya-s' })).json;
    assert.deepEqual([before.repositories, before.confirmed], [[], null]);
    // The seed story's item has no list, so its handoff goes anywhere, as before.
    assert.deepEqual((await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json.outside, []);

    const url = `${API}/architecture/PRD-031/repositories`;
    assert.equal((await t.put(url, { as: 'naledi-k', body: { repositories: ['slots-api'] } })).status, 403);
    assert.equal((await t.put(url, { as: 'ada-quill', body: { repositories: ['slots-api'] } })).status, 403, 'people choose, agents propose');
    assert.equal((await t.put(url, { as: 'priya-s', body: { repositories: ['nowhere'] } })).json.error.code, 'unknown_repository');
    assert.equal((await t.put(url, { as: 'priya-s', body: { repositories: ['old'] } })).json.error.code, 'repository_gone');

    // Narrowed to three: the mobile app's work item is now outside, and the handoff can't be sent.
    const set = await t.put(url, { as: 'priya-s', body: { repositories: ['slots-api', 'web-storefront', 'design-system'] } });
    assert.equal(set.status, 200);
    assert.deepEqual(set.json.repositories.map((r) => [r.name, r.source]), [['acme/slots-api', 'bitbucket'], ['acme/web-storefront', 'bitbucket'], ['acme/design-system', 'bitbucket']]);
    assert.equal(set.json.confirmed.by, 'priya-s');
    assert.match(set.json.text, /3 repositories, confirmed by/);
    assert.ok(t.eventLog.some((e) => e.type === 'architecture.repositories_set' && e.payload.summary === 'confirmed PRD-031 is built in slots-api, web-storefront, design-system'));

    const preview = (await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json;
    assert.deepEqual([preview.outside, preview.repositories.length], [['mobile-app'], 3]);
    const refused = await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} });
    assert.deepEqual([refused.status, refused.json.error.code], [422, 'outside_repositories']);
    assert.equal(workflows.calls.length, 0);
    assert.equal((await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json.status, 'draft', 'nothing was sent');

    // With the mobile app added back, it goes, each work item named in full and the list with them.
    await t.put(url, { as: 'priya-s', body: { repositories: ['slots-api', 'web-storefront', 'mobile-app', 'design-system'] } });
    assert.equal((await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} })).status, 202);
    const call = workflows.calls[0];
    assert.deepEqual(call.repositories, ['acme/slots-api', 'acme/web-storefront', 'acme/mobile-app', 'acme/design-system']);
    assert.deepEqual([...new Set(call.workItems.map((w) => w.repo))], ['acme/slots-api', 'acme/web-storefront', 'acme/mobile-app', 'acme/design-system']);
  } finally {
    await t.close();
  }
});
