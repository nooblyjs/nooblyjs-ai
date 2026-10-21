// Phase 16d: the Test section on its own, on the Factory's stand-in host, with stand-ins for the lifecycle (the story in
// Engineer) and Design (its criteria, interfaces, NFRs and feature). The test agent drafts a case per criterion at the
// policy's level, a contract test per interface, an E2E test for the journey and a check by hand for accessibility; a
// person marks cases ready (an agent never); the sign-off's facts and a work item's cases come from it. The steps run
// in order on one data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { register, NAV } from '../index.js';
import { draftAnalysis, levelFor, readCriterion } from '../src/services/drafts.js';
import { createHost, createTestServerManager, PEOPLE } from '../../test/fixtures/host.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const KIT = pathToFileURL(require.resolve('nooblyjs-core/public/ui/js/html.js')).href.replace(/html\.js$/, '');
registerHooks({ resolve: (specifier, context, next) => (specifier.startsWith('/ui/js/') ? { url: KIT + specifier.slice(7), shortCircuit: true } : next(specifier, context)) });

const CRITERIA = [
  'Given two customers pick the last slot, when both confirm, then exactly one hold succeeds and the other sees the next slot',
  'Given a manager releases capacity, when the change saves, then the capacity is stored within 30 seconds',
];
const DESIGN = {
  stories: [{ id: 'STORY-031-1', title: 'See which stores still have same-day capacity', feature: 'FEAT-031-1', systems: ['web-storefront', 'slots-api'], criteria: CRITERIA, interfaces: ['IF-031-01'], nfrs: ['NFR-031-01', 'NFR-031-02'] }],
  features: [{ id: 'FEAT-031-1', title: 'See which stores still have same-day capacity' }],
  interfaces: [{ id: 'IF-031-01', name: 'web-storefront → slots-api', from: 'web-storefront', to: 'slots-api', contract: 'GET /slots' }, { id: 'IF-031-02', name: 'other', from: 'a', to: 'b', contract: 'x' }],
  nfrs: [{ id: 'NFR-031-01', category: 'accessibility', requirement: 'Every screen meets WCAG 2.2 AA', target: 'No axe violations' }, { id: 'NFR-031-02', category: 'cost', requirement: 'Within budget', target: '$600' }],
};

let env;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-quality-'));
  const stand = createHost({ people: [...PEOPLE, { id: 'rhea-voss', name: 'Rhea Voss', accessRole: 'Owner', kind: 'agent' }] });
  const items = new Map([['STORY-031-1', { id: 'STORY-031-1', ref: 'STORY-031-1', type: 'story', title: 'See which stores still have same-day capacity', stage: 'engineer', status: 'active', parentId: 'PRD-031' }]]);
  const services = {
    workflows: { item: async ({ itemId }) => items.get(itemId) ?? null, items: async ({ stage } = {}) => [...items.values()].filter((i) => !stage || i.stage === stage) },
    design: { designFor: async () => DESIGN },
  };
  const host = { ...stand.host, store: new FsStore(dataDir), service: (name) => services[name] };
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { mountPath: '/quality', dataDir, host });
  await hosted.seed({ content: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/quality/api/v1`;
  const call = async (as, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'x-dev-person': as, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  env = { dataDir, stand, items, hosted, call, close: async () => { await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }); } };
});
after(async () => { await env?.close(); });

test('the policy\'s levels, a criterion\'s given/when/then, and the scripted draft', () => {
  const policy = { criteria: [{ when: '\\b(sees?|customer)\\b', level: 'e2e', automate: true }, { level: 'integration', automate: true }], nfrs: { accessibility: { level: 'manual', automate: false, title: 'by hand' } } };
  assert.deepEqual(levelFor(policy, CRITERIA[0]), { level: 'e2e', automate: true });
  assert.deepEqual(levelFor(policy, CRITERIA[1]), { level: 'integration', automate: true });
  assert.deepEqual(readCriterion(CRITERIA[1]), { given: 'a manager releases capacity', when: 'the change saves', then: 'the capacity is stored within 30 seconds' });
  const { cases } = draftAnalysis({ story: { title: 't', criteria: CRITERIA, systems: ['web-storefront'], featureTitle: 'Feature' }, interfaces: [DESIGN.interfaces[0]], nfrs: DESIGN.nfrs, policy });
  assert.deepEqual(cases.map((c) => c.level), ['e2e', 'integration', 'contract', 'e2e', 'manual']);
  assert.deepEqual(cases[2].systems, ['web-storefront'], 'a contract test runs against the sides that are the story\'s systems');
  assert.equal(NAV[0].factoryGroup, 'Engineering');
});

test('the test agent drafts the cases: one per criterion, a contract test per interface, the journey, a check by hand', async () => {
  assert.equal((await env.call('naledi-k', 'POST', '/stories/STORY-031-1/draft')).status, 403);
  const { status, body } = await env.call('priya-s', 'POST', '/stories/STORY-031-1/draft');
  assert.equal(status, 200);
  assert.deepEqual(body.cases.map((c) => [c.id, c.level, c.automate]), [
    ['TC-031-1-1', 'e2e', true], ['TC-031-1-2', 'integration', true], ['TC-031-1-3', 'contract', true], ['TC-031-1-4', 'e2e', true], ['TC-031-1-5', 'manual', false],
  ]);
  assert.ok(body.cases.every((c) => c.status === 'draft' && c.draftedBy.id === 'ada-quill'));
  assert.equal(body.summary.text, '0 of 2 criteria have a ready test case');
  assert.deepEqual(body.interfaces.map((i) => [i.id, i.cases]), [['IF-031-01', ['TC-031-1-3']]], 'only the story\'s interfaces');
  // A second draft adds nothing it already has.
  assert.equal((await env.call('priya-s', 'POST', '/stories/STORY-031-1/draft')).body.cases.length, 5);
  assert.ok(env.stand.eventLog.some((e) => e.type === 'quality.analysis_drafted'));
});

test('a person marks cases ready; an agent is refused and audited; "n of m criteria"; an edit makes it a draft again', async () => {
  const ready = (id, as = 'priya-s') => env.call(as, 'POST', `/stories/STORY-031-1/cases/${id}/ready`);
  const raised = await ready('TC-031-1-1', 'rhea-voss');
  assert.deepEqual([raised.status, raised.body.error.code], [403, 'people_only']);
  assert.ok(env.stand.auditLog.some((r) => r.actor === 'rhea-voss' && /mark a test case ready/.test(r.reason ?? '')));
  assert.equal((await ready('TC-031-1-1')).body.summary.text, '1 of 2 criteria has a ready test case');
  await ready('TC-031-1-3');
  let facts = (await env.hosted.services.readinessFacts('STORY-031-1')).facts;
  assert.equal(facts['criteria-ready'].value, false);
  assert.match(facts['criteria-ready'].detail, /^"Given a manager releases capacity, when the change saves, then the capacity is …" has no ready test case$/, 'it names the criterion');
  assert.deepEqual(facts['interfaces-tested'], { value: true });
  await ready('TC-031-1-2');
  facts = (await env.hosted.services.readinessFacts('STORY-031-1')).facts;
  assert.deepEqual(facts['criteria-ready'], { value: true });
  const edited = await env.call('priya-s', 'PATCH', '/stories/STORY-031-1/cases/TC-031-1-2', { then: 'the capacity is stored within 10 seconds' });
  assert.equal(edited.body.cases.find((c) => c.id === 'TC-031-1-2').status, 'draft');
  assert.equal(edited.body.summary.text, '1 of 2 criteria has a ready test case');
});

test('add and remove a case; ids are never given out again; bad input is refused', async () => {
  const added = await env.call('priya-s', 'POST', '/stories/STORY-031-1/cases', { title: 'A store with no slots is hidden', given: 'a store has no slots', when: 'the list loads', then: 'it is not listed', level: 'unit', criterion: 0 });
  assert.deepEqual([added.status, added.body.caseId], [201, 'TC-031-1-6']);
  assert.ok(added.body.criteria[0].cases.includes('TC-031-1-6'));
  await env.call('priya-s', 'DELETE', '/stories/STORY-031-1/cases/TC-031-1-6');
  const again = (await env.call('priya-s', 'POST', '/stories/STORY-031-1/cases', { title: 'Again', level: 'unit' })).body;
  assert.equal(again.caseId, 'TC-031-1-7');
  assert.deepEqual(again.cases.find((c) => c.id === 'TC-031-1-7').systems, ['web-storefront', 'slots-api'], 'no systems named: the story\'s');
  assert.equal((await env.call('priya-s', 'POST', '/stories/STORY-031-1/cases', { title: 'x', level: 'smoke' })).status, 400);
  assert.equal((await env.call('priya-s', 'PATCH', '/stories/STORY-031-1/cases/TC-031-1-99', { title: 'x' })).status, 404);
});

test('a work item carries the cases that run against its system; outside Engineer the analysis is read only', async () => {
  const cases = await env.hosted.services.casesFor('STORY-031-1', 'acme/slots-api');
  assert.ok(cases.length >= 2 && cases.every((c) => c.systems.includes('slots-api')));
  assert.equal((await env.hosted.services.casesFor('STORY-031-1', 'mobile-app')).length, 0);
  assert.deepEqual((await env.hosted.status()).card.pill.text, '1 of 2 criteria ready across 1 story');
  env.items.get('STORY-031-1').stage = 'build';
  const shut = await env.call('priya-s', 'POST', '/stories/STORY-031-1/draft');
  assert.deepEqual([shut.status, shut.body.error.code], [409, 'wrong_stage']);
  assert.equal((await env.call('naledi-k', 'GET', '/stories/STORY-031-1')).body.writable, false);
  env.items.get('STORY-031-1').stage = 'engineer';
  assert.equal(await env.hosted.services.readinessFacts('PRD-031'), null, 'not a story: no Engineering test checks');
});

test('the page draws a story\'s criteria and cases, and the list, from the API\'s answers', async () => {
  const view = () => ({ innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const ctx = { app: { mountPath: '/factory/quality' }, person: { id: 'priya-s', accessRole: 'Contributor' }, signal: new AbortController().signal, isCurrent: () => true, can: (p) => ['read', 'draft'].includes(p), api: { get: async (p) => (await env.call('priya-s', 'GET', `/${p}`)).body } };
  const { render } = await import('../../public/quality/js/pages/analysis.js');
  const v = view();
  await render(v, { params: { id: 'STORY-031-1' }, route: { meta: { view: 'story' } }, ctx });
  for (const words of ['Test analysis: See which stores still have same-day capacity', 'TC-031-1-5', 'By a person', 'Mark ready', 'Add the test case', 'Has a ready test case', 'IF-031-01']) assert.ok(v.innerHTML.includes(words), words);
  const l = view();
  await render(l, { params: {}, route: { meta: { view: 'list' } }, ctx });
  assert.ok(l.innerHTML.includes('STORY-031-1 · See which stores still have same-day capacity'));
});
