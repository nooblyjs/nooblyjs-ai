// Library entry point: use the harness from your own Node code, no CLI needed.
//
// Phase 17: the same loop, a different front-end. The simplest way in:
//
//   import { query } from 'nooblyjs-learn-harness';
//   for await (const event of query({ prompt: 'List the TODOs', options: { permissionMode: 'plan' } })) {
//     if (event.type === 'text_delta') process.stdout.write(event.text);
//   }
//
// Or keep a session for several turns:
//
//   const session = await createSession({ cwd, model: 'claude-opus-5-5' });
//   const first = await session.send('What does src/cli.js do?');     // → the turn_end event
//   const second = await session.send('And src/index.js?');           // same conversation
import { createSession as createFullSession } from './core/create-session.js';
import { loadSettings } from './config/settings.js';

/**
 * Options for query() and createSession(), with library-friendly names:
 * @typedef {Object} QueryOptions
 * @property {string} [cwd]                 project folder (default process.cwd())
 * @property {string | object} [provider]   a provider id ('anthropic', 'openai', 'grok', 'ollama', 'echo') or a provider object
 * @property {string} [model]
 * @property {'default'|'acceptEdits'|'plan'|'bypass'} [permissionMode]  unattended code usually wants 'plan' or explicit allowedTools
 * @property {string[]} [allowedTools]      permission rules that never ask, e.g. ['Read', 'Bash(npm test:*)']
 * @property {string[]} [disallowedTools]   permission rules that always deny
 * @property {number} [maxTurns]
 * @property {object} [settings]            any other settings (same names as settings.json)
 * @property {boolean} [transcript]         save the conversation under ~/.noobly (default false for the library)
 * @property {boolean} [mcp]                start MCP servers from mcp.json files (default false for the library)
 * @property {(request) => Promise<object>} [requestPermission]  answer "ask" questions yourself (default: deny)
 * @property {object[]} [tools]             extra tools (see defineTool)
 * @property {AbortSignal} [signal]         abort to interrupt (query only)
 */

/** A Session, ready to use. Nobody is there to answer questions, so "ask" means no unless you pass requestPermission. */
export async function createSession(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const flags = { ...options.settings };
  if (typeof options.provider === 'string') flags.provider = options.provider;
  if (options.model) flags.model = options.model;
  if (options.maxTurns) flags.maxTurns = options.maxTurns;
  flags.permissions = {
    ...flags.permissions,
    ...(options.permissionMode && { defaultMode: options.permissionMode }),
    allow: [...(flags.permissions?.allow ?? []), ...(options.allowedTools ?? [])],
    deny: [...(flags.permissions?.deny ?? []), ...(options.disallowedTools ?? [])],
  };
  // In code, "bypass" is an explicit choice (like the --dangerously-skip-permissions flag), so allow it.
  const settingsInfo = loadSettings({ cwd, flags });
  if (options.permissionMode === 'bypass') settingsInfo.settings.permissions.defaultMode = 'bypass';

  const session = await createFullSession({
    cwd,
    settingsInfo,
    provider: typeof options.provider === 'object' ? options.provider : undefined,
    transcript: options.transcript ?? false,
    mcp: options.mcp ?? false,
    tools: options.tools,
    onWarning: options.onWarning,
  });
  if (options.requestPermission) session.requestPermission = options.requestPermission;
  return session;
}

/**
 * Run one prompt and yield every event (text_delta, tool_start, tool_end, …, turn_end).
 * @param {{ prompt: string, options?: QueryOptions & { session?: object } }} args
 *   pass `options.session` to continue an existing session instead of starting a new one
 */
export async function* query({ prompt, options = {} }) {
  const session = options.session ?? (await createSession(options));
  try {
    yield* session.stream(prompt, { signal: options.signal });
  } finally {
    if (!options.session) session.mcp?.close();
  }
}

// The building blocks, for going further.
export { Session } from './core/session.js';
export { EVENT } from './core/events.js';
export { defineTool, ToolError } from './tools/tool.js';
export { ToolRegistry } from './tools/registry.js';
export { createDefaultTools } from './tools/index.js';
export { createAnthropicProvider } from './providers/anthropic.js';
export { createOpenAICompatibleProvider } from './providers/openai-compatible.js';
export { createEchoProvider } from './providers/echo.js';
export { createMockProvider } from './providers/mock.js';
export { runHeadless, resultObject } from './ui/headless.js';
