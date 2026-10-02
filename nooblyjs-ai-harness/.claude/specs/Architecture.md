# Architecture — Noobly Learn Harness

| Field | Value |
|---|---|
| Status | Draft v1 |
| Date | 2026-09-29 |
| Related | [PRD.md](./PRD.md) · [Roadmap.md](./Roadmap.md) |

This document describes the **end-state** architecture. The [roadmap](./Roadmap.md) builds it up one layer at a time; each section below notes the phase that introduces it.

---

## 1. Design principles

1. **The loop is small; everything else is a plug-in.** The agent loop should stay under ~150 lines forever. Tools, permissions, hooks, context and UI hang off it through narrow interfaces.
2. **The loop emits events; it never prints.** UI, headless JSON output, transcripts and tests are all just event consumers. This is what makes the harness testable and embeddable.
3. **One internal message format.** Internally we use the Anthropic Messages shape (roles + content blocks). Other providers translate at the edge.
4. **Tool results are prompts.** Every tool error, denial and truncation message is written for the *model* to read and act on.
5. **Explicit over magic.** No DI containers, no decorators, no agent frameworks. Plain functions and objects, ES modules, JSDoc types.
6. **Dependency-free core, rich UI.** `src/core`, `src/providers`, `src/tools`, `src/permissions` use only Node built-ins (`fetch`, `child_process`, `node:test`, `fs.glob`, `AbortController`). Only `src/ui` uses Ink/React.

## 2. High-level view

```
┌───────────────────────────────────────────────────────────────────────────┐
│                               bin/noobly.js                               │
│                 (arg parsing → build Session → pick front-end)            │
└──────────────┬────────────────────────────────────────────┬───────────────┘
               │                                            │
     ┌─────────▼─────────┐                        ┌─────────▼─────────┐
     │ Interactive UI    │                        │   Headless / SDK  │
     │ (Ink/React, JSX,  │                        │ (-p, json output, │
     │  permission UI)   │                        │  query() iterator)│
     └─────────┬─────────┘                        └─────────┬─────────┘
               │     user input ▼          ▲ events           │
     ┌─────────▼────────────────────────────────────────────────▼─────────┐
     │                             Session                                │
     │  history · settings · permission state · todo state · usage/cost   │
     │  ┌──────────────────────────────────────────────────────────────┐  │
     │  │                        Agent Loop                            │  │
     │  │  build request → provider.stream() → collect blocks →        │  │
     │  │  run tools (via permission gate + hooks) → append → repeat   │  │
     │  └───┬───────────────┬──────────────────┬──────────────────┬────┘  │
     └──────┼───────────────┼──────────────────┼──────────────────┼───────┘
            │               │                  │                  │
   ┌────────▼──────┐ ┌──────▼───────┐ ┌────────▼────────┐ ┌───────▼────────┐
   │   Providers   │ │ Tool Registry│ │ Context Manager │ │  Hook Runner   │
   │ anthropic,    │ │ builtin, MCP,│ │ system prompt,  │ │ Pre/PostTool,  │
   │ mock, openai* │ │ Task, Skill  │ │ compaction,     │ │ Prompt, Stop…  │
   └───────────────┘ └──────┬───────┘ │ caching, budget │ └────────────────┘
                            │         └─────────────────┘
                   ┌────────▼────────┐        ┌──────────────────┐
                   │ Permission Gate │        │ Transcript Store │
                   │ rules · modes · │        │ JSONL, resume    │
                   │ ask-user        │        └──────────────────┘
                   └─────────────────┘
```

## 3. Directory layout

```
nooblyjs-learn-harness/
├── bin/
│   └── noobly.js                 # CLI entry: parse args, wire everything, start UI
├── src/
│   ├── cli.js                    # Flag parsing, mode selection (-p vs interactive)
│   ├── index.js                  # Library entry: Session, providers (later query())
│   ├── core/
│   │   ├── create-session.js     # Settings → provider, permissions, trust, hooks, MCP, context → Session (CLI + library)
│   │   ├── side-request.js       # One-off small-model request (WebFetch extraction)
│   │   ├── trace.js              # Per-turn traces, /stats summaries (Phase 19)
│   │   ├── channel.js            # Async queue: tool progress events → the loop (Phase 13)
│   │   ├── session.js            # Session object: owns state, exposes submit()
│   │   ├── loop.js               # THE agent loop (async generator of events)
│   │   ├── events.js             # Event type constants + JSDoc typedefs
│   │   ├── messages.js           # Helpers: textOf(), toolResult(), normalise
│   │   └── cost.js               # Usage accounting + pricing
│   ├── providers/
│   │   ├── provider.js           # Provider interface (typedef) + factory
│   │   ├── anthropic.js          # Raw fetch Messages API client
│   │   ├── sse.js                # Server-sent-events parser
│   │   ├── retry.js              # Backoff / retry-after handling
│   │   ├── echo.js               # Offline fake provider (--echo) — Phase 02
│   │   ├── mock.js               # Scripted provider for tests
│   │   ├── openai-compatible.js  # Translation adapter: OpenAI + xAI Grok (Chat Completions)
│   │   ├── errors.js             # ApiError shared by all providers
│   │   └── index.js              # Provider table, key detection, switching
│   ├── tools/
│   │   ├── registry.js           # Register, list, lookup, schema export
│   │   ├── tool.js               # Tool typedef + defineTool() helper + input validation
│   │   ├── read.js  write.js  edit.js  glob.js  grep.js  bash.js
│   │   ├── todo.js               # TodoWrite
│   │   ├── task.js               # Subagent spawner
│   │   ├── skill.js              # Skill loader tool
│   │   ├── plan.js               # ExitPlanMode (Phase 11)
│   │   ├── html.js               # HTML → text for WebFetch
│   │   ├── images.js  web-search.js  # Phase 28: image blocks, pasted image paths; WebSearch backends
│   │   ├── background.js         # TaskOutput, TaskStop (Phase 22)
│   │   ├── multi-edit.js  apply-patch.js  patch.js  # Phase 25: MultiEdit, ApplyPatch + the patch format
│   │   ├── replace.js            # Phase 25: exact match, then an unambiguous whitespace-forgiving one
│   │   └── commit-changes.js     # Phase 25: the one write path (checkpoint, feedback, freshness)
│   │   └── web-fetch.js
│   ├── ui/acp.js                 # Phase 30: Agent Client Protocol server (`noobly acp`)
│   ├── agents/worktree.js        # Phase 29: create/finish a git worktree per subagent
│   ├── context/repo-map.js       # Phase 27: symbols, PageRank, budget (tool: tools/repo-map.js)
│   ├── feedback/
│   │   └── index.js              # Phase 24: checkers after Edit/Write, only new problems
│   ├── checkpoints/              # Phase 21: undo
│   │   ├── store.js              # Per-turn snapshots (content-addressed), Bash change detection, restore
│   │   └── diff.js               # /diff via `diff -u`
│   ├── sandbox/                  # Phase 20: OS sandbox for Bash
│   │   ├── index.js              # Backend detection, prepare(command), failure notes, /sandbox
│   │   ├── policy.js             # Settings → what may be written / read / reached
│   │   ├── bwrap.js  seatbelt.js # Linux and macOS translations of the policy
│   │   ├── executor.js           # Phase 22: runs a session's commands inside ONE long-lived sandbox (Linux)
│   │   └── proxy.js  bridge.js   # Domain-filtering network proxy (outside) and its bridge (inside)
│   ├── tasks/
│   │   └── registry.js           # Phase 22: background tasks: output buffer, new-output reads, wait/until, exit notices
│   ├── permissions/
│   │   ├── gate.js               # decide(tool, input, ctx) → allow | ask | deny
│   │   ├── rules.js              # Parse/match "Bash(npm test:*)" style rules
│   │   └── modes.js              # default | acceptEdits | plan | bypass
│   ├── context/
│   │   ├── system-prompt.js      # Assemble sections
│   │   ├── environment.js        # cwd, OS, date, git info
│   │   ├── instructions.js       # Discover & load NOOBLY.md / AGENTS.md
│   │   ├── reminders.js          # <system-reminder> injection
│   │   ├── tokens.js             # Estimation + usage accounting + cost table
│   │   ├── truncate.js           # Tool output truncation policy
│   │   ├── compact.js            # Summarise-and-replace compaction
│   │   └── cache.js              # cache_control breakpoint placement
│   ├── session-store/
│   │   └── transcript.js         # Append-only JSONL, list/load/resume
│   ├── config/
│   │   ├── settings.js           # Layered load + merge + provenance
│   │   └── defaults.js
│   ├── commands/
│   │   ├── index.js              # Slash command dispatch (built-in, then custom)
│   │   ├── builtin.js            # /help /clear /compact /cost /model /resume /config ... as a table
│   │   └── custom.js             # .noobly/commands/*.md loader, $ARGUMENTS/$1 expansion
│   ├── hooks/
│   │   └── runner.js             # Match + spawn hook commands, interpret results
│   ├── mcp/
│   │   ├── client.js             # JSON-RPC 2.0 over stdio
│   │   └── adapter.js            # MCP tool → Tool object
│   ├── skills/
│   │   └── loader.js             # Discover SKILL.md, parse frontmatter
│   ├── agents/
│   │   ├── definitions.js        # built-in + .noobly/agents/*.md
│   │   └── subagent.js           # Run a child Session with restricted tools
│   ├── memory/
│   │   └── memory.js             # Memory dir + index loading
│   ├── ui/                       # Ink (React) components, .jsx compiled on load by tsx
│   │   ├── start.jsx             # render(<App/>)
│   │   ├── App.jsx               # Chat screen: state, <Static> transcript, input, status bar
│   │   ├── theme.js              # Colours
│   │   ├── components/           # Banner, Message, PromptInput, Thinking, StatusBar,
│   │   │                         #   later ToolCall, PermissionDialog, TodoList
│   │   ├── markdown.jsx          # Markdown → Ink (marked lexer + our renderers), safeSplitPoint for streaming
│   │   └── headless.js           # text | json | stream-json writers
│   └── util/
│       ├── frontmatter.js        # Tiny YAML-subset frontmatter parser
│       ├── paths.js              # Project root, slug, home dirs, path safety
│       └── log.js                # Debug log to file (NOOBLY_DEBUG=1)
├── test/
│   ├── fixtures/                 # Recorded SSE streams, sample repos
│   ├── unit/                     # One file per module
│   ├── loop/                     # Mock-provider loop scenarios
│   └── evals/                    # (Phase 19) scripted end-to-end tasks
└── .claude/
    ├── specs/                    # This spec set
    └── docs/                     # Beginner-friendly write-up per phase
```

## 4. Core data model

We adopt the Anthropic Messages format as the canonical internal representation.

```js
/** @typedef {'user'|'assistant'} Role */

/** @typedef {
 *  | { type: 'text', text: string }
 *  | { type: 'tool_use', id: string, name: string, input: object }
 *  | { type: 'tool_result', tool_use_id: string, content: string | ContentBlock[], is_error?: boolean }
 *  | { type: 'image', source: { type: 'base64', media_type: string, data: string } }
 *  | { type: 'thinking', thinking: string, signature: string }
 * } ContentBlock */

/** @typedef {{ role: Role, content: string | ContentBlock[] }} Message */
```

Key invariants the harness must maintain (and the tests must enforce):

- Every `tool_use` block in an assistant message is answered by exactly one `tool_result` with the same id, **in the very next user message**, before any other content.
- Messages alternate `user` / `assistant`.
- `thinking` blocks are passed back unmodified when present.
- On interrupt mid-tool, the harness synthesises `tool_result`s (`is_error: true`, "Interrupted by user") so the history stays valid.

## 5. Providers (Phases 1, 3, 18)

```js
/**
 * @typedef {Object} Provider
 * @property {string} name
 * @property {(req: ModelRequest, opts: { signal: AbortSignal }) => AsyncIterable<StreamEvent>} stream
 * @property {(req: ModelRequest) => Promise<number>} [countTokens]
 */

/**
 * @typedef {Object} ModelRequest
 * @property {string} model
 * @property {Array<{type:'text', text:string, cache_control?:object}>} system
 * @property {Message[]} messages
 * @property {ToolSchema[]} tools
 * @property {number} max_tokens
 */
```

### Anthropic adapter
- `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`, body `stream: true`.
- **SSE parser** (`sse.js`) turns the byte stream into events: `message_start`, `content_block_start`, `content_block_delta` (`text_delta` | `input_json_delta` | `thinking_delta`), `content_block_stop`, `message_delta` (carries `stop_reason` + final `usage`), `message_stop`, `ping`, `error`.
- The adapter re-emits these as normalised `StreamEvent`s and **accumulates** the final assistant message; tool-input JSON is concatenated from `partial_json` fragments and parsed at `content_block_stop`.
- **Retry** (`retry.js`): retries on 429, 500, 502, 503, 529 and network errors, exponential backoff with jitter, honours `retry-after`; retries only if no content has been streamed yet for that request.
- Handled stop reasons: `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `pause_turn`, `refusal`.

### Mock provider
Takes a script — an array of assistant turns — and yields them as stream events. Lets tests assert the full loop (tool dispatch, permission denials, hooks, compaction) with zero network.

```js
mockProvider([
  { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x.js' } }], stop_reason: 'tool_use' },
  { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' },
]);
```

### Model selection
| Role | Default | Used for |
|---|---|---|
| `main` | `claude-opus-5-5` | The agent loop |
| `small` | `claude-haiku-4-5` | Compaction summaries, session titles, WebFetch extraction |
| `subagent` | inherits `main` unless the agent definition overrides | Task tool |

All model IDs live in `config/defaults.js` alongside a price table used by `/cost`.

## 6. The agent loop (Phase 4)

The loop is an **async generator**: it yields events and returns when the turn is complete. This one design decision is what keeps UI, tests, headless mode and subagents trivially simple.

```js
// src/core/loop.js — shape, not final code
async function* runTurn(session, userContent, { signal }) {
  await hooks.run('UserPromptSubmit', ...);           // may block / add context
  session.history.push(userMessage(userContent, reminders.collect(session)));

  for (let i = 0; i < session.settings.maxTurns; i++) {
    await context.maybeCompact(session);              // Phase 8
    const request = context.buildRequest(session);    // system + tools + messages + cache_control

    const assistant = yield* streamAssistant(session.provider, request, signal);
    session.history.push(assistant);
    session.usage.add(assistant.usage);

    if (assistant.stop_reason !== 'tool_use') {
      const stop = await hooks.run('Stop', ...);      // may force continuation
      if (!stop.continue) return;
      continue;
    }

    const results = yield* executeTools(session, toolUses(assistant), signal);
    session.history.push({ role: 'user', content: results });
  }
  yield { type: 'error', message: 'Max turns reached' };
}
```

### Tool execution pipeline (per `tool_use` block)

```
tool_use ─► lookup in registry ─► validate input (JSON schema subset)
        ─► PreToolUse hooks (may deny / modify input)
        ─► permission gate: allow | deny | ask(user)
        ─► tool.call(input, ctx)  (with AbortSignal, timeout)
        ─► truncate output
        ─► PostToolUse hooks (may append feedback)
        ─► tool_result { content, is_error }
```

Concurrency: consecutive tool calls where every tool `isReadOnly` run in parallel (`Promise.all`, capped at ~8); any mutating tool forces serial execution in model order.

## 7. Tools (Phases 4–5, 11, 13–15)

```js
/**
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} description          // Written for the model. Includes when NOT to use it.
 * @property {object} inputSchema          // JSON Schema (object) sent to the API
 * @property {boolean | ((input) => boolean)} isReadOnly
 * @property {(input, ctx) => string} [permissionKey]  // e.g. "npm test" for Bash, a path for Edit — used for rule matching
 * @property {(input, ctx: ToolContext) => Promise<ToolOutput>} call
 * @property {(input) => string} [summarize]           // one-line UI label, e.g. "Read src/loop.js"
 */

/**
 * Implemented additions:
 * @property {(input, session) => boolean} [isConcurrencySafe]  // Phase 13: may run in parallel with other safe calls (defaults to isReadOnly)
 */

/** @typedef {{ content: string | ContentBlock[], isError?: boolean, display?: string, usage?: Usage, cost?: number }} ToolOutput */
// usage/cost: a tool that calls a model (Task) reports it, and the loop adds it to the turn.

/**
 * @typedef {Object} ToolContext
 * @property {string} cwd
 * @property {AbortSignal} signal
 * @property {Session} session           // readFiles set, todo state, settings
 * @property {(e: Event) => void} emit    // progress events for long-running tools (a channel the loop yields from)
 * @property {string} toolUseId           // the tool_use this call answers
 */
```

Built-in tool design rules (the "why" is a learning objective in Phase 5):

| Tool | Key design decisions |
|---|---|
| `Read` | Absolute paths; `cat -n` style line numbers; default 2000-line window; records path + mtime in `session.readFiles` |
| `Write` | Refuses to overwrite a file not in `readFiles` or modified since read — prevents blind clobbering |
| `Edit` | `old_string` must match exactly once (or `replace_all`); error message tells the model *how many* matches so it can add context |
| `Glob` | Uses `fs.glob`; respects `.gitignore`; sorted by mtime so recent files surface first |
| `Grep` | Spawns `rg` with `--json` if found on PATH; JS fallback walks files; `head_limit` to cap results |
| `Bash` | `spawn('bash', ['-c', cmd])`; tracks cwd across calls by appending `; pwd` sentinel; default 2 min timeout; output truncated to ~30k chars with head+tail kept; kills process group on abort |

## 8. Permissions (Phase 6)

```
decide(tool, input, session) →
  1. any deny rule matches                   → deny   (even in bypass)
  2. mode === 'bypass'                       → allow
  3. mode === 'plan' && !tool.isReadOnly     → deny ("in plan mode")
  4. any allow rule matches                  → allow
  5. session "always allow" grants match     → allow
  6. tool.isReadOnly && path inside project  → allow
  7. mode === 'acceptEdits' && tool ∈ {Edit, Write} && path inside project → allow
  8. otherwise                               → ask
```

Rule syntax: `ToolName` or `ToolName(specifier)`.

| Rule | Matches |
|---|---|
| `Read` | every Read call |
| `Bash(npm test)` | exactly `npm test` |
| `Bash(git diff:*)` | commands starting with `git diff` |
| `Edit(src/**)` | edits under `src/` (glob relative to project root) |
| `Read(**/.env*)` | any `.env` file |
| `mcp__github__*` | any tool from the `github` MCP server |

Compound Bash commands (`&&`, `;`, `|`) are split and **every** segment must be allowed. The `ask` path calls a `requestPermission` callback injected by the front-end — interactive UI shows a dialog, headless mode denies (or allows if `--permission-mode` says so). Deny reasons are returned to the model as the `tool_result`.

## 9. Context management (Phases 7–9)

### 9.1 System prompt assembly
Ordered sections, each a pure function `(session) => string | null`:

1. Identity & tone
2. How to use tools (prefer dedicated tools over Bash, read before edit, etc.)
3. Safety & permission behaviour
4. Environment: cwd, platform, date, git branch + short status, is-git-repo
5. Skills list (name + description only) — Phase 15
6. Available subagents — Phase 13
7. Memory index — Phase 16
8. Project instructions (`NOOBLY.md` chain: `~/.noobly/NOOBLY.md` → ancestors → project root)

Static sections come first, dynamic ones last — this maximises prompt-cache hits.

### 9.2 Reminders
Transient harness context (current todo list, "file X changed on disk since you read it", "you are in plan mode") is appended to the next user message wrapped in `<system-reminder>` tags rather than mutating the system prompt, so the cached prefix stays stable.

### 9.3 Token budget & compaction
- Actual usage comes from API `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
- Pre-flight estimate: `chars / 4`, or the `count_tokens` endpoint when precision matters.
- **Auto-compact** when estimated next-request size > `compactThreshold` (default 0.8 × model context window):
  1. Fire `PreCompact` hook.
  2. Ask the `small` model to summarise the history into a structured summary (goal, decisions, files touched, open todos, next step).
  3. Replace history with `[summary as user message, last N raw messages]`, ensuring no orphaned `tool_use`/`tool_result` pairs at the cut point.
- **Micro-compaction**: old tool results (e.g. > 20 turns ago) are replaced with `[output elided — re-run tool if needed]` before full compaction is needed.

### 9.4 Prompt caching
Up to 4 `cache_control: { type: 'ephemeral' }` breakpoints: end of tools, end of system prompt, and the last two user messages. `/cost` shows cache read vs write tokens so the learner can *see* caching work.

## 10. Sessions & transcripts (Phase 9)

- Path: `~/.noobly/projects/<slug(cwd)>/<uuid>.jsonl`.
- One JSON object per line: `{ ts, type: 'message'|'event'|'meta'|'compact', data }`.
- Append-only; compaction writes a `compact` boundary rather than rewriting the file.
- Resume = replay lines after the last `compact` boundary into `session.history`.
- The transcript writer is just another event consumer.

## 11. Configuration (Phase 10)

```jsonc
// .noobly/settings.json
{
  "model": "claude-opus-5-5",
  "smallModel": "claude-haiku-4-5",
  "maxTurns": 50,
  "permissions": {
    "defaultMode": "default",
    "allow": ["Bash(npm test:*)", "Bash(git status)", "Bash(git diff:*)"],
    "deny":  ["Read(**/.env*)", "Bash(rm -rf:*)", "Bash(git push --force:*)"]
  },
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "command": "node .noobly/hooks/guard.js" }],
    "PostToolUse": [{ "matcher": "Edit|Write", "command": "npx prettier --write \"$NOOBLY_FILE\"" }]
  },
  "env": { "NODE_ENV": "development" }
}
```

Merge rules: scalars override; arrays under `permissions.*` concatenate + dedupe; `hooks` concatenate per event. `settings.js` returns `{ value, sources }` so `noobly config` can explain provenance.

## 12. Hooks (Phase 12)

- Event payload on stdin (JSON): `{ event, session_id, cwd, tool_name?, tool_input?, tool_output?, prompt? }`.
- Result interpretation:
  | Exit code | Meaning |
  |---|---|
  | 0 | OK. If stdout is JSON, honour fields: `decision: "block"|"allow"`, `reason`, `updatedInput`, `additionalContext` |
  | 2 | Block. stderr is sent to the model as the reason |
  | other | Non-blocking error, shown to the user only |
- `matcher` is a regex on tool name. Timeout default 60s. Hooks run with the project root as cwd.

## 13. Subagents (Phase 13)

A subagent is **a new Session with a fresh history**, a restricted tool list, its own system prompt, and the parent's permission gate. The `Task` tool:

1. Looks up the agent definition (`general`, `explore`, or `.noobly/agents/<name>.md`).
2. Creates a child session; runs `runTurn(child, prompt)` to completion, forwarding progress events to the parent UI (indented / collapsed).
3. Returns **only the final assistant text** as the `tool_result`.

Multiple `Task` calls in one response run in parallel (they are treated as read-only for scheduling if their toolset is read-only). Subagents cannot spawn subagents (depth limit 1) to keep the lesson simple.

## 14. MCP client (Phase 14)

- Transport: spawn server process, newline-delimited JSON-RPC 2.0 over stdin/stdout.
- Handshake: `initialize` → `notifications/initialized` → `tools/list`.
- Each MCP tool becomes a `Tool` named `mcp__<server>__<tool>`, `inputSchema` passed through, `call` → `tools/call`, result `content` mapped to content blocks.
- MCP tools are treated as **not read-only** unless the server annotates `readOnlyHint: true`.
- Servers are started lazily at session start and killed on exit; connection failures are reported but non-fatal.

## 15. Skills (Phase 15)

```
.noobly/skills/release-notes/
├── SKILL.md          # ---\nname: release-notes\ndescription: Use when ...\n---\n<instructions>
└── template.md       # optional supporting files
```

- At startup only `name` + `description` are listed in the system prompt (cheap).
- The `Skill` tool returns the full `SKILL.md` body plus the skill directory path, so the model can `Read` supporting files on demand. This is **progressive disclosure** — the core lesson of the phase.

## 16. Memory (Phase 16)

- Directory: `~/.noobly/projects/<slug>/memory/`, one fact per markdown file with frontmatter, plus `MEMORY.md` index.
- `MEMORY.md` is injected into the system prompt; individual files are read on demand.
- No special tool: the model uses `Read`/`Write`/`Edit`, and the system prompt explains the conventions. The lesson is that memory is *just context engineering + files*.

## 17. Front-ends (Phases 2, 3, 17, 18)

### Interactive (Ink)
- Built with **Ink** (React for the terminal) + `ink-text-input` + `ink-spinner`; JSX is compiled on load by `tsx` (registered in `bin/noobly.js`).
- `src/ui/App.jsx` holds UI state; finished transcript entries render inside `<Static>` (printed once, becomes scrollback); only the spinner/input/status bar re-render.
- Components in `src/ui/components/`: `Banner`, `Message`, `PromptInput`, `Thinking`, `StatusBar`; later `ToolCall`, `PermissionDialog`, `TodoList`.
- Events → UI: streamed text, `● Read(src/loop.js)` style tool lines with `⎿` result summaries, spinner while waiting, permission dialog.
- `useInput` for `Esc`/`Ctrl+C`/`Shift+Tab` handling.
- Interrupt: a per-turn `AbortController`; abort propagates to fetch and child processes.

### Headless
- `-p` reads prompt from arg or stdin.
- `--output-format text` (final text only), `json` (single result object with usage/cost), `stream-json` (one event per line).

### Library
```js
const { query } = require('noobly');
for await (const event of query({ prompt: 'List TODOs', options: { cwd, permissionMode: 'plan' } })) { ... }
```

## 18. Events

```js
/** @typedef {
 *  | { type: 'turn_start' }
 *  | { type: 'text_delta', text: string }
 *  | { type: 'thinking_delta', text: string }
 *  | { type: 'assistant_message', message: Message }
 *  | { type: 'tool_start', id: string, name: string, input: object, summary: string }
 *  | { type: 'tool_progress', id: string, text: string }
 *  | { type: 'tool_end', id: string, output: ToolOutput, durationMs: number }
 *  | { type: 'permission_request', tool: string, input: object }
 *  | { type: 'usage', usage: Usage, costUsd: number }
 *  | { type: 'compact', before: number, after: number }
 *  | { type: 'subagent', agent: string, event: Event }
 *  | { type: 'error', message: string, retryable?: boolean }
 *  | { type: 'turn_end', stopReason: string }
 * } Event */
```

## 19. Error handling

| Failure | Behaviour |
|---|---|
| Tool throws | Caught → `tool_result` `is_error: true` with message; loop continues |
| Unknown tool / bad input | `is_error` result listing valid tools / the validation error |
| API 4xx (non-429) | Surface error event, end turn, keep session alive |
| API 429/5xx/529 | Retry with backoff (`error` event with `retryable: true` for UI) |
| Network drop mid-stream | If no tool call is pending, retry the whole request; otherwise surface |
| User interrupt | Abort fetch + child processes; synthesise interrupted `tool_result`s; end turn |
| `max_tokens` | If mid-tool-input, discard partial tool call and ask the model to continue with smaller steps |

## 20. Testing strategy

| Layer | Approach |
|---|---|
| SSE parser | Recorded fixture streams (`test/fixtures/*.sse`), including split chunks at arbitrary byte boundaries |
| Tools | Temp directories (`fs.mkdtemp`), real filesystem, no mocks |
| Permissions | Table-driven tests: `(rules, mode, tool, input) → decision` |
| Loop | Mock provider scripts: multi-tool turns, errors, denials, interrupts, max turns, compaction |
| Hooks | Tiny node scripts as hooks in fixtures |
| MCP | An in-repo toy MCP server (`test/fixtures/echo-mcp.js`) |
| Evals (Phase 19) | Real model, opt-in via `npm run eval`; each case = starter repo + prompt + checker script |

Run with `node --test` (`npm test`). Network tests are behind `NOOBLY_LIVE=1`.

## 21. Dependency policy

| Phase | Allowed runtime deps | Rationale |
|---|---|---|
| 00+ (UI only) | `ink`, `react`, `ink-text-input`, `ink-spinner`, `tsx` | Rich terminal UI; `tsx` runs JSX with no build step |
| 0–11 (core) | none | Learn the primitives |
| 12+ | none expected | Hooks/MCP are just `child_process` + JSON |
| 07+ (UI only) | `marked` | Markdown **parsing** (tokens only; drawing is our own Ink code). Pulled forward from Phase 17 |
| 17 | *optional* `cli-highlight` | Syntax highlighting in code blocks, if wanted |
| 18 | *optional* `@anthropic-ai/sdk` | As a *second* provider adapter for comparison, not a replacement |

Dev deps: none required (`node:test`, `node:assert`). Optional: `typescript` for `tsc --noEmit` checking of JSDoc types.

## 21b. Implemented extras (Phases 16–19)

- **Permission globs** use `globMatches()` (rules.js), not `path.matchesGlob`: `*`/`**` match dot-names so deny rules cover `.ssh/`, `.aws/`, `.config/`; `~/` expands to home.
- **Tools** may set `needsPermission: true` (read-only but still asks: WebFetch, per domain) and `isConcurrencySafe(input)`.
- **Events** added: `thinking_delta`, `stream_reset` (mid-reply restart), `subagent`; `turn_end` carries `trace`.
- **Headless result** object: `{ type: 'result', subtype, is_error, result, stop_reason, num_rounds, num_tool_calls, duration_ms, usage, total_cost_usd, model, session_id }`; exit codes 0 / 1 / 130.
- **Evals** live in `test/evals/` (cases with `repo/`, `solution/`, `check.js`); `npm run eval`.

## 22. Security considerations

- API key read only from env; redacted in debug logs and never written to transcripts.
- Default deny rules for secret files (`.env*`, `*.pem`, `id_rsa*`, `~/.aws/**`).
- File tools resolve symlinks and reject paths outside the project root unless explicitly allowed.
- `bypass` mode requires `--dangerously-skip-permissions` and prints a red banner.
- Content fetched by `WebFetch` and returned by MCP servers is treated as untrusted data; the system prompt says so explicitly (prompt-injection lesson in Phase 18).
- Hooks and MCP servers run arbitrary user-configured commands — only loaded from settings files the user controls; project-level hook/MCP config requires a one-time trust confirmation per project (`src/config/trust.js`: a fingerprint of the exact commands in `~/.noobly/trusted-projects.json`, so changes ask again; `noobly trust` for print mode).
