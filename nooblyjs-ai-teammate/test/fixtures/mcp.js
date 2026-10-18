// A tiny MCP server (Streamable HTTP, JSON replies) with one read-only tool (lookup_account) and one with side
// effects (create_contact). `calls` records every tools/call it answers.
import express from 'express';

export function startMcp() {
  const calls = [];
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
      calls.push({ name: params.name, args: params.arguments, session: req.get('mcp-session-id') });
      return reply({ content: [{ type: 'text', text: `${params.name} ok: Acme Corp, 120 seats` }] });
    }
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  });
  return new Promise((resolve) => {
    const server = a.listen(0, () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/mcp`, calls, close: () => server.close() });
    });
  });
}
