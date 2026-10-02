# Lesson 3: The agent loop

This is the most important lesson. If you only remember one thing from the course, make it this loop.

## From chatbot to agent in one `while`

A chatbot makes **one** model call per message. An agent makes **as many as it needs**:

```
           ┌──────────────────────────────────────────┐
           ▼                                          │
  ┌──────────────────┐   stop_reason = tool_use   ┌───┴──────────────┐
  │ 1. Call the model├───────────────────────────►│ 2. Run the tools │
  │   (send history) │                            │ add tool_results │
  └────────┬─────────┘                            │   to history     │
           │                                      └──────────────────┘
           │ stop_reason = end_turn
           ▼
     show the answer
```

In words:

1. Send the conversation (and the list of tools) to the model.
2. If it stopped with `tool_use`, run every tool it asked for, then add one `tool_result` per `tool_use` to the conversation.
3. Go back to 1. Stop when it answers *without* asking for a tool.

That's it. Everything else in noobly is detail around this loop. Here is the real thing, trimmed (`src/core/loop.js`):

```js
while (true) {
  if (totals.rounds >= session.maxTurns) break;              // safety net: max 25 rounds

  const request = {                                           // ── 1. ask the model
    system:   session.systemPrompt,
    messages: [...session.history, ...pending],
    tools:    session.tools.toApiSchemas(),
  };
  const { message } = yield* askModel(session, request, signal, live);
  pending.push({ role: 'assistant', content: message.content });

  if (message.stop_reason !== 'tool_use') break;              // done: no tools requested

  const results = [];                                         // ── 2. run the tools
  for (const toolUse of toolUsesIn(message)) {
    results.push(await runTool(session, toolUse));
  }
  pending.push({ role: 'user', content: results });          // ── 3. send results back, loop
}
```

## Watch one message become two calls

You ask: *"What's this package called?"* Here's what actually goes back and forth:

```
round 1  →  model sees:  [user: "What's this package called?"]
         ←  model says:  [text "Let me look.", tool_use Read {file_path: "package.json"}]
                         stop_reason: tool_use

         (noobly reads package.json itself)

round 2  →  model sees:  [user: "What's this package called?",
                          assistant: "Let me look." + tool_use Read,
                          user: tool_result "1 {\n2 \"name\": \"nooblyjs-learn-harness\" …"]
         ←  model says:  [text "It's called nooblyjs-learn-harness."]
                         stop_reason: end_turn   → done
```

Notice three things:

1. **The tool result goes back as a `user` message.** The conversation must alternate user/assistant, and from the model's point of view the result is new information arriving *from outside*, so it's on the user side.
2. **Every `tool_use` has an `id`, and its `tool_result` carries the same `tool_use_id`.** That's how the model knows which result answers which request when it asked for several at once.
3. **The model is called twice for one message.** A real task like "fix the failing test" can take 15 rounds: read, grep, read, edit, run tests, read the error, edit, run tests…

## 🧪 Lab: be the model

The lab script plays the model with a **mock provider**: you script its replies, and the *real* noobly loop runs around them.

```bash
node .claude/learning/labs/watch-the-loop.js
```

You should see:

```
--- EVENTS (what the UI sees) ---
message_start {}
tool_start {"name":"Read","summary":"package.json"}
tool_end {"name":"Read","summary":"package.json"}
message_start {}
turn_end {"stopReason":"end_turn","rounds":2,"toolCalls":1}

--- HISTORY (what gets re-sent to the model next time) ---
user      text        What is this package called?
assistant text        Let me look.
assistant tool_use    Read {"file_path":"package.json"}
user      tool_result      1	{      2	  "name": "nooblyjs-learn-harness", …
assistant text        The package is called nooblyjs-learn-harness.

--- REQUESTS: the model was called 2 times for ONE user message ---
request 1: 1 messages, 15 tools offered, system prompt 2110 chars
request 2: 3 messages, 15 tools offered, system prompt 2110 chars
```

The `Read` really ran: that's your real `package.json` in the history. Only the model was fake.

**Try these changes** (open `.claude/learning/labs/watch-the-loop.js`):

- Make the first reply ask for `{ name: 'Read', input: { file_path: 'nope.txt' } }`. What does the model get back? (Hint: tools never crash the loop. Errors become a `tool_result` with `is_error: true`, so the model can try something else.)
- Ask for *two* tools in the first reply: a `Read` and a `Glob`. Count the `tool_result` blocks.
- Ask for a tool called `Teleport`. Read the error message carefully. Who is it written for?

## Details that matter (and why they exist)

Once the core loop works, real-world problems show up. Each fix is a small addition to the same loop:

| Problem | noobly's answer | Where |
|---|---|---|
| The model loops forever | Stop after `maxTurns` rounds (default 25) | top of the `while` |
| A tool throws an exception | Catch it, send the message as an error result. **Never crash the loop.** | `runTool` |
| The model asks for 5 file reads at once | Read-only tools in a row run **in parallel**; anything that changes things runs alone, in order | `batchTools` |
| The user presses Esc mid-tool | Every tool not yet run gets a "interrupted" result, so every `tool_use` still has an answer | the `signal?.aborted` check |
| The reply got cut off mid-tool-call | Don't run the half-written call; tell the model to use smaller steps | the `max_tokens` branch |
| A half-finished turn would leave the history broken | New messages collect in `pending` and are only added to `history` at the end, in a valid state | `commit()` |

That last one is subtle and important. The API **rejects** a conversation in which a `tool_use` has no matching `tool_result`. So noobly never saves a half-finished round. It's the harness's job to keep history valid, always.

## The loop is a generator

You may have noticed `async function*` and `yield`. `runTurn` is an **async generator**: instead of returning one result at the end, it *yields events as they happen*: `text_delta`, `tool_start`, `tool_end`, `turn_end`… (`src/core/events.js`).

This is a quietly powerful design. The loop doesn't know or care who is listening:

- The **Ink UI** turns events into the spinner, streaming text and tool boxes.
- **Headless mode** (`-p --output-format stream-json`) prints them as JSON lines.
- The **library** (`query()`) hands them to your code.
- **ACP** (Phase 30) translates them for an editor like Zed.
- **The lab script** just `console.log`s them.

One loop, many front-ends. Lesson 7 comes back to this.

## Check yourself

1. Write the three steps of the agent loop from memory.
2. Why does a `tool_result` go into a `user` message?
3. A tool throws `ENOENT: no such file`. What does the model see? Does the turn end?
4. The model asks for `[Read, Grep, Edit, Read]`. How does noobly batch these, and why?
5. What would go wrong if noobly pushed messages straight into `session.history` as they happened, and the user pressed Esc in the middle of a tool?

<details><summary>Answers</summary>

1. Call the model with history + tools → if `stop_reason` is `tool_use`, run each tool and append a `tool_result` for each → repeat until it stops asking.
2. Messages must alternate user/assistant, and results are input *to* the model from the outside world.
3. An error `tool_result` with a message written for the model. The turn continues: the model gets to react (e.g. Glob for the right path).
4. `[Read, Grep]` together (parallel, both read-only), then `[Edit]` alone, then `[Read]`. Reads can't interfere with each other; edits can, and order matters.
5. History could end with a `tool_use` that has no `tool_result`, and the API would reject every later request. `pending` + `commit()` prevent that.

</details>

**Next:** [Lesson 4: Tools](./04-tools.md)
