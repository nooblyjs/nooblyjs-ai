// Phase 16f in the real app (root roadmap Phase 16f test script): every kind of check of PRD-031, from every system, in
// one list and one shape, each with its source and evidence; a failing readiness check overridden with a reason, on the
// check and in the audit log; PRD-031's trace from a goal down to slots-api#482, with the missing links named; the trace
// index deleted and built again the same, and `npm run trace:rebuild` finding 0 differences; an agent refused an
// override, audited. The Software Factory and Infrastructure are hosted; STORY-031-1 goes through Engineer and Build.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, today, eventually } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let env;
let stevie;
let lerato;
let thabo;
let priya;
const design = '/design/api/v1';
const factory = '/factory/api/v1';
const quality = '/factory/quality/api/v1';
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const checks = async (id = 'PRD-031') => (await stevie.json(`/api/v1/home/items/${id}/checks`)).body;
const trace = async (id = 'PRD-031') => (await stevie.json(`/api/v1/home/items/${id}/trace`)).body;
/** A node of the trace tree, found by id, with the path from the root to it. */
function find(node, id, path = []) {
  if (node.id === id) return [...path, node.id];
  for (const child of node.children) {
    const found = find(child, id, [...path, node.id]);
    if (found) return found;
  }
  return null;
}

before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true }, { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true }, { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }, { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true }] });
  [stevie, lerato, thabo, priya] = [env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [thabo, 'thabo-n'], [priya, 'priya-s']]) await c.signIn(id);
  // 16c: PRD-031 into Design, its design drafted, ADR-014 accepted, STORY-031-1 and -2 handed to Engineering.
  await post(stevie, `${lifecycle}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
  for (const part of ['requirements', 'solution', 'functional', 'stories']) assert.equal((await post(priya, `${design}/items/PRD-031/draft/${part}`)).status, 200, part);
  await post(thabo, `${lifecycle}/approvals/apr_adr014/decision`, { decision: 'approve' });
  for (const story of ['STORY-031-1', 'STORY-031-2']) assert.equal((await post(thabo, `${design}/items/PRD-031/stories/${story}/handoff`, {})).status, 200, story);
  // 16d: STORY-031-1's architecture accepted, its test analysis ready, signed off. STORY-031-2 stays in Engineer.
  for (const name of ['web-storefront', 'slots-api', 'stores-service']) {
    await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/draft`);
    await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/accept`);
  }
  const analysis = await (await post(priya, `${quality}/stories/STORY-031-1/draft`)).json();
  for (const c of analysis.cases) await post(priya, `${quality}/stories/STORY-031-1/cases/${c.id}/ready`);
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-1/sign-off`, {})).status, 200);
  // 16e: the run delivers PR-031-1-1; Lerato gives its Build approval.
  let build;
  await eventually(async () => {
    const d = (await lerato.json(`${factory}/pull-requests/PR-031-1-1`)).body;
    build = d.approvals?.find((a) => a.type === 'build-approval' && a.status === 'open');
    assert.ok(build, JSON.stringify(d).slice(0, 200));
  }, { ms: 60_000, every: 250 });
  assert.equal((await post(lerato, `${factory}/pull-requests/PR-031-1-1/decision`, { approval: 'build', decision: 'approve' })).status, 200);
});
after(async () => { await env?.stop(); });

test('step 1: PRD-031 · Checks: readiness, Design\'s and Engineering\'s, quality-attribute gates, standards, Build and Test approvals and INF-031\'s policies in one list', async () => {
  const c = await checks();
  assert.deepEqual(c.kinds.map((k) => k.kind), ['readiness', 'standard', 'gate', 'test', 'policy', 'approval']);
  assert.match(c.text, /^\d+ of \d+ pass · \d+ failing$/);
  const has = (pred, what) => assert.ok(c.checks.some(pred), what);
  // Every check has the one shape, a source and evidence, said in words.
  for (const x of c.checks) {
    assert.match(x.id, /^chk_[0-9a-f]{12}$/);
    assert.ok(x.kind && x.subject.item && x.definedBy.system && x.verifiedBy && x.severity && x.result && x.text && x.source && x.evidence?.summary, JSON.stringify(x));
    assert.ok(['passed', 'failed', 'warning', 'not-run'].includes(x.result));
  }
  has((x) => x.kind === 'readiness' && x.definedBy.system === 'product' && x.text === 'Rollout plan missing', 'the spec\'s readiness (Product section)');
  has((x) => x.kind === 'readiness' && x.subject.item === 'PRD-031' && x.evidence.system === 'design' && x.text === 'Every business requirement is covered by a story', 'Design\'s checks');
  has((x) => x.kind === 'readiness' && x.subject.item === 'STORY-031-2' && x.evidence.system === 'factory' && x.key === 'criteria-ready' && x.result === 'failed', 'Engineering\'s checks');
  has((x) => x.kind === 'standard' && x.text === 'Every new dependency has an accepted ADR' && x.result === 'passed', 'the standards check');
  has((x) => x.kind === 'gate' && x.definedBy.system === 'product' && x.subject.ref === 'QA-031-1' && /^Latency \(p95 < 300 ms\): no gate checks it/.test(x.text), 'a quality attribute against the gates');
  has((x) => x.kind === 'gate' && x.definedBy.ref === 'web-storefront/.factory/config.json#test' && x.result === 'passed', 'the repository\'s gate on the run');
  has((x) => x.kind === 'test' && x.text === '9 of 10 required tests present (TC-031-1-4 missing)' && x.result === 'failed', 'the required tests');
  has((x) => x.kind === 'approval' && x.key === 'build-approval' && x.subject.item === 'PR-031-1-1' && x.text === 'Build approval given by Lerato M.' && x.result === 'passed', 'the Build approval');
  has((x) => x.kind === 'approval' && x.key === 'test-approval' && x.result === 'not-run' && /^Test approval: waiting on /.test(x.text), 'the Test approval');
  has((x) => x.kind === 'policy' && x.subject.ref === 'INF-031 v2 · Test' && x.source === 'Infrastructure' && x.result === 'warning' && x.text === 'Cache tier above Test default', 'INF-031\'s policy checks');
  // check.recorded for each check gathered the first time.
  await eventually(async () => assert.ok((await today(env.store, 'events')).filter((e) => e.type === 'check.recorded').length >= c.total));
});

test('step 2: a failing readiness check overridden with a reason shows the override on the check and in the audit log', async () => {
  const before = (await checks()).checks.find((x) => x.subject.item === 'STORY-031-2' && x.key === 'criteria-ready');
  assert.equal(before.overridable, true);
  // Another kind is its own app's to decide.
  const policy = (await checks()).checks.find((x) => x.kind === 'policy');
  const refused = await post(thabo, `/api/v1/home/items/PRD-031/checks/${policy.id}/override`, { reason: 'Not ours to override' });
  assert.deepEqual([refused.status, (await refused.json()).error.code], [422, 'not_overridable']);
  const res = await post(thabo, `/api/v1/home/items/PRD-031/checks/${before.id}/override`, { reason: 'The test analysis is drafted this afternoon' });
  assert.equal(res.status, 200);
  const after = (await checks()).checks.find((x) => x.id === before.id);
  assert.equal(after.result, 'passed');
  assert.deepEqual([after.override.byName, after.override.reason], ['Thabo N.', 'The test analysis is drafted this afternoon']);
  assert.match(after.text, /overridden by Thabo N\.: The test analysis is drafted this afternoon$/);
  // The sign-off no longer waits on it.
  const readiness = (await stevie.json(`${lifecycle}/items/STORY-031-2`)).body.readiness;
  assert.ok(!readiness.failing.some((f) => f.key === 'criteria-ready'));
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'check.overridden' && r.actor === 'thabo-n' && r.target === 'STORY-031-2' && r.key === 'criteria-ready' && r.reason === 'The test analysis is drafted this afternoon'));
  });
});

test('step 3: PRD-031 · Trace goes from a goal through business requirements, stories and test cases down to slots-api#482, with the missing links named', async () => {
  const t = await trace();
  assert.deepEqual(find(t.root, 'TC-031-1-1'), ['PRD-031', 'GOAL-031-1', 'BR-031-01', 'STORY-031-1', 'AC-031-1-1', 'TC-031-1-1']);
  assert.deepEqual(find(t.root, 'PR-031-1-1').slice(0, 5), ['PRD-031', 'GOAL-031-1', 'BR-031-01', 'STORY-031-1', 'WI-STORY-031-1-1']);
  assert.ok(find(t.root, 'PR-031-1-1').length === 7, 'work item → run → pull request');
  assert.deepEqual(find(t.root, 'slots-api-482'), ['PRD-031', 'BR-031-05', 'STORY-031-2', 'slots-api-482']);
  assert.ok(find(t.root, 'INF-031') && find(t.root, 'ADR-014') && find(t.root, 'QA-031-1'));
  const gaps = t.gaps.map((g) => g.text);
  assert.ok(gaps.includes('AC-031-2-1 has no test'), gaps.join(' | '));
  assert.ok(!gaps.includes('AC-031-1-1 has no test'));
  assert.ok(t.coverage.includes('1 of 3 acceptance criteria has a test'), t.coverage.join(' | '));
});

test('step 4: data/trace deleted, the Trace tab is identical; npm run trace:rebuild reports 0 differences', async () => {
  const first = await trace();
  fs.rmSync(path.join(env.dataDir, 'trace'), { recursive: true, force: true });
  assert.deepEqual(await trace(), first);
  assert.ok(fs.existsSync(path.join(env.dataDir, 'trace', 'index.yaml')), 'built again');
  const run = spawnSync(process.execPath, ['scripts/trace-rebuild.js'], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, DATA_DIR: env.dataDir, NODE_ENV: 'test', NOOBLY_DEV_LOGIN: 'true', LOG_LEVEL: 'error', PORT: '0', NODE_TEST_CONTEXT: '' },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /0 differences: the index is what the apps say\./);
  assert.deepEqual(await trace(), first);
});

test('step 5: an agent is refused an override, and the refusal is audited', async () => {
  const check = (await checks()).checks.find((x) => x.kind === 'readiness' && x.result === 'failed' && x.overridable);
  assert.ok(check, 'a failing readiness check');
  await assert.rejects(env.noobly.checks.override({ itemId: 'PRD-031', checkId: check.id, reason: 'Agents should not', actor: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' } }), { code: 'people_only' });
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'access.refused' && r.actor === 'ada-quill' && /override a check/.test(r.reason)));
  });
  assert.equal((await checks()).checks.find((x) => x.id === check.id).result, 'failed', 'nothing was overridden');
});
