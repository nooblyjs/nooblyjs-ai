// Phase 16c in the real app (root roadmap Phase 16c test script): PRD-031 enters Design with its Product handoff; the
// Design section (nooblyjs-ai-factory/design, at /factory/design) drafts its business requirements, solution
// architecture, functional analysis and stories as teammate tasks; people accept and shape them; and one story at a
// time goes to Engineering with its Design handoff, through the lifecycle engine. The steps run in order on one data
// folder, with the Factory and Teammates hosted: each draft is a hired teammate's task, which plays the section's
// scripted draft with no model configured.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let thabo;
let priya;
let naledi;
const design = '/factory/design/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const patch = (c, url, json = {}) => c.request(url, { method: 'PATCH', json });
const designOf = async (c = priya) => (await c.json(`${design}/items/PRD-031`)).body;
const services = () => env.noobly.hosted.apps.find((a) => a.name === 'factory').provides.design;

before(async () => {
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
    ],
  });
  [stevie, lerato, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
  await thabo.signIn('thabo-n');
  await priya.signIn('priya-s');
  await naledi.signIn('naledi-k');
});
after(async () => { await env?.stop(); });

test('the Factory\'s Design group has the five rows of Design, after Architecture; Design starts with the Product handoff', async () => {
  const { apps } = (await stevie.json('/api/v1/shell')).body;
  const factory = apps.find((a) => a.name === 'factory');
  assert.deepEqual(factory.nav.filter((n) => n.group === 'Design').map((n) => n.label), ['Architecture', 'Business requirements', 'Solution architecture', 'Functional analysis', 'Stories', 'Handoff to the Factory']);
  for (const page of ['/factory/design/requirements', '/factory/design/stories/PRD-031', '/factory/design/js/module.js', '/factory/design/css/design.css']) {
    assert.equal((await stevie.get(page)).status, 200, page);
  }
  // PRD-031 is still in Product: nothing in Design can be written for it yet.
  const early = await post(priya, `${design}/items/PRD-031/draft/requirements`);
  assert.equal(early.status, 409);
  assert.match((await early.json()).error.message, /starts with the Product handoff/);
});

test('step 1: PRD-031 enters Design; the analyst agent drafts its business requirements, each quoting the spec; Lerato accepts them, an agent is refused', async () => {
  const handed = await post(stevie, '/workflows/api/v1/approvals/apr_prd031spec/decision', { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
  assert.equal((await handed.json()).item.stage, 'design');
  const res = await post(lerato, `${design}/items/PRD-031/draft/requirements`);
  assert.equal(res.status, 200);
  const drafted = await res.json();
  assert.equal(drafted.requirements.length, 6);
  assert.ok(drafted.requirements.every((r) => r.draftedBy.id === 'ada-quill'), 'Ada Quill drafted them');
  await eventually(async () => {
    const events = await today(env.store, 'events');
    assert.ok(events.some((e) => e.type === 'teammate.task_finished' && e.payload.workType === 'requirements-drafting' && e.payload.itemId === 'PRD-031'), 'a teammate task, on her timesheet');
  });
  const spec = (await stevie.json('/factory/product/api/v1/specs/PRD-031')).body;
  const specText = JSON.stringify(spec);
  for (const r of drafted.requirements) assert.ok(specText.includes(JSON.stringify(r.source.quote).slice(1, -1)), `${r.id} quotes the spec: ${r.source.quote}`);
  for (const r of drafted.requirements) assert.equal((await post(lerato, `${design}/items/PRD-031/requirements/${r.id}/accept`)).status, 200, r.id);
  assert.equal((await designOf()).parts.requirements, '6 business requirements · 6 accepted');
  // A Contributor can't, and an agent, whatever its role, is refused and the refusal audited.
  assert.equal((await post(priya, `${design}/items/PRD-031/requirements/BR-031-01/accept`)).status, 403);
  await assert.rejects(services().acceptRequirement({ itemId: 'PRD-031', requirementId: 'BR-031-01', actor: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' } }), { code: 'people_only' });
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.actor === 'ada-quill' && r.action === 'access.refused' && /accept a business requirement/.test(r.reason)));
  });
});

test('step 2: impacted systems list web-storefront, slots-api and stores-service, each new or changed, with an owner', async () => {
  const res = await post(thabo, `${design}/items/PRD-031/draft/solution`);
  assert.equal(res.status, 200);
  const { systems, nfrs, features } = await res.json();
  assert.deepEqual(systems.map((s) => s.name), ['web-storefront', 'slots-api', 'stores-service']);
  assert.ok(systems.every((s) => ['new', 'changed'].includes(s.change) && s.team), JSON.stringify(systems));
  assert.deepEqual(systems.map((s) => s.team), ['checkout-squad', 'delivery-squad', 'delivery-squad']);
  assert.ok(nfrs.some((n) => n.target === 'p95 < 300 ms'), 'the latency quality attribute is an NFR');
  assert.equal(features.length, 3);
});

test('step 3: an interface with only one side fails the Design handoff check, naming it; naming the other side passes it', async () => {
  assert.equal((await post(priya, `${design}/items/PRD-031/draft/functional`)).status, 200);
  const added = await post(priya, `${design}/items/PRD-031/interfaces`, { name: 'Slot API → stores-service', kind: 'api', from: 'Slot API', contract: 'GET /stores/:id/pickers' });
  assert.equal(added.status, 201);
  const { interfaceId } = await added.json();
  const check = (d) => d.readiness.checks.find((c) => c.key === 'interfaces-complete');
  assert.equal(check(await designOf()).passed, false);
  assert.match(check(await designOf()).text, new RegExp(`${interfaceId} has no "to" side`));
  assert.equal((await patch(priya, `${design}/items/PRD-031/interfaces/${interfaceId}`, { to: 'stores-service' })).status, 200);
  assert.equal(check(await designOf()).passed, true);
});

test('step 4: the stories: three, each tracing back to business requirements and its feature; merge two, split one', async () => {
  const res = await post(priya, `${design}/items/PRD-031/draft/stories`);
  assert.equal(res.status, 200);
  const { stories } = await res.json();
  assert.deepEqual(stories.map((s) => s.id), ['STORY-031-1', 'STORY-031-2', 'STORY-031-3']);
  assert.ok(stories.every((s) => s.requirements.length && /^FEAT-031-\d$/.test(s.feature)));
  // Each is a lifecycle item of its own, in Design, linked to PRD-031 and its feature.
  const story = (await stevie.json('/workflows/api/v1/items/STORY-031-2')).body.item;
  assert.deepEqual([story.type, story.stage, story.parent.id, story.feature.id], ['story', 'design', 'PRD-031', 'FEAT-031-2']);

  const merged = await post(priya, `${design}/items/PRD-031/stories/merge`, { ids: ['STORY-031-2', 'STORY-031-3'] });
  assert.deepEqual((await merged.json()).stories.map((s) => s.id), ['STORY-031-1', 'STORY-031-2']);
  assert.equal((await stevie.json('/workflows/api/v1/items/STORY-031-3')).body.item.status, 'withdrawn');
  const split = await post(priya, `${design}/items/PRD-031/stories/STORY-031-2/split`, { parts: [{ title: 'Hold a slot while paying' }, { title: 'Release evening capacity when pickers start' }] });
  assert.deepEqual((await split.json()).stories.map((s) => s.id), ['STORY-031-1', 'STORY-031-2', 'STORY-031-4']);
  assert.equal((await stevie.json('/workflows/api/v1/items/PRD-031')).body.item.stories.text, '0 of 3 stories handed off');
});

test('step 5: Thabo hands off STORY-031-1 alone: it is in Engineer; PRD-031 is still in Design and shows "1 of 3 stories handed off"', async () => {
  // ADR-014 is still proposed, so the check fails, naming it, until Thabo accepts it.
  const refused = await post(thabo, `${design}/items/PRD-031/stories/STORY-031-1/handoff`, {});
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error.message, /ADR-014 is still proposed/);
  assert.equal((await post(thabo, '/workflows/api/v1/approvals/apr_adr014/decision', { decision: 'approve' })).status, 200);
  await eventually(async () => assert.equal((await designOf()).readiness.passed, 3));

  // A Viewer can't, and neither can an agent.
  assert.equal((await post(naledi, `${design}/items/PRD-031/stories/STORY-031-1/handoff`, {})).status, 403);
  await assert.rejects(env.noobly.lifecycle.services.handoffStory({ storyId: 'STORY-031-1', actor: { id: 'rhea-voss', name: 'Rhea Voss', kind: 'agent' } }), { code: 'people_only' });

  const res = await post(thabo, `${design}/items/PRD-031/stories/STORY-031-1/handoff`, {});
  assert.equal(res.status, 200);
  const done = await res.json();
  assert.equal(done.story.stage, 'engineer');
  assert.equal(done.design.parts.handoff, '1 of 3 stories handed off');
  const story = (await stevie.json('/workflows/api/v1/items/STORY-031-1')).body;
  assert.equal(story.item.stage, 'engineer');
  assert.ok(story.approvals.some((a) => a.type === 'design-handoff' && a.status === 'approved'));
  const parent = (await stevie.json('/workflows/api/v1/items/PRD-031')).body;
  assert.equal(parent.item.stage, 'design');
  assert.equal(parent.item.stories.text, '1 of 3 stories handed off');
  assert.equal(parent.actions.canAdvance, false, 'PRD-031 goes on story by story');
  // Nothing is built before the Engineering sign-off.
  assert.deepEqual((await stevie.json('/api/v1/home/items/STORY-031-1/runs')).body.runs, []);
  // The Product section's handoff page sends to Design's instead of offering its own Send.
  const preview = (await stevie.json('/factory/product/api/v1/ui/PRD-031/handoff-preview')).body;
  assert.deepEqual(preview.perStory, { text: 'PRD-031 goes on story by story: hand each of its 3 stories to Engineering in Design.', href: '/factory/design/handoff/PRD-031' });
  await eventually(async () => {
    const events = await today(env.store, 'events');
    assert.ok(events.some((e) => e.type === 'design.story_handed_off' && e.payload.storyId === 'STORY-031-1'));
  });
});

test('the design is a readable file in the Factory\'s folder, and the lists say each part in words', async () => {
  const file = await fs.readFile(path.join(env.dataDir, 'factory', 'design', 'items', 'PRD-031', 'design.md'), 'utf8');
  assert.match(file, /^## Business requirements$/m);
  assert.match(file, /STORY-031-1 \(FEAT-031-1\)/);
  const { items } = (await naledi.json(`${design}/items`)).body;
  const row = items.find((i) => i.itemId === 'PRD-031');
  assert.equal(row.parts.handoff, '1 of 3 stories handed off');
  assert.ok(items.some((i) => i.itemId === 'PRD-027'), 'items in Design with no design yet are listed too');
});

test('homes: the Solution Architect sees the stories still to hand off; the Functional Analyst the interfaces and stories to finish', async () => {
  const role = (id, workRole) => env.store.updateDoc(['people', id, 'profile.md'], (doc) => ({ ...doc, data: { ...doc.data, workRole } }));
  await role('thabo-n', 'solution-architect');
  const sa = (await thabo.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(sa.layout, 'solution-architect');
  assert.match(sa.summary, /items? (is|are) in Design\. Two stories are ready for your Design handoff\./);
  // PRD-025, PRD-027, PRD-028 and PRD-031 are in Design; ADR-015 waits on Thabo.
  assert.deepEqual(sa.tiles.map((t) => [t.key, t.value]), [['in-design', 4], ['decisions', 1], ['ready', 2], ['handed-off', 1]]);
  const handoffs = sa.panels.lists.find((l) => l.key === 'handoffs');
  assert.deepEqual(handoffs.rows.map((r) => r.id), ['STORY-031-2', 'STORY-031-4']);
  assert.equal(handoffs.rows[0].action.href, '/factory/design/handoff/PRD-031');

  await role('priya-s', 'functional-analyst');
  await post(priya, `${design}/items/PRD-031/interfaces`, { name: 'Planner → Slot API', kind: 'api', to: 'Slot API' });
  const fa = (await priya.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(fa.layout, 'functional-analyst');
  assert.equal(fa.summary, 'One interface has a side missing, which holds the Design handoff.');
  const oneSided = fa.panels.lists.find((l) => l.key === 'interfaces');
  assert.match(oneSided.rows[0].text, /no "from" side → Slot API/);
  assert.ok(fa.panels.lists.find((l) => l.key === 'stories').rows.every((r) => /no acceptance criteria|no business requirement/.test(r.text)));
  assert.equal((await priya.get('/js/pages/home/for-you-design.js')).status, 200);
});
