// Phase 2 in the real app: the lifecycle engine (src/lifecycle/, part of NooblyJS since 2026-10-10; before that the hosted
// app nooblyjs-ai-workflows) at /workflows next to the Product Factory, with NooblyJS's sessions,
// CSRF, permissions matrix, audit log, event stream and dev clock. The steps follow the roadmap's Phase 2 test
// script and run in order on one data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let priya;
const api = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });

before(async () => {
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
    ],
  });
  [stevie, lerato, priya] = [env.client(), env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
  await priya.signIn('priya-s');
});
after(async () => { await env?.stop(); });

/** Opens the event stream and collects what arrives until stop() is called. */
async function listen(client) {
  const controller = new AbortController();
  const cookie = [...client.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${env.base}/api/v1/events/stream`, { headers: { cookie }, signal: controller.signal });
  const seen = [];
  const reading = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const data = buffer.slice(0, end).split('\n').find((l) => l.startsWith('data: '));
          buffer = buffer.slice(end + 2);
          if (data) seen.push(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* aborted */ }
  })();
  return { res, seen, stop: async () => { controller.abort(); await reading; } };
}

test('the lifecycle engine is part of NooblyJS: not an app on the list, signed in only, at /workflows with no entry in hosted-apps.yaml', async () => {
  const { apps, features } = (await stevie.json('/api/v1/shell')).body;
  assert.equal(apps.find((a) => a.name === 'workflows'), undefined, 'it is not a hosted app any more');
  assert.equal(typeof env.noobly.lifecycle.services.decide, 'function', "host.service('workflows') is NooblyJS's own");
  assert.equal(features.events, true, 'the frame opens the event stream');
  assert.equal((await env.client().get(`${api}/overview`)).status, 401);
  assert.equal((await stevie.json(`${api}/about`)).body.mountPath, '/workflows');
  assert.equal((await stevie.get('/workflows/anything')).status, 404, 'it has no pages');
  const seedConfig = await fs.readFile(new URL('../src/seed/data/config/hosted-apps.yaml', import.meta.url), 'utf8');
  assert.doesNotMatch(seedConfig, /nooblyjs-ai-workflows/);
});

test('step 1: Overview says 12 in flight and four waiting on Stevie, with a card per system and the seeded activity', async () => {
  const { body } = await stevie.json('/api/v1/home/overview');
  assert.equal(body.lifecycle.summary, '12 items in flight across 2 systems. Four are waiting on you.');
  assert.deepEqual(body.lifecycle.stages.map((s) => s.count), [3, 4, 2, 0, 1, 1, 1]);
  assert.deepEqual(body.systems.map((s) => s.key), ['product', 'factory', 'teammates', 'knowledge', 'platform']);
  assert.deepEqual(body.systems[0].stats, ['10 items in design', '5 approvals pending']);
  assert.deepEqual(body.systems[1].stats, ['Not installed yet']);
  assert.equal(body.recent.length, 5);
  assert.equal(body.recent[0].action, 'clustered 412 support tickets into 5 themes');
  assert.deepEqual(body.recent[0].actor, { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' });
  const status = (await stevie.json('/api/v1/shell/status')).body.home;
  assert.equal(status.badges.approvals, 4);
  assert.equal(status.card.items[0].value, '2 agents · 12 items in flight');
  assert.equal((await lerato.json('/api/v1/shell/status')).body.home.badges.approvals, 1);
});

test('step 2: the PRD-031 approval reads 6 of 7 from the Product Factory\'s own facts, with Lerato approved', async () => {
  const { approval } = (await stevie.json(`${api}/approvals/apr_prd031spec`)).body;
  assert.equal(approval.readiness.source, 'product');
  assert.equal(`${approval.readiness.passed} of ${approval.readiness.total}`, '6 of 7');
  assert.deepEqual(approval.readiness.failing.map((c) => c.text), ['Rollout plan missing']);
  assert.deepEqual(approval.others.names, ['Lerato M.']);
  assert.equal(approval.links.artefact, '/factory/product/specs/PRD-031');
});

test('steps 3 to 5: refused without an override; with one PRD-031 moves to Architect, Lerato sees it live, and it is in the files', async () => {
  const stream = await listen(lerato);
  assert.equal(stream.res.status, 200);
  assert.match(stream.res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(stream.res.headers.get('content-encoding'), null, 'not compressed, so nothing buffers it');

  const refused = await post(stevie, `${api}/approvals/apr_prd031spec/decision`, { decision: 'approve' });
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error.code, 'readiness_failed');
  const noCsrf = await stevie.request(`${api}/approvals/apr_prd031spec/decision`, { method: 'POST', json: { decision: 'approve' }, csrf: false });
  assert.equal(noCsrf.status, 403, 'the host checks CSRF before the app sees a change');

  const ok = await post(stevie, `${api}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'Rollout plan follows in the pilot review' } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).item.stage, 'architect');

  // Step 4: Lerato's browser gets the approval and the move without refreshing.
  await eventually(() => {
    const types = stream.seen.map((e) => e.type);
    assert.ok(types.includes('approval.decided') && types.includes('item.stage_changed'), types.join(','));
  });
  const decided = stream.seen.find((e) => e.type === 'approval.decided');
  assert.equal(decided.actor.name, 'Stevie');
  assert.equal(decided.action, 'approved PRD-031 · Same-day delivery slots with a readiness override');
  assert.equal(decided.topic, 'approval.decided');
  await stream.stop();
  const activity = (await lerato.json('/api/v1/activity')).body;
  assert.equal(activity.rows.find((r) => r.type === 'item.stage_changed').action, 'moved PRD-031 · Same-day delivery slots to Architect');
  assert.equal(activity.today.humanDecisions >= 2, true);

  // Step 5: the files.
  const item = await fs.readFile(path.join(env.dataDir, 'workflows', 'items', 'PRD-031.md'), 'utf8');
  assert.match(item, /^stage: architect$/m);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    const approval = audit.find((r) => r.action === 'approval.decided' && r.status === 200);
    assert.equal(approval.actor, 'stevie');
    assert.equal(approval.override, 'Rollout plan follows in the pilot review');
    assert.ok(audit.some((r) => r.action === 'readiness.overridden' && r.reason === 'Rollout plan follows in the pilot review'));
    assert.ok(audit.some((r) => r.action === 'rule.refused' && r.code === 'readiness_failed'));
  });
  // The Product Factory heard it: the spec is approved and shows on its Architecture stage.
  await eventually(async () => {
    const spec = (await stevie.json('/factory/product/api/v1/specs/PRD-031')).body;
    assert.equal(spec.status?.key ?? spec.status, 'approved');
  });
});

test('step 6: Priya (Contributor) cannot approve the ADR; she is told why and the refusal is audited', async () => {
  const res = await post(priya, `${api}/approvals/apr_adr014/decision`, { decision: 'approve' });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error.message, /^You can't accept this: it needs the "accept-decisions" permission, and your access role is Contributor\.$/);
  await eventually(async () => {
    const refusal = (await today(env.store, 'audit')).find((r) => r.actor === 'priya-s' && r.action === 'access.refused');
    assert.equal(refusal.target, 'apr_adr014');
    assert.equal(refusal.status, 403);
  });
});

test('an ADR accepted in Approvals is accepted in the Product Factory too, and it never touches the spec\'s reviewers', async () => {
  const res = await post(stevie, `${api}/approvals/apr_adr014/decision`, { decision: 'approve' });
  assert.equal((await res.json()).outcome, 'approved');
  await eventually(async () => {
    const view = (await stevie.json('/factory/product/api/v1/architecture/PRD-031/adrs')).body;
    const adr = (view.adrs ?? view).find((a) => a.id === 'ADR-014');
    assert.equal(adr.status?.key ?? adr.status, 'accepted');
  });
});

test('the work role never grants permission: Priya as an "architect" is still refused', async () => {
  await env.store.updateDoc(['people', 'priya-s', 'profile.md'], (doc) => ({ ...doc, data: { ...doc.data, workRole: 'architect' } }));
  const res = await post(priya, `${api}/approvals/apr_adr015/decision`, { decision: 'approve' });
  assert.equal(res.status, 403);
});

// Two working days is enough when the seed is written on a weekday (the roadmap's script). Three covers a test run
// on a weekend, when "the next working day" starts later. The tests start with the clock already moved to the
// story's Friday (helpers.js pinClock), so the move is measured from there.
test('step 7: the dev clock moves working days on; ADR-015 is reminded, PRD-029 is reminded then escalated', async () => {
  const before = (await stevie.json('/api/v1/dev/clock')).body;
  const moved = await post(stevie, '/api/v1/dev/clock', { workingDays: 3 });
  assert.equal(moved.status, 200);
  assert.ok((await moved.json()).offsetMs - (before.offsetMs ?? 0) >= 2 * 86_400_000);
  await eventually(async () => {
    const adr = (await stevie.json(`${api}/approvals/apr_adr015`)).body.approval;
    const spec = (await stevie.json(`${api}/approvals/apr_prd029spec`)).body.approval;
    assert.equal(adr.reminders.length, 1);
    assert.equal(adr.escalated, null, 'its rule is Remind only');
    assert.equal(spec.reminders.length, 1);
    assert.deepEqual(spec.escalated.toNames, ['Stevie']);
  }, { ms: 5000 });
  const rows = (await stevie.json(`${api}/items?filter=waiting`)).body.rows;
  assert.ok(rows.find((r) => r.id === 'PRD-029').late, 'Lifecycle marks it waiting too long');
  const events = (await stevie.json('/api/v1/activity?limit=20')).body.rows.filter((r) => r.itemId === 'PRD-029').map((r) => r.type);
  assert.ok(events.indexOf('approval.escalated') < events.indexOf('approval.reminded'), 'reminded first, then escalated (newest first)');
  const audit = await fs.readdir(path.join(env.dataDir, 'audit'), { recursive: true });
  assert.ok(audit.length >= 2, 'records after the move are stamped with the moved time, in a later day file');
  assert.equal((await env.client().get('/api/v1/dev/clock')).status, 401);
});

test('step 8: PRD-027 goes back to Specify with a reason, and Sent back for changes goes up by 1', async () => {
  const before = (await stevie.json(`${api}/flow`)).body.sentBack;
  const res = await post(stevie, `${api}/items/PRD-027/send-back`, { to: 'specify', reason: 'Needs the courier privacy review first' });
  assert.equal(res.status, 200);
  assert.equal((await stevie.json(`${api}/items/PRD-027`)).body.item.stage, 'specify');
  assert.equal((await stevie.json(`${api}/flow`)).body.sentBack, before + 1);
  // The Product Factory reopened the spec.
  await eventually(async () => {
    const spec = (await stevie.json('/factory/product/api/v1/specs/PRD-027')).body;
    assert.equal(spec.status?.key ?? spec.status, 'changes-requested');
  });
});

test('activity filters by kind and system, pages back, and leaves out sign-ins', async () => {
  const people = (await stevie.json('/api/v1/activity?filter=people')).body.rows;
  assert.ok(people.length && people.every((r) => r.actor.kind === 'person'));
  const agents = (await stevie.json('/api/v1/activity?filter=agents')).body.rows;
  assert.ok(agents.length && agents.every((r) => r.actor.kind === 'agent'));
  const factory = (await stevie.json('/api/v1/activity?filter=factory')).body.rows;
  assert.ok(factory.length && factory.every((r) => r.systemLabel === 'Factory'));
  assert.ok((await stevie.json('/api/v1/activity?q=PRD-027')).body.rows.every((r) => /PRD-027/.test(`${r.action} ${r.itemId}`)));
  const all = (await stevie.json('/api/v1/activity?limit=200')).body.rows;
  assert.ok(!all.some((r) => r.type.startsWith('session.')));
  const page = (await stevie.json('/api/v1/activity?limit=3')).body;
  assert.equal(page.rows.length, 3);
  const next = (await stevie.json(`/api/v1/activity?limit=3&before=${encodeURIComponent(page.nextBefore)}`)).body;
  assert.ok(next.rows.length && next.rows.every((r) => r.at < page.nextBefore));
});

test('it wrote only under data/workflows/, and the pages are served', async () => {
  assert.deepEqual((await fs.readdir(path.join(env.dataDir, 'workflows'))).sort(), ['approval-rules.yaml', 'approvals', 'handoffs', 'items', 'readiness.yaml', 'seed.yaml'].filter((n) => n !== 'handoffs'));
  for (const page of ['/home/overview', '/home/lifecycle', '/home/lifecycle/PRD-031', '/home/approvals?id=apr_adr015', '/home/activity', '/dev/clock']) {
    assert.equal((await stevie.get(page)).status, 200, page);
  }
  for (const file of ['/js/pages/home/overview.js', '/js/pages/home/lifecycle.js', '/js/pages/home/item.js', '/js/pages/home/approvals.js', '/js/pages/home/activity.js', '/js/pages/dev/clock.js', '/css/home.css', '/ui/js/components/chips.js']) {
    assert.equal((await stevie.get(file)).status, 200, file);
  }
});
