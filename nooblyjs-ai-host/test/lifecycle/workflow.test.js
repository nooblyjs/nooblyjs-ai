// Phase 27a: the lifecycle from one file (root design.md §13, roadmap Phase 27). data/workflows/lifecycle.yaml says the
// stages in order, how each is left and what it checks; approval-rules.yaml who approves what; readiness.yaml how long is
// too long. They are read on every use and checked whenever they change: a file that fails is refused, the last good
// version keeps running, and the reason is on record. A change that applies is `workflow.changed`. These tests write
// their own items: they don't need the PRD-031 story.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { STAGES } from '../../src/lifecycle/stages.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

const NOW = '2026-10-26T09:00:00.000Z';
const AGENT = { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' };
const person = (id) => ({ id });
const dirs = [];
const SEEDED = yaml.load(await fs.readFile(new URL('../../src/lifecycle/seed/data/lifecycle.yaml', import.meta.url), 'utf8'));

async function start({ services = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-workflow-'));
  dirs.push(dir);
  const stand = createHost({ dataDir: dir, now: NOW, services });
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed({ content: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/workflows/api/v1`;
  const call = async (who, method, url, body) => {
    const res = await fetch(`${base}${url}`, { method, headers: { [PERSON_HEADER]: who, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const store = stand.host.store;
  const put = (id, stage, extra = {}) => store.writeDoc(['items', `${id}.md`], {
    id, type: 'spec', ref: id, title: `Item ${id}`, system: 'product', stage, status: 'active', owner: 'lerato-m', team: null,
    createdAt: '2026-10-01T09:00:00.000Z', stageEnteredAt: '2026-10-20T09:00:00.000Z', history: [{ stage, enteredAt: '2026-10-20T09:00:00.000Z', by: 'lerato-m' }], version: 1,
    ...extra,
  }, '');
  const item = async (id) => (await store.readDoc(['items', `${id}.md`])).data;
  const lifecycle = (doc) => store.writeText(['lifecycle.yaml'], yaml.dump(doc, { lineWidth: 200 }));
  const events = (type) => stand.eventLog.filter((e) => e.type === type);
  const stop = async () => {
    await hosted.close();
    await new Promise((resolve) => server.close(resolve));
  };
  return { dir, stand, store, hosted, s: hosted.services, call, put, item, lifecycle, events, stop };
}

after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

/** The seeded lifecycle with a Security review stage between Test and Release. */
function withSecurityReview() {
  const doc = structuredClone(SEEDED);
  const at = doc.stages.findIndex((s) => s.key === 'test');
  doc.stages.splice(at + 1, 0, { key: 'security-review', label: 'Security review', exit: 'security-signoff', checks: [] });
  return doc;
}
const SECURITY_RULE = {
  key: 'security-signoff', decision: 'Security review → Release', approver: 'Architect', permission: 'accept-threat-model', quorum: 'any',
  target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Remind', remind: true, needsReadiness: true,
  tag: 'Security', label: 'Security sign-off', transition: 'Sign off security',
};
async function addRule(env, rule) {
  const doc = yaml.load(await env.store.readText(['approval-rules.yaml']));
  doc.rules.push(rule);
  await env.store.writeText(['approval-rules.yaml'], yaml.dump(doc, { lineWidth: 200 }));
}

test('step 1: the seeded lifecycle.yaml is today\'s eight stages, each of its own kind, left by its usual gate', async () => {
  const env = await start();
  try {
    const stages = await env.s.stages();
    assert.deepEqual(stages.map((s) => [s.key, s.kind, s.exit.rule, s.exit.to]), [
      ['discover', 'discover', 'idea', 'product'], ['product', 'product', 'spec', 'design'], ['design', 'design', 'design-handoff', 'engineer'],
      ['engineer', 'engineer', 'engineering-signoff', 'build'], ['build', 'build', 'build-approval', 'test'], ['test', 'test', 'test-approval', 'release'],
      ['release', 'release', 'deploy', 'operate'], ['operate', 'operate', 'outcome-review', 'done'],
    ]);
    const view = await env.s.workflow();
    assert.deepEqual(view.files.map((f) => [f.file, f.status]), [['lifecycle.yaml', 'applied'], ['approval-rules.yaml', 'applied'], ['readiness.yaml', 'applied']]);
    assert.deepEqual(view.stages.find((s) => s.key === 'product').checks.map((c) => c.evaluator), [
      'product.problem-evidence', 'product.goals-measurable', 'product.criteria-testable', 'product.dependencies-named',
      'product.performance-targets', 'product.privacy-reviewed', 'product.rollout-plan',
    ]);
    assert.deepEqual(view.stages.find((s) => s.key === 'test').pullRequestChecks.map((c) => c.key), ['required-tests', 'gates-passed']);
    // The version in use is kept in applied/, so a broken file after a restart still has a last good version.
    assert.equal(await env.store.readText(['applied', 'lifecycle.yaml']), await env.store.readText(['lifecycle.yaml']));
  } finally { await env.stop(); }
});

test('step 2: a `when` check added to Product fails until the spec has an Owner section, with no restart', async () => {
  let sections = { problem: 'Customers miss slots', owner: null };
  const env = await start({ services: { product: { specSections: async () => sections } } });
  try {
    await env.s.stages(); // NooblyJS has read the seeded workflow by the time anyone edits it
    await env.put('PRD-031', 'product', { readiness: { results: { 'problem-evidence': true, 'goals-measurable': true, 'criteria-testable': true, 'dependencies-named': true, 'performance-targets': true, 'privacy-reviewed': true, 'rollout-plan': true } } });
    const doc = structuredClone(SEEDED);
    doc.stages.find((s) => s.key === 'product').checks.push({ key: 'owner-named', passed: 'An owner is named', failed: 'No owner is named', when: 'spec.sections.owner != null' });
    await env.lifecycle(doc);
    let page = (await env.call('lerato-m', 'GET', '/items/PRD-031')).body;
    assert.deepEqual([page.readiness.passed, page.readiness.total], [7, 8]);
    assert.deepEqual(page.readiness.failing.map((c) => c.text), ['No owner is named']);
    const refused = await env.call('lerato-m', 'POST', '/items/PRD-031/advance', {});
    assert.deepEqual([refused.status, refused.body.error.code], [422, 'readiness_failed']);
    sections = { ...sections, owner: 'Lerato M.' };
    page = (await env.call('lerato-m', 'GET', '/items/PRD-031')).body;
    assert.deepEqual([page.readiness.passed, page.readiness.total], [8, 8]);
    assert.ok(page.readiness.checks.some((c) => c.key === 'owner-named' && c.passed && c.text === 'An owner is named'));
    // The change is on record in words.
    const changed = env.events('workflow.changed').find((e) => e.payload.file === 'lifecycle.yaml');
    assert.match(changed.payload.summary, /Product checks "An owner is named"/);
    assert.ok(env.stand.auditLog.some((a) => a.action === 'workflow.changed' && a.target === 'lifecycle.yaml'));
  } finally { await env.stop(); }
});

test('step 3: a Security review stage between Test and Release, left by its own rule, by people with its permission', async () => {
  const env = await start({ services: { factory: { runsForItem: async () => [], waitingWork: async () => [] } } });
  try {
    await addRule(env, SECURITY_RULE);
    await env.lifecycle(withSecurityReview());
    assert.deepEqual(STAGES.length, 8, 'nothing changes until the workflow is next read');
    const stages = await env.s.stages();
    assert.deepEqual(stages.map((s) => s.key), ['discover', 'product', 'design', 'engineer', 'build', 'test', 'security-review', 'release', 'operate']);
    assert.deepEqual(stages.find((s) => s.key === 'test').exit, { rule: 'test-approval', to: 'security-review' });

    // An item given its Test approval goes to Security review.
    await env.put('SEC-1', 'test');
    const tested = await env.call('lerato-m', 'POST', '/items/SEC-1/advance', {});
    assert.equal(tested.status, 200);
    assert.equal((await env.item('SEC-1')).stage, 'security-review');
    const page = (await env.call('lerato-m', 'GET', '/items/SEC-1')).body;
    assert.equal(page.item.stageLabel, 'Security review');
    assert.equal(page.actions.advanceLabel, 'Sign off security');
    assert.deepEqual(page.stages.map((s) => s.label).slice(5, 8), ['Test', 'Security review', 'Release']);
    // Thabo (accept-threat-model) signs it off; it goes to Release.
    const signed = await env.call('thabo-n', 'POST', '/items/SEC-1/advance', {});
    assert.equal(signed.status, 200);
    assert.equal(signed.body.approval.type, 'security-signoff');
    assert.equal((await env.item('SEC-1')).stage, 'release');
    // Lerato lacks the permission: the approval she opens waits on someone who has it, and she gives it on their behalf.
    await env.put('SEC-2', 'security-review');
    const onBehalf = await env.call('lerato-m', 'POST', '/items/SEC-2/advance', {});
    assert.equal(onBehalf.status, 200);
    assert.notEqual(onBehalf.body.approval.reviewers[0].id, 'lerato-m');
    assert.equal(onBehalf.body.approval.reviewers[0].by, 'lerato-m');

    // A story whose last pull request merges passes Test; its feature goes on to Security review, not Release.
    const s = env.s;
    await env.store.writeDoc(['items', 'STORY-091-1.md'], {
      id: 'STORY-091-1', type: 'story', ref: 'STORY-091-1', title: 'Story', system: 'factory', parentId: 'PRD-091', feature: { id: 'FEAT-091-1', title: 'Feature' },
      stage: 'build', status: 'active', owner: 'lerato-m', team: null, createdAt: NOW, stageEnteredAt: NOW, history: [{ stage: 'build', enteredAt: NOW, by: 'thabo-n' }], version: 1,
    }, '');
    const evidence = { required: 1, present: 1, passing: 1, missing: [], failing: [], unproven: [], gates: 'passed', text: '1 of 1 required tests present, all passing', cases: [], manual: [] };
    await s.recordPullRequest({ itemId: 'STORY-091-1', runId: 'run-91', workItemId: 'WI-1', repo: 'acme/slots-api', title: 'Build', head: 'factory/run-91/main', sha: 'a'.repeat(40), gates: 'passed', evidence });
    const open = async (type) => (await s.approvals({ type })).find((a) => a.itemId === 'PR-091-1-1' && a.status === 'open');
    await s.decideApproval({ approvalId: (await open('build-approval')).id, decision: 'approve', actor: person('stevie') });
    await s.decideApproval({ approvalId: (await open('test-approval')).id, decision: 'approve', actor: person('stevie') });
    await s.pullRequestMerged({ prId: 'PR-091-1-1', actor: person('lerato-m') });
    assert.equal((await env.item('STORY-091-1')).stage, 'security-review');
    assert.match(env.events('feature.in_release').at(-1).payload.summary, /FEAT-091-1 · Feature is in Security review/);
    assert.deepEqual((await s.featuresOf({ itemId: 'PRD-091' })).map((f) => f.text), ['In Security review (STORY-091-1)']);
  } finally { await env.stop(); }
});

test('step 4: an evaluator that doesn\'t exist refuses the file; the last good keeps running and the reason is shown', async () => {
  const env = await start();
  try {
    await env.s.stages();
    const doc = structuredClone(SEEDED);
    doc.stages.find((s) => s.key === 'design').checks.push('design.nope');
    await env.lifecycle(doc);
    const view = await env.s.workflow();
    const file = view.files.find((f) => f.file === 'lifecycle.yaml');
    assert.equal(file.status, 'refused');
    assert.equal(file.errors[0].where, 'stage design, checks[4]');
    assert.match(file.errors[0].message, /there is no evaluator "design\.nope"/);
    assert.ok(env.stand.auditLog.some((a) => a.action === 'workflow.refused' && a.target === 'lifecycle.yaml'));
    // Approvals keep working on the last good definition.
    assert.deepEqual(view.stages.find((s) => s.key === 'design').checks.map((c) => c.key), ['requirements-covered', 'decisions-decided', 'interfaces-complete']);
    await env.put('OK-1', 'build');
    const moved = await env.call('lerato-m', 'POST', '/items/OK-1/advance', {});
    assert.equal(moved.status, 200);
    assert.equal((await env.item('OK-1')).stage, 'test');

    // YAML that doesn't read says the line; mistakes in the stages say where.
    await env.store.writeText(['lifecycle.yaml'], 'stages:\n  - key: discover\n    label: [unclosed\n');
    assert.match((await env.s.workflow()).files[0].errors[0].where, /^line \d+$/);
    const broken = structuredClone(SEEDED);
    broken.stages = broken.stages.filter((s) => s.key !== 'engineer');
    broken.stages.find((s) => s.key === 'build').exit = 'spec';
    await env.lifecycle(broken);
    const messages = (await env.s.workflow()).files[0].errors.map((e) => `${e.where}: ${e.message}`);
    assert.ok(messages.some((m) => /there is no stage of the kind engineer/.test(m)), messages.join('\n'));
    assert.ok(messages.some((m) => /stage build, exit: a stage of the kind build is left by build-approval/.test(m)), messages.join('\n'));
    // Fixed: it applies again.
    await env.lifecycle(SEEDED);
    assert.equal((await env.s.workflow()).files[0].status, 'applied');
  } finally { await env.stop(); }
});

test('a stage can\'t go while an item is in it; a rule a gate needs can\'t be switched off; approval-rules.yaml is checked too', async () => {
  const env = await start();
  try {
    await addRule(env, SECURITY_RULE);
    await env.lifecycle(withSecurityReview());
    await env.s.stages();
    await env.put('SEC-9', 'security-review');
    await env.lifecycle(SEEDED);
    const file = (await env.s.workflow()).files.find((f) => f.file === 'lifecycle.yaml');
    assert.equal(file.status, 'refused');
    assert.match(file.errors[0].message, /it is gone while 1 item is in it \(SEC-9\): move them first/);
    assert.ok((await env.s.stages()).some((s) => s.key === 'security-review'), 'the last good still has it');

    const rules = yaml.load(await env.store.readText(['approval-rules.yaml']));
    rules.rules.find((r) => r.key === 'spec').permission = 'approve-everything';
    await env.store.writeText(['approval-rules.yaml'], yaml.dump(rules));
    const rulesFile = (await env.s.workflow()).files.find((f) => f.file === 'approval-rules.yaml');
    assert.equal(rulesFile.status, 'refused');
    assert.match(rulesFile.errors[0].message, /there is no permission "approve-everything"/);
    assert.equal((await env.hosted.services.rules()).rules.find((r) => r.key === 'spec').decision, 'Product → Design (spec, UX and UI)');

    rules.rules.find((r) => r.key === 'spec').permission = 'approve';
    rules.rules.find((r) => r.key === 'test-approval').enabled = false;
    await env.store.writeText(['approval-rules.yaml'], yaml.dump(rules));
    const errors = (await env.s.workflow()).files.find((f) => f.file === 'lifecycle.yaml').errors;
    assert.ok(errors.some((e) => /test-approval can't be switched off/.test(e.message)), JSON.stringify(errors));
  } finally { await env.stop(); }
});

test('step 5: the idea rule switched off: accepting an idea moves it with the plain stage approval; on again, the idea rule', async () => {
  const env = await start();
  try {
    const rules = yaml.load(await env.store.readText(['approval-rules.yaml']));
    rules.rules.find((r) => r.key === 'idea').enabled = false;
    await env.store.writeText(['approval-rules.yaml'], yaml.dump(rules));
    const view = await env.s.workflow();
    assert.equal(view.stages[0].exit.rule, 'stage');
    assert.match(view.files.find((f) => f.file === 'lifecycle.yaml').warnings[0].message, /idea is switched off in approval-rules\.yaml, so Discover is left with the plain stage approval/);
    assert.ok(view.disabledRules.includes('idea'));
    const accepted = await env.s.acceptIdea({ itemId: 'IDEA-090', title: 'Smarter substitutions', actor: person('lerato-m') });
    assert.equal(accepted.approval.type, 'stage');
    assert.equal((await env.item('IDEA-090')).stage, 'product');
    assert.ok(!(await env.hosted.services.rules()).rules.some((r) => r.key === 'idea'));

    rules.rules.find((r) => r.key === 'idea').enabled = true;
    await env.store.writeText(['approval-rules.yaml'], yaml.dump(rules));
    const again = await env.s.acceptIdea({ itemId: 'IDEA-091', title: 'Slot reminders', actor: person('lerato-m'), override: { reason: 'No business case here' } });
    assert.equal(again.approval.type, 'idea');
  } finally { await env.stop(); }
});

test('step 6: under the new definition an agent still can\'t give any approval, and is audited', async () => {
  const env = await start();
  try {
    await addRule(env, SECURITY_RULE);
    await env.lifecycle(withSecurityReview());
    await env.put('SEC-3', 'security-review');
    const refused = await env.call('ada-quill', 'POST', '/items/SEC-3/advance', {});
    assert.equal(refused.status, 403);
    await assert.rejects(env.s.handoff({ itemId: 'SEC-3', actor: AGENT }), { code: 'people_only' });
    assert.ok(env.stand.auditLog.some((a) => a.actor === 'ada-quill' && a.action === 'access.refused'));
    assert.equal((await env.item('SEC-3')).stage, 'security-review');
  } finally { await env.stop(); }
});

test('a data folder from before Phase 27 (no lifecycle.yaml): the built-in stages, with readiness.yaml\'s checks', async () => {
  const env = await start();
  try {
    await env.store.remove(['lifecycle.yaml']);
    await env.store.writeYaml(['readiness.yaml'], { waitingTooLongDays: 5, stages: { product: [{ key: 'goals-measurable', passed: 'Goals are measurable', failed: 'Goals need measures' }] } });
    const view = await env.s.workflow();
    assert.equal(view.files[0].status, 'built-in');
    assert.deepEqual(view.stages.find((s) => s.key === 'product').checks.map((c) => [c.key, c.evaluator]), [['goals-measurable', 'product.goals-measurable']]);
    assert.deepEqual(view.stages.find((s) => s.key === 'design').checks.map((c) => c.key), ['requirements-covered', 'decisions-decided', 'interfaces-complete']);
    assert.equal((await env.call('stevie', 'GET', '/items')).status, 200);
  } finally { await env.stop(); }
});
