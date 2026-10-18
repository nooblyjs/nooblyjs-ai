// controllers/tools.js and tool use in tasks: allow-listed tools, approval for side effects, MCP servers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';
import { startMcp } from '../fixtures/mcp.js';

// Recorded webhooks, a fake public web page and the tiny MCP server.
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
let mcp;
let mcpUrl;
let mcpCalls;
before(async () => {
  mcp = await startMcp();
  ({ url: mcpUrl, calls: mcpCalls } = mcp);
  app = await startApp({ fetch: fakeFetch });
  await app.send('POST', '/api/v1/webhooks', { name: 'Everything', url: 'https://hooks.example.com/all', events: ['task.completed', 'task.failed', 'approval.requested', 'action.requested', 'teammate.message'] });
});
after(() => {
  app.close();
  mcp.close();
});

test('allow-listed tools: fetch_url runs, private addresses are refused, every call is logged', async () => {
  assert.equal((await app.send('PATCH', '/api/v1/teammates/wren-sato', { tools: ['nope'] })).body.error.details.tools, 'Unknown tool');
  await app.send('PATCH', '/api/v1/teammates/wren-sato', { tools: ['fetch_url'] });
  const r = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Summarise the pricing at http://93.184.216.34/pricing' });
  assert.equal(r.status, 200);
  const [call] = r.body.toolCalls;
  assert.deepEqual([call.name, call.status], ['fetch_url', 'ok']);
  assert.match(call.output, /Pro plan is \$49 a month/);
  assert.doesNotMatch(call.output, /evil|<p>/, 'scripts and tags are stripped');
  assert.match(r.body.output, /Pro plan is \$49/);
  const work = (await app.get(`/api/v1/teammates/wren-sato/work/${r.body.workId}`)).body;
  assert.equal(work.toolCalls[0].name, 'fetch_url');

  const blocked = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Read http://127.0.0.1:9/admin please' });
  assert.equal(blocked.body.toolCalls[0].status, 'error');
  assert.match(blocked.body.toolCalls[0].output, /private or local address/);
  // Without the tool on the allow-list, the model is never offered it.
  await app.send('PATCH', '/api/v1/teammates/wren-sato', { tools: [] });
  assert.deepEqual((await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Look at http://93.184.216.34/pricing' })).body.toolCalls, []);
});

test('side-effect tools wait for approval; approval runs them, and only while still allowed', async () => {
  await app.send('PATCH', '/api/v1/teammates/pip-okafor', { tools: ['notify'] });
  hooks.length = 0;
  const r = await app.send('POST', '/api/v1/teammates/pip-okafor/tasks', { task: 'Notify the team that the rota is published' });
  const [call] = r.body.toolCalls;
  assert.equal(call.status, 'queued');
  assert.ok(hooks.some((h) => h.body.event === 'action.requested' && h.body.data.approval === call.approvalId));
  assert.ok(!hooks.some((h) => h.body.event === 'teammate.message'), 'nothing is sent before approval');

  const pending = (await app.get('/api/v1/approvals?status=pending')).body.approvals.find((a) => a.id === call.approvalId);
  assert.deepEqual([pending.kind, pending.tool, pending.workId], ['action', 'notify', r.body.workId]);
  const approved = await app.send('POST', `/api/v1/approvals/${call.approvalId}/approve`);
  assert.deepEqual([approved.status, approved.body.outcome], [202, 'completed']);
  const message = hooks.find((h) => h.body.event === 'teammate.message');
  assert.equal(message.body.data.teammate, 'pip-okafor');
  assert.equal(message.body.data.approvedBy, 'Stevie');
  const work = (await app.get(`/api/v1/teammates/pip-okafor/work/${r.body.workId}`)).body;
  assert.equal(work.toolCalls[0].status, 'approved');

  // Taken off the allow-list before approval: nothing runs, and the outcome says why.
  const again = await app.send('POST', '/api/v1/teammates/pip-okafor/tasks', { task: 'Notify the team about Friday' });
  await app.send('PATCH', '/api/v1/teammates/pip-okafor', { tools: [] });
  hooks.length = 0;
  const refused = await app.send('POST', `/api/v1/approvals/${again.body.toolCalls[0].approvalId}/approve`);
  assert.equal(refused.body.outcome, 'failed');
  assert.match(refused.body.output, /no longer allowed/);
  assert.ok(!hooks.some((h) => h.body.event === 'teammate.message'));
  const declinedTask = await app.send('POST', '/api/v1/teammates/milo-brightwater/tasks', { task: 'hello' });
  assert.equal(declinedTask.body.toolCalls.length, 0);
});

test('MCP servers: read-only tools run, others wait for approval', async () => {
  const bad = await app.send('POST', '/api/v1/mcp-servers', { id: 'Bad Id', name: '', url: 'ftp://x' });
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['id', 'name', 'url']);
  const added = await app.send('POST', '/api/v1/mcp-servers', { id: 'crm', name: 'CRM', url: mcpUrl, authorization: 'Bearer secret-token' });
  assert.deepEqual([added.status, added.body.hasAuth, added.body.headers], [201, true, undefined]);
  const check = await app.send('POST', '/api/v1/mcp-servers/crm/check');
  assert.deepEqual(check.body.tools.map((t) => [t.name, t.readOnly]), [['lookup_account', true], ['create_contact', false]]);
  assert.ok((await app.get('/api/v1/tools')).body.tools.some((t) => t.id === 'mcp:crm'));

  await app.send('PATCH', '/api/v1/teammates/wren-sato', { tools: ['mcp:crm'] });
  mcpCalls.length = 0;
  const read = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Please lookup_account for Acme' });
  assert.deepEqual([read.body.toolCalls[0].name, read.body.toolCalls[0].status], ['mcp__crm__lookup_account', 'ok']);
  assert.deepEqual(mcpCalls.map((c) => [c.name, c.session]), [['lookup_account', 'sess-1']]);

  const write = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'create_contact for Jane at Acme' });
  assert.equal(write.body.toolCalls[0].status, 'queued');
  assert.equal(mcpCalls.length, 1, 'not called before approval');
  const ok = await app.send('POST', `/api/v1/approvals/${write.body.toolCalls[0].approvalId}/approve`);
  assert.equal(ok.body.outcome, 'completed');
  assert.deepEqual(mcpCalls.at(-1).name, 'create_contact');
  await app.send('PATCH', '/api/v1/teammates/wren-sato', { tools: [] });
});
