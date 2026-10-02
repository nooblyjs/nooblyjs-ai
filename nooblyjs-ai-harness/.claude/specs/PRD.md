# PRD — Noobly Learn Harness

| Field | Value |
|---|---|
| Product | `noobly` — a learning-first AI coding CLI harness |
| Repo | `nooblyjs/nooblyjs-learn-harness` |
| Status | v1 built · v2 built except Phase 23 (§14) |
| Date | 2026-09-29 (v2 added 2026-09-30) |
| Related | [Architecture.md](./Architecture.md) · [Roadmap.md](./Roadmap.md) |

---

## 1. Summary

`noobly` is a terminal-based AI coding agent, functionally modelled on tools like Claude Code, built **progressively** so that each stage of the build teaches one core concept of agent harness design. The end product is a usable CLI agent that can read, search and edit a codebase, run shell commands under a permission system, manage its own context window, and be extended with hooks, MCP servers, skills and subagents.

The product has two equal goals:

1. **Learning** — every concept is introduced in isolation, in a small amount of readable code, with a runnable checkpoint at the end of each phase.
2. **Utility** — by the end of the roadmap the harness is good enough to do real work in this repo (including helping build itself).

## 2. Problem statement

Modern AI coding tools look like magic from the outside. Underneath, they are a relatively small set of well-understood ideas: a model API, a loop, a set of tools, a permission gate, and a lot of *context engineering*. Most of that is hidden behind polished products or large frameworks, which makes it hard to learn *why* each piece exists.

We want a codebase where each of those ideas is visible, isolated, and built from first principles — without frameworks doing the interesting part for us.

## 3. Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Teach each harness concept in isolation | Every roadmap phase has a stated concept, a runnable checkpoint and a short doc in `.claude/docs/` |
| G2 | Build from first principles | No agent framework dependencies; the model API is called with raw `fetch` in early phases |
| G3 | Always runnable | `main` is always in a working state; every phase ends with a demo command that works |
| G4 | Reach Claude-Code-class core capability | By the end of Milestone 3, `noobly` can complete a multi-file edit task in this repo with tests passing |
| G5 | Testable without spending tokens | A scripted mock provider allows every loop behaviour to be unit tested offline |
| G6 | Extensible | Hooks, MCP, skills and subagents plug in without modifying the core loop |

## 4. Non-goals

- Competing with Claude Code on polish, performance or breadth.
- IDE integrations, web UI, or cloud execution. *(v2 revisits one of these: editor integration through a standard protocol, §14.)*
- Multi-user / team features, telemetry back-ends, or billing.
- Supporting every model provider. Anthropic is primary; one OpenAI-compatible adapter (e.g. Ollama) is a stretch goal to prove the abstraction.
- ~~Sandboxing at the OS level (containers, seccomp). We implement *policy* sandboxing (permissions); OS sandboxing is documented as a stretch topic only.~~ **Moved into v2** (§14): the v1 security review showed policy alone is not enough.

## 5. Target users

| Persona | Need |
|---|---|
| **The learner** (primary — the repo owner) | Understand how an agent harness works by building one, one concept at a time |
| **The reader** | Someone browsing the repo who wants to follow the phases like a course |
| **The user** | Someone who wants a small, hackable, understandable coding agent for local use |

## 6. Core concepts the product must teach

These are the concepts the roadmap is organised around. Each maps to at least one phase.

| # | Concept | What the learner should come away understanding |
|---|---|---|
| C1 | **Model API & messages** | Roles, content blocks, system prompts, tokens, stop reasons, cost |
| C2 | **Conversation state** | The model is stateless; the harness owns and replays history |
| C3 | **Streaming** | Server-sent events, incremental rendering, partial JSON for tool input |
| C4 | **Tool use & the agent loop** | Tool schemas, `tool_use` → execute → `tool_result` → repeat until `end_turn` |
| C5 | **Tool design** | Why Read/Edit/Grep/Glob/Bash look the way they do; error messages as model feedback |
| C6 | **Permissions & safety** | Allow/ask/deny rules, permission modes, read-only vs mutating tools, human-in-the-loop |
| C7 | **Context engineering** | System prompt assembly, environment info, project instruction files, git context |
| C8 | **Context window management** | Token budgeting, output truncation, compaction/summarisation, prompt caching |
| C9 | **Sessions & persistence** | Transcripts as append-only logs, resume/continue, reproducibility |
| C10 | **Configuration** | Layered settings (user → project → local → CLI flags), slash commands |
| C11 | **Planning & task tracking** | Todo tool, plan mode, keeping the model on track over long tasks |
| C12 | **Hooks** | Lifecycle events that run user code and can block, modify or annotate |
| C13 | **Subagents** | Isolated contexts, delegation, parallelism, returning summaries not transcripts |
| C14 | **MCP** | JSON-RPC over stdio, dynamic tool discovery, external capability servers |
| C15 | **Skills** | Progressive disclosure: cheap descriptions in context, full instructions on demand |
| C16 | **Memory** | Durable cross-session facts, what to remember and what not to |
| C17 | **Headless / programmatic use** | Non-interactive mode, structured output, using the harness as a library |
| C18 | **Interruption & robustness** | Abort signals, retries, rate limits, overloaded errors, partial results |
| C19 | **Observability & evals** | Tracing turns, token/cost accounting, regression evals for agent behaviour |

## 7. Functional requirements

Priority: **P0** = required for core agent (Milestones 1–3), **P1** = extensibility (Milestone 4), **P2** = advanced/stretch (Milestone 5).

### 7.1 CLI & interaction

| ID | Requirement | Pri |
|---|---|---|
| F-CLI-1 | `noobly` starts an interactive REPL in the current directory | P0 |
| F-CLI-2 | `noobly -p "<prompt>"` runs one task non-interactively and exits | P0 |
| F-CLI-3 | Assistant text streams to the terminal as it is generated | P0 |
| F-CLI-4 | Tool calls are displayed compactly (name + key argument) with a collapsed result summary | P0 |
| F-CLI-5 | `Ctrl+C` / `Esc` interrupts the current turn without killing the session; a second `Ctrl+C` exits | P0 |
| F-CLI-6 | Slash commands: `/help`, `/clear`, `/compact`, `/cost`, `/model`, `/resume`, `/permissions`, `/exit` | P1 |
| F-CLI-7 | User-defined slash commands from `.noobly/commands/*.md` | P1 |
| F-CLI-8 | `--output-format json|stream-json` for headless mode | P2 |
| F-CLI-9 | Basic Markdown rendering in the terminal (headings, code blocks, lists). ✅ Done early (incl. tables) | P2 |
| F-CLI-10 | Rich terminal UI built with Ink: bordered input, spinner, status bar (model · tokens · cost) | P0 |

### 7.2 Model provider

| ID | Requirement | Pri |
|---|---|---|
| F-MOD-1 | Call the Anthropic Messages API directly with `fetch` (no SDK in early phases) | P0 |
| F-MOD-2 | Support streaming (SSE) including `input_json_delta` for tool inputs | P0 |
| F-MOD-3 | Configurable model; default `claude-opus-5-5`, small/fast model `claude-haiku-4-5` for auxiliary tasks (summaries, titles) | P0 |
| F-MOD-4 | Retry with exponential backoff on 429 / 529 / network errors; respect `retry-after` | P0 |
| F-MOD-5 | Provider interface so a second provider (OpenAI-compatible / Ollama) can be added. ✅ OpenAI + xAI Grok done | P2 |
| F-MOD-6 | Mock provider that replays scripted responses for tests | P0 |

### 7.3 Agent loop

| ID | Requirement | Pri |
|---|---|---|
| F-LOOP-1 | Loop: send messages → if `stop_reason == tool_use`, execute tools, append `tool_result`s, repeat; stop on `end_turn` | P0 |
| F-LOOP-2 | Multiple `tool_use` blocks in one response are all executed; read-only tools may run concurrently | P0 |
| F-LOOP-3 | Tool errors are returned to the model as `tool_result` with `is_error: true`, never crash the loop | P0 |
| F-LOOP-4 | Max-turns safety limit per user prompt (configurable) | P0 |
| F-LOOP-5 | Handle `max_tokens` stop reason gracefully (continue or report) | P0 |
| F-LOOP-6 | Loop emits events (text delta, tool start/end, usage, error) consumed by the UI — the loop never writes to stdout directly | P0 |

### 7.4 Built-in tools

| ID | Tool | Behaviour | Pri |
|---|---|---|---|
| F-TOOL-1 | `Read` | Read a file with line numbers; offset/limit; refuse binaries; cap size | P0 |
| F-TOOL-2 | `Write` | Create/overwrite a file; must have `Read` the file first if it exists | P0 |
| F-TOOL-3 | `Edit` | Exact string replacement; fails if `old_string` not found or not unique (unless `replace_all`) | P0 |
| F-TOOL-4 | `Glob` | Find files by pattern, sorted by mtime, respects `.gitignore` | P0 |
| F-TOOL-5 | `Grep` | Regex search via ripgrep when available, JS fallback otherwise; output modes: files / content / count | P0 |
| F-TOOL-6 | `Bash` | Run a shell command with timeout, captured stdout/stderr, output truncation; persistent cwd | P0 |
| F-TOOL-7 | `TodoWrite` | Maintain a structured task list shown in the UI | P1 |
| F-TOOL-8 | `Task` | Spawn a subagent with its own context and restricted toolset | P1 |
| F-TOOL-9 | `WebFetch` | Fetch a URL, convert HTML → text/markdown, truncate | P2 |
| F-TOOL-10 | `Skill` | Load a skill's full instructions into context | P1 |

### 7.5 Permissions

| ID | Requirement | Pri |
|---|---|---|
| F-PERM-1 | Every tool declares `isReadOnly`; read-only tools run without prompting in default mode | P0 |
| F-PERM-2 | Mutating tools prompt the user: *Allow once / Allow always (this session) / Deny (with optional reason)* | P0 |
| F-PERM-3 | Rules in settings: `allow`, `ask`, `deny` lists with patterns, e.g. `Bash(npm test:*)`, `Edit(src/**)`, `Read(.env)` | P0 |
| F-PERM-4 | Modes: `default`, `acceptEdits`, `plan` (read-only), `bypass` (explicit opt-in flag only) | P0 |
| F-PERM-5 | Deny beats allow; file tools cannot escape the project root without explicit allow | P0 |
| F-PERM-6 | A denied call returns a `tool_result` explaining the denial so the model can adapt | P0 |

### 7.6 Context

| ID | Requirement | Pri |
|---|---|---|
| F-CTX-1 | System prompt assembled from sections: identity, tool guidance, environment (cwd, OS, date, git branch/status), project instructions | P0 |
| F-CTX-2 | Load `NOOBLY.md` (and `AGENTS.md` if present) from user dir, project root and parent directories | P0 |
| F-CTX-3 | Track token usage per turn from API `usage`; show cumulative cost via `/cost` | P0 |
| F-CTX-4 | Truncate oversized tool results with a clear marker telling the model how to get more | P0 |
| F-CTX-5 | Auto-compact: when usage passes a threshold (default 80% of window), summarise older history into a compact message | P1 |
| F-CTX-6 | Prompt caching via `cache_control` breakpoints on system prompt, tools and recent history | P1 |
| F-CTX-7 | System reminders: harness-injected context (e.g. todo state, file changed on disk) attached to user turns | P1 |

### 7.7 Sessions

| ID | Requirement | Pri |
|---|---|---|
| F-SES-1 | Each session is persisted as append-only JSONL under `~/.noobly/projects/<project-slug>/<session-id>.jsonl` | P0 |
| F-SES-2 | `noobly --continue` resumes the most recent session in this project; `--resume <id>` or `/resume` picks one | P1 |
| F-SES-3 | Sessions get an auto-generated title (small model) | P2 |

### 7.8 Configuration

| ID | Requirement | Pri |
|---|---|---|
| F-CFG-1 | Settings layers, lowest → highest precedence: defaults → `~/.noobly/settings.json` → `.noobly/settings.json` → `.noobly/settings.local.json` → env vars → CLI flags | P0 |
| F-CFG-2 | API key from `ANTHROPIC_API_KEY` env var (never written to settings or transcripts) | P0 |
| F-CFG-3 | `noobly config` prints the effective merged config and where each value came from | P1 |

### 7.9 Extensibility

| ID | Requirement | Pri |
|---|---|---|
| F-EXT-1 | **Hooks**: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `PreCompact`; hooks are shell commands receiving JSON on stdin; exit code 2 blocks with stderr fed back to the model | P1 |
| F-EXT-2 | **MCP client**: connect to stdio MCP servers from `.noobly/mcp.json`; list tools; expose them as `mcp__<server>__<tool>` | P1 |
| F-EXT-3 | **Skills**: `.noobly/skills/<name>/SKILL.md` with frontmatter `name`/`description`; only descriptions in the system prompt, body loaded via `Skill` tool | P1 |
| F-EXT-4 | **Subagents**: built-in `general` and `explore` agents plus user-defined `.noobly/agents/*.md` (frontmatter: name, description, tools, model) | P1 |
| F-EXT-5 | **Memory**: file-based memory directory with an index file loaded each session; model can write memories via standard file tools | P2 |
| F-EXT-6 | **Library API**: `require('noobly').query({ prompt, options })` returns an async iterator of events | P2 |

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-1 | **Runtime**: Node.js ≥ 22 (developed on 24), ES modules (required by Ink) |
| NF-2 | **Dependencies**: the *core* (loop, providers, tools, permissions) stays dependency-free. The UI uses Ink + React (+ `tsx` to run JSX without a build step). Every new dependency needs a one-line justification in `Architecture.md` §21 |
| NF-3 | **Readability over cleverness**: each module < ~300 lines; each concept lives in its own file |
| NF-4 | **Testability**: `node --test`; every tool and the loop are tested against the mock provider; no test hits the network |
| NF-5 | **Safety**: secrets never logged; `.env`-like files denied by default; `bypass` mode requires an explicit flag and prints a warning |
| NF-6 | **Responsiveness**: first streamed token rendered as soon as received; UI never blocks on tool execution without a spinner |
| NF-7 | **Portability**: Linux and macOS first-class; Windows best-effort (Bash tool assumes a POSIX shell) |
| NF-8 | **Documentation**: every phase appends to `.claude/docs/` — what the concept is, what surprised us, what Claude Code does differently |

## 9. User stories (end state)

1. *As a learner*, I can check out the tag `phase-04` and run `noobly` to see the smallest possible working agent loop, then diff against `phase-05` to see exactly what adding real tools changed.
2. *As a user*, I type "add a `--version` flag to the CLI and a test for it" and `noobly` reads the relevant files, edits them, asks me before each write, runs the tests, and reports back.
3. *As a user*, I run a long refactor; the context fills up; `noobly` compacts automatically and keeps going without losing track of the task list.
4. *As a user*, I add a `PreToolUse` hook that blocks `rm -rf` and see the model receive the block reason and choose a different approach.
5. *As a user*, I add a filesystem MCP server to `.noobly/mcp.json` and its tools appear in `/tools`.
6. *As a user*, I ask "find every place we parse settings"; `noobly` delegates to an `explore` subagent and gets back a short summary instead of 40 file dumps in the main context.
7. *As a CI script*, I run `noobly -p "fix lint errors" --output-format json --permission-mode acceptEdits` and parse the result.

## 10. Success metrics

| Metric | Target |
|---|---|
| Phases completed with passing checkpoint | 100% of roadmap phases |
| Offline test suite | Runs in < 10s, zero network |
| Self-hosting | From Milestone 3 onward, at least one feature of each later phase is implemented *by `noobly` itself* (with human review) |
| Eval suite (Phase 19) | ≥ 80% pass rate on a set of 10 small scripted coding tasks |

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| API cost during learning | Mock provider for tests; Haiku for auxiliary calls; `/cost` visible at all times; prompt caching in Phase 9 |
| Agent does something destructive while learning | Permissions land in Phase 6 *before* Bash gets broad use; work in a git repo; deny rules for `rm -rf`, `git push --force` by default |
| Scope creep toward "rebuild Claude Code" | Each phase has an explicit *out of scope* list; non-goals above |
| Concepts blur together | One concept per phase; tag each phase in git; `.claude/docs/` write-up required to close a phase |
| API behaviour changes | Provider layer isolates wire format; SSE parser tested against recorded fixtures |

## 12. Open questions

1. Should Milestone 1 swap raw `fetch` for `@anthropic-ai/sdk` after the wire protocol has been learned, or stay SDK-free throughout? *(Proposal: stay raw; add SDK only as an alternate provider adapter for comparison.)*
2. Instruction file name: `NOOBLY.md` only, or also honour `CLAUDE.md` / `AGENTS.md` for interop? *(Proposal: `NOOBLY.md` primary, `AGENTS.md` fallback.)*
3. Do we want TypeScript later for the interfaces, or JSDoc types + `// @ts-check`? *(Proposal: JSDoc + `@ts-check`. `tsx` is already installed for JSX, so `.ts` files would also work without a build step.)*

## 13. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-29 | Use **Ink** (React for the terminal) for the interactive UI | Richer UI requested; it's also what Claude Code uses |
| 2026-09-29 | Switch the project to **ES modules** | Ink is ESM-only |
| 2026-09-29 | Run JSX via **`tsx`** instead of a build step | Keeps `node bin/noobly.js` working directly |
| 2026-09-29 | Default model `claude-opus-5-5`, small model `claude-haiku-4-5` | Current recommended models |
| 2026-09-29 | Add an offline **echo provider** (`--echo`) in Phase 02 | Try the UI and run tests with no API key |
| 2026-09-29 | Enable server-side refusal **fallbacks** by default | A declined request is retried on a fallback model instead of just stopping |
| 2026-09-29 | History edits (compaction, resume with a new prompt) **strip thinking blocks**; system prompt and tool list stay fixed for a conversation | Newer Claude models bind thinking blocks to the exact conversation; edited history is rejected for new accounts |
| 2026-09-29 | `allowed-tools` in custom commands = temporary **permission rules**, not a smaller tool list | Changing the tool list mid-conversation breaks caching and thinking blocks |
| 2026-09-29 | `bypass` mode cannot come from a settings file | Project settings are untrusted input |
| 2026-09-29 | Render replies as **Markdown** with `marked` (parser) + own Ink renderers; print mode stays raw | User saw raw `**`/`` ` `` symbols in answers |
| 2026-09-29 | Support **OpenAI and xAI Grok** via one OpenAI-compatible adapter (pulled forward from Phase 18); provider chosen by which API key is set | User switched from an Anthropic key to a Grok key |
| 2026-09-30 | A project's `env`, `baseUrl` and `permissions.allow` settings wait for **trust**, like hooks | Security review: they could swap `ls`/`git` via PATH (code ran with no question), send the API key elsewhere, or pre-approve all commands |
| 2026-09-30 | `Read` deny rules also stop **Grep**; deny rules follow **symlinks** and see through simple disguises (`/bin/rm -r -f`); `--output` can't be prefix-approved; WebFetch follows **same-host redirects** only | Security review found each as a working bypass |
| 2026-09-30 | Plan **v2** (§14): unattended work first (sandbox, rewind, background tasks), then measured quality work, then scale | Comparison with the leading harnesses: the biggest gap is safe autonomy, not features |

---

## 14. v2: from assistant to agent

*Added 2026-09-30, after a code review of v1 and a comparison with the leading harnesses (Claude Code, Codex CLI, Aider, OpenHands). Phases 20–30 in the [Roadmap](./Roadmap.md#v2-from-assistant-to-agent).*

### 14.1 Why

v1 reaches the core capability goal (G4), but it is an assistant that **asks before everything**. Leading harnesses are agents you can **leave running**, because:

1. **What a command can do is limited** (an OS sandbox), so most commands need no question.
2. **Every change is undoable** (checkpoints), so accepting edits is cheap.
3. **Long-running processes are normal** (background tasks), so real workflows (dev servers, watchers) fit.

The v1 security review made point 1 concrete: every bypass found (a project's PATH, Grep on `.env`, `git diff --output`) was fixed with another pattern. Patterns will always have gaps; a sandbox makes them a convenience instead of the only wall.

After autonomy, the next gap is **results per task** (edit formats per model, feedback after edits, big outputs, a repo map, images, search). Each can help or hurt depending on the model, so they are only worth doing **measured**: v2 grows the eval suite first.

### 14.2 Goals

| # | Goal | Measure |
|---|---|---|
| G7 | Work unattended, safely | In sandboxed default mode, a typical task (edit + run tests) needs **no** permission question; nothing outside the project and allowed caches can be written |
| G8 | Every change undoable | `/rewind` restores files changed by Edit/Write byte for byte; Bash changes are reported |
| G9 | Better results, measured | Eval pass rate up ≥ 10 points over the v1 baseline on the v2 suite, at ≤ equal cost per passed task |
| G10 | Scale out | Editing subagents run in parallel without conflicts |
| G11 | Stay a teaching codebase | Each v2 phase still has one concept, a doc in `.claude/docs/`, and a git tag; the core stays dependency-free (tree-sitter WASM is the one planned exception, justified in Architecture §21) |

### 14.3 New concepts

| # | Concept | What the learner should come away understanding |
|---|---|---|
| C20 | **OS sandboxing** | Containing capabilities vs predicting intent; filesystem and network policy; bubblewrap, seatbelt, containers; telling the model it hit the wall |
| C21 | **Checkpoints & rewind** | Files and conversation as two histories; what can and can't be restored; keeping the model's picture of files honest |
| C22 | **Background tasks** | Process lifetimes beyond one tool call; incremental output; notifying the model instead of polling |
| C23 | **Evals at scale** | Noise, repeats, pass@k, confidence intervals, cost control, baselines |
| C24 | **Fast feedback** | Diagnostics after edits; LSP; reporting only what the edit introduced |
| C25 | **Tool formats as prompt** | Models are trained on formats; per-provider tool sets; forgiving but unambiguous matching |
| C26 | **Paging, not truncating** | Big outputs on disk with a preview and a path |
| C27 | **Repo maps** | Symbol extraction, reference ranking, fitting to a token budget |
| C28 | **Multimodal & search** | Image blocks, provider translation, open-web search as untrusted input |
| C29 | **Worktree isolation** | Parallel editing agents, branches, merging back |
| C30 | **Agent protocols** | One loop, many front-ends: the Agent Client Protocol |

### 14.4 Functional requirements

Priority: **P0** = Milestone 6 (unattended), **P1** = Milestone 7 (results), **P2** = Milestone 8 (scale & reach).

#### Sandbox (Phase 20)

| ID | Requirement | Pri |
|---|---|---|
| F-SBX-1 | Bash commands run inside an OS sandbox when one is available: bubblewrap (Linux), `sandbox-exec` (macOS); otherwise a visible notice. (A Docker fallback was planned and dropped, see Phase 20.) | P0 |
| F-SBX-2 | Default policy: read everywhere, write only to the project, the temp folder and listed caches; no network | P0 |
| F-SBX-3 | Network allow-list by domain (via a local proxy), configured in settings | P0 |
| F-SBX-4 | In default mode, sandboxed commands may run without asking (setting, default on); leaving the sandbox (`dangerouslyDisableSandbox`) always asks; deny rules always win | P0 |
| F-SBX-5 | Failures caused by the sandbox are recognised and explained in the tool result | P0 |

#### Checkpoints (Phase 21)

| ID | Requirement | Pri |
|---|---|---|
| F-CKPT-1 | Before a file's first Edit/Write in a turn, its previous content (or absence) is saved | P0 |
| F-CKPT-2 | `/rewind` (and `Esc Esc`) restores code, conversation, or both to any earlier turn; the transcript records it | P0 |
| F-CKPT-3 | Files changed by Bash are detected and listed as not restorable | P0 |
| F-CKPT-4 | After a code rewind, restored files must be Read again before editing, and the model is told which files changed | P0 |

#### Background tasks (Phase 22)

| ID | Requirement | Pri |
|---|---|---|
| F-BG-1 | Bash `run_in_background` starts a command and returns a task id at once | P0 |
| F-BG-2 | `TaskOutput` returns new output since the last read; `TaskStop` ends a task | P0 |
| F-BG-3 | When a task exits, the model gets one system reminder and the UI shows a notice | P0 |
| F-BG-4 | All background tasks (process groups) are killed when the session ends | P0 |

#### Results per task (Phases 23–28)

| ID | Requirement | Pri |
|---|---|---|
| F-EVAL-1 | Eval suite of 50+ cases in 4 groups, at least 10 in a second language | P1 |
| F-EVAL-2 | Reports pass@1, pass@k, tokens, cost, rounds, time; `--compare` gives a confidence interval | P1 |
| F-EVAL-3 | Results history with a per-case trend report | P1 |
| F-EVAL-4 | A cost-capped nightly subset that can run in CI | P1 |
| F-FB-1 | After Edit/Write, configured per-glob checkers run and new problems are appended to the result | P1 |
| F-FB-2 | An LSP client provides diagnostics for supported languages | P1 |
| F-FB-3 | Only problems the edit introduced are reported; a slow checker never blocks the edit | P1 |
| F-EDIT-1 | `MultiEdit`: several replacements in one file, all-or-nothing | P1 |
| F-EDIT-2 | `apply_patch` offered to OpenAI models instead of Edit/Write | P1 |
| F-EDIT-3 | Whitespace-tolerant fallback when an exact match fails, applied only if unambiguous, and reported | P1 |
| F-EDIT-4 | The tool set is chosen per provider once per conversation | P1 |
| F-OUT-1 | Tool output over the limit is saved to a file; the model gets a preview and the path, readable with Read | P1 |
| F-OUT-2 | Compaction keeps those paths when it clears old tool output | P1 |
| F-MAP-1 | A repo map (files + top-level symbols, ranked) fitted to a token budget | P1 |
| F-MAP-2 | The map is cached per file hash and enabled for large repos only (setting) | P1 |
| F-MM-1 | Read returns images as image blocks, with a size cap | P1 |
| F-MM-2 | Image blocks are translated for each provider, or refused with a clear message | P1 |
| F-SRCH-1 | `WebSearch` via the provider's server-side search or a configured API; results framed as untrusted and permission-checked | P1 |

#### Scale & reach (Phases 29–30)

| ID | Requirement | Pri |
|---|---|---|
| F-WT-1 | `Task` with `isolation: "worktree"` runs a subagent in its own git worktree and branch; unchanged worktrees are removed | P2 |
| F-WT-2 | Editing subagents in separate worktrees may run concurrently | P2 |
| F-ACP-1 | `noobly acp` serves the Agent Client Protocol over stdio, including permission requests | P2 |

### 14.5 User stories (v2 end state)

1. *As a user*, I say "upgrade the test framework and fix what breaks" and come back 20 minutes later: noobly worked in the sandbox without asking, and nothing outside the project changed.
2. *As a user*, I don't like the refactor it made, so I press `Esc Esc`, pick the turn before it, and my files and the conversation are back.
3. *As a user*, I ask noobly to start the dev server and fix the error on the home page; it keeps the server running while it edits and re-checks.
4. *As a learner*, I change a tool description and see in the eval report, with a confidence interval, whether it helped.
5. *As a user*, I paste a screenshot of a broken layout and noobly fixes the CSS.
6. *As a user*, I ask for the same change in three services; three subagents work in parallel worktrees and I merge the branches.

### 14.6 Success metrics

| Metric | Target |
|---|---|
| Permission questions per typical task (sandboxed, default mode) | 0 for edit + test tasks |
| Writes outside allowed folders from Bash (sandbox tests) | 0 |
| Rewind fidelity | 100% byte-identical for Edit/Write changes |
| Eval pass rate (v2 suite) | ≥ v1 baseline + 10 points, cost per passed task not higher |
| Every M7 phase | Ships with a measured A/B in `.claude/docs/` (kept even if the result is "no effect") |

### 14.7 Risks & mitigations

| Risk | Mitigation |
|---|---|
| Sandbox backends differ per OS and break common tools (`npm install` writing `~/.npm`) | A small, documented allow-list of caches; sandbox failures explained to the model; `/sandbox` shows the effective policy; integration tests per backend |
| Auto-allowing sandboxed commands feels unsafe | It is a setting, deny rules still win, network stays off by default, and rewind (Phase 21) covers the project folder |
| Live eval runs get expensive | Cost caps, small-model nightly subset, reference solutions verified offline |
| Quality changes help one model and hurt another | Per-provider A/B in every M7 phase; tool sets chosen per provider |
| New dependencies (tree-sitter, LSP servers) bloat the teaching codebase | Optional, detected at runtime, justified in Architecture §21; the core stays dependency-free |
