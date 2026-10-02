# Roadmap — Noobly Learn Harness

| Field | Value |
|---|---|
| Status | v1 built · v2 built (Phase 23 skipped) |
| Date | 2026-09-29 (v2 plan added 2026-09-30) |
| Related | [PRD.md](./PRD.md) · [Architecture.md](./Architecture.md) |

The build is split into **5 milestones** and **20 phases** for v1, plus **3 milestones** and **11 phases** for v2 (below). Each phase teaches **one concept**, ends in a **runnable checkpoint**, and is tagged in git (`phase-00` … `phase-30`) so you can diff any two phases to see exactly what a concept costs in code.

```
M1 Talk          M2 Act               M3 Context & Control            M4 Extend                        M5 Ship
┌──┬──┬──┬──┐   ┌──┬──┬──┐           ┌──┬──┬──┬──┬──┐                ┌──┬──┬──┬──┬──┐                 ┌──┬──┬──┐
│00│01│02│03│ → │04│05│06│         → │07│08│09│10│11│              → │12│13│14│15│16│               → │17│18│19│
└──┴──┴──┴──┘   └──┴──┴──┘           └──┴──┴──┴──┴──┘                └──┴──┴──┴──┴──┘                 └──┴──┴──┘
scaffold→stream  loop→tools→perms    prompt→window→sessions→cfg→plan hooks→agents→MCP→skills→memory   headless→robust→evals

v2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
M6 Unattended      M7 Better results per task          M8 Scale & reach
┌──┬──┬──┐        ┌──┬──┬──┬──┬──┬──┐                   ┌──┬──┐
│20│21│22│      → │23│24│25│26│27│28│                 → │29│30│
└──┴──┴──┘        └──┴──┴──┴──┴──┴──┘                   └──┴──┘
sandbox→rewind→bg  evals→feedback→edits→output→map→see   worktrees→editors
```

---

## How to work each phase

1. **Branch**: `git switch -c phase-NN-<slug>`.
2. **Read** the phase's *Concept* and *Questions to answer* before writing code.
3. **Build** the tasks. Keep each new concept in its own file (see [Architecture §3](./Architecture.md#3-directory-layout)).
4. **Test**: `npm test` passes offline. Add the listed tests.
5. **Checkpoint**: run the demo command and see the expected behaviour.
6. **Write up**: add a `NN-<topic>.md` doc to `.claude/docs/` (and link it from `.claude/docs/README.md`): *what the concept is, what surprised you, what you'd do differently, how Claude Code appears to do it.*
7. **Merge & tag**: merge to `main`, `git tag phase-NN`.

From **Phase 07 onward**, try to have `noobly` itself implement at least one task of each phase (reviewing everything it does). Using the tool you're building is the fastest way to find out what's missing.

---

# Milestone 1 — Talk
*Goal: understand what a model API actually is, and hold a streamed conversation with it.*

## Phase 00 — Scaffold
**Concept:** Project skeleton, entry points, test runner, no dependencies.

> ✅ **Done 2026-09-29**, see [.claude/docs/00-project-setup.md](../docs/00-project-setup.md). Deviations: ES modules instead of CommonJS; Ink UI + `tsx` added here.

**Build**
- `bin/noobly.js` with shebang; `package.json` `"bin": { "noobly": "bin/noobly.js" }`; `npm link` for local use.
- `src/index.js` exporting nothing yet; `src/util/log.js` (debug log to `~/.noobly/debug.log` when `NOOBLY_DEBUG=1`).
- `npm test` → `node --test test/`; one trivial passing test.
- `// @ts-check` + JSDoc convention; optional `tsc --noEmit` script.
- `.claude/docs/` with a template section.
- Minimal arg parsing with `node:util` `parseArgs` (`--help`, `--version`).

**Checkpoint:** `noobly --version` prints the version; `npm test` is green.

**Out of scope:** any model calls.

---

## Phase 01 — Hello, model
> ✅ **Done 2026-09-29** (built as a prerequisite of Phase 02), see [.claude/docs/01-talking-to-the-model.md](../docs/01-talking-to-the-model.md).

**Concept (C1):** The Messages API — roles, content blocks, system prompts, tokens, stop reasons, cost.

**Questions to answer**
- What exactly goes over the wire? What comes back?
- What is a token, and why do input and output tokens cost different amounts?
- What does `stop_reason` tell you?

**Build**
- `src/providers/anthropic.js`: `complete(request)` using raw `fetch` to `POST /v1/messages` (non-streaming).
- Read `ANTHROPIC_API_KEY` from env; clear error if missing.
- `src/config/defaults.js` with model IDs (`claude-opus-5-5`, `claude-haiku-4-5`) and a price table.
- `noobly -p "hello"` prints the text reply, then a dim line: `in: 12 · out: 34 · $0.0004 · end_turn`.
- `--verbose` dumps the raw request/response JSON (key redacted).

**Tests:** request builder produces correct headers/body (no network); cost calculator.

**Checkpoint:** `noobly -p "Explain a token in one sentence" --verbose` — read the raw JSON and annotate it in your phase doc.

**Stretch:** try `max_tokens: 5` and observe `stop_reason: "max_tokens"`.

---

## Phase 02 — Conversation state & the REPL
> ✅ **Done 2026-09-29**, see [.claude/docs/02-conversation-and-the-rich-ui.md](../docs/02-conversation-and-the-rich-ui.md). Built with an **Ink** UI instead of raw `readline`; added `/model`, `/history` and an offline `--echo` provider.

**Concept (C2):** The model is stateless. The *harness* owns the conversation and replays it every turn.

**Questions to answer**
- Why does turn 20 cost more than turn 1?
- What happens if two `user` messages are sent in a row?

**Build**
- `src/core/session.js`: holds `history: Message[]`, `usage`, `settings`.
- `src/ui/App.jsx`: Ink chat screen (input box, spinner, status bar); `noobly` with no args starts it.
- Each input → append user message → call API with full history → append assistant message → print.
- Built-in commands handled directly for now: `/exit`, `/clear` (reset history), `/cost` (cumulative usage).
- A fixed system prompt string ("You are noobly, a helpful coding assistant…").

**Tests:** session appends alternate correctly; `/clear` resets history and usage.

**Checkpoint:** Tell it your name, ask it three turns later — it remembers. `/clear`, ask again — it doesn't. Watch `/cost` grow super-linearly.

---

## Phase 03 — Streaming & interrupts
> ✅ **Done 2026-09-29**, see [.claude/docs/03-streaming-and-interrupts.md](../docs/03-streaming-and-interrupts.md). `esc` also interrupts; finished paragraphs move into Ink's `<Static>` as they complete.

**Concept (C3, C18 intro):** Server-sent events, incremental rendering, cancelling in-flight work.

**Questions to answer**
- Why does streaming *feel* faster even when total time is the same?
- How do you parse a stream when a chunk can end mid-line (or mid-UTF-8 character)?

**Build**
- `src/providers/sse.js`: a streaming SSE parser over `response.body` (`TextDecoder` with `stream: true`, buffer until `\n\n`).
- `anthropic.stream(request, { signal })` as an async generator of normalised events; accumulate the final message.
- `src/providers/mock.js`: scripted provider yielding the same events (used by all loop tests from here on).
- `src/core/events.js`: event typedefs; the REPL now *consumes events*, it no longer calls the provider directly.
- `src/ui/render.js` + `spinner.js`: spinner until first token, then streamed text.
- `Ctrl+C` during a response aborts the turn via `AbortController` (keep partial text in history, marked interrupted); `Ctrl+C` at an empty prompt twice exits.
- `src/providers/retry.js`: backoff for 429/529/5xx, honouring `retry-after`.

**Tests:** SSE parser against recorded fixtures split at random byte boundaries; retry schedule; abort stops iteration.

**Checkpoint:** Ask for a long poem; text streams; hit `Ctrl+C` halfway; the prompt returns and the session continues.

---

# Milestone 2 — Act
*Goal: the smallest real agent — a model that can call tools, in a loop, safely.*

## Phase 04 — The agent loop
> ✅ **Done 2026-09-29**, see [.claude/docs/04-the-agent-loop.md](../docs/04-the-agent-loop.md). Tools run one at a time for now (parallel read-only execution moves to Phase 05); the echo provider also demonstrates tool use (`read <file>`).

**Concept (C4):** Tool use. `tool_use` → execute → `tool_result` → call the model again, until `end_turn`. **This is the heart of every agent harness.**

**Questions to answer**
- Who actually runs the tool — the model or the harness?
- Why must every `tool_use` get a `tool_result` in the *next* message?
- What stops the loop from running forever?

**Build**
- `src/tools/tool.js`: `Tool` typedef + `defineTool()` + minimal JSON-schema validation (required, type, enum).
- `src/tools/registry.js`: register tools, export API schemas.
- One tool only: **`Read`** (path + optional offset/limit, line-numbered output).
- `src/core/loop.js`: `runTurn()` async generator — the loop from [Architecture §6](./Architecture.md#6-the-agent-loop-phase-4); handles multiple `tool_use` blocks per response; tool errors → `is_error: true`; `maxTurns` limit.
- Streaming of `input_json_delta` → parse tool input at `content_block_stop`.
- Render `● Read(package.json)` and a dim `⎿ 18 lines` summary.

**Tests (mock provider):** single tool call; two tool calls in one response; unknown tool → error result; tool throws → error result; max turns hit; interrupt mid-tool produces synthetic results and valid history.

**Checkpoint:** `noobly -p "What is the name field in package.json?"` → it reads the file and answers correctly.

**Stretch:** Put a `console.log` of every request's `messages` length and watch the loop grow the history.

---

## Phase 05 — A real toolset
> ✅ **Done 2026-09-29**, see [.claude/docs/05-a-real-toolset.md](../docs/05-a-real-toolset.md). Tools can return `preview` lines (edit diffs, command output) shown in the UI; the echo provider demos every tool.

**Concept (C5):** Tool design. Why Claude-Code-style tools look the way they do, and why error messages are really prompts.

**Questions to answer**
- Why exact-string `Edit` instead of line numbers or diffs?
- Why a dedicated `Grep`/`Glob` when `Bash` could do it?
- What makes a good tool description?

**Build**
- `Write` (require prior Read if the file exists; track `readFiles` with mtime).
- `Edit` (`old_string`/`new_string`/`replace_all`; errors report match count).
- `Glob` (`fs.glob`, `.gitignore`-aware, mtime-sorted, capped).
- `Grep` (`rg --json` if available, JS fallback; `output_mode`: files_with_matches | content | count; `-i`, `glob`, `head_limit`).
- `Bash` (spawn in process group, timeout, persistent cwd, output truncation keeping head+tail, kill on abort).
- Read-only tools run concurrently in one turn; mutating ones serially.
- Rewrite tool descriptions deliberately — include *when not to use* each tool.

**Tests:** each tool against a temp directory: edit not found / not unique / replace_all; write-without-read refused; bash timeout; bash cwd persistence; grep fallback parity with rg.

**Checkpoint:** In a scratch copy of this repo: `noobly -p "Add a --verbose flag description to the --help output"` — it finds, reads, edits and verifies.

⚠️ **Until Phase 06 lands, only run mutating tools in a throwaway directory or a clean git tree.**

---

## Phase 06 — Permissions & safety
> ✅ **Done 2026-09-29** (together with Phase 07), see [.claude/docs/06-permissions.md](../docs/06-permissions.md). Rules come from defaults, `--allow`/`--deny` and `/permissions` until settings files exist (Phase 10).

**Concept (C6):** Human-in-the-loop control. Read-only vs mutating, allow/ask/deny rules, permission modes.

**Questions to answer**
- Why is the permission check in the harness and not in the prompt?
- Why must deny beat allow?
- How can `Bash(npm test:*)` be bypassed with `npm test && rm -rf /`, and how do you stop that?

**Build**
- `src/permissions/rules.js`: parse `Tool` / `Tool(specifier)`; matchers for Bash prefix (`:*`), path globs, MCP wildcards.
- `src/permissions/gate.js`: the decision order from [Architecture §8](./Architecture.md#8-permissions-phase-6); compound Bash splitting.
- `src/permissions/modes.js`: `default`, `acceptEdits`, `plan`, `bypass` (`--dangerously-skip-permissions` + banner). `Shift+Tab` cycles modes in the REPL.
- `src/ui/prompt-permission.js`: *Yes / Yes, always for this session / No, and tell noobly why*.
- Denials return a `tool_result` the model can act on.
- Path safety: resolve symlinks; outside-project paths require explicit allow.
- Default deny list: `.env*`, keys, `rm -rf`, `git push --force`.
- `/permissions` lists effective rules.

**Tests:** table-driven gate tests (≥ 30 cases); compound command splitting; symlink escape blocked; loop scenario where denial leads the mock model to a different tool.

**Checkpoint:** Ask it to delete a file → you're prompted → deny with "use git rm instead" → watch it adapt. Switch to plan mode and ask for an edit → refused with explanation.

**🎯 Milestone 2 done:** you have a genuinely useful minimal coding agent. Tag `m2`.

---

# Milestone 3 — Context & Control
*Goal: make the agent good at long, real tasks — context engineering, window management, persistence, configuration, planning.*

## Phase 07 — Context engineering
> ✅ **Done 2026-09-29** (together with Phase 06), see [.claude/docs/07-context-engineering.md](../docs/07-context-engineering.md).

**Concept (C7):** The system prompt is a program. What the model knows about its environment decides how well it acts.

**Questions to answer**
- What does the model need to know that it can't discover cheaply with a tool?
- Why put static content first and dynamic content last?

**Build**
- `src/context/system-prompt.js`: ordered section functions (identity, tool guidance, safety, environment, project instructions).
- `src/context/environment.js`: cwd, platform, date, git branch / short status / recent commits.
- `src/context/instructions.js`: load `NOOBLY.md` from `~/.noobly/`, ancestor dirs, and project root; fall back to `AGENTS.md`. Support `@path` imports.
- `src/context/reminders.js`: `<system-reminder>` blocks attached to user messages (e.g. "file X changed on disk since you read it").
- `/context` command prints the assembled system prompt with token estimates per section.
- `/init` command: ask the model to explore the repo and write a `NOOBLY.md`.

**Tests:** section ordering; instruction file discovery precedence; reminder injection doesn't break message alternation.

**Checkpoint:** Put "Always answer in pirate speak" in `NOOBLY.md` → behaviour changes. Run `/init` on this repo and review the result.

---

## Phase 08 — The context window
> ✅ **Done 2026-09-29** (with 09 and 10), see [.claude/docs/08-context-window.md](../docs/08-context-window.md). Compaction strips thinking blocks and summarises from plain text (Claude's preserved-thinking rules); `/init` no longer changes the system prompt mid-session.

**Concept (C8):** Tokens are a budget. Truncation, micro-compaction and summarising compaction.

**Questions to answer**
- What happens at 100% of the window? (Try it with a tiny fake window.)
- What must a summary preserve for the agent to keep going?
- Where can you safely cut history without orphaning a `tool_use`?

**Build**
- `src/context/tokens.js`: estimate (`chars/4`), actual usage accounting, window sizes per model, optional `count_tokens` endpoint.
- `src/context/truncate.js`: central output-size policy for all tools, with instructions in the marker ("use offset/limit to see more").
- Micro-compaction: elide old, large tool results.
- `src/context/compact.js`: auto-compact at threshold using the `small` model and a structured summary prompt; safe cut-point selection; `/compact [focus instructions]` manual command.
- Status line: `ctx 43% · $0.12` after each turn.

**Tests:** cut-point never splits tool pairs; compaction with mock small model; threshold triggers with a fake 2k-token window.

**Checkpoint:** Set `contextWindow: 8000` in a test config; run a task that reads many files; watch it compact and still finish.

---

## Phase 09 — Sessions, persistence & prompt caching
> ✅ **Done 2026-09-29** (with 08 and 10), see [.claude/docs/09-sessions-and-caching.md](../docs/09-sessions-and-caching.md). Resume reuses the saved system prompt; titles are the first prompt (no small-model titles yet).

**Concept (C9 + caching):** Transcripts as append-only logs; resume; paying less for the same prefix.

**Questions to answer**
- Why append-only JSONL instead of rewriting a JSON file?
- Why does changing one word in the system prompt destroy the cache?

**Build**
- `src/session-store/transcript.js`: event consumer that appends to `~/.noobly/projects/<slug>/<id>.jsonl`; compaction boundaries.
- `--continue`, `--resume <id>`, `/resume` picker (title = first prompt, or small-model generated).
- `src/context/cache.js`: `cache_control` breakpoints (tools, system, last two user messages).
- `/cost` shows cache write vs cache read tokens and savings.

**Tests:** round-trip write → resume → identical history; resume after compaction; breakpoint placement (≤ 4).

**Checkpoint:** Quit mid-task, `noobly --continue`, finish. Compare `/cost` for the same 5-turn session with and without caching.

---

## Phase 10 — Configuration & slash commands
> ✅ **Done 2026-09-29** (with 08 and 09), see [.claude/docs/10-configuration.md](../docs/10-configuration.md). Commands live in `src/commands/`; `allowed-tools` become temporary permission rules; bypass is refused from settings files.

**Concept (C10):** Layered settings with provenance; commands as a user-extensible surface.

**Build**
- `src/config/settings.js`: defaults → user → project → local → env → flags; merge rules from [Architecture §11](./Architecture.md#11-configuration-phase-10); provenance tracking.
- `noobly config` prints effective settings and their sources.
- `src/commands/registry.js`: move `/help /clear /cost /compact /resume /permissions /context /model /exit` into proper command modules.
- `src/commands/custom.js`: `.noobly/commands/<name>.md` → `/name args` (with `$ARGUMENTS` substitution and optional frontmatter `description`, `allowed-tools`).
- `/model` switches model mid-session.

**Tests:** merge precedence and array concatenation; custom command argument substitution.

**Checkpoint:** Add `.noobly/commands/review.md` ("Review the git diff for bugs: $ARGUMENTS") and run `/review focus on error handling`.

---

## Phase 11 — Planning & task tracking
> ✅ **Done 2026-09-29** (with 12–15), see [.claude/docs/11-planning.md](../docs/11-planning.md). Approving a plan offers *auto-accept edits* or *ask before each edit*; without a UI the model is told to give the plan as its answer. The todo reminder after auto-compaction goes into the same message.
**Concept (C11):** Keeping the model on track over long tasks: explicit plans and todo lists.

**Questions to answer**
- Why does a todo list tool improve long-task completion even though the model "could just remember"?
- What does plan mode buy you that a prompt instruction doesn't?

**Build**
- `TodoWrite` tool: full-list replacement with `pending | in_progress | completed`; rendered as a checklist in the UI; current todos added as a reminder after compaction.
- Plan mode UX: model explores read-only, then calls an `ExitPlanMode` tool with its plan; user approves → mode switches to `default`/`acceptEdits`.
- System prompt guidance on when to use todos.

**Tests:** todo state survives compaction; ExitPlanMode requires approval; plan mode blocks mutations.

**Checkpoint:** "Refactor the tools to share a truncation helper" in plan mode → review plan → approve → watch todos tick off.

**🎯 Milestone 3 done:** `noobly` can complete a real multi-file change in this repo with tests passing. Tag `m3`. From here, build the rest *with* `noobly`.

---

# Milestone 4 — Extend
*Goal: open the harness to user code and external capabilities without touching the core loop.*

## Phase 12 — Hooks
> ✅ **Done 2026-09-29** (with 11–15), see [.claude/docs/12-hooks.md](../docs/12-hooks.md). Examples: `block-rm-rf.js`, `check-syntax-after-edit.js` (instead of a formatter, to stay dependency-free), `tests-must-pass.js`. A hook's `"allow"` skips the question but never beats deny rules or plan mode. Stop continuations capped at 3. Trust is per project and fingerprinted; `noobly trust` for print mode.
**Concept (C12):** Deterministic lifecycle control. Code that always runs, instead of instructions the model might ignore.

**Build**
- `src/hooks/runner.js`: events `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `PreCompact`; regex matcher; JSON on stdin; exit-code + JSON-stdout protocol ([Architecture §12](./Architecture.md#12-hooks-phase-12)); timeout.
- Wire into the loop's tool pipeline and turn boundaries.
- Project-level hooks require a one-time trust prompt.
- Example hooks in `examples/hooks/`: block `rm -rf`, auto-format after edits, run tests on `Stop` and force continuation if failing.

**Tests:** block via exit 2 reaches the model; `updatedInput` modifies the call; timeout is non-fatal; Stop hook continuation is bounded.

**Checkpoint:** Install the "tests must pass before stopping" `Stop` hook and watch the agent fix a failing test it would otherwise have left.

---

## Phase 13 — Subagents
> ✅ **Done 2026-09-29** (with 11–15), see [.claude/docs/13-subagents.md](../docs/13-subagents.md). Parallelism uses a new optional `isConcurrencySafe(input)` on tools; progress flows through `ctx.emit` and a small channel (`src/core/channel.js`). Subagents also never get `ExitPlanMode`.
**Concept (C13):** Context isolation and delegation. A subagent spends tokens in *its* window and returns only a summary.

**Questions to answer**
- When is delegation cheaper than doing it inline? When is it more expensive?
- Why return a summary instead of the transcript?

**Build**
- `src/agents/definitions.js`: built-ins `general` (all tools) and `explore` (read-only tools, instructed to return concise findings); user agents from `.noobly/agents/*.md` (frontmatter `name`, `description`, `tools`, `model`).
- `src/agents/subagent.js` + `Task` tool: child session, restricted registry, shared permission gate, depth limit 1.
- Parallel `Task` calls; nested, collapsible progress rendering in the UI.
- Subagent usage rolled up into parent `/cost`.

**Tests:** child history isolated from parent; tool restriction enforced; parallel tasks both complete; result is final text only.

**Checkpoint:** "Find every place settings are read and every place they're written" → two parallel `explore` subagents; compare main-context tokens vs doing it inline.

---

## Phase 14 — MCP client
> ✅ **Done 2026-09-29** (with 11–15), see [.claude/docs/14-mcp.md](../docs/14-mcp.md). Also reads `"mcpServers"` and `~/.noobly/mcp.json`; calls time out and can be interrupted. Not done: resources, prompts, HTTP transport (stretch).
**Concept (C14):** A standard protocol for plugging external tools into any harness.

**Build**
- `src/mcp/client.js`: spawn stdio server, newline-delimited JSON-RPC 2.0, request/response correlation, `initialize` handshake, `tools/list`, `tools/call`, shutdown.
- `src/mcp/adapter.js`: MCP tool → `Tool` (`mcp__<server>__<tool>`), `readOnlyHint` → `isReadOnly`.
- Config in `.noobly/mcp.json` (`{ "servers": { "name": { "command", "args", "env" } } }`) with the same trust prompt as hooks.
- `/mcp` shows server status and tools; failed servers are reported, not fatal.
- `test/fixtures/echo-mcp.js`: a ~60-line toy server — writing a server teaches the protocol from both sides.

**Tests:** handshake and tool call against the toy server; server crash mid-call → error result; permissions rules match `mcp__*`.

**Checkpoint:** Connect a real community filesystem or git MCP server and use one of its tools.

**Stretch:** MCP resources and prompts; HTTP transport.

---

## Phase 15 — Skills
> ✅ **Done 2026-09-29** (with 11–14), see [.claude/docs/15-skills.md](../docs/15-skills.md). Read may open your personal skill folders (outside the project). Example: `examples/skills/release-notes/`.
**Concept (C15):** Progressive disclosure — advertise capabilities cheaply, load detail on demand.

**Build**
- `src/util/frontmatter.js` (tiny YAML subset) and `src/skills/loader.js`: discover `~/.noobly/skills/*/SKILL.md` and `.noobly/skills/*/SKILL.md`.
- Skills list (name + description) in the system prompt.
- `Skill` tool: returns the SKILL.md body and its directory so supporting files can be `Read`.
- `/skills` lists available skills; `/<skill-name>` invokes directly.

**Tests:** discovery and precedence; only descriptions appear in the system prompt; skill body loaded on call.

**Checkpoint:** Write a `release-notes` skill with a template file; ask "draft release notes for the last 10 commits" and confirm the skill is loaded only when needed (check `/context` before and after).

---

## Phase 16 — Memory
> ✅ **Done 2026-09-29** (with 17–19), see [.claude/docs/16-memory.md](../docs/16-memory.md). Write/Edit in the memory folder don't ask (deny rules and plan mode still apply); the index is re-read on `/clear`.
**Concept (C16):** Durable cross-session knowledge — and deciding what's worth remembering.

**Build**
- `src/memory/memory.js`: per-project memory dir, `MEMORY.md` index injected into the system prompt.
- System prompt section describing memory conventions (one fact per file, frontmatter, types `user | feedback | project | reference`, don't store what the repo already records).
- `/memory` to list/open memories; "remember that…" works via ordinary `Write`/`Edit`.

**Tests:** index loaded into prompt; memory dir is outside the project and allowed by default for file tools.

**Checkpoint:** "Remember that I prefer tabs over spaces" → new session → it uses tabs without being told.

**🎯 Milestone 4 done.** Tag `m4`.

---

# Milestone 5 — Ship
*Goal: make it scriptable, robust against the real world, and measurable.*

## Phase 17 — Headless mode, library API & terminal polish
> ✅ **Done 2026-09-29** (with 16, 18, 19), see [.claude/docs/17-headless-and-library.md](../docs/17-headless-and-library.md). `-p` is now a switch (prompt = words after it and/or stdin); session setup moved to `src/core/create-session.js`, shared by the CLI and `createSession()`/`query()`. Checkpoint script: `examples/library/summarize-tools.js`. Multi-line input uses `\` + Enter (no paste detection needed: pasted newlines are kept).
**Concept (C17):** The same loop, different front-ends. The harness as a building block.

**Build**
- `src/ui/headless.js`: `--output-format text | json | stream-json`; prompt from arg or stdin; exit codes reflect success.
- `--permission-mode`, `--allowed-tools`, `--max-turns` flags for unattended runs.
- `src/index.js`: `query({ prompt, options })` async iterator and `createSession()`.
- `src/ui/markdown.js`: headings, bold, inline/fenced code, lists (optional dep if it becomes a distraction).
  > ✅ **Pulled forward 2026-09-29**, see [.claude/docs/extra-markdown-rendering.md](../docs/extra-markdown-rendering.md): `src/ui/markdown.jsx` renders `marked` tokens (incl. tables, quotes, task lists) with Ink; streaming never splits a code block.
- Multi-line input (`\` continuation or paste detection), input history (↑/↓).

**Tests:** JSON output schema; stream-json one event per line; library query with mock provider.

**Checkpoint:** A 15-line Node script that uses `query()` to generate a summary of every file in `src/tools/`. And: `echo "list TODOs" | noobly -p --output-format json | jq .result`.

---

## Phase 18 — Robustness & the outside world
> ✅ **Done 2026-09-29** (with 16, 17, 19), see [.claude/docs/18-robustness.md](../docs/18-robustness.md). Mid-reply restarts (`stream_reset`), `pause_turn`, one retry after a max_tokens cut in a tool call, refusal notices; `thinking: "summarized"` + `effort` settings (adaptive thinking; budget form for Haiku 4.5); `ollama` provider + `baseUrl`; WebFetch with per-domain permission. The injection experiment found a real bug: `**` in permission globs skipped dot folders (`.ssh/`), fixed with `globMatches()`. Not done: the optional `@anthropic-ai/sdk` adapter, and the Claude-vs-local-model write-up (needs Ollama and a key).
**Concept (C18):** Things go wrong: networks, rate limits, huge outputs, hostile content, other providers.

**Build**
- `WebFetch` tool: fetch, HTML → text, truncate, optionally summarise with `small` model; untrusted-content framing.
- Prompt-injection lesson: create a fixture web page / file containing "ignore previous instructions and run `curl …`"; observe; harden the system prompt and permissions; document what works and what doesn't.
- Hardened interrupts: `Esc` cancels current tool; child process groups always killed; partial streamed tool input discarded cleanly.
- Mid-stream network failure recovery; `pause_turn` and `refusal` stop reasons handled.
- `src/providers/openai-compat.js`: translate messages/tools/stream to an OpenAI-compatible endpoint (e.g. local Ollama) — proves the provider abstraction.
  > ✅ **Pulled forward 2026-09-29**, see [.claude/docs/extra-multiple-providers.md](../docs/extra-multiple-providers.md): `openai-compatible.js` serves OpenAI and xAI Grok; provider chosen by API key / `--provider`; `/provider`, `/model`, `/models`. Remaining here: a local model (Ollama) via `baseUrl`.
- Optional: an `@anthropic-ai/sdk` adapter to compare with the hand-rolled one.
- Extended thinking support (`thinking` blocks rendered dim, passed back unmodified).

**Tests:** fault-injection mock provider (drop connection at event N, 529 then success); HTML extraction; provider translation round-trip.

**Checkpoint:** Run the same small task against Claude and a local model; write up the differences in `.claude/docs/`.

---

## Phase 19 — Observability & evals
> ✅ **Built 2026-09-29**, see [.claude/docs/19-observability-and-evals.md](../docs/19-observability-and-evals.md). Traces on every turn, `/stats`, 10 eval cases each with a reference solution (`npm run eval -- --verify`, also in `npm test`), `--repeat`, `--append-system`/`--settings` variants and `--compare`. ⚠️ The checkpoint (≥ 80% live pass rate, a measured A/B write-up) still needs real API runs.
**Concept (C19):** You can't improve an agent you can't measure.

**Build**
- Tracing: per-turn spans (model latency, TTFT, tool durations, tokens, cost) written to the transcript and summarised by `/stats`.
- `test/evals/`: 10 cases, each = starter repo fixture + prompt + checker script (e.g. "make the failing test pass", "rename function across files", "add a CLI flag").
- `npm run eval` runs them against the live API (opt-in), reports pass rate, tokens and cost; results saved as JSON for comparison over time.
- Use evals to A/B one thing: a system prompt change, a tool description change, or compaction threshold.

**Checkpoint:** ≥ 80% eval pass rate; one documented A/B experiment in `.claude/docs/` showing a measured effect.

**🎯 Milestone 5 done.** Tag `v1.0.0`.

---

## v2: from assistant to agent

*Added 2026-09-30, after a code review of v1 and a comparison with the leading harnesses (Claude Code, Codex CLI, Aider, OpenHands). See [PRD §14](./PRD.md#14-v2-from-assistant-to-agent).*

v1 is an assistant that **asks before everything**. The leading harnesses are agents you can **leave running**: they limit what a command *can* do instead of guessing what it *will* do, make every change undoable, and keep working while processes run. v2 closes that gap first (M6), then improves how often a task succeeds (M7), then scales out (M8).

Two lessons from the review shape the plan:

- **Policy alone is leaky.** The v1 security review found three ways around the permission rules (a project's `env` swapping `ls`, Grep reading `.env`, `git diff --output`). Every fix was another pattern. A sandbox makes the rules a convenience instead of the only wall.
- **Measure before tuning.** M7's changes (edit formats, diagnostics, a repo map) can each help or hurt depending on the model. So M7 starts by making the eval suite big enough to tell.

---

# Milestone 6 — Unattended
*Goal: noobly can work for many rounds without asking, because what it can break is limited and every change can be undone.*

## Phase 20 — OS sandbox for Bash
> ✅ **Done 2026-09-30**, see [.claude/docs/20-sandbox.md](../docs/20-sandbox.md). bubblewrap (Linux) and seatbelt (macOS, profile unit-tested but not yet run on a Mac) backends, a domain-filtering proxy + in-sandbox bridge, auto-allow for sandboxed commands, failure notes, `/sandbox`. A project's `sandbox` setting waits for trust. Found on the way: a read-only mount doesn't stop connecting to **unix sockets** (`docker.sock` = root), so `/run` is hidden and `/tmp` is private. Deviation: **no Docker backend** (needs the toolchain in an image, no fd passing, slow start); moved to "Beyond v2".
**Concept (C20):** Contain what a command *can* do, instead of predicting what it *will* do. Defence in depth: the permission gate decides whether to run a command; the sandbox limits the damage if the gate was wrong.

**Questions to answer:** What can a process do that a permission rule can't see? What does "write only inside the project" mean for `npm install` (which writes `~/.npm`)? Why is network access the hardest thing to allow selectively? How do you tell the model its command failed *because of the sandbox*, so it doesn't loop?

**Build**
- `src/sandbox/`: one small interface, `wrap(command, policy) → { file, args }`, with backends:
  - `bwrap.js` (Linux, bubblewrap): read-only `/`, writable project folder + temp folder + a short allow-list of caches, `--unshare-net` unless network is allowed.
  - `seatbelt.js` (macOS, `sandbox-exec` profile generated from the policy).
  - `docker.js` fallback (project mounted at the same path), for machines without either.
  - `none.js`: runs as today, with a clear banner warning.
- Policy in settings: `sandbox: { enabled, writable: [...], network: "none" | "allow" | ["registry.npmjs.org", …] }`. Domain allow-lists via a small local proxy (`HTTP(S)_PROXY`), the same idea as WebFetch's per-domain rules.
- Gate change: in `default` mode, a Bash command that runs **inside the sandbox** may skip the question (setting `sandbox.autoAllow`, default on); anything needing more (e.g. `dangerouslyDisableSandbox: true` in the tool input, network outside the list) still asks. Deny rules still win.
- Sandbox failures are recognised (EROFS, EACCES under a non-writable path, DNS failure with no network) and a note is added to the tool result: *"blocked by the sandbox: …; ask the user or request `dangerouslyDisableSandbox`"*.
- Hooks and MCP servers are **not** sandboxed in this phase (document why: they are trusted configuration).
- `/sandbox` shows the backend and the effective policy.

**Tests:** policy → bwrap args and seatbelt profile (pure functions, offline); integration tests skipped when no backend is installed: write outside the project fails, write inside works, `curl` fails with network off; the gate auto-allows sandboxed commands but never past a deny rule; sandbox-failure detection.

**Checkpoint:** In the malicious fixture repo from the v1 security review, with trust granted by mistake, the fake `ls` runs but **cannot** write to `~/.bashrc` or reach the network. And: `npm test` runs with no permission question.

**Out of scope:** sandboxing hooks/MCP; Windows; per-command policies.

---

## Phase 21 — Checkpoints & rewind
> ✅ **Done 2026-09-30**, see [.claude/docs/21-checkpoints-and-rewind.md](../docs/21-checkpoints-and-rewind.md). Content-addressed snapshots per turn (saved next to the transcript, so they resume with it), Bash changes detected by size+mtime and reported as not restorable, `/rewind` + Esc Esc dialog (code / conversation / both, your message back in the input box), a reminder + forced re-Read after a code-only rewind, `/diff`. After compaction, only code can be rewound. Not done: the optional overlay-based restore of Bash changes.
**Concept (C21):** Make every change undoable, and autonomy becomes cheap. The conversation and the files are two histories that must rewind together.

**Questions to answer:** Why not just use git (dirty working trees, untracked files, the user's own uncommitted work)? What about files changed by Bash, which the harness never sees? What happens to the model's picture of the files after a rewind (the `readFiles` freshness map)?

**Build**
- `src/checkpoints/store.js`: before the first Edit/Write of a file in a turn, copy its content (or "did not exist") into `~/.noobly/projects/<slug>/checkpoints/<session>/<turn>/`. Content-addressed, so unchanged files cost nothing.
- Bash: record a cheap snapshot of the project's tracked + untracked files' mtimes/sizes before and after each command; files that changed are listed in the checkpoint as *"changed by a command, not restorable"* (honest, not magic). Optional: with the sandbox (Phase 20) writable folder on an overlay, full restore becomes possible, noted as an exploration.
- `/rewind` (and `Esc Esc` on an empty prompt): pick a turn → restore **code**, **conversation**, or **both**. The transcript records the rewind, so `--continue` resumes the rewound state.
- After a code rewind: clear `readFiles` for restored files and add a system reminder ("files X, Y were restored to an earlier version").
- `/diff` shows everything noobly changed this session.

**Tests:** edit → rewind restores bytes exactly; a file created by Write is deleted by rewind; conversation-only rewind leaves files alone; Bash-changed files are reported, not silently skipped; the freshness map forces a re-Read.

**Checkpoint:** Ask for a refactor across 5 files in accept-edits mode, dislike the result, `/rewind` → the tree is byte-for-byte what it was, and the conversation continues from before the request.

**Out of scope:** restoring Bash side effects; syncing with git history.

---

## Phase 22 — Background tasks & monitors
> ✅ **Done 2026-09-30**, see [.claude/docs/22-background-tasks.md](../docs/22-background-tasks.md). Bash `run_in_background` (with the first half second of output), `TaskOutput` (only new output; `wait_seconds` and `until` instead of polling), `TaskStop`, `/tasks`, a status bar count, one-time exit reminders (mid-turn on a tool result, or with the next message), all tasks stopped on `/clear` and exit. Found on the way: per-command sandboxes couldn't reach each other's servers, so on Linux each session now has **one** sandbox with an executor inside (`src/sandbox/executor.js`). Deviations: an in-memory buffer instead of a log file, and no `Monitor` that wakes an idle session (needs its own UI design).
**Concept (C22):** Long-running processes are part of real work (dev servers, watchers, slow builds). The agent needs to start them, keep going, and check back.

**Questions to answer:** How does the model learn a background task finished without polling in a loop? How much output to keep, and how does the model read only the new part? What happens to background processes on `/clear`, exit, or a crash?

**Build**
- Bash `run_in_background: true`: starts the command in its own process group (inside the sandbox), returns a task id immediately.
- `src/tasks/registry.js`: output to a ring buffer + file; status; exit code.
- Tools: `TaskOutput({ id, since? })` (new output only, by default), `TaskStop({ id })`.
- When a background task exits, a system reminder is attached to the next request ("task 3 `npm run build` exited 1"), and in the UI a notice appears. Optional: a `Monitor` that wakes an idle session when a line matches a pattern.
- Status bar shows running tasks; `/tasks` lists them; all are killed on exit (process groups, as in Phase 05).

**Tests:** start → output → stop; exit reminder appears exactly once; `since` returns only new output; no orphan processes after the session closes (check with `process.kill(pid, 0)`).

**Checkpoint:** "Start the dev server, then fetch the home page and fix the error it shows" works without the Bash call timing out.

**Out of scope:** tasks surviving a noobly restart.

**🎯 Milestone 6 done.** Tag `m6`.

---

# Milestone 7 — Better results per task
*Goal: a higher eval pass rate at the same or lower cost, with every change measured.*

## Phase 23 — Eval suite v2
**Concept (C23):** Agent behaviour is noisy. One run proves nothing; you need enough tasks, repeats, and a baseline to see a real effect.

**Questions to answer:** How many repeats until a 5-point difference is real? Which tasks are too easy to tell variants apart? How do you keep live-eval cost under control?

**Build**
- First, finish the open v1 item: run the 10 cases live and write up the Phase 19 A/B experiment.
- Grow `test/evals/cases/` to **50+** tasks in 4 groups: small edits, multi-file changes, debugging from a failing test, and "long" tasks that need compaction or background processes. At least 10 in a second language (Python).
- Report pass@1 and pass@k, mean tokens, cost, rounds, and time per case; a confidence interval for the pass-rate difference in `--compare`.
- `results/` history + a tiny HTML or Markdown report (trend per case), so a regression in one case is visible.
- A cheap nightly subset (10 cases, small model) that can run in CI with a cost cap.

**Tests:** checkers are verified offline against their reference solutions (`--verify`, as today); statistics helpers unit-tested.

**Checkpoint:** A baseline report for two models, with confidence intervals, checked into `.claude/docs/`.

---

## Phase 24 — Feedback after every edit
> ✅ **Done 2026-09-30**, see [.claude/docs/24-feedback-after-edits.md](../docs/24-feedback-after-edits.md). Step 1 (checkers per glob, `node --check` and JSON built in, a per-file baseline so only new problems are reported, timeouts, trust for project checkers). Deviation: step 2 (LSP client) moved to "Beyond v2". Phase 23 (evals) was skipped for now, so the A/B checkpoint is still open.
**Concept (C24):** The earlier the model sees its mistake, the cheaper it is to fix. Diagnostics after an edit beat discovering it three tool calls later in a test run.

**Build**
- `src/feedback/`: after Edit/Write, run a fast checker for that file type and append new problems (only ones the edit introduced) to the tool result.
  - Step 1: configured commands per glob (`feedback: { "*.ts": "tsc --noEmit -p .", "*.js": "node --check $FILE" }`), a generalisation of the PostToolUse-hook example.
  - Step 2: an LSP client (`typescript-language-server`, `pyright`) over stdio JSON-RPC, reusing the MCP client's framing lessons: diagnostics without a full rebuild.
- Show the diagnostics count in the tool call line in the UI.

**Tests:** only new diagnostics are reported (baseline diff); timeouts don't block the edit; LSP framing with a fake server.

**Checkpoint:** An eval A/B (Phase 23): feedback on vs off, measured difference in pass rate and rounds.

---

## Phase 25 — Editing tools shaped for the model
> ✅ **Done 2026-09-30**, see [.claude/docs/25-edit-tools-per-model.md](../docs/25-edit-tools-per-model.md). MultiEdit, the fallback (unique whole-line match ignoring surrounding whitespace, re-indented per level), ApplyPatch with add/update/delete/move, `editTools` setting (auto: patch for OpenAI), Edit/Write rules cover all editing tools, the gate decides per patched file. The eval A/B is open (Phase 23 skipped).
**Concept (C25):** A tool's format is part of the prompt. Models are trained on particular edit formats; matching them measurably changes success rates.

**Build**
- `MultiEdit`: several `old_string → new_string` changes to one file, applied atomically.
- `apply_patch` (the format OpenAI models are trained on), offered instead of Edit/Write when the provider is OpenAI.
- A forgiving fallback when an exact match fails: try whitespace-normalised matching, and if exactly one place matches, apply it and say so in the result.
- Per-provider tool sets chosen once per conversation (never mid-conversation: caching, Phase 09).

**Tests:** patch parser (add/update/delete/move); MultiEdit is all-or-nothing; the fallback never applies an ambiguous match.

**Checkpoint:** Eval A/B per provider: default Edit vs the shaped tool set.

---

## Phase 26 — Big output without losing it
> ✅ **Done 2026-09-30**, see [.claude/docs/26-big-output.md](../docs/26-big-output.md). The loop saves over-limit output of every tool next to the conversation's checkpoints and returns whole-line head/tail + exact skipped range + path; Read and Grep can open it; Bash/WebFetch no longer cut their own output; compaction saves and points to cleared output. Deviation: files are not deleted with the session (resumed conversations still reference them).
**Concept (C26):** Truncation throws information away; paging keeps it. Put large results on disk and give the model a preview and a path.

**Build**
- In `limitToolOutput`: above the limit, save the full output to `~/.noobly/projects/<slug>/tool-results/<id>.txt`, return the first and last lines plus the path and line count. Read can open it (add the folder to `readableDirs`).
- The same for WebFetch pages and MCP results.
- Compaction (Phase 08) keeps the path when it clears old tool output, so the model can go back to it.

**Tests:** round-trip: a 50k-line output → preview → Read with offset finds line 30,000; files are cleaned up with the session.

**Checkpoint:** "Find the failing test in this 20,000-line test log" succeeds where v1 cut the middle out.

---

## Phase 27 — A map of the codebase
> ✅ **Done 2026-09-30**, see [.claude/docs/27-repo-map.md](../docs/27-repo-map.md). Line-pattern symbol extraction (JS/TS incl. class methods, Python, Go, Rust), personalised PageRank over public definitions with IDF weighting, budget fitting, per-file cache, `RepoMap` tool, `repoMap` setting (auto: 25-5,000 files in the system prompt). Deviation: no tree-sitter (moved to "Beyond v2"). Eval A/B open. Also fixed: a start-up race in the Phase 22 executor's proxy bridge.
**Concept (C27):** In a big repo, the cheapest search is the one you don't have to do. A compact map of files and their main symbols, ranked by relevance, orients the model in one glance.

**Build**
- `src/context/repo-map.js`: parse files with tree-sitter (WASM build; one justified dependency) to list top-level definitions; rank files by references (the Aider approach: PageRank over a file-reference graph) and by what the conversation mentions.
- Fit the map to a token budget; include it in the system prompt for large repos only (setting), or expose a `RepoMap` tool.
- Cache per file hash so it's cheap to update.

**Tests:** symbol extraction for JS/TS/Python fixtures; budget respected; ranking favours mentioned files.

**Checkpoint:** Eval A/B on the multi-file group: map on vs off, rounds and tokens compared.

---

## Phase 28 — Seeing and searching
> ✅ **Done 2026-09-30**, see [.claude/docs/28-images-and-search.md](../docs/28-images-and-search.md). Read returns image blocks; image paths in your message are attached; OpenAI Chat/Responses translations; providers flagged for image support; images count ~1,600 tokens and are cleared by compaction. `WebSearch` via Brave, Tavily or SearXNG, registered only when configured, untrusted framing, asks per search, project setting needs trust. Deviations: no resizing (a size cap instead), no Anthropic server-side search.
**Concept (C28):** Multimodal input and open-web search: the model can look at a screenshot and find a page it wasn't given.

**Build**
- Read returns images (PNG/JPEG/GIF/WebP) as image content blocks, resized to a size cap; paste an image path or drag a file into the prompt.
- Provider translation for image blocks (Anthropic, OpenAI Responses, OpenAI-compatible where supported; a clear error otherwise).
- `WebSearch`: use the provider's server-side search tool where available (Anthropic `web_search`), otherwise a configured search API; results framed as untrusted, like WebFetch.

**Tests:** image encoding and size cap; per-provider translation; search results framed and permission-checked.

**Checkpoint:** "Here is a screenshot of the broken layout: fix the CSS" works end to end.

**🎯 Milestone 7 done.** Tag `m7`.

---

# Milestone 8 — Scale & reach

## Phase 29 — Parallel agents in worktrees
> ✅ **Done 2026-09-30**, see [.claude/docs/29-worktrees.md](../docs/29-worktrees.md). `Task` `isolation: "worktree"` (from HEAD, own branch, own sandbox; changes committed to the branch; folder removed; branch removed if unchanged), concurrency-safe, git admin serialized, `/merge`. Sandbox fixes found on the way: the main `.git` mounted read-only for worktree git commands, and hidden folders around a writable one are hidden before it's mounted.
**Concept (C29):** Parallel agents need separate working copies, or they overwrite each other. A git worktree per agent gives isolation; merging back is the hard part.

**Build**
- `Task` with `isolation: "worktree"`: create `git worktree add` on a new branch, run the subagent with that folder as its project root (and sandbox writable folder), remove it when nothing changed.
- The parent gets a summary plus the branch name and diff stats; `/merge <branch>` or the model merges with ordinary git.
- Editing subagents in separate worktrees may run concurrently (today they run one at a time).

**Tests:** two editing subagents in parallel don't see each other's changes; unchanged worktrees are removed; cleanup after interrupts.

**Checkpoint:** "Add the same logging change to three services in parallel" → three branches, merged.

---

## Phase 30 — Editors and other front-ends
> ✅ **Done 2026-09-30**, see [.claude/docs/30-editors-acp.md](../docs/30-editors-acp.md). `noobly acp`: initialize, session/new, session/prompt, session/cancel; updates for text, thoughts, tool calls (with kinds) and the plan; permission requests answered by the editor. Deviations: edits don't go through the editor's fs methods, no plan approval/images/session load, not yet tried in a real editor.
**Concept (C30):** The loop doesn't care where the user is. A standard protocol puts the harness inside any editor that speaks it.

**Build**
- `noobly acp`: speak the Agent Client Protocol (JSON-RPC over stdio) so editors like Zed can host noobly: sessions, streamed updates, tool calls, permission requests and file edits routed through the editor.
- Reuse the event stream from Phase 17 (headless) as the source; no loop changes.

**Tests:** protocol round-trip with a fake client; permission requests answered by the client.

**Checkpoint:** Use noobly from an ACP-capable editor on this repo.

**🎯 Milestone 8 done.** Tag `v2.0.0`.

---

## Beyond v2 (optional explorations)

| Topic | What you'd learn |
|---|---|
| Full-screen TUI (Ink or hand-rolled) | Rendering, layout, input handling at scale |
| Multi-agent teams with message passing | Coordination, shared state, agent-to-agent protocols |
| Cost-aware model routing | Using small models for easy turns automatically |
| A model-based permission classifier | Letting a small model judge "is this command safe here?", and how to evaluate it |
| Sandboxing hooks and MCP servers | Least privilege for trusted-but-fallible configuration |
| tree-sitter symbols for the repo map (Phase 27) | Real parsers in WebAssembly; definitions vs references |
| LSP client for diagnostics (Phase 24 step 2) | Document sync, JSON-RPC notifications, type errors without a full build |
| Cloud / remote execution | Running the same loop in a container far from your laptop (and a Docker sandbox backend, skipped in Phase 20) |

(Sandboxing, worktrees, background tasks and LSP diagnostics moved into v2 as Phases 20, 29, 22 and 24.)

## Phase → concept → requirement map

| Phase | Concept | Key PRD requirements |
|---|---|---|
| 00 | Scaffold | NF-1, NF-4 |
| 01 | Model API | F-MOD-1, F-MOD-3, F-CFG-2 |
| 02 | Conversation state | F-CLI-1 |
| 03 | Streaming & interrupts | F-CLI-3, F-CLI-5, F-MOD-2, F-MOD-4, F-MOD-6 |
| 04 | Agent loop | F-LOOP-1…6, F-TOOL-1, F-CLI-4 |
| 05 | Toolset | F-TOOL-2…6 |
| 06 | Permissions | F-PERM-1…6 |
| 07 | Context engineering | F-CTX-1, F-CTX-2, F-CTX-7 |
| 08 | Context window | F-CTX-3, F-CTX-4, F-CTX-5 |
| 09 | Sessions & caching | F-SES-1…3, F-CTX-6 |
| 10 | Config & commands | F-CFG-1, F-CFG-3, F-CLI-6, F-CLI-7 |
| 11 | Planning | F-TOOL-7, F-PERM-4 (plan) |
| 12 | Hooks | F-EXT-1 |
| 13 | Subagents | F-TOOL-8, F-EXT-4 |
| 14 | MCP | F-EXT-2 |
| 15 | Skills | F-TOOL-10, F-EXT-3 |
| 16 | Memory | F-EXT-5 |
| 17 | Headless & library | F-CLI-2 (full), F-CLI-8, F-CLI-9, F-EXT-6 |
| 18 | Robustness | F-TOOL-9, F-MOD-5 |
| 19 | Evals | Success metrics §10 |
| 20 | OS sandbox | F-SBX-1…5 |
| 21 | Checkpoints & rewind | F-CKPT-1…4 |
| 22 | Background tasks | F-BG-1…4 |
| 23 | Eval suite v2 | F-EVAL-1…4, success metrics §14.6 |
| 24 | Feedback after edits | F-FB-1…3 |
| 25 | Model-shaped edit tools | F-EDIT-1…4 |
| 26 | Big output | F-OUT-1…2 |
| 27 | Repo map | F-MAP-1…2 |
| 28 | Images & search | F-MM-1…2, F-SRCH-1 |
| 29 | Worktrees | F-WT-1…2 |
| 30 | Editors (ACP) | F-ACP-1 |
