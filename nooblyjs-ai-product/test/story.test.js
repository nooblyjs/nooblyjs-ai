// The NooblyJS Phase 5 test script as one story (docs/roadmap-history.md P7 step 7.6): PRD-031 goes from signal to Send to Software
// Factory, agents drafting and people deciding at each gate. the NooblyJS lifecycle engine is a fake that answers the way the real
// one will: it records decisions and handoffs and emits approval.decided, item.stage_changed and handoff.created.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const API = '/product/api/v1';

async function eventually(check, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('PRD-031 from signal to Send to Software Factory', async () => {
  let t;
  const reviews = new Map([['PRD-031', new Set(['lerato-m'])]]); // Lerato approved v4 already (the seed)
  const workflows = {
    async decide({ itemId, decision, actor }) {
      const approved = reviews.get(itemId) ?? new Set();
      if (decision === 'approve') approved.add(actor.id);
      reviews.set(itemId, approved);
      const outcome = decision === 'approve' ? (approved.size >= 2 ? 'approved' : 'pending') : 'changes-requested';
      await t.emit('approval.decided', { itemId, system: 'product', decision, outcome }, actor.id);
      if (outcome === 'approved') await t.emit('item.stage_changed', { itemId, from: 'product', to: 'architecture' }, actor.id);
    },
    async handoff({ itemId, workItems, actor }) {
      await t.emit('handoff.created', { itemId, system: 'product', workItemIds: workItems.map((_, i) => `wi_${i + 1}`) }, actor.id);
    },
  };
  t = await startApp({ seed: true, services: { workflows } });
  try {
    // 1. Lerato turns "Substitutions feel random" into an idea and scores it.
    const opp = await t.post(`${API}/signals/sig_substitutionsrandom/idea`, { as: 'lerato-m', body: {} });
    const scored = await t.put(`${API}/ideas/${opp.json.id}`, { as: 'lerato-m', headers: { 'if-match': opp.etag }, body: { rice: { reach: 12, impact: 2, confidence: 0.8, effort: 1 } } });
    assert.equal(scored.json.text, 'Search · RICE 19');

    // 2. She asks Ada to draft a spec for it: Spec drafting with progress, then a drafted v1.
    const spec = await t.post(`${API}/specs`, { as: 'lerato-m', body: { title: 'Substitutions that make sense', product: 'Search', idea: opp.json.id } });
    await t.post(`${API}/specs/${spec.json.id}/drafts`, { as: 'lerato-m', body: { kind: 'spec', brief: 'Substitutes should match what the customer usually buys.' } });
    await t.hosted.idle();
    const drafted = (await t.get(`${API}/specs/${spec.json.id}`, { as: 'lerato-m' })).json;
    assert.equal(drafted.authorship.text, 'Drafted by Ada Quill · v1');
    assert.ok(t.eventLog.some((e) => e.type === 'draft.progressed' && e.payload.text === 'Ada Quill drafting · 40%'));

    // 3. PRD-031 is approved (Stevie is the last reviewer) and moves to Architecture; Thabo edits the view as code.
    const approve = await t.post(`${API}/specs/PRD-031/decision`, { as: 'stevie', body: { decision: 'approve' } });
    assert.equal(approve.status, 202);
    await eventually(async () => (await t.get(`${API}/specs/PRD-031`, { as: 'stevie' })).json.status === 'approved');
    const d = await t.get(`${API}/architecture/PRD-031/diagram`, { as: 'thabo-n' });
    const edited = await t.put(`${API}/architecture/PRD-031/diagram`, { as: 'thabo-n', headers: { 'if-match': d.etag }, body: { code: d.json.code.replace('"Event bus"', '"Slot events"') } });
    assert.ok(edited.json.nodes.some((n) => n.label === 'Slot events'));

    // 4. Thabo accepts ADR-014; the quality attributes are the item's gates.
    assert.equal((await t.post(`${API}/adrs/ADR-014/accept`, { as: 'thabo-n' })).status, 200);
    assert.equal((await t.get(`${API}/architecture/PRD-031/standards-check`, { as: 'thabo-n' })).json.text, '4 of 4');
    assert.equal((await t.hosted.services.artefactsFor('PRD-031')).architecture.gates.length, 4);

    // 5. UX and UI: screens with their status; the timer label check fails.
    assert.equal((await t.get(`${API}/ux/PRD-031/journey`, { as: 'lerato-m' })).json.steps.length, 5);
    const a11y = (await t.get(`${API}/ui/PRD-031/accessibility-checks`, { as: 'lerato-m' })).json;
    assert.ok(a11y.checks.some((c) => c.passed === false && c.text === 'Timer needs a screen-reader label'));

    // 6. The Design lead sends it to the Software Factory: 6 work items, $18–$26, created by the NooblyJS lifecycle engine.
    const sent = await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} });
    assert.equal(sent.status, 202);
    const preview = await eventually(async () => {
      const h = (await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json;
      return h.status === 'handed-off' && h;
    });
    assert.equal(preview.title, '6 work items for the Software Factory');
    assert.match(preview.text, /^Estimated \$18–\$26/);
    const flow = (await t.get(`${API}/handoffs`, { as: 'lerato-m' })).json.handoffs.map((h) => `${h.itemId} ${h.text}`);
    assert.ok(flow.some((x) => x.startsWith('PRD-031 Product → Architecture')));
    assert.ok(flow.some((x) => x.startsWith('PRD-031 UI design → Software Factory')));
  } finally {
    await t.close();
  }
});
