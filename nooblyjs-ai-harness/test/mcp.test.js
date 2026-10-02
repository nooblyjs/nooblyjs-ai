// Phase 14: the MCP client, against the toy server in test/fixtures/echo-mcp.js.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { contentToText, mcpToolName } from '../src/mcp/adapter.js';
import { McpClient } from '../src/mcp/client.js';
import { connectMcpServers, loadMcpConfig } from '../src/mcp/index.js';
import { createPermissions, decide } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { makeProject } from './helpers.js';

const SERVER = fileURLToPath(new URL('./fixtures/echo-mcp.js', import.meta.url));
const echoServer = { command: process.execPath, args: [SERVER] };

const open = [];
after(() => open.forEach((mcp) => mcp.close()));
async function connect(servers) {
  const mcp = await connectMcpServers(servers, { cwd: process.cwd(), timeoutMs: 5000 });
  open.push(mcp);
  return mcp;
}

test('handshake, tools/list and tools/call against a real (toy) server', async () => {
  const client = new McpClient({ name: 'echo', ...echoServer });
  try {
    const init = await client.start();
    assert.equal(init.serverInfo.name, 'echo-mcp');
    const tools = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['echo', 'add', 'crash', 'slow']);
    assert.deepEqual(await client.callTool('add', { a: 2, b: 3 }), { content: [{ type: 'text', text: '5' }] });
    // Several requests in flight at once are matched by id, whatever order the answers come in.
    const [slow, fast] = await Promise.all([client.callTool('slow', { ms: 150 }), client.callTool('echo', { text: 'quick' })]);
    assert.equal(slow.content[0].text, 'waited 150ms');
    assert.equal(fast.content[0].text, 'quick');
    await assert.rejects(client.request('nonsense/method'), /MCP error -32601/);
  } finally {
    client.close();
  }
});

test('MCP tools become normal tools: mcp__<server>__<tool>, read-only only when the server says so', async () => {
  const mcp = await connect({ echo: echoServer });
  assert.equal(mcp.servers[0].status, 'connected');
  const tools = new ToolRegistry(mcp.tools);
  assert.deepEqual(tools.list().map((t) => [t.name, t.isReadOnly]), [
    ['mcp__echo__echo', true],
    ['mcp__echo__add', false],
    ['mcp__echo__crash', false],
    ['mcp__echo__slow', true],
  ]);
  assert.equal((await tools.get('mcp__echo__echo').call({ text: 'hi' }, {})).content, 'hi');
  // A tool error (isError: true) becomes an error the model can read.
  await assert.rejects(tools.get('mcp__echo__add').call({ a: 'x', b: 1 }, {}), /a and b must be numbers/);
});

test('in the agent loop: permission rules match mcp__ names, and a server crash mid-call is an error result', async () => {
  const mcp = await connect({ echo: echoServer });
  const provider = createMockProvider([
    { tools: [{ name: 'mcp__echo__echo', input: { text: 'read-only: no question' } }, { name: 'mcp__echo__add', input: { a: 1, b: 2 } }] },
    { tools: [{ name: 'mcp__echo__crash', input: {} }] },
    { tools: [{ name: 'mcp__echo__echo', input: { text: 'after the crash' } }] },
    { text: 'Done.' },
  ]);
  const session = new Session({ provider, tools: new ToolRegistry(mcp.tools), retry: { maxRetries: 0 }, permissions: createPermissions({ allow: ['mcp__echo__*'] }) });
  await session.send('use the tools');

  const results = (n) => provider.requests[n].messages.at(-1).content;
  assert.deepEqual(results(1).map((r) => r.content), ['read-only: no question', '3']);
  assert.equal(results(2)[0].is_error, true);
  assert.match(results(2)[0].content, /MCP tool crash \(server "echo"\) failed: MCP server "echo" exited with code 3/);
  assert.match(results(3)[0].content, /not running/);
});

test('without an allow rule, a non-read-only MCP tool asks', async () => {
  const mcp = await connect({ echo: echoServer });
  const session = new Session({ provider: createMockProvider([]), tools: new ToolRegistry(mcp.tools) });
  const add = session.tools.get('mcp__echo__add');
  assert.equal(decide(session, add, { a: 1, b: 2 }).behavior, 'ask');
  session.permissions = createPermissions({ deny: ['mcp__echo__*'] });
  assert.equal(decide(session, session.tools.get('mcp__echo__echo'), { text: 'x' }).behavior, 'deny');
});

test('a server that fails to start is reported, not fatal; /mcp shows both', async () => {
  const mcp = await connect({ echo: echoServer, broken: { command: 'definitely-not-a-real-command-xyz' }, dies: { command: process.execPath, args: ['-e', 'process.exit(1)'] } });
  assert.deepEqual(mcp.servers.map((s) => s.status), ['connected', 'failed', 'failed']);
  assert.match(mcp.servers[1].error, /could not start/);
  assert.match(mcp.servers[2].error, /exited with code 1/);
  assert.equal(mcp.tools.length, 4);

  const session = new Session({ provider: createMockProvider([]) });
  session.mcp = mcp;
  const { text } = await runCommand('/mcp', session);
  assert.match(text, /● echo .*connected, 4 tool\(s\)/);
  assert.match(text, /✗ broken .*failed/);
});

test('calls time out, and an interrupt cancels a call', async () => {
  const client = new McpClient({ name: 'echo', ...echoServer });
  await client.start();
  try {
    await assert.rejects(client.callTool('slow', { ms: 2000 }, { timeoutMs: 100 }), /did not answer tools\/call within 0.1s/);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(client.callTool('slow', { ms: 2000 }, { signal: controller.signal }), /Interrupted/);
  } finally {
    client.close();
  }
});

test('mcp.json: "servers" or "mcpServers", per scope; bad entries are warned about', async () => {
  const cwd = await makeProject({
    '.noobly/mcp.json': JSON.stringify({ mcpServers: { git: { command: 'uvx', args: ['mcp-server-git'] }, bad: { args: [] } } }),
    'home/mcp.json': JSON.stringify({ servers: { mine: { command: 'node' } } }),
  });
  const config = loadMcpConfig(cwd, { env: { NOOBLY_HOME: path.join(cwd, 'home') } });
  assert.deepEqual(Object.keys(config.project), ['git']);
  assert.deepEqual(Object.keys(config.user), ['mine']);
  assert.match(config.warnings[0], /"bad" has no "command"/);
});

test('names and content are converted for the model', () => {
  assert.equal(mcpToolName('my server', 'get.file'), 'mcp__my_server__get_file');
  assert.equal(contentToText([{ type: 'text', text: 'a' }, { type: 'image', mimeType: 'image/png', data: '…' }]), 'a\n[image (image/png) not shown]');
});
