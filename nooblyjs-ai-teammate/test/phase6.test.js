import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { startApp, OWNER_PASSWORD } from './helpers.js';
import { createApp } from '../src/app.js';
import { createProviders } from '../src/providers/index.js';
import { MockProvider } from '../src/providers/mock.js';
import { checkInput, isPrivateAddress } from '../src/services/tools.js';
import { nextRun, describeCadence } from '../src/services/scheduler.js';

// ---------- A tiny MCP server (Streamable HTTP, JSON replies) ----------

const mcpCalls = [];
let mcp;
let mcpUrl;
function startMcp() {
  const a = express();
  a.use(express.json());
  a.post('/mcp', (req, res) => {
    const { id, method, params } = req.body;
    if (id === undefined) return res.status(202).end(); // notification
    const reply = (result) => res.json({ jsonrpc: '2.0', id, result });
    if (method === 'initialize') {
      res.set('Mcp-Session-Id', 'sess-1');
      return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'crm', version: '1' } });
    }
    if (method === 'tools/list') {
      return reply({ tools: [
        { name: 'lookup_account', description: 'Find an account', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
        { name: 'create_contact', description: 'Create a contact', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
      ] });
    }
    if (method === 'tools/call') {
      mcpCalls.push({ name: params.name, args: params.arguments, session: req.get('mcp-session-id') });
      return reply({ content: [{ type: 'text', text: `${params.name} ok: Acme Corp, 120 seats` }] });
    }
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  });
  return new Promise((resolve) => {
    mcp = a.listen(0, () => {
      mcpUrl = `http://127.0.0.1:${mcp.address().port}/mcp`;
      resolve();
    });
  });
}

// ---------- App with recorded webhooks and a fake public web ----------

const hooks = [];
const PAGE = '<html><head><style>x{}</style></head><body><h1>Pricing</h1><p>Pro plan is $49 a month.</p><script>evil()</script></body></html>';
const fakeFetch = async (url, init = {}) => {
  const href = String(url);
  if (href.startsWith('http://127.0.0.1')) return fetch(url, init); // the local MCP server
  if (href.startsWith('http://93.184.216.34/')) return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  hooks.push({ url: href, body: JSON.parse(init.body), headers: init.headers });
  return new Response('', { status: 200 });
};

let app;
before(async () => {
  await startMcp();
  app = await startApp({ fetch: fakeFetch });
  await app.send('POST', '/api/webhooks', { name: 'Everything', url: 'https://hooks.example.com/all', events: ['task.completed', 'task.failed', 'approval.requested', 'action.requested', 'teammate.message'] });
});
after(() => {
  app.close();
  mcp.close();
});

const login = async (username, password) => {
  const res = await fetch(`${app.base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!res.ok) return { status: res.status };
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const { csrf } = await res.json();
  const call = async (method, url, body) => {
    const r = await fetch(app.base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return { status: res.status, call };
};

// ---------- Unit ----------

test('tool inputs are checked against their schema', () => {
  const schema = { type: 'object', properties: { url: { type: 'string' }, n: { type: 'integer' } }, required: ['url'], additionalProperties: false };
  assert.equal(checkInput(schema, { url: 'https://x' }), null);
  assert.equal(checkInput(schema, {}), 'Missing "url"');
  assert.equal(checkInput(schema, { url: 'x', n: 1.5 }), '"n" must be integer');
  assert.equal(checkInput(schema, { url: 'x', other: 1 }), 'Unknown field "other"');
});

test('private and local addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('schedules run at wall-clock times in the workspace time zone', () => {
  const after = Date.parse('2026-10-01T12:00:00Z'); // a Thursday
  assert.equal(nextRun({ days: [1], time: '08:00' }, after, 'Africa/Johannesburg'), '2026-10-05T06:00:00.000Z');
  assert.equal(nextRun({ days: [4], time: '13:30' }, after, 'UTC'), '2026-10-01T13:30:00.000Z');
  // London leaves summer time on 25 October 2026.
  assert.equal(nextRun({ days: [1], time: '08:00' }, Date.parse('2026-10-15T00:00:00Z'), 'Europe/London'), '2026-10-19T07:00:00.000Z');
  assert.equal(nextRun({ days: [1], time: '08:00' }, Date.parse('2026-10-20T00:00:00Z'), 'Europe/London'), '2026-10-26T08:00:00.000Z');
  assert.equal(describeCadence({ days: [1, 2, 3, 4, 5], time: '09:00' }), 'Weekdays at 09:00');
  assert.equal(describeCadence({ days: [1], time: '08:00' }), 'Every Mon at 08:00');
});

// ---------- 6.6 People and roles ----------

test('owners add people with roles; viewers read, managers run work, owners administer', async () => {
  const bad = await app.send('POST', '/api/admin/users', { username: 'No Spaces', name: '', role: 'admin' });
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['name', 'role', 'username']);
  const viewer = (await app.send('POST', '/api/admin/users', { username: 'vic', name: 'Vic Viewer', role: 'viewer' })).body;
  const manager = (await app.send('POST', '/api/admin/users', { username: 'mo', name: 'Mo Manager', role: 'manager' })).body;
  assert.ok(viewer.password.length >= 16, 'a temporary password is shown once');
  assert.equal(viewer.user.passwordHash, undefined);
  assert.equal((await app.send('POST', '/api/admin/users', { username: 'vic', name: 'Again', role: 'viewer' })).body.error.details.username, 'Someone already has that username');

  assert.equal((await login('vic', 'wrong password')).status, 401);
  const v = await login('vic', viewer.password);
  assert.equal(v.status, 200);
  const me = await v.call('GET', '/api/session');
  assert.deepEqual([me.body.user.role, me.body.user.mustChangePassword], ['viewer', true]);
  assert.equal((await v.call('GET', '/api/teammates')).status, 200);
  assert.equal((await v.call('GET', '/api/billing')).status, 200);
  assert.equal((await v.call('PATCH', '/api/teammates/ada-quill', { rate: 1 })).status, 403);
  assert.equal((await v.call('POST', '/api/teammates/wren-sato/tasks', { task: 'x' })).status, 403);
  assert.equal((await v.call('GET', '/api/settings')).status, 403);
  assert.equal((await v.call('GET', '/api/admin/users')).status, 403);

  const m = await login('mo', manager.password);
  assert.equal((await m.call('PATCH', '/api/teammates/pip-okafor', { currentTask: 'Sorting the rota' })).status, 200);
  assert.equal((await m.call('POST', '/api/teammates/pip-okafor/tasks', { task: 'Draft the rota' })).body.entry.caller, 'Mo Manager');
  assert.equal((await m.call('PATCH', '/api/settings', { budgets: { month: 1 } })).status, 403);
  assert.equal((await m.call('POST', '/api/invoices', { month: '2026-09' })).status, 403);
  assert.equal((await m.call('GET', '/api/admin/audit')).status, 403);

  // Changing your own password signs out your other sessions.
  const changed = await m.call('POST', '/api/session/password', { current: manager.password, next: 'mo has a new password' });
  assert.equal(changed.status, 200);
  assert.equal((await m.call('GET', '/api/teammates')).status, 401);
  const m2 = await login('mo', 'mo has a new password');
  assert.equal((await m2.call('GET', '/api/session')).body.user.mustChangePassword, false);

  // A role change or disabling signs the person out; the last owner is protected.
  await app.send('PATCH', `/api/admin/users/${viewer.user.id}`, { role: 'manager' });
  assert.equal((await v.call('GET', '/api/teammates')).status, 401);
  await app.send('PATCH', `/api/admin/users/${viewer.user.id}`, { disabled: true });
  assert.equal((await login('vic', viewer.password)).status, 401);
  const users = (await app.get('/api/admin/users')).body.users;
  const ownerId = users.find((u) => u.role === 'owner').id;
  assert.equal((await app.send('PATCH', `/api/admin/users/${ownerId}`, { role: 'viewer' })).body.error.code, 'own_account');
  const reset = await app.send('POST', `/api/admin/users/${manager.user.id}/reset-password`);
  assert.equal((await m2.call('GET', '/api/teammates')).status, 401);
  assert.equal((await login('mo', reset.body.password)).status, 200);

  const audit = (await app.get('/api/admin/audit')).body.entries.map((e) => e.action);
  for (const a of ['user.create', 'user.update', 'user.password_reset', 'user.password_change']) assert.ok(audit.includes(a), a);
});

test('the Phase 3 single owner moves into the users list and keeps their password', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-mig-'));
  const options = { dataDir, now: () => '2026-10-01', providers: createProviders({ mode: 'mock', mock: new MockProvider({ delayMs: 0 }) }), log: { info() {}, warn() {}, error() {} }, sessionSecret: 's', scheduleIntervalMs: 0 };
  const first = await createApp({ ...options, ownerPassword: OWNER_PASSWORD });
  const [owner] = (await first.store.readDoc(['system', 'users.md'])).data.users;
  // Rewind to the Phase 3 layout: owner.md only, and an alert webhook in settings.
  await first.store.writeDoc(['system', 'owner.md'], { passwordHash: owner.passwordHash, sessionVersion: 3 });
  await first.store.remove(['system', 'users.md']);
  await first.store.remove(['config', 'webhooks.md']);
  await first.repos.config.updateSettings({ alerts: { warnAtPct: 75, webhookUrl: 'https://old.example.com/hook', webhookSecret: 'x'.repeat(20) } });

  const second = await createApp({ ...options, ownerPassword: undefined });
  const [migrated] = (await second.store.readDoc(['system', 'users.md'])).data.users;
  assert.deepEqual([migrated.id, migrated.username, migrated.role, migrated.sessionVersion], ['stevie', 'stevie', 'owner', 3]);
  assert.equal(second.auth.setupRequired, false);
  await second.auth.login(OWNER_PASSWORD); // no username: the owner, as in Phase 3
  await second.auth.login(OWNER_PASSWORD, 'stevie');
  const [endpoint] = await second.webhooks.endpoints();
  assert.deepEqual([endpoint.url, endpoint.secret, endpoint.events.length], ['https://old.example.com/hook', 'x'.repeat(20), 4]);
  assert.deepEqual((await second.repos.config.getSettings()).alerts, { warnAtPct: 75 });
});

// ---------- 6.3 Tools ----------

test('allow-listed tools: fetch_url runs, private addresses are refused, every call is logged', async () => {
  assert.equal((await app.send('PATCH', '/api/teammates/wren-sato', { tools: ['nope'] })).body.error.details.tools, 'Unknown tool');
  await app.send('PATCH', '/api/teammates/wren-sato', { tools: ['fetch_url'] });
  const r = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Summarise the pricing at http://93.184.216.34/pricing' });
  assert.equal(r.status, 200);
  const [call] = r.body.toolCalls;
  assert.deepEqual([call.name, call.status], ['fetch_url', 'ok']);
  assert.match(call.output, /Pro plan is \$49 a month/);
  assert.doesNotMatch(call.output, /evil|<p>/, 'scripts and tags are stripped');
  assert.match(r.body.output, /Pro plan is \$49/);
  const work = (await app.get(`/api/teammates/wren-sato/work/${r.body.workId}`)).body;
  assert.equal(work.toolCalls[0].name, 'fetch_url');

  const blocked = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Read http://127.0.0.1:9/admin please' });
  assert.equal(blocked.body.toolCalls[0].status, 'error');
  assert.match(blocked.body.toolCalls[0].output, /private or local address/);
  // Without the tool on the allow-list, the model is never offered it.
  await app.send('PATCH', '/api/teammates/wren-sato', { tools: [] });
  assert.deepEqual((await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Look at http://93.184.216.34/pricing' })).body.toolCalls, []);
});

test('side-effect tools wait for approval; approval runs them, and only while still allowed', async () => {
  await app.send('PATCH', '/api/teammates/pip-okafor', { tools: ['notify'] });
  hooks.length = 0;
  const r = await app.send('POST', '/api/teammates/pip-okafor/tasks', { task: 'Notify the team that the rota is published' });
  const [call] = r.body.toolCalls;
  assert.equal(call.status, 'queued');
  assert.ok(hooks.some((h) => h.body.event === 'action.requested' && h.body.data.approval === call.approvalId));
  assert.ok(!hooks.some((h) => h.body.event === 'teammate.message'), 'nothing is sent before approval');

  const pending = (await app.get('/api/approvals?status=pending')).body.approvals.find((a) => a.id === call.approvalId);
  assert.deepEqual([pending.kind, pending.tool, pending.workId], ['action', 'notify', r.body.workId]);
  const approved = await app.send('POST', `/api/approvals/${call.approvalId}/approve`);
  assert.deepEqual([approved.status, approved.body.outcome], [202, 'completed']);
  const message = hooks.find((h) => h.body.event === 'teammate.message');
  assert.equal(message.body.data.teammate, 'pip-okafor');
  assert.equal(message.body.data.approvedBy, 'Stevie');
  const work = (await app.get(`/api/teammates/pip-okafor/work/${r.body.workId}`)).body;
  assert.equal(work.toolCalls[0].status, 'approved');

  // Taken off the allow-list before approval: nothing runs, and the outcome says why.
  const again = await app.send('POST', '/api/teammates/pip-okafor/tasks', { task: 'Notify the team about Friday' });
  await app.send('PATCH', '/api/teammates/pip-okafor', { tools: [] });
  hooks.length = 0;
  const refused = await app.send('POST', `/api/approvals/${again.body.toolCalls[0].approvalId}/approve`);
  assert.equal(refused.body.outcome, 'failed');
  assert.match(refused.body.output, /no longer allowed/);
  assert.ok(!hooks.some((h) => h.body.event === 'teammate.message'));
  const declinedTask = await app.send('POST', '/api/teammates/milo-brightwater/tasks', { task: 'hello' });
  assert.equal(declinedTask.body.toolCalls.length, 0);
});

test('MCP servers: read-only tools run, others wait for approval', async () => {
  const bad = await app.send('POST', '/api/mcp-servers', { id: 'Bad Id', name: '', url: 'ftp://x' });
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['id', 'name', 'url']);
  const added = await app.send('POST', '/api/mcp-servers', { id: 'crm', name: 'CRM', url: mcpUrl, authorization: 'Bearer secret-token' });
  assert.deepEqual([added.status, added.body.hasAuth, added.body.headers], [201, true, undefined]);
  const check = await app.send('POST', '/api/mcp-servers/crm/check');
  assert.deepEqual(check.body.tools.map((t) => [t.name, t.readOnly]), [['lookup_account', true], ['create_contact', false]]);
  assert.ok((await app.get('/api/tools')).body.tools.some((t) => t.id === 'mcp:crm'));

  await app.send('PATCH', '/api/teammates/wren-sato', { tools: ['mcp:crm'] });
  mcpCalls.length = 0;
  const read = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Please lookup_account for Acme' });
  assert.deepEqual([read.body.toolCalls[0].name, read.body.toolCalls[0].status], ['mcp__crm__lookup_account', 'ok']);
  assert.deepEqual(mcpCalls.map((c) => [c.name, c.session]), [['lookup_account', 'sess-1']]);

  const write = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'create_contact for Jane at Acme' });
  assert.equal(write.body.toolCalls[0].status, 'queued');
  assert.equal(mcpCalls.length, 1, 'not called before approval');
  const ok = await app.send('POST', `/api/approvals/${write.body.toolCalls[0].approvalId}/approve`);
  assert.equal(ok.body.outcome, 'completed');
  assert.deepEqual(mcpCalls.at(-1).name, 'create_contact');
  await app.send('PATCH', '/api/teammates/wren-sato', { tools: [] });
});

// ---------- 6.2 / 6.4 / 6.1: the Phase 6 "done when" ----------

test('a scheduled Architect task delegates to the Documentor; the timeline links both with their costs', async () => {
  const hire = (name, role, model, rate) => app.send('POST', '/api/teammates', { name, role, model, rate, monthlyCap: 2000, costCentre: 'Platform' });
  const archie = (await hire('Archie Stone', 'Architect', 'opus', 50)).body;
  const dot = (await hire('Dot Lin', 'Documentor', 'haiku', 6)).body;
  assert.equal((await app.send('PATCH', `/api/teammates/${archie.id}`, { delegatesTo: [archie.id] })).body.error.details.delegatesTo, 'Choose other active teammates');
  await app.send('PATCH', `/api/teammates/${archie.id}`, { delegatesTo: [dot.id] });
  await app.send('PATCH', `/api/teammates/${dot.id}`, { delegatesTo: [archie.id] }); // a loop the guard must stop

  const bad = await app.send('POST', '/api/schedules', { teammateId: archie.id, name: '', task: '', cadence: { days: [9], time: '25:00' } });
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['days', 'name', 'task', 'time']);
  const sch = await app.send('POST', '/api/schedules', {
    teammateId: archie.id, name: 'Weekly architecture review', project: 'payments',
    task: 'As the Architect, review the payments design and ask the Documentor to write it up', cadence: { days: [1, 2, 3, 4, 5, 6, 7], time: '08:00' },
  });
  assert.equal(sch.status, 201);
  assert.equal(sch.body.cadenceLabel, 'Every day at 08:00');
  assert.ok(Date.parse(sch.body.nextRunAt) > Date.now());

  hooks.length = 0;
  assert.deepEqual(await app.scheduler.tick(Date.parse(sch.body.nextRunAt) - 1000), [], 'not due yet');
  assert.deepEqual(await app.scheduler.tick(Date.parse(sch.body.nextRunAt) + 1000), [sch.body.id]);
  assert.deepEqual(await app.scheduler.tick(Date.parse(sch.body.nextRunAt) + 2000), [], 'claimed: runs once');
  await app.invocation.idle();

  const after = (await app.get(`/api/schedules?teammate=${archie.id}`)).body.schedules[0];
  assert.equal(after.lastStatus, 'completed');
  assert.equal(Date.parse(after.nextRunAt) - Date.parse(sch.body.nextRunAt), 86400000, 'next run moves to tomorrow');

  const timeline = (await app.get(`/api/timeline?teammate=${archie.id}`)).body;
  const parent = timeline.items.find((i) => i.workId === after.lastWorkId);
  const child = timeline.items.find((i) => i.delegatedFrom?.workId === parent.workId);
  assert.ok(parent && child, 'both appear, even when filtering by the Architect');
  assert.deepEqual([parent.schedule.name, parent.caller.type, parent.delegations[0].teammate.id], ['Weekly architecture review', 'schedule', dot.id]);
  assert.equal(child.teammate.id, dot.id);
  assert.deepEqual([child.delegatedFrom.teammate.id, child.caller.type, child.caller.name], [archie.id, 'teammate', 'Archie Stone']);
  assert.ok(parent.amount > 0 && child.amount > 0);
  assert.equal(parent.delegations[0].amount, child.amount);
  assert.equal(parent.totalAmount, Math.round((parent.amount + child.amount) * 100) / 100);
  // Dot tried to hand it back to Archie; the loop guard refused and Dot did the work.
  assert.deepEqual([child.tools[0].name, child.tools[0].status], ['delegate', 'error']);

  // Both teammates logged their own time, linked to each other through the work items.
  const archieWork = (await app.get(`/api/teammates/${archie.id}/work/${parent.workId}`)).body;
  assert.equal(archieWork.delegations[0].workId, child.workId);
  const dotEntry = (await app.get(`/api/teammates/${dot.id}`)).body.timesheet.entries.find((e) => e.workId === child.workId);
  assert.deepEqual([dotEntry.callerType, dotEntry.caller, dotEntry.costCentre], ['teammate', 'Archie Stone', 'Platform']);

  const completed = hooks.filter((h) => h.body.event === 'task.completed').map((h) => h.body.data);
  assert.deepEqual(completed.map((d) => d.teammate).sort(), [archie.id, dot.id].sort());
  assert.equal(completed.find((d) => d.teammate === archie.id).schedule.id, sch.body.id);

  // Paused schedules don't run; "Run now" does, and a paused teammate makes it fail visibly.
  await app.send('PATCH', `/api/schedules/${sch.body.id}`, { enabled: false });
  assert.deepEqual(await app.scheduler.tick(Date.now() + 30 * 86400000), []);
  await app.send('PATCH', `/api/teammates/${archie.id}`, { status: 'paused' });
  assert.equal((await app.send('POST', `/api/schedules/${sch.body.id}/run`)).status, 409);
  assert.equal((await app.send('DELETE', `/api/schedules/${sch.body.id}`)).status, 204);
});

test('timeline shows work across the team, waiting approvals and upcoming runs', async () => {
  const t = (await app.get('/api/timeline?days=7')).body;
  assert.equal(t.days, 7);
  assert.ok(t.items.length > 3);
  assert.ok(t.items.every((i, n) => n === 0 || t.items[n - 1].startedAt >= i.startedAt), 'newest first');
  assert.equal(t.totals.tasks, t.items.length);
  assert.ok(t.totals.delegations >= 1 && t.totals.toolCalls >= 1);
  assert.equal((await app.get('/api/timeline?teammate=nobody')).status, 404);
});
