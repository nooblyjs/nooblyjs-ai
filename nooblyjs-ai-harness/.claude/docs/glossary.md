# Glossary

| Term | Meaning |
|---|---|
| **Harness** | The program around an AI model: it sends requests, keeps history, runs tools, asks permission, shows output. `noobly` is a harness; Claude Code is a harness. |
| **Model** | The AI itself (e.g. `claude-opus-5-5`). It turns input text into output text, and that's all it does. |
| **API** | The web address and rules for talking to the model: `POST /v1/messages`. |
| **API key** | Your secret password for the API. Kept in the `ANTHROPIC_API_KEY` environment variable, never in code. |
| **Provider** | Our code that knows how to talk to one model API (`anthropic.js`) or fakes it (`echo.js`). |
| **Token** | A small piece of text, about 4 characters. Limits and prices are counted in tokens. |
| **Input / output tokens** | What you send (the whole history + system prompt) / what the model writes back. |
| **Context window** | The most tokens a model can read in one request. Long chats eventually fill it (Phase 08). |
| **System prompt** | Hidden standing instructions sent with every request: "You are noobly…". |
| **Message** | `{ role: 'user' \| 'assistant', content }`, one turn of the conversation. |
| **Content block** | One piece of a message's content: `text`, and later `tool_use`, `tool_result`, `thinking`. |
| **Stop reason** | Why the model stopped writing: `end_turn`, `max_tokens`, `refusal`, `tool_use`. |
| **Stateless** | Remembers nothing between calls. The model is stateless; the Session supplies memory. |
| **Session** | Our object that holds the conversation history and running totals. |
| **Slash command** | Input starting with `/`, handled by the harness and never sent to the model. |
| **Ink** | A library for building terminal UIs with React components. |
| **React component** | A function that takes **props** and returns what to show. |
| **Props** | Data passed into a component by its parent. |
| **State** | Data a component owns; changing it makes the screen redraw. |
| **JSX** | The HTML-like syntax `<Text>hi</Text>` used to write components. |
| **tsx** | A tool that converts JSX to plain JavaScript as Node loads each file. |
| **ES modules (ESM)** | Modern JavaScript `import`/`export`. We use these because Ink requires them. |
| **stdout / stderr** | The two output streams of a program. We put answers on stdout and stats/errors on stderr. |
| **Beta header** | `anthropic-beta: …`, which opts into a newer or optional API feature. |
| **Streaming** | Receiving the reply bit by bit while it's generated, instead of all at the end. |
| **SSE (Server-Sent Events)** | The text format used for streaming: `event:` + `data:` lines, with a blank line after each event. |
| **Delta** | A small piece of new content, e.g. `text_delta` = a few more characters. |
| **Async generator** | An `async function*` that `yield`s values over time; read with `for await (… of …)`. |
| **Event** | A small message from the Session to the UI: `text_delta`, `retry`, `turn_end`… |
| **AbortController / signal** | JavaScript's cancel button. Pass `signal` to async work; `abort()` stops it. |
| **Backoff** | Waiting longer after each failed attempt before retrying (0.5s, 1s, 2s…). |
| **Jitter** | A small random extra wait so many clients don't retry at the same moment. |
| **Exit code 130** | The standard exit code for a program stopped by Ctrl+C. |
| **Agent** | A model plus tools plus a loop: it can act, see the result, and decide what to do next. |
| **Tool** | Something the harness can do for the model (e.g. `Read`), described by a name, a description and an input schema. |
| **Tool use / `tool_use`** | A block in the model's reply asking the harness to run a tool with some input. |
| **Tool result / `tool_result`** | Our reply to a `tool_use`: what the tool returned (or an error). Linked by `tool_use_id`. |
| **Agent loop** | Call model → run requested tools → send results → repeat until the model stops asking. |
| **Round** | One request to the model inside a turn. A turn with one tool call takes two rounds. |
| **JSON Schema** | A standard way to describe the shape of JSON data; used for tool inputs. |
| **maxTurns** | The most rounds one message may trigger before the loop stops (default 25). |
| **Read-only tool** | A tool that never changes anything. Allowed without asking (unless a deny rule matches). |
| **Symlink** | A file that points to another file. We follow it before checking the path is inside the project. |
| **Glob pattern** | A file-name pattern: `*` matches within a folder name, `**` across folders. `src/**/*.js`. |
| **Regular expression (regex)** | A text-search pattern, e.g. `function\s+\w+`. Used by Grep. |
| **ripgrep (`rg`)** | A very fast search program. Grep uses it when installed. |
| **Exact string replacement** | How Edit works: find this exact text (once), replace it with that. |
| **mtime** | A file's "last modified" time. Used to detect files changed since they were read. |
| **Process group** | A process plus everything it started. Killing the group leaves no orphans. |
| **stdin / file descriptor 3** | stdin is a program's keyboard input (closed for Bash). fd 3 is an extra output channel we use for `pwd`. |
| **Parallel tools** | Neighbouring read-only tool calls run at the same time; changes run one by one. |
| **Provider** | The company whose model noobly talks to: Anthropic, OpenAI or xAI (Grok). |
| **Adapter / translator** | Code that converts between our internal message format and another API's format. |
| **Chat Completions** | OpenAI's `/chat/completions` API. xAI and many others copy it ("OpenAI-compatible"). |
| **`[DONE]`** | The last line of an OpenAI-style stream: `data: [DONE]`. |
| **Bearer token** | `Authorization: Bearer <key>`: how OpenAI and xAI receive your API key (Anthropic uses `x-api-key`). |
| **Permission gate** | The code that decides allow / deny / ask for every tool call (Phase 06). |
| **Permission rule** | `Tool` or `Tool(specifier)`, e.g. `Bash(npm test:*)`, `Edit(src/**)`, `Read(**/.env*)`. |
| **Permission mode** | default, acceptEdits, plan or bypass. Shift+Tab cycles the first three. |
| **Plan mode** | Read-only mode: the agent investigates and describes a plan but can't change anything. |
| **Prompt injection** | Text in a file, web page or command output that tries to give the model instructions. |
| **Context** | Everything the model sees in a request: tools, system prompt, messages. |
| **Context engineering** | Deliberately choosing what goes into the context, and in what order. |
| **NOOBLY.md / AGENTS.md** | Instruction files for the agent, loaded every session (like Claude Code's CLAUDE.md). |
| **System reminder** | A `<system-reminder>` note noobly adds to your message when something changed mid-session. |
| **Prompt caching** | Providers reusing an unchanged request start for less money (Phase 09). Why stable content goes first. |
| **Markdown** | A plain-text format for formatting: `**bold**`, `` `code` ``, `- lists`, tables, ```` ``` ```` code blocks. Models write their answers in it. |
| **Parser / lexer** | Code that turns text into structured tokens (we use `marked.lexer`). |
| **Token tree** | The parser's output: block tokens (paragraph, list…) containing inline tokens (bold, code…). |
| **Recursion** | A function that calls itself, e.g. drawing bold text that contains code. Natural for trees. |
| **Context window** | The most tokens a model can read in one request (system prompt + tools + conversation). |
| **Compaction** | Making room in the context window: clearing old tool output, or summarising older messages. |
| **Thinking block** | Claude's private reasoning in a reply. Newer models tie it to the exact conversation; editing earlier history means stripping them. |
| **Turn boundary** | A message the user wrote: the only safe place to cut history. |
| **Transcript / JSONL** | The saved conversation: one JSON object per line, only ever appended to. |
| **Resume** | Continue a saved conversation (`--continue`, `/resume`). |
| **Cache breakpoint** | Anthropic's `cache_control` marker: "everything up to here may be cached". |
| **Settings layer** | One source of settings: defaults, user file, project file, local file, env, flags. |
| **Provenance** | Where a setting's value came from (shown by `noobly config`). |
| **Custom slash command** | A Markdown file in `.noobly/commands/` that becomes `/name`: a saved prompt. |
| **Frontmatter** | `key: value` lines between `---` at the top of a Markdown file. |
| **Fallback** | An optional API feature: if the model declines a request, another model answers it instead. |
| **Todo list (`TodoWrite`)** | A checklist the model writes for itself and re-sends in full each time; keeps a long task's plan near the end of the context (Phase 11). |
| **Plan mode / `ExitPlanMode`** | A mode where only read-only tools run; the model leaves it by sending its plan for your approval (Phases 06, 11). |
| **Hook** | Your command, run by the harness at a fixed moment (before a tool, after a tool, when the model stops…). Exit code 2 blocks (Phase 12). |
| **Trust (project)** | Your one-time "yes" before a project's own hooks or MCP servers may run; asked again if they change (Phases 12, 14). |
| **Subagent** | A separate session with an empty history that does one job and returns only its final reply (Phase 13). |
| **Context isolation** | Keeping a subagent's reading and searching out of the main conversation; only the summary comes back. |
| **Channel** | A small async queue: tools push progress events, the loop yields them while the tools run (Phase 13). |
| **MCP (Model Context Protocol)** | A standard for plugging external tools (servers) into any AI harness (client) (Phase 14). |
| **JSON-RPC 2.0** | A message format: requests with an `id`, responses with the same `id`, notifications without one. MCP uses it. |
| **stdio transport** | Talking to a child process over its stdin and stdout, one JSON message per line. |
| **Skill** | A folder with a `SKILL.md` (instructions) and helper files, loaded only when needed (Phase 15). |
| **Progressive disclosure** | Showing a short summary always and the detail only on demand: skill descriptions in the prompt, bodies via a tool. |
| **Memory** | Notes the agent writes for future sessions: files in `~/.noobly/projects/<slug>/memory/` plus a MEMORY.md index in the system prompt (Phase 16). |
| **Headless** | Running without the chat screen: `noobly -p`, for scripts and CI (Phase 17). |
| **JSON Lines / stream-json** | One JSON object per line, so a program can read events as they happen. |
| **Exit code** | The number a program returns when it ends: 0 = success, anything else = a kind of failure. |
| **Library API** | Using the harness from code: `query()` and `createSession()` (Phase 17). |
| **Fault injection** | Deliberately breaking things in tests (a dropped connection) to check recovery (Phase 18). |
| **`pause_turn`** | A stop reason meaning "not finished, send this back to continue". |
| **Adaptive thinking / effort** | Current Claude models decide how much to think; `effort` (low…max) sets how hard (Phase 18). |
| **Prompt injection** | Instructions hidden in content the agent reads (a web page, a file) that try to make it do something else. |
| **Exfiltration** | Sending data out without permission, e.g. inside a URL. Why WebFetch asks per domain. |
| **Trace / TTFT** | A record of one turn's timings; TTFT = time to first token, the latency you feel (Phase 19). |
| **Percentile (p50, p90)** | The value half (or 90%) of measurements are below; more honest than an average. |
| **Eval** | A test of the agent: a task, a starting repo and a checker of the outcome (Phase 19). |
| **A/B experiment** | Running the same evals with one thing changed, to measure its effect. |
| **Sandbox** | A limit the operating system puts on a process: which files it may write, whether it has network. Phase 20 runs every Bash command in one. |
| **Namespace** (Linux) | The kernel feature behind containers and bubblewrap: a process gets its own view of the filesystem, network or process list. |
| **bubblewrap / seatbelt** | The sandbox tools noobly uses: `bwrap` on Linux (namespaces), `sandbox-exec` on macOS (a kernel-checked profile). |
| **Unix socket** | A "file" programs connect to in order to talk (e.g. `/var/run/docker.sock`). Read-only mounts don't block connecting, so sandboxes must hide them. |
| **Proxy** | A program that makes network connections on behalf of others. Phase 20's proxy only connects to allowed domains. |
| **Checkpoint** | A saved copy of a file's content from before noobly changed it, per turn, so the change can be undone (Phase 21). |
| **Rewind** | Going back to before an earlier message: the files, the conversation, or both (`/rewind`, Esc Esc). |
| **Content-addressed** | Stored under a name computed from the content (its SHA-256 hash), so identical content is stored once. |
| **Background task** | A command that keeps running while the agent works (a dev server, a watcher). Started with Bash `run_in_background`, read with `TaskOutput`, stopped with `TaskStop` (Phase 22). |
| **Executor** | The small program inside a session's sandbox that runs its commands, so they share one sandbox (Phase 22). |
| **Process group** | A process and everything it started, which can be signalled together. How noobly makes sure "stop" means everything. |
