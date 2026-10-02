// Phase 13: running a SUBAGENT.
//
// A subagent is just another Session: a fresh, empty history, its own system
// prompt and a (possibly smaller) set of tools. It runs the same agent loop to
// completion, and only its FINAL reply goes back to the parent as the Task
// tool's result.
//
// That is the whole point: a search that reads 30 files fills the SUBAGENT's
// context window, not yours. The parent gets a one-paragraph answer. (The
// tokens are still paid for, and are added to your /cost.)
//
// What the child shares with the parent:
//   - the provider, settings and working directory
//   - the PERMISSION state: same rules, same mode (plan mode binds it too), and
//     any question is asked through your UI
//   - PreToolUse/PostToolUse hooks
// What it doesn't share: history, todo list, readFiles, and the Task tool
// itself (subagents can't start subagents: depth limit 1).
import path from 'node:path';
import { createSandbox } from '../sandbox/index.js';
import { EVENT } from '../core/events.js';
import { textOf } from '../core/messages.js';
import { buildSystemPrompt } from '../context/system-prompt.js';
import { ToolRegistry } from '../tools/registry.js';

/** Tools the main agent has that a subagent never gets. */
const PARENT_ONLY = new Set(['Task', 'ExitPlanMode']);

/** The parent's tools, filtered down to what this agent may use ("mcp__github__*" style wildcards work). */
export function toolsForAgent(parentTools, agent) {
  const allowed = (name) => !agent.tools || agent.tools.some((pattern) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name));
  return new ToolRegistry(parentTools.list().filter((tool) => !PARENT_ONLY.has(tool.name) && allowed(tool.name)));
}

/** The subagent's system prompt: the usual sections (without the subagent list) plus its role. */
export function subagentSystemPrompt(parent, agent, worktree = null) {
  const base = buildSystemPrompt({ ...(parent.context ?? {}), agents: [] });
  return [
    base,
    `# Your role: the "${agent.name}" subagent`,
    worktree &&
      `You work in your own git worktree: ${worktree.cwd} (branch ${worktree.branch}), a separate copy of the project made from its last commit. That folder is your working directory: use paths relative to it. Other agents may be working in their own copies at the same time. When you finish, noobly commits your changes to your branch; don't commit or switch branches yourself.`,
    'Another AI agent (the parent) gave you this task. The user does not see your messages: only your FINAL reply is returned to the parent, so make it complete and self-contained. You cannot ask the parent questions; if something is unclear, make a reasonable choice and say so.',
    agent.instructions,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Run `prompt` with a fresh child session and return its final reply.
 * @param {import('../core/session.js').Session} parent
 * @param {{ signal?: AbortSignal, emit?: (event: object) => void, toolUseId?: string }} options
 *   `emit` receives { type: 'subagent', parentId, agent, event } progress events for the UI
 */
export async function runSubagent(parent, agent, prompt, { signal, emit, toolUseId, worktree = null } = {}) {
  // Phase 29: in its own worktree, a subagent gets that folder, and a sandbox that may write there.
  const cwd = worktree?.cwd ?? parent.cwd;
  // (Its git commands read the main repository's .git: visible, read-only, even if that's under /tmp.)
  const sandbox = worktree && parent.sandbox?.active ? createSandbox(parent.settings.sandbox, { cwd, extraReadOnly: [path.join(worktree.root, '.git')] }) : parent.sandbox;
  // `parent.constructor` is Session: using it avoids a circular import (session → tools → task → here → session).
  const child = new parent.constructor({
    provider: parent.provider,
    providerId: parent.providerId,
    model: agent.model ?? parent.model,
    settings: parent.settings,
    cwd,
    systemPrompt: subagentSystemPrompt(parent, agent, worktree),
    tools: toolsForAgent(parent.tools, agent),
    retry: parent.retry,
    permissions: parent.permissions, // shared: same rules, same mode, same "don't ask again" answers
    // Look up parent.requestPermission at call time: the UI may replace it after we start.
    requestPermission: (request) => parent.requestPermission({ ...request, agent: agent.name }),
    hooks: parent.hooks?.forSubagent?.() ?? null,
    sandbox, // Phase 20: a subagent's commands are just as contained
  });
  child.isSubagent = true;
  // Phase 21: its edits can be rewound with the parent's turn (in a worktree they live on a branch instead).
  child.checkpoints = worktree ? null : parent.checkpoints;
  child.feedback = parent.feedback; // Phase 24
  child.tasks = parent.tasks; // Phase 22: a server a subagent starts is still there for the parent

  const forward = (event) => emit?.({ type: EVENT.SUBAGENT, parentId: toolUseId, agent: agent.name, event });
  let end = null;
  for await (const event of child.stream(prompt, { signal })) {
    if (event.type === EVENT.TOOL_START) forward({ type: event.type, id: event.id, name: event.name, summary: event.summary });
    else if (event.type === EVENT.TOOL_END) forward({ type: event.type, id: event.id, name: event.name, summary: event.summary, display: event.display, isError: event.isError });
    else if (event.type === EVENT.NOTICE) forward(event);
    else if (event.type === EVENT.TURN_END) end = event;
  }

  if (sandbox !== parent.sandbox) await sandbox?.close();
  const last = child.history.findLast((message) => message.role === 'assistant');
  return {
    text: last ? textOf(last.content).trim() : '',
    usage: child.usage,
    cost: child.cost,
    toolCalls: end?.toolCalls ?? 0,
    durationMs: end?.durationMs ?? 0,
    stopReason: end?.stopReason ?? null,
    interrupted: end?.interrupted ?? false,
    history: child.history, // for tests and debugging; NOT sent to the parent model
  };
}
