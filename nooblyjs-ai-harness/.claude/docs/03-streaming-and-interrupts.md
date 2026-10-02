# Phase 03: Streaming and interrupts

**Goal:** show the reply word by word as it's written, let you stop it halfway, and survive temporary API errors.

Before: `Thinking… 4s` → the whole answer appears at once.
After: text flows in live, `esc` stops it, and a busy API is retried automatically.

---

## 1. What streaming is

Normally an HTTP request works like ordering a letter: you wait, then the whole thing arrives. With `"stream": true` it's more like a phone call: the connection stays open and the server keeps talking.

The format is called **Server-Sent Events (SSE)**. It's just text:

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo!"}}

```

- `event:` line = the event's name
- `data:` line = JSON
- **a blank line ends each event**

### The order of events in one reply

```
message_start          "I'm starting." Includes model name and input token count
  content_block_start  "A new block begins" (text, thinking, and later tool_use)
  content_block_delta  "…here's a bit more of it"   ← repeated many times
  content_block_stop   "That block is done"
  (maybe more blocks)
message_delta          "Why I stopped (stop_reason) + output token count"
message_stop           "Done."
```

Plus `ping` (a keep-alive, ignore it) and `error` (something broke mid-reply).

You can see a real recorded example in `test/fixtures/text-reply.sse`.

## 2. The tricky part: bytes arrive in random pieces

The network doesn't care where events end. You might receive:

```
chunk 1:  "event: content_blo"
chunk 2:  "ck_delta\ndata: {\"text\":\"H\xC3"      ← half of the "é" character!
chunk 3:  "\xA9llo\"}\n\nevent: ping\n..."
```

`src/providers/sse.js` solves this with a **buffer**:

1. Decode the bytes to text with `TextDecoder` using `{ stream: true }`. That option makes it *hold back half a character* until the rest arrives, so `é` doesn't turn into `�`.
2. Add the text to the buffer.
3. While the buffer contains a blank line (`\n\n`), cut off everything before it: that's one complete event. Parse it and `yield` it.
4. Whatever's left waits for the next chunk.

**The test proves it:** `test/sse.test.js` feeds the same recording in 25 different random chunkings (and once, one byte at a time) and checks the result is always identical.

## 3. Async generators: the key JavaScript feature

Streaming uses **async generators**: functions marked `async function*` that `yield` values over time.

```js
async function* countSlowly() {
  yield 1;
  await sleep(1000);
  yield 2;
}

for await (const n of countSlowly()) console.log(n);   // 1 … (1 second) … 2
```

They chain together like pipes, each one transforming the stream:

```
response.body (raw bytes)
   │  parseSSE()            bytes → { event, data }
   ▼
   │  assembleMessage()     SSE events → text_delta events, and builds the full message
   ▼
   │  provider.stream()     adds the final { type: 'message', message }
   ▼
   │  withRetry()           retries if it failed before anything arrived
   ▼
   │  session.stream()      tracks partial text, saves history, adds turn_end
   ▼
the UI (for await … of)     shows text as it arrives
```

Every layer is small and can be tested on its own.

## 4. Events: the new language between the layers

Before, `session.send()` returned one answer. Now `session.stream()` yields **events** (`src/core/events.js`):

| Event | Meaning | The UI… |
|---|---|---|
| `message_start` | Request accepted | (counts input tokens) |
| `text_delta` | A few more characters | appends them to the live reply |
| `retry` | Failed, trying again in N seconds | shows a yellow note |
| `turn_end` | Finished (or interrupted) | moves the reply into history and shows stats |

This is the most important design idea for what comes next. **From Phase 04, tool calls will be reported through these same events.** The UI just learns a few new event types.

## 5. Building the full message while streaming

`assembleMessage()` in `anthropic.js` does two jobs at once:

- passes each `text_delta` straight to the UI (so you see it immediately), **and**
- builds the complete message (all blocks, `stop_reason`, `usage`) to save in history.

It also collects `thinking` blocks and their `signature`, which must be sent back unchanged. It already collects `input_json_delta` pieces too: in Phase 04 that's how a tool's input arrives, as bits of JSON that only make sense once complete.

## 6. Interrupting: `AbortController`

JavaScript has a built-in "cancel button" for async work:

```js
const controller = new AbortController();
fetch(url, { signal: controller.signal });   // hand the signal to anything cancellable
controller.abort();                           // press the button → fetch stops with an AbortError
```

In noobly:

| Where | What |
|---|---|
| `App.jsx` | Creates a controller per reply. `esc` or `Ctrl+C` while busy → `controller.abort()` |
| `session.stream()` | Passes `signal` to the provider. On abort it catches the error and ends the turn with `interrupted: true` |
| `anthropic.js` | Passes `signal` to `fetch`, which closes the HTTP connection |
| `retry.js` | `sleep()` also listens to the signal, so you can cancel while it's waiting to retry |
| `cli.js` (`-p` mode) | `Ctrl+C` sends SIGINT → abort → exit code 130 (the standard "stopped by Ctrl+C" code) |

### What happens to a half-finished reply?

We **keep the text you already saw** in history, so the model knows what it said before being cut off. We keep *only* text, never half-finished blocks of other kinds, because the API would reject them.

If nothing had arrived yet, nothing is saved: the turn simply didn't happen.

### Ctrl+C now works in steps

| When | Ctrl+C does |
|---|---|
| Model is replying | Stops the reply (same as `esc`) |
| You've typed something | Clears the input |
| Input is empty | Shows "Press Ctrl+C again to exit" |
| …pressed again within 2s | Quits |

To make this possible, Ink's built-in "Ctrl+C quits" is turned off (`exitOnCtrlC: false` in `start.jsx`) and `App.jsx` handles keys itself with Ink's `useInput` hook.

## 7. Retries: `src/providers/retry.js`

Some errors are temporary. Trying again later usually works:

| Retry ✅ | Don't retry ❌ |
|---|---|
| 429 rate limited | 401 bad API key |
| 529 overloaded | 400 bad request |
| 500/502/503 server errors | You pressed Ctrl+C |
| Network dropped (`TypeError: fetch failed`) | |

**Exponential backoff:** wait 0.5s, then 1s, 2s, 4s (max 4 retries, capped at 20s). A little random **jitter** is added so thousands of clients don't all retry at the same moment. If the server sends a `retry-after` header, we wait exactly that long instead.

**The golden rule: only retry if nothing has arrived yet.** If half the answer is already on your screen, starting over would repeat it. `withRetry()` tracks whether any event was received and re-throws the error if so.

## 8. The UI: keeping a long reply tidy

Ink redraws the "live" part of the screen on every change. A 3-page reply in the live area would be taller than your terminal, and Ink would struggle to redraw it. So `App.jsx` moves **each finished paragraph** (text up to a blank line) into `<Static>` as soon as it's complete. Only the paragraph currently being written stays live.

```
● First paragraph, finished.            ← already in <Static> (permanent)

  Second paragraph, also finished.      ← in <Static>, no ● because it's a continuation

  Third paragraph being writ            ← live, redrawn on each text_delta
⠹ Responding… 3s · esc to interrupt     ← live
```

## 9. Fallbacks while streaming (a detail)

If the main model declines partway through and the API's fallback model takes over, it all happens **on the same stream**: a `fallback` block marks the switch and the text simply continues. When saving to history, `contentForHistory()` keeps only the *text* from before the switch, as the API requires. If the final `stop_reason` is `refusal` (nobody would answer), the partial reply is discarded, not saved.

## 10. New files

| File | Job |
|---|---|
| `src/providers/sse.js` | Bytes → SSE events |
| `src/providers/retry.js` | `isRetryable`, `backoffDelay`, `sleep`, `withRetry` |
| `src/providers/mock.js` | Scripted fake model for tests: streams replies, throws errors on cue |
| `src/core/events.js` | The event types |
| `test/fixtures/text-reply.sse` | A recorded stream |
| `test/helpers.js` | `chunked()` to split bytes randomly, `collect()` to gather a stream into an array |

Changed: `anthropic.js` (streams now), `session.js` (`stream()` instead of `send()`; `send()` still exists as a shortcut), `echo.js` (streams word by word), `App.jsx`, `Thinking.jsx`, `Message.jsx`, `StatusBar.jsx`, `start.jsx`, `cli.js`.

## 11. Try it

```bash
noobly --echo
```

1. Send any message and watch it type out word by word.
2. Send another and press `esc` halfway. You'll see `⎿ interrupted · …` in yellow.
3. Send one more. The echo says it can see 3 messages: your interrupted turn was kept.
4. Press `Ctrl+C` twice to quit.

With a real key:

```bash
noobly -p "Write a 20-line poem about semicolons"            # streams into the terminal
noobly -p "Count to 200 slowly"   # press Ctrl+C partway: exit code 130
echo $?
```

See the difference in code since Phase 02:

```bash
git diff phase-02 -- src/
```

## 12. Things to notice

- **Time to first token** is what makes streaming *feel* fast. The total time is about the same.
- On an interrupted reply the stats line shows `out 0 tokens`. The API only reports output tokens at the very end (`message_delta`), which we never received, but you are still billed for what was generated. Later phases could estimate it.
- A retry note only appears when the API is actually busy. You can see retries in action in `test/retry.test.js` and `test/session.test.js`.

## What we learned

- Streaming = one HTTP response that stays open, sending **SSE** events separated by blank lines.
- Network chunks don't line up with events or even characters, so **buffer** until an event is complete.
- **Async generators** (`async function*` + `for await`) turn streams into simple pipelines.
- **Events** decouple the model from the UI, and they're how tool calls will flow in Phase 04.
- **AbortController** is JavaScript's universal cancel button. Pass the `signal` everywhere.
- **Retry temporary errors with backoff, but never after output has started.**
