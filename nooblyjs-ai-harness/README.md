# nooblyjs-learn-harness

`noobly`: an AI coding CLI harness (like Claude Code), built one concept at a time so you can learn how it works.

```bash
git clone https://github.com/nooblyjs/nooblyjs-ai-common.git ../nooblyjs-ai-common   # shared AI building blocks, linked as a file: dependency
npm install
node bin/noobly.js --echo                 # try the UI offline, no API key
export XAI_API_KEY=xai-...                # or ANTHROPIC_API_KEY / OPENAI_API_KEY
node bin/noobly.js                        # chat (provider picked from the key)
node bin/noobly.js --model grok-4.3       # choose the model
node bin/noobly.js -p "What is a token?"  # one-shot
npm test                                  # offline tests
echo "list TODOs" | node bin/noobly.js -p --output-format json   # headless, for scripts
node bin/noobly.js acp                    # serve the Agent Client Protocol, for editors (v2)
npm run eval -- --verify                  # check the eval suite offline (npm run eval: live, costs money)
```

On Linux, install **bubblewrap** so Bash commands run in a sandbox (`sudo apt install bubblewrap`); macOS has `sandbox-exec` built in. Without a sandbox, noobly still works: every command asks first.

- 📘 **Learning notes:** [.claude/docs/README.md](.claude/docs/README.md), one per phase
- 🗺️ **Plan:** [PRD](.claude/specs/PRD.md) · [Architecture](.claude/specs/Architecture.md) · [Roadmap](.claude/specs/Roadmap.md)
- 🧩 **Examples to copy:** [`examples/`](examples/) (hooks, a subagent, a skill, an MCP config, a library script)

## Status

**v2.0.0**: Phases 00–30 built, except Phase 23 (the larger eval suite), which was skipped. Each phase is tagged in git (`phase-NN`), so `git diff phase-19 phase-20` shows exactly what a concept costs in code.

### v1: a complete agent (Phases 00–19)

A streamed chat UI (Ink) with interrupts and retries · the agent loop · Read, Glob, Grep, Edit, Write, Bash · permissions (allow/deny/ask rules, Shift+Tab modes) · context engineering (NOOBLY.md, `/init`, `/context`, system reminders) · compaction (`/compact`) · saved sessions (`--continue`, `/resume`) with prompt caching · layered settings and custom slash commands · todo lists and plan mode · hooks · subagents (`Task`) · MCP servers · skills · memory · headless JSON output and a library API (`query()`) · robustness (mid-reply restarts, thinking, Ollama, WebFetch, prompt-injection defences) · tracing (`/stats`) and an eval suite. Plus Anthropic, OpenAI and Grok providers, and Markdown rendering.

### v2: from assistant to agent (Phases 20–30)

v1 asks before everything. v2 is about an agent you can **leave running**: it limits what a command *can* do, makes every change undoable, and keeps working while processes run. Then it gets better results per task, and scales out.

| Phase | Feature | How you use it |
|---|---|---|
| 20 | **OS sandbox for Bash** (bubblewrap on Linux, seatbelt on macOS): write only to the project, a private `/tmp` and package caches; `.git/hooks` stays read-only; `~/.ssh` and other secrets hidden; no network, or only listed domains through a filtering proxy. Sandboxed commands run **without asking** | `/sandbox`; setting `"sandbox": { "network": ["registry.npmjs.org"] }` |
| 21 | **Checkpoints & rewind**: every Edit/Write is snapshotted; go back to before any message, restoring code, conversation or both | **Esc Esc**, `/rewind`, `/diff` |
| 22 | **Background tasks**: dev servers, watchers and long builds keep running while the agent works; it's told when they exit | Bash `run_in_background`, `TaskOutput` (waits for "ready"), `TaskStop`, `/tasks` |
| 24 | **Feedback after edits**: a quick check after each Edit/Write reports only the problems that edit introduced | built in for JS and JSON; `"feedback": { "checkers": { "*.py": "python3 -m py_compile \"$FILE\"" } }` |
| 25 | **Edit tools per model**: `MultiEdit` (all or nothing), a whitespace-forgiving fallback, `ApplyPatch` for OpenAI models | automatic; setting `"editTools": "edit" \| "patch"` |
| 26 | **Big output, nothing lost**: too-long output is saved to a file; the model gets the start, the end and the path to Read or Grep | automatic |
| 27 | **Repo map**: the most-used files and what they define, ranked with PageRank, within a token budget | `RepoMap` tool; setting `"repoMap": "auto" \| "on" \| "off"` |
| 28 | **Images & web search**: Read shows images; image paths in your message are attached; `WebSearch` | drag an image into the prompt; set `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY` or `"webSearch": { "searxngUrl": "…" }` |
| 29 | **Parallel agents in worktrees**: editing subagents each get their own git worktree and branch, so they can run at the same time | `Task` with `isolation: "worktree"`; `/merge` |
| 30 | **Editors (ACP)**: editors that speak the Agent Client Protocol (e.g. Zed) can host noobly | `noobly acp` |

**Safety of project settings:** a cloned repo's `.noobly/settings.json` can't quietly run code. Its hooks, MCP servers, `env`, `baseUrl`, `permissions.allow`, `sandbox`, `feedback` checkers and `webSearch` all wait until you trust the project (asked once; `noobly trust` from the shell).

### Not verified yet

- **With a real model:** v2 was built and tested offline (scripted providers). The roadmap's measured A/B checks for Phases 24, 25 and 27 need the Phase 23 eval suite and an API key.
- **In a real editor:** ACP is tested with a scripted client, not yet inside Zed.
- **On a Mac:** the seatbelt profile is checked as text but hasn't run on macOS.

## Inside the chat

| Key / command | What it does |
|---|---|
| `Esc` / `Ctrl+C` | interrupt the reply (Ctrl+C twice on an empty prompt: quit) |
| `Esc Esc` | rewind to before an earlier message |
| `Shift+Tab` | cycle permission modes: default → accept edits → plan |
| `/help` | every command, including your own from `.noobly/commands/` |
| `/sandbox` · `/tasks` · `/rewind` · `/diff` · `/merge` | v2: the sandbox, background tasks, undo, changes, worktree branches |
| `/context` · `/compact` · `/cost` · `/stats` | what's in the context window, making room, spending, timings |
| `/resume` · `/clear` · `/model` · `/provider` · `/permissions` · `/config` | sessions and settings |
