// Phase 12: "Do you trust this project?"
//
// Hooks and MCP servers RUN COMMANDS on your computer. Your own settings
// (~/.noobly/…) are fine: you wrote them. But a project's .noobly/ folder comes
// with the repo, so opening a cloned repo must not silently run its commands.
//
// So project-level hooks and MCP servers only run after you say yes, once. The
// same goes for project settings that are just as dangerous (env, baseUrl,
// permissions.allow: see config/settings.js).
// We remember WHAT you trusted (a fingerprint of the exact commands): if the
// project changes them later, you are asked again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { nooblyHome } from '../util/paths.js';

function storeFile(env) {
  return path.join(nooblyHome(env), 'trusted-projects.json');
}

function readStore(env) {
  try {
    return JSON.parse(fs.readFileSync(storeFile(env), 'utf8'));
  } catch {
    return {};
  }
}

/** A short fingerprint of what would run. */
export function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

/** Has the user already trusted exactly this `value` (hooks or MCP servers) for this project? */
export function isTrusted(cwd, kind, value, env = process.env) {
  return readStore(env)[path.resolve(cwd)]?.[kind] === fingerprint(value);
}

export function trust(cwd, kind, value, env = process.env) {
  const store = readStore(env);
  const key = path.resolve(cwd);
  store[key] = { ...store[key], [kind]: fingerprint(value) };
  fs.mkdirSync(path.dirname(storeFile(env)), { recursive: true });
  fs.writeFileSync(storeFile(env), JSON.stringify(store, null, 2) + '\n');
}

/**
 * What in this project needs trust: [{ kind, value, lines }] (only kinds not yet trusted).
 * `hooks` are normalised hooks from every layer; `mcpServers` the project's MCP servers;
 * `projectSettings` the held-back project settings (loadSettings().held).
 */
export function untrustedItems(cwd, { hooks = [], mcpServers = {}, projectSettings = {} }, env = process.env) {
  const items = [];
  const projectHooks = hooks.filter((hook) => hook.source === 'project' || hook.source === 'local');
  if (projectHooks.length && !isTrusted(cwd, 'hooks', projectHooks, env)) {
    items.push({ kind: 'hooks', value: projectHooks, lines: projectHooks.map((h) => `hook ${h.event}${h.matcher ? ` (${h.matcher})` : ''}: ${h.command}`) });
  }
  if (Object.keys(mcpServers).length && !isTrusted(cwd, 'mcp', mcpServers, env)) {
    items.push({ kind: 'mcp', value: mcpServers, lines: Object.entries(mcpServers).map(([name, s]) => `MCP server ${name}: ${[s.command, ...(s.args ?? [])].join(' ')}`) });
  }
  if (Object.keys(projectSettings).length && !isTrusted(cwd, 'settings', projectSettings, env)) {
    const { env: vars = {}, baseUrl, permissions, sandbox = {}, feedback = {}, webSearch } = projectSettings;
    items.push({
      kind: 'settings',
      value: projectSettings,
      lines: [
        ...Object.entries(vars).map(([name, value]) => `setting env ${name}=${value}`),
        ...(baseUrl ? [`setting baseUrl ${baseUrl} (your API key is sent there)`] : []),
        ...(webSearch ? [`setting webSearch ${JSON.stringify(webSearch)} (your searches are sent there)`] : []),
        ...(permissions?.allow ?? []).map((rule) => `allow without asking: ${rule}`),
        ...Object.entries(sandbox).map(([name, value]) => `setting sandbox.${name} = ${JSON.stringify(value)}`),
        ...Object.entries(feedback.checkers ?? {}).map(([glob, command]) => `checker after edits of ${glob}: ${command}`),
        ...Object.entries(feedback).filter(([name]) => name !== 'checkers').map(([name, value]) => `setting feedback.${name} = ${JSON.stringify(value)}`),
      ],
    });
  }
  return items;
}

/** Ask on the terminal (before the chat UI starts). Returns true if the user said yes. */
export async function askToTrust(cwd, items, { input = process.stdin, output = process.stderr } = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    output.write(
      [
        '',
        `This project (${cwd}) wants noobly to run these commands, or use these settings:`,
        ...items.flatMap((item) => item.lines.map((line) => `  • ${line}`)),
        '',
        'They come from the project\'s .noobly/ folder, so whoever wrote the project chose them. Only trust projects you trust.',
        '',
      ].join('\n'),
    );
    const answer = await rl.question('Trust them? [y/N] ');
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
