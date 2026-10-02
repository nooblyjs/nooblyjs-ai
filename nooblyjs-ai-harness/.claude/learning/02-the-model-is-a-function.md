# Lesson 2: The model is a function

Before we can build an agent, we need to be precise about the thing we're wrapping. This lesson covers three facts that shape *every* design decision in a harness.

## Fact 1: a model call is just an HTTP request

There's no magic connection. Calling Claude is a `POST` of some JSON to a URL, and you get JSON back. noobly does it with plain `fetch`, no SDK, so you can see everything (`src/providers/anthropic.js`).

The request, stripped to the essentials:

```json
POST https://api.anthropic.com/v1/messages
{
  "model": "claude-opus-5-5",
  "max_tokens": 16000,
  "system": "You are noobly, an AI coding assistant…",
  "messages": [
    { "role": "user", "content": "What is a token?" }
  ],
  "tools": [ … ]
}
```

And the reply:

```json
{
  "role": "assistant",
  "content": [ { "type": "text", "text": "A token is a chunk of text…" } ],
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 1834, "output_tokens": 112 }
}
```

Learn these field names now. You'll see them everywhere:

- **`system`**: standing instructions. Who the model is and how to behave. (Lesson 6.)
- **`messages`**: the conversation so far, alternating `user` / `assistant`.
- **`tools`**: what the model may ask the harness to do. (Lesson 3.)
- **`stop_reason`**: *why* the model stopped writing. This one field drives the whole agent loop.
- **`usage`**: how many tokens went in and came out. This is what you pay for.

> 👀 **See it for yourself:** `node bin/noobly.js -p "hi" --verbose` prints the exact JSON sent and received (needs an API key; costs a fraction of a cent).

## Fact 2: the model is stateless

This is the most important fact in the course.

**The model remembers nothing between calls.** Send "my name is Ana" in one request and "what's my name?" in the next, and it has no idea. Each request starts from zero.

So how does a chat work? **The harness re-sends the entire conversation every time:**

```
Call 1:  messages: [ user: "my name is Ana" ]
         → "Nice to meet you, Ana!"

Call 2:  messages: [ user: "my name is Ana",
                     assistant: "Nice to meet you, Ana!",
                     user: "what's my name?" ]
         → "Your name is Ana."
```

The model didn't *remember* Ana. It *read* it again. **The conversation history is a list the harness keeps and re-sends.** In noobly it's `session.history` (`src/core/session.js`), just an array.

Hold on to this, because it has big consequences:

- **Every call gets longer.** Message 50 re-sends messages 1–49. That costs money and time.
- **There's a limit.** The model can only read so much at once (its **context window**, e.g. 200,000 or 1,000,000 tokens). A long session *will* hit it. (Lesson 6: compaction.)
- **The harness can edit history.** Since it's just an array we send, we can summarise it, trim it or rewind it. (Lessons 5–6: compaction, `/rewind`.)
- **"Memory across sessions" is just more text we choose to send.** (Lesson 6: memory files.)

## Fact 3: everything is measured in tokens

Models don't read characters or words. They read **tokens**, chunks of text roughly ¾ of an English word on average. `"harness"` might be one token; `"nooblyjs"` might be three.

Tokens are the unit of three things:

| Measured in tokens | Why it matters |
|---|---|
| **Cost** | You pay per input token and per output token. Output is usually ~5× pricier. |
| **The context window** | The hard limit on how much the model can read in one call. |
| **`max_tokens`** | The limit *you* set on how much it may write in one reply. noobly's default is 16,000. |

And because every call re-sends the history (Fact 2), **input tokens add up fast**. This is why **prompt caching** exists: if the *start* of the request is exactly the same as last time, the provider charges about a tenth for that part. noobly carefully keeps the start of every request stable to get that discount (`src/context/cache.js`, and the ordering rules in `src/context/system-prompt.js`). You'll see `/cost` report the savings.

## `stop_reason`: the model telling you why it stopped

Every reply ends with a reason. The main ones:

| `stop_reason` | Meaning | What the harness does |
|---|---|---|
| `end_turn` | "I'm done." | Show the answer, wait for the user. |
| `tool_use` | "I'm asking you to run a tool." | **Run it and call the model again.** ← the agent loop |
| `max_tokens` | "I ran out of room mid-reply." | The reply is cut off. If it was in the middle of a tool call, noobly asks it to retry in smaller steps. |
| `refusal` | "I won't continue this." | Show a notice; discard the partial output. |
| `pause_turn` | "The server paused a long turn." | Send it straight back to continue. |

Look at the second row. That one value, `tool_use`, is what turns a chatbot into an agent. Next lesson.

## Streaming, briefly

A long reply can take 30 seconds. Rather than wait in silence, the harness asks for `"stream": true`, and the reply arrives as a series of small events (**SSE**, server-sent events): *"here are 3 more words… here are 4 more…"*. noobly shows them as they arrive, and still assembles the complete message at the end (`src/providers/sse.js`).

Streaming also makes **interrupting** possible: press Esc and noobly aborts the HTTP request (an `AbortSignal`), keeping the text you already saw.

Networks fail, so the harness also **retries**: on a `429` (rate limit) or `529` (overloaded) it waits and tries again (`src/providers/retry.js`). If the connection breaks *mid*-reply, it throws away the partial reply and asks again (`askModel` in `src/core/loop.js`).

## One format, many providers

Anthropic, OpenAI and Grok all have slightly different JSON. noobly uses **one internal format** (Anthropic's shape) everywhere, and translates at the edge: one file per provider in `src/providers/`. The loop never knows which company it's talking to.

That edge is also where the **fake providers** live:

- `echo.js`: repeats you, and pretends to use tools when you type `read <file>`, `run <cmd>`… (`node bin/noobly.js --echo`)
- `mock.js`: you script the replies in advance. All the tests use this, and so do the labs in this course.

A fake provider is possible *only because* the model is a function at the end of an HTTP call. Swap the function, and the rest of the harness can't tell the difference.

## Check yourself

1. You send message #20 in a conversation. Roughly what does the request contain?
2. Why does a long conversation get more expensive per message, not just in total?
3. What is a context window, and what happens when you approach it?
4. Which `stop_reason` tells the harness to run a tool?
5. Why does noobly put things that never change at the *start* of the system prompt?

<details><summary>Answers</summary>

1. The system prompt, the tool list, and *all* 19 earlier messages (plus their replies and any tool results), then message #20.
2. Every request re-sends the whole history, so each new message carries all the earlier ones as input tokens.
3. The maximum tokens the model can read in one request. Near it, the harness must make room (summarise or clear old content), or requests will fail.
4. `tool_use`.
5. Prompt caching only discounts an *unchanged prefix*. Stable content first means more of each request is cached.

</details>

**Next:** [Lesson 3: The agent loop](./03-the-agent-loop.md)
