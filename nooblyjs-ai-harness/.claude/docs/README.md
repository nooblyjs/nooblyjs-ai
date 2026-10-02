# noobly docs: start here

These notes explain, in plain language, everything that has been built so far and *why*.
Read them in order. Each one matches a phase in the [roadmap](../specs/Roadmap.md).

| # | Doc | What you'll learn |
|---|---|---|
| 0 | [00-project-setup.md](./00-project-setup.md) | How the project is laid out, what each file does, how `npm`, ESM, `tsx` and tests fit together |
| 1 | [01-talking-to-the-model.md](./01-talking-to-the-model.md) | What an AI API call really is: HTTP, JSON, tokens, cost, stop reasons |
| 2 | [02-conversation-and-the-rich-ui.md](./02-conversation-and-the-rich-ui.md) | Why the model "forgets", how a conversation is remembered, and how the Ink terminal UI works |
| 3 | [03-streaming-and-interrupts.md](./03-streaming-and-interrupts.md) | Word-by-word replies (SSE), async generators, events, cancelling with `esc`/Ctrl+C, automatic retries |
| 4 | [04-the-agent-loop.md](./04-the-agent-loop.md) | 🎯 Tools and the agent loop: `tool_use` → run → `tool_result` → repeat. The first tool: `Read` |
| 5 | [05-a-real-toolset.md](./05-a-real-toolset.md) | Glob, Grep, Edit, Write, Bash: tool design, read-before-write, running commands safely, parallel tools |
| 6 | [06-permissions.md](./06-permissions.md) | The permission gate: allow/deny/ask, rules, splitting shell commands, modes (Shift+Tab), the dialog |
| 7 | [07-context-engineering.md](./07-context-engineering.md) | What the model knows: system prompt sections, environment, NOOBLY.md, `/init`, system reminders, `/context` |
| 8 | [08-context-window.md](./08-context-window.md) | Token budgets, one output limit, clearing old tool output, summarising (`/compact`), why editing history is tricky |
| 9 | [09-sessions-and-caching.md](./09-sessions-and-caching.md) | Transcripts (JSONL), `--continue` / `/resume`, prompt caching and `/cost` savings |
| 10 | [10-configuration.md](./10-configuration.md) | Settings files in layers, `noobly config`, custom slash commands in `.noobly/commands/` |
| 11 | [11-planning.md](./11-planning.md) | The model's todo list (`TodoWrite`), and leaving plan mode with your approval (`ExitPlanMode`) |
| 12 | [12-hooks.md](./12-hooks.md) | Your commands at fixed moments: block tools, give feedback, "tests must pass"; trusting a project |
| 13 | [13-subagents.md](./13-subagents.md) | Delegating to a subagent with its own context window (`Task`), in parallel, with progress |
| 14 | [14-mcp.md](./14-mcp.md) | MCP: other programs' tools over JSON-RPC; the client, the adapter, a toy server |
| 15 | [15-skills.md](./15-skills.md) | Skills and progressive disclosure: descriptions always, instructions on demand |
| 16 | [16-memory.md](./16-memory.md) | Memory across sessions: just files + an index in the system prompt; `/memory` |
| 17 | [17-headless-and-library.md](./17-headless-and-library.md) | `-p` with json / stream-json output, exit codes, stdin; `query()` and `createSession()`; ↑/↓ history |
| 18 | [18-robustness.md](./18-robustness.md) | Dropped connections, `pause_turn`, thinking + effort, a local model (Ollama), WebFetch, prompt injection |
| 19 | [19-observability-and-evals.md](./19-observability-and-evals.md) | Traces and `/stats`; 10 eval cases with checkers; `npm run eval`; A/B comparisons |
| 20 | [20-sandbox.md](./20-sandbox.md) | 🎯 v2: Bash in an OS sandbox (bubblewrap / seatbelt): policy, why sockets matter, a domain-filtering proxy, `/sandbox` |
| 21 | [21-checkpoints-and-rewind.md](./21-checkpoints-and-rewind.md) | Undo: snapshots before every edit, Bash changes detected, Esc Esc / `/rewind` for code, conversation or both, `/diff` |
| 22 | [22-background-tasks.md](./22-background-tasks.md) | Servers, watchers, long builds: `run_in_background`, `TaskOutput` (with `until`), `TaskStop`, exit reminders, one sandbox per session (the executor) |
| 24 | [24-feedback-after-edits.md](./24-feedback-after-edits.md) | A quick check after every Edit/Write; only NEW problems (a per-file baseline); your own checkers per file type |
| 25 | [25-edit-tools-per-model.md](./25-edit-tools-per-model.md) | MultiEdit (all or nothing), a whitespace-forgiving fallback, ApplyPatch for OpenAI models, one tool set per conversation |
| 26 | [26-big-output.md](./26-big-output.md) | Paging, not truncating: too-long output saved to a file, a preview + the path; compaction keeps the path |
| 27 | [27-repo-map.md](./27-repo-map.md) | A map of the codebase: symbols per file, PageRank over "who uses what", IDF, fitted to a token budget; `RepoMap` |
| 28 | [28-images-and-search.md](./28-images-and-search.md) | Images as content blocks (Read, pasted paths), per-provider translation, honest token estimates; `WebSearch` (Brave, Tavily, SearXNG) |
| 29 | [29-worktrees.md](./29-worktrees.md) | Editing subagents in parallel: a git worktree + branch each, results committed to the branch, `/merge`; mount order in the sandbox |
| 30 | [30-editors-acp.md](./30-editors-acp.md) | `noobly acp`: the Agent Client Protocol, so editors can host noobly; one loop, many front-ends |
| + | [extra-v2-test-scenario.md](./extra-v2-test-scenario.md) | One live session that exercises every v2 feature, with what to watch for at each step |
| + | [extra-multiple-providers.md](./extra-multiple-providers.md) | Use Anthropic, OpenAI or Grok: one internal format, translated at the edge. `/provider`, `/model`, `/models` |
| + | [extra-markdown-rendering.md](./extra-markdown-rendering.md) | Replies rendered as Markdown (bold, code, lists, tables, code blocks): parsing with `marked`, drawing with Ink |
| — | [glossary.md](./glossary.md) | Short definitions of every term used |

> **Why is there a Phase 1 doc when you asked for Phases 0 and 2?**
> A chat (Phase 2) needs something to chat *with*. Phase 1, a single call to the model, is the smallest piece that makes Phase 2 possible, so it was built too.

---

## Quick start

```bash
# 1. Install the packages (only needed once)
npm install

# 2. Try the UI for free, without an API key. The "echo" provider just repeats you.
node bin/noobly.js --echo

# 3. Use a real model: set ONE of these (noobly picks the first it finds)
export ANTHROPIC_API_KEY=sk-ant-...   # https://console.anthropic.com/settings/keys
export OPENAI_API_KEY=sk-...          # https://platform.openai.com/api-keys
export XAI_API_KEY=xai-...            # Grok: https://console.x.ai (GROK_API_KEY also works)
node bin/noobly.js                          # interactive chat
node bin/noobly.js -p "What is a token?"    # one question, then exit

# 4. Optional: make `noobly` a command you can run from anywhere
npm link
noobly --help
```

Inside the chat:

| Type | What happens |
|---|---|
| any text + Enter | Sent to the model |
| `/help` | List commands |
| `/cost` | Tokens used and dollars spent |
| `/history` | How many messages get re-sent each turn |
| `/tools` | List the tools the model can use |
| `/permissions` | Rules and mode; `/permissions allow Bash(npm test:*)` |
| Shift+Tab | Permission mode: default → accept edits → plan |
| `/accept-all-permissions` | Stop asking for this session (deny rules still apply); Shift+Tab turns it off |
| `/context` | What the model is told, with token sizes |
| `/init` | Let the agent write a NOOBLY.md for your project |
| `/compact [focus]` | Summarise the conversation to free up context |
| `/resume [n]` | List or continue saved conversations (`noobly --continue` from the shell) |
| `/config` | Every setting and which file it came from (`noobly config` from the shell) |
| `/your-command` | Your own commands from `.noobly/commands/*.md` |
| `/todos` | The model's todo list |
| `/memory` | What noobly remembers about this project ("remember that …" adds to it) |
| `/stats` | Time to first token, request and tool durations, cache hit rate |
| ↑ / ↓, `\` + Enter | Earlier messages; a new line in your message |
| `/hooks`, `/agents`, `/mcp`, `/skills` | Hooks, subagents, MCP servers and skills that are set up |
| `/<skill-name> [details]` | Use a skill straight away |
| `read <file>`, `find <glob>`, `grep <regex>`, `run <command>`, `write <file> <text>`, `search <word>`, `markdown` (with `--echo`) | Try every tool without an API key |
| `todo a; b; c`, `plan <text>`, `task <prompt>`, `tasks <a> \| <b>`, `skill <name>`, `mcp <tool> <json>`, `fetch <url> [question]`, `think <text>` (with `--echo`) | Try the Phase 11–18 tools without an API key |
| `/model <id>` | Switch model, e.g. `/model grok-4.3` (switches provider if needed) |
| `/models` | List the models your key can use |
| `/provider [id]` | Show or switch provider: `anthropic`, `openai`, `grok`, `echo` |
| `/clear` | Make the model forget everything |
| `esc` or Ctrl+C while it's replying | Stop that reply (the conversation continues) |
| `/exit`, or Ctrl+C twice | Quit |

## Run the tests

```bash
npm test
npm run eval -- --verify      # check the 10 eval checkers (offline)
npm run eval                  # run the evals against the real model (costs money)
```

294 tests, a few seconds, **no internet and no API key needed**. The tests use a fake model, so they cost nothing.

## The big picture so far

```
 you type ─► Ink UI (src/ui) ─► Session (src/core/session.js) ─► Provider (src/providers)
                                  keeps the history               sends HTTP to Anthropic
 you see  ◄─ Ink UI ◄──────────── events: text_delta… turn_end ◄─ streamed SSE events
                                        │
                                        ▼  (Phase 04) the agent loop runs tools the model asks for
                     hooks (12) ─► Permission gate (Phase 06) ─► ask you? ─► Tools: Read, Glob, Grep, Edit, Write, Bash,
                                                                        TodoWrite, ExitPlanMode (11), Task → subagent (13),
                                                                        Skill (15), mcp__server__tool (14), WebFetch (18)
```

Before the first message, Phase 07 builds the system prompt from the environment (git, date…) and your NOOBLY.md files.

Three layers, each with one job:

1. **UI**: shows things and reads your keyboard. Knows nothing about HTTP.
2. **Session**: remembers the conversation and adds up cost. Knows nothing about the screen.
3. **Provider**: turns a request into an HTTP call and back. Knows nothing about conversations.

Keeping them separate is what makes it possible to swap the real model for a fake one (`--echo`, tests) or the rich UI for plain text (`-p`) without touching the other layers. This idea comes back in every later phase.
