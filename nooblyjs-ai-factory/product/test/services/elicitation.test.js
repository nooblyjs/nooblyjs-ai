// NooblyJS Phase 18: requirements elicitation, on the section on its own (the seed's PRD-031, a stand-in Design catalogue,
// no Digital Teammates, so the analyst agent is a stand-in). Session notes become candidates, each quoting the sentence it
// came from; a person with accept-requirement accepts, merges or rejects each one (a Contributor can't; an agent is
// refused and audited); the NFR walk's answers are requirements (or, from a Contributor, candidates) and quality
// attributes; and the spec's readiness has a questions check only while it has questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

const API = '/product/api/v1';
const E = `${API}/elicitation/PRD-031`;
const design = {
  nfrCatalogue: async () => ({ categories: [
    { key: 'performance', label: 'Performance', prompt: 'How fast must it be, and when?', entries: [] },
    { key: 'privacy', label: 'Privacy', prompt: 'What personal data does it touch?', entries: [] },
  ] }),
};
const NOTES = 'Store manager: Customers need to see free slots before checkout.\nThe slot list must load in under 300 ms at the evening peak.\nWe talked about the weather.';

test('candidates quote the notes; a person accepts, merges or rejects; a Contributor can\'t; an agent is refused and audited', async () => {
  const t = await startApp({ seed: true, services: { design } });
  try {
    assert.equal((await t.post(`${E}/candidates/draft`, { as: 'priya-s' })).status, 409, 'no session yet');
    assert.equal((await t.post(`${E}/sessions`, { as: 'priya-s', body: { kind: 'chat', notes: 'x' } })).status, 400);
    assert.equal((await t.post(`${E}/sessions`, { as: 'priya-s', body: { kind: 'interview' } })).status, 400, 'notes are required');
    assert.equal((await t.post(`${E}/sessions`, { as: 'naledi-k', body: { kind: 'interview', notes: NOTES } })).status, 403, 'a Viewer');
    assert.equal((await t.post(`${E}/sessions`, { as: 'priya-s', body: { kind: 'interview', title: 'Store manager', notes: NOTES } })).json.id, 'SES-031-1');
    assert.equal((await t.post(`${E}/sessions`, { as: 'priya-s', body: { kind: 'workshop', notes: 'Customers want a reminder the day before.' } })).json.id, 'SES-031-2');
    const { candidates } = (await t.post(`${E}/candidates/draft`, { as: 'priya-s' })).json;
    assert.deepEqual(candidates.map((c) => [c.id, c.kind, c.category ?? null, c.quotes[0].session]), [
      ['CAN-031-1', 'functional', null, 'SES-031-1'],
      ['CAN-031-2', 'nfr', 'performance', 'SES-031-1'],
      ['CAN-031-3', 'functional', null, 'SES-031-2'],
    ]);
    assert.equal(candidates[0].quotes[0].quote, 'Customers need to see free slots before checkout.', 'the speaker\'s label is left out');
    assert.ok(t.eventLog.some((e) => e.type === 'elicitation.candidates_drafted'));
    // A Contributor can't decide; a merge into a decided candidate, or into itself, is refused.
    assert.equal((await t.post(`${E}/candidates/CAN-031-1/accept`, { as: 'priya-s' })).status, 403);
    assert.equal((await t.post(`${E}/candidates/CAN-031-3/merge`, { as: 'lerato-m', body: { into: 'CAN-031-3' } })).status, 400);
    assert.equal((await t.post(`${E}/candidates/CAN-031-3/merge`, { as: 'lerato-m', body: { into: 'CAN-031-1' } })).status, 200);
    const req = (await t.post(`${E}/candidates/CAN-031-1/accept`, { as: 'lerato-m' })).json;
    assert.deepEqual([req.id, req.from, req.quotes.map((q) => q.session)], ['REQ-031-01', ['CAN-031-1', 'CAN-031-3'], ['SES-031-1', 'SES-031-2']]);
    // A rejection needs a reason.
    assert.equal((await t.post(`${E}/candidates/CAN-031-2/reject`, { as: 'lerato-m', body: {} })).status, 400);
    // An agent, whatever its role, is refused; the refusal is audited.
    await assert.rejects(t.hosted.services.decideCandidate({ itemId: 'PRD-031', candidateId: 'CAN-031-2', decision: 'accept', actor: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' } }), { code: 'people_only' });
    assert.ok(t.auditLog.some((r) => r.action === 'access.refused' && r.actor === 'ada-quill'));
    assert.equal((await t.post(`${E}/candidates/CAN-031-2/reject`, { as: 'lerato-m', body: { reason: 'The NFR walk covers it' } })).status, 200);
    assert.equal((await t.post(`${E}/candidates/CAN-031-2/accept`, { as: 'lerato-m' })).status, 409, 'decided already');
    // An acceptance criterion on the requirement; the spec lists only what was accepted.
    assert.equal((await t.post(`${E}/requirements/REQ-031-01/criteria`, { as: 'priya-s', body: { text: 'Free slots show on the basket page' } })).json.id, 'AC-031-01-1');
    const spec = (await t.get(`${API}/specs/PRD-031`, { as: 'priya-s' })).json;
    assert.deepEqual(spec.requirements.map((r) => [r.id, r.acceptedBy.id, r.criteria.length]), [['REQ-031-01', 'lerato-m', 1]]);
    const view = (await t.get(E, { as: 'naledi-k' })).json;
    assert.equal(view.summary.text, '1 requirement · 0 candidates to decide · 0 open questions');
  } finally {
    await t.close();
  }
});

test('the NFR walk: a person\'s answers are requirements and quality attributes, a Contributor\'s are candidates; not applicable needs a reason', async () => {
  const t = await startApp({ seed: true, services: { design } });
  try {
    assert.equal((await t.put(`${E}/nfr/latency`, { as: 'lerato-m', body: { notApplicable: true, reason: 'x' } })).status, 404);
    assert.equal((await t.put(`${E}/nfr/privacy`, { as: 'lerato-m', body: { notApplicable: true } })).status, 400);
    assert.equal((await t.put(`${E}/nfr/performance`, { as: 'lerato-m', body: { answers: [{ text: 'Slots load fast' }] } })).status, 400, 'a target is required');
    const perf = (await t.put(`${E}/nfr/performance`, { as: 'lerato-m', body: { answers: [{ text: 'The slot list loads at the evening peak', target: 'p95 < 300 ms' }] } })).json;
    assert.deepEqual(perf.requirements.map((r) => [r.id, r.kind, r.category, r.target]), [['REQ-031-01', 'nfr', 'performance', 'p95 < 300 ms']]);
    const qa = await t.hosted.services.gatesFor('PRD-031');
    assert.ok(qa.some((q) => q.attribute === 'Performance' && q.scenario === 'The slot list loads at the evening peak (REQ-031-01)' && q.target === 'p95 < 300 ms'), JSON.stringify(qa));
    const priv = (await t.put(`${E}/nfr/privacy`, { as: 'priya-s', body: { answers: [{ text: 'No address leaves the store system', target: 'None sent' }] } })).json;
    assert.deepEqual(priv.requirements, []);
    const view = (await t.get(E, { as: 'priya-s' })).json;
    assert.deepEqual(view.candidates.map((c) => [c.id, c.kind, c.status, c.draftedBy.id]), [['CAN-031-1', 'nfr', 'proposed', 'priya-s']]);
    assert.equal(view.nfr.text, '2 of 2 categories walked');
    assert.equal(view.nfr.categories[0].prompt, 'How fast must it be, and when?');
  } finally {
    await t.close();
  }
});

test('questions: no check until there is one; an open one fails naming it; answered, it passes', async () => {
  const t = await startApp({ seed: true, services: { design } });
  try {
    const before = await t.hosted.services.readinessFacts('PRD-031');
    assert.equal(before.facts['questions-answered'], undefined);
    const q = await t.post(`${E}/questions`, { as: 'priya-s', body: { text: 'Which stores go first?', owner: 'lerato-m' } });
    assert.equal(q.json.id, 'Q-031-1');
    const open = (await t.hosted.services.readinessFacts('PRD-031')).facts['questions-answered'];
    assert.deepEqual([open.value, open.detail, open.check.failed], [false, 'Q-031-1 "Which stores go first?" (owner lerato-m)', 'A question is still open']);
    assert.equal((await t.put(`${E}/questions/Q-031-1`, { as: 'priya-s', body: {} })).status, 400);
    assert.equal((await t.put(`${E}/questions/Q-031-1`, { as: 'priya-s', body: { answer: 'Cape Town, then Durban' } })).status, 200);
    assert.equal((await t.hosted.services.readinessFacts('PRD-031')).facts['questions-answered'].value, true);
    assert.equal((await t.get(`${API}/elicitation/PRD-999`, { as: 'priya-s' })).status, 404);
  } finally {
    await t.close();
  }
});
