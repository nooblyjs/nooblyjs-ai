#!/usr/bin/env node
// A toy MCP server for tests and for trying Phase 14 (about 60 lines).
// Writing one teaches the protocol from the other side: read JSON-RPC lines
// on stdin, answer on stdout. Tools: echo (read-only), add, crash, slow.
import readline from 'node:readline';

const TOOLS = [
  { name: 'echo', description: 'Repeat the given text', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'add', description: 'Add two numbers',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'crash', description: 'Exit in the middle of a call (to test error handling)', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: 'Answer after `ms` milliseconds', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } },
];

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const text = (value, isError = false) => ({ content: [{ type: 'text', text: String(value) }], ...(isError && { isError: true }) });

function callTool({ name, arguments: args = {} }) {
  if (name === 'echo') return text(args.text);
  if (name === 'add') {
    if (typeof args.a !== 'number' || typeof args.b !== 'number') return text('a and b must be numbers', true);
    return text(args.a + args.b);
  }
  if (name === 'crash') process.exit(3);
  if (name === 'slow') return new Promise((resolve) => setTimeout(() => resolve(text(`waited ${args.ms ?? 100}ms`)), args.ms ?? 100));
  return null;
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const { id, method, params } = message;
  if (id === undefined) return; // a notification: nothing to answer
  if (method === 'initialize') {
    return send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo-mcp', version: '1.0.0' } } });
  }
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const result = await callTool(params);
    if (!result) return send({ id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
    return send({ id, result });
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
});
