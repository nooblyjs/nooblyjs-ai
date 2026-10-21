# noobly (nooblyjs-learn-harness)

An AI coding CLI harness like Claude Code (`noobly`), built one concept ("phase") at a time so people can learn how it works. Plain JavaScript and Node, with an Ink (React) terminal UI.

## Commands
- `npm install`: needs `../../nooblyjs-core` to exist. `nooblyjs-ai-common` is a `file:` dependency on `../../nooblyjs-core/src/aiservice/common`, symlinked into node_modules.
- `npm test`: offline, about 40s, around 385 tests. Some tests skip when bubblewrap (`bwrap`) is missing. `npm run coverage` adds coverage.
- One test file: `node --import tsx --import ./test/no-color.js --test test/tool.test.js`
- `npm start` (= `node bin/noobly.js`). Use `node bin/noobly.js --echo` to try the UI offline with no API key.
- `npm run eval -- --verify`: offline check of the eval cases. A plain `npm run eval` calls a real model and costs money.
- There is no build step and no linter or formatter config. `npm run build` only prints a message.

## Code style
- ES modules (`"type": "module"`), Node >= 22. Import Node built-ins with the `node:` prefix (`node:fs/promises`, `node:path`).
- UI files are `.jsx`. They run through `tsx`: `bin/noobly.js` registers it, and so does the test command (`--import tsx`). TypeScript is not used; `tsconfig.json` exists only for JSX settings.
- 2-space indent, single quotes, semicolons, trailing commas in multi-line literals.
- Files are kebab-case (`multi-edit.js`); React components are PascalCase (`src/ui/components/ToolCall.jsx`). Functions and variables use camelCase; constants use UPPER_SNAKE (`MAX_RESULTS`).
- Named exports only. Exported functions get a one-line `/** ... */` doc comment.
- Files usually start with a comment naming the phase, e.g. `// Phase 05: find files by name pattern`. Comments explain *why*, for learners.
- User-facing text (tool descriptions, errors) is plain, friendly English.

## Tests
- Uses Node's built-in runner: `import { test } from 'node:test'` and `import assert from 'node:assert/strict'`. No `describe`; flat `test('reads like a sentence', ...)` calls.
- Test files are `test/<area>.test.js` (or `.jsx` for UI). Shared helpers are in `test/helpers.js`: `makeProject({ 'a.js': '...' })` makes a temp project folder, plus `toolContext(cwd)`, `collect`, `chunked`.
- Tests never hit the network. Use scripted providers (`src/providers/mock.js`, `echo.js`) and set `NOOBLY_HOME` to a temp folder so `~/.noobly` stays untouched.
- `test/no-color.js` forces `FORCE_COLOR=0` so rendered UI output compares as plain text.

## Layout
- `bin/noobly.js`: entry point; it registers tsx, then loads `src/cli.js` (argument parsing, help text).
- `src/index.js`: library API (`createSession`, `query`).
- `src/core/`: `Session`, the agent `loop`, messages, events, cost, trace.
- `src/tools/`: one file per tool. Each is built with `defineTool({ name, description, inputSchema, isReadOnly, call })` from `tool.js` and registered in `createDefaultTools()` in `tools/index.js`.
- `src/providers/`: Anthropic, OpenAI Responses, OpenAI-compatible (Grok and others), echo and mock. `mock.js`, `sse.js`, `errors.js`, `retry.js` are 5-line re-exports from `nooblyjs-ai-common`.
- `src/context/`: system prompt, NOOBLY.md/AGENTS.md loading (`instructions.js`), compaction, repo map, token counting.
- `src/permissions/`, `src/sandbox/` (bwrap and seatbelt), `src/checkpoints/`, `src/hooks/`, `src/mcp/`, `src/skills/`, `src/memory/`, `src/agents/` (subagents, worktrees), `src/tasks/` (background processes), `src/config/` (settings, trust).
- `src/commands/` (slash commands, never sent to the model), `src/feedback/` (checks after edits), `src/session-store/` (saved transcripts), `src/util/` (`log.js`, `paths.js` with `nooblyHome()`, `frontmatter.js`).
- `src/ui/`: Ink app (`App.jsx`, `components/`), headless JSON output, ACP editor server.
- `test/evals/`: eval suite. Each case in `cases/<name>/` has `repo/` (starting files) and `solution/` (the fixed version).
- `examples/`: sample hooks, an agent, a skill, an MCP config and a library script.
- `.claude/docs/NN-*.md`: one learning note per phase (00–30; Phase 23 was skipped). `.claude/specs/`: PRD, Architecture and Roadmap.

## Gotchas
- The git root is the parent monorepo `../` (nooblyjs-ai, CommonJS, Node >= 24). This package is the `nooblyjs-ai-harness/` subfolder. Run git commands with that in mind.
- The README mentions `phase-NN` git tags, but there are none in this repo (they were not carried over into the monorepo).
- A change to a shared provider, error, SSE or mock module belongs in nooblyjs-core (`src/aiservice/common`), not here.
- `temp - app/` (with spaces) holds sample apps noobly built (chess, tic-tac-toe). It is committed but is not part of noobly, even though the repo map lists it. Quote the path, and leave it out of changes.
- Debug logging: set `NOOBLY_DEBUG=1` to write to `~/.noobly/debug.log`.
- Nearly every `src/` area has a matching `test/<area>.test.js` (e.g. `session-store` → `transcript.test.js`). Add tests there when you change something.
