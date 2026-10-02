# Phase 02: Conversation state and the rich terminal UI

**Goal:** chat back and forth, with the model "remembering" earlier messages, in a nice-looking terminal app.

Two big ideas in this phase:

1. **The model has no memory.** The harness fakes it by re-sending everything.
2. **A terminal UI can be built like a web page**, with React components, using Ink.

---

## Part A: How a conversation is remembered

### The surprising fact

Every API call is **completely independent**. The model does not remember your last message. Nothing is stored on Anthropic's side between calls.

So how does this work?

```
❯ My name is Sam
● Nice to meet you, Sam!
❯ What is my name?
● Your name is Sam.
```

Because on the second turn we send **the whole conversation again**:

```
Turn 1 sends:  [ user: "My name is Sam" ]

Turn 2 sends:  [ user:      "My name is Sam",
                 assistant: "Nice to meet you, Sam!",
                 user:      "What is my name?" ]      ← the model reads it all, fresh
```

### The Session class (`src/core/session.js`)

```js
const session = new Session({ provider });
await session.send('My name is Sam');   // history: 2 messages
await session.send('What is my name?'); // history: 4 messages
session.clear();                        // history: 0. The model "forgets"
```

What `send()` does, step by step:

1. Makes the new user message: `{ role: 'user', content: text }`.
2. Calls the provider with **`[...history, newMessage]`**.
3. **Only if the call succeeds**, saves both the user message and the assistant reply to `history`.
4. Adds the reply's `usage` to the running totals and works out the cost.
5. Returns `{ text, stopReason, usage, cost, durationMs }` for the UI to show.

Why only save on success (step 3)? If the network fails and we'd already saved the user message, the next request would contain two `user` messages in a row, and the history would be out of step with what the model has actually seen. Saving only complete turns keeps history valid. (There's a test for this.)

### Consequence: every turn costs more than the last

Because the input grows every turn, so do the input tokens:

| Turn | Messages sent | Input tokens (roughly) |
|---|---|---|
| 1 | 1 | 60 |
| 2 | 3 | 120 |
| 10 | 19 | 1,500+ |

**Try it:** chat for a few turns and watch `in …` in the status bar climb. `/history` shows how many messages are being re-sent. Later phases fix this with *compaction* (Phase 8) and *prompt caching* (Phase 9).

### `/clear`

`/clear` empties `history` and resets counters. The old text stays on screen (terminals can't really "unprint"), but a `──── Conversation cleared ────` line marks the point where the model stops knowing anything above it. Ask "what's my name?" after clearing and it won't know.

### Slash commands (`src/core/commands.js`)

Anything starting with `/` is handled by **the harness**, not the model. `runCommand()` returns an instruction for the UI (`print`, `clear` or `exit`) instead of touching the screen itself. That keeps it testable with no UI at all.

---

## Part B: The rich UI with Ink

### What is Ink?

[Ink](https://github.com/vadimdemedes/ink) is **React, but it draws to the terminal instead of a web page**. Claude Code itself is built with it. Instead of `<div>` and `<span>`, you use:

| Ink | Like on the web | Used for |
|---|---|---|
| `<Box>` | `<div style="display:flex">` | Layout, borders, padding |
| `<Text>` | `<span>` | Text, colour, bold |
| `<Static>` | a log that only grows | Finished messages that never change |

Plus two helper packages:

- `ink-text-input`: the input box you type in
- `ink-spinner`: the `⠋ ⠙ ⠹` animation

### The screen layout (`src/ui/App.jsx`)

```
╭──────────────────────────────────────────────╮
│ ✻ noobly v0.2.0 · a learning AI harness      │  ← <Banner>        ┐
│ model: claude-opus-5-5 · provider: anthropic │                    │  inside <Static>:
╰──────────────────────────────────────────────╯                    │  printed once, then
❯ My name is Sam                                  ← <Message user>   │  scrolls up like
● Nice to meet you, Sam!                          ← <Message asst>   │  normal output
  ⎿ 1.8s · in 58 · out 12 tokens · $0.0005                          ┘
⠹ Thinking… 2s                                    ← <Thinking>  (while waiting)
╭──────────────────────────────────────────────╮     OR
│ ❯ Ask noobly anything…                       │  ← <PromptInput> (when idle)
╰──────────────────────────────────────────────╯
 claude-opus-5-5 · 2 msgs · in 58 / out 12 tokens · $0.0005   /help   ← <StatusBar>
```

### Components = small functions that return UI

```jsx
export function Message({ item }) {
  if (item.kind === 'user') {
    return (
      <Box marginBottom={1}>
        <Text color="cyan" bold>❯ </Text>
        <Text color="cyan">{item.text}</Text>
      </Box>
    );
  }
  // ...
}
```

`item` is a **prop**: data passed in by the parent, like a function argument.

### State = data that, when changed, redraws the screen

`App.jsx` keeps three pieces of state with React's `useState`:

| State | Holds | Changes when |
|---|---|---|
| `items` | Every transcript entry (banner, messages, errors) | A message is added |
| `input` | What's currently typed in the box | Every keypress |
| `busy` | Are we waiting for the model? | Before and after `session.send()` |

The flow when you press Enter:

```
handleSubmit("hi")
  ├─ starts with "/"? → runCommand() → add result to items → done
  ├─ add "❯ hi" to items
  ├─ busy = true            → screen swaps the input box for the spinner
  ├─ await session.send("hi")
  ├─ add "● reply" + stats  (or "✗ error")
  └─ busy = false           → input box comes back
```

You never write "draw this now". You **change state**, and React/Ink work out what to redraw. That's the core idea of React.

### Why `<Static>`?

Ink redraws the live part of the screen on every change (each keypress, each spinner tick). If all messages were live, a long chat would be redrawn constantly and flicker. `<Static>` prints each item **once**, above the live area, so it becomes normal terminal scrollback. Only the spinner, input box and status bar are redrawn.

### The `--echo` provider

`src/providers/echo.js` pretends to be a model: it waits 0.4s and replies `You said: "…" (I remember N message(s) so far)`. Watch N go 1 → 3 → 5 → 7: that's the history being re-sent, made visible. It's free, needs no key, and the tests use the same trick.

### Two front-ends, one Session

| | Interactive (`noobly`) | Print mode (`noobly -p "…"`) |
|---|---|---|
| UI | Ink app | plain `console.log` |
| Turns | many | one |
| Good for | chatting | scripts, pipes (`> file.txt`) |

Both use the same `Session`. The UI is swappable because the Session never draws anything.

---

## Try it

```bash
noobly --echo            # free: watch the history count grow
noobly                   # real model (needs ANTHROPIC_API_KEY)
```

1. Tell it your name, ask for it back two turns later.
2. `/history`, then `/cost`.
3. `/clear`, ask for your name again.
4. `/model claude-haiku-4-5`, ask something, compare the cost in the stats line.

## Known limits (fixed in later phases)

| Limit | Fixed in |
|---|---|
| ~~The reply appears all at once after "Thinking…"~~ | ✅ Phase 03 |
| ~~Ctrl+C quits the whole app; you can't cancel just one reply~~ | ✅ Phase 03 |
| ~~No automatic retry on rate limits / overload~~ | ✅ Phase 03 |
| ~~Markdown (`**bold**`, code blocks) shows as raw text~~ | ✅ [extra-markdown-rendering.md](./extra-markdown-rendering.md) |
| Conversations are lost when you quit | Phase 09 |
| It can't read files or run commands: it's a chatbot, not an agent yet | Phase 04 🎯 |

## What we learned

- The model is stateless. **The harness owns the memory.**
- Re-sending history makes cost grow with every turn: the first taste of *context management*.
- Only save complete turns, so history is always valid.
- Ink lets us build the terminal UI from React components: **props** in, **state** changes, the screen redraws itself.
- `<Static>` for finished output, a live area for things that change.
