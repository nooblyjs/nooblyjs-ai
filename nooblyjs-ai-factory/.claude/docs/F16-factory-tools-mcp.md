# Phase F16: Factory tools for agents (MCP)

**Goal:** give agents a narrow, factory-aware API instead of a bigger prompt.

Until now, everything an agent could learn about the factory came in its prompt, and everything it could tell the factory came back in its final message. That forces two bad habits: **pasting everything** into the prompt, just in case, and **parsing prose** afterwards. The factory had no way to hear "I need to ask someone" or "I chose X because Y" while the agent was working.

F16 gives each agent step six tools, and gives a *person* four more for their own `noobly` chat.

---

## The step tools (`src/mcp/step-tools.js`)

| Tool | What it does | Becomes |
|---|---|---|
| `read_spec({section?})` | The spec, one file (`tasks`), or the part about one id (`R2`, `R2.1`, `T3`) | nothing (read-only) |
| `report_progress({message, percent?})` | "tests written, implementing now" | `step.progress` event |
| `ask_human({question, options?})` | A question for a person | an inbox **question** → the run **parks** |
| `record_decision({title, rationale})` | "n / 2, not n >> 1: >> truncates odd numbers" | `decision.recorded` → the PR's **Decisions** section (F14) |
| `submit_artifact({kind, path})` | "keep this report" | `artifact.stored` (`agent-report`), checked: inside the workspace, ≤ 1 MB |
| `request_scope({paths, reason})` | "I need to touch README.md too" | L3: `scope.granted` at once. Otherwise an inbox **approval**; approving grants it, and F14's scope guard allows it |

Every tool **writes an event** or nothing. A tool can't do anything the event log doesn't show, and each one does one small, checkable thing. That's the design rule: *narrow*. There's no `run_command` or `update_run`, and no tool that changes the line's flow directly. Even `ask_human` doesn't park the run itself. It opens an inbox entry, and the **control plane** decides what that means.

### `ask_human`: waiting costs nothing

```
builder ─ ask_human("half(3): 1.5 or 1?") ─▶ inbox question
        ◀ "Asked. END YOUR TURN NOW."
builder ─ "Waiting for an answer." (turn ends)
executor: an open question for this station? → run.parked (no lease, no slot, no tokens)
        …
person:  factory answer ask-… "1.5: exact halves"   → run.resumed → queued
builder (fresh session) prompt += "# Answers to your questions
                                   - Q: half(3): 1.5 or 1?
                                     A (sam): 1.5: exact halves"
```

The agent can't pause *itself* (a session is a running process). So the tool tells it to stop, and the executor parks the run when it sees the open question. On resume, the station runs **again**, with the answer in its prompt.

Architecture §11 imagined *resuming the same session* (harness H-13). This version restarts the step, which throws away the work done before the question. That's fine for a question asked early, and wasteful for one asked late. Resuming is the upgrade; the doc and the events don't change when it comes.

## Two ways in, one set of tools (`src/mcp/wire.js`)

| Driver | How the agent gets the tools |
|---|---|
| **in-process** | The definitions wrapped as harness tools (`defineTool`), passed to `createSession({ tools })` |
| **subprocess** | `<harnessHome>/mcp.json`: `noobly` starts `factory mcp --step <run>/<step>` itself, as an MCP server |

Both use the same names, `mcp__factory__read_spec` and so on, so prompts and permission rules don't care which driver runs a step. `mcp__factory__*` is added to the step's allowed tools: these are the factory's own tools, scoped to one step, so there's nobody to ask.

Checked with the real harness: with a step's `mcp.json` as the user layer, `noobly -p "/mcp"` shows `factory (user): connected, 6 tool(s)`.

### The MCP server (`src/mcp/server.js`)

This is the other half of the harness's MCP client (harness phase 14): JSON-RPC 2.0, one message per line, on stdio.

```
→ initialize                 ← protocolVersion 2025-06-18, capabilities { tools }
→ notifications/initialized  (no id: no reply)
→ tools/list                 ← name, description, inputSchema, annotations.readOnlyHint
→ tools/call                 ← content [{ type: 'text' }], isError
```

A tool that fails returns `isError: true`: the model reads it and adapts. A protocol mistake is a JSON-RPC error (`-32601 Method not found`). **stdout is the protocol**, so anything else goes to stderr.

`readOnlyHint` matters: the harness only skips the permission question for tools that *promise* to be read-only. `read_spec`, `list_runs` and `get_run` do.

## Per-step tokens (`src/mcp/tokens.js`)

```
token = HMAC-SHA256(~/.factory/secret, "<runId>/<step>")
```

`factory mcp --step run-a/build` starts only if `FACTORY_STEP_TOKEN` is the token for `run-a/build`. Pointed at `run-a/review` or another run, it refuses (tested). The secret is created once (0600) and never goes into a workspace. The token does.

What a token is **not**: a secret from the agent. The agent can use its own step's tools; that's the point. The token stops a step from reaching **another** step's or run's tools, for example a compromised agent editing its own `mcp.json` to act on a different run.

## The operator's tools (`factory mcp --operator`)

For a **person's** `noobly` chat, not an agent's:

| Tool | |
|---|---|
| `submit_item({repo, title, body, priority?, autonomy?})` | A new item, queued for `factory serve` |
| `list_runs({status?})` | Runs, newest first |
| `get_run({runId})` | A run's story (the same lines as `factory logs`) |
| `answer_inbox({id?, decision?, answer?, feedback?})` | No id: what's waiting. Otherwise approve, reject or answer; a parked run goes back in the queue |

```json
// ~/.noobly/mcp.json
{ "servers": { "factory": { "command": "factory", "args": ["mcp", "--operator"] } } }
```

There's no token here: it runs as you, in your own chat, like the CLI does.

**Checkpoint.** The Roadmap asks: in `noobly`, say "file a factory item to add --json to the status command" and watch it appear in `factory status`. That needs a real model to *choose* the tool, so it's yours to try. What I checked offline: `noobly -p "/mcp"` with that config shows `factory (user): connected, 4 tool(s)`, and the tests call each operator tool: `submit_item` → a queued run, which `list_runs` shows.

## Tests

- **Step tools against a stub step** (a real store, a fake workspace with a spec): `read_spec` whole, by file and by id; progress, decisions and artifacts appear as events; `submit_artifact` refuses `../../etc/passwd`.
- **`request_scope`**: L3 → granted; L2 → an inbox approval → approved → `run.scopeGranted`.
- **Tokens**: another run, another step, no token, another factory → all refused.
- **`factory mcp --step` over real stdio**: initialize, tools/list (6, `read_spec` read-only), tools/call, an unknown method → `-32601`; a token for `build` used for `review` → exit 1.
- **End to end**: the builder reads the spec (there isn't one: "small enough to build straight from the issue"), calls `ask_human`, is told to stop, and stops. The run **parks**, with a question in the inbox and its options. It's answered and resumed, the builder starts again with *Answers to your questions*, records a decision, and the PR's Decisions section shows it.
- **Operator tools**: submit → queued, list, get, the inbox; a folder that isn't a repo → refused.

## What was built

| File | What it does |
|---|---|
| `src/mcp/step-tools.js` | The six step tools: name, schema, `handle(ctx, input)` |
| `src/mcp/operator-tools.js` | The four operator tools |
| `src/mcp/server.js` | `serveMcp`: MCP over stdio |
| `src/mcp/tokens.js` | The factory secret; per-step HMAC tokens |
| `src/mcp/wire.js` | `factoryToolsFor`: harness tools + `mcp.json` for one step |
| `src/commands/mcp.js` | `factory mcp --step …` / `--operator` |
| `src/exec/step-runner.js`, `src/exec/harness/in-process.js` | Pass the tools (and the allow rule) to the driver |
| `src/line/stations/common.js` | Each agent is told its step; earlier answers go into its prompt |
| `src/line/executor.js` | An open `ask:<station>` question after a station → park |
| `src/humans/inbox.js` | Approving a `scope` entry → `scope.granted`; an answer needs text |

## Try it

```bash
node --test test/mcp.test.js
factory mcp --operator            # then type: {"jsonrpc":"2.0","id":1,"method":"tools/list"}
factory inbox                     # a parked run's question shows here: factory answer <id> "…"
```

## What we learned

- **A narrow API beats a bigger prompt.** `read_spec("R2.1")` fetches what's needed when it's needed. Every call is small, typed and visible, and the agent's intent arrives as **events** instead of prose to parse.
- **Tools report; the control plane decides.** `ask_human` doesn't park anything itself: it opens an inbox entry, and the executor, seeing it, parks. Same for scope: the tool asks, a person or the autonomy level grants, the guard enforces.
- **One definition, two transports.** A plain `{name, schema, handle}` served in-process *and* over MCP means the in-process tests exercise the same code the subprocess uses.
- **Tokens scope, they don't hide.** An agent is allowed its own step's tools; a token stops it reaching anyone else's.
- **Waiting must cost nothing.** A question parks the run: no lease, no slot, no tokens.
- **Annotations are promises.** `readOnlyHint` is what lets a harness skip asking, so only say it when it's true.
- How the commercial factories appear to do it: Claude Code, Cursor and Copilot's agent mode all load MCP servers for extra tools. Devin can message its user mid-task and wait for a reply; Copilot's coding agent reads repository context through MCP; Factory.ai's Droids and Kiro connect tools the same way. The operator side (driving a factory from a chat) is how Devin, Codex and Jules are used from Slack and similar.
