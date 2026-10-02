// Build a ready-to-use Session from settings: the one place that wires
// everything together. Used by the CLI (bin/noobly.js) and the library API
// (query() / createSession() in src/index.js), so both behave the same.
//
//   settings files + flags ─► provider ─► permissions ─► context (NOOBLY.md, skills, memory…)
//                           ─► hooks + MCP servers (only if trusted) ─► tools ─► Session
import { loadSettings, trustProjectSettings } from '../config/settings.js';
import { trust, untrustedItems } from '../config/trust.js';
import { loadContext } from '../context/system-prompt.js';
import { createHookRunner, normalizeHooks } from '../hooks/runner.js';
import { connectMcpServers, loadMcpConfig } from '../mcp/index.js';
import { createPermissions } from '../permissions/gate.js';
import { chooseProvider, createProvider, providerForModel, PROVIDERS } from '../providers/index.js';
import path from 'node:path';
import { createCheckpointStore } from '../checkpoints/store.js';
import { buildRepoMap } from '../context/repo-map.js';
import { createFeedback } from '../feedback/index.js';
import { createSandbox } from '../sandbox/index.js';
import { createTranscript, projectDir } from '../session-store/transcript.js';
import { createDefaultTools, editToolsFor } from '../tools/index.js';
import { createWebSearchTool, searchBackend } from '../tools/web-search.js';
import { Session } from './session.js';

/**
 * @param {Object} options
 * @param {string} [options.cwd]              project folder (default: process.cwd())
 * @param {object} [options.flags]            settings from the caller, highest priority (same shape as settings.json)
 * @param {object} [options.settingsInfo]     already-loaded settings (the CLI loads them first for `noobly config`)
 * @param {object} [options.provider]         a provider OBJECT to use instead of choosing one (tests, custom providers)
 * @param {Function} [options.onExchange]     see every raw request/response (--verbose)
 * @param {(items) => Promise<boolean>} [options.askTrust]  asked when the project's hooks/MCP servers (or risky
 *                                            settings) aren't trusted yet; without it they stay off
 * @param {boolean} [options.applyEnv]        copy the "env" setting into process.env (the CLI does; default false)
 * @param {(message: string) => void} [options.onWarning]
 * @param {boolean} [options.transcript]      save the conversation for --continue (default true)
 * @param {boolean} [options.mcp]             start MCP servers (default true)
 * @param {object[]} [options.tools]          extra tools to register
 * @param {string} [options.clientVersion]
 */
export async function createSession({
  cwd = process.cwd(),
  flags = {},
  settingsInfo = loadSettings({ cwd, flags }),
  provider: providerObject,
  onExchange,
  askTrust,
  onWarning = () => {},
  transcript = true,
  mcp: startMcp = true,
  tools: extraTools = [],
  clientVersion = '0.0.0',
  applyEnv = false,
} = {}) {
  settingsInfo.warnings.forEach(onWarning);

  // Phase 12 + 14: hooks, MCP servers (and settings like env) could run commands, so the project's own need the user's OK.
  // This comes first: a trusted project's env and baseUrl decide which provider and key are used.
  const trusted = await trustedExtensions(cwd, settingsInfo, { askTrust, onWarning });
  if (trusted.settings) settingsInfo = trustProjectSettings(settingsInfo);
  const settings = settingsInfo.settings;
  if (applyEnv) Object.assign(process.env, settings.env);

  // Which model API to talk to. A model name like "grok-4.7" tells us the provider, unless one was chosen.
  let providerId = 'custom';
  let provider = providerObject;
  if (!provider) {
    const requested = settings.provider ?? (settings.model && providerForModel(settings.model)) ?? undefined;
    const choice = chooseProvider({ requested });
    providerId = choice.id;
    provider = createProvider(choice.id, {
      apiKey: choice.apiKey,
      fallbacks: settings.fallbacks,
      caching: settings.promptCaching,
      baseUrl: settings.baseUrl,
      thinking: settings.thinking,
      effort: settings.effort,
      onExchange,
    });
  }

  const { defaultMode, allow, deny } = settings.permissions;
  const permissions = createPermissions({ mode: defaultMode ?? 'default', allow, deny });
  const { hooks, mcpServers } = trusted;
  const editTools = editToolsFor(settings.editTools, providerId); // Phase 25: Edit or ApplyPatch, per model family
  const tools = createDefaultTools({ editTools });
  // Phase 28: WebSearch only if a search engine is set up (a tool that can only fail is worse than none).
  const search = searchBackend(settings.webSearch);
  if (search) tools.register(createWebSearchTool(search));
  const mcp = startMcp ? await connectMcpServers(mcpServers, { cwd, clientVersion }) : { servers: [], tools: [], close() {} };
  for (const server of mcp.servers.filter((s) => s.status === 'failed')) onWarning(`MCP server "${server.name}" failed: ${server.error}`);
  for (const tool of [...mcp.tools, ...extraTools]) {
    if (tools.get(tool.name)) onWarning(`Two tools are called ${tool.name}; keeping the first.`);
    else tools.register(tool);
  }

  // Phase 20: the OS sandbox Bash commands run in (and the model is told about).
  const sandbox = createSandbox(settings.sandbox, { cwd });
  if (!sandbox.active && settings.sandbox?.enabled !== false) settingsInfo.notices.push(`No sandbox: ${sandbox.reason}. Bash commands run unsandboxed and ask first.`);

  // Phase 07: the environment, NOOBLY.md files, skills, subagents and memory, before the first message.
  const context = await loadContext(cwd);
  context.sandbox = sandbox.forModel();
  context.editTools = editTools;
  context.repoMap = await repoMapForPrompt(cwd, settings.repoMap); // Phase 27

  const session = new Session({
    provider,
    providerId,
    model: settings.model ?? PROVIDERS[providerId]?.defaultModel ?? 'unknown',
    settings,
    cwd,
    permissions,
    context,
    tools,
    newTranscript: transcript ? () => createTranscript(cwd) : null, // Phase 09
    newCheckpoints: (id) => createCheckpointStore(path.join(projectDir(cwd), 'checkpoints', id), { cwd }), // Phase 21
    hooks: hooks.length ? createHookRunner(hooks, { cwd, sessionId: () => session.transcript?.id ?? null }) : null,
    sandbox,
    feedback: createFeedback(settings.feedback, { cwd }), // Phase 24
  });
  session.settingsInfo = settingsInfo;
  session.mcp = mcp;
  return session;
}

/**
 * Phase 27: "auto" puts a map in the system prompt only where it pays: enough source files that
 * finding your way costs rounds, not so many that building it is slow. "on" always, "off" never.
 */
async function repoMapForPrompt(cwd, setting = 'auto') {
  if (setting === 'off') return null;
  const map = await buildRepoMap(cwd, { maxTokens: 1_500 });
  if (setting === 'auto' && (map.files < 25 || map.files > 5_000)) return null;
  return map.text || null;
}

/** All hooks (every settings layer), MCP servers (user + project) and held-back project settings, before trust is checked. */
export function findExtensions(cwd, settingsInfo) {
  const { hooks, warnings } = normalizeHooks(settingsInfo.settings.hooks);
  const mcpConfig = loadMcpConfig(cwd);
  return { hooks, userMcp: mcpConfig.user, mcpServers: mcpConfig.project, projectSettings: settingsInfo.held ?? {}, warnings: [...warnings, ...mcpConfig.warnings] };
}

/**
 * Drop the project's hooks / MCP servers unless they are trusted (asking once, if we can).
 * `settings: true` means the held-back project settings may be applied too.
 */
async function trustedExtensions(cwd, settingsInfo, { askTrust, onWarning }) {
  const found = findExtensions(cwd, settingsInfo);
  let settings = Object.keys(found.projectSettings).length > 0;
  found.warnings.forEach(onWarning);
  let { hooks, mcpServers } = found;
  const items = untrustedItems(cwd, found);
  if (items.length) {
    const yes = askTrust ? await askTrust(items) : false;
    if (yes) for (const item of items) trust(cwd, item.kind, item.value);
    else {
      const kinds = new Set(items.map((item) => item.kind));
      if (kinds.has('hooks')) hooks = hooks.filter((hook) => hook.source !== 'project' && hook.source !== 'local');
      if (kinds.has('mcp')) mcpServers = {};
      if (kinds.has('settings')) settings = false;
      onWarning(`This project's ${[...kinds].join(' and ')} are not trusted, so they are off. Run \`noobly trust\` to allow them.`);
    }
  }
  const tag = (servers, scope) => Object.fromEntries(Object.entries(servers).map(([name, s]) => [name, { ...s, scope }]));
  return { hooks, settings, mcpServers: { ...tag(found.userMcp, 'user'), ...tag(mcpServers, 'project') } };
}
