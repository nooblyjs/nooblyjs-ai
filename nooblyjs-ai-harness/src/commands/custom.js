// Phase 10: your own slash commands, written as Markdown files.
//
//   .noobly/commands/review.md          (this project; commit it to share with your team)
//   ~/.noobly/commands/review.md        (you, in every project)
//
//   ---
//   description: Review the uncommitted changes
//   argument-hint: [what to focus on]
//   allowed-tools: Bash(git diff:*), Read, Grep
//   ---
//   Review the output of `git diff` for bugs and unclear code. Focus on: $ARGUMENTS
//
// Typing `/review error handling` sends the body to the model, with $ARGUMENTS
// replaced by "error handling" ($1, $2… are the separate words). `allowed-tools`
// are permission rules that apply while this command runs, so it doesn't have to ask.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../util/frontmatter.js';
import { nooblyHome } from '../util/paths.js';

export function commandFolders(cwd, env = process.env) {
  return [
    { scope: 'user', dir: path.join(nooblyHome(env), 'commands') },
    { scope: 'project', dir: path.join(cwd, '.noobly', 'commands') },
  ];
}

/** All custom commands by name. A project command replaces a user command with the same name. */
export function loadCustomCommands(cwd, env = process.env) {
  const commands = new Map();
  for (const { scope, dir } of commandFolders(cwd, env)) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.md'))) {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, file), 'utf8'));
      const name = file.slice(0, -3);
      const allowed = data['allowed-tools'];
      commands.set(name, {
        name,
        scope,
        file: path.join(dir, file),
        description: data.description ?? firstLine(body),
        // "[focus]" is a hint shown to you, not a list: keep the brackets.
        argumentHint: Array.isArray(data['argument-hint']) ? `[${data['argument-hint'].join(', ')}]` : data['argument-hint'],
        allowedTools: Array.isArray(allowed) ? allowed : splitRules(allowed),
        body: body.trim(),
      });
    }
  }
  return commands;
}

/** "Bash(git diff:*), Read" → ['Bash(git diff:*)', 'Read'] (commas inside parentheses stay). */
export function splitRules(text) {
  if (!text) return [];
  const rules = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      rules.push(current.trim());
      current = '';
    } else current += ch;
  }
  rules.push(current.trim());
  return rules.filter(Boolean);
}

/** Replace $ARGUMENTS with everything typed after the command, and $1, $2… with single words. */
export function expandArguments(body, argsText) {
  const words = argsText.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
  return body.replaceAll('$ARGUMENTS', argsText).replace(/\$(\d)/g, (_, n) => words[Number(n) - 1] ?? '');
}

function firstLine(body) {
  return body.trim().split('\n')[0].slice(0, 60);
}
