# Phase 17: Headless mode, the library API, and input polish

**Goal:** use noobly from scripts and from other programs, not just the chat screen.

---

## The same loop, different front-ends

Since Phase 03 the agent loop has only **emitted events**. It never prints. That pays off here: the chat UI, print mode, the JSON output, the transcript, the library and the tests are all just **different consumers of the same events**.

```
                         ┌─► Ink chat UI            (src/ui/App.jsx)
session.stream(prompt) ──┼─► text / json / stream-json   (src/ui/headless.js)
   (events)              ├─► transcript             (Phase 09)
                         └─► your code: query()     (src/index.js)
```

## Headless: `noobly -p`

```bash
noobly -p "What does src/cli.js do?"                 # answer on stdout, progress on stderr
noobly -p "Summarise" --output-format json           # ONE JSON object at the end
noobly -p "Fix the lint errors" --output-format stream-json --allowed-tools "Edit, Bash(npm run lint:*)"
git diff | noobly -p "Review this diff"              # piped text is added to the prompt
echo "list TODOs" | noobly -p --output-format json | jq .result
```

| Format | stdout | For |
|---|---|---|
| `text` (default) | the answer only; tools and stats go to **stderr** | people, `> answer.txt` |
| `json` | one result object at the end | scripts, CI (`jq .result`) |
| `stream-json` | an `init` line, **one event per line** as they happen, then the result | programs that follow along live |

The result object:

```json
{ "type": "result", "subtype": "success", "is_error": false, "result": "…the answer…",
  "stop_reason": "end_turn", "num_rounds": 3, "num_tool_calls": 2, "duration_ms": 8123,
  "usage": { "input_tokens": 5120, "output_tokens": 310, … }, "total_cost_usd": 0.0266,
  "model": "claude-opus-5-5", "session_id": "…" }
```

**Exit codes** are part of the interface, so a CI step can fail properly:

| Code | `subtype` |
|---|---|
| 0 | `success` |
| 1 | `error_max_turns`, `refusal`, `blocked`, `error` |
| 130 | `interrupted` (Ctrl+C: the conventional code for SIGINT) |

### Flags for unattended runs

| Flag | |
|---|---|
| `--permission-mode plan` | look but don't touch |
| `--allowed-tools "Read, Edit, Bash(npm test:*)"` | several allow rules at once (same as repeating `--allow`) |
| `--max-turns 10` | a hard bound on model requests |
| `--dangerously-skip-permissions` | only in a sandbox (deny rules still apply) |

Nobody can answer a permission question in print mode, so "ask" means **no**, and the model is told which flag would allow it.

### stdin

`-p` is now a switch, and the prompt is the words after it, plus anything piped in:

| You run | The prompt |
|---|---|
| `noobly -p "summarise"` | `summarise` |
| `cat notes.txt \| noobly -p` | the file |
| `git diff \| noobly -p "review"` | `review` + the diff inside `<stdin>` tags |

With a prompt given, noobly waits only briefly for piped text, because some environments leave stdin open forever.

## The library: `query()` and `createSession()`

```js
import { query } from 'nooblyjs-learn-harness';

for await (const event of query({ prompt: 'List the TODOs', options: { permissionMode: 'plan', maxTurns: 5 } })) {
  if (event.type === 'text_delta') process.stdout.write(event.text);
  if (event.type === 'tool_start') console.error(`→ ${event.name}(${event.summary})`);
}
```

```js
import { createSession } from 'nooblyjs-learn-harness';

const session = await createSession({ cwd: '/work/app', model: 'claude-sonnet-5-5', allowedTools: ['Read', 'Grep'] });
const first = await session.send('What does src/cli.js do?');   // the turn_end event: text, usage, cost, trace…
const second = await session.send('And its tests?');            // same conversation
```

| Option | |
|---|---|
| `cwd`, `model` | |
| `provider` | an id (`'anthropic'`, `'ollama'`, `'echo'`…) or a **provider object** (e.g. `createMockProvider([...])` in tests) |
| `permissionMode`, `allowedTools`, `disallowedTools`, `maxTurns` | same meaning as the flags |
| `requestPermission` | answer "ask" questions yourself: `async ({ tool, input }) => ({ behavior: 'allow' })` |
| `tools` | extra tools made with `defineTool()` |
| `transcript`, `mcp` | off by default for the library |
| `signal` | an `AbortSignal` to interrupt |

`examples/library/summarize-tools.js` is the roadmap's checkpoint: a 15-line script that summarises every file in `src/tools/`.

### One way to build a session: `src/core/create-session.js`

Before this phase `cli.js` wired everything by hand: provider, permissions, trust, hooks, MCP, context. The library needs exactly the same, so it moved to one function, `createSession()`. The CLI passes what's specific to a terminal (the trust prompt, `--verbose`, warnings in yellow); the library passes its defaults. **Two front-ends, one set of rules.**

## Input polish

| Key | |
|---|---|
| ↑ / ↓ | go through what you sent before |
| `\` at the end of a line, then Enter | continue on a new line (Enter alone sends) |
| paste with line breaks | kept as it is |

(`src/ui/components/PromptInput.jsx`. `ink-text-input` edits one line; finished lines are shown above it.)

## Markdown rendering

That part of this phase was done early: see [extra-markdown-rendering.md](./extra-markdown-rendering.md).

## What we learned

- **Events, not printing**, is what makes a harness embeddable. Adding two output formats and a library took no change to the loop.
- For scripts, **stdout is data and stderr is chatter**, and **exit codes** are part of the API.
- When two front-ends need the same setup, extract it, so safety rules (trust, permissions) can't differ between them.
