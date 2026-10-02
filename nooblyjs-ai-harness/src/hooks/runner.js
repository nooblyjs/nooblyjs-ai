// Phase 12: HOOKS. Your code, run by the harness at fixed moments.
//
// Instructions in NOOBLY.md are requests: the model usually follows them, but
// not always. A hook is a command that ALWAYS runs at a given moment:
//
//   UserPromptSubmit  you sent a message (before the model sees it)
//   SessionStart      the first message of a conversation
//   PreToolUse        the model asked for a tool (before the permission check)
//   PostToolUse       a tool finished successfully
//   Stop              the model finished its reply
//   PreCompact        the conversation is about to be summarised
//
// Configured in settings files:
//
//   "hooks": {
//     "PreToolUse":  [{ "matcher": "Bash", "command": "node .noobly/hooks/guard.js" }],
//     "PostToolUse": [{ "matcher": "Edit|Write", "command": "npx prettier --write \"$NOOBLY_FILE\"" }],
//     "Stop":        [{ "command": "node .noobly/hooks/tests-must-pass.js", "timeout": 120 }]
//   }
//
// The protocol is deliberately tiny, so a hook can be written in any language:
//   - the event is sent as JSON on the hook's stdin
//   - exit code 0: fine. If stdout is JSON it can say more:
//       { "decision": "block" | "allow", "reason": "...", "updatedInput": {...}, "additionalContext": "..." }
//   - exit code 2: BLOCK. stderr is the reason, and it goes to the model
//   - any other exit code: the hook itself broke. You are told; the model is not.
import { spawn } from 'node:child_process';

export const HOOK_EVENTS = ['UserPromptSubmit', 'SessionStart', 'PreToolUse', 'PostToolUse', 'Stop', 'PreCompact'];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);
export const DEFAULT_TIMEOUT_SECONDS = 60;

/**
 * Turn the "hooks" setting into a flat list of { event, matcher, command, timeout, source }.
 * Accepts our flat form and Claude Code's nested one: { matcher, hooks: [{ type: 'command', command }] }.
 * @returns {{ hooks: object[], warnings: string[] }}
 */
export function normalizeHooks(config = {}, source = 'settings') {
  const hooks = [];
  const warnings = [];
  for (const [event, entries] of Object.entries(config ?? {})) {
    if (!HOOK_EVENTS.includes(event)) {
      warnings.push(`Unknown hook event "${event}" (ignored). Events: ${HOOK_EVENTS.join(', ')}.`);
      continue;
    }
    if (!Array.isArray(entries)) {
      warnings.push(`hooks.${event} should be a list (ignored).`);
      continue;
    }
    for (const entry of entries) {
      const inner = Array.isArray(entry?.hooks) ? entry.hooks : [entry];
      for (const hook of inner) {
        if (typeof hook?.command !== 'string' || !hook.command.trim()) {
          warnings.push(`A hooks.${event} entry has no "command" (ignored).`);
          continue;
        }
        const matcher = entry.matcher ?? hook.matcher ?? '';
        try {
          new RegExp(matcher);
        } catch {
          warnings.push(`hooks.${event}: matcher "${matcher}" is not a valid regular expression (ignored).`);
          continue;
        }
        hooks.push({ event, matcher, command: hook.command, timeout: hook.timeout ?? entry.timeout ?? DEFAULT_TIMEOUT_SECONDS, source: entry.source ?? source });
      }
    }
  }
  return { hooks, warnings };
}

/** Does a hook apply to this tool? "" and "*" match everything; otherwise the matcher is a regex on the whole name. */
export function hookMatches(hook, toolName) {
  if (!TOOL_EVENTS.has(hook.event) || !hook.matcher || hook.matcher === '*') return true;
  return new RegExp(`^(?:${hook.matcher})$`).test(toolName ?? '');
}

/**
 * A hook runner for a session.
 * @param {object[]} hooks from normalizeHooks
 * @param {{ cwd: string, sessionId?: () => string, subagent?: boolean }} options
 */
export function createHookRunner(hooks, { cwd, sessionId = () => null, env = process.env } = {}) {
  return {
    hooks,

    /** Hooks for a subagent: only the tool hooks. (Stop hooks are about YOUR task, not a helper's.) */
    forSubagent() {
      return createHookRunner(hooks.filter((hook) => TOOL_EVENTS.has(hook.event)), { cwd, sessionId, env });
    },

    has(event) {
      return hooks.some((hook) => hook.event === event);
    },

    /**
     * Run every hook for `event` (in parallel) and combine what they said.
     * @returns {Promise<HookResult>}
     */
    async run(event, payload = {}, { signal } = {}) {
      const matching = hooks.filter((hook) => hook.event === event && hookMatches(hook, payload.tool_name));
      const result = { blocked: false, allowed: false, reasons: [], context: [], updatedInput: undefined, errors: [], ran: matching.length };
      if (matching.length === 0) return result;

      const input = JSON.stringify({ event, session_id: sessionId(), cwd, ...payload });
      const outcomes = await Promise.all(matching.map((hook) => runOne(hook, input, { cwd, env, signal, payload })));
      for (const [i, outcome] of outcomes.entries()) interpret(matching[i], outcome, result);
      return result;
    },
  };
}

/**
 * @typedef {Object} HookResult
 * @property {boolean} blocked       some hook said no (exit 2, or "decision": "block")
 * @property {boolean} allowed       some hook said "decision": "allow" (skip the permission question)
 * @property {string[]} reasons      why it was blocked (for the model)
 * @property {string[]} context      additionalContext to give the model
 * @property {object} [updatedInput] PreToolUse: run the tool with this input instead
 * @property {string[]} errors       hooks that broke (for the user)
 * @property {number} ran            how many hooks ran
 */

function interpret(hook, { code, stdout, stderr, timedOut, error }, result) {
  const label = `${hook.event} hook "${hook.command}"`;
  if (error) return result.errors.push(`${label} could not start: ${error}`);
  if (timedOut) return result.errors.push(`${label} timed out after ${hook.timeout}s and was stopped.`);

  if (code === 2) {
    result.blocked = true;
    result.reasons.push(stderr.trim() || stdout.trim() || `Blocked by ${label}.`);
    return;
  }
  if (code !== 0) return result.errors.push(`${label} failed (exit ${code})${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ''}`);

  const text = stdout.trim();
  if (!text) return;
  let json = null;
  if (text.startsWith('{')) {
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON after all: treat as plain text below
    }
  }
  if (!json) {
    // Plain stdout on success is extra context for events that start something (like Claude Code).
    if (hook.event === 'UserPromptSubmit' || hook.event === 'SessionStart') result.context.push(text);
    return;
  }
  if (json.decision === 'block') {
    result.blocked = true;
    result.reasons.push(json.reason ?? `Blocked by ${label}.`);
  }
  if (json.decision === 'allow') result.allowed = true;
  if (json.updatedInput && typeof json.updatedInput === 'object') result.updatedInput = { ...result.updatedInput, ...json.updatedInput };
  if (typeof json.additionalContext === 'string' && json.additionalContext.trim()) result.context.push(json.additionalContext.trim());
}

/** Spawn one hook command with the event on stdin. Never throws. */
function runOne(hook, input, { cwd, env, signal, payload }) {
  return new Promise((resolve) => {
    const file = payload.tool_input?.file_path;
    const child = spawn('bash', ['-c', hook.command], {
      cwd,
      env: { ...env, NOOBLY_PROJECT_DIR: cwd, NOOBLY_HOOK_EVENT: hook.event, ...(typeof file === 'string' && { NOOBLY_FILE: file }) },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // its own process group, so a timeout kills everything it started
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, hook.timeout * 1000);
    signal?.addEventListener('abort', kill, { once: true });

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {}); // the hook may exit without reading its input
    child.stdin.end(input);
  });
}
