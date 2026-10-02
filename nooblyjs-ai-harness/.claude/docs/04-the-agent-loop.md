# Phase 04: The agent loop

**Goal:** turn the chatbot into an **agent**. The model can now ask noobly to *do* something (read a file), see the result, and decide what to do next.

This is the most important phase so far. Every AI coding agent, Claude Code included, is built around this loop.

---

## 1. The model can't touch your computer

A model only ever produces text. It can't open files, run commands or browse the web. So how does Claude Code edit your code?

**Tool use.** We tell the model *which tools exist*. Instead of answering, it can reply with a structured request:

> "Please run the tool `Read` with the input `{ "file_path": "package.json" }`."

**noobly** (the harness) runs the tool and sends the result back. The model reads the result and carries on. The model *decides*; the harness *does*.

## 2. What goes over the wire

### We describe the tools in every request

```json
{
  "model": "claude-opus-5-5",
  "system": "You are noobly…",
  "messages": [ … ],
  "tools": [
    {
      "name": "Read",
      "description": "Read a text file from the project and return its contents with line numbers…",
      "input_schema": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string", "description": "Path of the file to read" },
          "offset":    { "type": "integer", "description": "Line number to start from (1-based)…" },
          "limit":     { "type": "integer", "description": "How many lines to read (default 2000)" }
        },
        "required": ["file_path"]
      }
    }
  ]
}
```

The **description is a prompt**. The model decides *whether* and *how* to use a tool based only on this text, so it's written for the model: what the tool does, when to use it, and its limits.

The **input_schema** is JSON Schema: the shape of the input the tool accepts.

### The model replies with a `tool_use` block

```json
{
  "content": [
    { "type": "text", "text": "Let me look at package.json." },
    { "type": "tool_use", "id": "toolu_01A…", "name": "Read", "input": { "file_path": "package.json" } }
  ],
  "stop_reason": "tool_use"
}
```

`stop_reason: "tool_use"` means: "I've stopped because I'm waiting for you to run these tools."

### We answer with a `tool_result` block

The next message is from the `user` role (that's us, the harness):

```json
{
  "role": "user",
  "content": [
    { "type": "tool_result", "tool_use_id": "toolu_01A…", "content": "     1\t{\n     2\t  \"name\": \"nooblyjs-learn-harness\",\n…" }
  ]
}
```

`tool_use_id` links the result to the request. Then we call the API again, and the model answers using what it read.

## 3. The loop (`src/core/loop.js`)

```
            ┌──────────────────────────────────────────────┐
            ▼                                              │
  send history + tools to the model                        │
            │                                              │
            ▼                                              │
  stop_reason == "tool_use"? ──── no ───► done (turn_end)  │
            │ yes                                          │
            ▼                                              │
  run every tool_use → collect tool_results                │
            │                                              │
            ▼                                              │
  add assistant message + results to the conversation ─────┘
```

In code, `runTurn()` is an async generator (from Phase 03) with a `while (true)` loop. Each pass is one **round**, meaning one request to the model. One message from you can take several rounds:

```
you:        "What's the name in package.json?"
round 1 →   assistant: [text "Let me look.", tool_use Read(package.json)]
            user:      [tool_result "1 { 2 "name": "nooblyjs-learn-harness" …"]
round 2 →   assistant: [text "It's nooblyjs-learn-harness."]      ← stop_reason end_turn: done
```

That's why `/history` now jumps by 4 after a tool turn instead of 2.

## 4. The rules the loop enforces

These are the details that make an agent work reliably. Each one has a test in `test/loop.test.js`.

| Rule | Why |
|---|---|
| **Every `tool_use` gets exactly one `tool_result`, in the very next message** | Otherwise the API rejects the conversation |
| **All results for one reply go back in ONE user message** | That's the format the API expects. Splitting them also teaches the model to stop asking for several tools at once |
| **Tool failures become results, never crashes** | `"File not found: nope.txt"` with `is_error: true` lets the model fix its mistake (try another path). A crashed harness helps nobody |
| **Unknown tool → error listing the real tools** | The model can correct itself |
| **Bad input → error saying what's wrong** | e.g. `Missing required field "file_path"`. Checked by `validateInput()` before the tool runs |
| **Maximum rounds (`maxTurns`, default 25)** | A confused model could loop forever. We stop, tell you, and keep the history valid |
| **Only run tools if `stop_reason` is `tool_use`** | If the reply was cut off by `max_tokens`, the tool input may be half-written JSON. We drop that `tool_use` instead of running it |
| **Interrupt mid-tool → answer the remaining tool_uses with "Interrupted by user"** | So the history is still valid and the conversation can continue |
| **Save the turn to history only at the end** | Messages are collected in `pending` and committed once, in a valid state |

### Error messages are prompts too

Compare these two errors for a missing file:

- ❌ `ENOENT: no such file or directory, open '/x/nope.txt'`
- ✅ `File not found: nope.txt. Check the path (it is relative to /workspaces/…/nooblyjs-learn-harness).`

The second tells the model *what to do next*. That's what `ToolError` is for: an expected failure whose message is written for the model. Unexpected crashes are still caught and reported as `Read failed: <message>`.

## 5. What a tool is (`src/tools/tool.js`)

```js
export const readTool = defineTool({
  name: 'Read',
  isReadOnly: true,                       // never changes anything (matters for permissions in Phase 06)
  description: 'Read a text file…',       // written for the model
  inputSchema: { … },                     // JSON Schema of the input
  summarize: (input) => 'package.json',   // short label for the UI: Read(package.json)
  async call(input, ctx) {                // does the work
    return { content: '…for the model…', display: '32 lines' };
  },
});
```

- `content` is what the **model** sees (the full numbered file).
- `display` is what **you** see (`⎿ 32 lines`). You don't need the whole file on screen; the model does.
- `ctx` gives the tool what it needs: `cwd` (project folder), `signal` (for interrupts), `session`.

`ToolRegistry` (`src/tools/registry.js`) holds the tools and turns them into the API's `tools` list. `/tools` in the chat lists them.

## 6. The `Read` tool (`src/tools/read.js`)

| Feature | Why |
|---|---|
| Line numbers like `cat -n` (`     1\t{`) | The model can refer to exact lines, and in Phase 05 it will edit by them |
| Up to 2000 lines by default, with `offset`/`limit` | A huge file would flood the context window. The model is told how to read more |
| Very long lines are cut | Minified files can have 100,000-character lines |
| Refuses directories and binary files | Nothing useful for the model there. It detects binary by looking for a NUL byte |
| **Only files inside the project** | `/etc/passwd` → refused. `../other-project/secret` → refused. |
| **Symlinks are followed before checking** | A link *inside* the project pointing *outside* it is caught too (`paths.js` uses `realpath`) |
| Remembers what was read (`session.readFiles`) | Phase 05 rule: you must Read a file before you may overwrite it |

## 7. Tool input streams in pieces

With streaming (Phase 03), a tool's input arrives as fragments of JSON text:

```
input_json_delta: '{"file_pa'
input_json_delta: 'th": "package.json"}'
```

`assembleMessage()` in `anthropic.js` glues the pieces together and only parses them at `content_block_stop`, when the JSON is complete. We prepared for this in Phase 03; now it's used.

## 8. The UI

New events from the loop:

| Event | UI shows |
|---|---|
| `tool_start` | the text so far is moved into `<Static>`, then a live `⠋ Read(package.json)` spinner |
| `tool_end` | `● Read(package.json)` with `⎿ 32 lines` (red if it failed) |
| `notice` | a yellow note, e.g. "Stopped after 25 rounds" |
| `turn_end` | the stats line, now with `1 tool call` |

```
❯ what's the name in package.json?
● Let me look at package.json.

● Read(package.json)
  ⎿ 32 lines

● The name is nooblyjs-learn-harness.
  ⎿ 3.4s · 1 tool call · in 1,204 · out 38 tokens · $0.0056
```

In print mode (`-p`), the answer still goes to stdout and the tool lines go to stderr.

## 9. Try it

**Free, with the echo provider.** It pretends to be a model that uses tools when you type `read <file>`:

```bash
noobly --echo
❯ read package.json        # ● Read(package.json) ⎿ 32 lines, then a summary
❯ read nope.txt            # red error, and the "model" reports it
❯ read /etc/passwd         # refused: outside the project
❯ /tools
❯ /history                 # 4 messages per tool turn
```

**With a real key:**

```bash
noobly -p "What is the name field in package.json?"
noobly -p "Read src/core/loop.js and explain the agent loop in 5 bullet points"
noobly -p "Compare the test files for sse and retry. Which tests more edge cases?"   # watch it read several files
```

Ask it something that needs a file it can't find (e.g. "summarise the CHANGELOG"). It will try, get "File not found", and tell you, all without crashing.

See the code difference:

```bash
git diff phase-03 -- src/
```

## 10. Current limits

| Limit | Fixed in |
|---|---|
| ~~It can only **read** files it already knows the name of~~ | ✅ Phase 05 (`Glob`, `Grep`) |
| ~~It can't edit files or run commands~~ | ✅ Phase 05 (`Write`, `Edit`, `Bash`) |
| ~~Tools run one after another~~ | ✅ Phase 05 |
| Nothing asks your permission (fine for now: `Read` is read-only and project-only) | Phase 06 |
| Big tool results fill the context window quickly | Phase 08 |

## What we learned

- An **agent** = a model + tools + **a loop**. The model decides; the harness does.
- Tools are described to the model with a **name, a description (a prompt!) and a JSON Schema**.
- `stop_reason: "tool_use"` → run tools → send `tool_result`s → call again, until `end_turn`.
- The harness must keep the conversation **valid**: every `tool_use` answered, results together, nothing half-finished.
- **Errors are feedback for the model**, not crashes.
- Tools need **guardrails** from day one: project-only paths, symlink checks, size limits.
