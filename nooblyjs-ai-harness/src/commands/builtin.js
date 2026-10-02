// The built-in slash commands. Each is { description, run(session, words, argsText) }.
import path from 'node:path';
import { PRICES } from '../config/defaults.js';
import { describeSettings } from '../config/settings.js';
import { renderSections } from '../context/system-prompt.js';
import { contextUsage, estimateTokens } from '../context/tokens.js';
import { formatCost, hasPrice } from '../core/cost.js';
import { MODES } from '../permissions/modes.js';
import { parseRule } from '../permissions/rules.js';
import { findApiKey, providerForModel, PROVIDERS, switchProvider } from '../providers/index.js';
import { findSession, listSessions } from '../session-store/transcript.js';
import { formatTodos } from '../tools/todo.js';
import { INDEX_FILE, listMemories } from '../memory/memory.js';
import { formatStats, summarizeTraces } from '../core/trace.js';
import { formatSessionDiff } from '../checkpoints/diff.js';
import { describeStatus } from '../tools/background.js';
import { loadCustomCommands } from './custom.js';

const print = (text) => ({ action: 'print', text });

export const BUILTIN = {
  help: {
    description: 'Show this list',
    run(session) {
      const lines = Object.entries(BUILTIN).map(([name, c]) => `/${name.padEnd(12)} ${c.description}`);
      const custom = [...loadCustomCommands(session.cwd).values()];
      if (custom.length) {
        lines.push('', 'Your commands (.noobly/commands):');
        for (const c of custom) lines.push(`/${(c.name + (c.argumentHint ? ` ${c.argumentHint}` : '')).padEnd(12)} ${c.description} (${c.scope})`);
      }
      return print(lines.join('\n'));
    },
  },

  clear: {
    description: 'Start a new conversation (the old one stays saved for /resume)',
    run(session) {
      session.clear();
      return { action: 'clear', text: 'New conversation. The model has forgotten everything (the old one is saved: /resume).' };
    },
  },

  compact: {
    description: 'Summarise the conversation to free up context, e.g. /compact keep the test failures',
    async run(session, words, focus) {
      if (session.history.length === 0) return print('Nothing to compact yet.');
      const result = await session.compact({ focus: focus || undefined, force: true });
      return print(`Compacted (${result.method}): ~${result.before.toLocaleString()} → ~${result.after.toLocaleString()} tokens.`);
    },
  },

  resume: {
    description: 'List saved conversations, or continue one: /resume 2 or /resume <id>',
    run(session, [which]) {
      if (!which) {
        const sessions = listSessions(session.cwd).slice(0, 15);
        if (!sessions.length) return print('No saved conversations for this project yet.');
        const lines = sessions.map(
          (s, i) => `${String(i + 1).padStart(2)}. ${s.modified.toISOString().slice(0, 16).replace('T', ' ')}  ${s.id.slice(0, 8)}  ${s.title}  (${s.messages} msgs)`,
        );
        return print(`Saved conversations, newest first:\n${lines.join('\n')}\n\nContinue one with /resume <number> or /resume <id>.`);
      }
      const found = findSession(session.cwd, which);
      if (!found) return print(`No saved conversation matches "${which}". Type /resume to see the list.`);
      const saved = session.resume(found.file);
      const last = [...saved.history].reverse().find((m) => m.role === 'assistant');
      return { action: 'resumed', text: `Resumed "${found.title}" (${saved.history.length} messages).`, last };
    },
  },

  cost: {
    description: 'Tokens, cache savings and money spent in this conversation',
    run(session) {
      const u = session.usage;
      const price = PRICES[session.model];
      const lines = [
        `Turns:               ${session.turns}`,
        `Input tokens:        ${(u.input_tokens ?? 0).toLocaleString()}   (full price)`,
        `Cache writes:        ${(u.cache_creation_input_tokens ?? 0).toLocaleString()}   (stored for next time)`,
        `Cache reads:         ${(u.cache_read_input_tokens ?? 0).toLocaleString()}   (re-used from the cache, much cheaper)`,
        `Output tokens:       ${(u.output_tokens ?? 0).toLocaleString()}`,
        `Total cost:          ${formatCost(session.cost)}${hasPrice(session.model) ? '' : ' (price of this model unknown)'}`,
      ];
      if (price && u.cache_read_input_tokens) {
        const saved = (u.cache_read_input_tokens * (price.input - price.cacheRead)) / 1_000_000;
        lines.push(`Saved by caching:    ${formatCost(saved)}`);
      }
      return print(lines.join('\n'));
    },
  },

  context: {
    description: 'What the model is told, how big it is, and how full the context window is',
    run(session) {
      const rows = renderSections(session.context ?? {}).map((section) => [section.name, estimateTokens(section.text)]);
      rows.push(['Tool definitions', estimateTokens(session.tools.toApiSchemas())]);
      rows.push(['Conversation so far', estimateTokens(session.history)]);
      const { tokens, window, fraction } = contextUsage(session);
      const files = session.context?.instructions ?? [];
      return print(
        [
          'Sent with every request (estimated tokens, ~4 characters each):',
          ...rows.map(([name, n]) => `  ${name.padEnd(24)} ${String(n).padStart(8)}`),
          `  ${'Total'.padEnd(24)} ${String(tokens).padStart(8)}`,
          '',
          `Context window: ${window.toLocaleString()} tokens for ${session.model}, ${(fraction * 100).toFixed(1)}% used.`,
          session.settings.autoCompact
            ? `Auto-compact at ${Math.round(session.settings.compactThreshold * 100)}%. Compact now with /compact.`
            : 'Auto-compact is off (setting autoCompact). Compact with /compact.',
          '',
          files.length ? 'Instruction files loaded:' : 'No NOOBLY.md or AGENTS.md found. Run /init to create one.',
          ...files.map((file) => `  ${file.path} (${file.scope})`),
        ].join('\n'),
      );
    },
  },

  config: {
    description: 'Show every setting and which file it came from',
    run(session) {
      return print(session.settingsInfo ? describeSettings(session.settingsInfo) : 'No settings information (not started from the CLI).');
    },
  },

  model: {
    description: 'Show or change the model, e.g. /model grok-4.3 (switches provider if needed)',
    run(session, [model]) {
      if (!model) {
        const known = Object.keys(PRICES).filter((m) => providerForModel(m) === session.providerId);
        return print(
          [
            `Provider: ${PROVIDERS[session.providerId]?.label ?? session.providerId}`,
            `Model:    ${session.model}`,
            known.length ? `Priced models for this provider: ${known.join(', ')}` : '',
            'Change with /model <id>. /models lists every model your key can use. Make it permanent in settings: "model".',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }
      // "grok-4.7" belongs to Grok: if we're on another provider, switch (the conversation carries over).
      const owner = providerForModel(model);
      if (owner && owner !== session.providerId) return print(switchProvider(session, owner, { model }));
      session.model = model;
      return print(`Model set to ${model}.`);
    },
  },

  models: {
    description: 'List the models your API key can use (asks the provider)',
    async run(session) {
      if (!session.provider.listModels) return print(`${session.provider.name} can't list its models.`);
      const models = await session.provider.listModels();
      const lines = models.map((m) => `${m === session.model ? '●' : ' '} ${m}${hasPrice(m) ? '' : '  (price unknown)'}`);
      return print(`Models available to your ${PROVIDERS[session.providerId].label} key:\n${lines.join('\n')}`);
    },
  },

  provider: {
    description: 'Show or switch provider: anthropic, openai, grok, ollama or echo',
    run(session, [id]) {
      if (!id) {
        const lines = Object.entries(PROVIDERS).map(([pid, p]) => {
          const current = pid === session.providerId ? '●' : ' ';
          const key = p.envKeys.length === 0 ? 'no key needed' : (findApiKey(pid)?.keyName ?? `no key (set ${p.envKeys[0]})`);
          return `${current} ${pid.padEnd(10)} ${p.label.padEnd(15)} ${key}`;
        });
        return print(`${lines.join('\n')}\n\nSwitch with /provider <id>.`);
      }
      if (!PROVIDERS[id]) return print(`Unknown provider ${id}. Choose: ${Object.keys(PROVIDERS).join(', ')}.`);
      return print(switchProvider(session, id));
    },
  },

  stats: {
    description: 'Timings of this session: time to first token, request and tool durations, cache hit rate',
    run(session) {
      return print(formatStats(summarizeTraces(session.traces)));
    },
  },

  history: {
    description: 'How many messages are re-sent to the model each turn',
    run(session) {
      return print(`${session.history.length} message(s) in history. All of them are sent to the model again on your next turn.`);
    },
  },

  tools: {
    description: 'List the tools the model can use',
    run(session) {
      return print(
        session.tools
          .list()
          .map((tool) => `${tool.name.padEnd(8)} ${tool.isReadOnly ? '(read-only) ' : ''}${tool.description.split('\n')[0]}`)
          .join('\n'),
      );
    },
  },

  todos: {
    description: "Show the model's todo list for the current task",
    run(session) {
      if (!session.todos.length) return print('No todo list yet. The model writes one (TodoWrite) for tasks with several steps.');
      return print(formatTodos(session.todos).join('\n'));
    },
  },

  hooks: {
    description: 'List the hooks that run at fixed moments (set in settings files)',
    run(session) {
      const hooks = session.hooks?.hooks ?? [];
      if (!hooks.length) {
        return print('No hooks. Add them to .noobly/settings.json, e.g.\n  "hooks": { "PostToolUse": [{ "matcher": "Edit|Write", "command": "npx prettier --write \\"$NOOBLY_FILE\\"" }] }\nSee .claude/docs/12-hooks.md.');
      }
      return print(hooks.map((h) => `${h.event.padEnd(17)} ${(h.matcher || '*').padEnd(12)} ${h.command}   (${h.source}, ${h.timeout}s)`).join('\n'));
    },
  },

  agents: {
    description: 'List the subagents the model can delegate to (Task tool)',
    run(session) {
      const lines = session.agents.map((a) => `${a.name.padEnd(12)} ${a.description}\n${' '.repeat(13)}tools: ${a.tools?.join(', ') ?? 'all'}${a.model ? ` · model: ${a.model}` : ''} · ${a.scope}`);
      return print(`${lines.join('\n')}\n\nAdd your own in .noobly/agents/<name>.md (see .claude/docs/13-subagents.md).`);
    },
  },

  mcp: {
    description: 'MCP servers: status and tools',
    run(session) {
      const servers = session.mcp?.servers ?? [];
      if (!servers.length) return print('No MCP servers. Add them to .noobly/mcp.json (see .claude/docs/14-mcp.md).');
      return print(
        servers
          .map((s) =>
            s.status === 'connected'
              ? `● ${s.name} (${s.scope}): connected, ${s.tools.length} tool(s)\n${s.tools.map((t) => `    ${t.name}${t.isReadOnly ? ' (read-only)' : ''}`).join('\n')}`
              : `✗ ${s.name} (${s.scope}): failed: ${s.error}`,
          )
          .join('\n'),
      );
    },
  },

  memory: {
    description: 'List what noobly remembers about this project (say "remember that…" to add)',
    run(session) {
      const dir = session.memoryDir;
      if (!dir) return print('Memory is off for this session.');
      const memories = listMemories(dir);
      if (!memories.length) return print(`Nothing remembered yet. Say "remember that …" and noobly writes it to\n  ${dir}/`);
      return print(
        [
          `Memories in ${dir}/ (index: ${INDEX_FILE}, loaded into every new session):`,
          ...memories.map((m) => `  ${m.name.padEnd(24)} [${m.type}] ${m.description}`),
          '',
          'New memories reach the system prompt from the next conversation (/clear or restart). Edit or delete the files freely.',
        ].join('\n'),
      );
    },
  },

  skills: {
    description: 'List installed skills (run one directly with /<skill-name>)',
    run(session) {
      if (!session.skills.length) return print('No skills installed. Create .noobly/skills/<name>/SKILL.md (see .claude/docs/15-skills.md).');
      return print(session.skills.map((s) => `/${s.name.padEnd(18)} ${s.description} (${s.scope})`).join('\n'));
    },
  },

  'accept-all-permissions': {
    description: 'Stop asking: every tool call runs (deny rules still apply). Shift+Tab to turn it off',
    run(session) {
      // Only YOU can type a slash command: not the model, not a file, not a settings file. That's why this
      // is allowed here while a settings file may not switch bypass on (see config/settings.js).
      if (session.permissions.mode === 'bypass') return print('Already accepting everything. Turn it off with Shift+Tab or /permissions mode default.');
      session.permissions.mode = 'bypass';
      const deny = session.permissions.deny.map((rule) => rule.text);
      return print(
        [
          '⚠ Accepting all permissions: noobly will edit files and run commands WITHOUT asking.',
          deny.length ? `Still always blocked (deny rules): ${deny.join(', ')}` : 'There are no deny rules, so nothing is blocked.',
          'Use this only in a project you can restore (a clean git tree, a container). Turn it off: Shift+Tab or /permissions mode default.',
        ].join('\n'),
      );
    },
  },

  merge: {
    description: 'Merge a subagent\'s worktree branch: /merge lists noobly/* branches, /merge <branch> merges one',
    async run(session, [branch]) {
      const { execFileSync } = await import('node:child_process');
      const git = (args) => execFileSync('git', args, { cwd: session.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      if (!branch) {
        const branches = git(['branch', '--list', 'noobly/*', '--format=%(refname:short)  %(committerdate:relative)  %(subject)']);
        return print(branches ? `Subagent branches:\n${branches}\n\nMerge one with /merge <branch>.` : 'No noobly/* branches.');
      }
      try {
        const out = git(['merge', '--no-ff', '--no-edit', branch]);
        git(['branch', '-d', branch]);
        return print(`Merged ${branch} and deleted it.\n${out}`);
      } catch (error) {
        return print(`✗ Could not merge ${branch}:\n${(error.stderr || error.stdout || error.message).trim()}\n\n(If there are conflicts: fix them and commit, or \`git merge --abort\`.)`);
      }
    },
  },

  tasks: {
    description: 'Background tasks (Bash run_in_background): /tasks lists them, /tasks stop 2 stops one',
    run(session, [verb, id]) {
      const tasks = session.tasks?.list() ?? [];
      if (verb === 'stop') {
        const task = session.tasks?.get(Number(id));
        if (!task) return print(`There is no task ${id}. Type /tasks to see them.`);
        return print(session.tasks.stop(task.id) ? `Stopped task ${task.id}.` : `Task ${task.id} had already ${describeStatus(task)}.`);
      }
      if (!tasks.length) return print('No background tasks. (The model starts them with Bash run_in_background, e.g. for a dev server.)');
      return print(tasks.map((t) => `${String(t.id).padStart(3)}. ${t.status === 'running' ? '●' : '○'} ${describeStatus(t).padEnd(22)} ${t.command.split('\n')[0].slice(0, 70)}`).join('\n') + '\n\nStop one with /tasks stop <id>.');
    },
  },

  rewind: {
    description: 'Undo turns: /rewind lists them; /rewind 3 [code|conversation|both] goes back to before turn 3 (Esc Esc too)',
    async run(session, [which, what = 'both']) {
      if (!session.checkpoints) return print('This session has no checkpoints, so nothing can be rewound.');
      const turns = session.checkpoints.turns();
      if (!which) {
        if (!turns.length) return print('Nothing to rewind yet.');
        return print(`Turns you can go back to (to how things were BEFORE it):\n${formatTurns(session, turns)}\n\n/rewind <number> [code|conversation|both]   (default: both)`);
      }
      if (!['code', 'conversation', 'both'].includes(what)) return print('Say what to rewind: code, conversation or both.');
      const result = await session.rewind(Number(which), { code: what !== 'conversation', conversation: what !== 'code' });
      return { action: 'rewound', text: describeRewind(session, result, what), prompt: what === 'code' ? undefined : result.turn.prompt };
    },
  },

  diff: {
    description: 'Show every change noobly made to files in this conversation (Edit and Write)',
    run(session) {
      if (!session.checkpoints) return print('This session has no checkpoints.');
      return print(formatSessionDiff(session.checkpoints.baseline(), session.cwd) || 'noobly has not changed any files in this conversation.');
    },
  },

  sandbox: {
    description: 'Show the sandbox Bash commands run in: what they may write, hidden folders, network',
    run(session) {
      if (!session.sandbox) return print('This session has no sandbox: Bash commands run unsandboxed and ask first.');
      return print(session.sandbox.describe());
    },
  },

  permissions: {
    description: 'Show rules and mode; /permissions allow|deny <rule>; /permissions mode <mode>',
    run(session, words) {
      return print(permissionsCommand(session, words));
    },
  },

  init: {
    description: 'Ask the model to explore the project and write a NOOBLY.md for it',
    run() {
      return { action: 'prompt', text: 'Exploring the project to write NOOBLY.md…', prompt: INIT_PROMPT, reloadContext: true };
    },
  },

  exit: {
    description: 'Quit (Ctrl+C twice also works)',
    aliases: ['quit'],
    run() {
      return { action: 'exit' };
    },
  },
};

// ── /permissions ────────────────────────────────────────────────────────
function permissionsCommand(session, [sub, ...rest]) {
  const permissions = session.permissions;

  if (sub === 'allow' || sub === 'deny') {
    const rule = parseRule(rest.join(' '));
    permissions[sub].push(rule);
    return `Added ${sub} rule ${rule.text} for this session. To keep it, add it to .noobly/settings.json under permissions.${sub}.`;
  }
  if (sub === 'mode') {
    const mode = rest[0];
    if (!MODES[mode] || mode === 'bypass') return 'Choose a mode: default, acceptEdits or plan. (To stop asking altogether: /accept-all-permissions.)';
    permissions.mode = mode;
    return `Permission mode: ${MODES[mode].label}. ${MODES[mode].explain}`;
  }

  const list = (rules) => (rules.length ? rules.map((rule) => `  ${rule.text}`).join('\n') : '  (none)');
  return [
    `Mode: ${MODES[permissions.mode].label}. ${MODES[permissions.mode].explain}`,
    '',
    'Deny (always wins):',
    list(permissions.deny),
    '',
    'Allow:',
    list(permissions.allow),
    '',
    'Allowed this session ("don\'t ask again"):',
    list(permissions.sessionAllow),
    '',
    'Add rules: /permissions allow Bash(npm test:*)   /permissions deny Edit(package.json)',
    'Keep them: put them in .noobly/settings.json ("permissions": { "allow": [...] }). See /config.',
    'Change mode: /permissions mode plan   (or press Shift+Tab)',
  ].join('\n');
}

// ── /init ───────────────────────────────────────────────────────────────
export const INIT_PROMPT = `Please explore this project and write a NOOBLY.md file in the project root. It is read at the start of every future session, so it should tell an AI coding agent what it needs to work well here.

Use Glob, Grep and Read (and git log if useful) to learn:
- what the project is, in one or two sentences
- how to install, build, run and test it (exact commands)
- the code style and conventions actually used (module system, formatting, naming, test style)
- how the code is organised: the main folders and what lives where
- anything surprising or easy to get wrong

Keep it under about 60 lines, as short bullet points. Only include things you verified in the code. If NOOBLY.md already exists, Read it and improve it instead of starting over.`;

/** "3. 14:02  refactor the parser  (src/a.js, src/b.js · 1 changed by commands)" */
export function formatTurns(session, turns) {
  const rel = (file) => path.relative(session.cwd, file) || file;
  return turns
    .map((turn) => {
      const changes = [
        turn.files.length ? turn.files.slice(0, 3).map(rel).join(', ') + (turn.files.length > 3 ? ` +${turn.files.length - 3}` : '') : null,
        turn.bashFiles.length ? `${turn.bashFiles.length} changed by commands` : null,
      ].filter(Boolean);
      const time = turn.at ? new Date(turn.at).toTimeString().slice(0, 5) : '     ';
      return `${String(turn.id).padStart(3)}. ${time}  ${turn.prompt.replace(/\s+/g, ' ').slice(0, 60)}${changes.length ? `  (${changes.join(' · ')})` : ''}${turn.historyLength === null ? '  [code only: compacted]' : ''}`;
    })
    .join('\n');
}

export function describeRewind(session, { turn, files }, what) {
  const rel = (file) => path.relative(session.cwd, file) || file;
  const lines = [`⏪ Rewound ${what === 'both' ? 'code and conversation' : what} to before: "${turn.prompt.slice(0, 60)}"`];
  if (files) {
    if (files.restored.length) lines.push(`  restored: ${files.restored.map(rel).join(', ')}`);
    if (files.deleted.length) lines.push(`  deleted (didn't exist then): ${files.deleted.map(rel).join(', ')}`);
    if (files.notRestorable.length) lines.push(`  ⚠ changed by commands, NOT restored: ${files.notRestorable.map(rel).join(', ')}`);
    if (!files.restored.length && !files.deleted.length && !files.notRestorable.length) lines.push('  (no file changes to undo)');
  }
  if (what !== 'code') lines.push('  The model has forgotten everything after that point. Your message is back in the input box.');
  return lines.join('\n');
}
