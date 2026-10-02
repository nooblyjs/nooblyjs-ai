# Phase 08: The context window

**Goal:** keep long sessions working. Every request re-sends the whole conversation, and a model can only read so much at once. When the conversation gets too big, noobly makes room: first cheaply, then by summarising.

---

## 1. The problem

A model's **context window** is the most it can read in one request: system prompt + tool definitions + the whole conversation.

| Model | Context window |
|---|---|
| `claude-opus-5-5`, `grok-4.3` | 1,000,000 tokens |
| `grok-4.7` | 500,000 |
| `claude-haiku-4-5` | 200,000 |
| `echo` (offline) | **20,000**, tiny on purpose so you can watch this phase work for free |

A million tokens sounds endless, but an agent reads files and runs commands all day. Every file it reads stays in the conversation and is **re-sent (and paid for) on every request** after that. Two problems grow together: **running out of room** and **cost**.

## 2. Knowing how full it is (`src/context/tokens.js`)

```js
estimateTokens(text)   // ≈ characters / 4
contextUsage(session)  // { tokens, window, fraction }
```

Exact counts depend on each provider's *tokenizer*, but "4 characters ≈ 1 token" is close enough to decide when to act. The status bar now shows it:

```
grok · grok-4.7 · 18 msgs · ctx 62% · in 165,234 / out 401 · $0.21
```

`ctx` turns yellow at 50% and red at the compaction threshold (80%). `/context` shows the full breakdown.

## 3. Step 0: one size limit for all tool output

Before this phase each tool limited itself (Read: 2000 lines, Bash: 30,000 characters…). But a Read of 2,000 very long lines could still be millions of characters. Now **every** tool result passes through `limitToolOutput()` in the loop: at most ~40,000 characters (≈10k tokens), keeping the start and end, plus a hint for the model:

```
[This output was too long and was cut in the middle. Ask for less at a time:
 e.g. Read with offset/limit, Grep with head_limit or a narrower path.]
```

## 4. Making room, cheapest first (`src/context/compact.js`)

At the **start of a turn**, if the conversation plus your new message would fill more than 80% of the window, noobly makes room before sending anything:

```
✻ Context compacted (cleared old tool output): ~19,375 → ~9,345 tokens
```

### Step 1: clear old tool output (free)

A file the model read 30 messages ago rarely needs to be there word for word. Big tool results (over 1,000 characters) outside the last 6 messages are replaced with:

```
[Old tool output cleared to save space. Run the tool again if you need it.]
```

No model call needed. If that brings usage well below the threshold, we're done.

### Step 2: summarise ("compact")

Otherwise a **cheaper model** writes a structured summary of the older part of the conversation:

| Provider | Summariser (setting: `smallModel`) |
|---|---|
| Anthropic | `claude-haiku-4-5` |
| OpenAI | `gpt-6-luna` |
| Grok | `grok-4.3` |

The summary has fixed sections: **Goal**, **Done so far**, **Files**, **Current state**, **Next steps**, **Details to keep** (exact commands, names, paths, preferences). A vague summary makes the agent forget what it was doing, so the prompt asks for specifics.

The **latest turn(s) are kept word for word** (up to 20% of the window), so the agent still sees exactly what just happened. The summary goes at the start:

```
before:  [turn 1][turn 2][turn 3]…[turn 40][turn 41]
after:   [<conversation-summary> of turns 1–40 + turn 41 kept as it was]
```

### Where it's safe to cut

You can't cut the history just anywhere. A `tool_use` must be followed by its `tool_result`, or the API rejects the request. So the cut is only made at the **start of a turn**: a message *you* wrote, never one carrying tool results (`isTurnStart()`). For the same reason, compaction never happens in the middle of a turn, between a tool call and its result.

### `/compact`

Compact whenever you like, optionally saying what matters:

```
/compact
/compact keep the exact error messages from the failing tests
```

## 5. The hidden trap: editing history

Both steps **edit** the conversation, and that has two costs:

1. **Prompt caching** (Phase 09) only works while the start of the request stays identical. After an edit you pay full price once more. That's why noobly compacts only when it's about to run out of room.
2. **Claude's thinking blocks are tied to their conversation.** Newer Claude models (like Opus 5.5) return *thinking blocks* with a signature that records the exact conversation they came from. For newer API accounts, sending a thinking block back after anything before it changed is **rejected with an error**. So:
   - whenever noobly edits history, it **strips all thinking blocks** from what remains (`stripThinking()`); text and tool calls stay;
   - the summariser gets the conversation as **plain text** (`transcriptText()`), with no thinking blocks and no tools, which works with every provider.

This also explains a change to Phase 07: **`/init` no longer swaps the system prompt mid-conversation.** Changing the system prompt is also an edit of "everything before". A new NOOBLY.md now applies from your next conversation (`/clear` or restart).

> Anthropic also offers **server-side** compaction and "context editing" that avoid this problem, because the API does the editing itself. We build it client-side because that's where the learning is, and it works the same for every provider.

## 6. Try it (free)

```bash
cp src/core/loop.js /tmp/demo/big.js && cd /tmp/demo
noobly --echo
❯ read big.js      # watch ctx % in the status bar: 28%…
❯ read big.js      # …45%…
❯ read big.js      # …62%…
❯ read big.js      # …80% (red)
❯ read big.js      # ✻ Context compacted (cleared old tool output)
❯ /compact         # force a summary
❯ /context         # how full is it now?
```

With a real model, set a small window in `.noobly/settings.json` to see it quickly: `{ "contextWindow": 30000 }`.

## 7. Settings

| Setting | Default | Meaning |
|---|---|---|
| `autoCompact` | `true` | Make room automatically |
| `compactThreshold` | `0.8` | …when the window is this full |
| `contextWindow` | model's own | Pretend the window is this size (great for testing) |
| `smallModel` | provider's small model | Who writes the summaries |

## What we learned

- The context window is a **budget**, and every token in it is paid for on every request.
- **Estimate before sending** (≈4 chars/token); show the user how full it is.
- Make room **cheapest first**: clear old tool output, then summarise.
- A good summary is **structured and specific**; the latest turn stays word for word.
- Only cut at **turn boundaries**: never separate a tool call from its result.
- **Editing history has costs**: cache misses, and Claude's thinking blocks must be stripped.
