// CHG-008: a fresh seed fills the Factory's pages. PRD-027's design (every part of it) and its three stories, one of them
// in Engineer; that story's application architecture and test analysis; the pull requests with their approvals; and the
// test runs, coverage and defects. The lifecycle's parts are live; the rest is the seed story's sample, and says so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let env;
let thabo;
before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }] });
  thabo = env.client();
  await thabo.signIn('thabo-n');
});
after(async () => { await env?.stop(); });

test('Design: PRD-027 has every part, its stories are items, and the handoff checks name what holds the other two', async () => {
  const d = (await thabo.json('/factory/design/api/v1/items/PRD-027')).body;
  assert.deepEqual(d.parts, {
    requirements: '6 business requirements · 5 accepted',
    solution: '4 impacted systems · 7 NFRs · 3 features',
    functional: '5 interfaces (1 with a side missing) · 4 technical requirements',
    stories: '3 stories · 1 handed off',
    handoff: '1 of 3 stories handed off',
  });
  assert.deepEqual(d.stories.map((s) => [s.id, s.stageLabel]), [['STORY-027-1', 'Engineer'], ['STORY-027-2', 'Design'], ['STORY-027-3', 'Design']]);
  assert.deepEqual(d.readiness.checks.filter((c) => !c.passed).map((c) => c.key), ['decisions-decided', 'interfaces-complete']);
  assert.match(d.readiness.checks.find((c) => c.key === 'decisions-decided').text, /ADR-015 is still proposed/);
  assert.deepEqual(d.features.map((f) => f.dependsOn), [[], ['FEAT-027-1'], ['FEAT-027-2']]);
  // The spec it quotes, and its times moved to the seed's "now".
  const spec = JSON.stringify((await thabo.json('/factory/product/api/v1/specs/PRD-027')).body);
  for (const r of d.requirements) assert.ok(spec.includes(JSON.stringify(r.source.quote).slice(1, -1)), r.id);
  assert.ok(new Date(d.drafts.at(-1).at) < new Date(env.noobly.clock.now()) && new Date(d.drafts.at(-1).at) > new Date(env.noobly.clock.now() - 3 * 86_400_000), 'drafted in the last few days');
  const story = (await thabo.json('/workflows/api/v1/items/STORY-027-1')).body;
  assert.equal(story.item.stage, 'engineer');
  assert.ok(story.approvals.some((a) => a.type === 'design-handoff' && a.status === 'approved'));
  assert.equal((await thabo.json('/workflows/api/v1/items/PRD-027')).body.item.stories.text, '1 of 3 stories handed off');
});

test('Engineering: STORY-027-1 with its sample architecture and test analysis, and what its sign-off still needs', async () => {
  const { stories } = (await thabo.json('/factory/api/v1/engineering')).body;
  assert.deepEqual(stories.map((s) => [s.id, s.architecture.text, s.testAnalysis.text, s.signOff.ready]), [['STORY-027-1', '1 of 2 systems accepted', '1 of 2 criteria has a ready test case', false]]);
  const arch = (await thabo.json('/factory/api/v1/engineering/architecture/STORY-027-1')).body;
  assert.deepEqual(arch.systems.map((s) => s.name), ['web-storefront', 'delivery-planner']);
  assert.ok((await thabo.json('/factory/api/v1/engineering/test-analysis/STORY-027-1')).body.cases.length >= 4);
});

test('Pull requests and Test: approvals from the lifecycle, runs, coverage and defects from the sample', async () => {
  const { pullRequests } = (await thabo.json('/factory/api/v1/pull-requests')).body;
  assert.deepEqual(pullRequests.map((r) => r.ref), ['slots-api #482', 'web-storefront #481', 'web-storefront #476']);
  assert.match(pullRequests[0].build.text, /^Waiting on /);
  const approvals = (await thabo.json('/factory/api/v1/test/approvals')).body;
  assert.deepEqual(approvals.inTest.map((i) => i.ref), ['web-storefront #481']);
  assert.equal(approvals.given.length, 1);
  assert.equal((await thabo.json('/factory/api/v1/test/runs')).body.text, '7 runs · 2 failed · 1 running');
  assert.equal((await thabo.json('/factory/api/v1/test/defects')).body.text, '3 defects · 1 open');
  assert.equal((await thabo.json('/factory/api/v1/test/coverage')).body.stories.length, 1);
});

test('every page of the Design, Engineering, Build and Test groups answers', async () => {
  for (const page of [
    '/factory/design/solution', '/factory/design/solution/PRD-027', '/factory/design/stories/PRD-027',
    '/factory/engineering/architecture', '/factory/engineering/architecture/STORY-027-1', '/factory/engineering/test-analysis/STORY-027-1',
    '/factory/engineering/sign-off', '/factory/pull-requests', '/factory/test/approvals', '/factory/test/runs', '/factory/test/coverage',
    '/factory/test/defects', '/factory/js/pages/engineering.js', '/factory/js/pages/testing.js',
  ]) assert.equal((await thabo.get(page)).status, 200, page);
});
