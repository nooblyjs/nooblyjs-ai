// Phase 06: permission rules like "Bash(npm test:*)" or "Edit(src/**)".
//
//   Rule                 Matches
//   ──────────────────   ─────────────────────────────────────────────────
//   Read                 every Read call
//   Bash(npm test)       exactly the command "npm test"
//   Bash(git diff:*)     commands starting with "git diff" ("git diff", "git diff src/")
//   Edit(src/**)         edits to files under src/ (a glob, relative to the project)
//   Read(**/.env*)       any .env file, in any folder
//   mcp__github__*       any tool whose name starts with "mcp__github__" (for Phase 14)
//   WebFetch(domain:nodejs.org)  pages on nodejs.org and its subdomains (Phase 18)
import os from 'node:os';
import path from 'node:path';

/** "Bash(npm test:*)" → { tool: 'Bash', specifier: 'npm test:*', text: 'Bash(npm test:*)' } */
export function parseRule(text) {
  const match = text.trim().match(/^([A-Za-z0-9_*-]+)(?:\((.*)\))?$/s);
  if (!match) throw new Error(`Invalid permission rule "${text}". Use Tool or Tool(specifier), e.g. Bash(npm test:*).`);
  return { tool: match[1], specifier: match[2], text: text.trim() };
}

/**
 * What a tool call touches, for rule matching:
 *   Bash → { kind: 'command', value: 'npm test' }
 *   file tools → { kind: 'path', value: 'src/app.js' } (relative to the project when inside it)
 */
export function permissionTarget(toolName, input, cwd) {
  if (typeof input?.command === 'string') return { kind: 'command', value: input.command.trim() };
  if (typeof input?.url === 'string') {
    try {
      return { kind: 'domain', value: new URL(input.url).hostname.toLowerCase() };
    } catch {
      return null;
    }
  }
  const file = input?.file_path ?? input?.path ?? (['Glob', 'Grep'].includes(toolName) ? '.' : undefined);
  if (typeof file !== 'string') return null;
  const absolute = path.resolve(cwd, file);
  const relative = path.relative(cwd, absolute);
  return { kind: 'path', value: relative && !relative.startsWith('..') ? relative : absolute };
}

function toolNameMatches(pattern, name) {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

/** Does one rule match one (simple) command, path, or tool name? */
export function ruleMatches(rule, toolName, target) {
  if (!toolNameMatches(rule.tool, toolName)) return false;
  if (rule.specifier === undefined) return true; // "Read" matches every Read call
  if (!target) return false;

  if (target.kind === 'domain') {
    const domain = rule.specifier.replace(/^domain:/, '').toLowerCase();
    return target.value === domain || target.value.endsWith(`.${domain}`);
  }
  if (target.kind === 'command') {
    if (rule.specifier.endsWith(':*')) {
      const prefix = rule.specifier.slice(0, -2);
      return target.value === prefix || target.value.startsWith(prefix + ' ');
    }
    return target.value === rule.specifier;
  }
  return globMatches(target.value, rule.specifier);
}

// Does a path match a rule's glob? Unlike file-search globs, `*` and `**` here
// also match names starting with a dot. (Node's path.matchesGlob skips dot
// folders, so the default rule Read(**/id_rsa*) silently missed .ssh/id_rsa:
// for a DENY rule that's a security hole. Found in Phase 18.) `~/` means your
// home folder.
export function globMatches(value, pattern) {
  const expanded = pattern.startsWith('~/') ? path.join(os.homedir(), pattern.slice(2)) : pattern;
  if (value === expanded) return true;
  let regex = '';
  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i];
    if (ch === '*' && expanded[i + 1] === '*') {
      // "**/" = any number of folders (including none); "**" at the end = anything
      if (expanded[i + 2] === '/') {
        regex += '(?:.*/)?';
        i += 2;
      } else {
        regex += '.*';
        i += 1;
      }
    } else if (ch === '*') regex += '[^/]*';
    else if (ch === '?') regex += '[^/]';
    else regex += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${regex}$`).test(value);
}

// ── Shell command splitting ─────────────────────────────────────────────
//
// If "npm test" is allowed, "npm test && rm -rf ~" must NOT be. So a command
// is split into its parts, and EVERY part has to be allowed on its own.

/**
 * Split a shell command on && || ; | and newlines, ignoring those characters
 * inside quotes. Returns the trimmed parts.
 */
export function splitCommand(command) {
  const parts = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') current += command[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '\\') {
      current += ch + (command[++i] ?? '');
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n' || (ch === '&' && command[i + 1] !== '>' && command[i - 1] !== '>')) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Parts of a command that no prefix rule can safely approve:
 * - command substitution: $(...), `...` or <(...) runs another, hidden command
 * - writing to a file with > or >> (except >/dev/null and 2>&1), because "ls > important.js" overwrites a file
 * - an --output option: "git diff --output=~/.bashrc" is allowed by the prefix "git diff", but writes a file
 */
export function hasHiddenEffects(part) {
  const unquoted = part.replace(/'[^']*'/g, "''");
  if (/\$\(|`|[<>]\(/.test(unquoted)) return true;
  if (/(^|\s)["']?--output(=|["']?\s|["']?$)/.test(part)) return true;
  const redirects = unquoted.match(/\d*>>?\s*(&\d+|\S+)?/g) ?? [];
  return redirects.some((redirect) => !/>>?\s*(&\d+|\/dev\/null)$/.test(redirect));
}

// Words that just run the command after them.
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'nohup', 'time', 'env', 'builtin']);

/**
 * A plain form of one simple command, so deny rules are harder to dodge:
 *   '/bin/rm -r -f x'  → 'rm -rf x'      (folder dropped, short flags joined)
 *   'sudo "rm" -rf x'  → 'rm -rf x'      (wrappers and quotes dropped)
 *   'FOO=1 rm -fr x'   → 'rm -fr x'      (variable assignments dropped)
 * Still best effort: a shell has too many ways to say the same thing (rm --recursive,
 * a script file, an alias…). Deny rules are a seatbelt, not a sandbox.
 */
export function canonicalCommand(part) {
  const words = part.replace(/\\(.)/g, '$1').replace(/["']/g, '').trim().split(/\s+/);
  while (words.length > 1) {
    if (WRAPPERS.has(words[0])) {
      words.shift();
      while (words.length > 1 && words[0].startsWith('-')) words.shift(); // sudo -E rm …
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    else break;
  }
  words[0] = words[0].split('/').pop();
  const out = [words[0]];
  for (const word of words.slice(1)) {
    const last = out.at(-1);
    // join "-r -f" into "-rf", but only while every word so far after the name was a short flag
    if (/^-[A-Za-z]+$/.test(word) && out.length === 2 && /^-[A-Za-z]+$/.test(last)) out[1] = last + word.slice(1);
    else out.push(word);
  }
  return out.join(' ');
}
