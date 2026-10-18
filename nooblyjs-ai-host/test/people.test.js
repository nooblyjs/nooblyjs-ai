// Phase 3 in the real app: onboarding, profiles, the first-week checklist, the For you homes and Teams & roles
// (roadmap Phase 3 test script). The steps run in order on one data folder, with the NooblyJS lifecycle engine hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
const wf = '/workflows/api/v1';
const send = (c, method, url, json = {}) => c.request(url, { method, json });
const post = (c, url, json) => send(c, 'POST', url, json);
const signedIn = async (id) => {
  const c = env.client();
  await c.signIn(id);
  return c;
};

before(async () => {
  env = await startApp();
});
after(async () => { await env?.stop(); });

test('step 1: Naledi (no profile) is sent to onboarding from any page, with Product manager suggested from her job title', async () => {
  const c = await signedIn('naledi-k');
  for (const page of ['/', '/home/approvals', '/platform/settings']) {
    const res = await c.get(page);
    assert.equal(res.status, 302, page);
    assert.equal(res.headers.get('location'), '/onboarding');
  }
  const page = await c.get('/onboarding');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Set up NooblyJS around the work you actually do\./);
  const { body } = await c.json('/api/v1/me/onboarding');
  assert.deepEqual(body.suggested, { role: 'product-manager', jobTitle: 'Product Manager, Digital' });
  assert.deepEqual(body.roles.map((r) => r.name), ['Product manager', 'Architect', 'Developer', 'Designer', 'Engineering lead', 'Platform engineer']);
  const pm = body.roles[0];
  assert.equal(pm.tasks.length, 3);
  assert.deepEqual(pm.tools.map((t) => t.name), ['Jira Cloud', 'Zendesk']);
  assert.deepEqual(pm.firstThings, ['Review PRD-031 · Same-day delivery slots', 'Score the "Smarter substitutions" idea', 'Pin the Delivery space in Knowledge']);
  assert.equal(body.teams.find((t) => t.id === 'delivery-squad').counts, '2 people · 2 agents');
  assert.equal(body.profile, null);
  assert.equal((await env.client().get('/onboarding')).status, 302, 'signed out goes to /login');
});

test('step 2: finishing onboarding saves the role, team and the Teams toggle, and opens the PM home', async () => {
  const c = await signedIn('naledi-k');
  const bad = await post(c, '/api/v1/me/onboarding', { workRole: 'wizard', teams: ['delivery-squad'] });
  assert.equal(bad.status, 422);
  assert.equal((await post(c, '/api/v1/me/onboarding', { workRole: 'product-manager', teams: ['nowhere'] })).status, 422);
  const res = await post(c, '/api/v1/me/onboarding', { workRole: 'product-manager', teams: ['delivery-squad'], tools: { zendesk: true }, approvalsInTeams: true });
  assert.equal(res.status, 200);
  const { profile, home } = await res.json();
  assert.equal(home, '/');
  assert.deepEqual({ workRole: profile.workRole, teams: profile.teams, tools: profile.tools, notifications: profile.notifications, completed: profile.onboarding.completed },
    { workRole: 'product-manager', teams: ['delivery-squad'], tools: { zendesk: true }, notifications: { approvalsInTeams: true, approvalsByEmail: true }, completed: true });
  assert.equal((await c.get('/')).status, 200, 'no longer sent to onboarding');
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'profile.onboarded' && e.actor === 'naledi-k'));
  const file = await env.store.readDoc(['people', 'naledi-k', 'profile.md']);
  assert.equal(file.data.workRole, 'product-manager');
});

test('step 3: her home is the PM layout, scoped to her team; Show everything widens the counts; the first week starts at 1 of 4', async () => {
  const c = await signedIn('naledi-k');
  const mine = (await c.json('/api/v1/home/for-you')).body;
  assert.equal(mine.layout, 'product-manager');
  assert.equal(mine.eyebrow, 'For you · Product manager · Delivery squad');
  assert.equal(mine.firstName, 'Naledi');
  assert.equal(mine.filters.what, 'My items');
  assert.deepEqual(mine.teams.map((t) => t.name), ['Delivery squad']);
  assert.deepEqual(mine.tiles.map((t) => t.key), ['specs', 'items', 'shipped', 'signals']);
  const all = (await c.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(all.scope, 'all');
  const count = (d) => d.tiles.find((t) => t.key === 'items').value;
  assert.equal(count(mine), 7, 'the Delivery squad\'s five specs and idea, plus the two she owns elsewhere');
  assert.equal(count(all), 10, 'every idea and spec in flight');
  // The first week: only "Pick your role and teams" is done, and the event did it.
  await eventually(async () => {
    const { firstWeek } = (await c.json('/api/v1/me/profile')).body;
    assert.equal(`${firstWeek.done} of ${firstWeek.total}`, '1 of 4');
    assert.deepEqual(firstWeek.tasks.map((t) => t.done), [true, false, false, false]);
    assert.equal(firstWeek.next, 'review your first spec');
  });
  const card = (await c.json('/api/v1/shell/status')).body.home.card;
  assert.deepEqual(card.meter, { label: 'Getting started', value: '1 of 4', ratio: 0.25, tone: 'live' });
  assert.deepEqual(card.lines, ['Next: review your first spec']);
});

test('step 5: Lerato starts at 2 of 4 (she approved PRD-031 in the seed story), and her home leads with what waits on her', async () => {
  const c = await signedIn('lerato-m');
  const { firstWeek } = (await c.json('/api/v1/me/profile')).body;
  assert.equal(`${firstWeek.done} of ${firstWeek.total}`, '2 of 4');
  const home = (await c.json('/api/v1/home/for-you')).body;
  assert.equal(home.tiles[0].value, 1);
  assert.match(home.summary, /^One spec needs you today/);
  const kinds = home.panels.waiting.map((w) => `${w.kind}:${w.title}`);
  assert.ok(kinds.includes('review:Checkout accessibility — PRD-029'));
  assert.ok(kinds.includes('preview:Mobile promo code fix — PRD-032'));
  assert.ok(home.panels.waiting.some((w) => w.kind === 'nudge' && /Store pickup lockers — waiting 4 days in Architect/.test(w.title)));
  assert.equal(home.panels.agent.title, 'Ada Quill is working for you');
  // Nudge goes through the engine, once.
  const nudge = await post(c, `${wf}/items/PRD-025/nudge`);
  assert.equal(nudge.status, 200);
  assert.equal((await post(c, `${wf}/items/PRD-025/nudge`)).status, 409);
});

test('step 6: Thabo\'s Architect home has ADR-014 and ADR-015; accepting ADR-014 ticks his first week from the event', async () => {
  const c = await signedIn('thabo-n');
  const home = (await c.json('/api/v1/home/for-you')).body;
  assert.equal(home.layout, 'architect');
  assert.deepEqual(home.panels.decisions.map((d) => d.eyebrow).sort(), ['ADR-014 · PRD-031', 'ADR-015 · PRD-027']);
  assert.ok(home.panels.decisions.every((d) => d.canDecide));
  assert.equal(home.tiles[0].value, 2);
  assert.equal(home.tiles[1].label, 'In Architecture');
  assert.equal(home.panels.standards.unavailable.phase, 7);
  assert.equal(home.panels.models.unavailable.phase, 8);
  assert.ok(home.panels.queue.some((q) => /Store pickup lockers/.test(q.title) && q.action.label === 'Ask Rhea to draft'));
  assert.ok(home.panels.queue.some((q) => /Same-day delivery slots/.test(q.title) && /^Arrives when Stevie approves the spec/.test(q.text)));
  assert.equal((await c.json('/api/v1/me/profile')).body.firstWeek.done, 1);

  const accept = await post(c, `${wf}/approvals/apr_adr014/decision`, { decision: 'approve' });
  assert.equal(accept.status, 200);
  await eventually(async () => {
    const { firstWeek } = (await c.json('/api/v1/me/profile')).body;
    assert.equal(`${firstWeek.done} of ${firstWeek.total}`, '2 of 4');
    assert.ok(firstWeek.tasks.find((t) => t.key === 'decide-adr-014').done);
  });
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'profile.first_week_progressed' && e.actor === 'thabo-n'));
  assert.equal((await c.json('/api/v1/shell/status')).body.home.card.meter.value, '2 of 4');
  assert.equal((await c.json('/api/v1/home/for-you')).body.panels.decisions.length, 1);
});

test('step 7: Priya\'s Developer home has her pull requests; runs and their questions wait for the Software Factory', async () => {
  const c = await signedIn('priya-s');
  const home = (await c.json('/api/v1/home/for-you')).body;
  assert.equal(home.layout, 'developer');
  assert.deepEqual(home.panels.prs.map((p) => p.ref).sort(), ['slots-api #482', 'web-storefront #481']);
  assert.equal(home.tiles.find((t) => t.key === 'prs').value, 2);
  assert.equal(home.tiles.find((t) => t.key === 'merged').value, 1);
  // This file hosts no Factory: the panels and tiles say so, rather than showing empty lists.
  assert.match(home.panels.runs.unavailable.text, /Software Factory is not running here/);
  assert.match(home.panels.question.unavailable.text, /Software Factory is not running here/);
  assert.equal(home.panels.runs.unavailable.phase, undefined);
  assert.deepEqual([home.tiles.find((t) => t.key === 'runs').value, home.tiles.find((t) => t.key === 'help').note], [0, 'The Software Factory is not running here']);
  assert.match(home.panels.teammate.text, /Juno never merges to main\./);
});

test('step 8: Priya changes role to Architect: the home changes, but accepting an ADR is still refused', async () => {
  const c = await signedIn('priya-s');
  const before = (await c.json('/api/v1/me/onboarding')).body.profile;
  assert.equal(before.workRole, 'developer');
  const res = await post(c, '/api/v1/me/onboarding', { workRole: 'architect', teams: before.teams });
  assert.equal(res.status, 200);
  const home = (await c.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(home.layout, 'architect');
  assert.ok(home.panels.decisions.length >= 1);
  assert.ok(home.panels.decisions.every((d) => d.canDecide === false), 'the work role does not make her a decider');
  const refused = await post(c, `${wf}/approvals/apr_adr015/decision`, { decision: 'approve' });
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error.message, /your access role is Contributor/);
  assert.equal((await c.json('/api/v1/shell')).body.person.accessRole, 'Contributor');
  await eventually(async () => {
    assert.ok((await today(env.store, 'audit')).some((r) => r.actor === 'priya-s' && r.action === 'access.refused' && r.target === 'apr_adr015'));
  });
});

test('Hide puts Your first week away; a profile change is validated; a page never marks a task done', async () => {
  const c = await signedIn('lerato-m');
  assert.equal((await send(c, 'PUT', '/api/v1/me/profile', { workRole: 'nonsense' })).status, 422);
  assert.equal((await send(c, 'PUT', '/api/v1/me/profile', { teams: ['nowhere'] })).status, 422);
  const sneaky = await send(c, 'PUT', '/api/v1/me/profile', { firstWeek: { hidden: false, done: { 'pin-delivery-space': { at: 'now' } } } });
  assert.equal(sneaky.status, 200);
  assert.equal((await sneaky.json()).firstWeek.done, 2, 'done is not something a request can set');
  const hidden = await send(c, 'PUT', '/api/v1/me/profile', { firstWeek: { hidden: true } });
  assert.equal((await hidden.json()).firstWeek.card, false);
  assert.equal((await c.json('/api/v1/shell/status')).body.home.card.items[0].label, 'Agents working now');
});

test('roles without a For you layout get the Overview, and a platform engineer lands on Platform', async () => {
  const stevie = await signedIn('stevie');
  const home = (await stevie.json('/api/v1/home/for-you')).body;
  assert.equal(home.layout, 'none');
  assert.equal(home.role.home, '/platform/repositories');
  assert.equal((await stevie.json('/api/v1/shell/status')).body.home.card.items[0].label, 'Agents working now', 'he hid his first week');
});

test('Teams & roles: the teams, the matrix from roles.yaml, the members, and Invite a person for Owners only', async () => {
  const stevie = await signedIn('stevie');
  const { body } = await stevie.json('/api/v1/home/teams');
  assert.deepEqual(body.teams.map((t) => t.name), ['Checkout squad', 'Delivery squad', 'Platform team']);
  assert.deepEqual(body.matrix.roles, ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner']);
  assert.equal(body.matrix.rows.length, 7);
  const row = (label) => body.matrix.rows.find((r) => r.label === label).allowed;
  assert.deepEqual(row('Accept architecture decisions'), { Viewer: false, Contributor: false, Approver: false, Architect: true, Owner: true });
  assert.deepEqual(row('Hire teammates, set budgets'), { Viewer: false, Contributor: false, Approver: false, Architect: false, Owner: true });
  assert.equal(body.matrix.agentCap, 'Contributor');
  const thabo = body.members.rows.find((m) => m.id === 'thabo-n');
  assert.deepEqual({ kind: thabo.kind, team: thabo.team, accessRole: thabo.accessRole }, { kind: 'person', team: 'Delivery squad', accessRole: 'Architect' });
  assert.ok(thabo.approvals >= 1, 'he accepted ADR-014 above');
  const ada = body.members.rows.find((m) => m.id === 'ada-quill');
  assert.deepEqual({ kind: ada.kind, accessRole: ada.accessRole, approvals: ada.approvals }, { kind: 'agent', accessRole: 'Contributor', approvals: null });
  assert.equal(body.rules.length, 7); // the five from product.md §4, the infrastructure design (9a), and a write to Jira or Bitbucket (13)

  const lerato = await signedIn('lerato-m');
  const invite = { name: 'Kagiso D.', email: 'kagiso-d@noobly.local', jobTitle: 'Senior Software Engineer', accessRole: 'Contributor', team: 'delivery-squad' };
  assert.equal((await post(lerato, '/api/v1/home/people', invite)).status, 403, 'an Approver cannot invite');
  assert.equal((await post(stevie, '/api/v1/home/people', { ...invite, email: 'not-an-email', accessRole: 'King' })).status, 422);
  const made = await post(stevie, '/api/v1/home/people', invite);
  assert.equal(made.status, 201);
  assert.equal((await made.json()).person.id, 'kagiso-d');
  assert.equal((await post(stevie, '/api/v1/home/people', invite)).status, 409);
  assert.ok((await stevie.json('/api/v1/home/teams')).body.teams.find((t) => t.id === 'delivery-squad').people.some((p) => p.id === 'kagiso-d'));
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'person.invited' && r.actor === 'stevie' && r.target === 'kagiso-d' && r.status === 201));
    assert.ok(audit.some((r) => r.actor === 'lerato-m' && r.action === 'access.refused' && r.permission === 'hire-teammates'));
  });
});

test('step 4: an invited person signs in, lands on onboarding with Developer suggested, and Skip for now leaves it open', async () => {
  const c = await signedIn('kagiso-d');
  assert.equal((await c.get('/')).headers.get('location'), '/onboarding');
  assert.equal((await c.json('/api/v1/me/onboarding')).body.suggested.role, 'developer');
  assert.equal((await c.json('/api/v1/me/onboarding')).body.teams.find((t) => t.id === 'delivery-squad').suggested, true);
  const skip = await post(c, '/api/v1/me/onboarding/skip');
  assert.equal((await skip.json()).home, '/');
  assert.equal((await c.get('/')).status, 200, 'a home, not onboarding again');
  const home = (await c.json('/api/v1/home/for-you')).body;
  assert.equal(home.onboarding.completed, false);
  const card = (await c.json('/api/v1/shell/status')).body.home.card;
  assert.equal(card.meter.value, '0 of 4');
  assert.deepEqual(card.lines, ['Next: pick your role and teams']);
  assert.equal((await c.get('/onboarding')).status, 200, 'and onboarding is still offered');
});
