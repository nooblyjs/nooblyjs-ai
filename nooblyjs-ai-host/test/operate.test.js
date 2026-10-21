// Phase 23 in the real app (root roadmap Phase 23 test script): after Slots 1.0 (the Phase 22 script, in short), PRD-031's
// availability is an SLO with an error budget; burning it with the mock monitor alerts on call in Teams (the simulator's
// On-call channel); an incident declared on it raises a signal on the Product board linked to Slots 1.0, and resolved,
// the SRE agent's review links the release; accepted, it is a Knowledge page; thirty days on by the dev clock, PRD-031's
// outcome review shows its goals today against target, and approving it closes the item; Metrics shows deployment
// frequency, change failure rate and time to restore. The Factory, Teammates, Infrastructure, Security, Operations and
// Knowledge are hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let thabo;
let priya;
let naledi;
const design = '/factory/design/api/v1';
const factory = '/factory/api/v1';
const quality = '/factory/quality/api/v1';
const security = '/security/api/v1';
const ops = '/operations/api/v1';
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const RUN_MS = { ms: 120_000, every: 250 };
const PR = 'PR-031-1-1';
const events = async (type) => (await today(env.store, 'events')).filter((e) => e.type === type);

before(async () => {
  process.env.INFRA_MOCK_STEP_MS = '0';
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true },
      { package: 'nooblyjs-ai-security', mountPath: '/security', enabled: true },
      { package: 'nooblyjs-ai-operations', mountPath: '/operations', enabled: true },
      { package: 'nooblyjs-ai-knowledge', mountPath: '/wiki', enabled: true },
    ],
  });
  [stevie, lerato, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [thabo, 'thabo-n'], [priya, 'priya-s'], [naledi, 'naledi-k']]) await c.signIn(id);
  // The 16c–16e scripts, in short.
  await post(stevie, `${lifecycle}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
  for (const part of ['requirements', 'solution', 'functional', 'stories']) assert.equal((await post(priya, `${design}/items/PRD-031/draft/${part}`)).status, 200, part);
  await post(thabo, `${lifecycle}/approvals/apr_adr014/decision`, { decision: 'approve' });
  for (const story of ['STORY-031-1', 'STORY-031-2']) assert.equal((await post(thabo, `${design}/items/PRD-031/stories/${story}/handoff`, {})).status, 200, story);
  for (const name of ['web-storefront', 'slots-api', 'stores-service']) {
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/draft`)).status, 200, name);
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/accept`)).status, 200, name);
  }
  for (const story of ['STORY-031-1', 'STORY-031-2']) {
    const analysis = await (await post(priya, `${quality}/stories/${story}/draft`)).json();
    for (const c of analysis.cases) assert.equal((await post(priya, `${quality}/stories/${story}/cases/${c.id}/ready`)).status, 200, c.id);
  }
  assert.equal((await stevie.request('/api/v1/platform/members/naledi-k', { method: 'PATCH', json: { accessRole: 'Approver', reason: 'Naledi tests the Delivery squad\'s pull requests' } })).status, 200);
  assert.equal((await post(naledi, '/api/v1/me/onboarding', { workRole: 'test-analyst', teams: ['delivery-squad'] })).status, 200);
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-1/sign-off`, {})).status, 200);
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-2/sign-off`, { override: { reason: 'Its architecture follows STORY-031-1\'s' } })).status, 200);
  // STORY-031-1's pull request: delivered, its Build and Test approvals given, merged.
  await eventually(async () => {
    const p = (await lerato.json(`${factory}/pull-requests/${PR}`)).body;
    assert.ok(p.pr && !p.pr.checking && p.approvals?.some((a) => a.type === 'build-approval' && a.status === 'open'), JSON.stringify(p.pr?.evidence?.text ?? p.error ?? null));
  }, RUN_MS);
  const build = await post(lerato, `${factory}/pull-requests/${PR}/decision`, { approval: 'build', decision: 'approve' });
  assert.equal(build.status, 200, await build.clone().text());
  const tested = await post(naledi, `${factory}/pull-requests/${PR}/decision`, { approval: 'test', decision: 'approve', override: { reason: 'TC-031-1-4 follows in the slots-api pull request' } });
  assert.equal(tested.status, 200, await tested.clone().text());
  const merged = await post(lerato, `${factory}/pull-requests/${PR}/merge`);
  assert.equal(merged.status, 200, await merged.clone().text());
  // The Phase 22 script, in short: Slots 1.0 released, FND-001's risk accepted, two approvals, the pilot, then everyone.
  assert.equal((await post(priya, `${ops}/releases`, { itemId: 'PRD-031', featureId: 'FEAT-031-1', version: '1.0.0' })).status, 201);
  assert.equal((await post(stevie, `${security}/findings/FND-001/accept-risk`, { reason: 'The key is escaped in slots-api 0.9.5', expiresInDays: 90 })).status, 200);
  const asked = await (await post(priya, `${ops}/releases/REL-001/approval`)).json();
  for (const c of [lerato, thabo]) assert.equal((await post(c, `${lifecycle}/approvals/${asked.approvalId}/decision`, { decision: 'approve' })).status, 200);
  await eventually(async () => assert.equal((await (await lerato.json(`${ops}/releases/REL-001`)).body.status), 'piloting'));
  assert.equal((await post(lerato, `${ops}/releases/REL-001/advance`)).status, 200);
});
after(async () => {
  await env?.stop();
  delete process.env.INFRA_MOCK_STEP_MS;
});

test('step 1: after Slots 1.0, the availability SLO shows its budget; burning it with the mock alerts on call in Teams', async () => {
  const { slos } = (await stevie.json(`${ops}/slos?itemId=PRD-031`)).body;
  assert.deepEqual(slos.map((s) => [s.id, s.kind, s.target]), [['SLO-031-1', 'latency', 'p95 < 300 ms'], ['SLO-031-2', 'availability', '99.9% monthly']]);
  const availability = slos[1];
  assert.deepEqual([availability.budgetMinutes, availability.status, availability.release], [43.2, 'ok', 'REL-001 · Slots 1.0']);
  assert.equal(availability.budgetText, '43.2 of 43.2 minutes of error budget left (0% burned)');
  // The mock burns 25 minutes: past half, an alert.
  const burned = await post(thabo, `${ops}/slos/SLO-031-2/burn`, { minutes: 25 });
  assert.equal(burned.status, 200, await burned.clone().text());
  const after = await burned.json();
  assert.deepEqual([after.status, after.burnedPercent, after.alerts.map((a) => [a.level, a.teams])], ['burning', 58, [['burning', true]]]);
  const teams = (await stevie.json('/api/v1/dev/teams/sim-on-call')).body;
  assert.ok(teams.transcript.some((l) => l.dir === 'out' && /Availability SLO of PRD-031: half its error budget is burned/.test(l.text)), JSON.stringify(teams.transcript));
  assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'notify.alert_sent'));
  // The rest of it: gone, alerted once more; burning again alerts nothing new.
  await post(thabo, `${ops}/slos/SLO-031-2/burn`, { minutes: 20 });
  await post(thabo, `${ops}/slos/SLO-031-2/burn`, { minutes: 5 });
  const gone = (await stevie.json(`${ops}/slos/SLO-031-2`)).body;
  assert.deepEqual([gone.status, gone.alerts.map((a) => a.level)], ['exhausted', ['burning', 'exhausted']]);
});

test('steps 2 and 3: an incident; the Product board has its signal linked to Slots 1.0; resolved, the agent\'s review links the release; accepted, a Knowledge page', async () => {
  const declared = await post(thabo, `${ops}/incidents`, { title: 'Slot list timeouts at peak', itemId: 'PRD-031', severity: 'SEV2', detail: 'The slot list times out between 18:00 and 18:30.' });
  assert.equal(declared.status, 201, await declared.clone().text());
  const inc = await declared.json();
  assert.deepEqual([inc.id, inc.releaseId, inc.release, inc.status], ['INC-001', 'REL-001', 'REL-001 · Slots 1.0', 'open']);
  // Step 3: the signal from production on the Product board.
  const { signals } = (await priya.json('/factory/product/api/v1/signals')).body;
  const signal = signals.find((x) => x.title === 'Slot list timeouts at peak');
  assert.ok(signal, JSON.stringify(signals.map((x) => x.title)));
  assert.deepEqual([signal.release, signal.itemId, signal.sourceLabel], ['REL-001 · Slots 1.0', 'PRD-031', 'Production']);
  assert.ok((await events('signal.raised')).some((e) => e.payload.release === 'REL-001 · Slots 1.0'));
  // Thabo resolves it; the SRE agent drafts the review, which links the release.
  assert.equal((await post(thabo, `${ops}/incidents/INC-001/notes`, { text: 'The slot cache was cold after the 17:55 deploy' })).status, 200);
  const resolved = await post(thabo, `${ops}/incidents/INC-001/resolve`, { resolution: 'Warmed the slot cache; the timeouts stopped' });
  assert.equal(resolved.status, 200, await resolved.clone().text());
  const r = await resolved.json();
  assert.deepEqual([r.status, r.review.status, r.review.draftedBy.name], ['resolved', 'draft', 'Pip Okafor']);
  assert.match(r.review.text, /REL-001 · Slots 1\.0/);
  assert.match(r.review.text, /## Timeline[\s\S]*The slot cache was cold/);
  // Accepted: written to Knowledge.
  const accepted = await post(lerato, `${ops}/incidents/INC-001/review`);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const a = await accepted.json();
  assert.equal(a.status, 'reviewed');
  assert.ok(a.review.page?.path === 'Post-incident reviews/INC-001 Slot list timeouts at peak.md', JSON.stringify(a.review.page));
  assert.ok((await events('knowledge.page_written')).some((e) => e.payload.path === a.review.page.path), 'Knowledge wrote it');
  // A follow-up becomes an idea.
  const follow = await post(thabo, `${ops}/incidents/INC-001/follow-ups`, { title: 'Warm the slot cache before each deploy', kind: 'idea' });
  assert.equal(follow.status, 201, await follow.clone().text());
  assert.match((await follow.json()).followUps[0].ref, /^IDEA-\d+$/);
});

test('step 4: at the outcome review, the goal shows today vs target; approving it closes the item', async () => {
  const before = (await stevie.json(`${ops}/outcome-reviews/OR-031`)).body;
  assert.deepEqual([before.status, before.days], ['scheduled', 30]);
  assert.equal((await post(stevie, '/api/v1/dev/clock', { hours: 31 * 24 })).status, 200);
  const due = await eventually(async () => { const x = (await stevie.json(`${ops}/outcome-reviews/OR-031`)).body; assert.equal(x.status, 'due'); return x; });
  const goal = due.goals.find((g) => g.measure === 'Same-day slots still open at 12:00');
  assert.deepEqual([goal.before, goal.now, goal.target, goal.met], ['18%', '31.5%', '45%', false]);
  assert.equal(due.text, '0 of 3 goals met');
  assert.ok(due.stillUnderWay.some((s) => s.id === 'STORY-031-2'), 'the other feature is still being built');
  assert.equal(due.closingText, 'Closing PRD-031 withdraws STORY-031-2, STORY-031-3, never released.');
  // A Contributor can't decide it; Lerato (Approver) approves: PRD-031 is done.
  assert.equal((await post(priya, `${lifecycle}/approvals/${due.approvalId}/decision`, { decision: 'approve', for: 'lerato-m' })).status, 403);
  const decided = await post(lerato, `${lifecycle}/approvals/${due.approvalId}/decision`, { decision: 'approve' });
  assert.equal(decided.status, 200, await decided.clone().text());
  assert.equal((await stevie.json(`${lifecycle}/items/PRD-031`)).body.item.status, 'completed');
  // Its unfinished story is withdrawn with it, saying why; the released one stays in Operate.
  const two = (await stevie.json(`${lifecycle}/items/STORY-031-2`)).body.item;
  assert.equal(two.status, 'withdrawn');
  assert.ok((await events('item.withdrawn')).some((e) => e.payload.itemId === 'STORY-031-2' && e.payload.reason === 'PRD-031 closed with its outcome review'));
  assert.deepEqual([(await stevie.json(`${lifecycle}/items/STORY-031-1`)).body.item.stage, (await stevie.json(`${lifecycle}/items/STORY-031-1`)).body.item.status], ['operate', 'active']);
  await eventually(async () => assert.equal((await stevie.json(`${ops}/outcome-reviews/OR-031`)).body.status, 'closed'));
});

test('step 5: Metrics shows deployment frequency, change failure rate (1 of 1) and time to restore', async () => {
  const m = (await stevie.json('/api/v1/home/metrics?range=quarter')).body;
  assert.equal(m.production.deploymentFrequency.text, '2 deploys to production in 90 days (1 release)');
  assert.equal(m.production.changeFailureRate.text, '1 of 1 (100%) rolled back or had an incident');
  assert.match(m.production.timeToRestore.text, /^\d+ minutes \(median of 1 incident\)$/);
  assert.match(m.production.ideaToOutcome.text, /^1 item closed with an outcome review/);
  await post(stevie, '/api/v1/dev/clock', { reset: true });
});

test('the SRE: the onboarding card, and a home of SLOs burning, open incidents, reviews and outcome reviews', async () => {
  assert.ok((await thabo.json('/api/v1/me/onboarding')).body.roles.some((r) => r.key === 'sre'));
  await env.store.updateDoc(['people', 'thabo-n', 'profile.md'], (doc) => ({ ...doc, data: { ...doc.data, workRole: 'sre' } }));
  const home = (await thabo.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(home.layout, 'sre');
  assert.deepEqual(home.tiles.map((t) => t.key), ['burning', 'incidents', 'reviews', 'outcomes']);
  assert.equal(home.tiles[0].value, 1, 'the availability SLO');
  assert.deepEqual(home.panels.lists.find((l) => l.key === 'slos').rows.map((r) => r.id), ['SLO-031-2']);
});
