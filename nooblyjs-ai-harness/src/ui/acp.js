// Phase 30: the Agent Client Protocol (ACP). noobly inside an editor.
//
// The agent loop never cared where the user is: the Ink UI (Phase 02), print
// mode and the library (Phase 17) all just consume its events. ACP is one more
// front-end: an EDITOR (e.g. Zed) starts `noobly acp` and talks JSON-RPC 2.0
// over stdin/stdout, one JSON message per line:
//
//   editor → noobly   initialize · session/new · session/prompt · session/cancel
//   noobly → editor   session/update (notifications: text, thoughts, tool calls, the plan)
//                     session/request_permission (a request: the editor asks you)
//
// stdout belongs to the protocol: anything else printed there would corrupt it,
// so notes go to stderr.
import readline from 'node:readline';
import { createSession } from '../core/create-session.js';
import { EVENT } from '../core/events.js';

export const PROTOCOL_VERSION = 1;

// What kind of tool call this is, in ACP's vocabulary (editors pick an icon from it).
const KINDS = { Read: 'read', Glob: 'search', Grep: 'search', RepoMap: 'search', Edit: 'edit', MultiEdit: 'edit', Write: 'edit', ApplyPatch: 'edit', Bash: 'execute', TaskOutput: 'read', TaskStop: 'execute', WebFetch: 'fetch', WebSearch: 'fetch', TodoWrite: 'think', Task: 'think' };
const STOP_REASONS = { end_turn: 'end_turn', max_tokens: 'max_tokens', max_turns: 'max_turn_requests', refusal: 'refusal' };

/**
 * Serve ACP on a pair of streams.
 * @param {{ input: NodeJS.ReadableStream, output: NodeJS.WritableStream, makeSession: (cwd: string) => Promise<object>, version?: string, log?: (text: string) => void }} options
 * @returns {Promise<void>} resolves when the input ends
 */
export function serveAcp({ input, output, makeSession, version = '0.0.0', log = () => {} }) {
  const sessions = new Map(); // sessionId → { session, controller }
  const waiting = new Map(); // id of OUR request → resolve
  let nextId = 1;
  let nextSession = 1;

  const send = (message) => output.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const notify = (method, params) => send({ method, params });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = `noobly-${nextId++}`;
      waiting.set(id, resolve);
      send({ id, method, params });
    });
  const update = (sessionId, update) => notify('session/update', { sessionId, update });

  const methods = {
    initialize: () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: true } },
      agentInfo: { name: 'noobly', version },
      authMethods: [],
    }),

    'session/new': async ({ cwd }) => {
      const session = await makeSession(cwd);
      const sessionId = `sess-${nextSession++}`;
      // The editor answers permission questions: the gate's "ask" becomes a request to it.
      session.requestPermission = async ({ tool, input: toolInput, summary, suggestion, toolUseId, signal }) => {
        const answer = request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: toolUseId ?? `perm-${nextId}`, title: `${tool.name}(${summary})`, kind: KINDS[tool.name] ?? 'other', rawInput: toolInput },
          options: [
            { optionId: 'allow_once', name: 'Yes', kind: 'allow_once' },
            { optionId: 'allow_always', name: suggestion.label, kind: 'allow_always' },
            { optionId: 'reject_once', name: 'No', kind: 'reject_once' },
          ],
        });
        const aborted = new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ outcome: { outcome: 'cancelled' } }), { once: true }));
        const { outcome } = await Promise.race([answer, aborted]);
        if (outcome?.outcome !== 'selected' || outcome.optionId === 'reject_once') return { behavior: 'deny', reason: `The user declined this ${tool.name} call in the editor.` };
        return { behavior: outcome.optionId === 'allow_always' ? 'allowAlways' : 'allow' };
      };
      sessions.set(sessionId, { session, controller: null });
      return { sessionId };
    },

    'session/prompt': async ({ sessionId, prompt }) => {
      const entry = sessions.get(sessionId);
      if (!entry) throw rpcError(-32602, `Unknown sessionId ${sessionId}`);
      if (entry.controller) throw rpcError(-32600, 'A prompt is already running in this session.');
      const controller = (entry.controller = new AbortController());
      try {
        let end = null;
        for await (const event of entry.session.stream(promptText(prompt), { signal: controller.signal })) {
          const u = toUpdate(event, entry.session);
          if (u) update(sessionId, u);
          if (event.type === EVENT.TURN_END) end = event;
        }
        return { stopReason: end?.interrupted || controller.signal.aborted ? 'cancelled' : (STOP_REASONS[end?.stopReason] ?? 'end_turn') };
      } finally {
        entry.controller = null;
      }
    },

    'session/cancel': ({ sessionId }) => {
      sessions.get(sessionId)?.controller?.abort();
    },
  };

  async function handle(message) {
    if (message.id !== undefined && !message.method) {
      // An answer to one of OUR requests (a permission question).
      waiting.get(message.id)?.(message.result ?? { outcome: { outcome: 'cancelled' } });
      waiting.delete(message.id);
      return;
    }
    const method = methods[message.method];
    try {
      if (!method) throw rpcError(-32601, `Method not found: ${message.method}`);
      const result = await method(message.params ?? {});
      if (message.id !== undefined) send({ id: message.id, result: result ?? null });
    } catch (error) {
      log(`acp: ${message.method} failed: ${error.message}`);
      if (message.id !== undefined) send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
    }
  }

  const lines = readline.createInterface({ input });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    handle(message); // not awaited: a prompt runs while permission answers and cancels keep arriving
  });
  return new Promise((resolve) => lines.on('close', () => {
    for (const { controller } of sessions.values()) controller?.abort();
    resolve();
  }));
}

/** An editor's prompt (content blocks) → the text noobly sends. Attached files become tagged sections. */
export function promptText(blocks = []) {
  return blocks
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'resource' && block.resource?.text !== undefined) return `<file uri="${block.resource.uri}">\n${block.resource.text}\n</file>`;
      if (block.type === 'resource_link') return `(See ${block.uri})`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** One loop event → one ACP session update (or nothing). */
export function toUpdate(event, session) {
  switch (event.type) {
    case EVENT.TEXT_DELTA:
      return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: event.text } };
    case EVENT.THINKING_DELTA:
      return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: event.text } };
    case EVENT.TOOL_START:
      return { sessionUpdate: 'tool_call', toolCallId: event.id, title: `${event.name}(${event.summary})`, kind: KINDS[event.name] ?? 'other', status: 'in_progress', rawInput: event.input };
    case EVENT.TOOL_END:
      if (event.name === 'TodoWrite') return { sessionUpdate: 'plan', entries: session.todos.map((t) => ({ content: t.content, priority: 'medium', status: t.status })) };
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.id,
        status: event.isError ? 'failed' : 'completed',
        content: [{ type: 'content', content: { type: 'text', text: typeof event.content === 'string' ? event.content.slice(0, 4_000) : (event.display ?? '') } }],
      };
    case EVENT.NOTICE:
      return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `\n_${event.text}_\n` } };
    default:
      return null;
  }
}

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** `noobly acp`: sessions made the same way as the CLI's, answering on stdout. */
export async function runAcp({ flags = {}, version }) {
  const log = (text) => process.stderr.write(`${text}\n`);
  await serveAcp({
    input: process.stdin,
    output: process.stdout,
    version,
    log,
    makeSession: (cwd) => createSession({ cwd, flags, clientVersion: version, applyEnv: true, onWarning: log }),
  });
}
