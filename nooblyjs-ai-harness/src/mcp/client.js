// Phase 14: an MCP client. MCP (Model Context Protocol) is a standard way to
// plug tools into ANY AI harness: someone writes a "server" once (for GitHub,
// a database, a browser…) and every harness that speaks MCP can use it.
//
// The simplest transport is stdio: we start the server as a child process and
// talk JSON-RPC 2.0 over its stdin/stdout, one JSON object per line.
//
//   → {"jsonrpc":"2.0","id":1,"method":"initialize","params":{…}}      a REQUEST (has an id)
//   ← {"jsonrpc":"2.0","id":1,"result":{…}}                            its RESPONSE (same id)
//   → {"jsonrpc":"2.0","method":"notifications/initialized"}           a NOTIFICATION (no id, no reply)
//
// Requests and responses are matched by id, so several can be in flight at once.
// The conversation always starts with a handshake:
//   initialize → notifications/initialized → tools/list → (tools/call …)
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 60_000;

export class McpClient {
  /**
   * @param {{ name: string, command: string, args?: string[], env?: object, cwd?: string, clientVersion?: string }} options
   */
  constructor({ name, command, args = [], env = {}, cwd = process.cwd(), clientVersion = '0.0.0' }) {
    Object.assign(this, { name, command, args, env, cwd, clientVersion });
    this.nextId = 1;
    this.pending = new Map(); // id → { resolve, reject, timer }
    this.stderr = ''; // the last bit of the server's error output, for error messages
    this.exited = false;
    this.serverInfo = null;
  }

  /** Start the server and do the handshake. Throws if either fails. */
  async start({ timeoutMs = 30_000 } = {}) {
    this.child = spawn(this.command, this.args, { cwd: this.cwd, env: { ...process.env, ...this.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => {}); // writing to a dead server: handled by 'exit' below
    this.child.stderr.on('data', (chunk) => (this.stderr = (this.stderr + chunk).slice(-2000)));

    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', (line) => this.#onLine(line));

    const failAll = (message) => {
      this.exited = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(message));
      }
      this.pending.clear();
    };
    this.child.on('error', (error) => failAll(`MCP server "${this.name}" could not start: ${error.message}`));
    this.child.on('exit', (code, signal) => {
      const why = signal ? `was killed (${signal})` : `exited with code ${code}`;
      failAll(`MCP server "${this.name}" ${why}${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').at(-1)}` : ''}`);
    });

    const init = await this.request(
      'initialize',
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'noobly', version: this.clientVersion } },
      { timeoutMs },
    );
    this.serverInfo = init.serverInfo ?? null;
    this.protocolVersion = init.protocolVersion;
    this.notify('notifications/initialized');
    return init;
  }

  /** Send a request and wait for the response with the same id. */
  request(method, params, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
    if (this.exited) return Promise.reject(new Error(`MCP server "${this.name}" is not running.`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' });
        reject(new Error(`MCP server "${this.name}" did not answer ${method} within ${timeoutMs / 1000}s.`));
      }, timeoutMs);
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.delete(id)) return;
          clearTimeout(timer);
          this.notify('notifications/cancelled', { requestId: id, reason: 'interrupted' });
          reject(new Error('Interrupted by user.'));
        },
        { once: true },
      );
      this.pending.set(id, { resolve, reject, timer });
      this.#send({ jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) });
    });
  }

  /** A message that expects no answer. */
  notify(method, params) {
    if (!this.exited) this.#send({ jsonrpc: '2.0', method, ...(params !== undefined && { params }) });
  }

  /** Every tool the server offers (following pagination). */
  async listTools() {
    const tools = [];
    let cursor;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {});
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /** Run a tool. Returns the MCP result: { content: [...], isError? }. */
  callTool(name, args, options) {
    return this.request('tools/call', { name, arguments: args ?? {} }, options);
  }

  close() {
    if (!this.child || this.exited) return;
    this.exited = true;
    this.child.stdin.end();
    this.child.kill();
  }

  #send(message) {
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  #onLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // servers sometimes print logs to stdout by mistake; ignore non-JSON
    }
    // A request FROM the server (e.g. "ping"). We support none, but must answer.
    if (message.method && message.id !== undefined) {
      const result = message.method === 'ping' ? { result: {} } : { error: { code: -32601, message: `noobly does not support ${message.method}` } };
      this.#send({ jsonrpc: '2.0', id: message.id, ...result });
      return;
    }
    const waiting = this.pending.get(message.id);
    if (!waiting) return; // a notification, or a response we gave up on
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
    else waiting.resolve(message.result ?? {});
  }
}
