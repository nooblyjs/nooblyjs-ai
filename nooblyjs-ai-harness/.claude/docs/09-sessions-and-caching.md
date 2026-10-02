# Phase 09: Sessions and prompt caching

**Goal:** two things. Conversations **survive quitting** (resume them later), and repeated context gets **cheaper** (prompt caching).

---

## Part A: Saving and resuming

### Where conversations go

Every conversation is saved, as it happens, to:

```
~/.noobly/projects/<your-project-path-with-dashes>/<session-id>.jsonl
   e.g. ~/.noobly/projects/-workspaces-hello-world/cf69884c-6688-4dc3-af7e-045c750f12cd.jsonl
```

(Set `NOOBLY_HOME` to keep them somewhere else.)

### JSONL: one JSON object per line

```jsonl
{"type":"meta","ts":"…","model":"grok-4.7","providerId":"grok","systemPrompt":"You are noobly…","toolsHash":"8f3a…"}
{"type":"message","ts":"…","message":{"role":"user","content":"read big.js"}}
{"type":"message","ts":"…","message":{"role":"assistant","content":[{"type":"tool_use",…}]}}
{"type":"message","ts":"…","message":{"role":"user","content":[{"type":"tool_result",…}]}}
{"type":"message","ts":"…","message":{"role":"assistant","content":[{"type":"text","text":"…"}]}}
{"type":"turn","ts":"…","usage":{"input_tokens":3673,…},"cost":0.0012}
{"type":"history","ts":"…","reason":"summarized","history":[…]}      ← after compaction
```

Why **append a line** instead of rewriting one big JSON file each time?

| Append-only JSONL | Rewrite a JSON file |
|---|---|
| Writing is quick however long the conversation | Gets slower as it grows |
| A crash loses at most the half-written last line | A crash mid-write can corrupt the **whole** file |
| It's a readable log of what happened | Only shows the final state |

Robustness details, each with a test:
- A broken last line (crash) is **skipped** when reading.
- Before appending, noobly checks the file ends with a newline, so the next line isn't **glued onto** a broken one and lost with it.
- Nothing is written until the first real message, so opening and closing noobly leaves no empty files.
- After compaction, a `history` line holds the new (short) history; reading replays from there.

### Resuming

```bash
noobly --continue            # the most recent conversation in this folder (-c)
noobly --resume 2            # the 2nd most recent (-r)
noobly --resume cf69884c     # by id (the first few characters are enough)
noobly -c -p "/cost"         # works with print mode too
```

Inside the chat:

```
❯ /resume
  Saved conversations, newest first:
   1. 2026-09-29 14:48  cf69884c  read big.js  (18 msgs)
   2. 2026-09-29 13:02  7d1e0a44  Create a hello world app…  (12 msgs)
❯ /resume 2
──── Resumed "Create a hello world app…" (12 messages). ────
● (the last reply before you left)
```

`/clear` now starts a **new** conversation. The old one stays saved.

### Resuming correctly is subtle

On resume, noobly **reuses the saved system prompt** instead of building a new one. A new one would contain today's date and git status, so it would differ from before. That means:
- no prompt-cache hits (Part B), and
- Claude's thinking blocks from before would no longer match their conversation (see [Phase 08 §5](./08-context-window.md#5-the-hidden-trap-editing-history)) and the request would be rejected.

If the **tool definitions** changed since (e.g. you updated noobly), a fingerprint (`toolsHash`) spots it, and thinking blocks are stripped as a precaution.

What is **not** restored: which files the model has read. So after resuming, it must Read a file again before editing it (Phase 05's rule). That's a feature: the file may have changed while you were away.

## Part B: Prompt caching

### The idea

Look at what gets sent on two consecutive requests:

```
request 5:  [tools][system prompt][msg 1 … msg 8]
request 6:  [tools][system prompt][msg 1 … msg 8][msg 9][msg 10]
             └──────────── identical ───────────┘
```

Almost all of request 6 was already sent in request 5. Providers can **cache** that shared start. If a request **begins with exactly the same bytes** as a recent one, that part is read from the cache instead of being processed again, which is faster and much cheaper:

| | Price per million tokens (Claude Opus 5.5) |
|---|---|
| Normal input | $4.00 |
| **Cache read** | **$0.20** (5% of normal) |
| Cache write (first time) | $5.00 (a little extra, once) |

In a long agent session, most input tokens can be cache reads.

### How noobly asks for it (`src/context/cache.js`)

- **OpenAI and xAI** cache automatically. noobly already reads their `cached_tokens` (see the multiple-providers doc).
- **Anthropic** wants you to mark where the cacheable part ends, with `cache_control` "breakpoints" (at most 4). noobly marks three:

```
[tools ……… last tool ◆][system prompt ◆][msg 1 … msg 8, last block ◆]
                     ◆ = cache_control: { type: "ephemeral" }
```

The marker on the **last message** is what makes it grow: the next request can read everything up to that point from the cache and only pays full price for the new messages.

Notes:
- Markers are added to a **copy** of the request; the saved history is never changed.
- Very short prompts aren't cached at all: the minimum is roughly 1–4k tokens, depending on the model. Early in a session you'll see no cache reads; that's normal.
- The cache lives about 5 minutes. After a coffee break, the first request writes it again.
- Setting `"promptCaching": false` turns the markers off, to compare.

### Everything before was preparing for this

| Earlier decision | Why it matters for caching |
|---|---|
| **Phase 07:** stable sections first in the system prompt | The unchanging part is at the start |
| **Phase 07:** the environment is a snapshot taken once | The date/git status don't change mid-session |
| **Phase 07:** changes go into `<system-reminder>`s on new messages | Earlier bytes never change |
| **Phase 08:** compaction only when necessary | Every edit is a cache miss |
| **Phase 09:** resume reuses the saved system prompt | Same start as before |

### Seeing it

```
❯ /cost
  Turns:               12
  Input tokens:        9,806   (full price)
  Cache writes:        14,230  (stored for next time)
  Cache reads:         161,944 (re-used from the cache, much cheaper)
  Output tokens:       2,113
  Total cost:          $0.18
  Saved by caching:    $0.61
```

Print mode shows `cache read: …` per turn too.

## Try it

```bash
noobly --echo
❯ read package.json
❯ /exit
noobly --continue          # banner: Resumed "read package.json" (4 messages)
❯ /resume                  # the list
❯ /clear                   # new conversation; the old one is still in /resume
```

With a real Anthropic key, have a 5-turn conversation and watch **Cache reads** climb in `/cost`. Then try it again with `"promptCaching": false` in `.noobly/settings.json`.

## Files

| File | Job |
|---|---|
| `src/session-store/transcript.js` | Create/open/read transcripts, list and find sessions |
| `src/context/cache.js` | Add Anthropic cache breakpoints to a copy of the request |
| `src/core/session.js` | `recordMessages`, `recordTurn`, `resume`, `replaceHistory`; `/clear` starts a new transcript |
| `src/commands/builtin.js` | `/resume`, `/cost` with cache numbers |
| `src/cli.js` | `--continue`, `--resume` |

## What we learned

- **Append-only logs** are simple, fast and crash-safe. Make readers tolerant of a broken last line.
- Resuming means restoring **exactly** what was sent before, including the system prompt.
- **Prompt caching** rewards a stable request start. Design for it from the beginning.
- Anthropic needs explicit **breakpoints**; OpenAI and xAI cache automatically. Either way, measure it with `/cost`.
