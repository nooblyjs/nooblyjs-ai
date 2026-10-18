// @ts-check
// Phase F16: a small MCP SERVER over stdio. The other half of the harness's MCP client (harness Phase 14).
//
// MCP is JSON-RPC 2.0, one message per line:
//
//   → {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18",…}}
//   ← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{…}}}
//   → {"jsonrpc":"2.0","method":"notifications/initialized"}          (a notification: no id, no reply)
//   → {"jsonrpc":"2.0","id":2,"method":"tools/list"}
//   ← {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name","description","inputSchema","annotations"}]}}
//   → {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_spec","arguments":{…}}}
//   ← {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"…"}],"isError":false}}
//
// A tool that fails returns isError: true (the model reads it and adapts). A protocol
// mistake (unknown method, bad JSON) is a JSON-RPC error. stdout is the protocol:
// anything else we want to say goes to stderr.
import readline from 'node:readline';

export const PROTOCOL_VERSION = '2025-06-18';

/**
 * @param {{ name: string, version: string, tools: Array<{ name: string, description: string, inputSchema: object, readOnly?: boolean, handle: (ctx: any, input: any) => any }>, ctx: any,
 *           input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} options
 * @returns {Promise<void>} resolves when the input ends
 */
export function serveMcp({ name, version, tools, ctx, input = process.stdin, output = process.stdout }) {
  const send = (msg) => output.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function handle(msg) {
    switch (msg.method) {
      case 'initialize':
        return { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name, version } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: Boolean(t.readOnly) } })) };
      case 'tools/call': {
        const tool = byName.get(msg.params?.name);
        if (!tool) return { content: [{ type: 'text', text: `No tool "${msg.params?.name}".` }], isError: true };
        try {
          const out = await tool.handle(ctx, msg.params?.arguments ?? {});
          return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }], isError: false };
        } catch (error) {
          return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
      default:
        throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
    }
  }

  const lines = readline.createInterface({ input });
  const pending = [];
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (msg.id === undefined || msg.id === null) return; // a notification: nothing to answer
    pending.push(
      handle(msg).then(
        (result) => send({ id: msg.id, result }),
        (error) => send({ id: msg.id, error: { code: error.code ?? -32603, message: error.message } }),
      ),
    );
  });
  return new Promise((resolve) => lines.on('close', () => Promise.all(pending).then(() => resolve())));
}
