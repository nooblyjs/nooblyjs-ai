# Phase 01: Talking to the model

**Goal:** understand that "calling an AI" is just **one HTTP request with some JSON**.
File: `src/providers/anthropic.js` (about 70 lines, and that's the whole thing).

---

## 1. The request

Every call is a `POST` to one URL:

```
POST https://api.anthropic.com/v1/messages
```

### Headers (who you are, which API version)

| Header | Value | Why |
|---|---|---|
| `x-api-key` | your `ANTHROPIC_API_KEY` | Identifies you and bills you |
| `anthropic-version` | `2023-06-01` | Pins the API format so it doesn't change under you |
| `content-type` | `application/json` | The body is JSON |
| `anthropic-beta` | `server-side-fallback-2026-07-01` | Turns on an optional feature, see "Fallbacks" below |

### Body (what you're asking)

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 16000,
  "system": "You are noobly, a friendly AI coding assistant…",
  "messages": [
    { "role": "user", "content": "What is a token?" }
  ],
  "fallbacks": "default"
}
```

| Field | Meaning |
|---|---|
| `model` | Which Claude model to use |
| `max_tokens` | The most the model may write in its reply. It's a cap, not a target |
| `system` | Standing instructions: *who* the model is and *how* to behave. You don't see it in the chat |
| `messages` | The conversation so far. Roles alternate `user`, `assistant`, `user`… |

In code, `buildRequest()` puts this together **without sending it**. That's why the test can check it without spending money.

## 2. The response

```json
{
  "id": "msg_01…",
  "model": "claude-opus-5-5",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "A token is a small chunk of text…" }
  ],
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 58, "output_tokens": 41 }
}
```

### `content` is a list of *blocks*, not a string

Today we mostly get `text` blocks. Later phases add others, e.g. `tool_use` (the model asking us to run a tool, Phase 4). The model may also send `thinking` blocks (its private reasoning). We **keep every block** in history exactly as received and only *display* the text ones (`textOf()` in `src/core/messages.js`).

### `stop_reason`: why did it stop?

| Value | Meaning |
|---|---|
| `end_turn` | It finished naturally ✅ |
| `max_tokens` | It hit your `max_tokens` cap mid-sentence |
| `refusal` | It declined the request (safety) |
| `tool_use` | It wants to run a tool (Phase 4) |

The UI shows `stop: …` in grey whenever it's not `end_turn`.

## 3. Tokens and cost

A **token** is a piece of a word, roughly 4 characters of English. The model reads and writes tokens, and you pay per token.

| Model | Input $ / 1M tokens | Output $ / 1M tokens |
|---|---|---|
| `claude-opus-5-5` (default) | $4 | $20 |
| `claude-sonnet-5-5` | $2 | $10 |
| `claude-haiku-4-5` | $1 | $5 |

`src/core/cost.js` does the maths:

```
cost = input_tokens × input_price / 1,000,000
     + output_tokens × output_price / 1,000,000
```

Output costs more than input because *writing* is the model's expensive part.

## 4. Errors

When something's wrong, the API returns a non-200 status and a JSON error:

```json
{ "type": "error", "error": { "type": "authentication_error", "message": "invalid x-api-key" } }
```

We turn that into an `ApiError` with `.status`, `.type` and `.message`, so the UI can show `✗ invalid x-api-key` instead of crashing. Common ones:

| Status | Type | Usually means |
|---|---|---|
| 401 | `authentication_error` | Bad or missing API key |
| 400 | `invalid_request_error` | Something in the body is wrong |
| 429 | `rate_limit_error` | Too many requests. Wait and retry (automatic retry comes in Phase 3) |
| 529 | `overloaded_error` | The API is busy. Retry later |

## 5. Fallbacks (a small extra)

Sometimes a model declines a request its safety checks flag, even a harmless one. With `fallbacks: "default"` plus the beta header, the API automatically retries on a suitable other model *in the same call*. It's switched on in `DEFAULTS.fallbacks`; set it to `false` to see raw behaviour.

## 6. Try it

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# See the raw JSON going out and coming back (printed to stderr)
noobly -p "Explain a token in one sentence" --verbose

# The answer goes to stdout, the grey stats line to stderr, so this saves only the answer:
noobly -p "Write a haiku about semicolons" > haiku.txt

# Watch max_tokens cut it off: temporarily set maxTokens: 20 in src/config/defaults.js
noobly -p "Tell me a long story"     # → stats line ends with "max_tokens"
```

**Exercise:** run the `--verbose` command and label each field of the response yourself.

## What we learned

- An AI call is plain HTTP + JSON. No magic.
- The system prompt is where the harness shapes behaviour.
- Replies are lists of typed blocks. Keep them all, show what's relevant.
- Tokens are the unit of both *limits* and *cost*.
- We call the API with plain `fetch` instead of the official SDK **on purpose**, so we can see the wire format. (A real app would normally use `@anthropic-ai/sdk`, which also gives retries and typed errors. We'll compare the two in Phase 18.)
