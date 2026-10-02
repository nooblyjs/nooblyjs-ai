// Minimal MCP client for the Streamable HTTP transport: JSON-RPC 2.0 over POST, answered with JSON or an SSE stream.
// Enough for tools: initialize, tools/list (paged) and tools/call. No dependency on the MCP SDK.
const PROTOCOL = '2025-06-18';
const TIMEOUT_MS = 20000;

export class McpError extends Error {}

export class McpClient {
  constructor({ url, headers = {}, fetch = globalThis.fetch }) {
    this.url = url;
    this.headers = headers;
    this.fetch = fetch;
    this.sessionId = null;
    this.nextId = 1;
  }

  async post(message, signal) {
    const headers = {
      ...this.headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL,
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
    };
    const res = await this.fetch(this.url, {
      method: 'POST', headers, body: JSON.stringify(message), redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    const session = res.headers?.get?.('mcp-session-id');
    if (session) this.sessionId = session;
    return res;
  }

  /** One JSON-RPC request. Reads a JSON body, or the SSE stream until the response with our id arrives. */
  async request(method, params = {}, signal) {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, signal);
    if (!res.ok) throw new McpError(`MCP server answered HTTP ${res.status} to ${method}`);
    const type = res.headers?.get?.('content-type') ?? '';
    let reply;
    if (type.includes('text/event-stream')) {
      const text = await res.text();
      for (const event of text.split(/\r?\n\r?\n/)) {
        const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try {
          const msg = JSON.parse(data);
          if (msg.id === id) reply = msg;
        } catch { /* ignore non-JSON events */ }
      }
    } else {
      reply = await res.json();
      if (Array.isArray(reply)) reply = reply.find((m) => m.id === id);
    }
    if (!reply) throw new McpError(`No answer to ${method} from the MCP server`);
    if (reply.error) throw new McpError(reply.error.message ?? `MCP error ${reply.error.code}`);
    return reply.result;
  }

  async connect(signal) {
    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'teammates', version: '1.0.0' } }, signal);
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal).catch(() => {});
    return this;
  }

  async listTools(signal) {
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {}, signal);
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  /** Calls a tool and flattens its content to text. */
  async callTool(name, args, signal) {
    const result = await this.request('tools/call', { name, arguments: args ?? {} }, signal);
    const text = (result?.content ?? [])
      .map((c) => (c.type === 'text' ? c.text : c.type === 'resource' ? c.resource?.text ?? `[resource ${c.resource?.uri}]` : `[${c.type} content]`))
      .join('\n');
    return { text: text || (result?.structuredContent ? JSON.stringify(result.structuredContent) : ''), isError: Boolean(result?.isError) };
  }
}
