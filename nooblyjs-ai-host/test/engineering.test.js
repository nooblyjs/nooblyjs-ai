// Phase 16d in the real app (root roadmap Phase 16d test script): STORY-031-1, handed to Engineering by the 16c script,
// gets its application architecture drawn from the demo repository's code and its test analysis from its criteria, is
// signed off with the Engineering checks (an override with a reason when they fail), and only then reaches the Software
// Factory, whose work item carries its architecture and test cases. A commit to the demo repository's main makes the
// architecture stale. The steps run in order on one data folder, with the Factory hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let thabo;
let priya;
let naledi;
const design = '/design/api/v1';
const factory = '/factory/api/v1';
const quality = '/factory/quality/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const arch = async (c = thabo) => (await c.json(`${factory}/engineering/architecture/STORY-031-1`)).body;
const analysis = async (c = priya) => (await c.json(`${quality}/stories/STORY-031-1`)).body;
const runs = async () => (await stevie.json('/api/v1/home/items/STORY-031-1/runs')).body.runs;

before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true }, { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true }, { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }] });
  [stevie, lerato, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [thabo, 'thabo-n'], [priya, 'priya-s'], [naledi, 'naledi-k']]) await c.signIn(id);
  // The 16c script, in short: PRD-031 into Design, its design drafted, ADR-014 accepted, STORY-031-1 handed off.
  await post(stevie, '/workflows/api/v1/approvals/apr_prd031spec/decision', { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
  for (const part of ['requirements', 'solution', 'functional', 'stories']) assert.equal((await post(priya, `${design}/items/PRD-031/draft/${part}`)).status, 200, part);
  await post(thabo, '/workflows/api/v1/approvals/apr_adr014/decision', { decision: 'approve' });
  const handed = await post(thabo, `${design}/items/PRD-031/stories/STORY-031-1/handoff`, {});
  assert.equal(handed.status, 200);
});
after(async () => { await env?.stop(); });

test('the Engineering group: Application architecture, the Test section\'s Test analysis, the sign-off; STORY-031-1 is in Engineer', async () => {
  const factoryApp = (await stevie.json('/api/v1/shell')).body.apps.find((a) => a.name === 'factory');
  assert.deepEqual(factoryApp.nav.filter((n) => n.group === 'Engineering').map((n) => n.label), ['Application architecture', 'Test analysis', 'Engineering sign-off']);
  const { stories } = (await thabo.json(`${factory}/engineering`)).body;
  const row = stories.find((s) => s.id === 'STORY-031-1');
  assert.equal(row.architecture.text, '0 of 3 systems accepted');
  assert.deepEqual(row.signOff.checks.map((c) => [c.key, c.passed]), [['architecture-accepted', false], ['criteria-ready', false], ['interfaces-tested', false]]);
  for (const page of ['/factory/engineering/architecture/STORY-031-1', '/factory/quality/test-analysis/STORY-031-1', '/factory/engineering/sign-off', '/factory/quality/js/module.js', '/factory/quality/css/quality.css']) assert.equal((await thabo.get(page)).status, 200, page);
});

test('step 1: the application architecture of web-storefront names the demo repository\'s real modules, the flow and the objects', async () => {
  const res = await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/web-storefront/draft`);
  assert.equal(res.status, 200);
  const ws = (await res.json()).systems.find((s) => s.name === 'web-storefront');
  assert.equal(ws.readAt.source, 'local');
  assert.match(ws.readAt.commit, /^[0-9a-f]{40}$/);
  assert.ok(ws.modules.includes('format-slot.js'), 'it read the demo repository');
  assert.ok(ws.flow.some((step) => /formatSlot\(start, end\) from format-slot\.js/.test(step)), ws.flow.join(' | '));
  assert.deepEqual(ws.objects.find((o) => o.name === 'Slot')?.fields, ['start', 'end']);
  assert.ok(ws.changes.some((c) => c.kind === 'new' && /\.js$/.test(c.path)));
  assert.equal(ws.status, 'proposed');
  assert.match(ws.currency.text, /^Current with main at [0-9a-f]{7}$/);
  // The other two can't be read here: drawn from the design alone, and said so.
  const slots = (await (await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/slots-api/draft`)).json()).systems.find((s) => s.name === 'slots-api');
  assert.match(slots.flow[0], /^Drawn from the design alone: slots-api can't be read here/);
  await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/stores-service/draft`);
  // A Contributor can't accept; an Architect does.
  assert.equal((await post(priya, `${factory}/engineering/architecture/STORY-031-1/systems/web-storefront/accept`)).status, 403);
  for (const name of ['web-storefront', 'slots-api', 'stores-service']) assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/accept`)).status, 200, name);
  assert.equal((await arch()).summary.text, '3 of 3 systems accepted');
  await eventually(async () => assert.ok((await today(env.store, 'events')).some((e) => e.type === 'engineering.architecture_drafted' && e.payload.systemName === 'web-storefront')));
});

test('step 2: the test analysis gives each criterion a test case with its automation level; "n of m criteria" until the last is ready', async () => {
  const res = await post(priya, `${quality}/stories/STORY-031-1/draft`);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.ok(d.criteria.length >= 1);
  assert.ok(d.criteria.every((c) => c.cases.length >= 1), 'every criterion has a test case');
  assert.ok(d.cases.every((c) => c.level && typeof c.automate === 'boolean'));
  assert.ok(d.cases.some((c) => c.interface) && d.cases.some((c) => c.journey));
  assert.match(d.cases[0].id, /^TC-031-1-1$/);
  // Everything ready but the last criterion's case. (An agent marking a case ready is refused: quality/test.)
  const last = d.criteria.at(-1).cases[0];
  for (const c of d.cases.filter((x) => x.id !== last)) assert.equal((await post(priya, `${quality}/stories/STORY-031-1/cases/${c.id}/ready`)).status, 200, c.id);
  const n = d.criteria.length;
  assert.equal((await analysis()).summary.text, `${n - 1} of ${n} ${n === 1 ? 'criterion' : 'criteria'} ${n - 1 === 1 ? 'has' : 'have'} a ready test case`);
  // A Viewer can't.
  assert.equal((await post(naledi, `${quality}/stories/STORY-031-1/cases/${last}/ready`)).status, 403);
});

test('homes: the Application Architect sees the architectures to accept; the Test analyst the criteria with no ready case', async () => {
  const role = (id, workRole) => env.store.updateDoc(['people', id, 'profile.md'], (doc) => ({ ...doc, data: { ...doc.data, workRole } }));
  await role('thabo-n', 'application-architect');
  const aa = (await thabo.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(aa.layout, 'application-architect');
  // STORY-031-1's three are accepted; the seed's STORY-027-1 has delivery-planner's still proposed.
  assert.deepEqual(aa.panels.lists.find((l) => l.key === 'architectures').rows.map((r) => r.id), ['STORY-027-1:delivery-planner']);
  assert.deepEqual(aa.tiles.map((t) => [t.key, t.value]), [['in-engineer', 2], ['to-accept', 1], ['stale', 0], ['sign-offs', 0]]);
  await role('priya-s', 'test-analyst');
  const ta = (await priya.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(ta.layout, 'test-analyst');
  assert.match(ta.summary, /^Two criteria have no ready test case yet, which holds the Engineering sign-off\.$/);
  assert.deepEqual(ta.panels.lists.find((l) => l.key === 'interfaces').rows.map((r) => r.id), ['STORY-027-1:IF-027-03']);
  assert.deepEqual(ta.panels.lists.find((l) => l.key === 'analyses').rows.map((r) => r.id), ['STORY-027-1', 'STORY-031-1']);
});

test('step 3: the sign-off is refused while a criterion has no ready test case, naming it; an override with a reason is allowed and audited', async () => {
  const d = await analysis();
  const lastCriterion = d.criteria.at(-1).text;
  assert.deepEqual(await runs(), [], 'nothing is built before the sign-off');
  const refused = await post(thabo, `${factory}/engineering/STORY-031-1/sign-off`, {});
  assert.equal(refused.status, 422);
  const err = (await refused.json()).error;
  assert.equal(err.code, 'readiness_failed');
  assert.ok(err.message.includes('A criterion has no ready test case') && err.message.includes(lastCriterion.slice(0, 40)), err.message);
  // Step 4 (before): still nothing in the Factory.
  assert.deepEqual(await runs(), []);
  const ok = await post(thabo, `${factory}/engineering/STORY-031-1/sign-off`, { override: { reason: 'The last criterion is covered by the contract test this week' } });
  assert.equal(ok.status, 200);
  const done = await ok.json();
  assert.equal(done.item.stage, 'build');
  assert.equal(done.handoff.workItems, 3);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'readiness.overridden' && r.target === 'STORY-031-1' && r.reason === 'The last criterion is covered by the contract test this week'));
  });
});

test('step 4: after the sign-off its web-storefront work item is a run whose issue carries its architecture and its test cases', async () => {
  await eventually(async () => assert.equal((await runs()).length, 1), { ms: 10_000, every: 100 });
  const [run] = await runs();
  assert.equal(run.repo, 'web-storefront');
  const intake = path.join(env.dataDir, 'factory', 'intake');
  const files = fs.readdirSync(intake, { recursive: true }).filter((f) => String(f).endsWith('.md')).map((f) => fs.readFileSync(path.join(intake, String(f)), 'utf8'));
  const issue = files.find((t) => t.includes('Repository: web-storefront') && t.includes('STORY-031-1'));
  assert.ok(issue, 'the work item\'s issue');
  assert.match(issue, /## Application architecture of web-storefront \(accepted, read at [0-9a-f]{7}\)/);
  assert.match(issue, /formatSlot\(start, end\) from format-slot\.js/);
  assert.match(issue, /## Test cases to automate and run \(the test analysis\)/);
  assert.match(issue, /- TC-031-1-1 \(/);
  // The other two wait: no repository is set up for them here.
  assert.equal((await stevie.json('/api/v1/home/items/STORY-031-1/runs')).body.waiting.length, 2);
});

test('step 5: a commit to the demo repository\'s main makes the architecture stale, and the check says so', async () => {
  const repo = path.join(env.dataDir, 'factory', 'repos', 'web-storefront');
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changes\n\n- A change on main after the architecture was drawn.\n');
  const git = (...args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@noobly.invalid', ...args], { cwd: repo, encoding: 'utf8' });
  git('add', 'CHANGELOG.md');
  assert.equal(git('commit', '-q', '-m', 'A change on main').status, 0);
  const ws = (await arch()).systems.find((s) => s.name === 'web-storefront');
  assert.equal(ws.currency.stale, true);
  assert.match(ws.currency.text, /^Stale: main is at [0-9a-f]{7}, and this was read at [0-9a-f]{7}$/);
  assert.equal(ws.statusText, 'Stale: draft it again');
  // STORY-031-1 is in Build now: its architecture is read only there, so it is not drawn again.
  const again = await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/web-storefront/draft`);
  assert.deepEqual([again.status, (await again.json()).error.code], [409, 'wrong_stage']);
});
