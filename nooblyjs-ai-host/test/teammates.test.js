// nooblyjs-ai-teammate hosted in NooblyJS: the first real app in the frame, and the pattern for Factory and Knowledge
// (roadmap hosted-app checklist). Its rail entry, nav and status card come from register(); its pages are a UI
// module in the frame; its API is signed-in only, gated by the NooblyJS permissions matrix, CSRF-checked and audited
// by the host; and it writes only under data/teammates/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApp, today, eventually } from './helpers.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');

let env;
before(async () => {
  env = await startApp({
    env: { AI_PROVIDER: 'mock' },
    hostedApps: [{ package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true }],
  });
});
after(async () => { await env?.stop(); });

test('the shell lists Teammates as ready, with its UI module, kit icons and nav filtered by permission', async () => {
  const owner = env.client();
  await owner.signIn('stevie');
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  const tm = (await owner.json('/api/v1/shell')).body.apps.find((a) => a.name === 'teammates');
  assert.equal(tm.state, 'ready');
  assert.equal(tm.rail, true);
  assert.deepEqual(tm.ui, { entry: 'js/module.js', styles: ['css/teammates.css'] });
  assert.deepEqual(tm.nav.map((n) => n.key), ['team', 'profiles', 'timeline', 'board', 'billing', 'hire', 'team-memory', 'settings', 'admin']);
  const kitIcons = await fs.readFile(require.resolve('nooblyjs-core/public/ui/js/icons.js'), 'utf8');
  for (const name of [tm.icon, ...tm.nav.map((n) => n.icon)]) assert.match(kitIcons, new RegExp(`\\b${name}:`), `kit icon ${name}`);
  // A Viewer doesn't see the Owner-only rows (a hint: the API refuses them too).
  const seen = (await viewer.json('/api/v1/shell')).body.apps.find((a) => a.name === 'teammates').nav.map((n) => n.key);
  assert.deepEqual(seen, ['team', 'profiles', 'timeline', 'board', 'billing', 'team-memory']);
});

test('every page URL under /teammates is the frame; its module, styles and kit load; missing files are 404s', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  for (const page of ['/teammates', '/teammates/team', '/teammates/team/ada-quill', '/teammates/billing?tab=x']) {
    const res = await c.get(page);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /<script type="module" src="\/ui\/js\/frame\.js">/, page);
  }
  const mod = await c.get('/teammates/js/module.js');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /javascript/);
  assert.match(mod.headers.get('content-security-policy'), /default-src 'self'/, "NooblyJS's policy, not the app's own");
  const css = await (await c.get('/teammates/css/teammates.css')).text();
  assert.deepEqual(unscopedSelectors(css, 'teammates'), []);
  assert.equal((await c.get('/teammates/js/nope.js')).status, 404);
  // Signed out, a page goes to the sign-in, and the API answers 401.
  const anon = env.client();
  assert.equal((await anon.get('/teammates/team')).status, 302);
  assert.equal((await anon.get('/teammates/api/v1/teammates')).status, 401);
});

test('the API takes the NooblyJS session and the NooblyJS CSRF token; without the token a change is refused', async () => {
  const c = env.client();
  await c.signIn('lerato-m'); // Approver → a Teammates manager
  const roster = await c.json('/teammates/api/v1/teammates');
  assert.equal(roster.status, 200);
  assert.ok(roster.body.teammates.length > 0, 'the seed story has teammates');
  const id = roster.body.teammates[0].id;
  const pin = await c.request(`/teammates/api/v1/teammates/${id}/memory`, { method: 'GET' });
  assert.equal(pin.status, 200);
  const blocked = await c.request(`/teammates/api/v1/schedules`, { method: 'POST', json: {}, csrf: false });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'csrf_failed');
  // With the host's token the change reaches Teammates (which then checks the body).
  const reached = await c.request(`/teammates/api/v1/schedules`, { method: 'POST', json: {} });
  assert.equal(reached.status, 422);
  assert.notEqual((await reached.json()).error.code, 'csrf_failed');
});

test('Teammates roles come from the NooblyJS matrix: hiring is Owner-only, and a refusal is audited', async () => {
  const approver = env.client();
  await approver.signIn('lerato-m');
  const hire = await approver.request('/teammates/api/v1/teammates', { method: 'POST', json: { name: 'Test' } });
  assert.equal(hire.status, 403);
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  const settings = await viewer.request('/teammates/api/v1/settings');
  assert.equal(settings.status, 403);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'access.refused' && r.permission === 'hire-teammates' && r.actor === 'lerato-m'));
    assert.ok(audit.some((r) => r.action === 'access.refused' && r.permission === 'set-budgets' && r.actor === 'naledi-k'));
  });
  const owner = env.client();
  await owner.signIn('stevie');
  assert.equal((await owner.request('/teammates/api/v1/settings')).status, 200);
});

test('the status card is in the shell shape, with the approvals badge', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { body } = await c.json('/api/v1/shell/status');
  const s = body.teammates;
  assert.equal(typeof s.badges.approvals, 'number');
  assert.ok(['ok', 'warning'].includes(s.card.pill.tone));
  assert.match(s.card.items[0].value, /^\d+ of \d+ on a task$/);
});

test('it writes only under data/teammates/', async () => {
  const entries = await fs.readdir(path.join(env.dataDir, 'teammates'));
  assert.ok(entries.includes('teammates'), 'its seed is in its own folder');
  assert.equal(await fs.stat(path.join(env.dataDir, 'system')).catch(() => null), null, 'nothing at the data root');
});

// ------------------------------------------------------------------ Phase 6: the source of agents across NooblyJS

test('hosted-app checklist step 6: its nooblyjs-core services are the host’s, as instances named after the app, at the host’s log level', async () => {
  const app = env.noobly.hosted.apps.find((a) => a.name === 'teammates').internals;
  assert.equal(app.core.instanceName, 'teammates');
  // One registry for the whole process: the app made its instances on the host's, and never initialised its own.
  const names = (kind) => [...(env.noobly.serviceRegistry.services?.keys?.() ?? [])].filter((k) => k.startsWith(`${kind}:`) && k.endsWith(':teammates'));
  for (const kind of ['logging', 'caching', 'queueing', 'notifying', 'measuring']) assert.ok(names(kind).length <= 1, `${kind}: ${names(kind)}`);
  assert.equal(app.core.logLevel, 'error');
});

test('other apps reach teammates through host.service: the team, who can work, and one task', async () => {
  const { agents } = env.noobly;
  assert.equal(agents.running(), true);
  assert.equal(agents.provider(), 'mock');
  const roster = await agents.roster();
  assert.equal(roster.length, 9);
  const rhea = roster.find((a) => a.id === 'rhea-voss');
  assert.deepEqual([rhea.name, rhea.role, rhea.rate, rhea.model.name, rhea.canWork], ['Rhea Voss', 'Architect', 52, 'Claude Opus', true]);
  assert.equal((await agents.availability('sable-reyes')).code, 'teammate_paused');
});

test('Teams & roles names each agent from Teammates, with its model: "Agent · Opus"', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { body } = await c.json('/api/v1/home/teams');
  const ada = body.members.rows.find((r) => r.id === 'ada-quill');
  assert.deepEqual([ada.name, ada.kindText, ada.accessRole, ada.team], ['Ada Quill', 'Agent · Opus', 'Contributor', 'Delivery squad']);
  assert.equal(body.members.rows.find((r) => r.id === 'milo-brightwater').kindText, 'Agent · Sonnet');
  const delivery = body.teams.find((t) => t.id === 'delivery-squad');
  assert.deepEqual(delivery.agents.map((a) => [a.name, a.role, a.status]), [['Ada Quill', 'Research Analyst', 'On a task'], ['Rhea Voss', 'Architect', 'On a task']]);
  // A person's row is untouched.
  assert.equal(body.members.rows.find((r) => r.id === 'stevie').kindText, 'Person');
});

test('a task run for NooblyJS reaches the event log and the audit log with its context, and nothing outside data/teammates/', async () => {
  const result = await env.noobly.agents.runTask({
    slug: 'pip-okafor', workType: 'meeting.answer', itemId: 'PRD-031', system: 'teams',
    caller: { type: 'user', id: 'stevie', name: 'Stevie' }, billTo: { teamId: 'delivery-squad', teamName: 'Delivery squad' },
    input: { task: 'Who is the room booked for?' }, scripted: async () => ({ output: 'Delivery squad, 14:00.', costUsd: 0.02 }),
  });
  assert.deepEqual([result.output, result.costUsd, result.modelRoute, result.team], ['Delivery squad, 14:00.', 0.02, 'mock/claude-sonnet-5-5', 'Delivery squad']);
  const finished = (await today(env.store, 'events')).find((e) => e.type === 'teammate.task_finished' && e.payload.workId === result.workId);
  assert.equal(finished.actor, 'pip-okafor');
  assert.deepEqual(
    [finished.payload.teammateId, finished.payload.itemId, finished.payload.system, finished.payload.modelRoute, finished.payload.costUsd],
    ['pip-okafor', 'PRD-031', 'teams', 'mock/claude-sonnet-5-5', 0.02],
  );
  await eventually(async () => {
    const audited = (await today(env.store, 'audit')).find((r) => r.target === result.workId);
    assert.deepEqual([audited.actor, audited.action, audited.requestedBy], ['pip-okafor', 'agent.meeting.answer', 'stevie']);
  });
  assert.equal(await fs.stat(path.join(env.dataDir, 'system')).catch(() => null), null);
});
