// NooblyJS Phase 7: the factory hosted in NooblyJS, end to end, on the seed story's handoff (PRD-028 · Slot picker
// screens: six work items across four repositories). The demo repository stands in for web-storefront, so two
// work items become runs and four wait. One run delivers a ready PR; the other fails its gate, a fixer can't
// fix it, and the factory asks a person; with the person's answer it is repaired and delivered. Offline: the
// agents are the seed's scripts. A hosted run never merges.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import express from 'express';
import { register, PERMISSIONS } from '../../../index.js';
import { parseReposMap, loadReposMap } from '../../../src/config/repos-map.js';
import { ensureDemoRepo } from '../../../src/services/intake/demo-repo.js';
import { modelConfigured } from '../../../src/services/intake/handoff.js';
import { isHosted, run as mergeStation } from '../../../src/services/line/stations/merge.js';
import { openStore } from '../../../src/models/store/events.js';
import { createHost, createTestServerManager } from '../../fixtures/host.js';
import { testEnv, tmpDir } from '../../helpers.js';

const HANDOFF = {
  id: 'hof_demo1', itemId: 'PRD-028',
  workItems: [
    { id: 'WI-PRD-028-1', repo: 'slots-api', title: 'hold & release endpoints', status: 'new' },
    { id: 'WI-PRD-028-2', repo: 'slots-api', title: 'capacity events', status: 'new' },
    { id: 'WI-PRD-028-3', repo: 'web-storefront', title: 'SlotChip, HoldTimer', status: 'new' },
    { id: 'WI-PRD-028-4', repo: 'web-storefront', title: 'picker, nearby, basket', status: 'new' },
    { id: 'WI-PRD-028-5', repo: 'mobile-app', title: 'same four screens', status: 'new' },
    { id: 'WI-PRD-028-6', repo: 'design-system', title: 'publish 2 components', status: 'new' },
  ],
};
// NooblyJS Phase 11: an item whose Architecture named its repositories. Work items name them in full; one is outside.
const WHERE = {
  id: 'hof_where', itemId: 'PRD-099', repositories: ['acme/web-storefront'],
  workItems: [
    { id: 'WI-PRD-099-1', repo: 'acme/web-storefront', title: 'SlotChip, HoldTimer', status: 'new' },
    { id: 'WI-PRD-099-2', repo: 'acme/mobile-app', title: 'same four screens', status: 'new' },
  ],
};
const ATTRIBUTES = [{ attribute: 'Correctness', scenario: 'A store at the limit', target: 'counts as nearby', verifiedBy: 'test' }];

let t;
before(async () => {
  const rootDir = tmpDir('factory-noobly-intake-');
  const dataDir = path.join(rootDir, 'factory');
  fs.mkdirSync(dataDir);
  const stand = createHost();
  // What NooblyJS's other apps offer: the handoff's work items, and the item's quality attributes.
  // PRD-099's architect linked a standard (NooblyJS Architecture · Knowledge); Knowledge gives its text.
  const KNOWLEDGE = [{ kind: 'file', space: 'Enterprise Space', path: 'Standards/Queueing/standard.md', title: 'Queueing standard', note: 'Data relating to application standard' }];
  stand.host.service = (name) => ({
    workflows: { handoffOf: async ({ handoffId }) => [HANDOFF, WHERE].find((h) => h.id === handoffId) ?? null },
    product: {
      gatesFor: async () => ATTRIBUTES,
      artefactsFor: async (itemId) => (itemId === 'PRD-099' ? { title: 'Slots', spec: { title: 'Slots', problem: 'Hold a slot.' }, architecture: { knowledge: KNOWLEDGE } } : null),
    },
    knowledge: { contextOf: async (links) => links.map((l) => ({ ...l, readable: true, text: 'Every queue has a dead-letter queue.' })) },
  })[name];
  stand.host.development = true;
  const app = express();
  app.use(express.json());
  // The scheduler is driven by hand here (tick), so the test decides when work starts.
  const hosted = await register(app, createTestServerManager(), { mountPath: '/factory', dataDir, host: stand.host, pollMs: 0, schedule: false });
  await hosted.seed();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const call = async (method, url, { as, body } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(as && { 'x-dev-person': as }), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  /** Work the queue until no run is queued or running (each run takes real git and a real test gate). */
  const work = async () => {
    const { scheduler, store } = hosted.internals;
    for (let i = 0; i < 3000; i++) {
      scheduler.tick();
      await scheduler.idle();
      if (!store.list('runs').some((r) => ['queued', 'running'].includes(r.status))) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await hosted.flush();
  };
  t = { ...stand, hosted, dataDir, call, work, close: async () => { await new Promise((r) => server.close(r)); await hosted.close(); } };
});
after(async () => { await t?.close(); });

const runs = () => t.hosted.services.runsForItem('PRD-028');
const byTitle = async (title) => (await runs()).find((r) => r.title === title);

test('the seed makes the demo repository, the map that names it, and the scripts; a second seed changes nothing', async () => {
  const repo = path.join(t.dataDir, 'repos', 'web-storefront');
  assert.ok(fs.existsSync(path.join(repo, '.git')));
  assert.ok(fs.existsSync(path.join(repo, '.factory', 'config.json')));
  assert.deepEqual(Object.keys(loadReposMap({ FACTORY_HOME: t.dataDir })), ['web-storefront']);
  assert.deepEqual(fs.readdirSync(path.join(t.dataDir, 'scripts')).sort(), ['hold-a-slot-for-15-minutes-whi.json', 'picker-nearby-basket.json', 'remove-chart-js.json', 'see-which-stores-still-have-sa.json', 'slot-chart-on-the-store-consol.json', 'slotchip-holdtimer.json']);
  fs.appendFileSync(path.join(t.dataDir, 'repos.yaml'), '# edited by a person\n');
  await t.hosted.seed();
  assert.match(fs.readFileSync(path.join(t.dataDir, 'repos.yaml'), 'utf8'), /edited by a person/);
  assert.deepEqual(ensureDemoRepo(repo), { dir: repo, created: false });
  // No database anywhere: the log is files.
  assert.equal(fs.existsSync(path.join(t.dataDir, 'factory.db')), false);
});

test('repos.yaml is one flat map; a line that is not "name: folder" is refused', () => {
  assert.deepEqual(parseReposMap('# c\nweb-storefront: repos/web-storefront   # demo\nslots-api: "https://example.com/slots-api.git"\n'), { 'web-storefront': 'repos/web-storefront', 'slots-api': 'https://example.com/slots-api.git' });
  assert.throws(() => parseReposMap('just words'), /line 1/);
  assert.throws(() => parseReposMap('bad name!: x'), /line 1/);
  assert.equal(modelConfigured({ AI_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'k' }), false);
  assert.equal(modelConfigured({ ANTHROPIC_API_KEY: 'k' }), true);
  assert.equal(modelConfigured({}), false);
});

test('step 1: a handoff becomes one queued run per work item whose repository is set up; the others wait, with the reason; twice changes nothing', async () => {
  const first = await t.hosted.services.intake({ handoffId: HANDOFF.id });
  assert.deepEqual(first.map((r) => [r.workItemId, Boolean(r.runId), r.waiting ?? null]), [
    ['WI-PRD-028-1', false, 'no repository is set up for "slots-api"'],
    ['WI-PRD-028-2', false, 'no repository is set up for "slots-api"'],
    ['WI-PRD-028-3', true, null],
    ['WI-PRD-028-4', true, null],
    ['WI-PRD-028-5', false, 'no repository is set up for "mobile-app"'],
    ['WI-PRD-028-6', false, 'no repository is set up for "design-system"'],
  ]);
  const queued = await runs();
  assert.deepEqual(queued.map((r) => [r.title, r.status, r.repo, r.itemId]).sort(), [
    ['SlotChip, HoldTimer', 'queued', 'web-storefront', 'PRD-028'],
    ['picker, nearby, basket', 'queued', 'web-storefront', 'PRD-028'],
  ]);
  assert.equal((await t.hosted.services.waitingWork('PRD-028')).length, 4);
  // The same event delivered again (a restart, a retry) starts nothing new.
  await t.hosted.services.intake({ handoffId: HANDOFF.id });
  t.host.events.emit('handoff.created', { handoffId: HANDOFF.id });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await runs()).length, 2);
  assert.equal((await t.hosted.services.waitingWork()).length, 4);
  // What the run carries from NooblyJS, and that it may not run as L3.
  const run = t.hosted.internals.store.list('runs').find((r) => r.title === 'SlotChip, HoldTimer');
  assert.deepEqual([run.request.autonomy, run.request.allowUnsandboxed, run.request.noobly.workItemId, run.request.noobly.attributes], ['L2', true, 'WI-PRD-028-3', ATTRIBUTES]);
  assert.equal(await t.hosted.services.intake({ handoffId: 'hof_unknown' }).then((r) => r.length), 0);
});

test('step 2: the runs execute in this process; one delivers a ready PR, the other fails its gate, cannot be fixed, and asks a person', { timeout: 900_000 }, async () => {
  await t.work();
  const ok = await byTitle('SlotChip, HoldTimer');
  assert.deepEqual([ok.status, ok.statusText, ok.gates], ['delivered', 'PR ready', 'test passed']);
  assert.ok(ok.pr, 'a PR on the local forge');
  const stuck = await byTitle('picker, nearby, basket');
  assert.equal(stuck.status, 'gate_failed');
  assert.match(stuck.gates, /test failed/);

  // The PR is a file under the factory's own folder, with its evidence.
  const forge = path.join(t.dataDir, 'forge');
  const prs = fs.readdirSync(forge, { recursive: true }).map(String).filter((f) => /pr|pull/i.test(f) && f.endsWith('.md'));
  assert.ok(prs.length >= 1, `PR files under ${forge}`);
  const body = prs.map((f) => fs.readFileSync(path.join(forge, f), 'utf8')).join('\n');
  assert.match(body, /SlotChip, HoldTimer/);

  // NooblyJS hears about it, with the lifecycle item on every event, and the cost once (on run.finished).
  const of = (type) => t.eventLog.filter((e) => e.type === type).map((e) => e.payload);
  assert.ok(of('run.started').length >= 2);
  assert.ok(of('run.started').every((p) => p.itemId === 'PRD-028' && p.system === 'factory' && p.repo === 'web-storefront'));
  assert.deepEqual(of('run.finished').map((p) => p.outcome).sort(), ['delivered', 'gate_failed']);
  assert.ok(of('pr.opened').some((p) => p.draft === false) && of('pr.opened').some((p) => p.draft === true));
  assert.ok(of('gate.failed').some((p) => /picker, nearby, basket.*test/.test(p.summary)));
  assert.equal(of('run.waiting').length, 4);
  const asked = of('run.asked');
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].kind, asked[0].itemId], ['escalation', 'PRD-028']);
});

test('step 3: the question reaches the people who can answer it; a Viewer cannot; the answer sends the run back to be repaired, and it delivers', { timeout: 900_000 }, async () => {
  const priya = { id: 'priya-s', accessRole: 'Contributor' };
  const [question] = await t.hosted.services.questionsFor(priya);
  assert.deepEqual([question.kind, question.itemId, question.repo, question.canAnswer], ['escalation', 'PRD-028', 'web-storefront', true]);
  assert.match(question.title, /needs a person/);
  assert.equal((await t.hosted.services.questionsFor({ id: 'naledi-k', accessRole: 'Viewer' }))[0].canAnswer, false);

  const refused = await t.call('POST', `/factory/api/v1/inbox/${question.id}`, { as: 'naledi-k', body: { decision: 'answered', answer: 'x' } });
  assert.equal(refused.status, 403);
  assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'naledi-k'));

  const answered = await t.call('POST', `/factory/api/v1/inbox/${question.id}`, { as: 'priya-s', body: { decision: 'answered', answer: 'A store exactly at the limit counts: make it inclusive.' } });
  assert.equal(answered.status, 200);
  assert.equal(answered.json.resumed, true);
  assert.equal((await byTitle('picker, nearby, basket')).status, 'queued');
  assert.deepEqual(await t.hosted.services.questionsFor(priya), []);

  await t.work();
  const fixed = await byTitle('picker, nearby, basket');
  assert.deepEqual([fixed.status, fixed.gates], ['delivered', 'test passed']);
  // The person's words went to the fixer, and are in the log with who said them.
  const said = t.hosted.internals.store.read({ types: ['pr.changes_requested'] }).at(-1);
  assert.match(said.data.body, /make it inclusive/);
  assert.match(said.data.by, /Priya S\./);
  assert.ok(t.eventLog.some((e) => e.type === 'run.answered'));
  // Nothing was merged: both PRs wait for a person.
  assert.ok(!t.hosted.internals.store.read().some((e) => e.type === 'run.merged'));
});

test('an approval in the inbox still needs the approve permission, and an agent is refused whatever it holds', async () => {
  assert.equal(PERMISSIONS['POST /api/inbox/:id'], 'draft');
  const { store } = t.hosted.internals;
  const run = store.list('runs')[0];
  store.append(`run:${run.id}`, 'inbox.opened', { inboxId: 'ask_approval1', runId: run.id, kind: 'approval', gate: 'plan', title: 'Approve the plan?' });
  const contributor = await t.call('POST', '/factory/api/v1/inbox/ask_approval1', { as: 'priya-s', body: { decision: 'approved' } });
  assert.equal(contributor.status, 403);
  assert.match(contributor.json.error.message, /needs the approve permission/);
  const agent = await t.call('POST', '/factory/api/v1/inbox/ask_approval1', { as: 'ada-quill', body: { decision: 'approved' } });
  assert.equal(agent.status, 403);
  assert.match(agent.json.error.message, /Agents propose and people decide/);
  assert.equal(store.get('inbox', 'ask_approval1').status, 'open');
  const approver = await t.call('POST', '/factory/api/v1/inbox/ask_approval1', { as: 'lerato-m', body: { decision: 'approved' } });
  assert.equal(approver.status, 200);
  const [mine] = (await t.hosted.services.questionsFor({ id: 'x', accessRole: 'Contributor' })).filter((q) => q.id === 'ask_approval1');
  assert.equal(mine, undefined, 'answered entries are gone');
});

test('step 4: hosted in NooblyJS the merge station refuses, at any autonomy level, and says so in the log; outside NooblyJS it is as before', async () => {
  const hostedStore = openStore({ env: { ...testEnv(), FACTORY_HOSTED: 'noobly' } });
  assert.equal(isHosted(hostedStore.env), true);
  const ctx = (store) => ({ store, runId: 'r1', run: { attempt: 1 }, results: { deliver: { status: 'delivered' } }, autonomy: { level: 'L3' }, log() {} });
  const result = await mergeStation(/** @type {any} */ (ctx(hostedStore)));
  assert.deepEqual([result.merged, result.reason], [false, 'hosted in NooblyJS: agents never merge, a person does']);
  assert.deepEqual(hostedStore.read({ types: ['merge.refused'] }).map((e) => [e.data.runId, e.data.autonomy]), [['r1', 'L3']]);
  // Not hosted: L2 says "a person merges" by the old rule, with no refusal event.
  const plain = openStore({ env: testEnv() });
  assert.equal(isHosted(plain.env), false);
  const l2 = await mergeStation(/** @type {any} */ ({ ...ctx(plain), autonomy: { level: 'L2' } }));
  assert.match(l2.reason, /autonomy L2: a person merges/);
  assert.equal(plain.read({ types: ['merge.refused'] }).length, 0);
});

test("NooblyJS Phase 11: a work item named in full is found by its short name; one outside the item's repositories waits, with the reason", async () => {
  const result = await t.hosted.services.intake({ handoffId: WHERE.id });
  assert.equal(result.length, 2);
  assert.ok(result[0].runId, 'acme/web-storefront is the demo repository web-storefront');
  assert.equal(result[1].runId, undefined);
  const waiting = await t.hosted.services.waitingWork('PRD-099');
  // The work item's issue carries the knowledge the architect linked: what it is for, where it is, and its text.
  const issue = fs.readFileSync(path.join(t.dataDir, 'intake', 'hof_where', 'WI-PRD-099-1.md'), 'utf8');
  assert.match(issue, /Knowledge to use \(linked in NooblyJS Architecture\):/);
  assert.match(issue, /## Queueing standard — Data relating to application standard/);
  assert.match(issue, /Where: \[Enterprise Space\]\\Standards\\Queueing\\standard\.md \(file\)/);
  assert.match(issue, /Every queue has a dead-letter queue\./);
  assert.deepEqual(waiting.map((w) => [w.workItemId, w.reason]), [['WI-PRD-099-2', `"acme/mobile-app" is not one of the item's repositories (acme/web-storefront)`]]);
});
