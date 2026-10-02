// Phase 06: THE PERMISSION GATE. Every tool call passes through here first.
//
// The model decides what it WANTS to do. The harness decides what it MAY do.
// This check is code, not a request in the prompt, so it holds even if the
// model misbehaves or is tricked by text it read in a file.
//
// Decision order (the first that applies wins):
//   1. a deny rule matches                           → deny   (deny beats everything, even bypass)
//   2. bypass mode                                   → allow
//   3. plan mode and the tool changes things         → deny
//      Phase 20: Bash asking to leave the sandbox (dangerouslyDisableSandbox) → ask, always
//   4. an allow rule matches (every part of a shell command)  → allow
//   5. you said "don't ask again" for it this session → allow
//   6. the tool is read-only (and doesn't ask anyway)  → allow
//   7. acceptEdits mode and it's Edit/Write           → allow
//      (or Edit/Write in the memory folder, Phase 16)
//      (or Phase 20: Bash that runs in the sandbox, with sandbox.autoAllow)
//   8. otherwise                                      → ask you
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_ALLOW, DEFAULT_DENY } from './defaults.js';
import { MODES } from './modes.js';
import { patchPaths } from '../tools/patch.js';
import { canonicalCommand, hasHiddenEffects, parseRule, permissionTarget, ruleMatches, splitCommand } from './rules.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'ApplyPatch']);
// Phase 25: rules written for Edit/Write (e.g. the default Edit(**/.env*)) cover every tool that changes files.
const RULE_NAMES_FOR_EDITS = ['Edit', 'Write'];
// Grep shows file contents, so a Read deny rule (e.g. Read(**/.env*)) must stop it too.
const READS_CONTENT = new Set(['Read', 'Grep']);

/** The permission state kept on the Session. */
export function createPermissions({ mode = 'default', allow = [], deny = [], useDefaults = true } = {}) {
  if (!MODES[mode]) throw new Error(`Unknown permission mode "${mode}". Choose one of: ${Object.keys(MODES).join(', ')}.`);
  return {
    mode,
    allow: [...(useDefaults ? DEFAULT_ALLOW : []), ...allow].map(parseRule),
    deny: [...(useDefaults ? DEFAULT_DENY : []), ...deny].map(parseRule),
    sessionAllow: [], // rules added by answering "Yes, don't ask again"
  };
}

/**
 * Decide whether a tool call may run.
 * @returns {{ behavior: 'allow' | 'deny' | 'ask', reason: string }}
 */
export function decide(session, tool, input) {
  // Phase 25: a patch touches several files. Every one must pass, so decide per file and keep the strictest answer.
  if (tool.name === 'ApplyPatch' && typeof input?.patch === 'string') {
    const answers = patchPaths(input.patch).map((file) => decide(session, tool, { file_path: file }));
    if (!answers.length) return { behavior: 'ask', reason: 'needs your permission' };
    return answers.find((a) => a.behavior === 'deny') ?? answers.find((a) => a.behavior === 'ask') ?? answers[0];
  }
  const permissions = session.permissions;
  const target = permissionTarget(tool.name, input, session.cwd);
  const parts = target?.kind === 'command' ? splitCommand(target.value) : null;

  // 1. Any part matching a deny rule blocks the whole call, in every mode.
  const denied = deniedBy(session, tool.name, target, parts);
  if (denied) return { behavior: 'deny', reason: `Blocked by the permission rule ${denied.text}.` };

  // 2. Bypass (--dangerously-skip-permissions or /accept-all-permissions): everything else runs.
  if (permissions.mode === 'bypass') return { behavior: 'allow', reason: 'bypass mode' };

  // 3.
  if (permissions.mode === 'plan' && !tool.isReadOnly) {
    return { behavior: 'deny', reason: `noobly is in plan mode, so ${tool.name} is not allowed. ${MODES.plan.explain}` };
  }

  // Phase 20: leaving the sandbox is the one Bash call no rule may approve: the user decides each time.
  const sandbox = tool.name === 'Bash' && session.sandbox?.active ? session.sandbox : null;
  if (sandbox && input?.dangerouslyDisableSandbox) return { behavior: 'ask', reason: 'the command asks to run outside the sandbox' };

  // 4. + 5.
  const allowRules = [...permissions.allow, ...permissions.sessionAllow];
  const ruleNames = EDIT_TOOLS.has(tool.name) ? [tool.name, ...RULE_NAMES_FOR_EDITS] : [tool.name];
  if (ruleNames.some((name) => isAllowed(allowRules, name, target, parts))) return { behavior: 'allow', reason: 'allowed by a rule' };

  // 6. (Phase 18: WebFetch changes nothing here, but still asks per domain: fetching can leak data.)
  if (tool.isReadOnly && !tool.needsPermission) return { behavior: 'allow', reason: 'read-only tool' };

  // 7.
  if (permissions.mode === 'acceptEdits' && EDIT_TOOLS.has(tool.name)) return { behavior: 'allow', reason: 'accept edits mode' };
  // Phase 16: remembering things shouldn't need a question each time. (The tools themselves still refuse symlink escapes.)
  if (EDIT_TOOLS.has(tool.name) && target?.kind === 'path' && session.memoryDir && isInsideFolder(path.resolve(session.cwd, target.value), session.memoryDir)) {
    return { behavior: 'allow', reason: 'memory file' };
  }

  // Phase 20: the sandbox limits what the command can do, so it needn't ask. (Deny rules and plan mode were checked above.)
  if (sandbox?.policy.autoAllow) return { behavior: 'allow', reason: 'runs in the sandbox' };

  // 8.
  return { behavior: 'ask', reason: 'needs your permission' };
}

/**
 * The deny rule that blocks this call, if any. Deny rules are checked against more than
 * the text the model wrote, because a deny rule that is easy to dodge protects nothing:
 *   - every part of a shell command, also in a plain form ("/bin/rm" "-r" "-f" → rm -rf)
 *   - for a path, also the file a symlink points to (notes.txt → .env)
 *   - for Grep, the Read rules too
 */
function deniedBy(session, toolName, target, parts) {
  const targets = [target];
  if (parts) for (const value of parts) targets.push({ kind: 'command', value }, { kind: 'command', value: canonicalCommand(value) });
  if (target?.kind === 'path') {
    const real = realTarget(target.value, session.cwd);
    if (real && real.value !== target.value) targets.push(real);
  }
  const names = READS_CONTENT.has(toolName) ? [toolName, 'Read'] : EDIT_TOOLS.has(toolName) ? [toolName, ...RULE_NAMES_FOR_EDITS] : [toolName];
  return session.permissions.deny.find((rule) => names.some((name) => targets.some((t) => ruleMatches(rule, name, t))));
}

/** Where a path really leads (following symlinks), in the same form as permissionTarget. */
function realTarget(value, cwd) {
  try {
    const root = fs.realpathSync(cwd);
    const real = fs.realpathSync(path.resolve(cwd, value));
    const relative = path.relative(root, real);
    return { kind: 'path', value: relative && !relative.startsWith('..') ? relative : real };
  } catch {
    return null; // doesn't exist (yet): nothing to follow
  }
}

/** Would a Read of this file (a path relative to the project) be denied? Grep uses it to leave such files out of a search. */
export function isReadDenied(session, file) {
  if (!session?.permissions) return false;
  return Boolean(deniedBy(session, 'Read', { kind: 'path', value: file }, null));
}

function isInsideFolder(file, folder) {
  const relative = path.relative(folder, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isAllowed(rules, toolName, target, parts) {
  if (!parts) return rules.some((rule) => ruleMatches(rule, toolName, target));
  // A shell command: EVERY part must be allowed, and none may hide extra effects.
  return parts.every(
    (value) => !hasHiddenEffects(value) && rules.some((rule) => ruleMatches(rule, toolName, { kind: 'command', value })),
  );
}

/**
 * What "Yes, and don't ask again" should add, for the permission dialog:
 *   Bash  → a prefix rule, e.g. Bash(npm test:*)
 *   Edit/Write → switch to acceptEdits mode
 *   other → the tool name, e.g. WebFetch
 * @returns {{ type: 'rule', rule: string, label: string } | { type: 'mode', mode: string, label: string }}
 */
export function suggestAlways(session, tool, input) {
  if (EDIT_TOOLS.has(tool.name)) {
    return { type: 'mode', mode: 'acceptEdits', label: 'Yes, allow all edits this session' };
  }
  const target = permissionTarget(tool.name, input, session.cwd);
  if (target?.kind === 'domain') {
    return { type: 'rule', rule: `${tool.name}(domain:${target.value})`, label: `Yes, and don't ask again for ${target.value} this session` };
  }
  if (tool.name === 'Bash' && typeof input?.command === 'string') {
    const allowRules = [...session.permissions.allow, ...session.permissions.sessionAllow];
    const parts = splitCommand(input.command);
    const firstNew = parts.find((value) => !allowRules.some((rule) => ruleMatches(rule, tool.name, { kind: 'command', value }))) ?? parts[0];
    const prefix = commandPrefix(firstNew ?? input.command);
    return { type: 'rule', rule: `Bash(${prefix}:*)`, label: `Yes, and don't ask again for "${prefix}" commands this session` };
  }
  return { type: 'rule', rule: tool.name, label: `Yes, and don't ask again for ${tool.name} this session` };
}

// For tools like git and npm, the second word matters: "git commit" is not "git push".
const TWO_WORD_COMMANDS = new Set(['git', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'cargo', 'go', 'docker', 'kubectl', 'pip', 'python', 'python3', 'node']);

export function commandPrefix(command) {
  const words = command.trim().split(/\s+/);
  return TWO_WORD_COMMANDS.has(words[0]) && words[1] && !words[1].startsWith('-') ? `${words[0]} ${words[1]}` : words[0];
}

/** Apply the user's "don't ask again" answer. */
export function rememberAlways(session, suggestion) {
  if (suggestion.type === 'mode') session.permissions.mode = suggestion.mode;
  else session.permissions.sessionAllow.push(parseRule(suggestion.rule));
}

/**
 * Allow some rules only for a while (Phase 10: a custom command's `allowed-tools`).
 * Returns a function that removes them again.
 */
export function temporarilyAllow(session, ruleTexts = []) {
  const rules = ruleTexts.map(parseRule);
  session.permissions.sessionAllow.push(...rules);
  return () => {
    session.permissions.sessionAllow = session.permissions.sessionAllow.filter((rule) => !rules.includes(rule));
  };
}
