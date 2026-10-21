// Phase 16c: the Design section on its own, on the Factory's stand-in host, with stand-ins for what it reads from
// other apps: the Product section's design inputs (PRD-031's spec, container view and quality attributes), the
// lifecycle engine (the item, its stories and the story handoff), Platform's repositories and Knowledge. The tests run
// in order on one data folder. The real lifecycle engine is tested with it in ../../../nooblyjs-ai-host/test/design.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { register, NAV } from '../index.js';
import { createHost, createTestServerManager, PEOPLE } from './fixtures/host.js';
import { draftRequirements, draftSolution, readStory, wordsOf } from '../src/services/drafts.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

// The pages import the UI kit as the browser does (/ui/js/…); here that is nooblyjs-core's public/ui/js/.
const KIT = pathToFileURL(require.resolve('nooblyjs-core/public/ui/js/html.js')).href.replace(/html\.js$/, '');
registerHooks({ resolve: (specifier, context, next) => (specifier.startsWith('/ui/js/') ? { url: KIT + specifier.slice(7), shortCircuit: true } : next(specifier, context)) });

const SPEC = {
  problem: 'Customers who shop after work find every same-day slot taken by mid-morning.',
  goals: [
    { measure: 'Same-day slots still open at 12:00', today: '18%', target: '45%' },
    { measure: 'Basket abandonment at slot step', today: '31%', target: '20%' },
    { measure: 'Slot list load time, p95', today: '1.8 s', target: '300 ms' },
  ],
  stories: [
    'As a customer ordering after work, I can see which stores still have same-day capacity so I can pick a slot before I build my basket.',
    'As a customer, I can hold a slot for 15 minutes while I finish checkout so it isn\'t taken from me.',
    'As a store manager, I can release extra evening capacity when pickers come on shift.',
  ],
  acceptanceCriteria: [
    { given: 'a slot is held', when: '15 minutes pass without payment', then: 'the slot returns to the pool within 5 seconds' },
    { given: 'two customers pick the last slot', when: 'both confirm', then: 'exactly one hold succeeds and the other sees the next slot' },
    { given: 'a manager releases capacity', when: 'the change saves', then: 'new slots appear to customers within 30 seconds' },
  ],
};
const INPUTS = {
  itemId: 'PRD-031', title: 'Same-day delivery slots', product: 'Delivery', version: 4,
  repositories: ['acme/web-storefront', 'acme/slots-api', 'acme/stores-service'],
  spec: SPEC,
  containers: [
    { id: 'customerApp', label: 'Customer app' }, { id: 'gateway', label: 'API gateway' }, { id: 'slotApi', label: 'Slot API' },
    { id: 'eventBus', label: 'Event bus' }, { id: 'inventory', label: 'Store inventory' },
  ],
  relations: [
    { from: 'customerApp', to: 'gateway', label: 'HTTPS · JSON', tech: '' },
    { from: 'gateway', to: 'slotApi', label: 'gRPC', tech: '' },
    { from: 'slotApi', to: 'eventBus', label: 'publishes slot.released', tech: '' },
    { from: 'slotApi', to: 'inventory', label: 'SQL · read only', tech: '' },
  ],
  qualityAttributes: [
    { attribute: 'Latency', scenario: 'Slot list at 18:00 peak', target: 'p95 < 300 ms', verifiedBy: 'Load test station' },
    { attribute: 'Consistency', scenario: 'Two holds on the last slot', target: '0 double-books', verifiedBy: 'Contract tests' },
  ],
  adrs: [{ id: 'ADR-013', title: 'Release expired holds through events', status: 'accepted' }, { id: 'ADR-014', title: 'Cache slot availability in Redis', status: 'proposed' }],
};
const REPOSITORIES = [
  { name: 'acme/web-storefront', shortName: 'web-storefront', team: 'checkout-squad', body: 'The customer storefront. Sample.' },
  { name: 'acme/slots-api', shortName: 'slots-api', team: 'delivery-squad', body: 'The Slot API: availability, holds and their release. Sample repository.' },
  { name: 'acme/stores-service', shortName: 'stores-service', team: 'delivery-squad', body: 'Stores, their opening hours and pickers. Sample repository.' },
];

/** A stand-in for the lifecycle engine, as far as Design uses it. */
function lifecycle() {
  const byId = new Map([['PRD-031', { id: 'PRD-031', ref: 'PRD-031', type: 'spec', title: 'Same-day delivery slots', stage: 'design', status: 'active' }]]);
  const calls = [];
  return {
    calls, byId,
    item: async ({ itemId }) => byId.get(itemId) ?? null,
    items: async ({ stage } = {}) => [...byId.values()].filter((i) => !stage || i.stage === stage),
    storiesOf: async ({ itemId }) => [...byId.values()].filter((i) => i.parentId === itemId && i.status !== 'withdrawn'),
    syncStories: async ({ itemId, stories, reason, actor }) => {
      calls.push({ op: 'sync', ids: stories.map((s) => s.id), reason, actor: actor.id });
      for (const s of stories) if (!byId.has(s.id)) byId.set(s.id, { id: s.id, type: 'story', parentId: itemId, title: s.title, stage: 'design', status: 'active' });
      for (const i of byId.values()) if (i.parentId === itemId && i.stage === 'design' && !stories.some((s) => s.id === i.id)) i.status = 'withdrawn';
      return {};
    },
    handoffStory: async ({ storyId, workItems, override, actor }) => {
      calls.push({ op: 'handoff', storyId, workItems, override, actor: actor.id });
      byId.get(storyId).stage = 'engineer';
      return { outcome: 'approved', item: byId.get(storyId), text: `Approved. ${storyId} moved to Engineer.` };
    },
  };
}

let env;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-design-'));
  // An agent whose access role is wrongly raised: the section must still refuse it every acceptance and handoff.
  const stand = createHost({ people: [...PEOPLE, { id: 'rhea-voss', name: 'Rhea Voss', accessRole: 'Owner', kind: 'agent' }] });
  const workflows = lifecycle();
  const services = {
    workflows,
    product: { designInputs: async (itemId) => (itemId === 'PRD-031' ? structuredClone(INPUTS) : null) },
    platform: { repositories: { list: async () => REPOSITORIES } },
    knowledge: { find: async (q) => ({ files: [{ title: `${q} runbook`, href: `/wiki/${q}` }], folders: [] }) },
  };
  const host = { ...stand.host, store: new FsStore(dataDir), service: (name) => services[name] };
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { mountPath: '/design', dataDir, host });
  await hosted.seed({});
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/design/api/v1`;
  const call = async (as, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'x-dev-person': as, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  env = { dataDir, stand, workflows, hosted, call, close: async () => { await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }); } };
});
after(async () => { await env?.close(); });

test('the app has the Design rows, the NFR catalogue, and the items in Design', async () => {
  // Architecture first: the Product app's pages, shown here (CHG-009).
  assert.deepEqual(NAV.map((n) => n.label), ['Architecture', 'Business requirements', 'Solution architecture', 'Functional analysis', 'Stories', 'Handoff to the Factory']);
  const catalogue = (await env.call('stevie', 'GET', '/catalogue')).body;
  assert.deepEqual(catalogue.categories.map((c) => c.key), ['performance', 'availability', 'security', 'privacy', 'accessibility', 'cost', 'operability']);
  const { items } = (await env.call('naledi-k', 'GET', '/items')).body;
  assert.deepEqual(items.map((i) => [i.itemId, i.parts.requirements, i.started]), [['PRD-031', 'No business requirements yet', false]]);
  assert.equal(await env.hosted.services.readinessFacts('PRD-031'), null, 'no Design work yet, so no Design checks');
});

test('the scripted drafts read the spec: a user story\'s parts, its words', () => {
  assert.deepEqual(readStory(SPEC.stories[2]), { role: 'store manager', want: 'release extra evening capacity when pickers come on shift', why: null });
  assert.ok(wordsOf('Slots held for 15 minutes').has('slot'));
  const { requirements } = draftRequirements(INPUTS);
  assert.equal(requirements.length, 6);
  assert.equal(requirements[0].text, 'Same-day slots still open at 12:00 goes from 18% to 45%.');
  assert.equal(requirements[4].text, 'A customer can hold a slot for 15 minutes while they finish checkout, so it isn\'t taken from them.');
  const solution = draftSolution({ ...INPUTS, repositories: ['acme/slots-api', 'acme/new-thing'] }, { repositories: REPOSITORIES });
  assert.deepEqual(solution.systems.map((s) => [s.name, s.change, s.team]), [['slots-api', 'changed', 'delivery-squad'], ['new-thing', 'new', null]]);
});

test('business requirements: drafted by the analyst agent, each quoting the spec; a Viewer can\'t ask', async () => {
  assert.equal((await env.call('naledi-k', 'POST', '/items/PRD-031/draft/requirements')).status, 403);
  const { status, body } = await env.call('priya-s', 'POST', '/items/PRD-031/draft/requirements');
  assert.equal(status, 200);
  assert.deepEqual(body.requirements.map((r) => r.id), ['BR-031-01', 'BR-031-02', 'BR-031-03', 'BR-031-04', 'BR-031-05', 'BR-031-06']);
  const quotes = [...SPEC.goals.map((g) => g.measure), ...SPEC.stories];
  assert.ok(body.requirements.every((r, i) => r.source.quote === quotes[i] && r.status === 'proposed' && r.draftedBy.id === 'ada-quill'));
  assert.equal(body.parts.requirements, '6 business requirements · 0 accepted');
  // A second draft adds nothing it already has.
  assert.equal((await env.call('priya-s', 'POST', '/items/PRD-031/draft/requirements')).body.requirements.length, 6);
  assert.ok(env.stand.eventLog.some((e) => e.type === 'design.requirements_drafted' && e.payload.itemId === 'PRD-031'));
  assert.ok(env.stand.eventLog.some((e) => e.type === 'agent.action' && e.payload.action === 'design.requirements' && e.payload.teammateId === 'ada-quill'));
});

test('a person with accept-requirement accepts one; a Contributor can\'t, an agent is refused and audited; an edit makes it proposed again', async () => {
  assert.equal((await env.call('priya-s', 'POST', '/items/PRD-031/requirements/BR-031-01/accept')).status, 403);
  const byAgent = await env.call('ada-quill', 'POST', '/items/PRD-031/requirements/BR-031-01/accept');
  assert.equal(byAgent.status, 403, 'the matrix refuses a Contributor agent first');
  const ok = await env.call('lerato-m', 'POST', '/items/PRD-031/requirements/BR-031-01/accept');
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.requirements[0].status, ok.body.requirements[0].acceptedBy.id], ['accepted', 'lerato-m']);
  const raised = await env.call('rhea-voss', 'POST', '/items/PRD-031/requirements/BR-031-02/accept');
  assert.deepEqual([raised.status, raised.body.error.code], [403, 'people_only'], 'an agent never accepts, whatever its role');
  assert.ok(env.stand.auditLog.some((r) => r.actor === 'rhea-voss' && r.action === 'access.refused' && /accept a business requirement/.test(r.reason)));
  const edited = await env.call('priya-s', 'PATCH', '/items/PRD-031/requirements/BR-031-01', { text: 'Same-day slots still open at 12:00 reach 45% by the end of the pilot.' });
  assert.equal(edited.body.requirements[0].status, 'proposed');
  await env.call('lerato-m', 'POST', '/items/PRD-031/requirements/BR-031-01/accept');
  assert.ok(env.stand.auditLog.some((r) => r.actor === 'ada-quill' && r.action === 'access.refused'));
});

test('solution architecture: impacted systems with their owners and Knowledge, NFRs from the qualities and the catalogue, one feature per user story', async () => {
  const { body } = await env.call('stevie', 'POST', '/items/PRD-031/draft/solution');
  assert.deepEqual(body.systems.map((s) => [s.name, s.change, s.team]), [['web-storefront', 'changed', 'checkout-squad'], ['slots-api', 'changed', 'delivery-squad'], ['stores-service', 'changed', 'delivery-squad']]);
  assert.deepEqual(body.systems[1].knowledge, [{ title: 'slots-api runbook', href: '/wiki/slots-api' }]);
  assert.deepEqual(body.nfrs.map((n) => n.category), ['performance', 'availability', 'security', 'privacy', 'accessibility', 'cost', 'operability']);
  assert.equal(body.nfrs[0].target, 'p95 < 300 ms');
  assert.equal(body.nfrs[2].source.kind, 'catalogue');
  assert.deepEqual(body.features.map((f) => f.id), ['FEAT-031-1', 'FEAT-031-2', 'FEAT-031-3']);
  assert.equal(body.features[1].title, 'Hold a slot for 15 minutes while I finish checkout');
  // A person sets a system's change and owner.
  const set = await env.call('priya-s', 'PUT', '/items/PRD-031/systems', { systems: body.systems.map((s) => ({ name: s.name, repo: s.repo, change: s.name === 'stores-service' ? 'changed' : s.change, team: s.team })) });
  assert.equal(set.status, 200);
  assert.equal((await env.call('priya-s', 'PUT', '/items/PRD-031/systems', { systems: [{ name: 'x', change: 'gone' }] })).status, 400);
});

test('functional analysis: one interface per relation of the container view, and a technical requirement per system', async () => {
  const { body } = await env.call('priya-s', 'POST', '/items/PRD-031/draft/functional');
  assert.deepEqual(body.interfaces.map((i) => [i.id, i.from, i.to, i.kind]), [
    ['IF-031-01', 'Customer app', 'API gateway', 'api'], ['IF-031-02', 'API gateway', 'Slot API', 'api'],
    ['IF-031-03', 'Slot API', 'Event bus', 'event'], ['IF-031-04', 'Slot API', 'Store inventory', 'api'],
  ]);
  assert.deepEqual(body.technical.map((t) => t.system), ['web-storefront', 'slots-api', 'stores-service']);
});

test('an interface with one side fails Design\'s check, naming it; naming the other side passes it', async () => {
  const added = await env.call('priya-s', 'POST', '/items/PRD-031/interfaces', { name: 'Slot API → stores-service', kind: 'api', from: 'Slot API', contract: 'GET /stores/:id/pickers' });
  assert.equal(added.status, 201);
  assert.equal(added.body.interfaceId, 'IF-031-05');
  let facts = (await env.hosted.services.readinessFacts('PRD-031')).facts;
  assert.deepEqual(facts['interfaces-complete'], { value: false, detail: 'IF-031-05 has no "to" side' });
  assert.match(facts['decisions-decided'].detail, /ADR-014 is still proposed/);
  assert.deepEqual(facts['requirements-covered'], { value: false, detail: 'BR-031-01, BR-031-02, BR-031-03, BR-031-04, BR-031-05, BR-031-06 have no story' });
  await env.call('priya-s', 'PATCH', '/items/PRD-031/interfaces/IF-031-05', { to: 'stores-service' });
  facts = (await env.hosted.services.readinessFacts('PRD-031')).facts;
  assert.deepEqual(facts['interfaces-complete'], { value: true });
});

test('stories: three, one per feature, each tracing to business requirements and its feature; they become lifecycle items', async () => {
  const { body } = await env.call('priya-s', 'POST', '/items/PRD-031/draft/stories');
  assert.deepEqual(body.stories.map((s) => [s.id, s.feature]), [['STORY-031-1', 'FEAT-031-1'], ['STORY-031-2', 'FEAT-031-2'], ['STORY-031-3', 'FEAT-031-3']]);
  assert.ok(body.stories.every((s) => s.requirements.length && s.systems.length === 3 && s.nfrs.length === 7));
  assert.ok(body.stories[0].requirements.includes('BR-031-04'), 'the story drawn from the first user story traces to its requirement');
  const covered = new Set(body.stories.flatMap((s) => s.requirements));
  assert.equal(covered.size, 6, 'every business requirement is covered');
  assert.equal(body.stories.flatMap((s) => s.criteria).length, 3, 'each criterion goes to one story');
  assert.deepEqual(env.workflows.calls.at(-1), { op: 'sync', ids: ['STORY-031-1', 'STORY-031-2', 'STORY-031-3'], reason: null, actor: 'priya-s' });
  assert.equal((await env.hosted.services.readinessFacts('PRD-031')).facts['requirements-covered'].value, true);
});

test('the feature landscape: a person names what a feature depends on; itself, an unknown feature and a loop are refused', async () => {
  const set = (id, body) => env.call('priya-s', 'PATCH', `/items/PRD-031/features/${id}`, body);
  const ok = await set('FEAT-031-2', { dependsOn: ['FEAT-031-1'] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.features[1].dependsOn, ['FEAT-031-1']);
  assert.equal((await set('FEAT-031-3', { dependsOn: ['FEAT-031-2'] })).status, 200);
  assert.match((await set('FEAT-031-1', { dependsOn: ['FEAT-031-3'] })).body.error.message, /FEAT-031-1 can't depend on FEAT-031-3: FEAT-031-3 already depends on FEAT-031-1/);
  assert.equal((await set('FEAT-031-1', { dependsOn: ['FEAT-031-1'] })).status, 400);
  assert.equal((await set('FEAT-031-1', { dependsOn: ['FEAT-031-9'] })).status, 400);
  assert.equal((await env.call('naledi-k', 'PATCH', '/items/PRD-031/features/FEAT-031-1', { dependsOn: [] })).status, 403);
  assert.ok(env.stand.eventLog.some((e) => e.type === 'design.features_changed' && e.payload.featureId === 'FEAT-031-2'));
});

test('merge two stories, split one: ids are never given out again, and the lifecycle is told why', async () => {
  const merged = await env.call('priya-s', 'POST', '/items/PRD-031/stories/merge', { ids: ['STORY-031-2', 'STORY-031-3'] });
  assert.equal(merged.status, 200);
  assert.deepEqual(merged.body.stories.map((s) => s.id), ['STORY-031-1', 'STORY-031-2']);
  assert.deepEqual(merged.body.stories[1].mergedFrom, ['STORY-031-3']);
  assert.equal(env.workflows.calls.at(-1).reason, 'merged into STORY-031-2');
  assert.equal(env.workflows.byId.get('STORY-031-3').status, 'withdrawn');
  const split = await env.call('priya-s', 'POST', '/items/PRD-031/stories/STORY-031-2/split', { parts: [{ title: 'Hold a slot while paying' }, { title: 'Release evening capacity' }] });
  assert.equal(split.status, 200);
  assert.deepEqual(split.body.made, ['STORY-031-4']);
  assert.deepEqual(split.body.stories.map((s) => [s.id, s.title]), [['STORY-031-1', 'See which stores still have same-day capacity'], ['STORY-031-2', 'Hold a slot while paying'], ['STORY-031-4', 'Release evening capacity']]);
  assert.equal(split.body.stories[2].splitFrom, 'STORY-031-2');
  assert.equal((await env.call('priya-s', 'POST', '/items/PRD-031/stories/merge', { ids: ['STORY-031-1'] })).status, 400);
  assert.equal((await env.call('naledi-k', 'POST', '/items/PRD-031/stories/merge', { ids: ['STORY-031-1', 'STORY-031-2'] })).status, 403);
});

test('a story\'s handoff goes to the lifecycle engine with one work item per system; an agent is refused; a handed-off story no longer changes', async () => {
  const byAgent = await env.call('ada-quill', 'POST', '/items/PRD-031/stories/STORY-031-1/handoff', {});
  assert.equal(byAgent.status, 403);
  assert.equal(byAgent.body.error.code, 'people_only');
  const { status, body } = await env.call('stevie', 'POST', '/items/PRD-031/stories/STORY-031-1/handoff', { override: { reason: 'ADR-014 is decided this week' } });
  assert.equal(status, 200);
  assert.equal(body.text, 'Approved. STORY-031-1 moved to Engineer.');
  const call = env.workflows.calls.at(-1);
  assert.deepEqual([call.storyId, call.workItems.map((w) => w.repo), call.override], ['STORY-031-1', ['web-storefront', 'slots-api', 'stores-service'], { reason: 'ADR-014 is decided this week' }]);
  assert.equal(body.design.parts.handoff, '1 of 3 stories handed off');
  assert.equal((await env.call('priya-s', 'PATCH', '/items/PRD-031/stories/STORY-031-1', { title: 'x' })).status, 409);
  const status2 = await env.hosted.status();
  assert.equal(status2.card.pill.text, '1 item in Design · 1 story handed off');
});

test('NooblyJS Phase 20: one criterion of a handed-off story changes, with a reason; an agent is refused', async () => {
  const url = '/items/PRD-031/stories/STORY-031-1/criteria/1';
  assert.equal((await env.call('ada-quill', 'PATCH', url, { text: 'x', reason: 'y' })).status, 403);
  assert.equal((await env.call('priya-s', 'PATCH', url, { text: 'Given a slot, when I look, then I see it' })).status, 400, 'a reason is needed');
  assert.equal((await env.call('priya-s', 'PATCH', '/items/PRD-031/stories/STORY-031-1/criteria/9', { text: 'x', reason: 'y' })).status, 404);
  const { status, body } = await env.call('priya-s', 'PATCH', url, { text: 'Given a slot, when I look, then I see it within 2 seconds', reason: 'The pilot asked for it' });
  assert.equal(status, 200);
  const story = body.stories.find((s) => s.id === 'STORY-031-1');
  assert.equal(story.criteria[0], 'Given a slot, when I look, then I see it within 2 seconds');
  const e = env.stand.eventLog.find((x) => x.type === 'design.criterion_changed');
  assert.deepEqual([e.payload.storyId, e.payload.index, e.payload.ref, e.payload.reason], ['STORY-031-1', 0, 'AC-031-1-1', 'The pilot asked for it']);
});

test('outside Design the design is read only, and an item with no spec has nothing to design from', async () => {
  env.workflows.byId.set('PRD-099', { id: 'PRD-099', ref: 'PRD-099', type: 'spec', title: 'No spec', stage: 'design', status: 'active' });
  const none = await env.call('priya-s', 'POST', '/items/PRD-099/draft/requirements');
  assert.deepEqual([none.status, none.body.error.code], [409, 'no_spec']);
  env.workflows.byId.get('PRD-031').stage = 'engineer';
  const shut = await env.call('priya-s', 'POST', '/items/PRD-031/interfaces', { name: 'late' });
  assert.deepEqual([shut.status, shut.body.error.code], [409, 'wrong_stage']);
  assert.equal((await env.call('naledi-k', 'GET', '/items/PRD-031')).body.writable, false);
  env.workflows.byId.get('PRD-031').stage = 'design';
  // The file is readable by a person.
  const text = fs.readFileSync(path.join(env.dataDir, 'items', 'PRD-031', 'design.md'), 'utf8');
  assert.match(text, /## Stories\n\n- STORY-031-1 \(FEAT-031-1\): See which stores still have same-day capacity/);
});

test('the pages draw every part of the design, and the list, from the API\'s answers', async () => {
  const view = () => ({ innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const ctx = (as, accessRole) => ({
    app: { mountPath: '/design' }, person: { id: as, accessRole }, signal: new AbortController().signal, isCurrent: () => true,
    can: (permission) => ({ Contributor: ['read', 'draft'], Approver: ['read', 'draft', 'accept-requirement'], Viewer: ['read'] })[accessRole].includes(permission),
    api: { get: async (p) => (await env.call(as, 'GET', `/${p}`)).body },
  });
  const item = await import('../public/js/pages/item.js');
  const expect = {
    requirements: ['BR-031-06', 'Accepted', 'Same-day slots still open at 12:00'],
    solution: ['web-storefront', 'delivery-squad', 'NFR-031-07', 'FEAT-031-3', 'value="FEAT-031-1"', 'No threat model: the Security app is not running here'],
    functional: ['IF-031-05', 'Both named', 'Add the interface'],
    stories: ['STORY-031-4', 'Release evening capacity', 'In Engineer', 'Merge the picked stories'],
    handoff: ['1 of 3 stories handed off', 'Hand off STORY-031-2 to Engineering', 'Override the failing checks'],
  };
  for (const [part, words] of Object.entries(expect)) {
    const v = view();
    await item.render(v, { params: { id: 'PRD-031' }, route: { meta: { part } }, ctx: ctx('lerato-m', 'Approver') });
    for (const w of words) assert.ok(v.innerHTML.includes(w), `${part} says "${w}"`);
    assert.ok(v.innerHTML.includes('aria-current="page"'), `${part} marks its tab`);
  }
  // A Viewer reads it all and is offered nothing to change.
  const viewer = view();
  await item.render(viewer, { params: { id: 'PRD-031' }, route: { meta: { part: 'stories' } }, ctx: ctx('naledi-k', 'Viewer') });
  assert.ok(!viewer.innerHTML.includes('Merge the picked stories') && !viewer.innerHTML.includes('Ask '));
  const list = await import('../public/js/pages/list.js');
  const l = view();
  await list.render(l, { route: { meta: { part: 'handoff' } }, ctx: ctx('naledi-k', 'Viewer') });
  assert.ok(l.innerHTML.includes('PRD-031 · Same-day delivery slots') && l.innerHTML.includes('1 of 3 stories handed off'));
});
