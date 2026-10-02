// Tools a teammate may use while working: built-ins (fetch a web page, send a message) and the tools of MCP servers
// the owner has added. Each teammate has an allow-list (`tools` in TEAMMATE.md). Tools without side effects run
// straight away; tools with side effects are queued for a person to approve and run only then.
// Delegation to other teammates is also a tool, but lives in the invocation service because it runs a task.
import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError, notFound } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { McpClient } from './mcp.js';

const SERVERS_FILE = ['config', 'mcp-servers.md'];
const FETCH_TIMEOUT_MS = 10000;
const FETCH_MAX_BYTES = 300 * 1024;
const FETCH_MAX_CHARS = 20000;
const TOOL_LIST_TTL_MS = 60000;
const SERVER_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;

export const BUILTIN_TOOLS = {
  fetch_url: {
    label: 'Read web pages',
    help: 'Fetches a public http(s) page and returns its text. Private and local network addresses are blocked.',
    sideEffects: false,
    spec: {
      name: 'fetch_url',
      description: 'Fetch a public web page or JSON document over http(s) and return its text content (HTML is reduced to text, up to about 20,000 characters). Use it to read sources the task refers to.',
      input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Absolute http:// or https:// URL' } }, required: ['url'], additionalProperties: false },
    },
  },
  notify: {
    label: 'Send messages',
    help: 'Sends a message to the people outside the app, through webhooks subscribed to teammate.message. Every message waits for approval.',
    sideEffects: true,
    spec: {
      name: 'notify',
      description: 'Send a short message to the team outside this app (for example a channel or an inbox). A person approves each message before it is sent, so you will not see a reply.',
      input_schema: {
        type: 'object',
        properties: { subject: { type: 'string', description: 'One-line subject' }, message: { type: 'string', description: 'The message, in plain text or Markdown' } },
        required: ['subject', 'message'],
        additionalProperties: false,
      },
    },
  },
};

// ---------- Input checks ----------

/** Checks a tool input against the simple JSON Schemas used here (object, required, string/number/boolean/array). */
export function checkInput(schema, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object';
  for (const key of schema?.required ?? []) if (input[key] === undefined || input[key] === null || input[key] === '') return `Missing "${key}"`;
  for (const [key, value] of Object.entries(input)) {
    const prop = schema?.properties?.[key];
    if (!prop) {
      if (schema?.additionalProperties === false) return `Unknown field "${key}"`;
      continue;
    }
    const type = Array.isArray(prop.type) ? prop.type : [prop.type];
    const ok = !prop.type || type.some((t) => (t === 'integer' ? Number.isInteger(value) : t === 'array' ? Array.isArray(value) : t === 'null' ? value === null : typeof value === t));
    if (!ok) return `"${key}" must be ${type.join(' or ')}`;
    if (prop.enum && !prop.enum.includes(value)) return `"${key}" must be one of ${prop.enum.join(', ')}`;
  }
  return null;
}

// ---------- Network guard for fetch_url ----------

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return privateV4(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

const htmlToText = (html) =>
  html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();

export class ToolService {
  constructor({ store, webhooks = null, fetch = globalThis.fetch, lookup = (host) => dns.lookup(host, { all: true }), allowPrivateNetwork = false, log = console }) {
    this.store = store;
    this.webhooks = webhooks;
    this.fetch = fetch;
    this.lookup = lookup;
    this.allowPrivateNetwork = allowPrivateNetwork;
    this.log = log;
    this.toolCache = new Map(); // serverId -> { at, tools }
  }

  // ---------- MCP servers (owner-managed) ----------

  async servers() {
    return (await this.store.readDoc(SERVERS_FILE))?.data?.servers ?? [];
  }

  async listServers() {
    return (await this.servers()).map(({ headers, ...s }) => ({ ...s, hasAuth: Boolean(headers && Object.keys(headers).length) }));
  }

  async updateServers(fn) {
    let result;
    await this.store.updateDoc(SERVERS_FILE, (doc) => {
      const servers = doc?.data?.servers ?? [];
      result = fn(servers);
      return { data: { servers }, body: 'MCP servers teammates may be allowed to use (Streamable HTTP). Header values are secrets.' };
    });
    return result;
  }

  validateServer(input, servers, existing = null) {
    const errors = {};
    const out = {};
    if (!existing) {
      const id = String(input.id ?? '').trim().toLowerCase();
      if (!SERVER_ID.test(id)) errors.id = '1–24 lowercase letters, digits or dashes';
      else if (servers.some((s) => s.id === id)) errors.id = 'Another server has that id';
      else out.id = id;
    }
    if (!existing || input.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 60) errors.name = 'Use 1 to 60 characters';
      else out.name = name;
    }
    if (!existing || input.url !== undefined) {
      let ok = false;
      try {
        ok = ['http:', 'https:'].includes(new URL(input.url).protocol);
      } catch { /* invalid */ }
      if (!ok) errors.url = 'Enter the server’s http(s) MCP endpoint';
      else out.url = String(input.url).trim();
    }
    // `authorization` is write-only: a value sets the Authorization header, null removes it, empty keeps it.
    if (input.authorization !== undefined && input.authorization !== '') {
      out.headers = input.authorization === null ? {} : { Authorization: String(input.authorization).slice(0, 2000) };
    }
    if (input.enabled !== undefined) out.enabled = input.enabled !== false;
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please fix the highlighted fields', errors);
    return out;
  }

  async addServer(input) {
    const server = await this.updateServers((servers) => {
      const s = { ...this.validateServer(input, servers), enabled: true, createdAt: new Date().toISOString() };
      servers.push(s);
      return s;
    });
    return (await this.listServers()).find((s) => s.id === server.id);
  }

  async editServer(id, input) {
    const found = await this.updateServers((servers) => {
      const s = servers.find((x) => x.id === id);
      if (s) Object.assign(s, this.validateServer(input, servers, s));
      return Boolean(s);
    });
    if (!found) throw notFound('MCP server');
    this.toolCache.delete(id);
    return (await this.listServers()).find((s) => s.id === id);
  }

  async removeServer(id) {
    const removed = await this.updateServers((servers) => {
      const i = servers.findIndex((x) => x.id === id);
      return i === -1 ? null : servers.splice(i, 1)[0];
    });
    if (!removed) throw notFound('MCP server');
    this.toolCache.delete(id);
  }

  client(server) {
    return new McpClient({ url: server.url, headers: server.headers ?? {}, fetch: this.fetch });
  }

  /** The server's tools (cached for a minute). `fresh` skips the cache, e.g. for the "Check connection" button. */
  async serverTools(server, { fresh = false, signal } = {}) {
    const cached = this.toolCache.get(server.id);
    if (!fresh && cached && Date.now() - cached.at < TOOL_LIST_TTL_MS) return cached.tools;
    const tools = await (await this.client(server).connect(signal)).listTools(signal);
    this.toolCache.set(server.id, { at: Date.now(), tools });
    return tools;
  }

  async checkServer(id) {
    const server = (await this.servers()).find((s) => s.id === id);
    if (!server) throw notFound('MCP server');
    try {
      const tools = await this.serverTools(server, { fresh: true });
      return { ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description, readOnly: Boolean(t.annotations?.readOnlyHint) })) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ---------- What a teammate may use ----------

  /** Options for the allow-list editor: built-ins and enabled MCP servers. */
  async catalogue() {
    const servers = (await this.servers()).filter((s) => s.enabled !== false);
    return [
      ...Object.entries(BUILTIN_TOOLS).map(([id, t]) => ({ id, label: t.label, help: t.help, sideEffects: t.sideEffects })),
      ...servers.map((s) => ({ id: `mcp:${s.id}`, label: s.name, help: `MCP server · ${s.url}. Read-only tools run directly; anything else waits for approval.`, sideEffects: 'some' })),
    ];
  }

  async knownToolIds() {
    return new Set((await this.catalogue()).map((t) => t.id));
  }

  /**
   * Tool definitions for a teammate: `{ spec, sideEffects, label, run(input, signal) }`. MCP servers that can't be
   * reached are skipped (and logged) so a broken server never blocks the task.
   */
  async toolsFor(teammate, { signal } = {}) {
    const allowed = teammate.tools ?? [];
    const out = [];
    for (const id of allowed.filter((t) => BUILTIN_TOOLS[t])) {
      const t = BUILTIN_TOOLS[id];
      out.push({ spec: t.spec, label: t.label, sideEffects: t.sideEffects, run: (input) => this.runBuiltin(id, input, teammate) });
    }
    const servers = (await this.servers()).filter((s) => s.enabled !== false && allowed.includes(`mcp:${s.id}`));
    for (const server of servers) {
      let tools;
      try {
        tools = await this.serverTools(server, { signal });
      } catch (err) {
        this.log.warn?.(`[tools] MCP server ${server.id} unavailable: ${err.message}`);
        continue;
      }
      for (const tool of tools) {
        const name = `mcp__${server.id.replace(/-/g, '_')}__${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        const schema = tool.inputSchema?.type === 'object' ? tool.inputSchema : { type: 'object', properties: {} };
        out.push({
          spec: { name, description: `${tool.description ?? tool.name} (from ${server.name})`.slice(0, 1024), input_schema: schema },
          label: `${server.name}: ${tool.title ?? tool.name}`,
          sideEffects: !tool.annotations?.readOnlyHint,
          mcp: { server: server.id, tool: tool.name },
          run: (input, sig) => this.runMcp(server.id, tool.name, input, sig),
        });
      }
    }
    return out;
  }

  // ---------- Running tools ----------

  async runBuiltin(id, input, teammate, context = {}) {
    if (id === 'fetch_url') return this.fetchUrl(input.url);
    if (id === 'notify') {
      const data = { teammate: teammate.id, teammateName: teammate.name, subject: String(input.subject).slice(0, 200), message: String(input.message).slice(0, 8000), ...context };
      const results = (await this.webhooks?.emit('teammate.message', data)) ?? [];
      const delivered = results.filter((r) => r.ok).length;
      return { text: results.length ? `Sent to ${delivered} of ${results.length} webhook endpoint${results.length === 1 ? '' : 's'}.` : 'No webhook endpoint is subscribed to teammate.message, so the message was not sent anywhere.', isError: results.length > 0 && !delivered };
    }
    throw new HttpError(400, 'unknown_tool', `Unknown tool ${id}`);
  }

  async runMcp(serverId, toolName, input, signal) {
    const server = (await this.servers()).find((s) => s.id === serverId && s.enabled !== false);
    if (!server) return { text: `MCP server ${serverId} is no longer available.`, isError: true };
    const client = await this.client(server).connect(signal);
    return client.callTool(toolName, input, signal);
  }

  /**
   * Runs a queued action after a person approves it. The teammate must still be allowed the tool: if the owner
   * removed it from their allow-list (or disabled the MCP server) meanwhile, nothing runs and the outcome says why.
   */
  async runAction(approval, teammate) {
    const toolId = approval.mcp ? `mcp:${approval.mcp.server}` : approval.tool;
    if (!(teammate.tools ?? []).includes(toolId)) return { text: `${teammate.name} is no longer allowed to use ${approval.label ?? toolId}, so nothing was run.`, isError: true };
    if (approval.mcp) return this.runMcp(approval.mcp.server, approval.mcp.tool, approval.input);
    return this.runBuiltin(approval.tool, approval.input, teammate, { workId: approval.workId, approvedBy: approval.decidedBy });
  }

  async checkHost(url) {
    if (this.allowPrivateNetwork) return;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await this.lookup(host);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error(`${host} is a private or local address, which teammates can't reach`);
  }

  async fetchUrl(raw) {
    let url;
    try {
      url = new URL(String(raw));
    } catch {
      return { text: 'That is not a valid URL.', isError: true };
    }
    try {
      for (let hop = 0; hop < 4; hop++) {
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs can be fetched');
        await this.checkHost(url);
        const res = await this.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'Teammates/1 (fetch_url tool)', Accept: 'text/html, text/plain, application/json, */*;q=0.5' } });
        if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
          url = new URL(res.headers.get('location'), url);
          continue;
        }
        const type = res.headers.get('content-type') ?? '';
        if (!/^(text\/|application\/(json|xml|xhtml|ld\+json|rss|atom))/.test(type) && type) throw new Error(`Can't read ${type.split(';')[0]} content`);
        const reader = res.body?.getReader?.();
        let bytes = 0;
        const chunks = [];
        if (reader) {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
            bytes += value.length;
            if (bytes > FETCH_MAX_BYTES) {
              await reader.cancel();
              break;
            }
          }
        }
        let text = reader ? Buffer.concat(chunks).toString('utf8') : await res.text();
        if (/html/.test(type) || /^\s*<!doctype html|^\s*<html/i.test(text)) text = htmlToText(text);
        const clipped = text.length > FETCH_MAX_CHARS ? `${text.slice(0, FETCH_MAX_CHARS)}\n\n[Truncated]` : text;
        return { text: `HTTP ${res.status} ${url.href}\n\n${clipped}`, isError: !res.ok };
      }
      throw new Error('Too many redirects');
    } catch (err) {
      return { text: `Could not fetch ${url.href}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`, isError: true };
    }
  }
}

export const newActionId = () => newId('act');
